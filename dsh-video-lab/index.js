// dsh-video-lab —— 文生视频：提交 → 轮询 → 下载 MP4
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { createWallet, explainHttp, sleep, walletPayload } from 'dsh-aigc-core'

export const name = 'dsh-video-lab'
export const inject = ['tools']

// ── 配置：Schemastery schema（官方契约要求；禁止普通对象，也不许硬编码可调参数）──
export const Config = Schema.object({
  model: Schema.string().default('doubao-seedance-2-0-mini-260615').description("视频模型；mini ¥2.9 / fast ¥4.9 / full ¥6.9"),
  pollMs: Schema.natural().default(10000).description("轮询间隔毫秒"),
  maxPollMs: Schema.natural().default(900000).description("最长等待毫秒"),
  outputDir: Schema.string().default('').description("落盘目录；留空则 ~/Downloads/dsh-video-lab"),
  baseUrl: Schema.string().default('').description("网关地址；留空用默认虾盘云"),
})

/** 给测试和直接 apply 的调用方补默认值。 */
export function resolveConfig(config = {}) {
  return { model: 'doubao-seedance-2-0-mini-260615', pollMs: 10000, maxPollMs: 900000, outputDir: '', baseUrl: '', ...(config || {}) }
}

const PRICE = { 'doubao-seedance-2-0-mini-260615': 2.9, 'doubao-seedance-2-0-fast-260128': 4.9, 'doubao-seedance-2-0-260128': 6.9 }

function renderJson(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 1) }] }

export function createDefinitions(ctx, config = {}) {
  const cfg = resolveConfig(config)
  const wallet = createWallet(cfg)
  const outDir = cfg.outputDir || join(homedir(), 'Downloads', 'dsh-video-lab')
  const defaultModel = cfg.model || 'doubao-seedance-2-0-mini-260615'

  return [defineTool({
    name: 'dsh_video_create',
    description: 'Generate a short video from a text prompt. Async: submit, poll, download MP4. Price varies by model (mini ¥2.9, fast ¥4.9, full ¥6.9 per clip).',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Video description: subject, motion, camera, mood.' },
      model: { type: 'string', description: 'doubao-seedance-2-0-mini-260615 (default, ¥2.9) | -fast-260128 (¥4.9) | -260128 (¥6.9).' },
      duration: { type: 'number', description: 'Seconds, if the model supports it (usually 5 or 10).' }
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      try {
        const s = await wallet.ensureKey()
        const model = args.model || defaultModel
        const body = { model, prompt: args.prompt }
        if (args.duration) body.duration = args.duration

        const sub = await fetch(`${wallet.baseUrl}/v1/video/generations`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}` },
          body: JSON.stringify(body), signal: AbortSignal.timeout(120000)
        })
        const st = await sub.text()
        if (!sub.ok) throw new Error(explainHttp(sub.status, st))
        const sj = JSON.parse(st)
        const taskId = sj?.task_id || sj?.taskId || sj?.id || sj?.data?.task_id || sj?.data?.id
        if (!taskId) throw new Error(`提交成功但没拿到任务号：${st.slice(0, 200)}`)

        const deadline = Date.now() + (cfg.maxPollMs || 900000)
        let url = '', lastStatus = ''
        while (Date.now() < deadline) {
          await sleep(cfg.pollMs || 10000)
          const r = await fetch(`${wallet.baseUrl}/v1/video/generations/${encodeURIComponent(taskId)}`, {
            headers: { authorization: `Bearer ${s.apiKey}` }, signal: AbortSignal.timeout(30000)
          })
          const t = await r.text()
          if (!r.ok) { if (r.status >= 500) continue; throw new Error(explainHttp(r.status, t)) }
          let v; try { v = JSON.parse(t) } catch { continue }
          const d = v?.data || v
          lastStatus = d?.status || d?.state || ''
          url = d?.url || d?.video_url || d?.output?.url || d?.data?.[0]?.url || ''
          if (/fail|error/i.test(lastStatus)) throw new Error(`生成失败：${d?.fail_reason || d?.error || lastStatus}`)
          if (url && /success|succeed|complete|finished/i.test(lastStatus || 'success')) break
          if (url) break
        }
        if (!url) throw new Error(`轮询超时（任务 ${taskId}，最后状态 ${lastStatus || '未知'}）`)

        mkdirSync(outDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
        const out = join(outDir, `video-${stamp}.mp4`)
        const dl = await fetch(url, { signal: AbortSignal.timeout(300000) })
        if (!dl.ok) throw new Error(`下载失败 HTTP ${dl.status}`)
        writeFileSync(out, Buffer.from(await dl.arrayBuffer()))
        return { ok: true, taskId, path: out, model, cost: `¥${PRICE[model] ?? '?'}` }
      } catch (e) { return { ok: false, error: e.message } }
    }
  })]
}

// 钱包工具：所有包的统一入口，查余额 + 导流虾盘云充值页（不做复杂开户，减少维护面）
function walletTool() {
  const w = createWallet()
  return defineTool({
    name: 'dsh_video_wallet',
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
