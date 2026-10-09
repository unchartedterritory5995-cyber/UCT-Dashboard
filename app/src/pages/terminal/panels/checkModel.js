// CHK: the pure half of the pre-trade check (wave 8, lane F). No reads, no state.
//
// Every read the panel makes is an EXISTING route in api/routers/intelligence.py (paid, mounted in
// api/main.py, not behind a feature flag; each answers from the uct_intelligence engine):
//   GET /api/setup-templates                       the setup names the member picks from
//   GET /api/pre-trade-checklist?symbol&setup_type&entry_price&stop_price
//   GET /api/setup-performance/{setup}?regime=     win rate for that setup (ALL, and today's phase)
//   GET /api/analogs?setup_type&regime&limit       past trades of that setup in today's phase
//   GET /api/risk-summary                          the member's open book against the phase limits
//
// When the engine is not loaded on the server, the routes say so in their body (`error`, or an
// empty `heat`), and the panel says so too. It never fills a section in.

export const TEMPLATES_URL = '/api/setup-templates'
export const RISK_URL = '/api/risk-summary'
export const ANALOGS_N = 5
/** The heat ceiling the engine itself warns at (uct_intelligence/risk.py). */
export const MAX_HEAT_PCT = 5

const q = (v) => encodeURIComponent(String(v))

export function checklistUrl({ sym, setup, entry, stop }) {
  if (!sym || !setup || entry == null || stop == null) return null
  return `/api/pre-trade-checklist?symbol=${q(sym)}&setup_type=${q(setup)}&entry_price=${q(entry)}&stop_price=${q(stop)}`
}

export function perfUrl(setup, regime = 'ALL') {
  if (!setup || !regime) return null
  return `/api/setup-performance/${q(setup)}?regime=${q(regime)}`
}

export function analogsUrl(setup, regime, limit = ANALOGS_N) {
  if (!setup || !regime) return null
  return `/api/analogs?setup_type=${q(setup)}&regime=${q(regime)}&limit=${limit}`
}

export const num = (v) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

/** The engine's own "I am not loaded" answer, as a sentence, or null. */
export function engineMissing(body) {
  if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) return body.error
  return null
}

