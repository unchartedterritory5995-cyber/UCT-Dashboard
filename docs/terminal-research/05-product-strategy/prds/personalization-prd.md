---
id: PRD-S6-PERSONALIZATION
title: S6 — Personalization — Product Requirements Document
role: Phase 3 PRD. Specifies what S6 is FOR, against an inventory of the personalization this product already has. Specifies no implementation and authorizes no code.
phase: 3
group: product-strategy
category: prd
status: draft — no gate packet, no approval line, nothing authorized. S6 ships a PRD and a spec only.
date: 2026-09-12
measured_against: origin/master @ 5ff6fc04a
pairs_with: SPEC-S6-PERSONALIZATION
composes_on: SPEC-S5-PERSISTENCE-USER-STATE (state) · SPEC-S12-ROLLOUT (cohorts) · S4 Context Bus (NOT BUILT — see §7.3)
confidence: >
  🟢 on every statement about what the code does today — read from source this pass, file and line
  named, counting method stated beside each number. 🟡 on §8's priority ordering, which is a
  reading and is explicitly labelled as blocked on measurements nobody has taken. 🔴 on nothing:
  this document proposes no number about member BEHAVIOUR, because none was measured.
  ⚠️ PROVENANCE: source was read from the working tree of the `s7-price-level` worktree. No git
  command was run (the task forbade it), so this document has NOT confirmed that tree equals
  `origin/master @ 5ff6fc04a`. Re-derive any load-bearing count before acting on it.
sources: >
  research input — `06-ux-and-information-architecture/personalization-patterns.md` (C5-02),
  read in full this pass · application source read this pass —
  `api/services/calendar_personalization.py`, `api/services/ticker_tag_service.py`,
  `api/services/auth_db.py`, `api/routers/auth.py`, `api/services/journal_two/db.py`,
  `app/src/hooks/usePreferences.js`, `app/src/constants/tagColors.js`,
  `app/src/components/AuthGuard.jsx`, `app/src/pages/charts/WorkspaceContext.jsx` ·
  program artifacts — SPEC-S12-ROLLOUT, OWNER_INPUTS_REQUESTED.md (OI-21), PROGRAM_STATUS.md
---

# S6 — Personalization: Product Requirements Document

## 0. How to read this document

**The evidence in this PRD is an inventory, not a survey.** C5-02
(`06-ux-and-information-architecture/personalization-patterns.md`) is the research input and it is
excellent on what other terminals do; its own GAPS section ends with the sentence this PRD is
written to respect:

> *"No UCT production data was read … every RELEVANCE TO UCT claim above is a claim about UCT's
> code, not about UCT's members' actual behavior."* — C5-02, GAPS

So §3 below is a measured inventory of the personalization this product **already ships**, and §8
is explicit that the build order it proposes is a reading, blocked on five measurements that have
never been taken (OI-21). ⛔ **The most important product finding in this document is that S6's
problem is not a missing capability. It is that the product already personalizes in at least
thirty distinguishable ways with no single authority over any of it.**

---

## 1. Who this system is for

Two audiences, and they want opposite things from the same mechanism.

- **The member**, who has a watchlist, a flag set, seven colour tags, a chart board, a Journal
  account and a Compass profile — and for whom the product's answer to *"what matters to me
  today"* is currently spread across nine surfaces that do not know about each other.
- **The desk**, which authors the house view (starter scans, Model Book, the UCT 20, the wire) and
  today can push it to everyone or to nobody. C5-02 §4 names this shape precisely — FactSet's
  *"the firm configures once, the member inherits it editable"* — and notes that UCT already runs
  it in miniature for scan definitions.

