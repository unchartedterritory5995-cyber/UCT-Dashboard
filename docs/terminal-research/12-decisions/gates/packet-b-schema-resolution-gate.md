---
id: PACKET-B
title: Resolving a query against the schema the product actually has — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ⛔ UNSIGNED. The approval block below is EMPTY and that is its correct state.
date: 2026-09-14
---

# PACKET B — the phantom-table rail that must not be built, and the resolver that must

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** No checkpoint may be merged until a line
> is signed naming one of them. A signature naming "Packet B" authorizes nothing — §4
> exists so an approval can name a checkpoint instead.

⛔ **ZERO PRODUCT CODE.** Every checkpoint is an instrument, a rail, or a documentation
line. No member-facing behaviour changes under any of them.

---

## 1 · ⚰️⚰️ The packet's own premise was false, and that is the finding

Packet B was opened to build a **phantom-table telemetry rail**: a check that fails when a
research document sizes a decision on a query against a table the product does not have.
Its named instance was **F-OI21-1**, filed 2026-09-13, which asserted:

> ~~"Two of the four OI-21 queries cannot be run — the tables do not exist.
> `calendar_alerts_fired` ABSENT; `ai_search_log` ABSENT, and there is no ai/search table
> of any name."~~

**F-OI21-1 is false and has been retracted** (`208d39f44`,
`verification/2026-09-14/OI-06-telemetry-derived-defaults.md` §5). Measured against every
SQLite database under `/data` rather than one:

| table | where it actually lives | rows |
|---|---|---|
| `ai_search_log` | **`ai_search_log.db`** | **79** |
| `calendar_alerts_fired` | **`calendar_alerts.db`** | **956** |

⭐ **So the rail this packet was opened to build has a population of zero, and the defect
it was opened to prevent is real but lives one level up — in how the question was asked.**

---

## 2 · ⛔⛔ THE REPO ALREADY HELD THE RIGHT ANSWER, IN TWO PLACES

This is what makes the finding worth a packet rather than a line in a log. Nothing had to
be discovered. Both facts were already written down, in this corpus, before F-OI21-1 was
filed:

| artifact | what it already said |
|---|---|
| `01-existing-system/database-and-infrastructure.md` | `` `ai_search_log.db` `` … tables `ai_search_log`, `ai_search_usage`, … · `` `calendar_alerts.db` `` … table `calendar_alerts_fired` |
| `12-decisions/gates/s7-event-proximity-pre-implementation-gate.md:119` | *"`calendar_alerts_fired` … in its **own** database `/data/calendar_alerts.db`"* |

**The measurement did not consult either.** It asked a database instead of asking the
inventory, and the database it asked was the one the question named.

### ⛔ And the question named it. `OWNER_INPUTS_REQUESTED.md`, OI-21, before today:

> *"Four read-only production telemetry queries **against `auth.db`/`bars.db`** (or a
> copy): `page_views` …, `calendar_seen` …, `calendar_alerts_fired` …, `ai_search_log` …"*

⭐ **Two of those four tables are in neither database, and the instrument obeyed the
question.** A research artifact that names the database a table lives in is a **second
authority over the schema** — and this one was wrong, silently, for as long as nobody
resolved a query against it.

**F-B-1 — a question that names its own scope will be obeyed to the letter, including into
an error.** The durable fix is not a rail over documents; it is (a) removing the wrong
scope from the question, and (b) an instrument that resolves against **all** of it.

---

## 3 · ⛔ What was measured, before anything was built

### 3.1 The database roster — "the database" is not a thing this product has

Read from the production pod, **`sqlite_master` only, over `mode=ro` URIs**, no row of
member data touched:

> `PODSIDE keys=73 ddl=2106 unreadable=0` ·
> `RGLOB=73 TOPLEVEL=65 NESTED=8` ·
> nested = `backups/` ×7 + `brain/data/uct_intelligence.db`

| reading | count |
|---|---|
| `*.db` files under `/data`, recursive | **73** |
| at the top level of `/data` | **65** |
| **live** (excluding 10 pre-migration copies) | **63** |
| DDL statements across all of them | **2,106** |
| replayed into fresh in-memory replicas | **2,014** |
| tables in the replicas | **1,022** |

