# WAVE Q1 — PRODUCT FOLLOW-UPS AND NAMED RIG LIMITATIONS

**Opened 2026-09-13, under two owner rulings taken while the Q1-F5 production table
was being driven.** This file holds two things the F5 table cannot hold itself:

1. a **product** question the rig surfaced while measuring something else, filed as a
   follow-up row rather than fixed — the programme decides, not the session that
   found it;
2. the rig's **named limitations**, recorded as limitations rather than as failures,
   so a cell this rig cannot measure is answered by a name instead of a guess.

⛔ **Nothing here is a fix, and nothing here is a decision.** Every row states what
was measured, what the mechanism is, what is NOT known, and what it needs from the
owner. A row that proposed its own fix as settled would be the programme deciding by
default, which is the one thing a follow-up file must not do.

⛔ **A citation you cannot quote is STRUCK, not softened.** Every `file:line` below
was read and the line is quoted beside it.

⚠️ **LINE NUMBERS HERE ARE AS OF 2026-09-13 AND `tools/q1_f5_matrix.py` IS UNDER
ACTIVE EDIT.** The file grew from 1,665 to 1,792 lines between two reads in the same
session (a `--second-writer` experiment landed mid-read). **Match the quoted TEXT,
not the number** — that is the whole reason each citation carries its line.

⚠️ **Nothing links to this file yet.** It is referenced by no manifest row, no resume
file and no runbook. Linking it from `PROGRAM-MANIFEST.md` belongs to that file's
owner; a follow-up ledger nobody can reach from the manifest is a ledger that reads as
coverage without being read.

---

## 1. PRODUCT FOLLOW-UPS

Ids in this section are **owned by this file** (`F5P-*`) and are deliberately not
manifest ids. Nothing here is a `Q1-*`, `R-*`, `S-*` or `T-*` row, and none of it
should be cited as one.

### F5P-1 — sitting on the note is a state in which queued words never leave

> ⚖️ **RULED 2026-09-23 — decision D3 (`NOTEBOOK-10-OF-10-PLAN.md` §3): option B,
> release it — by the single writer that owns the note, never by the sweep.** Wave 5
> landed the offline layer's half (`recover()` → `adopt` / `base`, `settleOwnerFork`)
> and proved the editor's half (E-1 adopt the queued words on the copy they were written
> on, E-2 Restore on that same base, E-3 settle the owner's fork) end to end against a
> copy of the committed editor: 7 / 7 green, 6 / 7 red without it. The editor half
> landed as `fe4e278bc`; review fix round 1 then closed two ways it could lose words
> the member typed DURING an adoption or an owner's fork (S1, S2 — `f5-fixes-2026-09-23.md`
> §C), with 7 new end-to-end cells that are red on `fe4e278bc`. Also found and folded in:
> Restore after a moved server clobbered it (measured: 0 forks, the other device's words
> gone) — closed for queued words, ⛔ **NOT for a crash-draft winner**, whose base is
> unknown (§C.5). Design, measurements, mutations: `docs/notebook/f5-fixes-2026-09-23.md`
> §B and §C. Everything under this box is the 2026-09-13 record, kept as it was.

| | |
|---|---|
| status | 🟠 **RULED (D3) — both halves landed on `feat/notebook-10`; not on master, not measured on production** (was: 🟡 OPEN — owner ruling required) |
| found | 2026-09-13, on **production**, with the Wave Q1 rig, while driving the F5 table |
| found by | `tools/q1_f5_matrix.py` — as a side observation of the `--navigate-no-door` control, **not** as a cell verdict |
| proposed owner | **Wave Q1 (the save path).** It is the drain's contract meeting the editor's save gate; both are Q1's |

#### What was measured

The rig queued an offline edit to a note, returned to that note, and watched the
durable store. **Nothing was sent for 120 seconds.** The tool records it in its own
source, at the step where it happened:

> `tools/q1_f5_matrix.py:1296-1300`
> ```python
>         # ⛔⛔ THE EDITOR OWNS ITS OWN NOTE, so the drain SKIPS it (`excludeNoteId`).
>         # Measured 2026-09-13: after returning to the note, nothing was sent for
>         # 120s — the entry was not stuck, it was simply not the drain's to send,
>         # and the editor does not re-save content it did not change. Sitting on
>         # the note is therefore a state in which queued words never leave.
> ```

