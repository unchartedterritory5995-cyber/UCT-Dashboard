"""Unit tests for the liveflow monitor's pure decision functions.

No network, no threads — classifier, alert state machine, market calendar,
and scorecard grading only.

TERM-011 / RM-N09 step 5 addendum — `_post_discord` + `start_liveflow_monitor`'s
webhook gate now resolve through `alert_destination.ops_webhook()`. This is the
OPS member of D7's nine and it does NOT fail closed like the other eight: it is
the outage oracle, and a monitor that goes silent when unconfigured means a real
outage reports nothing. So the property under test here is the OPPOSITE of
`test_discord_watchlist_webhook.py`'s: with everything unconfigured this module
still resolves to today's admin channel via the shared compatibility floor, and
only truly nothing (both variables blank) makes it inert.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import liveflow_monitor as lm
from api.services import alert_routing as ar

ET = ZoneInfo("America/New_York")

TODAY = "https://discord.com/api/webhooks/111/TODAYS-ADMIN-CHANNEL-TOKEN"
OPS_ONLY = "https://discord.com/api/webhooks/222/A-DEDICATED-OPS-CHANNEL-TOKEN"


@pytest.fixture(autouse=True)
def _no_leaked_ops_vars(monkeypatch):
    """Same posture as `tests/test_alert_destination.py`'s `production_env`:
    the two destination variables absent, matching Railway on 2026-09-27."""
    for name in (ar.OPS_WEBHOOK_ENV, ar.BUSINESS_WEBHOOK_ENV, ar.OPS_EMAIL_ENV,
                 ar.ROUTING_FLAG_ENV):
        monkeypatch.delenv(name, raising=False)


def _dt(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=ET)


# --- classify_poll -----------------------------------------------------------

def test_classify_healthy_when_max_id_advancing_despite_skewed_age():
    # DST bomb simulation: the router's age field reads +3600s wrong, but the
    # caller-computed staleness (max_id advanced recently) is small -> HEALTHY.
    payload = {"max_id": 123, "last_event_age_sec": 9999.0}
    assert lm.classify_poll(True, payload, staleness_sec=30.0, threshold=180) == lm.HEALTHY


def test_classify_worker_down_on_frozen_max_id():
    payload = {"max_id": 123, "last_event_age_sec": 10.0}  # age even LIES healthy
    assert lm.classify_poll(True, payload, staleness_sec=200.0, threshold=180) == lm.WORKER_DOWN


def test_classify_blind_db_and_blind_web():
    assert lm.classify_poll(True, {"last_error": "db locked", "max_id": None},
                            staleness_sec=0) == lm.BLIND_DB
    assert lm.classify_poll(True, {"max_id": None}, staleness_sec=0) == lm.BLIND_DB
    assert lm.classify_poll(False, None, staleness_sec=0) == lm.BLIND_WEB
    assert lm.classify_poll(True, "not-a-dict", staleness_sec=0) == lm.BLIND_WEB


def test_classify_proxied_upstream_error_is_worker_down_not_blind():
    # P5: after cutover web's status endpoint proxies to the flow worker, so a
    # 502/503/504 means web is UP but the WORKER is down -> LOUD WORKER_DOWN,
    # never suppressed BLIND_WEB.
    for code in (502, 503, 504):
        assert lm.classify_poll(False, None, staleness_sec=0,
                                status_code=code) == lm.WORKER_DOWN
    # a real web-unreachable (no status) or a non-upstream error stays BLIND_WEB
    assert lm.classify_poll(False, None, staleness_sec=0, status_code=None) == lm.BLIND_WEB
    assert lm.classify_poll(False, None, staleness_sec=0, status_code=404) == lm.BLIND_WEB


# --- alert state machine ------------------------------------------------------

def _run(seq, t0=1000.0, step=60.0):
    """Feed a classification sequence; return the list of events."""
    s = lm.initial_state()
    events = []
    for i, cls in enumerate(seq):
        s, ev = lm._liveflow_alert_decision(s, cls, t0 + i * step)
        events.append(ev)
    return events, s


def test_down_needs_two_consecutive_polls():
    events, _ = _run([lm.WORKER_DOWN])
    assert events == [None]
    events, _ = _run([lm.WORKER_DOWN, lm.HEALTHY, lm.WORKER_DOWN])
    assert events == [None, None, None]  # non-consecutive never fires
    events, s = _run([lm.WORKER_DOWN, lm.WORKER_DOWN])
    assert events == [None, "down"] and s["down"]


def test_escalation_at_ten_minutes_then_renags():
    seq = [lm.WORKER_DOWN] * 45  # 45 minutes of outage at 60s polls
    events, _ = _run(seq)
    assert events[1] == "down"
    first_escalate = events.index("escalate")
    # down fires at t=+60s; escalation requires >=600s after down_since
    assert 10 <= first_escalate <= 12
    assert events.count("escalate") == 1
    renags = [i for i, e in enumerate(events) if e == "still_down"]
    assert renags, "expected at least one 30-min renag"
    assert renags[0] - first_escalate >= 29  # ~30 min after the escalation
    # max 6 messages per incident shape: down + escalate + renags(<=3 in 45m) + no up yet
    assert sum(1 for e in events if e) <= 6


def test_recovery_needs_two_healthy_polls_and_fires_up():
    seq = [lm.WORKER_DOWN, lm.WORKER_DOWN, lm.HEALTHY, lm.WORKER_DOWN,
           lm.WORKER_DOWN, lm.HEALTHY, lm.HEALTHY]
    events, s = _run(seq)
    assert events[1] == "down"
    assert events[2] is None            # single healthy poll: no flap recovery
    assert events[-1] == "up"
    assert not s["down"]


def test_blind_web_needs_five_polls_and_rate_limits():
    seq = [lm.BLIND_WEB] * 10
    events, _ = _run(seq)
    assert events[4] == "blind_web"     # fires exactly on the 5th
    assert events.count("blind_web") == 1  # 1/hour cap within 10 minutes
    assert "down" not in events         # never classified as worker down


def test_blind_db_fires_once_at_two_and_rate_limits():
    events, _ = _run([lm.BLIND_DB] * 8)
    assert events[1] == "blind_db"
    assert events.count("blind_db") == 1


# --- market calendar -----------------------------------------------------------

def test_holiday_is_not_a_trading_day():
    in_sess, trading, _ = lm.session_window(_dt(2026, 11, 26, 10, 30))  # Thanksgiving
    assert not trading and not in_sess


def test_early_close_ends_alerting_at_one_pm():
    in_sess, trading, end = lm.session_window(_dt(2026, 11, 27, 12, 55))
    assert trading and in_sess and end == 1300
    in_sess, _, _ = lm.session_window(_dt(2026, 11, 27, 13, 5))
    assert not in_sess, "13:05 on an early close must not alert"
    assert lm.session_minutes(_dt(2026, 11, 27, 12, 0)) == 210


def test_normal_session_bounds_and_weekend():
    assert lm.session_window(_dt(2026, 7, 7, 9, 34))[0] is False   # open grace
    assert lm.session_window(_dt(2026, 7, 7, 9, 36))[0] is True
    assert lm.session_window(_dt(2026, 7, 7, 16, 4))[0] is True    # close-minute
    assert lm.session_window(_dt(2026, 7, 7, 16, 6))[0] is False
    assert lm.session_window(_dt(2026, 7, 11, 12, 0))[0] is False  # Saturday
    assert lm.session_minutes(_dt(2026, 7, 7, 12, 0)) == 390


# --- scorecard grading ----------------------------------------------------------

def test_grade_green_requires_clean_day():
    assert lm.grade_day(390, 390, [], 0, 0) == "GREEN"
    assert lm.grade_day(388, 390, [], 0, 100) == "GREEN"
    # early close scales: 209/210 clean day is GREEN
    assert lm.grade_day(209, 210, [], 0, 0) == "GREEN"


def test_grade_yellow_single_small_window():
    assert lm.grade_day(385, 390, [{"duration_min": 3}], 0, 300) == "YELLOW"


def test_grade_red_on_restarts_or_big_gaps():
    # the 7/6 baseline day must grade RED
    windows = [{"duration_min": 9}] * 16
    assert lm.grade_day(272, 390, windows, 11, 8659) == "RED"
    # a market-hours restart with a clean-looking day still blocks GREEN
    assert lm.grade_day(390, 390, [], 1, 0) != "GREEN"


# --- scorecard scheduling --------------------------------------------------------

def test_scorecard_due_timing():
    assert lm._scorecard_due(_dt(2026, 7, 7, 16, 10), False) is False
    assert lm._scorecard_due(_dt(2026, 7, 7, 16, 16), False) is True
    assert lm._scorecard_due(_dt(2026, 7, 7, 16, 16), True) is False   # already posted
    assert lm._scorecard_due(_dt(2026, 7, 11, 17, 0), False) is False  # Saturday
    # early close posts from 13:15
    assert lm._scorecard_due(_dt(2026, 11, 27, 13, 16), False) is True
    assert lm._scorecard_due(_dt(2026, 11, 26, 17, 0), False) is False  # holiday


# --- Discord destination: the OUTAGE ORACLE must NOT fail closed ---------------
#
# ⛔⛔ THE ACCEPTANCE PROPERTY, and it is the inverse of a fail-closed poster's:
# with the OPS variable unset or blank and the admin webhook SET, this module
# must still post — to today's channel. It is the compatibility-floor half of
# `alert_destination`'s invariant, exercised on the one producer that would be
# a real regression if a future edit made it fail closed like its eight siblings.

class _Wire:
    """Records `(url, data, headers)` from urllib.request's two-call shape.
    Never opens a socket."""

    def __init__(self):
        self.posts: list[tuple[str, bytes, dict]] = []

    def Request(self, url, data=None, headers=None):          # noqa: N802
        self.posts.append((url, data, dict(headers or {})))
        return object()

    def urlopen(self, _req, timeout=None):                     # noqa: ARG002
        return _Response()


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self, _n=None):
        return b""


def test_post_discord_resolves_TODAYS_channel_with_the_ops_variable_unset(monkeypatch):
    """⛔⛔ THE ACCEPTANCE TEST. Neither `DISCORD_OPS_WEBHOOK_URL` nor the retired
    `LIVEFLOW_ALERT_WEBHOOK_URL` is set — production's actual shape, measured via
    `railway variables --service worker --kv` on 2026-09-27 — and the post must
    still land on the admin channel rather than going silent."""
    import urllib.request as urllib_request

    monkeypatch.delenv("LIVEFLOW_ALERT_WEBHOOK_URL", raising=False)
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)

    wire = _Wire()
    monkeypatch.setattr(urllib_request, "Request", wire.Request)
    monkeypatch.setattr(urllib_request, "urlopen", wire.urlopen)

    assert lm._post_discord("worker down") is True
    assert wire.posts[0][0] == TODAY


def test_post_discord_follows_the_ops_variable_once_it_is_SET(monkeypatch):
    """⛔ THE CONTROL — without this, the test above would also pass on a module
    that ignores the OPS variable entirely."""
    import urllib.request as urllib_request

    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, OPS_ONLY)

    wire = _Wire()
    monkeypatch.setattr(urllib_request, "Request", wire.Request)
    monkeypatch.setattr(urllib_request, "urlopen", wire.urlopen)

    assert lm._post_discord("worker down") is True
    assert wire.posts[0][0] == OPS_ONLY


def test_post_discord_returns_False_never_raises_with_NOTHING_configured(monkeypatch):
    """The one legitimate silent case: BOTH the ops and admin webhooks blank.
    Must return False, not raise — this fires from inside a monitor loop, and an
    exception here would be worse than a missed page."""
    import urllib.request as urllib_request

    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")

    wire = _Wire()
    monkeypatch.setattr(urllib_request, "Request", wire.Request)
    monkeypatch.setattr(urllib_request, "urlopen", wire.urlopen)

    assert lm._post_discord("worker down") is False
    assert wire.posts == []


def test_start_liveflow_monitor_still_refuses_with_no_destination_at_all(monkeypatch):
    """The pre-existing startup gate ("do not start with nowhere to report") is
    PRESERVED exactly — this asserts the boolean now comes from `ops_webhook()`
    rather than a retired module constant, not that the gate changed shape."""
    monkeypatch.setenv("LIVEFLOW_MONITOR_ENABLED", "1")
    monkeypatch.setattr(lm, "ENABLED", True)
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")
    monkeypatch.setattr(lm, "_thread", None)

    assert lm.start_liveflow_monitor() is False
