"""A payload without its quarterly series must never be remembered.

Production, 8 Sep 2026: a rebuild returned empty `quarters` and `estimates` but
populated `annual`. `_has_content` accepted that as complete, so it was cached
at full TTL and written to disk — and the Earnings tab read "No earnings history
is available for MU" while serving it stale. `annual` is derived from the
statements document; the quarters need the fiscal calendar and the estimates
provider, so losing them while annual survives is a REACHABLE state, not a
theoretical one.
"""
import pytest

from api.services import earnings_intel as ei

ANNUAL_ONLY = {"ticker": "MU", "quarters": [], "estimates": [],
               "annual": {"reported": [{"fiscal_year": 2025, "eps": 7.65}]}}
FULL = {"ticker": "MU", "quarters": [{"label": "FY2026 Q3"}], "estimates": [],
        "annual": {"reported": [{"fiscal_year": 2025}]}}
EMPTY = {"ticker": "MU", "quarters": [], "estimates": [], "annual": {}}


class TestPartialPayloadContract:
    def test_annual_only_is_content_but_NOT_quarterly(self):
        """The exact shape that poisoned the cache."""
        assert ei._has_content(ANNUAL_ONLY) is True
        assert ei._has_quarterly(ANNUAL_ONLY) is False

    def test_a_real_payload_is_both(self):
        assert ei._has_content(FULL) is True
        assert ei._has_quarterly(FULL) is True

    def test_estimates_alone_still_count_as_quarterly(self):
        """A pre-IPO//pre-print ticker with only forward estimates is a genuine
        quarterly payload, not a partial one."""
        p = {"quarters": [], "estimates": [{"label": "FY2027 Q1"}], "annual": {}}
        assert ei._has_quarterly(p) is True

    def test_empty_is_neither(self):
        assert ei._has_content(EMPTY) is False
        assert ei._has_quarterly(EMPTY) is False


class TestPersistenceGate:
    def test_a_partial_build_is_never_written_to_disk(self, monkeypatch):
        puts, sets = [], []
        monkeypatch.setattr(ei, "_build", lambda sym: dict(ANNUAL_ONLY))
        monkeypatch.setattr(ei.cache, "get", lambda k: None)
        monkeypatch.setattr(ei.cache, "set", lambda k, v, t: sets.append(t))
        monkeypatch.setattr(ei.snap_store, "get", lambda k, s: None)
        monkeypatch.setattr(ei.snap_store, "put",
                            lambda *a, **k: puts.append(a))

        out = ei.get_earnings("MU")
        assert out["annual"]["reported"], "still returned to the caller"
        assert puts == [], "a partial build must not be persisted"
        assert sets and sets[0] <= ei._PARTIAL_TTL, (
            f"partial build cached for {sets[0]}s; must be brief so it retries")

    def test_a_complete_build_is_persisted(self, monkeypatch):
        puts = []
        monkeypatch.setattr(ei, "_build", lambda sym: dict(FULL))
        monkeypatch.setattr(ei.cache, "get", lambda k: None)
        monkeypatch.setattr(ei.cache, "set", lambda k, v, t: None)
        monkeypatch.setattr(ei.snap_store, "get", lambda k, s: None)
        monkeypatch.setattr(ei.snap_store, "put", lambda *a, **k: puts.append(a))
        ei.get_earnings("MU")
        assert len(puts) == 1

    def test_a_persisted_partial_is_ignored_and_rebuilt(self, monkeypatch):
        """Entries the OLD permissive check already wrote must not keep being
        served — otherwise the fix heals nothing until they age out."""
        built = []

        def build(sym):
            built.append(sym)
            return dict(FULL)

        monkeypatch.setattr(ei, "_build", build)
        monkeypatch.setattr(ei.cache, "get", lambda k: None)
        monkeypatch.setattr(ei.cache, "set", lambda k, v, t: None)
        monkeypatch.setattr(ei.snap_store, "get",
                            lambda k, s: (dict(ANNUAL_ONLY), 10, 86400))
        monkeypatch.setattr(ei.snap_store, "put", lambda *a, **k: None)

        out = ei.get_earnings("MU")
        assert built == ["MU"], "a stored partial must be treated as a miss"
        assert out["quarters"], "and replaced with a real build"

    def test_a_persisted_complete_payload_is_still_served_from_disk(self, monkeypatch):
        built = []
        monkeypatch.setattr(ei, "_build", lambda s: built.append(s) or dict(FULL))
        monkeypatch.setattr(ei.cache, "get", lambda k: None)
        monkeypatch.setattr(ei.cache, "set", lambda k, v, t: None)
        monkeypatch.setattr(ei.snap_store, "get",
                            lambda k, s: (dict(FULL), 10, 86400))
        monkeypatch.setattr(ei.snap_store, "put", lambda *a, **k: None)
        ei.get_earnings("MU")
        assert built == [], "must not rebuild what is already good"


class TestRefreshNow:
    """final fix C, I1: the follow-up job's one forced rebuild. It goes through `_build` (the module's own fetcher)
    and the SAME keep-gate as get_earnings' build branch; a failed or partial build leaves the held copy alone."""

    def _seams(self, monkeypatch, build):
        sets, puts = [], []
        monkeypatch.setattr(ei, "_build", build)
        monkeypatch.setattr(ei.cache, "set", lambda k, v, t: sets.append((k, v, t)))
        monkeypatch.setattr(ei.snap_store, "put", lambda kind, sym, v, t: puts.append((kind, sym, v, t)))
        return sets, puts

    def test_a_good_build_is_returned_and_kept_in_both_layers(self, monkeypatch):
        fresh = dict(FULL)
        sets, puts = self._seams(monkeypatch, lambda sym: fresh)
        assert ei.refresh_earnings(" mu ") is fresh
        ttl = ei._ttl_for(fresh)
        assert sets == [(f"{ei._KIND}::MU", fresh, ttl)] and puts == [(ei._KIND, "MU", fresh, ttl)]

    def test_a_partial_build_is_none_and_kept_nowhere(self, monkeypatch):
        sets, puts = self._seams(monkeypatch, lambda sym: dict(ANNUAL_ONLY))
        assert ei.refresh_earnings("MU") is None
        assert sets == [] and puts == [], "a partial rebuild must not replace the held copy"

    def test_a_build_that_raises_is_none_and_never_raises(self, monkeypatch):
        def boom(sym):
            raise RuntimeError("vendor down")
        sets, puts = self._seams(monkeypatch, boom)
        assert ei.refresh_earnings("MU") is None
        assert sets == [] and puts == []

    def test_no_ticker_builds_nothing(self, monkeypatch):
        sets, puts = self._seams(monkeypatch, lambda sym: (_ for _ in ()).throw(AssertionError("built")))
        assert ei.refresh_earnings("  ") is None and sets == [] and puts == []
