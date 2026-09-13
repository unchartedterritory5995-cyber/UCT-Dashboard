"""LAYER 1 — the `terminal-next-monitor` service.

⛔⛔ **THE LOAD-BEARING RAIL IS THE CHANNEL.** `DISCORD_TSDR_WEBHOOK_URL` is the
**public ~750-member TSDR channel**. An operational alert posted there is an
incident, not a notification, and it cannot be unsent. So this file asserts the
public webhook name appears **nowhere in the monitor's code** — not that it is
merely unused today.
"""
import ast
import importlib.util
import json
import pathlib

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MON = _REPO / "api" / "terminal_next_monitor_main.py"
_ROUTER = _REPO / "api" / "routers" / "terminal_next_reports.py"


def _load():
    spec = importlib.util.spec_from_file_location("tnmon", str(_MON))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _code_only(path: pathlib.Path) -> str:
    """⛔ CODE, NEVER PROSE. `ast.unparse` drops comments but KEEPS docstrings,
    so string Expr nodes are blanked first — this file's own docstrings name the
    forbidden webhook in order to forbid it."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for n in ast.walk(tree):
        if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) \
                and isinstance(n.value.value, str):
            n.value.value = ""
    return ast.unparse(tree)


# ───────────────────────────── THE CHANNEL: admin only, never member/public

def test_the_monitor_posts_to_the_ADMIN_webhook():
    m = _load()
    assert m.ADMIN_WEBHOOK_ENV == "DISCORD_WEBHOOK_URL", (
        "the admin channel is DISCORD_WEBHOOK_URL — the one signups and "
        "curator_health use")


def test_the_public_TSDR_webhook_appears_NOWHERE_in_the_monitor_code():
    """⛔⛔ DISCORD_TSDR_WEBHOOK_URL is the PUBLIC ~750-member channel."""
    code = _code_only(_MON)
    assert "DISCORD_TSDR_WEBHOOK_URL" not in code, "the monitor can reach the PUBLIC channel"
    assert "TSDR" not in code
    # CONTROL — the stripped view can still see the webhook it IS allowed to use.
    assert "DISCORD_WEBHOOK_URL" in code, "the code-only view lost the real webhook"


def test_no_member_or_community_channel_is_named_either():
    code = _code_only(_MON)
    for forbidden in ("COMMUNITY_WEBHOOK", "MEMBER_WEBHOOK", "DISCORD_CHART_WEBHOOK"):
        assert forbidden not in code, forbidden


def test_a_missing_webhook_does_not_raise_and_says_so(monkeypatch, capsys):
    m = _load()
    monkeypatch.delenv(m.ADMIN_WEBHOOK_ENV, raising=False)
    assert m.post("t", "b") is False
    assert "NO ADMIN WEBHOOK SET" in capsys.readouterr().out


# ──────────────────────────────────── UNREADABLE is never a zero

def test_an_unreachable_web_is_UNREADABLE_and_alerts(monkeypatch):
    """⛔ web being down is exactly the condition a monitor living INSIDE web
    could never report."""
    m = _load()
    monkeypatch.setattr(m, "_fetch", lambda p, timeout=260: {
        "exit": 126, "stdout": "", "stderr": "UNREADABLE: cannot reach http://web…"})
    title, body, alert = m.job_ticking()
    assert alert is True
    assert "UNREADABLE" in body


def test_a_stalled_sweep_alerts(monkeypatch):
    m = _load()
    monkeypatch.setattr(m, "_fetch", lambda p, timeout=260: {
        "exit": 1, "stdout": "PRICE-LEVEL      NO  -- no heartbeat at all, and it IS inside the window.\n"
                             "  Check the flag.", "stderr": ""})
    title, body, alert = m.job_ticking()
    assert alert is True
    assert "NOT TICKING" in title


def test_control_a_healthy_ticking_does_NOT_alert(monkeypatch):
    """CONTROL — without it, a monitor that alerts on everything passes above."""
    m = _load()
    monkeypatch.setattr(m, "_fetch", lambda p, timeout=260: {
        "exit": 0, "stdout": "PRICE-LEVEL      YES -- last tick 8s ago, 44 ticks total\n"
                             "  projected=2", "stderr": ""})
    title, body, alert = m.job_ticking()
    assert alert is False, title


# ────────────────────────────── F-CAT-1: a closed market is not a fault

def test_a_closed_market_with_zero_rows_is_NOT_an_alert(monkeypatch):
    """⛔ Alerting every weekend is how a monitor gets muted."""
    m = _load()
    monkeypatch.setattr(m, "_fetch", lambda p, timeout=260: {
        "market_date": "2026-09-13", "market_closed": True, "closed_reason": "weekend",
        "runs": 0, "rows_persisted": 0, "spend_usd": 0.0, "recent": []})
    title, body, alert = m.job_catalyst_receipt()
    assert alert is False
    assert "market closed" in title and "NOT an alert" in body


def test_an_OPEN_market_with_zero_rows_IS_an_alert(monkeypatch):
    """The F-CAT-1 shape exactly: spent money, persisted nothing."""
    m = _load()
    monkeypatch.setattr(m, "_fetch", lambda p, timeout=260: {
        "market_date": "2026-09-14", "market_closed": False, "closed_reason": "",
        "runs": 12, "rows_persisted": 0, "spend_usd": 4.66, "recent": []})
    title, body, alert = m.job_catalyst_receipt()
    assert alert is True
    assert "NO ROWS PERSISTED" in title
    assert "AND IT SPENT $4.6600" in body or "SPENT $4.66" in body


def test_control_an_open_market_WITH_rows_does_not_alert(monkeypatch):
    m = _load()
    monkeypatch.setattr(m, "_fetch", lambda p, timeout=260: {
        "market_date": "2026-09-14", "market_closed": False, "closed_reason": "",
        "runs": 12, "rows_persisted": 380, "spend_usd": 3.10, "recent": []})
    assert m.job_catalyst_receipt()[2] is False


# ────────────────────────────────────── the report surface is read-only

def test_the_report_surface_runs_only_DECLARED_commands():
    """⛔ An endpoint that ran an arbitrary argv would be a remote shell with a
    bearer token in front of it."""
    spec = importlib.util.spec_from_file_location("tnrep", str(_ROUTER))
    r = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(r)
    assert set(r._REPORTS) == {"ticking", "report", "gate-check"}
    for argv in r._REPORTS.values():
        assert argv[0].startswith("tools/"), argv


def test_the_report_surface_is_bearer_gated_and_writes_nothing():
    code = _code_only(_ROUTER)
    assert "PUSH_SECRET" in code and "_check_auth" in code
    for w in ("upsert", "INSERT", "UPDATE ", "DELETE ", "--set", "redeploy"):
        assert w not in code, f"the read-only surface names a write: {w}"


# ──────────────────────────────────────────── the service is wired correctly

def test_the_railway_start_command_has_a_monitor_branch():
    sc = json.loads((_REPO / "railway.json").read_text(encoding="utf-8"))["deploy"]["startCommand"]
    assert "TERMINAL_NEXT_MONITOR_ENABLED" in sc
    assert "api.terminal_next_monitor_main" in sc
    # CONTROL — the other services' branches must survive.
    for other in ("api.bars_api_main", "api.flow_worker_main", "api.worker_main", "uvicorn"):
        assert other in sc, f"the monitor branch displaced {other}"


def test_the_monitor_is_off_unless_its_flag_is_set(monkeypatch):
    m = _load()
    monkeypatch.delenv(m.FLAG, raising=False)
    assert m.enabled() is False
    assert m.main(["--once", "ticking"]) == 0      # no-ops, posts nothing


def test_every_post_carries_the_commit_and_a_timestamp(monkeypatch):
    m = _load()
    sent = {}
    monkeypatch.setenv(m.ADMIN_WEBHOOK_ENV, "https://discord.example/hook")
    monkeypatch.setattr(m.urllib.request, "urlopen",
                        lambda req, timeout=30: type("R", (), {"read": lambda s: b"ok"})())
    monkeypatch.setattr(m.urllib.request, "Request",
                        lambda url, data=None, headers=None: sent.update(
                            {"body": json.loads(data.decode())}) or object())
    m.post("a title", "a body")
    content = sent["body"]["content"]
    assert "commit `" in content and " ET" in content, content


def test_the_job_registry_matches_the_four_schedules():
    assert set(_load().JOBS) == {"ticking", "catalyst", "gate-check", "weekly"}


# ───────────────────────── the ET schedule, and the DST hazard it exists for

def _et(y, mo, d, h, mi):
    import datetime as dt
    from zoneinfo import ZoneInfo
    return dt.datetime(y, mo, d, h, mi, tzinfo=ZoneInfo("America/New_York"))


@pytest.mark.parametrize("when,expect", [
    ((2026, 9, 14, 7, 20), ["catalyst"]),      # Monday
    ((2026, 9, 14, 9, 12), ["ticking"]),
    ((2026, 9, 14, 16, 30), ["gate-check"]),
    ((2026, 9, 19, 8, 0), ["weekly"]),         # Saturday
    ((2026, 9, 14, 9, 13), []),                # one minute off
    ((2026, 9, 19, 9, 12), []),                # Saturday: ticking is weekdays only
    ((2026, 9, 20, 16, 30), ["gate-check"]),   # Sunday: gate-check is daily
])
def test_due_jobs_fires_exactly_on_its_ET_minute(when, expect):
    assert _load().due_jobs(_et(*when)) == expect


def test_the_schedule_is_ET_and_survives_the_DST_change():
    """⛔⛔ THE HAZARD THIS TABLE EXISTS FOR. Railway cron is UTC; ET is UTC-4 in
    summer and UTC-5 in winter. A UTC crontab expressing '09:12 ET' silently
    becomes 10:12 ET the day DST ends — the sweeps would be checked an hour after
    they started and nothing would say so. Asserted on both sides of the change."""
    m = _load()
    assert m.due_jobs(_et(2026, 9, 14, 9, 12)) == ["ticking"]     # EDT (UTC-4)
    assert m.due_jobs(_et(2026, 12, 14, 9, 12)) == ["ticking"]    # EST (UTC-5)
    # CONTROL — the same UTC instant is NOT due in December, which is the whole
    # point: a UTC schedule would have fired at the wrong ET minute.
    import datetime as dt
    utc_1312 = dt.datetime(2026, 12, 14, 13, 12, tzinfo=dt.timezone.utc)
    assert m.due_jobs(utc_1312.astimezone(m._ET)) == [], "a UTC-pinned schedule would have drifted"


def test_the_declared_cron_covers_every_scheduled_row():
    """The Railway cron must be a SUPERSET of the ET table, in UTC, year-round."""
    import datetime as dt
    m = _load()
    mins, hours = m.RAILWAY_CRON_UTC.split()[0], m.RAILWAY_CRON_UTC.split()[1]
    cron_min = {int(x) for x in mins.split(",")}
    cron_hr = {int(x) for x in hours.split(",")}
    for name, _when, h, mi in m.SCHEDULE:
        for month in (9, 12):                       # EDT and EST
            local = _et(2026, month, 14, h, mi)
            u = local.astimezone(dt.timezone.utc)
            assert u.minute in cron_min, f"{name}: minute {u.minute} not in cron"
            assert u.hour in cron_hr, f"{name} in month {month}: hour {u.hour} not in cron"


def test_a_firing_with_nothing_due_exits_quietly(monkeypatch, capsys):
    """⛔ The cron fires a superset; a firing with nothing due is the normal case
    and must cost nothing and say nothing."""
    m = _load()
    monkeypatch.setenv(m.FLAG, "1")
    monkeypatch.setattr(m, "due_jobs", lambda now=None: [])
    posted = []
    monkeypatch.setattr(m, "post", lambda *a, **k: posted.append(a) or True)
    assert m.main([]) == 0
    assert posted == [], "a not-due firing posted to Discord"
    assert "nothing due" in capsys.readouterr().out
