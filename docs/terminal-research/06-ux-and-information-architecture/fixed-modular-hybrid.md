---
id: C5-03
role: the fixed / modular / hybrid decision for Terminal-Next's workspace interaction
  architecture. Gated deliverable, MASTER_CHECKLIST item 20, gate item 14, Parts XXI /
  CCVII / LXXII. Written 2026-09-25.
inputs: C5-01 `workspace-systems-survey.md` (accepted) · C5-02 `personalization-patterns.md`
  (accepted) · D-06 `07-technical-architecture/current-ui-architecture.md` (accepted) ·
  D-11 `01-existing-system/state-persistence-and-workspaces.md` (accepted)
gates: ARCH-01 `target-A-fixed-pages.md`, ARCH-02 `target-B-hybrid.md`,
  ARCH-03 `target-C-modular.md` — none of the three exists yet; this document is what
  decides which of them gets written first.
status: PROVISIONAL LOCK. Red-team required before gate item 14 closes.
---

# Workspace interaction architecture — fixed / modular / hybrid

## 0. Headline

**DECISION (provisional): HYBRID.** Fixed pages own market-wide questions; one composable
board owns portfolio-specific questions; and the two layers are joined by a *generic*
promotion/demotion operation rather than by a hand-curated widget per function.

⛔ **But the taxonomy in the contract is not where the risk lives, and locking it is the
least important thing this document does.** Across the benchmark set, **six of the seven
failure modes a workspace actually suffers are persistence failures, not layout failures**,
and **none of seven surveyed layout libraries ships a schema-version field or a migration
story** [C5-01 §0, §7, §8]. UCT already runs a working composable board. What it does not
run is a workspace *document*.

So the three real commitments below are not "fixed vs modular". They are:

1. **Promotion is generic, or the board inherits an 18-entry ceiling** (§4).
2. **The workspace is one versioned document, and `user_preferences` is not where it
   lives** (§5) — this resolves a direct contradiction between two accepted inputs.
3. ✅ **Per-panel error isolation, the close control outside it, and a mount cap — all
   three ALREADY SHIP** (§6, corrected 2026-09-25; `424bf3355`, live on production). This
   was drafted as an unmet precondition on D-06 §1.7's *"no matches. CONFIRMED"*; that
   finding is stale. It becomes a **standing invariant any new shell must preserve**, and
   it *strengthens* the hybrid lock, because the blast-radius objection to composition is
   already mitigated in shipped code.

**CONFIDENCE.** 🟢 on the reframe and on commitments 2 and 3 — both rest on measured code
facts and on this program's own accepted inputs. 🟡 on the hybrid lock itself, because the
strongest evidence for it is a 29-account internal cohort of staff (§3). ⚠️ OI-06 HAS landed
(owner, 2026-09-19) and supports hybrid without separating it from modular; the open input is
a desk-observed morning (§7). **Lock provisionally; re-read §7 before ARCH-02 is authored.**

---

## 1. The question as asked, and the question that decides it

The contract asks whether Terminal-Next should be a fixed page model, a modular dock, or a
hybrid, and whether today's `/charts` workspace is a reusable workspace primitive.

C5-01 answers the first half by refusing its framing, and the refusal is the most useful
sentence in the input set:

> "workspace design is not a spectrum from 'simple page' to 'dock manager'. In the products
> that work best it is a **two-layer architecture with named, symmetric traffic between the
> layers**." [C5-01 §0]

Bloomberg is the best-evidenced instance: four fixed panels plus a free-floating Launchpad,
where `LLP` promotes any function into the workspace as a live component and per-row
function shortcuts demote a workspace click back into a fixed panel [C5-01 §0, citing
B-BBG-02 §1/§8]. The consequence C5-01 draws is the one that matters here:

> "**because promotion is generic, Bloomberg never had to build a widget per function** —
> the component set is a by-product of the function set." [C5-01 §0]

So the decidable questions are: **can a fixed page become a panel, and can a panel hand off
to a fixed page?** and **who owns the document schema?** [C5-01 §0]. Neither is about the
grid. The rest of this document is organised on those two.