**How it was observed, precisely.** The cell's drain wait polls the durable store and
reports what it saw:

> `tools/q1_f5_matrix.py:1329-1333`
> ```python
>         drained, waited = False, 0
>         trail = []
>         for _ in range(48):
>             page.wait_for_timeout(2500)
>             waited += 2.5
> ```

⭐ **So `120s` is the span the rig sat and watched, not a ceiling it established.**
48 polls × 2.5 s is the loop's full budget; the observation is that the queue did not
move inside it. Nothing here measures what happens at 121 s, and this file does not
claim it.

⛔ **The observation exists only because the rig did what a member does next.** The
tool's next comment says so in its own words:

> `tools/q1_f5_matrix.py:1302-1304`
> ```python
>         # ⭐ So the cell does what a member does next: it leaves the note. That
>         # releases the entry to the drain WITHOUT firing any door, which is the
>         # only way this experiment can reach the question it is asking.
> ```

Leaving the note released the entry. That is the shape of the finding: the measurement
was reachable only through the member's own escape from the state.

#### The mechanism — the real code, quoted

The drain is handed the id of the note the editor currently owns, and skips it:

> `app/src/pages/journal-2-0/lib/offline/outboxDrain.js:262-264`
> ```js
>  * @param excludeNoteId  the note the editor currently owns. ⛔ Two writers on
>  *              one note is the last-write-wins this wave exists to forbid; the
>  *              open note is the editor's to save, never the sweep's.
> ```

> `app/src/pages/journal-2-0/lib/offline/outboxDrain.js:288-291`
> ```js
>     if (excludeNoteId && entry.noteId === excludeNoteId) {
>       results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: SKIPPED })
>       continue
>     }
> ```

> `app/src/pages/journal-2-0/lib/offline/outboxDrain.js:31`
> ```js
> export const SKIPPED = 'skipped'    // the open editor owns this note right now
> ```

The value comes from the tab that owns the editor's route:

> `app/src/pages/journal-2-0/tabs/NotebookTab.jsx:77`
> ```jsx
>   const drain = useOutboxDrain({ accountId: auth?.user?.id, excludeNoteId: noteId })
> ```

And the other half — why the editor does not send it either — is its own save gate,
which returns before building a patch when nothing changed:

> `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx:1501-1505`
> ```js
>     if (!titleChanged && !subtitleChanged && !bodyChanged) {
>       setSaveStatus('saved')
>       retryAttemptsRef.current = 0
>       return
>     }
> ```

**Both halves are correct in isolation, and the state is the gap between them.** The
drain declines because the note is the editor's; the editor declines because what is
on screen matches what it last saved. Neither is wrong. Nobody sends.

#### Why this is NOT a drain defect

- **The skip is the wave's own invariant, stated at the parameter.** *"Two writers on
  one note is the last-write-wins this wave exists to forbid"*
  (`outboxDrain.js:262-264`). Removing the skip would reintroduce exactly the class
  Q1 was built to end.
- **The entry is SKIPPED, not BLOCKED, and the code says the difference matters.**
  They are separate outcomes on separate branches (`outboxDrain.js:288-293`), and the
  drain's comment at its other skip site reads *"⛔ SKIPPED, NOT BLOCKED. Nothing is
  wrong with this entry — it is simply"* (`outboxDrain.js:379`). Nothing is stuck,
  nothing is retired, no word is at risk on disk.
- **The offline layer already says `excludeNoteId` is not the thing to change.**
  > `app/src/pages/journal-2-0/lib/offline/useDurableNote.js:201-203`
  > ```js
  >  * ⛔ `excludeNoteId` is untouched and is NOT the fix. It protects the note while
  >  * it is OPEN; this protects a queued entry whose baseline the editor invalidated
  >  * before handing the note back. Two different windows, two different guards.
  > ```
- **The words are not lost.** They are in the durable working copy and in the queued
  outbox entry — the rig's own control asserts both (`QUEUED_JS` →
  `sentenceInDurableCopy` / `sentenceInQueuedEntry`), and a cell that cannot prove
  them is INCONCLUSIVE rather than a finding.

#### The member-visible consequence — which is the point

**A member who types offline and then simply stays on that note can sit indefinitely
with unsent work and no indication.** The two surfaces that could say so do not fire
in this state:

| surface | why it is silent here |
|---|---|
| the header's *"· waiting to sync"* line | `NoteEditorPage.jsx:1892` gates it on `durable.unsynced` **and** a `saveStatus` of `'error'` or `'reconnecting'`. In this state the last save attempt returned through the no-change branch, which sets `'saved'` |
| the blocked badge (*"edit it again to sync"*) | `permanent === true` only — `blockedNotes.js:19`: `return entry?.permanent === true`. A skipped entry carries no such flag |

⭐ **The product had already written this problem down, one window over.** The
editor's own comment names the same gap for the adjacent case:

> `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx:358-361`
> ```js
>   // existing "waiting to sync" line is gated on the editor's own save attempt
>   // (`error`/`reconnecting`), which on a freshly-opened note is neither — so
>   // the one surface that was honest was honest only while a save was failing.
> ```

⚠️ **The drain knows and nobody asks it.** `outboxDrain.js:708` puts
`skipped: count(SKIPPED),` in the drain summary, and no Notebook surface reads it —
the only `.skipped` consumers under `journal-2-0/**` are the importer and Compass,
neither of which is this queue.

#### What is NOT yet known

⛔ Listed rather than assumed, because each of these is a way the row could be wrong,
or bigger than it looks.

- **No sample size.** The source records one dated observation and does not state how
  many times it was seen. **No F5 cell records it** — the table's recorded cells are
  `folder` × drain-first GREEN, `append_widget_embed` × drain-first RED,
  `append_document_excerpt` × drain-first INCONCLUSIVE, and the `settle-first` N/A row
  for each append family.
- **No ceiling.** 120 s is the watch, not a bound. Whether the entry ever leaves while
  the member stays on the note is unmeasured.
- **No enumeration of other releases.** Leaving the note is the only release this
  observation establishes. Whether a keystroke, a title edit, a tab close, a reload,
  a leadership change on the sync Web Lock, or any periodic tick also releases it has
  not been measured. **A second tab is the interesting one and is untested:**
  `excludeNoteId` is supplied per mount from the route (`NotebookTab.jsx:77`), so a
  second tab sitting on a different note may not exclude it at all — that is a
  hypothesis, not a reading.
- **No member evidence.** This was produced by a rig on a probe note. No member
  report, telemetry row or observation-log entry has been tied to it.
- **Frequency unknown.** How often a real member queues offline work and then stays on
  the same note is measured nowhere in this programme.

#### What it needs to be decided

**The question for the owner, stated once:** *is "queued, correct, and silent" an
acceptable state for a member to be able to sit in — and if not, which half changes,
the surface or the release?*

Options are recorded **as options**, with no recommendation:

| | what it would change | what it would cost |
|---|---|---|
| **A — say it** | a surface that reports a queued entry for the open note, independent of whether a save is failing | new copy on a path that currently shows nothing. The vocabulary already exists (`unsyncedCopy.js`); the gate does not |
| **B — release it** | let something other than leaving the note hand the entry over | touches the two-writers invariant, or the editor's no-change gate, or both — the exact code F5 was measured against |
| **C — record and accept** | nothing in the product; the row closes as a known, named state | the member keeps sitting in it, and the row must then say so somewhere a support answer can reach |

⛔ **B is not free and must not be taken casually.** The F5 freeze
(`f5Freeze.test.js`) covers the drain's classification and the settle; anything in B
that moves them needs the same owner ruling the last amendment needed.

---

## 2. NAMED RIG LIMITATIONS

**These are limitations, not failures.** The rig is the one signed-in Chrome profile
(`canary-chrome-profile-persistent`) driven over CDP by `tools/q1_f5_matrix.py`. Each
entry below says what the rig cannot do, WHY — the mechanism, never *"it failed"* —
what would lift it, and, the part that matters most, **what it does NOT prevent the
programme from concluding.**

⛔ **INCONCLUSIVE is a real answer here and is never dressed up.** The tool stamps it
on the artifact it writes:

> `tools/q1_f5_matrix.py` — the rendered header
> ```
> ⛔ **INCONCLUSIVE is never a pass and never a finding.** A door this rig could not open
> names what was missing. There is no raw-`fetch` fallback: that is a second-writer
> simulation whose fork is correct.
> ```

