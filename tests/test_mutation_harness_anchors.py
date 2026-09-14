"""Every mutation harness's anchors still match, exactly once — as part of the GATE.

⛔⛔ A MUTATION THAT DID NOT APPLY IS A PROOF THAT DID NOT HAPPEN, AND `73/80 RED` READS LIKE A
NEAR-PERFECT SCORE. This programme has now measured that twice in two days:

  * **A29** — "the V2 handlers bind adapters and not the raw clients" — sat stale through several
    merges, reported as a footnote under the number people quote;
  * **seven more** went stale in a single session because the INTEGRATOR's own OI-29 patch moved
    the lines they anchored on. The people most likely to invalidate a mutation anchor are the
    people adding the next guard.

Owner ruling, 2026-09-14: **NOT-APPLIED ≠ 0 FAILS, it is never just printed** — and the check runs
in the gate rather than only when somebody remembers to spend twenty-five minutes.

⭐ THIS IS THE ONE-SECOND HALF. It proves each anchor still MATCHES; it does not prove the mutation
is still meaningful, which only a full run can. Both are needed and they fail for different reasons:
a stale anchor is a silent hole, a green mutation is a rail that stopped discriminating.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
INSTRUMENTS = REPO / "docs" / "discord-render" / "instruments"

#: Harnesses that expose `--dry-check`. ⛔ Derived from the directory, never typed: a harness added
#: tomorrow is covered the day it lands, which is the whole reason A29 survived so long.
HARNESSES = sorted(p.name for p in INSTRUMENTS.glob("mutation_harness*.py"))


def test_there_are_harnesses_to_check():
    """⛔ NON-VACUITY. An empty glob makes every parametrised case below vanish and the file passes
    by having nothing to say — which is exactly how an absent proof looks."""
    assert len(HARNESSES) >= 5, f"only {len(HARNESSES)} harness(es) found under {INSTRUMENTS}"


@pytest.mark.parametrize("harness", HARNESSES)
def test_every_mutation_anchor_still_matches_exactly_once(harness):
    """Run the harness's own `--dry-check`. No tests are executed; this reads the anchors.

    ⚠️ A harness WITHOUT `--dry-check` is skipped with the reason named, not silently passed — but
    `test_the_two_harnesses_this_programme_owns_have_a_dry_check` below refuses to let the two that
    matter drift into that state."""
    path = INSTRUMENTS / harness
    src = path.read_text(encoding="utf-8")
    # ⛔⛔ ASK THE SOURCE BEFORE EXECUTING IT. A harness that does not KNOW about `--dry-check`
    # does not refuse it — it ignores the flag and runs its FULL mutation set, which mutates
    # `api/**` for twenty-five minutes. ⚰️ Measured: the first version of this test did exactly
    # that, was killed mid-run, and left a mutation behind in `badge.py` — a test that can leave
    # the tree modified is worse than no test, and it would have been committed by the next
    # `git add`. The flag-dispatch line is the precondition for running the file at all.
    if '"--dry-check" in sys.argv' not in src:
        pytest.skip(f"{harness} does not dispatch --dry-check; NOT executed (it would run in full)")
    r = subprocess.run([sys.executable, str(path), "--dry-check"], cwd=REPO,
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=180)
    out = r.stdout + r.stderr
    assert "TOTALS" in out, (
        f"{harness} dispatches --dry-check but printed no totals line — and a run with no totals "
        f"line is not a run:\n{out.strip()[-600:]}")
    # ⛔ THE TOTALS LINE IS READ, NOT THE EXIT CODE. A runner that died at argument parsing exits 0
    # with an empty report, and this repo has banked that as green before.
    assert "stale=0" in out, f"{harness} has stale mutation anchors:\n{out.strip()[-1200:]}"
    assert r.returncode == 0, f"{harness} --dry-check exited {r.returncode}:\n{out.strip()[-600:]}"


@pytest.mark.parametrize("harness", ["mutation_harness_adapters.py",
                                     "mutation_harness_image_delivery.py"])
def test_the_two_harnesses_this_programme_owns_have_a_dry_check(harness):
    """⛔ THE SKIP ABOVE IS A COURTESY TO HARNESSES THIS PROGRAMME DID NOT WRITE, and it must not
    become the way these two stop being checked. A skip that can silently cover the case a rail
    exists for is the rail not existing."""
    src = (INSTRUMENTS / harness).read_text(encoding="utf-8")
    assert "def dry_check" in src, f"{harness} lost its --dry-check"
    assert '"--dry-check" in sys.argv' in src, f"{harness} no longer dispatches --dry-check"


@pytest.mark.parametrize("harness", HARNESSES)
def test_a_not_applied_mutation_fails_the_harness_rather_than_printing(harness):
    """Owner ruling: NOT-APPLIED ≠ 0 must FAIL, never merely print.

    ⛔ READ AS SOURCE STRUCTURE, NOT BY RUNNING A 25-MINUTE SET. Each harness reaches the same
    verdict one of two ways — a `bad` list that admits any non-RED verdict, or an `ok_all` flag
    cleared when the match count is not 1. Both are accepted; a harness with NEITHER is one where a
    skipped proof can exit 0."""
    src = (INSTRUMENTS / harness).read_text(encoding="utf-8")
    # ⚰️ THE FIRST VERSION OF THIS PREDICATE KNEW TWO IDIOMS AND THERE ARE THREE, so it failed
    # `mutation_harness_envlogs.py` — which sets `ok = False` on a non-1 match count and exits 1,
    # i.e. does exactly the right thing. An instrument reporting a property of its own pattern list
    # as a property of what it measured, for the third time in this programme.
    idioms = {
        'the `bad` list admits any non-RED verdict': 'if v != "RED"' in src,
        'an `ok_all` flag cleared on a bad match count':
            "ok_all = False" in src and "count != 1" in src,
        'an `ok` flag cleared on a bad match count':
            "ok = False" in src and "!= 1" in src,
    }
    assert any(idioms.values()), (
        f"{harness} has no recognised path from a NOT-APPLIED mutation to a non-zero exit — a "
        f"proof that did not happen would be printed and the run would still pass. If it uses a "
        f"FOURTH idiom, add it here with its name rather than loosening the check: "
        f"{list(idioms)}")


def test_the_retired_mutations_name_their_successors():
    """⛔⛔ A RETIRED CONTROL MUST BE VERIFIABLE, NOT TAKEN ON TRUST (owner requirement).

    A49-A53 were retired rather than re-aimed when C-06 moved the footer composition into
    `badge.py`, because re-aiming would have made a second copy of each guard and three copies of a
    rule cannot be mutation-proved. That is only sound if a future reader can CHECK that the guard
    still exists somewhere — so each retirement names the control that took it over, and this
    asserts those controls are really in the badge harness."""
    src = (INSTRUMENTS / "mutation_harness_adapters.py").read_text(encoding="utf-8")
    badge = (INSTRUMENTS / "mutation_harness_badge.py").read_text(encoding="utf-8")
    import re
    pairs = re.findall(r"retired → covered by ([A-Z]+\d+)", src)
    assert len(pairs) >= 5, (
        f"expected a `retired → covered by <id>` cross-reference per retired control, found "
        f"{len(pairs)}: {pairs}")
    for control in pairs:
        assert f'"name": "{control} ' in badge, (
            f"{control} is named as the successor of a retired mutation but does not exist in "
            f"mutation_harness_badge.py — the guard may have been lost with the retirement")
    # the control: prove the probe could fail on a fabricated id
    assert '"name": "B999 ' not in badge
