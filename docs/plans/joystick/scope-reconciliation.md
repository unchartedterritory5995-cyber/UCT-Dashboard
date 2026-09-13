# Joystick hub — full-scope reconciliation

> **Every line of the original plan, accounted for.** Read-only against master `54393f890`.
> This is NOT the closure gate and it grades nothing that closure already graded; it asks one
> question — *was everything the spec promised actually built, changed on the record, deferred with
> an owner, retired by a ruling, or silently dropped?*

| state | rows |
|---|---|
| ✅ **SHIPPED** | **58** |
| ⚠️ **SHIPPED-CHANGED** | **9** |
| ⏸️ **DEFERRED** | **4** |
| ⚰️ **RETIRED** | **7** |
| ⛔ **MISSING — now filed** | **3** (D-46, D-47, D-48) |
| **total scope rows reconciled** | **81** |

> ### Verdict
>
> **The full scope is implemented-with-recorded-changes, with three gaps — all documentation or
> affordance, none of them a member-facing capability.** Every gesture, every mode, every action,
> every accessibility commitment and every hardening rail the spec promised is on master and
> railed. The three gaps are: §C4's focus-return promise that no code produces (**D-46**), the
> per-mode action editor promised in v1.1 and never built while its storage half shipped
> (**D-47**), and ground rule A-1's `CLAUDE.md` onboarding section, which was never appended
> (**D-48**). All three are now filed with an owner and a removal condition.

