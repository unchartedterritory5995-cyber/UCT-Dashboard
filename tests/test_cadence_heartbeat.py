"""TERM-015 / FB-OBS-04 — the cadence heartbeat (S6) and the daily dead-man roll-up.

The ticket's three acceptance criteria (`backlog.md`, "#### TERM-015"), each a
section below and each carrying a control:

  (a) A deliberately stopped job appears BY NAME in the next roll-up.
  (b) The roll-up posts on a fully healthy day.
  (c) Exactly one message per day, asserted BY COUNT.

Plus the recursive test the ticket names in its Testing field: *"S6 exists so that
'when did this signal last report?' has an answer that does not depend on the
signal being healthy."* — and the AST-over-the-scheduler rail item 25 §4.6 method 3
requires of every signal, because *"the wire is the part that has actually been
cut in this repo"*.

⛔ NO TEST HERE READS THE WALL CLOCK. Every `now` is injected — a test that reads
the wall clock is a function of the hour it runs in.
"""
from __future__ import annotations

import ast
import datetime as dt
import importlib.util
import json
import os
import pathlib
from zoneinfo import ZoneInfo

import pytest

from api.services import cadence_heartbeat as ch

_REPO = pathlib.Path(__file__).resolve().parents[1]
_ET = ZoneInfo("America/New_York")
_MON = _REPO / "api" / "terminal_next_monitor_main.py"
_ROUTER = _REPO / "api" / "routers" / "terminal_next_reports.py"
_TOOL = _REPO / "tools" / "cadence_rollup_report.py"


def _et(y, mo, d, h=12, mi=0) -> float:
    return dt.datetime(y, mo, d, h, mi, tzinfo=_ET).timestamp()


def _load(path: pathlib.Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(path))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


#: A fixture roster, so the roll-up's logic is proved independently of which real
#: signals happen to be registered today.
ALPHA = ch.CadenceContract(signal="alpha-sweep", period="every 5 min", max_silence_s=3600)
BRAVO = ch.CadenceContract(signal="bravo-sweep", period="every 5 min", max_silence_s=3600)
ROSTER = (ALPHA, BRAVO)


# ═══════════════════════════════════════════════════════════════ the marker

def test_mark_writes_one_marker_per_signal_per_period_with_as_of(tmp_path):
    t0 = _et(2026, 9, 28, 9, 0)
    assert ch.mark("alpha-sweep", now=t0, base_dir=str(tmp_path), contracts=ROSTER) is True
    assert ch.mark("alpha-sweep", now=t0 + 300, base_dir=str(tmp_path), contracts=ROSTER) is True

    path = tmp_path / "alpha-sweep" / "2026-09-28.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["signal"] == "alpha-sweep"
    assert data["period"] == "2026-09-28"
    assert data["runs"] == 2
    assert data["first_as_of"] == t0
    assert data["as_of"] == t0 + 300, "as_of is the LAST report, not the first"
    assert "commit" in data

    # the next ET day is a NEW period file, and the count restarts
    ch.mark("alpha-sweep", now=_et(2026, 9, 29, 0, 1), base_dir=str(tmp_path), contracts=ROSTER)
    assert json.loads((tmp_path / "alpha-sweep" / "2026-09-29.json")
                      .read_text(encoding="utf-8"))["runs"] == 1
    assert not list(tmp_path.rglob("*.tmp")), "the atomic write left a temp file behind"


def test_the_period_is_the_ET_date_not_the_UTC_date(tmp_path):
    """21:30 ET on 9/28 is 01:30 UTC on 9/29. The period is the trading day's."""
    ch.mark("alpha-sweep", now=_et(2026, 9, 28, 21, 30), base_dir=str(tmp_path), contracts=ROSTER)
    assert (tmp_path / "alpha-sweep" / "2026-09-28.json").exists()


def test_mark_NEVER_raises_and_says_False_when_it_cannot_write(tmp_path):
    """⛔ A heartbeat that raised would take down the signal it reports on."""
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x", encoding="utf-8")
    assert ch.mark("alpha-sweep", now=_et(2026, 9, 28), base_dir=str(blocker),
                   contracts=ROSTER) is False


def test_an_UNREGISTERED_signal_is_refused_and_writes_nothing(tmp_path):
    """A marker nobody's contract names is a heartbeat the roll-up can never read —
    it would look like coverage and be none."""
    assert ch.mark("nobody-registered-me", now=_et(2026, 9, 28), base_dir=str(tmp_path),
                   contracts=ROSTER) is False
    assert list(tmp_path.iterdir()) == []


