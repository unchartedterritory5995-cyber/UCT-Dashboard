# 15 Pro glass session — 2026-09-12, after #109 merged

Device: **iPhone 15 Pro, iOS Safari 17.6** (BrowserStack Live), CSS viewport **393**.
Build: master `9b51eaf1a` (#109 merged + deployed; `/api/health` uptime reset confirmed).
Sign-in: the smoke-account login link (`tools/smoke_login_link.py`) — no password typed.
Read path: BrowserStack DevTools -> Safari Web Inspector console.

Session identity confirmed from the device, not assumed:

```
/api/auth/me     -> 200  user id f4433528-6466-474a-949c-8d5eda8a7b91  (smoke@uctintelligence.intern...)
```

## G3-15 — ✅ PASS on real glass, three modes

`elementFromPoint` swept across the chip's own box at the chip's vertical centre;
selectors are the established pair (`[data-testid="hub-chip"]`, `button[aria-label]` =~ /actions$/i).

| route | mode label | chip box | gap to Actions button | intersects | samples | resolved to something else |
|---|---|---|---|---|---|---|
| `/dashboard` | `HomePreview — more coming` | [24, 227] | **8px** | false | 51 | **0** |
| `/screener` | `Screener · 1/100tap: nex` | [24, 227] | **8px** | false | 51 | **0** |
| `/options-flow` | `FlowPreview — more comin` | [24, 227] | **8px** | false | 51 | **0** |

⭐ **The 8px gap is the fix's own derivation, reproduced by a real engine.** `HubActionsButton`
measures its own rendered width and reports it; `HubChip` anchors off that plus
`ACTIONS_CLEARANCE_PX = 4`. Both terms carry the width so it cancels, and the prediction was
"8px whatever the button measures". Glass says 8.

Screenshot: `screens/glass/G3-15-pass-15pro-393-2026-09-12.jpg`.

⚠️ Widths 360/375/430 are NOT obtainable on a real 15 Pro (it renders at 393 and a Live mirror has
no responsive-width control). That half is the Playwright sweep,
`g3-15-clearance-sweep-2026-09-12.md`, 27/27 clear of the button. Labelled, never substituted.

## iOS-17 Notebook hotfix — ✅ VERIFIED ON THE ENGINE THAT BROKE

```
ua "Version/17.6"   iterNative "undefined"   pwr "function"   errs 0   bodyLen 563
path "/journal/notebook"
```

⭐ **`Iterator` is `undefined` on this engine** — the exact condition that threw
`ReferenceError: Can't find variable: Iterator` and put the route-level error boundary in front of
every member on iOS below 18.4 — **and `/journal/notebook` now renders real content with zero
JavaScript errors.** The route-level crash is gone, measured on the device class that found it.

Screenshot: `screens/hotfix/notebook-ios17.6-loads-clean-2026-09-12.jpg`.

⚠️ **The PDF PREVIEW path itself is NOT exercised by this run, and that is stated rather than
implied.** `lib/pdfjs.js` (and therefore the shim) loads only behind the lazy viewer boundary,
which needs a note with a document attachment. There is none (below). So this run proves the route
loads; it does not prove a PDF renders. `iteratorGlobalFloor.test.js` against real built output
(gate run `2026-09-12T17-57-39`) is the other half of that evidence.

## Preview re-check — NO SUBJECT, and the absence is measured

```
/api/j2/notes -> 200 {"notes":[],"total":0,"limit":100,"offset":0}
[data-note-card-id] in DOM: 0
```

⛔ **The smoke account holds zero notes, and the call that says so SUCCEEDED (200, total 0).**
That distinction is the whole point: a 401 would have produced the same visible "no notes" while
meaning something completely different, and the device did briefly show a
`Failed to load Journal 2.0 settings: 401` banner during a deploy swap. Re-queried after the churn
settled, `/api/auth/me`, `/api/j2/notes` and `/api/j2/settings` all return 200.

So there was nothing to preview and nothing to trash. The account's "holds no state" invariant is
satisfied. Creating a note + PDF attachment through the app on a 0.71-scale mirror remains the
open path for exercising the preview itself.

## Still open from this session

| row | state |
|---|---|
| G3-17 (mirrored chip at 393) | ⬜ NOT RUN — needs the left-handed preference; the console write did not land (verified: `__pref` undefined, so **no** partial write happened) |
| remaining untimed iOS rows | ⬜ NOT RUN |
| Pixel 8 + TalkBack (D1, G2-1/2, D4) | ⬜ NOT RUN |
| PDF preview exercised end to end | ⬜ OPEN — needs a note + attachment created through the app |

## Two environment findings worth carrying

⚠️ **Production was in deploy churn from another workstream during this session** — four `web`
deployments inside ~5 minutes (`756b5956f`, `a65ba9800`, and two REMOVED), which produced 502s on
the link-mint call and a transient 401 banner on the device. Measurements were taken only after
`/api/health` showed uptime climbing cleanly for ~3.5 minutes. ⛔ A glass result taken through a
pod swap is not a glass result.

⚠️ **`Array.fromAsync` reports `"function"` on Safari 17.6.** `iteratorGlobalFloor.test.js` lists it
in `UNSHIMMED_STATIC` annotated `since: 'Safari 18.4'`. The rail is not wrong to scan for it — it is
conservative in the safe direction — but the annotation is inaccurate against this device and should
be corrected rather than trusted.
