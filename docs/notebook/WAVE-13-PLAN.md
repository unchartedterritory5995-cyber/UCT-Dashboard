# Notebook wave 13: plans that grade themselves, your own edge, and 100 beta testers (DRAFT, 2026-10-02)

> **STATUS: DRAFT.** Two competitive-research reports (trader journals; notes, AI and investor
> research tools) are still running. Section 1 is the slot they fill. Lanes 13A-13D, 13T and 13Q
> are the owner's and are planned in full here. The "up to three more" lanes (section 4) are
> **candidates, not decisions**: the research picks them. Do not dispatch section 4 from this
> draft.

Written by the wave-13 planner (session 441b0c89), read-only on code, from
`origin/feat/notebook-w12-landing` at `0c437e7c6d` (wave 12 is not merged yet). It extends
`NOTEBOOK-10-OF-10-PLAN.md` and `WAVE-12-PLAN.md`; it replaces neither.

The owner's goal, as briefed: make the Notebook *"extremely valuable and a major competitor for
the biggest and best notetaking and journal products on the market, but geared only towards
traders, with real trading and stock market value and focus"*, and *"ready to hire 100 live beta
testers and get their feedback"*.

Every `file:line` below was read at `0c437e7c6d`. A line number is a dated claim: re-read the line
before acting on it (R-CITE).

---

## 0. What the brief assumed that the tree does not say

1. **Per-setup stats already exist, three times.** `playbook_stats.get_playbook_stats`
   (`api/services/journal_two/playbook_stats.py`:92) computes per setup: profit factor, expectancy
   in dollars and in R, exit efficiency and rule adherence. `setup_stats.get_setup_stats`
   (`setup_stats.py`:18) computes one setup for the trade-entry panel. Compass computes its own
   through `coach_chat_tools._exec_get_aggregates` / `_breakdown_trades`
   (`coach_chat_tools.py`:84, :103), which `personal_edge.edge_for_setups` reads
   (`personal_edge.py`:39-46). **13B must build on `playbook_stats`, the richest of the three,
   and add no fourth.** `personal_edge.py` is the thinnest, not the authority.
2. **"Thin sample" means two different numbers today.** The Insights cards grey a stat below
   n=10 (`playbook_stats.py`:40-41; `components/insights/PlaybookSection.jsx`:7). Compass calls a
   setup "thin" below n=25 (`personal_edge.py`:15, :75-77). 13B needs one ruling (section 8).
3. **A plan has no single machine-readable shape. It has four.**
   - Canvas levels: `{role: entry|stop|target|custom, price}` (`lib/tradeCanvas.js`:7-11, :69-74;
     server reader `trade_canvas.py`:62).
   - Position Tracker properties Entry/Stop/Shares/Exit (`lib/notebookTemplates.js`:272-284).
   - Labelled template text: bullets `Entry: — / Stop: — / Target(s): —`
     (`notebookTemplates.js`:954) and the setup plans' numbers table, whose row labels differ per
     setup, e.g. `Pivot (entry)` vs `Opening range high (entry)` (`:99`, `:171`, built at `:60-61`).
   - A Compass pre-trade verdict row: `j2_verdicts` stores entry, stop, **target**, shares and
     setup (`pre_trade_verdict.py`:84-106), and a trade entered against it carries the verdict id
     in `context_at_entry` (`verdict_scorecard.py`:10-17).

   **No trade or position row has a target column** (`db.py`:51-69, :78-99). The target only ever
   exists in a plan.
4. **The note-to-trade link keys on the raw row id, not the stable trade reference.**
   `j2_note_embeds` stores `trade_ref` + `trade_ref_type` (`db.py`:799-800) where the ref is
   `j2_trades.id`. Broker rows keep their id across an incremental sync (`broker/reconstruct.py`:
   230-233) but a purge reissues them (`broker/service.py`:352-363; the reason `trade_refs.py`:1-10
   exists). Every annotation that must survive that (screenshots, excursions, adherence) keys on
   `trade_refs.trade_ref_for_row` (`trade_refs.py`:16; `adherence_store.py`:1-22). **13A must key
   grades and plan links the same way.**
5. **"The plan as it was at entry" cannot always be recovered.** Properties are not versioned:
   `j2_note_versions` holds title, subtitle and body only (`db.py`:639-648), and versions coalesce
   inside a 30-minute editing session (`notes.py`:3287). So a member who edits the plan's Stop
   after the trade could silently improve their own grade. 13A freezes the plan numbers at first
   match (section 3, 13A).
6. **Broker stops are placeholders**, `stop_price == entry_price` (`awareness/rules.py`:166-167
   skips them for the same reason). A broker trade's stop can only come from the plan.
7. **Several "candidate" features already exist**: a shareable trade card
   (`lib/tradeCardPng.js`:1-16, mounted `components/trade/TradeDetailPage.jsx`:33) and Share to the
   Floor (`:18`); trade screenshots keyed on the stable ref (`trade_attachments.py`:1-14,
   `TradeDetailPage.jsx`:36); per-setup rule adherence (`adherence_store.py`, `AdherenceChecklist`
   at `:38`); deterministic mistake/emotion tag suggestions (`tag_suggest.py`:1-24); revenge-trade
   detection (`revenge_detect.py`:1-11); MFE/MAE per trade (`j2_trade_excursions`, `db.py`:
   1756-1761); a Compass weekly review and EOD recap (`api/routers/journal_two.py`:4605-4795).
   Section 4 drops or narrows candidates on that basis.
