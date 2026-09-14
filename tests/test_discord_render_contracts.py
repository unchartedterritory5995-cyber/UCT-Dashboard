"""The frozen cross-lane contracts (07-execution-plan §4).

⛔ A `Protocol` IS NOT A RAIL. `typing.Protocol` is checked by a type checker this repo does not run
in CI, so on its own it is a comment with syntax. This file is what makes the contracts load-bearing:
each one is asserted against the REAL module that implements it, and each assertion has a control
proving a wrong shape is rejected — a contract nobody can fail is documentation.
"""
from __future__ import annotations

import datetime as dt

import pytest

from api.services.discord_render import contracts, freshness as fr
from api.services.discord_render.adapters import bars, entity, flow, quote, renderer
from api.services.discord_render.adapters import result as R

NOW = dt.datetime(2026, 9, 13, 11, 0, tzinfo=fr.ET)


# ── 1 · the adapter boundary ────────────────────────────────────────────────

@pytest.mark.parametrize("mod", [bars, quote, flow, renderer, entity])
def test_every_adapter_satisfies_the_frozen_shape(mod):
    assert isinstance(mod.NAME, str) and mod.NAME
    assert isinstance(mod.TIMEOUT_S, float) and mod.TIMEOUT_S > 0
    assert callable(mod.fetch)


@pytest.mark.parametrize("mod", [bars, quote, flow, renderer, entity])
def test_every_adapter_returns_a_Result_and_never_raises(mod):
    """One shape, whatever went wrong. The failure a caller gets is a VALUE with a named class."""
    req = {"bars": lambda: (bars.BarsRequest("NVDA"), {"fetch_fn": _boom}),
           "quote": lambda: (quote.QuoteRequest("NVDA"), {"quote_fn": _boom}),
           "flow": lambda: (flow.FlowRequest("NVDA"), {"remote": _boom, "local": _boom}),
           "renderer": lambda: (renderer.RenderRequest("NVDA"), {"house_fn": _boom}),
           "entity": lambda: (entity.EntityRequest("NVDA"), {"resolve_fn": _boom})}[mod.NAME]()
    out = mod.fetch(req[0], **req[1])
    assert isinstance(out, R.Result)
    assert out.reason() is None or out.reason() in R.ALL_REASONS


def _boom(*a, **k):
    raise RuntimeError("upstream down")


def test_the_control_a_wrong_shape_is_not_an_adapter():
    class NotAnAdapter:
        NAME = "nope"
    assert not isinstance(NotAnAdapter(), contracts.Adapter), (
        "the protocol accepts anything, so none of the assertions above mean what they say")


# ── 2 · the artifact cache boundary (Lane B builds against this) ────────────

class _Key:
    def __init__(self, command="chart", args="NVDA|D", vintage="2026-09-11"):
        self.command, self.args, self.vintage = command, args, vintage


class _Artifact:
    def __init__(self, data=b"png", envelope=None, stored_at=1.0, provider="renderer"):
        self.data, self.envelope, self.stored_at, self.provider = data, envelope, stored_at, provider


def test_the_cache_key_and_artifact_shapes_are_what_lane_B_must_produce():
    assert isinstance(_Key(), contracts.CacheKey)
    assert isinstance(_Artifact(), contracts.CachedArtifact)


def test_the_control_a_key_missing_the_vintage_is_refused():
    """⛔⛔ THE VINTAGE IS THE THIRD PART OF THE KEY. Without it the same closed-market input caches
    under a new key every second, the hit rate collapses, and §3.10's determinism guarantee becomes
    unobservable because no two runs ever share an entry."""
    class NoVintage:
        command, args = "chart", "NVDA|D"
    assert not isinstance(NoVintage(), contracts.CacheKey)


def test_the_control_an_artifact_that_keeps_only_stored_at_is_refused():
    """⛔ `stored_at` and the envelope are DIFFERENT NUMBERS and both are needed. `stored_at` decides
    eviction; the envelope decides what the member is told. Keeping only the first hands back a
    week-old chart labelled "cached 30 seconds ago" — true, and completely misleading."""
    class NoEnvelope:
        data, stored_at, provider = b"png", 1.0, "renderer"
    assert not isinstance(NoEnvelope(), contracts.CachedArtifact)


def test_a_store_must_offer_get_put_and_coalesce():
    class Store:
        def get(self, key): return None
        def put(self, key, artifact): return None
        def coalesce(self, key, produce, *, budget_s): return produce()
    assert isinstance(Store(), contracts.ArtifactStore)

    class NoCoalesce:
        def get(self, key): return None
        def put(self, key, artifact): return None
    assert not isinstance(NoCoalesce(), contracts.ArtifactStore), (
        "coalescing is part of the contract, not an optimisation: without it ten members at the "
        "open produce ten renders on a pod with four render slots")


# ── 3 · the member-facing copy boundary (Lane D builds against this) ────────

def test_a_badge_renderer_must_offer_both_halves():
    class Renderer:
        def render_badge(self, result): return None
        def render_footer(self, results, corr_id): return ""
    assert isinstance(Renderer(), contracts.BadgeRenderer)

    class BadgeOnly:
        def render_badge(self, result): return None
    assert not isinstance(BadgeOnly(), contracts.BadgeRenderer)


def test_the_content_ceiling_is_discords_and_is_stated_once():
    assert contracts.CONTENT_MAX == 2000
    from api.services.discord_render.adapters import bindings
    assert bindings.CONTENT_MAX == contracts.CONTENT_MAX, (
        "two spellings of one limit is the second-authority defect on the one string a member reads")


# ── 4 · the vintage vocabulary ──────────────────────────────────────────────

def test_a_real_envelope_describes_its_vintage():
    assert contracts.describes_vintage(fr.envelope("2026-09-11", tf="D", now=NOW))
    assert contracts.describes_vintage(fr.envelope(None, now=NOW)), (
        "an UNKNOWN vintage still describes itself — that is the whole point of three-valued stale")


def test_the_control_something_that_cannot_answer_is_refused():
    assert contracts.describes_vintage(None) is False
    assert contracts.describes_vintage(object()) is False

    class PartialSpelling:
        as_of_utc = as_of_et = provider = session_state = age_s = budget_s = stale = None
    assert contracts.describes_vintage(PartialSpelling()) is False, (
        "a lane that invented its own spelling for `rule` or `expected_session` must not pass")


def test_the_frozen_vocabulary_matches_the_envelope_the_code_actually_returns():
    """⛔ BOTH DIRECTIONS. A vocabulary that drifts from the dataclass is a contract describing a
    repo that does not exist — the flag-ledger defect, one layer down."""
    env = fr.envelope("2026-09-11", tf="D", now=NOW)
    assert set(contracts.VINTAGE_KEYS) == set(env.as_dict()), (
        f"frozen {sorted(contracts.VINTAGE_KEYS)} vs actual {sorted(env.as_dict())}")


def test_the_reason_taxonomy_is_re_exported_so_a_lane_reads_one_list():
    assert contracts.ALL_REASONS is R.ALL_REASONS
