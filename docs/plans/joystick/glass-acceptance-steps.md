# Joystick hub — the per-surface glass sweep (GENERATED)

> ## ⛔⛔ RUN AFTER G0-1 RESOLVES. DO NOT RUN EARLY.
>
> `glass-acceptance.md:104` is the rule this sheet inherits: *"Resolve G0-1 before reading
> any G1."* G0-1 is an iPhone 15 Pro scoring flick **0/10** where an SE scored 10/10 on the
> same calibrated path, and it is **UNEXPLAINED**. Every row below is the same gesture
> measured by hand, so a PASS read while that is open is a pass against an instrument known
> to disagree with itself. ⛔ Below 8/10 on the flick score, every row here is
> **BLOCKED-BY-G0**, never FAIL.
>
> **Two devices, both required:** a notched iOS (**iPhone 15 Pro**) and an Android
> (**Pixel 8**). Run every "both" row on each; the device column names the rows that belong
> to one of them only.
>
> ⚰️ **GENERATED — do not hand-edit.** `node tools/hub_surface_matrix.mjs --glass`
> (baseline `febe8ee67`). A hand-maintained copy of this list beside the registry that owns
> it is the drift this repo has paid for in a nav roster, a writer index, a setup catalog and
> a COT route count. Regenerate it; do not patch it.
>
> ⚠️ **The Runner column is a purchasing decision, not a wiring claim.** BrowserStack meters
> **Live** and **Automate** separately, the account's Automate allowance was exhausted at the
> Phase-2 run, and no CI device job exists (`71-open-items-proposals.md` §2). Every row is a
> Live row today; the column says which ones would stop needing a human if minutes were bought.

**Judgement rows live in `glass-acceptance.md` and are not duplicated here** — G3-15 (the
chip/Actions-button overlap) and G3-16 (Wire vs Journal colour confusability) ask a human a
question no generator can phrase. This sheet is the exhaustive per-surface sweep beside them.

## wire — /morning-wire

