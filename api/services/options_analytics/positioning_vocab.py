"""FT-047 — the published dealer-positioning vocabulary: CLOSED and VERSIONED.

Built on the pattern TERM-041 set for the market regime (`voice_regime_classifier.py`
REGIME_VOCABULARY_VERSION / REGIMES / REGIME_DISPLAY, served by `GET /api/regime/vocabulary`):
one home for the ids, their order, the words a member reads and what each one means. A surface
renders `label_of(id)`, never a string it typed for itself.

⛔ THESE ARE OUR WORDS. SpotGamma's trademarked names (Volatility Trigger, SG Gamma Index) are not
  used; each term here is defined by how WE compute it, in `definition`.
⛔ CHANGING ANY OF IT IS DELIBERATE: `tests/test_options_positioning.py` pins every id, label and
  the order per version. A change without bumping POSITIONING_VOCABULARY_VERSION goes red.
⛔ An id outside POSITIONING_TERMS is a programming error (`label_of` raises), never a label
  improvised from the id.
⛔ RELATION TO `gex_service.classify_gex_state`: that function names a wall's ROLE relative to spot
  (Ceiling, Floor, Pull Up, Magnet, Danger Line). Those role words describe where a level sits
  today; the terms here name WHAT the level is. Both are shown; neither replaces the other.
"""
from __future__ import annotations

POSITIONING_VOCABULARY_VERSION = 1

#: id -> (label, definition, provenance). ORDER IS PUBLISHED (it is the order levels are listed).
_TERMS = (
    ("call_wall", "Call Wall",
     "The strike within 15% of spot carrying the most positive call gamma exposure.", "computed"),
    ("put_wall", "Put Wall",
     "The strike within 15% of spot carrying the most negative put gamma exposure.", "computed"),
    ("zero_gamma", "Zero Gamma",
     "The price where cumulative net gamma exposure across strikes crosses zero; below it, "
     "dealer hedging tends to add to moves rather than damp them.", "computed"),
    ("absolute_gamma_strike", "Absolute Gamma Strike",
     "The single strike with the largest gamma exposure, calls and puts counted unsigned.",
     "computed"),
    ("key_delta_strike", "Key Delta Strike",
     "The strike with the largest absolute delta exposure (delta x open interest x 100).",
     "computed"),
    ("max_pain", "Max Pain",
     "For the nearest expiration, the strike at which open options would pay their holders the "
     "least.", "computed"),
    ("implied_move_1d", "Implied 1-Day Move",
     "Spot x at-the-money implied volatility x the square root of 1/252: a one-standard-"
     "deviation day.", "computed from vendor IV"),
    ("implied_move_5d", "Implied 5-Day Move",
     "Spot x at-the-money implied volatility x the square root of 5/252.", "computed from vendor IV"),
    ("dealer_short", "Dealer Short",
     "A contract our trade-side attribution estimates market makers are net short: customers "
     "bought more of it than they sold.", "computed"),
    ("options_impact", "Options Impact",
     "Gamma notional relative to the stock's daily dollar volume: how much dealer hedging could "
     "matter to this stock at all.", "computed"),
)

POSITIONING_TERMS = tuple(t[0] for t in _TERMS)
_BY_ID = {t[0]: t for t in _TERMS}


def label_of(term_id: str) -> str:
    """The member-facing words for a term. An unknown id raises: no surface may invent one."""
    return _BY_ID[term_id][1]


def vocabulary() -> dict:
    return {"version": POSITIONING_VOCABULARY_VERSION, "closed": True,
            "terms": [{"id": i, "label": l, "definition": d, "provenance": p}
                      for i, l, d, p in _TERMS]}
