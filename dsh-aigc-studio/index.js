// dsh-aigc-studio —— 一站全有：出图 / 出歌 / 传参考音频 / 查钱包
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { createWallet, runTask, explainHttp, sleep, walletPayload } from 'dsh-aigc-core'

export const name = 'dsh-aigc-studio'
export const inject = ['tools']

// ── 配置：Schemastery schema（官方契约要求；禁止普通对象，也不许硬编码可调参数）──
export const Config = Schema.object({
  imageModel: Schema.string().default('gpt-image-2.6-1k').description("出图模型；默认 ¥0.03/张"),
  mv: Schema.string().default('chirp-hawk').description("Suno 版本；chirp-hawk = v6"),
  pollMs: Schema.natural().default(10000).description("轮询间隔毫秒"),
  maxPollMs: Schema.natural().default(600000).description("最长等待毫秒"),
  outputDir: Schema.string().default('').description("落盘根目录；留空则 ~/Downloads/dsh-aigc-studio"),
  baseUrl: Schema.string().default('').description("网关地址；留空用默认虾盘云"),
})

/** 给测试和直接 apply 的调用方补默认值。 */
export function resolveConfig(config = {}) {
  return { imageModel: 'gpt-image-2.6-1k', mv: 'chirp-hawk', pollMs: 10000, maxPollMs: 600000, outputDir: '', baseUrl: '', ...(config || {}) }
}

function renderJson(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 1) }] }

function mapSize(size) {
  if (!size) return undefined
  const m = { '1:1': '1024x1024', '3:4': '1024x1536', '4:3': '1536x1024', '9:16': '1024x1536', '16:9': '1536x1024' }
  return m[String(size).trim()] || String(size).trim()
}

