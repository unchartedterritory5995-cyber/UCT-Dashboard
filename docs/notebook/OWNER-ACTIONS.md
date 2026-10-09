# Notebook 10/10 — the owner's actions, as checklists

## What is left, and what each step unlocks

Twelve owner actions are tracked in this file. A "scorecard clause" below is one line of the
61-line checklist in `docs/notebook/parity-scorecard.md`, which scores this product standard by
standard against Notion, Evernote and Obsidian. Each clause reads one of: `MET`, `NOT MET`,
`NOT MEASURED` (nobody has taken the reading yet), or `BLOCKED` (something outside this
programme has to happen first). Seven of the twelve actions below would move one or more
clauses; the other five are real work — repo cleanup, one unfinished check, one open policy
question — that do not move a counted clause, and are marked "None" rather than given one.

Rows are ordered by scorecard clauses gained per hour of the owner's own time, highest first.
Two rows (the vendor letters and the 30-day trial) have a fuse outside anyone's control — a
vendor's reply time, and 30 calendar days — so both are worth starting today regardless of
their place in this ordering; see each row's "Blocked today?" cell.

| # | Action, in plain words | About how long | Scorecard clause(s) it would move | Steps | Blocked today? |
|---|---|---|---|---|---|
| 1 | Send the two already-drafted letters to Anthropic and OpenAI, asking each for a "zero data retention" (ZDR) promise in writing — a commitment that the vendor will not keep or train on what UCT sends it | ~15–20 min to review and send both | #8 `"vendor data terms verified in writing (zero retention)"` (`parity-scorecard.md:504`, `NOT MET`) → `MET` once BOTH vendors reply yes; #12 `"semantic retrieval"` (`:549`, `NOT MET`) → `MET` once OpenAI replies yes (this also arms the already-built meaning-search feature); #12 `"all on verified vendor terms"` (`:550`, `NOT MET`) → `MET` once both reply yes; #13 `"keyword + meaning search"` (`:558`, `NOT MET`) → `MET` once OpenAI replies yes | §2 | No — the drafts are ready. The clauses do not flip the moment the letters are sent; they flip once each vendor replies, and that reply time is outside anyone's control, which is why this row is ranked first despite its clause count being per letter SENT, not per letter ANSWERED |
| 2 | Submit the already-built, already-packaged browser extension ("web clipper") to the Chrome Web Store | ~15–20 min | #1 `"every weekly feature exists for members"` and #1 `"or is a recorded, deliberate \"no\" with a reason"` (`parity-scorecard.md:429`, `:430`, both `NOT MET`) — closes the extension half of both; both stay `NOT MET` until row 1's OpenAI letter also lands, since the clause covers every weekly feature together, not one at a time | §1 | No — zero blockers found in a fresh check today (§1 "Blockers found"). Needs row 1 above to also land before either clause fully closes |
| 3 | Build the two iPhone Shortcuts by hand on a real iPhone and test each once | ~20–30 min | #10 `"iOS + Android capture parity"` (`parity-scorecard.md:526`, `NOT MEASURED — OWNER`) → `MET` (Android's half is already done) | §3.4 | No |
| 4 | Sign in to a BrowserStack Live session (real rented phones, reached through a browser) on one iOS 16, one iOS 17, one iOS 18 and one Android device, and run a short check on each | ~45–60 min for all four devices | #10 `"real-device matrix green every release"` (`parity-scorecard.md:528`, `NOT MEASURED — OWNER`) → `MET` for this dated pass; the clause's own words, "every release", mean it needs repeating at each future release to stay `MET` | §3.3 | No |
| 5 | Install NVDA (free, already supported on this Windows machine) and walk the 27-step screen-reader script; add the VoiceOver half later if a Mac becomes available | ~60–70 min for NVDA alone, +30–45 min more with a Mac | #9 `"a full screen-reader pass (VoiceOver + NVDA)"` (`parity-scorecard.md:517`, `NOT MEASURED — OWNER`) → `MET`; the clause names both readers, so an NVDA-only pass is a real step but a partial one unless VoiceOver is also run, or its absence is recorded honestly as the script asks | §3.2 | No |
| 6 | Start the 30-day data-safety trial (the "soak"): work through the setup checklist and invite at least 5 real, consenting members into the cohort | ~60–90 min to start, then ~10 min/week for 30 days | #3 `"zero data-loss incidents over a 30-day window with real members"` (`parity-scorecard.md:450`, `NOT MEASURED — OWNER`) → `MET`, only after 30 clean calendar days | §3.5 | No, but it has a 30-calendar-day fuse: every day it is not started is a day added before standard #3 can close, which is why it is worth starting today even though six rows above rank higher by clauses-per-hour |
| 7 | Recruit and run 45-minute sessions with 5–8 traders, using the kit that is already built | ~6–8 hours of session time across 5–8 people, plus ~30 min to score | #5 `"a task-based test with 5-8 traders"`, #5 `"every core task completed unaided"`, #5 `"SUS >= 80"` (`parity-scorecard.md:473-475`, all `NOT MEASURED — OWNER`) → `MET`; #16 `"a new member reaches a first useful note in < 2 minutes unaided"` (`:591`, `NOT MEASURED — OWNER`) → `MET` | §3.1 | No. One more clause shares this kit, #1 `"the list is what Notion/Evernote/Obsidian users actually reach for weekly"` (`:431`), but is NOT counted as closed by this row: the screener (`docs/notebook/user-study/screener.md`) does not currently ask participants what they use weekly in their old tool — checked today, the words "weekly" and "census" appear nowhere in that file or in `user-study-kit.md`. That clause stays open even after this row runs, until the question is added |
| 8 | Delete the leftover sandbox folders and two finished CI branches that nobody working inside an agent session can remove | ~10 min | None of the 61 scorecard clauses — repo cleanup only | §3.9 | No |
| 9 | Check the one personal-API action that has not been run against real data: appending to today's daily note (as opposed to a regular note) | ~10–15 min | None of the 61 scorecard clauses — closes one loose end in gap-ledger row G-085's own evidence; G-085 already reads as live for every scorecard clause that touches it | §3.10 | No |
| 10 | Pick a second accessibility reviewer — anyone who did not build wave 8 — and hand them the existing brief | ~10–15 min of owner time (the reviewer's own walk is ~2–3 hours, and that time is not the owner's) | None of the 61 scorecard clauses — closes Plan Phase 7 item 5, not a counted clause; standard #9's own clause is the one row 5 above closes | §3.7 | No |
| 11 | Decide how long UCT keeps `activity_log` rows — the table that records member actions, including Notebook's own save/export/import/share/publish/writing-help/dictation events — and say so | ~15–20 min | None of the 61 scorecard clauses — no clause names an internal retention policy; this closes an open privacy question the vendor-terms review found and never answered | §3.11 | No |
| 12 | Sit for a full working day timing UCT against Notion, Evernote and Obsidian on the same tasks | ~1 full working day (the protocol states no duration; this is an estimate) | None of the 61 scorecard clauses — standard #4's own clauses are already scored from UCT's internal budgets, independently of any competitor; this closes Plan Phase 7 item 1 and one caveat line in the scorecard, not a clause | §3.6 | No, but needs a quiet machine for the whole sitting |

