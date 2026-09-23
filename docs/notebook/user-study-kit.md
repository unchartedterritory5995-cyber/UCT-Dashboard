# Notebook user study — the kit (Phase 7, standard #5)

Everything needed to run the study except the traders. The owner recruits, runs up to eight
45-minute calls, and pastes the scores into §7. The plan's bar
(`NOTEBOOK-10-OF-10-PLAN.md` §1, #5 and #16):

- **5–8 traders**, every core task completed **unaided**;
- **SUS ≥ 80** (mean);
- a new member reaches a first useful note in **under 2 minutes**;
- **no silent failures**: anything that failed without telling the person counts, even if
  they did not notice.

**When:** after waves 5–8 have shipped. Tasks marked *(wave N)* need that wave in production.
Running earlier measures a product that is about to change.

## 1. Recruitment — paste into the community Discord

```
Looking for 6 traders for a 45-minute call about the UCT Notebook (the research notebook inside UCT Intelligence).

You'd use it on your own screen while thinking out loud: write a note, save something from an article, find an old note, ask it a question. No prep, no right answers. We're testing the product, not you.

Who: anyone who keeps trading notes today, in Notion, Evernote, Obsidian, OneNote, a doc or on paper. A mix of those is exactly what we want.
When: [dates]. Pick a slot here: [link]
Thank-you: [incentive]

Reply here or DM me.
```

Aim for a mix of at least two current Notion users, one Obsidian user, one Evernote user and
one paper/doc person. **Exclude** anyone who has helped build or test the product.

## 2. Before each session

- The participant needs a **paid account**. The site is in coming-soon mode, so create or comp
  it from the admin page (`POST /api/auth/admin/comp-access`, the same path the admin UI uses).
- Start them with an **empty Notebook** plus the sample notebook, if wave 8's sample has
  shipped. Do not reuse an account between participants.
- Have ready: one public article URL with a quotable paragraph, and one public 10-Q PDF (any
  company).
- Tasks 7–8 need the participant's phone with the site open.
- Ask permission to record the screen. Recordings are kept **30 days**, then deleted.
  Participants are named P1–P8 in every note and never by name.

## 3. The script (45 minutes)

**Intro (3 min), read aloud:**
> Thanks for doing this. I'm going to ask you to do a few everyday things in the UCT Notebook
> while you think out loud: what you expect, what you're looking for, what surprises you.
> We're testing the product, not you, so if something's confusing that's exactly what we
> need to hear. I won't help unless you're stuck for a while. You can stop any time. OK to
> record your screen?

**Warm-up (2 min):** "What do you use for trading notes today? What do you like and hate about it?"

**Tasks (30 min):** §4, in order. Read each prompt word for word, then stay quiet. Give a hint
only after 60 seconds of being stuck, and mark the task **with hint** if you do.

**SUS (5 min):** §5, filled in by the participant straight after the last task.

**Debrief (5 min):** §6.

## 4. Tasks

| # | Prompt (read aloud) | Success | Standard |
|---|---|---|---|
| 1 | "Start a note with your plan for tomorrow's session." | Note created with their own words in it. **Time it from the prompt: the bar is under 2 min.** | #16 onboarding |
| 2 | "Here's an article. Save this paragraph into that note, keeping where it came from." | Passage in the note with its source link (in-app capture, or the browser extension if published) | #1 features, #10 capture |
| 3 | "Add a heading, a checklist of three items, and a highlighted sentence." *(wave 5: highlight)* | All three present | #2 functionality |
| 4 | "Find the note called '[a sample-notebook title]' without scrolling the list." *(wave 5: quick switcher over all notes)* | Found with the switcher or search | #13 search |
| 5 | "Put these three notes in a new folder and tag them 'earnings'." *(wave 5: bulk operations)* | Done in one pass, not note by note | #1 features |
| 6 | "Attach this 10-Q and pull the revenue line into your note with its page." | Excerpt in the note, citing the page | #12 evidence |
| 7 | "Ask your notebook what you wrote about [ticker], and put the answer in your note." *(G-064, needs the #183 deploy)* | Answer inserted with citations that open the source | #12 AI |
| 8 | "Turn off your Wi-Fi, add a sentence, then turn it back on." | The sentence survives, and they **say** they trusted it would | #3 reliability, #10 offline |
| 9 | "On your phone, open the same note and add one line." | Line appears on both devices | #10 cross-device |
| 10 | "Get a copy of this note out, as a file or a link someone else can read." *(wave 8: share links)* | Markdown export downloaded, or a share link that opens signed out | #11 interop |

**Record for every task:** completed **unaided / with hint / failed** · time · any error
message · **any silent failure** (it looked done but wasn't) · one quote.

## 5. SUS — System Usability Scale (Brooke, 1986)

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
the bar.** About 68 is industry average; 80+ is roughly the top 10%.

## 6. Debrief questions

1. "What was the most useful thing you saw?"
2. "Where did you feel least sure what would happen?"
3. "If you moved your trading notes here tomorrow, what would you miss from your current tool?"
4. "Is there anything you'd need before you'd trust it with your real notes?"

## 7. Results (fill in)

| P | Tool today | T1 time | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | Silent failures | SUS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | | | | | | | | | | | | | | |
| P2 | | | | | | | | | | | | | | |
| P3 | | | | | | | | | | | | | | |
| P4 | | | | | | | | | | | | | | |
| P5 | | | | | | | | | | | | | | |
| P6 | | | | | | | | | | | | | | |

Mark each task **U** (unaided), **H** (with hint) or **F** (failed).

**Decision rule:**
- The standard passes when the mean SUS is at least 80, **every** task is U for at least 80% of
  participants, T1 is under 2 minutes for everyone, and there are **zero** silent failures.
- Anything short of that becomes a fix list: one line per task that missed, citing the P
  numbers and quotes.
- Re-test only the tasks that missed, with new participants.
