// ─── Rails only: the run half's object evidence for one script, from the COMMITTED allowlist record ───
//
// The same mapping the server serves (`api/services/runtime_definitions.run_half_evidence`): the captures of the
// script's record that carry an `objectsV2` grade, each passed on as the fact it records, with the settings it was
// taken at (`inputs`). A rail that installs Fred RS as a member does (named "Fred RS" or "RS Rating", or pasted)
// gets the owner's TradingView settings on a new instance (`house/houseNames.withHouseCreateInputs`), which are MOVED
// settings to the run half: only evidence recorded at moved settings admits them, so such a rail reads the committed
// record instead of restating a two-capture fixture at the script's defaults.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const REPO = path.resolve(process.cwd(), '..')

/** The run-half evidence entry the server would serve for `sha256`, or throws when the record has none. */
export function committedRunHalfEvidence(sha256) {
  const allow = JSON.parse(fs.readFileSync(path.join(REPO, 'api/data/pine_runtime_allowlist.json'), 'utf8'))
  const row = (allow.scripts || []).find((s) => s && s.sha256 === sha256)
  if (!row) throw new Error(`no allowlist record for ${sha256}`)
  const captures = (row.captures || []).filter((c) => c && 'objectsV2' in c && typeof c.id === 'string' && c.id)
  if (!captures.length) throw new Error(`the allowlist record for ${sha256} carries no objectsV2 capture`)
  return {
    sha256,
    ...('admission' in row ? { admission: row.admission, substituted: row.substituted } : {}),
    captures: captures.map((c) => ({
      capture: c.id, verdict: c.verdict, objectsV2: c.objectsV2 === 'MATCH', runtimeOn: c.runtimePane === 'on',
      ...('substituted' in c ? { substituted: c.substituted } : {}),
      ...(c.inputs ? { inputs: c.inputs } : {}),
      ...(c.objectsV2 === 'MATCH_SUBSTITUTED' ? { objectsV2Substituted: c.objectsV2Substituted || [] } : {}),
    })),
  }
}
