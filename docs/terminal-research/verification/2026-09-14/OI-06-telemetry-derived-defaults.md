# OI-06 — answered by MEASUREMENT, 2026-09-14

> **Read against production `/data/auth.db`, 377,577,472 bytes, 29 users** — `railway ssh`,
> `mode=ro`, in-pod. ⛔ **Stated because the PRD demands it:** the dev box carries a
> `C:\data\auth.db` with ~20,640 users. **Two databases, identical filename, an 800× difference.**
> This is the 29-user one.

**Roster:** 6 admin · 23 member. 13 users have any `page_views` row at all.

---

## 1 · P6 / re-ranking — **SURVIVES.** Median member touches **11** distinct surfaces

```
distinct-pages per user: min=1  median=11  max=56
distribution: {1:1, 2:1, 3:1, 6:1, 10:1, 11:2, 14:1, 19:1, 20:1, 28:1, 32:1, 56:1}
```

The PRD's own test: *"If the median member touches ≤3 distinct pages, a re-ranked widget picker is
re-ranking nothing and P6 is **dropped**, not deferred."* **Median is 11.** P6 is not re-ranking
nothing, and the spread is wide with a heavy tail — four users under 7, six between 10 and 20,
three at 28/32/56. ⚠️ **n = 13. That is a listing, not a statistic** — read as an existence check.

## 2 · Surface order — measured, not narrated

| by total views | by FIRST surface of a session-day (admins, 50 day-sessions) |
|---|---|
| `/journal/notebook` 1097 · `/charts` 1010 · `/dashboard` 809 · `/breadth` 353 · `/options-flow` 278 · `/calendar` 161 · `/journal` 138 · `/journal/calendar` 105 · `/screener` 97 · `/community` 84 · `/live-massive` 74 · `/settings` 74 | `/dashboard` **22** · `/live-massive` 9 · `/options-flow` 5 · `/charts` 4 · `/journal/notebook` 4 · `/calendar` 2 · `/journal` 2 · `/morning-wire` 1 · `/breadth` 1 |

⭐ **The two orderings disagree, and the disagreement is the finding.** `/journal/notebook` leads on
total views and is *fifth* on session-openers; `/dashboard` is third on views and **first by a
factor of two** on openers. **A manifest ordered by total views would put the notebook first and be
wrong about the morning.** The desk OPENS on the dashboard and LIVES in the notebook and charts.

## 3 · `calendar_seen` — **16 rows total.** Unseen-state stays Calendar-local

Per the PRD's test, rows-per-user near zero ⇒ S6 does **not** generalise it into P3's resolver.

## 4 · DEC-01 — **members DO customize.** 17 stored layouts, **7 distinct widget signatures**

```
blob bytes: min=111  median=476  max=6731
n=8  ('aisearch','chart','fundamentals','themes','watchlist')
n=4  ('chart','themes','watchlist')
n=1  ('chart','themes')       n=1 ('chart',)
n=1  ('chart','scanner','themes','watchlist')
n=1  ('chart','nhnl','nhnlPulse','themes')
```

The standing question was *do members customize at all?* **Nine of seventeen diverge from the
largest cluster**, and blob size spans 111→6731 bytes. ⛔ **P5 and P6 are NOT answering a need
nobody has** — the premise under them holds. ⚠️ Again n = 17.

## 5 · ⚰⚰ RETRACTED 2026-09-14 — **F-OI21-1 WAS WRONG. BOTH TABLES EXIST.**

> ⚠️ **RETRACTED → F-B-1.** The retracting finding is **F-B-1** (`12-decisions/gates/packet-b-schema-resolution-gate.md` §2): *a question that names its own scope will be obeyed to the letter, including into an error*. Every quotation of the original claim below is struck and kept, never deleted.

> **The original claim, struck:** ~~"Two of the four OI-21 queries cannot be run — the tables
> do not exist. `calendar_alerts_fired` ABSENT; `ai_search_log` ABSENT, and there is no
> ai/search table of any name."~~

**Measured across every database under `/data`, not one:**

| table | where it actually lives | rows |
|---|---|---|
| `ai_search_log` | **`ai_search_log.db`** | **79** |
| `calendar_alerts_fired` | **`calendar_alerts.db`** | **956** |
| `page_views` | `auth.db` | 4,949 |
| `calendar_seen` | `auth.db` | 16 |
| `charts_workspace_layout` | *(correctly not a table — it is a `pref_key` value inside `user_preferences`, 186 rows)* | — |

### ⛔ THE CAUSE: I RESOLVED AGAINST ONE DATABASE. THERE ARE **65**.

```
SQLITE DATABASES UNDER /data: 65
   ai_search_log.db · calendar_alerts.db · auth.db · bars.db · cot.db · flow.db · …
```

The original check ran `SELECT name FROM sqlite_master` against **`auth.db` only**, then
reported absence from that one file as absence from the product. ⭐ **The instrument
reported its own scope as a property of the repo** — the fourth time in one day, and the
most consequential, because this one was *filed as a finding* and asserted that two S6
decisions were sized on unrunnable queries.

### ⭐ What the near-miss would have cost

The follow-up task was to **annotate two S6 decisions as "UNSIZED until re-measured."** That
annotation would have been **false**, and it would have sat in the S6 documents marking sound
work as unsound. **A wrong finding is worse than no finding**, because it is acted upon.

### What is actually true

**All four OI-21 queries are runnable.** The S6 decisions they size — the S6/S7 alert
boundary (§5.2) and *"is personal grounding worth extending"* — are **not** unsized. They
have real populations behind them: 956 alert rows and 79 AI-search rows.

⚠️ Those populations are **small**, which is a separate and honest caveat: 79 AI-search
rows over a 29-member roster is an existence check, not a rate — the same limit that applies
to every number in this document.

## 6 · The OI-06 answer, derived

⛔⛔ **FIRST, WHAT THIS TELEMETRY CANNOT SAY.** OI-06 asked which of **thinkorswim, TradingView,
Finviz, Market Chameleon, Unusual Whales, SpotGamma** the desk opens **by hand**, and whether it
runs TradingView alerts. Those are **third-party sites**. `page_views` records **our own app only**,
so the telemetry is **structurally silent** on the literal question — not quiet, *incapable*.
Reporting a surface ordering as if it answered the tool question would be answering a different
question in the same words.

Per the owner's rule — *"where telemetry is silent, take the shipped palette's current behaviour as
the answer"*:

| OI-06 sub-question | answer | basis |
|---|---|---|
| external tools opened by hand | **assume NONE; build no external-tool affordance** | telemetry structurally silent → shipped behaviour, which has none |
| TradingView alerts in use | **assume NO** | same; and the conservative direction, since assuming YES would build an integration on nothing |
| **S1 surface manifest — order** | `/dashboard` first, then `/charts`, `/journal/notebook`, `/options-flow`, `/breadth`, `/live-massive`, `/calendar`, `/screener` | **session-opener order first, total-view order as the tiebreak** — §2 |
| **S1 manifest — membership** | the 12 surfaces with real traffic; nothing with zero | §2 |
| **S2 command grammar — targets** | the same 12, keyed on the manifest so the two cannot drift | §2 |
| **S2 — default command** | *open the dashboard* | 22/50 session-days, twice the next |

⚠️ **PROVISIONAL on n.** Every row above rests on 13 active users and 50 admin session-days. It is
an **existence check that beat its own stated threshold**, not a rate. Re-read when the roster
passes ~100 — and the threshold that mattered (median > 3) was cleared by 11, so the direction is
safe even if the magnitudes move.
