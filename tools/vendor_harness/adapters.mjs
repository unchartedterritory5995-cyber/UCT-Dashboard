// tools/vendor_harness/adapters.mjs
//
// ─── LEGACY CAPTURES → THE v1 FORMAT, OR A NAMED REASON WHY NOT ───────────────
//
// `tests/fixtures/vendor/` grew one format per capture programme. Two of those
// formats carry everything a bar-by-bar comparison needs — the VENDOR'S OWN
// OHLCV, the script source, and per-bar study values — and are adapted here:
//
//   observation   `observations/*.json` (vendor_truth.py's store): one plotted
//                 value per bar, keyed by time, beside `market.bars`. The plot is
//                 named by the observation's own `engine.formula`, so mapping
//                 uses selector M0 — never a guess by position.
//   probe-rows    `seed-warmup-*.json`, `w2-warmup-*.json`: rows of
//                 `{bar_index, date, o, h, l, c[, v], <column>…}` from a probe in
//                 `tools/visual_conformance/probes/`, with the probe's sha256.
//
// Every other file is reported with the reason it cannot be compared (no vendor
// OHLCV, no source, a four-row tail, a derived output…). ⛔ NOTHING IS SILENTLY
// SKIPPED: the corpus runner lists every file it saw.
//
// ⛔ AN ADAPTER NEVER INVENTS A NUMBER. It re-shapes what the legacy file holds;
// where the legacy file lacks something (volume, pricescale) the v1 field is
// null and the verdict says so.

import { SCHEMA_ID, BAR_FIELDS, sha256Hex, sealCapture } from './schema.mjs'

/** A probe-rows fixture whose columns were RENAMED from the probe's plot titles
 *  when it was recorded. The alias is DECLARED here, per fixture, and every
 *  target is checked against the probe source's own `plot(…, "title")` at adapt
 *  time — a typo or a probe edit refuses the adaptation rather than mapping a
 *  column onto the wrong plot. */
export const DECLARED_COLUMN_TITLES = {
  'seed-warmup-spy-12m-2026-09-21.json': {
    change: 'N06_change_close_bar0_is_the_reading',
    ema5: 'N08_ema5_SEED_QUESTION_compare_to_N09_at_bar4',
    sma5: 'N09_sma5_THE_DISCRIMINATOR_FOR_N08',
    atr5: 'N10_atr5',
    rma_tr_true_5: 'N11_rma_of_tr5_MUST_EQUAL_N10',
    sma_tr_true_5: 'N12_sma_of_tr5_SEED_DISCRIMINATOR',
    stdev5: 'N13_stdev5_POPULATION_OR_SAMPLE',
    sum5: 'N15_sum5_PRE_WINDOW_na_or_partial',
  },
}

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
const num = (x) => (x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null)

/** The `indicator("…")` title a Pine source declares, or null. */
export function declaredTitle(source) {
  const m = /\bindicator\s*\(\s*(?:title\s*=\s*)?"([^"]*)"/.exec(String(source || ''))
  return m ? m[1] : null
}

/** Every plot title a Pine source declares with a literal string, in order. */
export function declaredPlotTitles(source) {
  const out = []
  const re = /\bplot\s*\(([^\n]*)\)/g
  let m
  while ((m = re.exec(String(source || '')))) {
    const t = /(?:title\s*=\s*)?"([^"]*)"/.exec(m[1])
    if (t) out.push(t[1])
  }
  return out
}

/**
 * What kind of file this is.
 * @returns {{format: 'harness-v1'|'observation'|'probe-rows'|'unsupported', reason?: string}}
 */
