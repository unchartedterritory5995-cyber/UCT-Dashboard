import json, sys
C = 'api/services/pine_runtime_client.py'
L = 'api/services/runtime_server_lane.py'
src = {C: open(C, encoding='utf-8').read(), L: open(L, encoding='utf-8').read()}
M = []


def m(name, f, old, new):
    assert src[f].count(old) == 1, (name, src[f].count(old))
    M.append([name, f, old, new])


m("CONTROL r1 no-op comment", C, "# --- the client ---", "# --- the client (control) ---")
m("W01 warmup not a result key", C, '"instructions",\n                          "warmup"})', '"instructions"})')
m("W02 warmup extra/other keys admitted", C, "if not isinstance(w, dict) or set(w) != _WARMUP_KEYS:", "if not isinstance(w, dict):")
m("W03 warmup not required", C, "if not isinstance(w, dict) or set(w) != _WARMUP_KEYS:", "if w is not None and set(w) != _WARMUP_KEYS:")
m("W04 bool bar count admitted", C, "if isinstance(wb, bool) or not isinstance(wb, int) or wb < 0 or wb > n:", "if not isinstance(wb, int) or wb < 0 or wb > n:")
m("W05 non-int bar count admitted", C, "if isinstance(wb, bool) or not isinstance(wb, int) or wb < 0 or wb > n:", "if isinstance(wb, bool) or (isinstance(wb, (int, float)) and (wb < 0 or wb > n)):")
m("W06 negative bar count admitted", C, "if isinstance(wb, bool) or not isinstance(wb, int) or wb < 0 or wb > n:", "if isinstance(wb, bool) or not isinstance(wb, int) or wb > n:")
m("W07 bar count past n admitted", C, "if isinstance(wb, bool) or not isinstance(wb, int) or wb < 0 or wb > n:", "if isinstance(wb, bool) or not isinstance(wb, int) or wb < 0:")
m("W08 withheld may report a warmup", C, 'if "warmup" in r:\n                raise bad', 'if False:\n                raise bad')
m("W09 warmup not carried to JobResult", C, 'digest=digest, cache=cache, warmup={"withheldBars": wb})', 'digest=digest, cache=cache, warmup=None)')
m("W10 lane column without the run's warmup", L, "return RuntimeColumn(res.columns[plot_key], res.warmup)", "return RuntimeColumn(res.columns[plot_key], {})")
m("A01 admission skips the stored verdict", L,
  "    reason = _verdict(row)\n    if reason:\n        return (VERDICT_GUARD, reason)\n    return _admission(row, lane)",
  "    return _admission(row, lane)")
m("A02 admission skips server_lane_refusal", L,
  "        return (VERDICT_GUARD, reason)\n    return _admission(row, lane)",
  "        return (VERDICT_GUARD, reason)\n    return None")
m("A03 column fn asks step 4 only, not the public chain", L,
  "        refused = admission(row, plot_key, lane)", "        refused = _admission(row, lane)")
m("A04 unnamed plot admitted", L,
  "    if not isinstance(plot_key, str) or not plot_key:\n        return (client_mod.INTEGRITY",
  "    if False:\n        return (client_mod.INTEGRITY")
m("A05 admission accepts an unknown lane", L,
  "    if lane not in client_mod.PROFILES:\n        raise ValueError(f\"lane {lane!r} is not one of {client_mod.PROFILES}\")\n    if not isinstance(plot_key",
  "    if False:\n        raise ValueError(f\"lane {lane!r} is not one of {client_mod.PROFILES}\")\n    if not isinstance(plot_key")
m("I01 +/-Infinity admitted in an ok column (ruling: integrity)", C, "if any(math.isinf(v) for v in col):", "if False:")
m("I02 only +Infinity refused", C, "if any(math.isinf(v) for v in col):", "if any(v == math.inf for v in col):")
json.dump(M, open(sys.argv[1], 'w', encoding='utf-8', newline='\n'), indent=1, ensure_ascii=True)
print(len(M))
