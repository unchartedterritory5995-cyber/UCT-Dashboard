---
id: SPEC-S4-CONTEXT-BUS
title: S4 Context Bus — the propagation this codebase already has, and which one copy is promoted
role: spec pass only. No code is authorized by this document. It measures the context mechanisms that exist, names the ONE that is promoted and the ones that are DERIVED from it, and states what the first checkpoint may and may not touch.
phase: 3
group: technical-architecture
category: spec
status: SPEC ONLY — nothing built, nothing authorized. Pairs with GATE-S4-CONTEXT-BUS, whose approval block is EMPTY.
date: 2026-09-12
measured_against: origin/master @ ffa8102c7
pairs_with: GATE-S4-CONTEXT-BUS
composes_on: SPEC-S5-PERSISTENCE-USER-STATE · SPEC-S6-PERSONALIZATION · SPEC-S3-ENTITY-MASTER (NOT BUILT) · information-architecture.md §10
confidence: >
  🟢 on every count in §2 and §8 — each was produced this pass by a script whose method is stated
  beside it, over an AST, with a control. 🟢 on every quoted line — each was read from source and
  is reproduced verbatim with file:line. 🟡 on the proposed shape in §5 and §6, which composes
  mechanisms that exist and has not been built, reviewed or run. 🔴 on nothing: this document
  proposes no number it did not measure. ⚠️ Where a claim could not be measured it says
  "not measured" and stops — see §9.
evidence_ceiling: >
  ⛔ THIS DOCUMENT'S CEILING, STATED BEFORE ITS FIRST CLAIM. (1) NO PRODUCTION TELEMETRY. Nothing
  here says how often two mechanisms actually disagree in a member's session, how many members
  ever cross a surface boundary, or what a context change costs at render time. (2) NO OBSERVED
  DESK MORNING — OI-06 is still open; the workflow claim that "every panel re-targets without
  re-entry" is a design assertion, never an observation. (3) NO BROWSER RUN. Nothing was rendered.
  Every re-render, every paint, every freeze-class risk in §7 is reasoned from source, never
  measured — and the one nav-freeze this program has actually had came from a render loop that no
  amount of source reading had caught. (4) NO TEST RUN. `vitest` was not executed; every statement
  about a rail is a statement about its SOURCE, not about a passing run. (5) NO GIT. The task
  forbade it; application source was read from the `s7-price-level` worktree, so this document has
  NOT confirmed that tree equals `origin/master @ ffa8102c7`. Treat the SHA as a label on intent
  and re-derive any load-bearing count before acting. (6) STATIC-GRAPH LIMITS, tested rather than
  assumed — see §2.4.
sources: >
  program artifacts — `05-product-strategy/product-architecture.md:404-415` (the S4 block),
  `:115`, `:148`, `:216`, `:284-286`; `06-ux-and-information-architecture/information-architecture.md:43`,
  `§10.1-10.3`; `07-technical-architecture/current-ui-architecture.md:151-165`;
  `07-technical-architecture/specs/personalization-spec.md:184-207`;
  `07-technical-architecture/specs/entity-master-spec.md:100, :401`;
  `10-roadmap/2026-09-12-build-day-plan.md:81, :224` (Δ3) ·
  application source read this pass — `app/src/pages/charts/WorkspaceContext.jsx`,
  `ChartsSymContext.jsx`, `ChartsWorkspace.jsx`, `WidgetHost.jsx`,
  `app/src/hooks/useAppFocus.js`, `usePreferences.js`, `app/src/hub/HubContext.jsx`,
  `app/src/components/Layout.jsx`, `app/src/context/VoiceContext.jsx`,
  `app/src/components/mobile/TickerHubContext.jsx`, `app/src/lib/chartDeepLink.js`,
  `app/src/pages/journal-2-0/components/notebook/frozenWorkspace.js` + its rail,
  `app/src/pages/breadth/drill/drillWorkspace.js`, `app/src/App.jsx` (route table),
  `app/src/components/TickerPopup.jsx`, `app/src/hub/sections/screenerSection.js`
---

# S4 — Context Bus: spec pass

## 0. The one-sentence version