8. **The AlphaVantage 25/day budget is process memory.** `_av_bucket_used` is a module variable
   (`alphavantage_client.py`:88-92, :122-137), so every web deploy refills it while AlphaVantage's
   own counter does not. 13C must never call AlphaVantage, not even through the transcript service
   (`av_transcripts.py`:6).
9. **Email is not a delivery channel for new notices.** The task reminders say so in their own
   header: *"NEVER EMAIL: the Resend quota is exhausted daily"* (`note_tasks.py`:35-37). The
   awareness engine away-delivers (email + Discord) at importance 8 and above
   (`awareness/engine.py`:26, :268-280), and every insight kind shares one 8-per-day cap
   (`voice_proactive_service.py`:28). 13D stays in-app and under its own sub-cap.
10. **100 testers cannot sign up today.** `POST /api/auth/signup` refuses every request while
    `COMING_SOON_MODE` is on (`api/routers/auth.py`:621-625; `waitlist.py`:34-40), and there is no
    invite path anywhere in `api/`. CLAUDE.md records flipping `COMING_SOON_MODE` to create an
    account as refused permanently ("Door B"). **This is the largest beta blocker** (13T, item 1).
11. **Feedback carries no context and may outlive the account.** The widget posts only
    `{message, page: pathname, rating}` (`components/FeedbackWidget.jsx`:88-91); the `feedback`
    table's `user_id` has no foreign key (`auth_db.py`:179-187), and account deletion sweeps only
    tables with a foreign key to `users` (`auth.py`:1524-1532). Not run, so **not measured**: whether
    another path deletes feedback rows. 13T checks this before it adds note context to a feedback
    row.
12. **The Compass global dollar cap is off.** `COMPASS_COST_CAP_DAILY` unset disables it, and the
    accumulator is in memory (`compass_cost_guard.py`:7-9, :20, :35-37).
13. **The trade canvas is dark** (`docs/feature_flags.json`:1272). Plans read from canvases exist
    only for members who can make one.
14. **The 337-Tab finding was not located in the repo.** Searched `337` across `docs/notebook`,
    the a11y keyboard evidence and the notebook remote branches; no match is about Screener Tabs.
    It is recorded here as the controller's finding, not measured. The door is "Save to Notebook"
    in the Screener's save bar (`app/src/pages/screener/shell/ScannerShell.jsx`:360), a
    **Screener-owned file**; 13Q re-measures it first (section 6).
15. **"Review Date" has no reminder.** G-153's title names it, but the pass covers tasks only
    (`note_tasks.py`:1-4, :34-37; ledger `competitive-gap-ledger.md`:437). 13D covers it.
16. **S7 is absorbing the awareness rules.** The position-risk dark run compares against
    `rule_stop_watch` (`docs/feature_flags.json`, `ALERT_TAXONOMY_POSITION_RISK_DARK_ENABLED`), and the
    price-level type is a dark evaluator that cannot deliver (`alert_taxonomy/price_level.py`:1-17).
    13D adds new awareness rules and **never edits R1-R6**, never writes `user_alerts`, and never
    registers an S7 predicate.

---

## 1. Competitive findings: to be folded in

> **Placeholder.** When `research-trader-journals.md` and `research-notes-and-research-tools.md`
> land, this section gets: (a) per lane, what the best competitor does and where 13A-13D must beat
> it; (b) the ranked pick for section 4; (c) any lane whose scope the research changes; (d) new
> gap-ledger rows G-173 onward, one per lane, with a competitor citation per the parity-scorecard
> rules (a vendor page quoted verbatim, or NOT-VERIFIED).

Known going in, from the ledger: G-070 (thesis-trade link) names TradeZella, Edgewonk and
TraderSync as the external equivalents (`competitive-gap-ledger.md`:126). No ledger row yet covers
plan-vs-execution grading, a personal playbook, prepared earnings notes, or note resurfacing.

---

## 2. Rules every wave-13 lane follows

- **Cohort-scoped flags.** Every new flag reads three ways: unset or `0` = off; `beta` = on only for
  members tagged `rollout:notebook-beta`; `1` = everyone. The kill switch is read first, so `0`
  beats membership (`rollout.py`:55-56). An unrecognised value is OFF. Built once in 13T-1 (section
  5); no lane parses its own flag.
- **Numbers are deterministic.** No LLM computes, ranks or words a number in this wave. 13A-13D
  make **zero** new model calls.
- **Mirror the broker.** No lane hides, filters or excludes an imported trade. "Unplanned",
  "not gradable" and "options, not graded" are labels on a row that is still in every list, and
  every coverage line counts all trades.
- **One write path.** A lane that creates a note goes through `createNoteViaApi`
  (`lib/noteCreation.js`:21). No lane writes into an existing note from outside its editor (a
  second writer forks it). Server jobs may create NEW notes only, and only where a flag allows it.
- **Grounded and cited.** Every number on screen can be opened to the exact trades and notes it
  came from. A value that cannot be computed reads "—" with the reason, never a guess.
- **Evidence.** Raw walk output is committed under `docs/notebook/evidence/w13<x>/` before any
  summary (R-RAW). Every lane is walked in a real browser on a census-pinned sandbox at 390 and
  1200, keyboard included, flag off and flag on, with one tagged and one untagged account (D17).
- **No new TipTap node.** See the never-revert rule (section 7).

