---
id: SPEC-S6-PERSONALIZATION
title: S6 Personalization — the seam, the subject, and the one function that already does this for one surface
role: spec pass only. No code is authorized by this document. It names the mechanism, the seam, the first migration and its size. There is no S6 gate packet.
phase: 3
group: technical-architecture
category: spec
status: SPEC ONLY — nothing built, nothing authorized. Pairs with PRD-S6-PERSONALIZATION; S6 gets no gate packet by instruction.
date: 2026-09-12
measured_against: origin/master @ 5ff6fc04a
pairs_with: PRD-S6-PERSONALIZATION
composes_on: SPEC-S5-PERSISTENCE-USER-STATE · SPEC-S12-ROLLOUT · S4 Context Bus (NOT BUILT)
confidence: >
  🟢 on every statement about what the code does today — read from source this pass, file and line
  named. 🟡 on the proposed shape in §3-§5, which composes existing mechanisms and has not been
  built or reviewed. 🔴 on nothing: this document proposes no number it has not measured.
  ⚠️ PROVENANCE: source was read from the working tree of the `s7-price-level` worktree; no git
  command was run, so this document has NOT confirmed that tree equals `origin/master @ 5ff6fc04a`.
sources: >
  application source read this pass — `api/services/calendar_personalization.py`,
  `api/routers/calendar.py`, `app/src/pages/calendar/useCalendarData.js`,
  `app/src/pages/calendar/importance.js`, `api/services/ticker_tag_service.py`,
  `api/services/auth_db.py`, `api/routers/auth.py`, `api/services/auth_service.py`,
  `app/src/hooks/usePreferences.js`, `app/src/pages/charts/WorkspaceContext.jsx`,
  `app/src/pages/charts/ChartsSymContext.jsx`, `api/services/personal_edge.py` (call sites),
  `api/services/entitlements.py` · program artifacts — PRD-S6-PERSONALIZATION,
  SPEC-S5-PERSISTENCE-USER-STATE, SPEC-S12-ROLLOUT, C5-02
---

# S6 — Personalization: spec pass

## 0. The one-sentence version

**Personalization in this codebase is a question about a MEMBER'S ENTITIES that every surface
answers for itself, and there is exactly one function that answers it across surfaces —
`calendar_personalization.get_user_ticker_sets` — which is Calendar-shaped, hard-codes its four
sources, and has one caller.** S6 is the generalisation of that one function plus the seam that
carries its answer, and nothing else until §2's ruling is made.

---

## 1. What "personalization" means mechanically in this codebase, measured

The PRD's §3 inventory maps 34 mechanisms. Mechanically they reduce to **four shapes**, and naming
them is most of this spec's value because they are routinely confused.

| # | shape | the question it answers | where the decision lives | reusable across surfaces? |
|---|---|---|---|---|
| 1 | **A member's ENTITY SET** — watchlists, flagged, tags, positions, UCT 20 | *which securities does this member care about* | `calendar_personalization.py:79-96` — and nowhere else | ⛔ **no.** One caller, Calendar-shaped output |
| 2 | **A member's ARRANGEMENT** — layouts, widget settings, theme, drawings | *how does this member want the screen* | 43 preference keys behind one endpoint (`auth.py:1900-1948`) + 59 localStorage keys | ⛔ **no** — each key is read by its own surface |
| 3 | **A member's DERIVED PROFILE** — Compass `trader_profile`, `muted_setups`, `personal_edge` | *what has this member's own history taught us* | `journal_two.py:3871`, `coach_chat_tools.py:608-616`, `api/services/personal_edge.py` | ⚠️ **partly** — `personal_edge` already has two consumers (`grade_watchlist.py:34`, `ai_search_personal.py:28`) |
| 4 | **A GATE** — plan, role, entitlement | *what is this member allowed to see* | `AuthGuard.jsx:112` (`FREE_PAGES = ['/morning-wire']`), `entitlements.py:254`, `users.role` | ✅ yes, and it is not personalization |

