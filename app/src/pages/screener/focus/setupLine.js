// The one short setup line under a ticker in the Focus list. Honesty rules
// (spec §6.1): the head of base_render only; zero volume says "No trades today";
// a pivot distance ONLY when the row carries base_pivot_px, which the snapshot
// writes from the same detection that names the head structure (phase 2).
const fmtPx = p => (Math.abs(p) >= 10 ? Math.round(p).toString() : p.toFixed(2))

export function pivotDetail(price, pivot) {
  if (!Number.isFinite(price) || !Number.isFinite(pivot) || pivot <= 0) return null
  const pct = (price / pivot - 1) * 100
  if (Math.abs(pct) < 0.25) return `at pivot ${fmtPx(pivot)}`
  return `${Math.abs(pct).toFixed(1)}% ${pct < 0 ? 'below' : 'above'} pivot ${fmtPx(pivot)}`
}

export function setupLine(row) {
  if (row?.vol_ratio === 0) return { text: 'No trades today', detail: null, quiet: true }
  const render = row?.base_render
  if (!render) return { text: 'Not enough history for a base', detail: null, quiet: true }
  // Full render with the +N removed. The head is the part before " ("; when that
  // is empty, or the render opens with a parenthetical, the head would be blank
  // or misleading, so show the whole render instead.
  const full = String(render).replace(/\s*\+\d+\s*$/, '').trim()
  let head = full.split(' (')[0].trim()
  if (!head || full.startsWith('(')) head = full
  return { text: head, detail: pivotDetail(row?.price, row?.base_pivot_px), quiet: false }
}
