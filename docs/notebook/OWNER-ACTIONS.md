# Notebook 10/10 — the owner's actions, as checklists

This is a checklist, not a status report. Every clause below is one the parity scorecard
(`docs/notebook/parity-scorecard.md`) already marks `NOT MET`, `NOT MEASURED — OWNER`, or
`BLOCKED (owner)` — and every one of them is blocked on something only the owner can do:
sign in as themselves, press submit, talk to a vendor, sit with a trader, or spend 30 real
calendar days with real members.

**Nothing here was sent, submitted, published, or flagged by this pass.** No vendor was
contacted, nothing was uploaded to any store, and no flag changed. The two vendor requests in
§2 are drafts, marked NOT SENT, waiting for the owner to send them or not.

Every factual claim about the code below cites `file:line` and quotes the line. A citation
that could not be quoted from the file as it stands today was not written into this doc.

---

## 0. The four owner-only clause groups, in one table

| # | What | Standard(s) / clause(s) it closes | Owner time | Why here |
|---|---|---|---|---|
| 1 | §2 — send the two vendor zero-retention drafts | #8 "vendor data terms in writing", #12 "semantic retrieval", #12 "all on verified vendor terms", #13 "keyword + meaning search"; unblocks G-017/G-127 | ~15–20 min to review and send both | Has an external turnaround time nobody controls — start the clock first |
| 2 | §3.5 — start the 30-day soak | #3 "zero data-loss over a 30-day window" | ~60–90 min one-time setup, then ~10 min/week for 30 days | Has a 30-**calendar-day** fuse — the single longest lead time here; starting it late costs a full month, not effort |
| 3 | §1 — submit the extension to the Chrome Web Store | #1 "every weekly feature exists" (the G-043 half of it) | ~15–20 min | Fully built, fully drafted, zero blockers found; the fastest full close available |
| 4 | §3.4 — walk the two iOS Shortcuts on a real iPhone | #10 "iOS + Android capture parity" (G-044) | ~20–30 min | Android is already done; this is the one remaining half, and it is short |
| 5 | §3.2 — the screen-reader pass (NVDA first, VoiceOver if a Mac is at hand) | #9 "a full screen-reader pass" | ~60–70 min NVDA alone; +30–45 min with a Mac | The other three accessibility clauses are already MET; this is the last one |
| 6 | §3.3 — one real-device matrix pass | #10 "real-device matrix … green every release" (G-164) | ~45–60 min for one dated pass | Recurring by its own wording ("every release") — this is the first dated row, not a final close |
| 7 | §3.1 — the 5–8 trader study (SUS, first-useful-note timing) | #5 (3 clauses), #16 "first useful note < 2 min" | ~6–8 hrs of session time across 5–8 people, spread over however many days scheduling takes | Biggest single time cost; the kit is fully built, so the cost is calendar and people, not preparation |

Do 1 and 2 **today**, regardless of order between them — both have lead times outside your
control. Then 3 and 4 (short, complete, no dependency on anything else). Then 5 and 6. Save 7
for when you have real calendar space; nothing else here blocks on it, and nothing it produces
blocks anything else in this list.

---

## 1. Web clipper → Chrome Web Store (G-043)

**Current state:** built, packaged, deployed to production, and the submission itself is the
only remaining step. `docs/notebook/chrome-web-store-listing.md` already carries everything
below in more detail — this section is a distillation plus a fresh verification pass, run
today, to confirm nothing in it has drifted.

### Where the package is, and the exact command

The source is `extension/` (10 tracked files: `manifest.json`, `background.js`, `popup.html`,
`popup.css`, `popup.js`, `lib/auth.js`, `lib/config.js`, `icons/icon{16,48,128}.png`).

```
python tools/package_extension.py
```

Ran it just now, from this worktree:

```
built C:\Users\Patrick\uct-worktrees\notebook-w10-op\.extension-build\uct-browser-capture-0.1.0.zip (10 files, sha256 71f4c8251c952891)
```

The tool refuses to build (exit 2) if the manifest is not Manifest V3, `host_permissions` is
anything but production, `lib/config.js`'s `API_BASE` points anywhere but production, or a file
the manifest names is untracked — quoted from its own docstring:

