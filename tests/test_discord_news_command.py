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


@pytest.fixture(autouse=True)
def _a_private_feed_cache(tmp_path, monkeypatch):
    """The feed cache is kept on disk. A test must never read or write the real one, and
    must never wait out a retry."""
    from api.services import discord_tx_news as n
    monkeypatch.setenv("TX_NEWS_CACHE_PATH", str(tmp_path / "tx_news_cache.db"))
    monkeypatch.setattr(n, "_sleep", lambda s: None, raising=False)
    n._reset_for_tests()
    yield
    n._reset_for_tests()


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

def test_headlines_match_however_tx_wrote_the_ticker_and_keep_co_tickers():
    from api.services import discord_tx_news as n
    t0 = dt.datetime(2026, 10, 27, 14, 0, tzinfo=UTC)
    items = [(t0, "NVDA - Nvidia unveils new chip"),
             (t0 + dt.timedelta(minutes=5), "AMD NVDA - Both rally on AI capex"),
             (t0 + dt.timedelta(minutes=9), "TSM - Supplier to NVDA raises guide"),
             (t0 + dt.timedelta(minutes=10), "AMDpartners with NVDA on racks"),
             (t0 + dt.timedelta(minutes=11), "NVIDIA SAYS VERA CPU IN PRODUCTION AT OPENAI"),
             (t0 + dt.timedelta(minutes=12), "Fed holds rates")]
    rows = n.headlines_for("NVDA", items, "NVIDIA Corporation")
    assert [line for _, line in rows] == [
        "NVIDIA SAYS VERA CPU IN PRODUCTION AT OPENAI",     # company name, no ticker at all
        "AMDpartners with NVDA on racks",                   # typo'd headline, shown as written
        "TSM - Supplier to NVDA raises guide",              # about TSM, but names NVDA
        "Both rally on AI capex (AMD)",                     # TX's tag: dropped, co-ticker kept
        "Nvidia unveils new chip",
    ]
    assert [line for _, line in n.headlines_for("AMD", items, "Advanced Micro Devices, Inc.")] == [
        "AMDpartners with NVDA on racks", "Both rally on AI capex (NVDA)"]


def test_today_starts_at_the_previous_sessions_close():
    """⚰️ It started at 4:00 AM ET, which hid exactly what a member opens /news for: before
    the bell it left out last night's after-hours earnings, and on a Saturday it left out
    all of Friday. "Today" is the news cycle of the current session: everything since the
    session before it closed."""
    from api.services import discord_tx_news as n
    et = n.ET

    def start(*when):
        return n.window_start("today", dt.datetime(*when, tzinfo=et))
    assert start(2026, 10, 27, 9, 30) == dt.datetime(2026, 10, 26, 16, tzinfo=et)     # Tue morning: since Mon's close
    assert start(2026, 10, 27, 17, 0) == dt.datetime(2026, 10, 26, 16, tzinfo=et)     # Tue evening: same cycle
    assert start(2026, 10, 27, 2, 0) == dt.datetime(2026, 10, 23, 16, tzinfo=et)      # before 4 AM it is still Monday's
    assert start(2026, 10, 26, 7, 0) == dt.datetime(2026, 10, 23, 16, tzinfo=et)      # Mon morning: since Fri's close
    assert start(2026, 10, 31, 12, 0) == dt.datetime(2026, 10, 29, 16, tzinfo=et)     # Saturday: all of Friday too
    assert start(2026, 11, 1, 23, 0) == dt.datetime(2026, 10, 29, 16, tzinfo=et)      # Sunday night: the same
    # a holiday is not a session, and a half-day closes at 1 PM (Thanksgiving week 2026)
    assert start(2026, 11, 27, 8, 0) == dt.datetime(2026, 11, 25, 16, tzinfo=et)      # Fri after the holiday
    assert start(2026, 11, 30, 8, 0) == dt.datetime(2026, 11, 27, 13, tzinfo=et)      # Mon after the half-day
    # the other windows are rolling and did not change
    now = dt.datetime(2026, 10, 27, 9, 30, tzinfo=et)
    assert n.window_start("3d", now) == now - dt.timedelta(days=3)
    assert n.window_start("1w", now) == now - dt.timedelta(days=7)


