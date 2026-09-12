---
id: SPEC-S12-ROLLOUT
title: S12 Rollout — what a rollout gate is in this codebase, and the one table that already exists for it
role: spec pass only. No code is authorized by this document. It names the mechanism, the seam, the first migration and its size.
phase: 3
group: technical-architecture
category: spec
status: SPEC ONLY — nothing built, nothing authorized. Wave 3 (2026-09-12) asked for "one short spec, no code."
date: 2026-09-12
measured_against: origin/master @ ee9c96fa1 (application source re-read this pass)
confidence: >
  🟢 on every statement about what the code does today — each was read from source this pass and
  the file and line are named. 🟡 on the proposed shape, which composes existing mechanisms and has
  not been built or reviewed. 🔴 on nothing: this document proposes no number it has not measured.
sources: >
  application source read this pass — `api/services/auth_db.py` (the `user_tags` DDL),
  `api/services/auth_service.py` (`add_user_tag`, `remove_user_tag`, `get_user_tags`, the admin
  list JOIN, the admin detail payload), `api/routers/auth.py` (`_access_payload`, the two admin tag
  endpoints, `_require_admin`), `api/services/alert_taxonomy/price_level_projection.py` and
  `event_proximity_projection.py` (`_cohort_user_ids`), `api/main.py` (the two flag-gated sweeps),
  `docs/feature_flags.json` · program artifacts — `project_feature_flag_ledger`,
  `GATE-S7-PRICE-LEVEL`, `GATE-S7-EVENT-PROXIMITY`
---

# S12 Rollout — spec pass

## 0. The one-sentence version

**A rollout gate is a question about a PERSON that a feature asks at request time, and this
codebase has exactly one durable per-person label store — `user_tags` — which is written by two
admin endpoints and read by no gate at all.**

---

## 1. What a "rollout gate" is in this codebase, measured

This app already gates features four different ways. Naming them in one place is most of this
spec's value, because they are routinely confused and only one of them is a rollout.

| # | mechanism | granularity | where the decision lives | changes without a deploy? |
|---|---|---|---|---|
| 1 | **Env flag** (`HUB_PREVIEW_ENABLED`, `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED`) | the whole service | Railway | ⚠️ see the note below |
| 2 | **Compiled constant** (`OFFLINE_DEFAULT_ON`, `BARS_PUSH_ROLLOUT_PCT`) | the whole bundle, or a hashed % of browsers | the JS source | **no — it is a deploy** |
| 3 | **Role check** (`user.role == 'admin'`, `_require_admin`, the S7 cohorts) | one role, app-wide | the request handler | no code change needed; the ROSTER changes only via `ADMIN_EMAILS` + a login |
| 4 | **Plan / entitlement** (`FREE_PAGES`, `paid_equiv`, `entitlements.toolkit_for`) | one subscription tier | `_access_payload` + `AuthGuard` | via the subscription row |

⛔ **NONE OF THE FOUR CAN NAME A PERSON.** The finest grain any of them reaches is *"every admin"*,
*"every paid member"*, or *"37% of browsers, chosen by a hash the member cannot be told about"*. A
rollout gate is the missing fifth: **this named member, on purpose, reversibly, without a deploy
and without making them an admin.**

⚠️ On row 1: whether `railway variables --set` restarts the service is *not settled* and this
program has measured it both ways — see CLAUDE.md's *"`railway variables --set` — measured BOTH
ways"*. Treat every env flip as a restart, bound by the deploy window.

### 1.1 Why the S7 cohorts are the sharpest instance of the gap

`price_level_projection._cohort_user_ids()` and `event_proximity_projection._cohort_user_ids()` both
read, verbatim:

```sql
SELECT id FROM users WHERE role = ?      -- ('admin',)
```

That is a rollout gate written as a role check, and it is the wrong shape for three reasons the
program has already paid for:

1. **It is not a cohort, it is a privilege.** Adding somebody to the dark run means making them an
   administrator of the whole product. The two decisions have nothing to do with each other.
2. **It cannot shrink.** There is no way to say *"this dark run covers three of the admins"*, which
   is what a first canary actually wants.
3. **It is duplicated.** Two modules hold the same SQL. A third type will hold a third copy, and
   `lesson_a_second_authority_over_one_value` says how that ends.

⭐ And the cohort is about to stop being a role at all: **CP4's `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ALL_MEMBERS`
is a second flag whose only job is to widen `_cohort_user_ids` from "admins" to "everyone"** — a
two-valued rollout with no middle, expressed as a boolean, because there is no store that could
express a middle.

---

## 2. `user_tags` — what it is, measured

