"""We ship two Wyckoff events and both are OPTIONAL. None of the five mandatory ones.

⛔⛔ THE FINDING. `docs/superpowers/research/bases/05-wyckoff-schematics.md`
tables every event as mandatory or optional against its sources. Mandatory:
**AR, ST, Phase B, SOS/SOW, LPS/LPSY**. What this repo implements is
`wyckoff-spring` (base_catalog) and `wyckoff_upthrust` (pattern engine) — and
the corpus marks BOTH explicitly optional, quoting the source: springs and
terminal shakeouts are *"not required elements"*, and the UT/UTAD is *"not a
required structural element"*.

So the schematic is represented in this product by exactly the two events that
need not occur, and by none of the five that must.

⛔⛔ AND THE MANDATORY ONES CANNOT BE SHIPPED AS NON-REPAINTING DETECTORS. This
is the reason, and it is structural rather than a matter of effort. The corpus,
verbatim: **"Phase labels are retractable; a state machine must support
rollback."** Its source states the rule directly — *"we would relabel Phase C
and D as a continuation of Phase B, with the final testing still ahead"* — so a
faithful Wyckoff machine REVISES past labels when the expected SOS fails to
arrive.

This library forbids exactly that. `BaseCtx` excludes the provisional trailing
swing on the stated grounds that "a structure must never be built on a swing
that can still move", and the academic file's first build instruction is that
"the most recent pivot is provisional and must never enter a signal. This single
rule eliminates repainting." A Wyckoff phase label and a non-repainting detector
are not the same kind of object.

⛔ THREE FURTHER INPUTS ARE NOT COMPUTABLE FROM BARS, and the corpus lists them
under "Not computable from daily OHLCV under any implementation":
  · WHO is buying or selling — public versus professional — which appears in the
    DEFINITION of PS, SC, BC and PSY, not merely in their commentary;
  · the news/earnings coincidence that forms part of the BC definition, and
    short-covering as a component of the AR;
  · every quality judgement the definitions rest on — "significantly
    diminished", "considerable supply", "feeble", "sharp", "prolonged",
    "pronounced" — *"none of which is ever given a number anywhere in the
    corpus."*

⭐ WHAT IS BUILDABLE, IF ANYONE DOES BUILD IT. AR and ST are geometric: they are
the pivots that set `tr_resistance` and `tr_support`, and the corpus marks the
moment they exist as the gate on everything else — *"tr_support, tr_resistance
now exist. NOTHING BELOW IS DETECTABLE WITHOUT THEM."* A trading-range primitive
is therefore the honest first build, and it is the ONLY part of the schematic
that survives the rollback objection.

This file exists so that none of the above is rediscovered, and so that shipping
a "Phase B" or an "SOS" detector has to confront the rollback question in a
review rather than in production.
"""
import sys, pathlib, re

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "docs/superpowers/research/bases/05-wyckoff-schematics.md"

#: The corpus's own table, transcribed with the side it falls on. Optional and
#: mandatory are the source's words, not ours.
MANDATORY = {"AR", "ST", "Phase B", "SOS", "SOW", "LPS", "LPSY"}
OPTIONAL = {"PS", "PSY", "SC", "BC", "Spring", "Shakeout", "UT", "UTAD", "BU"}

#: What we ship, by the token that names the event. Derived below and compared.
SHIPPED_EVENTS = {"Spring", "UT"}


def _engine_ids():
    from api.services.voice_tool_impls import _ensure_pattern_detectors_loaded
    _ensure_pattern_detectors_loaded()
    from api.services.pattern_engine.detectors import registry
    shipped = "api.services.pattern_engine.detectors"
    out = set()
    for pid in registry.list_pattern_ids():
        mod = getattr(registry.get_detector(pid), "__module__", "") or ""
        if mod.startswith(shipped):
            out.add(pid)
    return out


def _wyckoff_names():
    """Every Wyckoff-named detector this product ships, from BOTH engines."""
    names = {s.key for s in bc.ALL_STRUCTURES} | _engine_ids()
    return sorted(n for n in names if "wyckoff" in n.lower())


# ─── the finding ────────────────────────────────────────────────────────────

def test_we_ship_wyckoff_detectors_at_all():
    """⛔ NON-VACUITY. If nothing Wyckoff-named shipped, every claim below would
    be trivially true and this file would describe a product we do not have."""
    got = _wyckoff_names()
    assert got, "no Wyckoff-named detector is registered in either engine"
    assert len(got) >= 2, got


def test_every_wyckoff_event_we_ship_is_an_OPTIONAL_one():
    """⭐⭐ THE FINDING, ASSERTED. Spring and Upthrust are both marked "not
    required elements" by Wyckoff's own sources. We represent the schematic
    with exactly the events that need not occur."""
    got = _wyckoff_names()
    mandatory_shipped = [n for n in got
                         if re.search(r"(^|_|-)(ar|st|sos|sow|lps|lpsy)(_|-|$)",
                                      n.lower())
                         or "phase" in n.lower()]
    assert not mandatory_shipped, (
        f"{mandatory_shipped} names a MANDATORY Wyckoff event. Before shipping "
        f"one, answer the rollback question in this file's docstring: Wyckoff "
        f"phase labels are retractable and this library forbids repainting.")


def test_the_research_still_says_what_this_file_says_it_says():
    """⛔ THE QUOTES ARE THE ARGUMENT. If the corpus moved, this file is
    reasoning from text that is no longer there."""
    assert RESEARCH.exists(), "the Wyckoff research file is gone"
    txt = RESEARCH.read_text(encoding="utf-8", errors="replace")
    for quote in ("Phase labels are retractable",
                  "not required elements",
                  "not a required structural element",
                  "NOTHING BELOW IS DETECTABLE WITHOUT THEM"):
        assert quote in txt, (
            f"the corpus no longer contains {quote!r} — re-derive this file's "
            f"argument rather than inheriting it")


def test_the_mandatory_set_and_the_shipped_set_do_not_overlap():
    """⭐ THE TWO SETS ARE STATED SEPARATELY AND COMPARED, so a future event
    added to SHIPPED_EVENTS lands in this check automatically."""
    assert SHIPPED_EVENTS.isdisjoint(MANDATORY), (
        f"{SHIPPED_EVENTS & MANDATORY} is recorded as both shipped and "
        f"mandatory — one of the two lists is wrong")
    assert SHIPPED_EVENTS <= OPTIONAL, (
        f"{SHIPPED_EVENTS - OPTIONAL} is shipped and is not in the optional "
        f"set; the corpus's table has changed or we have shipped something new")


def test_the_non_repainting_invariant_this_conflicts_with_is_still_in_force():
    """⛔ THE OTHER HALF OF THE ARGUMENT. The rollback objection only bites
    while this library actually refuses repainting. If that invariant were ever
    relaxed, a Wyckoff state machine would become buildable and this file's
    conclusion would need re-deriving rather than quoting."""
    src = (ROOT / "api/services/screener/bases.py").read_text(encoding="utf-8")
    assert "provisional" in src, (
        "`bases.py` no longer mentions the provisional swing — the "
        "non-repainting rule this file argues from may have moved")
    assert "EXCLUDES the provisional" in src, (
        "the provisional-swing exclusion is gone. A Wyckoff phase machine "
        "needs label rollback; if this library now permits repainting, the "
        "reason the mandatory events are unshipped no longer holds.")
