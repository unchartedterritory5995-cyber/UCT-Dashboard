# CEO Review — Research Page + Earnings Modal Redesign Spec

**Reviewed:** `docs/superpowers/specs/2026-08-03-research-calendar-redesign-design.md` (+ research base 01–05)
**Lens:** business only — differentiation, monetization, launch risk, cost, brand, liability, focus. Pixels not reviewed.
**Date:** 2026-08-03 · Launch: Sat Sep 5, 2026 (~4.5 weeks out)

**Overall verdict:** The spec is strategically sound — it executes exactly what the research (03) says separates cult products from commodity ones ("opinion with an audit trail," time-derivatives, provenance), and the ~$0 data-cost claim is broadly credible. The problems are sequencing and posture, not direction: no launch slice is defined against a hard Sep 5 date, the flagship differentiator has no history to display on day one, computed grades ship with no disclaimer/methodology posture, and the redesign as scoped improves only surfaces free users can never see — i.e., it is a retention project wearing a conversion project's clothes.

---

## BLOCKER

### 1. No defined launch slice — a 5-phase redesign begins ~4.5 weeks before a hard launch date (§9 Phasing)
**Concern:** P1→P5 covers tokens, a full modal rebuild, a full page rebuild, new backend services, and a polish pass. History says phases of this shape run multi-week each (B2, B3), the shipping channel is gated (explicit owner approval per phase + deploy windows + `push origin branch:master`), and `perf/calendar-load` is only "ships first if possible." If P3 is mid-flight on Sep 4, launch-day visitors see a half-migrated app. The research itself notes reviewers praise competitors for *speed* before layout — a slow Calendar with a beautiful modal is a worse first impression than a fast Calendar with the current modal.
**Recommendation:** Declare the launch scope in the spec now: **P1 + a slimmed P2 (see finding 7) = launch; P3, P4, P5 explicitly DO NOT block launch** and continue post-Sep 5. Make `perf/calendar-load` a hard prerequisite, not an aspiration. Add a scope-freeze date (~Aug 22) after which only bug fixes land on the launch slice.

