# Linemap — `Uncharted Volume`

**Source of truth:** `tests/fixtures/member/uncharted-volume.pine`, 576 body lines,
`//@version=6`, © AtTheAsk (MPL-2.0). Hashes in
`tests/fixtures/member/manifest.json`; `tests/test_member_fixtures.py` fails if
either moves.

⛔ **EVERY LINE NUMBER HERE IS FROM THAT FILE AND NOTHING ELSE.** The script was
lost twice as a conversation attachment before it was committed, and a linemap
built against a remembered copy is a document that describes the wrong statements
with total confidence. Re-derive after any change to `body_sha256`.

⭐ **The STATUS column is MEASURED, not judged.** It comes from running the
shipped `translatePine` over this exact file in both contracts on 2026-09-09. The
CAPABILITY and PHASE columns are the judgement.

---

## What the translator actually says today

```
SCREENER  refused  pine:builtin  line 222  — `str.contains`
HOST      refused  pine:builtin  line 222  — `str.contains`
lenient: 5 refusals — 4 × str.contains (222), 1 × pine:window (233)
```

⚠️ **The first refusal is at line 222 in BOTH contracts**, which is why the
`request.security` at 259 does not yet appear in the list: resolution stops
before it. The refusal list will grow as earlier blockers clear — a shrinking
list is not the metric here, a *changing* one is.

---

## The blockers, in the order the translator hits them

| Line(s) | Pine feature | Capability required | Phase | Status |
|---|---|---|---|---|
| **222** | `str.contains(syminfo.ticker, "/") or str.contains(syminfo.tickerid, "/")` | **Kind 4 — symbol-scoped constant.** `syminfo.*` resolved once at definition-bind time from our own symbol store, `str.contains` folding at bind time to a boolean | Step 5, item 2 | 🔴 **BLOCKS BOTH CONTRACTS** — first refusal |
| **233** | `ta.sma(v, isWeekly ? lenWeekly : lenDaily)` | A window length that is a *computed* expression. Both operands are bind-time constants (`timeframe.isweekly` is the chart's own timeframe; `lenWeekly`/`lenDaily` are inputs), so this folds to a plain integer at bind time — **but only if Kind 4 folding reaches window lengths** | Step 5, item 2 (extension) | 🔴 **BLOCKS** — `pine:window` |
| **259** | `[a,…,h] = request.security(syminfo.tickerid, 'D', f_getDailyData(), lookahead = barmerge.lookahead_off)` | 8-tuple `request.security`, chart's own symbol, daily, `lookahead_off`, **no `gaps=`** | Step 5, item 3 | ⚪ **not yet reached** — 222 refuses first |
| **429, 450** | `barstate.islast` | Refused deliberately: `BUILTIN_REQUEST_DEPENDENT` — its value depends on how many bars were asked for | — | ⛔ **refused by ruling, not by gap** |
| **296, 299, 399** | `barstate.isconfirmed` | Screener folds it to 1 (exact on closed bars); host refuses pending the realtime capture | Barstate capture | 🟡 **screener OK / host refuses** |

---

## What already works

| Line(s) | Pine feature | Status |
|---|---|---|
| **215, 216, 217** | `timeframe.isdaily` / `isweekly` / `ismonthly` | ✅ **shipped 2026-09-09** (`42dd63a72`) — alias onto the clock columns the table already declared |
| **225** | `ta.cum(nz(v)) > 0` | ✅ **shipped 2026-09-09** (`0a96689ef`) — host contract only; the screener refuses it by ruling, and the definition carries `window_dependent` |
| **189–207** | `ta.*` — the moving averages and ranges | ✅ declared |
| **38–150** | `input.*` × 31 | ✅ declared |
| **151, 159, 172, 188, 389** | 5 user-defined functions | ✅ per-call-site frames (Phase 2E) |
| **236–283** | `var` × 19 | ✅ carried state (Phase 2A) |

---

## Presentation — R2, not a translation gap

These are not refusals to clear in this program; they are the presentation layer.

| Line(s) | Feature | Note |
|---|---|---|
| **335, 341, 345, 350** | the 4 `plot()` calls | Every one is gated `skipAll ? na : …`, and `skipAll` (226) needs **222** and **225**. So all four plots are downstream of one Kind-4 blocker. |
| **394, 419, 422, 431** | `label.*` × 4 | The HVE / HV1 annotations |
| **489, 490, 498, 502, 532, 533, 573–575** | `table.*` × 10 | Two tables — volume and ATR |
| **173, 393, 480, 538, 541, 542, 555, 564** | `str.*` other than `contains` | `str.tostring` on **series** values → R2 text, refused by name and routed there |

---

## Reading

⭐⭐ **ONE LINE GATES THE WHOLE PANE.** `skipAll` (226) is `isRatioSymbol or not
hasVolumeData`; `isRatioSymbol` is line 222 and `hasVolumeData` is line 225. All
four plots carry `skipAll ? na : …`. So Kind 4 at line 222 is not one refusal
among five — it is the difference between this script drawing and not drawing.

⚠️ **AND LINE 233 IS THE SAME MECHANISM WEARING A DIFFERENT GUARD.** `pine:window`
reads as a separate capability gap, and it is not: every operand of
`isWeekly ? lenWeekly : lenDaily` is constant for a given binding. If bind-time
folding reaches window lengths it clears with 222; if it does not, this script
still refuses after item 2 lands. **That is the design question item 2 has to
answer, and it is not in the owner's Kind-4 spec** — flagged rather than assumed.

⚠️ **`barstate.islast` (429, 450) will never clear.** It is refused by ruling —
its answer moves with the fetch — so the honest target for this script is *every
refusal cleared except `islast`, and `isconfirmed` on the host contract pending
the realtime capture*, not zero refusals.
