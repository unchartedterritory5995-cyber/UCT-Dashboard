# Terminal-Next — briefing for the Claude Chat session · 2026-09-14

> Written by the Claude Code session doing the work, **from the repo, not from memory**, at
> **ET 2026-09-14 17:51 EDT Mon** (`python tools/weekly_exec.py et` — never Git Bash `TZ=` date,
> see F-CLOCK-1).
>
> ⛔ **Every number below carries the command that produced it.** A number without one is a defect
> in this document. Where a source could not be read the section says **UNREADABLE** and names the
> command that failed — it never guesses.

---

## 0. Read this first — three corrections to the briefing you were given

**These are errors in MY earlier briefing, found by rebuilding it from source.** They matter to you
because two of them change what a future prompt should say.

### 0.a ⛔ There is no single "§4 checkpoint registry", and the §4 rule is partly drift

The standing rule (`COMPLETION_AUDIT.md:246`, owner ruling 2026-09-13), verbatim:

> **Every approval line names a §4 checkpoint ID, or it re-numbers §4 in the same commit so that
> it does. A scope that matches no §4 row is UNSIGNABLE — stop and say so rather than build
> against it.**

Measured across all 22 gate packets:

```sh
for f in docs/terminal-research/12-decisions/gates/*.md; do
  grep -n "^## [0-9]*\..*[Cc]heckpoints" "$f" | head -1; done
```

| where the checkpoint roster actually lives | packets |
|---|---|
| **§4** | 7 — d2, d3, d4, d5, s4, s5, s6 |
| **§3** | 4 — **s1, s2**, s9 |
| **§7** | 1 — s7-indicator-condition |
| **no checkpoint section at all** | 10 |

⭐ **The rule's INTENT is satisfied by every signature** — name a checkpoint, never a system. Only
its literal section number is wrong for some packets. **S1 CP1 and S2 CP2, both signed today, have
their rosters at §3.** Filed as **F-GATE-2**. ⛔ Recorded rather than silently fixed: re-numbering a
packet changes what a past signature pointed at.

**For you:** instead of "name the §4 checkpoint", write **"name the checkpoint ID from the packet's
roster, wherever that roster is numbered"**.

### 0.b ⛔ "All 57 licensing-register rows" was wrong — the register has 118

`EVIDENCE_INDEX.md:69` is the authority: the Massive tier and the FMP DDLA *"between them move
**57 of the 118 rows**"*. My sentence read as *the register having 57 rows in total*. It does not;
the other 61 are settled by facts OI-03 does not touch. **Corrected today in both places this
programme had written it.** The conservative default restricts **57 of 118**.

### 0.c There are SIX Railway services, not five

```
railway status --json   # serviceInstances
  chart-renderer SUCCESS 5032b44a3    bars-api              SUCCESS 5032b44a3
  web            SUCCESS 7707b2241    worker                SUCCESS 5032b44a3
  flow-worker    SUCCESS fb62a44d9    terminal-next-monitor SUCCESS 7707b2241
```

`CLAUDE.md` says **FIVE** and is now stale — because **this programme added the sixth**
(`terminal-next-monitor`, Layer 1) on 2026-09-14. ⛔ CLAUDE.md is on `master` and shared with other
workstreams, so correcting it is a cross-program edit: it is an OPEN QUESTION, not a unilateral fix.

---

## 1. The re-emitted spans

### 1.a The two worktrees, and the stale-ref defect

| | |
|---|---|
| **Code** | `C:\Users\Patrick\uct-worktrees\s7-price-level`, branch `feat/s7-price-level` → **pushes to `master`** |
| **Docs** | `C:\Users\Patrick\uct-worktrees\terminal-research`, branch `terminal-research` |

Because the code branch publishes to master, `origin/feat/s7-price-level` is a ref it outruns
permanently. Measured 2026-09-13: `git status -sb` read **`ahead 99`** while
`git log origin/master..HEAD` was **empty**. Under the old reading of environment check 1
("matching origin" = matching `origin/<branch>`) the weekly autonomous run would **full-stop every
Saturday on a perfectly clean, fully published tree** — and §1 says a failed check is a stop, not a
warning. Fixed by `tools/terminal_next_env_check.py`: "matching origin" now means **HEAD is
contained in its DECLARED publish ref** (`git merge-base --is-ancestor`), with three exit codes —
`0` PASS, `1` measured FAIL, `2` **UNREADABLE** (an unresolvable ref exits non-zero too, and
collapsing that into FAIL reports a broken measurement as unpublished work).

