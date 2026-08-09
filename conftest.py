"""Repo-root conftest — AUTH_DB_PATH isolation for EVERY collection root.

`tests/conftest.py` has installed this isolation since `021b4926`, and it works
— but a conftest only reaches the directory it lives in. There are 93 test files
under `api/**` (mixed `*_test.py` and `test_*.py`) with no conftest of their own,
so `pytest api/services/journal_two/test_trades.py` — or any run that does not
also collect `tests/` — got NO isolation at all and wrote straight into the real
store: `C:\\data\\auth.db`, 20,640 users deep and holding the owner's live j2_*
tables. Nothing surfaced that, because those 93 files were never in the suite.

⚠️ THIS MUST RUN AT CONFTEST IMPORT, NOT IN A FIXTURE. `AUTH_DB_PATH` is read
ONCE, at module import, by six product modules (auth_db,
awareness.regime_snapshots, bar_provenance, bar_quarantine, bars_audit,
indicator_alert_service) — `get_connection()` closes over the module global, not
over `os.environ` — so a `monkeypatch.setenv` in a fixture reaches none of them.
The repo-root conftest is imported before any other conftest and before any test
module, so nothing can capture the unisolated path ahead of it.

`tests/conftest.py` READS this value back rather than minting a second temp
store: two isolated stores in one session would split the six import-time
capturers from the seven journal_two modules that re-read per call.
"""
import os
import tempfile

ISOLATED_AUTH_DB = os.path.join(
    tempfile.mkdtemp(prefix="uct_tests_authdb_"), "auth.db"
)
os.environ["AUTH_DB_PATH"] = ISOLATED_AUTH_DB

# ─── screener boot self-warm: OFF under pytest ─────────────────────────────
#
# `register_screener_jobs()` starts a `screener-warm` daemon thread that sleeps
# ~120s and then runs `snapshot_builder.run_build()` — real SQLite writes to the
# real `screener.db` and one UNCACHED Massive REST call per ticker, on whatever
# API key the developer's environment happens to hold.
#
# `tests/test_screener_schedule.py` calls that registration directly, and a full
# suite run lasts ~7 minutes — comfortably longer than the delay. So the thread
# WOULD wake mid-run and start hammering a live provider from a test process,
# with the writes landing outside any fixture's teardown. Setting the flag here
# (at conftest import, before any test module) makes the warm opt-IN: the tests
# that exercise it re-enable it explicitly with a stubbed builder and zero delay.
os.environ.setdefault("SCREENER_SNAPSHOT_WARM_ENABLED", "0")
