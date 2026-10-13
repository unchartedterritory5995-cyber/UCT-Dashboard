# UCT Agent — breadth capability contract (2026-10-12)

One data system. The Agent answers breadth questions from the same services the breadth charts use:
it adds no breadth engine, no copy of the data and no recalculation. This page says, for each kind of
question, which existing service answers it, what the answer means, and where its limits are.

## Sources (all existing; the Agent only reads)

| Question | Agent tool | Service (owner) | Same data as the charts? |
|---|---|---|---|
| A reading now / today (present tense) | `breadth.show` mode `value`, `date` null, `basis` null | `breadth_current.reading()` (Breadth), reading the live-universes payload `breadth_live_universes.payload()`; behind `AGENT_BREADTH_CURRENT` | Yes. A chart's developing bar comes from the same payload, under the same freshness rule (`row_observation`) since 57c34f7c10 |
| A closing value / a reading on a date | `breadth.show` `value` with `basis: "close"` or `date` | `market_intel.breadth_reads.read()` (MI), finalized only (D5) | Yes. `_sealed_series` reads `breadth_symbols.build_breadth_bars(sym, "D")` and cuts at the last finalized session |
| Two dates compared | `breadth.show` `compare` | `breadth_reads.read()` | Yes (finalized) |
| A period summarised (first / last / low / high / average) | `breadth.show` `series` | `breadth_reads.read()` | Yes (finalized) |
| When a condition held: last / first, crossings, counts, episodes | `breadth.history` | `market_intel.breadth_events` (MI), using the Slice 2 condition core over `breadth_reads.sealed_series()` | Yes (finalized daily) |
| General "how's breadth?" | `breadth.show` with `metrics: []` | The four-measure overview, read per measure through the rows above | Yes |

## Universes and measures

| Universe | Finalized history | Current reading (`AGENT_BREADTH_CURRENT` on) | History search |
|---|---|---|---|
| US | US Breadth V2 (point-in-time membership); daily from about 2008 | % above 5/10/20/40/50/100/150/200-day SMAs, up/down movers, ratios: **validated**. Adv/dec, Stage 2/4 counts: **approximate** (labelled as such). NH/NL family: **finalized only** (see below). | Every finalized measure; daily |
| NYSE, Nasdaq | Exchange breadth V1, each under its own authority | Same tiers as US | Same |
| UCT | Shown on the Breadth page | Not available to the Agent (licensing T-75/L2: the live row is anchored to the collector) | Not available; answered honestly with a link to the Breadth page |

The Agent never conflates universes. Each card names its universe and draws only that universe's
series. The S&P 500 is not one of these universes.

## What every answer states

- **Value.** Formatted by MI's `breadth_answer.fmt_value` with the measure's unit. Never recomputed.
- **Observation date / time.**
  - Finalized: "As of <date> close".
  - Current: the contract's label ("Intraday · 11:51 AM ET", "Provisional close · Oct 12"), built from the vendor's data time and never from compute time.
