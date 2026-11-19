// UCT Terminal: share a panel. WHICH panels may offer it (owner pick 2026-11-17).
//
// ONE decision, in ONE place: `shareDecision(fn, variant)`. The panel frame (TerminalShell.jsx
// `Panel`) asks it once per panel and draws the Share button only when it says so.
//
// The decision has a DERIVED half and a DATA half:
//
//   derived (from what functions.js already holds; nothing typed twice)
//     * a `door` has no panel, so there is nothing to share;
//     * a `surface` is a whole page inside the panel: the page keeps its own export where it has
//       one (the Screener's "Export CSV", the Breadth Monitor's Share), never a second door.
//
//   data (this file)
//     * `SHARE_CLASS_BY_CODE`: the data class of each function's panel, read from the licensing
//       register (docs/terminal-research/09-security-licensing-cost/licensing-register.md);
//     * `SHARE_POLICY`: what each class may leave the app as. THIS TABLE IS THE WHOLE POLICY:
//       widening sharing for a class is one line here, nothing else.
//
// ⛔ A CODE THAT IS NOT IN THE TABLE IS `unreviewed`, AND `unreviewed` IS NEVER SHARED. So a new
// panel registers in functions.js with no edit here and ships with sharing OFF until somebody
// reads its data and gives it a class. Nothing can be offered by omission; the rail
// (shareRule.test.js) proves that, and prints the codes still waiting for a class.
//
// Why a table and not a rule read off the registry: functions.js holds a function's group, its
// flag and its page section, none of which says where the numbers come from. The source line a
// panel reports to its header is plain words for a reader ("UCT theme tracker (Massive
// prices)"), not a class. A licensing decision guessed from either would be wrong quietly.
//
// What the register says, per class (its legend: A allowed, LA likely allowed for MEMBER
// DISPLAY, R restricted, U unknown):
//   own, uct, public  class A: "no vendor licence anywhere in the path: public domain or UCT's
//                     own content only". The member's own records, UCT's own words, filings
//                     read straight from the SEC (row T-83) and the US Treasury's own published
//                     yields (row T-95).
//   derived, vendor   LA covers showing them to a signed-in member. Leaving the app is a
//                     different use. The rows that speak to it are restrictive: publication to
//                     anyone who is not a member is R on either Massive tier (T-16, T-17, T-19,
//                     T-27, N-23), FMP bars passing its data "or information derived from" it to
//                     a third party (T-34), and a picture a member posts is U pending a
//                     terms-of-use clause (N-24). No row allows a member export of a list.
//   team              the trading team's archive: never shown outside the product (owner ruling
//                     2026-10-17), whatever the policy table says for other classes.
//
// So today only class A shares. The `derived` line is the one the owner is most likely to widen
// (the Breadth Monitor already offers a picture and a CSV of derived numbers, and the Screener a
// CSV); it is his call, not this file's.

/** What each class may leave the app as: a picture, and a file or text (machine-readable). */
export const SHARE_POLICY = Object.freeze({
  own: Object.freeze({ image: true, file: true, why: 'your own records' }),
  uct: Object.freeze({ image: true, file: true, why: 'written by UCT, with no licensed data in it' }),
  public: Object.freeze({ image: true, file: true, why: 'public records read from the SEC or the US Treasury' }),
  derived: Object.freeze({ image: false, file: false, why: 'worked out from licensed market data; the licensing register has no row that allows a member export' }),
  vendor: Object.freeze({ image: false, file: false, why: 'licensed or third-party data; the licensing register restricts passing it on' }),
  team: Object.freeze({ image: false, file: false, why: 'the trading team\'s archive is not shared outside the product' }),
  unreviewed: Object.freeze({ image: false, file: false, why: 'not yet given a data class' }),
})

