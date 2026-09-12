# Wave Q2 — PRD

⛔⛔ **ZERO CODE. Q2 does not begin until the Q1 7-day observation window closes
(2026-09-19 00:45 ET) AND the owner says start.** This document exists so that
when it does start, the rails are specified before the code, which is the one
thing Q1 proved is worth doing first.

⭐ **What Q1 bought us.** A durable per-account IndexedDB working copy, an ordered
outbox that survives tab death, Web Locks leader election, and
conflict-fork-never-clobber — all live by default since 2026-09-12 00:45 ET.
**Q2 is about READING, where Q1 was about WRITING.**

---

## The three slices

### Q2-A — Offline read

**What a member gets, in plain English:** *"The notes you've opened recently are
there when your connection isn't."* Today, going offline means the Notebook can
keep what you're typing but cannot show you anything you haven't already got
open. Q2-A caches the notes you have actually opened, so a dropped connection on
a train leaves your recent research readable.

**What it changes:**
- **working copy** — gains a *read cache* distinct from the *working copy*. ⛔ These
  must not be one store: a working copy holds YOUR unsynced edits and may never be
  evicted; a read cache holds the server's copy and must be evictable under quota
  pressure. Merging them is how an eviction loses member work.
- **outbox** — unchanged. Reading queues nothing.
- **leader** — unchanged for writes. ⚠️ Open question: should cache *refresh* be
  leader-only? Recommendation **yes** — N tabs refreshing the same notes is N×
  the requests for one member.
- **fork** — unchanged. A cached read that goes stale is replaced, never forked;
  there is no member intent in a cache entry to preserve.

**Storage bound:** cache the **50 most recently opened notes**, hard cap
**25 MB/account**, LRU eviction. ⛔ The origin quota is SHARED with `uct_bars_v1`,
which already holds ~550 MB of chart data — Q2 does not get a clean slate, and the
bound must be enforced by the cache itself rather than inherited from the browser.

**Read-only offline, and why:** thesis / evidence / review sections stay read-only
offline (unchanged from Q1) because they are **dated claims** — a member editing a
dated claim offline creates a record whose date is a lie. Attachments are
read-only offline in Q2-A (see Q2-C).

### Q2-B — Expanded conflict UX

**What a member gets:** *"When two of your devices disagree, you can see both and
pick — instead of finding a note called '(conflicted copy)'."* Q1's answer to a
conflict is correct and safe: preserve both, fork, never clobber. It is also
**silent** — the member discovers a `(conflicted copy)` note later and has to
reconcile it by hand with no idea what differed.

**What it changes:**
- **fork** — the MECHANISM is unchanged and must stay unchanged. ⛔⛔ Q2-B adds a
  SURFACE over the existing fork, never a new merge strategy. Any proposal that
  changes what gets written on a 409 is out of scope and reopens Q1.
- **working copy / outbox / leader** — unchanged.

**Surface:** a banner on a note that has a conflicted sibling → a side-by-side
diff → "keep mine" / "keep theirs" / "keep both". "Keep both" is today's
behaviour and stays the default if the member does nothing.

⛔ **The rule Q1 paid for, restated:** never clobber. "Keep mine" must ARCHIVE
theirs, not delete it.

### Q2-C — Attachment caching

**What a member gets:** *"Documents you've pinned open offline."* Explicit member
pinning only — never automatic.

**What it changes:**
- **working copy** — gains a blob store, separate again from both the read cache
  and the working copy.
- **outbox / leader / fork** — unchanged. Pinned attachments are read-only in Q2;
  offline annotation is out of scope.

**Storage bound:** **~500 MB/account is a PLANNING target, not a promise**, and it
sits beside the bars store's 550 MB in a shared origin quota. ⛔ Pin must fail
LOUDLY and specifically when quota is refused — "couldn't pin, you're out of
space" — never silently.

---

## Telemetry — denominators defined BEFORE the code, not after

⚰️ **Q1's lesson, and it nearly shipped broken twice.** The opt-in event fired on
the KEY being `'1'`; after the flip the key is unset for everyone, so the
denominator would have read **zero over a population of everyone** — a healthy-
looking zero, which is worse than an obvious break. Then its dedupe marker
mirrored the key and removed itself when unset, which would have turned a
once-per-browser count into a once-per-page-view count. Both were caught late.

⛔ **So every Q2 event names its denominator and its exclusion rule in this
document, before anyone writes it.**

| event | counts | denominator | rig/canary exclusion |
|---|---|---|---|
| `notebook_read_cache_hit` | a note opened FROM cache while offline | `notebook_offline_opt_in` (browsers running the layer) | canary times derived from stamped rows, ±300 s |
| `notebook_read_cache_evicted` | an LRU eviction | cache-enabled browsers | same |
| `notebook_conflict_surfaced` | the banner shown | notes with a conflicted sibling | same |
| `notebook_conflict_resolved` | member chose mine/theirs/both | `notebook_conflict_surfaced` | same |
| `notebook_pin_failed_quota` | a pin refused for space | pin attempts | same |