⭐ **S4 is a ratification, not a design.** This codebase already propagates "what the user is
looking at" through **nine distinct runtime mechanisms**, one shared store beneath them and a
prop/local-state channel a hundred and eighty-four files wide — and on **2026-08-14 the owner
already ruled which copy is the authority**, in a comment that makes the anti-second-authority
argument itself. So the spec's job is not to invent a bus. It is to say **which existing mechanism
is promoted and which are derived from it**, and to keep the migration additive.

---

## 1. What `product-architecture.md` actually claims S4 is

Quoted, not paraphrased, from `05-product-strategy/product-architecture.md:404-415`:

> **Responsibility.** Carry typed context on named channels between panels, surfaces and windows;
> replay on join; keep the default channel as the app focus.
>
> **Primitives exposed.** `channel(id).publish(context)`, `.subscribe(kind, handler)`, `.current()`;
> `DisplayMetadata`; the payload kinds entity · entity-set · list-ref · timeframe · range · event
>
> **Must NOT own.** Identity resolution (S3), persistence (S5), any panel's interpretation of
> context, the pane-focus UI. Must not become a general event bus: the crosshair and AI-search
> ad-hoc buses (C3: "crosshair/aiSearch are ad-hoc buses") are *not* folded in — a crosshair
> position is transient panel-to-panel state, not context, and the bus carrying it would be the
> monolith seed.
>
> **Build condition.** **New (typed)** on the existing seed — `WorkspaceContext`/`ChartsSymContext`
> colour groups + `useAppFocus` ("the strongest existing asset for a terminal" — D-11 §7.2); start
> with exactly one list-consuming widget

Two more claims from the same document bound this spec and are quoted so they cannot be softened:

- `:115` — an application *"**Reads context from the Context Bus (S4)** and never holds its own copy
  of the loaded security. The `ChartsSymContext` shim (explicit Provider → Group A → null; D-11
  §7.2) is the existing precedent and the anti-pattern to retire: an application that accepts a
  symbol as a prop *and* reads a group is two authorities."*
- `:216` — *"The Context Bus (S4) carries and replays context; it does not resolve it (S3), persist
  it (S5 …), or interpret it (applications)."*

⛔ **This spec adopts that scope and adds nothing to it.** In particular it does not propose
channels, `DisplayMetadata`, replay-on-join or a payload taxonomy as *work*: those are the design
target in `information-architecture.md §10.1`, and §5 below says why none of them is CP1.

---

## 2. ⭐ THE MEASUREMENT THAT DECIDES THIS DOCUMENT

### 2.1 Method, stated before the numbers

Every count below was produced this pass by an AST walk, not a text search.

- Parser: `@babel/parser` **7.29.0** (the copy in `app/node_modules`), plugins `jsx`, `typescript`,
  `classProperties`, `dynamicImport` and friends, `errorRecovery: true`.
- Corpus: **2,702** files under `app/src` matching `.js .jsx .ts .tsx .mjs`. **0 parse failures.**
- **Importer** = a file containing an `ImportDeclaration` or `require()` whose specifier resolves,
  through the same extension/index candidate list Vite uses, to the module in question.
- **Read call site** = an AST `CallExpression` whose callee is the hook `Identifier`. This is a
  strictly smaller and more honest number than "importer": a file that imports
  `WorkspaceContext` to *mount a Provider* is a host, not a consumer.
- **Test file** = path matching `.test.` / `.spec.` / `__tests__/` / `test-utils|test-stubs|test-setup` / `testing/`.
  Test and non-test are reported separately everywhere; a bare number in this document is non-test.

⛔ **CODE, NEVER PROSE — and it is checked, not asserted.** Where a *name* had to be located rather
than an import, occurrences were classified by byte offset against the AST's own comment ranges,
`StringLiteral`/`TemplateElement` ranges, and the first-argument ranges of `vi.mock`/`jest.mock`/
`import()`. Controls, both directions, quotable:

- **Negative control (a comment must not count).** `hooks/useAppFocus.js:4` reads
  `// (WorkspaceContext color groups) that stopped at the edge of that page; the` and
  `pages/charts/grid/GridChartCell.jsx:62` reads
  `canvasTheme,        // 'sunrise' | null — threaded from WorkspaceContext`. Both files textually
  contain `WorkspaceContext`; the classifier scores both **comment-only, code = 0**, and neither
  appears in the import graph. A regex would have counted them as consumers.