def test_the_window_never_reaches_past_what_the_cache_keeps():
    """`feed_since` keeps WINDOW_MAX_DAYS. A "today" that started before that would be
    answered from a cache that has already dropped its first day."""
    from api.services import discord_tx_news as n
    day = dt.datetime(2026, 1, 1, 12, 0, tzinfo=n.ET)
    for i in range(400):                                   # every day of a year, holidays included
        now = day + dt.timedelta(days=i)
        back = now - n.window_start("today", now)
        assert dt.timedelta(0) < back < dt.timedelta(days=n.WINDOW_MAX_DAYS), f"{now:%Y-%m-%d}: {back}"


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


def test_a_quiet_first_read_does_not_leave_a_hole_behind_it():
    """⚰️ With nothing cached, the next read resumed from ITS OWN start while the cache went
    on claiming it covered the earlier one. Anything that arrived in between was never read,
    and a later, wider request was answered without it: no error, just missing headlines."""
    from api.services import discord_tx_news as n
    n._reset_for_tests()
    now = dt.datetime.now(UTC)
    fake = _FakeDiscord([])
    assert n.feed_since(now - dt.timedelta(hours=40), client=fake) == []          # a quiet stretch
    fake.msgs += [_msg(now - dt.timedelta(hours=20), "NVDA - arrived later"),
                  _msg(now - dt.timedelta(hours=1), "NVDA - fresh")]
    assert [t for _, t in n.feed_since(now - dt.timedelta(hours=2), client=fake)] == ["NVDA - fresh"]
    assert [t for _, t in n.feed_since(now - dt.timedelta(hours=30), client=fake)] == [
        "NVDA - arrived later", "NVDA - fresh"]


def test_the_embed_says_what_today_covers_and_what_to_do_when_it_is_empty():
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)                  # Tue 11:00 AM ET
    e = n.build_embed("NVDA", "today", [(now, "NVDA highs")], now)
    assert e["title"] == "$NVDA · UCT News · Since Mon 4:00 PM ET", "the member sees how far back it looked"
    empty = n.build_embed("NVDA", "today", [], now)
    assert empty["description"].startswith("No UCT News headlines on **$NVDA** since Mon 4:00 PM ET.")
    assert "Last 3 days" in empty["description"], "an empty today points at the wider window"
    assert "spelling" not in empty["description"]
    wide = n.build_embed("NVDA", "1w", [], now)
    assert "Last 3 days" not in wide["description"], "nothing wider to suggest"
    # a symbol no company answers to: a typo and "no news" must not read the same
    typo = n.build_embed("NVDAA", "today", [], now, known=False)
    assert "No UCT News headlines on **$NVDAA**" in typo["description"] and "spelling" in typo["description"]
    # ⛔ but never when there ARE headlines: an unnamed symbol with news is simply answered
    found = n.build_embed("XYZQ", "today", [(now, "XYZQ - halted")], now, known=False)
    assert "spelling" not in found["description"]


def test_the_job_tells_the_embed_whether_the_symbol_is_a_known_company():
    from api.services import discord_tx_news as n
    edits = []
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    for name in (None, "NVIDIA Corporation"):
        n.run_news_job("1", "t", "NVDA", "today", now=now, edit_fn=lambda a, t, p: edits.append(p),
                       feed_fn=lambda start: [], name_fn=lambda t, _n=name: _n)
    assert "spelling" in edits[0]["embeds"][0]["description"]
    assert "spelling" not in edits[1]["embeds"][0]["description"]


def test_a_class_share_is_accepted_with_a_hyphen_or_a_dot():
    """TX writes class shares with a dot (BRK.B); the dashboard's symbol list, which the
    picker reads, writes a hyphen (BRK-B). Picking the suggestion answered "Give me one
    ticker"."""
    from api.services import discord_tx_news as n
    assert n.clean_ticker_option("BRK-B") == "BRK.B" and n.clean_ticker_option("$brk.b") == "BRK.B"
    assert n.clean_ticker_option("nvda") == "NVDA"
    assert n.clean_ticker_option("not a ticker") is None and n.clean_ticker_option("") is None


