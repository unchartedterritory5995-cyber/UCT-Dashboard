"""Wave 14 flags-off render parity (W14-C1 controller ruling; docs/notebook/wave14-w14-c1.md).

The claim it tests: with the wave-14 switch OFF (notebook_onboarding_enabled AND
notebook_getting_started_enabled not both on), Help, Notebook Home, the notes list, an open
note and the app shell (Layout) render exactly as they did before wave 14.

"Before wave 14" is `BASE` = b06ec4fd85, the wave-13 landing the first wave-14 lane branched
from. (Master itself does not have wave 13 yet, so master's own files cannot be rendered with
this branch's wave-13 children; the wave-13 landing is the tree this branch will put on master
minus wave 14.)

How:
  pass A  the tree as committed: a capture test renders every surface under every flag set and
          preference state, and writes normalised HTML to a JSON file;
  pass B  every NON-test source file under app/src that wave 14 changed is swapped for its
          `BASE` blob (files wave 14 added stay, unreferenced), the same capture runs;
  restore every swapped file gets its exact original bytes back, and `git status` must read
          as it did before the run.
Then A and B are compared case by case. Normalisation is stated, not hidden: `data-tour`
attributes (inert markers the tours point at; the wave-8 base tour uses them too), React
`useId` values, and CSS-module hash suffixes are removed before comparing.

Usage:
  python tools/notebook_w14_flagsoff_parity.py              # the parity run
  python tools/notebook_w14_flagsoff_parity.py --mutate     # same, with the wave-14 switch
                                                            # removed from tourLive(): must DIFFER
  python tools/notebook_w14_flagsoff_parity.py --self-check # the expected-difference judge only
                                                            # (no build, no vitest; seconds)

EXPECTED DIFFERENCES (`EXPECTED`, below). A difference the controller has accepted is NAMED
there, with the exact element, the cases it is allowed in, its commit, the reason and the date.
The verdict is PASS only when every difference in every case is explained EXACTLY by named
entries; anything else, including a named element showing up in a case it is not allowed in,
reads DIFFERS. The list is not a tolerance: it has no patterns and no wildcards.

WHAT THIS TOOL CANNOT SEE. No case has a tour card on screen (0 of 40: the surfaces are
rendered at rest, and a tour needs a click or an eligible first visit the capture does not
make). A change to tour markup is therefore invisible here. The real-browser tours walk covers it.
"""
import json
import pathlib
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / "app"
BASE = "b06ec4fd85"
CAPTURE_REL = "src/pages/journal-2-0/w14c1-flagsoff-parity.capture.test.jsx"
EV = ROOT / "docs/notebook/evidence/wave14-w14-c1"
KEEP_CURRENT = ("/__fixtures__/", "/a11y/fixtures.jsx", "/a11y/surface.js", "/a11y/axeHarness")
MUTATION = ("app/src/pages/journal-2-0/components/notebook/onboarding/tourRegistry.js",
            "  if (!checklistEnabled(flag)) return false\n", "")

# The accepted differences. ONE entry. Adding one is a controller ruling, never a tool-side fix.
#   element   the exact normalised markup HEAD has and BASE does not (an insertion, whole element)
#   surface   the only capture surface it may appear on
#   needs     the capability that must be ON in the case's flag set (read from the capture's own
#             flag sets, never inferred from the case name)
EXPECTED = (
    {
        "name": "passed-setups status line (fin-a11y M-5)",
        "element": '<p class="_quiet_ _notice_" role="status" data-passed-status=""></p>',
        "surface": "notebook home",
        "needs": "notebook_passed_setups_enabled",
        "commit": "cb5c30b38d",
        "accepted": "2026-10-06",
        "reason": "Accessibility item M-5: the passed-setups box keeps one status line mounted, "
                  "empty at rest, that Add and Remove fill so a screen reader hears the result. "
                  "It exists only while the passed-setups capability is on. Accepted by the "
                  "controller as an intended accessibility change.",
    },
)
FLAGS_KEY = "__flagsets__"          # the capture writes its flag sets under this key