def test_retention_is_BOUNDED_at_the_period_rollover(tmp_path):
    """OBS-5: 90 days per signal. The volume has a measured 33 GB runaway in its
    history, so an unbounded marker directory is the exact class that incident was."""
    d = tmp_path / "alpha-sweep"
    d.mkdir()
    (d / "2026-01-01.json").write_text("{}", encoding="utf-8")     # > 90 days old
    (d / "2026-09-01.json").write_text("{}", encoding="utf-8")     # inside
    (d / "notes.txt").write_text("keep", encoding="utf-8")         # not ours
    ch.mark("alpha-sweep", now=_et(2026, 9, 28), base_dir=str(tmp_path), contracts=ROSTER)
    names = sorted(p.name for p in d.iterdir())
    assert names == ["2026-09-01.json", "2026-09-28.json", "notes.txt"], names


def test_the_marker_directory_is_read_at_CALL_time(tmp_path, monkeypatch):
    monkeypatch.setenv(ch.MARKER_DIR_ENV, str(tmp_path / "one"))
    assert ch.marker_dir() == str(tmp_path / "one")
    monkeypatch.setenv(ch.MARKER_DIR_ENV, str(tmp_path / "two"))
    assert ch.marker_dir() == str(tmp_path / "two")


# ═══════════════════════════════════════════════ the pure decision, with a control

def test_classify_REPORTED_inside_the_window_and_MISSING_one_second_past_it():
    now = _et(2026, 9, 28, 16, 20)
    ok = {"signal": "alpha-sweep", "period": "2026-09-28", "as_of": now - 3600, "runs": 9}
    late = dict(ok, as_of=now - 3601)
    assert ch.classify(ALPHA, ok, None, now)["status"] == ch.REPORTED
    # CONTROL — the same row one second older must flip. Without it, a classifier
    # that answered REPORTED for everything would pass the line above.
    assert ch.classify(ALPHA, late, None, now)["status"] == ch.MISSING


def test_classify_never_reported_is_MISSING_not_zero():
    row = ch.classify(ALPHA, None, None, _et(2026, 9, 28, 16, 20))
    assert row["status"] == ch.MISSING
    assert "never" in row["reason"]


def test_an_unreadable_marker_is_UNREADABLE_never_MISSING_and_never_REPORTED():
    """⛔ A layer that could not be READ is not a layer that is EMPTY."""
    row = ch.classify(ALPHA, None, "JSONDecodeError: bad", _et(2026, 9, 28, 16, 20))
    assert row["status"] == ch.UNREADABLE
    assert "JSONDecodeError" in row["reason"]


def test_runs_today_counts_only_TODAYS_period():
    now = _et(2026, 9, 28, 16, 20)
    yesterday = {"signal": "alpha-sweep", "period": "2026-09-27", "as_of": now - 600, "runs": 288}
    assert ch.classify(ALPHA, yesterday, None, now)["runs_today"] == 0


# ═════════════════════════ (a) A DELIBERATELY STOPPED JOB APPEARS BY NAME IN THE ROLL-UP

def test_A_a_deliberately_stopped_job_appears_BY_NAME_in_the_next_rollup(tmp_path):
    base = str(tmp_path)
    t0 = _et(2026, 9, 28, 9, 0)
    for k in range(0, 12):                       # both run for an hour
        for c in ROSTER:
            ch.mark(c.signal, now=t0 + k * 300, base_dir=base, contracts=ROSTER)
    # ⛔ bravo is STOPPED at 10:00. alpha keeps reporting until the roll-up.
    t = t0 + 3600
    while t < _et(2026, 9, 28, 16, 20):
        ch.mark("alpha-sweep", now=t, base_dir=base, contracts=ROSTER)
        t += 300

    report = ch.build_rollup(_et(2026, 9, 28, 16, 20), base_dir=base, contracts=ROSTER)
    text = ch.format_rollup(report)

    assert report["missing"] == ["bravo-sweep"]
    assert "bravo-sweep" in text
    missing_lines = [ln for ln in text.splitlines() if ln.startswith(ch.MISSING)]
    assert len(missing_lines) == 1 and "bravo-sweep" in missing_lines[0], text
    # ...and it says WHEN it last reported, which is the question the owner asks.
    assert "2026-09-28 09:55 ET" in missing_lines[0], missing_lines[0]
    # CONTROL — the running job is NOT named as missing. Without this a roll-up that
    # listed every signal as missing would pass the assertions above.
    assert "alpha-sweep" not in missing_lines[0]
    assert any(ln.startswith(ch.REPORTED) and "alpha-sweep" in ln for ln in text.splitlines())


