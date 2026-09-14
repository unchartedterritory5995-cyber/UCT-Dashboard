"""B5 — stale-mutation-anchor detection AT GATE TIME, before any harness executes.

Owner ruling, 2026-09-14:

    "Stale mutation anchors have bitten three times (A29, A32 x2). Add a gate step that
     lists every mutation control whose anchor text no longer matches the source, before
     the harness runs — NOT-APPLIED detection at gate time rather than after an 18-minute
     run."

WHAT THIS IS
    A READ. It opens every `mutation_harness*.py` beside it, extracts every mutation
    control by AST, and asks one question per control: does this control's anchor text
    still appear in its target file exactly once, in CODE?

    It never writes a file. It never imports a harness (importing one is close to running
    one). It never invokes pytest. There is no code path in this module that mutates
    anything — `tests/test_mutation_harness_hygiene.py` asserts that by AST.

THE FOUR OUTCOMES, NEVER COLLAPSED
    OK          anchor found exactly once, and that occurrence is real code.
    STALE       anchor found zero times — OR found exactly once and that single
                occurrence lies entirely inside a comment or a docstring, which means
                applying it would edit prose and the rail could never fire. The two
                cases carry different `detail` text; they are never merged into "not ok".
    AMBIGUOUS   anchor found MORE THAN ONCE. An exact single replacement is impossible.
                This is a DIFFERENT defect from STALE and must never be reported as "ok":
                the harness refuses it with the same "NOT APPLIED" line a stale anchor
                gets, so the two are indistinguishable in a harness report and only
                distinguishable here.
    UNREADABLE  the control's anchor or target could not be resolved from the AST (an
                f-string needle, a computed path), or the target file could not be read.
                ⛔ A control that could not be READ is not a control that is FINE.
                It is reported by name and counts as a failure.

⛔ WHY COMMENTS AND DOCSTRINGS ARE MASKED
    Six separate instruments in this repo have matched their own prose instead of code.
    `hub/contractArity.test.js` matched the sentence "passed through to the mode's own
    onScrub(ctx, delta)" a few lines above the real call site. A scan that cannot tell a
    comment from a statement reports a rail as healthy when the code it names is gone.

    The mask is NOT "strip comments, then search". An anchor may legitimately CONTAIN a
    comment — `mutation_harness.py` M4's anchor is two lines, the second of which is
    `# The V2 runtime: one contract message`. Stripping first would make that anchor read
    STALE, and a check that fires on the right answer is muted inside a week. So: match on
    the raw text (which is exactly what the harness matches on, so the two can never
    disagree about `count`), then ask of each occurrence whether ANY character of it lands
    on a real token. An occurrence made only of comment and docstring characters is prose.

⛔ NON-VACUITY
    Zero controls enumerated is a FAILED INVOCATION (exit 2), never a quiet pass. An empty
    result satisfies every check anyone writes.

USAGE
    python docs/discord-render/instruments/anchor_check.py <repo-root>      # the gate step
    python docs/discord-render/instruments/anchor_check.py <root> --verbose # list OK too
    python docs/discord-render/instruments/anchor_check.py --self-check     # prove it fails

EXIT CODES
    0  every control OK
    1  at least one STALE / AMBIGUOUS / UNREADABLE control (named in the output)
    2  vacuous or failed invocation (no harnesses, no controls, bad arguments)
"""
from __future__ import annotations

import ast
import glob
import io
import os
import sys
import tokenize
from dataclasses import dataclass, field
from pathlib import Path

HARNESS_GLOB = "mutation_harness*.py"

OK = "OK"
STALE = "STALE"
AMBIGUOUS = "AMBIGUOUS"
UNREADABLE = "UNREADABLE"

EXIT_CLEAN = 0
EXIT_FOUND_DEFECTS = 1
EXIT_VACUOUS = 2


# ──────────────────────────────────────────────────────────────────────────────
# 1. The code mask
# ──────────────────────────────────────────────────────────────────────────────

