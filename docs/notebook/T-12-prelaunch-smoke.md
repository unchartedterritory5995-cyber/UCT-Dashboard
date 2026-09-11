# T-12 — Pre-launch Authenticated Notebook Smoke

**What this gate is FOR, in one line:** it is the owner walking the member's own
first hour by hand, on real glass, against production — **it is not a test suite,
it proves nothing about correctness, and a green repo does not substitute for it.**

It executes the decision log's **"HARD PRE-LAUNCH GATE — PRE-LAUNCH AUTHENTICATED
NOTEBOOK SMOKE" (2026-09-05)**, which has never been run. Manifest row: **T-12**
(`docs/notebook/PROGRAM-MANIFEST.md` §6).

> ### The two closure gates
> **T-12 (this script) and the real-glass acceptance run are the two closure
> gates, and they are not interchangeable.** The real-glass run asks *does it
> render and respond correctly on a real device.* This one asks *can a signed-in
> member get through the loop the product is sold on without hitting a wall.*
> A product can pass either one and fail the other. **Neither closes the program
> alone. Both must be PASS, by name, in this file.**

**Who runs it:** the owner, on his own device, signed in as himself. ~15 minutes.
**This is not automation. Nothing in this repo runs it, and no agent may run it
or fill in its results.**

---

## ⛔⛔ STANDING PROHIBITIONS — read before step 0

These are not preferences. **If a step cannot be completed without one of these,
that step is FAIL, and the run STOPS at that step.** Do not work around it, do
not do it "just to see the rest", do not come back and mark the earlier steps PASS.

1. ⛔ **Do not weaken authentication.** No auth bypass, no test-only header, no
   `AuthGuard` edit, no local build with the guard removed, no borrowed session.
   If the Notebook will not open while signed in as yourself, **that is the
   finding** and it is the most valuable thing this run can produce.
2. ⛔ **Do not flip `COMING_SOON_MODE`**, or any other gate, to reach a surface.
   A surface you had to unlock is not a surface a member can reach.
3. ⛔ **Do not manufacture activations.** ⚠️ **This run's own notes, saves and
   telemetry are NOT Stage A member behaviour and must never be counted as such.**
   You are the owner, not a member; Stage A requires *multiple real members*, and
   its own anti-gaming discipline exists precisely to stop a power user's session
   being read as adoption. Tag everything this run creates (step 0) so it can be
   excluded, and say so when you record the result.
4. ⛔ **Do not flip `OFFLINE_DEFAULT_ON`.** It is false for every member, the flip
   is blocked behind an open defect (manifest Q1-11/Q1-18), and this gate does not
   touch it. You are smoking the ONLINE save path.
5. ⛔ **Do not fix anything mid-run.** A defect found here is recorded and the run
   continues to the next *independent* step, or stops if the step was a
   precondition. A run in which you repaired the product is not a measurement of
   the product.

---

## Preconditions — state them, don't assume them

| | |
|---|---|
| **Origin** | **`https://uctintelligence.com`** — production. ⛔ **A local or sandbox run is NOT evidence for this gate** and must not be recorded here; if you shake it out locally first, that is a rehearsal and it goes nowhere near the results block. |
| **Account** | Your own real account, signed in normally through the login form. |
| **Device** | One real device, one browser. Name both in the results block. |
| **Before you start** | Confirm production is serving a current build: open `/api/health` and note `uptime_seconds`. If a deploy is in flight, wait for it — a swap mid-run invalidates the run. |

⛔ **Claim the results block BEFORE step 1.** Scroll to "Results" at the bottom,
paste the template, fill in the header (date, device, browser, build), and write
every step's line as `INCOMPLETE (run did not reach this step)`. Then start.
**A run that dies must leave an explicit INCOMPLETE behind, never a stale PASS
from a previous attempt.**

⛔⛔ **A step left blank is OPEN, never PASS. Absence of a failure is not a pass.**
If you did not look at it, it did not pass.

