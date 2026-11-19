# What the owner's review teaches (standing rules for every rewrite)

Drawn from his sample review, 2026-11-12 (Step 2, first 56 questions, F1.02-F1.07, done from his phone in chat), and
his site notes the same day. Every writer and checker pass reads this file. Add to it as his review goes on; each
rule names the evidence.

1. **Cut trivia.** Vocabulary fill-ins whose only test is recalling a word ("ticker", "size"), exchange and broker
   minutiae (which broker opens pre-market at 7:00, whether a 7:40 a.m. print sets the consolidated high, when
   companies release earnings), arithmetic about index differences in "percentage points", and pedantic true/false
   ("buying SPY is buying the index itself", "more shares are bought than sold"). He removed every one of these.
   A question earns its place only if a trader would act differently for knowing it.
2. **The trader's view, not the textbook's.** Answer the way a working trader says it: a market buy fills at the ask
   (not "near the bid or the ask"); a liquid stock is one that trades enough volume to get in and out; in a weak tape,
   a strong setup is a name to track for relative strength until the market stabilizes (not just "go slow or wait");
   a gap on earnings is an earnings gapper. Prefer the practical framing over the dictionary definition.
3. **Explanations teach.** When a question uses a term, the explanation defines it in plain words (bid = the most a
   buyer pays right now, ask = the least a seller takes). Math answers show the steps (spread 0.10, midpoint 20.00,
   0.10 / 20.00 = 0.5%). "Could be a better explanation" was his most common note.
4. **Multiple choice over typed numbers.** He asked for multiple choice on the size questions and on a spread-percent
   question. Calculation questions should offer four answers built from real mistakes.
5. **No confusing setups.** "Slightly confusing", "slightly misleading", "slightly odd": a stem that needs a second read
   (two companies, same cap, float-adjusted index) is rewritten or cut. One idea per question.
6. **Order-flow questions name the tool.** A question about how many shares sit at a price reads as time and sales /
   level 2; say so and frame it the way he reads a tape.
7. **Tickers, not "Stock A / Stock B".** He asked to "change stock titles to tickers instead of a and b". A comparison
   names its stocks the way a trader sees them, with ticker-style symbols. When the numbers are made up, the ticker must
   not be a real company's (or the numbers must be that company's real ones).
8. **Company trivia goes.** A share-count line item from one company's annual report (Apple's fiscal 2025 buybacks) was
   cut; so was the OTC penny-stock tip question. Keep what a swing trader uses at the screen.
9. **Write money the way it is said.** "$1,200 million" should read "$1.2 billion" ("make it read in Billions if it is
   billions"). Use the natural unit: thousands, millions, billions.
10. **Real examples and fuller explanations.** "Can be much better worded with a real life example as well"; "can be
    explained better in more detail". Where a concept is abstract (inverse funds decaying, what an ETF is), the
    explanation uses a real, sourced case (a named fund over a real stretch, with its real numbers) and a little more
    depth, not a one-liner.
11. **Market reactions are likely, never guaranteed.** "LIKELY, not GUARANTEED": an answer about how the market reads
    news says "likely" or "usually", never states the reaction as certain.
12. **Earnings nuance, taught properly.** He cut a one-off Intel reaction question because "we could have much better
    and more thorough teaching lessons and better questions on this to get the nuance around earnings and reactions".
    And on Palantir's 500% EPS growth off one cent: "the flip to profitability is big". Earnings questions should teach
    what actually moves a stock (guidance vs consensus, the quality of a beat, a turn to profitability), with the
    nuance, not a single headline fact.
13. **Great traders' principles are high value.** "Test questions on O'Neil principles and principles of great traders
    and us as well are very valuable." Questions that test the principles of O'Neil, the other great traders the course
    quotes, and our own rules are worth keeping and adding to.
14. **Show where to find it.** "Explain how you can find the move on our app or how you can calculate it yourself." When a
    question uses a number a trader looks up (implied move, float, earnings date, relative strength), the explanation
    says where to find it in the UCT app or how to work it out by hand.
15. **Examples obey our own rules.** "I would never trade something that only trades 15K shares a day. We have liquidity
    minimums." A scenario must not put the member in a trade our rules forbid (under $10, under $20 million a day, thin
    names), unless the question is about spotting that rule. Use stocks we would actually trade.
