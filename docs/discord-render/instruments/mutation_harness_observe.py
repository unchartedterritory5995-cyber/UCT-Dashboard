"""Mutation proofs for step 2.2 (observability: structured events, observer, /renderhealth).

Same contract as mutation_harness_v2router.py: one mutation at a time, exact single replacement,
EOL-aware, byte-restore verified by sha256, never `git checkout`, control run at the end.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
O = "tests/test_discord_render_observe.py::"
H = "tests/test_discord_render_health_command.py::"
A = "tests/test_discord_activity.py::"
CMD = "api/services/discord_render/commands.py"
OBS = "api/services/discord_render/observe.py"

MUTATIONS = [
    {"name": "M0 /flow dropped from the default command set (the corrected stale assertion can fire)",
     "file": "api/services/discord_interactions.py",
     "old": "            build_settings_command(), build_buzz_command(), build_flow_command()]\n",
     "new": "            build_settings_command(), build_buzz_command()]\n",
     "tests": [A + "test_launch_command_is_an_admin_only_entry_point_registered_only_on_request"]},
    {"name": "M1 /renderhealth admin check bypassed", "file": CMD,
     "old": "    if not is_render_admin(interaction):\n", "new": "    if False:\n",
     "tests": [H + "test_a_member_without_the_admin_bit_is_refused"]},
    {"name": "M2 alert cooldown recorded BEFORE the send", "file": OBS,
     "old": "            if not self.store.alert_due(key, self.cooldown_s, record=False):\n",
     "new": "            if not self.store.alert_due(key, self.cooldown_s):\n",
     "tests": [O + "test_a_failed_send_buys_no_cooldown"]},
    {"name": "M3 alert cooldown held in memory (resets with the pod)", "file": OBS,
     "old": "            if not self.store.alert_due(key, self.cooldown_s, record=False):\n",
     "new": '            if key in self.__dict__.setdefault("_mem", set()) or self._mem.add(key):\n',
     "tests": [O + "test_a_breach_is_sent_once_and_the_cooldown_survives_a_new_pod"]},
    {"name": "M4 purge never runs", "file": OBS,
     "old": "        if now - self._last_purge >= self.purge_every_s:\n", "new": "        if False:\n",
     "tests": [O + "test_purge_runs_on_its_own_cadence_and_nulls_old_tokens"]},
    {"name": "M5 /renderhealth registered by default", "file": "api/services/discord_interactions.py",
     "old": "    if renderhealth:\n", "new": "    if True:\n",
     "tests": [H + "test_it_is_not_in_the_default_command_set"]},
    {"name": "M6 chart-renderer probed live on the ack path", "file": CMD,
     "old": '    renderer = obs.renderer if obs is not None and obs.renderer_at is not None else {"ready": None, "note": "not probed yet"}\n',
     "new": "    from api.routers import discord_interactions as _r\n    renderer = _r._renderer_health()\n",
     "tests": [H + "test_an_admin_gets_the_health_privately"]},
    {"name": "M7 /renderhealth ignores its budget (store read on the loop)", "file": CMD,
     "old": "    payload = await _bounded(lambda: observe.health_payload(rt, rt.store, renderer=renderer, renderer_misses=misses),\n                             HEALTH_BUDGET_S, None)\n",
     "new": "    payload = observe.health_payload(rt, rt.store, renderer=renderer, renderer_misses=misses)\n",
     "tests": [H + "test_a_slow_store_gets_an_honest_answer_inside_the_budget"]},
    {"name": "M8 shutdown leaves the observer running", "file": CMD,
     "old": "    if obs is not None:\n        obs.stop()\n", "new": "    pass\n",
     "tests": [H + "test_start_runs_the_observer_and_stop_ends_it"]},
    {"name": "M9 blank webhook logs without a cooldown (a log line every minute)", "file": OBS,
     "old": '                self.store.record_alert(key)\n                event("alert", key=key, detail=msg, outcome="logged_only")\n',
     "new": '                event("alert", key=key, detail=msg, outcome="logged_only")\n',
     "tests": [O + "test_a_blank_webhook_logs_the_alert_under_the_cooldown_and_posts_nothing"]},
    {"name": "M10 webhook error logged raw (URL is a credential)", "file": OBS,
     "old": '        event("alert_send_error", detail=type(e).__name__)\n',
     "new": '        log.info("alert_send_error %s", e)\n',
     "tests": [O + "test_posting_an_alert_never_logs_the_webhook_url"]},
    {"name": "M11 a crashed renderer probe reads as unconfigured (no alert)", "file": OBS,
     "old": '                self.renderer = {"reachable": False, "ready": False, "error": type(e).__name__}\n',
     "new": "                self.renderer = None\n",
     "tests": [O + "test_a_crashed_probe_counts_as_a_miss_and_an_unconfigured_renderer_never_does"]},
    {"name": "M14 a ready probe no longer resets the miss count", "file": OBS,
     "old": "            self.renderer_misses = self.renderer_misses + 1 if missed else 0\n",
     "new": "            self.renderer_misses = self.renderer_misses + 1 if missed else self.renderer_misses\n",
     "tests": [O + "test_a_renderer_down_on_two_probes_alerts_and_one_ready_probe_resets_it"]},
    {"name": "M15 one renderer miss pages", "file": OBS,
     "old": "RENDERER_MISSES_TO_ALERT = 2\n", "new": "RENDERER_MISSES_TO_ALERT = 1\n",
     "tests": [O + "test_one_renderer_miss_is_a_blip_two_are_an_alert"]},
    {"name": "M16 failure burst read over the hour", "file": OBS,
     "old": '    burst = sum(five["failures_by_class"].values())\n', "new": '    burst = sum(hour["failures_by_class"].values())\n',
     "tests": [O + "test_a_failure_burst_is_five_in_five_minutes_not_five_in_an_hour"]},
    {"name": "M17 delivery p95 read over the hour", "file": OBS,
     "old": '    if half["jobs"] >= 10 and (half["final_ms"]["p95"] or 0) > 8000:\n',
     "new": '    if hour["jobs"] >= 10 and (hour["final_ms"]["p95"] or 0) > 8000:\n',
     "tests": [O + "test_slow_delivery_fires_only_with_enough_jobs_inside_thirty_minutes"]},
    {"name": "M12 traceback written unscrubbed", "file": OBS,
     "old": '    tb = scrub_text("".join(traceback.format_exc()))\n', "new": '    tb = "".join(traceback.format_exc())\n',
     "tests": [O + "test_an_exception_traceback_is_logged_with_the_interaction_token_removed"]},
    {"name": "M13 runtime crash site back to raw log.exception", "file": "api/services/discord_render/runtime.py",
     "old": '            observe.exception("handler_crash", cid=job.corr_id, cmd=job.command)\n',
     "new": '            log.exception("drender evt=handler_crash cid=%s cmd=%s", job.corr_id, job.command)\n',
     "tests": [O + "test_a_handler_crash_in_the_runtime_never_writes_the_interaction_token",
               O + "test_no_module_in_the_v2_package_calls_log_exception"]},
]


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def run_tests(nodes):
    p = subprocess.run([sys.executable, "-m", "pytest", *nodes, "-q", "-p", "no:cacheprovider"],
                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
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
