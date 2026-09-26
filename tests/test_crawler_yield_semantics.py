"""The crawler's "empty" was two different facts, and averaging them hid both.

⛔⛔ THE DEFECT. `_default_warm` answered `after is not None and (before is None or
after > before)` — "did the stored tail advance?" — and reported everything else as
EMPTY, parking it in the no-data cooldown. A symbol holding perfectly valid 5m bars
that simply did not PRINT since the last pass lands in that branch: it is cold-stale so
it gets attempted, the provider correctly returns nothing new, the tail does not move,
and the crawler files a chartable series as "no usable 5m data".

⭐ MEASURED 2026-09-24, indexed point lookups, deterministic n=80 spread of each
population: cap_universe has **0.0%** symbols with no 5m rows (12.5% cold-stale, 87.5%
current), so its "empty" outcomes were ENTIRELY this misclassification. The reference
tail inverts — **82.5%** hold no rows at all — so there the label was mostly right. One
counter was averaging two populations AND two meanings, which is why the headline
"~46% empty" never meant what it appeared to.

⚠️ NO_DATA IS STILL REAL and still parks. Only the no-advance case is rescued.
"""
from __future__ import annotations

from api.services import bars_universe_crawler as C


def _pass(warm, **kw):
    """Drive one sweep over a single always-stale ticker."""
    parked, advanced = [], []
    cur, filled, skipped, empty, no_adv = C.crawl_pass(
        ["X"], 0, is_stale=lambda s: True, warm=warm, pace=lambda: None,
        on_empty=parked.append, on_no_advance=advanced.append, **kw)
    return {"filled": filled, "skipped": skipped, "empty": empty,
            "no_advance": no_adv, "parked": parked, "advanced": advanced}


# ── outcome classification ───────────────────────────────────────────────────
def test_no_usable_data_is_still_no_data_and_still_parks():
    r = _pass(lambda s: C.NO_DATA)
    assert (r["empty"], r["no_advance"], r["filled"]) == (1, 0, 0)
    assert r["parked"] == ["X"], "a genuinely empty symbol must still enter cooldown"


def test_no_advance_is_NOT_empty_and_is_NOT_parked():
    """⛔ THE RELEASE-BLOCKING RAIL. This symbol has proven 5m capability; it simply
    printed nothing new. Filing it as unsupported is the defect."""
    r = _pass(lambda s: C.NO_ADVANCE)
    assert r["no_advance"] == 1
    assert r["empty"] == 0, "a no-advance outcome was counted as no-data"
    assert r["parked"] == [], "a capable symbol was parked as unsupported"
    assert r["advanced"] == ["X"]


def test_a_warmed_fetch_is_unchanged():
    r = _pass(lambda s: C.WARMED)
    assert (r["filled"], r["empty"], r["no_advance"]) == (1, 0, 0)
    assert r["parked"] == []


def test_no_advance_still_costs_a_pace_because_it_hit_the_provider():
    """It is cheaper than a fill in value, not in provider cost."""
    paced = []
    C.crawl_pass(["X"], 0, is_stale=lambda s: True, warm=lambda s: C.NO_ADVANCE,
                 pace=lambda: paced.append(1))
    assert len(paced) == 1


def test_skipped_is_not_overloaded_to_mean_no_advance():
    """⚠️ SKIPPED MEANS THE FETCH WAS NEVER ATTEMPTED. Four states stay distinct:
    not attempted / attempted-no-advance / attempted-no-data / warmed."""
    r = _pass(lambda s: C.NO_ADVANCE)
    assert r["skipped"] == 0


# ── the legacy bool contract must keep working ───────────────────────────────
def test_legacy_true_still_means_warmed():
    assert _pass(lambda s: True)["filled"] == 1


def test_legacy_false_still_means_no_data_and_parks():
    r = _pass(lambda s: False)
    assert r["empty"] == 1 and r["parked"] == ["X"]


# ── the real predicate, exercised through a fake store ───────────────────────
def _warm_with(monkeypatch, before, after):
    seq = iter([before, after])
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(bs, "get_last_ts", lambda s, tf: next(seq))
    import api.routers.bars as br
    monkeypatch.setattr(br, "_get_bars_inner", lambda *a, **k: None)
    return C._default_warm("X", 780)


def test_default_warm_never_had_rows_and_still_has_none(monkeypatch):
    assert _warm_with(monkeypatch, None, None) == C.NO_DATA


def test_default_warm_had_rows_that_did_not_move(monkeypatch):
    assert _warm_with(monkeypatch, 1000, 1000) == C.NO_ADVANCE


def test_default_warm_tail_went_backwards_is_not_a_fill(monkeypatch):
    """Defensive: a smaller tail is not an advance, and must not read as a fill."""
    assert _warm_with(monkeypatch, 1000, 900) == C.NO_ADVANCE


def test_default_warm_tail_advanced(monkeypatch):
    assert _warm_with(monkeypatch, 1000, 1200) == C.WARMED


def test_default_warm_brand_new_ticker(monkeypatch):
    assert _warm_with(monkeypatch, None, 1200) == C.WARMED
