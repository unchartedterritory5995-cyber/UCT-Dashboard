"""Alert hysteresis + delivery for the chart-data monitor (and its dead-man).

HYSTERESIS (pure, ``step``): a key (``check|tf``) OPENS after ``n_fail`` consecutive failing
observations, posts ONE message, re-reminds at most every ``remind_s`` while still failing, and
RESOLVES (one message) after ``n_clear`` consecutive passing observations. A key that was not
observed this cycle (SKIP: market closed, not enough samples, stream disabled) changes nothing —
absence of evidence never resolves nor opens anything.

DESTINATION: the OPS channel through ``alert_destination.ops_webhook`` (TERM-011 — the same
resolver the bars-freshness watchdog, the down-alert and chart-health pages use; with
``DISCORD_OPS_WEBHOOK_URL`` unset it resolves ``DISCORD_WEBHOOK_URL``). No new secret.

DURABLE STATE: one JSON file on the pod's volume (``DATA_DIR``), atomically replaced, so a
redeploy neither re-posts an open alert nor forgets one.

⛔ PRIVACY: a message carries tickers, tf, check names and counts — never a price.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import urllib.request
from dataclasses import dataclass
from typing import Callable, Optional

from api.services.alert_destination import ops_webhook as _ops_webhook

_log = logging.getLogger("chart_monitor")
_lock = threading.Lock()

UA = "uct-chart-monitor/1"


@dataclass(frozen=True)
class Event:
    kind: str          # "open" | "remind" | "resolve"
    key: str
    detail: str
    since: float       # when the key first failed (open) / opened (resolve)


def step(state: dict, observations: dict, now: float, *, n_fail: int = 2, n_clear: int = 2,
         remind_s: float = 7200) -> tuple[dict, list[Event]]:
    """Advance the per-key hysteresis. ``observations``: key -> (failing: bool, detail: str).

    Returns (new_state, events). Pure: ``state`` is not mutated."""
    new = {k: dict(v) for k, v in (state or {}).items()}
    events: list[Event] = []
    for key, (failing, detail) in sorted(observations.items()):
        s = new.setdefault(key, {"fails": 0, "passes": 0, "open": False,
                                 "first_fail_at": None, "opened_at": None, "notified_at": None})
        if failing:
            s["fails"] += 1
            s["passes"] = 0
            if s["first_fail_at"] is None:
                s["first_fail_at"] = now
            s["detail"] = detail
            if not s["open"] and s["fails"] >= n_fail:
                s["open"] = True
                s["opened_at"] = now
                s["notified_at"] = now
                events.append(Event("open", key, detail, s["first_fail_at"]))
            elif s["open"] and now - float(s["notified_at"] or 0) >= remind_s:
                s["notified_at"] = now
                events.append(Event("remind", key, detail, float(s["opened_at"] or now)))
        else:
            s["passes"] += 1
            s["fails"] = 0
            if s["open"] and s["passes"] >= n_clear:
                events.append(Event("resolve", key, s.get("detail", ""), float(s["opened_at"] or now)))
                s["open"] = False
                s["opened_at"] = s["notified_at"] = None
            if not s["open"]:
                s["first_fail_at"] = None
        if not s["open"] and not s["fails"]:
            # a fully healthy key carries no state (keeps the file small)
            new.pop(key, None)
    return new, events


def _mins(sec: float) -> str:
    m = int(max(0, sec) // 60)
    return f"{m // 60}h{m % 60:02d}m" if m >= 60 else f"{m}m"


def format_events(events: list[Event], now: float, title: str = "Chart data monitor") -> Optional[str]:
    """One Discord message for a cycle's events (None when there is nothing to say)."""
    if not events:
        return None
    opens = [e for e in events if e.kind == "open"]
    reminds = [e for e in events if e.kind == "remind"]
    res = [e for e in events if e.kind == "resolve"]
    lines = []
    if opens or reminds:
        head = f"🔴 **{title}** — {len(opens) + len(reminds)} check(s) failing"
    else:
        head = f"🟢 **{title}** — resolved"
    lines.append(head)
    for e in opens:
        lines.append(f"• NEW `{e.key}` {e.detail}")
    for e in reminds:
        lines.append(f"• STILL `{e.key}` (open {_mins(now - e.since)}) {e.detail}")
    for e in res:
        lines.append(f"• 🟢 resolved `{e.key}` (was open {_mins(now - e.since)})")
    return "\n".join(lines)[:1900]


def webhook() -> str:
    try:
        return _ops_webhook(producer="chart_monitor")
    except Exception:  # noqa: BLE001 — a destination lookup must never raise into a pager
        return ""


def post(content: str, *, sender: Optional[Callable] = None) -> bool:
    """POST one message to the ops channel. Never raises; False when nothing was delivered."""
    url = webhook()
    if not url:
        _log.warning("[chart-monitor] no ops webhook configured; alert logged only")
        return False
    body = json.dumps({"content": content, "allowed_mentions": {"parse": []}}).encode()
    try:
        if sender is not None:
            return bool(sender(url, body))
        req = urllib.request.Request(url, data=body, method="POST",
                                     headers={"Content-Type": "application/json", "User-Agent": UA})
        with urllib.request.urlopen(req, timeout=10) as r:
            return 200 <= int(getattr(r, "status", 200)) < 300
    except Exception as e:  # noqa: BLE001
        # ⛔ type only: an HTTPError's text can carry the webhook URL (a credential)
        _log.warning("[chart-monitor] alert post failed: %s", type(e).__name__)
        return False


# ───────────────────────────────────────────────────────────── durable state

def state_path(name: str = "chart_monitor_state.json") -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), name)


def load_state(path: str) -> dict:
    with _lock:
        try:
            with open(path, encoding="utf-8") as fh:
                d = json.load(fh)
                return d if isinstance(d, dict) else {}
        except Exception:
            return {}


def save_state(path: str, state: dict) -> None:
    with _lock:
        try:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(state, fh)
            os.replace(tmp, path)
        except Exception as e:  # noqa: BLE001
            _log.warning("[chart-monitor] state write failed: %s", type(e).__name__)