> "It refuses to build (exit 2, reason printed) when the package would not be the one we mean
> to ship" (`tools/package_extension.py:12`)

The extension code itself is already live: `extension/manifest.json` is an ancestor of both
`origin/master` and `origin/production` (checked today via `git merge-base --is-ancestor`), and
`app/src/pages/Privacy.jsx` already carries the "Browser Capture Extension" section the Chrome
Web Store's privacy-practices review checks against:

> "If you install the UCT Browser Capture extension, it reads the current page's address, its
> title, and the text you have selected, and only when you open the extension to save
> something." (`app/src/pages/Privacy.jsx:35-37`)

So the "must be deployed before submitting" precondition the listing doc names is already
satisfied — nothing to redeploy first.

### The store listing text

- **Name:** `"UCT Browser Capture"` (`extension/manifest.json:3`)
- **Summary (97 chars, fits the 132-char store limit):**
  `"Save a link or a selected passage from any page into your UCT Notebook, with provenance intact."` (`extension/manifest.json:5`)
- **Category:** Productivity › Workflow & Planning
- **Language:** English

**Detailed description** (paste verbatim — carried over unchanged from
`docs/notebook/chrome-web-store-listing.md`, re-checked against the manifest and code today):

```
UCT Browser Capture is the companion to the UCT Intelligence research Notebook. While you read, select a passage (or nothing, to keep just the link), press Ctrl+Shift+Y, pick the note it belongs in, and add a line on why it matters. The quote lands in your note with its source title and link, so you can always find where it came from.

What it does
• Saves the page link, or the passage you selected, into a note you choose
• Keeps the source: page title, address, and the exact words you selected
• Lets you add a short note on why it matters
• Stays on the page, so your reading isn't interrupted

What it reads
Only the current page's address, its title, and the text you selected, and only when you open the extension. It does not read the rest of the page, your browsing history, forms, or cookies.

How it connects
You connect once with your UCT Intelligence account. The extension receives a limited capture key that can only list your recent notes and save captures into them. It never sees your password or your UCT login session. You can disconnect it from the extension, or revoke it for good in UCT Settings.

Requires a UCT Intelligence membership.
```

### Permission justifications (each verified against the code that uses it, today)

| Permission | Declared | Justification | Verified at |
|---|---|---|---|
| `activeTab` | `extension/manifest.json:8` | Reads the current tab only when the member opens the popup | `const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })` (`extension/popup.js:54`) |
| `scripting` | `extension/manifest.json:11` | Injects one function to read the current text selection — nothing else | `const [hit] = await chrome.scripting.executeScript({` (`extension/popup.js:62`) |
| `storage` | `extension/manifest.json:9` | Keeps the member's limited capture key on-device | `await chrome.storage.local.set({ [KEY]: cred })` (`extension/lib/auth.js:47`) |
| `identity` | `extension/manifest.json:10` | Runs the one-time OAuth-style connect flow | `const returned = await chrome.identity.launchWebAuthFlow({ url, interactive: true })` (`extension/lib/auth.js:66`) |
| Host `https://uctintelligence.com/*` | `extension/manifest.json:14` | The only origin the extension can talk to — capture and token endpoints | `extension/lib/config.js:14` `export const API_BASE = 'https://uctintelligence.com'` |

Explicitly **not** requested, and worth stating because the store asks: no `cookies` permission
—

> "⛔ chrome.cookies IS NOT USED AND THE PERMISSION IS NOT REQUESTED." (`extension/lib/auth.js:11`)

— and no `tabs` (broad), `history`, `bookmarks`, or `webRequest`.

### Privacy-practices answers (paste verbatim into the Chrome Web Store's Privacy tab)

**Single purpose:** Save a link or a selected passage from the current web page into the
member's UCT Notebook.

**Data usage:**
- **Website content** (selected text, page title, page address) — sent to UCT's servers, only
  when the member presses Save, to store into their own Notebook. Not sold. Not used for
  anything but that save.
