import { useEffect, useRef, useState, useMemo, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import TickerPopup from "../components/TickerPopup";
import useLongPress from "../components/mobile/useLongPress";

/**
 * LiveFlowMassive — the PRODUCTION Live Flow page (nav "Live Flow").
 *
 * Sister page to LiveFlow.jsx. Same visual tier system, but polls a
 * different backend that sources data from Massive WS writes to FlowDB
 * instead of Bullflow SSE.
 *
 *   Bullflow SSE  →  liveflow_worker  →  in-memory buffer  →  /api/live/alerts/recent  →  LiveFlow.jsx
 *   Massive WS    →  massive_ws_worker →  FlowDB           →  /api/live/massive/recent →  LiveFlowMassive.jsx
 *
 * Started as a test sister to LiveFlow.jsx; promoted to the nav'd
 * member-facing page (FREE_PAGES, "Live Flow"). LiveFlow.jsx remains at
 * /live-flow as the Bullflow-sourced admin/reference view.
 *
 * Route: /live-massive (mount in app router)
 */

// ─── Palette (matches LiveFlow.jsx) ───────────────────────────────────────
const P = {
  bg: "#0e0f0d",
  cd: "#1a1c17",
  bd: "#2e3127",
  ac: "#c9a84c",
  bl: "#5b9bd5",
  bu: "#4F8266",
  be: "#8F4F4F",
  wh: "#e0dac8",
  dm: "#a8a290",
  mt: "#706b5e",
};

// Direction colors at module scope so every component (incl. TuningPanel's
// auto-push block) can reference them. Some components also declare these
// locally; those locals harmlessly shadow these.
const DIR_BULL = "#6BAA85";
const DIR_BEAR = "#C26A6A";

// Bridge 2026-07-01: bumped from 5000 -> 20000 while flow.db query perf
// (diagnostic 43s for 11K rows) is being addressed. Restore to 5000 once
// /api/live/massive/recent returns to sub-second on the DB side.
const POLL_INTERVAL_MS = 20000;  // 20s (reverted from 5s 2026-07-08): the 5s cadence 4x'd concurrent /recent handler builds (limit=20000 = ~34K-row responses in memory), piling up anyio workers + ballooning RSS → tipped the pre-existing thread burst into OOM crashes. Restore true-instant later via SSE + a capped response, not fast polling.
// SSE instant-tape (dark, VITE_MASSIVE_STREAM=1). When on, new prints arrive via
// EventSource (zero /recent load) and the poll drops to a 60s reconcile. When off
// (default), behavior is unchanged — 20s polling.
const STREAM_ENABLED = (() => {
  try {
    if (import.meta.env.VITE_MASSIVE_STREAM === "1") return true; // global rollout
    // dark-test escapes (don't enable for everyone): ?stream in the URL, or
    // localStorage.setItem('uct.massiveStream','1') in DevTools.
    if (typeof localStorage !== "undefined" && localStorage.getItem("uct.massiveStream") === "1") return true;
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("stream")) return true;
  } catch { /* ignore */ }
  return false;
})();
// SSE curated-tape (dark, VITE_MASSIVE_CURATED_STREAM=1). Independent of the raw
// STREAM_ENABLED above so the curated stream can be armed alone. When on AND in
// curated mode, new CURATED alerts arrive via EventSource the instant the server
// tailer classifies them (instead of waiting up to POLL_INTERVAL_MS); the 20s poll
// stays as the authoritative reconcile. When off (default), curated is unchanged.
const CURATED_STREAM_ENABLED = (() => {
  try {
    if (import.meta.env.VITE_MASSIVE_CURATED_STREAM === "1") return true; // global rollout
    // dark-test escapes: ?curatedstream in the URL, or
    // localStorage.setItem('uct.massiveCuratedStream','1') in DevTools.
    if (typeof localStorage !== "undefined" && localStorage.getItem("uct.massiveCuratedStream") === "1") return true;
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("curatedstream")) return true;
  } catch { /* ignore */ }
  return false;
})();
const STREAM_RECONCILE_MS = 30000;  // 2026-07-09: 60s→30s. Belt-and-suspenders max
// staleness — even a healthy-but-quiet stream reconciles the full authoritative
// list this often, so no user can drift far behind the true tape.
const SSE_STALL_MS = 40000;  // no server contact (a print OR the 15s heartbeat) for
// this long = the EventSource is silently half-dead (proxy dropped it, no onerror)
// → force a reconnect. >2.5x the server's 15s heartbeat so quiet markets don't trip it.
// Default cap on alerts in the live feed. Backend supports up to 20000.
// "All" (20000) is the correct default — curated view has only ~80-150
// rows/day so rendering all of them is instant, and the All-Flow view
// generates 3000-15000 rows/day (uncurated firehose) which needs the full
// day to avoid silently truncating morning alerts. 7/7 evidence:
//   - Original 500 default cut off at 10:55 AM CT (~2h25m of morning hidden)
//   - 2000 default cut off at 11:26 AM CT (~2h56m of morning hidden)
//     because uncurated for 7/7 was 3594 rows/day
//   - "All" default fetches all ~3594 → shows from market open at 8:30 AM
// User can still drop to lower limits via toolbar for fast-scroll tape mode.
// Note: BULL/BEAR/NET cards are day-scoped via a separate endpoint, so
// they ALWAYS include every classifiable alert regardless of this setting.
const ROW_LIMIT_OPTIONS = [500, 1000, 2000, 5000, "All"];
const ROW_LIMIT_DEFAULT = "All";
const ROW_LIMIT_ALL_VALUE = 10000;  // "All" (2026-07-09): the Color index makes a full-day scan cheap, so show the whole firehose. (3000 was too tight — surfaced only ~220; unbounded 20000 timed out pre-index.)
// LS key bumped v2→v3 on 7/8: prior stored 500/1000/2000 would override
// the new "All" default and re-truncate morning alerts silently. Third
// bump this session — pattern: any default change that reduces truncation
// needs a fresh LS key to nuke stored smaller values.
const LS_KEY_ROW_LIMIT = "uct_liveflow_massive_rowlimit_v3";
const LS_KEY_HIDE_ALGO = "uct_liveflow_massive_hidealgo_v1";
const LS_KEY_HIDE_NOSIDE = "uct_liveflow_massive_hidenoside_v1";
const LS_KEY_CURATED   = "uct_liveflow_massive_curated_v1";
const LS_KEY_STOCK_ETF = "uct_liveflow_massive_stocketf_v1";

// 7/7: client-side classification set for the Stocks/ETFs toggle. Mirrors
// backend INDEX_SYMBOLS in api/massive_processor.py — keep the two in sync
// when new indexes/ETFs are added. Client-side because historical rows in
// flow.db may have been stamped with the wrong StockEtf before NDXP-class
// symbols got added upstream; classifying here works regardless of DB state.
const KNOWN_ETFS_INDEXES = new Set([
  // Pure indexes
  'SPX','SPXW','XSP','NDX','NDXP','NQX','RUT','RUTW','VIX','VIXW',
  // Major broad-market ETFs
  'SPY','QQQ','IWM','DIA','VOO','VTI','VT','VXUS','VUG','RSP','MAGS',
  // Sector ETFs
  'XLK','XLF','XLE','XLV','XLY','XLP','XLI','XLB','XLU','XLC','XLRE',
  'XBI','XHB','XME','XOP','XSD','XTL',
  // Industry / thematic ETFs
  'SMH','SOXX','IBB','IGV','KWEB','FXI','MCHI','ASHR','EWY','EWJ',
  'EWT','EWZ','EEM','EFA','IWD','IWF','MTUM','IHI','JETS','TAN',
  'COPX','GDX','GDXJ','SIL','SILJ','OIH','KRE','IYR',
  // Bond ETFs
  'TLT','IEF','HYG','LQD','BHYP','TLH','ZROZ','EDV','TMF',
  // Leveraged / inverse
  'TQQQ','SQQQ','SOXL','SOXS','SPXL','SPXS','TNA','TZA','UVXY','SVXY',
  'UDOW','FAS','DPST','GUSH','BOIL','KOLD','TSLL','MSTU','MSTX','MSFL',
  'AMDL','NXT','CHAU','KORU',
  // Commodities
  'GLD','IAU','SLV','USO','UNG','UCO','SCO','BNO','LIT','URA','CPER',
  // Crypto ETFs
  'IBIT','FBTC','BITX','BITO','GBTC','ETHA','ETHU','FETH',
  // Volatility / niche
  'VXX','JNUG','REMX','EUAD','EUV','FXY','SPCH','SPCX',
]);

// ─── Tier metadata (matches LiveFlow.jsx) ─────────────────────────────────
// Two extra keys vs LiveFlow.jsx: "bearish" is its own tier in our endpoint
// because PUT-bought-on-ASK and CALL-sold-on-BID both produce bear-direction
// alerts (the backend resolves direction from Side+CP so we get this for free).
// LiveFlow.jsx merges bearish into a separate tier by alertName parsing —
// we just use _tierKey from the response directly.
const TIER_META = {
  // Tier descriptions kept intentionally high-level — they communicate
  // signal QUALITY and how to use the tier, NOT the underlying rules
  // (premium thresholds, V/OI ratios, DTE cutoffs, side classification).
  // This is proprietary algo logic and shouldn't be exposed via tooltips.
  alpha: {
    label: "Alpha Gold", color: "#FFD93B", bg: "#FFD93B14",
    desc: "Highest-conviction directional flow. Top-tier signal — primary trading candidate.",
  },
  size: {
    label: "Size", color: "#c9a84c", bg: "#c9a84c14",
    desc: "Institutional-sized positioning with strong conviction. High-tier signal.",
  },
  bullish: {
    label: "Bullish", color: "#4F8266", bg: "#4F826614",
    desc: "Bullish-leaning conviction flow. Moderate signal strength.",
  },
  bearish: {
    label: "Bearish", color: "#8F4F4F", bg: "#8F4F4F14",
    desc: "Bearish-leaning conviction flow. Moderate signal strength.",
  },
  leaps: {
    label: "LEAPS", color: "#6E5FA0", bg: "#6E5FA014",
    desc: "Long-dated positioning. Often strategic / hedges rather than near-term directional plays.",
  },
  unusual: {
    label: "Unusual", color: "#4A7290", bg: "#4A729014",
    desc: "Heavy relative volume at smaller premium sizes. Watch-list candidate.",
  },
  algo: {
    label: "Algo", color: "#6B6B72", bg: "#6B6B7214",
    desc: "Multi-leg / complex strategies. Non-directional — treat as background.",
  },
};
const TIER_ORDER = ["alpha", "size", "bullish", "bearish", "leaps", "unusual"];  // "algo" removed 2026-07-21 (Bullflow-era; Massive has no tradeType) — algo rows auto-hide (no filter key)

// ─── localStorage keys ────────────────────────────────────────────────────
const LS_KEY_FILTERS = "uct_liveflow_massive_filters_v1";
const LS_KEY_SORT    = "uct_liveflow_massive_sort_v1";
const LS_KEY_MINGRADE= "uct_liveflow_massive_mingrade_v1";
const LS_KEY_COLSORT = "uct_liveflow_massive_colsort_v1";  // per-column table sort (col+dir)
const LS_KEY_VIEWMODE = "uct_liveflow_massive_viewmode_v1";  // 'print' tape vs 'contract' rollup

// ─── Column config (single source for the sortable header row) ────────────
// Keys drive the click-to-sort comparator in LiveFlowMassive; labels/align
// must stay 1:1 with the AlertRow grid below (same order + gridTemplateColumns).
// `dir` = the direction applied on the FIRST click of that column (numeric
// columns default to descending — biggest first; text columns to ascending).
const COLUMNS = [
  { key: "time",      label: "TIME",     align: "center", dir: "desc" },
  { key: "ticker",    label: "TICKER",   align: "center", dir: "asc"  },
  { key: "spot",      label: "SPOT",     align: "center", dir: "desc" },
  { key: "strike",    label: "STRIKE",   align: "center", dir: "asc"  },
  { key: "cp",        label: "C/P",      align: "center", dir: "asc"  },
  { key: "exp",       label: "EXP",      align: "center", dir: "asc"  },
  { key: "moneyness", label: "%ITM/OTM", align: "center", dir: "desc" },
  { key: "price",     label: "PRICE",    align: "center", dir: "desc" },
  { key: "vol",       label: "VOL",      align: "center", dir: "desc" },
  { key: "oi",        label: "OI",       align: "center", dir: "desc" },
  { key: "voi",       label: "V/OI",     align: "center", dir: "desc" },
  { key: "premium",   label: "PREMIUM",  align: "center", dir: "desc" },
  { key: "grade",     label: "GRADE",    align: "center", dir: "desc" },
  { key: "side",      label: "SIDE",     align: "center", dir: "asc"  },
  { key: "type",      label: "TYPE",     align: "center", dir: "asc"  },
  { key: "pl",        label: "P/L",      align: "center", dir: "desc" },
  { key: "tier",      label: "ALERT",    align: "left",   dir: "asc"  },
];

// Turn an M/D/YYYY expiration into a sortable YYYYMMDD-ish integer.
function _expSortVal(exp) {
  if (!exp) return null;
  const p = String(exp).split("/");
  if (p.length !== 3) return null;
  const [m, d, y] = p.map(Number);
  if (!y) return null;
  return y * 10000 + (m || 0) * 100 + (d || 0);
}

function loadFilters() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY_FILTERS) || "null");
    if (v && typeof v === "object") return v;
  } catch {}
  const f = {};
  for (const t of TIER_ORDER) f[t] = true;
  return f;
}
function saveFilters(f) {
  try { localStorage.setItem(LS_KEY_FILTERS, JSON.stringify(f)); } catch {}
}

