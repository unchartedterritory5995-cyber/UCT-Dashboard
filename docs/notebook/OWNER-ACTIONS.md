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

## 0. The ten owner-only clause groups, in one table

| # | What | Standard(s) / clause(s) it closes | Owner time | Why here |
|---|---|---|---|---|
| 1 | §2 — send the two vendor zero-retention drafts | #8 "vendor data terms in writing", #12 "semantic retrieval", #12 "all on verified vendor terms", #13 "keyword + meaning search"; unblocks G-017/G-127 | ~15–20 min to review and send both | Has an external turnaround time nobody controls — start the clock first |
| 2 | §3.5 — start the 30-day soak | #3 "zero data-loss over a 30-day window" | ~60–90 min one-time setup, then ~10 min/week for 30 days | Has a 30-**calendar-day** fuse — the single longest lead time here; starting it late costs a full month, not effort |
| 3 | §1 — submit the extension to the Chrome Web Store | #1 "every weekly feature exists" (the G-043 half of it) | ~15–20 min | Fully built, fully drafted, zero blockers found; the fastest full close available |
| 4 | §3.4 — walk the two iOS Shortcuts on a real iPhone | #10 "iOS + Android capture parity" (G-044) | ~20–30 min | Android is already done; this is the one remaining half, and it is short |
| 5 | §3.2 — the screen-reader pass (NVDA first, VoiceOver if a Mac is at hand) | #9 "a full screen-reader pass" | ~60–70 min NVDA alone; +30–45 min with a Mac | The other three accessibility clauses are already MET; this is the last one |
| 6 | §3.3 — one real-device matrix pass | #10 "real-device matrix … green every release" (G-164) | ~45–60 min for one dated pass | Recurring by its own wording ("every release") — this is the first dated row, not a final close |
| 7 | §3.1 — the 5–8 trader study (SUS, first-useful-note timing) | #5 (3 clauses), #16 "first useful note < 2 min" | ~6–8 hrs of session time across 5–8 people, spread over however many days scheduling takes | Biggest single time cost; the kit is fully built, so the cost is calendar and people, not preparation |
| 8 | §3.6 — the head-to-head speed benchmark sitting | Phase 7 item 1 "head-to-head speed benchmark"; the parity scorecard's "No competitor's speed is stated here" caveat | ~1 full working day (estimate — the protocol states no duration) | Needs one sitting, one machine, a quiet box, and the owner's own Notion/Evernote/Obsidian sign-ins; nothing in the hand-timed cells can be delegated |
| 9 | §3.7 — the accessibility audit by a second reviewer | Phase 7 item 5 "accessibility audit by a second reviewer" | The NVDA/VoiceOver half is the same sitting as row 5 (run together); the keyboard-walk/WCAG-map half is a separate reviewer's ~2–3 hrs (estimate) | The brief exists specifically so the judge is not one of wave 8's builders — row 5 alone does not close this |
| 10 | §3.8 — legal sign-off: G-062 (G-080 is already done) | Plan §5 item 3 "Legal sign-off (G-062, G-080)" | An external legal review's turnaround, not owner-hours | The one remaining rights-gated capability (analyst estimates) is blocked on outside counsel, the same shape as row 1 |

Do 1 and 2 **today**, regardless of order between them — both have lead times outside your
control. Then 3 and 4 (short, complete, no dependency on anything else). Then 5 and 6. Save 7
for when you have real calendar space; nothing else here blocks on it, and nothing it produces
blocks anything else in this list. **10** has the same "start the clock" shape as 1 and can start
today alongside it. **8** and **9** each need their own dedicated sitting — see §4 below for where
they fit.

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

### 3.6 — The head-to-head speed benchmark sitting (Phase 7.1)

