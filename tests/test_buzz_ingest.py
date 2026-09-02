# tests/test_buzz_ingest.py
"""Buzz ingest: extraction wiring, bot filtering, resume, idempotency."""
from __future__ import annotations

import pytest


@pytest.fixture()
def mods(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_CHANNELS", "CH1")
    from api.services import buzz_store, buzz_ingest
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    return buzz_store, buzz_ingest


def _msg(mid, author, content, bot=False):
    return {"id": str(mid), "content": content,
            "author": {"id": author, "bot": bot}}


def test_ingest_writes_one_row_per_ticker(mods):
    store, ing = mods
    rows, newest = ing.ingest_messages("CH1", [
        _msg(1000, "alice", "$NVDA and AMD look good"),
    ])
    assert rows == 2
    assert newest == "1000"


def test_bot_messages_are_skipped(mods):
    store, ing = mods
    rows, _ = ing.ingest_messages("CH1", [_msg(1000, "botty", "$NVDA", bot=True)])
    assert rows == 0


def test_a_page_of_only_bot_messages_still_advances_the_cursor(mods):
    """Bot messages ARE processed -- they simply write no rows -- so the cursor
    must move past them. `newest` is computed BEFORE the bot check for exactly
    this reason. If it moved below the `continue`, a bot-heavy channel would
    re-fetch the same window forever and nothing else here would notice."""
    store, ing = mods
    rows, newest = ing.ingest_messages("CH1", [
        _msg(5000, "botty", "$NVDA", bot=True),
        _msg(5001, "botty", "$AMD", bot=True),
    ])
    assert rows == 0
    assert newest == "5001"


def test_poll_once_advances_past_an_all_bot_page(mods):
    """The same property through the real entry point, not just the helper."""
    store, ing = mods

    def fake_fetch(channel_id, **kw):
        return [_msg(7000, "botty", "$NVDA", bot=True)] if kw.get("after") is None else []

    out = ing.poll_once("CH1", fetch_fn=fake_fetch)
    assert out["rows"] == 0
    assert store.get_cursor("CH1") == "7000"


def test_empty_content_is_skipped(mods):
    store, ing = mods
    rows, _ = ing.ingest_messages("CH1", [_msg(1000, "alice", "")])
    assert rows == 0


def test_newest_id_is_the_max_not_the_last(mods):
    # Discord returns newest-first; never trust list order for the cursor.
    store, ing = mods
    _, newest = ing.ingest_messages("CH1", [
        _msg(3000, "a", "$NVDA"), _msg(1000, "b", "$AMD"), _msg(2000, "c", "$SPY"),
    ])
    assert newest == "3000"


def test_reingesting_the_same_messages_writes_nothing_new(mods):
    store, ing = mods
    msgs = [_msg(1000, "alice", "$NVDA")]
    assert ing.ingest_messages("CH1", msgs)[0] == 1
    assert ing.ingest_messages("CH1", msgs)[0] == 0


def test_poll_once_advances_the_cursor_only_after_writing(mods):
    store, ing = mods
    calls = []

    def fake_fetch(channel_id, *, after=None, before=None, limit=100, http=None):
        calls.append(after)
        return [_msg(5000, "alice", "$NVDA")] if after is None else []

    first = ing.poll_once("CH1", fetch_fn=fake_fetch)
    assert first["rows"] == 1
    assert store.get_cursor("CH1") == "5000"

    second = ing.poll_once("CH1", fetch_fn=fake_fetch)
    assert second["rows"] == 0
    assert calls == [None, "5000"], "second poll must resume from the stored cursor"


def test_a_write_failure_leaves_the_cursor_untouched(mods):
    """The gap-free property: if the write blows up, the next poll re-fetches
    the same window instead of skipping it."""
    store, ing = mods

    def fake_fetch(channel_id, **kw):
        return [_msg(5000, "alice", "$NVDA")]

    def boom(*a, **k):
        raise RuntimeError("disk full")

    orig = store.record_mentions
    store.record_mentions = boom
    try:
        with pytest.raises(RuntimeError):
            ing.poll_once("CH1", fetch_fn=fake_fetch)
    finally:
        store.record_mentions = orig
    assert store.get_cursor("CH1") is None


def test_a_failed_fetch_leaves_the_cursor_untouched(mods):
    store, ing = mods
    out = ing.poll_once("CH1", fetch_fn=lambda c, **kw: None)
    assert out["rows"] == 0
    assert store.get_cursor("CH1") is None


def test_backfill_walks_backwards_and_stops_at_the_cutoff(mods):
    store, ing = mods
    # snowflakes descending; the oldest is far outside the window
    pages = {
        None:     [_msg(1544451055910129726, "a", "$NVDA")],
        "1544451055910129726": [_msg(1200000000000000000, "b", "$AMD")],  # ancient
    }

    def fake_fetch(channel_id, *, after=None, before=None, limit=100, http=None):
        return pages.get(before, [])

    out = ing.backfill("CH1", days=30, fetch_fn=fake_fetch)
    assert out["rows"] >= 1
    assert out["pages"] <= 3, "must stop once messages fall outside the window"


def test_backfill_reports_truncation_when_a_fetch_fails(mods):
    """A 429 must not read as 'end of history'. The owner runs this once and
    trusts the number; a silent short-read is the worst failure shape here."""
    store, ing = mods
    pages = {None: [_msg(1544451055910129726, "a", "$NVDA")]}

    def fake_fetch(channel_id, *, after=None, before=None, limit=100, http=None):
        return pages.get(before, None)          # anything past page 1 "fails"

    out = ing.backfill("CH1", days=30, fetch_fn=fake_fetch)
    assert out["truncated"] is True
    assert out["rows"] == 1


def test_backfill_does_NOT_report_truncation_on_a_genuine_end(mods):
    """CONTROL. Without this, always returning truncated=True would also pass."""
    store, ing = mods
    pages = {None: [_msg(1544451055910129726, "a", "$NVDA")]}

    def fake_fetch(channel_id, *, after=None, before=None, limit=100, http=None):
        return pages.get(before, [])            # genuine empty
    out = ing.backfill("CH1", days=30, fetch_fn=fake_fetch)
    assert out["truncated"] is False


def test_channels_reads_the_env(mods, monkeypatch):
    _, ing = mods
    monkeypatch.setenv("BUZZ_CHANNELS", "A, B ,C")
    assert ing.channels() == ["A", "B", "C"]


def test_a_429_cannot_park_a_scheduler_slot_for_an_hour(mods, monkeypatch):
    """⛔ This sleep runs inside one of APScheduler's TEN worker slots. Discord
    or Cloudflare answers a global-limit 429 with `retry-after: 3600`, and the
    uncapped version held a slot for a full hour to then return None anyway --
    `max_instances=1` protects this job from itself, never the 140+ other jobs
    sharing the pool. The poll runs every 60s, so a longer wait buys nothing.
    """
    _, ing = mods
    slept: list[float] = []
    monkeypatch.setattr(ing.time, "sleep", lambda s: slept.append(s))
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "t")

    class _Resp:
        status_code = 429
        headers = {"retry-after": "3600"}
        is_success = False
        text = ""

    class _Http:
        def get(self, *a, **kw):
            return _Resp()

    assert ing.fetch_messages("CH1", http=_Http()) is None
    assert slept and slept[0] <= ing.MAX_RETRY_AFTER_S
    # CONTROL: a sane retry-after is honoured as given, so the cap is a CAP and
    # not a constant that ignores the server.
    slept.clear()

    class _Short(_Resp):
        headers = {"retry-after": "2"}

    class _HttpShort:
        def get(self, *a, **kw):
            return _Short()

    assert ing.fetch_messages("CH1", http=_HttpShort()) is None
    assert slept == [2.0]


