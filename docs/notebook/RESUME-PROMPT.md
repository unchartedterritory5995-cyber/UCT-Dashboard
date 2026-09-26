# The one prompt to resume the Notebook 10/10 program

> Paste everything in the fenced block below into a fresh Claude Code session,
> opened in `C:\Users\Patrick\uct-worktrees\notebook-k`. Nothing else is needed
> to fully re-establish the mission, the plan, the standing rules, and exactly
> where to pick up.

```
You are resuming the UCT Notebook "10/10" program — taking the Notebook feature
of the UCT Dashboard (a trading platform at uctintelligence.com) from its
current state to "complete and impressive" against Notion, Evernote and
Obsidian, on 16 measurable standards. This is a multi-week, multi-wave
programme already in progress. Read this whole prompt before doing anything.

============================================================
THE MISSION AND THE FULL PLAN
============================================================

The vision (owner's own words): "the best personal research notebook a trader
can use — everything a Notion/Evernote/Obsidian user reaches for every day
works, feels fast and never loses a word — and on top of that it does what
none of them can: evidence captured from filings with page-anchored
citations, an AI that answers only from your notes and shows exactly where,
research assembled per security, charts frozen as of the moment, notes wired
to trades, and theses that warn you when they break. It is a personal tool
that shares well, not a team wiki."

The authoritative plan document, read it in full before making any judgment
call the summary below doesn't cover:
    docs/notebook/NOTEBOOK-10-OF-10-PLAN.md

16 scored standards (current average ~6.2/10, owner's own estimate 6.8/10):
features, functionality, reliability, speed, UX, UI, data safety/durability,
security/privacy, accessibility, mobile/offline/cross-device, import/export/
interop, AI trustworthiness, search quality, performance at scale,
operability/observability, onboarding/learnability. Each has a measurable
"what 10/10 means" definition in the plan doc's scorecard — use those
definitions, not vibes, when judging whether something is done.

THE PHASES (0 through 7, phases 1-5 delivered as waves 5-9, see below):

- Phase 0 (Land and stabilise, BLOCKS EVERYTHING): deploy PR #183, decide the
  Wave Q1 offline-editing gate verdict, close the offline data-loss paths
  (F5P-1, the append-merge finding, the plain-typing 409), turn on error
  reporting, rehearse a backup restore, refresh stale gap-ledger rows.
- Phase 1 (Editor completeness): syntax highlighting, math (KaTeX), text
  colour/highlight, callout icon/colour picker, image captions/alignment,
  table UI (add/delete rows/cols, header, resize, sort), drag handles, table
  of contents, word count, find-and-replace, emoji picker, @date mentions,
  web embeds/link bookmarks, multi-column layout, H4-H6, touch undo/redo.
- Phase 2 (Organization and navigation): quick switcher over ALL notes, bulk
  operations, nested tags, unlinked mentions, timeline view, archive, note
  lock, split view, reminders + tasks view, member templates, daily note,
  relation property with backlinks.
- Phase 3 (Capture and mobile): browser extension publish, iOS capture (PWA +
  Shortcuts over a scoped API), camera OCR, docx/xlsx text extraction,
  email-to-notebook, editor dictation, real-device matrix.
- Phase 4 (AI, trustworthy): writing help (summarize/rewrite/continue/
  translate) with provenance labels, semantic retrieval once vendor terms are
  verified, G-064's Ask-insert flipped on, AI over non-PDF attachments.
- Phase 5 (Sharing): share links + publish-to-web, comments, real-time
  co-editing ONLY if the owner reverses the "no multiplayer" ruling (G-081).
- Phase 6 (Quality bars, runs ALONGSIDE 1-5): performance budgets in CI, the
  50k-scale super-linear fix, accessibility (axe + aria + keyboard graph +
  screen-reader passes), security/privacy (vendor terms, share-link auth
  review), operability (SLOs + alerts), onboarding (help articles, tour),
  interop (HTML/JSON/docx export, two-way sync where offered).
- Phase 7 (Prove it — the finish line): head-to-head speed benchmark vs
  Notion/Evernote/Obsidian, full parity re-score, a task-based user study
  with 5-8 real traders (SUS >= 80), a 30-day reliability soak with zero data
  loss, a second-reviewer accessibility audit. ONLY once every standard meets
  its bar is the Notebook called 10/10.

THE WAVE PROGRAMME (delivery mechanism for phases 1-5, three agents at a time,
each wave: implementer -> task review -> fix rounds -> whole-branch review ->
six-shard gate against baseline -> live walk -> PR -> owner deploy):

- Wave 5 (Phase 1 start): lane A offline integrity (D3's two data-loss
  fixes), lane B editor foundation (syntax highlighting, math, colour/
  highlight, emoji, H4-H6, find-and-replace, word count, TOC), lane C
  navigation (quick switcher, bulk ops, nested tags).
- Wave 6 (Phase 1 continued + Phase 2 + Phase 6 start): editor content 2
  (tables UI, callout picker, image captions, drag handles, multi-column,
  web embeds, @date mentions), organization 2 (unlinked mentions, timeline,
  archive, lock, split view, reminders/tasks, templates, daily note, relation
  property), operability (error beacon, telemetry, restore-drill tool).
- Wave 7 (Phase 3 + Phase 4 start + Phase 6 continued): capture & mobile
  (extension packaging, iOS API/Shortcut, OCR, email-in, dictation), AI
  (writing help, semantic search dark, Compass tool), performance (CI
  budgets, the 50k fix).
- Wave 8 (Phase 6 continued + Phase 5): accessibility, sharing (share links +
  publish-to-web), onboarding + interop.
- Wave 9 (Phase 7): the benchmark harness, parity re-score, user-study kit,
  30-day soak.

KEY STANDING DECISIONS ALREADY RULED (owner delegated "make final judgement
calls on all open decisions... I trust your vision and testing" — full
D1-D16 table with reasons is in the plan doc; do not re-litigate these):
real-time multiplayer/team workspaces/plugin marketplace are OUT OF SCOPE;
share links + publish-to-web + the browser extension + a small personal API
are IN; iOS gets PWA+Shortcuts, no native wrapper; the "no caching service
worker" charter is KEPT (cold-start offline stays out of scope, open-tab
offline durability stays in); AI writing help ships on the existing Anthropic
path, semantic search is built but stays dark until vendor zero-retention
terms are confirmed in writing; performance budgets are adopted as specified
in the scorecard; pages-inside-pages is OUT (folders+links+backlinks instead);
E2E encryption/desktop app/canvas are OUT; relations are IN, rollups/formulas
OUT until demand is measured; email-to-notebook is IN as a provider-agnostic
webhook; error reporting is our own client-error beacon + telemetry (no new
vendor); backups get a restore-drill tool, retention documented as "up to 7
days"; the gate baseline is re-adopted fresh at each landing.

============================================================
WHAT STAYS WITH THE OWNER — NEVER ATTEMPT THESE AS AN AGENT
============================================================
1. The production push for each wave (the permission system blocks an
   agent's master push — do not try to route around it).
2. Production variable flips if the permission system blocks them.
3. Legal sign-off and written vendor data terms (Anthropic, OpenAI).
4. Infrastructure needing credentials the agent doesn't have: inbound-email
   DNS, publishing the browser extension to the Chrome Web Store, running
   the backup restore drill against real R2 production data.
5. The Phase 7 user study with real traders.

============================================================
CURRENT STATE — READ THIS BEFORE DOING ANYTHING ELSE
============================================================

FIRST: read docs/notebook/wave5-6-RESUME-HERE.md in this worktree in full —
it is the up-to-date checkpoint with exact SHAs and is the single source of
truth for exactly where waves 5 and 6 stand. The summary below may already be
stale by the time you read it; that file's own verification checklist tells
you how to re-derive current truth.

As of the last checkpoint (2026-09-24):

- Two worktrees: C:\Users\Patrick\uct-worktrees\notebook-k (feat/notebook-10,
  wave 5) and C:\Users\Patrick\uct-worktrees\notebook-w6 (feat/notebook-w6,
  wave 6, built on an EARLIER tip of wave 5 -- now behind by several commits,
  merging wave 5's tail onto it is an open item). BOTH ARE PUSHED to origin.
- Wave 5 (lanes A, B, C): all closed and merged. The whole-branch review found
  one safety-critical BLOCKER (B1: the schema guard that protects an old
  browser tab from blanking a note when new editor features ship was
  checking the wrong bundle's version) which is now FIXED and independently
  verified by the controller (commit 82c56dd63), plus a should-fix (S1, also
  fixed, commit 1320d0f83). A scoped re-review of that fix is still OWED
  before wave 5 is truly closed.
- Wave 6: lane F (error beacon, telemetry, unlinked mentions, reminders) is
  CLOSED. Lane D (a 13-item editor/organization brief) stopped at a
  reasonable-looking checkpoint but has NOT been formally closed out or
  reviewed. Lane E (organization 2: archive, lock, templates, daily note,
  relations, timeline, split view) was dispatched and produced NOTHING
  before being interrupted -- it needs a full fresh dispatch.
- BLOCKER: a weekly Opus rate limit was hit simultaneously across three
  concurrent agents. It blocks NEW subagent dispatch (not the controller
  session itself) until it resets. Check docs/notebook/wave5-6-RESUME-HERE.md
  for whether that reset time has passed; do not assume from the clock alone
  -- try a small dispatch first if uncertain.
- The SDD ledger for this specific programme (full lane-by-lane history,
  every ruling, the single open-items tracker) lives at
  notebook-k/.superpowers/sdd/2026-09-23-notebook-10/progress.md and
  OPEN-ITEMS.md -- these are GITIGNORED, local-disk-only, never pushed. Read
  them for the full blow-by-blow; do not delete that worktree without backing
  up that directory first.
- A Discord message is QUEUED (not yet sent) in that same SDD workspace's
  DISCORD-QUEUE.md, explaining the #183 hold status to the owner. Check
  whether the Chrome extension is connected and send it if it's still
  accurate and unsent.

============================================================
STANDING PROCESS RULES -- FOLLOW THESE WITHOUT BEING ASKED AGAIN
============================================================

- Delegation: the owner said "keep executing with you accomplishing all
  tasks autonomously and making decisions on anything undecided on your own
  ... Notify me in discord of any notable decisions or actions I need to
  take." Act on this. Don't stop to ask permission for ordinary judgment
  calls within the plan; do notify Discord for anything the owner actually
  needs to know or act on (deploys, safety findings, scope decisions not
  already covered by D1-D16).
- Use the subagent-driven-development skill/process: fresh implementer
  subagent per task, task review after each (spec compliance + quality),
  fix rounds, then a whole-branch review before closing a wave. Track
  progress in the SDD ledger (progress.md / OPEN-ITEMS.md), not only in your
  own memory -- a lost session must be able to resume from the ledger alone.
- At most 3 concurrent agents plus the integrating session, on this account,
  ever. Check free memory and running-agent count before dispatching.
- TDD with mutation-proving on every guard: red before green, then mutate
  the guard and prove the test catches it, restore bytes and verify sha256
  (never `git checkout` to undo a mutation).
- Commit by explicit pathspec, never `git add -A`. Run tests in their own
  tool call, before `git commit` -- never chained in one shell invocation.
  `python tools/check_repo_hygiene.py --staged` must be clean before every
  commit.
- The F5-frozen offline files (serverChange.js, settleNoteWrite.js,
  outboxDrain.js) are nobody's to edit except via a deliberately justified,
  disclosed exception, matching the precedent of the "D3 lift".
- Never push to master. Every wave lands as a feature-branch PR; the owner
  deploys.
- A test run without a totals line is not a run; a background-task exit code
  is not a verdict -- read the actual manifest/output.
- Full repo-wide standing rules are in CLAUDE.md at the repo root -- it is
  long; read the sections relevant to whatever you're about to touch (it has
  its own index of hard-won lessons for this exact codebase). It also now
  carries a short pointer section ("Notebook 10/10 program") linking back to
  the resume doc.

============================================================
YOUR FIRST ACTIONS, IN ORDER
============================================================

1. Read docs/notebook/wave5-6-RESUME-HERE.md in full.
2. Re-derive current git state on both worktrees using the verification
   checklist in that file (don't trust this prompt's SHAs -- they age fast).
3. Check whether the weekly Opus rate limit has cleared.
4. If clear: dispatch the scoped re-review of the B1 fix (commits 82c56dd63
   + 1320d0f83) against .superpowers/sdd/2026-09-23-notebook-10/
   wave5-B1-fix-brief.md's exact required rails and the Web Locks trace
   question -- this is the one thing standing between wave 5 and being
   truly closed.
5. Then: re-run the six-shard gate on the post-fix tip, re-walk, open the
   PR for feat/notebook-10 (branch is pushed; PR itself was never opened --
   check gh auth state first, it was unauthenticated as of the last
   checkpoint).
6. In parallel (respecting the 3-agent cap): confirm/close out wave 6 lane D
   against its brief, and re-dispatch lane E from scratch.
7. Merge wave 5's tail onto feat/notebook-w6.
8. Once waves 5-6 are fully closed and merged, continue into wave 7 per the
   plan above and docs/notebook/wave7-briefs.md (re-verify those briefs
   before dispatch -- they may need updating given how much has landed
   since they were drafted).
9. Keep going through waves 8-9 and the remaining phases until every one of
   the 16 standards meets its measurable 10/10 bar, per the plan doc's
   scorecard. Update the plan doc's scores as evidence changes; don't let it
   go stale the way other docs in this repo have (see CLAUDE.md's own
   extensive record of exactly that failure mode).

Do not ask the user whether to proceed with this plan -- it is already
approved and in progress. Proceed.
```
