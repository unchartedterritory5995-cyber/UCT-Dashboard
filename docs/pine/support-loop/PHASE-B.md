# Indicator support loop — Phase B: the daily ranked fix loop

Branch `feat/indicator-support-loop-b`. Phase A ([PHASE-A.md](PHASE-A.md)) records which
TradingView built-ins members' pastes lose (gap counts) and stores opt-in "doesn't match"
reports. Phase B turns that into a daily, ranked queue of fix-ready work, and measures
whether the work is moving the number.

> ⛔ **Nothing in this loop changes production code.** It produces *fix packets*. A person or a
> Claude session turns a packet into a branch; the branch is reviewed; only then does it ship.
> Nothing here merges, deploys or edits the engine.

## The loop, end to end

```
 members paste ──► Phase A gap counts + opt-in reports (auth.db, web)
                         │
 08:20 ET daily  ──► 1. DIGEST (web, light): top open gaps by distinct members, minus the
                         gaps the CURRENT build already fixes; open reports.
                         ─► GET /api/indicator-support/digest (admin)
                         ─► GET /api/internal/indicator-support/digest (PUSH_SECRET bearer)
                         ─► one line to the admin Discord channel when there is work
                         │
 person / Claude ──► 2. TRIAGE (this PC): tools/support_loop/triage.py gap|report
                         reproduces through the real member door (the census), finds the
                         other scripts on the same wall, writes a FIX PACKET; a report
                         moves to `triaged`.
                         │
 implementer     ──► branch ─► review ─► merge ─► deploy   (never automated)
                         │
 after deploy    ──► 4. LIFECYCLE: triage.py mark-fixed --gap NAME | --report ID
                         reports -> `fixed` (starts Phase A's 30-day deletion clock),
                         their working copies purged.
                         │
 nightly         ──► 3. RE-MEASURE (this PC, heavy_lock): the census on origin/master,
                         a dated row + diff in %LOCALAPPDATA%\uct-support-loop\coverage-history
```

| Step | Who runs it | Where | Touches member content? |
|---|---|---|---|
| 1 Digest | the web scheduler, 08:20 ET | production `web` | reads counts and report metadata; **emits none** |
| 2 Triage | a person or a Claude session | this PC | **yes, a report's source**, in the work directory only |
| Fix | an implementer (person or agent) from the packet | a branch | must NOT copy member source |
| 3 Re-measure | Windows Task Scheduler | this PC | no (public corpus + local cache) |
| 4 Mark fixed | whoever shipped the fix | this PC | deletes the working copies |

## 1. The daily digest

**Code:** `api/services/indicator_support_loop.py`; routes in `api/routers/indicator_support.py`;
scheduler job `indicator_support_digest` in `api/main.py` (08:20 ET, every day).

**Contents** (`build_digest`):

```json
{"day": "2026-10-30", "built_at": "…Z", "window_days": 30,
 "door_manifest": {"sha": "3f2a…", "counts": {"reachable": 148, "call-unmapped": 393, "name-unknown": 214}},
 "translator_version": "<deployed commit>",
 "gaps": {
   "open": [{"rank": 1, "name": "ta.alma", "kind": "name-unknown", "members": 4, "hits": 9,
             "first_day": "…", "last_day": "…", "days_seen": 6,
             "door_status": "name-unknown", "fixed_on_master": false}],
   "open_total": 31,
   "fixed_on_master": [{"name": "dayofmonth", "kind": "name-unknown", "members": 2, "hits": 3,
                        "door_status": "reachable"}],
   "unlisted": {"members": 5, "hits": 12, "first_day": "…", "last_day": "…"}},
 "reports": {"counts": {"new": 1, "triaged": 2},
             "open": [{"id": "…32 hex…", "status": "new", "created_at": "…", "symbol": "AAPL",
                       "timeframe": "D", "gaps": [{"name": "ta.alma", "kind": "name-unknown",
                       "fixed_on_master": false}], "has_note": true, "has_link": false,
                       "source_bytes": 900, "same_script_reports": 2, "translator_version": "…"}]}}
```

⛔ **No member content and no member id**: no source, no note text, no link, no `reporter`.
That is what lets it go to Discord and to the bearer-authenticated tool.

