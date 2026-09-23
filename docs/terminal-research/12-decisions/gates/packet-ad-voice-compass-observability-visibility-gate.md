---
id: PACKET-AD
title: A cluster of computed-and-stored Compass/voice observability data in voice.py has zero UI anywhere — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET AD — give the member (and the owner) eyes on what Compass already measures about itself

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs any of the routes named
> below. **Non-collision, checked twice:** grepped `packet-a[a-z]-` across
> `docs/terminal-research/12-decisions/gates/` and `.scopes/` in this worktree, and
> `PACKET-[A-Z]{1,3}` case-insensitive across the full `s7-price-level` checkout — once at
> the start of this pass and again immediately before this file was written (`git fetch
> origin terminal-research` confirmed no new packet commits landed in between). Every single
> letter A–Z is taken; `packet-aa` (RG-38), `packet-ab` (RG-39) and `packet-ac` (RG-37) are
> also taken. **`AD` is the next free double letter and is claimed here.**

⛔ **ZERO BACKEND CODE, in any checkpoint.** Every route this packet surfaces already exists,
already works, and is already covered (where it has coverage at all) by its own service-layer
logic — nothing here changes what any endpoint returns, computes, or costs. Every checkpoint is
an additive frontend surface on the **existing member-facing Settings → "Compass & Voice"
section**, not a new admin page.

⛔ **THREE CHECKPOINTS, cheapest and lowest-risk first.** CP1 touches one already-mounted panel
and adds zero new files. CP2 and CP3 each add exactly one new file (a panel) plus a handful of
mount lines in `Settings.jsx` — no new backend route, no new database, no new auth surface. A
fourth candidate (the `/explain` endpoint) was considered and is **deliberately not proposed as
a checkpoint here** — see §5.

---

## 0 · Framing correction against the task's own template — read before §1

`packet-y-admin-ops-health-visibility-gate.md` (the template this packet follows) surfaces
**admin-only** (`require_admin`) or intentionally-anonymous ops monitors on `Admin.jsx`, a page
only an admin role reaches. **This packet's finding is a different shape, and stating that
difference precisely matters for scope:**

- Every route below is gated by `requires_voice_access` (`api/middleware/auth_middleware.py:101-110`)
  — admin **or** a paid plan **or** an active trial (`is_account_in_trial`). That is the same
  gate `VoiceTelemetryPanel.jsx` itself sits behind, and it is a **much wider audience** than
  Packet Y's `require_admin`.
- The home for all four of these routes today is `Settings.jsx`'s `compass` section (`"Compass &
  Voice"`, `SECTIONS` array line 1548) — verified this section carries **no `isAdmin` gate
  anywhere** (`grep -n "isAdmin" app/src/pages/Settings.jsx` → zero matches). Every one of its
  five existing sibling panels — `VoicePanel`, `VoiceMemoryPanel`, `VoiceTelemetryPanel`,
  `VoiceSessionsPanel`, `VoiceDocumentsPanel`, `VoiceInsightsPanel` — is visible to **any paid or
  trial member**, not just the owner.
- So this packet is not "admin ops visibility" in Packet Y's sense — it is **member
  self-diagnostics for their own voice assistant**, in the same place the member already goes to
  see their own telemetry, memory, sessions, documents and proactive insights. Each checkpoint
  below extends that existing idiom; none of them proposes a new admin surface or a new access
  tier.
- The data itself is per-user where the route is per-user (`list_recent_flags`,
  `detect_knowledge_gaps`, `detect_ticker_obsessions` all take `user_id` and scope to it), and
  cross-user only where the existing scoreboard already is (`variant_scoreboard` — see §1c).

---

## 1 · The finding, re-verified fresh against CURRENT source, 2026-09-22 (`s7-price-level` HEAD `76ef96c06`)

All four route groups live in `api/routers/voice.py` and are gated by
`Depends(requires_voice_access)` — read directly off each function signature below, not
inferred. Filed to `RESEARCH_GAPS.md` as **RG-41** in the same commit as this packet.

### 1a · Hallucination-audit subsystem (voice.py:568-590, 593-615)

