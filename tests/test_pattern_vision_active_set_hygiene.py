"""Active-set hygiene: a retired symbol must be dropped, and SAID SO.

SQ sat in the leader universe after the SQ->XYZ rename with its bars frozen at
2025-01-16, and was judged against a 20-month-old chart. The judge read its
evidence bar correctly -- the defect was upstream, in the active set. Alongside
it, the `[:cap]` slice in the judge job was a fifth silent path: it drops the
tail of the universe with no counter and no log line.

The load-bearing property here is NOT that stale symbols get dropped. It is
that the filter can never starve the judge: every failure path returns the
unfiltered list, and a filter that would empty a healthy universe is treated as
a bug rather than a result.
"""
import importlib


def _fresh_store(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    return s


class _StubScheduler:
    def __init__(self):
        self.func = None

    def add_job(self, func, **kw):
        self.func = func


def _stub_bars(monkeypatch, floor, last_by_sym, raise_on_floor=False):
    """Pin the derived session calendar and each symbol's last bar."""
    from api.services import bars_sqlite

    def _floor(n, before):
        if raise_on_floor:
            raise RuntimeError("bars store unavailable")
        return floor

    monkeypatch.setattr(bars_sqlite, "nth_recent_trading_date", _floor)
    monkeypatch.setattr(bars_sqlite, "get_last_ts",
                        lambda t, tf: last_by_sym.get(t.upper(), 20260909))


def _resolve(monkeypatch, **kw):
    import api.main as main
    diag = {}
    out = main._resolve_active_set_for_patterns(diagnostics=diag)
    return out, diag


# ---------------------------------------------------------------- the filter

def test_all_current_bars_leaves_the_universe_untouched(monkeypatch):
    _stub_bars(monkeypatch, 20260903, {})
    out, diag = _resolve(monkeypatch)
    assert len(out) == 84
    assert diag["dropped_stale"] == []
    assert "XYZ" in out and "SQ" not in out          # the rename landed


def test_a_stale_symbol_is_dropped_and_reported(monkeypatch):
    _stub_bars(monkeypatch, 20260903, {"XYZ": 20250117})
    out, diag = _resolve(monkeypatch)
    assert len(out) == 83
    assert "XYZ" not in out
    assert diag["dropped_stale"] == [("XYZ", "2025-01-17")]


def test_a_symbol_exactly_on_the_floor_is_kept(monkeypatch):
    """The bound is `older than`, not `older than or equal`. A symbol whose last
    bar IS the Nth session back is still inside the window."""
    _stub_bars(monkeypatch, 20260903, {"XYZ": 20260903})
    out, diag = _resolve(monkeypatch)
    assert "XYZ" in out
    assert diag["dropped_stale"] == []


# ------------------------------------------------- it must never starve the judge

def test_a_filter_that_would_empty_the_universe_is_ignored(monkeypatch):
    """THE CATASTROPHIC CASE. If every symbol reads stale -- a broken ingestion,
    a bad floor, a bug in this function -- the judge must still get its full
    universe, not an empty list."""
    _stub_bars(monkeypatch, 20260903, {})
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda t, tf: 20200101)
    out, diag = _resolve(monkeypatch)
    assert len(out) == 84, "hygiene filter starved the judge"
    assert diag["dropped_stale"] == [], "must not report drops it did not make"
    assert diag["hygiene_skipped"] == "would_empty_universe"


def test_no_session_floor_means_no_filtering(monkeypatch):
    _stub_bars(monkeypatch, None, {"XYZ": 20250117})
    out, diag = _resolve(monkeypatch)
    assert len(out) == 84 and "XYZ" in out
    assert diag["hygiene_skipped"] == "no_session_floor"


def test_a_broken_bars_store_means_no_filtering(monkeypatch):
    _stub_bars(monkeypatch, 20260903, {}, raise_on_floor=True)
    out, diag = _resolve(monkeypatch)
    assert len(out) == 84
    assert diag["hygiene_skipped"] == "no_bars_store:RuntimeError"


def test_a_healthy_filter_records_no_skip_reason(monkeypatch):
    """The control. `hygiene_skipped` must be None when the filter actually ran,
    or the column cannot distinguish 'filtered, nothing stale' from 'declined'."""
    _stub_bars(monkeypatch, 20260903, {"XYZ": 20250117})
    _, diag = _resolve(monkeypatch)
    assert diag["hygiene_skipped"] is None
    assert diag["dropped_stale"] == [("XYZ", "2025-01-17")]


def test_diagnostics_is_optional(monkeypatch):
    """Every other caller must keep working with no argument at all."""
    import api.main as main
    _stub_bars(monkeypatch, 20260903, {"XYZ": 20250117})
    assert len(main._resolve_active_set_for_patterns()) == 83


