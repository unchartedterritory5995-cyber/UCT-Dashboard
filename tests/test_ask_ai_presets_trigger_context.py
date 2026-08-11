"""The earnings modal's Ask AI starters must actually UNLOCK the context packs
they were worded for.

`/api/ai-search` attaches regime/quote/catalyst/tape/patterns to any question
naming a ticker, but its options-flow, analyst, fundamentals and insider packs
are INTENT-GATED on the query text. The first set of starters shipped tripping
none of them, so every preset answer was a web summary while our own options
flow, analyst estimates and insider data sat unused one regex away.

⭐ THIS IS A CROSS-LANGUAGE CONTRACT, AND THAT IS WHY THE TEST LIVES HERE.
The gate regexes are Python; the starters are JS. A frontend test would have to
retype the trigger words, which is the second-authority defect this repo keeps
paying for — it would go green against a reworded preset that no longer trips
anything. So the assertion runs where the REAL regexes are and READS the
starters out of the JS source. Neither side is restated; the test is the join.

What it catches: someone rewords "options flow" to "options activity into the
print" for tone, the preset silently stops attaching flow data, the answers get
vaguer, and nothing else in the suite notices.
"""
import re
from pathlib import Path

import pytest

from api.routers.ai_search import (
    _ANALYST_RE,
    _FLOW_RE,
    _FUNDAMENTALS_RE,
    _INSIDER_RE,
    _extract_tickers,
)

_SUGGESTIONS_JS = (
    Path(__file__).resolve().parents[1]
    / "app" / "src" / "components" / "research" / "askAiSuggestions.js"
)

# `(sym) => \`...\`` — the template body of each starter, in source order.
_TEMPLATE_RE = re.compile(r"\(sym\)\s*=>\s*`([^`]*)`")


def _starters(block: str, sym: str = "NVDA") -> list[str]:
    """The rendered starters of one template block, read from the JS source."""
    src = _SUGGESTIONS_JS.read_text(encoding="utf-8")
    start = src.index(f"const {block} = [")
    end = src.index("]", start)
    return [
        m.group(1).replace("${sym}", sym)
        for m in _TEMPLATE_RE.finditer(src[start:end])
    ]


def test_the_js_source_is_actually_readable():
    """Control. Every assertion below is vacuous if the parse silently yields
    nothing — a renamed const or a switch to double quotes would turn this whole
    file green while checking zero starters."""
    assert _SUGGESTIONS_JS.exists(), _SUGGESTIONS_JS
    pre, post = _starters("PRE_TEMPLATES"), _starters("POST_TEMPLATES")
    assert len(pre) >= 4, pre
    assert len(post) >= 4, post
    assert all("NVDA" in s for s in pre + post), "template did not interpolate"


@pytest.mark.parametrize("block", ["PRE_TEMPLATES", "POST_TEMPLATES"])
def test_every_starter_names_the_symbol(block):
    """Load-bearing, not cosmetic: the backend decides WHICH ticker to load
    context for by extracting tickers from the query text. A starter that reads
    "into the print" with no symbol gets no per-ticker context at all — not the
    gated packs, and not even the ungated quote/tape/patterns."""
    missing = [s for s in _starters(block) if "NVDA" not in _extract_tickers(s)]
    assert not missing, (
        "starters the backend cannot resolve a ticker from — they would answer "
        f"with no company context whatsoever: {missing}"
    )


