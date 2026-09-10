# RESUME — joystick hub Increment 3

**Created 2026-09-10.** Increment 2 is merged and deployed; this file carries its open items
forward. ⚠️ Increment 2's resume lived at `C:\tools\hub-devicetests\RESUME-inc2.md`, outside the repo and
therefore uncommittable. This one lives in the repo so it can be committed, as ruled.

## State

| | |
|---|---|
| Branch | `feat/joystick-increment-3`, from master `febe8ee67` |
| Worktree | `C:\Users\Patrick\uct-worktrees\joystick-inc3` |
| Deployed | `febe8ee67` — Increment 2, live since 2026-09-10T06:21:42Z |
| Also open | `fix/deploy-watch-probe` @ `245102b1c`, pushed, unmerged — rides the next intentional deploy, **outside 09:00–16:00 ET** |

## Rulings this increment is built under

- **R-A** — Increment 3 = **3.7 Notebook** + **#1 hub-analytics emit** + **#2 auto-hide while a
  text input is focused**. #1 and #2 are spec-mandated (§8), under an hour each, currently just
  missing, and ride along.
- **R-B** — The real-glass bugs are **not blocking**. Filed in `requests.md` verbatim when they
  arrive.
- **R-C** — Calendar is a **§6 omission, not a §7 error**. §7 declares the mode and C3 has the
  section with three registry actions, so the mode exists; the build order simply did not list it.
  §6 is amended to add calendar after 3.8 Home. **It stays dark until its own increment.**