---

## 3. The owner's four lanes

### 13A. Plan vs execution grading

**What the member gets.** Every closed trade, broker-synced or manual, shows the plan that came
before it and four plain checks: *Entry: 0.2R above plan (kept)*, *Stop: exited at the planned stop
(kept)*, *Size: 1.4x the planned risk (missed)*, *Target: reached 3.10, sold at 2.40 (not taken)*. A
trade with no plan before it is flagged **Unplanned**. A running **Discipline record** reads, over
the last 20 and 60 trades: % planned, % stop kept, % sized within plan, % entries within tolerance,
and the current streak of planned trades. One click writes a short **review note**. When a
broker trade has no setup and its plan names one, a chip offers *"Tag as Base Breakout?"*.

**Reuses.**
- Plan sources, in this precedence: an explicit note link to the trade (`note_trade_links.py`:156,
  including the position-to-trade graduation at `:90-96`); the Compass verdict the trade was
  entered against (`verdict_scorecard.py`:10-17; `j2_verdicts`, `db.py`:291); canvas levels
  (`trade_canvas.py`:62); Position Tracker properties (`notebookTemplates.js`:272-284); labelled
  plan text (`:954`, `:60-61`).
- The stable trade key (`trade_refs.py`:16), the adherence store's idiom (`adherence_store.py`:1-22),
  excursions for "target reached, not taken" (`mfe_price`, `db.py`:1756-1761), the existing inline
  setup write (`PATCH /api/j2/trades/{id}`, `api/routers/journal_two.py`:1187).

**The matching rule (deterministic, never a guess).** Same member, same symbol. Candidates are, in
order: an explicit link; a verdict for the symbol created before entry; a note tagged `trade-plan`
or `position` (or a canvas) with that ticker, written within 30 calendar days before entry. If the
trade's entry carries no time, "before" is judged by day and labelled so. Two or more candidates at
the same precedence: the member picks; nothing is chosen for them. None: **Unplanned**. The member
can mark "planned outside the Notebook"; the row then says so in their words and still counts as
unplanned in the record.

**Freezing.** At first match the extracted numbers, the source note, its version id and the time
are stored. Later plan edits do not regrade. "Re-link" is the only regrade, and it is recorded. A
plan whose only version is dated after entry is graded and labelled *"plan edited after entry"*.

**The math (constants in one table, `plan_grading.py`; proposed, a ruling moves them, a reading
never does).** R unit = |planned entry − planned stop|.
- Entry kept when the fill is within 0.25R of the planned entry (direction-aware).
- Stop kept on a losing trade when the realised loss is no worse than −1.1R of the planned risk.
- Size kept when actual risk (shares × |fill − planned stop|) is within ±20% of planned risk
  (planned shares × R, or the plan's stated $ risk).
- Target: *hit* when the exit reached it; *reached, not taken* when MFE reached it and the exit was
  more than 0.25R short; *not reached* otherwise.
- A check with a missing input reads "—, plan has no stop" (for example), never a pass.
- Options strategies: listed with "options, not graded in v1" and counted in coverage.

**Files (13A owns these this wave).**
- New: `api/services/journal_two/plan_extract.py` (the ONE reader of "levels named in a note";
  13D imports it), `plan_grading.py`, `api/routers/notebook_plan_grades.py`.
- Tables, in `db.py`: `j2_trade_plan_links` (user_id, trade_ref, note_id or verdict_id, source,
  frozen_json, version_id, linked_by, created_at; PK user_id + trade_ref). The discipline record is a
  computed read, no table.
- `account_purge.py` (`_DIRECT_USER_TABLES`, `:32`), `api/services/address_space.py`.
- Frontend: new `components/trade/PlanGradeCard.jsx` (+css, test), mounted in
  `components/trade/TradeDetailPage.jsx`; new `components/insights/DisciplineRecord.jsx` mounted in
  `components/insights/InsightsHub.jsx`; an "Unplanned" chip in `components/TradesTable.jsx` (a
  label, never a filter); new `lib/planReview.js` (the review-note builder); new
  `hooks/usePlanGrade.js`.
- `lib/notebookTemplates.js`: the trade-plan and five setup-plan entries declare
  `propertyDefinitions` Entry/Stop/Target/Shares through the 12B-2 mechanism
  (`lib/templatePropertyDefs.js`:77), so every new plan is machine-readable. **Ownership of this
  file passes to 13C when 13A lands.**

**The review note.** Created on click through `createNoteViaApi`: the frozen grade table, a
`noteLink` to the plan, frozen chart embeds at entry and exit (the existing frozen-chart semantics,
`lib/tradeCanvas.js`:30-34), and the Trade Review template's headings. Linked to the trade by the
existing embed. Existing node types only.

**Flag.** `NOTEBOOK_PLAN_GRADING_ENABLED` (unset = off; `beta` / `1`).

**Rails.** The extractor on a fixture per source shape, including two conflicting entries
(unreadable, never a pick); the matcher's precedence and its "member picks" tie; freezing (edit the
plan after grading, grade unchanged; re-link regrades); the four checks long and short, with a
placeholder stop; broker mirror (a 30-trade fixture: 30 rows in, 30 rows out, coverage sums to 30);
stable keys survive a simulated purge-and-reinsert; account purge and address-space census;
route census (flag off = 404 before any session read, the `notebook_shares.py` shape).
Mutation-prove the freeze and the mirror rails.

