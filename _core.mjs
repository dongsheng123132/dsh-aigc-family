// 名池共用内核：读钱包 + 调虾盘云网关 + 把上游错误翻成人话。
// 每个插件包各带一份（跨包 import 会让包必须依赖另一个包，发布更脆）。
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_BASE = 'https://api.u-claw.org.cn'

export function createWallet(config = {}) {
  const baseUrl = String(config.baseUrl || process.env.UCLAW_API_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
  const file = config.walletFile || join(homedir(), '.dsh', 'aigc-wallet.json')
  const read = () => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} } }
  const write = (v) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, JSON.stringify(v, null, 2)) }
  async function ensureKey() {
    const envKey = process.env.XIAPAN_API_KEY
    if (envKey && /^sk-/.test(envKey)) return { apiKey: envKey, source: 'env' }
    const j = read()
    if (j.apiKey && /^sk-/.test(j.apiKey)) return { apiKey: j.apiKey, source: 'wallet', rechargeUrl: j.rechargeUrl || '' }
    const uking = join(homedir(), '.uking', 'device.json')
    if (existsSync(uking)) {
      try {
        const k = JSON.parse(readFileSync(uking, 'utf8')).key
        if (k && /^sk-/.test(k)) return { apiKey: k, source: 'uking' }
      } catch {}
    }
    throw new Error('还没有钱包密钥。三种补法：①设置环境变量 XIAPAN_API_KEY ②装 dsh-aigc 并用它的 wallet 工具开户 ③把密钥写进 ~/.dsh/aigc-wallet.json 的 apiKey 字段。')
  }
  function adopt(apiKey) { const j = read(); write({ ...j, apiKey: String(apiKey).trim() }) }
  async function balance(apiKey) {
    const r = await fetch(`${baseUrl}/api/usage/token/`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20000) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, status: r.status, error: j?.error?.message || j?.message || '查询失败' }
    const q = j?.data?.total_available
    return { ok: true, quota: q, yuan: typeof q === 'number' ? +(q / 500000).toFixed(4) : null, name: j?.data?.name }
  }
  return { baseUrl, ensureKey, adopt, balance, read, write }
}

// 上游报错翻人话：403 模型无权限 ≠ 密钥失效 ≠ 余额不足（2026-11-09 血泪教训）
export function explainHttp(status, text) {
  const t = text || ''
  if (/no access to model|permission[_\s-]*denied/i.test(t)) return `这个模型没给这把密钥开权限（HTTP ${status}）：${t.slice(0, 160)}。不是密钥失效、也不用充值——把模型名发给客服加进白名单。`
  if (/quota|insufficient|余额|欠费/i.test(t)) return `余额不足（HTTP ${status}）。先充值再重试。`
  if (/unauthorized|invalid.*(api[_\s-]*key|token)|\b401\b|鉴权|令牌/i.test(t)) return `凭证无效或已失效（HTTP ${status}）。先查余额：余额为 0 或负数时上游同样报 Invalid token。`
  if (/model.*not.*found|无可用渠道|模型不存在/i.test(t)) return `模型不可用（HTTP ${status}）：${t.slice(0, 160)}`
  return `上游失败（HTTP ${status}）：${t.slice(0, 240)}`
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

export function taskIdOf(p) {
  for (const c of [p?.task_id, p?.taskId, p?.id, p?.data, p?.data?.task_id, p?.data?.id, p?.data?.data?.task_id, p?.data?.data?.id]) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return ''
}

const OK_WORDS = /^(complete|completed|success|succeeded|finished|done)$/i
const BAD_WORDS = /^(fail|failed|error|cancelled|canceled|rejected)$/i

export function readTask(v) {
  const d = v?.data ?? v
  const list = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : []
  const first = list[0] || {}
  const statuses = [first.status, first.state, d?.status, d?.state, v?.status].filter((x) => typeof x === 'string')
  const codeOk = typeof v?.code === 'string' && OK_WORDS.test(v.code)
  const state = statuses.some((s) => BAD_WORDS.test(s)) ? 'failed'
    : list.length && (statuses.length === 0 || statuses.some((s) => OK_WORDS.test(s)) || codeOk) ? 'completed'
      : 'pending'
  return { state, clips: list, reason: first?.fail_reason || d?.fail_reason || d?.reason || d?.error || '', progress: d?.progress || '', taskStatus: statuses[0] || '' }
}

// 提交异步任务 → 轮询 → 拿到 clips（Suno 系：music / lyrics / uploads / concat 都走这套）
export async function runTask({ baseUrl, apiKey, path, body, pollMs = 10000, maxPollMs = 600000, needAudio = true, timeoutMs = 60000 }) {
  const submit = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  const submitText = await submit.text()
  if (!submit.ok) throw new Error(explainHttp(submit.status, submitText))
  let submitJson
  try { submitJson = JSON.parse(submitText) } catch { throw new Error(`提交返回非 JSON：${submitText.slice(0, 200)}`) }
  const taskId = taskIdOf(submitJson)
  if (!taskId) throw new Error(`提交成功但没拿到任务号：${submitText.slice(0, 200)}`)

  const deadline = Date.now() + maxPollMs
  let last = { state: 'pending', clips: [], progress: '' }
  while (Date.now() < deadline) {
    await sleep(pollMs)
    const r = await fetch(`${baseUrl}/suno/fetch/${encodeURIComponent(taskId)}`, {
      headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30000)
    })
    const t = await r.text()
    if (!r.ok) { if (r.status >= 500) continue; throw new Error(explainHttp(r.status, t)) }
    let v; try { v = JSON.parse(t) } catch { continue }
    last = readTask(v)
    if (last.state === 'failed') throw new Error(`任务失败：${last.reason || last.taskStatus || '上游未给原因'}`)
    if (last.state === 'completed' && (!needAudio || last.clips.some((c) => c.audio_url || c.url))) break
  }
  if (last.state !== 'completed') throw new Error(`轮询超时（任务 ${taskId} 仍在处理，可稍后用任务号继续查）`)
  return { taskId, clips: last.clips }
}
