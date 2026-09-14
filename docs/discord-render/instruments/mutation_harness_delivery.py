"""Mutation proofs for step 2.6 — Discord delivery hardening (03 §3.4, classes C-03/C-04/C-11).

Same contract as `mutation_harness_adapters.py`: one mutation at a time, exact single
replacement, EOL-aware, byte-restore verified by sha256, never `git checkout`, and a control run
BEFORE as well as after — a mutation table means nothing if the suite was already red.

⛔ EVERY MUTATION BELOW IS A DEFECT THIS STEP CLOSED, PUT BACK ON PURPOSE. The 429 slept past the
job's deadline; the dead interaction token retried twice for nothing; a fixed delay re-synchronised
every caller that failed together; the ▲ that stripped every chart's controls sailed through
pre-flight; a text-only edit dropped the chart; and the interaction token reached a log.

⛔ IT MUTATES ONE FILE — `api/services/discord_render/delivery.py`. The lanes beside this one own
`runtime.py`, `commands.py`, `adapters/**` and `observe.py`, and a harness that edits a file
another session is holding is how a restore lands on top of somebody else's work.

Usage:  python docs/discord-render/instruments/mutation_harness_delivery.py [repo-root]
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
DEL = "api/services/discord_render/delivery.py"
T = "tests/test_discord_render_delivery.py::"
#: The suites that must still be green with the mutation IN: delivery is the only module 2.6
#: touched, and `runtime.send_failure` is its one caller today.
SUITE = ["tests/test_discord_render_delivery.py",
         "tests/test_discord_render_v2_core.py",
         "tests/test_discord_render_adapter_boundary.py",
         "tests/test_discord_render_observe.py"]

MUTATIONS = [
    # ── 429: deadline-aware, or it is not a fix ────────────────────────────
    {"name": "D1 the wait is not bounded by the budget (sleeps 30s inside a 15s deadline)",
     "file": DEL,
     "old": "        if wait + MIN_USEFUL_S > left:\n",
     "new": "        if False:\n",
     "tests": [T + "test_a_rate_limit_longer_than_the_budget_is_never_slept",
               T + "test_the_wait_AND_a_round_trip_must_fit_not_just_the_wait",
               T + "test_the_budget_already_spent_counts_against_the_wait"]},
    {"name": "D2 the wait only has to fit itself, not a round trip after it",
     "file": DEL,
     "old": "        if wait + MIN_USEFUL_S > left:\n",
     "new": "        if wait > left:\n",
     "tests": [T + "test_the_wait_AND_a_round_trip_must_fit_not_just_the_wait"]},
    {"name": "D3 Discord's own retry_after is ignored in favour of our backoff",
     "file": DEL,
     "old": "    if res.status == 429 and res.retry_after is not None:\n"
            "        return res.retry_after + breakers.retry_delay(attempt, base_s=0.0,\n"
            "                                                      spread_s=RETRY_AFTER_JITTER_S, rand=rand)\n",
     "new": "    if False:\n        pass\n",
     "tests": [T + "test_a_rate_limit_is_waited_out_when_the_wait_fits_the_budget",
               T + "test_the_jitter_is_also_spread_on_a_server_dictated_wait"]},
    {"name": "D4 a rate limit past the budget reads as an ordinary one (the reason vanishes)",
     "file": DEL,
     "old": "            if res.status == 429:\n"
            "                res = replace(res, reason=RATE_LIMIT_OVER_DEADLINE,\n"
            "                              cls=class_for(RATE_LIMIT_OVER_DEADLINE))\n",
     "new": "            pass\n",
     "tests": [T + "test_a_rate_limit_longer_than_the_budget_is_never_slept",
               T + "test_every_outcome_is_a_named_reason_and_a_class_a_member_can_be_told"]},
    {"name": "D5 the header form of Retry-After is dropped (a 429 with no body backs off blind)",
     "file": DEL,
     "old": "    raw = header.get(\"Retry-After\") or header.get(\"retry-after\")\n",
     "new": "    raw = None\n",
     "tests": [T + "test_retry_after_comes_from_the_body_first_then_the_header"]},

    # ── 5xx / transport: one delay authority, jittered, bounded ────────────
    {"name": "D6 a second delay policy (the bars path's fixed 1.5s, re-synchronised)",
     "file": DEL,
     "old": "    return breakers.retry_delay(attempt, rand=rand)\n",
     "new": "    return 1.5\n",
     "tests": [T + "test_a_server_error_is_retried_and_the_delay_comes_from_breakers_retry_delay",
               T + "test_the_delay_is_jittered_so_callers_that_failed_together_do_not_return_together"]},
    {"name": "D7 the jitter is stripped off a server-dictated wait (one bucket, one millisecond)",
     "file": DEL,
     "old": "        return res.retry_after + breakers.retry_delay(attempt, base_s=0.0,\n"
            "                                                      spread_s=RETRY_AFTER_JITTER_S, rand=rand)\n",
     "new": "        return res.retry_after\n",
     "tests": [T + "test_the_jitter_is_also_spread_on_a_server_dictated_wait"]},
    {"name": "D8 the attempt ceiling is raised past the spec's three",
     "file": DEL, "old": "MAX_ATTEMPTS = 3\n", "new": "MAX_ATTEMPTS = 8\n",
     "tests": [T + "test_retries_are_bounded_and_a_failure_that_survives_them_is_reported"]},
    {"name": "D9 a transport failure raises into the job instead of returning a result",
     "file": DEL,
     "old": "    except Exception as e:  # noqa: BLE001 — delivery never raises into a job\n",
     "new": "    except ValueError as e:  # noqa: BLE001\n",
     "tests": [T + "test_a_transport_failure_is_a_result_and_never_an_exception_into_the_job"]},

    # ── 10015: terminal, classified apart ──────────────────────────────────
    {"name": "D10 10015 is folded into the generic rejection (the member hears the wrong thing)",
     "file": DEL,
     "old": "    if code in (UNKNOWN_WEBHOOK, UNKNOWN_MESSAGE) or status == 404:\n        return TOKEN_DEAD\n",
     "new": "    if False:\n        return TOKEN_DEAD\n",
     "tests": [T + "test_an_unknown_webhook_is_classified_apart_from_every_other_rejection",
               T + "test_a_bare_404_is_a_dead_token_too_because_the_message_is_gone",
               T + "test_every_outcome_is_a_named_reason_and_a_class_a_member_can_be_told"]},
    {"name": "D11 the terminal-code guard goes (a dead token inside a 5xx is retried)",
     "file": DEL,
     "old": "    if code in TERMINAL_CODES or reason in (TOKEN_DEAD, ATTACHMENT_NOT_FOUND,\n"
            "                                            COMPONENTS_REJECTED, TOO_LARGE, FORBIDDEN):\n"
            "        return False\n",
     "new": "    if False:\n        return False\n",
     "tests": [T + "test_a_dead_token_wrapped_in_a_5xx_is_still_dead",
               T + "test_the_terminal_codes_are_the_ones_that_cannot_succeed_on_a_second_try"]},

    # ── C-04: attachments, both directions ─────────────────────────────────
    {"name": "D12 ATTACHMENT_NOT_FOUND loses its own reason (C-04 becomes anonymous)",
     "file": DEL,
     "old": "        if _errors_mentions(body, \"attachments\"):\n            return ATTACHMENT_NOT_FOUND\n",
     "new": "        if False:\n            return ATTACHMENT_NOT_FOUND\n",
     "tests": [T + "test_a_stale_attachment_id_is_terminal_and_not_retried",
               T + "test_every_outcome_is_a_named_reason_and_a_class_a_member_can_be_told"]},
    {"name": "D13 a text-only edit stops re-declaring the ids (it drops the chart)",
     "file": DEL,
     "old": "    if attachments is not None:\n        payload[\"attachments\"] = attachments_payload(attachments)\n"
            "    return _send(\"patch\", url, payload, client, deadline_s=deadline_s, cid=cid,\n",
     "new": "    return _send(\"patch\", url, payload, client, deadline_s=deadline_s, cid=cid,\n",
     "tests": [T + "test_a_text_only_edit_re_declares_the_ids_it_means_to_keep",
               T + "test_an_empty_list_clears_them_and_that_has_to_be_deliberate"]},

    # ── C-03: the component tree is validated before it is sent ────────────
    {"name": "D14 the emoji allow-list is not consulted (the ▲ ships again)",
     "file": DEL,
     "old": "        if not (isinstance(emoji, dict) and emoji.get(\"id\")) and name not in EMOJI_ALLOWED:\n",
     "new": "        if False:\n",
     "tests": [T + "test_the_triangle_that_stripped_every_charts_controls_for_a_week_is_refused",
               T + "test_an_invalid_tree_is_dropped_and_the_message_is_still_delivered"]},
    {"name": "D15 an invalid tree is sent anyway (Discord refuses the whole message — C-03)",
     "file": DEL,
     "old": "    observe.event(\"components_invalid\", cid=cid, cls=class_for(COMPONENTS_REJECTED),\n"
            "                  outcome=\"dropped\", detail=\"; \".join(problems)[:200])\n"
            "    return None, (\"components\",)\n",
     "new": "    return components, ()\n",
     "tests": [T + "test_an_invalid_tree_is_dropped_and_the_message_is_still_delivered"]},
    {"name": "D16 the validator is built, tested, green and never called",
     "file": DEL,
     "old": "    url = f\"{DISCORD_API}/webhooks/{app_id}/{token}/messages/@original\"\n"
            "    comps, dropped = _safe_components(components, cid=cid)\n",
     "new": "    url = f\"{DISCORD_API}/webhooks/{app_id}/{token}/messages/@original\"\n"
            "    comps, dropped = components, ()\n",
     "tests": [T + "test_an_invalid_tree_is_dropped_and_the_message_is_still_delivered"]},
    {"name": "D17 a duplicate custom_id passes (Discord refuses the message, not the button)",
     "file": DEL,
     "old": "        if cid in seen_ids:\n", "new": "        if False:\n",
     "tests": [T + "test_every_rule_discord_would_refuse_the_whole_message_for_is_checked_here"]},
    {"name": "D18 the emoji allow-list drifts behind the builders that feed it",
     "file": DEL,
     "old": "    \"\\U0001F30A\",          # \U0001F30A Dark Pools\n", "new": "",
     "tests": [T + "test_the_emoji_allow_list_covers_every_emoji_the_component_builders_actually_use"]},

    # ── C-11: a result, with a class, always ───────────────────────────────
    {"name": "D19 a success carries a failure class (the class becomes furniture)",
     "file": DEL,
     "old": "        return DeliveryResult(True, resp.status_code, None, \"\", reason=OK,\n"
            "                              message=body if isinstance(body, dict) else None)\n",
     "new": "        return DeliveryResult(True, resp.status_code, None, \"\", reason=OK, cls=\"internal\",\n"
            "                              message=body if isinstance(body, dict) else None)\n",
     "tests": [T + "test_a_delivery_that_worked_says_so_and_names_no_class"]},
    {"name": "D20 the result cannot say what it cost (attempts and waited are dropped)",
     "file": DEL,
     "old": "    out = replace(res, attempts=attempt, waited_s=round(waited, 3), dropped=dropped)\n",
     "new": "    out = replace(res, dropped=dropped)\n",
     "tests": [T + "test_a_delivery_that_worked_says_so_and_names_no_class",
               T + "test_a_rate_limit_is_waited_out_when_the_wait_fits_the_budget"]},

    # ── the budget reaches the wire ────────────────────────────────────────
    {"name": "D21 the request timeout ignores what is left (a 10s call inside a 0.5s budget)",
     "file": DEL,
     "old": "                    timeout_s=min(ceiling_s, max(MIN_USEFUL_S, left)), attempt=attempt, cid=cid)\n",
     "new": "                    timeout_s=ceiling_s, attempt=attempt, cid=cid)\n",
     "tests": [T + "test_the_request_timeout_is_the_smaller_of_the_ceiling_and_what_is_left"]},
    {"name": "D22 the first attempt is skipped with no budget left (C-11 with extra steps)",
     "file": DEL,
     "old": "        left = budget - (clock() - started)\n"
            "        res = _once(method, url, payload, client, files=files,\n",
     "new": "        left = budget - (clock() - started)\n"
            "        if left < MIN_USEFUL_S:\n"
            "            break\n"
            "        res = _once(method, url, payload, client, files=files,\n",
     "tests": [T + "test_the_first_attempt_runs_even_with_no_budget_left"]},
    {"name": "D23 content is not trimmed to the contract limit",
     "file": DEL,
     "old": "    comps, dropped = _safe_components(components, cid=cid)\n"
            "    payload: dict = {\"content\": content[:contract.CONTENT_MAX], \"allowed_mentions\": {\"parse\": []}}\n"
            "    if comps is not None:\n"
            "        payload[\"components\"] = comps\n"
            "    if attachments is not None:\n",
     "new": "    comps, dropped = _safe_components(components, cid=cid)\n"
            "    payload: dict = {\"content\": content, \"allowed_mentions\": {\"parse\": []}}\n"
            "    if comps is not None:\n"
            "        payload[\"components\"] = comps\n"
            "    if attachments is not None:\n",
     "tests": [T + "test_content_is_trimmed_to_the_contract_limit_and_mentions_are_never_parsed"]},

    # ── ⛔⛔ the token must never reach a log ───────────────────────────────
    {"name": "D24 log.exception instead of observe.exception (the traceback IS the credential)",
     "file": DEL,
     "old": "        observe.exception(\"delivery_error\", cid=cid, attempt=attempt, hop=method)\n",
     "new": "        import logging as _lg\n"
            "        _lg.getLogger(\"discord_render\").exception(\"delivery_error\")\n",
     "tests": [T + "test_the_token_never_reaches_a_log_when_the_transport_raises",
               T + "test_the_token_never_reaches_a_log_through_the_runtimes_own_failure_message"]},
    {"name": "D25 the exception's message is logged instead of its type (same leak, shorter)",
     "file": DEL,
     "old": "        return DeliveryResult(False, None, None, type(e).__name__, reason=TRANSPORT,\n",
     "new": "        observe.log.error(\"drender delivery failed %s\", e)\n"
            "        return DeliveryResult(False, None, None, type(e).__name__, reason=TRANSPORT,\n",
     "tests": [T + "test_the_token_never_reaches_a_log_when_the_transport_raises",
               T + "test_the_token_never_reaches_a_log_through_the_runtimes_own_failure_message"]},
    {"name": "D26 the response body reaches the jobs table unscrubbed",
     "file": DEL,
     "old": "        observe.scrub(getattr(resp, \"text\", \"\") or \"\")[:200],\n",
     "new": "        (getattr(resp, \"text\", \"\") or \"\")[:200],\n",
     "tests": [T + "test_the_token_never_reaches_a_log_when_discord_echoes_the_url_back"]},
]


def read(p):
    return p.read_bytes()


def run(tests):
    cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:randomly", "-x", *tests]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=900)
    out = r.stdout + r.stderr
    # ⛔ NO TOTALS LINE IS NOT A PASS. A runner that died at argument parsing exits 0 with an
    # empty report, and reading the exit code alone banks that as green (CLAUDE.md, 2026-09-09).
    m = re.search(r"(\d+) passed|(\d+) failed|(\d+) error", out)
    if not m:
        return "NO TOTALS LINE", out[-400:]
    if r.returncode == 0:
        return "GREEN", out.strip().splitlines()[-1][:120]
    return "RED", out.strip().splitlines()[-1][:120]


def main():
    print(f"root: {ROOT}\n")
    control_first = run(SUITE)
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
        if n != 1:
            results.append((mut["name"], f"NOT APPLIED ({n} matches)", ""))
            print(f"  {mut['name']:<78} NOT APPLIED ({n} matches)")
            continue
        try:
            path.write_bytes(text.replace(old, new, 1).encode("utf-8"))
            verdict, tail = run(mut["tests"])
        finally:
            # ⛔ RESTORE BY BYTES, VERIFIED. Never `git checkout --`: it discards whatever else
            # is uncommitted in the file, which has cost this repo a finished edit before.
            path.write_bytes(original)
            assert hashlib.sha256(read(path)).hexdigest() == sha, f"RESTORE FAILED for {mut['file']}"
        results.append((mut["name"], verdict, tail))
        print(f"  {mut['name']:<78} {verdict}")

    control_last = run(SUITE)
    print(f"\nCONTROL (after)   {control_last[0]}  {control_last[1]}")
    red = sum(1 for _, v, _ in results if v == "RED")
    print(f"\n{red}/{len(results)} mutations RED")
    bad = [(n, v) for n, v, _ in results if v != "RED"]
    for n, v in bad:
        print(f"  *** {v}: {n}")
    return 0 if (not bad and control_last[0] == "GREEN") else 1


if __name__ == "__main__":
    sys.exit(main())
