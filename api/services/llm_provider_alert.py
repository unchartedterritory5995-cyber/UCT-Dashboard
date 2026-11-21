"""THE MODEL PROVIDER IS REFUSING OUR ACCOUNT: tell a person, once, and say when it is back.

2026-11-20: the provider refused the account and every model-backed feature answered "not available right
now" for members. Nobody was told. The refusal was an ERROR line in a log and a telemetry class; it was
found half an hour in, by a test run that happened to be going. An outage of this kind does not heal by
itself: a person tops up a balance or replaces a key.

    refused(kind, door)   the first refusal pages the ops channel; then at most one page per
                          ``ALERT_EVERY_S`` per process while it lasts
    answered()            the first model call that succeeds after a refusal sends ONE "back" line

⛔ WHAT A PAGE MAY CARRY: the KIND of refusal, one of a closed set of words
(``definition_concierge.account_refusal_class``); the service; when it was first seen; the one thing a
person does. NEVER the provider's own text, never a key, never anything of a member's. ``kind`` is checked
against the closed set at the ONE place a line is written (``page_text`` / ``back_text``): anything else is
said as "unclassified", so a caller that passed the provider's text by mistake still could not put it in
the channel.

⛔ INERT OFF RAILWAY. With no ``RAILWAY_SERVICE_NAME`` (a laptop, a test, CI) nothing is ever posted,
whatever webhook variables that machine holds.

Per process, like the other in-process alert dedups (CLAUDE.md, "SINGLE-PROCESS assumptions"): a second
web process would page once more per window, and each sends its own "back" line.

Destination: the OPS class, resolved at call time through ``alert_destination.ops_webhook`` at the highest
severity, as producer ``llm_provider_account_refusal``. Never blocks or fails the request that noticed.
"""
from __future__ import annotations

import datetime
import json
import logging
import os
import threading
import time
import urllib.request
from typing import Callable, Dict, Optional

log = logging.getLogger(__name__)

PRODUCER = "llm_provider_account_refusal"
SEVERITY = "critical"
#: At most one page per this many seconds per process while the refusal lasts.
ALERT_EVERY_S = 30 * 60
SERVICE_ENV = "RAILWAY_SERVICE_NAME"

#: kind -> the ONE thing a person does. The keys are exactly the closed set the classifier returns
#: (``tests/test_llm_provider_alert.py`` holds the two to each other).
ACTIONS: Dict[str, str] = {
    "credit balance": "top up the provider's credit balance",
    "billing or payment": "check billing with the provider",
    "key or sign-in": "check the API key",
    "permission": "check what the API key is allowed to do",
    "unclassified": "check the provider console: the balance, billing and the API key",
}

_lock = threading.Lock()
_state: Dict[str, object] = {"since": None, "kind": None, "paged_at": None}


def _service() -> str:
    return (os.environ.get(SERVICE_ENV) or "").strip()


def _hhmm(epoch: float) -> str:
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).strftime("%H:%MZ")


def page_text(kind: str, service: str, since: float) -> str:
    kind = kind if kind in ACTIONS else "unclassified"
    return (f"\U0001F534 **The AI provider is refusing UCT's account** ({kind}). Service: {service}. "
            f"First seen {_hhmm(since)}. Every feature that needs the model answers \"not available right now\" "
            f"until a person fixes it. To do: {ACTIONS[kind]}.")


def back_text(kind: str, service: str, since: float, now: float) -> str:
    kind = kind if kind in ACTIONS else "unclassified"
    return (f"\U0001F7E2 The AI provider is answering again. Service: {service}. "
            f"It refused the account from {_hhmm(since)} to {_hhmm(now)} ({kind}).")


def _post(text: str) -> None:
    """The ops channel, on its own thread: never blocks the request that noticed, never raises."""
    def send() -> None:
        try:
            from api.services.alert_destination import ops_webhook
            url = (ops_webhook(SEVERITY, producer=PRODUCER) or "").strip()
            if not url:
                # ⭐ 2026-11-20: said, because a page nobody was sent looks exactly like a page that was
                log.warning("[llm-provider] no ops destination is set: the page was NOT sent")
                return
            req = urllib.request.Request(url, data=json.dumps({"content": text[:1900]}).encode("utf-8"),
                                         headers={"Content-Type": "application/json",
                                                  "User-Agent": "UCT-llm-provider/1.0"}, method="POST")
            with urllib.request.urlopen(req, timeout=10) as r:
                r.read(64)
            # ⭐ 2026-11-20: the first real page could not be confirmed from the log (success said nothing).
            # ⛔ The fact only: never the destination (a webhook address is a credential), never the text.
            log.info("[llm-provider] the page was posted to the ops channel")
        except Exception as exc:                    # noqa: BLE001 -- a page that cannot be sent is not the turn's failure
            # the KIND of failure only: an error's own text or traceback can carry the webhook address
            log.warning("[llm-provider] the page could not be posted: %s", type(exc).__name__)

    try:
        threading.Thread(target=send, daemon=True, name="llm-provider-page").start()
    except Exception:                               # noqa: BLE001
        pass


def refused(kind: str, door: str = "", *, now: Optional[float] = None,
            post: Optional[Callable[[str], None]] = None) -> bool:
    """A model call was refused for OUR ACCOUNT. Pages on the first one, then at most once per
    ``ALERT_EVERY_S``. True when a page was handed to the channel. Never raises."""
    try:
        service = _service()
        if not service:
            return False
        t = time.time() if now is None else float(now)
        with _lock:
            if _state["since"] is None:
                _state["since"], _state["kind"] = t, kind      # (checked against the closed set where it is SAID: `page_text`)
            paged_at = _state["paged_at"]
            if paged_at is not None and t - float(paged_at) < ALERT_EVERY_S:
                return False
            _state["paged_at"] = t
            text = page_text(str(_state["kind"]), service, float(_state["since"]))
        (post or _post)(text)
        return True
    except Exception:                               # noqa: BLE001
        return False


def answered(*, now: Optional[float] = None, post: Optional[Callable[[str], None]] = None) -> bool:
    """A model call succeeded. If a refusal was outstanding, send ONE "back" line. True when it was sent.
    ⭐ The common case (no refusal outstanding) reads one value and returns. Never raises."""
    try:
        if _state["since"] is None:
            return False
        service = _service()
        t = time.time() if now is None else float(now)
        with _lock:
            since, kind, paged = _state["since"], _state["kind"], _state["paged_at"]
            if since is None:
                return False
            _state["since"], _state["kind"], _state["paged_at"] = None, None, None
        if not service or paged is None:            # (nothing was ever said, so there is nothing to take back)
            return False
        (post or _post)(back_text(str(kind), service, float(since), t))
        return True
    except Exception:                               # noqa: BLE001
        return False


def _reset_for_tests() -> None:
    with _lock:
        _state["since"], _state["kind"], _state["paged_at"] = None, None, None
