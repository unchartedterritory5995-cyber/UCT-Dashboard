# Notebook user study — the kit (Phase 7, standard #5)

Everything needed to run the study except the traders. This file is the kit's INDEX and holds
the parts every other file points at: the tasks, who can do each one on the day, SUS, the
results sheet and the decision rule. The owner recruits, runs up to eight 45-minute calls and
fills the results. The plan's bar (`NOTEBOOK-10-OF-10-PLAN.md` §1, #5 and #16):

- **5–8 traders**, every **core task** completed **unaided** by every participant;
- **SUS ≥ 80** (the point mean, with its 90% confidence interval printed beside it);
- a new member reaches a first useful note in **under 2 minutes**;
- **no silent failures**: anything that failed without telling the person counts, even if
  they did not notice.

**When:** after waves 5–8 have shipped. A task that needs something not yet live is recorded
**NT (not tested)** — never F — and §5 says which. Running earlier measures a product that is
about to change.

**The kit, file by file:**

| file | what it is |
|---|---|
| `user-study/screener.md` | the recruit post, screener questions, exclusion rule, scheduling, reminder, thank-you, no-shows |
| `user-study/consent.md` | the consent form — **DRAFT, owner approval required** |
| `user-study/facilitator-guide.md` | before / during / after, the script, the hint rule, the per-task silent-failure check, the observation sheet |
| `user-study/study-notebook/` | the committed note set the facilitator imports AFTER T1 (ruling D-9C8) |
| `user-study/results-template.csv` | one row per participant, machine-readable |
| `tools/notebook_study_score.py` | SUS per participant, mean + 90% CI, and the verdict PASS / FIX-LIST / INCOMPLETE |

## 1. Recruitment

Recruit **6–8 traders**, so that at least five complete a session. The post, the screener and
the scheduling are `user-study/screener.md`. Aim for at least two current Notion users, one
Obsidian user, one Evernote user and one paper/doc person. **Exclude** anyone who has helped
build or test the product.

## 2. Before each session

- The participant gets a **fresh, comped account** of their own, provisioned by the owner in the
  admin UI (comp access + verify email). Never reuse an account between participants.
  ⛔ The site stays coming-soon: flipping `COMING_SOON_MODE` to let someone sign up is refused
  permanently (CLAUDE.md "DOOR B").
- **T1 always runs on the EMPTY account.** After T1, the facilitator imports the **study notebook**
  (`user-study/study-notebook/`) through the product's own importer — not the wave-8 sample
  notebook, which sits behind `NOTEBOOK_ONBOARDING_ENABLED` and refuses any account that already
  holds a note (ruling D-9C8). The study notebook carries the exact titles T4, T5 and T7 name.
- Run the **pre-flight** in §5 and write down which tasks are eligible today.
- Have ready: one public article URL with a quotable paragraph, and one public 10-Q PDF (any
  company).
- Task 9 needs the participant's phone, signed in to the site.
- Recording: screen and voice, with the signed consent (`user-study/consent.md`). Recordings are
  kept **30 days**, then deleted. Participants are named **P1–P8** in every note and never by name.

The step-by-step is `user-study/facilitator-guide.md`.

## 3. The session (45 minutes)

Intro (3 min) · warm-up (2 min) · tasks (30 min, §4, in order) · SUS (5 min, §6) · debrief
(5 min). The words to read, the 60-second hint rule and the observation sheet are in
`user-study/facilitator-guide.md`.

## 4. Tasks

**Core tasks (ruling D-9C6): T1, T2, T4, T6, T8.** Every participant must complete each core task
**unaided**. A title in ‘single quotes’ is a note the study notebook carries.

| # | Core | Prompt (read aloud) | Success | Standard |
|---|---|---|---|---|
| 1 | core | "Start a note with your plan for tomorrow's session." | Note created with their own words in it. **Timed from the END of the prompt; the bar is under 2 min.** Runs on the empty account. | #16 onboarding |
| 2 | core | "Here's an article. Save this paragraph into that note, keeping where it came from." | Passage in the note with its source link (in-app, or the browser extension if published) | #1 features, #10 capture |
| 3 | | "Add a heading, a checklist of three items, and a highlighted sentence." *(wave 5: highlight)* | All three present | #2 functionality |
| 4 | core | "Find the note called ‘Earnings season playbook’ without scrolling the list." *(wave 5: quick switcher over all notes)* | Found with the switcher or search | #13 search |
| 5 | | "Put ‘Chipmaker guidance notes’, ‘Software margin notes’ and ‘Retailer inventory notes’ in a new folder and tag them 'earnings'." *(wave 5: bulk operations)* | Done in one pass, not note by note | #1 features |
| 6 | core | "Attach this 10-Q and pull the revenue line into your note with its page." | Excerpt in the note, citing the page | #12 evidence |
| 7 | | "Ask your notebook what you wrote about CRWD, and put the answer in your note." *(G-064)* | Answer inserted with citations that open the source | #12 AI |
| 8 | core | "Turn off your Wi-Fi, add a sentence, then turn it back on." | The sentence survives, and they **say** they trusted it would | #3 reliability, #10 offline |
| 9 | | "On your phone, open the same note and add one line." | Line appears on both devices | #10 cross-device |
| 10 | | "Get a copy of this note out, as a file or a link someone else can read." | Markdown export downloaded, or a share link that opens signed out | #11 interop |

**Record for every task:** **U** unaided / **H** with hint / **F** failed / **NT** not tested
(not eligible today — §5) · time · any error message · the **silent-failure check** result
(the facilitator's own observable check after the participant says "done" —
`user-study/facilitator-guide.md`) · one quote.