def test_A_the_tool_exits_NONZERO_when_a_signal_did_not_report(tmp_path, capsys):
    tool = _load(_TOOL, "cadence_tool_a")
    base = str(tmp_path)
    now = _et(2026, 9, 28, 16, 20)
    ch.mark("alpha-sweep", now=now - 60, base_dir=base, contracts=ROSTER)
    assert tool.run(now=now, base_dir=base, contracts=ROSTER) == 1
    assert "bravo-sweep" in capsys.readouterr().out


# ═══════════════════════════════════════ (b) THE ROLL-UP POSTS ON A FULLY HEALTHY DAY

def test_B_a_fully_healthy_day_still_produces_the_rollup(tmp_path, capsys):
    tool = _load(_TOOL, "cadence_tool_b")
    base = str(tmp_path)
    now = _et(2026, 9, 28, 16, 20)
    for c in ROSTER:
        ch.mark(c.signal, now=now - 120, base_dir=base, contracts=ROSTER)
    assert tool.run(now=now, base_dir=base, contracts=ROSTER) == 0
    out = capsys.readouterr().out
    assert "every registered signal reported" in out
    assert "alpha-sweep" in out and "bravo-sweep" in out, "a healthy roll-up names what it vouches for"


def test_B_the_monitor_POSTS_the_healthy_rollup_and_does_not_alert(monkeypatch):
    mon = _load(_MON, "tnmon_b")
    monkeypatch.setenv(mon.ROLLUP_FLAG, "1")
    monkeypatch.setattr(mon, "_fetch", lambda p, timeout=260: {
        "exit": 0, "stdout": "CADENCE ROLL-UP ... every registered signal reported", "stderr": ""})
    posted = []
    monkeypatch.setattr(mon, "post", lambda t, b, alert=False, url=None: posted.append((t, alert)) or True)
    assert mon.run_job("cadence") == 0
    assert len(posted) == 1, "a healthy day must still post — silence is the alarm"
    assert posted[0][1] is False, "the healthy roll-up is the cadence proof, not an alert"


def test_an_EMPTY_roster_is_a_failure_not_a_healthy_day(tmp_path, capsys):
    """⛔ A roll-up with nothing registered vouches for nothing, and would read as
    'everything reported' every day forever."""
    tool = _load(_TOOL, "cadence_tool_empty")
    assert tool.run(now=_et(2026, 9, 28, 16, 20), base_dir=str(tmp_path), contracts=()) == 1
    assert "NO SIGNALS REGISTERED" in capsys.readouterr().out


def test_web_unreachable_is_UNREADABLE_alerts_and_is_STILL_one_post(monkeypatch):
    mon = _load(_MON, "tnmon_unreach")
    monkeypatch.setenv(mon.ROLLUP_FLAG, "1")
    monkeypatch.setattr(mon, "_fetch", lambda p, timeout=260: {
        "exit": 126, "stdout": "", "stderr": "UNREADABLE: cannot reach http://web"})
    posted = []
    monkeypatch.setattr(mon, "post", lambda t, b, alert=False, url=None: posted.append((t, b, alert)) or True)
    mon.run_job("cadence")
    assert len(posted) == 1
    title, body, alert = posted[0]
    assert alert is True and "UNREADABLE" in title and "UNREADABLE" in body


# ═══════════════════════════════════════════ (c) EXACTLY ONE MESSAGE PER DAY, BY COUNT

def _cron_firings_on_et_day(mon, y, mo, d):
    """Every instant the declared Railway cron fires whose ET date is (y, mo, d)."""
    mins = [int(x) for x in mon.RAILWAY_CRON_UTC.split()[0].split(",")]
    hours = [int(x) for x in mon.RAILWAY_CRON_UTC.split()[1].split(",")]
    day = dt.date(y, mo, d)
    out = []
    for utc_day in (day - dt.timedelta(days=1), day, day + dt.timedelta(days=1)):
        for h in hours:
            for m in mins:
                u = dt.datetime(utc_day.year, utc_day.month, utc_day.day, h, m,
                                tzinfo=dt.timezone.utc)
                local = u.astimezone(_ET)
                if local.date() == day:
                    out.append(local)
    return sorted(out)