CAPTURE = r"""
// TRANSIENT: written and deleted by tools/notebook_w14_flagsoff_parity.py. Not part of the suite.
import { it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import Layout from '../../components/Layout'
import Support from '../Support'
import NotebookTab from './tabs/NotebookTab'
import { installFetch, Providers } from './a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from './lib/offline/notebookFlags'

vi.mock('../../components/NavBar', async (o) => ({ ...(await o()), default: () => <nav>nav</nav> }))
vi.mock('../../components/MobileNav', () => ({ default: () => null }))
vi.mock('../../components/FeedbackWidget', () => ({ default: () => null }))
vi.mock('../../components/mobile/MoreSheet', () => ({ default: () => null }))
vi.mock('../../components/mobile/TickerHubSheet', () => ({ default: () => null }))
vi.mock('../../lib/barsPackClient', () => ({ initBarsPack: () => {} }))

const KEYS = __KEYS__
const all = (v) => Object.fromEntries(KEYS.map((k) => [k, v]))
const FLAGSETS = {
  'prod-like: every capability on, getting-started off': { ...all(true), notebook_getting_started_enabled: false },
  'every capability on, onboarding off': { ...all(true), notebook_onboarding_enabled: false },
  'onboarding only': { ...all(false), notebook_onboarding_enabled: true },
  'all off': all(false),
}
const PREFS = {
  'fresh member': {},
  'base tour done, checklist closed': {
    notebook_tour: JSON.stringify({ v: 1, state: 'done', step: null }),
    notebook_getting_started: JSON.stringify({ v: 1, state: 'dismissed' }),
  },
}
const norm = (html) => html
  .replace(/ data-tour(-active)?="[^"]*"/g, '')
  .replace(/:r[0-9a-z]+:/g, ':r:')
  .replace(/_r_[0-9a-z]+_/g, '_r_')   // React 19 useId (a counter: it counts hooks, not markup)
  .replace(/\buig[0-9]+\b/g, 'uig')   // UIcon's gradient id: a module counter of MOUNT order (UIcon.jsx), so a lazily mounted box renumbers every later icon without changing markup
  .replace(/\b(_[A-Za-z][A-Za-z0-9-]*_)[a-z0-9]{5,8}\b/g, '$1')
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const OUT = {}

beforeEach(() => { __resetNotebookFlags() })
afterEach(() => { cleanup(); __resetNotebookFlags() })

const shell = (route) => (
  <Providers route={route}>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/journal/notebook" element={<NotebookTab />} />
        <Route path="/dashboard" element={<div>dashboard page</div>} />
      </Route>
    </Routes>
  </Providers>
)

for (const [fname, flags] of Object.entries(FLAGSETS)) {
  for (const [pname, prefs] of Object.entries(PREFS)) {
    const key = (s) => `${s} | ${fname} | ${pname}`
    const setup = () => {
      latchNotebookFlags(flags)
      installFetch([[/^\/api\/auth\/preferences$/, { preferences: prefs }], [/^\/api\/auth\/faq-votes$/, { votes: [] }]])
    }
    it(key('help'), async () => {
      setup()
      render(<Providers route="/support"><Support /></Providers>)
      await wait(400)
      const q = screen.queryByRole('button', { name: 'How do I get started with the Notebook?' })
      if (q) fireEvent.click(q)
      await wait(200)
      OUT[key('help')] = norm(document.body.innerHTML)
    }, 30000)
    for (const [surface, route] of [['notebook home', '/journal/notebook'], ['notes list', '/journal/notebook?view=all'],
      ['open note', '/journal/notebook?note=n1'], ['layout', '/dashboard']]) {
      it(key(surface), async () => {
        setup()
        render(shell(route))
        await wait(1500)
        OUT[key(surface)] = norm(document.body.innerHTML)
      }, 30000)
    }
  }
}

it('write', () => { fs.writeFileSync(process.env.W14_PARITY_OUT, JSON.stringify({ ...OUT, __flagsets__: FLAGSETS }, null, 1)) })
"""


def git(*a, **kw):
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, check=True, **kw).stdout


def keys():
    src = (APP / "src/pages/journal-2-0/lib/offline/notebookFlags.js").read_text(encoding="utf-8")
    block = src[src.index("export const FLAG_FALLBACKS"):]
    block = block[:block.index("})")]
    return [k for k in re.findall(r"^\s+([a-z0-9_]+):", block, re.M) if k != "notebook_door_guard"]