@pytest.mark.parametrize(
    "block,gate,rx",
    [
        ("PRE_TEMPLATES", "options flow", _FLOW_RE),
        ("PRE_TEMPLATES", "analyst", _ANALYST_RE),
        ("PRE_TEMPLATES", "insider", _INSIDER_RE),
        ("PRE_TEMPLATES", "fundamentals", _FUNDAMENTALS_RE),
        ("POST_TEMPLATES", "options flow", _FLOW_RE),
        ("POST_TEMPLATES", "analyst", _ANALYST_RE),
        ("POST_TEMPLATES", "fundamentals", _FUNDAMENTALS_RE),
    ],
)
def test_each_lane_is_opened_by_at_least_one_starter(block, gate, rx):
    """The point of the set: one starter per DATA LANE. If none trips the gate,
    that pack never reaches the model and the lane is decorative."""
    hits = [s for s in _starters(block) if rx.search(s)]
    assert hits, (
        f"no {block} starter opens the {gate!r} pack — every one of them:\n  "
        + "\n  ".join(_starters(block))
    )


_GATES = {
    "flow": _FLOW_RE,
    "analyst": _ANALYST_RE,
    "insider": _INSIDER_RE,
    "fundamentals": _FUNDAMENTALS_RE,
}


def _router_gated_packs() -> set[str]:
    """The per-ticker packs the ROUTER actually gates, read from its source.

    Derived, not typed: `_assemble` opts each pack in with
    `_perticker.append(("<name>", "_ctx_<name>"))`, plus the flow pack on its own
    branch. Reading them here is what makes the coverage test below able to see
    a gate that was added to the router and never given a starter — which is
    exactly how the fundamentals pack sat unused after the first rewrite.
    """
    src = (
        Path(__file__).resolve().parents[1] / "api" / "routers" / "ai_search.py"
    ).read_text(encoding="utf-8")
    packs = set(re.findall(r'_perticker\.append\(\(\s*"([a-z_]+)"', src))
    if re.search(r"_FLOW_RE\.search", src):
        packs.add("flow")
    return packs


def test_the_gate_map_still_matches_the_router():
    """Control for the coverage test: if the router grows a fifth gated pack,
    this fails and forces it into `_GATES` rather than letting the coverage
    assertion quietly keep checking only the four it knew about."""
    found = _router_gated_packs()
    assert found, "parsed no gated packs out of ai_search.py — the probe is broken"
    assert found == set(_GATES), (
        f"router gates {sorted(found)} but this test knows {sorted(_GATES)} — "
        "a pack was added or renamed; give it a starter and map it here"
    )


def test_no_gated_pack_is_left_cold():
    """Across both lifecycles, every gated pack must be opened by some starter.

    This is the assertion that would have caught the real gap: after the first
    rewrite, options-flow / analyst / insider were opened but FUNDAMENTALS never
    was, so valuation, margins, revenue growth and balance-sheet data were one
    regex away from the model and never reached it from a preset.
    """
    everything = _starters("PRE_TEMPLATES") + _starters("POST_TEMPLATES")
    cold = [g for g, rx in _GATES.items() if not any(rx.search(s) for s in everything)]
    assert not cold, (
        f"gated packs no starter ever opens: {sorted(cold)} — that data exists "
        "and is one wording away, but no preset reaches it"
    )


def test_the_gates_are_discriminating_not_always_on():
    """Control for the test above. If these regexes matched anything, the lane
    assertions would pass against any wording at all and prove nothing."""
    bland = "How has NVDA traded after past earnings?"
    for gate, rx in [("flow", _FLOW_RE), ("analyst", _ANALYST_RE),
                     ("insider", _INSIDER_RE), ("fundamentals", _FUNDAMENTALS_RE)]:
        assert not rx.search(bland), (
            f"the {gate} gate matches a starter with none of its vocabulary — "
            "the lane assertions above are vacuous"
        )


def test_starters_do_not_read_as_the_members_own_book():
    """A starter must never trip PERSONAL intent. That branch answers out of the
    member's positions and is deliberately never logged; a preset that lands
    there would answer a question about the COMPANY with a note about the
    reader's book."""
    from api.routers.ai_search import _PERSONAL_INTENT_RE

    for block in ("PRE_TEMPLATES", "POST_TEMPLATES"):
        personal = [s for s in _starters(block) if _PERSONAL_INTENT_RE.search(s)]
        assert not personal, personal
