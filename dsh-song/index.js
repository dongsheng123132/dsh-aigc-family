// dsh-song —— 一句话出歌：一次提交出 2 首，带人声和歌词
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createWallet, runTask, sleep, walletPayload } from 'dsh-aigc-core'

export const name = 'dsh-song'
export const inject = ['tools']

function renderJson(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 1) }] }

export function createDefinitions(ctx, config = {}) {
  const wallet = createWallet(config)
  const outputDir = config.outputDir || join(homedir(), 'Downloads', 'dsh-song')

  function fail(error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, error: msg }
  }

  return [
    defineTool({
      name: 'dsh_song_create',
      description: 'Generate a song from a prompt (vocals + lyrics), or an instrumental. Submits, polls and downloads; usually returns 2 MP3 variants. ¥1.2 per call from the Xiapan Cloud wallet.',
      parameters: {
        prompt: { type: 'string', required: true, description: 'Song idea or style description. Chinese works.' },
        lyrics: { type: 'string', description: 'Full lyrics with [Verse]/[Chorus] tags; omit to let the model write them.' },
        tags: { type: 'string', description: 'Style tags when supplying lyrics, e.g. "pop, female vocal".' },
        title: { type: 'string', description: 'Track title when supplying lyrics.' },
        instrumental: { type: 'boolean', description: 'true = instrumental only (no vocals).' }
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        try {
          const s = await wallet.ensureKey()
          const body = { prompt: args.prompt }
          if (args.lyrics) {
            body.lyrics = args.lyrics
            if (args.tags) body.tags = args.tags
            if (args.title) body.title = args.title
          } else {
            body.mv = config.mv || 'chirp-hawk' // chirp-hawk = Suno v6（网关实测解析出的就是它）
          }
          if (args.instrumental) body.make_instrumental = true

          const { taskId, clips } = await runTask({
            baseUrl: wallet.baseUrl, apiKey: s.apiKey, path: '/suno/submit/music', body,
            pollMs: config.pollMs || 10000, maxPollMs: config.maxPollMs || 600000
          })

          mkdirSync(outputDir, { recursive: true })
          const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
          const files = []
          for (let i = 0; i < clips.length; i++) {
            const c = clips[i] || {}
            const url = c.audio_url || c.audioUrl || c.url || ''
            const item = { title: c.title || '', duration: c.duration ?? null, audioUrl: url }
            if (url) {
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  const r = await fetch(url, { signal: AbortSignal.timeout(180000) })
                  if (r.ok) {
                    const p = join(outputDir, `song-${stamp}-${i + 1}.mp3`)
                    writeFileSync(p, Buffer.from(await r.arrayBuffer()))
                    item.path = p
                    break
                  }
                  item.downloadError = `HTTP ${r.status}`
                } catch (e) { item.downloadError = e.message }
                if (attempt < 3) await sleep(4000)
              }
            }
            files.push(item)
          }
          return { ok: files.some((f) => f.path), taskId, count: files.length, files, outputDir, cost: '¥1.2（一次两首）' }
        } catch (error) { return fail(error) }
      }
    })
  ]
}

// 钱包工具：所有包的统一入口，查余额 + 导流虾盘云充值页（不做复杂开户，减少维护面）
function walletTool() {
  const w = createWallet()
  return defineTool({
    name: 'dsh_song_wallet',
    description: 'Inspect or bind your Xiapan Cloud wallet: balance plus the top-up link. Every generation in this plugin is billed per use from that wallet. Action "adopt" binds an existing sk- key.',
    parameters: {
      action: { type: 'string', enum: ['status', 'balance', 'adopt'], description: 'status (default) | balance (needs the key) | adopt (paste an existing sk- key).' },
      apiKey: { type: 'string', description: 'Only for action=adopt: the sk-… key.' }
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      try { return await walletPayload(w, args.action || 'status', args.apiKey) }
      catch (e) { return { ok: false, error: e.message } }
    }
  })
}

export function apply(ctx, config = {}) {
  for (const d of createDefinitions(ctx, config)) ctx.tools.register(d)
  ctx.tools.register(walletTool())
}
