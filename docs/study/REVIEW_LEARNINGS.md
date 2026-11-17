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
