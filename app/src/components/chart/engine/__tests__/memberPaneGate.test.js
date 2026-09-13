// ─── THE FLAG-OFF RAIL FOR A PANE THAT DOES NOT EXIST YET ───────────────────
//
// ⭐ WRITTEN BEFORE THE FEATURE, DELIBERATELY, AND ITS VACUITY IS DECLARED RATHER
// THAN HIDDEN. Three of the four claims below are real today: the default, the
// single reader, and the ledger entry. The FOURTH — "no consumer reaches the
// renderer without consulting the gate" — is vacuously true while
// `pineRuntimeFrontend.js` has zero importers, so it carries a CONTROL proving the
// walker can actually SEE an importer. A rail that passes because it looked nowhere
// is the failure mode this repo names most often.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { stripComments } from './sourceScan'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..', '..', '..', '..', '..')
const REPO = path.resolve(APP, '..')
const GATE_SRC = path.resolve(HERE, '..', 'memberPaneGate.js')
const LEDGER = path.join(REPO, 'docs', 'frontend_feature_flags.json')

/** ⛔ DERIVED FROM THE SOURCE, NEVER TYPED. */
const GATE_NAME = (() => {
  const m = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/.exec(fs.readFileSync(GATE_SRC, 'utf8'))
  return m ? m[1] : null
})()

/** Every `.js`/`.jsx` under app/src that is not a test. */
function sourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.vite') continue
      const full = path.join(dir, entry)
      if (fs.statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.[cm]?jsx?$/.test(entry)) continue
      if (/\.(test|spec)\./.test(entry)) continue
      out.push(full)
    }
  }
  walk(path.join(APP, 'src'))
  return out
}

const importers = (moduleBase) => sourceFiles().filter((f) => {
  const src = fs.readFileSync(f, 'utf8')
  // ⚠️ String.raw, because a template literal resolves `\s` to `s` and `\(` to
  // `(` BEFORE RegExp ever sees them — which built `/import(s*.../` and threw
  // "Unterminated group". An escape eaten one layer up is this session's third.
  const stat = new RegExp(String.raw`from\s+['"][^'"]*` + moduleBase + String.raw`(\.js)?['"]`)
  const dyn = new RegExp(String.raw`import\(\s*['"][^'"]*` + moduleBase + String.raw`(\.js)?['"]`)
  return stat.test(src) || dyn.test(src)
})

