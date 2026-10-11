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

SAME TREE, SAME VERDICT. Each capture is taken once the page has settled (three equal readings
250 ms apart), never after a fixed wait alone, and a page that never settles refuses the run.
The evidence file carries a fingerprint of each pass's captures, so two runs on one tree can be
compared. This was added after a run on 2026-10-06 (b17f4a3e13) reported one difference on a
tree that held two; the cause of that reading was never established, and a fixed 1.5 s wait on
a loaded box was the one part of the instrument that could vary between runs.

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

# The accepted differences. Adding one is a controller ruling, never a tool-side fix. (No count is
# typed here: the rail, tests/test_notebook_w14_flagsoff_parity_expected.py, holds the number.)
#
# RULING R9 (controller, 2026-10-11, Notebook P0 discoverability, Task 15): update this list ONCE for
# the P0 doors. What that could and could not be, stated rather than papered over:
#   NAMED BELOW (each literal read off the capture, occurring once in HEAD where it is allowed):
#     the New note menu (P0.1), the search input (P0.13, whose box the 10/10 UX pass made a button),
#     the Active setups box (P0.5, which REPLACES the lane NAV door that stood here: that link is no
#     longer in HEAD, so its entry is rewritten, not kept beside the new one) and the note's Ask door
#     renamed "Ask this note" (P0.7, 4a4c2503e2: one button, its name and its text).
#   REMOVED, because their targets are gone from HEAD and the cause is not P0's: the passed-setups
#     status line (fin-a11y M-5) and the reviews heading's id/tabindex. Both vanished with the 10/10
#     UX pass (53188edfff, on master, an ancestor of the P0 base eec73eede5): the passed-setups box now
#     starts folded, so its status line is not mounted, and the reviews heading became sr-only. An entry
#     that matches nothing in HEAD is not evidence, and its true-sounding reason would mislead.
#   NOT NAMEABLE IN THIS GRAMMAR, and why (the verdict does not pretend otherwise):
#     the Home half of the Ask change (P0.7): a RESTRUCTURE. BASE holds two Ask pieces in two places and
#       HEAD one section; no single added element, one-tag swap or counted run states it.
#     Notices box (P0.4): renders only when the alerts / insights reads return rows, and the capture's
#       fetch serves none, so no case contains it. A name with no case to appear in is not evidence.
#     Learn "What your Notebook can do" (Task 14b): the Learn menu needs both wave-14 onboarding switches
#       and no flag set in the capture turns both on, so neither the Learn button nor its menu is in any
#       capture (the capture also photographs surfaces at rest; see "WHAT THIS TOOL CANNOT SEE" above).
# ⚠ THE VERDICT IS STILL "DIFFERS". Every difference left after the entries below is older than P0, in
# commits that are ancestors of the P0 base and on master: the sidebar tree's keyboard markup (roles,
# tabindex, data-tree-*, the folder-nav id, Favorites/Recents groups: c9a2d1acfd, 2026-10-08), the
# sidebar slot's reveal marker (e0102557f4, 2026-10-10) and the UX pass's regrouping of Home (Recent
# notes, folded boxes, the Today button's move, the reviews heading: 53188edfff, 2026-10-10). The
# exceptions are the P0 differences this tool cannot state (the Home half of Ask above). They differ
# from BASE in EVERY flag set and have no entry. Accepting them is its own controller ruling; it is
# not made here.
#
# An entry names how HEAD differs from BASE as LITERAL text, one of two ways:
#   element          a whole element HEAD has and BASE does not;
#   head / base      one opening tag as HEAD has it, and the same tag as BASE has it (or, for the one
#                    renamed button, the whole button as each has it: the rail names that allowance);
#   roving           the one entry that is a counted run: the editor toolbar's controls, numbered
#                    tb-0, tb-1, ... with no gap, the first carrying the marker and every later one
#                    `tabindex="-1"` and the marker. The literals are generated from the count,
#                    never matched by a pattern.
# Each literal must occur in HEAD EXACTLY ONCE, and undoing every named change must give BASE
# byte for byte. `surface` is the only capture surface the entry may appear on. `needs` is the
# capability that must be ON in the case's flag set (read from the capture's own flag sets,
# never inferred from the case name); None means the change is always on, so it is allowed in
# every flag set on that surface, the all-off one included.
EXPECTED = (
    {
        "name": "Active setups box (P0.5; replaces the lane NAV door)",
        "element": '<div class="_box_" data-export-exclude="true"><span class="_count_">Active setups</span><a class="btn btn-ghost _setupsLink_" aria-describedby="_r_" href="/journal/notebook/setups" data-discover="true">Open the setups board</a><span id="_r_" class="_srOnly_">Your open chart plans, closest to their entry first</span></div>',
        "surface": "notebook home",
        "needs": "notebook_setups_board_enabled",
        "commit": "7bc5a0965f",
        "accepted": "2026-10-11",
        "reason": "The active setups board's one door was a bare link (lane NAV, 6b7e037c9f, accepted "
                  "2026-10-07). P0.5 (owner decision, 2026-10-11) made it a box under the Notices box that "
                  "says how many plans are open and links to the board; the old link is gone from HEAD, so "
                  "this entry takes its place. Rendered only while the setups board capability is on. "
                  "Ruling R9.",
    },
    {
        "name": "New note menu on Research Home (P0.1)",
        "element": '<div class="_split_"><button type="button" class="btn btn-primary _main_"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"></path></svg> New note</button><button type="button" class="btn btn-primary _caret_" aria-haspopup="menu" aria-expanded="false" aria-label="More ways to start a note"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9.5l6 6 6-6"></path></svg></button></div>',
        "surface": "notebook home",
        "needs": None,
        "commit": "c4b504558d",
        "accepted": "2026-10-11",
        "reason": "Research Home gained a create door: one press makes a blank note, the caret lists the "
                  "other ways in (an item only when its handler exists). It renders for a member who has "
                  "notes, in every flag set. ALWAYS ON. Ruling R9.",
    },
    {
        "name": "Home search input (P0.13)",
        "element": '<input class="_searchBox_" data-home-search="" aria-label="Search your notes" placeholder="Search your notes" autocomplete="off" type="search">',
        "surface": "notebook home",
        "needs": None,
        "commit": "bf9489adbf",
        "accepted": "2026-10-11",
        "reason": "Research Home's search door is a real search input that hands the first character to the "
                  "folders panel's search (it was a button from the 10/10 UX pass; neither exists in BASE). "
                  "ALWAYS ON. Ruling R9.",
    },
    {
        "name": "Research Home skip link to the reviews (lane KEYS)",
        "element": '<a href="#nb-home-reviews" class="_skipLink_">Skip to reviews and setups</a>',
        "surface": "notebook home",
        "needs": "notebook_review_drafts_enabled",
        "commit": "ce16e3f4d5",
        "accepted": "2026-10-07",
        "reason": "Keyboard budget Q18 and Q23: a hidden-until-focused skip link in the shell's "
                  "skip-link slot, so the reviews and the setups door are a few keys away. It is "
                  "rendered by the review-drafts box, so only while that capability is on.",
    },
    {
        "name": "note Ask door is named 'Ask this note' (P0.7)",
        "head": '<button type="button" class="_askToggle_" aria-expanded="false" aria-label="Ask this note" data-ask-toggle="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="url(#uig)" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="color: rgb(230, 205, 138); filter: drop-shadow(0 0 1.6px rgba(201,168,76,0.32)); vertical-align: -2px; margin-right: 4px;"><defs><linearGradient id="uig" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#a8823a"></stop><stop offset="40%" stop-color="#d4b25a"></stop><stop offset="50%" stop-color="#e8d18c"></stop><stop offset="60%" stop-color="#cba954"></stop><stop offset="100%" stop-color="#8f6f2c"></stop></linearGradient></defs><path d="M12 3l1.9 5.6L19 10l-5.1 1.5L12 17l-1.9-5.5L5 10l5.1-1.4z"></path></svg>Ask this note</button>',
        "base": '<button type="button" class="_askToggle_" aria-expanded="false" aria-label="Ask a question about this note" data-ask-toggle="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="url(#uig)" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="color: rgb(230, 205, 138); filter: drop-shadow(0 0 1.6px rgba(201,168,76,0.32)); vertical-align: -2px; margin-right: 4px;"><defs><linearGradient id="uig" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#a8823a"></stop><stop offset="40%" stop-color="#d4b25a"></stop><stop offset="50%" stop-color="#e8d18c"></stop><stop offset="60%" stop-color="#cba954"></stop><stop offset="100%" stop-color="#8f6f2c"></stop></linearGradient></defs><path d="M12 3l1.9 5.6L19 10l-5.1 1.5L12 17l-1.9-5.5L5 10l5.1-1.4z"></path></svg>Ask</button>',
        "surface": "open note",
        "needs": None,
        "commit": "4a4c2503e2",
        "accepted": "2026-10-11",
        "reason": "The note's header door was 'Ask' (named 'Ask a question about this note'); P0.7 renamed "
                  "it 'Ask this note', visibly and to a screen reader, so it cannot be mistaken for the "
                  "Notebook-wide Ask section on Home. One button: its accessible name and its text. "
                  "ALWAYS ON: it is in every open note, with every flag off as well. Ruling R9.",
    },
    {
        "name": "editor formatting toolbar is one Tab stop (lane KEYS)",
        "roving": "tb",
        "surface": "open note",
        "needs": None,
        "commit": "fca50d3e5a",
        "accepted": "2026-10-07",
        "reason": "Keyboard budget Q2, Q12 and Q18: the editor's formatting toolbar is one Tab "
                  "stop with arrow keys inside it. Each control carries the roving marker, and "
                  "every control but the first is tabindex -1. ALWAYS ON: it is in every open "
                  "note, with every flag off as well. Nothing is added, removed or renamed; "
                  "only how the keyboard walks the row changes.",
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
// A capture is taken when the page has SETTLED, never after a fixed time alone. The surfaces
// load parts of themselves on demand, so on a loaded box a fixed wait can photograph a page
// that is still arriving, and the same tree can then read differently from one run to the
// next. After the first wait the page is re-read every 250 ms until three readings in a row
// are equal (at most 8 s more). A page that never settles is recorded by name in UNSETTLED and
// the run is refused: an unsettled capture is not evidence of anything.
const UNSETTLED = []
async function settled(key, ms) {
  await wait(ms)
  let last = norm(document.body.innerHTML), same = 0
  for (let i = 0; i < 32 && same < 2; i += 1) {
    await wait(250)
    const now = norm(document.body.innerHTML)
    same = now === last ? same + 1 : 0
    last = now
  }
  if (same < 2) UNSETTLED.push(key)
  return last
}
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
      OUT[key('help')] = await settled(key('help'), 200)
    }, 30000)
    for (const [surface, route] of [['notebook home', '/journal/notebook'], ['notes list', '/journal/notebook?view=all'],
      ['open note', '/journal/notebook?note=n1'], ['layout', '/dashboard']]) {
      it(key(surface), async () => {
        setup()
        render(shell(route))
        OUT[key(surface)] = await settled(key(surface), 1500)
      }, 30000)
    }
  }
}

