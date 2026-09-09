# Wave O — Finance-Native Review Loop + Review Recall: production certification

**Status: CLOSED IN PRODUCTION.**

One product, certified as one release:

> **REVIEW THESIS** → see thesis and evidence context → see deterministic
> changes → write your own assessment → choose an outcome → set the next review
> → complete a historical review → **find that review later through Search** →
> **ask what you decided** → distinguish a historical review from the current
> thesis → **return to that exact review.**

---

## What shipped

| | |
|---|---|
| Branch | `notebook-primary-platform` |
| Branch commit range | `3a3122c21` … `4293cd55f` (11 commits) |
| Previous master | `42daef020` |
| Master / deployed commit | **`4293cd55f`** |
| Merge | fast-forward `42daef020..4293cd55f`, no force, zero drift to reconcile |
| Railway deploy | `SUCCESS`, commit `4293cd55f`, created `2026-09-09T00:21:53Z` |

⛔ **Zero drift is a measurement, not an assumption.** `git rev-list --count
HEAD..origin/master` returned **0** against a freshly fetched master, so there
was nothing to reconcile and therefore no drift-affected rails to re-run. The
locked merge invariant was still checked: `grep -c broker_sync api/main.py` =
**10** (floor is 7).

## Serving process is genuinely fresh

⛔ **THE ARTIFACT, NOT THE ABSENCE OF AN ERROR.** A deploy is verified by the
process changing, not by the site still answering.

| | before | after |
|---|---|---|
| `uptime_seconds` | 8,808 | **29** |
| `rss_mb` | 3,159.8 | **1,039.3** |
| `thread_count` | 95 | 62 |

## Doors: mounted and auth-gated

⛔ **401 IS THE PASS AND 200 WOULD HAVE BEEN THE FAILURE.** An unmounted route
does not 404 in this app — it falls through to the SPA catch-all and answers
with HTML, which is exactly how the broker router's disappearance once
presented as something else entirely.

| door | result |
|---|---|
| `GET /api/j2/reviews/search?q=zzz` | **401** `{"detail":"Not authenticated"}` |
| `GET /api/j2/notes/{id}/reviews` | **401** |
| `POST /api/j2/ask/stream` | **401** |
| `POST /api/j2/notes/{id}/ask/stream` | **401** |

⚠️ **One finding in this pass was the probe's, not the product's**, and it is
recorded because the shape recurs: the first sweep probed `ask/stream` with a
**GET** and got 200 HTML, which it reported as "the route is NOT mounted". The
route is POST-only and this app serves a SPA catch-all on `GET /{full_path}`,
so a GET probe measures the catch-all. **Probe a route with the method it
actually has.**

## Emitted-asset sweep

179 assets walked from the app shell.

| string | serving asset |
|---|---|
| `Thesis review` | `NotebookTab-CIr3Ixkq.js` |
| `/api/j2/reviews/search` | `FolderSidebar--MzhMSus.js` |

⛔ **BYTE-IDENTITY IS NOT CLAIMED.** The production chunk hashes
(`--MzhMSus`, `CIr3Ixkq`) differ from this machine's local build
(`-BJSTeclI`, `-D2CncdDB`), so the Railway build is not bit-for-bit the local
one. What is proven is that the O6 strings are present in the assets production
is serving — not that they are the same bytes that were tested locally.

## Standing gates — read live, not assumed

`railway variables --service web --kv`:

- **`J2_SHARE_LINKS_ENABLED=0`** — G-080 unchanged: share links remain
  IMPLEMENTED / ACTIVATION DISABLED / AUTHORIZATION UNVERIFIED. Not touched.
- **No `*SEMANTIC*` variable exists at all** — semantic stays **DARK**.
- **No `*EMBED*` variable exists at all** — no external embeddings, ZDR untouched.
- ⚠️ **`NOTE_SYNC_ENABLED=1` and `NOTE_SYNC_OBSIDIAN_ENABLED=1` are ON.** The
  O6 consumer audit had asserted they were unset — from a code default rather
  than a reading. Corrected in that document. The conclusion survives on a
  stronger footing: a review lives in `j2_thesis_reviews` and is never written
  into a note body, so sync is *structurally* unable to carry one out, not
  merely switched off. Those flags belong to the connectors workstream and were
  not changed here.

## ⛔ The production-session limitation, stated plainly

**No production member session was available to this session, so
member-rendered review Search and review-grounded Ask were NOT exercised in
production.** Nothing here rounds that up.

⛔ **And no production review data was seeded to manufacture the evidence.**
Every write in this verification went to the local fail-closed sandbox; the
production database was only ever read through unauthenticated probes.

What stands in its place:

1. the **exact serving code** (asset sweep above, deployed commit `4293cd55f`);
2. the **mounted and gated doors** (401 on all four);
3. an **exact-commit fail-closed E2E** — `tools/wave_o6_e2e.py` re-run against
   the sandbox running the merged product tree: **every step green**, with its
   own negative control (a token nobody wrote produces no review section).

## Evidence carried into production

| dimension | evidence |
|---|---|
| Review loop E2E | `tools/wave_o_e2e.py` — 20 steps green |
| Recall E2E | `tools/wave_o6_e2e.py` — search → find → land, then *last* / *previous* / *when* through a real model, plus cross-thesis and historical controls. Asserted on **citations**, never on model prose |
| Mobile / a11y | 390×844 coarse pointer, `elementFromPoint` at each control's centre: search **44×44**, result row **318×54**, no horizontal overflow (390 = 390), exactly **one** row marked, announced, marked with a **2px border** rather than a colour wash |
| Performance | review search **13.7 ms p50 / 59.5 ms p95** on 96 reviews against a 400 ms budget, transport floor calibrated at **1.8 ms** first, with a **miss** measured beside the hit |
| Rails | 844 notebook-family backend · 2,186 frontend across 211 files · 5 mutation checks, each byte-identically restored |
| Consumer audit | `wave-o6-review-consumer-audit.md` — 26 consumers, no unexplained rows |

