---
id: GATE-S1-CP3-PANEL-REGISTRY
title: S1 CP3 — panel registry formalization — scoped proposal
role: narrow, checkpoint-scoped pre-implementation proposal. Nothing builds until an
  approval line below is signed, and nothing builds past the scope that line names.
status: PROPOSED — not signed. CP3+ is GATE-S1's own next open item (its status line,
  2026-09-19/20: "CP3+ ... is the next open item; OI-06 is answered and A2 is DONE too,
  so it may already be proposable — not yet checked in detail"); this is that check,
  narrowed into a signable unit. CP1 (`b7e7541a0`) and CP2 (`8baca199b`) are already
  built/merged/signed and untouched by this proposal.
date: 2026-09-20
sources: GATE-S1 (s1-terminal-shell-pre-implementation-gate.md, read in full this pass
  — §2, §3, §5, §6, the CP1/CP2 approval blocks and status line), product-architecture.md
  §5 S1 block (lines 317-330, read verbatim) and §10 reversibility ledger row
  "OI-06 → D1 workspace final lock", information-architecture.md (§L2 entity-page row
  line 85, the eleven-doors observation line 110), capability-infrastructure-matrix.md
  S1 row, capability-ledger.md row C1, tech-debt-register.md TD-02,
  ARCHITECTURAL_DECISION_REGISTER.md DEC-01, verification/2026-09-14/
  OI-06-telemetry-derived-defaults.md §4, COMPLETION_AUDIT.md S1 row (line 124) and A2
  row (line 153), plus fresh verification this pass against `feat/s7-price-level`
  (identical to `origin/master` @ `a7176a764` — no code was touched to write this
  proposal): direct reads of `app/src/surfaces/{manifest,pageTitle}.js`,
  `app/src/widgets/registry.js` (all entries, `menus` shape), `app/src/pages/charts/
  {ChartsWorkspace,WidgetHost,WidgetHeader}.jsx`, `app/src/pages/charts/grid/
  useStaggeredMount.js`, `app/src/pages/research/ResearchPage.jsx` (full changelog
  comment history), and repo-wide `git grep` for `registerPanel`/`promote(`/`popout(`
  across `app/src` (empty).
---

# S1 CP3 — Panel Registry Formalization — Scoped Proposal

