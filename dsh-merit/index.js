// dsh-merit —— 功德计数器：AI 干活时敲木鱼，本地记账，不联网不花钱
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-merit'
export const inject = ['tools']

// ── 配置：Schemastery schema（官方契约要求；禁止普通对象，也不许硬编码可调参数）──
export const Config = Schema.object({
  maxKnock: Schema.natural().default(108).description("单次最多敲几下（上限保护）"),
  file: Schema.string().default('').description("账本路径；留空则 ~/.dsh/merit.json"),
})

/** 给测试和直接 apply 的调用方补默认值。 */
export function resolveConfig(config = {}) {
  return { maxKnock: 108, file: '', ...(config || {}) }
}

const FILE = join(homedir(), '.dsh', 'merit.json')
const DAY = new Date().toISOString().slice(0, 10)

function load() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')) } catch { return { total: 0, today: {}, lastAt: null } }
}
function save(v) { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(v, null, 2)) }

function renderJson(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 1) }] }

export function createDefinitions(ctx, config = {}) {
  const cfg = resolveConfig(config)
  return [
    defineTool({
      name: 'dsh_merit_knock',
      description: 'Knock the wooden fish once (or N times) and add to the local merit tally. No network, no billing.',
      parameters: { times: { type: 'number', description: 'How many knocks, default 1.' } },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        const n = Math.min(Math.max(Math.round(args.times || 1), 1), 108)
        const v = load()
        v.total = (v.total || 0) + n
        v.today = v.today || {}
        v.today[DAY] = (v.today[DAY] || 0) + n
        v.lastAt = new Date().toISOString()
        save(v)
        return { ok: true, knocked: n, total: v.total, today: v.today[DAY], knock: '🔔'.repeat(Math.min(n, 10)) }
      }
    }),
    defineTool({
      name: 'dsh_merit_status',
      description: 'Show the local merit tally: total knocks, today, and the last 7 days.',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderJson },
      async execute() {
        const v = load()
        const days = Object.keys(v.today || {}).sort().slice(-7).map((d) => ({ date: d, knocks: v.today[d] }))
        return { ok: true, total: v.total || 0, today: (v.today || {})[DAY] || 0, last7: days, lastAt: v.lastAt }
      }
    })
  ]
}

export function apply(ctx, config = {}) {
  for (const d of createDefinitions(ctx, config)) ctx.tools.register(d)
}
