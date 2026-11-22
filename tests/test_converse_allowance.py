"""F1 (Studio plan, section 6): every Create Indicator answer says how much of today's
allowance is left, as a share (never dollars), so the dock can warn before it runs out.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    RSI_GT_70, conv, emits, env, model, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

GOOD = lambda: emits(env(1, [{"op": "set_slot", "slot": "value#1", "value": 80}]))  # noqa: E731


def test_the_share_is_one_minus_spent_over_cap_to_the_nearest_five_percent(conv, clean_env, monkeypatch):
    md = "2026-11-16"
    monkeypatch.setattr(conv.dc, "spend_for", lambda _u, _d: 0.33)
    assert conv.allowance_left("u1", 1.0, md) == 0.65          # 0.67 to the nearest 0.05
    monkeypatch.setattr(conv.dc, "spend_for", lambda _u, _d: 0.0)
    assert conv.allowance_left("u1", 1.0, md) == 1.0
    monkeypatch.setattr(conv.dc, "spend_for", lambda _u, _d: 5.0)
    assert conv.allowance_left("u1", 1.0, md) == 0.0           # never below nothing


@pytest.mark.parametrize("cap", [0, -1, None, "x", float("nan")])
def test_no_positive_cap_means_no_figure(conv, clean_env, cap):
    assert conv.allowance_left("u1", cap) is None


def test_an_answer_carries_it_and_it_falls_as_the_member_spends(conv, clean_env, model, monkeypatch):
    monkeypatch.setenv("CONVERSE_USER_CAP_DAILY", "1")
    model([GOOD()])
    r = conv.converse("make it 80", user_id="u-allow", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is True
    first = r["allowance_left"]
    assert 0.0 <= first <= 1.0 and abs(first * 20 - round(first * 20)) < 1e-9     # a multiple of 0.05
    conv.dc._record_spend("u-allow", conv.dc._market_date(), 0.6)
    model([GOOD()])
    r2 = conv.converse("make it 80", user_id="u-allow", view=view(1, [out("value", RSI_GT_70)]))
    assert r2["allowance_left"] <= max(0.0, first - 0.55)


def test_a_refused_turn_carries_it_too_and_a_spent_allowance_reads_zero(conv, clean_env, model, monkeypatch):
    monkeypatch.setenv("CONVERSE_USER_CAP_DAILY", "1")
    conv.dc._record_spend("u-out", conv.dc._market_date(), 2.0)
    model([])
    r = conv.converse("make it 80", user_id="u-out", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"] == "cost:user"
    assert r["allowance_left"] == 0.0


def test_a_failure_to_read_it_never_breaks_the_turn(conv, clean_env, model, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("ledger down")
    model([GOOD()])
    monkeypatch.setattr(conv, "allowance_left", boom)
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is True and "allowance_left" not in r
