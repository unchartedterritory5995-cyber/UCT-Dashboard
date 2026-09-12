"""Every site whose behaviour depends on the SHIPPED DEFAULT of the offline flag.

⛔ WHY A SWEEP AND NOT A READING. Flipping `OFFLINE_DEFAULT_ON` changes what an
UNSET key means, everywhere, at once. A site that removes the key and asserts
"nothing happens" is asserting the default, whether or not its author knew it —
and after the flip that same site asserts the opposite of what it was written to
prove, or breaks. Reading found four. Reading cannot prove there is no fifth.

⭐ THREE WAYS TO REACH THE DEFAULT, and only the first is obvious:
   1. `removeItem(<key>)` — deliberate, usually commented
   2. `localStorage.clear()` — incidental, often in an `afterEach`, and the test
      that runs next in the same file may then read an unset key without ever
      knowing it
   3. NEVER SETTING IT AT ALL — a file that exercises the offline layer and
      never writes the key is running entirely on the default
   4. ⚰️ INJECTING ITS OWN EMPTY STORAGE — `store({})`, `{ getItem: () => null }`.
      FOUND THE HARD WAY, 2026-09-12: the flip gate went red on two telemetry
      tests this sweep had never flagged, because they never touch
      `localStorage` at all — they hand the reader a stub. Both asserted
      `enabled: false` for an unset key, which is the DEFAULT, and both inverted
      at the flip. The docstring above promised three ways and said "Reading
      cannot prove there is no fifth"; neither can this tool, and it had already
      missed a fourth while saying so.

⛔ CLASSIFICATION IS THE POINT, not the list. Each site is one of:
   · TESTS-OFF          the property is "with the wave off, X does not happen".
                        After the flip, off must be written EXPLICITLY: '0'.
   · REACHES-DEFAULT    the site reaches the SHIPPED DEFAULT by a route that
                        leaves no localStorage call to grep for: an injected
                        stub, a stubbed global, or a mocked flag module.
                        ⛔ READ IT. Whether it is asserting "off" or asserting
                        "whatever ships" depends on the expectation beside it,
                        and no regex can tell you which.
   · TESTS-THE-DEFAULT  the property IS the shipped default. After the flip the
                        assertion inverts, deliberately, in the flip commit.
   · UNSET-INCIDENTAL   reaches an unset key without asserting anything about it;
                        needs a human read before the flip.

Usage:
    python tools/q1_flag_default_sweep.py
    python tools/q1_flag_default_sweep.py --self-check
"""
from __future__ import annotations

import pathlib
import re
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPO = pathlib.Path(__file__).resolve().parent.parent
SRC = REPO / "app" / "src"
KEY_LITERAL = "uct.j2.offline.enabled"
KEY_CONST = "OFFLINE_FLAG_KEY"
DEFAULT_CONST = "OFFLINE_DEFAULT_ON"
# Names that mean "this file can observe the flag at all".
TOUCHES = (KEY_LITERAL, KEY_CONST, DEFAULT_CONST, "offlineEnabled", "useOutboxDrain",
           "useDurableNote", "settleLandedSave", "beginInFlightSave", "drainOutbox")

RE_REMOVE = re.compile(r"removeItem\(\s*(?:" + KEY_CONST + r"|['\"]" + re.escape(KEY_LITERAL) + r"['\"])\s*\)")
RE_CLEAR = re.compile(r"localStorage\.clear\(\s*\)")
RE_SET = re.compile(r"setItem\(\s*(?:" + KEY_CONST + r"|['\"]" + re.escape(KEY_LITERAL) + r"['\"])")
RE_ASSERT_DEFAULT = re.compile(re.escape(DEFAULT_CONST) + r"\s*\)\s*\.toBe")
# ⛔ A STORAGE STUB IS A WAY TO REACH THE DEFAULT, and it leaves no
# `localStorage` call to grep for. `store({})` and an inline reader whose
# `getItem` answers null both mean "the key is unset" to `offlineEnabled()`.
# ⭐ Ways to reach the default that leave no localStorage call to grep for, and
# no obvious stub either. Zero hits on 2026-09-12 - carried so the next one is
# found by the tool instead of by a red gate.
RE_GLOBAL_STUB = re.compile(r"stubGlobal\(\s*['\"]localStorage"
                            r"|defineProperty\(\s*(?:globalThis|global|window)\s*,\s*['\"]localStorage")
