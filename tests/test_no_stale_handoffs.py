"""⚰️ A HAND-OFF THAT OUTLIVES ITS OWNER BECOMES PERMANENT.

`closedTable.json::_scalars_excluded["chg_pct_3m"]` read, for thirty columns at
once (the other twenty-nine point at it rather than repeating it)::

    "declaring the Wave 1 additions into the formula vocabulary is Wave 6's job
     (spec Section 2.4), so no formula can read it until then"

Wave 6 RAN. `docs/superpowers/plans/2026-08-23-screener-wave6-presets-parity.md`
promoted exactly five Wave-1 columns and excluded `accdis`; these thirty were not
among them. So the sentence named an owner that had finished — and nobody waits
for a wave that is done. Thirty shipped screener columns stayed out of the
formula vocabulary behind a sentence that had quietly stopped being true.

⭐ THE RULE THIS PINS is narrow and checkable without a database: an exclusion
reason may not defer to a wave whose PLAN DOCUMENT already exists on disk. Once
the plan is written, "wait for wave N" is no longer a thing anyone can act on;
the reason has to be restated in terms of what is true now.

⛔ IT IS DERIVED FROM THE DOCS DIRECTORY, not from a list of wave numbers typed
here — so wave 7's plan landing makes any "wave 7 will do it" note red on the day
the plan appears, which is exactly when it stops being a live promise.
"""

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
TABLE = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json"
PLANS = ROOT / "docs" / "superpowers" / "plans"

#: "Wave 6's job", "is wave 7's work", "wave 6 will" — the deferral shapes.
DEFER = re.compile(r"wave\s*(\d+)(?:'s|’s)?\s*(?:job|work|task|will|to do)", re.I)


def _planned_waves():
    """The wave numbers whose plan document exists — derived, never typed."""
    found = set()
    if not PLANS.is_dir():
        return found
    for path in PLANS.glob("*.md"):
        for match in re.finditer(r"wave(\d+)", path.name, re.I):
            found.add(int(match.group(1)))
    return found


def _reasons():
    """Every excluded-name reason in the manifest, keyed by section and name."""
    table = json.loads(TABLE.read_text(encoding="utf-8"))
    out = {}
    for section in ("_scalars_excluded", "_functions_excluded"):
        for name, reason in (table.get(section) or {}).items():
            if isinstance(reason, str):
                out[f"{section}.{name}"] = reason
    return out


def test_the_detector_and_the_plan_index_are_both_real():
    """⛔ NON-VACUITY FIRST, in both directions. A regex that matches nothing and
    an empty plan index would make the rail below pass over an empty product."""
    assert DEFER.search("declaring these is Wave 6's job (spec Section 2.4)")
    assert DEFER.search("wave 7 will promote them")
    assert not DEFER.search("a Wave 1 screener column that ships in the screener")

    planned = _planned_waves()
    assert 6 in planned, "the wave-6 plan is missing; this rail would prove nothing"
    assert len(planned) >= 5

    reasons = _reasons()
    assert len(reasons) > 40, "the manifest exposed no exclusion reasons to check"


def test_no_exclusion_defers_to_a_wave_whose_plan_has_shipped():
    """⭐⭐ THE RULE. Deferring to a planned wave is a promise nobody is keeping."""
    planned = _planned_waves()
    offenders = []
    for where, reason in sorted(_reasons().items()):
        for match in DEFER.finditer(reason):
            wave = int(match.group(1))
            if wave in planned:
                offenders.append(f"{where} defers to wave {wave}, whose plan exists")
    assert offenders == [], (
        "these reasons wait for a wave that has already been written:\n  "
        + "\n  ".join(offenders))
