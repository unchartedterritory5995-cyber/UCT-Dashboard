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

## 10. Course questions and explanations, in his voice (2026-11-17)

His note on a reworked setup question: *"Question and explanation can be much better worded and detailed imo. Sounds
way too AI and not much in my prose at all."* Earlier, on the workbench: *"explanations are better than before but can
still be simpler to read and more direct as a teacher and mentor"*, *"can make this much cleaner and more cool and fun
btw instead of lame and wordy like this"*, and *"make it sound like us and a person and friend and mentor is teaching vs
just AI slop"*. A measure of the library on 2026-11-17 (4,844 live questions) shows why: 918 lines say "our card", a
working file members never see; 650 explanations lean on a book author ("Kullamagi says"); 2,836 choices are
"No; ..." clauses; whole lessons open their explanations the same way ("True. The ..."); and most explanations never
say I, we or you.

### How he talks (read his real writing before you write)

His posts are on this PC in the private morning-wire repo (`data/voice/voice_exemplars.json`, 120 passages). Read a
dozen before writing. Never paste them into this public repo. What they share:

- **He narrates the chart.** The price, the level, the averages, the candle, the day: what is on the screen, in
  order, in a few short sentences.
- **He says what he wants and what he'll do.** "I want to see ...", "If it gives me ... I'll be a buyer", "That's
  where I'd want to be involved."
- **Blunt verdicts.** From his review notes: "Pass on this one." "This is the picture perfect example." "Location
  matters big time." "I would never trade something that only trades 15K shares a day."
- **Honest about judgment.** "That's just my experience." "It depends", followed by what it depends on. He never
  pretends a judgment call is a formula.
- **Real names, real dates, real prices.** Never a made-up "Stock A".
- **The practical how.** Where the entry goes, where the stop goes, how the size follows, where to find it in our app.
- **His words for things.** Volume "dries up", "raises the grade", the low of the day (LOD), "trigger", "get involved",
  "on your radar", "tight", "higher low", "RS". Teach a short form once ("the low of the day, LOD"), then use it.
- Short sentences and fragments. Contractions where they sound natural. At most one CAPS word, rarely.

### The AI tells (`python -m scripts.study.voice_lint` counts them)

The list, with his words for each, is `docs/study/voice_tells.json`. **Hard** tells must be zero in any lesson we
rework (`--strict`):

- our working words: card, rulebook, criterion and criteria, decision numbers (D-0xx);
- the banned names: the firm, the owner, stock talk, the member;
- stems like "Our rule?", "By our guide", "fits our rule", "the one thing you never do";
- textbook phrasing: "lifts the grade", "primary stop", "catching its breath", "let the trade come to you", "buyers are
  still in control", "at every timeframe", "the level it must trade through", and the section 6 list.

**Soft** tells stay rare:

- "No; ..." choices;
- a book author inside the explanation;
- stiff "That is a ..." phrasing;
- hedges ("usually", "by default").

A lesson is also flagged when one opener ("True. The") starts more than a quarter of its explanations, or when fewer
than 60% of them talk as us or to you.

### A question

- **A real situation with enough to decide.** The ticker or the chart, the numbers on the screen, what just
  happened. He asked "make the question a bit more detailed please".
- **The question a trader asks at the screen.** "Do you buy it?" "Where's your stop?" "What's this telling you?"
  "How many shares?"
- **Not leading.** "I think that question is very leading btw." The stem never hints which answer is right.
- **Choices are short, plain options.** Each is something a real trader might do or think. The wrong ones are named
  mistakes: chasing, moving the stop to fit the size, buying the close, buying under the 200-day.

### An explanation (the reveal)

Vary the shape so two explanations in a row never sound stamped from one template. The pieces:

1. **The verdict, the way he'd say it.** "Fewer shares." "Just the A+." "Pass." "That's your buy."
2. **The why, in the question's own numbers, worked out.** "From 48.60 that's about 4.5%."
3. **The reason a trader does it.** The risk it avoids or the edge it keeps (rule 20), never the rule restated.
4. **The practical how, when it helps.** The entry, the stop, the size, where to find it in the app.
5. **One line of mentor judgment, when it fits.** "I'd rather miss it than chase it." "Let the market earn your
   exposure."

A book author goes in the explanation only when the question is about that trader's principle (rule 13). Otherwise
it belongs in "deeper". **Detail means substance, not length:** the numbers worked out, the reason, and the how. Cut
everything else.

### Before and after (the model for every writer)

**SET.07, the stop and the size.** He wrote: "much better worded and detailed ... way too AI".

> Before. *The breakout fills at 48.60. The day's low sits at 46.40.* **Which is the one thing you never do?**
> (Pull the stop in to fit your size.) *Never pull the stop in to fit the size. The stop comes first, and the size
> comes from the stop. ... By default the stop sits a few cents under the day's low, the primary stop. We accept a
> stop up to 5% away. Past 5%, we mostly wait for a tighter trigger.*
>
> After. *You bought the breakout at 48.60. The low of the day is 46.40, about 4.5% under your fill.* **Your normal
> size doesn't fit that stop. What do you do?** Fewer shares, stop stays at the low · Move the stop up so the size
> fits · Full size, it's only one trade · Use a 7% stop to give it room.
> *Fewer shares. Your stop goes a few cents under 46.40, the low of the day. That's where the chart says you're wrong.
> About 4.5% is wider than I like, but under 5% I'll take it. The size comes from the stop, never the other way
> around. Pull the stop up just to fit more shares and normal noise takes you out of a good trade. So you buy fewer
> shares, or you wait for a tighter entry.*

**SET.07, the market reading.** He wrote: "If you're gonna describe something you need to describe it much better
than that".

> After. *Our market filter reads Orange: the market's under pressure, one step from Red. Three flat bases trigger
> this morning. One is an A+, our cleanest kind of setup, the kind we size up on. One is an A, one a B.* **Which
> ones do you buy?** Just the A+ · All three, full size · None, Orange means all cash · The A+ and the A.
> *Just the A+. In an Orange market breakouts fail more often, because the market isn't backing them. So I only want
> my very best idea, the cleanest base with the tightest risk. The A and the B can wait for a better market. Green is
> when we press. Red is mostly cash.*

**SET.07, eight bases after a correction.** He wrote: "yes good but describe why that is wise!"

> After. *The market just turned Green after a correction. You have eight flat bases sitting right at their
> pivots.* **How many do you buy on day one?** A few of the best ones · All eight, half size · Four now, four
> tomorrow · None, wait a week.
> *A few of the best ones. The first Green day after a correction can be a head fake. Buy all eight, it fails, and
> eight stops hit at once. Start with a few. If they work, the market's telling you the turn is real, and you add.
> If they fail, you lost a little and you're mostly in cash. Let the market earn your exposure.*

**SET.07, volume in the base.** He wrote: "not a great question, especially without a chart example but also poorly
worded".

> Before. *Volume that dries up in the second half of the base lifts the grade, but we do not need it to buy.*
> (True/false.)
>
> After (on a real base where volume visibly dries up). **Look at the volume bars on the right side of this base.
> What are they telling you?** Sellers are drying up · Buyers are losing interest · A breakdown is coming · Nothing,
> volume doesn't matter.
> *Sellers are drying up. When the people who wanted out are mostly gone, volume dries up. Fewer shares are for sale,
> so when buyers show up, price can move. I like seeing it, and it raises the grade. It's not a requirement though. A
> clean base without it still gets bought.*

**SET.07, the pivot (LNG chart).**

