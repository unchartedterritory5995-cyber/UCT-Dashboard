"""Per-source pass-rate circuit breaker.

Tracks attempts in a rolling 1-hour window. When pass rate drops below 95%
(with at least 20 attempts recorded), the source is marked 'degraded' and
fetch_with_validation should skip it. Auto-recovers when a fresh window
shows 95%+ pass rate.
"""
import threading
import time
from collections import deque

_WINDOW_SEC = 3600  # 1 hour
_MIN_ATTEMPTS = 20
_PASS_RATE_THRESHOLD = 0.95

_lock = threading.RLock()
_attempts: dict[str, deque] = {}


def _reset():
    """Test helper -- clear all state."""
    with _lock:
        _attempts.clear()


def _reset_source(source: str):
    with _lock:
        _attempts.pop(source, None)


def _prune(source: str, now: int):
    if source not in _attempts:
        return
    cutoff = now - _WINDOW_SEC
    dq = _attempts[source]
    while dq and dq[0][0] < cutoff:
        dq.popleft()


def record_attempt(source: str, success: bool, now: int | None = None):
    if now is None:
        now = int(time.time())
    with _lock:
        if source not in _attempts:
            _attempts[source] = deque()
        _attempts[source].append((now, success))
        _prune(source, now)


def pass_rate(source: str, now: int | None = None) -> float:
    if now is None:
        now = int(time.time())
    with _lock:
        _prune(source, now)
        dq = _attempts.get(source)
        if not dq:
            return 1.0
        passes = sum(1 for _, ok in dq if ok)
        return passes / len(dq)


def state(source: str, now: int | None = None) -> str:
    if now is None:
        now = int(time.time())
    with _lock:
        _prune(source, now)
        dq = _attempts.get(source)
        if not dq or len(dq) < _MIN_ATTEMPTS:
            return "ok"
        rate = pass_rate(source, now)
        return "degraded" if rate < _PASS_RATE_THRESHOLD else "ok"


def is_ok(source: str, now: int | None = None) -> bool:
    return state(source, now) == "ok"


def all_states(now: int | None = None) -> dict[str, dict]:
    """Return per-source telemetry -- used by admin endpoint."""
    if now is None:
        now = int(time.time())
    with _lock:
        result = {}
        for source in list(_attempts.keys()):
            _prune(source, now)
            dq = _attempts.get(source)
            n = len(dq) if dq else 0
            rate = pass_rate(source, now)
            result[source] = {
                "attempts": n,
                "pass_rate": round(rate, 3),
                "state": state(source, now),
            }
        return result
