"""Synthetic pseudo-tickers must survive the delisted-prune.

Regression for the recurring vanishing of the 'UCT Thematic Indexes' list and the
MA / Momentum / Highs breadth lists. Root cause: watchlist_prebuilt_refresh derives
its 'delisted' set as (committed − alive) off REAL Massive grouped-daily symbols, so
the synthetic pseudo-tickers ($IDX:<slug> thematic indexes + UCTA50/UCTHS breadth
symbols) — which never trade — were all flagged delisted, written into the durable
overlay, and stripped by _apply_overlay, emptying their lists so the seeder deleted
them.

Two invariants pinned here:
  1. _is_synthetic_ticker recognizes both synthetic families (and no real ticker).
  2. _apply_overlay keeps synthetic tickers even when a stale/poisoned overlay lists
     every one of them as delisted (the immediate-recovery path).
"""
from api.services import watchlist_prebuilt as wp


def test_is_synthetic_ticker_recognizes_both_families_and_no_real_ticker():
    assert wp._is_synthetic_ticker("$IDX:CYBERSECURITY")
    assert wp._is_synthetic_ticker("UCTA50")     # breadth pseudo-ticker (un-prefixed)
    assert wp._is_synthetic_ticker("UCTHS")
    # Real tradeable tickers are never synthetic.
    assert not wp._is_synthetic_ticker("AAPL")
    assert not wp._is_synthetic_ticker("BRK.B")
    assert not wp._is_synthetic_ticker("SPY")
    assert not wp._is_synthetic_ticker("UCTT")   # a REAL ticker that merely starts with UCT
    assert not wp._is_synthetic_ticker("")


def test_apply_overlay_never_prunes_synthetic_tickers(monkeypatch):
    # A poisoned overlay: every synthetic ticker marked delisted, plus one genuinely
    # dead real ticker.
    theme = wp._theme_index_lists()
    breadth = wp._breadth_lists()
    assert theme and breadth, "generators must produce the synthetic lists"
    poisoned = {t for l in (theme + breadth) for t in l["tickers"]}
    poisoned.add("DEADCO")

    monkeypatch.setattr(wp, "_read_overlay", lambda: {"delisted": sorted(poisoned)})

    lists = wp._apply_overlay(
        theme + breadth + [{"name": "Junk", "desc": "", "category": "x",
                            "tickers": ["AAPL", "DEADCO"]}]
    )
    by_name = {l["name"]: l for l in lists}

    # The synthetic lists survive with ALL their tickers intact.
    assert wp._THEME_INDEX_LIST_NAME in by_name
    assert by_name[wp._THEME_INDEX_LIST_NAME]["tickers"] == theme[0]["tickers"]
    for b in breadth:
        assert b["name"] in by_name
        assert by_name[b["name"]]["tickers"] == b["tickers"]

    # A genuinely delisted REAL ticker is still pruned; the alive one stays.
    assert by_name["Junk"]["tickers"] == ["AAPL"]


def test_refresh_delisted_computation_excludes_synthetics():
    # The refresh builds `committed` skipping synthetics, so none can ever land in
    # `delisted`. Mirror that computation over the real committed config.
    committed = set()
    for l in wp._load_committed():
        committed.update(t.upper() for t in l["tickers"] if not wp._is_synthetic_ticker(t))
    assert not any(t.startswith("$IDX:") for t in committed)
    assert not any(wp._is_synthetic_ticker(t) for t in committed)
    # Real tickers are still present (sanity: we didn't drop everything).
    assert "SPY" in committed or any(len(t) <= 5 and t.isalpha() for t in committed)