def test_a_missing_bot_token_is_named_not_left_as_a_generic_401(mods, monkeypatch, caplog):
    """⛔ DISCORD_BOT_TOKEN has NO other consumer in this app, so it is the one
    variable an activation is most likely to miss. Without a named branch the
    symptom is a generic "fetch HTTP 401" every 60s behind a board that just
    looks like a quiet room — and the extractor gets blamed for a config gap.

    It must also return None, not [], or `backfill` would read the
    misconfiguration as "end of history" and report a successful short-read.
    """
    import logging
    _, ing = mods
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)

    class _NeverCalled:
        def get(self, *a, **kw):
            raise AssertionError("must not reach Discord without a token")

    with caplog.at_level(logging.WARNING):
        assert ing.fetch_messages("CH1", http=_NeverCalled()) is None
    assert "DISCORD_BOT_TOKEN" in caplog.text

    # CONTROL: with a token set, the guard is out of the way and the request
    # is actually attempted — so this cannot pass by refusing everything.
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "tok")
    reached = []

    class _Ok:
        def get(self, *a, **kw):
            reached.append(1)
            class _R:
                status_code = 200
                is_success = True
                text = ""
                headers: dict = {}

                @staticmethod
                def json():
                    return []
            return _R()

    assert ing.fetch_messages("CH1", http=_Ok()) == []
    assert reached == [1]


