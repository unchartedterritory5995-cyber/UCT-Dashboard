# I2 "Honest Imports": status record

Owner approval: 2026-11-01. Base: `origin/master` `f4fb9cab45`. Nothing is merged or deployed.

## Workstreams

| WS | Branch / PR | State |
|---|---|---|
| IC-1 contract | `docs/indicators-ic1`, draft PR #573 | Drafted. **ACK'd by agent-lead** 2026-11-01. ADR-004 is recorded on the Agent side once #573 merges. The delegating kind is SC-1 v1.2, scheduled after Sprint 1. |
| WS2 verdict | `feat/indicators-import-verdict` | `importVerdict.js` + 24 tests green, 5 mutations each red. **The PineBox wiring is held for Pine coordination** (`PINE-COORDINATION-import-verdict.md`). By owner ruling, Indicators does not edit `PineBox.jsx` until Pine either makes the change or authorizes Indicators to make it. #577 is not a finished user feature until the verdict is wired and tested in the import UI. |
| WS1 thinkScript weekly/monthly | `feat/indicators-ts-period-lift`, worktree `C:\UCT\ind-i2-ts` | Prepared. **Launch HELD:** the repo cap is 3 agents plus the integrator, and 6 sessions are active. agent-lead has passed the request to the owner. Owner decided **basis F** (2026-11-01). Launch is still held by owner ruling (capacity). The thinkorswim capture procedure is `docs/indicators/i2/THINKORSWIM-VALIDATION.md` on that branch (`b0e969014b`). |

## Saved definitions and alerts: what I2 changes (nothing)

- **`importVerdict` computes on READ and writes nothing.** `savedImportVerdict` is pinned by a
  frozen-input rail.
- **A thinkScript paste is saved as plain native formula text** with no thinkScript marker (audit PA1
  §2.2). That means:
  - a translator change cannot reach a saved definition;
  - its tree, hash, alerts and screens are byte-identical;
  - read-time gives it **no import claim** (`savedImportVerdict` → `null`), so it is never shown as
    "Exact".
- **TC2000 saved definitions** keep `compute.source`. Their verdict is recomputed from that text on
  read, and the stored tree is not touched. #516 (STOC/ATR) is untouched and on HOLD.
- **Pine:** unchanged (passthrough).
- **Production counts:** how many saved definitions are thinkScript-origin weekly/monthly imports
  needs `auth.db` `landing_events` (`import_accepted`, `dialect='thinkscript'`). **Not run.** This
  session has no production access, by owner ruling. The read-only, counts-only query is in audit
  PA1 §2.2.

## Pre-existing reds, measured on clean master `f4fb9cab45`

`components/screener/reachable.test.js` has 3 failures on master, identical on this branch. They are
not caused by I2:
- S4 expiry;
- "nothing committed is connected to nothing";
- the "cannot excuse" control.

⚠️ Once `importVerdict.js` is committed and still unwired, it joins the unreachable list. The PineBox
wiring (edit 1) is what makes it reachable, so the module and the wiring must land in ONE PR.
