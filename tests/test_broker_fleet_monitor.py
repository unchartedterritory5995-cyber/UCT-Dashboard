"""Broker fleet monitor — autonomous detection of stuck member connections.

Owner-approved design (2026-07-16): every member is a detector. The monitor
sweeps ALL connections hourly for the states that stranded real members this
week and pings the owner's Discord (never members):
  • stranded connect — broker identity exists but ZERO accounts imported
    (the Webull dead-end state) older than a grace window;
  • stale sync — a sync-enabled active account with no successful sync in
    24h (the silent-death state);
  • still-broken — a connection sitting in status='broken' (member ignoring
    the reconnect email);
  • SnapTrade heartbeat — partner API down / key invalid.
One digest ping per distinct finding-set per ET day.
"""

from __future__ import annotations

import importlib

from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import (
    snaptrade_client as snap, connections, fleet_monitor,
)


class _Resp:
    def __init__(self, body):
        self.body = body


class _Group:
    def __init__(self, **m):
        for k, v in m.items():
            setattr(self, k, v)


class _NoThrottle:
    async def acquire(self, n=1):
        return None


def _iso(dt):
    return dt.isoformat()


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    auth_db.init_db()
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    snap.set_limiter(_NoThrottle())
    # Both heartbeats must be stubbed: the UNAUTHENTICATED api_status probe and
    # the partner-SIGNED get_partner_info probe (the one that actually notices
    # our own credentials being rejected — prod 2026-07-23).
    snap.configure(_Group(
        api_status=_Group(check=lambda **kw: _Resp({"online": True})),
        reference_data=_Group(get_partner_info=lambda **kw: _Resp({})),
    ))
    # Fleet checks skip unpaid users; make test users admins.
    def mk_user(uid):
        c = auth_db.get_connection()
        c.execute("INSERT OR REPLACE INTO users (id, email, password_hash, role) "
                  "VALUES (?, ?, 'x', 'admin')", (uid, f"{uid}@x.com"))
        c.commit(); c.close()
    pings = []
    monkeypatch.setattr(fleet_monitor, "_post_discord",
                        lambda title, desc: pings.append((title, desc)))
    fleet_monitor._reset_dedup_for_tests()
    yield {"mk_user": mk_user, "pings": pings}
    snap.reset()


def _mk_conn_with_account(uid, *, last_sync_at=None, status="active", sync_enabled=True):
    connections.save_broker_user(uid, f"{uid}-uid", "secret")
    ba = connections.map_snaptrade_account(uid, {
        "id": f"S-{uid}", "name": "Robinhood", "number": "1234",
        "institution_name": "Robinhood",
    })
    conn = auth_db.get_connection()
    conn.execute(
        "UPDATE j2_broker_accounts SET status=?, sync_enabled=?, last_sync_at=?, "
        "last_sync_status=? WHERE id=?",
        (status, 1 if sync_enabled else 0, last_sync_at,
         "ok" if last_sync_at else None, ba["id"]),
    )
    conn.commit(); conn.close()
    return ba


@pytest.mark.asyncio
async def test_detects_stranded_connect(env):
    env["mk_user"]("u-stranded")
    connections.save_broker_user("u-stranded", "uid-s", "secret")  # identity, 0 accounts
    # Backdate consent past the grace window.
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_broker_users SET consent_at=? WHERE user_id='u-stranded'",
                 (_iso(datetime.now(timezone.utc) - timedelta(hours=2)),))
    conn.commit(); conn.close()
    out = await fleet_monitor.run_fleet_check()
    kinds = [f["kind"] for f in out["findings"]]
    assert "stranded_connect" in kinds
    assert len(env["pings"]) == 1


@pytest.mark.asyncio
async def test_detects_stale_sync_and_still_broken(env):
    env["mk_user"]("u-stale"); env["mk_user"]("u-broken")
    _mk_conn_with_account(
        "u-stale", last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=72)))
    _mk_conn_with_account(
        "u-broken", status="broken",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)))
    out = await fleet_monitor.run_fleet_check()
    kinds = sorted(f["kind"] for f in out["findings"])
    assert kinds == ["stale_sync", "still_broken"]


def _set_last_error(ba_id, msg):
    conn = auth_db.get_connection()
    conn.execute(
        "UPDATE j2_broker_accounts SET last_error=?, last_sync_status='error' WHERE id=?",
        (msg, ba_id))
    conn.commit(); conn.close()


