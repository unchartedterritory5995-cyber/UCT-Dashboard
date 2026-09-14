"""Mutation proofs for step 2.5 — the artifact cache and the coalescer (03 §3.6, §3.2).

Same contract as `mutation_harness_adapters.py`, deliberately: one mutation at a time, an EXACT
single replacement, EOL-aware, the file restored from the bytes captured before the edit and the
restore VERIFIED BY SHA256 — never `git checkout`, which discards whatever else was in the working
tree (`feedback_mutation_check_never_git_checkout`, now with two incidents behind it). The control
runs BEFORE and AFTER, because a harness that only checks the suite afterwards cannot tell a rail
that was always red from one its own mutation broke.

Each mutation below is a real defect this layer was built to close, re-introduced on purpose: the
key's vintage taken from the wall clock; a miss raised instead of returned; an expired entry handed
back for the caller to re-check; an unmeasured vintage laundered into a clean one; the cached stamp
composed from the data's age; eviction reading insertion order instead of `stored_at`; coalescing
quietly demoted to an optimisation; a follower waiting without a budget; a leader's failure
swallowed into a confident `None`.

⛔ A MUTATION THAT STAYS GREEN IS A FINDING ABOUT THE TEST, NOT SOMETHING TO DELETE FROM THIS LIST.

Usage:  python docs/discord-render/instruments/mutation_harness_cache.py [repo-root]
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]

CACHE = "api/services/discord_render/artifact_cache.py"
T = "tests/test_discord_render_artifact_cache.py::"
C = "tests/test_discord_render_contracts.py::"

#: The scoped gate this harness controls on. ⛔ NAMED FILES ONLY — `-k` over the tree is not scoping
#: (the filter picks what EXECUTES; every test is still COLLECTED, and collection is where the
#: memory goes: an unscoped run reached 11,854 MB on this box on 2026-09-12).
GATE = ["tests/test_discord_render_artifact_cache.py", "tests/test_discord_render_contracts.py"]

MUTATIONS = [
    # ── the key is the DATA's vintage, never the wall clock ────────────────
    {"name": "B1 the key's third part becomes the wall clock (the hit rate collapses to zero)",
     "file": CACHE,
     "old": "    if envelope is not None:\n        vintage = vintage_of(envelope)\n",
     "new": "    if envelope is not None:\n        vintage = str(time.time())\n",
     "tests": [T + "test_the_key_cannot_read_a_clock_at_all",
               T + "test_the_same_input_keys_the_same_a_minute_later"]},
    {"name": "B2 an unknown vintage folds into an empty one (two facts, one entry)", "file": CACHE,
     "old": "    vintage = key.vintage if key.vintage is not None else _UNKNOWN_VINTAGE\n",
     "new": '    vintage = key.vintage or ""\n',
     "tests": [T + "test_an_unknown_vintage_keys_stably_rather_than_by_the_clock"]},
    {"name": "B3 two authorities over one vintage are reconciled instead of refused", "file": CACHE,
     "old": "    if vintage is not None and envelope is not None:\n", "new": "    if False:\n",
     "tests": [T + "test_a_key_refuses_two_authorities_over_one_vintage"]},
    {"name": "B4 argument ORDER makes a second cache entry", "file": CACHE,
     "old": '    return "|".join(f"{k}={args[k]}" for k in sorted(args) if args[k] is not None)\n',
     "new": '    return "|".join(f"{k}={args[k]}" for k in args if args[k] is not None)\n',
     "tests": [T + "test_argument_order_is_not_a_second_entry"]},

    # ── a miss is None, and never a stale hit ──────────────────────────────
    {"name": "B5 a miss raises, so every call site must wrap the cache", "file": CACHE,
     "old": '            if entry is None:\n                self._stats["misses"] += 1\n                return None\n',
     "new": "            if entry is None:\n                raise KeyError(k)\n",
     "tests": [T + "test_a_miss_is_None_and_never_an_exception",
               T + "test_two_data_versions_are_two_entries_and_neither_serves_the_other"]},
    {"name": "B6 an expired entry is handed back for the caller to re-check", "file": CACHE,
     "old": "            if self._expired(entry, now):\n", "new": "            if False:\n",
     "tests": [T + "test_an_expired_entry_is_a_miss_not_a_hit_the_caller_must_recheck",
               T + "test_the_extended_session_gets_its_own_longer_ttl"]},
    {"name": "B7 one TTL for every session (a closed-market entry expires on a timer)", "file": CACHE,
     "old": "        ttl = ttl_s(session_state(now))\n", "new": "        ttl = RTH_TTL_S\n",
     "tests": [T + "test_the_extended_session_gets_its_own_longer_ttl",
               T + "test_a_closed_session_entry_has_no_age_expiry_because_the_key_owns_that_boundary"]},
    {"name": "B8 the closed session invents a number the key already owns", "file": CACHE,
     "old": "    if state in CLOSED_STATES:\n        return CLOSED_TTL_S\n",
     "new": "    if state in CLOSED_STATES:\n        return EXTENDED_TTL_S\n",
     "tests": [T + "test_a_closed_session_entry_has_no_age_expiry_because_the_key_owns_that_boundary"]},

    # ── stale=None survives; stored_at and the envelope stay two numbers ───
    {"name": "B9 an unmeasured vintage is laundered into a clean False", "file": CACHE,
     "old": "        return self.envelope.stale if self.envelope else None\n",
     "new": "        return bool(self.envelope.stale) if self.envelope else None\n",
     "tests": [T + "test_stale_None_survives_the_round_trip_as_None_and_never_as_False",
               T + "test_all_three_verdicts_survive_the_round_trip"]},
    {"name": "B10 no envelope at all reads as fresh", "file": CACHE,
     "old": "        return self.envelope.stale if self.envelope else None\n",
     "new": "        return self.envelope.stale if self.envelope else False\n",
     "tests": [T + "test_stale_None_survives_the_round_trip_as_None_and_never_as_False"]},
    {"name": "B11 the cached stamp is composed from the DATA's age (the week-old chart)", "file": CACHE,
     "old": '        return dt.datetime.fromtimestamp(self.stored_at, ET).strftime("%H:%M:%S")\n',
     "new": '        return (self.envelope.as_of_et if self.envelope else "")[-5:]\n',
     "tests": [T + "test_a_week_old_chart_is_not_labelled_cached_thirty_seconds_ago"]},
    {"name": "B12 a hit refreshes stored_at (an LRU smuggled into the eviction field)", "file": CACHE,
     "prelude": ("import datetime as dt\n", "import dataclasses\nimport datetime as dt\n"),
     "old": '            self._stats["hits"] += 1\n            return entry.artifact\n',
     "new": '            self._stats["hits"] += 1\n'
            "            entry.artifact = dataclasses.replace(entry.artifact, stored_at=_wall(now))\n"
            "            return entry.artifact\n",
     "tests": [T + "test_a_hit_does_not_refresh_stored_at"]},

    # ── bounded, deterministic eviction ────────────────────────────────────
    {"name": "B13 eviction reads insertion order instead of stored_at", "file": CACHE,
     "old": "            victim = min(self._store.items(), key=lambda kv: (kv[1].artifact.stored_at, kv[1].seq))[0]\n",
     "new": "            victim = min(self._store.items(), key=lambda kv: kv[1].seq)[0]\n",
     "tests": [T + "test_the_entry_cap_evicts_the_oldest_by_stored_at_not_by_insertion_order"]},
    {"name": "B14 eviction takes the NEWEST entry", "file": CACHE,
     "old": "            victim = min(self._store.items(), key=lambda kv: (kv[1].artifact.stored_at, kv[1].seq))[0]\n",
     "new": "            victim = max(self._store.items(), key=lambda kv: (kv[1].artifact.stored_at, kv[1].seq))[0]\n",
     "tests": [T + "test_the_entry_cap_evicts_the_oldest_by_stored_at_not_by_insertion_order",
               T + "test_eviction_is_deterministic_when_two_entries_share_a_stored_at"]},
    {"name": "B15 the entry cap is not enforced", "file": CACHE,
     "old": "        while self._store and (len(self._store) > self._max_entries or self._bytes > self._max_bytes):\n",
     "new": "        while self._store and (self._bytes > self._max_bytes):\n",
     "tests": [T + "test_the_entry_cap_evicts_the_oldest_by_stored_at_not_by_insertion_order",
               T + "test_eviction_is_deterministic_when_two_entries_share_a_stored_at"]},
    {"name": "B16 the byte cap is not enforced", "file": CACHE,
     "old": "        while self._store and (len(self._store) > self._max_entries or self._bytes > self._max_bytes):\n",
     "new": "        while self._store and (len(self._store) > self._max_entries):\n",
     "tests": [T + "test_the_byte_cap_evicts_until_it_fits"]},
    {"name": "B17 an oversized artifact empties the cache for room it will still not fit in",
     "file": CACHE,
     "old": "            if size > self._max_bytes:\n", "new": "            if False:\n",
     "tests": [T + "test_an_artifact_larger_than_the_whole_cap_is_refused_and_evicts_nothing"]},
    {"name": "B18 a replaced key's bytes are counted twice", "file": CACHE,
     "old": "            if k in self._store:\n                self._drop(k)\n",
     "new": "            if False:\n                self._drop(k)\n",
     "tests": [T + "test_replacing_a_key_does_not_double_count_its_bytes"]},
    {"name": "B19 evicted bytes are never returned to the budget", "file": CACHE,
     "old": "    def _drop(self, k: str) -> None:\n        entry = self._store.pop(k, None)\n"
            "        if entry is not None:\n            self._bytes -= entry.size\n",
     "new": "    def _drop(self, k: str) -> None:\n        self._store.pop(k, None)\n",
     "tests": [T + "test_the_byte_cap_evicts_until_it_fits",
               T + "test_replacing_a_key_does_not_double_count_its_bytes",
               T + "test_concurrent_puts_keep_the_byte_accounting_exact"]},
    {"name": "B20 a non-bytes payload is charged a guess instead of a flat fee", "file": CACHE,
     "old": "    return NOMINAL_BYTES\n", "new": "    return 1\n",
     "tests": [T + "test_a_non_bytes_payload_is_charged_a_nominal_fee_rather_than_a_shallow_guess"]},

    # ── coalescing is part of the contract ─────────────────────────────────
    {"name": "B21 coalescing does nothing — every caller produces its own", "file": CACHE,
     "old": "            flight = self._flights.get(k)\n            if flight is None:\n",
     "new": "            flight = None\n            if flight is None:\n",
     "tests": [T + "test_identical_work_in_flight_shares_one_production"]},
    {"name": "B22 a follower waits without a budget (the hang)", "file": CACHE,
     "old": "        if not flight.done.wait(budget_s):\n", "new": "        if not flight.done.wait():\n",
     "tests": [T + "test_a_follower_whose_budget_expires_gets_a_miss_not_a_hang"]},
    {"name": "B23 no budget left is still a reason to wait", "file": CACHE,
     "old": "        if budget_s is None or budget_s <= 0:\n", "new": "        if False:\n",
     "tests": [T + "test_a_follower_with_no_budget_left_does_not_wait_at_all"]},
    {"name": "B24 a follower is handed the leader's traceback instead of a miss", "file": CACHE,
     "old": "        if flight.failed:\n            return None\n",
     "new": '        if flight.failed:\n            raise RuntimeError("the leader failed")\n',
     "tests": [T + "test_a_leaders_failure_releases_its_followers_immediately_with_a_miss"]},
    {"name": "B25 the leader's own failure is swallowed into a confident None", "file": CACHE,
     "old": '                    self._stats["leader_failures"] += 1\n                flight.failed = True\n'
            "                flight.done.set()          # ⛔ release the followers NOW; they must not wait out a\n"
            "                raise                      #    budget for an answer that is never coming.\n",
     "new": '                    self._stats["leader_failures"] += 1\n                flight.failed = True\n'
            "                flight.done.set()\n                return None\n",
     "tests": [T + "test_a_leaders_failure_releases_its_followers_immediately_with_a_miss"]},
    {"name": "B26 followers wait out their budget for an answer that is never coming", "file": CACHE,
     "old": "                flight.done.set()          # ⛔ release the followers NOW; they must not wait out a\n"
            "                raise                      #    budget for an answer that is never coming.\n",
     "new": "                raise\n",
     "tests": [T + "test_a_leaders_failure_releases_its_followers_immediately_with_a_miss"]},
    {"name": "B27 the flight is not retired, so a later caller joins a finished production",
     "file": CACHE,
     "old": "                self._flights.pop(k, None)\n            flight.value = value\n",
     "new": "                pass\n            flight.value = value\n",
     "tests": [T + "test_a_caller_arriving_after_the_flight_finished_starts_a_new_production"]},
    {"name": "B28 coalesce is no longer offered (the contract loses a third of itself)", "file": CACHE,
     "old": "    def coalesce(self, key: CacheKey, produce: Callable[[], Any], *, budget_s: float) -> Any:\n",
     "new": "    def _coalesce(self, key: CacheKey, produce: Callable[[], Any], *, budget_s: float) -> Any:\n",
     "tests": [T + "test_the_module_satisfies_the_frozen_shapes_lane_A_builds_against"]},

    # ── thread safety: the render workers are real threads ─────────────────
    {"name": "B29 put runs outside the lock", "file": CACHE,
     "old": "        with self._lock:\n            if size > self._max_bytes:\n",
     "new": "        if True:\n            if size > self._max_bytes:\n",
     "tests": [T + "test_every_public_call_takes_the_lock"]},
    {"name": "B30 get runs outside the lock", "file": CACHE,
     "old": "        k = fingerprint(key)\n        with self._lock:\n            entry = self._store.get(k)\n",
     "new": "        k = fingerprint(key)\n        if True:\n            entry = self._store.get(k)\n",
     "tests": [T + "test_every_public_call_takes_the_lock"]},
    {"name": "B31 the lock is held across the production (the coalescer serialises the sharing)",
     "file": CACHE,
     "old": "        if leader:\n            try:\n                value = produce()\n",
     "new": "        if leader:\n            try:\n                with self._lock:\n                    value = produce()\n",
     "tests": [T + "test_the_lock_is_not_held_across_a_production"]},

    # ── in-memory by design; the kill switch; one store ────────────────────
    {"name": "B32 a durability layer nobody asked for is imported", "file": CACHE,
     "old": "import hashlib\nimport os\n", "new": "import hashlib\nimport os\nimport sqlite3\n",
     "tests": [T + "test_the_cache_is_in_memory_by_design_and_writes_nothing"]},
    {"name": "B33 the kill switch is captured at import (rollback needs a redeploy)", "file": CACHE,
     "prelude": ('_UNKNOWN_VINTAGE = "\\x00unknown"\n',
                 '_UNKNOWN_VINTAGE = "\\x00unknown"\n_ENABLED_AT_IMPORT = False\n'),
     "old": '    return str(os.environ.get("RENDER_CACHE_ENABLED", "")).strip().lower() in ("1", "true", "yes", "on")\n',
     "new": "    return _ENABLED_AT_IMPORT\n",
     "tests": [T + "test_the_kill_switch_is_read_per_call_so_it_needs_no_redeploy"]},
    {"name": "B34 every caller gets its own store (two half-useful hit rates)", "file": CACHE,
     "old": "        if _DEFAULT is None:\n            _DEFAULT = ArtifactCache()\n        return _DEFAULT\n",
     "new": "        return ArtifactCache()\n",
     "tests": [T + "test_the_process_wide_store_is_one_store"]},
]


def read(p):
    return p.read_bytes()


def run(tests):
    cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:randomly", "-x", *tests]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=900)
    out = r.stdout + r.stderr
    # ⛔ A RUN WITHOUT A TOTALS LINE IS NOT A RUN. An exit code alone cannot tell "everything passed"
    # from "the runner died at argument parsing having executed nothing".
    m = re.search(r"(\d+) passed|(\d+) failed|(\d+) error", out)
    if not m:
        return "NO TOTALS LINE", out[-400:]
    if r.returncode == 0:
        return "GREEN", out.strip().splitlines()[-1][:120]
    return "RED", out.strip().splitlines()[-1][:120]


def main():
    print(f"root: {ROOT}\n")
    control_first = run(GATE)
    print(f"CONTROL (before)  {control_first[0]}  {control_first[1]}")
    if control_first[0] != "GREEN":
        print("*** the suite is not green before mutating; nothing below would mean anything")
        return 1

    results = []
    for mut in MUTATIONS:
        path = ROOT / mut["file"]
        original = read(path)
        sha = hashlib.sha256(original).hexdigest()
        text = original.decode("utf-8")
        eol = "\r\n" if "\r\n" in text else "\n"
        old = mut["old"].replace("\n", eol)
        new = mut["new"].replace("\n", eol)
        n = text.count(old)
        # A mutation may need a second edit to be well-formed (e.g. the import the mutated line
        # then uses). Both are applied, or neither is.
        pre_old, pre_new = (mut.get("prelude") or ("", ""))
        pre_old, pre_new = pre_old.replace("\n", eol), pre_new.replace("\n", eol)
        if n != 1 or (pre_old and text.count(pre_old) != 1):
            results.append((mut["name"], f"NOT APPLIED ({n} matches)", ""))
            print(f"  {mut['name']:<78} NOT APPLIED ({n} matches)")
            continue
        try:
            mutated = text.replace(old, new, 1)
            if pre_old:
                mutated = mutated.replace(pre_old, pre_new, 1)
            path.write_bytes(mutated.encode("utf-8"))
            verdict, tail = run(mut["tests"])
        finally:
            path.write_bytes(original)
            assert hashlib.sha256(read(path)).hexdigest() == sha, f"RESTORE FAILED for {mut['file']}"
        results.append((mut["name"], verdict, tail))
        print(f"  {mut['name']:<78} {verdict}")

    control_last = run(GATE)
    print(f"\nCONTROL (after)   {control_last[0]}  {control_last[1]}")
    red = sum(1 for _, v, _ in results if v == "RED")
    print(f"\n{red}/{len(results)} mutations RED")
    bad = [(n, v) for n, v, _ in results if v != "RED"]
    for n, v in bad:
        print(f"  *** {v}: {n}")
    return 0 if (not bad and control_last[0] == "GREEN") else 1


if __name__ == "__main__":
    sys.exit(main())
