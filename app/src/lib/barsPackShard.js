/**
 * Decodes one bars-pack shard's columnar payload. Shared by the page (delta ingest) and the shard job
 * (`barsPackIngest.js`, which runs in the worker), so there is one decoder.
 */
/**
 * Reconstruct a shard's columnar arrays into [{ sym, tf, bars }] where `bars` is
 * the exact server bar shape [{t,o,h,l,c,v}] that idbImportPack stores verbatim.
 * Pure + defensive (tolerates missing tfs / ragged columns) so it can be unit
 * tested without a network or IDB.
 */
export function decodeShardPayload(obj) {
  const tickers = obj && obj.tickers
  if (!tickers) return []
  const out = []
  for (const sym in tickers) {
    const tfs = tickers[sym]
    if (!tfs) continue
    // Iterate the tf keys the shard actually carries — so this decodes the D/W/M
    // pack AND the intraday pack ('5'/'60') with the same code (for daily shards
    // Object.keys is exactly ['D','W','M'], so behaviour is unchanged).
    for (const tf of Object.keys(tfs)) {
      const cols = tfs[tf]
      if (!cols || !cols.t || !cols.t.length) continue
      const n = cols.t.length
      const bars = new Array(n)
      for (let i = 0; i < n; i++) {
        bars[i] = { t: cols.t[i], o: cols.o[i], h: cols.h[i], l: cols.l[i], c: cols.c[i], v: cols.v[i] }
        if (cols.ohlc && cols.ohlc[i] === 1) bars[i].ohlc = 1   // breadth's observed-OHLC mark
      }
      out.push(cols.sha ? { sym, tf, bars, sha: cols.sha } : { sym, tf, bars })
    }
  }
  return out
}