- **Authentication information** (the limited, revocable capture key) — stored on-device
  (`chrome.storage.local`), never the member's password or site login session.

**Certify:** data is not sold to third parties, not used for purposes unrelated to the single
purpose above, and not used to determine creditworthiness or for lending.

**Remote code:** No. The manifest's CSP is `script-src 'self'; object-src 'none'; base-uri
'none'; form-action 'none'` (`extension/manifest.json:44`) — everything runs from the packaged
files.

**Privacy policy URL:** `https://uctintelligence.com/privacy` — live today, with the section
quoted above.

### Screenshots (sizes, and the page each one captures)

Chrome Web Store screenshots: **1280×800**, PNG, up to 5. Two already exist and are
production-correct — re-measured today with Pillow, not assumed:

| File | Size (measured) | What it captures |
|---|---|---|
| `docs/notebook/store-assets/01-save-a-passage.png` | 1280×800 | The popup mid-save: a selected passage, the destination-note picker, the annotation field |
| `docs/notebook/store-assets/02-saved.png` | 1280×800 | The popup's confirmation state after a successful save |

Both were rendered by `tools/extension_store_screenshots.py`, which loads the **real** popup
HTML/CSS/JS with only the `chrome.*` APIs stubbed, against a reserved example domain
(`research.example.com`) — no production traffic, no real credentials. Re-run it if the popup
changes:

```
python tools/extension_store_screenshots.py
```

A **small promotional tile (440×280)** is optional on the current Chrome Web Store listing
form and was not built — add one only if the submission flow asks for it; it is not a blocker.

### Blockers found

**None.** Checked specifically, because the task asked to look for exactly these:

- **Missing icon size** — none. All three required sizes are present and match the manifest
  exactly: 16×16, 48×48, 128×128 (`extension/manifest.json:23-27` and `:29-33`; measured with
  Pillow today: `icon16.png` 16×16, `icon48.png` 48×48, `icon128.png` 128×128).
- **Missing privacy-policy URL** — none. `https://uctintelligence.com/privacy` is live and
  names the extension by section.
- **Version mismatch** — none. `manifest.json:4` reads `"version": "0.1.0"`, the build's own
  output filename and the listing doc both say `0.1.0`, and `MAX_PASSAGE_CHARS` agrees on both
  sides of the wire — client `extension/lib/config.js:26` `export const MAX_PASSAGE_CHARS =
  8000` against server `api/services/journal_two/web_capture.py:67` `MAX_PASSAGE_CHARS =
  8_000`.

### The owner's steps (from `docs/notebook/chrome-web-store-listing.md`, unchanged)

1. Developer account (one time): <https://chrome.google.com/webstore/devconsole>, $5 one-time fee.
2. `python tools/package_extension.py` from this worktree → `.extension-build/uct-browser-capture-0.1.0.zip`.
3. New item → upload that zip.
4. Store listing tab: paste the text above; screenshots from `docs/notebook/store-assets/`.
5. Privacy practices tab: paste the answers above.
6. Distribution: **Unlisted** while the site is coming-soon-mode (nobody can sign up yet); flip
   to **Public** at launch.
7. Submit for review.

---

## 2. Vendor zero-data-retention terms, in writing

Unblocks: standard #8's "vendor data terms verified in writing (zero retention)", standard
#12's "semantic retrieval" and "all on verified vendor terms", standard #13's "keyword +
meaning search" — and the two gap-ledger rows G-017 and G-127.

### Exactly which vendors receive Notebook member content, and what

Read directly from the code, not restated from a ledger:

| Vendor | Endpoint / model | What Notebook content is sent | Gating flag | Live today? |
|---|---|---|---|---|
| **Anthropic** | Messages API, `claude-sonnet-5` | Ask Notebook / Ask Current Note: the member's question plus ranked, citable note excerpts, capped at 20,000 characters — `_SYNTH_MODEL = os.environ.get("NOTE_ASK_SYNTH_MODEL", "claude-sonnet-5")` (`api/services/note_ask.py:59`), `NOTE_SCOPE_MAX_CHARS = 20000` (`api/services/journal_two/ask_retrieval.py:46`) | none (Ask has shipped since Wave K) | **Yes** |
| **Anthropic** | Messages API, same model | Writing help (summarize/rewrite/continue/translate): the selected passage or whole note, capped at 20,000 characters, inside a fenced block with an allow-listed instruction — `MAX_TEXT_CHARS = 20_000` and "the member's passage travels only inside the `UCT-TEXT` fence" (`api/services/journal_two/writing_help.py:65`, `:27`); model is the same knob — `"""NOTE_ASK_SYNTH_MODEL -- the same knob Ask reads, never a second one."""` (`api/services/journal_two/writing_help.py:102`) | `NOTEBOOK_WRITING_HELP_ENABLED` | **Yes, armed** |
| **Anthropic** | Messages API (tool call), same model | Compass's `search_my_notes` chat tool: up to 8 note titles + 400-character snippets — `_NOTES_TOOL_LIMIT = 8` and `_NOTES_TOOL_SNIPPET = 400` (`api/services/journal_two/coach_chat_tools.py:1858-1859`) | `COMPASS_NOTES_TOOL_ENABLED` | **Yes, armed** |
| **OpenAI** | Embeddings API, `text-embedding-3-small` | Notebook meaning search: each note's title and body, split into blocks of up to 1,500 characters — `EMBEDDING_MODEL = "text-embedding-3-small"` and `MAX_CHUNK_CHARS = 1500` (`api/services/voice_embeddings_service.py:25`, `:31`); the Notebook module's own name for the same call is `name = "openai:text-embedding-3-small"` (`api/services/journal_two/note_semantic.py:147`) | `NOTEBOOK_SEMANTIC_SEARCH_ENABLED` | **No — dark.** Its own code: "nothing is embedded, nothing is sent to any vendor, the sweep is a no-op" while off (`api/services/journal_two/note_semantic.py:28-29`) |
| **OpenAI** | Audio API, `whisper-1` | Voice dictation into any Notebook field: the member's spoken audio, transcribed to text — `_WHISPER_MODEL = "whisper-1"` (`api/services/voice_openai.py:203`), route `@router.post("/transcribe")` (`api/routers/voice.py:768`) | none (shipped 2026-05-13, product-wide) | **Yes** |
| — | (local Tesseract, subprocess, no network) | Scanned-page OCR: the page image goes in on stdin, text comes back on stdout — **not a vendor flow.** "SUBPROCESS, NEVER A SHELL … The page image goes in on STDIN and text comes back on STDOUT, so there is no path for a client to name, and no temp file to leak" (`api/services/journal_two/document_ocr_tesseract.py:19-22`) | `J2_OCR_ENABLED` | Yes, but nothing leaves the box |

**Two things worth being precise about, because they change what the owner needs to ask for:**

1. **Ask, writing help, and the Compass notes tool are already live and already sending member
   content to Anthropic** — under Anthropic's *published* commercial terms (no training on API
   data), not a zero-retention agreement. Clause 8's "vendor data terms verified in writing"
   fails today because of this, not because of anything dark. Quoted from the existing vendor
   record: "Decision D7 still stands: features already live keep running under the published
   terms, and semantic search over member notes stays dark until ZDR is confirmed in writing"
   (`docs/notebook/VENDOR-TERMS-2026-09-23.md:37-39`).
2. **Document OCR sends nothing to any vendor.** If the task brief's premise was that OCR is a
   vendor flow needing a ZDR request, that premise is wrong for this codebase — Tesseract runs
   locally, in-process, and no page image or extracted text ever leaves the Railway box. No
   draft is needed for it.

### Draft A — Anthropic, zero data retention (NOT SENT)