it('write', () => { fs.writeFileSync(process.env.W14_PARITY_OUT, JSON.stringify({ ...OUT, __flagsets__: FLAGSETS, __unsettled__: UNSETTLED }, null, 1)) })
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
    # --no-renames: a file MOVED since BASE would otherwise be listed under its new name only, its old
    # path never swapped back, and the BASE blobs that still import the old path would not resolve
    # (instanceShape.js -> ./engine/legacyCotGroups, moved to ./legacyCotGroups; 2026-10-11).
    changed = git("diff", "--no-renames", "--name-only", BASE, "HEAD", "--", "app/src").decode().split()
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


def _roving_pairs(head, prefix):
    """The literals of one counted roving run in `head`: tb-0 with the marker alone, then every
    later control with `tabindex="-1"` and the marker, numbered with no gap. None when `head`
    does not hold exactly that (no run, a gap, a first control that is not the Tab stop)."""
    pairs = []
    k = 0
    while True:
        marker = f' data-roving-item="{prefix}-{k}"'
        lit = marker if k == 0 else f' tabindex="-1"{marker}'
        if head.count(marker) == 0:
            break
        if head.count(marker) != 1 or head.count(lit) != 1:
            return None
        pairs.append((lit, ""))
        k += 1
    if k < 2 or head.count(f' data-roving-item="{prefix}-') != k:   # a run, and nothing numbered outside it
        return None
    return pairs


