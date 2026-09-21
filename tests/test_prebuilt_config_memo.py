"""The prebuilt catalogue config is memoized — and the memo must stay pristine.

⛔ WHY THE MEMO EXISTS. One `GET /api/watchlists/prebuilt` called `category_map()`,
`sample_map()`, `category_order()` and `issue_date_map()`, and EACH re-ran
`_load_committed()` — so the catalogue was rebuilt four times per request, each pass
re-parsing `prebuilt_lists.json` (27.6 KB) and `themes_taxonomy.json` (411 KB), and
each calling `sunday_scans_specs()`, which opens a fresh SQLite connection to the
desk store and runs a double unindexed LIKE scan. `alias_map()` made it five. All on
a Railway network volume. Measured 2026-09-20: 172 ms warm → 9,859 ms cold.

⛔⛔ WHY THE COPY IN `_load_lists` IS LOAD-BEARING. `_apply_overlay` REBINDS
`l["tickers"]` on the rows it is handed. Before the memo those rows were freshly
parsed per call, so mutating them was harmless. Now they are the SHARED baseline:
hand them over raw and the overlay's delisted-prune and index-replacement rewrite
the cache in place, so the next caller reads an already-overlaid "committed" config
and the corruption compounds on every request. That is what this file guards.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _clean_memo():
    from api.services import watchlist_prebuilt as wp
    wp.invalidate_prebuilt_config_cache()
    yield
    wp.invalidate_prebuilt_config_cache()


def test_load_committed_is_memoized(monkeypatch):
    from api.services import watchlist_prebuilt as wp

    calls = {"n": 0}

    def counted():
        calls["n"] += 1
        return [{"name": "L", "desc": "", "category": "C", "tickers": ["AAA", "BBB"]}]

    monkeypatch.setattr(wp, "_load_committed_uncached", counted)

    for _ in range(5):
        wp._load_committed()
    assert calls["n"] == 1, "the catalogue was rebuilt from disk more than once"


def test_the_overlay_cannot_mutate_the_shared_baseline(monkeypatch):
    """The regression the memo could have introduced: a prune leaking into the cache."""
    from api.services import watchlist_prebuilt as wp

    monkeypatch.setattr(wp, "_load_committed_uncached", lambda: [
        {"name": "Idx", "desc": "", "category": "C", "tickers": ["ALIVE", "DEAD"]},
    ])
    # An overlay that prunes one ticker — exactly what a delisted set does.
    monkeypatch.setattr(wp, "_read_overlay", lambda: {"delisted": ["DEAD"]})

    first = wp._load_lists()
    assert first[0]["tickers"] == ["ALIVE"], "the overlay should prune the dead ticker"

    # The BASELINE must still carry both. If _apply_overlay mutated the cached rows,
    # DEAD is gone from the committed config for the life of the process.
    assert wp._load_committed()[0]["tickers"] == ["ALIVE", "DEAD"], (
        "the overlay mutated the shared memo — _load_lists must copy before overlaying"
    )
    # And re-applying is idempotent rather than cumulative.
    assert wp._load_lists()[0]["tickers"] == ["ALIVE"]


def test_a_config_file_change_invalidates_the_memo(monkeypatch, tmp_path):
    """Keyed on mtime+size, so a refresh-written overlay is picked up without a restart."""
    from api.services import watchlist_prebuilt as wp

    cfg = tmp_path / "prebuilt.json"
    cfg.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(wp, "_CONFIG_PATHS", [str(cfg)])

    calls = {"n": 0}

    def counted():
        calls["n"] += 1
        return [{"name": "L", "desc": "", "category": "C", "tickers": ["AAA"]}]

    monkeypatch.setattr(wp, "_load_committed_uncached", counted)

    wp._load_committed()
    wp._load_committed()
    assert calls["n"] == 1

    cfg.write_text('[{"name":"other","tickers":["ZZZ"]}]', encoding="utf-8")
    wp._load_committed()
    assert calls["n"] == 2, "a changed config file must bust the memo"


def test_explicit_invalidation_is_available_to_the_refresh_job(monkeypatch):
    from api.services import watchlist_prebuilt as wp

    calls = {"n": 0}

    def counted():
        calls["n"] += 1
        return []

    monkeypatch.setattr(wp, "_load_committed_uncached", counted)

    wp._load_committed()
    wp.invalidate_prebuilt_config_cache()
    wp._load_committed()
    assert calls["n"] == 2
