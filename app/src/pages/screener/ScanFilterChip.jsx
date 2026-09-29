import styles from './ScannerPro.module.css'

const day = v => {
  const d = String(v)
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d
}
const n = v => Number(v).toLocaleString('en-US')

// One chip per joined scan. COUNTS come from the meta entry's `latest` — the
// ONE authority (server-batched off scan_coverage). `scanJoins` is the
// per-request truth about whether the join RAN, and it wins in BOTH
// directions: applied:false downgrades to the inert label even when a stale
// meta still carries a latest, and applied:true renders SWEPT even when this
// viewer's meta has no entry (a shared spec's hash, a deleted definition, or
// the 05:00 sweep crossing an open tab's 6h-deduped meta) — a chip claiming
// "first sweep tonight" over rows the join is actively filtering would read
// a scan-filtered set as the unfiltered market. When the applied join and
// the meta disagree on as_of, the join's date is shown and the counts are
// DROPPED rather than pairing one session's date with another's counts.
// "First sweep tonight" covers never-swept AND withheld (indistinguishable
// at the store, by design — spec §4c).

/** The joined scan's receipt — `{as_of, evaluated, answered, dropped,
 *  not_computable}` off the meta entry's `latest` — ONLY when its counts may be
 *  shown beside the rows that join filtered: the join APPLIED on this request,
 *  and the meta's latest is the SAME sweep (`as_of`) the join used. Otherwise
 *  null. ONE RULE, TWO READERS: the chip's applied branch above and the
 *  shell's `CoverageLine` (TERM-047) both ask this, so the chip and the line can
 *  never disagree about which sweep's counts belong to the rows on screen. */
export function joinReceipt({ scans, hash, scanJoins }) {
  const meta = (scans || []).find(s => s.def_hash === hash)
  const join = (scanJoins || []).find(j => j.def_hash === hash)
  const l = meta?.latest
  if (!join || join.applied !== true || !l || l.as_of !== join.as_of) return null
  return l
}

/** Every applied scan join whose receipt `joinReceipt` allows, in the order the
 *  server reported the joins, with the chip's own words for which sweep it is.
 *  A join with no receipt (never swept, withheld, or a stale meta) yields
 *  NOTHING here — never a zeroed receipt, which would read as a quiet market. */
export function joinedScanReceipts({ scans, scanJoins }) {
  const out = []
  for (const j of scanJoins || []) {
    if (!j || j.applied !== true) continue
    const latest = joinReceipt({ scans, hash: j.def_hash, scanJoins })
    if (!latest) continue
    const name = (scans || []).find(s => s.def_hash === j.def_hash)?.name || 'Saved scan'
    out.push({ def_hash: j.def_hash, label: `${name} — swept ${day(latest.as_of)}`, latest })
  }
  return out
}

export function scanChipText({ scans, spec, hash, scanJoins }) {
  const meta = (scans || []).find(s => s.def_hash === hash)
  const name = meta?.name || spec?.label || 'Saved scan'
  const join = (scanJoins || []).find(j => j.def_hash === hash)
  if (join && join.applied === false) return `${name} — first sweep tonight`
  const l = meta?.latest
  if (join && join.applied === true) {
    const r = joinReceipt({ scans, hash, scanJoins })
    if (r) {
      return `${name} — swept ${day(r.as_of)} · ${n(r.answered)}/${n(r.evaluated)} answered · ${n(r.dropped)} dropped`
    }
    return `${name} — swept ${day(join.as_of)}`
  }
  if (!l) return `${name} — first sweep tonight`
  return `${name} — swept ${day(l.as_of)} · ${n(l.answered)}/${n(l.evaluated)} answered · ${n(l.dropped)} dropped`
}

export default function ScanFilterChip({ scans, spec, scanJoins, onRemoveHash }) {
  const hashes = Array.isArray(spec?.value) ? spec.value : [spec?.value].filter(Boolean)
  return hashes.map(h => (
    <span key={h} className={styles.chip} data-testid={`scan-chip-${h.slice(7, 15)}`}>
      {scanChipText({ scans, spec, hash: h, scanJoins })}
      <button type="button" className={styles.chipX}
        aria-label="Remove scan filter" onClick={() => onRemoveHash(h)}>×</button>
    </span>
  ))
}