And it refuses to bank one — `tools/q1_f5_matrix.py:1581`:
`DECIDED = {"GREEN", "RED", "N/A"}`, so an INCONCLUSIVE cell is re-run rather than
kept, *"because banking one would leave a hole in the table wearing a verdict's
clothes"*.

### L-1 — the pdf.js caret: `append_document_excerpt` cannot be driven by this rig

**What the rig cannot do.** Place a caret / make a text selection inside the rendered
pdf.js text layer, which is the first half of the excerpt door. Without a live
selection there is no *"Save excerpt"* popover to click, so the door cannot be opened
at all.

**Why — the mechanism.** The door resolves a real `Range`'s offsets against the pdf.js
`.textLayer` spans while the Range is alive, and CDP-synthesised pointer input does
not produce a selection in that renderer. The tool reports it in those words:

> `tools/q1_f5_matrix.py:594-600`
> ```python
>         return {"ok": False, "rig_limitation": True,
>                 "why": (f"three real pointer gestures (triple-click, double-click, slow drag) "
>                         f"across a {int(box['width'])}x{int(box['height'])}px span produced no "
>                         f"selection. Last reading: ranges={st.get('ranges')} "
>                         f"collapsed={st.get('collapsed')} anchor={st.get('anchor')} "
>                         f"focus={st.get('focus')}. CDP-synthesised pointer input does not "
>                         f"produce a text selection in this renderer")}
> ```

> `tools/q1_f5_matrix.py:523-529` — the measurement behind it
> ```python
>     ⚰️ A drag and a double-click both left `getSelection()` EMPTY while the span
>     under the cursor reported `user-select: text` and `pointer-events: auto`. So
>     this tries the gestures in order of how much a real hand does, and — the part
>     that matters — **reports the selection's INTERNALS after each one**
>     (`rangeCount`, `isCollapsed`, the anchor and focus nodes) rather than only
>     `toString()`. "Empty string" is one observation with several causes: no
>     range at all, a collapsed caret, or a range anchored somewhere unexpected.
> ```

⭐ **The span is not the problem, and that is why this is a caret limitation rather
than a rendering one.** The span was found, was wide enough to drag across, and
reported `user-select: text` with `pointer-events: auto`. What did not happen is the
selection.

**How it currently reads in the table** — `docs/notebook/wave-q1-f5-production-matrix.md`,
`append_document_excerpt` × drain-first:

> **INCONCLUSIVE** — the `append_document_excerpt` door was rig limitation: a real
> pointer drag across a 598x16px span selected nothing — the rig cannot make a
> selection this renderer accepts

⚠️ **THAT RECORDED CELL PREDATES THE CURRENT DRIVER, and the difference is not
cosmetic.** The recorded `why` names **a drag**; the source now emits a string naming
**three gestures**. So the recorded evidence establishes the drag, and the docstring's
⚰️ note adds the double-click. **Triple-click — which the source added precisely
because *"Chromium implements it in the browser rather than leaving it to the page"*
(`tools/q1_f5_matrix.py:576-578`) — has no recorded outcome.** L-1 is firmly
established for the gestures that have readings behind them; the triple-click ladder
is the open question inside it, and re-running that cell under the current driver is
the honest next reading.

**What would lift it.** Any of: (a) a recorded run of the current driver showing
triple-click takes a selection; (b) an input path that is not CDP-synthesised and does
produce a selection in that renderer; (c) a real hand on real glass — which is what
the T-12 amendment's *"a scripted `fetch` is not a step"* rule already contemplates
for a step this rig cannot drive.

**What it does NOT prevent the programme concluding.**

- Nothing about the metadata families — `folder`, `ticker`, `tags` and `hero` are
  driven through their own controls and are untouched by this.
- Nothing about `append_widget_embed`, whose door this rig **does** open: the recorded
  cell went through *"Send to Journal → Current note"* and hit `/embeds`.
- Nothing about the append-only merge mechanism, which is proved at unit level across
  the seven-family × six-ordering property matrix and traced to the line in
  `docs/notebook/wave-q1-f5-append-merge-finding.md`.
- ⛔ And it does **not** license a raw-`fetch` substitute. A scripted POST to
  `/excerpts` is a SECOND-WRITER simulation whose fork is correct, and reading one as
  a member-path defect is the error that cost this wave three deploys.

