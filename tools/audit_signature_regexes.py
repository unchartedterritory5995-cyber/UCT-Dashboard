"""The approval-block parsers must be LINE-ANCHORED. A whitespace class that can
cross a newline reads the NEXT line's text as this line's value.

⚰️ **THE DEFECT THIS PINS, 2026-09-14.** A throwaway verification snippet counted signed
approval blocks with:

    re.compile(r"APPROVED AT SHA:\\s*\\S")

`\\s` matches `\\n`. So on an EMPTY block —

    APPROVED AT SHA:
    SCOPE APPROVED:

— `\\s*` crossed the newline and `\\S` matched the **`S` of `SCOPE`**. Every unsigned
block counted as signed. It reported `s9-entitlements` as an undeclared signed line, which
is a **packet the owner has deliberately left unsigned**, and it did so while being used to
verify that the signature registry reconciled.

⭐ **The instrument reported a property of ITSELF as a finding about the repo.** That is
the same shape `audit_scope_vs_checkpoints.py` already records for its own three retired
derived versions (F-AUDIT-2), and the shape six separate literal-hunting sweeps hit in one
day (CLAUDE.md, "CODE NEVER PROSE"). It is a LIVE class, not a historical one.

⛔ **NOTHING WAS WRONG IN A COMMITTED FILE.** Measured: the defective pattern appears in no
tool on either branch. The two instruments that actually parse approval blocks were already
correct —

    sign_gate.py               _H = "[ \\t]*"   and  ^…$ under re.M
    audit_scope_vs_checkpoints ^APPROVED BY:[ \\t]+[A-Za-z]  under re.M

— so this file does not FIX them. It PINS them, because the property is invisible on
inspection (both spellings look fine) and the cost of losing it is a miscounted signature
registry.

⛔ **SCOPE, STATED SO IT IS NOT MISREAD AS A REPO-WIDE BAN.** `\\s` is correct in plenty of
places — parsing a pytest totals line, `[\\s\\S]` where the multi-line reach is the point.
This audits ONLY the regexes that parse approval blocks, identified by the literal
`APPROVED` appearing in the pattern. Widening it to every `\\s` in the tree would flag 71
legitimate uses and be muted inside a week.

Exit 0 = every approval-block pattern is line-safe · 1 = at least one is not ·
2 = UNREADABLE (a file could not be parsed — never reported as a pass).
"""
from __future__ import annotations

import argparse
import ast
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent

#: The instruments whose patterns decide whether a block counts as SIGNED.
INSTRUMENTS = ("tools/sign_gate.py", "tools/audit_scope_vs_checkpoints.py")

#: A pattern is in scope if it mentions the approval block at all.
IN_SCOPE = "APPROVED"

#: ⛔ The banned classes are the ones that match a newline. `\s` and `\w`-negations
#: (`\S`, `\D`, `\W`) all cross a line boundary; `[ \t]` and `[^\S\n]` do not.
_BANNED = ("\\s", "\\S", "\\D", "\\W")

PASS, FAIL, UNREADABLE = 0, 1, 2


