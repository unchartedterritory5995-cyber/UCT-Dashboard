"""Live sweep 2026-10-05: rows written before L5 still carried the engine's failure sentence
as the thesis, and CATH / DPTH / EVTS showed it as the catalyst. Every store reader now turns
it into thesis_text None plus a thesis_status; ticker history's direct read does the same."""
import datetime as dt

import pytest

from api.services.catalyst import store

FAILED = "Synthesis temporarily unavailable. Sources will be checked again on next refresh."
MALFORMED = "Synthesis returned malformed output. Sources will be checked again on next refresh."


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "catalysts.db"))
    store._init_db()
    with store._connect() as c:
        for i, (tk, text) in enumerate([("AAA", FAILED), ("BBB", MALFORMED), ("CCC", "Beat and raised.")]):
            c.execute("INSERT INTO catalysts (market_date, ticker, rank, tag, thesis_text) VALUES (?,?,?,?,?)",
                      ("2026-10-02", tk, i + 1, "Catalyst", text))
    return store


def test_readers_turn_the_failure_sentence_into_no_writeup(db):
    rows = {r["ticker"]: r for r in db.get_for_date("2026-10-02")}
    assert rows["AAA"]["thesis_text"] is None and rows["AAA"]["thesis_status"] == "failed"
    assert rows["BBB"]["thesis_text"] is None and rows["BBB"]["thesis_status"] == "malformed"
    assert rows["CCC"]["thesis_text"] == "Beat and raised."
    assert db.history_for_ticker("AAA")[0]["thesis_text"] is None
    assert db.get_ticker_for_date("BBB", "2026-10-02")["thesis_text"] is None


def test_a_real_thesis_that_mentions_synthesis_is_untouched():
    assert not store.is_failed_writeup("Synthesis of three catalysts: the company beat.")
    assert not store.is_failed_writeup("Synthesis pausedness")          # whole-word match only
    assert store.is_failed_writeup("  synthesis paused for the day")


def test_ticker_history_never_shows_the_sentence(db):
    from api.services import ticker_history
    rows = {r["text"] for r in ticker_history.catalysts_lane("AAA", dt.date(2026, 9, 1))}
    assert rows == {"On the catalyst list (Catalyst)"}
