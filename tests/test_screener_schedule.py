"""Rails for `register_screener_jobs` (api/main.py): the nightly build's master switch,
and the UCT RS rating-history job registered beside it (engineering map
docs/superpowers/plans/2026-11-06-uct-rs-phase2-engineering-map.md, unit 2a-04).

The rating-history rails READ the registration off a fake scheduler and drive the
registered function itself; `rs_history.nightly_job` is stubbed, so no bars store is
needed. `tests/test_rs_rating_history.py` pins that the module reads no env var: the
flag is read in api.main, per call, and that is what these tests exercise.
"""
import ast
import pathlib

import pytest

import api.main as m


class _FakeSched:
    def __init__(self):
        self.ids = []
        self.jobs = {}

    def add_job(self, fn, **k):
        self.ids.append(k.get("id"))
        self.jobs[k.get("id")] = (fn, k)


def test_screener_job_registered(monkeypatch):
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    sched = _FakeSched()
    assert m.register_screener_jobs(sched) is True
    assert "screener_snapshot_nightly" in sched.ids


def test_screener_job_can_be_disabled(monkeypatch):
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "0")
    sched = _FakeSched()
    assert m.register_screener_jobs(sched) is False
    assert sched.ids == []
    # the screener FAMILY switch pauses the rating history with the rest, by name
    assert "rs_history_nightly" not in sched.ids


# --------------------------------------------------------------------------- #
# UCT RS rating history: `rs_history_nightly` (unit 2a-04)
# --------------------------------------------------------------------------- #

RS_JOB = "rs_history_nightly"

#: 100 targets, 70 rated: short_history + stale + no_bars = 30, over the 20% line.
SHORT_RECEIPT = {"ok": True, "session": "2026-11-05", "targets": 100, "rated": 70, "rows": 70,
                 "short_history": 20, "stale": 5, "no_bars": 5, "split_guard": 0,
                 "fast_filled": 70, "duration_ms": 1234.5, "note": {"source": "nightly"}}
#: 95 rated, 5 unrated: under the line.
FULL_RECEIPT = {**SHORT_RECEIPT, "rated": 95, "rows": 95,
                "short_history": 3, "stale": 1, "no_bars": 1}


def _cron_field(trigger, name) -> str:
    """Read off the trigger object the scheduler will use, never off the call."""
    for field in trigger.fields:
        if field.name == name:
            return str(field)
    raise AssertionError(f"the trigger declares no {name}")


def _register(monkeypatch, **env):
    """Register the screener job family against a fake scheduler. The boot warm is
    stubbed: it is a boot side effect, not part of what registration asserts."""
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setattr(m, "start_screener_snapshot_warm", lambda: None)
    for key, value in env.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)
    sched = _FakeSched()
    assert m.register_screener_jobs(sched) is True
    return sched


def _seen_alerts(monkeypatch):
    """Capture `chart_health_alerts.emit`, the emitter the screener build's own
    shortfall alert (`_alert_if_nightly_short`) goes through."""
    from api.services import chart_health_alerts
    seen = []
    monkeypatch.setattr(
        chart_health_alerts, "emit",
        lambda key, sev, msg, meta=None: seen.append((key, sev, msg, meta)) or True)
    return seen


def _stub_nightly(monkeypatch, receipt=None, raises=None):
    from api.services.screener import rs_history
    calls = []

    def _nightly_job(*a, **k):
        calls.append((a, k))
        if raises is not None:
            raise raises
        return dict(receipt)

    monkeypatch.setattr(rs_history, "nightly_job", _nightly_job)
    return calls