RE_MODULE_MOCK = re.compile(r"vi\.mock\(\s*['\"][^'\"]*offlineFlag")
RE_STUB = re.compile(r"store\(\s*\{\s*\}\s*\)"
                     r"|getItem\s*:\s*\(\s*\)\s*=>\s*(?:null|undefined)")


def classify(path: pathlib.Path, text: str) -> list[tuple[int, str, str]]:
    """→ [(line, kind, evidence)]"""
    out = []
    lines = text.splitlines()
    for i, line in enumerate(lines, 1):
        if RE_ASSERT_DEFAULT.search(line):
            out.append((i, "TESTS-THE-DEFAULT", line.strip()[:96]))
        elif RE_REMOVE.search(line):
            out.append((i, "TESTS-OFF", line.strip()[:96]))
        elif RE_STUB.search(line):
            # ⛔ TESTS-OFF, not incidental: a stub that answers null is a
            # DELIBERATE unset, written to exercise the default. It inverts at a
            # flip exactly like `removeItem` does.
            if any(t in text for t in TOUCHES):
                # ⛔ NOT "TESTS-OFF". A stub answering null REACHES the default;
                # whether the test is asserting "off" or asserting "whatever
                # ships" depends on the expectation beside it, which no regex can
                # read. Calling it TESTS-OFF told the operator it needed an
                # explicit '0' - and post-flip all six of these sites are
                # CORRECT as they stand, asserting the ON default deliberately.
                out.append((i, "REACHES-DEFAULT", line.strip()[:96]))
        elif RE_GLOBAL_STUB.search(line) or RE_MODULE_MOCK.search(line):
            # ⭐ FORWARD-LOOKING. None of these exist in the tree today; the
            # detector exists so the FIFTH pattern is caught the day it appears,
            # rather than by a flip gate going red. The docstring above promised
            # three ways and was wrong; promising four would be the same mistake.
            if any(t in text for t in TOUCHES):
                out.append((i, "REACHES-DEFAULT", line.strip()[:96]))
        elif RE_CLEAR.search(line):
            # ⛔ Only counts when the FILE can observe the flag — otherwise every
            # test in the app that tidies localStorage would be listed, and a
            # list that long is a list nobody reads.
            if any(t in text for t in TOUCHES):
                out.append((i, "UNSET-INCIDENTAL", line.strip()[:96]))
    # A file that exercises the layer and NEVER sets the key runs on the default.
    if any(t in text for t in TOUCHES) and not RE_SET.search(text) and not out:
        out.append((0, "UNSET-INCIDENTAL", "file touches the offline layer and never sets the key"))
    return out


def sweep() -> dict[str, list[tuple[int, str, str]]]:
    found = {}
    for p in sorted(SRC.rglob("*")):
        if p.suffix not in (".js", ".jsx") or not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        hits = classify(p, text)
        if hits:
            found[str(p.relative_to(REPO)).replace("\\", "/")] = hits
    return found


