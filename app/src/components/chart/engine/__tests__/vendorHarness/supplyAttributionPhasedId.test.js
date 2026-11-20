// ─── (#2015 follow-up, 2026-11-19) A WITNESS ID THAT CARRIES A PHASE IS READ WHOLE ───
//
// A capture id may end in a phase (`<script>-<sym>-<tf>-<yyyy-mm-dd>[-<phase>]`, the closed vocabulary
// `tools/vendor_harness/evidence_ledger.py::CAPTURE_PHASES`), so two session states of one probe on one day never collide.
// `supplyAttribution.js` reads the ids a witness row names; it cut a phased id at its date, naming a capture that does
// not exist. These rails hold: the reader's vocabulary IS the Python one (derived by reading it, comments stripped), a
// phased id is read whole, and an unphased id reads exactly as before.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CAPTURE_PHASES, captureIdsIn } from './supplyAttribution'

describe('the witness reader reads a phased capture id whole', () => {
  it('its phase vocabulary IS evidence_ledger.py::CAPTURE_PHASES (code, not prose)', () => {
    const raw = fs.readFileSync(path.resolve(process.cwd(), '../tools/vendor_harness/evidence_ledger.py'), 'utf8')
    const code = raw.replace(/"""[\s\S]*?"""/g, '').replace(/#.*$/gm, '')
    const m = code.match(/^CAPTURE_PHASES\s*=\s*\(([^)]*)\)/m)
    expect(m, 'the Python tuple is found in code').not.toBeNull()
    const py = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
    expect(py.length, 'CONTROL: the tuple parsed to names').toBeGreaterThan(0)
    expect([...CAPTURE_PHASES]).toEqual(py)
  })

  it('a phased id is read with its phase; an unphased one exactly as before', () => {
    const text = 'witnessed by vw-request-htf-forming-spy-1d-2026-11-19-insession and vw-request-htf-forming-spy-1d-2026-11-19-postclose-fresh; '
      + 'older: vw-request-htf-alignment-spy-1d-2026-10-02.'
    expect(captureIdsIn(text)).toEqual([
      'vw-request-htf-forming-spy-1d-2026-11-19-insession',
      'vw-request-htf-forming-spy-1d-2026-11-19-postclose-fresh',
      'vw-request-htf-alignment-spy-1d-2026-10-02',
    ])
    for (const p of CAPTURE_PHASES) expect(captureIdsIn(`x-spy-1d-2026-11-19-${p}`), p).toEqual([`x-spy-1d-2026-11-19-${p}`])
  })

  it('⛔ CONTROL: a word after the date that is NOT a phase is not swallowed into the id', () => {
    expect(captureIdsIn('x-spy-1d-2026-11-19-draft')).toEqual(['x-spy-1d-2026-11-19'])
    expect(captureIdsIn('')).toEqual([])
    expect(captureIdsIn(null)).toEqual([])
  })
})
