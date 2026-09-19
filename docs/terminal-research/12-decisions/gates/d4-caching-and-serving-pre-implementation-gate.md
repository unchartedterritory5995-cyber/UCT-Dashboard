---
id: GATE-D4-CACHING-AND-SERVING
title: D4 — Caching & Serving — pre-implementation gate
role: the approval packet. Nothing builds until an approval line is signed, and nothing builds past the scope that line names.
status: SIGNED (CP1, fingerprint 40caca541). ⚰️ This said "UNAPPROVED — the approval
  block is empty," written before CP1 was signed against this same block; the
  frontmatter was never updated when that happened.
date: 2026-09-12
measured_against: origin/master @ 5ff6fc04a
pairs_with: SPEC-D4-CACHING-AND-SERVING
---

# ⛔ D4 pre-implementation gate — UNAPPROVED

## ⛔ APPROVAL — THREE LINES, one per checkpoint

⚰️ **THIS BLOCK HELD ONE LINE READING "CP1 - THE FIRST TWO OF THE FIVE NAMED ADOPTERS".**
It contradicted §4 of this very packet, where CP1 is a derived rail with *"no product code
changes"* and the adopters are CP2 and CP3. A build against it would have been unreviewable:
the scope named a checkpoint the packet did not describe. ⛔ **And the contradiction hid a
hazard** — "the first two adopters" spans CP2 (outside flow-worker's closure) and CP3 (inside
it), so the one line silently authorized a stranding change alongside a free one.
**Owner re-numbered it 2026-09-13; scope and packet now agree.**

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-13
APPROVED AT SHA:      40caca541
SCOPE APPROVED:   CP1 - THE DERIVED RAIL, and NO PRODUCT CODE. A test that
                  enumerates every per-set cache key by AST (the SPEC §3.4
                  population) and fails when a NEW one appears that is not
                  declared as a deliberate fast path or a batch-provider key.
                  No key renamed, no module touched, api/services/cache.py
                  UNTOUCHED.

                  CP2 - ADOPTER 1: api/services/watchlist_performance.py,
                  INCLUDING THE `wl_perf:` CACHE-KEY FIX. Per-ticker keying so
                  one failed ticker's all-None row can NEVER be cached against
                  healthy peers in the same request. The set key stays as a
                  fast path. A hit-rate counter, which is observability and
                  NEVER a gate on serving. Snapshot-identity on the served
                  values. A test using EXACTLY that scenario - a batch where
                  one ticker fails and its peers succeed. Mutation: restore the
                  set-hash key -> RED. cache.py UNTOUCHED.

                  CP3 - ADOPTER 2: theme_performance.py + groups.py.
                  ⛔ CLASSIFICATION PRE-DECLARED: **BEHAVIOUR-CHANGING**. Both
                  modules are INSIDE flow-worker's import closure and neither is
                  watched; this merges in the weekend window with a marker bump
                  and both artifacts. If the window has closed before it is
                  ready, it HOLDS on the branch with the reason in §6.
                  cache.py UNTOUCHED.