def test_the_news_picker_offers_tickers_only_and_only_ones_the_command_accepts(route, monkeypatch):
    """⚰️ /news borrowed /chart's picker, so it offered breadth chart series (not stocks),
    a "NVDX - chart it" label, and BRK-B, which the command then refused."""
    client, sk, rt = route
    from api.routers import ticker_search as ts
    monkeypatch.setattr(ts, "ticker_search", lambda q, limit, type: {"results": [
        {"ticker": "BRK-B", "name": "Berkshire Hathaway Inc."}, {"ticker": "BR", "name": None},
        {"ticker": "", "name": "blank"}]})
    monkeypatch.setattr(rt, "breadth_choices", lambda q: [{"name": "UCTA5 · breadth", "value": "UCTA5"}])

    def complete(typed):
        body = {"type": 4, "application_id": "123", "token": "tok", "guild_id": UT_GUILD, "channel_id": "555",
                "member": {"user": {"id": "900"}, "roles": [VIP], "permissions": "0"},
                "data": {"name": "news", "options": [{"name": "ticker", "type": 3, "value": typed, "focused": True}]}}
        r = _post(client, sk, body).json()
        assert r["type"] == 8
        return r["data"]["choices"]
    assert complete("br") == [{"name": "BRK.B - Berkshire Hathaway Inc.", "value": "BRK.B"},
                              {"name": "BR", "value": "BR"}]
    assert complete("") == []
    # nothing matched: offer what was typed, as a ticker, with no chart wording
    monkeypatch.setattr(ts, "ticker_search", lambda q, limit, type: {"results": []})
    assert complete("$nvdx") == [{"name": "NVDX", "value": "NVDX"}]
    assert complete("not a ticker") == []


def test_the_embed_names_the_window_and_says_so_when_there_is_nothing():
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    empty = n.build_embed("ZZZZ", "today", [], now)
    assert "No UCT News headlines on **$ZZZZ**" in empty["description"]
    rows = [(now - dt.timedelta(days=d), f"headline {d}") for d in range(3)]
    e = n.build_embed("NVDA", "3d", rows, now)
    assert e["title"] == "$NVDA · UCT News · Last 3 days"
    assert e["description"].count("**") >= 6, "multi-day windows get a date header per day"
    assert "3 headlines" in e["footer"]["text"]


def test_a_long_list_is_cut_to_the_embed_limit_and_counts_the_rest():
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    rows = [(now - dt.timedelta(minutes=i), "x" * 120) for i in range(80)]
    e = n.build_embed("NVDA", "today", rows, now)
    # the first page is full and the rest CONTINUES on later pages (it used to be cut here)
    assert 3000 < len(e["description"]) <= 4096 and "not shown" not in e["description"]
    assert e["title"].endswith(" of 3)") and len(n.build_embeds("NVDA", "today", rows, now)) == 3


def test_the_job_edits_the_reply_with_the_embed_and_never_raises():
    from api.services import discord_tx_news as n
    edits = []
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    n.run_news_job("1", "t", "NVDA", "today", now=now, edit_fn=lambda a, t, p: edits.append(p),
                   feed_fn=lambda start: [(now, "NVDA - beat and raise")], name_fn=lambda t: None)
    assert edits[-1]["embeds"][0]["description"].endswith("beat and raise")

    def boom(start):
        raise RuntimeError("discord down")
    n.run_news_job("1", "t", "NVDA", "today", now=now, edit_fn=lambda a, t, p: edits.append(p), feed_fn=boom,
                   name_fn=lambda t: None)
    assert "Could not read" in edits[-1]["content"]