export function detectFormat(json, basename) {
  if (!isObj(json)) return { format: 'unsupported', reason: 'not a JSON object' }
  if (json.schema === SCHEMA_ID) return { format: 'harness-v1' }
  if (isObj(json.market) && Array.isArray(json.market.bars) && isObj(json.script) && isObj(json.vendor)) {
    const b = json.market.bars[0]
    const hasOhlc = b && ['o', 'h', 'l', 'c'].every((k) => Number.isFinite(Number(b[k])) && b[k] !== null)
    const unixT = b && Number(b.t) > 1e9
    if (!hasOhlc || !unixT) {
      return { format: 'unsupported', reason: 'market.bars does not carry the vendor\'s OHLCV with a unix time (bar_index or nulls in `t`/OHLC) — the series cannot be recomputed' }
    }
    if (!isObj(json.vendor.values)) return { format: 'unsupported', reason: 'vendor readings are not a per-bar `values` series (split rows or named samples) — nothing contiguous to compare bar by bar' }
    // ⛔ ONE NUMBER PER BAR, OR NOTHING. A reading that is itself an object
    // (`{falling_real_builtin: 0, falling_real_candMonotone: 0, …}`) is a set of
    // NAMED candidates read off a table view, not the study's plotted value — and
    // coercing it to a number manufactures `na` on every bar.
    const bad = Object.values(json.vendor.values).filter((v) => !(v === null || (typeof v === 'number' && Number.isFinite(v))))
    if (bad.length) return { format: 'unsupported', reason: `vendor.values holds ${bad.length} readings that are not one plotted number (named candidate readings) — no single plot to compare` }
    if (!json.engine || typeof json.engine.formula !== 'string') return { format: 'unsupported', reason: 'the observation names no plot (`engine.formula` is empty), so its values cannot be mapped to one of our plots' }
    return { format: 'observation' }
  }
  if (Array.isArray(json.rows) && typeof json._probe === 'string' && json.rows[0]
      && ['o', 'h', 'l', 'c'].every((k) => k in json.rows[0]) && 'bar_index' in json.rows[0]) {
    return { format: 'probe-rows' }
  }
  // ── the named reasons, most specific first ──
  if (json.source && json.source.kind && /BUILT-IN/i.test(json.source.kind)) {
    return { format: 'unsupported', reason: 'vendor built-in study — no Pine source exists to run on our side' }
  }
  if (Array.isArray(json.bars) && json.bars[0] && 't' in json.bars[0] && typeof json.bars[0].t === 'string' && /api\/bars|OUR|our own/i.test(String(json._ || ''))) {
    return { format: 'unsupported', reason: 'these are OUR bars (/api/bars), not the vendor\'s — a companion file, not a capture' }
  }
  if (Array.isArray(json.rows) && json.rows[0] && 'vendor_value' in json.rows[0]) {
    return { format: 'unsupported', reason: 'a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture' }
  }
  if (json.payload && (json.payload.tail || Object.values(json.payload).some((v) => v && v.tail))) {
    return { format: 'unsupported', reason: 'the capture holds a short tail of study values but NOT the vendor\'s OHLCV — our side cannot be run on the vendor\'s bars' }
  }
  if (Array.isArray(json.payload) && Array.isArray(json.columns)) {
    return { format: 'unsupported', reason: 'study values without the vendor\'s OHLCV — our side cannot be run on the vendor\'s bars' }
  }
  if (json.plots && Array.isArray(json.plots.rows) && json.plots.rows.length < 10) {
    return { format: 'unsupported', reason: `only ${json.plots.rows.length} hand-read rows and no vendor OHLCV series` }
  }
  if (basename && /schema|divergences/.test(basename)) return { format: 'unsupported', reason: 'not a capture (schema / divergence register)' }
  return { format: 'unsupported', reason: 'no vendor OHLCV series together with per-bar study values and a script source' }
}

/** vendor_truth.py observation → v1. */
export function fromObservation(obs, { path = null } = {}) {
  const source = obs.script.source
  const rows = obs.market.bars.map((b) => [Number(b.t), num(b.o), num(b.h), num(b.l), num(b.c), num(b.v)])
  const times = new Set(rows.map((r) => String(r[0])))
  const valueRows = Object.entries(obs.vendor.values)
    .map(([t, v]) => [Number(t), num(v)])
    .sort((a, b) => a[0] - b[0])
  const offGrid = valueRows.filter((r) => !times.has(String(r[0]))).length
  const decl = Number.isInteger(obs._vendor_parity_warmup_bars)
    ? { bars: obs._vendor_parity_warmup_bars, source: 'legacy `_vendor_parity_warmup_bars` — fitted to where this capture stopped disagreeing, so read the DERIVED lookback beside it' }
    : null
  const cap = {
    schema: SCHEMA_ID,
    id: obs.id,
    adaptedFrom: { format: 'observation', path, note: 'adapted from a vendor_truth.py observation; the receipt below was sealed by the adapter, not by the page' },
    capturedAtUTC: obs.provenance && obs.provenance.when || null,
    symbol: { name: obs.market.symbol, pro_name: obs.market.symbol, pricescale: null, timezone: 'America/New_York' },
    timeframe: obs.market.timeframe,
    newestBarIsForming: false,
    source: { text: source, sha256: sha256Hex(source), chars: source.length },
    bars: { fields: BAR_FIELDS, timeUnit: 'unix-s', count: rows.length, rows },
    study: {
      title: declaredTitle(source),
      plots: [{ id: 'plot_0', type: 'line', title: null, selector: { formula: obs.engine.formula } }],
    },
    plotValues: { fields: ['time', 'plot_0'], rows: valueRows },
    tolerance: Number.isInteger(obs.vendor.readDecimals) ? { readDecimals: obs.vendor.readDecimals } : null,
    ...(decl ? { warmup: decl } : {}),
    history: { startsAtBar0: false, why: 'an observation window starts deep in the symbol\'s history' },
    ...(obs.expect && typeof obs.expect.explains === 'string' ? { explains: obs.expect.explains } : {}),
    ...(offGrid ? { adapterNotes: [`${offGrid} vendor values have times that are not bars in market.bars`] } : {}),
  }
  return sealCapture(cap)
}