def _count_rollup_posts_over_a_day(mon, monkeypatch, y, mo, d):
    monkeypatch.setenv(mon.FLAG, "1")
    monkeypatch.setenv(mon.ROLLUP_FLAG, "1")
    monkeypatch.setattr(mon, "_fetch", lambda p, timeout=260: {
        "exit": 0, "stdout": "ok", "stderr": "", "market_date": "x",
        "market_closed": True, "closed_reason": "fixture"})
    titles = []
    monkeypatch.setattr(mon, "post", lambda t, b, alert=False, url=None: titles.append(t) or True)
    firings = _cron_firings_on_et_day(mon, y, mo, d)
    assert len(firings) >= 12, "NON-VACUITY: the day's cron firings were not enumerated"
    for when in firings:
        mon.main([], now=when)
    return sum(1 for t in titles if t.startswith(mon.ROLLUP_TITLE))


@pytest.mark.parametrize("ymd", [
    (2026, 9, 28),     # EDT
    (2026, 12, 14),    # EST
    (2026, 11, 1),     # the day DST ENDS
    (2026, 3, 8),      # the day DST STARTS
    (2026, 10, 3),     # a Saturday — the roll-up is daily, weekends included
])
def test_C_EXACTLY_ONE_rollup_message_per_day_BY_COUNT(monkeypatch, ymd):
    mon = _load(_MON, "tnmon_c")
    assert _count_rollup_posts_over_a_day(mon, monkeypatch, *ymd) == 1


def test_C_CONTROL_the_counter_can_see_TWO_and_can_see_ZERO(monkeypatch):
    """⛔ Without this, a counter pinned at 1 by construction passes the test above.
    Two rows ⇒ 2; no row ⇒ 0. Only then does '== 1' mean something."""
    mon = _load(_MON, "tnmon_c2")
    doubled = tuple(mon.SCHEDULE) + (("cadence", lambda d: True, 16, 30),)
    monkeypatch.setattr(mon, "SCHEDULE", doubled)
    assert _count_rollup_posts_over_a_day(mon, monkeypatch, 2026, 9, 28) == 2

    mon0 = _load(_MON, "tnmon_c0")
    monkeypatch.setattr(mon0, "SCHEDULE", tuple(r for r in mon0.SCHEDULE if r[0] != "cadence"))
    assert _count_rollup_posts_over_a_day(mon0, monkeypatch, 2026, 9, 28) == 0


def test_C_many_missing_signals_are_ONE_message_not_one_per_signal(tmp_path, monkeypatch):
    """⛔ Item 25: 'a signal which fires on the normal case is not a noisy signal —
    it is a signal that will shortly be no signal'. The roll-up is ONE message."""
    roster = tuple(ch.CadenceContract(signal=f"s{i}-sweep", period="p", max_silence_s=60)
                   for i in range(7))
    text = ch.format_rollup(ch.build_rollup(_et(2026, 9, 28, 16, 20), base_dir=str(tmp_path),
                                            contracts=roster))
    mon = _load(_MON, "tnmon_c3")
    monkeypatch.setenv(mon.ROLLUP_FLAG, "1")
    monkeypatch.setattr(mon, "_fetch", lambda p, timeout=260: {"exit": 1, "stdout": text, "stderr": ""})
    posted = []
    monkeypatch.setattr(mon, "post", lambda t, b, alert=False, url=None: posted.append(b) or True)
    mon.run_job("cadence")
    assert len(posted) == 1
    for i in range(7):
        assert f"s{i}-sweep" in posted[0]


# ══════════════════════════════════ THE RECURSIVE TEST — the ticket's Testing field

def test_RECURSIVE_an_UNHEALTHY_signal_still_answers_when_it_last_reported(tmp_path, monkeypatch):
    """⛔⛔ 'S6 exists so that "when did this signal last report?" has an answer that
    does not depend on the signal being healthy.'

    The real registered signal, driven down its WORST path: the bars store is
    unhealthy, so `_run_5min_check` pages and STOPS early. A heartbeat written only
    on the healthy path would be silent exactly when the signal matters most — and
    a silent heartbeat from a signal that is running and paging is the one reading
    the roll-up must never produce. So the marker says RAN, not HEALTHY."""
    from api.services import bars_continuous_audit as bca
    from api.services import bars_sqlite as bs
    from api.services import chart_health_alerts as cha

    monkeypatch.setenv(ch.MARKER_DIR_ENV, str(tmp_path))
    monkeypatch.setattr(bs, "store_health",
                        lambda: {"ok": False, "kind": bs.STORE_EMPTY, "detail": "fixture"})
    fired = []
    monkeypatch.setattr(cha, "emit", lambda *a, **k: fired.append(a) or True)

    bca._run_5min_check()

    assert fired, "fixture did not drive the unhealthy path — the test proves nothing"
    signal = "bars-freshness-watchdog"
    marker, err = ch.read_latest(signal, base_dir=str(tmp_path))
    assert err is None and marker is not None, (
        "the signal ran, paged, and left NO heartbeat — its silence would read as "
        "'the cron stopped' while it was in fact firing")
    assert marker["signal"] == signal and marker["runs"] == 1