**Real-browser walk** (`tools/notebook_w13a_walk.py`, sandbox): write a Trade Plan for a ticker,
log the trade over it manually, open the trade, read the four checks, write the review note, open
it; a second trade with no plan reads Unplanned; a broker-style trade with a placeholder stop gets
its stop from the plan; the setup chip writes the setup; 390 and 1200, keyboard only once.

**Do NOT build:** an LLM verdict on any number; any change to how trades import or reconcile; a
"plan required" gate on logging a trade; regrading on every plan edit; grading options legs.

### 13B. My Playbook: your own edge

**What the member gets.** A **My Playbook** page in the Notebook. One card per setup: trades (n),
win rate with a 95% range, expectancy in R with a range, profit factor, average hold, last five
results, and a sample label (*too few to say*, *thin*, *settled*; thresholds per the ruling in
section 8). Every number opens the exact trade rows behind it. Under each card: *From your notes*:
the plans and reviews linked to those trades. A section **What you wrote before losses vs wins**
lists word and phrase patterns with both counts and both sample sizes, e.g. *"FOMO" appears in 5 of
9 notes written before losing breakouts, and 1 of 14 before winning ones*. Each finding opens the
notes, with the matched sentence. The page says *"Patterns, not proof"*. A "Save to Notebook"
button writes a dated, frozen snapshot note.

**Reuses.**
- `playbook_stats.get_playbook_stats` (`playbook_stats.py`:92) as the single authority: 13B adds
  the range fields there (Wilson interval for win rate; a t-interval on mean R, shown only at
  n >= 10) and changes no existing field. Untagged trades stay excluded there (`:114`); 13A's setup
  chip is what brings broker trades in.
- Links: `j2_note_embeds` (`note_trade_links.py`:156) plus 13A's `j2_trade_plan_links`; the
  trade's entry-day daily note (`note_daily.py`, `daily_date`).
- The taxonomy word lists: the account's mistake and emotion tags with `tag_suggest.py`'s defaults
  as fallback (`tag_suggest.py`:33, :39), plus one short fixed list of trader phrases in one file.
  The existing emotion-tag view (`analytics._psychology_section`, `analytics.py`:1021) stays as is.
- `personal_edge.py`: **read-only reference; not edited this wave.** It reads Compass's own
  aggregate, and changing it is a Compass change that needs the report card first (CLAUDE.md,
  "Report card"). Recorded as a follow-up: make it read `playbook_stats`.

**Files.** `playbook_stats.py` (added fields only); new `api/services/journal_two/playbook_patterns.py`
(lexicon counts, deterministic); new `api/routers/notebook_playbook.py`; frontend new
`components/notebook/MyPlaybook.jsx` (+css, test), its route in `app/src/App.jsx` beside
`notebook/research/:symbol` (`App.jsx`:690); `components/insights/PlaybookSection.jsx` shows the
same ranges. No table.

**Flag.** `NOTEBOOK_PLAYBOOK_ENABLED`.

