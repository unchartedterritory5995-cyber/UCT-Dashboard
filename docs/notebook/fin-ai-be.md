# Notebook finish program: AI features, server side (lane AI-BE)

Branch `feat/notebook-fin-ai-be`, a follow-up cut from the landing head `213850e1fa`.
Source: section 7 of `docs/notebook/fin-walk.md` (the keyed walk against real models) on
`origin/feat/notebook-fin-walk`, tip `38179e8592`. The client half is lane AI-FE's, in
`docs/notebook/fin-ai.md`.

No model key was used and no model was called. Every test stubs the model client. The fixes
to K1, K4 and K6 are prompt and retrieval changes whose effect on a live model has NOT been
measured here. A separate lane re-walks with real keys.

| item | where it is live | verdict | what changed | pinned by |
|---|---|---|---|---|
| K1 Ask says a whole note is "cut off" | live | VERIFIED | short notes are sent whole; an excerpt is marked; the prompt forbids the claim | `tests/test_ask_whole_notes_and_excerpts.py` |
| K6 Ask calls a member's own file off topic | live | VERIFIED | the notebook prompt drops the public desk's off-topic refusal and states its own scope | same file |
| K2 weekly draft never shows the Compass quote | dark | VERIFIED | the quote is found with no account id; its absence always carries a reason and a sentence | `tests/test_review_drafts.py` |
| K5 spoken briefing cut mid-word | live | VERIFIED | every length limit is a cut on a sentence or word | `tests/test_voice_briefing_script_cuts.py` |
| K4 a new tag is refused by the planner | dark | VERIFIED as a prompt gap | the prompt says a tag need not exist yet | `tests/test_notebook_ai_actions.py` |

## K1. A short note is sent whole, and an excerpt says it is one

**Cause, from the code.** For the whole-Notebook scope, `ask_retrieval._best_note_passage`
sent every note as a window of 90 characters before and 150 after the first matching word,
whatever the note's length. The window was cut in the middle of a word at both ends. Nothing
told the model it was a window: the only "shortened" remark was set by the packet budget, not
by this cut. A four-sentence note reached the model as a torn fragment. "Ask this note" did not
do it because that scope sends whole blocks (`retrieve_note`).

**What changed.**

- `ask_retrieval.NOTE_WHOLE_MAX_CHARS = 1200`. A note whose own text fits is sent whole. Four
  such notes fit the packet's budget (`ask_ranking.MAX_PER_SOURCE_TYPE` x 1200 <= `MAX_CHARS`,
  pinned by a test).
- A longer note is still a window, now moved inward to whole words (`_excerpt_window`) and
  flagged with the one existing flag, `truncated`. That is the same flag the packet budget sets
  when it shortens an item, so the prompt has one mark and one rule.
- `ask_prompt.render_source` puts a fixed line in each source's header: `EXCERPT_MARK` for a
  partial source, `WHOLE_MARK` for a whole note. The old trailing remark about "the cut" is gone.
- A new prompt block, `_EXCERPTS`, names both marks. It says an excerpt's edge is our
  selection and not where the member stopped writing. It forbids telling the member their
  note is cut off, truncated, incomplete or unfinished, and says to state that the answer is
  working from part of the note.

**Citations.** Unchanged. The location is the matched word's own range in the note
(`snippet_start`, `snippet_end`, `from`, `to`, `fingerprint`); the snippet is only what the
model reads. `_best_note_passage` keeps its three return values for the callers that only
locate a citation. All 897 existing Ask and citation tests pass untouched, the citation parity
suite (`tests/test_note_citation_text.py`) among them.

**Also reaches** the Compass notes tool (`coach_chat_tools`), which uses the same note
retrieval: it now gets whole short notes too.

**Not done.** Document pages and saved excerpts are untouched. A document page is sent as its
own unit and was not part of the finding.

## K6. A member's own file is theirs to ask about

**Cause.** `ask_prompt.system_prompt()` included the public research desk's whole safety text
(`ai_search._SAFETY_BLOCKS`). Its first paragraph, SCOPE, orders a one-line refusal for
anything not about markets: "I'm the UCT research desk ...". One system prompt serves every
Ask scope, so a question about the member's own Word file carried that order.

**What changed.** The notebook prompt no longer includes the SCOPE paragraph or the DATA
LIMITS paragraph that refers to it. It keeps the real boundary, the "ILLEGAL / MANIPULATION"
paragraph (market manipulation, trading on inside information), taken from the desk's one copy
by its heading (`ask_prompt.desk_safety_text`; it raises if the heading is gone, so a
rewording cannot silently drop it). It adds its own `_NOTEBOOK_SCOPE`: any subject in the
member's notebook is theirs to ask about, never remark that a source is unrelated to markets,
never call yourself a research desk. The grounding rule still stops general-purpose answers
from the model's own knowledge.

