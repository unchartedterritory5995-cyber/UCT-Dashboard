# The house sizing rule (single authority for Study)

**Status:** Phase 0 draft for owner sign-off (2026-10-17). From the owner's workshop answers
(spec §4.11) plus the owner's own published rules (Sunday Scans, 2026-06-14 and 2026-07-19,
quoted below). `gen_size.py` reads this file; the toolkit's printed sizing-gate card is regenerated
from it; `houseSizing.json` becomes a cap layer the Method mentions once.

## 1. Risk per trade

- **0.25% to 2% of the account**, chosen by setup quality, your recent performance, market
  conditions and your edge. **2% is the hard ceiling.** Under 1% is normal.
- **Flat-risk sizing** (the same percent on every trade) is taught as a valid alternative, not a
  mistake. Both are in the curriculum; the member chooses one and writes it in the plan.
- Owner's own number, quoted: *"I almost never take a loss greater than 3%."* (position loss, not
  account risk; taught as "where the owner's stops sit", see §2).

## 2. Stop first

1. **Default stop: the low of the day, or the prior day's low.** (Owner's answer.)
2. **Supporting methods:** the structure (pivot area, pullback low, the base low) and ATR.
3. **Sequence is law:** stop first, distance second, size last. You never pick a size and back-fit
   a stop inside the noise. (Toolkit sizing gate.)
