# Probe scripts for the live-chart visit

Pine sources pasted into the TradingView editor during a capture session. Kept in the
repo so a visit is a paste-and-read rather than an authoring session, and so the exact
text that produced a fixture is versioned beside it.

| File | Answers | Ruling |
|---|---|---|
| ~~`barstate-append.pine`~~ | ⚰️ **SUPERSEDED by `barstate-full.pine`** — the append pattern is UNSAFE on account-scoped scripts. Kept so the diff is readable; do not use. | retired 2026-09-10 |
| `barstate-full.pine` | `isrealtime` / `isnew` / `islastconfirmedhistory` — a COMPLETE study: the committed `UCTPROBE_NS` bytes + N24–N26. 26 plots. | barstate capture |
| `fold-pass.pine` | does a timeframe ternary fold to an integer window? | Ruling 1g · Volume line 233 |
| `tickerid-containment.pine` | what does a `tickerid` look like per instrument class? | Ruling h · Volume line 222 |
| `exchange-spelling.pine` | what string does **`syminfo.prefix`** return? (⚰️ read `syminfo.exchange` until 2026-09-10 and could never compile — see the ruling) | `symbolScope.json::confirmed` |
| `UCTPROBE_NS.pine` | the workhorse probe, read back OFF THE CHART 2026-09-10 — verbatim vendor bytes + `.provenance.json`. N01–N23. `barstate-append.pine` appends to THIS. | — |
| `tuple-security.pine` | 8-field tuple order · gaps×lookahead incl. the DEFAULTS · na before first HTF bar · forming vs closed HTF · same-tf | runbook item 3 · Volume line 259 |
| `groupb-hilo-default.pine` | ⭐ 1-arg `ta.highest`/`ta.lowest`: does the source default to `high`/`low`, or `close` for both? **81 sites ride on it** | item 6 · Group B |
| `groupb-pivot-default.pine` | 2-arg `ta.pivothigh`/`ta.pivotlow`: the same defaulting asymmetry. Sentinel `-2` = not comparable on this bar | item 6 · Group B |
| `groupb-round-max-vwap.pine` | `math.round` half-up vs banker's + negative precision (101 sites) · `math.max` variadic or capped · `vwap(source)` anchoring | item 6 · Group B |
| `groupb-barssince-1arg.pine` | the documented 1-arg form — **and the CONTROL for the 2-arg probe** | item 6 · Group B |
| `groupb-barssince-2arg.pine` | ⛔ the form we declare and suspect is invalid. **A COMPILE FAILURE IS THE ANSWER** | item 6 · Group B |

⛔⛔ **`tickerid-containment.pine` and `exchange-spelling.pine` ARE NOT INTERCHANGEABLE.** They read different `syminfo` fields and answer different questions. The 2026-09-09 capture ran the first and `symbolScope.json::confirmed` stayed empty, because the map is keyed on `syminfo.exchange` and that run never read it. The vendor can rewrite a prefix (`SP:SPX` → `SP_DLY:SPX`), so a tickerid prefix is not evidence about `syminfo.exchange` — `exchange-spelling.pine` N11 measures that gap rather than assuming it closed.

⭐⭐ **STATUS 2026-09-10 — THE PROBES ARE SAVED SCRIPTS NOW. THE EDITOR IS NO LONGER ON THE PATH.**

Each probe below was saved under its own name, so a future visit is `createStudy` by id with
no editor, no paste and no binding hazard. Ids read off `_metaInfo.id` at add time AND
cross-checked against the account's saved-script list.

| probe | saved script id | ver | state |
|---|---|---|---|
| `fold-pass.pine` | `77714867cb714f3c929e225f183266ee` | 1.0 | ✅ saved + on chart, compiles, 5 plots |
| `tuple-security.pine` | `36fc58d24e5b4f5aa440a4e899bf16cb` | 1.0 | ✅ saved + on chart, compiles, 26 plots |
| `barstate-full.pine` | `1c367abc1e1548a7886ba6cf623e533f` | 1.0 | ✅ saved + on chart, compiles, 26 plots |
| `exchange-spelling.pine` | `631d746765c044fa86e7de4ed8004941` | 1.0 | ✅ saved + on chart, compiles, 11 plots (corrected 20:42:17Z, same id) |
| `UCTPROBE_NS.pine` | (never saved) | — | ⚰️ displaced from the disposable layout; recoverable from `a57b06986` |