⛔ **Two rules, both learned the hard way:**
1. **A denominator that can read zero over a non-empty population is a defect,
   not a quiet week.** Every event above is paired with one that sizes its
   population.
2. **Exclusion is DERIVED, never a constant.** Q1's gate compared against a typed
   `RIG_LAST`; every canary run moved past it and it would have reported the
   instrument's own activity as the first member datapoint. Canary times come
   from the rows the canary stamps.

## Rollback shape, and the runtime kill-switch decision

Each slice ships behind its own compile-time constant, in the Q1 idiom:
`READ_CACHE_DEFAULT_ON`, `CONFLICT_UX_DEFAULT_ON`, `ATTACHMENT_PIN_DEFAULT_ON`.

⛔ **Rollback is a DEPLOY, not a variable** — revert, push, ~103–138 s rebuild
(measured twice on Q1), and **every member with an open tab keeps the old bundle
until they reload**. No service worker, no version prompt, by charter.

### The kill switch — recommendation: **BUILD BEFORE Q2-C, NOT BEFORE Q2-A/B**

| | |
|---|---|
| cost | **MEDIUM, 6–12 h**, shape (a): `/api/config` returns the flags, read once at boot, **failing closed** |
| what it buys | rollback in seconds instead of ~2 min, and no rebuild |
| ⛔ what it does NOT buy | **it does not reach open tabs either.** A boot-read flag is still a boot-time value. The open-tab gap is unchanged by it |

**Reasoning.** Q1 flipped without it and the deploy-only rollback was never
needed — the failure mode is a visible duplicate note, not lost text, so the bar
for an instant kill was never met. **Q2-A and Q2-B inherit that shape**: a stale
cached read or an unhelpful conflict banner is visible and recoverable.
**Q2-C does not.** Attachment caching writes potentially hundreds of megabytes to
a member's device against a shared quota; the failure mode is *other things on
that origin start failing*, including the bars store the charts depend on. That
is the first Q2 failure a member cannot see coming and cannot undo by reloading,
and it is the one worth paying 6–12 h to be able to stop in seconds.

## Test plan — rails named before the code

| # | rail | proves |
|---|---|---|
| R1 | a read-cache entry is NEVER written into the working-copy store | an eviction can never touch unsynced member work |
| R2 | eviction is LRU and respects the 25 MB cap, with a control at the boundary | the bound is enforced by us, not inherited |
| R3 | a cached read that is stale is REPLACED, never forked | no member intent exists in a cache entry |
| R4 | with `READ_CACHE_DEFAULT_ON` false, no cache store is opened at all | the dark path is real, mutation-proved |
| R5 | "keep mine" ARCHIVES theirs; nothing is deleted | never-clobber survives the new surface |
| R6 | the 409 write path is BYTE-IDENTICAL to Q1's with the conflict UX on | Q2-B is a surface, not a merge strategy |
| R7 | a refused pin surfaces a specific quota error | it fails loudly |
| R8 | every telemetry event fires once per browser, not once per page view | the Q1 dedupe regression cannot recur |
| R9 | canary/rig activity is excluded from every denominator by DERIVED times | the instrument cannot manufacture a member |

⛔ **Each rail must be MUTATION-PROVED** — break the guard, watch the rail redden,
restore. `tools/q1_mutation_gauntlet.py` is the pattern; Q2 needs its own entries.

## New default-reading and guard sites Q2 introduces

⛔ **Specified now so `q1_flag_default_sweep.py` can be extended before the code
exists, not audited after.** Q1's sweep was blind to a fourth pattern (a test
injecting its own empty storage stub) and found it only when the flip gate went
red.

| site | pattern | sweep class |
|---|---|---|
| `readCacheEnabled()` | reads `READ_CACHE_DEFAULT_ON` | new constant — sweep must track all three |
| `conflictUxEnabled()` | reads `CONFLICT_UX_DEFAULT_ON` | same |
| `attachmentPinEnabled()` | reads `ATTACHMENT_PIN_DEFAULT_ON` | same |
| cache-store open guard | gates on `readCacheEnabled()` | TESTS-OFF sites must write `'0'` explicitly |
| pin button render guard | gates on `attachmentPinEnabled()` | same |
| eviction scheduler | leader-only, gates on both leader AND flag | ⛔ two conditions — rail each separately |

⛔ **The sweep must be taught all three constants before the first Q2 line lands**,
and its self-check must carry a control for each. One constant with four blind
spots was expensive; three constants with four blind spots would be worse.
