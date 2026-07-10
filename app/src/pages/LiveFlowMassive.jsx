import { useEffect, useRef, useState, Fragment } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * LiveFlowMassive — TEST PAGE
 *
 * Sister page to LiveFlow.jsx. Same visual tier system, but polls a
 * different backend that sources data from Massive WS writes to FlowDB
 * instead of Bullflow SSE.
 *
 *   Bullflow SSE  →  liveflow_worker  →  in-memory buffer  →  /api/live/alerts/recent  →  LiveFlow.jsx
 *   Massive WS    →  massive_ws_worker →  FlowDB           →  /api/live/massive/recent →  LiveFlowMassive.jsx
 *
 * Stripped-down vs LiveFlow.jsx — no history, no backtest, no Discord
 * force-push, no blocklist, no OI fetch. We'll add features back if/when
 * we promote this to the production live page. For now, the goal is:
 * verify the Massive data shape renders correctly in the same tier UI.
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
const TIER_ORDER = ["alpha", "size", "bullish", "bearish", "leaps", "unusual", "algo"];

// ─── localStorage keys ────────────────────────────────────────────────────
const LS_KEY_FILTERS = "uct_liveflow_massive_filters_v1";
const LS_KEY_SORT    = "uct_liveflow_massive_sort_v1";
const LS_KEY_MINGRADE= "uct_liveflow_massive_mingrade_v1";
const LS_KEY_COLSORT = "uct_liveflow_massive_colsort_v1";  // per-column table sort (col+dir)

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
function FilterChips({ filters, onChange, counts, stockEtfFilter, onStockEtfChange, search, onSearchChange }) {
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

      {/* Ticker search — lives at the end of the tier-chip row (after Algo) for
          visibility. Client-side substring match on the fetched feed; at the
          default "Show: All" limit that's the full trading day. Pushed right
          with marginLeft:auto so it anchors to the far end of the row. */}
      {onSearchChange && (
        <div style={{
          position: "relative", display: "inline-flex", alignItems: "center",
          marginLeft: "auto",
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
function AlertRow({ alert, isNew, hitCount, currentSpot, onClickTicker, onClickContract, onClickTier }) {
  const tier = alert._tierKey || "algo";
  const meta = TIER_META[tier];
  const dirIsBull = alert._direction === "Bull";
  const dirIsBear = alert._direction === "Bear";
  const isAlpha = tier === "alpha";
  const isSize = tier === "size";

  // Direction palette — brighter than P.bu / P.be so non-alpha rows still
  // have visual weight. Non-directional tiers (algo) keep neutral coloring.
  const DIR_BULL = "#6BAA85";   // brighter green than P.bu
  const DIR_BEAR = "#C26A6A";   // brighter red than P.be
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
  const rowBorder = isAlpha ? `5px solid ${P.ac}` : `3px solid ${meta.color}`;
  const fontSize = isAlpha ? 14 : 13;
  const secondaryFontSize = 12;
  // Field coloring: alpha → gold, otherwise direction-based
  const tickerColor = isAlpha ? P.ac : dirColor;
  const tickerWeight = isAlpha ? 700 : 600;
  const strikeColor = isAlpha ? P.ac : dirColor;
  const strikeWeight = isAlpha ? 700 : (isSize ? 700 : 600);
  const premColor = isAlpha ? P.ac : dirColor;
  const premWeight = isAlpha ? 700 : 600;
  const alertNameColor = isAlpha ? P.wh : (dirColor === P.wh ? P.dm : dirColor);
  const cpDisplayColor = dirIsBull ? DIR_BULL : dirIsBear ? DIR_BEAR : P.dm;

  return (
    <div style={{
      display: "grid",
      // TIME | TICKER+×N | SPOT | STRIKE | C/P | EXP | %ITM/OTM | PRICE | VOL | OI | V/OI | PREMIUM | GRADE | SIDE | TYPE | P/L | ALERT
      gridTemplateColumns: "98px 100px 75px 80px 42px 100px 75px 70px 70px 70px 60px 95px 60px 50px 55px 75px 1fr",
      gap: 8, padding: isAlpha ? "10px 12px" : "8px 12px",
      borderLeft: rowBorder,
      background: rowBg, marginBottom: 2, fontSize: fontSize,
      alignItems: "center",
      ...flashStyle,
    }}>
      <span style={{ color: P.dm, whiteSpace: "nowrap", textAlign: "center" }}>
        {fmtTime(alert.timestamp)}
      </span>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, overflow: "hidden" }}>
        <span
          style={{ color: tickerColor, fontWeight: tickerWeight, cursor: "pointer" }}
          onClick={() => onClickTicker(alert.ticker)}
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
        color: P.dm,
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
      <span style={{ color: P.dm, fontSize: secondaryFontSize, whiteSpace: "nowrap", textAlign: "center" }}>
        {alert.exp || "—"}
      </span>
      {/* %ITM/OTM column (added 6/29): moneyness from backend _moneyness().
          Bold when ITM > 25% to flag deep-ITM trades that would NOT
          qualify for Alpha Gold tier under the new router filter. */}
      <span style={{
        color: P.dm,
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
      <span style={{ color: P.dm, fontSize: secondaryFontSize, textAlign: "center" }}>
        {fmtPrice(alert.averageFillPrice)}
      </span>
      <span style={{
        color: isAlpha ? P.wh : P.dm,
        fontSize: secondaryFontSize, textAlign: "center",
        fontWeight: isAlpha ? 600 : 400,
      }}>
        {fmtCount(alert.tradeSize)}
      </span>
      <span style={{ color: P.dm, fontSize: secondaryFontSize, textAlign: "center" }}>
        {fmtCount(alert.priorOI)}
      </span>
      <span style={{
        color: alert.oiExceeded ? P.ac : P.dm,
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
          {isAlpha && "★ "}{meta.label}
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
          {alert.alertName}
        </span>
      </span>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────
function Header({ status, sortBy, onSortChange, minGrade, onMinGradeChange,
                  rowLimit, onRowLimitChange,
                  hideAlgo, onHideAlgoChange,
                  curated, onCuratedChange,
                  tickerFilter, contractFilter, onClearFilters,
                  targetDate, onDateChange, onOiFetch, oiFetchState,
                  nullOICount }) {
  const connected = status?.connected;
  const lastEvent = status?.last_event_at;
  const returned = status?.returned;
  // Convert M/D/YYYY ↔ YYYY-MM-DD for the native <input type="date"> field.
  // Native input requires ISO format; our backend uses M/D/YYYY.
  const dateInputValue = (() => {
    if (!targetDate) return "";
    const parts = targetDate.split("/");
    if (parts.length !== 3) return "";
    const [m, d, y] = parts;
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  })();
  const handleDateInput = (e) => {
    const v = e.target.value;  // YYYY-MM-DD
    if (!v) { onDateChange(null); return; }
    const [y, m, d] = v.split("-");
    onDateChange(`${parseInt(m)}/${parseInt(d)}/${y}`);  // M/D/YYYY
  };
  return (
    <div style={{
      padding: "12px 16px", background: P.cd, marginBottom: 16,
      borderRadius: 4, border: `1px solid ${P.bd}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{
          color: P.ac, fontWeight: 700, fontSize: 14, letterSpacing: 1,
        }}>
          LIVE FLOW — MASSIVE (TEST)
        </span>
        <span style={{
          padding: "2px 8px", borderRadius: 3, fontSize: 11,
          background: connected ? P.bu : P.be, color: P.wh,
        }}>
          {connected ? "● WORKER LIVE" : "○ WORKER IDLE"}
        </span>
        {lastEvent && (
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
        <label style={{ color: P.dm, fontSize: 12 }}>Date:</label>
        <input
          type="date"
          value={dateInputValue}
          onChange={handleDateInput}
          style={{
            background: P.bg, color: P.wh,
            border: `1px solid ${P.bd}`, borderRadius: 3,
            padding: "3px 8px", fontSize: 11,
            fontFamily: "inherit", colorScheme: "dark",
          }}
        />
        {targetDate && (
          <button
            onClick={() => onDateChange(null)}
            style={{
              background: "transparent", color: P.ac,
              border: `1px solid ${P.ac}`, borderRadius: 3,
              padding: "3px 8px", cursor: "pointer", fontSize: 11,
            }}
            title="Return to live view (today)"
          >
            ← LIVE
          </button>
        )}

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

        {/* Hide Algo toggle — when ON: (1) Algo rows filtered from the table,
            (2) Algo premium excluded from the Market Read card aggregation.
            Multi-leg trades aren't truly directional even when one leg prints
            at ask, so this gives a cleaner "directional conviction only" read. */}
        <button
          onClick={() => onHideAlgoChange(!hideAlgo)}
          title={hideAlgo
            ? "Algo (multi-leg) tier currently HIDDEN from both the table and the bull/bear card math. Click to show again."
            : "Hide Algo (multi-leg) tier from both the table and the bull/bear card math. Gives a pure-directional read."
          }
          style={{
            background: hideAlgo ? P.ac : "transparent",
            color: hideAlgo ? P.bg : P.wh,
            border: `1px solid ${P.bd}`, borderRadius: 3,
            padding: "3px 10px", cursor: "pointer", fontSize: 11,
            fontWeight: 600,
          }}
        >
          {hideAlgo ? "✓ Algo hidden" : "Hide Algo"}
        </button>

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
function ColumnHeaders({ sortCol, sortDir, onSort }) {
  return (
    <div style={{
      display: "grid",
      // TIME | TICKER | SPOT | STRIKE | C/P | EXP | %ITM/OTM | PRICE | VOL | OI | V/OI | PREMIUM | GRADE | SIDE | TYPE | P/L | ALERT
      gridTemplateColumns: "98px 100px 75px 80px 42px 100px 75px 70px 70px 70px 60px 95px 60px 50px 55px 75px 1fr",
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
function TuningPanel({ thresholds, onChange, onSave, onReset, dirty, alerts }) {
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
    onChange(next);
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
        <div style={{
          color: P.ac, fontSize: 12, fontWeight: 800, letterSpacing: 1,
        }}>
          🔧 ADMIN: CURATED TUNING PANEL
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
  // Thresholds loaded from /api/live/massive/thresholds. Local edits in the
  // tuning panel mutate this state for preview; "Save" POSTs back to backend.
  const [thresholds, setThresholds] = useState(null);
  const [thresholdsDirty, setThresholdsDirty] = useState(false);
  const [tickerFilter, setTickerFilter] = useState(new Set());
  const [contractFilter, setContractFilter] = useState(new Set());
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
  const handleThresholdsChange = (next) => {
    setThresholds(next);
    setThresholdsDirty(true);
  };
  const handleThresholdsSave = async () => {
    try {
      const r = await fetch("/api/live/massive/thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(thresholds),
      });
      if (!r.ok) {
        const t = await r.text();
        alert(`Save failed: ${r.status} ${t}`);
        return;
      }
      const d = await r.json();
      if (d.thresholds) setThresholds(d.thresholds);
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
      case "tier":      return TIER_ORDER.indexOf(a._tierKey || "algo");
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
      const tier = a._tierKey || "algo";
      if (hideAlgo && tier === "algo") return false;  // global Algo hide
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

  // Per-tier counts (for filter chip badges). Built from ALL alerts that
  // pass the ticker/contract filter — independent of which tiers are toggled
  // on — so the badges always show "if you turned this on, here's how many
  // alerts you'd see".
  const tierCounts = {};
  for (const t of TIER_ORDER) tierCounts[t] = 0;
  for (const a of alerts) {
    if (searchQ && !(a.ticker || "").toUpperCase().includes(searchQ)) continue;
    if (tickerFilter.size > 0 && !tickerFilter.has(a.ticker)) continue;
    if (contractFilter.size > 0) {
      const k = `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`;
      if (!contractFilter.has(k)) continue;
    }
    const t = a._tierKey || "algo";
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
        sortBy={sortBy}
        onSortChange={setSortBy}
        minGrade={minGrade}
        onMinGradeChange={setMinGrade}
        rowLimit={rowLimit}
        onRowLimitChange={setRowLimit}
        hideAlgo={hideAlgo}
        onHideAlgoChange={setHideAlgo}
        curated={curated}
        onCuratedChange={setCurated}
        tickerFilter={tickerFilter}
        contractFilter={contractFilter}
        onClearFilters={handleClearFilters}
        targetDate={targetDate}
        onDateChange={setTargetDate}
        onOiFetch={handleOiFetch}
        oiFetchState={oiFetchState}
        nullOICount={alerts.filter(a => a.priorOI == null).length}
      />

      {targetDate && (
        <div style={{
          padding: 10, background: P.cd, color: P.ac, marginBottom: 12,
          border: `1px solid ${P.ac}`, borderRadius: 4, fontSize: 12,
        }}>
          📅 Historical view: {targetDate} (remove ?date param to return to live)
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
                     search={search} onSearchChange={setSearch} />

        <ColumnHeaders sortCol={sortCol} sortDir={sortDir} onSort={handleSortColumn} />
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
            alert={a}
            isNew={newIdsRef.current.has(a.id)}
            hitCount={ck ? (hitCounts[ck] || 1) : 1}
            currentSpot={quotes[a.ticker]}
            onClickTicker={handleClickTicker}
            onClickContract={handleClickContract}
            onClickTier={handleClickTier}
          />
        );
      })}

      {visibleAlerts.length === 0 && !error && (
        <div style={{
          padding: 30, textAlign: "center", color: P.dm,
          background: P.cd, borderRadius: 4, marginTop: 20,
        }}>
          {alerts.length === 0
            ? (status?.connected
                ? "Waiting for live flow… (markets may be closed, or no Y/M conviction yet today)"
                : "Worker idle. Check /api/massive/status or try ?date=6/26/2026 to view historical data.")
            : `No alerts match your filters. (${alerts.length} total alerts hidden)`}
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

      <div style={{
        marginTop: 30, padding: 12, color: P.mt, fontSize: 10,
        textAlign: "center", borderTop: `1px solid ${P.bd}`,
      }}>
        Source: Massive WS via FlowDB ・ {STREAM_ENABLED && !curated ? "Live stream (SSE)" : `Polling every ${POLL_INTERVAL_MS/1000}s`} ・
        TEST PAGE — sister to <a href="/live-flow" style={{ color: P.ac }}>/live-flow</a> (Bullflow)
      </div>
    </div>
      );
}