- **Status.** Live (intraday), provisional close, finalized, or unavailable.
  - When no current reading exists, the card shows Breadth's **newest completed session** (`latest_completed`, 2026-10-13 incident) with its own label ("Provisional close · Oct 12" / "Finalized close · Oct 9") and: "Live breadth isn't available right now, so this is the latest completed session — not a current reading." Never "now", "live" or "intraday". It is used only when `current` is False, only if it is no older than MI's finalized close and, for a finalized session, newer than it; NH/NL (finalized-only) never take a provisional session.
  - When neither exists (or Breadth's field is absent or malformed), the card says: "No current breadth reading is available right now — this is the latest finalized close, shown as historical context."
  - A finalized answer that lags the last completed session names the sessions not yet finalized (dates only).
  - An older reading is never presented as today's.
- **History searches** also state:
  - the condition: strict (`below` / `above`) or inclusive (`at or …`);
  - the searched window and the number of sessions searched;
  - sessions with no finalized value, which never qualify and break a stretch;
  - whether a stretch is still running at the latest finalized session.

## Search semantics (`breadth.history`; MI's definitions)

- **Level conditions.**
  - `below` / `above` are strict; `at_or_below` / `at_or_above` include the level.
  - `count` returns qualifying `sessions` AND separate `episodes`.
- **Crossings.**
  - `crosses_below`: the previous valid session ≥ level and the current < level.
  - `crosses_above`: the mirror.
  - A crossing compares two CONSECUTIVE valid sessions only. `count` returns `events`. A crossing has no episode, so `episodes` / `longest` / `last_episode` are refused.
- **Episodes.**
  - An episode is a maximal run of consecutive qualifying finalized sessions; a missing session ends it.
  - `ongoing` means it reaches the end of the searched window.
  - `began_before_window` means it was clipped by `start`.
- **Windows.** `start` / `end` are optional, and the default is all finalized history.
- **Aggregation.** Daily only; `weekly` is reserved in the interface and refused for now.
- **Validation.**
  - The level must be a possible value for the measure (a percentage is 0–100).
  - Unknown fields are refused.
  - A refusal reads nothing.
- **Lowest / highest in a period.** `breadth.show` `series` (its low and high come with their dates). A named period that isn't a date range ("the 2022 bear market") gets a question asking for its dates; it is never guessed.

## Above and below a moving average (2026-10-13)

UCT stores one measure per moving average: the percentage of stocks ABOVE it.
- **Definition.** Strictly `close > MA`, over the names with enough history for the window, rounded to 0.1 (`breadth_live._pct`). The finalized series is the same measure.
- **Below.** Members ask about the share below. Its exact complement is the share AT OR BELOW: `100 − above`, on the same denominator. A name exactly on its average counts as "at or below".
  - `breadth.show` takes `side: "below"`. The route complements MI's result before the view, text and current-reading overlay (`breadth_present.complement` / `complement_reading`).
  - The card is labelled "% of Stocks At or Below 50-Day MA". `side` never reaches MI, and no second dataset exists.
- **Where it applies.** `side: "below"` is answered for one reading (`mode: value`) of `pct_above_*` measures only. Comparisons, ranges, mixed measures and non-MA measures are refused with one sentence; they are not guessed.
- **History in below terms.** A condition on the share at or below is searched as the complementary condition on the stored measure, at level `100 − X`:
  - below-share > X ⇔ above < 100 − X;
  - below-share ≥ X ⇔ above ≤ 100 − X;
  - the mirrors for `<` / `≤`;
  - crossings swap direction.

  "Fewer than / more than / at least / at most X% were above / below" is translated deterministically. "That" or "it" after a below-reading uses the same translation.

**Follow-ups answered without the model** (the remembered subject holds names only, never a value):
- "what about the Nasdaq?" / "and NYSE?" switches the universe (a reading, or the last search).
- "what about the 200?" / "and the 50-day?" switches the moving average.
- "and how many are below it?" / "what % are above it" switches the side.
- "how long did it stay below 10%?" / "how long did that last?" asks for the episode: the remembered search's condition and window, or the condition named in the question.

A bare universe word never switches anything. With no subject, each of these goes to the model.

## Isolation (unchanged, and pinned by tests)

- **Local only.** `breadth.show` and `breadth.history` are local-only (`turn.LOCAL_ONLY_ACTIONS`). Their dates and values go only to the member's transcript.
- **Model-facing note.** The model sees a value-free note rebuilt from validated args: `breadth_reads.validate()` or MI's `breadth_events.request_note()`. The member's own threshold may appear in it; a searched date or value never does.
- **Logs** record statuses only.
- **Chat naming** reads no saved view.
- **Admin only.** Both routes depend on `require_admin_dark`.

## Net new highs / lows today: why the Agent showed the Oct 9 close (2026-10-12, root cause)

**What happened.** At about 17:20 ET on Oct 12, "net new highs/lows today for US, Nasdaq, NYSE" showed the finalized Oct 9 values. The card said the measure is "published from finalized closes only".

**Cause: a contract tier, not missing data and not an Agent bug.**
- `breadth_current.UNVALIDATED_LIVE` puts the NH/NL family in the `finalized_only` tier. So `reading()` never offers a provisional or intraday NH/NL value, and the Agent shows the latest finalized close (Oct 9).
- The tier exists because the Oct 12 production replay graded the closing-price method, which is not what is served. The grade on NH/NL's own intraday basis was deferred.

**Was Oct 12 data available?** By design, yes, as a PROVISIONAL row in the live payload. `_apply_nhnl` fills today's NH/NL from the intraday basis (`live_counts`) when the ring ends at the prior session; the settled series value lands about 18:35 ET.
- After the close, the chart (`append_library_bars`) DRAWS that provisional Oct 12 NH/NL bar, because it applies the freshness rule but not the accuracy tier.
- So the chart and the Agent agree on every value both publish (the finalized Oct 9 value is the same intraday basis on both). They disagree on publication state for today's provisional NH/NL row.
- Confirming the actual production payload at 17:20 ET would need a separately authorized read.

**Two coherent options (a Breadth / owner decision; NOT implemented).**
- **A. Consistency now.** The chart also withholds the `finalized_only` tier's provisional / live NH/NL bar, so both surfaces show the finalized close until the series settles.
- **B. Validate, then promote** (Breadth's recommendation). Grade the provisional NH/NL (`live_counts` at the close) against the settled intraday-basis series. If it passes, move NH/NL to validated / approximate; the Agent then shows "Provisional close · Oct 12" like the chart.

**An Agent wording fix, awaiting approval.** "Published from finalized closes only" is inaccurate while the chart draws a provisional bar. Proposed wording: "Today's net new highs/lows is provisional and not yet validated for UCT Agent — showing the latest finalized close (Oct 9)."

## Known gaps

- Weekly-close searches: the interface is reserved, the search is not built.
- Cross-asset conditions ("breadth this low while QQQ was at a high").
- Live-versus-historical comparisons: comparisons stay finalized-only, and their newest tile reads "Latest close".
- The UCT universe in the Agent.
- Promoting the NH/NL current reading (option B above).
