# VOICE.md — how Study talks

**Status:** Phase 0 draft for owner sign-off (2026-10-17).
**Source of truth for the voice:** the owner's own writing and speech. This file is derived from
`morning-wire/data/voice/voice_profile.json` (mined from 88 Substack posts: 27 articles, 61 Sunday
Scans) and its 120 exemplars, plus the toolkit cards, the methodology bible and the playbooks. Desk
transcripts and Substack issues on the server extend it later; nothing here is invented.

Owner's instruction, verbatim: *"avoid stupid AI shit like regime, dial, tape etc all that crap, make
it sound like us and a person and friend and mentor is teaching vs just AI slop"* and *"make sure it
doesn't sound too AI but is also structured and easy to understand."*

---

## 1. The measured voice (from the profile)

| Measure | Owner's writing | Rule for Study copy |
|---|---|---|
| Sentence length | median 12 words, mean 13, 90th percentile 23 | Questions and lessons: **12 words typical, 22 max** (the importer rejects longer sentences in questions). |
| Fragments | 11% of sentences | Fragments are allowed and welcome. "Tight inside day Friday." "Simple as that." |
| First person | 27 per 1,000 words | Reveals speak as **I / we**: "Here is what I'd do." Never "traders should". |
| Second person | 10 per 1,000 words | Talk to the member as **you**, directly. |
| Em-dashes | 0.23 per 1,000 words | **Do not use them.** A comma, a period, or keep talking. |
| Exclamation marks | 4% of sentences | Rare. At most one per unit, never in a question. |
| Questions in prose | 1.4% | Lessons state; they do not ask rhetorical questions. |
| ALL-CAPS words | 2.8% | One emphasised word is in the voice: "Trade SHARES." "STUDY." Never a whole sentence. |

## 2. Phrases in the owner's register (use naturally, never force)

want to see · area to risk against · risk against · get involved · higher low · inside day ·
right now · last week · next week · near term · follow through · relative strength · moving
averages · gap down / gap up · post earnings · earnings season · early in the week · the group ·
the best names · tight · a bit · a few · sit on hands · narrow your list · study charts ·
sell partials into strength · trail the rising moving average · respect the tape.

Words the owner uses for the firm's own things (allowed once taught, see §5): the dial, the band,
heat, the tape, the loop, the catalog, A list / B list, the Wire, Sunday Scans.

## 3. Ten do / don't pairs (the "do" column is the owner's own sentence or the firm's card)

| Do (real) | Don't (AI slop) |
|---|---|
| "The stop is an appointment, not a debate." | "It's important to always respect your stop-loss levels in order to manage risk effectively." |
| "Stop first, distance second, size last. You never pick a size and back-fit a stop inside the noise." | "Position sizing is a crucial component of a robust risk management framework." |
| "A tight stop never licenses a monster position. A stop cannot catch an overnight gap." | "Be aware that gaps may potentially cause slippage beyond your intended stop." |
| "Build your list. Define your setups and stops. Determine your sizing. Trade SHARES." | "Developing a comprehensive trading plan is essential for long-term success." |
| "I almost never take a loss greater than 3%." | "Experienced traders typically aim to limit downside exposure." |
| "Those who can control their drawdown best are best. Simple as that." | "Drawdown management is a key differentiator among successful market participants." |
| "Staying focused on things HERE vs as they are up 6 days in a row is how you get positioned in big legs." | "Patience and discipline can help identify high-probability entry opportunities." |
| "If the daily gives a subtle higher low and checkback of the $420 zone early in the week I think you want to try that." | "A pullback to support may present a potential buying opportunity." |
| "Buying the flagpole instead of waiting for the flag." (a named mistake) | "One common pitfall traders may encounter is entering too early." |
| "Invalidation first, size second. When the two can't agree, the answer is no trade." | "Great job! Let's dive into the next concept." |

## 4. Shapes for each kind of text

**A question.** One idea. The question before the chart. ≤ 2 lines on a phone (≈140 characters).
Plain words. No preamble ("In this scenario, consider…"). Example: *"This stock just gapped up 14%
on earnings and closed near the high. Where is the stop?"*

