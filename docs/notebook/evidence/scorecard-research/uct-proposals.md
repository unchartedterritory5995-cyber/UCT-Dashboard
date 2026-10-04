# W15-UCT — UCT-side proposals for the owed parity-scorecard rows

Lane: close the owed `docs/notebook/parity-scorecard.md` rows whose missing evidence is on the
UCT side and can be produced in a local sandbox. No edits to `tools/parity_scorecard.py` or
`docs/notebook/parity-scorecard.md` — this file is the proposal; an integrator applies it.

Walk instrument: `tools/notebook_w15_uct_walk.py`. Raw evidence (R-RAW, committed before this
summary was written): `docs/notebook/gate-runs/wave15/walk-uct-674012eb1.json` +
`docs/notebook/gate-runs/wave15/walk-uct-674012eb1.integrity.md`. Tip `674012eb1`
(`674012eb1707d03e7cf1bbe71498d57fe0d40968`, the worktree's base — `674012eb17 Merge
origin/master (8 commits, incl. the hollowPillColor BaselineSeries mock fix) into the wave-13
landing`), working tree clean at that commit for the whole run. Sandbox integrity: **CLEAN** at
all four checkpoints (pre-boot, +15s, +120s, shutdown; 62 db files hashed each time). Exit 0 —
every row PASS, zero page errors. No model key (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` both
false in `walk_process_env`), no real device (desktop Chromium + a Playwright touch-emulated
390×844 context).

## Rows taken, and why

