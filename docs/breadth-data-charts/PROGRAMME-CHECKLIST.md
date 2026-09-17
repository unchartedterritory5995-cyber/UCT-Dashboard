# Breadth Data Charts — PROGRAMME CHECKLIST

**This file is the source of truth for the programme's state.** Directive **DC-1** (2026-09-17).
A fresh session must be able to resume from this file alone, and it is updated **in the same
commit as the work it records**. A checklist that lags is a false instrument.

The programme ends when this file reads **DONE** — DC-1 §5's DC8, which is reached when
everything buildable is built, previewed, and the flips are the owner's.

Created 2026-09-17 (Session 1, discovery).
Last updated: **2026-09-17, Session 1 (DC-1 §1 discovery complete).**

---

## STATE VOCABULARY

Inherited from the reader programme, plus one.

| State | Means |
|---|---|
| `DONE` | finished and merged to master; nothing further |
| `BUILT` | built and gated on a branch, **not on master** — names the branch |
| `READY` | preconditions met, waiting only for a slot |
| `BLOCKED` | a named precondition is not met — names it |
| `OWNER-GATE` | previewed and awaiting the owner's word; **the programme keeps building past it** |
| `OWNER-PENDING` | needs the owner's keyboard or ruling |
| `UNKNOWN` | not established this session; carries what would answer it |
| `NOT STARTED` | no work done |

⛔ **A state is changed only by evidence, never by expectation.** "It should have landed" is
not `DONE`, and a document saying so is not evidence — `RESUME.md` said "NEXT: V2-1" while
V2-1 was already merged.

---

## THE ONE-SCREEN ANSWER

| Item | State |
|---|---|
| **DC1** discovery | ✅ **DONE** — `00-profile.md`; baselines deliberately deferred to DC2 (no deterministic harness exists yet) |
| **DC2** harness + golden diff + perf rail | **READY** — Playwright + Chromium verified present; needs route interception |
| **DC3** V2-2 built dark | **BLOCKED** on DC2 and on **W2-0** (see below) |
| **DC4** V2-2 previewed | **BLOCKED** on **Q1** — a `VITE_` flag cannot be previewed per-user |
| **DC5** V2-3 wire fields dark | ✅ **NO WIRE FIELDS NEEDED** (Q3 resolved 2026-09-17). `reconstructed[]` is already on the wire; the era note is computed CLIENT-SIDE from `universe_count` (`01-audit.md:309-311`), and the start-of-data marker from the first non-null per key. The only requirement is that `universe_count` ride along in the ≤8 keys while a count panel is shown. |
| **DC6** V2-3 UI dark, LTTB, cap raised | **BLOCKED** on Q4 (unmeasurable while `/series` is dark) |
| **DC7** V2-3 previewed | **BLOCKED** on Q1 |
| **DC8** flips, watches, records, FINAL | **NOT STARTED** |

**The single blocking fact right now: Q1.** V2's flag is **build-time** (`VITE_*`, compiled
into the bundle), so DC-1 §4.2's owner preview, §4.3's flip-on-a-word and §4.4's
flag-OFF rollback are all **deploys**, and per-user preview is not expressible at all. The
repo already has the mechanism that solves it — the auth payload, as used by
`HUB_PREVIEW_ENABLED` — but adopting it changes DC-1 §1.6's shape and is an owner ruling.

⚠️ **Not a reason to stop.** Everything through DC3 is buildable without it, and DC-1 §6 says
waits are spent on the next dark increment.

---

## NEW WORK ITEM FOUND IN DISCOVERY

### W2-0 · V2-1's tokens + validated palette

**`NOT STARTED` — and it is a prerequisite of V2-2, not a parallel task.**

V2-1 landed deliberately unstyled: *"⛔ NO STYLING ON PURPOSE … adding tokens now would put
`--v2-*` custom properties into every theme island before a single pixel is designed."* The
reasoning is sound and this programme agrees with it — but DC-1 §2.2 requires **sticky
colours assigned deterministically from one authority**, and that authority is the palette
V2-1 deferred.

⛔ Filed as a **sub-item of W2**, not a new increment, so the roadmap's numbering is not
disturbed. ⚠️ It touches **theme islands** — `app/src/styles/themeIslands.test.js` fails by
name on a `--*` token added without pinning it in every island. That rail is inherited, not
new, and it will fire.

---

## R — ROADMAP STATE