---

## The script

Each step is: **Do** → **Look at** → **PASS / FAIL**. Nothing here says "check it
works"; every condition names a thing on the screen.

---

### Step 0 — Sign in and mark the run (≈1 min)

**Do.** Sign in at the origin above through the normal login form. Decide a tag
you will put on every note this run creates: **`t12-smoke`**.

**Look at.** The signed-in header — your own account, not a "sign in" prompt.

- **PASS** — you are signed in, having typed your own credentials into the normal
  form, and nothing was disabled or bypassed to get there.
- **FAIL** — you could not sign in, OR you reached the app by any route that
  involved a prohibition above. **STOP.** Record the FAIL and the reason.

---

### Step 1 — Reach the Notebook the way a member does (≈1 min)

**Do.** Navigate to **`/journal`** from the app's own navigation (not by typing a
deep URL), then open the **Notebook** surface (`/journal/notebook`).

**Look at.** The three-pane Notebook shell: a folder/search sidebar on the left,
a note list, and a reading pane.

- **PASS** — the Notebook shell renders, reached by clicking through the app's
  own navigation.
- **FAIL** — a blank pane, a spinner that does not resolve within 15 seconds, an
  error, a redirect away from `/journal/notebook`, or **no nav path to it at all
  without typing the URL**. ⚠️ "I had to type the URL" is a FAIL of this step even
  if the page then loads — a member does not know the URL. **STOP.**

---

### Step 2 — Create a note (≈1 min)

**Do.** Create a new note from the Notebook's own new-note control. Title it
**`T-12 smoke <today's date>`**. Add the tag `t12-smoke`.

**Look at.** The editor opens with your title in it and a cursor in the body.

- **PASS** — the note exists, is titled as typed, and carries the tag.
- **FAIL** — no new-note control findable in the Notebook surface; the note is
  created without a title field; the tag cannot be applied; or the editor does not
  take focus. **STOP** (every later step writes into this note).

---

### Step 3 — Type, and confirm it actually saved (≈2 min)

**Do.** Type this sentence into the body, exactly:

> `The pre-launch smoke run typed this sentence and it must survive a reload.`

Wait 5 seconds without touching the keyboard. Then **hard-reload the page**
(Ctrl/Cmd+Shift+R) and reopen the same note.

**Look at.** The body after the reload. Also look at the save-status area while
typing and in the 5 seconds after.

- **PASS** — **the sentence is present in the body after the reload, character for
  character**, and at no point did the status area show `Save failed` or
  `Reconnecting…`.
- **FAIL** — the sentence is missing, truncated, or altered after reload; or
  `Save failed` / `Reconnecting…` appeared and did not clear before you reloaded.
  **STOP.** ⛔ **This is the one step whose failure ends the run unconditionally.**
  Everything else in the product is downstream of the save path, and the wave
  in flight (Q1) is a live defect in exactly this area. Record the exact status
  text you saw.

⭐ **Why the reload and not the status chip:** a status chip is the product's
claim about the save. The reload asks the server. Manifest §1 and the Q1 rows
exist because those two have disagreed before.

---

### Step 4 — Put a widget embed in the note (≈3 min)

**Do.** Open **`/charts`** in the same session. On a chart widget, set the symbol
to a liquid name you know (e.g. `NVDA`) and a timeframe you will recognise. Use
the widget header's capture door — **"Send to Journal"** or **"Send to Journal
(choose where)…"** — and send it into the `T-12 smoke` note.
*If "choose where" does not offer that note, send it with the plain "Send to
Journal" and then insert it into the note from the capture inbox.*

Return to the note.

**Look at.** The note body where the embed landed.

- **PASS** — an embed card renders **inside the note body**, showing the symbol
  you chose and a timeframe, and it survives a reload of the note.
- **FAIL** — no capture door on the widget header; the door fires but nothing
  reaches the note or the inbox; the embed renders as a broken/empty card; or the
  embed disappears on reload. Record **which door you used** and what it did.