### L-2 — MoversSidebar is empty offline: `append_financial_fact` has no source row to drive

**What the rig cannot do.** Reach a `TickerPopup` on `/dashboard` after an offline
route change, so the door's own control — the popup's save-price-to-Notebook button —
is never on the page to click.

**Why — the mechanism.** The tool names it where it gives up:

> `tools/q1_f5_matrix.py:633-635`
> ```js
>           const triggers = [...document.querySelectorAll('[data-testid^="ticker-"]')];
>           if (!triggers.length) return {ok:false,
>             why:'no [data-testid^=ticker-] trigger on this page — MoversSidebar rendered nothing '
>                 + '(its /api/movers read may not have been in SWR cache for the offline route change)'};
> ```

⛔ **READ THAT STRING AS WRITTEN: it says "may".** The tool reports the **absence of
triggers** as fact and offers the SWR cache as a *candidate* cause. This file does not
promote a hedge to a measurement.

⚠️ **AND THIS PATH IS NOT TAGGED `rig_limitation`.** Its caller returns without the
flag —

> `tools/q1_f5_matrix.py:643-644`
> ```python
>         if not (isinstance(opened, dict) and opened.get("ok")):
>             return {"ok": False, "why": f"could not open a TickerPopup: {opened}"}
> ```

— so the cell would print *"the `append_financial_fact` door was **not opened**"*,
where L-1 and L-3 print *"was **rig limitation**"* (`tools/q1_f5_matrix.py:1233`).
Recording it as a named limitation here does not change what the tool prints, and a
reader comparing the two will see the difference. **No cell has ever been recorded
from this path** — `append_financial_fact` × drain-first reads `· not run` in both the
rendered table and its state JSON.

**What the source supports about the cause** — derived, not measured, and labelled
that way wherever it is cited:

- The sidebar's only data source is one SWR read — `MoversSidebar.jsx:130-133`:
  `useMobileSWR(propData !== undefined ? null : '/api/movers', fetcher, { refreshInterval: 30000, marketHoursOnly: true })`.
- The app configures no SWR cache `provider` (`App.jsx:262-268` sets
  `revalidateOnFocus`, `revalidateOnReconnect`, `dedupingInterval`,
  `focusThrottleInterval` and `errorRetryCount` only), so the cache is SWR's default
  in-memory map and **does not survive a document load** — and the rig returns from
  its online warm pass to the editor with `page.goto`, which is a document load.
- `revalidateOnReconnect: false` (`App.jsx:264`) means a read that failed offline is
  **not** retried when the transport returns; the next attempt is a refresh tick.
- `marketHoursOnly: true` multiplies that tick by ten while the market is fully closed
  (`useMobileSWR.js:26-30`), which is when rig windows usually fall.

⭐ Together those are a coherent account of a sidebar that is empty offline and stays
empty across the reconnect. **They are read off the source, not off a run.**

**What would lift it.** Drive the door from a surface whose ticker rows do not depend
on a fetch made during the offline half — any `TickerPopup`-wrapped ticker already
rendered before the transport is cut — or warm `/dashboard` in a way that survives
into the offline route change (an SPA route change rather than a document load, which
the tool already has as `--spa-return` for a different question).

**What it does NOT prevent the programme concluding.** `append_financial_fact` shares
its mechanism with the other two append families: all three call `settleNoteWrite`,
none settles with local state, and all three were measured together at unit level
(the append rows of the property matrix, one mechanism, one fix). An undriven
production cell leaves a **production** reading unmade; it leaves the mechanism proved
where it was proved.

### L-3 — the pdf.js preview does not reliably render, and the tool reports it as the rig's

**What the rig cannot do.** Guarantee that the attached PDF's preview lays out any
page or any text-layer span at all — the precondition L-1's selection needs.

**Why — the mechanism.** pdf.js fetches its own lazy chunk and then the document
before it lays out a text layer, and how long that takes is not the rig's to choose.
The tool polls rather than waiting a fixed interval, and records why:

> `tools/q1_f5_matrix.py:371-375`
> ```js
>   // ⛔ POLL, DO NOT WAIT A FIXED 3.5s. pdf.js has to fetch its own lazy chunk and
>   // the document before it lays out a text layer, and how long that takes is not
>   // this rig's to choose. Measured 2026-09-13: the SAME pdf rendered 2 pages /
>   // 25 spans on one run and 0 / 0 on the next — a flaky rig limitation that
>   // would have been recorded against the DOOR.
> ```

