"""A forward-only quarterly calendar is not a complete earnings table.

Production, 8 Sep 2026: MU served 12 annual rows and 4 quarterly rows that were
all unreported with null actuals. The existing guard only asked whether the two
lists were NON-EMPTY, so that passed as complete, was pinned for 6h and written
to disk. Overview's Q Sales YoY / EPS Last Q / EPS QoQ / EPS YoY all read the
REPORTED quarters, so every one went blank — while a cache-bypassing rebuild
produced 5 reported quarters immediately.
"""
import pytest

from api.services import earnings_table as et

ANNUAL = [{"fiscal_year": 2025, "eps": 7.65}]
FORWARD_ONLY = {"ticker": "MU", "annual": ANNUAL, "quarterly": [
    {"label": "2026 Q1", "reported": False, "eps_actual": None},
    {"label": "2026 Q2", "reported": False, "eps_actual": None},
]}
COMPLETE = {"ticker": "MU", "annual": ANNUAL, "quarterly": [
    {"label": "2025 Q3", "reported": True, "eps_actual": 4.78},
    {"label": "2026 Q1", "reported": False, "eps_actual": None},
]}


class TestSnapshotCompleteness:
    def test_a_forward_only_calendar_is_not_complete(self):
        assert et._snapshot_is_complete(FORWARD_ONLY) is False

    def test_a_table_with_reported_quarters_is_complete(self):
        assert et._snapshot_is_complete(COMPLETE) is True

    def test_empty_quarterly_is_not_complete(self):
        assert et._snapshot_is_complete({"annual": ANNUAL, "quarterly": []}) is False

    def test_junk_is_not_complete(self):
        for bad in (None, "nope", 42, {}):
            assert et._snapshot_is_complete(bad) is False

    def test_a_pre_revenue_name_is_not_punished(self):
        """No annual history AND no reported quarters is a legitimate state for
        a freshly listed company — not the inconsistency this guard targets."""
        assert et._snapshot_is_complete(
            {"annual": [], "quarterly": [{"label": "2026 Q1", "reported": False}]}
        ) is True


class TestPartialIsNotPersisted:
    def _run(self, monkeypatch, built):
        puts, sets = [], []
        monkeypatch.setattr(et, "_build", lambda t, n: (built, True))
        monkeypatch.setattr(et.cache, "set", lambda k, v, t: sets.append(t))
        monkeypatch.setattr(et.snap_store, "put",
                            lambda *a, **k: puts.append(a))
        et._build_and_cache("MU", now=0)
        return puts, sets

    def test_forward_only_is_held_briefly_and_never_persisted(self, monkeypatch):
        puts, sets = self._run(monkeypatch, dict(FORWARD_ONLY))
        assert puts == [], "a forward-only table must not reach the snapshot store"
        assert sets == [et._EMPTY_TTL], (
            f"cached for {sets}; must take the short retry TTL so it self-heals")

    def test_a_complete_table_is_persisted(self, monkeypatch):
        puts, _sets = self._run(monkeypatch, dict(COMPLETE))
        assert len(puts) == 1
