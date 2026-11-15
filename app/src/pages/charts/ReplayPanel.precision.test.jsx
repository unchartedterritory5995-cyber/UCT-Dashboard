// D20 · AUDIT ruling 2 and persistence: the Replay dialog keeps a PRECISE cutoff (it shows the time; "Update" with the date
// unchanged writes it back exactly; a new date is the member's explicit day-only choice), and a precise cutoff round-trips
// through Custom-Period Sort's restore and is never truncated by the workspace.
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ReplayPanel from './ReplayPanel'
import { periodSortKind } from '../../agent/capabilities/periodSort'

afterEach(() => cleanup())
const PRECISE = '2026-03-10T10:05-04:00'

describe('ReplayPanel keeps a precise cutoff', () => {
  it('shows the time of a precise cutoff; a day-only one shows no time row', () => {
    render(<ReplayPanel active cutoff={PRECISE} onStart={() => {}} onExit={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('replay-cutoff-time').textContent).toMatch(/10:05 ET \(stepped by bars\)/)
    expect(screen.getByLabelText('Replay to').value).toBe('2026-03-10')
    cleanup()
    render(<ReplayPanel active cutoff="2026-03-10" onStart={() => {}} onExit={() => {}} onClose={() => {}} />)
    expect(screen.queryByTestId('replay-cutoff-time')).toBeNull()
  })
  it('"Update" with the date unchanged writes the PRECISE value back exactly', () => {
    const onStart = vi.fn()
    render(<ReplayPanel active cutoff={PRECISE} onStart={onStart} onExit={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Update'))
    expect(onStart).toHaveBeenCalledWith(PRECISE, 'D')
  })
  it('a NEW date is the member\'s explicit choice: day-only', () => {
    const onStart = vi.fn()
    render(<ReplayPanel active cutoff={PRECISE} onStart={onStart} onExit={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Replay to'), { target: { value: '2026-03-12' } })
    expect(screen.getByTestId('replay-cutoff-time').textContent).toMatch(/end of day/)
    fireEvent.click(screen.getByText('Update'))
    expect(onStart).toHaveBeenCalledWith('2026-03-12', 'D')
  })
})

describe('persistence: a precise cutoff round-trips', () => {
  it('Custom-Period Sort\'s Undo restores the cutoff EXACTLY as it was (precise included)', () => {
    const before = { panel: null, cutoff: PRECISE, marker: null, markerStyle: 'line', widgets: [] }
    const item = { before, patch: { run: { start: 20260101, end: 20260130 }, set: { cutoff: '2026-01-30' } }, after: { ...before, cutoff: '2026-01-30' } }
    const back = periodSortKind.undoPatch(item)
    expect(back.restore.cutoff).toBe(PRECISE)
  })
  it('the workspace passes every cutoff through untouched (restore, the Agent door, the dialog) and saves none of it', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const ws = readFileSync(resolve(here, 'ChartsWorkspace.jsx'), 'utf8')
    // the CPS restore and the Agent's Replay door hand the value on as-is (no day truncation anywhere)
    expect(ws).toMatch(/setReplayCutoff\(was\.cutoff \?\? null\)/)
    expect(ws).toMatch(/set: \(iso\) => \{ const r = agentReplayRef\.current; if \(!r\) return; if \(iso\) r\.start\(iso, null\); else r\.exit\(\) \}/)
    expect(ws).toMatch(/const startReplay = useCallback\(\(cutoffIso, tf\) => \{\r?\n\s+setReplayCutoff\(cutoffIso \|\| null\)/)
    for (const m of ws.matchAll(/setReplayCutoff\(([^)]*)\)/g)) expect(m[1], m[0]).not.toMatch(/slice\(0, ?10\)|cutoffDay/)
    // Replay Mode is a VIEW: the cutoff is in-memory workspace state, never in a saved board / layout payload
    expect(ws).toMatch(/const \[replayCutoff, setReplayCutoff\] = useState\(null\)/)
    expect(ws).not.toMatch(/replayCutoff:\s*replayCutoff[^\n]*(?:save|persist|layout)/i)
  })
})
