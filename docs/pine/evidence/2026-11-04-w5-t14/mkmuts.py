"""mkmuts.py : regenerates muts.json and asserts every `old` occurs exactly once. Run from the repo root."""
import json
EV = 'api/services/screener/scan_evaluator.py'
SR = 'api/services/screener/scan_run.py'
RT = 'api/services/screener/scan_runtime.py'
CL = 'api/services/pine_runtime_client.py'
GATE_OLD = "if mode == NIGHTLY and not history_withheld and not runtime_withheld:"
M = [
 ("CONTROL no-op comment", EV, "# W5-T14 -- the RUNTIME document in the scan lanes", "# W5-T14 -- the RUNTIME document in the scan lanes (control)"),
 ("M01 chunk size 500 not the client's 50", EV, "_RUNTIME_CHUNK = pine_runtime_client.SWEEP_CHUNK", "_RUNTIME_CHUNK = 500"),
 ("M02 nightly profile not sweep", EV, "{NIGHTLY: \"sweep\", LIVE", "{NIGHTLY: \"on-demand\", LIVE"),
 ("M03 on-demand profile not on-demand", EV, "ON_DEMAND: \"on-demand\"}", "ON_DEMAND: \"sweep\"}"),
 ("M04 per-chunk admission not asked", EV, "        if refused is not None:\n            for sym in chunk:", "        if False:\n            for sym in chunk:"),
 ("M05 door admission not asked", EV, "    if refused is not None:\n        raise ScanRunRefused(\"not-scannable\", refused[1])", "    if False:\n        raise ScanRunRefused(\"not-scannable\", refused[1])"),
 ("M06 live mode runs a runtime doc", EV, "    if mode == LIVE:\n        raise ScanRunRefused(\n            \"cadence\",\n            \"a runtime", "    if mode == \"x\":\n        raise ScanRunRefused(\n            \"cadence\",\n            \"a runtime"),
 ("M07 withheld not counted", EV, "        guards[guard] = guards.get(guard, 0) + 1\n", "        pass\n"),
 ("M08 bar time not converted to seconds", EV, "out.append({**b, \"t\": secs})", "out.append({**b})"),
 ("M09 bars after the session not cut", EV, "seconds = _runtime_bar_seconds(bars[:index + 1])", "seconds = _runtime_bar_seconds(bars)"),
 ("M10 non 0/1 plot answers", EV, "            if odd is not None:", "            if False:"),
 ("M11 na as-of bar answers", EV, "            if math.isnan(value):", "            if False:"),
 ("M12 per-plot refusal ignored", EV, "            why = res.refusal_for(plot)\n            if why is not None:", "            why = res.refusal_for(plot)\n            if False:"),
 ("M13 receipt filed despite withheld", EV, GATE_OLD, "if mode == NIGHTLY and not history_withheld:"),
 ("M14 receipt filed in every mode", EV, GATE_OLD, "if not history_withheld and not runtime_withheld:"),
 ("M15 two plots scannable", RT, "    if len(plots) != 1:", "    if len(plots) < 1:"),
 ("M16 runtime prefix not checked", RT, "    if not handle.startswith(runtime_definitions.HASH_PREFIX):", "    if False:"),
 ("M17 row without version accepted", EV, " or row.get(\"version\") is None", ""),
 ("M18 sweep filter admits unasked", EV, "            if refused is not None:\n                not_admitted[", "            if False:\n                not_admitted["),
 ("M19 sweep filter asks the wrong lane", EV, "scan_runtime.runtime_admission(row, \"sweep\", plot)", "scan_runtime.runtime_admission(row, \"alert\", plot)"),
 ("M20 run_sweep resolve refuses runtime", EV, "    if runtime_definitions.is_runtime(definition):\n        return scan_runtime.runtime_scan_spec(definition)[\"def_hash\"]\n    return scan_definition.assert_scannable", "    if False:\n        return scan_runtime.runtime_scan_spec(definition)[\"def_hash\"]\n    return scan_definition.assert_scannable"),
 ("M21 sweep dedupe key not the runtime handle", EV, "    if runtime_definitions.is_runtime(definition):\n        return scan_runtime.runtime_scan_spec(definition)[\"def_hash\"]\n    return user_definitions.result_identity", "    if False:\n        return scan_runtime.runtime_scan_spec(definition)[\"def_hash\"]\n    return user_definitions.result_identity"),
 ("M22 live cycle does not refuse runtime in phase 1", EV, "            if runtime_definitions.is_runtime(definition):\n                # W5-T14: closed bars only", "            if False:\n                # W5-T14: closed bars only"),
 ("M23 tf gate removed", EV, "    if tf_code != DEFAULT_TF:\n        raise ScanRunRefused(\"tf\", _wrong_tf_reason(tf_code))\n    if mode == LIVE:", "    if mode == LIVE:"),
 ("M24 job ids not unique per position", EV, "job_id = f\"{start + offset}:{sym}\"", "job_id = sym"),
 ("M25 admission failure admits", RT, "    except Exception:  # noqa: BLE001 -- an admission that cannot answer admits nothing", "    except ZeroDivisionError:  # noqa: BLE001 -- an admission that cannot answer admits nothing"),
 ("M26 history gate not asked", EV, "    want = _MAX_BARS\n    history_withheld = _history_withheld(want, limits)", "    want = _MAX_BARS\n    history_withheld = False"),
 ("M27 evaluate_one never dispatches runtime", EV, "    if runtime_definitions.is_runtime(definition):\n        # W5-T14: a stored runtime document is evaluated", "    if False:\n        # W5-T14: a stored runtime document is evaluated"),
 ("M28 daily bar read as another timeframe", RT, "n % 100), \"D\")", "n % 100), \"W\")"),
 ("M29 YYYYMMDD sent as it is", RT, "    if scan_store._AS_OF_MIN <= n <= scan_store._AS_OF_MAX:", "    if False:"),
 ("M30 withheld guards not reported", EV, "\"runtime_withheld_guards\": dict(sorted(guards.items())),", "\"runtime_withheld_guards\": {},"),
 ("S01 on-demand door skips runtime admission", SR, "        if refused is not None:\n            raise RunRefused(\"gate:not-scannable\", refused[1])", "        if False:\n            raise RunRefused(\"gate:not-scannable\", refused[1])"),
 ("S02 on-demand door asks the wrong lane", SR, "scan_runtime.runtime_admission(row, \"on-demand\", plot)", "scan_runtime.runtime_admission(row, \"sweep\", plot)"),
 ("S03 refusal carries the guard word not the sentence", SR, "raise RunRefused(\"gate:not-scannable\", refused[1])", "raise RunRefused(\"gate:not-scannable\", refused[0])"),
 ("S04 submit_run still refuses runtime as kind", SR, "        if runtime_definitions.is_runtime(definition):\n            # scannability was asked once, in `_load_definition`\n            definition = scan_runtime.runtime_scan_doc(row)", "        if False:\n            # scannability was asked once, in `_load_definition`\n            definition = scan_runtime.runtime_scan_doc(row)"),
 ("N01 admission asked without the plot at the door", EV, "    refused = scan_runtime.runtime_admission(row, profile, plot)\n    if refused is not None:\n        raise", "    refused = scan_runtime.runtime_admission(row, profile, 'x')\n    if refused is not None:\n        raise"),
 ("N02 admission asked without the plot per chunk", EV, "        refused = scan_runtime.runtime_admission(row, profile, plot)\n        if refused is not None:\n            for", "        refused = scan_runtime.runtime_admission(row, profile, 'x')\n        if refused is not None:\n            for"),
 ("N03 warm-up na values counted as non-conditions", EV, "x not in (0.0, 1.0)", "x not in (0.0, 1.0) or True"),
 ("N04 na check skipped in the condition scan", EV, "next((x for x in column if not math.isnan(x) and x not in", "next((x for x in column if x not in"),
 ("T11a finite warm-up value accepted by the client (T11 check removed)", CL, "            if any(v == v for v in col[:wb]):", "            if False:"),
]
# the lane files are CRLF; mutations are matched on raw bytes, so newlines follow the file
M = [(n, f, o.replace('\n', '\r\n'), w.replace('\n', '\r\n')) for n, f, o, w in M]
json.dump(M, open('docs/pine/evidence/2026-11-04-w5-t14/muts.json', 'w'), indent=1)
for n, f, o, w in M:
    c = open(f, encoding='utf-8', newline='').read().count(o)
    assert c == 1, (n, c)
print(len(M), 'ok')