/** The setup names, as Select options, sorted by family then name. */
export function setupOptions(body) {
  const list = Array.isArray(body?.templates) ? body.templates : []
  const seen = new Set()
  const out = []
  for (const t of list) {
    const name = String(t?.name || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({ value: name, label: t?.family ? `${name} (${t.family})` : name, family: String(t?.family || '') })
  }
  out.sort((a, b) => a.family.localeCompare(b.family) || a.value.localeCompare(b.value))
  return out.map(({ value, label }) => ({ value, label }))
}

/** Today's market phase: the risk summary's, else the checklist's. Null when neither knows. */
export function phaseOf(risk, checklist) {
  const a = typeof risk?.regime_phase === 'string' ? risk.regime_phase.trim() : ''
  if (a) return a
  const b = typeof checklist?.regime?.phase === 'string' ? checklist.regime.phase.trim() : ''
  return b && b !== 'Unknown' ? b : null
}

/** The checklist's yes / no checks. `ok` is true, false, or null (could not be judged). */
export function checklistChecks(c) {
  if (!c || typeof c !== 'object') return []
  const regime = c.regime || {}
  const risk = c.risk || {}
  const maxStop = num(risk.max_stop_pct)
  return [
    {
      id: 'template',
      label: 'The setup is in the library',
      ok: c.template_found === true,
      detail: c.template_found === true ? null : 'No rules were found for this setup name.',
    },
    {
      id: 'regime',
      label: 'Today\'s market phase suits this setup',
      ok: c.template_found === true ? regime.regime_compatible === true : null,
      detail: regime.phase ? `Phase: ${regime.phase}` : null,
    },
    {
      id: 'stop',
      label: 'The stop is within the setup\'s maximum',
      ok: typeof risk.stop_within_max === 'boolean' ? risk.stop_within_max : null,
      detail: maxStop === null ? 'This setup sets no maximum stop.' : `Maximum ${maxStop}%`,
    },
  ]
}

/**
 * The planned trade against the member's open book and today's phase limits. `sizePct` is the
 * position as a share of the account; `riskPct` the account share at risk. Each check's `ok` is
 * true, false, or null when the summary did not carry the number.
 */
export function bookChecks(risk, { sizePct = null, riskPct = null } = {}) {
  if (!risk || typeof risk !== 'object') return []
  const limits = risk.limits || {}
  const heat = num(risk.heat?.total_heat_pct)
  const exposure = num(risk.current_exposure_pct)
  const count = num(risk.open_position_count)
  const maxExposure = num(limits.exposure)
  const maxPosition = num(limits.max_position)
  const maxPositions = num(limits.max_positions)
  const size = num(sizePct)
  const atRisk = num(riskPct)
  const out = []
  if (exposure !== null && maxExposure !== null) {
    const after = size !== null ? exposure + size : exposure
    out.push({ id: 'exposure', label: size !== null ? 'Exposure after this trade' : 'Exposure now',
      value: after, limit: maxExposure, unit: '%', ok: after <= maxExposure })
  }
  if (size !== null && maxPosition !== null) {
    out.push({ id: 'position', label: 'This position', value: size, limit: maxPosition, unit: '%', ok: size <= maxPosition })
  }
  if (count !== null && maxPositions !== null) {
    const after = count + 1
    out.push({ id: 'count', label: 'Open positions with this one', value: after, limit: maxPositions, unit: '', ok: after <= maxPositions })
  }
  if (heat !== null) {
    const after = atRisk !== null ? heat + atRisk : heat
    out.push({ id: 'heat', label: atRisk !== null ? 'Portfolio heat after this trade' : 'Portfolio heat now',
      value: after, limit: MAX_HEAT_PCT, unit: '%', ok: after <= MAX_HEAT_PCT })
  }
  return out
}

/** True when the risk summary came back without the engine (the route's empty fallback). */
export function riskEngineMissing(risk) {
  if (!risk || typeof risk !== 'object') return true
  return !risk.regime_phase && (!risk.heat || Object.keys(risk.heat).length === 0)
}

/** The closest few analogs, in the engine's order (most recent first). */
export function analogRows(body, n = ANALOGS_N) {
  const list = Array.isArray(body?.analogs) ? body.analogs : []
  return list.slice(0, n).map((a, i) => ({
    key: `${a?.symbol || '?'}-${a?.date_flagged || i}-${i}`,
    sym: String(a?.symbol || '').toUpperCase() || null,
    date: a?.date_flagged || null,
    status: a?.status || null,
    entry: num(a?.entry_price),
    outcome: num(a?.pct_change),
    days: num(a?.days_held),
  }))
}

// ── This ticker ───────────────────────────────────────────────────────────────────────────────
// GET /api/analogs?…&symbol=  keeps one ticker's past trades of the setup. The engine has no
// symbol filter (and the engine package is never changed), so the ROUTE reads the setup's latest
// window and keeps that ticker's rows; it echoes `symbol`, `scanned` and `complete`. A server
// that does not echo `symbol` ignored the filter, so its rows are never shown as this ticker's.
// GET /api/j2/trades?symbol=&limit=  the member's own closed Journal 2.0 trades (read only). The
// journal's symbol filter is a PREFIX match (NV finds NVDA and NVAX), so rows are kept exact here.

export const JOURNAL_N = 10
/** Rows asked of the journal: room for prefix neighbours before the exact filter. */
export const JOURNAL_ASK = 50

export function tickerAnalogsUrl(setup, regime, sym, limit = ANALOGS_N) {
  const s = String(sym || '').trim().toUpperCase()
  if (!setup || !regime || !s) return null
  return `/api/analogs?setup_type=${q(setup)}&regime=${q(regime)}&limit=${limit}&symbol=${q(s)}`
}

/**
 * The this-ticker answer, as one of:
 *   { state: 'rows', rows }          past trades of this setup in this ticker
 *   { state: 'none' }                the whole record was read and holds none
 *   { state: 'partial', scanned }    none in the latest `scanned` trades read (older ones unread)
 *   { state: 'unread' }              nothing was read (the engine is not loaded on this server)
 *   { state: 'unsupported' }         the server did not filter by ticker
 */
export function tickerAnalogView(body, sym, n = ANALOGS_N) {
  const s = String(sym || '').trim().toUpperCase()
  if (!body || typeof body !== 'object' || !s) return null
  if (String(body.symbol || '').toUpperCase() !== s) return { state: 'unsupported' }
  const rows = analogRows(body, Number.MAX_SAFE_INTEGER).filter((r) => r.sym === s).slice(0, n)
  if (rows.length) return { state: 'rows', rows }
  if (body.complete === true) return { state: 'none' }
  const scanned = num(body.scanned)
  if (!scanned) return { state: 'unread' }
  return { state: 'partial', scanned }
}

export function journalTradesUrl(sym, limit = JOURNAL_ASK) {
  const s = String(sym || '').trim().toUpperCase()
  return s ? `/api/j2/trades?symbol=${q(s)}&limit=${limit}` : null
}

/** The member's own closed trades in exactly this ticker, newest entry first (the route's order). */
export function journalRows(body, sym, n = JOURNAL_N) {
  const s = String(sym || '').trim().toUpperCase()
  const list = Array.isArray(body?.trades) ? body.trades : []
  return list
    .filter((t) => String(t?.symbol || '').trim().toUpperCase() === s)
    .slice(0, n)
    .map((t, i) => {
      const frac = num(t?.pnlPercent)
      return {
        key: `${t?.id ?? i}-${i}`,
        entryDate: typeof t?.entryDate === 'string' ? t.entryDate.slice(0, 10) : null,
        exitDate: typeof t?.exitDate === 'string' ? t.exitDate.slice(0, 10) : null,
        side: t?.side || null,
        setup: typeof t?.setup === 'string' && t.setup.trim() ? t.setup.trim() : null,
        pnlPct: frac === null ? null : frac * 100,
        r: num(t?.rMultiple),
      }
    })
}
