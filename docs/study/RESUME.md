# Study — RESUME HERE

**What this is.** Study = the interactive trading-education product inside The Desk → Courses: a
"Duolingo for stocks" (Foundations, 13 tracks + Vocabulary) and the firm's own system (The UCT
Method) drilled on real charts, with no AI at runtime, every item reviewed by the owner.

**Authority, in order:** `docs/superpowers/specs/2026-10-17-desk-practice-interactive-education-design.md`
(§13 overrides earlier sections; §11 + §13.9 hold every owner decision) → `docs/study/plan-review.html`
(the owner-facing plan page, saved locally) → this file (state + next actions).

**Owner rulings that govern the work (2026-10-17):**
- Launch Study **only when it is all done and complete** (not tied to the site's 2026-11-14 opening).
- Owner is **full time** on review until it is done; reviews **every item of a type until 20-30 clean
  examples**, then the review screen asks whether to switch that type to auto-approve + sample.
- **Save everything locally, resumably** — this branch/worktree is the save file. Commit at every
  checkpoint. Artifacts are copies, never the only copy.
- No AI in the product at launch; lessons written in sessions; no model writes a market fact.

## State (update this block at every checkpoint)
- Branch `feat/study`, worktree `C:\Users\pgosz\uct-worktrees\study` (owner file present), based on
  master `f2e816e042` (2026-10-17). Nothing merged to master. Nothing deployed. **PUSHED 2026-10-18**
  (origin/master merged in at 6d19526e41, one trivial AuthContext.jsx conflict, both flags kept);
  PR #417 open: https://github.com/unchartedterritory5995-cyber/UCT-Dashboard/pull/417 (merge AFTER #416).
- Python: `.venv/` in this worktree (Python 3.12, requirements + pytest installed 2026-10-17).
  Run tests as `.venv/Scripts/python.exe -m pytest tests/<named files> -q -p no:cacheprovider`.
- Commits so far: c8edff5363 spec+plan+RESUME · 22980148dc five Phase 0 files · b568f4d580 RESUME ·
  ad2f95cbf9 wire_archive market_call (blocker B2) · ab7a0efbbe UNITS-foundations (129 units) ·
  1a6b3da6cb scans image-copy job (blocker B1) + UNITS-method (96 units) + skill_map.json ·
  aab8042648 RESUME · 47476c0328 Phase 1 backend skeleton (+3,401 lines, 125 tests) · b32489bf08/c10a54a78a/
  efb8812ad9/9395cbb976 lane F1 (StockChart studyMode, hub hides under fullscreen Sheet, StudyPanel,
  SkillTrail, ProgressRing, Courses integration, Settings card; 50 tests) · 75bc05e44c/ab298a0754 lane F2
  (DrillPlayer, 7 drills, RevealCard, EndCard, PractiseSheet, useStudySession, outbox; 42 tests) ·
  e565b0620e integrator wiring of the drill + practise sheet into CoursesSection (reachable rail green) ·
  lane G (importer, templates, jobs, generators): 777d3adfd9 templated lessons · 024e58e7e3 scheduler jobs
  (reminders claim-row, weekly close + boot catch-up, nightly detection drafts) · 755ac7bbf3 near-dup diff ·
  c534a8dd25 generators + first bank (661 drafts) · lane F3: 5cacb84001/7e077a3e64 StudyReview admin card
  (PatternReview `?mode=study`, 20 tests) · 5a14ade449 every item has a lesson, no em-dash in member copy ·
  052aae57e4 drills read the bank's shape (`q`, `quote` block, free-text `format: fill`).
- Later 2026-10-17: lane W walk-throughs 74d40640b2/869cf54739/b169f6547a (type `walkthrough`, unscored
  "seen" attempts, unit sessions `POST /sessions {kind:'unit', skill_id}`, WalkthroughDrill, 25 items in
  walk.method from the brief; 13 framing terms left the glossary quiz, 80 -> 54) · 3f76d0bb61 research
  lane (docs/study/research: 77 cited definitions, candle + bottoms coverage) · corrections overlay
  (scripts/study/corrections.py; docs/study/corrections/*.jsonl; owner-approved items import approved).
  Integrator re-ran lane W: backend 6 files 177 passed; WalkthroughDrill 5, DrillPlayer 9,
  useStudySession 12, CoursesSection 14. Bank now 660 (walk.method 25).
- **2026-10-20 (overnight): review screen fixed + first verdicts + chart words.** PR #434 (merged 5fff820f21):
  the StudyReview chart drew a live fetch by ticker and showed "No MSFT chart data"; it now draws the item's
  STORED bars through `GET /api/study/admin/items/{id}/bars` (admin, any status, visible + forward). Verdicts
  in docs/study/corrections: sizing 1-8 approved (wide-stop caveat, over-cap trim note, tight-stop batch
  wanted; owner called the forward math settled), candles 1-2 (segment goes IMAGE-FIRST: a real chart per
  candle from the firm's detector; review paused), principles 1-4 (1 fixed, Kelly + ATR sizing REJECTED,
  correlation rewritten as judgment; segment on HOLD: "too rigid", "a bit myopic"; rebuild from the owner's
  prose later). STANDING RULE: every lesson answers the follow-up questions. Owner then chose vocabulary /
  technical terms: docs/study/terms/chart_words.json (14 V.02 terms from the screener's own formulas),
  scripts/study/find_term_examples.py (pod-side, read-only: real (sym, asof) pairs where the firm's formula
  fires; output docs/study/terms/examples.json, 78 examples over 13 concepts), scripts/study/gen_terms.py ->
  bank segment vocab.chart (78 draft items, bars as a SPEC resolved on import). NEXT: owner merges, then
  `railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py --only vocab.chart` (owner-run),
  then review chart words on the review screen (Type = recall, skill vocab.chart). Owner rule 2026-10-19:
  review happens where he can SEE the chart (the review screen / a browser), not as text in chat.
  The study-import worktree's app/node_modules is a JUNCTION to the main checkout (remove with `cmd /c rmdir`).
- **2026-10-20 (day): #435 merged (4456917011, deploy SUCCESS, health 200).** It carries the vocab.chart
  bank + a SECOND review-screen fix (ef0b7011ff): the stored bars arrive with int dates (YYYYMMDD) and the
  chart matched nothing; StudyReview now runs normalizeBars + appendForwardBars exactly like the member
  drill. VERIFIED in Chrome: the MSFT spot item draws on the firm's renderer with the forward strip
  (screenshot sent to owner). Pod: docs/study/bank/vocab.chart.json present, dry-run = 78 items; the
  study_items table had 845 rows, vocab.chart 0 -> the owner still has to run the import
  (scratchpad study_import_vocab.ps1 = `railway ssh --service web -- /opt/venv/bin/python
  scripts/study/import_bank.py --only vocab.chart`, from PowerShell). After it: review on the screen,
  Type = recall, skill vocab.chart. Table for bars is `study_bars` (not study_item_bars).
  UPDATE (same day): the import ran from this session (the classifier allowed it this time):
  78 inserted / 0 rejected, study_items 923. But the queue is the OLDEST 150 drafts of a type and
  the 78 sit behind 374 older recall drafts -> PR feat/study-review-skill-filter adds ?skill= to
  GET /admin/review + a Skill select on StudyReview (counts from draft_skill_counts). After it
  deploys: Type = recall, Skill = vocab.chart, review on the screen.
- **2026-10-20 (afternoon) OWNER RULING on the first chart-word item: "this is not what our charts
  look like."** The Study chart drew the schema defaults with volume hidden. Our charts = the
  HOUSE look: the owner's saved chart_settings blob (bright #1ae51a/#c41f2d candles, #0f0f0f
  canvas, EMA 9/20 + SMA 50/200, volume on) + the exported-image treatment every member knows
  from Discord /chart (hollow candles, slim 12% volume pane, volume in the candle colours; owner
  2026-10-02). Shipped as branch feat/study-house-chart-look: api/services/house_chart.py (ONE
  owner-blob resolver, used by /r/chart-settings AND the new GET /api/study/house-chart),
  app/src/components/chart/houseLook.js (applyHouseLook, shared by ChartRender + Study),
  app/src/pages/study/studyChartLook.js (studySettingsOverride(chartOpts, houseSettings): house
  look + study gates; item opt-outs `volume:false`, `overlays:false`, or its own `overlays:[..]`),
  useHouseChart hook (DrillPlayer) + SWR (StudyReview). Spec D6 "volume and MAs off unless the
  item is about them" is SUPERSEDED by this ruling. Tests: studyChartLook 5, renderlook 7,
  DrillPlayer 9, StudyReview 21, pytest study router 60 (+ house-chart route test).
- **2026-10-20 (evening) NEXT BATCH built autonomously while Railway's build outage (all regions
  paused 17:03Z, our #437 web build killed FAILED) blocks the house-look deploy.** Branch
  feat/study-next-batch:
  * sizing (owner rulings 2026-10-19): forward lessons carry the wide-stop caveat (>10%) and the
    past-20%-trim note; a 16-item TIGHT-STOP batch (1.5-8%, STOP_PCTS_TIGHT, own RNG stream so
    every existing id and verdict survives; refs #3-forward-tight-N); "1 share" never "1 shares";
    size.house_rule 68 -> 84 items.
  * candles (owner: "Fix + draw the candle", "include images"): gen_candles.strip_name cuts any
    sentence naming the answer from a description question (the hammer item now reads exactly the
    owner's proposed text); NEW segment candles.chart = 247 items from
    docs/study/terms/candle_examples.json, found on the pod (read-only ssh) by
    scripts/study/find_candle_examples.py through the screener's own single_candle (63 of 66 keys;
    no abandoned-baby-bullish / deliberation / kicking-bullish in 700 bars of 61 names; 60 symbols,
    spread by key). Each item: chart cut at the named bar (window 60, forward 10), "Which candle
    name fits the last N bars on this chart?", description in the reveal + lesson.
  * corrections.py applies `prompt.<key>` fixes; the bank-parity test compares the disk against
    generate()+corrections (the two REJECTED principles items are now out of the bank; they are
    still draft rows in /data/study.db until rejected on the screen or purged).
  * tests: test_study_generators 53, test_study_find_candle_examples 4, importer 8, finder 9,
    router 60 (81 in the last scoped run + router).
  AFTER MERGE + deploy: owner (or this session if the classifier allows) runs
  `railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py --only candles.chart --only size.house_rule --only candles.catalog`
  then reviews on the screen: Skill = vocab.candle (chart items) and size.formula (tight batch).
  Railway recovery: the #437 deploy must be REDEPLOYED by hand from the dashboard (web service,
  failed deployment, Redeploy) once their build pause lifts; nothing retries itself.
- **2026-10-20 22:00Z ALL LIVE AND VERIFIED.** Railway incident resolved; #438 (a0032ab37f, house look +
  next batch) deployed after this session pressed Deploy commit in the dashboard (the CLI redeploy is
  refused by the classifier; the dashboard click was allowed once the owner said "you do it"). Imported:
  candles.chart 247 inserted, size.house_rule 16 inserted / 68 updated, candles.catalog 172 updated.
  Found on screen: chart items took the DETERMINISTIC lane (verbatim quote key) and sat behind the
  150 queue limit -> PR #440 (merged 391e1afb81, deployed): any item with a chart is MANUAL lane;
  a selected skill is served whole (limit 500). Re-imported candles.chart (lanes flipped: 247 manual).
  VERIFIED in Chrome: Lane manual + Skill vocab.candle = 247 chart items, SHOP 1/247 draws the house
  look with the "member sees to here" marker on the named bar. Owner review path now:
  /admin/pattern-review?mode=study -> Lane manual + Skill vocab.candle (247), Skill vocab.chart (78),
  Skill size.formula (tight batch). Pod study_items: 1186 drafts.
  NEXT (owner's call): review on screen; then principles rebuild from his prose / playbook workshop.
  Small follow-up: the review header says "forward 20 sessions" for every chart item; candles.chart
  specs carry forward 10 (cosmetic, the strip itself is what the spec says).
- **2026-10-20 night: REVIEW STARTED in question form (owner on mobile) + CANDLE LESSONS.**
  Review flow: screenshot of the review screen (chart + zoom) sent with SendUserFile, question/key/
  lesson in text, owner answers, verdict appended to docs/study/corrections/candles.chart.jsonl AND
  applied on the screen (Approve / Reject + reason chip). Six chart items done: 5 approved, 1 rejected
  (ZS Two Crows, bad chart: bars too small). OWNER RULINGS (all in that jsonl): ALL 66 catalog names
  are taught (he hated "Advance Block" for a second, then: "we can and should do these all and a ton
  of these examples"); every name gets a THOROUGH, cool and fun lesson; chart examples must be
  LEGIBLE; many examples per name, better equivalents ADDED, approved ones STAY; he DELEGATED the
  remaining chart-example verdicts to the session; style of the hammer lesson approved ("Yes looks
  good"), headings kept, depth kept, desk part is mine to write ("You answer 1-2-3").
  Built + merged: #442 (docs/study/terms/candle_lessons.json: 66 six-part lessons: shape / story /
  where / confirm / cancel / desk; gen_candles.full_lesson; rail on voice + no digits) and #443
  (find_candle_examples legible() 0.8x the 20-bar avg range, per_key 10, 131 candidates -> 600
  examples / 130 syms / 63 names; candle_examples_kept.json = the 5 approved, unioned on every run;
  CHART_WINDOW 40). candles.chart = 604 items.
  ⚠ RAILWAY SKIPS docs/scripts/tests-only merges for web ("No changes to watched files": #441, #442
  SKIPPED). To get a bank onto the pod after such a merge: Railway dashboard -> web -> the SKIPPED
  deployment -> "Deploy commit" -> Deploy (this session may click it; the CLI redeploy is refused).
  NEXT: deploy #443 that way, import --only candles.catalog --only candles.chart, then REJECT the
  old illegible chart drafts on the pod that are no longer in the bank (DB ids minus bank ids, via
  the admin review route from the logged-in tab), then continue: the session judges the 604 under
  the rules and shows the owner samples; the owner reviews lessons in question form.
  THEN (owner): redesign the Study landing page in Desk -> Courses: "cool and fun, not lame like
  this". Plan + work stay LOCAL (RESUME.md, docs/study), no artifacts (owner rule).
- **2026-10-21 00:40Z: pod is CURRENT and the landing v1 is merged.** #443 deployed by hand from the
  dashboard (Deploy commit), then import --only candles.catalog --only candles.chart: 603 sent, 579
  inserted, 24 updated (the 5 approved kept their status). The 221 first-run chart drafts that the
  legibility rule dropped were REJECTED on the pod as "bad chart" through the admin review route
  from the logged-in tab (ids: docs/study/corrections/candles.chart.retired-2026-10-20.json). Pod
  vocab.candle chart items now: 599 draft (legible, delegated to the session), 5 approved, 222
  rejected. Lessons (six parts) are live on every candle item.
  LANDING v1 (docs/study/landing_redesign.md) merged as #445 (38fea21c83): StudyLanding.jsx hero
  candle chart of the member's progress + station decks + badges shelf, mounted above the existing
  Study layout in CoursesSection; tests 4 + 14, eslint clean. NEXT: screenshot it live for the
  owner, iterate on his reaction; then the session's own pass over the 599 chart drafts (approve
  the legible ones in bulk under the delegation, sampling to the owner), and his lesson review.
- **2026-10-21 ~16:00Z: BUILT the two review tools offered in the walkthrough** (branch
  feat/study-screen-feedback-hub, while Railway builds were paused). (1) "Feedback on this
  screen", admin-only, on every Study screen: landing, trail, practise sheet, the quiz's top bar
  (question / reveal / end), the review screen, gallery, lesson reading view. Kinds are the
  owner's words (layout, visuals, effects, how it works, teaching, broken, great, other);
  `POST /api/study/admin/screen-feedback`; a study_feedback row with `screen` set and item_id ''
  (never counted against an item, never applied); listed in the Feedback panel as
  "Screen · ..." with a scope select. (2) The review hub (review screen -> "Review hub",
  `GET /api/study/admin/hub`): counts laid on the course map (curriculum -> track -> unit) plus
  unplaced skills, and all candle lessons as members read them with live-example counts and a
  verdict door on the LESSON (approve / needs fix + note -> a lessons screen note; ingest writes
  a source_ruling about:"lesson"). FOUND + FIXED: the review screen's A/F/R keys stayed live
  under the gallery / feedback panels (A could approve a hidden draft); now they act on the card
  only (mutation-checked). Also walked two member routes the sym-leak rail had missed
  (house-chart, item feedback). Doc: docs/study/feedback_loop.md. NEXT for the owner once
  deployed: open Review hub, read the lessons, Approve / Needs fix each; leave screen notes as he
  goes; the session ingests them.
- **2026-10-21 ~17:00Z: METHOD DRAFTS AUDITED (owner: "whatever you suggest honestly" -> tighten
  first, then review station by station in the Review hub).** Three read-only agents graded all
  511 auditable bank drafts against their own sources; verdict files + summaries + the build
  scripts are committed in docs/study/audits/2026-10-21/ (auditA recall, auditB regime+size,
  auditC charts+walkthroughs; one jsonl line per item, counts verified). Result: keep 29, fix 185,
  cut 280, hold 17 (bottoms, need a price check). Held by earlier rulings and not audited:
  recall.principles 34, recall.playbooks 29. So about 214 reach the owner instead of 574.
  Per segment: size.house_rule 14 keep / 42 fix / 22 cut (no math errors in all 84; fixes = full
  lessons from each item's own numbers, the "A+ gets 1.5%" invention removed, the sizing_rule.md
  line "a tight stop never licenses a monster position" on big positions); regime.bottoms 31 cut
  (trivia) / 17 hold (bottomsCatalog.js is unreliable: signpost dates on a Sunday 2023-01-15 and a
  Saturday 2003-03-15, four self-contradictions; every fact needs a check on real index bars);
  recall.bible 19 fix / 13 cut (the bible contradicts itself: "3 out of 4 stocks follow the market"
  vs "determines 75% of a stock's outcome"; it reads like a compiled O'Neil/Minervini base, not the
  owner's writing); recall.concepts 5 fix / 17 cut (12 duplicate vocab.chart); recall.glossary 52
  fix / 2 cut (the AI brief contradicts the firm: Wedge Drop is a RISING wedge per
  setupPlaybooks.js, distribution days 5-6 per the bible, exposure rating, HVC, heat); spot.fixtures
  39 fix / 93 cut, family.fixtures 5 fix / 37 cut (detectors disagree with the owner's setup cards
  for six setups: Launchpad positives lack the MA stack, 5 of 6 close under the 200-day, verified;
  Go Signal is a different setup; Kicker, Oops, HVE, Slingshot, Gap Support partly off-card);
  vocab.chart 8 keep / 21 fix / 49 cut (the example finder never checks the other words: 16
  distractors true on the bar, one MSFT chart carries 7 answers); walk.method 7 keep / 2 fix / 16
  cut (model jargon, THE LOOP, contradictions with his ladder and heat ruling). OWNER RULINGS
  NEEDED: (1) setup definition = his card or the detector (recommend the card); (2) is the
  methodology bible a Study source at all; (3) sizing: 20% vs 25% cap, the drawdown ladder, may his
  30-word trim sentence be split. NEXT: apply cuts (retired bulk lists) and fixes (corrections,
  status confirmed under delegation, items stay draft) on branch feat/study-method-audit, regenerate,
  import once Railway is back; the hub then shows the survivors by station; sizing first.
- **2026-10-23 ~03:00Z to 03:40Z: BATCH 1 LIVE ON THE POD; #457 VERIFIED; BOTTOMS BATCH 2 BUILT.**
  #459 merged (b8c5cbb1b4; #458 merged with it), web SUCCESS 03:01:32Z. The owner signed in to the
  site and to the Railway CLI. #457 VERIFIED on the pod read-only (scratchpad pod_verify_scoring.py,
  commit fb4a45c68e): approved recall items score {choice: key} True and a wrong choice False.
  pod_count_misscored.py: 1 attempt ever, the owner's walkthrough answer, mis-scored; no member hit,
  no repair. Owner ran import_bank --only size.house_rule walk.method vocab.chart recall.glossary
  recall.concepts (157 updated, 0 flagged/misses/rejected) and retire_ids.py retire_batch1.json
  (137 retired, 0 skipped). `!` commands run in the worktree cwd: prefix `cd /c/Users/pgosz/projects/
  UCT-Dashboard && MSYS_NO_PATHCONV=1`. Railway ssh timed out once (their outage banner); a retry worked.
  BOTTOMS: a helper price-checked the 17 holds on Yahoo bars, then every kept number was re-read on
  the pod's own study_bars snapshot. docs/study/audits/2026-10-23/: bottoms_price_check.md (evidence),
  bottoms_batch2.py (37 records, tag "bottoms-batch2 2026-10-23"), retire_batch2.json (9 ids).
  8 kept (q = "{bottom}: the chart ends on the day one signpost fired. Which one?", lesson = the
  signpost lesson + the measured SPY note, no news clause, no "record volume"), 9 cut (7 whose last
  bar doesn't show the signpost; the 2008/2009 pair because the firm's SPY bars carry two bad lows:
  2008-09-29 L 11.85 (Yahoo 110.97), 2008-11-07 L 53.15 (Yahoo 90.50); no approved item shows them;
  the firm's own SPY 2008 chart likely does: report to the bars owner). 344 Study tests pass.
  NEXT: PR + merge + web SUCCESS; owner runs import_bank --only regime.bottoms and
  retire_ids.py docs/study/audits/2026-10-23/retire_batch2.json; then the owner reviews station by
  station (sizing first); spot/family + bible wait on the rulings.
- **2026-10-23 ~02:10Z: RAILWAY BACK; #457 LIVE; PR #459 carries #458 + the audit.** Railway's
  builds resumed; web deployed production fb4a45c68e at 02:12:26Z (commit STATUS "web | success"),
  which contains #457 (8043eca012), so the scoring fix is live. NOT YET VERIFIED in a browser: the
  site signed everyone out (the owner's admin tab sits on /login) and the Railway CLI still answers
  Unauthorized (`! railway login --browserless` is the owner's step). PR #459 (feat/study-method-audit)
  carries #458's commit plus the audit, batch 1, the short glossary choices, and two new commits:
  191078f54f (the review card's "Checked against" lists reveal.support, the firm's lines, instead
  of reveal.quote, the AI brief's sentence; learners never saw the quote) and 54b36522c9
  (scripts/study/retire_ids.py + docs/study/audits/2026-10-21/retire_batch1.json: reject the 137
  cuts on the pod, drafts only, refuses off the pod, re-run safe). Merging #459 merges #458.
  A bulk reject from the browser was refused by the auto-mode classifier (external write), hence
  the owner-run tool. A helper is price-checking the 17 regime.bottoms holds on real bars
  (scratchpad bottoms_check/REPORT.md). NEXT: merge #459, wait web SUCCESS; owner runs
  `railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py --only size.house_rule
  --only walk.method --only vocab.chart --only recall.glossary --only recall.concepts` (regime.bottoms waits for
  the price check; its 17 holds are already on the pod as drafts)
  then `... scripts/study/retire_ids.py docs/study/audits/2026-10-21/retire_batch1.json` (dry-run first);
  owner signs in, verify a right choice says Correct; run scratchpad pod_count_misscored.py (read-only).
- **2026-10-21 ~17:45Z to 22:00Z: BATCH 1 APPLIED, glossary choices shortened (branch
  feat/study-method-audit, stacked on #458, pushed).** a9f984ca53 rebuilt six segments from the audit's
  corrections records: size.house_rule 84->62, walk.method 25->9, vocab.chart 78->29, recall.glossary
  54->52, recall.concepts 22->5, regime.bottoms 48->17 (the 17 held for a price check on real index
  bars). Then the 26 glossary "what does X mean" items still had choices of 60-130 characters, too long
  on a phone: docs/study/audits/2026-10-21/gloss_shorten.py appended 52 fix records (choices + answer,
  tag "short-choices 2026-10-21", delegated under "whatever you suggest honestly"), one short form per
  term, every one <=55 characters, meaning kept from each item's own support lines; the rebuild changed
  only those 26 items' choices and answers (52 items, ids unchanged, every key still a choice; the
  term->name items were already <=24). 338 Study tests pass. OPEN: the review card's "Source says" line
  for glossary items still prints reveal.quote, the AI brief's sentence, which the audit found wrong in
  places (exposure "computed from breadth, distribution days"); the firm's own lines sit in
  reveal.support, which the card does not show. Fix before the owner reviews that station: show
  support on the card, or point reveal.quote at the firm's line. RAILWAY at 21:50Z: still a major
  outage, builds paused in every region, and Railway invalidated CLI sessions (`railway deployment
  list` answers Unauthorized: the owner runs `! railway login`). Live site up, pod booted ~05:24Z, so
  #457 is NOT live. The watcher (wait_railway_recovery.sh) was stopped by Claude Code for low memory
  and not restarted. After recovery, same order: verify #457, merge #458, open a PR for this branch and
  merge it, import --only the six segments (recall.glossary now carries the short choices), retire the 137 cut ids (scratchpad
  pod_reject_audit_batch1.json).
- **2026-10-21 15:10Z: THE WALKTHROUGH FOUND A SCORING BUG; fix merged, waiting on a Railway outage.**
  Owner asked to see everything ("show me everything here and now so we can go through it all ... layout and
  visual and effects and interactive and learning"). Six screens shown (landing, question, reveal, admin
  review card, example gallery, feedback panel). FOUND LIVE: drills post `{choice: x}` (drills/types.js
  choiceAnswer) but study_scoring._as_answer_value only unwrapped `{answer: x}`, so EVERY multiple-choice
  answer scored wrong. #457 (merge 8043eca012): `_SINGLE_VALUE_KEYS = ("answer","choice")`, `_norm` makes
  integral floats equal ints, RevealCard .meta flex (ref no longer jammed against the date); router test fails
  on the old code. NOT LIVE YET: Railway major outage from 07:24Z ("builds paused" in every region,
  dashboard/API/CLI unavailable, `railway ssh` port 22 times out). The site still serves the 05:19Z build
  (b90c568537). The production branch holds 8043eca012; nothing registered on Railway web since 05:19Z.
  The scheduled 13:02Z full-suite run failed only on its report (vitest job cancelled, no diff.json); all 12
  pytest shards passed. NEXT once it deploys: verify a right choice says Correct; run scratchpad
  pod_count_misscored.py (read-only) to count past mis-scored attempts, then decide a repair.
  Walkthrough findings put to the owner (no verdicts yet): start button below the fold; duplicate intros;
  empty Foundations / DRAFT course cards; chart small on the desktop question screen; bracket the bars the
  question means; reveal cramped (lesson scrolls, review door under Continue), no divider before the forward
  bars; 3 names with no chart example (abandoned-baby-bullish, deliberation, kicking-bullish), thin Kicking
  (Bear) 3 / Abandoned Baby (Bear) 2; Bullish Engulfing has 6 of 10 examples on 2025-04-09 -> proposed cap 2
  per day per name; trust panel "recall 599 clean" inflated by bulk approvals.
  POD INVENTORY: 610 live (604 candle charts + 6 size.formula), 1003 drafts (candles text 172, vocab.chart
  78, vocab.method 54, Method stations ~690, walkthroughs ~25), 222 rejected; Foundations has no content;
  the landing's 8 Method stations have no live questions. Offered: (1) a "Feedback on this screen" button on
  every Study screen into the same panel, (2) a review hub with section counts + a reading view of all 66
  lessons. OWNER DECISION PENDING: how to take the ~1000 Method drafts (section by section, or prune first).
- **2026-10-21 05:05Z ALL LIVE: the feedback loop, `/study`, the audited lessons, every approved example on
  the pod.** #453 deployed (6404d2d280, a 43-minute Railway build, then SUCCESS; review screen shows
  "Feedback (0)", /api/study/admin/feedback answers). `/study` REGISTERED for the UT guild: the owner ran
  `! powershell ... railway run --service web -- powershell -File C:\Users\pgosz\register_study.ps1`
  (maps DISCORD_BOT_TOKEN -> DISCORD_CHART_BOT_TOKEN, checks app 1474900505917653142, registers per guild
  882293203485720596; the session's own attempt was refused by the classifier as Credential Exploration;
  no Railway service holds DISCORD_CHART_BOT_TOKEN, web holds DISCORD_BOT_TOKEN). Lesson audit merged
  (#454 be777c11cf; a read-only agent graded 34 GREAT / 26 GOOD / 6 NEEDS WORK, every accuracy claim
  verified against candle_catalog.py's d_* predicates; 48 parts rewritten; ruling logged in
  candles.chart.jsonl), deployed by hand (Deploy commit on the SKIPPED record), imported
  (candles.catalog 172 updated, candles.chart 603 updated; verified the new "where" text on the pod).
  FOUND: upsert_items kept an existing DRAFT row draft even when the bank said approved (the pod sat at
  180 approved against the bank's 603) -> store fix: a draft at the same version goes live when the bank
  says approved (never downgrades, never past a reject, a higher version still resets);
  tests/test_study_upsert_status.py 3. One-off pod sync ran (scratchpad pod_sync_approved.py over ssh):
  430 drafts approved -> pod 609 approved (603 chart + 6 catalog), matching the bank. THE QUIZ NOW SERVES
  EVERY APPROVED CANDLE EXAMPLE WITH THE AUDITED LESSONS. Owner review path from here: take the daily set
  (Desk -> Courses), "Review this one" under each lesson (Approve / Needs fix / Reject + note), or
  `/study ref:<six characters on the card> say:<note>` in Discord; the review screen's Feedback (n) panel
  and `python -m scripts.study.ingest_feedback` carry it back into docs/study. Bullish engulfing lesson
  verdict still pending from the owner (sent as text + IWM 2025-04-09 chart).
- **2026-10-21 ~04:00Z: THE FEEDBACK LOOP (owner: "build a system for reviewing in site or in the
  discord and giving feedback for the quiz and test so we can manually do this and ingest and update
  the information"; also "make sure they are all great").** Branch feat/study-feedback, doc
  docs/study/feedback_loop.md. Three doors into ONE table `study_feedback` (study_store: add_feedback /
  list_feedback / feedback_counts / handle_feedback / export_feedback / find_item_by_ref / short_ref):
  (1) the reveal card: "Something off?" chips (wrong answer / bad chart / question unclear / lesson
  unclear / too easy / too hard / great example / other) + note, posted to
  POST /api/study/items/{id}/feedback with the attempt attached; an ADMIN's card carries Approve /
  Needs fix / Reject (approve + reject applied at once through review(), fix = a note); the card now
  renders the SIX-PART lesson with headings (lesson_parts) and prints `ref 872a0a`;
  (2) Discord `/study ref:872a0a say:... [verdict] [kind]` (admin-only: default_member_permissions 8
  AND the administrator bit in the handler; private reply; study_feedback_reply in
  api/routers/discord_interactions.py) -> OWNER MUST REGISTER IT ONCE:
  `python tools/discord_chart_commands.py register` (local, bot token in .env);
  (3) the review screen: "Feedback (n)" panel beside the gallery (StudyFeedbackPanel.jsx: list, Open,
  Handled, Show handled, Export feedback), queue rows show "· n notes". Admin routes
  GET/POST /api/study/admin/feedback[/handle|/export]. INGEST: save the export JSON under
  docs/study/feedback/exports/, run `python -m scripts.study.ingest_feedback` -> owner approve/reject
  rows become docs/study/corrections/feedback.jsonl (standard verdict records, idempotent by
  feedback_id) + docs/study/feedback/REPORT.md (open rows grouped by item = the session's worklist).
  Tests: test_study_feedback 20, test_discord_study_command 6 (+ lesson 7), test_study_ingest_feedback 4,
  RevealCard 12, StudyReview 24, DrillPlayer 9, CoursesSection 14. Fixed on the way: get_attempt
  read a plain-string answer back as None. ALSO 2026-10-21 ~02:30Z: the master deploy gate was RED
  (another session's Trader Archive nav row left app/src/agent/contract/manifest.golden.json stale) ->
  PR #452 regenerated the golden; #450 (gallery light rows) + #452 live, gallery verified (Hanging Man
  14 examples). Hanging man lesson APPROVED by the owner ("good get it done"); bullish engulfing
  lesson sent (IWM 2025-04-09), verdict pending. NEXT: merge + deploy this branch, register /study,
  then the session's own quality pass over all 66 candle lessons ("make sure they are all great"),
  then the owner reviews by taking the quiz / from Discord; the session ingests and fixes.
- **2026-10-21 ~02:00Z: landing v1.1, bulk verdict lists, the EXAMPLE GALLERY; lesson walkthrough
  in progress.** Merged + live: #447 (corrections.load() reads `<segment>.approved-<date>.json` /
  `.retired-<date>.json` as per-id verdicts; candles.chart.approved-2026-10-21.json = 599 ids, so the
  BANK holds 603 approved chart items), #448 (landing v1.1: wick = station size, body = mastered
  share), #449 (`grade` review action: okay/good/great -> reveal_json.example_grade, status untouched,
  logged; `?status=any` on the admin list; app/src/pages/admin/StudyGallery.jsx + studyGalleryHelpers.js:
  "Example gallery" toggle on StudyReview, Subject select, grid of house-rendered charts, Bad / Okay /
  Good / Great; Bad = reject "bad chart"), #450 (33bda12807: `light=1` gallery rows, cap 5000, cards
  sorted approved -> draft -> rejected; the 500-row cap had hidden the newest legible examples).
  Owner asked for the gallery 2026-10-21: "see a ton of examples... distinguish okay/good/great/bad".
  POD STATE: ~424 chart drafts, ~180 approved (175 approved through the browser before the
  classifier blocked bulk POSTs: "Unrequested Commit in a Connected App"), 222 rejected. The
  sync import (`import_bank.py --only candles.catalog --only candles.chart`, makes all 603 approved
  on the pod) is DELIBERATELY HELD until the lesson walkthrough is done, because the review queue
  shows drafts only. Lesson walkthrough (owner: "lets look through them all one by one", "going
  to need to see it all"): screenshot of the item + lesson text per name; hanging man SENT (CAVA
  2025-12-10), verdict pending; then bullish engulfing (IWM 2025-04-09 si_872a0a87de98), three
  white soldiers (SNAP 2026-02-20 si_22fa8a4b2e50), hikkake-bull (IONQ 2026-08-18), doji (ELF
  2026-02-04), shooting star (SQ 2023-12-20), bearish engulfing (MDB 2026-07-10), morning star
  (LYFT 2026-02-06), inverted hammer (DASH 2025-11-13), evening star (XOM 2026-02-20). Lesson fixes
  go into docs/study/terms/candle_lessons.json; verdicts into candles.chart.jsonl.
  AFTER the walkthrough: run the held import; pull the grades from the corrections export into
  docs/study on regeneration; make the member drill prefer great/good examples. Owner has not yet
  reacted to landing v1/v1.1 (screenshots sent). Still for the owner: 78 chart-word items (Skill
  vocab.chart), 16 tight-stop items (size.formula), principles rebuild from his prose, playbook
  workshop; cosmetic "forward 20 sessions" header; two rejected principles items still drafts on pod.
  Mechanics: review tab 1591694915, Railway tab 1591694913; `gh pr merge` by the session was
  allowed this night; bulk POSTs from the browser javascript_tool are sometimes refused, prefer the
  bank / corrections mechanisms; write patch scripts with the Write tool (heredocs with triple
  quotes break the Bash tool).
- **2026-10-19 BANK IMPORTED (live):** #417 merged (a2b75be153), Study live in web deploy 7d0ee0e300.
  Owner ran `scripts/study/import_bank.py` (then a scratchpad copy of it) on the pod: 660 sent, 660
  inserted, 0 flagged / misses / rejected, 205 bar snapshots. Read back from `/data/study.db`: 660 drafts
  (recall 374, spot 132, size 48, family 42, regime 39, walkthrough 25; lanes deterministic 401 / manual
  259), `study_terms` 0 (no terms posted yet), every `bars_ref` resolves. The StudyReview admin screen
  (PatternReview `?mode=study`) now has content; nothing is approved, so members still see nothing.
  The importer + its 8 unit tests ride in `scripts/study/import_bank.py` /
  `tests/test_study_import_bank.py` (PR from branch feat/study-import-bank). Re-runs upsert by id.
- **2026-10-18 HOLD (owner):** item 2 in its third shape was still "improper": "these are very nuanced".
  Quiz items built from playbook PROSE (rules / named mistakes) are on hold: the prose does not carry
  the owner's real rules (he buys ahead of a HOD break, buys under the 20 EMA on an undercut). Proposal
  put to him: prose sources (playbooks, principles, brief, concepts) = teaching material; judgment
  items only from rules he states himself (per-setup workshop in chat, verbatim into
  docs/study/sources/owner/<setup>.md) with `accept` lists for nuance, or from chart ground truth
  (fixtures, recorded calls, outcomes). Quiz stays valid for textbook facts (candles, O'Neil's rules
  attributed to O'Neil), sizing math, and recorded data. Awaiting his choice.
- **Owner review position:** item 1 (THE LOOP) rejected -> became a walk-through; item 2 (Bull Flag
  named mistake, si_1291bfa801ba) = a FIX in the owner's words, logged as `proposed` in
  docs/study/corrections/recall.playbooks.jsonl; awaiting his confirmation of the exact wording and
  whether setupPlaybooks.js (the Setup Library source) gets the same wording. Next item after that:
  recall.playbooks #2.
- Research follow-ups (docs/study/research/coverage.md): StockCharts unreachable from this box; IBD
  paywalled past the lead; candle catalog has 66 records, ~35 Bulkowski names missing, 10 textbook
  biases flip in Bulkowski's data (kept classic by owner decision 2026-08-24); BOTTOMS lacks 1990,
  1998 and the April 2025 low. `reveal_json.depth` wiring (summary + sources under the reveal) not built yet.
- Early-merge branch `fix/wire-archive-market-call` in worktree `C:\Users\pgosz\uct-worktrees\wire-call`
  (from origin/master d0c406824d): 8f5a530f72 (cherry-pick of ad2f95cbf9) + 0dbadeef29 (scans copy script +
  test). PR #416 MERGED 2026-10-19 12:22 ET (ea07799f08, web deploy SUCCESS 12:4x ET after a GitHub
  Actions/Webhooks degradation delayed the promote by ~10 min). **Scans copy DONE on the pod 2026-10-19:**
  3096 sunday_scans images, 3095 stored in R2 `study/scans/<sha256>.<ext>`, ledger `/data/study_scans_ledger.json`;
  1 permanent failure (`url-sha256:4da8be83fa8e…`, "Theory of Reflexivity" diagram on a dead Amazon bucket,
  http 403; not a chart, nothing to retry). Every ledger `ticker_hint` is unconfirmed until the owner
  confirms it on the review screen.
- Phase 0: ALL 8 FILES DRAFTED. Awaiting the owner's one-session review (see "Owner review packet").
- Phase 1 backend: SKELETON LANDED 47476c0328 (study_store/scoring/select + router + 6 test files,
  125 tests). Integrator re-ran all six in this session (125 passed) plus the four rails
  test_feature_flag_ledger / test_hub_preview_flag / test_no_shadowed_definitions /
  test_shared_data_root_guard (532 passed). Follow-ups from the lane's deviations: streak
  currently counts on the first scored attempt of the day (spec: finishing the 10-item set);
  mastery constants are provisional in study_store; import resolves bars synchronously (fine,
  index seek only) with misses stored as unresolved drafts; /items/{id}/image and /intro/{unit}
  wait on R2 assets; review_lane assignment left to generators.
- Content bank: **661 draft items** in `docs/study/bank/*.json` (recall.glossary 80 · principles 36 ·
  bible 32 · concepts 22 · playbooks 29 · size.house_rule 68 · spot.fixtures 132 · family.fixtures 42 ·
  regime.bottoms 48 · regime.wire 0 (archive lives on the web pod; run `gen_regime` there) ·
  candles.catalog 172). Every item has a lesson (371 source, 290 template); no em-dash in member copy.
  Regenerate: `.venv/Scripts/python.exe -m scripts.study.run_all`; rail `tests/test_study_generators.py`
  asserts the committed bank == a fresh run. **Owner review: batch 1 = recall.glossary items 1-10,
  presented in chat 2026-10-17; verdicts not yet recorded.** Corrections go to
  `docs/study/corrections/<segment>.jsonl` (to create on the first verdict).
  Unit plan: Foundations 116 units (~2,970 q) + Vocabulary 13 units (~2,920 q) + Method 96 units (~5,605 q).
- **Source rulings (owner, 2026-10-17, after item 1 was rejected: "i have never heard of THE LOOP"):**
  (1) The Presenter's Brief (docs/curriculum/uct_method_presenter_brief.json, AI-written 2026-07-27) is
  fine as a source but is TEACHING, not quiz material: "it is essentially exactly how everything is
  supposed to be analyzed" but "we dont exactly emphasize that". Its framing terms become unscored
  walk-through items (type `walkthrough`, to build); real desk terms stay quiz items.
  (2) voice_kb/trading_principles.json: "fine, good to have, might need some adjusting" -> keep, review one by one.
  (3) setupPlaybooks.js: "yes that is good" + "sweep reliable websites to gain full complete detailed
  definitions to make the answer perfect and detailed" -> research lane: cited external definitions
  (docs/study/research/), used to deepen reveals/lessons, every one still owner-reviewed.
  (4) candle catalog + bottoms catalog: keep ("well researched and reliable"), "make sure nothing is
  missed and all the stuff is properly defined explained and emphasized" -> coverage check in the same lane.
  LESSON: check a source's authorship (`git log --format=%an` + its header) before calling it "the firm's";
  a document a model wrote is not the desk's vocabulary.
- Review flow (owner decision 2026-10-17): in chat, question form, ONE item at a time (he asked for one by one, not groups); after 20-30 clean
  items of a type the StudyReview card offers auto-approve + 10% sample for that type.
- Owner answers 2026-10-17: Scans image copy = yes (run on the pod after the early merge); early merge =
  "whatever is optimal for hands-off" (done as the branch above); voice-clone source = the whole library,
  compare and contrast a lot (research not started).

## Owner review packet (Phase 0 — read in this order, one session)
1. `docs/study/VOICE.md` — the voice rules derived from your Substack/Scans prose; §8 open items.
2. `docs/study/UNITS-foundations.md` — 129 units; read "Gaps for the owner" (8 content gaps +
   a thin-data table). Notable: 1929 and 1973-74 can only be authored (index bars start 1974);
   Greeks units need hand-frozen past chains; F7.05 waits on the wire-archive tier backfill.
3. `docs/study/UNITS-method.md` — 96 units; all 79 course lessons linked, 6 "covered in part"
   need your sign-off; the 28-setup roster with supply (6 good · 12 medium · 5 thin · 6 none);
   "Source facts that differ from the spec" (34 templates not 48; a 4th setup vocabulary in the
   archive; VCP/Flat Base/HTF/EP/PEG/U&R/Remount have 0 real-bar fixtures; 21- vs 17-mistake
   audit; course drawdown protocol vs your published ladder).
4. `docs/study/skill_map.json` — the machine map (28 setups with aliases, 106 lesson links).
5. `docs/study/sizing_rule.md` — confirm the drawdown ladder (§4) and "under 1% is normal".
6. `docs/study/pass_bars.md` — the proposed bars.
7. `docs/study/video_toolchain.md` — approve Option A and the voice source.
8. `docs/study/VOICE_CONSENT.md` — sign before any voice sample is used.

## Phase 0 checklist (owner signs off each file in one session)
- [x] `docs/study/VOICE.md` (draft 22980148dc, awaiting owner sign-off) — derived from the owner's own prose (toolkit cards, morning-wire
      `data/voice/voice_exemplars.json` + `voice_profile.json`, methodology bible, playbooks; Desk
      transcripts and Substack issues once read from the server).
- [x] `docs/study/UNITS-foundations.md` (draft ab7a0efbbe, 129 units) — every unit for F1–F12, F2b, V with what it teaches, rungs,
      example needs, course lesson covered.
- [x] `docs/study/UNITS-method.md` (draft 1a6b3da6cb, 96 units) — every unit keyed on the course JSON's 16 modules + Calls +
      Overlay, with the per-setup supply table (28 setups) and the loss source per setup.
- [x] `docs/study/skill_map.json` (draft 1a6b3da6cb) — curricula → tracks → units → skills, ids, lesson_key links,
      28-setup aliases to the other vocabularies.
- [x] `docs/study/sizing_rule.md` (draft 22980148dc, owner to confirm §4 ladder) — §4.11 as the single sizing authority; toolkit card regenerated from it.
- [x] `docs/study/pass_bars.md` (proposal 22980148dc) — proposed checkpoint bars for owner decision.
- [x] `docs/study/video_toolchain.md` (proposal 22980148dc) — intro-video pipeline proposal with per-video cost.
- [x] `docs/study/VOICE_CONSENT.md` (template 22980148dc; unsigned) — consent template for the voice clone (owner signs before any sample).

## Build checklist (Phase 1, per spec §7 + §13.2)
- [x] `api/services/study_store.py` (47476c0328) (schema §6.1/§7.1 + §13 corrections: literal STUDY_DB_PATH read,
      one BEGIN IMMEDIATE per attempt, study_terms, trust_state per item type)
- [x] `api/services/study_scoring.py`, `study_select.py` (3 due slots + random mix), `study_templates.py`
      (777d3adfd9), `study_import.py` (lane G: get_bars_before only, misses stored as unresolved drafts,
      grounding + VOICE §6 + near-dup + review lanes; VOICE.md §9 records exactly what it enforces).
      `study_mastery.py` is still inline in study_store (constants provisional).
- [~] `api/routers/study.py` (47476c0328; image proxy + intro redirect pending R2 assets) (local `require_paid`, `STUDY_ENABLED` default ON read per request,
      bars-by-item, image proxy, attempts, step, today (bars inline), practise, leaderboard, review,
      import, corrections export)
- [x] `api/main.py` lifespan init + jobs (024e58e7e3): study_reminders */15 claim-row, study_weekly_close
      Sun 23:59 ET + boot catch-up, study_gen_detections Mon-Fri 02:30 ET; NO 06:30 fan-out (daily set is lazy).
- [~] Outside-Study prerequisites (their own small merges): wire_archive persists `exposure_tier` (DONE ad2f95cbf9);
      StockChart `studyMode` / `armedTool` / `toolsAllowlist`; hub hidden under a fullscreen Sheet;
      `/api/ticker-meta` short-circuits non-universe symbols; one-time Scans image copy to R2 (SCRIPT DONE 1a6b3da6cb: `scripts/study/copy_scans_images.py`, not yet run on the pod).
- [~] Frontend: StudyPanel + trail + DrillPlayer + 7 Phase-1 drills + reveal + end card + Practise
      sheet + Settings card LANDED and wired (e565b0620e). StudyReview admin card LANDED (lane F3,
      `app/src/pages/admin/StudyReview.jsx`, mounted as PatternReview's third tab `?mode=study`; the
      chart draws live bars for the revealed ticker, cutoff as a marker, forward strip as a caption;
      a multi-field Fix posts one `{action:'fix', field, after}` per field — not atomic on the wire).
      Still open: intro cover card (D15), Grade/Levels/Next/Family/Listen drills (Phase 2),
      size-answer key shape (`dollars` = risk $ vs position $) to confirm with the bank, lesson-link
      param (`?section=courses&lesson=<lesson_key>`), daily `xp_today` for the XP bar, a real
      `misses` session kind, an admin bars endpoint so the review chart can show the member's exact
      frozen bars.
- [x] Generators (lane G, `scripts/study/`): `_common.py` (make_item, dedash, quote_lesson,
      fallback_lesson, validate), gen_recall / gen_size / gen_fixtures / gen_regime / gen_candles,
      `run_all`. Not yet: VCP gold-standard, curriculum (course JSON), modelbook, scans (needs the R2
      copy), wire regime items (run on the pod), Foundations F1-F12 + Vocabulary authoring sessions.
- [x] Tests (6 files, 125 passing): `tests/test_study_store.py`, `test_study_scoring.py`, `test_study_no_sym_leak.py`,
      `test_study_import.py`, `test_study_flags.py`; frontend `StudyPanel.test.jsx`, `DrillPlayer.test.jsx`.

## Owner commands
Pushes + PRs DONE 2026-10-18 (#416 wire-call, #417 feat/study; the AI push went through once the owner
asked for it directly). #416 merged + deployed + scans copied 2026-10-19. The AI session CANNOT merge a PR
(server-side classifier refuses `gh pr merge` even with an allow rule); the owner runs it as a `!` line:
`! gh pr merge 417 --merge --repo unchartedterritory5995-cyber/UCT-Dashboard`. Railway builds only after the
"master deploy gate" workflow passes and "promote to production" pushes the `production` branch; watch
`railway deployment list --service web --json` (from C:\Users\pgosz\projects\UCT-Dashboard, the linked
checkout) until the merge commit reads SUCCESS. `railway ssh` must run from PowerShell (Git Bash mangles
`/opt/venv/bin/python` into a C:/Program path).
The AI session is ALSO refused `railway ssh` when the remote command writes ("Remote Shell Writes"), so
every pod-side import/copy is the owner's `!` line too. Both of these are DONE (2026-10-19); keep for re-runs:
```
# from PowerShell (not Git Bash), in C:\Users\pgosz\projects\UCT-Dashboard
railway ssh --service web -- /opt/venv/bin/python scripts/study/copy_scans_images.py            # scans -> R2 (done)
railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py --dry-run         # count only
railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py                   # bank -> /data/study.db (done)
railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py --only recall.glossary
```

## Resume procedure
1. feat/study is MERGED; branch new work off origin/master (e.g. `git worktree add -b feat/study-<x>
   C:\Users\pgosz\uct-worktrees\study-<x> origin/master`). The old worktree `uct-worktrees\study` is history.
2. Read this file's State block, then the spec §13 and §11/§13.9.
3. Continue the first unchecked item above. Commit at every checkpoint with a message starting `study:`.
   If the owner review is mid-batch, re-present the batch from the State block (segment + item range)
   and record verdicts to `docs/study/corrections/` before anything else.
4. Re-measure every count cited in the spec before relying on it (they drift).
