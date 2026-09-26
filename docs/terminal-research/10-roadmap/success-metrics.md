---
id: A-02
title: Success metrics — what good looks like, stated so that a healthy system can pass and a broken one cannot, with computability separated from threshold
role: >
  The success-metrics deliverable. MASTER_CHECKLIST item 35, gate item 21
  (`10-roadmap/success-metrics.md`, owners A-02, H-06). It is not a dashboard and not a
  glossary: it proposes twenty-one metrics, each with a stated instrument, and it says of each
  one whether that instrument exists today. ⭐ It also discharges one line of R-18's
  mitigation, which names A-02 as an owner (`00-program-control/RISK_REGISTER.md:24`).
wave: 4
group: ROADMAP
category: strategy
inputs: >
  `10-roadmap/observability-plan.md` (gate item 25, draft) — §0 findings 2 and 3, §3 G-2,
  G-3, G-4, G-5, §4.1, §4.2 tiering, §4.3 signal table S1–S10, §4.4 severity, §4.5 grace
  windows, §4.6 four proof methods, §4.7 `as_of`, §4.8 dead-man, §4.9 OBS-1…OBS-9 ·
  `07-technical-architecture/realtime-performance-architecture.md` (gate item 24, draft)
  §2.1, §2.2, §2.3, §2.4, §2.5, §2.6, §3 Q1–Q5, §4 D5/D7/D10, §5, §6 ·
  `05-product-strategy/feature-opportunity-backlog.md` (gate item 16, draft, 2026-09-26) —
  the 85 `Known it worked.` fields, §1 H3, §2.1, §2.2, §2.5, §2.6, GAPS 8 and 9, and the
  frontmatter FOURTH CEILING · `10-roadmap/testing-plan.md` (gate item 36, draft) §3
  C-1…C-12, §4.1–§4.4, §6 TEST-1…TEST-13 · `05-product-strategy/product-architecture.md`
  (accepted 2026-09-02) §1.1–§1.3, §2.1, §3.1, §9, §11, §12, GAPS ·
  `05-product-strategy/capability-infrastructure-matrix.md` (accepted 2026-09-02) ·
  `05-product-strategy/anti-patterns.md` (gate item 11, draft) GATE-1, GATE-6, GATE-7,
  INST-4 · `06-ux-and-information-architecture/fixed-modular-hybrid.md` (C5-03, 2026-09-25)
  §3 · `10-roadmap/rollout-rollback.md` (gate item 37, draft) RB-1 ·
  `09-security-licensing-cost/cost-model-ai-infra.md` (E-06, accepted 2026-09-02) ·
  `00-program-control/{CRITICAL_PATH,MASTER_CHECKLIST,RISK_REGISTER,OWNER_INPUTS_REQUESTED,GOVERNING_PRINCIPLES}.md`
  and `charter/OWNER_SEED_FACTS.md` · `12-decisions/DECISION_CARDS_2026-09-26.md` CARDS 15,
  16, 17, 18, 20, 21 and `DECISION_CARDS_2026-09-25.md` CARD 1 ·
  `C:\Users\Patrick\uct-worktrees\_merge-master\CLAUDE.md` and, read read-only in that
  worktree, `tools/bars_warmth_audit.py` and `api/services/compass_eval/`.
scope: >
  Source read READ-ONLY in the sibling worktree
  `C:\Users\Patrick\uct-worktrees\_merge-master`; nothing written there. ⛔ NO git command
  of any kind was run (another session owns the commit), so **SHA not pinned (no git by
  instruction)** wherever a SHA would normally appear. ⛔ NO network request, NO `curl`, NO
  `railway` command, NO production read of any kind, NO test, NO script against the repo.
  Two files were opened in `_merge-master` (`tools/bars_warmth_audit.py`, and a directory
  listing plus grep of `api/services/compass_eval/`) to confirm two instruments exist and
  what one of them computes; both are reads, not runs. The only counting done was over
  **this document's own output**, and the command is recorded in §4.0.
  `05-product-strategy/feature-scoring.md` and `10-roadmap/dependency-graph.md` are being
  written concurrently by other agents and were not touched. One file written: this one.
confidence: >
  🟢 high on every metric's **computability verdict**: each is either a file I opened, a
  sibling document's file:line finding, or an explicit "no instrument exists" that names the
  sibling owning the gap. 🟢 high on the case law — five instances, each with its artifact.
  🟢 high on the business ceiling: the price in the code, the two incompatible ARPU anchors
  and the unanswered ceiling are all quoted from dated artifacts.
  🟡 on every **baseline** carried here: not one was re-measured, all are quoted from the
  artifact that took them, and each carries its date, its n and its validity context.
  🔴 on every **target** labelled FORECAST — by construction; that label is the point.
evidence_ceiling: >
  ⛔⛔ NOT ONE MEASUREMENT IN THIS DOCUMENT IS MINE. No production read, no script, no test,
  by instruction — so every number is a quotation with a date, and where an artifact says
  `n = 1` this document says `n = 1` rather than rounding it into a baseline. ⛔ I do not
  know the live value of any counter, flag or cap; the caps below are what the artifacts
  declare, never what the pod holds. ⛔ No instrument was RUN, so no metric here has been
  proved able to fire; §2.4 states the proof obligation and §4.6 of gate item 25 states the
  four methods, and discharging them is engineering work this document does not claim to
  have done. ⛔ The nine `Known it worked.` observables I cite from gate item 16 are that
  document's measurements of its own file, not mine.
status: draft
---

# Success metrics (A-02)

## 0. Headline

**Three conclusions. The first one is about the shape of a metric, not about which metrics to pick — because picking metrics was never the hard part here.**

1. ⭐⭐ **Every metric must state its computability separately from its threshold, and this programme has twice shipped one that did not — both times arguing about the number while the instrument was the broken part.** CARD 16 retired a ≥ 99 % warm-ratio bar that a healthy system failed, and replaced it with `p95 ≤ 250 ms`; gate item 25 then found that the replacement **cannot be evaluated on the timeframe that motivated it**, because `tools/bars_warmth_audit.py:27-28` still classes `stale-swr` as COLD, so daily's `warm_ms` is empty, the `if warm_ms:` guard at `:109` never fires, and **no p95 line prints for daily at all** — the figure recorded as a pass was the COLD line's p50-and-**max** at `:113-116`. I opened that file: 121 lines, both facts confirmed at source. ⛔ So the threshold `250 ms` is ratified and the statistic behind it **has never once been computed**. A metric set that does not force those two facts into different fields will make the same mistake a third time. §2 makes them fields 1–4 of a contract, and §4 answers them for all twenty-one metrics: **9 computable today, 2 partial, 9 not, 1 owned elsewhere.** ⭐ This is the anti-pattern library's **INST-4** with this document's name on it — *"a definition of done that a healthy system fails"* (`anti-patterns.md:505-510`, which quotes item 24 §2.1 back at itself) — and its sibling failure, a definition of done nothing can evaluate, which item 36 §5 item 6 names as *"the programme's own gate."*

2. ⭐⭐ **There is no readable business metric available to this programme, and the reason is arithmetic rather than diligence — so the set is deliberately weighted to member-visible quality and to instrument honesty.** Production held **26 users** (measured 2026-09-12, `railway ssh` → `SELECT COUNT(*) FROM users` on `/data/auth.db`; 21 subscriptions; `_merge-master/CLAUDE.md:2559-2561`), the site is in `COMING_SOON_MODE` so account creation is closed and the roster is admins and testers, and the only richer cohort read — 17 of 29 accounts holding a board — is explicitly *"admins, staff and testers, several of whom built this board"* (C5-03 §3, 2026-09-25, `fixed-modular-hybrid.md:139-141`). **At n = 26 one account moves any rate by 3.85 percentage points**, which is wider than the effect most engagement metrics exist to detect; OBS-1 rejected n = 40 for a latency percentile on a 2.5-point resolution argument, and 3.85 is worse. ⛔⛔ And the denominator itself is **three numbers**: `users` 26 (quoted, 2026-09-12), `users` 29 (measured in-pod by this programme, 2026-09-14), 21 members holding any preference row (2026-09-21) — so **there is no stable denominator to divide by even if the numerator were interesting.** ⛔ And the real bound on any usage metric is smaller still: **13 accounts have any `page_views` row at all**, six of the production roster being admins, and the one ordering derived from it is labelled *admins only*. A conversion funnel over that is theatre. §3.1 has the full table; §5 defers every population-bound metric with the population it needs stated.

3. ⭐ **The metric this programme should above all not adopt is any in-memory consecutive-failure streak — and the specific trap is that the obvious fix rebuilds the defect.** `desk_session_insights._FAIL_STREAKS` alerts on the fourth consecutive failure, which needs an uninterrupted hour of fifteen-minute passes against a **26-minute median pod life**, so *"the streak resets before it can fire. A proxy that resets on redeploy reports healthy straight through a total failure"* (`_merge-master/CLAUDE.md:5477-5482`) — and the same file says, in the same breath, *"Do not 'improve' this by persisting the streak counter instead — that rebuilds the proxy."* §6 lists twelve more, including the conventional ones. ⭐ **And the metric this document recommends adopting that nobody has proposed is EQ-1, gate-evaluability**: the count of live definitions-of-done whose instrument is named and working. It is the only metric in this set whose failure has already cost the programme twice, and it is the cheapest one here to compute.

**A fourth thing, which is a finding rather than a conclusion, because it changed what I proposed.** Gate item 16 wrote 85 draft observables — one per backlog item, in a field labelled `Known it worked.` — and **almost none of them is a rate.** That document grepped its own 85 fields for `rate|percent|%|engagement|retention|conversion|revenue|churn` and found **zero** proposing an error rate, adoption rate, conversion, retention or revenue figure; two items explicitly *forbid* a percentage in favour of names (`FB-A7-01`, `FB-D5-02`), and its frontmatter FOURTH CEILING says the populations that do exist *"are existence-checks, not rates"*. Roughly two-thirds of the fields name a rail, an AST census or a fixture **with a control** instead. ⭐ That is not a limitation someone should fix. It is the correct instinct for a product with 26 accounts, and this document follows it: most bars below are existence, refusal or non-regression shaped, and the rate-shaped ones are the four that have a real distribution behind them.

---

## 1. ⛔ The case law, stated as the rules it generates

**Five instances. Four were handed to me; the fifth I found in CARD 1 while checking CARD 21's antecedent.** Each is a metric that a correct system could not pass, or that nothing could evaluate. They are one disease at several altitudes, and the rules are the spine of everything below.

### 1.1 CARD 16 — a bar a healthy system fails is a bar that gets waived

**The instance.** Protocol A, valid run, pod uptime 942 s, 2026-09-26: daily read **0/40 = 0 % warm and p50 104 ms at the same time**, because §8 bucketed `stale-swr` with `fetch` and `miss` under *"the user waited"*. Daily has been 100 % `stale-swr` since 2026-08-19 — the documented steady state, not a regression (item 24 §2.1). CARD 16 ruled `stale-swr` counts as SERVED and retired the tier gate: *"a member served from cache in 104 ms did not wait, and a metric that calls that a total failure will be ignored within a week — which is worse than having no metric"* (`DECISION_CARDS_2026-09-26.md:209-212`).

> ⛔ **RULE 1 — THE NORMAL-CASE TEST.** Before a bar is adopted, name the healthiest plausible state of the system and check the bar passes it. A bar that the normal case fails is not strict; it is **about to be waived, after which nothing is gated at all**. This is field 3 of §2's contract, and it is the field most likely to be skipped because it feels like a formality.

⚠️ And CARD 16's own carve-out is the reason Rule 1 is not "loosen everything": it kept one tier-based alarm, because *"any `fetch`/`miss` share above ~10 % on intraday during **RTH** is still a real regression … and `stale-swr` is not exonerated there — a stale intraday bar during the session is a different product than a stale daily bar after the close"* (`:217-220`). **The right response to a bar that fires on the normal case is to re-cut its population, not to delete it.**

### 1.2 Gate item 25 G-2 — and its replacement cannot be computed either

**The instance.** Stated in §0(1) above with the source lines. The generalisation is gate item 25's, and it is sharper than the incident: the ruling changed the definition and **the instrument was not changed with it**. Three separate divergences in one 121-line tool — the bucketing constant (`:27-28`), the statistic (a `max`, not a p95, at `:113-116`), and the quantity (client wall-clock at `:56-59`, while the server's own `dur` from `Server-Timing` is parsed and discarded at `:62-64`). ⚠️ Gate item 25's verdict on the third: *"Neither is wrong — client wall-clock is the right quantity for a member budget and `dur` for a server budget. What is wrong is that the gate does not name one."*

> ⛔⛔ **RULE 2 — COMPUTABILITY IS A SEPARATE FIELD FROM THRESHOLD, AND IT NAMES A FILE.** A bar states (a) the quantity, (b) the statistic, (c) the N, and (d) the artifact that computes it, by path. If (d) does not exist or disagrees with (a)–(c), the bar's status is **NOT EVALUABLE** — never "pass", never "fail", and never silently inherited from a neighbouring line of output.
>
> ⛔ **RULE 2b — A RULING THAT CHANGES A DEFINITION MUST NAME ITS INSTRUMENT IN THE SAME BREATH.** CARD 16 re-cut a definition and left a tool measuring the old one. This is the anti-pattern library's GATE-6 exactly — *"a rule stated in a document that no check enforces"* — and its recorded cost was 25 days of a false assertion about `DESK_PUBLIC_SHOWS` and 27 videos set unlisted and restored (`anti-patterns.md:853-874`).

### 1.3 CARD 21 — a bar that treats the product's best behaviour as its blocking defect

**The instance.** CARD 1's flip clause required `legacy_only == 0` across the S7 population. The reads established what that counter holds: **one predicate holds all 2,344 of it**, one span, five consecutive sessions ending 2026-09-18, **none** of the five trading sessions since, and `agreed` over those sessions is **0** — *"a stale alert sitting on the wrong side of its own level, re-firing forever … ≈469 times a session, a tick cadence and not a delivery rate"*. So `legacy_only` counted alerts a member **would have been spammed with**, which the new rule correctly declines to send. *"`legacy_only == 0` is not a safety bar. It is a bar that a correct fix makes impossible to pass"* (`DECISION_CARDS_2026-09-26.md:392-408`).

> ⛔ **RULE 3 — CHECK THE DIRECTION THE FIX MOVES THE COUNTER.** For every bar, state which way a *correct* change moves the quantity. If a correct fix moves it the wrong side of the bar, the bar is measuring the wrong thing. ⭐ **And the repair shape is CARD 21's, not a looser number:** it split one question into two, kept the genuinely safety-critical direction unrestricted (`new_only == 0` — an extra alert is what harms a member), scoped the other to the population still accumulating evidence, and required every exclusion to be **named and dispositioned** as *confirmed inactive*, *confirmed correct suppression* or *unexplained* — with *unexplained* blocking. *"The new clause asks two, and the second is strictly harder to satisfy dishonestly, because an exclusion must be named and dispositioned rather than merely being a zero."*

