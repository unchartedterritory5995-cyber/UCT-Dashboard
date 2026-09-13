"""THE placeholder-stop detector. One definition, three call sites.

⛔ APPROVED SCOPE (owner, 2026-09-13, H14), verbatim: *"one detector in
awareness/engine.py (or wherever the strictest currently lives), tolerance = the
strictest of the three after you show me the three values; the other two call
sites import it. A rail asserts only one definition exists."*

──────────────────────────────────────────────────────────────────────────────
⛔⛔ WHY THIS FILE EXISTS — three detectors, three tolerances, one of them live
──────────────────────────────────────────────────────────────────────────────

A broker import cannot leave `j2_positions.stop_price` NULL — the column is NOT
NULL and the broker reports no stop — so it seeds `stop_price = entry_price` as
a placeholder meaning *"this member has not set a stop."* Everything downstream
has to recognise that, and three places did it three different ways:

    awareness/rules.py:74      abs(stop - entry) <  1e-9              ABSOLUTE
    portfolio_heat.py:35       abs(stop - entry) <= entry * 1e-9      RELATIVE
    broker/balances.py:459     abs(stop - entry) <= max(0.001, entry * 1e-5)

⭐ AND THE ROW THAT ACTUALLY HAPPENED SEPARATES THEM. A later sync refreshed
`entry_price` and left the old placeholder behind, so the two drifted by
rounding — ORCL, entry 126.0049 against stop 126.005, a drift of 1.0e-4:

    awareness/rules.py    -> NOT a placeholder
    portfolio_heat.py     -> NOT a placeholder
    broker/balances.py    -> placeholder

⛔ THE ONE THAT MISSED IT GATES A MEMBER ALERT. `rule_stop_watch` skips
placeholders; a placeholder it fails to recognise reaches the distance test, and
for a stop at-or-through the price it emits `stop_hit` at importance 10 — which
`add_insight`'s floor away-delivers by email and Discord. A stop alert about a
stop the member never set.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ "STRICTEST" SPLIT TWO WAYS, AND THE TWO READINGS GIVE OPPOSITE CODE
──────────────────────────────────────────────────────────────────────────────

Read as *narrowest tolerance*, the strictest is `rules.py`'s absolute `1e-9` —
which is the value that produced the defect. Adopting it would unify the three
call sites onto the bug.

Read as *strictest about what counts as a REAL stop*, it is `balances.py`'s
`max(0.001, |entry| * 1e-5)` — the widest placeholder window, the only one that
catches the real row, and the one written AFTER the drift happened rather than
before it was known.

**This module takes the protective reading**, PROVISIONAL, recorded in
GATE-H14-PLACEHOLDER-STOP and reversible by editing two constants.

⚠️ AND THE WIDE WINDOW COSTS SOMETHING IN THE OTHER DIRECTION, STATED: a member
who sets a genuine stop within the window is read as having set none, and stops
being watched. Measured, the window is 0.1c at $1, 0.13c at $126 and 10c at
$10,000 — no deliberate stop sits there, and a stop that close would be through
the spread before it could be watched anyway. The alternative failure — a false
`stop_hit` emailed about a stop nobody set — is both louder and more likely.

──────────────────────────────────────────────────────────────────────────────
⛔ THE SOURCE GATE STAYS AT THE CALL SITE
──────────────────────────────────────────────────────────────────────────────

This answers ONE numeric question: *is this stop unusable, or indistinguishable
from the entry it mirrors?* Whether a placeholder should be SKIPPED is a policy
that differs per caller — `rule_stop_watch` skips only `source == 'broker'`
rows, `portfolio_heat` excludes any of them from the confident heat number and
then SURFACES them. Folding either policy in here would make one call site
inherit the other's judgement silently, which is the shape this module exists to
remove.
"""
from __future__ import annotations

#: The absolute floor of the placeholder window, in price units. Below ~$100 the
#: relative term is smaller than a hundredth of a cent, which is finer than any
#: price this app stores.
PLACEHOLDER_STOP_ABS_TOL = 0.001

#: The relative term, which takes over above ~$100 so the window scales with the
#: instrument rather than pinning a $10,000 share to the same tolerance as a $1
#: one.
PLACEHOLDER_STOP_REL_TOL = 1e-5


def is_placeholder_stop(stop, entry) -> bool:
    """True when `stop` is not a real stop.

    Two clauses, and they are different facts:

      UNUSABLE            a non-positive or missing stop or entry. A stop of 0
                          on a SHORT computes a distance of -1.0 and fires
                          `stop_hit` on every cycle; it is not a stop.
      INDISTINGUISHABLE   within `max(ABS, |entry| * REL)` of the entry it
                          mirrors — the broker placeholder, including one that
                          has drifted by a later entry refresh.

    ⛔ NEVER RAISES AND NEVER GUESSES. A value it cannot read as a number is
    UNUSABLE, which is the safe direction: an unreadable stop is not a stop.
    """
    try:
        stop_v = float(stop)
        entry_v = float(entry)
    except (TypeError, ValueError):
        return True
    # ⛔⛔ NaN FIRST, AND THIS IS NOT DEFENSIVE PADDING — IT IS A REAL DEFECT THE
    # FIRST DRAFT OF THIS FUNCTION HAD. `abs(nan - x) <= y` is FALSE, so a NaN
    # stop falls through every comparison below and is reported as a REAL stop
    # — the worst possible answer, because a real stop gets WATCHED and its
    # distance computed, and every comparison against NaN is False, so the
    # position is silently never alerted on at all. Caught by its own test.
    if stop_v != stop_v or entry_v != entry_v:
        return True
    if stop_v in (float("inf"), float("-inf")) or entry_v in (float("inf"), float("-inf")):
        return True
    if stop_v <= 0 or entry_v <= 0:
        return True
    return (abs(stop_v - entry_v)
            <= max(PLACEHOLDER_STOP_ABS_TOL, abs(entry_v) * PLACEHOLDER_STOP_REL_TOL))
