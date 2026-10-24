"""The judged gate for the screener's candle LABELS (docs/patterns/JUDGED_GATE.md, "Labels").

Every case in fixtures_labels/candles.json is a daily bar that BOTH blind judges scored 3 for its candle name in the
2026-10-24 recertification of CANDLE_RULES_ROUND 2 (four pre-registered packets of 25, strict Nison / Bulkowski
rubric: packets 2.54 / 2.50 / 2.48 / 2.32, pooled 2.46). The candle layer is not a chart drawing, so these cases do
not go through the member chart route: each is replayed through the screener's own call
(snapshot_builder: candles.single_candle(technicals.usable_bars(bars[-400:]))) on the stored 400 bars, and the
judged key must still be in `candle_matches` -- the set a member screens and reads labels from.

Stored symbol-free exactly like the chart fixtures (tests/golden_judged/encode.py): no ticker, day offsets instead
of dates, prices multiplied by a recorded per-case scale.
"""
from __future__ import annotations

import json
import os
import re

import pytest

from tests.golden_judged import member_path as MP

LABELS = os.path.join(MP.HERE, "fixtures_labels")
DOC = MP.load_family(os.path.join(LABELS, "candles.json"))
CASES = DOC["cases"]


def matches(case):
    """The candle keys the screener publishes for the fixture's as-of bar."""
    from api.services.screener import candle_catalog as cat
    from api.services.screener import candles, technicals
    got = candles.single_candle(technicals.usable_bars(MP.decode_bars(case)[-400:]))
    return [k for k in cat.decode_matches(got.get("candle_matches") or "") if k in cat.BY_KEY]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_a_judged_candle_label_is_still_published(case):
    got = matches(case)
    assert case["expect"]["key"] in got, (f"{case['id']} (judge scores {case['judge_scores']}): judged "
                                          f"{case['expect']['key']!r}, the screener now publishes {got}")


def test_the_labels_are_served_at_the_round_the_judges_scored():
    """Moving the candle rules (or the member literal) off the judged round is a re-baseline: new fixtures from a
    NEW passed blind round, never an edit here."""
    from api.services import auto_structures as AS
    from api.services.screener import candle_catalog as cat
    assert DOC["status"] == "released"
    assert getattr(AS, DOC["member_literal"]) == DOC["judged_round"] == cat.CANDLE_RULES_ROUND
    assert AS.member_candle_rules_ok() is True


def test_the_fixtures_cover_the_label_families():
    """Non-vacuity: single-bar names, two-bar and three-bar relations are all represented."""
    from api.services.screener import candle_catalog as cat
    bars = {cat.BY_KEY[c["expect"]["key"]].bars for c in CASES}
    assert len(CASES) >= 40 and {1, 2, 3} <= bars, (len(CASES), bars)


# ---------------------------------------------------------------------------- the gate can fail
def test_a_wrong_judged_key_is_caught():
    case = json.loads(json.dumps(CASES[0]))
    got = matches(case)
    case["expect"]["key"] = next(k for k in ("tri-star", "abandoned-baby-bullish", "kicking-bullish") if k not in got)
    assert case["expect"]["key"] not in matches(case)


def test_a_stricter_trend_rule_and_a_closed_context_gate_turn_cases_red(monkeypatch):
    """Mutation controls on the live rules: the gate is not blind to the geometry it guards."""
    from api.services.screener import candle_catalog as cat
    rel = [c for c in CASES if cat.BY_KEY[c["expect"]["key"]].trend in ("up", "down")]
    assert rel
    monkeypatch.setattr(cat, "MOVE_ATR", 50.0)      # no prior move is ever big enough: every trend pattern drops
    assert any(c["expect"]["key"] not in matches(c) for c in rel)
    monkeypatch.undo()
    monkeypatch.setattr(cat, "context_ok", lambda p, ctx: False)   # the context gate refuses everything
    multi = [c for c in CASES if cat.BY_KEY[c["expect"]["key"]].axis == "relation"]
    assert multi and all(c["expect"]["key"] not in matches(c) for c in multi)


# ---------------------------------------------------------------------------- public-repo hygiene
_FORBIDDEN_KEYS = {"ticker", "sym", "symbol", "ts", "date", "trader", "author", "user", "path"}


def _walk_keys(o, out):
    if isinstance(o, dict):
        for k, v in o.items():
            out.add(k)
            _walk_keys(v, out)
    elif isinstance(o, list):
        for v in o:
            _walk_keys(v, out)


def test_the_label_fixtures_are_symbol_free_and_small():
    total = 0
    for name in sorted(os.listdir(LABELS)):
        p = os.path.join(LABELS, name)
        total += os.path.getsize(p)
        text = json.dumps(MP.load_family(p))         # a .json.gz family is checked on its decoded text
        assert not re.search(r"[A-Za-z]:[\\/]|Desktop|lab[\\/]|\.png|\.db\b", text), name
        doc = json.loads(text)
        keys: set = set()
        _walk_keys(doc, keys)
        assert not keys & _FORBIDDEN_KEYS, (name, keys & _FORBIDDEN_KEYS)
        for c in doc["cases"]:
            assert set(c["bars"]) == {"scale", "q", "dp", "wd0", "vu", "d", "c", "o", "h", "l", "v"}, c["id"]
            assert set(c["bars"]["d"]) <= set("0123456789()"), (name, c["id"])
            meta = json.dumps({k: v for k, v in c.items() if k != "bars"})
            assert not re.search(r"\b(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b", meta), (name, c["id"])
    assert total < 2_000_000, total