- ⚠️ **Record, do not fail, if:** the door worked but **could not target this
  note** and you had to go via the inbox. That is a real friction finding and it
  belongs in the notes column — it is not a FAIL of "can a member embed a widget".

⭐ **Two known gaps live near this step and neither is a FAIL of it:** there is no
Screener capture door (manifest **R-1a**), and the universal per-symbol
right-click (`TickerActions`) has no send-to-note entry (**R-2e**). If you go
looking for either and do not find it, that is expected and already logged — do
not record it as a new defect.

---

### Step 5 — Find the note by searching for its words (≈1.5 min)

**Do.** Back in the Notebook, click the sidebar search box (placeholder
**`Search notes…`**) and type: **`survive a reload`**.

**Look at.** The result list.

- **PASS** — the `T-12 smoke` note appears in the results, and the result row
  shows a snippet containing the searched words.
- **FAIL** — the note does not appear; or it appears with no snippet / a snippet
  that does not contain the query terms. Record what you typed and what came back.

**Then do.** Clear the search and type a string that exists nowhere:
**`zzqqxx`**.

- **PASS** — an honest empty state naming your query (`No notes match "zzqqxx".`).
- ⚠️ **Record, do not fail:** the empty state offers no next step. That is manifest
  **S-03**, already open and measured. Noting it here confirms it on real glass;
  it is not a new finding and not a blocker.

---

### Step 6 — Open a document (≈2 min)

**Do.** With the `T-12 smoke` note open, attach a **real PDF you already have** —
a filing, a factsheet, anything with selectable text and more than one page. Drag
it into the note body or use the attachment control. Wait for processing. Then
click the attachment chip.

**Look at.** The chip's state while processing, and what happens on click.

- **PASS** — the document reaches a ready state and **clicking the chip opens a
  page-rendered viewer inside the app**, showing page 1 with readable text and a
  page count.
- **FAIL** — the upload is rejected; processing never leaves pending; the chip
  **downloads the file instead of opening the viewer**; or the viewer opens blank.
- ⚠️ **Record, do not fail:** there is no zoom control in the viewer (manifest
  **S-12**, open and measured). Do not go hunting for one.

⭐ If your PDF is a **scanned** document, note that in the results — OCR is live in
production (Wave P5) and a scanned page reaching readable text is a bonus
observation worth having. If it does not, record it as a note, not a FAIL: OCR is
certified for **English, printed** pages only (manifest T-07).

---

### Step 7 — Ask a question, and follow the citation (≈2.5 min)

**Do.** Open the Ask panel from the note. Choose the scope **`This note`** and
ask: **`What must survive a reload?`**

Then switch the scope to **`My Notebook`** and ask: **`What have I written about
the smoke run?`**

**Look at.** The answer text, and the citation(s) rendered beneath or within it.
Then **click a citation.**

- **PASS** — both scopes return an answer, at least one citation is rendered, and
  **clicking a citation moves you to the cited location and visibly marks it** —
  the cited note opens (or scrolls) and the referenced passage is highlighted or
  otherwise indicated.
- **FAIL** — no answer; an answer with **no citation at all**; or a citation that
  is clickable but lands nowhere, lands on the wrong note, or highlights nothing.
- ⚠️ **A refusal is a PASS, and say so in the results.** If the corpus genuinely
  cannot answer, the product is specified to refuse deterministically **with no
  model call**. A clean "I can't answer that from your notes" is the system working.
  ⛔ **What is a FAIL is an answer containing a fact you never wrote.** Read the
  answer for that specifically — it is the single worst failure this product can
  have, and it is the reason this step exists.

⭐ If Ask reports it requires a paid plan, that is your account's entitlement, not
a defect. Record it and mark the step **OPEN — could not exercise**, not FAIL.

---

### Step 8 — Trash it and bring it back (≈1.5 min)

