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

## Production acceptance record (2026-10-18, admin session, `f4d3f727a5`)

**Run:** a private layout with two unlinked charts, side by side.

**Result:**
- 16 PASS, 3 manual steps done.
- 3 FAIL: S6, S11, S22.
- 2 NOT TESTED: S20 and S21. The account has no Swing Board layout, Swing watchlist or Momentum watchlist; both still changed nothing.
- Cross-tab approval binding: PASS. A board changed in another tab made "Apply" refuse, and nothing changed.
- Model calls: 9 settled, $0.10 on the Agent ledger.

**Fixed in `fix/agent-gate-c-stabilization`:**
- **S6:** "compare it to the top 3" and "open the third one" used the conversation's chart over the chart the member had clicked. `references.js` `subjectChart` now checks the click first, as `subjectTarget` and §2 of GATE-C.md require.
- **S11:** chart refs and the last change came back after A → B → A, because memory was keyed to the layout identity and `memory.boardChanged()` was never called. Owner decision 2026-10-18: drop them, as specified. The workspace now counts layout visits (`host.boardVisit`), and memory drops the board's refs when the count moves. The board epoch is unchanged, so proposals, Undo and cross-tab sync behave as before.

**Recorded, not fixed (follow-ups; no feature work in this patch):**
- **S18:** "add the 50" on a chart that already shows a default SMA 50 adds a second identical SMA 50 without a word. Candidate: say it is already there, or ask.
- **S22:** "pull up amzon" refuses correctly but gives no "Did you mean AMZN?" suggestion.
- **S21:** "remove momentum" with no Momentum item answered "That indicator isn't on Right chart (CD) any more." That reply refers to a stale indicator subject the member never mentioned. Nothing was removed.
- **S16:** the stale-Undo refusal repeats its ending: "… Nothing was undone.). Nothing was undone."
- **Doc ordering:** as written, S19's "make it a 12" refers to the SMA 50 that S18 just added, not the SMA 10 deleted in S19. Retested by deleting the newest line: "SMA 12 isn't on that chart any more, so there's nothing to change."
- **Spend ledgers:** this is by design. Agent spend is not written to the shared $15 ledger (owner, Gate A option 1, `budget.py`). The Agent only reads it as a stop, so `site.spent_usd` stays $0 while the Agent spends against its own $5 cap.
- **Pre-existing, not Gate C:** on unlinked charts, a timeframe change (manual or Agent) is lost when switching layouts and back. Symbols are kept.
