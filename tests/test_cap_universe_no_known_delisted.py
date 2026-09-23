"""Standing regression guard — Packet Z CP2 (RG-33).

`api/data/cap_universe.json` (the $300M+ symbol universe backing autocomplete,
the background bars/name warm loops, and the substack ticker validator) must
never carry a ticker the already-shipped `delisted_registry.resolve()` already
knows is delisted. `delisted_registry.py`'s own docstring names the hazard
directly: a dead ticker pulled into the live warmers "has no live feed;
chasing one blanks the chart" — and `cap_universe.json` is exactly the file
that hazard is meant to stay out of.

Packet Z CP1 pruned the 102 offenders found at build time (2026-09-22, fresh
measurement — not the packet's earlier ~102 estimate, re-derived independently
and landing on the same number). This is the guard against it happening
again: there is no code writer for `cap_universe.json` (every historical
change is a hand-compiled, manually-committed data commit), so the only place
a check can live for a "writer" shaped like that is the review/CI gate every
such commit already passes through — this test.

Names, not counts: on failure this lists every offending ticker, mirroring
this repo's own standing convention (`CoverageLine`, `desk_session_audit`, …)
so the reader knows exactly what to remove rather than just how many.
"""
from api.services import cap_universe
from api.services import delisted_registry


def test_cap_universe_has_no_known_delisted_tickers():
    offenders = sorted(
        t for t in cap_universe.symbols()
        if delisted_registry.resolve(t) is not None
    )
    assert offenders == [], (
        f"{len(offenders)} ticker(s) in api/data/cap_universe.json already "
        "resolve as delisted per delisted_registry.resolve() and must be "
        "removed: " + ", ".join(offenders) + ". See Packet Z — "
        "docs/terminal-research/12-decisions/gates/"
        "packet-z-cap-universe-delisted-prune-gate.md"
    )
