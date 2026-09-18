---
id: PACKET-V
title: SQL resolution across every service volume — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: ⛔ UNSIGNED. The approval block below is EMPTY and that is its correct state.
date: 2026-09-15
---

# PACKET V — `/data` is six volumes, and the resolver only ever read one

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-17
APPROVED AT SHA:  f94d7addc
SCOPE APPROVED:   CP4 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED.** Gate line:
> `docs/terminal-research/12-decisions/gates/packet-b-schema-resolution-gate.md` §4.
> This adds **CP4** to Packet B's roster. **Non-collision:** B's roster holds CP1–CP3 and
> no CP4; `PACKET-V` appears nowhere in either worktree (control: the same search finds
> `PACKET-B` and `PACKET-D`). ⛔ **Packet B's approval block is not touched** — a new
> checkpoint is added to its §4, never a signature altered.

⛔ **ZERO PRODUCT CODE.** One instrument, read-only, and a documentation correction.

---

## 1 · The finding, which is this programme's own error twice over

**F-B-1 at product level.** Packet B measured *"73 `.db` files, 63 live"* and that is
**web's volume**. There are six services. The two largest data assets in the product —
`flow.db` (9.18 GB) and `bars.db` (24.7 GB) — are on volumes no measurement in B had
looked at, and `oi_massive.db`, reported in B §3.2 as *"in the inventory, not on the pod"*,
is live on flow-worker.

---

## 2 · V.1 — the told-vs-found table for the whole product

Read-only, shell-only (`railway ssh --service <name> "ls -la /data"`), no writes, no
restarts.

| service | state | `.db` at top level | notable |
|---|---|---|---|
| **web** | READ | **65** (73 recursive, 63 live) | `auth.db` 378 MB · the volume every earlier measurement used |
| **worker** | **READ** | **7** | `bars.db` **26.8 GB**, mtime now · stale `auth.db`/`cot.db`/`flow.db` from May–Jul |
| **flow-worker** | READ | **13** | `flow.db` **9.18 GB** · `oi_massive.db` 842 MB · `oi_snapshots.db` 984 MB · `pushed.db` live |
| **bars-api** | READ | **3** | `bars.db` **24.7 GB**, mtime now |
| **chart-renderer** | **NO `/data`** | 0 | ⭐ an ANSWER, not a gap — the service has no volume |
| **terminal-next-monitor** | **UNREADABLE** | — | serverless, scaled to zero; SSH refused while idle |

**READ 4 · NO /data 1 · UNREADABLE 1.**

⚰️ **Two of yesterday's three UNREADABLEs were artifacts of my own probe.** It shipped a
Python payload, so `chart-renderer` failed with `/opt/venv/bin/python: not found` and was
filed UNREADABLE — when a shell-only `ls` shows it has **no `/data` at all**. And `worker`
was merely asleep at that moment; today it answered. ⭐ **An instrument's dependency is not
a property of the thing it measures**, and yesterday's table let one masquerade as the other.

⛔ **The one remaining UNREADABLE was NOT woken.** Sending a request to a sleeping
production service is a state change. The unlock is recorded instead: *send one request, or
disable "Sleep when idle", then re-run.*

---

## 3 · V.2 — the sweep

`tools/sql_resolves.py --all-services`. Every service's `/data` read `sqlite_master`-only
over `mode=ro`; DDL replayed into `:memory:` replicas; prepare-only `EXPLAIN`; every
database keyed **`service:path`**.

```
services TOLD: 6  (source: railway status --json)
services FOUND readable: 4 of 6   DELTA != 0
databases: 99 (LIVE 86 + pre-migration copies 13) | DDL: 2527 replayed of 2631 | tables: 1254
read-queries: 9 → RESOLVES=8 UNPREPARABLE=1 MISSING=0
```

**99 databases, not 73.** Controls ran first and passed (15 cases), including six new ones:

| new control | why |
|---|---|
| an asleep service is told to **wake** | — |
| a missing interpreter is **NOT** told to wake | ⚰️ v1 printed one canned remedy for every error, sending the reader to do the wrong thing with confidence |
| …it is told to use the shell-only probe | the derived remedy |
| an unrecognised error gets **no invented remedy** | silence beats a guess |
| a `service:` prefix never makes a live file look like a backup | the key format changed; the classifier must not |
| a real backup path is still caught **behind** a prefix | the other direction |

