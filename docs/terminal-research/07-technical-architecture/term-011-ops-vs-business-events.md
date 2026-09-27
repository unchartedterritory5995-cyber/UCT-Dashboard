---
id: SPEC-TERM-011
title: TERM-011 / RM-N09 — Split ops alerts from business events
role: Implementation spec for the first item in the UCT Terminal roadmap's Lane A (the floor)
phase: implementation-spec
group: technical-architecture
category: spec
scope: >
  Establishes, from source at one commit, every producer that raises an alert or an event in
  uct-dashboard; which Discord destination each currently resolves; the severity vocabulary that
  gates each destination; a per-producer OPS / BUSINESS / BOTH classification; the routing
  configuration surface with a stated failure direction per variable; the migration order; and the
  rail that would prove a misroute. Specification only — it contains no code and proposes no edit
  to `api/**` or `app/**`.
status: NOT IMPLEMENTED — nothing in this document is in source. `TERM-011` is BUILDABLE and
  UNSTARTED. Three states are used throughout: ✅ IN SOURCE (read at the commit below) ·
  ⛔ NOT IN SOURCE · ❓ UNREADABLE-FROM-HERE (a Railway/pod value; this pass has no Railway access
  and did not attempt one).
source_commit: origin/master be9ca78b6effd860e1a59ad88b6af0b87bbf416c (2026-09-26 14:13:11 -0500)
reading_branch: terminal-research @ fac059c2369ed446e32da883bb6c91c794ce69aa when this pass began;
  ⚠ another lane advanced the branch to 41a743137e27f9e384a68c34c5d85da2013594b7 (TERM-018) while it
  ran. `origin/master` did NOT move, so every code claim below is unaffected. ⛔ this worktree is an
  older docs branch. EVERY code claim below was read with `git show origin/master:<path>` or
  `git grep origin/master`, never from this tree.
date: 2026-09-26
depends_on: 10-roadmap/roadmap.md §RM-N09 · 10-roadmap/backlog.md TERM-011 ·
  10-roadmap/observability-plan.md G-5/G-6 · 07-technical-architecture/specs/alerts-monitoring-spec.md §5.5
---

# TERM-011 / RM-N09 — Split ops alerts from business events

**What this document is.** The implementation spec for the roadmap's first build item. The roadmap
states the problem in two — *"Configuration before code"* (`10-roadmap/roadmap.md:304`), and the
split *"must land **before** the traffic that would mute the channel"* (`10-roadmap/backlog.md:553`)
— and ranks it above the monitors it serves because every
later observability item inherits it (`10-roadmap/roadmap.md:304`). This document is meant to be
precise enough that an implementer derives nothing again.

**What it is not.** It is not code, it is not a migration, and it decides nothing about cost or
usage (de-scoped by the programme) or about execution/order management (never in scope). §10 lists
what it explicitly does not decide.

---

## 0. METHOD — every count in this document is derived, none is typed

⛔ **A count is comparable only to a count produced the same way.** `observability-plan.md:456-458`
measured *"thirty modules"* with `grep -rl "DISCORD_WEBHOOK_URL" api/ --include=*.py | wc -l`;
`roadmap.md:807` measured **36** with `git grep -l "DISCORD_WEBHOOK_URL" origin/master -- api tools
scripts | wc -l`, and `roadmap.md:689-692` already records that these are *"different pattern,
different unit"* and declines to correct either. **This document adds no correction either.** It
states its own pattern and unit at every number, and re-runs the two prior patterns so all three are
readable side by side.

Every command below was run from `C:\Users\Patrick\uct-worktrees\terminal-research` against
`origin/master be9ca78b6`.

| # | question | command | pattern | unit | result |
|---|---|---|---|---|---|
| D1 | prior count, reproduced | `git grep -l "DISCORD_WEBHOOK_URL" origin/master -- api \| wc -l` | literal `DISCORD_WEBHOOK_URL` | **files** under `api/` | **30** |
| D1b | …are they all Python? | same, filtered `grep -v '\.py$' \| wc -l` | literal, non-`.py` | **files** | **0** — so D1 reproduces `observability-plan.md:456-458`'s 30 exactly |
| D1c | the roadmap's wider count | `git grep -l "DISCORD_WEBHOOK_URL" origin/master -- api tools scripts \| wc -l` | literal | **files** under three trees | **36** = 30 + 6 (`scripts/hub_sandbox_boot.py`, `scripts/rth-alert.ps1`, `tools/audit_sandbox_env.py`, `tools/breadth_live_open_check.py`, `tools/desk_creative_watch.py`, `tools/railway_config_audit.py`) |
| D2 | how many webhook names exist | `git grep -hoE 'DISCORD[A-Z0-9_]*WEBHOOK[A-Z0-9_]*' origin/master -- . \| sort -u \| wc -l` | regex over the whole repo | **distinct identifier spellings** | **15** (two are code identifiers, not env vars: `DISCORD_WEBHOOK_ENV`, `DISCORD_WEBHOOK`) |
| D3 | `add_alert` occurrences | `git grep -nE '\badd_alert\s*\(' origin/master -- .` | regex `add_alert(` | **lines**, whole repo | **34** lines / 14 files (20 of them in `tests/`) |
| D3p | `add_alert` **production call sites** | D3 restricted to `-- api`, minus the `def` and minus docstring/comment lines | regex `add_alert(` | **call sites** (`file:line`) | **9** |
| D4 | `chart_health_alerts.emit` call sites | `git grep -nE '(chart_health_alerts\|_alerts)\.emit\s*\(' origin/master -- api tools scripts` | regex; the alias `_alerts` exists at `api/services/bars_continuous_audit.py:83` | **call sites** | **22** lines across **18** files |
| D5 | the `alert_taxonomy` package | `git ls-tree -r --name-only origin/master -- api/services/alert_taxonomy \| wc -l` | tree listing | **files** | **29** |
| D7 | `DISCORD_WEBHOOK_URL` as the **terminal** `or` fallback | `git grep -lE '^[[:space:]]*or os\.(getenv\|environ\.get)\("DISCORD_WEBHOOK_URL"' origin/master -- api tools scripts \| wc -l` | regex, line-initial `or` | **files** | **9** |
| D8 | files whose ONLY webhook name is `DISCORD_WEBHOOK_URL` | per-file: `grep -ohE '[A-Z0-9_]*WEBHOOK[A-Z0-9_]*' \| sort -u`, minus `DISCORD_WEBHOOK_URL`, empty ⇒ SOLE | regex over each file's whole text | **files** | **14** of D1c's 36 |
| D13 | severity literal at each `emit` site | per site: `sed -n "<ln>,<ln+4>p" \| grep -oE '"(critical\|warning\|warn\|info)"' \| head -1` | first severity-shaped literal within 5 lines of the call | **call sites** | **15** `"critical"` · **5** `"warning"` · **1** `"warn"` · **1** computed variable |
| D14 | the emit severity **vocabulary** | D13, `sort -u` | as above | **distinct literals** | **3**: `"critical"`, `"warning"`, `"warn"` |
| D24 | `discord_notify._send_webhook` external callers | `git grep -nE 'discord_notify\.(notify_[a-z_]+\|_send_webhook)' origin/master -- api tools scripts` | regex, attribute access | **call sites** | **16** across **13** files |
| D26 | the five business notifiers' callers | `git grep -nE '\b(notify_signup\|notify_waitlist_signup\|notify_subscription\|notify_churn_risk\|notify_admin_action)\s*\(' origin/master -- api`, minus `discord_notify.py` | regex, bare name (they are imported by name) | **call sites** | **6** across **4** files |
| D27 | how many modules own their own Discord transport | intersection of `git grep -lE 'DISCORD[A-Z0-9_]*WEBHOOK[A-Z0-9_]*' origin/master -- api` and `git grep -lE 'requests\.post\|httpx\.post\|urllib\.request\.(Request\|urlopen)\|_urllib\.(Request\|urlopen)\|urlopen\(' origin/master -- api` | names a webhook var AND contains an HTTP POST primitive | **files** | **25** (of **40** under `api/` that name a webhook var at all) |
| D19 | `ADMIN_EMAILS` readers | `git grep -lE 'ADMIN_EMAILS' origin/master -- api tools scripts \| wc -l` | literal | **files** | **27** |
| D22 | does a routing rail already exist? | `git ls-tree -r --name-only origin/master -- tests \| grep -iE 'ops.*business\|alert_rout\|channel_rout\|term_011'` | filename regex | **files** | **0** — ⛔ NOT IN SOURCE |

⚠️ **Where D27's pattern is blind.** A module that hands its payload to a shared poster (or uses a
`requests.Session`) names a webhook var but shows no POST primitive, so it is counted in the 40 and
not in the 25. `api/cream_card.py`, `api/weekly_flow.py`, `api/discord_watchlist.py` and
`api/notable_flow_router.py` are in that gap. D27 is therefore a **lower bound on transports and an
upper bound on nothing**.

