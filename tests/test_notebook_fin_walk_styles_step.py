"""Ledger R24 (P1 Task 15 review M2-M6): the styles walk step must wait, not sleep; the two rows must
check what their labels claim; the switch count must not be typed; styles_on mirrors the product gate.
These read the tool's source, because the only other proof is a two-hour re-walk (Task 13 is that).

CODE, NEVER PROSE (integrator ruling R-T2-1, fix round 1): every assertion about what the walk DOES is made
against the parsed AST, so a comment or a docstring that merely names a call cannot satisfy it. Each matcher
has two controls: one proving a source holding the needle ONLY in a comment and a docstring is NOT a match,
and one proving a real occurrence IS. The needles are built by concatenation so this file does not itself
hold the matched literal in a way a text sweep could mistake for the tool's code.
The one test whose SUBJECT is prose (`test_no_typed_switch_count`: the WAVE_FLAGS comment and the walk's module
docstring) reads comment tokens and bare string statements, and only those, with its own controls."""
from __future__ import annotations

import ast
import io
import re
import tokenize
from pathlib import Path

FEATURES = Path("tools/notebook_fin_walk_features.py")
WALK = Path("tools/notebook_fin_walk.py")

# Needles, built by concatenation (see the module docstring).
SAVE = "save" + "_landed"
WID = "widget" + "Id"
SLEEP_FAMILY = {"wait_for" + "_timeout", "sle" + "ep"}                  # last dotted segment: also time.sle..., asyncio.sle...