⛔ **A third audience it is NOT for: the operator running an experiment.** That is S12
(`SPEC-S12-ROLLOUT` §3.4: *"Not an entitlement… A rollout answers 'what are we trying on them this
week'"*). Personalization answers *"what does this member care about"*. Folding them together
makes a member's own curation look like a feature flag.

---

## 2. The problem being solved, stated as a measurement

### 2.1 The measurement

| | measured this pass | method |
|---|---|---|
| Tables in `auth.db` carrying a `user_id` column | **38 of 47** | §9.1 |
| `j2_*` tables (Journal 2.0 / Notebook / broker / Compass) | **67** | §9.2 |
| Preference keys the server allow-lists | **43** | §9.3 |
| Distinct `localStorage` string-literal keys in `app/src` | **59** across **130** call sites | §9.4 |
| React modules importing `usePreferences` | **41** non-test files | §9.5 |
| Colour tags a member can apply to a ticker | **7** | §9.6 |
| Pages a non-paid member may reach | **1** — `FREE_PAGES = ['/morning-wire']` | §9.7 |

### 2.2 What that adds up to

**This product does not lack personalization. It lacks a subject.** There is no place in the
codebase that answers *"what does this member care about"* — there are 38 tables, 43 preference
keys and 59 browser keys, each answering a narrower question for one surface, and exactly one
function anywhere that unions any of them across surfaces:
`calendar_personalization.get_user_ticker_sets` (`api/services/calendar_personalization.py:79-96`),
which is Calendar-local, hard-codes its four sources, and is read by one endpoint
(`GET /api/calendar/my-sets`, `api/routers/calendar.py:3104`).

⛔ **The three costs, and they are costs rather than aesthetics:**

1. **A member's signal does not travel.** A ticker they flagged, tagged gold, hold a position in
   and wrote a note about is four independent facts. The Calendar unions the first three; the
   Screener, the Breadth drill, the Desk and the Morning Wire union none of them.
2. **A new surface cannot inherit personalization; it must re-implement it.** `my-sets` is the
   only precedent and it is not reusable — it names its four sources inline and returns
   Calendar-shaped output.
3. **The desk can push to everyone or nobody.** `starter_library.py` ships the firm's setups as
   ordinary editable definitions (C5-02 §4's FactSet pattern in miniature) and there is no analogue
   for a board, a widget set, or a watchlist.

### 2.3 ⛔ What the problem is NOT

- **It is not "add a persona quiz."** C5-02 §4's own anti-pattern: *"a persona quiz whose answer
  is never used again — LSEG's mechanism is notable specifically because it is ongoing."*
- **It is not "add a density toggle."** C5-02 §3's recommendation is the cheaper one: *publish the
  ceiling that already exists* rather than adding controls to surfaces whose content does not
  compress.
- **It is not a recommendation engine.** Nothing in this PRD ranks a security by a model's opinion
  of the member. Every mechanism below is either a thing the member did or a thing the desk
  published.
- **It is not a storage problem.** S5 settled where personal state lives; S6 is about what READS
  it.

---

## 3. The evidence: an inventory of the personalization that already ships

⛔ **This table is a READING over the derived counts in §2.1, not itself a derived count.** One row
per mechanism that (a) a member can influence and (b) changes what that member sees. Every row
cites a store and a read site verified this pass. **34 rows.** The judgement is in the row
boundaries — someone splitting "widget settings" per widget would get 44; someone folding the four
calendar prefs together would get 31. **The derived numbers in §2.1 are the count; this is the
map.**

### 3.1 Member-authored curation (the member said so)

| # | mechanism | store | cited at |
|---|---|---|---|
| 1 | Watchlists | `watchlists` + `watchlist_items` | `auth_db.py:78` |
| 2 | Flagged list (a watchlist with `is_flagged_list = 1`) | same | `calendar_personalization.py:33-44` |
| 3 | Ticker colour tags — 7 colours, each with a semantic label (*Breaking Out*, *Setting Up*, *Earnings Watch*, *Caution*, *Watching*, *Top Pick*, *Pullback*) | `ticker_tags` | `auth_db.py:602`, `app/src/constants/tagColors.js:1-9` |
| 4 | Publishing a tag list to the community | `shared_tag_colors` pref | `ticker_tag_service.py:57-83` |
| 5 | Price alerts, per symbol | `watchlist_alerts` | `auth_db.py:621` |
| 6 | Alert digest frequency | `watchlist_digest` pref | `api/routers/watchlists.py:162-163` |
| 7 | Alert sound on/off and which sound | `alert_sound`, `alert_sound_type` prefs | `auth.py:1902-1903` |
| 8 | Saved scan definitions | `user_definitions.db` | `api/main.py:3068-3073` |
| 9 | Named chart layouts | `charts_layouts.db` | `api/routers/charts_layouts.py:37` |
| 10 | Notebook favourites | `j2_note_favorites` | `journal_two/db.py:538` |
| 11 | Notebook saved views | `j2_note_saved_views` | `journal_two/db.py:843` |
| 12 | Notebook recents | `j2_note_recents` | `journal_two/capture_destinations.py:59` |

### 3.2 Workspace and display state (the member arranged it)

| # | mechanism | store | cited at |
|---|---|---|---|
| 13 | Charts workspace layout — debounced 500 ms, hydration-gated, flushed on unmount | `charts_workspace_layout` pref | `ChartsWorkspace.jsx:968-988` |
| 14 | Colour-group ticker links (A/B/C/D) | `charts_workspace_groups` pref | `ChartsWorkspace.jsx:757-784` |
| 15 | Multi-chart grid state, **device-scoped** (`presentation[class].mode` so a phone cannot write the desktop's answer) | `multichart_state` pref | `useMultiChartState.js:32-50` |
| 16 | Chart settings blob + templates + saved colours | `chart_settings`, `chart_templates`, `chart_saved_colors` prefs | `usePreferences.js:17-19, 81-89` |
| 17 | Chart drawings / Tracings, synced newer-wins with a browser highwatermark | `tracings_doc` pref + `uct-tracings-sync-hw` localStorage | `useTracingsSync.js:5-23` |
| 18 | Per-widget settings — 11 keys (`aisearch`, `alerts`, `breadth`, `calendar`, `fundamentals`, `news`, `notebook`, `options_flow`, `profile`, `theme_tracker`, `watchlist`) | prefs | `auth.py:1900-1946` |
| 19 | App theme (default `'oled'`, persisted only on an explicit choice) | `theme` pref | `usePreferences.js:7-13` |
| 20 | Charts theme, merged mode, volume-pane split, layout dock, active template | 5 prefs | `auth.py:1918-1922` |
| 21 | Joystick hub — handedness, haptics, hold/travel/double-tap thresholds, coach-mark dismissal, per-control overrides | `joystick_hub` pref, the one key with a real server schema | `auth.py:1929, 1950-2039` |
| 22 | Journal metrics dashboard card order | `j2_custom_dashboard` pref | `MetricsDashboard.jsx:10` |
| 23 | 59 per-viewer localStorage keys — collapsed sections, remembered tabs, sort modes, kill switches | `localStorage` | §9.4 |

### 3.3 Derived and cross-surface (the product inferred it)

| # | mechanism | store | cited at |
|---|---|---|---|
| 24 | **"My Stocks"** — the union of watchlists + flagged + open J2 positions + UCT 20. ⭐ **The only cross-surface personalization primitive in the product.** | computed, not stored | `calendar_personalization.py:79-96`; served by `calendar.py:3104` |
| 25 | My Stocks source picker (which of the four sources count) | `calendar_mystocks_sources` pref | `auth.py:1911` |
| 26 | Calendar view, filters and event types | `calendar_view`, `calendar_view_v3`, `calendar_filters_v2`, `calendar_event_types_v2` prefs | `auth.py:1909-1913` |
| 27 | Calendar read/unseen state | `calendar_seen` table | `calendar_seen.py:52, 70, 90` |
| 28 | Compass trader profile + muted setups — an **LLM-authored** persona the member trains with 👍/👎 | `j2_accounts.trader_profile`, `.muted_setups` | `journal_two.py:3871`, `coach_chat_tools.py:608-616` |
| 29 | Compass onboarding responses | `j2_onboarding_responses` | `journal_two/db.py` |
| 30 | Personal edge — the member's OWN per-setup expectancy, distinct from the firm win-rate | derived from `j2_trades` | `api/services/personal_edge.py`, read by `grade_watchlist.py:34` and `ai_search_personal.py:28` |
| 31 | Voice settings + durable voice facts about the member | `voice_settings`, `user_voice_facts` | `auth_db.py:239, 285` |
| 32 | Proactive insight queue — the Awareness engine's per-member feed | `voice_proactive_insights` | `auth_db.py:364` |

### 3.4 Gates that look like personalization and are not

| # | mechanism | store | cited at |
|---|---|---|---|
| 33 | Plan tier — **`FREE_PAGES = ['/morning-wire']`**, one page | `subscriptions` + a client array | `app/src/components/AuthGuard.jsx:111-112` |
| 34 | Admin role, and `entitlements.toolkit_for` (one toolkit ships, `"all"`, and the lookup is still real) | `users.role`, `entitlements.py:254` | — |

⛔ **`user_tags` is deliberately NOT in this inventory.** It is a durable per-member label store,
it has a write path and an admin UI — and **no gate, no surface and no personalization mechanism
reads it.** That is S12's finding (`SPEC-S12-ROLLOUT` §2), verified there against
`_access_payload`, `AuthGuard`, `FREE_PAGES`, `entitlements.py` and both S7 cohort queries.
⭐ **It is the single most important adjacent fact for S6: the hard half of a per-member labelling
system is already built and has no consumers to break.**

### 3.5 ⚠️ Two absence claims, each with a control

- **There is no `awareness_preferences` store.** A grep of `api/` and `app/src` returns nothing for
  that name. ⭐ **Control:** the same pass, same corpus, found `trader_profile`, `muted_setups`,
  `toolkit_for` and `FREE_PAGES` — so the instrument can see a presence. Any programme document
  that names `awareness_preferences` is naming something that does not exist at this tree.
- **No surface outside `pages/journal-2-0/` consumes the Notebook's durable-state layer.**
  ⭐ **Control:** the same search returned 22 import lines across 14 files, all inside it
  (SPEC-S5 §9.6).

---

## 4. Primary workflows

### UC-1 — A member's signal reaches a surface that did not compute it
A member tags NVDA gold ("Top Pick") on the Watchlists page. The Breadth drill modal, the Screener
result list and the Morning Wire's Top-5 cards each show that the member already has a view on
NVDA. **Today:** only the Calendar unions anything, and colour tags are not one of its four
sources (`calendar_personalization.py:79-96`).

### UC-2 — The desk publishes a starting board, and the member edits it
The firm publishes a "swing-equity morning" board. A new member's first `/charts` visit loads it,
editable, exactly as `starter_library.py` already does for scan definitions. **Today:** boards have
no published-default path; a new member gets `DEFAULT_LAYOUT` (`ChartsWorkspace.jsx:727`).

### UC-3 — A member sees why a surface is ordered the way it is
Whatever re-ranking exists is legible and reversible. C5-02 §4's OPEN QUESTION is exactly this —
*"does it re-rank silently, or does the user see and control what it learned?"* — and names the
answer as *"the difference between 'helpful' and 'the UI keeps moving on me.'"*

### UC-4 — A member asks for one thing and gets three lifetimes, on purpose
Saving a screener result asks whether they want a frozen list, a re-runnable definition, or a
standing alert (C5-02 §5, thinkorswim's three-way fork). **Today** UCT computes all three
separately and forces one shape per save action.

### UC-5 — A member is told what follows them between devices
One place says: prefs and named layouts sync; drawings and watchlist columns are per-browser.
C5-02 §8's recommendation, and it costs a support-doc paragraph rather than an engineering change.
⚠️ It is also the **only** recommendation in C5-02 that S6 can satisfy without reading production
data first.

---

## 5. System boundary

### 5.1 S6 owns
**One authority over "what does this member care about", and one over "what has this member
arranged."** Concretely: the subject (a member's entities and their weights), the seam that lets
any surface ask for it, and the vocabulary for a desk-published default.

### 5.2 S6 does NOT own
- **Where per-member state is stored** — S5. S6 reads it.
- **WHO gets a feature this week** — S12. A cohort is not a preference.
- **What a surface does with an answer** — the surface. S6 returns a member's entities and
  weights; it never renders.
- **Alert firing** — S7.
- **Any model's opinion about a member.** Compass's `trader_profile` (row 28) is LLM-authored and
  S6 reads it as one input among many; S6 does not generate one.

### 5.3 Must NOT become
- **A second `user_preferences`.** 43 keys already exist behind one endpoint with one allow-list.
- **A recommendation engine.**
- **A place to put a reason about a person.** (`SPEC-S12-ROLLOUT` §3.4's last bullet, and it
  generalises: an operational label is not a note about someone.)

---

## 6. ⛔ The one thing S6 must decide before anything else

> **Is a member's "interest" a SET or a WEIGHTED SET?**

`my-sets` returns four sets and the client unions them (`calendar_personalization.py:79-96`);
`app/src/pages/calendar/importance.js:74` then applies *"a personal boost on top of imp — mirrors
the my-sets join"*, which is a weight computed downstream of a set. Meanwhile row 3 gives seven
tags with semantic labels a member chose, and row 30 gives a per-setup expectancy in R.

- **SET** is what exists, it is cheap, and it cannot express "I own this" beating "I once flagged
  this."
- **WEIGHTED SET** is what every consuming surface actually needs to order a list, and it
  immediately raises *whose* weights — the member's tag semantics, the desk's, or a learned one.

⛔ **This is a ruling, not a task, and it is the fork the whole system's shape hangs on.** A PRD
that ducked it would produce a spec nobody could implement.

---

## 7. What S6 composes on

### 7.1 S5 — Persistence & User State (spec written, unapproved)
S6 stores nothing new. Every mechanism in §3 already has a store, and S5's three-class rule
governs anything S6 adds: authored work ⇒ client-durable + server-authoritative; cross-device
settings ⇒ server-authoritative; per-viewer conveniences ⇒ localStorage
(`SPEC-S5-PERSISTENCE-USER-STATE` §2.1).

⛔ **S5 hands S6 one hard constraint and it is easy to trip over:** `POST /api/auth/preferences`
**replaces the whole value** — one TEXT column, a bare upsert
(`auth_service.py:1524-1532`, `auth_db.py:230-236`). Any S6 preference whose value is a structured
object must be written with `setPrefMerged`, never `setPref`, or it silently wipes sibling keys.

### 7.2 S12 — Rollout & Cohorts (spec written, unapproved)
S6 needs a cohort to ship anything to a subset, and S12 already specifies it as a `rollout:`
prefix over `user_tags` riding `_access_payload` (`SPEC-S12-ROLLOUT` §3.1-3.3).

⛔ **The ordering S12 fixes is load-bearing for S6 too:** *"the kill switch is evaluated first, so
`FLAG=false` beats any cohort membership. Without that ordering, turning a feature off requires
emptying a table."*

⭐ **And S6 is the natural SECOND consumer of S12's mechanism** — after the S7 dark cohorts. A
personalization change is exactly the kind that wants a curated three-member canary rather than a
hash nobody can explain.

### 7.3 S4 — Context Bus: ⛔ NOT BUILT, AND S6 MUST NOT PRETEND OTHERWISE

`PROGRAM_STATUS.md:464` records S4 as *"❌ | none | partial pre-existing
(`WorkspaceContext`/`ChartsSymContext`); unspecified."* Verified from source this pass, and the
"partial" is doing a lot of work:

- `WorkspaceContext` (`app/src/pages/charts/WorkspaceContext.jsx`) is a **`/charts`-scoped React
  context**, not an app-wide bus. Its value carries four colour-group symbols, a chart theme, two
  widget-canvas maps, a crosshair bus, an AI-search bus and several imperative refs.
- `ChartsSymContext` (`ChartsSymContext.jsx:8-24`) is a **compatibility shim** with a documented
  three-step resolution order (explicit provider → Workspace Group A → null fallback).
- **Both are unreachable from every surface outside `/charts`.** The Calendar, the Screener, the
  Breadth monitor and the Journal share no context with them.

⛔ **THE CONSEQUENCE FOR S6, STATED BEFORE IT BECOMES A BLOCKER: S6 CANNOT DELIVER A LIVE,
IN-SESSION PERSONALIZED CONTEXT WITHOUT S4.** What S6 *can* deliver without S4 is the durable half
— what a member cares about across sessions, resolved server-side and delivered on a request. The
transient half — *"the member is looking at NVDA right now, so weight NVDA"* — needs a bus that
does not exist, and a colour-group symbol scoped to one page is not one.

**S6's honest posture: build the durable half, specify the seam so S4 can feed it later, and
declare the transient half out of scope until S4 has a spec.** Anything else designs against a
system nobody has bounded.

---

## 8. Priority — a reading, and exactly what would sharpen it

⛔ **THIS SECTION IS THE WEAKEST IN THE DOCUMENT AND IS LABELLED AS SUCH.** Every ordering below is
inferred from code shape and from C5-02's cost analysis. **No member behaviour was measured.**

**Proposed order, cheapest-and-most-certain first:**

| | move | why here | cost |
|---|---|---|---|
| P1 | **Publish what syncs and what does not** (UC-5) | Documentation only. C5-02 §8. The one move no measurement could invalidate — the gap is real regardless of who uses what | doc paragraph |
| P2 | **Publish the ceilings that already exist** (`GRID_MAX_CELLS`, the widget cap) | C5-02 §3's own recommendation: *"publish the ceiling"* rather than adding a density control | doc + one string |
| P3 | **Generalise `my-sets` into one member-interest resolver** | It is the only cross-surface primitive and it is Calendar-shaped; every future consumer either reuses it or writes a second one | S/M |
| P4 | **The set-vs-weighted-set ruling (§6), then the seam** | Nothing downstream can be built until it is answered | ruling + M |
| P5 | **Desk-published default boards** (UC-2) | UCT already runs the pattern for scans; the board case is the same shape | M |
| P6 | **Split favourites/recents by object type** (C5-02 §6) | ⚠️ **explicitly parked** — C5-02 §9 puts this and persona re-ranking in the "genuinely new infrastructure" tier and says to measure first | L |

### 8.1 OI-21 — which decision each query would settle

OI-21 (`00-program-control/OWNER_INPUTS_REQUESTED.md:34`) asks for four read-only queries plus a
distribution. **Each settles a different S6 decision, and naming which is the point of this
section** — "it would help" is not a reason to run a query.

| query | the S6 decision it settles | what a YES/NO looks like |
|---|---|---|
| **`page_views`** (which surfaces get used) | **P6, and the whole persona-re-ranking question.** LSEG's ongoing re-rank (C5-02 §4) is only worth building if members touch enough DISTINCT surfaces for an ordering to have information in it. | If the median member touches ≤3 distinct pages, a re-ranked widget picker is re-ranking nothing and P6 is **dropped**, not deferred. If the distribution is wide and bimodal, P6 becomes a real product with two named populations. |
| **`calendar_seen`** (per-user read state) | **Whether unseen-state is a personalization PRIMITIVE or a Calendar nicety.** Row 27 is the only read/unseen tracker in the product. | Rows-per-user near zero ⇒ it stays Calendar-local and S6 does not generalise it. A healthy distribution ⇒ "what's new for you" is a cross-surface primitive and belongs in P3's resolver output. |
| **`calendar_alerts_fired`** (alert volume) | **S6's boundary with S7 (§5.2).** If members are already drowning in alerts, the highest-value personalization is alert TUNING, not surface ordering — which would reorder this entire table. | High volume per member ⇒ P3 is re-aimed at alert relevance. Low or zero ⇒ the boundary stands as written. |
| **`ai_search_log`** (AI lane usage) | **Whether personal grounding is worth extending.** `ai_search_personal.py:28` already reads `personal_edge` — a personalization consumer nobody has sized. | Meaningful usage ⇒ the AI lane is the cheapest place to spend P3's resolver, because a consumer already exists. Near-zero ⇒ do not build S6 features whose only door is AI Search. |
| **`charts_workspace_layout` blob-size + shape distribution** | ⭐ **THE ONE THAT MATTERS MOST — DEC-01 and the premise under P5 and P6.** C5-01 §6's standing question, restated by C5-02 §9: *do members customize at all?* | If most stored blobs are byte-identical to `DEFAULT_LAYOUT`, then **P5 and P6 are answering a need nobody has**, and P1-P3 are the whole of S6. If they diverge widely, the desk-published-default work (P5) is the highest-value item in the table and should move to the top. |

⛔ **AND A CAVEAT THAT CHANGES HOW THESE QUERIES SHOULD BE READ.** The production member count was
**not measured this pass**. CLAUDE.md records it as **26** as of 2026-09-12, from a `railway ssh`
`SELECT COUNT(*)` against `/data/auth.db`, with the site in `COMING_SOON_MODE` so the roster is
admins and testers. **If that is still current, every query above has an n at which a
"distribution" is a listing, not a statistic** — and the members in it are not a sample of the
audience S6 is for. ⭐ **Read them as an existence check** ("does anyone customize at all?"),
never as a rate. Verify the count before sizing anything off these numbers.

⚠️ Note also that the same CLAUDE.md records a **~20,640-user** figure elsewhere and identifies it
as the DEV BOX's `C:\data\auth.db`, not production. **Two databases, identical filenames, an
800× difference.** Any OI-21 run must state which file it read.

---

## 9. Measurement appendix

⛔ **Every count was produced this pass by a script over source. None was copied from a comment or
another document. Where a first attempt was wrong, the wrong answer is recorded.**

**9.1 — 38 of 47 `auth.db` tables carry `user_id`.** Every `CREATE TABLE IF NOT EXISTS` in
`api/services/auth_db.py`; body extracted by **paren-balancing** (not a regex to `);`); SQL `--`
comments stripped before matching the column name.
⚠️ **A first attempt reported 28.** A naive `(...)\n);` regex parsed only the 37 tables in the
column-0 `_SCHEMA` string and silently skipped ten declared inside indented migration blocks —
including `ticker_tags` and `watchlist_alerts`, two of the most personalization-relevant tables in
the file. **The tell was 37 bodies for 47 names.**

**9.2 — 67 `j2_*` tables.** `CREATE TABLE IF NOT EXISTS <name>` in
`api/services/journal_two/db.py`, filtered to the `j2_` prefix.
⚠️ The unfiltered regex also matched `above`, `here` and `statements` — prose inside docstrings
containing the DDL phrase — plus `hub_planned_trades`, a real table from another subsystem. **An
unfiltered 71 would have been three sentences and a different feature.**

**9.3 — 43 allow-listed preference keys.** `_PREFERENCE_KEYS` in `api/routers/auth.py`, **Python
`#` comment lines stripped before matching `"key":` pairs** (the block contains three explanatory
comments, one of which names `shared_tag_colors` in prose).

**9.4 — 59 `localStorage` keys across 130 call sites.** All non-test `.js`/`.jsx` under
`app/src`, **JavaScript comments stripped by a string-aware state machine** (line, block, and
quote/template literals respected) before matching
`localStorage.getItem|setItem|removeItem('<literal>')`. **A floor** — a computed key would be
missed.

**9.5 — 41 non-test modules import `usePreferences`.** Same corpus and stripping, matching an
import specifier ending `hooks/usePreferences`. (42 including the one test file.)

**9.6 — 7 ticker colour tags.** `TAG_COLORS` array literal, `app/src/constants/tagColors.js:1-9`,
counted as entries, not as a documented number.

**9.7 — `FREE_PAGES` holds 1 page.** Read as a literal from
`app/src/components/AuthGuard.jsx:112`: `const FREE_PAGES = ['/morning-wire']`. ⚠️ The array is
duplicated in `NavBar.jsx` and `MoreSheet.jsx` by the file's own admission
(`AuthGuard.jsx:111`) — this PRD read the AuthGuard copy and did not diff the other two.

---

## 10. ⚠️ What could not be measured

- **Every question about member behaviour.** Whether anyone customizes, what they customize, which
  surfaces they use, whether the seven tag labels match how tags are actually applied. **None
  measured.** That is OI-21 and it is why §8 is a reading.
- **The production member count**, and therefore whether OI-21 has a usable n (§8.1).
- **Whether the three `FREE_PAGES` copies agree** (§9.7).
- **The true count of preference keys the client writes.** A literal-only scan found 26 of the 43;
  the rest are written through module constants. The resolving derivation exists —
  `tests/test_preference_key_validation.py` re-derives the set from `app/src/**` with local and
  imported `const` names resolved — and it was **not executed this pass**. Read it from that rail.
- **Whether the tree read equals `origin/master @ 5ff6fc04a`.** No git command was run.

---

## 11. What this PRD authorizes

**Nothing.** S6 ships a PRD and a spec (`SPEC-S6-PERSONALIZATION`) and no gate packet. There is no
approval line anywhere in this pair and no checkpoint is proposed for implementation. §6's ruling
and §8.1's queries both sit with the owner.
