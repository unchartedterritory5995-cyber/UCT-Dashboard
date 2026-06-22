import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import UIcon from "../components/ui/UIcon";

/**
 * LiveFlow — subscriber-facing
 *
 * Polls /api/live/alerts/recent every 5s. Renders alerts that passed the
 * backend's Filter Engine v1 (premium >= $250K, not in blocklist, no
 * Grenade). Backend forwards high-conviction alerts to Discord; those
 * rows show a 🔔 badge.
 *
 * Display:
 *   - Tier-grouped sections (Mega → Whale → A → LEAPS → Unusual → Algo)
 *   - Colored left border per row indicates tier at a glance
 *   - Multi-select filter chips at top, state persists in localStorage
 *   - Click a tier header to collapse that group
 *
 * Tier is derived from alertName: "UCT Mega Whale Bull" → mega, etc.
 * Non-UCT alerts (Bullflow's native algo stream) → algo group.
 *
 * Subscriber version is leaner than admin: no filter-config banner, no
 * drop/forwarded counts, no PHASE B labeling.
 */

// ─── Palette ──────────────────────────────────────────────────────────────────
const P = {
  bg: "#0e0f0d",
  cd: "#161714",
  bd: "#2a2926",
  ac: "#c9a84c",   // amber accent
  bl: "#5b9bd5",   // blue
  bu: "#3cb868",   // calls/green
  be: "#e74c3c",   // puts/red
  wh: "#e8e6df",
  dm: "#a8a290",
  mt: "#6a6660",
};

const POLL_INTERVAL_MS = 5000;
const MAX_ROWS = 200;
// 2026-06-17 v3: bumped v2→v3 because tier structure expanded from 3 tiers
// (bullish/bearish/algo) to 6 (alpha/bullish/bearish/leaps/unusual/algo).
// Old v2 filter state references non-existent tier keys.
const LS_KEY = "uct_liveflow_filters_v3";

// ─── Backtest helpers ─────────────────────────────────────────────────────────
// Backtest mode = ?backtest=YYYY-MM-DD in the URL. When active:
//   - Data source switches to /api/admin/bullflow/backtest?date=...
//   - Polling is disabled (one-shot fetch)
//   - Header shows a backtest pill + date picker stays visible
//   - Bullflow MCP caps the sample at 100 alerts; we surface that in the banner

function formatDateForInput(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Most recent weekday — Bullflow only has data for market days. Doesn't
// account for holidays; user can pick another date if a Monday was closed.
function mostRecentMarketDay() {
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return formatDateForInput(d);
}

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

// ─── History helpers ──────────────────────────────────────────────────────────
// Historical mode = ?from=YYYY-MM-DD&to=YYYY-MM-DD in the URL. When active:
//   - Data source switches to /api/live/alerts/history (SQLite-backed)
//   - Polling is disabled (one-shot fetch)
//   - User-visible (no admin gating, unlike ?backtest)
// Separate from admin ?backtest mode which uses the Discord-export simulator.
const SEVEN_DAYS_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return formatDateForInput(d);
};

function isValidHistoryDate(s) {
  return isValidBacktestDate(s);
}

// True iff URL has both from + to params and they're valid dates.
// Previously required at least one date to be strictly in the past, which
// blocked the catch-up workflow: ?from=today&to=today is a legitimate
// request to see SQLite data (e.g., after a worker restart wipes the
// in-memory live buffer). Worker restart should not orphan today's alerts
// — the URL params ARE user intent, regardless of whether dates are past.
function isHistoryActive(from, to) {
  return isValidHistoryDate(from) && isValidHistoryDate(to);
}

// ─── Tier metadata + derivation ───────────────────────────────────────────────
// 2026-06-17 v3: Six tiers in priority cascade. Special tiers (Alpha Gold,
// LEAPS, Unusual) are checked first by name, then direction (Bullish/Bearish)
// catches everything else by cp. Each row lives in exactly ONE tier.
//
// Display order: Alpha pinned at top (rare, high-conviction). Bullish/Bearish
// next (the bread-and-butter directional flow). LEAPS and Unusual below
// (specialized signals worth their own sections). Algo last as fallback.
const TIER_META = {
  alpha:   { label: "Alpha Gold", color: "#c9a84c", bg: "#c9a84c14" },
  bullish: { label: "Bullish",    color: "#3CB868", bg: "#3CB86814" },
  bearish: { label: "Bearish",    color: "#E74C3C", bg: "#E74C3C14" },
  leaps:   { label: "LEAPS",      color: "#a892e0", bg: "#a892e014" },
  unusual: { label: "Unusual",    color: "#1d9e75", bg: "#1d9e7514" },
  algo:    { label: "Algo",       color: "#888780", bg: "#88878014" },
};
const TIER_ORDER = ["alpha", "bullish", "bearish", "leaps", "unusual", "algo"];

// Tiers that mix calls and puts (rows can be either direction). In these
// sections, row text is tinted green/red based on cp so direction is visible
// at a glance without scanning the C/P column. Bullish/Bearish tiers don't
// need this — their direction is self-evident from the tier itself.
const MIXED_DIRECTION_TIERS = new Set(["alpha", "leaps", "unusual", "algo"]);

// Map alert → tier key via priority cascade (first match wins). Special tiers
// take precedence over direction tiers — e.g. a bullish LEAPS trade lands in
// the LEAPS section, not the Bullish section.
function deriveTier(alert) {
  const name = (alert?.alertName || "").toLowerCase();
  if (name.includes("alpha gold")) return "alpha";
  if (name.includes("leaps")) return "leaps";
  if (name.includes("unusual") || name.includes("vol>oi")) return "unusual";
  const cp = alert?.cp;
  if (cp === "C") return "bullish";
  if (cp === "P") return "bearish";
  return "algo";
}