For all four, the vendor's `_metaInfo.plots` order was compared against the
committed source's `plot()` order and matched exactly. ⛔ **Derive that roster with a
balanced-paren scan, never a regex** — `plot(str.contains(a, b) ? 1 : 0, "name")` carries
commas inside its first argument, and the obvious pattern silently returns an 11-name roster
for `exchange-spelling.pine`'s 12 plots. A roster short by one that still looks plausible is
the exact shape the byte/roster gate exists to catch.

⭐ **THE UNBIND IS SOLVED AND IT IS NOT A HUMAN ACTION.** This previously read *"Creating a
new blank script from the editor's script-title dropdown is the only unbind found, and it is a
human action."* The unbind is right, the conclusion was not: script-title dropdown →
**Create new** → **Indicator** is three ordinary pointer clicks and was driven end to end here.
It yields a fresh Monaco model (new `file:///<uuid>.pine` uri) whose action button reads
**"Add to chart"**, never *"Update on chart"*.

⛔ **ASSERT THE BUTTON BY ITS `title` ATTRIBUTE, AND RE-MEASURE ITS POSITION EVERY TIME.** In a
narrow editor pane the control is icon-only, so a text scan over leaf nodes finds NOTHING and
reads exactly like "no action button present". Its `title` is still `"Add to chart"`. Its x
also moves as the script name changes width — measured at 962, 998, 1038 and 1089 within one
session on an unchanged viewport. A coordinate cached from the previous probe lands on the
wrong control, which is how an earlier attempt was lost.

⚰️⚰️ **SETTLED RULING — `syminfo.exchange` DOES NOT EXIST. THE FIX WAS NOT A RENAME.**

Measured 2026-09-10, 16:06 ET, by saving `exchange-spelling.pine` verbatim and adding it:

    CE10272   Undeclared identifier "syminfo.exchange"   line 36, col 6-21

The study saves fine and **fails to compile**, so it produces no row at all. ⭐ Note the
failure mode: `isFailed` is true, `_data._items` is EMPTY, and `_metaInfo` stays a ONE-PLOT
STUB titled `"Plot"` whose `pine.digest` is the shared placeholder
`0366beecad3fa344b185adf5e6ac9b35f5419485`. **Read the roster off a stub and you record a
1-plot study that never ran as though it answered.** Gate every capture on
`isFailed === false` and a plot count matching the committed source before reading values.

⭐ **THE FIELD THAT DOES EXIST IS `syminfo.prefix`** — measured, not remembered, by compiling a
throwaway indicator against it. On `AMEX:SPY`, daily: `str.length(syminfo.prefix)` = **4**,
`str.length(syminfo.ticker)` = **3**, `str.length(syminfo.tickerid)` = **8**. That already
carries the file's flagship finding: the vendor's exchange string for SPY is FOUR characters
(consistent with `AMEX`) while our store holds `'NYSE Arca'` (nine, via yfinance `PCX`). A
member writing `syminfo.prefix == "AMEX"` is TRUE at the vendor and would have been FALSE
against our spelling.

⛔⛔ **BUT SUBSTITUTING IT KILLS N11, SO THIS IS A DESIGN DECISION AND NOT A SED.** N11 asks
`str.contains(syminfo.tickerid, <exchange>)` — the cross-field question that the paragraph
above ("ARE NOT INTERCHANGEABLE") leans on to argue a tickerid prefix is not evidence about
the exchange field. With `syminfo.prefix` that question answers 1 **by construction**: the
lengths prove `tickerid` is literally `prefix + ":" + ticker` (8 = 4 + 1 + 3). A plot that can
only ever read 1 is not a measurement, it is a decoration that reads as confirmation — the
`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` shape, and precisely what N12 exists
to prevent elsewhere in this same file.