The public desk's own prompt (`ai_search.py`) is not changed.

## K2. The Compass quote without an account id

**Cause.** The page asks for the draft with no account id. The router turned that into the
all-accounts id, and the draft looked for a Compass review under that id only. Compass files a
review under one account, so a member with one account had a review the draft never looked
at. With no review found, both `compassText` and `compassOmitted` were null.

**What changed** (`review_drafts._compass_for_draft`).

- With an account id: that account, as before.
- With none: the all-accounts id first (a review written in that view), then, for a member
  with exactly one account, that account. Its trades are every trade.
- With several accounts and none chosen: no review is guessed.
- The quote and its absence are never both null. `compassOmitted` always has `reason` and a
  plain `sentence`:

| reason | sentence |
|---|---|
| `no_review` | Compass has not written a review of this week, so none is quoted here. (or "of this day") |
| `windows_differ` | the existing sentence about the two windows; it gains the `reason` key and keeps `draftOnly`, `compassOnly`, `compassWindow`, `draftWindow` |
| `several_accounts` | You have several accounts and none is chosen. Compass reviews one account at a time, so no review is quoted here. Choose an account to see its review. |
| `no_monthly_review` | Compass writes daily and weekly reviews, not monthly ones, so none is quoted here. |

`review_drafts.COMPASS_OMITTED_REASONS` lists the four.

**Two things lane AI-FE needs to know.**

1. The client already renders `compassOmitted.sentence` under "What Compass said". So with this
   change every draft with no Compass review gains that heading and one sentence, the monthly
   draft included. If that is too much for the monthly draft, the client can skip the
   `no_monthly_review` reason; the server says it either way.
2. One frontend test is red on this branch and is not this lane's file:
   `app/src/pages/journal-2-0/lib/reviewDrafts.test.js`, "quotes Compass only when the payload
   carries one". Its synthetic payload lays a quote over the contract fixture and now also
   inherits the fixture's `compassOmitted`, a pair the server never sends. Setting
   `compassOmitted: null` in that overlay fixes it. 69 of that file's 70 tests pass.

**Contract fixtures** (regenerated by tool, `--check` exits 0): `review-drafts.daily`,
`.daily.empty`, `.weekly`, `.weekly.empty` change `compassOmitted` from null to the
`no_review` object; `review-drafts.monthly` and `.monthly.empty` to the `no_monthly_review`
object. Nothing else in them moved.

## K5. The spoken briefing

**Cause.** `voice_briefings_proactive.build_briefing` cut the weekly focus with
`focus[:300]`. The same slice was on the regime line (300), the news (600 stored, 300 spoken)
and the catalyst headline (120).

**What changed.** `clip_spoken(text, limit)`: the last whole sentence inside the limit when
that keeps at least 40% of the limit, otherwise the last whole word with a full stop added so
the next spoken part starts a new sentence. Text that fits is returned as written. All five
cuts use it (the headline without the added full stop). An AST test fails if a bare character
slice of text returns to the module.

`voice_session_context._load_weekly_focus` still slices at 500. That text goes to a model as
context, not to speech, and the briefing clips it again at 300 on a boundary. Left alone.

## K4. A new tag

**Verified.** The server has no allowed-tag list: the `add_tag` branch of the plan validator
runs the Notebook's own tag validation and nothing else. The prompt showed the member's
existing tags and had one rule, "for a choice, one of its listed options", that named no type.

**What changed.** Two fixed sentences in `ai_actions`: `TAG_RULE` (a tag does not have to
exist; the list is the tags in use, not a list of allowed tags; a new tag is created when the
change is applied; never refuse because it is new) and `OPTIONS_RULE` (the listed-options
limit is for `select` and `multi_select` properties only, never tags).

**Not done here.** The empty plan still showing an "Apply 0 changes" button is the client's.

## Tests and proofs

No model call anywhere. Mutations were made by writing bytes and restored the same way.

| item | new tests | mutations, all red |
|---|---|---|
| K1 and K6 | 17 | 10 |
| K2 | 8 (one older test restated: it asserted the two nulls) | 5 |
| K5 | 54 (45 of them one parametrised length sweep) | 4 |
| K4 | 4 | 2 |

K1 and K6 share one commit: they meet in one line, the system prompt's composition.

## Not covered

