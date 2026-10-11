# Notebook P0: Discoverability + Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the possible single-tab fork (P0.0) and make every live Notebook feature findable: zero HIDDEN features at 1280 and 390. Each HARD door is fixed or carries a written reason.

**Architecture:** P0.0 is an investigation. Build a reproducer, read the wire, fix at the cause and add a rail. P0.1–P0.17 change only the surfaces that already host each feature: Research Home, the note editor, the chart embed, the notes list, onboarding, Settings cards and the trade page. No schema change, no new endpoint and no new dependency. The exit bar is a committed, re-runnable door audit plus the c2 walk at 0 FAIL.

**Tech Stack:** React + Vite (vitest + Testing Library), TipTap 2, FastAPI, Python Playwright walk tools.

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md` §P0 (approved 2026-10-11, `57cd9d8e1a`). The audit it rests on is `docs/notebook/discoverability-audit-2026-10-11.md` (branch `notebook-discover-1011`, `28eede4fbb`).

**Base:** `origin/master` `f2b9ba895d`. Implementation branch: `notebook-p0` (a `notebook-*` name, so `hub/rule12Paths.test.js` scopes it correctly).

## Global Constraints

- Icons are `UIcon` names only. No emoji in UI.
- Breakpoints: only `@media (max-width: 640px)` (phone) and `@media (max-width: 1024px)` (touch). In JS use `useBreakpoint` hooks, and only for click-time decisions; layout goes in CSS (CLAUDE.md "useMediaQuery is stale at first paint").
- Touch targets are ≥ `var(--tap-min)` (44 px) at ≤1024 px (`styles/tapFloor.test.js`).
- Every new `data-tour="x"` literal appears exactly once in its file (`tourAnchors.test.js`).
- Member-facing copy is plain English with no jargon. Tours number the steps they show (P6).
- No new npm or pip dependency. No new Railway variable. No new endpoint. No schema change.
- Feature visibility follows the existing flags. A door for a feature appears only when that feature's flag (`notebookFlag(...)`) is on. A door that would 404 or open nothing is a defect.
- Tests: `cd app && npx vitest run <explicit files>`. Never verify through a pipe or a trailing `echo`. A run without a totals line is not a run. `-t` is a regex: a filter that matches nothing exits 0.
- Backend pytest is always scoped by named files.
- Commits: `git commit -F - -- <paths> <<'MSG'` (pathspec on the commit). Trailers:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01Q6G9ghokX26jNrDBvxcZjP`.
- Run the suite in its own tool call and read the totals before committing.
- Write files with the line endings git stores (`python tools/check_repo_hygiene.py` before each commit).
- At most 3 agents. Never touch `C:\data`. Sandbox data dirs are passed from PowerShell or single-quoted.
- Rollback for every P0 change is a revert of its commit. P0 corrects live surfaces and adds no switch. This deviates from spec §2's "each phase ships dark": the corrections expose features that are already armed, so a switch would only hide fixes. It is stated here so the owner sees it.

## Review Focus

Five conditions no task's main tests exercise, most likely to bite first. Each line names the owning task's test that pins it.

1. **A member with notes and every optional gate off** (voice, onboarding, setups board, AI actions) must see a New-note menu holding only working items: Blank, From an outline, Today's note. No item may open nothing. Pinned in Task 2, `newNoteMenu.gatesOff`.
2. **A 390 px phone editor** must keep every always-visible control inside the viewport (the mic was clipped at x 354–398). Pinned in Task 6, by the CSS rule test plus walk step `discover.phone-toolbar-inside` (Task 15).
3. **The Notices box when `/api/alerts` or `/api/voice/insights` fails (401, 500 or network)** must leave the home exactly as it was: no error box, no spinner forever. Pinned in Task 4, `noticesBox.fetchFails`.
4. **Add the sample notebook when it is already present (409)** must show the plain refusal sentence and create nothing. Pinned in Task 11, `learnMenu.sample409`.
5. **Home search seeded with text, then Escape in the sidebar** must clear the sidebar search and show the home search box again. Pinned in Task 12, `homeSearch.escapeRestores`.

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `tools/notebook_fork_repro.py` (new) | Reproduce the single-tab fork and capture request/response pairs | 1 |
| `B/NewNoteMenu.jsx` + `.module.css` (new) | "+ New note" split button on Research Home | 2 |
| `J/tabs/NotebookTab.jsx` | Lift the New-note Sheet and VoiceNoteDialog out of the list branch; pass handlers; view select; search seed | 2, 10, 12 |
| `B/ResearchHome.jsx` + `.module.css` | Mount the New-note menu, the Notices box, the Active setups box, one Ask section and in-place search | 2, 4, 5, 7, 12 |
| `B/WidgetEmbedView.jsx` + `.module.css` | Chart toolbar: Plan and Replay with words, the rest under "More" | 3 |
| `B/NoticesBox.jsx` + `lib/notices.js` (new) | Resurfaced notes, task reminders and fill alerts on home | 4 |
| `api/services/journal_two/entry_context.py` | Bell message stops naming the Notebook | 4 |
| `B/SetupsBoard.jsx` | Back link, and example-aware empty copy | 5 |
| `B/NoteEditorPage.jsx` + `.module.css` | Phone toolbar: the "+" insert menu, a wrapping Format grid, mic inside | 6 |
| `B/AiActionsPanel.jsx` | Label used inside the one Ask section | 7 |
| `B/CaptureDoors.jsx`, `B/ShortcutHowTo.jsx` (new) | The capture doors, plus a member-facing Shortcut how-to | 8 |
| `B/import/ImportWizard.jsx`, `B/onboarding/capabilityList.js`, `B/onboarding/CapabilityPreview.jsx` | Host the capture doors; voice notes appear in the preview | 8, 9 |
| `J/components/PersonalApiCard.jsx` | Renamed title | 8 |
| `J/lib/dateSuggest.js` (new), `J/lib/tiptap*` registration, `B/SlashMenu.jsx` | `@` date suggestions, due-date slash items | 9 |
| `B/onboarding/tours/b1VoiceNotes.steps.js` (new), `tours/b1Core.js` | Voice notes tour | 10 |
| `J/lib/savedViewModes.js` | Short labels for the view switcher | 10 |
| `B/onboarding/LearnMenu.jsx`, `learnTours.js`, `.module.css` | Groups, the phone sheet, the sample item | 11 |
| `B/onboarding/tourStart.js`, `GenericTourEngine.jsx` | Chart tours no longer dead-end | 11 |
| `B/FolderSidebar.jsx` | Search seed and mode callback | 12 |
| `B/PropertiesSection.jsx` | "Add a formula" first | 13 |
| `J/components/trade/TradeDetailPage.jsx` | Plan-grade card moved up | 13 |
| `tools/notebook_door_audit.py` (new), `tools/notebook_fin_walk_features.py` | Exit-bar door audit and walk steps | 14, 15 |

`J` = `app/src/pages/journal-2-0`, `B` = `J/components/notebook`.

---

### Task 0: Worktree

**Files:** none (environment)

- [ ] **Step 1: Create the worktree from master and mark ownership**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-presets-spec
git fetch origin master -q
git worktree add ../notebook-p0 -b notebook-p0 origin/master
printf 'session: 61625d99\ncreated: 2026-10-11\n' > ../notebook-p0/.uct-session-owner
```

- [ ] **Step 2: Junction an installed node_modules (PowerShell tool)**

```powershell
New-Item -ItemType Junction -Path C:\Users\Patrick\uct-worktrees\notebook-p0\app\node_modules -Target C:\Users\Patrick\uct-worktrees\notebook-k\app\node_modules
Get-Item C:\Users\Patrick\uct-worktrees\notebook-p0\app\node_modules -Force | Select-Object LinkType, Target
```

Expected: `LinkType Junction` with a `Target` under `notebook-k`. At removal, use `cmd /c rmdir` only, never a recursive delete.

- [ ] **Step 3: Baseline the files this plan touches**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p0/app
npx vitest run src/pages/journal-2-0/components/notebook/ResearchHome.homeTop.test.jsx src/pages/journal-2-0/components/notebook/WidgetEmbedView.toolbarOneStop.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.phoneFormat.test.jsx src/pages/journal-2-0/components/notebook/onboarding/LearnMenu.test.jsx src/pages/journal-2-0/tabs/NotebookTab.test.jsx > /tmp/p0-baseline.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Read the `Tests` totals line in `/tmp/p0-baseline.log`. Record any pre-existing red, named, in the PR body. Pre-existing reds are not this plan's to fix.

---

### Task 1: P0.0: reproduce, trace and fix the single-tab fork

The audit's member 4 got `My trading rules (conflicted copy)` in ONE tab. The note was created through the API about 40 minutes earlier, then the script typed `/checklist` plus text and navigated to the list about 1.5 s later. The soak also holds one unattributed organic fork on 2026-09-27. **The fix code cannot be written before the trace.** This task delivers a reproducer, an evidence directory, a named cause (R-CITE), a fix and a rail. Use `superpowers:systematic-debugging` for the investigation steps.

**Files:**
- Create: `tools/notebook_fork_repro.py`
- Create: `docs/notebook/evidence/fork-repro-<UTC stamp>/` (raw rings, committed BEFORE interpretation, per R-RAW)
- Modify: unknown until Step 5 (candidates below)
- Test: a new rail beside the file the fix lands in

**Interfaces:**
- Consumes: `tools/notebook_fin_walk.py` helpers `member(browser, admin_req, base, tag, vp)`, `new_ctx`, `goto`. Also `notebook_perf_harness` as `h` (`ADMIN_EMAIL`, `ADMIN_PW`, `_signup_or_login`, `_dismiss_intro`).
- Produces: `evidence/fork-repro-*/run.json` with `{"forked": bool, "pairs": [...], "notes_after": [...]}`.

- [ ] **Step 1: Write the reproducer**

```python
"""Reproduce the single-tab '(conflicted copy)' fork seen by the 2026-10-11 discoverability audit.

Shape (from the audit, member 4): a note made through the notes API, opened in ONE tab ~40 min
later (here: immediately, then again after --age seconds), `/checklist` + text typed, and a
navigation to the notes list ~1.5 s after the last keystroke. Every request AND response on
/api/j2/notes* is captured with status, revision fields and body (CLAUDE.md: requests without
responses cannot establish a causal chain). Raw evidence is written BEFORE any summary (R-RAW).

Precondition: a sandbox from this tree is serving, e.g.
    python tools/notebook_fin_walk.py --config c2 --data-root '<dir>' --port 8132 --out '<dir>' --serve-only
Usage:
    python tools/notebook_fork_repro.py --base http://127.0.0.1:8132 --out docs/notebook/evidence --runs 10 --nav-ms 1500
Exit: 0 no fork in any run, 1 a fork reproduced, 2 INCONCLUSIVE (setup failed / nothing measured).
"""
from __future__ import annotations

import argparse, json, re, sys, time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import notebook_fin_walk as C  # noqa: E402
import notebook_perf_harness as h  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

NOTE_RE = re.compile(r"/api/j2/notes(/|\?|$)")


def capture(ctx, pairs: list):
    def on_response(r):
        try:
            if not NOTE_RE.search(r.url):
                return
            req = r.request
            row = {"t": round(time.time(), 3), "method": req.method,
                   "url": re.sub(r"^https?://[^/]+", "", r.url)[:200], "status": r.status,
                   "request": (req.post_data or "")[:4000]}
            try:
                row["response"] = (r.text() or "")[:4000]
            except Exception as e:  # noqa: BLE001
                row["response"] = f"(unreadable: {type(e).__name__})"  # NOT empty: unknown != none
            pairs.append(row)
        except Exception:  # noqa: BLE001 -- a handler must never raise into the run
            pass
    ctx.on("response", on_response)