def compiled_patterns(path: pathlib.Path):
    """Every COMPILED regex the module holds, as (name, pattern-text).

    ⚰️⚰️ **THIS FUNCTION REPLACED AN AST STRING-LITERAL SCAN, AND THE MUTATION PROOF IS
    WHY.** v1 walked `ast.Constant` string literals hunting `\\s`. Mutating the real
    instrument — `sign_gate._H` from `"[ " + chr(92) + "t]*"` to `chr(92) + "s*"` — did
    **NOT** fire it. The rail passed on a broken instrument.

    ⭐ **Because `_H` is ASSEMBLED BY CONCATENATION**, no literal in the file ever contains
    `\\s`; it is built at runtime from `chr(92)`. And it is written that way deliberately —
    this repo's own rule says to build needles by concatenation so a literal-hunting sweep
    cannot match itself. **So the house convention that protects one check structurally
    blinded another**, and only a mutation could show it.

    Evaluating the module and reading `.pattern` off the compiled objects sees the
    ASSEMBLED value however it was built — concatenation, `chr()`, f-string or literal.
    ⛔ It costs an import, which is why the module list is a DECLARED constant of two
    known-safe tools rather than a glob over `tools/`.
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("_sigaudit_%s" % path.stem, str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name in dir(mod):
        obj = getattr(mod, name)
        if isinstance(obj, re.Pattern):
            yield name, obj.pattern
        elif isinstance(obj, str) and IN_SCOPE in obj:
            # a pattern held as a plain string, compiled later
            yield name, obj


def offenders_in(path: pathlib.Path) -> list[tuple[str, str, str]]:
    """(symbol, pattern, which banned class) for every in-scope pattern that can cross a line."""
    out = []
    for name, value in compiled_patterns(path):
        if IN_SCOPE not in value:
            continue
        for bad in _BANNED:
            if bad in value:
                out.append((name, value[:60], bad))
    return out


def audit(instruments=INSTRUMENTS) -> tuple[int, list[str], int]:
    """(exit code, lines, number of in-scope patterns examined)."""
    lines: list[str] = []
    examined = 0
    worst = PASS
    for rel in instruments:
        p = REPO / rel
        if not p.is_file():
            lines.append("UNREADABLE  %s — file not found" % rel)
            worst = max(worst, UNREADABLE)
            continue
        try:
            in_scope = [(n, v) for n, v in compiled_patterns(p) if IN_SCOPE in v]
        except Exception as e:                       # noqa: BLE001 - import can fail any way
            lines.append("UNREADABLE  %s — cannot parse: %s" % (rel, e))
            worst = max(worst, UNREADABLE)
            continue
        examined += len(in_scope)
        bad = offenders_in(p)
        if bad:
            worst = max(worst, FAIL)
            for n, v, cls in bad:
                lines.append("FAIL        %s  symbol %s uses %s in an approval-block pattern: %r" % (rel, n, cls, v))
        else:
            lines.append("OK          %-38s %d in-scope pattern(s), none can cross a line" % (rel, len(in_scope)))
    return worst, lines, examined


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-check", action="store_true", help="prove this audit can FAIL")
    a = ap.parse_args([] if (argv is None and "pytest" in sys.modules) else argv)
    if a.self_check:
        return _self_check()

    code, lines, examined = audit()
    for l in lines:
        print(l)
    # ⛔ NON-VACUITY: an empty in-scope set would make "no offenders" trivially true.
    print("[sig-regex] in-scope approval-block patterns examined: %d" % examined)
    if examined == 0:
        print("[sig-regex] ZERO patterns examined — the derivation is broken, not the repo.")
        return UNREADABLE
    print("[sig-regex] %s" % {PASS: "OK — every approval-block pattern is line-anchored",
                              FAIL: "STOP — a pattern can cross a line boundary",
                              UNREADABLE: "STOP — could not be measured"}[code])
    return code


def _self_check() -> int:
    """⛔ A check nobody has seen fail is not a check.

    Both controls are REQUIRED and they fail for different reasons:
      * POSITIVE — the real defect (`\\s*\\S`) is caught.
      * NEGATIVE — the real, correct spelling (`[ \\t]*`) is NOT caught, so the audit
        cannot pass by flagging everything.
    """
    import tempfile
    ok = True
    with tempfile.TemporaryDirectory() as td:
        d = pathlib.Path(td)

        bad = d / "bad.py"
        bad.write_text(
            "import re\n"
            "# the 2026-09-14 defect, verbatim\n"
            'RX = re.compile(r"APPROVED AT SHA:\\s*\\S")\n', encoding="utf-8")
        got = offenders_in(bad)
        print("  POSITIVE control  bad.py  -> %d offender(s) %s" % (len(got), "ok" if got else "WRONG"))
        ok &= bool(got)

        good = d / "good.py"
        good.write_text(
            "import re\n"
            'RX = re.compile(r"^APPROVED AT SHA:[ \\t]*$", re.M)\n'
            'RX2 = re.compile(r"^APPROVED BY:[ \\t]+[A-Za-z]", re.M)\n', encoding="utf-8")
        got2 = offenders_in(good)
        print("  NEGATIVE control good.py -> %d offender(s) %s" % (len(got2), "ok" if not got2 else "WRONG"))
        ok &= not got2

        # ⛔ THE DECOY THE PROMPT ASKS FOR, AS A BEHAVIOURAL CASE rather than a pattern
        # test: does the defective regex actually read the NEXT line? If this ever stops
        # being true, the whole finding was wrong and this file should be deleted.
        empty_block = "APPROVED AT SHA:\nSCOPE APPROVED:   z\n"
        crosses = re.search(r"APPROVED AT SHA:\s*\S", empty_block) is not None
        safe = re.search(r"APPROVED AT SHA:[ \t]*\S", empty_block) is not None
        print("  DECOY  empty block: \\s*\\S matches=%s (must be True) | [ \\t]*\\S matches=%s (must be False)"
              % (crosses, safe))
        ok &= crosses and not safe

        # the audit must also survive a missing file as UNREADABLE, never as a pass
        code, _, _ = audit(instruments=("tools/does_not_exist.py",))
        print("  MISSING file      -> exit %d %s" % (code, "ok" if code == UNREADABLE else "WRONG"))
        ok &= (code == UNREADABLE)

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return PASS if ok else FAIL


if __name__ == "__main__":
    raise SystemExit(main())
