"""Slot observability: every judge invocation must leave exactly one row.

Before `vision_slot_log` existed, four paths in the judge loop wrote nothing
anywhere -- skip-if-stable, the cost cap, a chart-render failure (which logs
NOTHING at all) and a judge exception (stdout only). A slot that produced no
verdicts was therefore unresolvable between "all skipped", "all failed" and
"empty active set", and the only other instrument was a log buffer holding
about ten minutes. Each test below pins one of those outcomes.
"""
import importlib


def _fresh_store(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    return s


class _StubScheduler:
    """Captures the job callable instead of scheduling it."""

    def __init__(self):
        self.func = None

    def add_job(self, func, **kw):
        self.func = func


def _capture_run(monkeypatch, active, judge):
    """Register the real job and hand back its `_run` closure."""
    import api.main as main
    from api.services.pattern_vision import orchestrator as pv_orch
    monkeypatch.setenv("PATTERN_VISION_ENABLED", "1")
    monkeypatch.setattr(main, "_resolve_active_set_for_patterns", lambda: list(active))
    monkeypatch.setattr(pv_orch, "judge_ticker", judge)
    sched = _StubScheduler()
    assert main.register_pattern_vision_jobs(sched) is True
    assert sched.func is not None
    return sched.func


def _slots(s):
    with s.connect() as c:
        return [dict(r) for r in c.execute("SELECT * FROM vision_slot_log")]


def _problems(s):
    with s.connect() as c:
        return [dict(r) for r in c.execute("SELECT * FROM vision_slot_ticker")]


def _ok(judged=1, skipped=0, **kw):
    out = {"judged": judged, "confirmed": 0, "skipped": skipped, "cost_capped": False,
           "render_failed": 0, "errored": 0, "problems": [], "asof_dates": ["2026-09-08"]}
    out.update(kw)
    return out


def test_normal_slot_writes_one_row(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    run = _capture_run(monkeypatch, ["NVDA", "AAPL"], lambda t, *a, **k: _ok())
    run()
    rows = _slots(s)
    assert len(rows) == 1
    r = rows[0]
    assert r["source"] == "cron" and r["active_set_n"] == 2
    assert r["judged"] == 2 and r["aborted"] == 0 and r["abort_ticker"] is None
    assert r["evidence_min"] == "2026-09-08" and r["evidence_distinct"] == 1


def test_all_skipped_is_distinguishable(tmp_path, monkeypatch):
    """The 2026-09-09 16:00 case: a slot that ran and legitimately did nothing.
    Previously indistinguishable from a slot that never ran."""
    s = _fresh_store(tmp_path, monkeypatch)
    run = _capture_run(monkeypatch, ["NVDA", "AAPL", "MSFT"],
                       lambda t, *a, **k: _ok(judged=0, skipped=2))
    run()
    r = _slots(s)[0]
    assert r["active_set_n"] == 3 and r["judged"] == 0 and r["skipped"] == 6
    assert r["aborted"] == 0 and r["paid_calls"] == 0


def test_empty_active_set_is_distinguishable(tmp_path, monkeypatch):
    """active_set_n=0 vs skipped>0 -- the two look identical without this row."""
    s = _fresh_store(tmp_path, monkeypatch)
    run = _capture_run(monkeypatch, [], lambda t, *a, **k: _ok())
    run()
    r = _slots(s)[0]
    assert r["active_set_n"] == 0 and r["judged"] == 0 and r["skipped"] == 0
    assert r["evidence_distinct"] == 0 and r["evidence_min"] is None


def test_empty_active_set_writes_a_row_on_a_VIRGIN_db(tmp_path, monkeypatch):
    """Regression, follow-up 14: init_db() used to run ONLY inside
    judge_ticker(), so an empty active set never created the tables, the
    `finally` wrote to a table that did not exist, and its own try/except
    correctly swallowed the failure -- this instrument reproducing its own
    blind spot, for one of the four paths it exists to expose.

    ⛔ This fixture deliberately does NOT call init_db(). That omission IS the
    test; adding it back makes this pass against the unfixed code.
    `test_empty_active_set_is_distinguishable` above is kept as-is on a warm
    DB -- it pins a different property (active_set_n=0 vs skipped>0) in the
    realistic steady state, and this case carries the virgin-DB guarantee.
    """
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    with s.connect() as c:
        names = [r[0] for r in c.execute("SELECT name FROM sqlite_master")]
    assert "vision_slot_log" not in names, "fixture precondition: tables must NOT exist yet"

    run = _capture_run(monkeypatch, [], lambda t, *a, **k: _ok())
    run()

    rows = _slots(s)
    assert len(rows) == 1, "an empty slot must still leave exactly one row"
    assert rows[0]["active_set_n"] == 0 and rows[0]["judged"] == 0
    assert rows[0]["source"] == "cron" and rows[0]["aborted"] == 0


def test_cost_cap_is_recorded(tmp_path, monkeypatch):
    s = _fresh_store(tmp_path, monkeypatch)
    run = _capture_run(monkeypatch, ["NVDA", "AAPL"],
                       lambda t, *a, **k: _ok(judged=0, cost_capped=True))
    run()
    assert _slots(s)[0]["capped"] == 2


def test_render_failure_names_the_ticker(tmp_path, monkeypatch):
    """`if not png: continue` logs nothing at all. It must still be attributable,
    with its own asof_date -- ingestion lag can be partial within one slot."""
    s = _fresh_store(tmp_path, monkeypatch)

    def judge(t, *a, **k):
        if t == "AAPL":
            return _ok(judged=0, render_failed=1, asof_dates=["2026-09-04"],
                       problems=[{"ticker": "AAPL", "tf": "D", "setup": "vcp",
                                  "asof_date": "2026-09-04", "path": "render_failed",
                                  "message": "chart_render returned no png"}])
        return _ok()

    run = _capture_run(monkeypatch, ["NVDA", "AAPL"], judge)
    run()
    r = _slots(s)[0]
    assert r["render_failed"] == 1 and r["aborted"] == 0
    # partial lag is visible: two distinct evidence dates in one slot
    assert r["evidence_min"] == "2026-09-04" and r["evidence_max"] == "2026-09-08"
    assert r["evidence_distinct"] == 2
    p = _problems(s)
    assert len(p) == 1 and p[0]["ticker"] == "AAPL"
    assert p[0]["path"] == "render_failed" and p[0]["asof_date"] == "2026-09-04"


def test_abort_mid_loop_still_writes_row_and_names_ticker(tmp_path, monkeypatch):
    """The critical case. One bad ticker kills the whole slot (unchanged
    behaviour); the row must land anyway, via the `finally`, carrying the
    partial counts and the ticker that was in flight."""
    s = _fresh_store(tmp_path, monkeypatch)

    def judge(t, *a, **k):
        if t == "AAPL":
            raise KeyError("confirmed")
        return _ok()

    run = _capture_run(monkeypatch, ["NVDA", "AAPL", "MSFT"], judge)
    run()  # must not raise -- the scheduler job swallows and reports
    rows = _slots(s)
    assert len(rows) == 1
    r = rows[0]
    assert r["aborted"] == 1 and r["abort_ticker"] == "AAPL"
    assert r["judged"] == 1, "partial progress before the abort must survive"
    assert r["active_set_n"] == 3


def test_slot_log_failure_does_not_mask_the_run(tmp_path, monkeypatch):
    """A broken slot-log write must never replace the real outcome."""
    s = _fresh_store(tmp_path, monkeypatch)
    monkeypatch.setattr(s, "log_slot",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
    run = _capture_run(monkeypatch, ["NVDA"], lambda t, *a, **k: _ok())
    run()  # must not raise
    assert _slots(s) == []


def test_manual_and_cron_rows_are_distinguishable(tmp_path, monkeypatch):
    """Path 2: a manual re-judge goes through the API, not _run(). Both sources
    must be present so the table is the complete invocation record."""
    s = _fresh_store(tmp_path, monkeypatch)
    run = _capture_run(monkeypatch, ["NVDA"], lambda t, *a, **k: _ok())
    run()
    s.log_slot({"slot_start": "2026-09-09T18:30:00-04:00", "source": "manual",
                "started_ts": 1, "finished_ts": 2, "duration_s": 1.0,
                "evidence_min": "2026-09-08", "evidence_max": "2026-09-08",
                "evidence_distinct": 1, "active_set_n": 1, "judged": 1,
                "skipped": 0, "capped": 0, "render_failed": 0, "errored": 0,
                "aborted": 0, "abort_ticker": None, "paid_calls": 1,
                "spend_usd": 0.02})
    sources = sorted(r["source"] for r in _slots(s))
    assert sources == ["cron", "manual"]