def test_the_reply_wears_the_uct_news_brand():
    """Same look as the UCT News cards and recaps: the UCT mark, UCT INTELLIGENCE · NEWS, UCT gold."""
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)
    e = n.build_embed("VRT", "today", [(now, "VRT highs pm")], now)
    assert e["author"]["name"] == "UCT INTELLIGENCE · NEWS" and e["author"]["icon_url"] == n.MARK_URL
    assert e["color"] == 0xDCBB5E
    assert "source TradeXchange" in e["footer"]["text"] and "#tradexchange" not in e["footer"]["text"]
    assert e["footer"]["icon_url"].endswith(".png")


def test_reads_the_raw_feed_channel_by_default(monkeypatch):
    from api.services import discord_tx_news as n
    monkeypatch.delenv("TX_NEWS_CHANNEL_ID", raising=False)
    assert n.channel_id() == "1564853978615775252"


@pytest.mark.parametrize("text, body", [
    ("ADP ADP - ADP Reports First Quarter Fiscal 2027 Results", "ADP Reports First Quarter Fiscal 2027 Results"),
    ("ADPreported Q1 2027 Adj EPS of $2.82, beating the $2.77 estimate", "Reported Q1 2027 Adj EPS of $2.82, beating the $2.77 estimate"),
    ("ADPEarnings Release: · Revenue of 5.5B exceeds estimates", "Earnings Release: · Revenue of 5.5B exceeds estimates"),
])
def test_txs_own_tag_finds_a_ticker_the_matcher_reads_as_a_word(text, body):
    """ADP is a macro word to the shared matcher; TX's own tag still names the stock."""
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)
    rows = n.headlines_for("ADP", [(now, text), (now, "ADP Employment Change: ACTUAL 120K")], None)
    assert [r[1] for r in rows] == [body]


# ── what was read is kept across restarts ────────────────────────────────────
# The web service restarts on every deploy (every 20 to 25 minutes on a busy night). The
# cache lived in the process, so most requests began by re-reading the whole window from
# Discord, 100 messages a page.

def test_what_was_read_survives_a_restart():
    from api.services import discord_tx_news as n
    now = dt.datetime.now(UTC)
    msgs = [_msg(now - dt.timedelta(hours=h), f"NVDA - item {h}") for h in range(30, 0, -1)]
    fake = _FakeDiscord(msgs)
    assert len(n.feed_since(now - dt.timedelta(hours=10), client=fake)) == 9
    newest = max(int(m["id"]) for m in msgs)
    n._reset_for_tests(disk=False)                           # the process restarts; the disk does not
    fake.calls.clear()
    fake.msgs.append(_msg(now - dt.timedelta(minutes=1), "NVDA - fresh"))
    got = n.feed_since(now - dt.timedelta(hours=10), client=fake)
    assert [t for _, t in got][-1] == "NVDA - fresh" and len(got) == 10
    assert fake.calls == [newest], "after a restart it re-read the window instead of resuming"


def test_a_full_reset_forgets_the_disk_too():
    """Control for the row above: if the restart were not what kept the items, a full
    reset would resume as well."""
    from api.services import discord_tx_news as n
    now = dt.datetime.now(UTC)
    msgs = [_msg(now - dt.timedelta(hours=h), f"NVDA - item {h}") for h in range(5, 0, -1)]
    fake = _FakeDiscord(msgs)
    n.feed_since(now - dt.timedelta(hours=10), client=fake)
    n._reset_for_tests()
    fake.calls.clear()
    n.feed_since(now - dt.timedelta(hours=10), client=fake)
    assert fake.calls[0] == n.snowflake(now - dt.timedelta(hours=10)), "a full reset must start over"


def test_a_cache_that_cannot_be_written_never_breaks_the_command(tmp_path, monkeypatch):
    from api.services import discord_tx_news as n
    blocker = tmp_path / "a-file"
    blocker.write_text("not a directory")
    monkeypatch.setenv("TX_NEWS_CACHE_PATH", str(blocker / "tx_news_cache.db"))
    n._reset_for_tests()
    now = dt.datetime.now(UTC)
    fake = _FakeDiscord([_msg(now - dt.timedelta(hours=1), "NVDA - item")])
    assert [t for _, t in n.feed_since(now - dt.timedelta(hours=5), client=fake)] == ["NVDA - item"]
    assert [t for _, t in n.feed_since(now - dt.timedelta(hours=5), client=fake)] == ["NVDA - item"]


