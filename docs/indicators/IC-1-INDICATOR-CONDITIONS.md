# IC-1 — Indicator conditions for the Agent (v1.0-draft)

| | |
|---|---|
| **Owner** | Indicators |
| **Consumers** | agent-sc, through one delegating SC-1 kind (version number is agent-sc's to choose); agent-qa; agent-rs later |
| **Depends on** | MD-1 (envelope, gateway, budgets) |
| **Status** | **DRAFT**, 2026-11-01. Approved for drafting by the owner (Milestone I2). Not yet acknowledged by agent-lead; recorded on the Agent side as ADR-004 once it is. |
| **Measured on** | `origin/master` `f4fb9cab45`. Every `file:line` here is a dated claim; re-read the code before relying on a line number. |

## 1. The rule in one sentence

An indicator condition is a **saved indicator definition** whose scan tree yields true/false. Its
results come **only** from the nightly definition sweep through
`GET /api/scans/definition-results`. There is no second condition language, condition format or
evaluator anywhere in the Agent program.

## 2. What "condition" means

- **Format:** the stored definition document (`definitions/1`; see
  `docs/indicators/AGENT-CONTRACT-P2-2026-10-27.md`). Its `compute.ast` is the scan tree.
- **It is a condition** when `scan_definition.assert_scannable(definition)` accepts it and its
  `yields` is boolean. A numeric-yield definition is a value, not a condition. IC-1 v1.0 refuses it
  (§6) and never thresholds it on the Agent's behalf.
- **Authoring:** a new condition is created only through the existing Indicators authoring paths:
  the builder and `agentMutations` / `agentSeams` (the Agent's only write seam). The Agent never
  writes a definition document directly, never calls `PUT`/`POST /api/user-definitions*`, and never
  composes an AST.

## 3. Identity — the key every result is read by

- **Use `user_definitions.result_identity(definition)`. Never the bare `ast_hash`.**
  - Semantics 1 gives `sha256:<64 hex>`. Semantics 2 gives `sha256:<64 hex>~s2`
    (`SEMANTICS_IDENTITY_SUFFIX`, `api/services/user_definitions.py`).
  - Results are filed under that identity by the sweep (`scan_evaluator.definitions_to_sweep`,
    which also dedupes by it).
  - The browser twin is `definitionSemantics.js::resultIdentity`. The two are held equal by
    `tests/fixtures/ast/semantics_result_identity.json`.
- **Why this is non-negotiable:** keying by the bare hash silently reads nothing for every
  semantics-2 definition. That is live defect **N11** (UI screen alerts subscribe by bare hash and
  never fire). A consumer that "works in testing" on a semantics-1 fixture is still wrong.
- **The query parameter is named `def_hash` for history.** Its value is the result identity.
- **Validate before sending:** `user_definitions.RESULT_IDENTITY_RE`. A value that fails it is
  refused before any read (§6).

## 4. The read

```
GET /api/scans/definition-results?def_hash=<result identity>&tf=D&as_of=<session>&limit=<=50
```

- **Router:** `api/routers/scan_results.py`. It needs a paid member (`require_paid`) and applies the
  member's entitlement cap once.
- **Server-side callers** go through the same functions the route uses (`scan_store.coverage`,
  `scan_store.hits_for`), behind the MD-1 gateway, rather than issuing HTTP to themselves.
  - Never import `scan_evaluator` from a request path. The off-request-path rail
    (`tests/test_scan_evaluator_off_request_path.py`) forbids it.
- **`tf`:** IC-1 v1.0 is daily only (`scan_store.SCAN_JOIN_TF = "D"`, the sweep's timeframe).
- **Which session:**
  - The latest one this identity was swept for is `scan_store.latest_covered_as_of(identity, "D")`.
  - When that is `None`, the answer is **not-run** (§5). Never fall back to another identity, an
    older semantics, or a different definition.

## 5. Outcomes — five, never collapsed

| Outcome | Where it comes from | Meaning | MD-1 envelope |
|---|---|---|---|
| **not-run** | response `status: "not-run"`, `coverage: null` (or `latest_covered_as_of` is `None`) | Nobody evaluated this identity for this session. **This is not zero hits.** | `status: unavailable`, `freshness: unavailable`, `data: null`, note: "this indicator has not been scanned for <session> yet" |
| **evaluated** | `coverage.evaluated` | Symbols the sweep handed to the tree | `coverage.evaluated` |
| **answered** | `coverage.answered` | Symbols the tree gave a definite true/false for | `coverage.answered` |
| **dropped** | `coverage.dropped` (+ `dropped_symbols`) | Symbols lost to an error or missing data | `coverage.dropped`. Non-zero means `status: partial`, and the dropped symbols are named in `notes` (up to the receipt's `dropped_listed`). |
| **unavailable** | `coverage.not_computable` | The tree could not be computed for that symbol: not enough history, a value it reads is missing. **Not "false".** | `coverage.not_computable`. Non-zero means `status: partial`. When `answered == 0` and `not_computable > 0`, the note says "a gap in what we hold, not a quiet market". |

Further rules:
- **The arithmetic must close:** `evaluated == answered + dropped + not_computable`. The sweep refuses
  to write a receipt that does not close (`scan_evaluator._assert_coverage_closes`). A consumer that
  receives one that does not close returns `unavailable` and never presents the rows.
- **`withheld` / `withheld_reason`** (entitlement cap) sit **beside** the four. They are never folded
  into them, and are surfaced in `notes`.
- **Truncation:** `truncated` / `truncated_nightly` mean the page is short of the hits. Set
  `status: partial` and say so. `total_matches` is the count of stored nightly hits for that identity
  and session (`scan_store.hits`), never the page length. The receipt's `answered` counts true AND
  false answers, so it is not a match count either.

## 6. Refusals (`status: refused`), each named

| Code | When |
|---|---|
| `ic1:identity` | The value is not a legal result identity (`RESULT_IDENTITY_RE`) |
| `ic1:not-a-condition` | `assert_scannable` refuses it, or its `yields` is not boolean |
| `ic1:consumer` | `user_definitions.consumer_refusal("sweep", requirements)` is not `None`. The definition carries a requirement (for example `window_dependent`) the sweep does not run. |
| `ic1:tf` | Any `tf` other than `D` in v1.0 |
| `ic1:foreign` | The definition is neither the member's own nor shared with them. The Agent reads only what the member can read through `/api/user-definitions`. |

A refusal is a sentence the Agent shows. It is never retried under another key or approximated.

## 7. Freshness

- **Class: `periodic`.** The sweep runs nightly at 05:00 ET (`scan_evaluator.SWEEP_HOUR_ET` /
  `SWEEP_MINUTE_ET`) over the closed daily session.
- **`as_of`:** the receipt's session (`YYYYMMDD`), expressed in MD-1 as that session's regular close
  (16:00 America/New_York, in UTC). It is never the fetch time and never `swept_at`.
- **`stale: true`** when the session read is older than the latest session the sweep has covered for
  any definition. The answer is then "as of <session>", never "today".
- **The live tier is out of scope for v1.0.** The live sweep is dark (`SCAN_LIVE_SWEEP_ENABLED` unset).
  If the response carries rows with `in_nightly: false`, IC-1 v1.0 ignores them and adds the note
  "live hits not included". It never relabels the answer `live`. A later version may add them as a
  separately labelled tier.

## 8. Reading definitions (read-only)

- **List / get:** `GET /api/user-definitions`, `GET /api/user-definitions/{def_id}`, as the member.
- **Never written by the Agent** except through `agentMutations` / `agentSeams`.
- **Never** `PUT`, `POST`, `DELETE`, `fork`, `share` or `install` from Agent code.
- **Saved definitions are read as stored.** IC-1 never re-derives, upgrades or migrates a definition.
  - A definition that reads on a legacy calculation (for example a TC2000 `STOC` import while #516 is
    on hold) is answered on the calculation its alerts and scans already use.

## 9. Duplicates and "is this the same indicator?"

- **Browser:** `app/src/components/chart/builder/authoring/sameMaths.js` →
  `mathsVerdict(a, b)` ∈ `same | different | unknown`. **`unknown` is treated as `different`.**
- **Server:** two definitions share results if and only if their `result_identity` values are equal.
  This is what the sweep dedupes on.
- **Never** compare names, descriptions, source text or bare `ast_hash` for this.

## 10. Budgets

MD-1 §5 applies unchanged:
- one condition read per turn;
- at most 50 rows returned;
- coverage counts are never capped.

An IC-1 read makes no provider call (`provider_calls: 0`): it reads stored sweep results only.

## 11. What IC-1 forbids

- A condition language, filter DSL or AST builder in Agent code.
- Evaluating a tree in the Agent: no import of `ast_interpret`, `scan_evaluator` or the JS
  interpreter for scanning.
- Reading or writing `scan_hits` / `scan_coverage` directly.
- Re-keying, migrating or "fixing" saved definitions, alerts or screen subscriptions. N7 and N11 are
  owned by Indicators and Screener and are not part of IC-1.
- Treating `not-run`, `not_computable` or `dropped` as false.

## 12. Ownership

- **Indicators owns:** this document, the definition format, `result_identity`, the AST engines and
  `sameMaths`.
- **Screener owns:** `api/services/screener/**`, including `scan_store`, `scan_evaluator`,
  `screen_alerts`. These evaluate Indicators trees, so a change there needs both owners.
- **agent-sc owns:** the delegating SC-1 kind that wraps §4–§7.
- Indicators stays EXTERNAL in `docs/agent/program/OWNERSHIP.md`.

## 13. Conformance (for agent-qa)

A consumer conforms when its tests show each of these:

1. **Key:** a semantics-2 definition is read under `~s2` (the bare-hash read is asserted to return
   nothing).
2. **not-run:** answers `unavailable`, never an empty `ok`.
3. **Partial:** `not_computable > 0` and `dropped > 0` each produce `partial` with the counts intact.
4. **Arithmetic:** a non-closing receipt answers `unavailable`.
5. **Refusals:** a numeric-yield definition is refused `ic1:not-a-condition`.
6. **No live tier:** live-only rows are excluded and noted.
7. **Read-only:** no write route is reachable from the kind; an AST of Agent code proves no import of
   `ast_interpret` / `scan_evaluator`.

## 14. Changes

Versioned here. Changes go through the MD-1 §8 procedure. Indicators proposes; agent-lead records.
