import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import UIcon from "../components/ui/UIcon";

/**
 * LiveFlow — admin view
 *
 * Same data path as the subscriber LiveFlow.jsx, but exposes backend
 * internals: filter config banner, full counter stats (rx/shown/drop/
 * forwarded), PHASE B label, ADMIN pill, and a JSON-debug toggle that
 * dumps the latest 5 raw alerts for inspection.
 *
 * Filter rules live in api/liveflow_worker.py (TABLE_FILTER + scoring
 * tables). Edit there + redeploy to tune. The banner echoes active
 * config so you don't need to dive into code to remember what's active.
 *
 * Phase C would: editable filter UI, SQLite persistence, migration to
 * the dedicated `worker` Railway service.
 */

// ─── Palette ──────────────────────────────────────────────────────────────────
const P = {
  bg: "#0e0f0d",
  cd: "#161714",
  bd: "#2a2926",
  ac: "#c9a84c",
  bl: "#5b9bd5",
  bu: "#3cb868",
  be: "#e74c3c",
  wh: "#e8e6df",
  dm: "#a8a290",
  mt: "#6a6660",
};

const POLL_INTERVAL_MS = 5000;
const MAX_ROWS = 200;
// Use a separate LS key from the subscriber view so admin can experiment
// with chip state without disrupting the subscriber's saved preferences
// in the same browser profile.
const LS_KEY = "uct_liveflow_admin_filters_v1";

// ─── Backtest helpers ─────────────────────────────────────────────────────────
// Backtest mode is triggered by ?backtest=YYYY-MM-DD in the URL. When active:
//   - Data source switches to /api/admin/bullflow/backtest?date=...
//   - Polling is disabled (one-shot fetch)
//   - Header shows a backtest banner with date + capped warning
//   - Date picker in header changes the URL param and re-fetches
//
// Bullflow MCP caps backtest samples at 100 alerts. If we hit that ceiling,
// we surface a warning in the header so the user knows the day had more flow
// than is visible.

function formatDateForInput(d) {
  // YYYY-MM-DD in local timezone — what <input type="date"> expects.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Most recent weekday — Bullflow only has data for market days, so a Saturday
// or Sunday picker default would 404. This walks back from today to the most
// recent Mon-Fri. Doesn't account for market holidays (user can pick another date).
function mostRecentMarketDay() {
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return formatDateForInput(d);
}

// 30 days back from today, used as the date picker's min attribute.
function thirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return formatDateForInput(d);
}

function isValidBacktestDate(s) {
  if (!s || typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00");
  return !Number.isNaN(d.getTime());
}

// ─── Tier metadata + derivation ───────────────────────────────────────────────
const TIER_META = {
  mega:    { label: "Mega Whale", color: "#e74c3c", bg: "#e74c3c14" },
  whale:   { label: "Whale",      color: "#c9a84c", bg: "#c9a84c14" },
  a:       { label: "A-tier",     color: "#5b9bd5", bg: "#5b9bd514" },
  leaps:   { label: "LEAPS",      color: "#a892e0", bg: "#a892e014" },
  unusual: { label: "Unusual",    color: "#1d9e75", bg: "#1d9e7514" },
  algo:    { label: "Algo",       color: "#888780", bg: "#88878014" },
};
const TIER_ORDER = ["mega", "whale", "a", "leaps", "unusual", "algo"];

function deriveTier(alertName) {
  if (!alertName) return "algo";
  const n = alertName.toLowerCase();
  if (n.startsWith("uct mega whale")) return "mega";
  if (n.startsWith("uct whale")) return "whale";
  if (n.startsWith("uct a ")) return "a";
  if (n.startsWith("uct leaps")) return "leaps";
  if (n.startsWith("uct unusual")) return "unusual";
  return "algo";
}

// ─── Filter state helpers ─────────────────────────────────────────────────────
function defaultFilters() {
  const f = {};
  for (const t of TIER_ORDER) f[t] = true;
  return f;
}

function loadFilters() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultFilters();
    const parsed = JSON.parse(raw);
    return { ...defaultFilters(), ...parsed };
  } catch {
    return defaultFilters();
  }
}

function saveFilters(filters) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(filters)); } catch {}
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtPremium(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + Math.round(n);
}

function fmtTime(unix_or_iso) {
  if (!unix_or_iso) return "—";
  const d = typeof unix_or_iso === "number"
    ? new Date(unix_or_iso * 1000)
    : new Date(unix_or_iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function relTime(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return sec + "s ago";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  return Math.floor(sec / 3600) + "h ago";
}

// ─── Connection status pill ───────────────────────────────────────────────────
function StatusPill({ status }) {
  const connected = status?.connected;
  const err = status?.last_error;
  const lastEventAt = status?.last_event_at;
  const stale = connected && lastEventAt
    && (Date.now() - new Date(lastEventAt).getTime()) > 90_000;

  let color, label;
  if (err) { color = P.be; label = "Error"; }
  else if (!connected) { color = P.be; label = "Disconnected"; }
  else if (stale) { color = "#FFB300"; label = "Stale"; }
  else { color = P.bu; label = "Connected"; }

  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 5,
      background: color + "18", border: "1px solid " + color + "60",
      fontSize: 10, fontWeight: 700, color, letterSpacing: 0.5,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%", background: color,
        boxShadow: connected && !err ? `0 0 6px ${color}` : "none",
      }} />
      {label}
    </div>
  );
}