def test_the_disk_copy_is_pruned_with_the_memory_copy(tmp_path, monkeypatch):
    """Bounded growth: the file holds what the cache holds, not everything ever read."""
    import contextlib
    import sqlite3
    from api.services import discord_tx_news as n
    now = dt.datetime.now(UTC)
    fake = _FakeDiscord([_msg(now - dt.timedelta(hours=40), "NVDA - old"), _msg(now - dt.timedelta(hours=1), "NVDA - new")])
    n.feed_since(now - dt.timedelta(hours=50), client=fake)
    path = str(tmp_path / "tx_news_cache.db")

    def on_disk():
        with contextlib.closing(sqlite3.connect(path)) as c:
            return [r[0] for r in c.execute("SELECT text FROM items ORDER BY id")]
    assert on_disk() == ["NVDA - old", "NVDA - new"]
    monkeypatch.setattr(n, "WINDOW_MAX_DAYS", 0)             # the cache now keeps one day
    n.feed_since(now - dt.timedelta(hours=2), client=fake)
    assert on_disk() == ["NVDA - new"]


# ── a brief failure is retried; one that cannot change is named ──────────────

class _Reply:
    def __init__(self, status, page=()):
        self.status_code, self._page = status, list(page)

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx
            raise httpx.HTTPStatusError(f"HTTP {self.status_code}", request=None, response=None)

    def json(self):
        return list(reversed(self._page))


class _ScriptedDiscord:
    """Answers each read with the next scripted step: an exception to raise, a status
    to return, or "ok" for the real page."""

    def __init__(self, msgs, script):
        self.msgs, self.script, self.calls = msgs, list(script), 0

    def get(self, url, params):
        self.calls += 1
        step = self.script.pop(0) if self.script else "ok"
        if isinstance(step, Exception):
            raise step
        if step != "ok":
            return _Reply(step)
        after = int(params["after"])
        return _Reply(200, sorted((m for m in self.msgs if int(m["id"]) > after), key=lambda m: int(m["id"]))[:100])


def test_a_brief_discord_failure_is_retried_and_the_member_never_sees_it():
    import httpx
    from api.services import discord_tx_news as n
    now = dt.datetime.now(UTC)
    msgs = [_msg(now - dt.timedelta(hours=1), "NVDA - item")]
    for script in ([httpx.ReadTimeout("timed out")], [503], [502, httpx.ConnectError("reset")]):
        n._reset_for_tests()
        fake = _ScriptedDiscord(msgs, script)
        assert [t for _, t in n.feed_since(now - dt.timedelta(hours=5), client=fake)] == ["NVDA - item"]


def test_a_failure_that_does_not_clear_is_raised_as_temporary():
    import httpx
    from api.services import discord_tx_news as n
    now = dt.datetime.now(UTC)
    fake = _ScriptedDiscord([], [httpx.ReadTimeout("timed out")] * 10)
    with pytest.raises(RuntimeError) as e:
        n.feed_since(now - dt.timedelta(hours=5), client=fake)
    assert not isinstance(e.value, n.NewsUnavailable) and fake.calls == 4


def test_a_refusal_that_cannot_change_is_not_retried_and_is_named():
    """403 = the bot lost access to the channel; 401 = its token is dead. Asking again
    changes nothing, and telling the member to try again in a minute is false."""
    from api.services import discord_tx_news as n
    now = dt.datetime.now(UTC)
    for status in (401, 403, 404):
        n._reset_for_tests()
        fake = _ScriptedDiscord([], [status] * 10)
        with pytest.raises(n.NewsUnavailable):
            n.feed_since(now - dt.timedelta(hours=5), client=fake)
        assert fake.calls == 1