def capture(out):
    (APP / CAPTURE_REL).write_text(CAPTURE.replace("__KEYS__", json.dumps(keys())), encoding="utf-8")
    try:
        r = subprocess.run(f"npx vitest run {CAPTURE_REL} --maxWorkers=2", cwd=APP, shell=True,
                           capture_output=True, text=True, encoding="utf-8", errors="replace",
                           env={**__import__("os").environ, "W14_PARITY_OUT": str(out)}, timeout=1800)
    finally:
        (APP / CAPTURE_REL).unlink()
    tail = re.sub(r"\x1b\[[0-9;]*m", "", r.stdout + r.stderr)
    totals = [l.strip() for l in tail.splitlines() if l.strip().startswith(("Test Files", "Tests "))]
    if r.returncode != 0 or not out.exists():
        print(tail[-4000:])
        raise SystemExit(f"capture failed (exit {r.returncode}); {totals}")
    return json.loads(out.read_text(encoding="utf-8")), totals


def swap_to_base():
    changed = git("diff", "--name-only", BASE, "HEAD", "--", "app/src").decode().split()
    saved = {}
    for rel in changed:
        if ".test." in rel or any(k in rel for k in KEEP_CURRENT):
            continue
        p = ROOT / rel
        try:
            blob = git("cat-file", "blob", f"{BASE}:{rel}")
        except subprocess.CalledProcessError:
            continue                                   # added by wave 14: left, unreferenced
        saved[rel] = p.read_bytes() if p.exists() else None
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(blob)
    return saved


def restore(saved):
    for rel, data in saved.items():
        p = ROOT / rel
        if data is None:
            p.unlink()
        else:
            p.write_bytes(data)


def _without_each(head, element):
    """Every string made by deleting ONE occurrence of `element` from `head`."""
    i = head.find(element)
    while i != -1:
        yield head[:i] + head[i + len(element):]
        i = head.find(element, i + 1)


def judge(case, head, base, flagsets, expected=EXPECTED):
    """('identical' | 'expected' | 'differs', [names of the entries that explain it]).

    'expected' only when BASE is exactly HEAD with one occurrence of each of some set of named
    elements removed, and every one of those entries is allowed in this case: the case is on
    the entry's surface AND the entry's capability is literally True in the case's flag set.
    It is a reconstruction, not a diff reading: no alignment, no pattern, no partial credit."""
    if head == base:
        return "identical", []
    parts = case.split(" | ")
    surface, flagset = (parts[0], parts[1]) if len(parts) == 3 else (None, None)
    flags = flagsets.get(flagset) or {}
    allowed = [e for e in expected if e["surface"] == surface and flags.get(e["needs"]) is True]
    frontier = [(head, [])]
    for e in allowed:                       # each entry is used at most once per case
        nxt = list(frontier)
        for text, used in frontier:
            for cut in _without_each(text, e["element"]):
                nxt.append((cut, used + [e["name"]]))
        frontier = nxt
    for text, used in frontier:
        if used and text == base:
            return "expected", used
    return "differs", []


def self_check():
    """The judge must accept the one named difference where it is allowed and nothing else."""
    e = EXPECTED[0]
    on = {"caps on": {e["needs"]: True}, "caps off": {e["needs"]: False}, "absent": {}}
    base = '<main><section><p>or add one above.</p></section><div>next</div></main>'
    head = base.replace("</p></section>", "</p>" + e["element"] + "</section>")
    home_on, home_off = f"{e['surface']} | caps on | fresh member", f"{e['surface']} | caps off | fresh member"
    cases = [
        ("the named element, capability on: accepted", home_on, head, base, "expected"),
        ("identical output", home_on, base, base, "identical"),
        ("the SAME element in a capabilities-off case", home_off, head, base, "differs"),
        ("the same element where the flag set does not name the capability", f"{e['surface']} | absent | x", head, base, "differs"),
        ("the same element on another surface", "notes list | caps on | fresh member", head, base, "differs"),
        ("any other difference", home_on, base.replace("next", "next!"), base, "differs"),
        ("the named element PLUS another difference", home_on, head.replace("next", "next!"), base, "differs"),
        ("the named element twice", home_on, head.replace(e["element"], e["element"] * 2), base, "differs"),
        ("the element with text in it", home_on, head.replace('status=""></p>', 'status="">Saved</p>'), base, "differs"),
        ("the element with one attribute changed", home_on, head.replace('role="status"', 'role="alert"'), base, "differs"),
        ("the element REMOVED rather than added", home_on, base, head, "differs"),
        ("a case name the tool cannot parse", "notebook home", head, base, "differs"),
    ]
    bad = []
    for label, case, h, b, want in cases:
        got = judge(case, h, b, on)[0]
        print(f"  {'ok  ' if got == want else 'FAIL'} {label}: {got}")
        if got != want:
            bad.append(label)
    print(f"SELF-CHECK: {'PASS' if not bad else 'FAIL'} ({len(cases) - len(bad)} of {len(cases)})")
    return not bad


