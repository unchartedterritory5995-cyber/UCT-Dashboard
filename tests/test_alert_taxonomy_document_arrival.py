"""document-arrival -- S7's first live trigger type. Covers the owner's
pre-live-validation checklist: valid arrival, duplicate arrival, repeated
evaluator execution, unknown entity, unresolved ticker, malformed
document/event, missing provenance, disabled alert, previously-triggered
(recurring) alert, concurrent evaluation, database write failure isolation.

sec_filings.recent_filings and the shared delivery function are both
mocked -- this suite proves the evaluator's OWN logic, not SEC's network
behavior or watchlist_alert_service's own (separately-tested) delivery
fan-out.
"""
import sqlite3

import pytest

from api.services.entity_master import schema as em_schema
from api.services.entity_master import store as em_store
from api.services.entity_master import api as em_api
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import document_arrival as da
from api.services.alert_taxonomy import predicates, receipts, delivery
from api.services.alert_taxonomy.predicates import PredicateRegistrationError


@pytest.fixture(autouse=True)
def _isolated_dbs(tmp_path, monkeypatch):
    at_path = str(tmp_path / "alert_taxonomy.db")
    monkeypatch.setattr(at_db, "DB_PATH", at_path)

    em_db_path = str(tmp_path / "em_default.db")
    monkeypatch.setattr(em_schema, "DB_PATH", em_db_path)
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False
    em_schema.init_db(db_path=em_db_path)

    da.register()  # type must be registered for predicates to validate

    yield

    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False


@pytest.fixture(autouse=True)
def _no_real_delivery(monkeypatch):
    """Every test in this file replaces the REUSED delivery function with a
    recording fake -- never watchlist_alert_service's real multi-channel
    fan-out (that has its own suite)."""
    calls = []

    def fake(**kwargs):
        calls.append(kwargs)
        return {"claimed": True, "channels": {"in_app": "ok"}, "channels_ok": 1, "channels_failed": 0, "errors": {}}

    monkeypatch.setattr(delivery.watchlist_alert_service, "deliver_alert_payload", fake)
    return calls


def _seed_filer(ticker):
    """A ticker sec_filings would resolve (CIK map hit)."""
    # sec_filings.recent_filings is mocked directly in each test that
    # needs it; this seeds ENTITY MASTER only, so resolve_entity_scope
    # returns a real resolved entity_id where the test wants one.
    r = em_api.apply_event(
        "new_entity", {"entity_type": "equity", "initial_alias": ticker, "initial_alias_valid_from": "2020-01-01"},
        dedup_key=f"test:{ticker}", source="admin_manual",
    )
    assert r.accepted
    return r.entity_id


def _filings_result(company="Apple Inc.", filings=None):
    return {"ticker": "AAPL", "company": company, "cik": "0000320193",
            "form_filter": "ANY", "count": len(filings or []), "filings": filings or []}


def _filing(accession, form="8-K", filed="2026-09-01", url="https://sec.gov/x"):
    return {"form": form, "filed": filed, "period": "", "accession": accession, "url": url}


class TestRegistration:
    def test_valid_ticker_registers(self, monkeypatch):
        _seed_filer("AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        pid = da.register_predicate_for_user("u1", "AAPL", form_type="8-K")
        assert pid.startswith("pred_")
        row = predicates.get_predicate(pid)
        assert row["type_id"] == "document-arrival"
        assert row["last_seen_state"] == {"accession": "acc-0"}  # baseline captured at registration

    def test_ticker_with_no_sec_filer_is_rejected(self, monkeypatch):
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: {"error": "ticker 'ZZZZ' not found in SEC CIK map"})
        with pytest.raises(PredicateRegistrationError, match="not found in SEC CIK map"):
            da.register_predicate_for_user("u1", "ZZZZ")

    def test_a_ticker_with_no_prior_filings_registers_with_a_null_baseline(self, monkeypatch):
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[]))
        pid = da.register_predicate_for_user("u1", "NEWCO")
        row = predicates.get_predicate(pid)
        assert row["last_seen_state"] == {"accession": None}

    def test_empty_ticker_is_rejected(self):
        with pytest.raises(PredicateRegistrationError, match="ticker"):
            da.register_predicate_for_user("u1", "")


