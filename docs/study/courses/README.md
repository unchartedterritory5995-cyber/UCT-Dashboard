# Study courses: the authoring contract

Owner rulings, 2026-11-08 (verbatim in `docs/study/audits/2026-10-24/owner_verdicts.jsonl`):

- *"Most of the hard work is on the content side and making sure the users have a lot of value and variety in terms
  of courses, education, games and everything. And also of course I want it to all be verified and accurate against
  reliable information sources and good trading related knowledge."*
- Which courses first: *"idk all of it really"*: every Foundations track gets built.
- Sources: *"Yes and anything else as long as you have reliablity that it is good."*

This file is the contract every course file follows. `scripts/study/courses_lib.py` enforces the mechanical part, and
`tests/test_study_courses.py` runs it over every file. The judgment part (is the fact true, is the key right, would a
good trader say it this way) is the job of the cold checker and then the owner.

⛔ **This repo is PUBLIC.** A course file may quote public web pages (short quotes, below) and the owner's PUBLISHED
writing. Never paste anything private: no Discord exports, no unpublished Substack drafts, no member data, no TSDR
ledger, no brain DB text.

---

## 1. Where the files live

One JSON file per unit: `docs/study/courses/<track>/<unit>.json`, for example `docs/study/courses/F1/F1.03.json`.
UTF-8, LF line endings, indent 1. `python -m scripts.study.gen_courses` turns every file into bank items
(`docs/study/bank/course.<track>.json`) and lays the units onto `docs/study/skill_map.json`.

The unit list, what each unit teaches and its rough question count are in `docs/study/UNITS-foundations.md`. Follow the
`teaches` and `after it the member can` columns. Two exceptions to the plan:
- **F1.01 "How we talk at the desk" is NOT built from that row.** Its house-word list includes "the loop", a term a
  model invented that the owner had never heard of (2026-10-17). F1.01 waits for the owner's own word list.
- **No taxes anywhere** (owner, 2026-10-17). Wash sales are mentioned only as "ask a tax professional", never quizzed.

## 2. The file

```json
{
 "unit": "F1.03",
 "track": "F1",
 "title": "Bid, ask and the spread",
 "teaches": "one plain sentence",
 "skills": [{"id": "basics.spread", "title": "Bid, ask and the spread"}],
 "as_of": "2026-11-08",
 "sources": [
  {"id": "s1", "tier": 1, "publisher": "SEC, Investor.gov", "title": "Bid price", "url": "https://...",
   "accessed": "2026-11-08"}
 ],
 "facts": [
  {"id": "f1", "source": "s1", "quote": "verbatim from the page, 40 words at most",
   "claim": "the same fact in plain words, one sentence"}
 ],
 "walkthroughs": [
  {"key": "w1", "title": "short", "steps": ["2 to 4 short sentences, present tense"], "facts": ["f1"]}
 ],
 "questions": [
  {"key": "q01", "skill": "basics.spread", "rung": 1, "format": "mcq",
   "q": "The question.", "choices": ["A", "B", "C", "D"], "answer": "A",
   "why": "Verdict first. Then one or two sentences of why.",
   "lesson_line": "One line to remember, 22 words at most.",
   "facts": ["f1"],
   "wrong": {"B": "why B is wrong", "C": "why C is wrong", "D": "why D is wrong"}}
 ],
 "conflicts": ["where two sources disagree and what the file did about it (owner-only, never shown)"],
 "verify": {}
}
```

**Skill ids.** `<track slug>.<topic>`, lower case, one skill per unit unless the unit plainly teaches two things.
Track slugs: F1 `basics`, F5 `fund`, F6 `options`, F7 `history`, F8 `psych`, F9 `risk`, F10 `orders`, F10b `short`,
F11 `styles`, F12 `process`, V `vocab.<category>`; the Method's Setup track SET `setup` (one unit per criteria card
under `docs/study/setups/criteria/`; pilot SET.07).

**Formats** (what the app plays today):

| format | fields | plays as |
|---|---|---|
| `mcq` | `q`, `choices` (3 or 4), `answer` (one of the choices) | multiple choice |
| `tf` | `q` (a statement), `answer` `"True"` or `"False"` | true / false |
| `fill` | `q`, `sentence` with one `___`, `bank` (4 to 6 words), `answer` (one bank word) | tap the word into the blank |
| `numeric` | `q`, `answer` (a number), `calc`, optional `prefix` / `suffix` | type the number |
| `scenario` | `story` (2 to 4 short sentences), `q`, `choices` (3 or 4), `answer` | a short story with a decision |

