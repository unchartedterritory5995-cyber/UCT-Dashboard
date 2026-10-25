// The ready-made widgets as the builder's tests read them. Tests only; nothing in the product imports it.
//
// Since the be->impl merge the shelf is one immutable file per revision (Task 10.8:
// api/services/journal_two/widget_engine/shelf/<slug>.r<N>.json, ordered by shelf/MANIFEST.json), not one shelf.json.
// This reads those files and gives the wave 8 shelf exactly: in MANIFEST order, each id's NEWEST revision whose plan
// is format 1 (an id with none, a wave 10 addition, is left out), as `{id, name, description, keywords, plan}` -- the
// shape the old shelf.json's `examples` held (railed equal to it once, at the merge, before shelf.json was retired).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), '..', 'api', 'services', 'journal_two', 'widget_engine', 'shelf')

export function wave8Shelf() {
  const order = JSON.parse(readFileSync(join(DIR, 'MANIFEST.json'), 'utf8')).order
  const files = readdirSync(DIR)
  const out = []
  for (const id of order) {
    const slug = id.replace(/^shelf:/, '')
    const isRev = (f) => f.startsWith(`${slug}.r`) && f.endsWith('.json')
      && /^[1-9][0-9]*$/.test(f.slice(slug.length + 2, -'.json'.length))
    const revs = files.filter(isRev)
      .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8'))).filter((r) => r.plan?.v === 1)
      .sort((a, b) => b.rev - a.rev)
    if (!revs.length) continue
    const { rev: _rev, ...entry } = revs[0]
    out.push(entry)
  }
  return out
}

export const SHELF_EXAMPLES = wave8Shelf()