def test_the_rs_history_job_has_its_OWN_0415_ET_cron_with_coalesce_and_grace(monkeypatch):
    """The map's unmeasured-runtime path: its own cron, not a call inside the 03:00
    build. 04:15 ET, `coalesce=True`, a grace that beats apscheduler's 1-second
    default (the watchdog's 3600), one instance, `replace_existing` like every sibling."""
    sched = _register(monkeypatch)
    assert RS_JOB in sched.jobs
    fn, kw = sched.jobs[RS_JOB]
    assert fn is m._run_rs_history
    assert _cron_field(kw["trigger"], "hour") == "4"
    assert _cron_field(kw["trigger"], "minute") == "15"
    assert str(kw["trigger"].timezone) == "America/New_York"
    assert kw["max_instances"] == 1
    assert kw["replace_existing"] is True
    assert kw["coalesce"] is True
    assert kw["misfire_grace_time"] == 3600
    # and it is not the build job's function: the build stays free of unmeasured work
    build_fn, _ = sched.jobs["screener_snapshot_nightly"]
    assert build_fn is not fn


def test_the_rs_history_add_job_is_wrapped_in_NO_flag_test__BY_AST():
    """Registered unconditionally, so arming and rollback need no deploy: the
    `add_job` sits under zero `if` statements in `register_screener_jobs`'s body.
    Control: the flag-gated nightly sweep comes back gated, so the probe can see."""
    src = pathlib.Path(m.__file__).read_text(encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "register_screener_jobs")
    depth = {}

    def _walk(body, d):
        for stmt in body:
            if isinstance(stmt, ast.If):
                _walk(stmt.body, d + 1)
                _walk(stmt.orelse, d + 1)
                continue
            for node in ast.walk(stmt):
                if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "add_job":
                    for kw in node.keywords:
                        if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                            depth[kw.value.value] = d

    _walk(fn.body, 0)
    assert depth.get(RS_JOB) == 0
    assert depth.get("screener_scan_sweep", 0) >= 1   # control: the probe sees gating


def test_the_job_is_a_no_op_while_RS_HISTORY_ENABLED_is_unset(monkeypatch):
    """Off: no `nightly_job` call (the side tables are created on first write, so
    nothing is touched) and no alert. The registration is still there."""
    sched = _register(monkeypatch, RS_HISTORY_ENABLED=None)
    calls = _stub_nightly(monkeypatch, SHORT_RECEIPT)
    seen = _seen_alerts(monkeypatch)
    fn, _ = sched.jobs[RS_JOB]
    assert fn() is None
    assert calls == [] and seen == []
    assert m.rs_history_enabled() is False


@pytest.mark.parametrize("value", ["0", "", "true", "True", "yes", "on", " 1"])
def test_only_a_literal_1_arms_the_flag(monkeypatch, value):
    monkeypatch.setenv("RS_HISTORY_ENABLED", value)
    assert m.rs_history_enabled() is False
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    assert m.rs_history_enabled() is True


def test_the_flag_is_read_PER_CALL_not_at_registration(monkeypatch):
    """Registered dark, armed afterwards: the next fire runs. That is the whole
    reason the registration is unconditional."""
    sched = _register(monkeypatch, RS_HISTORY_ENABLED=None)
    calls = _stub_nightly(monkeypatch, FULL_RECEIPT)
    _seen_alerts(monkeypatch)
    fn, _ = sched.jobs[RS_JOB]
    fn()
    assert calls == []
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    fn()
    assert len(calls) == 1


def test_on_it_calls_nightly_job_ONCE_with_defaults_and_alerts_ONCE_on_a_30pct_shortfall(
        monkeypatch):
    sched = _register(monkeypatch, RS_HISTORY_ENABLED="1")
    calls = _stub_nightly(monkeypatch, SHORT_RECEIPT)
    seen = _seen_alerts(monkeypatch)
    fn, _ = sched.jobs[RS_JOB]
    assert fn() is None
    assert calls == [((), {})], "the module resolves session, universe and reader itself"
    assert len(seen) == 1
    key, sev, msg, meta = seen[0]
    assert key == "rs_history_short:2026-11-05"
    assert sev == "warning"
    assert "30 of 100" in msg
    assert meta["targets"] == 100 and meta["rated"] == 70 and meta["session"] == "2026-11-05"


def test_a_full_receipt_raises_no_alert(monkeypatch):
    """Control for the test above: the emitter is wired and silence means enough rated."""
    sched = _register(monkeypatch, RS_HISTORY_ENABLED="1")
    calls = _stub_nightly(monkeypatch, FULL_RECEIPT)
    seen = _seen_alerts(monkeypatch)
    sched.jobs[RS_JOB][0]()
    assert len(calls) == 1 and seen == []


