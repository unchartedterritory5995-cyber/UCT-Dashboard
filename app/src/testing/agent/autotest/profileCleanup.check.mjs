// UCT Agent AUTOTEST self-check: no Chrome temp profile outlives a run, however the run ends. LOCAL, free, at most one Chrome at a time.
//
//   node src/testing/agent/autotest/profileCleanup.check.mjs [reps]   (from app/; exit 0 = every case left nothing behind)
//
// Cases: a normal exit (with Chrome still open: cdp.mjs's own exit sweep must remove the profile, not the next run's reaper), an uncaught crash, a per-launch profile closed by the rig, and a HARD kill of the node process (no handler
// can run): the hard kill leaves the profile and its Chrome, and the next run's reapOrphans() must remove both.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reapOrphans, census, PREFIXES, MARK_PREFIX, freeProfile, claimProfile } from './profileGuard.mjs'
import { runProfile, launch } from '../../../econHarness/cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const chromeOn = (dir) => {
  if (process.platform !== 'win32') return 0
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${dir.replace(/'/g, "''")}') }).Count`], { encoding: 'utf8' })
  return Number(String(r.stdout).trim()) || 0
}
const newDirs = (before) => census().filter(n => !before.includes(n))
const marks = () => readdirSync(tmpdir()).filter(n => n.startsWith(MARK_PREFIX))

function child(how) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [join(here, 'profileChild.mjs'), how], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = '', info = null
    c.stdout.on('data', (d) => { out += d; const m = /\{.*"pid".*\}/.exec(out); if (m && !info) { info = JSON.parse(m[0]); if (how === 'hang') resolve({ c, info }) } })
    c.stderr.on('data', (d) => { err += d })
    c.on('exit', (code) => resolve({ c, info, code, err }))
  })
}

const results = []
const before = census()
console.log(`[profile-check] tmpdir ${tmpdir()}; profile-shaped folders before: ${before.length}`)
const REPS = Number(process.argv[2] || 2)
for (const how of ['exit', 'crash', 'own']) for (let i = 0; i < REPS; i++) {
  const r = await child(how)
  await sleep(500)
  const goneByOwnSweep = r.info?.profile ? !existsSync(r.info.profile) : newDirs(before).length === 0
  const reaped = reapOrphans()
  await sleep(300)
  const left = newDirs(before)
  const dirGone = r.info?.profile ? !existsSync(r.info.profile) : true
  results.push({ case: how, exitCode: r.code, profileReported: !!r.info, goneByOwnSweep, reapedNext: reaped.length, dirGone, newProfileFolders: left.length, marksLeft: marks().length, pass: !!r.info && goneByOwnSweep && dirGone && left.length === 0 && marks().length === 0 })
}
{
  const r = await child('hang')
  // a hard kill of node alone: TerminateProcess, no exit handler runs, Chrome is orphaned holding the profile
  spawnSync('taskkill', ['/PID', String(r.info.pid), '/F'], { stdio: 'ignore' })
  await sleep(1500)
  const strandedDir = existsSync(r.info.profile), strandedChrome = chromeOn(r.info.profile)
  const reaped = reapOrphans()
  await sleep(500)
  const left = newDirs(before)
  results.push({ case: 'hard-kill then reap', strandedDir, strandedChrome, reaped: reaped.length, dirGone: !existsSync(r.info.profile), chromeLeft: chromeOn(r.info.profile), newProfileFolders: left.length, pass: strandedDir && reaped.includes(r.info.profile) && !existsSync(r.info.profile) && chromeOn(r.info.profile) === 0 && left.length === 0, marksLeft: marks().length })
}
{
  // a hung request whose page object is lost: its Chrome still holds the shared run profile. freeProfile must kill it, and the
  // next launch on the same profile must come up (it used to fail with "chrome did not come up")
  const prof = claimProfile(runProfile())
  const stuck = await launch({ width: 400, height: 300, profile: prof })
  await stuck.evaluate('1')
  const held = chromeOn(prof)
  const killed = await freeProfile(prof)
  const heldAfter = chromeOn(prof)
  let relaunched = false
  try { const again = await launch({ width: 400, height: 300, profile: prof }); relaunched = (await again.evaluate('1 + 1')) === 2; await again.close() } catch { /* */ }
  rmSync(prof, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 })
  results.push({ case: 'hung page frees the shared profile', held, killed, heldAfter, relaunched, pass: held > 0 && heldAfter === 0 && relaunched })
}
const after = census()
const sweepMisses = results.filter(r => r.goneByOwnSweep === false).map(r => r.case)
if (sweepMisses.length) console.log(`[profile-check] NOTE cdp.mjs's own exit sweep left a profile in: ${sweepMisses.join(', ')} (the next run's reaper removed it)`)
for (const r of results) console.log(`[profile-check] ${r.pass ? 'PASS' : 'FAIL'} ${JSON.stringify(r)}`)
console.log(`[profile-check] profile-shaped folders after: ${after.length} (before ${before.length}); prefixes ${PREFIXES.join(', ')}`)
process.exit(results.every(r => r.pass) && after.length <= before.length ? 0 : 1)