⭐ **This reconciles the "65" figure in the retraction rather than replacing it.** 65 is the
top-level count and is correct; 73 counts `/data/backups/**` and the installed brain pack
as well. Both numbers are stated because a reader meeting "65" and "73" in two documents
would otherwise have to guess which one drifted.

⚠️ **Two files share one basename** — `uct_intelligence.db` exists at the top level of the
inventory's reading and under `brain/data/`. Databases are therefore keyed by **path**, not
name; a basename key silently drops one of them.

### 3.2 ⛔ The corpus inventory is 10 databases short of the pod

`database-and-infrastructure.md` — the artifact that would have prevented F-OI21-1 — holds
**55** distinct database rows against the pod's **63** live files. 53 are in both.

| live on the pod, **absent from the inventory** | DDL statements |
|---|---|
| `uct_intelligence.db` (the installed brain pack) | 94 |
| `wisdom.db` | 81 |
| `alert_taxonomy.db` | 30 |
| `company_news.db` | 19 |
| `entity_master.db` | 14 |
| `d2_dual_samples.db` | 3 |
| `catalyst_news.db` · `fundamentals_monitor.db` · `theme_sets.db` | 2 each |
| `pushed.db` | 1 |

| in the inventory, **not on the pod** | why, measured |
|---|---|
| `compass_eval.db` | its own row records `DATA_DIR` defaulting to a **relative** `"data"` — it is not expected under `/data` |
| `oi_massive.db` | no file; unexplained, and recorded as such rather than deleted |

⚠️ **This is F-OI21-1's shape one level up.** The inventory is the thing a person consults
instead of production, and it is incomplete — so consulting it can also return a confident
wrong answer. **CP3 closes it; it is deliberately not built in this packet** (§4).

### 3.3 The phantom-query population: **zero**

Every read-query in `docs/terminal-research/**`, resolved against all 73 schemas. Final run,
**measured before this file existed**:

⚠️ **Re-running after this packet lands returns 9, not 6** — because the table below quotes
five of the six, in shortened forms that do not dedupe against the originals. That is the
report being right about the corpus, not drift: this document is part of the corpus the
moment it is written. The number to compare against a future run is the **verdict mix**
(zero MISSING), never the raw count.

| verdict | n |
|---|---|
| read-queries found | **6** — `fence:sql`=1, `inline`=5 |
| **RESOLVES** | **5** |
| **UNPREPARABLE** | **1** |
| **MISSING** | **0** |
| blocks skipped as this tool's own output | 1 (§6.7) |

| where | query | resolves in |
|---|---|---|
| `contracts/D-13.md:23` | `SELECT name FROM sqlite_master` | `ai_search_log.db` **(+62 more)** |
| `specs/s12-rollout-spec.md:62` | `SELECT id FROM users WHERE role = ?` | `auth.db` |
| `specs/s12-rollout-spec.md:218` | `SELECT id FROM users` | `auth.db` |
| `10-roadmap/coexistence-current-mechanisms.md:244` | `SELECT pref_key, pref_value FROM user_preferences WHERE user_id = ?` | `auth.db` |
| `gates/s7-position-risk-…-gate.md:106` | `SELECT user_id, symbol, side, entry_price, stop_price, source FROM j2_positions …` | `auth.db` |
| `gates/s12-rollout-…-gate.md:137` | `SELECT id FROM users WHERE role = 'admin` | **UNPREPARABLE** — the quotation cut the string literal |

**MISSING = 0.** Not one query in the research corpus names a table the product does not
have. ⛔ **So the rail Packet B was opened to build would fire on nothing, forever** — and a
rail that can never fire is indistinguishable from one that is broken
(`lesson_gate_that_cannot_fail`).

⭐ **`(+62 more)` is load-bearing.** `SELECT name FROM sqlite_master` prepares against all 63
live databases, and a query that resolves in 63 places must not print identically to one
that resolves in exactly one — **the count IS the attribution.** The first version printed
only the winning file and made those two cases indistinguishable.

⚠️ The single `UNPREPARABLE` is a **quotation artifact**, not a defect: prose truncated the
string literal `'admin`. It is reported rather than swallowed because *"we could not check
it"* and *"it is broken"* are different facts.

---