| Route | File:line | Rate limit | Frontend callers |
|---|---|---|---|
| `GET /api/voice/hallucinations` | `api/routers/voice.py:593-600` (`hallucinations_list`) | none | **0** |
| `POST /api/voice/hallucinations/audit/{session_id}` | `api/routers/voice.py:603-615` (`hallucinations_audit_one`) | `10/minute` | **0** |

- `hallucinations_list(limit: int = 50, user = Depends(requires_voice_access))` calls
  `voice_hallucination_audit.list_recent_flags(user["id"], limit=...)`, which reads
  `voice_hallucinations` filtered `WHERE user_id = ?` — **per-caller scoped**, returning
  `{flags: [{id, session_id, turn_text, suspect_number, suspect_unit, evidence, confidence,
  created_at}, ...]}` (`voice_hallucination_audit.py:323-337`, read in full).
- `hallucinations_audit_one(session_id, user)` first calls `session_belongs_to_user` (403 if
  not the caller's own session — `voice.py:613-614`), then `audit_session(session_id,
  user["id"])`, returning `{turns_examined, suspect_count, flagged: [...]}`
  (`voice_hallucination_audit.py:169-172, 197`, read in full).
- **Confirmed automatic, on every voice session:** `POST /api/voice/session/end`
  (`session_end_post`, `voice.py:1253-1284`) schedules `background_tasks.add_task
  (_audit_session_background, body.session_id, user["id"])` unconditionally (`:1273`) —
  `_audit_session_background` (`voice.py:1404-1413`) calls the same `audit_session` the manual
  route calls. The audit already runs after every Mode C session; the manual `POST
  /hallucinations/audit/{id}` route exists only for an on-demand re-run.
- Zero frontend callers confirmed: `grep -rniE "hallucination" app/src` (whole tree, excluding
  test files) → **0 matches**.
- **Additional, closely-related finding, NOT part of the task's original list, surfaced by this
  re-verification and explicitly OUT OF SCOPE for this packet (see §5):** a SECOND,
  `require_admin`-gated, cross-user aggregate route already exists —
  `GET /api/admin/voice-hallucinations` (`api/routers/admin_api_health.py:113-119`), whose own
  docstring says *"For the Voice Hallucinations dashboard"* — a dashboard that does not exist
  (`grep -rniE "voice-hallucinations|voiceHallucinations" app/src` → **0 matches**). This is
  genuinely Packet-Y-shaped (admin-gated, zero-caller, "status" route) rather than this packet's
  shape (member self-diagnostics), so it is named here for the record and left for a future
  Packet-Y-style admin checkpoint or a fresh RG row — not folded into CP2 below, which stays on
  the per-user, Settings-hosted surface the task specified.

### 1b · Active-learning subsystem (voice.py:568-590)

| Route | File:line | Rate limit | Frontend callers |
|---|---|---|---|
| `GET /api/voice/learning/gaps` | `api/routers/voice.py:568-572` (`learning_gaps`) | none | **0** |
| `GET /api/voice/learning/ticker-obsessions` | `api/routers/voice.py:575-579` (`learning_obsessions`) | none | **0** |
| `POST /api/voice/learning/consolidate` | `api/routers/voice.py:582-590` (`learning_consolidate`) | `3/minute` | **0** |

- `learning_gaps` calls `voice_active_learning.detect_knowledge_gaps(user_id)` →
  `[{slot, category, question}, ...]` (`voice_active_learning.py:83-106`, read in full) — one
  entry per unfilled `KNOWLEDGE_SLOTS` category (trading style, preferred setups, risk-per-trade,
  etc.) the assistant has no saved fact about yet.
- `learning_obsessions` calls `detect_ticker_obsessions(user_id, min_mentions=8, days=60)` →
  `[{symbol, mentions, suggested_fact, suggested_question}, ...]`
  (`voice_active_learning.py:129-187`, read in full) — tickers mentioned ≥8 times in 60 days with
  no corresponding saved fact.
- `learning_consolidate` calls `consolidate_memory(user_id)` →
  `{duplicates_merged, stale_flagged, summaries_compressed}` (`voice_active_learning.py:193-260`,
  read in full). **Confirmed non-destructive**: it merges near-duplicate facts (keeping the
  more-recently-updated one), only *flags* stale facts for review (its own comment: *"don't
  auto-delete — too risky"*), and `summaries_compressed` is currently a **placeholder count**,
  not an actual compression (`:248-249`: *"actual compression needs LLM call… just count how
  many we'd compress"*) — CP3 below must render that field honestly (e.g. "pending compression"),
  not as a claim that compression happened.
- This third route (`/learning/consolidate`) was **not in the task's original finding list** —
  it surfaced during this fresh re-verification, sits in the same file section (`voice.py:
  568-590`) and the same service module (`voice_active_learning.py`) as the two named routes,
  and is the natural "run it now" counterpart to a page that otherwise only ever reads gaps —
  exactly the "Scan now" idiom `VoiceInsightsPanel.jsx` already ships (`:118`, `POST
  /api/voice/proactive/scan`). Included in CP3's MUST-BUILD on that basis; flagged here rather
  than silently folded in.
- Zero frontend callers confirmed for all three: `grep -rniE "learning/gaps|learning_gaps|
  knowledge.?gap|ticker-obsession|ticker_obsession|learning/consolidate|consolidate_memory"
  app/src` → 0 real matches (`quotes.json`'s one incidental use of the English word "obsession"
  in an unrelated market-wizards quote is the only hit and is unrelated).

### 1c · Reward/prompt-variant subsystem (voice.py:625-642)

| Route | File:line | Rate limit | Frontend callers |
|---|---|---|---|
| `GET /api/voice/reward/scoreboard` | `api/routers/voice.py:625-632` (`reward_scoreboard`) | none | **1** (`VoiceTelemetryPanel.jsx:39`) |
| `GET /api/voice/reward/variants` | `api/routers/voice.py:635-642` (`reward_variants`) | none | **0** |

- `reward_scoreboard(days=30)` calls `voice_reward_model.variant_scoreboard(user["id"],
  days=...)` → per-variant-id rows aggregated from ACTUAL feedback
  (`voice_reward_model.py:64-71`, read in full: `{variant_id, total_sessions, thumbs_up,
  thumbs_down, corrections, score, agent_breakdown}`). Already rendered by
  `VoiceTelemetryPanel.jsx`'s "Prompt variant performance — last 30 days" table (`:200-233`).
  **This is usage-based**: a variant with zero traffic in the window never appears.
- `reward_variants(context: str = "global")` calls `voice_prompt_registry.list_variants(context)`
  → `[{id, weight, description}, ...]` (`voice_prompt_registry.py:154-158`, read in full) — the
  **catalog**, not usage: every variant declared for that context, including ones that have never
  run. `VARIANTS` (`voice_prompt_registry.py:41-134`) declares exactly **seven** contexts,
  confirmed by reading the dict's own keys, not counted from prose: `global`, `analyst`,
  `risk_officer`, `coach`, `scout`, `orchestrator`, `train_me`.
- Zero frontend callers for `/reward/variants` confirmed: `grep -rniE "reward/variants|
  reward_variants|list_variants|prompt.?variant" app/src` → the only hits are
  `VoiceTelemetryPanel.jsx`'s existing scoreboard section TITLE text ("Prompt variant
  performance"), never a fetch of `/reward/variants`.
