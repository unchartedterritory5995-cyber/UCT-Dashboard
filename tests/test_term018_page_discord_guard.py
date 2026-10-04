"""TERM-018: `chart_health_alerts._page_discord`'s own suppression, observed DIRECTLY.

Every door-B producer reaches `_page_discord` through `emit`, and `emit` asks
`_should_page_discord(webhook_present=bool(_ops_webhook()))` first - so the
transport's `if not webhook: return` is SHADOWED on that path and a mutation of
it survives the whole door-B suite (measured: 113 passed with the guard weakened
to `if webhook is None:`). These rails call the transport itself, which is what
any future caller that skips the gate would do.

Never a socket: `_urllib` and `threading` are replaced with recorders.
"""
from __future__ import annotations

from api.services import alert_routing as ar
from api.services import chart_health_alerts as cha

TODAY = "https://discord.com/api/webhooks/111/TODAYS-ADMIN-CHANNEL-TOKEN"


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self, _n=None):
        return b""


class _Wire:
    def __init__(self):
        self.posts: list[str] = []

    def Request(self, url, data=None, headers=None):  # noqa: N802 - mimics urllib
        self.posts.append(url)
        return object()

    def urlopen(self, _req, timeout=None):  # noqa: ARG002
        return _Response()


class _ImmediateThread:
    def __init__(self, target=None, args=(), name=None, daemon=None):  # noqa: ARG002
        self._target, self._args = target, args

    def start(self):
        self._target(*self._args)


class _Shim:
    Thread = _ImmediateThread


def _rig(monkeypatch, admin: str, ops: str) -> _Wire:
    wire = _Wire()
    monkeypatch.setattr(cha, "_urllib", wire)
    monkeypatch.setattr(cha, "threading", _Shim)
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, admin)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, ops)
    return wire


def test_a_BLANK_channel_posts_nothing_from_the_transport_itself(monkeypatch):
    wire = _rig(monkeypatch, "", "")
    cha._page_discord("bars_store_unhealthy", "no channel")
    assert wire.posts == []


def test_an_UNSET_channel_posts_nothing_from_the_transport_itself(monkeypatch):
    wire = _rig(monkeypatch, "", "")
    monkeypatch.delenv(ar.ADMIN_WEBHOOK_ENV, raising=False)
    monkeypatch.delenv(ar.OPS_WEBHOOK_ENV, raising=False)
    cha._page_discord("bars_store_unhealthy", "no channel")
    assert wire.posts == []


def test_CONTROL_a_configured_channel_posts_exactly_once(monkeypatch):
    """Without this the two above pass on a transport that never posts at all."""
    wire = _rig(monkeypatch, TODAY, "")
    cha._page_discord("bars_store_unhealthy", "a real page")
    assert wire.posts == [TODAY]
