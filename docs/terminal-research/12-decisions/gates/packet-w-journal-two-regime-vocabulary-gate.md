---
id: PACKET-W
title: RG-32 — journal_two's Exposure-Rating bucket is called "regime" and collides with voice_regime_classifier's real regime, in the same Compass conversation — decision gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET W — one word, two different classifiers, one Compass chat

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-23
APPROVED AT SHA:  425778f2c
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs this finding.
> **Non-collision:** `PACKET-W` appears nowhere in either worktree — grepped fresh
> against `docs/terminal-research/12-decisions/gates/**` and `.scopes/**` in
> `terminal-research`, and the entire `s7-price-level` worktree, immediately before
> writing this file. Every letter A through V is taken (including C, D and V, which
> are not on the previously-circulated known-taken list but are present on disk);
> W is not.

⛔ **ZERO PRODUCT CODE.** This packet is a decision request. No file under `api/**`
or `app/**` has been edited to produce it. Whichever option the owner signs below,
the **approved build scope is CP1 only** — the narrow fix named in that option, not
a broader regime-system refactor, not a rename of internal identifiers, not a
touch to stored data.

---

## 1 · The finding, re-verified fresh against current source (2026-09-22)

RG-32 (`docs/terminal-research/00-program-control/RESEARCH_GAPS.md`, filed
2026-09-02) reported: `journal_two/regime.py::classify_regime()` is a 4-tier
bucketing of the UCT Exposure Rating score, exposed at `/api/j2/regime`, feeding
Journal 2.0's `RegimeSection`/`CompassOverview` — and it is also what
`coach_chat.py` injects as ambient "today's regime is X" context in Compass **text
chat**, while that same chat's `get_regime` **tool** call returns
`voice_regime_classifier`'s different 5-way market classification. A member can
see two different regime words in one conversation.

**This still holds, line for line, against `feat/s7-price-level` HEAD today** —
re-read from source, not from the old citation:

| RG-32 cited (2026-09-02) | Re-located today | Still does what RG-32 said? |
|---|---|---|
| `coach_chat.py:155-165` | `_current_regime_context()`, now **`coach_chat.py:155-171`** | Yes — reads `journal_two.regime.get_current_regime()`, builds `f"\n\n[Live market context: today's regime is {r}"`, `r ∈ {green, amber, orange, red}` |
| `coach_chat_tools.py:1788-1792` | `get_regime` tool entry, now **`coach_chat_tools.py:1788-1794`** | Yes — `"executor": _voice_delegate("get_regime")` |

`api/services/journal_two/regime.py:21-31` is unchanged in substance:

```python
def classify_regime(score: float | None) -> str | None:
    if score is None:
        return None
    s = float(score)
    if s >= 90:  return "green"
    if s >= 50:  return "amber"
    if s >= 15:  return "orange"
    return "red"
```

— a pure bucketing of ONE input, the UCT Exposure Rating (0-150), read via
`_read_exposure()` → `engine.get_breadth()["exposure"]["score"]` (`regime.py:34-51`).
It is exposed at `GET /api/j2/regime` (`api/routers/journal_two.py:1527-1533`,
`return regime_service.get_current_regime()`).

`_voice_delegate("get_regime")` (`coach_chat_tools.py:1684-1688`) calls
`voice_tools.dispatch("get_regime", ...)`, which resolves to
`voice_tool_impls.py:1850-1854`'s `_get_regime()` →
`voice_regime_classifier.get_current_regime()` — a genuinely different, five-way,
multi-signal classifier (`api/services/voice_regime_classifier.py:1-24`):

```python
REGIMES = ("bull_trend", "bull_correction", "distribution", "chop", "bear_trend")
```

— scored from `pct_above_50ma`, `pct_above_200ma`, new-highs/lows, VIX,
distribution-day count, breadth score, **and** the UCT Exposure Rating as one vote
among several (`voice_regime_classifier.py:69-199`), with a confidence score and a
prose narration. This is RG-31's already-resolved "single live authority" for
`grade_ticker`'s verdict gate and the Awareness Engine's regime-flip rule — a
materially different, broader signal than `journal_two`'s single-input bucket.