⭐ **D4 has independent corroboration from a different pattern.**
`12-decisions/gates/term-018-can-every-guard-fire.md:43-44`, written in a concurrent lane on this
branch, counts the same population with
`git grep -h -o -e 'chart_health_alerts\.emit(' -e '_alerts\.emit(' origin/master -- 'api/' | wc -l`
— **occurrences** rather than matching lines, and restricted to `api/` — and gets **22**. Re-run here
at `be9ca78b6`: **22**. Two patterns, one answer. ⛔ This is a corroboration, not a merge: that
document's other figures were produced for a different question and are not substituted for
anything here.

⚠️ **The one number in this document that is NOT a grep.** The OPS / BUSINESS / BOTH column in §4 is
a **judgement applied to a mechanically-derived call-site list**. The list is reproducible; the
classification is arguable. §4 states the test it applies and names, per row, the sentence in source
it applied it to, so a reviewer can disagree with a row without re-deriving the list.

---

## 1. THE CURRENT TOPOLOGY — five doors, two env vars, one channel

There is no alerting layer. There are **five independent doors**, each owning its own transport,
its own throttle and its own severity gate. Two of them read `DISCORD_ALERT_WEBHOOK`; three read
`DISCORD_WEBHOOK_URL`; D27 finds **25** modules under `api/` that hold a Discord POST of their own.

### 1.1 The doors

| door | entry point | webhook variable | when it is read | what makes it post | throttle |
|---|---|---|---|---|---|
| **A — the member/system alert feed** | `api/services/alerts.py:280` `add_alert()` | `DISCORD_ALERT_WEBHOOK` (`alerts.py:81`) | ⭐ **at call time** — `discord_webhook()` at `alerts.py:84-86`, deliberately un-cached; the header at `:63-80` records the import-time capture this replaced and why the dangerous direction is the **clear** | `severity in ("warning", "critical")` — `alerts.py:350` | none on the Discord leg |
| **B — chart/ops health** | `api/services/chart_health_alerts.py:70` `emit()` | `DISCORD_WEBHOOK_URL` (`:48`, `:88`) | **at call time** | `severity != "critical"` ⇒ no page — `:37` | 600 s deque throttle (`:28`) + 1800 s per-key page cooldown (`:30`), **both module dicts**, so a redeploy clears them (`observability-plan.md:484, :491`) |
| **C — admin/business notifier** | `api/services/discord_notify.py:13` `_send_webhook()` | `DISCORD_WEBHOOK_URL` (`:11`) | ⚰️ **at IMPORT** — `DISCORD_ADMIN_WEBHOOK = os.environ.get(...)` as a module constant | nothing; every call posts | none |
| **D — direct posters** | 25 modules (D27), each with its own `_post_discord` / `_alert` / `_webhook()` | mixed; `DISCORD_WEBHOOK_URL` is the terminal fallback in **9** of them (D7) | mixed | mixed; most gate on a `*_ENABLED` var, not on severity | mixed |
| **E — the S7 taxonomy** | `api/services/alert_taxonomy/` (29 files, D5) | **none of its own** | n/a | `delivery.py:56` delegates to `watchlist_alert_service.deliver_alert_payload`, i.e. into door A | the fire-once lease at `delivery.py:53` |

⭐ **Door E already has a designed router, and it is explicitly unbuilt.**
`alert_taxonomy/delivery.py:6-10` says so in its own words: *"Per-type/per-predicate channel ROUTING
(SPEC §5.5's CHANNEL_REGISTRY / alert_routing_prefs design) is explicitly NOT implemented this pass …
`deliver_alert_payload`'s existing, unmodified in-app+email+Discord fan-out is used as-is for every
fire this slice produces."* And that design already named the correct decomposition:
`specs/alerts-monitoring-spec.md:547-551` — *"ONE registry entry per delivery PURPOSE (member alert
vs. admin ops vs. community), replacing the per-subsystem `*_DISCORD_WEBHOOK_URL` sprawl — not one
entry per existing env var name."* **TERM-011 is that sentence, scoped down to the routing decision
and up to every door rather than one.**

### 1.2 Door A's nine production call sites (D3p)

`_TYPE_SEVERITY` (`alerts.py:119-125`) supplies the default when a caller passes none, and an
alert type absent from that map defaults to `SEVERITY_INFO` (`alerts.py:321`) — which is **below**
door A's Discord threshold.

| # | call site | type | severity | audience (`user_id`) | posts to door A's webhook? |
|---|---|---|---|---|---|
| 1 | `api/main.py:2514` | `wire_missed` | `"critical"` (`:2516`, commented *"critical => Discord webhook fires"*) | `None` ⇒ broadcast | yes |
| 2 | `api/services/alerts.py:529` | `regime_change` | `critical` (`:120`) | `None` ⇒ broadcast | yes |
| 3 | `api/services/alerts.py:534` | `stop_hit` | `warning` (`:121`) | `None` ⇒ broadcast | yes |
| 4 | `api/services/alerts.py:540` | `scanner_match` | `info` (`:122`) | `None` ⇒ broadcast | no |
| 5 | `api/services/alerts.py:548` | `exposure_shift` | `warning` (`:124`) | `None` ⇒ broadcast | yes |
| 6 | `api/services/exposure_gate_watch.py:45` | `exposure_gate` | **no severity passed, and `exposure_gate` is NOT in `_TYPE_SEVERITY`** ⇒ `info` | `None` ⇒ broadcast | **no — this guard pages nobody** |
| 7 | `api/services/journal_two/note_tasks.py:581` | `REMINDER_SOURCE` | `"info"` (deliberate: *"`info` is below the Discord threshold"*, `:578-579`) | member id | no |
| 8 | `api/services/watchlist_alert_service.py:301` | `price_alert` | `"warning"` **hardcoded** (`:305`) | member id | **yes** |
| 9 | `api/services/watchlist_alert_service.py:474` | caller-supplied `source` | caller-supplied | member id | depends on the caller |

⛔⛔ **Row 9 is where the problem is already documented as a workaround.**
`watchlist_alert_service.py:478-481`: *"severity is the Discord gate (add_alert fires the global
admin webhook on warning/critical only) — bulk member content like the AI briefings passes `"info"`
so 200 personalized briefs never flood the admin channel (2026-08-28 review)."* A member-facing
content class was **downgraded in severity to control a channel**. That is severity being used as a
router, and it is the severity inversion `backlog.md:579-581` warns about, running in reverse.

⛔ **Row 8 has no such escape.** A member's price alert is `"warning"` at `:305` with no parameter,
so every price alert every member arms posts into door A's webhook.

### 1.3 Door B's 22 call sites, and its vocabulary (D4, D13, D14)

`emit(alert_key, severity, message, metadata)` (`chart_health_alerts.py:70`) takes `severity` as a
**free string**. The module defines **no** severity constants and validates nothing — grep for
`SEVERITY` in it returns only the parameter and the comparison (`:33`, `:37`, `:70`, `:81`, `:87`).

- **15** sites pass `"critical"` ⇒ they page.
- **5** pass `"warning"` ⇒ they do not page (`:37`). Among them `api/routers/push.py:90`
  (`taxonomy_version_mismatch`) and `api/services/source_circuit_breaker.py:78`.
- **1** computes it: `api/routers/market_calendar.py:176` passes a variable set at `:157`
  (`"critical" if milestone else "warning"`) and `:164`.
- **1** — `api/services/bars_reconciliation.py:358` — passes **`"warn"`**.

⛔⛔ **`"warn"` is not in any vocabulary in this estate, and the comment three lines above it claims
the opposite outcome.** `bars_reconciliation.py:352-353` reads: *"Route to the same ops alert channel
the intraday watchdog uses, so a real daily-drift event **pages someone** instead of hiding in
logs."* `_should_page_discord` compares `severity != "critical"` (`chart_health_alerts.py:37`), so
`"warn"` pages nobody. A comment naming a mechanism is a claim about a run, and this one is false at
this commit. **Any router keyed on `severity` inherits a free-text field that already holds a typo in
production source.**