def _pairs(entry, head):
    """[(literal in HEAD, the same place in BASE)] for one entry, or None when it does not apply."""
    if "element" in entry:
        return [(entry["element"], "")]
    if "head" in entry:
        return [(entry["head"], entry["base"])]
    return _roving_pairs(head, entry["roving"])


def judge(case, head, base, flagsets, expected=EXPECTED):
    """('identical' | 'expected' | 'differs', [names of the entries that explain it]).

    'expected' only when BASE is exactly HEAD with every change of some set of named entries
    undone, each of that set's literals occurring in HEAD exactly once, and every one of those
    entries allowed in this case: the case is on the entry's surface AND (the entry is always
    on, or its capability is literally True in the case's flag set).
    It is a reconstruction, not a diff reading: no alignment, no pattern, no partial credit."""
    if head == base:
        return "identical", []
    parts = case.split(" | ")
    surface, flagset = (parts[0], parts[1]) if len(parts) == 3 else (None, None)
    flags = flagsets.get(flagset) or {}
    allowed = [e for e in expected if e["surface"] == surface
               and flagset in flagsets
               and (e["needs"] is None or flags.get(e["needs"]) is True)]
    for mask in range(1, 2 ** len(allowed)):
        chosen = [e for i, e in enumerate(allowed) if mask >> i & 1]
        text, ok = head, True
        for e in chosen:
            pairs = _pairs(e, text)
            if not pairs or any(text.count(lit) != 1 for lit, _ in pairs):
                ok = False
                break
            for lit, was in pairs:
                text = text.replace(lit, was, 1)
        if ok and text == base:
            return "expected", [e["name"] for e in chosen]
    return "differs", []


