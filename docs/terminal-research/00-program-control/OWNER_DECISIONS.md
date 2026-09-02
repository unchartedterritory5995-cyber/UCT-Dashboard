# OWNER DECISIONS — escalations (Document B §34)

While a decision is pending, the program proceeds on the recommended option and stamps dependent artifacts `PROVISIONAL pending D-00x`. Facts only the owner knows are NOT escalations; they live in `OWNER_INPUTS_REQUESTED.md`.

## Pending

| ID | Raised | Decision required | Context and evidence | Options | Recommendation (in force provisionally) | Consequences | Dependent artifacts stamped |
|---|---|---|---|---|---|---|---|
| D-001 | Day 1a (seeded by OWNER_SEED_FACTS §6) | Business priority between two valid strategies: internal desk first, or member onboarding first | The MVP definition is "our own traders voluntarily prefer it for one daily workflow"; Part XXI/CCCIII niche advantage; member count under ~750 with one paid tier; 2–5 internal users. Evidence from Wave 1 (proprietary inventory, desk workflows) will sharpen this. | (a) Desk first, members second; (b) members first (onboarding, progressive disclosure); (c) both from day one | **(a) Desk first, members second.** It matches the MVP definition, keeps licensing exposure low (internal display before member redistribution), and the desk is the fastest feedback loop. | (a) slower member-visible value, cleaner licensing; (b) earlier retention impact but member-facing licensing and support burden before the thesis is proven; (c) splits a small team | Product vision, tiers, first slice, roadmap ordering (all future) |

| D-002 | Day 1a (2026-09-02, from E-01) | Licensing exposure of member-facing vendor data: evidence that materially changes feasibility (B §34) | E-01 read the public terms verbatim: Massive's Business ToS (§2.2, §6.1(e)) permits displaying data to Edge Users, but every public Massive and FMP retail tier is labelled individual-use, and FMP §2.2.2 plus its pricing footnote bar multi-user display without a separate Data Display and Licensing Agreement; Finviz publishes no terms; Yahoo/yfinance is Unsuitable with no licence to buy; Anthropic's terms make UCT warrant input rights, so upstream restrictions re-enter through every LLM lane. Production today already shows Massive/FMP-derived data to paying members (calendar, fundamentals, live flow). The governing plan tier is unknown, so this is exposure, not a finding of non-compliance. | (a) Confirm or obtain business-tier licences (Massive Business is listed at $2,499/mo; FMP DDLA pricing unknown): recurring spend above the $250/mo threshold, so an owner call regardless. (b) Design Terminal-Next member surfaces around derived, delayed, or aggregated forms and keep raw vendor data desk-only until contracts are confirmed. (c) Desk-only Terminal-Next for V1 (already D-001). | **(b) + (c) provisionally:** plan the desk-first slice on current data; classify every member-facing raw-vendor display Restricted-pending-contract in the licensing register; add no member-facing raw vendor surfaces to the roadmap until OI-03 is answered. | (a) settles the question but is the largest recurring-cost decision in the program; (b) keeps the program moving with zero new spend but caps member value until answered; (c) is already the default. | licensing register, member-facing tiers, cost model, first-slice scope (all PROVISIONAL pending D-002) |

## Decided

| ID | Decided | Decision | Note |
|---|---|---|---|
| — | — | — | — |
