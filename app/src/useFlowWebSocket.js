import { useEffect, useRef, useState, useCallback } from "react";

/**
 * useFlowWebSocket — connects to backend /ws/live-flow
 *
 * Returns:
 *   newRows       — array of BBS CSV row strings received since last clear
 *   clearRows()   — call after merging into main state
 *   wsStatus      — "connecting" | "connected" | "disconnected"
 *   uwConnected   — whether backend is connected to UW upstream
 */
export function useFlowWebSocket() {
  const [newRows, setNewRows] = useState([]);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [uwConnected, setUwConnected] = useState(false);

  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const pingTimer = useRef(null);
  const backoff = useRef(1000);

  const clearRows = useCallback(() => setNewRows([]), []);

  useEffect(() => {
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      // Build WS URL from current location (works in dev + prod)
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      // In dev, backend is usually on a different port — adjust if needed
      const host = import.meta.env.VITE_WS_HOST || window.location.host;
      const url = `${proto}//${host}/ws/live-flow`;

      setWsStatus("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) return;
        setWsStatus("connected");
        backoff.current = 1000; // reset backoff

        // Heartbeat every 25s to keep connection alive
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        if (unmounted) return;
        if (event.data === "pong") return; // heartbeat response

        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "flow") {
            setNewRows((prev) => [msg.row, ...prev]);
          } else if (msg.type === "flow_batch") {
            setNewRows((prev) => [...msg.rows.reverse(), ...prev]);
          } else if (msg.type === "status") {
            setUwConnected(msg.connected ?? false);
          }
        } catch (e) {
          console.warn("WS parse error:", e);
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        cleanup();
        setWsStatus("disconnected");
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after this
        ws.close();
      };
    }

    function cleanup() {
      if (pingTimer.current) {
        clearInterval(pingTimer.current);
        pingTimer.current = null;
      }
    }

    function scheduleReconnect() {
      if (unmounted) return;
      reconnectTimer.current = setTimeout(() => {
        connect();
        backoff.current = Math.min(backoff.current * 2, 30000);
      }, backoff.current);
    }

    connect();

    return () => {
      unmounted = true;
      cleanup();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return { newRows, clearRows, wsStatus, uwConnected };
}
