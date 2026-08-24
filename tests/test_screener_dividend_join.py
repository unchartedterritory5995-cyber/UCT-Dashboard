"""`dividend_join` — the payment ledger, and the four ways it refuses.

Every test here builds its OWN sqlite file under `tmp_path` and points
`breadth_dividends.DB_PATH` at it. Nothing reaches `C:\\data` (the repo-root
conftest's tripwire would record it if it did).

⛔⛔ **THE LOAD-BEARING DISTINCTION IS 0 vs ABSENT.** A ticker with a payment
history and nothing in the trailing year is a measured `div_ttm_cash = 0.0` —
we have its ledger and the answer is genuinely nothing. A ticker with no
payment on record is ABSENT from the reader's output entirely, so every column
reads NULL downstream. Fabricating a 0 for the second case would hand a member
sorting by trailing dividend ~1,700 `cap_universe` symbols we simply never
saw, under a column that claims to have looked.

⛔ **AND THERE IS NO FORWARD EX-DATE HERE, BY CONSTRUCTION.** The store's
writer requests `ex_dividend_date.lte=<today>`, so a "next ex-date" column
would be an extrapolation, and `dividends_calendar.py` already owns that fact
anyway. `test_no_forward_or_yield_shaped_column_is_ever_emitted` is the rail.

The as-of of every window is `MAX(ex_date)` READ FROM THE DATA, never the
clock; `test_no_emitted_number_moves_when_the_clock_moves` pins it, so a stale
store answers correctly about the period it covers instead of wrongly about
today.
"""
import datetime
import sqlite3

import pytest

# The store's as-of in every fixture below (the newest ex_date present).
_AS_OF = 20260810
_AS_OF_DATE = datetime.date(2026, 8, 10)
#: two days later -> comfortably inside `_STALE_DAYS`, so freshness is never
#: the thing under test unless a test says so.
_NOW = datetime.date(2026, 8, 12)

_SCHEMA = """CREATE TABLE dividends (
                 ticker  TEXT    NOT NULL,
                 ex_date INTEGER NOT NULL,
                 cash    REAL    NOT NULL,
                 PRIMARY KEY (ticker, ex_date))"""
#: Same table WITHOUT the constraints — a corrupted or hand-altered store.
#: A reader that trusts a NOT NULL declaration is one bad row from taking the
#: nightly build down.
_SCHEMA_LOOSE = "CREATE TABLE dividends (ticker, ex_date, cash)"


def _ymd(y, m, d):
    return y * 10000 + m * 100 + d


#: Pins `MIN(ex_date)` at or before the 730-day span start so the prior-year
#: coverage gate is satisfied; mirrors the live store (min 20240601 vs a
#: span start of 20240810). `_uncovered` drops it.
_COVER = ("COVER", _ymd(2024, 6, 1), 0.10)
#: Pins `MAX(ex_date)`, hence the as-of, independently of any ticker a test
#: actually screens.
_ANCHOR = ("ANCHOR", _AS_OF, 0.10)

#: A textbook quarterly payer that raised 0.50 -> 0.55.
_CLEAN = [
    ("CLEAN", _ymd(2024, 9, 10), 0.50), ("CLEAN", _ymd(2024, 12, 10), 0.50),
    ("CLEAN", _ymd(2025, 3, 10), 0.50), ("CLEAN", _ymd(2025, 6, 10), 0.50),
    ("CLEAN", _ymd(2025, 9, 10), 0.55), ("CLEAN", _ymd(2025, 12, 10), 0.55),
    ("CLEAN", _ymd(2026, 3, 10), 0.55), ("CLEAN", _ymd(2026, 6, 10), 0.55),
]
#: Paid all through the prior year, nothing since — the lapsed payer.
_LAPSED = [
    ("LAPSED", _ymd(2024, 9, 15), 0.30), ("LAPSED", _ymd(2024, 12, 15), 0.30),
    ("LAPSED", _ymd(2025, 3, 15), 0.30), ("LAPSED", _ymd(2025, 6, 15), 0.30),
]
#: Quarterly 0.10 plus a 5.00 one-off inside the TTM window.
_SPECIAL = [
    ("SPECIAL", _ymd(2024, 9, 20), 0.10), ("SPECIAL", _ymd(2024, 12, 20), 0.10),
    ("SPECIAL", _ymd(2025, 3, 20), 0.10), ("SPECIAL", _ymd(2025, 6, 20), 0.10),
    ("SPECIAL", _ymd(2025, 9, 20), 0.10), ("SPECIAL", _ymd(2025, 12, 20), 0.10),
    ("SPECIAL", _ymd(2026, 1, 5), 5.00),
    ("SPECIAL", _ymd(2026, 3, 20), 0.10), ("SPECIAL", _ymd(2026, 6, 20), 0.10),
]
#: Two payments in twenty-four months: no cadence is inferable and no median
#: is worth screening against.
_THIN = [
    ("THIN", _ymd(2025, 5, 2), 1.00), ("THIN", _ymd(2026, 5, 2), 1.10),
]

