---
id: ADR-0003
title: A flag state is never asserted from a code default or a past decision
status: accepted
date: 2026-09-02, re-affirmed 2026-09-26
decided_by: programme (OWNER_SEED_FACTS §3)
gate_item: 22, 25, 31
promotion: Locked: it is a binding evidence rule in the charter, and two deliverables refuse to report state under it.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0003 — A flag state is never asserted from a code default or a past decision

**STATUS: ACCEPTED** · 2026-09-02, re-affirmed 2026-09-26 · decided by programme (OWNER_SEED_FACTS §3) · gate item 22, 25, 31

**Why it is an ADR and not a tracker row:** Locked: it is a binding evidence rule in the charter, and two deliverables refuse to report state under it.

## Context

`00-program-control/charter/OWNER_SEED_FACTS.md:30` records that a provider key in configuration
is not evidence of use; `:28-29` that `railway variables --set` stages without restarting, and
that repository documents are claims. The canonical instance is recorded at
`09-security-licensing-cost/data-use-classification.md:1140`: `DESK_PUBLIC_SHOWS`'s code default
is `sunday scans` (*"blank makes NOTHING public"*) while the live value read `*`, which makes
**every** show public — and the wildcard turned out to be a **dated owner decision**, so the
register had to file it as a deliberate decision whose licensing cost was never weighed, not as
a misconfiguration.

## Decision

No artifact asserts a flag's state from a code default, a documented default, or a past
decision. A flag is **named**, and its state is recorded either as read (citing the read) or as
**unread**.

## Alternatives actually considered

1. **Infer from the code default.** Rejected by `DESK_PUBLIC_SHOWS` above.
2. **Infer from the last recorded decision.** Rejected: a flag documented as OFF "since
   2026-05-18 (token burn)" was live when read.
3. **Read it.** Not available to this programme — no Railway access, and the charter forbids
   attempting one (`00-program-control/contracts/_SHARED_PREAMBLE.md:30`).

## Consequences

* Item 22 heads its own flag section *"why this section cannot be trusted as state"*
  (`08-ai/ai-architecture.md:250`) and records that `COMPASS_MENTOR_MODE` — the flag
  deciding whether a **computed trading verdict** reaches members — is not a key in
  `docs/feature_flags.json` at all, so it has no declared default, no exposure and no dated
  owner decision (`00-program-control/MASTER_CHECKLIST.md:28`).
* Item 25 refuses to say whether `terminal-next-monitor`, `liveflow_monitor`,
  `provider_coverage_monitor` or `fundamentals_monitor` are running, naming the code defaults and
  stating *"A code default is not a production state"*
  (`10-roadmap/observability-plan.md:830`, item 10).
* Flags named in this ADR set with state **UNREAD**: `OFFLINE_DEFAULT_ON`,
  `COMPASS_MENTOR_MODE`, `WATCHDOG_ENABLED`, `TERMINAL_NEXT_MONITOR_ENABLED`,
  `D2_DUAL_COMPUTE_WARM_READER_ENABLED`, `BRAIN_TOOLS_ENABLED`, `AI_SEARCH_CLAUDE_SYNTH`,
  `SCAN_SWEEP_ENABLED`, `DESK_PUBLIC_SHOWS`. Not one of them is asserted anywhere in this set.

## Sources

- `00-program-control/charter/OWNER_SEED_FACTS.md:28-30`
- `00-program-control/contracts/_SHARED_PREAMBLE.md:30`
- `09-security-licensing-cost/data-use-classification.md:1140`
- `08-ai/ai-architecture.md:250`
- `10-roadmap/observability-plan.md:830`
- `00-program-control/MASTER_CHECKLIST.md:28`