- **The gap the task named is exact**: the scoreboard shows how existing variants performed; it
  cannot show what a variant IS (its `description`, its starting `weight`) or that a
  freshly-added variant exists at all before it has traffic. The catalog and the scoreboard are
  complementary reads of the same underlying registry, and only one of the two is on screen.

### 1d · `/explain` — "why did you say that" (voice.py:669-689)

| Route | File:line | Rate limit | Frontend callers |
|---|---|---|---|
| `POST /api/voice/explain` | `api/routers/voice.py:674-689` (`explain`) | `30/minute` | **0** |

- Body: `ExplainRequest {session_id: int, turn_text: str | None}` (`:669-671`). Calls
  `voice_explainability.explain_turn(user_id, session_id, turn_text)`
  (`voice_explainability.py:26-...`, read in full) → pulls the session's trace
  (`voice_trace_service.get_trace`), the variant in use, tool calls before the target turn (or
  all, if no `turn_text` match), and returns a structured, narratable explanation — `{ok: False,
  narration: "Session not found."}` on a miss, otherwise a populated breakdown of `data_sources`
  etc.
- Zero frontend callers confirmed: `grep -rniE "voice/explain|explain_turn|explainTurn|why did
  you say" app/src` → the only hits are `pages/research/**`'s `explainTurn`/`ExplainTurn`
  CSS-class and test-id names, which belong to a **completely unrelated** "Ask AI" comparison
  feature on the Research page (`ComparisonAskAi.jsx`, `AskAiTab.jsx`) — not this endpoint, not
  even the same word used the same way (they name UI turns in a chat log, not an explainability
  call). This route genuinely has zero callers.
