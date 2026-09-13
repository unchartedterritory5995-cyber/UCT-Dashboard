"""Mutation proofs for the V2 router / commands / lifespan rails (step 2.1b).

Same contract as mutation_harness.py: one mutation at a time, exact single replacement,
EOL-aware, byte-restore verified by sha256, never `git checkout`, control run at the end.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
R = "tests/test_discord_render_v2_router.py::"
CORE = "tests/test_discord_render_v2_core.py::"

MUTATIONS = [
    {"name": "R1 V2 reads prefs (SQLite) on the ack path",
     "file": "api/services/discord_render/commands.py",
     "old": "        try:\n            reqs = di.parse_chart_requests(interaction)          # validation only; tf defaults resolve in the worker\n",
     "new": "        router._prefs_for(di.interaction_user_id(interaction))\n        try:\n            reqs = di.parse_chart_requests(interaction)          # validation only; tf defaults resolve in the worker\n",
     "tests": [R + "test_v2_chart_is_offered_and_deferred_without_a_background_task"]},
    {"name": "R2 a queue-full refusal is not recorded (Retry would find nothing)",
     "file": "api/services/discord_render/commands.py",
     "old": '    rt.record_refused(job, "queue_full")\n', "new": "    pass\n",
     "tests": [R + "test_queue_full_is_an_immediate_honest_refusal_with_a_retry_button"]},
    {"name": "R3 lifespan no longer starts/resumes the runtime",
     "file": "api/main.py",
     "old": "            _v2_boot = await _v2_boot_aio.to_thread(_render_v2.start)\n",
     "new": '            _v2_boot = {"resumed": 0, "abandoned": 0}\n',
     "tests": [R + "test_lifespan_starts_v2_before_serving_and_releases_leases_after"]},
    {"name": "R4 the router consults V2 with the flag off",
     "file": "api/routers/discord_interactions.py",
     "old": "    if render_v2.enabled():\n        v2_response = await render_v2.handle(interaction, received)\n",
     "new": "    if True:\n        v2_response = await render_v2.handle(interaction, received)\n",
     "tests": [R + "test_flag_off_never_consults_v2"]},
    {"name": "R5 per-command kill switch ignored",
     "file": "api/services/discord_render/commands.py",
     "old": '    return os.environ.get(f"DISCORD_RENDER_V2_{name.upper()}_ENABLED", "1").strip().lower() not in _OFF\n',
     "new": "    return True\n",
     "tests": [R + "test_a_per_command_kill_switch_sends_that_command_back_to_the_old_path"]},
    {"name": "R6 autocomplete runs unbounded on the loop",
     "file": "api/services/discord_render/commands.py",
     "old": "        choices = await _bounded(lambda: router.fetch_ticker_choices(q), AUTOCOMPLETE_BUDGET_S, fallback)\n",
     "new": "        choices = router.fetch_ticker_choices(q)\n",
     "tests": [R + "test_autocomplete_answers_inside_its_budget_even_when_search_hangs"]},
    {"name": "R7 tracked edit posts without checking who holds the job (double-post guard gone)",
     "file": "api/services/discord_render/runtime.py",
     "old": "        if not self.runtime.store.held_by(self.job.corr_id, self.runtime.owner):\n",
     "new": "        if False:\n",
     "tests": [CORE + "test_C01_a_superseded_worker_does_not_post_over_the_pod_that_reclaimed_it"]},
    {"name": "R8 the flow worker loses its short timeout",
     "file": "api/services/discord_render/commands.py",
     "old": "                             timeout_s=FLOW_TIMEOUT_S, cid=job.corr_id)\n",
     "new": "                             cid=job.corr_id)\n",
     "tests": [R + "test_the_flow_worker_gets_the_short_timeout_the_cid_and_the_contract"]},
]


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def run_tests(nodes):
    p = subprocess.run([sys.executable, "-m", "pytest", *nodes, "-q", "-p", "no:cacheprovider"],
                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = p.stdout + p.stderr
    m_failed = re.search(r"(\d+) failed", out)
    m_passed = re.search(r"(\d+) passed", out)
    m_error = re.search(r"(\d+) error", out)
    totals = bool(m_failed or m_passed or m_error)
    failed = (int(m_failed.group(1)) if m_failed else 0) + (int(m_error.group(1)) if m_error else 0)
    return p.returncode, failed, int(m_passed.group(1)) if m_passed else 0, totals


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
        rc, failed, passed, totals = run_tests(m["tests"])
    finally:
        path.write_bytes(original)
    restored = sha(path.read_bytes()) == sha(original)
    verdict = ("RED (rail fired)" if (totals and failed >= 1) else
               "NO TOTALS LINE (not a run)" if not totals else "GREEN UNDER MUTATION (rail cannot fail)")
    ok_all = ok_all and restored and verdict.startswith("RED")
    results.append((m["name"], f"{verdict} failed={failed} passed={passed} rc={rc} restored={restored}"))

all_nodes = sorted({t for m in MUTATIONS for t in m["tests"]})
rc, failed, passed, totals = run_tests(all_nodes)
control = totals and failed == 0 and passed >= len(all_nodes) and rc == 0
ok_all = ok_all and control
for name, verdict in results:
    print(f"{name}\n    {verdict}")
print(f"CONTROL (restored tree, {len(all_nodes)} node ids): passed={passed} failed={failed} rc={rc} -> {'GREEN' if control else 'NOT GREEN'}")
sys.exit(0 if ok_all else 1)
