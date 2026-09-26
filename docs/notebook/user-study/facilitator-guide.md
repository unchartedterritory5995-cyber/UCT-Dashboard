# UCT Notebook study — the facilitator's guide

Part of the study kit (`../user-study-kit.md`, which holds the task table §4, the eligibility
pre-flight §5, SUS §6, the results §7 and the decision rule §8). This file is what the
facilitator does, in order.

## Before the session

1. **Provision a fresh account for this participant** — never reuse one.
   - ⚠️ The site is coming-soon, so self sign-up is refused (`api/routers/auth.py`, `signup`:
     403 "Accounts aren't open yet"), and no admin endpoint creates a user. The owner (or the
     controller, on the owner's approval) creates the account pod-side with the app's own
     `create_user` — the procedure CLAUDE.md records for the smoke account: a `VACUUM INTO`
     backup of `auth.db` first, then a set-difference check that exactly one user was added.
     ⛔ Never flip `COMING_SOON_MODE` to let a participant sign up — refused permanently
     (CLAUDE.md "DOOR B").
   - Then, in the admin UI: **comp access** and **verify email** — the same pair the perf
     harness uses (`tools/notebook_perf_harness.py`, `_provision`: `POST
     /api/auth/admin/comp-access` then `POST /api/auth/admin/verify-email`). Signed in as the
     participant, `/api/auth/me` must read `paid_equiv: true`, or every Notebook route redirects.
   - Use a made-up address you control for the account (for example on your own domain), never
     the participant's personal one, and record only its P number in the results.
     ⛔ Never an `@uctintelligence.internal` address: that domain is how the soak recognises
     OUR accounts, so a participant there would be counted as an unknown internal account,
     not as a trader (`api/services/journal_two/notebook_populations.py`).
2. **Run the pre-flight** (kit §5) signed in to the new account, and write which tasks are
   eligible today on the observation sheet. A core task (T1, T2, T4, T6, T8) that is not
   eligible means rescheduling, not scoring around it.
3. **The notebook stays EMPTY until T1 is done.** Have the study notebook folder ready to
   import (`study-notebook/`, as a folder) — you import it AFTER T1 (below).
   ⛔ Not the wave-8 sample notebook (ruling D-9C8).
4. **Materials:** one public article URL with a quotable paragraph (T2); one public 10-Q PDF on
   the participant's computer or ready to send in the call chat (T6).
5. **Phone:** the participant's phone, signed in to the test account (T9). Confirm before the
   call; send them the sign-in details privately.
6. **A second browser of your own**, signed in to the same test account — for the T8 and T9
   silent-failure checks and for the import after T1.
7. **Recording on**, with the consent reply on file (`consent.md`). Screen and voice only.

## During the session

**Intro (3 min), read aloud:**
> Thanks for doing this. I'm going to ask you to do a few everyday things in the UCT Notebook
> while you think out loud: what you expect, what you're looking for, what surprises you.
> We're testing the product, not you, so if something's confusing that's exactly what we
> need to hear. I won't help unless you're stuck for a while. You can stop any time, and you
> keep the thank-you either way. Is it still OK to record your screen?

**Warm-up (2 min):** "What do you use for trading notes today? What do you like and hate about it?"

**Tasks (30 min):** kit §4, in order. Read each prompt **word for word**, then stay quiet.

- ⏱ **T1's clock starts when you finish reading the prompt.** The screen recording's timestamps
  are the record; write the seconds on the sheet afterwards from the recording, not from memory.
  Record whether the wave-8 tour appeared.
- **After T1, before T2:** in your own browser, import the study notebook into the account
  (Notebook → **Import** → **Choose a folder** → pick `study-notebook/`, so its folders come
  along; "Choose files" would flatten them). If the importer offers to add
  live charts for tickers it found, choose **not now** — the offer is opt-in and the study does
  not need it. Then ask the participant to reload.
- **The hint rule:** give a hint **only after 60 seconds of being stuck**, and mark the task **H**.
  Stuck means no progress, not thinking out loud.
- **After the participant says "done" on each task, run that task's silent-failure check
  yourself** (table below). It is an ACTION you perform and observe — never a question to the
  participant. A check that fails while the participant believed they were done is a
  **silent failure**: record it, count it, and do not correct the participant.

| Task | The silent-failure check (after "done") |
|---|---|
| T1 | Ask the participant to **reload** the page: the note is there, with their words in it. |
| T2 | **Click the source link** in the saved passage: the article opens. |
| T3 | **Reload**: the heading, the three-item checklist and the highlight are all present. |
| T4 | **Read the open note's title**: it is ‘Earnings season playbook’, not a different note. |
| T5 | **Reload, open the new folder**: all three notes are in it, and each shows the tag `earnings`. |
| T6 | **Click the excerpt's citation**: the PDF opens at the cited page, and that page carries the revenue line. |
| T7 | **Click one citation** in the inserted answer: it opens its source note at the cited passage. |
| T8 | In **your second browser**, after the participant has reconnected, open the same note: the sentence is there. |
| T9 | **Reload both devices**: the new line shows on the phone and on the computer. |
| T10 | Export: **open the downloaded file** and find the note's words. Link: **open the link in a private window** (signed out) and read the note. |

**The observation sheet — one row per task:**

| Task | U / H / F / NT | Time | Any error message (exact words) | Silent-failure check: pass / FAIL | One quote |
|---|---|---|---|---|---|
| T1 | | s (tour on? yes / no) | | | |
| T2 | | | | | |
| T3 | | | | | |
| T4 | | | | | |
| T5 | | | | | |
| T6 | | | | | |
| T7 | | | | | |
| T8 | | | | | |
| T9 | | | | | |
| T10 | | | | | |

**SUS (5 min):** kit §6, on paper or a form, filled in by the participant straight after the
last task. Do not help them interpret the items.

**Debrief (5 min):**
1. "What was the most useful thing you saw?"
2. "Where did you feel least sure what would happen?"
3. "If you moved your trading notes here tomorrow, what would you miss from your current tool?"
4. "Is there anything you'd need before you'd trust it with your real notes?"

## After the session

1. **Results row:** one row in `results-template.csv` for this P number — tool today, session
   date, T1 seconds (from the recording), each task's U / H / F / NT, the number of silent
   failures, and the ten SUS answers. Leave nothing blank: a blank is INCOMPLETE, never guessed.
   Then run `python tools/notebook_study_score.py docs/notebook/user-study/results-template.csv`.
2. **The observation sheet** is stored with the P number only; quotes and notes live there, not
   in the CSV.
3. **The recording:** note its deletion date (30 days) on the sheet, and delete it on that date.
4. **The account:** close it, or keep it if the participant asked (consent form). If they agreed
   to the 30-day usage counts and keep the account, tell the owner so the soak's cohort list
   includes them (`../soak-30day.md`, P9).
5. **Thank-you** the same day (`screener.md` §5).
