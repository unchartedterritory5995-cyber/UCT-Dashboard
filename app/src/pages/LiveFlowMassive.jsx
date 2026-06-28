import { useEffect, useRef, useState } from "react";
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
  cd: "#161714",
  bd: "#2a2926",
  ac: "#c9a84c",
  bl: "#5b9bd5",
  bu: "#4F8266",
  be: "#8F4F4F",
  wh: "#e8e6df",
  dm: "#a8a290",
  mt: "#6a6660",
};

const POLL_INTERVAL_MS = 5000;
const MAX_ROWS = 200;

// ─── Tier metadata (matches LiveFlow.jsx) ─────────────────────────────────
// Two extra keys vs LiveFlow.jsx: "bearish" is its own tier in our endpoint
// because PUT-bought-on-ASK and CALL-sold-on-BID both produce bear-direction
// alerts (the backend resolves direction from Side+CP so we get this for free).
// LiveFlow.jsx merges bearish into a separate tier by alertName parsing —
// we just use _tierKey from the response directly.
const TIER_META = {
  alpha:   { label: "Alpha Gold", color: "#FFD93B", bg: "#FFD93B14" },
  size:    { label: "Size",       color: "#c9a84c", bg: "#c9a84c14" },
  bullish: { label: "Bullish",    color: "#4F8266", bg: "#4F826614" },
  bearish: { label: "Bearish",    color: "#8F4F4F", bg: "#8F4F4F14" },
  leaps:   { label: "LEAPS",      color: "#6E5FA0", bg: "#6E5FA014" },
  unusual: { label: "Unusual",    color: "#4A7290", bg: "#4A729014" },
  algo:    { label: "Algo",       color: "#6B6B72", bg: "#6B6B7214" },
};
const TIER_ORDER = ["alpha", "size", "bullish", "bearish", "leaps", "unusual", "algo"];

// ─── localStorage keys ────────────────────────────────────────────────────
const LS_KEY_FILTERS = "uct_liveflow_massive_filters_v1";
const LS_KEY_SORT    = "uct_liveflow_massive_sort_v1";
const LS_KEY_MINGRADE= "uct_liveflow_massive_mingrade_v1";

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