def _apply(base, entry, n=4):
    """A HEAD made from `base` by applying one entry (for the self-check)."""
    if "element" in entry:
        return base.replace("</section>", entry["element"] + "</section>", 1)
    if "head" in entry:
        return base.replace(entry["base"], entry["head"], 1)
    out = base
    for k in range(n):
        marker = f' data-roving-item="{entry["roving"]}-{k}"'
        out = out.replace(f'<button class="b{k}">', f'<button class="b{k}"{"" if k == 0 else " tabindex=" + chr(34) + "-1" + chr(34)}{marker}>', 1)
    return out


def self_check():
    """The judge must accept each named difference where it is allowed, and nothing else."""
    # every head/base entry needs its BASE text in the synthetic base for its change to be applied to
    base = ('<main><section><p>or add one above.</p></section>' + "".join(e["base"] for e in EXPECTED if "head" in e) +
            '<h3 class="_sectionTitle_">Reviews</h3>'
            '<div role="toolbar"><button class="b0">U</button><button class="b1">B</button>'
            '<button class="b2">I</button><button class="b3">L</button></div><div>next</div></main>')
    cases = []
    for e in EXPECTED:
        need = e["needs"] or "some_other_flag"
        flags = {"caps on": {need: True}, "caps off": {need: False}, "absent": {}}
        head = _apply(base, e)
        assert head != base, e["name"]
        on, off = f"{e['surface']} | caps on | fresh member", f"{e['surface']} | caps off | fresh member"
        other = "notes list" if e["surface"] != "notes list" else "help"
        n = e["name"]
        always = e["needs"] is None
        cases += [
            (f"[{n}] the named change where it is allowed: accepted", on, head, base, flags, "expected"),
            (f"[{n}] identical output", on, base, base, flags, "identical"),
            (f"[{n}] the capability OFF in the flag set", off, head, base, flags, "expected" if always else "differs"),
            (f"[{n}] the flag set does not name the capability", f"{e['surface']} | absent | x", head, base, flags,
             "expected" if always else "differs"),
            (f"[{n}] a flag set the capture did not write", f"{e['surface']} | unknown | x", head, base, flags, "differs"),
            (f"[{n}] the same change on another surface", f"{other} | caps on | fresh member", head, base, flags, "differs"),
            (f"[{n}] any other difference", on, base.replace("next", "next!"), base, flags, "differs"),
            (f"[{n}] the named change PLUS another difference", on, head.replace("next", "next!"), base, flags, "differs"),
            (f"[{n}] the change REVERSED (HEAD lacks what BASE has)", on, base, head, flags, "differs"),
            (f"[{n}] a case name the tool cannot parse", e["surface"], head, base, flags, "differs"),
        ]
        if "element" in e:
            tag_end = e["element"].index(">")
            cases += [
                (f"[{n}] the element twice", on, head.replace(e["element"], e["element"] * 2), base, flags, "differs"),
                (f"[{n}] the element with its text changed", on,
                 head.replace(e["element"], e["element"][:tag_end + 1] + "x" + e["element"][tag_end + 1:]), base, flags, "differs"),
                (f"[{n}] the element with one attribute changed", on,
                 head.replace(e["element"], e["element"].replace('class="', 'class="x ', 1)), base, flags, "differs"),
            ]
        elif "head" in e:
            cases += [
                (f"[{n}] the tag with one more attribute", on,
                 head.replace(e["head"], e["head"][:e["head"].index(">")] + ' hidden="">' + e["head"][e["head"].index(">") + 1:]), base, flags, "differs"),
                (f"[{n}] the tag changed on TWO elements", on,
                 head + e["head"] + "</h3>", base + e["base"] + "</h3>", flags, "differs"),
            ]
        else:
            m = lambda k: f' data-roving-item="{e["roving"]}-{k}"'
            cases += [
                (f"[{n}] a GAP in the numbering", on, head.replace(m(2), m(9)), base, flags, "differs"),
                (f"[{n}] the first control is not the Tab stop", on, head.replace(m(0), ' tabindex="-1"' + m(0)), base, flags, "differs"),
                (f"[{n}] a later control left as a Tab stop", on, head.replace(' tabindex="-1"' + m(2), m(2)), base, flags, "differs"),
                (f"[{n}] one marker used twice", on, head.replace(m(3), m(1)), base, flags, "differs"),
                (f"[{n}] a single marked control is not a run", on, _apply(base, e, n=1), base, flags, "differs"),
                (f"[{n}] tabindex -1 on something outside the run", on,
                 head.replace("<div>next</div>", '<div tabindex="-1">next</div>'), base, flags, "differs"),
            ]
    home = [e for e in EXPECTED if e["surface"] == "notebook home"]
    if len(home) >= 2:
        both = base
        for e in home:
            both = _apply(both, e)
        case = "notebook home | set | fresh member"
        capped = [e for e in home if e["needs"]]          # the always-on entries need no capability
        all_on = {"set": {e["needs"]: True for e in capped}}
        cases.append(("every Notebook Home change together, every capability on: accepted", case, both, base, all_on, "expected"))
        cases.append(("the same, plus another difference", case, both.replace("next", "next!"), base, all_on, "differs"))
        for e in capped:
            one_off = {"set": {**all_on["set"], e["needs"]: False}}
            # an entry sharing that capability goes off with it; the rest stay on, so it must differ
            cases.append((f"every Notebook Home change together, {e['needs']} off", case, both, base, one_off, "differs"))
    bad = []
    for label, case, h, b, flags, want in cases:
        got = judge(case, h, b, flags)[0]
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
    unsettled = sorted(set(a.pop("__unsettled__", []) + b.pop("__unsettled__", [])))
    if unsettled:
        raise SystemExit("these captures never settled, so the run is not evidence:\n  " + "\n  ".join(unsettled))
    digest = lambda d: __import__("hashlib").sha256(
        json.dumps(d, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]
    if not isinstance(flagsets, dict) or not flagsets:
        raise SystemExit("the capture wrote no flag sets; an expected difference cannot be judged")
    verdicts = {k: judge(k, a[k], b.get(k, ""), flagsets) for k in a}
    same = [k for k in a if verdicts[k][0] == "identical"]
    explained = [k for k in a if verdicts[k][0] == "expected"]
    differ = [k for k in a if verdicts[k][0] == "differs"]
    lines = [f"== flags-off render parity{' (MUTATION: wave-14 switch removed from tourLive)' if mutate else ''}",
             f"base {BASE} vs HEAD {git('rev-parse', '--short=10', 'HEAD').decode().strip()}",
             f"pass A {ta}", f"pass B {tb}",
             f"capture fingerprints (same tree, same fingerprints): A {digest(a)} | B {digest(b)}",
             f"swapped {len(saved)} source files to the base blob; restored, git status unchanged",
             f"{len(same)} identical | {len(explained)} differ only by a named expected difference | "
             f"{len(differ)} differ ({len(a)} cases)"]
    for k in explained:
        lines.append(f"  EXPECTED: {k}\n    explained exactly by: {', '.join(verdicts[k][1])}")
    for e in EXPECTED if explained else ():
        what = e.get("element") or (f"{e['head']}  (was {e['base']})" if "head" in e
                                    else f"the counted run {e['roving']}-0, {e['roving']}-1, ...")
        where = f"with {e['needs']} on" if e["needs"] else "in every flag set (always on)"
        lines.append(f"  NAMED: {e['name']} | commit {e['commit']} | accepted {e['accepted']} | only on "
                     f"'{e['surface']}' {where}\n    change: {what}\n    reason: {e['reason']}")
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