⛔⛔ **And a green rail pins the typo in place.** `tests/test_reconcile_detect_only_daily.py:57-61` asserts
the emit's key *and its severity* — `assert args[1] == "warn"` at `:61`, under the comment *"And an
alert is emitted (key + severity + message)"* (`:57`). **Correcting `"warn"` to `"critical"` or
`"warning"` turns that test red.** So the implementer of §6 step 3 must change the rail and the call
site in the same commit, and the rail must then assert the *paging outcome* rather than the string —
a test that pins a value the product got wrong is a guard testing the adjacent thing. ⚠ Whether
`"warn"` should page at all is a ruling this document does not make (§9).

### 1.4 Door C — the notifier whose name says "admin events" and whose callers are monitors

`discord_notify.py:1-4` describes itself as *"Discord webhook notifications for admin events …
when users sign up, cancel, etc."* Its five public functions are business events:
`notify_signup` (`:31`), `notify_waitlist_signup` (`:44`), `notify_subscription` (`:69`),
`notify_churn_risk` (`:92`), `notify_admin_action` (`:102`), with **6** call sites across **4**
files (D26): `api/routers/auth.py:434`, `api/routers/waitlist.py:102`,
`api/services/stripe_service.py:218/:263/:288`, `api/main.py:7046`.

But its **private** `_send_webhook` has **16** external call sites across **13** files (D24), and
they are monitors: `catalyst/curator_health.py:57`, `catalyst/health.py:91`,
`catalyst/rule_learner.py:217`, `catalyst/spend_rail.py:137`, `desk_article_audit.py:210`,
`desk_session_audit.py:342`, `desk_session_insights.py:1272`, `fundamentals_monitor.py:248/:538`,
`provider_coverage_monitor.py:744`, `wire/coverage_monitor.py:95/:118`,
`wisdom/publish/report.py:661` — plus two content posts (`catalyst/digest.py:123`,
`desk_daily_session.py:285/:308`).

⚰️ **Door C captures its webhook at import** (`:11`). `alerts.py:63-80` documents this exact defect
class for door A and fixed it, giving the reason: *"the dangerous direction is the CLEAR. Blanking
the webhook is how this estate turns an alert channel OFF (the standing rule is that a kill switch
is a variable, never a delete) — and against an import-time capture the operator reads the variable
back as empty, sees `--kv` agree, and the running process keeps posting."* Door C, the highest-volume
door, still has the defect door A's header was written about. `api/services/email_service.py:20`
has it too, for `RESEND_API_KEY`.

### 1.5 Door D — and the direction nobody named: content falling INTO the ops channel

`DISCORD_WEBHOOK_URL` is the **last term** of an `or` chain in **9** modules (D7). Eight of the nine
are member-facing content posters:

| module | its own variable | terminal fallback |
|---|---|---|
| `api/alpha_gold_eod.py:79-83` | `ALPHA_GOLD_EOD_WEBHOOK_URL` → `DISCORD_MASSIVE_WEBHOOK_URL` → `DISCORD_LIVE_FLOW_WEBHOOK_URL` | `DISCORD_WEBHOOK_URL` |
| `api/cream_card.py:106-110` | `CREAM_EOD_WEBHOOK_URL` → … | `DISCORD_WEBHOOK_URL` |
| `api/darkpool_eod.py:76-80` | `DARKPOOL_EOD_WEBHOOK_URL` → … | `DISCORD_WEBHOOK_URL` |
| `api/oi_morning.py:522-526` | `OI_MORNING_WEBHOOK_URL` → … | `DISCORD_WEBHOOK_URL` |
| `api/weekly_flow.py:656-659` | `WEEKLY_FLOW_WEBHOOK_URL` → … | `DISCORD_WEBHOOK_URL` |
| `api/discord_watchlist.py:26-30` | `DISCORD_LIVE_FLOW_WEBHOOK_URL` → `DISCORD_FLOW_WEBHOOK_URL` | `DISCORD_WEBHOOK_URL` |
| `api/live_massive_router.py:4954-4957` | `DISCORD_MASSIVE_WEBHOOK_URL` → `DISCORD_LIVE_FLOW_WEBHOOK_URL` | `DISCORD_WEBHOOK_URL` |
| `api/liveflow_worker.py:94-97` | `DISCORD_LIVE_FLOW_WEBHOOK_URL` | `DISCORD_WEBHOOK_URL` |
| `api/services/liveflow_monitor.py:47-48` | `LIVEFLOW_ALERT_WEBHOOK_URL` | `DISCORD_WEBHOOK_URL` — the only **ops** member of this list |

`api/services/desk_session_recap.py:35-39` is a tenth, shaped differently: the dedicated
`DISCORD_RECAP_WEBHOOK_URL` is used **only** when `category == "live trading sessions"`; every other
session type returns the `DISCORD_WEBHOOK_URL` fallback by design (`:32-34`).

⭐ **And the counter-precedent already exists in the same estate.**
`api/services/calendar_week_poster.py:42-43`: *"`live` NEVER falls back — an unset production
webhook must stop the post, not redirect it into whatever other channel happens to be
configured."* **That is the rule §6 generalises.** `cream_card.py:105` states the *opposite* intent
for its own chain — *"Fallback chain mirrors alpha_gold_eod so it can never default to a public
channel"* — which is true and is not the same property: not-public is not the same as not-ops.

---

## 2. THE SEVERITY VOCABULARY IN USE

There are **two** vocabularies and **one** of them is enforced.

| | door A (`alerts.py`) | door B (`chart_health_alerts.py`) |
|---|---|---|
| declared constants | `SEVERITY_INFO` / `_WARNING` / `_CRITICAL` (`:89-91`) | ⛔ none |
| the values | `"info"`, `"warning"`, `"critical"` | free string; **3** distinct literals reach it (D14): `"critical"`, `"warning"`, `"warn"` |
| what fires Discord | `warning` **or** `critical` (`:350`) | `critical` **only** (`:37`) |
| default when unspecified | `_TYPE_SEVERITY` (`:119-125`), else `info` (`:321`) | no default; the parameter is required |

⚠️ **The brief's premise — "`severity="critical"` is what makes a Discord webhook fire" — is true of
door B and false of door A.** `alerts.py:350` fires on `warning` too, and
`alert_taxonomy/regime_change.py:53` records the same from the other side (*"`add_alert` fires the
Discord webhook for WARNING or CRITICAL"*). `discord_render/stall_record.py:16` states door B's rule
correctly: *"⛔⛔ SEVERITY MUST BE `"critical"` OR NOTHING IS PAGED."* Both sentences are right about
their own door. **A router that assumes one rule for both doors will silently change door A's
behaviour for `warning`.**

There is also a **delivery-outcome** vocabulary, and it is the one good thing to build on:
`CHANNEL_OK` / `CHANNEL_FAILED` / `CHANNEL_SKIPPED` (`alerts.py:107-109`), with the reasoning at
`:94-106` — *"'we tried and it did not land' and 'we never tried' are different facts … an unset
`DISCORD_ALERT_WEBHOOK` reported as `failed` would send somebody hunting a provider outage that does
not exist, and reported as `ok` would claim a channel nobody is listening on."* §7 requires the new
resolver to report in this vocabulary and adds nothing to it.

---

## 3. THE CONSTRAINT THAT MUST SHAPE THE DESIGN

⛔⛔ **A split that adds a class field and keeps one channel has not solved the problem it is named
for.** Three independent artifacts in this repository say so.

1. **The channel is shared with signups, and source says it.**
   `api/terminal_next_monitor_main.py:18-19` — *"THE ADMIN CHANNEL, NEVER THE MEMBER OR PUBLIC ONE.
   Posts go to `DISCORD_WEBHOOK_URL` — the admin webhook, the same one signups and `curator_health`
   use."* `tests/test_terminal_next_monitor.py:44-45` asserts that identity as a rail. And
   `discord_notify.py:11` is the same variable, serving `notify_signup` at `:31`.

2. **It has already cost a real message.** `10-roadmap/2026-09-29-quiet-window-runsheet.md:28-31`:
   *"The admin webhook and the signup notifications also share a channel, so a bot post would have
   buried this among signup alerts — which is one of the two reasons it was posted by hand in the
   browser."* A human worked around this channel rather than use it.

3. **The mechanism that mutes it is documented three times over.**
   `observability-plan.md:471-475`: the desk audit's 3 h grace exists because *"without it the alert
   fires on every healthy session and is muted within a week"* (the primary is
   `api/services/desk_session_audit.py:25`; a third instance is `api/services/desk_article_audit.py:21`), and
   `terminal_next_monitor_main.py:162-163` says the same about a closed market —
   *"alerting on it every weekend is how a monitor gets muted."* The plan's own conclusion:
   *"A channel where a page arrives between two signup notifications is muted by the same mechanism,
   one level up: it is not the individual alert that fires on the normal case, it is the channel."*

