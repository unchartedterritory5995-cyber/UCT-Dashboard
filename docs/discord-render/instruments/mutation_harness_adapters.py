"""Mutation proofs for step 2.4b P2.1 — the provider adapters and the spine they share.

Same contract as the other harnesses: one mutation at a time, exact single replacement, EOL-aware,
byte-restore verified by sha256, never `git checkout`, control run at the end.

Each mutation below is a real defect this layer was built to close, re-introduced deliberately:
the deadline confused with a dependency timeout; the breaker skipped; the retry un-jittered; the
vintage taken from the wall clock; four causes collapsed into one.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

# ⛔ FLAGS ARE NOT PATHS. `sys.argv[1]` was taken as the repo root unconditionally, so
# `--dry-check` resolved to a directory named `--dry-check` and every mutation reported
# "file missing" — an instrument reporting a property of its own argument parsing as a property of
# the repository. The positional root is still supported; it just has to look like one.
_ARGS = [a for a in sys.argv[1:] if not a.startswith("-")]
ROOT = Path(_ARGS[0]).resolve() if _ARGS else Path(__file__).resolve().parents[3]
T = "tests/test_discord_render_adapters.py::"
TR = "tests/test_discord_render_result.py::"
CALL = "api/services/discord_render/adapters/_call.py"
BARS = "api/services/discord_render/adapters/bars.py"
FLOW = "api/services/discord_render/adapters/flow.py"
REND = "api/services/discord_render/adapters/renderer.py"
ENT = "api/services/discord_render/adapters/entity.py"
RES = "api/services/discord_render/adapters/result.py"
BIND = "api/services/discord_render/adapters/bindings.py"
CMD = "api/services/discord_render/commands.py"
RUN = "api/services/discord_render/runtime.py"
SW = "api/services/discord_render/adapters/switch.py"
OBS = "api/services/discord_render/observe.py"
B = "tests/test_discord_render_adapter_boundary.py::"
BA = "tests/test_discord_render_breaker_alerts.py::"
LW = "api/services/discord_render/loopwatch.py"
LT = "tests/test_discord_render_loopwatch.py::"
SH = "api/services/discord_render/shadow.py"
ST = "tests/test_discord_render_shadow.py::"
RT = "api/routers/discord_interactions.py"
FT = "tests/test_discord_render_forensics.py::"
FORENSICS = "tests/test_discord_render_forensics.py"
TRT = T

MUTATIONS = [
    # ⚰️ A49-A53 RETIRED 2026-09-14, NOT DELETED FOR CONVENIENCE. They proved five properties of
    # the footer that `bindings` used to compose itself. C-06 moved that composition into
    # `badge.py`, so re-aiming them here would have made a SECOND COPY of each guard — and three
    # copies of a rule cannot be mutation-proved (`lesson_a_guard_repeated_is_a_guard_unproved`).
    #
    # ⛔ EACH RETIREMENT NAMES ITS SUCCESSOR SO A READER CAN VERIFY THE GUARD RATHER THAN TRUST
    # THIS COMMENT, and `tests/test_mutation_harness_anchors.py::test_the_retired_mutations_name_
    # _their_successors` asserts every id below really exists in the badge harness:
    #
    #   A49 a healthy delivery is stamped too        retired → covered by B3   (Lane D, 925b3e08d)
    #   A50 the badge is a second copy of the sentence retired → covered by B2   (Lane D, 925b3e08d)
    #   A51 the stamp is appended on every edit      retired → covered by B13  (Lane D, 925b3e08d)
    #   A52 the STAMP is trimmed instead of the content retired → covered by B12  (Lane D, 925b3e08d)
    #   A53 a degraded delivery loses the id         retired → covered by B5   (Lane D, 925b3e08d)
    #
    # The properties are still proved. They are proved ONCE, in the module that owns the copy.
    # ── the spine ──────────────────────────────────────────────────────────
    {"name": "A1 the dependency timeout wins over the job deadline (the 60s-behind-15s defect)",
     "file": CALL,
     "old": "    if remaining_s is None:\n        return dep_timeout_s\n    return min(dep_timeout_s, max(0.0, remaining_s))\n",
     "new": "    return dep_timeout_s\n",
     "tests": [T + "test_the_effective_timeout_is_the_smaller_of_the_two",
               T + "test_the_renderer_ceiling_is_the_spec_not_the_modules_sixty_seconds"]},
    {"name": "A2 a call with no time left is started anyway", "file": CALL,
     "old": "    if eff < MIN_USEFUL_S:\n", "new": "    if False:\n",
     "tests": [T + "test_a_call_with_no_useful_time_left_is_refused_without_touching_the_upstream"]},
    {"name": "A3 the function gets a dependency constant, not the effective budget", "file": CALL,
     "old": "    fut = pool(name).submit(fn, left)\n",
     "new": "    fut = pool(name).submit(fn, 8.0)\n",
     "tests": [T + "test_the_function_is_handed_the_effective_timeout_not_the_constant"]},
    # C-10, found by Lane E's chaos harness: the budget was computed once per CALL, so an N-attempt
    # hop could spend N x the deadline (measured 4.6 s against 2 s).
    {"name": "A76 the budget is computed once per call, so N attempts spend N budgets", "file": CALL,
     "old": "    left = budget.remaining()\n"
            "    if left < MIN_USEFUL_S:\n"
            "        raise cf.TimeoutError(f\"{name}: {left:.3f}s left of a {budget.total_s:.3f}s budget\")\n",
     "new": "    left = budget.total_s\n",
     "tests": [FT + "test_c10_the_budget_is_re_evaluated_per_attempt_not_once_per_call",
               T + "test_three_attempts_against_a_two_second_deadline_never_outlive_the_deadline",
               T + "test_the_per_attempt_budget_derivation_is_the_only_shape_the_source_allows"]},
    # ⭐ A76 proves the ARITHMETIC is load-bearing; A76b-e prove the SHAPE that keeps it
    # un-rewritable is load-bearing too. Lane C, OI-29: "the live guard was luck".
    {"name": "A76b the attempt runner is handed the once-per-call float again", "file": CALL,
     "old": "    job_budget = _Budget(eff, started, now)\n",
     "new": "    job_budget = eff\n",
     "tests": [T + "test_three_attempts_against_a_two_second_deadline_never_outlive_the_deadline",
               T + "test_the_per_attempt_budget_derivation_is_the_only_shape_the_source_allows"]},
    {"name": "A76c the retry backoff is slept on top of the budget instead of inside it", "file": CALL,
     "old": "        sleep(max(0.0, min(seconds, self.remaining())))\n",
     "new": "        sleep(seconds)\n",
     "tests": [T + "test_the_retry_backoff_is_slept_inside_the_budget_and_never_on_top_of_it",
               T + "test_three_attempts_against_a_two_second_deadline_never_outlive_the_deadline"]},
    {"name": "A76d the wait on the future outlives the budget the upstream was given", "file": CALL,
     "old": "        return fut.result(timeout=left)\n",
     "new": "        return fut.result(timeout=budget.total_s)\n",
     "tests": [T + "test_the_per_attempt_budget_derivation_is_the_only_shape_the_source_allows"]},
    # ⛔ A76e mutates LANE E's forensics file, which this lane does not edit in the repo. The harness
    # writes it, runs, then restores the bytes captured first with a sha256 check in a `finally`;
    # nothing of it is ever committed, and `git status` is clean after a run. Without it the
    # permanence rail is a gate nobody has seen fire (`lesson_gate_that_cannot_fail`).
    {"name": "A76e Lane E's own C-10 guard is defanged back to an xfail", "file": FORENSICS,
     "old": "def test_c10_the_budget_is_re_evaluated_per_attempt_not_once_per_call():\n",
     "new": "@pytest.mark.xfail(reason=\"MUTANT\")\n"
            "def test_c10_the_budget_is_re_evaluated_per_attempt_not_once_per_call():\n",
     "tests": [T + "test_lane_es_own_c10_guard_is_still_in_the_suite_and_still_armed"]},
    {"name": "A4 the breaker is bypassed", "file": CALL,
     "old": "        value = breakers.call(name, lambda: _attempt(name, fn, job_budget),\n",
     "new": "        value = _attempt(name, fn, job_budget)\n        _bypassed = dict(\n",
     "tests": [T + "test_an_open_breaker_refuses_without_calling_the_dependency",
               T + "test_the_renderer_breaker_finally_has_a_caller"]},
    # ⚠️ Re-indented when `_once` became the module-level `_attempt` (Lane C, OI-29). A stale `old`
    # here does not fail — it reports NOT APPLIED, which reads as a line in a long report rather
    # than as a hole in the coverage. Read the NOT-APPLIED count, never just the RED count.
    {"name": "A5 abandoned calls are not counted", "file": CALL,
     "old": "        with _POOL_LOCK:\n            _ABANDONED[name] = _ABANDONED.get(name, 0) + 1\n",
     "new": "        pass\n",
     "tests": [T + "test_an_abandoned_call_is_reported_separately_from_a_failure"]},
    {"name": "A6 one pool for every dependency (C-02 restored)", "file": CALL,
     "old": "            p = cf.ThreadPoolExecutor(max_workers=POOL_SIZE.get(name, DEFAULT_POOL_SIZE),\n"
            "                                      thread_name_prefix=f\"drender-{name}\")\n",
     "new": "            p = _POOLS.get(\"shared\") or cf.ThreadPoolExecutor(max_workers=4)\n"
            "            _POOLS[\"shared\"] = p\n",
     "tests": [T + "test_each_dependency_gets_its_own_bounded_pool"]},
    {"name": "A7 a client timeout is classed as a transport error", "file": CALL,
     "old": "    except (cf.TimeoutError, *timeout_on) as e:\n", "new": "    except cf.TimeoutError as e:\n",
     "tests": [T + "test_the_four_flow_causes_do_not_collapse_into_one_sentence",
               T + "test_a_timeout_does_not_start_the_slower_leg"]},
    {"name": "A8 an upstream error is swallowed into a None", "file": CALL,
     "old": "    except Exception as e:  # noqa: BLE001 — named, not swallowed: the class reaches the member\n",
     "new": "    except (Exception, BaseException) as e:  # noqa: BLE001\n",
     "tests": [T + "test_a_BASE_exception_still_propagates_and_that_is_deliberate"]},

    # ── the envelope ───────────────────────────────────────────────────────
    {"name": "A9 unknown vintage reads as fresh", "file": RES,
     "old": "        return self.envelope.stale if self.envelope else None\n",
     "new": "        return self.envelope.stale if self.envelope else False\n",
     "tests": [TR + "test_no_envelope_at_all_reports_nothing_rather_than_guessing",
               T + "test_a_render_with_no_known_vintage_reports_unknown_not_fresh"]},
    {"name": "A10 an unnamed failure class is accepted", "file": RES,
     "old": "    if reason not in ALL_REASONS:\n        raise ValueError(f\"{reason!r} is not in the failure taxonomy; add it beside its §3.5 copy\")\n",
     "new": "    pass\n",
     "tests": [TR + "test_an_unnamed_failure_is_refused"]},
    {"name": "A11 a stale label may contradict the stamp", "file": RES,
     "old": "    if STALE in reasons and verdict is not True:\n", "new": "    if False:\n",
     "tests": [TR + "test_a_stale_label_that_contradicts_the_stamp_is_refused"]},
    {"name": "A12 an unknown vintage vanishes from the event line", "file": RES,
     "old": '            "stale": "unknown" if (self.envelope is not None and self.stale is None) else self.stale,\n',
     "new": '            "stale": self.stale,\n',
     "tests": [TR + "test_an_unknown_vintage_logs_as_unknown_rather_than_vanishing"]},
    {"name": "A13 the payload reaches the log line", "file": RES,
     "old": '        out.update({k: v for k, v in self.meta.items() if k not in out})\n',
     "new": '        out.update({k: v for k, v in self.meta.items() if k not in out})\n        out["data"] = self.data\n',
     "tests": [TR + "test_the_event_never_carries_the_payload"]},

    # ── bars ───────────────────────────────────────────────────────────────
    {"name": "A14 the vintage is the wall clock, not the newest bar", "file": BARS,
     "old": "              envelope=envelope(bars[-1][\"t\"], tf=req.tf, provider=provider),\n",
     "new": "              envelope=envelope(None, tf=req.tf, provider=provider),\n",
     "tests": [T + "test_bars_come_back_with_a_vintage_derived_from_the_newest_bar",
               T + "test_a_stale_vintage_labels_itself_without_anybody_asking"]},
    {"name": "A15 an empty answer is reported as an error", "file": BARS,
     "old": "    if bars is None or bars == []:\n", "new": "    if False:\n",
     "tests": [T + "test_an_empty_answer_is_EMPTY_and_not_an_error"]},
    {"name": "A16 a payload we cannot read is passed through", "file": BARS,
     "old": '    if not isinstance(bars, list) or not isinstance(bars[-1], dict) or "t" not in bars[-1]:\n',
     "new": "    if False:\n",
     "tests": [T + "test_a_payload_we_cannot_read_is_BAD_SHAPE_rather_than_a_traceback"]},
    {"name": "A17 no retry at all (a transient bars failure is final)", "file": BARS,
     "old": "ATTEMPTS = 2\n", "new": "ATTEMPTS = 1\n",
     "tests": [T + "test_the_bars_adapter_retries_a_transient_failure_once",
               T + "test_a_bars_failure_that_survives_every_attempt_is_one_breaker_failure"]},

    # ── renderer ───────────────────────────────────────────────────────────
    {"name": "A18 the renderer keeps its 60-second ceiling", "file": REND,
     "old": "TIMEOUT_S = 20.0\n", "new": "TIMEOUT_S = 60.0\n",
     "tests": [T + "test_the_renderer_ceiling_is_the_spec_not_the_modules_sixty_seconds"]},
    {"name": "A19 a render claims to be as new as the request", "file": REND,
     "old": "              envelope=req.envelope, bytes_len=len(png), ticker=req.ticker, tf=req.tf)\n",
     "new": "              envelope=None, bytes_len=len(png), ticker=req.ticker, tf=req.tf)\n",
     "tests": [T + "test_a_render_carries_the_DATA_vintage_through_rather_than_claiming_to_be_new"]},
    {"name": "A20 a non-PNG body is delivered as a chart", "file": REND,
     "old": "    if not isinstance(png, (bytes, bytearray)) or not bytes(png).startswith(PNG_MAGIC):\n",
     "new": "    if False:\n",
     "tests": [T + "test_a_body_that_is_not_a_png_is_BAD_SHAPE"]},

    # ── flow ───────────────────────────────────────────────────────────────
    {"name": "A21 the vintage is query_date (the wall clock) again", "file": FLOW,
     "old": '    end = ((data.get("window") or {}) if isinstance(data, dict) else {}).get("end")\n',
     "new": '    end = data.get("query_date") if isinstance(data, dict) else None\n',
     "tests": [T + "test_flow_is_stamped_with_the_window_end_not_the_query_date"]},
    {"name": "A22 an answered refusal is reported as unreachable (C-08 restored)", "file": FLOW,
     "old": '    if not data.get("ok"):\n', "new": "    if False:\n",
     "tests": [T + "test_the_four_flow_causes_do_not_collapse_into_one_sentence"]},
    {"name": "A23 an empty tape is reported as a failure", "file": FLOW,
     "old": "    return ok(data, provider=provider, corr_id=req.corr_id, elapsed_ms=elapsed_ms,\n",
     "new": '    if not (data.get("contracts") or []):\n'
            "        return fail(EMPTY, provider=provider, corr_id=req.corr_id, elapsed_ms=elapsed_ms)\n"
            "    return ok(data, provider=provider, corr_id=req.corr_id, elapsed_ms=elapsed_ms,\n",
     "tests": [T + "test_an_empty_tape_is_a_successful_answer_and_not_a_failure"]},
    {"name": "A36 unreachable is merged back into upstream_error (C-08's own shape)", "file": CALL,
     "old": "    except unreachable_on as e:\n", "new": "    except () as e:\n",
     "tests": [T + "test_the_four_flow_causes_do_not_collapse_into_one_sentence",
               T + "test_a_transport_failure_falls_back_in_process_and_says_that_it_did"]},
    {"name": "A37 the adapter declares no unreachable exceptions", "file": FLOW,
     "old": "        return (httpx.TransportError, ConnectionError, LookupError)\n",
     "new": "        return ()\n",
     "tests": [T + "test_the_four_flow_causes_do_not_collapse_into_one_sentence"]},
    {"name": "A38 a 5xx answer restarts the slower leg", "file": FLOW,
     "old": "    if remote_failure.reason() not in (UNREACHABLE, BREAKER_OPEN):\n",
     "new": "    if remote_failure.reason() not in (UNREACHABLE, BREAKER_OPEN, UPSTREAM_ERROR):\n",
     "tests": [T + "test_a_5xx_does_not_restart_the_slower_leg_either"]},
    {"name": "A39 the flow wrapper stops correcting the router's generic class", "file": BIND,
     "old": "        if r is not None and not r.ok:\n", "new": "        if False:\n",
     "tests": [T + "test_the_flow_binding_corrects_the_routers_generic_class_to_what_was_observed"]},
    {"name": "A40 the flow handler stops handing over the adapter", "file": CMD,
     "old": '        extra = {"fetch_fn": bindings.flow_fetch_fn(ctx, source=source),\n'
            '                 "fail_fn": bindings.flow_fail_fn(ctx)}\n',
     "new": "        extra = {}\n",
     "tests": [T + "test_the_kill_switch_also_takes_the_flow_handler_back_to_the_routers_own_fetch"]},
    {"name": "A41 the kill switch is ignored (no way back without a deploy)", "file": BIND,
     "old": "    if not adapters_enabled():\n        from api.routers.discord_interactions import fetch_bars\n        return fetch_bars\n",
     "new": "    if False:\n        from api.routers.discord_interactions import fetch_bars\n        return fetch_bars\n",
     "tests": [T + "test_the_kill_switch_hands_back_the_raw_function"]},
    {"name": "A42 the switch is captured at import instead of read per call", "file": SW,
     "old": '    return str(os.environ.get(ENV, "")).strip().lower() not in OFF_VALUES\n',
     "new": "    return _AT_IMPORT\n",
     "prelude": ('ENV = "DISCORD_RENDER_V2_ADAPTERS_ENABLED"\n',
                 'ENV = "DISCORD_RENDER_V2_ADAPTERS_ENABLED"\n'
                 '_AT_IMPORT = str(os.environ.get("DISCORD_RENDER_V2_ADAPTERS_ENABLED", "")).strip().lower() not in {"0", "false", "no", "off"}\n'),
     "tests": [B + "test_the_switch_is_read_per_call_and_not_captured_at_import"]},
    {"name": "A24 the fallback runs unconditionally", "file": FLOW,
     "old": "    if not _local_is_worth_trying(remote_failure, req):\n        return remote_failure\n",
     "new": "    if False:\n        return remote_failure\n",
     "tests": [T + "test_a_timeout_does_not_start_the_slower_leg",
               T + "test_an_answered_refusal_does_not_ask_a_second_source_for_a_different_answer",
               T + "test_the_fallback_needs_enough_budget_left_to_finish"]},
    {"name": "A25 a served fallback is presented as a clean delivery", "file": FLOW,
     "old": "    return done.with_reason(*remote_failure.degraded_reasons) if done.ok else done\n",
     "new": "    return done\n",
     "tests": [T + "test_a_transport_failure_falls_back_in_process_and_says_that_it_did"]},
    {"name": "A26 both legs failing reports the local class", "file": FLOW,
     "old": "        return remote_failure\n    data, local_ms = local_outcome\n",
     "new": "        return local_outcome\n    data, local_ms = local_outcome\n",
     "tests": [T + "test_when_both_legs_fail_the_remote_class_is_the_one_reported"]},

    # ── entity ─────────────────────────────────────────────────────────────
    {"name": "A27 a timed-out symbol check refuses the member", "file": ENT,
     "old": "        return ok(symbols.Resolution(req.ticker.strip().upper(), symbols.UNANSWERABLE),\n"
            "                  provider=NAME, corr_id=req.corr_id, elapsed_ms=outcome.elapsed_ms,\n"
            "                  why=outcome.reason())\n",
     "new": "        return outcome\n",
     "tests": [T + "test_a_timed_out_symbol_check_also_fails_open"]},
    # ── the wiring: built-tested-green-and-unwired is this programme's costliest shape ──────
    # ⚠️ STALE SINCE P2.6/P2.7 AND FOUND ONLY BY READING THE NOT-APPLIED LINE (Lane C, OI-29).
    # `edit_fn=ctx.edit` became `edit_fn=bindings.edit_fn(ctx)` when the stamp landed, and the
    # `return dict(...)` line re-wrapped; the mutation has been reporting NOT APPLIED (0 matches)
    # ever since, so this proof has not run for several merges. It is now anchored on the
    # `context_fn` line, which exists ONLY in `_chart_kwargs` — `_multi_kwargs` is otherwise
    # near-identical, and a pattern matching both would report NOT APPLIED (2 matches) instead.
    {"name": "A29 the chart handler goes back to the raw client", "file": CMD,
     "old": "    return dict(bars_fn=bindings.bars_fn(ctx), render_fn=render_chart_png,\n"
            "                edit_fn=bindings.edit_fn(ctx),\n"
            "                house_fn=bindings.house_fn(ctx) if house.house_enabled() else None,\n"
            "                quote_fn=bindings.quote_fn(ctx),\n"
            "                context_fn=chart_context.context_line if chart_context.enabled() else None,\n",
     "new": "    from api.routers import discord_interactions as router\n"
            "    return dict(bars_fn=router.fetch_bars, render_fn=render_chart_png,\n"
            "                edit_fn=ctx.edit,\n"
            "                house_fn=house.render_house_chart if house.house_enabled() else None,\n"
            "                quote_fn=router.fetch_ext_quote,\n"
            "                context_fn=chart_context.context_line if chart_context.enabled() else None,\n",
     "tests": [T + "test_the_v2_handlers_bind_adapters_and_not_the_raw_clients",
               T + "test_commands_no_longer_names_a_raw_upstream_function"]},
    {"name": "A30 a context that cannot say its budget is given 'plenty'", "file": BIND,
     "old": "        return float(fn()) if callable(fn) else None\n",
     "new": "        return float(fn()) if callable(fn) else 15.0\n",
     "tests": [T + "test_a_context_that_cannot_say_how_long_is_left_reports_None_rather_than_plenty"]},
    {"name": "A31 the reason is thrown away again (nothing recorded)", "file": BIND,
     "old": "    with _LOCK:\n        store = getattr(ctx, _ATTR, None)\n",
     "new": "    if True:\n        return result\n    with _LOCK:\n        store = getattr(ctx, _ATTR, None)\n",
     "tests": [T + "test_a_binding_returns_the_shape_produce_chart_expects_and_keeps_the_reason",
               T + "test_the_v2_handlers_bind_adapters_and_not_the_raw_clients"]},
    {"name": "A32 the render is not stamped with the bars it drew", "file": BIND,
     # ⚰️ RE-ANCHORED 2026-09-14. OI-29 made `attempts=1` explicit at this binding site, which moved
     # the closing paren onto a later line and left this mutation matching NOTHING — reported as
     # `NOT APPLIED (0 matches)`, i.e. a proof that did not happen, inside a run that printed 73/80.
     # ⚰️ RE-ANCHORED TWICE IN ONE DAY, BY THE SAME PERSON WHO ADDED THE NEXT GUARD. OI-29 moved
     # the closing paren; Gap 1's cache wiring then hoisted the envelope into a local and left
     # `envelope=envelope,` at the call site. ⭐ Both times it was caught by `--dry-check` in the
     # gate rather than at the end of a 25-minute run — which is the whole argument for the gate.
     "old": "                envelope=envelope,\n",
     "new": "                envelope=None,\n",
     "tests": [T + "test_the_render_is_stamped_with_the_vintage_of_the_bars_it_drew"]},
    {"name": "A33 a failed fetch is handed on as if it worked", "file": BIND,
     # ⚰️ RE-ANCHORED 2026-09-14. `attempts=1)))` used to appear ONCE; OI-29 states the attempt
     # count at every binding site, so the old anchor matched THREE places and reported
     # `NOT APPLIED (2 matches)`. ⭐ A multi-match is the safer failure — it refuses rather than
     # mutating an arbitrary one of them — but it is still a proof that did not happen. The anchor
     # now includes the comment line unique to `bars_fn`.
     "old": "            # fetches per chart and sleep ~2.9 s inside a 15 s deadline.\n"
            "            attempts=1)))\n        return r.data if r.ok else None\n",
     "new": "            # fetches per chart and sleep ~2.9 s inside a 15 s deadline.\n"
            "            attempts=1)))\n        return r.data\n",
     "tests": [T + "test_a_failed_result_that_still_carries_data_is_not_handed_on_as_if_it_worked"]},
    {"name": "A34 the job's remaining time is not passed down", "file": BIND,
     "old": "            ticker=ticker, tf=tf, n=n, corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx),\n",
     "new": "            ticker=ticker, tf=tf, n=n, corr_id=ctx.job.corr_id, remaining_s=None,\n",
     "tests": [T + "test_a_binding_passes_the_jobs_remaining_time_down_to_the_adapter"]},
    {"name": "A35 the deadline is measured from the worker, not the ack", "file": RUN,
     "old": "        return max(0.0, self.deadline_s - ((now if now is not None else time.time()) - self.created_at))\n",
     "new": "        return max(0.0, self.deadline_s)\n",
     "tests": [TRT + "test_the_remaining_budget_counts_down_from_the_ack"]},

    # ── P2.10: shadow mode ─────────────────────────────────────────────────
    {"name": "A62 the shadow turns itself on everywhere it merges", "file": SH,
     "old": '    return str(os.environ.get(ENV, "")).strip().lower() in ("1", "true", "yes", "on")\n',
     "new": '    return str(os.environ.get(ENV, "")).strip().lower() not in ("0", "false", "no", "off")\n',
     "tests": [ST + "test_it_is_OFF_unless_explicitly_turned_on"]},
    {"name": "A63 an unanswerable verdict is counted as a divergence", "file": SH,
     "old": "    refused = [v.symbol for v in verdicts if getattr(v, \"status\", None) == symbols.UNKNOWN]\n",
     "new": "    refused = [v.symbol for v in verdicts if getattr(v, \"status\", None) != symbols.KNOWN]\n",
     "tests": [ST + "test_an_unanswerable_verdict_is_not_a_divergence_either"]},
    {"name": "A64 a refusal against a non-defer counts as a divergence", "file": SH,
     "old": '    out["divergence"] = bool(refused) and (pre_v2_reply or {}).get("type") in (5, 6)\n',
     "new": '    out["divergence"] = bool(refused)\n',
     "tests": [ST + "test_a_reply_that_was_not_a_defer_is_not_a_divergence"]},
    {"name": "A65 the shadow ignores its own budget", "file": SH,
     "old": "            if (now() - started) > SHADOW_BUDGET_S:\n", "new": "            if False:\n",
     "tests": [ST + "test_past_its_own_budget_it_stops_rather_than_making_anyone_wait"]},
    {"name": "A66 a failing authority breaks the shadow instead of the sample", "file": SH,
     "old": "            except Exception as e:  # noqa: BLE001 — a shadow must never affect the request it shadows\n",
     "new": "            except ValueError as e:\n",
     "tests": [ST + "test_a_resolver_that_raises_is_a_missing_sample_not_an_exception"]},
    {"name": "A67 the shadow can break the request it shadows", "file": RT,
     "old": "    except Exception:  # noqa: BLE001 — a shadow that can break the request it shadows is worse than none\n"
            "        pass\n",
     "new": "    except ValueError:\n        pass\n",
     "tests": [ST + "test_the_route_still_returns_the_dispatchers_reply_unchanged"]},
    {"name": "A73 the record reaches the log empty (fields outside the allowlist)", "file": SH,
     "old": '    observe.event("shadow", cmd=command, ms=out["ms"], outcome=outcome(out), detail=detail(out))\n',
     "new": '    observe.event("shadow", **{k: v for k, v in out.items() if v is not None})\n',
     "tests": [ST + "test_the_record_actually_reaches_the_log_line",
               ST + "test_every_field_the_shadow_emits_is_inside_the_allowlist"]},
    {"name": "A74 the shadow gives up sooner than the path it models", "file": SH,
     "old": "SHADOW_BUDGET_S = 0.6\n", "new": "SHADOW_BUDGET_S = 0.4\n",
     "tests": [ST + "test_the_shadow_is_never_stricter_than_the_path_it_models"]},
    {"name": "A75 could-not-tell is reported as agreement", "file": SH,
     "old": '    if rec.get("unanswerable"):\n        return "could_not_tell"\n',
     "new": '    if False:\n        return "could_not_tell"\n',
     "tests": [ST + "test_the_emitted_outcome_word_separates_all_three_answers"]},
    {"name": "A70 a divergence of zero becomes uninterpretable again", "file": SH,
     "old": '    out["unanswerable"] = ",".join(unanswerable) if unanswerable else None\n',
     "new": "    pass\n",
     "tests": [ST + "test_the_record_separates_could_not_tell_from_agreed"]},
    {"name": "A71 the record stops saying whether the authorities could answer", "file": SH,
     "old": '    out["index_ready"] = _index_ready()\n', "new": "    pass\n",
     "tests": [ST + "test_the_record_says_whether_the_authorities_could_answer_at_all"]},
    {"name": "A72 an unaskable authority reports False instead of None", "file": SH,
     "old": "    except Exception:  # noqa: BLE001\n        return None\n\n\ndef _tickers",
     "new": "    except Exception:  # noqa: BLE001\n        return False\n\n\ndef _tickers",
     "tests": [ST + "test_an_authority_that_cannot_be_asked_reports_None_not_False"]},
    {"name": "A68 a shadow failing on every request leaves no trace", "file": SH,
     "old": '        observe.event("shadow", outcome="error", detail=type(e).__name__)\n',
     "new": "        pass\n",
     "tests": [ST + "test_the_work_on_the_pool_thread_reports_its_own_failure"]},
    {"name": "A69 the route submits the bare function, bypassing the report", "file": RT,
     "old": "            _shadow_pool.submit(_shadow.run_safely, seen,\n",
     "new": "            _shadow_pool.submit(_shadow.observe_ack, seen,\n",
     "tests": [ST + "test_the_route_submits_the_reporting_wrapper_not_the_bare_function"]},

    # ── P2.9: the event-loop stall probe ───────────────────────────────────
    {"name": "A56 an unrun probe reads as a healthy loop", "file": LW,
     "old": '            return {"running": self._task is not None, "samples": 0, "max_ms": None,\n'
            '                    "p95_ms": None, "stalls": None}\n',
     "new": '            return {"running": self._task is not None, "samples": 0, "max_ms": 0.0,\n'
            '                    "p95_ms": 0.0, "stalls": 0}\n',
     "tests": [LT + "test_a_probe_that_never_ran_is_not_reported_as_healthy"]},
    {"name": "A57 the worst reading is replaced by the average", "file": LW,
     "old": '        return {"running": self._task is not None, "samples": n,\n'
            '                "max_ms": round(ordered[-1], 1), "p95_ms": round(ordered[idx], 1),\n',
     "new": '        return {"running": self._task is not None, "samples": n,\n'
            '                "max_ms": round(sum(ordered) / n, 1), "p95_ms": round(ordered[idx], 1),\n',
     "tests": [LT + "test_the_snapshot_reports_the_worst_reading_not_the_average",
               LT + "test_it_really_measures_a_real_blocked_loop"]},
    {"name": "A58 a backwards clock is discarded, shrinking the denominator", "file": LW,
     "old": "        self.samples.append(max(0.0, overshoot_ms))\n",
     "new": "        if overshoot_ms < 0:\n            return\n        self.samples.append(overshoot_ms)\n",
     "tests": [LT + "test_a_clock_that_runs_backwards_is_clamped_and_still_counted"]},
    {"name": "A59 a stalled loop pages nobody", "file": OBS,
     "old": '    alerts += _loop_alerts(snapshot.get("loop"))\n', "new": "",
     "tests": [LT + "test_the_health_payload_and_the_observer_both_carry_the_loop_reading"]},
    {"name": "A60 the stall threshold is set past the Discord budget", "file": OBS,
     "old": "LOOP_STALL_ALERT_MS = 1000.0\n", "new": "LOOP_STALL_ALERT_MS = 4000.0\n",
     "tests": [LT + "test_the_threshold_is_a_fraction_of_the_discord_budget"]},
    {"name": "A61 the probe starts in the worker thread, attaching to no loop", "file": LW,
     "old": "            try:\n                asyncio.get_running_loop()\n            except RuntimeError:\n                return self\n",
     "new": "            pass\n",
     "tests": [LT + "test_starting_it_off_the_loop_reports_not_running_rather_than_raising"]},

    # ── P2.6/P2.7: the stamp reaches the member ────────────────────────────
    {"name": "A54 an edit with no content grows one", "file": BIND,
     "old": "        if \"content\" in kw:\n", "new": "        if True:\n",
     "tests": [T + "test_the_edit_wrapper_stamps_every_path_the_render_function_can_take"]},
    {"name": "A55 the chart handler edits without the stamp", "file": CMD,
     "old": "                edit_fn=bindings.edit_fn(ctx),\n                house_fn=bindings.house_fn(ctx) if house.house_enabled() else None,\n"
            "                quote_fn=bindings.quote_fn(ctx),\n                context_fn=chart_context.context_line if chart_context.enabled() else None,\n",
     "new": "                edit_fn=ctx.edit,\n                house_fn=bindings.house_fn(ctx) if house.house_enabled() else None,\n"
            "                quote_fn=bindings.quote_fn(ctx),\n                context_fn=chart_context.context_line if chart_context.enabled() else None,\n",
     "tests": [T + "test_the_v2_handlers_bind_adapters_and_not_the_raw_clients",
               T + "test_every_v2_handler_stamps_its_edits"]},

    # ── P2.4: a tripped breaker reaches #render-alerts ─────────────────────
    {"name": "A43 a tripped breaker pages nobody", "file": OBS,
     "old": "    alerts += _breaker_alerts(breakers)\n", "new": "",
     "tests": [BA + "test_an_open_breaker_raises_an_alert_naming_the_dependency",
               BA + "test_each_dependency_gets_its_own_alert_key_so_they_throttle_separately"]},
    {"name": "A44 one shared key, so one outage silences the next", "file": OBS,
     "old": '        out.append((f"breaker_open:{name}",\n', "new": '        out.append(("breaker_open",\n',
     "tests": [BA + "test_each_dependency_gets_its_own_alert_key_so_they_throttle_separately"]},
    {"name": "A45 a recovering breaker pages too", "file": OBS,
     "old": '        if (b or {}).get("state") != "open":\n',
     "new": '        if (b or {}).get("state") == "closed":\n',
     "tests": [BA + "test_a_recovering_breaker_is_not_an_alert"]},
    {"name": "A46 /renderhealth defaults to no breakers (a proxy reading zero)", "file": OBS,
     "old": '        "breakers": breakers if breakers is not None else _live_breakers(),\n',
     "new": '        "breakers": breakers if breakers is not None else {},\n',
     "tests": [BA + "test_the_health_payload_reads_the_live_breakers_when_nobody_passes_any"]},
    {"name": "A47 the observer stops feeding the rule (built, tested, unwired)", "file": OBS,
     "old": "        for key, msg in evaluate_alerts(snap, renderer_misses=self.renderer_misses,\n"
            "                                        breakers=_live_breakers()):\n",
     "new": "        for key, msg in evaluate_alerts(snap, renderer_misses=self.renderer_misses):\n",
     "tests": [BA + "test_the_observer_passes_the_live_breaker_snapshot"]},
    {"name": "A48 the alert stops saying it will repeat (silence reads as broken)", "file": OBS,
     "old": '                    " This repeats while it stays open — silence means it closed."))\n',
     "new": '                    ""))\n',
     "tests": [BA + "test_the_message_says_it_will_repeat_rather_than_promising_a_recovery_note"]},

    {"name": "A28 UNANSWERABLE is treated as a refusal", "file": ENT,
     "old": "    if getattr(res, \"status\", None) == symbols.UNKNOWN:\n",
     "new": "    if getattr(res, \"status\", None) != symbols.KNOWN:\n",
     "tests": [T + "test_an_unanswerable_verdict_fails_OPEN_and_stays_a_success"]},
]


def read(p):
    return p.read_bytes()


def run(tests):
    cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:randomly", "-x", *tests]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=900)
    out = r.stdout + r.stderr
    m = re.search(r"(\d+) passed|(\d+) failed|(\d+) error", out)
    if not m:
        return "NO TOTALS LINE", out[-400:]
    if r.returncode == 0:
        return "GREEN", out.strip().splitlines()[-1][:120]
    return "RED", out.strip().splitlines()[-1][:120]


def dry_check() -> int:
    """Does every mutation still find its anchor, exactly once? One second, no tests run.

    ⛔⛔ RUN THIS BEFORE COMMITTING TO A TWENTY-FIVE MINUTE SET. A stale anchor is a proof that did
    not happen, and it is currently discovered at the END of the run, printed under the number
    people quote — `73/80 RED` reads like a near-perfect score. ⚰️ Measured twice in two days: A29
    sat stale for several merges, and then SEVEN more went stale in one session because the
    integrator's own OI-29 patch moved the lines they anchored on. **The people most likely to
    invalidate a mutation anchor are the people adding the next guard.**

    Exit 1 on any anchor that matches anything other than exactly once."""
    bad = []
    for mut in MUTATIONS:
        path = ROOT / mut["file"]
        if not path.exists():
            bad.append((mut["name"], "file missing")); continue
        text = path.read_bytes().decode("utf-8")
        eol = "\r\n" if "\r\n" in text else "\n"
        n = text.count(mut["old"].replace("\n", eol))
        if n != 1:
            bad.append((mut["name"], f"{n} matches"))
    for name, why in bad:
        print(f"  NOT APPLIED ({why}): {name}")
    print(f"TOTALS mutation_harness_adapters --dry-check "
          f"{'PASS' if not bad else 'FAIL'} mutations={len(MUTATIONS)} stale={len(bad)}")
    return 0 if not bad else 1


def main():
    if "--dry-check" in sys.argv:
        return dry_check()
    print(f"root: {ROOT}\n")
    control_first = run([T.rstrip(":"), TR.rstrip(":"), B.rstrip(":")])
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
        # A mutation may need a second edit to be well-formed (e.g. introducing the module-level
        # capture that the mutated function then reads). Both are applied, or neither is.
        pre_old, pre_new = (mut.get("prelude") or ("", ""))
        pre_old, pre_new = pre_old.replace("\n", eol), pre_new.replace("\n", eol)
        if n != 1 or (pre_old and text.count(pre_old) != 1):
            results.append((mut["name"], f"NOT APPLIED ({n} matches)", ""))
            print(f"  {mut['name']:<70} NOT APPLIED ({n} matches)")
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
        print(f"  {mut['name']:<70} {verdict}")

    control_last = run([T.rstrip(":"), TR.rstrip(":"), B.rstrip(":")])
    print(f"\nCONTROL (after)   {control_last[0]}  {control_last[1]}")
    red = sum(1 for _, v, _ in results if v == "RED")
    # ⛔ THE NOT-APPLIED COUNT GOES ON THE SUMMARY LINE, BESIDE THE RED ONE. A mutation whose `old`
    # has gone stale runs nothing and proves nothing, and "78/80 RED" reads like a near-perfect
    # score rather than like two proofs that did not happen. A29 sat stale for several merges
    # because the only place it was reported was a footnote under the number people quote.
    na = sum(1 for _, v, _ in results if v.startswith("NOT APPLIED"))
    print(f"\n{red}/{len(results)} mutations RED, {na} NOT APPLIED (a NOT APPLIED proves nothing)")
    bad = [(n, v) for n, v, _ in results if v != "RED"]
    for n, v in bad:
        print(f"  *** {v}: {n}")
    return 0 if (not bad and control_last[0] == "GREEN") else 1


if __name__ == "__main__":
    sys.exit(main())
