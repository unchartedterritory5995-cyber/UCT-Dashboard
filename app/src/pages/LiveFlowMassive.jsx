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
// Default cap on alerts in the live feed. Backend supports up to 20000.
// 500 covers ~8-15 minutes of market-open activity (initial flood ~100/min
// settling to 30-50/min). User can change via selector in the toolbar.
// "All" sends a very high limit (20000) — returns the full day. Note: the
// BULL/BEAR/NET cards are day-scoped via a separate endpoint, so they
// ALWAYS include every classifiable alert regardless of this setting.
const ROW_LIMIT_OPTIONS = [200, 500, 1000, "All"];
const ROW_LIMIT_DEFAULT = 500;
const ROW_LIMIT_ALL_VALUE = 20000;  // sent to backend when user picks "All"
const LS_KEY_ROW_LIMIT = "uct_liveflow_massive_rowlimit_v1";
const LS_KEY_HIDE_ALGO = "uct_liveflow_massive_hidealgo_v1";
const LS_KEY_CURATED   = "uct_liveflow_massive_curated_v1";

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
      // Sticky handled by the parent wrapper that groups MarketReadCard +
      // FilterChips + ColumnHeaders together. This card is just visual.
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
function FilterChips({ filters, onChange, counts }) {
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
function AlertRow({ alert, isNew, hitCount, currentSpot, onClickTicker, onClickContract }) {
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
      // TIME | TICKER+×N | STRIKE | C/P | EXP | PRICE | VOL | OI | V/OI | PREMIUM | GRADE | SIDE | TYPE | P/L | ALERT
      gridTemplateColumns: "98px 100px 80px 42px 100px 70px 70px 70px 60px 95px 60px 50px 55px 75px 1fr",
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
          title={meta.desc ? `${meta.label} — ${meta.desc}` : meta.label}
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            padding: isAlpha ? "3px 7px" : "2px 6px", borderRadius: 3,
            background: isAlpha ? meta.color : `${meta.color}25`,
            color: isAlpha ? P.bg : meta.color,
            textTransform: "uppercase", flexShrink: 0,
            cursor: "help",
          }}>
          {isAlpha && "★ "}{meta.label}
        </span>
        <span style={{
          color: alertNameColor,
          fontWeight: isAlpha ? 600 : 500,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
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
function ColumnHeaders() {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "98px 100px 80px 42px 100px 70px 70px 70px 60px 95px 60px 50px 55px 75px 1fr",
      gap: 8, padding: "6px 12px",
      fontSize: 11, color: P.mt, fontWeight: 600, letterSpacing: 0.5,
      borderBottom: `1px solid ${P.bd}`, marginBottom: 4,
    }}>
      <span style={{ textAlign: "center" }}>TIME</span>
      <span style={{ textAlign: "center" }}>TICKER</span>
      <span style={{ textAlign: "center" }}>STRIKE</span>
      <span style={{ textAlign: "center" }}>C/P</span>
      <span style={{ textAlign: "center" }}>EXP</span>
      <span style={{ textAlign: "center" }}>PRICE</span>
      <span style={{ textAlign: "center" }}>VOL</span>
      <span style={{ textAlign: "center" }}>OI</span>
      <span style={{ textAlign: "center" }}>V/OI</span>
      <span style={{ textAlign: "center" }}>PREMIUM</span>
      <span style={{ textAlign: "center" }}>GRADE</span>
      <span style={{ textAlign: "center" }}>SIDE</span>
      <span style={{ textAlign: "center" }}>TYPE</span>
      <span style={{ textAlign: "center" }}>P/L</span>
      <span style={{ textAlign: "left", paddingLeft: 4 }}>ALERT</span>
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
  if (tier === "unusual") {
    const u = thresholds?.unusual || {};
    return prem >= (u.min_premium ?? 100000) && vOI >= (u.vOI ?? 5.0);
  }
  if (!["alpha","size","leaps","bullish","bearish"].includes(tier)) return false;
  const stack = thresholds?.stack || {};
  const premCaps = thresholds?.premium_by_cap?.[tier] || {};
  const band = _capBandFE(mktCap, thresholds?.cap_bands);
  let signals = 0;
  if (prem >= (premCaps[band] ?? 0)) signals++;
  if (vOI >= (stack.vOI ?? 3.0)) signals++;
  if (hitCount >= (stack.hit_count ?? 3)) signals++;
  const minGradeN = _GRADE_NUMERIC_FE[stack.grade ?? "B"] ?? 2;
  if ((_GRADE_NUMERIC_FE[grade] ?? 0) >= minGradeN) signals++;
  return signals >= (stack.min_signals ?? 2);
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
      </div>

      {/* Stacking criteria */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: P.wh, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
          STACKING SIGNALS — alert qualifies if ≥{" "}
          <NumberInput value={thresholds.stack.min_signals}
            onChange={v => setPath(["stack","min_signals"], v)} step={1} min={1} />
          {" "}signals met (out of 4):
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingLeft: 12 }}>
          <div><Label>V/OI ≥</Label>
            <NumberInput value={thresholds.stack.vOI}
              onChange={v => setPath(["stack","vOI"], v)} step={0.5} />
            <span style={{ color: P.dm, fontSize: 10, marginLeft: 4 }}>x</span>
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
            (premium threshold below also counts as a signal)
          </div>
        </div>
      </div>

      {/* Premium by tier × cap band */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: P.wh, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
          PREMIUM FLOORS by tier × cap band (mid-small &lt; $10B, mega &gt; $200B):
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

      <div style={{
        marginTop: 12, padding: "6px 10px", background: P.bg,
        borderRadius: 3, fontSize: 10, color: P.mt, fontStyle: "italic",
      }}>
        Note: changes take effect on next 5s poll cycle after Save. Algo tier is
        always excluded from Curated. True "Unusual name" (dormant-ticker)
        detection is planned — current Unusual uses the V/OI rule only.
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

  // Persist controls
  useEffect(() => { saveFilters(filters); }, [filters]);
  useEffect(() => { localStorage.setItem(LS_KEY_SORT, sortBy); }, [sortBy]);
  useEffect(() => { localStorage.setItem(LS_KEY_MINGRADE, minGrade); }, [minGrade]);
  useEffect(() => { localStorage.setItem(LS_KEY_ROW_LIMIT, String(rowLimit)); }, [rowLimit]);
  useEffect(() => { localStorage.setItem(LS_KEY_HIDE_ALGO, hideAlgo ? "1" : "0"); }, [hideAlgo]);
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
  }, [sortBy, minGrade, targetDate, rowLimit, filters, curated]);

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
  }, [targetDate, hideAlgo]);

  // Apply client-side filters: tier chips, ticker, contract, hideAlgo.
  // Tier filtering now happens here (was previously per-section); the
  // remaining list goes straight into the flat chronological feed.
  //
  // Final sort is ALWAYS by timestamp descending — even when the backend
  // returned alerts ranked by conviction or premium. The sort criterion
  // selects WHICH alerts the page sees (top N by conviction, etc.) but
  // they're always displayed chronologically so the trader can scan the
  // session's flow in real time order.
  const visibleAlerts = alerts
    .filter(a => {
      const tier = a._tierKey || "algo";
      if (hideAlgo && tier === "algo") return false;  // global Algo hide
      if (!filters[tier]) return false;
      if (tickerFilter.size > 0 && !tickerFilter.has(a.ticker)) return false;
      if (contractFilter.size > 0) {
        const k = `${a.ticker}|${a.cp}|${a.strike}|${a.exp}`;
        if (!contractFilter.has(k)) return false;
      }
      return true;
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

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

      {/* STICKY HEADER GROUP — Market Read + filter chips + column headers
          all stay pinned together as the user scrolls through alerts.
          Single sticky container (not three separate sticky elements) so they
          stack predictably without z-index conflicts or "later element
          overlaps earlier one" sticky-stacking bugs. */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: P.bg,  // must be opaque or scrolling alerts bleed through
        // Negative side margin lets the sticky background extend to the
        // page edges, matching the parent's 16px padding so there's no
        // visible gap on either side as alerts scroll behind it.
        marginLeft: -16, marginRight: -16,
        paddingLeft: 16, paddingRight: 16,
        paddingBottom: 4,
      }}>
        {/* MARKET READ — day-scoped aggregated bull/bear positioning */}
        <MarketReadCard stats={dayStats} />

        <FilterChips filters={filters} onChange={setFilters} counts={tierCounts} />

        <ColumnHeaders />
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
        Source: Massive WS via FlowDB ・ Polling every {POLL_INTERVAL_MS/1000}s ・
        TEST PAGE — sister to <a href="/live-flow" style={{ color: P.ac }}>/live-flow</a> (Bullflow)
      </div>
    </div>
  );
}