export function createDefinitions(ctx, config = {}) {
  const cfg = resolveConfig(config)
  const wallet = createWallet(cfg)
  const root = cfg.outputDir || join(homedir(), 'Downloads', 'dsh-aigc-studio')
  const imageModel = cfg.imageModel || 'gpt-image-2.6-1k'

  const stamp = () => new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)

  return [
    defineTool({
      name: 'dsh_studio_image',
      description: 'Text-to-image. Saves PNGs locally. ¥0.03 per image.',
      parameters: {
        prompt: { type: 'string', required: true, description: 'Image description.' },
        size: { type: 'string', description: 'Pixels or ratio (3:4, 16:9).' },
        n: { type: 'number', description: '1-4 images, default 1.' }
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        try {
          const s = await wallet.ensureKey()
          const body = { model: imageModel, prompt: args.prompt, n: Math.min(Math.max(args.n || 1, 1), 4) }
          const size = mapSize(args.size); if (size) body.size = size
          const r = await fetch(`${wallet.baseUrl}/v1/images/generations`, {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}` },
            body: JSON.stringify(body), signal: AbortSignal.timeout(120000)
          })
          const text = await r.text()
          if (!r.ok) throw new Error(explainHttp(r.status, text))
          const items = JSON.parse(text)?.data || []
          const dir = join(root, 'images'); mkdirSync(dir, { recursive: true })
          const files = []
          for (let i = 0; i < items.length; i++) {
            const it = items[i] || {}
            const p = join(dir, `img-${stamp()}-${i + 1}.png`)
            if (it.b64_json) { writeFileSync(p, Buffer.from(it.b64_json, 'base64')); files.push({ path: p }) }
            else if (it.url) {
              const rr = await fetch(it.url, { signal: AbortSignal.timeout(120000) })
              if (rr.ok) { writeFileSync(p, Buffer.from(await rr.arrayBuffer())); files.push({ path: p }) }
            }
          }
          return { ok: files.length > 0, files, cost: `¥${(0.03 * files.length).toFixed(2)}` }
        } catch (e) { return { ok: false, error: e.message } }
      }
    }),

    defineTool({
      name: 'dsh_studio_song',
      description: 'Generate a song or instrumental from a prompt. Returns 1-2 MP3 files. ¥1.2 per call.',
      parameters: {
        prompt: { type: 'string', required: true, description: 'Song idea / style.' },
        lyrics: { type: 'string', description: 'Optional full lyrics with structure tags.' },
        instrumental: { type: 'boolean', description: 'true = instrumental only.' }
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        try {
          const s = await wallet.ensureKey()
          const body = { prompt: args.prompt }
          if (args.lyrics) body.lyrics = args.lyrics
          else body.mv = cfg.mv || 'chirp-hawk'
          if (args.instrumental) body.make_instrumental = true
          const { taskId, clips } = await runTask({
            baseUrl: wallet.baseUrl, apiKey: s.apiKey, path: '/suno/submit/music', body,
            pollMs: cfg.pollMs || 10000, maxPollMs: cfg.maxPollMs || 600000
          })
          const dir = join(root, 'songs'); mkdirSync(dir, { recursive: true })
          const files = []
          for (let i = 0; i < clips.length; i++) {
            const c = clips[i] || {}; const url = c.audio_url || c.url || ''
            const item = { title: c.title || '', duration: c.duration ?? null }
            if (url) {
              for (let k = 1; k <= 3; k++) {
                try {
                  const r = await fetch(url, { signal: AbortSignal.timeout(180000) })
                  if (r.ok) { const p = join(dir, `song-${stamp()}-${i + 1}.mp3`); writeFileSync(p, Buffer.from(await r.arrayBuffer())); item.path = p; break }
                  item.downloadError = `HTTP ${r.status}`
                } catch (e) { item.downloadError = e.message }
                if (k < 3) await sleep(4000)
              }
            }
            files.push(item)
          }
          return { ok: files.some((f) => f.path), taskId, files, cost: '¥1.2' }
        } catch (e) { return { ok: false, error: e.message } }
      }
    }),

    defineTool({
      name: 'dsh_studio_upload',
      description: 'Upload a reference audio track into Suno and get a clipId back. Only a PUBLIC http(s) audio URL — local file paths are rejected upstream. ¥0.045 per upload.',
      parameters: { url: { type: 'string', required: true, description: 'Public http(s) URL of an mp3/wav. Not a local path.' } },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        try {
          const target = String(args.url || '').trim()
          if (!target) throw new Error('缺少音频地址。只接受公网 http(s) 链接，不接受本地文件。')
          if (!/^https?:\/\//i.test(target)) throw new Error(`必须是 http(s) 开头，收到「${target.slice(0, 80)}」。本地文件请先传到公网。`)
          const s = await wallet.ensureKey()
          const { taskId, clips } = await runTask({
            baseUrl: wallet.baseUrl, apiKey: s.apiKey, path: '/suno/submit/uploads', body: { url: target },
            pollMs: cfg.pollMs || 8000, maxPollMs: cfg.maxPollMs || 300000, needAudio: false
          })
          const c = clips[0] || {}
          return { ok: true, taskId, clipId: c.clip_id || c.id || '', title: c.title || '', duration: c.duration ?? null, audioUrl: c.audio_url || '', cost: '¥0.045' }
        } catch (e) { return { ok: false, error: e.message } }
      }
    }),

    defineTool({
      name: 'dsh_studio_wallet',
      description: 'Inspect the Xiapan Cloud wallet: binding source and balance. Action "adopt" binds an existing sk- key.',
      parameters: {
        action: { type: 'string', enum: ['status', 'balance', 'adopt'], description: 'status (default) | balance | adopt' },
        apiKey: { type: 'string', description: 'Only for action=adopt.' }
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        try { return await walletPayload(wallet, args.action || 'status', args.apiKey) }
        catch (e) { return { ok: false, error: e.message } }
      }
    })
  ]
}

export function apply(ctx, config = {}) {
  for (const d of createDefinitions(ctx, config)) ctx.tools.register(d)
}