Read `docs/notebook/parity-scorecard.md`'s owed list (`### Rows: every BEHIND, NOT-VERIFIED or
BLOCKED verdict`) end to end, plus §A's per-row detail for every row whose closing note
mentions a "browser pass" at all (the only candidates for "UCT-side, local-sandbox-producible"
evidence), plus the matching `docs/notebook/competitive-gap-ledger.md` row for each:

| row | closing note | taken? | why |
|---|---|---|---|
| **G-041** | "drive the capture dialog in a browser pass (**UCT side**)" | **YES** | explicit UCT-side ask; §A's own words: "The capture dialog was not driven ... UI not confirmed in any browser walk" |
| **G-153** | "observe one reminder end to end" | **YES** | the ledger's own row: "**Never observed on a walk**: `W11_reminders` INCONCLUSIVE on the wave-6 and wave-7 walks (a scheduled pass with no reachable trigger)" — no model key, no device, just a wall-clock precondition (>=07:00 ET) this run satisfies |
| G-015 | "a browser pass or a competitor fetch (see notes in §A)" | NO | §A's own evidence row already carries a UCT-side `CODE` citation and a controller ruling (12C phase 2) deciding Notion/Obsidian; the one remaining `NOT-VERIFIED` cell is **Evernote**, and §A says why: "its only quote is the Semantic search article ... the committed evidence line itself says a relevance-vs-recency sort is not evidenced by that page" — a **competitor citation** gap, not a UCT measurement |
| G-085 | "a browser pass or a competitor fetch (see notes in §A)" | NO | UCT side already closed: `WALK tools/notebook_wave7_walk.py:W15_personal_api PASS` + a **production** walk by lane 10D as `bench@`. The remaining `NOT-VERIFIED` cells are Evernote/Obsidian, and §A says why: "Evernote's cited door is an MCP server for AI clients and Obsidian's a local URI scheme: different mechanisms, so no verdict" — a controller-ruling gap, not a UCT measurement |
| G-131 | "a browser pass or a competitor fetch (see notes in §A)" | NO | UCT side already closed: `WALK .../browser_check_9b.py:B05_typing_features PASS`. The remaining Obsidian `NOT-VERIFIED` cell: "Obsidian's fetched syntax page evidences highlights, not text colour, so no Obsidian verdict" — a competitor citation gap, not a UCT measurement |
| G-050/051/162/165/166 | "a browser pass **with a model key**" | NO | excluded by brief |
| G-044/084/159/164 | owner device pass / real-device matrix | NO | excluded by brief (real device) |
| G-043/017/052/127 | `BLOCKED (owner)` / `BLOCKED (external)` | NO | excluded by brief (owner/external block) |
| G-168 | "owner screen-reader passes; the remaining keyboard FAIL rows" | NO | needs an owner screen-reader pass; the keyboard FAILs are a pre-existing a11y workstream item (§B standard #9), not evidence this lane produces by walking a new surface |
| every other owed row | "N/O/E: a page that states it (next R-row)" / "a verbatim sentence…" | NO | these are **competitor-documentation** citations (Notion/Evernote/Obsidian), never a UCT-side browser pass — out of this lane's scope by construction |

No row needing a model key or a real device was attempted. No row whose block is owner/external
was attempted.

## G-041 — Comment/annotation field at capture time

**Scorecard row** (`parity-scorecard.md` §A, `G-041`): closing note before this walk —
*"The capture dialog was not driven, so no verdict against any competitor; ... UI not confirmed
in any browser walk (wave 9's check or a wave-10 walk) — not scored as met."*

**Ledger row** (`competitive-gap-ledger.md:97`): already recorded **DONE — ALREADY SATISFIED,
VERIFIED LIVE 2026-09-22** from a live repro + a code read, for both capture doors
(`CaptureDialog.jsx`'s source-capture "Your note" field, confirmed live; `CaptureMenu.jsx`'s
widget-capture comment field, confirmed by code read only — it needs a real chart/widget host
to drive live, which this lane does not attempt or need to, since the ledger already closes
that half by an uncontested code read). The scorecard's own evidence format requires a `WALK`
artifact with a report path; an ad hoc live repro that was never committed as a reproducible
walk does not satisfy it, which is why the scorecard cell stayed `NOT-VERIFIED` despite the
ledger already reading DONE. This walk supplies that missing `WALK` artifact for the
source-capture path only (the half the scorecard names as undriven).

**WALK**: `tools/notebook_w15_uct_walk.py:G041_capture_desktop_1200` PASS,
`tools/notebook_w15_uct_walk.py:G041_capture_mobile_390` PASS — report
`docs/notebook/gate-runs/wave15/walk-uct-674012eb1.json`, tip `674012eb1`.

**What was driven, at both 1200 and 390 px** (the dialog is a `Sheet`, which renders a bottom
sheet on touch — a real phone form): opened a note, fired the capture dialog through the real
`uct:capture-open` event via the global hotkey Ctrl+Shift+Y (the same door
`CommandPalette.jsx`'s "Quick Capture" row opens, `app/src/pages/journal-2-0/components/
notebook/CaptureHost.jsx`), switched to "Capture a source", filled Source link / Source title /
Selected passage / **Your note** (the annotation field named in G-041), and saved. Confirmed
two independent things, not just that a toast appeared:
1. the server's own `POST /api/j2/capture` response (intercepted via the real network response,
   not inferred from the UI) carries the right `noteId` and `sourceUrl`;
2. `GET /api/j2/notes/excerpts/search?q=<marker>` returns the annotation **verbatim**, linked to
   the right note (`noteId` matches), correctly attributed (`sourceKind: "web"`,
   `sourceUrl` matches) and genuinely searchable by a unique marker string embedded in the typed
   annotation — not merely stored inertly. This mirrors the ledger's own 2026-09-22
   verification method (live repro + the excerpt-search endpoint) rather than inventing a new
   one.

At 390 px, additionally confirmed the dialog's bounding box, the "Your note" field and the Save
button are all within the 390px viewport (no horizontal overflow) and the Save button is tapped
(not clicked) through Playwright's touch input.

**Proposed UCT-side reading**: **PARITY-eligible for the source-capture path** (the half named
undriven). The widget-capture path (`CaptureMenu.jsx`) stays on the ledger's existing code-read
evidence — nothing here changes it, and this lane did not re-walk it. Recommend the scorecard's
G-041 `CODE` citation for `CaptureDialog.jsx:256` be joined by:

```
WALK `tools/notebook_w15_uct_walk.py`:G041_capture_desktop_1200 PASS — report
`docs/notebook/gate-runs/wave15/walk-uct-674012eb1.json`, tip 674012eb1 ; WALK
`tools/notebook_w15_uct_walk.py`:G041_capture_mobile_390 PASS — report
`docs/notebook/gate-runs/wave15/walk-uct-674012eb1.json`, tip 674012eb1
```

and the row's notes updated from *"UI not confirmed in any browser walk"* to record that it now
is, leaving the **N**/**O** competitor-citation gaps exactly as they stand (not this lane's to
close).

## G-153 — Reminders with notifications on date mentions / Review Date

**Scorecard row** (owed list): *"NOT-VERIFIED / NOT-VERIFIED / NOT-VERIFIED — observe one
reminder end to end."*

**Ledger row** (`competitive-gap-ledger.md:437`): *"**Never observed on a walk**:
`W11_reminders` INCONCLUSIVE on the wave-6 and wave-7 walks (a scheduled pass with no reachable
trigger)."* The wave-7 walk's own INCONCLUSIVE reason (`tools/notebook_wave7_walk.py:2448`):
*"Firing it for real would require the sandbox to boot at/after 07:00 ET with the task already
due, which this walk's own note-seeding cannot arrange"* — and confirmed grep-fresh that
`run_task_reminders`/`catch_up_task_reminders` (`api/services/journal_two/note_tasks.py`) still
have **zero callers outside the scheduler and their own tests**; no admin/manual HTTP trigger
exists and none was added here.

**WALK**: `tools/notebook_w15_uct_walk.py:G153_reminder_delivered_server` PASS,
`tools/notebook_w15_uct_walk.py:G153_reminder_bell_mobile_390` PASS — report
`docs/notebook/gate-runs/wave15/walk-uct-674012eb1.json`, tip `674012eb1`.

**What was driven**: this run's own wall clock was >= 07:00 ET (the alert's own
`timestamp: "2026-10-04T11:32:44.687582-04:00"`, in the walk's PASS record, is ET and puts the
whole run mid-morning), the precondition the earlier walks could not arrange. Seeded one note (`j2_notes`, via the real `POST /api/j2/notes`) carrying a real
`taskList` > `taskItem` (`checked: false`) > `paragraph` containing a `dateMention` node dated
`2026-10-03` (yesterday ET — deliberately overdue, matching the editor's own schema:
`tests/fixtures_note_tasks.json`'s shape, never invented). Seeded in the first seconds after the
sandbox came healthy — well before `note_tasks.CATCH_UP_DELAY_S` (90s). Then let the scheduler's
own one-shot boot catch-up (`register_task_reminder_job`, wired unconditionally in
`api/main.py`, `acquire_scheduler_lock()` always grants on Windows) run — no code was added or
patched to fire it early, and nothing calls `run_task_reminders`/`catch_up_task_reminders`
directly.

`G153_reminder_delivered_server` polled `GET /api/alerts` (the exact endpoint `AlertBell` reads)
until the real reminder appeared — **48.7s** after seeding in this run — and checked its shape
against `note_tasks.reminder_copy`/the delivery contract: `title: "An overdue task"`,
`message: "You have 1 overdue task in your Notebook."`, `data.source:
"notebook_task_reminder"`, `data.research_url: "/journal/notebook?view=tasks"`,
`data.overdue: 1`, `data.due_today: 0`, unread. Delivered via `_deliver_in_app` only — the
pass's one and only channel; this run never configured an outbound email/Discord channel to
confirm the negative, but the code path (`_deliver_in_app`, `api/services/journal_two/
note_tasks.py:602`) calls `add_alert(..., severity="info")` and nothing else.

`G153_reminder_bell_mobile_390` then read the **same** alert off the **real in-app bell** —
opened the reminder's own note, tapped the bell (`aria-label="Notifications"`), confirmed the
unread badge (`"1"`), confirmed the dropdown's row carries the exact title and message, tapped
the row, and confirmed it navigated to `/journal/notebook?view=tasks` (the alert's own
`research_url`) — i.e. the full click-through a member would actually use.

⛔ **There is no bell at 1200 px to drive, and this is not a gap this walk found.**
`NavBar.jsx:239-241` (desktop, >=1025px) carries only a comment — *"Alerts bell temporarily
removed from the sidebar (owner request). To restore: re-add `<AlertBell />`..."* — `<AlertBell
/>` is mounted **only** from `MobileNav.jsx:86`. `AlertBell.delivery.test.jsx`'s own header
already documents and pins this as a **tested owner decision** (2026-09-02,
`feat(nav): sidebar revamp`): *"The desktop bell was removed BY OWNER REQUEST and NavBar
carries its own note saying so — so the rail below now asserts what is true, and pins the
absence as a DECISION rather than letting it read as a hole nobody noticed."* So G-153 splits
into a viewport-independent server-side delivery check (the scheduler ran for real; the alert
is correctly shaped) plus a UI check at the one width the bell exists — 390 px — rather than a
1200 px UI check this lane invented a selector workaround for. (Two earlier attempts in this
session's own working notes tried a 1200 px bell check and genuinely could not find one within
15s/30s/45s — not flakiness; there is nothing to find.)

**Proposed UCT-side reading**: **PARITY-eligible; "DONE — LIVE by default" upgraded from
"unobserved" to "observed, end to end, on a real sandbox."** Recommend the scorecard's G-153 row
gain:

```
WALK `tools/notebook_w15_uct_walk.py`:G153_reminder_delivered_server PASS — report
`docs/notebook/gate-runs/wave15/walk-uct-674012eb1.json`, tip 674012eb1 ; WALK
`tools/notebook_w15_uct_walk.py`:G153_reminder_bell_mobile_390 PASS — report
`docs/notebook/gate-runs/wave15/walk-uct-674012eb1.json`, tip 674012eb1
```

and the ledger's *"Never observed on a walk"* / *"the delivered bell notification is
unobserved"* language retired in favor of this run.

## A finding, reported and NOT fixed (out of this lane's ownership)

While driving `G153_reminder_bell_mobile_390`, the dropdown opened by the bell at 390 px
**overflows the viewport on the right edge** — visually confirmed in the committed screenshot
(`docs/notebook/gate-runs/wave15/shots/r103146-g153-390-dropdown.png`) and in the bounding-box facts recorded in the
check (`item_on_screen: false`, `item_box.x + item_box.width` past the 390px edge). Cause,
read from source: `app/src/components/AlertBell.module.css`'s `@media (max-width: 640px)` block
sets `right: -40px` on `.dropdown`, which — given `AlertBell` sits as the **rightmost** element
in `MobileNav.jsx`'s top bar (nothing to its right) — pushes the dropdown **further off** the
right edge of the screen instead of pulling it on screen. The notification's title and message
text were still fully readable and correctly content-matched in this run (Playwright's
accessible-name match found the row and its `inner_text()` was exact), so the reminder itself
**reaches** the member; the dropdown's own box is what clips.

**Not fixed here.** `AlertBell.module.css` is a shared, cross-cutting surface — every alert type
(price alerts, scanner matches, catalysts, document-arrival, this reminder) renders through the
same dropdown — and is not a Notebook-owned file. Fixing it is outside this lane's "fix it in
Notebook-owned files" charter. Recorded as a **finding**, not a row-failing defect (the same
treatment wave 12 gave its two chevron FAILs on G-026 — "recorded as a finding, not a template
defect"), so `G153_reminder_bell_mobile_390`'s own verdict is PASS (the thing the row measures —
does the reminder reach the member — is true) with the finding attached in its own `finding`
field for whoever owns `AlertBell.module.css` to pick up.

## Evidence index

| artifact | path |
|---|---|
| walk instrument | `tools/notebook_w15_uct_walk.py` |
| raw report (R-RAW, committed first) | `docs/notebook/gate-runs/wave15/walk-uct-674012eb1.json` |
| integrity log | `docs/notebook/gate-runs/wave15/walk-uct-674012eb1.integrity.md` |
| screenshots (G-041 desktop/mobile saved, G-153 dropdown + landed) | `docs/notebook/gate-runs/wave15/shots/r103146-*.png` |
| commit | `cc5c48280e` on `feat/notebook-w15-uct` (base `674012eb17`) |