def test_the_member_is_told_which_kind_of_failure_it_was():
    from api.services import discord_tx_news as n
    edits = []
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)

    def run(error):
        def boom(start):
            raise error
        n.run_news_job("1", "t", "NVDA", "today", now=now, edit_fn=lambda a, t, p: edits.append(p), feed_fn=boom,
                       name_fn=lambda t: None)
        return edits[-1]["content"]
    assert "Try again in a minute" in run(RuntimeError("discord read failed after 4 tries"))
    fix = run(n.NewsUnavailable("discord refused the read: HTTP 403"))
    assert "Try again" not in fix and "our side" in fix
    assert "our side" in run(n.NewsUnavailable("DISCORD_BOT_TOKEN is not set"))


def test_a_failed_edit_is_tried_once_more():
    """The reply is the only thing that ends the thinking line the member is watching."""
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    sent, answers = [], [False, True]

    def edit(a, t, p):
        sent.append(p)
        return answers.pop(0)
    n.run_news_job("1", "t", "NVDA", "today", now=now, edit_fn=edit,
                   feed_fn=lambda start: [(now, "NVDA - beat and raise")], name_fn=lambda t: None)
    assert len(sent) == 2 and sent[0] == sent[1]
    sent.clear()
    n.run_news_job("1", "t", "NVDA", "today", now=now, edit_fn=lambda a, t, p: sent.append(p) or True,
                   feed_fn=lambda start: [(now, "NVDA - beat and raise")], name_fn=lambda t: None)
    assert len(sent) == 1, "a reply that landed is not sent twice"


# ── a long list continues, privately ─────────────────────────────────────────

def _many(now, count, step_minutes=1):
    return [(now - dt.timedelta(minutes=i * step_minutes), f"headline {i:03d} " + "x" * 104) for i in range(count)]


def test_a_long_list_continues_on_more_pages_instead_of_being_cut():
    """⚰️ One embed holds about 30 headlines of this length. A busy stock over a week has
    hundreds; everything past the first embed was "not shown" and could not be reached."""
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    pages = n.build_embeds("NVDA", "1w", _many(now, 100, step_minutes=90), now)      # six days of them
    assert 1 < len(pages) <= n.MAX_PAGES
    assert all(len(p["description"]) <= 4096 for p in pages)
    shown = [ln for p in pages for ln in p["description"].split("\n") if "headline " in ln and "not shown" not in ln]
    assert len(shown) == 100 and "headline 000" in shown[0] and "headline 099" in shown[-1], "newest first, none lost"
    assert not any("not shown" in p["description"] for p in pages)
    total = len(pages)
    assert [p["title"] for p in pages] == [f"$NVDA · UCT News · Last week ({i} of {total})" for i in range(1, total + 1)]
    assert all(p["description"].startswith("**") for p in pages), "each page opens with its day"


def test_past_the_page_cap_it_says_how_many_were_left_out():
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    pages = n.build_embeds("NVDA", "1w", _many(now, 600), now)
    assert len(pages) == n.MAX_PAGES
    shown = sum(1 for p in pages for ln in p["description"].split("\n") if "headline " in ln and "not shown" not in ln)
    assert 0 < shown < 600
    assert pages[-1]["description"].endswith(f"*+{600 - shown} older headline(s) not shown*")
    assert all(len(p["description"]) <= 4096 for p in pages)


def test_a_short_list_is_one_page_with_the_plain_title():
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    pages = n.build_embeds("NVDA", "3d", _many(now, 3), now)
    assert len(pages) == 1 and pages[0]["title"] == "$NVDA · UCT News · Last 3 days"
    assert pages[0] == n.build_embed("NVDA", "3d", _many(now, 3), now)


@pytest.fixture()
def wire(monkeypatch):
    """Every request the job makes with its own client, captured off the wire."""
    import httpx
    seen: list = []
    real = httpx.Client

    def fake_client(*a, **k):
        k.pop("timeout", None)
        return real(transport=httpx.MockTransport(
            lambda request: (seen.append(request), httpx.Response(200, json={"id": "1"}))[1]))
    monkeypatch.setattr(httpx, "Client", fake_client)
    return seen


