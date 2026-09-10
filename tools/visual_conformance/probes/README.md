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
| `exchange-spelling.pine` | what string does `syminfo.exchange` return? | `symbolScope.json::confirmed` |
| `UCTPROBE_NS.pine` | the workhorse probe, read back OFF THE CHART 2026-09-10 — verbatim vendor bytes + `.provenance.json`. N01–N23. `barstate-append.pine` appends to THIS. | — |
| `tuple-security.pine` | 8-field tuple order · gaps×lookahead incl. the DEFAULTS · na before first HTF bar · forming vs closed HTF · same-tf | runbook item 3 · Volume line 259 |

⛔⛔ **`tickerid-containment.pine` and `exchange-spelling.pine` ARE NOT INTERCHANGEABLE.** They read different `syminfo` fields and answer different questions. The 2026-09-09 capture ran the first and `symbolScope.json::confirmed` stayed empty, because the map is keyed on `syminfo.exchange` and that run never read it. The vendor can rewrite a prefix (`SP:SPX` → `SP_DLY:SPX`), so a tickerid prefix is not evidence about `syminfo.exchange` — `exchange-spelling.pine` N11 measures that gap rather than assuming it closed.

⛔⛔ **STATUS 2026-09-10 — WHICH PROBES ARE ON A CHART, AND WHY THE REST ARE NOT.**

| probe | saved as | state |
|---|---|---|
| `UCTPROBE_NS.pine` | (unsaved variant of `Script$USER;787899e2…`) | ⚰️ displaced from the disposable layout; recoverable from `a57b06986` |
| `fold-pass.pine` | not saved | ✅ **CAPTURED** — job B, `e8406af75`. Bytes verified sha256 before the add. |
| `exchange-spelling.pine` | not saved | ⛔ blocked — bytes verified in the buffer (8791 chars, sha256 `e63b4872…e30f`), study never added |
| `tuple-security.pine` | not saved | ⛔ blocked — not attempted |
| `barstate-full.pine` | not saved | ⛔ blocked — not attempted |

**THE BLOCK IS ONE UI ACTION.** The editor is BOUND to the script whose source was opened, so
its action button reads *"Update on chart"* — which edits that script's study in place rather
than adding a new one. Swapping the Monaco model does not unbind it (measured). Creating a new
blank script from the editor's script-title dropdown is the only unbind found, and it is a
human action. ⭐ **Once each probe is saved under its own name, every future visit is pure
`createStudy`-by-id with no editor at all.** See the BINDING HAZARD section in
`docs/pine/capture-procedure.md`.

⛔⛔ **NEVER APPEND TO AN ACCOUNT-SCOPED USER SCRIPT.** `UCTPROBE_NS` is `Script$USER;<id>` — it belongs to the ACCOUNT, not the layout, so copying a layout copies the *reference*. Editing it would change every layout that uses it, including the owner's live chart. `barstate-full.pine` exists because of that: it derives from NS's committed bytes and is added as its own study, so NS is never opened for writing.

Aroon needs no probe — it is a TradingView built-in; add it at length 14 and read the pane.

⚠️ **Every predicate is plotted as `? 1 : 0`.** The capture reads plot VALUES out of the
chart model and a bool plot carries no numeric value. That is the instrument, not the
semantics.

⛔ **Follow `docs/pine/capture-procedure.md`.** In particular: never add a study while the
tab is hidden, and restore symbol, timeframe, pane stretch factors and study visibility
afterwards.