**Choices.** Short enough to scan (≤ 40 characters; ≤ 12 when four fit in a 2×2 grid). Distractors
are **named mistakes** from the playbooks and the 17-tag taxonomy ("widened the stop", "bought the
flagpole", "added to a loser"), never paraphrases of the right answer.

**A reveal.** Verdict first, then why, then the lesson line. Shape:
1. Verdict in the owner's words: "Skip it." / "Take it, half size." / "That's the stop."
2. One or two sentences of why, with the one number that matters, from the item's facts only.
3. The lesson line (≤ 22 words), first person where it helps: "I'd rather miss it than chase it."
4. Then provenance and what happened next (structured, not prose).

**A walk-through (Learn rung 1).** The mentor narrates the chart in 2-4 short sentences and the
member taps Next. Present tense. "Here's the base. Three pullbacks, each one smaller. Volume dries
up on the last one. That's the tell."

**A vocabulary definition.** One sentence that a friend would say across the desk, then one
example sentence **quoted from the owner's own writing** with its date. Example: *Higher low: a
pullback that bottoms above the last pullback's bottom. "Now trying to flag briefly and give a
higher low." (Sunday Scans, 2026-07-12)*

**An intro script (30-60 s).** Opens on the thing itself, not on a welcome. "This is $271 to $146
in 12 sessions." Says what you'll be able to do after the unit. Ends on one line you can repeat.

## 5. House words: taught first, then used freely

The reviewers were right that the firm's own voice *is* its shorthand. So the ban is on **untaught**
shorthand, not on the words. F1's first unit, **"How we talk at the desk"**, teaches the 15-20 house
words from the glossary in the first hour (the dial, the band, heat, the tape, the loop, the
catalog, A list, B list, RS, higher low, inside day, VCP, EP, pivot, area to risk against). After a
member has passed that unit, questions may use them. Before it, questions use plain words: "the
firm's market-health score, the 0-150 number on the dashboard".

## 6. Banned (the importer rejects a question or lesson containing these)

- Phrases: "may potentially", "it's important to", "in order to", "leverage", "utilize", "navigate
  your journey", "journey", "robust", "seamless", "dive in", "dive into", "great job", "let's
  explore", "in this scenario", "as a trader, you", "it is worth noting", "key takeaway",
  "comprehensive", "crucial", "essential component", "framework".
- Em-dashes. Emoji. Exclamation marks in questions. Three-adjective lists. Rhetorical questions in
  lessons. Any sentence over 22 words in a question. "Traders should" / "successful traders".
- Any number that is not in the item's facts (`answer_json` / `reveal_json`).

## 7. Required

- One idea per question. The same sentence shapes through a unit.
- The verdict before the reason in every reveal.
- First person for judgment ("I'd skip it"), second person for instruction ("mark your stop first").
- Real tickers and real dates in every reveal.
- Losses described plainly: "Stopped out for 2.6%. That's the cost of being there for the ones that work."

## 7b. Owner rulings on the words (2026-10-17, bank review batch 1)

- "tape", "regime", "dial" and the rest of §2's house words are **not banned**. The owner: they
  are avoided in prose written by AI because there they read as computer-generated rather than
  authentic. A verbatim quote from the owner's own writing keeps them. Study's own templated copy
  avoids them until the F1 unit has taught them (§5).
- Glossary items keep both directions: "what does X mean" (four whole definitions as the choices,
  listed vertically) and "which term is this" (the definition shown, four terms as the choices).

## 8. Open for the owner

- Confirm the house-word list for F1's first unit (§5).
- Any words you want added to the banned list, or phrases you want required.
- Whether reveals may ever use "we" for the firm ("we trimmed into strength") or always "I".

## 9. What the importer enforces today (lane G, 2026-10-17; append-only record)

`api/services/study_import.py` is the code behind §6. On every `POST /api/study/import` an item
is checked and, when it fails, stored as a **draft with `import_flags`** and listed in the
response (never dropped). The checks, exactly as implemented:

- **Grounding.** Every number in `lesson_text` and in the reveal's prose keys (`verdict`, `why`,
  `lesson_line`, `note`) must appear in `answer_json` or `reveal_json` facts, with the K / M / %
  variants the COT narrative gate allows. The item's own `asof` date and `sym` are allowed.
  Numbers in the question are not facts: a lesson that restates them must carry them in the reveal.
- **Voice, question text** (`prompt_json.q` only; quoted source text under it is not checked):
  the §6 banned phrases, em-dashes, emoji, "traders should" / "successful traders", exclamation
  marks, any sentence over 22 words.
- **Voice, lesson text** (`lesson_text` + the reveal prose keys): the same list plus rhetorical
  questions. A verbatim source sentence is used as the lesson only when it passes as written;
  it is never rewritten.
- **Near-duplicate.** Same skill, token Jaccard ≥ 0.85 over question + quote + choices. Two
  questions that differ in a number, in the chart they show (`asof` + ticker), or in a declared
  `prompt_json.subject` (a candle name, a glossary term, a rule number) are two items.
- **Review lane.** `size` items and verbatim-keyed recall items (a `reveal_json.quote` from a
  glossary / principle / bible / concept / playbook / candles / toolkit source) are
  `deterministic`; two agreeing provenance signals are `fast`; a disagreement or an
  expired / undecided outcome is `second_look`; everything else is `manual`.