**Exact bar** (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`:124-125):

> "1. **Head-to-head speed benchmark** on one machine with one corpus: open, search, type, paste,
> large note — UCT vs Notion vs Evernote vs Obsidian."

**The instrument already exists (wave 9, lane 9A) — nothing has been run yet.** The method is
`docs/notebook/benchmark/protocol.md`; the report tool is `tools/notebook_bench_report.py`; the
probe is `tools/bench_probes/bench_probe.js`; the corpus generator is
`tools/notebook_bench_corpus.py`. The committed `docs/notebook/benchmark/results.md` reads
`NOT MEASURED` in every cell, and `docs/notebook/benchmark/machine.json` is still the tool's own
unfilled template — verified today:

> "How a cell reads: no accepted dump ⇒ ``NOT MEASURED`` (never 0)" (`tools/notebook_bench_report.py`:21)

**Which parts need the owner, and why.** Every hand-timed cell — Notion, Evernote, Obsidian, and
the UCT production row — is the owner's own sign-in, in one sitting, on one machine:

> "⛔ **No agent holds an account for Notion, Evernote or Obsidian.** The owner times them. The
> UCT column is also timed BY HAND, on the production bench account, with the same steps (ruling
> D-9A3)." (`docs/notebook/benchmark/protocol.md`:14-16)

This is a deliberate design choice, not an omission — the sitting measures human-perceived speed
with real mouse clicks and real typing cadence, and the protocol's own validity section says why a
script cannot stand in for it:

> "**One person, one sitting, one machine**: human timing varies, so reps and the rotation spread
> it" (`docs/notebook/benchmark/protocol.md`:247-248)

So the owner runs `protocol.md` §§2–6 in full: machine prep (a clean Chrome profile,
`python tools/gate_box_lock.py status` reading `lock: FREE` / `load: QUIET`, the trading platform
and Zoom closed), the account/import step per app (including buying and same-day cancelling an
Evernote Starter plan, ruling D-9A5), the DevTools probe sequence for every op (H1–H9) across all
four hand-timed apps, filling `runs/<run-id>/datasheet.md` and a real copy of `machine.json` as
they go, then regenerating `results.md`.

**Owner time (estimate — the protocol states no duration):** machine prep and per-app
import/indexing, ~1–2 hours; the H1–H9 op list (11 op/mode combinations, 2–5 rounds each, across 4
hand-timed apps) is the bulk of the sitting — likely 6–8 hours of focused DevTools-and-stopwatch
work; close-out (Evernote cancellation, corpus removal from the bench account, the data sheet,
regenerating `results.md`) another 30–60 minutes. Call it a full working day.

**What an agent can prepare in advance, so the sitting itself is pure execution:**

- The corpus, outside the repo: `python tools/notebook_bench_corpus.py --out
  C:\Users\Patrick\bench-corpus-<run-id>`, verified with `--verify`.
- The exact DevTools console lines for every op, read from the same plan the automated tool
  drives: `python tools/notebook_bench_uct.py --dry-run --corpus
  C:\Users\Patrick\bench-corpus-<run-id>` prints them (protocol.md §1's "your console lines" row).
  Run without `--corpus` it validates against the **committed** manifest and needs no real corpus
  at all — run today, it finds all **11 ops planned from the committed manifest** with the plan
  schema validating clean: the instrument has not drifted from the protocol.
- A blank copy of `machine.json` at `runs/<run-id>/machine.json`, ready for the owner to fill
  during the sitting — never filled by an agent (see §3.6a).

**What closes:** Phase 7 item 1 of the plan, and the one line in `parity-scorecard.md` that
currently records the sitting as not done:

> "No competitor's speed is stated here (lane 9A's protocol, `docs/notebook/benchmark/protocol.md`,
> and the owner's run)" (`docs/notebook/parity-scorecard.md`:12)

It does **not** move standard #4 (Speed)'s own clause verdicts — those are scored on UCT's own
internal performance budgets (`docs/notebook/perf-budgets.md`), already measured, independently of
any competitor.

**Where the results land:** `docs/notebook/benchmark/runs/<run-id>/` (every dump, the filled
`machine.json`, `datasheet.md`), then `docs/notebook/benchmark/results.md`, regenerated — **never
hand-typed** — with:

```
python tools/notebook_bench_report.py --run docs/notebook/benchmark/runs/<run-id> \
    --machine docs/notebook/benchmark/runs/<run-id>/machine.json \
    --out docs/notebook/benchmark/results.md
```

**Before any number is quoted out loud:** ruling D-9A6 — "**Internal only** until the owner has
checked each vendor's terms on publishing benchmarks" (`docs/notebook/benchmark/protocol.md`:21).
That check is separate from, and in addition to, running the sitting.

#### 3.6a — The automated UCT sandbox row: agent-runnable, and never a substitute

One row of the results table, "UCT sandbox (automated)", is **not** the owner's hand sitting — the
protocol keeps it explicitly apart from the head-to-head:

> "The automated sandbox row (`tools/notebook_bench_uct.py`) is a per-release cross-check on
> a loopback sandbox, never the UCT column and never ratioed against a hand cell."
> (`docs/notebook/benchmark/protocol.md`:16-17)

It drives the real Notebook product with Playwright — a real click on the note card, real
keystrokes, a real Ctrl+V — through the SAME probe file the owner pastes by hand, on a local
loopback sandbox with no network, no vendor accounts and no owner credentials. **Exactly one tool
produces this row's summary**, no other: `tools/notebook_bench_uct.py`.

```
python tools/notebook_bench_uct.py --boot --data-dir 'C:\data-<run-id>' --port 8096 \
    --corpus <a corpus dir from tools/notebook_bench_corpus.py> --json <out>/uct-auto.json
```

It refuses to run (exit 3) on a shared-root data dir, a busy port, a held `gate_box_lock`, or
available memory below the 4.5 GB floor (`gate_box_sampler.FREE_MEMORY_FLOOR_GB`) — so it is safe
to schedule without colliding with anything else on the box; it needs the same "quiet box" the
hand sitting does, which is why this pass did not run it.

**What the machine record must hold for this row to be ACCEPTED — read from the report tool, not
assumed.** `notebook_bench_report.collect_auto()` never calls `machine_conflict()` and never reads
`docs/notebook/benchmark/machine.json` at all — that file's `FILL` state is irrelevant to this row.
Acceptance is decided entirely by the summary JSON `--uct-auto` points at:

1. the six keys `tool`, `git_head`, `integrity`, `self_test`, `per_op`, `machine` are present, and
   every `per_op` record carries `op`/`kind`/`n`/`p50_ms`/`p95_ms`/`status`/`reason`/`dumps`
   (`tools/notebook_bench_report.py`:265-288, `validate_summary`);
2. `integrity.status == "CLEAN"` (the sandbox's own boot/shutdown integrity log), or every timing
   is withheld (`tools/notebook_bench_report.py`:303-305);
3. `self_test.ok == True`, or every timing is withheld — the refusal a missing `selfTest` earns
   is "a dump with no PASSING ``selfTest`` reading (R-HON: an unverified probe times nothing)"
   (`tools/notebook_bench_report.py`:15), enforced at `:306-307`;
4. every individual dump the summary names passes `check_dump`: its `probeVersion` matches
   `bench_probe.js`'s current `PROBE_VERSION`, it carries its own passing `selfTest` reading, no
   `hooks` field (a test dump), and `app == "uct-sandbox-auto"` (`tools/notebook_bench_report.py`:188-219).

That `"machine"` object IS this box's real specs, built by the tool itself at run time
(`tools/notebook_bench_uct.py`'s `main()`, :618-622): hostname (`socket.gethostname()`), Python
version, the `gate_box_lock` state, and `Memory\Available MBytes` before and after via `typeperf`
— never typed, never fabricated. **No separate machine-record template is needed or should be
written for this row** — inventing one would either duplicate what the tool already produces
honestly, or invite the fabrication this brief warns against. The one thing an agent must never do
is write anything into the owner's `docs/notebook/benchmark/machine.json` (the
`operator`/`sitting_date`/`chrome_profile`/etc. template) on the strength of an automated run —
that file describes the hand sitting, and the automated row's acceptance does not use it.

**Adding this row to `results.md`:** re-run the report with `--uct-auto` pointed at the summary:

```
python tools/notebook_bench_report.py --run docs/notebook/benchmark/runs \
    --machine docs/notebook/benchmark/machine.json \
    --uct-auto <out>/uct-auto.json \
    --out docs/notebook/benchmark/results.md
```

Because `collect_auto()` is independent of the hand machine record, this can be committed *before*
the owner's sitting — the four hand-timed apps would still read `NOT MEASURED` while the
automated row carries real numbers, labelled `headless Chromium (Playwright), loopback` and never
compared against a hand cell (`notebook_bench_report.py`'s `_ratios()` excludes the automated app
by name at `:457`).

### 3.7 — Accessibility audit by a second reviewer (Phase 7.5)

**Exact bar** (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`:130): "5. **Accessibility audit** by a
second reviewer." This is Phase 7 item 5, distinct from the Phase 6 build-time accessibility work
and from §3.2 above.