When the poll comes back empty, the cell is a named rig limitation and not a door
result:

> `tools/q1_f5_matrix.py:653-655`
> ```python
>         if not (isinstance(opened, dict) and opened.get("ok")):
>             return {"ok": False, "rig_limitation": True,
>                     "why": "the PDF preview would not open: " + str(opened)}
> ```

⭐ **This is a different limitation from L-1 and must not be folded into it.** L-1 is
*spans rendered, selection never formed*. L-3 is *spans never rendered*. They report
from different paths, they would be lifted by different things, and collapsing them
would let a flaky render be recorded as a settled statement about the door — which is
exactly what the comment above says it must not become.

⚰️ **This cell already manufactured one finding of this shape, and keeping that is the
point.** The first version of the excerpt setup generated a minimal PDF by hand; it
was structurally valid, pypdf read it, the upload succeeded, the server marked the
document `ready` — *"and **pdf.js rendered 0 pages and 0 text-layer spans**, so the
excerpt door could not be reached at all. The cell reported a rig limitation for a PDF
the rig itself had invented"* (`tools/q1_f5_matrix.py`, `prepare_family`). The fixture
is now a real one from Wave P's certification corpus
(`tools/wave_p_cert_corpus/native_text.pdf`), which is what makes any remaining
flakiness attributable to the renderer rather than to the file.

**What would lift it.** A readiness signal the rig can wait on that belongs to the
viewer rather than to a poll over the DOM — the preview declaring that it has laid out
a text layer — or an accepted retry policy stated in the artifact, so a cell that
needed three attempts says so instead of reading as one clean run.

**What it does NOT prevent the programme concluding.** It bounds one cell's
reachability and nothing more. It says nothing about whether the excerpt door works
for a member (a real hand on a rendered preview is not polling for spans), and nothing
about the drain, the classifier or the merge.

---

## 3. THE LINE THE PROGRAMME CAN CITE

> **The in-note append measurement stays UNMADE by name in the F5 table, and it does
> NOT block the measurement freeze lifting — provided every other cell is green or
> named.**

`append_document_excerpt` is the only append family whose door fires **without leaving
the note**:

> `tools/q1_f5_matrix.py:649-650`
> ```python
>         # The door lives on the editor page itself -- no navigation. Open the PDF
>         # the prepare step attached, select a passage, click Save excerpt.
> ```

L-1 and L-3 are why this rig cannot take that reading. **Named is an answer. A guess
is not, and a raw-`fetch` substitute is a second writer, not a measurement.**

⚠️ **ONE RECONCILIATION THIS RULING REQUIRES, STATED SO IT IS NOT DISCOVERED LATE.**
The freeze rail's arming condition is currently written against a *count of
INCONCLUSIVE rows*, not against *green-or-named*:

> `app/src/pages/journal-2-0/lib/offline/f5Freeze.test.js`
> ```js
>  * ⛔ THIS RAIL EXPIRES BY CONSTRUCTION. `F5_OPEN` flips to false the day the
>  * seven-family × six-ordering table has zero INCONCLUSIVE rows, and this file
>  * then asserts only that the frozen set is still correctly enumerated — an
>  * arming condition that names a state, not a date
> ```
> ```js
> /** ⛔ Flip to false only when F5's table has zero INCONCLUSIVE rows. */
> const F5_OPEN = true
> ```

A named rig limitation renders as `⚠️ INCONCL` in the table (`tools/q1_f5_matrix.py`,
`render()`), so **as written the rail and this ruling disagree**: the ruling lifts on
*green or named*, the rail lifts on *zero INCONCLUSIVE*. ⛔ Whoever lifts the freeze
must restate that arming condition in the same commit, or the programme carries two
authorities over one question — the defect it has already recorded against itself more
than once. **This file does not change that rail and is not the place to.**


---

## ⛔ 2026-09-14 — the `hero` family is NOT a named limitation. It is an UNFINISHED INSTRUMENT.

Six `hero` cells are INCONCLUSIVE, and after tonight's passes they all give one
reason, verbatim from the tool:

> the `hero` door was not opened: **the hero picker is not on the page. It renders
> ONLY for a note that already has a hero, so the seed step must have failed**

⛔ **This must not be filed beside L-1 and L-2, and the distinction is the whole
point of the amended arming condition.**

| | what it is | can it be lifted? |
|---|---|---|
| **L-1** excerpt | CDP-synthesised pointer input produces no text selection in pdf.js | no — a property of the renderer |
| **L-2** fact | MoversSidebar renders nothing after the offline route change | partly established; cause still hedged |
| **`hero`** | the rig's own SEED STEP did not attach a hero, so the door it needs never rendered | **yes — it is our fixture, not the product's ceiling** |

⭐ L-1 is a property of the world. `hero` is a to-do. **"Named" means a recorded
property of the rig, never "we did not finish the instrument"** — and a table that
counted this as named would lift the freeze on six cells nobody has measured.

### Where that leaves the arming condition

The freeze lifts when every cell is GREEN or NAMED. Measured 2026-09-14, 42 cells:

```
GREEN 18   RED 5   N/A 3   INCONCLUSIVE 16
                            ├─  5  append_document_excerpt  NAMED (L-1)
                            ├─  5  append_financial_fact    NAMED (L-2, partly)
                            └─  6  hero                     NOT NAMED — unfinished seed
```

⛔ **It does not lift, for two independent reasons, and either alone is enough:**
the five RED `append_widget_embed` cells are a live defect, and the six `hero`
cells have never been measured at all.

### And the retries were futile — recorded so nobody re-runs them hoping

`--resume` re-runs every INCONCLUSIVE cell, and three passes tonight moved the
count **16 → 16**. None of these is a transient 502; each fails for a structural
reason the retry cannot touch. ⭐ **A retry loop is only honest when the thing it
retries is capable of a different answer.** The queue entry should not be re-armed
until the `hero` seed is fixed or the two limitations are excluded from `--resume`
by name.

**Owner / next step:** fix the rig's hero seed (attach a hero image before the
offline window opens, the way `prepare_family` already does for the excerpt PDF),
then re-run the six cells. Until then `hero` is an OPEN instrument gap, not a
limitation.


### ⚖️ CORRECTION, same night — `hero` is blocked by a PRODUCT affordance, not only by our fixture

The entry above called `hero` *"an unfinished instrument — our fixture, fixable"*.
That was right that the seed was never written and **wrong about why it could not
be**. Traced to the line:

| | |
|---|---|
| endpoint | `POST /api/j2/notes/{id}/hero` — exists, works |
| its ONLY client caller | `HeroImagePicker.jsx:26` |
| `HeroImagePicker`'s ONLY mount | `NoteEditorPage.jsx:2192`, inside `note.heroImageUrl ? (…) : null` |

⭐⭐ **The hero uploader is gated behind already having a hero.** A note written in
the Notebook cannot get a first hero image from the editor — the editor's own
comment says so: *"Notes without one start straight at the title — no empty
drop-zone."* Notes acquire heroes from other doors (the Desk "Save to journal"
path; position creation, `GlobalAddPositionProvider.jsx:167`).

**What that means for the table, and it is good news:** the seed may legitimately
use the API, because `prepare_family`'s own charter already says
**"SETUP IS ONLINE AND IS NOT THE DOOR"** — the same reason the excerpt cell
uploads its PDF through the attachment input and only then drives the real
selection. Seed the hero, and the picker renders, and the DOOR is then the
member's own control exactly as the charter requires. So the six cells are
measurable; they were never blocked by a rule.

⛔ **And a PRODUCT OBSERVATION, offered as an observation and not filed as a
defect** — this is the SECOND affordance found tonight that is gated on the state
which makes it unreachable:

| affordance | renders only when | consequence |
|---|---|---|
| "Start a note" (`ResearchHome.jsx:78`) | the account has **no** notes | a member with notes has no create control on the landing view |
| the hero picker (`NoteEditorPage.jsx:2188`) | the note **already has** a hero | a member can never add a first one |

⭐ Both were invisible to `member-smoke`, which is empty by charter, and both
surfaced the moment T-12 ran against an identity **with state**. That is the
owner's admin-role amendment earning its keep on its first run — and it suggests
the class is worth a sweep: *an affordance gated on the state that makes it
unnecessary.*