> Before. **Where is this flat base's pivot, the level it must trade through?** *The base's highest intraday high.
> The top of the box is where sellers have turned the stock back again and again. ... MarketSmith calls it the
> left-side high that began the base. IBD adds 10 cents to it ...*
>
> After. **Where's the pivot on this base?** The top of the box, the high · The bottom of the box · The middle of the
> range · The 50-day moving average.
> *The top of the box. LNG kept running into the same high and getting turned back. That's where the sellers sit.
> When price trades through that high, those sellers are used up, and that's the buy: a market order right as it
> goes through. Mark the level the night before and set an alert, so you buy the break and don't chase it later.*
> (MarketSmith and IBD move to "deeper".)

**SET.07, the averages (NUS chart).**

> After. **Check the moving averages. Is this one we can buy?** Yes, price over a rising 50 and 200 · No, it's under
> the 200-day · No, the 50 is under the 200 · Only the 200-day matters.
> *Yes. Price is over the 50-day and the 200-day, and the 50 is over the 200. Everything's pointed the right way.
> That's what a leader looks like while it rests. NUS had nearly doubled, then built this shelf, and it broke out the
> next day on 1.9x volume. Under the 200-day we don't buy stocks. That's a hard line.*

### A walkthrough (the worked example before a lesson's questions) (2026-11-17)

A walkthrough is him walking you through one chart or one idea, beat by beat. Each step is one beat on one screen:
22 words at most (the importer's limit), one or two short sentences. Two to four steps.

- **A setup walkthrough** narrates the trade in order: what happened, why it's a setup, the buy and the stop with
  their numbers, then how it ends (the idea is wrong if X; what it did; what you do with a winner). Dates are said the
  way a person says them ("March 10, 2016", "September 2013"), never 2016-03-10. No labels like "Failure mode:" or
  "Context and pattern check out". These are examples from our research on real charts, so never say we personally
  traded one unless a fact says so ("we buy at market" as the play is fine; "we made 12R on it" is not).
- **A concept walkthrough** teaches one idea the way he'd explain it across the desk: plain, short, with "you", and a
  number example where the facts give one. No textbook definitions read aloud ("X is defined as...").
- A research measurement on the 10- or 21-day stays a measurement, but never present those as our lines (ours are the
  9 and 20 EMA). "Riding its rising short-term averages" is the safe way to say it.
- Every number in a step must be in a fact the walkthrough cites. A step that needs a new number cites a new fact
  (word for word from a source the lesson already has).

> Before (SET.20 w1). *ULTA, 2016. Report on 2016-03-10; the gap day is 2016-03-11, up 14.2% on 4.8x volume. It closes
> at 94% of its range. / A big gap out of a correction. Then a 4-session pullback, 2.8% deep, that holds the gap-day
> low. / Day 6: buy at market over the prior day's high, 190.69. Stop a few cents under the pullback low, 186.55. /
> Failure mode: a close under the gap-day low. Instead it ran to 12.1R. Sell into a push, trail the rest.*
>
> After. *ULTA reported March 10, 2016. Next day it gapped up 14.2% on 4.8 times normal volume and closed near the
> high. / A big gap out of a correction. Then four quiet days, only 2.8% deep, and it never lost the gap-day low. /
> Day 6 it takes out the prior day's high, 190.69. We buy at market, stop just under the pullback low, 186.55. / A
> close under the gap-day low says we're wrong. Never happened. It ran to 12.1R: sell into a push, trail the rest.*

> Before (V.02 w1). *Read a chart by its peaks and troughs. Higher highs and higher lows: that's an uptrend. / Lower
> highs and lower lows: a downtrend. Flat highs and flat lows: a trading range. / A trend holds until price proves
> otherwise. An uptrend ends when a lower low drops under the last trough.*
>
> After. *First thing I look at: the peaks and the troughs. Higher highs and higher lows, that's an uptrend. / Lower
> highs and lower lows is a downtrend. Flat highs and flat lows is a range, going nowhere. / Trust the trend until
> price proves otherwise. The uptrend is over when it makes a lower low under the last trough.*
