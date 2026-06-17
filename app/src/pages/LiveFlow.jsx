import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

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
const LS_KEY = "uct_liveflow_filters_v1";

// ─── Tier metadata + derivation ───────────────────────────────────────────────
// Order: Q2-B (Mega → Whale → A → LEAPS → Unusual). Algo last.
const TIER_META = {
  mega:    { label: "Mega Whale", color: "#e74c3c", bg: "#e74c3c14" },
  whale:   { label: "Whale",      color: "#c9a84c", bg: "#c9a84c14" },
  a:       { label: "A-tier",     color: "#5b9bd5", bg: "#5b9bd514" },
  leaps:   { label: "LEAPS",      color: "#a892e0", bg: "#a892e014" },
  unusual: { label: "Unusual",    color: "#1d9e75", bg: "#1d9e7514" },
  algo:    { label: "Algo",       color: "#888780", bg: "#88878014" },
};
const TIER_ORDER = ["mega", "whale", "a", "leaps", "unusual", "algo"];

// Map alertName → tier key. Check Mega before Whale (longest prefix wins).
// Anything not starting with "UCT" falls through to "algo".
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
      {/* First cell carries the tier-colored left border */}
      <td style={{
        padding: "8px 10px", color: P.dm, fontSize: 10,
        fontFamily: "ui-monospace, monospace",
        borderLeft: tierColor ? "3px solid " + tierColor : "none",
      }}>
        {fmtTime(alert.timestamp)}
      </td>
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
            style={{ fontSize: 11, color: P.bu, fontWeight: 800 }}>🔔</span>
        ) : (
          <span style={{ color: P.mt, fontSize: 11 }}>·</span>
        )}
      </td>
    </tr>
  );
}

// ─── Tier section: collapsible header + tier rows ─────────────────────────────
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

// ─── Main page ────────────────────────────────────────────────────────────────
export default function LiveFlow() {
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [filters, setFilters] = useState(loadFilters);
  const [collapsedTiers, setCollapsedTiers] = useState({});
  const lastIdRef = useRef(null);
  const newIdsRef = useRef(new Set());

  // 1Hz tick keeps relTime labels fresh without re-polling.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Polling loop — AbortController prevents stale fetches from clobbering state.
  useEffect(() => {
    let abort = null;
    let timer = null;
    let cancelled = false;

    async function poll() {
      try {
        abort = new AbortController();
        const r = await fetch(`/api/live/alerts/recent?limit=${MAX_ROWS}`, { signal: abort.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        if (cancelled) return;
        const incoming = d.alerts || [];
        // Detect new alerts since last poll → flash them.
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
      if (abort) abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Group alerts by tier (preserves arrival order within tier).
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
          <span style={{ fontSize: 14, fontWeight: 900, color: P.ac, letterSpacing: 0.5 }}>
            LIVE FLOW
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                🔔 <strong style={{ color: P.bu }}>{status.total_alerts_forwarded ?? 0}</strong>
              </span>
              <span style={{ color: P.mt }}>· last {relTime(status.last_event_at)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <FilterChips filters={filters} setFilters={setFilters} counts={counts} />

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto" }}>
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
              {status?.connected ? "Connected, waiting for alerts…" : "Connecting to stream…"}
            </div>
            <div style={{ fontSize: 10, color: P.mt }}>
              Quiet stretches are normal — flow fires on unusual activity only.
            </div>
            {status?.started_at && (
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
        <div>polling every {POLL_INTERVAL_MS / 1000}s · buffer {MAX_ROWS}</div>
        <div>
          {visibleTotal > 0 && "showing " + visibleTotal + " · "}
          updated {relTime(new Date(now).toISOString())}
        </div>
      </div>
    </div>
  );
}
