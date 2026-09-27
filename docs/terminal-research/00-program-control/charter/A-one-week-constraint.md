# PROMPT 2 — ONE-WEEK DEADLINE / EXECUTION CONSTRAINT (DOCUMENT A, PATCHED 2026-09-01)

## SEND THIS FIRST IN THE REAL EXECUTION SESSION (or commit it as `00-program-control/charter/A-one-week-constraint.md` and have the execution command read it)

# CRITICAL PROGRAM CONSTRAINT — ONE-WEEK DEADLINE WITHOUT REDUCING QUALITY

There is an important additional constraint on this initiative:

## We have approximately ONE WEEK of program days to complete the research, discovery, synthesis, architecture, prioritization, and implementation-ready planning phase.

"Day N" in this document means PROGRAM DAY N as defined in Document B §3A: a counter the orchestrator advances when that day's objective and checkpoint are complete, not a calendar day. Several sessions may make up one program day.

Treat this as a real executive deadline.

However, do **not** interpret the deadline as permission to:

* conduct shallow research
* skip important benchmark products
* reduce the evidence standard
* ignore the existing codebase
* skip provider/API discovery
* skip licensing analysis
* skip red teaming
* make unsupported architectural assumptions
* prematurely converge on the first attractive idea
* generate generic conclusions merely to declare the project complete

Shallow research is different from ceiling-limited research. When primary sources are inaccessible, recording the evidence ceiling honestly (Document C, Part XII) is rigor. Inferring a confident answer to hide the ceiling is the corner-cut.

The objective is:

> **Reduce elapsed time, not intellectual rigor.**

We should achieve the deadline primarily through:

* massive parallelization
* intelligent agent specialization
* clear ownership
* narrow research missions
* concurrent internal and external research
* continuous synthesis
* rapid escalation of blockers
* deliberate research prioritization
* strict avoidance of duplicate work
* early identification of critical unknowns
* aggressive context management
* disciplined documentation
* fast decision cycles

Do not achieve the deadline by cutting corners.

---

# OPERATING PHILOSOPHY FOR THE SEVEN-DAY PROGRAM

This should operate more like a high-intensity institutional product war room than a sequential research project.

Do **not** operate like this:

```text
Research Bloomberg
      ↓
Finish Bloomberg
      ↓
Research FactSet
      ↓
Finish FactSet
      ↓
Audit codebase
      ↓
Think about product
      ↓
Think about architecture
      ↓
Create roadmap
```

That would take far too long.

Instead operate approximately like this:

```text
                    PROGRAM ORCHESTRATOR
                           |
          +----------------+----------------+
          |                |                |
    INTERNAL AUDIT    COMPETITOR RESEARCH   DOMAIN RESEARCH
          |                |                |
          +----------------+----------------+
                           |
                  CONTINUOUS SYNTHESIS
                           |
          +----------------+----------------+
          |                |                |
      PRODUCT         ARCHITECTURE       RED TEAM
          |                |                |
          +----------------+----------------+
                           |
                  IMPLEMENTATION PLAN
```

Everything that can safely occur concurrently should occur concurrently.

---

# APPROXIMATELY 100 AGENTS MEANS COVERAGE, NOT TOOL-LIMIT VIOLATION

The overall research organization is intentionally designed around approximately 100 specialized roles.

Do not interpret this as a requirement to have 100 processes running simultaneously if the environment cannot safely support that.

If Claude Code's actual concurrency or subagent limits are lower:

* preserve the COVERAGE MAP (every research question mapped to one owning role, Document C Part X); fewer well-designed roles that cover the map are acceptable, and any merge or split is logged in `DECISION_LOG.md`
* execute agents in waves
* use the maximum safe parallelism available, measured by the capability probe (Document B §8) and recorded in `AGENT_REGISTRY.md`
* recycle agent capacity as assignments finish
* prioritize critical-path work
* preserve role specialization
* do not fabricate results from agents that were never actually run

