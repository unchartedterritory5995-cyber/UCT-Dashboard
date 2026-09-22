"""NO STIMULUS = NO RESULT.

⛔⛔ THE RULE THIS FILE EXISTS TO ENFORCE. A harness may not report PASS for a
behaviour unless it has first PROVEN the stimulus for that behaviour actually
occurred. Silence is INVALID, never PASS.

This project has now produced five separate measurements that looked believable
and contained nothing:

  1. a scan harness whose arms shared one browser context, so IndexedDB leaked
     between them and every arm after the first read "warm"
  2. a timing run taken while two test suites were draining, where the CONTROL
     arm moved and the numbers were load, not signal
  3. a frame classifier reading two `window` globals that do not exist in the
     ChartWidget context -- 360 null samples became a plausible PASS
  4. a camera audit whose "did it actually move?" filter sampled the range
     SYNCHRONOUSLY, so LWC's async scroll was discarded as a no-op and a real
     violation reported zero
  5. a camera run whose realtime stimulus was a fixture returning `{}` for
     /api/live-prices, so nine "clean" scenarios never received a single tick

Every one of them failed SILENTLY and read as success. The common shape is an
instrument whose failure mode is absence, and absence looks exactly like a
well-behaved product. So a verdict is no longer allowed to exist without its
stimulus being demonstrated first.

Three states, not two:

  PASS     the stimulus occurred AND the invariant held
  FAIL     the stimulus occurred AND the invariant was violated
  INVALID  the stimulus did not occur, or could not be proven

INVALID fails the run. It is never counted in a success denominator -- "100/100
passed" when 37 never received data is the exact lie this prevents.
"""
from __future__ import annotations

PASS = "PASS"
FAIL = "FAIL"
INVALID = "INVALID"


class StimulusError(RuntimeError):
    """Raised when a required stimulus could not be proven."""


def require(name, predicate, evidence=None, *, hard=True):
    """Prove a stimulus happened, or refuse to draw a conclusion.

    `predicate` is the already-evaluated truth of "the world changed"; it is a
    value, not a callable, so the caller is forced to gather the EVIDENCE
    rather than hand over something that might quietly throw.

    `evidence` is whatever was observed -- before/after values, counts, ids.
    It is recorded either way, because a failed stimulus is a finding about the
    harness and needs the same forensics as a failed invariant.
    """
    ok = bool(predicate)
    rec = {"stimulus": name, "proven": ok, "evidence": evidence}
    if not ok and hard:
        raise StimulusError(f"stimulus not proven: {name} | evidence={evidence}")
    return rec


def verdict(stimulus_ok, invariant_ok):
    """The only place a scenario's outcome is decided."""
    if not stimulus_ok:
        return INVALID
    return PASS if invariant_ok else FAIL


def summarize(results):
    """A denominator that cannot lie: INVALID is reported, never absorbed."""
    n = len(results)
    p = sum(1 for r in results if r["verdict"] == PASS)
    f = sum(1 for r in results if r["verdict"] == FAIL)
    i = sum(1 for r in results if r["verdict"] == INVALID)
    return {
        "requested": n,
        "valid": p + f,          # only scenarios whose stimulus was proven
        "passed": p,
        "failed": f,
        "invalid": i,
        # ⛔ Acceptance requires BOTH. A run with zero failures and seventeen
        # invalids has not tested anything seventeen times.
        "accepted": (f == 0 and i == 0 and n > 0),
    }


def render(summary, title="acceptance"):
    lines = [
        f"{title}: requested={summary['requested']}  valid={summary['valid']}  "
        f"passed={summary['passed']}  failed={summary['failed']}  invalid={summary['invalid']}",
    ]
    if summary["invalid"]:
        lines.append("  !! INVALID scenarios present -- no product conclusion may be drawn from them.")
    lines.append("  RESULT: " + ("ACCEPTED" if summary["accepted"] else "NOT ACCEPTED"))
    return "\n".join(lines)