### 2. Computed grades go public with no disclaimer/methodology posture (§4.2 verdict chip; §5.3 Ratings crown)
**Concern:** A subscription research product that is not an RIA lives under the publisher's exclusion — impersonal, regular-circulation, bona fide analysis. Letter-grading individual securities is industry-standard (IBD, Zacks, TipRanks all do it), so the concept is fine, but the spec ships A+…F "verdict" chips and "PREMIUM RICH/CHEAP" calls with zero mention of disclaimers, a methodology page, or Terms language. The word "verdict" itself is the most advice-flavored word available. One screenshot of "A+ · UCT" above a name that gaps −25% overnight, with no visible methodology or disclaimer, is a launch-week trust and positioning problem.
**Recommendation:** Before any grade renders publicly: (a) standing "for informational purposes only / not investment advice" footer on modal + research page; (b) a public methodology note (the spec's "formula documented in code" is not enough — document it where users can read it); (c) rename the UI label from "verdict" to something descriptive ("Setup Grade" / "Earnings Profile"); (d) Terms of Service updated for published ratings; (e) **persist daily grade snapshots from day one** (research W14) — a rating-history chart is both the accountability defense and a future differentiator. This is cheap (days, not weeks) — which is exactly why it must not be skipped.

---

## MAJOR

### 3. Two house scoring systems that can publicly disagree (§4.2 modal A+–F chip vs §5.3 RatingCrown 0–99 + 7 components)
**Concern:** MarketSurge's moat is ONE number everyone quotes ("it's a 98 Composite"). This spec ships two: the research page's 0–99 composite crown and a separate modal A+–F grade computed from a different 4-input formula. The same ticker can show Composite 92 on the page and a C in the modal, and a paying user will screenshot the contradiction. Two scores also halve the brand equity each could build.
**Recommendation:** Scope-label them so they visibly measure different things: the crown = "UCT Rating" (the stock), the chip = "Earnings Setup Grade" (this event), distinct visual treatment, and a tooltip line in each acknowledging the other. Better: derive the chip partly from crown components (RS is already shared) so disagreement is explainable, and add one FE test asserting the two never render with the same visual identity.

### 4. The flagship hero is empty at launch — implied-history only accrues from ~Aug 2026 (§4.3a ImpliedVsRealized; §6 row 2)
**Concern:** The owner-selected Setup hero — and the single most nameable differentiator vs MarketSurge/EarningsWhispers (research 03 W31: no US competitor's ticker page has it) — needs "implied at the time" per past quarter. The spec's plan is a nightly store that "builds over time" plus "best-effort" backfill. Untested backfill means the launch-day hero renders realized-only: a next-day-move chart every competitor already has. The honest labeling ("implied history since 2026-08") is the right integrity call but confirms the marquee is a promissory note on Sep 5.
**Recommendation:** Start the nightly implied store **now** (it needs no UI — it is P4-independent) and validate IV-history backfill for the ~500 most-watched reporters before launch. If backfill fails, re-order Setup so ReactionBars + the implied-vs-historical-average bracket (computable today) leads, and let the paired-bars hero take over as history accrues.

### 5. The grade's IV input rides delayed yfinance quotes until P4 (§9 P2 note "expected move still yfinance" vs §4.2)
**Concern:** "We must stand behind grades" — but in the P2 launch window the verdict chip's "IV premium rich/cheap" input comes from the slow, hang-prone, delayed-quote yfinance straddle the spec itself replaces in P4. Publishing a letter grade computed off delayed options quotes is the exact "grade you can't defend" failure mode the research warns destroys trust (03, A11 cons).
**Recommendation:** Pull the Massive-chain implied-move service forward into the launch slice (research 05 sizes it S — the service already exists, voice-only), or ship the chip on 3 inputs and add the IV component when the in-house feed lands. Do not launch a grade with a known-shaky input.

### 6. The redesign has no conversion mechanics — it polishes rooms free users can never enter (§4.4, §5.2, §10)
**Concern:** As shipped (2026-07-19), free = Morning Wire ONLY — there is currently no "free calendar → paid research" funnel because free users see neither surface. The spec keeps paywall semantics unchanged (correct: nothing is given away), but that means this entire investment is retention-only. Worse, the new `?earnings=SYM` deep links — the viral loop, members sharing tonight's setup — dead-end for non-paid recipients (AuthGuard redirects locked pages to /dashboard).
**Recommendation:** Owner decision before launch: (a) make the Calendar list view free — calendars are a free commodity at EarningsWhispers/EarningsHub, a paid calendar converts nobody — with the modal's Setup section visible and the other 5 rail sections lock-teased; the redesigned modal then becomes the conversion moment, and the lock CTA finally has traffic. Or minimally (b): shared deep links land on a blurred-but-real modal teaser (not a /dashboard redirect), and one public sample ticker page exists for marketing screenshots. Option (a) is the strongest monetization move available from this work.

### 7. Modal scope creep dilutes the event job and pads the launch-critical phase (§4.3 sections 4 + 6)
**Concern:** Analyst & Ownership (13F data that is 45 days stale — near-zero decision value the night of a print) and Filings duplicate the research page inside the modal. They add two sections of build + test to P2, the one phase that must land by Sep 5, while weakening the "Open full report" upsell (why open the report if the modal already contains it?).
**Recommendation:** Launch modal = Banner + Setup + Earnings History + Brief (+ Call, which activates post-print). Ship "Analyst & Ownership" and "Filings" as rail items that link into the corresponding /research sections — faster to build, and it strengthens the modal→report funnel instead of cannibalizing it. Add them as full modal sections post-launch if usage data asks for them.

---

## MINOR

### 8. The ~$0 cost claim holds for data, with two open ends to bound (§6, §4.4 arrow keys, §7)
**Concern:** Feeds are genuinely $0-incremental (Massive already paid, FMP existing key, FINRA free, yfinance free). Two unbounded edges: the nightly implied store's symbol scope is unstated (whole 3,685-ticker universe vs reporters), and arrow-key stepping while sitting on the Brief rail can fan cost-guarded LLM fetches across a 40-name day on cache-cold symbols — capped by the guard, but the cap failure mode is users seeing empty Briefs.
**Recommendation:** Bound the nightly store to symbols reporting within ~14 days (~40–80/night). On arrow-step, Brief renders cached-only with a "generate" affordance rather than auto-firing the LLM path.

### 9. FMP probe gating is right — pre-commit to not upgrading the tier (§6 PT histogram row)
**Concern:** The probe-first rule for `price-target-news` is exactly correct. The predictable failure: the probe 404s and the histogram becomes an argument for an FMP tier upgrade. A histogram of analyst targets is not worth new recurring spend post-token-crisis.
**Recommendation:** Write the decision down now: probe fails → slider-only ships permanently; no FMP upgrade for this feature. Revisit only if a paying-user request pattern emerges.

### 10. Glass Premium creates a two-register app on launch day (§3.1, north star 1)
**Concern:** Two surfaces go glass while Dashboard, Breadth, and Wire keep the current register. The tokens correctly reuse the brand palette (gold border rgba on `--ut-gold` family, dark surfaces), so the delta should read as polish — but "Navigate the market, effectively" promises coherence, and a visitor touring on day one will cross registers three times.
**Recommendation:** Accept for launch (the redesign is the direction, not a fork), keep glass values within the existing surface/gold ramp as spec'd, and schedule the app-wide token sweep as a named post-launch initiative so the register converges instead of forking further.

### 11. The moat is real but unnamed (§4.3a; research 03 W31 + synthesis)
**Concern:** Implied-vs-realized pricing and "consensus drift" exist on no competitor's ticker page — that is a nameable win over MarketSurge (no options DNA) and EarningsWhispers (whisper, but no options context). The spec builds it and never names it; marketing can't sell "8 paired bars."
**Recommendation:** Brand the Setup hero as a noun (e.g., "the Expectation Gap" — owner-locked title style applies) and put that noun in launch copy, the coming-soon page, and the paywall teaser. The correct "consensus drift, never whisper" labeling call in §6 also avoids poking EW's trademark — keep it.

### 12. Deferring the options-flow rail section is right — but it is the hardest-to-copy asset, so pin its return (§10 non-goals)
**Concern:** The own-OPRA flow.db tape is the one asset competitors cannot license their way to, and it is absent from the launch surface. Correct for schedule; risky if "future rail item" silently becomes never.
**Recommendation:** Commit it as the #1 post-launch rail addition. A slim "flow into the print" chip row (flow.db, `days=1` per the cap gotcha) on the modal Setup section is a cheap, unique follow-up that no research competitor can answer.

---

## Summary counts
- **BLOCKER: 2** (launch slice undefined; grade disclaimer/methodology posture missing)
- **MAJOR: 5** (dual scoring systems; empty launch hero; grade on delayed IV input; no conversion mechanics; modal scope creep)
- **MINOR: 5** (cost edges to bound; FMP-tier line in the sand; two-register brand; unnamed moat; flow-section return unpinned)

**What should explicitly NOT block launch:** P3 page rebuild, P4 data upgrades (except the implied-move service if finding 5 resolves that way), P5 polish, FINRA short-interest history, PT histogram, segment revenue, the percentile-ratings job, and any Options/Peers/News rail items.