@pytest.mark.asyncio
async def test_member_emailed_once_per_stale_episode(env, monkeypatch):
    """A silently-stale connection WITH a recorded error emails the member once
    per stale episode — durable dedup means an hourly re-sweep never re-spams."""
    from api.services.journal_two.broker import notifications
    from api.services import email_service
    monkeypatch.setattr(notifications, "_spawn", lambda fn, *a: fn(*a))  # run delivery sync
    sent = []
    monkeypatch.setattr(email_service, "send_broker_reconnect_email",
                        lambda email, name, brokerage: sent.append((email, brokerage)) or True)
    env["mk_user"]("u-stale")
    ba = _mk_conn_with_account(
        "u-stale", last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=72)))
    _set_last_error(ba["id"], "SnapTrade rejected this connection")  # real, member-actionable
    await fleet_monitor.run_fleet_check()
    await fleet_monitor.run_fleet_check()  # same episode
    assert [e for e, _ in sent] == ["u-stale@x.com"]  # exactly one


@pytest.mark.asyncio
async def test_stale_without_error_does_not_member_email(env, monkeypatch):
    """Stale but NO recorded error = a backend/scheduler gap, not an auth lapse.
    Emailing 'reconnect' would be a wrong-copy false alarm — the hasError gate
    blocks it (owner is still pinged)."""
    from api.services.journal_two.broker import notifications
    from api.services import email_service
    monkeypatch.setattr(notifications, "_spawn", lambda fn, *a: fn(*a))
    sent = []
    monkeypatch.setattr(email_service, "send_broker_reconnect_email",
                        lambda *a: sent.append(a) or True)
    env["mk_user"]("u-stale2")
    _mk_conn_with_account(
        "u-stale2", last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=72)))
    out = await fleet_monitor.run_fleet_check()
    assert any(f["kind"] == "stale_sync" for f in out["findings"])  # still detected
    assert sent == []  # but member NOT emailed


@pytest.mark.asyncio
async def test_broken_connection_does_not_member_email_on_sweep(env, monkeypatch):
    """still_broken is already member-emailed at the broken transition
    (connection_broken); the hourly sweep must NOT re-email a duplicate."""
    from api.services.journal_two.broker import notifications
    from api.services import email_service
    monkeypatch.setattr(notifications, "_spawn", lambda fn, *a: fn(*a))
    sent = []
    monkeypatch.setattr(email_service, "send_broker_reconnect_email",
                        lambda *a: sent.append(a) or True)
    env["mk_user"]("u-broken")
    ba = _mk_conn_with_account(
        "u-broken", status="broken",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)))
    _set_last_error(ba["id"], "reconnect required")
    await fleet_monitor.run_fleet_check()
    assert sent == []


@pytest.mark.asyncio
async def test_healthy_fleet_pings_nothing(env):
    env["mk_user"]("u-ok")
    _mk_conn_with_account(
        "u-ok", last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(minutes=30)))
    out = await fleet_monitor.run_fleet_check()
    assert out["findings"] == []
    assert env["pings"] == []


@pytest.mark.asyncio
async def test_same_findings_dedupe_per_day(env):
    env["mk_user"]("u-stale")
    _mk_conn_with_account(
        "u-stale", last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=72)))
    await fleet_monitor.run_fleet_check()
    await fleet_monitor.run_fleet_check()
    assert len(env["pings"]) == 1


@pytest.mark.asyncio
async def test_suppressed_user_via_env_is_dropped(env, monkeypatch):
    monkeypatch.setenv("BROKER_FLEET_SUPPRESS", "u-testacct, u-other")
    env["mk_user"]("u-testacct")
    _mk_conn_with_account(
        "u-testacct", status="broken",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)))
    out = await fleet_monitor.run_fleet_check()
    assert out["findings"] == []
    assert env["pings"] == []


@pytest.mark.asyncio
async def test_bracco_test_account_suppressed_by_default(env):
    uid = "38c023cf-0e81-4187-aa43-ac51a751ae79"
    env["mk_user"](uid)
    _mk_conn_with_account(
        uid, status="broken",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)))
    out = await fleet_monitor.run_fleet_check()
    assert out["findings"] == []
    assert env["pings"] == []