_BASE = [_COVER, _ANCHOR] + _CLEAN + _LAPSED + _SPECIAL + _THIN


def _make_db(tmp_path, rows, schema=_SCHEMA, name="breadth_dividends.db"):
    path = tmp_path / name
    con = sqlite3.connect(str(path))
    con.execute(schema)
    con.executemany("INSERT INTO dividends VALUES (?,?,?)", rows)
    con.commit()
    con.close()
    return str(path)


@pytest.fixture
def dj(monkeypatch):
    """The module under test, with its clock frozen and nothing else faked."""
    from api.services.screener import dividend_join as _dj
    monkeypatch.setattr(_dj, "_today", lambda: _NOW)
    return _dj


def _point_at(monkeypatch, path):
    from api.services import breadth_dividends
    monkeypatch.setattr(breadth_dividends, "DB_PATH", path)


def _read(dj, monkeypatch, tmp_path, targets, rows=None, **kw):
    _point_at(monkeypatch, _make_db(tmp_path, _BASE if rows is None else rows, **kw))
    failures = {}
    return dj.read_dividend_fields(targets, failures=failures), failures


# ───────────────────────── the happy path ────────────────────────────────

def test_the_happy_path_reports_every_dividend_fact_a_ledger_can_support(
        dj, monkeypatch, tmp_path):
    out, failures = _read(dj, monkeypatch, tmp_path, ["CLEAN"])
    row = out["CLEAN"]

    assert row["div_last_ex_date"] == "2026-06-10"
    # anchored to the STORE's as-of (2026-08-10), not to `_NOW`.
    assert row["div_days_since_ex"] == (_AS_OF_DATE - datetime.date(2026, 6, 10)).days
    assert row["div_ttm_cash"] == pytest.approx(2.20)
    assert row["div_payments_ttm"] == 4
    assert row["div_growth_1y_pct"] == pytest.approx(10.0)
    assert row["div_frequency"] == "quarterly"
    assert row["div_ttm_outlier"] == 0
    assert failures.get("dividend_join", {}).get("stale") is None


def test_the_emitted_key_set_is_exactly_the_seven_declared_columns(
        dj, monkeypatch, tmp_path):
    out, _ = _read(dj, monkeypatch, tmp_path, ["CLEAN"])
    assert set(out["CLEAN"]) == {
        "div_last_ex_date", "div_days_since_ex", "div_ttm_cash",
        "div_payments_ttm", "div_growth_1y_pct", "div_frequency",
        "div_ttm_outlier",
    }


def test_no_forward_or_yield_shaped_column_is_ever_emitted(
        dj, monkeypatch, tmp_path):
    """Two refusals in one rail. The store holds no ex-date later than the
    sweep date, so a forward column would be extrapolation; and both a
    forward calendar (`dividends_calendar`) and a yield (`dividend_yield`,
    Finviz) already have writers. Second authority over one value is this
    repo's most repeated defect."""
    out, _ = _read(dj, monkeypatch, tmp_path,
                   ["CLEAN", "LAPSED", "SPECIAL", "THIN"])
    banned = ("next", "upcoming", "forward", "yield", "payout", "streak",
              "cagr", "days_to_ex", "until")
    for ticker, row in out.items():
        for key in row:
            assert not any(b in key for b in banned), f"{ticker}.{key}"
        # every date fact points backwards from the store's own as-of
        assert row["div_days_since_ex"] >= 0
        assert row["div_last_ex_date"] <= _AS_OF_DATE.isoformat()