16. **Never write "stock talk".** "Don't use the word stock talk, that's the name of a dude that I hate on Twitter." The
    validator now rejects it (courses_lib.BANNED_PHRASES).
17. **Our universe is mostly $1 billion and up.** "I don't really trade small caps though. Very rarely under $1B but
    sometimes." Examples should use the kinds of stocks we trade; a small-cap is the exception, labelled as one.
18. **Don't repeat one question shape.** "Seem to have a lot of these questions for some reason" (F5.05 had seven
    "options priced X%, the stock moved Y%, compare" questions). Within a lesson, keep two or three of any one shape and
    spend the rest on different skills: where to find it, what to do with it, how it meets our rules.

From his setup review, 2026-11-14 and 2026-11-16 (SET.07 Flat Base, SET.08 Bull Flag, in chat):

19. **Say what our labels mean, where the member meets them.** "If you're gonna describe something you need to describe
    it much better than that, very bad" (on "The market reading is Orange. By our guide, which flat bases may you
    buy?"). A question that leans on one of our labels says what it means in the question or story: the market reading
    is the app's market filter (Green, Yellow, Orange, Red; B18), and the color says how much the account trades (F65);
    a setup grade (A+, A, B, B-) is our judgment of how clean the setup is, and the grade sets the size (D38, E49).
    Grading is discretionary (E50): describe what the grade does, never invent a checklist for it.
20. **Say why it is wise.** "yes good but describe why that is wise!" (on "eight flat bases at their pivots after the
    reading turns Green: how many on day one?"). Restating the rule ("start with a few, add as they work") is not an
    explanation. The why names the reason a trader follows the rule: the risk it avoids or the edge it keeps, in plain
    words, from the rulebook, a cited source, or the numbers in the question (never an invented statistic). The
    simple line carries the reason too.
21. **Use our words.** "we use the phrase 'volume dries up' but yes same thing" (on volume in a flag). Volume DRIES UP
    in a base, flag or pullback (setups/GLOSSARY.md `volume dries up`), not "shrinks", "contracts" or "declines". Where
    the glossary or his rulings name a thing, use that name.
22. **Scanner numbers are not trading rules.** "oh please that is far too strict, bad question and bad answer bad bad
    bad" (on the flat base card's first-week test: the base's first week within 3% of the left-side high, a number from
    our scanner code). Earlier: "Partial maybe but not a hard rule" (a gap cue), and a question doing arithmetic on the
    card's 325-session cap was cut. Many card numbers are the thresholds our scanner uses to find candidates, not rules
    he trades by. Do not test a scanner cutoff as a pass or fail rule, and do not ask the member to apply its exact
    number; teach the idea behind it (a flat base forms near its highs and stays tight) and his own rulings (the
    rulebook, RULINGS). The first-week 3% test is not taught.
23. **No ratio drills for their own sake.** He removed "pole low 30, top 45, flag low 39: what share of the pole did the
    flag give back?". Arithmetic earns a question when the number drives a decision (where the stop goes, the size,
    whether it is too stretched to buy); a percent computed for its own sake is trivia (rule 1).
24. **A shape question shows the shape.** "Yes but need visual always for these"; "a visual along with it to see would
    be nice. Using our tick by tick with live lessons. Build this it is critical" (SET.07). A question about what a
    base, flag, line or candle looks like shows it: a chart or a picture card (docs/study/VISUALS_PLAN.md).

From his setup review, 2026-11-17 (SET.07, in chat):