**Therefore the acceptance test is a destination, not a field.** `backlog.md:584-585` already says
it: *"(a) An ops-class alarm and a business-class event, emitted in the same run, land in
**different** channels."* A `class` column on an alert row satisfies nothing.

⚠️ **And the estate is already capable of it.** D2 finds **15** webhook identifier spellings; the
codebase routes by destination for content already (`DISCORD_TSDR_WEBHOOK_URL` is the public
~750-member channel, ring-fenced by two rails: `tests/test_terminal_next_monitor.py:52` and
`tests/test_provider_coverage_alerts.py:110-130`). It just does not route for ops.

❓ **Which Discord channel any of these variables actually points at is UNREADABLE-FROM-HERE.** This
pass has no Railway access and did not attempt one. Every destination claim above is a claim about
what **source says** a variable is for.

---

## 4. THE CLASSIFICATION

**The test applied, stated so a reviewer can disagree with a row rather than the list.**

- **OPS** — the reader is whoever keeps the system running. A job did not run; a feed went stale; a
  guard tripped. Remediation is a deploy, a credential, a restart, or a manual edit.
- **BUSINESS** — something a member did, or that happened to a member's data. The reader is the
  owner in a commercial capacity, or the member. Remediation is a reply, a refund, or nothing.
- **BOTH** — **one emit whose two readers want two different destinations.** Not "it is ambiguous",
  and not "it lands in the wrong place": a row is BOTH only when suppressing it for one audience
  would lose the other audience's only copy. **These are the rows where the split is a decision.**

⛔ A misrouted-by-fallback content poster is **not** BOTH. Its audience is unambiguous and its
fallback is a defect. Those rows carry the flag `↩ADMIN-FALLBACK` instead, because conflating a
dual-audience emit with a wrong default would hide both.

### 4.1 OPS

| producer | what it says | evidence |
|---|---|---|
| `api/main.py:2514` `wire_missed` | the engine laptop is off/asleep | `:2519` |
| `api/services/chart_health_alerts.py:70` — **all 22 call sites** as a class | bars stale, source pass-rate, WS disconnect, render stall, provider coverage, wire coverage, wisdom capture/extract/registry, taxonomy version drift, circuit breaker, calendar runway | `:3-6`, `:11-15` |
| `api/event_loop_watchdog.py:423` | the web pod's single event loop wedged | `:24` |
| `api/worker_main.py:547` | worker daily store stale / prewarmer dead | `:542-545` |
| `api/worker_main.py:620` | the public site is down | `:619-625` |
| `api/auth_surface_check.py:448` | a mutating route is ungated on the deployed app | `:1` |
| `api/flow_backup.py:145` | `flow.db` integrity failure | `:32` |
| `api/flow_gap_autofill.py:399` | a market-hours write gap | `:1-6` |
| `api/services/liveflow_monitor.py:47-48` | the live feed went quiet | `:1-6` |
| `api/services/ipo_maintenance.py:153` | a theme needs a manual `themes_taxonomy.json` edit | `:148-151` |
| `api/terminal_next_monitor_main.py:93` | the programme's own gate readings | `:1-10` |
| `api/services/catalyst/{curator_health:57, health:91, rule_learner:217, spend_rail:137}` | catalyst pipeline health | via door C |
| `api/services/{desk_article_audit:210, desk_session_audit:342, desk_session_insights:1272}` | desk pipeline audits | via door C |
| `api/services/{fundamentals_monitor:248,:538, provider_coverage_monitor:744, wire/coverage_monitor:95,:118}` | provider/coverage monitors | via door C |
| `api/services/wisdom/publish/report.py:661` | a publish run's outcome | via door C |
| `api/routers/market_calendar.py:175` | the trading-calendar table runs out in N days | `:112-129` |
| `tools/{breadth_live_open_check:270, desk_creative_watch:80, railway_config_audit:377}` · `scripts/rth-alert.ps1:100` | local-schedule guards | — |

### 4.2 BUSINESS

| producer | what it says | evidence |
|---|---|---|
| `discord_notify.notify_signup` ← `api/routers/auth.py:434` | a member signed up | `discord_notify.py:31` |
| `discord_notify.notify_waitlist_signup` ← `api/routers/waitlist.py:102` | a launch-list join | `:44` |
| `discord_notify.notify_subscription` ← `api/services/stripe_service.py:218/:263/:288` | checkout / cancel / payment failure | `:69` |
| `discord_notify.notify_churn_risk` ← `api/main.py:7046` | an inactive paying member | `:92` |
| `discord_notify.notify_admin_action` | an admin acted on a member | `:102` |
| `api/services/alerts.py:540` `scanner_match` | a candidate for members' bells; `info` ⇒ never posts | `:122` |
| `api/services/journal_two/note_tasks.py:581` | a member's own note reminder; `info` by design | `:578-579` |
| `api/alpha_gold_eod.py` · `cream_card.py` · `darkpool_eod.py` · `oi_morning.py` · `weekly_flow.py` · `discord_watchlist.py` · `live_massive_router.py` · `liveflow_worker.py` | member-facing content cards | ↩**ADMIN-FALLBACK** (D7) |
| `api/services/calendar_week_poster.py:453` | the week-ahead cards | ↩**ADMIN-FALLBACK**, but only on the `test` target; `live` is fail-closed by design (`:42-43`) |
| `api/services/cot_weekly_post.py:41` | paid COT reads | ✅ own var `COT_WEEKLY_DISCORD_WEBHOOK_URL`, no fallback (`:9`) — the clean case |
| `api/services/discord_relay.py:49` | a member's voice-Compass post | rate-limited 5/min/user (`:6`) |

### 4.3 BOTH — 13 call sites across 10 modules

**These are the decisions. Each one is a single emit whose suppression for one reader would lose the
other reader's only copy.**