- **This is discussed, not proposed as a checkpoint — see §5.**

### 1e · Non-collision with Packet Y — confirmed, no overlap

`packet-y-admin-ops-health-visibility-gate.md` scopes fourteen `Admin.jsx`-hosted,
`require_admin`-or-anonymous monitors: `fundamentals-health`, `reconciliation-status`,
`bars-stream-status`, `provider-coverage`, `warm-universe-status`, four `calendar-*` routes,
`call-recap-status`, `transcript-index-status`, `yfinance-guard`, `admin/patterns/health`, and
`theme-engine/status`. **None of those routes live in `voice.py`, none are Compass/voice data,
and none share a file, a service module, or a settings section with anything in this packet.**
Packet Y is `status: PROPOSED, unsigned` as of this pass (its own file, re-read fresh) — correctly
still pending, not signed. No shared scope, no shared file to conflict on a merge.

---

## 2 · Proposed checkpoints

| CP | scope | new files | new backend routes | risk |
|---|---|---|---|---|
| **CP1** | reward-variants catalog added to the ALREADY-MOUNTED `VoiceTelemetryPanel.jsx` | 0 | 0 | **XS** |
| **CP2** | new "Hallucination Audit" panel — flags list + manual re-audit trigger | 1 (+ mount lines) | 0 | **S** |
| **CP3** | new "Active Learning" panel — knowledge gaps + ticker obsessions + consolidate-now | 1 (+ mount lines) | 0 | **S** |

Each CP is independently approvable — `SCOPE APPROVED:` may name any subset (e.g. *"CP1 ONLY"*
or *"CP1, CP2 ONLY"*), per this repo's multi-checkpoint convention (`PACKET-Y`, `PACKET-K`: one
`⛔ APPROVAL` block, a `SCOPE APPROVED:` line naming whichever checkpoint(s) are cleared).

### CP1 — reward-variants catalog on `VoiceTelemetryPanel.jsx`

**MUST-BUILD, exactly:**

1. `app/src/components/voice/VoiceTelemetryPanel.jsx`: add **seven** more fetches, one per
   context declared in `voice_prompt_registry.VARIANTS` (`global`, `analyst`, `risk_officer`,
   `coach`, `scout`, `orchestrator`, `train_me` — read from the registry's own dict keys at build
   time, not hand-retyped into a second list that can drift), each
   `fetch('/api/voice/reward/variants?context=' + ctx, { credentials: 'include' })`, folded into
   the existing `Promise.all` in `refresh()` (`:33-41`) alongside the current seven calls.
2. Render the result as one more `styles.section` beneath the existing "Prompt variant
   performance" table (`:200-233`), grouped by context, each row showing `id` / `weight` /
   `description` from `list_variants`'s catalog shape. A variant already present in
   `variantStats` (the usage scoreboard) may be cross-referenced by `variant_id` so a row can
   show "no sessions yet" for a declared-but-unused variant — nice-to-have, not required to close
   the visibility gap this checkpoint targets.
3. Nothing else on the page changes — the existing cost banner, failure patterns, per-tool
   breakdown, corrections and feedback sections are untouched.

**Explicitly deferred:** a control to CHANGE a variant's weight or add a new one from the UI —
this checkpoint is read-only surfacing of the existing registry; `VARIANTS` stays a code-level
constant, edited by a deploy, exactly as it is today.

### CP2 — "Hallucination Audit" panel

**MUST-BUILD, exactly:**

