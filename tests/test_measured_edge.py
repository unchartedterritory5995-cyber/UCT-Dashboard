"""The "Measured edge" badge authority (api/services/measured_edge.py, owner decision 2, 2026-10-24).

Rails: the list ships EMPTY; a member payload carries `measured_edge` only on a row of a listed type; a malformed
entry serves nothing (fail closed); a bearish (caution-layer) row is never badged; a stray badge on an unlisted row
is stripped; the route applies it to the member payload. Synthetic ids only (public repo).
"""
from __future__ import annotations

import re

import pytest

from api.services import measured_edge as ME

GOOD = {"lift_pp": 3.1, "ci": [0.4, 5.9], "n": 412, "period": "2023-2026", "holdout": True,
        "method_url": "/methodology/measured-edge"}


def test_the_list_is_exactly_the_one_re_measured_type():
    """Outcome re-measurement 2026-10-24: exactly ONE type beat a matched plain breakout on the held-out period."""
    assert set(ME.MEASURED_EDGE) == {"draw:channel"}
    assert ME.badge_for("draw:channel") == {"lift_pp": 4.3, "ci": [2.3, 6.4], "n": 1210,
                                            "period": "Oct 2023 to Aug 2026", "holdout": True,
                                            "method_url": ME.METHOD_URL}
    for other in ("draw:shelf-pivot", "draw:double-bottom", "draw:darvas-box", "draw:remount", "flat_base"):
        assert ME.badge_for(other) is None, other


def test_an_unlisted_type_badges_nothing():
    rows = [{"pattern_id": "draw:shelf-pivot", "direction": "bullish"}, {"pattern_id": "flat_base"}]
    assert ME.with_badges(rows) == rows
    assert all("measured_edge" not in r for r in ME.with_badges(rows))


def test_a_listed_type_carries_the_badge_and_others_carry_nothing(monkeypatch):
    monkeypatch.setattr(ME, "MEASURED_EDGE", {"draw:shelf-pivot": dict(GOOD)})
    out = ME.with_badges([{"pattern_id": "draw:shelf-pivot", "direction": "bullish"},
                          {"pattern_id": "draw:double-bottom", "direction": "bullish"}])
    assert out[0]["measured_edge"] == GOOD
    assert "measured_edge" not in out[1]


def test_a_bearish_row_is_never_badged(monkeypatch):
    monkeypatch.setattr(ME, "MEASURED_EDGE", {"draw:double-top": dict(GOOD)})
    out = ME.with_badges([{"pattern_id": "draw:double-top", "direction": "bearish"}])
    assert "measured_edge" not in out[0]


def test_a_stray_badge_on_an_unlisted_row_is_stripped():
    out = ME.with_badges([{"pattern_id": "x", "measured_edge": dict(GOOD)}])
    assert "measured_edge" not in out[0]


@pytest.mark.parametrize("bad", [
    {k: v for k, v in GOOD.items() if k != "n"},                 # missing key
    {**GOOD, "lift_pp": 0}, {**GOOD, "lift_pp": -1.2},            # no positive lift
    {**GOOD, "lift_pp": float("nan")},
    {**GOOD, "holdout": False}, {**GOOD, "holdout": "yes"},      # out-of-sample check not passed
    {**GOOD, "n": 0}, {**GOOD, "n": 12.0}, {**GOOD, "n": True},
    {**GOOD, "ci": [4.0, 5.0]},                                   # interval that does not contain the lift
    {**GOOD, "ci": [1.0]},
    {**GOOD, "period": ""},
    {**GOOD, "method_url": "https://example.com/x"}, {**GOOD, "method_url": "//evil"},
])
def test_a_malformed_entry_serves_nothing(monkeypatch, bad):
    monkeypatch.setattr(ME, "MEASURED_EDGE", {"t": bad})
    assert ME.badge_for("t") is None
    # control: the same slot with a good entry serves
    monkeypatch.setattr(ME, "MEASURED_EDGE", {"t": dict(GOOD)})
    assert ME.badge_for("t") == GOOD


def test_a_member_channel_row_carries_the_badge():
    out = ME.with_badges([{"pattern_id": "draw:channel", "direction": "neutral"}])
    assert out[0]["measured_edge"]["lift_pp"] == 4.3 and out[0]["measured_edge"]["n"] == 1210


def test_badge_payload_covers_every_drawing_list(monkeypatch):
    monkeypatch.setattr(ME, "MEASURED_EDGE", {"a": dict(GOOD)})
    p = {"detections": [{"pattern_id": "a"}], "structures": [{"pattern_id": "a"}],
         "setup_draws": [{"pattern_id": "a"}], "levels_sr": {"zones": []}}
    ME.badge_payload(p)
    for k in ("detections", "structures", "setup_draws"):
        assert p[k][0]["measured_edge"] == GOOD
    assert p["levels_sr"] == {"zones": []}


def test_the_member_route_returns_through_the_badge_authority():
    """Wiring: the member structures branch and the admin branch both pass the payload through badge_payload."""
    src = open("api/routers/patterns.py", encoding="utf-8").read()
    assert "return _measured_edge.badge_payload(mout)" in src
    assert "_measured_edge.badge_payload(out)" in src


def test_the_authority_never_says_confidence_or_probability_in_served_keys():
    """The served facts are numbers and a period; no key or value may carry forecast words."""
    for key in ME._KEYS:
        assert not re.search(r"confidence|probability|likely", key, re.I)


def test_the_method_url_is_a_real_app_route():
    """The chip's link must open the method page, not the SPA catch-all."""
    app = open("app/src/App.jsx", encoding="utf-8").read()
    page = open("app/src/pages/MeasuredEdgeMethod.jsx", encoding="utf-8").read()
    assert f'path="{ME.METHOD_URL}"' in app
    assert f"MEASURED_EDGE_METHOD_PATH = '{ME.METHOD_URL}'" in page
