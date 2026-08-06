# Design Review — Research Page + Earnings Modal Redesign Spec

**Reviewer lens:** senior product designer, dark-theme financial UI (Koyfin / TradingView / Linear bar)
**Reviewed:** `docs/superpowers/specs/2026-08-03-research-calendar-redesign-design.md` · `research/…/01-current-inventory.md` (design-language section) · `research/…/04-dataviz-patterns.md` Part C · approved mockups 01–10 (`.superpowers/brainstorm/345223-1785804114/content/`)
**Verdict:** The spec is strong — the color grammar (§3.3), one-kit mandate (§3.4), and "modal is the page in miniature" north star are exactly right. But three things would ship broken or would rot the owner's "simplicity and clean" intent, and six more need a sentence each in the spec before P1 locks tokens. 3 BLOCKER / 6 MAJOR / 5 MINOR.

---

## BLOCKERS

### B1 — Color-alone encodings survive the hollow/solid grammar (beat/miss dots, ImpliedVsRealized direction)
**Spec refs:** §3.3, §4.3.1a, §4.3.1b, §4.3.2 · mockups 04-B, 05-B, 06-A
The hollow-vs-solid grammar is correctly applied to **expectation vs realized** (hollow implied bar / solid realized; hollow estimate dot / solid actual) — that part is genuinely colorblind-safe. But two realized-vs-realized distinctions are **hue-only**:
1. **`ImpliedVsRealized` solid bars** (§4.3.1a): both green and red bars rise from the same baseline with height = |move| — "closed up" vs "closed down" is carried by green/red alone. A deuteranope reads 8 identical bars.
2. **Beat/miss dot rows** (§4.3.1b `ReactionBars`, mockup 05-B streak dots): filled green circle vs filled red circle, identical shape and position. Beat vs miss is invisible without hue.
(The lollipop is fine — actual dot sits spatially above/below the hollow estimate dot. `ReactionBars`' bars are fine — signed above/below the zero line.)
**Fix:** extend §3.3 with one sentence: *"Green/red is never the only channel — direction/outcome always gets a second encoding (signed position, hollow/solid, or a glyph)."* Concretely: ImpliedVsRealized realized bars plot **signed** (up/down from a zero baseline, like ReactionBars) or carry a ▲/▼ terminal tick; beat/miss dots become **filled = beat, hollow-with-× = miss** (or ✓/✗ UIcon at dot size). Add a vitest case asserting the non-color channel — §8 already tests "LollipopChart beat coloring"; retitle it "beat encoding" and assert the redundant channel too.

### B2 — 10px eyebrows on glass fail AA; the mockups' label ink must not be tokenized
**Spec refs:** §3.2 (eyebrow 10px/600), §3.1 (`--glass-surface/-elevated`) · mockups pervasively use `#66604f` for labels
Measured against the real tokens, composited:
- `--text-muted` #8c8674 over `--glass-surface`(.55)∘`--bg` ≈ **4.7:1** — passes AA (4.5) with almost zero margin.
- `--text-muted` over `--bg-elevated`/`--glass-elevated`-class composites ≈ **4.3:1** — **fails AA** for 10px text. Every eyebrow inside a `StatTile` on an elevated card is under the line.
- The mockups' dimmer label ink `#66604f` ≈ **2.8:1** — fails even the 3:1 large-text bar. It appears on nearly every mockup label ("EXP MOVE", axis captions, "8Q REACTIONS"). If a dev color-picks the approved mockups, the shipped product fails WCAG wholesale.
**Fix:** add to §3.2: *"Label ink floor = `--text-muted`; no darker ink may be used for any text. Eyebrows on elevated/glass-elevated surfaces use `--text` or a new `--text-label` (~#9a947f+) verified ≥4.5:1 against the **composited** glass color, not the raw rgba."* Add a one-line note that mockup hexes are illustrative, tokens are normative. Cheap insurance: a build-time contrast assertion for the (label-ink × glass-surface) matrix in the P1 token task.

### B3 — The gold budget: one gold-tinted `--glass-border` on every card codifies the decoration creep the owner was warned about
**Spec refs:** §3.1 (`--glass-border` rgba(201,168,76,.22), `--glass-inner-glow`), §2.1 ("restrained glow" — never defined) · mockup 01-D's own caption: "glow ages fast; risks style over substance"
Count gold in one Setup canvas as specced: gold border on **every** GlassCard + gold VerdictChip + gold NOW-bar highlight + gold dashed implied bracket + gold active rail item + gold countdown + gold banner border. Seven gold signals in one view — gold stops meaning anything, and this is precisely the "glow ages badly" failure mode the owner's register was flagged for at selection time. The spec's single `--glass-border` makes the creep *structural*: there is no neutral glass card.
**Fix — codify restraint as tokens + rules, not taste:**
- Two border tokens: `--glass-border` (neutral, from `--border` at glass alpha — the default for every GlassCard) and `--glass-border-accent` (the gold .22 — **banner + one hero card per canvas only**).
- **Gold data-highlight budget: max one per section canvas.** In Setup, the NOW bar and the implied bracket are the *same concept* (tonight's implied) — they may share gold; nothing else in that canvas may.
- `--glass-inner-glow` consumed by **at most one component per view** (recommend: VerdictChip or RatingCrown, never both visible glowing).
- Ban outright (one spec line): gradient text, `text-shadow` on data, `box-shadow` glow on marks (mockup 01-D uses all three — none should survive into the kit).
- Active rail item = the only gold in chrome.

---

## MAJORS

### M1 — The kit is missing the shell components that enforce "one visual system"
**Spec refs:** §3.4 vs §4.1/§4.2/§4.4/§5.1/§5.2/§5.3
§3.4's 15 components cover the *widgets* but not the *shell* — and the shell is where "the modal is the page in miniature" (§2.3) lives or dies. Not in the kit: **IdentityBanner** (modal banner §4.2 and page sticky header §5.2 are 90% the same anatomy — two hand-rolled versions will drift within a month), **SectionRail** (modal rail §4.3 + page rail §5.1 + the phone chip-row/dropdown collapses — the single most-shared piece of the architecture), **PinnedFooter**, **EmptyState** (§4.4 mandates "one styled empty-state" but gives it no component — five loading idioms died, five empty idioms will be born), **Histogram** (§5.3 Estimates PT distribution — no kit component renders it; first one-off), **MetricTrendChart** (§5.3 Financials "click any row → inline ECharts trend" — second one-off), and the **SentimentGauge** restyle (§4.3.5 keeps sentiment; the existing component has 0 media queries and is unlisted — it will be pasted in as-is).
**Fix:** add all seven to §3.4. If the histogram/trend chart are deemed P4, say so in §9 so they don't get improvised in P3.

### M2 — No theme story: glass tokens are hardcoded dark rgba on a three-theme app
**Spec refs:** §3.1 · tokens.css `[data-theme]` oled/dim/light (inventory "Shared design language")
§3.1 mandates "no hardcoded surface hexes" and then defines `--glass-surface: rgba(34,37,30,.55)` — a fixed dark olive that will render as grey mud over a light background, and whose gold border/text contrast math (B2) only holds on dark. The inventory explicitly warns the light theme already loses half the app; this initiative either fixes its slice or explicitly declines to.
**Fix:** one decision, written down: **(a)** scope glass tokens per-theme in tokens.css alongside the existing `[data-theme]` blocks (oled likely wants higher-alpha/near-black glass; light needs an entirely different recipe), or **(b)** declare both surfaces dark-only for v1 in §10 Non-goals + a comment at the token definitions. Option (b) is fine — silent is not.

### M3 — Setup canvas tells the implied-vs-history story twice; density and hero hierarchy suffer
**Spec refs:** §4.3.1 (a+b+c), §4.1
In a ~960px modal with pinned banner + pinned footer, the canvas gets roughly 450–550px of height. Setup stacks: ImpliedVsRealized hero (8 paired bars + verdict chip) + dollar RangeSlider + ReactionBars (bars + dot row + gold bracket + starred quarters + 4 StatTile caption) + a 6-item key-stats strip. That is **three charts and two strips**, and two of the charts carry the same insight — ImpliedVsRealized shows implied vs |realized| per quarter; ReactionBars overlays tonight's implied bracket on per-quarter moves. The brainstorm's own composition note (screen 6) conceded A "ties Screens 4 and 5 into one story" — the spec then shipped both anyway. Result: no single hero, guaranteed internal scrolling, and a first-paint that reads busy — against the owner's "simplicity and clean."
**Fix:** Setup = ImpliedVsRealized + dollar strip + key stats (one chart, one strip, one row). Move ReactionBars into **Earnings History** beside the lollipop — they share the quarter axis and "History" is its natural home. Codify in §4.1: *"one hero instrument per canvas; the canvas scrolls independently under the pinned banner (the 'no global scroll' rule means no whole-modal scroll, not no scroll)"* — the latter is currently ambiguous.

### M4 — Keyboard/focus behavior is under-specified for a custom two-pane modal
**Spec refs:** §4.4, §4.1, §5.1 · §8 (no a11y test items)
Specified: Escape, browser Back, ←/→ ticker stepping. Not specified: **focus trap + `aria-modal` + labelledby** on the desktop shell (phone reuses Sheet.jsx which has the trap; desktop is custom and currently has nothing), **rail semantics** (role=tablist, ↑/↓ within the rail, Enter/Space activates — which cleanly disambiguates from ←/→ = ticker), **←/→ suppression when focus is in an input** (the Call section has a keyword search field — arrow keys inside it must not switch tickers), **a visible focus-visible treatment on glass** (default UA rings vanish against translucent olive; define a gold 2px offset ring once in the kit), and **announcing the symbol change** (arrow-stepping reuses the mounted shell — an `aria-live=polite` "AVGO, reports tonight AMC" or SRs hear nothing).
**Fix:** add a short "Keyboard & focus" block to §4.4 covering those five items, and one §8 test: focus trapped, ←/→ inert while an input has focus.

### M5 — `prefers-reduced-motion` appears nowhere in the spec
**Spec refs:** §3.1–3.4, §7, §8 · dataviz Part C.8 (motion rules) · house precedent (UIcon shimmer is already gated)
The surfaces introduce: a live countdown, skeleton shimmer, chart mount animations (ring sweep, bar grow), glow, and 15s price updates. Dataviz C.8 is explicit — one mount animation ≤300ms, reduced-motion-gated, **no re-animation on poll refresh** — and the house has already been burned by re-animating charts (StockChart no-op repaint guard). The spec adopts none of it.
**Fix:** add to §3.4: *"Kit-wide: mount animations ≤300ms, gated on `prefers-reduced-motion`; SWR refresh never re-animates (data patch, not remount); skeleton shimmer gated (static block under reduced motion)."* Add a §8 line item. Countdown: minute granularity while >5min out (a per-second ticker in a pinned banner is a permanent motion source — see m2 below).

### M6 — Type scale can't produce the crown, and the mockups' 6–8px labels need an explicit disclaimer
**Spec refs:** §3.2, §5.3 Overview/Ratings (`RatingCrown`) · inventory (`.compNum` 46px/900; scale caps at `--text-3xl` 24)
§3.2 collapses "the 13 ad-hoc sizes to the scale" — but the scale tops out at 24px and the RatingCrown's center number (46px today, and every reference ring — TipRanks, IBD — uses a display-size numeral) cannot be 24px. Without a token, the first ad-hoc size returns on day one of P3, in the flagship component. Separately, the approved mockups use 6–8px labels throughout; they are miniatures, but nothing in the spec says so, and the floor matters (10px `--text-xs`, phone-bumped to 11).
**Fix:** add `--text-display` (~34–40px/800, tabular) to the P1 token task, named as the *only* legal above-3xl size (crown + banner grade chip). Add to §3.2: *"Mockup point sizes are illustrative miniatures; production floor is `--text-xs` (10px, 11 phone). The countdown/timing line is numeric → `.t-num` applies"* (§3.2 currently scopes tabular-nums to "cells/columns" — the ticking countdown is the worst jitter offender and isn't a cell).

---

## MINORS

### m1 — Pinned chrome needs its own, more opaque glass token
**Spec refs:** §3.1, §4.2, §5.2. Cards at .55 alpha sit over a static bg — fine. But the sticky page header and pinned modal banner/footer have **content scrolling beneath them**; at .55 with backdrop-filter restricted to the modal backdrop (§3.1, correct call for perf), scrolling text will ghost through the chrome. The mockups already solve this — every banner uses rgba(20,22,17,**.95**) — but the spec doesn't tokenize it. **Fix:** add `--glass-chrome` (≥.92 alpha) and state: pinned/sticky chrome uses it; only in-canvas cards use `--glass-surface`.

### m2 — Banner focal-point budget: cap the ticking elements and the post-flip color load
**Spec ref:** §4.2. Identity + timing + countdown + live price + verdict chip is five signals but survivable *if* codified: verdict chip is the single right-anchor (mockup 03-B's layout — keep it), countdown is a quiet sub-line at minute granularity (never a seconds ticker while >5min out), price gets no flash animation, and the post-report flip line ("Beat $0.98 vs $0.94 · guidance raised · +4.2% AH") carries **max two semantic colors** — verdict word + AH move colored, guidance stays ink. Two permanently-animating elements (price + seconds countdown) in a pinned banner would be the one thing users can never look away from.

### m3 — SkeletonBlock needs a shape/size contract or the one-idiom win becomes one-idiom CLS
**Spec refs:** §3.4, §4.4. A generic grey block swapped for a 70px-tall chart shifts layout on every rail visit. **Fix:** each chart component exports its skeleton (`<LollipopChart.Skeleton/>` etc.) at the exact reserved aspect/height; SkeletonBlock takes `variant="text|tile|chart"`; shimmer is reduced-motion-gated (M5). Dedicated per-chart shimmer *shapes* are not needed — fixed-size blocks are enough; it's the size contract that matters. Same for EmptyState (M1): one component, one copy pattern ("what's missing + when it typically arrives" — the transcript example in §4.4 is the right template; make it the rule).

### m4 — Modal shell background and glass-on-glass nesting depth are unspecified
**Spec refs:** §4.1, §3.1. The spec kills `#111612` but never says what the shell *is*. Mockup 03 shows three translucency levels nested (glass tiles inside glass cards inside a glass shell over a blurred backdrop) — at three levels the composited result is unpredictable and muddy. **Fix:** shell = opaque `--bg-surface` (the backdrop already provides the glass moment); inside it, max **one** level of translucent card; StatTiles inside a GlassCard use a solid inset tone (`rgba(14,15,13,…)` as the mockups do), not a second translucency.

### m5 — HeatGrid promotion must carry the Breadth rules along with the Breadth colors
**Spec refs:** §3.1, §5.3 Financials. Promoting `bgG3…bgR3` to tokens is right; also promote the two *rules* that make that system work: **text stays uniform ink** (dark saturated ink for extremes so white text survives — never per-cell text color), and every heat cell keeps its **visible number** (the value is the colorblind-safe channel — a heat grid with color-only cells would re-import the B1 problem). On phone, frozen-first-column rows need `--tap-min` row height for the click-to-trend interaction.

---

## What the spec already gets right (don't touch)
- §3.3's green/red = realized-only grammar is the single best consistency decision in the document.
- Backdrop-filter restricted to the modal backdrop (§3.1) — correct perf call; m1 handles the sticky-chrome consequence.
- One parameterized RangeSlider for 52wk/PT/expected-move; SkeletonBlock as THE idiom; ratings rendered exactly once (§5.3) — kills the three-renderings disease at the root.
- Deterministic verdict arithmetic with a tooltip audit trail (§4.2) — opinion-with-evidence without an LLM at the top of the surface.
- Zero new chart dependencies + tree-shaken echarts riding the existing backlog item (§3.4) — the dataviz doc's recommendation, adopted verbatim.
