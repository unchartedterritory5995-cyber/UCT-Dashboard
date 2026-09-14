"""The alias pass and the spoken-price sanity pass (W1 §3.5, §4.3; manifest §4.8, R9).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an owner-ruled alias not applied: "light" -> LITE beside a price, "Bryan Shannon" /
   "Brian Chanan" -> "Brian Shannon", "300 chairs" -> "300 shares";
2. an alias applied where its context says no ("light volume") — a manufactured ticker;
3. the raw text lost: every correction carries the raw value and raw offsets that rebuild it;
4. an unapproved seed firing, or re-seeding overwriting an owner's edit;
5. a price rescaled when the value as said is plausible (610 / 604 near $600), left alone when
   only one rescale fits (1240 near $12 -> 12.40), or GUESSED when two readings fit or none does;
6. a correction not logged to wisdom_stt_corrections, or logged twice on a re-run.
Every price and sentence here is illustrative; none is a level or a line any author said
(W1 §0.4f: no transcript text or private levels in git).
"""
from __future__ import annotations

from datetime import date, datetime

import pytest

from api.services.wisdom.core import aliases, store, stt

SESSION = date(2026, 9, 11)


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    aliases.clear_cache()
    yield tmp_path
    aliases.clear_cache()


def _rebuild(raw: str, corrections: list[dict]) -> str:
    out, cursor = [], 0
    for c in corrections:
        out.append(raw[cursor:c["start"]])
        out.append(c["normalized_value"])
        cursor = c["end"]
    out.append(raw[cursor:])
    return "".join(out)


# ── 1-3. the owner's rulings, their context, and the raw text ────────────────

@pytest.mark.parametrize("raw,expected", [
    ("watching light at 1240 into the close", "watching LITE at 1240 into the close"),
    ("bought some light calls into the close", "bought some LITE calls into the close"),
    ("that Bryan Shannon special on SPY", "that Brian Shannon special on SPY"),
    ("the Brian Chanan setup again", "the Brian Shannon setup again"),
    ("bought 300 chairs of AMD", "bought 300 shares of AMD"),
    ("took chairs of NVDA", "took shares of NVDA"),
])
def test_the_owner_rulings_are_applied(wisdom_db, raw, expected):
    text, corrections = aliases.apply_aliases(raw)
    assert text == expected
    assert corrections and all(raw[c["start"]:c["end"]] == c["raw_value"] for c in corrections)
    assert _rebuild(raw, corrections) == text


@pytest.mark.parametrize("raw", [
    "light volume today in NVDA",
    "the light at the end of the tunnel",
    "pull up some chairs and watch",
    "LITE at 1240 is already a ticker",
    "lightning fast tape",
])
def test_an_alias_does_not_fire_where_its_context_says_no(wisdom_db, raw):
    assert aliases.apply_aliases(raw) == (raw, [])


def test_unapproved_seeds_are_staged_not_applied(wisdom_db):
    raw = "the Brian Chan special in bitcoin at 60000"
    assert aliases.apply_aliases(raw) == (raw, [])
    with store.read() as conn:
        staged = {r["alias"]: r["approved"] for r in conn.execute("SELECT alias, approved FROM wisdom_ticker_aliases")}
    assert staged["bitcoin"] == 0 and staged["light"] == 1  # control: the seeds are really there


def test_reseeding_never_overwrites_an_owner_edit_and_an_owner_row_fires(wisdom_db):
    aliases.load_aliases()  # seeds
    with store.write() as conn:
        conn.execute("UPDATE wisdom_ticker_aliases SET approved = 0 WHERE alias = 'light'")
        conn.execute("INSERT INTO wisdom_ticker_aliases(alias, scope, ticker, approved, context_rule) "
                     "VALUES ('lumentum', 'company_name', 'LITE', 1, 'none')")
    aliases.clear_cache()
    assert aliases.seed()["ticker_aliases_inserted"] == 0
    text, _ = aliases.apply_aliases("light at 1240 and lumentum later")
    assert text == "light at 1240 and LITE later"


def test_an_unreadable_alias_table_falls_back_to_the_approved_seeds(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "never_initialised.db"))
    aliases.clear_cache()
    table = aliases.load_aliases()
    assert table["source"] == "built-in seeds"
    assert aliases.apply_aliases("light at 1240")[0] == "LITE at 1240"
    aliases.clear_cache()


def test_ticker_for_alias_is_exact_and_approved_only(wisdom_db):
    assert aliases.ticker_for_alias("Light") == "LITE"
    assert aliases.ticker_for_alias("lite") is None
    assert aliases.ticker_for_alias("bitcoin") is None


def test_alias_corrections_are_logged_once_per_occurrence(wisdom_db):
    raw = "light at 1240, then light at 12.50"
    aliases.apply_aliases(raw, segment_id="seg-a", record_id="rec-a")
    aliases.apply_aliases(raw, segment_id="seg-a", record_id="rec-a")  # a re-run
    with store.read() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT kind, raw_value, normalized_value, rule, record_id FROM wisdom_stt_corrections ORDER BY rule")]
    assert len(rows) == 2
    assert {r["kind"] for r in rows} == {"ticker_alias"} and {r["normalized_value"] for r in rows} == {"LITE"}
    assert all(r["rule"].startswith("asr:light@") and r["record_id"] == "rec-a" for r in rows)