| # | call site | the OPS reading | the BUSINESS reading | why it is a decision, not a relabel |
|---|---|---|---|---|
| 1 | `api/services/alerts.py:529` `regime_change` | `critical` (`:120`) is the highest severity in the estate and it pages on every market phase transition — a normal-operation event | a **broadcast** member alert (`user_id=None`, `alerts.py:24-33`); the bell is where members read it | Paging on a routine market event is exactly `backlog.md:579-581`'s severity inversion. Demote it and door A stops posting it anywhere; keep it and the ops channel carries a market signal. **The class must change the destination, not the severity.** |
| 2 | `api/services/alerts.py:534` `stop_hit` — ⛔ **STRUCK FROM STEP 6, 2026-09-27. NOT A DECISION: IT REACHES NOBODY.** `alert_stop_hit` is now at `alerts.py:589` and a code-only scan of `api/`, `tools/` and `scripts/` finds **no reference outside its own definition** — its only other mentions in the repo are inside `tests/test_alerts_broadcast_type_reachability.py`, which is the rail that keeps saying so, and this file's own prose. ⭐ **Verified with a CONTROL rather than by an empty result**: the same scan, same pattern, finds `alert_regime_change`'s real caller at `api/routers/push.py:196`, so it is not answering "no" to everything. `alerts.py:20`'s own derived status table already reads `[NOT WIRED]`. ⛔ **Nothing was deleted and nothing was classified.** A class on a producer nothing calls is a guess about a producer that does not exist, and because `alert_routing.resolve_channel` RAISES on an absent class (`alert_routing.py:317`), whoever wires it will be *forced* to choose — the rail doing its job, at zero cost today. ⭐ **But read this before assuming stops are un-notified:** a member IS told, through a different mechanism with a different name — `awareness/rules.py` raises `kind="stop_hit"` at importance 10 and away-delivers via `awareness/engine.py:271` → `deliver_alert_payload` with no severity, i.e. the `"warning"` default. **So the stop-hit notification that actually exists is row 5's problem, not row 2's.** | *(was: a UCT20 book position hit its hard stop — the harness worked)* | *(was: a member-visible book event)* | *(was: `warning` posts it (`:350`). Owner wants it; ops paging does not.)* — and that framing is what the strike corrects: `warning` would post it **if anything called it**. |
| 3 | `api/services/alerts.py:548` `exposure_shift` | the AI regime read moved 20+ points — the engine ran and changed its mind | broadcast member alert | same shape as #1 at `warning`. |
| 4 | `api/services/watchlist_alert_service.py:301` `price_alert` | none | **purely** a member's own alert firing | `severity="warning"` is **hardcoded** at `:305`, so every member price alert posts into door A's webhook and there is no parameter to stop it. BOTH because the fix is a routing decision the caller cannot express. |
| 5 | `api/services/watchlist_alert_service.py:474` (the member fan-out) | none | indicator / catalyst / must-know / calendar / awareness / AI-briefing alerts, all with a real `user_id` (`:468-471`) | ⛔⛔ **The workaround is in the comment**: `:478-481` — bulk member content was set to `"info"` *"so 200 personalized briefs never flood the admin channel (2026-08-28 review)."* Severity is already being used as a channel control. A class field that leaves `:350` reading severity re-creates this. |
| 6 | `api/services/exposure_gate_watch.py:45` | a guard tripped — the wire's exposure gate was crossed intraday (`:49-55`), gated by `EXPOSURE_GATE_WATCH_ENABLED` default `"0"` (`:29`) | emitted as a **broadcast member alert** with no `user_id` | ⛔ `"exposure_gate"` is absent from `_TYPE_SEVERITY` ⇒ `info` (`alerts.py:321`) ⇒ **it pages nobody today**. Classify it OPS and it must start paging; classify it BUSINESS and the guard's whole purpose is a bell entry. The code asserts neither. |
| 7 | `api/services/journal_two/broker/notifications.py:54` | the SnapTrade integration is failing | a member's broker connection broke and they will give up (`:3-8`) | Its docstring is *"member email + owner Discord"* — it is **built** as both, and it reads `DISCORD_ALERT_WEBHOOK or DISCORD_WEBHOOK_URL`, straddling both vars. The decision is which half each variable serves. |
| 8 | `api/services/journal_two/broker/mirror_check.py:67` | a structural invariant broke | the drift is in **one member's** book, so remediation is member-scoped (`:1-7`) | same var straddle at `:67`. |
| 9 | `api/services/journal_two/books_audit.py:299` | a cross-surface audit failed | it reports `user_count` and a per-member failure list (`:297`) | An ops digest whose payload is member data. Routing it to ops puts member rows in the ops channel; routing it to business hides a broken invariant. |
| 10 | `api/services/catalyst/digest.py:123` | none | the morning catalyst digest — also emailed to members (`:133`) and pushed to bells (`:139`) | It reaches Discord through **door C**, the signup channel's sender. Member content on the ops transport. |
| 11 | `api/services/desk_daily_session.py:285` | *"Live Trading Session not published … Check that the webinar ran"* (`:282-284`) | the absence is member-visible | a true ops alarm posted through door C. |
| 12 | `api/services/desk_daily_session.py:308` | none | ⛔ its own docstring says **"Audience-facing"** (`:302`) — a gold embed with a thumbnail and a Watch link | It goes to door C, i.e. `DISCORD_WEBHOOK_URL`, which `terminal_next_monitor_main.py:19` calls the admin channel. **An audience-facing announcement addressed to the ops channel.** Whichever sentence is wrong, one of them is. |
| 13 | `api/services/desk_session_recap.py:36` | none | AI-written session recaps | Only `"live trading sessions"` gets `DISCORD_RECAP_WEBHOOK_URL`; every other category returns `DISCORD_WEBHOOK_URL` **by design** (`:32-39`). BOTH rather than ↩ADMIN-FALLBACK because the fallback is the documented intent, not a default. |

