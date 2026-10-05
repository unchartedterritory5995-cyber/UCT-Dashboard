"""Wave 14 playbook fixes, item 1 -- the visual playbook's market-regime filter, wired to 13E.

The regime a card filters on is 13E's FROZEN entry context (`entry_context`, `j2_entry_context`)
for the card's PRIMARY trade -- the same trade its outcome reads -- and only an `at_entry` row
(13E-1 doc section 1: "a reader that wants the market at the fill must use at_entry rows only").
Nothing here re-derives a regime: the context rows are written through 13E's own
`freeze_static` door with caller-supplied fields, so no live wire/breadth read is reachable.

  * PRESENT: a card whose trade has an at_entry context with a regime value filters on it.
  * ABSENT: a trade with no context row on its entry day is `not_captured` -- excluded by a
    regime filter and COUNTED (`excludedUnknown`), never treated as a match.
  * UNKNOWN: a context whose regime field is missing, a `captured_late` context, and a chart with
    no linked trade at all are each a labelled unknown, excluded and counted the same way.
  * GATE OFF (`NOTEBOOK_ENTRY_CONTEXT_ENABLED` unset): the payload is byte-identical to the
    pre-13E build -- the placeholder sentence, no `regime` key on any card, and a `regime=`
    parameter ignored rather than refused.
"""
from __future__ import annotations

import pytest

from api.services.journal_two import entry_context
from api.services.journal_two import regime as regime_service
from api.services.journal_two import visual_playbook as vp
from tests.test_notebook_visual_playbook import (  # noqa: F401 -- fixtures reused verbatim
    BASE, _auth_conn, _chart, _fp, _link, _note, _seed, _trade, as_user, client, conn, db_path,
)

ENTRY_DAY = "2026-09-30"        # `_trade` enters every trade at 2026-09-30T14:00Z = this ET day


def _fields(regime_value=None, missing=None):
    """Every 13E field, shaped as `build_context` shapes it; only `regime` carries meaning."""
    out = {f: {"value": None, "source": "test", "asOf": None, "missing": "source_error", "detail": None}
           for f in entry_context.FIELDS}
    if regime_value is not None:
        out["regime"] = {"value": regime_value, "source": entry_context.SRC_REGIME,
                         "asOf": ENTRY_DAY, "missing": None, "detail": None}
    else:
        out["regime"] = {"value": None, "source": entry_context.SRC_REGIME, "asOf": None,
                         "missing": missing or "wire_unavailable", "detail": None}
    return out


def _freeze(c, uid, symbol, regime_value=None, *, kind="at_entry", missing=None):
    entry_context.freeze_static(uid, symbol, ENTRY_DAY, _fields(regime_value, missing),
                                capture_kind=kind, capture_day=ENTRY_DAY, conn=c)


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(entry_context.FLAG, "1")


@pytest.fixture
def off(monkeypatch):
    monkeypatch.delenv(entry_context.FLAG, raising=False)


def _syms(out):
    return sorted(c["symbol"] for c in out["cards"])


# ── the vocabulary is the classifier's, not a typed list ──────────────────────

def test_the_regime_vocabulary_is_derived_from_the_one_classifier():
    swept = {regime_service.classify_regime(s) for s in range(0, 151)} - {None}
    assert set(vp.REGIMES) == swept
    assert vp.REGIMES[0] == regime_service.classify_regime(150)      # best first
    assert vp.REGIMES[-1] == regime_service.classify_regime(0)


# ── gate OFF: unchanged ───────────────────────────────────────────────────────

def test_gate_off_the_payload_is_the_pre_13e_placeholder_and_the_param_is_ignored(conn, off):
    _seed(conn)
    _freeze(conn, "u1", "NVDA", "green")          # a row exists, and still nothing reads it
    plain = vp.cards("u1", conn)
    assert plain["regime"] == {"available": False, "reason": vp.REGIME_UNAVAILABLE}
    assert all("regime" not in c for c in plain["cards"])
    for param in ("green", "red", "not-a-regime"):
        filtered = vp.cards("u1", conn, regime=param)
        assert filtered == plain, param


# ── PRESENT ───────────────────────────────────────────────────────────────────

def test_present_a_card_filters_on_the_regime_frozen_at_its_trades_entry(conn, on):
    _seed(conn)                                    # NVDA (win), AMD (loss), TSLA (no trade)
    _freeze(conn, "u1", "NVDA", "green")
    _freeze(conn, "u1", "AMD", "red")
    out = vp.cards("u1", conn)
    by = {c["symbol"]: c for c in out["cards"]}
    assert by["NVDA"]["regime"] == {"value": "green", "status": "captured", "entryDay": ENTRY_DAY,
                                    "asOf": ENTRY_DAY}
    assert by["AMD"]["regime"]["value"] == "red"
    assert out["regime"]["available"] is True
    assert out["regime"]["facets"] == {"green": 1, "amber": 0, "orange": 0, "red": 1}
    assert out["regime"]["unknown"] == 1           # TSLA: no trade linked

    green = vp.cards("u1", conn, regime="green")
    assert _syms(green) == ["NVDA"]
    assert green["regime"]["selected"] == "green"
    assert green["stats"]["trades"] == 1 and green["stats"]["wins"] == 1
    assert _syms(vp.cards("u1", conn, regime="RED")) == ["AMD"]          # case-insensitive
    assert _syms(vp.cards("u1", conn, regime="amber")) == []


