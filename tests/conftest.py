import pytest


@pytest.fixture(autouse=True)
def _isolate_fundamentals_snapshot_store(tmp_path, monkeypatch):
    """Point the persistent fundamentals snapshot store at a per-test temp DB.

    Without this, tests would share a fundamentals_tables.db in the repo working
    dir and stale-while-revalidate would serve one test's persisted payload to
    another (or to a later full run)."""
    monkeypatch.setenv("FUNDAMENTALS_TABLES_DB_PATH", str(tmp_path / "fund_snapshots.db"))


@pytest.fixture(autouse=True)
def _reset_calendar_serve_stale():
    """Clear the Calendar's serve-stale slots between tests.

    Same hazard as the fundamentals fixture above: `/api/calendar` and the
    enrichment endpoints keep the last GOOD payload in module-level slots so a
    real user never pays the cold multi-provider rebuild. In a test process
    that state is shared, so one test's mocked week would be served to the
    next test that expects to drive a build of its own.

    Looked up via sys.modules rather than imported: forcing this heavy router
    into every unrelated test would be a side effect of the fixture itself."""
    import sys

    def _clear():
        mod = sys.modules.get("api.routers.calendar")
        if mod is None:
            return
        for slot in (getattr(mod, "_WEEKLY_STALE", None),
                     getattr(mod, "_ENRICH_STALE", None)):
            if slot is not None:
                slot._slots.clear()

    _clear()
    yield
    _clear()