The goal is the intellectual coverage of a roughly 100-person organization, not a literal concurrency number.

---

# DO NOT WAIT FOR PERFECT INFORMATION

There is an important difference between:

**premature decision-making**

and

**progressive synthesis.**

We should avoid premature decisions.

But we should absolutely perform progressive synthesis.

As soon as sufficient evidence emerges, begin recording:

* repeated patterns
* important differences
* likely opportunities
* architecture implications
* potential blockers
* unanswered questions

Do not wait until all research roles finish before beginning synthesis.

That would waste the primary advantage of parallel research.

---

# CONTINUOUS SYNTHESIS MODEL

Research should flow through the system continuously.

Use a pipeline similar to:

```text
RAW RESEARCH
     ↓
POD SYNTHESIS
     ↓
CROSS-POD SYNTHESIS
     ↓
EXECUTIVE SYNTHESIS
     ↓
PRODUCT / ARCHITECTURE IMPLICATIONS
```

As soon as agents finish useful work, integrate it.

This allows later agents to investigate the questions created by earlier findings.

The backbone of progressive synthesis is the forty executive questions in Document C, Part CLXXXV: drafted with confidence tags by the end of Day 2 and revised at every checkpoint, alongside the hypothesis register (Part CLXIX).

---

# RESEARCH WAVES RATHER THAN ONE MASSIVE PASS

Do not send 100 agents into the wilderness and wait for all of them to return.

Use waves.

## WAVE 1 — LANDSCAPE

Purpose:

Understand the broad terrain quickly.

Launch large parallel research across:

* existing codebase (all repositories and both machines, Document C Part IIIA)
* current data providers
* Bloomberg
* benchmark terminals
* major workflow categories
* UX patterns
* AI capabilities
* data architecture
* licensing and data rights (this pod starts in Wave 1 because its findings change scope)

The first wave should reveal:

* what we know
* what we thought we knew but were wrong about
* what matters most
* where evidence is weak
* where deeper research is required

---

# WAVE 2 — TARGETED DEPTH

After Wave 1, do not repeat broad research.

Redirect agents toward the highest-value unknowns.

Examples:

* exact Bloomberg workflows
* Gödel Terminal capabilities
* provider licensing restrictions
* current UCT search architecture
* workspace-state architecture
* estimates-data availability
* real-time news infrastructure
* proprietary UCT intelligence
* likely performance bottlenecks
* the tools the desk actually opens today

Wave 2 should increase depth where depth matters.

Wave 2+ contracts carry a KNOWN FACTS block pointing at Wave 1 artifacts so nothing is re-derived.

---

# WAVE 3 — VALIDATION

Critical conclusions should then receive independent challenge.

Validate:

* strategic recommendations
* major architectural decisions
* expensive data-provider recommendations
* licensing assumptions
* MVP scope
* highest-priority workflows

This is where skeptical and red-team agents become especially important.

---

# WAVE 4 — FINAL SYNTHESIS

By this point, research should transition heavily toward:

* product decisions
* architecture
* prioritization
* roadmap
* engineering backlog
* implementation readiness

Do not continue indefinitely researching increasingly obscure competitor features simply because agents are available.

Research must ultimately serve decision-making.

---

# SEVEN-DAY OPERATING CADENCE

Treat the following as a planning framework rather than rigid clockwork.

Adjust based on evidence, but preserve the urgency.

The authoritative first-action sequence is Document B, "YOUR FIRST ACTION". Day 1a below restates it only at the level of objectives.

## DAY 1 — ORIENTATION + MASSIVE DISCOVERY

Primary objective:

**Understand the battlefield.**

### Day 1a, before owner approval of the orientation memo (all read-only, zero production risk):