4. **If the honest stop does not fit the risk budget: skip. Never tighten the stop.** (Toolkit
   problem #10.)
5. A stop cannot catch an overnight gap: a tight stop never licenses a monster position.
   (Toolkit problem #9.)

## 3. Size from the stop

- **Position % = risk % ÷ stop distance %.** Then Position $ = Position % × account; Shares =
  Position $ ÷ entry, **rounded down**.
- Worked: 1% risk, 5% stop → 20% position. 1% risk, 10% stop → 10% position. 0.5% risk, 1% stop →
  50% position, which the ceiling (§4) then caps.
- The reverse is drilled too: given a size and a stop, what is the risk? (Owner: "if it's a 1% stop
  then technically a 50% size would be 0.5% risk.")
- **Trade SHARES.** (Owner.) Options are a defined-risk substitute taught in F6, never the default.

## 4. Ceilings and the drawdown ladder

- Max position size is a **cap layer**, not the lesson. The app's table (`houseSizing.json`):
  GREEN A+ 25 / A 20 / B 10 · YELLOW 15 / 12 / 6 · ORANGE 8 / 5 / 0 · RED 0. The Method mentions it
  once as "the firm's cap by market condition and grade".
  **Owner, 2026-11-09, on this table:** *"20 is interesting and can be variable vs hard rule imo"*, *"20 is variable
  as well essentially"* → a guide that changes with conditions, **never taught as a hard rule**.
- **Owner's own drawdown ladder, quoted (2026-07-19):** *"I lowered my max sizing to 5% down from
  10% which is down from 20%. After a 6% drawdown I immediately reduce to 10% max. After an 8%
  drawdown I reduce to 8% max. And after 10% drawdown I reduce to 5% max."*
  → Taught as the firm's drawdown protocol: **normal max 20% · after −6% → 10% max · after −8% →
  8% max · after −10% → 5% max.** ⚑ Owner to confirm these as the house numbers (the dossier's
  M13 says "−5% halve, −10% pilot-only"; the owner's published ladder is more specific).
- **Owner, 2026-11-09**, asked whether Size It's 25% position cap or the ladder's "normal max 20%" is the
  house number: *"20-25% is max yeah"* → the normal max position is **20% to 25% of the account**
  (the table's A 20 and A+ 25). Size It keeps every position at or under 25%. The lower ladder steps
  (after −6%, −8%, −10%) still wait on his confirmation.

## 5. Portfolio layer

- **Total open risk (heat) ≤ 10% of the account.** (App cap.) **Owner, 2026-11-09:** *"17 is not exactly right but
  variable as well"* → total open risk is watched and varies; **no fixed 10% cap is taught as our rule**.
- **5 to 10 positions** for a momentum swing book. Concentration over diversification.
- ~~Progressive exposure: pilot → half → full, add only after the last step paid.~~ **Struck by the owner,
  2026-11-09:** *"11. is not a rule at all, I do not scale into trade i buy full at one spot with one stop."*
  → **Our rule: buy the full position at one price, with one stop.** No pilot, no adds.
- ~~Correlation: five positions in one theme count as one trade; sector concentration flagged at 40% (the heat
  tool's rule).~~ **Struck by the owner, 2026-11-09:** *"19 is wrong essentially."* Not taught as our rule.

## 6. Management (so the sizing drills can go full circle)

- *"Hold your winners by selling partials into strength and trailing the rising moving averages."*
  (Owner, 2026-06-14.) The firm's trail: the 10/20-day for episodic pivots (dossier CORRECTIONS);
  named traders' variants appear only in questions that name the trader.
- Breakeven rule: the point after which a trade must never again become a loser (dossier M10).
- ~~Base re-entry rule: cut at least half if the stock falls back into its base.~~ **Struck by the owner,
  2026-11-09:** *"15, eh, my stop is my stop most of the time."* → the exit is the stop; no half-cut rule is taught.

## 7. What the drills generate from this file

- `size` items: forward (shares and $ at risk), reverse (risk from size and stop), ceiling-capped,
  skip cases, flat-risk vs quality-scaled, drawdown-ladder cases ("you are −7% from peak, A+ setup,
  what is your max size?").
- `manage.math` items: open R after partials, breakeven stop moves, R still at risk.
- Every answer is computed by the formula in §3 with the caps in §4 and §5; the reveal shows the
  arithmetic.

## 8. Open for the owner

1. ~~Confirm the drawdown ladder numbers in §4 as the house protocol.~~ Settled 2026-11-09 (§9 A8).
2. ~~Confirm "under 1% is normal" as the default risk the drills assume when the question does not
   state one.~~ Settled 2026-11-09 (§9 A1).
3. Confirm the 3% "position loss" line as a taught guideline, not a rule.

## 9. The account rulebook (the owner, 2026-11-09)

The owner asked to "finalize all possible and good high quality account rules" before the setup rules. This section
is the single list the courses and games teach as ours; where it and an earlier section disagree, this section wins.
His words are in `docs/study/audits/2026-10-24/owner_verdicts.jsonl` (2026-11-09). §8 items 1 and 2 are settled by A8
and A1 ("A is good").

**A. Settled ("A is good")**
- A1. Risk 0.25% to 2% of the account on a trade, picked by setup quality, recent results, the market and your edge.
  Under 1% is normal; 1.5% is the most any grade uses (E49); 2% is the absolute ceiling.
- A2. Risking the same percent on every trade is also fine: pick one way and write it in the plan.
- A3. Stop first (by default a few cents under the day's low or the prior day's low, F62); the size comes from the stop;
  if the honest stop does not fit the risk, skip the trade.
- A4. The stop is the exit. It only moves up, never down or wider. The one exception is the gap rule (B20).
- A5. Shares = account × risk % ÷ (entry − stop), rounded down, then capped: the size is the SMALLER of the risk-based
  size and the position cap (A7, or the ladder's cap in a drawdown, A8). The full size at one price with one stop; no
  adding.
- A6. Trade shares; options are only a defined-risk alternative.
- A7. Max position 40% of the account (raised from 20-25% on 2026-11-09: "RAISE THE CAP TO 40% ACTUALLY. ESPECIALLY
  WITH EARLY TRIMS AT 3-5R THAT IS FINE."). A tight stop never justifies a bigger position than that: a gap can jump
  the stop. All positions together: up to 200% of the account in a Green market (margin, B24, F60), up to 100%
  otherwise; so a full book of 10 averages about 20% a position.
- A8. Drawdown ladder. A drawdown is how far the account is below its highest value, open trades included, checked at
  least weekly. On the way down: under 6% down, the normal cap (A7); 6% down, max position 10%; 8% down, 8%; 10% down,
  5%; 15% down, no new trades (B13). On the way back up: one rung up each time the account wins back half of the
  drawdown; the normal cap again once the account is within 5% of its peak (B14).
- A9. Hold 5 to 10 positions.
- A10. Total open risk and position size by market condition are guides that vary, not hard caps.
- A11. Sell some into strength and trail the rest under the rising averages.
- A12. Plan every trade as Entry, Stop, Trim, Trail, Advance.
- A13. "I almost never take a loss greater than 3%": the stop usually sits within about 3% of the buy (a loss on
  the position, not the account). (Confirmed 2026-11-09: "3, yes.")
- A14. Read a chart in percents: how far a stock is off its highs and how far it is stretched above its averages.
  (Confirmed 2026-11-09: "3, yes.")

**B. Added**
- B13. At a 15% drawdown, stop opening new trades and review before trading again. ("13, good.")
- B14. Size comes back one rung of the ladder each time the account recovers half of the drawdown; full size again
  once the account is back within 5% of its peak. ("14, good except full size okat at 5% drawdown again on the way up.")
- B15. No daily loss limit. ("15, no.")
- B16. No weekly loss limit; a monthly loss limit of 8%: at 8% down in a calendar month (from the month's starting
  value), no new trades for the rest of the month. ("16 no But a monthly loss limit of 8%." Asked what happens when it is hit: "monthly limit, yes.")
- B17. No losing-streak rule: size is cut only by the drawdown ladder, in percent (A8, B13, B14). ("17, only
  drawdown rule in terms of %.")
- B18. A market filter decides when the account trades: the app's market reading (Green, Yellow, Orange, Red).
  ("18, yes there is a market filter for sure yes."; asked if it is the app's reading: "2, yes.") What each reading
  changes is a guide, not a hard cap (A10).
- B19. Move the stop to breakeven at 2R to 5R, ideally. The first trim: the hard rule is **a third at 3R**; ideally
  anywhere from 3R to 6R, and in practice he mostly waits for 5R. ("19 breakeven stop at 2-5R ideally.First trim at
  3-6R ideally." Then: "New trims rules are what I like for hard rule can say trim 1/3 at 3R but I rarely actually
  do that and mostly wait for 5R.") This replaces the setup plans' "take some off at 2R and 3R" in what the courses
  teach as ours; the setup review (TRADE_PLANS.md) follows it.
- B20. A gap against the stop: the first 30 minutes of the gap-down day decide. The low of the first 30-minute bar is
  the new stop. ("gap against stop use 30 minute rules (let first 30 minute low of gap down day define new stop.")
  With a ceiling: if the first 30 minutes take the loss past 2R, get out. (G70, "70 yes")
- B21. After a stop-out, buy again only if the setup triggers again, as a new trade with its own stop and every rule.
  ("21, yes.")
- B22. No new buys in the 3 days before an earnings report; hold through a report only if the trade is up 5R.
  ("22 change it to 3 days and only hold if up 5R.")
- B23. Trade only stocks at $10 or more that trade at least $20 million a day. ("23, yes.")
- B24. Margin: total long positions up to 200% of the account. Risk per trade is still a percent of the account.
  (His words named his account size; it is kept out of this public repo. The rule is the 200%.)
- B25. Options occasionally; no further rules. The premium paid is the stop. ("25, occassionally but dont need any
  rules, premium paid is stop.")
- B26. The 200-day line: no longs below the 200-day simple moving average, unless it is a parabolic long; shorts only
  below the 200-day, never above it unless it is a parabolic short. ("SHort I will only do if below the 200SMA. No
  longs below 200SMA (unless parabolic long) no shorts above 200SMA unless parabolic short.") A hard rule ("200SMA is
  hardened rule yes"). **Parabolic**, as he directed ("read bracco's substack post to determine a parabolic short
  and long"): Bracco's "The Parabolic Short" (https://unchartedterritoryy.substack.com/p/the-parabolic-short), the
  "parabolic burst", a 3-5 day final leg: three straight up days, two straight overnight gap ups, two of three days
  of range expansion, two days of rising volume, and a gap up on the climax day; the more boxes checked, the stronger.
  The post has no parabolic long; the long is the mirror image, a burst down (confirmed: "1, yes.").
- B27. Journal every trade the same day and review the week every weekend, ideally. ("27, ideally yes..")

**C. Approach (second round, 2026-11-09)**
- C28. No chasing: never buy more than 4% above the buy point. ("28, make it 4%.") Chasing costs size, not risk: the
  stop stays under the buy point, so the distance grows and the shares shrink (A5).
- C29. Too stretched to buy: skip a long that is more than 10% above its 10-day average. ("29, yes.")
- C30. No time-of-day rule. ("30, no")
- C31. Buy leaders: an RS rating of 80 or more, in one of the strongest groups, except parabolic and mean-reversion
  trades. ("31, yes unless parabolic or mean reversion.") Shorts are the mirror (D47): the weakest stocks, an RS
  rating of 20 or less, in the weakest groups.
- C32. No news-day rule: Fed and CPI days are traded like any other day. (He declined it as a rule: "not a rule i
  generally ignore that ...")
- C33. Time stop: a trade still under 1R after 10 trading days is sold, freeing the money. ("33, yes."; "done
  nothing" defined in the 2026-11-09 cleanup.)
- C34. A climax run on your own long (Bracco's parabolic burst): sell a big part into it, a judgment call. ("34, yes
  but depends.")
- C35. We swing trade: days to a few weeks; a winner can be held longer while it keeps working. ("35, yes.")
- C36. Follow the rules; breaking one is not recommended. (He noted a rule is sometimes bent to get exposure: "kind
  of but sometimes you have to break rule to get exposure but not recomended.") Taught: don't; if you do, journal why.
- C37. New traders start at 0.25% risk per trade until 50 journaled trades followed the rules, then size up.
  ("37 yes")

**D. Third round (2026-11-09)**
- D38. Setup grades set the size: A and B setups at normal size; A+ sized up; B- or lower sized down. ("38, A and B are
  normal size, A+ are sized up, B- or lower sized down.")
- D39. Every planned buy has its entry, stop and size written down before the market opens. ("39 yes")
- D40. Prefer stocks with growing sales and earnings; the chart comes first. ("40, yes.")
- D41. Every position has a real stop order with the broker, not a stop kept in your head. ("41, yes.")
- D42. Never own more than 1% of a stock's average daily volume; illiquid stocks are not even watched. ("42, yes
  obviously we shouldnt even watch illiquid stocks like that.")
- D43. Recalculate the account value weekly or monthly and size every trade from it. ("43, weekly or monthly either one.")
- D44. No setup, no trade: never force a trade to have something on; cash is a position. ("44. yes.")
- D45. Never raise risk past the rules after a run of winners. ("45. yes.")
- D46. In a Red market: mostly cash, plus shorts below the 200-day. ("46, yes.")
- D47. Shorts are our long setups reversed, for almost every setup. A parabolic short's stop sits above the day's high
  and its target is the 9-day average (Bracco's post). ("47, yes but that is parabolics. Shorts are the same just
  reversed for almost all our setupstuff.")
- D48. Skip a short when the stock is hard to borrow or the borrow fee is high. ("48, yes.")

**E. Fourth round (2026-11-09)**
- E49. Risk by grade: A+ 1% to 1.5%; A and B 0.5% to 1%; B- or lower 0.25% to 0.5%. ("49, yes but a little smaller
  honestly."; the smaller numbers: "Sur that is good for 49.")
- E50. Grading a setup (A+, A, B, B-) is discretionary and hard to define; no fixed checklist is taught as ours. ("50, It
  is discretionary and hard to define.")
- E51. After the first third at 3R: another third at 5R, then trail the last third; adjustable. ("51, thats fine idk can
  adjust it but thats fine.")
- E52. Default trail: the 10-day average for fast movers, the 21-day for steadier ones; sell on a close below it.
  ("52, yes.")
- E53. No rule for new listings (IPOs). ("53 no")
- E54. Leveraged ETFs are preferred; no extra rules. ("54, I lvoe leveraged ETFs no extra rules, they are preferred
  actually.")
- E55. No short-interest rule. ("55, forget that no.")
- E56. The same stock: at most 3 tries in a week and 6 in a month. ("56 3 tries in a week, 6 in a onth.")
- E57. Entries are market orders. ("57, No i market order everything.") The stop still sits with the broker (D41).
- E58. No new buys outside regular trading hours. ("58, that is fine.")
- E59. Each month, review the numbers: win rate, average win and loss in R, expectancy, and other statistics. ("59 yes
  and other statistics.")

**F. Fifth round (2026-11-09)**
- F60. Margin (up to 200%, B24) is used only in a Green market. ("60, yes.")
- F61. No hedge rule: an inverse ETF against your longs is not ruled out. ("61, no")
- F62. The stop sits a few cents under the day's low, not exactly on it. ("62, yes.")
- F63. If a stock opens above a trim level (3R, 5R), take that trim at the open. ("63 yes")
- F64. Each day, a focus list of the 5 to 10 best setups; the rest are ignored. ("64 yes.")
- F65. The market reading as a guide (A10): Green, full risk per grade and up to 10 positions; Yellow, smaller and
  fewer; Orange, only A+ setups; Red, mostly cash and shorts. ("65 yes.")
- F66. Never take a trade from an alert, a post or a video without your own entry, stop and size by these rules.
  ("yes to all of those")
- F67. Tired, sick, angry or distracted: no new trades that day. ("yes to all of those")
- F68. After a market correction, when the reading turns Green again, start with a few positions and add more only as
  the first ones work (the account's number of positions, not adds to one trade, A5). ("yes to all of those")
- F69. Small accounts hold fewer positions, about 3 to 5, so each is big enough to manage. ("yes to all of those")

**Declined after the cleanup (2026-11-09):** a position over 25% needs no A+ grade or Green market (72, "72 no");
leveraged ETFs count at face value, not at their leverage (71, "NO");
a big position may wait for 5R like any other, no forced first trim at 3R (73, "NO"); no limit on how many
positions can be over 25% at once (74, "NO").

**Cleanup (2026-11-09, the owner: "CLEANUP WHAT YOU THINK YOU SHOULD AND LETS FINALZIE THOSE"):** A1 names 1.5% as the
grades' most and 2% as the ceiling; A3 carries F62's few cents; A5 says the size is the smaller of the risk-based
size and the cap; A7 adds the book's 200% / 100% limits; A8 defines drawdown and folds B13 and B14 into one ladder;
B16 runs by calendar month; C28 notes that chasing costs size; C31 gains the short-side mirror; C33 defines "done
nothing" as under 1R after 10 trading days.

**The account rulebook is closed as of 2026-11-09** (71 rules, B20 now with the 2R ceiling: A1-A14, B13-B27, C28-C37, D38-D48, E49-E59,
F60-F69). The setup plans (TRADE_PLANS.md) are reviewed next, when the owner says so.
