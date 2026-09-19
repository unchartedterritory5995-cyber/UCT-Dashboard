"""Mutation proofs for step 2.3 (chart-renderer hygiene/ceiling/pool + web correlation).

Same contract as the other harnesses: one mutation at a time, exact single replacement, EOL-aware,
byte-restore verified by sha256, never `git checkout`, control run at the end.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()

# ⛔ B4/B5 — ONE shared guard, imported, never copy-pasted (a guard repeated is a guard
# unproved). It refuses to run unless this tree is a sacrificed mutation sandbox, then
# refuses to start an 18-minute run on an anchor that no longer matches its source.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness_guard import guard  # noqa: E402

guard(ROOT, __file__)
P = "tests/test_chart_renderer_pool.py::"
C = "tests/test_discord_render_correlation.py::"
APP = "services/chart_renderer/app.py"
DI = "api/services/discord_interactions.py"
IDS = "api/services/discord_render/ids.py"

MUTATIONS = [
    {"name": "A1 scrub is a no-op", "file": APP,
     # ⛔⛔ STALE ANCHOR, FOUND AND FIXED 2026-09-19 by anchor_check.check_tree() (the same
     # check harness_guard's own B5 preflight already runs) -- this mutation's old 2-line
     # anchor stopped matching when scrub() grew a third substitution (header-shaped
     # credential redaction, see the docstring's own "THE THIRD SUBSTITUTION IS NEW" note):
     # line 2 changed from `return _SECRET_PARAM.sub(...)` to `s = _SECRET_PARAM.sub(...)`
     # once it stopped being the last line. A silently-unappliable A1 would have proven
     # NOTHING about scrub()'s no-op case while reading as a passing control. Anchor now
     # matches the current 3-line body exactly; "new" still collapses it to the same no-op.
     "old": '    s = _URL_QUERY.sub(lambda m: m.group(1) + "?[redacted]", str(text))\n'
            '    s = _SECRET_PARAM.sub(lambda m: m.group(1) + "=[redacted]", s)\n'
            '    return _SECRET_HEADER.sub(lambda m: m.group(1) + m.group(2) + "[redacted]", s)\n',
     "new": "    return str(text)\n",
     "tests": [P + "test_scrub_removes_every_query_string_and_named_secret",
               P + "test_a_browser_error_never_puts_the_token_in_a_log_or_the_response",
               P + "test_page_warnings_log_the_path_never_the_query"]},
    {"name": "A2 a 502 logs the raw traceback (log.exception)", "file": APP,
     "old": '        log.error("render failed cid=%s path=%s\\n%s", cid, url_path(req.url), scrub(traceback.format_exc()))\n',
     "new": '        log.exception("render failed cid=%s path=%s", cid, url_path(req.url))\n',
     "tests": [P + "test_a_browser_error_never_puts_the_token_in_a_log_or_the_response"]},
    {"name": "A3 no hard ceiling", "file": APP,
     "old": "        png, meta = await asyncio.wait_for(render_png(req), timeout=ceiling)\n",
     "new": "        png, meta = await render_png(req)\n",
     "tests": [P + "test_the_hard_ceiling_cuts_a_hung_render_with_a_504"]},
    # ⭐ RE-AIMED 2026-09-14 at `safe_cid`, which is now the ONE definition. B1's admin lever
    # repeated the old inline expression verbatim, so this anchor briefly matched TWO places —
    # AMBIGUOUS, not stale, and an exact single replacement was impossible. The fix was to collapse
    # the duplicate rather than lengthen the anchor: a longer anchor would have restored the
    # mutation while leaving two copies of a log-injection guard free to drift apart.
    {"name": "A4 correlation id logged unvalidated", "file": APP,
     "old": '    return raw if _CID.match(raw or "") else "-"\n',
     "new": '    return raw or "-"\n',
     "tests": [P + "test_one_render_line_carries_the_correlation_id_and_only_the_path"]},
    {"name": "A5 background cap removed", "file": APP,
     "old": '        if priority == "background":\n            await _bg_slots.acquire()\n',
     "new": "        if False:\n            await _bg_slots.acquire()\n",
     "tests": [P + "test_background_renders_never_hold_more_than_their_slots"]},
    {"name": "A6 a retired browser closes under in-flight renders", "file": APP,
     "old": "    if slot.retired and slot.inflight == 0 and not slot.closed:\n",
     "new": "    if slot.retired and not slot.closed:\n",
     "tests": [P + "test_recycle_waits_for_in_flight_renders_then_closes_the_old_browser"]},
    {"name": "A7 recycle never triggers", "file": APP,
     "old": "        if slot.renders >= after or (rss is not None and rss > ceiling):\n",
     "new": "        if False:\n",
     "tests": [P + "test_recycle_waits_for_in_flight_renders_then_closes_the_old_browser",
               P + "test_rss_over_the_ceiling_recycles"]},
    {"name": "A8 no pre-launch of the replacement browser", "file": APP,
     "old": "            asyncio.ensure_future(_prelaunch())\n", "new": "            pass\n",
     "tests": [P + "test_recycle_waits_for_in_flight_renders_then_closes_the_old_browser"]},
    {"name": "A9 pool reports ready before the warm ran", "file": APP,
     "old": "    ready = bool(SECRET) and _launch_error is None and (_warm_done if pool else True)\n",
     "new": "    ready = bool(SECRET) and _launch_error is None\n",
     "tests": [P + "test_pool_mode_is_not_ready_until_the_warm_render_ran"]},
    {"name": "A10 legacy ready read off the browser (idle renderer reads as down)", "file": APP,
     "old": "    ready = bool(SECRET) and _launch_error is None and (_warm_done if pool else True)\n",
     "new": "    ready = bool(SECRET) and _launch_error is None and (_warm_done if pool else connected)\n",
     "tests": [P + "test_legacy_health_is_ready_before_the_first_render_and_carries_counters"]},
    {"name": "A11 a used context goes back in the pool", "file": APP,
     "old": "                await _close_quiet(ctx)          # never reused: every render gets a fresh context\n",
     "new": "                slot.spare[key] = ctx\n",
     "tests": [P + "test_the_pool_hands_out_a_pre_created_context_and_never_reuses_one"]},
    {"name": "A12 warm URL logged with its query", "file": APP,
     "old": '            log.info("warm render path=%s ok", url_path(url))\n',
     "new": '            log.info("warm render path=%s ok", url)\n',
     "tests": [P + "test_the_warm_url_is_rendered_once_and_logged_by_path"]},
    {"name": "B1 a V2 job's handler runs unbound", "file": "api/services/discord_render/runtime.py",
     "old": "                with ids.bind(job.corr_id, background=job.lane == BACKGROUND):\n                    outcome = handler(ctx)\n",
     "new": "                if True:\n                    outcome = handler(ctx)\n",
     "tests": [C + "test_a_v2_job_runs_its_handler_bound_to_its_id_and_lane"]},
    {"name": "B2 multi-chart pool threads lose the id", "file": DI,
     "old": "                results = list(ex.map(render_ids.carry(_one), items))\n",
     "new": "                results = list(ex.map(_one, items))\n",
     "tests": [C + "test_every_chart_in_a_multi_chart_job_renders_under_the_jobs_id"]},
    {"name": "B3 warm cycle renders as interactive", "file": DI,
     "old": "    with render_ids.background():\n        return _warm_hot_charts(",
     "new": "    if True:\n        return _warm_hot_charts(",
     "tests": [C + "test_the_warm_cycle_renders_as_background_and_leaves_nothing_bound"]},
    {"name": "B4 house render sends no correlation headers", "file": "api/services/discord_chart_house.py",
     # re-aimed 2026-09-14: the headers moved into a `_hdrs` local (the edge token is added
     # conditionally after it). Same intent — send no correlation headers.
     "old": '                _hdrs = {"X-Render-Secret": secret, **render_ids.render_headers()}\n',
     "new": '                _hdrs = {"X-Render-Secret": secret}\n',
     "tests": [C + "test_the_house_render_sends_the_headers_only_when_bound_and_scrubs_the_error_body"]},
    {"name": "B5 house render logs the renderer body raw", "file": "api/services/discord_chart_house.py",
     "old": "r.status_code, sym, tf, attempt, render_observe.scrub(r.text)[:160])",
     "new": "r.status_code, sym, tf, attempt, r.text[:160])",
     "tests": [C + "test_the_house_render_sends_the_headers_only_when_bound_and_scrubs_the_error_body"]},
    {"name": "B6 buzz render logs the renderer body raw", "file": "api/services/buzz_image.py",
     "old": '                log.warning("[buzz] render HTTP %s: %s", r.status_code, render_observe.scrub(r.text)[:160])\n',
     "new": '                log.warning("[buzz] render HTTP %s: %s", r.status_code, r.text[:160])\n',
     "tests": [C + "test_the_buzz_render_sends_the_id_and_scrubs_the_error_body"]},
    {"name": "B7 buzz render sends no correlation headers", "file": "api/services/buzz_image.py",
     "old": 'headers={"X-Render-Secret": secret, **render_ids.render_headers()}, json={',
     "new": 'headers={"X-Render-Secret": secret}, json={',
     "tests": [C + "test_the_buzz_render_sends_the_id_and_scrubs_the_error_body"]},
    {"name": "B8 carry does not re-bind on the pool thread", "file": IDS,
     "old": '        with bind(cid, background=(priority == "background") if priority else None):\n            return fn(*args, **kwargs)\n',
     "new": "        return fn(*args, **kwargs)\n",
     "tests": [C + "test_carry_hands_the_callers_binding_to_pool_threads"]},
    {"name": "B9 a binding is not restored on exit", "file": IDS,
     "old": "        _local.cid, _local.priority = prev\n", "new": "        pass\n",
     "tests": [C + "test_a_binding_is_per_thread_and_restored_on_exit"]},
    {"name": "B10 anything bound is sent as a correlation id", "file": IDS,
     "old": "    if is_corr_id(current()):\n", "new": "    if current():\n",
     "tests": [C + "test_something_that_is_not_a_correlation_id_is_never_sent"]},
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
