# Deleted outputs and key reuse: findings and a proposal (2026-11-02)

**Read-only investigation of `2cd4c3839c`, plus a proposal. Nothing has been implemented.** Line numbers are dated claims; re-read before acting.

## How an output is identified today

An output's only identity is its `key`: a string matching `^[A-Za-z][A-Za-z0-9_]*$`, chosen by the model or the member (`authoring/patchSchema.json`, `outputKey`). There is:

- no generated id;
- no generation number;
- no record of keys that have been retired.

Rename changes the label only, never the key.

`applyPatch.js` `add_output` checks for duplicates only against the rows that exist now. So a removed key can be taken again later, and also within one patch (remove "fast", then add "fast").

## What binds to a key, and what deleting the output does

| Dependent | Binds by | On deleting the output |
|---|---|---|
| Colour modes, fills, foreign paints, table cells (same definition) | key | **refused** (`output:referenced`) |
| The output's own markers, paints and helpers | the row | removed with it |
| Draft alert and info-value requests | key | removed, with a `requests-cleared` change entry |
| `scanKey` (which output the scan reads) | key | **moved silently** to the first remaining output; no change entry |
| Another indicator's source (`@<instanceId>::<plotKey>`, `sourceRef.js`) | instance + key | **left pointing at the key**; severing happens per instance, never per output |
| Header info values `{instanceId, plotKey}` | instance + key | left pointing at the key |
| Stored alerts `u_<id>.<plotKey>` (`alert_user_series.py`) | address + latest version | the rev bump notifies the owner; the alert is refused while the key is missing |
| Scan results | tree hash (`result_identity`) | unaffected by keys |

## How a dependency silently reconnects

1. **Another indicator's source, or an info value.**
   - Indicator B reads `@A::fast`. The member removes "fast" from A, and B is left pointing at a missing column.
   - In a later edit, a new, unrelated output is added to A under the key "fast" (the model may pick the same short name).
   - B now reads the new formula without anyone choosing it.
   - Every step was confirmed by reading the code. How B renders while "fast" is missing was not verified.
   - The repo already records this as an `it.todo` in `p2x.sourceref.truth.test.js`: "DISCLOSED, NOT FIXED".
2. **Stored alerts.**
   - Saving without "fast" bumps the rev and sends a notice, and the alert is then refused.
   - Saving again with a new "fast" bumps the rev, and the alert re-arms against the new formula.
   - The member is notified that the maths changed, but the alert re-binds to a different line without the member choosing it.
   - Whether the notice says "replaced" was not verified.

## Proposal, in order

### 1. Retire keys per definition (recommended first)

**Format.** An additive field in the stored definition, e.g. `retiredOutputKeys: [...]`.
- It is appended when an output is removed.
- It is carried forward on every save.

**JS.** `applyPatch.js` `add_output` and `create` refuse a retired key with `output:retired-key`. The model's repair diagnostic suggests a fresh key, e.g. `fast2`. The builder's own add path does the same.

**Python.** `user_definitions.save` refuses a version that introduces a key retired in the previous version. That way a hand-written or imported document cannot get round the rule, and the client is not trusted.

**Existing definitions.** Unaffected: the list starts empty, and keys already in use stay valid.

**Effect.** This closes both reconnection paths above without touching any consumer, because the old key can never come back.

**Rails:**
- the `it.todo` becomes a passing test;
- a retired-key reuse is refused in each lane;
- a cross-lane fixture;
- an alert on a retired key stays refused for good.

**A pitfall to decide.** The list must survive a "rename definition" and an import round trip; check every door that writes a definition.

### 2. Disclose the `scanKey` move

Record a change entry when the scan output moves. This is a one-line JS change with no format change. It makes the read-back say "the scan now reads X", instead of moving it silently.

### 3. Give each output a provenance id (the full answer; owner decision)

A per-output `uid`, with sources, info values and alert addresses bound to `key#uid`.

**Cost:**
- source refs, info values, alert addresses and the alert rev migration all change;
- existing saved definitions and alerts need a backfill.

This is a stored-format change across both lanes, and the `it.todo` already marks it as an owner-review item. It should not be started without that review.

## What happens to a member today, in plain words

- If you delete a line that another indicator or alert uses, that user is left waiting.
- If you later add a different line with the same name, the user starts reading it without being asked.

Option 1 stops the second half. Today, nothing ever tells the member the first half happened; that needs a separate change (a "this line is used by …" warning on delete). It is listed in the backlog.