/**
 * probe-rows fixture → v1.
 * @param {object} fix
 * @param {{basename: string, readProbe: (relPath: string) => string}} io
 */
export function fromProbeRows(fix, { basename, readProbe }) {
  const source = readProbe(fix._probe)
  const sha = sha256Hex(source)
  // The probe files are stored with and without a trailing newline in different
  // places; the fixture records the sha of the file as committed.
  if (fix._probeSha256 && sha !== fix._probeSha256) {
    return { refused: `probe ${fix._probe} sha256 ${sha.slice(0, 12)}… is not the ${fix._probeSha256.slice(0, 12)}… the capture was taken with — the script on disk is not the script the vendor ran` }
  }
  const skip = new Set(['bar_index', 'date', 'o', 'h', 'l', 'c', 'v'])
  const columns = Object.keys(fix.rows[0]).filter((k) => !skip.has(k))
  const alias = DECLARED_COLUMN_TITLES[basename] || null
  const titles = declaredPlotTitles(source)
  const titleOf = (col) => (alias ? alias[col] : col)
  const missing = columns.filter((c) => !titles.includes(titleOf(c)))
  if (missing.length) {
    return { refused: `columns ${missing.join(', ')} name no \`plot(…, "title")\` in ${fix._probe}${alias ? ' (after the declared alias)' : ''} — mapping them would be a guess` }
  }
  const rows = fix.rows.map((r) => [String(r.date), num(r.o), num(r.h), num(r.l), num(r.c), 'v' in r ? num(r.v) : null])
  const consecutive = fix.rows.every((r, i) => r.bar_index === fix.rows[0].bar_index + i)
  const plots = columns.map((c, i) => ({ id: `plot_${i}`, type: 'line', title: titleOf(c), legacyColumn: c }))
  const cap = {
    schema: SCHEMA_ID,
    id: basename.replace(/\.json$/, ''),
    adaptedFrom: {
      format: 'probe-rows', path: basename,
      note: alias ? 'columns were renamed at record time; titles restored through DECLARED_COLUMN_TITLES and checked against the probe source' : 'column names are the probe\'s plot titles',
    },
    capturedAtUTC: fix._capturedUTC || null,
    symbol: { name: fix._symbol, pro_name: fix._symbol, pricescale: null, timezone: 'Etc/UTC' },
    timeframe: fix._tf,
    newestBarIsForming: false,
    source: { text: source, sha256: sha, chars: source.length, path: fix._probe },
    bars: { fields: BAR_FIELDS, timeUnit: 'iso-date', count: rows.length, rows },
    study: { title: declaredTitle(source), plots },
    plotValues: {
      fields: ['time', ...plots.map((p) => p.id)],
      rows: fix.rows.map((r) => [String(r.date), ...columns.map((c) => num(r[c]))]),
    },
    tolerance: null,
    history: {
      startsAtBar0: fix.rows[0].bar_index === 0 && consecutive,
      why: `rows carry bar_index ${fix.rows[0].bar_index}..${fix.rows[fix.rows.length - 1].bar_index}${consecutive ? '' : ' (NOT consecutive)'}`,
    },
    ...(rows.some((r) => r[5] === null) ? { adapterNotes: ['the capture carries no volume; our side is handed volume 0'] } : {}),
  }
  return sealCapture(cap)
}
