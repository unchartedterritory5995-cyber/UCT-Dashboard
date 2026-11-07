// UCT Agent AUTOTEST: no Chrome profile outlives its run. cdp.mjs removes every profile this process made on close, exit, signal
// and crash. A HARD kill (TerminateProcess, a closed console, a power-cut) runs no handler at all, so each run also marks its profile
// with its owner pid, and the next run reaps any marked profile whose owner is gone: its stray Chrome tree first, then the folder.
// An unmarked profile, or one whose owner is alive, is never touched (a peer session may be using it).
import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { spawnSync } from 'node:child_process'

// the mark sits BESIDE the profile, not in it: an exit sweep that deleted half the profile (Chrome still writing) must not delete the mark
export const MARK_PREFIX = 'uct-autotest-owner-'
const markOf = (dir) => join(dirname(dir), `${MARK_PREFIX}${basename(dir)}.json`)
export const PREFIXES = ['uct-cdp-run-', 'econ-ui-cdp-']
const claimed = new Set()

export const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

/** Mark a profile as this process's. → the same dir. */
export function claimProfile(dir) {
  writeFileSync(markOf(dir), JSON.stringify({ pid: process.pid, dir, started: new Date().toISOString() }))
  claimed.add(dir)
  armMarks()
  return dir
}

/** Kill every Chrome process whose --user-data-dir is `dir`. Only a profile this rig marked ever gets here. */
export function killChromeOn(dir) {
  if (process.platform !== 'win32') return
  const needle = dir.replace(/'/g, "''")
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
  { stdio: 'ignore', timeout: 20000 })
}

/** Marked profiles in `root` whose owner process is gone. → [{ dir, mark }] */
export function orphans(root = tmpdir()) {
  const out = []
  let names = []
  try { names = readdirSync(root) } catch { return out }
  for (const n of names) {
    if (!n.startsWith(MARK_PREFIX)) continue
    const mark = join(root, n)
    let m = null
    try { m = JSON.parse(readFileSync(mark, 'utf8')) } catch { continue }
    const dir = join(root, n.slice(MARK_PREFIX.length).replace(/\.json$/, ''))
    if (!PREFIXES.some(p => basename(dir).startsWith(p))) continue
    if (m?.pid && m.pid !== process.pid && !alive(m.pid)) out.push({ dir, mark })
  }
  return out
}

/** Remove orphaned marked profiles, and the marks of runs that cleaned up after themselves. → the profile dirs removed. */
export function reapOrphans(root = tmpdir()) {
  const gone = []
  for (const { dir, mark } of orphans(root)) {
    if (existsSync(dir)) {
      killChromeOn(dir)
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 }) } catch { /* still locked: the next run retries */ }
      if (!existsSync(dir)) gone.push(dir)
    }
    if (!existsSync(dir)) try { rmSync(mark, { force: true }) } catch { /* */ }
  }
  return gone
}

/** This process's own marks go at exit once their profile is gone (cdp.mjs's sweep runs first: it armed first). */
let armed = false
function armMarks() {
  if (armed) return
  armed = true
  process.on('exit', () => { for (const d of claimed) if (!existsSync(d)) try { rmSync(markOf(d), { force: true }) } catch { /* */ } })
}

/** Profiles this process claimed that still exist (call after cleanup ran: anything listed leaked). */
export const leaked = () => [...claimed].filter(d => existsSync(d))

/** Every profile-shaped folder in `root` and its size class, for a before/after proof. */
export function census(root = tmpdir()) {
  let names = []
  try { names = readdirSync(root) } catch { return [] }
  return names.filter(n => PREFIXES.some(p => n.startsWith(p))).filter(n => { try { return statSync(join(root, n)).isDirectory() } catch { return false } })
}