// Within a tier, sub-priority controls row order. With the v3 structure, only
// the Bullish and Bearish tiers benefit from sub-sorting:
//   1 = Size (UCT Size Bulls/Bears — large premium)
//   2 = Regular (everything else)
// Alpha/LEAPS/Unusual are their own tiers now, so no sub-priority needed there.
function deriveSubPriority(alertName) {
  const n = (alertName || "").toLowerCase();
  if (n.includes("size")) return 1;
  return 2;
}

// Display label for the sub-priority badge that appears next to alert names.
// Only Size gets a badge — Regular is the unmarked default.
function subPriorityLabel(p) {
  if (p === 1) return "SIZE";
  return "";
}

// ─── Trade-level dedup ────────────────────────────────────────────────────────
// Custom alert brackets can overlap, so a single trade can fire multiple
// alerts in the same instant (e.g. NVDA $2.10M matched A Mid + A Large +
// A Mega simultaneously on 2026-06-17 because Bullflow's marketCap filter
// wasn't actually rejecting matches — see diagnostic). Collapse those into
// one display row. The first occurrence wins; additional matched names
// accumulate in _matchedNames for the "+N" badge in the Alert Name column.

function tradeKey(a) {
  return [
    a.ticker || "",
    a.cp || "",
    a.strike ?? "",
    a.exp || "",
    a.alertPremium ?? "",
    a.timestamp || "",
  ].join("|");
}

function dedupAlerts(alerts) {
  const seen = new Map();
  for (const a of alerts) {
    const k = tradeKey(a);
    if (!seen.has(k)) {
      // Clone so we don't mutate cached refs from the polling buffer
      seen.set(k, { ...a, _matchedNames: a.alertName ? [a.alertName] : [] });
    } else {
      const existing = seen.get(k);
      if (a.alertName && !existing._matchedNames.includes(a.alertName)) {
        existing._matchedNames.push(a.alertName);
        // If this match is higher-priority than the current primary name,
        // promote it. E.g. trade matched both "UCT Bullish" (regular=3) AND
        // "UCT Size Bulls" (size=2) — primary should be Size since that's
        // the conviction-bearing fact. The +N badge still shows the rest.
        if (deriveSubPriority(a.alertName) < deriveSubPriority(existing.alertName)) {
          existing.alertName = a.alertName;
        }
      }
    }
  }
  return Array.from(seen.values());
}

// ─── Filter state helpers (localStorage-backed) ───────────────────────────────
function defaultFilters() {
  // All chips on by default — user sees everything until they opt out.
  const f = {};
  for (const t of TIER_ORDER) f[t] = true;
  return f;
}

function loadFilters() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultFilters();
    const parsed = JSON.parse(raw);
    return { ...defaultFilters(), ...parsed };  // forward-compat if tiers added
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
  const historical = status?.historical;
  const connected = status?.connected;
  const err = status?.last_error;
  const lastEventAt = status?.last_event_at;
  const stale = connected && lastEventAt
    && (Date.now() - new Date(lastEventAt).getTime()) > 90_000;

  let color, label;
  if (historical) { color = P.bl; label = "Historical"; }
  else if (err) { color = P.be; label = "Error"; }
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
        boxShadow: connected && !err && !historical ? `0 0 6px ${color}` : "none",
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