def code_mask(source: str) -> tuple[list[bool], bool]:
    """Return (mask, mask_ok). mask[i] is True when source[i] is a real code character.

    Every token's span is code EXCEPT a COMMENT and EXCEPT a docstring — a STRING that
    stands alone as its own statement (module, class, function, or any bare string block).
    Characters covered by no token (inter-token whitespace) are NOT code; a needle made
    only of whitespace has no code to land on, which is the right answer for it too.

    ⚠️ A string literal that is part of an expression is CODE, deliberately. Anchors
    routinely quote one — `BACKUP_CLAUSE = "served from a slower backup source"` is a real
    anchor in mutation_harness_badge.py. Masking all strings would report it STALE.

    mask_ok is False when the file could not be tokenized; the caller reports that rather
    than silently treating an unparsed file as all-code.
    """
    line_starts, pos = [], 0
    for line in source.splitlines(keepends=True):
        line_starts.append(pos)
        pos += len(line)
    line_starts.append(pos)

    mask = [False] * len(source)

    def offset(row: int, col: int) -> int:
        if row - 1 >= len(line_starts):
            return len(source)
        return min(len(source), line_starts[row - 1] + col)

    try:
        toks = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError, ValueError):
        return [True] * len(source), False

    # A STRING is a docstring when it is the whole logical line: the token before it is a
    # line/block boundary and the token after it ends the line.
    boundary_before = {tokenize.NEWLINE, tokenize.NL, tokenize.INDENT, tokenize.DEDENT,
                       tokenize.ENCODING}
    docstring_idx = set()
    significant = [i for i, t in enumerate(toks) if t.type != tokenize.COMMENT]
    for n, i in enumerate(significant):
        if toks[i].type != tokenize.STRING:
            continue
        prev_ok = n == 0 or toks[significant[n - 1]].type in boundary_before
        nxt = significant[n + 1] if n + 1 < len(significant) else None
        next_ok = nxt is None or toks[nxt].type in (tokenize.NEWLINE, tokenize.NL,
                                                    tokenize.ENDMARKER)
        if prev_ok and next_ok:
            docstring_idx.add(i)

    for i, tok in enumerate(toks):
        if tok.type == tokenize.COMMENT or i in docstring_idx:
            continue
        start, end = offset(*tok.start), offset(*tok.end)
        for j in range(start, min(end, len(source))):
            mask[j] = True
    return mask, True


# ──────────────────────────────────────────────────────────────────────────────
# 2. Extracting the controls — AST only, never an import
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class Control:
    harness: str
    name: str
    target: str | None
    needle: str | None
    kind: str = "anchor"          # "anchor" (the `old` key) or "prelude"
    note: str = ""


@dataclass
class Finding:
    control: Control
    outcome: str
    raw_count: int = 0
    code_count: int = 0
    detail: str = ""

    def line(self) -> str:
        where = self.control.target or "<unresolved target>"
        tag = "" if self.control.kind == "anchor" else f" [{self.control.kind}]"
        out = [f"{self.outcome:<10} {Path(self.control.harness).name} :: "
               f"{self.control.name}{tag}",
               f"           target={where}  raw={self.raw_count} code={self.code_count}"
               f"{('  — ' + self.detail) if self.detail else ''}"]
        # The anchor itself, so the integrator can re-aim it without opening the harness.
        if self.outcome != OK and self.control.needle:
            first = self.control.needle.splitlines()[0] if self.control.needle.splitlines() \
                else self.control.needle
            more = "" if len(self.control.needle.splitlines()) <= 1 else " …(+more lines)"
            out.append(f"           anchor: {first[:110]!r}{more}")
        return "\n".join(out)


def _const_env(tree: ast.Module) -> dict[str, str]:
    """Module-level `NAME = "literal"` bindings, so `"file": BADGE` resolves."""
    env: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 \
                and isinstance(node.targets[0], ast.Name):
            val = _resolve(node.value, env)
            if val is not None:
                env[node.targets[0].id] = val
    return env