- **Positive control (real code must count).** `pages/charts/WidgetHost.jsx:25`
  `import { useWorkspace } from './WorkspaceContext'` and `:130`
  `const { widgetCanvasByType, widgetCanvasById, chartsTheme } = useWorkspace() || {}` — scored
  **code**, and the file appears in the graph. The scanner is not blind.

### 2.2 The nine mechanisms, with consumer counts

| # | mechanism | defining file | what it carries | non-test importers | non-test read call sites | non-test Provider mounts |
|---|---|---|---|---|---|---|
| **M1** | Charts colour groups | `app/src/pages/charts/WorkspaceContext.jsx:3` | symbol ×4 slots (`groupSyms {A,B,C,D}`), a date (`replayCutoff`, `startMarker`), selection refs (`activeChartRef`, `activeWatchlistRef`), plus two ad-hoc buses | **34** (50 incl. tests) | **23** `useWorkspace()` | **12** sites in 11 files |
| **M2** | V1 symbol shim | `ChartsSymContext.jsx:7` | one symbol slot, derived | **8** (9) | **2** `useChartsSym()` | 6 |
| **M3** | **App focus** | `app/src/hooks/useAppFocus.js:36` | one symbol, app-wide, over `charts_workspace_groups`.A | **2** (3) | **2** | — (a hook over a pref) |
| **M4** | Joystick hub context | `app/src/hub/HubContext.jsx:58` | `symbol` **and** `timeframe`, plus `activeScan`, `selectedPosition`, `chartRef`, `livePrice`, `isStreaming` | **6** (22) | **2** `useHub()` | **1 — app-wide** |
| **M5** | Mobile ticker hub | `components/mobile/TickerHubContext.jsx:4` | one symbol (the phone sheet) | **3** (5) | 2 | 1 |
| **M6** | URL as a channel | `app/src/lib/chartDeepLink.js` + `App.jsx` route table + `pages/journal-2-0/hooks/useScope.js` | `?sym=&tf=` one-shot; `/research/:sym`; `?sc_sym=` scope | chartDeepLink **6**, useScope **8** | — | — |
| **M7** | Voice page hint | `context/VoiceContext.jsx:140` | a *prose sentence* (`chart of ${sym}`) in a module-level ref | 2 writers, 1 reader | 2 `setVoicePageHint()` files, 14 calls | — |
| **M8** | Grid per-cell state | `pages/charts/grid/useMultiChartState.js` | per-cell symbol + timeframe, persisted at `multichart_state` | **1** | 1 | — |
| **M9** | Breadth drill source | `pages/breadth/drill/DrillSourceContext.js:19` | the drill's source list | **2** | — | 1 |

Beneath all of them, one store:

| | | | |
|---|---|---|---|
| **S** | Preference store | `app/src/hooks/usePreferences.js:91` | the durable backing for M1/M3/M8: `charts_workspace_groups`, `default_chart_tf`, `multichart_state`, `chart_settings` | **46** non-test importers (48 incl. tests), **+64** test files that `vi.mock` it |

And beside them, the channel nobody designed:

| | | |
|---|---|---|
| **P** | props + local `useState` | **184** non-test files pass down, receive or locally hold the current **symbol** (101 pass a `sym` JSX prop; 77 destructure one; 20 hold one in `useState`). **66** non-test files do the same for a **timeframe**. |

⚰️ **A negative finding, with its control.** There is no custom-event context bus. An AST sweep of
every `dispatchEvent(new *Event('X'))` and `addEventListener('X')` string argument found **19
distinct non-DOM event names** — `uct:chart-contextmenu`, `uct:video-seek`,
`uct:voice:switch-agent`, `uct-barspush-change`, `ais:briefings-changed` and twelve more — and
**none of them carries a symbol, a timeframe or a date**. The control that makes this an absence
claim rather than a blind spot: the same sweep *did* see all nineteen, so it could have seen a
twentieth.

### 2.3 What the numbers say

- **The estate has propagation, and quite a lot of it.** Nine mechanisms is not "no context bus";
  it is a context bus that was written nine times.
