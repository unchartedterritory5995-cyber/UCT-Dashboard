"""Deal status on the chart (DEAL_STATUS_ENABLED): a pending acquisition withholds every drawing
and label on BOTH the member and the team path of GET /api/patterns/{sym}, and returns only a
small marker; a symbol that is not pending, or any symbol with the flag off, gets the payload
byte-for-byte as before. Reuses the member-set test's fake store (synthetic ids and prices).
"""
from __future__ import annotations

import pytest

from api.services import auto_structures, deal_status
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_member_drawing_set import URL, _flags, _get, calls  # noqa: F401  (fixture)

MARKER = {"pending": True, "label": deal_status.CHART_LABEL, "source": ["pc_exclude_mirror"],
          "since": None, "price": None, "confidence": 1.0}


def _pending(monkeypatch, pending: bool):
    st = {"sym": "ZZZ", "pending": pending, "possible": False,
          "source": ["pc_exclude_mirror"] if pending else [], "since": None, "price": None,
          "confidence": 1.0 if pending else 0.0}
    monkeypatch.setattr(deal_status, "deal_status", lambda sym, bars=None: dict(st))


def _no_layer_may_run(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("a drawing layer ran for a pending acquisition")
    for name in ("structures_for", "with_metrics", "shelf_pivot_row", "drawn_for", "member_rows",
                 "admin_base_rows"):
        monkeypatch.setattr(auto_structures, name, boom)


@pytest.mark.parametrize("user", [PAID_MEMBER, ADMIN])
def test_pending_withholds_every_drawing_and_returns_the_marker(monkeypatch, calls, user):
    _flags(monkeypatch, True, True)
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _pending(monkeypatch, True)
    _no_layer_may_run(monkeypatch)
    body = _get(user).json()
    assert body == {"sym": "ZZZ", "tf": "D", "detections": [], "count": 0, "deal_status": MARKER}


@pytest.mark.parametrize("user", [PAID_MEMBER, ADMIN])
def test_not_pending_is_byte_identical_to_the_flag_off_payload(monkeypatch, calls, user):
    _flags(monkeypatch, True, True)
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    want = _get(user).content
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _pending(monkeypatch, False)
    assert _get(user).content == want


@pytest.mark.parametrize("user", [PAID_MEMBER, ADMIN])
def test_flag_off_never_asks_and_is_byte_identical(monkeypatch, calls, user):
    _flags(monkeypatch, True, True)
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    want = _get(user).content
    def boom(*a, **k):
        raise AssertionError("deal status consulted with the flag off")
    monkeypatch.setattr(deal_status, "deal_status", boom)
    assert _get(user).content == want


def test_an_error_in_the_service_never_hides_a_chart(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    want = _get(PAID_MEMBER).content
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    def boom(sym):
        raise RuntimeError("deal service exploded")
    monkeypatch.setattr(deal_status, "chart_marker", boom)
    assert _get(PAID_MEMBER).content == want


def test_without_include_structures_nothing_changes(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    url = URL.replace("&include_structures=true", "")
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    want = _get(PAID_MEMBER, url).content
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _pending(monkeypatch, True)
    assert _get(PAID_MEMBER, url).content == want
