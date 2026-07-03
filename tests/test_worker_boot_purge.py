"""Worker boot must not block on the weekly-key purge.

2026-07-02 incident: purge_mis_keyed_weekly_rows() ran inline in
worker_main.main() BEFORE uvicorn brought up /api/health. Its DISTINCT scan
takes minutes on the worker's multi-GB ohlcv table, Railway's healthcheck
window (600s) expired, and every worker deploy FAILED — so the weekly-candle
fix never actually reached the worker (the R2 snapshot source of truth).

Contract: the purge runs on a background thread (boot reaches uvicorn.run
immediately), and the R2 uploader does not start until the purge finished —
a snapshot must never be taken with the stale Monday rows still present.
"""

import threading
import time
from unittest.mock import patch

import api.worker_main as wm


def _boot_with_blocking_purge(purge_gate: threading.Event, calls: dict):
    """Run wm.main() with all side-effectful pieces stubbed. The purge blocks
    on `purge_gate` so tests control when it 'finishes'. Records call times."""

    def fake_purge():
        calls["purge_started"] = time.monotonic()
        purge_gate.wait(timeout=10)
        calls["purge_finished"] = time.monotonic()
        return 0

    def fake_uvicorn_run(*a, **k):
        calls["uvicorn_run"] = time.monotonic()

    def fake_uploader():
        calls["uploader"] = time.monotonic()

    with patch("api.services.bars_sqlite.init_db"), \
         patch("api.services.bars_sqlite.purge_mis_keyed_weekly_rows", fake_purge), \
         patch.object(wm, "_start_prewarmer"), \
         patch.object(wm, "_start_massive_ws"), \
         patch.object(wm, "_start_uploader", fake_uploader), \
         patch.object(wm, "_start_keepwarm"), \
         patch.object(wm, "_start_memwatch"), \
         patch.object(wm, "_build_app", return_value=None), \
         patch.object(wm.uvicorn, "run", fake_uvicorn_run):
        wm.main()
        # main() returned (uvicorn.run stubbed). HOLD the patches until the
        # purge thread has run to completion (or timeout) — dropping them
        # early would let the background thread resolve the REAL uploader.
        deadline = time.monotonic() + 10
        while "uploader" not in calls and time.monotonic() < deadline:
            time.sleep(0.05)


def test_boot_reaches_uvicorn_while_purge_still_running():
    """A slow purge must NOT delay the health endpoint (the deploy killer)."""
    purge_gate = threading.Event()  # stays closed: purge hangs forever
    calls: dict = {}

    t = threading.Thread(
        target=_boot_with_blocking_purge, args=(purge_gate, calls), daemon=True
    )
    t.start()
    t.join(timeout=5)

    assert "uvicorn_run" in calls, (
        "main() never reached uvicorn.run while the purge was blocked — "
        "boot is serialized behind the purge and Railway healthchecks fail"
    )
    purge_gate.set()  # unblock the purge thread
    # Wait for the harness (and its patches) to unwind COMPLETELY before the
    # next test patches the same module — overlapping patch.object restores
    # from two tests clobber each other's stubs.
    t.join(timeout=15)
    assert not t.is_alive()


def test_uploader_waits_for_purge_completion():
    """No R2 snapshot upload may start before the purge finished, or a stale
    snapshot re-poisons the web pod (the original weekly-dup incident)."""
    purge_gate = threading.Event()
    calls: dict = {}

    t = threading.Thread(
        target=_boot_with_blocking_purge, args=(purge_gate, calls), daemon=True
    )
    t.start()

    # Wait until boot completed (uvicorn stub called) with the purge still open.
    deadline = time.monotonic() + 5
    while "uvicorn_run" not in calls and time.monotonic() < deadline:
        time.sleep(0.05)
    assert "uvicorn_run" in calls

    time.sleep(0.3)  # give a wrongly-eager uploader a chance to start
    assert "uploader" not in calls, "uploader started BEFORE the purge finished"

    purge_gate.set()
    deadline = time.monotonic() + 5
    while "uploader" not in calls and time.monotonic() < deadline:
        time.sleep(0.05)
    assert "uploader" in calls, "uploader never started after the purge finished"
    assert calls["uploader"] >= calls["purge_finished"]
    t.join(timeout=15)
    assert not t.is_alive()