# ---------------------------------------------------------------- the slot row

def _run_job(monkeypatch, resolver, cap="150"):
    import api.main as main
    from api.services.pattern_vision import orchestrator as pv_orch
    monkeypatch.setenv("PATTERN_VISION_ENABLED", "1")
    monkeypatch.setenv("PATTERN_VISION_MAX_PER_RUN", cap)
    monkeypatch.setattr(main, "_resolve_active_set_for_patterns", resolver)
    monkeypatch.setattr(pv_orch, "judge_ticker", lambda t, **kw: {
        "judged": 1, "confirmed": 0, "skipped": 0, "cost_capped": False,
        "render_failed": 0, "errored": 0, "problems": [], "asof_dates": ["2026-09-09"]})
    sched = _StubScheduler()
    assert main.register_pattern_vision_jobs(sched) is True
    sched.func()
    return sched.func


def _rows(s):
    with s.connect() as c:
        return ([dict(r) for r in c.execute("SELECT * FROM vision_slot_log")],
                [dict(r) for r in c.execute("SELECT * FROM vision_slot_ticker")])


def test_slot_row_carries_both_counters_and_names_each_symbol(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)

    def _resolver(*, diagnostics=None):
        if diagnostics is not None:
            diagnostics["dropped_stale"] = [("SQ", "2025-01-16")]
        return ["AAA", "BBB", "CCC"]

    _run_job(monkeypatch, _resolver, cap="2")
    slots, problems = _rows(s)
    assert len(slots) == 1
    assert slots[0]["dropped_stale"] == 1
    assert slots[0]["truncated"] == 1
    assert slots[0]["active_set_n"] == 2, "cap must still bound what is judged"
    by_path = {p["path"]: p for p in problems}
    assert by_path["dropped_stale"]["ticker"] == "SQ"
    assert by_path["dropped_stale"]["asof_date"] == "2025-01-16"
    assert by_path["truncated"]["ticker"] == "CCC"
    assert "MAX_PER_RUN=2" in by_path["truncated"]["message"]


def test_an_untruncated_run_reports_zero_not_null(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    _run_job(monkeypatch, lambda **kw: ["AAA", "BBB"], cap="150")
    slots, problems = _rows(s)
    assert slots[0]["dropped_stale"] == 0
    assert slots[0]["truncated"] == 0
    assert problems == []


def test_migration_adds_the_counters_to_an_already_shipped_table(tmp_path, monkeypatch):
    """The prod table predates these columns. CREATE TABLE IF NOT EXISTS cannot
    add them, so without the ALTER the counters would silently never be written
    -- the exact invisibility this table exists to remove."""
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "old.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    with s.connect() as c:
        c.execute("""CREATE TABLE vision_slot_log (
            slot_start TEXT, source TEXT, started_ts INTEGER, finished_ts INTEGER,
            duration_s REAL, evidence_min TEXT, evidence_max TEXT,
            evidence_distinct INTEGER, active_set_n INTEGER, judged INTEGER,
            skipped INTEGER, capped INTEGER, render_failed INTEGER, errored INTEGER,
            aborted INTEGER, abort_ticker TEXT, paid_calls INTEGER, spend_usd REAL)""")
        c.commit()
    s.init_db()
    with s.connect() as c:
        cols = {r[1] for r in c.execute("PRAGMA table_info(vision_slot_log)").fetchall()}
    assert {"dropped_stale", "truncated", "hygiene_skipped"} <= cols

    # IDEMPOTENCY. init_db() runs at the top of EVERY judge run, so a migration
    # that only works once would raise "duplicate column name" on the second
    # slot of the day -- aborting the run before a single ticker is judged.
    s.init_db()
    s.init_db()
    with s.connect() as c:
        again = {r[1] for r in c.execute("PRAGMA table_info(vision_slot_log)").fetchall()}
    assert again == cols, "a repeat init_db changed the schema"


def test_fail_open_reason_reaches_the_slot_row(tmp_path, monkeypatch):
    """A broken bars store must surface in the same query as everything else."""
    s = _fresh_store(tmp_path, monkeypatch)

    def _resolver(*, diagnostics=None):
        if diagnostics is not None:
            diagnostics["hygiene_skipped"] = "no_bars_store:RuntimeError"
        return ["AAA"]

    _run_job(monkeypatch, _resolver)
    slots, _ = _rows(s)
    assert slots[0]["hygiene_skipped"] == "no_bars_store:RuntimeError"


def test_a_healthy_slot_row_has_a_null_skip_reason(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    _run_job(monkeypatch, lambda **kw: ["AAA"])
    slots, _ = _rows(s)
    assert slots[0]["hygiene_skipped"] is None