def test_RECURSIVE_a_MISSING_signal_still_carries_its_last_as_of(tmp_path):
    base = str(tmp_path)
    ch.mark("bravo-sweep", now=_et(2026, 9, 22, 9, 5), base_dir=base, contracts=ROSTER)
    rows = {r["signal"]: r for r in ch.build_rollup(_et(2026, 9, 28, 16, 20), base_dir=base,
                                                    contracts=ROSTER)["rows"]}
    assert rows["bravo-sweep"]["status"] == ch.MISSING
    assert rows["bravo-sweep"]["as_of_et"] == "2026-09-22 09:05 ET"
    assert rows["alpha-sweep"]["as_of_et"] is None     # CONTROL — never is never


# ═══════════════════════ THE WIRE — every contract has an emit site, and it is scheduled

def _mark_calls(source: str) -> list:
    """`cadence_heartbeat.mark(<first arg>)` calls, by AST. Non-literal first args are
    returned as None so the rail can refuse them — an unrailable name is a
    heartbeat the roll-up cannot be proved to read."""
    out = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and node.func.attr == "mark" and isinstance(node.func.value, ast.Name) \
                and node.func.value.id == "cadence_heartbeat" and node.args:
            a = node.args[0]
            out.append(a.value if isinstance(a, ast.Constant) and isinstance(a.value, str) else None)
    return out


def test_the_emit_site_detector_sees_a_CALL_and_ignores_a_MENTION():
    """NON-VACUITY, positive case first."""
    needle = "cadence_heartbeat" + ".mark"
    real = f'from api.services import cadence_heartbeat\n{needle}("x-sweep")\n{needle}(NAME)\n'
    assert _mark_calls(real) == ["x-sweep", None]
    prose = (f'"""{needle}("x-sweep") in a docstring."""\n'
             f'# {needle}("x-sweep")\n'
             'mark("x-sweep")\n')
    assert _mark_calls(prose) == []