# ── matchers: all of them look at the AST, never at text ───────────────────────────────────────────
def _dotted(node) -> str:
    """`pg.keyboard.type` -> 'pg.keyboard.type'; `pg.get_by_role(x).click` -> 'pg.get_by_role().click'."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return _dotted(node.value) + "." + node.attr
    if isinstance(node, ast.Call):
        return _dotted(node.func) + "()"
    if isinstance(node, ast.Subscript):
        return _dotted(node.value) + "[]"
    return "?"


def _call_names(tree) -> list[str]:
    return [_dotted(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)]


def _code_strings(tree) -> list[str]:
    """String constants that are CODE: a bare string statement (a docstring or a stray string) is prose."""
    prose = {id(n.value) for n in ast.walk(tree) if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)}
    return [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in prose]


def _func(src: str, name: str):
    return next((n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef) and n.name == name), None)


def _calls_function(tree, name: str) -> bool:
    return any(c == name for c in _call_names(tree))


def _calls_method(tree, dotted_suffix: str) -> bool:
    return any(c == dotted_suffix or c.endswith("." + dotted_suffix) for c in _call_names(tree))


def _sleep_calls(tree) -> list[str]:
    return [c for c in _call_names(tree) if c.rsplit(".", 1)[-1] in SLEEP_FAMILY]


def _compares_key_to(tree, key: str, value: str) -> bool:
    """A `==` whose one side mentions the string `key` (e.g. `.get("<key>")`) and whose other side is `value`."""
    for n in ast.walk(tree):
        if isinstance(n, ast.Compare) and any(isinstance(o, ast.Eq) for o in n.ops):
            sides = [n.left, *n.comparators]
            has_value = any(isinstance(s, ast.Constant) and s.value == value for s in sides)
            has_key = any(isinstance(c, ast.Constant) and c.value == key for s in sides for c in ast.walk(s))
            if has_value and has_key:
                return True
    return False


def _compares_to(tree, value: str) -> bool:
    return any(isinstance(n, ast.Compare) and any(isinstance(s, ast.Constant) and s.value == value
                                                  for s in [n.left, *n.comparators]) for n in ast.walk(tree))


def _step_verdict_names(tree, feature: str) -> set[str]:
    """Names read by the verdict argument of `C.step(..., "<feature>", label, <verdict>, ...)`."""
    for n in ast.walk(tree):
        if isinstance(n, ast.Call) and _dotted(n.func).endswith(".step"):
            if any(isinstance(a, ast.Constant) and a.value == feature for a in n.args) and len(n.args) >= 5:
                return {x.id for x in ast.walk(n.args[4]) if isinstance(x, ast.Name)}
    return set()


def _real_styles():
    src = FEATURES.read_text(encoding="utf-8")
    fn = _func(src, "styles")
    assert fn is not None, "no def styles() in the features file"      # non-vacuity
    return fn


# ── the controls: each matcher must IGNORE prose and SEE code ──────────────────────────────────────
PROSE_ONLY = ("def styles():\n"
              "    '''docstring: " + SAVE + "(pg) then " + WID + " == chart and time.sle" + "ep(1)'''\n"
              "    # " + SAVE + "(pg, id, edit)  " + WID + " == 'chart'  pg.keyboard.type('y')  time.sle" + "ep(1)\n"
              "    # pg.wait_for" + "_timeout(500)  expect_response PUT notebook_journal_styles_enabled\n"
              "    'PU" + "T'\n"                                                    # bare string statements: prose, not code
              "    'notebook_journal_" + "styles_enabled'\n"
              "    pass\n")
REAL_CODE = ("def styles():\n"
             "    landed = " + SAVE + "(pg, fb['id'], edit)\n"
             "    ok = (x.get('attrs') or {}).get('" + WID + "') == 'chart'\n"
             "    pg.keyboard.type('y')\n"
             "    time.sle" + "ep(1)\n"
             "    pg.wait_for" + "_timeout(500)\n"
             "    page.expect_response(lambda r: r.request.method == 'PUT')\n")


def test_control_a_needle_only_in_a_comment_and_a_docstring_is_not_a_match():
    tree = ast.parse(PROSE_ONLY)
    assert not _calls_function(tree, SAVE)
    assert not _calls_method(tree, "keyboard.type")
    assert not _calls_method(tree, "expect_response")
    assert not _compares_key_to(tree, WID, "chart")
    assert _sleep_calls(tree) == []
    assert "PUT" not in _code_strings(tree)
    assert "notebook_journal_styles_enabled" not in _code_strings(tree)
    # and the PROSE really is in the source text, so this control cannot pass on an empty fixture
    assert SAVE in PROSE_ONLY and "time.sle" + "ep(1)" in PROSE_ONLY


def test_control_b_a_real_occurrence_is_a_match():
    tree = ast.parse(REAL_CODE)
    assert _calls_function(tree, SAVE)
    assert _calls_method(tree, "keyboard.type")
    assert _calls_method(tree, "expect_response")
    assert _compares_key_to(tree, WID, "chart")
    assert "PUT" in _code_strings(tree)
    assert sorted(_sleep_calls(tree)) == ["pg.wait_for" + "_timeout", "time.sle" + "ep"]


def test_control_c_the_sleep_family_is_caught_in_every_spelling():
    for spelling in ("time.sle" + "ep(1)", "sle" + "ep(1)", "asyncio.sle" + "ep(1)", "pg.wait_for" + "_timeout(2500)"):
        assert _sleep_calls(ast.parse("def styles():\n    " + spelling + "\n")), spelling
    assert _sleep_calls(ast.parse("def styles():\n    pg.wait_for(state='hidden')\n    x = 'sle" + "ep'\n")) == []


def test_control_d_the_verdict_matcher_sees_a_name_in_the_verdict_and_not_one_beside_it():
    src_in = "C.step(pg, i, 'styles.x', 'label', 'PASS' if a and typed else 'FAIL', typed=typed)\n"
    src_beside = "C.step(pg, i, 'styles.x', 'label', 'PASS' if a else 'FAIL', typed=typed)\n"
    assert "typed" in _step_verdict_names(ast.parse(src_in), "styles.x")
    assert "typed" not in _step_verdict_names(ast.parse(src_beside), "styles.x")


# ── the rails on the real tool ─────────────────────────────────────────────────────────────────────
def test_the_styles_step_has_no_blind_sleep():
    fn = _real_styles()
    assert _calls_method(fn, "get_by_role"), "non-vacuity: the right function, with real calls in it"
    assert "Review update" in _code_strings(fn)                          # non-vacuity: the update-layout step is in it
    assert _sleep_calls(fn) == []


def test_update_layout_reads_the_added_block_and_unknown_block_saves_first():
    fn = _real_styles()
    assert _compares_key_to(fn, WID, "chart"), "update-layout must check the chart block landed"
    first_future = min(n.lineno for n in ast.walk(fn) if isinstance(n, ast.Constant) and n.value == "walkFutureBlock")
    typed_after = [n for n in ast.walk(fn) if isinstance(n, ast.Call) and _dotted(n.func).endswith("keyboard.type")
                   and n.lineno > first_future]
    assert typed_after, "unknown-block must edit the note first"
    assert _calls_function(fn, SAVE), "unknown-block must wait for the save, not a clock"


APPLY = "/apply-" + "style-update"


def _apply_wait_line(tree) -> int | None:
    """Line of a `with <x>.expect_response(...)` whose predicate names the apply route in CODE, else None."""
    for n in ast.walk(tree):
        if isinstance(n, ast.With):
            for item in n.items:
                c = item.context_expr
                if isinstance(c, ast.Call) and _dotted(c.func).endswith("expect_response") and APPLY in _code_strings(c):
                    return n.lineno
    return None


NOTE_GET = "/api/j2/" + "notes/"


def _readback_line(tree) -> int | None:
    """Line of the first `M.get(...)` of a NOTE (its URL holds the notes route in code): the walk's own read of
    the note after the apply. Other reads in the step (the styles listing) are not the read-back."""
    lines = [n.lineno for n in ast.walk(tree) if isinstance(n, ast.Call) and _dotted(n.func) == "M.get"
             and NOTE_GET in _code_strings(n)]
    return min(lines) if lines else None


def _step_keywords(tree, feature: str) -> set[str]:
    for n in ast.walk(tree):
        if isinstance(n, ast.Call) and _dotted(n.func).endswith(".step"):
            if any(isinstance(a, ast.Constant) and a.value == feature for a in n.args):
                return {k.arg for k in n.keywords if k.arg}
    return set()


def test_control_f_the_apply_wait_matcher_ignores_prose_and_sees_code():
    note_get = "    got = M.get(base + f'" + NOTE_GET + "{nid}')\n"
    prose = ("def styles():\n"
             "    # with pg.expect_response(lambda r: '" + APPLY + "' in r.url):\n"
             "    pg.get_by_role('button', name='Apply').click()\n" + note_get)
    real = ("def styles():\n"
            "    listing = M.get(base + '/api/j2/journal-styles')\n"          # an earlier, unrelated read
            "    with pg.expect_response(lambda r: '" + APPLY + "' in r.url) as a:\n"
            "        pg.get_by_role('button', name='Apply').click()\n" + note_get)
    late = ("def styles():\n" + note_get +
            "    with pg.expect_response(lambda r: '" + APPLY + "' in r.url) as a:\n"
            "        pg.get_by_role('button', name='Apply').click()\n")
    assert _apply_wait_line(ast.parse(prose)) is None
    t = ast.parse(real)
    assert _readback_line(t) == 5, "the read-back is the note GET, not the earlier styles listing"
    assert _apply_wait_line(t) is not None and _apply_wait_line(t) < _readback_line(t)
    t = ast.parse(late)
    assert not (_apply_wait_line(t) < _readback_line(t)), "a read taken BEFORE the wait must not satisfy the rail"


def test_update_layout_reads_back_only_after_the_apply_answers():
    """Integrator ruling R-T13-1 (walk 7b87a2c7e6): the banner hides on the press while the apply is still
    composing, so a read keyed on the banner raced the apply (GET answered first, v2 read back while the apply
    returned v3 with the chart). The read must come after the walk has waited on the apply's own response."""
    fn = _real_styles()
    wait = _apply_wait_line(fn)
    read = _readback_line(fn)
    assert read is not None, "non-vacuity: the update-layout read-back is in styles()"
    assert wait is not None, "update-layout must wait on the apply-style-update POST, not on the banner"
    assert wait < read, "the read-back must come after the apply's response"
    assert "banner" in _step_keywords(fn, "styles.update-layout"), "the row must record whether the banner showed"


