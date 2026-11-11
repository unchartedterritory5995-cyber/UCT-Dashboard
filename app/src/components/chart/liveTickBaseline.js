// ── LIVE-TICK SANITY — ONE OWNER, AND THE BASELINE IS KEYED TO THE SYMBOL ──────
//
// Every developing-bar / seed path asks "is this live price plausible?" by comparing it
// with two baselines: the last PAINTED bar's close and the last clean SERVER close.
//
// ⛔⛔ (2026-11-11) BOTH BASELINES ARE PER-SYMBOL STATE, AND THEY WERE READ AS IF GLOBAL.
// The chart's refs hold them, and on a symbol switch they still hold the PREVIOUS ticker's
// closes until the new symbol paints (the server close was never reset at all). So every
// switch between names more than 50% apart in price (META -> GOOGL, NFLX -> AMD) judged the
// new symbol's first prices against the old one: its today-seed was refused (the daily
// chart waited a full round trip) and its first live ticks were dropped. A baseline is
// only a baseline FOR the symbol it was taken from; this module is the one place that
// decides which baselines may judge a price for `sym`, and every call site goes through it.

const _up = (s) => (s == null ? null : String(s).toUpperCase())

/**
 * The single price-plausibility rule: non-finite / non-positive, or more than 50% away from
 * EITHER baseline, is rejected (the DDOG 20798 = 100x phantom). A missing baseline is not
 * consulted. Pure — it never knows which symbol the baselines belong to; that is
 * `baselinesFor`'s job.
 */
export function isSaneLivePrice(p, lastClose, serverClose) {
  if (!Number.isFinite(p) || p <= 0) return false
  if (lastClose && lastClose > 0 && Math.abs(p - lastClose) / lastClose > 0.5) return false
  if (serverClose && serverClose > 0 && Math.abs(p - serverClose) / serverClose > 0.5) return false
  return true
}

/**
 * The baselines that may judge a price FOR `sym`. A baseline stamped with another symbol
 * (or with none) is not used. When the server close is not this symbol's yet (the frames
 * between a switch and its first paint), `ownClose` — the close of THIS symbol's own cached
 * set — stands in, so the phantom guard still has a reference.
 *
 * @param {string} sym
 * @param {{ lastBar?: {close:number}|null, lastBarSym?: string|null,
 *           serverClose?: number|null, serverCloseSym?: string|null,
 *           ownClose?: number|null }} s
 */
export function baselinesFor(sym, s = {}) {
  const S = _up(sym)
  const lastClose = (S && s.lastBar && _up(s.lastBarSym) === S && Number.isFinite(+s.lastBar.close))
    ? +s.lastBar.close : null
  const serverClose = (S && _up(s.serverCloseSym) === S && Number.isFinite(+s.serverClose))
    ? +s.serverClose
    : (Number.isFinite(+s.ownClose) && +s.ownClose > 0 ? +s.ownClose : null)
  return { lastClose, serverClose }
}

/** `isSaneLivePrice` with the baselines that belong to `sym` — the call every path makes. */
export function isSaneLivePriceFor(sym, p, s = {}) {
  const b = baselinesFor(sym, s)
  return isSaneLivePrice(p, b.lastClose, b.serverClose)
}

/**
 * The chart's one sanity call, built from getters over its refs so every call site reads
 * them at CALL time. `ownClose` — the judged symbol's OWN cached close, which is the only
 * reference it has between a switch and its first paint — is resolved HERE when a caller
 * does not pass one, so no call site can forget it (a forgotten one dropped BOTH baselines
 * and let a 100x price through on the W/M period seed, 2026-11-11).
 *
 *   const saneFor = makeLiveSane({ lastBar, lastBarSym, serverClose, serverCloseSym, ownClose })
 *   saneFor(sym, price)                    // baselines of `sym` only
 *   saneFor(sym, price, { lastClose })     // plus a close the caller KNOWS is sym's
 */
export function makeLiveSane(get) {
  return (forSym, p, { lastClose, ownClose } = {}) => {
    let own = ownClose
    if (own === undefined) { try { own = get.ownClose ? get.ownClose(forSym) : null } catch { own = null } }
    const known = lastClose !== undefined
    return isSaneLivePriceFor(forSym, p, {
      lastBar: known ? (lastClose == null ? null : { close: lastClose }) : get.lastBar(),
      lastBarSym: known ? forSym : get.lastBarSym(),
      serverClose: get.serverClose(),
      serverCloseSym: get.serverCloseSym(),
      ownClose: own,
    })
  }
}