**Choice order and variety.** Write the right answer first if you like: the bank builder deals it to a slot (`courses_lib.choice_orders`), so the order a member sees is balanced and stable. Add `"order": "fixed"` to a question whose choices have a real order (a ladder, a sequence). Do not make the right choice the longest, and keep True and False answers roughly even; `python -m scripts.study.library_audit` measures both, and the full rules are in `docs/study/LIBRARY.md`. A unit built to repeat one ask says `"variety_exempt": ["stems"]` at the top of its file.

**Vocabulary questions** (track V, and any unit that defines a word): put the word in `"term"`. A "what does X
mean?" question has the word as `term` and the short meaning as its `answer` (40 characters at most, so it fits a Word
Match tile); a "which word is this?" question has the word as both `term` and `answer`. Word Match pairs only the
first kind.

**A real chart under a question** (History Detective, a dated example): add
`"chart": {"sym": "SPY", "asof": "2020-03-23", "window": 120, "forward": 20}`. The importer pulls those bars from our
own price history (split-adjusted), the member sees the chart without the ticker until they answer, and the reveal
names it. The question must never name the ticker or give the date away. Facts about the chart (how far it fell, the
dates) still come from cited quotes or a `calc`, never from reading the picture.

**Rungs** 1 to 9: Learn 1-3 (recognise the idea), Practise 4-6 (use it on a case), Prove 7-9 (a real-world case, a
trap, a judgment). Spread each unit across all three levels, about a third each.

**Mix per unit.** At least 20% `scenario`, at least 15% `tf`, at least one `fill` or `numeric` where the unit has
anything to compute. No two questions test the same fact the same way.

**Walk-throughs.** Two or three per unit, unscored, shown before the first scored question: the mentor explains the
idea in 2 to 4 short sentences.

## 3. Sources and facts (the accuracy rule)

Every question's key and every number in its `why` / `lesson_line` comes from the facts the question cites, or from
its `calc`. Nothing comes from memory.

**Tiers** (the owner approved the tiers and said other sources are fine "as long as you have reliability that it is
good"):

- **Tier 1, official.** The bodies that make or run the rules, and primary records: SEC (sec.gov, investor.gov), FINRA
  (finra.org), MSRB, the OCC and the Options Industry Council (theocc.com, optionseducation.org), the exchanges
  (nasdaq.com, nyse.com, cboe.com, cmegroup.com), the Federal Reserve (federalreserve.gov) and FRED, BLS, BEA, the US
  Treasury, SIPC, FDIC, company filings on SEC EDGAR, an index provider's own methodology pages (S&P Dow Jones Indices,
  FTSE Russell, Nasdaq).
- **Tier 2, respected references.** Investopedia; broker education centres (Fidelity, Charles Schwab, Vanguard,
  Interactive Brokers); CME Group and Cboe education pages; StockCharts ChartSchool; Bulkowski's thepatternsite.com;
  IBD / investors.com; the CMT Association; Britannica and major financial press (Reuters, AP, WSJ, FT, Bloomberg,
  CNBC) for history; NBER and Federal Reserve research papers; the well-known trading books (O'Neil, Minervini,
  Weinstein, Nison, Edwards and Magee, Murphy, Douglas, Steenbarger, Elder, Natenberg, McMillan, Hull) as published or
  as quoted by a Tier 1 or Tier 2 page.
- **Other sources** only when their reliability is established: a named author with a known record, an institution,
  a peer-reviewed paper. Say why in the source's `why_reliable` field. Never: forums, Reddit, social media, anonymous
  blogs, AI content farms, a page whose own author or date cannot be found.

**The support rule.** A question's key needs **one Tier 1 fact**, or **two Tier 2 facts from two different
publishers that agree**. When good sources disagree, do not ask it as a fact: ask the convention ("most brokers ...")
or leave it out, and write the disagreement in `conflicts`.

**Quotes.** Copied from the fetched page text, 40 words at most, only what supports the fact (this repo is public;
keep quotes short). Record the exact URL and the access date. A fact without a quote that is really on that page is
not a fact.

**Things that change.** Settlement cycles, margin and day-trading rules, contract specs, trading hours, fees: check
the CURRENT official page and set `as_of`. FINRA has been changing the pattern day trader rule; read its current page
before writing anything about it, and phrase rules as "under FINRA's rule as of <date>" when the date matters.

