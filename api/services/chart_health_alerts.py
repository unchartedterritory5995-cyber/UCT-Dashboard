"""Chart-health alerts. In-memory queue of operator alerts.

Triggers (set by other modules):
  - Source pass-rate < 95% (from source_circuit_breaker)
  - WS disconnect > 60s
  - New corruption pattern detected

Alerts surface via /api/admin/bars/alerts (Plan 5 Task 7). Throttled (no
duplicate alerts with the same key within 10 min).
"""
import time
import threading
from collections import deque
from typing import Optional

_lock = threading.RLock()
_alerts: deque = deque(maxlen=200)
_throttle: dict[str, int] = {}  # alert_key -> last_emitted_ts
_THROTTLE_SEC = 600  # 10 min


def emit(alert_key: str, severity: str, message: str, metadata: Optional[dict] = None) -> bool:
    """Emit an alert if not throttled. Returns True if emitted."""
    now = int(time.time())
    with _lock:
        last = _throttle.get(alert_key, 0)
        if now - last < _THROTTLE_SEC:
            return False
        _throttle[alert_key] = now
        _alerts.appendleft({
            "alert_key": alert_key,
            "severity": severity,
            "message": message,
            "metadata": metadata or {},
            "emitted_at": now,
        })
    return True


def list_recent(limit: int = 50) -> list[dict]:
    with _lock:
        return list(_alerts)[:limit]


def clear():
    with _lock:
        _alerts.clear()
        _throttle.clear()