- **The biggest one is small.** M1 looks like 34 files, but only **23** of them read it. Eleven
  import the raw context object in order to **mount a Provider** — and **ten of those eleven live
  outside `pages/charts/`** (`pages/AiSearchPage.jsx:369`, `pages/breadth/drill/BreadthDrillModal.jsx:273`,
  and the eight journal notebook embeds at `AiSearchEmbed.jsx:28` … `NewsEmbed.jsx:29`).
- **The dominant channel is not a mechanism at all.** 184 files against 23 is an 8:1 ratio. Any
  claim that a bus "replaces" the local copies is a claim about 184 files, and this document does
  not make it.

### 2.4 ⛔ The instrument's own blind spots, tested rather than assumed

A static import graph cannot see a dynamic import, and this estate uses them heavily:
`pages/Breadth.jsx:346` reaches the drill modal as `lazy(() => import('./breadth/drill/BreadthDrillModal'))`
and `WidgetEmbedView.jsx:43` reaches the news embed as `news: lazy(() => import('./NewsEmbed'))`.
So the graph was re-run with `import()` edges added. It found **581 dynamic `import()` call sites
with a literal specifier, resolving to 231 targets** — and for **every one of the nine mechanisms
above, the number of non-test importers reachable ONLY dynamically is ZERO**. The five extra edges
it found are all test files. **The counts in §2.2 stand, and the check that they stand is itself
controlled**: an instrument that saw 581 dynamic imports and reported none for these modules is
reporting an absence it could have contradicted.

Still invisible, and named rather than waved at: a symbol threaded through `{...rest}` spread; a
string-keyed component registry; anything resolved at runtime from a preference value. **Not
measured.**

---

## 3. ⭐ THE OWNER ALREADY RULED WHICH COPY IS THE AUTHORITY

This is the load-bearing fact of the whole document, and it is in the code, not in a plan.
`app/src/hooks/useAppFocus.js:1-24`, verbatim:

> ```
> // ─── WHAT THE USER IS LOOKING AT, APP-WIDE ──────────────────────────────────
> //
> // The app had no shared notion of "current symbol". /charts had a rich one
> // (WorkspaceContext color groups) that stopped at the edge of that page; the
> // only app-level contexts were auth and voice. So charting AMD and then
> // opening the notebook told the notebook nothing.
> //
> // ⭐ THIS ADDS NO STATE. Owner's call (2026-08-14): charts **Group A IS the
> // app focus**. The storage is the pref ChartsWorkspace already owns and
> // persists — `charts_workspace_groups`.A — read here through the same
> // app-wide usePreferences/SWR cache. There is exactly ONE value, so there is
> // no second authority to drift: any surface reading focus is reading the
> // charts group, and any surface setting it is setting the charts group.
> ```

And it states its own two limits, which this spec inherits rather than hides:

> ```
> // ⚠️ KNOWN LIMIT, deliberately not hacked around: ChartsWorkspace hydrates
> // its in-memory groups from this pref ONCE per mount … A focus change made
> // on another surface while /charts is already mounted therefore lands on the
> // next /charts mount, not instantly.
> …
> // ⚠️ Focus is a SYMBOL only (the ceiling of this model). Date anchors and
> // trade refs still travel by explicit link (lib/chartDeepLink.js).
> ```

**So the ruling exists and the mechanism exists — and it has two consumers.**
`components/TickerPopup.jsx:18` and `pages/journal-2-0/tabs/NotebookTab.jsx`. That is the whole
adoption. S4's real content is not "build a bus"; it is **"the bus was built in August and nobody
joined it."**

⛔ A consequence worth stating plainly, because it changes what a checkpoint is for: **the S4 gap is
an ADOPTION gap, not a CAPABILITY gap, for the symbol.** For timeframe, date/as-of and selection it
is genuinely a capability gap — `useAppFocus` says so itself in the line above.

---

## 4. ⛔ THE TRAP THIS SPEC EXISTS TO AVOID

**A "context bus" that becomes a SECOND AUTHORITY over the current symbol would be strictly worse
than four honest local copies.** Four local copies are visibly four; a tenth mechanism that claims
to be *the* one is a single sentence of documentation away from being a lie, and this program's
most-repeated defect is exactly that — a second authority over one value, derived nowhere and
restated everywhere.