### 1.b The method, complete — and the exact name of the classification step

`WEEKLY_AUTONOMOUS_PROMPT.md:152`, verbatim:

> A unit is: **gate line named by its §4 checkpoint ID → build → named tests → mutations restored
> by edit → in-pod verification → `reachable_paths()` classification → merge in the weekend window
> → ledger row → §6 row → RESUME**. A unit that cannot complete every step **does not merge**;
> leave the branch, record the state in §6, and say so.

**The classification step is `reachable_paths()`**, at `tools/flow_worker_watch_coverage.py:127`
(`grep -n "def reachable_paths"`). It walks flow-worker's import closure and answers *"does this
change touch a module flow-worker runs?"* — which decides whether a merge may go any time or must
wait for the after-hours window, because a flow-worker restart drops the Massive OPRA socket and
**that tape gap is permanent until the T+1 flat file**.

Today's runs printed `reachable=154`→`156`, `watched=24`, verdict `OK` for every unit: **no unit
this session touched flow-worker's closure**, so no marker bump was needed.

### 1.c The three rules that were cut

**1. `tools/sign_gate.py` and pre-existing fingerprints.** It refuses to write into a block that
already carries one: *"⛔ no UNSIGNED `APPROVED AT SHA:` line (every block already carries a
fingerprint). Re-signing would destroy a historical value — add the new approval block first, then
sign."* ⚰️ **The incident:** it once wrote the first REGEX-MATCHING line rather than the first
EMPTY one and **destroyed a historical fingerprint** (`148af5293`), because an earlier block had
trailing prose that stopped it matching while an already-signed block matched. Restored from HEAD,
verified byte-identical, then the tool was fixed to target by **emptiness**, with CONTROL 5 (a
three-block fixture) and CONTROL 6 (refuse re-signing). ⭐ **It fired on its author twice today** —
S2 CP2 and GATE-I1 slice 3 both needed a new empty block added first.

**2. Mutations are restored by EDIT, never `git checkout`.** A checkout restores the whole file and
silently discards any other change in flight; an edit restores exactly what was mutated and leaves
the proof in the diff.

**3. ONE master merge at a time, repo-wide**, enforced **mechanically** by `tools/pre_push_guard.py`
plus the `pre-push` hook in the shared `.git` common dir. It refuses a push to master unless the
newest `web` deployment is `SUCCESS` **and ≥150 s settled**; **UNREADABLE fails closed**. Bypass is
`UCT_SKIP_PREPUSH_GUARD=1`, logged. **It refused roughly six real pushes today** and allowed each
once the deploy settled.

### 1.d Layers 0 and 1 — state fields in full

| | |
|---|---|
| **Layer 0** | `tools/pre_push_guard.py` + the `pre-push` hook. **Live since 2026-09-13.** Rail: `tests/test_pre_push_guard.py`, whose FIRST test is `UNREADABLE → REFUSE`, because the one thing a guard must never do is pass because the thing it guards was unreachable. Proved in production: refused a real push at 135 s, allowed at 157 s. |
| **Layer 1** | Railway service `terminal-next-monitor`. **Live 2026-09-14 00:25Z**, source `unchartedterritory5995-cyber/UCT-Dashboard`@`master`, deploy SUCCESS. Posts to the **admin** webhook `DISCORD_WEBHOOK_URL` — never `DISCORD_TSDR_WEBHOOK_URL`, the public ~750-member channel. A rail asserts the public name appears nowhere in the monitor's **code**, docstrings stripped first (they name it in order to forbid it), with a control proving the stripped view still sees the permitted webhook. |

**Layer 1's four ET schedules**, from `api/terminal_next_monitor_main.py::SCHEDULE`:

| ET | job | what it says |
|---|---|---|
| weekdays **07:20** | `catalyst` | the F-CAT-1 spend/persist receipt |
| weekdays **09:12** | `ticking` | all seven dark sweeps' liveness |
| daily **16:30** | `gate-check` | gate states with numbers |
| Saturday **08:00** | `weekly` | the full comparison |

⛔ Railway allows **one cron per service** and its cron is **UTC**, so the service fires a
**superset** — `0,12,20,30 11,12,13,14,20,21 * * *` — and `due_jobs()` decides what is actually due
from the ET table. That is also what makes DST a non-event. **A firing with nothing due exits
quietly and is not a fault.**

### 1.e OI-06 — answered by measurement, with its queries