* persist the charter and create program control (Document B, Step Zero, §3A)
* run the capability probe and record safe concurrency (Document B §8)
* orient in the repositories and out-of-repo infrastructure (Document C Part IIIA)
* build the role map and coverage map
* dispatch internal discovery Wave 1 and the licensing pod
* draft the critical path
* produce the orientation memo (Document C Part CLXXIX) and stop the turn

### Day 1b, on approval:

* dispatch external research Wave 1 (Bloomberg workflow roles, one dossier agent per product, Gödel evidence collector, pods C4/C5/C7)
* first pod syntheses as leaf files land
* create the initial capability taxonomy
* create the initial provider ledger
* first `OWNER_INPUTS_REQUESTED.md` batch (Document C Part CLXXX)

By the end of Day 1 we should not know everything.

But we should know enough to see where the major unknowns are.

Required Day 1 artifact, due at the end of Day 1b:

### `DAY_1_EXECUTIVE_SYNTHESIS.md`

It should explain:

* what was discovered
* important existing UCT capabilities
* major competitor patterns emerging
* surprising findings
* potential strategic opportunities
* major research gaps
* where agents should focus next

---

## DAY 2 — DEEP RESEARCH + INTERNAL MAPPING

Primary objective:

**Turn landscape awareness into evidence.**

Continue competitor teams.

Deepen:

* Bloomberg
* Gödel
* best differentiated benchmarks

Complete substantial mapping of:

* APIs
* providers
* database
* front end
* backend
* streaming
* search
* alerts
* watchlists
* Terminal-Current (the calendar surface)
* AI
* proprietary UCT systems
* scheduled jobs on both machines

Begin constructing:

* capability matrix
* provider matrix
* workflow library
* UCT proprietary advantage inventory

Produce the first draft of the forty executive questions (Document C Part CLXXXV) with confidence tags.

Run a light red-team pass on the emerging benchmark findings (Document C Part XCVII gate 1).

Do not wait for perfection.

---

## DAY 3 — WORKFLOW + OPPORTUNITY SYNTHESIS

Primary objective:

**Determine what actually matters.**

Shift significant agent capacity from broad research into synthesis.

Identify:

* highest-value trader workflows
* highest-value investor workflows
* highest-value member workflows
* competitor best practices
* UCT-specific opportunities
* obvious non-goals
* likely signature features

Begin scoring capabilities.

Begin answering:

> What should Terminal-Next actually be?

This is a critical transition from research toward product strategy. The gate for that transition is in Document B §27A: product decisions may begin when every Tier-1 question in `CRITICAL_PATH.md` is at medium confidence or higher, or is explicitly marked owner-input or unknowable-this-week.

Run a light red-team pass on the emerging prioritization (Part XCVII gate 2). Second `OWNER_INPUTS_REQUESTED.md` batch.

---

## DAY 4 — PRODUCT ARCHITECTURE + TECHNICAL ARCHITECTURE

Primary objective:

**Translate evidence into a coherent system.**

Develop candidate architectures for:

* information architecture
* Terminal shell
* security context
* workspace model (evaluate fixed, modular, and hybrid with equal rigor, Document C Part XXI and CCVII)
* command/search
* data access
* canonical entities
* real-time updates
* AI
* persistence
* entitlements
* observability

Architecture must be grounded in the existing codebase.

Run competing architectural proposals where uncertainty is high.

Do not prematurely select the most complicated architecture.

In parallel, the implementation-planning roles draft skeleton specifications for the two or three leading vertical-slice candidates, so Day 6 completes rather than starts them.

---

## DAY 5 — RED TEAM + ROADMAP

Primary objective:

**Try to break the plan.**

Launch intensive criticism (the heavy red-team pass; gates 3–5 of Part XCVII).

Challenge:

* product complexity
* assumptions
* costs
* data rights
* architecture
* performance
* maintainability
* member usability
* differentiation
* MVP scope

Then revise.

Create:

* Tier S/A/B/C/D/X capability priorities
* MVP recommendation
* first vertical slice
* dependency graph
* coexistence strategy
* migration gates

