"""Earnings context: last-report move (wire_prints), implied move + setup
grade (implied_store) — two separately-registered readers, each honest on a
dead/empty source and silent (key absent) for a symbol the source genuinely
has nothing on."""
import sqlite3

from api.services.screener import earnings_context


# ── read_last_report_move — api.services.wire.store's own _connect seam ────

def _wire_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE wire_prints (market_date TEXT, sym TEXT, "
        "peak_move_pct REAL, first_seen_at REAL)"
    )
    return conn


def test_last_report_move_latest_print_wins(monkeypatch):
    from api.services.wire import store as wire_store
    conn = _wire_conn()
    conn.execute("INSERT INTO wire_prints VALUES ('2026-07-31','NVDA',6.4,1000.0)")
    conn.execute("INSERT INTO wire_prints VALUES ('2026-08-01','NVDA',9.2,2000.0)")
    conn.execute("INSERT INTO wire_prints VALUES ('2026-07-31','AMD',3.1,1500.0)")
    conn.commit()
    monkeypatch.setattr(wire_store, "_connect", lambda: conn)

    out = earnings_context.read_last_report_move(["NVDA", "AMD", "MSFT"])

    assert out["NVDA"] == {"last_report_move_pct": 9.2}
    assert out["AMD"] == {"last_report_move_pct": 3.1}
    assert "MSFT" not in out  # store only holds prints since ~2026-07-30 -- honest absence


def test_last_report_move_dead_store_is_noted_and_empty(monkeypatch):
    from api.services.wire import store as wire_store

    def boom():
        raise RuntimeError("no db")

    monkeypatch.setattr(wire_store, "_connect", boom)
    fails = {}
    assert earnings_context.read_last_report_move(["NVDA"], failures=fails) == {}
    assert "RuntimeError" in fails["wire_last_report_move"]


def test_last_report_move_empty_store_is_noted(monkeypatch):
    from api.services.wire import store as wire_store
    conn = _wire_conn()
    monkeypatch.setattr(wire_store, "_connect", lambda: conn)
    fails = {}
    assert earnings_context.read_last_report_move(["NVDA"], failures=fails) == {}
    assert fails["wire_last_report_move"]["empty"] == 1


def test_last_report_move_null_peak_stays_not_computable(monkeypatch):
    """A print row whose peak_move_pct is NULL must not surface as 0.0."""
    from api.services.wire import store as wire_store
    conn = _wire_conn()
    conn.execute("INSERT INTO wire_prints VALUES ('2026-08-01','GOOG',NULL,2000.0)")
    conn.commit()
    monkeypatch.setattr(wire_store, "_connect", lambda: conn)
    out = earnings_context.read_last_report_move(["GOOG"])
    assert out == {}


def test_last_report_move_zero_floor_stays_not_computable(monkeypatch):
    """0.0 is detect.py's MIN_MOVE_PCT/liquidity/no-data FLOOR (live_peak =
    abs(mv) if (mv is not None and moved) else 0.0, moved requiring >=2% AND
    liquidity), never a measured flat -- three facts in one sentinel must stay
    not-computable. A genuine non-floor move (2.4, above MIN_MOVE_PCT) still
    passes through untouched."""
    from api.services.wire import store as wire_store
    conn = _wire_conn()
    conn.execute("INSERT INTO wire_prints VALUES ('2026-08-01','META',0.0,2000.0)")
    conn.execute("INSERT INTO wire_prints VALUES ('2026-08-01','AAPL',2.4,2000.0)")
    conn.commit()
    monkeypatch.setattr(wire_store, "_connect", lambda: conn)
    out = earnings_context.read_last_report_move(["META", "AAPL"])
    assert "META" not in out  # the floor sentinel -- not a measured 0% move
    assert out["AAPL"] == {"last_report_move_pct": 2.4}


# ── read_implied_context — implied_store's public reads + its _connect seam ─

def _grade_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE grade_snapshots (sym TEXT, date TEXT, surface TEXT, "
        "grade TEXT, inputs_json TEXT)"
    )
    return conn


