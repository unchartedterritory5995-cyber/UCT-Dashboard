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

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
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
TRT = T

MUTATIONS = [
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
    {"name": "A3 the function gets the constant, not the effective budget", "file": CALL,
     "old": "        fut = pool(name).submit(fn, eff)\n",
     "new": "        fut = pool(name).submit(fn, dep_timeout_s)\n",
     "tests": [T + "test_the_function_is_handed_the_effective_timeout_not_the_constant"]},
    {"name": "A4 the breaker is bypassed", "file": CALL,
     "old": "        value = breakers.call(name, _once, attempts=attempts, retry_on=retry_on, sleep=sleep)\n",
     "new": "        value = _once()\n",
     "tests": [T + "test_an_open_breaker_refuses_without_calling_the_dependency",
               T + "test_the_renderer_breaker_finally_has_a_caller"]},
    {"name": "A5 abandoned calls are not counted", "file": CALL,
     "old": "            with _POOL_LOCK:\n                _ABANDONED[name] = _ABANDONED.get(name, 0) + 1\n",
     "new": "            pass\n",
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
    {"name": "A29 the chart handler goes back to the raw client", "file": CMD,
     "old": "    return dict(bars_fn=bindings.bars_fn(ctx), render_fn=render_chart_png, edit_fn=ctx.edit,\n"
            "                house_fn=bindings.house_fn(ctx) if house.house_enabled() else None,\n"
            "                quote_fn=bindings.quote_fn(ctx),\n",
     "new": "    from api.routers import discord_interactions as router\n"
            "    return dict(bars_fn=router.fetch_bars, render_fn=render_chart_png, edit_fn=ctx.edit,\n"
            "                house_fn=house.render_house_chart if house.house_enabled() else None,\n"
            "                quote_fn=router.fetch_ext_quote,\n",
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
     "old": "            envelope=prior.envelope if prior and prior.ok else None), house_fn=inner))\n",
     "new": "            envelope=None), house_fn=inner))\n",
     "tests": [T + "test_the_render_is_stamped_with_the_vintage_of_the_bars_it_drew"]},
    {"name": "A33 a failed fetch is handed on as if it worked", "file": BIND,
     "old": "            attempts=1)))\n        return r.data if r.ok else None\n",
     "new": "            attempts=1)))\n        return r.data\n",
     "tests": [T + "test_a_failed_result_that_still_carries_data_is_not_handed_on_as_if_it_worked"]},
    {"name": "A34 the job's remaining time is not passed down", "file": BIND,
     "old": "            ticker=ticker, tf=tf, n=n, corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx),\n",
     "new": "            ticker=ticker, tf=tf, n=n, corr_id=ctx.job.corr_id, remaining_s=None,\n",
     "tests": [T + "test_a_binding_passes_the_jobs_remaining_time_down_to_the_adapter"]},
    {"name": "A35 the deadline is measured from the worker, not the ack", "file": RUN,
     "old": "        return max(0.0, self.deadline_s - ((now if now is not None else time.time()) - self.created_at))\n",
     "new": "        return max(0.0, self.deadline_s)\n",
     "tests": [TRT + "test_the_remaining_budget_counts_down_from_the_ack"]},

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


def main():
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
    print(f"\n{red}/{len(results)} mutations RED")
    bad = [(n, v) for n, v, _ in results if v != "RED"]
    for n, v in bad:
        print(f"  *** {v}: {n}")
    return 0 if (not bad and control_last[0] == "GREEN") else 1


if __name__ == "__main__":
    sys.exit(main())