**Where UCT already sits.** On the *content* split, correctly: Dashboard, Breadth, Movers,
Catalysts and Live Flow are fixed pages answering market-wide questions, and `/charts` is
the composable board for portfolio-specific ones [C5-01 §0]. What is absent is the
graduation path in either direction, and a versioned workspace document [C5-01 §0].

---

## 2. The three options, defined so they can be compared

| | A — fixed | B — hybrid | C — modular |
|---|---|---|---|
| Shell | designer-set pages, no member arrangement | fixed pages **+ one** composable board | everything is a panel in a dock |
| Member act | navigate | navigate, and compose where composition pays | compose |
| Saved object | none (or a filter set) | one workspace document per board | one workspace document, unavoidable |
| Failure surface | a page breaks | a page breaks; a panel's failure is **contained** (§6) | a panel's failure is contained, but the dock is the only surface |
| First-run | always correct by construction | correct by construction, board starts seeded or empty | blank canvas — the known-hard problem [C5-01 §4] |

⛔ **Option A is not "do nothing", and option C is not "what UCT has".** UCT today is
already B-shaped in content and C-shaped in mechanism: no seeded first-run, a hand-curated
registry, and no cap on how many panels a board may hold (⚠️ distinct from concurrent MOUNTS,
which are capped at three — see §6). Choosing B is therefore a *constraint* on an
existing system, not a greenfield pick.

---

## 3. The axis the survey could not measure, now measured

C5-01 marked one axis 🔴 and said so plainly:

> "**Do users actually customize?** 🔴 **Unmeasured externally, and unmeasurable from
> public sources.** Answerable only from UCT's own `user_preferences`." [C5-01 §10, §6]

`READINESS_REVIEW_DAY1` names that query as a precondition for a final lock: *"OI-06 and the
`charts_workspace_layout` telemetry query should confirm before final lock"* [L337-338].

**Measured 2026-09-25, read-only aggregate over production `auth.db` (`user_preferences`,
`pref_key`/`pref_value`). No member id, no blob content, counts only.**

| | |
|---|---|
| accounts on production | **29** |
| accounts with a `charts_workspace_layout` | **17 (59%)** |
| of those, boards with **zero** widgets | **0** |
| widget-count distribution | 1→2 · 2→2 · 3→4 · 4→2 · **5→7** accounts |
| accounts with `charts_workspace_groups` | 16 |
| accounts with `multichart_state` | 5 |
| accounts with `chart_settings` | 9 |
| layout blobs **carrying a `version` field** | **0 of 17** |
| layout blobs **unparseable** | **0 of 17** |
| blob size | median 476 B, max 8,752 B |
| distinct preference keys in use app-wide | 49 |

**INTERPRETATION — three findings, in descending strength.**

1. ⭐ **Everyone who has a board has composed one, and the modal board is the maximum
   observed size.** Seven of seventeen sit at five widgets and none sit at zero. Whatever
   else is true, the composable layer is *used* by the people who have it — this is not a
   feature sitting idle.
2. 🟢 **The unversioned finding is now empirical, not just structural.** Zero of seventeen
   live blobs carry a version field, which is exactly what D-11 §2.1 predicted from source
   ("no `version` or `schemaVersion` key anywhere in the layout blob").
3. 🟢 **The silent data-loss path has not fired in this corpus.** Zero unparseable blobs
   answers D-11's own 🟡 on whether that path has ever fired [D-11 §2.2]. It remains a live
   path; it is not a live incident.

⛔⛔ **AND THE CEILING ON ALL THREE, STATED BEFORE ANYONE QUOTES THEM.** Production is in
`COMING_SOON_MODE`; those 29 accounts are **admins, staff and testers**, several of whom
built this board. *Staff composing their own tool is weak evidence about members*, and the
direction of the bias is the flattering one. **This measures the cohort, not the market.**
It is sufficient to retire "nobody customises" as an assumption and **insufficient** to
carry the hybrid lock by itself — which is why §7 keeps OI-06 as the confirming input and
why the lock stays provisional.