**So the collision RG-32 named is reproducible today, unchanged:** a member in
Compass text chat gets an unsolicited ambient sentence — *"today's regime is
amber"* — on every turn (four call sites build and pass `regime_suffix`:
`coach_chat.py:662/669`, `892/900`, `1153/1159`, `1238/1246`, all via
`_current_regime_context()`), and if that same member asks "what's the market
regime," the `get_regime` **tool** fires and answers something like *"Bull
correction (moderate confidence)"* — a different word, from a different
computation, in the same conversation.

⭐ **A related, self-inflicted piece of evidence that the vocabulary is already
confusing whoever writes near it:** the `get_regime` tool's own description in
`coach_chat_tools.py:1790` reads *"Current market regime (GREEN/YELLOW/ORANGE/RED)
with exposure guidance"* — describing `journal_two`'s vocabulary — while the tool
it actually calls returns `bull_trend`/`bull_correction`/`distribution`/`chop`/
`bear_trend` (`voice_regime_classifier.py:24`), and the true description live at
`voice_tool_impls.py:3775` says exactly that. The tool's own metadata has already
been miswritten once by someone conflating the two systems.

---

## 2 · What's actually touched — wider than the 2026-09-02 filing knew

Nothing in RG-32's original text was wrong, but the finding under-stated the
surface. `journal_two.regime`'s output is not read only at the two cited sites —
searching every importer of `api.services.journal_two.regime` and every consumer
of `/api/j2/regime` surfaces five more, none of which the original filing named:

| File : line(s) | What it does with the green/amber/orange/red vocabulary |
|---|---|
| `api/services/journal_two/pre_trade_verdict.py:221-227, 271` | A **second ambient LLM-prompt injection**, independent of Compass chat: builds `f"## Current regime: {regime_label or 'unknown'}"` into the Pre-Trade Verdict's prompt — the 🧭 button on `AddPositionModal`. Same vocabulary, same collision shape, a surface RG-32 did not cite. |
| `api/services/journal_two/overview.py:109-116, 286` | Surfaces `regime_label` as `overview["regime"]`, read by `CompassOverview.jsx:53` — `{regime && <span>Regime: <strong>{regime}</strong></span>}` — a member-visible "Regime: green" string on the Compass Overview capstone card. |
| `api/services/journal_two/trades.py:33, 190, 217, 492, 519, 802-807, 859, 888, 974-977, 998` | **Stamps `j2_trades.regime` at trade creation** from `regime_service.get_current_regime().get("regime")` — a persisted per-trade column, not just a display string. Broker/CSV/historical imports store `NULL` by design (comment at `trades.py:802-803`). |
| `api/services/journal_two/regime_backfill.py` (whole file) | Admin-only batch job that back-fills historical `j2_trades.regime` from breadth history, reclassifying each past day's Exposure Rating through the SAME `classify_regime()` — so the four-tier vocabulary is baked into potentially years of historical trade rows, not just a live read. |
| `app/src/pages/journal-2-0/components/insights/RegimeSection.jsx` (whole file, esp. lines 26-35, 118-123) | Renders "Win rate by regime" analytics with a **hardcoded** `REGIME_META` object keyed on exactly `green`/`amber`/`orange`/`red` — any other value falls through to an unstyled grey dot with the raw string as its own label. |
| `app/src/pages/journal-2-0/hooks/useJ2CurrentRegime.js` | SWR hook on `/api/j2/regime`, 5-min refresh. |
| `app/src/pages/journal-2-0/components/AddPositionModal.jsx:120-124, 662-666` | Uses the current regime word as a **lookup key** into `settings.regimeSizeMultipliers` to auto-scale the default position-size percent (`regimeMult`), and shows the scaled-size explanation text to the member. |
| `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx:133-141, 656-668` | Member-editable **Settings** UI: four numeric inputs literally keyed `green`/`amber`/`orange`/`red`, saved into the account's stored settings JSON as `regimeSizeMultipliers`. |

