# r8-indicator-style: indicator settings and appearance through metadata (family 3)

Local branch, not pushed. Base: ship-5 (stacked; ship-5 6ff0dc666d merged in). Evidence: LOCAL native Windows Node v24, jsdom,
BROWSER-MOCK-MODEL / SIMULATED (a scripted plan, built from each indicator's own metadata, sent only when the model is asked).

## What this branch is

**No product code changes.** The capabilities already exist (`indicator.update`, `indicatorStyle.set`, `indicator.hide` /
`indicator.show`); this branch proves them across the WHOLE built-in catalog, driven only by each definition's own metadata,
through the REAL panel, and pins it.

## Evidence

- `agentIndicatorStyle.test.jsx`, a sweep over every catalog indicator (53, non-vacuity asserted ≥ 50). For each, read from its
  own definition / `styleOptionsOf` — never a per-indicator rule:
  - a number setting one step from its default inside its own min / max (read back from the instance's inputs);
  - a choice setting set to another of its own options (`[value, label]` pairs);
  - an on/off setting flipped;
  - EVERY colour its Inspector offers, by its own label (read back from the input that colour writes); histogram up / down
    colours where it has them;
  - line width where the Inspector (or its own Line width setting) offers it; otherwise an honest refusal ("has no line
    width setting") and nothing changes;
  - hide, then show.
- Held-out phrasings (`agentIndicatorStyleHeldOut`, 6, committed first in 664ae631c9), said as written: 6/6.
  - Oracle note: i4 names the Bollinger setting `stdDev`; the definition's key differs, so the test resolves it through the
    definition (the input whose key/label says "dev" / "mult"); the frozen file is unchanged.
- Findings the sweep surfaced (behaviour, not defects): "make it red" on an indicator with several colours asks which (correct,
  names them); most built-ins have no line-width control (honest refusal).
- Rows this evidences (status doc, owed on exec-gen-1): C2-026 toggle setting, C2-031 histogram up/down colours.

## Full suite

Full 4-shard vitest at decbc5079d (LOCAL native Windows Node v24, BROWSER-MOCK-MODEL / SIMULATED): 9361 passed, 0 failed, 6 skipped (2274+3 / 3110 / 2092+1 / 1885+2). pytest not run (C:\data rule): owed to AUDIT / CI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