⭐ **RULED AND APPLIED 2026-09-10.** Substitute `syminfo.prefix`; **delete N11 as vacuous**
(not disable, not rename — delete, with a tombstone in the file saying why). N1-N9, N10 and
N12 survive unchanged and are still the right instrument for filling
`symbolScope.json::confirmed`. Roster is now **11**. `len_exchange` was renamed `len_prefix`
so no plot title names a mechanism the code no longer uses. The labels N1-N10 and N12 keep
their numbers — renumbering to close N11's gap would silently re-point every earlier reference.

⭐ **THE CORPUS SAID THE RENAME WAS FREE.** Before touching the platform binding, all **502
tracked `.pine` files** across 16 directories were counted: `syminfo.exchange` appears **0**
times outside our own probe. The R6 control ran in the same pass over the same corpus —
`syminfo.*` matched **944 times in 183 files across 10 directories** — so the zero is a
measurement, not a reader that could not see. Nothing in the wild uses the old name, so the
binding is renamed rather than aliased.

⛔⛔ **NEVER APPEND TO AN ACCOUNT-SCOPED USER SCRIPT.** `UCTPROBE_NS` is `Script$USER;<id>` — it belongs to the ACCOUNT, not the layout, so copying a layout copies the *reference*. Editing it would change every layout that uses it, including the owner's live chart. `barstate-full.pine` exists because of that: it derives from NS's committed bytes and is added as its own study, so NS is never opened for writing.

⚰️ **BUT `787899e2…` IS NOT A SAVED SCRIPT, AND THE GUARD IS STRONGER FOR IT, NOT WEAKER.**
Measured 2026-09-10 against the account's own saved-script list: it holds
`uct-oracle-cmf-adl-pvt-falling-kcw-v1` (v4.0, last modified 2026-09-07), `Uncharted Scanners`
(v2.0, 2026-03-17) and the four `UCTPROBE_*` above. **`787899e2…` is absent.** It is
TradingView's UNSAVED-BUFFER slot: every unsaved script added to a chart is stamped with that
same id and a slot revision that ticks (`0.30` → `0.31` observed), which is why two unrelated
buffers both report it. ⛔ **A zero here is only evidence because the same query returned all
four probes** — the positive control that makes the absence mean something.

⭐ So `id != 787899e2…` does NOT mean "not the owner's script". It means **"genuinely saved
rather than riding the shared unsaved slot"**, which is the property worth asserting: two
probes on the unsaved slot are indistinguishable from each other by id. The real
account-scoped scripts are the six named above, and the never-append guard applies to those
— including, now, the four probes themselves.

⛔⛔ **GROUP B IS FIVE FILES FOR EIGHT QUESTIONS, AND THE SPLIT IS THE DESIGN.** A Pine
script compiles as a WHOLE: one invalid arity produces no study at all and takes every
co-resident reading down with it — and the corpse still lands on the chart wearing a one-plot
stub whose roster reads fine. So each arity that might not exist is ALONE in its file
(`hilo`, `pivot`, `barssince-2arg`), while the three documented forms whose failure would be a
surprise rather than an outcome share one (`round-max-vwap`). ⭐ Grouping those three is a
judgement with a stated cost: if that file fails, all three readings are lost together, and it
is acceptable only because the vendor's compile error names the code, message, LINE and COLUMN,
so a failure says which one to split out.

⭐⭐ **`groupb-barssince-2arg.pine` IS THE ONE PROBE WHOSE EXPECTED RESULT IS A FAILURE.** We
declare `barssince(series, int)`; every corpus site passes one argument; TradingView documents
one. The two possible fixes are OPPOSITE — widen to 1, or narrow to 1 — so "it compiled" and
"it did not" are two answers, and neither is success. ⛔ Its pair,
`groupb-barssince-1arg.pine`, is the control: if BOTH fail the problem is the harness, and
neither reading may be recorded.

Aroon needs no probe — it is a TradingView built-in; add it at length 14 and read the pane.

⚠️ **Every predicate is plotted as `? 1 : 0`.** The capture reads plot VALUES out of the
chart model and a bool plot carries no numeric value. That is the instrument, not the
semantics.

⛔ **Follow `docs/pine/capture-procedure.md`.** In particular: never add a study while the
tab is hidden, and restore symbol, timeframe, pane stretch factors and study visibility
afterwards.
