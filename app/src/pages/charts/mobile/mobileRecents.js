// Recently-viewed symbols for the phone symbol sheet. Pure localStorage helpers
// (private-mode safe) so the list logic is unit-testable without a DOM mount.
const KEY = 'uct.charts.mobileRecents'
const CAP = 12

export function listRecents() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(arr)) return []
    return arr.filter((s) => typeof s === 'string' && s).slice(0, CAP)
  } catch {
    return []
  }
}

export function pushRecent(sym) {
  const s = String(sym || '').toUpperCase().trim()
  // Synthetic pseudo-tickers (theme indexes) aren't typeable and read as noise
  // in a recents rail — keep the list to real symbols.
  if (!s || s.startsWith('$IDX:')) return listRecents()
  const next = [s, ...listRecents().filter((x) => x !== s)].slice(0, CAP)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ }
  return next
}
