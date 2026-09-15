"""The forward seal, END TO END, through the REAL pipeline — no provider.

⭐⭐ THE ORCHESTRATION RAILS STUB `sweep_history`, WHICH IS EXACTLY WHAT THEY SHOULD
DO — but a stub cannot show that the daily value is the same thing as the historical
value beside it. This case runs the real `sweep_history` → `build_frame` →
`eligible_on` → `compute_metrics` → `write_bulk` chain against the DURABLE FRAME
CACHE, with the provider client replaced by one that RAISES. A cache miss fails
loudly rather than computing over a short frame.

⛔ OFFLINE AND SKIPPED WHEN THE CACHE IS ABSENT. The frames live in a scratch
directory outside the repo (they are ~0.5 MB each); this is a machine-local
integration rail, not something CI can fabricate. It SKIPS rather than passes
vacuously when they are not there — a rail that silently stops testing is worse than
no rail.
"""
import os
import shutil

import pytest

CACHE = r"C:\w\breadth-library-cache"
FRAMES = os.path.join(CACHE, "grouped_ohlcv")
#: The window the durable cache holds RAW frames for — eligibility needs raw.
SEALABLE = ["2015-03-10", "2015-03-11", "2015-03-12", "2015-03-13"]
SEEDED = "2015-03-09"

pytestmark = pytest.mark.skipif(
    not os.path.isdir(FRAMES)
    or not all(os.path.exists(os.path.join(FRAMES, f"{d}_0.json"))
               for d in [SEEDED] + SEALABLE),
    reason="durable grouped-daily frame cache not present on this machine")


@pytest.fixture
def offline(monkeypatch, tmp_path):
    """DATA_DIR points at the frame cache; the store is a throwaway; the network
    raises."""
    monkeypatch.setenv("DATA_DIR", CACHE)
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "e2e.db"))
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)

    from api.services import massive
    from api.services import breadth_daily_ohlc as store
    from api.services import breadth_history_recon as recon

    def _no_network():
        raise RuntimeError("a frame was not cached and this test runs OFFLINE")
    monkeypatch.setattr(massive, "_get_client", _no_network)
    # ⚠️ `_GROUPED_OHLCV_DIR` IS EVALUATED AT IMPORT, so setting DATA_DIR in a
    # fixture only works when this file happens to import `massive` first. Run inside
    # the full breadth slice it does not, the frames are looked for in the wrong
    # directory, and every case fails on a cache miss. Patching the constant makes the
    # rail order-independent instead of accidentally-passing.
    monkeypatch.setattr(massive, "_GROUPED_OHLCV_DIR", FRAMES)
    store._INIT_DONE = False
    recon._FORWARD_SEAL_STATE.clear()
    yield store, recon
    store._INIT_DONE = False


def _seed_first_day(store, recon):
    """The historical backfill owns the first population; the seal walks forward
    from it. Sweeping one day is the smallest honest way to produce that state."""
    res = recon.sweep_history(SEEDED, SEEDED, universe="us", warmup_days=539)
    assert res.get("ok"), res.get("reason")
    assert store.stats("us")["last"] == SEEDED
    return res


def test_the_seal_advances_the_right_edge_through_the_real_pipeline(offline):
    store, recon = offline
    _seed_first_day(store, recon)

    out = recon.forward_seal_tick("us", through=SEALABLE[-1])
    assert out.get("sealed") == len(SEALABLE), out
    assert not out.get("failed") and not out.get("partial")
    assert store.stats("us")["last"] == SEALABLE[-1]
    assert store.dates_since("us", SEEDED) == [SEEDED] + SEALABLE


def test_the_sealed_value_equals_what_the_historical_sweep_produces(offline):
    """⛔⛔ ONE ENGINE, PROVEN. If the daily job produced a different number from the
    backfill, a published series would carry a seam at the date the grind stopped —
    and nothing would show it. The seal writes a date; a direct historical sweep of
    the SAME date must write the identical row."""
    store, recon = offline
    _seed_first_day(store, recon)
    recon.forward_seal_tick("us", through=SEALABLE[-1])
    sealed = {m: store.history(m, universe="us").get(SEALABLE[1])
              for m in ("pct_above_50sma", "new_52w_highs", "net_new_high_low",
                        "universe_count", "adv_decline")}
    assert all(v for v in sealed.values()), sealed

    # …now recompute that one date the historical way, into a fresh store
    import tempfile
    tmp = tempfile.mkdtemp()
    try:
        os.environ["BREADTH_OHLC_DB"] = os.path.join(tmp, "hist.db")
        store._INIT_DONE = False
        res = recon.sweep_history(SEALABLE[1], SEALABLE[1], universe="us",
                                  warmup_days=539)
        assert res.get("ok"), res.get("reason")
        hist = {m: store.history(m, universe="us").get(SEALABLE[1]) for m in sealed}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    for metric, row in sealed.items():
        assert row["c"] == hist[metric]["c"], metric      # the VALUE is identical


def test_the_seal_is_idempotent_over_the_real_pipeline(offline):
    store, recon = offline
    _seed_first_day(store, recon)
    recon.forward_seal_tick("us", through=SEALABLE[-1])
    before = {d: store.closes_for_dates([d], universe="us")
              for d in [SEEDED] + SEALABLE} if hasattr(store, "closes_for_dates") \
        else store.history("pct_above_50sma", universe="us")

    again = recon.forward_seal_tick("us", through=SEALABLE[-1])
    assert again.get("blocked") and again.get("current")

    after = {d: store.closes_for_dates([d], universe="us")
             for d in [SEEDED] + SEALABLE} if hasattr(store, "closes_for_dates") \
        else store.history("pct_above_50sma", universe="us")
    assert after == before


def test_the_seal_REFUSES_a_window_whose_raw_frame_is_missing(offline, monkeypatch):
    """⛔ The Phase-6 defect, re-proven at the seal: `get_grouped_daily_ohlcv`
    swallows its exceptions, so a failed RAW fetch arrives looking exactly like a
    quiet day. `build_frame` refuses the chunk; the seal must carry that through and
    leave the store where it was."""
    store, recon = offline
    _seed_first_day(store, recon)

    from api.services import massive
    real = massive.get_grouped_daily_ohlcv

    def _hole(day_iso, adjusted=False):
        if not adjusted and day_iso == SEALABLE[1]:
            return {}                      # the fetch "failed"
        return real(day_iso, adjusted=adjusted)
    monkeypatch.setattr(massive, "get_grouped_daily_ohlcv", _hole)

    out = recon.forward_seal_tick("us", through=SEALABLE[-1])
    assert out.get("failed") is True
    assert SEALABLE[1] in (out.get("missing_raw") or [])
    assert store.stats("us")["last"] == SEEDED      # NOTHING advanced
    assert store.dates_since("us", SEEDED) == [SEEDED]
    st = recon.forward_seal_state("us")
    assert st["failed"] is True and st["sealed"] == 0


def test_a_sealed_pit_row_carries_only_published_and_producible_metrics(offline):
    store, recon = offline
    _seed_first_day(store, recon)
    recon.forward_seal_tick("us", through=SEALABLE[-1])

    from api.services import breadth_metrics as bm
    written = {m for m in bm.METRIC_KEYS
               if store.history(m, universe="us").get(SEALABLE[-1])}
    # the unproducible three never appear…
    assert not (written & bm.PIT_UNPRODUCIBLE)
    # …nor does anything non-portable…
    assert all(bm.is_portable(m) for m in written)
    # …and the whole V1 set that applies to US IS there
    v1 = {m for m in bm.V1_METRICS if bm.applies_to(m, "us")}
    assert v1 <= written, v1 - written
