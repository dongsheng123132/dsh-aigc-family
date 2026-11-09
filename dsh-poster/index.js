// dsh-poster —— 海报 / 封面 / 缩略图：预设画幅 + 留白提示，一次出图
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createWallet, explainHttp, walletPayload } from 'dsh-aigc-core'

export const name = 'dsh-poster'
export const inject = ['tools']

const PRESETS = {
  poster:    { size: '1024x1536', hint: '竖版海报，主体居中偏上，底部留出标题空间' },
  cover:     { size: '1024x1024', hint: '方形封面，视觉主体居中，四周留白便于裁切' },
  thumb:     { size: '1536x1024', hint: '横版缩略图，左侧主体，右侧留文字区' },
  banner:    { size: '1536x1024', hint: '横幅主视觉，主体偏右，左侧大面积留白' },
  wallpaper: { size: '1024x1536', hint: '手机壁纸，竖版，顶部与底部留安全区' }
}

function renderJson(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 1) }] }

export function createDefinitions(ctx, config = {}) {
  const wallet = createWallet(config)
  const outDir = config.outputDir || join(homedir(), 'Downloads', 'dsh-poster')
  const model = config.model || 'gpt-image-2.6-1k'

  return [defineTool({
    name: 'dsh_poster_make',
    description: 'Generate a poster / cover / thumbnail with a print-ready size preset. ¥0.03 per image.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the poster is about (subject, mood, palette).' },
      kind: { type: 'string', enum: Object.keys(PRESETS), description: 'poster (vertical) | cover (square) | thumb (landscape) | banner | wallpaper. Default poster.' },
      text: { type: 'string', description: 'Optional headline text to leave room for (it is NOT rendered, only reserved as blank space).' }
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      try {
        const s = await wallet.ensureKey()
        const p = PRESETS[args.kind] || PRESETS.poster
        const prompt = [args.prompt, p.hint, args.text ? `画面里请留出一块干净区域用于后加标题「${args.text}」，不要直接画出文字。` : ''].filter(Boolean).join('。')
        const r = await fetch(`${wallet.baseUrl}/v1/images/generations`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}` },
          body: JSON.stringify({ model, prompt, size: p.size, n: 1 }), signal: AbortSignal.timeout(120000)
        })
        const t = await r.text()
        if (!r.ok) throw new Error(explainHttp(r.status, t))
        const it = (JSON.parse(t)?.data || [])[0] || {}
        mkdirSync(outDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
        const out = join(outDir, `${args.kind || 'poster'}-${stamp}.png`)
        if (it.b64_json) writeFileSync(out, Buffer.from(it.b64_json, 'base64'))
        else if (it.url) {
          const rr = await fetch(it.url, { signal: AbortSignal.timeout(120000) })
          if (!rr.ok) throw new Error(`下载失败 HTTP ${rr.status}`)
          writeFileSync(out, Buffer.from(await rr.arrayBuffer()))
        } else throw new Error('上游没返回图片数据')
        return { ok: true, path: out, kind: args.kind || 'poster', size: p.size, cost: '¥0.03' }
      } catch (e) { return { ok: false, error: e.message } }
    }
  })]
}

// 钱包工具：所有包的统一入口，查余额 + 导流虾盘云充值页（不做复杂开户，减少维护面）
function walletTool() {
  const w = createWallet()
  return defineTool({
    name: 'dsh_poster_wallet',
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
