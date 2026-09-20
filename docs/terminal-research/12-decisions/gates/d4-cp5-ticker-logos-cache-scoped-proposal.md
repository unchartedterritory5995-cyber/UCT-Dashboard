---
id: GATE-D4-CP5-TICKER-LOGOS
title: D4 CP5 — ticker_logos.py resolution-decision cache — scoped proposal
role: the approval packet for the one remaining open D4 checkpoint. Nothing builds until an
  approval line is signed, and nothing builds past the scope that line names.
status: UNSIGNED — no approval line exists for this scope, or any scope, today. COMPLETION_AUDIT.md's
  D4 row and GATE-D4-CACHING-AND-SERVING's own §4/§5 CP5 rows both call CP5 "unscoped"; this is the
  first document that gives it a buildable scope.
date: 2026-09-20
measured_against: origin/master @ a7176a764 — api/services/ticker_logos.py (628 lines, read in
  full), api/services/ticker_logos_prewarm.py (read in full), api/routers/ticker_logos.py (read in
  full), api/services/cache_policy.py (read in full), api/main.py:2354-2382 (`register_logo_miss_retry_job`)
  and :4560-4583 (`.logo_hires_v1` one-shot), all read this pass — not restated from the spec's own
  citations.
pairs_with: SPEC-D4-CACHING-AND-SERVING (§4 item 5, "ticker_logos"), GATE-D4-CACHING-AND-SERVING
  (§4 CP5 row, §5 CP5 row)
---

# D4 CP5 — ticker_logos.py resolution-decision cache — scoped proposal

## ⛔ APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** The block above is empty and that is its current,
> correct state. No item in §4 may be built, merged, or partially started until a line is signed
> naming it. A signature naming "CP5" without naming which of §4's MUST/SHOULD/DEFER items it
> covers authorizes nothing — the D4 gate's own §4-naming rule ("a scope matching no row is
> UNSIGNABLE") applies here too.

No application code has been modified to produce this packet. `api/services/ticker_logos.py`,
`ticker_logos_prewarm.py`, `api/routers/ticker_logos.py`, `cache_policy.py`, and the two
`api/main.py` registration sites were read in full and independently verified against the
running code, not restated from the spec's own citations.

---

## 1. What is being asked for, in one paragraph

**`ticker_logos.py` already caches correctly — a resolved PNG on disk, a `.miss` sentinel with a
two-speed TTL (7 days for a genuine "no source has one," 30 minutes for a provider hiccup) — but
the `.miss` sentinel throws away *which* providers were tried.** The daily miss-retry pass (03:25
ET) re-walks the **entire** provider chain for every `.miss` ticker, every day, including
providers that already answered cleanly "no logo here" the day before. This packet asks for the
smallest fix that stops that: enrich the `.miss` file's content from a bare marker string to a
small JSON blob naming which providers were already tried and failed cleanly, and skip those on
retry. A `.source` sidecar on success is added for observability. **No new table, no new module,
no schema, and — contrary to how this checkpoint was originally sketched in SPEC-D4/GATE-D4 (see
§6) — no touch to `api/services/cache.py` or the in-memory addressed tier at all.**

---

## 2. Why this checkpoint matters now — and, honestly, why it does not urgently

**The measured cost of not building this is real but small — this is not a load problem.**
`ticker_logos_prewarm._run_pass` (the boot + on-demand full-universe warm) is already idempotent
by disk stat — `todo = [t for t in universe if not tl.get_logo_path(t)]`
(`ticker_logos_prewarm.py:81`) — so the ~99.5%-covered majority of the ~3,742-ticker universe
(`api/data/cap_universe.json`) costs one `os.path.exists` check per cycle, zero network. The
actual waste is narrower: `run_miss_retry()` (`ticker_logos.py:493-570`), scheduled daily at
**03:25 ET** by `register_logo_miss_retry_job` (`api/main.py:2354-2382`), re-walks the full
extended chain — override → logo.dev → Parqet → FMP-image → Finnhub[FMP-profile then
Finnhub-profile2] → Clearbit — for **every** `.miss` ticker, with no memory of which of those
already answered cleanly. At ~0.5% of the universe that is on the order of a few dozen tickers,
bounded to `_MISS_RETRY_WORKERS = 2` with a `_MISS_RETRY_SLEEP = 1.0` s inter-attempt sleep
(`:509-510`) — deliberately throttled, off the request path, never touching the anyio threadpool
this codebase's launch-hardening work is protective of. So today's waste is "a dead ticker
re-asks five providers a day for up to seven days instead of zero," which is a latency/tidiness
defect, not an outage risk.

