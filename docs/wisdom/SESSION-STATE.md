---
id: WISDOM-LOOP-SESSION-STATE
title: UCT Wisdom Loop — session state (SINGLE RESUME AUTHORITY)
status: STALE BELOW THIS POINT (frozen 2026-09-13/14, "session ~4/5") — see the 2026-09-19 entry
  immediately below for current state. Golden-v1/seven-build-streams content further down is a
  valid HISTORICAL record of that phase; do not read "Merged to master: nothing" etc. as current.
written: 2026-09-13 ~15:45 ET (14:45 CT); updated 2026-09-13 21:15 UTC after merge 1; refreshed
  2026-09-19 (this top entry only — see note above)
---

# Session state

> ## ⭐⭐ LATEST — 2026-09-19, session 28 (continued): the day's real work, in one place
>
> **⛔⛔ THIS FILE HAD NOT BEEN UPDATED SINCE 2026-09-13/14 UNTIL NOW — 14+ sessions of real work
> (through "session 28") happened with this file frozen at golden-v1/seven-build-streams. Every
> entry below this one is HISTORY from that earlier phase, not current state.** The actual current
> running log for this programme is **`docs/wisdom/HARD-RULES.md`**, appended to continuously —
> read it, not this file's stale body, for anything past 2026-09-14. This entry exists so a
> session that (correctly) opens this file FIRST is not misled by its own frozen middle.
>
> **Where the programme actually stands, verified from source (git + a live Railway read), not
> asserted from memory:**
>
> | | |
> |---|---|
> | Golden-v1 | **FROZEN** long ago (this file's own §6 "NOT FROZEN" is stale — see HARD-RULES R43/R98 for the identity rules ruled since) |
> | Extraction system | **N-pass (N=3) voting + reconciliation, live in production code, armed for real** — this is a completely different, much later architecture than the single-pass golden-gate work this file's body describes |
> | Sources live | Zoom/YouTube (unchanged, complete) · Substack/Sunday Scans (65+ sources) · Discord (6 authors: tsdr/bracco/manrav/chartmaster/jersace/attheask, + Main Chat + 18 Setup Examples channels) · Twitter/X (tsdr/bracco/chartmaster official accounts) |
> | Extraction budget | **ARMED at the owner-chosen moderate pilot scale** — `WISDOM_EXTRACT_BUDGET_USD=175`, `WISDOM_EXTRACT_DAILY_BUDGET_USD=28`, `WISDOM_DAILY_SEGMENT_LIMIT=315` — **read live via `railway variables --service web --kv` on 2026-09-19**, not assumed. (Down from an earlier same-session $1800/$400 arming the owner explicitly rejected as a 15x scale-up nobody chose.) |
> | Listeners | `WISDOM_DISCORD_LISTENER_ENABLED=1`, `WISDOM_TWITTER_LISTENER_ENABLED=1` — **same live read** |
> | First real extraction run | **Happened, 2026-09-19 morning** — 302 requests, ~$27.95, 338 records (44 MARKET_SIGNAL / 143 MENTION / 151 PRINCIPLE). **Permanently stuck at `stability=NULL`** — a real N-pass parity bug (see below) let pass 3 ship a partial 92/105-segment subset, so `reconcile()` correctly refuses to score it forever. This data is a known, accepted, non-recoverable loss; the bug that caused it is fixed (see below) so it should not recur. |
> | Adversarial review | A 4-dimension review of the whole `extract/` subsystem found **9 real bugs, all independently verified (9/9 confirmed, 0 rejected)**. **All 9 are now fixed** (the N-pass parity bug that caused the loss above, plus 8 more — full list with root cause / fix / mutation-proof for each in `HARD-RULES.md`'s "Session 28, part 3" section and its "all 8 findings fixed" update, including the hardest one, a budget TOCTOU race, closed last). |
>
> ✅✅ **RESOLVED, SAME DAY: ALL FIXES ARE NOW LANDED AND DEPLOYED (2026-09-19, later this session).**
> The paragraph below is kept, struck-through in spirit rather than deleted, because it was true
> when written and the correction matters more than a clean rewrite — this file has already paid
> once for a stale claim standing unmarked. ~~THE FIX CODE IS NOT YET IN PRODUCTION, AND PRODUCTION
> IS ARMED RIGHT NOW.~~ It now is: `origin/master` is `f8fd3c5ac` ("Merge branch 'feat/wisdom-loop'
> into HEAD"), `git merge-base --is-ancestor ed7dad1d3 origin/master` confirms the branch tip
> (carrying all 10 commits — the 9 adversarial-review fixes incl. the TOCTOU race, the two
> pre-existing test regressions the full-suite sweep caught, and this file's own earlier refresh)
> is an ancestor. Railway `web` deployed that exact commit (`status: SUCCESS`), confirmed against
> the **artifact, not the status field**: `GET /api/health` returned `uptime_seconds: 41` — a
> genuinely fresh process boot. Landed via `tools/land_master_first.py feat/wisdom-loop`, run
> directly by the owner in a real terminal (the classifier that refused a `--no-push` dry run for
> an agent session did not apply to the owner's own invocation) after two real concurrent-deploy
> refusals from `pre_push_guard.py` (a stacked D-05-shaped queue, then a single settling deploy)
> both cleared naturally. **This closes the actual urgency**: Monday 2026-09-22's scheduled daily
> chain run now executes the fixed code, not the pre-fix code this entry originally warned about.
>
> ⛔ **The mechanism, for the next time this comes up:** landing to master via any tool that reads
> as a production-deploy action is refused for an AGENT session by Claude Code's own permission
> classifier (`[Production Deploy]`) — confirmed again this session, including for a `--no-push`
> dry run that pushes nothing. It is not refused for the account owner typing the same command
> themselves in their own terminal. There is no way to route around this from inside a session; the
> correct move (used here) is to hand the owner the exact commands and verify the result afterward,
> not to keep retrying the blocked tool call.
>
> **NEEDS THE OWNER (all four items below predate this fix and are UNCHANGED by landing it —
> "landing to master" itself is done and removed from this list):**
> 1. **`R106` (a monthly extraction spend line/ceiling) — an open owner question from session 27,
>    never resolved** (searched HARD-RULES.md for a resolution; found none as of this entry).
> 2. **Whether to broaden the Discord storage filter for Main Chat / Setup Examples beyond the
>    named CALL authors** (to capture other members' posts as MENTION-only) — explicitly flagged
>    in HARD-RULES.md ("session 28... Discord scope changed") as "OPEN, NOT DECIDED... needs its
>    own explicit owner ruling," a real change to the `S0.4e` privacy guarantee, not a config flip.
> 3. Two smaller open threads named in HARD-RULES.md's own text, not re-verified here: the
>    `AtTheAsk`/`alex-jones` channel identity question, and whether `#jersace`'s Discord user id
>    has been filled in now that the channel grant went through (it was left `null`/PENDING at
>    grant time, per the record).
>
> **Everything else already happened this session with the owner directly in the loop** (the
> budget re-arm from $1800/$400 to $175/$28, all six Discord/Twitter/Substack source grants, the
> first real extraction run) — do not re-ask about those; `HARD-RULES.md` records each ruling with
> its date.
>
> ⚠️ **Not verified this refresh, and worth checking before trusting it:** whether the RUNNING
> container process actually has these `--kv` values (this repo's own standing caveat: `--kv`
> shows service CONFIG, which is not proof the live process read it) — HARD-RULES.md's session-28
> close-out entry says these were "confirmed in-process," which corroborates but was not
> independently re-verified in-process during this refresh. Also not verified: `PROGRAM-MANIFEST.md`
> §status line ("nothing merged to master") and `CONTRACTS.md` are themselves stale in the same
> way this file was — they were not updated as part of this refresh; treat their headline status
> lines with the same skepticism this entry is correcting here, and read `HARD-RULES.md` instead.

> ## ⚖️ OWNER RULINGS — 2026-09-14 morning. Wave 1 CLOSED on master; Wave 1.5 starts now.
>
> **Wave 1 is closed on master. The three scheduled gates stay open by design** (3 consecutive
> sessions of capture health · first weekly report Sunday 2026-09-20 · D20 after CALL-REPLAY
> n ≥ 100 and two weeks of silent scoring).
>
> | item | ruling |
> |---|---|
> | **D-R2** | The reviewer is right. **ONE program-level total**, carried in the ledger across all extractor versions, models and runs; per-version and per-run spend are **reported sub-lines, never separate budgets**. **Cap raised $15 → $40** for Wave 1.5's multi-pass extraction. Every run still prints spend-to-date against the cap and stops at it. Recorded in LEDGER.md with the reversal. |
> | **HF token** | The line was left unfilled, and the owner's instruction is that this means **"text-only for now"**. ⛔ So diarization stays OFF and **the STT output as delivered stands** — 356 at 100.0 %, no speaker inferred anywhere. |
> | **G-030** | Left blank, so **it stays in the Contradictions queue**. ⛔ **Both statements stay non-canonical and NOTHING about the 50 SMA publishes** — not to Brain KB, not to Ask-AI, not to a dossier, **not to a Model Book playbook draft, and not into the clip export's record list**. ⚰️ This read "not to the voice profile" until 2026-09-14 (session 4, R11): `voice.py` has **no PRINCIPLE path at all** (`voice.py:33-39`, `:44-79` read `wisdom_sources.title` and segment text), so that clause forbade nothing, while the two lanes that DO carry a PRINCIPLE — `modelbook.py:129-131` and `clips.py:45-48` — went unnamed. |
> | **RESUME.md §3** | The cap instruction was wrong and is fixed: `--max-usd` is the **ledger-carried total**, not the remainder. Passing 15 last night was correct. |
>
> ⛔⛔ **WAVE 1.5 BLOCKS ANY D18 PUBLISH.** Items 1–5 must be done and the drift number must be in
> the weekly report before Brain KB repair begins. Publication floor: no PRINCIPLE or
> MARKET_SIGNAL publishes under a named author unless **stability = 1.0 (3/3)** AND confirmed or
> provisional-with-evidence; 2/3 may surface only in the admin review queue.
>
> ⭐ **THE CONSUMER MAP, VERIFIED FROM SOURCE 2026-09-14 (session 3 §0b, applied session 4 R11).**
> The floor has to be enforced at **four** points, because three different mechanisms reach these
> record types and only one of them is `select_records`:
>
> | consumer | how it reaches PRINCIPLE / MARKET_SIGNAL | enforcement point |
> |---|---|---|
> | dossiers, Model Book drafts | `adapters/common.py:149` `select_records` | `common.select_records` |
> | Brain KB rows | a **direct `wisdom_principles` SELECT**, `brainkb.py:83-86` — `select_records` never sees it | `brainkb.export_payload:189-201` |
> | Ask-AI | the **FTS index**, `askai.py:73` → `retrieval.py:184-205` (docs built `:84-116`) | `retrieval.search` |
> | clip export | untyped SQL over all six types, `clips.py:45-48`, **no feature flag** — gated only by `require_push_secret` (`routes.py:160-162`); metadata only, no text | `clips.clip_candidates` |
>
> ⛔ **`voice.py` has NO PRINCIPLE path** (`:33-39`, `:44-79`) and is not an enforcement point;
> `voicefmt.corpus_documents:42-65` exports raw segment text, which no record-level floor reaches.
> ⛔ **`modelbook.py:129-131` DOES have one** and was never named in the original wording.
> ⛔⛔ **The review queue is NOT upstream of these lanes.** Brain KB, Ask-AI and dossiers each
> reach a member without ever enqueueing, so "2/3 may surface only in the admin review queue"
> requires a **paired `enqueue`** at the blocking site — otherwise a 2/3 record vanishes instead
> of surfacing. `review.enqueue` (`review.py:112-139`) is idempotent via `item_id_for` (`:89-90`).
>
> ⭐ **Order matters and the owner set it: reduce variance at the SOURCE first** (item 4 — tighter
> schema, atomic segments, enums verbatim in the prompt), **re-measure drift on the SAME 10
> segments**, and only then decide whether to buy N=3 voting. Item 6: print the projected
> full-catalog 3-pass spend before starting it, and run it only if the schema change alone did not
> solve it.
>
> **Next checkpoint: after tonight's LIVE daily chain run on Railway (after today's close, flags
> dark), reporting per-step results, D12 capture counts (session 1 of 3) and the Discord catch-up
> count from the four author channels.**

> ## ⭐⭐ LATEST — THE OVERNIGHT RUN IS COMPLETE. All six steps done. 2026-09-14 05:00 CT
>
> **ALL SIX §8.4 MASTER MERGES ARE ON MASTER**, each with Railway `web` SUCCESS and a fresh-boot
> `/api/health` before the next was pushed:
> S-A `fb62a44d9` · S-C `a64336c89` · S-D `7a2b54369` · S-E `98a18b969` · S-F1 `b9b12b828` ·
> **S-F2 `27921010f`**. Master tip `fedd8dea1`, confirmed by `merge-base --is-ancestor`.
>
> ⚰️ **The S-F1 and S-F2 entries read `49fdc1fbc` and `fedd8dea1` until 2026-09-14 (session 4, E4)**
> — those are the DEPLOYED TIPS, each a fix commit that landed after its merge, not the merge
> commits. `49fdc1fbc` is the first parent of `27921010f`. The master tip on that line is correct
> and unchanged; it is the tip, and it is not merge 7.
>
> **PRODUCTION IS DARK, MEASURED NOT ASSUMED:** six services, 430 variables, **zero `WISDOM_*` set
> anywhere**; `flag_ledger_audit` reports 0 in every category; **27 of 27 real Wisdom GET routes
> return 401** to an anonymous caller and none returns JSON.
>
> ⭐⭐ **THAT PARAGRAPH IS NOW AN INSTRUMENT, NOT A SENTENCE — `scripts/wisdom_dark_check.py`**
> (owner ruling R6, 2026-09-14). A number typed into a document cannot be re-run, and this repo
> has paid for that twice: a flag ledger that described an unreleased surface while members used
> it, and a `DESK_PUBLIC_SHOWS` wildcard that contradicted its own documentation for 25 days.
>
> ⛔ **Both halves are DERIVED, never typed.** The gates come from **`flags.GATES`** — the list
> the admin status page and the ledger rail already read, which also carries `member_visible`;
> the routes come from `registry.routers()`, the same call `api/main.py` mounts them with. An
> AST walk over `os.environ.get` / `os.getenv` inside `api/services/wisdom/**` cross-checks for
> any switch read **outside** that registry, because a gate added straight to `os.environ.get`
> would otherwise be invisible to this instrument and to the ledger rail simultaneously.
> ⛔ **Three exit codes** — `0` PASS (measured, dark) · `1` LIT (measured, not dark) ·
> `2` INCONCLUSIVE (could not measure) — because "we could not measure it" and "it is lit" are
> different facts, and collapsing them is how an unmeasured deploy reads as a clean one.
> `--self-check` proves every check can fail, on planted inputs, touching nothing real.
>
> **Run 2026-09-14, session 4. `R6_RUN_AGAINST_PROD: NO`, so production was NOT probed.**
>
> | | |
> |---|---|
> | `--self-check` | **PASS**, 13 checks |
> | dry run (default) | **INCONCLUSIVE (exit 2)** by design — it prints what it would check and measures nothing |
> | `--local` | **PASS (exit 0)** — 0 of 25 gates set on this machine |
> | derived | **25 gates** in `flags.GATES` = **10 member-visible** + 15 owner/internal; **0** switch-shaped env vars read outside the registry; **27 GET routes** = 23 `require_admin` + 3 `require_push_secret` + 1 `require_owner`, **0 unguarded** |
>
> ⭐ **The route count reproduces the recorded 27 exactly, from the registry rather than from a
> list**, and the guard classification is the part the old sentence never carried. ⚠️ **What this
> run did NOT establish: that production is dark.** The local half measures this machine, which
> says nothing about Railway; the 401 half needs `--host` and was not run. Those remain the
> 2026-09-14 05:00 CT hand measurement until somebody runs the instrument against production.
>
> ⛔⛔ **AND THE FIRST VERSION OF THIS INSTRUMENT WAS BLIND TO A MEMBER-FACING SWITCH.** It
> derived the flag list by matching `^WISDOM_[A-Z0-9_]+$` string literals — so it could not see
> **`ASKAI_WISDOM_RETRIEVAL_ENABLED`**, the Ask-AI kill switch, which is *member-visible* and does
> not carry the prefix. It would have printed "0 switches set, dark" while a member-facing lane
> was lit. ⭐ **A name-prefix scan is not a measurement of what the code reads**, and the fix was
> to key on the env-read call site and on the registry instead. The same prefix scan had also
> reported four switches that do not exist — `WISDOM_CAP` (a Python constant `= 50`),
> `WISDOM_PKG_DIR` and `WISDOM_IMPORT_PREFIX` (module constants), and `WISDOM_PRIVATE_KEYS_V1`
> (a name appearing only inside a docstring). Both directions of that error are railed in
> `tests/test_wisdom_dark_check.py`.
>
> ⚰️ A bug found by running it, recorded because it is the failure the exit codes exist to
> prevent: on a cp1252 Windows console the first `⛔` in a print raised `UnicodeEncodeError` and
> the script exited **1 (LIT)** — an instrument reporting a measured failure it had never
> measured. Fixed by reconfiguring stdout to UTF-8 with `errors="replace"`, the same fix
> `flag_ledger_audit` needed on 2026-09-10.
>
> **§8.6 acceptance: 11 PASS · 0 FAIL · 1 INCONCLUSIVE** (the daily chain's `sources` step — no
> local Discord token, unseeded `edu_videos`; environmental, reported as inconclusive not pass).
>
> **P5 COMPLETE — $11.6504 of $15.** Gate accepted on golden-v1 `db3475c814ee` (57 segments);
> per-type precision/recall in checkpoint 12. **Trial verdict: NO SWITCH** (not a tie; sonnet ~19 %
> cheaper per record, mixed on quality, tiny n). ⛔ Two caveats outrank the table: "accepted" is a
> BASELINE with nothing to regress against, and **763 of 882 kept records were never scored**
> because only predictions overlapping a labelled span are scorable.
>
> ⛔⛔ **THE FINDING THE OWNER SHOULD READ FIRST: drift `mean_jaccard 0.505`.** Same model, same
> effort, same 10 segments, run twice — **PRINCIPLE agrees on 6 of ~30, MARKET_SIGNAL on 4 of ~17**.
> Those are the record types D18 would publish into the Brain KB and Ask-AI under a named author.
> A row that would not survive re-running the extractor on the same paragraph is a sample, not a
> teaching. Measurement only; every publish adapter stays dark.
>
> **STT COMPLETE.** 356 rescued **4.2 % → 100.0 %** (1398 cues, no internal gaps). **254 and 221
> were never broken** — their whole shortfall is dead air after a sign-off, 0 internal gaps, proved
> by a VAD-off probe of both tails. ⚠️ The under-98 % rule over-flags; gate it on INTERNAL gaps.
> ⛔ And never raise coverage by disabling VAD — the 221 probe hallucinated *"All right."* eleven
> times out of silence.
>
> **Full detail: `docs/wisdom/OVERNIGHT-CHECKPOINTS.md`, checkpoints 8–12.**
>
> **STILL NEEDS THE OWNER:** the G-030 rule in his own words; the HF token or "text-only for now"
> (STT ran text-only, which is consistent with his NO on diarization); and a ruling on S-D's
> reviewer reversing the documented "cap is per `extractor_version`" decision (D-R2).

> ## ⭐ LATEST — overnight autonomous run, resumed 2026-09-13 23:40 CDT (past the account-limit reset at 22:20 CT)
>
> **ON MASTER, all dark, each verified by artifact:** S-B rails `e5dfb23fb` · drift-#4 `2e6f3453e` ·
> **S-A capture `fb62a44d9`** · exposure fix `d4281342c` · **exposure REVERSAL `75324ec78`**.
>
> **`DESK_PUBLIC_SHOWS="*"` is the owner's deliberate decision** (2026-08-19, reaffirmed 2026-09-13),
> declared in `docs/feature_flags.json` with a dated `owner_decision` and railed on both the offline
> and live halves. ⛔ **Leave it.** The 66 legacy videos stay as they are; the 3 gone videos
> (`vslaRnO9G3E`, `hmGZSV_axHo`, `znjo804B_0k`) are reported only.
>
> ⛔⛔ **RESOURCE CAP — AT MOST 3 AGENTS ON THIS BOX, INTEGRATOR INCLUDED.** Written into CLAUDE.md
> with the evidence. The whisper/STT job runs ALONE or beside one light agent. Print free memory and
> the running-agent count before every launch and REFUSE the launch if the cap would be exceeded.
> ⚰️ On 2026-09-13 a 13-agent fan-out beside the STT job killed the STT run for low memory AND burned
> the account limit (7 of 12 agents died). Every individual agent was well-scoped; **the aggregate was
> never checked. Scoping each job does not bound the sum of the jobs.**
>
> **ACCOUNT LIMIT:** reset observed at **22:20 CT**. If it hits again: pause CLEANLY — commit and push
> every branch, bring this file current, record the next reset time — and resume at reset without
> waiting for the owner.
>
> **ORDER OF WORK (owner plan, supersedes the earlier pace ruling):**
> 1. Reviewers in PAIRS — pair 1 **S-C + S-E** (running), pair 2 **S-F1 + S-F2**, then S-D
>    (scout → owed items on the branch → reviewer).
> 2. Master merges serialized through the integrator, §8.4 order: **S-C → S-D → S-E → S-F1 → S-F2**.
>    Rebase on current master immediately before each; gate on the MERGE; web SUCCESS between.
> 3. P4 golden propagation + freeze — beside pair 2, **lands before S-D merges**.
> 4. P5 golden gate — resume from checkpoint, **$4.45 of $15 already spent, do not restart from zero**.
> 5. STT — re-issue the same command; **only when the box is otherwise idle**.
> 6. Acceptance run §8.6, then the §9.1 Definition of Done walked line by line.
>
> **Nothing needs the owner except:** 007/008 ("unknown" is a valid answer), the G-030 rule in their
> own words, and the HF token or "text-only for now".

> ## ⭐ LATEST — merge 1 is live (2026-09-13 21:10:33Z)
>
> **`wisdom/w1-b-rails` `010fadbe2` → master `e5dfb23fb`. Railway `web` SUCCESS; `/api/health`
> `uptime_seconds: 36` on a fresh boot.** Everything is DARK: all 25 `WISDOM_*` flags are `dark`
> and none is set on any service. `/api/admin/wisdom/core/{status,runs,private/{id}}` each return
> **401** to an anonymous caller. Ledger Section 2 row 1 carries the full evidence.
>
> **P1 CLOSED.** The 16 leaked production R2 objects (2,399 B) are listed by key in the ledger,
> deleted, and the bucket re-probes `0 objects, 0 bytes` under `wisdom/`. The durable fix is
> `core/r2.py` refusing a real client under pytest; S-C's suite re-run with the guard ARMED →
> 71 passed, which is the isolation measurement rather than an absence of complaints.
>
> **P2 CLOSED.** The stranded `# MUTATION R-a` marker on the owner-gated private route is
> restored (a sweep of all seven branches found exactly one extra marker, no others); §7 gate on
> the MERGE (not the branch alone) 788 passed / 1 pre-existing non-Wisdom failure; four reviewer
> findings fixed on the branch rather than deferred, plus a fifth the review did not reach.
>
> ⚠️ **Master moved twice under this work** (`d623baf1d` → `834034622` → `89c6b12bf`) from other
> sessions. Re-measure "behind" rather than carrying a number forward, and check the deploy queue
> is idle before pushing — one master merge at a time, repo-wide.
>
> **NEXT:** S-A is the next merge in the §8.4 order. Then P3 (Track A re-transcription + the desk
> audit from id 350), P4 (golden-v1 freeze), P5 (resume the golden gate from $4.453353 of $15 —
> never re-submit `msgbatch_01Kvf7Q9ZinucRR7xfKQTsnq` or `msgbatch_019NjdbTHu1eK3MXbW2zxMC7`),
> P6 (remaining stream reviewers + S-F1 frontend chunked), P7 (Zoom pipeline fix + the 345s root
> cause). ⛔ **F2's fix gates S-A**: the off-limits rail now covers the flow-worker watched files,
> so an S-A diff touching one fails by name instead of shipping a permanent OPRA tape gap.

Resume in this order: this file, then `docs/wisdom/RESUME.md` (the restart procedure), `CLAUDE.md`,
`docs/wisdom/PROGRAM-MANIFEST.md` and `docs/wisdom/CONTRACTS.md` (the build contract; §8a holds the checkpoint-1 rulings).
The owner's Wave 1 text is gitignored at `data/wisdom/WAVE1-PROMPT-v2.0.md` in the integrator worktree.

## 1. What this session accomplished

- **Session 0:** discovery, manifest, schema v0, vocabulary v0, golden v0 (30 records) and the verifier. Owner rulings
  D1–D10 all YES.
- **W1 GO v2.0 received**, with D11–D20 YES. Settled in `CONTRACTS.md`: 29 contradictions, layout, registry/store API, 25 dark gates, schedule, merge protocol.
- **Skeleton `ca0b9b801`:**
  - `api/services/wisdom/` (registry, store, flags, heartbeat, R2, authors, owner gate, core jobs) plus `api/routers/wisdom_*.py`;
  - three `api/main.py` hooks;
  - 25 gates declared dark;
  - 19 tests green.
- **Discord (W1 §2.1) DONE:**
  - The bot role was granted in the Discord web UI on #tsdr, #bracco (+READ_MESSAGE_HISTORY), #1chartmaster and #manrav. All four return HTTP 200.
  - Author user IDs are verified by authorship.
  - #volume-alerts, #uncharted-scanners and #test-chartmaster-alerts are app-authored: out of scope, not granted.
- **Golden v1** (125 records, stratification met) is integrated as `2e1f9f4bb`. **It is NOT frozen yet** (§6).
- **Checkpoint 1 landed.** The owner rulings are recorded in CONTRACTS §8a. Manifest, ledger, authors.json and the schema contract are updated.
- **Zoom correction landed.** Recovery is dropped; the rule is desk-check first, then store-and-verify before delete. Manifest, ledger, CONTRACTS and memory are corrected.
- **Seven build streams** ran in parallel worktrees (Workflow `wf_c1669d34-d75`) until the pause. Every branch is WIP-committed and pushed (§2).
- **Desk-transcript audit (Step 0), partial.** Video 356 has no transcript copy with ≥ 98 % coverage anywhere reachable:
  - **Stored:** 76 speaker-labelled cues, 57–345 s of 6,830 s (5.05 %). The final cues discuss stopping and restarting the recording.
  - **Full-length sources remaining:** R2 `desk_audio/rKVAkk3811Q.m4a` (83,057,014 B) and one YouTube ASR caption track (coverage not measurable without a download).
  - **Searched, nothing found:** uct-clips, uct-recaps, C:\data, local Zoom/Downloads folders, and the stale uct-dashboard checkout.
  - **Likely root cause** (inference from code): the recording was stopped and restarted, creating one MP4 and one TRANSCRIPT per segment. The publisher took the largest MP4; the insights pass took the FIRST transcript (the short segment); nothing checked coverage before delete.
  - **Fix:** commit `9a260ca45` on `wisdom/w1-c-sources` (not on master).
  - **Catalog:** ids 1–350 swept, 314 rows exist, 36 ids return 404. Coverage percentages wait for YouTube durations.

## 2. Branches (exact SHAs at pause; local = origin for every one)

| Branch | SHA | Pushed |
|---|---|---|
| `feat/wisdom-loop` | `61413c06b` plus the pause-docs commit on top (this file + RESUME.md; its SHA is in the pause report — verify with `git log -1`) | yes |
| `wisdom/w1-b-rails` | `b128cebf3` | yes |
| `wisdom/w1-a-capture` | `6beb884a0` | yes |
| `wisdom/w1-c-sources` | `0a18ce47a` | yes |
| `wisdom/w1-d-extract` | `d492367c4` | yes |
| `wisdom/w1-e-evals` | `27a6d7032` | yes |
| `wisdom/w1-f-admin` | `7b3408a8f` | yes |
| `wisdom/w1-f-publish` | `6c4d24c74` | yes |
| `wisdom/w1-d-golden-prop` | `61413c06b` (no own commits yet) | yes |
| `wisdom/w1-d-golden` | `21801941a` (done; cherry-picked into feat as `2e1f9f4bb`) | yes |

**Worktrees** (all clean at pause):
- `C:\Users\Patrick\uct-worktrees\wisdom-loop` (integrator);
- `C:\Users\Patrick\uct-dashboard\.claude\worktrees\wf_c1669d34-d75-{1..7}`, numbered b-rails, a-capture, c-sources, d-extract, e-evals, f-admin, f-publish;
- `...\worktrees\agent-a2d7f7d184d0d0c60` (golden-prop).

The S-F1 worktree has an `app\node_modules` **junction**; remove it with `cmd /c rmdir` before any `git worktree remove`.

## 3. Stream table

Tests at pause = `tests/test_wisdom_*.py` in each worktree, run in parallel just before the pause (S-C also ran `tests/test_desk_session_insights.py`).
- **Import bans:** the four ban rails exist only on the S-B branch and were not run across streams at pause.
- **Reviewers:** no reviewer verdict completed. The workflow was stopped while builders were still working; the S-A reviewer had started.

| Stream | Branch @ SHA | Tests | Bans | Reviewer | In progress at pause | Next action on resume | Blockers |
|---|---|---|---|---|---|---|---|
| **S-B** rails | `w1-b-rails` @ `b128cebf3` | **RED**: `tests/test_wisdom_core_private_routes.py::test_the_private_route_is_owner_only_on_the_real_app` (1 failed, 343 passed, 2 skipped) | not run | none | Owner-private route + `docs/wisdom/methodology/rails-v1.md` (WIP `024a9de89`). Done: ban rails, private store + core_002..006, entities/aliases/STT/speakers, vocabulary v1 + maps | 1. Fix the red route test. 2. Apply §8a: `team-unresolved` speaker rule, `exit_price` in the property test, `ticker_inferred`. 3. Run the ban rails against every stream branch. 4. Run the CONTRACTS §7 rails. 5. Reviewer. 6. **First master merge (§8.4)** | red test |
| **S-A** capture | `w1-a-capture` @ `6beb884a0` | GREEN 95 passed | not run | started, no verdict | **Builder DONE**; report saved at `data/wisdom/review/workflow-wf_c1669d34-d75-builder-report-1.md` | Re-run the S-A review. Then: merge after S-B; arm `WISDOM_INGEST_ENABLED` + `WISDOM_CAPTURE_ENABLED`; first live run per the report §F | the S-B merge |
| **S-C** sources | `w1-c-sources` @ `0a18ce47a` | GREEN 171 passed (incl. desk insights) | not run | none | Built: pairing fix `9a260ca45`, Discord poller/backfill/legacy reconcile, transcript + Sunday Scans ingest, routes/tools | 1. **Fix test isolation**: a test run wrote 16 fixtures to production R2 (§8); tests must never reach the real bucket. 2. Implement §8a.6a store-and-verify (VTT + audio transcript + chat log + metadata, coverage ≥ 98 %). 3. Desk-first repair tool (§8a.6b). 4. Reviewer | R2 fixture leak |
| **S-D** extract | `w1-d-extract` @ `d492367c4` | GREEN 112 passed | not run | none | Golden gate / drift / trial run was killed mid-run at the pause: $4.45 of the $15 cap, 2 batches collected. Methodology `extraction-v0.md` is WIP. The transport schema was reduced to fit the API's 16 union-parameter limit | 1. Resume the gate from `data/wisdom/extract/pilot/*` + `spend-ledger.json` with `--max-usd` = the remaining cap; never re-submit collected batches. 2. Finish the drift + smaller-model delta. 3. Apply §8a.4 inferred-ticker and §8a.5 exit fields; score against the FROZEN golden-v1 only. 4. Reviewer | golden-v1 freeze |
| **S-E** evals | `w1-e-evals` @ `27a6d7032` | GREEN 77 passed | not run | none | Built: outcomes, context, CALL-REPLAY, metrics 6.1–6.3, grounding 6.4 engine, tools, routes | Continue the brief (fixture baseline k/n, grounding question set); §8a.5 exit reconciliation (`exit_mismatch` flag); reviewer | none |
| **S-F1** admin | `w1-f-admin` @ `7b3408a8f` | GREEN 77 passed (backend); **vitest not run at pause** | not run | none | Built: review queue, chains + jobs, weekly report/packet, RUNBOOK draft, publish routes, admin page `/admin/wisdom` | Run vitest rails under the box lock; finish the brief; reviewer | none |
| **S-F2** publish | `w1-f-publish` @ `6c4d24c74` | GREEN 88 passed, 2 skipped | not run | none | Built: adapter stores + FTS5, Brain KB rows/export/sync, Ask-AI block (dark), markers/badges/dossier, D19 drafts, D20 scorer + look-alike (disabled), clip export, private-field property rail | §8a.5 exit redaction in every member-facing path; finish the brief; reviewer | none |
| **golden-prop** | `w1-d-golden-prop` @ `61413c06b` | verifier self-check PASS | n/a | n/a | Tasks 1–5 evidence gathered, nothing written (`data/wisdom/golden/PROPAGATION-RESUME.md`) | Resume per the resume note: read `ev3_out.txt`, then backups, rewrite, session-resolutions, verifier, freeze + sha | none |

**ETA** (estimates, not commitments):
- **Streams into `feat/wisdom-loop`:** 2–4 working hours after resume.
- **S-B to master:** the first session window after its red test is fixed and reviewed.
- **The rest:** one per deploy cycle in §8.4 order.
- **Carry-over:** today's unmet §9.1 items ship tested on the next working day, per §0.5.

## 4. Master merge status

- **Merged to master: nothing.** No Wisdom deploy has happened.
- **Next in §8.4 order:** S-B rails (blocked on its red test), then S-A → S-C → S-D → S-E → S-F.
- **Railway:** web was serving before the pause. Production returned 502 twice (~19:14 and ~19:19 UTC) during other programs' deploys; both recovered by 19:21 UTC.
- **Before any merge:** check the Notebook, Discord render and Data Charts programs for in-flight merges.
- **Standing deploy constraints:**
  - one master merge at a time, with web SUCCESS verified by an `/api/health` uptime reset;
  - no push 17:50–18:30 ET on Notebook gate days;
  - no push within ±3 min of odd ET hours while the Q1 sampler runs.

## 5. Background jobs

| Job | Where | Last checkpoint | Resume |
|---|---|---|---|
| Anthropic Batch `msgbatch_01Kvf7Q9ZinucRR7xfKQTsnq` (2 requests, gate) | Anthropic | **collected** | nothing pending; do not re-submit |
| Anthropic Batch `msgbatch_019NjdbTHu1eK3MXbW2zxMC7` (30 requests, gate) | Anthropic | **collected** | nothing pending; do not re-submit |
| S-D golden gate / drift / trial (local; killed at pause) | `data/wisdom/extract/` (`spend-ledger.json`, `pilot/gate-report-*.json`, `pilot/*.db`) | $4.453353 of $15 spent | RESUME.md §3 |
| Desk-transcript audit (local; stopped) | `data/wisdom/audit/AUDIT-RESUME.md`, `desk-transcript-audit-2026-09-13.partial.json` | ids 1–350 swept | RESUME.md §3: `audit_catalog_sweep.py ... 351` |
| Golden propagation agent (stopped) | `data/wisdom/golden/PROPAGATION-RESUME.md` | evidence for tasks 1–5 | RESUME.md §3 |
| Build workflow `wf_c1669d34-d75` (stopped) | journal copied to `data/wisdom/review/workflow-wf_c1669d34-d75-journal.jsonl` | only the S-A builder finished | a continuation workflow per RESUME.md §1 |
| Railway-hosted Wisdom jobs | — | none exist (nothing deployed) | — |

- **Scratch copy:** the whole session scratchpad (understand maps, audit scripts, Discord history, evidence dumps) is copied to
  `data/wisdom/scratch/session-5691081b-scratchpad/` (518 files).
- **Preserved reviewer repro:** `data/wisdom/review/rv-a-capture__test_rv_past_asof_repro.py`.
- **Preserved S-C scratch:** `data/wisdom/scratch/c-sources-sc_scratch/`.

## 6. Golden-v1 status

- **Integrated:** `2e1f9f4bb`, 125 records (117 confirmed, 8 provisional).
- **Types:** CALL 40, NEGATIVE_CALL 17, MENTION 22, PRINCIPLE 27, LEVEL 11, MARKET_SIGNAL 8.
- **Authors:** tsdr 76, bracco 25, manrav 11, chartmaster 10, ravi 1, guests 2.
- **Split:** dev 67, test 58.
- **NOT FROZEN.** The freeze needs the §8a propagation, then three verifier passes, the leaked-quote check and the sha256 recorded in the ledger.
- **Propagation findings so far:**
  - **G-018 → NOW:** confirmed by bars.
  - **G-011 / G-014:** unaffected.
  - **G-002:** already correct.
  - **Inferred tickers:** G-014, G-018 and G-055, all passing the bar check (0 flips so far).
  - **"Uncharted Territory":** mostly TSDR with strong evidence, and Bracco in specific handed-off stretches. Sessions 303, 325, 334, 342, 345 and 349 are still undecided. Expected: no author change on golden records except confirming G-057 as bracco; G-035 and G-052 can leave provisional.
  - **Joe Walburn = Chartmaster:**
    - hosts address the 1ChartMaster guest as "Joe" in 8 recordings;
    - Discord `capt.joe_36972` has global name "1Chartmaster";
    - the X @1ChartMaster bio links whop.com/uncharted;
    - the roster has no other Joe;
    - no self-introduction line was found in 277/307.

## 7. Owner rulings this session (all stand; do not re-ask)

- **Session 0 / rulings message.**
  - D1–D10 YES.
  - Sunday Scans: published Substack posts only, never drafts.
  - D6 was delegated and resolved as the MERGE MAP (publish into existing systems).
  - D11–D20 were requested and later approved.
  - "Use all our data."
- **W1 GO v2.0.**
  - **Mandate:** full automation; verify, don't ask; owner judgment is a veto (provisional into the queue).
  - **Hard rules §0.4 a–i:**
    - published Substack only;
    - Journal / J2 / Notebook / broker out of scope;
    - no member-visible change without an owner flip;
    - private content-stream data only in the private store;
    - no member messages;
    - public repo quote-free;
    - paid content entitled only;
    - one master merge at a time;
    - off-limits paths.
  - **Decisions:**
    - D11–D20 YES with rails;
    - D16 split: D16a YES, D16b DEFERRED with no date;
    - D12 capture ships first;
    - D13 50-image cost gate;
    - D14 guests MENTION / guest PRINCIPLE only;
    - D15 n < 30 = insufficient data;
    - D18 never delete (build → eval → diff → admin swap → archive; "Bonde" re-attributed by evidence, else unknown);
    - D19 drafts only;
    - D20 disabled until CALL-REPLAY n ≥ 100 plus two weeks of silent scoring.
  - **Authors:** four CALL authors (tsdr, bracco, manrav, chartmaster).
  - **Vocabulary:** 32 approved; one authority plus maps; mismatches with no renames; contradictions to the weekly report; coined_by=TSDR; STT aliases; auto-promote at ≥ 3 team uses.
  - **Extraction:** Opus 5 Batch, schema output, golden gate, smaller-model trial, budget cap $80 × 1.5.
  - **Delivery:** publish adapters dark with flags; metric definitions 6.1–6.7; loop cadence; parallel streams; merge order §8.4; DoD §9.1; roadmap W2–W6.
- **Checkpoint 1** (CONTRACTS §8a):
  - freeze golden-v1 (additions go to v1.1+) and print the type × author table in the ledger (done);
  - the 13 queue items stay provisional and are listed in one block at the next checkpoint;
  - "Uncharted Territory" resolved per session by evidence only, else `team-unresolved` (MENTION only); never default to TSDR or Bracco; retroactive re-tag;
  - Joe Walburn alias approved with an identity and roster check;
  - exit_price, exit_text and exit_date approved, with a mismatch flag and private when open or closed ≤ 20 sessions, plus redaction in the property test;
  - G-018 / G-002 corrections propagated;
  - permanent inferred-ticker rule (confidence ≤ 0.5 plus a bar-range pass);
  - checkpoint format: status table first, cost and Batch progress every time, SESSION-STATE current;
  - next checkpoint after the first master merge (S-B).
- **Zoom correction:**
  - Zoom recordings are deleted on purpose after posting; Track B is dropped;
  - Step 0 desk check for 356 and every video under 98 %;
  - otherwise re-transcribe the full audio with the Desk STT plus diarization, naming clusters by evidence only (else `unresolved`);
  - Stockbee is a guest (D14);
  - rebuild as a new source version and put the speaker map in the attribution queue;
  - the pipeline stores the VTT, audio transcript, chat log and metadata in R2 and verifies ≥ 98 % before delete;
  - the root cause ships or is filed.
- **Recorded refusal:** the integrator will not submit a browser-autofilled password (a platform safety rule); the Zoom correction made that path moot.
- **Pause:** this file and RESUME.md are the resume authority.

## 8. Open items (none need the owner)

1. **Test fixtures in production R2.** `wisdom/sources/zoom_vtt/` holds 16 test-fixture objects (2,399 bytes, written ~18:00 UTC by an S-C test run).
   - **Integrator plan:** leave them (Wisdom has no delete path).
   - **Fix:** make S-C tests use a fake client only, and add a `core/r2.py` guard that refuses real writes under pytest.
   - **Later:** record the keys as known fixtures so capture health and ingest ignore them.
2. **S-B red route test.** Fix before the first master merge.
3. **Diarization tooling is absent on this box.** Python 3.14 only; no pyannote, SpeechBrain, Resemblyzer or torchaudio, and no Hugging Face token. torch, scikit-learn and faster-whisper models (base.en, small, large-v3, tiny.en) are cached.
   - **Recommendation for Track A** (only if the desk audit stays empty, which it currently is for 356): transcribe with faster-whisper base.en (the Desk gapfill STT) in an isolated venv, with a CPU speaker-embedding model installed there, never into the shared interpreter. Name clusters by evidence only.
4. **Ledger rows owed on resume:** the pause-docs commit, and the stream merges when they land.
5. **Today's §9.1 items not finished:**
   - first live capture run;
   - Discord backfill;
   - catalog Batch;
   - metrics baselines;
   - daily chain run;
   - weekly preview;
   - 356 transcript rebuild;
   - golden freeze.

   Per §0.5 they ship tested next, not untested today.

## 9. Review queue (golden v1, unchanged at pause)

13 items on 12 records:

| Tab | Items | Records |
|---|---|---|
| attribution | 6 | G-016, G-024, G-035, G-052, G-057, G-065 |
| golden | 4 | G-002, G-018, G-028, G-055 |
| contradictions | 1 | G-030 |
| authors | 1 | G-057 |
| vocabulary | 1 | G-079 |

The full block (gid, label, proposed change, evidence, recommendation) is due in the next checkpoint.

## 10. Cost to date

| Line | Actual | Source |
|---|---|---|
| Anthropic API (S-D gate / drift / smaller-model trial, incl. the 2 Batch jobs $0.247504 + $2.526160) | **$4.453353** | `data/wisdom/extract/spend-ledger.json` |
| Anthropic Batch pending | $0 | both batches collected |
| TwitterAPI.io | ≈ $0.003 (S-A smoke, 20 tweets) plus 1 user lookup (golden-prop; cost not measured, < $0.01) | stream reports |
| OpenAI | $0 | — |
| R2 storage (`wisdom/`) | 16 objects, 2,399 bytes (test fixtures): ≈ $0 | audit R2 inventory |
| Railway | no new service or job | — |

Budget caps are untouched: extraction catalog $120 (not started), S-D gate $15 ($10.55 left), S-E grounding $5 (none spent).

## 11. Open questions for the owner

None.
