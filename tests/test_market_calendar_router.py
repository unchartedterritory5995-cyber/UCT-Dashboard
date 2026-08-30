"""GET /api/market-calendar — the NYSE closure dates, DERIVED not retyped.

🔴 WHY THIS ROUTE HAS A RAIL AT ALL. Its whole reason to exist is that the
browser must not carry its own copy of the closure list: a second authority
over one value is this repo's most repeated defect, and the copies diverge in
whichever year somebody refreshes only one. A route that quietly stopped
deriving from `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` — a literal list pasted in
"temporarily", a filter that drops a year — would look correct and would be
exactly the failure the route was built to prevent, so the derivation itself
is what is asserted here, not a sample of dates.
"""
import re
from datetime import date

from fastapi.testclient import TestClient

from api.main import app
from api.services.bars_fetch import _NYSE_HOLIDAYS_YYYYMMDD

client = TestClient(app)


def _payload() -> dict:
    r = client.get("/api/market-calendar")
    assert r.status_code == 200, r.text
    return r.json()


def test_it_serves_every_date_the_one_closure_table_holds_and_no_others():
    # ⭐ EQUALITY, NOT CONTAINMENT. `assert "2026-11-26" in holidays` passes for
    # a hand-typed list that happens to include Thanksgiving and is missing
    # Juneteenth — which is the shape of the bug, not the absence of one.
    expected = {
        f"{str(d)[0:4]}-{str(d)[4:6]}-{str(d)[6:8]}" for d in _NYSE_HOLIDAYS_YYYYMMDD
    }
    assert set(_payload()["holidays"]) == expected


def test_the_list_is_ascending_so_a_consumer_can_reason_about_its_ends():
    days = _payload()["holidays"]
    assert days == sorted(days)
    assert len(days) == len(set(days)), "a duplicated date means two sources, not one"


def test_covers_through_is_the_end_of_the_last_year_the_table_enumerates():
    # ⛔ THE HORIZON IS THE LOAD-BEARING FIELD. Without it, a date past the end
    # of the table is indistinguishable from a date the exchange is open — so
    # the year this hand-maintained list stops being refreshed, every consumer
    # silently goes holiday-blind and nothing says so. The frontend refuses to
    # draw a countdown past this date, which is what turns a stale table into a
    # visible absence instead of a confident wrong answer.
    last_year = max(str(d)[0:4] for d in _NYSE_HOLIDAYS_YYYYMMDD)
    assert _payload()["covers_through"] == f"{last_year}-12-31"


def test_it_is_public_so_a_free_member_still_gets_a_verified_countdown():
    # The Dashboard is a FREE_PAGE and Zone A renders for free-tier members.
    # A 401/402 here would turn the countdown off for them permanently — the
    # suppression path firing for a reason that has nothing to do with the
    # calendar. `TestClient` above carries no session cookie.
    assert client.get("/api/market-calendar").status_code == 200


def test_the_dates_are_iso_and_none_are_malformed():
    for d in _payload()["holidays"]:
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", d), d


def test_it_names_where_it_read_from_so_the_next_engineer_finds_the_one_table():
    assert _payload()["source"] == "bars_fetch._NYSE_HOLIDAYS_YYYYMMDD"


def test_CONTROL_the_equality_check_can_actually_fail(monkeypatch):
    """A rail nobody has seen fire is not a rail. Perturb the ONE table and the
    derived list must move with it — proving it derives rather than carrying a
    copy that would stay right while the source changed.

    ⚠️ THE PERTURBATION HAS TO RE-RUN THE IMPORT. The list is now built once at
    module scope, so patching the frozenset on the live module changes nothing
    — which is not evidence the derivation is dead, only that it already ran.
    Reloading is what a deploy does, and it is the only perturbation that can
    still discriminate. (An earlier version of this test patched the name and
    passed for the wrong reason the moment the list was precomputed; it failed
    loudly instead, which is the whole point of keeping a control.)
    """
    import importlib

    import api.services.bars_fetch as bf
    import api.routers.market_calendar as mc

    original = bf._NYSE_HOLIDAYS_YYYYMMDD
    try:
        bf._NYSE_HOLIDAYS_YYYYMMDD = frozenset(original | {20260102})
        reloaded = importlib.reload(mc)
        assert "2026-01-02" in reloaded._HOLIDAYS_ISO
    finally:
        bf._NYSE_HOLIDAYS_YYYYMMDD = original
        importlib.reload(mc)

    # …and with the source restored, so is the answer.
    assert "2026-01-02" not in importlib.import_module(
        "api.routers.market_calendar")._HOLIDAYS_ISO