def test_every_extra_page_is_sent_privately(wire):
    """⛔ THE ONE THAT MATTERS. The feed is a paid channel. The first page is an edit of the
    deferred reply, which is private because the DEFER was. A follow-up is a NEW message
    and is public unless it says otherwise, in whatever channel the member typed in."""
    import json
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    rows = [(ts, "NVDA - " + line) for ts, line in _many(now, 100)]
    n.run_news_job("APP", "TOK", "NVDA", "1w", now=now, feed_fn=lambda start: rows, name_fn=lambda t: "NVIDIA Corporation")
    pages = n.build_embeds("NVDA", "1w", n.headlines_for("NVDA", rows, "NVIDIA Corporation"), now)
    assert len(pages) > 1, "the list fits one page, so this proved nothing"
    first, extra = wire[0], wire[1:]
    assert first.method == "PATCH" and str(first.url).endswith("/webhooks/APP/TOK/messages/@original")
    assert len(extra) == len(pages) - 1
    for req, page in zip(extra, pages[1:]):
        body = json.loads(req.content)
        assert req.method == "POST" and str(req.url).endswith("/webhooks/APP/TOK")
        assert body["flags"] == EPHEMERAL, "a page of the paid feed was posted for the whole channel"
        assert body["embeds"][0]["title"] == page["title"]


def test_a_failed_follow_up_never_replaces_the_page_that_already_landed():
    from api.services import discord_tx_news as n
    now = dt.datetime(2026, 10, 27, 15, 0, tzinfo=UTC)
    edits = []

    def followup(a, t, p):
        raise RuntimeError("discord down")
    n.run_news_job("1", "t", "NVDA", "1w", now=now, edit_fn=lambda a, t, p: edits.append(p) or True,
                   followup_fn=followup, feed_fn=lambda start: [(ts, "NVDA - " + line) for ts, line in _many(now, 100)],
                   name_fn=lambda t: None)
    assert len(edits) == 1 and edits[0]["embeds"], "the first page was overwritten by an error message"


# ── a ticker that is also a word ─────────────────────────────────────────────

def test_a_ticker_that_is_also_a_word_needs_more_than_the_word_in_capitals():
    """⚰️ /news NET listed every "... REPORTS Q3 NET INCOME ..." in the feed: in an all-caps
    headline the bare word was accepted as the ticker. When the company has a NAME to go by
    (Cloudflare, Costco), the word alone is no longer enough."""
    from api.services import discord_tx_news as n
    t0 = dt.datetime(2026, 10, 27, 14, 0, tzinfo=UTC)
    items = [(t0, "ACME CORP REPORTS Q3 NET INCOME OF $5M"),
             (t0 + dt.timedelta(minutes=1), "NET - Cloudflare launches new AI gateway"),
             (t0 + dt.timedelta(minutes=2), "CLOUDFLARE SEES Q4 REVENUE ABOVE ESTIMATES"),
             (t0 + dt.timedelta(minutes=3), "Analysts lift $NET targets after the print")]
    assert [line for _, line in n.headlines_for("NET", items, "Cloudflare, Inc.")] == [
        "Analysts lift $NET targets after the print",
        "CLOUDFLARE SEES Q4 REVENUE ABOVE ESTIMATES",
        "Cloudflare launches new AI gateway"]
    cost = [(t0, "RETAILER SEES HIGHER COST PRESSURE IN Q4"), (t0, "COSTCO SEPTEMBER COMPARABLE SALES +5.7%")]
    assert [line for _, line in n.headlines_for("COST", cost, "Costco Wholesale Corporation")] == [
        "COSTCO SEPTEMBER COMPARABLE SALES +5.7%"]


def test_the_word_rule_never_costs_a_stock_its_only_evidence():
    """Control. An ordinary ticker keeps the all-caps match, and so does a word ticker when
    there is NO company name to find it by: dropping the word there would drop the stock."""
    from api.services import discord_tx_news as n
    t0 = dt.datetime(2026, 10, 27, 14, 0, tzinfo=UTC)
    assert n.headlines_for("NBIS", [(t0, "DEAL SIGNED WITH NBIS FOR GPU CAPACITY")], "Nebius Group N.V.")
    assert n.headlines_for("NET", [(t0, "ACME CORP REPORTS Q3 NET INCOME OF $5M")], None), "no name: keep the word"