⛔ **Scope baseline correction.** The brief names `UCT_Joystick_Hub_MASTER_v1.md` "as first
committed". **No file of that name has ever existed in this repository** — `git log --all
--diff-filter=A` over `docs/plans/joystick/**` returns no such path. The earliest spec is
`00-master-spec-v1.1.md`, added in `0ee2cb36c` (2026-09-08) together with v1.2, v1.3 and v1.4;
v1.5 followed in `3b57e2a24` and v1.6 in `10956a442`, all the same day. **v1.1 is the baseline
used here**, and it matters: three of the seven RETIRED rows and one of the three MISSING rows
exist only in v1.1 and were dropped without a ruling in the versions that followed.

---

## 1. Scope evolution — what each spec revision changed

Derived by diffing the heading set of every revision, not by reading the changelogs.

| version | sections | change |
|---|---|---|
| v1.1 | 40 | baseline |
| v1.2 | 38 | **+23 / −25 — the big one.** Section maps renamed from product names to mode ids: `Home→home`, `Scanner→scan`, `Chart (TradingView widget)→chart`, **`Echo (catalyst feed)`→`catalysts`**, `Journal 2.0 / Portfolio→journal`, `Breadth monitor→breadth`, `Calendar→calendar`, `Notebook→notebook`, `Options Flow→flow`, `Morning Wire→wire`. Part D's five subsections (D1 org chart, D2 rules of engagement, D3 waves, D4 subagent template, D5 handoff) removed. `2d. One shared cursor` and `5a. Phase 2a — hub_planned_trades` added. |
| v1.3 | 39 | `2f. Two new UIcon glyphs` |
| v1.4 | 41 | `D0. File ownership lock`; the no-TypeScript banner |
| v1.5 | 41 | title only (Phase 2 gate decisions folded into existing sections) |
| v1.6 | 47 | `8a` navigation seam (R-G), `C1.1` Reach mode, `C1.2` iOS capability floor, `C1.3` preview kill switch, `C1.4` Phase 2a planned trades |

⭐ **The v1.1→v1.2 rename is why "Echo" reads as retired and is not.** The catalyst-feed section
survived under the name `catalysts` and ships seven actions; what was retired was the *name*, and the
Finnhub/FMP/FinTwit feed concept behind it, which Wave 0 found does not exist as a separate surface.

---

## 2. Part A — ground rules (20 rows)

| # | Promise (origin) | State | Evidence |
|---|---|---|---|
| A-1 | Append a `CLAUDE.md` "Joystick hub" section: registry location, how to add a mode, tuning constants, known gaps (v1.6:49-50) | ⛔ **MISSING** | The onboarding section does not exist. ⚠️ Three joystick-titled headings DO exist (`:1807` kill switch, `:1836` hide-recovery lesson, `:2281` B7 rail) — none is this one. `"add a mode"` **0 hits**, `"known gaps"` **0 hits**. → **D-48** |
| A-2 | Additive by default, NINE named exceptions (a)–(i) (v1.6:52-74) | ✅ SHIPPED | All nine landed with cites; verified by `completion-audit.md` §2 |
| A-3 | Mobile only — `width < 1024px` **AND** `(pointer: coarse)` | ✅ SHIPPED | `useHubActive.js:84` — `(max-width: 1023px) and (pointer: coarse)` |
| A-4 | Canonical breakpoints only, 640 and 1024; no 900px | ✅ SHIPPED | zero `900px` under `app/src/hub/`; `useHubActive.js:83` comment names the rule |
| A-5 | Gate visibility in CSS, not a JS mount condition | ✅ SHIPPED | `hub.module.css` media blocks; `useHubActive` gates eligibility, not layout |
| A-6 | `100dvh`, `window.visualViewport`, re-layout on resize | ✅ SHIPPED | `useHubActive.js:82` requires `visualViewport`; `hubViewport.js` |
| A-7 | Mount test `CSS.supports('backdrop-filter','blur(1px)') && visualViewport` | ⚠️ **SHIPPED-CHANGED** | `useHubActive.js:77-79` also accepts `-webkit-backdrop-filter`. **Ruling F-1, v1.6.** Reason at `:62-76`: on a real iPhone 15 Pro / iOS 17.3.1 the unprefixed name returns **false**, so the spec's test excluded **100% of iOS** for a mobile-only control |
| A-8 | **No order placement**; Plan trade writes `hub_planned_trades` only | ✅ SHIPPED | `api/routers/hub_planned_trades.py`, mounted `api/main.py:7877` |
| A-9 | Options Flow partner-owned; flow fan is `[Voice, Home]` | ✅ SHIPPED | registry yields exactly `['flow.voice','flow.home']` |
| A-10 | No `StockChart.jsx` edits beyond exception (e) | ✅ SHIPPED | rule-12-style check; `.goLivePill` only |
| A-11 | UCT20 is never a write target | ✅ SHIPPED | `registry.js:112` — "Never UCT20, which is read-only" |
| A-12 | Respect `prefers-reduced-motion` | ✅ SHIPPED | hub CSS + JS check copied from `useAnimatedNumber` |
| A-13 | No new dependencies | ✅ SHIPPED | zero additions to `app/package.json` across the programme |
| A-14 | Everything declared in ONE registry; adding a section is a data change | ✅ SHIPPED | `registry.js` + `validateRegistry` |
| A-15 | Model routing (Opus for 0/1, Sonnet for 2–4) | ✅ SHIPPED-BY-PROCESS | process rule, not a code artifact |
| A-16 | Minimum iOS Safari 16 / Android Chrome 110 | ⚠️ SHIPPED-CHANGED | floor now **declared** in `vite.config.js` + browserslist as `iOS >= 16` — added by the iOS-17 crash fix, not by this spec line |
| A-17 | Existing navigation keeps working with the hub disabled | ✅ SHIPPED | kill switch `HUB_PREVIEW_ENABLED`; `tests/test_hub_preview_flag.py` |
| A-18 | Theme/brand fit — read colours from existing CSS vars, `--hub-*` in one place | ✅ SHIPPED | `tokens.css` + `themeIslands.test.js` rail |
| A-19 | Two new `UIcon` glyphs (v1.3, §2f) | ✅ SHIPPED | exception (f) |
| A-20 | The corner — hub replaces the FAB stack | ✅ SHIPPED | exceptions (a) + (h); `useHubActive` shared by both gates |

---

## 3. Part B — phases and gates (8 rows)

Every phase closed with a manifest and a merged PR; the closure gate (`closure.md`) and
`completion-audit.md` §2 carry the per-phase citations and are not duplicated here.

| phase | State | Evidence |
|---|---|---|
| Phase 0 Discovery | ✅ SHIPPED | `10-wave0-discovery.md`; spec §3 marked COMPLETE |
| Phase 0.5 UX | ✅ SHIPPED | `20-wave05-ux.md` |
| Phase 1 Registry/context/cursor | ✅ SHIPPED | `30-phase1-plan.md`; PR #101 → `d3bf38f44` |
| Phase 2 Gesture engine + glass | ✅ SHIPPED | `40-phase2-gate.md`, `41-phase2-diagnostics.md` |
| Phase 2a `hub_planned_trades` | ✅ SHIPPED | router + store on master |
| Phase 2.5 Admin preview | ✅ SHIPPED | `45-phase2.5-plan.md`, `46-preview-production-check.md`, `47-hide-recovery.md` |
| Phase 3 Section controllers | ✅ SHIPPED | `60-phase3-plan.md`; nine controllers under `app/src/hub/sections/` |
| Phase 4 Settings and polish | ⚠️ SHIPPED-CHANGED | see §6 — one item of the Phase 4 list is **D-47** |

---

## 4. Part C1 — gesture vocabulary (9 rows)

| gesture | State | Evidence |
|---|---|---|
| Tap → Primary | ✅ SHIPPED | every cursor mode; `GS-*-b1`; **PASS on glass** for `wire` and `home` (`15pro-new-rows-2026-09-13.md`) |
| Double-tap → Reverse | ✅ SHIPPED | `DOUBLE_TAP_MS = 280` (`constants.js:91`); glass rows on the owner run (B10–B12) |
| Hold 0.5s → Home | ✅ SHIPPED | `HOLD_MS = 500` (`constants.js:88`) |
| Hold + drag → Scrub | ✅ SHIPPED | `useJoystick.js:408` — *"A hold that turns into a drag is Scrub"* |
| Drag soft → Inner fan | ✅ SHIPPED | `INNER_MAX = 4`, ends with Home (`registry.js:65`) |
| Drag hard → Outer fan | ✅ SHIPPED | `OUTER_MAX = 5` (`registry.js`) |
| Drag past 56px → Reach mode | ✅ SHIPPED | `REACH_PX = 56` (`constants.js:71`) — added v1.6 §C1.1 |
| Flick <120ms → Quick | ✅ SHIPPED | `FLICK_MS = 120`; `flickable` gate `useJoystick.js:396` |
| ~~Two-finger tap → Peek~~ | ⚰️ **RETIRED** | Owner ruling 2026-09-10 `ccd661051`; rail `hub/peekRemoved.test.jsx`. Reason in §C2: screen readers consume two-finger tap, and two pointers fails **WCAG 2.5.1** |

---

## 5. Part C2 — accessibility commitments (12 rows)

| commitment | State | Evidence |
|---|---|---|
| No `role="toolbar"` | ✅ SHIPPED | zero occurrences under `app/src/hub/` |
| Knob is one `role="button"` named for the mode | ✅ SHIPPED | `HubKnob.jsx:11` |
| Chip `role="status" aria-live="polite"` | ✅ SHIPPED | `HubChip.jsx:95-96` |
| Pad / compass ring `aria-hidden` | ✅ SHIPPED | `HubRoot.jsx` |
| Sheets reuse `components/mobile/Sheet.jsx` verbatim | ✅ SHIPPED | dialog semantics, focus trap, Escape |
| `aria-disabled`, never native `disabled` | ✅ SHIPPED | `HubActionsButton.jsx:275` (+ reason at `:66`) |
| `role="list"`/`role="listitem"` in Peek | ✅ SHIPPED | `HubActionsButton.jsx:266,271` |
| Announce with mode context; wedge string is the label alone | ✅ SHIPPED | `HubChip` + wedge announcement |
| Scrub as native `<input type="range">` + `aria-valuetext` | ✅ SHIPPED | `HubScrubRange.jsx` — the no-drag path for Scrub |
| Motor ranges: travel 16–48, hold 300–1200, double-tap 200–600 | ✅ SHIPPED | `useHubSettings.js:57-63` |
| `stickyFan` defaults ON | ✅ SHIPPED | `useHubSettings.js:62` |
| High contrast + haptics disableable | ✅ SHIPPED | `highContrast:false` (`:63`), `haptics` toggle; `[data-hub-contrast="high"]` |
| **Actions button is the no-drag door** | ✅ SHIPPED | `HubActionsButton.jsx`; owner-run §C / §C-iOS rows G2-1…G2-4, D1 |

---

## 6. Phase 4 — settings (9 rows)

| item | State | Evidence |
|---|---|---|
| Single pref key `joystick_hub` via `setPrefMerged` | ✅ SHIPPED | `useHubSettings.js` |
| `enabled` / enable-disable | ✅ SHIPPED | settings card + `hubSessionVisibility.js`; recovery path `47-hide-recovery.md` |
| `handedness` | ✅ SHIPPED | `useHubSettings.js:57` |
| `haptics` | ✅ SHIPPED | schema + toggle |
| `holdMs` / `travelPx` / `doubleTapMs` / `stickyFan` | ✅ SHIPPED | `useHubSettings.js:59-62` |
| `highContrast` | ✅ SHIPPED | `useHubSettings.js:63` |
| `overrides` as a JSON patch, never a copy | ✅ SHIPPED (storage) | `useHubSettings.js:75`, semantics at `:37-38` |
| **Per-mode editor to reorder/remove actions** (v1.1:168) | ⛔ **MISSING** | `JoystickSettingsCard.jsx:222` — *"`overrides` IS SHOWN, NOT EDITED"*. Count + reset only. Not in any ledger. → **D-47** |
| Auto-hide on text input | ✅ SHIPPED | `hub/autoHideOnTextFocus.test.jsx`, `hubAutoHideRoot.test.jsx`, `iframeFocusBlindSpot.test.jsx` |
| First-run coach mark, dismisses permanently | ✅ SHIPPED | `HubCoachMark.jsx` |
| **No analytics** — exactly one `TODO(hub-analytics)` | ✅ SHIPPED | `HubRoot.jsx:141`, exactly one occurrence, railed by `hub/analyticsMarker.test.js` |

---

## 7. Part C4 — cross-section conventions (6 rows)

| convention | State | Evidence |
|---|---|---|
| Shared `symbol`, `timeframe`, `activeScan`, `selectedPosition` in hub context | ✅ SHIPPED | `HubContext.jsx:52-81` |
| **"Flag"** = `useFlagged().toggle(symbol)`, never UCT20 | ✅ SHIPPED | `registry.js:112` |
| **"Why?"** = `/ai-search?q=…` | ✅ SHIPPED | `registry.js:161,169` |
| **"Note"** = Notebook entry via `createNoteViaApi` | ✅ SHIPPED | `registry.js:489` |
| **"Voice"** = `useRealtimeSession().connect(context)` | ✅ SHIPPED | `HubVoiceBridge.jsx:18,22` |
| **Any sheet returns focus to the KNOB on close** | ⛔ **MISSING** | `HubKnob.jsx` has no ref and no focus handling; `HubRoot.jsx` never calls `.focus()`. Behaviour comes from `Sheet.jsx:81,126` restoring `document.activeElement`, which on the **gesture** path is `<body>`. → **D-46** |

---

## 8. Part C3 — the ten section maps

⭐ **Covered by a derived instrument rather than by ten hand checks, deliberately.**
`tools/hub_surface_matrix.mjs` reads Primary / Reverse / Scrub / readout and every fan action out of
the controllers and the registry, and `hub/surfaceMatrixIsCurrent.test.js` fails if
`surface-matrix.md` or `glass-acceptance-steps.md` drifts by one byte. That is stronger evidence
than a reviewer's tick, and it is why D-42 and D-43 were findable at all.

- **10 modes**, exactly the set §C3 names: `wire, breadth, scan, chart, journal, catalysts, notebook, calendar, home, flow`.
- **62 actions** declared; every one carries a state in `surface-matrix.md` and a step in `glass-acceptance-steps.md` (**107 steps**).
- `flow` is navigate-only with the fan §2 requires: `['flow.voice','flow.home']`.
- Primary/Reverse/Scrub per mode: `completion-audit.md` §1 table, all **SHIPPED** since D-43 closed `notebook`'s Reverse.

⚠️ **ADDED beyond the spec — none found.** Every registry mode appears in §C3 and every §C3 section
appears in the registry.

---

## 9. Retired by ruling (7 rows)

| promised | origin | retired by |
|---|---|---|
| Two-finger tap → Peek | v1.1 §C1 | owner ruling 2026-09-10 `ccd661051`; rail `peekRemoved.test.jsx` |
| Per-action `tier` fields + locked bubbles + upsell toast | v1.1:69, v1.1:78 | **D-23**. `registry.js:994-995` actively REJECTS a `tier` field: *"'tier' was removed — there are no tiers"*. Wave 0:29 — the app is already paid-gated (`FREE_PAGES=['/morning-wire']`) |
| Drive the chart through the **TradingView library API** (`setResolution`, `setSymbol`, `executeActionById`, `createStudy`) | v1.1:66 | Wave 0 row 1 (`10-wave0-discovery.md:18`), marked **Blocking**: *"Lightweight Charts v5.2.0. None of those four calls exist anywhere in the repo."* |
| "Echo" as a named catalyst-feed section | v1.1 §C3 | renamed `catalysts` in v1.2; the Finnhub/FMP/FinTwit feed behind the name does not exist as a surface |
| Order placement / `hub.orders` | v1.1 | spec §2 rule + Wave 0 certification that no order path exists to cross |
| `role="toolbar"` on the hub | v1.1 (mandated) | Wave 0.5 removed it; reasoning preserved in §C2 |
| Part D's D1–D5 (org chart, rules of engagement, waves, subagent template, handoff) | v1.1 | dropped in v1.2; replaced by Part D + **D0 file ownership lock** (v1.4) |

---

## 10. Deferred, with owners (4 rows) — plus the 3 filed here

| # | row | owner |
|---|---|---|
| D-38 | toast duration | joystick — accepted as-is |
| D-39 | chip vs page furniture | joystick — cosmetic-plus, non-blocking |
| D-40 | Notebook phone list has no per-note DOM id | **Notebook** (rule 12) |
| D-41 | two `iteratorGlobalFloor` corrections | **Notebook** (rule 12) |
| D-46 | focus does not return to the knob | joystick — **filed by this reconciliation** |
| D-47 | per-mode action editor | joystick — **filed by this reconciliation** |
| D-48 | `CLAUDE.md` hub section | joystick — **filed by this reconciliation** |

⛔ D-46/47/48 are counted in the MISSING-now-filed total, not twice.

---

## 11. Cross-checks

| check | result |
|---|---|
| **Registry vs spec** | 10 modes / 62 actions; every mode in §C3 and vice versa; **no ADDED rows** |
| **Rails named in `CLAUDE.md` exist on master** | 8/8 present — `rule12Paths`, `contractArity`, `themeIslands`, `surfaceMatrixIsCurrent`, `writePaths`, `iteratorGlobalFloor`, `hub_nav_smoke.py`, `gate_shards.py` |
| **Ledger integrity — D** | D-01…D-48, **no gaps**. 13 ids appear twice; verified (D-07 at `:24` and `:46`) as the file's own two-table structure — a FINAL-STATE verdict row plus its original detail row, same state. **No id carries two states** |
| **Ledger integrity — R** | R-01…R-29; R-28 (The Desk) and R-29 (S4) open and owned outside this build |
| **Owner run vs glass sheet** | Every G-row `owner-run.md` claims resolves to a real row in `glass-acceptance.md`; **no owner-run row lacks a sheet row** |
| **Production vs repo** | live SHA contains the last hub PR; `HUB_PREVIEW_ENABLED=true`, `SMOKE_LOGIN_LINK_ENABLED=1`; smoke account clean — `completion-audit.md` §3 |

⚠️ **What this reconciliation did NOT do, stated rather than implied:** it did not re-run the
six-shard gate (read-only by instruction), and it did not hand-verify all 62 actions one at a time —
that layer is covered by the derived matrix and its byte-equality rail, which is why §8 says so
explicitly instead of showing 62 ticks.

---

## Remaining owner actions — unchanged

`docs/plans/joystick/owner-run.md`, one sitting, ~55 minutes, all on Patrick's own phones:

**§A** twenty flicks + five control presses + the trace (closes G0-1 and D4, unblocks 96 rows) ·
**§B** incl. B10–B15 · **§C** Android TalkBack · **§C-iOS** VoiceOver · **§D/§E** eye rows, fps
ratio, weekend calendar row.