**How "fixed on master" is decided.** The server is Python and the door is JavaScript, so the
door's answer is generated as data and committed beside the allowlist:
`app/src/components/chart/supportLoop/doorNameCoverage.json`. `doorNameCoverage.js` puts each
of the 755 allowlisted built-ins into small probe scripts and runs the Pine translator; a
refusal is attributed to a name only when its `token` is that name, the same attribution
`importGaps.js` uses when it logs a member's gap. `doorNameCoverage.test.js` regenerates the
file and **fails when the committed copy differs**, so the file is the build's answer, not a
remembered one. Regenerate it in the same change as a fix:

```sh
cd app && WRITE_DOOR_NAME_COVERAGE=1 node node_modules/vitest/vitest.mjs run src/components/chart/supportLoop/doorNameCoverage.test.js
```

The rule (`fixed_on_master`, mirrored by `doorNameCoverage.js::fixedOnMaster`, railed on both sides):

| gap kind | fixed on master when | why |
|---|---|---|
| `name-unknown` | the door now **knows** the name (`reachable` or `call-unmapped`) | that wall is gone; a member who now hits a call-shape wall logs a new `call-unmapped` gap |
| `call-unmapped` | a `fixedGaps.json` entry for (name, kind) whose **minimal repro** translates in this build | the door already knew the name; whether a member's call shape maps is a fact about a call, which a name probe cannot see |
| anything else (`_unlisted`, unknown name, `unprobed`, unreadable manifest) | never | every uncertainty resolves to OPEN |

`fixedGaps.json` entries are `{name, kind, probe, pr}`; `probe` is a whole Pine script the
implementer writes (never member source). Every regeneration re-asks every probe, so a
regression flips the gap back to open.

**Once a day, and light.** `daily_digest` builds at most once per ET day *and manifest hash*,
stored in `indicator_support_digests` (auth.db, 60 days). A deploy that changes the door
changes the hash, so a fix drops off the day it ships. A build is two indexed SELECTs over
small tables and one JSON read; it is not a heavy job and never runs the engine.

**Delivery.** `run_daily_digest` (the job) posts **one** embed to the admin Discord channel
through `discord_notify._send_webhook` (the admin-events sink, `DISCORD_WEBHOOK_URL`): the top
10 open gaps by members, the names that dropped off, and the report counts. It posts only when
there is something to act on, and claims the day with a conditional UPDATE so two processes
cannot both post. `PINE_SUPPORT_DIGEST_POST=off` (an env var on `web`, read per call) silences
the post; the digest is still built and served. Unset means on.

## 2. Triage (`tools/support_loop/`)

| file | job |
|---|---|
| `triage.py` | the CLI |
| `client.py` | the bearer client for `/api/internal/indicator-support/*` |
| `door.py` | runs the census test (`coverageMapDoorCensus.measure.test.js`) on given scripts |
| `similar.py` | other scripts on the same wall (`docs/pine/coverage-map.json`, the census cache, the corpus) |
| `packet.py` | renders the fix packet |
| `workdir.py` | the only place anything is kept on disk, and its purge |
| `remeasure.py`, `remeasure_task.bat` | step 3 |