**Already done or decided (controller, 2026-10-01).** The table above was written from the
repository alone. Three of its rows are further along than it says. The source for the first
three lines below is the controller's working ledger, which is not in git, and the owner's own
words in chat; the scheduled-task readings were taken on this machine on 2026-10-01.

- **Row 2 (browser extension): reported submitted 2026-09-26, not verified in the store.** ⚰️ This line said "already
  submitted" as a fact until 2026-10-07. Its only source is the controller's working ledger and the
  owner's words in chat, neither of which is in git, and nothing in the repository shows a
  store listing: the scorecard still reads `BLOCKED (owner)` for G-043
  (`parity-scorecard.md`, the G-043 row) and `BETA-HANDOFF.md` section 2 still lists the
  submission as open. So: the owner is reported to have submitted it on 2026-09-26 as an
  unlisted item. If that is right, what is left is the store's review, which is outside
  anyone's control, and then two small steps: put the install link in the Notebook's capture
  help, and switch the listing to Public at launch. If it is not, row 2 is still to do. One
  look at the Chrome Web Store developer dashboard settles it.
  **SETTLED 2026-10-09 ~11:45 CT: NOT submitted.** Opening
  `https://chrome.google.com/webstore/devconsole` in the owner's own signed-in Chrome landed on
  `/webstore/devconsole/register` ("Chrome Web Store - Developer Agreement"): this Google
  account has never registered as a Chrome Web Store developer, so no item exists. Row 2 is
  the full §1 path: register ($5, agreement), New item, upload
  `.extension-build/uct-browser-capture-0.1.0.zip` (rebuilt today, sha256 71f4c8251c952891),
  paste the listing and privacy text from `chrome-web-store-listing.md`, Unlisted, submit.
  ⚠️ Chrome forbids extensions from scripting the gallery/console pages, so an agent can open
  them in the owner's Chrome but can neither read nor fill them; the owner does those tabs.