```

⚰️ **SUPERSEDED LINE, RECORDED 2026-09-13 BY THE COMPLETION VERIFICATION.** This packet carried a
single approval line signed **2026-09-12 at `~~37bfe4251~~`**, replaced by the three lines above in
`e23351728`. The replacement was deliberate and correct — the old single line said *"the first two
adopters"*, which is CP2 (outside flow-worker's closure) **plus** CP3 (inside it), so one signature
authorized a stranding change alongside a free one.

⛔ **But the packet did not say so, and a fingerprint that vanishes without a record is the one
thing this format exists to prevent.** The old bytes are recoverable — `git show 37bfe4251:<this
file>` — and this note is what tells a reader to look.

⛔ **`api/services/cache.py` IS IN NO CHECKPOINT**, per D4-D. If an implementation turns out to
need a `TTLCache` API change, that is a stop-and-re-gate condition, not a scope stretch.

> ⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** The block above is empty and that is its
> current, correct state. No checkpoint below may be built, merged, or partially started until
> a line is signed naming one of them. A signature naming "D4" authorizes nothing — §4 exists
> so an approval can name a checkpoint instead.

---

## 1. What is being asked for, in one paragraph

**D4 was never built as a named system. It already exists in production — five tiers, 581 cache
operations across 119 files, 26 independent `TTLCache` instances — and it is under-adopted.**
This packet asks the owner to ratify what is there, adopt the one pattern that already works
(`/api/live-prices`' shared per-ticker cache under a request-set fast path) in a small number of
named places, and stop there. **No new cache. No new tier. No member-visible change. Every
checkpoint revertible by reverting one commit.**

---

## 2. ⛔ THE FINDING THAT SHOULD DECIDE THE SHAPE OF THE ANSWER

> **The codebase has one good caching pattern, applied in one place, and it is better than a
> design pass would have produced. What it does not have is a convention over the other
> twenty-five cache instances.**

`api/routers/live_prices.py` is a two-tier cache with a bounded valve and a herd-collapse
re-check (`:584-648`), a dedicated instance whose LRU bound is **derived from its own working
set** rather than inherited from a shared default (`:59-91`), and an explicit refusal to put two
whole-market maps in an entry-counted cache because *"a size-blind bound pretending to be a
memory bound"* is worse than module state (`:101-107`). Every one of those three decisions is
the right one and each is recorded in the file with the failure that produced it.

⭐ **This codebase does not need to be taught how to cache. It has done it correctly, once, at
the surface that would have taken the site down.** What it has not done is apply that shape past
that one file.

⛔ **THE CONSEQUENCE: a proposal that designed a caching policy from first principles would be
the wrong answer to a measured question.** The spec's §4 is five modules and five key strings,
not an architecture.

⚠️ **And the second-most-important finding is operational, not architectural.**
`api/services/cache.py` — the file D4 is about — **is inside flow-worker's import closure and is
not on flow-worker's watch list** (§5). Editing `TTLCache` leaves flow-worker running the
previous definition. That single fact reorders the checkpoints below.

---

## 3. The decisions this packet asks the owner to make

### D4-A — Is the scope "ratify and adopt", or "design a caching layer"?

**Recommended: RATIFY AND ADOPT.** SPEC §2. The alternative is a second authority over a shape
that already works, which is the defect this programme keeps paying for.

⛔ The honest cost of ratifying: the census's ugliest numbers do **not** get fixed. 132 distinct
key prefixes with **125 of 150** key templates using `_` or no separator while 25 use `::`
(SPEC §3.2) stays exactly as it is, except at the four families a checkpoint touches. A rename
sweep is not proposed and should not be inferred.

### D4-B — Does the request-set key get banned, or kept as a fast path?

**Recommended: KEPT, subject to the four rules in SPEC §2.4.** A set key is correct as a fast
path over a per-entity cache and wrong as the only cache.

⭐ The measurement forces this, and it is why "per-set is bad" would be a wrong rule. All nine
per-set cache operations in the codebase are enumerated in SPEC §3.4. **Three of the six modules
are the anti-pattern** (`watchlist_performance`, `theme_performance`, `groups` — each wraps a
loop that is already per-entity). **One is the pattern used correctly** (`live_prices`). **One is
correct as-is and would be made worse by a split** (`polygon_extras` sends one provider request
carrying every symbol; per-index keys turn one call into up to ten). **One has no per-key
decomposition at all** (`discord_interactions` caches a rendered PNG of N tickers).

⛔ A blanket ban would break two of six.

### D4-C — Does D4 own key naming, or only key *shape* at the sites it touches?

**Recommended: SHAPE ONLY, and only where a checkpoint already edits the code.**

The prefix-delete hazard is real and currently held by comments rather than by code:
`cache.delete_prefix` removes every key starting with the prefix (`cache.py:133-144`), and
`earnings_table::{ticker}` (`earnings_table.py:586`) has **no trailing separator**, so
`delete_prefix("earnings_table::A")` would evict `::AAPL`, `::AMD` and `::AMZN`.

⭐ **Measured: all 21 `delete_prefix` call sites are separator-anchored today. Zero violations.**
That absence is meaningful only because the same AST scan found all 21 — it could have seen a
presence. But nothing prevents the 22nd, and the failure would be a silent over-eviction that
raises no error and shows up only as upstream load.

⛔ **The honest cost of choosing SHAPE ONLY: the hazard survives everywhere a checkpoint does not
reach.** CP3 removes it for the fundamentals family and nowhere else.

### D4-D — Does D4 get to touch `api/services/cache.py` at all?

**Recommended: NO, at every checkpoint in §4.**

Not because the file is bad — it is the best-documented module in the caching system — but
because of §5: flow-worker runs it and does not redeploy for it. A change there is either an
inert strand (flow-worker keeps the old `TTLCache` indefinitely) or, if the marker is bumped to
force a redeploy, a flow-worker restart. **A flow-worker restart drops the Massive OPRA socket
and Massive does not replay: the gap is permanent until the T+1 flat file.** Paying that for a
caching refactor is the wrong trade in both directions.

⚠️ This is a real constraint on the design, not a scheduling note. If a checkpoint ever *needs*
a `TTLCache` API change, that is the signal to stop and re-gate, not to bump the marker.

---

## 4. Proposed checkpoints, so an approval line can name one

| CP | scope | strands anything? | size |
|---|---|---|---|
| **CP1** | The spec's §2.4 four rules written down as a **derived** rail — a test that enumerates every per-set cache key by AST (the SPEC §3.4 population) and fails when a NEW one appears that is not declared as a deliberate fast path or a batch-provider key. **No product code changes. No key renamed. No module touched.** | **no** — a test file only | **S** |
| **CP2** | `watchlist_performance.py` adopts `wl_returns::{TICKER}::{as_of_date}` under the existing `wl_perf:` set key, which becomes a fast path. Per-ticker completeness replaces batch completeness (`cache_policy.set_by_completeness` moves inside the loop). | **no** — outside flow-worker's closure, verified §5 | **S** |
| **CP3** | `theme_performance.py::live_returns_for_syms` adopts `theme_ts_extra::{TS_KEY}`; `groups.py::_TODAY_CACHE` is deleted in favour of `groups_today::{TICKER}` in the shared singleton. | ⚠️ **YES** — both modules are in flow-worker's import closure and neither is watched. See §5 | **S/M** |
| **CP4** | ~~`fundamentals`/`earnings_table` move to `fundamentals::{TICKER}::{period}`, giving the family an anchored prefix and making `delete_prefix` correct by construction rather than by comment.~~ **UNBUILDABLE AS WRITTEN — see F-D4-1 below. A corrected assertion is PROPOSED there and is not approved.** | **no** — neither file is in the closure | **M** |
| **CP5** | `ticker_logos.py`'s resolution decision (which source answered, or that all missed) becomes `ticker_logo::{TICKER}::{source}` in the addressed tier; the PNG bytes stay on disk. Negative caching via `cache_policy.set_by_completeness`. | **no** — not in the closure | **M** |

### ⛔ F-D4-1 — CP4's assertion names a cache dimension that does not exist

**Filed 2026-09-14. CP4 was STOPPED before a line was written, on a measurement.**

The assertion presumes the family is keyed `fundamentals::{TICKER}::{period}` and frames CP4
as giving it *"an anchored prefix"* — i.e. a rename. **It is not a rename.** Derived from the
code, comments stripped, on `feat/s7-price-level`:

| noun in the assertion | resolved against the code | verdict |
|---|---|---|
| `earnings_table` key | `f"earnings_table::{ticker}"` — **two segments**, at `earnings_table.py:586` and `:693` (plus invalidations at `:655`, `:671`) | **exists, different shape** |
| `{period}` | appears **nowhere** in the family's key construction | ⛔ **UNRESOLVABLE** |
| `fundamentals` key | `api/services/fundamentals.py` builds **no cache key in this family at all** — zero `earnings_table::`/`fundamentals::` sites, zero `cache.get/set/invalidate` sites | ⛔ **UNRESOLVABLE** |

⛔ **A noun that cannot be resolved by command makes the assertion UNBUILDABLE-AS-WRITTEN.**
Two of CP4's three nouns do not resolve. Building it would have meant inventing `{period}` and
inventing a `fundamentals` cache key, then calling the result a rename.

**What adding `{period}` would actually do — the collision proof.** `fundamentals_monitor.py`
enumerates warm entries and recovers the ticker by splitting on the FIRST separator:

```python
for k in cache.keys_with_prefix("earnings_table::"):
    t = k.split("::", 1)[1].upper() if "::" in k else ""