---

## DAY 6 — IMPLEMENTATION-READY PLAN

Primary objective:

**Convert strategy into executable engineering work.**

Complete the detailed:

* technical specifications
* engineering work packages
* task IDs
* dependencies
* code impact maps
* APIs
* schema changes
* component plans
* tests
* observability
* feature flags
* rollout
* rollback

Another Claude Code implementation team should be capable of beginning development using these documents.

---

## DAY 7 — FINAL VALIDATION + EXECUTIVE MASTER PLAN

Primary objective:

**Finish with conviction, not exhaustion.**

Do not use Day 7 to discover the entire strategy for the first time.

Day 7 should primarily involve:

* filling remaining critical gaps
* validating citations/evidence
* eliminating contradictions
* resolving architectural ambiguity
* reviewing provider/licensing risks
* pruning roadmap
* verifying coexistence plan
* final red-team pass
* running the READINESS TEST and the PROTECTION RAIL (Document B §49, items 25 and 26) and fixing what they find
* preparing owner decision memo
* assembling final master plan

Final output:

# UCT TERMINAL — INSTITUTIONAL PRODUCT & ENGINEERING MASTER PLAN

plus all supporting artifacts.

---

# DAILY CHECKPOINTS ARE REQUIRED

At the end of each major work period, update the program-control files (the list in Document B §5), including `RESUME.md`.

Maintain a concise executive checkpoint:

### Progress

What major portion of Phase Zero is complete?

### Important discoveries

What changed our understanding?

### Decisions forming

What direction appears strongest? Cite the confidence drift of the forty executive questions.

### Critical unknowns

What could still materially change the plan?

### Blockers

What needs immediate attention? What is waiting in `OWNER_INPUTS_REQUESTED.md`?

### Agent allocation

Where should research capacity move next?

### Protection rail

Passed or failed (Document B §14A).

### Deadline health

Are we on track for the seven-day target?

Do not wait until Day 6 to realize the program has drifted.

---

# DEADLINE HEALTH SYSTEM

Track the project using:

## GREEN

Research and synthesis are progressing sufficiently to meet the deadline without reducing scope or quality.

## YELLOW

Important work is lagging.

Respond by:

* reallocating agents
* increasing parallelism
* eliminating duplicate work
* narrowing low-value investigation
* escalating targeted research

Do **not** immediately reduce quality.

## RED

Critical-path discovery threatens the deadline.

Identify the exact bottleneck.

Examples:

* codebase ambiguity
* vendor licensing uncertainty
* missing provider documentation
* major architecture disagreement

Concentrate disproportionate resources on resolving it.

Only deprioritize work that has demonstrably low decision value.

---

# TIME SHOULD BE ALLOCATED BY DECISION VALUE

Not every question deserves equal research effort.

Use a triage system.

## TIER 1 — MUST KNOW

Questions that could materially alter:

* product strategy
* architecture
* cost
* licensing
* feasibility
* MVP

These receive deep research.

## TIER 2 — SHOULD KNOW

Important but unlikely to invalidate the core plan.

Research sufficiently.

## TIER 3 — NICE TO KNOW

Interesting details that can be investigated later.

Do not let these consume the seven-day window.

This is **not corner-cutting.**

It is rational research prioritization.

---

# APPLY THE 80/20 PRINCIPLE TO ATTENTION, NOT QUALITY

Do not spend equal time on every benchmark product.

Bloomberg may deserve dramatically more research than a narrow secondary competitor, and the role model in Document C Part X allocates accordingly.

Likewise:

A provider licensing question that could invalidate an entire feature deserves more attention than discovering the exact location of a minor UI preference in a competitor.

Allocate agent effort dynamically.

Depth should follow strategic importance.

---

# PARALLELISM IS THE PRIMARY SCHEDULE COMPRESSION MECHANISM

If 20 independent research tasks each require meaningful effort, do not execute them sequentially.