### 1.4 The grace window — the same disease at three altitudes

**The instance, in triplicate.** `desk_session_audit`'s 3-hour grace (`DESK_SESSION_AUDIT_GRACE_SECS`, default 10800): insights land 2 min–3 h after publish, so a session younger than the grace is not checked at all, because *"without that, this alert fires on every healthy session and is muted within a week"* (`_merge-master/CLAUDE.md:5484-5487`). `terminal_next_monitor_main.py:161-165`: *"A CLOSED MARKET IS NOT A FAULT, and alerting on it every weekend is how a monitor gets muted."* And CARD 16 itself. Gate item 25 §4.5 puts the three together: *"one finding at three altitudes: an alert, a monitor, and a gate. The rule is that a signal which fires on the normal case is not a noisy signal — it is a signal that will shortly be no signal."*

> ⛔ **RULE 4 — A BAR CARRIES A STATED GRACE OR CONFIRM COUNT, JUSTIFIED BY THE LATENCY OF THE THING IT WATCHES.** Not chosen for comfort, and not omitted. ⛔ And gate item 25's channel corollary binds here too: a grace window on each bar, delivered into a channel that also carries signups, buys nothing — `grep -rl "DISCORD_WEBHOOK_URL" api/ --include=*.py` returns **30** modules and the same webhook carries `notify_signup` (G-5). **The mute happens at the channel.** OBS-8 owns the fix; this document only refuses to pretend a grace window substitutes for it.
>
> ⭐ **RULE 4b — THE ONE DELIBERATE EXCEPTION, AND IT IS NOT A LOOPHOLE.** A cadence proof — a dead-man roll-up — posts **even when everything is fine**, because that is the only construct under which silence is unambiguous (gate item 25 §4.8, quoting `docs/runbooks/rth-scheduling.md`: *"the preflight alerts on GO as well as NO-GO: silence should never need interpreting"*). ⚠️ Exactly one such message per period, or the cadence proof becomes the thing that mutes the channel.

### 1.5 The per-process proxy — and a fifth instance nobody handed me

**The instance handed to me.** `_FAIL_STREAKS`, stated in §0(3). Generalised by gate item 25 §4.2 into the tiering rule that decides where a metric's state lives: **per-process state is fatal for a CUMULATIVE quantity (a leak slope, a drop total, a max-over-days) and perfectly adequate for a DISTRIBUTIONAL one measured inside one pod's life (a latency p95).** The deciding question is one sentence: *does the quantity accumulate across process lifetimes?* Median pod life **26 minutes**; fourteen deploys in six and a half hours (item 24 §2.5). ⭐ And the frequency is not incidental: item 24 §4 D9 re-scored frequent recycling as **partly load-bearing against the leak**, so the answer is never "deploy less so the counters survive" — it is *"put the counters where a deploy cannot reach them."*

> ⛔ **RULE 5 — CLASSIFY EVERY QUANTITY AS CUMULATIVE OR DISTRIBUTIONAL BEFORE CHOOSING WHERE IT LIVES.** Cumulative ⇒ out-of-process (T2) and it must report `deployments_sampled`. Distributional ⇒ in-process is fine, with a stated minimum pod age. ⛔ A cumulative quantity held in module memory is not a weak metric; it is a metric that **reports healthy through a total failure.** Tiers T0/T1/T2 are gate item 25 §4.2's and are not restated here.

**⭐⭐ The fifth instance, and it is the one that most directly threatens this document: an acceptance number that was a forecast, and the base rate falsified it.** CARD 1 (2026-09-25) records that the LEDGER's CP4 bar — `legacy_only == 0 and agreed ≥ 20 over ≥ 5 sessions` — *"was a forecast, and the measured base rate falsifies it: 1 agreed event across 12 ready predicates over 10 sessions ≈ 0.008 events per predicate-session, so 20 events needs on the order of **200+ sessions** on these fixtures — a measurement that cannot complete (the 'longer than the gap between disturbances' class)"* (`DECISION_CARDS_2026-09-25.md:40-45`). The bar was re-cut to `agreed ≥ 5` across `≥ 3 distinct predicates` on levels set by real members, and the human step that makes it reachable was then taken.

> ⛔⛔ **RULE 6 — AN ACCEPTANCE NUMBER IS A FORECAST UNTIL DERIVED, AND THE THING THAT DERIVES IT IS A BASE RATE.** Before a threshold is adopted, compute how long it takes to reach at the observed rate, and compare that against the interval between disturbances (item 36 §4.4 states the general form: *"if the run is longer than the gap, it will never finish"*). ⭐ **Every target in §4 is labelled DERIVED or FORECAST on exactly this test**, and a FORECAST label is not an apology — it is the instruction to re-cut the number when the base rate arrives, instead of waiving it.

---

## 2. The metric shape — the four fields, as a contract

⛔ **A proposed metric that does not answer all four is not adopted. It is a topic.** The phrasing is gate item 16's, and I am adopting it verbatim because it is exactly right: *"An item whose success cannot be defined is not yet a candidate; it is a topic"* (`feature-opportunity-backlog.md`, GAPS 8).

| # | field | what it must say | the failure it prevents |
|---|---|---|---|
| **1** | **QUANTITY** | The thing measured, with its statistic and its N. Not "latency" — "client wall-clock p95 over n ≥ 60 per timeframe". | G-2's third divergence: a gate that does not name which of two legitimate quantities it means. |
| **2** | **COMPUTABLE TODAY, BY WHAT** | **A path.** A tool, a route, a query, a documented protocol. If none exists: `NOT COMPUTABLE`, naming the sibling document that owns the gap. ⛔ Never a plan. | §0(1). And GATE-6: a rule stated in a document that no check enforces. |
| **3** | **DOES IT FIRE ON THE NORMAL CASE?** | The healthiest plausible state, and whether the bar passes it. Plus which way a **correct fix** moves the quantity (Rule 3). Plus the grace or confirm count (Rule 4). | CARD 16, CARD 21, the grace window — §1.1, §1.3, §1.4. |
| **4** | **DOES IT SURVIVE A REDEPLOY?** | CUMULATIVE or DISTRIBUTIONAL, and therefore which tier. A cumulative quantity also states `deployments_sampled`. | §1.5. Median pod life 26 minutes. |

**Plus three carried obligations, cited rather than invented:**

- **2.1 — `as_of`, `window`, `commit` on every reported value.** Gate item 25 §4.7 owns this and I add nothing: *"a reading without the build it came from cannot be compared to the next one."* ⭐ And item 36's C-11 says the same thing from the rail side — provenance on the number: SHA measured at, date, and for a percentile its **N**. Here, that is **"SHA not pinned (no git by instruction)"** throughout, which is itself a ceiling on every baseline below.
- **2.2 — three outcomes, never two.** PASS / measured FAIL / **NOT EVALUABLE**. This is item 36's C-8 (PASS / measured FAIL / INCONCLUSIVE) and gate item 25 §4.4's third state (**UNREADABLE**, *"never folded into either"*) arriving at the same place from two directions, and the programme's own `_doc_text(None)==''` incident is what happens without it: **a layer that could not be READ is not a layer that is EMPTY.**
- **2.3 — YES / PARTIAL / NO, never a percentage, for anything whose population is not enumerated.** Item 36's TEST-12, verbatim: *"a percentage over a population nobody enumerated is DOC-1 with a decimal point."* Most bars in §4 are reported this way, and that is a deliberate consequence of §0(2).
- **2.4 — every bar states how it would be proved able to fire, and none has been.** Gate item 25 §4.6 enumerates the four methods with a precedent each — a pure decision function with a control; a pure clamp proved at its boundaries; **mutation-checking the wire, not just the logic**; a live trigger with an injected verdict through a late-bound seam. Item 36 §3's C-4/C-5 are the same four seen from the rail side. ⛔ **Nothing here was executed**, by instruction. Method 3 is the one to insist on: *"the wire is the part that has actually been cut in this repo"* — the insights pass was written, documented as scheduled, and wired into no scheduler for weeks.

---

## 3. ⛔ What this programme can and cannot know about itself

**Stated before the metrics, because it is what makes half of them impossible and the other half honest.**

### 3.1 The population, and the arithmetic it forces

| fact | value | source, with date |
|---|---|---|
| production `users`, **quoted** by every rollout and commercial claim | **26** (21 subscriptions, 143 MB) | `_merge-master/CLAUDE.md:2559-2561`, measured 2026-09-12 by `railway ssh` → `SELECT COUNT(*)`. ⚠️ **Never re-measured by this programme** |
| production `users`, **measured in-pod by this programme** | **29** — *"377,577,472 bytes, 29 users … Roster: 6 admin · 23 member"* | `verification/2026-09-14/OI-06-telemetry-derived-defaults.md:3-8`, `railway ssh`, `mode=ro`, 2026-09-14 |
| members holding **any** preference row | **21** — *"48 distinct `pref_key` values, 184 rows, 21 members. The rail sees 26."* | `00-program-control/COMPLETION_AUDIT.md:724-725`, in-pod read, 2026-09-21 |
| ⛔⛔ users with **any `page_views` row at all** | **13** | same OI-06 verification, 2026-09-14 — *"n = 13. **That is a listing, not a statistic** — read as an existence check"* |
| signup state | **closed** — `COMING_SOON_MODE`, roster is *"admins and testers"* | `_merge-master/CLAUDE.md:2559-2561`. ⚠️ The flag is two-sided (server + `VITE_COMING_SOON`) and **invisible to the flag ledger** — *"not gate-shaped"* (`flags-and-entitlements.md:203,:227`) |
| the richest cohort read | **17 of 29 accounts** hold a board; none empty; modal 5 widgets; blob median 476 B, max 8,752 B; **0 of 17** versioned; **0 of 17** unparseable | C5-03 §3, read-only aggregate over production `auth.db`, 2026-09-25 |
| that cohort's own ceiling | *"those 29 accounts are **admins, staff and testers**, several of whom built this board … This measures the cohort, not the market"* | `fixed-modular-hybrid.md:139-146` |
| every usage table, run once | `page_views` **4,949** rows · `calendar_seen` **16** · `calendar_alerts_fired` **956** · `ai_search_log` **79** · **17** stored layouts | OI-21, ANSWERED-BY-MEASUREMENT 2026-09-14; *"existence-checks, not rates"* |
| member-cohort telemetry | *"impossible today by construction — `COMING_SOON_MODE` means there is no member population to measure"* | `fixed-modular-hybrid.md:340-342` |
| member research | *"No member ever asked for anything in this file"* | gate item 16 §5 item 5, 2026-09-26 |

⛔ **The arithmetic, because it is the actual argument.** At n = 26, one account is **3.85 percentage points**; at n = 29, **3.45**. OBS-1 rejected n = 40 for a latency percentile *because* its nearest-rank resolution is 2.5 points and preferred n ≥ 60 at ~1.7. **An engagement rate over this population has worse resolution than a percentile this programme already ruled too coarse to compare.** C5-03 reached the identical conclusion independently and stated the instruction: *"`n = 29` also means every percentage here moves by 3.4 points per account. **Quote the counts, not the percentage**"* (`fixed-modular-hybrid.md:147`). Item 37's RB-1 reaches it from the rollout side: *"a fraction over 26 accounts yields a cohort nobody can reason about"* (`rollout-rollback.md:104`), noting that percentage buckets **browsers, not users**.

⛔⛔ **AND THE DENOMINATOR IS THREE NUMBERS, NOT ONE — WHICH IS WORSE THAN A SMALL POPULATION.** `users` **26** (quoted, 2026-09-12, never re-measured here) · `users` **29** (measured in-pod by this programme, 2026-09-14) · **21** members holding any preference row (in-pod, 2026-09-21, recorded beside the sentence *"The rail sees 26"*). Three tables, three dates, no contradiction between any two of them — **and no stable denominator either.** ⭐ Note which claims use which: **every workspace-telemetry claim in this programme divides by 29, while every rollout and commercial claim quotes 26.** ⛔ **A rate needs one denominator with one owner** (SM-12 proposes it), and this is a second-authority problem about the one quantity every business metric divides by.

⚠️ **And the 800× trap sits directly beside it.** The dev box carries a same-named `C:\data\auth.db` recorded at **~20,640 users**; the OI-06 verification states it explicitly — *"Two databases, identical filename, an 800× difference. This is the 29-user one"* — and `_merge-master/CLAUDE.md:2562-2565` warns that *"a migration, a backfill or a cost estimate sized off the wrong one"* is the failure. ⛔ **Every population figure in this document names its database and its date for that reason.**

⛔⛔ **The number that actually bounds a usage metric is 13.** Of the accounts in production, **13 have any `page_views` row at all** (2026-09-14) — against 4,949 rows total — and OI-06's own verification labels the derived ordering *"n = 13. That is a listing, not a statistic."* Worse for a "which surfaces do members use" metric: its session-opener ordering is explicitly **admins only, 50 day-sessions**. ⭐ So the richest usage table in the product supports an **existence check over 13 accounts, six of which are admins**, and nothing else. ⚠️ There is also no consent layer: `POST /api/auth/track`, `page_views` and `activity_log` exist and are admin-readable, with *"no consent or opt-in mechanism and no beta-scoped event stream"* (`flags-and-entitlements.md:545`) — which is a precondition on any member-usage metric, not a metric.

### 3.2 ⛔ The commercial inputs — and one correction to my own brief

**I was briefed that there is no revenue input anywhere. The artifacts disagree in one specific, and the correction matters because it changes what the cost section can say.**

| input | what exists | status |
|---|---|---|
| **a price, in the code** | *"The code sells **one plan at $200/month or $2,000/year**, 7-day trial, card required (`app/src/pages/Pricing.jsx:1-10`, `Subscribe.jsx:71-77`; `STRIPE_PRICE_ID_PRO` on `web`, `STRIPE_PRICE_ID_ANNUAL` not set)"* | E-06 §, 2026-09-02. ⛔ **Not an owner ruling** — CARD 17 leaves *"price, trial, seat model"* explicitly *"still undecided and still not mine"*. |
| **a second, incompatible price anchor** | a **$7 weekly promo** (≈ $30/month) | `charter/OWNER_SEED_FACTS.md:61`, `GOVERNING_PRINCIPLES.md:78`, OI-01. |
| **today's ARPU** | *"signup is closed (`COMING_SOON_MODE=1`), so **today's ARPU is not measurable from the code at all**"* | E-06, 2026-09-02. |
| **a cost ceiling** | **UNANSWERED.** OI-10 asks for the spend baseline *"and the AI API monthly ceiling you are comfortable with for member-facing lanes"*; its current answer column reads **"Unknown"**. | `OWNER_INPUTS_REQUESTED.md:18`. |
| **member demand** | none. OI-01's tier mix *"unknown"*; gate item 16 GAPS 9: *"No cost, no revenue, no member-demand input anywhere"* | — |
| **measured spend** | none readable. E-06's `$515/month` Anthropic base is *"an owner Console read recorded in session memory on 2026-08-24, not re-read by me"*; every spend ledger *"sits on the production volume"* | E-06 evidence ceiling. |