def test_unknown_block_checks_the_typed_text_was_saved():
    fn = _real_styles()
    assert _compares_to(fn, "xy"), "the edited paragraph must be compared to the text the edit leaves"
    assert "typed" in _step_verdict_names(fn, "styles.unknown-block"), "the typed check must be part of the verdict"
    assert "kept" in _step_verdict_names(fn, "styles.unknown-block"), "the block-survived check stays"


def test_the_blocks_step_has_no_blind_sleep():
    """Notebook P2a Task 13: the trader blocks step waits, never sleeps, and its integrity row waits for the
    autosave's own answer. The same AST read as styles(), on `def blocks`."""
    fn = _func(FEATURES.read_text(encoding="utf-8"), "blocks")
    assert fn is not None, "no def blocks() in the features file"           # non-vacuity: the step exists
    assert _calls_method(fn, "get_by_role"), "non-vacuity: the right function, with real calls in it"
    assert "blocks.integrity-tick-leave" in _code_strings(fn), "non-vacuity: the integrity row is in it"
    assert _sleep_calls(fn) == []
    assert _calls_function(fn, SAVE), "the integrity row must wait for the save, not a clock"


def test_save_landed_waits_on_the_save_response_not_a_poll():
    src = FEATURES.read_text(encoding="utf-8")
    fn = _func(src, SAVE)
    assert fn is not None, "no def " + SAVE + " in the features file"       # non-vacuity
    assert _calls_method(fn, "expect_response")
    assert "PUT" in _code_strings(fn)
    assert _sleep_calls(fn) == []
    assert not any(isinstance(n, ast.While) for n in ast.walk(fn))