| Merge | State |
|---|---|
| C1 · honest states | `UNKNOWN` — resolve A-numbers via `COVERAGE.md` |
| C2 · chart mechanics | `UNKNOWN` — same |
| C3 · touch & ARIA | `UNKNOWN` — same |
| R1 · one registry | `UNKNOWN` — same |
| B1 · series endpoint | ✅ `DONE` — merged `5a0e224f4`, dark, contract `docs/breadth/api-series.md` |
| V2-1 · foundation | ⚠️ `PARTIAL` — shell/flag/read-path/golden landed `ee31cbc57`; tokens+palette, responsive height, URL state, range pills, header/freshness **not seen** |
| V2-2 · stacked panels | `NOT STARTED` |
| V2-3 · honest coverage + long history | `NOT STARTED` |
| V2-4 · controls | `NOT STARTED` — out of DC-1's scope |
| V2-5 · reading & sharing | `NOT STARTED` — out of DC-1's scope |

---

## W — WORKSTREAMS

| # | Workstream | State |
|---|---|---|
| **W1** | harness + goldens + perf rail | `READY` — Playwright/Chromium verified; build route interception |
| **W2-0** | V2-1 tokens + validated palette | `NOT STARTED` — prerequisite of W2 |
| **W2** | V2-2 stacked panels, dark | `BLOCKED` on W1, W2-0 |
| **W3** | V2-3 coverage + long history, dark | ⚠️ **UNBLOCKED on Q3** (era note located, `01-audit.md:309-311`). Still gated on **Q4** — whether `/series` is fast enough at long spans is UNMEASURED, and §3.2's perf rail is what answers it. ⛔ New scope found: A-28's `mark` registry field does not exist (R1 shipped 4 of 6 declared fields), so V2-3 ADDS it. |
| **W4** | records | rolling — `00-profile.md` open, DECISIONS entries per ruling applied |

⭐ **W3's wire half is further along than DC-1 assumed.** `reconstructed[]` already ships in
the `/series` response, so DC-1 §2.4's "derived from wire fields, never from the client
guessing by date" needs **no router change** for reconstructed sessions. Only the era note
is outstanding, and its definition is `UNKNOWN`.

---

## OPEN QUESTIONS — the live ones

| # | Question | What would answer it |
|---|---|---|
| **Q1** | A `VITE_` flag cannot do per-user preview or instant rollback. Move V2-2/V2-3 to an auth-payload capability? | **Owner ruling.** Precedent exists: `HUB_PREVIEW_ENABLED`, `_access_payload` |
| **Q2** | ~~Are C1/C2/C3/R1 done?~~ | ✅ **CLOSED 2026-09-17.** C1/C2/C3 in production (ancestry-checked); **R1 PARTIAL — `mark` and `refLines` absent**. ⚠️ The instruction in this cell was itself wrong: `COVERAGE.md:35` is stale and would have given a wrong answer for two of four. Anchored to `git merge-base --is-ancestor` instead. `01-spec-v2-2-v2-3.md` §0.1-0.2 |
| **Q3** | ~~What is the "era note" (A-28, A-39)?~~ | ✅ **CLOSED 2026-09-17.** The "Era comparability" bullet, `01-audit.md:309-311`; A-28 at `:245`, A-39 at `:256`. All quoted verbatim in `01-spec-v2-2-v2-3.md` §2.4-2.6. **No wire field required** — the guess that it was a serialiser projection was wrong. |
| **Q4** | Is `/series` fast enough for long history? | A local backend with the flag set (preferred, no prod change), **or** an owner ruling to arm it on `web`. ⛔ The reader's numbers are for a **different route** and do not transfer |
| **Q5** | Does the ledger's `where` mean "targets" or "is set on"? | The ledger's schema doc; `tools/flag_ledger_audit.py` |

---

## STANDING RULES INHERITED (DC-1 §0)

Unchanged from the reader programme and in force here:

- no market-hours window; the pre-push guard's recency (≥600 s) and burst (≥3 distinct web
  deploys/60 min) clauses are the authority; never `--no-verify`
- ⛔ **announce intent at the session layer before taking a landing slot** — the push→deploy-record
  blind window is **2.5–3.5 min** (measured twice) and no guard can see through it
- master-first landings; a push is not clear until **SUCCESS on the deploy's OWN record**
- one worktree one writer; stage by name, never `git add -A`; `git commit -F - <<'MSG'`
- controls that can fail; mutation-proved rails; counts derived not typed; INCONCLUSIVE ≠ CLEAN
- ⛔ `--kv` describes the service, **only the pod describes the process**;
  `railway variable delete` **does not redeploy** (`--set` does)
- ⛔ the reader's 8 hot-path files are **not touched by this programme**
