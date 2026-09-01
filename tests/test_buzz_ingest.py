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