Read in-pod against production `/data/auth.db` — **377,946,112 bytes, 29 users, 163 tables, 1,416
columns** (`railway ssh --service web`, `sqlite3` with `mode=ro`). ⛔ Stated because the PRD demands
it: the **dev box** carries a `C:\data\auth.db` with ~20,640 users. **Two databases, identical
filename, an 800× difference.** This is the 29-user one.

| finding | query | result |
|---|---|---|
| distinct surfaces per user | `SELECT user_id, COUNT(DISTINCT page) FROM page_views GROUP BY user_id` | **median 11**, min 1, max 56, n=13 |
| surfaces by total views | `SELECT page, COUNT(*) FROM page_views GROUP BY page ORDER BY 2 DESC` | `/journal/notebook` 1097 · `/charts` 1010 · `/dashboard` 809 · `/breadth` 353 · `/options-flow` 278 … |
| **first** surface of a session-day | per-admin `date(created_at)` group, earliest row per day | `/dashboard` **22** · `/live-massive` 9 · `/options-flow` 5 · `/charts` 4 · `/journal/notebook` 4 (50 day-sessions) |
| unseen-state | `SELECT COUNT(DISTINCT user_id), COUNT(*) FROM calendar_seen` | **16 rows** total |
| DEC-01, do members customize | `SELECT user_id, pref_value FROM user_preferences WHERE pref_key='charts_workspace_layout'` | **17 layouts, 7 distinct widget signatures**, blobs 111→6731 bytes |

⭐ **The two orderings disagree, and that is the finding.** A manifest ordered by total views puts
the notebook first and is **wrong about the morning**: the desk *opens* on the dashboard and *lives*
in the notebook and charts. S1's manifest therefore ranks by **session-opener**, tiebroken by views.

⛔ **What the telemetry CANNOT say.** OI-06 asked which **third-party** tools the desk opens by hand
(thinkorswim, TradingView, Finviz, Market Chameleon, Unusual Whales, SpotGamma) and whether it runs
TradingView alerts. `page_views` records **our own app only** — the telemetry is **structurally
silent**, incapable rather than quiet. Per the owner's rule that falls to shipped behaviour: **no
external-tool affordance, no TradingView alerts assumed.** Reporting a surface ordering as if it
answered the tool question would be answering a different question in the same words.

### 1.f OI-03 — the full resolution

Both vendor consoles were attempted in the owner's Chrome profile on 2026-09-14 and **both
redirected to signup/login**: `massive.com/dashboard` → `/dashboard/signup?redirect=…`;
`site.financialmodelingprep.com/…/dashboard` → `/register`. **No credential was entered.** Result:
**UNKNOWN-VERIFIED** for both — attempted, blocked, and where, recorded.

Conservative default applied → **Massive tier = INDIVIDUAL** (no member display) · **FMP agreement =
ABSENT** · **the 57 of 118 register rows that move on these two facts = RESTRICTED** · **S9 is built
to ENFORCE that rather than assume it away.**

> **A conservative default that's wrong costs features; a permissive default that's wrong costs a
> licensing breach — always pick the first.** *(owner, 2026-09-14)*

⭐ Recorded as a **DEFAULT, not a finding** — to be re-read **as one unit** when either account can
be opened, because a per-row correction would leave the register in a state no single fact explains.
⛔ And even a signed-in FMP dashboard may not settle (b): a licensing agreement is a **contract**,
and its absence from a dashboard is not absence of a contract.

### 1.g The two §6 findings, in full

**F-S7-TICK-1.** `--ticking` reported `NO -- no heartbeat at all, and it IS inside the window` for
**three healthy sweeps** — `event-proximity`, `scan-membership`, `catalyst-match`. "Healthy" meant:
armed, flag reading `'1'` **in-process**, correctly registered, no `DARK sweep failed` line, and
simply **not yet scheduled to have fired**. Root cause: `hours is None` was read as *"the whole
weekday"*, so sweeps that fire at **fixed times** read as inside their window at any hour; their
last real firings were the previous **Friday**, ~55 h back and outside their 26 h bounds. ⛔ **It was
weekly, not a one-off:** `catalyst-match` fires 17:30, so **every Monday** both the 09:12 monitor
post and the 16:30 gate check would have alarmed on a healthy sweep. A rail that cries wolf weekly
gets muted, and then it is not a rail.

**The S2 CP2 rail.** The CP1 collision rail counted **inline `Shift+F` guards** and asserted **≥ 5**
as its non-vacuity control. After CP2 migrated one surface onto the declared table it read **4** and
went red. ⭐ **A rail that fails the moment the migration it protects actually lands is measuring the
wrong thing.** It now counts the **population** — inline **plus** table readers — and separately
asserts ≥ 1 surface is on the table. The composition can only move one way, because a table reader
**cannot be loose**: `forbids` is enforced in one place.