def test_every_contract_has_an_emit_site_and_every_emit_site_has_a_contract():
    """⛔ BOTH DIRECTIONS. A contract nobody marks is MISSING every day forever (the
    roll-up is muted within a week); a mark nobody contracts is refused at runtime
    and reads as coverage in review."""
    found = {}
    for path in sorted((_REPO / "api").rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        for name in _mark_calls(path.read_text(encoding="utf-8")):
            found.setdefault(name, []).append(path.relative_to(_REPO).as_posix())
    assert None not in found, f"a non-literal signal name at {found.get(None)} cannot be railed"
    registered = {c.signal for c in ch.CONTRACTS}
    assert registered, "NON-VACUITY: no contract registered — the roll-up vouches for nothing"
    assert set(found) == registered, (
        f"marked but not contracted: {sorted(set(found) - registered)}; "
        f"contracted but never marked: {sorted(registered - set(found))}")


def _calls_named(tree: ast.AST, dotted: str) -> int:
    obj, attr = dotted.split(".") if "." in dotted else (None, dotted)
    n = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            if obj is None and isinstance(f, ast.Name) and f.id == attr:
                n += 1
            elif obj is not None and isinstance(f, ast.Attribute) and f.attr == attr \
                    and isinstance(f.value, ast.Name) and f.value.id == obj:
                n += 1
    return n


def test_the_bars_freshness_heartbeat_is_WIRED_to_a_running_loop():
    """Item 25 §4.6 method 3 — the wire, not only the logic. `_run_5min_check` must
    carry the mark, `_loop` must call it, and `api/main.py` must start the loop."""
    src = (_REPO / "api" / "services" / "bars_continuous_audit.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    fns = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    assert _mark_calls(ast.unparse(fns["_run_5min_check"])) == ["bars-freshness-watchdog"]
    assert _calls_named(fns["_loop"], "_run_5min_check") == 1
    main_tree = ast.parse((_REPO / "api" / "main.py").read_text(encoding="utf-8"))
    assert _calls_named(main_tree, "bars_continuous_audit.start") >= 1
    # CONTROL — the same probe sees zero for a name that is not called.
    assert _calls_named(main_tree, "bars_continuous_audit.no_such_fn") == 0


def test_the_rollup_is_wired_monitor_to_report_surface_to_tool():
    mon = _load(_MON, "tnmon_wire")
    assert "cadence" in mon.JOBS
    rows = [r for r in mon.SCHEDULE if r[0] == "cadence"]
    assert len(rows) == 1, "exactly one schedule row — two would be two messages a day"
    router = _load(_ROUTER, "tnrep_wire")
    assert router._REPORTS["cadence"] == ["tools/cadence_rollup_report.py"]
    assert _TOOL.exists()


# ═════════════════════════════════════════════ the flag, and the channel

def test_the_rollup_is_DARK_until_its_flag_is_set(monkeypatch):
    mon = _load(_MON, "tnmon_dark")
    monkeypatch.delenv(mon.ROLLUP_FLAG, raising=False)
    fetched, posted = [], []
    monkeypatch.setattr(mon, "_fetch", lambda p, timeout=260: fetched.append(p) or {"exit": 0})
    monkeypatch.setattr(mon, "post", lambda *a, **k: posted.append(a) or True)
    assert mon.run_job("cadence") == 0
    assert posted == [] and fetched == [], "a dark roll-up must neither read nor post"
    # CONTROL — the same call with the flag set does post.
    monkeypatch.setenv(mon.ROLLUP_FLAG, "1")
    mon.run_job("cadence")
    assert len(posted) == 1


def test_the_other_jobs_are_NOT_gated_by_the_rollup_flag(monkeypatch):
    mon = _load(_MON, "tnmon_other")
    monkeypatch.delenv(mon.ROLLUP_FLAG, raising=False)
    monkeypatch.setattr(mon, "_fetch", lambda p, timeout=260: {"exit": 0, "stdout": "x"})
    posted = []
    monkeypatch.setattr(mon, "post", lambda *a, **k: posted.append(a) or True)
    mon.run_job("gate-check")
    assert len(posted) == 1


def _capture_post_url(mon, monkeypatch):
    sent = {}
    monkeypatch.setattr(mon.urllib.request, "urlopen",
                        lambda req, timeout=30: type("R", (), {"read": lambda s: b"ok"})())
    monkeypatch.setattr(mon.urllib.request, "Request",
                        lambda url, data=None, headers=None: sent.update({"url": url}) or object())
    monkeypatch.setattr(mon, "_fetch", lambda p, timeout=260: {"exit": 0, "stdout": "ok"})
    mon.run_job("cadence")
    return sent.get("url")


def test_the_rollup_goes_to_the_OPS_channel_through_the_TERM011_resolver(monkeypatch):
    """Spec: 'Exactly one such message per day, ON THE OPS CHANNEL.' Resolved by
    `alert_destination.ops_webhook()`, never by a direct webhook read."""
    mon = _load(_MON, "tnmon_ops")
    monkeypatch.setenv(mon.ROLLUP_FLAG, "1")
    monkeypatch.delenv("ALERT_ROUTING_ENABLED", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/admin")
    monkeypatch.setenv("DISCORD_OPS_WEBHOOK_URL", "https://discord.example/ops")
    assert _capture_post_url(mon, monkeypatch) == "https://discord.example/ops"


def test_CONTROL_with_no_ops_channel_the_rollup_falls_back_to_admin_never_silence(monkeypatch):
    mon = _load(_MON, "tnmon_ops2")
    monkeypatch.setenv(mon.ROLLUP_FLAG, "1")
    monkeypatch.delenv("ALERT_ROUTING_ENABLED", raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/admin")
    monkeypatch.setenv("DISCORD_OPS_WEBHOOK_URL", "")
    assert _capture_post_url(mon, monkeypatch) == "https://discord.example/admin"


def test_the_flag_is_declared_in_the_ledger_as_dark():
    ledger = json.loads((_REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))
    mon = _load(_MON, "tnmon_ledger")
    entry = ledger["flags"][mon.ROLLUP_FLAG]
    assert entry["status"] == "dark" and entry["note"]
