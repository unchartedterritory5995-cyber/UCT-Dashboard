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
import sys, pathlib, re
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
ALLOWED: dict = {
    # ⭐ EMPTY, AND THAT IS A RESULT, NOT A DEFAULT. This list held exactly
    # one entry -- "pocket pivot", shipped as BOTH a base structure (the full
    # Morales/Kacher rule) and a bar character (its volume signature alone).
    # `test_every_allowance_still_collides` is what emptied it: the moment the
    # character was renamed to "Up Day, Volume Tops Recent Selling", the
    # allowance went stale and the rail refused to let the excuse outlive the
    # defect. An exemption list nobody prunes is where exemptions go to be
    # forgotten.
}


#: ⛔ THE PATTERN ENGINE IS A FOURTH AXIS, AND IT IS COMPARED BY KEY, NOT LABEL.
#: Its ~85 detectors register by `pattern_id`; their display names live in
#: per-detector maps (`kell_cycle._STAGE_NAMES` and friends), so there is no
#: uniform label to sweep. Comparing the normalised KEY is the honest thing this
#: file CAN derive -- and it is enough, because a shared key is a shared concept.
#: ⚠️ STATED LIMIT: a pattern-engine STAGE label ("Wedge Pop", inside
#: `kell_cycle`) is invisible to this sweep. That is how "Wedge Pop" was nearly
#: rebuilt as a base structure on 2026-08-31 when it already shipped as Kell
#: stage 2 -- found by hand, not by this rail.
_ENGINE_DIR = pathlib.Path(__file__).resolve().parents[1] /     "api/services/pattern_engine/detectors"


def _engine_pattern_ids() -> set:
    """Derived by reading the declarations, never imported and never typed.

    An import would drag the whole engine (and its registry side effects) into
    a test that only needs the names."""
    out = set()
    for f in _ENGINE_DIR.rglob("*.py"):
        for m in re.finditer(r'^_PATTERN_ID\s*=\s*"([^"]+)"',
                             f.read_text(encoding="utf-8"), re.M):
            out.add(m.group(1))
    return out


def _norm(s: str) -> str:
    return str(s).replace("-", "_").replace(" ", "_").lower()


def _engine_collisions() -> dict:
    """Base structures that share a concept with a pattern-engine detector."""
    ids = {_norm(i) for i in _engine_pattern_ids()}
    return {st.key: f"pattern engine `{_norm(st.key)}`"
            for st in bc.ALL_STRUCTURES if _norm(st.key) in ids}


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


#: ⭐ FIVE CONCEPTS ARE IMPLEMENTED TWICE, BY TWO ENGINES, AND BOTH ARE LIVE.
#: `base_catalog` answers through the screener's `base_matches` column; the
#: pattern engine answers through `pattern_detections`, which Compass reads via
#: `find_patterns_on_ticker` / `scan_active_patterns`.
#:
#: ⛔⛔ THE MEASUREMENT LIVES IN `tests/test_two_engines_do_not_agree.py`, NOT
#: HERE. This comment used to carry the 2026-08-31 table (744 tickers:
#: double-bottom 7%, flat-base 13%, vcp 3%, wyckoff-spring 7%, high-tight-flag
#: 0% agreement). It has been re-measured on 1,397 tickers with both arms on the
#: SAME bar array, and a comment beside an allow-list is the wrong home for a
#: number anyway: nothing here fails when it stops describing the code, which is
#: how the table survived a threshold change it no longer described. Keeping a
#: second copy is `lesson_a_second_authority_over_one_value` applied to our own
#: evidence. Read that file; re-run `tools/two_engine_agreement.py`.
#:
#: ⚠️ TWO THINGS THAT FILE FOUND WHICH THIS SWEEP STRUCTURALLY CANNOT.
#:   1. The raw agreement rate is the wrong statistic — it is ceilinged by the
#:      two engines' different base rates. Chance-corrected (Cohen's kappa),
#:      `double-bottom` scores 0.010 and `vcp` 0.003: the two verdicts are
#:      statistically INDEPENDENT, not merely divergent.
#:   2. There is a SIXTH pair this sweep cannot see, because it compares
#:      normalised KEYS and the two spellings differ: the catalog's
#:      `cup-with-handle` and the engine's `cup_handle`. The stated limit above
#:      ("a pattern-engine STAGE label is invisible") has a second half — so is
#:      a synonym. Widening the comparison past key equality needs a rule for
#:      what counts as the same concept, which is why it is named rather than
#:      guessed at here.
#:
#: This is an OWNER decision, not a rename: two engines, two surfaces, two
#: contracts (the engine emits entry/stop/target, the catalog emits a label and
#: its provenance). Recorded so it cannot be rediscovered as a surprise.
ENGINE_ALLOWED = {
    "double-bottom", "flat-base", "high-tight-flag", "vcp", "wyckoff-spring",
}


def test_the_engine_sweep_is_not_vacuous():
    ids = _engine_pattern_ids()
    assert len(ids) > 50, (
        f"only {len(ids)} pattern ids were derived from {_ENGINE_DIR} — the "
        f"sweep is not reading the detectors, so its verdict means nothing")


def test_no_unrecorded_concept_is_implemented_by_both_engines():
    live = _engine_collisions()
    unrecorded = {k: v for k, v in live.items() if k not in ENGINE_ALLOWED}
    assert not unrecorded, (
        "these concepts are implemented by BOTH `base_catalog` and the pattern "
        "engine, so the screener and Compass can give a member different "
        "answers to one question:\n"
        + "\n".join(f"  {k}  <->  {v}" for k, v in sorted(unrecorded.items()))
        + "\n\nMeasure the agreement before deciding — see ENGINE_ALLOWED.")


def test_every_engine_allowance_still_collides():
    live = set(_engine_collisions())
    stale = sorted(ENGINE_ALLOWED - live)
    assert not stale, (
        f"ENGINE_ALLOWED records {stale} as implemented by both engines, but "
        f"the sweep no longer finds them. Delete the entries.")


def test_every_allowance_carries_its_reasoning():
    """An exemption with no argument is an exemption nobody can audit."""
    for label, why in ALLOWED.items():
        assert why and len(why) > 120, (
            f"{label!r} is exempted without saying what the two authorities are "
            f"and why the collision is still open"
        )
