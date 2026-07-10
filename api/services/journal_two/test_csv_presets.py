"""Task 7 — competitor CSV import presets (TradeZella / Tradervue / TraderSync)
+ re-import dedupe.

The golden sample files under csv_samples/ pin each product's export header row,
so a future format drift becomes a FAILING test here rather than a silent
fall-through to the generic column-mapper.
"""

import os
import sqlite3
import tempfile

import pytest

from api.services.journal_two import csv_import as imp
from api.services.journal_two.csv_import import detect_format, parse_csv
from api.services.journal_two.timeutil import compute_hour_et, compute_trading_day_et

_SAMPLES = os.path.join(os.path.dirname(__file__), "csv_samples")


def _sample(name: str) -> bytes:
    with open(os.path.join(_SAMPLES, name), "rb") as f:
        return f.read()


def _header(name: str) -> list[str]:
    return _sample(name).decode("utf-8").splitlines()[0].split(",")


# ══ Format detection on the committed golden headers ═════════════════════════

class TestDetectPresets:
    def test_detects_tradezella(self):
        assert detect_format(_header("tradezella.csv")) == "tradezella"

    def test_detects_tradersync(self):
        assert detect_format(_header("tradersync.csv")) == "tradersync"

    def test_detects_tradervue(self):
        assert detect_format(_header("tradervue.csv")) == "tradervue"

    def test_presets_are_disjoint(self):
        # Each product's header must resolve to exactly ONE preset (no bleed).
        assert detect_format(_header("tradezella.csv")) != "tradersync"
        assert detect_format(_header("tradersync.csv")) != "tradezella"

    def test_tradervue_not_confused_with_schwab(self):
        # Schwab requires an "action" column; Tradervue has none.
        assert detect_format(_header("tradervue.csv")) != "schwab"

    def test_presets_dont_regress_existing_formats(self):
        assert detect_format(["symbol", "side", "shares", "entry_price",
                              "entry_date", "exit_price", "exit_date"]) == "pre_matched"
        assert detect_format(["Date", "Action", "Symbol", "Description",
                              "Quantity", "Price", "Fees & Comm", "Amount"]) == "schwab"


# ══ TradeZella parser ════════════════════════════════════════════════════════

class TestTradeZella:
    def test_parses_all_rows(self):
        r = parse_csv(_sample("tradezella.csv"))
        assert r.format == "tradezella"
        assert r.errors == []
        assert len(r.trades) == 6

    def test_trade_shape_and_preserved_timestamp(self):
        r = parse_csv(_sample("tradezella.csv"))
        nvda = next(t for t in r.trades if t["symbol"] == "NVDA")
        assert nvda["side"] == "Long"
        assert nvda["shares"] == 100.0
        assert nvda["entryPrice"] == 500.0
        assert nvda["exitPrice"] == 520.0
        assert nvda["setup"] == "VCP"
        # 09:35 ET open time preserved → real hour_et, not date-only midnight.
        assert nvda["entryDate"].endswith("Z")
        assert "T00:00:00Z" not in nvda["entryDate"]
        assert compute_hour_et(nvda["entryDate"]) == 9
        assert compute_trading_day_et(nvda["entryDate"]) == "2026-04-01"
        assert compute_hour_et(nvda["exitDate"]) == 15

    def test_short_side_mapped(self):
        r = parse_csv(_sample("tradezella.csv"))
        tsla = next(t for t in r.trades if t["symbol"] == "TSLA")
        assert tsla["side"] == "Short"

    def test_tags_spill_into_notes(self):
        r = parse_csv(_sample("tradezella.csv"))
        amd = next(t for t in r.trades if t["symbol"] == "AMD")
        # setup = lead value; mistakes (semicolon-split) spill into a [tags: …] suffix.
        assert amd["setup"] == "Flag"
        assert "[tags:" in amd["notes"]
        assert "Late entry" in amd["notes"]
        assert "Sized too big" in amd["notes"]
        assert "Stopped out" in amd["notes"]  # original Notes preserved

    def test_custom_tag_spills_when_no_notes(self):
        r = parse_csv(_sample("tradezella.csv"))
        tsla = next(t for t in r.trades if t["symbol"] == "TSLA")
        # No Notes cell, but Custom Tags "B" → notes is JUST the [tags: …] suffix.
        assert tsla["notes"] == "[tags: B]"