def main():
    if "--self-check" in sys.argv:
        sys.exit(0 if self_check() else 1)
    if not self_check():                    # a judge that cannot refuse must not issue a verdict
        raise SystemExit("the expected-difference judge failed its own check; no verdict")
    mutate = "--mutate" in sys.argv
    before = git("status", "--porcelain").decode()
    EV.mkdir(parents=True, exist_ok=True)
    tmp = pathlib.Path(__import__("tempfile").gettempdir())
    applied = None
    if mutate:
        rel, old, new = MUTATION
        p = ROOT / rel
        applied = (p, p.read_bytes())
        text = applied[1].decode("utf-8")
        o = old.replace("\n", "\r\n") if "\r\n" in text else old
        assert text.count(o) == 1, "mutation anchor not found exactly once"
        p.write_bytes(text.replace(o, new).encode("utf-8"))
    try:
        a, ta = capture(tmp / "w14c1_parity_A.json")
    finally:
        if applied:
            applied[0].write_bytes(applied[1])
    saved = swap_to_base()
    try:
        b, tb = capture(tmp / "w14c1_parity_B.json")
    finally:
        restore(saved)
    after = git("status", "--porcelain").decode()
    assert after == before, f"RESTORE FAILED: git status changed\n{before}\n---\n{after}"
    flagsets = a.pop(FLAGS_KEY, None)
    b.pop(FLAGS_KEY, None)
    if not isinstance(flagsets, dict) or not flagsets:
        raise SystemExit("the capture wrote no flag sets; an expected difference cannot be judged")
    verdicts = {k: judge(k, a[k], b.get(k, ""), flagsets) for k in a}
    same = [k for k in a if verdicts[k][0] == "identical"]
    explained = [k for k in a if verdicts[k][0] == "expected"]
    differ = [k for k in a if verdicts[k][0] == "differs"]
    lines = [f"== flags-off render parity{' (MUTATION: wave-14 switch removed from tourLive)' if mutate else ''}",
             f"base {BASE} vs HEAD {git('rev-parse', '--short=10', 'HEAD').decode().strip()}",
             f"pass A {ta}", f"pass B {tb}", f"swapped {len(saved)} source files to the base blob; restored, git status unchanged",
             f"{len(same)} identical | {len(explained)} differ only by a named expected difference | "
             f"{len(differ)} differ ({len(a)} cases)"]
    for k in explained:
        lines.append(f"  EXPECTED: {k}\n    explained exactly by: {', '.join(verdicts[k][1])}")
    for e in EXPECTED if explained else ():
        lines.append(f"  NAMED: {e['name']} | commit {e['commit']} | accepted {e['accepted']} | only on "
                     f"'{e['surface']}' with {e['needs']} on\n    element: {e['element']}\n    reason: {e['reason']}")
    for k in differ:
        x, y = a[k], b.get(k, "")
        i = next((j for j in range(min(len(x), len(y))) if x[j] != y[j]), min(len(x), len(y)))
        lines.append(f"  DIFFERS: {k}\n    HEAD: ...{x[max(0, i - 80):i + 160]}\n    BASE: ...{y[max(0, i - 80):i + 160]}")
    passed = "PASS -- identical" if not explained else \
        f"PASS -- identical except {len(explained)} case(s) explained exactly by a named expected difference"
    verdict = (passed if not differ else "DIFFERS") if not mutate else \
        ("PASS -- the mutation is caught" if differ else "FAIL -- the mutation was NOT caught")
    lines.append(f"VERDICT: {verdict}")
    body = "\n".join(lines) + "\n"
    (EV / ("flagsoff-parity-MUTATION.txt" if mutate else "flagsoff-parity.txt")).write_text(body, encoding="utf-8")
    print(body)
    ok = (not differ) if not mutate else bool(differ)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