---

## 4 · V.3 — cross-volume duplicates

**120 of 464 distinct live table names exist on more than one service's volume; 13
filenames are duplicated.**

| filename | services |
|---|---|
| `bars.db` | bars-api · flow-worker · web · **worker** |
| `breadth_monitor.db` | bars-api · flow-worker · web · worker |
| `auth.db` · `cot.db` · `flow.db` · `modelbook.db` · `breadth_daily_ohlc.db` | three services each |
| `catalysts.db` · `darkpool.db` · `industry_map.db` · `oi_snapshots.db` · `pushed.db` · `tweets.db` | web + flow-worker |

⭐ **Two LIVE `bars.db` copies, 2.1 GB apart** — `worker` 26.8 GB and `bars-api` 24.7 GB,
both mtime now. CLAUDE.md documents separate volumes bridged by R2, so this is
architecture, **not a defect claim**. The finding is narrower and real: **a query answered
"from bars.db" is ambiguous until the volume is named**, and until today nothing named it.

⚠️ `flow.db` on **web** is a frozen pre-cutover copy (Jul 2026) and on **worker** is older
still — the live one is flow-worker's. `pushed.db` is the same shape. A single-volume
resolver pointed at web answers such questions from a two-month-old file wearing a live
filename: the `BACKUP-ONLY` hazard, on the wrong volume rather than in a `backups/`
directory, where the existing classifier cannot see it.

---

## 5 · V.4 — `d2_dual_samples.db`: armed, never fired

| question | answer |
|---|---|
| who opens it | `api/services/canonical/dual_sample_store.py:110` |
| who drives it | `canonical/dual_read.py:35` → `api/services/ticker_returns.py:23`; also read by `tools/terminal_next_gate_check.py:53` (the Layer-1 gate check) |
| daemon? | **no** — it is on the request path, not a scheduled job |
| gate | `D2_SAMPLE_PERSIST_ENABLED=1` **is set on web**; `D2_DUAL_COMPUTE_SAMPLE_PCT` is **unset** → `DEFAULT_SAMPLE_PCT = 100` |
| state | 16 KB, **0 rows**, mtime 2026-09-13 04:04 |

⛔ **So it is armed at 100% sampling and has recorded nothing in two days.** Either
`ticker_returns` has not been called on a path that reaches `dual_read`, or the write does
not land. **Reported, not fixed** — a wrong guess here would be the third self-inflicted
finding of the week.

⭐ The dotted-form search is what found the chain: a filename grep returns only the store
itself. `from api.services.canonical import dual_sample_store as _store` is invisible to it.

---

## 6 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP4** | `tools/sql_resolves.py` — `--service` / `--all-services`, `service:path` keys, shell-only shape probe, error-derived unlock advice, six new controls. Plus §2–§5 recorded in Packet B. | none (docs worktree) | **M** |

⛔ **`sql_resolves.py` is no longer single-volume, but it is still SILENT about the one
UNREADABLE service**, and it says so in its own roster line. That is the honest state.

---

## 7 · Drafted ledger row — NOT written

```
| 76 | <CP4 commit> | 2026-09-15 | TOOLING | 1 | Packet V CP4: sql_resolves sweeps all six service volumes (99 dbs, 86 live); chart-renderer has NO /data (an answer), terminal-next-monitor UNREADABLE; 120 of 464 table names exist on more than one volume
```

## 8 · Drafted RESUME delta — NOT applied

> ⛔⛔ **`/data` IS PER SERVICE.** Six services, five with a volume, one asleep. A count of
> "the databases" without a service name is web's count. ⚰️ 2026-09-15: Packet B's
> 73/63 was web's; `flow.db` (9.18 GB) and `bars.db` (24.7 GB) live elsewhere, and
> `oi_massive.db` was reported missing while live on flow-worker. Sweep with
> `tools/sql_resolves.py --all-services`.
>
> ⛔ **An instrument's dependency is not a property of what it measures.** A Python payload
> made `chart-renderer` look UNREADABLE when it simply has no `/data`; a shell-only probe
> answered. Ask the cheapest question that can distinguish the states.
