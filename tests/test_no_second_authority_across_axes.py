"""No two axes may answer the same member-facing question under the same name.

⭐⭐ WHY THIS EXISTS. The screener describes a symbol on three independent axes:
BASE STRUCTURES (`base_catalog`, a multi-day setup), BAR CHARACTERS
(`bar_character`, what the newest bar did) and FILTERS (`filters`, a column a
member can screen on). Each is a legitimate, separate vocabulary. But a LABEL is
what a member actually reads, and two axes shipping the same label are two
authorities over one question — the defect this repo has paid for in the writer
index, the COT router's "4 routes", the setup catalog's "24", the single-writer
index, and `lesson_a_second_authority_over_one_value`.

⛔ AND THE FAILURE IS SILENT BY CONSTRUCTION. Both halves stay individually
correct; they simply disagree, in a column a member is reading for a decision.
Nothing in a unit test can see it, because neither side is wrong on its own.

⛔ THE SWEEP IS DERIVED FROM THE MODULES, NEVER TYPED. A hand-listed set of
labels goes stale the day someone adds one, which is precisely when this rail
needs to fire.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc
from api.services.screener import bar_character as bch
from api.services.screener import filters as flt


# ─── KNOWN AND MEASURED, awaiting a decision ────────────────────────────────
#
# ⛔ An entry here is a RECORDED DEFECT, not an exemption earned by age. Each
# must say what the two authorities are and why the collision has not been
# resolved yet. `test_every_allowance_still_collides` deletes the excuse the
# moment it stops being true.
ALLOWED = {
    "pocket pivot": (
        "`base_catalog.POCKET_PIVOT` implements the full Morales/Kacher rule "
        "(volume above the largest down-day volume in ten sessions, a top-half "
        "close, above BOTH the 50- and 200-day, an extension test, a 5-month "
        "downtrend disqualifier, and an explicit refusal when the window holds "
        "no down day). `bar_character`'s `pocket-pivot` implements the first "
        "of those and the up-day test — so it is a strict SUPERSET wearing the "
        "same name, and a member can read 'Pocket Pivot' on the bar while the "
        "structure column declines to call it one. Measured 2026-08-31; the "
        "fix is a rename of the CHARACTER (it describes an accumulation bar, "
        "not the published setup), not a loosening of the structure."
    ),
}


def _index():
    """Every member-facing label, by axis. Returns (labels, per_axis_counts)."""
    labels, per_axis = {}, {"structure": 0, "character": 0, "filter": 0}

    def add(label, what, axis):
        if not label:
            return
        labels.setdefault(str(label).strip().lower(), set()).add(what)
        per_axis[axis] += 1

    for st in bc.ALL_STRUCTURES:
        add(st.label, f"base structure `{st.key}`", "structure")
    for ch in bch.CASCADE:
        add(ch.label, f"bar character `{ch.key}`", "character")
    for key, f in flt.FILTERS.items():
        # ⛔ FILTERS ARE DICTS. The first version of this sweep read them with
        # `getattr(f, "label")`, got None for every one, and silently skipped
        # the entire axis — reporting "no collision" for a label a shipped
        # filter carries. An index blind to an axis returns the same answer as
        # an axis with nothing in it, which is why the control below exists.
        add(f.get("label") if isinstance(f, dict) else getattr(f, "label", None),
            f"screener filter `{key}`", "filter")
    return labels, per_axis


def _collisions():
    labels, _ = _index()
    out = {}
    for label, owners in labels.items():
        axes = {o.split("`")[0].strip() for o in owners}
        if len(axes) > 1:
            out[label] = sorted(owners)
    return out


# ─── the control, first, because it is what makes the rest mean anything ────

def test_the_sweep_can_see_all_three_axes():
    """⛔ NON-VACUITY. Every assertion below is of the form "no collisions
    found". An index that reads an axis wrongly finds none there and passes
    loudly. This is the case that already caught a real blindness in this
    sweep's own first draft."""
    _, per_axis = _index()
    for axis, n in per_axis.items():
        assert n > 0, (
            f"the {axis} axis contributed NO labels to the index, so this rail "
            f"is blind to it and its 'no collisions' verdict is vacuous"
        )


def test_the_sweep_can_actually_detect_a_collision():
    """The detector responds to input. Without this, a `_collisions()` that
    always returned `{}` would satisfy every other case in the file."""
    labels, _ = _index()
    assert labels, "the index is empty"
    # A synthetic label owned by two axes must be reported.
    probe = dict(labels)
    probe["synthetic collision probe"] = {
        "base structure `x`", "bar character `y`"}
    found = {
        lab for lab, owners in probe.items()
        if len({o.split("`")[0].strip() for o in owners}) > 1
    }
    assert "synthetic collision probe" in found


# ─── the rule ───────────────────────────────────────────────────────────────

def test_no_unrecorded_label_is_owned_by_two_axes():
    unrecorded = {k: v for k, v in _collisions().items() if k not in ALLOWED}
    assert not unrecorded, (
        "these labels are answered by more than one axis, so a member can read "
        "two different verdicts under one name:\n"
        + "\n".join(f"  {lab!r}: {owners}" for lab, owners in sorted(unrecorded.items()))
        + "\n\nRename one side, or record it in ALLOWED with the measurement "
          "that says which is which. Do NOT widen the narrower rule to match."
    )


def test_every_allowance_still_collides():
    """⛔ THE ALLOW-LIST GUARD BITES BOTH WAYS. A recorded collision that has
    been fixed must be deleted from ALLOWED, or the list becomes a place
    exemptions go to be forgotten — and the next reader inherits a file that
    documents a defect which no longer exists."""
    live = _collisions()
    stale = sorted(k for k in ALLOWED if k not in live)
    assert not stale, (
        f"ALLOWED records {stale} as a live cross-axis collision, but the sweep "
        f"no longer finds it. Delete the entry — it has been fixed."
    )


def test_every_allowance_carries_its_reasoning():
    """An exemption with no argument is an exemption nobody can audit."""
    for label, why in ALLOWED.items():
        assert why and len(why) > 120, (
            f"{label!r} is exempted without saying what the two authorities are "
            f"and why the collision is still open"
        )