**This last pair matters more than a display label.** `regimeSizeMultipliers` is a
member-configured, per-account **position-sizing** feature keyed on the literal
strings `green`/`amber`/`orange`/`red` — not just copy on a screen, but a stored
settings dictionary a member has typed numbers into.

**A fourth naming scheme for the same underlying score already exists, live, and
neither option below can ignore it.** `api/services/quote_of_the_day.py:13, 153`
reads `wire_data["game_plan"]["exposure_tier"]` — produced by the morning-wire
engine's `discipline.py` (external repo) — with FIVE tier words: **Aggressive /
Constructive / Neutral / Caution / Defensive**. This is a *different* vocabulary
for a *related* concept (it also derives from the UCT Exposure Rating, per its own
docstring) already shipping today, driving Quote-of-the-Day tag selection. The
literal phrase **"exposure tier"** is not free to reuse verbatim without either
colliding with this fifth reading of the same score, or requiring readers to
learn that "exposure tier" means one specific 4-word set in Journal 2.0 and a
different 5-word set on the Dashboard.

---

## 3 · Option A — rename `journal_two`'s output

**What actually has to change, read from the sites above, not guessed:**

- The word **"regime"** stops appearing in every place a member or an LLM reads it
  as a description of `journal_two`'s Exposure-Rating bucket:
  - `coach_chat.py:165-168`'s ambient sentence (`"today's regime is {r}"` →
    something that does not say regime)
  - `pre_trade_verdict.py:271`'s prompt line (`"## Current regime: {label}"`)
  - `CompassOverview.jsx:53`'s rendered "Regime: **green**" string
  - `RegimeSection.jsx`'s header ("Win rate by regime") and help copy ("What are
    regimes?")
- **The four-tier bucket itself (`green`/`amber`/`orange`/`red`) does NOT change.**
  It keeps its current meaning (an Exposure-Rating-only read) and its current
  thresholds. This is a vocabulary fix, not a scoring change.
- **Stored data is untouched.** `j2_trades.regime` keeps its column name and its
  existing values; `regime_backfill.py` keeps computing the same four labels;
  `settings.regimeSizeMultipliers` keeps its keys. Nothing here requires a
  migration, because the VALUES were never the collision — only the WORD used to
  introduce them to a member or a model was.
- **`/api/j2/regime`'s response shape is a judgment call, not a requirement.**
  Renaming the internal field key (`regime` → e.g. `exposureBand`) would touch
  every one of the eight consumer sites in §2, for a purely cosmetic gain (the
  field is never itself shown to a member — only the rendered label is). The
  narrow fix does not require it; a wider one could choose to, but that is
  explicitly out of this packet's CP1 scope.
- **The rename target must not be "exposure tier" verbatim** — see §2's fourth
  vocabulary. A distinct label is needed. `RegimeSection.jsx`'s own docstring
  already calls this "the market's exposure backdrop at entry" — **"Exposure
  Backdrop"** (or "Risk Backdrop") is a label already latent in this repo's own
  language and collides with nothing.

**Is it purely a relabeling?** Mostly yes, with one real piece of work: the
`get_regime` tool's OWN description (`coach_chat_tools.py:1790`) is currently
wrong regardless of which option is chosen (it describes `journal_two`'s
vocabulary for a tool that returns `voice_regime_classifier`'s) and must be
corrected to describe what the tool actually returns — that fix is common to
both options and is included in CP1 either way.

---

## 4 · Option B — route `journal_two`'s regime through `voice_regime_classifier`

**Would this make sense product-wise?** No — for three concrete reasons, each
grounded in what §1/§2 found, not a guess:

1. **It changes what a stored, historical number MEANS, mid-series.**
   `j2_trades.regime` already holds `green`/`amber`/`orange`/`red` for every trade
   ever logged (live-stamped at entry, and back-filled for history via
   `regime_backfill.py`). Rerouting the live-stamping call to
   `voice_regime_classifier` would start writing `bull_trend`/`bull_correction`/
   `distribution`/`chop`/`bear_trend` into the SAME column going forward, while
   every existing row keeps the old four-word vocabulary — one column, two
   incompatible vocabularies, split at an arbitrary date nobody chose on
   purpose. `RegimeSection.jsx`'s `REGIME_META` (hard-coded to the four old
   keys) would render every future trade's bar as an unstyled grey "unknown
   regime" dot — a broken UI on day one, not a data-quality nuance.

