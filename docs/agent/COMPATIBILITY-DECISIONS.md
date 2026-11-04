# UCT Agent — compatibility decisions

Owner's mission: **UCT Agent must never silently lose previously working functionality.**

This file is the ONLY way to remove or weaken a regression baseline. The capability-regression suite
(docs/agent/REGRESSION-SYSTEM.md) refuses, until a decision below names it:

| Key | Needed when | Enforced by |
|---|---|---|
| `### BASELINE:<intent or workflow id>` | a corpus intent or golden workflow is removed, a phrasing is removed from it, a phrasing gains a known gap, or its assertions (needs / deterministic plan / model plan / expect / steps) change | `tests/test_uct_agent_capreg_baseline.py` (against `app/src/agent/qa/capabilityRegression/data/baseline.lock.json`) |
| `### CAP:<capability name>` | a capability is removed, or its contract is weakened: `risk` confirm → local, `undo` exact → none, irreversible → reversible, a query becomes a change | `app/src/agent/qa/capabilityRegression/inventory.test.js` rail 2 (against `coverage/contract.json`) |
| `### BACKLOG:<capability name>` | a capability is added to the regression backlog (`data/regressionEntries.json`) after the initial inventory instead of shipping with a corpus intent or golden workflow | `inventory.test.js` rail 1 |

Adding intents, phrasings or workflows, and REMOVING a known gap (the fix landed), need no decision — re-lock with
`python tests/test_uct_agent_capreg_baseline.py --update` (it refuses to drop or alter an entry without a decision).

## Format

```
### BASELINE:<id> — <one line: what is removed / weakened>
- Date: YYYY-MM-DD
- Decided by: <the owner, or the owner's delegate named in the session> (an agent can draft, never decide)
- Why: <the product reason>
- Replacement protection: <what now protects the behaviour, or "none — the behaviour is intentionally retired">
```

## Decisions

_None yet. The initial baseline (2026-11-04) is the corpus, the golden workflows and the contract as committed with
PR "agent/qa/capability-regression"._
