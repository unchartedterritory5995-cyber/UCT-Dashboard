"""The deploy freeze's DESCRIPTION of the NYSE session (2026-11-26), and the end of every HOLD (2026-11-27).

⛔⛔ OWNER RULING 2026-11-27: "fuck the deploy freeze i dont ever want to hold anything back from deploying ever".
`decide` answers NOT FROZEN at every instant (tests/test_no_deploy_freeze.py), on a regular day, a half-day, a holiday
or with a broken calendar. What stays is `day_hold_windows` / `burst_window`: the day's market rushes read from
`api/services/session_calendar.py`, which the merge queue's freeze (tools/agent_ci_required.py) and the app's heavy-job
rushes (api/services/market_rush.py) are railed to. A calendar that cannot be read, or a date past its horizon, is
DESCRIBED by the weekday rule; it holds no promotion either way.
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc


@pytest.fixture()
def df():
    path = ROOT / "tools" / "deploy_freeze.py"
    spec = importlib.util.spec_from_file_location("_freeze_for_calendar_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _et(y, m, d, hh, mm):
    from zoneinfo import ZoneInfo
    return dt.datetime(y, m, d, hh, mm, tzinfo=ZoneInfo("America/New_York")).astimezone(UTC)


def _broken_calendar():
    raise RuntimeError("calendar dataset unreadable")


# -- a holiday: no session, no hold ------------------------------------------------------------------------------

def test_thanksgiving_1300_et_is_not_frozen(df):
    now = _et(2026, 11, 26, 13, 0)
    assert df.burst_window(now) is None
    code, why = df.decide(now)
    assert code == df.EXIT_OPEN, why
    assert df.freeze_ends_at(now) is None
    assert df.wait_plan(now)[0] == 0


def test_thanksgiving_whole_day_is_open(df):
    for minute in range(9 * 60, 17 * 60, 5):
        now = _et(2026, 11, 26, minute // 60, minute % 60)
        assert df.decide(now)[0] == df.EXIT_OPEN, now


# -- a half-day: the hold ends at close + 15 ---------------------------------------------------------------------

def test_half_day_1250_et_is_described_as_the_closing_rush_and_is_not_frozen(df):
    now = _et(2026, 11, 27, 12, 50)
    assert df.burst_window(now) == "closing"
    code, why = df.decide(now)
    assert code == df.EXIT_OPEN, why           # owner ruling 2026-11-27: no hold, ever


def test_half_day_1320_et_is_not_frozen(df):
    now = _et(2026, 11, 27, 13, 20)
    assert df.burst_window(now) is None
    assert df.decide(now)[0] == df.EXIT_OPEN


def test_half_day_1315_exactly_ends_the_described_rush_half_open(df):
    assert df.burst_window(_et(2026, 11, 27, 13, 15)) is None
    assert df.burst_window(_et(2026, 11, 27, 13, 14)) == "closing"


def test_half_day_has_no_freeze_end_and_no_wait(df):
    now = _et(2026, 11, 27, 12, 50)
    assert df.freeze_ends_at(now) is None
    assert df.wait_plan(now)[0] == 0


def test_half_day_morning_is_described_to_1315(df):
    assert df.burst_window(_et(2026, 11, 27, 9, 30)) == "opening"
    assert df.burst_window(_et(2026, 11, 27, 11, 0)) == "session"
    assert df.day_hold_windows(dt.date(2026, 11, 27))[-1][2] == (13, 15)
    assert df.burst_window(_et(2026, 11, 27, 9, 19)) is None


def test_christmas_eve_half_day_ends_at_1315(df):
    assert df.burst_window(_et(2026, 12, 24, 13, 0)) == "closing"
    assert df.burst_window(_et(2026, 12, 24, 13, 15)) is None
    assert df.decide(_et(2026, 12, 24, 13, 0))[0] == df.EXIT_OPEN


# -- a regular day: unchanged ------------------------------------------------------------------------------------

def test_regular_thursday_is_described_but_never_held(df):
    assert df.burst_window(_et(2026, 12, 3, 13, 0)) == "session"
    assert df.decide(_et(2026, 12, 3, 13, 0))[0] == df.EXIT_OPEN
    assert df.decide(_et(2026, 12, 3, 16, 20))[0] == df.EXIT_OPEN
    assert df.freeze_ends_at(_et(2026, 12, 3, 13, 0)) is None
    assert df.day_hold_windows(dt.date(2026, 12, 3)) == df.HOLD_WINDOWS_ET


def test_the_rush_constant_is_untouched(df):
    assert df.BURST_WINDOWS_ET == (("opening", (9, 20), (9, 45)), ("closing", (15, 30), (16, 15)))


# -- the calendar cannot answer: DESCRIBED by the WEEKDAY rule, with a warning; still no hold ------------------------

def test_a_calendar_load_failure_on_a_holiday_is_described_by_the_weekday_rule(df, monkeypatch, capsys):
    monkeypatch.setattr(df, "_calendar_module", _broken_calendar)
    now = _et(2026, 11, 26, 13, 0)
    assert df.burst_window(now) == "session"
    assert df.decide(now)[0] == df.EXIT_OPEN
    assert df.freeze_ends_at(now) is None
    out = capsys.readouterr().out
    assert "warning" in out.lower() and "calendar" in out.lower(), out


def test_a_calendar_load_failure_on_a_half_day_holds_nothing(df, monkeypatch):
    monkeypatch.setattr(df, "_calendar_module", _broken_calendar)
    assert df.burst_window(_et(2026, 11, 27, 13, 20)) == "session"
    assert df.decide(_et(2026, 11, 27, 13, 20))[0] == df.EXIT_OPEN


def test_a_date_past_the_horizon_uses_the_weekday_rule(df, capsys):
    # Thanksgiving 2029 (Thu 2029-11-22) is past the dataset's horizon: the calendar cannot vouch for it
    import importlib.util as iu
    spec = iu.spec_from_file_location("_cal_probe", ROOT / "api" / "services" / "session_calendar.py")
    cal = iu.module_from_spec(spec)
    import sys
    sys.modules["_cal_probe"] = cal
    try:
        spec.loader.exec_module(cal)
    finally:
        sys.modules.pop("_cal_probe", None)
    day = dt.date(2029, 11, 22)
    assert not cal.covers(day), "the fixture date must be past the horizon; pick a later one"
    now = _et(2029, 11, 22, 13, 0)
    assert df.burst_window(now) == "session"
    assert df.decide(now)[0] == df.EXIT_OPEN
    out = capsys.readouterr().out
    assert "horizon" in out.lower(), out


def test_weekends_stay_open_even_with_a_broken_calendar(df, monkeypatch):
    monkeypatch.setattr(df, "_calendar_module", _broken_calendar)
    assert df.decide(_et(2026, 11, 28, 13, 0))[0] == df.EXIT_OPEN


def test_the_self_check_passes(df, capsys):
    assert df.self_check() == 0, capsys.readouterr().out


# -- the half-day catch-up crons are gone with the hold (owner ruling 2026-11-27) --------------------------------------

def test_the_half_day_and_wednesday_catch_up_crons_are_gone():
    wf = (ROOT / ".github" / "workflows" / "promote-production.yml").read_text(encoding="utf-8")
    for cron in ("20 17 * * 1-5", "20 18 * * 1-5", "5 15 * * 3", "5 16 * * 3"):
        assert f"cron: '{cron}'" not in wf, cron


# -- the IN-JOB self-check must not depend on the dataset's facts (review #2836, point 6) ------------------------
# `--self-check` runs in the production promote job with no continue-on-error: a failing case stops every promotion.
# So it must pass with a broken dataset (described by the weekday rule; nothing is held), with a dataset
# extended past 2029 (Thanksgiving 2029 becomes a holiday), and with a bad edit to a 2026 fact.

import json
import shutil
import subprocess
import sys


def _tree(tmp_path, dataset_text):
    for rel in ("tools/deploy_freeze.py", "api/services/measurement_window.py", "api/services/session_calendar.py"):
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / rel, tmp_path / rel)
    ds = tmp_path / "app" / "src" / "lib" / "marketClock" / "market_calendar.json"
    ds.parent.mkdir(parents=True, exist_ok=True)
    ds.write_text(dataset_text, encoding="utf-8")
    return tmp_path


def _dataset():
    return json.loads((ROOT / "app/src/lib/marketClock/market_calendar.json").read_text(encoding="utf-8"))


def _run(tree, *args):
    return subprocess.run([sys.executable, "-B", str(tree / "tools" / "deploy_freeze.py"), *args],
                          capture_output=True, text=True, timeout=120)


def test_self_check_passes_with_a_broken_dataset(tmp_path):
    out = _run(_tree(tmp_path, "{ this is not json"), "--self-check")
    assert out.returncode == 0 and "self-check: PASS" in out.stdout, out.stdout + out.stderr


def test_self_check_passes_with_the_horizon_extended_past_thanksgiving_2029(tmp_path):
    raw = _dataset()
    raw["horizon"] = "2030-12-31"
    raw["holidays"].append({"date": "2029-11-22", "name": "Thanksgiving Day"})
    raw["early_closes"].append({"date": "2029-11-23", "name": "Day after Thanksgiving", "close": "13:00"})
    tree = _tree(tmp_path, json.dumps(raw))
    # the fake dataset really is valid and really makes 2029-11-22 a holiday (else this rail proves nothing)
    held = _run(tree, "--now", "2029-11-22T18:00:00Z")
    assert held.returncode == 0, held.stdout + held.stderr
    out = _run(tree, "--self-check")
    assert out.returncode == 0 and "self-check: PASS" in out.stdout, out.stdout + out.stderr


def test_self_check_passes_with_a_bad_edit_to_a_2026_fact(tmp_path):
    raw = _dataset()
    raw["holidays"] = [h for h in raw["holidays"] if h["date"] != "2026-11-26"]
    raw["early_closes"] = [e for e in raw["early_closes"] if e["date"] != "2026-11-27"]
    out = _run(_tree(tmp_path, json.dumps(raw)), "--self-check")
    assert out.returncode == 0 and "self-check: PASS" in out.stdout, out.stdout + out.stderr


# -- the --half-day CLI still answers from the calendar (the crons that used it are gone, 2026-11-27) ----------------

def _half_day(tree_or_root, now):
    out = _run(tree_or_root, "--half-day", "--now", now)
    assert out.returncode == 0, out.stdout + out.stderr
    return [ln for ln in out.stdout.splitlines() if ln.startswith("half_day=")][-1].split("=", 1)[1]


def test_half_day_cli_answers_from_the_calendar():
    assert _half_day(ROOT, "2026-11-27T18:20:00Z") == "yes"
    assert _half_day(ROOT, "2026-12-03T18:20:00Z") == "no"     # a regular Thursday
    assert _half_day(ROOT, "2026-11-26T18:20:00Z") == "no"     # a full holiday is not a half-day
    assert _half_day(ROOT, "2029-11-23T18:20:00Z") == "unknown"  # past the horizon: the calendar cannot say


def test_half_day_cli_is_unknown_when_the_calendar_is_broken(tmp_path):
    assert _half_day(_tree(tmp_path, "{ broken"), "2026-12-03T18:20:00Z") == "unknown"



# -- the merge queue has no freeze to agree with any more (owner ruling 2026-11-27) -----------------------------------
# Until then tools/agent_ci_required.py derived the same rushes itself and a rail here required the two to agree every
# covered day. The merge queue's freeze is removed, so the rail now pins that nothing there consults a clock window.

def test_the_merge_queue_consults_no_market_windows():
    spec = importlib.util.spec_from_file_location("_acr_no_freeze_mirror", ROOT / "tools" / "agent_ci_required.py")
    acr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(acr)
    for gone in ("freeze_window", "freeze_windows_on", "freeze_day", "FREEZE_RUSHES", "FREEZE_FLOOR"):
        assert not hasattr(acr, gone), gone