describe('the member-pane gate', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('is named, and the name is derivable from its one reader', () => {
    expect(GATE_NAME).toBe('VITE_PINE_MEMBER_PANE_ENABLED')
  })

  it('⛔ defaults OFF, and ONLY the string "1" turns it on', async () => {
    const { memberPaneEnabled } = await import('../memberPaneGate.js')
    // unset
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', undefined)
    expect(memberPaneEnabled()).toBe(false)
    // the near-misses a careless deploy produces
    for (const v of ['', '0', 'true', 'TRUE', 'yes', 'on', '1 ']) {
      vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', v)
      expect(memberPaneEnabled(), `"${v}" must not enable the pane`).toBe(false)
    }
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    expect(memberPaneEnabled()).toBe(true)
  })

  it('⛔ is read in exactly ONE place, so a rename is one line', () => {
    // ⛔⛔ CODE, NEVER PROSE — the repo's most repeated instrument defect, and
    // this sweep committed it. ⚰️ 2026-09-13: T5b's `pane/AttachedPineDisclosures
    // .jsx` explains IN A COMMENT why the flag must not reach that file, and this
    // check, matching raw text, reported it as a second reader of the flag. The
    // fix is the tool: strip comments before matching. Deleting the sentence would
    // make the check pass and leave the next reader without the reason a
    // disclosure surface is deliberately ungated.
    const readers = sourceFiles()
      .filter((f) => stripComments(fs.readFileSync(f, 'utf8')).includes(GATE_NAME))
    expect(readers.map((f) => path.relative(APP, f).split(path.sep).join('/')))
      .toEqual(['src/components/chart/engine/memberPaneGate.js'])
  })

  it('⛔ …and the stripper has a CONTROL, so the sweep cannot pass by seeing nothing', () => {
    // The needle is built by concatenation so this case does not contain the
    // literal it hunts — the other half of the same rule.
    const needle = `VITE_PINE_MEMBER${'_'}PANE_ENABLED`
    expect(needle).toBe(GATE_NAME)
    // A real read is still SEEN …
    expect(stripComments(`const x = import.meta.env.${needle}`)).toContain(needle)
    // … and the same words in a comment are NOT.
    expect(stripComments(`// we deliberately never read ${needle} here`)).not.toContain(needle)
    expect(stripComments(`/* ${needle} */`)).not.toContain(needle)
    // And the file that provoked the fix really does mention it, in prose only.
    const disclosures = fs.readFileSync(
      path.join(APP, 'src/components/chart/pane/AttachedPineDisclosures.jsx'), 'utf8')
    expect(disclosures).toContain(needle)
    expect(stripComments(disclosures)).not.toContain(needle)
  })

  it('the ledger declares it, and names the reader that really reads it', () => {
    const led = JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
    const entry = led.flags[GATE_NAME]
    expect(entry, `${GATE_NAME} is not declared in docs/frontend_feature_flags.json`).toBeTruthy()
    expect(entry.status).toBe('dark')
    const named = entry.readBy[0].split('::')[0]
    expect(fs.existsSync(path.join(REPO, named)), `${named} does not exist`).toBe(true)
    expect(fs.readFileSync(path.join(REPO, named), 'utf8')).toContain(GATE_NAME)
  })

  it('⚠️ VACUOUS TODAY: nothing reaches the renderer, so nothing has to consult the gate', () => {
    // The claim that becomes real tomorrow: any module that pulls in the member
    // runtime must also consult this gate. Today the left side is empty — which is
    // exactly what `pineRuntimeFrontendGate.test.js` enforces — so this asserts the
    // emptiness and says what changes when it ends.
    const consumers = importers('pineRuntimeFrontend')
      .map((f) => path.relative(APP, f).split(path.sep).join('/'))
    expect(consumers,
      'pineRuntimeFrontend.js now has a non-test importer. This test stops being '
      + 'vacuous at that moment: make that importer call memberPaneEnabled() before '
      + 'it renders anything, then replace this assertion with the real one.')
      .toEqual([])
  })

  it('⭐⭐ THE GATE NOW HAS A CONSUMER, AND IT CONSULTS THE GATE (T5)', () => {
    // ⚰️ THIS USED TO ASSERT `importers('memberPaneGate').length === 0` and borrow
    // `placement.js` as its positive control, because the gate had been written
    // before the surface it guards. `MemberPane.jsx` is that surface, so the
    // borrowed control is retired and the real claim takes its place.
    const known = importers('memberPaneGate')
      .map((f) => path.relative(APP, f).split(path.sep).join('/'))
    expect(known,
      'the member-pane gate has no non-test importer. If the pane was deleted, '
      + 'delete this case with it; if it stopped importing the gate, that is the '
      + 'defect this file exists for.')
      // ⭐⭐ T5b DELIBERATELY DID NOT JOIN THIS LIST, and the reason is the one
      // thing about this flag worth writing twice. T5b puts the same three
      // disclosures on the member's REAL chart
      // (`pane/AttachedPineDisclosures.jsx`), and that file reads NO flag: the
      // gate decides whether a member may ATTACH a Pine document, never whether
      // an attached one discloses. A build constant turned off is a deploy, and
      // every definition attached while it was on keeps drawing — gating the
      // sentences would strip them off drawings that survive the flip. So the
      // census stays at one, and a second name appearing here is a question, not
      // a formality.
      .toEqual(['src/components/chart/builder/memberPane/MemberPane.jsx'])

    // ⛔ IMPORTING IT IS NOT CONSULTING IT, AND THAT IS ASSERTED OF EVERY
    // IMPORTER RATHER THAN OF THE ONE THIS CASE WAS WRITTEN FOR. A component that
    // pulled the module in and never called the reader would satisfy an import
    // scan and still show a member an unfinished pane on a default build — and
    // checking only the first name in the list is how the fourth importer gets
    // to be the one that does it.
    for (const rel of known) {
      const src = fs.readFileSync(path.join(APP, rel), 'utf8')
      expect(src, `${rel} imports the gate and never calls it`).toContain('memberPaneEnabled()')
    }

    // ⭐ AND THE WALKER IS STILL SHOWN TO WORK ON A MODULE WITH MANY IMPORTERS,
    // so a walker that had broken into "finds exactly one file, always" reds.
    expect(importers('placement').length).toBeGreaterThan(0)
  })
})