## 5. Task eligibility — the pre-flight, before every session

A task that is not eligible is recorded **NT**, never F. A **core** task that is NT for anyone
makes the whole study **INCOMPLETE** (the scorer says so) — fix the precondition and re-run that
session rather than scoring around it.

Flag keys are read as the participant's own account from **`GET /api/auth/me`** (signed in, in
the browser: open the URL). Each `notebook_*` key is the lower-case name of its Railway variable,
derived per request (`_notebook_flag_key` in `api/routers/auth.py`) — so the payload is the
running process's answer, not the flag ledger's.

| Task | What it needs (wave, flag) | The facilitator's pre-flight check | If it is not met |
|---|---|---|---|
| T1 | Nothing gated. Records whether the wave-8 tour was on: `NOTEBOOK_ONBOARDING_ENABLED`, key `notebook_onboarding_enabled` — **PLANNED (wave 8), unset = off**; not in this kit's base | Note on the sheet whether `notebook_onboarding_enabled` is present and `true` on `/api/auth/me` (absent = the tour does not exist yet) | Always eligible. The tour state is recorded, not required |
| T2 | Nothing gated (paste with the link, or the published browser extension) | Open the article URL; confirm it loads. Note whether the extension is published (Chrome Web Store listing) | Always eligible; the extension is optional |
| T3 | Wave 5 (highlight) | In a scratch note, type `/` and confirm Highlight is offered | NT |
| T4 | Wave 5 (quick switcher over all notes); the study notebook imported | Ctrl+K (⌘K) finds ‘Earnings season playbook’ in the scratch account before the call | NT (core ⇒ the session is INCOMPLETE) |
| T5 | Wave 5 (bulk select, move, tag); the study notebook imported | The list offers multi-select with Move and Tag | NT |
| T6 | Nothing gated (PDF attachment and page-cited excerpt); a paid account | Attach the prepared 10-Q to a scratch note and confirm the preview opens | NT (core ⇒ INCOMPLETE) |
| T7 | G-064 insert: `NOTEBOOK_ASK_INSERT_ON`, key `notebook_ask_insert_on` (unset = OFF, `api/routers/auth.py`); a paid account; the study notebook's CRWD note | `/api/auth/me` shows `notebook_ask_insert_on: true`, and Ask answers a test question in a scratch account | NT |
| T8 | The offline layer: kill switch `NOTEBOOK_OFFLINE_DEFAULT_ON`, key `notebook_offline_default_on` (unset = ON) | `/api/auth/me` shows `notebook_offline_default_on: true` | NT (core ⇒ INCOMPLETE) |
| T9 | The participant's phone, signed in (iOS 16 or newer — the declared floor) | The participant opens the site on the phone before the call and signs in | NT |
| T10 | Export path: nothing gated. Link path: `J2_SHARE_LINKS_ENABLED`, held at 0 until the owner's legal sign-off (ruling D-B9) — not on the auth payload | Export: the note menu offers Markdown export. Link: the flag ledger's `J2_SHARE_LINKS_ENABLED.owner_decision` records a sign-off — otherwise the link path is NT and the export path alone decides T10 | Eligible through export; the link path is NT until sign-off |

⚠️ The wave-8 rows (the tour, share links, and any publish door) are **PLANNED** in
`wave8-dispatch-plan.md` and were not read in this kit's base; re-check the key names on
`/api/auth/me` when wave 8 is live.

## 6. SUS — System Usability Scale (Brooke, 1986)

Each item is scored 1 (strongly disagree) to 5 (strongly agree):

1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need the support of a technical person to be able to use this system.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I needed to learn a lot of things before I could get going with this system.

**Scoring:** odd items give (answer − 1); even items give (5 − answer). Add all ten and
multiply by 2.5, for a score from 0 to 100. Score each person, then average. **80 or higher is
the bar** (the point mean). About 68 is industry average; 80+ is roughly the top 10%.
`tools/notebook_study_score.py` does this arithmetic from the CSV and prints the 90% CI beside
the mean; it never fills a blank answer.

## 7. Results (fill in `user-study/results-template.csv`; this table is the paper copy)

| P | Tool today | Session date | Tour on (T1) | T1 seconds | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | Silent failures | SUS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | | | | | | | | | | | | | | | | |
| P2 | | | | | | | | | | | | | | | | |
| P3 | | | | | | | | | | | | | | | | |
| P4 | | | | | | | | | | | | | | | | |
| P5 | | | | | | | | | | | | | | | | |
| P6 | | | | | | | | | | | | | | | | |
| P7 | | | | | | | | | | | | | | | | |
| P8 | | | | | | | | | | | | | | | | |

Mark each task **U** (unaided), **H** (with hint), **F** (failed) or **NT** (not tested).

## 8. Decision rule (ruling D-9C6)

- **PASS** when all of these hold:
  - **every core task — T1, T2, T4, T6 and T8 — is U for every participant**;
  - every other task (T3, T5, T7, T9, T10) is U for at least 80% of the participants it was
    eligible for (an NT is left out of that task's denominator, never counted as a miss);
  - the **mean SUS is at least 80** — the point mean, with its 90% CI printed beside it;
  - **T1 is under 2 minutes for everyone**;
  - there are **zero** silent failures.
- **INCOMPLETE** when fewer than five participants completed a session, any cell is missing or
  out of range, or any core task is NT for anyone.
- Anything else is a **FIX-LIST**: one line per miss, naming the P numbers (quotes and notes
  come from the observation sheets).
- Re-test only the tasks that missed, with new participants.

`python tools/notebook_study_score.py docs/notebook/user-study/results-template.csv` prints
the verdict; it is the arithmetic of this rule and nothing more.