def test_a_regime_is_never_invented_for_a_card_from_another_days_context(conn, on):
    """The key is (member, symbol, ENTRY day). A context frozen for the same symbol on another
    day is a different entry and must not answer for this one."""
    _seed(conn)
    entry_context.freeze_static("u1", "NVDA", "2026-09-29", _fields("green"),
                                capture_day="2026-09-29", conn=conn)
    by = {c["symbol"]: c for c in vp.cards("u1", conn)["cards"]}
    assert by["NVDA"]["regime"]["status"] == "not_captured"


# ── ABSENT ────────────────────────────────────────────────────────────────────

def test_absent_a_trade_with_no_context_is_excluded_and_counted_never_matched(conn, on):
    _seed(conn)
    _freeze(conn, "u1", "NVDA", "red")             # AMD has NO context row
    by = {c["symbol"]: c for c in vp.cards("u1", conn)["cards"]}
    assert by["AMD"]["regime"] == {"value": None, "status": "not_captured", "entryDay": ENTRY_DAY}
    out = vp.cards("u1", conn, regime="red")
    assert _syms(out) == ["NVDA"]
    assert out["regime"]["excludedUnknown"] == 2   # AMD (not captured) + TSLA (no trade)
    # A matching card never counts as excluded; a known OTHER regime is not "unknown" either.
    assert vp.cards("u1", conn, regime="green")["regime"]["excludedUnknown"] == 2


# ── UNKNOWN ───────────────────────────────────────────────────────────────────

def test_unknown_a_context_with_no_regime_value_is_a_labelled_unknown(conn, on):
    _seed(conn)
    _freeze(conn, "u1", "NVDA", None, missing="wire_unavailable")
    by = {c["symbol"]: c for c in vp.cards("u1", conn)["cards"]}
    assert by["NVDA"]["regime"]["status"] == "regime_missing"
    assert by["NVDA"]["regime"]["missing"] == "wire_unavailable"
    assert by["NVDA"]["regime"]["value"] is None
    for r in vp.REGIMES:
        assert "NVDA" not in _syms(vp.cards("u1", conn, regime=r)), r


def test_unknown_a_captured_late_context_is_not_the_market_at_the_fill(conn, on):
    _seed(conn)
    _freeze(conn, "u1", "NVDA", "green", kind="captured_late")
    by = {c["symbol"]: c for c in vp.cards("u1", conn)["cards"]}
    assert by["NVDA"]["regime"]["status"] == "captured_late"
    assert by["NVDA"]["regime"]["value"] is None
    assert _syms(vp.cards("u1", conn, regime="green")) == []


def test_unknown_a_chart_with_no_trade_has_no_entry_day(conn, on):
    _seed(conn)
    by = {c["symbol"]: c for c in vp.cards("u1", conn)["cards"]}
    assert by["TSLA"]["regime"] == {"value": None, "status": "no_trade", "entryDay": None}
    assert set(vp.REGIME_UNKNOWN) >= {"no_trade", "not_captured", "captured_late", "regime_missing"}


def test_a_bad_regime_is_refused_while_the_gate_is_on(conn, on):
    _seed(conn)
    with pytest.raises(vp.PlaybookRequestError):
        vp.cards("u1", conn, regime="purple")


def test_the_regime_filter_composes_with_the_other_filters(conn, on):
    _seed(conn)
    _freeze(conn, "u1", "NVDA", "green")
    _freeze(conn, "u1", "AMD", "green")
    assert _syms(vp.cards("u1", conn, regime="green", outcome="loss")) == ["AMD"]
    assert _syms(vp.cards("u1", conn, regime="green", ranges=["rs_rank:90:"])) == ["NVDA"]


# ── the route ─────────────────────────────────────────────────────────────────

def test_the_route_carries_the_regime_parameter(client, monkeypatch):
    monkeypatch.setenv(vp.FLAG, "1")
    monkeypatch.setenv(entry_context.FLAG, "1")
    c = _auth_conn()
    try:
        a = _note(c, "m1", "NVDA plan", _chart("a", "NVDA", "VCP", _fp(rs_rank=95)))
        _trade(c, "m1", "t-win", "NVDA", "Win", 2.0, 800.0, "2026-10-01T15:00:00Z")
        _link(c, "m1", "id:t-win", a["id"], "NVDA")
        _freeze(c, "m1", "NVDA", "amber")
    finally:
        c.close()
    as_user(client, "m1")
    assert [x["symbol"] for x in client.get(BASE + "/cards?regime=amber").json()["cards"]] == ["NVDA"]
    assert client.get(BASE + "/cards?regime=green").json()["count"] == 0
    assert client.get(BASE + "/cards?regime=purple").status_code == 422
    monkeypatch.delenv(entry_context.FLAG)
    off = client.get(BASE + "/cards?regime=purple")
    assert off.status_code == 200 and off.json()["regime"]["available"] is False