def test_the_column_names_collide_with_no_existing_snapshot_column(dj):
    from api.services.screener import snapshot_db
    mine = {"div_last_ex_date", "div_days_since_ex", "div_ttm_cash",
            "div_payments_ttm", "div_growth_1y_pct", "div_frequency",
            "div_ttm_outlier"}
    assert mine.isdisjoint(set(snapshot_db.COLUMNS))


# ───────────── 0 vs ABSENT — the whole honesty of this reader ─────────────

def test_a_symbol_absent_from_the_store_is_omitted_never_zeroed(
        dj, monkeypatch, tmp_path):
    out, failures = _read(dj, monkeypatch, tmp_path, ["CLEAN", "NOPAY"])
    assert "NOPAY" not in out, \
        "a symbol with no payment on record must carry NO keys, not a row of zeros"
    assert "CLEAN" in out
    # ...and the omission is COUNTED: an uncounted refusal is indistinguishable
    # from an empty answer, and only the ratio tells a dead source from a
    # universe of genuine non-payers.
    assert failures["dividend_join"]["no_history"] == 1


def test_a_payer_that_stopped_reports_a_measured_zero_beside_that_absence(
        dj, monkeypatch, tmp_path):
    """The contrast, in one test, because the two states are one decision.

    LAPSED has a ledger and paid nothing in the trailing year -> a real 0.0.
    NOPAY has no ledger -> no keys at all. Collapse them and a member can no
    longer tell "this company cut its dividend" from "we have no idea"."""
    out, _ = _read(dj, monkeypatch, tmp_path, ["LAPSED", "NOPAY"])

    assert out["LAPSED"]["div_ttm_cash"] == 0.0
    assert out["LAPSED"]["div_payments_ttm"] == 0
    # a payer that went to nothing is the one growth answer no split and no
    # special can fake, so it ships past every other gate
    assert out["LAPSED"]["div_growth_1y_pct"] == pytest.approx(-100.0)
    assert out["LAPSED"]["div_last_ex_date"] == "2025-06-15"
    assert out["LAPSED"]["div_days_since_ex"] > 365

    assert "NOPAY" not in out


def test_a_thin_history_refuses_cadence_and_the_outlier_flag(
        dj, monkeypatch, tmp_path):
    """Two payments is a coincidence, not a schedule, and gives no median
    worth screening against. Both keys are ABSENT — not 'irregular', not 0."""
    out, _ = _read(dj, monkeypatch, tmp_path, ["THIN"])
    row = out["THIN"]
    assert "div_frequency" not in row
    assert "div_ttm_outlier" not in row
    # the facts a two-payment ledger CAN support are still there
    assert row["div_ttm_cash"] == pytest.approx(1.10)
    assert row["div_payments_ttm"] == 1


# ─────────────────────── cadence, from observed spacing ──────────────────

@pytest.mark.parametrize("label,step_days,n", [
    ("monthly", 30, 14),
    ("quarterly", 91, 8),
    ("semiannual", 182, 5),
])
def test_cadence_is_inferred_from_observed_spacing(
        dj, monkeypatch, tmp_path, label, step_days, n):
    end = _AS_OF_DATE
    rows = [_COVER, _ANCHOR]
    for i in range(n):
        d = end - datetime.timedelta(days=step_days * (i + 1))
        rows.append(("PAY", _ymd(d.year, d.month, d.day), 0.25))
    out, _ = _read(dj, monkeypatch, tmp_path, ["PAY"], rows=rows)
    assert out["PAY"]["div_frequency"] == label


def test_a_stream_with_no_rhythm_is_called_irregular_not_refused(
        dj, monkeypatch, tmp_path):
    rows = [_COVER, _ANCHOR,
            ("ODD", _ymd(2024, 9, 1), 0.2), ("ODD", _ymd(2024, 10, 5), 0.2),
            ("ODD", _ymd(2025, 6, 1), 0.2), ("ODD", _ymd(2025, 6, 20), 0.2),
            ("ODD", _ymd(2026, 4, 1), 0.2)]
    out, _ = _read(dj, monkeypatch, tmp_path, ["ODD"], rows=rows)
    assert out["ODD"]["div_frequency"] == "irregular"


# ───────────── trap 1: a special dividend distorts TTM and growth ─────────