⚠️ `n = 29` also means every percentage here moves by 3.4 points per account. Quote the
counts, not the percentage.

---

## 4. Commitment 1 — promotion is generic, or the board inherits a ceiling

C5-01's recommendation-as-hypothesis is directly actionable and this document adopts it:

> "*A widget system earns its keep when promotion is generic rather than per-widget.* Test
> one operation — 'open this page as a panel' — against UCT's existing routes before
> authoring more registry entries. **Anti-pattern:** a workspace that can only contain
> things somebody remembered to build a widget for." [C5-01 §0]

UCT is currently on the anti-pattern side: an 18-entry hand-curated `WIDGET_REGISTRY` that
"grows slower than the product does" [C5-01 §0, citing D-06 §1.1]. The registry itself is
good and reusable — it deliberately imports no components, no hosts and no CSS so any host
can read it, and `menus.*` already models per-shell availability [D-06 §1.1]; the advice is
to adopt it essentially unchanged and add a `menus.terminal` flag rather than fork it.

**So the commitment is not "replace the registry".** It is: **the number of registry entries
must stop being the bound on what the board can hold.** A hybrid whose panel set is a
hand-maintained subset of the product's own surface area re-buys the ceiling that made this
question worth asking.

⛔ **Test to run before ARCH-02 is authored, and before any new registry entry is
authored:** take one existing route that is *not* in the registry and mount it as a panel
through a generic path. If that costs a bespoke widget, option B is more expensive than this
document assumes and §7 applies.

---

## 5. Commitment 2 — one versioned document, and NOT in `user_preferences`

### 5.1 The two accepted inputs contradict each other here

This is the sharpest substantive divergence in the input set, and a decision document that
did not resolve it would be decoration.

* **D-06 says version it in place:** *"Stamp a `version` on `charts_workspace_layout` before
  Terminal-Next touches it, and retire the `maxBottom` heuristic in the same commit"*
  [D-06 L224-225], leaving "one workspace document vs the current fourteen" open [L227].
* **D-11 says the store is the wrong primitive:** *"Treat `user_preferences` as the
  SCALAR-SETTINGS store. Give a TERMINAL-NEXT workspace its own store, modelled on
  `charts_layout_service.py` / `user_definitions.py` (own SQLite file, WAL, `_WRITE_LOCK`,
  explicit caps, an explicit delete)"* [D-11 L99-103], and *"the single strongest argument
  in the codebase for TERMINAL-NEXT persisting **one versioned workspace document** rather
  than a family of keys"* [D-11 L334].

### 5.2 RULING — both, sequenced; they are a bridge and a destination, not rivals

**D-11 wins on the destination. D-06 wins on the interim.** They read as a contradiction
because each names a different point in time, and the sequencing is what makes them
compatible:

1. **Now, before Terminal-Next touches the blob: stamp a version on
   `charts_workspace_layout` and retire the `maxBottom` heuristic in the same commit**
   (D-06's recommendation, unchanged). §3 measured **17 live boards, none of them
   versioned**. They need a schema handle before anything migrates them, and adding one is
   cheap and reversible. The `maxBottom` heuristic goes with it because it "will misfire on
   any *legitimate* future layout whose widgets all sit in the top half" [D-06 §1.4] — a
   version field is precisely what removes the need to infer shape.
2. **For Terminal-Next: its own store, D-11's shape.** The disqualifying facts are not
   aesthetic. `user_preferences` is *"an unversioned, uncapped, undeletable key→TEXT
   table"* [D-11 §1.1]; there is **no DELETE route** (`delete_user_preference` exists and is
   imported with no caller [D-11 §1.1]); dead keys therefore accumulate permanently [D-11
   §6.1]; and prefs are inlined into `/me`, so *"a large workspace blob is paid for on every
   page load by every surface"* [D-11 §1.1]. ⭐ **The repo already argued this against
   itself**: `user_definitions.py` opens with *"WHY NOT `user_preferences` — ALSO MEASURED:
   `user_preferences` has NO SIZE LIMIT and NO DELETE ROUTE… This store names its caps and
   ships a delete"* [D-11 §1.1]. A workspace document is exactly the growing, deletable,
   capped thing that argument was written about.