2. **It silently defeats a member-configured safety-adjacent feature.**
   `AddPositionModal.jsx` looks up `settings.regimeSizeMultipliers[currentRegime]`
   to scale the *default* position size, and `PortfolioSettingsModal.jsx` lets a
   member type numbers under the four labels `green`/`amber`/`orange`/`red`. If
   `currentRegime` starts coming back as `bull_trend` etc., every member who
   configured this lookup finds it returns `undefined` forever — the multiplier
   silently stops applying, with no error, no notice, and no code change visibly
   touching that feature. That is a regression in a sizing control, introduced by
   changing a function three files away.

3. **It disconnects Journal 2.0 from the SAME color vocabulary the rest of the
   dashboard already uses for this exact score.** `journal_two/regime.py`'s own
   docstring says its four tiers are chosen to **match the existing Breadth
   Monitor thresholds** (`>=90/50/15`, the identical cut points `Breadth.jsx`'s
   `colorFn`, `MarketBreadth.jsx`'s `scoreColor`, and the Heatmap's `expTier` all
   use for the UCT Exposure Rating). `RegimeSection.jsx`'s own `REGIME_META`
   comment says its colors are "color-coded like the app's exposure backdrop."
   Rerouting through `voice_regime_classifier` — a genuinely different,
   multi-signal read — would mean a member could see "UCT Exposure Rating: 92
   (green)" on the Breadth tab and "Regime: Bull correction" on the Journal tab
   for the same day, computed from a blend that INCLUDES but is not equal to the
   Exposure Rating. That is not fixing the vocabulary collision RG-32 found — it
   is trading it for a second, harder-to-notice one (two numbers that look like
   they should agree and don't, rather than two words in one chat window).

**Does anything currently depend on the Exposure-Rating-specific meaning?** Yes,
concretely: the position-sizing multiplier feature (item 2 above) is built and
member-facing specifically because `journal_two`'s regime is a **risk-posture**
read, not a **market-technical** read — a trader configuring "size down 50% in a
red regime" is reasoning about the firm's own recommended exposure level, which
is exactly what the Exposure Rating measures and `voice_regime_classifier`
measures only partially (Exposure Rating is one of several votes in that
classifier, per `voice_regime_classifier.py:169-182`). Rerouting would replace a
narrow, purpose-built signal with a broader one that answers a related but
different question, for a feature that was built to answer the narrow one.

---

## 5 · Recommendation

**Option A (rename).** Grounded in what was actually read, not preference:

- The underlying VALUE (`green`/`amber`/`orange`/`red`, derived purely from the
  UCT Exposure Rating) is doing a job three other surfaces already depend on
  (per-trade tagging, historical backfill, member-configured position sizing) —
  none of which asked for a market-technical regime read, and all of which would
  break or silently change meaning under Option B.
- The actual defect RG-32 named — a member hearing two different regime words in
  one Compass conversation — lives entirely in WORD CHOICE at two ambient
  injection sites (`coach_chat.py`, and the newly-found `pre_trade_verdict.py`)
  plus the member-visible copy in `CompassOverview.jsx`/`RegimeSection.jsx`. None
  of that requires touching the classifier, the stored data, or the settings
  schema.
- Option B does not remove a vocabulary collision — it relocates it from "two
  words in one chat" (visible, self-evidently wrong, exactly what RG-32 caught)
  to "two numbers on two tabs that quietly stop agreeing" (invisible, and this
  packet found no rail that would catch it).

**A third option is not warranted.** The two the original filing proposed
already bracket the real trade-off; nothing found in re-verification suggests a
third path (e.g., showing both labels together) would be cheaper or clearer than
picking one word and using it consistently.

---

## 6 · The decision

```
CHOOSE ONE:

  A) RENAME — journal_two's Exposure-Rating bucket stops being called "regime"
     everywhere a member or an LLM reads it. The four-tier bucket
     (green/amber/orange/red) and its meaning are UNCHANGED. Stored data,
     API field names, and the settings schema are UNCHANGED. Only the WORD
     "regime" is retired from: coach_chat.py's ambient system-prompt line,
     pre_trade_verdict.py's ambient prompt line, and the member-visible copy
     in CompassOverview.jsx / RegimeSection.jsx. A replacement label is chosen
     that does not collide with the already-live game_plan.exposure_tier
     vocabulary (Aggressive/Constructive/Neutral/Caution/Defensive) — see §3.

  B) REROUTE — journal_two's regime.get_current_regime() (and therefore
     /api/j2/regime, the two ambient injection sites, RegimeSection,
     CompassOverview, and the regimeSizeMultipliers lookup) call
     voice_regime_classifier.get_current_regime() instead of bucketing the
     Exposure Rating score. The four-tier bucket is retired. Historical
     j2_trades.regime values are NOT migrated under this packet's scope —
     that would be a separate, larger decision.

CHOOSE: A
```

**Decided 2026-09-23.** Not an owner deliberation between A and B — the owner explicitly
delegated this specific choice to the AI session, in chat, after being asked directly to name
a letter on two separate occasions. Recorded honestly as such rather than written up as if
the owner personally weighed the two options. A is this packet's own §5 recommendation,
accepted as given: the green/amber/orange/red vocabulary is doing real work elsewhere
(persisted per-trade tagging, historical backfill, member-configured sizing) that specifically
wants the narrow Exposure-Rating-only signal B would silently break.

**Recommendation: A.** Reasoning in §5.

---

## 7 · Proposed checkpoint — CP1 only, narrow either way

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | Whichever option is signed above, and nothing else. **If A:** retire the word "regime" from the two ambient LLM-prompt injection sites (`coach_chat.py::_current_regime_context`, `pre_trade_verdict.py`'s regime line) and the member-visible copy in `CompassOverview.jsx` + `RegimeSection.jsx` (header + help text), replacing it with one consistent, non-colliding label chosen per §3; correct the `get_regime` tool's own description (`coach_chat_tools.py:1790`) to describe what it actually returns. Values, stored data, API field names, DB columns, and the settings schema are untouched. **If B:** replace the one function `journal_two/regime.py::get_current_regime()`'s implementation to call `voice_regime_classifier.get_current_regime()` and adapt its three callers' consumption of the returned shape (`/api/j2/regime`, the two ambient injection sites, `overview.py`) to the new 5-way label; **explicitly excluded from CP1**: any data migration of existing `j2_trades.regime` values, any change to `RegimeSection.jsx`'s per-trade analytics grouping, and any change to `AddPositionModal`/`PortfolioSettingsModal`'s `regimeSizeMultipliers` feature (which would need its own follow-up decision under B, not bundled here). | none | **S** |

### Explicitly OUT of CP1, either way

- No broader regime-system refactor (RG-31's resolution — `voice_regime_classifier`
  as the single authority for `grade_ticker`/Awareness Engine — is closed and
  untouched by this packet).
- No rename of internal identifiers (`j2_trades.regime` column, the `regime` key
  in `/api/j2/regime`'s JSON response, `regimeSizeMultipliers`'s dict shape) under
  Option A.
- No migration of historical `j2_trades.regime` values, no change to
  `regime_backfill.py`, under either option.
- No change to the game_plan `exposure_tier` vocabulary or its Quote-of-the-Day
  consumer.

### Risk

**Low, under either option, because CP1 is scoped to exactly one packet-approved
fix.** Option A's risk is confined to copy/prompt-string changes with no data or
schema impact. Option B's risk — silently breaking `regimeSizeMultipliers` and
splitting `j2_trades.regime`'s vocabulary mid-series — is exactly why CP1
explicitly excludes touching those two surfaces even if B is chosen; a full
Option-B build would need a second gate covering that fallout before shipping.

### MUST-BUILD, exactly (populated once §6 is signed — not before)

Left unwritten on purpose: writing implementation steps for an unsigned decision
would itself be scope creep past CP1. Whichever letter is chosen, the next step is
a short MUST-BUILD list scoped to that letter's row in §7's table above — nothing
broader.