def test_implied_context_reporters_get_move_and_latest_grade(monkeypatch):
    from api.services import implied_store, setup_grade

    monkeypatch.setattr(
        implied_store, "upcoming_reporters",
        lambda days=14, now=None: [
            {"sym": "NVDA", "report_date": "2026-08-22"},
            {"sym": "AMD", "report_date": "2026-08-23"},
            {"sym": "SBUX", "report_date": "2026-09-30"},  # a real reporter, just not a target
        ])

    by_date = {"2026-08-22": {"NVDA": 8.5}, "2026-08-23": {"AMD": 5.0}}
    monkeypatch.setattr(implied_store, "get_implied_for_date",
                        lambda report_date: by_date.get(report_date, {}))

    conn = _grade_conn()
    conn.execute("INSERT INTO grade_snapshots VALUES ('NVDA','2026-08-20',?,'B+','{}')",
                 (setup_grade.SURFACE,))
    conn.execute("INSERT INTO grade_snapshots VALUES ('NVDA','2026-08-21',?,'A-','{}')",
                 (setup_grade.SURFACE,))  # newer date -- must win over the row above
    conn.commit()
    monkeypatch.setattr(implied_store, "_connect", lambda: conn)

    out = earnings_context.read_implied_context(["NVDA", "AMD", "TSLA"])

    assert out["NVDA"] == {"implied_move_pct": 8.5, "earnings_setup_grade": "A-"}
    assert out["AMD"] == {"implied_move_pct": 5.0}   # no grade row for AMD -- key absent
    assert "TSLA" not in out                          # not a reporter within the window
    assert "SBUX" not in out                          # a reporter, but not one of our targets


def test_implied_context_dead_reporter_list_is_noted_and_empty(monkeypatch):
    from api.services import implied_store

    def boom(days=14, now=None):
        raise RuntimeError("no provider")

    monkeypatch.setattr(implied_store, "upcoming_reporters", boom)
    fails = {}
    assert earnings_context.read_implied_context(["NVDA"], failures=fails) == {}
    assert "RuntimeError" in fails["implied_upcoming_reporters"]


def test_implied_context_empty_reporter_list_is_noted(monkeypatch):
    from api.services import implied_store
    monkeypatch.setattr(implied_store, "upcoming_reporters", lambda days=14, now=None: [])
    fails = {}
    assert earnings_context.read_implied_context(["NVDA"], failures=fails) == {}
    assert fails["implied_upcoming_reporters"]["empty"] == 1


def test_implied_context_dead_grade_leg_still_yields_the_move(monkeypatch):
    """One leg dies alone -- the other still answers (mirrors read_etf_flags)."""
    from api.services import implied_store

    monkeypatch.setattr(
        implied_store, "upcoming_reporters",
        lambda days=14, now=None: [{"sym": "NVDA", "report_date": "2026-08-22"}])
    monkeypatch.setattr(implied_store, "get_implied_for_date",
                        lambda report_date: {"NVDA": 8.5})

    def boom():
        raise RuntimeError("no grade db")

    monkeypatch.setattr(implied_store, "_connect", boom)

    fails = {}
    out = earnings_context.read_implied_context(["NVDA"], failures=fails)
    assert out["NVDA"] == {"implied_move_pct": 8.5}  # no earnings_setup_grade key
    assert "RuntimeError" in fails["implied_grade_snapshots"]


def test_implied_context_one_bad_date_does_not_blank_the_others(monkeypatch):
    """get_implied_for_date raising for one report_date must not cost every
    other date's reporters."""
    from api.services import implied_store

    monkeypatch.setattr(
        implied_store, "upcoming_reporters",
        lambda days=14, now=None: [
            {"sym": "NVDA", "report_date": "2026-08-22"},
            {"sym": "AMD", "report_date": "2026-08-23"},
        ])

    def flaky(report_date):
        if report_date == "2026-08-22":
            raise RuntimeError("chain read failed")
        return {"AMD": 5.0}

    monkeypatch.setattr(implied_store, "get_implied_for_date", flaky)

    conn = _grade_conn()
    monkeypatch.setattr(implied_store, "_connect", lambda: conn)

    fails = {}
    out = earnings_context.read_implied_context(["NVDA", "AMD"], failures=fails)
    assert "NVDA" not in out  # its date's implied fetch died -- no key, never a guess
    assert out["AMD"] == {"implied_move_pct": 5.0}
    assert "RuntimeError" in fails["implied_get_for_date"]
