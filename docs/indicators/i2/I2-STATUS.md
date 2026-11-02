# I2 "Honest Imports": status record

Owner approval: 2026-11-01. Base: `origin/master` `f4fb9cab45`. Nothing is merged or deployed.

## Workstreams

| WS | Branch / PR | State |
|---|---|---|
| IC-1 contract | `docs/indicators-ic1`, draft PR #573 | Drafted. **ACK'd by agent-lead** 2026-11-01. ADR-004 is recorded on the Agent side once #573 merges. The delegating kind is SC-1 v1.2, scheduled after Sprint 1. |
| WS2 verdict | `feat/indicators-import-verdict`, draft PR #577 | `importVerdict.js` (24 tests; 5 mutations each red). **Wired into the import box** in commit `7a503b07f3`, owner-authorized 2026-11-01 because the Pine integrator was unavailable. The change is additive and non-Pine only. Pine renders byte-identical to an origin/master capture (11 tests; 3 mutations each red). |
| WS1 thinkScript weekly/monthly | `feat/indicators-ts-period-lift`, draft PR #590 | Built in the lead session (basis F). The extra session stays on HOLD by owner decision. Evidence: 31 value tests + 7 Python parity tests, 6 mutations each red, full chart suite with no new failures. The thinkorswim capture (`THINKORSWIM-VALIDATION.md`) is still outstanding. |

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

✅ The PineBox wiring (`7a503b07f3`) makes `importVerdict.js` reachable. The `reachable.test.js` failures
are the same 3 as master.