## ⛔ APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-21
APPROVED AT SHA:  fc609961a
SCOPE APPROVED:   S1 CP3 -- panel registry formalization, per docs/terminal-research/12-decisions/gates/s1-cp3-panel-registry-scoped-proposal.md section 2. MUST: registerPanel(manifest), a validation/registration function over the existing WIDGET_REGISTRY shape (app/src/widgets/registry.js), adding a fifth menus.terminal boolean (default false for every existing entry, the count derived from the registry and never typed -- no existing entry's behavior changes) and validating required labels/defaults/paramsSchema at registration time instead of first render; one TD-02 error boundary in WidgetBody keyed on instance id so one throwing widget no longer takes the whole board down; porting the existing, generic useStaggeredMount hook to the single-board path (ChartsWorkspace.jsx/WidgetHost.jsx) with an explicit panel-mount cap, defaulting conservatively to the Multi-Chart Grid's own limit=3 concurrent-mount behavior absent a stated owner preference. SHOULD (included in this approval): popout(panel) and promote(route -> panel) as named, tested wrapper functions over the existing, already-working PopoutWindow/PopoutShell/PoppedLayout mechanism and the existing embedded-prop duality on Watchlists/ThemeTrackerPage/Screener -- zero behavior change, a stable call signature added on top of what already ships. EXPLICITLY DEFERRED, NOT AUTHORIZED BY THIS LINE: the entity page (/research/:sym) becoming a fourth registry-hosted surface kind; opening an entity-page lens from inside a /charts panel; any change to the fixed/modular/hybrid board model or DEC-01's RECOMMENDED/REVERSIBLE status; the OI-06-diff-against-shipped rework list. No member-visible change beyond popout/promote's identical-behavior formalization. No flag armed.
```

Until every line above is filled in, nothing in §2 is authorized. GATE-S1's own rule
for CP1/CP2 applies unchanged here: an approval line must name a checkpoint, never the
bare system — CP3 is its own decision, not inherited from CP1/CP2's signatures.

---

## 0. What this is, and what it is not

This is **not the full "surface kinds become real" build** GATE-S1 §3 named and
explicitly refused to scope ("CP3+ ... Not proposable until then"). It is the first
attempt to scope it, now that both stated preconditions are cleared — OI-06 answered
2026-09-14, A2 marked DONE 2026-09-19 (COMPLETION_AUDIT.md lines 124, 153) — and it
narrows CP3 into a slice that is small, evidenced, and **does not touch the one thing
that is still genuinely undecided** (DEC-01, §1 below).

**Not built today, confirmed fresh this pass:** `registerPanel`, `promote(`, and
`popout(` — the three primitives product-architecture.md §5 names for S1 — appear
nowhere in `app/src` (`git grep -n "registerPanel\|promote(\|popout(" origin/master --
app/src` returns no matches). The manifest CP1 built has exactly two importers
(`pageTitle.js`, `manifest.test.js`); nothing reads it for hosting behavior. This
matches the prior research pass's finding and this pass re-confirms it independently.

**One thing that finding did not surface, and this pass did:** a real, member-facing,
12-tab consolidated per-ticker page already exists — `/research/:sym`
(`app/src/pages/research/ResearchPage.jsx`) — built incrementally by *other*,
already-tracked initiatives (A6/A7 2026-09-03, A8/I1 2026-09-04, a Technical-tab
convergence 2026-09-05, Wave H 2026-09-07), entirely independent of S1. §4 below treats
this as evidence, not as a reason to change the CASE determination: the page exists;
the platform contract that would let a *second* consumer reuse its lenses without
bespoke wiring does not.

---

## 1. Why this checkpoint, now

Because GATE-S1's own status line asked for exactly this check, and because leaving
CP3 unscoped has a cost that is compounding, not static: `ResearchPage.jsx`'s own
comment history (six dated additions, 2026-09-03 through 2026-09-09) shows each new
tab landing as its own hand-wired import — "`Technical` is a NEW tab... Source is the
EXISTING `/api/patterns/{sym}` endpoint," "`Ask AI` is the ONE contextual AI door...
Placed last." That is precisely the anti-pattern product-architecture.md §5 calls out
for S1's *board* ("a hand-curated widget list that grows slower than the product" —
`WIDGET_REGISTRY`, measured at **20 entries** (re-derived 2026-09-21 by parsing the
literal on origin/master; ⚰️ this said 21, a miscount, same 20 at `1b1903257`, at HEAD
and at master), up from the 18 the survey cited, `workspace-systems-survey.md:43`) — except here it is a hand-curated *tab* list
growing *faster* than any registry tracks it. Same root cause (no registry), opposite
symptom. Every tab shipped this way works today; the cost is that the next consumer
(a chart widget wanting to open one lens inline, an alert wanting to deep-link to one
tab from a different surface than the ones already wired) pays the wiring cost again
from scratch, because there is no `registerPanel`-shaped seam to plug into.

**What is explicitly NOT ready, and why this proposal does not wait for it:**
DEC-01 (workspace model: fixed/modular/hybrid) is still **RECOMMENDED, REVERSIBLE**,
not LOCKED (`ARCHITECTURAL_DECISION_REGISTER.md` DEC-01 status line). OI-06 answered
one of its two named gates (the desk-morning read); the `charts_workspace_layout`
telemetry query also ran (`OI-06-telemetry-derived-defaults.md` §4: "members DO
customize... 17 stored layouts, 7 distinct widget signatures") — but the owner ruling
recorded in GATE-S1's parent history (PHASE_2_INTEGRATION_SYNTHESIS.md §10, quoted in
`COMPLETION_AUDIT.md`'s S1/S2 exception note) requires OI-06's findings to be
**diffed against what already shipped and produce a rework list** before any further
PROVISIONAL/OWNER-BOUND system finalizes — and no diff/rework-list artifact exists
yet (confirmed: no file under `docs/terminal-research/verification/` or
`00-program-control/` performs it). This proposal does not perform that diff either.
It instead relies on product-architecture.md §10's own reversibility ledger, which
states plainly: *"S1's contract (manifest, promotion, error isolation, pop-out) is the
same under fixed, hybrid or modular... Nothing in S1's contract changes under either
outcome — that is the reversibility."* CP1 and CP2 already shipped on this same logic
without waiting for DEC-01's final lock (GATE-S1 §6). This proposal's MUST-BUILD scope
(§2) is chosen specifically to stay inside that same reversible boundary — nothing
here decides fixed vs. modular vs. hybrid, and nothing here builds the entity page as
a fourth surface kind (§2 DEFER).

---

## 2. Exact scope

**MUST BUILD** (small, additive, identical under any DEC-01 outcome per §1's
reversibility argument; matches GATE-S1's own §5 "no member-visible change" and "no
flag armed" constraints):

- **`registerPanel(manifest)`** — a thin validation/registration function over the
  **existing** `WIDGET_REGISTRY` shape in `app/src/widgets/registry.js`, exactly as
  capability-infrastructure-matrix.md's S1 row already specifies: *"Build
  `registerPanel(manifest)` on the existing widget-registry shape (C2 — 'adopt as the
  panel manifest; add `menus.terminal`')."* Confirmed this pass: today's `menus` object
  carries only `{workspace, tab, mobile, journal}` booleans (`registry.js:172`,
  `chart` entry) — no `terminal` key exists. This checkpoint adds it as a fifth,
  default-`false` flag and a registration function that validates an entry's shape
  (required `labels`, `defaults`, `paramsSchema`) before it lands in the registry, so
  a malformed entry fails at registration time instead of at first render (today's
  failure mode, per `registry.test.js`'s own characterization-rail framing). **No
  existing entry's behavior changes** — `menus.terminal` defaults false for every existing entry (the count is derived from the
  registry, never typed: ⚰️ this said "all 21"; the registry holds 20).
- **The TD-02 error boundary** — `tech-debt-register.md` TD-02, confirmed still absent
  this pass (`grep -n ErrorBoundary app/src/pages/charts/{ChartsWorkspace,WidgetHost}.jsx`
  → no matches, both files, both this pass and the register's own citation). One
  boundary in `WidgetBody`, keyed on instance id, so one throwing widget can be closed
  instead of taking the whole board to `RouteErrorBoundary`. Named repeatedly across
  three independent documents as "the cheapest fix in the estate" — it belongs in
  MUST-BUILD precisely because it costs little and because `promote`/`popout` (SHOULD,
  below) make panel failures matter more, not less, once a panel can travel further
  from its origin page.
- **Port `useStaggeredMount`** (`app/src/pages/charts/grid/useStaggeredMount.js`,
  confirmed generic — accepts any `ids` array with `{limit, slotTimeoutMs}`, already
  built and tested for the Multi-Chart Grid) **to the single-board path**
  (`ChartsWorkspace.jsx`/`WidgetHost.jsx`), and **publish an explicit panel-count
  cap** — confirmed absent today (`capability-ledger.md` row C1: "no widget-count cap
  or mount queue (geometry is the implicit bound)"; independently re-confirmed this
  pass, no `MAX_WIDGETS`/`widgetCap`/`panelCap` literal anywhere under
  `app/src/pages/charts`). This closes a named, cited gap using a hook the codebase
  already trusts, rather than inventing a second mount-queue idiom.

**SHOULD BUILD** (formalizes behavior that already ships today under bespoke wiring —
chosen because it costs no new *capability*, only a name and a test, per S1's own
"Must NOT own... a hand-curated widget list" boundary applied to what already exists):

- **`popout(panel)`** as a named wrapper over the existing, working mechanism —
  `PopoutWindow.jsx`/`PopoutShell.jsx`/`PoppedLayout.jsx` (imported at
  `ChartsWorkspace.jsx:32-36`) plus the pop-out buttons in `WidgetHeader.jsx:313-344`.
  Same behavior, same files underneath; the difference is a stable, testable function
  signature future call sites (a chart widget, a future entity-page lens) can call
  without re-deriving the popout-window/shared-SSE-pool contract from scratch.
- **`promote(route → panel)`** as a named wrapper over the existing `embedded` prop
  pattern — `Watchlists.jsx`/`ThemeTrackerPage.jsx`/`Screener.jsx` already run both
  standalone-as-a-route and embedded-as-a-panel (`CLAUDE.md`'s own Charts Hub V2
  section: *"`embedded` prop on Watchlists/ThemeTrackerPage/Screener hides their
  right-side StockChart panel + tightens chrome"*). Formalizing this as `promote`
  means the *next* page that wants both modes adopts one contract instead of
  re-deriving the `embedded` boolean idiom per page, as three pages have already done
  independently.

**DEFER** (named explicitly so this proposal does not silently re-open what GATE-S1
or the reversibility ledger already closed):

- **The entity page as a registry-hosted fourth surface kind.** `/research/:sym`
  (`ResearchPage.jsx`) already delivers the member value product-architecture.md's S1
  responsibility line describes — a consolidated per-ticker page reached from many
  surfaces (§4 below) — via 12 hand-wired tabs, not a lens registry. Rebuilding its
  plumbing on `registerPanel` has no near-term member benefit until a second consumer
  needs the same lenses (the same "wait for the second call site" discipline this
  program already applies to D1/D2's build-out exception, product-architecture.md
  §10). Real work, explicitly not this checkpoint's.
- **"Open this lens on the entity page" from inside a `/charts` panel** — i.e., a
  chart widget's context menu opening one `ResearchPage` tab as an inline board panel.
  Confirmed not built (no `ResearchPage`/`research/:sym` reference anywhere in
  `registry.js` or `WidgetHost.jsx`). New, real, undesigned — a genuine CP3b/CP4-shaped
  item, not this one.
- **Any change to the fixed/modular/hybrid board model.** DEC-01 stays exactly as
  RECOMMENDED/REVERSIBLE as it is today; nothing here locks it, and nothing here needs
  it locked, per §1's reversibility argument. RG-27 (the dock-library spike) stays out
  of scope with it — GATE-S1's own §3 calls it "decision-relevant only if D1 moves."
- **The OI-06-diff-against-shipped rework list.** Named in §1 as a real, outstanding
  program obligation on the S1/S2 PROVISIONAL-SHIPPED exception generally — genuinely
  not done, and not something this narrow checkpoint proposal can discharge on its
  own. Flagged as an owner-bound question (§6), not silently absorbed into this scope.

---

## 3. Current state → target state

**CURRENT STATE**, confirmed this pass:

| Component | State |
|---|---|
| `registerPanel`/`promote(`/`popout(` | **Absent, repo-wide** (`git grep`, `app/src`, empty). |
| `WIDGET_REGISTRY` (`app/src/widgets/registry.js`) | 20 entries (re-derived 2026-09-21; ⚰️ this said 21 — a miscount; `workspace-systems-survey.md:43` cites 18 — drifted since that survey). `menus` shape is `{workspace, tab, mobile, journal}` — no `terminal` key. Metadata-only by design (file header, lines 1-15): "no component imports, no host imports, no CSS." |
| TD-02 (per-widget error boundary) | Confirmed absent this pass, same two files the register cites. |
| Panel-count / mount-queue cap on the single board | Absent (capability-ledger C1; re-confirmed, no cap literal under `app/src/pages/charts`). `useStaggeredMount` exists but only under `pages/charts/grid/` (Multi-Chart Grid), never imported by `ChartsWorkspace.jsx`/`WidgetHost.jsx`. |
| Pop-out | **Working, real code** — `PopoutWindow.jsx`, `PopoutShell.jsx`, `PoppedLayout.jsx`, wired from `WidgetHeader.jsx`'s pop-out buttons. Not named as a primitive; no test asserts a stable `popout(panel)` contract. |
| Page ↔ panel duality | **Working, real code** — the `embedded` prop on three pages. Not named as a primitive; each page re-implements the boolean independently. |
| The entity page | **Substantially shipped, not registry-hosted.** `/research/:sym` — 12 tabs (Overview, News, Technical, Financials, Estimates, Analyst Ratings, Ratings, Ownership, Calls & Transcript, Filings, Ask AI, My Research), deep-linkable via `?section=`, cross-linked from `TickerPopup`, `TradeDrawer`, `PositionDetailPage`, chart widgets, and breadth drill (all confirmed via `git grep` this pass). Every tab is a static import in a hand-typed `TABS` array — no `registerPanel`-shaped seam. |
| DEC-01 (workspace model) | **RECOMMENDED, REVERSIBLE** — not LOCKED. OI-06 and the `charts_workspace_layout` query both ran; the owner's own diff-against-shipped step has not (§1). |

**TARGET STATE** for this checkpoint: `registerPanel(manifest)` exists and validates
against the (extended) `WIDGET_REGISTRY` shape; every board widget survives a sibling's
crash (TD-02 closed); the board's mount count is explicitly bounded the same way the
grid's already is; `popout`/`promote` exist as named, tested functions wrapping
*exactly* today's behavior — zero behavior change, one seam added. The entity page,
DEC-01, and cross-surface lens-hosting are unchanged and unblocked for a later
checkpoint to pick up.

**THE GAP**: exactly the MUST/SHOULD lists in §2 — naming and hardening what mostly
already exists, plus the one genuinely new artifact (`registerPanel`'s validation
function and the `menus.terminal` flag it reads).

---

## 4. What this pass found that the prior research pass did not: `/research/:sym`

The prior research pass concluded "no entity-page/panel-hosting work exists anywhere
in `app/src`," verified by grepping for the *primitives* (correct — they don't exist).
It did not check whether the *product outcome* the entity page is meant to deliver had
been shipped some other way. It has:

- `information-architecture.md` line 85 names `/research/:sym` as one of the
  **current-state precedents** for "L2 — The entity page," alongside `TickerPopup` and
  "the eleven doors of Q7" — describing it at the time (dated 2026-09-02, this file's
  own frontmatter) as "12 panels in 5 tabs: Setup · Company · The Print · Coverage ·
  Ask AI."
- `ResearchPage.jsx`'s own in-file changelog shows six dated, owner-authorized
  additions **after** that date — 2026-09-03 (Filings rename, Analyst Ratings split),
  2026-09-04 (News, Ask AI/I1), 2026-09-05 (Technical), 2026-09-07 (Wave H, My
  Research) — landing a materially different, larger 12-tab shape than the
  architecture document's own "current state" column describes.
- The page is now reached from at least five other surfaces via a canonical "Full
  Research" link (`TickerPopup`, `TradeDrawer.jsx`, `PositionDetailPage.jsx`,
  `TradeDetailPage.jsx`, chart widgets' Ask AI door, breadth drill), each independently
  confirmed this pass via `git grep`.

**This does not change the CASE determination** — the platform-level contract CP3
would build (`registerPanel`/`promote`/`popout`, a registry any *second* consumer can
plug into) genuinely does not exist, confirmed independently by this pass. What it
changes is the argument in §1: CP3's value is not "give members a consolidated
security page" — that shipped, through other tracked work, ahead of the platform that
was meant to generalize it. CP3's real value is stopping the *next* per-ticker
addition (and the *next* board widget) from paying the same bespoke-wiring cost again.

---

## 5. Risks

| Risk | Real, because | Mitigation this checkpoint carries |
|---|---|---|
| **`registerPanel` becomes an unused abstraction** — built before any second consumer needs it, the exact anti-pattern §2 DEFER cites for the entity page. | `WIDGET_REGISTRY` already works without a validation wrapper; its 20 entries ship fine today. | Scoped as a thin, additive validation layer over the *existing* shape (no new fields required of current entries besides a defaulted `menus.terminal: false`) — cost is small enough that "unused" is a low-consequence outcome, unlike a full registry-hosted entity-page rebuild. |
| **`promote`/`popout` naming existing behavior reads as busywork.** | Both mechanisms already work; nothing user-visible changes. | Named explicitly as the point in §2 SHOULD — the payoff is the *next* page/panel adopting one contract instead of re-deriving `embedded` or the popout wiring from scratch, not a member-facing change today. |
| **The panel-count cap picks the wrong number** — too low frustrates a power user's board, too high defeats the point of `useStaggeredMount`. | No production telemetry on max concurrent widgets per board was queried this pass (out of scope — a live-DB read, same category GATE-S1 and the sibling D3 CP4 proposal both flag as owner-bound rather than run unilaterally). | Named as an owner-bound question (§6) rather than a guessed constant; `useStaggeredMount`'s own `limit` parameter is proven adjustable without a schema change (Multi-Chart Grid already tunes it). |
| **This checkpoint is read as clearing DEC-01 or the OI-06 diff-against-shipped obligation by proxy**, because it ships under the S1 banner right after those items were discussed. | The S1/S2 PROVISIONAL-SHIPPED exception's own text warns exactly against this shape of drift. | §1 states explicitly, in the same words as the reversibility ledger, that nothing here decides DEC-01 or discharges the diff obligation; §6 asks the question directly rather than assuming silence means "not needed." |
| **TD-02's boundary is added but never exercised** — a boundary component with no test that actually mounts a throwing widget is a boundary nobody has seen catch anything (this program's own recurring "a guard nobody has watched fail is not a guard" lesson). | Confirmed this pass: no existing test in `ChartsWorkspace.test.jsx`/`WidgetHost.test.jsx` mounts a throwing widget. | §7's acceptance plan requires exactly that test, mutation-proved (removing the boundary must fail it). |

---

## 6. Owner-bound questions

**Two, stated rather than assumed away:**

- **Does the owner want the OI-06-diff-against-shipped rework list (§1) produced
  before signing *any* further S1/S2 checkpoint, or does this proposal's explicit
  non-touching of DEC-01 (the same reversibility logic CP1/CP2 already shipped under,
  GATE-S1 §6) mean it can proceed on its own terms?** This proposal takes no position
  — it names the obligation and does not assume it is waived.
- **What panel-count cap should `useStaggeredMount` enforce on the single board?**
  No production telemetry on concurrent-widget counts per member was queried this
  pass (a live-DB read outside this checkpoint's remit, matching the discipline
  `d3-cp4-price-level-consumer-scoped-proposal.md` §6 already used for a sizing
  question of the same shape). A conservative default (e.g., matching the Multi-Chart
  Grid's own `limit=3` concurrent-mount behavior, applied to *mounting* rather than to
  the RGL-geometry-bounded total count) can ship without that measurement and be
  tuned later.

No other owner decision blocks this checkpoint. OI-06 and A2 are both answered/DONE
(frontmatter, COMPLETION_AUDIT.md lines 124/153). DEC-01's final lock, the entity page
as a fourth surface kind, and cross-surface lens-hosting are all explicitly DEFERRED
(§2), not open questions this checkpoint needs answered.

---

## 7. Test & acceptance plan

| Test | Proves |
|---|---|
| `test_registerPanel_validates_required_manifest_fields` | A manifest missing `labels`/`defaults`/`paramsSchema` is rejected at registration, not at first render. |
| `test_registerPanel_defaults_menus_terminal_false_for_existing_entries` | Every current `WIDGET_REGISTRY` entry (the test iterates `Object.keys(WIDGET_REGISTRY)` and asserts against that length, never a typed count; 20 today) passes through unchanged; `menus.terminal` defaults `false` — zero behavior change for existing widgets. |
| `test_throwing_widget_is_isolated_by_error_boundary` | Mounts a widget that throws on render inside `WidgetBody`; asserts sibling widgets stay mounted and interactive — mutation-proved (deleting the boundary must fail this test). |
| `test_board_mount_count_is_bounded_by_staggered_mount` | Adding N widgets past the published cap leaves only `limit` concurrently mounted, mirroring `useStaggeredMount.test.js`'s existing grid coverage applied to the single-board path. |
| `test_popout_wraps_existing_popout_window_behavior_unchanged` | `popout(panel)` produces byte-identical behavior to today's `WidgetHeader` pop-out button path (a characterization test, not a new-behavior test). |
| `test_promote_wraps_existing_embedded_prop_unchanged` | `promote(route)` on Watchlists/ThemeTrackerPage/Screener produces byte-identical output to today's direct `embedded` prop usage. |
| `test_registry_test_js_pins_stay_green` | The existing `registry.test.js` characterization rail (labels/defaults/menus/paramsSchema per entry) passes unmodified — this checkpoint adds a field and a function, never edits an existing entry. |

**Acceptance for the checkpoint as a whole:** all of the above green; the existing
`ChartsWorkspace.test.jsx`, `WidgetHost.test.jsx`, `WidgetHeader.test.jsx`,
`useStaggeredMount.test.js`, and `registry.test.js` suites remain green unmodified;
manual verification that the live `/charts` board renders identically before and
after (no widget's header, menu membership, or behavior changes) — matching the "no
member-visible change" constraint GATE-S1 §5 sets for every checkpoint below CP1.

---

## 8. What follows if this ships

Per GATE-S1 §6 and product-architecture.md §10's reversibility ledger: this checkpoint
changes nothing about DEC-01's eventual lock and pre-decides neither fixed, modular,
nor hybrid. The natural next checkpoint — the entity page as a registered surface kind,
or "open this lens on a panel" — waits on a second real consumer materializing (§2
DEFER) and, per §6, on the owner's ruling about the outstanding OI-06
diff-against-shipped obligation. Neither is proposed here.
