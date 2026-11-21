"""Full-universe 1m for the first-frame seed (api/services/ffseed_onemin.py), the store's prefix trim
(bars_sqlite.prune_before), the prewarm's published active set, and the seed's nightly sequence and
forced rebuild (ffseed.nightly / tick / forced_rebuild_due)."""
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_prewarm, bars_sqlite as bs, ffseed, ffseed_onemin as onemin

ET = ZoneInfo("America/New_York")
REPO = Path(__file__).resolve().parents[1]
FRI = date(2026, 11, 20)
THU = date(2026, 11, 19)


@pytest.fixture(autouse=True)
def _private_data_dir(monkeypatch, tmp_path):
    """Every marker and the long-tail ledger go to a private directory: never the box's real DATA_DIR."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))


def et(d: date, h: int, m: int) -> int:
    return int(datetime(d.year, d.month, d.day, h, m, tzinfo=ET).timestamp())


# ---- the calendar ----------------------------------------------------------------------------

def test_sessions_back_and_last_regular_minute_follow_the_nyse_calendar():
    assert onemin.prev_session(date(2026, 11, 27)) == date(2026, 11, 25)          # Thanksgiving
    assert onemin.sessions_back(date(2026, 11, 30), 5) == date(2026, 11, 23)     # Mon 30, Fri 27, Wed 25, Tue 24, Mon 23
    assert onemin.last_rth_minute_ts(FRI) == et(FRI, 15, 59)
    assert onemin.last_rth_minute_ts(date(2026, 11, 27)) == et(date(2026, 11, 27), 12, 59)   # half day
    assert onemin.session_start_ts(FRI) == et(FRI, 4, 0)


# ---- the plan --------------------------------------------------------------------------------

def test_plan_skips_current_symbols_and_reaches_back_a_session_only_when_needed():
    stored = {
        "CUR": et(FRI, 19, 59),       # the prewarm keeps it current: no call
        "RTH": et(FRI, 15, 59),       # reaches the last regular minute: no call
        "THIN": et(FRI, 15, 30),      # today, but short of the close: fetch today only
        "YDAY": et(THU, 16, 30),      # holds yesterday: fetch today only
        "OLD": et(date(2026, 11, 17), 15, 59),   # older: fetch from yesterday
        "NONE": None,                 # nothing stored: fetch from yesterday
    }
    got = dict(onemin.plan(FRI, list(stored), stored.get))
    assert got == {"THIN": FRI, "YDAY": FRI, "OLD": THU, "NONE": THU}


# ---- the pass --------------------------------------------------------------------------------

def test_backfill_fetches_the_plan_stores_rows_and_counts_failures():
    stored = {"A": None, "B": et(THU, 18, 0), "C": et(FRI, 19, 0), "BAD": None, "EMPTY": None}
    calls, writes = [], {}

    def fetch(sym, frm, to):
        calls.append((sym, frm, to))
        if sym == "BAD":
            raise RuntimeError("provider down")
        if sym == "EMPTY":
            return []
        return [{"t": et(FRI, 9, 30), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}] * 3

    def store(sym, rows, checked_at):
        writes[sym] = len(rows)
        return len(rows)

    st = onemin.backfill(FRI, list(stored), fetch=fetch, store=store, last_ts=stored.get, n_workers=2)
    assert sorted(calls) == [("A", THU, FRI), ("B", FRI, FRI), ("BAD", THU, FRI), ("EMPTY", THU, FRI)]
    assert writes == {"A": 3, "B": 3}
    assert (st["current"], st["todo"], st["fetched"], st["rows"], st["failed"], st["empty"]) == (1, 4, 3, 6, 1, 1)


def test_backfill_stops_at_its_deadline():
    t = [0.0]

    def clock():
        return t[0]

    def fetch(sym, frm, to):
        t[0] += 10.0                   # every call takes 10 s
        return []

    st = onemin.backfill(FRI, ["A", "B", "C", "D"], fetch=fetch, store=lambda *a: 0,
                         last_ts=lambda s: None, n_workers=1, deadline=15.0, clock=clock)
    assert st["fetched"] == 2 and st["not_reached"] == 2


def test_the_default_write_is_the_range_repair_write(monkeypatch):
    from api.services import bars_fetch
    seen = {}

    class _Check:
        def __init__(self, t):
            seen["checked"] = t

        def __enter__(self):
            seen["inside"] = True

        def __exit__(self, *a):
            seen["inside"] = False

    monkeypatch.setattr(bars_fetch, "_provider_write", _Check)
    monkeypatch.setattr(bs, "put_bars", lambda sym, tf, rows, **k: seen.update(put=(sym, tf, len(rows), seen.get("inside"))) or len(rows))
    assert onemin._store("ZZ", [{"t": 1}], 123.0) == 1
    assert seen["checked"] == 123.0 and seen["put"] == ("ZZ", "1", 1, True)


# ---- the retention ---------------------------------------------------------------------------

def _ledger(**symbols):
    return {"v": 1, "symbols": {k: dict(v) for k, v in symbols.items()}}


def test_retention_never_runs_without_the_active_set_or_when_off():
    asked = []
    prune = lambda syms, cutoff: asked.append((syms, cutoff)) or 7
    led = _ledger(AAA={"first": "2026-11-19", "active": None})
    assert onemin.retention(FRI, ["AAA"], protected=None, keep=5, prune=prune, ledger=led,
                            first_ts=lambda s: None) == {"skipped": "active set unknown"}
    assert onemin.retention(FRI, ["AAA"], protected=frozenset(), keep=0, prune=prune, ledger=led,
                            first_ts=lambda s: None) == {"skipped": "disabled"}
    assert asked == []


def test_retention_trims_only_what_this_pass_wrote_for_long_idle_symbols():
    asked = []
    prune = lambda syms, cutoff: asked.append((syms, cutoff)) or 7
    led = _ledger(
        FILLED={"first": "2026-11-12", "active": None},          # the pass's own: trimmed
        IDLE={"first": "2026-11-12", "active": "2026-11-05"},    # active 15 days ago: trimmed
        RECENT={"first": "2026-11-12", "active": "2026-11-16"},  # active 4 days ago: kept
        ACTIVE={"first": "2026-11-12", "active": None},          # active today: kept
        OLDER={"first": "2026-11-17", "active": None},           # holds 1m from before the pass's first fill: kept
    )
    first = {"FILLED": et(date(2026, 11, 12), 4, 0), "IDLE": et(date(2026, 11, 13), 9, 30),
             "RECENT": et(date(2026, 11, 12), 4, 0), "ACTIVE": et(date(2026, 11, 12), 4, 0),
             "OLDER": et(date(2026, 3, 2), 9, 30), "NOTFILLED": et(date(2026, 1, 2), 9, 30)}
    out = onemin.retention(FRI, ["filled", "IDLE", "RECENT", "ACTIVE", "OLDER", "NOTFILLED"],
                           protected=frozenset({"ACTIVE", "SPY"}), keep=5, prune=prune, ledger=led,
                           first_ts=first.get, idle_days=10)
    assert asked == [(["FILLED", "IDLE"], et(date(2026, 11, 16), 4, 0))]   # 5 sessions: Fri 20 .. Mon 16
    assert out["skipped"] == {"not_filled": 1, "active": 1, "recently_active": 1, "older_rows": 1}
    assert out["deleted"] == 7 and out["eligible"] == 2
    assert led["symbols"]["ACTIVE"]["active"] == "2026-11-20"             # today's active set is recorded


def test_the_ledger_records_what_the_pass_stored_and_when_each_was_active(monkeypatch):
    monkeypatch.setattr(onemin, "protected_symbols", lambda: frozenset({"B"}))
    stored = {"A": None, "B": None, "EMPTY": None, "BAD": None, "REJ": None, "CUR": et(FRI, 19, 0)}

    def fetch(sym, frm, to):
        if sym == "BAD":
            raise RuntimeError("down")
        return [] if sym == "EMPTY" else [{"t": et(FRI, 9, 30)}]

    # REJ: the provider answered but the store kept none of it (every row refused): not the pass's
    onemin.backfill(FRI, list(stored), fetch=fetch, store=lambda sym, rows, t: 0 if sym == "REJ" else len(rows),
                    last_ts=stored.get, n_workers=1)
    led = onemin.load_ledger()
    assert led["symbols"] == {"A": {"first": "2026-11-19", "active": None},
                              "B": {"first": "2026-11-19", "active": "2026-11-20"}}
    # a later pass from a later day never moves `first` forward
    onemin.backfill(date(2026, 11, 23), ["A"], fetch=fetch, store=lambda sym, rows, t: len(rows),
                    last_ts=lambda s: None, n_workers=1)
    assert onemin.load_ledger()["symbols"]["A"]["first"] == "2026-11-19"


def test_an_unreadable_ledger_reads_as_empty_and_trims_nothing(tmp_path):
    (tmp_path / "ffseed_1m_longtail.json").write_text("{not json", encoding="ascii")
    assert onemin.load_ledger() == {"v": 1, "symbols": {}}
    asked = []
    out = onemin.retention(FRI, ["AAA"], protected=frozenset(), keep=5,
                           prune=lambda syms, cutoff: asked.append(syms) or 0, first_ts=lambda s: None)
    assert asked == [] and out["eligible"] == 0


def test_the_prewarm_publishes_its_active_set_and_the_retention_reads_it(monkeypatch):
    monkeypatch.setattr(bars_prewarm, "_ACTIVE_INTRADAY", None)
    assert onemin.protected_symbols() is None
    bars_prewarm._publish_active_intraday(["spy", "AAPL", ""])
    assert onemin.protected_symbols() == frozenset({"SPY", "AAPL"})
    # and the prewarm pass really calls the publisher with the set it warms
    src = (REPO / "api/services/bars_prewarm.py").read_text(encoding="utf-8")
    assert "    _publish_active_intraday(_active_intraday)\n" in src
    assert src.index("_active_intraday = (") < src.index("    _publish_active_intraday(_active_intraday)\n")


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bs, "_DB_PATH", str(tmp_path / "bars.db"))
    bs.bump_db_epoch()
    bs.init_db()
    yield tmp_path
    bs.bump_db_epoch()


def _bars(ts):
    return [{"t": t, "o": 10.0, "h": 11.0, "l": 9.0, "c": 10.5, "v": 100} for t in ts]


def test_prune_before_deletes_only_the_named_series_rows_older_than_the_cutoff(store):
    cut = et(FRI, 4, 0)
    old = [et(THU, 9, 30), et(THU, 9, 31)]
    new = [et(FRI, 9, 30), et(FRI, 9, 31)]
    for sym in ("AAA", "BBB", "KEEP"):
        bs.put_bars(sym, "1", _bars(old + new))
    bs.put_bars("AAA", "5", _bars([et(THU, 9, 30)]))
    rev_before = bs.series_meta("AAA", "1")["history_rev"]
    n = bs.prune_before(["AAA", "bbb", "NOPE"], "1", cut, chunk=1)
    assert n == 4
    assert [r[0] for r in bs.get_bars("AAA", "1", 100)] == new
    assert [r[0] for r in bs.get_bars("BBB", "1", 100)] == new
    assert [r[0] for r in bs.get_bars("KEEP", "1", 100)] == old + new        # not named: untouched
    assert [r[0] for r in bs.get_bars("AAA", "5", 100)] == [et(THU, 9, 30)]   # another timeframe: untouched
    assert bs.series_meta("AAA", "1")["history_rev"] > rev_before             # the one-writer rule
    assert bs.prune_before(["AAA"], "1", cut) == 0                             # idempotent


# ---- the nightly sequence and the forced rebuild ---------------------------------------------

@pytest.fixture
def seq(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    log = []
    monkeypatch.setattr(onemin, "backfill", lambda asof, **kw: log.append(("backfill", asof)) or {"not_reached": 0})
    monkeypatch.setattr(onemin, "retention", lambda asof: log.append(("retention", asof)))

    def bp(asof):
        log.append(("publish", asof))
        return {"build": "B", "asof": asof.isoformat(), "tfs": {}}
    monkeypatch.setattr(ffseed, "build_and_publish", bp)
    from api.services import data_sync
    monkeypatch.setattr(data_sync, "credentials_ok", lambda: True)
    return log


def test_nightly_backfills_then_publishes_then_trims(seq, monkeypatch):
    ffseed.nightly(FRI)
    assert seq == [("backfill", FRI), ("publish", FRI), ("retention", FRI)]
    assert ffseed._read_marker() == 20261120
    seq.clear()
    monkeypatch.setenv("FFSEED_1M_BACKFILL", "0")
    ffseed.nightly(FRI)
    assert seq == [("publish", FRI), ("retention", FRI)]


def test_a_failed_backfill_or_retention_never_stops_the_publish(seq, monkeypatch):
    def boom(asof, **kw):
        raise RuntimeError("x")
    monkeypatch.setattr(onemin, "backfill", boom)
    monkeypatch.setattr(onemin, "retention", boom)
    assert ffseed.nightly(FRI)["asof"] == "2026-11-20"
    assert seq == [("publish", FRI)]


SAT = datetime(2026, 11, 21, 10, 0, tzinfo=ET)


def test_forced_rebuild_of_the_newest_session_runs_once(seq, monkeypatch):
    ffseed._write_marker(20261120)                       # Friday already published
    onemin._write_pass_marker("2026-11-20")              # and its 1m pass done
    assert ffseed.tick(SAT) is None and seq == []        # nothing due
    monkeypatch.setenv("FFSEED_FORCE_ASOF", "2026-11-20")
    assert ffseed.tick(SAT)["asof"] == "2026-11-20"
    assert seq == [("backfill", FRI), ("publish", FRI), ("retention", FRI)]
    seq.clear()
    assert ffseed.tick(SAT) is None and seq == []        # done once; the variable may stay set


@pytest.mark.parametrize("value", ["2026-11-19", "2026-11-23", "11/20/2026"])
def test_forced_rebuild_is_refused_for_anything_but_the_newest_closed_session(seq, monkeypatch, value):
    ffseed._write_marker(20261120)
    onemin._write_pass_marker("2026-11-20")
    monkeypatch.setenv("FFSEED_FORCE_ASOF", value)
    assert ffseed.forced_rebuild_due(SAT) is None
    assert ffseed.tick(SAT) is None and seq == []


# ---- the pass right after the close, and on a boot after it ------------------------------------

@pytest.mark.parametrize("now, marker, want", [
    (datetime(2026, 11, 20, 16, 10, tzinfo=ET), "", THU),          # before 16:20: the newest closed is Thursday
    (datetime(2026, 11, 20, 16, 10, tzinfo=ET), "2026-11-19", None),
    (datetime(2026, 11, 20, 16, 25, tzinfo=ET), "2026-11-19", FRI),  # Friday's pass is due
    (datetime(2026, 11, 20, 19, 5, tzinfo=ET), "2026-11-20", None),  # a boot after it ran: nothing
    (datetime(2026, 11, 21, 10, 0, tzinfo=ET), "2026-11-19", FRI),   # a Saturday boot catches Friday up
])
def test_pass_due(monkeypatch, tmp_path, now, marker, want):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    if marker:
        onemin._write_pass_marker(marker)
    assert onemin.pass_due(now) == want
    monkeypatch.setenv("FFSEED_1M_BACKFILL", "0")
    assert onemin.pass_due(now) is None


def test_run_pass_records_only_a_complete_pass(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(onemin, "backfill", lambda asof, **kw: {"not_reached": 3})
    onemin.run_pass(FRI)
    assert onemin.read_pass_marker() == ""                      # cut short by its deadline: not done
    monkeypatch.setattr(onemin, "backfill", lambda asof, **kw: {"not_reached": 0})
    onemin.run_pass(FRI)
    assert onemin.read_pass_marker() == "2026-11-20"


def test_a_boot_after_the_close_runs_the_pass_before_the_build_is_due(seq):
    ffseed._write_marker(20261119)                       # Thursday's seed is out
    boot = datetime(2026, 11, 20, 19, 5, tzinfo=ET)      # a worker deploy at 19:00 ET
    assert ffseed.tick(boot) is None
    assert seq == [("backfill", FRI)]                    # the pass, no build yet
    assert onemin.read_pass_marker() == "2026-11-20"
    seq.clear()
    assert ffseed.tick(datetime(2026, 11, 20, 19, 35, tzinfo=ET)) is None and seq == []   # done once
    m = ffseed.tick(datetime(2026, 11, 20, 20, 20, tzinfo=ET))                             # build time
    assert m["asof"] == "2026-11-20"
    assert seq == [("backfill", FRI), ("publish", FRI), ("retention", FRI)]               # build waits on its pass


def test_before_the_close_no_pass_for_today_runs(seq):
    ffseed._write_marker(20261119)
    onemin._write_pass_marker("2026-11-19")
    assert ffseed.tick(datetime(2026, 11, 20, 14, 0, tzinfo=ET)) is None
    assert seq == []