Three things make the trap concrete here rather than theoretical.

**(a) The estate has already caught itself.** `app/src/lib/chartDeepLink.js:13-17`, verbatim:

> ```
> // ⛔ Deliberately NOT a new state channel: the workspace applies these through
> // the authorities it already has (setGroupSym for the ticker, applyTfToCharts
> // for the timeframe) and then STRIPS the params, so the URL is a one-shot
> // instruction rather than a second source of truth competing with the saved
> // workspace.
> ```

That is the rule S4 must obey, written by the codebase about itself. **An instruction is not a
channel.** A URL, a click, a command line and a voice utterance are all instructions; exactly one
thing may hold the value they instruct.

**(b) The shape of the value is already authored in four places, and only a rail keeps them equal.**
`<WorkspaceContext.Provider value={…}>` is mounted at **12 non-test sites in 11 files** (32 sites
in all, the other 20 in tests and one device harness), and the *value* handed to
it is constructed by four distinct authors: `ChartsWorkspace.jsx:963` (the real one),
`frozenWorkspace.js:28` (the journal embeds), `drillWorkspace.js` (the breadth drill) and
`AiSearchPage.jsx:369`. What stops them drifting is a derived rail, and it is the right model for
anything S4 builds — `frozenWorkspace.test.jsx:3-8`:

> ```
> // Rail 1 — completeness, DERIVED never retyped: the real /charts provider's
> // key set is parsed out of ChartsWorkspace.jsx's source (the workspaceValue
> // literal) and WorkspaceContext.jsx's FALLBACK, and every key must exist in
> // frozenWorkspaceValue(). The workspace growing a member the frozen host
> // doesn't carry is a SILENT dead end inside embeds (the A6 blast radius) —
> // this fails BY NAME instead.
> ```

…with a non-vacuity control of its own at `frozenWorkspace.test.jsx:41-45`
(`expect(realKeys).toContain('chartApiById')`).

**(c) One second authority already exists and is live.** `hub/HubContext.jsx` holds its own
`symbol` and `timeframe`; `hub/sections/screenerSection.js:645` writes into it
(`if (symbol) setSymbol(symbol)`); and nothing reconciles that value with
`charts_workspace_groups`.A. Whether the two ever disagree in a real session is **not measured** —
there is no telemetry and no browser run. That is precisely the measurement CP1 should buy.

---

## 5. ⭐ THE CENTRAL QUESTION: WHICH ONE IS PROMOTED, AND WHICH ARE DERIVED

Not "what should the bus hold". This:

> **PROMOTE M3 — `useAppFocus` over `charts_workspace_groups`.A — because the owner already ruled
> it, the ruling is recorded in code with the anti-second-authority argument attached, and it adds
> no store. Everything else DERIVES.**