@pytest.mark.asyncio
async def test_suppression_leaves_other_users_flagged(env, monkeypatch):
    monkeypatch.setenv("BROKER_FLEET_SUPPRESS", "u-testacct")
    env["mk_user"]("u-testacct"); env["mk_user"]("u-real")
    _mk_conn_with_account(
        "u-testacct", status="broken",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)))
    _mk_conn_with_account(
        "u-real", status="broken",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=1)))
    out = await fleet_monitor.run_fleet_check()
    assert [f["userId"] for f in out["findings"]] == ["u-real"]


@pytest.mark.asyncio
async def test_snaptrade_heartbeat_failure_is_a_finding(env):
    def down(**kw):
        raise RuntimeError("connection refused")
    snap.configure(_Group(api_status=_Group(check=down)))
    out = await fleet_monitor.run_fleet_check()
    assert any(f["kind"] == "snaptrade_unreachable" for f in out["findings"])


@pytest.mark.asyncio
async def test_partner_auth_rejection_is_a_finding_even_when_api_status_is_green(env):
    """The 2026-07-23 regression rail.

    api_status.check is UNAUTHENTICATED — it stayed green for a full day while
    every member connection 401'd, so the digest blamed the members. A rejected
    partner-SIGNED call must surface as its own finding.
    """
    def rejected(**kw):
        raise RuntimeError("SnapTrade API error 401: Unauthorized (code 0000) "
                           "— Authentication credentials were not provided.")
    snap.configure(_Group(
        api_status=_Group(check=lambda **kw: _Resp({"online": True})),  # green
        reference_data=_Group(get_partner_info=rejected),               # rejected
    ))
    out = await fleet_monitor.run_fleet_check()
    kinds = [f["kind"] for f in out["findings"]]
    assert "snaptrade_auth_failed" in kinds
    assert "snaptrade_unreachable" not in kinds  # provider itself was fine


# ── stale threshold must never collide with the sync cadence ────────────────
#
# _STALE_SYNC_HOURS used to be hardcoded 24 while the per-account cadence is
# also 24h (daily mode). An account synced at T is not due again until T+24h,
# the scheduler ticks every ~20min jittered, and this check runs hourly — so a
# healthy account sat over the threshold for up to an hour EVERY DAY. Chronic
# false alarms are how the real 2026-07-23 digest went unread.

def test_stale_threshold_exceeds_the_sync_interval(monkeypatch):
    monkeypatch.delenv("BROKER_SYNC_INTERVAL_MIN", raising=False)
    monkeypatch.delenv("BROKER_SYNC_MODE", raising=False)  # default = daily/1440
    from api.services.journal_two.broker.sync import _default_interval_min
    interval_h = _default_interval_min() / 60.0
    assert fleet_monitor._stale_sync_hours() > interval_h


def test_stale_threshold_tracks_a_changed_cadence(monkeypatch):
    monkeypatch.setenv("BROKER_SYNC_INTERVAL_MIN", "600")  # 10h cadence
    assert fleet_monitor._stale_sync_hours() == pytest.approx(15.0)


def test_stale_threshold_has_a_floor_for_tiny_cadences(monkeypatch):
    monkeypatch.setenv("BROKER_SYNC_INTERVAL_MIN", "20")
    assert fleet_monitor._stale_sync_hours() == fleet_monitor._STALE_SYNC_HOURS_FLOOR


@pytest.mark.asyncio
async def test_healthy_account_synced_within_cadence_is_not_flagged(env):
    """The regression rail: just past 24h is NOT stale under a 24h cadence."""
    env["mk_user"]("u-fresh")
    _mk_conn_with_account(
        "u-fresh", status="active",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=25)))
    out = await fleet_monitor.run_fleet_check()
    assert [f for f in out["findings"] if f["kind"] == "stale_sync"] == []


@pytest.mark.asyncio
async def test_genuinely_stale_account_is_still_flagged(env):
    env["mk_user"]("u-dead")
    _mk_conn_with_account(
        "u-dead", status="active",
        last_sync_at=_iso(datetime.now(timezone.utc) - timedelta(hours=72)))
    out = await fleet_monitor.run_fleet_check()
    assert any(f["kind"] == "stale_sync" for f in out["findings"])


# ── digest dedup survives a redeploy ────────────────────────────────────────