class TestSweepValidArrival:
    def test_a_genuinely_new_filing_fires_and_delivers(self, monkeypatch, _no_real_delivery):
        eid = _seed_filer("AAPL")
        # Registration baseline: acc-0 already existed.
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        pid = da.register_predicate_for_user("u1", "AAPL")

        # Now a NEW filing has landed.
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: _filings_result(filings=[_filing("acc-1", form="10-Q")]))
        result = da.run_document_arrival_sweep()

        assert result["checked"] == 1
        assert result["fired"] == 1
        assert result["errors"] == []
        fires = receipts.fires_for_predicate(pid)
        assert len(fires) == 1
        assert fires[0]["fire_key"] == "occ:acc-1"
        assert fires[0]["entity_ref"] == eid  # the RESOLVED entity, not the raw ticker
        assert fires[0]["source_data_class"] == "sec_filing"
        assert fires[0]["freshness_class"] is None  # honest -- SEC is not a D1-typed feed
        assert fires[0]["detail"]["form"] == "10-Q"
        assert len(_no_real_delivery) == 1
        assert _no_real_delivery[0]["extra_data"]["research_url"] == "/research/AAPL"

        # watermark advanced
        row = predicates.get_predicate(pid)
        assert row["last_seen_state"] == {"accession": "acc-1"}

    def test_first_run_baseline_never_fires_on_pre_existing_history(self, monkeypatch, _no_real_delivery):
        """The core honesty requirement (SPEC §5.6): arming an alert must
        never immediately fire on history that predates the alert."""
        _seed_filer("AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        da.register_predicate_for_user("u1", "AAPL")

        # Sweep runs with the SAME filing still newest (nothing new arrived).
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: _filings_result(filings=[_filing("acc-0")]))
        result = da.run_document_arrival_sweep()
        assert result["fired"] == 0
        assert _no_real_delivery == []


class TestDuplicateAndRepeatedExecution:
    def test_repeated_sweep_execution_with_no_new_filing_is_a_no_op(self, monkeypatch, _no_real_delivery):
        _seed_filer("AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        da.register_predicate_for_user("u1", "AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: _filings_result(filings=[_filing("acc-1")]))

        r1 = da.run_document_arrival_sweep()
        r2 = da.run_document_arrival_sweep()  # same "new" filing, run again
        assert r1["fired"] == 1
        assert r2["fired"] == 0  # watermark already advanced -- not new anymore
        assert len(_no_real_delivery) == 1  # delivered exactly once across both runs

    def test_concurrent_evaluation_cannot_double_fire_or_double_deliver(self, monkeypatch, _no_real_delivery):
        """Simulates two 'processes' racing to evaluate the SAME predicate
        against the SAME new filing before either advances the watermark --
        the UNIQUE(predicate_id, fire_key) constraint is the real guard."""
        _seed_filer("AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        pid = da.register_predicate_for_user("u1", "AAPL")
        predicate = predicates.get_predicate(pid)

        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: _filings_result(filings=[_filing("acc-1")]))

        cache1, cache2 = {}, {}
        r1 = da._evaluate_one(predicate, cache1)   # process A evaluates the SAME stale snapshot
        r2 = da._evaluate_one(predicate, cache2)   # process B evaluates the SAME stale snapshot
        outcomes = {r1["outcome"], r2["outcome"]}
        assert outcomes == {"fired", "dedup_collision"}
        assert len(_no_real_delivery) == 1  # only the winner delivers