def test_styles_on_mirrors_the_product_gate():
    tree = ast.parse(FEATURES.read_text(encoding="utf-8"))
    assigns = [n for n in ast.walk(tree) if isinstance(n, ast.Assign)
               and any(isinstance(t, ast.Name) and t.id == "styles_on" for t in n.targets)]
    assert assigns, "no styles_on assignment in the features file"        # non-vacuity
    for a in assigns:
        strings = _code_strings(a.value)
        assert "notebook_journal_styles_enabled" in strings
        assert "paid_equiv" not in strings


# ── the typed switch count: its SUBJECT is prose (the WAVE_FLAGS comment, the module docstring), so it reads PROSE ──
_NUMBER_WORDS = ("zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|"
                 "sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred")
# A numeral or number word (or "twenty-one") before "switches", optionally with a wave/phase label between
# ("fourteen wave-13 switches"). `(?<![-\w])(?<!wave )` keeps the label's own number ("wave-13", "wave 13") out.
TYPED_COUNT = re.compile(r"(?<![-\w])(?<!wave )(?:\d+|(?:" + _NUMBER_WORDS + r")(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)"
                         r"\s+(?:(?:wave[- ]?\d+|P\d+)\s+)?switches\b", re.IGNORECASE)


def _prose_text(src: str) -> str:
    """The prose of `src`: every comment ('#' dropped) and every bare string statement (module/function docstrings
    and stray strings), joined by a space so a count split over two lines still reads. A string that is a value
    in code (`x = '19 switches'`) is data, not prose, and is left out."""
    toks = tokenize.generate_tokens(io.StringIO(src).readline)
    parts = [t.string.lstrip("#").strip() for t in toks if t.type == tokenize.COMMENT]
    parts += [n.value.value for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)]
    return " ".join(parts)


def test_control_e_the_typed_count_matcher_catches_any_numeral_or_number_word_in_prose():
    for s in ("# The seventeen switches waves 11-14 add", "# The 19 switches", "# twenty switches", "# Twenty-one switches",
              "# the 7 switches", "# TWO switches", "x = 1  # and 19\n# switches",
              '"""the fourteen wave-13 switches"""', 'def f():\n    "the twenty switches"', "# 3 P1 switches"):
        assert TYPED_COUNT.search(_prose_text(s + "\n")), s
    for s in ("# The switches waves 11-14 and P1/P2 add", "# count the switches from the list", "# switches",
              "# the wave-13 switches", "# every wave 13 switches", '"""the wave-13 switches"""',
              "x = '19 switches'", "x = ['twenty switches']"):
        assert not TYPED_COUNT.search(_prose_text(s + "\n")), s


def test_no_typed_switch_count():
    src = WALK.read_text(encoding="utf-8")
    assert "WAVE_FLAGS = [" in src                                        # non-vacuity
    prose = _prose_text(src)
    assert "switches" in prose, "non-vacuity: the WAVE_FLAGS note is among the prose read"
    assert "wave 11-14" in prose, "non-vacuity: the module docstring is among the prose read"
    hits = [m.group(0) for m in TYPED_COUNT.finditer(prose)]
    assert not hits, f"a typed switch count: {hits}"
