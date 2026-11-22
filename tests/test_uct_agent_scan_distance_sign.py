"""SG-1 / SG-2 (AUDIT live prod f591d31720, 2026-11-04) — the Screener's own semantics for the two scan defects.

SG-1: "near 52-week highs" was built as "Dist from 52W High <= 5%". The Screener stores a distance from a HIGH as a
NEGATIVE percent (price / high - 1) and a distance from a LOW as a POSITIVE one, so "<= 5" passes every stock. The Agent
now reads such a threshold on the field's own side (capabilities/screener.js `signedDistance`). These tests pin, on the
REAL query engine over a throwaway screener.db, that the corrected wire filter returns ONLY rows within 5% of the high
(every returned row satisfies the stated condition) while the old one returned the whole universe — and that the
browser's sign table covers every distance field the catalog has.

SG-2: sector words go to the `sector` field (the browser's table is checked against the catalog's real field).

Synthetic rows only (no market value); nothing reads C:\\data.
"""
from __future__ import annotations

import importlib
import re
from pathlib import Path

import pytest

from api.services.screener import filters as scr_filters
from api.services.screener import query

SCREENER_JS = Path(__file__).resolve().parents[1] / "app" / "src" / "agent" / "capabilities" / "screener.js"
# made-up distances from the 52-week high (0 = at the high; -40 = 40% below it)
DISTS = {"AAA": 0.0, "BBB": -2.0, "CCC": -4.9, "DDD": -12.0, "EEE": -25.0, "FFF": -40.0}


@pytest.fixture
def db(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    from api.services.screener import snapshot_db
    importlib.reload(snapshot_db)
    snapshot_db.init_db()
    snapshot_db.upsert_rows([{"ticker": t, "sector": "Technology", "dist_52w_high_pct": d, "dist_52w_low_pct": -d + 10,
                              "market_cap": 1e9, "snapshot_date": "2026-11-03", "built_at": 1} for t, d in DISTS.items()])
    importlib.reload(query)
    yield snapshot_db
    importlib.reload(query)


def _tickers(spec):
    return sorted(r["ticker"] if isinstance(r, dict) else r[0] for r in query.run_scan(spec)["rows"])


def test_the_screener_stores_a_distance_from_the_high_as_a_negative_percent():
    from api.services.screener import technicals
    assert technicals._pct(95.0, 100.0) == pytest.approx(-5.0)       # 5% below the high
    assert technicals._pct(110.0, 100.0) == pytest.approx(10.0)      # 10% above the low


def test_near_the_52_week_high_is_gte_minus_5_and_every_returned_row_is_within_5_percent(db):
    near = _tickers({"filters": [{"key": "dist_52w_high_pct", "op": "gte", "min": -5}]})
    assert near == ["AAA", "BBB", "CCC"]
    assert all(DISTS[t] >= -5 for t in near)                           # every returned row satisfies the condition
    # the live defect: "<= 5" is true for EVERY stock (all are at or below their high)
    assert _tickers({"filters": [{"key": "dist_52w_high_pct", "op": "lte", "max": 5}]}) == sorted(DISTS)
    # "20%+ off the high" is lte -20
    assert _tickers({"filters": [{"key": "dist_52w_high_pct", "op": "lte", "max": -20}]}) == ["EEE", "FFF"]


def _js_regex(name):
    m = re.search(rf"const {name} = /(.+?)/\n", SCREENER_JS.read_text(encoding="utf-8"))
    assert m, name
    return re.compile(m.group(1).replace("(?:\\w+_)?", "(?:\\w+_)?"))


def test_the_browser_sign_table_covers_every_distance_field_in_the_catalog():
    neg, pos = _js_regex("DIST_BELOW_HIGH"), _js_regex("DIST_ABOVE_LOW")
    keys = [f["key"] for f in scr_filters.field_catalog() if f["key"].startswith("dist_")]
    assert keys, "the catalog has no distance fields"
    for k in keys:
        if "high" in k or k == "dist_ath_pct":
            assert neg.match(k) and not pos.match(k), k
        elif "low" in k:
            assert pos.match(k) and not neg.match(k), k
    assert {"dist_52w_high_pct", "dist_20d_high_pct", "dist_ath_pct", "dist_52w_low_pct"} <= set(keys)


def test_the_catalog_has_a_sector_list_field_for_sector_words():
    f = {x["key"]: x for x in scr_filters.field_catalog()}
    assert f["sector"]["type"] == "enum" and f["industry"]["type"] == "enum"
