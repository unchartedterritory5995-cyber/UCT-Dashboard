"""The startup fingerprint must not be able to disagree with what it fingerprints.

⛔ THE MEASURED DEFECT. `api/main.py` printed the literal
`idb_cache_logic_version=4` while `app/src/utils/barsIDB.js` had read
`CACHE_LOGIC_VERSION = 5` since 2026-07-14. CLAUDE.md publishes that line "for
grep verification" and, in the same breath, instructs a future engineer to
"bump to 5 (or higher)" to invalidate poisoned browser bar caches. Following it
bumps the constant to the value ALREADY LIVE — nothing invalidates — and then
the designated verification grep confirms the 4 and reads green. A stale
verification artifact is worse than none: it converts a no-op into a receipt.

The fix is that the fingerprint READS the constant. These are the rails on that:
the value must be derived (a literal in the format string would rot the same
way), the deriver must actually vary with the file (or it is a constant wearing
a function's name), and an unreadable file must produce `None` so the line can
say `unreadable` instead of a number nobody checked.
"""
import ast
import pathlib
import re

from api.main import idb_cache_logic_version

ROOT = pathlib.Path(__file__).resolve().parents[1]
BARS_IDB = ROOT / "app" / "src" / "utils" / "barsIDB.js"
MAIN_PY = ROOT / "api" / "main.py"


def test_the_deriver_answers_from_the_shipped_barsIDB_js():
    """Not a pinned number — a pinned SOURCE. The value moves when the file does."""
    live = idb_cache_logic_version()
    assert isinstance(live, int), (
        f"{BARS_IDB} did not yield a CACHE_LOGIC_VERSION — the fingerprint would "
        "print 'unreadable' on every boot of this checkout")
    declared = re.search(r"\bCACHE_LOGIC_VERSION\s*=\s*(\d+)", BARS_IDB.read_text(encoding="utf-8"))
    assert declared and int(declared.group(1)) == live


def test_the_deriver_is_not_a_constant_wearing_a_function_name(tmp_path):
    """⭐ THE CONTROL, AND IT CAUGHT THE FIRST CUT OF THE FIX. A "deriver" that
    returns the right answer for the wrong reason is exactly what shipped last
    time. Point it at a file declaring a number it cannot have memorised — with
    a DIFFERENT number in the comment block above it, which is how `barsIDB.js`
    itself is written — and it must report the declaration."""
    probe = tmp_path / "barsIDB.js"
    probe.write_text("// This bump invalidates caches: CACHE_LOGIC_VERSION = 4\n"
                     "// was the value before the FMP-poisoned rows were cleared.\n"
                     "const CACHE_LOGIC_VERSION = 4173\n", encoding="utf-8")
    assert idb_cache_logic_version(str(probe)) == 4173


def test_two_declarations_are_unreadable_rather_than_a_coin_flip(tmp_path):
    """Which one the bundler picks is not something a startup print can know."""
    probe = tmp_path / "barsIDB.js"
    probe.write_text("const CACHE_LOGIC_VERSION = 5\n"
                     "const CACHE_LOGIC_VERSION = 6\n", encoding="utf-8")
    assert idb_cache_logic_version(str(probe)) is None


def test_an_unreadable_source_is_None_and_never_a_guess(tmp_path):
    """A runtime image that ships only `app/dist` has no `app/src`. `None` makes
    the fingerprint say `unreadable`, which is TRUE; a fallback literal would be
    the original defect with a longer fuse."""
    assert idb_cache_logic_version(str(tmp_path / "not-here.js")) is None


def _fingerprint_literal_text() -> str:
    """The LITERAL half of the `chart-realtime-mode` print — interpolations
    excluded — read by AST.

    ⚠️ NOT A GREP OVER THE FILE, and its first draft was: this module's own
    docstring quotes the defective `idb_cache_logic_version=4` string, and so
    does `idb_cache_logic_version`'s. A grep cannot tell the bug being described
    from the bug being committed, which is the whole reason the assertion below
    reads the print's argument instead of the source text.
    """
    tree = ast.parse(MAIN_PY.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "print" and node.args):
            continue
        arg = node.args[0]
        if isinstance(arg, ast.JoinedStr):
            parts = [v.value for v in arg.values
                     if isinstance(v, ast.Constant) and isinstance(v.value, str)]
        elif isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            parts = [arg.value]
        else:
            continue
        text = "".join(parts)
        if "chart-realtime-mode" in text:
            return text
    raise AssertionError("no `chart-realtime-mode` print found in api/main.py")


def test_the_fingerprint_line_carries_NO_typed_cache_logic_version():
    """The rail on the fix itself. Someone re-typing the number into the format
    string restores the exact defect, and every test above would keep passing
    while the printed line lied again."""
    literal = _fingerprint_literal_text()
    assert "idb_cache_logic_version=" in literal, (
        "the fingerprint stopped publishing the key CLAUDE.md tells operators to grep")
    typed = re.findall(r"idb_cache_logic_version=\d", literal)
    assert not typed, (
        f"api/main.py types the version into its own fingerprint: {typed} — it "
        "must interpolate idb_cache_logic_version() instead")
    # …and the deriver really is called somewhere in the module.
    tree = ast.parse(MAIN_PY.read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
             and n.func.id == "idb_cache_logic_version"]
    assert calls, "nothing in api/main.py calls idb_cache_logic_version()"