- **Row 6 (the soak): already running.** The nightly roll-up task `UCT-NB-Soak` has run since
  2026-09-26; its last run was 2026-09-30 18:30 and exited 0. That run's line reads day 4.2 of
  30, verdict INCONCLUSIVE, with 2 of the 5 organic members and 3 of the 20 active members the
  soak needs. So the setup is done; what is left is the cohort. The 30 days only count once
  enough real members are using the Notebook.
- **Row 1 (the two zero-retention letters): deferred by the owner.** On 2026-09-26 the owner
  chose to send them shortly after the live launch. The drafts in §2 are unchanged and ready.
- **Row 7's caveat is closed.** The screener now asks the weekly question (question 6 in
  `docs/notebook/user-study/screener.md` §2), and the kit says how to read the answers
  (`docs/notebook/user-study-kit.md` §9), both added on 2026-10-01. So the trader study can
  also settle standard #1's third clause, "the list is what Notion/Evernote/Obsidian users
  actually reach for weekly". With rows 1, 2 and 7 all done, #1 Features would read 3 of 3, and
  the totals below become 56 of 61 clauses and 11 of 16 standards, not 55 and 10.
  (⚰️ "55 ... not 54" until 2026-10-07: every total here was one low, see the arithmetic note below.)
- **The weekly restore drill (standard #7): next unattended run is Sunday 2026-10-11 at 09:00.**
  ⚰️ Until 2026-10-07 this said the next run was 2026-10-04 and that it could start. It did not start.
  `C:\Users\Patrick\uct-q1-observe\restore_drill.run.log` reads, for `Sun 10/04/2026  9:00:01`:
  "can't open file 'C:\Windows\System32\tools\authdb_restore_drill.py'" and
  `DRILL exit=2`: the task ran from the wrong folder and the drill never began. A run by hand
  at 09:15 the same day passed (same log: "auth.db restore drill - PASS";
  `soak-drills\drill-2026-10-04.md`), which does not count as a scheduled run. The hardened
  wrapper that fixes the folder and turns a missing checkout into a loud failure was deployed on
  2026-10-06 (`wave14-ops.md`, section 5B). Task Scheduler shows the next run as
  `10/11/2026 9:00:00 AM` (read 2026-10-07). Earlier history, unchanged: the scheduled run of
  2026-09-27 ended INCONCLUSIVE because that night's attachment backup predated the checksum
  list, and a run by hand on 2026-09-28 passed. For the owner: keep the PC on and logged in on
  Sunday morning.

> ⚰️ **Corrected 2026-10-07: the counts in this paragraph were one low.** The scorecard's own table
> (`parity-scorecard.md`, section B, "clauses met k/n") sums to **41**, not 40:
> 0+4+2+5+1+3+2+3+3+0+3+2+3+3+4+3. The clause that moved is #14 "no super-linear curve", which
> the scorecard now reads `MET` (`docs/notebook/gate-runs/wave10-PC/curve-d22-q2.log`:211,
> "VERDICT: PASS -- curve: every op's slope <= 1.1"). It was never one of the fourteen the owner
> can close, so the fourteen still stand and every total moves up by one: 41 today, 55 with
> every row done, and **6** clauses still unmet then, not 7. `BETA-HANDOFF.md` already says 41.
> The struck numbers are kept so the old figures can be recognised.

**The arithmetic, derived from `docs/notebook/parity-scorecard.md` §B and §C (checked today
against the committed file, not estimated):** the scorecard reads **~~40~~ 41 of 61 clauses met, 3 of
16 standards at the bar** today. If every row above runs, and both vendor letters in row 1 come
back yes, **14 more clauses close** (rows 1, 2, 3, 4, 5, 6 and 7 — rows 8 through 12 close none),
for **~~54~~ 55 of 61 clauses met**, and **10 of 16 standards at the bar** (the seven newly at the bar —
#1 Features, #3 Reliability, #5 User experience, #8 Security & privacy, #9 Accessibility, #12 AI
trustworthiness & usefulness, #13 Search quality, #16 Onboarding & learnability — minus #1, which
stays short one clause for the reason in row 7 — join the three already there, #2 Functionality,
#6 User interface, #15 Operability & observability). Re-counted by standard: #1 Features would
read 2/3 (not at bar, see row 7's note); #4 Speed stays 5/6; #7 Data safety & durability stays
2/3; #10 Mobile, offline & cross-device would read 2/3; #11 Import, export & interoperability
stays 3/4; #14 Performance at scale stays ~~2/4~~ 3/4. **~~7~~ 6 clauses would still be unmet even then**, for
four different reasons, none of them owner-actionable today:

- **Two are permanent, already-decided "no"s**, not open questions: #10 `"cold-start offline"`
  (`parity-scorecard.md:527`, ruling D6/D19) and #11 `"two-way sync where offered"` (`:538`,
  ruling D18).
- **One is a standing owner ruling, not a pending decision**: #14 `"size-cap notes"` (`:571`,
  ruling G-035/D20 — no hard cap on note size).
- **One needs an unattended scheduled task to fire and pass on its own**, not a person running
  it by hand: #7 `"restore rehearsed end-to-end on a schedule"` (`:494`) — the hand-run version
  already reads a full PASS; what is owed is the next automatic weekly run.
- **Two need a quiet-machine reading from the controller or an agent**, not an owner action: #4
  `"typing < 16 ms/char up to the size cap"` (`:463` — a quiet-box reading exists at `17.35–17.75
  ms` median for 2,000 paragraphs, `docs/notebook/perf-runs/ty2-quiet/README.md:29`, still over
  the line) and ~~#14 `"no super-linear curve"` (`:572` — the measurement method changed under
  ruling D22, but the re-read on the new default has not yet been taken)~~ (⚰️ struck 2026-10-07: the
  re-read was taken and passed, and the scorecard reads this clause `MET`; so ONE needs a quiet
  reading, not two).
