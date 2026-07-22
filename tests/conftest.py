import pytest


@pytest.fixture(autouse=True)
def _isolate_fundamentals_snapshot_store(tmp_path, monkeypatch):
    """Point the persistent fundamentals snapshot store at a per-test temp DB.

    Without this, tests would share a fundamentals_tables.db in the repo working
    dir and stale-while-revalidate would serve one test's persisted payload to
    another (or to a later full run)."""
    monkeypatch.setenv("FUNDAMENTALS_TABLES_DB_PATH", str(tmp_path / "fund_snapshots.db"))