25. **Write it in his voice, with more detail.** "Question and explanation can be much better worded and detailed imo.
    Sounds way too AI and not much in my prose at all" (on "The breakout fills at 48.60, the day's low sits at 46.40:
    which is the one thing you never do?"). Every question and explanation follows docs/study/VOICE.md, which is
    measured from his own Substack writing: short sentences, fragments welcome, "I" for judgment and "you" for
    instruction, the verdict first, his phrases ("area to risk against", "get involved", "sit on hands"), and its
    do/don't table. Read his real sentences in VOICE.md section 3 before writing. Textbook phrasing ("the primary stop",
    "lifts the grade", "the level it must trade through", "by default") reads as AI. Detail means working the
    question's own numbers through ("46.40 under a 48.60 fill is 4.5%, inside our 5%, so the stop stays where the chart
    puts it"), not adding words.
26. **A chart claim needs a chart, and a plain sentence.** "Can still be worded better, not a great question,
    especially without a chart example but also poorly worded" (on "Volume that dries up in the second half of the
    base lifts the grade, but we do not need it to buy", true/false). A statement about how a base, its volume or
    its lines behave is shown on a real example (rule 24 widened from shapes to volume and lines); and a true/false
    stem is one plain claim, not a rule with a "but" clause bolted on.

From reading ALL of his feedback again, 2026-11-17 (his ask: "analyze all the feedback DEEPLY and THOROUGHLY ... and
apply the suggestions broadly to improve our prose and system every time i give feedback"). Rules 25 and 26 were one
note each; read together with everything before them, they say more:

27. **No working words in member text.** Members never see our setup cards, the rulebook, decision numbers or
    "criteria". 918 lines in the library say "our card". That sounds like a spec sheet, not a trader, and it is how
    the scanner cutoffs in rule 22 slipped in as "rules". State what we look for as ours: "we want three taps", "we
    don't buy stocks under the 200-day". `voice_lint` flags it as a hard tell.
28. **A question gives enough to decide, and never leads.** "I would make the question a bit more detailed please";
    "I think that question is very leading btw" (workbench). Bare stems ("When do you buy?", "Our rule?") make the
    member guess what we mean. Give the screen: the ticker or chart, the numbers, what just happened. Then ask what a
    trader asks there, with no hint in the stem.
29. **Teach like a trade review, not a glossary.** Across his notes the asks are the same: "explain how", "show the
    steps", "give a proper way to calculate", "explain how you can find the move on our app", "give some entry and
    sizing indications or entry tactics" (workbench), "Detail and review the trade and explain the trade and the setup
    and the entry and the pattern and teach it all" (workbench). An explanation that only names the right answer and
    restates the rule fails all of these. Every explanation gives the verdict, the numbers worked out, the reason,
    and the practical how (VOICE.md section 10).
30. **His method is judgment, so never fake a formula.** "a flag is a flag imo", "def more of just a judgement thing",
    "volume really only raises the grade ... Always a bit of it is it depends", "sometimes it is not R based.
    Sometimes it is day based", the first-week 3% test he called "far too strict". When we turn a judgment into a
    hard number we teach something he doesn't do. Teach what he looks for and why, show it on real charts, and where
    it depends, say what it depends on. Only his rulebook numbers are hard numbers (rule 22).
31. **Examples are names he'd trade, in good spots.** "I want to see this in stocks I would like to trade idk what the
    heck SIBN is. I want it in good spots on good stocks"; "it is a lame regional bank"; "Liquid and sizable". His own
    picks are the anchors where they fit: SHOP 9/28 (Oops), AMD and RBRK (Kicker), MSTR (Launchpad), NAVN (HVE).

### How his feedback is applied, every time (the loop)

Each failure behind this loop happened; the fixes say why each step exists.

1. **Save every verdict the same day, word for word** (StudyReview verdicts and owner_verdicts.jsonl).
2. **Re-read ALL of his feedback, not just the new notes.** Look for what the new notes have in common with old
   ones, and for what his silent cuts and keeps say. Every word-free cut so far was trivia, a fill-in-the-blank, or
   arithmetic for its own sake. A rule written from one note misses the pattern. Rules 19-24 came only after he said
   "i hope you are analyzing it", and rule 25 after the same mistake repeated in a lesson already reworked.
3. **Turn each pattern into a standing rule here, and into a check where a machine can count it.** A rule only a
   writer reads gets missed. `voice_lint` (rule 25, 27), `library_audit` (style mix) and `check_course_charts`
   (examples vs real bars) are gates, not reports.
4. **Match his magnitude.** "much better" means a rewrite, not one added sentence. He has said so before: "You did not
   make ALL changes to the level and effect and magnitude that my feedback mandated" (round 17b).
5. **Rework everything he hasn't reached yet, and re-check what he kept, before he sees more.** Writers get the
   rules, VOICE.md section 10 and the before-and-after models. A separate checker scores voice as well as facts. Every
   rework is gated on `voice_lint --strict`.
6. **He reviews the real member screen, 10 questions at a time on localhost**, so he judges what members get,
   charts and reveal included, not chat text. Chat hid the charts ("I cant see it").
7. **Tell him in a few lines what was learned and what changed**, then keep the questions in front of him. Do not
   bury them under status updates.

### His rules we keep getting wrong (the checkers' catches, 2026-11-17)

Every writer gets this list, and every checker tests against it. Each line was caught in a rewrite at least once.

- Below the 200-day is a hard no for a STOCK. Only indexes and levered ETFs are excepted (D-009).
- Breakeven is 2R to 5R, or at the first sell, as judgment. It is never fixed at 2R (D-013).
- The first sell is judgment, usually day 3 or later, into a 3, 5 or 7 day push. It is never a fixed third at 3R.
- Our trails are the 9 and 20 EMA, never the 10-day or 21-day (D-021). A research measurement on those stays a
  measurement.
- The stop is the exit. A close back inside the base is a warning, not a sell by itself.
- We buy as price trades through the level, never at the close. A risk measured from a close fill isn't ours.
- A stop is 1-3%, up to 5%. Past 5% we mostly wait; never show a wider stop as a normal trade we take.
- Volume raises the grade. It is never a must.
- The market reading is a guide, and Red is mostly cash. "No buys in Red" is not a rule (F65).
- Total open risk is a guide that moves with the market, never a hard cap (A10).
- There's no daily loss limit (B15), no weekly one, and no losing-streak rule (B17). Size is cut only by the drawdown
  ladder. The only loss limit is monthly: 8% down in a calendar month, no new trades that month (B16).
- There's no cap on trades per day. The cap is per stock: 3 tries in a week, 6 in a month (E56). Tired, sick, angry or
  distracted: no new trades that day.
- Earnings: no new buys in the 3 days before a report. Hold through one only if the trade is up 5R (B22). Halving
  size into a report is an outside idea, not ours.
- No new buys outside regular trading hours.
- We trade shares. An option is an occasional defined-risk buy, and the premium is the stop (A6, B25). The member
  never sells an option as our trade.
- Shorting is only for traders who've already made $1 million trading (D-001).
- A card proposal or a scanner cutoff is never our rule.
- The 50-day over the 200-day is mostly a must, not always (MA-50-200). Never call it just a plus, and never an absolute.
- Adding: full size at one price, one stop, no starter piece, never add to a loser. Adding to a working winner is rare and
  a feel call (ADD-WINNER). Never teach "we never add" to a winner, and never teach adding as routine.
- Never give one of his rules a reason he didn't give.
- Game lessons have a shape the game reads. F5.08 (Earnings Desk): each question or story opens "Company, quarter:",
  why opens on the answer itself, why ends on what the stock did, and number answers stay typed (never multiple
  choice). F7.08 (History Detective) keeps its typed numbers too. The V courses feed Word Match: a vocab question names
  its word and asks what it means. Every content pass runs the Study app tests (`npx vitest run src/pages/study
  --maxWorkers=1` in app/), because the games read lesson text.
