"""RS RANKING — where the universe comes from, and who reads the answer.

🔴 THE DEFECT. `_get_universe` read `cache.get("wire_data")` and returned `[]`
when the push had not landed. On 2026-08-09 the volume file that seeds that
cache on this box was a 241-byte stub dated **2026-02-22** carrying
`cap_universe: []`. So `compute_rs_scores` logged *"No universe available"* and
returned `[]` — permanently — and every consumer read an empty answer that is
indistinguishable from "the market has no strong names": `groups_gates`'s RS
floor, `/api/rs-rankings`, and (once the screener was wired to it) `rs_rank` on
every row.

⚠️ A CACHE IS NOT A STORE. The fallback is the same list, versioned in the repo
at `api/data/cap_universe.json`, resolved through the ONE loader that already
owns that path (`screener/snapshot_builder._load_universe`) rather than a fifth
private copy of it.
"""
from __future__ import annotations

import ast as pyast
import pathlib

from api.services import rs_ranking
from api.services.cache import cache

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _clear_wire():
    cache.set("wire_data", None, ttl=1)
    cache.invalidate("wire_data")


def test_the_disk_universe_answers_when_wire_data_is_missing():
    _clear_wire()
    universe = rs_ranking._get_universe()
    assert len(universe) > 1000, (
        "the on-disk cap universe should carry the full ~3,700-name list; got "
        f"{len(universe)}")
    assert all(isinstance(t, str) for t in universe)


def test_the_disk_universe_answers_when_wire_data_carries_an_empty_list():
    """🔴 THE ACTUAL SHAPE ON DISK — not a missing key, a PRESENT-BUT-EMPTY one.

    A guard written as `if not wire: return []` passes this file's other case
    and still returns `[]` here, which is exactly what shipped.
    """
    _clear_wire()
    cache.set("wire_data", {"date": "2026-02-22", "cap_universe": []}, ttl=60)
    try:
        assert len(rs_ranking._get_universe()) > 1000
    finally:
        cache.invalidate("wire_data")


def test_wire_data_still_wins_when_it_has_a_universe():
    """The fallback is a fallback. A pod with a fresh push must rank the pushed
    population, not silently switch to the file."""
    _clear_wire()
    cache.set("wire_data", {"cap_universe": ["AAA", "BBB", "CCC"]}, ttl=60)
    try:
        assert rs_ranking._get_universe() == ["AAA", "BBB", "CCC"]
    finally:
        cache.invalidate("wire_data")


def test_leadership_names_are_still_appended_to_the_disk_universe():
    _clear_wire()
    cache.set("wire_data",
              {"cap_universe": [], "leadership": [{"ticker": "ZZZZQ"}]}, ttl=60)
    try:
        universe = rs_ranking._get_universe()
        assert "ZZZZQ" in universe
        assert len(universe) > 1000
    finally:
        cache.invalidate("wire_data")


def test_the_universe_path_is_imported_not_re_resolved():
    """⛔ ONE AUTHORITY over where `cap_universe.json` lives.

    This repo already holds four private `_load_universe` copies. Asserted by
    AST rather than by grep: `_disk_universe` must contain no path literal of
    its own, and must import the loader that owns the path.
    """
    src = (ROOT / "api" / "services" / "rs_ranking.py").read_text(encoding="utf-8")
    tree = pyast.parse(src)
    fn = next(n for n in pyast.walk(tree)
              if isinstance(n, pyast.FunctionDef) and n.name == "_disk_universe")
    # ⚠️ THE DOCSTRING IS PROSE, NOT A PATH. Grading it would forbid the comment
    # that explains the rule — the failure mode a first cut of this rail hit.
    body = fn.body[1:] if pyast.get_docstring(fn) else fn.body
    literals = [n.value for stmt in body for n in pyast.walk(stmt)
                if isinstance(n, pyast.Constant) and isinstance(n.value, str)]
    assert not any("cap_universe" in s or ".json" in s for s in literals), \
        f"_disk_universe re-spells the universe path: {literals}"
    imports = [n for n in pyast.walk(fn) if isinstance(n, pyast.ImportFrom)]
    assert any(i.module and i.module.endswith("snapshot_builder") for i in imports), \
        "_disk_universe must import the loader that owns cap_universe.json"


# ───────────────────────── the by-symbol reader ─────────────────────────────

def test_cached_rank_map_is_cache_only_and_never_computes(monkeypatch):
    """⛔ A build must never trigger the ~17s full-universe rebuild."""
    calls = []
    monkeypatch.setattr(rs_ranking, "_get_universe",
                        lambda: calls.append(1) or [])
    cache.invalidate(rs_ranking._CACHE_KEY)
    assert rs_ranking.cached_rank_map() == {}
    assert calls == [], "cached_rank_map computed instead of reading the cache"


def test_cached_rank_map_keys_are_uppercased():
    cache.set(rs_ranking._CACHE_KEY,
              [{"ticker": "nvda", "rs_rank": 97, "rs_score": 41.2}], ttl=60)
    try:
        assert rs_ranking.cached_rank_map()["NVDA"]["rs_rank"] == 97
    finally:
        cache.invalidate(rs_ranking._CACHE_KEY)


def test_get_rs_for_ticker_reads_the_same_map():
    """One reader of the cache's shape — the lookup and the map cannot disagree."""
    cache.set(rs_ranking._CACHE_KEY,
              [{"ticker": "NVDA", "rs_rank": 97, "rs_score": 41.2},
               {"ticker": "INTC", "rs_rank": 4, "rs_score": -8.0}], ttl=60)
    try:
        assert rs_ranking.get_rs_for_ticker("nvda")["rs_rank"] == 97
        assert rs_ranking.get_rs_for_ticker("AAPL") is None
        assert rs_ranking.get_rs_for_ticker("INTC") is rs_ranking.cached_rank_map()["INTC"]
    finally:
        cache.invalidate(rs_ranking._CACHE_KEY)