| mechanism | disposition | why, and what it costs |
|---|---|---|
| **M3 `useAppFocus`** | ⭐ **PROMOTED** — the one authority for the current symbol | Already app-wide, already persisted, already ruled (`useAppFocus.js:8-13`). Adds no state. Its two known limits (§3) become the bus's two known limits and must be written into the bus's contract, not quietly fixed. |
| **M1 `groupSyms.A`** | **IS the promoted value** — same storage, not a copy | `useAppFocus.js:32-34` reads the identical pref key (`FOCUS_PREF_KEY = 'charts_workspace_groups'`) and Group A. Nothing to migrate: they are one value seen through two hooks. **B/C/D stay charts-local comparison slots** — `useAppFocus.js:33` already says so, and a bus that swallowed them would delete the compare workflow. |
| **M2 `useChartsSym`** | **ALREADY DERIVED — leave it exactly as it is** | Its documented resolution order (`ChartsSymContext.jsx:10-14`: explicit Provider → Workspace Group A → null-safe fallback) is a derivation, not a second copy. ⚠️ `product-architecture.md:115` calls this shim "the anti-pattern to retire"; **this spec disagrees on the evidence and says so** — the anti-pattern named there is *an application that accepts a symbol as a prop* **and** *reads a group*. The shim itself is the derivation that makes two authorities into one. Retire the prop-and-group double read; keep the shim. |
| **M4 `HubContext.symbol` / `.timeframe`** | **DERIVE — and this is the only real second authority** | Mounted app-wide at `components/Layout.jsx:124`, written at `screenerSection.js:645`, reconciled with nothing. Deriving `symbol` from M3 removes a live divergence. `timeframe` is the *opposite* case: it is the only context mechanism in the estate that carries one, so it is a candidate to promote **later**, never to duplicate now. |
| **M5 `TickerHubContext.sym`** | **DERIVE** | Phone sheet. Currently also persisted separately at the `charts_mobile_sym` storage key (2 non-test writers) — a third spelling of the same fact. |
| **M6 URL params** | **STAYS AN INSTRUCTION, NEVER A CHANNEL** | `chartDeepLink.js:13-17` already rules this. A `?sym=` is applied through the authority and stripped. `?sc_sym=` (journal scope, 8 non-test consumers) is a *filter*, a different noun, and must not be folded in. |
| **M7 `setVoicePageHint`** | **DERIVE the sentence, do not hold the symbol** | Today `TickerPopup.jsx:186` writes ``setVoicePageHint(`chart of ${activeSym}${tabHint}`)``. The hint is a rendering of context, so it should be produced from the bus. Note the shape: it is prose, so it can never be read back as a value — which is why it is a derivation and not a channel. |
| **M8 grid per-cell state** | **NOT THE BUS'S** | A grid cell's symbol is deliberately per-cell. This is the `'N'` / `` `N:${groupId}` `` "not linked" case (`WidgetHost.jsx:84`), and *opting out is a feature*. |
| **M9 `DrillSourceContext`** | **NOT THE BUS'S** | A source list for one modal. |
| **`crosshairBus` / `aiSearchBus`** | ⛔ **NOT FOLDED IN** | `product-architecture.md:413` forbids it by name: "a crosshair position is transient panel-to-panel state, not context, and the bus carrying it would be the monolith seed." |
| **P — 184 prop/state files** | **UNTOUCHED, INDEFINITELY** | This spec proposes no campaign against them. A prop is how a panel is *told*; the bus is how it *finds out*. Most of the 184 are the former. |

### 5.1 The migration rule, in one sentence each

1. **Additive only.** Every existing consumer keeps working, unmodified, at every checkpoint. Nothing
   in §2.2 is deleted, renamed or re-pointed by CP1.
2. **Derive, never restate.** A derived mechanism reads the promoted value; it does not copy it into
   its own state. The proof that a derivation is real is that **moving the source moves the
   consumer** — the mutation, not the comment.
3. **One store.** S4 adds none. `charts_workspace_groups` already exists and S5 owns it.
4. **A rail that fails BY NAME.** Modelled on `frozenWorkspace.test.jsx:3-8`, derived from source,
   with a non-vacuity control.
5. **Delete every copy but one.** If a derivation is added, the restated copy goes in the *same*
   commit — a documented intent to remove it later is not a removal.

---

## 6. What the bus holds — and the honest state of each field

The brief for S4 names four things. Measured, they are in four different states, and pretending
otherwise is how a spec manufactures work.