Needs `app\node_modules` (junction it from a worktree that has one: `mklink /J`; never
`npm install`). The census cache is optional but makes "similar scripts" and TradingView's own
examples available: `--cache %LOCALAPPDATA%\uct-support-loop\pine-sample --ref
%LOCALAPPDATA%\uct-support-loop\ref\pine_v6_reference.json` (built by
`tools/pine_coverage/fetch_sample.py` and `tools/pine_survey/pine_reference_extract.js`, see
[COVERAGE-MAP.md § How to re-run](../COVERAGE-MAP.md#how-to-re-run)).

```sh
python tools/support_loop/triage.py --url https://uctintelligence.com digest
python tools/support_loop/triage.py --url https://uctintelligence.com gap ta.alma --cache … --ref …
python tools/support_loop/triage.py --url https://uctintelligence.com report <id> --cache …
python tools/support_loop/triage.py --digest-file saved-digest.json gap ta.alma   # offline
```

**`gap NAME`** writes probe scripts (TradingView's own reference example when `--ref` has
one, plus `plot(NAME(close, 14))` and `plot(NAME)`) and up to three sample scripts blocked by
the same wall, runs them all through the member door exactly as the census does, and writes
`.support-loop-work/gaps/NAME/PACKET.md` plus `links.json` (the open reports that name it). The
kind is derived from the door's guard with `doorCoverage.js::UNKNOWN_NAME_GUARDS`, read from
that file, never re-typed.

**`report ID`** fetches the report (source and note, never the reporter), writes it to
`.support-loop-work/reports/ID/`, runs it through the door, keys its first wall the way the
coverage map does, and writes `reports/ID/PACKET.md`. A `new` report moves to `triaged`.

**The packet** (sample below): the wall (name, kind, guard, capability, the door-name probe's
status), the demand (members, pastes, linked reports), the repro through the member door with
each refusal and the line it names, the affected-script counts (blocks / sole wall, from the
coverage map; extra census-cache hits; corpus scripts that *use* the name, including the legacy
bare `alma(` spelling), the Pine v6 reference link, the suggested files (by capability, plus
engine files that already mention the name), the parity-capture needs (existing vendor captures
whose source uses it, and what to capture by `docs/pine/VENDOR-HARNESS.md`), and the definition
of done.

## 3. Re-measure

`remeasure.py` re-runs the census over the cached sample into a **fresh** run directory (the
census appends, so a re-measure never reuses an old answer), scores every script with
`coverage_map.transfers_fully` (the coverage map's headline predicate, factored out and
imported, so the nightly number and the map cannot disagree), and writes to `--history`:

* `coverage-history.jsonl`: one dated row (date, sha, sample, transfer, %, by population,
  examples, delta, gained, lost);
* `scripts/<date>_<sha>.json`: the per-script verdicts the next diff reads;
* `coverage-latest.md`: the number, the change since the previous row, the scripts that
  started transferring and the ones that **stopped** (regressions).

Exit 0 = measured, 1 = the census did not answer every script (nothing recorded),
3 = measured with at least one regression. It writes nothing in the repo. Verified on this
branch against the 2026-10-30 census: `summarize` reproduces the committed map's
**185 / 679 (27.2%)** exactly.

**One-time setup** (a checkout kept only for measuring, so `--sync-master` can move it):

```bat
git -C C:\Users\Patrick\uct-dashboard worktree add --detach C:\Users\Patrick\uct-worktrees\pine-measure origin/master
mklink /J C:\Users\Patrick\uct-worktrees\pine-measure\app\node_modules C:\Users\Patrick\uct-worktrees\fill-default\app\node_modules
mkdir %LOCALAPPDATA%\uct-support-loop
REM then build the sample cache and the reference into %LOCALAPPDATA%\uct-support-loop\pine-sample
REM and ...\ref\pine_v6_reference.json (COVERAGE-MAP.md, How to re-run, steps 1-2)
```

`--sync-master` refuses unless that checkout is clean and on a detached HEAD.

**The scheduled task (not registered by this branch; run this once to register it):**

```bat
schtasks /Create /TN "UCT Pine Remeasure" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 22:30 /TR "wscript.exe \"C:\Users\Patrick\uct-clips\run_hidden.vbs\" \"C:\Users\Patrick\uct-worktrees\pine-measure\tools\support_loop\remeasure_task.bat\""
```

`remeasure_task.bat` runs, under the heavy lock:

```bat
C:\Python314\python.exe C:\Users\Patrick\uct-clips\tools\heavy_lock.py run --label pine-remeasure -- C:\Python314\python.exe <measure>\tools\support_loop\remeasure.py --repo <measure> --sync-master --cache %LOCALAPPDATA%\uct-support-loop\pine-sample --ref %LOCALAPPDATA%\uct-support-loop\ref\pine_v6_reference.json --history %LOCALAPPDATA%\uct-support-loop\coverage-history
```

22:30 CT keeps it clear of the 20:05 market_ingest and the 21:00 brain pack export. It takes
about ten minutes and a 6 GB node heap; the heavy lock queues it behind any other heavy job.

## 4. Report lifecycle

| event | command | status | effect |
|---|---|---|---|
| picked up | `triage.py report ID` | `new` -> `triaged` | the member sees "Being looked at" |
| fix deployed | `triage.py mark-fixed --gap NAME` | -> `fixed` | refuses unless the SERVER's digest lists NAME under `fixed_on_master` (i.e. the deployed build fixes it; `--force` overrides); closes every open report naming it plus `links.json`'s; purges their work directories |
| one report | `triage.py mark-fixed --report ID [--wontfix]` | -> `fixed` / `wontfix` | same purge |
| housekeeping | `triage.py purge --closed` | — | deletes the work directory of every report no longer open (closed, withdrawn or expired) |

`fixed` and `wontfix` start Phase A's 30-day retention clock (`purge_expired`); the server
deletes the row then.

## Authentication: how the local tool reaches the server, and why it is safe

The tool **never signs in**. It calls only `internal_router`
(`/api/internal/indicator-support`), gated by `require_push_secret`: the `PUSH_SECRET` bearer
already used by every other `/api/internal/*` router (`wisdom_publish`, `wisdom_sources`,
`media_evidence_bridge`) and by this repo's existing local tools (`tools/wisdom/archive_import.py`
reads it from the shell's `PUSH_SECRET` the same way).

| route | method | returns |
|---|---|---|
| `/digest` | GET | the digest (no member content) |
| `/reports` | GET | open reports: no source, no note, no link, no reporter |
| `/reports/{id}` | GET | one report WITH source and note (the reason it exists), still no reporter |
| `/reports/{id}` | PATCH | `{status}` only, one of `new/triaged/fixed/wontfix` |

* fails **closed**: an unset or blank `PUSH_SECRET` refuses everyone (401);
* constant-time comparison on UTF-8 bytes, so a non-ASCII header is a 401, never a 500;
* read-only plus the status PATCH: no create, no delete, no other field (railed by route table);
* the auth-surface boot audit already recognises `require_push_secret` as a gate.

On the client: the secret is read from the environment only (never a file, never a prompt),
put in one header, and never printed. `SupportLoopClient.__repr__` omits it and every error
passes through `redact`.

## Privacy

| content | where it may exist | removed when |
|---|---|---|
| member source + note | production `indicator_support_reports` (Phase A); on this PC only in `.support-loop-work/reports/<id>/` | the report is marked fixed/wontfix (`mark-fixed`), or `purge --closed` after a withdrawal or expiry |
| the door's answer for a report (quotes refused lines), the report's packet | same directory | same |
| gap packets (quote reference-only corpus lines) | `.support-loop-work/gaps/<name>/` | never needed in git; delete freely |

* `.support-loop-work/` is in `.gitignore`; `workdir.check_root` asks git that it is ignored
  before writing, and refuses a non-ignored root inside any checkout.
* `workdir.write_report_file` is the **only** writer of member content and refuses any path
  that does not resolve directly inside `reports/<id>/`.
* No command prints source or the note. The door's console output goes to `door/door.log`
  inside the same directory.
* A packet for a report starts with a banner: never paste any of it into a commit, PR, issue,
  test fixture or chat. Fix tests use the implementer's own minimal repro.

## Rails

`tests/test_indicator_support_loop.py` (server), `tests/test_support_loop_tools.py` (tools),
`app/src/components/chart/supportLoop/doorNameCoverage.test.js` (the manifest):

| guarantee | rail |
|---|---|
| fixed gaps drop off; open ones rank by members; `_unlisted` set apart | `TestDigest::test_fixed_gaps_drop_off_and_open_ones_rank_by_members` |
| every uncertainty resolves open (server) / (client) | `TestFixedRule` / `doorNameCoverage.test.js` "fixedOnMaster" |
| unreadable manifest fixes nothing | `TestDigest::test_an_unreadable_manifest_fixes_nothing` |
| a deploy that changes the door rebuilds the same day | `TestDigest::test_built_once_per_day_and_rebuilt_when_the_door_changes` |
| digest and post carry no member content, id or secret | `TestDigest::test_the_digest_carries_no_member_content…`, `TestPost` |
| the committed manifest is the current build's answer | `doorNameCoverage.test.js` "regenerates byte-for-byte" |
| the probe can say yes and no; foreign-token refusals are not attributed | `doorNameCoverage.test.js` "the probe can say yes, and can say no" |
| bearer gate: none, wrong, raw, suffixed, non-ASCII, unset secret all 401; nothing changes | `TestGates::test_machine_door_refuses_without_the_bearer` |
| machine door is read-only plus status, every route gated | `TestGates::test_the_machine_door_is_read_only_plus_status` |
| admin digest is admin-only | `TestGates::test_admin_digest_is_admin_only` |
| source only under `reports/<id>/`; repo untouched; stdout clean | `TestSourceStaysInTheWorkDir` |
| close purges | `test_mark_fixed_closes_and_purges`, `test_purge_closed…` |
| work root must be git-ignored | `test_a_work_root_inside_git_must_be_ignored`, `test_the_repo_default_root_is_gitignored` |
| secret never in repr, errors or CLI output | `TestSecretNeverLogged` |
| packets from a fixture gap and a fixture report | `TestPackets` |
| dated history, gains and regressions; the predicate is the map's | `TestRemeasure` |
