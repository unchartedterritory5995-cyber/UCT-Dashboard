"""The shared fire-receipt store (S7 first slice) -- dedup, delivery lease,
and the corrected freshness-enum enforcement."""
import pytest

from api.services.alert_taxonomy import receipts


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "alert_taxonomy.db")


def _record(db_path, fire_key="occ:acc1", **kw):
    defaults = dict(
        predicate_id="p1", trigger_type="document-arrival", user_id="u1",
        entity_ref="AAPL", fire_key=fire_key, as_of=1700000000.0, db_path=db_path,
    )
    defaults.update(kw)
    return receipts.record_fire(**defaults)


class TestDedup:
    def test_first_fire_returns_a_real_id(self, db_path):
        fid = _record(db_path)
        assert isinstance(fid, int)

    def test_duplicate_predicate_and_fire_key_returns_none(self, db_path):
        fid1 = _record(db_path)
        fid2 = _record(db_path)  # same predicate_id + fire_key
        assert fid1 is not None
        assert fid2 is None

    def test_same_fire_key_different_predicate_is_not_a_duplicate(self, db_path):
        fid1 = _record(db_path, predicate_id="p1")
        fid2 = _record(db_path, predicate_id="p2")
        assert fid1 is not None and fid2 is not None and fid1 != fid2

    def test_missing_fire_key_raises(self, db_path):
        with pytest.raises(ValueError, match="fire_key"):
            _record(db_path, fire_key="")


class TestFreshnessEnumEnforcement:
    @pytest.mark.parametrize("value", ["real_time", "delayed_15", "end_of_day", "historical", "stale"])
    def test_every_real_d1_value_is_accepted(self, db_path, value):
        fid = _record(db_path, fire_key=f"occ:{value}", freshness_class=value)
        assert fid is not None

    def test_none_is_accepted_as_the_honest_not_established_state(self, db_path):
        fid = _record(db_path, freshness_class=None)
        assert fid is not None

    def test_the_stale_4_value_enum_is_impossible_to_reintroduce(self, db_path):
        """A value that WOULD be valid under the (stale, wrong) 4-class
        data-architecture.md §12.1 enum but isn't a real D1 value must be
        rejected -- this is the regression test for the readiness review's
        headline finding."""
        with pytest.raises(ValueError, match="unrecognized freshness_class"):
            _record(db_path, freshness_class="delayed-15")  # hyphenated, NOT D1's real "delayed_15"

    def test_a_genuinely_unknown_value_is_rejected(self, db_path):
        with pytest.raises(ValueError, match="unrecognized freshness_class"):
            _record(db_path, freshness_class="fresh")


class TestDeliveryLease:
    def test_claim_delivery_succeeds_once(self, db_path):
        fid = _record(db_path)
        assert receipts.claim_delivery(fid, db_path=db_path) is True

    def test_claim_delivery_is_exactly_once(self, db_path):
        """The concurrent-evaluation guarantee: two 'processes' racing to
        deliver the same fire -- only one may claim it."""
        fid = _record(db_path)
        first = receipts.claim_delivery(fid, db_path=db_path)
        second = receipts.claim_delivery(fid, db_path=db_path)
        assert first is True
        assert second is False

    def test_claiming_a_nonexistent_fire_is_false_not_an_exception(self, db_path):
        assert receipts.claim_delivery(999999, db_path=db_path) is False

    def test_record_delivery_channels_and_derives_failed_count(self, db_path):
        fid = _record(db_path)
        receipts.claim_delivery(fid, db_path=db_path)
        ok = receipts.record_delivery_channels(
            fid, {"in_app": "ok", "email": "failed", "discord": "skipped"}, db_path=db_path,
        )
        assert ok is True
        fires = receipts.fires_for_predicate("p1", db_path=db_path)
        assert fires[0]["channels_failed"] == 1
        assert fires[0]["delivery_channels"] == {"in_app": "ok", "email": "failed", "discord": "skipped"}

    def test_release_delivery_below_max_attempts_allows_a_retry(self, db_path):
        fid = _record(db_path)
        receipts.claim_delivery(fid, db_path=db_path)
        result = receipts.release_delivery(fid, error="transient", db_path=db_path)
        assert result["released"] is True
        assert result["terminal"] is False
        # released -> claimable again
        assert receipts.claim_delivery(fid, db_path=db_path) is True

    def test_release_delivery_becomes_terminal_at_max_attempts(self, db_path):
        fid = _record(db_path)
        for _ in range(receipts.MAX_DELIVERY_ATTEMPTS):
            receipts.claim_delivery(fid, db_path=db_path)
            result = receipts.release_delivery(fid, error="transient", db_path=db_path)
        assert result["terminal"] is True
        assert result["released"] is False
        # a terminal fire can no longer be claimed via the normal release path
        # (it was left claimed, not released, on the terminal attempt)
        assert receipts.claim_delivery(fid, db_path=db_path) is False


class TestListing:
    def test_list_fires_scoped_to_user_newest_first(self, db_path):
        _record(db_path, user_id="u1", fire_key="occ:1", fired_at=1.0)
        _record(db_path, user_id="u1", fire_key="occ:2", fired_at=2.0)
        _record(db_path, user_id="u2", fire_key="occ:3", fired_at=3.0)
        rows = receipts.list_fires("u1", db_path=db_path)
        assert [r["fire_key"] for r in rows] == ["occ:2", "occ:1"]

    def test_detail_json_round_trips(self, db_path):
        fid = _record(db_path, detail={"form": "8-K", "accession": "acc1"})
        rows = receipts.fires_for_predicate("p1", db_path=db_path)
        assert rows[0]["detail"] == {"form": "8-K", "accession": "acc1"}
