// app/src/components/chart/engine/ast/targetScriptReport.measure.test.js
//
// ─── ⭐⭐ ONE SCRIPT'S WHOLE BLOCKER CHAIN, NOT ITS FIRST BLOCKER ────────────
//
// The corpus censuses answer population questions: which guard, which name,
// how many scripts. Neither answers the question you ask when somebody hands
// you an indicator and says "make this work": **what does THIS script need?**
//
// ⛔⛔ AND THE FIRST BLOCKER IS A MISLEADING ANSWER TO IT. This repo's most
// expensive recurring lesson is that *scripts mostly move to their NEXT blocker
// rather than clearing* — `RVOL-SLICE-RESUME.md` states it, and the host-lane
// sweep re-learned it on `nvi`/`pvi`, on `pine:character` (19 of 24 scripts ALSO
// use `array.*`, which is a permanent refusal, so a perfect method-syntax
// implementation unlocks ZERO of them), and on `pine:tuple` (all 5 ALSO have
// `for` loops). Building the first blocker and expecting the script to draw is
// how a week disappears.
//
// So this reports BOTH:
//   1. what the engine says NOW — the first blocker on each lane, with its token
//      and line, which is a fact;
//   2. a STATIC SCAN for every construct known to be hard or refused, which is a
//      LOOK-AHEAD at what is queued behind it.
//
// ⚠️ THE SCAN IS A HEURISTIC AND IS LABELLED ONE. It greps source text, so it
// can be fooled by the same construct inside a comment or a string — the repo
// has paid for that class six times in one session (`CLAUDE.md`, "CODE, NEVER
// PROSE"). Comments are stripped before matching and a control case proves the
// stripper works, but a string literal containing `type Foo` will still match.
// Read it as "worth checking", never as "definitely blocked".
//
// Populate `docs/pine/target-scripts.json` and run:
//   cd app && node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/ast/targetScriptReport.measure.test.js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'

const REPO = path.resolve(process.cwd(), '..')
const LIST = path.join(REPO, 'docs/pine/target-scripts.json')

/** Strip `//` comments so a construct named in prose is not read as code.
 *  ⛔ Deliberately does NOT strip string literals — see the header. A control
 *  case below proves the comment stripper actually fires. */
const stripComments = (src) => src.split('\n')
  .map((l) => {
    const i = l.indexOf('//')
    return i === -1 ? l : l.slice(0, i)
  })
  .join('\n')

/** Constructs this engine is known to refuse or find hard, with the phase that
 *  owns each. ⭐ The phase names come from `docs/pine/PARITY-PROGRAMME.md` so a
 *  report row points at the plan rather than at a bare guard string. */
const HARD = [
  ['strategy()', /\bstrategy\s*\(/, 'OUT OF SCOPE by owner ruling'],
  ['import (Pine library)', /^\s*import\s+/m, 'Phase 7 — library infrastructure'],
  ['type declaration (UDT)', /^\s*type\s+[A-Za-z_]/m, 'Phase 3 — OOP'],
  ['method declaration', /^\s*method\s+/m, 'Phase 3 — OOP'],
  ['chained method call', /\)\s*\.\s*[a-zA-Z_]/, 'Phase 3 — OOP'],
  ['request.security', /\brequest\s*\.\s*security\b/, 'Phase 5 — bars orchestrator'],
  ['array.*', /\barray\s*\.\s*[a-z]/, 'partial — runtime lane'],
  ['matrix.*', /\bmatrix\s*\.\s*[a-z]/, 'Phase 7 — collections'],
  ['map.*', /\bmap\s*\.\s*[a-z]/, 'Phase 7 — collections'],
  ['for loop', /^\s*for\s+/m, 'partial — object pass carries counted for'],
  ['while loop', /^\s*while\s+/m, 'Phase 7 — refused today'],
  ['for...in', /\bfor\s+\[?[A-Za-z_,\s]+\]?\s+in\s+/, 'Phase 7'],
  ['switch', /^\s*switch\b/m, 'Phase 7'],
  ['enum', /^\s*enum\s+/m, 'Phase 7'],
  ['varip', /\bvarip\b/, 'partial'],
  ['history on expression', /\)\s*\[\s*\d/, 'IN FLIGHT — wave 1'],
  ['label/box/line drawing', /\b(label|box|line)\s*\.\s*new\b/, 'IN FLIGHT — wave 1'],
  ['polyline', /\bpolyline\s*\.\s*/, 'Phase 6 — renderer'],
  ['linefill', /\blinefill\s*\.\s*/, 'Phase 6 — renderer'],
  ['gradient fill (6-arg)', /\bfill\s*\([^)]*,[^)]*,[^)]*,[^)]*,[^)]*,/, 'Phase 6 — renderer'],
  ['syminfo.mintick', /\bsyminfo\s*\.\s*mintick\b/, 'PERMANENT — no per-symbol tick size'],
  ['table.*', /\btable\s*\.\s*[a-z]/, 'supported — objects-only pane'],
]

