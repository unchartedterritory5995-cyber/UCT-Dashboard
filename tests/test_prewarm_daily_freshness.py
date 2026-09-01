"""After-close full-universe DAILY freshness sweep (Permanent Daily Freshness, part 1).

The steady refresh loop keeps only the active `ticker_list` fresh; the ~22k reference
long-tail dailies are warmed BOOT-ONLY. So after each close the long tail drifts a
session behind and a first view cold-bg sheds a "warming" 503 (blank chart). The
after-close sweep re-warms the WHOLE universe's DAILY to the just-closed session, once
per session, off-peak — so the web always holds a fresh daily for every symbol.

These pin the pure decision gate `_after_close_daily_sweep_due`.
"""
import api.services.bars_prewarm as bp


_ON = dict(enabled=True, hour_et=17)


def test_due_after_close_on_a_completed_session_not_yet_swept():
    # 5pm ET (>= 17), today IS the completed session, never swept → DUE.
    assert bp._after_close_daily_sweep_due(
        20260901, 20260901, 18, 0, **_ON) is True


def test_not_due_before_the_buffer_hour():
    # 4pm ET (< 17): the provider may not have published today's closing daily bar.
    assert bp._after_close_daily_sweep_due(
        20260901, 20260901, 16, 0, **_ON) is False


def test_not_due_when_already_swept_this_session():
    assert bp._after_close_daily_sweep_due(
        20260901, 20260901, 18, 20260901, **_ON) is False


def test_due_again_on_the_next_session():
    # Swept yesterday, today is a new completed session past the buffer → DUE.
    assert bp._after_close_daily_sweep_due(
        20260902, 20260902, 18, 20260901, **_ON) is True


def test_not_due_on_a_weekend_or_holiday():
    # `_expected_session()` trails to the prior trading day, so sess != today.
    # (e.g. Saturday 9/5: sess = Friday 9/4). No new bar to fetch → no sweep.
    assert bp._after_close_daily_sweep_due(
        20260904, 20260905, 18, 0, **_ON) is False


def test_not_due_pre_open_when_session_trails_to_yesterday():
    # 8am ET before the open: _expected_session() is still yesterday, so sess != today.
    assert bp._after_close_daily_sweep_due(
        20260831, 20260901, 8, 0, **_ON) is False


def test_disabled_is_never_due():
    assert bp._after_close_daily_sweep_due(
        20260901, 20260901, 18, 0, enabled=False, hour_et=17) is False


def test_custom_buffer_hour_is_honored():
    # With hour_et=20, 6pm is too early but 9pm is due.
    assert bp._after_close_daily_sweep_due(
        20260901, 20260901, 18, 0, enabled=True, hour_et=20) is False
    assert bp._after_close_daily_sweep_due(
        20260901, 20260901, 21, 0, enabled=True, hour_et=20) is True