⭐ **So the precise correction: a price exists in code, no price exists as a decision, and no ceiling exists at all.** E-06 models the same feature set against both anchors and the answer inverts: **1.4–3.6 % of revenue at the $200 list, 9–24 % at the ~$30 promo floor, and a high case at 78 %.** ⛔⛔ **A cost metric expressed as a percentage of revenue therefore has two legitimate values that differ by roughly seven times, and this programme cannot choose between them** — which is exactly why CO-1 below is expressed as **cap coverage per lane**, a quantity that does not divide by a price.

⚠️ **One number that reads like revenue and is not.** R-18 states the per-user AI caps *"sum to about $650 per member per month (three times list ARPU)"*. The multiple is a claim about the $200 code price; it is **not** a statement that ARPU is $217, and nothing in the programme measures ARPU. Cite the cap, not the multiple.

⭐ **One business figure does exist and it is the closest thing to a revenue target in the programme, so it is worth stating rather than lumping in with the unknowns.** E-05's break-even table (2026-09-02, public list prices × labelled assumptions): at a paid fraction p = 100 %, break-even is **19 / 36 / 36 members** across its three compliance branches; at p = 10 %, **196 / 366 / 421**. The as-is stack is ≈ **$830/mo** ex-AI, against **$3.8k–7.1k/mo from the first month of any compliant branch** — *"That gap is the price of the licence, not of the terminal."* ⛔ It is not a target and E-05 does not offer it as one; every figure is an assumption, *"Nothing in this file is a measured spend."* ⭐⭐ **But note the convergence, because it was not engineered:** SM-7 sets a population floor of **200 accounts** from percentile resolution and the ramp precedent, and E-05's break-even at p = 10 % is **196**. Two unrelated derivations landing one account apart is the strongest available argument that 200 is the right order of magnitude for when this programme's metrics start to mean anything.

### 3.3 ⭐⭐ The programme's own MVP success sentence — and it is unmeasurable as written

**This is the one product-level definition of done the programme already has, and I nearly wrote this document without it.** It appears in four charter places, identically:

> *"The MVP definition: **the smallest coherent version that proves the Terminal-Next thesis, meaning our own traders voluntarily prefer it for at least one meaningful daily workflow after reasonable onboarding.**"*
> — `GOVERNING_PRINCIPLES.md:113`, and `charter/{A-one-week-constraint.md:936, B-execution-operating-system.md:1116, C-master-directive.md:1409}`; provenance `charter/PATCH_LEDGER.md:114` ("S3 — MVP sentence").

⛔⛔ **It fails field 2 of §2's contract, and it fails it on one specific word: *prefer*.** OI-02 is still open and asks exactly the missing thing — *"Internal dogfooders: how many people, which roles … and **who decides 'we prefer it'**"*, with its "blocks" column reading *"**MVP acceptance ('traders voluntarily prefer it')**"* (`OWNER_INPUTS_REQUESTED.md:10`). **A bar whose verdict has no named owner is not a strict bar; it is an opinion with a quorum problem**, and it is the fifth instance of §1's disease at the highest altitude in the programme: not a metric that fires on the normal case, but a metric that cannot fire at all.

⭐ **And the baseline for "prefer" is already measured, in the unflattering direction.** OI-06, owner-answered 2026-09-19: **thinkorswim, TradingView, Finviz and Unusual Whales are all opened by hand on a trading day**, plus unitemised others, with TradingView alerts part of the workflow — *"not itemized by rank/time-spent (owner declined that level of detail as unnecessary)"* (`CRITICAL_PATH.md:12`). So today's honest reading of the MVP sentence is **four external tools, hand-opened, daily.** ⛔ That is the number any "we prefer it" claim has to move, and `product-architecture.md` §1.1 records the same fact as *"behavioural evidence that a single fixed page is not how this desk works"* while C5-03 notes it *"cannot separate"* two of its own candidate architectures.

⛔ **PH-5 below is this sentence turned into a metric, and SM-11 supplies the one missing field — a default decider, vetoable in one word.** That is the single highest-leverage thing in this document, because it costs one dated sentence and it converts the programme's own definition of done from un-evaluable to evaluable.

### 3.4 The product's other stated goals, cited so this document does not invent a second set

`product-architecture.md` (accepted 2026-09-02) already states what good looks like at the product level, and it states its own falsifiers. ⛔ **I do not restate its thesis as a metric**, because that would put two authorities on one sentence. Three of its tests are directly reusable and are cited, not re-derived:

- **The loop test (§2.1):** *"the desk's tenth action of a session and the member's first action of a session must both be fast"* — the tenth is a re-target, not a rebuild; the first is ORIENT → LOAD with no vocabulary. ⚠️ Its own note: *"neither number exists today"* (§2.2). **That is the shape MQ-1 and MQ-4 exist to eventually fill, and neither fills it yet.**
- **The platform-primitive test (§3.1):** *"if two applications each built their own, would the product publish two answers to one question?"* **PH-3 is that test turned into a counted quantity.**
- **The six-question anti-conflation rule (§9):** availability (a) / normalization (b) / backend capability (c) / UI exposure (d) / workflow quality (e) / intelligence orchestration (f) — *"A proposal that says 'we have breadth' is answering (a)/(c); whether a member can reach it in one keystroke with a receipt is (d)/(e)."* ⭐ **Every metric in §4 that people will be tempted to read as product success is a (d)/(e) metric, and the document says so where it applies.**
- ⛔ Its falsifiers are *"left open, not assumed"* and it says of them: *"None of these can be tested from the repository."* Two are population-bound and appear in §5.

---

## 4. The metric set

### 4.0 How this set was counted, and the tally

⛔ **Not typed.** Counted over this finished file by heading pattern:

```
grep -c '^#### \(MQ\|PH\|EQ\|CO\)-'  10-roadmap/success-metrics.md      # 21
grep -o '^#### \(MQ\|PH\|EQ\|CO\)-[0-9]*' … | sort | uniq -d           # empty → 0 duplicate ids
grep -c '^- \*\*Computable today\.\*\*' …                               # 20  (field-2 coverage)
grep -c '^- \*\*Baseline\.\*\*' …                                       # 20
awk over each heading's block, checking all six line labels                # per-metric shape
```

**Result: 21 metrics, 0 duplicate ids.** Distribution measured the same way: member-visible quality **7** · product health **5** · engineering quality **6** · cost **3**.

⚠️ **Field coverage is 20 of 21, and the exception is deliberate and named:** **EQ-5** is a pointer to item 36 and carries its four fields in one combined line rather than four, because specifying them here would be the second authority §8 item 3 refuses. Every other metric carries all six line labels; the `awk` above is what checks it, and it is how I found that MQ-5 and MQ-6 were missing a `Baseline.` line before this section was written. ⭐ **That is the check catching its own author, which is the only reason to run it over your own output.**

**Computability, reported YES / PARTIAL / NO per TEST-12 and never as a percentage:**

| verdict | count | which |
|---|---|---|
| **YES** — a named instrument exists and computes the stated quantity today | **9** | MQ-2, MQ-3, MQ-4, MQ-7, PH-1, PH-2, PH-4, EQ-1, CO-1 |
| **PARTIAL** — an instrument exists but computes the stated quantity for only part of the population, or computes a neighbouring quantity | **2** | MQ-1 (intraday only; daily prints no p95 at all), EQ-4 (the in-process max exists; the distribution does not) |
| **NO** — no instrument exists; the sibling or owner input owning the gap is named | **9** | MQ-5, MQ-6, PH-3, **PH-5**, EQ-2, EQ-3, EQ-6, CO-2, CO-3 |
| **OWNED ELSEWHERE** — deliberately not specified here | **1** | EQ-5 (item 36) |

⭐ **Eight of the nine NOs are missing an instrument. PH-5 is missing a *person* — one sentence answering OI-02** — and it is the programme's own MVP definition of done (§3.3). **That asymmetry is the most useful thing in this table.**

**Baselines and targets:**

| | count | which |
|---|---|---|
| metrics carrying a **measured baseline** quoted from a dated artifact | **10** | MQ-1, MQ-2, MQ-3, MQ-4, MQ-7, PH-1, PH-2, PH-4, EQ-3, EQ-4 |
| of those, baselines at **n = 1** | **3** | MQ-2, MQ-4, EQ-3 — ⛔ a reading, not a baseline (SM-8) |
| of those, baselines taken **with the market closed**, on a market product | **6 of 6 market-sensitive ones** | MQ-1, MQ-2, MQ-3, MQ-4, EQ-3, EQ-4. The other four (MQ-7, PH-1, PH-2, PH-4) are not market-sensitive. ⛔ **So every performance and capacity baseline in this document is an after-hours reading** — see GAPS 1 |
| metrics with a target labelled **DERIVED** (a contract, or a number already chosen by a named authority) | **9** | MQ-1†, MQ-7, PH-2, PH-3, **PH-5**, EQ-1, EQ-2, EQ-6, CO-1 |
| metrics with a target labelled **FORECAST** (a number nobody has derived from a base rate) | **3** | MQ-2, MQ-3, MQ-4 |
| metrics with **no target until a baseline or a population exists** | **8** | MQ-5, MQ-6, PH-1, PH-4, EQ-3 (slope), EQ-4, CO-2, CO-3 |
| targets **deferred to another authority** rather than set here | **4** | MQ-1's quantity/N → **OBS-1** · EQ-3's ceilings → **OBS-4** · EQ-5 entirely → **item 36** · MQ-7's rung bars → the instrument's own `RUNG_BARS` |

† **MQ-1's threshold is DERIVED (CARD 16 chose 250 ms) while its statistic has never been computed.** That combination is the whole point of this document and it is why the two are separate columns. ⭐ **PH-5 is the mirror image: its target is DERIVED (the charter chose it, four times over) and its *verdict* has no owner.** A bar can be un-evaluable from either end.

**Twelve defaultable rulings, SM-1…SM-12** (`grep -c '^| \*\*SM-'` → 12), all in §7.

---

### 4.1 Member-visible quality

#### MQ-1 — served-latency percentile per surface × timeframe

- **Quantity.** ⛔ **DEFER TO OBS-1**, which names it: client wall-clock, **n ≥ 60 per timeframe**, `stale-swr` counted as SERVED per CARD 16, tier mix reported beside and **never as pass/fail**. I add no second authority over this value.
- **Computable today.** **PARTIAL.** `tools/bars_warmth_audit.py` (121 lines, opened read-only) prints a `p95` for intraday, where `warm_ms` is populated. ⛔ For **daily** it prints none: `stale-swr` sits in `COLD` (`:27-28`), the p95 line is inside `if warm_ms:` (`:109-112`), and daily is 100 % `stale-swr`. Dependency: gate item 25 **G-2** fix and **S3**; gate item 16 carries it as `FB-OBS-01` with the control — *"a fixture of 40 `stale-swr` samples must produce a p95 line, which today's code cannot"*.
- **Normal case.** No — and that is CARD 16's achievement. A healthy daily read is 104 ms against a 250 ms bar. A correct caching fix moves the quantity **down**, the safe direction. Grace: **pod ≥ 300 s** (§8 Governing Rule 1, OBS-7); a reading on a younger pod is NOT EVALUABLE, not a fail.
- **Survives a redeploy.** **DISTRIBUTIONAL** — 26 minutes of requests is a valid sample of a distribution. T0 sampled, reported T2. This is the metric that proves Rule 5 cuts both ways.
- **Baseline.** Intraday **39/40 `sqlite`, p50 65 ms**; daily **0/40 warm, p50 104 ms, max 301 ms**; n = 40, pod uptime 942 s, after the close, 2026-09-26 (item 24 §2.1). Also carried: warm server-compute **max 12.6 ms across eight chart surfaces**, and a 20,000-bar deep-intraday request at **590 ms total / 407.9 ms server / 1.42 MB** off `sqlite` (Protocol B, 0 FAIL / 11 checks).
- **Target.** **p95 ≤ 250 ms per timeframe — DERIVED** (CARD 16 ruled it; not re-opened here). ⛔⛔ **But no p95 has ever been computed for daily, so its status today is NOT EVALUABLE and any "PASS" against it is a FORECAST.** ⚠️ CARD 16's surviving tier alarm stands beside it and is not folded in: `fetch`/`miss` share above ~10 % on intraday **during RTH** is a real regression. Item 36's §4.3 already classes tier-share readings as advisory with that one exception — consistent, and not restated as a second rule.

#### MQ-2 — cold board payload, in bytes