def test_a_special_dividend_flags_the_ttm_and_refuses_growth(
        dj, monkeypatch, tmp_path):
    """The store has no dividend TYPE field, so a special is only inferable
    from magnitude. TTM still reports the cash actually paid — deleting a real
    payment would be inventing a number — but the row SAYS the sum is
    distorted, and growth is omitted rather than reporting a one-off as a
    dividend raise."""
    out, failures = _read(dj, monkeypatch, tmp_path, ["SPECIAL"])
    row = out["SPECIAL"]
    assert row["div_ttm_outlier"] == 1
    # four regular 0.10s plus the 5.00 one-off: the full, real sum, undeleted
    assert row["div_ttm_cash"] == pytest.approx(5.40)
    assert row["div_payments_ttm"] == 5
    assert "div_growth_1y_pct" not in row
    assert failures["dividend_join"]["growth_outlier_in_window"] == 1


def test_an_unadjusted_split_is_caught_by_the_same_magnitude_gate(
        dj, monkeypatch, tmp_path):
    """🔴 The store is NOT split-adjusted — measured on the live artifact,
    where TSCO runs $1.10, $1.10, $0.23, ... straight through its 5:1 split.
    A split and a dividend cut are indistinguishable from `(ticker, ex_date,
    cash)` alone, so the honest move is to refuse the comparison, not to
    publish an 80% 'cut'."""
    rows = [_COVER, _ANCHOR,
            ("SPLIT", _ymd(2024, 8, 26), 1.10), ("SPLIT", _ymd(2024, 11, 25), 1.10),
            ("SPLIT", _ymd(2025, 2, 26), 0.23), ("SPLIT", _ymd(2025, 5, 28), 0.23),
            ("SPLIT", _ymd(2025, 8, 25), 0.23), ("SPLIT", _ymd(2025, 11, 24), 0.23),
            ("SPLIT", _ymd(2026, 2, 24), 0.24), ("SPLIT", _ymd(2026, 5, 27), 0.24)]
    out, failures = _read(dj, monkeypatch, tmp_path, ["SPLIT"], rows=rows)
    assert "div_growth_1y_pct" not in out["SPLIT"]
    assert failures["dividend_join"]["growth_outlier_in_window"] == 1


def test_growth_is_refused_when_the_payment_counts_differ_between_windows(
        dj, monkeypatch, tmp_path):
    """An ex-date that drifted across the twelve-month boundary makes the sum
    ratio a calendar artifact. 5-vs-4 quarterly payments reads as +25% growth
    on a dividend that never moved."""
    rows = [_COVER, _ANCHOR,
            ("DRIFT", _ymd(2024, 9, 5), 0.25), ("DRIFT", _ymd(2024, 12, 5), 0.25),
            ("DRIFT", _ymd(2025, 3, 5), 0.25), ("DRIFT", _ymd(2025, 6, 5), 0.25),
            ("DRIFT", _ymd(2025, 8, 20), 0.25), ("DRIFT", _ymd(2025, 11, 20), 0.25),
            ("DRIFT", _ymd(2026, 2, 20), 0.25), ("DRIFT", _ymd(2026, 5, 20), 0.25),
            ("DRIFT", _ymd(2026, 8, 5), 0.25)]
    out, failures = _read(dj, monkeypatch, tmp_path, ["DRIFT"], rows=rows)
    assert "div_growth_1y_pct" not in out["DRIFT"]
    assert failures["dividend_join"]["growth_count_mismatch"] == 1


def test_a_new_payer_gets_no_growth_rather_than_an_infinite_one(
        dj, monkeypatch, tmp_path):
    rows = [_COVER, _ANCHOR,
            ("NEW", _ymd(2025, 11, 3), 0.20), ("NEW", _ymd(2026, 2, 3), 0.20),
            ("NEW", _ymd(2026, 5, 3), 0.20), ("NEW", _ymd(2026, 8, 3), 0.20)]
    out, failures = _read(dj, monkeypatch, tmp_path, ["NEW"], rows=rows)
    assert "div_growth_1y_pct" not in out["NEW"]
    assert out["NEW"]["div_ttm_cash"] == pytest.approx(0.80)
    assert failures["dividend_join"]["growth_no_prior"] == 1


