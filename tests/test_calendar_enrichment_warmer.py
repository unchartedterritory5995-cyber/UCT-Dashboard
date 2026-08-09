"""The current week's enrichment must stay hot, or users pay the cold fan-out.

`_ENRICH_TTL` is 300s on a hard clock over a compute measured at 18-25s for one
day and 60-100s for a cold week. The boot warm is ONE-SHOT, so it covers only a
pod's first five minutes; after that every 5-minute window handed the full
recompute to whichever user opened the calendar first, and they sat on a
spinner in the modal's Setup / Earnings History / Brief sections.

Measured on prod 2026-08-08: enrichment cold 17.9s / warm 0.14s; whole-week
batch cold 24.8s / warm 0.22s.
"""
import api.main as main
from api.routers import calendar as cal


def test_the_rewarm_interval_is_under_the_cache_ttl():
    """The whole point. A cadence at or above the TTL leaves a window in which
    the entry is expired and no warm is in flight — which is the defect."""
    src = main._start_calendar_enrichment_warm_background.__doc__ or ""
    assert src, "the warmer lost its rationale"
    import inspect
    body = inspect.getsource(main._start_calendar_enrichment_warm_background)
    assert "time.sleep(240)" in body, "re-warm cadence changed"
    assert 240 < cal._ENRICH_TTL, "cadence must be UNDER the enrichment TTL"


def test_the_margin_absorbs_the_compute_itself():
    """240s under a 300s TTL leaves 60s of slack. The compute is ~25s cold, so
    the warm finishes well before the entry expires. If the margin ever drops
    below the compute time, the entry expires while its own refresh is still
    running and a user walks into the gap."""
    margin = cal._ENRICH_TTL - 240
    assert margin >= 45, (
        f"only {margin}s of slack between the re-warm and the TTL — a ~25s "
        "compute needs room to finish before the entry expires"
    )


def test_it_is_registered_at_startup():
    """A warmer that is never started is a comment."""
    import inspect
    src = inspect.getsource(main)
    assert src.count("_start_calendar_enrichment_warm_background()") >= 1, \
        "the enrichment warmer is defined but never started"


def test_it_warms_the_current_week_and_never_raises(monkeypatch):
    """It runs on a daemon thread with no supervisor: an exception that escapes
    would silently kill the loop and the cliff would return with no signal."""
    import inspect
    body = inspect.getsource(main._start_calendar_enrichment_warm_background)
    assert "_week_dates()" in body, "must warm the CURRENT week, not a fixed date"
    assert "except Exception" in body, "a raise would kill the loop permanently"
