# Compass → World-Class Swing-Trading Mentor — Vision & Build Plan

**Status:** Living document · **Started:** 2026-06-30 · **Owner:** Patrick Gosz
**How to read this:** Sections 1–3 are the *vision* (plain language). Sections 4–6 are the *architecture and plan* (plain language first, with real file names so it's buildable). Section 7 is the *build process*. Sections 8–9 are *open ideas* and *decisions locked so far*. Nothing here is built yet — this is the north star we build against.

---

## 0. The one-sentence summary

Turn **Compass** (the voice + text assistant inside UCT Dashboard) from a shallow "parrot" that can only read back a single number into the **brain and eyes of a world-class swing trader** — a mentor whose **primary lens is technical analysis / chart-reading**, with fundamentals, news, catalysts, and frameworks like CANSLIM woven in as *complementary* layers. It reasons from the firm's own 3,700-entry brain, holds you to your own discipline, watches the market for you and speaks up first, scales from a one-word fact to overnight agentic research, and is available to **every subscriber** — built properly, "trained right," and *proven* on a fixed exam before anyone sees it. The whole thing works as one integrated intelligence — that's the hard, ambitious part, and the point.

---

## 1. The Vision

Today Compass is a **"parrot"**: it can only read back numbers, it's explicitly forbidden from reasoning out of the firm's own playbook, several of its tools are broken stubs, and a plumbing bug can silence it entirely. We turn it into **one mentor with five gears** — the same coach whether you type or talk to it — that scales from a one-line fact (*"quote NVDA"*) up to overnight agentic homework (*"do my pre-market prep and veto my bad trades"*), and that **watches the market and warns you first**.

**Its identity:** the **brain and eyes of a world-class swing trader.** Its **primary lens is technical analysis and chart-reading** — trend, base structure, volume, relative strength, the pattern engine. **Fundamentals, news, catalysts, and frameworks like CANSLIM are *complementary*** — they confirm or complicate the technical read, they never replace it (CANSLIM is one part, not the whole). This is the O'Neil / Minervini / Qullamaggie lineage the firm's knowledge base is already built from. Swing trading is the soul; it answers investing questions competently but never dilutes that identity. Crucially, **all of it works as one integrated intelligence** — the chart, the story, the discipline, the awareness — because that's what a real world-class trader *is*. Building that integrated whole at a world-class level is the hard, ambitious goal, and the point.

**Its personality is adaptive** ("all of the above"): calm and precise when you're analyzing, tough when you're breaking your rules or tilting, a patient teacher when you're learning. The persona *is* the moat — the more unmistakably it is *the firm's voice*, the less replaceable it is by a generic assistant.

**We make it trustworthy three ways:** (1) we **bridge the crown-jewel brain** (the 3,700-entry knowledge base, 48 setup templates, and analysis engine that today live only on Patrick's PC) up to the cloud so every subscriber talks to it; (2) we **force it through the firm's own 6-step trade discipline** so it can never hand anyone a "buy" without first reading the market regime, pinning a stop, and sizing the position; and (3) we **grade every change on a fixed exam of real trader questions** before it ever reaches a paying subscriber.

We build it **foundation-up**, ship every new capability turned **off** behind a switch Patrick controls, and turn it on gradually (Patrick → a beta group → everyone) — with a **30-second undo** he can hit from his phone.

---

## 2. The Capability Ladder (basic → world-class mentor)

**One Compass, five gears.** Each rung is a superset of the one below — same persona, more tools, deeper reasoning, longer autonomy. *Rung 1 answers, Rung 3 has an opinion, Rung 5 does your homework overnight and holds you accountable in the morning.*

### Rung 1 — BASIC: Reads & Facts
Single-fact lookups. One tool call, one number back. No opinion.
> "What's breadth today?" · "Quote NVDA." · "What's the current regime?" · "When does CRWD report?" · "What's my P&L this week?"
- **Needs:** tools already wired (`get_breadth`, `get_quote`, `get_regime`, `get_movers`, `get_my_pnl`, calendar).
- **Great =** lead with the number ("Breadth sixty-five, up eight"), every number tool-backed, never recalled from memory. *This is exactly what the Phase 0 silence bug breaks.*

### Rung 2 — GROUNDED: The Firm's Method
Explaining setups, rules, psychology, methodology **from the 3,700-entry brain and 48 templates** — not generic AI. The biggest single unlock.
> "What exactly is a VCP and how do I grade one?" · "Walk me through our HTF entry trigger and stop method." · "What does Qullamaggie say about trailing a winner vs. O'Neil?" · "Common mistakes on an Episodic Pivot?" · "Our sizing rule in an ORANGE regime?"
- **Needs:** real **semantic search over the brain** (with citations) + exact template lookups.
- **Great =** *"A VCP is a Minervini base with progressive ~50% contractions into a tight pivot; buy-stop 1–2% above the final contraction on 40%+ volume, stop below that low (max 8%). Most common mistake: entering >5% past the pivot. [Source: template VCP, origin Minervini]."* Every claim traceable.

### Rung 3 — OPINIONATED: The Verdict
The mentor voice. One ticker/setup run through the **6-step chain** to a decisive **GO / HOLD / SKIP** with entry, stop, size, and account-risk in one block.
> "DECK breaking out here — call it." · "Grade this setup." · "Where's my stop and how big on ANET?" · "Real PEG or pass?" · "Should I add to my NVDA winner?"
- **Great =** *"Regime YELLOW — QQQ pulling back, leaders holding. DECK is an A- HTF continuation. Entry above 172.40, stop 164 (4.9%), size 15%, account risk 0.7%, first target 1.5R. HTF in YELLOW: 58% over 40 trades. [analog: LITE 2025]."*

### Rung 4 — COMPLEX: Scans, Watchlists & Portfolio Awareness
Composes several tools and applies **the trader's own edge** as a filter.
> "Build tomorrow's watchlist — leading sectors, A-grade setups only, filtered to setups I'm actually good at." · "Which open position is most at risk if QQQ loses 590?" · "What's my portfolio heat — can I add?"
- **Great =** *"Five names survive the regime filter. Top pick FIX (A HTF, leading sector, you're 6-2 on HTF this quarter). Dropped two bull flags — you're 4-11 on those since April. Adding to NVDA puts you at 3.1% heat, over your 2% cap — pass on the add."*

### Rung 5 — WORLD-CLASS MENTOR: Agentic, Disciplined, Proactive
Long-horizon, multi-source, accountability-holding. Runs a research loop, produces a cited thesis, **vetoes bad trades**, and speaks up *first*.
> "Do a full pre-market prep: regime, leaders, my flagged names, ranked plan with entries/stops/sizes." · "Research the AI-datacenter theme end-to-end." · "I want TSLA 30% size" → *Compass refuses out loud and quotes the 2% rule.* · "How am I doing, and the one thing to fix this week?"
- **Great =** *"Three trades in fifteen minutes — your rapid-fire rule just fired. Step away. When you're back: regime GREEN, four A-setups in semis, here's the ranked plan. And no — I won't size you 30% into TSLA; that's 3.1% account risk, cap is 2. Size 12% or pass."*

### At a glance
| Rung | Trader says… | New capability | Runs on |
|---|---|---|---|
| 1 Basic | "Quote NVDA" | Tool-backed facts | Haiku, ~1 tool |
| 2 Grounded | "Explain a VCP our way" | **Semantic search over the 3,700-KB brain** | Sonnet + retrieval |
| 3 Opinionated | "Call this trade" | **6-step chain → GO/HOLD/SKIP + sizing** | Sonnet + verdict |
| 4 Complex | "Build my watchlist, filtered to my edge" | Multi-tool scan + personal-edge filter | Sonnet, agentic loop |
| 5 Mentor | "Do my prep / veto my bad trade" | Long-horizon agentic + discipline veto + proactive | Opus, full stack |

---

## 3. The Signature Capability — the integrated verdict (TA-first)

The mentor's signature move is **"grade TICKER"** — a single, integrated read where the **chart / technical analysis leads** and every other lens confirms or complicates it. TA is the primary eye; fundamentals, news, catalysts, and frameworks like CANSLIM are complementary layers that add conviction or raise flags — never the other way around.

- **The chart read (primary):** trend, base structure, pivots, volume, RS, moving-average stack, the 50-detector pattern engine → *is this a technically clean, in-demand leader setting up?*
- **Relative strength & leadership (technical):** is it leading its group, is the group leading the market?
- **Market direction (the gate):** the regime engine — the "no regime, no trade" rule; a great chart in a bad tape is still a pass or a half.
- **Complementary confirmation:** fundamentals, earnings, catalyst, institutional sponsorship — this is where a framework like **CANSLIM** is *one useful checklist among several* → does the story back the chart?

…delivered as a graded verdict *in the mentor's voice*: *"B+ setup. Technically clean — HTF continuation off the 20-day, RS leading, volume dry on the pullback. Earnings and the catalyst back it. Only knock is the tape — QQQ's under its 20-day, so half size or wait for the market to firm up."* No generic assistant can replicate this — it needs the firm's **brain**, its **eyes** (the chart read), its **data**, and its **discipline** together, as one. **This is the moat, made concrete.**

---

## 4. How we "train it right" & prove it

Four pillars: **grounding**, the **6-step chain**, the **persona rewrite**, and the **report card**.

### 4.1 Grounding — cite the actual playbook, never hallucinate
**Core finding:** there is *no real search* over the brain today — it does SQL exact-word matching, so *"the setup where you buy the first pullback after a big gap"* completely misses *"Episodic Pivot."* We add a **hybrid**:
- **(a) Semantic search for the prose** (3,700 KB entries + 9 methodology bibles): chunk, embed once, store in a vector index, retrieve the most *relevant* passages **with citations**. New tool `ask_the_brain(...)` / `search_knowledge_semantic(...)` — the flagship "kill the parrot" tool.
- **(b) Exact lookup for structured data** (48 templates + win-rates): keep typed tools (`resolve_setup_name`, `get_setup_template`, `get_setup_performance`, `calculate_position_size`).
- **Router:** "teach me / why / compare" → (a); "exact trigger/stop/win-rate/size for setup X" → (b). Rung 3+ uses (b) for numbers, (a) for coaching color.

### 4.2 The 6-Step Trade Reasoning Chain — made unskippable
The chain (`uct_identity_v1.md`): **Pattern → Regime → Risk → Sizing → Synthesis → Recommendation.** We make it structural:
1. **Tool-gated ordering** — Compass *cannot* emit a "BUY" unless a regime tool ran this turn ("no regime, no trade") and a stop came from a tool ("size before entry"). Route trade calls through `validate_trade`/`pre_trade_verdict`, which hard-check regime + stop + account-risk before the AI speaks.
2. **Typed answer schema** for Rung 3+ keyed to the six steps; a missing field is a mechanical failure.
3. **Regime-first guard** — trade question in ORANGE/RED → first sentence is the exposure instruction.
4. **Deeper thinking only where needed** — Rungs 1–2 stay fast/cheap.

### 4.3 Persona rewrite — opinionated on craft, never inventing numbers
Two prompt lines do the damage today (*"You use only data given to you. You do not invent,"* + the *"I don't have that"* reflex). Right for personal numbers, wrongly over-generalized to forbid reasoning from the playbook. Fix = **two lanes**:
> **FACTS & NUMBERS — tool-only, never invented.** Prices, breadth, regime, P&L/positions/win-rates, dates. No tool result → say so. "I don't have that" is correct here.
>
> **CRAFT & JUDGMENT — reason freely from the firm's brain.** Setups, entry/stop logic, psychology, regime playbooks, frameworks. Retrieve, synthesize, *give an opinion*, always naming the source. **Never refuse a craft question because a live-data tool was empty.**
>
> **When they meet (a trade call):** numbers from tools, the *read* from the playbook. Thin coverage → say so; thin ≠ empty.

Plus: repair the broken stub tools; **unify voice and text-chat** so the same question gets the same grounded answer on both surfaces.

### 4.4 The Report Card — prove it before subscribers see it
*A fixed exam of real trader questions, auto-graded on four things — was it right, did it cite the playbook, was the opinion any good, and was it safe.*
- **Golden set:** 100–200 real questions tagged by rung, each with required KB sources, required tool calls, and forbidden claims (e.g. "no size without a stop"). Seeded from real chat questions + adversarial traps (empty-tool, regime-RED trade request, "size me 30%," setup that fits no template).
- **Rubric (0–4 each):** Correctness · Grounding/Citation · Opinion quality (decisive, sized, regime-first) · Safety/Discipline (2% cap, veto, tilt rules, never fabricated numbers).
- **Graded by** a cheap AI judge **+ hard mechanical checks** (did the required tool actually run? does every cited source exist? is there a stop before a size?).
- **Gates the deploy:** a change that drops any rung below its bar, or breaks a safety item, blocks the release. Trend line stored over time.
- **The exam grows:** worst-scoring live answers each month become next month's questions.
- **Reuses existing rails:** `voice_hallucination_audit.py`, `voice_self_qa.py`, `voice_drift_detector.py`, `voice_feedback_service.py`.

---

## 5. Architecture

### 5.1 The One-Brain Cloud Bridge
**Key discovery:** the crown-jewel brain is structurally unreachable from the cloud today — its database is gitignored on Patrick's PC, there's no server in front of it, and **the cloud connector (`api/routers/intelligence.py`) is already wired up but points at a folder that doesn't exist on Railway**, so in production it silently returns empty. *The plumbing is ~80% built and 0% live* — and that empty is a root cause of "I don't have that."

**Simplifying insight:** the brain is **shared, read-only firm knowledge** — identical for every subscriber (each user's journal/positions/discipline already live in separate, already-scoped tables). So the bridge only has to move one shared, slow-changing library to the cloud.

**Recommended path:** ship the brain as a nightly **"Brain Pack"** — a pruned, read-only copy of the relevant DB tables — up to Railway over the *same R2 snapshot rail that already ships price bars daily*. The cloud already vendors the brain's *code* as a git submodule; point it at the shipped file with one env var and the dead `intelligence.py` wrapper lights up unchanged — the whole 90-function engine + `AnalysisService` run in the cloud with zero re-implementation. Then **embed the 3,700 KB entries** into the existing vector store for semantic search. Live regime/breadth keeps flowing over the current push rail.
- *Rejected alternatives:* home-PC tunnel (dies when the PC sleeps — disqualifying for a paid product; keep only as an admin/debug side-channel); re-serializing into new cloud tables (permanently re-implements and diverges from the real engine — the exact disease we're curing).
- *Cost:* structured tools are local DB reads (~$0, flat at any subscriber count). Only `ask_the_brain`/`assess_the_regime` cost an AI call, and only when *reasoning* (not data) is asked for.

### 5.2 The new Compass tools
Every tool wired in **three places** (voice impl + schema, voice allowlist, text-chat registry) through **one shared façade** (`brain_service.py`) so voice and text can never diverge again.

| New tool | Backed by | What the mentor does |
|---|---|---|
| **`ask_the_brain(question, ticker?)`** | KB semantic search + `AnalysisService.ask` | **The flagship.** Grounded, cited reasoning from the 3,700-entry brain. Kills the parrot. |
| **`lookup_playbook(setup_name)`** | `resolve_setup_name` → `get_setup_template` + win-rate | Entry/stop/invalidation/common-mistakes for any of the 48 setups. |
| **`size_a_trade(entry, stop, account?, regime?)`** | `calculate_position_size` + regime table + heat check | Risk-first sizing: shares, position %, account-risk %, regime-capped. |
| **`pre_trade_verdict(...)`** | `generate_pre_trade_checklist` + the real GO/HOLD/SKIP engine | Structured go/no-go before committing. |
| **`setup_winrate(setup, regime?)`** | `get_setup_performance` | "Does this setup work in *this* tape?" with sample-size confidence. |
| **`find_historical_analogs(...)`** | `get_historical_analogs` | "When has this fired before in this regime — what happened?" |
| **`assess_the_regime()`** | `AnalysisService.assess_regime` | Opinionated regime read → exposure + setup-selection guidance. |
| **`score_setup_confidence(...)`** | 6-component scoring (A+…F) | Grades an idea before commit. |
| **`get_model_example(...)`** | Model Book graded case studies | "Show me a textbook HTF." |
| **`portfolio_heat()`** | risk engine + open positions | "Am I too exposed to add?" |

### 5.3 The Agentic Layer — one engine, two surfaces
Compass runs **two loops** (OpenAI Realtime for voice, a server-side Anthropic loop for text). Rather than make the voice model orchestrate a 15-step plan over the audio channel, add **one shared server-side engine both loops delegate heavy work to.** Every request resolves to one of four tiers:

| Tier | Example | How it runs |
|---|---|---|
| **T0 Reflex** | "am I in anything?" | Pre-loaded session state — no tool call |
| **T1 Single tool** | "what's breadth?" | One read → narrate (Haiku, <1.5s) |
| **T2 Guided** | "should I short TSLA here?" | 2–5 tools in one turn → synthesize (Sonnet, 2–6s) |
| **T3 Delegated** | "scan sectors, build a watchlist, walk me through it" | Hands off to the Planner–Executor engine; instant ack, delivers async |

Rungs 1–2 = T0–T2, Rung 3 = T2, Rungs 4–5 = T3. The **T3 engine** (`api/services/agentic/task_runner.py`) is a *plan → parallel-execute → synthesize → confirm → deliver* loop reusing existing primitives (tool dispatch, the scratchpad as a "blackboard," audit/recovery hooks). Trade calls in the synthesis step route to the real verdict engine.
- **Voice UX for long jobs:** immediate spoken ack ("On it — scanning leading sectors, ~twenty seconds"), free the mic, then inject the result back into the live session so it speaks the answer while the full watchlist renders on screen.
- **Reads auto-run; writes are always gated.** A multi-write job confirms once via a single plan manifest (not 16 prompts) and executes all-or-nothing; discipline/position writes + the risk veto always get their own confirm.
- **Fix the `{ok}` envelope default** (currently defaults to "success," hiding failures) so the fallback ladder fires and broken tools surface as broken.
- **Cost by tier:** Haiku for reflex/simple, Sonnet for planner/synthesis, Opus/deep-research **only on an explicit "deep" ask**; prompt-cache the shared playbook; run eval grading through the 50%-off batch API.

### 5.4 The Awareness Engine — proactive / "it watches and warns you"
**Good news:** most of the proactive machinery already exists — an insights pipeline (`voice_proactive_service.py`), a morning briefing (`voice_briefings_proactive.py`), tilt detection (`interventions.py`), drift detection (`voice_drift_detector.py`), a "Compass noticed" tile (`CompassTodayTile.jsx`), and multi-channel alert fan-out (`watchlist_alert_service.deliver_alert_payload` → in-app + email + Discord). **It was switched off for cost on 2026-05-18** (`COMPASS_AUTOMATION_ENABLED=0`). So this is mostly *turn on + sharpen*, not build-from-scratch.

**Design:** a new `api/services/awareness/` module is a *producer* of `voice_proactive_insights` rows; all existing delivery surfaces consume them unchanged. **One shared market scan per cycle → per-user filter** (the proven `calendar_alerts.py` / `catalyst/engine.py` idiom: compute market-wide once, bulk-load each user's tickers, intersect, atomic-dedup-fire).

**Watch rules** (each a pure function `(scan, user) → optional insight`): position nearing/at stop (R1/R2), watchlist name triggering a liked setup (R3), regime flip → risk action (R4), earnings proximity on owned/watched (R5), leading sector rotating in (R6), catalyst on owned/watched (R7), tilt/behavior firing (R8), big move on a name you care about (R9), user technical alerts (R10).

**Anti-noise ("only tell me if it matters"):** every candidate gets a deterministic **relevance score** (base signal × personal multiplier [own it? watch it? liked setup? favorable regime?] × novelty × urgency − dismiss-penalty) that becomes the `importance`, then hard **daily caps + per-symbol cooldowns + per-kind sub-caps** apply. **It learns:** what you act on gets louder, what you dismiss goes quiet (`awareness_preferences` table, consolidated nightly). *Default posture: calm/surgical — a sharp desk-mate, not a notification bot.*

**Delivery:** (A) spoken at session start + unprompted when importance ≥ 7 (both exist); (B) a persistent grouped, dismissible **"Here's what I noticed" feed** (upgrade `CompassTodayTile`); (C) **push-when-away** — interim via existing email/Discord for importance ≥ 8, real web-push (VAPID/pywebpush + a `push` handler in `app/public/sw.js`) as a later milestone (the PWA is already installable; push is the one genuinely new piece).

**Biggest real gaps today:** nothing watches **your stops** (data exists in `j2_positions`; beware broker rows carry a placeholder `stop_price = entry_price`); no **regime change-memory** (regime recomputes on read but never snapshots the prior label, so it can't say "just flipped"); no **web push**.

**Proactivity ladder:** basic (threshold pings, mostly exists) → advanced (context/setup-aware, personalized, ranked — the core milestone) → world-class (connects multiple signals into one *because-you* mentor note tied to your rules and stats).

**First milestone (dark-launchable, ~90% reused plumbing):** watch **stops (R1/R2) + earnings-proximity (R5) + regime-flip (R4)**, write via existing `add_insight`, upgrade the tile feed, away-delivery via existing email/Discord. Gated behind `COMPASS_AUTOMATION_ENABLED` + a new `AWARENESS_ENGINE_ENABLED`, both default-off.

---

## 6. The Phased Build Plan

Effort is relative (S/M/L/XL) — shape and dependencies, not a schedule. Every phase merges *flag-off* and climbs the rollout ladder (§7).

- **Phase 0 — Stop the silence & the parroting** *(S–M, do first, highest ROI).* Fix the silence bug in `realtimeEventHandlers.js` (still uses old *beta* OpenAI event names after the app moved to the new *GA* endpoints → tool results never round-trip → voice goes silent; blocks everything). Fix the `{ok}` envelope in `voice_dispatch.py`. **Milestone:** talk locally → tool runs → spoken answer. Also proves the whole dev→flag→rollout loop on something tiny.
- **Phase 1 — Bridge the brain to the cloud** *(L–XL, the crown-jewels lift).* Add the env override + nightly **Brain Pack** export over the R2 rail; **light up `intelligence.py`**; build `brain_service.py` and wire structured tools (`lookup_playbook`, `size_a_trade`, `setup_winrate`) then `ask_the_brain` + the semantic index. **Milestone:** in production, an admin gets a real graded answer from the 3,700-entry KB. *(Patrick pastes `ANTHROPIC_API_KEY` into Railway.)*
- **Phase 2 — Make it a mentor** *(M–L).* Ship the two-lane persona rewrite, wire the 6-step chain as an enforced scaffold, repair orphaned/stub tools, reach voice↔text parity, stand up the **report card** and gate deploys on it. **Milestone:** the eval set clears the bar; a beta cohort uses it for a week with positive feedback.
- **Phase 3 — Maximum agentic + full awareness** *(L–XL).* Build the Planner–Executor engine + async voice ack/deliver + plan-level one-shot confirm; turn on and sharpen the **Awareness Engine**; wire the untapped dashboard engines (Model Book, real Pre-Trade Verdict, GEX, tilt interventions, earnings recaps); add web-push. Hard budgets land here (steps-per-task + tasks-per-user-per-day caps, global daily circuit-breaker, per-user token meter). **Milestone:** Compass completes a real multi-step job end-to-end within cost caps, and watches stops/earnings/regime for a cohort.

*Chart/screenshot reading (multimodal "grade this chart") lands in Phase 2–3 — after the foundation, per owner decision.*

---

## 7. Build Process & Division of Labor

**The one thing to internalize:** on this project, **`master` = the live app** — the moment code lands there, Railway ships it to every paying subscriber. So safe rollout = two disciplines: **never build on `master`** (branch → prove → merge), and **merging ≠ launching** (every capability lands *turned off* and switches on gradually).

**Local sandbox already exists:** `run-local.ps1` gives a two-window stack (backend + hot-reloading frontend); the first account you sign up with becomes admin. Patrick can **talk to Compass exactly as a subscriber would, on his own machine, touching nothing live.**

**Every capability climbs the same rollout ladder, and can fall back a rung in seconds:**
| Rung | State | Who sees it |
|---|---|---|
| 1 | Merged, flag off | nobody |
| 2 | Admin-only | Patrick + test accounts |
| 3 | Beta cohort | a hand-picked group |
| 4 | All paid subscribers | everyone paying |
| 5 | Default-on in code | everyone, permanently |

**Rollback = flip one environment variable in the Railway dashboard — ~30 seconds, from a phone, no code, no rebuild.** (A master kill switch, `COMPASS_CHAT_ENABLED=false`, already exists.) *Nothing we turn on can't be turned off instantly.*

**Guardrails for financial content** (the "context-dependent" decision, baked in): **opinionated** on process/setups/discipline/risk; **neutral** on raw data/research; **never** a naked dollar call (position size only ever appears wrapped in risk framing); a persistent "educational, not financial advice" disclaimer; every opinionated answer logged. A weekly plain-English "Compass Health" email to Patrick: tool-failure rate, cost/user, top questions, thumbs-down answers.

### Who does what
| Area | Claude Code does | Patrick does |
|---|---|---|
| Code / bugs / bridge | Writes all code, fixes bugs, wires tools, ships the Brain Pack | Never touches code or git |
| Tests / evals | Writes & runs the suite + report card; keeps them green | — |
| Flags | Adds them (default-off) + documents each + its rollback trigger | **Flips flags in Railway** at each go/no-go; hits the kill switch if worried |
| Testing | Automated verification | **Acceptance-tests by talking to it**; says "good / not good" |
| Secrets | Says exactly which key + where | **Pastes API keys into Railway** |
| Business / IP | Recommends, implements | **Decides:** brain exposure, disclaimer wording, beta cohort, pricing/tiers |
| Rollout | Prepares each rung + criteria | **Approves each rung** (go/no-go) |

*One line: Claude builds and proves; Patrick approves, tests by talking, pastes keys, flips flags, and makes the money/IP/liability calls. He never needs a terminal.*

---

## 8. Open Ideas & Decisions to Keep Exploring
- **Brain-bridge shape:** recommendation is the nightly Brain Pack (full engine, reuses the bars rail). Alternative to revisit at scale: a dedicated brain micro-service. *Decide first — unblocks everything.*
- **Model standardization:** the code pins older model versions in places; standardize on current gen (Haiku/Sonnet/Opus) and route by rung. Low-risk cost/quality upside.
- **Chart/screenshot grading:** multimodal chart reading is a natural Rung-3 superpower — scoped for Phase 2–3.
- **Subscriber "study mode":** the brain is a world-class teaching library; Compass could run guided lessons on the methodology — retention/upsell lever, exercises the exact grounding we're building.
- **Meet-each-subscriber-at-their-level:** same brain, different delivery — more teaching for beginners, terse verdicts for pros.
- **Personal-edge filter depth:** how aggressively should Compass refuse to pitch setups you lose on? Great discipline, but can feel paternalistic — tune with the beta cohort.
- **The feedback flywheel:** wire real thumbs-down answers straight into next month's golden set so the exam — and the mentor — compound.
- **Liability wording & beta cohort:** Patrick's calls.
- **Pricing the agentic tier:** T3 overnight-research jobs are the expensive premium capability — candidate for a higher plan tier.

---

## 9. Decisions Locked So Far (owner)
- **Audience:** all subscribers (multi-user product) — needs guardrails, per-user cost controls, personalization.
- **IP:** full proprietary brain bridged to the cloud for all subscribers.
- **Style:** context-dependent — opinionated coach on setups/discipline, neutral for pure research/data.
- **Cost:** balanced — powerful, but expensive tools used judiciously.
- **Autonomy:** as capable/agentic as possible ("a full intelligent layer for traders and investors").
- **Identity:** the brain + eyes of a world-class swing trader. **Technical analysis / chart-reading is the PRIMARY lens**; fundamentals, news, catalysts, and frameworks like CANSLIM are *complementary* (CANSLIM is one part, not the whole). It all works as **one integrated intelligence**.
- **Personality:** adaptive (calm analyst / tough when rules break / patient teacher).
- **Chart-reading:** yes, but after the foundation (Phase 2–3).
- **Proactive intensity:** calm/surgical by default; earns the right to speak; learns and quiets.
- **Build approach:** foundation-up, "trained right" (grounding + 6-step chain + report card), flag-gated gradual rollout.

---

## 10. The 3–4 highest-value things to nail down / prototype next
1. **Ship Phase 0 (silence + `{ok}` fix) end-to-end** — the bleeding wound; small, contained; proves the whole branch→flag→admin→all-subscribers loop. Nothing is visible until the voice round-trip works.
2. **Decide the brain-bridge (recommend nightly Brain Pack) + paste `ANTHROPIC_API_KEY` into Railway** — unblocks Rungs 2–5. Fastest proof: light up the already-built-but-dead `intelligence.py`.
3. **Prototype `ask_the_brain`** (semantic search over the 3,700-entry KB → cited answer) — the flagship "kill the parrot" demo. The moment it answers "teach me a VCP" with a cited, opinionated answer instead of "I don't have that," the vision is real and testable.
4. **Stand up the report card v1** (a first golden set + the four-axis rubric) so every change from here is graded before subscribers see it.

*This is a living plan — we iterate on it as each milestone lands.*