// ─── Filter chip row ──────────────────────────────────────────────────────────
function FilterChips({ filters, setFilters, counts }) {
  const toggle = (tier) => {
    const next = { ...filters, [tier]: !filters[tier] };
    setFilters(next);
    saveFilters(next);
  };
  const reset = () => {
    const f = defaultFilters();
    setFilters(f);
    saveFilters(f);
  };
  const allOn = TIER_ORDER.every(t => filters[t]);

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 20px",
      borderBottom: "1px solid " + P.bd + "80",
      background: P.cd + "60", alignItems: "center",
    }}>
      <span style={{
        fontSize: 9, color: P.mt, letterSpacing: 0.5,
        textTransform: "uppercase", marginRight: 4,
      }}>show</span>
      {TIER_ORDER.map(tier => {
        const meta = TIER_META[tier];
        const active = filters[tier];
        const count = counts[tier] || 0;
        return (
          <button key={tier} onClick={() => toggle(tier)} style={{
            padding: "4px 10px", borderRadius: 12, fontSize: 10, fontWeight: 700,
            border: "1px solid " + (active ? meta.color + "80" : P.bd),
            background: active ? meta.bg : "transparent",
            color: active ? meta.color : P.dm,
            cursor: "pointer", letterSpacing: 0.3,
            transition: "all 0.15s ease",
            fontFamily: "inherit",
          }}>
            {meta.label}
            <span style={{ marginLeft: 6, opacity: 0.7, fontWeight: 500 }}>{count}</span>
          </button>
        );
      })}
      <button onClick={reset} disabled={allOn} style={{
        marginLeft: "auto", padding: "4px 10px", fontSize: 9,
        color: allOn ? P.mt : P.dm,
        background: "transparent", border: "1px solid " + P.bd, borderRadius: 12,
        cursor: allOn ? "default" : "pointer", letterSpacing: 0.3,
        opacity: allOn ? 0.4 : 1, fontFamily: "inherit",
      }}>reset</button>
    </div>
  );
}

// ─── Alert row ────────────────────────────────────────────────────────────────
function AlertRow({ alert, isNew, tierColor }) {
  const isCall = alert.cp === "C";
  const cpColor = isCall ? P.bu : (alert.cp === "P" ? P.be : P.dm);
  const typeColor = alert.alertType === "algo" ? P.ac : (alert.alertType === "custom" ? P.bl : P.dm);
  const forwarded = alert.forwardedToDiscord;
  const score = alert.convictionScore;
  const flashStyle = isNew ? { animation: "uct-flash 1.4s ease-out" } : {};

  return (
    <tr style={{ borderBottom: "1px solid " + P.bd + "30", ...flashStyle }}>
      <td style={{
        padding: "8px 10px", color: P.dm, fontSize: 10,
        fontFamily: "ui-monospace, monospace",
        borderLeft: tierColor ? "3px solid " + tierColor : "none",
      }}>{fmtTime(alert.timestamp)}</td>
      <td style={{ padding: "8px 10px", fontWeight: 800, color: P.wh, fontSize: 13 }}>
        {alert.ticker || "—"}
      </td>
      <td style={{ padding: "8px 10px", fontWeight: 800, fontSize: 11 }}>
        <span style={{
          padding: "2px 8px", borderRadius: 4,
          background: cpColor + "20", color: cpColor,
        }}>{alert.cp || "—"}</span>
      </td>
      <td style={{ padding: "8px 10px", fontWeight: 700, color: P.wh, fontSize: 12 }}>
        {alert.strike != null ? "$" + alert.strike.toFixed(alert.strike >= 100 ? 0 : 2) : "—"}
      </td>
      <td style={{ padding: "8px 10px", color: P.wh, fontSize: 11 }}>{alert.exp || "—"}</td>
      <td style={{ padding: "8px 10px", color: P.dm, fontSize: 10 }}>
        {alert.dte != null ? alert.dte + "d" : "—"}
      </td>
      <td style={{
        padding: "8px 10px", fontWeight: 800, color: P.ac, fontSize: 12,
        fontFamily: "ui-monospace, monospace",
      }}>{fmtPremium(alert.alertPremium)}</td>
      <td style={{
        padding: "8px 10px", color: P.dm, fontSize: 11,
        fontFamily: "ui-monospace, monospace",
      }}>
        {alert.averageFillPrice != null ? "$" + Number(alert.averageFillPrice).toFixed(2) : "—"}
      </td>
      <td style={{ padding: "8px 10px", fontSize: 9, fontWeight: 700 }}>
        <span style={{
          padding: "2px 7px", borderRadius: 3, letterSpacing: 0.5,
          background: typeColor + "18", color: typeColor,
        }}>{(alert.alertType || "?").toUpperCase()}</span>
      </td>
      <td style={{ padding: "8px 10px", color: P.wh, fontSize: 11 }}>{alert.alertName || "—"}</td>
      <td style={{
        padding: "8px 10px", fontSize: 11, fontWeight: 800,
        fontFamily: "ui-monospace, monospace",
        color: score >= 2.0 ? P.bu : score >= 1.0 ? P.ac : P.dm, textAlign: "right",
      }}>{score != null ? score.toFixed(1) : "—"}</td>
      <td style={{ padding: "8px 10px", textAlign: "center" }}>
        {forwarded ? (
          <span title="Forwarded to Discord"
            style={{ fontSize: 11, color: P.bu, fontWeight: 800 }}><UIcon name="bell" size={11} /></span>
        ) : (
          <span style={{ color: P.mt, fontSize: 11 }}>·</span>
        )}
      </td>
    </tr>
  );
}