def _resolve(node: ast.AST, env: dict[str, str]) -> str | None:
    """Resolve a node to a string, or None. Deliberately narrow: an f-string or a call is
    UNREADABLE, and saying so by name beats guessing."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return env.get(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _resolve(node.left, env), _resolve(node.right, env)
        return None if left is None or right is None else left + right
    return None


def extract_controls(harness_path: Path) -> tuple[list[Control], str]:
    """Every control declared in `MUTATIONS` in one harness. Returns (controls, error)."""
    try:
        source = harness_path.read_text(encoding="utf-8")
        tree = ast.parse(source)
    except (OSError, SyntaxError, UnicodeDecodeError) as exc:
        return [], f"{harness_path.name}: could not parse ({exc.__class__.__name__}: {exc})"

    env = _const_env(tree)
    out: list[Control] = []
    for node in tree.body:
        if not (isinstance(node, ast.Assign) and isinstance(node.value, ast.List)):
            continue
        names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if "MUTATIONS" not in names:
            continue
        for idx, elt in enumerate(node.value.elts):
            if not isinstance(elt, ast.Dict):
                out.append(Control(str(harness_path), f"<entry #{idx + 1} is not a dict>",
                                   None, None, note="not a dict literal"))
                continue
            d: dict[str, ast.AST] = {}
            for k, v in zip(elt.keys, elt.values):
                if isinstance(k, ast.Constant) and isinstance(k.value, str):
                    d[k.value] = v
            name = _resolve(d.get("name"), env) if "name" in d else None
            name = name or f"<unnamed entry #{idx + 1}>"
            target = _resolve(d["file"], env) if "file" in d else None
            needle = _resolve(d["old"], env) if "old" in d else None
            note = ""
            if "file" not in d:
                note = "control declares no 'file'"
            elif target is None:
                note = "'file' is not a resolvable string literal"
            elif "old" not in d:
                note = "control declares no 'old' anchor"
            elif needle is None:
                note = "'old' is not a resolvable string literal"
            out.append(Control(str(harness_path), name, target, needle, "anchor", note))

            # A stale PRELUDE makes the whole control NOT APPLIED just as surely as a
            # stale anchor — the harnesses require `text.count(pre_old) == 1` too.
            pre = d.get("prelude")
            if isinstance(pre, ast.Tuple) and pre.elts:
                pre_old = _resolve(pre.elts[0], env)
                out.append(Control(str(harness_path), name, target, pre_old, "prelude",
                                   "" if pre_old is not None
                                   else "'prelude' first element is not a string literal"))
            elif pre is not None:
                out.append(Control(str(harness_path), name, target, None, "prelude",
                                   "'prelude' is not a tuple literal"))
    return out, ""


# ──────────────────────────────────────────────────────────────────────────────
# 3. Classification
# ──────────────────────────────────────────────────────────────────────────────

def classify(source: str, needle: str, mask_ok: bool = True,
             mask: list[bool] | None = None) -> tuple[str, int, int, str]:
    """(outcome, raw_count, code_count, detail) for one anchor against one source text.

    EOL handling is copied verbatim from the harnesses — they normalise the needle to the
    file's endings before counting, and a checker that counted differently would be
    answering about a string the harness never searches for.
    """
    if "\r\n" in source:
        needle = needle.replace("\n", "\r\n")
    if not needle:
        return UNREADABLE, 0, 0, "the anchor is the empty string"

    if mask is None:
        mask, mask_ok = code_mask(source)

    starts, at = [], source.find(needle)
    while at != -1:
        starts.append(at)
        at = source.find(needle, at + 1)

    raw = len(starts)
    code_hits = sum(1 for s in starts if any(mask[s:s + len(needle)]))

    suffix = "" if mask_ok else " (⚠️ target could not be tokenized; every character was treated as code)"
    if raw == 0:
        return STALE, 0, 0, "anchor text is not in the file at all" + suffix
    if raw > 1:
        return AMBIGUOUS, raw, code_hits, (
            f"anchor matches {raw} places — an exact single replacement is impossible, "
            "which is a DIFFERENT defect from a stale anchor" + suffix)
    if code_hits == 0:
        return STALE, raw, 0, (
            "the one match lies entirely inside a comment or a docstring — applying it "
            "would edit prose, and the rail it claims to prove could never fire" + suffix)
    return OK, raw, code_hits, suffix.strip()


# ──────────────────────────────────────────────────────────────────────────────
# 4. The run
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class Report:
    harnesses: list[str] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def defects(self) -> list[Finding]:
        return [f for f in self.findings if f.outcome != OK]

    def counts(self) -> dict[str, int]:
        c = {OK: 0, STALE: 0, AMBIGUOUS: 0, UNREADABLE: 0}
        for f in self.findings:
            c[f.outcome] += 1
        return c


def check_tree(root: Path, instruments_dir: Path | None = None,
               only: Path | None = None) -> Report:
    """Read every harness under `instruments_dir` and classify every control against `root`."""
    inst = instruments_dir or Path(__file__).resolve().parent
    rep = Report()
    harnesses = ([only] if only is not None
                 else [Path(p) for p in sorted(glob.glob(str(inst / HARNESS_GLOB)))])
    source_cache: dict[str, tuple[str, list[bool], bool] | None] = {}

    for h in harnesses:
        rep.harnesses.append(str(h))
        controls, err = extract_controls(h)
        if err:
            rep.errors.append(err)
        for ctl in controls:
            if ctl.note or ctl.needle is None or ctl.target is None:
                rep.findings.append(Finding(ctl, UNREADABLE, detail=ctl.note or
                                            "anchor or target could not be resolved"))
                continue
            if ctl.target not in source_cache:
                p = root / ctl.target
                try:
                    text = p.read_text(encoding="utf-8")
                except OSError as exc:
                    source_cache[ctl.target] = None
                    rep.errors.append(f"{ctl.target}: {exc.__class__.__name__}")
                else:
                    m, ok = code_mask(text)
                    source_cache[ctl.target] = (text, m, ok)
            entry = source_cache[ctl.target]
            if entry is None:
                rep.findings.append(Finding(ctl, UNREADABLE,
                                            detail=f"target file could not be read at {root / ctl.target}"))
                continue
            text, m, ok = entry
            outcome, raw, code, detail = classify(text, ctl.needle, ok, m)
            rep.findings.append(Finding(ctl, outcome, raw, code, detail))
    return rep


def _printer(stream):
    """⚠️ Windows consoles default to cp1252 and this file's banners are not ASCII. A
    checker that dies on its own output is a checker nobody runs."""
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError, OSError):
        pass

    def p(s=""):
        try:
            print(s, file=stream)
        except UnicodeEncodeError:
            print(str(s).encode("ascii", "replace").decode("ascii"), file=stream)
    return p


def render(rep: Report, verbose: bool = False, stream=None) -> int:
    # ⛔ `stream=sys.stdout` as a DEFAULT binds the real stdout at import time, so the
    # report goes to the terminal the caller replaced and any capturing caller sees an
    # empty string — which reads exactly like "the checker found nothing".
    p = _printer(sys.stdout if stream is None else stream)
    p("═" * 78)
    p("B5 — MUTATION ANCHOR CHECK (a read; nothing is mutated and no test is run)")
    p("═" * 78)

    for e in rep.errors:
        p(f"ERROR      {e}")

    if verbose:
        for f in rep.findings:
            if f.outcome == OK:
                p(f.line())

    defects = rep.defects
    if defects:
        p("")
        p("⛔ CONTROLS WHOSE ANCHOR NO LONGER MATCHES THE SOURCE — BY NAME:")
        p("")
        for f in sorted(defects, key=lambda x: (x.outcome, x.control.harness, x.control.name)):
            p(f.line())

    c = rep.counts()
    total = sum(c.values())
    p("")
    p(f"TOTALS: harnesses={len(rep.harnesses)} controls={total} "
      f"ok={c[OK]} stale={c[STALE]} ambiguous={c[AMBIGUOUS]} unreadable={c[UNREADABLE]} "
      f"read_errors={len(rep.errors)}")

    # ⛔ NON-VACUITY. An empty result is a failed invocation until proven otherwise.
    if not rep.harnesses:
        p("")
        p(f"⛔ VACUOUS: no file matching {HARNESS_GLOB} was found. This is a FAILED "
          "INVOCATION, not a pass.")
        return EXIT_VACUOUS
    if total == 0:
        p("")
        p("⛔ VACUOUS: harness files were found but ZERO mutation controls were "
          "enumerated. A checker that sees nothing cannot have checked anything. This is "
          "a FAILED INVOCATION, not a pass.")
        return EXIT_VACUOUS
    if defects:
        p("")
        p("⛔ FIX THESE BEFORE RUNNING ANY HARNESS. Each one is an 18-minute run that "
          "would have reported NOT APPLIED at the end.")
        return EXIT_FOUND_DEFECTS
    p("")
    p("✅ Every mutation control's anchor matches its source exactly once, in code.")
    return EXIT_CLEAN


# ──────────────────────────────────────────────────────────────────────────────
# 5. --self-check — proof that each verdict can actually be produced
# ──────────────────────────────────────────────────────────────────────────────

def _self_check(stream=None) -> int:
    """Build a throwaway tree and prove every outcome, including the two that matter most:
    a comment-only match is NOT a match, and an empty enumeration FAILS.

    ⛔ Needles are built by CONCATENATION so that nothing in this file is itself a literal
    a scan of this file could match — the defect this whole module exists to catch.
    """
    import tempfile

    p = _printer(sys.stdout if stream is None else stream)
    marker = "SENTINEL" + "_ANCHOR"          # never appears whole in this file
    uniq = "ONLY" + "_ONCE"
    twice = "TWO" + "_PLACES"
    prose = "IN" + "_A_COMMENT"
    doc = "IN" + "_A_DOCSTRING"
    mixed = "BESIDE" + "_REAL_CODE"

    target_src = "\n".join([
        '"""Module docstring."""',
        "",
        "def f():",
        "    " + uniq + " = 1",
        "    return " + uniq,
        "",
        "def g():",
        "    x = " + twice,
        "    y = " + twice,
        "    return x, y",
        "",
        "# a comment mentioning " + prose,
        "",
        "def h():",
        '    """A function docstring mentioning ' + doc + '."""',
        "    return 0",
        "",
        "def k():",
        "    z = 3  # a trailing note mentioning " + mixed,
        "    return z",
        "",
    ])

    failures: list[str] = []

    def expect(label: str, needle: str, want: str) -> None:
        got, raw, code, detail = classify(target_src, needle)
        ok = got == want
        p(f"  {'PASS' if ok else 'FAIL'}  {label:<52} want={want:<10} got={got:<10} "
          f"raw={raw} code={code}")
        if not ok:
            failures.append(f"{label}: wanted {want}, got {got} ({detail})")

    p("─" * 78)
    p("SELF-CHECK 1/3 — the four verdicts, on a synthetic source")
    p("─" * 78)
    expect("a live anchor", uniq + " = 1", OK)
    expect("an anchor that no longer exists", marker, STALE)
    expect("an anchor matching two places", twice, AMBIGUOUS)
    expect("⛔ the same text INSIDE A COMMENT is not a match", prose, STALE)
    expect("⛔ the same text INSIDE A DOCSTRING is not a match", doc, STALE)
    # ⭐ The control on the control: a checker that stripped comments BEFORE matching would
    # call this one STALE, and a check that fires on the right answer is muted in a week.
    expect("an anchor that CONTAINS a comment is still a match",
           "    z = 3  # a trailing note mentioning " + mixed, OK)

    p("")
    p("─" * 78)
    p("SELF-CHECK 2/3 — end to end: extraction, a real target, a real verdict")
    p("─" * 78)
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "pkg").mkdir()
        (root / "pkg" / "mod.py").write_text(target_src, encoding="utf-8")
        inst = root / "instruments"
        inst.mkdir()
        harness = "\n".join([
            "TARGET = " + repr("pkg/mod.py"),
            "MUTATIONS = [",
            "    {'name': 'C1 live', 'file': TARGET, 'old': " + repr(uniq + " = 1")
            + ", 'new': 'x', 'tests': []},",
            "    {'name': 'C2 stale', 'file': TARGET, 'old': " + repr(marker)
            + ", 'new': 'x', 'tests': []},",
            "    {'name': 'C3 ambiguous', 'file': TARGET, 'old': " + repr(twice)
            + ", 'new': 'x', 'tests': []},",
            "    {'name': 'C4 comment-only', 'file': TARGET, 'old': " + repr(prose)
            + ", 'new': 'x', 'tests': []},",
            "    {'name': 'C5 unreadable needle', 'file': TARGET, 'old': f'{TARGET}x',"
            " 'new': 'x', 'tests': []},",
            "    {'name': 'C6 missing target', 'file': 'pkg/gone.py', 'old': "
            + repr(uniq) + ", 'new': 'x', 'tests': []},",
            "]",
        ])
        (inst / "mutation_harness_selfcheck.py").write_text(harness, encoding="utf-8")

        rep = check_tree(root, inst)
        by_name = {f.control.name: f.outcome for f in rep.findings}
        want = {"C1 live": OK, "C2 stale": STALE, "C3 ambiguous": AMBIGUOUS,
                "C4 comment-only": STALE, "C5 unreadable needle": UNREADABLE,
                "C6 missing target": UNREADABLE}
        for name, wanted in want.items():
            got = by_name.get(name, "<not enumerated>")
            ok = got == wanted
            p(f"  {'PASS' if ok else 'FAIL'}  {name:<52} want={wanted:<10} got={got}")
            if not ok:
                failures.append(f"{name}: wanted {wanted}, got {got}")
        rc = render(rep, stream=io.StringIO())
        ok = rc == EXIT_FOUND_DEFECTS
        p(f"  {'PASS' if ok else 'FAIL'}  a tree with defects exits {EXIT_FOUND_DEFECTS:<19}"
          f"     got={rc}")
        if not ok:
            failures.append(f"defective tree exited {rc}, wanted {EXIT_FOUND_DEFECTS}")

    p("")
    p("─" * 78)
    p("SELF-CHECK 3/3 — ⛔ NON-VACUITY: an empty enumeration must FAIL, not pass quietly")
    p("─" * 78)
    with tempfile.TemporaryDirectory() as td:
        empty = Path(td) / "instruments"
        empty.mkdir()
        rc = render(check_tree(Path(td), empty), stream=io.StringIO())
        ok = rc == EXIT_VACUOUS
        p(f"  {'PASS' if ok else 'FAIL'}  no harness files at all exits {EXIT_VACUOUS:<19}"
          f"     got={rc}")
        if not ok:
            failures.append(f"empty instruments dir exited {rc}, wanted {EXIT_VACUOUS}")

        (empty / "mutation_harness_empty.py").write_text("MUTATIONS = []\n", encoding="utf-8")
        rc = render(check_tree(Path(td), empty), stream=io.StringIO())
        ok = rc == EXIT_VACUOUS
        p(f"  {'PASS' if ok else 'FAIL'}  a harness with zero controls exits "
          f"{EXIT_VACUOUS:<19}     got={rc}")
        if not ok:
            failures.append(f"zero-control harness exited {rc}, wanted {EXIT_VACUOUS}")

    p("")
    p(f"SELF-CHECK TOTALS: failures={len(failures)}")
    for f in failures:
        p(f"  FAILED: {f}")
    if failures:
        p("⛔ THE CHECKER IS NOT TRUSTWORTHY — do not read its verdict on the real tree.")
        return EXIT_FOUND_DEFECTS
    p("✅ Every verdict was produced on demand, and both vacuity cases failed as they must.")
    return EXIT_CLEAN


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    flags = {a for a in argv[1:] if a.startswith("--")}
    if "--self-check" in flags:
        return _self_check()
    root = Path(args[0]).resolve() if args else Path(__file__).resolve().parents[3]
    if not root.is_dir():
        print(f"⛔ VACUOUS: {root} is not a directory. FAILED INVOCATION.", file=sys.stderr)
        return EXIT_VACUOUS
    return render(check_tree(root), verbose="--verbose" in flags)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