@pytest.mark.asyncio
async def test_digest_dedup_is_durable_across_a_process_restart(env):
    env["mk_user"]("u-broken")
    _mk_conn_with_account("u-broken", status="broken")

    first = await fleet_monitor.run_fleet_check()
    assert first["pinged"] is True

    # Simulate a redeploy: fresh process, empty module state. Previously this
    # re-armed the dict and the identical digest pinged again.
    importlib.reload(fleet_monitor)
    fleet_monitor._post_discord = lambda *a, **k: env["pings"].append(a)

    second = await fleet_monitor.run_fleet_check()
    assert second["findings"], "same problem should still be detected"
    assert second["pinged"] is False, "but must NOT re-ping after a redeploy"


# ── canary asserts OUTCOMES, not just absence of exceptions ─────────────────
#
# The original canary checked only for an `error` key or an empty result. Three
# states where the pipeline is demonstrably broken returned neither, so the
# canary reported green — including the single most important one: a connection
# sitting in status='broken' comes back as {"skipped": True, "reason": "broken"}.

def test_canary_flags_a_skipped_connection():
    """The hole that mattered most: 'broken' is reported as skipped, not error."""
    problems = fleet_monitor.canary_failures(
        {"acct-1": {"skipped": True, "reason": "broken"}})
    assert len(problems) == 1
    assert "SKIPPED" in problems[0] and "broken" in problems[0]


def test_canary_flags_stale_holdings():
    problems = fleet_monitor.canary_failures(
        {"acct-1": {"fetched": 12, "balancesError": "rate limited"}})
    assert len(problems) == 1
    assert "stale" in problems[0]


def test_canary_flags_fifo_reconstruction_errors():
    problems = fleet_monitor.canary_failures(
        {"acct-1": {"fetched": 12, "fifoErrors": 3, "balancesError": None}})
    assert len(problems) == 1
    assert "FIFO" in problems[0]


def test_canary_flags_an_explicit_error():
    problems = fleet_monitor.canary_failures({"acct-1": {"error": "boom"}})
    assert len(problems) == 1 and "boom" in problems[0]


def test_canary_flags_no_accounts():
    assert fleet_monitor.canary_failures({}) == [
        "no accounts synced — the canary user has no syncable connection"]


def test_canary_passes_a_genuinely_healthy_sync():
    assert fleet_monitor.canary_failures({
        "acct-1": {"fetched": 12, "newActivities": 2, "imported": 1,
                   "fifoErrors": 0, "balancesError": None, "openPositions": 3},
    }) == []


def test_canary_reports_every_bad_account_not_just_the_first():
    problems = fleet_monitor.canary_failures({
        "acct-1": {"skipped": True, "reason": "broken"},
        "acct-2": {"fetched": 1, "balancesError": "timeout"},
        "acct-3": {"fetched": 1, "fifoErrors": 0, "balancesError": None},
    })
    assert len(problems) == 2


def test_canary_is_a_noop_when_unarmed(monkeypatch):
    monkeypatch.delenv("BROKER_CANARY_USER_ID", raising=False)
    posts = []
    monkeypatch.setattr(fleet_monitor, "_post_discord",
                        lambda *a: posts.append(a))
    fleet_monitor.run_canary_sync_blocking()
    assert posts == []


def test_canary_pings_on_a_skipped_connection_end_to_end(monkeypatch):
    monkeypatch.setenv("BROKER_CANARY_USER_ID", "u-canary")
    posts = []
    monkeypatch.setattr(fleet_monitor, "_post_discord",
                        lambda *a: posts.append(a))

    async def fake_sync(user_id, **kw):
        return {"acct-1": {"skipped": True, "reason": "broken"}}

    import api.services.journal_two.broker.sync as _sync
    monkeypatch.setattr(_sync, "sync_all_for_user", fake_sync)
    fleet_monitor.run_canary_sync_blocking()
    assert len(posts) == 1
    assert "FAILED" in posts[0][0]
    assert "SKIPPED" in posts[0][1]


def test_canary_silent_on_a_healthy_sync_end_to_end(monkeypatch):
    monkeypatch.setenv("BROKER_CANARY_USER_ID", "u-canary")
    posts = []
    monkeypatch.setattr(fleet_monitor, "_post_discord",
                        lambda *a: posts.append(a))

    async def fake_sync(user_id, **kw):
        return {"acct-1": {"fetched": 5, "fifoErrors": 0, "balancesError": None}}

    import api.services.journal_two.broker.sync as _sync
    monkeypatch.setattr(_sync, "sync_all_for_user", fake_sync)
    fleet_monitor.run_canary_sync_blocking()
    assert posts == []