// ─── Filter chips ─────────────────────────────────────────────────────────
function FilterChips({ filters, onChange, counts }) {
  const allOn = TIER_ORDER.every(t => filters[t]);
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      padding: "8px 0", marginBottom: 12, borderBottom: `1px solid ${P.bd}`,
    }}>
      <span style={{ color: P.dm, fontSize: 11, marginRight: 4 }}>Show:</span>
      <button
        onClick={() => {
          const next = {};
          for (const t of TIER_ORDER) next[t] = !allOn;
          onChange(next);
        }}
        style={{
          background: allOn ? P.ac : "transparent",
          color: allOn ? P.bg : P.wh,
          border: `1px solid ${P.bd}`, borderRadius: 4,
          padding: "4px 10px", cursor: "pointer", fontSize: 12,
        }}
      >
        {allOn ? "All ✓" : "Show all"}
      </button>
      {TIER_ORDER.map(tier => {
        const meta = TIER_META[tier];
        const on = filters[tier];
        const count = counts?.[tier] || 0;
        return (
          <button
            key={tier}
            onClick={() => {
              const next = { ...filters, [tier]: !on };
              onChange(next);
            }}
            style={{
              background: on ? meta.color : "transparent",
              color: on ? P.bg : P.wh,
              border: `1px solid ${meta.color}`, borderRadius: 4,
              padding: "4px 10px", cursor: "pointer", fontSize: 12,
              opacity: on ? 1 : 0.5,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {meta.label}
            {count > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 600,
                padding: "1px 5px", borderRadius: 8,
                background: on ? `${P.bg}80` : `${meta.color}30`,
                color: on ? P.bg : meta.color,
              }}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Single row ───────────────────────────────────────────────────────────
function AlertRow({ alert, isNew, onClickTicker, onClickContract }) {
  const tier = alert._tierKey || "algo";
  const meta = TIER_META[tier];
  const isCall = alert.cp === "C";
  const dirIsBull = alert._direction === "Bull";
  const cpColor = dirIsBull ? P.bu : P.be;

  const flashStyle = isNew ? {
    animation: "flashRow 1.5s ease-out",
  } : {};

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "85px 60px 50px 70px 95px 90px 75px 85px 65px 1fr",
      gap: 6, padding: "6px 10px",
      borderLeft: `3px solid ${meta.color}`,
      background: P.cd, marginBottom: 2, fontSize: 12,
      ...flashStyle,
    }}>
      <span style={{ color: P.dm }}>{fmtTime(alert.timestamp)}</span>
      <span
        style={{ color: P.wh, fontWeight: 600, cursor: "pointer" }}
        onClick={() => onClickTicker(alert.ticker)}
        title={`Filter to ${alert.ticker}`}
      >
        {alert.ticker}
      </span>
      <span style={{ color: cpColor, fontWeight: 600, textAlign: "center" }}>
        {alert.cp || "—"}
      </span>
      <span
        style={{ color: cpColor, textAlign: "right", cursor: "pointer" }}
        onClick={() => {
          if (alert.cp && alert.strike != null && alert.exp) {
            onClickContract(`${alert.ticker}|${alert.cp}|${alert.strike}|${alert.exp}`);
          }
        }}
        title={alert.cp && alert.strike != null ? `Filter to ${alert.ticker} ${alert.cp} ${fmtStrike(alert.strike)} ${alert.exp}` : ""}
      >
        {fmtStrike(alert.strike)}
      </span>
      <span style={{ color: P.dm, fontSize: 11 }}>{alert.exp || "—"}</span>
      <span style={{ color: P.wh, fontWeight: 600, textAlign: "right" }}>
        {fmtPremium(alert.alertPremium)}
      </span>
      <span style={{
        color: alert.grade?.startsWith("A") ? P.ac :
               alert.grade === "B" ? P.bl :
               alert.grade === "C" ? P.dm : P.mt,
        fontWeight: 600, textAlign: "center",
      }}>
        {alert.grade}
      </span>
      <span style={{ color: P.dm, fontSize: 11, textAlign: "center" }}>
        {alert.volumeOIRatio ? `${alert.volumeOIRatio.toFixed(1)}x` : "—"}
      </span>
      <span style={{ color: P.dm, fontSize: 11, textAlign: "center" }}>
        {alert._side || "—"}
      </span>
      <span style={{ color: meta.color, fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
          padding: "1px 5px", borderRadius: 3,
          background: `${meta.color}25`, color: meta.color,
          textTransform: "uppercase", flexShrink: 0,
        }}>{meta.label}</span>
        <span style={{ color: P.dm }}>{alert.alertName}</span>
      </span>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────
function Header({ status, sortBy, onSortChange, minGrade, onMinGradeChange,
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

        <label style={{ color: P.dm, fontSize: 12 }}>Sort:</label>
        {["recent", "conviction", "premium"].map(opt => (
          <button
            key={opt}
            onClick={() => onSortChange(opt)}
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
          <span style={{
            fontSize: 11,
            color: oiFetchState.result.error ? P.be : P.bu,
          }}>
            {oiFetchState.result.error
              ? `error: ${oiFetchState.result.error}`
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
function ColumnHeaders() {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "85px 60px 50px 70px 95px 90px 75px 85px 65px 1fr",
      gap: 6, padding: "4px 10px",
      fontSize: 10, color: P.mt, fontWeight: 600, letterSpacing: 0.5,
      borderBottom: `1px solid ${P.bd}`, marginBottom: 4,
    }}>
      <span>TIME</span>
      <span>TICKER</span>
      <span style={{ textAlign: "center" }}>C/P</span>
      <span style={{ textAlign: "right" }}>STRIKE</span>
      <span>EXP</span>
      <span style={{ textAlign: "right" }}>PREMIUM</span>
      <span style={{ textAlign: "center" }}>GRADE</span>
      <span style={{ textAlign: "center" }}>V/OI</span>
      <span style={{ textAlign: "center" }}>SIDE</span>
      <span>ALERT</span>
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
  const [tickerFilter, setTickerFilter] = useState(new Set());
  const [contractFilter, setContractFilter] = useState(new Set());
  // OI fetch state: { loading: bool, result: "filled X of Y" | error }
  const [oiFetchState, setOiFetchState] = useState({ loading: false, result: null });
  const lastIdRef = useRef(null);
  const newIdsRef = useRef(new Set());

  // Persist controls
  useEffect(() => { saveFilters(filters); }, [filters]);
  useEffect(() => { localStorage.setItem(LS_KEY_SORT, sortBy); }, [sortBy]);
  useEffect(() => { localStorage.setItem(LS_KEY_MINGRADE, minGrade); }, [minGrade]);

  // Polling
  useEffect(() => {
    let cancelled = false;
    let timer;
    let abort;

    async function poll() {
      try {
        abort = new AbortController();
        const params = new URLSearchParams({
          limit: String(MAX_ROWS),
          sort_by: sortBy,
          min_grade: minGrade,
        });
        if (targetDate) params.set("target_date", targetDate);
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
        setAlerts(incoming);
        setStatus(d.status);
        setError(null);
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (abort) abort.abort();
    };
  }, [sortBy, minGrade, targetDate]);

  // Apply client-side filters: tier chips, ticker, contract.
  // Tier filtering now happens here (was previously per-section); the
  // remaining list goes straight into the flat chronological feed.
  const visibleAlerts = alerts.filter(a => {
    const tier = a._tierKey || "algo";
    if (!filters[tier]) return false;
    if (tickerFilter.size > 0 && !tickerFilter.has(a.ticker)) return false;
    if (contractFilter.size > 0) {
      const k = `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`;
      if (!contractFilter.has(k)) return false;
    }
    return true;
  });

  // Per-tier counts (for filter chip badges). Built from ALL alerts that
  // pass the ticker/contract filter — independent of which tiers are toggled
  // on — so the badges always show "if you turned this on, here's how many
  // alerts you'd see".
  const tierCounts = {};
  for (const t of TIER_ORDER) tierCounts[t] = 0;
  for (const a of alerts) {
    if (tickerFilter.size > 0 && !tickerFilter.has(a.ticker)) continue;
    if (contractFilter.size > 0) {
      const k = `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`;
      if (!contractFilter.has(k)) continue;
    }
    const t = a._tierKey || "algo";
    if (tierCounts[t] !== undefined) tierCounts[t]++;
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
      const CHUNK = 100;  // backend cap matches LiveFlow.jsx pattern
      for (let i = 0; i < contracts.length; i += CHUNK) {
        const chunk = contracts.slice(i, i + CHUNK);
        const r = await fetch("/api/oi-snapshot/bulk-fetch", {
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

      setOiFetchState({
        loading: false,
        result: { filled: filledKeys.size, total: contracts.length },
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
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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

      <FilterChips filters={filters} onChange={setFilters} counts={tierCounts} />

      <ColumnHeaders />

      {/* Flat feed — alerts in their natural sort order (recent/conviction/premium).
          Tier is indicated by the colored left border on each row, and the
          filter chips above control which tiers appear in this flat list.
          This replaces the earlier tier-grouped layout (which was useful for
          end-of-day analysis but less suited for live tape-style viewing). */}
      {visibleAlerts.map(a => (
        <AlertRow
          key={a.id}
          alert={a}
          isNew={newIdsRef.current.has(a.id)}
          onClickTicker={handleClickTicker}
          onClickContract={handleClickContract}
        />
      ))}

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
          {alerts.length === MAX_ROWS && ` (limit ${MAX_ROWS})`}
        </div>
      )}

      <div style={{
        marginTop: 30, padding: 12, color: P.mt, fontSize: 10,
        textAlign: "center", borderTop: `1px solid ${P.bd}`,
      }}>
        Source: Massive WS via FlowDB ・ Polling every {POLL_INTERVAL_MS/1000}s ・
        TEST PAGE — sister to <a href="/live-flow" style={{ color: P.ac }}>/live-flow</a> (Bullflow)
      </div>
    </div>
  );
}
