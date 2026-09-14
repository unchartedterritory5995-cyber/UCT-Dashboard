"""Mutation proofs for step 2.5 — the two-tier artifact cache and the coalescer (03 §3.6, §3.2).

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

⭐ B32 ONWARDS ARE THE L2 TIER (OI-31): the volume never consulted; a hit served without being
promoted; an L1 eviction reaching through and deleting the durable copy; the write going straight
into the live path instead of through a tmp file and `os.replace`; each integrity field removed
separately; a corrupt entry SERVED; the degraded-never-fresh guard laundering an absent envelope
into a clean verdict; the volume's LRU evicting the newest; the two byte caps sharing one env name
again; the root's default going unreadable by `conftest`'s sandbox derivation; and `clear()`
becoming a delete against durable data.

⚰️ B32 used to be "a durability layer nobody asked for is imported" — the mutation that proved the
cache wrote NOTHING. It is gone with the rail it proved; the superseded design is recorded in
`docs/discord-render/LEDGER.md` rather than deleted from the record.

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
     "old": "            if entry is None:\n                hit = None\n",
     "new": "            if entry is None:\n                raise KeyError(k)\n",
     "tests": [T + "test_a_miss_is_None_and_never_an_exception",
               T + "test_two_data_versions_are_two_entries_and_neither_serves_the_other"]},
    {"name": "B6 an expired entry is handed back for the caller to re-check", "file": CACHE,
     "old": "            elif self._expired(entry, now):\n", "new": "            elif False:\n",
     "tests": [T + "test_an_expired_entry_is_a_miss_not_a_hit_the_caller_must_recheck",
               T + "test_the_extended_session_gets_its_own_longer_ttl"]},
    {"name": "B7 one TTL for every session (a closed-market entry expires on a timer)", "file": CACHE,
     # ⚠️ 4-space indent: the rule moved into the module-level `expired_at`, which is what makes
     # "the same TTL rule at both tiers" structural rather than two copies agreeing.
     "old": "    ttl = ttl_s(session_state(now))\n", "new": "    ttl = RTH_TTL_S\n",
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
     "old": '                self._stats["hits"] += 1\n                hit = entry.artifact\n',
     "new": '                self._stats["hits"] += 1\n'
            "                entry.artifact = dataclasses.replace(entry.artifact, stored_at=_wall(now))\n"
            "                hit = entry.artifact\n",
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
    # ⚠️ B17/B18/B29 carry a following line in their anchor ON PURPOSE. `put` and `_promote` now
    # hold byte-for-byte identical guards, so the short anchors matched TWICE (refused) or matched
    # the WRONG method and passed. B18 did the second — it mutated `_promote` and stayed GREEN,
    # which is the harness reporting a defect in itself rather than in the code.
    {"name": "B17 an oversized artifact empties the cache for room it will still not fit in",
     "file": CACHE,
     "old": "            if size > self._max_bytes:\n"
            "                # ⛔ REFUSED, NOT ACCEPTED-AND-THEN-EVICTED. Accepting it would evict every other\n",
     "new": "            if False:\n"
            "                # ⛔ REFUSED, NOT ACCEPTED-AND-THEN-EVICTED. Accepting it would evict every other\n",
     "tests": [T + "test_an_artifact_larger_than_the_whole_cap_is_refused_and_evicts_nothing"]},
    {"name": "B18 a replaced key's bytes are counted twice", "file": CACHE,
     "old": "                if k in self._store:\n                    self._drop(k)\n",
     "new": "                if False:\n                    self._drop(k)\n",
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
     "old": "        with self._lock:\n            if size > self._max_bytes:\n"
            "                # ⛔ REFUSED, NOT ACCEPTED-AND-THEN-EVICTED. Accepting it would evict every other\n",
     "new": "        if True:\n            if size > self._max_bytes:\n"
            "                # ⛔ REFUSED, NOT ACCEPTED-AND-THEN-EVICTED. Accepting it would evict every other\n",
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

    # ── L2: the tier that survives the restart (OI-31) ─────────────────────
    {"name": "B32 L1 never consults L2, so every deploy empties the cache again", "file": CACHE,
     "old": "        artifact = self._l2.get(key, now=now) if self._l2 is not None else None\n",
     "new": "        artifact = None\n",
     "tests": [T + "test_l2_survives_a_simulated_restart",
               T + "test_an_l2_hit_promotes_into_l1_which_is_the_point_of_two_tiers"]},
    {"name": "B33 an L2 hit is served but never promoted (two tiers become one slower tier)",
     "file": CACHE,
     "old": "        self._promote(k, artifact)\n", "new": "        pass\n",
     "tests": [T + "test_an_l2_hit_promotes_into_l1_which_is_the_point_of_two_tiers"]},
    {"name": "B34 an L1 eviction reaches through and deletes the durable copy", "file": CACHE,
     "old": "    def _drop(self, k: str) -> None:\n        entry = self._store.pop(k, None)\n"
            "        if entry is not None:\n            self._bytes -= entry.size\n",
     "new": "    def _drop(self, k: str) -> None:\n        entry = self._store.pop(k, None)\n"
            "        if entry is not None:\n            self._bytes -= entry.size\n"
            "            if self._l2 is not None:\n                self._l2.discard(k)\n",
     "tests": [T + "test_l1_eviction_does_not_evict_l2"]},
    {"name": "B35 an artifact too big for the HEAP is promoted into it anyway", "file": CACHE,
     "old": '            if size > self._max_bytes:\n                self._stats["l2_served_unpromoted"] += 1\n                return\n',
     "new": '            if False:\n                self._stats["l2_served_unpromoted"] += 1\n                return\n',
     "tests": [T + "test_an_artifact_too_large_for_the_heap_is_still_served_from_the_volume"]},

    # ── the durable write is atomic ────────────────────────────────────────
    {"name": "B36 the payload is written straight into the live path (a reader sees half an entry)",
     "file": CACHE,
     "old": "        tmp = os.path.join(shard, _TMP_PREFIX + uuid.uuid4().hex)\n",
     "new": "        tmp = path\n",
     "tests": [T + "test_the_live_path_is_only_ever_reached_by_an_atomic_replace"]},
    {"name": "B37 a failed write leaves its tmp file behind", "file": CACHE,
     "old": "        except BaseException:\n            try:\n                os.remove(tmp)\n"
            "            except OSError:\n                pass\n            raise\n",
     "new": "        except BaseException:\n            raise\n",
     "tests": [T + "test_a_write_that_dies_leaves_the_previous_entry_whole_and_no_debris"]},
    {"name": "B38 a volume that cannot be written raises into the render path", "file": CACHE,
     "old": '        except OSError:\n            self._bump("l2_write_errors")\n            return False\n',
     "new": "        except OSError:\n            raise\n",
     "tests": [T + "test_a_volume_that_cannot_be_written_costs_a_hit_not_a_render",
               T + "test_a_write_that_dies_leaves_the_previous_entry_whole_and_no_debris"]},

    # ── corruption is a miss, never a served chart ─────────────────────────
    {"name": "B39 the payload digest is not checked (a flipped byte is served as a chart)",
     "file": CACHE,
     "old": '        if not isinstance(digest, str) or hashlib.sha256(payload).hexdigest() != digest:\n',
     "new": "        if False:\n",
     "tests": [T + "test_a_damaged_entry_is_a_miss_recorded_and_discarded_never_served[flip_a_payload_byte]",
               T + "test_a_damaged_entry_is_a_miss_recorded_and_discarded_never_served[header_declares_no_sha]"]},
    {"name": "B40 the declared length is not checked (a malformed header is served)", "file": CACHE,
     "old": "        if not isinstance(declared, int) or declared != len(payload):\n",
     "new": "        if False:\n",
     "tests": [T + "test_a_damaged_entry_is_a_miss_recorded_and_discarded_never_served[header_declares_no_length]"]},
    {"name": "B41 the file's claimed key is not checked (a moved file serves another key)",
     "file": CACHE,
     "old": "        if claimed != (key.command, key.args, key.vintage):\n", "new": "        if False:\n",
     "tests": [T + "test_a_damaged_entry_is_a_miss_recorded_and_discarded_never_served[header_claims_another_key]"]},
    {"name": "B42 a corrupt entry raises at the render path instead of missing", "file": CACHE,
     "old": "        except Exception:\n            # ⛔ EVERY failure of integrity lands here and is IDENTICAL to the caller: a miss. The\n",
     "new": "        except KeyboardInterrupt:\n            # ⛔ EVERY failure of integrity lands here and is IDENTICAL to the caller: a miss. The\n",
     "tests": [T + "test_a_damaged_entry_is_a_miss_and_not_an_exception_even_in_bulk"]},
    {"name": "B43 a corrupt entry is left holding byte budget it can never be served from",
     "file": CACHE,
     "old": '            self._bump("l2_corrupt", "l2_misses")\n            self.discard(fp)\n            return None\n',
     "new": '            self._bump("l2_corrupt", "l2_misses")\n            return None\n',
     "tests": [T + "test_a_damaged_entry_is_a_miss_recorded_and_discarded_never_served[truncate_payload]"]},
    {"name": "B44 an expired file on the volume outlives the heap's own expiry rule", "file": CACHE,
     "old": "        if expired_at(artifact.stored_at, now):\n", "new": "        if False:\n",
     "tests": [T + "test_the_same_expiry_rule_decides_both_tiers"]},

    # ── degraded never fresh, at the deserialisation boundary ──────────────
    {"name": "B45 an absent envelope is laundered into a clean verdict on the way out of the file",
     "file": CACHE,
     "old": "    if raw is None:\n        return None\n",
     "new": '    if raw is None:\n        return Envelope(None, None, None, "rth", None, None, False)\n',
     "tests": [T + "test_an_entry_with_no_envelope_comes_back_unknown_and_never_fresh"]},
    {"name": "B46 a `stale` that is neither a verdict nor unknown is accepted as one", "file": CACHE,
     "old": "    if env.stale is not None and not isinstance(env.stale, bool):\n"
            "        raise ValueError(f\"stale={env.stale!r} is neither a verdict nor 'unknown'\")\n",
     "new": "    pass\n",
     "tests": [T + "test_a_damaged_entry_is_a_miss_recorded_and_discarded_never_served[stale_is_not_a_verdict]"]},

    # ── the volume's own LRU, by BYTES ─────────────────────────────────────
    {"name": "B47 the volume evicts the NEWEST entry", "file": CACHE,
     "old": "            victim = min(self._index.items(), key=lambda kv: (kv[1][1], kv[0]))[0]\n",
     "new": "            victim = max(self._index.items(), key=lambda kv: (kv[1][1], kv[0]))[0]\n",
     "tests": [T + "test_l2_evicts_by_bytes_oldest_stored_at_first"]},
    {"name": "B48 the volume's tie-break is dropped, so a dead pod's scan order decides", "file": CACHE,
     "old": "            victim = min(self._index.items(), key=lambda kv: (kv[1][1], kv[0]))[0]\n",
     "new": "            victim = min(self._index.items(), key=lambda kv: kv[1][1])[0]\n",
     "tests": [T + "test_the_l2_tie_break_is_the_fingerprint_not_the_order_a_dead_pod_left_behind"]},
    {"name": "B49 the volume's byte cap is not enforced", "file": CACHE,
     "old": "        while self._index and self._bytes > self._max_bytes:\n", "new": "        while False:\n",
     "tests": [T + "test_l2_evicts_by_bytes_oldest_stored_at_first",
               T + "test_an_l2_eviction_does_not_evict_l1"]},
    {"name": "B50 an oversized artifact empties the volume for room it will still not fit in",
     "file": CACHE,
     "old": "        if len(blob) > self._max_bytes:\n", "new": "        if False:\n",
     "tests": [T + "test_an_artifact_larger_than_the_volume_cap_is_refused_and_evicts_nothing"]},

    # ── the wiring: two caps, two names; a root a sandbox can move ─────────
    {"name": "B51 the heap cap reads the VOLUME's env name again (512 MiB of heap on an OOM pod)",
     "file": CACHE,
     "old": '                              else os.environ.get("DISCORD_RENDER_CACHE_MEM_BYTES", L1_MAX_BYTES_DEFAULT))\n',
     "new": '                              else os.environ.get("DISCORD_RENDER_CACHE_BYTES", L1_MAX_BYTES_DEFAULT))\n',
     "tests": [T + "test_the_two_byte_caps_have_two_names_and_one_cannot_move_the_other"]},
    {"name": "B52 the volume root stops reading its env var (no sandbox can move it off /data)",
     "file": CACHE,
     "old": '    return str(os.environ.get("DISCORD_RENDER_CACHE_DIR", "/data/discord_render_cache")).strip()\n',
     "new": '    return "/data/discord_render_cache"\n',
     "tests": [T + "test_the_l2_root_is_env_derived_with_a_data_default"]},
    {"name": "B53 constructing the cache creates its directory under the shared data root",
     "file": CACHE,
     "old": "        self._root = str(root)\n",
     "new": "        self._root = str(root)\n        os.makedirs(self._root, exist_ok=True)\n",
     "tests": [T + "test_constructing_a_cache_touches_no_filesystem"]},
    {"name": "B54 clear() deletes the durable copies too (a stop becomes a delete)", "file": CACHE,
     "old": "        if l2 and self._l2 is not None:\n", "new": "        if self._l2 is not None:\n",
     "tests": [T + "test_clear_is_not_a_delete_against_durable_data_unless_asked"]},

    # ── the kill switch; one store ─────────────────────────────────────────
    {"name": "B55 the kill switch is captured at import (rollback needs a redeploy)", "file": CACHE,
     "prelude": ('_UNKNOWN_VINTAGE = "\\x00unknown"\n',
                 '_UNKNOWN_VINTAGE = "\\x00unknown"\n_ENABLED_AT_IMPORT = False\n'),
     "old": '    return str(os.environ.get("RENDER_CACHE_ENABLED", "")).strip().lower() in ("1", "true", "yes", "on")\n',
     "new": "    return _ENABLED_AT_IMPORT\n",
     "tests": [T + "test_the_kill_switch_is_read_per_call_so_it_needs_no_redeploy"]},
    {"name": "B56 every caller gets its own store (two half-useful hit rates)", "file": CACHE,
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
