// Community layouts: the calls behind "Community layouts…" and "Share this layout…" on the scan
// board's Layout menu (server: api/routers/screener_layout_gallery.py, SCREENER_LAYOUT_GALLERY_ENABLED).
// Every call answers { ok, data } or { ok: false, error } with a sentence a member can read; none
// throws.
const BASE = '/api/screener/layout-gallery'
const OFFLINE = 'Could not reach the server. Check your connection and try again.'

async function call(path, method = 'GET', body) {
  let res
  try {
    res = await fetch(BASE + path, {
      method, credentials: 'include',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch { return { ok: false, error: OFFLINE } }
  let data = null
  try { data = await res.json() } catch { /* an empty or non-JSON answer */ }
  if (res.ok) return { ok: true, data: data || {} }
  const d = data?.detail
  const said = typeof d === 'string' ? d : typeof d?.message === 'string' ? d.message : ''
  return { ok: false, status: res.status, error: said || (res.status === 429 ? 'Too many requests. Try again later.' : 'That did not work. Try again.') }
}

export const listCommunity = () => call('')
export const publishLayout = (name, layout) => call('', 'POST', { name, layout })
export const unpublishLayout = id => call(`/${encodeURIComponent(id)}`, 'DELETE')
export const countUse = id => call(`/${encodeURIComponent(id)}/use`, 'POST', {})
export const reportLayout = (id, reason) => call(`/${encodeURIComponent(id)}/report`, 'POST', { reason })
export const adminAct = (id, action) => call(`/admin/${encodeURIComponent(id)}`, 'PATCH', { action })

export const REPORT_REASONS = [['name', 'The name is not OK'], ['broken', 'It does not work'], ['other', 'Something else']]

// What an admin still has to look at: layouts waiting for review and listed layouts with open reports.
export const toReview = queue => (Array.isArray(queue) ? queue.filter(i => i && !i.hidden && (i.status === 'pending' || i.reports > 0)).length : 0)
