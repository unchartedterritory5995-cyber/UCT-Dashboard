import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * LiveFlow — Phase B
 *
 * Polls /api/live/alerts/recent every 5 seconds. Renders the alerts that
 * passed the backend's Filter Engine v1 (premium >= $250K, not in blocklist,
 * alertName doesn't contain "Grenade"). Backend also forwards high-conviction
 * alerts to Discord — those rows show a 🔔 badge.
 *
 * Filter rules live in api/liveflow_worker.py (TABLE_FILTER + scoring tables).
 * Edit there + redeploy to tune. The header echoes active filter config so
 * you don't have to dive into code to remember what's active.
 *
 * Phase C would add: editable filter UI, SQLite persistence, migration to
 * the dedicated `worker` Railway service.
 */

// ─── Palette — matches OptionsFlow's aesthetic ────────────────────────────────
const P = {
  bg: "#0e0f0d",       // page background
  cd: "#161714",       // card background
  bd: "#2a2926",       // borders
  ac: "#c9a84c",       // amber accent (Live/algo)
  bl: "#5b9bd5",       // blue (custom alerts)
  bu: "#3cb868",       // calls / green
  be: "#e74c3c",       // puts / red
  wh: "#e8e6df",       // primary text
  dm: "#a8a290",       // dim text
  mt: "#6a6660",       // muted
};

const POLL_INTERVAL_MS = 5000;
const MAX_ROWS = 200;

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