def test_a_truncated_backfill_RESUMES_instead_of_restarting(mods):
    """⛔ THE BUG THIS FILE EXISTS TO PREVENT REPEATING. `backfill` set
    `before = None` every run, so the walk always restarted from the NEWEST
    message. On #main-chat (~1,100 messages/day) one rate limit at page 11
    capped it at ~14 hours of history, and every re-run re-walked those same
    pages and stopped in the same place -- five consecutive runs, four adding
    zero new mentions, while the tool printed "re-run to continue".

    Here page 2 fails. The second call must ask for messages BEFORE where the
    first one stopped, not from the top again.
    """
    store, ing = mods
    seen_before: list = []
    # ids descend as we walk back; the second page fails the first time.
    pages = {
        None: [_msg(1544451055910129726, "a", "$NVDA")],
        "1544451055910129726": None,          # rate limited
    }

    def fake_fetch(channel_id, *, after=None, before=None, limit=100, http=None):
        seen_before.append(before)
        return pages.get(before, [])

    first = ing.backfill("CH1", days=30, fetch_fn=fake_fetch)
    assert first["truncated"] is True
    assert seen_before == [None, "1544451055910129726"]

    # The watermark survives the failed run.
    assert store.get_backfill_mark("CH1") == "1544451055910129726"

    # Second run: the page that failed now succeeds and ends the history.
    pages["1544451055910129726"] = []
    seen_before.clear()
    second = ing.backfill("CH1", days=30, fetch_fn=fake_fetch)
    assert second["truncated"] is False
    # ⛔ THE assertion: it did NOT ask for the top of the channel again.
    assert seen_before == ["1544451055910129726"], seen_before


def test_restart_walks_from_the_newest_again(mods):
    """CONTROL for the test above: without this, a backfill that could never
    start over would also satisfy 'it resumed'."""
    store, ing = mods
    store.set_backfill_mark("CH1", "1544451055910129726")
    seen_before: list = []

    def fake_fetch(channel_id, *, after=None, before=None, limit=100, http=None):
        seen_before.append(before)
        return []

    ing.backfill("CH1", days=30, fetch_fn=fake_fetch, restart=True)
    assert seen_before == [None]
    assert store.get_backfill_mark("CH1") is None


def test_a_resumed_run_never_plants_an_ancient_forward_cursor(mods):
    """The forward cursor is where the 60s poller reads FROM. A resumed
    backfill starts deep in the past, so seeding the cursor with its newest
    seen id would make the next poll re-fetch weeks of history 100 messages at
    a time."""
    store, ing = mods
    store.set_backfill_mark("CH1", "1544451055910129726")

    def fake_fetch(channel_id, *, after=None, before=None, limit=100, http=None):
        if before == "1544451055910129726":
            return [_msg(1200000000000000000, "b", "$AMD")]
        return []

    assert store.get_cursor("CH1") is None
    ing.backfill("CH1", days=30, fetch_fn=fake_fetch)
    assert store.get_cursor("CH1") is None, "a resumed walk must not seed the forward cursor"