### 1.h §7 — the deleted paragraph, verbatim

The owner's autonomy instruction contained, in brackets:

> **b. S7 FLIP (member-facing) — [DELETE THIS PARAGRAPH TO KEEP FLIPS MANUAL]:** CP4 has run dark
> ≥ 5 further sessions, `legacy_only == 0` across them, `not_comparable` < 20% of predicates, no
> ALERT posts that week. Flip + legacy switch-off in one PR, per type, one type per week maximum.
> Auto-rollback rail: if the 48 hours after a flip show any legacy-path fire with no matching
> new-type fire for the same predicate, revert the flip PR and post ALERT. Filing watch parity
> 20/20 is a precondition, always.

**It was deleted**, and `WEEKLY_AUTONOMOUS_PROMPT.md` §3(b) now records why in its place. The
sentence cut from the briefing, in full:

> **Zero of its criteria had data.** The S7 dark reads hadn't started — **three of seven sweeps had
> never fired** — so `legacy_only == 0` across five further sessions and `not_comparable < 20%` were
> tests over a population that did not yet exist.

Second reason: **the rollback is not symmetric with the harm.** *"If the 48 hours after a flip show
a legacy fire with no matching new fire, revert"* means **up to two days of members not receiving an
alert they were entitled to**, and a missed alert is **not recoverable by a later revert**.

### 1.i The seven sweeps — all seven, with ET fire times

Read live in-pod, `python tools/weekly_exec.py pod ticking`, at ET 2026-09-14 14:49:

| sweep | cadence (ET) | state at 14:49 |
|---|---|---|
| `price-level` | every minute, weekdays 09:00–16:59 | **YES** — 342 ticks, projected 12, priced 10 |
| `event-proximity` | **07:05 and 18:05**, weekdays | **YES** — 1 tick, projected 6 |
| `position-risk` | every minute, weekdays 09:00–16:59 | **YES** — 1368 ticks |
| `scan-membership` | **~05:20 nightly, EVERY day** | **YES** — 1 tick |
| `catalyst-match` | **17:30**, weekdays | `n/a` — had not yet fired; next 17:30 |
| `regime-change` | every 20 min, weekdays 04:00–20:59 | **YES** — 384 ticks |
| `indicator-condition` | every minute, weekdays 09:00–16:59 | **YES** — 343 ticks |

⛔ **The seventh is not "not in production".** All seven are armed and in production. The one with a
caveat is **`indicator-condition`**: **F-S7-IC-1** measured 31 legacy addresses against 142 book
metrics with an **empty intersection** — one rename (`close` ↔ `ohlcv.c`) and thirty genuine
absences — so **its projected comparison N is 0, honestly**, and `not_comparable` is expected to be
essentially everything. Its heartbeat is the liveness signal; its outcome counts are not.
⚠️ The briefing's "six of seven" was a **point-in-time** reading at 14:49, not a defect.

### 1.j The final paragraph, in full

> **What would help from your end:** prompts that keep naming the *shape* of a defect rather than
> the instance — the owner's instructions have been unusually good at this (*"a conservative default
> that's wrong costs features; a permissive one costs a licensing breach"*), and it is what makes
> the rules survive contact with new situations. Also worth knowing: the owner is often on mobile,
> so anything requiring a keyboard should be flagged explicitly rather than assumed.

---

## 2. The signature registry — derived

`python tools/audit_scope_vs_checkpoints.py` is the authority. It is **DECLARED, not derived**, on
purpose: **F-AUDIT-2** retired three derived versions, each of which reported a property of the
**instrument** as a finding. The worst: a scope that names a checkpoint **in order to refuse it**
("CP3 NEEDS A NEW LINE") was scored as *authorising* it. *"Named" and "authorised" are different
facts, and no pattern over one sentence separates them.*

```
signed approval lines DECLARED : 36     (29 name ≥1 checkpoint · 7 UNNUMBERED)
distinct packets               : 21
gate packets on disk           : 22
signed blocks on disk (gates)  : 35     + 1 external in PRD-D2 §9.5 = 36 ✓ reconciles
unsigned blocks remaining      : 1      — s9-entitlements only
```

⚠️ **The audit reported DRIFT on all three signatures made today** and was right to: its contract is
that *a line signed tomorrow is UNDECLARED and must be READ rather than assumed*. Now declared,
commit `3b8c8f7fd`.