@pytest.mark.parametrize("receipt, why", [
    (FULL_RECEIPT, None),
    ({**FULL_RECEIPT, "short_history": 20, "stale": 0, "no_bars": 0}, None),       # exactly 20%: fine
    ({**FULL_RECEIPT, "short_history": 20, "stale": 1, "no_bars": 0}, "21 of 100"),  # 21%: short
    ({**FULL_RECEIPT, "rated": 0}, "no name was rated"),
    ({"ok": False, "session": "2026-11-05", "targets": 100, "rated": 0,
      "note": {"error": "RuntimeError: x"}}, "RuntimeError: x"),
    ({"ok": False, "session": None, "targets": None, "rated": 0,
      "note": {"reason": "no_session"}}, "no_session"),
    ({"crashed": "ImportError: y"}, "crashed"),
])
def test_the_shortfall_rule(receipt, why):
    out = m._rs_history_shortfall(receipt)
    if why is None:
        assert out is None
    else:
        assert why in out


def test_the_job_never_raises_and_a_crash_still_alerts_under_todays_key(monkeypatch):
    sched = _register(monkeypatch, RS_HISTORY_ENABLED="1")
    _stub_nightly(monkeypatch, raises=RuntimeError("boom"))
    seen = _seen_alerts(monkeypatch)
    assert sched.jobs[RS_JOB][0]() is None
    assert len(seen) == 1
    key, sev, msg, meta = seen[0]
    assert key.startswith("rs_history_short:") and sev == "warning" and "boom" in msg
    assert meta["crashed"] == "RuntimeError: boom"


def test_a_failing_emitter_never_reaches_the_scheduler(monkeypatch):
    from api.services import chart_health_alerts
    sched = _register(monkeypatch, RS_HISTORY_ENABLED="1")
    _stub_nightly(monkeypatch, SHORT_RECEIPT)
    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("pager down")))
    assert sched.jobs[RS_JOB][0]() is None


# --------------------------------------------------------------------------- #
# /api/screener/snapshot-status: the `rs_history` block
# --------------------------------------------------------------------------- #

def _seed_screener(tmp_path, monkeypatch):
    """A screener.db with its schema and one built row, so the endpoint's own
    `snapshot_db.status()` answers (the live-surface tests' `_seed` recipe). The
    rs_history side tables are NOT created here: the block creates them on read."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    import api.services.screener.snapshot_db as db
    db.init_db()
    db.upsert_rows([{"ticker": "AAA", "price": 10.0, "uct_composite": 80, "sector": "Tech",
                     "snapshot_date": "2026-11-05", "built_at": 1}])


def test_snapshot_status_carries_an_rs_history_block(monkeypatch, tmp_path):
    from api.routers import screener as scr
    _seed_screener(tmp_path, monkeypatch)
    monkeypatch.setenv("RS_HISTORY_ENABLED", "1")
    body = scr.screener_snapshot_status(user={"role": "member"})
    block = body["rs_history"]
    assert block["enabled"] is True
    assert block["table"] == "rs_rating_history"
    assert block["rows"] == 0 and block["sessions"] == 0 and block["latest_session"] is None
    assert block["last_run"] is None
    assert "backfill" in block
    assert "error" not in block
    # and the flag is read per request, through the ONE reader in api.main
    monkeypatch.delenv("RS_HISTORY_ENABLED")
    assert scr._rs_history_block()["enabled"] is False


def test_the_rs_history_block_survives_a_status_crash_and_never_costs_the_endpoint(
        monkeypatch, tmp_path):
    from api.routers import screener as scr
    from api.services.screener import rs_history
    _seed_screener(tmp_path, monkeypatch)
    monkeypatch.setattr(rs_history, "status",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    body = scr.screener_snapshot_status(user={"role": "member"})
    assert body["rs_history"]["error"] == "RuntimeError: boom"
    assert "enabled" in body["rs_history"]
    assert "live" in body and "snapshot_date" in body   # the rest of the endpoint still answers