⛔ **SHAPE 4 IS NOT PERSONALIZATION AND MUST NEVER BE THE MECHANISM FOR SHAPES 1-3.** This is the
same boundary `SPEC-S12-ROLLOUT` §3.4 draws for rollouts — *"folding rollout into entitlements
makes an experiment look like a purchase and a revoked experiment look like a downgrade"* — and it
applies with equal force here: a member's interest expressed as an entitlement makes their own
curation look like something they bought.

⭐ **SHAPE 3 IS THE ONE ALREADY GENERALISING ITSELF**, quietly and correctly. `personal_edge` is a
per-member derived value with two unrelated consumers and no surface of its own. It is the
existing proof that a member-scoped read can be shared; S6 should extend that idiom rather than
invent one.

---

## 2. ⛔ THE RULING THIS SPEC CANNOT MAKE, AND EVERY SHAPE BELOW DEPENDS ON IT

> **Is a member's interest a SET, or a WEIGHTED SET?**
> (PRD §6. Restated here because the spec's §3 has two different shapes depending on the answer.)

**What the code does today is BOTH, in two places that do not know about each other:**

- `get_user_ticker_sets` returns **four sets** — `watchlist`, `flagged`, `positions`, `uct20`
  (`calendar_personalization.py:79-96`) — and the client unions them
  (`app/src/pages/calendar/useCalendarData.js:93`).
- `app/src/pages/calendar/importance.js:74` then applies *"a personal boost on top of `imp` —
  mirrors the my-sets join"*, i.e. **a weight, computed client-side, downstream of the sets, by a
  second implementation of the same join.**

⛔ **That second sentence is the defect in miniature and it is already shipped:** the weighting
logic *mirrors* the server's join rather than deriving from it. Two authorities over one value
(`lesson_a_second_authority_over_one_value`), and the comment says so in the word *"mirrors"*.

**The two answers produce different specs:**

- **SET** ⇒ §3's resolver returns named sets; every consumer unions and weights for itself; the
  `importance.js` mirror is legitimised and reproduced N times. Cheap now, N authorities later.
- **WEIGHTED SET** ⇒ the resolver returns `{entity, weight, because[]}` and owns the weighting;
  `importance.js`'s boost is derived rather than mirrored. Requires deciding **whose weights** —
  the member's own tag semantics (7 labelled colours, `tagColors.js:1-9`), the desk's, or a learned
  one — which is a product ruling, not an engineering one.

⭐ **The recommendation is WEIGHTED SET with the member's own semantics as v1**, because the seven
tag colours already carry member-chosen meaning (*Top Pick*, *Caution*, *Watching*…) and a position
is self-evidently a stronger signal than a flag. But it is a ruling, and **the spec stops here
until it is made.**

---

## 3. The proposed shape — one resolver, one seam

Deliberately the smallest thing that could work. **No new table, no new store, no new poll.**

### 3.1 The subject

`api/services/member_interest.py` — one module, one function family:

```
interest_for(user_id) -> the member's entities, each with the reasons it is there
```

**Every input already exists** and is already read somewhere: `watchlists` + `watchlist_items`
(`auth_db.py:78`), the flagged list (`is_flagged_list = 1`), `ticker_tags` (`auth_db.py:602`),
open `j2_positions`, the UCT 20 from wire data, and — behind the §2 ruling — `personal_edge`.
**S6 adds no source; it makes the union addressable.**

⛔ **AND IT SUBSUMES `get_user_ticker_sets` RATHER THAN SITTING BESIDE IT.** A resolver that leaves
the Calendar's four-source join in place is a second authority over the same question on day one.
The migration in §5 is a body swap.

### 3.2 The seam — and it is NOT `_access_payload`

`SPEC-S12-ROLLOUT` §3.2 puts a cohort on `_access_payload` and gives the right reason: signup,
login and `/api/auth/me` share that block, the client already polls it, no new endpoint. **S6 must
NOT copy that**, and the difference is the point:

| | S12 cohort | S6 interest |
|---|---|---|
| size | a few short strings | a member's whole watchlist + tags + positions |
| changes | when an admin edits a tag | every time the member flags anything |
| freshness needed | next authenticated request is fine | must reflect the flag they set ten seconds ago |
| audience | every request, every member | the surfaces that ask |

⛔ **PUTTING AN ENTITY SET ON THE UNIVERSAL AUTH PATH IS THE `/api/live-prices` MISTAKE IN A NEW
COSTUME**, and this codebase has already paid for that class once: the 2026-07-01 outage was
per-request work on the shared auth path, and the keystone rule from it was *never do an
unthrottled per-request DB write on the universal auth path.* The read version is the same hazard —
the web pod is one uvicorn process with one shared threadpool, and `_access_payload` runs on
**every** authenticated request.

**The seam is therefore its own read, cached per member, invalidated on write:**

```
GET /api/member/interest      -> the resolver's answer
```

with the same discipline `/api/live-prices` learned (`api/routers/live_prices.py`): a shared
per-member cache key, not a per-caller one, so ten surfaces asking do not fragment into ten
entries.

### 3.3 What it returns, and the one field that is not optional

Whatever the §2 ruling decides about weights, **every entity carries WHY it is there.** Not for
debugging — for the member:

- C5-02 §4's OPEN QUESTION is exactly this: LSEG re-ranks continuously and no source says whether
  the user can see what it learned, *"the difference between 'helpful' and 'the UI keeps moving on
  me.'"*
- The reason is what makes UC-3 possible and what makes a wrong answer correctable by the member
  rather than reportable as a bug.

⛔ **A resolver that returns a ranked list with no provenance is unfalsifiable to the person it is
about.** The `because[]` field is the cheapest possible version of the receipt idiom this codebase
already uses well (`CoverageLine`'s four counts).

### 3.4 ⛔ What S6 must NOT become

- **Not a second preferences store.** 43 keys already sit behind one endpoint with one allow-list
  and one derivation rail (`tests/test_preference_key_validation.py`). S6 adds keys to that list or
  adds none.
- **Not a write path.** The resolver READS. Every source keeps its own writer — the watchlist
  router, the tag service, the Journal. A resolver that can write is a resolver that can disagree
  with its own sources.
- **Not a cache of member state.** It caches an ANSWER, invalidated on write, never a copy of the
  rows. A durable derived copy is a second authority with a refresh bug attached.
- **Not a cohort.** S12's `rollout:` prefix answers *"is this member in the experiment"*; S6
  answers *"what does this member care about"*. Two questions, two stores, and the ordering is
  S12's: the kill switch first.
- **Not dependent on S4.** See §4.

---

## 4. ⛔ S4 IS NOT BUILT, AND THIS SPEC IS SHAPED AROUND THAT

`PROGRAM_STATUS.md:464` records S4 (Context Bus) as *"❌ | none | partial pre-existing
(`WorkspaceContext`/`ChartsSymContext`); unspecified."* Verified from source this pass:

- `WorkspaceContext` (`app/src/pages/charts/WorkspaceContext.jsx`) is a **React context scoped to
  `/charts`**, carrying four colour-group symbols, a chart theme, two widget-canvas maps, a
  crosshair bus, an AI-search bus and imperative refs. It has a `FALLBACK` object precisely because
  consumers can render outside its provider.
- `ChartsSymContext` (`ChartsSymContext.jsx:8-24`) is a **V1 compatibility shim** with a documented
  three-step resolution: explicit provider → Workspace Group A → null-safe fallback.
- Neither is reachable from `/calendar`, `/screener`, `/breadth`, `/journal` or the Desk.

**So S6 splits along a line S4 defines, and the split is the plan:**

| half | needs S4? | in scope now |
|---|---|---|
| **DURABLE** — *what does this member care about across sessions* | **no** — resolved server-side, delivered on a request | ✅ **yes.** §3, §5 |
| **TRANSIENT** — *the member is looking at NVDA right now, so weight NVDA* | **yes** — needs an app-wide bus that does not exist | ⛔ **no.** Out of scope until S4 has a spec |

⛔ **A colour-group symbol is not a context bus.** It is four slots, scoped to one page, with a
shim for V1 callers. Building S6's transient half on it would put a cross-app concern inside
`/charts`'s render tree, and the next surface that needed it would either import from `pages/charts`
or write a second one.

---

## 5. The first migration, and its size

> **First migration: `get_user_ticker_sets` becomes `member_interest.interest_for`, with the
> Calendar as the ONLY caller. Size: S/M.**

**Why this one and not a new surface:** it is the only cross-surface personalization primitive that
exists, it already has exactly one caller (`api/routers/calendar.py:3104`), its four sources are
already hard-coded in one place, and **the migration can be provably a no-op** — the same four
sets, the same union, the same endpoint response — which is the only kind of first migration worth
making for a mechanism nobody has used yet.

**What it costs, named:**

| piece | size |
|---|---|
| `api/services/member_interest.py` — the resolver, the source registry, the `because[]` field | ~120 lines |
| `get_user_ticker_sets` body swapped to delegate (signature unchanged, so `/api/calendar/my-sets` is untouched) | ~10 lines |
| `GET /api/member/interest` + the shared per-member cache key | ~40 lines |
| a rail that `calendar_personalization` no longer holds its own four-source SQL | ~20 lines |
| a rail that the resolver's source list is DERIVED, with a non-vacuity control | ~30 lines |
| tests: per-source isolation, the empty-member case, the fail-soft contract, cache invalidation on write, the mutation proofs | ~180 lines |

⭐ **One property must be carried over verbatim and it is easy to lose in a refactor.**
`calendar_personalization.py:1-3` states: *"Each source is wrapped in try/except so one failing
source never blocks the others. Never raises."* Every one of the four helpers returns `set()` on
exception (`:26-28, :44-46, :59-61, :74-76`). ⛔ **A resolver that raises when one source is down
turns a personalization nicety into an outage on whatever surface asks first.** The rail for this
must prove a *failing* source yields a partial answer, not an empty one — and must distinguish
"this source returned nothing" from "this source failed", because C5-02 §2 names
*"empty-because-unreadable indistinguishable from empty-because-new"* as a UCT anti-pattern
already on the books.

### 5.1 ⛔ The decisions that are NOT small, and are rulings rather than tasks

1. **SET vs WEIGHTED SET** (§2). Everything downstream has two shapes until it is answered.
2. **Whether `importance.js:74`'s client-side boost is DERIVED from the resolver or kept as a
   mirror.** Keeping the mirror is the cheap option and it is the defect the word *"mirrors"*
   already confesses to.
3. **Whether the resolver may read `personal_edge`.** It is shape-3 (a derived profile) reaching
   into shape-1 (an entity set), and it is the point where personalization stops being *"things
   the member did"* and becomes *"things we concluded about the member."* That line should be
   crossed on purpose or not at all.

**Everything else this spec deliberately does not decide:** the cache TTL, whether the endpoint is
paid-gated, the wire format, whether a member can see and edit their own interest list, and
whether the desk gets a published-default board. None of those block the first migration, and each
is a reason to delay it if allowed to.

---

## 6. ⚠️ Where a measurement would change this spec, and not just sharpen it

PRD §8.1 maps OI-21's five queries to the product decisions each settles. Two of them would change
**this document**, not just the build order:

- **`charts_workspace_layout` blob-size and shape distribution.** If most stored layouts are
  byte-identical to `DEFAULT_LAYOUT` (`ChartsWorkspace.jsx:727`), then shape 2 (ARRANGEMENT) is a
  feature nobody exercises, and S6 collapses to shape 1 alone — which makes §3's resolver the whole
  of S6 rather than its first piece.
- **`page_views`.** If the median member touches very few distinct surfaces, the cross-surface
  premise under §1's *"reusable across surfaces"* column is weaker than it reads: a primitive that
  three surfaces could share is worth less if members only visit one of them.

⛔ **AND THE n MAY NOT SUPPORT EITHER READING.** The production member count was **not measured
this pass**; CLAUDE.md records 26 as of 2026-09-12 with the site in `COMING_SOON_MODE`. If that is
current, these queries are existence checks, not distributions. **Verify the count, and state which
`auth.db` was read** — the dev box holds a same-named file that CLAUDE.md records at ~20,640 rows.

---

## 7. What is NOT authorized

**Nothing in this document is, and S6 has no gate packet by instruction.** No
`api/services/member_interest.py`, no `GET /api/member/interest`, no change to
`calendar_personalization.py`, no change to `importance.js`, no new preference key, no migration.

The first migration in §5 would need its own approval line naming the §2 ruling and the three
rulings in §5.1 — exactly as every S7 checkpoint and the D2 gate have done.