- The effect of the K1, K4 and K6 prompt changes on a real model. That is the re-walk's job.
- Nothing was run in a browser.
- The image-with-text Ask row stayed NOT RUN in the walk (no OCR engine on that machine); it
  was not looked at here.

## On the combined branch `feat/notebook-fin-ai`

The server lane and the client lane (`origin/feat/notebook-fin-ai-fe`, `7d6b557d0e`) were
merged with no conflict. The tree is master (`2265f4ac3b`) plus exactly the two lanes' files,
compared by numstat (16 + 38, none shared).

- **Owner ruling on K2.** A monthly draft must not gain a "What Compass said" heading merely
  because Compass writes no monthly review. The client shows the server's sentence for
  `no_review`, `windows_differ` and `several_accounts`, and shows nothing for
  `no_monthly_review`. A reason it has never heard of is still shown. The server answer is
  unchanged: it says the reason either way.
- **The red frontend test is fixed.** Its overlay that adds a quote now sets
  `compassOmitted: null` beside it.

Runs on the combined branch: backend 22 named files, 1044 passed; the whole `a11y/` directory,
44 files, 392 passed and 1 skipped; `styles/tapFloor.test.js` with the Ask, citation, AI
actions, Research Home, review draft and voice note tests, 54 files, 1093 passed; the frontend
build; the byte gate (2,233,193 B against a budget of 2,260,793 B, PASS); the contract fixture
check (exit 0); the hygiene check (clean).

## After the keyed re-walk: the long note (section 8.2 of the walk record)

**Found.** On `dda0515427`, 5 of 5: "What have I written about PLTR: the entry, the stop, the
risks, and my final rule for the trade?" over one 1,878-character note answered "I couldn't
find that in your Notebook." with no citation.

**Verified cause** (captured by a test before any change). The model was never asked. For a
note too long to send whole, the one passage sent was a window around the FIRST question word
found in the note. Here that was the ticker in the first sentence, so the passage was the
note's first two lines (151 characters). It held none of the question's own words, so
`ask_retrieval._answers_the_question` marked the note "context about the security, not an
answer", `no_answer` was true, and the server gave its fixed refusal. The walker's reading
(one short passage reaches the model) was half right: nothing reached a model at all.

**What changed** (`f7ee46114d`).

- `ask_retrieval.whole_note_budget(n)`: how long a note may be and still go whole depends on
  how many notes matched. One note: up to 4000 characters (`NOTE_WHOLE_SOLO_MAX_CHARS`) of the
  6000-character packet. Two: 3000 each. Five or more: the base 1200.
- A note still too long is an excerpt of several passages (`_spanning_excerpt`): a window
  around the cited word, then around each other word of the question the note holds, round by
  round, up to three places a word, within the same budget. Passages that overlap are joined;
  passages apart are shown with ` … `. A plural in the question finds the singular in the note
  ("risks", "risk").
- The citation locator (`_best_note_passage`) still reads one occurrence when the first is
  usable. The extra passages are gathered only when the text goes to a model.
- The prompt tells the model never to name its own labels to the member. The re-walk saw "the
  SEARCHED line indicates ..." once.

**Keyed check, 3 of 3.** The exact question, the walk's note and its two CRWD notes, the
product's own Ask path in one process (no server boot, so no background writer; and
`STOCK_BRIEF_ENABLED=0`), keys only through the helper, a throwaway data directory, 0
shared-root violations. Each run: one source, the whole note (1,894 characters sent, not an
excerpt), cited `[1]`, no invalid citation. Each answer gave the entry 26.35, the stop 24.85,
both risks (government budget timing; stock based compensation) and the final rule (no adds
until the stock closes above 28 for two days in a row). Two more runs, one each:

- A question with two parts the note lacks (dividend yield, chief financial officer): the entry
  was answered and cited, and both missing parts were said to be absent. Nothing invented.
- The two short CRWD notes: both sent whole, both cited, no claim that a note is cut off.

Five model calls in all.

**Spoken briefing** (`2cd95d029a`). `speakable` removes Markdown marks before the weekly focus
is spoken ("- **Label every setup before you enter.**" is now read as the sentence).

**Not done.**

- The briefing saying "Two asks for next week" and then giving one. The focus is cut at 300
  characters for speech, on a sentence end, so a second ask can fall off. Fixing it means
  choosing a longer spoken focus, and `voice_session_context._load_weekly_focus` cuts the text
  at 500 characters with a plain slice before the briefing sees it. Left for a ruling.
- The two-chips-side-by-side case of K7 is the client's.
- Seen in the keyed answers and left alone: two of five answers ended with a remark about how
  many notes were searched ("the search covered 3 notes ..."). It is true and uses no internal
  label.
