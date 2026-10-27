"""Web's Sentry before_send: credentials in URLs never leave the process.

Covers the existing sensitive webhook route (TERM-086 inbound alerts) and the
Trade Exchange receiver's own scrubber, and proves unrelated error data is kept.
"""
from __future__ import annotations

import ast
import copy
import json
import pathlib

import sentry_sdk
from sentry_sdk.transport import Transport

from api import logging_redaction as lr
from api import sentry_redaction as sr
from tests.support.txn_fakes import load_receiver

REPO = pathlib.Path(__file__).resolve().parents[1]
HOOK_SECRET = "iah_" + "S" * 40
TXN_SECRET = "txn_" + "T" * 43


def _event():
    return {
        "request": {"url": f"https://uctintelligence.com/api/inbound-alerts/hook/{HOOK_SECRET}",
                    "query_string": "token=abc123&page=2&Signature=zz",
                    "method": "POST", "headers": {"Referer": f"https://x/api/inbound-alerts/hook/{HOOK_SECRET}",
                                                  "User-Agent": "TradingView"}},
        "transaction": f"/api/inbound-alerts/hook/{HOOK_SECRET}",
        "breadcrumbs": {"values": [{"category": "httplib",
                                    "data": {"url": f"http://x/api/inbound-alerts/hook/{HOOK_SECRET}?a=1"}}]},
        "exception": {"values": [{"type": "ValueError", "value": f"bad at /api/inbound-alerts/hook/{HOOK_SECRET}",
                                  "stacktrace": {"frames": [{"filename": "api/routers/inbound_alerts.py",
                                                             "lineno": 140, "function": "receive_alert"}]}}]},
        "spans": [{"description": f"POST /api/inbound-alerts/hook/{HOOK_SECRET}"}],
        "tags": {"route": "inbound-alerts"},
        "level": "error",
    }


def test_the_inbound_alerts_hook_secret_is_redacted_everywhere_it_appears():
    out = sr.before_send(_event())
    blob = json.dumps(out)
    assert HOOK_SECRET not in blob and "abc123" not in blob and "zz" not in blob
    assert out["request"]["url"].endswith("/api/inbound-alerts/hook/" + lr.PATH_REDACTION)
    assert "page=2" in out["request"]["query_string"]


def test_unrelated_error_data_is_preserved():
    ev = _event()
    out = sr.before_send(copy.deepcopy(ev))
    assert out["tags"] == ev["tags"] and out["level"] == "error"
    assert out["exception"]["values"][0]["type"] == "ValueError"
    assert out["exception"]["values"][0]["stacktrace"] == ev["exception"]["values"][0]["stacktrace"]
    assert out["request"]["method"] == "POST"
    assert out["request"]["headers"]["User-Agent"] == "TradingView"
    plain = {"request": {"url": "https://uctintelligence.com/api/bars/NVDA?tf=D&bars=600"},
             "message": "ordinary failure"}
    assert sr.before_send(copy.deepcopy(plain)) == plain


def test_transactions_are_scrubbed_too():
    out = sr.before_send_transaction({"transaction": f"/api/inbound-alerts/hook/{HOOK_SECRET}",
                                      "spans": [{"description": f"GET /x?token={HOOK_SECRET}"}]})
    assert HOOK_SECRET not in json.dumps(out)


def test_redaction_failure_drops_url_fields_rather_than_leaking(monkeypatch):
    monkeypatch.setattr(sr, "_walk", lambda _o: (_ for _ in ()).throw(RuntimeError("boom")))
    out = sr.before_send(_event())
    assert "url" not in out["request"] and "spans" not in out
    assert out["level"] == "error"


def test_the_path_list_is_the_logging_backstop_list_not_a_second_copy():
    src = (REPO / "api" / "sentry_redaction.py").read_text(encoding="utf-8")
    assert "from api.logging_redaction import PATH_REDACTION, REDACTED_PATH_PREFIXES" in src
    assert "/api/inbound-alerts/hook/" not in src.split('"""', 2)[2]


def test_main_wires_both_hooks_into_sentry_init():
    tree = ast.parse((REPO / "api" / "main.py").read_text(encoding="utf-8"))
    inits = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Attribute) and n.func.attr == "init"
             and isinstance(n.func.value, ast.Name) and n.func.value.id == "sentry_sdk"]
    assert len(inits) == 1
    kws = {k.arg: ast.unparse(k.value) for k in inits[0].keywords}
    assert kws["before_send"] == "_sentry_redaction.before_send"
    assert kws["before_send_transaction"] == "_sentry_redaction.before_send_transaction"


class _Capture(Transport):
    def __init__(self):
        super().__init__()
        self.envelopes = []

    def capture_envelope(self, envelope):
        self.envelopes.append(envelope)


def test_end_to_end_through_the_real_sdk():
    """A real sentry_sdk client with the hooks: what would be SENT carries no secret."""
    t = _Capture()
    client = sentry_sdk.Client(dsn="https://k@o0.ingest.sentry.io/0", transport=t,
                               before_send=sr.before_send, default_integrations=False)
    import sys
    from sentry_sdk.utils import event_from_exception
    try:
        raise ValueError(f"failed at /api/inbound-alerts/hook/{HOOK_SECRET}")
    except ValueError:
        ev, hint = event_from_exception(sys.exc_info(), client_options=client.options)
    ev["request"] = {"url": f"https://uctintelligence.com/api/inbound-alerts/hook/{HOOK_SECRET}"}
    assert client.capture_event(ev, hint, scope=sentry_sdk.Scope(client=client))
    client.flush()
    sent = b"".join(item.payload.get_bytes() for env in t.envelopes for item in env.items)
    assert sent and HOOK_SECRET.encode() not in sent


def test_the_trade_exchange_receiver_scrubber_covers_every_auth_mode():
    red = load_receiver()["txn_redaction"]
    ev = {"request": {"url": f"https://rx/hook/{TXN_SECRET}",
                      "headers": {"Authorization": f"Bearer {TXN_SECRET}", "X-TXN-Token": TXN_SECRET}},
          "breadcrumbs": {"values": [{"message": f"POST /hook/{TXN_SECRET}"}]}}
    assert TXN_SECRET not in json.dumps(red.scrub_event(ev))