def one_run(browser, admin, base: str, nav_ms: int, idx: int) -> dict:
    ctx, email, _me = C.member(browser, admin.request, base, f"fk{idx}", "1280")
    pairs: list = []
    capture(ctx, pairs)
    r = ctx.request.post(base + "/api/j2/notes", data={"title": "My trading rules",
                         "body": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Rule one."}]}]}})
    note = r.json()
    nid = note.get("id")
    pg = ctx.new_page()
    C.goto(pg, base, f"/journal/notebook?note={nid}", wait=".ProseMirror")
    ed = pg.locator(".ProseMirror").first
    ed.click()
    pg.keyboard.press("Control+End")
    pg.keyboard.press("Enter")
    pg.keyboard.type("/checklist", delay=40)
    pg.keyboard.press("Enter")
    pg.keyboard.type("Never move a stop down", delay=30)
    pg.wait_for_timeout(nav_ms)
    pg.get_by_role("link", name=re.compile("All notes|Back to notes", re.I)).first.click()
    pg.wait_for_timeout(8000)  # let any outbox drain land
    notes = ctx.request.get(base + "/api/j2/notes?limit=500").json()
    rows = notes.get("notes") or notes.get("items") or []
    forked = any("(conflicted copy)" in (n.get("title") or "") for n in rows)
    out = {"run": idx, "email_domain": email.split("@")[-1], "note_id": nid, "nav_ms": nav_ms,
           "forked": forked, "notes_after": [{"id": n.get("id"), "title": n.get("title")} for n in rows],
           "pairs": pairs}
    ctx.close()
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs", type=int, default=10)
    ap.add_argument("--nav-ms", type=int, default=1500)
    a = ap.parse_args(argv)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(a.out) / f"fork-repro-{stamp}"
    out.mkdir(parents=True, exist_ok=False)
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = browser.new_context()
        h._signup_or_login(admin.request, a.base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        for i in range(a.runs):
            try:
                res = one_run(browser, admin, a.base, a.nav_ms, i)
            except Exception as e:  # noqa: BLE001
                res = {"run": i, "error": f"{type(e).__name__}: {str(e)[:400]}"}
            results.append(res)
            (out / f"run-{i:02d}.json").write_text(json.dumps(res, indent=1), encoding="utf-8", newline="\n")
        browser.close()
    measured = [r for r in results if "forked" in r]
    forks = [r["run"] for r in measured if r["forked"]]
    summary = {"runs": a.runs, "measured": len(measured), "forked_runs": forks, "nav_ms": a.nav_ms}
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8", newline="\n")
    print(json.dumps(summary))
    if not measured:
        return 2
    return 1 if forks else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Boot the c2 sandbox (PowerShell tool) and run the reproducer at three navigation delays**

```powershell
python tools/notebook_fin_walk.py --config c2 --data-root 'C:\Users\Patrick\AppData\Local\Temp\nb-p0-fork' --port 8132 --out 'C:\Users\Patrick\AppData\Local\Temp\nb-p0-fork-out' --serve-only
```

Then, in another call, once `SERVING c2` is printed:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p0
for ms in 300 1500 3000; do python tools/notebook_fork_repro.py --base http://127.0.0.1:8132 --out docs/notebook/evidence --runs 10 --nav-ms $ms; echo "nav $ms exit $?"; done
```

Expected: each run prints its summary JSON. Exit 1 means a fork reproduced. If no delay forks in 30 runs, add a variant that waits `--age 2400` seconds between the API create and the open (the audit's 40-minute age), and record that the short-age shape does not reproduce.

- [ ] **Step 3: Commit the raw evidence before reading it (R-RAW)**

```bash
git add docs/notebook/evidence/fork-repro-* tools/notebook_fork_repro.py
git commit -F - -- docs/notebook/evidence tools/notebook_fork_repro.py <<'MSG'
evidence(notebook): P0.0 single-tab fork reproducer and raw rings

Raw request/response pairs committed before interpretation (R-RAW).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6G9ghokX26jNrDBvxcZjP
MSG
```

- [ ] **Step 4: Read the forked run's pairs and name the writer**

For each forked run, list every PUT to `/api/j2/notes/<id>` in order with `baseUpdatedAt` (request), status and the response's `updated_at`. Answer three questions, each citing `run-NN.json` entry indices:

1. Which request got the 409?
2. Was its `baseUpdatedAt` a revision this tab itself had landed earlier (the response of an earlier 200 in the same run)?
3. Which door sent it: the editor autosave, the outbox drain after navigation (`lib/offline/outboxDrain.js`), or a metadata door?

Candidates by reading (a census, not a finding, until the wire says so):
- (a) The unmount flush and the outbox drain both sending the same edit, the second one on the pre-flush base.
- (b) `recordLandedRevision` not recording the flush's landed revision before the drain reads it (the guard-2 "not ours" fork, `outboxDrain.js:681`/`:790`).
- (c) A `/checklist` slash transaction producing a save whose base predates a server-side normalisation.

Write the answer into `docs/notebook/fork-p0-trace.md` in the form "`<fn>` at `<file:line>`, from `evidence/fork-repro-<stamp>/run-NN.json` pairs N..M".

- [ ] **Step 5: Write the failing rail at the named writer's layer**

The rail replays the captured sequence as a unit test against the module that owns the decision (`outboxDrain.test.js` style: fake transport answering with the recorded statuses and revisions). Example skeleton for candidate (b), to be adapted to the measured sequence:

```js
// app/src/pages/journal-2-0/lib/offline/singleTabFlushThenDrain.test.js
import { describe, it, expect } from 'vitest'
// import the drain entry point and the in-memory db helpers the sibling tests use
// (copy the setup block from outboxDrain.test.js; do not invent a new harness)

describe('P0.0 — one tab: unmount flush lands, then the drain runs', () => {
  it('does not fork when the 409 base is a revision this tab landed', async () => {
    // replay: PUT#1 200 (rev A->B), unmount flush PUT#2 200 (B->C), drain PUT#3 base=B -> 409
    // expected: the drain recognises C as its own landed revision and removes/rebases, never forks
    // assert: no create call for a '(conflicted copy)' title; outbox empty
    expect(true).toBe(false) // replace with the measured replay; must FAIL on master
  })
})
```

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/offline/singleTabFlushThenDrain.test.js`
Expected: FAIL on master, for the measured reason (read the assertion message).

- [ ] **Step 6: Fix at the cause. One predicate, never a second copy.**

If the fix is a "this revision is ours" check, extend the existing exported predicate the other writers already ask (the `discardsUnsentWork` / `recordLandedRevision` family). Do not write a new copy in a second writer (CLAUDE.md "a guard repeated is a guard unproved").

- [ ] **Step 7: Prove the rail and the fix**

```bash
cd app && npx vitest run src/pages/journal-2-0/lib/offline/singleTabFlushThenDrain.test.js src/pages/journal-2-0/lib/offline/outboxDrain.test.js src/pages/journal-2-0/lib/offline/fix6KeepsTyping.test.js > /tmp/p0-fork.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all PASS. Then mutation-prove it: revert only the fix bytes (capture and restore with sha, never `git checkout`), and confirm the rail goes red. Then re-run the reproducer at the delay that forked: 0 forks in 30 runs.

- [ ] **Step 8: Attribute the 2026-09-27 soak fork (owner-approved read-only query)**

Ask the owner in chat before running anything. Text to send: "P0.0 needs one read-only production query to attribute the 9/27 soak fork: the conflicted-copy note's title, created_at and owner domain, nothing else. OK to run?" Only after an explicit yes, run:

```bash
echo <base64 of the script below> "|" base64 -d "|" /opt/venv/bin/python   # via railway ssh, web service
```

```python
import sqlite3
c = sqlite3.connect("file:/data/auth.db?mode=ro", uri=True)
for r in c.execute("""SELECT n.id, n.created_at, substr(u.email, instr(u.email,'@')+1)
                      FROM j2_notes n JOIN users u ON u.id = n.user_id
                      WHERE n.title LIKE '%(conflicted copy)%' AND n.created_at LIKE '2026-09-27%'"""):
    print(r)
```

Record the result in `uct-q1-observe/soak-dashboard.md` as `- FORK 2026-09-27: ATTRIBUTED — <why>`. The why is either the P0.0 mechanism, with its evidence path, or "not the P0.0 shape" plus what it is.

- [ ] **Step 9: Commit the fix, the rail and the trace doc**

```bash
git commit -F - -- app/src/pages/journal-2-0/lib/offline docs/notebook/fork-p0-trace.md <<'MSG'
fix(notebook): P0.0 single-tab fork — <one line naming the cause>

Cause: <fn> at <file:line>, from evidence/fork-repro-<stamp>/run-NN.json pairs N..M.
Rail: singleTabFlushThenDrain.test.js (red on master, mutation-proved).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6G9ghokX26jNrDBvxcZjP
MSG
```

**Stop condition:** if no run forks after the short and long-age variants (60 runs), do not invent a fix. Record "not reproduced" in `fork-p0-trace.md` with the run counts. Leave the reproducer committed, and continue with Task 2. The soak attribution (Step 8) still runs.

---

### Task 2: P0.1 + P0.10 door + P0.17: "+ New note" on Research Home

The New-note Sheet (`NotebookTab.jsx:2423-2459`) and `VoiceNoteDialog` (`:2461-2468`) are mounted only in the list branch (`isHome ? <ResearchHome…/> : (<>…`, `:2226-2246`). A Home button must not open nothing, so both move out of the branch first.

**Files:**
- Create: `B/NewNoteMenu.jsx`, `B/NewNoteMenu.module.css`, `B/NewNoteMenu.test.jsx`
- Modify: `J/tabs/NotebookTab.jsx:2226-2246, 2423-2468` (lift both, pass new props)
- Modify: `B/ResearchHome.jsx:290-301` (props), `:656-664` (`homeTop`)
- Modify: `B/ResearchHome.module.css` (`.homeHeader` row)
- Test: `B/NewNoteMenu.test.jsx`, `B/ResearchHome.homeTop.test.jsx` (extend), `J/tabs/NotebookTab.test.jsx` (extend)

**Interfaces:**
- Produces: `NewNoteMenu({ onBlank, onFromOutline, onVoice = null, onToday = null })`. A null handler hides its item. `onFromOutline` opens the existing New-note Sheet.
- ResearchHome gains props `onOpenNewNoteSheet = null` and `onStartVoiceNote = null`.
- NotebookTab passes `onOpenNewNoteSheet={() => setPickerOpen(true)}` and `onStartVoiceNote={voiceOn ? () => startVoiceNote('record') : null}`.

- [ ] **Step 1: Failing tests for the menu**

```jsx
// B/NewNoteMenu.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NewNoteMenu from './NewNoteMenu'

describe('NewNoteMenu', () => {
  it('the main button makes a blank note in one press', () => {
    const onBlank = vi.fn()
    render(<NewNoteMenu onBlank={onBlank} onFromOutline={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'New note' }))
    expect(onBlank).toHaveBeenCalledTimes(1)
  })
  it('the menu lists only the doors that work (gatesOff)', () => {
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent.trim())
    expect(items).toEqual(['From an outline'])
  })
  it('voice and today appear when their handlers are given, and each fires', () => {
    const onVoice = vi.fn(); const onToday = vi.fn()
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} onVoice={onVoice} onToday={onToday} />)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent.trim()))
      .toEqual(['From an outline', 'Voice note', "Today's note"])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Voice note' }))
    expect(onVoice).toHaveBeenCalledTimes(1)
  })
  it('Escape closes the menu and returns focus to the caret', () => {
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} />)
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    fireEvent.click(caret)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(caret)
  })
})
```

Run: `cd app && npx vitest run src/pages/journal-2-0/components/notebook/NewNoteMenu.test.jsx`
Expected: FAIL, because the module does not exist.

- [ ] **Step 2: Implement `NewNoteMenu.jsx`**

```jsx
// B/NewNoteMenu.jsx — Research Home's create door (spec P0.1). One press makes a blank note;
// the caret lists the other ways in. An item appears only when its handler exists, so a gate
// that is off leaves no door that opens nothing (plan Review Focus 1).
import { useRef, useState, useEffect } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './NewNoteMenu.module.css'

