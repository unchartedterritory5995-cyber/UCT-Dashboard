"""NOT A SUITE — a one-test fixture run in a SUBPROCESS by
`tests/test_shared_data_root_guard.py`.

Deliberately named `_e5_…` rather than `test_…` so it matches none of pytest's
`python_files` patterns and never joins the real suite. pytest still collects a
file handed to it as an explicit argument (`session.isinitpath`), which is how
the rail runs it.

What it demonstrates: **every test in a session can pass while the session is
still dirty.** A daemon thread's exception goes to `threading.excepthook` and
disappears, so the test that spawned it is green. The run must fail anyway —
that is `pytest_sessionfinish`'s job in the repo-root conftest, and this is the
only way to watch it do it.

⛔ The write is aimed at a throwaway PROBE directory named by `E5_PROBE_ROOT`,
never at `C:\\data`.
"""
import os
import sqlite3
import threading

import conftest as rootconf


def test_the_test_itself_passes_while_a_thread_writes_into_the_probe_root():
    probe = os.environ["E5_PROBE_ROOT"]
    os.makedirs(probe, exist_ok=True)
    finished = threading.Event()

    def worker():
        try:
            sqlite3.connect(os.path.join(probe, "escaped.db")).close()
        except BaseException:            # noqa: BLE001 — a daemon swallows it
            pass
        finished.set()

    with rootconf.pretend_shared_root(probe):
        thread = threading.Thread(target=worker, daemon=True,
                                  name="e5-probe-escapee")
        thread.start()
        assert finished.wait(20)
        thread.join(5)

    # Green on purpose. The whole point is that this assertion is true and the
    # run is still unsafe.
    assert True


def test_a_SWALLOWED_main_thread_write_is_still_failed_by_the_fixture():
    """The other half: a `except Exception: pass` around the write.

    Half this repo's stores are opened inside a `try/except` that logs and
    carries on, so raising is not by itself a failure anybody sees. The autouse
    per-test fixture has to fail the test even when the test caught the raise.
    """
    probe = os.environ["E5_PROBE_ROOT"]
    os.makedirs(probe, exist_ok=True)
    with rootconf.pretend_shared_root(probe):
        try:
            sqlite3.connect(os.path.join(probe, "swallowed.db")).close()
        except Exception:                # noqa: BLE001 — the shape being tested
            pass
    assert True