1. **`app/src/components/voice/VoiceHallucinationsPanel.jsx`** (new file) + matching
   `.module.css`, modeled on `VoiceInsightsPanel.jsx`'s idiom **verbatim**: a `load()` callback
   fetching `GET /api/voice/hallucinations?limit=50` on mount, rendered as a list (session id /
   turn text / suspect number+unit / evidence / confidence / relative timestamp via the existing
   `formatETFull` helper), an empty state ("No flagged claims — Compass hasn't said anything that
   didn't match its own tool data"), and a `credentials: 'include'` fetcher matching every
   sibling voice panel.
2. **Manual re-audit control**, reusing `VoiceInsightsPanel.jsx`'s "Scan now" button idiom
   (`:118`, a `POST` + re-`load()` on success): a session-id input (or, if preferred at build
   time, a dropdown sourced from the already-fetched `GET /api/voice/sessions?limit=50` the
   sibling `VoiceSessionsPanel.jsx` already calls) firing `POST
   /api/voice/hallucinations/audit/{session_id}`, showing the returned `{turns_examined,
   suspect_count}` as a transient result line, then refreshing the flags list.
3. **`app/src/pages/Settings.jsx`**: import the new panel, add
   `card('voiceHallucinations', <TileCard icon="warning" title="Hallucination Audit">
   <VoiceHallucinationsPanel /></TileCard>)` to the `compass` section array (`:2317-2323`),
   directly after `voiceTelemetry`, and one more `SEARCH_INDEX` entry (`:1571-1576`'s pattern:
   `{ card: 'voiceHallucinations', section: 'compass', title: 'Hallucination Audit', keywords:
   'flags mismatch numbers wrong audit re-audit' }`).
4. Nothing else changes. No new backend route, no change to `_audit_session_background`'s
   automatic post-session run, no change to the detection thresholds in
   `voice_hallucination_audit.py`.

**Explicitly deferred:** the `require_admin`-gated cross-user aggregate route named in §1a
(`GET /api/admin/voice-hallucinations`) — a materially different audience and page (`Admin.jsx`,
not `Settings.jsx`), left for a future Packet-Y-shaped checkpoint or a fresh RG row, not this
one.

### CP3 — "Active Learning" panel

**MUST-BUILD, exactly:**

1. **`app/src/components/voice/VoiceLearningPanel.jsx`** (new file) + matching `.module.css`,
   same panel idiom as CP2: on mount, `Promise.all` of `GET /api/voice/learning/gaps` and `GET
   /api/voice/learning/ticker-obsessions`.
2. **Knowledge gaps section**: one row per gap (`slot` category label / `question`) — a plain
   read-only list; this is context the assistant will ask about naturally, not something a
   member fills in from this panel (no form — the existing `VoiceMemoryPanel.jsx` "add a fact"
   form is the write path for closing a gap, and this panel should say so in one line rather than
   duplicating that form).
3. **Ticker obsessions section**: one row per surfaced symbol (`symbol` / `mentions` count /
   `suggested_question`), read-only, same reasoning as above.
4. **"Run consolidation now" button**, reusing the CP2/`VoiceInsightsPanel` "Scan now" idiom:
   `POST /api/voice/learning/consolidate`, showing the returned `{duplicates_merged,
   stale_flagged, summaries_compressed}` as a transient result line. Per §1b, render
   `summaries_compressed` honestly (e.g. "N old summaries flagged for future compression") since
   the service does not yet actually compress them — do not word this as "compressed."
5. **`app/src/pages/Settings.jsx`**: import + mount
   `card('voiceLearning', <TileCard icon="sparkle" title="Active Learning">
   <VoiceLearningPanel /></TileCard>)` in the `compass` section array, after
   `voiceHallucinations`; matching `SEARCH_INDEX` entry (`keywords: 'gaps obsessions memory
   consolidate learning knowledge'`).
6. Nothing else changes. No new backend route, no change to `KNOWLEDGE_SLOTS`, the
   ticker-obsession thresholds (`min_mentions=8`, `days=60`), or the consolidation logic itself.

**Explicitly deferred:** a one-click "answer this gap" flow that writes a fact directly from the
gap's suggested question — that is a real, larger feature (a confirm-first write path, mirroring
`VoiceMemoryPanel.jsx`'s existing add-fact form) and is not required to close the "the member
cannot see these at all" gap this checkpoint targets.

### Explicitly deferred, NOT authorized by this packet (all checkpoints)

- Any change to what any of these routes returns, computes, or costs.
- Any change to any route's auth (`requires_voice_access` stays exactly as-is on all six named
  routes).
- The `require_admin`-gated `GET /api/admin/voice-hallucinations` aggregate (§1a) — a separate,
  differently-audienced surface.
