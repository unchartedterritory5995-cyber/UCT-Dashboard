# The Pine ecosystem survey

Research input for the indicator platform's **presentation layer**, conducted 2026-09-08.

The question this set answers: *what do real TradingView Pine indicators draw, how do they draw it, and
what must a from-scratch renderer implement, in what order?* It replaces guesswork and a 137-script
in-repo corpus with a census of the whole published open-source ecosystem.

Report page (tables + browsable gallery): **https://claude.ai/code/artifact/73f6da2a-6c1b-4cfb-bbfe-075a71f617ba**

---

## What was measured

| | |
|---|---|
| Scripts catalogued | **6,156** (4,898 open-source · 932 protected · 326 invite-only · 220 Editors' Picks) |
| Sources read and parsed | **4,898** — every open-source script the catalogue returned, not a sample |
| TradingView built-ins censused | **145** (142 source-retrievable) |
| Visual case studies assessed | **100**, by five independent reviewers |
| Target platform | `lightweight-charts` **5.2.0**, pinned exactly on `origin/master` |

Only open-source scripts were read, from TradingView's own public endpoints — the same ones a script page
uses. No protected or invite-only script was accessed. A licence was recorded per file.

## The five findings that should change plans

1. **Drawing objects are the ecosystem, not an advanced corner of it.** 52.6% of open-source scripts use
   `label` / `line` / `box` / `polyline` / `linefill` / `table`, and **36.6% contain no `plot()` call at
   all**. Weighted by popularity it is starker: among the 250 most-boosted scripts, drawing objects appear
   in 61.2%, `box.new` doubles to 32.8%, and user-defined types nearly triple to 27.6%.
2. **Loops and arrays are not a later phase.** They are *how* the wild manages object pools — 36.6% of
   scripts loop, 32.2% use arrays (46.8% / 44.8% in the popular cohort). The drawing layer cannot ship
   without the machinery that drives it.
3. **Six Pine dialects are live and permanent.** 32.6% of scripts are pre-v5. Nothing has ever been
   sunset and there is no v7. Identical source *paints differently by version* — colour constant hexes
   changed, the default label text colour flipped, implicit fill transparency was dropped at v5 — so the
   version tag must survive all the way to the paint call and must not be normalised away in the IR.
4. **Zero infeasible on Lightweight Charts v5, and no fork or upgrade needed.** 100 of the most visually
   complex indicators were assessed; none needs a capability the library lacks. Difficulty clusters at
   3–4 of 5 and nothing scored 1, because LWC's native vocabulary is only series, markers and price lines —
   a plugin primitive is the floor for anything Pine draws.
5. **Nobody has solved Pine rendering.** 34 prior-art projects assessed: every existing engine stops at
   arrays of numbers, by its own documentation. The runtime and standard library do have legally clean
   prior art worth real time; the visual layer is unclaimed.

## Documents

### The spec the renderer is built from and tested against
| file | what it is |
|---|---|
| [`pine-presentation-spec.md`](pine-presentation-spec.md) | Argument-level Pine v6 presentation spec. **214 numbered conformance assertions**, 53 explicitly unverified items, 25 documentation defects found in TradingView's own prose. The reference document. |
| [`pine-v6-constants.md`](pine-v6-constants.md) | All 35 constant namespaces / 239 members, enumerated from TradingView's reference payload, with 12 numbered reference-vs-manual disagreements. |
| [`lwc5-capability-map.md`](lwc5-capability-map.md) | Every Pine primitive mapped to an LWC v5 mechanism, demand-ordered, with 21 numbered implementation rules and the z-order reconciliation. |

### The demand tables — the build order
| file | what it is |
|---|---|
| [`demand-presentation.md`](demand-presentation.md) | Every presentation primitive by share of scripts and call sites, with the named arguments actually passed. **Read the capacity caveat before sizing anything.** |
| [`demand-computation.md`](demand-computation.md) | Language and runtime features by demand. |
| [`demand-constants.md`](demand-constants.md) | Which enumerated constant members are actually used. |
| [`demand-popularity-weighted.md`](demand-popularity-weighted.md) | The same corpus counted flat vs weighted by boosts. The two disagree, and the disagreement is a finding. |
| [`computation-crossref.md`](computation-crossref.md) | 275 features cross-referenced against what our engine supports, plus the unblock sequence with projections. |

### Ecosystem and corpus
| file | what it is |
|---|---|
| [`corpus-gap.md`](corpus-gap.md) | Whether our test corpus resembles the ecosystem. It does not. |
| [`corpus-expansion-plan.json`](corpus-expansion-plan.json) | 537 staged candidates, licence-gated per entry. |
| [`prior-art.md`](prior-art.md) | 34 projects assessed for licence and honest completeness. |
| [`pine-version-evolution.md`](pine-version-evolution.md) | v1→v6: 86 changes, each tagged parser / runtime / renderer. |
| [`builtins-and-adoption.md`](builtins-and-adoption.md) | TradingView's own 145 built-ins, plus measured adoption of newer Pine features. |
| [`survey-instrument-audit.md`](survey-instrument-audit.md) | Adversarial audit of the survey's own scanner, and the corrections applied. |
| [`case-studies/`](case-studies/) | The 100 visual case studies, in five slices. |

## How to trust these numbers

**The plot-family counts are externally validated.** TradingView publishes per-script call counts for the
five plot-family primitives and `alertcondition`. This survey's independently-derived counts agree
**100% exactly across 1,085 comparisons** — an external oracle, not a self-check.

**The instrument was audited and corrected.** The first pass was blind to Pine's method-call syntax
(`myLine.set_x2()`). A receiver-typed re-derivation recovered **7,471 sites (+7.8%)**, which changed the
ranking of every setter, getter and delete row while leaving the top 15 unchanged. 255 sites remain
deliberately unattributed, so the table is a floor.

**Three things these tables cannot tell you**, restated because they are the easiest to misuse:

- **Call sites are not objects.** Scripts reserve 1,350,528 drawing objects via `max_*_count` against
  21,625 constructor sites (62x). Never size capacity from this table.
- **Library-mediated drawing is invisible.** 344 scripts import a library; 59 reserve drawing capacity
  while calling no constructor of their own.
- **Categories are bounded by what was searched for.** `breadth` and `visual-decoration` are *unmeasured
  rather than small* — both grew ~100x when the remaining search terms completed.

Nothing here was confirmed by running Pine on a live chart. The spec carries 53 unverified items for
exactly that reason.

## Two robustness findings for the runtime

Running our own translator across the corpus, **10 published scripts kill the process outright** — some by
exhausting a 4 GB heap, some by never returning. They include well-known indicators (Parabolic SAR, Renko
Chart, Chandelier Exit ATR, an Ehlers oscillator). They are named in the survey outputs. A runtime that must
execute the wild has to survive them, and the harness must attribute a crash rather than dying with it.

Separately: the first full pass *looked* clean because the shell pipeline's exit code was `tail`'s, not
node's. Check the number, not the word "passed".

## Open decisions for the owner

1. **The licence fault line.** Two existing corpora already apply contradictory rules to the same class of
   file: the committed community corpus treats a script with no licence line as MPL-2.0 per TradingView
   Terms §22, while an unmerged branch's manifest marks every "licence not stated" file local-only. Under
   the stricter reading, commit-eligible scripts in the expansion plan drop from **370 to 202**.
2. **A pre-existing licence defect, flagged and not touched.**
   `tests/fixtures/pine/12-ichimoku-clouds.pine` is committed today carrying a **CC BY-NC-ND** header. The
   non-commercial policy was applied to the community corpus but never applied backwards to the
   GitHub-sourced one.
3. **Buy-vs-build for the runtime.** AGPL disqualifies several strong projects from a commercial network
   service; the leading commercial alternative is $1,199/dev/yr. That number belongs on the table
   explicitly. TradingView also owns the **Pine Script®** mark — the norm among these projects is
   clean-room-from-public-docs and not claiming the mark in a product name.

## Reproducing the survey

Tooling lives in [`tools/pine_survey/`](../../tools/pine_survey/). It reads only public, unauthenticated
endpoints, rate-limits itself, and is idempotent.

```
python tools/pine_survey/tvfetch.py enumerate   # build the catalogue
python tools/pine_survey/tvfetch.py fetch       # download open-source sources
python tools/pine_survey/inventory.py           # per-script feature vectors + aggregates
python tools/pine_survey/validate.py            # check counts against TradingView's own
python tools/pine_survey/weighted.py            # flat vs popularity-weighted
node   tools/pine_survey/engine_run.mjs         # run our translator (resumable; re-run until ALL_DONE)
python tools/pine_survey/emit_tables.py         # regenerate the tables in this folder
```

`pine_reference_extract.js` re-derives TradingView's full v6 reference payload by resolving their webpack
chunk graph; it rediscovers the chunk hashes each run, so it survives their redeploys. **The payload itself
is deliberately not committed** — it is TradingView's documentation content. Fetched `.pine` sources and
chart snapshots are likewise not committed; the corpus expansion plan is the licence-gated path for that.