Run them simultaneously where agent infrastructure permits.

However:

Parallel agents must have:

* clear ownership
* isolated scope
* one canonical output file each (Document B §8 and §38)
* defined interfaces
* a capped return summary

Otherwise parallelism merely produces information chaos.

---

# CONCURRENCY SHOULD EVOLVE DURING THE WEEK

Do not maintain the same 100-role distribution throughout the project.

Early:

Most capacity should be research.

Middle:

Shift toward synthesis, product, and architecture.

Late:

Shift heavily toward validation, specifications, roadmap, and implementation planning.

Conceptually:

```text
DAY 1
80% Research
15% Synthesis
5% Planning

DAY 3
50% Research
30% Synthesis
20% Planning

DAY 5
20% Research
35% Synthesis
45% Planning/Red Team

DAY 7
10% Targeted Research
25% Validation
65% Final Planning/Synthesis
```

These percentages are illustrative.

Use judgment.

The principle matters:

**The organization should change shape as uncertainty decreases.**

---

# DO NOT OVER-DOCUMENT THE PROCESS AT THE EXPENSE OF DOING THE WORK

Documentation is necessary for persistence and traceability.

But do not spend excessive time creating elaborate administrative artifacts nobody needs.

Every program document must serve one of these purposes:

* preserve context
* coordinate agents
* document evidence
* support decisions
* enable future implementation

If it does none of those things, do not create it.

Evidence artifacts have no length cap. Control artifacts stay concise. The owner decision memo is at most four pages.

---

# DO NOT WAIT FOR EVERY AGENT

If one research agent stalls, fails, or produces poor-quality work:

* replace it (dispatch a new task with a corrected contract)
* reassign the question
* use another evidence source
* continue synthesis

Do not allow a single agent to block an entire research wave unless its question is genuinely critical.

---

# RAPID QUALITY CONTROL

Agent output should be evaluated quickly.

Classify it:

### ACCEPT

High-quality, evidence-backed.

### ACCEPT WITH GAPS

Useful but needs targeted follow-up.

### RESEARCH AGAIN

Insufficient evidence.

### DISCARD

Low quality / duplicate / unreliable. A dossier with uniform high confidence and no sources is in this class.

This prevents weak research from silently contaminating the final plan.

---

# RESEARCH STOPPING RULE

For each research question, stop when additional research has a low probability of materially changing the associated decision.

Critical conclusions should still receive independent validation.

Do not research indefinitely for psychological comfort.

For example:

If multiple high-quality primary or expert sources establish how a workflow operates and independent researchers confirm it, additional generic articles may add little value.

Move on.

This is rigor, not corner-cutting.

The rule binds at the leaf through each contract's BUDGET field (Document B §37): an agent that reaches its budget writes a partial report with explicit gaps rather than continuing.

---

# THE DEADLINE DOES NOT MEAN EVERYTHING MUST BE KNOWN

A strong institutional plan explicitly identifies uncertainty.

By Day 7, some issues may legitimately remain:

* contractual questions
* exact future pricing
* unreleased competitor capabilities
* final user validation

Record them.

Define how they will be resolved.

The requirement is not omniscience.

The requirement is that remaining unknowns are:

* visible
* bounded
* owned
* unlikely to invalidate the entire plan without being recognized

---

# DO NOT ALLOW PERFECTIONISM TO BECOME PROCRASTINATION

This is especially important.

The master directive intentionally sets an extremely high quality bar.

Do not interpret that as:

"No decision can be made until every conceivable question has been researched."

The correct standard is:

**Enough high-quality evidence to make a defensible decision while clearly identifying remaining uncertainty.**

---

# CRITICAL PATH MANAGEMENT

Maintain a canonical file titled:

## `CRITICAL_PATH.md`

Identify the small number of questions that must be resolved for the project to advance.

Each entry: the question · the decision it blocks · the owning role · current confidence · what evidence would close it.