def test_growth_is_refused_for_everyone_when_the_store_misses_the_prior_year(
        dj, monkeypatch, tmp_path):
    """A store pruned shorter than the 730-day span would count fewer
    prior-year payments than actually occurred and manufacture growth out of
    missing rows. The gate is global and counted ONCE, never guessed per row."""
    rows = [_ANCHOR] + _CLEAN      # _COVER dropped -> MIN(ex_date) is 2024-09-10
    out, failures = _read(dj, monkeypatch, tmp_path, ["CLEAN"], rows=rows)
    assert "div_growth_1y_pct" not in out["CLEAN"]
    assert failures["dividend_join"]["growth_uncovered"] == 1
    # the facts that do not depend on prior-year coverage still ship
    assert out["CLEAN"]["div_ttm_cash"] == pytest.approx(2.20)


# ───────────────────────── malformed and dead sources ────────────────────

def test_a_malformed_row_is_dropped_and_counted_not_defaulted(
        dj, monkeypatch, tmp_path):
    """A NULL ticker, an empty ticker, a NULL cash, an impossible calendar
    day, a negative amount and a NaN all degrade to "that row does not exist"
    — individually, with a counter — while the good rows on the same ticker
    still answer. Nothing here is defaulted and nothing raises.

    The TEXT `ex_date` row is deliberately included and deliberately NOT in
    the expected count: SQLite orders TEXT after INTEGER, so the windowed
    SELECT excludes it before Python sees it. Asserting 7 here would be
    asserting a coercion that never runs."""
    rows = [_COVER, _ANCHOR,
            (None, _ymd(2026, 1, 5), 0.25),
            ("", _ymd(2026, 1, 9), 0.25),
            ("BAD", _ymd(2026, 1, 6), None),
            ("BAD", 20260230, 0.25),               # February 30th
            ("BAD", "not-a-date", 0.25),           # excluded by the SQL window
            ("BAD", _ymd(2026, 1, 7), -1.0),
            ("BAD", _ymd(2026, 1, 8), float("nan")),
            ("BAD", _ymd(2025, 9, 9), 0.40),       # two good rows, both TTM
            ("BAD", _ymd(2026, 6, 9), 0.40)]
    out, failures = _read(dj, monkeypatch, tmp_path, ["BAD"], rows=rows,
                          schema=_SCHEMA_LOOSE)
    assert failures["dividend_join"]["malformed_row"] == 6
    # the survivors still produced a row; nothing raised into the build
    assert out["BAD"]["div_payments_ttm"] == 2
    assert out["BAD"]["div_ttm_cash"] == pytest.approx(0.80)


def test_a_dead_store_returns_empty_and_counts_the_failure(
        dj, monkeypatch, tmp_path):
    _point_at(monkeypatch, str(tmp_path / "does-not-exist.db"))
    failures = {}
    assert dj.read_dividend_fields(["CLEAN"], failures=failures) == {}
    assert failures["dividend_join"], "a dead source must be COUNTED, not silent"


def test_a_store_without_the_table_returns_empty_and_counts_the_failure(
        dj, monkeypatch, tmp_path):
    path = tmp_path / "no_table.db"
    con = sqlite3.connect(str(path))
    con.execute("CREATE TABLE something_else (x)")
    con.commit()
    con.close()
    _point_at(monkeypatch, str(path))
    failures = {}
    assert dj.read_dividend_fields(["CLEAN"], failures=failures) == {}
    assert failures["dividend_join"]


def test_an_empty_table_returns_empty_and_counts_it(dj, monkeypatch, tmp_path):
    _point_at(monkeypatch, _make_db(tmp_path, []))
    failures = {}
    assert dj.read_dividend_fields(["CLEAN"], failures=failures) == {}
    assert failures["dividend_join"]["empty"] == 1


def test_the_reader_never_raises_into_the_build(dj, monkeypatch, tmp_path):
    """A source whose very path lookup explodes still degrades to `{}`. One
    bad store must not take the nightly down."""
    def _boom():
        raise RuntimeError("no such module")
    monkeypatch.setattr(dj, "_db_path", _boom)
    failures = {}
    assert dj.read_dividend_fields(["CLEAN"], failures=failures) == {}
    assert failures["dividend_join"]["RuntimeError"] == 1


