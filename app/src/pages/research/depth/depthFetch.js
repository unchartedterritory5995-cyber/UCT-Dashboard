// Fetcher for the Depth panels. Same contract as sectionFetcher (a failed
// request THROWS, so "could not read" never renders as "nothing there"), plus
// two answers that are states rather than failures:
//   402 -> { paywalled: true }
//   400 -> { badRequest: <the server's sentence> }  (a query the language cannot express)

export class DepthFetchError extends Error {
  constructor(message, status = null) {
    super(message)
    this.name = 'DepthFetchError'
    this.status = status
  }
}

export async function depthFetcher(url) {
  let res
  try {
    res = await fetch(url)
  } catch (e) {
    throw new DepthFetchError(`network: ${e?.message || e}`)
  }
  if (res.status === 402) return { paywalled: true }
  if (res.status === 400) {
    let detail = 'That request could not be read.'
    try { detail = (await res.json())?.detail || detail } catch { /* keep the default */ }
    return { badRequest: String(detail) }
  }
  if (!res.ok) throw new DepthFetchError(`HTTP ${res.status}`, res.status)
  return res.json()
}