# ══ TraderSync parser ════════════════════════════════════════════════════════

class TestTraderSync:
    def test_parses_all_rows(self):
        r = parse_csv(_sample("tradersync.csv"))
        assert r.format == "tradersync"
        assert r.errors == []
        assert len(r.trades) == 6

    def test_avg_entry_exit_and_us_datetime(self):
        r = parse_csv(_sample("tradersync.csv"))
        nvda = next(t for t in r.trades if t["symbol"] == "NVDA")
        assert nvda["entryPrice"] == 500.0   # Avg Entry
        assert nvda["exitPrice"] == 521.0    # Avg Exit
        assert nvda["shares"] == 100.0       # Size
        assert compute_hour_et(nvda["entryDate"]) == 9   # 04/01/2026 09:32 ET
        assert compute_trading_day_et(nvda["entryDate"]) == "2026-04-01"

    def test_short_trade(self):
        r = parse_csv(_sample("tradersync.csv"))
        coin = next(t for t in r.trades if t["symbol"] == "COIN")
        assert coin["side"] == "Short"
        assert coin["entryPrice"] == 245.0
        assert coin["exitPrice"] == 232.0


# ══ Tradervue parser (fills → FIFO) ══════════════════════════════════════════

class TestTradervue:
    def test_reconstructs_round_trips(self):
        r = parse_csv(_sample("tradervue.csv"))
        assert r.format == "tradervue"
        assert r.errors == []
        # NVDA (1) + AAPL scale-in (1) + AMD (1) = 3 round-trips.
        assert len(r.trades) == 3
        symbols = {t["symbol"] for t in r.trades}
        assert symbols == {"NVDA", "AAPL", "AMD"}

    def test_scale_in_vwap_and_preserved_times(self):
        r = parse_csv(_sample("tradervue.csv"))
        aapl = next(t for t in r.trades if t["symbol"] == "AAPL")
        assert aapl["shares"] == 100.0
        # VWAP of 50@190.50 + 50@192.00 = 191.25
        assert aapl["entryPrice"] == pytest.approx(191.25, abs=0.001)
        assert aapl["exitPrice"] == 195.25
        # Fill Date + Time preserved onto the trade's execution timestamps.
        assert compute_hour_et(aapl["entryDate"]) == 10   # 10:12:30
        assert compute_hour_et(aapl["exitDate"]) == 14     # 14:03:15


# ══ Re-import dedupe (confirm path) ══════════════════════════════════════════

@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


_SETTINGS = {"breakevenRange": {"enabled": False, "unit": "$", "value": 0}}