**Vendor's documented path:** Anthropic's published trust/privacy material (its Trust Center
and API data-handling documentation) states it does not train on API inputs or outputs by
default. A Zero Data Retention commitment for the API is arranged through Anthropic's
Sales/Enterprise contact, not a self-serve toggle — **confirm the current program name and
application path directly with Anthropic** (for example, "Contact Sales" from the Anthropic
Console, or the Trust Center's own contact channel); the exact page and process may have moved
since this draft was written.

```
Subject: Zero Data Retention (ZDR) for our Anthropic API usage — UCT Intelligence

Hello,

UCT Intelligence uses the Anthropic Messages API (model: claude-sonnet-5) inside a
member-facing feature called Notebook — specifically:

  - "Ask Current Note" and "Ask Notebook": answering a member's question using cited
    excerpts from their own private notes
  - Writing help: summarize / rewrite / continue / translate, applied to a passage or
    whole note the member selects
  - A Compass coaching tool that can search a member's own notes for titles and short
    (400-character) snippets

In every case the content sent is scoped to one member's own private notes, capped at
20,000 characters per call, and never mixed across members.

We currently rely on your published commercial terms (no training on API inputs or
outputs). Before we can tell our members these features run on a written zero-retention
commitment, we'd like to know:

  1. Is Anthropic's Zero Data Retention program available to an account our size, and
     what is its current name and process?
  2. What's required on our side (volume commitment, contract term, any price impact)?
  3. Does it cover the Messages API as we use it today?
  4. Typical time to a written confirmation once we apply?

We're a small, member-funded product (a few hundred paying members) and would like the
lightest-weight path to a written confirmation we can point our privacy policy at.

Thank you,
[Owner name] — UCT Intelligence
```

**NOT SENT.**

### Draft B — OpenAI, zero data retention (NOT SENT)

**Vendor's documented path:** OpenAI publishes its API data-usage practices (its "your data" /
API data-usage guidance on the OpenAI Platform docs). It has offered a Zero Data Retention
option for eligible API use cases through its Sales/enterprise channel rather than a self-serve
setting — **confirm current eligibility, the program's current name, and the application path
directly with OpenAI** (for example, via your OpenAI Platform account's "Contact Sales" or your
account team); the exact page and process may have moved since this draft was written.

```
Subject: Zero Data Retention (ZDR) for our OpenAI API usage — UCT Intelligence

Hello,

UCT Intelligence is a member-facing product using the OpenAI API for two things that
touch member content:

  1. Embeddings (text-embedding-3-small) — to power a private meaning-search feature
     over each member's own notes. This is built and currently switched OFF in
     production, pending this confirmation.
  2. Whisper (whisper-1) transcription, plus a small GPT-4o-mini cleanup pass — for
     voice dictation members use to add text to their notes.

We understand the default API data retention is up to 30 days for abuse monitoring.
Before we turn the meaning-search feature on, we need a written commitment that member
content sent through these calls is not retained beyond serving the request, and is not
used to train models.

  1. Is OpenAI's Zero Data Retention option available to an account our size, and
     what's the current program name and process?
  2. Does it cover both the Embeddings endpoint and the Audio (Whisper) endpoint we use,
     or do we need separate approval for each?
  3. What's required on our side, and how long does written confirmation typically take?

We're a small, member-funded product (a few hundred paying members) and would like the
lightest-weight path to a written confirmation.

Thank you,
[Owner name] — UCT Intelligence
```

**NOT SENT.**

### What flips once each confirmation lands

