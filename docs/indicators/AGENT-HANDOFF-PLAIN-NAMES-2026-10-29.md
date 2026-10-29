# Agent handoff — plain derived names (PR #500), 2026-10-29

**From:** Indicators. **To:** the Agent session. **Status:** #500 is a draft and does not merge until the
Agent session ACKs this note and lands (or authorises) the test updates below. No Agent-owned file is
changed by #500.

## What changed on the Indicators side

`builder/authoring/derivedName.js::nameOfTree(node, prec, mode)` now defaults to `mode = 'plain'`:

| Formula | Old derived name (`'formula'`) | New derived name (`'plain'`) |
|---|---|---|
| `(ema(close,9) - ema(close,20)) / ema(close,20) * 100` | `(EMA 9 − EMA 20) ÷ EMA 20 × 100` | `EMA 9 vs EMA 20 %` |
| `ema(close,9) > ema(close,20)` | `EMA 9 > EMA 20` | `EMA 9 above EMA 20` |

`nameOfTree(..., 'formula')` still produces the old wording byte for byte, and `namingSnapshot` treats a
name equal to either wording as automatic.

## Saved definitions: compatibility

- A stored definition's `meta.name` is never rewritten. No migration runs, and nothing changes on load or
  open.
- An old auto name in the formula wording still counts as automatic. On the member's next maths edit it
  moves to the plain wording instead of freezing as if the member had typed it.
- A name the member typed is untouched.

## The 8 red assertions, classified

### 7 are text expectations only. Agent behaviour is unchanged.

`agent/receiptView.js:32` masks a name as `your indicator` when `looksLikeFormula(name)` is true. The new
derived name is not formula-like, so the same code now prints the name:

```
expected: Done — created your indicator and added it to Chart (QQQ), in its own pane.
received: Done — created your “EMA 9 vs EMA 20 %” indicator and added it to Chart (QQQ), in its own pane.
```

This is the owner's stated goal ("no formulas in chat", backlog `indicator-formula-derived-names`).

| File | Test | Line |
|---|---|---|
| `agent/agentIndicatorCreate.test.jsx` | C1 · the model PROPOSES it → no card | `DONE` const, :114 |
| ″ | C1 · the model APPLYING it gives the same result | `DONE` |
| ″ | C2 · its Save with a name the member never said | `DONE` |
| ″ | C2 · its Save without the chart add | `DONE` |
| ″ | C2 · its Save with the chart add | `DONE` |
| ″ | C3 · a board of four charts … the pick builds | :172 (NVDA string) |
| `agent/agentOperatorLive.test.jsx` | L4 · the owner's custom indicator, end to end | :251 |

**Suggested update:** expect `Done — created your “EMA 9 vs EMA 20 %” indicator and added it to Chart
(QQQ), in its own pane.` (and the NVDA variant at :172). Alternatively, assert on the structure ("created
your", "and added it to Chart (QQQ)") so the receipt is not pinned to the builder's wording.

### 1 is a stale fixture, and it exposes a real follow-up decision

`agentIndicatorCreate.test.jsx` C4 (`a name the member already has: stops at a ready draft`) seeds an
existing indicator named `DRAFT_NAME = '(EMA 9 − EMA 20) ÷ EMA 20 × 100'`. Its comment calls this "the name
the builder's engine gives this formula". The new build is named `EMA 9 vs EMA 20 %`, so
`indicatorAuthoring.js:731`'s collision check (`ownNames().includes(st.name)`) does not fire. The R1 stop is
skipped, and the test sees no "Not saved or applied yet" line.

- **The check itself is unchanged and still correct.** Setting `DRAFT_NAME = 'EMA 9 vs EMA 20 %'` restores
  the test's intent: a member who already has an indicator with the derived name.
- **The real-world consequence, which is the Agent's decision:** a member who saved this formula before
  #500 has it under the old formula name. Asking the Agent to build the same thing again no longer hits the
  name-collision stop, and creates a second indicator named `EMA 9 vs EMA 20 %`. That is not a data loss or
  a broken save, but it is a change in when the Agent stops.
  - If the Agent wants the old stop to still catch legacy names, it can also compare against the legacy
    wording, `nameOfTree(tree, 0, 'formula')`, which is already exported.
  - Indicators can add a small named helper (e.g. `legacyDerivedName(model)`) if the Agent prefers not to
    call `nameOfTree` directly. Ask and it ships in #500.

## Owner ruling, 2026-10-29

1. **The 7 receipt wording changes are APPROVED.** The receipt names the indicator.
2. **C4: preserve duplicate detection for existing saved indicators that carry legacy auto-generated,
   formula-style names.**
   - Prefer canonical definition identity, or normalised formula equivalence, over matching display names.
   - A member who explicitly asks for a distinct copy still gets one.
3. **The Agent session owns** the Agent test files and the duplicate-detection logic. Indicators does not
   edit Agent-owned files without coordination.
4. **#500 does not merge** until the Agent compatibility change is done and tested.

### Proposed split

**Indicators** adds, in #500, a pure helper on the authoring side:
`sameMaths(defA, defB) -> boolean`.

- It compares the definitions' output trees after `parse.js::canonicalise`.
- It ignores names, labels, colours, ids and presentation.
- It compares output trees by position, plus the default values of their inputs.
- It does not change any stored document.
- It is railed by tests covering both name wordings, an explicit name, a different length (must be false),
  and swapped `ema(close,9)` vs `ema(9)` spellings (must be true whenever the canonical trees match).

**The Agent** uses it in `indicatorAuthoring.js`'s R1 stop:

- "you already have this indicator" fires when any saved definition has the same maths, whatever its name.
- The current exact-name check stays, as a second reason.
- An explicit "make a copy" / "another one" request bypasses the stop. That cue wording is the Agent's call.
- The Agent updates C4, plus a new case: a legacy formula-named saved indicator plus the same request
  equals a stop.
- The Agent updates the 7 receipt assertions.

The Agent session confirms or amends this split before either side builds.

## What Indicators needs back

1. An ACK that the 7 receipt changes are wanted (the named indicator in the receipt).
2. Agreement on the split above, or an amendment. Item 1 is now approved by the owner, so the Agent session
   only needs to land it.
3. The Agent branch with the C4 stop and the test updates, landed together with #500 once both are green.

#500 will also be rebased onto master after #497 and #498 release. Before it merges, the plain names are
re-checked on #498's new nodes (`supertrend`, `if`, `na`).