⚰️ **A near-miss worth carrying.** The cross-check written to verify that reconciliation used
`APPROVED AT SHA:\s*\S`, where `\s*` **crossed the newline** and matched the `S` of the next line's
`SCOPE APPROVED:` — counting **empty** blocks as signed and reporting `s9-entitlements` as an
undeclared signed line. **s9 is correctly unsigned; the tool was right and my instrument was wrong.**
Fixed with `[^\S\n]*`, after which the counts reconcile exactly. Same shape as the three retired
derived versions — a **live** defect class, not a historical one.

---

## 3. Production snapshot — all by command

```
master                     7707b2241                    git rev-parse --short=9 origin/master
web deploy                 SUCCESS, 1472 s settled      python tools/pre_push_guard.py --json
services                   6 (see §0.c)                 railway status --json
/data/auth.db              377,946,112 bytes            in-pod os.path.getsize
users                      29                           SELECT COUNT(*) FROM users
schema                     163 tables, 1,416 columns    sqlite_master + PRAGMA table_info
ET                         2026-09-14 17:51 EDT Mon     python tools/weekly_exec.py et
```

---

## 4. The queue

| item | state | note |
|---|---|---|
| **F-S2-1** | **READY** | the three loose `Shift+F` guards, baselined in `chordCollision.test.js::LOOSE_MODIFIER_BASELINE`. Member-visible, so it needs its own gate line |
| **S4 CP2** | **READY** | roster at §4 |
| **D3 CP2+ · D4 CP4+ · D5 CP2–CP7** | **READY** | rosters at §4 |
| **S6 CP2–CP5** | **BLOCKED → PROVISIONAL-able** | four owner rulings the spec says it cannot make; the owner delegated *"take your recommendation, record as PROVISIONAL"* |
| **S9 Entitlements** | ⭐ **NEWLY UNBLOCKED** | it was BLOCKED on OI-03, now resolved by conservative default. **It is the only packet with an unsigned approval block.** |
| **S5 CP1** | **BLOCKED** | F-S5-1's condition — second adopter + 30 days |
| S3 `/status`, bell panel | **READY** | browser work. Bell icon verified PRESENT; its panel **NOT** exercised — recorded PARTIAL, because "the button exists" and "the panel renders alerts" are two claims |
| COMPLETION_AUDIT recount | **READY** | |

---

## 5. OPEN QUESTIONS

1. **§4 is not a global registry** (F-GATE-2) — the rule's section number is wrong for 5 of 22 packets; its intent holds. Re-numbering would change what past signatures pointed at, so it was not done unilaterally.
2. **CLAUDE.md says FIVE Railway services; there are six.** It is on `master` and shared. Not edited unilaterally.
3. **"57 licensing rows" corrected to "57 of 118"** in the two places this programme wrote it. A third mention, `PHASE_2_INTEGRATION_SYNTHESIS.md:135`, is correct in its context and was left alone.
4. **Full-file pastes to terminal were not performed.** RESUME (731 lines), LEDGER (~3,700), the weekly prompt and the settings JSON are committed and readable at their paths; echoing them into the transcript would consume the session's capacity without adding a reader. Paths are given instead — say if you want any pasted verbatim.
5. **Phase 1 was not started.** Phase 0 surfaced three corrections that change what a packet would be built against; the session stopped at that boundary rather than building on a register whose row count it had just found wrong.

---

## Prelude 2026-09-14 evening

