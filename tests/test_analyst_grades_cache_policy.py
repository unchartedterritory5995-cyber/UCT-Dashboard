"""`get_analyst_grades` cached a provider OUTAGE for the same 6h as a genuine
"this company has no analyst coverage" — both wrote {"_miss": True} at the full
TTL. One FMP blip therefore blanked a ticker's analyst panel for the rest of the
session, and nothing retried.

The legs already know which happened: an empty result from a leg that RAN is a
fact about the company; an empty result from a leg that RAISED is a fact about
the provider.
"""
import pytest

from api.services import analyst_grades as ag


@pytest.fixture(autouse=True)
def _clean():
    ag.cache.invalidate("analyst_grades_TEST")
    yield
    ag.cache.invalidate("analyst_grades_TEST")


@pytest.fixture
def spy(monkeypatch):
    """Capture the cache write. Patches the MODULE's `cache` — the same seam
    the existing analyst_grades tests use — so this cannot drift from how the
    module actually writes."""
    seen = {}

    class _Spy:
        def get(self, k):
            return None

        def set(self, k, v, ttl=None):
            seen.update({"key": k, "value": v, "ttl": ttl})

        def invalidate(self, k):
            pass

    monkeypatch.setattr(ag, "cache", _Spy())
    return seen


def _legs(monkeypatch, *, consensus=None, target=None, actions=None, trend=None,
          raise_on=()):
    def mk(name, val):
        def fn(t):
            if name in raise_on:
                raise RuntimeError(f"{name} provider down")
            return val
        return fn
    monkeypatch.setattr(ag, "_consensus", mk("consensus", consensus))
    monkeypatch.setattr(ag, "_price_target", mk("target", target))
    monkeypatch.setattr(ag, "_recent_actions", mk("actions", actions or []))
    monkeypatch.setattr(ag, "_trend", mk("trend", trend or []))


class TestMissTtl:
    def test_genuine_no_coverage_holds_the_full_ttl(self, monkeypatch, spy):
        """Every leg ran and found nothing — that IS the answer for a small cap.
        Refetching it every 5 min would be pure waste."""
        _legs(monkeypatch)
        assert ag.get_analyst_grades("TEST") is None
        assert spy["value"] == {"_miss": True}
        assert spy["ttl"] == ag._TTL == 6 * 3600

    def test_an_outage_miss_self_heals_in_five_minutes(self, monkeypatch, spy):
        """The bug: this was indistinguishable from the case above."""
        _legs(monkeypatch, raise_on=("consensus",))
        assert ag.get_analyst_grades("TEST") is None
        assert spy["ttl"] == ag._FAIL_TTL == 300

    @pytest.mark.parametrize("leg", ["consensus", "target", "actions", "trend"])
    def test_any_failing_leg_marks_it_incomplete(self, monkeypatch, spy, leg):
        _legs(monkeypatch, raise_on=(leg,))
        ag.get_analyst_grades("TEST")
        assert spy["ttl"] == ag._FAIL_TTL, f"{leg} raising was not noticed"


class TestPayloadTtl:
    def test_a_full_payload_holds_the_full_ttl(self, monkeypatch, spy):
        _legs(monkeypatch, consensus={"buy": 5}, target={"targetMean": 100.0},
              actions=[{"firm": "X"}], trend=[{"period": "2026-08"}])
        out = ag.get_analyst_grades("TEST")
        assert out["consensus"] == {"buy": 5}
        assert spy["ttl"] == ag._TTL

    def test_a_payload_assembled_during_an_outage_is_held_briefly(self, monkeypatch, spy):
        """Real data came back, but a section is missing that would otherwise be
        there — hold it briefly so the gap fills instead of persisting a partial
        picture for 6h."""
        _legs(monkeypatch, consensus={"buy": 5}, raise_on=("target",))
        out = ag.get_analyst_grades("TEST")
        assert out is not None and out["price_target"] is None
        assert spy["ttl"] == ag._FAIL_TTL


class TestUnchanged:
    def test_the_miss_sentinel_still_reads_back_as_none(self, monkeypatch):
        """Round-trip through the REAL cache: a cached miss must keep returning
        None rather than leaking {"_miss": True} to a caller."""
        _legs(monkeypatch)
        assert ag.get_analyst_grades("TEST") is None
        assert ag.get_analyst_grades("TEST") is None      # served from cache

    def test_blank_ticker_short_circuits(self):
        assert ag.get_analyst_grades("") is None
        assert ag.get_analyst_grades(None) is None