const readList = () => {
  if (!fs.existsSync(LIST)) return []
  try {
    return JSON.parse(fs.readFileSync(LIST, 'utf8')).scripts || []
  } catch (err) {
    throw new Error(`target-scripts.json is not valid JSON: ${err.message}`)
  }
}

const resolveTarget = (p) => (path.isAbsolute(p) ? p : path.join(REPO, p))

const laneVerdict = (fn) => {
  try {
    const r = fn()
    if (r.ok) return { ok: true, note: null }
    const ref = r.refusal || {}
    return {
      ok: false,
      guard: ref.guard || 'unnamed',
      token: ref.token || null,
      line: ref.line == null ? null : ref.line,
    }
  } catch (err) {
    return { ok: false, guard: 'THREW', token: String(err && err.message).slice(0, 60), line: null }
  }
}

describe('⭐⭐ the target list — what each script actually needs', () => {
  it('⛔ CONTROL — the comment stripper fires, so prose is not read as code', () => {
    // Without this the scan reports a construct that appears only in a comment,
    // which is the "CODE, NEVER PROSE" defect CLAUDE.md records six instances of.
    const withComment = 'x = 1 // type Foo\n'
    const withCode = 'type Foo\n    int a\n'
    const typeRule = HARD.find(([label]) => label === 'type declaration (UDT)')[1]
    expect(typeRule.test(stripComments(withComment))).toBe(false)
    expect(typeRule.test(stripComments(withCode))).toBe(true)
  })

  it('⭐⭐ reports every target: both lanes, plus the look-ahead scan', () => {
    const targets = readList()
    const lines = ['', '════ TARGET SCRIPT REPORT ════', '']

    if (!targets.length) {
      lines.push('  (no targets — add them to docs/pine/target-scripts.json)')
    }

    let missing = 0
    for (const t of targets) {
      const abs = resolveTarget(t.path)
      lines.push(`── ${t.name || t.path}`)
      if (t.why) lines.push(`   why: ${t.why}`)
      if (!fs.existsSync(abs)) {
        // ⛔ REPORTED, NEVER SKIPPED. A target list that quietly drops entries
        // is a list that lies about coverage.
        lines.push(`   ⛔ MISSING ON DISK: ${abs}`, '')
        missing += 1
        continue
      }
      const src = fs.readFileSync(abs, 'utf8')
      const host = laneVerdict(() => translatePine(src, { strict: true }))
      const runtime = laneVerdict(
        () => buildRuntimeIr(src, { tf: 'D', ...runtimeClockOpts(false) }),
      )
      const t2 = (() => { try { return translatePine(src, { strict: true }) } catch { return null } })()
      const objOps = t2 && t2.objects ? (t2.objects.ops || []).length : 0
      const diag = (t2 && t2.objectDiagnostics) || {}

      const fmt = (v) => (v.ok ? '✅ ok'
        : `❌ ${v.guard}${v.token ? ` @ \`${v.token}\`` : ''}${v.line ? ` line ${v.line}` : ''}`);
      lines.push(`   host lane    : ${fmt(host)}`)
      lines.push(`   runtime lane : ${fmt(runtime)}`)
      if (objOps) {
        lines.push(`   objects      : ${objOps} ops`
          + (diag.droppedOps ? `, ${diag.droppedOps} dropped ${JSON.stringify(diag.dropReasons)}` : '')
          + (diag.unsupported && diag.unsupported.length ? `, unsupported ${JSON.stringify(diag.unsupported)}` : ''))
      }

      const code = stripComments(src)
      const hits = HARD.filter(([, re]) => re.test(code))
      if (hits.length) {
        lines.push('   look-ahead (heuristic — grep, comments stripped, strings NOT):')
        for (const [label, , phase] of hits) lines.push(`     · ${label.padEnd(26)} ${phase}`)
      }
      lines.push('')
    }

    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))

    // ⛔ A MISSING TARGET IS A FAILURE, not a note. The list names what we are
    // committing to; a path that does not resolve means the commitment cannot
    // be measured, and a green run would say otherwise.
    expect(missing, `${missing} target(s) named in target-scripts.json do not exist on disk`).toBe(0)
  })
})
