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

it('write', () => { fs.writeFileSync(process.env.W14_PARITY_OUT, JSON.stringify(OUT, null, 1)) })
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


def main():
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
    same = [k for k in a if a[k] == b.get(k)]
    differ = [k for k in a if a[k] != b.get(k)]
    lines = [f"== flags-off render parity{' (MUTATION: wave-14 switch removed from tourLive)' if mutate else ''}",
             f"base {BASE} vs HEAD {git('rev-parse', '--short=10', 'HEAD').decode().strip()}",
             f"pass A {ta}", f"pass B {tb}", f"swapped {len(saved)} source files to the base blob; restored, git status unchanged",
             f"{len(same)} identical | {len(differ)} differ ({len(a)} cases)"]
    for k in differ:
        x, y = a[k], b.get(k, "")
        i = next((j for j in range(min(len(x), len(y))) if x[j] != y[j]), min(len(x), len(y)))
        lines.append(f"  DIFFERS: {k}\n    HEAD: ...{x[max(0, i - 80):i + 160]}\n    BASE: ...{y[max(0, i - 80):i + 160]}")
    verdict = ("PASS -- identical" if not differ else "DIFFERS") if not mutate else \
        ("PASS -- the mutation is caught" if differ else "FAIL -- the mutation was NOT caught")
    lines.append(f"VERDICT: {verdict}")
    body = "\n".join(lines) + "\n"
    (EV / ("flagsoff-parity-MUTATION.txt" if mutate else "flagsoff-parity.txt")).write_text(body, encoding="utf-8")
    print(body)
    ok = (not differ) if not mutate else bool(differ)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