class TestReImportDedupe:
    @pytest.mark.parametrize("sample", ["tradezella.csv", "tradersync.csv", "tradervue.csv"])
    def test_second_import_of_same_file_dedupes(self, db_conn, sample):
        from api.services.journal_two import trades as svc

        first = parse_csv(_sample(sample)).trades
        svc.assign_csv_external_ids(first)
        out1 = svc.bulk_insert_trades("u1", first, _SETTINGS, conn=db_conn,
                                      source="csv", account_id="acct1")
        n = out1["imported"]
        assert n > 0
        assert out1["skipped"] == 0

        # Fresh parse (simulates re-uploading the identical file) → all skipped.
        second = parse_csv(_sample(sample)).trades
        svc.assign_csv_external_ids(second)
        out2 = svc.bulk_insert_trades("u1", second, _SETTINGS, conn=db_conn,
                                      source="csv", account_id="acct1")
        assert out2["imported"] == 0
        assert out2["skipped"] == n

        # No doubling in the DB.
        assert len(svc.list_trades_for_user("u1", conn=db_conn)) == n

    def test_csv_source_stamped_regime_not_nulled(self, db_conn):
        from api.services.journal_two import trades as svc
        from api.services.journal_two import regime as regime_service

        trades = parse_csv(_sample("tradezella.csv")).trades
        svc.assign_csv_external_ids(trades)
        svc.bulk_insert_trades("u1", trades, _SETTINGS, conn=db_conn,
                               source="csv", account_id="acct1")
        rows = db_conn.execute(
            "SELECT source, external_id, regime FROM j2_trades WHERE user_id = 'u1'"
        ).fetchall()
        assert all(r["source"] == "csv" for r in rows)
        assert all(r["external_id"].startswith("csv:") for r in rows)
        # source='csv' keeps regime stamping (only 'broker' force-nulls it): the
        # stored regime must equal the CURRENT regime, whatever that is here.
        current = regime_service.get_current_regime().get("regime")
        assert all(r["regime"] == current for r in rows)


class TestPreviewDupeCount:
    def test_count_zero_before_import(self, db_conn):
        from api.services.journal_two import trades as svc
        trades = parse_csv(_sample("tradezella.csv")).trades
        assert svc.count_csv_duplicates("u1", trades, conn=db_conn) == 0

    def test_count_matches_after_import(self, db_conn):
        from api.services.journal_two import trades as svc
        first = parse_csv(_sample("tradezella.csv")).trades
        svc.assign_csv_external_ids(first)
        svc.bulk_insert_trades("u1", first, _SETTINGS, conn=db_conn,
                               source="csv", account_id="acct1")

        # A fresh preview of the same file → every row flagged as a dupe.
        preview = parse_csv(_sample("tradezella.csv")).trades
        assert svc.count_csv_duplicates("u1", preview, conn=db_conn) == len(preview)
        # count is a DRY RUN — it must not stamp the preview dicts.
        assert all("externalId" not in t for t in preview)

    def test_partial_overlap_counts_only_existing(self, db_conn):
        from api.services.journal_two import trades as svc
        first = parse_csv(_sample("tradezella.csv")).trades  # 6 rows
        svc.assign_csv_external_ids(first)
        svc.bulk_insert_trades("u1", first, _SETTINGS, conn=db_conn,
                               source="csv", account_id="acct1")

        # tradersync sample shares NVDA + SMCI + AMD symbols but different
        # prices/dates → different fingerprints → NOT counted as dupes.
        other = parse_csv(_sample("tradersync.csv")).trades
        assert svc.count_csv_duplicates("u1", other, conn=db_conn) == 0


# ══ Malformed trade-level rows surface as errors, others still parse ══════════

class TestTradeLevelErrors:
    def test_missing_side_is_row_error(self):
        csv = (
            b"Open Date,Symbol,Side,Quantity,Entry Price,Exit Price,Net ROI,Close Date\n"
            b"2026-04-01,NVDA,Long,100,500,520,4.00%,2026-04-02\n"
            b"2026-04-03,AAPL,,50,190,195,2.5%,2026-04-03\n"
        )
        r = parse_csv(csv)
        assert r.format == "tradezella"
        assert len(r.trades) == 1
        assert any("side must be Long or Short" in e.message for e in r.errors)

    def test_date_only_rows_get_literal_trading_day(self):
        csv = (
            b"Open Date,Symbol,Side,Quantity,Entry Price,Exit Price,Net ROI,Close Date\n"
            b"2026-04-01,NVDA,Long,100,500,520,4.00%,2026-04-02\n"
        )
        r = parse_csv(csv)
        t = r.trades[0]
        # No time → UTC-midnight convention → literal ET day, null hour.
        assert t["entryDate"] == "2026-04-01T00:00:00Z"
        assert compute_trading_day_et(t["entryDate"]) == "2026-04-01"
        assert compute_hour_et(t["entryDate"]) is None