// ─── User blocklist panel (admin-only) ────────────────────────────────────────
// Inline panel below the chip row that lets the admin manage a custom ticker
// exclusion list. Reads current state from /api/live/user-blocklist on mount,
// PUTs the full replacement list on Save. Tickers are uppercased server-side
// and persisted to disk so the list survives worker restarts.
function UserBlocklistPanel({ visible, onSaved }) {
  const [tickers, setTickers] = useState([]);
  const [draftText, setDraftText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  // Initial load. Refresh quietly any time the panel becomes visible (no-op
  // if visible was always true).
  useEffect(() => {
    if (!visible) return;
    fetch("/api/live/user-blocklist")
      .then(r => r.json())
      .then(d => {
        setTickers(d.tickers || []);
        setDraftText((d.tickers || []).join(", "));
      })
      .catch(() => setStatus("load failed"));
  }, [visible]);

  if (!visible) return null;

  // Parse the comma/space/newline-separated draft into a clean list. Used both
  // for "did anything change?" check and for the save payload.
  const parseDraft = (s) => Array.from(new Set(
    (s || "")
      .split(/[\s,]+/)
      .map(t => t.trim().toUpperCase())
      .filter(Boolean)
  )).sort();

  const draftParsed = parseDraft(draftText);
  const isDirty = JSON.stringify(draftParsed) !== JSON.stringify(tickers);

  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const r = await fetch("/api/live/user-blocklist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: draftParsed }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      setTickers(d.tickers || []);
      setDraftText((d.tickers || []).join(", "));
      setStatus("saved · " + (d.count || 0) + " tickers");
      setTimeout(() => setStatus(""), 3000);
      // Signal parent to re-fetch alert data so the visible buffer reflects
      // the new blocklist immediately (otherwise the page shows stale rows
      // with excluded tickers until next poll cycle or backtest re-trigger).
      if (typeof onSaved === "function") onSaved();
    } catch (e) {
      setStatus("save failed: " + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      padding: "6px 20px",
      borderBottom: "1px solid " + P.bd,
      background: P.bg,
      fontSize: 11,
      fontFamily: "ui-monospace, monospace",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          onClick={() => setExpanded(!expanded)}
          style={{
            cursor: "pointer", color: P.dm, fontWeight: 700,
            letterSpacing: 0.5, textTransform: "uppercase", fontSize: 9,
            userSelect: "none",
          }}>
          {expanded ? "▼" : "▶"} EXCLUDE TICKERS
        </span>
        <span style={{ color: P.mt, fontSize: 10 }}>
          {tickers.length === 0 ? "(none)" : tickers.length + " active"}
        </span>
        {!expanded && tickers.length > 0 && (
          <span style={{ color: P.dm, fontSize: 10, overflow: "hidden",
                         textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {tickers.join(", ")}
          </span>
        )}
        {status && (
          <span style={{
            marginLeft: "auto", fontSize: 10,
            color: status.startsWith("saved") ? P.bu : P.be,
          }}>{status}</span>
        )}
      </div>
      {expanded && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            placeholder="SPCX, RKLB, ABCD ..."
            rows={2}
            style={{
              flex: 1, padding: "6px 8px",
              background: P.bg, color: P.wh,
              border: "1px solid " + P.bd, borderRadius: 4,
              fontFamily: "inherit", fontSize: 11,
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button
              onClick={save}
              disabled={saving || !isDirty}
              style={{
                padding: "6px 12px", fontSize: 10, fontWeight: 700,
                letterSpacing: 0.5,
                background: isDirty ? P.bl : "transparent",
                color: isDirty ? P.wh : P.dm,
                border: "1px solid " + (isDirty ? P.bl : P.bd),
                borderRadius: 3, cursor: saving || !isDirty ? "default" : "pointer",
                fontFamily: "inherit",
              }}>
              {saving ? "..." : "SAVE"}
            </button>
            <span style={{ fontSize: 9, color: P.mt, textAlign: "center" }}>
              {draftParsed.length} parsed
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Alert row ────────────────────────────────────────────────────────────────
function AlertRow({ alert, isNew, tierColor, directionTinted, isAdmin }) {
  const isCall = alert.cp === "C";
  const cpColor = isCall ? P.bu : (alert.cp === "P" ? P.be : P.dm);
  const typeColor = alert.alertType === "algo" ? P.ac : (alert.alertType === "custom" ? P.bl : P.dm);
  const forwarded = alert.forwardedToDiscord;
  const score = alert.convictionScore;
  const flashStyle = isNew ? { animation: "uct-flash 1.4s ease-out" } : {};

  // Local UI state for the admin force-push button. Tracks loading + post-click
  // result so we don't fire twice and so the row reflects success/fail without
  // requiring a full refetch. The actual SQLite `forwardedToDiscord` will be
  // refreshed on the next poll cycle.
  const [pushState, setPushState] = useState("idle"); // idle | pushing | done | error
  const [pushedMsgId, setPushedMsgId] = useState(null);

  async function handleForcePush() {
    const ticker = alert.ticker || "?";
    const cp = alert.cp === "C" ? "Call" : (alert.cp === "P" ? "Put" : "?");
    const strike = alert.strike != null ? `$${alert.strike}` : "?";
    const prem = fmtPremium(alert.alertPremium);
    if (!window.confirm(
      `Push to Discord (bypassing all gates)?\n\n` +
      `${ticker} ${strike} ${cp} ${alert.exp || ""}\n` +
      `Premium: ${prem}   Grade: ${alert.grade || "?"}\n` +
      `Alert: ${alert.alertName || "?"}\n\n` +
      `This is a manual override — the alert did not qualify under current ` +
      `gates. It will be marked as forwarded after posting.`
    )) return;
    setPushState("pushing");
    try {
      const r = await fetch("/api/live/admin/force-push-discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert, confirm: "YES_FORCE_PUSH" }),
      });
      const data = await r.json();
      if (data.ok && data.posted) {
        setPushState("done");
        setPushedMsgId(data.message_id);
      } else {
        setPushState("error");
        console.error("[force_push] failed:", data.error, data.traceback);
        window.alert(`Push failed: ${data.error || "unknown error"}`);
      }
    } catch (e) {
      setPushState("error");
      window.alert(`Push failed: ${e.message}`);
    }
  }

  // In mixed-direction tier sections (Alpha Gold, LEAPS, Unusual, Algo) we
  // tint the row's primary text by direction so a bullish vs bearish trade
  // is recognizable at a glance without scanning the C/P column. The C/P
  // pill, type pill, score, and bell stay as-is since they have their own
  // semantic colors that shouldn't be overridden.
  const primaryTextColor = directionTinted ? cpColor : P.wh;
  const accentTextColor = directionTinted ? cpColor : P.ac;

  return (
    <tr style={{ borderBottom: "1px solid " + P.bd + "30", ...flashStyle }}>
      {/* First cell carries the tier-colored left border */}
      <td style={{
        padding: "8px 10px", color: P.dm, fontSize: 10,
        fontFamily: "ui-monospace, monospace",
        borderLeft: tierColor ? "3px solid " + tierColor : "none",
      }}>
        {fmtTime(alert.timestamp)}
      </td>
      <td style={{ padding: "8px 10px", fontWeight: 800, color: primaryTextColor, fontSize: 13 }}>
        {alert.ticker || "—"}
      </td>
      <td style={{ padding: "8px 10px", fontWeight: 800, fontSize: 11 }}>
        <span style={{
          padding: "2px 8px", borderRadius: 4,
          background: cpColor + "20", color: cpColor,
        }}>{alert.cp || "—"}</span>
      </td>
      <td style={{ padding: "8px 10px", fontWeight: 700, color: primaryTextColor, fontSize: 12 }}>
        {alert.strike != null ? "$" + alert.strike.toFixed(alert.strike >= 100 ? 0 : 2) : "—"}
      </td>
      <td style={{ padding: "8px 10px", color: primaryTextColor, fontSize: 11 }}>{alert.exp || "—"}</td>
      <td style={{ padding: "8px 10px", color: P.dm, fontSize: 10 }}>
        {alert.dte != null ? alert.dte + "d" : "—"}
      </td>
      <td style={{
        padding: "8px 10px", fontWeight: 800, color: accentTextColor, fontSize: 12,
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
      <td style={{ padding: "8px 10px", color: primaryTextColor, fontSize: 11 }}>
        {(() => {
          const sp = deriveSubPriority(alert.alertName);
          const spLabel = subPriorityLabel(sp);
          if (!spLabel) return null;
          // SIZE badge — the only sub-priority indicator left in v3. Alpha,
          // LEAPS, and Unusual are now full tiers with their own sections,
          // so they don't need inline badges.
          const spColor = "#d8c878";
          return (
            <span style={{
              marginRight: 6, fontSize: 8, padding: "1px 5px", borderRadius: 3,
              background: spColor + "22", color: spColor, fontWeight: 800,
              fontFamily: "ui-monospace, monospace", letterSpacing: 0.5,
              verticalAlign: "1px",
            }}>{spLabel}</span>
          );
        })()}
        {alert.alertName || "—"}
        {alert._matchedNames && alert._matchedNames.length > 1 && (
          <span
            title={"Also matched: " + alert._matchedNames.slice(1).join(", ")}
            style={{
              marginLeft: 6, fontSize: 9, padding: "1px 5px", borderRadius: 8,
              background: P.dm + "20", color: P.dm, cursor: "help",
              fontWeight: 700, fontFamily: "ui-monospace, monospace",
              verticalAlign: "1px",
            }}>
            +{alert._matchedNames.length - 1}
          </span>
        )}
        {/* Repeat-fire badge: shown when this contract has fired >1 distinct
            trades in the rolling window. Tooltip explains the count. Coloring
            ramps with intensity — amber for casual (2-4x), red for heavy (5x+)
            which usually signals OpEx noise or concentrated conviction. */}
        {alert.contractRepeatCount > 1 && (() => {
          const c = alert.contractRepeatCount;
          const heavy = c >= 5;
          return (
            <span
              title={"This contract has fired " + c + " distinct trades today"}
              style={{
                marginLeft: 6, fontSize: 9, padding: "1px 6px", borderRadius: 8,
                background: (heavy ? P.be : P.ac) + "22",
                color:      (heavy ? P.be : P.ac),
                fontWeight: 800, fontFamily: "ui-monospace, monospace",
                letterSpacing: 0.3, verticalAlign: "1px", cursor: "help",
              }}>
              <UIcon name="refresh" size={9} style={{ verticalAlign: '-1px', marginRight: 3 }} />{c}x
            </span>
          );
        })()}
        {/* OI Exceeded badge: this single trade traded more contracts than
            existed in open interest before today. Strong signal of
            institutional positioning, not retail churn. Tooltip shows the
            trade size, prior OI, and ratio for context. */}
        {alert.oiExceeded && alert.volumeOIRatio && (
          <span
            title={
              "Volume " + (alert.tradeSize || "?") +
              " exceeded OI " + (alert.priorOI || "?") +
              " (ratio " + alert.volumeOIRatio.toFixed(2) + "x)" +
              (alert.oiSnapshotDate ? " — OI from " + alert.oiSnapshotDate : "")
            }
            style={{
              marginLeft: 6, fontSize: 9, padding: "1px 6px", borderRadius: 8,
              background: P.bu + "22", color: P.bu,
              fontWeight: 800, fontFamily: "ui-monospace, monospace",
              letterSpacing: 0.3, verticalAlign: "1px", cursor: "help",
            }}>
            <UIcon name="rocket" size={9} style={{ verticalAlign: '-1px', marginRight: 3 }} />OI BREAK
          </span>
        )}
      </td>
      {/* Push column — admin only. Lets the operator force-push any alert to
          Discord regardless of grade/gate state. Visible on every row so the
          decision is one click away. Cell is wrapped in conditional render
          because subscribers shouldn't see the column at all. */}
      {isAdmin && (
        <td style={{ padding: "8px 10px", textAlign: "center" }}>
          {(() => {
            // Once successfully pushed in this session, show locked state.
            if (pushState === "done" || forwarded) {
              return (
                <span title={pushState === "done"
                  ? "Manually pushed to Discord (admin override)"
                  : "Already forwarded to Discord"}
                  style={{ fontSize: 10, color: P.ac, fontWeight: 700 }}>
                  ✓ posted
                </span>
              );
            }
            return (
              <button onClick={handleForcePush}
                disabled={pushState === "pushing"}
                title="Force-push this alert to Discord (bypasses all gates). Subscribers will see the embed in your test channel."
                style={{
                  fontSize: 9, padding: "4px 10px",
                  background: pushState === "pushing" ? P.dm + "22" : "transparent",
                  color: pushState === "error" ? P.be : (pushState === "pushing" ? P.dm : P.ac),
                  border: `1px solid ${pushState === "error" ? P.be : P.ac}66`,
                  borderRadius: 4, cursor: pushState === "pushing" ? "wait" : "pointer",
                  fontWeight: 700, letterSpacing: 0.5, lineHeight: 1.2,
                  whiteSpace: "nowrap",
                }}>
                {pushState === "pushing" ? "pushing…" : pushState === "error" ? "↻ retry" : "→ push"}
              </button>
            );
          })()}
        </td>
      )}
      <td style={{
        padding: "8px 10px", fontSize: 12, fontWeight: 800,
        fontFamily: "ui-monospace, monospace", textAlign: "center",
      }}>
        {(() => {
          const grade = alert.grade;
          if (!grade) return <span style={{ color: P.mt }}>—</span>;
          // Color ramp: A+/A green, B+/B amber, C/D dim. Matches the
          // conviction-grade color scheme used in the SimulationPanel.
          const c =
            grade === "A+" ? P.bu :
            grade === "A"  ? P.bu + "cc" :
            grade === "B+" ? P.ac :
            grade === "B"  ? P.ac + "cc" :
            grade === "C"  ? P.dm :
            P.mt;
          return (
            <span style={{
              padding: "2px 7px", borderRadius: 4,
              background: c + "22", color: c,
              letterSpacing: 0.3,
            }}>{grade}</span>
          );
        })()}
      </td>
      <td style={{ padding: "8px 10px", textAlign: "center" }}>
        {(() => {
          // REPLAY-GATES TOGGLE [BLOCK 4] — TEMPORARY: when replay mode is
          // active, the backend stamps _replayedWouldForward on each alert.
          // Show the replayed result instead of the live forwarded state so
          // the user can see "would post" predictions for historical days.
          // Remove this if-block when going live (existing logic below stays).
          if (alert._replayedWouldForward !== undefined) {
            if (alert._replayedWouldForward === 1) {
              const ft = alert._replayedFollowThroughCount;
              return (
                <span title={`Would forward to Discord under current gates · ${ft}× fires in window`}
                  style={{
                    fontSize: 9, padding: "2px 6px", borderRadius: 3,
                    background: "#10b98122", color: "#10b981",
                    fontWeight: 800, letterSpacing: 0.3,
                    border: "1px solid #10b98155",
                  }}>✓ FWD</span>
              );
            }
            return (
              <span title={`Blocked: ${alert._replayedGateReason || "unknown"}`}
                style={{
                  fontSize: 9, padding: "2px 6px", borderRadius: 3,
                  background: "#ef444411", color: "#ef4444",
                  fontWeight: 700, letterSpacing: 0.3,
                  border: "1px solid #ef444433",
                  opacity: 0.85,
                }}>⊘ BLK</span>
            );
          }
          // — original live/non-replay rendering below —
          // Three states for the bell column:
          //   - forwarded → 🔔 in green (Discord post happened)
          //   - gate_passed=false → dim "⊘" (alert below conviction threshold)
          //   - everything else → "·" (no decision yet, or no grade computed)
          //
          // The PUSH-to-Discord control lives in a separate admin-only
          // column to the left of Grade — see the {isAdmin && <td>...</td>}
          // block above. This column stays as the status indicator only.
          if (forwarded || pushState === "done") {
            return (
              <span title={pushState === "done" ? "Manually pushed to Discord (admin override)" : "Forwarded to Discord"}
                style={{ fontSize: 11, color: pushState === "done" ? P.ac : P.bu, fontWeight: 800 }}>
                <UIcon name="bell" size={11} />
                {pushState === "done" && <span style={{ fontSize: 8, marginLeft: 3 }}>📌</span>}
              </span>
            );
          }
          if (alert.gatePassed === false) {
            return (
              <span title="Below conviction gate — not posted"
                style={{ fontSize: 11, color: P.mt, fontWeight: 700 }}>⊘</span>
            );
          }
          return <span style={{ color: P.mt, fontSize: 11 }}>·</span>;
        })()}
      </td>
    </tr>
  );
}

// ─── Tier section: collapsible header + tier rows ─────────────────────────────
function TierSection({ tier, alerts, newIds, collapsed, onToggle, isAdmin }) {
  if (alerts.length === 0) return null;
  const meta = TIER_META[tier];
  // In mixed-direction tiers (Alpha/LEAPS/Unusual/Algo) we direction-tint rows.
  // In Bullish/Bearish the tier itself signals direction so per-row tint would
  // be redundant noise.
  const directionTinted = MIXED_DIRECTION_TIERS.has(tier);
  return (
    <>
      <tr style={{
        background: meta.bg,
        borderTop: "1px solid " + P.bd,
        borderBottom: "1px solid " + meta.color + "30",
      }}>
        <td colSpan={isAdmin ? 13 : 12} style={{ padding: "6px 12px", cursor: "pointer" }} onClick={onToggle}>
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
          directionTinted={directionTinted}
          isAdmin={isAdmin}
        />
      ))}
    </>
  );
}

// ─── Simulation Panel (admin backtest only) ───────────────────────────────────
// Renders the output of the backtest endpoint's simulate=full mode. Three views:
//   - posts: contracts that would have triggered a fresh Discord message
//   - edits: subsequent fires that would have updated an existing message
//   - gated: alerts silenced by the conviction threshold
// Stats row up top, grade distribution chips, then the tabbed list.
function SimulationPanel({ simulation, view, setView }) {
  const s = simulation.stats || {};
  const dist = simulation.grade_distribution || {};
  const GRADES = ["A+", "A", "B", "C", "D"];
  const distTotal = GRADES.reduce((sum, g) => sum + (dist[g] || 0), 0) || 1;

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
      {/* Stats row */}
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

      {/* Tab strip */}
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

      {/* Tabbed list */}
      <div style={{
        maxHeight: 360, overflowY: "auto",
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

// Compact row for simulation list. Highlights premium, fires, and grade.
function SimRow({ row, view }) {
  const t = row.ticker || "?";
  const cp = row.cp || "";
  const strike = row.strike;
  const exp = row.exp || "";
  const prem = row.agg_total_premium || row.alertPremium || 0;
  const fires = row.agg_fire_count || 1;
  const grade = row.conviction_grade || "—";
  const alertName = (row.alertName || "").replace(/\s+\+\d+ more$/, "");

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
      <span style={{ color: P.wh, fontWeight: 700, minWidth: 60 }}>{t}</span>
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
export default function LiveFlow() {
  const [searchParams, setSearchParams] = useSearchParams();
  const backtestDate = searchParams.get("backtest");
  // Admin gate — backtest UI is only visible if ?admin=1 is in the URL.
  // Frontend-only gate while we tune; subscribers won't see the date picker
  // or the BACKTEST pill even if they somehow land on a ?backtest=... URL.
  // For real auth, add server-side check on /api/admin/bullflow/backtest.
  const isAdmin = searchParams.get("admin") === "1";
  const isBacktest = isAdmin && isValidBacktestDate(backtestDate);

  // History mode — user-facing historical view backed by SQLite. Distinct
  // from admin backtest (which replays Discord exports). Disabled while in
  // backtest mode so the two never conflict.
  const historyFrom = searchParams.get("from");
  const historyTo   = searchParams.get("to");
  const isHistory   = !isBacktest && isHistoryActive(historyFrom, historyTo);

  // REPLAY-GATES TOGGLE [BLOCK 1] — TEMPORARY testing toggle
  // Reads ?replay_gates=1 from URL on mount, syncs back when user toggles.
  // When ON in history mode, the backend replays historical alerts through
  // the current ALERT_CONVICTION_GATES config to show what WOULD post under
  // today's gating rules. Useful for tuning gate values against real data.
  // Remove this block + 3 others tagged REPLAY-GATES TOGGLE when going live.
  const [replayGates, setReplayGates] = useState(
    searchParams.get("replay_gates") === "1"
  );
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (replayGates) next.set("replay_gates", "1");
    else next.delete("replay_gates");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayGates]);

  // Helper: when changing URL params, preserve the admin flag so the admin
  // user stays in admin mode across date picks and × live exits.
  const updateParams = (mutator) => {
    const next = new URLSearchParams(searchParams);
    mutator(next);
    setSearchParams(next);
  };

  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState(null);
  const [simulation, setSimulation] = useState(null);   // simulation block from backtest
  const [simView, setSimView] = useState("posts");      // "posts" | "edits" | "gated"
  const [uploadedFile, setUploadedFile] = useState(null);  // JSON file for JSON-mode backtest
  const [uploadError, setUploadError] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [filters, setFilters] = useState(loadFilters);
  const [collapsedTiers, setCollapsedTiers] = useState({});
  const [backtestLoading, setBacktestLoading] = useState(false);
  // Bump this to force the data-fetch effect to re-run (e.g. after the user
  // saves a new ticker blocklist — both live polling and backtest re-fetch).
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const lastIdRef = useRef(null);
  const newIdsRef = useRef(new Set());

  // ─── Simulation mode (admin + backtest only) ─────────────────────────────
  // URL params drive simulation so links are bookmarkable. When `simulate=full`,
  // the backtest endpoint runs the full pipeline (enrich → aggregate → gate)
  // and returns a `simulation` block. min_grade + exclude_etf are passthrough.
  const simulateMode = isBacktest && searchParams.get("simulate") === "full";
  const simMinGrade = (searchParams.get("min_grade") || "B").toUpperCase();
  const simExcludeETF = searchParams.get("exclude_etf") === "true";

  // 1Hz tick keeps relTime labels fresh without re-polling.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Data fetch — branches on isBacktest. Live = polling loop, Backtest = one-shot.
  useEffect(() => {
    let abort = null;
    let timer = null;
    let cancelled = false;

    async function fetchBacktestFromJSON() {
      // JSON-sourced backtest. Uploaded file POST'd to a separate endpoint
      // that parses Discord embeds and runs the same simulator. Re-fired
      // whenever simulation params change so user can tune thresholds
      // without re-uploading.
      setBacktestLoading(true);
      setAlerts([]);
      setStatus(null);
      setSimulation(null);
      setError(null);
      try {
        abort = new AbortController();
        const fd = new FormData();
        fd.append("file", uploadedFile);
        const qparams = new URLSearchParams({ min_grade: simMinGrade });
        if (simExcludeETF) qparams.set("exclude_etf_flow", "true");
        const r = await fetch(
          `/api/admin/bullflow/backtest-from-json?${qparams.toString()}`,
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
        // to trigger the full pipeline run.
        const qparams = new URLSearchParams({
          date: backtestDate,
          max_alerts: "500",
        });
        if (simulateMode) {
          qparams.set("simulate", "full");
          qparams.set("min_grade", simMinGrade);
          if (simExcludeETF) qparams.set("exclude_etf_flow", "true");
        }
        const url = `/api/admin/bullflow/backtest?${qparams.toString()}`;
        const r = await fetch(url, { signal: abort.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        const incoming = d.alerts || [];
        // No flash detection in backtest mode — historical data, not live arrivals
        newIdsRef.current = new Set();
        lastIdRef.current = incoming[0]?.id || null;
        setAlerts(incoming);
        setStatus(d.status);
        // simulation may be null (simulate=off) or contain the full block.
        // Surface simulator-side errors inline without breaking the alert list.
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

    async function fetchHistory() {
      // SQLite-backed historical query. One-shot fetch; no polling.
      // Frontend reuses the same alert-row shape as live polling so all
      // existing tier/dedup/render code works unchanged.
      setBacktestLoading(true);
      setAlerts([]);
      setStatus(null);
      setSimulation(null);
      setError(null);
      try {
        abort = new AbortController();
        const qparams = new URLSearchParams({
          date_from: historyFrom,
          date_to: historyTo,
          limit: "2000",
        });
        // REPLAY-GATES TOGGLE [BLOCK 2] — TEMPORARY: when toggle is on, ask
        // the backend to replay each alert through ALERT_CONVICTION_GATES and
        // stamp _replayedWouldForward / _replayedGateReason on each row.
        if (replayGates) qparams.set("replay_gates", "1");
        const r = await fetch(`/api/live/alerts/history?${qparams.toString()}`, { signal: abort.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        const incoming = d.alerts || [];
        newIdsRef.current = new Set();
        lastIdRef.current = incoming[0]?.id || null;
        setAlerts(incoming);
        // Synthesize a status-like object so the header pill renders cleanly
        // in history mode (no "connected" flag — historical data is static).
        setStatus({
          connected: null,
          historical: true,
          date_from: d.date_from,
          date_to: d.date_to,
          returned: d.returned,
          counts: d.counts || {},
          total_alerts_forwarded: incoming.filter(a => a.forwardedToDiscord).length,
          last_event_at: incoming[0]?.ingestedAt || null,
        });
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setBacktestLoading(false);
      }
    }

    if (isBacktest && uploadedFile) {
      // JSON-sourced backtest takes precedence over MCP when file is loaded.
      // Conviction simulation auto-enabled in this mode since the whole point
      // of uploading is to see the simulator output.
      fetchBacktestFromJSON();
    } else if (isBacktest) {
      fetchBacktest();
    } else if (isHistory) {
      fetchHistory();
    } else {
      poll();
    }
    return () => {
      cancelled = true;
      if (abort) abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [isBacktest, backtestDate, refreshTrigger, simulateMode, simMinGrade, simExcludeETF, uploadedFile, isHistory, historyFrom, historyTo, replayGates]);

  // Dedup first: collapse alerts that fired multiple custom-alert rules for the
  // same trade. Then group by tier (direction from cp), then sort within each
  // tier by sub-priority so Alpha Gold pins to top, Leaps drops to bottom.
  const dedupedAlerts = dedupAlerts(alerts);
  const byTier = {};
  for (const t of TIER_ORDER) byTier[t] = [];
  for (const a of dedupedAlerts) byTier[deriveTier(a)].push(a);

  // Sort each tier's alerts: sub-priority ascending (1 first), ties broken by
  // arrival order (timestamp descending — newest within the same priority on top).
  for (const t of TIER_ORDER) {
    byTier[t].sort((a, b) => {
      const dp = deriveSubPriority(a.alertName) - deriveSubPriority(b.alertName);
      if (dp !== 0) return dp;
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
  }

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

      {/* Header — subscriber view, no PHASE B labeling */}
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
            {isBacktest && (
              <span style={{
                fontSize: 9, padding: "2px 6px", borderRadius: 3,
                background: P.bl + "20", color: P.bl, fontWeight: 800,
                letterSpacing: 0.5,
              }}>BACKTEST · {backtestDate}</span>
            )}
            {isHistory && (
              <span style={{
                fontSize: 9, padding: "2px 6px", borderRadius: 3,
                background: P.bu + "20", color: P.bu, fontWeight: 800,
                letterSpacing: 0.5,
              }}>HISTORY · {historyFrom}{historyFrom !== historyTo ? ` → ${historyTo}` : ""}</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* History date-range picker — visible to all users. Switching from
              live polling to a SQLite-backed historical view. Independent of
              admin backtest mode (which uses the Discord-export simulator). */}
          {!isBacktest && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px", borderRadius: 4,
              border: "1px solid " + (isHistory ? P.bu + "60" : P.bd),
              background: isHistory ? P.bu + "10" : "transparent",
            }}>
              <span style={{
                fontSize: 9, color: isHistory ? P.bu : P.mt, fontWeight: 700,
                letterSpacing: 0.5, textTransform: "uppercase",
              }}>{isHistory ? "history" : "live"}</span>
              <input
                type="date"
                value={historyFrom || SEVEN_DAYS_AGO()}
                max={formatDateForInput(new Date())}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!isValidHistoryDate(v)) return;
                  updateParams(p => {
                    p.set("from", v);
                    // Default `to` to same date if user only sets `from`.
                    if (!p.get("to") || p.get("to") < v) p.set("to", v);
                  });
                }}
                title="History start date (inclusive)"
                style={{
                  fontSize: 10, padding: "2px 4px",
                  background: P.bg, color: P.wh,
                  border: "1px solid " + P.bd, borderRadius: 3,
                  fontFamily: "ui-monospace, monospace",
                  colorScheme: "dark",
                }}
              />
              <span style={{ fontSize: 10, color: P.mt }}>→</span>
              <input
                type="date"
                value={historyTo || formatDateForInput(new Date())}
                max={formatDateForInput(new Date())}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!isValidHistoryDate(v)) return;
                  updateParams(p => {
                    p.set("to", v);
                    if (!p.get("from") || p.get("from") > v) p.set("from", v);
                  });
                }}
                title="History end date (inclusive)"
                style={{
                  fontSize: 10, padding: "2px 4px",
                  background: P.bg, color: P.wh,
                  border: "1px solid " + P.bd, borderRadius: 3,
                  fontFamily: "ui-monospace, monospace",
                  colorScheme: "dark",
                }}
              />
              {isHistory && (
                <button
                  onClick={() => updateParams(p => { p.delete("from"); p.delete("to"); })}
                  title="Exit history, return to live"
                  style={{
                    fontSize: 9, padding: "2px 6px", fontWeight: 700,
                    letterSpacing: 0.5,
                    background: "transparent", color: P.dm,
                    border: "1px solid " + P.bd, borderRadius: 3,
                    cursor: "pointer", fontFamily: "inherit",
                  }}>× live</button>
              )}
              {/* REPLAY-GATES TOGGLE [BLOCK 3] — TEMPORARY testing button.
                  Only visible in history mode. Toggles replay of historical
                  alerts through current ALERT_CONVICTION_GATES — shows what
                  WOULD post under today's gates. Remove when going live. */}
              {isHistory && (
                <button
                  onClick={() => setReplayGates(v => !v)}
                  title={replayGates
                    ? "Showing 'would post' under current gates. Click to see raw historical view."
                    : "Apply current ALERT_CONVICTION_GATES to historical alerts (shows what WOULD have posted under today's filters)."
                  }
                  style={{
                    fontSize: 9, padding: "2px 6px", fontWeight: 700,
                    letterSpacing: 0.5, textTransform: "uppercase",
                    background: replayGates ? P.ac + "22" : "transparent",
                    color: replayGates ? P.ac : P.dm,
                    border: "1px solid " + (replayGates ? P.ac + "80" : P.bd),
                    borderRadius: 3,
                    cursor: "pointer", fontFamily: "inherit",
                  }}>{replayGates ? "⚙ gates on" : "gates off"}</button>
              )}
            </div>
          )}
          {/* Backtest controls — admin-gated. Only visible when ?admin=1 is in URL */}
          {isAdmin && (
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
                    updateParams(p => p.set("backtest", v));
                  }
                }}
                style={{
                  fontSize: 10, padding: "2px 4px",
                  background: P.bg, color: P.wh,
                  border: "1px solid " + P.bd, borderRadius: 3,
                  fontFamily: "ui-monospace, monospace",
                  colorScheme: "dark",
                }}
              />
              {isBacktest && (
                <button
                  onClick={() => updateParams(p => p.delete("backtest"))}
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
          )}
          <StatusPill status={status} />
          {status && (
            <div style={{
              fontSize: 10, color: P.dm,
              fontFamily: "ui-monospace, monospace",
              display: "flex", gap: 10,
            }}>
              <span title="Alerts in current view">
                shown <strong style={{ color: P.wh }}>{visibleTotal}</strong>
              </span>
              <span title="Forwarded to Discord">
                <UIcon name="bell" size={10} style={{ verticalAlign: '-1px', marginRight: 4 }} /><strong style={{ color: P.bu }}>{status.total_alerts_forwarded ?? 0}</strong>
              </span>
              <span style={{ color: P.mt }}>· last {relTime(status.last_event_at)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <FilterChips filters={filters} setFilters={setFilters} counts={counts} />

      {/* Admin: user-managed ticker exclusion list */}
      <UserBlocklistPanel
        visible={isAdmin}
        onSaved={() => setRefreshTrigger(x => x + 1)}
      />

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Backtest banner — only when in backtest mode (admin gated) */}
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
            }}>backtest</span>
            <span style={{ color: P.dm }}>
              Replaying <strong style={{ color: P.wh }}>{backtestDate}</strong>
              {backtestLoading && " · loading…"}
            </span>

            {/* Simulation controls — opt-in via "simulate" toggle. When on,
                threshold + ETF-exclusion controls become editable. */}
            <span style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 12, flexWrap: "wrap" }}>
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
                  When a file is loaded, simulation auto-runs and the UI shows
                  what the gate would do for that day's alerts. */}
              <label
                style={{
                  padding: "3px 10px", fontSize: 10, borderRadius: 4,
                  border: "1px solid " + (uploadedFile ? P.gn : P.bd),
                  background: uploadedFile ? P.gn + "20" : "transparent",
                  color: uploadedFile ? P.gn : P.dm,
                  cursor: "pointer", letterSpacing: 0.5,
                  textTransform: "uppercase", fontWeight: 700,
                }}
                title="Upload a DiscordChatExporter JSON of your live-flow channel to backtest against captured Discord posts"
              >
                {uploadedFile ? <><UIcon name="check" size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />{`${uploadedFile.name.slice(0, 18)}…`}</> : "upload json"}
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 50 * 1024 * 1024) {
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
                  title="Clear uploaded file"
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
                <UIcon name="warning" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />capped at 500 alerts — day had more flow than shown
              </span>
            )}
            {!backtestLoading && !status?.backtest_capped && alerts.length > 0 && !simulateMode && (
              <span style={{ color: P.dm, marginLeft: "auto" }}>
                {alerts.length} alert{alerts.length !== 1 ? "s" : ""} returned
              </span>
            )}
          </div>
        )}

        {/* Simulation results panel — appears when sim is active and backend
            returned a simulation block. Shows stats + grade distribution + tabs. */}
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
            <strong>Disconnected:</strong> {status.last_error}
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
                : isHistory
                  ? (backtestLoading ? "Loading historical alerts…" : "No alerts captured for this range")
                  : (status?.connected ? "Connected, waiting for alerts…" : "Connecting to stream…")}
            </div>
            <div style={{ fontSize: 10, color: P.mt, maxWidth: 520, textAlign: "center", lineHeight: 1.5 }}>
              {isBacktest
                ? (backtestLoading
                    ? "Bullflow sample replay can take up to 2 minutes."
                    : "Either the market was quiet or it was a non-trading day.")
                : isHistory
                  ? (backtestLoading
                      ? "Querying the SQLite alert archive."
                      : <>
                          Historical persistence started on the day the feature shipped — earlier dates are empty by default.
                          {isAdmin && (
                            <>
                              {" "}Admin: seed this range via{" "}
                              <code style={{ color: P.ac, fontFamily: "ui-monospace, monospace", fontSize: 10 }}>
                                /api/admin/bullflow/backfill?date_from={historyFrom}{historyFrom !== historyTo ? `&date_to=${historyTo}` : ""}
                              </code>
                              {" "}(Bullflow caps at ~100 alerts/day).
                            </>
                          )}
                        </>)
                  : "Quiet stretches are normal — flow fires on unusual activity only."}
            </div>
            {!isBacktest && !isHistory && status?.started_at && (
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
              {dedupedAlerts.length} alert{dedupedAlerts.length !== 1 ? "s" : ""} hidden by chip filters above. Click chips to show.
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
                  ["Type", 9], ["Alert Name", 11],
                  // Push column is admin-only — hidden for subscribers.
                  // Placed right after Alert Name per operator preference so
                  // the decision context (alert tier + name) sits adjacent to
                  // the action button. Spread-in via conditional array.
                  ...(isAdmin ? [["Push", 10]] : []),
                  ["Grade", 11], ["🔔", 11],
                ].map(([label]) => (
                  <th key={label} style={{
                    padding: "8px 10px",
                    textAlign: (label === "Grade" || label === "🔔" || label === "Push") ? "center" : "left",
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
                  isAdmin={isAdmin}
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
            ? `backtest · ${backtestDate} · one-shot`
            : isHistory
              ? `history · ${historyFrom}${historyFrom !== historyTo ? ` → ${historyTo}` : ""} · one-shot`
              : `polling every ${POLL_INTERVAL_MS / 1000}s · buffer ${MAX_ROWS}`}
        </div>
        <div>
          {visibleTotal > 0 && "showing " + visibleTotal + " · "}
          updated {relTime(new Date(now).toISOString())}
        </div>
      </div>
    </div>
  );
}