```sql
CREATE TABLE IF NOT EXISTS user_tags (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    tag        TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, tag)
);
CREATE INDEX idx_user_tags_user ON user_tags(user_id);
CREATE INDEX idx_user_tags_tag  ON user_tags(tag);
```
— `api/services/auth_db.py:185`

**Everything that touches it, in full:**

| site | what it does |
|---|---|
| `auth_service.py:738` `add_user_tag` | `INSERT OR IGNORE` |
| `auth_service.py:752` `remove_user_tag` | `DELETE` |
| `auth_service.py:761` `get_user_tags(user_id)` | `SELECT tag ... ORDER BY created_at` |
| `auth_service.py:296` | a `LEFT JOIN` into the **admin user list** |
| `auth_service.py:1077` | `user["tags"]` in the **admin user-detail** payload |
| `routers/auth.py:811` / `:818` | `POST` / `DELETE` `/api/auth/admin/users/{user_id}/tags`, both `_require_admin` |

⛔⛔ **AND THAT IS THE WHOLE LIST. NO GATE READS IT.** It is absent from `_access_payload`, from
`AuthGuard`, from every `FREE_PAGES` check, from `entitlements.py`, and from both S7 cohort
queries. A tag today is **an admin's private note about a member**, visible only on the admin
screens. ⭐ The store exists, the write path exists, the admin UI exists, and nothing consumes it —
which is `lesson_built_tested_green_and_unreachable` in its most benign form and its most
convenient: **the hard half of a rollout system is already built and has no consumers to break.**

### 2.1 ⚠️ There are TWO functions called `get_user_tags` and they mean different things

- `api/services/auth_service.py:761` → `list[str]`, the **member's** admin labels (this table)
- `api/services/ticker_tag_service.py:12` → `dict`, a member's **ticker colour tags** (a different
  table, `ticker_tags`, a different subject entirely)

Four call sites use the second one (`voice_watchlist_tools.py:96`, `scatter.py:443` and `:544`,
`routers/ticker_tags.py:23`). ⛔ Any S12 work MUST import by module, never by bare name, and the
first PR should say so in a comment at the import — this is a collision waiting to be resolved the
wrong way by an editor with autocomplete. Recorded also in the D2 PRD's naming appendix, where it
is one row of a larger pattern.

---

## 3. How `user_tags` feeds a rollout gate

The proposal is deliberately the smallest thing that could work, and it adds **no new table, no new
endpoint and no new round trip.**

### 3.1 The reserved prefix

A rollout cohort is a tag whose name begins **`rollout:`**. `rollout:s7-dark`,
`rollout:terminal-next`, `rollout:offline-notebook`.

⛔ **A PREFIX, NOT A SECOND TABLE, AND NOT A FREE-FOR-ALL.** A second table would need a second
admin UI and a second migration; an unprefixed tag would make every existing note (`vip`,
`refunded`, `beta-tester`) accidentally load-bearing the moment anything read the table. The prefix
is what lets the existing rows stay what they are.

⛔ **THE PREFIX IS A DECLARED CONSTANT WITH A RAIL, NOT A STRING LITERAL SPRINKLED AROUND.** One
`ROLLOUT_PREFIX` in one module; a test that fails if any other module writes the literal.

### 3.2 The read

`cohort_for(user_id) -> set[str]` in a new `api/services/rollout.py`, plus one line in
`_access_payload`:

```python
"rollout": sorted(rollout.cohorts_for(user)),   # e.g. ["s7-dark"]
```

⭐ **IT RIDES `_access_payload` FOR THE SAME REASON `HUB_PREVIEW_ENABLED` DOES,** and that
precedent is worth copying exactly: signup, login and `/api/auth/me` all share that block, the
client already polls it, so the cohort is present the moment a session exists — **no new endpoint,
no new poll, and no new failure mode.** The joystick hub's own rail
(`test_the_flag_is_read_per_request`) exists because a module-level capture would make the
no-redeploy rollback a fiction; S12 needs the identical rail for the identical reason.

### 3.3 The two questions a gate asks

```python
rollout.includes(user_id, "s7-dark")      # server side, for a backend cohort
payload["rollout"]                         # client side, for a UI gate
```

⛔ **AND A THIRD, WHICH IS THE ONE THAT MAKES IT A ROLLOUT RATHER THAN A LABEL:**

```python
rollout.cohort_user_ids("s7-dark")        # -> list[str], the whole cohort
```

That is the exact signature `_cohort_user_ids()` already has in both S7 projections. **The
migration is a body swap, not a redesign** — which is the point of naming this now rather than
after a third type copies the SQL.

### 3.4 ⛔ What S12 must NOT become

- **Not a percentage.** `BARS_PUSH_ROLLOUT_PCT` exists and is right for its job (a browser-level
  ramp of a rendering path). A cohort a human curates and a hash nobody can explain are different
  instruments; building the second one here would give this app two answers to *"is this member
  in?"*.