⭐ **The pattern across the BOTH column.** Nine of the thirteen (#1, #2, #3, #4, #5, #6, #10, #12,
#13) are **business or member content whose destination is decided by an ops-shaped mechanism** —
severity, or a fallback chain. Four (#7, #8, #9, #11) are **ops alarms whose payload is member
data**. ⛔ Those two groups need opposite treatment, and a single `class` enum cannot express the
second group at all: an alarm about one member's book is ops by audience and business by content.
§5 therefore routes on **(class, audience)**, not on class alone.

---

#### ✅ STEP 6 — WHAT LANDED ON 2026-09-27, AND WHAT IS STILL THE OWNER'S

⛔ **This section is the STATUS of §4.3's thirteen rows, not a re-derivation of them.** The
authority for every classification below is the decision packet,
`term-011-routing-decisions.md`; the authority for "does it still behave the same" is
`tests/test_alert_destination.py`.

| row | state | what happened |
|---|---|---|
| **7** `broker/notifications.py` | ✅ **CONVERTED** | `_post_discord` asks `alert_destination.ops_webhook()`. Three owner pings — connection broken, sweep failure spike, repeated sync failure — every message body ending in a triage runbook. |
| **8** `broker/mirror_check.py` | ✅ **CONVERTED** | Same, and it carries the module's **second** ops caller with it: `run_bias_digest`'s daily 🟢/🔴 line goes through the same `_post_discord`. The conversion boundary is the function, so a second authority for the digest's destination was never created. |
| **9** `journal_two/books_audit.py` | ✅ **CONVERTED** | `_post_discord_summary` asks `ops_webhook()`. ⛔ **The green weekly heartbeat is UNTOUCHED and railed as such** — whether 51-of-52 "nothing is wrong" posts a year should continue is the packet's separate, DEFERRED question, revisited after step 8. |
| **10** `catalyst/digest.py` | ✅ **CONVERTED** (ordinary OPS) | Not a BOTH row: all three legs are admin-only, so there was no second audience to lose. ⛔ **And it carried a live daily duplicate, fixed separately** — see below. |
| **11** `desk_daily_session.py:285` | ✅ **CONVERTED** | A true ops alarm; both bodies are runbooks. |
| **12** `desk_daily_session.py:308` | ✅ **CONVERTED**, and the docstring's claim **DELETED** | Contradiction 3 above is settled: the **docstring** was the wrong sentence, not the destination. The genuinely public path for the same event already exists in `desk_session_announce.py` on `DISCORD_TSDR_WEBHOOK_URL`, behind its own per-show allowlist. ⛔⛔ Settling it the other way — pointing this post at that variable — is a **paid-content leak** to the ~750-member room and is the one consequence in step 6 that no variable can undo. |
| **2** `alerts.py` `stop_hit` | ⛔ **STRUCK** | Zero callers. See the row itself. |
| **13** `desk_session_recap.py` | ⏳ **MOVED TO STEP 5** | A content poster, to fail closed on `DISCORD_RECAP_WEBHOOK_URL`. Not converted. |
| **1** `regime_change` · **3** `exposure_shift` · **4** `price_alert` · **5** the member fan-out | ⛔ **RULED, NOT BUILT** | Ruled owner-delegated 2026-09-27 (`231c51a59`, recorded in the packet's §2a): #4/#5 BUSINESS with the Discord leg removed and the switch on `user_id`; #1/#3 BOTH, resolve twice, **severity untouched**. ⛔ **No code in this change reads or writes any of them**, and the ordering in that ruling is load-bearing: the two `"info"` literals come out only AFTER the member path exists. |
| **6** `exposure_gate_watch.py` | ⛔ **RULED, NOT BUILT** | BUSINESS, no Discord leg, and ⛔ **no `_TYPE_SEVERITY` row** — the ruling notes it is a no-op today, because classifying it BUSINESS makes the class match what the module already does. |

⭐ **WHY SIX ROWS COULD LAND WITHOUT AN OWNER RULING, and it is a measurement rather than an
argument.** `DISCORD_OPS_WEBHOOK_URL` is **absent on all seven services** (read 2026-09-27),
so every converted producer resolves through the compatibility floor to
`DISCORD_WEBHOOK_URL` — today's destination, byte-identically. Each one has a WIRE test
asserting exactly that: today's channel and the exact body with the variable blank, nothing
at all with everything blank, and the ops variable followed once it is set. **Mutation-proved**
by deleting the fallback candidate in `alert_destination.destination_for`: 28 failed / 51
passed, exit 1, including every row above.

⚠️ **ONE REAL SEMANTIC CHANGE, in rows 7 and 8 only.** Both read
`DISCORD_ALERT_WEBHOOK or DISCORD_WEBHOOK_URL`, and `ops_webhook()` never reads the first —
so a *set* `DISCORD_ALERT_WEBHOOK` naming a different room would have **moved three owner
alerts**. That was §6's one unknown and it is now contradiction 4, settled: the two are
byte-equal, one channel with two names. The rail
`test_rows_7_and_8_no_longer_consult_DISCORD_ALERT_WEBHOOK` reds if they ever diverge.

⛔ **A SEPARATE, PRE-EXISTING DEFECT FOUND WHILE READING ROW 10 — fixed on its own.** The
digest's **bell** leg passed no severity, so it took `deliver_alert_payload`'s
`severity="warning"` default; `add_alert` fires Discord on warning/critical, so the digest
**also posted itself once per admin recipient** on top of its own single post. ⭐ **And
contradiction 4 sharpens it beyond what the packet supposed:** the packet reasoned those
copies went to *a second room*, because door A reads `DISCORD_ALERT_WEBHOOK` while the
digest's own post reaches door C. The two variables are the same value, so the morning digest
was posting **1 + N copies of itself into ONE channel every day**. Fixed by stating
`severity="info"`, which is the honest priority for a daily informational brief rather than a
channel trick — so unlike the two `"info"` literals at `ai_search_briefings.py:282` and
`ai_search_deep.py:530`, this one stays correct after step 7's `user_id` branch lands.
⛔ **It does not close the class.** While `alerts.py`'s Discord gate reads severity, every
producer that wants to be quiet must state a priority and every producer that forgets is
loud. That is step 7's.

---

## 5. THE PROPOSED ROUTING — configuration before code

### 5.1 The resolver

One pure function, one module, no transport of its own:

```
resolve_channel(alert_class, severity) -> ChannelDecision
```

- `alert_class` ∈ `{OPS, BUSINESS}` — **required, no default.** `backlog.md:585-586` is explicit:
  *"(b) The resolver has no default: an unclassified emitter fails the rail by name."*
- A **BOTH** producer does not pass `BOTH`. It calls the resolver **twice**, once per class, and the
  transport fans out. BOTH is a property of the producer, never a value of the field — a third enum
  member is the one-channel non-solution wearing a class field.
- `severity` stays the **within-class** priority. ⛔ It stops being a router. Door A's
  `fires_discord` at `alerts.py:350` and door B's `!= "critical"` at `:37` become inputs to the
  resolver instead of the decision.
- The return value reports in the **existing** vocabulary — `CHANNEL_OK` / `CHANNEL_FAILED` /
  `CHANNEL_SKIPPED` (`alerts.py:107-109`) — plus the resolved variable **name** (never its value),
  so a caller can say *which* route was taken. ⛔ No new outcome vocabulary.

### 5.2 The variables, and the failure direction of each

⚠️ **Every variable below is NAMED, UNREAD.** This pass has no Railway access and did not attempt
one. No flag state is asserted anywhere in this document.

⛔ `feedback_kill_switch_never_a_delete`: **every one of these is switched off by blanking it, never
by removing it.** `tools/audit_sandbox_env.py:57-58` already states the rule for this exact variable:
*"⛔ BLANK, never popped — a blank webhook posts nothing; removing the var lets a default
re-appear."* And the failure direction must be stated per variable, because it is not the same one
twice.

| variable | status | routes | UNSET ⇒ | failure direction when unset | why that direction |
|---|---|---|---|---|---|
| `DISCORD_OPS_WEBHOOK_URL` | ⛔ NOT IN SOURCE (new) | every OPS post | **fall back to `DISCORD_WEBHOOK_URL`, and stamp the post `route=fallback:admin`** | **NOISE, visibly labelled** | An ops alarm that vanishes because a new variable was not set is the worst outcome in this document — `chart_health_alerts.py:11-13` records what that already cost: *"the in-memory deque was admin-pull-only, so a bars-store problem paged no one — the gap that let the 2026-08-11 daily freeze run for a week."* Ops must never fail silent. The stamp is what keeps it from reading as success. |
| `DISCORD_BUSINESS_WEBHOOK_URL` | ⛔ NOT IN SOURCE (new) | signups, subscriptions, churn, admin actions | **fall back to `DISCORD_WEBHOOK_URL`** | **NOISE** | Today's behaviour exactly. Business events are already in this channel; keeping them there on an unset variable is a no-op migration, which is what makes the split safe to land before the routing is complete. |
| `DISCORD_WEBHOOK_URL` | ✅ IN SOURCE — read by **30** files under `api/` (D1), **36** across `api tools scripts` (D1c), **14** of which name no other webhook (D8) | the compatibility floor for both classes | unset ⇒ nothing posts anywhere | **SILENCE, for everything** | Unchanged from today. It is the single point of failure this ticket exists to reduce, and it must keep working while the new variables are unset. |
| `DISCORD_ALERT_WEBHOOK` | ✅ IN SOURCE — door A only (`alerts.py:81`), read at call time (`:84-86`) | door A's Discord leg | unset ⇒ door A posts nothing; `channels["discord"] = CHANNEL_SKIPPED` (`:355-358`) | **SILENCE, correctly reported** | Already three-state-honest. ⭐ Do not change this variable's meaning in this ticket; §6 moves door A last. |
| `OPS_ALERT_EMAIL_TO` | ⛔ NOT IN SOURCE (new) | the **second transport**: OPS + `critical` only | unset ⇒ the email leg reports `CHANNEL_SKIPPED` **with the reason**, and the post still goes to Discord | **SILENCE on the second leg only, and it must say so** | Precedent: `compass_health.py:155-157` returns `"no recipients (set COMPASS_HEALTH_EMAIL_TO or ADMIN_EMAILS)"` rather than skipping quietly. ⛔⛔ **This must be a NEW variable and must NOT be `ADMIN_EMAILS`**: `api/routers/auth.py:110-112` makes `ADMIN_EMAILS` an **authorization** variable that promotes accounts to `role='admin'` on boot (`api/main.py:3133-3150`), so adding an address to receive a page would grant that address production admin. Delivery-only address variables already exist and are the right shape: `CATALYST_ALERT_EMAILS`, `COMPASS_HEALTH_EMAIL_TO`, `DESK_DAILY_SESSION_ALERT_EMAILS`. |
| `ALERT_ROUTING_ENABLED` | ⛔ NOT IN SOURCE (new) | the resolver itself | unset ⇒ **treated as on**; `"0"` restores pre-split behaviour verbatim | **NOISE (i.e. today's behaviour)** | An observability change whose default is off is `project_feature_flag_ledger`'s indistinguishable case: OFF-and-unset reads the same as off-on-purpose. Default-on with an explicit `"0"` escape keeps the rollback a variable, not a revert. ⭐ `backlog.md:592` rates this ticket `tier 0-2` — *"an env var read per emit, no rebuild"* — and that only holds if the switch is read at call time, like `alerts.py:84-86` and unlike `discord_notify.py:11`. |
| `CHART_HEALTH_DISCORD_ENABLED` | ✅ IN SOURCE (`chart_health_alerts.py:89`), default `"1"` | door B's page | `"0"` ⇒ no page, deque still fills | **SILENCE, deliberate** | Unchanged. It is the model for `ALERT_ROUTING_ENABLED`'s default-on shape. |

⚠️ **The `ADMIN_EMAILS` hazard is live, not hypothetical.** `ADMIN_EMAILS` has **27** reader files
(D19) and its two hardcoded additions are at `auth.py:111-112`. An outside contractor already holds
production admin in this estate. **Naming the wrong variable here is a privilege grant.**

### 5.3 How a misrouted alert becomes detectable

Four mechanisms, in the order an operator would reach them. ⛔ None of them is "read the channel".

1. **Every post carries its route.** The resolved variable **name** (never its value), the class, and
   the severity, appended to the post. `terminal_next_monitor_main.py:30-31` already requires the
   analogue: *"EVERY POST CARRIES THE RUNNING COMMIT AND THE TIMESTAMP, because a reading without
   the build it came from cannot be compared to the next one."* A post whose stamp says
   `route=fallback:admin` is a misroute visible in the message itself.
2. **The set/unset surface already exists.** `api/routers/admin_api_health.py:41-46` reports
   set/unset per key and never returns values (`_key_status`, `:57-59`). The three new variables go
   in `infra_and_comms`; `ALERT_ROUTING_ENABLED` goes in `feature_flags` (`:47-53`). ⛔ A variable
   that is not in that list is a variable nobody can check without Railway.
3. **A population count, not a failure count.** `observability-plan.md:452-455`: *"the widened
   auditor must publish its population size, not just its failures. A guard that reports '0
   unguarded routes' without saying over how many routes is indistinguishable from a guard that
   examined nothing."* So the resolver keeps a per-class counter and the roll-up prints
   `resolved=<n> by class` beside `fallback=<n>`.
4. **An unclassified emitter fails by name, at test time.** §7.

---

## 6. THE MIGRATION ORDER

**In one sentence:** land the variables and the resolver with today's behaviour as their unset
default; convert the **ops-only** producers first, because they are the ones whose destination is
uncontested; then the **↩ADMIN-FALLBACK** content posters, because fixing a default is cheaper than
deciding an audience; then the **13 BOTH** rows one at a time, each a named decision; and only then
remove any fallback — so that at no point does a class exist without a destination, and at no point
does a destination exist without something in it.

| step | what lands | why here and not later | why not earlier |
|---|---|---|---|
| **1** | The three new variables are **created and blank**, and registered in `admin_api_health.py:41-53`. Nothing reads them. | *"Configuration before code"* (`backlog.md:553`). A blank variable is observable and inert. ⭐ This is also the only step that is pure configuration, so it is the only one that can be verified before any build. | — |
| **2** | `resolve_channel` + its test file, with **no** caller. The fixture that proves criterion (c) — primary blanked, `critical` still reaches the second channel — is **seen red first** (`backlog.md:587-588`). | A resolver with no caller cannot break a member. And a rail that has never been red has not been proved able to fail. | — |
| **3** | The **OPS-only** producers in §4.1 are converted: door B's 22 sites as one class, then the direct ops posters. | ⛔⛔ **This is the step the roadmap means by "before the traffic."** `backlog.md:564`: the split *"must land before the traffic it fixes."* `TERM-013`, `TERM-015`, `TERM-016` and `TERM-086` all add ops volume to this channel (`backlog.md:649`, `:733`, `:1507`), and a channel that is muted before their traffic arrives mutes their traffic too. | Cannot precede step 2: there is nothing to call. |
| **4** | The **second transport** is wired for `(OPS, critical)` only. | It is the one acceptance criterion a single channel cannot satisfy — *"With the primary channel's variable blanked, a CRITICAL still reaches the second channel"* (`backlog.md:586-587`). ⭐ The pattern already ships: `catalyst/health.py:90-108` posts to Discord **and** emails `CATALYST_ALERT_EMAILS or DESK_DAILY_SESSION_ALERT_EMAILS or ADMIN_EMAILS`. Reuse that shape with a delivery-only variable per §5.2. | Cannot precede step 3: a second channel for an unrouted class carries nothing, and `backlog.md:589` rules the genuine second transport **M** while the split is **S** — *"Ship the split."* |
| **5** | The **9 ↩ADMIN-FALLBACK** content posters (D7) stop terminating in `DISCORD_WEBHOOK_URL` and fail closed instead, following `calendar_week_poster.py:42-43`. | Each is a one-line change to a resolution chain with an owner-visible consequence (a card stops posting rather than posting to the wrong room). It is the cheapest reduction in ops-channel volume available. | ⛔ Not before step 3: removing a fallback while the ops route is unbuilt turns eight content posters silent with nothing yet listening for the silence. |
| **6** | The **13 BOTH** rows in §4.3, **one commit each**, each naming the audience it splits and the destination for each half. Rows #4 and #5 come first — they are the ones where severity is currently doing the routing. | ⛔ These are decisions, not conversions. Batching them makes a wrong one unattributable. Rows #4/#5 first because `watchlist_alert_service.py:478-481`'s workaround is load-bearing today: undo it in the wrong order and 200 personalised briefs land in the ops channel. | ⛔ Not before step 3: until OPS has its own destination, every BOTH row's ops half has nowhere to go, so "splitting" it is a relabel — precisely what §3 says does not solve the problem. |
| **7** | Door A (`alerts.py:350`) stops deciding on severity and starts asking the resolver. | Door A serves **9** production call sites of which **6** are in the BOTH column, so it is the door with the most decided-elsewhere behaviour. It is also the only door already honest about its three delivery states (`:94-106`), so it is the safest to change **last** and the most expensive to change first. | ⛔ Not before step 6: changing `:350` changes the behaviour of rows #1-#5 simultaneously. |
| **8** | `DISCORD_OPS_WEBHOOK_URL`'s fallback to `DISCORD_WEBHOOK_URL` is removed — and **only** if step 3's roll-up shows `fallback=0` over a full weekly cycle. | The fallback exists so step 3 cannot cause silence. Once nothing uses it, it is a second authority over the destination. | ⛔ Never before a measured `fallback=0`. Removing it on the assumption that the variable is set is asserting a flag state, which this document may not do. |

⛔ **Why not "split the channel first, convert later".** Because `DISCORD_WEBHOOK_URL` has 30 reader
files under `api/` (D1) and 14 of them name no other webhook (D8). Repointing it moves all 36 at
once, including the six signup/subscription business events at `auth.py:434`, `waitlist.py:102`,
`stripe_service.py:218/:263/:288` and `main.py:7046` (D26). ⚰️ And door C reads it at **import**
(`discord_notify.py:11`), so the operator who repoints it reads the variable back changed while the
running process keeps posting to the old destination — the exact failure `alerts.py:63-80` documents.

⛔ **Why not "do the BOTH rows first, since they are the interesting ones".** They are the
interesting ones and that is why they go last. Each needs a destination to split into, and step 3
is what creates it.

---

## 7. THE RAIL THAT WOULD PROVE A MISROUTE

⛔ **A rail that cannot be red has proved nothing.** Each of the four below must be **seen red before
it is green**, and each is written with a control, per `backlog.md:575-576` (item 25 §4.6 method 1).

| rail | what it asserts | how it can fail | the control that stops it passing vacuously |
|---|---|---|---|
| **R1 — different channels, same run** | `resolve_channel(OPS, s)` and `resolve_channel(BUSINESS, s)` return **different** variable names, for every `s` in the union vocabulary of §2 (`info`, `warning`, `critical`, **and `warn`**) | make both return the same name | ⭐ assert the two names are **both non-empty and unequal** — `"" != ""` is false, but a pair of empty strings would otherwise read as "different" nowhere |
| **R2 — no default** | an unclassified emitter **fails by name**: `resolve_channel(None, ...)` raises, and the error text contains the producer's module path | give the resolver a default | a positive case for each of the two valid classes in the same test, so "everything raises" cannot pass |
| **R3 — the second channel survives the first** | with `DISCORD_OPS_WEBHOOK_URL` and `DISCORD_WEBHOOK_URL` both **blanked** (`monkeypatch.setenv(..., "")`, ⛔ never `delenv` — `tools/audit_sandbox_env.py:57-58`), an `(OPS, critical)` decision still names `OPS_ALERT_EMAIL_TO` | blank the second variable too and require `CHANNEL_SKIPPED` **with a reason string**, not a bare skip | the same input with `severity="warning"` must **not** reach the second channel — otherwise the rail passes on a resolver that emails everything |
| **R4 — no producer can name the wrong destination** | for each module converted in steps 3-7, the **compiled code object** of the emitting function does not name a webhook variable outside its class | point one at the other class's variable | ⭐ the positive half: it **must** name its own class's variable (`test_terminal_next_monitor.py:55` — *"the code-only view lost the real webhook"*) |

⭐ **R4's mechanism is already in this repo, twice, and the better of the two is the bytecode read.**
`tests/test_provider_coverage_alerts.py:125-130`: *"`_alert`'s compiled bytecode must not
NAME-REFERENCE the TSDR webhook anywhere (`co_names` holds referenced globals/attrs, not string
literals — so a mention in the docstring can't false-positive this the way grepping source text
would)"*, i.e. `assert not any("TSDR" in n for n in pcm._alert.__code__.co_names)`. The source-text
variant is at `tests/test_terminal_next_monitor.py:50-55`. ⛔ **Use the `co_names` form.** Every
module in §1.5 mentions other webhook names in comments and docstrings, so a text grep would be red
on arrival for reasons that are not misroutes.

⛔ **The rail this ticket cannot have.** There is no detector for the severity inversion —
`backlog.md:579-581`: *"`RSK none-named` — the hazard is a ledger row and `GOVERNING_PRINCIPLES` §13,
not an `anti-patterns.md` entry, so no detector exists."* R1-R4 prove that a class reaches a
distinct destination. **They cannot prove the class is the right one.** §4's classification is
reviewed by a person or it is not reviewed.

⚠️ **Scope the test run.** These are four new test functions in one new file. ⛔ Never an unscoped
`pytest` — name the file.

---

## 8. CONTRADICTIONS FOUND

⛔ **Reported, not resolved.** Each is two statements in source or in an accepted artifact that
cannot both be true, and this document changes neither.

1. **The two severity gates.** Door A fires Discord on `warning` **or** `critical`
   (`alerts.py:350`; corroborated by `alert_taxonomy/regime_change.py:53`). Door B pages on
   `critical` **only** (`chart_health_alerts.py:37`; corroborated by
   `discord_render/stall_record.py:16`). Both are right about their own door; there is no single
   estate-wide rule, and the brief's framing assumes there is.
2. **`"warn"` vs the comment above it.** `bars_reconciliation.py:358` passes `"warn"`;
   `:352-353` claims the emit *"pages someone"*. Under `chart_health_alerts.py:37` it pages nobody.
3. **"Audience-facing" addressed to the admin channel.** `desk_daily_session.py:302` calls
   `_notify_published` *"Audience-facing"* and sends it through door C, i.e. `DISCORD_WEBHOOK_URL`,
   which `terminal_next_monitor_main.py:19` and `test_terminal_next_monitor.py:44-45` call the admin
   channel that also carries signups.
4. ✅ **SETTLED 2026-09-27 — IT IS ONE CHANNEL WITH TWO NAMES, and the comment is not stale.**
   Read from the Railway service configuration during step 6's mechanical half, comparing the
   two values **by sha256 digest and by the Discord webhook id in the URL path, so neither
   value was ever printed**: on `web` and on `flow-worker` — the only two services that carry
   both — `DISCORD_ALERT_WEBHOOK` and `DISCORD_WEBHOOK_URL` are **BYTE-EQUAL** and carry the
   **same webhook id**. So *"the global admin webhook"* is an accurate description of what
   `add_alert` reaches, and `DISCORD_ALERT_WEBHOOK` is currently **redundant** with
   `DISCORD_WEBHOOK_URL`. ⛔ That redundancy is NOT this ticket's to remove — recorded because
   it is what the ❓ below was asking, not as a proposal. ⛔⛔ **And it was settled by
   measurement, NOT by the broker modules' convenience**: the original text below is right that
   two modules treating the variables as interchangeable is evidence and not proof, and that
   reasoning was deliberately not relied on. The consequence is that step 6 rows 7 and 8 could
   convert without moving anything (`tests/test_alert_destination.py::test_rows_7_and_8_no_longer_consult_DISCORD_ALERT_WEBHOOK`
   is the rail that keeps it that way if the two ever diverge). ⚠️ A variable read is a DATED
   claim: this says what the configuration held on 2026-09-27, not what it will hold.

   The original, for the record: **Two variables, one claimed channel.** `watchlist_alert_service.py:478-479` says `add_alert`
   *"fires the global admin webhook"*, but `add_alert` reads `DISCORD_ALERT_WEBHOOK`
   (`alerts.py:81`), not `DISCORD_WEBHOOK_URL`. Either both variables point at one channel
   (❓ UNREADABLE-FROM-HERE) or the comment is stale. `journal_two/broker/mirror_check.py:67` and
   `notifications.py:54` read `DISCORD_ALERT_WEBHOOK or DISCORD_WEBHOOK_URL`, which is source
   evidence that the estate treats them as interchangeable — evidence, not proof.
5. **Two call-time disciplines for one variable.** `chart_health_alerts.py:48/:88` reads
   `DISCORD_WEBHOOK_URL` at call time; `discord_notify.py:11` captures it at import. Blanking it
   silences door B immediately and door C not until restart.
6. **The webhook counts.** `observability-plan.md:456-458` → **30** ("thirty modules", unit stated as
   modules, pattern `grep -rl … api/ --include=*.py`). `roadmap.md:807` → **36** (files, `api tools
   scripts`). Both reproduce exactly at `be9ca78b6` (D1, D1c). `roadmap.md:689-692` already declines
   to correct either and **so does this document**; the second number is a wider pathspec, not a
   contradiction of the first. ⚠️ What *is* a wording contradiction is "modules": D1b shows all 30
   are `.py` files, and a file is not a module when a module posts through a helper in another file.
7. **`"never default to a public channel"` vs the ops channel.** `cream_card.py:105` states its
   fallback chain *"can never default to a public channel"* — true, and not the property that
   matters here: its terminal fallback is the ops/signup channel (`:110`).
8. **A rail asserts the typo.** `bars_reconciliation.py:358` passes `"warn"`, which pages nobody
   (contradiction 2) — and `tests/test_reconcile_detect_only_daily.py:61` asserts that exact string is
   passed. The test is green and the behaviour is wrong; both statements are in source.
9. **`ep_resolved` is in the severity map and has no producer.** `alerts.py:123` assigns it `info`
   and `alerts.py:9`/`:26` document it as an alert type, but D3p finds no production call site for it.
   ⭐ Independently found in the concurrent lane's `term-018-can-every-guard-fire.md:214, :321`
   (*"no implementation at all"*). ⛔ Reported, not resolved: this document classifies producers, and a
   type with no producer is not one.
10. **`exposure_gate_watch` asserts neither class.** It emits a broadcast member alert (`:45`, no
   `user_id`) for what its own module computes as a tripped gate (`:49-55`), with a type absent from
   `_TYPE_SEVERITY` so it reaches nobody through Discord.

---

## 9. WHAT THIS SPEC EXPLICITLY DOES NOT DECIDE

- ⛔ **Which Discord channel any variable points at.** ❓ UNREADABLE-FROM-HERE. No Railway access;
  none attempted. No flag state is asserted anywhere above.
- ⛔ **Whether any of these variables is currently set.** Every one is **NAMED, UNREAD**.
- ⛔ **The second transport's technology.** §6 step 4 names email because
  `catalyst/health.py:99-108` and `compass_health.py:145-166` already ship that shape and D17 finds
  `send_email` at 18 call sites across 10 files. ⛔ There is no pager and no Slack integration in
  source (grep for `PAGERDUTY|SLACK_WEBHOOK|OWNER_ALERT_EMAIL` under `api tools scripts` → **0**
  files). Choosing something else is a separate decision; `backlog.md:589` rates a genuine second
  transport **M** and says *"Ship the split."*
- ⛔ **Whether door C's import-time capture is fixed in this ticket.** It is named (§1.4,
  contradiction 5) because it changes what "blank the variable" means, and it is a one-line change
  with the fix already written next door at `alerts.py:84-86`. Sequencing it is step 3's
  implementer's call.
- ⛔ **Any consolidation of the 25 transports (D27) into one poster.** `backlog.md:568`: *"Reuse the
  **routing**, not a second copy of the poster."* This ticket adds a resolver, not a transport.
- ⛔ **The `alert_taxonomy` CHANNEL_REGISTRY.** `specs/alerts-monitoring-spec.md:544-560` owns that
  design and `delivery.py:6-10` records it unbuilt. This spec's resolver is what that registry's
  `"discord"` entry would call; it does not build the registry.
- ⛔ **Anything in `app/**`.** The member bell reads `GET /api/alerts`; no class field is proposed on
  that response, and `alerts.py:307-312` gives the standing reason a delivery-status key must not
  ride on the member's row.
- ⛔ **Cost and usage** — de-scoped by the programme. **Licensing** is in scope and is **CLEARED**:
  `backlog.md:572` — *"Licensing: CLEARED (existing estate, CARD 26) — no feed."* No new data source.
- ⛔ **Any execution or order-management behaviour.** Out of scope, permanently.
- ⛔ **`TERM-011`'s size, dependency or rollback tier** — carried unchanged from `backlog.md:589-592`
  (`S`, no blockers, `tier 0-2`).

---

## GAPS — what this pass did not reach

1. ⚠️ **§4's classification is a judgement, not a grep.** The call-site list is mechanical and
   reproducible; the OPS/BUSINESS/BOTH column is not. Rows #6, #9 and #11 are the three I would
   expect a reviewer to move.
2. ⚠️ **D27 under-counts transports** (see §0). Four modules that certainly post are outside it.
   A complete transport census needs a call-graph, not a grep.
3. ⚠️ **Door D was classified from module docstrings**, not from tracing each `_post_discord` to a
   scheduler. A module whose docstring describes one purpose may post for two.
4. ⛔ **No behaviour was observed.** Every claim here is a read of git at `be9ca78b6`. A file at
   `origin/master` is a file, not a behaviour — `roadmap.md:817-820` states the same limit for its
   own V1-V12.
5. ⚠️ **The `alert_taxonomy` package (29 files) was read only for its delivery seam.** Its eight
   trigger types' own routing preferences are `specs/alerts-monitoring-spec.md:669`'s
   `alert_routing_prefs` and were not enumerated here.
6. ⚠️ **The tools/ and scripts/ six (D1c) are local-schedule guards**, and whether they run at all is
   a Task Scheduler fact, not a source fact. They are listed in §4.1 and otherwise unanalysed.