```

With a three-segment key, `k.split("::", 1)[1]` is **`"AAPL::Q1"`**, not `"AAPL"`. The monitor
would not merely miss entries — it would manufacture **malformed ticker strings** and feed them
into `check_ticker`, whose failures are then reported as data defects. ⭐ **The instrument would
report a property of the key format as a property of the data**, which is the exact class this
programme keeps re-committing.

And on the serve path, a key gaining a dimension **splits one live cache entry into two**:
every member-facing read misses once, and `earnings_table.py`'s own invalidation sites
(`:655`, `:671`) go stale-by-construction because they invalidate the two-segment form.

⚠️ **Honesty about the instrument used here:** the comment-strip pass changed nothing on this
corpus — raw `grep` and code-only counts are identical (4 and 4, 1 and 1), so there were no
prose occurrences to exclude and **the strip proves nothing on these files**. The finding rests
on reading the four assignment sites and the parse, not on the filter.

#### PROPOSED — not approved, not scheduled

> **CP4′ (proposed).** `earnings_table`'s key stays **two-segment**. The unit becomes:
> **(a)** give the family an anchored prefix by making the separator unambiguous, so
> `delete_prefix("earnings_table::")` is correct by construction rather than by the comment
> that currently warns `'A'` would over-match `AAPL`; **(b)** `fundamentals_monitor`'s
> recovery becomes `rsplit`/an explicit parse with a control proving a malformed key is
> REFUSED rather than silently upcased; **(c)** `fundamentals.py` is dropped from the scope
> until someone names the key it is supposed to own.
>
> ⛔ **Whether the entry SHOULD vary by period is a design question the assertion presumed and
> the code does not answer.** If it should, that is a cache-splitting change on a live
> member-facing path and needs its own checkpoint, its own approval line, and a migration —
> not a clause inside a rename. **Reported, not invented.**

⛔ **CP3 IS THE ONLY ONE THAT CAN STRAND, and it is named here rather than discovered at merge
time.** §5 is the measurement.

⛔ **AND `api/services/cache.py` IS IN NO CHECKPOINT.** Per D4-D. If a checkpoint's
implementation turns out to need a `TTLCache` API change, that is a stop-and-re-gate condition,
not a scope stretch.

⛔ **Nothing about the 132 key prefixes, the 125-vs-25 separator split, or the 26 cache instances
is in any checkpoint.** They are the census's headline and they are deliberately excluded: a
rename sweep across 119 files is a different programme with a different blast radius, and D4's
job is to make the divergence nameable, not to resolve it.

---

## 5. ⛔ Which checkpoint could strand flow-worker — CHECKED, NOT GUESSED

Run this pass against this tree with `tools/flow_worker_watch_coverage.py`:

```
reachable_paths('.')  -> 154 api modules   (the AST import closure from api/flow_worker_main.py)
watched_paths('.')    ->  24 patterns      (what actually triggers a flow-worker redeploy)
reachable AND watched ->  21
reachable NOT watched -> 133               # code flow-worker RUNS and will NOT redeploy for
```

⚠️ The tool's own header says the closure reaches **162**. Measured today it is **154**. Read the
function, not the header.

| Checkpoint | Files it edits | In `reachable_paths()`? | In `watched_paths()`? | Verdict |
|---|---|---|---|---|
| **CP1** | one new `tests/` file | no | no | **free** |
| **CP2** | `api/services/watchlist_performance.py` | **no** | no | **free** |
| **CP3** | `api/services/theme_performance.py`, `api/services/groups.py` | **YES, both** | **no** | ⚠️ **INERT STRAND** |
| **CP4** | `api/services/fundamentals.py`, `api/services/earnings_table.py`, `api/services/fundamentals_monitor.py` | **no** | no | **free** |
| **CP5** | `api/services/ticker_logos.py` | **no** | no | **free** |

**What "INERT STRAND" means for CP3, precisely.** flow-worker imports and executes
`theme_performance` and `groups`, but neither file is on its 24-pattern watch list, so the push
that changes them deploys **web only** and flow-worker keeps running the previous definitions
until an unrelated push happens to touch a watched file. Two questions follow, and CP3 must
answer both **before** it merges, not after:

1. **Does flow-worker CALL the changed functions?** The closure proves import, not invocation.
   `reachable_paths()` is a static over-approximation in one direction and an under-approximation
   in another, and its own docstring says so (`flow_worker_watch_coverage.py:130-133`). Trace the
   call, name the symbol, the way the smoke-login change traced `validate_session` through
   exactly one hop.
2. **If it does, is a stale definition WRONG or merely OLD?** A cache-key change is
   behaviourally neutral across processes only if the two processes never read each other's
   entries — and they cannot, because tiers 2 and 3 are per-process (SPEC §5.3). A stale
   flow-worker holding the old key shape computes the same values under a different key. That is
   OLD, not WRONG — but it must be **shown**, not assumed.

⛔ **Forcing a redeploy via the deploy marker is not the answer to CP3.** A flow-worker restart
drops the Massive OPRA socket and Massive does not replay; the tape gap is permanent until the
T+1 flat file. Paying a permanent data gap so that a cache key changes a few hours earlier is
the wrong trade. If CP3's trace shows a real behavioural divergence, the correct move is to
re-gate, not to bump the marker.

⭐ **This is also why CP2 is sequenced ahead of CP3 even though CP3 is arguably the cleaner
change.** The ordering is by blast radius, not by elegance.

---

## 6. What this packet does NOT ask for

- **No new cache and no new tier.** Every mechanism in the spec is running today.
- **No change to `api/services/cache.py`.** D4-D.
- **No key renames outside the four families a checkpoint touches.** 132 prefixes stay 132.
- **No cross-instance invalidation protocol.** SPEC §5.3 — the web pod is one uvicorn process,
  and a coherence protocol built against an architecture that does not exist is validated by
  nothing.
- **No correctness guard moved into a cache tier.** SPEC §5.2 — `cache.py`'s LRU bound is a
  cache; `sync._locks` is a correctness guard; a guard that can be evicted is not a guard.
- **No member-visible change of any kind, at any checkpoint.**
- **No production instrumentation.** Adding hit-rate counters is a real and separately
  justifiable piece of work (§7 says why it matters) and it is not in any checkpoint here.

---

## 7. ⚠️ The evidence gap in this packet, stated where it bites

**Not one hit rate, miss rate, eviction rate or memory figure in this packet or its spec is a
current production measurement.** This session had no production access, and no tier carries a
counter a static read can recover.

⛔ **Where it bites:** the whole argument for CP2 and CP3 is that per-set keys destroy sharing
between members whose lists overlap. That is **structurally certain** — two distinct sets produce
two distinct md5 digests and share no entry, which is a property of the key, not of the traffic.
What is **not** measured is how much overlap real member lists actually have, and therefore how
much the fix is worth.

⭐ **The direction of the uncertainty is knowable and it is the safe one.** Per-key can never
share *less* than per-set: the set key's population is a subset of the per-key population's
combinations. So CP2 and CP3 cannot make sharing worse; the open question is only whether the win
is large or small.

⚠️ **The one figure a reader might mistake for a measurement:** SPEC §2.3 quotes 31.7% miss and
~3.1k upstream fetches per poll round. Those are recorded in `cache.py:14-22` about a **past**
configuration that has since been fixed. They are evidence that the failure class is real; they
are **not** a current number and must not be re-used as one.

**If the owner wants a real number before signing**, the cheapest honest instrument is a counter
on `TTLCache.get` (hit/miss by key prefix) behind a flag, read once off a warm pod. It is
approximately CP1-sized, it changes `api/services/cache.py`, and D4-D says D4 does not get to
change that file — so it would need its own line.

---

## 8. Recommendation

**Sign CP1 alone, or sign nothing yet.**

CP1 is a test file. It changes no product code, renames no key, touches no module flow-worker
runs, and is revertible by deleting one file. What it buys is the thing the census says is
actually missing: **the four rules of SPEC §2.4 stop being a document and become a derivation
that fails by name when the tenth per-set key appears.** Today that population is nine, all
enumerated, three of them wrong, one of them right, two of them correct-as-is — and nothing
anywhere notices the tenth.

⛔ **And CP1 carries the correction that should not wait:** this specification is the first
artifact in the programme to say out loud that `api/services/cache.py` is executed by flow-worker
and is not watched by it. Shipping caching work without that sentence written down is how the
next session bumps the deploy marker during market hours to make a cache change take effect.