- **Not an entitlement.** `entitlements.py` answers *"what has this member paid for"*. A rollout
  answers *"what are we trying on them this week"*. Folding rollout into entitlements makes an
  experiment look like a purchase and a revoked experiment look like a downgrade.
- **Not a kill switch.** The env flags stay. A rollout says WHO; a kill switch says WHETHER. ⭐ A
  feature needs BOTH, and the ordering is load-bearing: **the kill switch is evaluated first**, so
  `FLAG=false` beats any cohort membership. Without that ordering, turning a feature off requires
  emptying a table.
- **Not a place to put PII.** Tag names are operational labels. `rollout:` names a cohort; it never
  names a reason about a person.

---

## 4. Where the S7 flags should end up

Today, and this is measured rather than proposed:

```
ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED        env, web, ARMED    -> does the sweep run at all
ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED    env, web, ARMED    -> does the sweep run at all
_cohort_user_ids()                             SQL role='admin'   -> WHO it covers      x2 copies
ALERT_TAXONOMY_PRICE_LEVEL_DARK_ALL_MEMBERS    env, unset (CP4)   -> widen WHO to everyone
```

After S12, the first two are unchanged — they are kill switches and should stay env flags — and the
last two collapse into one cohort:

```
ALERT_TAXONOMY_*_DARK_ENABLED   env     -> WHETHER the sweep runs      (unchanged, evaluated FIRST)
rollout:s7-dark                 tag     -> WHO it covers               (one authority, both types)
```

⭐ **CP4 STOPS BEING A FLAG AND BECOMES A SQL PREDICATE.** "All members" is
`SELECT id FROM users` behind the same `cohort_user_ids` call, selected by the cohort's own
definition rather than by a second boolean. That removes a flag from the ledger rather than adding
one, which is the only kind of rollout system worth building.

⚠️ **AND IT MAKES A RAMP POSSIBLE FOR THE FIRST TIME.** Today the price-level dark run covers
admins or everybody, with nothing in between. A member-facing flip with 26 production members and
no intermediate step is a bet, not a rollout.

---

## 5. The first migration, and its size

> **First migration: `_cohort_user_ids()` in the two S7 projection modules. Size: S.**

**Why this one and not a UI gate:** it is the only place in the app where a role check is ALREADY
being used as a cohort, it is already duplicated across two modules, a third copy is already
scheduled (catalyst-match CP3), and **it is dark** — nothing a member can see changes if it is
wrong, which is the right property for the first consumer of a new mechanism.

**What it costs, named:**

| piece | size |
|---|---|
| `api/services/rollout.py` — `ROLLOUT_PREFIX`, `cohorts_for`, `includes`, `cohort_user_ids` | ~60 lines |
| one line in `_access_payload` + the read-at-request-time rail | ~15 lines |
| the two `_cohort_user_ids()` bodies swapped | 2 × ~6 lines |
| a rail that the two projections no longer hold their own SQL | ~20 lines |
| tests: prefix isolation, empty-cohort behaviour, the kill-switch-wins ordering, the mutation proofs | ~150 lines |

**⛔ The one decision that is NOT small, and it is a ruling not a task:**

> **What does an EMPTY cohort mean?**

`role='admin'` can never be empty in practice; `rollout:s7-dark` starts empty by definition, and
the two safe answers point in opposite directions:

- **empty ⇒ nobody** is right for a member-facing feature (fail closed), and it means the S7 dark
  run silently covers zero people on the day of the swap — five sessions of "agreement" over an
  empty set, which is precisely the `NO DATA`-versus-`QUIET` confusion the comparison harnesses
  were built to prevent;
- **empty ⇒ fall back to admins** preserves today's behaviour exactly and is a second authority
  over who is in.

⭐ **The recommendation is EMPTY ⇒ NOBODY, with the swap commit SEEDING the cohort in the same
change** — tag the existing admins `rollout:s7-dark` in the migration itself, so the population is
identical before and after and the change is provably a no-op on day one. A mechanism that changes
who is covered *and* how coverage is decided in one commit cannot be debugged when the count moves.

**Everything else this spec deliberately does not decide:** the admin UI for the prefix (the
existing tag box already works, ugly but functional), tag expiry, per-cohort audit, and whether a
member should be able to see which rollouts they are in. None of those block the first migration,
and each is a reason to delay it if allowed to.

---

## 6. What is NOT authorized

Nothing in this document is. It is a spec pass: **no `api/services/rollout.py`, no change to
`_access_payload`, no change to either `_cohort_user_ids()`, no new flag, no migration.** The first
migration above needs its own approval line naming the empty-cohort ruling, exactly as every S7
checkpoint has.
