"""Mutation proofs for step 2.4a (symbol resolution at the ack + the /flow partition).

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
Y = "tests/test_discord_render_symbols.py::"
SYM = "api/services/discord_render/symbols.py"
CMD = "api/services/discord_render/commands.py"

MUTATIONS = [
    {"name": "S1 an erroring authority is read as a 'no'", "file": SYM,
     "old": '        except Exception:  # noqa: BLE001 — an authority that cannot answer is not a "no"\n            errors += 1\n',
     "new": '        except Exception:  # noqa: BLE001 — an authority that cannot answer is not a "no"\n            pass\n',
     "tests": [Y + "test_an_unloaded_index_or_an_erroring_authority_never_refuses"]},
    {"name": "S2 an unloaded search index still refuses", "file": SYM,
     "old": "    if errors or not ready:\n", "new": "    if errors:\n",
     "tests": [Y + "test_an_unloaded_index_or_an_erroring_authority_never_refuses"]},
    {"name": "S3 suggestions uncapped", "file": SYM,
     "old": "        if t and t != s and t not in out and len(out) < limit:\n", "new": "        if t and t != s and t not in out:\n",
     "tests": [Y + "test_suggestions_are_capped_ordered_and_never_the_symbol_itself"]},
    {"name": "S4 no adjacent-swap edit (APPL -> AAPL missed)", "file": SYM,
     "old": "        return len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]]\n",
     "new": "        return False\n",
     "tests": [Y + "test_one_edit_covers_insert_delete_substitute_and_swap"]},
    {"name": "S5 the flow partition ignores the ETF list", "file": SYM,
     "old": '        if s in cap_universe.etf_symbols():\n            return "etfs"\n',
     "new": '        if False:\n            return "etfs"\n',
     "tests": [Y + "test_the_flow_partition_follows_flow_ingestions_classifier_then_the_etf_list"]},
    {"name": "S6 warm fetches on every refusal", "file": SYM,
     "old": "        if last is not None and now() - last < WARM_TTL_S:\n", "new": "        if False:\n",
     "tests": [Y + "test_warm_fetches_once_per_window"]},
    {"name": "S7 a check past its budget refuses", "file": CMD,
     "old": '    if verdicts is None:\n        observe.event("symbol_check", cid=cid, outcome="skipped: budget or error")\n        return None\n',
     "new": '    if verdicts is None:\n        return _ephemeral("refused")\n',
     "tests": [Y + "test_the_check_fails_open"]},
    {"name": "S8 an unanswerable check refuses", "file": CMD,
     "old": "    unknown = [v for v in verdicts if v.status == symbols.UNKNOWN]\n",
     "new": "    unknown = [v for v in verdicts if v.status != symbols.KNOWN]\n",
     "tests": [Y + "test_the_check_fails_open"]},
    {"name": "S9 the kill switch is ignored", "file": CMD,
     "old": '    if not command_enabled("symbols"):\n        return None\n', "new": "    if False:\n        return None\n",
     "tests": [Y + "test_the_kill_switch_skips_the_check"]},
    {"name": "S10 a refused chart is queued anyway", "file": CMD,
     "old": '        if refusal:\n            return refusal\n        label = contract.command_label("chart", {"tickers": [r.ticker for r in reqs]})\n        return _enqueue(_job(interaction, "multi"',
     "new": '        label = contract.command_label("chart", {"tickers": [r.ticker for r in reqs]})\n        return _enqueue(_job(interaction, "multi"',
     "tests": [Y + "test_an_unknown_symbol_is_refused_privately_fast_and_never_queued"]},
    {"name": "S11 no background warm after a refusal", "file": CMD,
     "old": "    for v in unknown:\n        _warm_pool.submit(symbols.warm, v.symbol)\n", "new": "    pass\n",
     "tests": [Y + "test_an_unknown_symbol_is_refused_privately_fast_and_never_queued"]},
    {"name": "S12 the refusal carries no id", "file": SYM,
     "old": '            f"I\'ve started looking it up. · id {cid}")[:1900]\n',
     "new": '            f"I\'ve started looking it up.")[:1900]\n',
     "tests": [Y + "test_the_refusal_names_the_symbol_the_suggestions_and_the_id"]},
    {"name": "S13 the V2 flow handler drops the partition", "file": CMD,
     # re-aimed 2026-09-14: the partition is now resolved into a `source` local and the call
     # carries `**extra`. Same intent — drop the partition on the way to the flow job.
     "old": "                             cid=job.corr_id, source=source, **extra)\n",
     "new": "                             cid=job.corr_id, **extra)\n",
     "tests": [Y + "test_the_v2_flow_handler_passes_the_resolved_partition"]},
    {"name": "S14 the flow job ignores the partition it is given", "file": "api/routers/discord_interactions.py",
     "old": '                params = {"symbol": ticker, "days": days, "source": source}\n',
     "new": '                params = {"symbol": ticker, "days": days, "source": "stocks"}\n',
     "tests": [Y + "test_the_flow_job_reads_the_partition_it_is_given_and_defaults_to_stocks"]},
    {"name": "S15 /flow skips the symbol check", "file": CMD,
     "old": "        refusal = await _symbol_refusal(interaction, [tkr])\n        if refusal:\n            return refusal\n",
     "new": "",
     "tests": [Y + "test_flow_refuses_an_unknown_symbol_too"]},
    {"name": "S16 compare tickers are not checked", "file": CMD,
     "old": "[r.ticker for r in reqs] + list(reqs[0].compare or ())", "new": "[r.ticker for r in reqs]",
     "tests": [Y + "test_a_compare_symbol_is_checked_too"]},
    {"name": "S17 an undetermined bars verdict refuses", "file": SYM,
     "old": '    if verdict != "no_data":\n        return Resolution(s, UNANSWERABLE)\n',
     "new": '    if verdict not in ("no_data", "undetermined"):\n        return Resolution(s, UNANSWERABLE)\n',
     "tests": [Y + "test_a_static_miss_is_refused_only_when_bars_itself_says_not_carried"]},
    {"name": "S18 a confirmation that raises refuses", "file": SYM,
     "old": '        verdict = "undetermined"\n', "new": '        verdict = "no_data"\n',
     "tests": [Y + "test_a_confirmation_that_raises_never_refuses"]},
    {"name": "S19 the share-class alias is not tried", "file": SYM,
     "old": "            if predicate(s) or (alias and alias != s and predicate(alias)):\n",
     "new": "            if predicate(s):\n",
     "tests": [Y + "test_a_dot_share_class_matches_the_hyphen_spelling_the_universe_uses"]},
    {"name": "S20 contains-matches ranked with prefix matches (MAPPLNCT before AAPL)", "file": SYM,
     "old": "        if t.startswith(s):\n            add(t)\n",
     "new": "        if t.startswith(s) or s in t:\n            add(t)\n",
     "tests": [Y + "test_a_symbol_merely_containing_the_input_ranks_after_one_edit_matches"]},
    {"name": "S21 a 503 from bars is read as not-carried", "file": SYM,
     "old": '    if getattr(resp, "status_code", 200) != 200:\n        return "undetermined"\n',
     "new": '    if getattr(resp, "status_code", 200) != 200:\n        return "no_data"\n',
     "tests": [Y + "test_the_bars_verdict_reads_the_serve_paths_own_answer"]},
    {"name": "S22 the symbol check runs on autocomplete's pool", "file": CMD,
     "old": "SYMBOL_BUDGET_S, None, pool=_symbol_pool)", "new": "SYMBOL_BUDGET_S, None)",
     "tests": [Y + "test_the_symbol_check_runs_on_its_own_pool_not_autocompletes"]},
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