**Computed answers.** A `numeric` question, or any question whose key is arithmetic, carries
`"calc": {"fn": "<name>", "args": {...}}` and the validator recomputes it. The functions are in
`scripts/study/courses_lib.py` (`CALCS`): spread, percent change, position size from risk, R multiple, market cap,
option payoff at expiry, breakeven, leveraged daily compounding, and so on. Need another one? Add it there with a test.
Never put a computed number in the text without a `calc`.

**History numbers** (how far a crash fell, how many days to the low) come from a Tier 1 or Tier 2 source quote, or
from a `calc` over values quoted from one. Do not round a quoted number into a different one.

## 4. Good trading knowledge

The checker asks of every question: would an experienced, profitable trader agree with the key AND with the way it is
said? Textbook claims that do not hold up are taught as what they are ("the textbook says X; in practice ..."), with a
source for both halves. Candle and pattern "predictions" are never keyed as facts (see
`docs/study/UNITS-foundations.md`, "Anti-repetition and accuracy rules applied", rule 2). No guarantees, no "always
works", no profit promises. Risk comes first.

## 5. Voice (`docs/study/VOICE.md` is the full rule)

- A friend and mentor across the desk. Second person for instruction ("mark your stop first"), first person for
  judgment ("I'd skip it").
- Questions: one idea, 140 characters at most, 22 words per sentence at most, no preamble ("In this scenario").
- Choices: 40 characters at most, similar lengths, never "all of the above". Wrong choices are real
  misunderstandings, never a rewording of the right one. Fill in `wrong` for every wrong choice.
- `why`: the verdict first ("That's the spread." / "False."), then why, using a number only when a fact or `calc`
  gives it. `lesson_line`: one line, 22 words at most.
- No em-dashes. No emoji. No exclamation marks in questions. None of VOICE.md §6's banned phrases. No "traders
  should" / "successful traders".
- Plain words. Never our house shorthand (the dial, the band, heat, the tape, the loop, regime) in a Foundations
  question.
- **Our name** (OWNER_PRINCIPLES rule 11): never "the firm". Say UCT, or "we" / "our rule". A house rule (our sizing
  rule, our stop rule) is asked as ours, sourced from this repo's pages that record the OWNER's own rulings (Tier 3,
  `"house": true` on the question, `url` = `repo:<path>#<heading>`): `docs/study/sizing_rule.md` (the sizing
  workshop), `docs/study/TRADE_PLANS.md` (entry, stop and targets the app's own detectors compute), and quoted owner
  words in `docs/study/OWNER_PRINCIPLES.md`. In `sizing_rule.md` only the lines marked as the owner's answer or quoted
  in his words count; a line credited to "Toolkit" is a lead to check, not a house source. ⛔ Never `docs/curriculum/`: the dossier and the presenter's brief were
  drafted by a model (that is where "the loop" came from), so they are leads to check, never a source.
- **Questions that ask, not lead** (rule 10): the question never gives away its answer, and it carries enough detail
  to know what to look at. A wrong choice is never obviously silly.
- **Never wrong** (rule 6): *"We cannot have incorrect examples and explanations!"* When in doubt, leave it out.

## 6. Verification (the checker fills `verify`)

A **separate** agent, which did not write the unit, checks every question cold:

1. Opens every cited URL and confirms the quote is really on the page.
2. Confirms the quote supports the fact, the fact supports the key, and every wrong choice is really wrong.
3. Checks the fact is current (the rule or number has not changed since the page was written).
4. Applies the trading-sense test (§4) and the voice rules (§5).
5. Writes, per question AND per walk-through, `verify.<key> = {"status": ..., "notes": "...", "fixed": true|false,
   "by": "checker"}`:
   - `pass`: right as written, or the checker corrected it in place, re-checked the correction against the source,
     and says what it changed in `notes` (`fixed: true`);
   - `fix`: something is wrong and the checker could not settle it (needs a better source or the owner's call);
   - `cut`: it cannot be made right (no reliable source, a trick question, a leading question, not good trading).

Only `pass` items are built into the bank (`gen_courses` skips `fix` and `cut`, and the file keeps them so the owner
can see what was caught). After the checker, the owner reviews on the StudyReview screen. Graduated trust
(spec §13.9 #3): he checks the first 20 to 30 of each kind closely, then spot checks.
