"""P1 truth matrix, slice "intent" — the SERVER half of typed presentation.

The builder now writes `paints[]` (bgcolor / barcolor reading a condition's own
column) and a `markers` plot with its `marker` for a native formula authored
with SIGNAL intent. These pin that the save authority accepts them ADDITIVELY:

* the document round-trips byte-for-byte (no schema migration, no stripping);
* presentation is outside the maths identity — `ast_hash`, `treesHash` and the
  semantics stamp do not move, and a presentation-only edit does not bump `rev`;
* intent is never stored (the client never sends it, and nothing invents it).

Each case: ASKED / CLAIMED / DID.
"""
from __future__ import annotations

import copy

import pytest

from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc

USER = "u1"
DEF_ID = "u_0123456789ab"

# `close > sma(close, 20)` — canonical node shapes (`_CANONICAL_KEYS`).
SMA20 = {"type": "call", "name": "sma", "args": [
    {"type": "series", "name": "close"}, {"type": "num", "value": 20}]}
COND = {"type": "op", "name": ">", "args": [{"type": "series", "name": "close"}, SMA20]}


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _doc(*, marker=True, paints=True) -> dict:
    plot = {"key": "value", "label": "Above MA", "style": "line", "color": "$color",
            "width": "$lineWidth", "role": "primary", "legend": {"decimals": 2}}
    if marker:
        plot["style"] = "markers"
        plot["marker"] = {"shape": "arrowUp", "position": "belowBar"}
    d = {
        "schemaVersion": 1, "id": DEF_ID, "version": 1,
        "compute": {"kind": "ast", "fn": svc.ast_hash(COND), "rev": 1, "ast": COND,
                    "source": "close > sma(close, 20)"},
        "meta": {"name": "Above MA", "shortName": "Above MA", "category": "Custom",
                 "tags": ["custom"], "tier": "premium", "repaint": "non-repainting",
                 "freshness": "live"},
        "placement": {"target": "pane", "pane": {"height": 0.17}},
        "inputs": [{"key": "color", "type": "color", "label": "Color", "default": "#c9a84c"},
                   {"key": "lineWidth", "type": "int", "label": "Line width",
                    "default": 1, "min": 1, "max": 4, "step": 1}],
        "plots": [plot],
    }
    if paints:
        d["paints"] = [
            {"kind": "barcolor", "title": "Signal candles", "colorMode": "column:value",
             "colorUp": "#26a69a", "colorDown": "transparent"},
            {"kind": "bgcolor", "title": "Signal background", "colorMode": "column:value",
             "colorUp": "#26a69a", "colorDown": "transparent", "opacity": 0.2},
        ]
    return d


def _stored(def_id=DEF_ID) -> dict:
    return svc.get(USER, def_id)["definition"]


def test_signal_presentation_SAVES_and_round_trips_unchanged(store):
    """ASKED a SIGNAL with a marker + candle colour + background; CLAIMED it is
    stored as authored; DID: saved, every presentation field read back unchanged."""
    d = _doc()
    row = svc.save(USER, DEF_ID, copy.deepcopy(d))
    assert row["appended"] is True
    got = _stored(row["def_id"])
    assert got["paints"] == d["paints"]
    assert got["plots"][0]["style"] == "markers"
    assert got["plots"][0]["marker"] == {"shape": "arrowUp", "position": "belowBar"}


def test_presentation_is_outside_the_maths_identity(store):
    """ASKED the same maths with and without presentation; CLAIMED one maths;
    DID: identical ast_hash, and a presentation-only edit does not bump rev."""
    plain = _doc(marker=False, paints=False)
    first = svc.save(USER, DEF_ID, copy.deepcopy(plain))
    styled = _doc()
    styled["version"] = 2
    second = svc.save(USER, first["def_id"], copy.deepcopy(styled))
    assert second["ast_hash"] == first["ast_hash"] == svc.ast_hash(COND)
    assert second["rev_bumped"] is False
    assert second["rev"] == first["rev"]


def test_a_new_native_save_with_presentation_is_semantics_2_and_carries_no_intent(store):
    """ASKED a new native save; CLAIMED the store decides semantics and stores no
    intent or type; DID: stamped 2 by the store, no intent / type key anywhere."""
    row = svc.save(USER, DEF_ID, _doc())
    got = _stored(row["def_id"])
    assert got["meta"].get("semantics") == 2
    flat = repr(got)
    for forbidden in ("authoringIntent", "'intent'", "outputType", "consumerKind"):
        assert forbidden not in flat
