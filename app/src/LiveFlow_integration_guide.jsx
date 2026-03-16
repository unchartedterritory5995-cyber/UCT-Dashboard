// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LiveFlow.jsx — WebSocket Integration Guide
//  Apply these changes to your existing LiveFlow.jsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── 1. IMPORT the hook ─────────────────────────────────────────────────
import { useFlowWebSocket } from "./useFlowWebSocket";

// ── 2. INSIDE your LiveFlow component, add near the top ────────────────
//    (alongside your existing useState/useEffect hooks)

const { newRows, clearRows, wsStatus, uwConnected } = useFlowWebSocket();

// ── 3. MERGE new WS rows into existing CSV data ────────────────────────
//    This effect fires whenever newRows accumulates entries.
//    It prepends them to your raw CSV string, re-processes, then clears.

useEffect(() => {
  if (newRows.length === 0) return;

  setRawCsv((prevCsv) => {
    // Prepend new rows at the top (newest first)
    const newBlock = newRows.join("\n");
    if (!prevCsv || prevCsv.trim() === "") return newBlock;

    // Split to get header + existing rows
    const lines = prevCsv.split("\n");
    const header = lines[0];
    const existingRows = lines.slice(1).join("\n");

    return `${header}\n${newBlock}\n${existingRows}`;
  });

  // Update timestamp
  setLastUpdated(new Date());

  // Clear the buffer so we don't re-process
  clearRows();
}, [newRows, clearRows]);

// ── 4. CONNECTION STATUS INDICATOR ─────────────────────────────────────
//    Add this JSX near your existing header / refresh button area.

/*
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>

    {/* WebSocket status dot *\/}
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      fontSize: 12, color: "#aaa",
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background:
          wsStatus === "connected" && uwConnected ? "#22c55e"   // green — fully live
          : wsStatus === "connected"               ? "#eab308"   // yellow — WS ok, UW pending
          :                                          "#ef4444",  // red — disconnected
        boxShadow:
          wsStatus === "connected" && uwConnected
            ? "0 0 6px #22c55e88"
            : "none",
        animation:
          wsStatus === "connected" && uwConnected
            ? "pulse 2s ease-in-out infinite"
            : "none",
      }} />
      {wsStatus === "connected" && uwConnected
        ? "Live"
        : wsStatus === "connected"
          ? "Connecting to UW..."
          : "Reconnecting..."}
    </div>

    {/* Existing refresh button stays as fallback *\/}
    <button onClick={handleRefresh} disabled={loading}>
      Refresh
    </button>

  </div>
*/

// ── 5. CSS KEYFRAMES (add to your stylesheet or <style> tag) ──────────

/*
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
*/

// ── 6. NEW ROW HIGHLIGHT (optional but nice) ───────────────────────────
//    In your flow table row renderer, you can flash new rows:

/*
  // Track which rows are "new" (arrived via WS in last 5 seconds)
  const [flashRows, setFlashRows] = useState(new Set());

  // In the WS merge effect, mark new row identifiers
  useEffect(() => {
    if (newRows.length === 0) return;
    const keys = newRows.map(r => {
      const cols = r.split(",");
      return `${cols[1]}-${cols[3]}-${cols[4]}-${cols[0]}`; // ticker-strike-exp-time
    });
    setFlashRows(prev => new Set([...prev, ...keys]));

    // Auto-clear flash after 5s
    setTimeout(() => {
      setFlashRows(prev => {
        const next = new Set(prev);
        keys.forEach(k => next.delete(k));
        return next;
      });
    }, 5000);
  }, [newRows]);

  // In your row JSX:
  // <tr className={flashRows.has(rowKey) ? "flash-new" : ""}>

  // CSS:
  // .flash-new { animation: flashIn 0.4s ease-out; background: rgba(34,197,94,0.08); }
  // @keyframes flashIn { from { background: rgba(34,197,94,0.25); } }
*/

// ── 7. ENV VARIABLE (optional) ─────────────────────────────────────────
//    If your dev server runs the frontend on a different port than the
//    backend, set VITE_WS_HOST in your .env:
//
//      VITE_WS_HOST=localhost:8000
//
//    In production (Railway), the frontend and backend share the same
//    host, so this isn't needed.

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ARCHITECTURE SUMMARY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//  ┌─────────┐     wss://      ┌──────────────┐    wss://    ┌──────────┐
//  │   UW    │ ──────────────▶ │  FastAPI      │ ──────────▶ │ React    │
//  │ Socket  │  flow_alerts    │  uw_websocket │  /ws/live   │ LiveFlow │
//  └─────────┘                 │  .py (relay)  │  -flow      │ .jsx     │
//                              └──────────────┘              └──────────┘
//
//  • Backend maintains ONE persistent connection to UW
//  • Transforms each alert to BBS CSV format (same as uw_live_flow.py)
//  • Broadcasts to all connected frontend clients
//  • Frontend prepends new rows, re-runs processFlowData
//  • Auto-reconnect with exponential backoff on both sides
//  • Manual Refresh button stays as fallback
//
