"""Boot-window probe + EE stage trace (2026-10-06 boot stall).

MEASURED: the first TSM EE open after the 20:01:47 UTC boot entered its handler at
20:03:20.5, its FMP leg took 0.3 s and its Yahoo leg 147.7 s, while the only vendor call on
that leg is bounded at 15 s and logged nothing. These rails prove the instruments that will
name the stuck stage on the next boot actually fire -- each with a control proving it can
stay silent, so a probe that always (or never) reports cannot pass.

No network, no uvicorn.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import threading
import time
import types

import pytest

from api.services import boot_probe


@pytest.fixture(autouse=True)
def _clean():
    boot_probe.reset_for_tests()
    yield
    boot_probe.reset_for_tests()


def _park_tracked(label: str, release: threading.Event, entered: threading.Event,
                  track: bool = True):
    def _parked_here():
        entered.set()
        release.wait(10)

    def _run():
        if track:
            with boot_probe.track(label):
                boot_probe.note("waiting-on-thing")
                _parked_here()
        else:
            _parked_here()

    t = threading.Thread(target=_run, daemon=True, name=f"probe-{label}")
    t.start()
    assert entered.wait(5)
    return t


# ── 1. a stuck tracked block gets its stack dumped ──────────────────────────────────────

def test_a_stuck_tracked_block_dumps_the_frame_it_is_parked_in():
    release, entered = threading.Event(), threading.Event()
    t = _park_tracked("ee-yf TSM", release, entered)
    try:
        now = time.monotonic() + 11.0
        lines = boot_probe.slow_stacks(now=now)
        assert len(lines) == 1, lines
        line = lines[0]
        assert line.startswith("[slow-stack] ee-yf TSM age=")
        assert "stage=waiting-on-thing" in line
        assert "_parked_here" in line          # the frame it is parked in -- the answer
        assert "thread=probe-ee-yf TSM" in line
        # rate-limited: the same threshold never logs twice
        assert boot_probe.slow_stacks(now=now) == []
        # the next threshold (30 s) logs again
        assert len(boot_probe.slow_stacks(now=now + 25.0)) == 1
    finally:
        release.set()
        t.join(5)
    assert boot_probe.tracked_count() == 0     # the block unregistered itself


def test_control_a_young_or_untracked_block_dumps_nothing():
    release, entered = threading.Event(), threading.Event()
    e2 = threading.Event()
    t1 = _park_tracked("young", release, entered)
    t2 = _park_tracked("untracked", release, e2, track=False)
    try:
        assert boot_probe.tracked_count() == 1
        assert boot_probe.slow_stacks() == []  # 'young' is < 10 s old, 'untracked' unseen
    finally:
        release.set()
        t1.join(5)
        t2.join(5)


def test_track_is_reentrant_and_restores_the_outer_block():
    with boot_probe.track("outer"):
        with boot_probe.track("inner"):
            boot_probe.note("in-inner")
        ident = threading.get_ident()
        assert boot_probe._tracked[ident].label == "outer"
    assert boot_probe.tracked_count() == 0


# ── 2. threads inside an import are named, by the import statement's line ───────────────

def test_a_thread_blocked_inside_an_import_is_reported(tmp_path, monkeypatch):
    gate = threading.Event()
    started = threading.Event()
    holder = types.ModuleType("_bp_gate_holder")
    holder.gate, holder.started = gate, started
    monkeypatch.setitem(sys.modules, "_bp_gate_holder", holder)
    (tmp_path / "_bp_slow_import_mod.py").write_text(
        "import _bp_gate_holder as h\nh.started.set()\nh.gate.wait(10)\n", encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))
    sys.modules.pop("_bp_slow_import_mod", None)

    def _importer():
        import _bp_slow_import_mod  # noqa: F401

    t = threading.Thread(target=_importer, daemon=True, name="bp-importer")
    t.start()
    try:
        assert started.wait(5)
        found = [x for x in boot_probe.importing_threads(limit=50) if x.startswith("bp-importer@")]
        assert len(found) == 1, boot_probe.importing_threads(limit=50)
        assert "test_boot_probe.py" in found[0]   # the `import` statement's own file
    finally:
        gate.set()
        t.join(5)
        sys.modules.pop("_bp_slow_import_mod", None)
    # control: once the import finished, the same thread is no longer reported
    assert not [x for x in boot_probe.importing_threads(limit=50) if x.startswith("bp-importer@")]


def test_control_a_parked_thread_outside_any_import_is_not_reported():
    release, entered = threading.Event(), threading.Event()
    t = _park_tracked("plain", release, entered, track=False)
    try:
        assert not [x for x in boot_probe.importing_threads(limit=50)
                    if x.startswith("probe-plain@")]
    finally:
        release.set()
        t.join(5)


# ── 3. the sampler reads the anyio limiter from the loop and logs inside the window ─────

def _run_sampler(boot_window: float, ticks: int = 3) -> None:
    async def _main():
        task = asyncio.get_running_loop().create_task(
            boot_probe.run_sampler(tick=0.01, boot_window=boot_window))
        await asyncio.sleep(0.01 * ticks + 0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    asyncio.run(_main())


def test_the_sampler_logs_the_threadpool_and_threads_inside_the_boot_window(caplog):
    with caplog.at_level(logging.INFO, logger="boot_probe"):
        _run_sampler(boot_window=1e9)
    lines = [m for m in caplog.messages if m.startswith("[boot-probe]")]
    assert lines, caplog.messages
    line = lines[0]
    # a real anyio reading "borrowed/total waiting=N", not the "?" fallback
    assert " anyio 0/" in line and "waiting=0" in line, line
    assert "threads=" in line and "loop-lag=" in line and "cpu=" in line, line
    assert "importing=" in line and "yf q=" in line, line


def test_control_the_sampler_is_silent_after_the_boot_window(caplog):
    with caplog.at_level(logging.INFO, logger="boot_probe"):
        _run_sampler(boot_window=0.0)
    assert not [m for m in caplog.messages if m.startswith("[boot-probe]")]


def test_the_lifespan_starts_the_sampler_on_the_loop():
    """Wiring rail: an instrument nobody starts reads as coverage. AST over api/main.py's
    lifespan, with a control that the probe sees a sibling start it is not looking for."""
    import ast
    from pathlib import Path
    tree = ast.parse((Path(__file__).resolve().parents[1] / "api" / "main.py")
                     .read_text(encoding="utf-8"))
    life = next(n for n in tree.body
                if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    called = {n.func.attr for n in ast.walk(life)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "run_sampler" in called
    assert "_start_thread_burst_watch" not in called  # control: a bare-name call, not attr
    names = {n.func.id for n in ast.walk(life)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "_start_thread_burst_watch" in names       # the probe can see a sibling start


# ── 4. the EE build names its slow stage ────────────────────────────────────────────────

class _FakeTicker:
    def __init__(self, sym):
        self.earnings_estimate = None
        self.revenue_estimate = None
        self.eps_trend = None
        self.eps_revisions = None


def _wire_build(monkeypatch, entity_sleep: float):
    from api.services.research import estimates as est
    from api.services.cache import cache
    cache.invalidate("research_est::ZZST")
    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(Ticker=_FakeTicker))
    monkeypatch.setattr(est, "run_in_pool", lambda fn, timeout=None: fn())

    def _slow_entity(sym, **_):
        time.sleep(entity_sleep)
        return {"status": "not_found", "entityId": None}, sym
    monkeypatch.setattr(est, "resolve_entity", _slow_entity)
    return est


def test_a_slow_build_logs_every_stage_it_went_through(monkeypatch, caplog):
    est = _wire_build(monkeypatch, entity_sleep=0.05)
    monkeypatch.setattr(est, "_SLOW_STAGE_S", 0.01)
    with caplog.at_level(logging.WARNING, logger=est._logger.name):
        out = est._build_estimates("ZZST")
    assert out["sym"] == "ZZST"
    lines = [m for m in caplog.messages if m.startswith("[ee-stage] ZZST build")]
    assert len(lines) == 1, caplog.messages
    line = lines[0]
    for stage in ("cache=", "entity=", "fetch=", "pool_wait=", "yf_import=", "set="):
        assert stage in line, line
    # the slow stage is the one that carries the time
    entity_s = float(line.split("entity=")[1].split()[0])
    assert entity_s >= 0.04, line


def test_control_a_fast_build_logs_no_stage_line(monkeypatch, caplog):
    est = _wire_build(monkeypatch, entity_sleep=0.0)
    with caplog.at_level(logging.WARNING, logger=est._logger.name):
        est._build_estimates("ZZST")
    assert not [m for m in caplog.messages if m.startswith("[ee-stage]")]


# ── 5. the route logs its entry inside the boot window ──────────────────────────────────

def _stub_route(monkeypatch):
    from api.routers import research as r
    monkeypatch.setattr(r, "get_estimates", lambda s: {"sym": s, "forward": [], "revisions": []})
    import api.services.research.estimates_consensus as ec
    monkeypatch.setattr(ec, "get_consensus", lambda s: {"sym": s, "state": "ok",
                                                         "annual": [], "quarterly": []})
    return r


def test_the_route_logs_its_entry_inside_the_boot_window(monkeypatch, caplog):
    r = _stub_route(monkeypatch)
    monkeypatch.setattr(boot_probe, "in_entry_window", lambda: True)
    with caplog.at_level(logging.INFO, logger=r._logger.name):
        r.research_estimates("ZZEN", consensus=1)
    assert [m for m in caplog.messages if m.startswith("[ee-enter] ZZEN consensus=1 boot+")]


def test_control_the_route_entry_line_is_silent_after_the_window(monkeypatch, caplog):
    r = _stub_route(monkeypatch)
    monkeypatch.setattr(boot_probe, "in_entry_window", lambda: False)
    with caplog.at_level(logging.INFO, logger=r._logger.name):
        r.research_estimates("ZZEN", consensus=1)
    assert not [m for m in caplog.messages if m.startswith("[ee-enter]")]