**How this relates to §3.2 — they are not the same clause, and §3.2 alone does not close this
one.** §3.2 above is standard #9's last clause, "a full screen-reader pass (VoiceOver + NVDA)" —
one of a four-clause accessibility bar Phase 6 built toward. Phase 7 item 5 is the capstone
review, and its own brief states why it is a separate obligation:

> "It is written for a reviewer who did **not** build wave 8 (lanes 8A–8D), so that the Notebook's
> accessibility is judged by someone other than the people who made it." (`docs/notebook/a11y-second-review-brief.md`:4-5)

The brief (`docs/notebook/a11y-second-review-brief.md`) splits into five sections, and only two
are the owner's:

| part | who (`docs/notebook/a11y-second-review-brief.md`:12-16) |
|---|---|
| §2 WCAG map, §3 keyboard-only walk, §5 recording | **the second reviewer** — "any machine, a sandbox; no production" |
| §4a NVDA pass (Windows) | **OWNER** |
| §4b VoiceOver pass (macOS Safari, iOS Safari) | **OWNER** |

§4a/§4b are the SAME NVDA/VoiceOver pass §3.2 already has the owner running
(`docs/notebook/screen-reader-pass.md`) — the brief's §4 says to run that identical 27-step script
and then add five second-review-specific checks (the public share/publish pages signed out while
logged out, the Ask answer announced while typing continues, the offline banner appearing without
a reload, the version-history list and its restore confirmation, and Trash's restore button and
announcement). **One sitting can do both** — running §3.2's pass under this brief, with its five
additions, satisfies §4a/§4b of Phase 7.5 at the same time it satisfies standard #9's own clause.
Do not run the screen-reader pass twice.

