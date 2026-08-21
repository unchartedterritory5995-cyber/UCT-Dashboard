// The working screen as a URL: refresh/back/forward safe. One codec, no
// second authority — useScreenSpec encodes with this and decodes with this.
// The `screen=` share-token param (screenShareLink.js) is a DIFFERENT door:
// it carries a saved screen's token; `s=` carries this session's working spec.
export const SPEC_PARAM = 's'
export const DEFAULT_SORT = { key: 'uct_composite', dir: 'desc' }
export const DEFAULT_VIEW = 'overview'

const b64url = s => btoa(unescape(encodeURIComponent(s)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = s => decodeURIComponent(escape(
  atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

const isDefaultSort = sort =>
  !sort || (sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir)

export function encodeSpec({ filters = {}, sort, view, columns } = {}) {
  const f = Object.entries(filters).filter(([, v]) => v)
  const payload = {}
  if (f.length) payload.f = Object.fromEntries(f)
  if (!isDefaultSort(sort)) payload.sort = sort
  if (view && view !== DEFAULT_VIEW) payload.view = view
  if (columns?.length) payload.cols = columns
  if (!Object.keys(payload).length) return null
  return b64url(JSON.stringify(payload))
}

export function decodeSpec(str) {
  if (!str) return null
  try {
    const p = JSON.parse(unb64url(str))
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null
    return {
      filters: p.f && typeof p.f === 'object' && !Array.isArray(p.f) ? p.f : {},
      sort: p.sort?.key ? { key: String(p.sort.key), dir: p.sort.dir === 'asc' ? 'asc' : 'desc' } : { ...DEFAULT_SORT },
      view: typeof p.view === 'string' && p.view ? p.view : DEFAULT_VIEW,
      columns: Array.isArray(p.cols) && p.cols.every(c => typeof c === 'string') && p.cols.length ? p.cols : null,
    }
  } catch {
    return null
  }
}
