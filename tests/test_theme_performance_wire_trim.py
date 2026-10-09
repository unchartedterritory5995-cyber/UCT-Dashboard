"""Perf wave 2: /api/theme-performance sends the browser only the fields some browser consumer
reads (ThemeTracker tile, ThemeTrackerPage, IMOV). Everything a consumer reads is kept; the shared
service payload is never mutated."""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

from api.routers import theme_performance as tpr

ROOT = Path(__file__).resolve().parents[1]
_PERIODS = {"1d": 1.0, "1w": 2.0, "1m": 3.0, "3m": 4.0, "1y": 5.0, "ytd": 6.0, "open": 0.5,
            "5d": 7.0, "30d": 8.0, "60d": 9.0, "90d": 10.0}
_REFS = {k: 100.0 for k in ("1d", "1w", "1m", "3m", "1y", "ytd", "5d", "30d", "60d", "90d")}
PAYLOAD = {
    "status": "ok", "generated_at": "2026-10-08T20:00:00+00:00", "live_as_of": "2026-10-08T20:00:05+00:00",
    "theme_set": "x", "all_themes": [{"name": "T"}],
    "themes": [{
        "name": "Space", "ticker": "UFO", "etf_name": "Procure Space", "theme_id": 7, "sector": "Innovation",
        "sector_id": 3, "sub_themes": [{"id": 1}], "_owner_syms": ["AAA"], "group_return": {"1d": 1.0, "open": 0.2},
        "user_edited": False, "is_custom": False, "custom_key": None,
        "holdings": [{"sym": f"S{i}", "name": f"S{i}", "weight_pct": 0.0, "source": "owner", "tier": "core",
                      "sub_theme_id": 2, "unresolved": False, "returns": dict(_PERIODS), "ref_prices": dict(_REFS)}
                     for i in range(40)],
    }],
}


def test_only_unread_fields_are_dropped():
    slim = tpr.wire_payload(PAYLOAD)
    t = slim["themes"][0]
    h = t["holdings"][0]
    assert "theme_set" not in slim and "all_themes" not in slim
    assert "sector_id" not in t and "sub_themes" not in t
    assert not {"weight_pct", "tier", "sub_theme_id"} & set(h)
    assert set(h["returns"]) == {"1d", "1w", "1m", "3m", "1y", "ytd", "open"}
    assert set(h["ref_prices"]) == {"1d", "1w", "1m", "3m", "1y", "ytd"}
    # everything a browser consumer reads survives
    for k in ("status", "generated_at", "live_as_of"):
        assert k in slim
    for k in ("name", "ticker", "etf_name", "theme_id", "sector", "_owner_syms", "group_return",
              "user_edited", "is_custom", "custom_key"):
        assert k in t
    for k in ("sym", "name", "source", "unresolved"):
        assert k in h


def test_the_shared_payload_is_never_mutated_and_the_wire_copy_is_smaller():
    before = copy.deepcopy(PAYLOAD)
    slim = tpr.wire_payload(PAYLOAD)
    assert PAYLOAD == before
    assert len(json.dumps(slim)) < 0.75 * len(json.dumps(PAYLOAD))


def test_no_browser_consumer_reads_a_dropped_field():
    """The frontend files that fetch the route; a dropped name appearing in them fails this."""
    files = ["app/src/components/tiles/ThemeTracker.jsx", "app/src/pages/ThemeTrackerPage.jsx",
             "app/src/pages/terminal/panels/ImovPanel.jsx", "app/src/pages/terminal/panels/imovModel.js"]
    dropped = ["sector_id", "sub_themes", "weight_pct", "sub_theme_id", "theme_set", "all_themes",
               "'5d'", "'30d'", "'60d'", "'90d'", '"5d"', '"30d"', '"60d"', '"90d"', ".tier", "'tier'"]
    for f in files:
        src = (ROOT / f).read_text(encoding="utf-8")
        assert "theme-performance" in src or "imov" in f.lower()       # control: the right files
        for d in dropped:
            assert d not in src, f"{f} reads {d}"


def test_the_shared_overlay_is_slimmed_once_per_window():
    a = tpr._wire_shared(PAYLOAD)
    b = tpr._wire_shared(PAYLOAD)
    assert a is b