## 4 · Proposed checkpoints, so an approval line can name one

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | `tools/sql_resolves.py` + `tests/test_sql_resolves_multi_database.py` — the multi-database, prepare-only resolver and its rail. **No existing instrument changed.** | measured at build: **none** (§5) | **M** |
| **CP2** | `OWNER_INPUTS_REQUESTED.md` OI-21 — remove `` `auth.db`/`bars.db` `` and name the database **per table**. One table cell; `git diff --numstat` = `1 1`. | measured at build: **none** | **XS** |
| **CP3** | *(PROPOSED, NOT BUILT)* close §3.2 — add the 10 missing databases to `database-and-infrastructure.md`, each with its env var, owning module and tables derived from source. | not measured | **M** |
| **CP4** | ⛔ **REFUSED — DO NOT BUILD.** The phantom-table rail this packet was opened for. §3.3: population zero. | — | — |

⛔ **CP1, CP2 and CP3 are independently mergeable.** They share no file.

⛔ **CP3 is written as a proposal and left unbuilt on purpose.** Filling ten inventory rows
means asserting, for each, an env var and an owning module — claims about `api/**` that have
to be derived from source, not from a DDL dump. Doing that inside a packet whose subject is
*a confident wrong answer about where a table lives* would be the same mistake wearing a
different hat.

---

## 5 · ⛔ Watch-coverage classification — MEASURED at build time, not guessed

`tools/flow_worker_watch_coverage.py`, run against **this** worktree:

| field | value |
|---|---|
| root | `C:/Users/Patrick/uct-worktrees/terminal-research` |
| base | `origin/master` |
| reachable | **78** modules in flow-worker's closure |
| watched | 24 |
| changed | 220 |
| **verdict** | **OK** — stranded: `[]` |
| changed ∩ closure | **none** |

⛔ **`repo_root()` had to be pinned to this worktree.** It defaults to the directory of its
own file, which is the **code** worktree — so an unpinned run reports `changed=4` about a
different branch and looks like a clean answer about this one.

⚠️ **`reachable` reads 78 here and 156 in the code worktree.** The closure is a property of
the tree it is measured on, and this branch's `api/**` is older. Both are correct readings
of different trees; neither is quoted as "the" number.

No file in this packet is under `api/**`, so no marker bump and no flow-worker redeploy.

---

## 6 · The evidence for CP1

### 6.1 Prepare, never execute — and never against production

1. The pod half reads **`sqlite_master` only**, over `file:…?mode=ro`. Pinned by an **AST**
   check that reads every string literal handed to `.execute()` inside
   `read_schema_manifest` and asserts each starts with `SELECT` and names `sqlite_master`.
2. DDL is replayed into a **fresh `:memory:` database per source file**.
3. `EXPLAIN <sql>` makes SQLite **prepare** the statement and hand back its VDBE program.
   Table and column resolution happen at prepare time, so a missing name fails exactly as it
   would in production — and the query never runs, against a replica or anything else.

⭐ **Checked with the artifact, not the text:** the verdicts are SQLite's opinion of the
statement, not a regex's opinion of it. A control asserts `EXPLAIN` really does raise on a
missing name, so the mechanism itself is not assumed.

⚠️ **One declared mutation.** Bound parameters (`?`, `:name`, `@name`, `$name`) are rewritten
to `NULL` before preparing — Python's driver refuses a statement with unbound parameters.
Quoted strings are skipped by the rewriter (a control proves a colon inside a literal is not
treated as a parameter), the rewrite can only fill value positions, and every report line
that used it prints `params=N`.

### 6.2 ⭐ The control that names the defect, and the mutation that proves it fires

The fixture is **two** databases with the interesting table in the **second**. A
single-database resolver passes every other case anyone would write.

