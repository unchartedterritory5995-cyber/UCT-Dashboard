# Gate B — budget ownership audit and options (2026-10-13)

The owner asked whether the $15/day budget can hold "Agent ≤ $5, combined ≤ $15, no increase, no reduction of existing allocations, no silent overruns". **It cannot, as stated.** The constraints conflict arithmetically. The options are below; the choice is a product decision.

## 1. What the $15 actually covers (it is NOT site-wide)

The "$15" is the catalyst ledger (`api/services/catalyst/cost_guard.py`, table `catalyst_cost_log` in catalysts.db). It is split by lane:

| Lane | Limit | Features that record into it |
|---|---|---|
| Interactive | $4 | Formula assistant `/propose` and `/converse` (`concierge:<uid>`); indicator vision (`indicator-vision:<uid>`) |
| Background | $11 | Catalyst synthesis; curator; hunter; rule learner; calendar sector reads (member-triggered, but charged as background); call recap and sentiment (member-triggered, but charged as background) |

**Not covered by the $15.** These keep their own caps, which were already in place before this work:

| Group | Features | Their own cap |
|---|---|---|
| Search and research | AI Search synthesis / agent / deep / personal / dossier / briefings | $5 / $15 / $10 / $25 / $3 / per-surface cap |
| | Ticker explain | $10 |
| | Comparison explain | $10 |
| Narrative and explanation | Schwab market narrative | $5 |
| | Flow explain | $5 |
| | Call-recap warmer | $10 |
| | Theme engine | $5 |
| | Pattern vision | $10 |
| Notebook | Notebook AI | $25, atomic |
| Compass | Compass chat | $ cap off by default |
| | Compass reviews and verdicts | count limits only |
| Search provider | Perplexity, all callers | 500 calls a day; no dollar cap |
| Voice | Voice | monthly per-member quotas; several voice paths have **no $ cap** |
| No dollar cap at all | Company about / peers; earnings analysis; an unauthenticated earnings debug ping; transcripts (no auth); Model Book / stock brief; community ask; desk / Discord scheduled jobs, including image generation | none |

Full table with file:line references: produced by a read-only audit (summary in the Gate B report).

**Not in scope here:** I have not changed or capped any of these.

**Worth noting:** the uncapped paths reachable by members and the unauthenticated ones are a separate cost and security finding the owner may want to schedule.

**Wording fixed** (commit after `304c09caa6`): code, messages and docs now say "the shared $15 AI budget", never "site-wide".

## 2. How the shared $15 is enforced today

- **Floor checks.** `may_synthesize` and `may_member_spend` compare spend *already recorded* with the limits. Cost is recorded only after a call returns.
- **Overshoot.** Each lane can overshoot by every call in flight when it crosses its line.
  - The interactive lanes allow one call per member at a time, so the interactive overshoot grows with the number of members calling at once.
  - The sector-read and call-recap pools have 2 workers each.
- **The two lanes already use all $15:** $4 + $11. There is no unallocated headroom by design ("no borrowing", owner 2026-10-07).
- **Measured use:** background spend on trading days was $9.6–11.3 (owner note, 2026-10-07). It is already near its $11 limit.

## 3. Why the policy cannot hold as stated

Agent ≤ $5, combined ≤ $15, and no reduction of the $4 and $11 allocations cannot all hold at once:
- The $4 and $11 already add up to $15.
- If Agent spend counts toward the $15, every dollar the Agent spends is a dollar the other lanes can no longer reach on a full day.
- The only way to guarantee no reduction is to give the Agent $0.

## 4. Options

| | What changes | Agent max | Effect on existing features | Change size |
|---|---|---|---|---|
| **A — the Agent shares the interactive $4** | The Agent records into the shared ledger as an interactive lane (`uct-agent:`). The $4 / $11 sizes don't change. The Agent's reservations must also be visible to the builder's floor check. | ≤ $4, shared first-come with the indicator builder and vision | The builder and vision can be crowded out by Agent use on busy days. Background is untouched. Combined ≤ $15 holds (within the existing floor-check overshoot of the other lanes). | Small–medium: new lane prefix in `cost_guard`; Agent writes reservation/settle rows into `catalyst_cost_log` |
| **B — the Agent borrows idle headroom** | Agent spend counts toward the $15 total. The Agent is admitted only while total + its open reservations + this call ≤ $15. | Up to $5, if headroom exists | On heavy days, Agent spend earlier in the day makes the other lanes' total check trip sooner, which shrinks their effective allocation. Breaks the 2026-10-07 "no borrowing" rule. | Medium (same plumbing as A) |
| **C — reallocate** | For example $4 interactive / $5 Agent / $6 background; or a $9 interactive pool shared by builder, vision and Agent, with $6 background. | $5 | Background drops from $11 to $6, so synthesis pauses most trading afternoons. | Medium (shared `cost_guard` change) |
| **D — keep the Agent separate (as built), labelled honestly** | Nothing further. The Agent has its own atomic $5 and stops when the shared $15 is spent. | $5 | None. Combined maximum across these features is $15 + $5 = $20 per day. This is not "combined ≤ $15". | None (built, tested) |
| E — raise the shared cap to $20 | $4 / $5 / $11 | $5 | None | Excluded by the owner ("no increase") |

**Recommendation.**
- If "combined ≤ $15" is firm, **A** is the smallest correct change that touches no existing allocation size. Its cost is that the Agent and the indicator builder share $4.
- If protecting the builder and synthesis matters more, **D** is correct as built and only needs the policy restated: "Agent ≤ $5, separate from the shared $15".
- I recommend against B (it silently reverses the no-borrowing rule) and C (synthesis outages).

## 5. Verification already done for the Agent's own ledger (applies to A, B or D)

Tests are in `tests/test_uct_agent_spend_limits.py`, 26 in total:
- **Concurrency:** 40 threads against $5 at $0.20 each give exactly 25 admitted.
- **Reservation accounting:** settle to actual frees the difference; missing usage or a timeout charges the worst case; a provider error releases the reservation and gives the call back.
- **Delayed settlement:**
  - a reply after ET midnight charges the day the call was admitted;
  - settle is idempotent, and a release after settle can't un-charge;
  - a failed settle leaves the worst case counting.
- **Restarts:** a second process sees the first one's spend.
- **Fails closed:** an unreadable Agent store or catalysts.db refuses the paid call. Instant commands keep working (panel test).