Potential examples:

* architecture of Terminal-Current
* current provider capabilities
* licensing constraints
* proposed security context model
* workspace architecture
* MVP workflow

Focus senior agents on these.

Do not confuse "large amount of work" with "critical path."

---

# DEADLINE-SAFE ESCALATION

If you believe the seven-day deadline is threatened, do not silently reduce the quality bar.

Instead:

1. identify the bottleneck
2. explain why it matters
3. reallocate agents
4. increase parallelism
5. stop low-value research
6. use targeted validation
7. preserve critical depth

Only recommend reducing scope if the removed scope is genuinely lower priority.

Never hide that tradeoff.

---

# END-OF-WEEK ACCEPTANCE GATE

The canonical gate is the 26-item table in Document B §49, copied into `GOVERNING_PRINCIPLES.md` at program start. Every other completion list in this library is a pointer to that table. Each item is marked MET, MET WITH BOUNDED UNKNOWNS (the unknown is named in `OPEN_QUESTIONS.md` with an owner and a resolution path), or NOT MET, and names the artifact that satisfies it.

Two items are pass/fail and are executed, not judged:

* PROTECTION RAIL: application source paths unchanged from the recorded start SHA; the calendar surface's tests pass; a browser smoke of `/calendar` passes.
* READINESS TEST: on the final program day, dispatch a fresh agent whose only inputs are the master plan and the engineering backlog. Ask it to produce the implementation plan for the first work package. Count the discovery questions it must ask that the plan should have answered. Three or fewer passes; answer those into the plan the same day. More than three means the plan is not implementation-ready; fix the gaps and rerun.

Do not declare the program complete with any item NOT MET. State precisely what remains instead.

---

# THE FINAL SEVEN-DAY STANDARD

At the end of the week, I expect us to have:

* deeply researched the important benchmark systems
* understood the existing UCT codebase and infrastructure
* mapped current providers
* identified licensing/data gaps
* defined the important user workflows
* identified our proprietary advantages
* developed a coherent product philosophy
* designed a technically realistic architecture
* preserved Terminal-Current
* prioritized what gets built
* explicitly identified what does not get built
* defined an MVP that proves the thesis
* produced a detailed implementation plan
* created engineering work packages
* identified unresolved risks
* established the next execution stage

The gate in Document B §49 is the test of this list.

I do **not** expect every feature of Terminal-Next to be implemented within this initial week.

The deadline applies primarily to:

# RESEARCH + DISCOVERY + SYNTHESIS + PRODUCT STRATEGY + ARCHITECTURE + IMPLEMENTATION READINESS

The MVP is: **The smallest coherent version that proves the Terminal-Next thesis, meaning our own traders voluntarily prefer it for at least one meaningful daily workflow after reasonable onboarding.**

If meaningful prototypes can safely be created during the week to reduce uncertainty, do so, within the prototype envelope in Document B §14A.

But never sacrifice the quality of the strategic foundation merely to produce visible code.

---

# EXECUTIVE MANDATE

Treat one week as a constraint that demands operational excellence.

Do not rush.

Do not meander.

Do not cut corners.

Do not wait unnecessarily.

Do not sequentialize work that can happen simultaneously.

Do not over-research low-value questions.

Do not let weak agents become bottlenecks.

Do not allow documentation bureaucracy to consume the project.

Do not postpone synthesis until the end.

Think continuously.

Integrate continuously.

Challenge continuously.

Make decisions when evidence is sufficient.

Keep uncertainty explicit.

Use the full power of parallel agents.

The target is not:

**fast and sloppy.**

Nor is it:

**perfect but finished three months from now.**

The target is:

# EXCEPTIONALLY THOROUGH, HIGH-CONVICTION WORK DELIVERED WITHIN AN AGGRESSIVELY ORCHESTRATED SEVEN-DAY PROGRAM.

Operate accordingly.
