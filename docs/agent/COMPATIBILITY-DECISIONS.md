# UCT Agent — compatibility decisions

Owner's mission: **UCT Agent must never silently lose previously working functionality.**

This file is the ONLY way to remove or weaken a regression baseline. The capability-regression suite
(docs/agent/REGRESSION-SYSTEM.md) refuses, until a decision below names it:

| Key | Needed when | Enforced by |
|---|---|---|
| `### BASELINE:<intent or workflow id>` | a corpus intent or golden workflow is removed, a phrasing is removed from it, a phrasing gains a known gap, or its assertions (needs / deterministic plan / model plan / expect / steps) change | `tests/test_uct_agent_capreg_baseline.py` (against `app/src/agent/qa/capabilityRegression/baseline/baseline.lock.json`) |
| `### CAP:<capability name>` | a capability is removed, or its contract is weakened: `risk` confirm → local, `undo` exact → none, irreversible → reversible, a query becomes a change | `app/src/agent/qa/capabilityRegression/inventory.test.js` rail 2 (against `coverage/contract.json`) |
| `### BACKLOG:<capability name>` | a capability is added to the regression backlog (`baseline/regressionEntries.json`) after the initial inventory instead of shipping with a corpus intent or golden workflow | `inventory.test.js` rail 1 |

Adding intents, phrasings or workflows, and REMOVING a known gap (the fix landed), need no decision — re-lock with
`python tests/test_uct_agent_capreg_baseline.py --update` (it refuses to drop or alter an entry without a decision).

## Format

A decision counts only when it is OUTSIDE a fenced code block and has:
- a `Date:` (YYYY-MM-DD);
- a named `Decided by:` (not a `<placeholder>`);
- a `Binds:` line naming exactly the change it allows. The failing rail prints the value to paste:
  - BASELINE: the locked entry's digest -> the current one;
  - CAP: the pinned contract entry -> the live one;
  - BACKLOG: `0000000000000000->` the backlog entry.

A decision allows that one change. The next weakening of the same id needs its own decision. The baseline is checked
against the lock in this tree AND against the lock on master (merge base), so editing the lock by hand does not help.

```
### BASELINE:<id> — <one line: what is removed / weakened>
- Date: YYYY-MM-DD
- Decided by: <the owner, or the owner's delegate named in the session> (an agent can draft, never decide)
- Binds: <the digest pair the failing test prints, e.g. 1a2b3c4d5e6f7a8b->9c8d7e6f5a4b3c2d, or …->removed>
- Why: <the product reason>
- Replacement protection: <what now protects the behaviour, or "none — the behaviour is intentionally retired">
```

## Decisions

_The initial baseline (2026-11-04) is the corpus, the golden workflows and the contract as committed with
PR "agent/qa/capability-regression"._

### BASELINE:grid.add-count.reuses-one — the four "add …" phrasings re-worded without "add"
- Date: 2026-11-13
- Decided by: owner — direct answer to the Program Lead in the Lead session, 2026-11-13 ~21:10Z ("Approve"), and an explicit instruction in that session for the Lead to record it (~22:30Z); recorded with owner directive D14 ("adding charts must never silently replace existing charts")
- Binds: 28ebf087087f88af->68e6f6f49cda2b5e
- Why: owner 11-13 (H14 safety hotfix), in the owner's words: "additive requests must never silently replace or remove existing charts. Explicitly requested replacements remain permitted, subject to the existing chart-targeting safety rules." This decision does not weaken any existing safeguard. An "add" with a count or grid shape on a board that already has charts now asks (add N more beside them / replace my N — replace shown first as a card) instead of re-symbolling the existing charts. Supersedes the 11-04 GRID-REUSE reading for "add" phrasings only.
- Replacement protection: the same plan and final state are kept with non-add phrasings ("make a 2x2 of …", "set up a 2x2 grid of …", "show … on four charts", "four charts for …"); the add phrasings are covered by agentAddNeverReplaces.test.jsx, agentMultiResymbol.rail.test.jsx and the updated agentGridReuse #1 (asks first; Replace + apply gives the same 4 reused charts with exact Undo).

### BASELINE:grid.add-count.reuses-two — the same change, second family
- Date: 2026-11-13
- Decided by: owner — direct answer to the Program Lead in the Lead session, 2026-11-13 ~21:10Z ("Approve"), and an explicit instruction in that session for the Lead to record it (~22:30Z); recorded with owner directive D14
- Binds: ecaa36372f92d625->f120df6120320124
- Why: as BASELINE:grid.add-count.reuses-one.
- Replacement protection: as BASELINE:grid.add-count.reuses-one.

### BASELINE:GW-19.daily-charts-each-with-50sma — a requested symbol already shown is reused, not duplicated (4 charts → 3; sameSize → tiled + exact sizes)
- Date: 2026-11-14
- Decided by: owner, D18 item 3 (typed to the Lead, 2026-11-14T23:10:56Z), verbatim: "3. EXISTING CHART REUSE: When a user requests a set of charts and one of those symbols is already displayed, reuse that chart by default rather than creating an unnecessary duplicate. Preserve the existing chart unless the user explicitly authorizes replacing it. Explicit requests for another or duplicate chart should create a new one." Signed by the Lead under owner directive D19 (the Lead may sign only the two #1275 reuse baseline entries, after AUDIT's T2), following AUDIT's T2 GO on #1275 at e70f02bedf.
- Binds: 232ab142de25f667->3ebe06e6aba2a583
- Why: on board ONE (c1 = NVDA daily), "open daily charts for AAPL, MSFT and NVDA, each with a 50 SMA" now reuses c1 as the NVDA chart instead of adding a duplicate NVDA: 3 charts (c1 + AAPL + MSFT) instead of 4. c1 keeps its identity, symbol and settings. It is re-tiled (arrangement, not replacement) and gains the 50 SMA the member asked for (additive, named in the receipt, undone exactly). With 3 charts the tiles are 12x10, 12x10, 24x10, so `charts.sameSize` cannot hold; the receipt says "re-tiled" (not "evenly") unless every cell is equal (38438a3076).
- Replacement protection: GW-19 now pins `charts.count` 3, `symbolSet`, `keepsIds ["c1"]`, `indicatorsEach.except []`, `charts.tiled: true` (no overlap, no gap) and `charts.sizes ["12x10","12x10","24x10"]` (exact, order-free), plus `restored` on undo. A copy is still made on explicit copy intent (agentChartReuseD18.test.jsx); the truthful receipt is pinned by agentGridEvenlyReceipt.test.js.
- Note, v2 L05 (app/src/agent/__fixtures__/program/v2-acceptance.json, not in the capreg lock, so no rail requires a decision): under the same owner decision, "prune amd out of Momentum and bring up what remains" reuses the chart already showing NVDA (expect.charts 2 → 1), now also pinning `symbol {c: NVDA}` and the reuse receipt "NVDA is already on your board — I used that chart".