**Why sign it anyway, rather than leave it deferred like D5's CP2:** unlike D5's CP2 (an inert
ledger read by nothing, COMPLETION_AUDIT §1 D5 row), this checkpoint's payoff is immediate and
measurable the day it ships — fewer wasted provider calls on the very next 03:25 ET run — and the
change is fully contained to one file plus one call-site in each of two sibling functions, with no
migration of existing data required (§7 covers the one compatibility wrinkle: legacy `.miss`
files already on disk).

**What signing this does NOT do:** it does not unblock any member-visible feature. COMPLETION_AUDIT's
A10 (Options & Flow) row lists its remaining gap as "D3's CP4 … + D4's CP5 (ticker_logos,
unscoped)" and tags A10 `BLOCKED-DEPENDENCY`. That is this programme's own roster-completeness
bookkeeping, not a functional coupling — nothing in Options & Flow reads a ticker logo. Signing
this checkpoint closes D4 as a system in the audit's tracking sense; it changes nothing A10's
members can see.

---

## 3. Current state, with citations

- **Two-file disk cache, no `TTLCache`, no `cache.py` involvement anywhere in this module.**
  `get_logo_path` (`:79-82`) returns `<DATA_DIR>/logo_cache/{SYM}.png` if present
  (`_png_path`, `:71-72`); a miss writes `<DATA_DIR>/logo_cache/{SYM}.miss`
  (`_miss_path`, `:75-76`). Confirmed: zero `from api.services.cache import` and zero
  `cache_policy` references anywhere in `ticker_logos.py` or `ticker_logos_prewarm.py`.
- **The `.miss` file's content today is one of exactly two shapes**, written at
  `resolve_and_cache:429-435`: empty (a genuine, all-sources-clean miss) or the literal 9-byte
  string `"transient"` (`_MISS_TRANSIENT_MARKER`, `:42`) when `_was_transient()` (`:63-64`) is
  true for the attempt. `_recent_miss` (`:85-100`) reads back only that one bit — `f.read(32).strip()
  == _MISS_TRANSIENT_MARKER` (`:94`) — to choose between `_MISS_TTL = 7 * 86400` (`:40`) and
  `_MISS_TRANSIENT_TTL = 1800` (`:41`). **Nothing records which providers were tried, or that all
  of them were.**
  - The distinction it already draws is exactly the one this proposal reuses, not replaces: a
    provider that returned a clean "no" (a 200 with no usable image, or `fallback=404` on
    logo.dev) is different from one that hiccupped (timeout, 429, 5xx — `_mark_transient()`,
    called from `_url_bytes:222,226`, `_finnhub_logo_bytes:179,184`, `_fmp_profile_row`'s caller
    at `:186-187`). The thread-local tracker (`_transient_ctx`, `:47-64`) is **aggregate for the
    whole attempt**, not per-provider — a fact this proposal's design leans on (§5).
- **`_fetch_sources` (`:345-364`) and `_fetch_sources_with_clearbit` (`:365-378`) are plain
  short-circuit `or` chains** — `_override_logo_bytes(s) or _logodev_logo_bytes(s) or
  _url_bytes(parqet) or _url_bytes(fmp_image) or _finnhub_logo_bytes(s)` (plus `or
  _clearbit_logo_bytes(s)` in the extended chain). Neither function's callers know which term won
  or which terms were evaluated — only the aggregate `bytes | None`.