- The `/explain` endpoint (§1d) — see §5.
- Any write path for a knowledge gap or ticker obsession beyond the existing
  `VoiceMemoryPanel.jsx` add-fact form.
- Any control to edit `VARIANTS` weights/descriptions from the UI.

---

## 3 · Current state → target state

**CURRENT STATE:** six routes (§1a–§1c) plus one considered-and-excluded route (§1d) are built,
gated, and — where relevant — already running automatically (the hallucination audit fires after
every session; the reward scoreboard already has a live consumer). A paid or trial member has no
way to see their own flagged hallucinations, their own knowledge gaps, their own ticker
obsessions, or the catalog of prompt variants their sessions are being randomized across, and no
way to trigger a re-audit or a consolidation pass on demand. The only door today is `curl` or
`railway ssh`, same as Packet Y's finding — but for member-scoped, not admin-scoped, data.

**TARGET STATE (CP1–CP3):** all of the above becomes visible on the same Settings page the
member already uses for their voice telemetry, memory and session history — no new page, no new
access tier, no backend change.

---

## 4 · Risk

**Low, per checkpoint, independently.** CP1 adds seven more `fetch` calls (all already-existing,
already-working, already-gated the same way as the panel's other seven) and a read-only table to
a page that already renders comparable tables. CP2 and CP3 each add exactly one new frontend file
plus a few mount/search-index lines, reusing an established, already-shipped panel idiom
(`VoiceInsightsPanel.jsx`'s load/refresh/trigger pattern) and the existing `compass` section of
`Settings.jsx` — no new backend route, no new database table, no change to any of the six
endpoints' behavior, gating, or cost. The manual triggers (re-audit, consolidate) call endpoints
that are rate-limited server-side already (`10/minute`, `3/minute`) and are, by the service
layer's own design, non-destructive (re-audit never deletes; consolidation merges duplicates and
only flags — never deletes — stale facts). The worst case for any of the three is a broken or
empty Settings card; none of the three touches a scheduler, a write path outside the two named
triggers, or any other member's data.

---

## 5 · `/explain` — considered, not proposed as a checkpoint here

The task explicitly asked for a judgment call on this one, so the reasoning is recorded rather
than silently decided.

**What it is:** a structured, on-demand "why did you say that" explanation for a specific
session/turn — variant in use, tools called before the response, facts/corrections in play. Its
natural moment of use is **mid-conversation, in reaction to something Compass just said** — a
member hearing an answer in `CompassChat` or a voice session and wanting to know where a specific
claim came from, right then. That is a fundamentally different kind of affordance from CP1–CP3:

- CP1–CP3 are **retrospective, batch, settings-page reads** — a member visits Settings when they
  choose to, to review accumulated data about their assistant's behavior over time.
- `/explain` is naturally a **per-message, in-context UI trigger** inside the chat/voice surface
  itself (`CompassChat.jsx` or a voice-session transcript view) — "why did you say that" attached
  to the specific turn a member is looking at, not a page they navigate to separately.

Building it as a Settings-page feature (e.g., "paste a session id and turn text here") would be
technically possible — the endpoint's shape supports it — but would produce a materially worse,
context-free version of a feature whose value is entirely about being anchored to the turn a
member just heard. That is not "extending existing admin/settings visibility for already-computed
data" in the sense the other three checkpoints are; it is a new **member-facing chat affordance**,
which is a different product decision (where in `CompassChat`/the voice UI does the trigger live,
does it apply to voice sessions, text chat, or both, does it cost anything extra to render) that
deserves its own scoped proposal rather than being folded into this visibility-only packet.

**Recommendation:** leave `/explain` out of this packet entirely. It is real, it is zero-caller,
and it is worth building — but as a separate, later checkpoint (or its own packet) once the
owner has a view on where a "why did you say that" trigger should live in the chat UI, not as a
fourth item riding on this packet's "surface it in Settings" shape. Recorded in RG-41 below for
that future work.

---

## 6 · Owner-bound questions

**None block CP1–CP3.** The one open question — where a per-turn "why did you say that" trigger
should live in the chat/voice UI — is exactly the reason `/explain` is not proposed as a
checkpoint in this packet (§5), and is deliberately left for the owner to decide before any
scoped proposal is written for it.