§2, §3 and §5 are a keyboard-only walk and a WCAG 2.2 AA surface map that need no owner
credentials and no production access ("any machine, a sandbox; no production",
`docs/notebook/a11y-second-review-brief.md`:14) — but they need a reviewer who was **not** one of
wave 8's builders, which is the whole reason this brief exists. Whoever the owner designates —
another person, or a fresh agent session that built no part of wave 8 — runs §2/§3/§5; this
worktree's lane, or any lane that shipped Notebook product code, cannot certify its own work under
this brief's own stated reason for existing.

**Owner time:** the NVDA/VoiceOver portion (§4a + §4b) is the same ~60–70 minutes as §3.2 above,
plus ~30–45 minutes if a Mac is available, plus the five additions (~15–20 minutes). The
keyboard-walk/WCAG-map portion (§2/§3/§5) is a separate reviewer's time, not the owner's — the
brief does not state a duration; by its own step count (six numbered walk sections across
list/editor/graph/sheets/public pages/touch tier, mapped against ~30 WCAG 2.2 AA success criteria
in §2's table) budget a comparable order of magnitude to the NVDA pass, roughly 2–3 hours
(estimate, not stated in the brief).

**Where to record:** `docs/notebook/evidence/a11y-second-review-<YYYY-MM-DD>/`, raw findings
committed **before** any summary is written (the R-RAW rule), using the brief's own findings table
(id, WCAG SC, surface, steps, expected, heard/seen, severity, known-gap-or-new). Findings are then
filed by the controller against gap-ledger row G-168 (accessibility) or a new row —

> "**Nothing is fixed during the review.** Findings go to the controller, who files each one
> against a ledger row (G-168 for accessibility) or opens a new row; the reviewer does not edit
> product code, the gap ledger or this brief's §1 facts." (`docs/notebook/a11y-second-review-brief.md`:186-188)

**What closes:** Phase 7 item 5 of the plan. By itself it does not move standard #9's "a full
screen-reader pass" clause past `NOT MEASURED — OWNER` in `parity-scorecard.md`:509 — that still
needs the §4a/§4b reading recorded exactly as §3.2 above describes — but one combined sitting
closes both at once.

### 3.8 — Legal sign-off: G-062 (analyst estimates) — G-080 is already done

**Exact bar** (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`:192, §5 "What stays with the owner"): "3.
Legal sign-off (G-062, G-080) and written vendor data terms (Anthropic, OpenAI)." The vendor-terms
half is §2 above; this section is the legal-sign-off half, read from the gap ledger
(`docs/notebook/competitive-gap-ledger.md`) for what each row actually asks.

**G-080 is already done — there is nothing left to send for it.** The owner's legal sign-off for
public share links and publish-to-web was recorded 2026-09-25 and the flags were armed the next
day:

> "Wave 8 (2026-09-26): authorization proven by lane 8B's rails … owner legal sign-off recorded
> 2026-09-25 (P-7). Activation awaits the owner's confirmation of the public-page wording (final
> review I-4), then is one variable." … "ARMED 2026-09-26 18:53Z — `J2_SHARE_LINKS_ENABLED=1` on
> web after wave 8 went live … Owner legal sign-off 2026-09-25 (P-7, L1-L10) and the public-page
> wording settled 2026-09-26 (option a): `docs/notebook/share-publish-flip-packet.md` §1.3-§1.4"
> (`docs/notebook/competitive-gap-ledger.md`:138)

The recorded answers are in `docs/notebook/share-publish-flip-packet.md`:35, "The owner's answers,
recorded 2026-09-25 (lane 8B brief, both BINDING)." The parity scorecard already reads this row as
closed — `G-080 Public share link (read-only) — PARITY / NOT-VERIFIED / PARITY`
(`docs/notebook/parity-scorecard.md`:677), no longer `BLOCKED`. The plan's §5 line grouping G-062
and G-080 together pre-dates this closure.

**G-062 is the one still open, and it needs the owner (or the owner's outside counsel), not an
agent.** Watchlist/scanner capture and price/user-note capture are done and needed no sign-off;
the remaining piece is analyst estimates/ratings/price-target consensus, and the ledger is
explicit that it is gated on an external legal review, not an engineering task:

> "**Analyst estimates/ratings/price-target CONSENSUS specifically: architected but deliberately
> INACTIVE** — `analyst_price_target_consensus` exists fully in the fact-type registry and
> resolver (proving the architecture generalizes) but `rights_class: conditional` blocks any write
> path until Patrick's external legal review approves persistent FMP-derived value storage (never
> reopened by this program)." (`docs/notebook/competitive-gap-ledger.md`:118)

The parity scorecard still reads this row `BLOCKED (owner) / BLOCKED (owner) / BLOCKED (owner) —
owner: legal sign-off` (`docs/notebook/parity-scorecard.md`:676).

**What the review needs to answer:** whether UCT may persistently store (frozen-at-insert, inside
a member's own note) an analyst price-target consensus figure sourced from FMP — unlike the
price/user-note capture already shipped, which needed no such review. Nothing here is waiting on
more building: `analyst_price_target_consensus` is already declared in the fact-type registry,
inactive —

```
"analyst_price_target_consensus": FactTypeDef(
    key="analyst_price_target_consensus", label="Analyst Price Target (Consensus)",
    value_column="value_number", unit="usd_per_share",
    temporal_mode="snapshot", source="fmp", rights_class="conditional",
    active=False,
),
```
(`api/services/journal_two/fact_registry.py`:52-57) — with a resolver already proving the pattern
generalizes; activating it once approved is, per the ledger, "a frontend-only change"
(`docs/notebook/competitive-gap-ledger.md`:118).

**Owner time:** this is an external legal review, not owner-hours in the usual sense — the
owner's part is commissioning the review (or making the call personally) and, if approved,
authorizing the flip. No duration is estimated because, like the vendor ZDR requests in §2, the
cost is calendar time waiting on an outside answer, not a task's length.

**Where to record:** once a ruling exists, update G-062's row in
`docs/notebook/competitive-gap-ledger.md` with the decision and its date — the same pattern
G-080's P-7 sign-off used — and set `analyst_price_target_consensus`'s `rights_class` /
`active` accordingly.

**What closes:** the estimates/ratings slice of G-062 stays `PARTIAL` — "P2 (rights-blocked, not
effort-blocked)" (`docs/notebook/competitive-gap-ledger.md`:118) — until this lands. Nothing else
in the 10/10 plan is blocked on it.

---

## 4. Ordering — what to do first for the biggest clause gain per owner-minute

Three items have lead times the owner does not control, and all three should start **today**,
before anything else, because delaying any of them costs calendar time nothing else on this page
can get back:

1. **Send both vendor drafts (§2).** ~15–20 minutes to review and send. Nothing else here
   affects four clauses across two standards (#8, #12 ×2, #13) plus two gap-ledger rows for so
   little owner time — the cost is entirely in waiting for a vendor to answer, so the sooner it
   is asked, the sooner it can close.
2. **Start the 30-day soak's one-time setup (§3.5).** ~60–90 minutes today, then ~10 min/week.
   This has the single longest fuse on this page — 30 **calendar** days, not owner-hours — so
   starting it a week late costs the whole product a week, no matter how fast everything else
   here goes.
3. **Kick off G-062's external legal review (§3.8).** No fixed minutes — the owner's part is
   commissioning the review or making the call personally — but like 1 and 2, the cost is
   entirely in waiting for an outside answer, so it should start the same day. (G-080, the other
   half of this plan item, is already closed — recorded 2026-09-25, nothing further to send.)

Then, in order of clause-gain per owner-minute, cheapest and most complete first:

4. **Submit the Chrome Web Store listing (§1).** ~15–20 minutes, fully built, zero blockers
   found, closes the G-043 half of standard #1 outright.
5. **Walk the two iOS Shortcuts on a real iPhone (§3.4).** ~20–30 minutes, fully built, closes
   the one remaining half of standard #10's capture-parity clause outright.
6. **Run the screen-reader pass, NVDA first (§3.2), under the §3.7 second-review brief's five
   additions.** ~60–70 minutes for NVDA alone (this machine, no new hardware needed), plus
   ~15–20 minutes for the five additions §3.7 asks for; add a Mac pass later if VoiceOver access
   opens up. One sitting closes the last remaining clause of standard #9 **and** the §4a/§4b half
   of Phase 7 item 5 at once — do not run this pass twice.
7. **Run one real-device matrix pass (§3.3).** ~45–60 minutes for one dated row across four
   devices. Does not fully close its clause (the plan asks for "every release"), but is the
   cheapest way to turn a process obligation into something that has actually started.
8. **Arrange the second reviewer's keyboard-walk / WCAG-map pass (§3.7, §2/§3/§5 of its brief).**
   ~2–3 hours (estimate) of a reviewer's time — someone who did not build wave 8 — but the
   owner's own part is only choosing that person and handing them the brief; it can run any time
   after item 6 and blocks nothing else on this page.
9. **Schedule the 5–8 trader study (§3.1).** The biggest single time cost among the short items
   (~6–8 hours of session time, plus whatever calendar time it takes to find 5–8 traders), so it
   goes near the end — but it is not gated on anything else here, so it can run in parallel with
   the soak once scheduling allows. It closes four clauses on its own (three in standard #5, one
   in standard #16) when it lands.
10. **Run the head-to-head speed benchmark sitting (§3.6).** The other biggest single time cost
    on this page (~1 full working day, estimate) — like the trader study, it is not gated on
    anything else here, but it does need a quiet box (one sitting, one machine), so schedule it
    for whenever one is available. The automated UCT sandbox cross-check (§3.6a) is a separate,
    agent-runnable artifact and needs no owner time at all — it can be produced any time, before
    or after the sitting, without touching this item's estimate.

Nothing in this document blocks on anything else in it except where stated above (semantic
search's flags wait on §2's vendor confirmations; G-062's estimates capability waits on item 3's
outside answer). Items 4–10 can run in any order relative to each other without conflict.
