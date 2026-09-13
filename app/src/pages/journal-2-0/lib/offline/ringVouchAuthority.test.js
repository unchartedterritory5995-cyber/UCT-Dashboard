/**
 * ⛔⛔ "THE RING VOUCHED — NOW WHAT?" IS ASKED IN ONE PLACE. This rail finds a
 * THIRD one, derived from the source, before it can ship.
 *
 * ⚰️ WHY IT EXISTS. Q1 fix 3 (2026-09-13). The drain asked that question TWICE
 * — once BEFORE sending, when an expired in-flight marker turns out to be ours,
 * and once on a 409 — and both copies answered it the same wrong way: "ours ⇒
 * rebase and resend the queued body", taken before the diff was ever read. So
 * when the server's change was an APPEND (a widget sent to the journal, a saved
 * price, a PDF excerpt) the member's queued body went out over it and the
 * captured block was gone. 24/24 metadata green, 0/18 append.
 *
 * ⛔ THE PRE-SEND COPY IS THE HALF NOTHING DOWNSTREAM COULD HAVE CAUGHT: it
 * rebases and resends with NO 409 at all, so no 409 handler — however correct —
 * was ever reached. That is the shape this rail is aimed at. A second site is
 * not a duplicate of the first; it is a place the answer can differ silently.
 *
 * THE DERIVATION, from the code and never from a list:
 *   ① strip comments and string bodies (a comment quoting the old idiom is not
 *      a call site — the invented-citation trap `contractArity.test.js` names)
 *   ② every read of the ring's verdict `.ours` is a VOUCH SITE
 *   ③ take each site's own region — the braced block it guards, or the
 *      statement it is part of — and read what that region DECIDES
 *   ④ a region that chooses a recovery plan must choose it through
 *      `ringVouchedPlan`. Anything else is a third site and fails BY NAME.
 *
 * ⭐ `identical` sites are exempt and NAMED, not silently skipped: proving the
 * server already holds these bytes removes the entry and chooses no plan at all.
 * An unrecognised vouch site is a FAILURE, never a pass — "I do not know what
 * this one does" must not read as "this one is fine".
 *
 * MODE: 'fail' as of 2026-09-13 — four vouch sites, two authority, two identical.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const OFFLINE = __dirname
const REPO = join(OFFLINE, '..', '..', '..', '..', '..', '..')
const rel = (p) => relative(REPO, p).split(sep).join('/')
const isTest = (p) => /\.(test|spec)\.[jt]sx?$/.test(p)

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.(js|jsx)$/.test(name) && !isTest(name)) out.push(p)
  }
  return out
}

/**
 * Blank out comment bodies and string/template contents, preserving LENGTH and
 * every newline so offsets and line numbers still describe the real file.
 *
 * ⛔ NOT COSMETIC. `outboxDrain.js` explains the old "ours ⇒ rebase" idiom in
 * prose several times, naming `rebaseEntry` and `.ours` in the same paragraph.
 * A scanner that reads comments reports those paragraphs as call sites, and the
 * rail then fails for a reason that is purely its own.
 */
export function stripNonCode(src) {
  let out = ''
  let i = 0
  const blank = (s) => s.replace(/[^\n]/g, ' ')
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '//') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      out += blank(src.slice(i, stop))
      i = stop
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      out += blank(src.slice(i, stop))
      i = stop
    } else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const q = src[i]
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === q) break
        j += 1
      }
      const stop = Math.min(j + 1, src.length)
      out += q + blank(src.slice(i + 1, stop - 1)) + (src[stop - 1] === q ? q : '')
      i = stop
    } else {
      out += src[i]
      i += 1
    }
  }
  return out
}

const lineOf = (code, idx) => code.slice(0, idx).split('\n').length

/** Back to the start of the statement this offset sits in. */
function statementStart(code, idx) {
  let i = idx
  while (i > 0 && !';{}'.includes(code[i - 1])) i -= 1
  while (i < idx && /\s/.test(code[i])) i += 1
  return i
}

/**
 * The region a vouch site decides over: the braced block it guards when there
 * is one (`if (mine?.ours && …) { … }`), otherwise the statement it belongs to
 * (`const ring = mine?.ours ? ringVouchedPlan(…) : …`). Both shapes are live in
 * the drain today, which is why neither can be the only one understood.
 */
function regionEnd(code, start) {
  let depth = 0
  for (let i = start; i < code.length; i += 1) {
    const c = code[i]
    if (c === '(' || c === '[') depth += 1
    else if (c === ')' || c === ']') depth -= 1
    else if (c === '{') {
      if (depth === 0) {
        let d = 0
        for (let j = i; j < code.length; j += 1) {
          if (code[j] === '{') d += 1
          else if (code[j] === '}') { d -= 1; if (d === 0) return j + 1 }
        }
        return code.length
      }
      depth += 1
    } else if (c === '}') depth -= 1
    else if (c === ';' && depth === 0) return i + 1
  }
  return code.length
}