- **Three call sites consume `_fetch_sources`/`_fetch_sources_with_clearbit`'s bare-bytes return
  today**, each of which this proposal's signature change touches: `resolve_and_cache:415`
  (`raw = _fetch_sources(s)`) and `:417` (the `alt`-symbol retry); `run_miss_retry`'s
  `_retry_one:537` (`raw = _fetch_sources_with_clearbit(s)`); `run_hires_upgrade`'s
  `_upgrade_one:604` (`raw = _fetch_sources(s)`, a one-shot re-fetch of already-cached logos,
  gated by the `.logo_hires_v1` flag in `api/main.py:4563-4580` — already run once in production
  per that file's own comment).
- **`run_miss_retry` (`:493-570`) collects candidates by directory listing**
  (`os.listdir(_CACHE_DIR)` for `*.miss` with no matching `.png`, `:503-508`), not from any
  in-memory registry — confirming the resolution history lives nowhere but the file itself.

---

## 4. Exact scope

**MUST BUILD** (the smallest change that stops the measured daily re-walk; all inside
`api/services/ticker_logos.py`, zero new files, zero schema, zero new module):

1. **`.miss` content becomes JSON**: `{"transient": bool, "failed": [<provider-name>, ...],
   "ts": <epoch>}`. Written once per attempt at the existing write site
   (`resolve_and_cache:429-435`), replacing the bare-string write. `failed` is the ordered list of
   provider names `_fetch_sources` walked during **this** attempt.
2. **`_recent_miss` parses JSON, with a legacy-format fallback.** Try `json.loads`; on failure
   (`json.JSONDecodeError`, or any non-dict result), fall back to today's exact check — `content
   == _MISS_TRANSIENT_MARKER` → transient TTL, else the 7-day TTL — so every `.miss` file already
   on the production volume keeps behaving exactly as it does today until it is naturally
   re-resolved or re-misses under the new format. **No backfill, no migration script.** (§7 covers
   why this direction — new code reading old files — is the only safe one.)
3. **`_fetch_sources(sym, skip=())` / `_fetch_sources_with_clearbit(sym, skip=())` gain an
   optional `skip` parameter** naming provider identifiers to bypass. A new module-level ordered
   tuple, e.g. `_SOURCE_NAMES = ("override", "logodev", "parqet", "fmp_image", "finnhub")` (plus
   `"clearbit"` for the extended chain), gives both the write side (§4.1 below) and the skip side
   one shared vocabulary — never two independently-typed lists that can drift.
4. **The `failed` list is derivable without per-provider return tracking, because the `or` chain
   already proves it.** If `_fetch_sources` (unskipped terms only) returns `None`, Python's `or`
   semantics guarantee every unskipped term was evaluated and returned falsy — so `failed` for a
   **non-transient** miss is simply "every provider name not in `skip`," a static list, not a
   value threaded back out of five different functions. **This is the fact that keeps this
   checkpoint small**: no source function needs to change its own return type or start reporting
   per-call outcomes.
   - When the attempt **was** transient (`_was_transient()` true), the specific provider(s)
     responsible for the hiccup are not distinguishable from the ones that returned a clean no —
     the existing thread-local tracker is aggregate, not per-source (§3). **`failed` is written
     empty (`[]`) for a transient miss**, so a retry after a hiccup re-tries everything, exactly
     matching today's behavior. Skipping is only ever derived from a **clean** (non-transient)
     miss.
5. **`run_miss_retry`'s `_retry_one` (`:531-…`) reads the parsed `.miss` content and passes
   `skip=failed` into `_fetch_sources_with_clearbit`.** Because `"clearbit"` is never a member of
   `_fetch_sources`'s own `failed` list (Clearbit is only ever attempted inside the *extended*
   chain, never inside `resolve_and_cache`'s base chain — confirmed §3), a retry **always** still
   tries Clearbit even when every base-chain provider is skipped. The retry therefore does real,
   new work every time — it never degenerates into a no-op walk.
6. **On a resolved hit, `resolve_and_cache` writes a sibling `{SYM}.source` file** naming which
   provider produced the winning bytes — plain text, one value, mirroring the simplicity of
   `.miss`. This requires `_fetch_sources`/`_fetch_sources_with_clearbit` to return `(bytes,
   name) | (None, ())` instead of bare `bytes | None` — the one place this checkpoint is **M**,
   not **S**, because it touches the three call sites named in §3 (`resolve_and_cache:415,417`,
   `_retry_one:537`, `_upgrade_one:604`), each of which unpacks a tuple now instead of a scalar.
   The `alt`-symbol and `name`-based fallback paths inside `resolve_and_cache` (`:416-419`) get
   their own tags (`"alt:" + name`, `"name_domain"`) so a `.source` file is written for every
   resolution path, not only the primary chain.

**SHOULD BUILD** (small, additive, no new failure mode — but genuinely optional; the MUST items
above are sufficient to stop the measured waste on their own):

- Fold the new `.source`/`.miss` breakdown into the existing `GET /api/logos/status`
  (`api/routers/ticker_logos.py:70-72`, backed by `ticker_logos_prewarm.coverage()`,
  `:32-50`) as a per-source count — the "lets a future coverage report break down by source"
  value the original research pass named. This is a pure read over already-written sidecar files;
  it adds no write path and no new risk. **Deferred to the owner's judgment on whether it is worth
  a second small diff in the same file or a follow-up.**

**DEFER** (real, but not this checkpoint's job — named so a future session does not infer they
were forgotten):

- **The in-memory addressed-tier entry SPEC-D4 §4 item 5 and the D4 gate's own §4 CP5 row
  describe** — `ticker_logo::{TICKER}::{source}` written via `cache_policy.set_by_completeness`
  into `api/services/cache.py`'s shared `TTLCache`. **This is a different, larger, and
  differently-motivated piece of work than what MUST is proposing, and §6 below explains why it
  is being separated rather than folded in.**
- **Any change to `_MISS_TTL` / `_MISS_TRANSIENT_TTL`.** Unchanged — this checkpoint is about
  *which* providers get retried, never *when*.
- **Any change to `_DOMAIN_OVERRIDES`, the provider priority order, or which providers exist.**
- **Backfilling `.source` for the ~99.5% of tickers already cached before this ships.** Their
  `.source` file simply does not exist until they are naturally re-resolved (a rename, a
  `force=True` request, or a future hi-res pass) — same non-migration posture as MUST item 2.

---

## 5. Target state, concretely

```python
_SOURCE_NAMES = ("override", "logodev", "parqet", "fmp_image", "finnhub")  # + "clearbit" extended

def _fetch_sources(sym: str, skip: frozenset = frozenset()):
    """Returns (bytes, source_name) on success, else (None, tuple-of-names-tried)."""
    ...

def _recent_miss(sym: str):
    """Returns (is_recent: bool, failed: frozenset) — failed is empty unless the stored
    miss was non-transient and parses as the new JSON shape."""
    ...
```

`resolve_and_cache` threads the `failed` set from a stale `.miss` (if any) into `_fetch_sources`
as `skip`, and — on a fresh miss — writes the new JSON shape with `failed` set to "every provider
`_fetch_sources` walked this attempt" (empty if transient, per §4.4). `run_miss_retry._retry_one`
does the equivalent for the extended chain. No other function's contract changes; `get_logo_path`,
`schedule_resolve`, `run_hires_upgrade`'s scheduling, and every router-level behavior
(`api/routers/ticker_logos.py`) are byte-identical from a caller's perspective — `GET
/api/ticker-logo/{sym}` still serves from disk exactly as today (§3, confirmed: the router never
reads `.miss`/`.source` content, only `get_logo_path`'s boolean).

---

## 6. F-D4-2 — CP5's original naming (SPEC-D4/GATE-D4) describes a different checkpoint

**Filed this pass, on the same read that produced §3-§5.** SPEC-D4-CACHING-AND-SERVING §4 item 5
and GATE-D4-CACHING-AND-SERVING §4's CP5 row both describe CP5 as: bring the *resolution decision*
"into the addressed tier" as `ticker_logo::{TICKER}::{source}`, using `cache_policy.set_by_completeness`
(`cache_policy.py:30-57`) for the negative-caching half. That mechanism is real and well-suited to
what it names — but it names a **different** problem than the one this packet's own measurement
(§2) found worth fixing:

| | SPEC-D4/GATE-D4's CP5 | This proposal's CP5 |
|---|---|---|
| **Problem addressed** | The disk cache is invisible to D4's own bookkeeping — "makes an invisible disk tier addressable" (spec §4 item 5) | The daily miss-retry pass re-walks providers that already answered cleanly (§2, a measured, if small, waste) |
| **Where the record lives** | `api/services/cache.py`'s shared `TTLCache` (tier 2/3, in-memory, evicted, lost on every redeploy) | The existing `.miss`/new `.source` files on the Railway volume (tier 4, disk, already durable) |
| **What reads it** | Nothing named in either document — no call site in `ticker_logos.py` or its router queries `cache.py` today, and this proposal adds none | `run_miss_retry._retry_one`, directly, on the very next scheduled run |
| **Relationship to §5.1's rule** ("D4 never becomes the place a computed value is *published*… the file is the authority and the cache is the memo") | A `cache.py` entry here would be a **second, non-durable record** of a fact the disk file already durably owns — legible for an admin query, but not consulted by anything, which is the same "unread ledger" shape the audit already flagged for D5's CP2 | Writes to exactly one place (the file already responsible for this fact), read by exactly the one consumer that needs it |

⛔ **Neither description is wrong; they are proposals for two different things that happen to
share a name.** The spec's version is a legibility/observability improvement (make an
un-instrumented tier visible to whatever future D4 tooling wants to enumerate cache entries by
prefix); this proposal's version is a cost fix for a measured, if modest, daily waste. Building
both is possible and not mutually exclusive — but bundling the addressed-tier work into this
checkpoint would roughly double its size (a new `cache.py` write path, plus reasoning about
`cache_snapshot`'s 256 KiB-per-entry persistence rule and flow-worker's import closure, neither
of which this file's checkpoint touches per §5's own table showing `ticker_logos.py` **free** —
not in flow-worker's `reachable_paths()`) for a benefit (admin-only legibility) nothing currently
consumes.

**Recommendation:** sign this packet's §4 MUST scope as **CP5** (matching the D4 gate's own
existing row, since it is the smaller and more clearly justified of the two readings). If the
owner separately wants the addressed-tier legibility work SPEC-D4 originally sketched, that is a
**new, later checkpoint** (name it CP5-B when it is written) with its own approval line — not a
retroactive expansion of this one. This mirrors exactly how F-D4-1 was resolved: CP4 as originally
written was stopped, and CP4′ — a corrected, narrower assertion — was signed and built in its
place (`d4-cp4-build-record.md`).

---

## 7. Risks

| Risk | Impact | Mitigation | Reversibility |
|---|---|---|---|
| **Mixed on-disk `.miss` format across the deploy boundary** — production already holds `.miss` files in the old two-shape format (empty / `"transient"`) the moment this ships | A naive JSON-only parse would treat every existing `.miss` file as unparseable and could mis-TTL them | §4.2's fallback is exact-match to today's own check (`content == "transient"` else empty), so an old file's behavior is unchanged until it is naturally re-resolved or re-misses under the new writer. Test: `test_recent_miss_reads_legacy_bare_marker_format` (§8) | High — the fallback branch IS today's code, unmodified |
| **A stale skip-set silently suppresses a source that started working again mid-week** (the source recovered, but the ticker's `.miss` file still lists it as `failed` from an earlier day) | A logo that could now resolve from a previously-clean-failed provider stays a monogram one retry cycle longer than necessary | Bounded by the existing `_MISS_TTL` = 7 days — the `.miss` file itself expires and the ticker gets a completely fresh (non-skipped) attempt at that point regardless. The skip only ever shortens *which providers a `run_miss_retry` pass re-asks inside* that same 7-day window, never extends how long a ticker can go unresolved | High — deleting the `skip=` argument at either call site reverts to today's always-ask-everyone behavior |
| **The `(bytes, name)` return-type change to `_fetch_sources`/`_fetch_sources_with_clearbit` is un-updated at one of its three call sites** (`resolve_and_cache:415,417`, `_retry_one:537`, `_upgrade_one:604`) | A tuple where scalar bytes are expected — `_normalize_png((b"...", "logodev"))` — fails loudly (Pillow raises on a tuple), not silently; every one of the three call sites is inside a `try/except Exception` already, so the practical failure mode is "this ticker stays a monogram," not a crash | All three call sites are named explicitly in §4 item 6 and §3 so a reviewer can grep them before merge; a unit test constructs a fake source returning bytes and asserts all three call sites unpack correctly (§8) | High — one file, revert the commit |
| **Concurrent writers to the same `.miss`/`.source` file** (a request-path `schedule_resolve` and the scheduled `run_miss_retry` racing the same ticker) | Pre-existing, not introduced or worsened by this checkpoint — today's plain `open(path, "w")` (no atomic rename) for `.miss` already has this property; `.png` writes are already atomic (`tmp` + `os.replace`) and this checkpoint's new `.source` write follows the same non-atomic pattern as `.miss`, not the atomic pattern used for `.png` | Named here rather than silently inherited. Out of this checkpoint's scope to fix — a pre-existing condition, and fixing it would mean adding per-ticker locking this module has never had | N/A — not changed by this checkpoint |
| **A malformed hand-edited `.miss` file** (valid JSON but missing the `failed` key, or `failed` containing an unknown provider name) | `skip` would be empty (safe — falls back to "retry everything") or would silently no-op an unknown skip name (harmless — `skip` only ever *removes* providers from consideration, so an unrecognized name in it is inert) | `.get("failed", [])` with an explicit default; unknown names in `skip` simply never match anything in `_SOURCE_NAMES` | High |

---

## 8. Test & acceptance plan

All against synthetic fixtures under a throwaway `_CACHE_DIR` (this module already resolves
`_CACHE_DIR` from `DATA_DIR`, so tests set that env var to a `tmp_path` — never touching
`C:\data`, consistent with the repo's shared-data-root tripwire):

| Test | Proves |
|---|---|
| `test_recent_miss_reads_legacy_bare_marker_format` | A `.miss` file containing exactly `"transient"` (today's format) still gets the 30-min TTL; an empty `.miss` file still gets the 7-day TTL — unchanged after this ships |
| `test_recent_miss_parses_new_json_format` | A `.miss` file containing `{"transient": false, "failed": ["logodev","parqet"], "ts": ...}` round-trips through `_recent_miss` and yields the correct `failed` set |
| `test_clean_miss_records_every_walked_provider` | A `resolve_and_cache` attempt where every source returns `None` (no transient flag) writes `failed` equal to the full `_SOURCE_NAMES` tuple minus any explicit `skip` passed in |
| `test_transient_miss_records_empty_failed` | An attempt where `_mark_transient()` fires writes `failed: []`, so a subsequent retry does not skip anything |
| `test_retry_skips_known_clean_failures_but_still_tries_clearbit` | `_retry_one` given a `.miss` with `failed=["override","logodev","parqet","fmp_image","finnhub"]` calls **only** the Clearbit source, never the other five — the differential proof that the skip set actually reduces egress |
| `test_hit_writes_source_sidecar_naming_the_winner` | A resolved logo writes `{SYM}.source` containing the name of whichever source produced the bytes, including the `alt:`/`name_domain` tags for the fallback paths |
| `test_existing_three_call_sites_unpack_tuple_return` | `resolve_and_cache`, `_retry_one`, and `_upgrade_one` all correctly consume the new `(bytes, name)` / `(None, tried)` shape — the regression guard named in §7's third row |
| `test_router_and_prewarm_unaffected` | `GET /api/ticker-logo/{sym}` and `ticker_logos_prewarm.coverage()` behave identically before/after — neither reads `.miss`/`.source` content, only `get_logo_path`'s boolean (§5) |

**Measurable acceptance for the checkpoint as a whole:** all eight tests pass; a manual local run
of `run_miss_retry()` against a fixture with one pre-seeded clean (non-transient) `.miss` file
issues **zero** requests to the five skipped sources and exactly **one** to Clearbit (verified via
a mock/count on `requests.get`); the existing `ticker_logos`/`ticker_logos_prewarm`/router test
suites (if any exist today — not verified as part of this pass) continue to pass unmodified.

---

## 9. Owner-bound questions

**No unresolved owner decision blocks this checkpoint's MUST scope.** One question is worth the
owner's attention, not as a blocker:

- **Does the owner want the SHOULD item (per-source breakdown on `GET /api/logos/status`) in the
  same commit, or as its own small follow-up?** Either answer is compatible with signing MUST
  alone; naming it here so it is not silently dropped nor silently assumed included.
- **Does the owner want CP5-B (the addressed-tier legibility work SPEC-D4 originally sketched, §6)
  proposed at all, ever?** Not required for anything currently built or planned — flagged so a
  future session does not treat §6's DEFER as an oversight.

---

## 10. What this packet does NOT ask for

- No new table, no new SQLite database, no new module.
- No change to `_MISS_TTL` / `_MISS_TRANSIENT_TTL` / the provider priority order / `_DOMAIN_OVERRIDES`.
- No touch to `api/services/cache.py`, `cache_policy.py`, or any in-memory addressed-tier entry —
  see §6 for why that is a separate, unproposed checkpoint.
- No backfill of `.source` for already-cached tickers.
- No change to `GET /api/ticker-logo/{sym}`'s serving behavior, headers, or the transparent-pixel
  cold-miss contract (`api/routers/ticker_logos.py:29-49`).
- No member-visible change of any kind.

---

## 11. Recommendation

**Sign the MUST scope in §4 as CP5.** It is contained to one file (plus the two call-site updates
in `run_miss_retry`/`run_hires_upgrade` already inside that same file), fixes a real if modest
measured waste on the very next scheduled run, requires no data migration (§4.2's fallback makes
old and new `.miss` formats coexist safely), and is revertible by reverting one commit. The SHOULD
item and CP5-B (§6) are each their own, smaller decision the owner can make independently without
holding up MUST.
