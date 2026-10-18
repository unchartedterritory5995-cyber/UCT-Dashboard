# Gate C — admin acceptance scenarios (for a real admin session, after Gate C is approved for release)

**Not yet runnable in production:** Gate C is not deployed. These scenarios are for acceptance after an approved release.

**What each step is checked against:**
- the receipt;
- the board itself (what actually changed);
- Undo.

**Model use:** most steps are instant. A step marked (model) makes one paid model call.

**Setup:** the Charts workspace with two charts side by side (left SPY, right QQQ), both on Daily, and your usual default averages. Start a new chat.

## A. Results → references
1. **"show me my strongest stocks"**
   - A table of names, ranked by RS Rank.
   - If it says the ranking is unavailable, stop and report it. This is also the RS Rank production-coverage check.
2. **"open the third one"**
   - With two charts and none clicked, it must ask "Which chart?". Pick **Right**.
   - The right chart switches to the 3rd name shown. **No new widget** appears.
3. **"make it weekly"**
   - The RIGHT chart (the one this chat changed) goes to Weekly. Left is unchanged, with no question.
4. **✋ Manual change:** click the LEFT chart, then change its symbol by hand to AAPL.
5. **"make it daily"**
   - Your click wins: the LEFT chart goes to Daily (the click outranks the conversation's chart).
6. **"compare it to the top 3"**
   - The clicked chart overlays the first 3 names of the table (minus whatever the chart already shows).
7. **"undo"**
   - Only the comparison is removed. The symbol stays AAPL.

## B. Repeat a change
8. **"make the left chart monthly"**, then **"do the same on the right one"**
   - The right chart goes to Monthly.
9. **"undo"**
   - Only the right chart goes back. The left stays Monthly.
10. **✋ Switch layout,** then switch back.
11. **"do the same on the right one"**
    - "I don't have a recent change to repeat …". A layout switch forgets board references, and **nothing changes**.

## C. Edit an indicator in place
12. **"add a 21 ema"**
    - Receipt: "Added EMA 21 … period 21, type EMA".
13. **"make it a 10"**
    - The SAME line becomes EMA 10: one line, not two. Receipt: "period 21 → 10".
14. **"change that to an sma"**
    - SMA 10. Period unchanged.
15. **✋ Manual change:** open the legend chip for that average and hide it.
16. **"undo"**
    - Refused: "It can no longer be undone exactly …". Your hide made the recorded state stale, and nothing is overwritten.
17. **✋ Show it again by hand.** Then **"change the 21 to a 9"**
    - "I didn't change anything: No indicator on <chart> shows 21. Say which one to change." (it is a 10 now). **Nothing is guessed.**
18. **"add the 50"**
    - SMA 50 (owner default). **"add the 30"** (model) asks EMA or SMA.
19. **✋ Delete the EMA/SMA 10 from Chart Settings by hand.** Then **"make it a 12"**
    - "… isn't on that chart any more, so there's nothing to change." Nothing is re-created.

## D. Ambiguity and safety (regressions from Gate B)
20. **"open swing"** (model)
    - Asks whether you mean the Swing Board layout or the Swing watchlist. **Never opens either on its own.**
21. **"remove momentum"** (model)
    - Asks whether you mean the watchlist or the indicator. Nothing is removed.
22. **"pull up amzon"**
    - Refused: "UCT has no symbol "AMZON". Did you mean AMZN …?". The chart is unchanged.

## E. Corrections and memory
23. **"show me my strongest stocks"**, then **"no, I meant software stocks"** (model)
    - A software screen. Your correction is honoured.
24. **"open the third one"** after a **New chat**
    - Goes to the model and asks (the new chat has no results to point at).

## Pass criteria
- Every ✋ step's outcome holds: the click wins; a stale state refuses; a removed item is reported.
- Zero changes you did not ask for. Zero duplicate indicators.
- Every Undo restores exactly, or refuses.
- Model calls only on the steps marked (model): 4 paid calls in total, about $0.03–0.06.
- `GET /api/agent/budget` (admin) shows them settled, with their tokens.
