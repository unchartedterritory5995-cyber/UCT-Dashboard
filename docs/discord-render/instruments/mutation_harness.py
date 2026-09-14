"""Mutation proofs for the Discord render rails — one mutation at a time, sequential.

For each mutation: back up the file's exact bytes, apply ONE exact replacement (must
match once, EOL-aware), run only the named tests, require a totals line and >=1 failure,
restore the backed-up bytes, and verify the sha256 matches the original. ⛔ Never
`git checkout` to restore: it would also revert uncommitted fixes in the same file.
Ends with a control run of every named test on the restored tree, which must be green.
Exit 0 only if every mutation went RED, every restore verified, and the control is green.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
CHART = "tests/test_discord_chart.py::"
HOOKS = "tests/test_discord_render_fail_hooks.py::"
CORE = "tests/test_discord_render_v2_core.py::"

MUTATIONS = [
    {"name": "M1 collapse emoji back to the bare symbol U+25B2 (C-03)",
     "file": "api/services/discord_interactions.py",
     "old": '"emoji": {"name": "\\U0001F53C"},', "new": '"emoji": {"name": "\\u25b2"},',
     "tests": [CHART + "test_chart_components_reflect_the_image_and_round_trip_through_parse_component",
               CHART + "test_the_collapse_control_survives_a_full_toggle_row",
               CHART + "test_a_posted_chart_is_one_row_and_the_gear_opens_the_rest"]},
    {"name": "M2 toggle row truncated instead of chunked",
     "file": "api/services/discord_interactions.py",
     "old": '        for i in range(0, len(row5), 5):\n            rows.append({"type": 1, "components": row5[i:i + 5]})\n',
     "new": '        rows.append({"type": 1, "components": row5[:5]})\n',
     "tests": [CHART + "test_the_collapse_control_survives_a_full_toggle_row"]},
    {"name": "M3 autocomplete stops passing type= (C-05)",
     "file": "api/routers/discord_interactions.py",
     "old": 'rows = (ts.ticker_search(q=q, limit=limit, type="") or {}).get("results") or []',
     "new": 'rows = (ts.ticker_search(q=q, limit=limit) or {}).get("results") or []',
     "tests": [CHART + "test_fetch_ticker_choices_uses_the_dashboards_search_and_never_raises"]},
    {"name": "M4 run_chart_job ignores fail_fn (per-site sentence returns)",
     "file": "api/services/discord_interactions.py",
     "old": "        elif fail_fn is not None:\n            # The V2 runtime: one contract message",
     "new": "        elif False:\n            # The V2 runtime: one contract message",
     "tests": [HOOKS + "test_no_bars_goes_to_the_contract_with_its_class"]},
    {"name": "M5 runtime stays silent when a handler delivered nothing (C-11)",
     "file": "api/services/discord_render/runtime.py",
     "old": '            told = False if cls == "ack_late" else self.send_failure(job, cls)\n',
     "new": "            told = False\n",
     "tests": [CORE + "test_C11_a_handler_that_returns_without_replying_is_not_silent",
               CORE + "test_C11_a_handler_that_raises_still_tells_the_member"]},
    {"name": "M6 heartbeat cadence back to a clock modulo",
     "file": "api/services/discord_render/runtime.py",
     "old": "        beat = now - self._last_beat >= self.heartbeat_s\n",
     "new": "        beat = int(now) % max(1, int(self.heartbeat_s)) == 0\n",
     "tests": [CORE + "test_the_heartbeat_follows_elapsed_time_not_a_modulo_of_the_clock"]},
    {"name": "M7 flow timeout classified as a generic error (C-08)",
     "file": "api/routers/discord_interactions.py",
     "old": '                    fail_cls, fail_detail = "flow_timeout", f"no answer in {timeout_s:.0f}s"\n',
     "new": '                    fail_cls, fail_detail = "flow_error", f"no answer in {timeout_s:.0f}s"\n',
     "tests": ["tests/test_discord_render_fail_hooks.py::test_C08_a_flow_transport_failure_names_its_real_cause"]},
]


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def run_tests(nodes):
    p = subprocess.run([sys.executable, "-m", "pytest", *nodes, "-q", "-p", "no:cacheprovider"],
                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = p.stdout + p.stderr
    m_failed = re.search(r"(\d+) failed", out)
    m_passed = re.search(r"(\d+) passed", out)
    totals = bool(re.search(r"=+ .*(passed|failed|error).* in [\d.]+s", out)) or bool(m_failed or m_passed)
    return p.returncode, int(m_failed.group(1)) if m_failed else 0, int(m_passed.group(1)) if m_passed else 0, totals, out


results, ok_all = [], True
for m in MUTATIONS:
    path = ROOT / m["file"]
    original = path.read_bytes()
    text = original.decode("utf-8")
    old, new = m["old"], m["new"]
    if "\r\n" in text:
        old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
    count = text.count(old)
    if count != 1:
        results.append((m["name"], f"INCONCLUSIVE: target matched {count}x"))
        ok_all = False
        continue
    try:
        path.write_bytes(text.replace(old, new).encode("utf-8"))
        rc, failed, passed, totals, out = run_tests(m["tests"])
    finally:
        path.write_bytes(original)
    restored = sha(path.read_bytes()) == sha(original)
    if not restored:
        ok_all = False
    verdict = ("RED (rail fired)" if (totals and failed >= 1) else
               "NO TOTALS LINE (not a run)" if not totals else "GREEN UNDER MUTATION (rail cannot fail)")
    if verdict != "RED (rail fired)":
        ok_all = False
    results.append((m["name"], f"{verdict} failed={failed} passed={passed} rc={rc} restored={restored}"))

all_nodes = sorted({t for m in MUTATIONS for t in m["tests"]})
rc, failed, passed, totals, out = run_tests(all_nodes)
# ⛔ passed >= len(nodes), not ==: a parametrized node id collects one test PER case (the
# flow transport test is two), so 9 ids ran 10 tests and the first run of this harness
# called a green control "NOT GREEN" on its own arithmetic.
control = totals and failed == 0 and passed >= len(all_nodes) and rc == 0
ok_all = ok_all and control

for name, verdict in results:
    print(f"{name}\n    {verdict}")
print(f"CONTROL (restored tree, {len(all_nodes)} tests): passed={passed} failed={failed} rc={rc} -> {'GREEN' if control else 'NOT GREEN'}")
sys.exit(0 if ok_all else 1)
