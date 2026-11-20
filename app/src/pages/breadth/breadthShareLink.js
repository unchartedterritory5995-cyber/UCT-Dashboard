// The Breadth Monitor's "Copy share link" (⋯ menu). The link is the page's own current URL — the
// router already keeps the shareable state there (`?universe=`, `?tab=`, the Views params) — plus
// `?d=YYYY-MM-DD` for the session at the top of the sheet, which Breadth.jsx's deep-link effect
// scrolls back to once (the same `d` the old "Copy Share URL" wrote). The column template is the
// member's own saved setting, not link state, so it is not carried.

/** The share URL: `/breadth` + the current query, with `d` set to the top row's session. */
export function breadthShareUrl(topDate, href = window.location.href) {
  const u = new URL(href)
  u.pathname = '/breadth'
  u.hash = ''
  if (topDate && /^\d{4}-\d{2}-\d{2}$/.test(topDate)) u.searchParams.set('d', topDate)
  else u.searchParams.delete('d')
  return u.toString()
}

/** Copy the share URL to the clipboard. Resolves true on success, false where the browser refuses. */
export async function copyBreadthShareUrl(topDate) {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(breadthShareUrl(topDate))
    return true
  } catch {
    return false
  }
}
