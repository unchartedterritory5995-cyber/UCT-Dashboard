---
id: D1-G3-G5-SIZING
title: D1 gaps G3 and G5 — sizing and recommendation
role: owner decision input. NOT an authorization to build. Recommendation only, as instructed.
status: awaiting owner ruling
date: 2026-09-12
measured_against: origin/master @ a0c2bfee4
---

# G3 and G5 — what each needs, what it unblocks, size, risk

Both read from the code, not from the gap list's summary of it.

---

## G3 — the adapter is JSON-only

**What the adapter needs.** `fmp_client._get_raw` ends in `return resp.json()`, and a
non-JSON body is translated into a **transient error** (`"FMP {path} returned non-JSON
body"`). Every typed function is therefore a JSON function by construction, and
`ProviderResult.value` is always a parsed object. Supporting a non-JSON endpoint means a
second return channel — either a `raw=True` mode on `_fetch` that hands back
`resp.content`/`resp.text` with the provenance stamp intact, or a parallel
`_fetch_bytes`. ⭐ **The provenance stamp is the part worth keeping**, and is the only
reason to route these through the adapter at all: a PNG fetched outside it carries no
`source_activity`, no `licensing_class`, no `fetched_at`.

**What it unblocks, measured.** Two call sites, and they are not the same problem:

| site | body | why it is outside the adapter |
|---|---|---|
| `ticker_logos.py:152` | **PNG** | writes `/data/logo_cache/{SYM}.png`; wants bytes, not text |
| `fmp_bulk.py:35` | **`/stable/ratios-bulk`** | ⚠️ **it already returns JSON** — `_fmp_bulk_rows` does `rows if isinstance(rows, list)` |

⛔ **The second row corrects the gap list.** G3 has been carried as *"blocks
`ticker_logos`' PNG **and** `fundamentals_bulk`'s 30–70 MB CSVs"*. The bulk call in this
repo is `_fmp_get("/stable/ratios-bulk", …)` returning a **list of dicts**. There is no
CSV parse anywhere in `fmp_bulk.py`. So G3's real blast radius today is **one PNG call
site**, not two families.

**Size: S.** A `raw` channel on `_fetch` plus one migrated call site. The typed function
would be `get_company_profile_image` or similar, returning bytes in `value`.

**Risk: LOW, with one sharp edge.** `ProviderResult.to_dict()` is documented as
*"JSON-safe"* and every field *"already a primitive"*. Putting `bytes` in `value` breaks
that contract silently — it serialises fine until something calls `to_dict()`, then
raises deep in a consumer. Either the raw channel returns a distinct type, or
`to_dict()` learns to refuse/encode bytes **and says so in the same commit**.

### ⭐ Recommendation on G3: **DEFER, and re-scope it first.**

One PNG call site does not pay for a second return channel through the adapter, and the
"30–70 MB CSV" half of the justification does not exist in this code. ⛔ Do not build
against a gap description that has drifted from the source — **re-measure G3 against the
real call sites before authorizing anything**, and if the answer is still one PNG, the
honest move is to leave `ticker_logos` outside the adapter with a recorded reason rather
than widen the adapter's contract for it.

---

## G5 — no retry / backoff / request ceiling

**What `fmp_news.py` actually has**, read from `api/services/news/adapters/fmp_news.py`:

1. **A 3-attempt loop** with a **429 sleep-retry** (`2 + attempt*4` → 2 s, 6 s, 10 s).
2. **A 5xx-only retry** — a 4xx `break`s immediately rather than burning attempts.
3. **A global pacer** — `_MIN_GAP` (0.5 s, env `NEWS_FMP_MIN_GAP_S`) under a module lock,
   so concurrent callers cannot exceed one call per 500 ms.
4. **`RequestBudget`** — a **per-run** hard ceiling that **raises** (`FmpUnavailable`)
   rather than degrading. Constructed per ingest with a label: `POLL_BUDGET`,
   `len(syms) + 50`, `BACKFILL_BUDGET`, and `RequestBudget(4, "verify")`.

**What the adapter has instead.** `_get_raw` calls `_take_token()` and, on refusal,
raises `rate_limited` — **no retry, no sleep, no pacing gap**. On a 429 from FMP it also
raises `rate_limited` immediately.

⭐ **These are not the same mechanism with one missing feature. They are two different
contracts:**

- the adapter **fails fast and lets the caller decide** — correct for a request path,
  where a member is waiting and three retries plus sleeps is a 20-second page;
- the news adapter **absorbs transient failure inside the call** — correct for a
  background ingest, where the run is the unit and a 429 is a pause, not an answer.

And the budgets differ in KIND, not size: `_take_token` is a **global, module-level**
token bucket; `RequestBudget` is **per-run, labelled, and constructed by the caller**. An
ingest that must abort at N requests *for that run* cannot express that through a global
bucket, and moving to one would let a busy backfill starve an unrelated caller.

**Size if absorbed anyway: M**, and it is the wrong M — a per-call retry policy parameter
on every typed function is a second G1-shaped change (a new parameter, 36 signatures, a
ruling about defaults), and it would change the failure semantics of every existing
caller from fail-fast to retry-then-fail.

### ⭐ Recommendation on G5: **`fmp_news.py` STAYS QUARANTINED, with the reason recorded.**

Not "not yet migrated" — **deliberately outside**, because its retry-and-budget contract
is the opposite of the adapter's and both are right for their own callers.

⛔ **And quarantining it is worth doing for a second reason: it clears a standing red.**
`tests/test_fmp_guard_census.py::test_real_repo_has_zero_unquarantined_violations` fails
on `origin/master` today — measured on a clean tree, independent of G1 — and the single
violation is `fmp_news.py:37`'s `BASE = "https://financialmodelingprep.com"`. It is red
precisely because the module is neither migrated nor quarantined. ⭐ The recommendation
and the red are the same fact seen from two directions.

⚠️ **What quarantining must NOT become:** a way to silence the census for anything
inconvenient. The entry should carry the contract reason above, so the next reader can
tell a deliberate exemption from a deferred migration — the distinction
`lesson_a_gate_list_drifts_like_any_other_artifact` exists to protect.

---

## Both, in one line each

- **G3** — defer; its stated justification is half-false in this repo, so re-measure
  before authorizing. One PNG call site.
- **G5** — do not absorb; quarantine `fmp_news.py` with the contract reason, which also
  turns a standing census red green.
