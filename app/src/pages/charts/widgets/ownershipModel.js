/**
 * ownershipModel — the Ownership tab's row model and value language.
 *
 * Pure functions, no React, mirroring earningsRows.js so the two tabs are
 * testable and readable the same way.
 *
 * EVERY SECTION HAS ONE JOB, and no metric is stated twice:
 *   Snapshot      how much of the company is held, and by whom broadly
 *   Institutional how that holding is CHANGING (13F position flow)
 *   Top holders   WHO holds it
 *   Insiders      what management and directors did with their own money
 *   Positioning   supply: float, shares out, short
 *
 * THE HARDEST THING HERE IS NOT LYING ABOUT TIME. 13F is filed up to 45 days
 * after a quarter closes, Form 4 within two business days, and FINRA short
 * interest twice a month. Presenting any of it as "now" is the standard way
 * ownership data misleads people, so every section that is delayed carries its
 * own as-of, and the wording is always about what a FILING says rather than
 * what someone did.
 */

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── formatting ──────────────────────────────────────────────────────────────
export function fmtShares(v) {
  const n = num(v)
  if (n == null) return '—'
  const a = Math.abs(n)
  const s = n < 0 ? '−' : ''
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}K`
  return `${s}${a.toFixed(0)}`
}

export function fmtMoney(v) {
  const n = num(v)
  if (n == null) return '—'
  const a = Math.abs(n)
  const s = n < 0 ? '−' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${a.toFixed(0)}`
}

export const fmtPct = (v, d = 1) => (num(v) == null ? '—' : `${Number(v).toFixed(d)}%`)
export const fmtSigned = (v, d = 1) =>
  (num(v) == null ? '—' : `${Number(v) > 0 ? '+' : Number(v) < 0 ? '−' : ''}${Math.abs(Number(v)).toFixed(d)}%`)

