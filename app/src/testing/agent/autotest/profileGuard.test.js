// The reaper removes only what a dead run of this rig provably left behind. No Chrome here: profileCleanup.check.mjs drives real ones.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { orphans, reapOrphans, MARK_PREFIX, claimProfile, leaked } from './profileGuard.mjs'

const deadPid = () => spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout.trim()
const mk = (root, name, pid) => {
  const d = join(root, name)
  mkdirSync(join(d, 'Default'), { recursive: true })
  writeFileSync(join(d, 'Default', 'Preferences'), '{}')
  if (pid !== undefined) writeFileSync(join(root, `${MARK_PREFIX}${name}.json`), JSON.stringify({ pid: Number(pid), dir: d }))
  return d
}

describe('profileGuard', () => {
  it('reaps a dead owner\'s profile and its mark, and nothing else', () => {
    const root = mkdtempSync(join(tmpdir(), 'pg-test-'))
    try {
      const dead = mk(root, 'uct-cdp-run-dead', deadPid())
      const live = mk(root, 'uct-cdp-run-live', process.ppid)          // a live owner: a peer's run in progress
      const unmarked = mk(root, 'econ-ui-cdp-peer')                     // no mark: not provably ours
      const other = mk(root, 'something-else', deadPid())               // a mark on a name outside the prefixes
      expect(orphans(root).map(o => o.dir)).toEqual([dead])
      expect(reapOrphans(root)).toEqual([dead])
      expect(existsSync(dead)).toBe(false)
      expect(existsSync(join(root, `${MARK_PREFIX}uct-cdp-run-dead.json`))).toBe(false)
      for (const d of [live, unmarked, other]) expect(existsSync(d)).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('a half-deleted profile is still found: the mark sits beside it, not in it', () => {
    const root = mkdtempSync(join(tmpdir(), 'pg-test-'))
    try {
      const d = mk(root, 'uct-cdp-run-half', deadPid())
      rmSync(join(d, 'Default'), { recursive: true, force: true })
      expect(reapOrphans(root)).toEqual([d])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('a claimed profile still on disk is reported as leaked', () => {
    const root = mkdtempSync(join(tmpdir(), 'pg-test-'))
    try {
      const d = mk(root, 'uct-cdp-run-mine')
      claimProfile(d)
      expect(leaked()).toContain(d)
      rmSync(d, { recursive: true, force: true })
      expect(leaked()).not.toContain(d)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