// ─── Time formatting ──────────────────────────────────────────────────────
function fmtTime(unixSec) {
  if (!unixSec) return "—";
  const d = new Date(unixSec * 1000);
  const hh = d.getHours();
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${mm}:${ss} ${ampm}`;
}

function fmtPremium(p) {
  if (!p && p !== 0) return "—";
  if (p >= 1_000_000) return "$" + (p / 1_000_000).toFixed(2) + "M";
  if (p >= 1_000) return "$" + (p / 1_000).toFixed(0) + "K";
  return "$" + p.toFixed(0);
}

function fmtStrike(s) {
  if (s == null) return "—";
  if (s >= 100) return "$" + s.toFixed(0);
  return "$" + s.toFixed(2);
}

// ─── Trade type classifier (OPRA condition codes from Massive) ────────────
// Maps the raw `_type` field (set by the worker from OPRA condition codes)
// to a compact display label + color. Worker writes values like "ML/" for
// multi-leg complex strategies; other condition codes get surfaced here too.
//
// Patterns are heuristic — based on common OPRA condition code conventions
// (ISO for intermarket sweep, ML for multi-leg auto, BLOCK or BLK for block
// trades, AUCT for auctions). If a specific Massive condition code isn't
// matched here, the column shows "—" (regular trade).
//
// Returns null for regular/unknown so the column shows a dash, or an object
// { code, label, color } for known classifications.
function tradeTypeLabel(rawType) {
  if (!rawType) return null;
  const t = String(rawType).toUpperCase().trim();
  if (!t || t === "REGULAR" || t === "RGLM") return null;

  // Multi-leg complex strategies — same color as Algo tier for consistency
  if (t.startsWith("ML") || t === "MULTI_LEG_AUTO" || t === "MULTILEG") {
    return { code: "ML", label: "Multi-leg auto", color: "#6B6B72" };
  }
  // Intermarket sweep
  if (t.includes("SWEEP") || t.startsWith("ISO") || t.startsWith("SW")
      || t === "S/" || t === "IS" || t === "INTERMARKET") {
    return { code: "SWEEP", label: "Intermarket sweep — routed to multiple venues to fill quickly", color: "#E8A547" };
  }
  // Block trade (negotiated large size)
  if (t.includes("BLOCK") || t.startsWith("BLK") || t === "B/"
      || t === "BL" || t === "BT") {
    return { code: "BLOCK", label: "Block trade — negotiated large size", color: "#7AB0E0" };
  }
  // Single-leg auction
  if (t.includes("AUCT") || t.startsWith("AUC") || t === "SLAN") {
    return { code: "AUCT", label: "Auction", color: "#A88FE0" };
  }
  // Cross trade
  if (t.includes("CROSS") || t === "CR" || t === "SLC") {
    return { code: "CROSS", label: "Cross trade", color: "#8F8F8F" };
  }
  return null;
}

// Contract price (averageFillPrice). Sub-$1 needs more precision than
// strikes; $4.32 is typical, $0.05 should not display as "$0.05" (lost
// precision) but as "$.05" or "0.05". Keep two decimals across the board.
function fmtPrice(p) {
  if (p == null || isNaN(p)) return "—";
  return "$" + p.toFixed(2);
}

// Spot is the underlying stock price at alert time (snapshot, not live).
// Same formatting as fmtPrice — two decimals, dollar sign.
function fmtSpot(s) {
  if (s == null || isNaN(s) || s <= 0) return "—";
  return "$" + s.toFixed(2);
}

// Moneyness as a compact display: "12.5% ITM", "3.2% OTM", or "ATM".
// pct sign convention from backend _moneyness(): positive when ITM,
// negative when OTM, ~0 when ATM (with label="ATM" applied below 1%).
// Display uses |pct| paired with the label so the sign info is implicit.
function fmtMoneyness(pct, label) {
  if (pct == null || label == null) return "—";
  if (label === "ATM") return "ATM";
  return `${Math.abs(pct).toFixed(1)}% ${label}`;
}

// Volume / OI as compact counts. Massive contracts hit 6-digit volume on
// busy days; raw integers get unreadable. 1234 → "1.2K", 12345 → "12.3K".
function fmtCount(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1000).toFixed(0) + "K";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

// ─── Market Read Card (hero) ──────────────────────────────────────────────
// Big aggregated read of bull/bear positioning. Sourced from the backend's
// /day-stats endpoint which aggregates ALL classifiable Y/M rows for the
// target date — independent of any pagination/grade/tier filters applied
// to the alert grid. Toggling chips changes WHAT YOU'RE LOOKING AT but
// not the macro Market Read.
//
// Always full-size and sticky-positioned. The earlier compact-on-scroll
// behavior caused flicker due to layout shifts when the card resized.
function MarketReadCard({ stats }) {
  const DIR_BULL = "#6BAA85";
  const DIR_BEAR = "#C26A6A";

  // Click-to-expand state for BULL/BEAR stat cards.
  // null = collapsed, "bull" or "bear" = panel showing top 10 names for that side.
  const [expandedSide, setExpandedSide] = useState(null);

  // Loading state — backend hasn't returned yet
  if (!stats) {
    return (
      <div style={{
        background: P.cd, marginBottom: 12,
        borderRadius: 6, border: `1px solid ${P.bd}`,
        padding: "20px", textAlign: "center",
        color: P.dm, fontSize: 12,
      }}>
        Loading market read…
      </div>
    );
  }

  // ─ Read pre-computed aggregates from the backend payload ───────────────
  const bullPrem = stats.bull_premium || 0;
  const bearPrem = stats.bear_premium || 0;
  const total = bullPrem + bearPrem;
  const bullPct = total > 0 ? (bullPrem / total) * 100 : 50;
  const netPrem = bullPrem - bearPrem;

  const bullPrem1h = stats.last_hour?.bull_premium || 0;
  const bearPrem1h = stats.last_hour?.bear_premium || 0;
  const count1h    = stats.last_hour?.count || 0;
  const isLiveWindow = !!stats.last_hour?.is_today_target;
  const total1h = bullPrem1h + bearPrem1h;
  const bullPct1h = total1h > 0 ? (bullPrem1h / total1h) * 100 : 50;

  const netLabel = bullPrem > bearPrem ? "BULLISH" :
                   bearPrem > bullPrem ? "BEARISH" : "BALANCED";
  const netColor = bullPrem > bearPrem ? DIR_BULL :
                   bearPrem > bullPrem ? DIR_BEAR : P.dm;

  // Top 3 each (backend returns up to 5)
  const topBull = (stats.top_bull || []).slice(0, 3);
  const topBear = (stats.top_bear || []).slice(0, 3);
  const dteBuckets = stats.by_dte || [];

  const fmtM = (n) => `$${(n / 1e6).toFixed(2)}M`;
  const fmtMShort = (n) => n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${(n/1e3).toFixed(0)}K`;

  return (
    <div style={{
      // Scrolls naturally (NOT sticky) so the macro view doesn't consume
      // alert-table real estate. Only the chips + column headers below
      // stay pinned to the top.
      background: P.cd, marginBottom: 12,
      borderRadius: 6, border: `1px solid ${P.bd}`,
      // Directional accent: thick left border + box-shadow tint so the
      // card communicates direction without losing opacity.
      borderLeft: `5px solid ${netColor}`,
      boxShadow: `inset 4px 0 0 0 ${netColor}, 0 4px 12px ${P.bg}cc`,
      padding: "16px 20px",
      // Direction-flip animation only — no size animations to avoid any
      // layout-shift-induced flicker during scroll.
      transition: "border-left-color 0.4s ease, box-shadow 0.4s ease",
    }}>
      {/* HEADER ROW */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        marginBottom: 12,
      }}>
        <span style={{
          color: P.dm, fontSize: 10, fontWeight: 700,
          letterSpacing: 1.5, textTransform: "uppercase",
        }}>
          ● {isLiveWindow ? "LIVE" : "HISTORICAL"} MARKET READ
        </span>
        <span style={{ color: P.mt, fontSize: 10 }}>
          (premium-weighted · {stats.total_classified.toLocaleString()} alerts on {stats.query_date})
        </span>
      </div>

      {/* BIG STAT CARDS — direction headline, bull, bear, net */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 12, marginBottom: 14,
      }}>
        {/* Direction headline */}
        <div style={{
          padding: "8px 12px",
          background: `${netColor}22`,
          borderRadius: 4, border: `1px solid ${netColor}80`,
        }}>
          <div style={{
            color: netColor, fontSize: 18, fontWeight: 800,
            letterSpacing: 0.5, lineHeight: 1.1,
            transition: "color 0.3s ease",
          }}>
            {netLabel}
          </div>
          <div style={{
            color: netColor, fontSize: 12, fontWeight: 600,
            marginTop: 3, opacity: 0.9,
          }}>
            {bullPct.toFixed(0)}% bull
          </div>
        </div>

        {/* Bull total — clickable to expand top-10 bull names */}
        <div
          onClick={() => setExpandedSide(expandedSide === "bull" ? null : "bull")}
          style={{
            padding: "8px 12px", background: P.cd,
            borderRadius: 4,
            border: expandedSide === "bull"
              ? `1px solid ${DIR_BULL}`
              : `1px solid ${P.bd}`,
            cursor: "pointer", userSelect: "none",
            transition: "border-color 0.2s ease",
          }}
          title="Click to show top 10 bullish tickers"
        >
          <div style={{
            color: P.mt, fontSize: 10, fontWeight: 700,
            letterSpacing: 1, textTransform: "uppercase",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span>▲ BULL FLOW</span>
            <span style={{ color: DIR_BULL, fontSize: 11 }}>
              {expandedSide === "bull" ? "▾" : "▸"}
            </span>
          </div>
          <div style={{
            color: DIR_BULL, fontSize: 20, fontWeight: 800,
            marginTop: 3, lineHeight: 1.1,
          }}>
            {fmtM(bullPrem)}
          </div>
        </div>

        {/* Bear total — clickable to expand top-10 bear names */}
        <div
          onClick={() => setExpandedSide(expandedSide === "bear" ? null : "bear")}
          style={{
            padding: "8px 12px", background: P.cd,
            borderRadius: 4,
            border: expandedSide === "bear"
              ? `1px solid ${DIR_BEAR}`
              : `1px solid ${P.bd}`,
            cursor: "pointer", userSelect: "none",
            transition: "border-color 0.2s ease",
          }}
          title="Click to show top 10 bearish tickers"
        >
          <div style={{
            color: P.mt, fontSize: 10, fontWeight: 700,
            letterSpacing: 1, textTransform: "uppercase",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span>▼ BEAR FLOW</span>
            <span style={{ color: DIR_BEAR, fontSize: 11 }}>
              {expandedSide === "bear" ? "▾" : "▸"}
            </span>
          </div>
          <div style={{
            color: DIR_BEAR, fontSize: 20, fontWeight: 800,
            marginTop: 3, lineHeight: 1.1,
          }}>
            {fmtM(bearPrem)}
          </div>
        </div>

        {/* Net delta */}
        <div style={{
          padding: "8px 12px", background: P.cd,
          borderRadius: 4, border: `1px solid ${P.bd}`,
        }}>
          <div style={{
            color: P.mt, fontSize: 10, fontWeight: 700,
            letterSpacing: 1, textTransform: "uppercase",
          }}>
            NET (BULL − BEAR)
          </div>
          <div style={{
            color: netColor, fontSize: 20, fontWeight: 800,
            marginTop: 3, lineHeight: 1.1,
          }}>
            {netPrem >= 0 ? "+" : ""}{fmtM(netPrem)}
          </div>
        </div>
      </div>

      {/* EXPANDED TOP-10 PANEL — shown when user clicks BULL or BEAR card */}
      {expandedSide && (() => {
        const list = expandedSide === "bull"
          ? (stats.top_bull || [])
          : (stats.top_bear || []);
        const color = expandedSide === "bull" ? DIR_BULL : DIR_BEAR;
        const totalPrem = expandedSide === "bull" ? bullPrem : bearPrem;
        return (
          <div style={{
            background: `${color}10`,
            borderRadius: 4, border: `1px solid ${color}50`,
            padding: "10px 14px", marginBottom: 12,
          }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 8,
            }}>
              <span style={{
                color: color, fontSize: 10, fontWeight: 700,
                letterSpacing: 1, textTransform: "uppercase",
              }}>
                TOP 10 {expandedSide === "bull" ? "▲ BULLISH" : "▼ BEARISH"} TICKERS · day-scoped
              </span>
              <span
                onClick={() => setExpandedSide(null)}
                style={{
                  color: P.dm, fontSize: 11, cursor: "pointer",
                  padding: "2px 6px", borderRadius: 3,
                }}
                title="Close"
              >
                ✕ close
              </span>
            </div>
            {/* Top 10 as a 5x2 grid — each entry shows ticker, premium,
                and a tiny bar of relative size to the leading ticker.  */}
            {list.length === 0 ? (
              <div style={{ color: P.mt, fontSize: 11, fontStyle: "italic" }}>
                no {expandedSide} flow on this date
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "4px 16px",
              }}>
                {list.map((item, i) => {
                  const maxPrem = list[0].premium;
                  const widthPct = (item.premium / maxPrem) * 100;
                  const sharePct = totalPrem > 0
                    ? (item.premium / totalPrem) * 100
                    : 0;
                  return (
                    <div key={item.ticker} style={{
                      display: "grid",
                      // rank | ticker | bar | $ | %
                      gridTemplateColumns: "22px 60px 1fr 70px 50px",
                      gap: 8, alignItems: "center",
                      fontSize: 12, padding: "3px 0",
                    }}>
                      <span style={{ color: P.mt, fontWeight: 700 }}>
                        {i + 1}.
                      </span>
                      <span style={{
                        color: P.wh, fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                      }}>
                        {item.ticker}
                      </span>
                      <div style={{
                        height: 5, background: P.bd, borderRadius: 2,
                        overflow: "hidden",
                      }}>
                        <div style={{
                          width: `${widthPct}%`, height: "100%",
                          background: color,
                        }} />
                      </div>
                      <span style={{
                        color: color, fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                        textAlign: "right",
                      }}>
                        {fmtMShort(item.premium)}
                      </span>
                      <span style={{
                        color: P.dm, fontSize: 11,
                        fontVariantNumeric: "tabular-nums",
                        textAlign: "right",
                      }}>
                        {sharePct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* No progress bar — direction is already conveyed by the BULLISH/
          BEARISH headline card and the % numbers. Removed to save vertical
          space in the sticky group. */}

      {/* LAST HOUR ROW — shows which tickers caught flow in the final
          hour window. Each ticker's amount is colored by which side
          dominated for that name in that hour (bull = green, bear = red). */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "6px 0", marginBottom: 12, fontSize: 12,
        borderTop: `1px solid ${P.bd}`, paddingTop: 10,
        flexWrap: "wrap",
      }}>
        <span style={{
          color: P.mt, fontSize: 10, fontWeight: 700,
          letterSpacing: 1, textTransform: "uppercase",
          flexShrink: 0,
        }}>
          ⏱ {isLiveWindow ? "LAST HOUR" : "FINAL HOUR OF SESSION"}
        </span>
        {count1h > 0 ? (
          <>
            <span style={{ color: P.dm, fontSize: 11, flexShrink: 0 }}>
              · {count1h.toLocaleString()} alert{count1h === 1 ? "" : "s"}
            </span>
            {/* Top tickers active in the window */}
            {(stats.last_hour?.top_tickers || []).length > 0 ? (
              <span style={{
                display: "flex", gap: 12, alignItems: "baseline",
                flexWrap: "wrap",
              }}>
                {(stats.last_hour.top_tickers).map((tk, i) => {
                  const tkColor = tk.lean === "bull" ? DIR_BULL :
                                  tk.lean === "bear" ? DIR_BEAR : P.dm;
                  return (
                    <span key={tk.ticker} style={{
                      display: "inline-flex", alignItems: "baseline", gap: 4,
                    }}>
                      <span style={{ color: P.wh, fontWeight: 600 }}>
                        {tk.ticker}
                      </span>
                      <span style={{
                        color: tkColor, fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                      }}>
                        {fmtMShort(tk.total)}
                      </span>
                    </span>
                  );
                })}
              </span>
            ) : (
              <span style={{ color: P.dm, fontSize: 11, fontStyle: "italic" }}>
                no notable tickers
              </span>
            )}
          </>
        ) : (
          <span style={{ color: P.dm, fontSize: 11, fontStyle: "italic" }}>
            no alerts in window
          </span>
        )}
      </div>

      {/* TOP NAMES + DTE BUCKETS side by side */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1.4fr",
        gap: 14,
      }}>
        {/* Top names */}
        <div style={{
          padding: "10px 12px", background: P.cd,
          borderRadius: 4, border: `1px solid ${P.bd}`,
        }}>
          <div style={{
            color: P.mt, fontSize: 10, fontWeight: 700,
            letterSpacing: 1, textTransform: "uppercase",
            marginBottom: 6,
          }}>
            TOP NAMES
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ color: DIR_BULL, fontWeight: 700, minWidth: 36 }}>Bull:</span>
              {topBull.length === 0 ? (
                <span style={{ color: P.mt, fontSize: 11 }}>—</span>
              ) : (
                <span style={{ color: P.wh, lineHeight: 1.5 }}>
                  {topBull.map((item, i) => (
                    <span key={item.ticker}>
                      {i > 0 && <span style={{ color: P.mt }}> · </span>}
                      <span style={{ fontWeight: 600 }}>{item.ticker}</span>
                      <span style={{ color: DIR_BULL, marginLeft: 4 }}>
                        {fmtMShort(item.premium)}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ color: DIR_BEAR, fontWeight: 700, minWidth: 36 }}>Bear:</span>
              {topBear.length === 0 ? (
                <span style={{ color: P.mt, fontSize: 11 }}>—</span>
              ) : (
                <span style={{ color: P.wh, lineHeight: 1.5 }}>
                  {topBear.map((item, i) => (
                    <span key={item.ticker}>
                      {i > 0 && <span style={{ color: P.mt }}> · </span>}
                      <span style={{ fontWeight: 600 }}>{item.ticker}</span>
                      <span style={{ color: DIR_BEAR, marginLeft: 4 }}>
                        {fmtMShort(item.premium)}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* DTE buckets — compact 4-column grid. Each bucket is a vertical
            mini-card showing: DTE label, %bull (large), proportion bar,
            bull/bear $ inline, count. Roughly ½ the height of the previous
            horizontal-bars layout while keeping all the data. */}
        <div style={{
          padding: "10px 12px", background: P.cd,
          borderRadius: 4, border: `1px solid ${P.bd}`,
        }}>
          <div style={{
            color: P.mt, fontSize: 10, fontWeight: 700,
            letterSpacing: 1, textTransform: "uppercase",
            marginBottom: 8,
          }}>
            BY EXPIRATION
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 6,
          }}>
            {dteBuckets.map(b => {
              const bTotal = b.bull + b.bear;
              const bPct = bTotal > 0 ? (b.bull / bTotal) * 100 : 50;
              const leadColor = b.bull > b.bear ? DIR_BULL :
                                b.bear > b.bull ? DIR_BEAR : P.dm;
              return (
                <div key={b.label} style={{
                  padding: "6px 8px",
                  background: bTotal > 0 ? `${leadColor}0E` : "transparent",
                  borderRadius: 3,
                  border: `1px solid ${bTotal > 0 ? leadColor + "40" : P.bd}`,
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  {/* Row 1: DTE label + count */}
                  <div style={{
                    display: "flex", justifyContent: "space-between",
                    alignItems: "baseline",
                  }}>
                    <span style={{
                      color: P.wh, fontSize: 11, fontWeight: 700,
                      letterSpacing: 0.5,
                    }}>
                      {b.label}
                    </span>
                    <span style={{
                      color: P.dm, fontSize: 10,
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      ·{b.count.toLocaleString()}
                    </span>
                  </div>
                  {/* Row 2: %bull large + proportion bar */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <span style={{
                      color: leadColor, fontSize: 13, fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}>
                      {bTotal > 0 ? `${bPct.toFixed(0)}%` : "—"}
                    </span>
                    <div style={{
                      flex: 1, height: 6, background: P.bd, borderRadius: 2,
                      overflow: "hidden", display: "flex",
                      opacity: bTotal > 0 ? 1 : 0.3,
                    }}>
                      <div style={{
                        width: `${bPct}%`, background: DIR_BULL,
                        transition: "width 0.4s ease",
                      }} />
                      <div style={{
                        width: `${100 - bPct}%`, background: DIR_BEAR,
                        transition: "width 0.4s ease",
                      }} />
                    </div>
                  </div>
                  {/* Row 3: bull/bear $ inline */}
                  <div style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: 10, fontVariantNumeric: "tabular-nums",
                  }}>
                    <span style={{
                      color: b.bull > 0 ? DIR_BULL : P.mt, fontWeight: 600,
                    }}>
                      ▲{b.bull > 0 ? fmtMShort(b.bull) : "—"}
                    </span>
                    <span style={{
                      color: b.bear > 0 ? DIR_BEAR : P.mt, fontWeight: 600,
                    }}>
                      ▼{b.bear > 0 ? fmtMShort(b.bear) : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Filter chips ─────────────────────────────────────────────────────────
// Click behavior:
//   • Click a chip → isolate to that tier (all others off)
//   • Click that same chip again → restore all tiers (all on)
//   • Click "Show all" → restore all tiers
// This is the click-to-focus pattern used by other dashboards (Bloomberg,
// Twitter, etc.) — clicking always either isolates or restores, never the
// confusing in-between multi-select state.
function FilterChips({ filters, onChange, counts, stockEtfFilter, onStockEtfChange, search, onSearchChange, viewMode, onViewModeChange, hideNoSide, onHideNoSideChange }) {
  const allOn = TIER_ORDER.every(t => filters[t]);
  const onlyOnTier = (() => {
    const ons = TIER_ORDER.filter(t => filters[t]);
    return ons.length === 1 ? ons[0] : null;
  })();
  const handleClick = (tier) => {
    if (onlyOnTier === tier) {
      // Already isolated to this tier → restore all
      const next = {};
      for (const t of TIER_ORDER) next[t] = true;
      onChange(next);
    } else {
      // Isolate to just this tier
      const next = {};
      for (const t of TIER_ORDER) next[t] = (t === tier);
      onChange(next);
    }
  };
  const handleShowAll = () => {
    const next = {};
    for (const t of TIER_ORDER) next[t] = true;
    onChange(next);
  };
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      padding: "10px 0", marginBottom: 12, borderBottom: `1px solid ${P.bd}`,
    }}>
      {/* View mode: live print tape vs by-contract accumulation rollup. */}
      {onViewModeChange && (
        <>
          <div style={{ display: "inline-flex", border: `1px solid ${P.ac}`, borderRadius: 4, overflow: "hidden", marginRight: 4 }}>
            {[{ key: "print", label: "By Print" }, { key: "contract", label: "By Contract" }].map(opt => {
              const active = viewMode === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => onViewModeChange(opt.key)}
                  title={opt.key === "print"
                    ? "Live tape — one row per print"
                    : "One row per contract — repeat accumulation (hit ≥3× at decent size). Click a row to expand its prints."}
                  style={{
                    background: active ? P.ac : "transparent", color: active ? P.bg : P.wh,
                    border: "none", padding: "5px 12px", cursor: "pointer", fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    borderRight: opt.key === "print" ? `1px solid ${P.ac}` : "none",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <span style={{ color: P.bd, fontSize: 13, marginRight: 4 }}>·</span>
        </>
      )}
      {/* 7/7: Stocks / ETFs / All partition. Sits BEFORE the tier chips
          since it partitions the universe of alerts before the tier filter
          applies. Client-side via KNOWN_ETFS_INDEXES. */}
      {onStockEtfChange && (
        <>
          <div style={{
            display: "inline-flex", border: `1px solid ${P.bd}`,
            borderRadius: 4, overflow: "hidden", marginRight: 4,
          }}>
            {[
              { key: "stocks", label: "Stocks" },
              { key: "etfs",   label: "ETFs" },
              { key: "all",    label: "All" },
            ].map(opt => {
              const active = stockEtfFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => onStockEtfChange(opt.key)}
                  title={
                    opt.key === "stocks" ? "Show only individual stock names" :
                    opt.key === "etfs"   ? "Show only ETFs and index products" :
                                           "Show both stocks and ETFs"
                  }
                  style={{
                    background: active ? P.wh : "transparent",
                    color: active ? P.bg : P.dm,
                    border: "none",
                    padding: "5px 10px", cursor: "pointer", fontSize: 13,
                    fontWeight: active ? 700 : 400,
                    borderRight: opt.key !== "all" ? `1px solid ${P.bd}` : "none",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <span style={{ color: P.bd, fontSize: 13, marginRight: 4 }}>·</span>
        </>
      )}
      <span style={{ color: P.dm, fontSize: 13, marginRight: 4 }}>Show:</span>
      <button
        onClick={handleShowAll}
        style={{
          background: allOn ? P.ac : "transparent",
          color: allOn ? P.bg : P.wh,
          border: `1px solid ${P.bd}`, borderRadius: 4,
          padding: "5px 12px", cursor: "pointer", fontSize: 13,
        }}
      >
        {allOn ? "All ✓" : "Show all"}
      </button>
      {TIER_ORDER.map(tier => {
        const meta = TIER_META[tier];
        const on = filters[tier];
        const isIsolated = onlyOnTier === tier;
        const count = counts?.[tier] || 0;
        return (
          <button
            key={tier}
            onClick={() => handleClick(tier)}
            title={
              isIsolated
                ? `Click to restore all tiers (currently isolated to ${meta.label})`
                : `${meta.label}${meta.desc ? " — " + meta.desc : ""}\n\nClick to show only ${meta.label}`
            }
            style={{
              background: on ? meta.color : "transparent",
              color: on ? P.bg : P.wh,
              border: `${isIsolated ? 2 : 1}px solid ${meta.color}`, borderRadius: 4,
              padding: isIsolated ? "4px 11px" : "5px 12px",
              cursor: "pointer", fontSize: 13,
              opacity: on ? 1 : 0.5,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {meta.label}
            {count > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 600,
                padding: "1px 6px", borderRadius: 8,
                background: on ? `${P.bg}80` : `${meta.color}30`,
                color: on ? P.bg : meta.color,
              }}>{count}</span>
            )}
          </button>
        );
      })}

      {/* Hide No-Side (2026-07-21) — hides direction-unconfirmed "UCT Size" rows:
          big prints whose side we couldn't confirm. Sits by the Unusual pill. */}
      {onHideNoSideChange && (
        <button
          onClick={() => onHideNoSideChange(!hideNoSide)}
          title={hideNoSide
            ? "Not-clean prints (UCT Size - Not Clean: side unconfirmed or two-way flow) are HIDDEN. Click to show them again."
            : "Hide not-clean prints — big size, but the direction isn't clean (side couldn't be confirmed, or the contract is two-way)."
          }
          style={{
            background: hideNoSide ? P.ac : "transparent",
            color: hideNoSide ? P.bg : P.wh,
            border: `1px solid ${P.bd}`, borderRadius: 4,
            padding: "5px 12px", cursor: "pointer", fontSize: 13,
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          {hideNoSide ? "✓ Not Clean hidden" : "Hide Not Clean"}
        </button>
      )}

      {/* Ticker search — moved to the LEFT of the filter row (flex order:-1).
          Client-side substring match on the fetched feed; at the default
          "Show: All" limit that's the full trading day. */}
      {onSearchChange && (
        <div style={{
          position: "relative", display: "inline-flex", alignItems: "center",
          order: -1, marginRight: 10,
        }}>
          <span style={{
            position: "absolute", left: 9, color: P.mt, fontSize: 12,
            pointerEvents: "none",
          }}>🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search ticker…"
            style={{
              background: P.bg, color: P.wh,
              border: `1px solid ${search ? P.ac : P.bd}`, borderRadius: 4,
              padding: "5px 26px 5px 28px", fontSize: 13,
              fontFamily: "inherit", width: 170, outline: "none",
              textTransform: "uppercase",
            }}
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              title="Clear search"
              style={{
                position: "absolute", right: 6, background: "transparent",
                border: "none", color: P.dm, cursor: "pointer",
                fontSize: 13, lineHeight: 1, padding: 2,
              }}
            >✕</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── P/L helper ───────────────────────────────────────────────────────────
// Stock % move since alert spot. Cheaper than option-price tracking — needs
// one Schwab quote per ticker, not per contract. Direction-aligned coloring
// (Bull alert + positive move = green; misaligned = red).
function computePL(alert, currentSpot) {
  if (!currentSpot || !alert.spot || alert.spot <= 0) return null;
  return ((currentSpot - alert.spot) / alert.spot) * 100;
}

// ─── Single row ───────────────────────────────────────────────────────────
function AlertRow({ alert, isNew, hitCount, currentSpot, onClickTicker, onClickContract, onClickTier, onOpenChart, isAdmin, onPush, pushState }) {
  const tier = alert._tierKey || "algo";
  const meta = TIER_META[tier];
  const dirIsBull = alert._direction === "Bull";
  const dirIsBear = alert._direction === "Bear";
  const isAlpha = tier === "alpha";
  const isSize = tier === "size";

  // Right-click (desktop) / long-press (touch, incl. iOS Safari — which does
  // not reliably fire `contextmenu` on touch-hold) both open the full chart.
  // Closes over `alert.ticker` — do NOT read the ticker from the event, since
  // the long-press branch fires from a setTimeout after React dispatch has
  // finished, when `e.currentTarget` is already null.
  const chartLongPress = useLongPress((e) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    if (onOpenChart) onOpenChart(alert.ticker);
  });

  // Direction palette — brighter than P.bu / P.be so non-alpha rows still
  // have visual weight. Non-directional tiers (algo) keep neutral coloring.
  const DIR_BULL = "#6BAA85";   // brighter green than P.bu
  const DIR_BEAR = "#C26A6A";   // brighter red than P.be
  // Alpha Gold directional accent (approved 7/20): the gold row keeps its
  // identity; a green/red LEFT EDGE + tinted ★, Bull/Bear word, and strike
  // encode direction. Uses the SAME DIR_BULL/DIR_BEAR shade as every other
  // bull/bear alert so Alpha Gold matches the rest of the feed (matched 7/20).
  const alphaAccent = dirIsBull ? DIR_BULL : dirIsBear ? DIR_BEAR : null;
  const DIR_BULL_TINT = `${DIR_BULL}0E`;  // ≈5% opacity background tint
  const DIR_BEAR_TINT = `${DIR_BEAR}0E`;
  const dirColor = dirIsBull ? DIR_BULL : dirIsBear ? DIR_BEAR : P.wh;
  const dirTint  = dirIsBull ? DIR_BULL_TINT : dirIsBear ? DIR_BEAR_TINT : null;

  const flashStyle = isNew ? {
    animation: "flashRow 1.5s ease-out",
  } : {};

  // Visual emphasis tiers:
  //   • Alpha Gold — full gold treatment, overrides direction color
  //   • Other tiers w/ Bull/Bear direction — green/red text on key fields
  //   • Algo or unclassified direction — neutral white/gray
  // Background tint: gold for alpha, subtle green/red for bull/bear,
  // standard dark for everything else.
  const rowBg = isAlpha ? `${P.ac}0E` : (dirTint || P.cd);
  const rowBorder = isAlpha ? `5px solid ${alphaAccent || P.ac}` : `3px solid ${meta.color}`;
  const fontSize = isAlpha ? 14 : 13;
  const secondaryFontSize = 12;
  // ONE color for the whole row so the tape is scannable at a glance:
  //   gold  → Alpha Gold (always, for attention)
  //   white → volume did NOT exceed OI (_color WHITE) — bled through on other criteria
  //   green → bullish + exceeded OI ·  red → bearish + exceeded OI
  // Applied to every descriptive cell below (ticker, spot, strike, exp, %OTM,
  // price, vol, OI, premium, alert name). Grade + P/L keep their own meaning.
  const DIM_WHITE = "#9aa0a6";
  // White-out when volume did NOT exceed OI — keyed off the actual V/OI ratio
  // (what the V/OI column shows), not the _color field which isn't reliable here.
  // volumeOIRatio <= 1 (or missing) → not new positioning → dim white, any direction.
  const _underOI = !(alert.volumeOIRatio > 1);
  const rowColor = isAlpha ? P.ac : (_underOI ? DIM_WHITE : dirColor);
  const tickerColor = rowColor;
  const tickerWeight = isAlpha ? 700 : 600;
  const strikeColor = rowColor;  // Alpha Gold strike stays gold; direction shown via edge + star + word
  const strikeWeight = isAlpha ? 700 : (isSize ? 700 : 600);
  const premColor = rowColor;
  const premWeight = isAlpha ? 700 : 600;
  const alertNameColor = rowColor;
  const cpDisplayColor = rowColor;

  return (
    <div style={{
      display: "grid",
      // TIME | TICKER+×N | SPOT | STRIKE | C/P | EXP | %ITM/OTM | PRICE | VOL | OI | V/OI | PREMIUM | GRADE | SIDE | TYPE | P/L | ALERT | (admin: POSTED | PUSH)
      gridTemplateColumns: "98px 100px 75px 80px 42px 100px 75px 70px 70px 70px 60px 95px 60px 50px 55px 75px 1fr" + (isAdmin ? " 68px 94px" : ""),
      gap: 8, padding: isAlpha ? "10px 12px" : "8px 12px",
      borderLeft: rowBorder,
      background: rowBg, marginBottom: 2, fontSize: fontSize,
      alignItems: "center",
      ...flashStyle,
    }}>
      <span style={{ color: rowColor, whiteSpace: "nowrap", textAlign: "center" }}>
        {fmtTime(alert.timestamp)}
      </span>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, overflow: "hidden" }}>
        <span
          style={{ color: tickerColor, fontWeight: tickerWeight, cursor: "pointer" }}
          onClick={() => onClickTicker(alert.ticker)}
          {...chartLongPress}
          title={`Filter to ${alert.ticker}`}
        >
          {alert.ticker}
        </span>
        {hitCount > 1 && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            padding: "1px 5px", borderRadius: 3,
            background: P.ac + "30", color: P.ac,
            flexShrink: 0,
          }} title={`${hitCount} hits on this contract today`}>
            ×{hitCount}
          </span>
        )}
      </span>
      {/* Spot column (added 6/29): underlying price at alert time, snapshot */}
      <span style={{
        color: rowColor,
        fontSize: secondaryFontSize,
        textAlign: "center",
        whiteSpace: "nowrap",
      }}>
        {fmtSpot(alert.spot)}
      </span>
      <span
        style={{ color: strikeColor, fontWeight: strikeWeight, textAlign: "center", cursor: "pointer", whiteSpace: "nowrap" }}
        onClick={() => {
          if (alert.cp && alert.strike != null && alert.exp) {
            onClickContract(`${alert.ticker}|${alert.cp}|${alert.strike}|${alert.exp}`);
          }
        }}
        title={alert.cp && alert.strike != null ? `Filter to ${alert.ticker} ${alert.cp} ${fmtStrike(alert.strike)} ${alert.exp}` : ""}
      >
        {fmtStrike(alert.strike)}
      </span>
      <span style={{ color: cpDisplayColor, fontWeight: 700, textAlign: "center" }}>
        {alert.cp || "—"}
      </span>
      <span style={{ color: rowColor, fontSize: secondaryFontSize, whiteSpace: "nowrap", textAlign: "center" }}>
        {alert.exp || "—"}
      </span>
      {/* %ITM/OTM column (added 6/29): moneyness from backend _moneyness().
          Bold when ITM > 25% to flag deep-ITM trades that would NOT
          qualify for Alpha Gold tier under the new router filter. */}
      <span style={{
        color: rowColor,
        fontSize: secondaryFontSize,
        textAlign: "center",
        whiteSpace: "nowrap",
        fontWeight: (alert.moneynessLabel === "ITM"
                     && alert.moneynessPct != null
                     && alert.moneynessPct > 25) ? 700 : 400,
      }} title={
        alert.spot != null && alert.strike != null
          ? `Spot $${Number(alert.spot).toFixed(2)} · Strike ${fmtStrike(alert.strike)} · ${fmtMoneyness(alert.moneynessPct, alert.moneynessLabel)}`
          : ""
      }>
        {fmtMoneyness(alert.moneynessPct, alert.moneynessLabel)}
      </span>
      <span style={{ color: rowColor, fontSize: secondaryFontSize, textAlign: "center" }}>
        {fmtPrice(alert.averageFillPrice)}
      </span>
      <span style={{
        color: rowColor,
        fontSize: secondaryFontSize, textAlign: "center",
        fontWeight: isAlpha ? 600 : 400,
      }}>
        {fmtCount(alert.tradeSize)}
      </span>
      <span style={{ color: rowColor, fontSize: secondaryFontSize, textAlign: "center" }}>
        {fmtCount(alert.priorOI)}
      </span>
      <span style={{
        color: rowColor,
        fontSize: secondaryFontSize, textAlign: "center",
        fontWeight: alert.oiExceeded ? 600 : 400,
      }}>
        {alert.volumeOIRatio ? `${alert.volumeOIRatio.toFixed(1)}x` : "—"}
      </span>
      <span style={{ color: premColor, fontWeight: premWeight, textAlign: "center" }}>
        {fmtPremium(alert.alertPremium)}
      </span>
      <span style={{
        color: alert.grade?.startsWith("A") ? P.ac :
               alert.grade === "B" ? P.bl :
               alert.grade === "C" ? P.dm : P.mt,
        fontWeight: 700, textAlign: "center",
        fontSize: isAlpha ? 14 : 13,
      }}>
        {alert.grade}
      </span>
      <span style={{ color: P.dm, fontSize: secondaryFontSize, textAlign: "center" }}>
        {alert._side || "—"}
      </span>
      {/* TYPE — derived from OPRA condition code (SWEEP, BLOCK, ML, etc).
          Regular trades show "—". Hover reveals the full label. */}
      {(() => {
        const t = tradeTypeLabel(alert._type);
        if (!t) {
          return (
            <span style={{ color: P.mt, fontSize: secondaryFontSize, textAlign: "center" }}>
              —
            </span>
          );
        }
        return (
          <span style={{ textAlign: "center" }}>
            <span
              title={t.label}
              style={{
                fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
                padding: "2px 5px", borderRadius: 3,
                background: `${t.color}25`, color: t.color,
                textTransform: "uppercase", cursor: "help",
                whiteSpace: "nowrap",
              }}
            >
              {t.code}
            </span>
          </span>
        );
      })()}
      <span style={{
        ...(() => {
          const pl = computePL(alert, currentSpot);
          if (pl == null) {
            return { color: P.mt, fontSize: secondaryFontSize, textAlign: "center" };
          }
          const winning = (alert._direction === "Bull" && pl >= 0) ||
                          (alert._direction === "Bear" && pl <= 0);
          return {
            color: winning ? DIR_BULL : DIR_BEAR,
            fontSize: secondaryFontSize, textAlign: "center",
            fontWeight: Math.abs(pl) >= 2 ? 700 : 600,
          };
        })(),
      }}>
        {(() => {
          const pl = computePL(alert, currentSpot);
          if (pl == null) return "—";
          return (pl > 0 ? "+" : "") + pl.toFixed(2) + "%";
        })()}
      </span>
      <span style={{ fontSize: secondaryFontSize, display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
        <span
          onClick={() => onClickTier && onClickTier(tier)}
          title={`${meta.label}${meta.desc ? " — " + meta.desc : ""}\n\nClick to show only ${meta.label}`}
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            padding: isAlpha ? "3px 7px" : "2px 6px", borderRadius: 3,
            background: isAlpha ? meta.color : `${meta.color}25`,
            color: isAlpha ? P.bg : meta.color,
            textTransform: "uppercase", flexShrink: 0,
            cursor: "pointer",
          }}>
          {isAlpha && <span style={{ color: alphaAccent || P.bg }}>{"★ "}</span>}{meta.label}
        </span>
        <span
          onClick={() => onClickTier && onClickTier(tier)}
          title={`Click to show only ${meta.label}`}
          style={{
            color: alertNameColor,
            fontWeight: isAlpha ? 600 : 500,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            cursor: "pointer",
          }}>
          {isAlpha && alphaAccent
            ? (<>{(alert.alertName || "").replace(/\s+(Bull|Bear)\s*$/, "")}{" "}
                <span style={{ color: alphaAccent, fontWeight: 700 }}>{dirIsBull ? "Bull" : "Bear"}</span></>)
            : alert.alertName}
        </span>
        {/* Clean-directional gate (dark): a bid-side sell contaminated by earlier
            ask-buying is demoted to "Not Clean" (backend _closeExcluded). This
            tag explains WHY the row dropped out of the directional tiers. */}
        {alert._closeExcluded && (
          <span
            title={`Dropped from clean directional flow: this contract saw ~${(alert._grossAskSession ?? 0).toLocaleString?.() ?? alert._grossAskSession} contracts of ask-buying on this contract today, so it's two-way (mixed) flow — this bid-side sell isn't clean bearish conviction.`}
            style={{
              marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#d9a441",
              border: "1px solid #6b5417", borderRadius: 3, padding: "0 4px",
              whiteSpace: "nowrap", flexShrink: 0, cursor: "help",
            }}>
            {"⚠ mixed"}
          </span>
        )}
      </span>

      {/* Admin-only POSTED + PUSH — the manual-push feedback loop. POSTED shows
          AUTO (auto-fired by the worker), ✓ (manually pushed this session), or
          blank. PUSH sends this print to Discord via /force-push-discord,
          bypassing gates. The AUTO-vs-manual record is the tuning signal. */}
      {/* POSTED — admin-only (AUTO vs this-session MANUAL vs blank). Hidden from
          the public view; the manual-push feedback loop is an admin concern. */}
      {isAdmin && (
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>
          {alert.forwardedToDiscord
            ? <span style={{ color: DIR_BULL, letterSpacing: 0.5 }}>AUTO</span>
            : (pushState === "done"
                ? <span style={{ color: P.ac, letterSpacing: 0.5 }}>✓ MANUAL</span>
                : <span style={{ color: P.dm }}>—</span>)}
        </span>
      )}
      {isAdmin && (
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          {alert.forwardedToDiscord || pushState === "done" ? (
            <span style={{ color: P.dm, fontSize: 10 }}>{pushState === "done" ? "✓ posted" : "posted"}</span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onPush && onPush(alert); }}
              disabled={pushState === "pushing"}
              title={pushState === "error" ? "Push failed — click to retry" : "Push this alert to Discord"}
              style={{
                background: "transparent",
                color: pushState === "error" ? P.be : P.ac,
                border: `1px solid ${pushState === "error" ? P.be : P.ac}`,
                borderRadius: 4, padding: "3px 8px", fontSize: 10, fontWeight: 700,
                cursor: pushState === "pushing" ? "wait" : "pointer", fontFamily: "inherit",
                whiteSpace: "nowrap", opacity: pushState === "pushing" ? 0.6 : 1,
              }}>
              {pushState === "pushing" ? "…" : pushState === "error" ? "✗ retry" : "→ push"}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

// ─── DateRail — LIVE pill + single date button opening a calendar popover
//     limited to days that actually have flow data.
//     Redesigned 2026-07-14: was LIVE pill · prev/next arrows · 5 day-chips ·
//     MORE ▾, which consumed the entire header row. Now two controls; the
//     calendar carries all day-selection.
//     Data source: GET /api/flow/dates?source=stocks — the DISTINCT
//     CreatedDate list from flow.db, i.e. exactly the browsable days. ────────
const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
const DOW_SHORT = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function _etTodayMDY() {
  const n = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return `${n.getMonth() + 1}/${n.getDate()}/${n.getFullYear()}`;
}
function _mdyToDate(s) {
  if (!s) return null;
  const p = String(s).split("/").map(Number);
  if (p.length !== 3 || p.some(isNaN)) return null;
  return new Date(p[2], p[0] - 1, p[1]);
}
function _dateToMDY(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function DateRail({ targetDate, onDateChange, onRange, rangeDays }) {
  const [dates, setDates] = useState(null);      // ascending M/D/YYYY, null = loading/failed
  const [calOpen, setCalOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(null); // {y, m} shown in the popover
  const [rangeMode, setRangeMode] = useState(false);   // custom range: click start→end
  const [rangeStart, setRangeStart] = useState(null);  // mdy of the first range click
  const railRef = useRef(null);

  useEffect(() => {
    let dead = false;
    fetch("/api/flow/dates?source=stocks")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!dead && d && Array.isArray(d.dates)) setDates(d.dates); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  // Close the calendar on outside click / Escape.
  useEffect(() => {
    if (!calOpen) return;
    const onDown = (e) => {
      if (railRef.current && !railRef.current.contains(e.target)) setCalOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setCalOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [calOpen]);

  const today = _etTodayMDY();
  // Historical = every data day except today (today == LIVE view).
  const hist = (dates || []).filter(d => d !== today);
  const histSet = new Set(hist);
  const isLive = !targetDate;

  // ── Multi-day range: end date + N-day span, aggregated By-Contract ────────
  const allDays = dates || [];                       // ascending, includes today if data
  const latestDay = allDays[allDays.length - 1];     // most recent data day
  const rc = (on) => ({
    background: on ? P.ac : "transparent", color: on ? P.bg : P.wh,
    border: `1px solid ${on ? P.ac : P.bd}`, borderRadius: 3, padding: "2px 7px",
    fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  });
  const _countDays = (aMdy, bMdy) => {
    const a = _mdyToDate(aMdy), b = _mdyToDate(bMdy);
    if (!a || !b) return 1;
    const lo = a <= b ? a : b, hi = a <= b ? b : a;
    return allDays.filter(x => { const d = _mdyToDate(x); return d && d >= lo && d <= hi; }).length || 1;
  };
  const applyRangePreset = (n) => {
    if (!onRange || !latestDay) return;
    onRange(latestDay === today ? null : latestDay, n);
    setCalOpen(false); setRangeMode(false); setRangeStart(null);
  };
  const applyMTD = () => {
    if (!onRange || !latestDay) return;
    const ld = _mdyToDate(latestDay);
    const ms = new Date(ld.getFullYear(), ld.getMonth(), 1);
    const n = allDays.filter(x => { const d = _mdyToDate(x); return d && d >= ms && d <= ld; }).length || 1;
    onRange(latestDay === today ? null : latestDay, n);
    setCalOpen(false); setRangeMode(false); setRangeStart(null);
  };

  const openCal = () => {
    const base = _mdyToDate(targetDate) || _mdyToDate(hist[hist.length - 1]) || new Date();
    setCalMonth({ y: base.getFullYear(), m: base.getMonth() });
    setCalOpen(o => !o);
  };

  const selDate = _mdyToDate(targetDate);
  const chipBtn = (active) => ({
    background: active ? P.ac : "transparent",
    color: active ? P.bg : P.wh,
    border: `1px solid ${active ? P.ac : P.bd}`,
    borderRadius: 3, padding: "3px 9px", cursor: "pointer",
    fontSize: 11, fontFamily: "inherit", lineHeight: 1.5,
    fontWeight: active ? 700 : 400, whiteSpace: "nowrap",
    transition: "background .15s, color .15s, border-color .15s",
  });
  const arrowBtn = (enabled) => ({
    background: "transparent", color: enabled ? P.wh : P.mt,
    border: `1px solid ${P.bd}`, borderRadius: 3,
    padding: "3px 8px", cursor: enabled ? "pointer" : "default",
    fontSize: 11, fontFamily: "inherit", lineHeight: 1.5,
    opacity: enabled ? 1 : 0.45,
  });  // eslint-disable-line no-unused-vars -- kept for the dates===null fallback path

  // Fallback: dates endpoint unavailable → keep the old native input so the
  // page never loses history access.
  if (dates === null) {
    const iso = (() => {
      const d = _mdyToDate(targetDate);
      if (!d) return "";
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <label style={{ color: P.dm, fontSize: 12 }}>Date:</label>
        <input
          type="date" value={iso}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) { onDateChange(null); return; }
            const [y, m, d] = v.split("-");
            onDateChange(`${parseInt(m)}/${parseInt(d)}/${y}`);
          }}
          style={{
            background: P.bg, color: P.wh, border: `1px solid ${P.bd}`,
            borderRadius: 3, padding: "3px 8px", fontSize: 11,
            fontFamily: "inherit", colorScheme: "dark",
          }}
        />
        {targetDate && (
          <button onClick={() => onDateChange(null)} style={chipBtn(false)} title="Return to live view (today)">
            ← LIVE
          </button>
        )}
      </span>
    );
  }

  // Calendar month grid (only rendered while open).
  let calBody = null;
  if (calOpen && calMonth) {
    const { y, m } = calMonth;
    const first = new Date(y, m, 1);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const lead = first.getDay();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    const earliest = _mdyToDate(hist[0]);
    const latest = new Date();
    const canPrevMonth = earliest && (y > earliest.getFullYear() || (y === earliest.getFullYear() && m > earliest.getMonth()));
    const canNextMonth = y < latest.getFullYear() || (y === latest.getFullYear() && m < latest.getMonth());
    const navBtn = (enabled) => ({
      background: "transparent", color: enabled ? P.wh : P.mt, border: "none",
      cursor: enabled ? "pointer" : "default", fontSize: 13, padding: "2px 8px",
      fontFamily: "inherit", opacity: enabled ? 1 : 0.4,
    });
    calBody = (
      <div style={{
        position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 120,
        background: P.bg, border: `1px solid ${P.bd}`, borderRadius: 6,
        padding: "10px 12px 12px", boxShadow: "0 10px 30px rgba(0,0,0,0.55)",
        width: 246, userSelect: "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <button style={navBtn(canPrevMonth)} disabled={!canPrevMonth} title="Previous month"
            onClick={() => canPrevMonth && setCalMonth(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })}>‹</button>
          <span style={{ color: P.ac, fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
            {MONTH_NAMES[m].toUpperCase()} {y}
          </span>
          <button style={navBtn(canNextMonth)} disabled={!canNextMonth} title="Next month"
            onClick={() => canNextMonth && setCalMonth(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })}>›</button>
        </div>
        <div style={{ display: "flex", gap: 3, marginBottom: 7, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: P.mt, fontSize: 9, letterSpacing: 1, marginRight: 1 }}>RANGE</span>
          <button onClick={() => applyRangePreset(5)} style={rc(false)} title="Last 5 trading days, aggregated By-Contract">5d</button>
          <button onClick={() => applyRangePreset(20)} style={rc(false)} title="Last 20 trading days">20d</button>
          <button onClick={applyMTD} style={rc(false)} title="Month-to-date">MTD</button>
          <button onClick={() => { setRangeMode(m => !m); setRangeStart(null); }} style={rc(rangeMode)}
            title="Custom range: click a start day then an end day">
            {rangeMode ? (rangeStart ? "pick end" : "pick start") : "Custom"}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
          {["S","M","T","W","T","F","S"].map((c, i) => (
            <span key={i} style={{ color: P.mt, fontSize: 9, textAlign: "center", letterSpacing: 1 }}>{c}</span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {cells.map((d, i) => {
            if (d === null) return <span key={i} />;
            const mdy = `${m + 1}/${d}/${y}`;
            const isToday = mdy === today;
            const hasData = histSet.has(mdy);
            const isSel = !isLive && targetDate === mdy;
            const inRangeStart = rangeMode && rangeStart === mdy;
            const clickable = hasData || isToday;
            return (
              <button
                key={i}
                disabled={!clickable}
                onClick={() => {
                  if (rangeMode && onRange) {
                    if (!rangeStart) { setRangeStart(mdy); return; }  // 1st click = start
                    const days = _countDays(rangeStart, mdy);
                    const a = _mdyToDate(rangeStart), b = _mdyToDate(mdy);
                    const end = (b >= a) ? mdy : rangeStart;
                    onRange(end === today ? null : end, days);
                    setRangeStart(null); setRangeMode(false); setCalOpen(false);
                    return;
                  }
                  if (isToday) onDateChange(null);
                  else if (hasData) onDateChange(mdy);
                  setCalOpen(false);
                }}
                title={isToday ? "Today — live view" : hasData ? `View flow for ${mdy}` : "No flow data"}
                style={{
                  background: isSel || inRangeStart ? P.ac : "transparent",
                  color: isSel || inRangeStart ? P.bg : isToday ? P.ac : clickable ? P.wh : P.mt,
                  border: isToday && !isSel ? `1px solid ${P.ac}` : "1px solid transparent",
                  borderRadius: 3, padding: "4px 0", fontSize: 11,
                  fontFamily: "inherit", cursor: clickable ? "pointer" : "default",
                  fontWeight: isSel || isToday ? 700 : 400,
                  opacity: clickable ? 1 : 0.35,
                  position: "relative", lineHeight: 1.4,
                }}
              >
                {d}
                {hasData && !isSel && (
                  <span style={{
                    position: "absolute", bottom: 1, left: "50%", transform: "translateX(-50%)",
                    width: 3, height: 3, borderRadius: "50%", background: P.ac, display: "block",
                  }} />
                )}
              </button>
            );
          })}
        </div>
        <div style={{ color: P.mt, fontSize: 9, marginTop: 8, letterSpacing: 0.5 }}>
          {rangeMode
            ? (rangeStart ? "→ click the END day of the range" : "→ click the START day of the range")
            : <><span style={{ color: P.ac }}>●</span> = flow data · {hist.length} days · RANGE → By-Contract still-open</>}
        </div>
      </div>
    );
  }

  return (
    <span ref={railRef} style={{ display: "inline-flex", alignItems: "center", gap: 6, position: "relative" }}>
      {/* Two controls only (redesign 2026-07-14): LIVE pill + a single date
          button that opens the data-only calendar. Replaces the old
          arrows + 5 day-chips + MORE rail, which ate the whole header row. */}
      <button
        onClick={() => onDateChange(null)}
        title="Live view — today's tape, streaming"
        style={{
          ...chipBtn(isLive),
          fontWeight: 700, letterSpacing: 0.5,
          color: isLive ? P.bg : P.ac,
          borderColor: isLive ? P.ac : P.bd,
        }}
      >
        ● LIVE
      </button>

      <button
        onClick={openCal}
        title="Pick an archived trading day"
        style={{
          ...chipBtn(!isLive),
          color: !isLive ? P.bg : P.dm,
          borderColor: !isLive ? P.ac : P.bd,
          fontWeight: !isLive ? 700 : 400,
        }}
      >
        {selDate
          ? (rangeDays > 1
              ? `${(() => {   // multi-day range: show start → end · Nd
                  const idx = allDays.indexOf(targetDate);
                  const sd = idx >= 0 ? _mdyToDate(allDays[Math.max(0, idx - (rangeDays - 1))]) : null;
                  return sd ? `${sd.getMonth() + 1}/${sd.getDate()}` : `${rangeDays}d`;
                })()} → ${selDate.getMonth() + 1}/${selDate.getDate()} · ${rangeDays}d ▾`
              : `${DOW_SHORT[selDate.getDay()]} ${selDate.getMonth() + 1}/${selDate.getDate()}/${selDate.getFullYear()} ▾`)
          : "📅 HISTORY ▾"}
      </button>

      {calBody}
    </span>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────
function Header({ status, loadPending, warming, workerLive,
                  sortBy, onSortChange, minGrade, onMinGradeChange,
                  rowLimit, onRowLimitChange,
                  hideAlgo, onHideAlgoChange,
                  hideNoSide, onHideNoSideChange,
                  curated, onCuratedChange,
                  tickerFilter, contractFilter, onClearFilters,
                  targetDate, onDateChange, onRange, rangeDays, onOiFetch, oiFetchState,
                  nullOICount }) {
  const lastEvent = status?.last_event_at;
  const returned = status?.returned;
  return (
    <div style={{
      padding: "12px 16px", background: P.cd, marginBottom: 16,
      borderRadius: 4, border: `1px solid ${P.bd}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{
          color: P.ac, fontWeight: 700, fontSize: 14, letterSpacing: 1,
        }}>
          LIVE FLOW
        </span>
        <span style={{
          padding: "2px 8px", borderRadius: 3, fontSize: 11,
          background: loadPending ? P.bd : (workerLive ? P.bu : P.be),
          color: P.wh,
        }}>
          {loadPending
            ? "◌ LOADING…"
            : (workerLive ? "● WORKER LIVE" : "○ WORKER IDLE")}
        </span>
        {!loadPending && warming && (
          <span style={{ color: P.dm, fontSize: 11 }}>syncing…</span>
        )}
        {!loadPending && lastEvent && (
          <span style={{ color: P.dm, fontSize: 11 }}>
            last event: {new Date(lastEvent).toLocaleTimeString()}
          </span>
        )}
        <span style={{ marginLeft: "auto", color: P.dm, fontSize: 12 }}>
          {returned} alerts
        </span>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        marginTop: 10, paddingTop: 10, borderTop: `1px solid ${P.bd}`,
      }}>
        <DateRail targetDate={targetDate} onDateChange={onDateChange} onRange={onRange} rangeDays={rangeDays} />

        <span style={{ width: 1, height: 18, background: P.bd, margin: "0 6px" }} />

        {/* CURATED / ALL FLOW — primary mode toggle. Curated default = best
            setups only (stacked criteria). All Flow = firehose for power
            users. Cards stay day-scoped to full classifiable flow either way. */}
        <div style={{
          display: "inline-flex", borderRadius: 4, overflow: "hidden",
          border: `1px solid ${P.bd}`,
        }}>
          <button
            onClick={() => onCuratedChange(true)}
            title="Curated mode — show only alerts that meet stacked criteria (premium + V/OI + hits + grade). Best setups only."
            style={{
              padding: "5px 14px", border: "none",
              background: curated ? P.ac : "transparent",
              color: curated ? P.bg : P.wh,
              cursor: "pointer", fontSize: 11, fontWeight: 700,
            }}
          >
            ★ CURATED
          </button>
          <button
            onClick={() => onCuratedChange(false)}
            title="All Flow — show every classifiable alert (firehose). Use to find missed signals or audit."
            style={{
              padding: "5px 14px", border: "none",
              background: !curated ? P.ac : "transparent",
              color: !curated ? P.bg : P.wh,
              cursor: "pointer", fontSize: 11, fontWeight: 700,
            }}
          >
            ALL FLOW
          </button>
        </div>

        <span style={{ width: 1, height: 18, background: P.bd, margin: "0 6px" }} />

        <label
          style={{ color: P.dm, fontSize: 12 }}
          title="Selects WHICH alerts the page shows. The feed is always displayed in time order regardless of which option you pick — these just change the criterion for what gets included in the top-N window."
        >
          Filter by:
        </label>
        {["recent", "conviction", "premium"].map(opt => (
          <button
            key={opt}
            onClick={() => onSortChange(opt)}
            title={
              opt === "recent"
                ? "Show the most recent N alerts (latest first)"
                : opt === "conviction"
                  ? "Show the top N by conviction score — displayed in time order"
                  : "Show the top N by premium dollar size — displayed in time order"
            }
            style={{
              background: sortBy === opt ? P.ac : "transparent",
              color: sortBy === opt ? P.bg : P.wh,
              border: `1px solid ${P.bd}`, borderRadius: 3,
              padding: "3px 10px", cursor: "pointer", fontSize: 11,
              textTransform: "capitalize",
            }}
          >
            {opt}
          </button>
        ))}

        <span style={{ width: 1, height: 18, background: P.bd, margin: "0 6px" }} />

        <label style={{ color: P.dm, fontSize: 12 }}>Min grade:</label>
        {["A", "B", "C", "D"].map(g => (
          <button
            key={g}
            onClick={() => onMinGradeChange(g)}
            style={{
              background: minGrade === g ? P.ac : "transparent",
              color: minGrade === g ? P.bg : P.wh,
              border: `1px solid ${P.bd}`, borderRadius: 3,
              padding: "3px 10px", cursor: "pointer", fontSize: 11,
            }}
          >
            ≥{g}
          </button>
        ))}

        <span style={{ width: 1, height: 18, background: P.bd, margin: "0 6px" }} />

        <label style={{ color: P.dm, fontSize: 12 }}>Show:</label>
        {ROW_LIMIT_OPTIONS.map(n => (
          <button
            key={n}
            onClick={() => onRowLimitChange(n)}
            title={
              n === "All"
                ? "Show every classifiable alert for the day. Cards are always day-scoped so this only affects the table below. Note: large tables can slow scrolling — pick 1000 or less if it feels sluggish."
                : `Keep up to ${n} recent alerts in the feed (cards are always day-scoped)`
            }
            style={{
              background: rowLimit === n ? P.ac : "transparent",
              color: rowLimit === n ? P.bg : P.wh,
              border: `1px solid ${P.bd}`, borderRadius: 3,
              padding: "3px 10px", cursor: "pointer", fontSize: 11,
            }}
          >
            {n}
          </button>
        ))}

        <span style={{ width: 1, height: 18, background: P.bd, margin: "0 6px" }} />


        <span style={{ width: 1, height: 18, background: P.bd, margin: "0 6px" }} />

        <button
          onClick={onOiFetch}
          disabled={oiFetchState?.loading || nullOICount === 0}
          title={
            nullOICount === 0
              ? "All contracts already have OI"
              : `Fetch Schwab OI for ${nullOICount} unresolved contracts`
          }
          style={{
            background: oiFetchState?.loading ? P.mt : (nullOICount > 0 ? P.ac + "14" : "transparent"),
            color: oiFetchState?.loading ? P.bg : (nullOICount > 0 ? P.ac : P.mt),
            border: `1px solid ${nullOICount > 0 ? P.ac : P.bd}`, borderRadius: 3,
            padding: "3px 10px",
            cursor: oiFetchState?.loading ? "wait" : (nullOICount > 0 ? "pointer" : "not-allowed"),
            fontSize: 11, fontWeight: 600,
          }}
        >
          {oiFetchState?.loading
            ? "⟳ fetching…"
            : `↻ fetch OI${nullOICount > 0 ? ` (${nullOICount})` : ""}`}
        </button>
        {oiFetchState?.result && (
          <span
            style={{
              fontSize: 11,
              color: oiFetchState.result.error
                ? P.be
                : (oiFetchState.result.failedContracts?.length > 0 ? P.dm : P.bu),
            }}
            title={
              oiFetchState.result.failedContracts?.length > 0
                ? `Schwab returned no OI for:\n${oiFetchState.result.failedContracts.join("\n")}`
                : ""
            }
          >
            {oiFetchState.result.error
              ? `error: ${oiFetchState.result.error}`
              : oiFetchState.result.failedContracts?.length > 0
                ? `filled ${oiFetchState.result.filled}/${oiFetchState.result.total} (${oiFetchState.result.failedContracts.length} missing ⓘ)`
                : `filled ${oiFetchState.result.filled}/${oiFetchState.result.total}`}
          </span>
        )}

        {(tickerFilter.size > 0 || contractFilter.size > 0) && (
          <>
            <span style={{ width: 1, height: 18, background: P.bd, margin: "0 6px" }} />
            <span style={{ color: P.dm, fontSize: 11 }}>
              {tickerFilter.size > 0 && `tickers: ${[...tickerFilter].join(", ")}`}
              {tickerFilter.size > 0 && contractFilter.size > 0 && " | "}
              {contractFilter.size > 0 && `contracts: ${contractFilter.size}`}
            </span>
            <button
              onClick={onClearFilters}
              style={{
                background: "transparent", color: P.be,
                border: `1px solid ${P.be}`, borderRadius: 3,
                padding: "3px 8px", cursor: "pointer", fontSize: 11,
              }}
            >
              ✕ clear
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Column headers ───────────────────────────────────────────────────────
// Click any header to sort the table by that column. 1st click applies the
// column's default direction, 2nd click flips it, 3rd click resets to the
// natural TIME-descending tape order. The active column shows ▲/▼ in gold.
function ColumnHeaders({ sortCol, sortDir, onSort, isAdmin }) {
  return (
    <div style={{
      display: "grid",
      // TIME | TICKER | SPOT | STRIKE | C/P | EXP | %ITM/OTM | PRICE | VOL | OI | V/OI | PREMIUM | GRADE | SIDE | TYPE | P/L | ALERT | (admin: POSTED | PUSH)
      gridTemplateColumns: "98px 100px 75px 80px 42px 100px 75px 70px 70px 70px 60px 95px 60px 50px 55px 75px 1fr" + (isAdmin ? " 68px 94px" : ""),
      gap: 8, padding: "6px 12px",
      fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
      borderBottom: `1px solid ${P.bd}`, marginBottom: 4,
    }}>
      {COLUMNS.map(col => {
        const active = sortCol === col.key;
        return (
          <span
            key={col.key}
            onClick={() => onSort(col.key)}
            title={`Sort by ${col.label}`}
            style={{
              textAlign: col.align,
              paddingLeft: col.align === "left" ? 4 : 0,
              color: active ? P.ac : P.mt,
              cursor: "pointer",
              userSelect: "none",
              whiteSpace: "nowrap",
            }}
          >
            {col.label}{active ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
          </span>
        );
      })}
      {isAdmin && <span style={{ textAlign: "center", color: P.mt, whiteSpace: "nowrap" }}>POSTED</span>}
      {isAdmin && <span style={{ textAlign: "center", color: P.mt, whiteSpace: "nowrap" }}>PUSH</span>}
    </div>
  );
}

// ─── Curated qualification (client-side, mirrors backend) ─────────────────
// Used by the tuning panel's live preview. Must match backend
// _qualifies_curated() exactly so the preview count matches what would
// actually show after save.
const _GRADE_NUMERIC_FE = { "A+ 🚀": 4, "A+": 4, "A": 3, "B": 2, "C": 1, "D": 0 };

function _capBandFE(mktCap, capBands) {
  const mc = Number(mktCap) || 0;
  if (mc <= 0) return "mid_small";
  if (mc < (capBands?.mid_small_max ?? 10e9)) return "mid_small";
  if (mc < (capBands?.large_max ?? 200e9)) return "large";
  return "mega";
}

function qualifiesCurated(alert, thresholds) {
  const tier = alert._tierKey || "";
  if (tier === "algo") return false;
  const prem = alert.alertPremium || 0;
  const vOI = alert.volumeOIRatio || 0;
  const hitCount = alert._hitCount || 1;
  const grade = alert.grade || "";
  const mktCap = alert._mktCap || 0;
  // 7/7 + 7/9: source-aware branch. The backend `source` is now AUTHORITATIVE
  // (Massive ticker_types), so PREFER it — only fall back to the client-side
  // KNOWN_ETFS_INDEXES set when source is absent (pre-change rows). The old code
  // OR'd them, which let the stale set (e.g. SPCX) override a correct source.
  const isEtf = alert.source ? alert.source === "indexes" : KNOWN_ETFS_INDEXES.has(alert.ticker);
  if (tier === "unusual") {
    const u = (isEtf ? thresholds?.etf_unusual : thresholds?.unusual) || {};
    return prem >= (u.min_premium ?? (isEtf ? 500000 : 100000))
        && vOI >= (u.vOI ?? (isEtf ? 10.0 : 5.0));
  }
  if (!["alpha","size","leaps","bullish","bearish"].includes(tier)) return false;
  const stack = thresholds?.stack || {};
  // HARD requirement: premium tier floor. ETF path is flat (no cap band);
  // stock path uses tier × cap band matrix.
  let premFloor;
  if (isEtf) {
    premFloor = (thresholds?.etf_premium_floors || {})[tier] ?? 0;
  } else {
    const premCaps = thresholds?.premium_by_cap?.[tier] || {};
    const band = _capBandFE(mktCap, thresholds?.cap_bands);
    premFloor = premCaps[band] ?? 0;
  }
  if (prem < premFloor) return false;
  // Optional HARD gate: V/OI required (7/7). Mirrors backend logic — when
  // the admin panel toggles this on, V/OI < stack.vOI is a short-circuit
  // fail regardless of confirmer count.
  if (stack.voi_required && vOI < (stack.vOI ?? 3.0)) return false;
  // Count quality signals (V/OI, hits, grade) — premium NOT counted here
  let qualitySignals = 0;
  if (vOI >= (stack.vOI ?? 3.0)) qualitySignals++;
  if (hitCount >= (stack.hit_count ?? 3)) qualitySignals++;
  const minGradeN = _GRADE_NUMERIC_FE[stack.grade ?? "B"] ?? 2;
  if ((_GRADE_NUMERIC_FE[grade] ?? 0) >= minGradeN) qualitySignals++;
  return qualitySignals >= (stack.min_signals ?? 1);
}

// ─── Tuning Panel (admin only, ?tune=1) ───────────────────────────────────
// Renders all Curated-mode threshold controls + live-preview math against
// the current alert window. Hidden from non-admin users; gated by URL param
// rather than auth because this is internal-only.
function TuningPanel({ thresholds, onChange, onSave, onReset, dirty, alerts, autoPushCfg, onAutoPush, targetDate }) {
  // Collapse toggle — the panel is tall; let admins fold it to just the header
  // bar (Save/Reset stay accessible) so it doesn't eat the whole page. Persisted.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("uct_massive_tune_collapsed") === "1"; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed(c => {
    const nv = !c;
    try { localStorage.setItem("uct_massive_tune_collapsed", nv ? "1" : "0"); } catch {}
    return nv;
  });
  // Weekly Conviction manual controls (lookback + cap) — rendered in the AUTO-PUSH box.
  const [sfSort, setSfSort] = useState("net");   // Open Flow card sort: net | premium
  // Standing Conviction (rolling still-open) manual controls — own lookback + cap.
  const [sfDays, setSfDays] = useState(60);
  const [sfCap, setSfCap] = useState("all");
  // Preview/Push run a heavy multi-week flow.db scan (seconds) — track which
  // button is in flight so it shows progress + disables instead of reading dead.
  const [busy, setBusy] = useState("");
  const doPreview = async (url, key) => {
    setBusy(key);
    try {
      const r = await fetch(url, { method: "POST" });
      if (!r.ok) {
        window.alert("Preview failed: HTTP " + r.status + (r.status === 502
          ? " — the scan ran past the 120s limit; retry (the cache warms) or pick a smaller window."
          : ""));
        return;
      }
      const b = await r.blob();
      if (b.type.startsWith("image")) window.open(URL.createObjectURL(b));
      else window.alert("No image — " + (await b.text()));
    } catch (e) { window.alert("Preview failed: " + e); }
    finally { setBusy(""); }
  };
  const doPush = async (url, label, key) => {
    if (!window.confirm(`Post the ${label} to Discord?`)) return;
    setBusy(key);
    try {
      const r = await fetch(url, { method: "POST" });
      const j = await r.json();
      window.alert(j.posted ? `Posted ✓ — ${j.names} names`
        : `Not posted — ${j.reason || j.detail || "unknown"}`);
    } catch (e) { window.alert("Push failed: " + e); }
    finally { setBusy(""); }
  };
  const btnStyle = (key, primary) => ({
    padding: "3px 10px", fontSize: 10, fontWeight: 700, borderRadius: 3,
    cursor: busy ? "wait" : "pointer", opacity: busy && busy !== key ? 0.5 : 1,
    background: primary ? P.ac : "transparent", color: primary ? P.bg : P.wh,
    border: primary ? "none" : `1px solid ${P.bd}`,
  });
  if (!thresholds) {
    return (
      <div style={{
        margin: "12px 0", padding: 12, background: P.cd,
        border: `1px solid ${P.bd}`, borderRadius: 6, color: P.dm,
      }}>
        Loading thresholds…
      </div>
    );
  }

  // Helper to mutate a nested path in thresholds
  const setPath = (path, value) => {
    const next = JSON.parse(JSON.stringify(thresholds));
    let cur = next;
    for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
    cur[path[path.length - 1]] = value;
    onChange(next, path);
  };

  // Live preview — count how many of current alerts would pass Curated
  const previewPass = alerts.filter(a => qualifiesCurated(a, thresholds)).length;
  // 7/7: also compute what would pass with V/OI required forced on, so
  // the impact of ticking the checkbox is visible before you tick it.
  const thresholdsIfVoiReq = {
    ...thresholds,
    stack: { ...(thresholds.stack || {}), voi_required: true },
  };
  const previewPassVoiReq = alerts.filter(a => qualifiesCurated(a, thresholdsIfVoiReq)).length;
  const previewTotal = alerts.length;

  const NumberInput = ({ value, onChange, step = 50000, min = 0, suffix = "" }) => (
    <input
      type="number" value={value} step={step} min={min}
      onChange={e => onChange(Number(e.target.value))}
      style={{
        width: 90, padding: "3px 6px", fontSize: 11,
        background: P.bg, color: P.wh, border: `1px solid ${P.bd}`,
        borderRadius: 3, fontFamily: "inherit",
      }}
    />
  );

  const Label = ({ children, w = 90 }) => (
    <span style={{ color: P.dm, fontSize: 11, minWidth: w, display: "inline-block" }}>
      {children}
    </span>
  );

  return (
    <div style={{
      margin: "12px 0", padding: 14,
      background: P.cd, border: `2px dashed ${P.ac}`, borderRadius: 6,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10,
      }}>
        <div onClick={toggleCollapsed} style={{
          color: P.ac, fontSize: 12, fontWeight: 800, letterSpacing: 1,
          cursor: "pointer", userSelect: "none",
        }} title={collapsed ? "Expand tuning panel" : "Collapse tuning panel"}>
          {collapsed ? "▶" : "▼"}  🔧 ADMIN: CURATED TUNING PANEL
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{
            color: dirty ? P.ac : P.dm, fontSize: 11, fontStyle: "italic",
          }}>
            {dirty ? "● unsaved changes" : "saved"}
          </span>
          <button
            onClick={onSave} disabled={!dirty}
            style={{
              padding: "4px 12px", fontSize: 11, fontWeight: 700,
              background: dirty ? P.ac : "transparent",
              color: dirty ? P.bg : P.dm,
              border: `1px solid ${dirty ? P.ac : P.bd}`,
              borderRadius: 3, cursor: dirty ? "pointer" : "not-allowed",
            }}
          >
            Save defaults
          </button>
          <button
            onClick={onReset}
            style={{
              padding: "4px 12px", fontSize: 11,
              background: "transparent", color: P.wh,
              border: `1px solid ${P.bd}`, borderRadius: 3, cursor: "pointer",
            }}
          >
            Reset to factory
          </button>
        </div>
      </div>

      {!collapsed && (<>
      {/* ── Auto-push to Discord ── master switch + algo, saved to the backend. */}
      {autoPushCfg && (
        <div style={{
          padding: "8px 10px", background: P.bg, borderRadius: 3, marginBottom: 12,
          border: `1px solid ${autoPushCfg.enabled ? DIR_BULL : P.dm}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: P.mt, letterSpacing: 0.5 }}>
              ⚡ AUTO-PUSH TO DISCORD
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11,
              fontWeight: 700, color: autoPushCfg.enabled ? DIR_BULL : P.dm }}>
              <input type="checkbox" checked={!!autoPushCfg.enabled}
                onChange={e => onAutoPush && onAutoPush({ enabled: e.target.checked })} />
              {autoPushCfg.enabled ? "ON" : "OFF"}
            </label>
          </div>
          <div style={{ fontSize: 10, color: P.dm, marginBottom: 6 }}>
            {autoPushCfg.enabled
              ? "Qualifying alerts auto-post to Discord as they appear."
              : "Off — nothing auto-posts; use the → push buttons."}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 10, color: P.dm }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={!!autoPushCfg.alpha_gold}
                onChange={e => onAutoPush && onAutoPush({ alpha_gold: e.target.checked })} /> Alpha Gold
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={!!autoPushCfg.grade_a}
                onChange={e => onAutoPush && onAutoPush({ grade_a: e.target.checked })} /> Grade A / A+
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={!!autoPushCfg.size_sweep_enabled}
                onChange={e => onAutoPush && onAutoPush({ size_sweep_enabled: e.target.checked })} /> Size B sweeps &ge; $3M
            </label>
          </div>
          {/* Manual EOD push — post the WHOLE day's Alpha Gold as one summary
              card image (distinct from the per-alert → push buttons). Posts the
              day being viewed (targetDate) or today; uses the admin session. */}
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${P.dm}` }}>
            <button
              onClick={async () => {
                const dayLabel = targetDate || "today";
                if (!window.confirm(`Post the Alpha Gold EOD summary card (${dayLabel}) to Discord?`)) return;
                try {
                  const p = new URLSearchParams({ post: "1" });
                  if (targetDate) p.set("target_date", targetDate);
                  const r = await fetch(`/api/live/massive/alpha-gold-eod?${p.toString()}`, { method: "POST" });
                  const j = await r.json();
                  window.alert(j.posted
                    ? `Posted ${j.count} Alpha Gold to Discord ✓`
                    : `Not posted — ${j.reason || j.detail || "unknown"}`);
                } catch (e) { window.alert("Push failed: " + e); }
              }}
              style={{
                padding: "5px 12px", fontSize: 11, fontWeight: 700,
                background: P.ac, color: P.bg, border: "none", borderRadius: 3,
                cursor: "pointer", letterSpacing: 0.3,
              }}>
              ★ Push Alpha Gold EOD summary → Discord
            </button>
            <span style={{ fontSize: 10, color: P.dm, marginLeft: 10 }}>
              posts the whole day's list as one image
            </span>
          </div>
          {/* OPEN FLOW — the single merged still-open board (Weekly Conviction +
              Open Flow unified 8/2). Window + cap + Net/Premium sort. Hits POST
              /standing-flow. */}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${P.dm}`,
            display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: P.mt, marginRight: 2 }}>OPEN FLOW</span>
            {[5, 20, 60, 90].map(dd => {
              const on = sfDays === dd;
              return (
                <button key={dd} onClick={() => setSfDays(dd)} style={{
                  padding: "3px 8px", fontSize: 10, fontWeight: 700, borderRadius: 3, cursor: "pointer",
                  background: on ? P.ac : "transparent", color: on ? P.bg : P.wh,
                  border: `1px solid ${on ? P.ac : P.bd}` }}>{dd}d</button>
              );
            })}
            <span style={{ width: 6 }} />
            {[["all", "All"], ["mega", "Mega"], ["large", "Large"], ["mid_small", "Mid-Small"], ["etf", "ETFs"]].map(([c, lbl]) => {
              const on = sfCap === c;
              return (
                <button key={c} onClick={() => setSfCap(c)} style={{
                  padding: "3px 8px", fontSize: 10, fontWeight: 700, borderRadius: 3, cursor: "pointer",
                  background: on ? P.ac : "transparent", color: on ? P.bg : P.wh,
                  border: `1px solid ${on ? P.ac : P.bd}` }}>{lbl}</button>
              );
            })}
            <span style={{ width: 6 }} />
            <span style={{ fontSize: 9, color: P.mt }}>sort:</span>
            {[["net", "Net"], ["premium", "Premium"]].map(([s, lbl]) => {
              const on = sfSort === s;
              return (
                <button key={s} onClick={() => setSfSort(s)} style={{
                  padding: "3px 8px", fontSize: 10, fontWeight: 700, borderRadius: 3, cursor: "pointer",
                  background: on ? P.ac : "transparent", color: on ? P.bg : P.wh,
                  border: `1px solid ${on ? P.ac : P.bd}` }}>{lbl}</button>
              );
            })}
            <button disabled={!!busy} style={btnStyle("sfp", false)}
              onClick={() => doPreview(`/api/live/massive/standing-flow?post=0&days=${sfDays}&cap=${sfCap}&sort=${sfSort}`, "sfp")}>
              {busy === "sfp" ? "Previewing…" : "👁 Preview"}</button>
            <button disabled={!!busy} style={btnStyle("sfx", true)}
              onClick={() => doPush(`/api/live/massive/standing-flow?post=1&days=${sfDays}&cap=${sfCap}&sort=${sfSort}`, `Open Flow card (${sfDays}d · ${sfCap} · ${sfSort})`, "sfx")}>
              {busy === "sfx" ? "Posting…" : "★ Push → Discord"}</button>
          </div>
        </div>
      )}

      {/* Preview ribbon */}
      <div style={{
        padding: "6px 10px", background: P.bg, borderRadius: 3,
        marginBottom: 12, fontSize: 11, color: P.dm,
      }}>
        Live preview: <span style={{ color: P.ac, fontWeight: 700 }}>
          {previewPass} of {previewTotal}
        </span> visible alerts would pass Curated with current settings.
        {!thresholds.stack?.voi_required && previewPass !== previewPassVoiReq && (
          <span style={{ color: P.dm, marginLeft: 8 }}>
            ({previewPassVoiReq} of {previewTotal} if V/OI required)
          </span>
        )}
      </div>

      {/* Stacking criteria */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: P.wh, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
          QUALITY CONFIRMERS — beyond the premium floor (which is always required),
          alert must also meet ≥{" "}
          <NumberInput value={thresholds.stack.min_signals}
            onChange={v => setPath(["stack","min_signals"], v)} step={1} min={0} />
          {" "}of these 3:
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingLeft: 12 }}>
          <div><Label>V/OI ≥</Label>
            <NumberInput value={thresholds.stack.vOI}
              onChange={v => setPath(["stack","vOI"], v)} step={0.5} />
            <span style={{ color: P.dm, fontSize: 10, marginLeft: 4 }}>x</span>
            <label style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              marginLeft: 12, fontSize: 10, color: P.wh, cursor: "pointer",
            }}>
              <input type="checkbox"
                checked={!!thresholds.stack.voi_required}
                onChange={e => setPath(["stack","voi_required"], e.target.checked)}
                style={{ margin: 0, cursor: "pointer" }} />
              required
            </label>
          </div>
          <div><Label>Hit count ≥</Label>
            <NumberInput value={thresholds.stack.hit_count}
              onChange={v => setPath(["stack","hit_count"], v)} step={1} min={1} />
            <span style={{ color: P.dm, fontSize: 10, marginLeft: 4 }}>fires</span>
          </div>
          <div><Label>Grade ≥</Label>
            <select value={thresholds.stack.grade}
              onChange={e => setPath(["stack","grade"], e.target.value)}
              style={{
                padding: "3px 6px", fontSize: 11, background: P.bg,
                color: P.wh, border: `1px solid ${P.bd}`, borderRadius: 3,
                fontFamily: "inherit",
              }}>
              <option value="A+">A+</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
            </select>
          </div>
          <div style={{ color: P.dm, fontSize: 10, fontStyle: "italic" }}>
            0 = premium alone OK · 1 = +1 confirmer · 3 = strictest
          </div>
        </div>
      </div>

      {/* Side classification & direction guards (2026-07-24).
          These backend tunables existed in DEFAULT_THRESHOLDS but had no UI, so
          they could only be changed by POSTing JSON by hand. Worse, the panel
          fetches thresholds ONCE per visit — so an out-of-band change made
          while the panel was open would be silently reverted by the next Save.
          Rendering them here removes both problems. */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: P.ac, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
          SIDE CLASSIFICATION &amp; DIRECTION GUARDS
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-start" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: P.wh }}>
            <input type="checkbox"
              checked={thresholds.derive_strict_bid_only_bb ?? true}
              onChange={e => setPath(["derive_strict_bid_only_bb"], e.target.checked)} />
            <span>Strict bid (<code>BB</code> only)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: P.wh }}>
            <input type="checkbox"
              checked={thresholds.sweep_empty_side_as_ask ?? false}
              onChange={e => setPath(["sweep_empty_side_as_ask"], e.target.checked)} />
            <span>Blank-side sweeps → ASK</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: P.wh }}>
            <input type="checkbox"
              checked={thresholds.spotless_itm_guard ?? true}
              onChange={e => setPath(["spotless_itm_guard"], e.target.checked)} />
            <span>Guard deep-ITM when spot missing</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: P.wh }}>
            <input type="checkbox"
              checked={thresholds.hide_sizeless ?? false}
              onChange={e => setPath(["hide_sizeless"], e.target.checked)} />
            <span>Hide neutral “Not Clean” rows</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: P.wh }}>
            <input type="checkbox"
              checked={thresholds.hide_block_only ?? false}
              onChange={e => setPath(["hide_block_only"], e.target.checked)} />
            <span>Hide block-only (require sweep)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: P.wh }}>
            <input type="checkbox"
              checked={thresholds.incremental_scan ?? false}
              onChange={e => setPath(["incremental_scan"], e.target.checked)} />
            <span>Incremental scan (perf - fixes blank sides)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: P.wh }}
                 title="Auto-push scans only symbols with new prints since the last cycle (not the whole day), so Discord alerts fire in ~60s even at the cold open. Dedup guarantees no double/missed push. Flip off to revert to the full-day scan instantly.">
            <input type="checkbox"
              checked={thresholds.autopush_incremental ?? false}
              onChange={e => setPath(["autopush_incremental"], e.target.checked)} />
            <span>Incremental auto-push (perf - fixes open-time alert lag)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: P.wh }}
                 title="Clean directional flow only: drop bid-side sells contaminated by earlier ask-buying on the same contract (likely profit-take / mixed, not clean conviction) from the directional tiers — they surface as neutral 'Not Clean'. Clean writes and ask-side buys are kept.">
            <input type="checkbox"
              checked={thresholds.close_detector_enabled ?? false}
              onChange={e => setPath(["close_detector_enabled"], e.target.checked)} />
            <span>Clean directional (drop mixed bid-sells)</span>
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: P.mt }}>
            <span>Direction max ITM %</span>
            <NumberInput value={thresholds.direction_max_itm_pct ?? 20}
              onChange={v => setPath(["direction_max_itm_pct"], v)} step={1} min={0} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: P.mt }}>
            <span>Keep-as-Size min premium</span>
            <NumberInput value={thresholds.keep_sizeless_min_premium ?? 1000000}
              onChange={v => setPath(["keep_sizeless_min_premium"], v)} step={250000} min={0} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: P.mt }}>
            <span>Net-flow min ratio</span>
            <NumberInput value={thresholds.net_flow_min_ratio ?? 0.67}
              onChange={v => setPath(["net_flow_min_ratio"], v)} step={0.01} min={0} />
          </div>
        </div>
        <div style={{ color: P.dm, fontSize: 10, fontStyle: "italic", marginTop: 6 }}>
          Strict bid OFF counts a plain <code>B</code> as sold (call sold = bear, put sold = bull) —
          this is what surfaces at-bid flow instead of leaving it neutral. Net-flow ratio 0 disables the
          two-way demote.
        </div>
      </div>

      {/* Premium by tier × cap band */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: P.wh, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
          PREMIUM FLOORS (HARD REQUIREMENT) by tier × cap band
          (mid-small &lt; $10B, mega &gt; $200B):
        </div>
        <table style={{
          width: "100%", fontSize: 11, color: P.wh, borderCollapse: "collapse",
          marginLeft: 12,
        }}>
          <thead>
            <tr style={{ color: P.dm, textAlign: "left" }}>
              <th style={{ padding: "3px 6px", fontWeight: 600 }}>Tier</th>
              <th style={{ padding: "3px 6px", fontWeight: 600 }}>Mid-Small</th>
              <th style={{ padding: "3px 6px", fontWeight: 600 }}>Large</th>
              <th style={{ padding: "3px 6px", fontWeight: 600 }}>Mega</th>
            </tr>
          </thead>
          <tbody>
            {["alpha","size","leaps","bullish","bearish"].map(t => (
              <tr key={t}>
                <td style={{
                  padding: "3px 6px", color: TIER_META[t]?.color || P.wh,
                  fontWeight: 700, textTransform: "uppercase",
                }}>
                  {TIER_META[t]?.label || t}
                </td>
                {["mid_small","large","mega"].map(band => (
                  <td key={band} style={{ padding: "3px 6px" }}>
                    <NumberInput
                      value={thresholds.premium_by_cap[t]?.[band] || 0}
                      onChange={v => setPath(["premium_by_cap",t,band], v)}
                      step={50000} min={0}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Unusual tier — own path */}
      <div>
        <div style={{ color: P.wh, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
          UNUSUAL TIER (cap-agnostic — own path, no stacking):
        </div>
        <div style={{ display: "flex", gap: 16, paddingLeft: 12, alignItems: "center" }}>
          <div><Label>Min premium</Label>
            <NumberInput value={thresholds.unusual.min_premium}
              onChange={v => setPath(["unusual","min_premium"], v)} step={25000} />
          </div>
          <div><Label>V/OI ≥</Label>
            <NumberInput value={thresholds.unusual.vOI}
              onChange={v => setPath(["unusual","vOI"], v)} step={0.5} />
            <span style={{ color: P.dm, fontSize: 10, marginLeft: 4 }}>x</span>
          </div>
        </div>
      </div>

      {/* Premium Override — rescues high-conviction WHITE rows that
          Massive's V/OI classifier missed due to OI=0 (fresh strikes). */}
      <div style={{ marginTop: 12 }}>
        <div style={{ color: P.wh, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
          PREMIUM OVERRIDE — rescue big sweeps/blocks when OI is unknown:
        </div>
        <div style={{ display: "flex", gap: 16, paddingLeft: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, color: P.wh, fontSize: 11, cursor: "pointer" }}>
            <input type="checkbox"
              checked={thresholds.premium_override?.enabled ?? true}
              onChange={e => setPath(["premium_override","enabled"], e.target.checked)} />
            Enabled
          </label>
          <div><Label>Min premium</Label>
            <NumberInput value={thresholds.premium_override?.min_premium ?? 1000000}
              onChange={v => setPath(["premium_override","min_premium"], v)} step={100000} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 4, color: P.wh, fontSize: 11, cursor: "pointer" }}>
            <input type="checkbox"
              checked={thresholds.premium_override?.require_sweep_or_block ?? true}
              onChange={e => setPath(["premium_override","require_sweep_or_block"], e.target.checked)} />
            Require SWEEP/BLOCK type
          </label>
        </div>
        <div style={{ paddingLeft: 12, marginTop: 6, color: P.mt, fontSize: 10, fontStyle: "italic" }}>
          WHITE rows ≥ this premium get promoted to MAGENTA classification so
          they surface in /live-massive. Without this, fresh strikes with OI=0
          get filtered out even if they're institutional sweeps.
        </div>
      </div>

      {/* 7/7: Admin gate for the ETF/index pipeline. When off (default),
          only source='stocks' rows flow through — SPY/QQQ/SOXL/NDXP etc.
          are ingested but not surfaced. When on, source='indexes' rows
          also flow through, and the user-facing Stocks/ETFs/All toggle
          in the header can actually partition them. */}
      <div style={{ marginTop: 12 }}>
        <div style={{ color: P.wh, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
          ETFs / INDEXES — surface in the alert stream:
        </div>
        <div style={{ display: "flex", gap: 16, paddingLeft: 12, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: P.wh, fontSize: 11, cursor: "pointer" }}>
            <input type="checkbox"
              checked={!!thresholds.etf_enabled}
              onChange={e => setPath(["etf_enabled"], e.target.checked)} />
            Include source='indexes' rows (SPY, QQQ, SOXL, NDXP, VIX, TLT, GDX, …)
          </label>
        </div>
        <div style={{ paddingLeft: 12, marginTop: 6, color: P.mt, fontSize: 10, fontStyle: "italic" }}>
          Off (default): stocks-only stream, ETFs suppressed at query time.
          On: both flow through; users can toggle Stocks/ETFs/All in the
          header row to filter what they see. Change takes effect on next
          5s poll cycle after Save.
        </div>
      </div>

      {/* 7/7: ETF PREMIUM FLOORS — separate from stocks because $100K-$500K
          on SPY/QQQ is retail dust, not institutional. No cap bands (major
          ETFs are all mega-scale). */}
      <div style={{ marginTop: 12 }}>
        <div style={{ color: P.wh, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
          ETF PREMIUM FLOORS (HARD REQUIREMENT) — used when source='indexes':
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "160px 1fr",
          rowGap: 6, columnGap: 12, paddingLeft: 12,
          fontSize: 11, color: P.wh,
        }}>
          <div style={{ color: P.dm, fontSize: 10 }}>Tier</div>
          <div style={{ color: P.dm, fontSize: 10 }}>Floor</div>
          {["alpha","size","leaps","bullish","bearish"].map(tier => (
            <Fragment key={tier}>
              <div style={{ color: TIER_META[tier]?.color || P.wh, textTransform: "uppercase" }}>
                {TIER_META[tier]?.label || tier}
              </div>
              <div>
                <NumberInput
                  value={thresholds.etf_premium_floors?.[tier] ?? 0}
                  onChange={v => setPath(["etf_premium_floors", tier], v)}
                  step={100000}
                />
              </div>
            </Fragment>
          ))}
        </div>
        <div style={{ paddingLeft: 12, marginTop: 6, color: P.mt, fontSize: 10, fontStyle: "italic" }}>
          Applied to SPY, QQQ, SOXL, NDXP, VIX, etc. Stock tickers continue
          to use the Premium Floors table above.
        </div>
      </div>

      {/* 7/7: ETF UNUSUAL — own path, higher floor than stock Unusual because
          the same argument applies (small ETF prints = retail, not signal). */}
      <div style={{ marginTop: 12 }}>
        <div style={{ color: P.wh, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
          ETF UNUSUAL TIER — used when source='indexes':
        </div>
        <div style={{ display: "flex", gap: 16, paddingLeft: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div><Label>Min premium</Label>
            <NumberInput value={thresholds.etf_unusual?.min_premium ?? 500000}
              onChange={v => setPath(["etf_unusual","min_premium"], v)} step={100000} />
          </div>
          <div><Label>V/OI ≥</Label>
            <NumberInput value={thresholds.etf_unusual?.vOI ?? 10.0}
              onChange={v => setPath(["etf_unusual","vOI"], v)} step={1.0} />
            <span style={{ color: P.dm, fontSize: 10, marginLeft: 4 }}>x</span>
          </div>
        </div>
      </div>

      {/* Dormant tickers status + recompute control. Lives inside Unusual
          section since it directly drives Unusual classification. */}
      <DormantStatusPanel />

      <div style={{
        marginTop: 12, padding: "6px 10px", background: P.bg,
        borderRadius: 3, fontSize: 10, color: P.mt, fontStyle: "italic",
      }}>
        Note: threshold changes take effect on next 5s poll cycle after Save.
        Algo tier is always excluded from Curated. Unusual now requires the
        ticker to be DORMANT (no flow in past N trading days) — recompute the
        dormant set above when needed. If no dormant data yet, classifier
        falls back to legacy V/OI-only Unusual rule.
      </div>
      </>)}
    </div>
  );
}

// ─── Dormant tickers status + recompute panel ─────────────────────────────
// Embedded in the tuning panel. Shows when the dormant set was last computed,
// active ticker count, lookback window. Has a "Recompute" button that fires
// the backend admin endpoint. No terminal cron in user's workflow, so manual
// trigger via this button is the standard cadence (run nightly after close).
function DormantStatusPanel() {
  const [status, setStatus] = useState(null);
  const [lookback, setLookback] = useState(30);
  const [busy, setBusy] = useState(false);

  const fetchStatus = async () => {
    try {
      const r = await fetch("/api/live/massive/dormant-status");
      const d = await r.json();
      setStatus(d);
    } catch (e) {
      setStatus({ ok: false, message: `Status fetch failed: ${e.message}` });
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  const handleRecompute = async () => {
    if (!confirm(
      `Recompute dormant tickers using a ${lookback} trading-day lookback?\n\n` +
      `This scans the full FlowDB — takes 1-5s. Best run after market close.`
    )) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/live/massive/recompute-dormant?lookback=${lookback}`, {
        method: "POST",
      });
      if (!r.ok) {
        const t = await r.text();
        alert(`Recompute failed: ${r.status} ${t}`);
      } else {
        const d = await r.json();
        alert(
          `Done. Found ${d.active_count} active tickers across ${d.lookback_trading_days} ` +
          `trading days (${d.earliest_date} → ${d.today_date}). ` +
          `${d.total_alerts_scanned} alerts scanned.`
        );
        fetchStatus();
      }
    } catch (e) {
      alert(`Recompute error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const computedAtStr = status?.computed_at
    ? new Date(status.computed_at).toLocaleString()
    : "(never)";

  return (
    <div style={{
      marginTop: 12, padding: 10, background: P.bg,
      border: `1px solid ${P.bd}`, borderRadius: 4,
    }}>
      <div style={{ color: P.wh, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
        DORMANT TICKER DATA (powers Unusual classification)
      </div>

      {!status && (
        <div style={{ color: P.mt, fontSize: 10 }}>Loading status…</div>
      )}

      {status && !status.has_data && (
        <div style={{ color: P.dm, fontSize: 10, marginBottom: 8 }}>
          ⚠ No dormant data yet. Unusual is using legacy V/OI-only fallback.
          Click Recompute to build the active-tickers set.
        </div>
      )}

      {status && status.has_data && (
        <div style={{
          display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px",
          fontSize: 10, color: P.dm, marginBottom: 8,
        }}>
          <div>Last computed:</div>
          <div style={{ color: P.wh }}>{computedAtStr}</div>
          <div>Lookback window:</div>
          <div style={{ color: P.wh }}>
            {status.lookback_trading_days} trading days
            ({status.earliest_date} → {status.today_date})
          </div>
          <div>Active tickers:</div>
          <div style={{ color: P.wh }}>
            {status.active_count?.toLocaleString()}{" "}
            <span style={{ color: P.mt }}>
              (from {status.total_alerts_scanned?.toLocaleString()} alerts scanned)
            </span>
          </div>
          <div>Sample:</div>
          <div style={{ color: P.mt, fontFamily: "inherit", fontSize: 9 }}>
            {(status.sample_active || []).slice(0, 20).join(", ")}
            {(status.sample_active || []).length >= 20 && "…"}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ color: P.dm, fontSize: 10 }}>Lookback:</span>
        <input
          type="number" value={lookback} min={1} max={365} step={1}
          onChange={e => setLookback(parseInt(e.target.value, 10) || 30)}
          style={{
            width: 60, padding: "3px 6px", fontSize: 11,
            background: P.cd, color: P.wh, border: `1px solid ${P.bd}`,
            borderRadius: 3, fontFamily: "inherit",
          }}
        />
        <span style={{ color: P.dm, fontSize: 10 }}>trading days</span>
        <button
          onClick={handleRecompute} disabled={busy}
          style={{
            padding: "4px 12px", fontSize: 11, fontWeight: 700,
            background: busy ? P.mt : P.ac, color: P.bg,
            border: "none", borderRadius: 3,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Computing…" : "Recompute now"}
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────
// ─── By-Contract rollup (accumulation view) ───────────────────────────────
// One row per contract for the day, showing repetition/conviction that the
// flat print tape hides. Collapsed by default; click to expand the prints.
const CONTRACT_GRID = "128px 118px 66px 76px 38px 92px 74px 66px 96px 86px 50px 92px 1fr";

// Compact ET clock for the accumulation time-span, e.g. "10:25a". Explicit
// America/New_York so it can't drift to browser-local (recurring 7/x bug).
function fmtClock(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts * 1000)
      .toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true })
      .replace(" AM", "a").replace(" PM", "p").replace(/^0/, "");
  } catch { return "—"; }
}

// Month/day in ET — for the multi-day SPAN range (matches fmtClock's timezone so
// the date can't drift to browser-local).
function fmtDay(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts * 1000)
      .toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
  } catch { return "—"; }
}

// Click-to-sort key per By-Contract column. A label missing here isn't sortable.
const _expTs = (e) => { const d = e && _mdyToDate(e); return d ? d.getTime() : 0; };
const _gradeRank = (g) => ({ "A+": 6, "A": 5, "B": 4, "C": 3, "D": 2 }[(g || "").toUpperCase()] || 1);
const CONTRACT_SORT_KEYS = {
  "SPAN": c => c.last_ts || 0,
  "TICKER": c => (c.ticker || "").toUpperCase(),
  "SPOT": c => c.spot || 0,
  "STRIKE": c => c.strike || 0,
  "EXP": c => _expTs(c.exp),
  "%ITM/OTM": c => (c.moneynessPct == null ? -1e9 : c.moneynessPct),
  "V/OI": c => (c.cum_voi == null ? -1 : c.cum_voi),
  "PREMIUM": c => c.total_premium || 0,
  "GRADE": c => _gradeRank(c.accumulation_grade),
  "SIGNAL": c => c.accumulation_score || 0,
};

function ContractColumnHeaders({ isAdmin, sortCol, sortDir, onSort }) {
  const cols = ["SPAN", "TICKER", "SPOT", "STRIKE", "C/P", "EXP", "%ITM/OTM",
                "V/OI", "PREMIUM", "SIDES", "GRADE", "TYPE", "SIGNAL"];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: CONTRACT_GRID + (isAdmin ? " 94px" : ""), gap: 8, padding: "6px 12px",
      fontSize: 11, color: P.mt, fontWeight: 600, letterSpacing: 0.5,
      borderBottom: `1px solid ${P.bd}`, marginBottom: 4,
    }}>
      {cols.map((c, i) => {
        const sortable = !!CONTRACT_SORT_KEYS[c];
        const active = sortCol === c;
        return (
          <span key={c}
            onClick={sortable && onSort ? () => onSort(c) : undefined}
            title={sortable ? "Sort by " + c : undefined}
            style={{
              textAlign: i === cols.length - 1 ? "left" : "center",
              paddingLeft: i === cols.length - 1 ? 4 : 0,
              cursor: sortable ? "pointer" : "default",
              color: active ? P.ac : undefined, userSelect: "none",
            }}>{c}{active ? (sortDir === "desc" ? " ▾" : " ▴") : ""}</span>
        );
      })}
      {isAdmin && <span style={{ textAlign: "center" }}>PUSH</span>}
    </div>
  );
}

function ContractRow({ c, onClickTicker, onOpenChart, isAdmin, onPush, pushState, oiCheck, expired }) {
  const [open, setOpen] = useState(false);

  // Right-click (desktop) / long-press (touch, incl. iOS Safari — which does
  // not reliably fire `contextmenu` on touch-hold) both open the full chart.
  // Closes over `c.ticker` — do NOT read the ticker from the event, since the
  // long-press branch fires from a setTimeout after React dispatch has
  // finished, when `e.currentTarget` is already null.
  const chartLongPress = useLongPress((e) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    onOpenChart && onOpenChart(c.ticker);
  });
  const DIR_BULL = "#6BAA85", DIR_BEAR = "#C26A6A";
  const isBull = c.direction === "Bull";
  const isBear = c.direction === "Bear";
  const dirColor = isBull ? DIR_BULL : isBear ? DIR_BEAR : P.wh;
  const dirTint = isBull ? `${DIR_BULL}0E` : isBear ? `${DIR_BEAR}0E` : P.cd;
  const consPct = Math.round((c.consistency || 0) * 100);
  // Accumulation shape → badge + sparkline. Accelerating builds get a bright
  // badge; steady muted; fading/incidental demoted. day_hits drives the sparkline.
  const _shape = c.accumulation_shape || "single";
  const _daysN = c.days_active || 1;
  const _dayHits = c.day_hits || [];
  const _shapeMeta = ({
    accelerating: { label: `🔥 ACCEL ${_daysN}D`, color: "#FF8C42" },
    intraday_burst: { label: `⚡ SWIFT ${c.swift_hits || ""}×${c.burst_rising ? " ↑" : ""}`, color: "#E8C547" },
    steady: { label: `🔁 STEADY ${_daysN}D`, color: P.ac },
    fading: { label: "▽ fading", color: P.dm },
  })[_shape] || null;
  const _sparkMax = _dayHits.length ? Math.max(..._dayHits.map(h => h.hits), 1) : 1;
  // GRADE shows the accumulation grade (the pattern) — not the per-print grade.
  // After a next-day OI check it becomes a CONFIRMED grade: holding/growing
  // boosts (✓), trimming/closing downgrades (▽/✗). The OI proof modifies the
  // conviction — an A+ build that CLOSED overnight was a head-fake, not accumulation.
  const _GR = ["D", "C", "B", "A", "A+ 🚀"];
  const _grBase = c.accumulation_grade || "—";
  const _grRank = _GR.indexOf(_grBase);
  let _grLabel = _grBase, _grMark = "", _grColor = null;
  if (oiCheck && oiCheck.status && oiCheck.status !== "no-data" && _grRank >= 0) {
    const adj = { confirmed: 1, held: 0, trimmed: -1, closed: -2 }[oiCheck.status] || 0;
    _grLabel = _GR[Math.max(0, Math.min(_GR.length - 1, _grRank + adj))];
    _grMark = oiCheck.status === "closed" ? " ✗" : oiCheck.status === "trimmed" ? " ▽" : " ✓";
    _grColor = oiCheck.status === "closed" ? "#C26A6A"
      : oiCheck.status === "confirmed" ? "#6BAA85"
      : oiCheck.status === "held" ? "#5b9bd5" : null;
  }
  // Grade-driven heatmap: base color by direction (green bull / red bear / grey
  // mixed), brightness scaled by the EFFECTIVE grade (after any OI check) so the
  // strongest accumulations pop and weak/closed ones recede. BUT if the contract
  // did not net-exceed OI (cum_voi <= 1), the whole row goes WHITE regardless of
  // direction — it's not new positioning, same rule as the By-Print tape.
  const _notOverOI = !(c.cum_voi != null && c.cum_voi > 1);
  const _rcBase = _notOverOI ? "#9aa0a6" : (isBull ? DIR_BULL : isBear ? DIR_BEAR : "#9aa0a6");
  const _gsrc = _grLabel || c.accumulation_grade || "C";
  const _gAlpha = _gsrc[0] === "A" ? (_gsrc.includes("+") ? "ff" : "e0")
    : _gsrc[0] === "B" ? "b4" : _gsrc[0] === "C" ? "82" : "55";
  const rowColor = _rcBase + _gAlpha;
  const s = c.sides || {};
  const sideBits = [
    (s.AA ? `${s.AA}AA` : ""), (s.A ? `${s.A}A` : ""),
    (s.BB ? `${s.BB}BB` : ""), (s.B ? `${s.B}B` : ""),
  ].filter(Boolean);

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        role="button" tabIndex={0} aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
        style={{
          display: "grid", gridTemplateColumns: CONTRACT_GRID + (isAdmin ? " 94px" : ""), gap: 8,
          padding: "9px 12px", alignItems: "center", fontSize: 13, cursor: "pointer",
          background: c.dormant ? `${P.bl}10` : dirTint,
          borderLeft: `4px solid ${c.dormant ? P.bl : dirColor}`,
        }}
        title={`${c.hit_count} prints${c.is_multiday
          ? ` across ${_daysN} days (${fmtDay(c.first_ts)}–${fmtDay(c.last_ts)}, ${fmtClock(c.first_ts)}–${fmtClock(c.last_ts)})`
          : ` · ${fmtClock(c.first_ts)}–${fmtClock(c.last_ts)}`} · conviction score ${c.score?.toLocaleString?.() || c.score}`}
      >
        <span style={{ color: rowColor, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
          <i style={{ color: rowColor, fontSize: 11 }}>{open ? "▾" : "▸"}</i>
          {c.is_multiday ? (
            <>
              {fmtDay(c.first_ts)} → {fmtDay(c.last_ts)}
              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                background: P.ac + "30", color: P.ac, flexShrink: 0 }}
                title={`${_daysN} distinct trading days with prints in this window`}>{_daysN}d</span>
            </>
          ) : (
            `${fmtClock(c.first_ts)}–${fmtClock(c.last_ts)}`
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, overflow: "hidden" }}>
          <span onClick={(e) => { e.stopPropagation(); onClickTicker && onClickTicker(c.ticker); }}
                {...chartLongPress}
                style={{ color: rowColor, fontWeight: 600, cursor: "pointer" }} title={`Filter to ${c.ticker}`}>
            {c.ticker}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: P.ac + "30", color: P.ac, flexShrink: 0 }} title={`${c.hit_count} prints on this contract`}>
            ×{c.hit_count}
          </span>
          {c.dormant && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: `${P.bl}25`, color: P.bl, flexShrink: 0 }} title="Unusual — dormant ticker suddenly active">
              ⚡
            </span>
          )}
        </span>
        <span style={{ color: rowColor, fontSize: 12, textAlign: "center" }}>{fmtSpot(c.spot)}</span>
        <span style={{ color: rowColor, fontWeight: 600, textAlign: "center", whiteSpace: "nowrap" }}>{fmtStrike(c.strike)}</span>
        <span style={{ color: rowColor, fontWeight: 700, textAlign: "center" }}>{c.cp || "—"}</span>
        <span style={{ fontSize: 12, textAlign: "center", whiteSpace: "nowrap", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
          <span style={{ color: expired ? P.mt : rowColor, textDecoration: expired ? "line-through" : undefined }}>{c.exp || "—"}</span>
          {expired && <span style={{ fontSize: 8, fontWeight: 700, padding: "0 3px", borderRadius: 2, background: `${DIR_BEAR}30`, color: DIR_BEAR, flexShrink: 0 }} title="Contract already expired">EXP'D</span>}
        </span>
        <span style={{ color: rowColor, fontSize: 12, textAlign: "center", whiteSpace: "nowrap" }}>{fmtMoneyness(c.moneynessPct, c.moneynessLabel)}</span>
        <span style={{ color: rowColor, fontWeight: c.cum_voi && c.cum_voi >= 3 ? 600 : 400, textAlign: "center" }}>
          {c.cum_voi != null ? `${c.cum_voi}x` : "—"}
        </span>
        <span style={{ color: rowColor, fontWeight: 700, textAlign: "center" }}>{fmtPremium(c.total_premium)}</span>
        <span style={{ fontSize: 11, textAlign: "center", color: rowColor, whiteSpace: "nowrap" }}>{sideBits.join(" ") || "—"}</span>
        <span style={{
          color: _grColor || (_grLabel?.startsWith("A") ? P.ac : _grLabel === "B" ? P.bl : _grLabel === "C" ? P.dm : P.mt),
          fontWeight: 700, textAlign: "center", whiteSpace: "nowrap",
        }} title={
          oiCheck && oiCheck.status && oiCheck.status !== "no-data"
            ? `Accumulation grade ${_grBase} · next-day OI ${oiCheck.status} → ${_grLabel}`
            : (c.accumulation_grade ? "Accumulation grade (the pattern). Click Check OI to confirm next-day." : undefined)
        }>{_grLabel}{_grMark}</span>
        <span style={{ textAlign: "center", display: "flex", gap: 3, justifyContent: "center", flexWrap: "wrap" }}>
          {(c.types || []).map(t => {
            const tl = tradeTypeLabel(t);
            return tl ? (
              <span key={t} style={{ fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: `${tl.color}25`, color: tl.color }}>{tl.code}</span>
            ) : null;
          })}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", paddingLeft: 4 }}>
          {_shapeMeta ? (
            <span style={{ color: _shapeMeta.color, fontSize: 10, fontWeight: 800, whiteSpace: "nowrap", letterSpacing: 0.3 }}>
              {_shapeMeta.label}
            </span>
          ) : (
            <span style={{ color: dirColor, fontSize: 12, whiteSpace: "nowrap", fontWeight: 500 }}>
              Repeat accumulation
            </span>
          )}
          {_dayHits.length > 1 && (
            <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, height: 16 }}
                  title={_dayHits.map(h => `${h.date}: ${h.hits}`).join("  ·  ")}>
              {_dayHits.map((h, i) => (
                <span key={i} style={{
                  width: 4, borderRadius: 1,
                  height: Math.max(3, Math.round((h.hits / _sparkMax) * 16)),
                  background: i === _dayHits.length - 1 ? (_shapeMeta ? _shapeMeta.color : dirColor) : P.dm,
                }} />
              ))}
            </span>
          )}
          <span style={{ color: P.dm, fontSize: 11, whiteSpace: "nowrap" }}>
            {consPct}% {isBull ? "bull" : isBear ? "bear" : "mixed"}
          </span>
          {oiCheck && oiCheck.status && oiCheck.status !== "no-data" && (() => {
            const meta = {
              confirmed: { label: "✓ CONFIRMED", color: "#6BAA85" },
              held: { label: "= HELD", color: "#5b9bd5" },
              trimmed: { label: "▽ TRIMMED", color: "#c9a84c" },
              closed: { label: "✗ CLOSED", color: "#C26A6A" },
            }[oiCheck.status];
            if (!meta) return null;
            const dsign = oiCheck.delta > 0 ? "+" : "";
            return (
              <span title={`Next-day OI ${oiCheck.oi?.toLocaleString?.() ?? oiCheck.oi} (${dsign}${oiCheck.delta?.toLocaleString?.() ?? oiCheck.delta} vs entry)`}
                    style={{ color: meta.color, fontSize: 10, fontWeight: 800, whiteSpace: "nowrap", letterSpacing: 0.3 }}>
                {meta.label}
              </span>
            );
          })()}
        </span>

        {/* POSTED/PUSH — admin-only. Admin gets the push button (and AUTO/✓ posted
            once sent); hidden entirely from the public By-Contract view. */}
        {isAdmin && (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            {(c.forwardedToDiscord || pushState === "done") ? (
              <span style={{ color: c.forwardedToDiscord && pushState !== "done" ? DIR_BULL : P.dm, fontSize: 10, fontWeight: 700 }}>
                {c.forwardedToDiscord && pushState !== "done" ? "AUTO" : "✓ posted"}
              </span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onPush && onPush(c); }}
                disabled={pushState === "pushing"}
                title={pushState === "error" ? "Push failed — click to retry" : "Push accumulation to Discord"}
                style={{
                  background: "transparent",
                  color: pushState === "error" ? P.be : P.ac,
                  border: `1px solid ${pushState === "error" ? P.be : P.ac}`,
                  borderRadius: 4, padding: "3px 8px", fontSize: 10, fontWeight: 700,
                  cursor: pushState === "pushing" ? "wait" : "pointer", fontFamily: "inherit",
                  whiteSpace: "nowrap", opacity: pushState === "pushing" ? 0.6 : 1,
                }}>
                {pushState === "pushing" ? "…" : pushState === "error" ? "✗ retry" : "→ push"}
              </button>
            )}
          </span>
        )}
      </div>

      {open && (c.prints || []).map((p, i) => {
        const pc = p.direction === "Bull" ? DIR_BULL : p.direction === "Bear" ? DIR_BEAR : P.dm;
        const tl = tradeTypeLabel(p.type);
        return (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: CONTRACT_GRID, gap: 8,
            padding: "5px 12px", alignItems: "center", fontSize: 12,
            background: "#141510", borderLeft: `4px solid ${P.bd}`,
          }}>
            <span style={{ color: P.mt, paddingLeft: 18, whiteSpace: "nowrap" }}>{fmtTime(p.timestamp)}</span>
            <span /><span /><span /><span /><span />
            <span style={{ color: P.mt, fontSize: 11, textAlign: "center" }}>{fmtPrice(p.price)}</span>
            <span style={{ color: P.mt, fontSize: 11, textAlign: "center" }}>{fmtCount(p.volume)}</span>
            <span style={{ color: pc, fontWeight: 600, textAlign: "center" }}>{fmtPremium(p.premium)}</span>
            <span style={{ color: pc, fontSize: 11, textAlign: "center" }}>{p.side || "—"}</span>
            <span style={{ textAlign: "center" }}>
              {tl && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: `${tl.color}25`, color: tl.color }}>{tl.code}</span>}
            </span>
            <span />
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────
export default function LiveFlowMassive() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Date picker driven via ?date= URL param so views are bookmarkable
  // and the page can deep-link to historical days (matches the existing
  // history-mode convention used in LiveFlow.jsx for /live-flow).
  const targetDate = searchParams.get("date") || null;
  const setTargetDate = (dateStr) => {
    const next = new URLSearchParams(searchParams);
    if (dateStr) next.set("date", dateStr);
    else next.delete("date");
    setSearchParams(next, { replace: true });
  };

  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  // Loading vs empty (2026-07-20): distinguish "still fetching the first
  // snapshot" from "loaded, genuinely empty / worker idle" so the page never
  // flashes a false "Worker idle" during the initial cold /recent fill.
  // `dataArrived` flips true on the first real (non-warming) response; `warming`
  // tracks the backend's cold-cache "filling in the background" stub.
  const [dataArrived, setDataArrived] = useState(false);
  const [warming, setWarming] = useState(false);
  // Safety net: if the first snapshot never arrives (a persistent background
  // fill failure would keep returning warming stubs forever), escalate the
  // loading copy after a generous window so the user isn't stuck staring at a
  // silent spinner. A legit cold curated fill is <~120s, so 150s = "wrong".
  const [loadSlow, setLoadSlow] = useState(false);
  const [filters, setFilters] = useState(loadFilters);
  const [sortBy, setSortBy] = useState(() =>
    localStorage.getItem(LS_KEY_SORT) || "recent"
  );
  const [minGrade, setMinGrade] = useState(() =>
    localStorage.getItem(LS_KEY_MINGRADE) || "D"
  );
  // Free-text ticker search — client-side substring filter over the fetched
  // feed (ephemeral; intentionally not persisted so a stale query never
  // silently hides the tape on reload).
  const [search, setSearch] = useState("");
  // By Print (live tape) vs By Contract (accumulation rollup). Persisted.
  const [viewMode, setViewMode] = useState(() => {
    // "openflow" (the removed searchable board) falls back to print so a stale
    // persisted value can't leave the page on a view that no longer renders.
    const v = localStorage.getItem(LS_KEY_VIEWMODE);
    return v === "contract" ? "contract" : "print";
  });
  const [byContract, setByContract] = useState(null);
  // Accumulation lookback window (multi-day). Default 3 so multi-day builds show
  // by default; tunable 1/3/5 from the By-Contract view. Persisted.
  const [lookbackDays, setLookbackDays] = useState(() => {
    const v = parseInt(localStorage.getItem("uct_massive_lookback_days") || "3", 10);
    return v >= 1 && v <= 31 ? v : 3;   // range picker sets arbitrary N up to 31
  });
  const setLookback = (n) => { setLookbackDays(n); try { localStorage.setItem("uct_massive_lookback_days", String(n)); } catch {} };
  // Multi-day range: a range = end date (targetDate) + N-day span (lookbackDays),
  // aggregated in the By-Contract rollup. applyRange wires the calendar range /
  // presets to that and flips to the contract view. "Still open only" hides
  // contracts whose fetched OI says closed (exited) — a live still-open filter.
  const [stillOpenOnly, setStillOpenOnly] = useState(false);
  const [cSortCol, setCSortCol] = useState(null);   // By-Contract column click-sort
  const [cSortDir, setCSortDir] = useState("desc");
  const onContractSort = (col) => {
    if (cSortCol === col) setCSortDir(d => (d === "desc" ? "asc" : "desc"));
    else { setCSortCol(col); setCSortDir(col === "TICKER" || col === "EXP" ? "asc" : "desc"); }
  };
  // Min prints for a contract to appear in By-Contract. Default 3 = accumulation
  // focus; set to 1 to see EVERY contract (single big Alpha Gold prints, held or
  // not — "doesn't have to be accumulating").
  const [minHits, setMinHits] = useState(3);
  const applyRange = (endMdy, days) => {
    setViewMode("contract");
    setLookback(Math.max(1, Math.min(31, days || 1)));
    setTargetDate(endMdy || null);
  };
  // Per-column table sort. Defaults to time/desc, which is identical to the
  // page's prior always-time-descending behavior. `sortBy` above still selects
  // WHICH alerts the backend returns (recent/conviction/premium top-N); this
  // controls the DISPLAY order of that set, so the two are orthogonal.
  const [sortCol, setSortCol] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(LS_KEY_COLSORT) || ""); return s?.c || "time"; }
    catch { return "time"; }
  });
  const [sortDir, setSortDir] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(LS_KEY_COLSORT) || ""); return s?.d || "desc"; }
    catch { return "desc"; }
  });
  // How many recent alerts to keep in the feed. Defaults to 500 (~8-15 min
  // of market-open activity); user can bump to 1000 or "All" (full day). The
  // BULL/BEAR cards are always day-scoped and unaffected by this setting.
  // Persisted in localStorage as either a number string or "All".
  const [rowLimit, setRowLimit] = useState(() => {
    const v = localStorage.getItem(LS_KEY_ROW_LIMIT) || "";
    if (v === "All") return "All";
    const n = parseInt(v, 10);
    return ROW_LIMIT_OPTIONS.includes(n) ? n : ROW_LIMIT_DEFAULT;
  });
  // Hide multi-leg/Algo tier from both the table AND the bull/bear card math.
  // Multi-leg trades aren't truly directional even when one leg prints at ask,
  // so the toggle gives a cleaner "directional conviction only" read.
  const [hideAlgo, setHideAlgo] = useState(() =>
    localStorage.getItem(LS_KEY_HIDE_ALGO) === "1"
  );
  const [hideNoSide, setHideNoSide] = useState(() =>
    localStorage.getItem(LS_KEY_HIDE_NOSIDE) === "1"
  );
  // 7/7: Stocks / ETFs / All partition filter. 'all' shows everything (today's
  // behavior). 'stocks' hides tickers in KNOWN_ETFS_INDEXES; 'etfs' shows only
  // those. Client-side, so it works against historical rows regardless of
  // whether their StockEtf field was stamped correctly upstream.
  const [stockEtfFilter, setStockEtfFilter] = useState(() =>
    localStorage.getItem(LS_KEY_STOCK_ETF) || "all"
  );
  // Curated mode — show only alerts that meet stacked criteria (best-of-best).
  // Default ON for product mode; admin can flip to "All Flow" for the firehose.
  // Cards stay day-scoped to FULL classifiable flow regardless — only the
  // table changes.
  const [curated, setCurated] = useState(() =>
    localStorage.getItem(LS_KEY_CURATED) !== "0"  // default ON
  );
  // Admin tuning panel — visible only when ?tune=1 is in the URL.
  // Surfaces threshold controls + live-preview math against current alerts.
  const isTuneMode = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("tune") === "1";
  // Manual Discord push (admin). Per-alert state drives the button + POSTED
  // column: "pushing" | "done" | "error". Sends the print to Discord via
  // force-push (bypasses gates). The AUTO-vs-manual record is the tuning signal.
  const [pushStates, setPushStates] = useState({});
  const handlePush = (alert) => {
    if (!alert || alert.id == null) return;
    setPushStates(s => ({ ...s, [alert.id]: "pushing" }));
    fetch(`/api/live/massive/force-push-discord?id=${alert.id}&mode=single`, { method: "POST" })
      .then(r => r.json())
      .then(d => {
        setPushStates(s => ({ ...s, [alert.id]: (d && d.ok) ? "done" : "error" }));
        if (!d || !d.ok) console.error("[massive push] failed:", d);
      })
      .catch(e => { setPushStates(s => ({ ...s, [alert.id]: "error" })); console.error("[massive push]", e); });
  };
  // By-Contract accumulation push — sends mode=accumulation (the repeat-hit
  // embed). Keyed by contract identity since contracts have no single row id.
  const [contractPushStates, setContractPushStates] = useState({});
  const handlePushContract = (c) => {
    if (!c || !c.ticker) return;
    const key = `${c.ticker}|${c.cp}|${c.strike}|${c.exp}`;
    setContractPushStates(s => ({ ...s, [key]: "pushing" }));
    const td = targetDate || (() => {
      const n = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      return `${n.getMonth() + 1}/${n.getDate()}/${n.getFullYear()}`;
    })();
    const params = new URLSearchParams({
      ticker: c.ticker, cp: c.cp, strike: String(c.strike), exp: c.exp,
      target_date: td, mode: "accumulation",
    });
    fetch(`/api/live/massive/force-push-discord?${params.toString()}`, { method: "POST" })
      .then(r => r.json())
      .then(d => {
        setContractPushStates(s => ({ ...s, [key]: (d && d.ok) ? "done" : "error" }));
        if (!d || !d.ok) console.error("[massive push contract] failed:", d);
      })
      .catch(e => { setContractPushStates(s => ({ ...s, [key]: "error" })); console.error("[massive push contract]", e); });
  };
  // Check OI — next-day confirmation for accumulation contracts. Fetches the
  // latest settled OI per contract (enrich-oi) and compares to the entry OI
  // (max_oi seen during the trades). OI grew overnight = positions held/added
  // (CONFIRMED); OI fell = closed (the UW "OI drops next morning" exit tell).
  const _ckey = (t, cp, k, e) => `${String(t).toUpperCase()}|${String(cp).toUpperCase()[0]}|${parseFloat(k)}|${String(e).trim()}`;
  const [oiCheck, setOiCheck] = useState({});   // ckey -> { oi, delta, status }
  const [oiChecking, setOiChecking] = useState(false);
  const [oiSummary, setOiSummary] = useState("");   // result line after Check OI
  const handleCheckOI = async () => {
    const contracts = (byContract?.contracts || []);
    if (!contracts.length) return;
    setOiChecking(true);
    try {
      const body = contracts.map(c => ({ ticker: c.ticker, cp: c.cp, strike: c.strike, exp: c.exp }));
      const r = await fetch(`/api/live/massive/enrich-oi`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      const settledMap = {};
      (d.results || []).forEach(res => { settledMap[_ckey(res.ticker, res.cp, res.strike, res.exp)] = res.oi; });
      const out = {};
      contracts.forEach(c => {
        const k = _ckey(c.ticker, c.cp, c.strike, c.exp);
        const settled = settledMap[k];
        const entry = c.max_oi || 0;
        if (settled == null) { out[k] = { status: "no-data" }; return; }
        let status = "held", delta = settled - entry;
        if (entry > 0) {
          const ratio = settled / entry;
          if (ratio >= 1.10) status = "confirmed";
          else if (ratio >= 0.90) status = "held";
          else if (ratio >= 0.15) status = "trimmed";
          else status = "closed";
        } else {
          status = settled > 0 ? "confirmed" : "no-data";
        }
        out[k] = { oi: settled, delta, status };
      });
      setOiCheck(out);
      const tally = {};
      Object.values(out).forEach(v => { tally[v.status] = (tally[v.status] || 0) + 1; });
      const openN = (tally.confirmed || 0) + (tally.held || 0) + (tally.trimmed || 0);
      setOiSummary(`✓ OI checked on ${Object.keys(out).length} · ${openN} still open `
        + `(${tally.confirmed || 0} adding, ${tally.held || 0} held, ${tally.trimmed || 0} trimmed) · `
        + `${tally.closed || 0} closed · ${tally["no-data"] || 0} no settled OI yet`);
    } catch (e) { console.error("[check OI]", e); setOiSummary("✗ OI check failed — retry"); }
    finally { setOiChecking(false); }
  };
  // Thresholds loaded from /api/live/massive/thresholds. Local edits in the
  // tuning panel mutate this state for preview; "Save" POSTs back to backend.
  const [thresholds, setThresholds] = useState(null);
  const [thresholdsDirty, setThresholdsDirty] = useState(false);
  // ── Auto-push config (master switch + algo flags) ── loaded from the backend
  // so the admin flips auto-push on/off (and tunes the algo) from the panel
  // instead of curl. Admin-only; non-admin never fetches it.
  const [autoPushCfg, setAutoPushCfg] = useState(null);
  useEffect(() => {
    if (!isTuneMode) return;
    fetch("/api/live/massive/auto-push-config")
      .then(r => r.json())
      .then(d => { if (d && d.ok) setAutoPushCfg(d.config); })
      .catch(() => {});
  }, [isTuneMode]);
  const saveAutoPushCfg = async (patch) => {
    setAutoPushCfg(prev => ({ ...(prev || {}), ...patch }));  // optimistic
    try {
      const r = await fetch("/api/live/massive/auto-push-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (d && d.config) setAutoPushCfg(d.config);
    } catch (e) { console.error("[auto-push cfg]", e); }
  };
  const [tickerFilter, setTickerFilter] = useState(new Set());
  const [contractFilter, setContractFilter] = useState(new Set());
  // Right-click (long-press on touch) a ticker cell → open the full chart via
  // TickerPopup in controlled mode. Independent of tickerFilter/contractFilter
  // above — one popup rendered at page level, never per-row.
  const [chartSym, setChartSym] = useState(null);
  // OI fetch state: { loading: bool, result: "filled X of Y" | error }
  const [oiFetchState, setOiFetchState] = useState({ loading: false, result: null });
  // Current spot quotes for P/L column. Updated every 30s in a separate
  // poll cycle (Schwab quote fetches cost API calls; spot moves slower
  // than the 5s alert poll so this is the right cadence). Key: ticker → spot.
  const [quotes, setQuotes] = useState({});
  const [quotesFetchedAt, setQuotesFetchedAt] = useState(null);
  // Day-scoped Market Read stats (aggregated over ALL classifiable Y/M rows
  // for the target date, independent of filters). Polled every 30s — slower
  // than alerts because the aggregate moves slower than individual events.
  const [dayStats, setDayStats] = useState(null);
  const lastIdRef = useRef(null);
  const newIdsRef = useRef(new Set());
  // Persistent OI enrichment map — keyed by `${ticker}|${cp}|${strike}|${exp}`.
  // Populated by the "fetch OI" button, applied on every setAlerts call so
  // enriched values survive the 5s /recent poll cycle. Without this the
  // enrichment is wiped on the next poll because the server-side row still
  // has OI=0 in flow.db (7/2 backfill data was ingested with no OI column).
  const oiEnrichmentRef = useRef({});

  // Clear enrichment when targetDate changes. OI is date-specific — the
  // snapshot for BE|C|370.0|9/18/2026 on 7/2 differs from the same contract
  // on 7/3, so cross-date enrichment poisoning would show wrong values on
  // rapid date-picker toggles.
  useEffect(() => {
    oiEnrichmentRef.current = {};
  }, [targetDate]);

  // Merge stored OI enrichment into a fresh alert list. Recomputes
  // volumeOIRatio and oiExceeded inline to match the button-handler and
  // server-side logic. Alerts with priorOI already populated (worker fetched
  // OI successfully at write time) are left alone.
  function applyOiEnrichment(alertList) {
    const map = oiEnrichmentRef.current;
    // Fast path: no enrichment stored yet (initial load or post-date-change)
    let hasEntries = false;
    for (const _ in map) { hasEntries = true; break; }
    if (!hasEntries) return alertList;
    return alertList.map(a => {
      if (a.priorOI != null) return a;
      const k = `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`;
      const oi = map[k];
      if (oi == null) return a;
      const ts = a.tradeSize || 0;
      const ratio = (oi > 0 && ts > 0) ? Math.round((ts / oi) * 100) / 100 : null;
      return {
        ...a,
        priorOI: oi,
        volumeOIRatio: ratio,
        oiExceeded: ratio != null && ratio > 1.0,
      };
    });
  }

  // Persist controls
  useEffect(() => { saveFilters(filters); }, [filters]);
  useEffect(() => { localStorage.setItem(LS_KEY_SORT, sortBy); }, [sortBy]);
  useEffect(() => { localStorage.setItem(LS_KEY_MINGRADE, minGrade); }, [minGrade]);
  useEffect(() => {
    localStorage.setItem(LS_KEY_COLSORT, JSON.stringify({ c: sortCol, d: sortDir }));
  }, [sortCol, sortDir]);
  useEffect(() => { localStorage.setItem(LS_KEY_ROW_LIMIT, String(rowLimit)); }, [rowLimit]);
  useEffect(() => { localStorage.setItem(LS_KEY_HIDE_ALGO, hideAlgo ? "1" : "0"); }, [hideAlgo]);
  useEffect(() => { localStorage.setItem(LS_KEY_HIDE_NOSIDE, hideNoSide ? "1" : "0"); }, [hideNoSide]);
  useEffect(() => { localStorage.setItem(LS_KEY_STOCK_ETF, stockEtfFilter); }, [stockEtfFilter]);
  useEffect(() => { localStorage.setItem(LS_KEY_CURATED, curated ? "1" : "0"); }, [curated]);

  // Load thresholds when entering tuning mode. Only fetches once per page
  // visit. Editing in the panel mutates local `thresholds` (preview),
  // saving POSTs back to backend.
  useEffect(() => {
    if (!isTuneMode) return;
    let cancelled = false;
    fetch("/api/live/massive/thresholds")
      .then(r => r.json())
      .then(d => {
        if (!cancelled && d.thresholds) {
          setThresholds(d.thresholds);
          setThresholdsDirty(false);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isTuneMode]);

  // Tuning panel handlers. Edit→dirty; Save POSTs to backend; Reset wipes
  // the saved file (factory defaults) and reloads.
  // Paths the user has actually touched this visit. Save re-fetches the
  // server's current thresholds and replays ONLY these onto it, instead of
  // POSTing the whole local snapshot. The panel fetches once per visit, so a
  // stale snapshot would otherwise silently revert any change made elsewhere
  // while it sat open — e.g. a tunable flipped by hand or by another admin.
  const editedPathsRef = useRef([]);
  const handleThresholdsChange = (next, path) => {
    if (path) {
      const key = JSON.stringify(path);
      if (!editedPathsRef.current.some(p => JSON.stringify(p) === key)) {
        editedPathsRef.current.push(path);
      }
    }
    setThresholds(next);
    setThresholdsDirty(true);
  };
  const handleThresholdsSave = async () => {
    try {
      // Merge-on-save: start from what the server has RIGHT NOW, then replay
      // only the fields edited in this session. Anything changed out-of-band
      // survives. Falls back to the local snapshot if the re-fetch fails.
      let payload = thresholds;
      try {
        const cur = await fetch("/api/live/massive/thresholds").then(x => x.json());
        if (cur && cur.thresholds) {
          const merged = JSON.parse(JSON.stringify(cur.thresholds));
          for (const path of editedPathsRef.current) {
            let src = thresholds, dst = merged, ok = true;
            for (let i = 0; i < path.length - 1; i++) {
              src = src?.[path[i]];
              if (dst[path[i]] === undefined || dst[path[i]] === null) dst[path[i]] = {};
              dst = dst[path[i]];
              if (src === undefined) { ok = false; break; }
            }
            if (ok && src !== undefined) dst[path[path.length - 1]] = src[path[path.length - 1]];
          }
          payload = merged;
        }
      } catch (_e) { /* offline / race — fall back to the local snapshot */ }

      const r = await fetch("/api/live/massive/thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text();
        alert(`Save failed: ${r.status} ${t}`);
        return;
      }
      const d = await r.json();
      if (d.thresholds) setThresholds(d.thresholds);
      editedPathsRef.current = [];
      setThresholdsDirty(false);
    } catch (e) {
      alert(`Save error: ${e.message || e}`);
    }
  };
  const handleThresholdsReset = async () => {
    if (!confirm("Reset to factory defaults? This wipes any saved overrides.")) return;
    try {
      const r = await fetch("/api/live/massive/thresholds/reset", { method: "POST" });
      if (!r.ok) {
        alert(`Reset failed: ${r.status}`);
        return;
      }
      const d = await r.json();
      if (d.thresholds) setThresholds(d.thresholds);
      setThresholdsDirty(false);
    } catch (e) {
      alert(`Reset error: ${e.message || e}`);
    }
  };

  // SSE resilience (2026-07-09): a proxy can silently drop the EventSource with
  // no onerror, leaving a user stuck behind everyone else ("lagging more than
  // you"). We watchdog the server's 15s heartbeat and force a reconnect +
  // immediate catch-up reconcile when contact goes stale. sseNonce bump =
  // reconnect the stream; reconcileNonce bump = immediate /recent catch-up.
  const [sseNonce, setSseNonce] = useState(0);
  const [reconcileNonce, setReconcileNonce] = useState(0);
  const lastSseContactRef = useRef(Date.now());
  // Refocus catch-up throttle (2026-07-20): coalesce the paired
  // visibilitychange+focus events into a single sync per return-to-tab.
  const lastForegroundSyncRef = useRef(0);
  // Feed-gap transparency: the day's detected downtime windows so users SEE
  // missed-flow windows instead of silently missing lines.
  const [gapInfo, setGapInfo] = useState(null);

  // Polling
  useEffect(() => {
    let cancelled = false;
    let timer;
    let abort;

    async function poll() {
      try {
        abort = new AbortController();
        const numericLimit = rowLimit === "All" ? ROW_LIMIT_ALL_VALUE : rowLimit;
        const params = new URLSearchParams({
          limit: String(numericLimit),
          sort_by: sortBy,
          min_grade: minGrade,
        });
        if (targetDate) params.set("target_date", targetDate);
        // When user has isolated a single tier (e.g. Alpha Gold only),
        // ask backend to filter to that tier. This way the rowLimit slot
        // is spent on alerts of that tier exclusively, letting rare tiers
        // (Alpha Gold, Size) show full-day history even hours after
        // they fired. Without this, common tiers (Algo, Bullish) crowd out
        // the rare ones in the "latest N" window.
        const isolatedTier = (() => {
          const ons = TIER_ORDER.filter(t => filters[t]);
          return ons.length === 1 ? ons[0] : null;
        })();
        if (isolatedTier) params.set("tier", isolatedTier);
        if (curated) params.set("curated", "true");
        const r = await fetch(`/api/live/massive/recent?${params}`, { signal: abort.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        if (cancelled) return;
        // Cold-cache "warming" stub — the backend is filling the snapshot in the
        // background (worker just (re)started or new trading day). Keep whatever
        // tape is already on screen (NEVER blank it), show the loading indicator,
        // and let the next poll pick up the real snapshot. Only status + the
        // warming flag update here.
        if (d.warming) {
          setWarming(true);
          if (d.status) setStatus(d.status);
          setError(null);
          return;  // finally-block reschedules the poll
        }
        setWarming(false);
        const incoming = d.alerts || [];
        // Track which IDs are new since last poll for flash animation
        const newIds = new Set();
        for (const a of incoming) {
          if (!lastIdRef.current) break;
          if (a.id === lastIdRef.current) break;
          newIds.add(a.id);
        }
        if (incoming[0]) lastIdRef.current = incoming[0].id;
        newIdsRef.current = newIds;
        // Apply persisted OI enrichment before setAlerts so button-populated
        // values survive the poll refresh (fix for OI-disappears-after-5s bug).
        setAlerts(applyOiEnrichment(incoming));
        setStatus(d.status);
        setDataArrived(true);
        setError(null);
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        // When the SSE stream owns live updates, the poll becomes a slow
        // reconcile (authoritative full list + status/OI refresh) instead of
        // the primary update path. Curated mode has no stream → normal cadence.
        const nextMs = (STREAM_ENABLED && !curated) ? STREAM_RECONCILE_MS : POLL_INTERVAL_MS;
        if (!cancelled) timer = setTimeout(poll, nextMs);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (abort) abort.abort();
    };
    // reconcileNonce: an SSE (re)connect bumps it to force an immediate catch-up
    // poll so prints missed during a stream gap appear without waiting a cycle.
  }, [sortBy, minGrade, targetDate, rowLimit, filters, curated, reconcileNonce]);

  // ── Live SSE stream (dark, VITE_MASSIVE_STREAM=1) ──────────────────────────
  // Prepends new prints the instant the server tailer sees them — NO /recent
  // re-fetch, so it adds zero heavy-build load (the thing that OOM'd on 7/8).
  // Curated mode keeps polling (its stacking logic is server-side). On any
  // disconnect the rendered data STAYS PUT and EventSource auto-reconnects —
  // the tape never blanks on a hiccup.
  useEffect(() => {
    if (!STREAM_ENABLED || curated) return;
    const isolatedTier = (() => {
      const ons = TIER_ORDER.filter((t) => filters[t]);
      return ons.length === 1 ? ons[0] : null;
    })();
    const minRank = _GRADE_NUMERIC_FE[minGrade] ?? 0;
    let es;
    try {
      es = new EventSource("/api/live/massive/stream");
    } catch {
      return;
    }
    lastSseContactRef.current = Date.now();
    const touch = () => { lastSseContactRef.current = Date.now(); };
    // 'connected' fires on the initial open AND every reconnect → catch up any
    // prints missed during the gap via an immediate reconcile (don't wait a cycle).
    es.addEventListener("connected", () => { touch(); setReconcileNonce((n) => n + 1); });
    es.addEventListener("heartbeat", touch);  // 15s healthy-idle signal
    es.onmessage = (ev) => {
      touch();
      let incoming;
      try {
        incoming = JSON.parse(ev.data).alerts || [];
      } catch {
        return;
      }
      if (!incoming.length) return;
      // client-side mirror of the server's grade + isolated-tier gates so
      // streamed prints match exactly what a /recent poll would have returned
      const fresh = incoming.filter(
        (a) =>
          (_GRADE_NUMERIC_FE[a.grade] ?? 0) >= minRank &&
          (!isolatedTier || (a._tierKey || "algo") === isolatedTier)
      );
      if (!fresh.length) return;
      // Live prints arriving means we're loaded + connected — clear the initial
      // loading/warming state even if the first /recent poll hasn't returned yet.
      setDataArrived(true);
      setWarming(false);
      setAlerts((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        const add = fresh.filter((a) => !seen.has(a.id));
        if (!add.length) return prev;
        newIdsRef.current = new Set(add.map((a) => a.id)); // flash the new batch
        let merged = [...add, ...prev];
        if (sortBy === "premium")
          merged.sort((x, y) => (y.alertPremium || 0) - (x.alertPremium || 0));
        else if (sortBy === "conviction")
          merged.sort((x, y) => (y.convictionScore || 0) - (x.convictionScore || 0));
        else merged.sort((x, y) => (y.id || 0) - (x.id || 0)); // recent
        if (merged[0]) lastIdRef.current = merged[0].id;
        return applyOiEnrichment(merged.slice(0, 4000));
      });
    };
    es.onerror = () => {
      /* keep rendered data; browser EventSource auto-reconnects */
    };
    // Watchdog: an EventSource can go half-dead through a proxy without ever
    // firing onerror (the "user lags behind everyone" bug). If no server contact
    // — a print OR a 15s heartbeat — arrives for SSE_STALL_MS, treat the stream
    // as dead and force a fresh reconnect by bumping sseNonce.
    const wd = setInterval(() => {
      if (Date.now() - lastSseContactRef.current > SSE_STALL_MS) {
        lastSseContactRef.current = Date.now();  // give the reconnect a fresh window
        setSseNonce((n) => n + 1);
      }
    }, 10000);
    return () => {
      clearInterval(wd);
      try {
        es.close();
      } catch {
        /* ignore */
      }
    };
  }, [curated, minGrade, sortBy, filters, sseNonce]);

  // ── Live CURATED SSE stream (dark, VITE_MASSIVE_CURATED_STREAM=1) ──────────
  // The curated twin of the effect above. Only runs in CURATED mode (mutually
  // exclusive with the raw stream, which is disabled when curated). The server
  // tailer already applied the exact curated gate, so this just PREPENDS each
  // new curated alert instantly — killing the ~20s poll surfacing lag. The 20s
  // poll stays as the authoritative reconcile (dedupe/demotions/full set); on a
  // disconnect the data STAYS PUT and the poll keeps it fresh, so a stream
  // failure degrades to exactly the pre-stream 20s behavior, never a blank feed.
  useEffect(() => {
    if (!curated || !CURATED_STREAM_ENABLED) return;
    const isolatedTier = (() => {
      const ons = TIER_ORDER.filter((t) => filters[t]);
      return ons.length === 1 ? ons[0] : null;
    })();
    const minRank = _GRADE_NUMERIC_FE[minGrade] ?? 0;
    let es;
    try {
      es = new EventSource("/api/live/massive/curated-stream");
    } catch {
      return;
    }
    lastSseContactRef.current = Date.now();
    const touch = () => { lastSseContactRef.current = Date.now(); };
    // Unlike the raw effect we do NOT force a reconcile poll on 'connected' —
    // the curated /recent build is heavy (~34K rows) and a flapping stream would
    // stack heavy builds; the 20s poll catches any gap within one cycle anyway.
    es.addEventListener("connected", touch);
    es.addEventListener("heartbeat", touch);  // 15s healthy-idle signal
    es.onmessage = (ev) => {
      touch();
      let incoming;
      try {
        incoming = JSON.parse(ev.data).alerts || [];
      } catch {
        return;
      }
      if (!incoming.length) return;
      // apply the user's VIEW filters (grade + isolated tier) — the server
      // already applied CURATION, these just match the current on-screen slice
      const fresh = incoming.filter(
        (a) =>
          (_GRADE_NUMERIC_FE[a.grade] ?? 0) >= minRank &&
          (!isolatedTier || (a._tierKey || "algo") === isolatedTier)
      );
      if (!fresh.length) return;
      setDataArrived(true);
      setWarming(false);
      setAlerts((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        const add = fresh.filter((a) => !seen.has(a.id));
        if (!add.length) return prev;
        newIdsRef.current = new Set(add.map((a) => a.id)); // flash the new batch
        let merged = [...add, ...prev];
        if (sortBy === "premium")
          merged.sort((x, y) => (y.alertPremium || 0) - (x.alertPremium || 0));
        else if (sortBy === "conviction")
          merged.sort((x, y) => (y.convictionScore || 0) - (x.convictionScore || 0));
        else merged.sort((x, y) => (y.id || 0) - (x.id || 0)); // recent
        if (merged[0]) lastIdRef.current = merged[0].id;
        return applyOiEnrichment(merged.slice(0, 4000));
      });
    };
    es.onerror = () => {
      /* keep rendered data; browser EventSource auto-reconnects */
    };
    // Same half-dead-stream watchdog as the raw effect. Reuses sseNonce so the
    // return-to-tab catch-up reconnects the curated stream too (the effects are
    // mutually exclusive on `curated`, so sharing the nonce is safe).
    const wd = setInterval(() => {
      if (Date.now() - lastSseContactRef.current > SSE_STALL_MS) {
        lastSseContactRef.current = Date.now();
        setSseNonce((n) => n + 1);
      }
    }, 10000);
    return () => {
      clearInterval(wd);
      try {
        es.close();
      } catch {
        /* ignore */
      }
    };
  }, [curated, minGrade, sortBy, filters, sseNonce]);

  // ── Return-to-tab catch-up (2026-07-20) ───────────────────────────────────
  // Browsers throttle/freeze setInterval+setTimeout in a hidden/backgrounded
  // tab, so the 20s poll, the 30s SSE reconcile, AND the 40s half-dead-stream
  // watchdog all stop firing while you're away — the tape then sits frozen
  // ("15 min behind" on return) until a timer eventually wakes. Fix: the instant
  // the tab becomes visible / focused / back online, force an immediate
  // authoritative /recent catch-up (reconcileNonce) AND reconnect the stream
  // (sseNonce), so it snaps current on return instead of waiting on a throttled
  // timer. Coalesced to one sync per 1.5s so the paired visibilitychange+focus
  // burst doesn't double-fetch. Purely additive — the setters' existing effects
  // do the work; a sseNonce bump is a harmless no-op when SSE is off/curated.
  useEffect(() => {
    const syncNow = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastForegroundSyncRef.current < 1500) return;
      lastForegroundSyncRef.current = now;
      lastSseContactRef.current = now;   // fresh stall window for the reconnect
      setReconcileNonce((n) => n + 1);   // immediate authoritative /recent catch-up
      setSseNonce((n) => n + 1);         // heal a silently half-dead EventSource
    };
    const onVis = () => { if (document.visibilityState === "visible") syncNow(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", syncNow);
    window.addEventListener("online", syncNow);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", syncNow);
      window.removeEventListener("online", syncNow);
    };
  }, []);

  // Feed-gap surfacing (2026-07-09): fetch the day's detected downtime windows
  // so users SEE missed-flow windows ("9:36–9:53 · backfilling overnight")
  // instead of silently missing lines. Soft, refreshed every 3 min, tracks the
  // currently-viewed date.
  useEffect(() => {
    let cancelled = false, timer;
    async function fetchGaps() {
      try {
        const params = new URLSearchParams({ min_gap_minutes: "2" });
        if (targetDate) params.set("target_date", targetDate);
        const r = await fetch(`/api/live/massive/worker-history?${params}`);
        if (r.ok) {
          const d = await r.json();
          if (!cancelled) setGapInfo({
            windows: d.downtime_windows_strict || [],
            estDropped: d.total_estimated_dropped_events || 0,
          });
        }
      } catch { /* soft — no banner on failure */ }
      finally { if (!cancelled) timer = setTimeout(fetchGaps, 180000); }
    }
    fetchGaps();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [targetDate]);

  // Quotes polling — fetches current spot for unique tickers in the
  // current alert set every 30s. Decoupled from alert polling (5s) since
  // spot moves slower than alert flow and each Schwab call has a cost.
  // Historical view (?date=YYYY-MM-DD): P/L column uses current spot,
  // which compares historical alert spot to today's price — meaningful
  // for a multi-day-old alert ("MU bear at $1100 strike — stock has since
  // dropped 5%"), but interpret cautiously.
  useEffect(() => {
    let cancelled = false;
    let timer;

    async function pollQuotes() {
      const uniqueTickers = [...new Set(alerts.map(a => a.ticker).filter(Boolean))];
      if (uniqueTickers.length === 0) {
        timer = setTimeout(pollQuotes, 30000);
        return;
      }
      try {
        const r = await fetch("/api/live/massive/current-quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: uniqueTickers }),
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        if (cancelled) return;
        setQuotes(prev => ({ ...prev, ...(d.quotes || {}) }));
        setQuotesFetchedAt(d.fetched_at);
      } catch (e) {
        // Soft failure: P/L column shows "—" for tickers without quote
      } finally {
        if (!cancelled) timer = setTimeout(pollQuotes, 30000);
      }
    }

    // Trigger first quote fetch as soon as we have alerts, then every 30s
    if (alerts.length > 0) pollQuotes();
    else timer = setTimeout(pollQuotes, 5000);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // alerts.length in dep array, not alerts itself — re-trigger only when
    // we go from 0 alerts to having alerts, not on every alert update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.length > 0]);

  // Day-scoped Market Read polling — 30s cadence. Backend caches for 30s
  // server-side too, so this is effectively cache-aligned. Re-triggers
  // when targetDate changes (switching between dates in historical view).
  useEffect(() => {
    let cancelled = false;
    let timer;

    async function pollDayStats() {
      try {
        const params = new URLSearchParams();
        if (targetDate) params.set("target_date", targetDate);
        if (hideAlgo) params.set("exclude_algo", "true");
        // 7/9: partition the Market Read to match the Stocks/ETFs/All toggle
        // so the card describes the same universe as the row feed. Backend
        // treats "all" as no-op (both sources, subject to the etf gate).
        params.set("stock_etf", stockEtfFilter);
        const r = await fetch(`/api/live/massive/day-stats?${params}`);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        if (!cancelled) setDayStats(d);
      } catch {
        // Soft failure — card will show "Loading market read…" or stale data
      } finally {
        if (!cancelled) timer = setTimeout(pollDayStats, 30000);
      }
    }

    pollDayStats();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [targetDate, hideAlgo, stockEtfFilter]);

  // Persist view mode.
  useEffect(() => { localStorage.setItem(LS_KEY_VIEWMODE, viewMode); }, [viewMode]);

  // By-Contract rollup fetch — only polls while in contract mode. Respects the
  // date + Stocks/ETFs/All partition; backend caches 30s so we match cadence.
  useEffect(() => {
    if (viewMode !== "contract") return;
    let cancelled = false, timer;
    async function pull() {
      try {
        const params = new URLSearchParams({ stock_etf: stockEtfFilter, min_hits: String(minHits), lookback_days: String(lookbackDays) });
        if (targetDate) params.set("target_date", targetDate);
        const r = await fetch(`/api/live/massive/by-contract?${params.toString()}`);
        if (r.ok) { const d = await r.json(); if (!cancelled) setByContract(d); }
      } catch { /* soft-fail; keep last snapshot */ }
      finally { if (!cancelled) timer = setTimeout(pull, 30000); }
    }
    pull();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [viewMode, targetDate, stockEtfFilter, lookbackDays, minHits]);

  // Apply client-side filters: tier chips, ticker, contract, hideAlgo, search.
  // Tier filtering now happens here (was previously per-section); the
  // remaining list goes straight into the flat feed.
  //
  // Display order is controlled by the clickable column headers (sortCol/
  // sortDir), defaulting to time-descending — the natural tape order. The
  // `sortBy` toggle (recent/conviction/premium) selects WHICH alerts the
  // backend returns; column sort re-orders that set for display, so the two
  // are independent.
  const searchQ = search.trim().toUpperCase();

  // Value extractor for a given sort column. Keeps null/missing separate so
  // the comparator can always push blanks to the bottom regardless of dir.
  // ── Alpha Gold: one row per ticker (best by grade, then premium) ─────────
  // A name firing Alpha Gold at many strikes shouldn't own the tape. Keep only
  // each ticker's BEST Alpha Gold print in the alpha view; the runner-ups demote
  // to their directional tier (Bull→bullish, Bear→bearish, else size) so they
  // still surface there instead of vanishing. Only the alpha view collapses —
  // every other tier is untouched. Membership + counts follow the demoted tier.
  const _alphaDemote = (() => {
    const byTicker = new Map();
    for (const a of alerts) {
      if ((a._tierKey || "") !== "alpha") continue;
      const t = a.ticker || "";
      let arr = byTicker.get(t);
      if (!arr) { arr = []; byTicker.set(t, arr); }
      arr.push(a);
    }
    const gr = (a) => _GRADE_NUMERIC_FE[a.grade] ?? -1;              // A+ > A > B …
    const pr = (a) => (a.alertPremium != null ? Number(a.alertPremium) : 0) || 0;
    const demote = new Map();  // alert.id -> demoted tier
    for (const group of byTicker.values()) {
      if (group.length <= 1) continue;                              // single print — nothing to collapse
      group.sort((x, y) => (gr(y) - gr(x)) || (pr(y) - pr(x)));     // grade-first, premium tiebreak
      for (let i = 1; i < group.length; i++) {                      // [0] keeps alpha; rest demote
        const a = group[i];
        demote.set(a.id, a._direction === "Bull" ? "bullish"
                       : a._direction === "Bear" ? "bearish"
                       : "size");
      }
    }
    return demote;
  })();
  const _tierOf = (a) => _alphaDemote.get(a.id) || a._tierKey || "algo";

  // Runner-up Alpha Gold prints (all but a ticker's best) RENDER as their
  // demoted tier — Bull/Bear label + color — so "one Alpha Gold per ticker"
  // holds in EVERY view (All, ticker search, Bull/Bear), not only the Alpha
  // Gold filter. Display-only remap; grade / premium / side etc. are untouched.
  const _displayAlert = (a) => {
    const dt = _alphaDemote.get(a.id);
    if (!dt) return a;
    const name = dt === "bearish" ? "UCT Bearish"
               : dt === "bullish" ? "UCT Bullish"
               : dt === "size"    ? "UCT Size"
               : (a.alertName || "");
    return { ...a, _tierKey: dt, alertName: name };
  };

  const _colValue = (a, key) => {
    switch (key) {
      case "time":      return a.timestamp || 0;
      case "ticker":    return a.ticker || "";
      case "spot":      return a.spot != null ? Number(a.spot) : null;
      case "strike":    return a.strike != null ? Number(a.strike) : null;
      case "cp":        return a.cp || "";
      case "exp":       return _expSortVal(a.exp);
      case "moneyness": {
        if (a.moneynessPct == null) return null;
        const sign = a.moneynessLabel === "OTM" ? -1 : 1;  // ITM up, OTM down
        return sign * Math.abs(Number(a.moneynessPct));
      }
      case "price":     return a.averageFillPrice != null ? Number(a.averageFillPrice) : null;
      case "vol":       return a.tradeSize != null ? Number(a.tradeSize) : null;
      case "oi":        return a.priorOI != null ? Number(a.priorOI) : null;
      case "voi":       return a.volumeOIRatio != null ? Number(a.volumeOIRatio) : null;
      case "premium":   return a.alertPremium != null ? Number(a.alertPremium) : null;
      case "grade":     return _GRADE_NUMERIC_FE[a.grade] ?? null;
      case "side":      return a._side || "";
      case "type":      return a._type || "";
      case "pl":        return computePL(a, quotes[a.ticker]);
      case "tier":      return TIER_ORDER.indexOf(_tierOf(a));
      default:          return a.timestamp || 0;
    }
  };
  const _cmp = (a, b) => {
    const va = _colValue(a, sortCol);
    const vb = _colValue(b, sortCol);
    const na = va == null || va === "";
    const nb = vb == null || vb === "";
    if (na && nb) return (b.timestamp || 0) - (a.timestamp || 0);
    if (na) return 1;   // blanks always last
    if (nb) return -1;
    let r;
    if (typeof va === "string" || typeof vb === "string") {
      r = String(va).localeCompare(String(vb));
    } else {
      r = va - vb;
    }
    if (sortDir === "desc") r = -r;
    // Stable tiebreak: newest first within an equal sort key.
    if (r === 0) return (b.timestamp || 0) - (a.timestamp || 0);
    return r;
  };

  const visibleAlerts = alerts
    .filter(a => {
      const tier = _tierOf(a);
      if (hideAlgo && tier === "algo") return false;  // global Algo hide
      if (hideNoSide && (a._directionUnconfirmed || (a.alertName || "").toLowerCase().includes("not clean"))) return false;  // hide direction-unconfirmed "UCT Size"
      if (!filters[tier]) return false;
      // 7/7 + 7/9: Stocks / ETFs partition filter. PREFER the authoritative
      // backend source (Massive ticker_types); fall back to KNOWN_ETFS_INDEXES
      // only when source is absent. (Was set-only, which mis-partitioned SPCX etc.)
      if (stockEtfFilter !== "all") {
        const isEtf = a.source ? a.source === "indexes" : KNOWN_ETFS_INDEXES.has(a.ticker);
        if (stockEtfFilter === "stocks" && isEtf) return false;
        if (stockEtfFilter === "etfs" && !isEtf) return false;
      }
      if (searchQ && !(a.ticker || "").toUpperCase().includes(searchQ)) return false;
      if (tickerFilter.size > 0 && !tickerFilter.has(a.ticker)) return false;
      if (contractFilter.size > 0) {
        const k = `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`;
        if (!contractFilter.has(k)) return false;
      }
      return true;
    })
    .sort(_cmp);

  // By-Contract rollups, filtered by the same search / ticker-isolation the
  // print feed uses (partition + algo already applied server-side).
  const _allTiersOn = TIER_ORDER.every(t => filters[t]);
  const _todayTs = _mdyToDate(_etTodayMDY())?.getTime() || 0;   // start of today (ET)
  const _isExpired = (c) => { const t = _expTs(c.exp); return t > 0 && t < _todayTs; };
  let visibleContracts = (byContract?.contracts || []).filter(c => {
    if (searchQ && !(c.ticker || "").toUpperCase().includes(searchQ)) return false;
    if (tickerFilter.size > 0 && !tickerFilter.has(c.ticker)) return false;
    // Tier chips (Alpha Gold / Size / Bullish / …) now filter By-Contract too:
    // keep a contract only if one of its prints belongs to a currently-ON tier.
    // So "Alpha Gold" (or Size) shows which of THOSE contracts are still open/adding.
    if (!_allTiersOn && !((c.tiers || []).some(t => filters[t]))) return false;
    // Still-open only: an expired contract can't be open, and a settled OI that
    // says CLOSED (exited) means it's gone — hide both.
    if (stillOpenOnly && (_isExpired(c) || oiCheck[_ckey(c.ticker, c.cp, c.strike, c.exp)]?.status === "closed")) return false;
    return true;
  });
  if (cSortCol && CONTRACT_SORT_KEYS[cSortCol]) {
    const keyer = CONTRACT_SORT_KEYS[cSortCol];
    visibleContracts = [...visibleContracts].sort((a, b) => {
      const av = keyer(a), bv = keyer(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv) : (av - bv);
      return cSortDir === "desc" ? -cmp : cmp;
    });
  }

  // Per-tier counts (for filter chip badges). Independent of which TIERS are
  // toggled on — so a badge shows "if you turned this on, here's how many you'd
  // see" — but it MUST honor the same ORTHOGONAL filters the display applies
  // (Stocks/ETFs partition, Not-Clean hidden, Algo hide) and the ticker/contract
  // filter. Otherwise a badge over-counts vs the rows: e.g. on the ETFs partition
  // "Alpha Gold 14" but only the 2 ETF alpha golds render, the 12 stock ones
  // "disappear" (2026-08-04).
  const tierCounts = {};
  for (const t of TIER_ORDER) tierCounts[t] = 0;
  for (const a of alerts) {
    if (searchQ && !(a.ticker || "").toUpperCase().includes(searchQ)) continue;
    if (tickerFilter.size > 0 && !tickerFilter.has(a.ticker)) continue;
    if (contractFilter.size > 0) {
      const k = `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`;
      if (!contractFilter.has(k)) continue;
    }
    const t = _tierOf(a);
    // Mirror visibleAlerts' orthogonal filters (everything EXCEPT the tier toggle).
    if (hideAlgo && t === "algo") continue;
    if (hideNoSide && (a._directionUnconfirmed || (a.alertName || "").toLowerCase().includes("not clean"))) continue;
    if (stockEtfFilter !== "all") {
      const isEtf = a.source ? a.source === "indexes" : KNOWN_ETFS_INDEXES.has(a.ticker);
      if (stockEtfFilter === "stocks" && isEtf) continue;
      if (stockEtfFilter === "etfs" && !isEtf) continue;
    }
    if (tierCounts[t] !== undefined) tierCounts[t]++;
  }

  // Per-contract hit counts — same strike/exp/cp fired multiple times today.
  // Computed across ALL alerts (not just visible) so a contract that fires
  // 7x but only 3 are currently visible (e.g., min_grade=A filter) still
  // shows ×7 on those 3 rows. Built keyed by the same contract key used in
  // contractFilter so clicking can drill into all of them.
  const hitCounts = {};
  for (const a of alerts) {
    if (a.cp == null || a.strike == null || !a.exp) continue;
    const k = `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`;
    hitCounts[k] = (hitCounts[k] || 0) + 1;
  }

  const handleClickTicker = (t) => {
    setTickerFilter(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };
  const handleClickContract = (k) => {
    setContractFilter(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const handleClearFilters = () => {
    setTickerFilter(new Set());
    setContractFilter(new Set());
  };

  // Column-header click: 1st → column's default dir, 2nd → flip, 3rd → reset
  // to the natural time-descending tape order.
  const handleSortColumn = (key) => {
    const def = COLUMNS.find(c => c.key === key)?.dir || "desc";
    if (sortCol !== key) {
      setSortCol(key);
      setSortDir(def);
    } else if (sortDir === def) {
      setSortDir(def === "desc" ? "asc" : "desc");
    } else {
      setSortCol("time");
      setSortDir("desc");
    }
  };

  // Tier badge / alert-name click inside a row: isolate that tier (mirrors the
  // FilterChips toggle — clicking the already-isolated tier restores all).
  const handleClickTier = (tier) => {
    const ons = TIER_ORDER.filter(t => filters[t]);
    const isolated = ons.length === 1 && ons[0] === tier;
    const next = {};
    for (const t of TIER_ORDER) next[t] = isolated ? true : (t === tier);
    setFilters(next);
  };

  // OI fetch — same backend endpoint LiveFlow.jsx uses for /live-flow.
  // POST /api/oi-snapshot/bulk-fetch checks the snapshot table first,
  // then batch-fetches misses from Schwab. We dedup contracts so we
  // don't hit Schwab multiple times for the same strike/exp.
  //
  // After OI fills in, alerts whose cum_volume > new OI should become
  // MAGENTA/YELLOW on the next worker pass — but for THIS page we just
  // merge OI back into local state so V/OI displays update immediately,
  // matching LiveFlow.jsx's UX.
  const handleOiFetch = async () => {
    if (oiFetchState.loading) return;
    const nullOIAlerts = alerts.filter(a => a.priorOI == null);
    if (!nullOIAlerts.length) {
      setOiFetchState({ loading: false, result: { filled: 0, total: 0 } });
      return;
    }
    setOiFetchState({ loading: true, result: null });

    // Dedup by contract (same strike/exp across multi-fire rows = one fetch)
    const contractMap = new Map();
    for (const a of nullOIAlerts) {
      if (!a.ticker || !a.cp || a.strike == null || !a.exp) continue;
      const k = `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`;
      if (!contractMap.has(k)) {
        contractMap.set(k, {
          ticker: a.ticker, cp: a.cp, strike: a.strike, exp: a.exp,
        });
      }
    }
    const contracts = Array.from(contractMap.values());

    try {
      const oiMap = {};
      const CHUNK = 400;  // matches /enrich-oi backend BATCH size — one round-trip
      // Point at the snapshot-only endpoint (added 2026-07-05 to fix the hang
      // on historical views). The old /api/oi-snapshot/bulk-fetch tried Schwab
      // as a fallback for snapshot misses; Schwab has no historical OI so the
      // HTTP call sat pending indefinitely. This endpoint never touches
      // Schwab — it reads contract_oi_snapshots (346K rows) using the
      // verified TICKER|CP|STRIKE.0|M/D/YYYY key format.
      //
      // target_date is passed when in historical view so the returned OI is
      // pre-trade (snap_date <= view date), not post-trade lookahead. In live
      // view (targetDate == null) we omit the param and get latest available.
      const enrichUrl = targetDate
        ? `/api/live/massive/enrich-oi?target_date=${encodeURIComponent(targetDate)}`
        : "/api/live/massive/enrich-oi";
      for (let i = 0; i < contracts.length; i += CHUNK) {
        const chunk = contracts.slice(i, i + CHUNK);
        const r = await fetch(enrichUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk),
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        for (const row of (d.results || [])) {
          const k = `${row.ticker}|${row.cp}|${row.strike}|${row.exp}`;
          oiMap[k] = row.oi;
        }
      }

      // Merge OI back into alerts locally so the V/OI column updates
      // without waiting for the next poll cycle. Recompute volumeOIRatio
      // and oiExceeded inline to match server-side logic.
      const filledKeys = new Set(Object.keys(oiMap));

      // Persist into the enrichment ref BEFORE the setAlerts merge, so any
      // /recent poll that fires in the microseconds between here and the
      // React commit will already see the enrichment through applyOiEnrichment.
      for (const k of filledKeys) {
        oiEnrichmentRef.current[k] = oiMap[k];
      }

      setAlerts(prev => prev.map(a => {
        if (a.priorOI != null) return a;
        const k = `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`;
        if (!filledKeys.has(k)) return a;
        const oi = oiMap[k];
        const ts = a.tradeSize || 0;
        const ratio = (oi > 0 && ts > 0) ? Math.round((ts / oi) * 100) / 100 : null;
        return {
          ...a,
          priorOI: oi,
          volumeOIRatio: ratio,
          oiExceeded: ratio != null && ratio > 1.0,
        };
      }));

      // Identify contracts that came back empty so we can surface them
      const requestedKeys = contracts.map(c => `${c.ticker}|${c.cp}|${c.strike}|${c.exp}`);
      const failedContracts = contracts.filter(c => {
        const k = `${c.ticker}|${c.cp}|${c.strike}|${c.exp}`;
        return !filledKeys.has(k) || oiMap[k] == null;
      });
      if (failedContracts.length > 0) {
        console.warn(
          `[OI fetch] ${failedContracts.length} contract(s) returned no OI:`,
          failedContracts
        );
      }

      setOiFetchState({
        loading: false,
        result: {
          filled: filledKeys.size,
          total: contracts.length,
          failedContracts: failedContracts.map(c =>
            `${c.ticker} ${c.cp} $${c.strike} ${c.exp}`
          ),
        },
      });
    } catch (e) {
      console.error("OI bulk fetch failed:", e);
      setOiFetchState({
        loading: false,
        result: { filled: 0, total: contracts.length, error: e.message },
      });
    }
  };

  // ── Header liveness/loading (2026-07-20) ──────────────────────────────────
  // firstLoadPending: no real snapshot yet (initial cold fill / warming stub)
  // and no error → the header shows "LOADING", never the false "Worker idle".
  const firstLoadPending = !dataArrived && !error;
  // Data-derived liveness backstop: the backend liveness probe can freeze
  // last_event_at (a replayed old-dated row with a high id poisons it), so also
  // treat the tape as LIVE when the newest alert on screen is recent.
  // `timestamp` is unix SECONDS. Defense-in-depth — right even if status lies.
  const newestEventTs = useMemo(() => {
    let m = 0;
    for (const a of alerts) { const t = Number(a?.timestamp) || 0; if (t > m) m = t; }
    return m;
  }, [alerts]);
  const workerLive = !!(status?.connected) ||
    (newestEventTs > 0 && (Date.now() / 1000 - newestEventTs) < 180);
  // Escalate the loading copy if the first snapshot is taking abnormally long.
  useEffect(() => {
    if (!firstLoadPending) { setLoadSlow(false); return; }
    const t = setTimeout(() => setLoadSlow(true), 150000);
    return () => clearTimeout(t);
  }, [firstLoadPending]);

  return (
    <div style={{
      background: P.bg, color: P.wh, minHeight: "100vh",
      fontFamily: "var(--font-sans)", fontVariantNumeric: "tabular-nums",
      padding: 16,
    }}>
      <style>{`
        @keyframes flashRow {
          0% { background: ${P.ac}30; }
          100% { background: ${P.cd}; }
        }
      `}</style>

      <Header
        status={status}
        loadPending={firstLoadPending}
        warming={warming}
        workerLive={workerLive}
        sortBy={sortBy}
        onSortChange={setSortBy}
        minGrade={minGrade}
        onMinGradeChange={setMinGrade}
        rowLimit={rowLimit}
        onRowLimitChange={setRowLimit}
        hideAlgo={hideAlgo}
        onHideAlgoChange={setHideAlgo}
        hideNoSide={hideNoSide}
        onHideNoSideChange={setHideNoSide}
        curated={curated}
        onCuratedChange={setCurated}
        tickerFilter={tickerFilter}
        contractFilter={contractFilter}
        onClearFilters={handleClearFilters}
        targetDate={targetDate}
        onDateChange={setTargetDate}
        onRange={applyRange}
        rangeDays={viewMode === "contract" ? lookbackDays : 1}
        onOiFetch={handleOiFetch}
        oiFetchState={oiFetchState}
        nullOICount={alerts.filter(a => a.priorOI == null).length}
      />

      {targetDate && (
        <div style={{
          padding: 10, background: P.cd, color: P.ac, marginBottom: 12,
          border: `1px solid ${P.ac}`, borderRadius: 4, fontSize: 12,
        }}>
          📅 {viewMode === "contract" && lookbackDays > 1
            ? `Historical range: last ${lookbackDays} trading days ending ${targetDate}`
            : `Historical view: ${targetDate}`} (remove ?date param to return to live)
        </div>
      )}

      {error && (
        <div style={{
          padding: 10, background: P.be + "30", color: P.be, marginBottom: 12,
          border: `1px solid ${P.be}`, borderRadius: 4, fontSize: 12,
        }}>
          Error: {error}
        </div>
      )}

      {/* MARKET READ — day-scoped macro positioning. Scrolls naturally
          (NOT sticky) so it doesn't consume scroll real estate. Users
          who want to see it again scroll back to top of the alert list. */}
      <MarketReadCard stats={dayStats} />

      {/* FEED-GAP TRANSPARENCY — surface detected downtime windows so users
          never silently miss flow; the T+1 healer backfills them overnight. */}
      {gapInfo && gapInfo.windows && gapInfo.windows.length > 0 && (
        <div style={{
          margin: "8px 0", padding: "8px 12px", borderRadius: 8,
          background: "rgba(180,130,20,0.12)", borderLeft: "3px solid #d8ae4e",
          color: P.text, fontSize: 12.5, lineHeight: 1.5,
        }}>
          <strong style={{ color: "#d8ae4e", letterSpacing: 0.5 }}>
            {gapInfo.windows.length} FEED GAP{gapInfo.windows.length > 1 ? "S" : ""} TODAY
          </strong>
          {" — "}
          {gapInfo.windows.map((w, i) => `${i > 0 ? ", " : ""}${w.start}–${w.end}`).join("")}
          {gapInfo.estDropped > 0 && ` · ~${gapInfo.estDropped.toLocaleString()} prints missed live`}
          {" · "}
          <span style={{ opacity: 0.85 }}>backfilling overnight from the official OPRA tape</span>
        </div>
      )}

      {/* STICKY HEADER GROUP — only the essential controls follow scroll:
          tier-filter chips + column headers. The Market Read above scrolls
          out of view as the user moves through alerts, freeing ~250px of
          viewport for visible rows. */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: P.bg,  // must be opaque or scrolling alerts bleed through
        // Negative side margin lets the sticky background extend to the
        // page edges, matching the parent's 16px padding so there's no
        // visible gap on either side as alerts scroll behind it.
        marginLeft: -16, marginRight: -16,
        paddingLeft: 16, paddingRight: 16,
        paddingTop: 4, paddingBottom: 4,
      }}>
        <FilterChips filters={filters} onChange={setFilters} counts={tierCounts}
                     stockEtfFilter={stockEtfFilter} onStockEtfChange={setStockEtfFilter}
                     search={search} onSearchChange={setSearch}
                     viewMode={viewMode} onViewModeChange={setViewMode}
                     hideNoSide={hideNoSide} onHideNoSideChange={setHideNoSide} />

        {viewMode === "contract" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", fontSize: 11, color: P.mt }}>
            <span style={{ fontWeight: 600 }}>Lookback ({lookbackDays}d):</span>
            {[1, 3, 5].map(n => (
              <button key={n} onClick={() => setLookback(n)} style={{
                padding: "3px 10px", borderRadius: 12, fontSize: 10, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${lookbackDays === n ? P.ac : P.bd}`,
                background: lookbackDays === n ? P.ac + "22" : "transparent",
                color: lookbackDays === n ? P.ac : P.mt,
              }}>{n}d</button>
            ))}
            <span style={{ color: P.bd }}>·</span>
            <span style={{ fontWeight: 600 }}>Min hits:</span>
            {[1, 3, 5].map(n => (
              <button key={"mh" + n} onClick={() => setMinHits(n)} style={{
                padding: "3px 9px", borderRadius: 12, fontSize: 10, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${minHits === n ? P.ac : P.bd}`,
                background: minHits === n ? P.ac + "22" : "transparent",
                color: minHits === n ? P.ac : P.mt,
              }} title={n === 1
                ? "Show EVERY contract — single big prints too, not just accumulation"
                : `Only contracts hit ≥${n}× (accumulation)`}>{n}×</button>
            ))}
            <label
              title="Hide contracts whose settled OI shows they CLOSED (exited). Runs Check OI if not yet fetched."
              style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 10, fontWeight: 700, color: stillOpenOnly ? P.ac : P.mt, cursor: "pointer" }}>
              <input type="checkbox" checked={stillOpenOnly}
                onChange={(e) => {
                  const on = e.target.checked;
                  setStillOpenOnly(on);
                  if (on && Object.keys(oiCheck).length === 0) handleCheckOI();
                }}
                style={{ accentColor: P.ac, cursor: "pointer" }} />
              Still open only
            </label>
            <button
              onClick={handleCheckOI}
              disabled={oiChecking}
              title="Fetch latest settled OI per contract and confirm whether positions held overnight (OI grew) or closed (OI fell)"
              style={{
                padding: "3px 12px", borderRadius: 12, fontSize: 10, fontWeight: 700,
                border: `1px solid ${P.ac}`, background: "transparent", color: P.ac,
                cursor: oiChecking ? "wait" : "pointer", fontFamily: "inherit", opacity: oiChecking ? 0.6 : 1,
              }}>
              {oiChecking ? "checking…" : "↻ Check OI"}
            </button>
            {(oiChecking || oiSummary) && (
              <span style={{ flexBasis: "100%", marginTop: 4, fontSize: 10,
                color: oiSummary.startsWith("✗") ? "#C26A6A" : P.dm }}>
                {oiChecking ? "Fetching settled OI for every contract in view…" : oiSummary}
              </span>
            )}
          </div>
        )}

        {viewMode === "print"
          ? <ColumnHeaders sortCol={sortCol} sortDir={sortDir} onSort={handleSortColumn} isAdmin={isTuneMode} />
          : <ContractColumnHeaders isAdmin={isTuneMode} sortCol={cSortCol} sortDir={cSortDir} onSort={onContractSort} />}
      </div>

      {/* TuningPanel — admin-only, shown when ?tune=1 in URL. Sits below the
          sticky header group (NOT inside it) so it doesn't follow scroll. */}
      {isTuneMode && (
        <TuningPanel
          thresholds={thresholds}
          onChange={handleThresholdsChange}
          onSave={handleThresholdsSave}
          onReset={handleThresholdsReset}
          dirty={thresholdsDirty}
          alerts={visibleAlerts}
          autoPushCfg={autoPushCfg}
          onAutoPush={saveAutoPushCfg}
          targetDate={targetDate}
        />
      )}

      {/* Flat feed — alerts in their natural sort order (recent/conviction/premium).
          Tier is indicated by the colored left border on each row, and the
          filter chips above control which tiers appear in this flat list.
          This replaces the earlier tier-grouped layout (which was useful for
          end-of-day analysis but less suited for live tape-style viewing). */}
      {/* Truncation banner — fires when backend returned exactly `rowLimit`
          alerts, meaning older ones were cut. Placed ABOVE the list so it's
          unmissable (the muted footer version was easy to overlook — 7/7
          screenshot had 10:55 AM as earliest visible without user noticing
          morning alerts were cut). Shows the earliest visible timestamp so
          the user knows exactly where the visible window starts. */}
      {viewMode === "print" && (<>
      {rowLimit !== "All" && alerts.length === rowLimit && alerts.length > 0 && (() => {
        const earliest = alerts[alerts.length - 1];
        const earliestTs = earliest?.CreatedTime || earliest?.ts || earliest?._ts || "?";
        return (
          <div style={{
            padding: "10px 14px", marginBottom: 10,
            background: "#3a2a10", color: "#ffb84a",
            border: "1px solid #b8791f", borderRadius: 4,
            fontSize: 13, fontWeight: 600, textAlign: "left",
          }}>
            ⚠ Showing latest {rowLimit} alerts — earliest visible is {earliestTs}.
            Older alerts from today are hidden. Change limit in toolbar above ↑
            to see the full day.
          </div>
        );
      })()}
      {visibleAlerts.map(a => {
        const ck = (a.cp && a.strike != null && a.exp)
          ? `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`
          : null;
        return (
          <AlertRow
            key={a.id}
            alert={_displayAlert(a)}
            isNew={newIdsRef.current.has(a.id)}
            hitCount={ck ? (hitCounts[ck] || 1) : 1}
            currentSpot={quotes[a.ticker]}
            onClickTicker={handleClickTicker}
            onClickContract={handleClickContract}
            onClickTier={handleClickTier}
            onOpenChart={setChartSym}
            isAdmin={isTuneMode}
            onPush={handlePush}
            pushState={pushStates[a.id]}
          />
        );
      })}

      {visibleAlerts.length === 0 && !error && (
        <div style={{
          padding: 30, textAlign: "center", color: P.dm,
          background: P.cd, borderRadius: 4, marginTop: 20,
        }}>
          {firstLoadPending
            ? (loadSlow
                ? "Still loading — the tape is taking unusually long. Try refreshing (Ctrl+Shift+R)."
                : "Loading today's flow…")
            : (alerts.length === 0
                ? (workerLive
                    ? "Waiting for live flow… (markets may be closed, or no conviction prints yet today)"
                    : "No flow for today yet — markets may be closed, or nothing has cleared the conviction filter. Use History or ?date=M/D/YYYY to view a past session.")
                : `No alerts match your filters. (${alerts.length} total alerts hidden)`)}
        </div>
      )}

      {visibleAlerts.length > 0 && (
        <div style={{
          padding: 10, color: P.dm, fontSize: 11, textAlign: "right",
          borderTop: `1px solid ${P.bd}`, marginTop: 8,
        }}>
          showing {visibleAlerts.length} of {alerts.length} alerts
          {rowLimit !== "All" && alerts.length === rowLimit && ` (limit ${rowLimit} — change in toolbar to see more)`}
        </div>
      )}
      </>)}

      {viewMode === "contract" && (<>
        {visibleContracts.map(c => (
          <ContractRow
            key={`${c.ticker}|${c.cp}|${c.strike}|${c.exp}`}
            c={c}
            onClickTicker={handleClickTicker}
            onOpenChart={setChartSym}
            isAdmin={isTuneMode}
            onPush={handlePushContract}
            pushState={contractPushStates[`${c.ticker}|${c.cp}|${c.strike}|${c.exp}`]}
            oiCheck={oiCheck[_ckey(c.ticker, c.cp, c.strike, c.exp)]}
            expired={_isExpired(c)}
          />
        ))}
        {visibleContracts.length === 0 && !error && (
          <div style={{
            padding: 30, textAlign: "center", color: P.dm,
            background: P.cd, borderRadius: 4, marginTop: 20,
          }}>
            {byContract == null
              ? "Loading accumulation rollups…"
              : "No contracts hit ≥3× at decent size today for this filter. Try All, or widen the date."}
          </div>
        )}
        {visibleContracts.length > 0 && (
          <div style={{
            padding: 10, color: P.dm, fontSize: 11, textAlign: "right",
            borderTop: `1px solid ${P.bd}`, marginTop: 8,
          }}>
            {visibleContracts.length} contracts{minHits > 1 ? ` accumulating (≥${minHits}×)` : " (all, min 1×)"} · sorted by {cSortCol ? `${cSortCol.toLowerCase()} ${cSortDir}` : "latest activity"} · click a row to expand prints
          </div>
        )}
      </>)}

      <div style={{
        marginTop: 30, padding: 12, color: P.mt, fontSize: 10,
        textAlign: "center", borderTop: `1px solid ${P.bd}`,
      }}>
        Live Flow ・ Real-time options tape ・ {((STREAM_ENABLED && !curated) || (CURATED_STREAM_ENABLED && curated)) ? "Live stream (SSE)" : `Refreshing every ${POLL_INTERVAL_MS/1000}s`}
      </div>

      {/* Right-click-to-chart popup — one instance for the whole page, never
          per-row. Controlled mode: TickerPopup renders no trigger, just the
          full ChartPane modal, opened/closed by chartSym. */}
      {chartSym && <TickerPopup sym={chartSym} open onClose={() => setChartSym(null)} />}
    </div>
      );
}
