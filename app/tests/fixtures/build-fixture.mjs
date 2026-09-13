#!/usr/bin/env node
/**
 * build-fixture.mjs — regenerate the options-flow golden-harness INPUT fixtures
 * from a raw production capture.
 *
 * This does NOT touch flow_golden.json (that is the OUTPUT; see README.md).
 * Run it only when you want to refresh the input data itself.
 *
 * Usage (from repo root):
 *   curl -s --compressed -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120" \
 *     "https://uctintelligence.com/api/flow/data?days=10" \
 *     -o app/tests/fixtures/_raw_flow10.csv
 *   curl -s --compressed -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120" \
 *     "https://uctintelligence.com/api/top-flow/history" \
 *     -o app/tests/fixtures/_raw_top_flow_history.json
 *   node app/tests/fixtures/build-fixture.mjs
 *
 * (Cloudflare 1010-blocks bare curl/python user agents — the browser UA is required.)
 *
 * SAMPLING POLICY — deliberately blind to the curation logic
 * ----------------------------------------------------------
 * Rows are NOT hand-picked. We select whole TICKERS via a stable hash
 * (`fnv1a(sym) % TICKER_MODULUS === 0`) and then keep EVERY row for the
 * selected tickers, across every date in the capture. That matters because
 * processFlowData clusters by (ticker, CP, strike, expiry) and the cancel-pair
 * / ML-match filters are order- and sibling-sensitive: dropping arbitrary rows
 * inside a ticker would silently change the clustering, so the golden would
 * not describe the real algorithm.
 *
 * The hash keys only on the ticker symbol — never on premium, color, grade,
 * side, or type — so the sample cannot be biased toward "clean" flow. Every
 * ETF/INDEX-tagged ticker is additionally force-included (there are very few
 * of them in the stocks feed and they exercise the isETF()/isStock() split).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_CSV = path.join(HERE, "_raw_flow10.csv");
const RAW_TFH = path.join(HERE, "_raw_top_flow_history.json");
const OUT_CSV = path.join(HERE, "flow_sample.csv");
const OUT_TFH = path.join(HERE, "top_flow_picks.json");

const TICKER_MODULUS = 11;

/** 32-bit FNV-1a — stable across machines and Node versions. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function splitCsvLine(line) {
  // The BBS/flow export never quotes fields containing commas in practice,
  // but be defensive anyway.
  if (line.indexOf('"') === -1) return line.split(",");
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ── CSV ────────────────────────────────────────────────────────────────────
const raw = fs.readFileSync(RAW_CSV, "utf8").replace(/\r/g, "");
const lines = raw.split("\n").filter((l) => l.trim().length > 0);
const header = lines[0];
const cols = splitCsvLine(header);
const iSym = cols.indexOf("Symbol");
const iEtf = cols.indexOf("StockEtf");
if (iSym < 0) throw new Error("Symbol column not found — is this a BBS-order flow export?");

const parsed = lines.slice(1).map((l) => ({ line: l, f: splitCsvLine(l) }));
const allSyms = [...new Set(parsed.map((r) => r.f[iSym]))].filter(Boolean);

const keep = new Set(allSyms.filter((s) => fnv1a(s) % TICKER_MODULUS === 0));
// Force-include every ETF/INDEX-tagged ticker (rare in the stocks feed, but
// they drive the isStock()/isETF() branch in wlPopulate).
if (iEtf >= 0) {
  for (const r of parsed) {
    const tag = (r.f[iEtf] || "").toUpperCase();
    if (tag === "ETF" || tag === "INDEX") keep.add(r.f[iSym]);
  }
}

const selected = parsed.filter((r) => keep.has(r.f[iSym]));
fs.writeFileSync(OUT_CSV, header + "\n" + selected.map((r) => r.line).join("\n") + "\n", "utf8");

// ── top-flow history ───────────────────────────────────────────────────────
// Trim the tracker history to picks on the sampled tickers only. wlPopulate's
// dedup() reads `topFlowPicks.active[].history[].oi` to compute the EXIT
// penalty, so keeping real picks that overlap the sampled tickers is what
// actually exercises that branch.
const tfh = JSON.parse(fs.readFileSync(RAW_TFH, "utf8"));
const trim = (arr) => (Array.isArray(arr) ? arr.filter((p) => keep.has(p.sym)) : []);
const outTfh = { active: trim(tfh.active), archived: trim(tfh.archived) };
fs.writeFileSync(OUT_TFH, JSON.stringify(outTfh, null, 2) + "\n", "utf8");

// ── report ─────────────────────────────────────────────────────────────────
const count = (idx) => {
  const m = new Map();
  for (const r of selected) m.set(r.f[idx], (m.get(r.f[idx]) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
console.log(`tickers kept : ${keep.size} / ${allSyms.length} (mod ${TICKER_MODULUS})`);
console.log(`rows kept    : ${selected.length} / ${parsed.length}`);
for (const name of ["CreatedDate", "Type", "Side", "Color", "CallPut", "StockEtf", "ER", "Uoa"]) {
  const i = cols.indexOf(name);
  if (i >= 0) console.log(`${name.padEnd(12)}: ${JSON.stringify(Object.fromEntries(count(i)))}`);
}
console.log(`top-flow picks: active=${outTfh.active.length} archived=${outTfh.archived.length}`);
console.log(`wrote ${OUT_CSV}`);
console.log(`wrote ${OUT_TFH}`);
