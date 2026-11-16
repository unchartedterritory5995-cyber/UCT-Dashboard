# U15 Phase B: libraries (2026-11-16)

The unit has two halves, both approved by the owner on 2026-11-16 in the coordinator's session.
- **(B) the engine.** A Pine v5 library imported by a v6 script. U15 measured 15 such scripts, all
  refused `pine:module`.
- **(A) the promotion.** Re-grade the held-out library versions on engine 61, update
  `tools/pine_library/promotion_allowlist.json` to the new truth, and write the owner's runbook. Not
  performed here.

No library source is in this repository. Every library in the rails is a fixture written from scratch.
The graded sources are in the out-of-git scratch store U15 measured with
(`%LOCALAPPDATA%/uct-vendor-batch/pine-libraries-scratch`, 83 entries). Each is pinned by its sha256.

## What the reference states about a v5 library inside a v6 script

Nothing that settles how it runs. Read on 2026-11-16:
- **The v6 reference.** `import` says only that a script imports a published library by
  `{username}/{libraryName}/{libraryVersion}`: "Used to load an external library() into a script and
  bind its functions to a namespace". `library`, `export`, `type` and `method` say nothing about
  versions.
- **The User Manual, Libraries.** It says a library's own source "includes the `//@version` compiler
  annotation to specify the Pine Script version", and that "Scripts do not automatically use the
  latest version of a library". That second sentence is about the LIBRARY's version number, not the
  Pine version. It has no sentence on importing a library written in another Pine version.
- **The migration guide, "To Pine Script version 6".** It does not mention `import`, nor a library of
  another version. It does list every construct whose meaning changed from v5 to v6.

So, per the coordinator's rule (2026-11-16), **cross-version linking needs a capture before it
serves.** Two gates enforce it, and the probe below asks the general question.

## (B) What the engine does now

`app/src/components/chart/engine/ast/pineLibraryVersion.js`, called by the linker
(`pineLibraries.js`). A v5 library inside a v6 script is linked only when BOTH hold:

1. **The version is on the admission table** (`ast/pineLibraryCrossVersion.json`).
   - A row is allowed only for a `promote` version of the promotion allowlist whose every newly
     attaching v6 importer grades MATCH host-only. That is the coordinator's rule: U15's promotion
     rule, applied to the new importers. `tests/test_pine_library_pinning.py` holds the table to it.
   - The table fails closed: a document it cannot read admits nothing.
   - So Phase B never widens the reach of a version a store holds that nobody graded in a v6 script.
2. **The code the script reaches holds nothing the migration guide changed**
   (`crossVersionDifference`). Every check is conservative: a construct the token stream cannot show
   to mean the same in both versions is refused.
   - `and` / `or` with a call on its right other than a pure read (Lazy evaluation of conditions).
   - Bool `na`: `na()` / `nz()` / `fixnan()` of a value not shown to be a number, the history of a
     bool, `na` given to a bool, and an `if` / `switch` value without `else` / a default arm whose
     arms may be bool (Boolean values cannot be na).
   - A condition not shown to be a bool (Explicit "bool" casting).
   - A division of two values that may be `const int` (Fractional division of constants). A name
     bound to a const int stays one when reassigned, as `vw-int-div-assign` D05 witnessed.
   - `timeframe.period` (Timeframes must include a multiplier).
   - `color.red`, `color.teal`, `color.yellow`, and `label.new` without `textcolor` (Color changes).
   - A `for` end bound that calls anything but a size read of a collection the loop does not resize,
     or that reads a name the loop reassigns (Dynamic for loop boundaries).
   - `request.*`, `strategy.*`, the `transp` / `offset` / `linewidth` arguments, a repeated named
     argument, the history of a literal or of a field, and a negative literal array index.

Otherwise the import line is refused **by name**: `pine:library-version`, in both lanes, with the
construct and the guide's section in the sentence. A v6 library inside a v5 script stays refused as
before (`pine:module`). The guide reads v5 → v6 only.

## The probe (queued, row LB1)

`docs/pine/probes/lib-v5-in-v6.pine`, queued as `lib-v5-in-v6@NYSE:RDDT@D`
(`docs/pine/capture-queue-2026-11-16-libraries-phase-b.md`). It is a v6 script with four constant
plots, each computed inside a published v5 library: `BarefootJoey/AstroLib/1` and
`boitoki/Utilities/11`, both MPL-2.0, imported and never copied.

| plot | under v5 rules | under v6 rules |
|---|---|---|
| r of `color.red` | 255 | 242 |
| g of `color.yellow` | 235 | 216 |
| a `-34 / 60` const-int division inside `riset` | `DegSin(0)` | `DegSin(-0.5667)` |
| `timeframe.period` inside `auto_htf`, on a 1D chart | length 2 | length 3 |

<!-- MEASUREMENTS BELOW ARE FILLED FROM THE LOCK HOLDS -->