| field | state at this SHA | evidence |
|---|---|---|
| **symbol** | **EXISTS, RULED, BARELY ADOPTED.** One authority, 2 consumers. | `useAppFocus.js:8-13`; 2 non-test call sites |
| **timeframe** | **NO APP-WIDE AUTHORITY.** One pref (`default_chart_tf`, 2 non-test files), one unreconciled context field (`HubContext.timeframe`, 1 non-test reader), one one-shot URL param (`chartDeepLink`'s `tf`), and 66 files holding their own. | pref census; `HubContext.jsx:38` (`@property {string\|null} timeframe`), `:64`; `chartDeepLink.js:23` |
| **date / as-of** | **BOARD-WIDE, NOT CHANNEL-WIDE, AND CHARTS-ONLY.** `replayCutoff` + `startMarker` live on M1 with 1 non-test reader each; `current-ui-architecture.md:163` states "replay is board-wide, a single `replayCutoff`". Nothing outside `/charts` has one. | member census of `useWorkspace()` |
| **selection** | **REFS, NOT VALUES.** `activeChartRef`, `activeWatchlistRef`, `chartApiById` are imperative handles for hotkey ownership, with vacuous-pass hazards documented at `WorkspaceContext.jsx:28-33`. ⛔ These are **pane focus**, which `product-architecture.md:413` explicitly puts outside S4. | `WorkspaceContext.jsx:22-36` |

⭐ **So the four fields are not one job.** Symbol is an adoption problem. Timeframe is a genuine new
authority. Date is a `/charts`-local feature that has never been asked to cross a surface. Selection
is out of scope by the architecture's own boundary. **A checkpoint that treats them as one unit is
sizing four different problems with one number.**

---

## 7. ⚰️ Claims this pass retires, kept verbatim

Each is quoted as written, then corrected, with the measurement that corrects it.

**⚰️ 1 — `hub/HubContext.jsx:4-7`:**
> *"⛔ NOT MOUNTED YET — PHASE 1 SHIPS THIS UNWIRED, DELIBERATELY. Today the only thing that imports
> this file is its own test (or another equally unmounted hub module). It is reached from NO route."*

**FALSE at this SHA.** `components/Layout.jsx:12` imports `HubProvider` and `Layout.jsx:124` renders
`<HubProvider>` around `<main>`; six non-test files import the module. The comment is the file's own
record of a run that is over. ⚠️ It matters beyond tidiness: a reader who trusts it concludes the
estate has no app-wide symbol context besides `useAppFocus`, and it has two.

**⚰️ 2 — `07-technical-architecture/current-ui-architecture.md:157`:**
> *"`useWorkspace()` has 28 consumers (`grep -rln useWorkspace app/src`), all inside `pages/charts/`."*

**Both halves are now wrong.** Measured: **23 non-test call sites**, and *not* all inside
`pages/charts/` — `pages/breadth/drill/BreadthDrillList.jsx` calls it, and the raw `WorkspaceContext`
is imported by **10 non-test files outside `pages/charts/`**. The doc names its own method
(`grep -rln`), which is the reason: that command counts comments and mock paths.

**⚰️ 3 — `pages/breadth/drill/drillWorkspace.js:14-15`:**
> *"⛔⛔ DO NOT 'just spread WORKSPACE_FALLBACK'. Its own doc comment invites you to, and that is the
> trap: the FALLBACK carries 19 members while the real provider carries 23."*

**The count is stale; the rule is not.** Measured three ways with an AST: `ChartsWorkspace.jsx:964`
`workspaceValue` = **23 keys**; `WorkspaceContext.jsx:5` `FALLBACK` = **23 keys**;
`frozenWorkspace.js:28` = **23 keys**; all three diffs are **empty in both directions**. Control: the
same differ reports **20 keys missing** against a deliberate three-key stub, so it can report a
difference. ⛔ **Keep the rule anyway** — the FALLBACK is complete *today* because a derived rail
keeps making it complete, and "spread the fallback" would silently re-open the gap the moment the
provider grows a 24th member.

**⚰️ 4 — `07-technical-architecture/specs/personalization-spec.md:192`:**
> *"Neither is reachable from `/calendar`, `/screener`, `/breadth`, `/journal` or the Desk."*

**Retired for two of the five.** `/breadth` mounts a `WorkspaceContext.Provider` through
`BreadthDrillModal.jsx:273` (reached at `pages/Breadth.jsx:346` via `lazy()`), and `/journal` mounts
eight of them through the notebook embeds. It remains true for `/calendar`, `/screener` and the
Desk. ⚠️ The correction *strengthens* that spec's argument rather than weakening it: the charts
context is already leaking across surface boundaries by being re-authored, which is the second-
authority pressure S4 is supposed to relieve.

---

## 8. ⛔ THE Δ3 RE-MEASUREMENT

`10-roadmap/2026-09-12-build-day-plan.md:224` records:

> | **Δ3** | S4 CP1 asks for "snapshot-identity tests over each consumer's rendered output" | **62 files reference `WorkspaceContext`, 22 reference `ChartsSymContext`** | a per-consumer snapshot suite is an L, not the S/M the checkpoint shape implies. §3.1 must narrow or be re-scoped — flagged, decided at the item |

**Re-measured. The two numbers reproduce exactly — and they are not consumer counts.**

`grep -rl WorkspaceContext app/src` returns **62** and `grep -rl ChartsSymContext app/src` returns
**22**, byte-for-byte as recorded. Decomposed by AST:

| | `WorkspaceContext` | `ChartsSymContext` |
|---|---|---|
| naive `grep -rl` files | **62** | **22** |
| — the definition file itself | 1 | 1 |
| — files whose ONLY occurrence is in a comment | **6** | **1** |
| — test files that only `vi.mock()` the path | **5** | **11** |
| = real module-dependency files | 50 | 9 |
| — of those, test files | 16 | 1 |
| **= non-test importers** | **34** | **8** |
| **— of those, files that only mount a Provider** | 11 | 6 |
| ⭐ **= non-test files that READ the context** | **23** | **2** |

⭐ **The number a per-consumer suite must cover is 24, not 84.** The union of non-test files calling
`useWorkspace()` or `useChartsSym()` is **25**, of which one — `ChartsSymContext.jsx` itself — is the
shim, not a product surface. **24 product consumers.** Of those, **18 already have at least one
sibling test file**; **6 have none** (`MultiChartGrid.jsx`, `AlertsWidget.jsx`, `OptionsFlowWidget.jsx`,
`PeriodSortResults.jsx`, `ProfileWidget.jsx`, `WidgetThemeSection.jsx`).

**So Δ3's conclusion is directionally right and its number is 3.5× too large.** A per-consumer
snapshot suite over 24 files with 18 harnesses already standing is an **M**, not an L — and it is
still the wrong CP1, for a reason that has nothing to do with size: **a snapshot suite over
consumers that nothing has changed measures nothing.** It is a baseline, and a baseline whose
purpose is to guard a migration that §5 says should not happen at CP1.

⚠️ Δ3's own framing is worth keeping: it flagged that the checkpoint shape implied a size the
consumer count contradicted. That instinct was right. The correction is that the count was measured
with `grep`, and `grep` counts prose.

---

## 9. What could NOT be measured, stated where it bites

- **Whether M1 and M4 ever actually disagree.** No telemetry, no browser run. A divergence detector
  is a checkpoint deliverable, not a finding available today. **Not measured.**
- **The render cost of any bus.** ⛔ This is the sharpest gap. This program has already had one
  app-wide navigation freeze caused by a render loop in `hub/` (the 2026-09-10 incident whose fix
  lives at `HubContext.jsx:78-96` and `:99-116`, splitting the registrar and the setters into
  contexts that never change). Those comments are the estate's hard-won knowledge that **a
  context whose value identity moves re-renders every subscriber**, and a bus with 24 subscribers is
  that shape. Nothing in this document measures it. **Not measured, and it is the reason CP1 must
  not mount a provider.**
- **Whether members cross surface boundaries at all.** OI-06 (no observed desk morning) is open. The
  entire workflow premise of `product-architecture.md:84-85` — LOAD once, READ everywhere — is
  unobserved. **Not measured.**
- **The one-shot hydration limit's real cost.** `useAppFocus.js:15-21` says a focus change lands on
  the next `/charts` mount. Whether members notice is **not measured**.
- **Runtime-only propagation.** `{...rest}` spreads, string-keyed registries, symbols resolved from
  a preference value. See §2.4. **Not measured.**
- **Whether any rail cited here passes.** No test was run. Every rail claim is a claim about source.

---

## 10. ⛔ What is NOT authorized by this document

Nothing. This is a spec pass. No file may be created, edited or deleted on the strength of it. The
checkpoints live in `GATE-S4-CONTEXT-BUS`, **whose approval block is empty**, and an approval must
name a single checkpoint — an approval reading "build S4" would authorize a scope nobody has
bounded, which is the defect the D2 packet's §2 note records.

Explicitly out of scope until an approval line says otherwise: channels and `DisplayMetadata`;
replay-on-join; a payload taxonomy; any change to the 184 prop/state files; any change to
`crosshairBus` or `aiSearchBus`; any change to `useChartsSym`'s resolution order; the pane-focus UI;
and any new store.
