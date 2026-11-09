// dsh-t2i —— text-to-image：一句描述出图，落本地
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createWallet, explainHttp, walletPayload } from 'dsh-aigc-core'

export const name = 'dsh-t2i'
export const inject = ['tools']

function renderJson(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 1) }] }

function mapSize(size) {
  if (!size) return undefined
  const ratios = { '1:1': '1024x1024', '3:4': '1024x1536', '4:3': '1536x1024', '9:16': '1024x1536', '16:9': '1536x1024' }
  return ratios[String(size).trim()] || String(size).trim()
}

export function createDefinitions(ctx, config = {}) {
  const wallet = createWallet(config)
  const outputDir = config.outputDir || join(homedir(), 'Downloads', 'dsh-t2i')
  const model = config.model || 'gpt-image-2.6-1k' // ¥0.03/张，实测默认档

  return [
    defineTool({
      name: 'dsh_t2i_generate',
      description: 'Generate image(s) from a text prompt and save them locally. Accepts pixel sizes (1024x1536) or ratios (3:4). ¥0.03 per image from the Xiapan Cloud wallet.',
      parameters: {
        prompt: { type: 'string', required: true, description: 'Image description. Chinese works; English is steadier for photoreal detail.' },
        size: { type: 'string', description: 'Pixels like 1024x1024 / 1024x1536, or ratio strings 1:1 3:4 16:9; default auto.' },
        n: { type: 'number', description: 'How many images, 1-4 (default 1).' }
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        try {
          const s = await wallet.ensureKey()
          const body = { model, prompt: args.prompt, n: Math.min(Math.max(args.n || 1, 1), 4) }
          const size = mapSize(args.size)
          if (size) body.size = size

          const r = await fetch(`${wallet.baseUrl}/v1/images/generations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120000)
          })
          const text = await r.text()
          if (!r.ok) throw new Error(explainHttp(r.status, text))
          const json = JSON.parse(text)
          const items = json?.data || []

          mkdirSync(outputDir, { recursive: true })
          const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
          const files = []
          for (let i = 0; i < items.length; i++) {
            const it = items[i] || {}
            const p = join(outputDir, `t2i-${stamp}-${i + 1}.png`)
            if (it.b64_json) { writeFileSync(p, Buffer.from(it.b64_json, 'base64')); files.push({ path: p, revisedPrompt: it.revised_prompt }) }
            else if (it.url) {
              const rr = await fetch(it.url, { signal: AbortSignal.timeout(120000) })
              if (rr.ok) { writeFileSync(p, Buffer.from(await rr.arrayBuffer())); files.push({ path: p, url: it.url, revisedPrompt: it.revised_prompt }) }
              else files.push({ error: `下载失败 HTTP ${rr.status}`, url: it.url })
            }
          }
          return { ok: files.some((f) => f.path), count: files.length, files, outputDir, model, cost: `¥${(0.03 * files.length).toFixed(2)}` }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      }
    })
  ]
}

// 钱包工具：所有包的统一入口，查余额 + 导流虾盘云充值页（不做复杂开户，减少维护面）
function walletTool() {
  const w = createWallet()
  return defineTool({
    name: 'dsh_t2i_wallet',
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
