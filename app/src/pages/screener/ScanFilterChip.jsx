import styles from './ScannerPro.module.css'

const day = v => {
  const d = String(v)
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d
}
const n = v => Number(v).toLocaleString('en-US')

// One chip per joined scan. Counts come from the meta entry's `latest` — the
// ONE authority (server-batched off scan_coverage). `scanJoins` is the
// per-request truth: applied:false downgrades to the inert label even if a
// stale meta still carries a latest. "First sweep tonight" covers never-swept
// AND withheld (indistinguishable at the store, by design — spec §4c).
export function scanChipText({ scans, spec, hash, scanJoins }) {
  const meta = (scans || []).find(s => s.def_hash === hash)
  const name = meta?.name || spec?.label || 'Saved scan'
  const join = (scanJoins || []).find(j => j.def_hash === hash)
  const inert = (join && join.applied === false) || !meta?.latest
  if (inert) return `${name} — first sweep tonight`
  const l = meta.latest
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