const CLASS_CODES = {
  // The member's own records.
  // MYH is the member's own trades and note titles on one stock. Its holding rows mark an open
  // position at a live price, and they are a list, never a table, so no price is in a share.
  own: ['PERF', 'RSCH', 'MYH'],
  // UCT's own words: the function list, and the index of UCT's own lessons.
  uct: ['HELP', 'LEARN'],
  // Read straight from the SEC (EDGAR, the fails-to-deliver files), or from the US Treasury's own
  // published daily par yield curve (RATES: register row T-95, class A, no vendor in the path).
  public: ['CF', 'FEED', 'FIL', 'FSRC', 'FTD', 'RATES'],
  // The trading team's archive, or numbers worked out from its calls.
  team: ['WHO', 'HIS', 'CHK'],
  // UCT's own analytics over licensed prices: ranks, returns over a window, breadth, regime.
  derived: ['TECH', 'RTG', 'SEAS', 'DR', 'GRADE', 'REL', 'CORR', 'RRG', 'REGM', 'RSL', 'THMS', 'SCAT', 'IMOV', 'BRKO',
    'SCTR', 'H52', 'RSS', 'PCHG', 'TROT', 'IDAY', 'UNVOL',
    // GRP is PCHG's changes joined with the RS rank and the confluence board for one group: UCT's
    // own analytics over licensed prices (and flow), so it is not shared by default.
    'GRP'],
  // Vendor or third-party values shown as they came, or a list that mixes them in (a live price
  // beside the member's own alert, a quote beside a watchlist name).
  vendor: ['CAL', 'ERN', 'EMOV', 'DES', 'GP', 'CN', 'CATS', 'MOVE', 'FA', 'EE', 'EEH', 'ANR', 'OWN', 'PPL', 'TRAN', 'MB',
    'ASK', 'PEER', 'ETF', 'TWT', 'SIZE', 'TAS', 'PLAN', 'EXMV', 'DPTH', 'EVTS', 'ERX', 'ATTN', 'CONG', 'OMON', 'OVS',
    'IVH', 'VOL', 'POS', 'OHIS', 'OBT', 'OSCR', 'FLOW', 'TIDE', 'STRS', 'LVL', 'FLWL', 'CONFL', 'ACCUM', 'TOPF', 'NEWS',
    'INS', 'SENT', 'MOST', 'ALRT', 'MON', 'UPDG', 'HILO', 'LEAD', 'TSRC',
    // ERNS: a vendor's earnings calendar and results beside UCT's priced and past moves. CEOS: phrases
    // taken from third-party earnings-call transcripts. SHINT, SHRTS: FINRA short interest and short
    // volume licensed through the market-data vendor for display to members (register rows T-93, T-94).
    'ERNS', 'CEOS', 'SHINT', 'SHRTS'],
}

/** `code -> class`, for every function whose panel has been read and classed. */
export const SHARE_CLASS_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(CLASS_CODES).flatMap(([cls, codes]) => codes.map((code) => [code, cls])),
))

/** A code listed under two classes (the table above is typed by hand). Empty when it is sound. */
export const SHARE_CLASS_DUPLICATES = Object.freeze(
  Object.values(CLASS_CODES).flat().filter((code, i, all) => all.indexOf(code) !== i),
)

/** The data class of a function code; `unreviewed` for one nobody has classed yet. */
export function shareClassOf(code) {
  const c = String(code || '').toUpperCase()
  return Object.prototype.hasOwnProperty.call(SHARE_CLASS_BY_CODE, c) ? SHARE_CLASS_BY_CODE[c] : 'unreviewed'
}

const NO = Object.freeze({ offered: false, image: false, file: false })

/**
 * May this panel offer Share, and as what? `fn` is the registry entry, `variant` the one on
 * screen (`fn.ticker` or `fn.market`). Returns `{ offered, image, file, cls, why }`; `why` is
 * one plain clause, for the rail's printout and a reviewer, never shown to a member.
 */
export function shareDecision(fn, variant) {
  if (!fn || !variant || variant.door || (!variant.panel && !variant.surface)) {
    return { ...NO, cls: 'none', why: 'no panel on screen' }
  }
  if (variant.surface) return { ...NO, cls: 'page', why: 'a whole page: it keeps its own export where it has one' }
  const cls = shareClassOf(fn.code)
  const policy = SHARE_POLICY[cls] || SHARE_POLICY.unreviewed
  const image = policy.image === true
  const file = policy.file === true
  return { offered: image || file, image, file, cls, why: policy.why }
}