// ─── Tier section ─────────────────────────────────────────────────────────────
function TierSection({ tier, alerts, newIds, collapsed, onToggle }) {
  if (alerts.length === 0) return null;
  const meta = TIER_META[tier];
  return (
    <>
      <tr style={{
        background: meta.bg,
        borderTop: "1px solid " + P.bd,
        borderBottom: "1px solid " + meta.color + "30",
      }}>
        <td colSpan={12} style={{ padding: "6px 12px", cursor: "pointer" }} onClick={onToggle}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            textTransform: "uppercase", color: meta.color,
          }}>
            <span style={{ fontSize: 9 }}>{collapsed ? "▶" : "▼"}</span>
            <span>{meta.label}</span>
            <span style={{ color: P.dm, fontWeight: 500 }}>{alerts.length}</span>
          </div>
        </td>
      </tr>
      {!collapsed && alerts.map(a => (
        <AlertRow
          key={a.id || (a.symbol + ":" + a.timestamp)}
          alert={a}
          isNew={newIds.has(a.id)}
          tierColor={meta.color}
        />
      ))}
    </>
  );
}

// ─── Simulation Panel ─────────────────────────────────────────────────────────
// Renders the output of the backtest endpoint's simulate=full mode. Three views:
//   - posts: contracts that would have triggered a fresh Discord message
//   - edits: subsequent fires that would have updated an existing message
//   - gated: alerts silenced by the conviction threshold
// Stats row up top, grade distribution bars below, then the tabbed list.
function SimulationPanel({ simulation, view, setView }) {
  const s = simulation.stats || {};
  const dist = simulation.grade_distribution || {};
  // Hard-code grade order so display is consistent regardless of map order
  const GRADES = ["A+", "A", "B", "C", "D"];
  const distTotal = GRADES.reduce((sum, g) => sum + (dist[g] || 0), 0) || 1;

  // Color per grade — green for top, fading through to gray for D
  const GRADE_COLOR = {
    "A+": P.gn,
    "A": P.gn + "cc",
    "B": P.bl,
    "C": "#9aa3a8",
    "D": P.dm,
  };

  const list = view === "posts" ? simulation.would_post :
               view === "edits" ? simulation.would_edit :
               simulation.gated;
  const listLen = (list || []).length;

  return (
    <div style={{
      borderBottom: "1px solid " + P.gn + "30",
      background: P.gn + "08",
    }}>
      {/* Stats row — primary numbers from the simulation */}
      <div style={{
        padding: "12px 20px", display: "flex", gap: 22,
        alignItems: "center", flexWrap: "wrap",
        fontFamily: "ui-monospace, monospace",
      }}>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
          textTransform: "uppercase", color: P.gn,
        }}>simulated gate</span>
        <span style={{ fontSize: 12, color: P.dm }}>
          MIN_DISCORD_GRADE={" "}
          <strong style={{ color: P.wh }}>{s.min_grade || "—"}</strong>
        </span>

        {/* Big numbers */}
        <span style={{ fontSize: 12 }}>
          <strong style={{ color: P.gn, fontSize: 16 }}>{s.posts ?? 0}</strong>
          <span style={{ color: P.dm, marginLeft: 4 }}>posts</span>
        </span>
        <span style={{ fontSize: 12 }}>
          <strong style={{ color: P.bl, fontSize: 16 }}>{s.edits ?? 0}</strong>
          <span style={{ color: P.dm, marginLeft: 4 }}>edits</span>
        </span>
        <span style={{ fontSize: 12 }}>
          <strong style={{ color: P.dm, fontSize: 16 }}>{s.gated_count ?? 0}</strong>
          <span style={{ color: P.dm, marginLeft: 4 }}>gated</span>
        </span>
        <span style={{
          fontSize: 12, marginLeft: 8, padding: "3px 8px",
          background: P.gn + "20", borderRadius: 4,
        }}>
          <strong style={{ color: P.gn }}>−{s.reduction_vs_raw_pct ?? 0}%</strong>
          <span style={{ color: P.dm, marginLeft: 4 }}>vs raw</span>
        </span>

        {/* Grade distribution chips */}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {GRADES.map((g) => {
            const c = dist[g] || 0;
            if (!c) return null;
            const pct = Math.round(100 * c / distTotal);
            return (
              <span key={g} style={{
                fontSize: 10, padding: "2px 6px", borderRadius: 3,
                background: GRADE_COLOR[g] + "25",
                color: GRADE_COLOR[g],
                fontWeight: 700,
              }}>
                {g}: {c} ({pct}%)
              </span>
            );
          })}
        </span>
      </div>

      {/* Tab strip — switch between posts/edits/gated lists */}
      <div style={{
        padding: "0 20px", display: "flex", gap: 4,
        borderBottom: "1px solid " + P.bd + "30",
      }}>
        {[
          ["posts", "would post", s.posts ?? 0, P.gn],
          ["edits", "would edit", s.edits ?? 0, P.bl],
          ["gated", "gated", s.gated_count ?? 0, P.dm],
        ].map(([k, label, count, color]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            style={{
              padding: "8px 14px", border: "none",
              borderBottom: "2px solid " + (view === k ? color : "transparent"),
              background: "transparent",
              color: view === k ? P.wh : P.dm,
              cursor: "pointer", fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              textTransform: "uppercase", letterSpacing: 0.5,
            }}
          >
            {label}{" "}
            <span style={{ color: view === k ? color : P.dm }}>
              ({count})
            </span>
          </button>
        ))}
      </div>

      {/* Tabbed list — chronological. Each row shows ticker, contract, key
          stats, and conviction grade. Compact monospace for scannability. */}
      <div style={{
        maxHeight: 320, overflowY: "auto",
        fontFamily: "ui-monospace, monospace", fontSize: 11,
      }}>
        {listLen === 0 ? (
          <div style={{ padding: 20, color: P.dm, fontSize: 11 }}>
            No alerts in this view.
          </div>
        ) : (
          (list || []).map((r, i) => (
            <SimRow key={i} row={r} view={view} />
          ))
        )}
      </div>
    </div>
  );
}