**P.1 — s9-entitlements: BLOCKED, and my prior "newly unblocked" was wrong.** The packet
names **three** blockers, not one: *"S9 waits on OI-03(a), OI-03(b) **and OI-12**."* OI-03(a)/(b)
are now resolved by conservative default (Individual tier, no FMP agreement). **OI-12 is
untouched** — it asks which commercial model is intended, where the code (`FREE_PAGES =
['/morning-wire']`) and the seed facts **disagree** about which page is free. I checked only
OI-03 last session and reported unblocked. ⚠️ OI-12 does carry a stated fallback (*"proceed on
the code: Morning Wire free, everything else paid"*), so applying it would unblock S9 — but
that is an owner call, and **S9 is explicitly out of scope this session. Not built.**

**P.2 — the gate-line wording guidance, on record:** *"For your next prompt: instead of 'name
the §4 checkpoint', write **'name the checkpoint ID from the packet's roster, wherever that
roster is numbered'**."*

**P.3 — the second [KEYBOARD] item, in full:** *"[KEYBOARD] decide whether the CLAUDE.md 'FIVE
services' correction is ours to make."* — now executed as Packet C CP2 under the owner's
default, built to signature-ready and not merged.

---

## Session result (evening)

**ET** — start `18:04 EDT Mon`, end `18:16 EDT Mon`, both `python tools/weekly_exec.py et`.

### Packet C — built, unsigned, fingerprint `c443515eb`

| | |
|---|---|
| **CP1** | `tools/audit_signature_regexes.py` — pins the approval-block parsers line-anchored. Docs branch `c31ce4f9e`. |
| **CP2** | `CLAUDE.md:10` FIVE → SIX, one-line diff. Code branch `669bde826`. Watch coverage `OK, changed=1`. |

⛔ **C.1's premise was false and is reported, not worked around.** There is no committed
instrument using `APPROVED AT SHA:\s*\S` — it was a throwaway snippet. Both real instruments
were **already** line-safe. CP1 therefore **pins** a property rather than fixing a defect.

⚰️ **And rail v1 was decoration.** Mutating `sign_gate._H` to `chr(92) + "s*"` did **not** fire
it, because `_H` is **assembled by concatenation** — so no string literal ever contains `\s`.
⭐ It is written that way *deliberately*, because the house rule says to build needles by
concatenation so a sweep cannot match itself. **The convention that protects one check
structurally blinded another.** v2 reads **compiled** patterns and fires. Restored by EDIT.

**Reconciliation unmoved:** 35 on disk + 1 external = 36 declared, no drift. That is what
makes CP1 a fix rather than a finding about the registry.

### Packet A — stopped at A.2, deliberately. Code branch `18dd13683`

```
files parsed 2570 | rows 150 | ABSENT-GUARDED-AND=30 · CLOSED-ON-ABSENT=71 · UNREADABLE=49
non-vacuity: the roster contains tools/s7_price_level_report.py:301, the F-S7-TICK-1 site ✅
```

⛔⛔ **Triage killed the rail.** All 30 were read by hand: **zero are defects.** The class is
the ordinary correct optional-guard idiom (`retry_after`, `deadline`, `age_days > _STALE_DAYS`,
`cap_after`). ⭐ **The syntactic shape does not distinguish the defect from the idiom** — what
made F-S7-TICK-1 a defect was that shape inside a predicate **whose caller reads "guard did not
fire" as "inside the window"**, which is a property of the *caller*. **A.3 and A.4 are not done
because there is nothing to fix and the rail would be harmful** — it would red 30 correct sites
and be muted, the exact fate F-S7-TICK-1 warns of.

### Packet B — not started

### ⚰️ The pattern of the day

**Three instruments reported a property of themselves as a finding about the repo**, two of
them mine today: the retired derived audits (F-AUDIT-2), the backslash-s block counter, and
the absent-bound classifier. **It is a live class, not a historical one.**

---

## Prelude 2026-09-15

> ⛔ **CLOCK DELTA, reported before anything derived from it.** The session prompt is
> headed **2026-09-15**; `python tools/weekly_exec.py et` — the ET authority, F-CLOCK-1 —
> read **2026-09-14 19:25 EDT Mon** at start and **19:59 EDT** at end. Every artifact this
> session is dated **2026-09-14** by measurement. The two headings below keep the prompt's
> names so they stay findable.

**P.1 — the SQL resolver, and what a pre-migration copy is not.**
`C:\Users\Patrick\uct-worktrees\terminal-research\tools\sql_resolves.py`, tested by
`C:\Users\Patrick\uct-worktrees\terminal-research\tests\test_sql_resolves_multi_database.py`.
The sentence, complete: **a snapshot taken before a migration is not evidence that a table
is still live** — a table dropped by a migration still resolves against the copy taken
before it, so a resolver that treats all files alike answers "fine" about a table nothing
reads any more; `BACKUP-ONLY` is therefore its own verdict and live files win attribution.

**P.2 — the three screens F-S2-1 changed.**
`app/src/components/TickerPopup.jsx` · `app/src/pages/ThemeTrackerPage.jsx` ·
`app/src/pages/Watchlists.jsx` (all in the code worktree,
`C:\Users\Patrick\uct-worktrees\s7-price-level`).

**P.3 — the ten databases the inventory did not hold.**
`alert_taxonomy.db` · `catalyst_news.db` · `company_news.db` · `d2_dual_samples.db` ·
`entity_master.db` · `fundamentals_monitor.db` · `pushed.db` · `theme_sets.db` ·
`brain/data/uct_intelligence.db` · `wisdom.db`. **All ten were added on 2026-09-14** by
derivation (Packet B CP3); the gap is now 1, not 10.

**P.4 — the `flow_worker_watch_coverage.repo_root()` near-miss.** Run from the **docs**
worktree (`terminal-research`) it printed **`changed=4`** — the answer for the **code**
worktree, because `repo_root()` defaults to `os.path.dirname(os.path.abspath(__file__))`,
the directory of its own file. The fix is to pass `start=` explicitly; pinned to the docs
worktree the same command printed **`changed=220`, reachable=78, verdict OK, none in
closure**. Caught before it produced a finding.

**P.5 — the ThemeTracker pre-existing red.**
`app/src/pages/ThemeTrackerPage.chartmount.test.jsx`, **2 failed / 1 passed**, on the code
branch `feat/s7-price-level`. ⚰️ **Attribution corrected 2026-09-14:** the introducing
commit is **`453ecc3ec`** (2026-09-05, *"feat(theme-sets): rebuilt editor — watchlist-style,
in-widget, optimistic"*, +253/−115 on the page), found with `git log -S"firstThemeTicker"`.
Yesterday's briefing named `0b7570df4`, which is merely the last commit to touch the file.

---

## Session result 2026-09-15

**ET:** start `2026-09-14 19:25 EDT Mon`, end `2026-09-14 19:59 EDT Mon`, both from
`python tools/weekly_exec.py et`. Both worktrees clean at start (0 changes each).

### What shipped, all UNSIGNED and unmerged

| unit | fingerprint | what it is |
|---|---|---|
| **B** (updated) | `66f535385` → **`a03e0cbf5`** | CP3 BUILT; two self-corrections (§3.4, §3.5) |
| **S4 CP2** | **`21d6ad3e8`** | the deep-link ratification + a derived gate |
| **D** | **`e279c828c`** | CLAUDE.md's Nav Tabs section, generated by AST |
| C · F-S2-1 | `c443515eb` · `28da7740d` | unchanged from 2026-09-14 |

⛔ **`a03e0cbf5` is a NEW BLOCK, not a re-sign.** Packet B's approval block is still empty
and byte-untouched; only content below it changed.

### ⛔⛔ The session's own finding: `/data` is per service

The standing figure *"73 `.db` files, 63 live"* describes **web's volume**, one of six
services. Measured: **web 73 · flow-worker 16** (`flow.db` **9.18 GB**, `oi_massive.db`
842 MB) **· bars-api 3** (`bars.db` **24.6 GB**) **· worker, chart-renderer,
terminal-next-monitor UNREADABLE** (two serverless and asleep, one without
`/opt/venv/bin/python`; none were woken).

⭐ **The two largest data assets in the product sit on volumes no earlier measurement had
looked at**, and `oi_massive.db` — reported yesterday as *"in the inventory, not on the
pod"* — is live on flow-worker. **F-B-1 recurring inside the packet that filed F-B-1.**

### Retraction hygiene

**13 sites** across **11,884 files** in **11/11 targets** (11 BY-ID, 2 BY-CLAIM), positive
control HIT, the auditor's own file skipped by identity and named. **Zero** sites in the
LEDGER, RESUME, this briefing, either `CLAUDE.md`, or any S6 decision document — the false
claim never propagated past the document that filed it and the packet that retracted it.
Two documents gained `RETRACTED → F-B-1`.

### New findings

- **F-S4-1** — `NotebookTab.jsx:136,570` reads `?ticker=` where the deep-link authority
  spells it `sym`. Three spellings of one fact, in a live member surface.
- **F-NAV-1** — nine reachable member-facing routes with no nav entry, including
  `/post-market`, which the old CLAUDE.md section listed as a nav entry.

### Instruments built, and what each cost

`tools/audit_retraction_sites.py` · `tools/sql_resolves.py` (extended) ·
`tools/nav_manifest.mjs` · `app/src/lib/context/symbolLinkChannels.test.js`. All passed
clean/dirty/empty before touching the repo. ⚰️ **Two reported a property of themselves and
were fixed in the instrument:** the retraction auditor matched its own `--id` default, and
it took directory arguments only — so a run told to search the briefing and both
`CLAUDE.md` files searched none of them while printing *"7 of 7"*.

---

## Prelude 2026-09-16

> ⛔ **CLOCK DELTA.** Prompt headed 2026-09-16; `python tools/weekly_exec.py et` read
> **2026-09-14 22:37 EDT** at start. Artifacts are dated **2026-09-15** by the UTC date
> that clock reports; the heading keeps the prompt's name.
>
> ⛔ **TOLD-vs-FOUND ON P.1'S OWN SOURCE.** P.1 says to re-print sections 1–6 *from the
> briefing file*. The briefing holds **0 of 6** numbered sections — the 09-15 entry is a
> differently-shaped narrative. They are re-derived from the repo below rather than quoted
> from a source that does not hold them.

**P.1 — sections 1–6 of the 2026-09-15 report, re-derived**

1. **ET / trees** — start `2026-09-14 19:25 EDT`, end `19:59 EDT`, both via
   `weekly_exec.py et`; both worktrees 0 dirty at start and end.
2. **Prelude P.1–P.5** — the resolver's paths + the BACKUP sentence; the three F-S2-1
   screens; the ten missing databases; the `repo_root()` `changed=4` near-miss; the
   ThemeTracker red (`453ecc3ec`).
3. **R** — **13 sites found, 13 annotated** (11 BY-ID, 2 BY-CLAIM) over 11,884 files /
   11 targets; zero in LEDGER, RESUME, briefing, either CLAUDE.md or any S6 doc.
   `page_views`→`auth.db` · `calendar_seen`→`auth.db` ·
   `calendar_alerts_fired`→`calendar_alerts.db` · `ai_search_log`→`ai_search_log.db`.
4. **D.1** — ten rows: opener non-ZERO **10/10**, env var derived **10/10**, live
   **10/10**; **all ten added**; inventory 55→64, gap **10→1**; B `66f535385` →
   `a03e0cbf5` (new block, not a re-sign).
5. **S4 CP2** — assertion *"docs + rail only"*; told-vs-found delta **0** on all four
   named things; 8 named tests; mutation **A** new hand-typed read RED, **B** stale
   baseline RED, restored **8 passed**; overlap **none**; fingerprint `21d6ad3e8`.
6. **Packet D** — **16** NAV_ITEMS, 88 routes, `navWithoutRoute = 0`, 56 raw → 9 unlisted
   (now **7**, see below); `git diff --stat` = CLAUDE.md alone, 2 hunks, both in-section;
   fingerprint `e279c828c`.

**P.2 — the six services, measured 2026-09-15 (shell-only `railway ssh … ls -la /data`)**

| service | volume | state | `.db` at top level |
|---|---|---|---|
| web | `/data` | READ | **65** (73 recursive, 63 live) |
| worker | `/data` | **READ** | **7** — `bars.db` 26.8 GB live |
| flow-worker | `/data` | READ | **13** — `flow.db` 9.18 GB live |
| bars-api | `/data` | READ | **3** — `bars.db` 24.7 GB live |
| chart-renderer | — | **NO `/data`** | 0 — an answer, not a gap |
| terminal-next-monitor | `/data`? | **UNREADABLE** | serverless, asleep |

⚰️ Two of yesterday's three UNREADABLEs were artifacts of my own Python payload, not
properties of the services.

---

## Session result 2026-09-16

**ET:** start `2026-09-14 22:37 EDT`, end below. Both trees clean at start (0 / 0).

### Units now signature-ready — NINE

| unit | fingerprint | member-visible? |
|---|---|---|
| C | `c443515eb` | no |
| D *(corrected)* | `e279c828c` | no |
| B incl. CP3 | `a03e0cbf5` | no |
| S4 CP2 | `21d6ad3e8` | no |
| F-S2-1 | `28da7740d` | **YES** |
| **V** | **`f94d7addc`** | no |
| **E** | **`c90ad04d2`** | no |
| **T + D3 CP2** | **`24d523205`** | no |

### The measurements that changed the picture

- **`/data` is six volumes.** 99 databases across four readable services (86 live), one
  with **no volume**, one asleep. **120 of 464 live table names exist on more than one
  volume**; `bars.db` is live on two services 2.1 GB apart.
- **CI runs 28 of 2,782 test files.** 2,754 — **99.0%** — run on no automated path.
- **F-NAV-1 falls 9 → 7**, and all seven have inbound links (1–5 refs): none is
  unreachable, the sidebar just isn't its door. Four have **zero** member page-views.
- **`d2_dual_samples.db` is armed at 100% sampling and has recorded 0 rows in two days.**

### Three corrections to this programme's own recent work

1. `/live-flow` is `<Navigate to="/live-massive">` — a **redirect**, not a rival page. The
   09-15 report's *"two routes, one label, misleading sidebar entry"* was wrong.
2. `chart-renderer` has **no `/data`**; yesterday's UNREADABLE was my probe's Python
   dependency.
3. `oi_massive.db` is live on flow-worker; Packet B had it as missing.