**Do.** Delete the `T-12 smoke` note from the Notebook. Read the confirmation
copy. Confirm. Then open **Trash** in the sidebar, find the note, and restore it.

**Look at.** The confirmation dialog's words; the note list after deleting; the
Trash list; the note after restoring.

- **PASS** — all four: (1) the confirmation says the note goes to Trash and can be
  restored, naming the **30-day** window; (2) the note leaves the main list;
  (3) it is present in Trash; (4) after restore it is back in the main list
  **with its body text, its tag, and the widget embed from step 4 intact**.
- **FAIL** — deletion with no confirmation at all; the note not in Trash; restore
  unavailable; or the note comes back **missing its body, its tag, or the embed**.
  ⛔ A note that returns emptied is a data-loss finding, not a cosmetic one —
  record it in those words.

---

### Step 9 — Record the result (≈1 min)

**Do.** Fill in the Results block below, in this file, now — before closing the
browser. Then commit this file.

---

## Results — recorded HERE, in this file, by the person who ran it

⛔ **This is the only place a T-12 result exists.** Not a chat message, not a
commit message, not a memory note. **A result that is not written here did not
happen**, and a later reader must be able to open this file and see the verdict
beside the script that produced it.

⛔ **Use these exact words in the verdict line**, so the gate's state is greppable
and cannot be softened by paraphrase:

- `T-12 PRE-LAUNCH AUTHENTICATED NOTEBOOK SMOKE: PASS` — **only if every step
  below reads PASS.**
- `T-12 PRE-LAUNCH AUTHENTICATED NOTEBOOK SMOKE: FAIL` — one or more steps FAIL.
- `T-12 PRE-LAUNCH AUTHENTICATED NOTEBOOK SMOKE: INCOMPLETE` — the run stopped, or
  any step is OPEN/INCOMPLETE. ⛔ **INCOMPLETE is not a soft PASS and must never be
  reported as one.**

Paste and fill:

```
### Run <N> — <YYYY-MM-DD HH:MM ET>
Origin:    https://uctintelligence.com
Build:     /api/health uptime_seconds = <n> at start
Device:    <device>
Browser:   <browser + version>
Operator:  <name>
Run tag:   t12-smoke   (⛔ notes created by this run are NOT Stage A activations)

| Step | Result | What I saw |
|---|---|---|
| 0 Sign in                    | PASS / FAIL / INCOMPLETE | |
| 1 Reach the Notebook         | PASS / FAIL / INCOMPLETE | |
| 2 Create a note              | PASS / FAIL / INCOMPLETE | |
| 3 Type + survives reload     | PASS / FAIL / INCOMPLETE | |
| 4 Widget embed in the note   | PASS / FAIL / INCOMPLETE | door used: |
| 5 Search finds it            | PASS / FAIL / INCOMPLETE | |
| 6 Open a document            | PASS / FAIL / INCOMPLETE | scanned? y/n: |
| 7 Ask + citation lands       | PASS / FAIL / OPEN / INCOMPLETE | refusal? y/n: |
| 8 Trash and restore          | PASS / FAIL / INCOMPLETE | |

Prohibitions: none were breached / BREACHED: <which, and the run is void>
Friction recorded but not failed: <…>

T-12 PRE-LAUNCH AUTHENTICATED NOTEBOOK SMOKE: <PASS | FAIL | INCOMPLETE>
Real-glass acceptance run: <PASS | FAIL | NOT PERFORMED>   ← the other closure gate
```

⛔ **Both gate lines are required**, even when one was not run. "NOT PERFORMED" is
the honest value and it is **not** PASS. This program has already recorded one
gate as OPEN rather than PASS because a template came back blank four times;
**absence is not PASS** is the rule that came out of it, and it binds here.

---

## Runs

*(No run has been executed. This section is empty on purpose — an empty Runs
section is the honest state of an unexecuted gate, and it must not be filled in
by anyone who did not personally perform the steps above.)*