// ─── Connection status indicator ──────────────────────────────────────────────
function StatusPill({ status }) {
  // Determines a 3-state visual: green (healthy), amber (stale), red (error).
  // Stale = connected:true but no event in 30s (heartbeat should arrive every 10s).
  const connected = status?.connected;
  const err = status?.last_error;
  const lastEventAt = status?.last_event_at;
  const stale = connected && lastEventAt
    && (Date.now() - new Date(lastEventAt).getTime()) > 30_000;

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

// ─── Alert row ────────────────────────────────────────────────────────────────
function AlertRow({ alert, isNew }) {
  // Cell color cues:
  //   alertType: algo=amber, custom=blue
  //   cp: green for calls (C), red for puts (P)
  const isCall = alert.cp === "C";
  const cpColor = isCall ? P.bu : (alert.cp === "P" ? P.be : P.dm);
  const typeColor = alert.alertType === "algo" ? P.ac : (alert.alertType === "custom" ? P.bl : P.dm);
  const forwarded = alert.forwardedToDiscord;
  const score = alert.convictionScore;
  // Brief amber flash on freshly-arrived rows (CSS animation, no JS timer).
  const flashStyle = isNew ? { animation: "uct-flash 1.4s ease-out" } : {};

  return (
    <tr style={{ borderBottom: "1px solid " + P.bd + "30", ...flashStyle }}>
      <td style={{ padding: "8px 10px", color: P.dm, fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
        {fmtTime(alert.timestamp)}
      </td>
      <td style={{ padding: "8px 10px", fontWeight: 800, color: P.wh, fontSize: 13 }}>
        {alert.ticker || "—"}
      </td>
      <td style={{ padding: "8px 10px", fontWeight: 800, fontSize: 11 }}>
        <span style={{
          padding: "2px 8px", borderRadius: 4,
          background: cpColor + "20", color: cpColor,
        }}>
          {alert.cp || "—"}
        </span>
      </td>
      <td style={{ padding: "8px 10px", fontWeight: 700, color: P.wh, fontSize: 12 }}>
        {alert.strike != null ? "$" + alert.strike.toFixed(alert.strike >= 100 ? 0 : 2) : "—"}
      </td>
      <td style={{ padding: "8px 10px", color: P.wh, fontSize: 11 }}>{alert.exp || "—"}</td>
      <td style={{ padding: "8px 10px", color: P.dm, fontSize: 10 }}>
        {alert.dte != null ? alert.dte + "d" : "—"}
      </td>
      <td style={{ padding: "8px 10px", fontWeight: 800, color: P.ac, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
        {fmtPremium(alert.alertPremium)}
      </td>
      <td style={{ padding: "8px 10px", color: P.dm, fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
        {alert.averageFillPrice != null ? "$" + Number(alert.averageFillPrice).toFixed(2) : "—"}
      </td>
      <td style={{ padding: "8px 10px", fontSize: 9, fontWeight: 700 }}>
        <span style={{
          padding: "2px 7px", borderRadius: 3, letterSpacing: 0.5,
          background: typeColor + "18", color: typeColor,
        }}>
          {(alert.alertType || "?").toUpperCase()}
        </span>
      </td>
      <td style={{ padding: "8px 10px", color: P.wh, fontSize: 11 }}>{alert.alertName || "—"}</td>
      {/* Conviction — color shifts based on threshold (≥2.0 = forwarded color) */}
      <td style={{
        padding: "8px 10px", fontSize: 11, fontWeight: 800, fontFamily: "ui-monospace, monospace",
        color: score >= 2.0 ? P.bu : score >= 1.0 ? P.ac : P.dm, textAlign: "right",
      }}>
        {score != null ? score.toFixed(1) : "—"}
      </td>
      {/* Discord forwarded badge */}
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

// ─── Main page ────────────────────────────────────────────────────────────────
export default function LiveFlow() {
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());  // for relTime re-render
  const lastIdRef = useRef(null);                // tracks newest-seen alert ID for flash detection
  const newIdsRef = useRef(new Set());           // IDs to flash on next render

  // Tick once per second so relative-time labels stay fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Polling loop. Fetches the most recent N alerts, detects new ones, sets
  // them to flash on render. AbortController prevents stale fetches from
  // overwriting fresh state if a previous request is still in flight.
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
        // Detect new alerts since last poll — flash them.
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

  return (
    <div style={{
      minHeight: "100vh", background: P.bg, color: P.wh,
      fontFamily: "Inter, system-ui, sans-serif",
      display: "flex", flexDirection: "column",
    }}>
      {/* CSS keyframes for new-row flash */}
      <style>{`
        @keyframes uct-flash {
          0%   { background: ${P.ac}22; }
          100% { background: transparent; }
        }
      `}</style>

      {/* Header */}
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
            <span style={{ fontSize: 14, fontWeight: 900, color: P.ac, letterSpacing: 0.5 }}>LIVE FLOW</span>
            <span style={{ fontSize: 9, color: P.mt, letterSpacing: 0.5 }}>PHASE B · FILTER ENGINE v1 · DISCORD FORWARDING ACTIVE</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StatusPill status={status} />
          {status && (
            <div style={{ fontSize: 10, color: P.dm, fontFamily: "ui-monospace, monospace", display:"flex", gap:10 }}>
              <span title="Total received from Bullflow (pre-filter)">rx <strong style={{color:P.wh}}>{status.total_alerts_received}</strong></span>
              <span title="Passed table filter, visible in table">shown <strong style={{color:P.wh}}>{status.total_alerts_shown ?? 0}</strong></span>
              <span title="Filtered out (below $250K, blocklist, or grenade)">drop <strong style={{color:P.dm}}>{status.total_alerts_dropped ?? 0}</strong></span>
              <span title="Forwarded to Discord (conviction >= 2.0)">🔔 <strong style={{color:P.bu}}>{status.total_alerts_forwarded ?? 0}</strong></span>
              <span style={{color:P.mt}}>· last {relTime(status.last_event_at)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Active filter summary — minimalist banner */}
        {status?.filter_config && (
          <div style={{
            padding: "8px 20px", borderBottom: "1px solid " + P.bd + "40",
            background: P.cd + "80", fontSize: 10, color: P.dm,
            display: "flex", gap: 14, alignItems: "center",
            fontFamily: "ui-monospace, monospace",
          }}>
            <span style={{ color: P.mt, letterSpacing: 0.5, textTransform: "uppercase", fontSize: 9 }}>filter</span>
            <span>premium ≥ <strong style={{ color: P.wh }}>${(status.filter_config.premium_min / 1000).toFixed(0)}K</strong></span>
            <span>· blocklist: <strong style={{ color: P.wh }}>{(status.filter_config.ticker_blocklist || []).join(", ") || "none"}</strong></span>
            <span>· skip: <strong style={{ color: P.wh }}>{(status.filter_config.alertname_block_substrings || []).join(", ") || "none"}</strong></span>
            <span style={{ marginLeft: "auto" }}>discord ≥ <strong style={{ color: P.bu }}>{status.filter_config.discord_threshold}</strong> conviction</span>
            {!status.discord_configured && (
              <span style={{ color: "#FFB300" }}>⚠ webhook not configured</span>
            )}
          </div>
        )}

        {error && (
          <div style={{
            padding: "10px 20px", background: P.be + "18",
            borderBottom: "1px solid " + P.be + "60",
            color: P.be, fontSize: 11,
          }}>
            Polling error: {error}
          </div>
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
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "60px 20px", color: P.dm, gap: 8,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>
              {status?.connected ? "Connected, waiting for alerts…" : "Connecting to stream…"}
            </div>
            <div style={{ fontSize: 10, color: P.mt }}>
              Bullflow algo alerts fire on unusual activity. Quiet stretches are normal.
            </div>
            {status?.started_at && (
              <div style={{ fontSize: 9, color: P.mt, marginTop: 8, fontFamily: "ui-monospace, monospace" }}>
                worker started {relTime(status.started_at)}
              </div>
            )}
          </div>
        ) : (
          <table style={{
            width: "100%", borderCollapse: "collapse",
            fontFamily: "Inter, system-ui, sans-serif",
          }}>
            <thead style={{
              position: "sticky", top: 0, background: P.cd, zIndex: 1,
            }}>
              <tr style={{ borderBottom: "1px solid " + P.bd }}>
                {[
                  ["Time", 10], ["Ticker", 13], ["C/P", 11], ["Strike", 12],
                  ["Exp", 11], ["DTE", 10], ["Premium", 12], ["Avg Fill", 11],
                  ["Type", 9], ["Alert Name", 11], ["Score", 11], ["🔔", 11],
                ].map(([label, fs]) => (
                  <th key={label} style={{
                    padding: "8px 10px", textAlign: label === "Score" ? "right" : (label === "🔔" ? "center" : "left"),
                    color: P.dm, fontSize: 9, fontWeight: 700,
                    letterSpacing: 0.5, textTransform: "uppercase",
                  }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <AlertRow key={a.id || (a.symbol + ":" + a.timestamp)} alert={a}
                  isNew={newIdsRef.current.has(a.id)} />
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
          Polling /api/live/alerts/recent every {POLL_INTERVAL_MS / 1000}s
          · buffer max {MAX_ROWS}
        </div>
        <div>
          {alerts.length > 0 && "showing " + alerts.length + " · "}
          updated {relTime(new Date(now).toISOString())}
        </div>
      </div>
    </div>
  );
}