# ---------------------------------------------------------------------------
# The anti-rot signal
# ---------------------------------------------------------------------------
#
# 🔴 WHAT WAS MISSING. The horizon clause makes the dashboard countdown
# DISAPPEAR once the closure table lapses — correct, and silent. "No countdown"
# already means "still loading" and "endpoint down", so a permanent failure
# would be indistinguishable from a transient that clears on its own, and the
# in-file "refresh annually" contract was enforced by nothing at all.
#
# ⛔ AND THE FIX IS NOT `assert max_year >= today.year + 1`. That rail goes red
# purely because time passed — a dated time bomb, on a suite that runs against
# every unrelated change. So the signal is a FIELD in the payload (always
# present, POSITIVE when clean) plus an admin alert when it is not, and every
# test below INJECTS the date it classifies against instead of asking the clock.

def test_status_is_always_present_so_silence_means_nobody_looked():
    # ⭐ THE "did not look" vs "clean" DISTINCTION, and the whole reason this is
    # a field rather than a warning. A check that only speaks up when unhappy
    # cannot tell "I looked and it is fine" from "I never ran": both are quiet.
    # A positive `status` is evidence of the former; its ABSENCE is the latter.
    body = _payload()
    assert "status" in body
    assert body["status"] in ("ok", "expiring", "expired", "unknown")
    assert "days_remaining" in body


def test_the_runway_classifies_against_an_INJECTED_date_never_the_clock():
    import api.routers.market_calendar as mc

    horizon = date.fromisoformat(mc._COVERS_THROUGH)
    day = lambda n: date.fromordinal(horizon.toordinal() - n)  # noqa: E731

    # Comfortably inside → clean, with the runway stated.
    assert mc._classify(day(400)) == ("ok", 400)
    # One day the far side of the warning threshold → still clean.
    assert mc._classify(day(mc._EXPIRING_WITHIN_DAYS + 1))[0] == "ok"
    # On it → speaking up, while the countdown still works.
    assert mc._classify(day(mc._EXPIRING_WITHIN_DAYS))[0] == "expiring"
    # The last day it can answer for is still not expired.
    assert mc._classify(horizon) == ("expiring", 0)
    # Past it → expired, and `days_remaining` goes negative rather than absent.
    assert mc._classify(date.fromordinal(horizon.toordinal() + 1)) == ("expired", -1)


def test_the_warning_fires_BEFORE_the_countdown_vanishes_not_with_it():
    # ⭐ THE POINT OF THE THRESHOLD. A signal that arrives the day the feature
    # breaks is not a warning, it is a post-mortem. The source list is refreshed
    # BY HAND once a year, so the notice period has to be a meaningful fraction
    # of that cadence.
    import api.routers.market_calendar as mc

    assert mc._EXPIRING_WITHIN_DAYS >= 90, (
        "less than a quarter's notice on an annually-refreshed, hand-maintained "
        "table is not enough for anyone to act on"
    )


ANY_DAY = date(2026, 8, 30)


def _emissions(monkeypatch) -> list:
    """Capture what `_announce` hands the alert feed, without touching it."""
    from api.services import chart_health_alerts

    seen: list = []
    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda *a, **kw: seen.append(a) or True)
    return seen


def test_a_non_clean_runway_reaches_the_admin_alert_feed(monkeypatch):
    # `chart_health_alerts` is rendered by pages/admin/ChartHealth.jsx — a
    # surface a human actually reads, unlike a log line nobody greps or a tool
    # nobody runs.
    import api.routers.market_calendar as mc

    seen = _emissions(monkeypatch)
    mc._announce("expiring", 100, ANY_DAY)
    assert len(seen) == 1
    # The message has to carry the FIX, not just the complaint.
    assert "_NYSE_HOLIDAYS_YYYYMMDD" in seen[0][2]
    assert "nyse.com" in seen[0][2]


# ---------------------------------------------------------------------------
# The PUSH path
# ---------------------------------------------------------------------------
#
# THE FEED ALONE WAS NOT A SIGNAL. `chart_health_alerts` keeps entries in an
# in-memory `deque(maxlen=200)` that is WIPED ON EVERY REDEPLOY (several times a
# day here), behind an admin page nobody is prompted to open - and it pages
# Discord only on `critical`. The first cut mapped `expiring -> "warning"`, so
# the 180-day early warning had no push path at all and Discord heard about it
# only at `expired`, i.e. after the countdown had already vanished for every
# member. A warning that arrives with the failure is a post-mortem.
#
# AND THE EARLIER TEST ENCODED THAT RATHER THAN CATCHING IT: it asserted
# `expiring == "warning"` as if it were the requirement. A guard testing the
# adjacent thing - it pinned what the code did, not what the code needed to do.

