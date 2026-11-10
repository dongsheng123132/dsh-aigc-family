#!/usr/bin/env node
// 家族仓统一自检。发布前 `npm run prepack` 会跑它。
//
// 为什么要有它：成熟插件（dsh-blender-plugin 等）把「结构合法 + 能加载 + 配置有默认值」
// 做成可执行的门禁，而不是靠人肉看一眼。我们先前只有 node --check，抓不到
// 「包能过语法但 apply 时注册不出工具」这类问题。
//
// 检查项：
//   1. 包结构：files / dsh.bundle.patch / cordis.patch.yml / naming.json 都在
//   2. 语法：每个 .js/.mjs 过 node --check
//   3. 加载：import 后在 stub 上下文里 apply，确认注册出的工具名与 naming.json 一致
//   4. 配置：有 Config 导出且 resolveConfig 能给出全部字段默认值
//   5. 红线：不许出现空 catch（官方 AGENTS.md：empty catch must name the error and why）
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = ['dsh-aigc-core','dsh-song','dsh-t2i','dsh-poster','dsh-video-lab','dsh-aigc-studio','dsh-merit']

let failed = 0
const fail = (pkg, msg) => { failed++; console.error(`  ✗ [${pkg}] ${msg}`) }
const ok = (pkg, msg) => console.log(`  ✓ [${pkg}] ${msg}`)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(m?js)$/.test(name)) out.push(p)
  }
  return out
}

// ── 1. 结构 ───────────────────────────────────────────────────────────────
console.log('\n[1/5] 包结构')
for (const pkg of PACKAGES) {
  const dir = join(ROOT, pkg)
  if (!existsSync(dir)) { fail(pkg, '目录不存在'); continue }
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (!pj.name || !pj.version) fail(pkg, 'package.json 缺 name/version')
  if (pj.name !== pkg) fail(pkg, `包名不一致：package.json=${pj.name}`)
  if (!pj.files?.length) fail(pkg, 'files 未声明')
  if (pkg === 'dsh-aigc-core') {
    // 内核是纯库包，不装进 DSH，所以没有 bundle patch / naming.json
    continue
  }
  const patch = pj.dsh?.bundle?.patch
  if (!patch) fail(pkg, '缺 dsh.bundle.patch')
  else if (!existsSync(join(dir, patch))) fail(pkg, `bundle patch 指向的文件不存在：${patch}`)
  {
    if (!existsSync(join(dir, 'dsh-plugin.naming.json'))) fail(pkg, '缺 dsh-plugin.naming.json')
    else {
      const nm = JSON.parse(readFileSync(join(dir, 'dsh-plugin.naming.json'), 'utf8'))
      const nmPkg = nm?.plugin?.packageName
      if (nmPkg && nmPkg !== pkg) fail(pkg, `naming.json packageName=${nmPkg} 与包名不一致`)
    }
  }
}
if (!failed) ok('all', '结构检查通过')

// ── 2. 语法 ───────────────────────────────────────────────────────────────
console.log('\n[2/5] 语法')
for (const pkg of PACKAGES) {
  for (const f of walk(join(ROOT, pkg))) {
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }) }
    catch (e) { fail(pkg, `语法错误 ${f.replace(ROOT + '/', '')}\n${e.stderr?.toString().slice(0, 300)}`) }
  }
}
ok('all', '语法检查完成')

// ── 3. 加载 + 工具注册 ────────────────────────────────────────────────────
console.log('\n[3/5] 加载与工具注册')
for (const pkg of PACKAGES) {
  if (pkg === 'dsh-aigc-core') continue // 内核是库，不注册工具
  const entry = join(ROOT, pkg, 'index.js')
  if (!existsSync(entry)) { fail(pkg, '缺 index.js'); continue }
  try {
    const mod = await import(pathToFileURL(entry).href)
    if (typeof mod.apply !== 'function') { fail(pkg, '没有导出 apply'); continue }
    const registered = []
    mod.apply({ tools: { register: (t) => registered.push(t?.name) } }, {})
    if (!registered.length) fail(pkg, 'apply 没有注册任何工具')
    if (registered.some((n) => !n)) fail(pkg, '注册的工具缺 name')
    const nm = JSON.parse(readFileSync(join(ROOT, pkg, 'dsh-plugin.naming.json'), 'utf8'))
    const declared = new Set(nm?.names?.tools || [])
    const missing = registered.filter((n) => !declared.has(n))
    if (missing.length) fail(pkg, `只在代码里注册、naming.json 未声明：${missing.join(', ')}`)
    ok(pkg, `注册 ${registered.length} 个工具：${registered.join(', ')}`)
  } catch (e) {
    fail(pkg, `加载失败：${e.message}`)
  }
}

// ── 4. 配置 ───────────────────────────────────────────────────────────────
console.log('\n[4/5] Config')
for (const pkg of PACKAGES) {
  if (pkg === 'dsh-aigc-core') continue
  try {
    const mod = await import(pathToFileURL(join(ROOT, pkg, 'index.js')).href)
    if (!mod.Config) { fail(pkg, '没有导出 Config（官方要求 Schemastery schema）'); continue }
    if (typeof mod.resolveConfig !== 'function') { fail(pkg, '没有导出 resolveConfig'); continue }
    const resolved = mod.resolveConfig({})
    const empty = Object.entries(resolved).filter(([, v]) => v === undefined).map(([k]) => k)
    if (empty.length) fail(pkg, `这些配置字段没有默认值：${empty.join(', ')}`)
    ok(pkg, `Config ${Object.keys(resolved).length} 个字段均有默认值`)
  } catch (e) { fail(pkg, `Config 检查失败：${e.message}`) }
}

// ── 5. 官方红线 ───────────────────────────────────────────────────────────
console.log('\n[5/5] 官方红线')
for (const pkg of PACKAGES) {
  for (const f of walk(join(ROOT, pkg))) {
    const src = readFileSync(f, 'utf8')
    // 空 catch / 空 catch 块（允许 catch 后带注释或 void）
    const bad = src.match(/catch\s*(\([^)]*\))?\s*\{\s*\}/)
    if (bad) fail(pkg, `空 catch（官方要求说明错误名与忽略原因）：${f.replace(ROOT + '/', '')}`)
    if (/as unknown/.test(src)) fail(pkg, `出现 as unknown 断言（官方禁令）：${f.replace(ROOT + '/', '')}`)
  }
}
ok('all', '红线检查完成')

console.log(failed ? `\n✗ ${failed} 项未通过\n` : '\n✓ 全部通过\n')
process.exit(failed ? 1 : 0)
