// tools/vendor_harness/proc_tree_memory.mjs
//
// ─── HOW MUCH RAM A PROCESS TREE HELD, MEASURED WHILE IT RAN ─────────────────
//
// `parallel_run.mjs` picks how many shard processes to launch from the free RAM
// and the RAM ONE shard needs. That second number is MEASURED here, never
// guessed: every shard is a `node vitest.mjs` process whose grading happens in a
// forked worker (a child of a child), so the sampler sums the working set of
// each root pid AND every descendant, once per tick, and keeps the peak.
//
//   Windows   one long-lived PowerShell loop over Win32_Process
//             (ProcessId, ParentProcessId, WorkingSetSize), killed on stop()
//   elsewhere `ps -A -o pid=,ppid=,rss=` once per tick
//
// It only READS the process table. It never signals a process it did not start
// (the one it does start, the PowerShell sampler, is killed on stop()).
//
// CLI (measures one command, prints the peak; used to seed a footprint):
//   node tools/vendor_harness/proc_tree_memory.mjs -- <cmd> [args...]

import { spawn, execFile } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const GB = 2 ** 30

const PS_LOOP = (ms) => [
  "$ErrorActionPreference='SilentlyContinue'",
  'while ($true) {',
  '  $s = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize',
  '  $b = New-Object System.Text.StringBuilder',
  '  foreach ($p in $s) { [void]$b.Append("$($p.ProcessId) $($p.ParentProcessId) $($p.WorkingSetSize)`n") }',
  '  [void]$b.Append("--`n")',
  '  [Console]::Out.Write($b.ToString()); [Console]::Out.Flush()',
  `  Start-Sleep -Milliseconds ${ms}`,
  '}',
].join('\n')

/** Sum of bytes over `root` and every descendant, in one snapshot. */
export function treeBytes(rows, root) {
  const kids = new Map()
  const bytes = new Map()
  for (const { pid, ppid, rss } of rows) {
    bytes.set(pid, rss)
    if (pid === ppid) continue
    if (!kids.has(ppid)) kids.set(ppid, [])
    kids.get(ppid).push(pid)
  }
  if (!bytes.has(root)) return 0
  let total = 0
  const seen = new Set()
  const stack = [root]
  while (stack.length) {
    const p = stack.pop()
    if (seen.has(p)) continue
    seen.add(p)
    total += bytes.get(p) || 0
    for (const c of kids.get(p) || []) stack.push(c)
  }
  return total
}

function parseRows(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/)
    if (m) rows.push({ pid: +m[1], ppid: +m[2], rss: +m[3] })
  }
  return rows
}

/**
 * Start sampling. `roots()` is asked every tick, so pids may be added as shards start.
 * @param {() => number[]} roots
 * @returns {{ stop: () => Promise<{peakByRoot: Map<number, number>, peakTotal: number, ticks: number}> }}
 */
export function startTreeSampler(roots, { intervalMs = 2000 } = {}) {
  const peakByRoot = new Map()
  let peakTotal = 0
  let ticks = 0
  const onSnapshot = (rows) => {
    ticks += 1
    let total = 0
    for (const r of roots()) {
      const b = treeBytes(rows, r)
      total += b
      if (b > (peakByRoot.get(r) || 0)) peakByRoot.set(r, b)
    }
    if (total > peakTotal) peakTotal = total
  }
  let stopFn
  if (process.platform === 'win32') {
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_LOOP(intervalMs)],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    let buf = ''
    ps.stdout.setEncoding('utf8')
    ps.stdout.on('data', (d) => {
      buf += d; if (process.env.PTM_DEBUG) process.stderr.write('RAW ' + JSON.stringify(String(d).slice(0, 120)) + '\n')
      let i
      while ((i = buf.indexOf('--\n')) !== -1 || (i = buf.indexOf('--\r\n')) !== -1) {
        const chunk = buf.slice(0, i)
        buf = buf.slice(buf.indexOf('\n', i) + 1)
        onSnapshot(parseRows(chunk))
      }
    })
    stopFn = () => new Promise((resolve) => {
      if (ps.exitCode !== null) return resolve()
      ps.once('exit', () => resolve())
      ps.kill()
    })
  } else {
    let live = true
    const tick = () => {
      if (!live) return
      execFile('ps', ['-A', '-o', 'pid=,ppid=,rss='], (err, out) => {
        if (!err) onSnapshot(parseRows(out).map((r) => ({ ...r, rss: r.rss * 1024 })))
        if (live) setTimeout(tick, intervalMs)
      })
    }
    tick()
    stopFn = async () => { live = false }
  }
  return {
    stop: async () => {
      await stopFn()
      return { peakByRoot, peakTotal, ticks }
    },
  }
}

export const toGB = (b) => b / GB

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--')
  if (at === -1 || at === process.argv.length - 1) {
    console.error('usage: node proc_tree_memory.mjs -- <cmd> [args...]')
    process.exit(2)
  }
  const [cmd, ...args] = process.argv.slice(at + 1)
  const t0 = Date.now()
  const child = spawn(cmd, args, { stdio: 'inherit' })
  const sampler = startTreeSampler(() => [child.pid])
  child.on('exit', async (code) => {
    const { peakTotal, ticks } = await sampler.stop()
    console.error(`[proc_tree_memory] peak ${toGB(peakTotal).toFixed(2)} GB over ${ticks} samples, `
      + `wall ${((Date.now() - t0) / 1000).toFixed(1)} s, exit ${code}`)
    process.exit(code === null ? 1 : code)
  })
}
