"""Review finding #32 (unit U9, 2026-11-07): the RS Discord receipt said
`marked=True` when the session marker was not written.

With a full or read-only DATA_DIR the post lands, `FileMarker.mark` swallowed the
write error, and the receipt (and the scheduler line built from it) still said
the session was recorded. These tests pin the receipt truth and the in-process
record that stops a same-process admin call from posting the session again.
The real webhook is never called: `send` is injected throughout.
"""
from __future__ import annotations

import errno

import pytest

from api.services import rs_discord_post as rp

SESSION = "2026-11-05"
HOOK = "https://discord.test/rs"


def _row(ticker, rating):
    return {"ticker": ticker, "sector": "Technology", "rating": rating, "new_high": True,
            "before_price": False, "red_day": True, "rs_line_above": True}


ROWS = [_row(t, 99 - i) for i, t in enumerate(
    ("NVDA", "PLTR", "ANET", "AVGO", "CRWD", "APP", "VRT", "GEV", "LLY", "COST"))]


def _sender():
    calls = []

    def send(url, body):
        calls.append((url, body))
        return 204

    send.calls = calls
    return send


@pytest.fixture(autouse=True)
def _armed(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv(rp.FLAG, "1")
    monkeypatch.setenv(rp.WEBHOOK_ENV, HOOK)


def _disk_full(monkeypatch):
    def boom(*a, **k):
        raise OSError(errno.ENOSPC, "No space left on device")
    monkeypatch.setattr(rp.tempfile, "mkstemp", boom)


def test_file_marker_mark_reports_whether_it_wrote(monkeypatch, tmp_path):
    assert rp.FileMarker(tmp_path / "ok.json").mark(SESSION) is True
    _disk_full(monkeypatch)
    assert rp.FileMarker(tmp_path / "full.json").mark(SESSION) is False


def test_a_landed_post_with_an_unwritable_marker_is_not_reported_marked(monkeypatch, tmp_path):
    _disk_full(monkeypatch)
    send = _sender()
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: ROWS, send=send)
    assert len(send.calls) == 1 and r["posted"] is True
    assert r["marked"] is False, "the marker was not written; the receipt must say so"
    assert r["reason"].startswith("posted; the session marker was not recorded"), r["reason"]
    assert not (tmp_path / rp.MARKER_FILE).exists()


def test_the_same_process_does_not_post_the_unmarked_session_again(monkeypatch):
    _disk_full(monkeypatch)
    send = _sender()
    assert rp.post_rs_summary(SESSION, leaders_fn=lambda s: ROWS, send=send)["posted"] is True
    # the admin door's live, non-forced call builds a fresh FileMarker()
    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: ROWS, send=send)
    assert r["reason"] == "already posted for this session" and len(send.calls) == 1
    assert rp.FileMarker().posted(SESSION) is True
    # a different session is not blocked, and force still overrides
    assert rp.post_rs_summary("2026-11-06", leaders_fn=lambda s: ROWS, send=send)["posted"] is True
    assert rp.post_rs_summary(SESSION, leaders_fn=lambda s: ROWS, send=send, force=True)["posted"] is True
    assert len(send.calls) == 3


def test_a_later_successful_write_takes_over_from_the_in_process_record(monkeypatch):
    real = rp.tempfile.mkstemp
    _disk_full(monkeypatch)
    send = _sender()
    rp.post_rs_summary(SESSION, leaders_fn=lambda s: ROWS, send=send)
    monkeypatch.setattr(rp.tempfile, "mkstemp", real)
    r = rp.post_rs_summary("2026-11-06", leaders_fn=lambda s: ROWS, send=send)
    assert r["posted"] is True and r["marked"] is True and r["reason"] == "posted"
    assert rp.last_posted() == "2026-11-06"
    assert rp.FileMarker().posted(SESSION) is False, "the file is the record again"


def test_an_injected_dedup_that_raises_is_reported_in_the_reason():
    class _MarkFails:
        def posted(self, session):
            return False

        def mark(self, session):
            raise RuntimeError("disk full")

    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: ROWS, send=_sender(), dedup=_MarkFails())
    assert r["posted"] is True and r["marked"] is False
    assert r["reason"] == "posted; the session marker was not recorded: RuntimeError"


def test_an_injected_dedup_whose_mark_returns_none_still_reads_marked():
    """The admin door's `_NoMark` and older injected seams return None; only an
    explicit False (or a raise) means the marker was not recorded."""
    class _Quiet:
        def posted(self, session):
            return False

        def mark(self, session):
            return None

    r = rp.post_rs_summary(SESSION, leaders_fn=lambda s: ROWS, send=_sender(), dedup=_Quiet())
    assert r["posted"] is True and r["marked"] is True and r["reason"] == "posted"