def test_failures_is_optional_and_a_none_census_still_works(
        dj, monkeypatch, tmp_path):
    _point_at(monkeypatch, _make_db(tmp_path, _BASE))
    assert dj.read_dividend_fields(["CLEAN"])["CLEAN"]["div_payments_ttm"] == 4


# ───────────────────────── the read is BULK ──────────────────────────────

class _CountingConn:
    """Counts `execute` calls without changing behaviour."""

    def __init__(self, real):
        self._real = real
        self.executes = 0

    def execute(self, *a, **k):
        self.executes += 1
        return self._real.execute(*a, **k)

    def close(self):
        self._real.close()


def test_the_read_is_bulk_query_count_does_not_grow_with_the_target_list(
        dj, monkeypatch, tmp_path):
    """`dividends` is 434,767 rows over 45,869 tickers with one index on
    `ex_date`; a per-ticker query would re-walk it once per symbol across
    ~3,700 targets. The invariant is not "exactly one query" — it is that the
    query count is CONSTANT in N."""
    _point_at(monkeypatch, _make_db(tmp_path, _BASE))
    real_connect = dj._connect
    seen = []

    def _wrapped(path):
        conn = _CountingConn(real_connect(path))
        seen.append(conn)
        return conn

    monkeypatch.setattr(dj, "_connect", _wrapped)

    dj.read_dividend_fields(["CLEAN"])
    one = sum(c.executes for c in seen)
    seen.clear()

    many = ["CLEAN", "LAPSED", "SPECIAL", "THIN"] + [f"T{i}" for i in range(500)]
    out = dj.read_dividend_fields(many)
    five_hundred = sum(c.executes for c in seen)

    assert one == five_hundred, (
        f"query count grew with the target list: {one} -> {five_hundred}")
    assert five_hundred <= 3, \
        f"expected two bounds probes plus one windowed read, got {five_hundred}"
    assert len(seen) == 1, "one connection per build, not one per ticker"
    # and it actually answered for the real symbols in that long list
    assert set(out) == {"CLEAN", "LAPSED", "SPECIAL", "THIN"}


# ─────────────── staleness: anchored to the DATA, not the clock ───────────

def test_a_stale_store_is_served_and_counted(dj, monkeypatch, tmp_path):
    monkeypatch.setattr(dj, "_today", lambda: _AS_OF_DATE + datetime.timedelta(days=13))
    _point_at(monkeypatch, _make_db(tmp_path, _BASE))
    failures = {}
    out = dj.read_dividend_fields(["CLEAN"], failures=failures)
    assert out["CLEAN"]["div_payments_ttm"] == 4, \
        "a 13-day-old store still answers correctly ABOUT ITS OWN as-of"
    assert failures["dividend_join"]["stale:13d"] == 1


def test_a_badly_stale_store_is_refused_entirely(dj, monkeypatch, tmp_path):
    """Past `_MAX_STALE_DAYS` the daily sweep has failed dozens of times and
    the trailing window describes a materially different period than
    `snapshot_date` claims. `darkpool_agg` is the counter-example: it emitted
    a "1-day" number off a six-week-old session because it has no such gate."""
    monkeypatch.setattr(dj, "_today",
                        lambda: _AS_OF_DATE + datetime.timedelta(days=120))
    _point_at(monkeypatch, _make_db(tmp_path, _BASE))
    failures = {}
    assert dj.read_dividend_fields(["CLEAN"], failures=failures) == {}
    assert failures["dividend_join"]["stale_refused:120d"] == 1


def test_no_emitted_number_moves_when_the_clock_moves(
        dj, monkeypatch, tmp_path):
    """Every window is anchored to `MAX(ex_date)` read from the store. The
    wall clock decides only whether the source is counted stale or refused —
    it can never silently shift a member-facing number."""
    _point_at(monkeypatch, _make_db(tmp_path, _BASE))
    targets = ["CLEAN", "LAPSED", "SPECIAL", "THIN"]

    monkeypatch.setattr(dj, "_today", lambda: _AS_OF_DATE + datetime.timedelta(days=1))
    first = dj.read_dividend_fields(targets)
    monkeypatch.setattr(dj, "_today", lambda: _AS_OF_DATE + datetime.timedelta(days=40))
    later = dj.read_dividend_fields(targets)

    assert first == later