const AUTHORITY = /\bringVouchedPlan\s*\(/
const CHOOSES_A_PLAN = /\b(rebaseEntry|mergeAppends|classifyServerChange|appendedServerNodes|missingServerNodes)\s*\(/
const REMOVES_ONLY = /\bclearOutboxEntry\s*\(/

/** Every `.ours` read in one file, with what its own region decides. */
export function vouchSites(src, label = '<source>') {
  const code = stripNonCode(src)
  const out = []
  for (const m of code.matchAll(/\.ours\b/g)) {
    const start = statementStart(code, m.index)
    const end = regionEnd(code, start)
    const region = code.slice(start, end)
    let kind
    if (AUTHORITY.test(region)) kind = 'authority'
    else if (CHOOSES_A_PLAN.test(region)) kind = 'violation'
    else if (REMOVES_ONLY.test(region)) kind = 'identical'
    else kind = 'unclassified'
    out.push({ file: label, line: lineOf(code, m.index), kind, region: region.replace(/\s+/g, ' ').trim().slice(0, 160) })
  }
  return out
}

const FILES = sources(OFFLINE)
const ALL = FILES.flatMap((p) => vouchSites(readFileSync(p, 'utf8'), rel(p)))

describe('the ring vouched — now what? is asked in exactly one place', () => {
  it('finds the vouch sites at all', () => {
    // ⛔ NON-VACUITY. Every assertion below is satisfied by an empty set, and an
    // empty set is what a broken scanner returns. Name a member, not a count:
    // the pre-send site is the one whose absence started this.
    expect(ALL.length).toBeGreaterThan(0)
    expect(FILES.map(rel)).toContain('app/src/pages/journal-2-0/lib/offline/outboxDrain.js')
    const drain = ALL.filter((s) => s.file.endsWith('outboxDrain.js'))
    expect(drain.length).toBeGreaterThanOrEqual(4)
  })

  it('routes every plan decision through ringVouchedPlan', () => {
    const bad = ALL.filter((s) => s.kind === 'violation')
    expect(bad, `a THIRD site decides "the ring vouched, now what?" without ringVouchedPlan:\n`
      + bad.map((s) => `  ${s.file}:${s.line}  ${s.region}`).join('\n')).toEqual([])
  })

  it('recognises what every vouch site does — an unknown one is a failure', () => {
    const unknown = ALL.filter((s) => s.kind === 'unclassified')
    expect(unknown, `a vouch site this rail cannot classify — read it and say which it is:\n`
      + unknown.map((s) => `  ${s.file}:${s.line}  ${s.region}`).join('\n')).toEqual([])
  })

  it('keeps BOTH call sites asking the one authority', () => {
    // ⛔ The pre-send path and the 409 path. Deleting either — or inlining its
    // answer back into the branch — is the same defect arriving from the other
    // direction, so the floor is asserted, not just the ceiling.
    expect(ALL.filter((s) => s.kind === 'authority').length).toBeGreaterThanOrEqual(2)
  })

  it('defines ringVouchedPlan exactly once', () => {
    const defs = FILES.filter((p) => /function\s+ringVouchedPlan\s*\(/.test(stripNonCode(readFileSync(p, 'utf8'))))
    expect(defs.map(rel)).toEqual(['app/src/pages/journal-2-0/lib/offline/outboxDrain.js'])
  })
})

describe('the rail can fail', () => {
  const THIRD_SITE = `
    async function drain() {
      const mine = await askServerIfOurs(db, entry, serverCopyIsOurs)
      if (mine?.ours && mine.serverUpdatedAt) {
        entry = await rebaseEntry(db, entry, mine.serverUpdatedAt)
      }
    }
  `
  const THROUGH_THE_AUTHORITY = `
    async function drain() {
      const mine = await askServerIfOurs(db, entry, serverCopyIsOurs)
      if (mine?.ours && mine.serverUpdatedAt) {
        const ring = ringVouchedPlan(mine, noteRec)
        if (ring.plan === 'rebase') entry = await rebaseEntry(db, entry, mine.serverUpdatedAt)
      }
    }
  `

  it('reports a third site that rebases on the ring alone', () => {
    expect(vouchSites(THIRD_SITE).map((s) => s.kind)).toEqual(['violation'])
  })

  it('and does NOT report the same branch once it asks the authority', () => {
    // ⭐ The pair is the point. A checker that flags both is not measuring the
    // thing it claims to measure, and a checker that flags neither is decoration.
    expect(vouchSites(THROUGH_THE_AUTHORITY).map((s) => s.kind)).toEqual(['authority'])
  })

  it('does not read a comment as a call site', () => {
    const PROSE = `
      // ⚰️ the old idiom was: if (mine.ours) rebaseEntry(db, entry, at)
      /* mine.ours used to mean rebaseEntry() and that was the bug */
      const reason = 'mine.ours ⇒ rebaseEntry(db, entry)'
      async function drain() { return null }
    `
    expect(vouchSites(PROSE)).toEqual([])
  })
})
