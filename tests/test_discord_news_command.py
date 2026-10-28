"""Discord /news: one stock's TradeXchange headlines, read from #tradexchange.

Owner request 2026-10-27 ("lets do a discord command for news"). These rails pin
the command shape, the VIP gate and ephemeral defer (the feed is a paid channel),
the ticker-prefix filter, the window math, the incremental channel cache, and
the reply embed.
"""
from __future__ import annotations

import datetime as dt

import pytest

from tests.discord_harness import UT_GUILD, _app_client, _keypair, _post

EPHEMERAL = 64
VIP = "1001324657804325046"
UTC = dt.timezone.utc


# ── the command ──────────────────────────────────────────────────────────────

def test_news_is_registered_once_guild_only_with_a_required_autocompleted_ticker():
    from api.services import discord_interactions as di
    cmds = [c for c in di.build_commands() if c["name"] == "news"]
    assert len(cmds) == 1
    cmd = cmds[0]
    assert cmd["integration_types"] == [0] and cmd["contexts"] == [0]
    ticker, window = cmd["options"]
    assert ticker["required"] is True and ticker["autocomplete"] is True
    assert [c["value"] for c in window["choices"]] == ["today", "3d", "1w"]


# ── the interaction ──────────────────────────────────────────────────────────

def _news(ticker="nvda", window=None, roles=(VIP,), perms="0", uid="900"):
    opts = [{"name": "ticker", "type": 3, "value": ticker}]
    if window:
        opts.append({"name": "window", "type": 3, "value": window})
    return {"type": 2, "application_id": "123", "token": "tok", "guild_id": UT_GUILD, "channel_id": "555",
            "member": {"user": {"id": uid}, "roles": list(roles), "permissions": perms},
            "data": {"name": "news", "options": opts}}


@pytest.fixture()
def route(monkeypatch):
    from api.services import discord_interactions as di
    di.reset_rate_for_tests()
    monkeypatch.delenv("TX_NEWS_ROLE_IDS", raising=False)
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    return client, sk, rt


def test_a_vip_request_defers_EPHEMERALLY_and_schedules_the_lookup(route, monkeypatch):
    client, sk, rt = route
    jobs = []
    monkeypatch.setattr(rt.tx_news, "run_news_job", lambda *a, **k: jobs.append(a))
    r = _post(client, sk, _news("$nvda", "3d")).json()
    assert r["type"] == 5 and r["data"]["flags"] == EPHEMERAL
    assert jobs == [("123", "tok", "NVDA", "3d")]


def test_a_member_without_vip_is_refused_privately_and_nothing_is_read(route, monkeypatch):
    client, sk, rt = route
    monkeypatch.setattr(rt.tx_news, "run_news_job", lambda *a, **k: pytest.fail("non-VIP must not read the feed"))
    r = _post(client, sk, _news(roles=("42",))).json()
    assert r["type"] == 4 and r["data"]["flags"] == EPHEMERAL and "VIP" in r["data"]["content"]


def test_a_server_administrator_passes_without_the_role(route, monkeypatch):
    client, sk, rt = route
    jobs = []
    monkeypatch.setattr(rt.tx_news, "run_news_job", lambda *a, **k: jobs.append(a))
    assert _post(client, sk, _news(roles=(), perms=str(0x8))).json()["type"] == 5
    assert len(jobs) == 1


def test_a_bad_ticker_and_an_unknown_window(route, monkeypatch):
    client, sk, rt = route
    jobs = []
    monkeypatch.setattr(rt.tx_news, "run_news_job", lambda *a, **k: jobs.append(a))
    r = _post(client, sk, _news("not a ticker")).json()
    assert r["type"] == 4 and "/news NVDA" in r["data"]["content"] and not jobs
    _post(client, sk, _news("AMD", "forever"))
    assert jobs == [("123", "tok", "AMD", "today")]


# ── filter, window, cache, reply ─────────────────────────────────────────────

def test_headlines_match_the_ticker_PREFIX_only_and_keep_co_tickers():
    from api.services import discord_tx_news as n
    t0 = dt.datetime(2026, 10, 27, 14, 0, tzinfo=UTC)
    items = [(t0, "NVDA - Nvidia unveils new chip"),
             (t0 + dt.timedelta(minutes=5), "AMD NVDA - Both rally on AI capex"),
             (t0 + dt.timedelta(minutes=9), "TSM - Supplier to NVDA raises guide"),   # mention, not about NVDA
             (t0 + dt.timedelta(minutes=12), "Fed holds rates")]
    rows = n.headlines_for("NVDA", items)
    assert [line for _, line in rows] == ["Both rally on AI capex (AMD)", "Nvidia unveils new chip"]