def test_a_MILESTONE_day_is_critical_so_it_actually_pages(monkeypatch):
    import api.routers.market_calendar as mc

    for days in mc._MILESTONE_DAYS:
        seen = _emissions(monkeypatch)
        mc._announce("expiring", days, ANY_DAY)
        assert len(seen) == 1, days
        key, severity = seen[0][0], seen[0][1]
        # `_should_page_discord` returns False for anything but "critical" -
        # severity IS the push switch in this system.
        assert severity == "critical", f"{days} days out would not have paged"
        # Its OWN key, so the per-key 30-min cooldown cannot swallow the next
        # milestone and the feed shows them as separate events.
        assert key == f"market_calendar_expiring_{days}d"


def test_CONTROL_an_ordinary_expiring_day_stays_a_feed_WARNING(monkeypatch):
    # THE OTHER HALF, AND WHY THIS IS NOT JUST "make expiring critical".
    # `_DISCORD_COOLDOWN_SEC` is 30 minutes, so a permanently-critical expiring
    # would page up to 48x/day for 180 days - the same as no alert at all.
    import api.routers.market_calendar as mc

    for days in (179, 120, 91, 45, 8, 2):
        seen = _emissions(monkeypatch)
        mc._announce("expiring", days, ANY_DAY)
        assert seen[0][1] == "warning", f"{days} days out paged when it should not"
        assert seen[0][0] == "market_calendar_stale"


def test_every_milestone_is_inside_the_window_that_can_reach_it():
    # A MILESTONE OUTSIDE `_EXPIRING_WITHIN_DAYS` COULD NEVER FIRE: the status
    # would still be "ok" on that day and `_announce` returns early. The two
    # constants have to move together, and nothing else would say so.
    import api.routers.market_calendar as mc

    assert max(mc._MILESTONE_DAYS) <= mc._EXPIRING_WITHIN_DAYS
    assert max(mc._MILESTONE_DAYS) == mc._EXPIRING_WITHIN_DAYS, (
        "the longest notice should be the moment the window opens, or the first "
        "half of the warning period passes in silence"
    )
    assert list(mc._MILESTONE_DAYS) == sorted(mc._MILESTONE_DAYS, reverse=True)


def test_the_milestones_are_reachable_by_the_classifier():
    # The bridge between the two halves: a milestone is only ever hit if
    # `_classify` actually produces that exact `days_remaining` on some day.
    import api.routers.market_calendar as mc

    horizon = date.fromisoformat(mc._COVERS_THROUGH)
    for days in mc._MILESTONE_DAYS:
        day = date.fromordinal(horizon.toordinal() - days)
        assert mc._classify(day) == ("expiring", days)


def test_expired_pages_but_is_DAY_STAMPED_rather_than_every_30_minutes(monkeypatch):
    import api.routers.market_calendar as mc

    seen = _emissions(monkeypatch)
    mc._announce("expired", -5, date(2027, 1, 2))
    mc._announce("expired", -6, date(2027, 1, 3))
    assert [a[1] for a in seen] == ["critical", "critical"]
    assert [a[0] for a in seen] == [
        "market_calendar_expired_2027-01-02",
        "market_calendar_expired_2027-01-03",
    ]
    # Same day twice = the same key, so the feed's own throttle collapses it.
    seen2 = _emissions(monkeypatch)
    mc._announce("expired", -5, date(2027, 1, 2))
    mc._announce("expired", -5, date(2027, 1, 2))
    assert seen2[0][0] == seen2[1][0]


def test_CONTROL_a_clean_runway_raises_nothing(monkeypatch):
    # Without this, the alerts above are satisfied by one that fires every day -
    # which is the same as never firing, because nobody would read it.
    import api.routers.market_calendar as mc

    seen = _emissions(monkeypatch)
    mc._announce("ok", 488, ANY_DAY)
    assert seen == []


def test_the_alert_can_never_break_the_route(monkeypatch):
    # Best-effort, exactly like provider_coverage_monitor._alert. A diagnostic
    # that can 500 the endpoint it diagnoses is worse than no diagnostic.
    import api.routers.market_calendar as mc
    from api.services import chart_health_alerts

    def boom(*a, **kw):
        raise RuntimeError("alert feed down")

    monkeypatch.setattr(chart_health_alerts, "emit", boom)
    mc._announce("expired", -5, ANY_DAY)          # must not raise
    assert _payload()["status"] in ("ok", "expiring", "expired", "unknown")


def test_the_list_is_built_once_at_import_not_per_request():
    # Cheap, and it also pins that the payload SHARES the precomputed tuple
    # rather than re-deriving a second copy that could drift from it.
    import api.routers.market_calendar as mc

    assert isinstance(mc._HOLIDAYS_ISO, tuple)
    assert _payload()["holidays"] == list(mc._HOLIDAYS_ISO)
    assert _payload()["covers_through"] == mc._COVERS_THROUGH
