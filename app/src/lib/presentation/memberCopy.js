// app/src/lib/presentation/memberCopy.js
//
// Server sentences reach members verbatim on the research / terminal panels ("Source: ...",
// "Unavailable: <reason>"). Several of them carry engineering detail that is not member copy:
// vendor endpoint paths ("FMP /stable/key-executives"), our plan tier ("on this plan"), server
// switches ("(EDGAR_OWNERSHIP_ENABLED)"), HTTP codes and code identifiers. Live sweep
// 2026-10-05 saw them on PPL, EE and BRKE.
//
// `memberText` keeps the attribution and the meaning and strips only that detail. Source
// attribution itself ("Source: FMP") is fine and stays. One function for every panel, so the
// rule cannot drift between them.

const ENV_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/          // EDGAR_OWNERSHIP_ENABLED
const CODE_IDENT = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/              // analyst_grades, not_rendered
const PATH = /\s*\/(?:stable|api|v\d)\/[\w./-]+/g                // /stable/key-executives

function internalParenthetical(inner) {
  return /\/(?:stable|api|v\d)\//.test(inner) || ENV_NAME.test(inner) || CODE_IDENT.test(inner)
    || inner.includes('=') || /\b(?:401|403|404|429|5\d\d)\b/.test(inner) || /\blane\//.test(inner)
    || /\.db\b/.test(inner)
}

export function memberText(s) {
  if (s == null) return s
  let t = String(s)
  // drop parentheticals that are wholly internal detail
  t = t.replace(/\s*\(([^()]*)\)/g, (m, inner) => (internalParenthetical(inner) ? '' : m))
  // "refused /stable/x" reads as "refused the request" once the path goes
  t = t.replace(/\brefused\s+\/(?:stable|api|v\d)\/[\w./-]+/g, 'refused the request')
  t = t.replace(PATH, '')
  // a raw exception class after "failed" ("fetch failed: ReadTimeout") is not member copy
  t = t.replace(/\b(fetch|read|request) failed:\s*[A-Z]\w*(?:Error|Timeout|Exception)\b/g, '$1 failed')
  t = t.replace(/\s+on this (?:plan|server)\b/g, '')
  t = t.replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ').trim()
  return t
}

/** A server reason shown as a whole sentence: member-safe, capitalised, ending in a period
 *  (sweep: "no fails reported for NVDA between ... ." and reasons with no closing period). */
export function memberSentence(s) {
  const t = memberText(s)
  if (!t) return t
  const c = t[0].toUpperCase() + t.slice(1)
  return /[.!?]$/.test(c) ? c : `${c}.`
}
