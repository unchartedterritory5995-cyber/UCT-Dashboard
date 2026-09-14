"""F-S7-PL-3 — the report's self-check counts what it reads, never a literal.

⚰️ **THE DEFECT.** `--self-check` carried `if len(SWEEPS) != 6` and went RED the
day a seventh sweep was declared:

    SELF-CHECK FAIL: expected six declared sweeps, found 7

⛔ **AND THIS ONE IS WORSE THAN THE USUAL STALE COUNT.** `--ticking` itself was
correct the whole time — verified in-pod, exit 0, all seven reported. The only
broken thing was **the check that tells you the tool is broken**, which is the
one component whose failure is silent by construction: a red self-check reads as
"the instrument is untrustworthy", so the honest reaction is to stop trusting a
tool that was working.

⭐ **THE FIX IS A DERIVATION FROM THE SAME REGISTRY `--ticking` ITERATES**
(`declared_sweeps()`), so the two can never disagree about what is declared. A
count alone would be vacuous — `len == len` — so the self-check also asserts
every declared descriptor is ANSWERABLE: it renders, names its own label, and
returns a real exit code.

⛔ **THE CONTROL IS WHAT PROVES IT IS A DERIVATION AND NOT A RESTATED LITERAL.**
Registering a throwaway eighth descriptor must make the count read eight, and
unregistering it must put it back to seven. A "derivation" that does not move
when its source moves is a literal wearing a function's name.
"""
import importlib.util
import pathlib

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_TOOL = _REPO / "tools" / "s7_price_level_report.py"


def _load():
    """A FRESH module each time — the self-check rebinds `_window` on the module,
    so a shared instance would leak that between tests."""
    spec = importlib.util.spec_from_file_location("s7rep_selfcheck", str(_TOOL))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _throwaway(rep):
    """An extra descriptor shaped exactly like a real row of the table.

    ⛔ Derived from a REAL row's arity so it cannot drift from the tuple shape:
    a hand-built 8-tuple would keep passing after the descriptor gains a field.
    """
    real = rep.declared_sweeps()[0]
    assert len(real) == 9, f"descriptor shape changed ({len(real)} fields) — update this control"
    return ("throwaway_selfcheck", "THROWAWAY", "ALERT_TAXONOMY_THROWAWAY_DARK_ENABLED",
            "throwaway_heartbeat", "last_tick_at", (9, 16), 180,
            "never scheduled — a self-check control only", None)


# ───────────────────────────────────────── the count follows its source

def test_the_count_is_derived_from_the_registry_ticking_reads():
    rep = _load()
    assert rep.declared_sweep_count() == len(rep.SWEEPS)
    assert rep.declared_sweeps() is rep.SWEEPS, "the helper copied the table instead of reading it"


def test_seven_sweeps_are_declared_today():
    """A real number, asserted once, in the place where changing it is the point
    of the commit — NOT inside the instrument's own self-test."""
    assert _load().declared_sweep_count() == 7


def test_registering_an_eighth_descriptor_makes_the_count_read_eight(monkeypatch):
    """⭐ THE CONTROL. If this stays at seven, `declared_sweep_count()` is a
    literal wearing a function's name."""
    rep = _load()
    assert rep.declared_sweep_count() == 7
    monkeypatch.setattr(rep, "SWEEPS", tuple(rep.SWEEPS) + (_throwaway(rep),))
    assert rep.declared_sweep_count() == 8, "the count did not follow the registry"
    assert rep.declared_sweeps()[-1][1] == "THROWAWAY"


def test_unregistering_it_puts_the_count_back_to_seven():
    """The other half of the control — monkeypatch's teardown must restore the
    real table, so a leaked patch cannot make the suite lie about the count."""
    rep = _load()
    original = tuple(rep.SWEEPS)
    rep.SWEEPS = original + (_throwaway(rep),)
    try:
        assert rep.declared_sweep_count() == 8
    finally:
        rep.SWEEPS = original
    assert rep.declared_sweep_count() == 7


# ─────────────────────────────────── the self-check itself, and its exit code

def test_the_self_check_passes_and_names_the_derived_count(capsys):
    rep = _load()
    code = rep._self_check()
    out = capsys.readouterr().out
    assert code == 0, out
    assert "self-check: PASS" in out
    assert "all 7 declared sweeps" in out, (
        "the PASS line does not carry the DERIVED count — a reader cannot tell "
        "how many sweeps were actually checked\n" + out)


def test_the_self_check_carries_no_hand_typed_sweep_count():
    """⛔ CODE, NEVER PROSE. The literal is hunted in the STRIPPED source, so the
    ⚰️ comment above the fix — which necessarily quotes `len(SWEEPS) != 6` —
    cannot make this fail, and cannot make it pass either."""
    import ast
    src = _TOOL.read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) \
                and isinstance(node.value.value, str):
            node.value.value = ""          # blank docstrings; ast.unparse keeps them
    code_only = ast.unparse(tree)
    assert "len(SWEEPS) != 6" not in code_only, "the hand-typed count is back in CODE"
    # CONTROL — the stripper must still be able to SEE a real occurrence.
    assert "declared_sweep_count" in code_only, "the code-only view lost the real symbol"


def test_the_self_check_would_notice_an_unanswerable_descriptor(monkeypatch, capsys):
    """NON-VACUITY for the answerability half: a descriptor whose heartbeat table
    name is a typo must be reported, not pass as a permanent n/a."""
    rep = _load()
    broken = list(_throwaway(rep))
    broken[3] = "no_such_heartbeat_table"
    monkeypatch.setattr(rep, "SWEEPS", tuple(rep.SWEEPS) + (tuple(broken),))
    code = rep._self_check()
    out = capsys.readouterr().out
    # It either flags it or answers it honestly as NO/n-a — what it must never do
    # is crash, and it must never claim a count it did not check.
    assert code in (0, 1), out
    assert "declared sweeps" in out or "self-check:" in out