# ── 5-6. the spoken-price sanity pass ────────────────────────────────────────

def _band(low, high):
    return lambda ticker, session: (low, high)


@pytest.mark.parametrize("raw,band,value,status", [
    ("1240", (12.1, 12.9), 12.4, "rescaled"),     # near $12: only /100 is plausible
    (1240, (12.1, 12.9), 12.4, "rescaled"),
    ("610", (600.0, 640.0), 610.0, "kept"),       # near $600: as said is plausible
    ("604", (600.0, 640.0), 604.0, "kept"),
    ("12.40", (12.1, 12.9), 12.4, "kept"),        # said with a decimal point: never rescaled
    ("$1,250", (1200.0, 1300.0), 1250.0, "kept"),
])
def test_a_spoken_price_is_kept_or_rescaled_against_its_bars(raw, band, value, status):
    got, correction = stt.normalize_price(raw, "LITE" if band[0] < 50 else "AMD", SESSION, _band(*band))
    assert (got, correction["status"]) == (value, status)
    assert correction["raw_value"] == str(raw) and correction["bar_date"] == "2026-09-11"


@pytest.mark.parametrize("raw,band,status", [
    ("300", (4.0, 50.0), "ambiguous"),          # 30 and 3 both plausible: never pick one
    ("5", (100.0, 110.0), "out_of_range"),
    ("12.40", (100.0, 110.0), "out_of_range"),
])
def test_no_unambiguous_reading_keeps_the_raw_and_returns_none(raw, band, status):
    got, correction = stt.normalize_price(raw, "XYZ", SESSION, _band(*band))
    assert got is None and correction["status"] == status and correction["confidence"] == "low"


def test_no_bars_unparseable_and_a_failing_reader_never_guess():
    assert stt.normalize_price("1240", "LITE", SESSION, lambda t, s: None)[1]["status"] == "no_bars"
    assert stt.normalize_price("twelve forty", "LITE", SESSION, _band(12, 13))[1]["status"] == "unparseable"

    def boom(ticker, session):
        raise RuntimeError("bars.db locked")

    assert stt.normalize_price("1240", "LITE", SESSION, boom) == (None, stt.normalize_price("1240", "LITE", SESSION, boom)[1])
    assert stt.normalize_price("1240", "", SESSION, _band(12, 13))[1]["status"] == "no_context"


def test_price_corrections_are_logged_with_raw_and_normalized_and_only_once(wisdom_db):
    stt.normalize_price("1240", "LITE", SESSION, _band(12.1, 12.9), segment_id="seg-p", record_id="rec-p")
    stt.normalize_price("1240", "LITE", SESSION, _band(12.1, 12.9), segment_id="seg-p", record_id="rec-p")
    stt.normalize_price("300", "XYZ", SESSION, _band(4.0, 50.0), segment_id="seg-p")
    stt.normalize_price("610", "AMD", SESSION, _band(600.0, 640.0), segment_id="seg-p")  # kept: not a correction
    with store.read() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT raw_value, normalized_value, rule, bar_date FROM wisdom_stt_corrections ORDER BY raw_value")]
    assert rows == [
        {"raw_value": "1240", "normalized_value": "12.4", "rule": "price_sanity_v1:/100", "bar_date": "2026-09-11"},
        {"raw_value": "300", "normalized_value": None, "rule": "price_sanity_v1:ambiguous", "bar_date": "2026-09-11"},
    ]


@pytest.mark.parametrize("rows,expected", [
    ([(20260909, 12, 12.8, 12.2, 12.5, 1), (20260911, 12.5, 12.9, 12.1, 12.3, 1)], (12.1, 12.9)),
    ([(20260830, 12, 12.8, 12.2, 12.5, 1)], None),        # stale: 12 days before the session
    ([(20260914, 12, 12.8, 12.2, 12.5, 1)], None),        # after the session: never read the future
    ([(20260911, 0, 0, 0, 0, 0)], None),
    ([], None),
])
def test_the_band_is_read_from_recent_bars_only(rows, expected):
    assert stt.band_from_rows(rows, SESSION) == expected


def test_the_default_reader_asks_bars_sqlite_for_the_session_window(monkeypatch):
    from api.services import bars_sqlite

    calls = []

    def fake(ticker, tf, max_bars, to_key):
        calls.append((ticker, tf, max_bars, to_key))
        return [(20260911, 12.5, 12.9, 12.1, 12.3, 100)]

    monkeypatch.setattr(bars_sqlite, "get_bars_before", fake)
    assert stt.normalize_price("1240", "lite", datetime(2026, 9, 11, 10, 30), None)[0] == 12.4
    assert calls == [("LITE", "D", stt.BAND_SESSIONS, 20260911)]


def test_an_unknown_correction_kind_is_refused(wisdom_db):
    with pytest.raises(ValueError):
        stt.log_corrections("seg-x", [{"kind": "guess", "raw_value": "1", "rule": "r"}])
