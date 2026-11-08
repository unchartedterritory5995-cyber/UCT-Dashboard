"""Unit 2b-08 of the UCT Relative Strength programme (engineering map
docs/superpowers/plans/2026-11-06-uct-rs-phase2-engineering-map.md): the nightly RS
Discord post's scheduler registration, its real readers, the retry pass, the boot
line, and the admin door + status readback (`api/routers/rs_discord.py`).

The poster itself (`api.services.rs_discord_post`, unit 2b-07) is tested in
tests/test_rs_discord_post.py and is driven here only through its seams; the real
webhook is never called (every transport is a recorder or a stub).
"""
from __future__ import annotations

import ast
import datetime as _dt
import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.main as m
from api.routers import rs_discord as door
from api.services import rs_discord_post as rp
from api.services.rs_evidence_pull import outcome_phrase as ep_outcome
from api.services.alert_taxonomy import channels
from api.services.screener import rs_history
from tests.test_rs_discord_post import FIXTURE
from tests.test_rs_evidence_pull import fixture_artifact, write_artifact
from tests.test_screener_schedule import _cron_field, _register

JOB, RETRY = "rs_discord_post", "rs_discord_post_retry"
SESSION = "2026-11-05"
LIVE_HOOK = "https://discord.test/rs/live-secret-token"
TEST_HOOK = "https://discord.test/rs/test-secret-token"


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """A private DATA_DIR (marker + evidence artifact), the flag and both webhooks
    unset, the receipt state and the seams restored after each test."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    for key in (rp.FLAG, rp.WEBHOOK_ENV, door.TEST_WEBHOOK_ENV, "PUSH_SECRET"):
        monkeypatch.delenv(key, raising=False)
    seams_before = door.seams()
    door._LAST.clear()
    yield
    door._LAST.clear()
    door._SEAMS.update(seams_before)


def _settled(monkeypatch, value=_dt.date(2026, 11, 5)):
    monkeypatch.setattr(rs_history, "settled_session", lambda now=None: value)


def _stub_post(monkeypatch, receipt=None, raises=None):
    """Replace `post_rs_summary` with a recorder of its (session, kwargs)."""
    calls = []

    def fake(session, **kw):
        calls.append((session, kw))
        if raises:
            raise raises
        return dict(receipt or {"posted": False, "reason": "not enabled", "session": session,
                                "chars": 0, "leaders": 0, "attempts": 0, "marked": False,
                                "dry_run": False})
    monkeypatch.setattr(rp, "post_rs_summary", fake)
    return calls


def _never_send(monkeypatch):
    """The real transport must never be reached in this file."""
    def boom(url, body):
        raise AssertionError("the real transport was called")
    monkeypatch.setattr(rp, "_default_send", boom)


# ── registration ──────────────────────────────────────────────────────────────

def test_both_jobs_are_registered_after_the_evidence_pull_with_the_siblings_options(monkeypatch):
    sched = _register(monkeypatch)
    for jid in (JOB, RETRY):
        assert jid in sched.jobs, jid
    assert sched.ids.index("rs_history_nightly") < sched.ids.index("rs_evidence_pull") \
        < sched.ids.index(JOB) < sched.ids.index(RETRY)
    fn, kw = sched.jobs[JOB]
    assert fn is m._run_rs_discord_post
    assert _cron_field(kw["trigger"], "hour") == "4" and _cron_field(kw["trigger"], "minute") == "45"
    assert str(kw["trigger"].timezone) == "America/New_York"
    assert "kwargs" not in kw, "the first pass runs with the function's default (retry=False)"
    rfn, rkw = sched.jobs[RETRY]
    assert rfn is m._run_rs_discord_post, "ONE function, two registrations"
    assert rkw["kwargs"] == {"retry": True}
    assert _cron_field(rkw["trigger"], "hour") == "5" and _cron_field(rkw["trigger"], "minute") == "15"
    assert str(rkw["trigger"].timezone) == "America/New_York"
    for k in (kw, rkw):
        assert k["max_instances"] == 1 and k["replace_existing"] is True
        assert k["coalesce"] is True and k["misfire_grace_time"] == 3600
    assert tuple(m.RS_DISCORD_POST_JOBS) == (JOB, RETRY) == tuple(door.JOB_IDS)


def test_the_add_jobs_sit_under_NO_flag_test__BY_AST():
    """Registered unconditionally (depth 0 in `register_screener_jobs`): the module's
    `enabled()` is the switch. Control: the flag-gated nightly sweep is gated."""
    src = pathlib.Path(m.__file__).read_text(encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "register_screener_jobs")
    depth = {}

    def _walk(body, d):
        for stmt in body:
            if isinstance(stmt, ast.If):
                _walk(stmt.body, d + 1)
                _walk(stmt.orelse, d + 1)
                continue
            for node in ast.walk(stmt):
                if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "add_job":
                    for kw in node.keywords:
                        if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                            depth[kw.value.value] = d

    _walk(fn.body, 0)
    assert depth.get(JOB) == 0 and depth.get(RETRY) == 0
    assert depth.get("screener_scan_sweep", 0) >= 1


def test_the_registrar_survives_a_real_scheduler_and_the_retry_is_30_minutes_later(monkeypatch):
    """The triggers BUILD (the index-close lesson: a registrar that raised on a
    real scheduler registered nothing) and fire 04:45 then 05:15 the same day."""
    from apscheduler.schedulers.background import BackgroundScheduler
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setattr(m, "start_screener_snapshot_warm", lambda: None)
    sched = BackgroundScheduler(timezone=m._ET)
    assert m.register_screener_jobs(sched) is True
    first, retry = sched.get_job(JOB), sched.get_job(RETRY)
    assert first is not None and retry is not None
    assert retry.kwargs == {"retry": True} and first.kwargs == {}
    at = _dt.datetime(2026, 11, 6, 3, 0, tzinfo=m._ET)
    t1 = first.trigger.get_next_fire_time(None, at)
    t2 = retry.trigger.get_next_fire_time(None, at)
    assert (t1.date(), t1.hour, t1.minute) == (at.date(), 4, 45)
    assert (t2.date(), t2.hour, t2.minute) == (at.date(), 5, 15)
    assert (t2 - t1).total_seconds() == 30 * 60
    assert m._rs_discord_post_boot_line(sched).endswith(f" jobs={JOB},{RETRY}")


# ── the job ───────────────────────────────────────────────────────────────────

def test_the_first_pass_posts_through_the_real_readers_records_the_receipt_and_prints_one_line(
        monkeypatch, capsys):
    _settled(monkeypatch)
    calls = _stub_post(monkeypatch)
    assert m._run_rs_discord_post() is None
    assert len(calls) == 1
    session, kw = calls[0]
    assert session == SESSION
    assert kw == {"leaders_fn": m._rs_leaders_for, "evidence_fn": m._rs_evidence_for}, \
        "every gate is the module's: no webhook, dedup, force or dry_run override"
    rec = door.last_receipt("scheduled")
    assert rec["session"] == SESSION and rec["reason"] == "not enabled" and rec["source"] == "scheduled"
    out = capsys.readouterr().out
    assert out.count("[scheduler] rs discord post:") == 1
    assert f"session={SESSION} posted=False reason=not enabled" in out


def test_the_job_never_raises(monkeypatch, capsys):
    monkeypatch.setattr(rs_history, "settled_session",
                        lambda now=None: (_ for _ in ()).throw(RuntimeError("calendar down")))
    assert m._run_rs_discord_post() is None
    assert "[scheduler] rs discord post error: calendar down" in capsys.readouterr().out
    _settled(monkeypatch)
    _stub_post(monkeypatch, raises=RuntimeError("poster blew up"))
    assert m._run_rs_discord_post() is None
    assert m._run_rs_discord_post(retry=True) is None
    out = capsys.readouterr().out
    assert "[scheduler] rs discord post error: poster blew up" in out
    assert door.last_receipt("scheduled") is None


def test_no_settled_session_reaches_the_poster_as_an_empty_key(monkeypatch):
    _settled(monkeypatch, None)
    calls = _stub_post(monkeypatch)
    m._run_rs_discord_post()
    assert calls[0][0] == ""


@pytest.mark.parametrize("first,expect", [
    ({"posted": False, "reason": "rate-limited"}, True),
    ({"posted": False, "reason": "http 503 after one retry"}, True),
    ({"posted": False, "reason": "http 400"}, True),
    ({"posted": False, "reason": "send failed: Timeout"}, True),
    ({"posted": True, "reason": "posted"}, False),
    ({"posted": False, "reason": "not enabled"}, False),
    ({"posted": False, "reason": "no webhook configured"}, False),
    ({"posted": False, "reason": "already posted for this session"}, False),
    ({"posted": False, "reason": "no leaders for this session"}, False),
    ({"posted": False, "reason": "below the floor: 2 names, floor is 3"}, False),
    ({"posted": False, "reason": "refused by the validator: content: emoji"}, False),
    ({"posted": False, "reason": "leaders_fn failed: OperationalError"}, False),
    ({"posted": False, "reason": "dry run", "dry_run": True}, False),
    ({"posted": False, "reason": "a run is already in flight"}, False),
])
def test_the_retry_pass_re_posts_ONLY_a_transport_refusal(monkeypatch, capsys, first, expect):
    _settled(monkeypatch)
    door.record_receipt({"session": SESSION, **first}, "scheduled")
    calls = _stub_post(monkeypatch, {"posted": True, "reason": "posted", "session": SESSION})
    m._run_rs_discord_post(retry=True)
    assert (len(calls) == 1) is expect, first
    out = capsys.readouterr().out
    if expect:
        assert "[scheduler] rs discord post retry: session=2026-11-05 posted=True" in out
        assert door.last_receipt("retry")["posted"] is True
        assert door.last_receipt("scheduled")["reason"] == first["reason"], "the first pass is kept"
    else:
        assert "nothing to retry" in out and f"(first pass: {first['reason']})" in out


def test_the_retry_pass_does_nothing_without_a_scheduled_receipt_for_THIS_session(monkeypatch, capsys):
    _settled(monkeypatch)
    calls = _stub_post(monkeypatch)
    m._run_rs_discord_post(retry=True)                                   # no receipt at all
    door.record_receipt({"session": "2026-11-04", "posted": False, "reason": "rate-limited"}, "scheduled")
    m._run_rs_discord_post(retry=True)                                   # yesterday's receipt
    door.record_receipt({"session": SESSION, "posted": False, "reason": "rate-limited"}, "door:test")
    m._run_rs_discord_post(retry=True)                                   # a hand-fired one, not the pass
    assert calls == []
    assert capsys.readouterr().out.count("nothing to retry (no scheduled receipt for this session)") == 3


def test_a_hand_fired_run_between_the_passes_does_not_hide_the_first_pass(monkeypatch):
    _settled(monkeypatch)
    door.record_receipt({"session": SESSION, "posted": False, "reason": "rate-limited"}, "scheduled")
    door.record_receipt({"session": SESSION, "posted": False, "reason": "dry run", "dry_run": True}, "door:test")
    calls = _stub_post(monkeypatch, {"posted": True, "reason": "posted", "session": SESSION})
    m._run_rs_discord_post(retry=True)
    assert len(calls) == 1


# ── the readers ───────────────────────────────────────────────────────────────

def _seed_screener(tmp_path, monkeypatch, rows):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    snapshot_db.upsert_rows(rows)


def _srow(ticker, **kw):
    base = {"ticker": ticker, "company": f"{ticker} Inc", "sector": "Technology", "price": 10.0,
            "snapshot_date": "2026-11-06", "bars_asof": "20261105", "built_at": 1,
            "rs_new_high": 0, "rs_nh_before_price": 0, "rs_nh_red_day": 0, "rs_line_above_ma": 1,
            "rs_rating_ibd": None}
    return {**base, **kw}


def test_rs_leaders_for_reads_the_sessions_rows_by_bars_asof_in_the_seam_shape(tmp_path, monkeypatch):
    """Three rows the brief names (new high / rating 92 / neither) plus two edge
    rows: a new high whose bars never caught up (left out) and a new high with
    no rating while the rating job is dark (`rating: None`)."""
    _seed_screener(tmp_path, monkeypatch, [
        _srow("AAA", rs_new_high=1, rs_nh_before_price=1, rs_nh_red_day=0, rs_rating_ibd=95),
        _srow("BBB", sector="Industrials", rs_rating_ibd=92, rs_line_above_ma=0),
        _srow("CCC", rs_rating_ibd=50),
        _srow("DDD", rs_new_high=1, rs_rating_ibd=99, bars_asof="20261104"),
        _srow("EEE", sector=None, rs_new_high=1, rs_nh_red_day=1, rs_rating_ibd=None),
    ])
    # The reader returns the seam's mapping form since decision P1 (2026-11-07):
    # the rows plus SPY's session change. No SPY row is seeded here, so None.
    got = m._rs_leaders_for(SESSION)
    assert set(got) == set(rp.SEAM_KEYS) and got["spy_change_pct"] is None
    rows = got["leaders"]
    by = {r["ticker"]: r for r in rows}
    assert set(by) == {"AAA", "BBB", "EEE"}
    assert set(by["AAA"]) == set(rp.ROW_KEYS)
    assert by["AAA"] == {"ticker": "AAA", "name": "AAA Inc", "sector": "Technology", "rating": 95,
                         "new_high": True, "before_price": True, "red_day": False, "rs_line_above": True}
    assert by["BBB"]["sector"] == "Industrials" and by["BBB"]["rating"] == 92
    assert by["BBB"]["new_high"] is False and by["BBB"]["rs_line_above"] is False
    assert by["EEE"]["rating"] is None and by["EEE"]["red_day"] is True and by["EEE"]["sector"] is None
    norm = rp.normalise_leaders(rows)
    assert [r["ticker"] for r in norm] == ["AAA", "BBB", "EEE"], "best-first; unrated last"
    assert norm[2]["rating"] is None
    assert m._rs_leaders_for("2026-11-04")["leaders"] == [
        {"ticker": "DDD", "name": "DDD Inc", "sector": "Technology", "rating": 99, "new_high": True,
         "before_price": False, "red_day": False, "rs_line_above": True}]


def test_rs_leaders_for_carries_spys_session_change_and_never_lists_spy(tmp_path, monkeypatch):
    """Decision P1: SPY's own row's `chg_pct_1d` for the SAME session rides the
    seam, so a calm session's red-day line can say "SPY was not a red day
    (+0.4%)". SPY's RS line against itself is a constant that ties its own high
    every session, so its row is read for the change and never listed."""
    _seed_screener(tmp_path, monkeypatch, [
        _srow("SPY", sector="Financial", chg_pct_1d=0.41, rs_new_high=1, rs_nh_before_price=1),
        _srow("AAA", rs_new_high=1, rs_nh_before_price=1, rs_rating_ibd=95),
        _srow("BBB", rs_new_high=1, rs_rating_ibd=93),
        _srow("CCC", rs_new_high=1, rs_rating_ibd=91),
    ])
    got = m._rs_leaders_for(SESSION)
    assert got["spy_change_pct"] == pytest.approx(0.41)
    assert [r["ticker"] for r in got["leaders"]] and "SPY" not in {r["ticker"] for r in got["leaders"]}
    post = rp.build_post(got, session=SESSION)
    assert "RS new highs on a red day: SPY was not a red day (+0.4%)\n" in post["content"]
    assert "RS new highs before price: AAA (95)\n" in post["content"], "no SPY (unrated) beside the leaders"
    # another session's SPY row is not this session's change
    assert m._rs_leaders_for("2026-11-04") == {"leaders": [], "spy_change_pct": None}
    # through the poster, the receipt carries the change and the post the line
    r = rp.post_rs_summary(SESSION, leaders_fn=m._rs_leaders_for, force=True, dry_run=True)
    assert r["reason"] == "dry run" and r["spy_change_pct"] == pytest.approx(0.41) and r["leaders"] == 3
    assert "SPY was not a red day (+0.4%)" in r["content"]


def test_rs_leaders_for_never_lists_an_etf(tmp_path, monkeypatch):
    """2026-11-07: the post lists stock leaders. On a red day an inverse fund or
    a haven ETF makes an RS new high because the market fell; the rating already
    excludes ETFs, so they would also print "(unrated)"."""
    _seed_screener(tmp_path, monkeypatch, [
        _srow("SQQQ", is_etf=1, rs_new_high=1, rs_nh_red_day=1),
        _srow("GLD", is_etf=1, rs_new_high=1, rs_nh_red_day=1),
        _srow("AAA", rs_new_high=1, rs_nh_red_day=1, rs_rating_ibd=95),
        _srow("BBB", is_etf=None, rs_new_high=1, rs_rating_ibd=93),   # unknown counts as a stock
    ])
    assert [r["ticker"] for r in m._rs_leaders_for(SESSION)["leaders"]] == ["AAA", "BBB"]



def test_rs_leaders_for_reads_a_red_spy_session_and_a_null_change_as_none(tmp_path, monkeypatch):
    _seed_screener(tmp_path, monkeypatch, [
        _srow("SPY", chg_pct_1d=-1.25),
        _srow("AAA", rs_new_high=1, rs_rating_ibd=95),
    ])
    red = m._rs_leaders_for(SESSION)
    assert red["spy_change_pct"] == pytest.approx(-1.25)
    assert "RS new highs on a red day: none\n" in rp.build_post(red, session=SESSION)["content"], \
        "a red day where no name qualified is still none"
    from api.services.screener import snapshot_db
    snapshot_db.upsert_rows([_srow("SPY", chg_pct_1d=None)])      # one row per ticker: replaces
    assert m._rs_leaders_for(SESSION)["spy_change_pct"] is None, "a NULL change is unknown, never 0"


def test_rs_leaders_for_raises_on_a_missing_table_so_the_poster_says_why(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "empty.db"))
    with pytest.raises(Exception):
        m._rs_leaders_for(SESSION)
    r = rp.post_rs_summary(SESSION, leaders_fn=m._rs_leaders_for, force=True, dry_run=True)
    assert r["reason"].startswith("leaders_fn failed: ")


def test_rs_evidence_for_reports_the_displayable_signals_with_the_benchmark_outcome(tmp_path):
    write_artifact(tmp_path, fixture_artifact())
    out = m._rs_evidence_for(SESSION)
    assert [e["signal"] for e in out] == ["RS new highs", "RS new highs before price"], \
        "the red-day signal sits under the display floor (n=40) and is left out"
    # 2026-11-07 (owner decision N6): the pull's own phrase, base stated, same as the card.
    assert all(e["outcome"] == ep_outcome("SPY", 63) for e in out)
    assert ep_outcome("SPY", 63) == "beat SPY from the next session's open to the close 63 sessions later"
    line = rp.evidence_line(out)
    # 2026-11-07: each hit rate carries the card's likely range (`likely_range_phrase`)
    assert line.startswith("Evidence: 4,700 RS new highs from 2025-11-05 to 2026-11-04; 55.2% (likely "
                           "between 49.0% and 61.2%) beat SPY from the next session's open to the close 63 "
                           "sessions later. Universe as held, survivorship not yet corrected. 1,284 RS new "
                           "highs before price from 2025-11-05 to 2026-11-04; 58.3% (likely between 52.0% "
                           "and 64.4%) beat SPY from the next session's open to the close 63 sessions later.")
    assert line != rp.HONESTY_LINE
    # and the longest post the caps allow still clears Discord's limit with the evidence on
    post = rp.build_post(FIXTURE, session=SESSION, evidence=out)
    assert rp.validate_post(post) == [] and len(post["content"]) < 1800


def test_rs_evidence_for_is_none_without_an_artifact_and_the_honesty_line_prints(tmp_path):
    assert m._rs_evidence_for(SESSION) is None
    assert rp.evidence_line(m._rs_evidence_for(SESSION)) == rp.HONESTY_LINE


# ── the boot line ─────────────────────────────────────────────────────────────

class _Sched:
    def __init__(self, ids=(JOB, RETRY), raises=False):
        self.ids, self.raises = set(ids), raises

    def get_job(self, jid):
        if self.raises:
            raise RuntimeError("no scheduler")
        return object() if jid in self.ids else None


def test_the_boot_line_names_the_state_and_never_the_url(monkeypatch):
    assert m._rs_discord_post_boot_line(_Sched()) == \
        f"[startup] rs-discord-post: enabled=0 webhook=unset last_posted=none jobs={JOB},{RETRY}"
    monkeypatch.setenv(rp.FLAG, "1")
    monkeypatch.setenv(rp.WEBHOOK_ENV, LIVE_HOOK)
    rp.FileMarker().mark(SESSION)
    line = m._rs_discord_post_boot_line(_Sched(ids=()))
    assert line == f"[startup] rs-discord-post: enabled=1 webhook=set last_posted={SESSION} jobs=NONE REGISTERED"
    assert "discord.test" not in line and "secret" not in line
    assert m._rs_discord_post_boot_line(_Sched(raises=True)).startswith(
        "[startup] rs-discord-post: status unavailable (RuntimeError)")
    assert m._rs_discord_post_boot_line(None).endswith(f"last_posted={SESSION}")


def test_the_lifespan_prints_the_boot_line_and_the_mount_injects_the_readers__BY_AST():
    src = pathlib.Path(m.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    names = [n.func.id for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
    assert names.count("_rs_discord_post_boot_line") == 1
    attrs = [n.func.attr for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and getattr(n.func.value, "id", None) == "rs_discord_router"]
    assert attrs == ["configure"], "configured once, beside the mount"
    assert names.count("register_discord_index_close_job") == 1          # control: the probe sees siblings


# ── the door ──────────────────────────────────────────────────────────────────

ADMIN = {"id": "t", "role": "admin"}


@pytest.fixture
def client(monkeypatch):
    """A bare app with the router and stub readers: three leaders (over the floor)."""
    _never_send(monkeypatch)
    app = FastAPI()
    app.include_router(door.router)
    door.configure(leaders_fn=lambda s: FIXTURE[:3], evidence_fn=lambda s: None, session_fn=lambda: SESSION)
    c = TestClient(app)
    c.app = app
    return c


def _admin(client):
    client.app.dependency_overrides[door.require_admin_or_push_secret] = lambda: ADMIN


def test_the_door_is_401_without_a_credential_and_with_a_wrong_bearer(client, monkeypatch):
    for path in ("/api/admin/rs-discord/post?target=test", "/api/admin/rs-discord/status"):
        send = client.post if path.endswith("test") else client.get
        assert send(path).status_code == 401
        assert send(path, headers={"Authorization": "Bearer wrong"}).status_code == 401
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    assert client.post("/api/admin/rs-discord/post?target=test",
                       headers={"Authorization": "Bearer nope"}).status_code == 401
    assert door.last_receipt() is None, "nothing ran"


def test_the_push_secret_bearer_opens_the_door_the_way_the_owners_curl_will(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    r = client.get("/api/admin/rs-discord/status", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200 and r.json()["enabled"] is False


def test_target_test_without_the_test_webhook_is_409_and_posts_nothing(client):
    _admin(client)
    r = client.post("/api/admin/rs-discord/post?target=test&force=1")
    assert r.status_code == 409
    assert door.TEST_WEBHOOK_ENV in r.json()["detail"]
    assert door.last_receipt() is None


def test_a_dry_run_returns_the_content_posts_nothing_and_needs_no_webhook(client):
    _admin(client)
    r = client.post("/api/admin/rs-discord/post?target=test&force=1&dry_run=1")
    assert r.status_code == 200
    body = r.json()
    assert body["posted"] is False and body["dry_run"] is True and body["reason"] == "dry run"
    assert body["content"].startswith("UCT RS leaders for Thursday, November 5.")
    assert body["target"] == "test" and body["webhook"] == "unset" and body["source"] == "door:test"
    assert rp.last_posted() == ""


def test_a_test_post_lands_in_the_test_room_and_never_marks_the_session(client, monkeypatch):
    _admin(client)
    monkeypatch.setenv(door.TEST_WEBHOOK_ENV, TEST_HOOK)
    monkeypatch.setenv(rp.WEBHOOK_ENV, LIVE_HOOK)
    sent = []
    monkeypatch.setattr(rp, "_default_send", lambda url, body: sent.append((url, body)) or 204)
    r = client.post("/api/admin/rs-discord/post?target=test&force=1")
    assert r.status_code == 200
    body = r.json()
    assert body["posted"] is True and body["webhook"] == "set"
    assert [u for u, _ in sent] == [TEST_HOOK]
    # `marked` reports that the injected dedup's mark() returned, which `_NoMark` does
    # without writing; the guarantee is the marker FILE: absent, so the member post
    # for this session is not skipped afterwards.
    assert rp.last_posted() == "" and not rp.FileMarker().path.exists()
    assert "discord.test" not in r.text
    assert door.last_receipt("door:test")["posted"] is True


def test_target_live_passes_force_and_dry_run_through_with_the_modules_own_gates(client, monkeypatch):
    _admin(client)
    calls = _stub_post(monkeypatch, {"posted": True, "reason": "posted", "session": SESSION})
    r = client.post("/api/admin/rs-discord/post?target=live&force=1")
    assert r.status_code == 200 and r.json()["source"] == "door:live"
    session, kw = calls[0]
    assert session == SESSION
    assert kw["force"] is True and kw["dry_run"] is False
    assert kw["webhook_url"] is None and kw["dedup"] is None, "the member webhook and the real marker"
    assert kw["leaders_fn"] is door.seams()["leaders_fn"]
    client.post("/api/admin/rs-discord/post?target=live&dry_run=1&session=2026-11-04")
    session, kw = calls[1]
    assert session == "2026-11-04" and kw["force"] is False and kw["dry_run"] is True


def test_the_door_rejects_a_bad_target_or_session_and_an_unconfigured_app(client):
    _admin(client)
    assert client.post("/api/admin/rs-discord/post?target=prod").status_code == 422
    assert client.post("/api/admin/rs-discord/post").status_code == 422
    assert client.post("/api/admin/rs-discord/post?target=test&session=Nov-5").status_code == 422
    door.configure(leaders_fn=None, evidence_fn=None, session_fn=None)
    assert client.post("/api/admin/rs-discord/post?target=test&dry_run=1&force=1").status_code == 503


def test_the_status_readback_shape(client, monkeypatch):
    _admin(client)
    body = client.get("/api/admin/rs-discord/status").json()
    assert body == {"enabled": False, "webhook": "unset", "test_webhook": "unset",
                    "last_posted": None, "last_receipt": None, "jobs": [JOB, RETRY]}
    monkeypatch.setenv(rp.FLAG, "1")
    monkeypatch.setenv(rp.WEBHOOK_ENV, LIVE_HOOK)
    monkeypatch.setenv(door.TEST_WEBHOOK_ENV, TEST_HOOK)
    rp.FileMarker().mark(SESSION)
    door.record_receipt({"session": SESSION, "posted": True, "reason": "posted"}, "scheduled")
    r = client.get("/api/admin/rs-discord/status")
    body = r.json()
    assert body["enabled"] is True and body["webhook"] == "set" and body["test_webhook"] == "set"
    assert body["last_posted"] == SESSION and body["last_receipt"]["source"] == "scheduled"
    assert "discord.test" not in r.text


# ── the wiring on the real app, and the rails ─────────────────────────────────

def test_the_router_is_mounted_on_the_real_app_with_the_real_readers():
    from api.main import app
    paths = {r.path for r in app.routes}
    assert {"/api/admin/rs-discord/post", "/api/admin/rs-discord/status"} <= paths
    assert door.seams() == {"leaders_fn": m._rs_leaders_for, "evidence_fn": m._rs_evidence_for,
                            "session_fn": m._rs_discord_session}


def test_the_gate_is_the_shared_one_and_the_auth_audit_knows_its_name():
    from api import auth_surface_check as asc
    from api.routers.patterns import require_admin_or_push_secret
    assert door.require_admin_or_push_secret is require_admin_or_push_secret
    assert "require_admin_or_push_secret" in asc.GUARD_NAMES
    for route in door.router.routes:
        names = {d.call.__name__ for d in route.dependant.dependencies}
        assert "require_admin_or_push_secret" in names, route.path


def test_the_test_webhook_row_satisfies_the_channel_census():
    purpose, owner = channels.LEGACY_WEBHOOKS[door.TEST_WEBHOOK_ENV]
    assert purpose == "rs_leaders_test" and "rs_discord" in owner
    assert channels.webhook_name("rs_leaders_test") == door.TEST_WEBHOOK_ENV
    purposes = [p for p, _ in channels.LEGACY_WEBHOOKS.values()]
    assert len(purposes) == len(set(purposes))
