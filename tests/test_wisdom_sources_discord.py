"""Wisdom sources — Discord (stream S-C, CONTRACTS.md §6.3, W1 §2.1).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a member's message (or a quote/reply of one) reaching wisdom.db in any column;
2. a 401/403 channel retried before its hour is up;
3. more than five pages fetched for one channel in one tick;
4. a rate-limit header ignored, or a 429 slept uncapped;
5. a cursor that moves without the rows it covers;
6. a backfill that restarts instead of resuming;
7. a legacy-classified message reaching extraction;
8. a listener that reports healthy while polling nothing.
Every guard has a control beside it. No network: the fetcher is a fake.
"""
from __future__ import annotations

import ast
import pathlib
from datetime import datetime, timedelta

import pytest

from api.services.wisdom.core import store, timeutil
from api.services.wisdom.sources import discord as dc

REPO = pathlib.Path(__file__).resolve().parents[1]
TSDR = "339816805805588480"
BRACCO = "427798118935953410"
MEMBER = "999999999999999999"
TSDR_CH = "882459873823043655"
T0 = datetime(2026, 9, 14, 10, 13, tzinfo=timeutil.ET)


@pytest.fixture(autouse=True)
def hermetic(monkeypatch, tmp_path):
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY", "DATA_SYNC_SECRET_KEY", "DATA_SYNC_BUCKET"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "test-token")
    store.init_db()
    sleeps: list = []
    monkeypatch.setattr(dc, "_sleep", lambda s: sleeps.append(s))
    return sleeps


def _mid(n: int) -> str:
    return str(1400000000000000000 + n * 4194304)  # distinct snowflakes, ascending with n


def _msg(n, author=TSDR, content="NVDA over 150 is the trigger", **extra):
    return {"id": _mid(n), "type": 0, "author": {"id": author}, "content": content, **extra}


class FakeDiscord:
    """Serves a channel history the way the REST API pages it: `after` returns the
    oldest page after the id, `before` the newest page before it, none = latest."""

    def __init__(self, history, statuses=None, remaining=None, reset_after=None, retry_after=None):
        self.history = sorted(history, key=lambda m: int(m["id"]))
        self.statuses = list(statuses or [])
        self.remaining, self.reset_after, self.retry_after = remaining, reset_after, retry_after
        self.calls: list = []

    def __call__(self, channel_id, after=None, before=None, limit=100):
        self.calls.append({"after": after, "before": before})
        if self.statuses:
            status = self.statuses.pop(0)
            if status != 200:
                return dc.FetchResult(status, error=f"HTTP {status}", retry_after=self.retry_after)
        if after:
            page = [m for m in self.history if int(m["id"]) > int(after)][:100]
        elif before:
            page = [m for m in self.history if int(m["id"]) < int(before)][-100:]
        else:
            page = self.history[-100:]
        return dc.FetchResult(200, list(reversed(page)), remaining=self.remaining, reset_after=self.reset_after)