- **Anthropic confirms** → clause 8's "vendor data terms verified in writing" and clause 12's
  "all on verified vendor terms" no longer have an Anthropic-shaped hole (they still need
  OpenAI's confirmation too, since both vendors touch Notebook content).
- **OpenAI confirms** → `NOTEBOOK_SEMANTIC_PROVIDER`/`NOTEBOOK_SEMANTIC_SEARCH_ENABLED` can be
  armed (`docs/feature_flags.json`: "STAYS DARK until OpenAI zero-retention terms are
  confirmed"), which closes clause 12's "semantic retrieval" and clause 13's "keyword + meaning
  search", and closes gap-ledger rows G-017 and G-127.
- **Both confirm** → clause 8 and clause 12's "all on verified vendor terms" can both move to
  MET.
- **Neither draft touches document OCR** — it needs nothing from either vendor (see above).

---

## 3. The other OWNER rows

### 3.1 — The 5–8 trader task test, SUS, first-useful-note timing

**Exact bar** (`docs/notebook/user-study-kit.md:8-12`):

> "- **5–8 traders**, every **core task** completed **unaided** by every participant;
> - **SUS ≥ 80** (the point mean, with its 90% confidence interval printed beside it);
> - a new member reaches a first useful note in **under 2 minutes**;
> - **no silent failures**: anything that failed without telling the person counts, even if
>   they did not notice."

**Smallest honest way to run it:** the kit is fully built — this is not a build task, it is a
scheduling and facilitation task. Recruit 6–8 traders (so at least five complete a session, per
`user-study-kit.md:31`), run one 45-minute session per person, score with the provided tool.

**Ready-to-use kit** (already in the repo, nothing to write):

| Piece | File |
|---|---|
| Recruit post, screener, scheduling, exclusion rule | `docs/notebook/user-study/screener.md` |
| Consent form (approved for use 2026-09-26) | `docs/notebook/user-study/consent.md` |
| Facilitator script, hint rule, silent-failure check | `docs/notebook/user-study/facilitator-guide.md` |
| The study notebook to import after Task 1 | `docs/notebook/user-study/study-notebook/` |
| Results sheet (one row per participant) | `docs/notebook/user-study/results-template.csv` |
| SUS scorer + verdict (PASS / FIX-LIST / INCOMPLETE) | `tools/notebook_study_score.py` |

The 10-task list, the SUS questionnaire, and the pass/fail decision rule are all already in
`docs/notebook/user-study-kit.md` §4–§8. Task 1 alone is what answers the "first useful note <
2 minutes" clause — it is timed from the end of the prompt.

**Where to record the result:** fill `docs/notebook/user-study/results-template.csv`, then:

```
python tools/notebook_study_score.py docs/notebook/user-study/results-template.csv
```

prints the SUS mean, its 90% CI, and the PASS / FIX-LIST / INCOMPLETE verdict. Cite that run's
output in `parity-scorecard.md` §5 and §16's clause rows.

**Owner time:** ~6–8 hours of session time across 5–8 people, plus ~30 minutes to score. The
calendar cost (finding 5–8 traders willing to give 45 minutes each) is likely the larger
constraint, not the work itself.

### 3.2 — A full screen-reader pass (VoiceOver + NVDA)

**Exact bar** (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md:31`):

> "WCAG 2.2 AA: axe in CI with zero violations on Notebook surfaces, a full screen-reader pass
> (VoiceOver + NVDA), keyboard-complete (incl. graph)"

Three of the four clauses in standard #9 are already MET (axe in CI, zero violations, and
keyboard-complete). This is the last one, and it explicitly needs a real screen reader — its
own file says so:

> "The owner runs this; nothing here has been run on a real screen reader yet." (`docs/notebook/screen-reader-pass.md:4`)

**Smallest honest way to run it:** NVDA is free, runs on this Windows box, and needs installing
(checked: it is not currently on the box). Run the NVDA half first — it needs nothing but this
machine. VoiceOver needs a Mac (and optionally an iPhone); if none is available today, run NVDA
alone and record VoiceOver honestly as "not available this pass" rather than skipping the
section silently — the file's own preconditions ask for exactly that discipline.

**Ready-to-use script:** `docs/notebook/screen-reader-pass.md` — 27 numbered steps (skip link →
sidebar → folders → tags → saved views → editor → tables → slash menu → note links → find/replace
→ Ask → graph view → save-view dialog → delete → onboarding → sharing → the keyboard-shortcuts
dialog), each with the exact expected announcement quoted from the source line that produces it,
plus Appendix A (Mac-only chords) and Appendix B (the touch grip, on real phones).

**Where to record:** fill the PASS/FAIL/Notes columns directly in
`docs/notebook/screen-reader-pass.md`, record the NVDA and VoiceOver versions at the top of the
file (blanks are already there for this), commit it, and cite it in `parity-scorecard.md` §9's
row.

**Owner time:** NVDA install (~10 min) + the 27-step pass (~45–60 min) ≈ 60–70 minutes. Add
~30–45 minutes if a Mac (and VoiceOver) is available for the same pass.

### 3.3 — Real-device matrix, green every release

**Exact bar** (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md:32`):

> "real-device matrix (iOS 16/17/18, Android) green every release"

This clause is recurring by its own wording ("every release"), not a one-time close — it is
recorded in the gap ledger as a process, not a feature: "Not a product feature: device runs are
by hand on BrowserStack Live; Automate is not on the account, so there is no scripted device
path" (`docs/notebook/competitive-gap-ledger.md:448`). The smallest honest first step is one
dated pass, which is what makes "green every release" checkable at all — it needs to start
somewhere.

**Smallest honest way to run it:** one BrowserStack Live session per OS version (iOS 16, 17,
18, and one Android device), signed in as the smoke account through the login-link tool —
**never a typed password on a mirrored phone**:

```
python tools/smoke_login_link.py
```

For each device, walk `docs/notebook/screen-reader-pass.md` Appendix B (the touch-grip check —
short, and already device-specific) as the smoke test, plus a quick look at the Notebook editor,
list, and search on that device/OS combination.

**Where to record:** a dated row per OS version — either directly in the G-164 row of
`docs/notebook/competitive-gap-ledger.md`, or a new dated log file if the owner would rather keep
a running history separate from the ledger prose.

**Owner time:** ~10–15 minutes per device × 4 devices ≈ 45–60 minutes for one full pass. Repeat
this at each future release to keep the clause satisfied on an ongoing basis.

### 3.4 — iOS capture parity (G-044)

**Exact bar:** part of standard #10's "iOS + Android capture parity"
(`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md:32`). Android's half is already done (a real, tested
PWA share-target flow). The iOS half is built and armed, and needs exactly one thing: a real
iPhone walking the two Shortcuts once. Its own doc says precisely that:

> "⚠️ Not yet walked on a physical iPhone." (`docs/notebook/ios-shortcuts.md:18`)

**Smallest honest way to run it:** build the two Shortcuts by hand on a real iPhone — there is
no file to install, because a signed `.shortcut` file can only be produced on Apple hardware.
Each takes about five minutes to build.

**Ready-to-use recipe:** `docs/notebook/ios-shortcuts.md` — step-by-step actions for both
Shortcuts (§2 "Append to today's note", §3 "Save to UCT" from the Share Sheet), a table of what
every possible error response means in plain language (§4), and the one thing to know about
photos/HEIC (§5).

1. In UCT: Settings → Personal API → make a token, copy it.
2. Build "Append to today's note" (`ios-shortcuts.md` §2, ~5 min). Test it: say something, check
   today's note in the app.
3. Build "Save to UCT" (`ios-shortcuts.md` §3, ~5 min). Test it: share a web page from Safari,
   check the Inbox folder.

**Where to record:** update the status line at the top of `docs/notebook/ios-shortcuts.md`
(currently "Not yet walked on a physical iPhone") with the device/iOS version used and the
result, and update `docs/notebook/competitive-gap-ledger.md` G-044's row from "the owner's
device pass" to done.

**Owner time:** ~20–30 minutes total (two Shortcuts built + two test runs).

### 3.5 — The 30-day zero-data-loss soak

**Exact bar** (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md:129` and `:25`):

> "30-day reliability soak with real members: zero data loss, gates KEEP" … "Zero data-loss
> incidents over a 30-day window with real members"

This is the one clause here whose duration cannot be compressed — it is thirty **calendar**
days by definition, and its own doc is explicit that nothing before the window closes is a
result: "What this is: the plan and the instruments for the soak. What it is not: a result."
(`docs/notebook/soak-30day.md:3`). It also does not currently have anyone to soak on — "Today
the organic population is 0" (`docs/notebook/soak-30day.md:16`) — so this cannot start until
real, consenting members are in the cohort.

**Smallest honest way to run it:** everything except the owner's own actions is already built —
the sampler, the gate, the dashboard, the paging rules, the incident procedure, the closing
checklist. The owner's part is three things:

1. **One-time setup** (~60–90 min): work through the nine numbered preconditions in
   `docs/notebook/soak-30day.md` §1 (deploy confirmed, flag states read from the live process,
   the scheduled jobs verified, the rig signed in, and — the one that actually starts the clock
   — inviting **≥ 5 organic accounts with consent** into the cohort, per `soak-30day.md` §1 row
   P9 and the consent form already built in `docs/notebook/user-study/consent.md`).
2. **A ~10-minute Sunday checklist**, every week for the duration —
   `docs/notebook/soak-30day.md` §8, eight steps: check the scheduled task ran, read the
   dashboard verdict, rule on the weekly gate verdict, run the restore drill, rule on any forks,
   sign the rig back in if needed, triage any open incidents, check the drift section.
3. **Closing** (~30 min, §10): once `nb_soak.py` reports the window complete, commit the raw
   evidence directory before writing any interpretation, then write the verdict entry.

**Ready-to-use kit:** `docs/notebook/soak-30day.md` in full — §1 preconditions, §3 the
instruments and what each reads/writes, §4 the signals it watches, §5 what "data loss" means
operationally (with a four-class triage), §6 the exact PASS/FAIL/INCONCLUSIVE rule, §7 paging
policy, §8 the weekly checklist, §9 the incident procedure (roll back first, per H14/H15),
§10 closing.

**Where to record:** `soak-dashboard.md` (written automatically by `nb_soak.py` each run), plus
by-hand rulings in the file named by `NB_SOAK_RULED` and incident files in `NB_SOAK_INCIDENTS`
(both env-named in §3's table). On close, the evidence directory is
`docs/notebook/evidence/soak-<start date>/`, committed before interpretation (§10).

**Owner time:** ~60–90 minutes to start it, then ~10 minutes a week for 30 days (~45 min total),
then ~30 minutes to close — roughly 2.5–3 hours of owner attention spread across a full calendar
month. **Start this first**, regardless of anything else on this page — every day it is not
started is a day added to when standard #3 can close.

---

## 4. Ordering — what to do first for the biggest clause gain per owner-minute

Two items have lead times the owner does not control, and both should start **today**, before
anything else, because delaying them costs calendar time nothing else on this page can get back:

1. **Send both vendor drafts (§2).** ~15–20 minutes to review and send. Nothing else here
   affects four clauses across two standards (#8, #12 ×2, #13) plus two gap-ledger rows for so
   little owner time — the cost is entirely in waiting for a vendor to answer, so the sooner it
   is asked, the sooner it can close.
2. **Start the 30-day soak's one-time setup (§3.5).** ~60–90 minutes today, then ~10 min/week.
   This has the single longest fuse on this page — 30 **calendar** days, not owner-hours — so
   starting it a week late costs the whole product a week, no matter how fast everything else
   here goes.

Then, in order of clause-gain per owner-minute, cheapest and most complete first:

3. **Submit the Chrome Web Store listing (§1).** ~15–20 minutes, fully built, zero blockers
   found, closes the G-043 half of standard #1 outright.
4. **Walk the two iOS Shortcuts on a real iPhone (§3.4).** ~20–30 minutes, fully built, closes
   the one remaining half of standard #10's capture-parity clause outright.
5. **Run the screen-reader pass, NVDA first (§3.2).** ~60–70 minutes for NVDA alone (this
   machine, no new hardware needed); add a Mac pass later if VoiceOver access opens up. Closes
   the last remaining clause of standard #9.
6. **Run one real-device matrix pass (§3.3).** ~45–60 minutes for one dated row across four
   devices. Does not fully close its clause (the plan asks for "every release"), but is the
   cheapest way to turn a process obligation into something that has actually started.
7. **Schedule the 5–8 trader study (§3.1).** The biggest single time cost (~6–8 hours of session
   time, plus whatever calendar time it takes to find 5–8 traders), so it goes last among the
   short items — but it is not gated on anything else here, so it can run in parallel with the
   soak once scheduling allows. It closes four clauses on its own (three in standard #5, one in
   standard #16) when it lands.

Nothing in this document blocks on anything else in it except where stated above (semantic
search's flags wait on §2's vendor confirmations). Items 3–7 can run in any order relative to
each other without conflict.