- **Quantity.** Total bytes pulled by a cold visit to a board-shaped member page, with pod age recorded.
- **Computable today.** **YES** — a foreground-browser network read, the way Protocol C was executed 2026-09-26. ⚠️ Needs a real visible tab: item 24 records that Protocols C and H were blocked purely by the browser extension being disconnected.
- **Normal case.** ⚠️ **Yes, by construction — a cold visit *is* normal, and a deploy makes every visit cold.** So this is a **budget reported as a DIGEST, never a page** (gate item 25 §4.4's severity question: nobody is on the hook at 23:00 for a cold cache). ⛔ A metric that pages on every deploy is Rule 1 with extra steps. A correct fix moves it **down**.
- **Survives a redeploy.** Per-visit; no state. ⛔ But pod age is a covariate and must be recorded, because a deploy is what produces the cold state being measured.
- **Baseline.** **31.1 MB**, n = **1**, 2026-09-26: `barspack/<date>/hot` 1.37 MB, sixteen `intradaypack/<date>/<n>` shards at 1.67–1.97 MB each, `flow/data?days=1` 1.18 MB. ⚠️ The evidence file's own ceiling: *"No true cold pass"* — 45 of 107 resources came from browser cache — and *"Market closed"*, **so the RTH magnitude is unestablished** (carried by gate item 16 at `FB-A10-04`).
- **Target.** **Non-regression against 31.1 MB — FORECAST at n = 1.** ⭐ The shape is item 36's, borrowed deliberately: gate on no-NEW-regression against a **named dated baseline**, never on an absolute nobody derived. ⛔ An absolute byte budget per board cannot be set here because the target panel count is not this document's to choose (item 24 §6.1).
- ⭐ **This is simultaneously a cost metric.** Item 24 D10 re-scored the per-user live budget and found *"the scarce resource is not the connection count … it is the single process's time"*, and that a budget in **cold bytes per board** would have caught what a budget in concurrent streams would not. Counted once, read for two purposes.

#### MQ-3 — worst single server-time on a member page's load path

- **Quantity.** The maximum `server time` of any request on a member page's initial load, per page, with `stall` recorded beside it so browser queueing is excluded by evidence rather than by assumption.
- **Computable today.** **YES** — Protocol C, same instrument as MQ-2.
- **Normal case.** No. The healthy population on the same page measures **296–628 ms** for shards 2–15, and warm server-compute across eight chart surfaces maxed at **12.6 ms**. A correct fix moves it **down**.
- **Survives a redeploy.** Per-visit; no state. Report pod age, cold or warm.
- **Baseline.** `/api/schwab/market-narrative`: **20,768 ms cold, 7,531 ms warm, for a 1 KB response**, `stall` 2 ms both times, **reproduced on both runs and the slowest call each time**, 2026-09-26. `/api/calendar` at **4,519 ms** warm is *"a smaller instance of the same shape"*. ⭐ Item 24 calls this *"the most actionable single item this document contains and it needs no further research."*
- **Target.** **≤ 1,000 ms of server time for any single call on a member page's load path — FORECAST** (SM-4). ⭐ Derived from the healthy comparator population above rather than from taste, but it is still a forecast: nobody has measured the distribution of load-path server times across pages, so 1,000 ms is above observed normal and not yet a rate-derived bound.
- ⭐ **Why this metric matters more than its own number.** Ten small 0–1 KB calls sent within 600 ms all received a first byte at ~10.5 s with 1–3 ms stall on HTTP/3, which multiplexes: *"one shared bottleneck clearing at once"*. So a single slow call on this architecture is not one slow call — it is a queue behind one event loop and one 64-thread pool (gate item 25 §4.1). **The metric's unit is one call; its meaning is the whole page.**

#### MQ-4 — board settle time, per-panel framing cost, and retained heap

- **Quantity.** Wall-clock to settle a board of N panels; per-cell framing median and p95; heap **settled peak** and heap **retained after idle**, reported as two numbers; idle long tasks over a 60 s window.
- **Computable today.** **YES** — the admin-only `?gridspike=N&tf=…` harness, run in a **visible** tab (hidden tabs rAF-throttle; the sweep carries a validity guard). Executed on production 2026-09-26.
- **Normal case.** No. A correct fix moves settle time and retained heap **down**. ⚠️ The harness refuses to score what it cannot observe: its hover-sweep half reported `sweep.invalid: true, reason: "no crosshair events delivered"` because no pointer moved — **INCONCLUSIVE, not zero**, which is §2.2's third outcome working correctly in an instrument that already ships.
- **Survives a redeploy.** Per-run; no state.
- **Baseline.** N = 16: settle **2,582 ms**, heap **+218 MB settled / +45 MB retained**, per-cell framing median **28 ms** / p95 **82 ms**, idle long tasks **2, worst 85 ms** over 60 s. n = **1**, 2026-09-26. ⛔⛔ **It supersedes the "~900 ms / +63 MB" figure every prior document quotes**, and item 24's finding about that figure is the lesson: *"'+63 MB' was ambiguous between two numbers that differ by 4.8×, and a capacity budget has to say which … a per-panel budget built on it would have been wrong in whichever direction it was used."* ⭐ And 2,582 ms is **not** framing: at 28 ms median and ≤ 3 concurrent mounts, sixteen cells is ~450 ms of drawing, so the mount queue works and the cost is upstream in data.
- **Target.** ⛔ **No absolute target** — the target panel count is a product decision item 24 §6.1 leaves explicitly open, and `PANEL_MOUNT_CAP = 3` caps concurrent mounts while **there is no `MAX_WIDGETS`**, so nothing in the product bounds board size. ✅ **A non-regression bar can be set and is: at N = 16, per-cell p95 ≤ 82 ms and retained heap ≤ +45 MB — FORECAST at n = 1.** ⭐ Report the two heap numbers separately, always; that is the whole content of the 4.8× finding.

#### MQ-5 — freshness honesty: the maximum age displayed without saying so

- **Quantity.** The oldest value a panel renders without an age or staleness mark, per panel.
- **Computable today.** ⛔ **NO — and there is no threshold either.** Item 24 Q3 is **OPEN** and says so: *"the maximum age a panel may display without saying so is a product decision nobody has made"*, and it needs **one shell-level freshness authority (D8(b))**, which does not exist. Dependency: item 24 Q3 + D8(b).
- **Normal case.** n/a — there is no bar to fire.
- **Survives a redeploy.** ⛔ Worse: the browser facts make the naive version wrong in the worst place. Chrome's intensive throttling (once per minute past five minutes hidden) and freezing mean *"any tick-derived freshness indicator is wrong exactly when it matters"*. So this metric must never be derived from tick arrival.
- **Baseline.** **None.** ⚠️ The nearest thing is a per-chart contract, not a board one: recency-gating with hysteresis, engage at < 120 s since the last bar and disengage only after 150 s (`BARS_LIVE_STALE_MS` / `BARS_LIVE_DISENGAGE_MS`). Item 24 Q3's verdict is that this *"is a good per-chart contract and it is not a board contract."*
- **Target.** ⛔ **None, and none should be invented here.** ⭐ What *can* be stated without a number, and should be, is the rendering contract the matrix already names for its worst case: A6's coverage measured **n = 0** in the one observed monitor cycle, and the rule attached is *"the S8 receipt must render 'coverage n=0,' never an empty panel that looks like silence."* ⛔ An empty panel is the freshness metric failing silently.

#### MQ-6 — receipt coverage: member-facing numbers rendering through one provenance shape

- **Quantity.** Per surface, whether every displayed number and model-authored sentence carries provenance through the single renderer. ⛔ **YES / PARTIAL / NO per surface, never a percentage** (TEST-12).
- **Computable today.** ⛔ **NO** automated instrument. Dependency: S8/S10 and I1. ⭐ But the pattern to copy already ships and is worth naming, because it makes this metric an AST rail rather than an audit: item 22 records that `api/services/ticker_explain.py` already implements a **blocking grounding gate over the union of every model-authored free-text field** plus an **AST renderer-boundary rail** — so the generalisation is a rail job, not a design job. Gate item 16's observables are the same shape: *"a rail asserts non-null provenance per displayed reported row and **refuses to render** one without it"* (`FB-A3-02`).
- **Normal case.** No — a surface with full provenance passes. ⛔ A correct fix moves coverage **up**, and a refusal to render an uncited row moves the *rendered* count **down**, which is the direction Rule 3 exists to catch. **So the bar must be on coverage, never on rendered-row volume.**
- **Survives a redeploy.** An AST rail over source; no runtime state.
- **Baseline.** **None as a coverage read.** ⚠️ Two dated data points bound it from opposite ends: `ticker_explain.py` already enforces the contract on one lane (item 22, 2026-09-26), and the matrix records A6's transcript coverage measured **n = 0** in the one observed monitor cycle (2026-09-02) — *"transcripts may not actually be live in production."* ⛔ Neither is a coverage figure, and inventing one would be TEST-12's decimal point.
- **Target.** **Every member-facing surface reports YES, or names the rows it cannot cite — DERIVED, because it is a contract, not a forecast.** ⭐ The contract's teeth are gate item 16's `FB-A13-01`: *"If a lane cannot be cited, it does not render."*

#### MQ-7 — grounded-answer exam score

- **Quantity.** The report card's per-rung score against its own per-rung bars, plus refusals and **over-refusals reported as two separate numbers**.
- **Computable today.** **YES.** `api/services/compass_eval/` exists — I listed it read-only: `golden_set.json` (64 KB), `golden_set.py` carrying `RUNG_BARS` at `:16`, `runner.py`, `checks.py`, `judge.py`, `store.py` — driven by `scripts/run_report_card.py`. ⛔⛔ **Never on the production pod**: running a heavy script there has caused member-facing OOM twice.
- **Normal case.** No. ⛔ **But the trap is the refusal count, and it is CARD 21's shape exactly:** a model correctly declining an ungrounded answer moves the refusal count **up**, and an over-refusal is invisible in that same number. **Refusals and over-refusals are two metrics or this is not a metric.**
- **Survives a redeploy.** Scores land in the runner's SQLite trend store — durable, T1-shaped.
- **Baseline.** **12/50**, 2026-07-02, first trustworthy baseline after two harness bugs were fixed. ⚠️ Two ceilings, both load-bearing: it is **~3 months old**, and it grades **Compass**, not Terminal-Next. Best-of-breed carries the same figure as the honesty tax on the one row where UCT could be first rather than behind.
- **Target.** ⛔ **Defer to the instrument's own `RUNG_BARS` — DERIVED, already chosen and shipped**, with the existing deploy-gate rule unchanged: *exit 1 (any safety break, or any rung below its bar) = do NOT ship that change*. ⛔ I set no new number: a second bar beside `RUNG_BARS` is a second authority over one value. ⚠️ And the known hardening risk is recorded rather than re-solved — without mechanical checks that edge and heat were actually applied, *"a shallow grid can game the score into a WORSE mentor"*.

---

### 4.2 Product health

⚠️ **Read the whole of this subsection through §3.1.** Every baseline here is a **staff-and-tester cohort under `COMING_SOON_MODE`**, and the direction of the bias is the flattering one. These are (d)/(e) metrics in `product-architecture.md` §9's sense — reach and workflow quality — and none of them is evidence about members.

#### PH-1 — board composition among accounts that hold a board

- **Quantity.** Count of accounts holding a `charts_workspace_layout`; of those, the widget-count distribution, the count with zero widgets, and blob size median and max. ⛔ **Counts and a distribution, never an adoption rate** — §3.1's denominator problem forbids the rate.
- **Computable today.** **YES** — the read-only aggregate C5-03 §3 took over production `auth.db` (`user_preferences`), explicitly *"re-runnable; see §3 for the exact fields"*.
- **Normal case.** n/a — a distributional read with no bar. ⛔ **And it must stay bar-free while the cohort is staff**; a bar here would be a forecast dressed as a product signal.
- **Survives a redeploy.** Durable — a database read, not process state.
- **Baseline.** **17 of 29** hold a board; **0** empty; widget distribution 1→2 · 2→2 · 3→4 · 4→2 · **5→7**; `charts_workspace_groups` 16; `multichart_state` 5; `chart_settings` 9; blob median 476 B / max 8,752 B; 49 distinct preference keys app-wide. 2026-09-25.
- **Target.** ⛔ **NO TARGET until a member population exists.** §5 states the population. ⭐ What the baseline *does* establish, and it is worth keeping: *"Everyone who has a board has composed one, and the modal board is the maximum observed size"* — enough to retire "nobody customises" as an assumption, insufficient to carry anything else. C5-03's own re-open trigger is the honest bar: *"A member cohort (post-`COMING_SOON_MODE`) whose `charts_workspace_layout` adoption is far below 17/29."*

#### PH-2 — workspace document integrity

- **Quantity.** Two counts over live layout blobs: how many carry a `version` field, and how many are unparseable.
- **Computable today.** **YES** — the same aggregate as PH-1, same fields.
- **Normal case.** No. `unparseable > 0` is a real data-loss event and pages; `versioned < all` is a migration state and digests. A correct fix moves versioned **up** and unparseable stays **0**.
- **Survives a redeploy.** Durable.
- **Baseline.** **0 of 17 versioned. 0 of 17 unparseable.** 2026-09-25. ⭐ The first confirms from live data what D-11 §2.1 predicted from source; the second answers D-11's own open question on whether the silent data-loss path has ever fired — *"It remains a live path; it is not a live incident."*
- **Target.** **Unparseable = 0, and it is a PAGE. Versioned = every blob, once one versioned workspace document ships — both DERIVED**, because 100 % of an enumerated population is a contract and not a forecast. ⭐ This is the one metric in the whole set whose baseline, instrument and target are all in hand today, and it is worth noticing that it is a data-integrity metric rather than a product one. ⚠️ Gate item 16's `FB-S5-01` states the two assertions *"both of which currently fail"*: a corrupt blob must not autosave an empty board (**a fixture that must be seen to fail without the fix**), and a member must be able to restore version N−1.

#### PH-3 — values in the terminal with a second authority

- **Quantity.** A count of named quantities that two code paths compute independently, each one **named** and dispositioned. ⛔ **Names, not a number alone** — gate item 25's `lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report` and gate item 16's names-not-counts rule both bind.
- **Computable today.** ⛔ **NO** automated instrument. ⭐ **But the population is partly enumerated already and that is a genuine baseline of a different kind**, and one precedent rail exists to copy: `tests/test_no_shadowed_definitions.py` is a whole-repo AST sweep for a top-level name bound twice, written after `_parse_mdy` was defined twice and every one of its four call sites ran the wrong one.
- **Normal case.** No — zero is the healthy state. A correct fix moves the count **down**.
- **Survives a redeploy.** An AST/artifact sweep; no runtime state.
- **Baseline.** **PARTIAL, by enumeration rather than by instrument.** Named instances, each from a dated artifact: **two regime classifiers** (`capability-infrastructure-matrix.md` A11 — *"a normalization/single-authority problem to resolve BEFORE any consumer derives from either"*); **two earnings-date authorities** (OQ-14, the Discord bot's `get_catalyst_calendar_context` beside `/api/calendar`); a Cloudflare rule overriding a commented `max-age=0` (**CARD 20**, ruled: remove one authority); and, closed, `_parse_mdy`. ⭐ `product-architecture.md` §11 is effectively a ledger of this metric's intended movement — *"eight preference keys → one versioned document; five alert subsystems → one taxonomy; six-plus AI doors and per-surface gates → one renderer and one tool contract; 118 formatters → one"* — and its **Not reproduced** list includes *"any surface that publishes two counts of itself."*
- **Target.** **Zero new instances, and every existing one dispositioned before the surface that reads it ships — DERIVED**, a contract. ⭐ Justification, and it is why this metric is in the set at all: `_merge-master/CLAUDE.md` attributes **three separate outages** to this class, and CARD 20 cites it by name as the reason to remove one of two authorities rather than reconcile them.

#### PH-4 — board size, and whether the product bounds it

- **Quantity.** The observed panel-count distribution per board, beside the declared ceiling.
- **Computable today.** **YES** for the distribution (PH-1's aggregate) and for the constants by source read.
- **Normal case.** n/a — no bar exists to fire, which is the finding.
- **Survives a redeploy.** Durable.
- **Baseline.** Modal board **5 widgets**, max observed 5 (2026-09-25). `GRID_MAX_CELLS = 16`. `PANEL_MOUNT_CAP = 3`. ⛔ **There is no `MAX_WIDGETS`, so nothing in the product bounds how much a board may hold** — recorded independently by item 24 §3 Q1 and by C5-03.
- **Target.** ⛔ **NO TARGET. The number is not this document's and not any document's:** item 24 §6.1 lists *"the target panel count"* first among what it does not decide, calls it a product decision, and records that it blocks D4 and D10; its §3 Q1 says plainly *"The number still has to be chosen by a person."* ⭐ What is buildable before the number exists is gate item 16's `FB-S1-02` observable, and it is the right shape: *"Adding panel N+1 says why it was refused, in rendered text, and the relative 1→N curve exists to justify N."* **A stated bound with a rendered reason is available now; the value of N is not.**

#### PH-5 — MVP acceptance: does the desk voluntarily prefer it for one named daily workflow?

- **Quantity.** Per **named** daily workflow: whether the desk ran it in Terminal-Next by choice over a stated span of consecutive trading days, **and which external tool it displaced**. ⛔ Counts and names, never a preference score. ⭐ Naming the displaced tool is what makes this falsifiable rather than a mood: the alternative is measurable and currently in use.
- **Computable today.** ⛔ **NO — and it fails on the verdict, not on the data.** OI-02 is open and asks *"who decides 'we prefer it'"*; nothing answers it, so the charter's own bar has no adjudicator. The instrument is also **not a query**: CP-04's remaining confirming input is *"a desk-observed morning"*, which C5-03 states plainly is *"an observation session and not a question anyone can answer from a document"*. ⛔ **And it cannot be substituted with telemetry**: an aggregate route-breadth read was attempted twice and refused both times under production-read permissions (`DECISION_CARDS_2026-09-26.md:440-441`), and the population that would answer it is 13 accounts of which 6 are admins (§3.1).
- **Normal case.** No — but ⭐ **the direction is the subtle part and it is CARD 21's lesson at the product altitude.** A desk that keeps a specialist external tool open for a task Terminal-Next never claimed is **not** a failure of this bar, and a bar that counted every hand-opened tab would fire on the healthiest plausible state. **The bar is per named workflow, one at a time**, which is exactly what the charter sentence says and what a naive "displaces all four tools" reading would lose.
- **Survives a redeploy.** An observation plus a dated sentence; no runtime state. ⛔ But it is **CUMULATIVE in the sense that matters** — it is a claim about a span of days — so the record must be durable and dated, never a recollection.
- **Baseline.** ⛔ **None of the metric's own quantity.** The nearest datum, and it is the unflattering one: **four external tools opened by hand every trading day** (OI-06, owner-answered 2026-09-19, not itemised by rank or time-spent). ⚠️ And the programme's own scoreboard agrees about where it stands: `13-executive-synthesis/executive-questions.md` (2026-09-02) scores the five business questions Q36–Q40 at **0 green**.
- **Target.** **The charter's bar, unchanged — one meaningful daily workflow, voluntarily preferred, after reasonable onboarding — DERIVED**, because the owner already wrote it in four places and it is not mine to re-cut. ⛔ **What is missing is field 2, and SM-11 proposes the default that supplies it**: the decider, the span, and the form of the record. ⭐ **This is the only metric in the set whose gap is one sentence from an owner rather than an instrument from an engineer.**

---

### 4.3 Engineering quality

⛔ **This subsection is deliberately thin, and three of its six metrics are pointers.** `10-roadmap/testing-plan.md` (item 36) owns engineering-quality gates entirely — §3's C-1…C-12 contract, §4's merge/deploy/advisory split, §4.4's disturbance-interval constraint, §6's TEST-1…TEST-13. **Nothing from those is restated here.** What is here is the small set item 36 explicitly does not own: whether the *metrics themselves* are honest, and the three runtime quantities gate item 25 found unreadable.

#### EQ-1 — gate-evaluability

- **Quantity.** Of the definitions-of-done in force across this programme, how many have field 2 answered by a named working instrument. ⛔ **YES / PARTIAL / NO per bar, with the bars named**, never a percentage.
- **Computable today.** **YES** — a read over the bar list plus one check per bar of whether the named artifact computes the stated quantity. That is what §4.0 is: this document computing the metric over its own set.
- **Normal case.** No. A healthy programme is all-YES. A correct fix moves it **up**. ⛔ **And the failure direction is the invisible one**, which is why this metric exists at all: an un-evaluable bar does not report FAIL, it reports whatever adjacent line of output someone reads — CARD 16's replacement was recorded as a PASS off the COLD line's `max`.
- **Survives a redeploy.** A document read; no runtime state at all.
- **Baseline.** Computed here, over this set: **9 YES, 2 PARTIAL, 8 NO, 1 owned elsewhere** (§4.0). ⚠️ Gate item 16 independently measures the same disease over its 85 observables and finds **1** item stating *"No observable stated"* outright (`FB-S10-03`) and **5** naming a fixture or measurement that does not exist (`FB-A5-04`, `FB-S5-01`, `FB-S9-04`, `FB-OBS-01`, `FB-X3-02`) — with the correct caveat that *"that grep is a floor, not a census: an observable can be unreachable without the field admitting it, and every item depending on `FB-OBS-01` inherits its unmeasurability without restating it."*
- **Target.** **Every bar in force reads YES, or carries a dated owner for the instrument that would make it YES — DERIVED**, a contract. ⛔ A bar whose instrument has no date is not strict; it is §1.1's waiver with a longer fuse.
- ⚠️ **A drift this metric found in one of its own inputs, recorded rather than reconciled.** Gate item 16 states the count two ways: §1 H3 says *"Four of those fields are currently unanswerable for measurement reasons alone"* while §2.6 derives **one plus five**. Two tallies on two criteria, and **H3's four are never named.** Neither is wrong on its own terms; nothing reconciles them, and a metric about evaluability should say so out loud rather than pick.

#### EQ-2 — signal cadence compliance

- **Quantity.** Per named signal, did it report inside its window. ⛔ **Absence is the alarm.**
- **Computable today.** ⛔ **NO.** Dependency: gate item 25 **S6** — a T1 marker written on `web`'s volume by each signal via the atomic `os.replace` idiom, read over the private network by `terminal-next-monitor` (T2), one roll-up per day. Precedent: `liveflow_monitor`'s scorecard dead-man. ⛔ I do not re-specify it.
- **Normal case.** ⭐ **This is Rule 4b's one deliberate exception:** the roll-up posts even when everything is fine, because it is a cadence proof and not an alert. ⚠️ Exactly one message per day, on the ops channel.
- **Survives a redeploy.** T1 marker + T2 reader, by construction — the design exists precisely because a per-process heartbeat cannot survive one.
- **Baseline.** **None — the signal does not exist.** ⛔ Gate item 25 G-7 states the consequence in the one sentence that justifies this metric's place in the set: outside `liveflow_monitor`, *"no alert since Tuesday"* and *"the cron has not fired since Tuesday"* are **currently the same observation**.
- **Target.** **Every named signal reports in its window — DERIVED**, a contract. ⛔ **This is the metric that guards every other metric in this document**, and gate item 25 states the obligation recursively: the monitor must be able to answer the question about itself.

#### EQ-3 — RSS slope and thread ceiling

- **Quantity.** MB/min of RSS growth, pooled per deployment id, with `deployments_sampled` reported beside it; and peak thread count.
- **Computable today.** ⛔ **NO on a schedule.** The sampler is `print(f"[mem] rss_mb=… threads=…")` every 60 s to **stdout only** — nothing reads it, nothing stores it, a deploy ends the series (gate item 25 G-3). `/api/health` carries `rss_mb` but point-in-time, and its own comment says so. Dependency: gate item 25 **S4**, honouring **OBS-3** (≥ 40 `[mem]` samples within one deployment id before a slope is emitted) and **OBS-5** (retention).
- **Normal case.** No. A correct fix moves the slope **down**. Severity split, adopted from gate item 25 §4.4 rather than re-derived: **DIGEST for the slope, PAGE on a ceiling crossing** — the 2026-06-09/10 thread-exhaustion outage is the precedent that makes the ceiling a page.
- **Survives a redeploy.** ⛔⛔ **CUMULATIVE — per-process state is fatal here and this is the canonical instance.** A 5-sample read on a 5-minute-old pod read **flat-to-declining** (1,980 → 1,905 MB) on a pod leaking 7.9 MB/min. **A five-minute window cannot see this**, and 26 minutes is the median.
- **Baseline.** **+7.9 MB/min, monotonic across quartiles** (medians 2,429 → 2,746 → 2,956 → 3,028 MB), **76 samples over 104 minutes**, 2026-09-26. Threads min 41 / median 124 / max **178** against the shipped 200 burst line (`api/main.py:1478`) — item 24's own gloss: *"not comfortably far from 200."* ⛔⛔ **n = 1 deployment, after the close, and it does not identify what leaks.** ⭐ It refutes D-05 §4.3's 2.2 MB/s by ~17× and corroborates its 11,665 MB long-lived endpoint almost exactly (7.9 × 1,440 ≈ 11.4 GB).
- **Target.** ⛔ **Ceilings: DEFER to OBS-4** (threads > 200, reusing the shipped `THREAD_BURST_LOG_THRESHOLD`; RSS > 3,500 MB) — I add no second number. ⛔ **The slope: NO TARGET until a multi-deployment baseline exists.** At n = 1 it is a reading (SM-8), and item 24 §5.1 is explicit about what depends on it: *"'give the terminal its own long-lived process' and 'the long-lived process is the problem' are the same sentence."* ⚠️ And the measurement itself needs a declared quiet window that nobody has declared — gate item 16 carries it as `FB-OBS-07`, whose Depends-on field reads simply *"⛔ A person."* ⭐ Its observable is the right one and costs nothing: *"a measurement taken outside one is void by rule rather than by argument."*
- ⚠️ **One citation caution I am passing through rather than resolving.** Gate item 16 flags that OBS-4's *"max RSS 3,401 MB"* rationale does not appear in item 24 §2.2's published table, which prints quartile **medians**; the figure was later corrected in gate item 25's own OBS-4 row to point at `docs/perf-baseline-2026-09-26.md:35`. Real and measured; the pointer drifted. **I cite the ceiling as OBS-4's ruling, not the 3,401 figure.**

#### EQ-4 — event-loop lag distribution

- **Quantity.** A **percentile** of loop lag over at least one trading day spanning a market open and a heavy-job window. ⛔ **Not `max_lag_ms`.**
- **Computable today.** **PARTIAL.** `/api/watchdog/status` exposes the in-process maximum, so a point read works; the distribution does not exist. ⛔⛔ And the in-process max is the wrong quantity by construction: `_state["max_lag_ms"]` starts at `0.0` in `_fresh_state()` and only ratchets up in-process, while its **own arming runbook, in the same file**, instructs the operator to watch it *"for a few days"* and then set the kill threshold at *"3-5x"* the observed maximum. **A maximum-since-boot cannot span days on a process that lives 26 minutes, so the number the arming decision rests on has never existed.** Dependency: gate item 25 **S5** (sampled, accumulated outside).
- **Normal case.** No — but the arming decision is where Rule 1 bites. Gate item 25 keeps this at **DIGEST until CARD 18's condition is met**, and CARD 18's reasoning is worth carrying because it is the opposite of the usual error: three orders of magnitude of headroom *"is not an argument for arming; it is an argument that nothing is currently wedging, which means arming buys no protection today and adds a process that can `os._exit` the member-facing pod."*
- **Survives a redeploy.** ⛔ **CUMULATIVE as used today (a max-over-days) and therefore fatal in-process.** As a percentile over a window inside one pod's life it would be distributional — but the window CARD 18 requires is longer than a pod.
- **Baseline.** **max lag 14.9 ms over 330 checks** against a `wedge_sec` of **30**, with `enabled: false`, `WATCHDOG_OBSERVE=1`, 2026-09-26. ⛔ **Every sample so far is after the close.**
- **Target.** ⛔ **NO NUMBER. CARD 18's condition is the bar and it is not numeric:** one observation window spanning a market open **and** a heavy-job window, showing max lag still far below `wedge_sec`. ⛔⛔ **And the runbook's own "3–5× observed max" heuristic must not be applied to a 27-minute after-hours sample** — 3–5× of 14.9 ms is ~60 ms against a shipped threshold of 30 seconds, and the failure mode of an over-tight watchdog is killing a healthy member-facing pod. ⭐ **That is Rule 6 in its purest form: a threshold formula applied to the wrong population produces a number three orders of magnitude off, and it looks derived.**

#### EQ-5 — new failures against a named dated baseline

- **Quantity / computability / normal case / redeploy.** ⛔ **OWNED ELSEWHERE, ENTIRELY.** `10-roadmap/testing-plan.md` §4.1 and TEST-1/TEST-2 own what blocks a merge, the baseline's re-measurement cadence, and the staleness rule. Its ruling is the one I would otherwise have to invent and it is better: **gate on no-NEW-failures against a named dated baseline, never on green, and neither the exit code nor the task status is the verdict** — the wrapper has lied in both directions.
- **Listed here only so nobody concludes this document forgot it**, and to carry forward the one arithmetic fact that constrains every metric's measurement window equally: item 36 §4.4's disturbance-interval rule, and the measured instance — a **46–92 min** six-shard gate against master moving **56 commits in 92 min**. ⭐ The same arithmetic voids a memory-slope window (104 min needed, 26 min median pod) and voided 22 of 23 rig cells. **It is one constraint, and it applies to metrics as much as to tests.**

#### EQ-6 — auth-surface population: unguarded count **and** denominator

- **Quantity.** Unguarded routes, **over a published denominator**.
- **Computable today.** ⛔ **NO for the quantity as stated.** `api/auth_surface_check.py:79` sets `MUTATING = {"POST","PUT","PATCH","DELETE"}` and `:248` loops only over those, so every GET is structurally invisible — *"the instrument's design is right in every respect except its aperture"* (gate item 23 §1.7, confirmed at source by gate item 25 G-4). ⛔ And read-only is the terminal's shape, so the blind region is precisely the region a terminal lives in. Dependency: item 23 **DP-6** (already ruled engineering-only, additive, fails closed) + gate item 25 **S7**.
- **Normal case.** No — zero unguarded is the healthy state, and it pages.
- **Survives a redeploy.** Every boot; compared across boots. Artifact-read (live route objects), not a proxy.
- **Baseline.** ⛔ **None that means anything, and that is the finding.** Gate item 25 states it as a rule: *"A guard that reports '0 unguarded routes' without saying over how many routes is indistinguishable from a guard that examined nothing."* ⚠️ And there is a second, unenumerated coverage set: `middleware_guarded_prefixes(app)` exists at `:198` and its population was never listed — *"an unknown coverage set, which for observability purposes is the same as uncovered until enumerated"*. Gate item 16's `FB-S9-01` makes the denominator itself the deliverable.
- **Target.** **Zero unguarded over a published denominator, and the denominator prints — DERIVED**, a contract. ⭐ This is the anti-pattern library's **GATE-7**, its highest-severity active row: *"an auditor whose aperture excludes the failure class it exists for."*

---

### 4.4 Cost

⛔⛔ **Read §3.2 first. There is no cost ceiling** (OI-10 unanswered), **no measurable ARPU** (signup closed), and two legitimate price anchors seven times apart. **So exactly one cost metric here has a real instrument and a real target, and it is not a dollar figure.**

#### CO-1 — population-level AI cost exposure: cap coverage per member-facing lane

- **Quantity.** Per member-facing AI lane, does a **population-level** ceiling bound it — a lane-level daily dollar cap or equivalent — reported **YES / PARTIAL / NO per lane, never a percentage**; plus each lane's daily spend against its own cap where a cap exists.
- **Computable today.** **YES**, two ways, both artifact reads and neither needing a price: (a) enumerate the lanes and check each for a lane-level cap — the caps are declared env vars and code constants; (b) read the per-call ledgers, which are **durable SQLite tables, not module dicts**: `catalyst_cost_log` (per-call USD, `/data/catalysts.db`), `engine_cost_log` (theme engine, `auth.db`). ⛔ Both sit on the production volume, so E-06 could not read them and neither could I.
- **Normal case.** No. A cap breach is a real event, and a correct fix moves coverage **up**. ⚠️ The soft/hard split already shipped in one lane is the right shape and worth copying rather than re-inventing: `$8/day` **logs a warning**, `$15/day` **disables synthesis for the remainder of the day**.
- **Survives a redeploy.** ⭐ **Yes — and this is the one place the programme already got Rule 5 right on its own.** The caps are env vars and the accounting is in SQLite, so neither is per-process. **Do not move a spend counter into module memory**; it would become `_FAIL_STREAKS` for money.
- **Baseline.** **Caps that ship, per artifact:** catalyst synthesis `$8/day` soft, `$15/day` hard, per-call USD ledgered; theme engine `$5/day` ET-day; `COT_NARRATIVE_DAILY_CAP` 300/UTC-day. ⛔⛔ **And the gap that makes this metric exist:** R-18, open, owners *"E-06 → ARCH-05, **A-02**"* — *"The per-user AI caps in production code sum to about $650 per member per month (three times list ARPU) and **Compass chat has no population-level cap**; a Terminal-Next AI feature added on the same guards inherits an unbounded population exposure"* (`RISK_REGISTER.md:24`). E-06 corroborates at source: *"the chattiest member lane (Compass chat) has none (`COMPASS_COST_CAP_DAILY` default `0` = disabled)"*, alongside *"~40 `*_MODEL` env vars, no router module"* and **actual monthly spend NOT DETERMINED**. Modelled context, 2026-09-02, every figure a labelled assumption: **$2.8–3.6 per member-month** at 1,000–10,000 members, **$7.27** at 100, on a **fixed base of ~$515/month** (a second-hand Console read, 2026-08-24), with a high case at **$23.5 per member-month** all-in.
- **Target.** **No member-facing AI lane ships without a population-level cap — DERIVED**, and not by me: it is R-18's own stated mitigation, verbatim, and R-18 names A-02 as an owner. ⭐⭐ **Why cap coverage and not cost-as-a-percentage-of-revenue.** E-06 computes both and they invert: **1.4–3.6 %** of the $200 code price, **9–24 %** at the ~$30 promo floor, **78 %** for the high case at that floor. The crossover sits at *"roughly 1.3× the high case, or ~4.5× base engagement, at a $30 ARPU"* and at *"~32× base engagement"* at $200. ⛔ **A bar expressed against revenue would therefore be a bar whose pass/fail flips on a decision the owner has not made** — Rule 2 with a dollar sign. **Cap coverage is a property of the code and is true regardless of the price.** And E-06's own conclusion is that this is the right place to look: *"The economic risk is therefore not the model bill; it is a population without a ceiling."*
- ⭐⭐ **And E-06 already proposed the sizing formula and the one owner question that would complete it — both unratified, and I adopt neither as a number.** Its RECOMMENDATION: *"size every member-reachable lane with a **population daily dollar ceiling = N × allowance + scheduled reserve**, re-derived at each scenario boundary (100 · 500 · 1,000 · 5,000 · 10,000), and treat the per-user cap as the second rail."* Its worked default, at a 3 % AI-cost share of the $200 code price: *"the per-member allowance is **$6/month ≈ $0.28 per trading day**."* And its own new owner question, **never answered**: **OI-E06-04** — *"The AI-cost target as a share of ARPU (3 %? 10 %?) — this sets the per-member allowance and therefore every population ceiling."* ⛔ **I do not ratify the 3 %, because it multiplies a price CARD 17 leaves undecided.** ⭐ **But the formula needs no price at all once a share is chosen, which is why OI-E06-04 is a better owner question than OI-10:** one word ("3 %") makes every population ceiling in CO-1 derivable, and it does not require the owner to fix a price first. SM-9 defers to it.

#### CO-2 — cost per member-month

- **Quantity.** Total attributable cost divided by paying members.
- **Computable today.** ⛔ **NO — and it fails on the numerator and the denominator independently.** Numerator: every spend ledger is on the production volume and unread; `$515/month` is second-hand; OpenAI and Perplexity spend are *"unaudited anywhere"*; item 34's merged cost model is **NOT STARTED** (inputs E-05 and E-06 accepted). Denominator: §3.1 — 26 users on one date, 29 preference-bearing accounts on another, signup closed.
- **Normal case.** n/a — no bar.
- **Survives a redeploy.** Would be durable if it existed.
- **Baseline.** **None.** E-06's numbers are *"a public list price (dated) or a labeled assumption"* and it says so: *"Nothing in this file is a measured spend."*
- **Target.** ⛔⛔ **NO TARGET, and none is proposable.** It needs three things this programme does not have: a ceiling (OI-10, **Unknown**), a price as a decision rather than a code constant (CARD 17: *"Still undecided and still not mine: price, trial, seat model"*), and a stable denominator. ⭐ **Naming all three is the useful output**, because each is a one-line owner answer away from making this metric computable, and none is engineering work.

#### CO-3 — provider spend against contract

- **Quantity.** Per data provider, actual spend and entitlement against what is contracted.
- **Computable today.** ⛔ **NO.** *"No invoice, vendor console, Railway usage page, order form or contract was seen"* (E-05, 2026-09-02). CP-02 sits at 🟡 with **OI-04** as the only path to 🟢, and `product-architecture.md` GAPS records *"no contract seen (OI-03)"*. ⚠️ CP-03's licensing half **is** resolved (owner-confirmed 2026-09-19/20; of 118 register rows, 18 Restricted, 76 Likely Allowed, 12 Unknown) — **licensing is not the gap here; the commercial terms are.**
- **Normal case.** n/a.
- **Survives a redeploy.** Would be durable.
- **Baseline.** None.
- **Target.** ⛔ **NO TARGET until OI-04 lands.** ⭐ One sub-quantity is worth carrying because it is a metric a Terminal panel can fail on *without* any contract: the matrix marks **A9 Screening** *"the clearest single-point-of-failure in the whole matrix"*, where Finviz Elite is U-class at every cell and `robots.txt` disallows the scraped paths, so *"reachability itself is contested, not merely the licence."* **That is an availability metric, not a cost one, and it belongs to whoever owns provider health.**

---

## 5. ⛔ Metrics deferred until the population exists

**Each with the population it needs, stated. ⛔ "Deferred" here means: do not build the instrument, do not quote the number, and do not let its absence be read as a healthy zero.**

| deferred metric | the population it needs | why nothing smaller will do |
|---|---|---|
| **Any adoption or engagement RATE** (board adoption %, feature usage %, DAU/WAU) | **≥ 200 paying member accounts, post-`COMING_SOON_MODE`, with one named denominator** | At 26, one account is **3.85 pp** — coarser than the 2.5 pp OBS-1 rejected. 200 puts one account at 0.5 pp. And item 37 records that the ramp precedent it would copy ran over **~200** while a percentage buckets **browsers, not users**. |
| **Conversion funnel / trial→paid** | a population that can **sign up at all** | `COMING_SOON_MODE` closes account creation. The funnel's first stage does not exist. |
| **Retention / churn** | ≥ 200 accounts **and** two comparable periods | 21 subscriptions on one date is not a cohort; nothing in the programme holds a second date. |
| **Which surfaces members use** (route breadth, panel-open counts) | ⛔ **more than 13 accounts with any `page_views` row, and not six of them admins** | `page_views` holds **4,949** rows and OI-21 calls it an **existence-check, not a rate**; the derived ordering is labelled *"n = 13. That is a listing, not a statistic"* and its session-opener half is **admins only, 50 day-sessions**. ⛔ An aggregate route-breadth read was **attempted twice and refused both times** under production-read permissions (`DECISION_CARDS_2026-09-26.md:440-441`), so this is blocked on a grant, on a population **and** on the absence of any consent mechanism (`flags-and-entitlements.md:545`). |
| **PH-5's MVP verdict** as anything other than one person's dated sentence | a **named decider** (OI-02) — and, for a *member* reading rather than a desk one, a member cohort | The charter bar is about *"our own traders"*, so the desk reading needs no member population — only an adjudicator (SM-11). ⛔ A member-preference reading needs both, and is the falsifier `product-architecture.md` leaves open. |
| **MQ-1's p95 at the ruled N** | **n ≥ 60 samples per timeframe** (OBS-1) | n = 40 gives 2.5 pp nearest-rank resolution; OBS-1 chose 60 for ~1.7. ⛔ Plus G-2's fix, or daily yields no percentile at any N. |
| **EQ-3's leak slope as a trend** | **≥ 40 `[mem]` samples inside one deployment id** (OBS-3), pooled over **> 1 deployment** | 104 minutes needed; **26-minute median pod life**. The one existing sample exists because a deployment *happened* to live that long. |
| **EQ-4's lag percentile** | **one trading day spanning a market open and a heavy-job window** (CARD 18) | Every sample so far is after the close, and a max-since-boot cannot span days on a 26-minute process. |
| **CO-2, cost per member-month** | a **ceiling** (OI-10), a **price as a decision** (CARD 17), and a **stable denominator** | §3.2: the same feature set reads 1.4–3.6 % or 9–24 % of revenue depending on which anchor is used. |
| **Entitlement-boundary behaviour across cohorts** | **two accounts in different cohorts**, and for a toolkit metric, **a second toolkit** | Gate item 16's `FB-S12-01` needs *"two accounts, one tagged and one not"*; `FB-S9-04` needs a second toolkit and is *"impossible today"* — one toolkit ships (`"all"`). ⛔ **And note it is a COHORT axis, never a tier axis** (CARD 17, TEST-8). |
| **`product-architecture.md`'s own two population-bound falsifiers** — *"members route around the decisive surfaces"*; the per-ticker join *"too sparse to render"* | a member cohort; and *"a few hundred names with all four histories"* | Its own words: *"None of these can be tested from the repository … left open, not assumed."* |
| **A member-satisfaction instrument of any kind** (NPS, CSAT, survey) | a member population **and** an instrument that does not exist | ⛔ *"No member ever asked for anything in this file"* — there is no member research anywhere in the programme. |

⭐ **One deferral that is already partly lifted, recorded because it is the cheap one.** Gate item 16's `FB-X3-01` notes that `page_views` being populated makes a **click-through from a wire sentence to a named surface** observable today without new instrumentation — *"the rare item whose observable exists before the feature."* **An existence check over 4,949 rows is honest; a rate over 26 accounts is not.** The distinction is the whole of §0(2).

---

## 6. ⛔ Metrics this programme should NOT adopt

**Thirteen. The conventional ones are here on purpose — they are the ones that will be proposed.**

| # | do not adopt | why, with the artifact |
|---|---|---|
| 1 | **A warm-ratio or cache-tier pass/fail** (`≥ 99 % mem`/`sqlite`) | **RETIRED by CARD 16.** A 104 ms cache hit scored as a total failure. ⚠️ Its one surviving carve-out — `fetch`/`miss` > ~10 % on intraday during RTH — is a real alarm and item 36 §4.3 already classes the rest as advisory. Do not resurrect the gate; do not lose the carve-out. |
| 2 | **`legacy_only == 0` unrestricted** | **RE-CUT by CARD 21.** A bar a correct fix makes impossible to pass. Use CARD 21's three clauses, including that an *unexplained* exclusion blocks. |
| 3 | **Any in-memory consecutive-failure streak** | `_FAIL_STREAKS` needs an uninterrupted hour against a 26-minute pod. ⛔⛔ **And do not "fix" it by persisting the counter — CLAUDE.md says in the same breath that this rebuilds the proxy.** Read the artifact. |
| 4 | **Uptime as deploy verification** | When a deploy is superseded mid-flight, `/api/health uptime_seconds` resolves to the **superseding** pod's boot: a blip check *"named it as proof of its own deploy; it was measuring the other session's pod."* ⭐ Uptime is a fine **liveness** signal (gate item 25 S10, *"listed to be left alone"*) and never a deploy signal. Verify by ancestry. |
| 5 | **Any tier metric — upgrade rate, tier mix, ARPU-by-tier, a locked-behind-a-higher-tier funnel** | **CARD 17, owner ruling 2026-09-26: *"there is one paid tier only that is it."*** With one paid tier there is nothing to compare: *"no pricing table, no upgrade affordance, no locked-behind-a-higher-tier state, no per-tier entitlement rows."* The entitlement axis is **binary**; cohorts are not tiers. TEST-8 binds the same way (*"overturned by a new owner instruction only"*) and item 37 forecloses tier staging. ⛔⛔ **AND THERE IS A LIVE SECOND AUTHORITY ON THIS, SO CHECK WHICH DOCUMENT YOU READ:** `OWNER-ACTIONS.md:189-201`, **dated the same day**, still carries the *vetoed* default *"two paid tiers, no free tier"* — CARD 17 records the owner's verbatim words and wins; that section predates the veto and was never propagated. **An agent briefed off `OWNER-ACTIONS.md` would build a tier metric.** ⭐ The two documents agree exactly on the undecided list (price, trial, seat model), which is the part that is safe to rely on. |
| 6 | **A conversion funnel, DAU/WAU, stickiness, or any engagement rate, now** | §3.1: 26 users, signup closed, one account = 3.85 pp, and two denominators on two dates. **Theatre, and worse than theatre — it would be quoted.** §5 states the population. |
| 7 | **A percentage-based rollout or exposure metric** | Item 37 RB-1: percentage buckets **browsers, not users**, over ~26 accounts. Stage by **cohort, then surface.** |
| 8 | **Test count, test-file count, or pass count as a quality metric** | Item 36 rules the gate on **no-NEW-failures against a named dated baseline, never on green**, and records that *"neither the exit code nor the task status is the verdict"*. ⭐ Its own denominators drifted by 562 files while the prose stood still. |
| 9 | **Alert volume as a health metric** | CARD 21's shape at the operational altitude: a correct suppression drives volume **down** and a correct new detector drives it **up**. Neither direction is health. Measure delivery correctness and cadence (EQ-2). |
| 10 | **A refusal count as a progress metric** | An over-refusal is invisible in it. MQ-7 splits refusals from over-refusals for exactly this reason. ⭐ A refusal is a fine **observable** — gate item 16 uses it as one deliberately (*"the refusal is the observable, because it is the only version of this that cannot degrade silently"*) — and a poor **score**. |
| 11 | **A composite "terminal health" score** | ⛔ A judgement call, and mine. A composite cannot be mutation-proved: no single mutation reds it, which is the same structural defect as *"three copies of a guard cannot be mutation-proved"*. It also hides which component moved, and §2.2's three outcomes collapse into a number that cannot say NOT EVALUABLE. **Report the components.** |
| 12 | **Any coverage figure as a percentage over a population nobody enumerated** | TEST-12, verbatim: *"a percentage over a population nobody enumerated is DOC-1 with a decimal point."* ⭐ And EQ-6 is the live instance: *"0 unguarded routes"* without a denominator is indistinguishable from a guard that examined nothing. |
| 13 | **A metric whose instrument this programme has not read the output of** | ⛔ Gate item 25 G-1: the drop counters are read by *one operator-run tool and no schedule in this repo*. ⭐ And the general rule the anti-pattern library states as **GATE-1** — *"a guard nobody has seen fire is not a guard"* — applies to metrics identically. §2.4 is the obligation; nothing here has discharged it. |

---

## 7. Defaultable rulings

⛔ **Each is a ruling, vetoable in one word, not a question handed back.** Each states what would overturn it. ⛔ **No row carries a per-tier dimension** (CARD 17), and no row sets a number another document owns.

| id | decision | proposed default | why this default | overturned by |
|---|---|---|---|---|
| **SM-1** | What makes a proposed metric adoptable | **All four fields of §2, or it is a topic and not a metric.** A missing field 2 is stated as `NOT COMPUTABLE` naming the sibling that owns the gap — never as a plan | The programme has twice adopted a bar whose field 2 was wrong or absent (CARD 16, G-2), and in both cases the argument happened over the threshold. The contract makes that impossible to repeat silently | An owner ruling that a named bar may enter the gate list with field 2 open — which SM-2 already provides for, with a date |
| **SM-2** | May an un-evaluable bar be in force? | **Yes, exactly once, and only carrying a dated owner for the instrument.** Its status is reported **NOT EVALUABLE**, never PASS, never FAIL, and never read off an adjacent line of output | CARD 16's replacement was in force and unevaluable for weeks, and was recorded as a PASS off the COLD line's `max`. A dated instrument owner is the smallest thing that makes that visible. ⭐ A bar with no date is §1.1's waiver with a longer fuse | Nothing short of an owner accepting an undated un-evaluable bar — which is the state this ruling exists to end |
| **SM-3** | Cold-board byte budget | **Non-regression against 31.1 MB**, the 2026-09-26 Protocol C reading, **reported DIGEST and never PAGE**, with pod age recorded | An absolute budget needs the panel count, which item 24 §6.1 leaves to a person. A non-regression bar against a named dated baseline is item 36's own doctrine and needs no number nobody has derived. DIGEST because a cold visit is the normal case (Rule 1) | A second cold reading materially different from the first — which makes the baseline n = 2 and a real budget derivable. ⚠️ Or an RTH reading, since the existing one was taken with the market closed and *"45 of 107 resources came from browser cache"* |
| **SM-4** | Member-page load-path budget | **No single call on a member page's initial load path exceeds 1,000 ms of SERVER time**, with `stall` reported beside it | Above observed normal for everything except the two known defects: shards 2–15 at 296–628 ms, warm server-compute max 12.6 ms across eight chart surfaces. ⭐ And the reason it is a *page* budget rather than a call budget: ten 0–1 KB calls all landed at ~10.5 s with 1–3 ms stall on HTTP/3, so one slow call is a queue behind one event loop | A measurement showing a legitimately expensive call that cannot be moved off a load path — in which case the ruling becomes a named exception list, not a higher number |
| **SM-5** | Severity taxonomy for metrics | **Adopt gate item 25 §4.4 verbatim — PAGE / DIGEST / UNREADABLE, decided by "who is supposed to guarantee this?"** No second taxonomy | Three modules arrived at the third state independently, and this programme's own `_doc_text(None)==''` incident is what happens without it: a layer that could not be read is not a layer that is empty. ⭐ A second severity vocabulary would be a second authority over one value | An owner preference for a different vocabulary — in which case gate item 25's is the one that moves, and this document follows it |
| **SM-6** | Anything percentile-shaped | ⛔ **DEFER TO OBS-1. This document sets no percentile quantity, statistic or N, here or anywhere** | OBS-1 has already ruled client wall-clock, n ≥ 60, `stale-swr` as SERVED, tier mix beside and never pass/fail. TEST-10 defers to it too. ⭐ **A second deferral is safe; a second number is not** | OBS-1 itself being overturned — in which case this row follows it with no separate decision |
| **SM-7** | Population floor for a rate | **No metric expressed as a percentage or a rate over member accounts is adopted below n = 200 accounts with one named denominator.** Below that, report counts and names | Arithmetic: 1/26 = **3.85 pp**, 1/29 = 3.45 pp, both coarser than the 2.5 pp OBS-1 rejected; 1/200 = 0.5 pp. And 200 is the population the ramp precedent item 37 would copy actually ran over | An owner ruling that a named rate is worth reading noisily — in which case it publishes **n beside every value, every time**, per CARD 11's discipline: *"n is reported as n, always"* |
| **SM-8** | When a baseline stops being a baseline | **An n = 1 reading is never a baseline; it is a reading, and is labelled so.** A measured baseline is quoted with its **commit and its n**, and is STALE when the commit is no longer an ancestor of what ships | Derived rather than chosen: item 24 labels its own key figures `n = 1` and says a five-minute window reads a leaking pod as flat-to-declining. ⛔ **And a calendar rule would be the wrong instrument** — master moved 56 commits in 92 minutes, so code age, not clock age, is what invalidates a performance baseline. ⚠️ Item 36's TEST-2 owns the **test** baseline's 14-day rule; this row does not touch it | A measurement showing a named baseline stable across commits — which converts the rule from ancestry to a cadence for that metric |
| **SM-9** | Cost gating at v1 | **The only cost bar in force is cap coverage per member-facing AI lane (CO-1). No cost-as-a-share-of-revenue bar is adopted, and E-06's 3 %/$6-per-member allowance is cited, not ratified** | R-18's own mitigation, which names A-02, and E-06's conclusion that *"the economic risk is … a population without a ceiling."* ⛔ A revenue-share bar flips pass/fail on an undecided price: the same feature set reads 1.4–3.6 % or 9–24 %, and the high case 78 % | **OI-E06-04** being answered — a share of ARPU, one word — which makes E-06's `N × allowance + scheduled reserve` ceiling derivable **without** anyone fixing a price. ⭐ That is a cheaper unlock than OI-10 and should be asked first. Or OI-10 itself, which makes a ceiling-ratio computable directly |
| **SM-10** | Where a metric's state lives | **Cumulative ⇒ T2 with `deployments_sampled`. Distributional ⇒ T0 with a stated minimum pod age. Classified before the instrument is written, not after** | Gate item 25 §4.2's tiering rule, adopted rather than re-derived. ⭐ **And the reason it is a ruling and not a note:** the failure it prevents is silent — a cumulative counter in module memory reports healthy through a total failure, and this repo has three instances | The web pod ceasing to be one process — which changes the constraint, not the classification |
| **SM-11** ⭐⭐ | Who decides *"we prefer it"*, and in what form — the missing field 2 of the charter's MVP sentence (§3.3, PH-5) | **The owner decides, and the verdict takes one form: a dated sentence naming (a) the workflow, (b) the external tool it displaced, and (c) the span, default ≥ 5 consecutive trading days.** A workflow with no named displaced tool does not count; a verdict with no date is not a verdict | ⛔ OI-02 has been open since 2026-09-02 and **the charter's only product-level definition of done cannot be evaluated without it** — that is §1's disease at the highest altitude in the programme. The owner is the default because OI-02's own current answer is *"2–5 internal users: the owner plus at least one partner"*, and among those the owner is the only role every workflow shares. **5 trading days** is one full week, matching the span every S7 dark bar in this programme already uses, so it introduces no new number. ⭐ And requiring the displaced tool is what makes it falsifiable against the measured baseline of four hand-opened tools | **OI-02 being answered** — naming a different decider, a quorum, or a different span. ⚠️ This ruling exists to be replaced by that answer, and should be deleted the day it arrives rather than reconciled with it |
| **SM-12** | Which denominator a rate divides by, when there is one | **One denominator, named, re-measured, with its date and its database stated: `SELECT COUNT(*) FROM users` on the production `/data/auth.db`.** The preference-bearing count and the `page_views`-bearing count are **sub-populations, reported as counts beside it and never substituted for it** | ⛔ Three numbers exist today — 26 (quoted 2026-09-12, never re-measured here), 29 (in-pod 2026-09-14), 21 (preference rows, 2026-09-21) — and every workspace claim divides by one while every commercial claim quotes another. ⛔⛔ And the dev box holds a same-named file at **~20,640 rows**, an 800× trap the OI-06 verification had to state explicitly, which is why naming the database is part of the ruling and not a footnote | An owner naming a different denominator — e.g. paying accounts rather than all accounts, which would be the right one for anything commercial and is unavailable while signup is closed |

---

## 8. ⛔ What this document does NOT decide

1. **Any percentile quantity, statistic or N.** OBS-1 owns it; SM-6 defers; TEST-10 defers to the same place. ⛔ Three documents pointing at one number is correct; two documents naming it is not.
2. **The 250 ms latency threshold.** CARD 16 chose it. This document only reports that the statistic behind it has never been computed.
3. **Any engineering-quality gate, its threshold or its cadence.** `10-roadmap/testing-plan.md` owns §3's C-1…C-12, §4's merge/deploy/advisory split and §6's TEST-1…TEST-13. EQ-5 is a pointer, deliberately.
4. **Which observability signals exist, who reads them, on what schedule, into which channel.** Gate item 25 owns S1–S10 and OBS-1…OBS-9. Where a metric needs a signal that does not exist, §4 cites the dependency and specifies nothing.
5. **The target panel count, and therefore any absolute per-panel budget.** Item 24 §6.1: a product decision, blocking D4 and D10. MQ-4 sets a non-regression bar at N = 16 and no absolute.
6. **Price, trial, seat model, or anything that divides by them.** CARD 17 leaves all three to the owner. CO-2 names the three missing inputs and stops.
7. **The cost ceiling.** OI-10, **Unknown**. SM-9 deliberately chooses a bar that does not need it.
8. **Whether to arm the event-loop watchdog.** CARD 18 ruled NOT YET and named the condition. EQ-4 supplies no number and explicitly refuses the 3–5× heuristic on an after-hours sample.
9. **Any rollout stage, gate or reach.** `10-roadmap/rollout-rollback.md` owns RB-1…RB-11. §6 row 7 only declines to measure a percentage.
10. **The product's thesis, its falsifiers, or its non-goals.** `product-architecture.md` owns them; §3.4 cites three of its tests and restates none. ⛔ Nor the MVP's content — §3.3 measures the charter's MVP *sentence*; item 27 (`10-roadmap/mvp.md`, NOT STARTED) owns which workflow and what onboarding means.
11. **Which features are worth building, and in what order.** Item 16 enumerates and does not rank; **item 17 (`05-product-strategy/feature-scoring.md`) owns ranking** and is being written concurrently. ⛔ Nothing here is a score, a weight or a priority — and gate item 16's GAPS 9 already records that *"nothing here can be scored on value or ROI"* without the commercial inputs §3.2 lists as missing.
12. **Any owner, date or sequence for building the instruments named as missing.** Eight metrics read NOT COMPUTABLE. ⛔ **Naming the eight is this document's job; scheduling them is not** — and SM-2 is the mechanism that keeps an un-named date visible rather than comfortable.
13. **Who decides *"we prefer it"*.** OI-02 owns it. ⛔ SM-11 proposes a **default** so the charter's MVP sentence stops being un-evaluable in the meantime, and says in its own row that it should be **deleted** the day OI-02 is answered rather than reconciled with it. ⛔ It also does not decide the MVP's *content* — which workflow, or what "reasonable onboarding" means; item 27 (`10-roadmap/mvp.md`, NOT STARTED) owns that.
14. **The population denominator itself.** SM-12 rules how to name it and explicitly does not settle it: settling it is one `SELECT COUNT(*)` against production, and this document took no production read.
15. **That any metric here can fire.** ⛔ Nothing was run. §2.4 states the obligation and names the four proof methods; discharging them is engineering work, and until it is done every bar below is a claim about an artifact and not about the world.

---

## GAPS — what this document could not reach

1. ⛔⛔ **Not one measurement is mine; the strongest baselines here are `n = 1`; and EVERY market-sensitive baseline was taken with the market closed.** Counted in §4.0: **6 of the 6** market-sensitive measured baselines (MQ-1, MQ-2, MQ-3, MQ-4, EQ-3, EQ-4) are after-hours readings of a market product, and three of them rest on a single run. SM-8 exists because of it. ⚠️ MQ-2's is worse than n = 1: its own evidence file says *"No true cold pass"* (45 of 107 resources came from browser cache) **and** *"Market closed"*, so **the RTH magnitude of the cold-board cost is unestablished**. ⛔ **The single highest-value follow-up to this document is therefore not a new metric — it is one RTH re-run of Protocols A, C and F inside a declared quiet window**, which is the thing gate item 16's `FB-OBS-07` says needs *"a person"*.
2. ⛔ **No SHA is pinned anywhere** (no git by instruction), so every baseline is a claim about a worktree on 2026-09-26 and SM-8's ancestry rule cannot be applied by this document to its own numbers. ⭐ That is a real limitation on the rule I proposed, and the first person able to run git should stamp the ten measured baselines in §4.
3. ⛔ **I did not verify that any instrument I called computable actually runs.** I opened `tools/bars_warmth_audit.py` and listed `api/services/compass_eval/`; the `?gridspike=` harness, the Protocol C browser read and the `auth.db` preference aggregate are cited from the documents that executed them. **"YES" in §4.0 means an instrument exists and its output was recorded by someone — not that it passes today** (item 36's TEST-12 gloss applies: a YES is a claim that a named artifact exists, never that it currently passes).
4. ⚠️ **The population has three values and I did not re-measure any of them.** 26 (quoted, 2026-09-12), 29 (in-pod, 2026-09-14), 21 (preference rows, 2026-09-21). SM-12 rules **how** to settle it and deliberately does not settle it, because settling it needs one `SELECT COUNT(*)` against the production volume and this document took no production read. ⛔ **So SM-12 is a ruling whose first act is a measurement nobody in this document was permitted to take**, and that should be the first thing done with it.
5. ⚠️ **Gate item 16's "four unanswerable fields" (§1 H3) and its derived "one plus five" (§2.6) are two tallies on two criteria, and H3's four are never named.** EQ-1 records the drift rather than resolving it, because resolving it means re-reading 85 fields against a criterion H3 never states.
6. ⛔ **The three product-level tests I cite from `product-architecture.md` have no numbers, and I did not invent any.** Its own §2.2 says of the loop test: *"neither number exists today."* So the programme's most product-shaped success condition remains unquantified, and MQ-1 and MQ-4 are the nearest proxies rather than the thing itself.
7. ⛔ **R-18 is only half discharged.** CO-1 gives it a metric, a baseline and a target; it does not enumerate the member-facing AI lanes. E-06 counts *"~40 `*_MODEL` env vars, no router module"*, so **the lane roster is exactly the derived-not-typed list this document refuses to hand-type**, and producing it is the first work item CO-1 implies.
8. ⚠️ **No spend ledger was readable** — `catalyst_cost_log`, `engine_cost_log`, `llm_route_cost_log`, `voice_usage_monthly` all sit on the production volume. So CO-1's second computation path is asserted from schema, not exercised, and E-06's `$515/month` base remains a second-hand Console read from 2026-08-24.
9. ⚠️ **Two of my inputs are ~3 weeks older than the rest.** `product-architecture.md` and `capability-infrastructure-matrix.md` are both 2026-09-02, and the matrix's own instruction binds anyone quoting the capability ledger: *"178 rows measured directly by row-pattern count 2026-09-02; cited by row id, never restate this figure elsewhere without re-measuring."* I cite neither count. ⭐ And the backlog records that a 24-day-old ledger was insufficient for it — four superseded cells in the four places it checked — so a ledger refresh would sharpen §4.2 and §4.4 more than anything else available.
10. ⛔ **I proposed no instrument for PH-3 and MQ-6, the two metrics most directly about the product's stated thesis.** Both are stated as YES/PARTIAL/NO with a precedent rail named (`test_no_shadowed_definitions.py`; `ticker_explain.py`'s AST renderer-boundary rail). **A precedent is not an instrument**, and the gap between them is the honest size of the work.
11. ⚠️ **Eleven of the twenty-one metrics are, in some part, pointers to gate items 25 and 36.** That is deliberate — the alternative is a second authority — but it means this document's usefulness is bounded by theirs, and if either is re-cut, §4 must be re-read rather than assumed to have travelled.
12. ⚰️ **§3.3 and PH-5 were ADDED AFTER THE FIRST DRAFT WAS WRITTEN, and the first draft did not contain the programme's own MVP definition of done at all.** A late input surfaced the charter sentence in four places and OI-02 beside it. ⭐ **A success-metrics document that omitted the programme's only product-level success sentence is worth recording as a near-miss rather than quietly fixing**, and the reason it happened is instructive: the sentence lives in the charter and in `GOVERNING_PRINCIPLES.md`, not in any of the four sibling deliverables I was pointed at, so a brief assembled from siblings does not contain it. ⛔ **Anyone extending this document should read the charter, not only its neighbours.**
13. ⚠️ **A full read of `OPEN_QUESTIONS.md` (OQ-01…OQ-16) was not done**, so an open question bearing on a metric here may be unrepresented; only OQ-14 reached §4, via the matrix. ⚠️ Likewise, `00-program-control/CRITICAL_PATH.md` and `OWNER_INPUTS_REQUESTED.md` were read by targeted grep, not in full.
14. ⛔ **Two counts inside my own inputs are wrong or unreconciled, and I propagated neither.** `CRITICAL_PATH.md:25` closes with *"Tier-1 count: 10 of 10"* while the Tier column holds **9** Tier-1 rows (CP-01…CP-08, CP-10) — a hand-typed count beside the table it describes, the defect that file names three times in its own cells. And `OWNER-ACTIONS.md:189-201` still carries the **vetoed** two-paid-tier default against CARD 17's one-tier owner ruling of the same date (§6 row 5). ⭐ Neither is mine to fix; both are recorded so this document is not the place they spread from.

---

## SOURCES

⛔ **No production read, no network request, no git command, no test, no script.** Every item below was read as a file, and the two `_merge-master` source reads are named individually.

**Research documents (this worktree, `docs/terminal-research/`):**
- `10-roadmap/observability-plan.md` — ARCH-07-OBS, gate item 25, draft. §0 findings 1–3 (lines 50-112), §1 method, G-2 (`:351-394`), G-3 (`:396-427`), G-4 (`:429-454`), G-5 (`:456-470`), §4.1 (`:566-587`), §4.2 tiering table (`:589-608`), §4.3 S1–S10 (`:610-637`), §4.4 severity (`:639-657`), §4.5 grace windows (`:659-683`), §4.6 four proof methods (`:685-720`), §4.7 `as_of` (`:722-738`), §4.8 dead-man (`:740-756`), §4.9 OBS-1…OBS-9 (`:758-773`).
- `07-technical-architecture/realtime-performance-architecture.md` — ARCH-07, gate item 24, draft 2026-09-26. §2.1 (`:286-305`), §2.2 leak (`:307-330`), §2.3 watchdog (`:332-341`), §2.4 deploy window (`:343-366`), §2.6 cold page (`:368-409`), §2.5 environment (`:411-416`), §3 Q1 (`:425-464`), Q2–Q5 (`:466-494`), §4 D5/D7/D10 (`:549-557`), §5 (`:568-585`), §6 (`:591-604`), GAPS.
- `05-product-strategy/feature-opportunity-backlog.md` — F-05-BACKLOG, gate item 16, draft, `date: 2026-09-26`. 85 items, field label `Known it worked.`; §1 H3 (`:105-120`), §2.1 (`:150-154`), §2.2 (`:170`), §2.5 (`:265-277`), §2.6 (`:302-313`), GAPS 8 (`:1427-1434`), GAPS 9 (`:1435-1438`), §5 item 5 (`:1350`), frontmatter FOURTH CEILING (`:61-64`); items cited by id: `FB-S10-03` (`:441`), `FB-OBS-01` (`:1126`), `FB-OBS-03` (`:1148`), `FB-OBS-06` (`:1181`), `FB-OBS-07` (`:1192`), `FB-S5-01` (`:913`), `FB-S9-01` (`:995`), `FB-S9-04` (`:1033`), `FB-S1-02` (`:350-353`), `FB-A10-04` (`:519`), `FB-A3-02`, `FB-A13-01`, `FB-A7-01`, `FB-D5-02`, `FB-S12-01`, `FB-X3-01` (`:1273`), `FB-X3-02` (`:1284`), `FB-I1-04` (`:862`).
- `10-roadmap/testing-plan.md` — H-06, gate item 36, draft (⚠️ no frontmatter date; its baseline artifact is dated 2026-09-24). §3 C-1…C-12 and the four proof methods, §4.1–§4.4, §5 items 6, 10, 11, §6 TEST-1…TEST-13, and its non-ownership list.
- `05-product-strategy/product-architecture.md` — WS1-PRODUCT-ARCH, `date: 2026-09-02`, accepted. §1.1–§1.3, §2.1 loop test, §2.2, §3.1 platform-primitive test, §9 six-question rule, §11, §12, GAPS.
- `05-product-strategy/capability-infrastructure-matrix.md` — WS-CAPINFRA, `date: 2026-09-02`, accepted. A6 (`n = 0` coverage), A9, A11, D2, D3, S3, S11, E1, the whole-file telemetry ceiling, and the 178-row citation instruction.
- `05-product-strategy/anti-patterns.md` — F-01, gate item 11, draft. GATE-1, GATE-6 (`:853-887`), GATE-7 (`:889`), the §2.3 family tally row (`:143`), and the §5 ranked rows (`:2379`, `:2407`).
- `06-ux-and-information-architecture/fixed-modular-hybrid.md` — C5-03, written 2026-09-25, provisional lock HYBRID. §3 production aggregate (`:109`, table `:115-124`), interpretation and ceiling (`:126-146`), re-open triggers (`:312`, `:314`), §GAPS (`:336-346`).
- `10-roadmap/rollout-rollback.md` — H-07, gate item 37, draft. RB-1 (`:774`) and the 26-account argument (`:104`).
- `09-security-licensing-cost/cost-model-ai-infra.md` — E-06, `date: 2026-09-02`. The OBSERVATION/INTERPRETATION/RELEVANCE block (`:36-44`), the code price and promo floor (`:274`), the $200 crossover (`:305`), frontmatter `evidence_ceiling`.
- `09-security-licensing-cost/cost-model-data.md` — E-05, `date: 2026-09-02`, for the "no invoice, no console, no contract seen" ceiling (via `00-program-control/EVIDENCE_INDEX.md:63`).
- `12-decisions/DECISION_CARDS_2026-09-26.md` — CARD 15 (`:175-199`), **CARD 16** (`:203-223`), **CARD 17** (`:227-260`), CARD 18 (`:262-276`), CARD 20 (`:349-384`), **CARD 21** (`:388-432`), and the owner-only table (`:436-449`).
- `12-decisions/DECISION_CARDS_2026-09-25.md` — **CARD 1** (`:11-63`), for the CP4 bar that was a forecast and the 200+-session base-rate finding (`:40-45`).
- `00-program-control/MASTER_CHECKLIST.md` — row 35 (item 35, gate 21, owners A-02/H-06, NOT STARTED) and rows 16, 20, 22, 23, 24, 25, 34, 36, 37.
- `00-program-control/CRITICAL_PATH.md` — CP-02 (`:8`), CP-03 (`:9`), CP-04 (`:10`), CP-05 (`:11`), CP-06 (`:12`), CP-07 (`:13`), CP-08 (`:14`), CP-11 (`:17`).
- `00-program-control/RISK_REGISTER.md` — **R-18** (`:24`), verbatim, including its owner field naming A-02.
- `00-program-control/OWNER_INPUTS_REQUESTED.md` — **OI-01** (`:9`), **OI-10** (`:18`), **OI-21** (`:34`, ANSWERED-BY-MEASUREMENT 2026-09-14, with the five populations and the F-B-1 retraction), and the OI-21 summary row (`:51`).
- `00-program-control/GOVERNING_PRINCIPLES.md:78` (the $7 weekly promo, the one-paid-tier seed, `FREE_PAGES` correction DL-010), `:106` (gate item 21 — shared by items 25, 28, 35, 36, 37), **`:113` (the MVP definition)**; `00-program-control/charter/OWNER_SEED_FACTS.md:61`.
- **The MVP sentence, in all four places it appears identically:** `GOVERNING_PRINCIPLES.md:113`, `charter/A-one-week-constraint.md:936`, `charter/B-execution-operating-system.md:1116`, `charter/C-master-directive.md:1409`; provenance `charter/PATCH_LEDGER.md:114`.
- `00-program-control/COMPLETION_AUDIT.md:724-725` (id COMPLETION-AUDIT, `date: 2026-09-21`) — the in-pod read giving *"48 distinct `pref_key` values, 184 rows, 21 members. The rail sees 26."*
- `verification/2026-09-14/OI-06-telemetry-derived-defaults.md:3-8`, `:22`, `:26`, `:68` — ⭐ **the only direct in-pod population read taken by this programme**: 29 users (6 admin · 23 member), `/data/auth.db` at 377,577,472 bytes, **13 users with any `page_views` row**, the *"n = 13. That is a listing, not a statistic"* caveat, the admins-only session-opener ordering, and the 4,949-row count; plus the *"Two databases, identical filename, an 800× difference"* warning.
- `01-existing-system/flags-and-entitlements.md:203`, `:227`, `:382`, `:545`, `:557` — `COMING_SOON_MODE` as a two-sided flag, *"not gate-shaped"* and invisible to the ledger; the absence of any consent or opt-in mechanism on `page_views`; and that document's own inability to confirm the flag is set.
- `09-security-licensing-cost/cost-model-data.md` (E-05, `date: 2026-09-02`) — `:101` (~$830/mo as-is, ex-AI), `:290` (the $200/$2,000 price as a **CLAIM** grepped from `Pricing.jsx:6`), `:292-298` (the break-even table: 19/36/36 at p = 100 %, **196**/366/421 at p = 10 %), `:302-304`, `:310`, `:386`, `:10` and `:21` (*"Nothing in this file is a measured spend"*).
- `09-security-licensing-cost/cost-model-ai-infra.md` (E-06) — additionally `:48` (the `N × allowance + scheduled reserve` recommendation), `:327` (the $6/member/month at a 3 % share), `:434` and **`:440` (OI-E06-04, new and unanswered)**.
- `10-roadmap/2026-09-23-one-week-execution-roadmap.md:53-64` — *"'Live' and 'launched' are two different decisions"*, and *"what's the revenue path that justifies it at today's member count."*
- `13-executive-synthesis/executive-questions.md` (`date: 2026-09-02`) `:36` — the business row, **0 green of five questions** (Q36–Q40).
- ⚠️ `OWNER-ACTIONS.md:129-134` (the staff-cohort statement) and `:189-201` — **the latter cited only as a stale second authority** carrying the vetoed two-paid-tier default; CARD 17 is the authority.
- `12-decisions/DECISION_CARDS_2026-09-26.md:146-147` (CARD 13, the staff-cohort ceiling stated as a ruling) — in addition to the cards listed above.
- `05-product-strategy/anti-patterns.md:505-510` — **INST-4**, *"A definition of done that a healthy system fails"*, the anti-pattern this document is named against; plus `:63-65` and `:2476-2477` on the programme having *"26 production members and no seat model."*
- `00-program-control/RISK_REGISTER.md:24` (R-18) and `:25` (R-19, the session-limit constraint that bounds any long measurement window on this box).

**Read READ-ONLY in `C:\Users\Patrick\uct-worktrees\_merge-master` (two source reads, both reads and neither a run):**
- `tools/bars_warmth_audit.py` — opened. 121 lines by `wc -l`. `WARM`/`COLD` at `:27-28` confirming `stale-swr` in COLD; the warm p95 line inside `if warm_ms:` at `:109-112`; the cold branch printing `p50` and `max` at `:113-116`.
- `api/services/compass_eval/` — directory listed (`checks.py`, `golden_set.json` 64,181 bytes, `golden_set.py`, `judge.py`, `runner.py`, `store.py`, `test_golden_set.py`) and `grep -rn "RUNG_BARS"` confirming its declaration at `golden_set.py:16` and its consumers.
- `CLAUDE.md` — `:2559-2561` (26 production users, 21 subscriptions, 143 MB, measured 2026-09-12, `COMING_SOON_MODE`, and the ⚰️ warning that the ~20,640-user figure is the dev box); `:5477-5482` (reads the artifact never a counter; `_FAIL_STREAKS`; do not persist the counter); `:5484-5487` (the grace window and "muted within a week"); `:5501` (`_GRACE_SECS` 10800); and the shipped cost caps at `:4443` (`COT_NARRATIVE_DAILY_CAP` 300/UTC day), `:4517` ($5/day ET-day theme-engine cap, `engine_cost_log`), `:5106` and `:5110` (`catalyst_cost_log`; $8/day soft, $15/day hard).
- ⚠️ **The `CLAUDE.md` in THIS worktree was not used for any claim.** Its own banner records it as eight facts behind `_merge-master`'s with two actively dangerous assertions, and the harness auto-loads it; every CLAUDE.md citation above is to the `_merge-master` copy.

**Counting over this document's own output** — the only commands run against a file I wrote, recorded in §4.0: `grep -c '^#### \(MQ\|PH\|EQ\|CO\)-'`, a `sort | uniq -d` duplicate-id check over the same headings, and `grep -c '^- \*\*Computable today\.\*\*'`.

**SHA not pinned (no git by instruction).**