// Compact row for the simulation list. Highlights premium, fires, and grade.
function SimRow({ row, view }) {
  const t = row.ticker || "?";
  const cp = row.cp || "";
  const strike = row.strike;
  const exp = row.exp || "";
  const prem = row.agg_total_premium || row.alertPremium || 0;
  const fires = row.agg_fire_count || 1;
  const grade = row.conviction_grade || "—";
  const alertName = (row.alertName || "").replace(/\s+\+\d+ more$/, "");

  // Try to display the timestamp as HH:MM ET (timestamps come in ISO with TZ
  // offset). Fall back to raw if parsing fails.
  let timeStr = "?";
  try {
    const d = new Date(row.timestamp);
    timeStr = d.toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York",
    });
  } catch {}

  const gradeColor =
    grade.startsWith("A+") ? P.gn :
    grade.startsWith("A")  ? P.gn + "cc" :
    grade.startsWith("B")  ? P.bl :
    grade.startsWith("C")  ? "#9aa3a8" : P.dm;

  return (
    <div style={{
      padding: "6px 20px", display: "flex", gap: 14,
      alignItems: "center", borderBottom: "1px solid " + P.bd + "20",
    }}>
      <span style={{ color: P.dm, minWidth: 50 }}>{timeStr}</span>
      <span style={{
        color: P.wh, fontWeight: 700, minWidth: 60,
      }}>{t}</span>
      <span style={{
        color: cp === "C" ? P.gn : P.rd, minWidth: 40, fontWeight: 600,
      }}>{cp === "C" ? "CALL" : cp === "P" ? "PUT " : cp}</span>
      <span style={{ color: P.wh, minWidth: 70 }}>${strike}</span>
      <span style={{ color: P.dm, minWidth: 95 }}>{exp}</span>
      <span style={{ color: P.wh, minWidth: 75 }}>
        {fmtPremium(prem)}
      </span>
      {fires > 1 && (
        <span style={{
          color: "#FFB300", fontWeight: 700, minWidth: 30,
        }}><UIcon name="refresh" size={11} style={{ verticalAlign: '-2px', marginRight: 3 }} />{fires}x</span>
      )}
      <span style={{
        marginLeft: "auto", color: gradeColor,
        fontWeight: 800, fontSize: 12,
      }}>{grade}</span>
      <span style={{ color: P.dm, minWidth: 150, fontSize: 10 }}>
        {alertName}
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function LiveFlowAdmin() {
  const [searchParams, setSearchParams] = useSearchParams();
  const backtestDate = searchParams.get("backtest");
  const isBacktest = isValidBacktestDate(backtestDate);

  // ─── Simulation mode (admin backtest only) ─────────────────────────────
  // URL params drive simulation so links are bookmarkable. When `simulate=full`,
  // the backtest endpoint runs the full pipeline (enrich → aggregate → gate)
  // and returns a `simulation` block alongside raw alerts. min_grade and
  // exclude_etf are passthrough params for tuning.
  const simulateMode = isBacktest && searchParams.get("simulate") === "full";
  const simMinGrade = (searchParams.get("min_grade") || "B").toUpperCase();
  const simExcludeETF = searchParams.get("exclude_etf") === "true";

  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState(null);
  const [simulation, setSimulation] = useState(null);  // simulation block from backtest
  const [simView, setSimView] = useState("posts");     // "posts" | "edits" | "gated"
  const [uploadedFile, setUploadedFile] = useState(null);  // JSON file for JSON-mode backtest
  const [uploadError, setUploadError] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [filters, setFilters] = useState(loadFilters);
  const [collapsedTiers, setCollapsedTiers] = useState({});
  const [showDebug, setShowDebug] = useState(false);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const lastIdRef = useRef(null);
  const newIdsRef = useRef(new Set());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Data fetch — branches on isBacktest. Live mode = polling loop; backtest =
  // one-shot fetch keyed on the date query param.
  useEffect(() => {
    let abort = null;
    let timer = null;
    let cancelled = false;

    async function fetchBacktestFromJSON() {
      // JSON-sourced backtest. Uploaded file POST'd to a separate endpoint
      // that parses Discord embeds and runs the same simulator. Re-fired
      // whenever simulation params change so the user can tune thresholds
      // without re-uploading. Browser keeps the File object alive in state
      // until they refresh or pick another.
      setBacktestLoading(true);
      setAlerts([]);
      setStatus(null);
      setSimulation(null);
      setError(null);
      try {
        abort = new AbortController();
        const fd = new FormData();
        fd.append("file", uploadedFile);
        const params = new URLSearchParams({
          min_grade: simMinGrade,
        });
        if (simExcludeETF) params.set("exclude_etf_flow", "true");
        const r = await fetch(
          `/api/admin/bullflow/backtest-from-json?${params.toString()}`,
          { method: "POST", body: fd, signal: abort.signal }
        );
        if (!r.ok) {
          const errBody = await r.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${r.status}`);
        }
        const d = await r.json();
        if (cancelled) return;
        newIdsRef.current = new Set();
        lastIdRef.current = (d.alerts || [])[0]?.id || null;
        setAlerts(d.alerts || []);
        setStatus(d.status);
        setSimulation(d.simulation || null);
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setBacktestLoading(false);
      }
    }

    async function fetchBacktest() {
      setBacktestLoading(true);
      setAlerts([]);
      setStatus(null);
      setSimulation(null);
      setError(null);
      try {
        abort = new AbortController();
        // Build URL with simulation params when requested. Backtest endpoint
        // defaults to simulate=off so adding the param explicitly is needed
        // to trigger the full pipeline run. min_grade and exclude_etf_flow
        // are forwarded as tuning knobs.
        const params = new URLSearchParams({
          date: backtestDate,
          max_alerts: "500",
        });
        if (simulateMode) {
          params.set("simulate", "full");
          params.set("min_grade", simMinGrade);
          if (simExcludeETF) params.set("exclude_etf_flow", "true");
        }
        const url = `/api/admin/bullflow/backtest?${params.toString()}`;
        const r = await fetch(url, { signal: abort.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        const incoming = d.alerts || [];
        // No flash detection in backtest mode — all rows are "new" from user's POV
        newIdsRef.current = new Set();
        lastIdRef.current = incoming[0]?.id || null;
        setAlerts(incoming);
        setStatus(d.status);
        // simulation may be null (when simulate=off) or contain the full block.
        // Surface any simulator-side error inline so user knows it failed
        // without breaking the regular alert list display.
        setSimulation(d.simulation || null);
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setBacktestLoading(false);
      }
    }

    async function poll() {
      try {
        abort = new AbortController();
        const r = await fetch(`/api/live/alerts/recent?limit=${MAX_ROWS}`, { signal: abort.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        if (cancelled) return;
        const incoming = d.alerts || [];
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

    if (isBacktest && uploadedFile) {
      // JSON-sourced backtest takes precedence over MCP when a file is loaded.
      // Conviction simulation auto-enabled in this mode since the whole point
      // of uploading is to see the simulator output.
      fetchBacktestFromJSON();
    } else if (isBacktest) {
      fetchBacktest();
    } else {
      poll();
    }
    return () => {
      cancelled = true;
      if (abort) abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [isBacktest, backtestDate, simulateMode, simMinGrade, simExcludeETF, uploadedFile]);

  const byTier = {};
  for (const t of TIER_ORDER) byTier[t] = [];
  for (const a of alerts) byTier[deriveTier(a.alertName)].push(a);
  const counts = Object.fromEntries(TIER_ORDER.map(t => [t, byTier[t].length]));
  const visibleTotal = TIER_ORDER.reduce(
    (sum, t) => filters[t] ? sum + byTier[t].length : sum, 0
  );

  return (
    <div style={{
      minHeight: "100vh", background: P.bg, color: P.wh,
      fontFamily: "Inter, system-ui, sans-serif",
      display: "flex", flexDirection: "column",
    }}>
      <style>{`
        @keyframes uct-flash {
          0%   { background: ${P.ac}22; }
          100% { background: transparent; }
        }
      `}</style>

      {/* Header — admin view with PHASE B label + ADMIN pill */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px", borderBottom: "1px solid " + P.bd,
        background: P.cd, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link to="/dashboard" style={{
            color: P.dm, fontSize: 11, textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>← Dashboard</Link>
          <div style={{ height: 16, width: 1, background: P.bd }} />
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: P.ac, letterSpacing: 0.5 }}>
              LIVE FLOW
            </span>
            <span style={{
              fontSize: 9, padding: "2px 6px", borderRadius: 3,
              background: P.be + "20", color: P.be, fontWeight: 800,
              letterSpacing: 0.5,
            }}>ADMIN</span>
            {isBacktest ? (
              <span style={{
                fontSize: 9, padding: "2px 6px", borderRadius: 3,
                background: P.bl + "20", color: P.bl, fontWeight: 800,
                letterSpacing: 0.5,
              }}>BACKTEST · {backtestDate}</span>
            ) : (
              <span style={{ fontSize: 9, color: P.mt, letterSpacing: 0.5 }}>
                PHASE B · FILTER ENGINE v1 · DISCORD FORWARDING ACTIVE
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Backtest controls — date picker + exit-to-live button */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 8px", borderRadius: 4,
            border: "1px solid " + (isBacktest ? P.bl + "60" : P.bd),
            background: isBacktest ? P.bl + "10" : "transparent",
          }}>
            <span style={{
              fontSize: 9, color: isBacktest ? P.bl : P.mt, fontWeight: 700,
              letterSpacing: 0.5, textTransform: "uppercase",
            }}>{isBacktest ? "replay" : "backtest"}</span>
            <input
              type="date"
              value={isBacktest ? backtestDate : mostRecentMarketDay()}
              min={thirtyDaysAgo()}
              max={formatDateForInput(new Date())}
              onChange={(e) => {
                const v = e.target.value;
                if (isValidBacktestDate(v)) {
                  setSearchParams({ backtest: v });
                }
              }}
              style={{
                fontSize: 10, padding: "2px 4px",
                background: P.bg, color: P.wh,
                border: "1px solid " + P.bd, borderRadius: 3,
                fontFamily: "ui-monospace, monospace",
                colorScheme: "dark",  // makes the native date picker render in dark mode
              }}
            />
            {isBacktest && (
              <button
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("backtest");
                  setSearchParams(next);
                }}
                title="Exit backtest, return to live"
                style={{
                  fontSize: 9, padding: "2px 6px", fontWeight: 700,
                  letterSpacing: 0.5,
                  background: "transparent", color: P.dm,
                  border: "1px solid " + P.bd, borderRadius: 3,
                  cursor: "pointer", fontFamily: "inherit",
                }}>× live</button>
            )}
          </div>
          <StatusPill status={status} />
          {status && (
            <div style={{
              fontSize: 10, color: P.dm,
              fontFamily: "ui-monospace, monospace",
              display: "flex", gap: 10,
            }}>
              <span title="Total received from Bullflow (pre-filter)">
                rx <strong style={{ color: P.wh }}>{status.total_alerts_received}</strong>
              </span>
              <span title="Passed table filter, visible in table">
                shown <strong style={{ color: P.wh }}>{status.total_alerts_shown ?? 0}</strong>
              </span>
              <span title="Filtered out (below $250K, blocklist, or grenade)">
                drop <strong style={{ color: P.dm }}>{status.total_alerts_dropped ?? 0}</strong>
              </span>
              <span title="Forwarded to Discord (conviction >= 2.0)">
                <UIcon name="bell" size={10} style={{ verticalAlign: '-1px', marginRight: 4 }} /><strong style={{ color: P.bu }}>{status.total_alerts_forwarded ?? 0}</strong>
              </span>
              <span style={{ color: P.mt }}>· last {relTime(status.last_event_at)}</span>
            </div>
          )}
          <button onClick={() => setShowDebug(d => !d)} style={{
            padding: "4px 10px", fontSize: 9, fontWeight: 700,
            letterSpacing: 0.5, textTransform: "uppercase",
            color: showDebug ? P.ac : P.dm,
            background: showDebug ? P.ac + "18" : "transparent",
            border: "1px solid " + (showDebug ? P.ac + "60" : P.bd),
            borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
          }}>{showDebug ? "Hide" : "Show"} JSON</button>
        </div>
      </div>

      {/* Filter chips */}
      <FilterChips filters={filters} setFilters={setFilters} counts={counts} />

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Backtest banner — only shown when in backtest mode */}
        {isBacktest && (
          <div style={{
            padding: "10px 20px", borderBottom: "1px solid " + P.bl + "30",
            background: P.bl + "10", fontSize: 11, color: P.bl,
            display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap",
            fontFamily: "ui-monospace, monospace",
          }}>
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
              textTransform: "uppercase",
            }}>backtest dry-run</span>
            <span style={{ color: P.dm }}>
              Replaying <strong style={{ color: P.wh }}>{backtestDate}</strong> against saved custom alerts
              {backtestLoading && " · loading…"}
            </span>

            {/* Simulation controls — opt-in via "simulate" toggle. When on,
                threshold + ETF-exclusion controls become editable. */}
            <span style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 12 }}>
              <button
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  if (simulateMode) {
                    next.delete("simulate");
                    next.delete("min_grade");
                    next.delete("exclude_etf");
                  } else {
                    next.set("simulate", "full");
                    next.set("min_grade", "B");
                  }
                  setSearchParams(next);
                }}
                style={{
                  padding: "3px 10px", fontSize: 10, borderRadius: 4,
                  border: "1px solid " + (simulateMode ? P.gn : P.bd),
                  background: simulateMode ? P.gn + "20" : "transparent",
                  color: simulateMode ? P.gn : P.dm,
                  cursor: "pointer", letterSpacing: 0.5,
                  textTransform: "uppercase", fontWeight: 700,
                }}
                title="Run the full live pipeline (enrich → aggregate → conviction → gate) to see what would have posted to Discord"
              >
                {simulateMode ? <><UIcon name="check" size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />simulate gate</> : "simulate gate"}
              </button>

              {/* JSON upload — sidesteps Bullflow MCP using a Discord export.
                  When a file is loaded, the simulation auto-runs and the UI
                  shows what the gate would do for that day's alerts. */}
              <label
                style={{
                  padding: "3px 10px", fontSize: 10, borderRadius: 4,
                  border: "1px solid " + (uploadedFile ? P.gn : P.bd),
                  background: uploadedFile ? P.gn + "20" : "transparent",
                  color: uploadedFile ? P.gn : P.dm,
                  cursor: "pointer", letterSpacing: 0.5,
                  textTransform: "uppercase", fontWeight: 700,
                }}
                title="Upload a DiscordChatExporter JSON of your live-flow channel to backtest against captured Discord posts (bypasses Bullflow MCP)"
              >
                {uploadedFile ? <><UIcon name="check" size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />{`${uploadedFile.name.slice(0, 18)}…`}</> : "upload json"}
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 50 * 1024 * 1024) {  // 50 MB hard cap, prevents accidents
                      setUploadError("File too large (>50MB)");
                      return;
                    }
                    setUploadError(null);
                    setUploadedFile(f);
                    // Auto-enable simulate mode on upload — viewing raw alerts
                    // without the simulation defeats the purpose of uploading.
                    const next = new URLSearchParams(searchParams);
                    if (!next.get("simulate")) {
                      next.set("simulate", "full");
                      next.set("min_grade", "B");
                      setSearchParams(next);
                    }
                  }}
                />
              </label>

              {uploadedFile && (
                <button
                  onClick={() => {
                    setUploadedFile(null);
                    setUploadError(null);
                  }}
                  style={{
                    padding: "3px 8px", fontSize: 10, borderRadius: 4,
                    border: "1px solid " + P.bd, background: "transparent",
                    color: P.dm, cursor: "pointer",
                  }}
                  title="Clear uploaded file and return to MCP-sourced backtest"
                >
                  ×
                </button>
              )}

              {simulateMode && (
                <>
                  <label style={{ color: P.dm, fontSize: 10 }}>min grade:</label>
                  <select
                    value={simMinGrade}
                    onChange={(e) => {
                      const next = new URLSearchParams(searchParams);
                      next.set("min_grade", e.target.value);
                      setSearchParams(next);
                    }}
                    style={{
                      padding: "2px 6px", fontSize: 10, borderRadius: 3,
                      background: P.cd, color: P.wh,
                      border: "1px solid " + P.bd, cursor: "pointer",
                    }}
                  >
                    {["A+", "A", "B", "C", "D"].map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>

                  <label
                    style={{
                      color: simExcludeETF ? P.wh : P.dm, fontSize: 10,
                      display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={simExcludeETF}
                      onChange={(e) => {
                        const next = new URLSearchParams(searchParams);
                        if (e.target.checked) next.set("exclude_etf", "true");
                        else next.delete("exclude_etf");
                        setSearchParams(next);
                      }}
                      style={{ accentColor: P.gn, cursor: "pointer" }}
                    />
                    exclude ETF Flow
                  </label>
                </>
              )}
            </span>

            {status?.backtest_capped && (
              <span style={{ color: "#FFB300", marginLeft: "auto" }}>
                <UIcon name="warning" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />capped at 500 alerts (Bullflow MCP limit) — day had more flow than visible
              </span>
            )}
            {!backtestLoading && !status?.backtest_capped && alerts.length > 0 && !simulateMode && (
              <span style={{ color: P.dm, marginLeft: "auto" }}>
                {alerts.length} alert{alerts.length !== 1 ? "s" : ""} returned · no Discord forwarding
              </span>
            )}
          </div>
        )}

        {/* Simulation results panel — appears below banner when sim is active
            and the backend returned a simulation block. Shows stats + grade
            distribution + tab buttons to switch between posts/edits/gated. */}
        {isBacktest && simulateMode && simulation && !simulation.error && (
          <SimulationPanel
            simulation={simulation}
            view={simView}
            setView={setSimView}
          />
        )}
        {isBacktest && simulateMode && simulation?.error && (
          <div style={{
            padding: "12px 20px", background: P.rd + "20",
            borderBottom: "1px solid " + P.rd + "40", color: P.rd,
            fontSize: 12, fontFamily: "ui-monospace, monospace",
          }}>
            simulation failed: {simulation.error}
          </div>
        )}
        {uploadError && (
          <div style={{
            padding: "12px 20px", background: P.rd + "20",
            borderBottom: "1px solid " + P.rd + "40", color: P.rd,
            fontSize: 12, fontFamily: "ui-monospace, monospace",
          }}>
            upload error: {uploadError}
          </div>
        )}

        {/* Filter config banner — admin only */}
        {status?.filter_config && (
          <div style={{
            padding: "8px 20px", borderBottom: "1px solid " + P.bd + "40",
            background: P.cd + "80", fontSize: 10, color: P.dm,
            display: "flex", gap: 14, alignItems: "center",
            fontFamily: "ui-monospace, monospace",
          }}>
            <span style={{
              color: P.mt, letterSpacing: 0.5,
              textTransform: "uppercase", fontSize: 9,
            }}>backend filter</span>
            <span>premium ≥ <strong style={{ color: P.wh }}>
              ${(status.filter_config.premium_min / 1000).toFixed(0)}K
            </strong></span>
            <span>· blocklist: <strong style={{ color: P.wh }}>
              {(status.filter_config.ticker_blocklist || []).join(", ") || "none"}
            </strong></span>
            <span>· skip: <strong style={{ color: P.wh }}>
              {(status.filter_config.alertname_block_substrings || []).join(", ") || "none"}
            </strong></span>
            <span style={{ marginLeft: "auto" }}>discord ≥ <strong style={{ color: P.bu }}>
              {status.filter_config.discord_threshold}
            </strong> conviction</span>
            {!status.discord_configured && (
              <span style={{ color: "#FFB300" }}><UIcon name="warning" size={10} style={{ verticalAlign: '-1px', marginRight: 4 }} />webhook not configured</span>
            )}
          </div>
        )}

        {/* Debug JSON panel */}
        {showDebug && (
          <div style={{
            padding: "10px 20px", borderBottom: "1px solid " + P.bd + "40",
            background: P.bg, fontSize: 10, color: P.dm,
            fontFamily: "ui-monospace, monospace",
            maxHeight: 240, overflow: "auto",
          }}>
            <div style={{
              fontSize: 9, color: P.mt, letterSpacing: 0.5,
              textTransform: "uppercase", marginBottom: 6,
            }}>raw payload — latest 5 alerts</div>
            <pre style={{ margin: 0, fontSize: 10, color: P.wh, lineHeight: 1.4 }}>
              {JSON.stringify(alerts.slice(0, 5), null, 2)}
            </pre>
          </div>
        )}

        {error && (
          <div style={{
            padding: "10px 20px", background: P.be + "18",
            borderBottom: "1px solid " + P.be + "60",
            color: P.be, fontSize: 11,
          }}>Polling error: {error}</div>
        )}

        {status && !status.connected && status.last_error && (
          <div style={{
            padding: "12px 20px", background: P.be + "10",
            borderBottom: "1px solid " + P.be + "40",
            color: P.be, fontSize: 11,
          }}>
            <strong>Backend reports disconnected:</strong> {status.last_error}
            <span style={{ color: P.dm, marginLeft: 8 }}>
              · reconnect attempts: {status.reconnect_count}
            </span>
          </div>
        )}

        {alerts.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: "60px 20px", color: P.dm, gap: 8,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>
              {isBacktest
                ? (backtestLoading ? "Running backtest replay…" : "No alerts for " + backtestDate)
                : (status?.connected ? "Connected, waiting for alerts…" : "Connecting to stream…")}
            </div>
            <div style={{ fontSize: 10, color: P.mt }}>
              {isBacktest
                ? (backtestLoading
                    ? "Bullflow sample replay can take up to 2 minutes."
                    : "Either the market was quiet that day or it was a non-trading day.")
                : "Bullflow algo alerts fire on unusual activity. Quiet stretches are normal."}
            </div>
            {!isBacktest && status?.started_at && (
              <div style={{
                fontSize: 9, color: P.mt, marginTop: 8,
                fontFamily: "ui-monospace, monospace",
              }}>worker started {relTime(status.started_at)}</div>
            )}
          </div>
        ) : visibleTotal === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: "60px 20px", color: P.dm, gap: 8,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>
              All tiers filtered out
            </div>
            <div style={{ fontSize: 10, color: P.mt }}>
              {alerts.length} alert{alerts.length !== 1 ? "s" : ""} hidden by chip filters above. Click chips to show.
            </div>
          </div>
        ) : (
          <table style={{
            width: "100%", borderCollapse: "collapse",
            fontFamily: "Inter, system-ui, sans-serif",
          }}>
            <thead style={{ position: "sticky", top: 0, background: P.cd, zIndex: 1 }}>
              <tr style={{ borderBottom: "1px solid " + P.bd }}>
                {[
                  ["Time", 10], ["Ticker", 13], ["C/P", 11], ["Strike", 12],
                  ["Exp", 11], ["DTE", 10], ["Premium", 12], ["Avg Fill", 11],
                  ["Type", 9], ["Alert Name", 11], ["Score", 11], ["🔔", 11],
                ].map(([label]) => (
                  <th key={label} style={{
                    padding: "8px 10px",
                    textAlign: label === "Score" ? "right" : (label === "🔔" ? "center" : "left"),
                    color: P.dm, fontSize: 9, fontWeight: 700,
                    letterSpacing: 0.5, textTransform: "uppercase",
                  }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIER_ORDER.map(tier => filters[tier] && (
                <TierSection
                  key={tier}
                  tier={tier}
                  alerts={byTier[tier]}
                  newIds={newIdsRef.current}
                  collapsed={!!collapsedTiers[tier]}
                  onToggle={() => setCollapsedTiers(c => ({ ...c, [tier]: !c[tier] }))}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "8px 20px", borderTop: "1px solid " + P.bd,
        background: P.cd, fontSize: 9, color: P.mt,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontFamily: "ui-monospace, monospace", flexShrink: 0,
      }}>
        <div>
          {isBacktest
            ? `backtest /api/admin/bullflow/backtest?date=${backtestDate} · one-shot · no polling`
            : `polling /api/live/alerts/recent every ${POLL_INTERVAL_MS / 1000}s · buffer max ${MAX_ROWS}`}
        </div>
        <div>
          {visibleTotal > 0 && "showing " + visibleTotal + " of " + alerts.length + " · "}
          updated {relTime(new Date(now).toISOString())}
        </div>
      </div>
    </div>
  );
}
