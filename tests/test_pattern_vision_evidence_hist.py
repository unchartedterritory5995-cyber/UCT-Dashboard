"""The slot row records the evidence histogram and the no-bars drop path.

Two gaps the 2026-09-10 session hit for real:

  * the instrument recorded per-candidate evidence only for JUDGED candidates,
    so the 10:00 slot's 82 skipped ones had to be reasoned about from
    production bar tails instead of read (#22);
  * `PXD` (Pioneer Natural Resources, acquired and delisted) holds ZERO stored
    bars, and the stale filter keeps it by design because absent is not stale.
    It occupied a slot of the 84-ticker cap permanently and silently (#24).

The load-bearing assertion is the CROSS-CHECK: the histogram's key count must
equal `evidence_distinct`. Without it the new column is a second authority over
the same fact and free to drift from the old one -- the defect this repo keeps
re-committing.
"""
import importlib
import json


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


def _run_job(monkeypatch, resolver, asofs_by_ticker, cap="150"):
    import api.main as main
    from api.services.pattern_vision import orchestrator as pv_orch
    monkeypatch.setenv("PATTERN_VISION_ENABLED", "1")
    monkeypatch.setenv("PATTERN_VISION_MAX_PER_RUN", cap)
    monkeypatch.setattr(main, "_resolve_active_set_for_patterns", resolver)
    monkeypatch.setattr(pv_orch, "judge_ticker", lambda t, **kw: {
        "judged": 0, "confirmed": 0, "skipped": len(asofs_by_ticker.get(t, [])),
        "cost_capped": False, "render_failed": 0, "errored": 0, "problems": [],
        "asof_dates": list(asofs_by_ticker.get(t, []))})
    sched = _StubScheduler()
    assert main.register_pattern_vision_jobs(sched) is True
    sched.func()


def _rows(s):
    with s.connect() as c:
        return ([dict(r) for r in c.execute("SELECT * FROM vision_slot_log")],
                [dict(r) for r in c.execute("SELECT * FROM vision_slot_ticker")])


def test_the_histogram_counts_skipped_candidates_too(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    _run_job(monkeypatch, lambda **kw: ["AAA", "BBB"], {
        "AAA": ["2026-09-09", "2026-09-09", "2026-09-08"],
        "BBB": ["2026-09-09"],
    })
    slots, _ = _rows(s)
    hist = json.loads(slots[0]["evidence_hist"])
    assert hist == {"2026-09-08": 1, "2026-09-09": 3}
    assert slots[0]["judged"] == 0, "every candidate here was SKIPPED"
    assert sum(hist.values()) == 4, "the histogram must cover skipped candidates"


def test_the_histogram_key_count_equals_evidence_distinct(tmp_path, monkeypatch):
    """THE CROSS-CHECK. Two columns describing one fact must be unable to
    disagree, or the new one is a second authority free to drift."""
    s = _fresh_store(tmp_path, monkeypatch)
    _run_job(monkeypatch, lambda **kw: ["AAA"], {
        "AAA": ["2025-01-16", "2026-09-08", "2026-09-09", "2026-09-09"],
    })
    slots, _ = _rows(s)
    hist = json.loads(slots[0]["evidence_hist"])
    assert len(hist) == slots[0]["evidence_distinct"]
    assert slots[0]["evidence_min"] == min(hist)
    assert slots[0]["evidence_max"] == max(hist)


def test_no_candidates_leaves_the_histogram_null_not_empty_json(tmp_path, monkeypatch):
    """NULL and '{}' would read the same in a dashboard and differently in SQL.
    A slot that saw no candidates records NULL, matching evidence_min/max."""
    s = _fresh_store(tmp_path, monkeypatch)
    _run_job(monkeypatch, lambda **kw: ["AAA"], {"AAA": []})
    slots, _ = _rows(s)
    assert slots[0]["evidence_hist"] is None
    assert slots[0]["evidence_distinct"] == 0


def test_a_zero_bars_symbol_is_dropped_under_its_own_path(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)

    def _resolver(*, diagnostics=None):
        if diagnostics is not None:
            diagnostics["dropped_no_bars"] = ["PXD"]
            diagnostics["dropped_stale"] = [("SQ", "2025-01-16")]
        return ["AAA"]

    _run_job(monkeypatch, _resolver, {"AAA": ["2026-09-09"]})
    slots, problems = _rows(s)
    assert slots[0]["dropped_no_bars"] == 1
    assert slots[0]["dropped_stale"] == 1
    by_path = {p["path"]: p for p in problems}
    assert by_path["dropped_no_bars"]["ticker"] == "PXD"
    assert by_path["dropped_no_bars"]["asof_date"] is None
    assert by_path["dropped_stale"]["ticker"] == "SQ"


def test_the_two_drop_causes_are_not_merged(tmp_path, monkeypatch):
    """'stale' and 'no bars at all' are different facts about a symbol. One
    counter would make them indistinguishable -- the collapse this table exists
    to undo."""
    s = _fresh_store(tmp_path, monkeypatch)

    def _resolver(*, diagnostics=None):
        if diagnostics is not None:
            diagnostics["dropped_no_bars"] = ["PXD", "DEAD"]
            diagnostics["dropped_stale"] = []
        return ["AAA"]

    _run_job(monkeypatch, _resolver, {"AAA": ["2026-09-09"]})
    slots, problems = _rows(s)
    assert slots[0]["dropped_no_bars"] == 2
    assert slots[0]["dropped_stale"] == 0
    assert sorted(p["ticker"] for p in problems) == ["DEAD", "PXD"]
    assert {p["path"] for p in problems} == {"dropped_no_bars"}


def test_migration_adds_both_new_columns_and_is_idempotent(tmp_path, monkeypatch):
    """The prod table now carries the first three added columns but not these
    two. init_db runs at the top of every judge run, so a once-only migration
    would raise 'duplicate column name' on the second slot of the day."""
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "old.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    with s.connect() as c:
        c.execute("""CREATE TABLE vision_slot_log (
            slot_start TEXT, source TEXT, started_ts INTEGER, finished_ts INTEGER,
            duration_s REAL, evidence_min TEXT, evidence_max TEXT,
            evidence_distinct INTEGER, active_set_n INTEGER, judged INTEGER,
            skipped INTEGER, capped INTEGER, render_failed INTEGER, errored INTEGER,
            aborted INTEGER, abort_ticker TEXT, paid_calls INTEGER, spend_usd REAL,
            dropped_stale INTEGER, truncated INTEGER, hygiene_skipped TEXT)""")
        c.commit()
    s.init_db()
    s.init_db()
    s.init_db()
    with s.connect() as c:
        cols = {r[1] for r in c.execute("PRAGMA table_info(vision_slot_log)").fetchall()}
    assert {"dropped_no_bars", "evidence_hist"} <= cols
