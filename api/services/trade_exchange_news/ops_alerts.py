"""Administrator alerts for the permanent News archive -- never only a log line.

Owner, 2026-10-31: *"Alert administrators when backups, integrity checks, or recovery
operations fail. Do not rely solely on logs. Reuse existing UCT operational alerting
infrastructure where possible."* So every alert here is posted to the OPS destination
the rest of UCT's operational alarms use (``alert_destination.ops_webhook``: the ops
Discord channel, today the admin channel it falls back to), AND logged, AND kept in
``recent()`` for the admin status.

Two shapes:
  * ``alert(key, text)`` -- a one-off event (an integrity check found a problem);
  * ``condition(key, failing, text)`` -- a STATE (the journal is unreachable, R2 has
    not confirmed some headlines): it alerts once the condition has held for
    ``after_s``, reminds every ``REMIND_S`` while it still holds, and posts one
    "resolved" when it clears -- so a flapping or a long outage is neither silent
    nor a flood.

⛔ COUNTS AND TIMES ONLY. A message never carries headline content, an event's text,
a credential or a URL -- the same rule as every News log line.
Never raises: an alert fault must never cost a headline or stop a check.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import deque
from typing import Any

logger = logging.getLogger(__name__)

PRODUCER = "api.services.trade_exchange_news.ops_alerts"
REMIND_S = 6 * 3600
_lock = threading.Lock()
_conditions: dict[str, dict[str, Any]] = {}
_recent: deque = deque(maxlen=50)


def _post(text: str) -> bool:
    """POST one message to the OPS webhook. Returns whether it was delivered."""
    from api.services.alert_destination import ops_webhook
    url = (ops_webhook("critical", producer=PRODUCER) or "").strip()
    if not url:
        return False
    import urllib.request
    req = urllib.request.Request(url, data=json.dumps({"content": text[:1900]}).encode(),
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "uct-news-archive/1"})
    with urllib.request.urlopen(req, timeout=10) as r:
        r.read(64)
    return True


def _send(key: str, text: str, level: str) -> None:
    msg = f"UCT News archive [{level}] {text}"
    (logger.warning if level == "resolved" else logger.error)("[txn] ops alert %s: %s", key, text)
    entry = {"key": key, "level": level, "text": text, "at_ms": int(time.time() * 1000), "delivered": None}
    with _lock:
        _recent.append(entry)

    def run() -> None:
        try:
            entry["delivered"] = _post(msg)
        except Exception as e:  # noqa: BLE001 -- never raises
            entry["delivered"] = False
            logger.warning("[txn] ops alert post failed: %s", type(e).__name__)

    threading.Thread(target=run, name="txn-ops-alert", daemon=True).start()


def alert(key: str, text: str) -> None:
    try:
        _send(key, text, "alert")
    except Exception:  # noqa: BLE001
        pass


def condition(key: str, failing: bool, text: str = "", *, after_s: float = 600,
              now: float | None = None) -> None:
    try:
        t = time.time() if now is None else now
        with _lock:
            st = _conditions.get(key)
            if not failing:
                if st is None:
                    return
                _conditions.pop(key, None)
                alerted = st["alerted_at"] is not None
            else:
                if st is None:
                    st = _conditions[key] = {"since": t, "alerted_at": None}
                due = (st["alerted_at"] is None and t - st["since"] >= after_s) or \
                      (st["alerted_at"] is not None and t - st["alerted_at"] >= REMIND_S)
                if due:
                    st["alerted_at"] = t
        if not failing:
            if alerted:
                _send(key, f"resolved: {key}", "resolved")
            return
        if due:
            _send(key, text, "alert")
    except Exception:  # noqa: BLE001
        pass


def recent() -> list[dict[str, Any]]:
    with _lock:
        return [dict(e) for e in _recent]


def active() -> dict[str, int]:
    """key -> since (ms) for every condition currently failing."""
    with _lock:
        return {k: int(v["since"] * 1000) for k, v in _conditions.items()}


def _reset_for_tests() -> None:
    with _lock:
        _conditions.clear()
        _recent.clear()
