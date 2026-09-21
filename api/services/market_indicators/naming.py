"""NAMING AND IDENTITY — the one place that decides what a series is CALLED.

⭐⭐ FOUR STRINGS, FOUR JOBS, AND FORCING ONE STRING TO DO TWO OF THEM IS THE DEFECT
THIS MODULE EXISTS TO PREVENT:

    id        the canonical INTERNAL identity. Compact, stable, minted by the
              registry, never parsed to recover its parts, never shown to a member
              as the primary name.          e.g. `US:MCO`, `SENT:NAAIM`, `CBOE:VIX9D`
    symbol    what a member TYPES. Usually the id; for an established indicator it is
              the established ticker.       e.g. `US:MCO`, `NAAIM`, `VIX9D`
    display   the sentence a member READS.  e.g. `US · McClellan Oscillator`
    short     the compact label a legend or a tile has room for.   e.g. `US McClellan`

⛔⛔ AND THE NAMING RULES ARE DATA-DRIVEN FUNCTIONS, NOT TYPED STRINGS PER SERIES.
`UCT · % Above 50-Day MA`, `US · % Above 50-Day MA`, `Nasdaq · % Above 50-Day MA` and
`NYSE · % Above 50-Day MA` are ONE rule applied four times. Typing them out is how the
fifth universe gets a name nobody notices is inconsistent.

The five rules, as locked by the owner (2026-09-20):

  RULE 1  ESTABLISHED INDICATOR → ESTABLISHED NAME. If the market already calls it
          NYMO and our implementation faithfully reproduces it, it is NYMO — not
          "UCT NYMO", which would imply a proprietary variant.
  RULE 2  STANDARD METRIC ACROSS UNIVERSES → `Universe · Metric`. A general function.
  RULE 3  GENUINELY PROPRIETARY → UCT-branded. Because the universe IS UCT, or because
          the concept is ours. Never as decoration.
  RULE 4  INTERNAL SYMBOL ≠ DISPLAY NAME. See above.
  RULE 5  LEGACY ALIASES REMAIN SEARCHABLE. `UCTA50` must keep finding
          `UCT · % Above 50-Day MA` forever.

⚠️ RULE 1 HAS A PRECONDITION AND IT IS LOAD-BEARING: *"AND our implementation
faithfully reproduces that indicator"*. A McClellan Oscillator computed over UCT's
US common-stock universe is not NYMO, because NYMO is computed over the NYSE composite
(every issue: ETFs, closed-end funds, preferreds, rights, warrants) as published by
Dow Jones. `established_name_allowed()` is where that precondition lives, so the rule
cannot be applied by wishful thinking.
"""
from __future__ import annotations

from typing import Optional

#: ⛔⛔ A DISPLAY LABEL IS NOT THE IDENTITY LABEL, and they must not be merged.
#: `breadth_universes.label()` returns the string used to MINT symbols — `NASDAQ:A50` —
#: so it is all-caps and frozen by every stored layout, watchlist and drawing that holds
#: one. The owner's naming rule asks for `Nasdaq · % Above 50-Day MA` in prose. Changing
#: `label()` to get the prose form would silently rename every minted symbol; this table
#: is the Rule-4 separation applied to universes.
UNIVERSE_DISPLAY = {
    "uct": "UCT",
    "us": "US",
    "nasdaq": "Nasdaq",
    "nyse": "NYSE",
}

#: The separator between a universe and its metric. One constant so a future change is
#: one edit rather than a grep, and so tests can assert the shape without retyping it.
SEP = " · "


def universe_display(universe_id: Optional[str]) -> str:
    """The prose form of a universe id. Falls back to the identity label, then to the
    id itself — an unknown universe must degrade to something readable, never crash a
    catalogue render."""
    from api.services import breadth_universes as bu
    uid = bu.normalize(universe_id)
    if uid in UNIVERSE_DISPLAY:
        return UNIVERSE_DISPLAY[uid]
    try:
        return bu.label(uid)
    except Exception:
        return str(universe_id or "")


def universe_metric_display(universe_id: Optional[str], metric_name: str) -> str:
    """RULE 2, as a function. `('nasdaq', '% of Stocks Above 50-Day MA')` →
    `'Nasdaq · % of Stocks Above 50-Day MA'`.

    ⚠️ IT DOES NOT REWRITE THE METRIC'S OWN NAME. The catalogue owns that string; this
    only prefixes the population it was measured over. A function that also "tidied"
    the metric name would become a second authority on what the metric is called.
    """
    u = universe_display(universe_id)
    name = (metric_name or "").strip()
    if not u:
        return name
    if not name:
        return u
    return f"{u}{SEP}{name}"


def universe_metric_short(universe_id: Optional[str], short_name: str) -> str:
    """The compact form for a legend or a heatmap tile: `Nasdaq A50`.

    ⚠️ SPACE, NOT `·`. The middle dot earns its place in a sentence where the two
    halves are read separately; in a 60-pixel legend slot it is noise.
    """
    u = universe_display(universe_id)
    s = (short_name or "").strip()
    return f"{u} {s}".strip() if u else s


# ── RULE 1 — when an established name may be used ────────────────────────────

class EstablishedNameRefused(ValueError):
    """Raised when code tries to attach a famous name to a series that has not earned it.

    ⛔ A RAISE, NOT A WARNING. The whole project ships under "accuracy before branding";
    a soft failure here would let a mislabelled series reach a member while a log line
    nobody reads records the problem.
    """


def established_name_allowed(*, reproduces_reference: bool,
                             validation_report: Optional[object] = None) -> bool:
    """May this series carry an established market name?

    Two conditions, both required:

      1. The producer asserts that it reproduces the established indicator — i.e. it is
         computed over the SAME population with the SAME methodology, not merely with
         the same arithmetic over a different census.
      2. A validation report exists and passed.

    ⚠️ CONDITION 1 CANNOT BE CHECKED BY CODE and is therefore a declaration the registry
    row has to make explicitly. That is the point: somebody has to write it down, and
    the registry is where a reviewer will look.
    """
    if not reproduces_reference:
        return False
    if validation_report is None:
        return False
    return bool(getattr(validation_report, "ok", False))


def assert_established_name(name: str, *, reproduces_reference: bool,
                            validation_report: Optional[object] = None) -> str:
    if not established_name_allowed(reproduces_reference=reproduces_reference,
                                    validation_report=validation_report):
        raise EstablishedNameRefused(
            f"{name!r} is an established market indicator name. It may only be used by a "
            f"series that reproduces the established indicator over the same population "
            f"AND carries a passing validation report. This one does not.")
    return name


# ── Search tokens ────────────────────────────────────────────────────────────

def search_tokens(*parts) -> tuple:
    """Normalise anything a query might legitimately match into a deduped tuple.

    ⭐ TOKENS ARE UPPER-CASED AND DEDUPED HERE, ONCE, so every consumer compares the
    same way. `library_search` already learned this lesson for the breadth library: the
    tokeniser is not the place where identity is decided, but it IS the place where
    "NASI" and "nasi" must stop being two things.
    """
    seen, out = set(), []
    for p in parts:
        if p is None:
            continue
        items = p if isinstance(p, (list, tuple, set, frozenset)) else [p]
        for it in items:
            t = str(it).strip().upper()
            if t and t not in seen:
                seen.add(t)
                out.append(t)
    return tuple(out)