**Rails.** Interval math against hand-computed fixtures; the range is absent below the threshold
and the label is present; every displayed number equals a field of the authority (a rail parses
the card's numbers and finds each in the API payload); the pattern miner reports both counts and
both n, and finds nothing below its minimum count; a planted word in a winning-trade note moves only
the winner count; the snapshot note is frozen (data changes, note does not). Mutation-prove the
"no stat without its n" rail.

**Walk.** Seed 40 trades across three setups with linked notes; open My Playbook; drill a win rate
to its trades; open a pattern to its notes; save a snapshot; 390 and 1200.

**Do NOT build:** a fourth per-setup computation; any LLM narrative; a p-value or "significant"
wording; mining all words (fixed lists only, to keep false patterns down); auto-muting a setup;
any change to Compass.

### 13C. Earnings prep that writes itself

**What the member gets.** Notebook Home gains **Reporting soon**: every name in the member's own
sets that reports in the next 7 days, with date and before/after the bell. One click **Write prep**
creates an Earnings Prep note already filled in: report date and timing; the expected move the
options priced before the report; the last four reactions (gap and close); EPS and revenue
estimates against a year ago; the last call's recap headline and bullets; **my history on the
name** (trades, win rate, average R, and how earnings holds went); **my notes on the name** (latest
five, plus the last prep note's "After the report"); and my position going in. Each filled value
carries *Source, as of <time>* and stays as it was written (frozen at insert). A value the product
does not hold reads "—, not available".

**Reuses.** `calendar_personalization.get_user_ticker_sets` (`calendar_personalization.py`:25);
next report date (`earnings_table._next_report_date` via `api/routers/calendar.py`:4043-4085);
expected move and beat history (`_compute_enrichment_for_date`, `calendar.py`:3395-3423) and the
pre-report implied store (`implied_store.get_implied_history`, `implied_store.py`:227); reactions
(`earnings_reaction.reaction_for`, `earnings_reaction.py`:161); the stored call recap only
(`call_recap_store.get`, `call_recap_store.py`:96); the member's research summary
(`ticker_research.get_ticker_research_summary`, `ticker_research.py`:200); the existing earnings-prep
template (`notebookTemplates.js`:715-756); `templateContext.js`'s best-effort, time-boxed fetch
pattern (`lib/templateContext.js`:1-29).

**Cost, bounded by construction.** Zero model calls: a recap that does not exist yet is not
generated (generation has its own $10/day cap, `call_recap_store.py`:44, and is not 13C's to
spend). Zero AlphaVantage calls (section 0.8). Provider reads go through the functions above,
which cache. A durable per-member count `notebook_earnings_prep` in `daily_counters` caps prep
creation at 20 per member per day.

**Optional auto-draft** (its own flag, off even when 13C is on): at 18:00 ET the day before a
report, create a prep note for each **open position** reporting next session, at most 3 per member
per day, in an "Earnings prep" folder. New notes only.

**Files.** Phase 1 (from the start): new `api/services/journal_two/earnings_prep.py`, new
`api/routers/notebook_earnings_prep.py`, `notebook_home.py` (a "Reporting soon" section,
`notebook_home.py`:121), `components/notebook/ResearchHome.jsx`,
`components/notebook/TickerResearchWorkspace.jsx` (a "Write earnings prep" button when a report is
within 14 days), new `lib/earningsPrep.js`, `lib/templateContext.js`. Phase 2 (after 13A lands):
the earnings-prep entry in `lib/notebookTemplates.js` takes the context. No calendar-page edit: the
`/calendar` surface belongs to the UCT Terminal programme.

**Flags.** `NOTEBOOK_EARNINGS_PREP_ENABLED`; `NOTEBOOK_EARNINGS_PREP_AUTO_ENABLED` (auto-draft).

**Rails.** Every filled cell has a source and an as-of; a missing source yields "—" (each source
stubbed off in turn); no import of `av_transcripts` or `call_recap.get_call_recap` reachable from
`earnings_prep.py` (an import-graph rail, mutation-proved); the daily cap holds across a simulated
restart; auto-draft creates nothing for watchlist-only names and nothing twice.

**Walk.** A sandbox member with a position and a watchlist name reporting this week (fixture
calendar); Home shows both; Write prep; every section filled or "—"; the frozen values do not
change after the fixture data does; 390 and 1200.

**Do NOT build:** an LLM summary; transcript fetching; a calendar-page door; auto-drafts for
watchlist names; editing an existing prep note.

### 13D. Thesis resurfacing: "what you thought then"

**What the member gets.** A note comes back when it matters: a ticker the member wrote about
**touches a price the note named** (a canvas level, a plan's entry, stop or target), **moves 8% or
more in a session** (the existing mover insight starts at 3% and treats 8% as its top tier,
`voice_proactive_service.py`:394-399), or **reaches a date the note named** (Review Date, or the date in a catalyst note). The
notice in the bell reads *"NVDA touched 142.50, the stop in your Sep 30 plan. What you thought
then."* and opens the note **at the version that named the level**.

**Reuses (one pipeline, not two).** The awareness engine that runs G-074's thesis review:
`rule_thesis_stop_review` (`awareness/rules.py`:127-183), the member's research symbols
(`notes.bulk_member_mentioned_symbols`, `notes.py`:3014), the shared live-price read the rules
already use, and `_fire_candidate` with its dedup and cooldown (`awareness/engine.py`:237-281).
Levels come from 13A's `plan_extract.py`. The version view is the existing
`components/notebook/NoteVersionPreview.jsx`.

**The level index.** A projection `j2_note_levels` (user, note, symbol, price, role, source, version
id, last seen side), rebuilt by its own job from notes changed since a watermark. It never runs in
the save path, never writes a note, and owns its table (self-ensured, the `daily_counters`
precedent noted at `account_purge.py`:286-295).

**Delivery and limits.** In-app only: importance is set below the away-delivery floor of 8
(`engine.py`:26), so no email or Discord. At most 2 resurfacings per member per day, so the shared
8-per-day insight cap (`voice_proactive_service.py`:28) keeps room for everything else. One notice
per level per day. A level "touches" when the scan's price crosses it or comes within 0.5% of it.
Placeholder broker stops are never levels (the R1/R6 skip).

**Files.** `api/services/awareness/rules.py` (new rules R7 level touch, R8 large move on a
researched name, R9 named date; R1-R6 untouched), `api/services/awareness/engine.py` (wiring,
flag, sub-cap), new `api/services/journal_two/note_levels.py`, the job's registration in
`api/main.py` (the scaffold's reserved line), `account_purge.py` and `address_space.py` (after 13A
has landed, since 13A owns both first), `components/notebook/NoteEditorPage.jsx` (open at a version
from the notice's link).

**Flag.** `AWARENESS_NOTE_RESURFACE_ENABLED`, read like `AWARENESS_THESIS_REVIEW_ENABLED`
(`engine.py`:33-43); it runs only where `AWARENESS_ENGINE_ENABLED` and `COMPASS_AUTOMATION_ENABLED`
are on (both armed today).

**Rails.** R1-R6 output byte-identical with R7-R9 on (the S7 dark comparison reads R1); the sub-cap
and the per-level cooldown; a placeholder stop never indexed; the projection never imports the note
write path; no `deliver_alert_payload` call is reachable for these kinds; a trashed note's levels
leave the index; account purge.

**Walk.** A note with a canvas stop at 100; drive the fixture price through 100; the bell shows one
notice; open it; the version shown is the one with 100; a second cross the same day is silent; a
Review Date of today resurfaces the thesis; 390 and 1200.

**Do NOT build:** a second alert pipeline; `user_alerts` rows or S7 predicates; email or Discord;
parsing prices out of free prose (only levels the four plan shapes name); a level editor.

---

## 4. Up to three more lanes: CANDIDATES, pending the research

Ranked by value to a trader on what the tree shows today. The research decides; nothing here is
dispatched from this draft.

| rank | candidate | what exists already | what would be new | provisional verdict |
|---|---|---|---|---|
| 1 | **Weekly and monthly review that writes itself** | Compass weekly review and EOD recap from trades (`journal_two.py`:4605-4795), built from trade rows and their notes field only, not Notebook notes (`coach_data_assembler.py`:141-182); blank weekly/monthly review templates (`notebookTemplates.js`:419, :469) | One click creates the week's review note: trades and P&L, 13A's discipline record, 13B's setup changes, the week's plans, reviews and resurfaced notes as links, Compass's review quoted with its provenance when one exists. Deterministic | strongest candidate |
| 2 | **Charts at entry and exit, frozen into the trade's note** | Manual trade screenshots (`trade_attachments.py`); frozen chart embeds | Already folded into 13A's review note. A separate lane only if the research shows competitors auto-capture at the fill | likely folded, no lane |
| 3 | **Pre-trade checklist on the plan** | Per-setup rule checklist graded AFTER the trade (`db.py`:1773-1782); Compass pre-trade verdict; discipline locks | A "ready to trade" checklist on the plan note, reused by 13A's grade. Note: the product does not place orders, so a "gate" can only gate the member's own logging | lower value |
| — | Shareable trade recap card | Exists (`lib/tradeCardPng.js`, Share to the Floor) | At most a "plan kept 3 of 4" line on the card | not a lane |
| — | Tagging trades by setup from the note | Folded into 13A (the setup chip) | — | not a lane |

---

## 5. 13T: ready for 100 live testers

| # | item | exists today | what to build | lane step |
|---|---|---|---|---|
| 1 | **Accounts for 100 testers** | Signup closed while coming-soon is on (`auth.py`:621-625); no invite path; one-at-a-time pod provisioning exists for synthetic accounts only (CLAUDE.md, smoke/bench) | Single-use invite links an admin mints, bound to one email: redeeming creates the account, marks it verified, comps access the way `comp-access` does, and tags `rollout:notebook-beta`. Behind `NOTEBOOK_BETA_INVITES_ENABLED`. **Owner ruling first** (section 8); never a `COMING_SOON_MODE` flip | 13T-2 |
| 2 | Beta cohort | `rollout.py` tags with the `rollout:` prefix declared once (`rollout.py`:75), `includes` (`:127`), `assign_cohort` (`:219`); admin tag UI (`pages/Admin.jsx`:670 -> `auth.py`:1268) | `NOTEBOOK_BETA = "notebook-beta"` in `rollout.py`; the three-way flag read (section 2) in `notebook_flags.py` (`:47` today parses on/off only); the auth payload computes it per member (`auth.py`:288-306, one indexed `user_tags` read, `auth_db.py`:197); a bulk-assign tool over `assign_cohort` | 13T-1 |
| 3 | Feedback tied to page and note | Widget on desktop (`FeedbackWidget.jsx`) and in the hub on touch (`hub/contracts.js`:162-164); stored in `feedback` (`auth_service.py`:806-818); admin list (`pages/Admin.jsx`:1486) | Send `context` (note id, surface, build SHA, viewport, the wave-13 flag states) and a category (bug / idea / confusing); a "Report a bug" choice that opens a support ticket with the same context (`auth.py`:1878); a post to a beta channel via `BETA_FEEDBACK_WEBHOOK_URL` (blank = no post); an admin filter by cohort. First settle item 0.11 (purge) | 13T-2 |
| 4 | First-run onboarding | 8-step tour and sample notebook (`components/notebook/onboarding/tourSteps.js`, `sampleNotebook.js`) | One step per armed wave-13 feature, shown only when its flag is on for that member; a sample plan note | 13T-3 |
| 5 | Cost guardrails | Notebook: shared $25/day across Ask, writing help, voice and AI actions (`note_ask.py`:63, charged together `:217-224`); Ask $0.02 a question, 40/member/day (`:62-64`); writing help 60, voice 20, AI actions 20 (`:91`, `:111`, `:128`). Compass global cap off (0.12). Call recap $10/day (`call_recap_store.py`:44) | Arithmetic: $25 holds 1,250 Ask questions a day, **12.5 per member at 100 active**, before writing help draws from the same pot; when it runs dry, every member is refused for the rest of the day (`note_ask.py`:375). Wave 13 adds $0. Recommendation for the owner: `NOTE_ASK_SYNTH_COST_HARD=50` and `COMPASS_COST_CAP_DAILY=40` for the beta, plus a per-cohort spend line in the admin telemetry. Voice notes stay dark | owner + 13T-2 |
| 6 | Errors and telemetry | Client error beacon (`api/routers/client_errors.py`:1-10); Notebook SLOs, save success pages (`notebook_slo.py`:1-16); telemetry allow-list (`api/routers/journal_two.py`:73) | The wave-13 event names on the allow-list (scaffold); a cohort split in the admin telemetry view | 13T-1, 13T-2 |
| 7 | Support and bug reports | Tickets (`auth.py`:1878-2036), status light (`support_status.py`:1-7), 14 Notebook help articles (`pages/Support.jsx`:422-570) | Item 3's "Report a bug" with context; one help article per wave-13 feature | 13T-2, 13T-3 |
| 8 | Known-issues page | None | A "Known issues (beta)" section on Support from a data file, edited by deploy | 13T-2 |
| 9 | What's new | None (the bell's "what's new" is alert bookkeeping, `AlertBell.jsx`:9-12) | A dismissible card on Notebook Home from a data file, seen-state via the existing once-per gate the celebrations use (`celebrations.py`:13-15). `NOTEBOOK_WHATS_NEW_ENABLED` | 13T-2 |
| 10 | 100 concurrent on ONE uvicorn process | No concurrency tool (`tools/` has scale and OCR load tools only); `database is locked` already seen under contention (`docs/notebook/evidence/20260918-notes-500/web.jsonl`:5317) | `tools/notebook_beta_load.py`: sandbox only, refuses a non-loopback host (the `wave_p5_ocr_load.py`:9-12 rule); 100 virtual members with think time doing open, type-and-save, list, search, quick switcher, a mocked Ask, and the wave-13 reads; records p95 per route, event-loop lag, 5xx and lock errors. Pass: zero 5xx, zero lock errors, no route p95 above 2x its 1-member reading | 13T-3 (last, on the landing tree) |

---

## 6. 13Q: the click-by-click test program ("EASY IS THE KEY")

**The instrument** (13Q-1, no product code): `tools/notebook_w13q_clicks.py`, Playwright on a
census-pinned sandbox. For each flow it drives three paths: mouse (clicks), keyboard (keystrokes,
with Tab counted separately and pressed for real until focus reaches the target, capped at 600),
and touch at 390 (taps). Typing the content itself is not counted. Raw JSON to
`docs/notebook/evidence/w13q/<run>/` before any summary. **Control first:** the instrument must
reproduce the Screener's ~337 Tabs before the fix, or the instrument is wrong, not the product.

| # | flow | mouse | keys | taps (390) |
|---|---|---|---|---|
| Q1 | new blank note, cursor in body | 2 | 3 | 2 |
| Q2 | new note from a template with a ticker | 4 | 6 | 4 |
| Q3 | open a note by title (quick switcher) | 2 | 4 | 3 |
| Q4 | search a phrase, open a hit | 3 | 5 | 3 |
| Q5 | open today's daily note | 1 | 2 | 1 |
| Q6 | link a note to a trade from the trade page | 3 | 6 | 3 |
| **Q7** | **save Screener results to a note** (known: 337 Tabs) | 3 | 10 | 3 |
| Q8 | save a price or consensus fact from the ticker popup | 3 | 8 | 3 |
| Q9 | ask the Notebook, insert the answer | 3 | 5 | 3 |
| Q10 | add a task with a due date | 2 | 4 | 3 |
| Q11 | tag and move 5 notes at once | 8 | 15 | 10 |
| Q12 | export one note as Word | 3 | 6 | 3 |
| Q13 | see the plan grade for my last trade (13A) | 2 | 4 | 2 |
| Q14 | open My Playbook, drill one number (13B) | 3 | 6 | 3 |
| Q15 | write earnings prep for a name reporting this week (13C) | 2 | 5 | 2 |
| Q16 | open a resurfaced note from the bell (13D) | 2 | 4 | 2 |
| Q17 | send feedback with this note attached (13T) | 3 | 6 | 3 |

Targets are this planner's proposal, set so a flow a competitor does in one gesture is not allowed
three; the research may tighten them. A miss is a finding with its raw path, never an edit to the
target. **13Q-2** fixes misses after the lanes land, in the file of the lane that owns the surface;
Q7 needs `ScannerShell.jsx`, which is Screener-owned, so its fix (the door earlier in tab order, or
a skip link) is agreed with that workstream first.

---

## 7. Order, parallelism, ownership and landing

**Cap: three agents at once, integrator included.** One six-shard gate at a time. Backend pytest by
named files only. Every lane commits and pushes at every green checkpoint.

| when | slot 1 | slot 2 | slot 3 |
|---|---|---|---|
| 0 | **13T-1** scaffold + cohort (alone, small) | planner (final scope after the research) | — |
| 1 | **13A** | **13C phase 1** | **13T-2** |
| 2 (13C-1 or 13T-2 reports) | 13A | **13Q-1** | the other of 13C-1 / 13T-2 |
| 3 (13A on landing) | **13B** | **13D** | **13C phase 2** |
| 4 | section-4 lane(s), if chosen | **13Q-2** | **13T-3** |
| last | the gate, box otherwise idle; then the PR | | |

**13T-1, the scaffold, so lanes never share a file.** One commit on the landing branch before any
lane starts: every wave-13 flag in `docs/feature_flags.json` (dark) and in `NOTEBOOK_FLAGS`
(`auth.py`:142-178), the three-way read in `notebook_flags.py`, `NOTEBOOK_BETA` in `rollout.py`,
the wave-13 telemetry names in `journal_two.py`:73, the client flag keys, and one reserved mount
line per lane in `api/main.py`, each separated by unchanged lines so lane merges never touch the
same hunk.

**File ownership.** A file not listed here is owned by nobody this wave; a lane that needs one
stops and asks.

| owner | files |
|---|---|
| 13T-1 | `api/services/notebook_flags.py`, `api/services/rollout.py`, `api/routers/auth.py` (flags only), `docs/feature_flags.json`, `api/main.py`, `api/routers/journal_two.py` (telemetry names only) |
| 13A | `plan_extract.py`, `plan_grading.py`, `notebook_plan_grades.py`, `db.py`, `account_purge.py`, `address_space.py`, `TradeDetailPage.jsx`, `PlanGradeCard.jsx`, `InsightsHub.jsx`, `DisciplineRecord.jsx`, `TradesTable.jsx`, `lib/planReview.js`, `hooks/usePlanGrade.js`, `lib/notebookTemplates.js` (until 13A lands) |
| 13B | `playbook_stats.py`, `playbook_patterns.py`, `notebook_playbook.py`, `MyPlaybook.jsx`, `PlaybookSection.jsx`, `app/src/App.jsx` (one route) |
| 13C | `earnings_prep.py`, `notebook_earnings_prep.py`, `notebook_home.py`, `ResearchHome.jsx`, `TickerResearchWorkspace.jsx`, `lib/earningsPrep.js`, `lib/templateContext.js`, `lib/notebookTemplates.js` (after 13A lands) |
| 13D | `awareness/rules.py`, `awareness/engine.py`, `note_levels.py`, `NoteEditorPage.jsx`, `account_purge.py` + `address_space.py` (after 13A lands) |
| 13T-2 | `FeedbackWidget.jsx`, the hub's feedback handler, `auth.py` (feedback, tickets, invites), `auth_service.py` (feedback), `auth_db.py` (feedback column), `pages/Admin.jsx`, `pages/Support.jsx`, new `beta_invites.py`, new `whatsNew.js` / `knownIssues.js` |
| 13T-3 | `onboarding/tourSteps.js`, `tourCopy.js`, `sampleNotebook.js`, `pages/Support.jsx` (after 13T-2), `a11y/notebookSurfaces.js` (every lane's surfaces, consolidated once), `tools/notebook_beta_load.py` |
| 13Q | `tools/notebook_w13q_clicks.py`, evidence; 13Q-2 edits only through the owning lane's files, after it lands |

**Branches.** The landing branch is `feat/notebook-w13-landing`, created from
`origin/feat/notebook-w12-landing`. Each lane is `feat/notebook-w13<x>` from the landing branch
(`w13a`, `w13b`, `w13c`, `w13d`, `w13t1`, `w13t2`, `w13t3`, `w13q`). When wave 12 merges, master is
merged into the landing branch (merge, never rebase). The integrator re-runs each lane's scoped
tests in its own session before merging it in.

**The gate.** From a separate worktree on a `notebook-*` branch (`notebook-w13-gate`), never an
implementer's: `python scripts/gate_shards.py --shards 6`, against a baseline re-adopted from a
fresh master gate (D16), recorded under `docs/notebook/gate-runs/wave13-landing/`. The Python rails
of every lane run by named file on the final landing tree (C4-python is never short-circuited).
`App.jsx` is a C3 file, so no carry-over: the gate runs on the final tree.

**One PR:** `feat/notebook-w13-landing` -> master, opened **after** the wave-12 PR merges (before
that, its diff would carry wave 12 too). The owner deploys it. Everything ships dark.

**Flags to arm, in this order, each one at a time, each first as `beta`:**

1. `NOTEBOOK_BETA_INVITES_ENABLED` (only after the owner's ruling) — testers can join.
2. `NOTEBOOK_WHATS_NEW_ENABLED` — they see what to try.
3. `NOTEBOOK_PLAN_GRADING_ENABLED`
4. `NOTEBOOK_PLAYBOOK_ENABLED`
5. `NOTEBOOK_EARNINGS_PREP_ENABLED`, later `NOTEBOOK_EARNINGS_PREP_AUTO_ENABLED`
6. `AWARENESS_NOTE_RESURFACE_ENABLED`

Plus `BETA_FEEDBACK_WEBHOOK_URL` (a channel, not a flag) and the two cost values in section 5. Each
flip updates `docs/feature_flags.json` in the same docs push that records its time, and is verified
in the running process, never from `--kv` (CLAUDE.md, the `--set` procedure).

**Never-revert rule.** No lane adds a TipTap node; the review note, prep note and snapshot use
existing nodes. If one turns out to be needed, stop and ask: it must land in both
`lib/notebookSchema.js` and `api/services/journal_two/notebook_schema.py`, take a `NODE_POLICY` row
in every public mode (`public_note_payload.py`, including 12A's gallery mode) and its citation-table
rows, and join the keep-list in `docs/notebook/wave5-rollback.md`. The new SQLite tables
(`j2_trade_plan_links`, `j2_note_levels`, the feedback column, invites) are additive; a rollback is a
flag, and turning a feature off never deletes member data.

---

## 8. Decisions only the owner (or the controller, owner-delegated) can make

1. **The invite door** for 100 testers: approve single-use, email-bound invite links (section 5,
   item 1), and who mints them. Without it, the beta has no way in.
2. **Beta cost ceilings:** `NOTE_ASK_SYNTH_COST_HARD` (recommended 50) and `COMPASS_COST_CAP_DAILY`
   (recommended 40) for the beta window.
3. **"Thin sample":** one threshold for the whole product, n<10 (Insights) or n<25 (Compass); 13B
   uses the ruling, and Compass follows in a later, report-card-gated change.
4. **13A's tolerances** (0.25R entry, −1.1R stop, ±20% size, 0.25R target), and that a grade is
   frozen at first match.
5. **Auto-created prep notes** (positions only, at most 3 a day) as an opt-in flag.
6. **Resurfacing stays in-app** (no email) while the Resend quota is exhausted daily.
7. **Section 4:** which candidates become lanes, after the research.