export default function NewNoteMenu({ onBlank, onFromOutline, onVoice = null, onToday = null }) {
  const [open, setOpen] = useState(false)
  const caretRef = useRef(null)
  const menuRef = useRef(null)
  const items = [
    { label: 'From an outline', run: onFromOutline, icon: 'template' },
    onVoice && { label: 'Voice note', run: onVoice, icon: 'mic', tour: 'new-note-voice' },
    onToday && { label: "Today's note", run: onToday, icon: 'sun' },
  ].filter(Boolean)

  useEffect(() => {
    if (!open) return undefined
    menuRef.current?.querySelector('[role="menuitem"]')?.focus()
    const away = (e) => {
      if (!menuRef.current?.contains(e.target) && !caretRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const close = () => { setOpen(false); caretRef.current?.focus() }
  const onMenuKey = (e) => {
    const list = [...menuRef.current.querySelectorAll('[role="menuitem"]')]
    const i = list.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
  }

  return (
    <div className={styles.split} data-tour="new-note-home">
      <button type="button" className={`btn btn-primary ${styles.main}`} onClick={onBlank}>
        <UIcon name="plus" size={14} gold={false} /> New note
      </button>
      <button ref={caretRef} type="button" className={`btn btn-primary ${styles.caret}`}
        aria-haspopup="menu" aria-expanded={open} aria-label="More ways to start a note"
        onClick={() => setOpen((o) => !o)}>
        <UIcon name="chevronDown" size={12} gold={false} />
      </button>
      {open && (
        <div ref={menuRef} className={styles.menu} role="menu" aria-label="Start a note" onKeyDown={onMenuKey}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={styles.item}
              data-tour={it.tour} onClick={() => { setOpen(false); it.run() }}>
              <UIcon name={it.icon} size={14} gold={false} /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

Check that the icon names exist in `components/ui/UIcon.jsx`'s registry (`plus`, `chevronDown`, `template`, `mic`, `sun`). Swap in the registry's real names for any that are missing. Never add an emoji.

- [ ] **Step 3: CSS**

```css
/* B/NewNoteMenu.module.css */
.split { position: relative; display: inline-flex; }
.main { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.caret { border-top-left-radius: 0; border-bottom-left-radius: 0; padding-inline: 8px;
         border-left: 1px solid var(--color-border); }
.menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 30; min-width: 200px;
        display: flex; flex-direction: column; padding: 4px; background: var(--color-surface);
        border: 1px solid var(--color-border); border-radius: 8px; }
.item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; text-align: left;
        background: none; border: 0; color: var(--color-text); border-radius: 6px; }
.item:hover, .item:focus-visible { background: var(--color-surface-2); }
@media (max-width: 1024px) {
  .main, .caret, .item { min-height: var(--tap-min); }
  .caret { min-width: var(--tap-min); }
}
```

Every `var(--…)` used must exist in `app/src/styles/tokens.css`. An undefined variable is a silent no-op (`styles/tokens.reachable.test.js`). Replace any that are missing with the tokens the sibling `ResearchHome.module.css` uses.

- [ ] **Step 4: Run the menu tests**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/notebook/NewNoteMenu.test.jsx`
Expected: 4 PASS.

- [ ] **Step 5: Failing homeTop test, extending `ResearchHome.homeTop.test.jsx`**

Add these cases, using the file's existing render helper and hook mock:

```jsx
it('a member with notes sees New note beside search and Learn', () => {
  renderHome({ hasAnyNotes: true, onCreateNote: vi.fn(), onOpenNewNoteSheet: vi.fn() })
  const header = document.querySelector('[class*="homeHeader"]')
  expect(within(header).getByRole('button', { name: 'New note' })).toBeTruthy()
})
it('a brand-new member does not get a second create button (the welcome has one)', () => {
  renderHome({ hasAnyNotes: false, onCreateNote: vi.fn(), onOpenNewNoteSheet: vi.fn() })
  const header = document.querySelector('[class*="homeHeader"]')
  expect(header ? within(header).queryByRole('button', { name: 'New note' }) : null).toBeNull()
})
```

Run: `cd app && npx vitest run src/pages/journal-2-0/components/notebook/ResearchHome.homeTop.test.jsx`
Expected: the first new case FAILs.

- [ ] **Step 6: Mount it in `homeTop` (`ResearchHome.jsx:656-664`) and accept the props (`:290-301`)**

```jsx
export default function ResearchHome({
  onOpenNote, onCreateNote, onCreateThesis, onImport, hasAnyNotes,
  blockedNoteIds = null, titleOf = () => null,
  onOpenToday = null,
  onOpenNewNoteSheet = null,
  onStartVoiceNote = null,
  skipLinkClassName = '',
}) {
```

```jsx
const homeTop = (
  <div className={styles.homeTop} data-export-exclude>
    <div className={styles.homeHeader}>
      <HomeSearch />
      {hasAnyNotes && onOpenNewNoteSheet && (
        <NewNoteMenu onBlank={onCreateNote} onFromOutline={onOpenNewNoteSheet}
          onVoice={onStartVoiceNote} onToday={onOpenToday} />
      )}
      <LearnMenu />
    </div>
    <RecentNotes opened={opened} edited={Array.isArray(editedNotes) ? editedNotes : []} onOpen={openNote} />
  </div>
)
```

Add `import NewNoteMenu from './NewNoteMenu'`. In `ResearchHome.module.css` `.homeHeader`, make sure the row wraps on phone (`flex-wrap: wrap; gap: 8px`) so the search box takes the full first line at ≤640 px.

- [ ] **Step 7: Lift the Sheet and dialog in NotebookTab and pass the handlers**

Move the `<Sheet open={pickerOpen} title="New note">…</Sheet>` block (`:2423-2459`) and the `{voiceNote && <VoiceNoteDialog …/>}` block (`:2461-2468`) out of the `isHome ? … : (<>…</>)` expression. Place them immediately after the closing parenthesis of that expression, so they render in both branches. Do not change their contents. On the `<ResearchHome` element (`:2229-2244`) add:

```jsx
onOpenNewNoteSheet={() => setPickerOpen(true)}
onStartVoiceNote={voiceOn ? () => startVoiceNote('record') : null}
```

Add to `NotebookTab.test.jsx`, using the file's existing mocks. ResearchHome is mocked there, so assert the props it received:

```jsx
it('Home receives working New-note handlers and the sheet opens from Home', async () => {
  // using the file's ResearchHome mock that records props:
  renderTab({ route: '/journal/notebook' })
  const props = lastResearchHomeProps()
  expect(typeof props.onOpenNewNoteSheet).toBe('function')
  act(() => props.onOpenNewNoteSheet())
  expect(await screen.findByRole('dialog', { name: 'New note' })).toBeTruthy()
})
```

If the file's ResearchHome mock does not already record props, extend that mock (`vi.mock(... ResearchHome ...)`) to push its props into a module-level array. Keep the change inside the test file.

- [ ] **Step 8: P0.17, the phone Folders row stays reachable**

The phone Folders drawer button lives in NotebookTab's header and is not inside `homeTop`. Add a CSS rule test so the New-note row cannot cover or replace it:

```js
// B/ResearchHome.newNotePhone.test.js
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
const css = readFileSync(new URL('./ResearchHome.module.css', import.meta.url), 'utf8')
describe('P0.17 — phone header row', () => {
  it('the home header wraps on phone instead of overflowing', () => {
    const phone = css.split('@media (max-width: 640px)').slice(1).join('')
    expect(/\.homeHeader\s*\{[^}]*flex-wrap:\s*wrap/.test(phone)).toBe(true)
  })
})
```

The walk check `discover.phone-folders-visible` in Task 15 measures the Folders button at 390 px in a real browser.

- [ ] **Step 9: Run everything touched**

```bash
cd app && npx vitest run src/pages/journal-2-0/components/notebook/NewNoteMenu.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.homeTop.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.newNotePhone.test.js src/pages/journal-2-0/components/notebook/ResearchHome.setupsDoor.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.welcome.test.jsx src/pages/journal-2-0/tabs/NotebookTab.test.jsx src/pages/journal-2-0/components/notebook/onboarding/tourAnchors.test.js > /tmp/p0-t2.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

If `tourAnchors.test.js` lives elsewhere, find it with `git ls-files | grep tourAnchors` and use that path. Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/components/notebook/NewNoteMenu.* app/src/pages/journal-2-0/components/notebook/ResearchHome.newNotePhone.test.js
git commit -F - -- app/src/pages/journal-2-0 <<'MSG'
feat(notebook): P0.1 New note on Research Home (blank, outline, voice, today)

The New-note sheet and voice dialog now mount outside the list branch so the Home
door opens them. Items appear only when their handler exists.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6G9ghokX26jNrDBvxcZjP
MSG
```

---

### Task 3: P0.2: chart toolbar, Plan and Replay first, the rest under "More"

Today's toolbar (`WidgetEmbedView.jsx:621-797`) has 14 controls. Kept in the row: timeframe select, **Plan**, **Replay**, Draw/Done, and the touch-only `EmbedBlockActions`. Everything else moves into a "More" `ContextPopover`: Snapshot/Live, Full/Half, Charts ↗, Aftermath, Re-capture, Chart settings, Sync, Freeze, Remove.

**Files:**
- Modify: `B/WidgetEmbedView.jsx:621-797`
- Modify: `B/WidgetEmbedView.module.css` (`.toolbar` :134; add `.moreBtn`, phone one-row rule, `scroll-margin-top`)
- Create: `B/WidgetEmbedView.toolbarMore.test.jsx`
- Modify: `B/WidgetEmbedView.toolbarOneStop.test.jsx`, `B/WidgetEmbedView.chartPlan.test.jsx`, `B/WidgetEmbedView.mobileDrawBar.test.jsx` where they query a moved button (they must open "More" first)

**Interfaces:**
- Consumes: `app/src/components/mobile/ContextPopover.jsx`, the same way `B/EmbedBlockActions.jsx:19,70` uses it. Copy that call's prop shape exactly (anchor, open, onClose, items or children).
- Produces: `data-tour="chart-embed-more"` on the More button.

- [ ] **Step 1: Failing test**

```jsx
// B/WidgetEmbedView.toolbarMore.test.jsx — copy the vi.mock block, IntersectionObserver stub,
// latchNotebookFlags and render(<WidgetEmbedView …/>) setup verbatim from
// WidgetEmbedView.toolbarOneStop.test.jsx (top of file), then:
it('the row holds Plan and Replay with words, and folds the rest into More', async () => {
  await renderChartEmbed()
  const bar = screen.getByRole('toolbar', { name: 'Chart tools' })
  const names = within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent.trim())
  expect(names).toEqual(expect.arrayContaining(['Plan', 'Replay', 'More chart actions']))
  for (const moved of ['Aftermath', 'Re-capture', 'Sync', 'Freeze', 'Chart settings', 'Remove embed'])
    expect(names).not.toContain(moved)
  fireEvent.click(within(bar).getByRole('button', { name: 'More chart actions' }))
  for (const moved of ['Aftermath', 'Re-capture', 'Sync', 'Freeze', 'Chart settings', 'Remove embed'])
    expect(await screen.findByRole('menuitem', { name: moved })).toBeTruthy()
})
it('a moved action still runs from More (Freeze)', async () => {
  const { freezeSpy } = await renderChartEmbed({ spyFreeze: true })
  fireEvent.click(screen.getByRole('button', { name: 'More chart actions' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Freeze' }))
  expect(freezeSpy).toHaveBeenCalled()
})
```

If spying on `freezeChart` is impractical, assert the observable effect the existing tests use for Freeze (find it with `grep -n "Freeze" B/WidgetEmbedView*.test.*`).

Run: `cd app && npx vitest run src/pages/journal-2-0/components/notebook/WidgetEmbedView.toolbarMore.test.jsx`
Expected: FAIL (no "More chart actions" button).

- [ ] **Step 2: Restructure the toolbar JSX**

Inside `{(annotate || toolbarOpen) && (<>…</>)}` keep, in this order: the timeframe select (:661), Draw/Done (:690), **Plan** (:733) and **Replay** (:745). Delete the other buttons from the row and build one list:

```jsx
const moreItems = [
  { label: live ? 'Snapshot' : 'Live', run: toggleLive },
  { label: half ? 'Full width' : 'Half width', run: toggleWidth },
  { label: 'Open in Charts', href: chartsLinkPath(/* same args as :707 */) },
  canPeek && { label: 'Aftermath', run: togglePeek },
  { label: 'Re-capture', run: recapture },
  { label: 'Chart settings', run: openEmbedSettings },
  { label: 'Sync', run: syncFromMyChart },
  { label: 'Freeze', run: freezeChart },
  { label: 'Remove embed', run: () => deleteNode?.(), danger: true },
].filter(Boolean)
```

Keep every guard and the current label/`aria-label` of each original button. If Aftermath is conditional on `canPeek` or `planDoors` today, keep that exact condition. Render after Replay:

```jsx
<button ref={moreRef} type="button" className={`${styles.toolBtn} ${styles.moreBtn}`}
  aria-haspopup="menu" aria-expanded={moreOpen} aria-label="More chart actions"
  data-tour="chart-embed-more" onClick={() => setMoreOpen((o) => !o)}>
  <UIcon name="more" size={14} gold={false} /> More
</button>
{moreOpen && (
  <ContextPopover /* props copied from EmbedBlockActions.jsx:70 */ anchorRef={moreRef}
    onClose={() => setMoreOpen(false)}>
    {moreItems.map((it) => it.href
      ? <a key={it.label} role="menuitem" href={it.href} className={styles.moreItem}>{it.label}</a>
      : <button key={it.label} type="button" role="menuitem" className={styles.moreItem}
          aria-label={it.label} onClick={() => { setMoreOpen(false); it.run() }}>{it.label}</button>)}
  </ContextPopover>
)}
```

Declare `const [moreOpen, setMoreOpen] = useState(false)` and `const moreRef = useRef(null)` beside the other toolbar state. `useToolbarRoving({ prefer: '[data-tour="chart-plan-open"]' })` (:178) stays unchanged. Plan remains the preferred stop.

- [ ] **Step 3: CSS: one row on phone, never under the sticky editor bar**

```css
/* WidgetEmbedView.module.css */
.toolbar { scroll-margin-top: calc(var(--uct-chrome-h, 92px) + 8px); }
.moreItem { display: block; width: 100%; padding: 8px 12px; text-align: left; background: none;
            border: 0; color: var(--color-text); }
@media (max-width: 640px) {
  .toolbar { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
}
@media (max-width: 1024px) { .moreItem { min-height: var(--tap-min); } }
```

`--uct-chrome-h` is the MEASURED sticky-chrome height. A ResizeObserver in NoteEditorPage sets it, and the rails already use it with the same `92px` fallback (`NoteEditorPage.module.css:857-866`). Confirm the observer sets it on an ancestor of the editor content, so the chart embed inherits it: `grep -n "uct-chrome-h" app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx`. If it is set on a sibling instead, move the `setProperty` target up to the common ancestor in this commit. The walk check `discover.chart-plan-clickable` (Task 15) asserts the Plan button is not covered (`elementFromPoint`) after `scrollIntoView`.

- [ ] **Step 4: Update the tests that click moved buttons**

```bash
grep -n "Aftermath\|Re-capture\|'Sync'\|Freeze\|Chart settings\|Remove embed\|Snapshot\|'Live'\|'Half'\|'Full'" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView*.test.*
```

For each hit that clicks a moved control, open "More chart actions" first, then use `getByRole('menuitem', { name })`. A test asserting toolbar *membership* for a moved control changes its expectation to the More list. Do not delete tests.

- [ ] **Step 5: Run**

```bash
cd app && npx vitest run src/pages/journal-2-0/components/notebook/WidgetEmbedView.toolbarMore.test.jsx src/pages/journal-2-0/components/notebook/WidgetEmbedView.toolbarOneStop.test.jsx src/pages/journal-2-0/components/notebook/WidgetEmbedView.chartPlan.test.jsx src/pages/journal-2-0/components/notebook/WidgetEmbedView.mobileDrawBar.test.jsx src/pages/journal-2-0/components/notebook/WidgetEmbedView.toolbarTabReach.test.js src/pages/journal-2-0/components/notebook/WidgetEmbedView.tourReveal.test.js > /tmp/p0-t3.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all PASS.

- [ ] **Step 6: Commit**: `feat(notebook): P0.2 chart toolbar leads with Plan and Replay; the rest under More` (same trailer block, pathspec `app/src/pages/journal-2-0/components/notebook`).

---

### Task 4: P0.4: Notices box on Research Home (owner decision 2: a box, not the bell)

**Files:**
- Create: `J/lib/notices.js`, `J/lib/notices.test.js`
- Create: `B/NoticesBox.jsx`, `B/NoticesBox.module.css`, `B/NoticesBox.test.jsx`
- Modify: `B/ResearchHome.jsx` (mount right after `homeTop` in the returns where `homeTop` renders)
- Modify: `api/services/journal_two/entry_context.py:186` (`BELL_MESSAGE`)
- Test: `tests/test_entry_context_bell_copy.py` (new)

**Interfaces:**
- Consumes: `GET /api/alerts?limit=20`. Rows are `{id, type, severity, title, message, read, data}` (`api/services/alerts.py:add_alert`).
  - Notebook rows: `type === 'notebook_task_reminder'` or `data.source === 'notebook_task_reminder'` (`note_tasks.py:117`, `research_url: "/journal/notebook?view=tasks"`).
  - `data.source === 'notebook_entry_context_new_fill'` (`entry_context.py:184`, url `/journal?j2tab=positions`).
  - Read mark: `POST /api/alerts/{id}/read`.
- Consumes: `GET /api/voice/insights`. Returns `{insights:[{id, kind, headline, body, link, dismissed_at}]}`. Resurfacing kinds are `note_level_touch | note_big_move | note_date_due`. The door only follows links starting `/journal/notebook?note=` (`VoiceInsightsPanel.jsx:31-34`). Dismiss: `POST /api/voice/insights/{id}/dismiss`.
- Produces: `toNotices(alertsBody, insightsBody) -> [{key, kind:'reminder'|'fill'|'resurface', title, line, href, onDone}]` (pure), and `<NoticesBox onOpenHref />`.

- [ ] **Step 1: Capture one real row of each before writing the filter**

In the c2 sandbox (Task 1 Step 2), trigger a task reminder and a fill. Calling `note_tasks.run_task_reminders` and the fill bell from a `--serve-only` child is the fin walk's `resurface`/`child` pattern; reuse that step's code. Then `GET /api/alerts?limit=20` as the member. Paste one row of each kind verbatim into `J/lib/__fixtures__/notices.json`. The filter below matches `type` OR `data.source`. Keep only the branch the real row needs, and record which in a comment.

- [ ] **Step 2: Failing pure test**

```js
// J/lib/notices.test.js
import { describe, it, expect } from 'vitest'
import { toNotices } from './notices'
import fx from './__fixtures__/notices.json'

describe('toNotices', () => {
  it('keeps notebook reminders, fills and note resurfacing; drops everything else', () => {
    const alerts = { alerts: [...fx.alerts, { id: 'x', type: 'price_alert', title: 'NVDA', data: {} }] }
    const insights = { insights: [...fx.insights, { id: 'm1', kind: 'market_move', headline: 'SPY', link: '/x' }] }
    const kinds = toNotices(alerts, insights).map((n) => n.kind).sort()
    expect(kinds).toEqual(['fill', 'reminder', 'resurface'])
  })
  it('skips read alerts and dismissed insights', () => {
    const a = { alerts: fx.alerts.map((r) => ({ ...r, read: true })) }
    const i = { insights: fx.insights.map((r) => ({ ...r, dismissed_at: '2026-10-11T12:00:00Z' })) }
    expect(toNotices(a, i)).toEqual([])
  })
  it('the fill notice points at the trade side, not the Notebook', () => {
    const fill = toNotices({ alerts: fx.alerts }, { insights: [] }).find((n) => n.kind === 'fill')
    expect(fill.href).toBe('/journal?j2tab=positions')
  })
  it('a resurfaced note only links into the Notebook', () => {
    const bad = { insights: [{ id: 'r', kind: 'note_big_move', headline: 'h', link: 'https://evil.example/' }] }
    expect(toNotices({ alerts: [] }, bad)[0].href).toBeNull()
  })
  it('tolerates missing or malformed bodies', () => {
    expect(toNotices(null, undefined)).toEqual([])
    expect(toNotices({ alerts: 'x' }, { insights: {} })).toEqual([])
  })
})
```

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/notices.test.js`. Expected: FAIL (no module).

- [ ] **Step 3: Implement `notices.js`**

```js
// J/lib/notices.js — what Research Home's Notices box shows (spec P0.4). Pure: the box fetches,
// this decides. Sources are the bell rows the Notebook writes and the resurfacing insights.
const REMINDER = 'notebook_task_reminder'
const FILL = 'notebook_entry_context_new_fill'
const RESURFACE = new Set(['note_level_touch', 'note_big_move', 'note_date_due'])
const NOTE_LINK = '/journal/notebook?note='

const src = (a) => a?.data?.source || a?.type
const list = (v) => (Array.isArray(v) ? v : [])

export function toNotices(alertsBody, insightsBody) {
  const out = []
  for (const a of list(alertsBody?.alerts ?? alertsBody)) {
    if (!a || a.read) continue
    const s = src(a)
    if (s === REMINDER) out.push({ key: `a:${a.id}`, id: a.id, kind: 'reminder', title: a.title || 'Tasks due',
      line: a.message || '', href: a.data?.research_url || '/journal/notebook?view=tasks', source: 'alert' })
    else if (s === FILL) out.push({ key: `a:${a.id}`, id: a.id, kind: 'fill', title: a.title || 'New fill captured',
      line: a.message || '', href: a.data?.research_url || '/journal?j2tab=positions', source: 'alert' })
  }
  for (const i of list(insightsBody?.insights)) {
    if (!i || i.dismissed_at || !RESURFACE.has(i.kind)) continue
    const href = typeof i.link === 'string' && i.link.startsWith(NOTE_LINK) ? i.link : null
    out.push({ key: `i:${i.id}`, id: i.id, kind: 'resurface', title: i.headline || 'A note came back up',
      line: i.body || '', href, source: 'insight' })
  }
  return out
}
```

`/api/alerts` may return the list bare or under a key. Check `AlertBell.jsx:96-100` and match what it reads. Keep `alertsBody?.alerts ?? alertsBody` only if both shapes really occur.

- [ ] **Step 4: Run** the pure test. Expected: 5 PASS.

- [ ] **Step 5: Failing component test**

```jsx
// B/NoticesBox.test.jsx — SWRConfig provider={() => new Map()} + MemoryRouter, global.fetch stub
it('renders nothing when there is nothing to show', async () => {
  stubFetch({ alerts: { alerts: [] }, insights: { insights: [] } })
  const { container } = renderBox()
  await waitFor(() => expect(fetchCalls()).toBeGreaterThan(0))
  expect(container.textContent).toBe('')
})
it('fetchFails: a 401/500/network failure leaves nothing on screen', async () => {
  for (const mode of [401, 500, 'network']) {
    stubFetch({ fail: mode })
    const { container, unmount } = renderBox()
    await waitFor(() => expect(fetchCalls()).toBeGreaterThan(0))
    expect(container.textContent).toBe('')
    unmount()
  }
})
it('lists notices with a count, and opening one marks it read', async () => {
  stubFetch({ alerts: fx.alerts, insights: fx.insights })
  renderBox()
  expect(await screen.findByText(/Notices · 3/)).toBeTruthy()
  fireEvent.click(screen.getByText(/Notices · 3/))
  fireEvent.click(screen.getByRole('link', { name: /Tasks due/ }))
  expect(postCalls()).toContain(`/api/alerts/${fx.alerts[0].id}/read`)
})
```

Run it. Expected: FAIL (no component).

- [ ] **Step 6: Implement `NoticesBox.jsx`**

```jsx
// B/NoticesBox.jsx — Research Home's Notices (owner decision 2, 2026-10-11): the desktop bell was
// removed by request, so resurfaced notes, task reminders and fill notices land here. Folded by
// default; renders nothing at all when empty or when either read fails (Review Focus 3).
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { toNotices } from '../../lib/notices'
import styles from './NoticesBox.module.css'

const ONCE = Object.freeze({ revalidateOnFocus: false, shouldRetryOnError: false, refreshInterval: 120000 })
const get = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
const post = (url) => fetch(url, { method: 'POST', credentials: 'include' }).catch(() => null)

export default function NoticesBox() {
  const { data: alerts, mutate: reA } = useSWR('/api/alerts?limit=20', get, ONCE)
  const { data: insights, mutate: reI } = useSWR('/api/voice/insights', get, ONCE)
  const items = toNotices(alerts, insights)
  if (!items.length) return null
  const done = (n) => {
    post(n.source === 'alert' ? `/api/alerts/${encodeURIComponent(n.id)}/read`
      : `/api/voice/insights/${encodeURIComponent(n.id)}/dismiss`).then(() => (n.source === 'alert' ? reA() : reI()))
  }
  return (
    <details className={styles.box} data-tour="home-notices">
      <summary className={styles.summary}>Notices · {items.length}</summary>
      <ul className={styles.list}>
        {items.map((n) => (
          <li key={n.key} className={styles.row}>
            {n.href
              ? <Link to={n.href} className={styles.title} onClick={() => done(n)}>{n.title}</Link>
              : <span className={styles.title}>{n.title}</span>}
            {n.line && <span className={styles.line}>{n.line}</span>}
            <button type="button" className={styles.dismiss} aria-label={`Dismiss ${n.title}`} onClick={() => done(n)}>
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
```

The SWR fetcher must never throw into the page: a failing read resolves to `null` and the box renders nothing. CSS: `.box` matches the sibling home boxes (copy `HomeBox`'s look from `ResearchHome.module.css`). Rows and the Dismiss button are ≥ `var(--tap-min)` at ≤1024 px.

- [ ] **Step 7: Mount on Research Home**

In each of the three returns (`:761`, `:781`, `:801`), put `<NoticesBox />` immediately after `{homeTop}`. Use the same position in all three, so the tree position is stable (the reason `ResearchHome.quietAsk.test.jsx` exists). Lazy-load it with the file's `lazyChunk` helper (`const NoticesBox = lazyChunk(() => import('./NoticesBox'))`) wrapped in `<Suspense fallback={null}>`, so the Notebook first-open byte budget does not move.

- [ ] **Step 8: Fix the misleading bell copy (backend)**

```python
# tests/test_entry_context_bell_copy.py
from api.services.journal_two import entry_context as ec

def test_the_fill_notice_does_not_send_the_member_to_the_notebook():
    assert "Notebook" not in ec.BELL_MESSAGE
    assert ec.BELL_VIEW_URL == "/journal?j2tab=positions"
```

Run: `python -m pytest tests/test_entry_context_bell_copy.py -q`. Expected: FAIL. Then change `entry_context.py:186` to:

```python
BELL_MESSAGE = "A new fill's market context was captured. Open the trade to see it."
```

Run `python -m pytest tests/test_entry_context_bell_copy.py -q` again. Expected: 1 passed. Then `grep -rn "captured in your Notebook" tests/ app/src` and update any test pinned to the old sentence.

- [ ] **Step 9: Run all, then commit**

```bash
cd app && npx vitest run src/pages/journal-2-0/lib/notices.test.js src/pages/journal-2-0/components/notebook/NoticesBox.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.homeTop.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.quietAsk.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.setupsDoor.test.jsx > /tmp/p0-t4.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Commit message: `feat(notebook): P0.4 Notices box on Research Home; fill notice stops naming the Notebook`. Pathspec: `app/src api/services/journal_two/entry_context.py tests/test_entry_context_bell_copy.py`.

---

### Task 5: P0.5: Active setups gets a real door, and the board gets a way back

**Files:**
- Modify: `B/ResearchHome.jsx:727-737` (replace `setupsLink` with a folded box), `:770/:790/:810`
- Modify: `B/SetupsBoard.jsx:92-102` (empty copy when examples show) and `:218-221` (back link)
- Modify: `B/ResearchHome.setupsDoor.test.jsx` (it compares the flag-on DOM with the link removed against the flag-off render; it now removes the box)
- Test: `B/ResearchHome.setupsBox.test.jsx` (new), `B/SetupsBoard.test.jsx` (extend)

**Interfaces:**
- Consumes: `GET /api/j2/setups-board` (`BOARD_URL`, `SetupsBoard.jsx:68`). Returns `{cards:[{noteId, symbol, example, …}], count, …}`. Open count = `cards.filter((c) => !c.example).length`.
- Keeps: ResearchHome never imports `SetupsBoard` (the setupsDoor test reads this). Only the URL constant is shared. Export `BOARD_URL` from `lib/setupsBoardLink.js` (move the constant there and import it in both files) so it has one authority.

- [ ] **Step 1: Failing tests**

```jsx
// B/ResearchHome.setupsBox.test.jsx (render helper + useNotebookHome mock copied from setupsDoor test)
it('shows "Active setups · N open" from the board read and links to the board', async () => {
  latchNotebookFlags({ notebook_setups_board_enabled: true })
  stubFetch({ '/api/j2/setups-board': { cards: [{ noteId: 'a', example: false }, { noteId: 'b', example: false }, { noteId: 'x', example: true }] } })
  renderHome()
  expect(await screen.findByText('Active setups · 2 open')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open the setups board' }).getAttribute('href')).toBe(SETUPS_BOARD_PATH)
})
it('zero open plans says so in words and still links', async () => {
  latchNotebookFlags({ notebook_setups_board_enabled: true })
  stubFetch({ '/api/j2/setups-board': { cards: [{ noteId: 'x', example: true }] } })
  renderHome()
  expect(await screen.findByText('Active setups · none open')).toBeTruthy()
})
it('flag off: no box and no fetch', () => {
  latchNotebookFlags({ notebook_setups_board_enabled: false })
  renderHome()
  expect(screen.queryByText(/Active setups/)).toBeNull()
  expect(fetchUrls()).not.toContain('/api/j2/setups-board')
})
```

```jsx
// SetupsBoard.test.jsx additions (use the file's Providers + contract fixtures)
it('has a way back to the Notebook home', async () => {
  renderBoard()
  expect((await screen.findByRole('link', { name: 'Back to Notebook' })).getAttribute('href')).toBe('/journal/notebook')
})
it('when only examples show, it does not claim "No open setups yet." above them', async () => {
  renderBoard({ fixture: 'examples-only' })
  expect(await screen.findByText(/These are examples/)).toBeTruthy()
  expect(screen.queryByText(/^No open setups yet\./)).toBeNull()
})
```

If no `examples-only` contract fixture exists, build the body inline in the test from `contractBody('setups-board.forty')` with every card set to `example: true`.

Run both files. Expected: the new cases FAIL.

- [ ] **Step 2: Implement the home box**

Replace `setupsLink` (`:732-737`) with:

```jsx
const setupsOn = setupsBoardEnabled()
const { data: board } = useSWR(setupsOn ? BOARD_URL : null, fetchJson, SWR_ONCE)
const openPlans = Array.isArray(board?.cards) ? board.cards.filter((c) => !c.example).length : null
const setupsBox = setupsOn ? (
  <div className={styles.setupsBox} data-tour="home-setups">
    <span className={styles.setupsCount}>
      {openPlans == null ? 'Active setups' : openPlans === 0 ? 'Active setups · none open' : `Active setups · ${openPlans} open`}
    </span>
    <Link className="btn btn-ghost" to={SETUPS_BOARD_PATH}>Open the setups board</Link>
  </div>
) : null
```

`fetchJson` and `SWR_ONCE` exist in the file (`SWR_ONCE` :262). If `fetchJson` is not in scope, use the same never-throwing `get` as Task 4. Move `{setupsBox}` up: put it right after `<NoticesBox/>` in all three returns, and delete the three old `{setupsLink}` sites. The `title` sentence on the old link moves to the box as a visually hidden description (`aria-describedby`).

- [ ] **Step 3: Update the setupsDoor equivalence test**

Change its "remove the link from the flag-on DOM" step to remove `[data-tour="home-setups"]`. Keep its source-read assertion that ResearchHome never imports the board. Keep the `BOARD_FLAG` read, which now points at `lib/setupsBoardLink.js` if the constant moved.

- [ ] **Step 4: Board back link and example-aware copy**

At `SetupsBoard.jsx` around `:218-221`, above the `<h1>`:

```jsx
<Link to="/journal/notebook" className={styles.backLink}>
  <UIcon name="chevronLeft" size={14} gold={false} /> Back to Notebook
</Link>
```

In `emptyBoardText()` (`:54-65`), when the response has example cards (`cards.some((c) => c.example)`), return:
`'These are examples. Draw an entry line on a chart in a plan note (and a stop, for the distance in R) and your own plans show here.'`
Pass whether examples exist into the function. Do not compute it twice.

- [ ] **Step 5: Run, then commit**

```bash
cd app && npx vitest run src/pages/journal-2-0/components/notebook/ResearchHome.setupsBox.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.setupsDoor.test.jsx src/pages/journal-2-0/components/notebook/SetupsBoard.test.jsx > /tmp/p0-t5.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Commit message: `feat(notebook): P0.5 Active setups box near the top of home; board gets a way back`.

---

### Task 6: P0.6: phone editor, an always-visible "+" insert menu and a Format grid

Phone row today (`NoteEditorPage.jsx:4601-4852`). Always visible: Undo, Redo, B, I, • List, Format, mic. The mic is clipped (x 354–398 on 390). Four `formatRun` spans hide behind Format, and when opened they scroll sideways (`flex-wrap: nowrap; overflow-x: auto`, phone block `:699-760`).

New phone row: Undo, Redo, B, I, **Format**, **+**, mic (7 × 44 px ≤ 358 px). "• List" moves into run-a. The "+" opens a menu with:
- Image: `fileInputRef.current?.click()`, from `:4778`
- Attach a file: `attachFileInputRef.current?.click()`, from `:4799`
- Scan with camera: `scanInputRef.current?.click()`, from `:4788`
- Insert a chart or block: `setPaletteOpen(true)`, from `:4838`

When open, Format wraps into a grid instead of scrolling.

**Files:**
- Modify: `B/NoteEditorPage.jsx:4601-4852`
- Modify: `B/NoteEditorPage.module.css` (phone block `:699-760`, touch block `:953`)
- Create: `B/NoteEditorPage.phoneInsert.test.jsx`, `B/NoteEditorPage.phoneToolbarCss.test.js`
- Modify: `B/NoteEditorPage.phoneFormat.test.jsx` (List now inside Format)

**Interfaces:**
- Produces: a `+` button, `aria-label="Insert"`, `data-tour="note-insert-phone"`, `styles.insertPhone`, hidden at >640 px. Menu items are `role="menuitem"` buttons.

- [ ] **Step 1: Failing behaviour test** (mocks and setup copied verbatim from `NoteEditorPage.phoneHeader.test.jsx`: `useJ2Notes`, `AuthContext`, `useJ2NoteFolders`, `VoiceInputButton`, `matchMedia` on `MQ.phone`, `latchNotebookFlags`, the fetch stub)

```jsx
it('the phone "+" lists image, file, camera scan and chart/block, and each opens its door', async () => {
  setPhone(true)
  await mountEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
  const names = screen.getAllByRole('menuitem').map((m) => m.textContent.trim())
  expect(names).toEqual(['Image', 'Attach a file', 'Scan with camera', 'Chart or block'])
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
  fireEvent.click(screen.getByRole('menuitem', { name: 'Scan with camera' }))
  expect(click).toHaveBeenCalled()
  click.mockRestore()
})
it('Chart or block opens the widget palette', async () => {
  setPhone(true)
  await mountEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Chart or block' }))
  expect(await screen.findByRole('dialog', { name: /widget|insert/i })).toBeTruthy()
})
```

Check the palette's accessible name with `grep -n "aria-label\|title=" app/src/pages/journal-2-0/components/notebook/WidgetPalette.jsx | head`, and use its exact name in place of the regex.

- [ ] **Step 2: Failing CSS test (the layout jsdom cannot measure)**

```js
// B/NoteEditorPage.phoneToolbarCss.test.js
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
const css = readFileSync(new URL('./NoteEditorPage.module.css', import.meta.url), 'utf8')
const phone = css.split('@media (max-width: 640px)').slice(1).join('\n')
describe('P0.6 phone toolbar CSS', () => {
  it('an open Format wraps into rows instead of scrolling sideways', () => {
    expect(/\.toolbarRow\[data-format-open\][^{]*\{[^}]*flex-wrap:\s*wrap/.test(phone)).toBe(true)
  })
  it('the insert "+" shows on phone and hides above it', () => {
    expect(/\.insertPhone\s*\{[^}]*display:\s*none/.test(css)).toBe(true)
    expect(/\.insertPhone\s*\{[^}]*display:\s*inline-flex/.test(phone)).toBe(true)
  })
})
```

Run both new files. Expected: FAIL.

- [ ] **Step 3: Implement**

1. Move the `• List` button (always-visible today) into the start of `run-a` (`:4668`).
2. After the Format toggle (`:4654`), add:

```jsx
<button ref={insertPhoneRef} type="button" className={`${styles.toolBtn} ${styles.insertPhone}`}
  aria-haspopup="menu" aria-expanded={insertPhoneOpen} aria-label="Insert"
  data-tour="note-insert-phone" onClick={() => setInsertPhoneOpen((o) => !o)}>
  <UIcon name="plus" size={16} gold={false} />
</button>
{insertPhoneOpen && (
  <ContextPopover /* same props shape as EmbedBlockActions.jsx:70 */ anchorRef={insertPhoneRef}
    onClose={() => setInsertPhoneOpen(false)}>
    {[
      ['Image', () => fileInputRef.current?.click()],
      ['Attach a file', () => attachFileInputRef.current?.click()],
      ['Scan with camera', () => scanInputRef.current?.click()],
      ['Chart or block', () => setPaletteOpen(true)],
    ].map(([label, run]) => (
      <button key={label} type="button" role="menuitem" className={styles.insertItem}
        onClick={() => { setInsertPhoneOpen(false); run() }}>{label}</button>
    ))}
  </ContextPopover>
)}
```

State: `const [insertPhoneOpen, setInsertPhoneOpen] = useState(false)` and `const insertPhoneRef = useRef(null)` next to `formatOpen` (`:2762`). Close it in the same matchMedia listener that closes Format when leaving the phone tier.

3. CSS:

```css
.insertPhone { display: none; }
.insertItem { display: block; width: 100%; padding: 10px 14px; text-align: left; background: none; border: 0;
              color: var(--color-text); min-height: var(--tap-min); }
@media (max-width: 640px) {
  .insertPhone { display: inline-flex; }
  .toolbarRow[data-format-open] { flex-wrap: wrap; overflow-x: visible; }
}
```

Add these inside the existing phone block, not as a second `@media (max-width: 640px)` block, if the file's rails read "the last phone block" (the `.main` lesson from #316).

- [ ] **Step 4: Update `phoneFormat.test.jsx`** where it asserts List is always visible: List is now inside Format.

- [ ] **Step 5: Run, then commit**

```bash
cd app && npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.phoneInsert.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.phoneToolbarCss.test.js src/pages/journal-2-0/components/notebook/NoteEditorPage.phoneFormat.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.phoneHeader.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.toolbarOneStop.test.js src/pages/journal-2-0/components/notebook/NoteEditorPage.touchHistory.test.jsx src/styles/tapFloor.test.js > /tmp/p0-t6.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Find the exact names of `toolbarOneStop` and `touchHistory` for NoteEditorPage with `git ls-files | grep -i "NoteEditorPage.*\(toolbarOneStop\|touchHistory\)"`. Commit message: `feat(notebook): P0.6 phone editor gets an Insert menu; Format wraps; mic stays on screen`.

---

### Task 7: P0.7: one Ask section on home

Today, `aiBox` ("Ask Notebook to do something", `:674-680`) is the second child, and `askRow` (`AskPanel scope="notebook"`, `:746-756`) sits lower. Both must stay at one fixed tree position in all three returns.

**Files:**
- Modify: `B/ResearchHome.jsx:674-680, 746-756`, plus the three returns
- Modify: `B/AiActionsPanel.jsx:148,156` (toggle text and label)
- Modify: `B/ResearchHome.aiActions.test.jsx`, `B/ResearchHome.quietAsk.test.jsx` (positions)
- Create: `B/ResearchHome.oneAsk.test.jsx`

- [ ] **Step 1: Failing test**

```jsx
// B/ResearchHome.oneAsk.test.jsx (helpers from ResearchHome.aiActions.test.jsx)
it('home has one Ask section holding the question box and the change-it disclosure', () => {
  latchNotebookFlags({ notebook_ai_actions_enabled: true })
  renderHome({ hasAnyNotes: true })
  const sections = screen.getAllByRole('region', { name: 'Ask your Notebook' })
  expect(sections).toHaveLength(1)
  expect(within(sections[0]).getByTestId('ask-panel-stub')).toBeTruthy()
  expect(within(sections[0]).getByRole('button', { name: 'Or tell Notebook what to change' })).toBeTruthy()
  expect(screen.queryByText('Ask Notebook to do something')).toBeNull()
})
```

Check the AskPanel stub's test id in the existing mock (`vi.mock('./AskPanel', …)`) and use it. Run. Expected: FAIL.

- [ ] **Step 2: Implement**

Build one slot, replacing both `aiBox` and `askRow`:

```jsx
const askSection = (
  <section className={styles.askRow} aria-label="Ask your Notebook" data-tour="home-ask">
    <AskPanel scope="notebook" onOpenNote={openNote} onNavigate={(s, _r, { signal } = {}) => openSpanningCitation(s, {
      signal, openNote, openDocument: setPreviewDoc, openCapturedSource: setCapturedSource,
    })} />
    {notebookFlag('notebook_ai_actions_enabled') === true ? (
      <Suspense fallback={null}><AiActionsBox blockedNoteIds={blockedNoteIds} onOpenNote={openNote} /></Suspense>
    ) : null}
  </section>
)
```

Put `{askSection}` as the second child (where `aiBox` was) in all three returns, and remove the old `askRow` sites. In `AiActionsPanel.jsx`, change the toggle text (`:156`) and its `aria-label` (`:148`) from "Ask Notebook to do something" to "Or tell Notebook what to change". Grep the test suite for the old string and update every hit: `grep -rln "Ask Notebook to do something" app/src`. Also check `tools/notebook_fin_walk_features.py` and `tools/*walk*.py`, and update the walk selectors in the same commit.

- [ ] **Step 3: Note-level name**

```bash
grep -n "'Ask'\|>Ask<\|label=\"Ask\"" app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx
```

Rename the desktop header Ask button's visible text and `aria-label` to "Ask this note". The phone More item stays "Ask about this note" (`NoteEditorPage.phoneHeader.test.jsx` `PHONE_ITEMS`). Update the tests that name the desktop button.

- [ ] **Step 4: Run, then commit**

```bash
cd app && npx vitest run src/pages/journal-2-0/components/notebook/ResearchHome.oneAsk.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.aiActions.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.quietAsk.test.jsx src/pages/journal-2-0/components/notebook/AiActionsPanel.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.phoneHeader.test.jsx > /tmp/p0-t7.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Find the exact `AiActionsPanel` test filename with `git ls-files | grep AiActionsPanel`. Commit message: `feat(notebook): P0.7 one Ask section on home; "Ask this note" in the editor`.

---

### Task 8: P0.8: capture doors inside the Notebook, a Shortcut how-to, and a renamed Personal API

**Files:**
- Create: `B/CaptureDoors.jsx`, `B/CaptureDoors.module.css`, `B/CaptureDoors.test.jsx`
- Create: `B/ShortcutHowTo.jsx`, `B/ShortcutHowTo.test.jsx`
- Modify: `B/import/ImportWizard.jsx:899-932` (render `<CaptureDoors/>` under the dropzone)
- Modify: `B/onboarding/CapabilityPreview.jsx` (render `<CaptureDoors compact/>` under the list)
- Modify: `J/components/PersonalApiCard.jsx:144` (title), `PersonalApiCard.test.jsx` (name)
- Modify: `app/src/pages/Settings.jsx` (the `connections` group must be linkable: confirm the section id it renders, e.g. `id="connections"` or the hash scheme Settings uses)

**Interfaces:**
- **The cards gate themselves by their own endpoint, not by a Notebook flag.** This was measured at write time: there are no `notebookFlag` calls in those files.
  - `InboundEmailCard.jsx:37` reads `URL = '/api/j2/inbound-email/address'`. Its fetcher (`:50-56`) maps `404 → { dark: true }` and `402 → { unpaid: true }`.
  - `PersonalApiCard.jsx:34` reads `URL = '/api/j2/personal/tokens'`, with the same 404 → dark rule (`:48-49`).
  - `BrowserCaptureCard.jsx:20` reads `URL = '/api/j2/capture/connections'` and has no gate.
- One authority: rename each card's `const URL` to an exported constant and export its fetcher:
  - `INBOUND_EMAIL_URL` + `inboundEmailFetcher`
  - `PERSONAL_API_URL` + `personalApiFetcher`
  - `CAPTURE_CONNECTIONS_URL`

  SWR dedupes the same key, so the Notebook door adds no request when both are mounted.
- Produces: `CaptureDoors({ compact = false })`, three doors. Each appears exactly when its Settings card would render:
  - Email to Notebook: `data && !data.dark && !data.unpaid` from `useSWR(INBOUND_EMAIL_URL, inboundEmailFetcher)`.
  - iPhone Shortcut: the same rule on `PERSONAL_API_URL`; it also opens `ShortcutHowTo`.
  - Browser extension: always, linking to `CAPTURE_INSTALL_URL` (`BrowserCaptureCard.jsx:30`).
- An unknown gate (no answer yet, or a non-404 failure) hides the door. That is the cards' own M-2 rule.

- [ ] **Step 1: Find the Settings anchor**

`grep -n "connections" app/src/pages/Settings.jsx | head -20`. Record how a section is deep-linked (an `id`, a `?section=`, or a hash the page scrolls to). If no deep link exists, add `id="connections"` to the connections section wrapper and a `useEffect` that scrolls to `location.hash` on mount, following any existing hash handling there. Test it: `Settings.connectionsAnchor.test.jsx` renders `/settings#connections` and asserts `scrollIntoView` was called on that element (mock `Element.prototype.scrollIntoView`).

- [ ] **Step 2: Failing tests**

```jsx
// B/CaptureDoors.test.jsx — SWRConfig provider={() => new Map()} + MemoryRouter; global.fetch routes:
//   stubFetch({ '/api/j2/inbound-email/address': 200|404, '/api/j2/personal/tokens': 200|404|502 })
it('lists only the capture doors whose card would render', async () => {
  stubFetch({ '/api/j2/inbound-email/address': [200, { address: 'x@in.example' }], '/api/j2/personal/tokens': [404, {}] })
  renderDoors()
  expect(await screen.findByRole('link', { name: /Email to Notebook/ })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Capture from anywhere' })).toBeTruthy()
  expect(screen.getByRole('link', { name: /Browser extension/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /iPhone Shortcut/ })).toBeNull()
})
it('an unknown gate (502) hides that door — the cards\' own M-2 rule', async () => {
  stubFetch({ '/api/j2/inbound-email/address': [404, {}], '/api/j2/personal/tokens': [502, {}] })
  renderDoors()
  await waitFor(() => expect(fetchCalls()).toBeGreaterThan(1))
  expect(screen.queryByRole('button', { name: /iPhone Shortcut/ })).toBeNull()
  expect(screen.queryByRole('link', { name: /Email to Notebook/ })).toBeNull()
})
it('the Shortcut door opens a how-to a member can follow', async () => {
  stubFetch({ '/api/j2/inbound-email/address': [404, {}], '/api/j2/personal/tokens': [200, { tokens: [] }] })
  renderDoors()
  await screen.findByRole('button', { name: /iPhone Shortcut/ })
  fireEvent.click(screen.getByRole('button', { name: /iPhone Shortcut/ }))
  expect(screen.getByRole('dialog', { name: 'Send notes from your iPhone' })).toBeTruthy()
  expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4)
})
```

Run. Expected: FAIL.

- [ ] **Step 3: Write the how-to copy from the repo doc**

Read `docs/notebook/ios-shortcuts.md` in full. Write `ShortcutHowTo.jsx` as a `Sheet` (`components/mobile/Sheet.jsx`, `variant="auto"`, title "Send notes from your iPhone") holding an ordered list of the doc's member-actionable steps, in plain English:
1. Make a key in Settings → Connections → Connect apps & shortcuts.
2. Open the Shortcuts app.
3. Add the action.
4. Paste the key.
5. Test it.

Put the copy in a frozen `SHORTCUT_STEPS` array exported for the test. Every step must come from the doc. Do not invent an endpoint or a field the doc does not name. The sheet links "Make a key" to `/settings#connections`.

- [ ] **Step 4: Implement `CaptureDoors.jsx`**

```jsx
// B/CaptureDoors.jsx — "Capture from anywhere" (spec P0.8): the three ways in that live in
// Settings, pointed at from inside the Notebook. A door shows exactly when its Settings card
// would render: same endpoint, same fetcher, same 404-means-dark rule (one authority).
import { useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { INBOUND_EMAIL_URL, inboundEmailFetcher } from '../InboundEmailCard'
import { PERSONAL_API_URL, personalApiFetcher } from '../PersonalApiCard'
import ShortcutHowTo from './ShortcutHowTo'
import styles from './CaptureDoors.module.css'

const CONNECTIONS = '/settings#connections'
const ONCE = Object.freeze({ revalidateOnFocus: false, shouldRetryOnError: false })
const live = (d) => Boolean(d) && !d.dark && !d.unpaid

export default function CaptureDoors({ compact = false }) {
  const [howTo, setHowTo] = useState(false)
  const { data: emailGate } = useSWR(INBOUND_EMAIL_URL, inboundEmailFetcher, ONCE)
  const { data: apiGate } = useSWR(PERSONAL_API_URL, personalApiFetcher, ONCE)
  const email = live(emailGate)
  const shortcut = live(apiGate)
  const clipper = true   // BrowserCaptureCard has no gate; the extension is published (unlisted)
  return (
    <section className={compact ? styles.compact : styles.box} aria-labelledby="capture-doors-h">
      <h3 id="capture-doors-h" className={styles.heading}>Capture from anywhere</h3>
      <ul className={styles.list}>
        {email && <li><Link to={CONNECTIONS}>Email to Notebook</Link>: forward an email and it becomes a note.</li>}
        {clipper && <li><Link to={CONNECTIONS}>Browser extension</Link>: save a web page or a selection in one click.</li>}
        {shortcut && <li><button type="button" className={styles.linkBtn} onClick={() => setHowTo(true)}>iPhone Shortcut</button>: send text or a photo from your phone.</li>}
      </ul>
      {howTo && <ShortcutHowTo onClose={() => setHowTo(false)} />}
    </section>
  )
}
```

In the same commit, export the constants and fetchers from the two cards. This is a rename only: `const URL` becomes `export const INBOUND_EMAIL_URL` / `PERSONAL_API_URL`, and `async function fetcher` becomes an exported named function. Every internal use is updated. The cards' own tests (`InboundEmailCard.test.jsx`, `PersonalApiCard.test.jsx`) stay green unchanged.

- [ ] **Step 5: Mount it, and rename the card**

- In `ImportWizard.jsx`, right after the dropzone block (`:899-932`), render `<CaptureDoors />`.
- In `CapabilityPreview.jsx`, after the list, render `<CaptureDoors compact />`.
- In `PersonalApiCard.jsx:144`, use `title="Connect apps & shortcuts (Personal API)"`.
- `grep -rln "title=\"Personal API\"\|'Personal API'\|\"Personal API\"" app/src tools` and update the tests and walk selectors that name the old title.

- [ ] **Step 6: Run, then commit**

```bash
cd app && npx vitest run src/pages/journal-2-0/components/notebook/CaptureDoors.test.jsx src/pages/journal-2-0/components/notebook/ShortcutHowTo.test.jsx src/pages/journal-2-0/components/notebook/import/ImportWizard.test.jsx src/pages/journal-2-0/components/notebook/onboarding/CapabilityPreview.test.jsx src/pages/journal-2-0/components/PersonalApiCard.test.jsx src/pages/Settings.connectionsAnchor.test.jsx > /tmp/p0-t8.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Commit message: `feat(notebook): P0.8 capture doors inside the Notebook, iPhone Shortcut how-to, Personal API renamed`.

---

### Task 9: P0.9 + P0.10 preview: due dates you can find, and voice notes in "See what it can do"

`dateMentionNode.js:129-130` fires only on `@<word>` plus a trailing space or punctuation. Typing `@` shows nothing. The Notebook editor has no other `@` suggestion; the only one is in the community editor (`community/lib/userMention.js:93`), a different editor.

**Files:**
- Create: `J/lib/dateSuggest.js`, `J/lib/dateSuggest.test.js`
- Modify: the Notebook editor's extension list (`J/lib/tiptap.js` or wherever `buildExtensions` lives: `grep -rn "export function buildExtensions" app/src/pages/journal-2-0/lib`)
- Modify: `B/SlashMenu.jsx:113-117` (Checklist description) plus new items after it
- Modify: `B/SlashMenu.items.test.jsx`
- Modify: `B/onboarding/capabilityList.js` (add `voice-notes`) and `capabilityList.test.js`

**Interfaces:**
- Produces: `dateChoices(query, today) -> [{label, date}]` (pure). Words: today, tomorrow, next Monday…next Friday, plus an ISO date if the query is one. Plus a `DateSuggest` TipTap extension using `@tiptap/suggestion` (already a dependency, since SlashMenu uses it: confirm with `grep -rn "@tiptap/suggestion" app/package.json app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx`). It inserts `{ type: 'dateMention', attrs: { date } }`.
- Consumes: `resolveDateWord`, `todayET` (`dateMentionNode.js:67`, `lib/calendar.js`).

- [ ] **Step 1: Failing pure test**

```js
// J/lib/dateSuggest.test.js
import { describe, it, expect } from 'vitest'
import { dateChoices } from './dateSuggest'
const TODAY = '2026-10-14' // a Wednesday
describe('dateChoices', () => {
  it('an empty query offers today, tomorrow and next Monday first', () => {
    expect(dateChoices('', TODAY).slice(0, 3)).toEqual([
      { label: 'Today', date: '2026-10-14' },
      { label: 'Tomorrow', date: '2026-10-15' },
      { label: 'Next Monday', date: '2026-10-19' },
    ])
  })
  it('filters by prefix, case-insensitive', () => {
    expect(dateChoices('tom', TODAY)).toEqual([{ label: 'Tomorrow', date: '2026-10-15' }])
  })
  it('a typed ISO date becomes one exact choice', () => {
    expect(dateChoices('2026-11-03', TODAY)).toEqual([{ label: 'Nov 3, 2026', date: '2026-11-03' }])
  })
  it('an impossible date offers nothing', () => {
    expect(dateChoices('2026-02-30', TODAY)).toEqual([])
  })
  it('always ends with a "Pick a date…" entry when the query is not an ISO date', () => {
    const all = dateChoices('', TODAY)
    expect(all[all.length - 1]).toEqual({ label: 'Pick a date…', date: null, picker: true })
  })
})
```

Run. Expected: FAIL.

- [ ] **Step 2: Implement `dateChoices`**

```js
// J/lib/dateSuggest.js — the `@` date suggestions (spec P0.9). `@tomorrow ` with a trailing
// space was the only way in and typing `@` showed nothing; this lists the choices as you type.
import { resolveDateWord } from './dateMentionNode'

const WORDS = [['Today', 'today'], ['Tomorrow', 'tomorrow'],
  ['Next Monday', 'next monday'], ['Next Tuesday', 'next tuesday'], ['Next Wednesday', 'next wednesday'],
  ['Next Thursday', 'next thursday'], ['Next Friday', 'next friday']]
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

function validIso(q) {
  const m = ISO.exec(q)
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null
}

export function dateChoices(query, today) {
  const q = String(query || '').trim().toLowerCase()
  const iso = validIso(q)
  if (iso) return [{ label: iso.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }), date: q }]
  if (ISO.test(q)) return []
  const words = WORDS.filter(([label, w]) => !q || label.toLowerCase().startsWith(q) || w.startsWith(q))
    .map(([label, w]) => ({ label, date: resolveDateWord(w, today) }))
  return [...words, { label: 'Pick a date…', date: null, picker: true }]
}
```

Check `resolveDateWord`'s real signature at `dateMentionNode.js:67` (argument order, and whether it accepts `next monday`). Adapt this call to it. Do not change the input rule.

- [ ] **Step 3: The `DateSuggest` extension**

Build it on `@tiptap/suggestion` with `char: '@'` and `allowSpaces: false`.
- `items: ({ query }) => dateChoices(query, todayET())`.
- Render: reuse the popup renderer SlashMenu uses. Find its render factory with `grep -n "render:" app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx`, and pass a list component (`DateSuggestList`) that shows `label` rows.
- The `Pick a date…` row renders an `<input type="date" aria-label="Pick a date">`. On change it inserts that date.
- `command: ({ editor, range, props }) => editor.chain().focus().deleteRange(range).insertContent([{ type: 'dateMention', attrs: { date: props.date } }, { type: 'text', text: ' ' }]).run()`.

Register it in `buildExtensions` next to the date-mention node. Test with a real Editor (pattern of `dateMentionNode.test.js`):

```js
it('typing @ then choosing Tomorrow inserts a date mention', async () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildExtensions() })
  editor.commands.insertContent('Call broker @')
  // drive the suggestion: call the extension's exported `runCommand(editor, choice)` test seam,
  // which runs the same `command` the list's Enter key runs.
  runDateCommand(editor, { label: 'Tomorrow', date: '2026-10-15' })
  const json = editor.getJSON()
  expect(JSON.stringify(json)).toContain('"type":"dateMention"')
  expect(JSON.stringify(json)).toContain('2026-10-15')
})
```

Export `runDateCommand` from `dateSuggest.js` as the single command implementation the extension's `command` also calls. That makes it one authority, not a test-only copy.

- [ ] **Step 4: Slash items and the Checklist hint**

At `SlashMenu.jsx:113-117`, change the Checklist description to `'Task list. Type @tomorrow for a reminder'`. Add right after it:

```js
{
  title: 'Due date',
  description: 'Add a due date: today, tomorrow or pick one',
  keywords: ['date', 'due', 'reminder', 'deadline'],
  command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent('@').run(),
},
```

Inserting `@` opens the date suggestions, so there is one door, not a second picker. Extend `SlashMenu.items.test.jsx`: `/due` ranks "Due date" first, and running its command leaves `@` before the cursor.

- [ ] **Step 5: Voice notes in "See what it can do"**

Add to `CAPABILITY_PREVIEW` (`capabilityList.js:17-72`), after `writing-help`:

```js
{ id: 'voice-notes', flag: 'notebook_voice_notes_enabled', label: 'Voice notes',
  line: 'Record or upload a voice memo, or pick a Desk session. You get a transcript and a short summary in a new note.' },
```

`VOICE_NOTE_FLAG` (`lib/voiceNote.js:32`) is the authority, so import it rather than retyping the string, if the list file's style allows imports (`flag: VOICE_NOTE_FLAG`). Update `capabilityList.test.js`'s expected ids.

- [ ] **Step 6: Run, then commit**

```bash
cd app && npx vitest run src/pages/journal-2-0/lib/dateSuggest.test.js src/pages/journal-2-0/lib/dateMentionNode.test.js src/pages/journal-2-0/components/notebook/SlashMenu.items.test.jsx src/pages/journal-2-0/components/notebook/onboarding/capabilityList.test.js src/pages/journal-2-0/components/notebook/onboarding/CapabilityPreview.test.jsx > /tmp/p0-t9.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Commit message: `feat(notebook): P0.9 @ date suggestions and a Due date slash item; voice notes in the preview`.

---

### Task 10: P0.10 tour + P0.11: voice notes tour, and labelled view buttons

**Files:**
- Create: `B/onboarding/tours/b1VoiceNotes.steps.js`, `b1VoiceNotes.steps.test.js`
- Modify: `B/onboarding/tours/b1Core.js` (registry entry after `template-gallery`, `:56-63`)
- Modify: `J/lib/savedViewModes.js:23-37` (add `short`)
- Modify: `J/tabs/NotebookTab.jsx:2296-2336` (phone select)
- Modify: `J/tabs/NotebookTab.module.css` (show/hide by tier)
- Test: `J/tabs/NotebookTab.viewSelect.test.jsx` (new), `NotebookTab.viewSwitcherFits.test.js` (re-run)

- [ ] **Step 1: Tour steps (data only, same contract as `b1TemplateGallery.steps.js`)**

```js
// Tour `voice-notes` (spec P0.10). Data only: see ./index.js for the contract.
// Screen: Research Home, where "+ New note" now lives (Task 2). Step 1 asks the member to open
// the menu (`waitFor` the voice item) so step 2 can point at it.
const TAB = 'components/notebook/NewNoteMenu.jsx'
export const STEPS = Object.freeze([
  Object.freeze({ id: 'open', anchor: 'new-note-home', file: TAB, waitFor: 'new-note-voice' }),
  Object.freeze({ id: 'voice', anchor: 'new-note-voice', file: TAB }),
])
export const COPY = Object.freeze({
  open: { title: 'Start a voice note', body: 'Open the arrow next to New note to see the other ways to start one.' },
  voice: { title: 'Record, upload or pick a session', body: 'Voice note records you, takes an audio file, or uses a Desk session. You get a transcript and a short summary in a new note.' },
})
```

Registry entry:

```js
{
  id: 'voice-notes',
  flag: 'notebook_voice_notes_enabled',
  title: 'Voice notes',
  replayable: true,
  start: '/journal/notebook',
  load: steps(() => import('./b1VoiceNotes.steps')),
},
```

Write `b1VoiceNotes.steps.test.js` modelled on `b1TemplateGallery.steps.test.js`. It checks that every anchor exists in its named file (`data-tour="new-note-home"`, `data-tour={it.tour}` with `'new-note-voice'`). If the anchor rail requires literals, change `NewNoteMenu` to render `data-tour="new-note-voice"` literally on the voice item instead of from `it.tour`. Then re-run `b1Core.test.jsx` and `b1Core.a11y.test.jsx`.

- [ ] **Step 2: Failing view-select test**

```jsx
// J/tabs/NotebookTab.viewSelect.test.jsx (mocks from NotebookTab.test.jsx)
it('the list toolbar has a labelled View select with every mode', () => {
  renderTab({ route: '/journal/notebook?view=all' })
  const sel = screen.getByRole('combobox', { name: 'View' })
  expect([...sel.options].map((o) => o.textContent)).toEqual(['List', 'Table', 'Board', 'Calendar', 'Graph', 'Timeline', 'Tasks'])
  fireEvent.change(sel, { target: { value: 'board' } })
  expect(screen.getByRole('button', { name: 'Board view' }).getAttribute('aria-pressed')).toBe('true')
})
```

Run. Expected: FAIL.

- [ ] **Step 3: Implement**

Add `short` to each `VIEW_MODES` row: `'List'`, `'Table'`, `'Board'`, `'Calendar'`, `'Graph'`, `'Timeline'`, `'Tasks'`. In `NotebookTab.jsx`, next to the button group (`:2297`):

```jsx
<label className={styles.viewSelectWrap}>
  <span className="sr-only">View</span>
  <select className={styles.viewSelect} aria-label="View" value={viewMode}
    onChange={(e) => setViewMode(e.target.value)} disabled={Boolean(activeView)}>
    {VIEW_MODES.map(({ id, short }) => <option key={id} value={id}>{short}</option>)}
  </select>
</label>
```

CSS: `.viewSelectWrap { display: none; }`, and in the phone block `.viewSelectWrap { display: inline-flex; } .viewModeGroup { display: none; }`. The select is ≥ `var(--tap-min)` tall on touch. Re-run `NotebookTab.viewSwitcherFits.test.js`, and adjust its expectation only if it measures the group that is now hidden on phone.

- [ ] **Step 4: Run, then commit**

```bash
cd app && npx vitest run src/pages/journal-2-0/components/notebook/onboarding/tours/b1VoiceNotes.steps.test.js src/pages/journal-2-0/components/notebook/onboarding/tours/b1Core.test.jsx src/pages/journal-2-0/components/notebook/onboarding/tours/b1Core.a11y.test.jsx src/pages/journal-2-0/tabs/NotebookTab.viewSelect.test.jsx src/pages/journal-2-0/tabs/NotebookTab.viewSwitcherFits.test.js src/pages/journal-2-0/tabs/NotebookTab.test.jsx > /tmp/p0-t10.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Commit message: `feat(notebook): P0.10 voice notes tour; P0.11 labelled View select on phones`.

---

### Task 11: P0.3 + P0.12 + P0.15: chart tours stop dead-ending; the Learn menu is grouped and has the sample notebook

**Files:**
- Modify: `B/onboarding/tourStart.js` (new `none: 'chart'` outcome; copy fixes)
- Modify: `B/onboarding/GenericTourEngine.jsx:387-412` (the card supports an action button)
- Modify: `B/onboarding/learnTours.js` (groups map, sample helper)
- Modify: `B/onboarding/LearnMenu.jsx` (+ `.module.css`): grouped sections, a Sheet on phone, the sample item
- Test: `tourStart.test.js` (find with `git ls-files | grep tourStart`), `LearnMenu.test.jsx`, `GenericTourEngine` test

**Interfaces:**
- `resolveStart` returns `{ none: 'chart' }` when `entry.start.embed === 'chart'` and no note with a chart is found. Today it returns `none: 'note'` for that case.
- `UNREACHABLE_COPY.chart = { title, body, action: 'add-sample', actionLabel, exitLabel, exitPath }`.
- `learnTourGroup(id) -> 'Basics' | 'Writing and capture' | 'Trading' | 'Research'`, from a frozen map in `learnTours.js`. The registry validator (`tourRegistry.js:50,63,129-131`) stays unchanged.
- The sample is added via `addSampleNotebook()` (`onboarding/sampleNotebook.js:68-79`), the single authority.

- [ ] **Step 1: Failing tourStart tests**

```js
it('a chart tour with notes but no chart says exactly that (none: "chart")', async () => {
  const fetchImpl = stubFetch({ '/api/j2/notes/import/check': { matches: [] }, '/api/j2/notes?': { notes: [] } })
  const r = await resolveStart({ id: 'chart-plan-basics', start: { note: 'sample:plan', embed: 'chart' } }, loc('/journal/notebook'), { fetchImpl })
  expect(r).toEqual({ none: 'chart' })
})
it('the chart copy offers the sample and a new note, and never says "from Help"', () => {
  const c = UNREACHABLE_COPY.chart
  expect(c.title).toBe('This walkthrough needs a chart in a note')
  expect(c.action).toBe('add-sample')
  expect(c.actionLabel).toBe('Add the sample notebook')
  expect(Object.values(UNREACHABLE_COPY).map((x) => x.body).join(' ')).not.toMatch(/from Help/)
})
```

Build the stub for the import-check and fallback responses from the existing `tourStart` tests' stub shapes.

- [ ] **Step 2: Implement in `tourStart.js`**

- Where the note fallback (`GET /api/j2/notes?…&embed_widget=`) finds nothing and `entry.start.embed === 'chart'`, return `{ none: 'chart' }`.
- Copy:

```js
chart: Object.freeze({
  title: 'This walkthrough needs a chart in a note',
  body: 'None of your notes has a chart yet. Add the sample notebook, which has one, or type /chart in any note to add your own. Then start the walkthrough again from Learn.',
  action: 'add-sample',
  actionLabel: 'Add the sample notebook',
  exitLabel: 'Go to my notes',
  exitPath: NOTEBOOK_ROOT,
}),
```

- In `note`, `trade` and `error`, replace "from Help" with "from Learn". In `note` remove "from the Notebook home", which no longer offers the sample once a note exists: `'You do not have a note it can open yet. Write a note, or add the sample notebook from Learn, then start it again from Learn.'`

- [ ] **Step 3: Engine card action**

In `GenericTourEngine.jsx:387-412`, when `copy.action === 'add-sample'`, render a primary button:

```jsx
{copy.action === 'add-sample' && (
  <button type="button" className="btn btn-primary" disabled={busy} onClick={async () => {
    setBusy(true)
    const r = await addSampleNotebook()
    setBusy(false)
    if (!r.ok) { setActionMsg(r.message); return }
    leave()
    startTour(entryId)          // learnTours.startTour: re-run this tour now that a chart note exists
  }}>{copy.actionLabel}</button>
)}
{actionMsg && <p role="status">{actionMsg}</p>}
```

`entryId` is the id of the tour whose card is showing. Read how the engine knows its current entry and use that. If the engine has no `startTour` import, import it from `./learnTours`. Test it in the engine's test file: mock `./sampleNotebook` (ok and 409) and `./learnTours` (`startTour` spy), render the unreachable card for `none: 'chart'`, and click. On ok, `startTour` is called with the tour id. On 409, the refusal message shows and `startTour` is not called.

- [ ] **Step 4: Failing LearnMenu tests**

```jsx
it('groups tours under Basics, Writing and capture, Trading, Research', () => {
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
  const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
  expect(groups).toEqual(expect.arrayContaining(['Basics', 'Trading']))
})
it('offers "Add the sample notebook" to a paid member with onboarding on', async () => {
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  renderMenu({ isPaid: true })
  fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
  expect(screen.getByRole('menuitem', { name: 'Add the sample notebook' })).toBeTruthy()
})
it('sample409: an existing sample shows the refusal and creates nothing', async () => {
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  sampleMock.mockResolvedValueOnce({ ok: false, message: SAMPLE_COPY.refused })
  renderMenu({ isPaid: true })
  fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Add the sample notebook' }))
  expect(await screen.findByText(SAMPLE_COPY.refused)).toBeTruthy()
  expect(navigateMock).not.toHaveBeenCalled()
})
it('on a phone the menu opens as a sheet', () => {
  setPhone(true)
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
  expect(screen.getByRole('dialog', { name: 'Learn: walkthroughs' })).toBeTruthy()
})
```

`renderMenu` wraps `MemoryRouter`, `SWRConfig` and an `AuthContext.Provider`. `sampleMock` mocks `./sampleNotebook`'s `addSampleNotebook`, keeping `SAMPLE_COPY` real via `importOriginal`. `navigateMock` mocks `useNavigate`. Run. Expected: FAIL.

- [ ] **Step 5: Implement the groups, the sheet and the sample item**

`learnTours.js`:

```js
export const LEARN_GROUPS = Object.freeze(['Basics', 'Writing and capture', 'Trading', 'Research'])
const GROUP_OF = Object.freeze({
  'notebook-basics': 'Basics', 'template-gallery': 'Basics', 'meaning-search': 'Basics',
  'writing-help': 'Writing and capture', 'image-docx-import': 'Writing and capture', 'publish-share': 'Writing and capture',
  'task-reminders': 'Writing and capture', 'formulas-rollups': 'Writing and capture', 'voice-notes': 'Writing and capture',
  'plan-grading': 'Trading', 'entry-context': 'Trading', 'review-drafts': 'Trading', 'my-playbook': 'Trading',
  'chart-plan-basics': 'Trading', 'chart-plan-replay': 'Trading',
  'ta-fingerprint': 'Research', 'visual-playbook': 'Research', 'setups-board': 'Research', 'earnings-prep': 'Research',
  'transcript-capture': 'Research', 'passed-setups': 'Research',
})
export function learnTourGroup(id) { return GROUP_OF[id] || 'Basics' }
```

Add a rail in `learnTours.test.js`: every replayable registry id has an entry in `GROUP_OF`, so a new tour cannot land ungrouped by accident. Read the ids from `TOUR_REGISTRY` and never retype the list.

`LearnMenu.jsx`:
- Group `learnMenuTours(...)` by `learnTourGroup`. Render each non-empty group as `<div role="group" aria-label={g}>` with a small visual heading and its `menuitem`s.
- At click time, decide with `useIsPhone()` (click-triggered, allowed). On phone, render the same content inside `<Sheet variant="bottom-sheet" title={LEARN_COPY.menuLabel}>` instead of the absolute popover.
- After the tours, when `notebookFlag('notebook_onboarding_enabled') === true && isPaid`, render `<button role="menuitem">Add the sample notebook</button>`. On click it calls `addSampleNotebook()`. When `ok`, it calls `mutate(isNotebookKey)` (same as `ResearchHome.jsx:392-404`; move that key predicate to a shared import if it is local to ResearchHome) and navigates to `/journal/notebook?note=${welcomeNoteId}`. When not `ok`, it shows `message` in a `role="status"` line.

- [ ] **Step 6: Run, then commit**

```bash
O=src/pages/journal-2-0/components/notebook/onboarding
cd app && npx vitest run $O/LearnMenu.test.jsx $O/learnTours.test.js $O/tourStart.test.js $O/tourAnchors.test.js $O/GenericTourEngine.test.jsx $O/GenericTourEngine.c1.test.jsx $O/GenericTourEngine.numbering.test.jsx $O/GenericTourEngine.a11y.test.jsx $O/tours/b2Trading.test.jsx $O/tours/b3Research.test.jsx > /tmp/p0-t11.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

These paths were verified at write time. `learnTours.test.js` exists, so add the GROUP_OF rail to it. Commit message: `feat(notebook): P0.3 chart tours offer the sample; P0.12 grouped Learn menu with a phone sheet; P0.15 sample in Learn`.

---

### Task 12: P0.13: search in place

Today `HomeSearch` (`ResearchHome.jsx:197-206`) is a button that navigates to `#search`. NotebookTab opens the sidebar search (`:447-452`), but Home stays on screen, so two search boxes show at once.

**Files:**
- Modify: `B/ResearchHome.jsx:197-206` (`HomeSearch` becomes an input), plus a new prop `searchActive`
- Modify: `J/tabs/NotebookTab.jsx:447-452` (read `location.state?.q`, track sidebar search mode, pass `searchSeed`, `onSearchModeChange` and `searchActive`)
- Modify: `B/FolderSidebar.jsx:858, 917-968, 1460-1472` (`searchSeed` and `onSearchModeChange` props)
- Test: `B/ResearchHome.homeSearch.test.jsx` (new), `B/FolderSidebar.test.jsx` (extend)

**Interfaces:**
- `HomeSearch({ hidden = false })` renders `<input type="search" aria-label="Search your notes" placeholder="Search your notes">`. On its first change it calls `navigate('/journal/notebook#search', { state: { q: value } })`.
- `FolderSidebar` gains `searchSeed = ''` (applied when `searchRequest` changes: `setMode('search'); setQuery(searchSeed); focus`) and `onSearchModeChange = null` (called with `mode === 'search'` whenever `mode` changes).
- `NotebookTab` passes `searchActive` to ResearchHome. ResearchHome hides `HomeSearch` while it is true.

- [ ] **Step 1: Failing tests**

```jsx
// B/ResearchHome.homeSearch.test.jsx
it('typing in the home search hands the text to the notebook search door', () => {
  renderHome({ hasAnyNotes: true })
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search your notes' }), { target: { value: 'nvda' } })
  expect(lastLocation().hash).toBe('#search')
  expect(lastLocation().state).toEqual({ q: 'nvda' })
})
it('while the sidebar search is active, the home box is not shown (one search, in place)', () => {
  renderHome({ hasAnyNotes: true, searchActive: true })
  expect(screen.queryByRole('searchbox', { name: 'Search your notes' })).toBeNull()
})
```

```jsx
// FolderSidebar.test.jsx additions (pattern at :2153-2157)
it('a search request with a seed opens search holding that text', () => {
  const { rerender } = renderSidebar({ searchRequest: 0 })
  rerender(sidebar({ searchRequest: 1, searchSeed: 'nvda' }))
  expect(screen.getByRole('textbox', { name: 'Search your notes' }).value).toBe('nvda')
})
it('escapeRestores: Escape clears the search and reports search mode off', () => {
  const onMode = vi.fn()
  const { rerender } = renderSidebar({ searchRequest: 0, onSearchModeChange: onMode })
  rerender(sidebar({ searchRequest: 1, searchSeed: 'nvda', onSearchModeChange: onMode }))
  const box = screen.getByRole('textbox', { name: 'Search your notes' })
  fireEvent.keyDown(box, { key: 'Escape' })
  fireEvent.keyDown(box, { key: 'Escape' })
  expect(onMode).toHaveBeenLastCalledWith(false)
})
```

The second Escape matches today's "Escape clears or leaves search" behaviour (`:1460-1472`): the first clears, the second leaves. Read that handler and assert the real sequence. Run both files. Expected: FAIL.

- [ ] **Step 2: Implement**

`HomeSearch`:

```jsx
export function HomeSearch({ hidden = false }) {
  const navigate = useNavigate()
  if (hidden) return null
  return (
    <input type="search" className={styles.searchBox} data-home-search="" aria-label="Search your notes"
      placeholder="Search your notes" autoComplete="off"
      onChange={(e) => {
        if (e.target.value) navigate(`/journal/notebook${NOTEBOOK_SEARCH_HASH}`, { state: { q: e.target.value } })
      }} />
  )
}
```

Keep the `.searchBox` look. Add input styles (border, padding, ≥ `var(--tap-min)` on touch) in `ResearchHome.module.css`. Find where the old button's visual came from and keep the same appearance. Pass `<HomeSearch hidden={searchActive} />` in `homeTop`.

`NotebookTab` (`:447-452`): store `const seed = location.state?.q || ''` and pass `searchSeed={seed}` to FolderSidebar next to `searchRequest` (`:2030`). Add `const [sidebarSearching, setSidebarSearching] = useState(false)`, then pass `onSearchModeChange={setSidebarSearching}` to FolderSidebar and `searchActive={sidebarSearching}` to ResearchHome.

`FolderSidebar`: accept both props. In the `searchRequest` effect (`:957-968`), also `setQuery(searchSeed || '')`. Add `useEffect(() => { onSearchModeChange?.(mode === 'search') }, [mode])`. Keep its dependency list minimal (`[mode]`), so it cannot loop (H14).

- [ ] **Step 3: Run, then commit**

```bash
cd app && npx vitest run src/pages/journal-2-0/components/notebook/ResearchHome.homeSearch.test.jsx src/pages/journal-2-0/components/notebook/FolderSidebar.test.jsx src/pages/journal-2-0/components/notebook/ResearchHome.homeTop.test.jsx src/pages/journal-2-0/tabs/NotebookTab.test.jsx > /tmp/p0-t12.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Commit message: `feat(notebook): P0.13 search once, in place: the home box hands off and steps aside`.

---

### Task 13: P0.14 + P0.16: "Add a formula" first; the plan-grade card moves up

**Files:**
- Modify: `B/PropertiesSection.jsx:515-584`
- Modify: `J/components/trade/TradeDetailPage.jsx:618-625, 785-793`
- Test: `B/PropertiesSection.formulas.test.jsx` (extend), `J/components/trade/TradeDetailPage.test.jsx` (extend)

- [ ] **Step 1: Failing tests**

```jsx
// PropertiesSection.formulas.test.jsx additions (its mocks + latchNotebookFlags)
it('with formulas on, "Add a formula" is the first choice in Add property', () => {
  latchNotebookFlags({ notebook_formulas_enabled: true })
  renderSection()
  fireEvent.click(screen.getByRole('button', { name: 'Add property' }))
  const first = within(pickerEl()).getAllByRole('button')[0]
  expect(first.textContent.trim()).toBe('Add a formula')
  fireEvent.click(first)
  expect(screen.getByRole('combobox', { name: 'Property type' }).value).toBe('formula')
})
it('with formulas off, there is no "Add a formula"', () => {
  latchNotebookFlags({ notebook_formulas_enabled: false })
  renderSection()
  fireEvent.click(screen.getByRole('button', { name: 'Add property' }))
  expect(screen.queryByRole('button', { name: 'Add a formula' })).toBeNull()
})
```

```jsx
// TradeDetailPage.test.jsx addition (PlanGradeCard is mocked to 'plan-grade-stub')
it('the plan-grade card sits right after the entry-context card, above the outcome grid', async () => {
  renderTradePage({ planGrading: true })
  const stub = await screen.findByTestId('plan-grade-stub')
  const outcome = screen.getByTestId('trade-outcome-grid')
  expect(stub.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
```

If the outcome grid (`:625`) has no test id, add `data-testid="trade-outcome-grid"` to it in this task.

- [ ] **Step 2: Implement**

In the picker (`:515-584`), as its first element, when `formulasOn`:

```jsx
{formulasOn && (
  <button type="button" className={styles.pickerItem}
    onClick={() => { setNewPropOpen(true); setNewPropType('formula') }}>
    Add a formula
  </button>
)}
```

Use the class the picker's other rows use.

On `TradeDetailPage.jsx`, move the `{planGradingEnabled() && (<Suspense …><PlanGradeCard …/></Suspense>)}` block (`:785-793`) to directly after `EntryContextCard` (`:623`), before the outcome grid (`:625`). Do not change its props.

- [ ] **Step 3: Run, then commit**

```bash
cd app && npx vitest run src/pages/journal-2-0/components/notebook/PropertiesSection.formulas.test.jsx src/pages/journal-2-0/components/notebook/FormulaEditor.test.jsx src/pages/journal-2-0/components/trade/TradeDetailPage.test.jsx src/pages/journal-2-0/components/trade/PlanGradeCard.test.jsx > /tmp/p0-t13.log 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Commit message: `feat(notebook): P0.14 Add a formula first; P0.16 plan-grade card above the fold`.

---

### Task 14: The exit-bar door audit, committed and re-runnable

The 2026-10-11 audit's script stayed in a session scratch dir. The exit bar needs a committed instrument: one that checks every door the audit graded HARD or HIDDEN, at 1280 and 390, in a real browser, against the c2 sandbox.

**Files:**
- Create: `tools/notebook_door_audit.py`
- Create: `tools/notebook_door_audit_doors.json` (the door table)
- Create: `tests/test_notebook_door_audit.py` (pure: table shape, fold rule, verdict logic; `--self-check`)

**Interfaces:**
- Door row: `{"feature": str, "audit_row": int, "path": str, "steps": [{"click": "<role>|<name>"}...], "target": {"role": str, "name": str} | {"css": str}, "viewports": ["1280","390"], "flag": str|null}`.
- Verdict per row and viewport:
  - EASY: target visible, above the fold, ≤2 steps.
  - OK: visible, ≤3 steps or one scroll.
  - HARD: more steps, or below the fold with no label.
  - HIDDEN: not reachable from `path`.
  - NOT_MEASURED: setup failed.
- Exit: 0 when no row is HIDDEN and every HARD row has a `"reason"`; 1 otherwise; 2 when nothing was measured.

- [ ] **Step 1: Write the door table for the 16 HARD/HIDDEN rows** (audit rows 11, 15, 23, 24, 26, 29, 32, 33, 34, 35, 39, 40, 41, 42, 46, 53), using the post-P0 doors:
  - row 11: View select at 390 (`combobox` "View") and buttons at 1280
  - row 15: Details → Add property → "Add a formula"
  - row 23: Home → caret "More ways to start a note" → "Voice note"
  - row 24: phone editor "Insert" → "Image"
  - row 26: home region "Ask your Notebook"
  - row 29: "See what it can do" must mention Compass reading notes. Add a `compass-notes` entry to `CAPABILITY_PREVIEW` in Task 9's commit if `COMPASS_NOTES_TOOL_ENABLED` has a client flag, otherwise give the row a written reason.
  - row 32: slash "/due" → "Due date"
  - rows 33–35: Import → "Capture from anywhere" links
  - row 39: chart toolbar "Plan" uncovered after scrollIntoView
  - row 40: fingerprint panel "Visual playbook" button
  - row 41: home "Open the setups board"
  - row 42: carries the reason "needs the overnight run" (a reason, not a pass)
  - row 46: home "Notices"
  - row 53: carries a reason, or a door via "See what it can do". Decide in the table and write it down.

- [ ] **Step 2: Write the tool**

It reuses `tools/notebook_fin_walk.py`'s `member`, `new_ctx`, `goto` and `vis_loc`, plus the sample-notebook add from Task 11 for chart rows. For each row and viewport, it runs the steps by role and name, measures the target's `getBoundingClientRect().top < innerHeight`, and checks `elementFromPoint` at its centre is the target or inside it. It writes `docs/notebook/evidence/door-audit-<stamp>/doors.json` and a markdown table.

`--self-check` runs the verdict function on three synthetic measurements (visible + above the fold + 1 step → EASY; not found → HIDDEN; HARD without a reason → exit 1). It exits non-zero if any verdict is wrong.

- [ ] **Step 3: Pure tests**

```python
# tests/test_notebook_door_audit.py
import json, subprocess, sys
from pathlib import Path
import tools.notebook_door_audit as A

def test_every_hard_or_hidden_audit_row_has_a_door_or_a_reason():
    rows = json.loads(Path("tools/notebook_door_audit_doors.json").read_text(encoding="utf-8"))
    covered = {r["audit_row"] for r in rows}
    assert {11, 15, 23, 24, 26, 29, 32, 33, 34, 35, 39, 40, 41, 42, 46, 53} <= covered

def test_verdicts():
    assert A.verdict({"found": True, "above_fold": True, "steps": 1, "uncovered": True}) == "EASY"
    assert A.verdict({"found": False}) == "HIDDEN"
    assert A.verdict({"found": True, "above_fold": False, "steps": 4, "uncovered": True}) == "HARD"

def test_self_check_can_fail():
    r = subprocess.run([sys.executable, "tools/notebook_door_audit.py", "--self-check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
```

Run: `python -m pytest tests/test_notebook_door_audit.py -q`. Expected: 3 passed. Mutation-prove `verdict`: make it always return "EASY" and confirm the tests fail. Restore by captured bytes.

- [ ] **Step 4: Commit**: `tools(notebook): committed door audit for the P0 exit bar`.

---

### Task 15: Walk steps for every new door, then the exit bar

**Files:**
- Modify: `tools/notebook_fin_walk_features.py` (`ORDER` :35-37 gains `"discover"`; `run("discover", discover)` registered; `run()` already FAILs unregistered names)

- [ ] **Step 1: Add the `discover` step**

Each sub-check is one `C.step(...)` with PASS or FAIL and evidence:

- `discover.new-note-home` (1280): the "New note" button is in the home header. Clicking makes a note (the list count goes up by 1). The caret menu lists exactly the items whose flags are on.
- `discover.phone-toolbar-inside` (390): open a note. Every button in `[data-tour="note-toolbar"]` that is not inside a hidden `formatRun` has `rect.right <= innerWidth`. Record the boxes.
- `discover.phone-folders-visible` (390): the Folders drawer button is visible and uncovered on Home.
- `discover.chart-plan-clickable` (1280 and 390): in a sample note with a chart, `scrollIntoView` the Plan button. `elementFromPoint(center)` is Plan or inside it, and clicking it opens the plan panel.
- `discover.notices` (1280): after the existing `resurface` step, home shows "Notices · N" with N ≥ 1, and opening a row lands on the row's href.
- `discover.setups-box` (1280): "Active setups · …" is above the fold, and "Open the setups board" lands on the board. The board has "Back to Notebook".
- `discover.one-ask` (1280): exactly one region "Ask your Notebook".
- `discover.due-date` (1280): in a note, type `/due` + Enter, then choose "Tomorrow". A `[data-type="date-mention"]` exists.
- `discover.capture-doors` (1280): the Import dialog shows "Capture from anywhere".
- `discover.learn-groups` (390): Learn opens a dialog with grouped tours and, for a paid member with onboarding on, "Add the sample notebook".
- `discover.search-in-place` (1280): type into the home search box. The sidebar search holds the text and the home box is gone (one `aria-label="Search your notes"` input on screen).
- `discover.chart-tour-no-deadend` (1280): a member with one text-only note starts "Chart plan basics" from Learn. The card says "needs a chart in a note" and offers "Add the sample notebook". Pressing it starts the tour.

Selectors are by role and name, the way the rest of the walk drives the product.

- [ ] **Step 2: Rebuild, boot the sandbox and walk c2 (PowerShell for the data dir)**

```bash
cd app && npm run build > /tmp/p0-build.log 2>&1; code=$?; echo "BUILD EXIT: $code"; exit $code
```

```powershell
python tools/notebook_fin_walk.py --config c2 --data-root 'C:\Users\Patrick\AppData\Local\Temp\nb-p0-walk' --port 8132 --out 'C:\Users\Patrick\uct-worktrees\notebook-p0\docs\notebook\evidence\fin-walk\<tip>\c2' --tip <tip>
```

Expected: 0 FAIL. Diff verdicts against `docs/notebook/evidence/fin-walk/af0b7ffeea/c2/walk.json`. Any step that passed there and fails now is a regression, fixed before landing.

- [ ] **Step 3: Run the door audit (exit bar)**

```bash
python tools/notebook_door_audit.py --base http://127.0.0.1:8132 --doors tools/notebook_door_audit_doors.json --out docs/notebook/evidence
```

Expected: exit 0 (zero HIDDEN; every HARD carries a written reason). Write the before/after table into `docs/notebook/verify-1009.md` §8, "P0 exit bar", citing both evidence directories.

- [ ] **Step 4: Commit** the walk change and evidence: `test(notebook): P0 walk steps + exit-bar evidence (0 FAIL, 0 HIDDEN)`.

---

### Task 16: Gate, land, deploy and verify

- [ ] **Step 1: Six-shard gate from a separate worktree** (a gate never shares a tree with an implementer)

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-presets-spec
git worktree add ../notebook-p0-gate notebook-p0 && cd ../notebook-p0-gate && git checkout -B notebook-p0-gate
```

Junction `node_modules` (Task 0 Step 2, new path), then:

```bash
python scripts/gate_shards.py --shards 6 > /tmp/p0-gate.log 2>&1; code=$?; echo "GATE EXIT: $code"; exit $code
```

Read the manifest: the totals, the file-count reconciliation and `GATE EXIT`. Classify any NEW failure by running it alone on the branch and on master.

- [ ] **Step 2: Python rails on the landing tree** (C4-python is mandatory because `tools/` changed)

```bash
python -m pytest tests/test_notebook_door_audit.py tests/test_entry_context_bell_copy.py -q
python tools/gate_carry_over.py --edges-json <(node tools/import_edges.mjs) <gated tree> <landing tree>
```

- [ ] **Step 3: PR and merge**

One master merge at a time. Wait for `web` SUCCESS before any other push. The PR body ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Q6G9ghokX26jNrDBvxcZjP
```

- [ ] **Step 4: Verify the deploy by its artifact**

1. Read the `railway deployment list` meta commitHash.
2. Wait until uptime ≥ 730 s, then run `python tools/hub_nav_smoke.py --auth`.
3. Check ancestry: `git merge-base --is-ancestor <merge sha> origin/production`.

H15: a failing smoke means roll back first; INCONCLUSIVE is not FAILED.

- [ ] **Step 5: Report**

Send one fenced ASCII-safe block with the SHA at top and bottom. It covers the fork verdict (named cause or "not reproduced" with counts), each P0 item shipped, the walk and door-audit numbers, and anything deferred with its reason. Then update the memory file `project_notebook_journal_styles_2026_10_11.md` (P0 status), run the pointer gate and `./commit-memory.sh`.

- [ ] **Step 6: Clean up the session worktrees** (only the ones this session made, checked against `.uct-session-owner`)

Remove the junctions first with `cmd /c rmdir`, then run `git worktree remove` for `notebook-p0-gate`, and for `notebook-p0` once merged.

---

## Self-review (done at write time)

- **Spec coverage:** every P0 item maps to a task.
  - P0.0 → Task 1
  - P0.1, P0.17 → Task 2
  - P0.2 → Task 3
  - P0.3, P0.12, P0.15 → Task 11
  - P0.4 → Task 4
  - P0.5 → Task 5
  - P0.6 → Task 6
  - P0.7 → Task 7
  - P0.8 → Task 8
  - P0.9 → Task 9
  - P0.10: door in Task 2, preview in Task 9, tour in Task 10
  - P0.11 → Task 10
  - P0.13 → Task 12
  - P0.14, P0.16 → Task 13
  - Exit bar → Tasks 14 and 15
  - Ship → Task 16

  The audit's extra findings: the misleading fill notice is in Task 4, the board's empty copy and back link in Task 5, and "See what it can do" linking nothing in Tasks 8 and 9. The duplicate corner icons are left alone: the Compass cluster is not the Notebook's to change. The audit marked the icon claim as a guess, and it goes into the PR body as deferred.
- **Placeholders:** three lookups are explicit steps with a command, not guesses:
  - the sticky offset variable (Task 3)
  - the capture flag names (Task 8)
  - the AskPanel stub id and test paths

  Task 1's fix code depends on the trace by design; its deliverables, rail shape and stop condition are fixed.
- **Type consistency:**
  - `NewNoteMenu({onBlank, onFromOutline, onVoice, onToday})`: Task 2, reused by the Task 10 tour anchors.
  - `toNotices`: Task 4.
  - `dateChoices` / `runDateCommand`: Task 9.
  - `learnTourGroup` / `LEARN_GROUPS`: Task 11.
  - `searchSeed` / `onSearchModeChange` / `searchActive`: Task 12.
  - `BOARD_URL` moved to `lib/setupsBoardLink.js`: Task 5.
- **Review Focus:** each of the 5 lines names its test, in Tasks 2, 6+15, 4, 11 and 12.