def _all_text(conn) -> str:
    """Every TEXT value in every table: the only honest way to say 'not stored anywhere'."""
    out = []
    for (table,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'"):
        for row in conn.execute(f"SELECT * FROM {table}"):
            out.extend(str(v) for v in row if isinstance(v, str))
    return "\n".join(out)


def _state():
    with store.read() as conn:
        row = conn.execute("SELECT * FROM wisdom_discord_state WHERE channel_id = ?", (TSDR_CH,)).fetchone()
        return dict(row) if row else None


# ── 1. members never land ────────────────────────────────────────────────────

def test_member_messages_are_dropped_before_any_write():
    fake = FakeDiscord([_msg(1, content="AUTHORTEXT keep"), _msg(2, author=MEMBER, content="MEMBERSECRET buy")])
    out = dc.poll_channel(TSDR_CH, fetch=fake, now=T0)
    assert out["seen"] == 2 and out["kept"] == 1
    with store.read() as conn:
        text = _all_text(conn)
        authors = [r[0] for r in conn.execute("SELECT author_id FROM wisdom_discord_messages")]
        assert conn.execute("SELECT COUNT(*) FROM wisdom_sources").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM wisdom_segments").fetchone()[0] == 1
    assert "MEMBERSECRET" not in text and MEMBER not in text
    assert "AUTHORTEXT" in text and authors == ["tsdr"]  # control: the author's message IS stored


def test_bots_webhooks_and_system_messages_are_dropped():
    msgs = [_msg(1, webhook_id="1527044971553620088"), {**_msg(2), "author": {"id": TSDR, "bot": True}},
            {**_msg(3), "type": 7}, _msg(4, content="real")]
    assert [dc.clean_message(m, TSDR_CH) is not None for m in msgs] == [False, False, False, True]


def test_quoted_and_replied_member_text_never_lands():
    msg = _msg(1, type=19, content="> QUOTESECRET line\nLITE reclaim over 97 <@123456789012345678> "
                                   f"<@{BRACCO}>\n>>> MULTISECRET\nstill quoted",
               message_reference={"message_id": _mid(0)},
               referenced_message={"id": _mid(0), "author": {"id": MEMBER}, "content": "REFSECRET"},
               message_snapshots=[{"message": {"content": "FWDSECRET"}}])
    dc.poll_channel(TSDR_CH, fetch=FakeDiscord([msg]), now=T0)
    with store.read() as conn:
        text = _all_text(conn)
        row = conn.execute("SELECT reply_to_message_id FROM wisdom_discord_messages").fetchone()
        seg = conn.execute("SELECT text FROM wisdom_segments").fetchone()[0]
    for secret in ("QUOTESECRET", "MULTISECRET", "REFSECRET", "FWDSECRET", "123456789012345678"):
        assert secret not in text, secret
    assert seg == "LITE reclaim over 97 @member @bracco"
    assert row["reply_to_message_id"] == _mid(0)  # a pointer, never the text


def test_attachments_are_kept_as_media_pointers():
    msg = _msg(1, content="", attachments=[{"id": "55", "filename": "chart.png", "content_type": "image/png",
                                            "size": 1234, "url": "https://cdn.discordapp.com/a/chart.png"}])
    dc.poll_channel(TSDR_CH, fetch=FakeDiscord([msg]), now=T0)
    with store.read() as conn:
        row = conn.execute("SELECT attachments_json FROM wisdom_discord_messages").fetchone()
        src = conn.execute("SELECT media_pointer FROM wisdom_sources").fetchone()
    assert '"filename": "chart.png"' in row["attachments_json"] and "chart.png" in src["media_pointer"]


# ── 2. 401/403 back-off ──────────────────────────────────────────────────────

def test_a_forbidden_channel_is_blocked_for_an_hour_and_skipped_until_then():
    fake = FakeDiscord([_msg(1)], statuses=[403])
    first = dc.poll_channel(TSDR_CH, fetch=fake, now=T0)
    assert first["outcome"] == "blocked" and len(fake.calls) == 1
    st = _state()
    assert st["last_status"] == 403
    assert timeutil.parse_iso(st["blocked_until"]) == T0 + timedelta(hours=1)
    second = dc.poll_channel(TSDR_CH, fetch=fake, now=T0 + timedelta(minutes=59))
    assert second["outcome"] == "blocked" and len(fake.calls) == 1  # not retried inside the hour
    third = dc.poll_channel(TSDR_CH, fetch=fake, now=T0 + timedelta(minutes=61))
    assert third["outcome"] == "ok" and len(fake.calls) >= 2 and third["kept"] == 1


def test_control_a_server_error_is_not_a_block():
    fake = FakeDiscord([_msg(1)], statuses=[502])
    assert dc.poll_channel(TSDR_CH, fetch=fake, now=T0)["outcome"] == "failed"
    assert _state()["blocked_until"] is None
    assert dc.poll_channel(TSDR_CH, fetch=fake, now=T0 + timedelta(minutes=1))["kept"] == 1


# ── 3. page budget ───────────────────────────────────────────────────────────

def test_at_most_five_pages_per_channel_per_tick():
    fake = FakeDiscord([_msg(i) for i in range(1000)])
    out = dc.poll_channel(TSDR_CH, fetch=fake, now=T0)
    assert len(fake.calls) == dc.MAX_PAGES_PER_TICK == 5
    assert out["pages"] == 5 and out["kept"] == 500
    control = FakeDiscord([_msg(i) for i in range(1000)])
    dc.poll_channel("1193233724440059946", fetch=control, page_budget=7, now=T0)
    assert len(control.calls) == 7


# ── 4. rate limits ───────────────────────────────────────────────────────────

def test_rate_limit_headers_are_honoured_before_the_next_request(hermetic):
    dc.poll_channel(TSDR_CH, fetch=FakeDiscord([_msg(i) for i in range(300)], remaining=0, reset_after=2.5), now=T0)
    assert 2.5 in hermetic
    hermetic.clear()
    dc.poll_channel("1193233724440059946",
                    fetch=FakeDiscord([_msg(i) for i in range(300)], remaining=4, reset_after=2.5), now=T0)
    assert hermetic == []  # control: budget left, no sleep


def test_a_429_sleeps_once_capped_and_stops_the_channel(hermetic):
    fake = FakeDiscord([_msg(1)], statuses=[429], retry_after=45.0)
    out = dc.poll_channel(TSDR_CH, fetch=fake, now=T0)
    assert out["outcome"] == "rate_limited" and len(fake.calls) == 1
    assert hermetic == [dc.MAX_SLEEP_S]
    assert _state()["blocked_until"] is None


# ── 5-6. cursors and resumable backfill ──────────────────────────────────────

def test_a_cursor_never_moves_without_its_rows(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("disk full")

    original = dc._store_page
    monkeypatch.setattr(dc, "_store_page", boom)
    with pytest.raises(RuntimeError):
        dc.poll_channel(TSDR_CH, fetch=FakeDiscord([_msg(1)]), now=T0)
    st = _state()
    assert st is None or (st["forward_cursor"] is None and st["backfill_before"] is None)
    monkeypatch.setattr(dc, "_store_page", original)
    dc.poll_channel(TSDR_CH, fetch=FakeDiscord([_msg(1)]), now=T0)
    assert _state()["forward_cursor"] == _mid(1)  # control: the same page commits and moves it


def test_the_backfill_resumes_from_its_watermark_and_finishes():
    history = [_msg(i) for i in range(350)]
    fake = FakeDiscord(history)
    dc.poll_channel(TSDR_CH, fetch=fake, page_budget=2, now=T0)
    st = _state()
    assert not st["backfill_done"] and st["backfill_before"] == _mid(150)
    dc.poll_channel(TSDR_CH, fetch=fake, page_budget=2, now=T0)
    dc.poll_channel(TSDR_CH, fetch=fake, page_budget=2, now=T0)
    befores = [c["before"] for c in fake.calls if c["before"]]
    assert befores[0] == _mid(250) and all(int(a) > int(b) for a, b in zip(befores, befores[1:]))
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_discord_messages").fetchone()[0] == 350
        assert conn.execute("SELECT COUNT(DISTINCT source_id) FROM wisdom_segments").fetchone()[0] == 350
    assert _state()["backfill_done"] == 1


def test_new_messages_are_picked_up_after_the_forward_cursor():
    fake = FakeDiscord([_msg(i) for i in range(3)])
    dc.poll_channel(TSDR_CH, fetch=fake, now=T0)
    fake.history.extend([_msg(3), _msg(4)])
    out = dc.poll_channel(TSDR_CH, fetch=fake, now=T0 + timedelta(minutes=15))
    assert fake.calls[-1]["after"] == _mid(2) and out["kept"] == 2
    assert _state()["forward_cursor"] == _mid(4)


def test_a_dry_run_fetches_but_writes_nothing():
    dc.poll_channel(TSDR_CH, fetch=FakeDiscord([_msg(1)]), dry_run=True, now=T0)
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_discord_messages").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM wisdom_discord_state").fetchone()[0] == 0


# ── 7. legacy reconcile ──────────────────────────────────────────────────────

def test_legacy_ids_are_reconciled_and_never_reach_extraction():
    got = dc.record_legacy_ids(TSDR_CH, [_mid(1), _mid(9), "not-an-id"])
    assert (got["inserted"], got["rejected"]) == (2, 1)
    assert dc.record_legacy_ids(TSDR_CH, [_mid(1)])["already_marked"] == 1
    dc.poll_channel(TSDR_CH, fetch=FakeDiscord([_msg(1, content="legacy"), _msg(2, content="gap message")]), now=T0)
    with store.read() as conn:
        rows = {r["message_id"]: dict(r) for r in conn.execute("SELECT * FROM wisdom_discord_messages")}
        extractable = {r["text"] for r in conn.execute("SELECT text FROM wisdom_sources_extractable_segments")}
        all_segments = {r["text"] for r in conn.execute("SELECT text FROM wisdom_segments")}
    assert rows[_mid(1)]["legacy_classified"] == 1 and rows[_mid(1)]["segment_id"]  # completed, flag kept
    assert rows[_mid(9)]["segment_id"] is None and rows[_mid(9)]["author_id"] is None
    assert all_segments == {"legacy", "gap message"}
    assert extractable == {"gap message"}  # the legacy message never re-extracts; control: the gap one does


def test_legacy_ids_refuse_an_out_of_scope_channel_and_an_oversized_batch():
    # #main-chat was out of scope until session 28 (2026-09-19) added it for AtTheAsk;
    # #alex-jones stays out of scope by owner ruling the same session ("doesn't really
    # bring much value") -- still a valid out-of-scope fixture.
    with pytest.raises(ValueError):
        dc.record_legacy_ids("1216760919254892545", [_mid(1)])  # #alex-jones: out of scope
    with pytest.raises(ValueError):
        dc.record_legacy_ids(TSDR_CH, [_mid(i) for i in range(dc.MAX_LEGACY_BATCH + 1)])


def test_status_reports_cursors_backoff_and_counts():
    dc.poll_channel(TSDR_CH, fetch=FakeDiscord([_msg(1), _msg(2, author=BRACCO)]), now=T0)
    dc.poll_channel("882460017352130630", fetch=FakeDiscord([], statuses=[403]), now=T0)
    with store.read() as conn:
        status = dc.discord_status(conn, now=T0 + timedelta(minutes=5))
    by_id = {c["channel_id"]: c for c in status["channels"]}
    # Derived, not hardcoded: the in-scope set grew from 4 to 24 in session 28
    # (2026-09-19, Jersace/Main Chat/Setup Examples) and will keep moving.
    assert set(by_id) == set(dc.in_scope_channel_ids())
    assert by_id[TSDR_CH]["stored"] == 2 and by_id[TSDR_CH]["stored_by_author"] == {"tsdr": 1, "bracco": 1}
    assert by_id["882460017352130630"]["blocked"] is True
    assert status["token_configured"] is True and "test-token" not in repr(status)


# ── 8. the listener job ──────────────────────────────────────────────────────

def test_the_listener_is_registered_on_its_slot_behind_its_gate():
    from api.services.wisdom.core import flags
    from api.services.wisdom.sources import jobs

    spec = {s.job_id: s for s in jobs.JOBS}["wisdom_sources_discord_listener"]
    assert spec.trigger == {"kind": "cron", "minute": "13,28,43,58"}
    assert spec.enabled is flags.discord_listener_enabled and spec.expected_every_s == 900
    keys = {spec.due_key(T0.replace(minute=m)) for m in (13, 28, 43, 58)}
    assert keys == {"2026-09-14T10:00", "2026-09-14T10:15", "2026-09-14T10:30", "2026-09-14T10:45"}


def test_a_tick_that_polled_nothing_fails_the_run(monkeypatch):
    from api.services.wisdom import registry
    from api.services.wisdom.sources import jobs

    monkeypatch.setattr(registry, "_page", lambda *a, **k: None)
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    out = registry.run_job("wisdom_sources_discord_listener", force=True, now=T0)
    assert out["status"] == "failed" and "DISCORD_BOT_TOKEN" in out["error"]
    # every channel forbidden is a failure too
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "test-token")
    monkeypatch.setattr(dc, "fetch_page", lambda *a, **k: dc.FetchResult(403, error="HTTP 403"))
    out = registry.run_job("wisdom_sources_discord_listener", force=True, now=T0 + timedelta(minutes=15))
    assert out["status"] == "failed" and "blocked" in out["error"]
    # control: a healthy tick is ok
    monkeypatch.setattr(dc, "fetch_page", FakeDiscord([_msg(1)]))
    out = registry.run_job("wisdom_sources_discord_listener", force=True, now=T0 + timedelta(hours=2))
    assert out["status"] == "ok", out


def test_rest_only_no_gateway_socket_under_the_sources_package():
    files = sorted((REPO / "api" / "services" / "wisdom" / "sources").glob("*.py")) + [
        REPO / "api" / "routers" / "wisdom_sources.py"]
    assert len(files) >= 7
    offenders = [f.name for f in files if "wss://" in f.read_text(encoding="utf-8")]
    assert offenders == []
    # control: the scan reads the real module — it sees the REST base URL
    assert "https://discord.com/api/v10" in (REPO / "api/services/wisdom/sources/discord.py").read_text(encoding="utf-8")
    tree = ast.parse((REPO / "api/services/wisdom/sources/discord.py").read_text(encoding="utf-8"))
    imported = {n.names[0].name for n in ast.walk(tree) if isinstance(n, ast.Import)}
    assert not imported & {"websocket", "websockets", "discord"}