## Residuals — recorded, deliberately NOT fixed in this release

- **A · Recurrence.** No recurring review scheduling or templates. **Notion
  remains ahead on generic recurrence**; UCT ships explicit dates only.
- **B · Earnings-event binding.** Still deferred: the calendar keeps one row per
  symbol and overwrites `report_date`, so there is no stable immutable
  earnings-event identity to bind a historical review to.
- **C · `changes_since` scaling.** The calculation remains **O(evidence) per
  thesis** — recorded in the release directive as ~21 ms at 60 rows and ~200 ms
  at 600 rows. Not optimised here; revisit only if production shows material
  harm.
- **D · Notifications.** Not part of Wave O.
- **E · "What changed since I bought?"** Not claimed, not built.

## Machine-safety incident, resolved inside this release

The verification runs took this machine from **80.7 GB free to 7.2 GB**.

⚰️ **Root cause: one behaviour, two doors, and the flag closed one.** Wave N
turned off `USE_REMOTE_BARS`, which stops the bars prewarmer from pulling the
R2 snapshot. It does **not** reach `api/main.py`'s boot-time integrity smoke
probe, which calls `data_sync.force_resync()` without consulting that flag — and
a sandbox always boots with an empty `DATA_DIR`, so the probe failed and pulled
on **every** boot, ~23 GB each.

Fixed at the **capability**, not with a second flag: the sandbox blanks
`DATA_SYNC_*`, so `data_sync._client()` returns `None` and every pull path — the
prewarmer's, the smoke probe's, and any future third — becomes a no-op. A
fail-closed guard now refuses to start a sandbox that *could* reach R2, and it
proves it can fire by first checking that a dummy credential set *does* build a
client.

**Verified on one live boot**, and the log sequence is the non-vacuity proof:

```
[sqlite] integrity smoke probe failed: no such table: ohlcv      <- smoke RAN
remote data-sync : UNAVAILABLE (data_sync._client() is None)     <- guard fired
[startup] bars.db FAILED ... -- pulling fresh snapshot from R2   <- resync ENTERED
[startup] bars.db restore from R2 FAILED                         <- capability absent
```

⛔ **"The log string is absent" was never the test** — the pull line *is*
present, and that is what distinguishes "the boot never reached integrity
smoke" from "integrity smoke ran and the capability was gone". What is absent is
the fetch: **62 GB free before and after, six pre-existing `data_sync_*`
directories before and after, none created.** The later exact-commit E2E run
cost 0 GB.

**Cleanup was targeted, never generic.** Four artifacts were removed, each
positively attributed and proven inactive first:

- two staging directories whose creation times fall *inside* the bracketed
  R2-pull window of this session's own two sandbox boots
  (18:36:26–18:36:39 and 18:52:23–18:52:46, read from the logs' surrounding
  timestamps), and
- the two `uct_tests_datadir_*` directories **named in those same logs**.

Inactivity was proven by **renaming each directory first** — on Windows a
rename fails while any handle in the tree is open — not inferred from an old
timestamp. Reclaimed ~46.7 GB.

🔴 **EXTERNAL WORKSTREAM DISK LEAK REMAINS OPEN.** Six `data_sync_*`
directories (~139 GB) were left completely untouched: five predate this
session, and one (`data_sync_c8nqu6h4`, 18:37:11) could **not** be attributed to
either of this session's boots — each logged exactly one pull, and its creation
time falls outside both pull windows. Ambiguous ownership means leave it alone.
`tools/e2e_sandbox_launcher.py` was not patched; it belongs to that workstream
and still carries the same defect.

## Harness doctrine — now permanent, not anecdote

Wave N and Wave O each lost runs to these, and O6 hit five more. They are
standing rules for every future harness in this program:

1. **Never assert on model prose.** Assert on the product's own contract — a
   citation handle that resolves against the packet that was sent. O6's first
   E2E cut failed three *correct* answers by looking for a seeded token the
   model had, correctly, paraphrased.
2. **Never wait on a condition that is already true.** O6 waited for a review's
   text "anywhere on the page" — it was already there, in the search result
   still on screen — and then measured a half-loaded editor.
3. **Never use a whole-page text check** when member content can contain the
   same vocabulary.
4. **Never use a case-sensitive DOM check** against a CSS `text-transform`.
5. **Never use a fixed sleep** to wait for state. (Creating elapsed time is a
   different thing, and O6 says so where it does it.)
6. **Never treat an invariant measurement as a product number** — calibrate the
   transport floor first.
7. **Probe a route with the method it has** (this pass, above).
8. **Rebuild the frontend before measuring it** — the sandbox serves `dist/`.
9. **Read a flag, never infer it from a code default** (`NOTE_SYNC_*`, above).
10. **A fixture's default argument captures its tenant at definition time** —
    per-test rebinding never reaches it.

---

**Wave O — Finance-Native Review Loop, including O6 Review Recall & Consumer
Completion — is CLOSED IN PRODUCTION at `4293cd55f`.**

⛔ **Wave P — OCR / Scanned Intelligence is NOT started and is NOT authorized.**