export function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtDateShort(iso) {
  if (!iso) return null
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "2026Q2" → "Q2 2026". The label a filing is actually known by. */
export function quarterLabel(q) {
  const m = /^(\d{4})Q([1-4])$/.exec(String(q || ''))
  return m ? `Q${m[2]} ${m[1]}` : null
}

/** The last calendar day of a 13F reporting quarter — what "as of" means. */
export function quarterEnd(q) {
  const m = /^(\d{4})Q([1-4])$/.exec(String(q || ''))
  if (!m) return null
  const ends = { 1: '-03-31', 2: '-06-30', 3: '-09-30', 4: '-12-31' }
  return `${m[1]}${ends[m[2]]}`
}

// ── snapshot ────────────────────────────────────────────────────────────────
/**
 * The compact strip: how much of the company is spoken for.
 *
 * Institutional and insider percentages come from the SAME yfinance quote
 * summary, so they are comparable with each other. Short float is FINRA via the
 * same payload. Only entries that genuinely exist appear.
 */
export function snapshotFacts(own, full) {
  const out = []
  const inst = num(own?.institutional?.pct_held)
  if (inst != null) out.push({ key: 'inst', label: 'Institutional', value: fmtPct(inst) })

  const insider = num(full?.held_pct_insiders)
  if (insider != null) out.push({ key: 'insider', label: 'Insider', value: fmtPct(insider) })

  const shortPct = num(own?.short?.short_pct_float)
  if (shortPct != null) {
    out.push({
      key: 'short', label: 'Short float', value: fmtPct(shortPct),
      // Heavily shorted is a fact worth seeing at a glance, but it is not a
      // verdict — no colour, just the number.
      accent: shortPct >= 10,
    })
  }
  const float = num(own?.share_counts?.float_shares)
  if (float != null) out.push({ key: 'float', label: 'Float', value: fmtShares(float) })
  return out
}

// ── institutional position flow (13F) ───────────────────────────────────────
/**
 * How institutional ownership CHANGED over the reported quarter.
 *
 * Every one of these is a count of FILINGS, not of trades: "42 new positions"
 * means 42 filers reported a holding they had not reported before, which is why
 * the labels below say "positions" and never "bought".
 */
export function institutionalFlow(own) {
  const tf = own?.thirteen_f
  const s = tf?.summary
  if (!s) return null

  const rows = []
  const holders = num(s.investors_holding)
  if (holders != null) {
    rows.push({
      key: 'holders', label: 'Institutions holding', value: holders.toLocaleString(),
      delta: num(s.investors_change), deltaFmt: (v) => `${v > 0 ? '+' : '−'}${Math.abs(v)}`,
    })
  }
  const pct = num(s.ownership_pct)
  if (pct != null) {
    rows.push({
      key: 'pct', label: 'Ownership', value: fmtPct(pct),
      delta: num(s.ownership_change), deltaFmt: (v) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}pp`,
    })
  }
  const inv = num(s.total_invested)
  if (inv != null) {
    rows.push({
      key: 'value', label: 'Value held', value: fmtMoney(inv),
      delta: num(s.total_invested_change),
      deltaFmt: (v) => `${v > 0 ? '+' : '−'}${fmtMoney(Math.abs(v)).replace('−', '')}`,
    })
  }

  // ── the position flow, as TWO SIDES rather than four numbers ────────────
  // New + Increased is one behaviour and Reduced + Exited is the opposite one.
  // Rendered as four equal-weight counts they competed with each other and the
  // reader had to do the grouping; grouped, the balance is the first thing you
  // see. The side TOTAL leads and its parts follow, so the comparison is
  // between two numbers, not eight.
  const side = (keys, tone) => {
    const parts = keys
      .map(([k, label]) => ({ key: k, label, value: num(s[k]) }))
      .filter(p => p.value != null)
    if (!parts.length) return null
    return { tone, parts, total: parts.reduce((a, p) => a + p.value, 0) }
  }
  const accumulation = side([['new_positions', 'new'], ['increased_positions', 'increased']], 'up')
  const distribution = side([['reduced_positions', 'reduced'], ['closed_positions', 'exited']], 'down')

  if (!rows.length && !accumulation && !distribution) return null
  return {
    rows, accumulation, distribution,
    quarter: tf.quarter,
    quarterLabel: quarterLabel(tf.quarter),
    asOf: quarterEnd(tf.quarter),
  }
}

// ── insider role normalisation (§8) ─────────────────────────────────────────
/**
 * FMP's `typeOfOwner` is prose ("officer: Chief Executive Officer"), which is
 * accurate and too long for a 62px column. These map ONLY the titles whose
 * abbreviation is unambiguous.
 *
 * ⛔ Anything not matched is returned UNCHANGED. A wrong abbreviation on a
 * filing is worse than a long one — "officer: EVP Global Operations" has no
 * standard short form, so it keeps its own words and the column ellipsises.
 */
const ROLE_MAP = [
  // The word boundaries are load-bearing: a bare /cto/ fires on "Director of
  // Technology" and /cao/ on "Chicago". An acronym only counts as a whole word.
  [/chief executive officer|\bceo\b/i, 'CEO'],
  [/chief financial officer|\bcfo\b/i, 'CFO'],
  [/chief operating officer|\bcoo\b/i, 'COO'],
  [/chief technology officer|\bcto\b/i, 'CTO'],
  [/chief accounting officer|\bcao\b/i, 'CAO'],
  [/chief legal officer|general counsel/i, 'General Counsel'],
  [/^\s*director\s*$/i, 'Director'],
  [/\bchairman\b/i, 'Chairman'],
  [/10%|ten percent/i, '10% owner'],
]

export function normalizeRole(title) {
  const raw = String(title || '').trim()
  if (!raw) return null
  // Strip FMP's "officer: " / "director: " prefix — the role itself follows.
  const body = raw.replace(/^(officer|director)\s*:\s*/i, '').trim() || raw
  for (const [re, short] of ROLE_MAP) {
    if (re.test(body)) return short
  }
  // A bare "director" prefix with no body is still a director.
  if (/^director\b/i.test(raw)) return 'Director'
  return body
}

// ── top holders ─────────────────────────────────────────────────────────────
/**
 * WHO holds it, newest filing first.
 *
 * Prefers the 13F holder list, which carries the position CHANGE. Falls back to
 * the yfinance top-holders table, which does not — and when it does, the change
 * column is absent rather than zero, because "we don't know" and "unchanged"
 * are different statements.
 */
export function topHolders(own) {
  const tf = own?.thirteen_f
  const fromTf = Array.isArray(tf?.holders) ? tf.holders : []
  if (fromTf.length) {
    return {
      source: '13f',
      quarter: tf.quarter,
      quarterLabel: quarterLabel(tf.quarter),
      hasChange: true,
      rows: fromTf.map((h, i) => ({
        key: `${h.name || i}`,
        name: h.name || '—',
        shares: num(h.shares),
        value: num(h.market_value),
        ownership: num(h.ownership),
        changeShares: num(h.change_shares),
        changePct: num(h.change_pct),
        state: h.is_new ? 'new' : h.is_sold_out ? 'exited'
          : num(h.change_shares) > 0 ? 'increased'
            : num(h.change_shares) < 0 ? 'reduced'
              : num(h.change_shares) === 0 ? 'unchanged' : null,
      })),
    }
  }
  const yf = own?.institutional?.holders
  if (Array.isArray(yf) && yf.length) {
    return {
      source: 'yfinance',
      quarter: null,
      quarterLabel: null,
      hasChange: false,
      rows: yf.map((h, i) => ({
        key: `${h.holder || i}`,
        name: h.holder || '—',
        shares: num(h.shares),
        value: num(h.value),
        ownership: num(h.pct_out),
        changeShares: null, changePct: null, state: null,
        date: h.date,
      })),
    }
  }
  return null
}

/** The words a filing supports. NEVER "bought" or "sold" — a 13F says what a
 *  filer held on one date, not what they did or when they did it. */
export const HOLDER_STATE = {
  new: { text: 'New', tone: 'up' },
  increased: { text: 'Increased', tone: 'up' },
  reduced: { text: 'Reduced', tone: 'down' },
  exited: { text: 'Exited', tone: 'down' },
  unchanged: { text: 'Unchanged', tone: 'none' },
}

// ── insiders ────────────────────────────────────────────────────────────────
const DAY = 86400000

/**
 * Insider activity over a window, plus the transactions themselves.
 *
 * ⚠️ The upstream feed (`insider._classify_txn_fmp`) admits ONLY open-market
 * purchases and sales — grants, awards, option exercises, gifts and conversions
 * are filtered out before we ever see them. That is the strongest possible
 * version of this signal, and it is also why there is no transaction-type
 * breakdown here: the other types are not in the data, so a breakdown would be
 * a set of permanent zeros. The UI says which rows it is showing instead.
 */
export function insiderActivity(rows, { days = 90, now = Date.now() } = {}) {
  const all = (rows || []).filter(r => r && r.date)
  if (!all.length) return null
  const cutoff = now - days * DAY
  const recent = all.filter(r => {
    const t = Date.parse(`${String(r.date).slice(0, 10)}T00:00:00Z`)
    return Number.isFinite(t) && t >= cutoff
  })
  const buys = recent.filter(r => r.type === 'buy')
  const sells = recent.filter(r => r.type === 'sell')
  const sum = (list) => list.reduce((a, r) => a + (num(r.amount) || 0), 0)
  const net = sum(buys) - sum(sells)

  return {
    days,
    buyCount: buys.length,
    sellCount: sells.length,
    net,
    // Distinct people, not transactions — three insiders buying is a different
    // fact from one insider buying three times, and only the first is a cluster.
    buyers: new Set(buys.map(r => r.name)).size,
    sellers: new Set(sells.map(r => r.name)).size,
    hasRecent: recent.length > 0,
    // Always the full list: a quiet 90 days is worth saying, but the table
    // should still show the last thing that happened.
    transactions: all.slice(0, 12).map((r, i) => ({
      key: `${r.date}-${r.name}-${i}`,
      date: r.date,
      name: r.name || '—',
      title: r.title || null,
      role: normalizeRole(r.title),
      type: r.type,
      shares: num(r.shares),
      amount: num(r.amount),
      price: num(r.price),
    })),
  }
}

// ── positioning / supply ────────────────────────────────────────────────────
export function positioningFacts(own) {
  const out = []
  const sc = own?.share_counts || {}
  const sh = own?.short || {}
  const add = (key, label, value, hint) => {
    if (value !== '—') out.push({ key, label, value, hint })
  }
  add('float', 'Float', fmtShares(sc.float_shares),
    'Shares available to trade — outstanding less closely-held stock.')
  add('out', 'Shares outstanding', fmtShares(sc.shares_outstanding))
  add('short', 'Shares short', fmtShares(sh.shares_short))
  add('shortpct', 'Short % of float', fmtPct(sh.short_pct_float))
  add('dtc', 'Days to cover', num(sh.days_to_cover) == null ? '—' : Number(sh.days_to_cover).toFixed(1),
    'Shares short divided by average daily volume.')

  // Direction of the short position, month over month. FINRA reports twice a
  // month, so this is a change between two settlement dates, not a trend.
  const cur = num(sh.shares_short)
  const prior = num(sh.prior_month_short)
  if (cur != null && prior != null && prior !== 0) {
    const chg = ((cur - prior) / prior) * 100
    out.push({
      key: 'shortchg', label: 'Short vs prior month', value: fmtSigned(chg, 1),
      // ⚠️ NOT the sign of the number. Short interest FALLING is the
      // constructive reading, so a negative change is GREEN and a positive one
      // RED — the inverse of every other change in this panel, which is exactly
      // why it is spelled out here rather than left to a generic sign rule.
      tone: chg < 0 ? 'up' : chg > 0 ? 'down' : 'none',
      hint: 'Change in shares short against the previous FINRA settlement date. Short interest falling is shown green, rising red.',
    })
  }
  return out.length >= 2 ? out : []
}