def self_check() -> int:
    bad = 0

    def case(name, ok):
        nonlocal bad
        print(f"  {'ok ' if ok else 'FAIL'}  {name}")
        bad += 0 if ok else 1

    fake_touch = f"import {{ {KEY_CONST} }} from './offlineFlag'\n"
    case("a removeItem of the key is TESTS-OFF",
         classify(pathlib.Path("x.test.jsx"), fake_touch + f"localStorage.removeItem({KEY_CONST})\n")[0][1] == "TESTS-OFF")
    case("an assertion ON the default is TESTS-THE-DEFAULT",
         classify(pathlib.Path("x.test.jsx"), fake_touch + f"expect({DEFAULT_CONST}).toBe(false)\n")[0][1] == "TESTS-THE-DEFAULT")
    case("⚰️ an injected EMPTY storage stub is REACHES-DEFAULT — the fourth way, missed until 2026-09-12",
         classify(pathlib.Path("x.test.jsx"), fake_touch + "flagState({ getItem: () => null })\n")[0][1] == "REACHES-DEFAULT")
    case("…and `store({})` counts too",
         classify(pathlib.Path("x.test.jsx"), fake_touch + "optInProps({ storage: store({}) })\n")[0][1] == "REACHES-DEFAULT")
    # ⛔ THE CONTROL ASSERTS THE STUB RULE, NOT THE WHOLE FILE. A flag-touching
    # file that never sets the key is UNSET-INCIDENTAL by the fallback below no
    # matter what its stubs answer — asserting `== []` here failed for that
    # reason, and the assertion was wrong, not the tool.
    case("CONTROL: a stub that answers a VALUE is not read as reaching the default",
         "REACHES-DEFAULT" not in [k for _, k, _ in classify(
             pathlib.Path("x.test.jsx"), fake_touch + "flagState({ getItem: () => '1' })\n")])
    case("⭐ a STUBBED GLOBAL localStorage reaches the default too (the fifth way)",
         classify(pathlib.Path("x.test.jsx"), fake_touch + "vi.stubGlobal('localStorage', fake)\n")[0][1] == "REACHES-DEFAULT")
    case("⭐ …and so does a MOCKED flag module",
         classify(pathlib.Path("x.test.jsx"), fake_touch + "vi.mock('../offline/offlineFlag')\n")[0][1] == "REACHES-DEFAULT")
    case("CONTROL: stubbing some OTHER global is not a default-reach",
         "REACHES-DEFAULT" not in [k for _, k, _ in classify(
             pathlib.Path("x.test.jsx"), fake_touch + "vi.stubGlobal('fetch', fake)\n")])
    case("CONTROL: mocking some OTHER module is not a default-reach",
         "REACHES-DEFAULT" not in [k for _, k, _ in classify(
             pathlib.Path("x.test.jsx"), fake_touch + "vi.mock('../offline/notebookDb')\n")])
    case("localStorage.clear() in a flag-touching file is UNSET-INCIDENTAL",
         classify(pathlib.Path("x.test.jsx"), fake_touch + "localStorage.clear()\n")[0][1] == "UNSET-INCIDENTAL")
    # ⛔ THE CONTROL: a file that has nothing to do with the flag must not appear,
    # or the sweep drowns its own signal.
    case("⛔ localStorage.clear() in an UNRELATED file is NOT reported",
         classify(pathlib.Path("y.test.jsx"), "localStorage.clear()\n") == [])
    case("a file that SETS the key explicitly is not flagged as running on the default",
         classify(pathlib.Path("z.test.jsx"), fake_touch + f"localStorage.setItem({KEY_CONST}, '1')\n") == [])
    # ⛔ NON-VACUITY: the sweep must actually find the known sites in the real tree.
    real = sweep()
    n = sum(len(v) for v in real.values())
    case(f"the sweep finds real sites in the tree (found {n})", n >= 4)
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 1 if bad else 0


def main() -> int:
    if "--self-check" in sys.argv:
        return self_check()
    found = sweep()
    total = sum(len(v) for v in found.values())
    print("⭐ SITES WHOSE BEHAVIOUR DEPENDS ON THE SHIPPED FLAG DEFAULT")
    print(f"   {len(found)} file(s), {total} site(s)\n")
    order = {"TESTS-THE-DEFAULT": 0, "TESTS-OFF": 1, "UNSET-INCIDENTAL": 2}
    for path in sorted(found, key=lambda p: (min(order[k] for _, k, _ in found[p]), p)):
        print(f"  {path}")
        for line, kind, ev in found[path]:
            where = f":{line}" if line else ""
            print(f"     [{kind:<17}]{where:<6} {ev}")
    print("\n   TESTS-OFF          → at the flip, write OFF explicitly: setItem(KEY, '0')")
    print("   TESTS-THE-DEFAULT  → at the flip, the assertion inverts, deliberately")
    print("   UNSET-INCIDENTAL   → read it before the flip; it may assert nothing,")
    print("                        or it may be asserting the default without saying so")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