- **And the seventh is #1's `"the list is what Notion/Evernote/Obsidian users actually reach for
  weekly"`** (`:431`), open for the reason given in row 7 above: the trader-study kit does not
  yet ask the question that would answer it.

---

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

## 0. The nine owner-only clause groups, in one table

⚰️ This heading said "ten" — row 10 (G-062) closed and was removed; see below.

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

⚰️ **Row 10 (§3.8 — legal sign-off: G-062) is CLOSED and removed from this table.** The owner
approved the FMP licensing directly on 2026-09-25 — this was never the external legal review
this row described; see §3.8 below for the short record. G-080, the other half of the plan's
"Legal sign-off (G-062, G-080)" item, closed the same way earlier. Nothing in Plan §5 item 3
remains open.

Do 1 and 2 **today**, regardless of order between them — both have lead times outside your
control. Then 3 and 4 (short, complete, no dependency on anything else). Then 5 and 6. Save 7
for when you have real calendar space; nothing else here blocks on it, and nothing it produces
blocks anything else in this list. **8** and **9** each need their own dedicated sitting — see
§4 below for where they fit.

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

### 3.8 — Legal sign-off: G-062 (analyst estimates) — CLOSED, both halves of this plan item

**Exact bar** (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`:192, §5 "What stays with the owner"): "3.
Legal sign-off (G-062, G-080) and written vendor data terms (Anthropic, OpenAI)." The vendor-terms
half is §2 above. Both G-080 and G-062, the legal-sign-off half, are now closed — this section is
kept as a short record, not an open action.

**G-080 closed first** — the owner's legal sign-off for public share links and publish-to-web was
recorded 2026-09-25 and the flags were armed the next day (`docs/notebook/competitive-gap-ledger.md`:138,
`docs/notebook/share-publish-flip-packet.md`:35).

**G-062 closed the same way, not through a separate external legal review.** The owner approved the
FMP licensing directly:

> "**APPROVED** -- the owner arranged licensing directly with FMP (confirmed 2026-09-25)."
> (`docs/notebook/VENDOR-TERMS-2026-09-23.md`:11)
>
> "L5 | Analyst-consensus storage (G-062): UNBLOCKED -- the FMP approval covers it | the
> conditional fact type is activated in a later lane" (`docs/notebook/VENDOR-TERMS-2026-09-23.md`:91)

This row previously described G-062 as waiting on "Patrick's external legal review" of a
still-inactive registry entry. That was the state before 2026-09-25; the owner's direct approval
closed it without a separate outside-counsel review ever running, the same way it closed G-080.

**Activation was built by lane G62** (branch `feat/notebook-w10-g62`), commit `b871bd65a`:
`analyst_price_target_consensus` is now `active=True` in the fact-type registry
(`api/services/journal_two/fact_registry.py`:69-75), reached by two doors mirroring the existing
`price` doors exactly — a `/consensus TICKER` slash command and a TickerPopup "Save analyst
consensus to Notebook" button — with the same frozen-at-insert semantics and the same honest
missing-data refusal (never a fabricated number) when FMP has no consensus for a ticker.
Unit-verified (`api/services/journal_two/test_wave_f_facts.py`,
`tests/test_journal_two_facts_router.py`).

**CLOSED — this section previously said the real-browser walk was pending; it has since run and
passed.** `tools/notebook_g62_consensus_walk.py` ran 8 of 8 PASS:

> "real-browser walk PASSED 8/8 (`tools/notebook_g62_consensus_walk.py`,
> `docs/notebook/gate-runs/g62/walk-4d2a4edfa-run3.json`, 2026-09-30: both doors, frozen-at-insert,
> the "Source: FMP" credit, G3 on live FMP data)" (`docs/notebook/competitive-gap-ledger.md`:118)

That landed in L13 (PR #259, squash `a680b0d40`), which merged to `master` 2026-10-01 and is an
ancestor of `origin/production` as of this check (`git merge-base --is-ancestor a680b0d40
origin/production`, checked today). The parity scorecard reads G-062 as fully closed:

> "Legal sign-off landed (owner, 2026-09-25): FMP licensing approved directly, so the conditional
> fact type is ACTIVE; both member doors (the /consensus slash command and the TickerPopup
> button) walked PASS in a real browser, G3 on live FMP data." (`docs/notebook/parity-scorecard.md`:307)

**Where recorded:** G-062's row in `docs/notebook/competitive-gap-ledger.md`:118 and the parity
scorecard's G-062 row (`docs/notebook/parity-scorecard.md`:307, generated by
`tools/parity_scorecard.py`).

**What remains:** nothing. Both halves of this plan item — legal sign-off and the real-browser
walk — are done; there is no further owner or agent action against G-062.

### 3.9 — Delete the leftover sandbox folders and two dead CI branches

**Found by a ledger verification pass, not by any scorecard clause** — these do not move a
clause; they are repo cleanup that nobody working inside an agent session has permission to do.

**What exists today, checked just now:**

- A directory listing of the box's root (`ls -la /c/`, run today) shows roughly two dozen
  `C:\data-w10*` folders — scratch data directories left behind by finished wave-10 lane
  sandboxes. Three were specifically named as needing the owner: `C:\data-w10a`,
  `C:\data-w10r1d`, and `C:\data-w10r1d-2`. The others (`data-w10ax`, `data-w10ctl2`,
  `data-w10d2`, and about twenty more) were **not** named and are left alone here — some may
  still belong to an active lane's sandbox, and deleting one without checking first risks
  breaking another lane's run in progress.
- `git ls-remote --heads origin` (run today) shows `ci/notebook-w10a-latency-red` and
  `ci/notebook-w10a-flapwatch` still exist on the remote. A third, similarly-named branch,
  `ci/notebook-w10a-bytes-red`, also exists and is **not** included here, since it was not
  flagged as dead.

**Why the owner:** these sit outside any worktree's tracked contents, at the root of the box
(the data folders) or on the shared remote (the branches), and nobody running inside this
programme's agent sessions has delete permission for either.

**Steps:**

1. From an ordinary terminal (not an agent session), delete the three named data folders and
   everything in them:
   ```
   Remove-Item -Recurse -Force C:\data-w10a, C:\data-w10r1d, C:\data-w10r1d-2
   ```
   (or `rm -rf` from Git Bash). None of the three is a git worktree and none is tracked by git —
   deleting them removes only scratch SQLite/data files from finished test runs.
2. Delete the two finished CI branches from any normal checkout (not from inside this
   worktree, which is itself a `feat/notebook-w10-*` branch):
   ```
   git push origin --delete ci/notebook-w10a-latency-red ci/notebook-w10a-flapwatch
   ```

**Where to record:** nothing in the scorecard or the gap ledger reads these — there is nothing
to update afterward beyond confirming the delete succeeded.

### 3.10 — Check the personal API's daily-note append against real production data

**Found by a ledger verification pass.** Standard #1's "every weekly feature exists for
members" and standard #11's "a documented API" already read the personal API (G-085) as live —
this item closes a loose end in that row's own evidence, not a scorecard clause.

**What's already verified:** lane 10D walked the personal API in production as the synthetic
member account `bench@uctintelligence.internal` — mint a token, create a note, append to it,
read it back, revoke the token, and confirm a bogus and a revoked token are both refused with
401 — all PASS (`docs/notebook/evidence/wave10-10d/personal-api-walk-20260927T043218Z.json`).

**What's not verified:** the one remaining personal-API action, appending to **today's daily
note** rather than to a regular note, was deliberately skipped in that walk because it creates a
new folder in production. Quoted exactly:

> "the daily-note append NOT RUN (it would create a folder in production)"
> (`docs/notebook/competitive-gap-ledger.md`:143)

**Why the owner:** creating that folder is a real write against the live product's data under a
synthetic member account, and whether to spend that production write (and clean it up
afterward) is the same kind of call this programme has reserved for the owner throughout —
compare the smoke/bench account rules in `CLAUDE.md`'s "Testing → Smoke" section, which this
programme's production walks already follow.

**Steps (either one closes this item):**

1. Sign in as `bench@uctintelligence.internal`, mint a personal-API token in Settings → Personal
   API, and send one append-to-daily-note request — either by hand against the endpoint
   documented in `docs/notebook/personal-api.md`, or by adapting
   `tools/notebook_personal_api_walk.py` to drive it — then delete the resulting folder/note
   afterward so the bench account stays clean, per the "whatever a run creates, that run
   removes" rule this account already follows; **or**
2. Decide that "append to a regular note" is sufficient evidence for this capability (the
   underlying write path is the same function with a different target) and record that decision
   instead of running a fourth production write.

**Where to record:** either outcome, update G-085's row in
`docs/notebook/competitive-gap-ledger.md`:143 to say which was chosen.

### 3.11 — Decide how long UCT keeps `activity_log` rows

**Found by a ledger verification pass while checking the vendor zero-retention letters in §2.**
No scorecard clause names this — standard #8's "vendor data terms verified in writing" is about
outside vendors, not UCT's own database — so this closes an open privacy question, not a clause.

**What was found, re-checked today:**

> "`page_views` stores `user_id` (`auth_db.py:164-168`) and `activity_log` stores `ip_address`
> (`auth_db.py:120-126`). Second, *"individual records purged after 90 days"*: no purge exists."
> (`docs/notebook/VENDOR-TERMS-2026-09-23.md`:49-50)

Still true on this tree: `api/services/journal_two/account_purge.py` does not mention
`activity_log` at all (checked today with a grep across the file — zero hits), and no scheduled
job in `api/main.py` deletes old `activity_log` rows. `activity_log` is also where Notebook's own
wave-10 telemetry events live — `save_success`, `export_used`, `import_used`, `share_used`,
`publish_used`, `writing_help_used`, `dictation_used`, `bulk_used`
(`app/src/pages/journal-2-0/lib/notebookTelemetry.js`:59, `CORE_ACTION_EVENTS`) — so this table
is growing every day a member uses the Notebook, with no decided end date.

**Why the owner:** how long UCT keeps a record tying a member's IP address to their actions is a
privacy policy decision, not an engineering one. `Privacy.jsx` today makes no retention claim
for this table at all (the previous, false "90 days" claim was removed in `24db02b9e` per
`VENDOR-TERMS-2026-09-23.md`:50) — which is honest but leaves the member with no answer.

**Steps:**

1. Decide a retention window for `activity_log` (for example, the 90 days the old, false
   Privacy-page claim used, or any other period).
2. Say so, so a purge job can be built and `Privacy.jsx` can state the real number.
3. Record the decision (date and window) the same way other owner rulings in this programme are
   recorded — for example, alongside the D-numbered rulings in
   `docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`, or in `VENDOR-TERMS-2026-09-23.md` itself.

**Owner time:** ~15–20 min to decide and say so; building the purge job and updating the Privacy
page is not owner time.

---

## 4. Ordering — what to do first for the biggest clause gain per owner-minute

Two items have lead times the owner does not control, and both should start **today**, before
anything else, because delaying either of them costs calendar time nothing else on this page can
get back. (A third item, G-062's external legal review, used to belong here — it closed 2026-09-25
via the owner's direct FMP approval and is gone from this ordering; see §3.8.)

1. **Send both vendor drafts (§2).** ~15–20 minutes to review and send. Nothing else here
   affects four clauses across two standards (#8, #12 ×2, #13) plus two gap-ledger rows for so
   little owner time — the cost is entirely in waiting for a vendor to answer, so the sooner it
   is asked, the sooner it can close.
2. **Start the 30-day soak's one-time setup (§3.5).** ~60–90 minutes today, then ~10 min/week.
   This has the single longest fuse on this page — 30 **calendar** days, not owner-hours — so
   starting it a week late costs the whole product a week, no matter how fast everything else
   here goes.

⚰️ **The former item 3 (§3.8, G-062's external legal review) is CLOSED and removed from this
list.** The owner approved the FMP licensing directly on 2026-09-25 — no separate outside-counsel
review ran, the same way G-080 closed. See §3.8 for the short record.

Then, in order of clause-gain per owner-minute, cheapest and most complete first:

3. **Submit the Chrome Web Store listing (§1).** ~15–20 minutes, fully built, zero blockers
   found, closes the G-043 half of standard #1 outright.
4. **Walk the two iOS Shortcuts on a real iPhone (§3.4).** ~20–30 minutes, fully built, closes
   the one remaining half of standard #10's capture-parity clause outright.
5. **Run the screen-reader pass, NVDA first (§3.2), under the §3.7 second-review brief's five
   additions.** ~60–70 minutes for NVDA alone (this machine, no new hardware needed), plus
   ~15–20 minutes for the five additions §3.7 asks for; add a Mac pass later if VoiceOver access
   opens up. One sitting closes the last remaining clause of standard #9 **and** the §4a/§4b half
   of Phase 7 item 5 at once — do not run this pass twice.
6. **Run one real-device matrix pass (§3.3).** ~45–60 minutes for one dated row across four
   devices. Does not fully close its clause (the plan asks for "every release"), but is the
   cheapest way to turn a process obligation into something that has actually started.
7. **Arrange the second reviewer's keyboard-walk / WCAG-map pass (§3.7, §2/§3/§5 of its brief).**
   ~2–3 hours (estimate) of a reviewer's time — someone who did not build wave 8 — but the
   owner's own part is only choosing that person and handing them the brief; it can run any time
   after item 5 and blocks nothing else on this page.
8. **Schedule the 5–8 trader study (§3.1).** The biggest single time cost among the short items
   (~6–8 hours of session time, plus whatever calendar time it takes to find 5–8 traders), so it
   goes near the end — but it is not gated on anything else here, so it can run in parallel with
   the soak once scheduling allows. It closes four clauses on its own (three in standard #5, one
   in standard #16) when it lands.
9. **Run the head-to-head speed benchmark sitting (§3.6).** The other biggest single time cost
   on this page (~1 full working day, estimate) — like the trader study, it is not gated on
   anything else here, but it does need a quiet box (one sitting, one machine), so schedule it
   for whenever one is available. The automated UCT sandbox cross-check (§3.6a) is a separate,
   agent-runnable artifact and needs no owner time at all — it can be produced any time, before
   or after the sitting, without touching this item's estimate.

Nothing in this document blocks on anything else in it except where stated above (semantic
search's flags wait on §2's vendor confirmations). Items 3–9 can run in any order relative to
each other without conflict.