| # | Step | Expected | Device | Runner | Result |
|---|---|---|---|---|---|
| GS-wire-0 | _This mode declares no gesture bindings._ | Tap, double-tap and scrub do **nothing** here, and the chip does not promise otherwise. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-wire-1 | **Chart it** (`wire.chartIt`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The route changes to `chart`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-wire-2 | **Flag** (`wire.flag`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-wire-3 | **Note** (`wire.note`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-wire-4 | **Voice** (`wire.voice`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-wire-5 | **Home** (`wire.home`) — flick to it from the pad. | The Home fan returns. No navigation happens on its own. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |

## breadth — /breadth

| # | Step | Expected | Device | Runner | Result |
|---|---|---|---|---|---|
| GS-breadth-1 | **Primary (tap).** Tap the pad once. (The chip says “tap: next tab”.) | The cursor steps **once** and the target scrolls into view. ⛔ Exactly one step per tap — a double step is the tap firing twice. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-breadth-2 | **Reverse (double-tap).** Tap twice inside the double-tap window (`DOUBLE_TAP_MS` 280). | The cursor steps **back** one. A single tap must not also fire. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-breadth-3 | **Scrub (drag y).** Press and drag along y to scrub. | The cursor moves with the thumb, and the page follows it. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-breadth-4 | **Scrub commit (release).** Release the scrub. | The landing row is revealed — scrolled into view, not merely selected. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-breadth-5 | **Chip readout.** While scrubbing, read the chip. | The chip names the thing under the cursor in the page's OWN words (a ticker, a note title, a date), never a bare index. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-breadth-6 | **Voice** (`breadth.voice`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-breadth-7 | **Home** (`breadth.home`) — flick to it from the pad. | The Home fan returns. No navigation happens on its own. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |

## scan — /screener

| # | Step | Expected | Device | Runner | Result |
|---|---|---|---|---|---|
| GS-scan-1 | **Primary (tap).** Tap the pad once. (The chip says “tap: next result”.) | The cursor steps **once** and the target scrolls into view. ⛔ Exactly one step per tap — a double step is the tap firing twice. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-2 | **Reverse (double-tap).** Tap twice inside the double-tap window (`DOUBLE_TAP_MS` 280). | The cursor steps **back** one. A single tap must not also fire. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-3 | **Scrub (drag y).** Press and drag along y to scrub. | The cursor moves with the thumb over the `scan` list, and the page follows it. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-4 | **Scrub commit (release).** Release the scrub. | The landing row is revealed — scrolled into view, not merely selected. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-5 | **Chip readout.** While scrubbing, read the chip. | The chip names the thing under the cursor in the page's OWN words (a ticker, a note title, a date), never a bare index. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-6 | **Chart it** (`scan.chartIt`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The route changes to `chart`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-7 | **Flag** (`scan.flag`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-8 | **Alert** (`scan.alert`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | Exactly **ONE** sheet opens — the confirm sheet — never two. It names the action, and the commit button performs it. The fire haptic ESCALATES (`warn`, not `impact`). | Android only — `haptics.js` no-ops without `navigator.vibrate`, which iOS Safari does not expose | ⛔ LIVE ONLY — a haptic is felt, never asserted | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-9 | **Plan trade** (`scan.planTrade`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-10 | **Scans** (`scan.scans`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-11 | **Why?** (`scan.why`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The route changes to `/ai-search`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-12 | **Voice** (`scan.voice`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-scan-13 | **Home** (`scan.home`) — flick to it from the pad. | The Home fan returns. No navigation happens on its own. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |

## chart — /charts  ⭐ **LEFT PREVIEW SINCE INCREMENT 2 — every row below is untested on glass**

| # | Step | Expected | Device | Runner | Result |
|---|---|---|---|---|---|
| GS-chart-1 | **Primary (tap).** Tap the pad once. (The chip says “tap: next timeframe”.) | The cursor steps **once** and the target scrolls into view. ⛔ Exactly one step per tap — a double step is the tap firing twice. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-2 | **Reverse (double-tap).** Tap twice inside the double-tap window (`DOUBLE_TAP_MS` 280). | The cursor steps **back** one. A single tap must not also fire. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-3 | **Scrub (drag y).** Press and drag along y to scrub. | The cursor moves with the thumb, and the page follows it. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-4 | **Scrub commit (release).** Release the scrub. | The landing row is revealed — scrolled into view, not merely selected. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-5 | **Chip readout.** While scrubbing, read the chip. | The chip names the thing under the cursor in the page's OWN words (a ticker, a note title, a date), never a bare index. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-6 | **Plan trade** ⭐ (`chart.planTrade`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-7 | **Alert** ⭐ (`chart.alert`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | Exactly **ONE** sheet opens — the confirm sheet — never two. It names the action, and the commit button performs it. The fire haptic ESCALATES (`warn`, not `impact`). | Android only — `haptics.js` no-ops without `navigator.vibrate`, which iOS Safari does not expose | ⛔ LIVE ONLY — a haptic is felt, never asserted | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-8 | **Flag** ⭐ (`chart.flag`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-9 | **Draw** 🆕 (`chart.draw`) — flick to it from the pad. Then repeat with **no chart** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-10 | **Compare** ⭐ (`chart.compare`) — flick to it from the pad. Then repeat with **no chart** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-11 | **Log trade** ⭐ (`chart.logTrade`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-12 | **Note** ⭐ (`chart.note`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-13 | **Voice** (`chart.voice`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-chart-14 | **Home** (`chart.home`) — flick to it from the pad. | The Home fan returns. No navigation happens on its own. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |

## journal — /journal/trades

| # | Step | Expected | Device | Runner | Result |
|---|---|---|---|---|---|
| GS-journal-1 | **Primary (tap).** Tap the pad once. (The chip says “tap: next position”.) | The cursor steps **once** and the target scrolls into view. ⛔ Exactly one step per tap — a double step is the tap firing twice. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-journal-2 | **Reverse (double-tap).** Tap twice inside the double-tap window (`DOUBLE_TAP_MS` 280). | The cursor steps **back** one. A single tap must not also fire. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-journal-3 | **Chart it** (`journal.chartIt`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The route changes to `chart`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-journal-4 | **Move stop** (`journal.moveStop`) — flick to it from the pad. Then repeat with **no position** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. The fire haptic ESCALATES (`warn`, not `impact`) — this is a write to a live position. | Android only — `haptics.js` no-ops without `navigator.vibrate`, which iOS Safari does not expose | ⛔ LIVE ONLY — a haptic is felt, never asserted | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-journal-5 | **Breakeven** (`journal.breakeven`) — flick to it from the pad. Then repeat with **no position** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. The fire haptic ESCALATES (`warn`, not `impact`) — this is a write to a live position. | Android only — `haptics.js` no-ops without `navigator.vibrate`, which iOS Safari does not expose | ⛔ LIVE ONLY — a haptic is felt, never asserted | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-journal-6 | **Close** (`journal.close`) — flick to it from the pad. Then repeat with **no position** in context: the bubble must render **DISABLED with a reason, never hidden**. | **D4, here.** A fast flick (under `FLICK_MS`) toward “Close” **opens the fan and fires NOTHING**; a deliberate press (~500ms) DOES fire it. ⛔ Both halves, or the row proves nothing. | Android only — `haptics.js` no-ops without `navigator.vibrate`, which iOS Safari does not expose | ⛔ LIVE ONLY — the flick is the measurement | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-journal-7 | **Plan trade** 🆕 (`journal.planTrade`) — flick to it from the pad. Then repeat with **no position** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-journal-8 | **Note** (`journal.note`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-journal-9 | **Voice** (`journal.voice`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-journal-10 | **Home** (`journal.home`) — flick to it from the pad. | The Home fan returns. No navigation happens on its own. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |

## catalysts — in place  ⭐ **LEFT PREVIEW SINCE INCREMENT 2 — every row below is untested on glass**

| # | Step | Expected | Device | Runner | Result |
|---|---|---|---|---|---|
| GS-catalysts-1 | **Primary (tap).** Tap the pad once. (The chip says “tap: next row”.) | The cursor steps **once** and the target scrolls into view. ⛔ Exactly one step per tap — a double step is the tap firing twice. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-catalysts-2 | **Reverse (double-tap).** Tap twice inside the double-tap window (`DOUBLE_TAP_MS` 280). | The cursor steps **back** one. A single tap must not also fire. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-catalysts-3 | **Scrub (drag y).** Press and drag along y to scrub. | The cursor moves with the thumb over the `catalysts` list, and the page follows it. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-catalysts-4 | **Scrub commit (release).** Release the scrub. | The landing row is revealed — scrolled into view, not merely selected. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-catalysts-5 | **Chip readout.** While scrubbing, read the chip. | The chip names the thing under the cursor in the page's OWN words (a ticker, a note title, a date), never a bare index. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-catalysts-6 | **Chart it** ⭐ (`catalysts.chartIt`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The route changes to `chart`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-catalysts-7 | **Flag** ⭐ (`catalysts.flag`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-catalysts-8 | **Why?** ⭐ (`catalysts.why`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The route changes to `/ai-search`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-catalysts-9 | **Filter** ⭐ (`catalysts.filter`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-catalysts-10 | **Note** ⭐ (`catalysts.note`) — flick to it from the pad. Then repeat with **no symbol** in context: the bubble must render **DISABLED with a reason, never hidden**. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-catalysts-11 | **Voice** (`catalysts.voice`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-catalysts-12 | **Home** (`catalysts.home`) — flick to it from the pad. | The Home fan returns. No navigation happens on its own. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |

## notebook — /journal/notebook  ⭐ **LEFT PREVIEW SINCE INCREMENT 2 — every row below is untested on glass**

| # | Step | Expected | Device | Runner | Result |
|---|---|---|---|---|---|
| GS-notebook-1 | **Primary (tap).** Tap the pad once. (The chip says “tap: next note”.) | The cursor steps **once** and the target scrolls into view. ⛔ Exactly one step per tap — a double step is the tap firing twice. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-notebook-2 | **Scrub (drag y).** Press and drag along y to scrub. | The cursor moves with the thumb over the `notebook` list, and the page follows it. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-notebook-3 | **Chip readout.** While scrubbing, read the chip. | The chip names the thing under the cursor in the page's OWN words (a ticker, a note title, a date), never a bare index. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-notebook-4 | **New note** ⭐ (`notebook.newNote`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-notebook-5 | **Voice note** 🆕 (`notebook.voiceNote`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-notebook-6 | **Set ticker** ⭐ (`notebook.linkTicker`) — flick to it from the pad. | Exactly **ONE** sheet opens — the confirm sheet — never two. It names the action, and the commit button performs it. The fire haptic ESCALATES (`warn`, not `impact`). | Android only — `haptics.js` no-ops without `navigator.vibrate`, which iOS Safari does not expose | ⛔ LIVE ONLY — a haptic is felt, never asserted | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-notebook-7 | **Templates** ⭐ (`notebook.templates`) — flick to it from the pad. | Exactly **ONE** sheet opens — the confirm sheet — never two. It names the action, and the commit button performs it. The fire haptic ESCALATES (`warn`, not `impact`). | Android only — `haptics.js` no-ops without `navigator.vibrate`, which iOS Safari does not expose | ⛔ LIVE ONLY — a haptic is felt, never asserted | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-notebook-8 | **Daily plan** ⭐ (`notebook.dailyPlan`) — flick to it from the pad. | The route changes to `/journal/notebook?new=daily-prep`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-notebook-9 | **Postmortem** ⭐ (`notebook.postMortem`) — flick to it from the pad. | The route changes to `/journal/notebook?new=trade-review`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-notebook-10 | **Voice** (`notebook.voice`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-notebook-11 | **Home** (`notebook.home`) — flick to it from the pad. | The Home fan returns. No navigation happens on its own. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |

## calendar — /calendar  ⭐ **LEFT PREVIEW SINCE INCREMENT 2 — every row below is untested on glass**

| # | Step | Expected | Device | Runner | Result |
|---|---|---|---|---|---|
| GS-calendar-1 | **Primary (tap).** Tap the pad once. (The chip says “tap: next day”.) | The cursor steps **once** and the target scrolls into view. ⛔ Exactly one step per tap — a double step is the tap firing twice. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-calendar-2 | **Reverse (double-tap).** Tap twice inside the double-tap window (`DOUBLE_TAP_MS` 280). | The cursor steps **back** one. A single tap must not also fire. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-calendar-3 | **Scrub (drag y).** Press and drag along y to scrub. | The cursor moves with the thumb over the `calendar` list, and the page follows it. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-calendar-4 | **Scrub commit (release).** Release the scrub. | The landing row is revealed — scrolled into view, not merely selected. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-calendar-5 | **Chip readout.** While scrubbing, read the chip. | The chip names the thing under the cursor in the page's OWN words (a ticker, a note title, a date), never a bare index. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-calendar-6 | **Macro** ⭐ (`calendar.macro`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-calendar-7 | **My names** ⭐ (`calendar.myNames`) — flick to it from the pad. | The route changes to `/calendar/mystocks`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-calendar-8 | **Voice** (`calendar.voice`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-calendar-9 | **Home** (`calendar.home`) — flick to it from the pad. | The Home fan returns. No navigation happens on its own. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |

## home — /dashboard

| # | Step | Expected | Device | Runner | Result |
|---|---|---|---|---|---|
| GS-home-0 | _This mode declares no gesture bindings._ | Tap, double-tap and scrub do **nothing** here, and the chip does not promise otherwise. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-home-1 | **Scan** (`home.scan`) — flick to it from the pad. | The route changes to `scan`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-home-2 | **Chart** (`home.chart`) — flick to it from the pad. | The route changes to `chart`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-home-3 | **Breadth** (`home.breadth`) — flick to it from the pad. | The route changes to `breadth`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-home-4 | **Wire** (`home.wire`) — flick to it from the pad. | The route changes to `wire`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-home-5 | **Flow** (`home.flow`) — flick to it from the pad. | The route changes to `flow`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-home-6 | **Journal** (`home.journal`) — flick to it from the pad. | The route changes to `journal`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-home-7 | **Notebook** (`home.notebook`) — flick to it from the pad. | The route changes to `notebook`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-home-8 | **Calendar** ⭐ (`home.calendar`) — flick to it from the pad. | The route changes to `calendar`, once. Nothing is written. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-home-9 | **Voice** (`home.voice`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |

## flow — /options-flow

| # | Step | Expected | Device | Runner | Result |
|---|---|---|---|---|---|
| GS-flow-0 | _This mode declares no gesture bindings._ | Tap, double-tap and scrub do **nothing** here, and the chip does not promise otherwise. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-flow-1 | **Voice** (`flow.voice`) — flick to it from the pad. | The action runs once and the fan closes. | both | Live preferred | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |
| GS-flow-2 | **Home** (`flow.home`) — flick to it from the pad. | The Home fan returns. No navigation happens on its own. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |

## The two named doors — run these on BOTH devices, whatever else is skipped

| # | Door | Step | Expected | Device |
|---|---|---|---|---|
| D4 | **A real touch surface honours `flickable:false`** | `journal.close` — eight fast flicks at it, then ONE deliberate press as the control. | 0 of 8 fire. The control DOES fire. ⛔ Without the control this row proves nothing: a bubble that never fires because the fan never opened would also read 0/8. | both |
| D1 | **The no-drag door** | With **VoiceOver** (iOS) / **TalkBack** (Android) running, reach the Actions button and operate EVERY action in the sheet — including a `confirm` action's numeric field and its ± steppers — with **no drag at any point**. | Every action is reachable and fires, and the confirm commits at the ADJUSTED value. This is the EQUAL path the sheet exists for, not a lesser one. ⛔ Two-finger Peek is NOT this door and was removed: screen readers consume two-finger tap, and two pointers fails WCAG 2.5.1 on its face. | both — iOS uses VoiceOver, Android TalkBack |

⛔ **An unfilled row is OPEN, never PASS.** This programme has already recorded a device
template coming back blank four times and nearly being read as a pass; the rule that came out
of it is the one that governs this sheet — **an absent result is not a pass, it is an absent**
**result.**