def test_today_starts_at_4am_et_and_before_4am_means_yesterdays():
    from api.services import discord_tx_news as n
    et = n.ET
    assert n.window_start("today", dt.datetime(2026, 10, 27, 9, 30, tzinfo=et)) == dt.datetime(2026, 10, 27, 4, tzinfo=et)
    assert n.window_start("today", dt.datetime(2026, 10, 27, 2, 0, tzinfo=et)) == dt.datetime(2026, 10, 26, 4, tzinfo=et)


class _FakeDiscord:
    """Channel messages by id; answers `after=` pages like Discord (100 max)."""

    def __init__(self, msgs):
        self.msgs, self.calls = msgs, []

    def get(self, url, params):
        after = int(params["after"])
        self.calls.append(after)
        page = sorted((m for m in self.msgs if int(m["id"]) > after), key=lambda m: int(m["id"]))[:100]

        class R:
            status_code = 200
            def raise_for_status(self): pass
            def json(self, _p=page): return list(reversed(_p))   # Discord returns newest first
        return R()


def _msg(ts, text, author="TradeXchange"):
    from api.services import discord_tx_news as n
    return {"id": str(n.snowflake(ts)), "timestamp": ts.isoformat(), "content": text, "author": {"username": author}}


def test_the_cache_backfills_once_then_asks_only_for_newer_messages():
    from api.services import discord_tx_news as n
    n._reset_for_tests()
    now = dt.datetime.now(UTC)
    msgs = [_msg(now - dt.timedelta(hours=h), f"NVDA - item {h}") for h in range(30, 0, -1)]
    msgs.append(_msg(now - dt.timedelta(hours=2, minutes=1), "TradeXchange Recap post", author="TradeXchange Recap"))
    fake = _FakeDiscord(msgs)
    got = n.feed_since(now - dt.timedelta(hours=10), client=fake)
    assert len(got) == 9 and all("Recap" not in t for _, t in got)
    fake.calls.clear()
    fake.msgs.append(_msg(now - dt.timedelta(minutes=1), "NVDA - fresh"))
    got = n.feed_since(now - dt.timedelta(hours=10), client=fake)
    assert got[-1][1] == "NVDA - fresh" and len(fake.calls) == 1, "a warm cache is one page after the newest id"
    older = n.feed_since(now - dt.timedelta(hours=20), client=fake)
    assert len(older) == 20


def test_the_embed_names_the_window_and_says_so_when_there_is_nothing():
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    empty = n.build_embed("ZZZZ", "today", [], now)
    assert "No TradeXchange headlines on **ZZZZ**" in empty["description"]
    rows = [(now - dt.timedelta(days=d), f"headline {d}") for d in range(3)]
    e = n.build_embed("NVDA", "3d", rows, now)
    assert e["title"] == "NVDA | TradeXchange News | Last 3 days"
    assert e["description"].count("**") >= 6, "multi-day windows get a date header per day"
    assert "3 headlines" in e["footer"]["text"]


def test_a_long_list_is_cut_to_the_embed_limit_and_counts_the_rest():
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    rows = [(now - dt.timedelta(minutes=i), "x" * 120) for i in range(80)]
    e = n.build_embed("NVDA", "today", rows, now)
    assert len(e["description"]) <= 4096 and "older headline(s) not shown" in e["description"]


def test_the_job_edits_the_reply_with_the_embed_and_never_raises():
    from api.services import discord_tx_news as n
    edits = []
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    n.run_news_job("1", "t", "NVDA", "today", now=now, edit_fn=lambda a, t, p: edits.append(p),
                   feed_fn=lambda start: [(now, "NVDA - beat and raise")])
    assert edits[-1]["embeds"][0]["description"].endswith("beat and raise")

    def boom(start):
        raise RuntimeError("discord down")
    n.run_news_job("1", "t", "NVDA", "today", now=now, edit_fn=lambda a, t, p: edits.append(p), feed_fn=boom)
    assert "Could not read" in edits[-1]["content"]