- **R-D** — Phase 4 settings UI (#11) is **deferred, not rejected**. If the filed bugs turn out to
  be gesture-timing, #11 becomes Increment 4 and the bugs become tuning defaults rather than
  defects.

## Real-glass, Increment 2

> Real-glass D4/D1 performed; owner reports the hub works on glass but is buggy; bug details
> pending; **no write-without-sheet observed or reported.**

## ⛔ RULE 12 — PATHS THIS BRANCH MUST NOT TOUCH

The notebook workstream is in a **2026-09-10 → 2026-09-17 observation window** and pushes to master
many times a day. This branch integrates through the URL contract **as it exists today**.

    app/src/pages/journal-2-0/**
    app/src/pages/journal-2-0/tabs/NotebookTab.jsx

If the seam needs a change on the notebook side: **STOP and report.** The owner takes it to that
workstream. A rail fails the branch if any file under those paths appears in the diff against
master.

## ⛔ RULE 13 — REBASE EARLY AND OFTEN

Master moves faster than one gate cycle (Increment 2 cost four rebases and two lost laps). Rebase
daily, or whenever more than five behind — not just at merge. One backup ref per rebase,
`refs/backup/pre-rebase-inc3[-N]`.

## Open items carried forward from Increment 2

- **real-glass bug details** from the owner's run (R-B) — to be filed verbatim in `requests.md`
- **deferred docs/manifest push to master** — the Increment 2 master-gate manifest is not in the
  tree. Every master push rebuilds web, docs-only included: `f321e5e7b` changed three files under
  `docs/` and web deployed on it (SUCCESS 2026-09-10T04:54:32Z).
- **merge `fix/deploy-watch-probe`** (`245102b1c`, pushed) — next intentional deploy, outside
  09:00–16:00 ET
- R-13 — `scan.scans` ships ABSENT (Screener shell has no open seam)
- R-15 — the Screener cursor is invisible (no row painted `data-hub-cursor`)
- transitive-dataflow rail
- `HubActionsButton` haptic on the WCAG path
- `scan.flag` §C2 exception
- CI device job
- iOS visual escalation (iOS Safari exposes no `navigator.vibrate`)
- `require.main` guard on the device runner (requiring `tests/run.js` RUNS the matrix)
- BrowserStack Automate quota (Live != Automate)
- server-side validation of preference keys — `POST /api/auth/preferences` accepts any
  `{key, value}`, so B6 is an exposure default, not a security boundary
- D-35 / R-14 — `HubConfirmPayload.fields` unreachable; confirm actions have no steppers
- **Increment 3 core remainder, NOT in this increment:** 3.5 Chart (needs a 3.5a scout), 3.6
  Catalysts (needs a 3.6a scout — the Wave 0 state is gone), 3.8 Home scrub, 3.9 Flow verify,
  Calendar (per R-C), Phase 4 settings UI (per R-D)

## The gate

⛔ Never hand-roll the shard loop — `python scripts/gate_shards.py` is committed and its own rails
exist. The baseline is `docs/plans/joystick/gate-baseline.json`; load-sensitive names are re-run
ALONE before classifying, and a timeout is never banked.

## DECISIONS — R-auto-N (autonomy charter)

- **R-auto-1 — §8's "the registry's `fire()` path" reads as `HubRoot.runAction`.**
  Taken: place the one marker at `HubRoot.jsx:108`. Rejected: inventing a `fire()` in
  `registry.js` to match the sentence. Why: `registry.js` is data plus a validator and has never
  had a `fire()`; dispatch has always lived in `runAction`, which is the one point BOTH doors (a
  gesture, and the Peek sheet) pass through exactly once. Code over stale wording; the plan's
  sentence is corrected in the docs commit.

- **R-auto-2 — `contenteditable` is detected by property AND attribute.**
  Taken: `isContentEditable || closest('[contenteditable]')` with a `!== 'false'` check. Rejected:
  the property alone. Why: `isContentEditable` is the correct question in a browser because it
  accounts for inherited editability, but **jsdom does not implement it**, so a property-only check
  reported `false` for the Notebook's own editor in the only environment the suite ever runs in.

- **R-auto-3 — the rule-12 rail checks the committed diff AND the working tree.**
  Taken: both. Rejected: committed-only (the literal reading of the ruling). Why: committed-only
  catches a violation at review time rather than when it is made, and it also makes the rail's own
  mutation proof require a throwaway commit to unwind.

- **R-auto-4 — the analytics rail excludes test files and assembles its own literal.**
  Taken: both. Rejected: a plain scan. Why: the first version found THREE markers — the real one
  plus its own docstring and its own constant — and failed on its own text
  (`lesson_a_search_over_sources_counts_the_searcher`).

- **R-auto-5 — `useKeyboardVisible` stays alongside the new focus hook.**
  Taken: OR them. Rejected: replacing the viewport heuristic. Why: a soft keyboard can cover the pad
  when focus is somewhere the focus hook cannot see (a cross-origin iframe); and the focus hook
  covers the three cases the viewport hook structurally cannot (no `visualViewport`, a hardware
  keyboard, a contenteditable that raises nothing). Neither substitutes for the other.

- **R-auto-6 — B10/B11 STOPPED under H1.** See the hard stop below. No decision taken; the work
  cannot proceed as ruled without a change on the notebook side.

## ⛔ HARD STOP H1 — raised 2026-09-10, B10

The Notebook cannot be wired as ruled without editing a rule-12 path. Two independent blockers:

1. **Mount point.** Every section controller is page-mounted — `wireSection` from
   `pages/MorningWire.jsx`, `breadthSection` from `pages/Breadth.jsx`, `screenerSection` from
   `pages/screener/shell/ScannerShell.jsx`, `journalSection` from
   `pages/journal-2-0/tabs/OpenPositionsTab.jsx`. The Notebook's page is `NotebookTab.jsx`, which
   rule 12 forbids. A hub-side mount avoids that file, but does not solve (2).

2. **No note identity in the DOM.** `NoteCard.jsx` renders `<div className={styles.card}>` with no
   `data-note-id`, no `href`, and no test id. The only per-note identity is `key={n.id}` at
   `NotebookTab.jsx:848` — a React key, which does not render. The one `data-note-id` in the
   codebase (`lib/noteLinkNode.jsx:36-37`) is TipTap's inline note-LINK node inside a note body,
   not a grid card.

   So the hub can PAINT a cursor over cards (`paintCursor`, the Wire precedent) but cannot learn
   which note a card is — and Q1/Q2 rule that selection writes `?note=<id>` through
   `applyTargetToParams`. `useHubCursor` also REQUIRES an explicit identity key.

**Smallest notebook-side change that unblocks it:** one attribute on the card root —
`data-note-id={note.id}` in `NoteCard.jsx`. That is additive, renders nothing visible, and gives
the hub both the identity and the selector Q4's rail needs.