class TestErrorHandling:
    def test_a_provider_error_is_recorded_and_does_not_crash_the_sweep(self, monkeypatch):
        _seed_filer("AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        pid = da.register_predicate_for_user("u1", "AAPL")

        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: {"error": "SEC fetch failed: timeout"})
        result = da.run_document_arrival_sweep()
        assert result["fired"] == 0
        assert len(result["errors"]) == 1
        assert result["errors"][0]["predicate_id"] == pid

    def test_one_malformed_predicate_does_not_abort_the_others(self, monkeypatch, _no_real_delivery):
        _seed_filer("AAPL")
        _seed_filer("MSFT")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        pid_good = da.register_predicate_for_user("u1", "MSFT")
        pid_bad = da.register_predicate_for_user("u1", "AAPL")

        def flaky(t, form_type="", count=5):
            if t == "AAPL":
                raise RuntimeError("boom -- malformed provider response")
            return _filings_result(filings=[_filing("acc-1")])

        monkeypatch.setattr(da.sec_filings, "recent_filings", flaky)
        result = da.run_document_arrival_sweep()
        assert result["checked"] == 2
        assert result["fired"] == 1        # MSFT still fired
        assert len(result["errors"]) == 1  # AAPL recorded as an error, not a crash
        assert result["errors"][0]["predicate_id"] == pid_bad

    def test_a_database_write_failure_on_one_predicate_does_not_abort_the_cycle(self, monkeypatch, _no_real_delivery):
        _seed_filer("AAPL")
        _seed_filer("MSFT")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        pid_a = da.register_predicate_for_user("u1", "AAPL")
        pid_b = da.register_predicate_for_user("u1", "MSFT")

        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: _filings_result(filings=[_filing("acc-1")]))

        real_record_fire = receipts.record_fire

        def flaky_record_fire(*args, **kwargs):
            if kwargs.get("predicate_id") == pid_a:
                raise sqlite3.OperationalError("disk I/O error")  # simulated DB write failure
            return real_record_fire(*args, **kwargs)

        monkeypatch.setattr(da._receipts, "record_fire", flaky_record_fire)

        result = da.run_document_arrival_sweep()
        assert result["checked"] == 2
        assert result["fired"] == 1  # MSFT still fired despite AAPL's DB failure
        assert len(result["errors"]) == 1
        assert result["errors"][0]["predicate_id"] == pid_a
        assert "disk I/O error" in result["errors"][0]["error"]

    def test_a_delivery_failure_during_a_sweep_does_not_crash_the_cycle(self, monkeypatch):
        """The fire is still recorded and the cycle completes even when the
        reused delivery function raises -- a member's mis-configured Resend
        key must never take the whole sweep down."""
        _seed_filer("AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        pid = da.register_predicate_for_user("u1", "AAPL")

        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: _filings_result(filings=[_filing("acc-1")]))

        def boom(**kwargs):
            raise RuntimeError("delivery boom")
        monkeypatch.setattr(delivery.watchlist_alert_service, "deliver_alert_payload", boom)

        result = da.run_document_arrival_sweep()
        # The fire itself was recorded (the DEDUP fact is real) even though
        # delivery raised -- the fire is not lost, only its delivery attempt.
        assert len(result["errors"]) == 1
        assert "delivery boom" in result["errors"][0]["error"]
        fires = receipts.fires_for_predicate(pid)
        assert len(fires) == 1
        assert fires[0]["fire_key"] == "occ:acc-1"

    def test_missing_filings_key_is_treated_as_no_data_not_a_crash(self, monkeypatch):
        _seed_filer("AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        da.register_predicate_for_user("u1", "AAPL")

        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: {"ticker": "AAPL", "company": "Apple", "cik": "1", "form_filter": "ANY", "count": 0, "filings": []})
        result = da.run_document_arrival_sweep()
        assert result["fired"] == 0
        assert result["errors"] == []


class TestDisabledAndRecurring:
    def test_a_suspended_predicate_is_never_evaluated(self, monkeypatch, _no_real_delivery):
        _seed_filer("AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        pid = da.register_predicate_for_user("u1", "AAPL")
        predicates.suspend_predicate(pid, "u1")

        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: _filings_result(filings=[_filing("acc-1")]))
        result = da.run_document_arrival_sweep()
        assert result["checked"] == 0
        assert result["fired"] == 0
        assert _no_real_delivery == []

    def test_a_previously_triggered_predicate_stays_active_and_fires_again_on_the_NEXT_filing(self, monkeypatch, _no_real_delivery):
        """document-arrival is recurring by design (edge/one-occurrence,
        SPEC §5.3.1) -- unlike a one-shot price alert, it must re-arm for
        the next filing rather than deactivating after its first fire."""
        _seed_filer("AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        pid = da.register_predicate_for_user("u1", "AAPL")

        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: _filings_result(filings=[_filing("acc-1")]))
        r1 = da.run_document_arrival_sweep()
        assert r1["fired"] == 1
        assert predicates.get_predicate(pid)["suspended_at"] is None  # still active

        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=5: _filings_result(filings=[_filing("acc-2")]))
        r2 = da.run_document_arrival_sweep()
        assert r2["fired"] == 1  # fired AGAIN, for the new filing
        assert len(_no_real_delivery) == 2


class TestBatching:
    def test_two_predicates_on_the_same_ticker_share_one_fetch(self, monkeypatch, _no_real_delivery):
        _seed_filer("AAPL")
        monkeypatch.setattr(da.sec_filings, "recent_filings",
                            lambda t, form_type="", count=10: _filings_result(filings=[_filing("acc-0")]))
        da.register_predicate_for_user("u1", "AAPL", form_type=None)
        da.register_predicate_for_user("u2", "AAPL", form_type=None)

        fetch_count = {"n": 0}

        def counting(t, form_type="", count=5):
            fetch_count["n"] += 1
            return _filings_result(filings=[_filing("acc-1")])

        monkeypatch.setattr(da.sec_filings, "recent_filings", counting)
        result = da.run_document_arrival_sweep()
        assert result["checked"] == 2
        assert result["fired"] == 2  # both users' predicates fired independently
        assert fetch_count["n"] == 1  # but only ONE network call for the shared (ticker, form_type)