| step | result |
|---|---|
| MUTATION — `for db, con in conns.items()` → `list(conns.items())[:1]` (v1's defect, rebuilt) | applied by EDIT |
| `--self-check` under mutation | **FAIL** — the two multi-database cases red, every other case still green |
| `pytest tests/test_sql_resolves_multi_database.py` under mutation | **4 failed, 19 passed** |
| RESTORED by EDIT | **25 passed** |

The four that went red: `..._a_table_in_the_second_database_resolves_and_is_attributed` ·
`..._a_single_database_resolver_would_get_this_wrong` ·
`..._a_table_only_in_a_backup_is_its_own_verdict` · `..._the_tools_own_self_check_passes`.

⛔ **Restored by EDIT, never `git checkout`** (`feedback_mutation_check_never_git_checkout`).

### 6.3 A pre-migration copy is not evidence that a table is live

`/data` holds 10 snapshots taken before migrations, beside the running files. A table
dropped by a migration **still resolves against the copy taken before it**, so a resolver
that treats all files alike answers *"fine"* about a table nothing reads any more.

`BACKUP-ONLY` is therefore its own verdict, live files win attribution, and the classifier is
asserted **in both directions** — `auth.db` and `brain/data/uct_intelligence.db` must read as
live, or the two backup cases prove nothing.

### 6.4 ⛔ An absence is only evidence if the instrument could have seen a presence

v1 read ` ```sql ` fences and found **one** query in the entire corpus. That is a true number
about ` ```sql ` fences and a useless one about the corpus: of **241** fenced blocks in
`docs/terminal-research`, **171 carry no language tag** and only **8** say `sql`.

Extraction now reads **any fence plus inline back-tick spans**, and the report prints the
**source breakdown** (`fence:sql=1 inline=5`) so an under-scoped run shows up as a shape
change rather than as a clean bill of health.

⚠️ **Widening it cost a false-positive class, and that was measured too.** `SELECT` and
`WITH` are ordinary English — *"select the most complicated architecture"*, *"with a partial
result set"* are in these documents. Requiring a `FROM`, and requiring `WITH` to carry a
CTE's shape, moved the report from **14 candidates / 8 UNPREPARABLE prose lines** to **6
candidates / 1 genuine truncation**. ⛔ An "unchecked" column that is mostly prose is the
cry-wolf failure that gets an instrument muted inside a week.

### 6.5 Controls (`--self-check`), each failing for a different reason

| control | verdict |
|---|---|
| CLEAN fixture, table in the FIRST database | RESOLVES |
| **CLEAN fixture, table in the SECOND database** | **RESOLVES** ← the F-OI21-1 control |
| …and it is ATTRIBUTED to that database | `b.db` |
| DIRTY fixture, table in NO database | MISSING |
| …and the missing name is REPORTED | `table_that_does_not_exist` |
| DIRTY fixture, missing COLUMN of a real table | MISSING |
| SYNTAX error | UNPREPARABLE, never MISSING |
| bound parameters rewritten and counted | RESOLVES / `params=2` |
| a colon INSIDE a string literal is not a parameter | 1 |
| a table in BOTH is attributed to the LIVE file | `auth.db` |
| a table ONLY in a pre-migration copy | BACKUP-ONLY |
| CONTROL: a plain name is NOT read as a backup | `False` |
| CONTROL: a dated copy IS read as a backup | `True` |
| EMPTY input: zero schemas | UNPREPARABLE, "no schemas to try" |
| EMPTY input: zero queries | exit 2 |

⭐ **Required by the instrument-self-reference rule**: a known-clean fixture, a known-dirty
fixture, and what the tool reports on empty input — *and* the empty cases are two different
kinds (no schemas, no queries), because the derivation can break at either end.

### 6.6 ⚰️ The rail's own first version committed the CODE-NEVER-PROSE defect

`test_the_schema_reader_opens_read_only_uris_only` v1 searched the function's **text** for
`DROP`, `DELETE`, `INSERT` — and matched the word **"dropped"** inside the comment
*"unreadable is RECORDED, never dropped silently"*. It **refused a correct implementation
because of the sentence explaining it**.

⛔ **The fix was the check, not the comment.** It now walks the AST for every string literal
handed to `.execute()` — comments excluded by construction — with a **positive control** (a
fixture containing `DELETE FROM users` is caught) and a **negative control** (a comment
naming every write verb is not).

### 6.7 ⚰️⚰️ AND THIS PACKET'S OWN §3.3 TRIPPED IT, WHILE BEING WRITTEN

§3.3 first quoted a raw run of the tool. The extractor read its verdict lines —
`RESOLVES … SELECT name FROM sqlite_master …` — as a **candidate query in the corpus**,
prepared it, and reported `UNPREPARABLE: near "specs": syntax error`.

⭐ **An instrument reported a property of ITSELF as a property of the thing it measures,
inside the packet documenting the previous instance of exactly that.** It is the strongest
evidence available that the class is live rather than historical.

⛔ **Fixed in the instrument, never in the prose.** A fenced block recognised as this tool's
own output is skipped, **and the skip is printed and named** so it can never be silent. Both
directions are railed:

| case | why |
|---|---|
| a quoted `[sql-resolves]` run is skipped, and `R_SKIPPED()` names the file | the defect |
| a block whose control line merely reads `MISSING file -> exit 2 ok` is **NOT** skipped | ⛔ the first guard swallowed exactly that line in `packet-c-…-gate.md`. **A skip that is too eager hides real queries**, which is the failure this whole packet is about |

⛔ **The running tally of instrument-self-reference instances lives in ONE place — the
session report.** A hand-typed count beside the list it describes is the defect this
programme keeps re-committing.

---

## 7 · The evidence for CP2

The corrected cell names the database **per table** and drops the blanket scope:

> `page_views` → **`auth.db`** · `calendar_seen` → **`auth.db`** · `calendar_alerts_fired`
> → **`calendar_alerts.db`** · `ai_search_log` → **`ai_search_log.db`**

`git diff --numstat` → `1 1` — one table cell, as required.

It also corrects a second error in the same cell: **`charts_workspace_layout` is not a
table.** It is a `pref_key` VALUE inside `user_preferences` in `auth.db` — which is how the
OI-06 measurement actually queried it, so the cell and the measurement disagreed and the
measurement was right.

---

## 8 · ⛔ What this packet does NOT do, and why

| not done | reason |
|---|---|
| **B.4 — annotate two S6 decisions "UNSIZED until re-measured"** | ⛔ **REFUSED.** Its premise was F-OI21-1, which is false. The S6/S7 alert boundary (§5.2) and *"is personal grounding worth extending"* are sized on queries that **run**, against populations of 956 and 79 rows. Annotating them would have marked sound work as unsound — **a wrong finding is worse than no finding, because it is acted upon.** |
| **CP4 — the phantom-table rail** | population zero (§3.3). A rail that cannot fire reads as coverage. |
| **CP3 — the 10 inventory rows** | proposed, not built (§4). |
| **Any read of row data on production** | `sqlite_master` only; no `COUNT(*)`, no member data, `mode=ro`. |

⚠️ **On `contracts/D-13.md`'s clause** *"never on production"*: that is a **Wave-1 research
agent's** tool scope, not a standing programme prohibition — the same contract limits that
agent to local repo copies because it had no pod access. This read stayed inside the stricter
reading anyway: `sqlite_master` alone, read-only, no counts.

---

## 9 · Drafted ledger rows — NOT written

```
| 69 | `208d39f44` | 2026-09-14 | RETRACTION | 1 | F-OI21-1 WITHDRAWN: ai_search_log (79 rows) and calendar_alerts_fired (956) exist; the check resolved against auth.db alone
| 70 | <CP1 commit>  | 2026-09-14 | TOOLING    | 2 | Packet B CP1: sql_resolves.py - prepare-only resolution across all 73 databases, live-vs-backup aware; rail mutation-proved 4 RED
| 71 | <CP2 commit>  | 2026-09-14 | DOCS       | 1 | Packet B CP2: OI-21 stops naming auth.db/bars.db; the database is named per table
```

## 10 · Drafted RESUME delta — NOT applied

Under **§5 What a session must NOT do**:

> ⛔⛔ **Never resolve a schema question against ONE database.** `/data` holds **63 live**
> SQLite databases (73 files counting `backups/**` and the brain pack). ⚰️ 2026-09-14:
> **F-OI21-1** reported `ai_search_log` and `calendar_alerts_fired` ABSENT FROM THE PRODUCT
> after asking `auth.db`; both exist, with 79 and 956 rows, in their own files — and
> `database-and-infrastructure.md` already said so. The instrument is
> `tools/sql_resolves.py` (prepare-only, all databases, names the one that answers); the
> rail is `tests/test_sql_resolves_multi_database.py`. **F-B-1.**
>
> ⛔ **A question that names its own scope will be obeyed into an error.** OI-21's cell said
> *"against `auth.db`/`bars.db`"* and two of its four tables are in neither. When an open
> question names a database, a file or a module, that name is a **second authority** and must
> be derived, not typed.
