// CAPABILITY REGRESSION — docs/agent/COMPATIBILITY-DECISIONS.md, parsed the same way tests/test_uct_agent_capreg_baseline.py
// parses it: `### KEY — title` sections with `- Field: value` lines; fenced code blocks (the format example) and text
// outside a `###` section never count. A decision is valid only with a real `Date:`, a named `Decided by:` (not a
// template placeholder) and a `Binds:` line naming EXACTLY the change it allows (old digest -> new digest | removed), so one
// heading never unlocks a capability for every later weakening.
import { createHash } from 'node:crypto'

const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v)
/** 16 hex of sha256 over the canonical JSON (sorted keys, compact) — Python's `_digest`. */
export const digest = (v) => createHash('sha256').update(JSON.stringify(canon(v ?? null))).digest('hex').slice(0, 16)

const FIELD = /^\s*[-*]\s*(Date|Decided by|Binds|Why|Replacement protection):\s*(.*?)\s*$/i
export function parseDecisions(text) {
  const out = {}
  let cur = null
  let fence = false
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.trimStart().startsWith('```')) { fence = !fence; continue }
    if (fence) continue
    const m = /^###\s+(\S+)/.exec(line)
    if (m) { cur = { key: m[1] }; (out[m[1]] ||= []).push(cur); continue }
    if (line.startsWith('#')) { cur = null; continue }
    const f = FIELD.exec(line)
    if (cur && f) cur[f[1].toLowerCase()] = f[2]
  }
  return out
}
export const decisionValid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') && !!d['decided by'] && !d['decided by'].includes('<')
  && /^[0-9a-f]{16}->([0-9a-f]{16}|removed)$/.test(d.binds || '')
/** Is there a valid decision `### key` bound to exactly `binds`? */
export const decidedFor = (decisions, key, binds) => (decisions[key] || []).some(d => decisionValid(d) && d.binds === binds)