⛔ **The version stamp is the migration bridge to the new store, not a substitute for it.**
Anyone who ships step 1 and stops has left the board on a store whose own repo documents
why it is wrong for this.

### 5.3 What "one document" has to absorb — and the count this doc means

**The inputs disagree on how many keys "the workspace" is: D-06 says fourteen** [L217,
counting everything written from `pages/charts/`, including per-widget-type globals and
`multichart_state`]; **D-11 says eight** [L27-31, counting the template-apply bundle].
⛔ **This document means D-11's eight**, because the number that decides the design is *the
set that must commit or roll back together*, and that is the apply bundle:

> "Autosave is a 500 ms debounce with an unmount flush; applying or saving a named layout is
> **six-to-seven independent writes with no transaction**… A 'layout' is conceptually one
> thing and physically **eight**… A failed POST partway through `applyTemplate` leaves a
> board whose arrangement is the new template and whose look is the old one, with nothing
> detecting it." [D-11 §2.3; gap table: "Atomic workspace write | 🔴 **none**"]

Plus one device-local key (`uct.watchlist.cols`) that was dragged into the bundle by a real
bug: *"added columns vanished after switching layouts and back"* [D-11 §2.3]. D-06's
fourteen is the right number for "what a shell inherits"; eight is the right number for
"what one write has to make atomic". **Both are correct at their own scope and this document
uses the second.**

⭐ **The machinery to do this already ships, for one key only.** `chart_settings` carries
`settingsVersion: 2`, a read-time idempotent fold, a hard allow-list, tombstone deletes and
union-by-`instanceId` merge — *"the only place a **version number lives in the data**…
exists and works, for `chart_settings` only"* [D-11 §6.4]. The workspace document should be
built on that pattern rather than a new one. D-11's own closing line on its seed map is the
sentence to carry into ARCH-02: *"Every piece already ships. **None of them is currently
applied to the layout.**"*

⚠️ And one seam the document must close rather than inherit: **two competing widget-appearance
models on one board** — four types are global via `WIDGET_GLOBAL_PREF_KEYS`, the rest
per-instance. *"Two panels of the same type on one screen that cannot be styled differently
is a real product limit; a shared blob that changes when you open a saved layout is a real
data-loss surprise."* [D-11 §1.3]

---

## 6. Commitment 3 — per-panel error isolation: ✅ ALREADY SHIPPED, verified in code

⚰️⚰️ **CORRECTED 2026-09-25, HOURS AFTER THIS DOCUMENT FIRST SHIPPED. The first version of
this section called per-panel error isolation an unmet precondition of the hybrid choice,
quoting D-06 §1.7's** *"grep of `ChartsWorkspace.jsx` + `WidgetHost.jsx` → no matches.
CONFIRMED"* **and its** *"a widget that throws on every mount currently cannot be closed,
because its header is inside the subtree that fails."* **Both are now false.** Measured
directly, not inferred:

| D-06 §1.7 / §1.7-GAPS claim | Reality, `WidgetHost.jsx`, live on production |
|---|---|
| no per-widget error boundary | **`ErrorBoundary` wraps `WidgetBody` at `:107-111`**, with a `WidgetErrorFallback` naming the widget type and `key={groupId}` so a tab swap resets a tripped boundary. Its own comment cites the defect it closed: *"a widget that throws during render used to take the whole /charts board down to App.jsx's RouteErrorBoundary"* |
| the throwing widget cannot be closed | **The header renders OUTSIDE and BEFORE the boundary** — `WidgetHeader` at `:227` and `:254`, `WidgetBody` at `:270`. The close control survives its widget's failure |
| no mount queue (weakness #8, first half) | **`PANEL_MOUNT_CAP = 3`** (`ChartsWorkspace.jsx:84`) with a staggered-mount queue, and `WidgetHost`'s `mounted` prop defaulting true so only the main board's call site throttles |
| no board cap (weakness #8, second half) | ⚠️ **STILL TRUE, and this correction does not close it.** There is no `MAX_WIDGETS`: the bound on panels per board remains geometric (`FIXED_ROWS = 20`). Concurrent mounts are capped; board SIZE is not. §3 measured the largest live board at five panels, so nothing presses on it today |

All three landed in **one** commit on **2026-09-21** — `424bf3355`, *"S1 CP3: panel registry
formalization — registerPanel, TD-02 boundary, mount cap"* — and it is an ancestor of
`origin/production`. D-06 was accurate when written and is stale now.

### 6.1 What that does to the decision — it STRENGTHENS the lock

The argument this section originally made against hybrid was blast radius: fixed pages fail
one page at a time, a composable board fails at whatever its worst panel does, and §3
measures the modal board at **five** panels. **That objection is already mitigated in shipped
code.** Containment exists, the close control survives, and concurrent mounts are capped at
three — which is also the herd-protection the 2026-05-24 fetch-herd incident demanded.

So commitment 3 is not work to schedule. It is a **standing invariant to protect**: any
Terminal-Next shell that composes panels must keep (a) a boundary per panel, (b) the close
control outside it, and (c) a mount cap. ⛔ Losing any one of the three re-opens the
objection, and the third is the one most likely to be dropped by a new shell that "just
renders the list".

⚠️ **And the lesson, since this is the second correction of the same shape in one hour**
(see §7 on OI-06): **an accepted input is a claim about its own date.** Both errors came from
quoting a dated document as a live fact. The tell in both cases was cheap — one grep, one
table lookup — and in both cases the correction moved the decision toward *more* confidence,
not less, which is precisely why nobody would have gone looking.

---

## 7. What would overturn this, stated before anyone relies on it

⚰️ **CORRECTION, same day, and it is this document's own instance of the defect it was written inside.** The first version of this table and of GAPS said *"OI-06 is not in"* and called it the highest-value confirming input. **OI-06 was answered by the owner on 2026-09-19** and sits in `OWNER_INPUTS_REQUESTED.md`'s Answered table (L47): *thinkorswim, TradingView, Finviz and Unusual Whales all opened by hand, plus unitemized others; TradingView alerts part of the workflow.* CP-06 records the same and notes the answer *"closed four days before this correction and was never propagated"*. I took `READINESS_REVIEW_DAY1` L337-338 at its word — a document written **before** 09-19 — and did not check whether its named precondition had since landed. **The lesson is the one this program keeps paying for and I had corrected three times in the preceding hour: a precondition quoted from a dated document is a claim about that date, not about today.**

**What OI-06's real answer does to the lock.** It **mildly supports hybrid** and does not close it. The desk already composes across **four** external surfaces by hand, simultaneously, every trading day — which is behavioural evidence that a single fixed page is not how this desk works, and it is independent of §3's staff-cohort telemetry. ⛔ But it is **not** the signal READINESS_REVIEW actually named as overturning, which was *"a desk-observed morning showing the desk wants a **fully modular** surface"* — four hand-opened tools is consistent with B and with C, and cannot separate them. Row 1 is renamed accordingly.

| # | Signal | Effect |
|---|---|---|
| 1 | **A desk-observed morning showing the desk wants a fully MODULAR surface** [READINESS_REVIEW L339-340]. ⚠️ Not OI-06 — that is answered (above) and supports B without separating B from C. This needs watching the desk work | B → C. Neither §3's cohort nor OI-06 can answer it |
| 2 | The generic-promotion test in §4 costs a bespoke widget per route | B's price is wrong; re-cost against A |
| 3 | A member cohort (post-`COMING_SOON_MODE`) whose `charts_workspace_layout` adoption is far below 17/29 | B's composable half is speculative for members; A becomes the honest default |
| 4 | The popout spike (RG-27) shows dockview/FlexLayout breaks the one-SSE-pool property | constrains *library*, not this decision — UCT's popout is a React portal into `window.open`, one pool browser-wide [C5-01 §10, D-06 §1.5] |
| 5 | A measured incident on the corrupt-blob path | raises commitment 2 from "sequenced" to "urgent"; §3 currently shows 0 of 17 |

---

## 8. What this document does NOT decide

* **No library migration.** C5-01 §10 settles that a dock library buys **no** schema safety
  (none of seven documents a version field), that UCT already has tabs/float/popout bespoke
  on react-grid-layout, and that grid→dock is *"a **re-authoring**, not a schema bump"*.
  ⛔ Nothing here authorises replacing react-grid-layout.
* **No `StockChart` scope call** (RG-05) and no ARCH-01/02/03 content — those are the next
  artifacts and this only says ARCH-02 is the one to write first.
* **No mobile workspace model.** `<640px` bypasses the grid entirely for `MobileWorkspace`,
  and the registry admits exactly five types on `menus.mobile` [D-06 §1.7 GAPS, D-11 §4.1].
  A hybrid terminal's phone story starts there and is not attempted here.
* **No cross-device ruling.** Drawings and `uct.watchlist.cols` are device-local while
  `tracings_doc` syncs; D-11 records this boundary as *"an accident of implementation order,
  not a decision"* [§4.1]. It needs its own ruling.

---

## GAPS

* ✅ **OI-06 IS in** (owner, 2026-09-19) — see the correction at the head of §7. It supports
  hybrid without separating it from modular. **The open input is a desk-observed morning**,
  which is an observation session and not a question anyone can answer from a document.
* **Member-cohort telemetry is impossible today** by construction — `COMING_SOON_MODE` means
  there is no member population to measure. §3's ceiling cannot be lifted until there is.
* **`personalization-patterns.md` (C5-02) is cited as an accepted input but its §9 synthesis
  is not quoted here** — this document was written against C5-01, D-06 and D-11 plus the new
  telemetry. A red-team pass should reconcile §5's ruling against C5-02 §9's own synthesis of
  UCT's state model, which may sharpen or contradict it.
* **`placement/place.js` + `regions.js` (`SMART_PLACEMENT=true`) were never read** by D-06
  [its GAPS] and are not assessed here. Auto-placement is load-bearing for a generic
  promotion operation (§4) — if promotion is generic, *something* has to decide where the
  promoted panel lands.
* **Line-number drift between the inputs is real**: D-06 and D-11 disagree by one line on
  `GRID_COLS`, `COLS` and `BREAKPOINTS`. Re-derive any constant before depending on it.
* **The 18-type registry inventory exists in exactly one document** (D-06) and was never
  cross-checked by the other; D-11 lists "`WIDGET_REGISTRY` not enumerated" as its own gap.
* Neither input ran a browser or the suite; both are static reads. D-06 carries its own
  warning from repo history: *20/20 sampled text nodes at contrast 1.00 while 13,629 tests
  were green.*

## SOURCES

* C5-01 `06-ux-and-information-architecture/workspace-systems-survey.md` — §0 headline, §7
  failure modes, §8 libraries, §10 the axes table assembled for this comparison.
* C5-02 `06-ux-and-information-architecture/personalization-patterns.md` — accepted input;
  see GAPS.
* D-06 `07-technical-architecture/current-ui-architecture.md` — §1.1 registry, §1.2 grid and
  the three carried invariants, §1.4 keys and versioning, §1.5 popout, §1.7 error
  boundaries, §8 primitive verdicts.
* D-11 `01-existing-system/state-persistence-and-workspaces.md` — §1.1 the store, §1.2
  client write authority, §1.3 the appearance split, §2.1 blob shape, §2.2 the data-loss
  path, §2.3 atomicity, §6.4 the `chart_settings` pattern, §7 gap tables.
* `00-program-control/READINESS_REVIEW_DAY1.md` L331-340 — the options, the evidence, and
  the provisional-lock instruction this document honours.
* **New measurement, this document:** production `auth.db` `user_preferences` aggregate
  read, 2026-09-25, read-only, counts only. Re-runnable; see §3 for the exact fields.
