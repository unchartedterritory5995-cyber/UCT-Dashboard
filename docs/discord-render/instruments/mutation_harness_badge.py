"""Mutation proofs for step 2.7 — the member-facing copy (`api/services/discord_render/badge.py`).

Same contract as `mutation_harness_adapters.py`: one mutation at a time, exact single replacement,
EOL-aware, byte-restore verified by sha256, never `git checkout`, and a control run **before and
after** so a suite that was already broken cannot be read as a proof.

⛔ A MUTATION THAT STAYS GREEN IS A FINDING ABOUT THE TEST, NOT ABOUT THE CODE. Each defect below is
one this surface has already paid for, re-introduced deliberately: the badge shown when nobody
measured; the badge shown when nothing is wrong; a second copy of the one sentence; the id a member
quotes dropped from the line that exists to carry it; the STAMP trimmed instead of the content.

    python docs/discord-render/instruments/mutation_harness_badge.py [repo-root]
    python docs/discord-render/instruments/mutation_harness_badge.py --self-check

`--self-check` proves the harness can fail: it applies one mutation the tests DO catch and one that
is a no-op, and reports both verdicts. A harness nobody has seen report a GREEN is a harness whose
REDs mean nothing.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

_ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SELF_CHECK = "--self-check" in sys.argv
ROOT = Path(_ARGS[0]).resolve() if _ARGS else Path(__file__).resolve().parents[3]

# ⛔ B4/B5 — ONE shared guard, imported, never copy-pasted (a guard repeated is a guard
# unproved). It refuses to run unless this tree is a sacrificed mutation sandbox, then
# refuses to start an 18-minute run on an anchor that no longer matches its source.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness_guard import guard  # noqa: E402

guard(ROOT, __file__)

T = "tests/test_discord_render_badge.py::"
G = "tests/test_discord_render_goldens.py::"
V = "tests/test_discord_render_vintage_url.py::"
SUITES = ["tests/test_discord_render_badge.py", "tests/test_discord_render_goldens.py",
          "tests/test_discord_render_vintage_url.py"]
BADGE = "api/services/discord_render/badge.py"
GOLD = "docs/discord-render/instruments/golden_capture.py"
HOUSE = "api/services/discord_chart_house.py"

MUTATIONS = [
    # ── the badge: drawn on True, and on nothing else ───────────────────────
    {"name": "B1 an unmeasured vintage is drawn as a warning (the §3.8b defect)", "file": BADGE,
     "old": '    if result is None or getattr(result, "stale", None) is not True:\n        return None\n',
     "new": "    if result is None:\n        return None\n",
     "tests": [T + "test_a_stamp_that_hands_us_a_sentence_for_an_unmeasured_vintage_is_still_refused"]},
    {"name": "B2 the badge is a second copy of the sentence, not the envelope's", "file": BADGE,
     "old": '    badge = getattr(result, "badge", None)\n    return badge or None\n',
     "new": '    return "(stale)"\n',
     "tests": [T + "test_a_stale_vintage_is_drawn_as_the_envelopes_own_sentence",
               T + "test_the_footer_order_is_vintage_then_provenance_then_id"]},

    # ── rare, or it is furniture ────────────────────────────────────────────
    {"name": "B3 a healthy delivery is stamped too (the badge becomes furniture)", "file": BADGE,
     "old": '    if not parts:\n        return ""\n',
     "new": '    if not parts:\n        parts = ["checked"]\n',
     "tests": [T + "test_a_healthy_delivery_reads_exactly_as_it_would_undegraded",
               T + "test_an_empty_result_set_says_nothing",
               T + "test_nothing_is_drawn_all_weekend"]},

    # ── the footer: order, the id, one line ─────────────────────────────────
    {"name": "B4 the footer leads with provenance instead of vintage", "file": BADGE,
     "old": "    parts = [p for p in (quality,\n"
            "                         _vintage_clause(results),\n"
            "                         BACKUP_CLAUSE if any(_is_backup(r) for r in (results or {}).values()) else None)\n"
            "             if p]\n",
     "new": "    parts = [p for p in (quality,\n"
            "                         BACKUP_CLAUSE if any(_is_backup(r) for r in (results or {}).values()) else None,\n"
            "                         _vintage_clause(results))\n"
            "             if p]\n",
     "tests": [T + "test_the_footer_order_is_vintage_then_provenance_then_id",
               T + "test_the_quality_clause_leads_the_line_and_shares_it"]},

    # ── the quality clause (C-06's half of this line) ───────────────────────
    {"name": "Q1 the stand-in label never reaches the member's content", "file": BADGE,
     "old": "    parts = [p for p in (quality,\n",
     "new": "    parts = [p for p in (None,\n",
     "tests": [T + "test_the_quality_clause_leads_the_line_and_shares_it",
               T + "test_a_quality_clause_alone_still_carries_the_id"]},
    {"name": "Q2 the quality clause trails the line instead of leading it", "file": BADGE,
     "old": "    parts = [p for p in (quality,\n"
            "                         _vintage_clause(results),\n"
            "                         BACKUP_CLAUSE if any(_is_backup(r) for r in (results or {}).values()) else None)\n",
     "new": "    parts = [p for p in (_vintage_clause(results),\n"
            "                         BACKUP_CLAUSE if any(_is_backup(r) for r in (results or {}).values()) else None,\n"
            "                         quality)\n",
     "tests": [T + "test_the_quality_clause_leads_the_line_and_shares_it"]},
    {"name": "Q3 passing no quality stops being byte-identical to today", "file": BADGE,
     "old": "def render_footer(results: dict, corr_id: str | None, *, quality: str | None = None) -> str:\n",
     "new": 'def render_footer(results: dict, corr_id: str | None, *, quality: str | None = "") -> str:\n'
            '    quality = quality or "chart"\n',
     "tests": [T + "test_omitting_quality_leaves_every_existing_line_byte_identical",
               T + "test_a_healthy_delivery_reads_exactly_as_it_would_undegraded"]},

    # ── C-07: the vintage that travels to the house page ────────────────────
    {"name": "V1 the page is sent a bare date and left to phrase the warning itself", "file": BADGE,
     "old": "    opts = options or {}\n    return render_badge(freshness.Envelope(\n",
     "new": "    opts = options or {}\n"
            "    if opts.get('stale') is True and opts.get('as_of'):\n"
            "        return str(opts['as_of'])\n"
            "    return render_badge(freshness.Envelope(\n",
     "tests": [T + "test_the_house_page_is_handed_the_envelopes_own_sentence",
               V + "test_what_travels_is_the_ONE_sentence_and_not_a_second_phrasing_of_it",
               G + "test_the_render_url_golden_actually_covers_a_stale_render"]},
    {"name": "V2 every render claims a stale vintage (the badge becomes furniture)", "file": BADGE,
     "old": "        provider=None, session_state=\"\", age_s=None, budget_s=None, stale=opts.get(\"stale\")))\n",
     "new": "        provider=None, session_state=\"\", age_s=None, budget_s=None, stale=True))\n",
     "tests": [T + "test_nothing_travels_when_there_is_nothing_to_say",
               T + "test_the_weekend_never_sends_a_badge_to_the_page",
               V + "test_the_page_is_told_nothing_when_there_is_nothing_to_tell_it"]},
    {"name": "V3 the render URL carries no vintage at all (C-07 itself, restored)", "file": HOUSE,
     "old": "    vintage = _vintage_param(opts)\n    if vintage:\n",
     "new": "    vintage = None\n    if vintage:\n",
     "tests": [V + "test_the_render_url_carries_the_vintage_when_the_data_is_stale",
               V + "test_the_comparison_can_actually_fail",
               G + "test_the_render_url_golden_actually_covers_a_stale_render"]},
    {"name": "V4 the vintage is emitted unconditionally, so every pre-V2 URL moves", "file": HOUSE,
     "old": '    params = {"sym": sym, "tf": tf, "w": HOUSE_W, "h": h}\n',
     "new": '    params = {"sym": sym, "tf": tf, "stale": "", "w": HOUSE_W, "h": h}\n',
     "tests": [V + "test_the_pre_v2_url_is_byte_identical_to_the_version_this_lane_started_from",
               G + "test_a_fresh_render_url_capture_matches_the_stored_golden_at_zero_drift"]},
    {"name": "V5 the vintage is inserted before the rest, reordering every stale URL", "file": HOUSE,
     "old": '        params["stale"] = vintage\n',
     "new": '        params = {"stale": vintage, **params}\n',
     "tests": [V + "test_the_vintage_is_the_LAST_parameter_so_nothing_else_shifts",
               G + "test_a_fresh_render_url_capture_matches_the_stored_golden_at_zero_drift"]},
    {"name": "V6 the URL golden stops capturing the stale case (coverage that is none)", "file": GOLD,
     "old": '    ("stale/daily", ("NVDA", "D", URL_STATS), {"stale": True, "as_of": STALE_AT}),\n',
     "new": '    ("stale/daily", ("NVDA", "D", URL_STATS), {}),\n',
     "tests": [G + "test_the_render_url_golden_actually_covers_a_stale_render"]},
    {"name": "B5 a degraded delivery loses the id a member quotes", "file": BADGE,
     "old": '    return _SEP.join(parts) + (f"{_ID}{corr_id}" if corr_id else "")\n',
     "new": "    return _SEP.join(parts)\n",
     "tests": [T + "test_a_degraded_delivery_always_carries_the_id_a_member_quotes",
               T + "test_the_footer_order_is_vintage_then_provenance_then_id"]},
    {"name": "B6 the id is filtered through a format check and dropped", "file": BADGE,
     "old": '    return _SEP.join(parts) + (f"{_ID}{corr_id}" if corr_id else "")\n',
     "new": "    from api.services.discord_render.ids import is_corr_id\n"
            '    return _SEP.join(parts) + (f"{_ID}{corr_id}" if is_corr_id(corr_id) else "")\n',
     "tests": [T + "test_an_odd_looking_id_is_still_printed"]},
    {"name": "B7 the footer becomes two stacked lines", "file": BADGE,
     "old": '    return _SEP.join(parts) + (f"{_ID}{corr_id}" if corr_id else "")\n',
     "new": '    return "\\n".join(parts) + (f"{_ID}{corr_id}" if corr_id else "")\n',
     "tests": [T + "test_one_line_never_two",
               T + "test_the_footer_order_is_vintage_then_provenance_then_id"]},
    {"name": "B8 which stale upstream is named depends on adapter call order (§3.10)", "file": BADGE,
     "old": "    return min(stale)[2] if stale else None\n",
     "new": "    return stale[0][2] if stale else None\n",
     "tests": [T + "test_which_stale_upstream_is_named_does_not_depend_on_call_order"]},

    # ── provenance ──────────────────────────────────────────────────────────
    {"name": "B9 'degraded' replaces the words a member can act on", "file": BADGE,
     "old": 'BACKUP_CLAUSE = "served from a slower backup source"\n',
     "new": 'BACKUP_CLAUSE = "degraded delivery"\n',
     "tests": [T + "test_the_backup_source_is_named_in_words_a_member_can_act_on",
               T + "test_the_footer_order_is_vintage_then_provenance_then_id"]},
    {"name": "B10 only the provider is read, so a cache hit loses its label", "file": BADGE,
     "old": '    return CACHED in (getattr(result, "degraded_reasons", ()) or ())\n',
     "new": "    return False\n",
     "tests": [T + "test_a_cache_hit_labelled_only_by_its_reason_is_still_provenance"]},
    {"name": "B11 a FAILED fetch is reported to the member as a backup delivery", "file": BADGE,
     "old": '    if result is None or not getattr(result, "ok", False):\n        return False\n',
     "new": "    if result is None:\n        return False\n",
     "tests": [T + "test_a_failed_result_is_not_reported_as_a_backup_source"]},

    # ── the stamp on the message ────────────────────────────────────────────
    {"name": "B12 the STAMP is trimmed instead of the CONTENT (S8 with extra steps)", "file": BADGE,
     "old": "    keep = CONTENT_MAX - len(footer) - 2\n"
            '    return (text[:max(0, keep)].rstrip() + "\\n" + footer) if keep > 0 else footer[:CONTENT_MAX]\n',
     "new": "    return joined[:CONTENT_MAX]\n",
     "tests": [T + "test_when_it_does_not_fit_the_CONTENT_is_trimmed_and_the_STAMP_is_kept"]},
    {"name": "B13 the stamp is appended on every edit (the member is warned twice)", "file": BADGE,
     "old": '    text = _drop_previous_stamp(str(content or ""), footer)\n',
     "new": '    text = str(content or "")\n',
     "tests": [T + "test_the_stamp_is_idempotent_across_the_second_edit",
               T + "test_a_second_edit_whose_footer_changed_replaces_rather_than_repeats"]},
    {"name": "B14 the de-duplicator eats the member's own last line", "file": BADGE,
     "old": '    if not sep or not cid or not text.endswith(f"{_ID}{cid}"):\n        return text\n',
     "new": "    if not sep or not cid:\n        return text\n",
     "tests": [T + "test_the_stamp_is_appended_to_the_content_a_member_reads",
               T + "test_a_second_edit_whose_footer_changed_replaces_rather_than_repeats"]},
    {"name": "B15 Discord's ceiling gets a second, wrong spelling", "file": BADGE,
     "old": "CONTENT_MAX = contracts.CONTENT_MAX\n", "new": "CONTENT_MAX = 4000\n",
     "tests": [T + "test_the_content_ceiling_has_one_value_across_every_spelling"]},

    # ── the stand-in label: one table, and it is the contract's ─────────────
    {"name": "B16 the stand-in invents its own sentence (a second table)", "file": BADGE,
     "old": '    return f"{STANDIN_PREFIX} — {contract.plain(contract.normalize_class(cls))}"\n',
     "new": '    return f"{STANDIN_PREFIX} — we drew a simpler chart"\n',
     "tests": [T + "test_every_failure_class_has_a_stand_in_sentence_from_the_one_table",
               T + "test_the_two_classes_that_actually_draw_a_stand_in_read_like_this"]},
    {"name": "B17 the raw class is interpolated, so a traceback can reach a member", "file": BADGE,
     "old": '    return f"{STANDIN_PREFIX} — {contract.plain(contract.normalize_class(cls))}"\n',
     "new": '    return f"{STANDIN_PREFIX} — {cls}"\n',
     "tests": [T + "test_an_unknown_class_cannot_leak_a_traceback_into_the_message",
               T + "test_every_failure_class_has_a_stand_in_sentence_from_the_one_table"]},

    # ── the golden harness (04 §6) ──────────────────────────────────────────
    #
    # ⛔ A GOLDEN IS A COMPARISON, AND A COMPARISON NOBODY HAS SEEN FAIL IS DECORATION. These
    # mutate the INSTRUMENT, not the product: they ask whether the harness would actually notice.
    # ⚰️ G1 first perturbed a bar CLOSE and stayed GREEN — correctly, because the golden records the
    # reply payloads (content, components, attachment names), not the prices that went in. A
    # mutation that changes an input the artifact never captures proves nothing about the artifact.
    # Re-aimed at a field the golden actually stores.
    {"name": "G1 the capture stamps a wall clock into the artifact (its output stops being stable)",
     "file": GOLD,
     "old": '            "stubs": STUBS,\n',
     "new": '            "stubs": STUBS,\n            "captured_at": __import__("time").time(),\n',
     "tests": [G + "test_the_capture_agrees_with_itself"]},
    {"name": "G2 the capture records no replies at all (a golden of nothing)", "file": GOLD,
     "old": "        self.edits.append(_payload(kw))\n", "new": "        pass\n",
     "tests": [G + "test_the_capture_is_not_empty_and_covers_the_replies_a_member_actually_gets",
               G + "test_a_fresh_capture_matches_the_stored_golden_at_zero_drift"]},
    {"name": "G3 image BYTES go into the golden instead of a hash", "file": GOLD,
     "old": '    out = {k: v for k, v in kw.items() if k not in ("png", "pngs", "client")}\n',
     "new": '    out = {k: (repr(v) if k == "png" else v) for k, v in kw.items() if k not in ("pngs", "client")}\n',
     "tests": [G + "test_a_fresh_capture_matches_the_stored_golden_at_zero_drift"]},
    {"name": "G4 the render stub stops depending on what it was asked for", "file": GOLD,
     "old": "    digest = hashlib.sha256(json.dumps(call, sort_keys=True, default=str).encode()).digest()\n",
     "new": '    digest = b"0" * 32\n',
     "tests": [G + "test_a_fresh_capture_matches_the_stored_golden_at_zero_drift"]},
    {"name": "G5 the pre-V2 FETCH PLAN is no longer captured", "file": GOLD,
     "old": '        self.bars_calls.append({"ticker": ticker, "tf": tf, "n": int(n)})\n',
     "new": "        pass\n",
     "tests": [G + "test_a_fresh_capture_matches_the_stored_golden_at_zero_drift"]},
    {"name": "G6 the render REQUEST is no longer captured", "file": GOLD,
     "old": "        self.render_calls.append(call)\n", "new": "        pass\n",
     "tests": [G + "test_a_fresh_capture_matches_the_stored_golden_at_zero_drift"]},
    {"name": "G7 the control tree is dropped from every captured reply", "file": GOLD,
     "old": '    components_fn = di.chart_components if spec.get("components", True) else None\n',
     "new": "    components_fn = None\n",
     "tests": [G + "test_a_fresh_capture_matches_the_stored_golden_at_zero_drift"]},
    {"name": "G8 the stubs stop being part of the golden", "file": GOLD,
     "old": '            "stubs": STUBS,\n', "new": '            "stubs": [],\n',
     "tests": [G + "test_the_stubs_are_part_of_the_golden"]},
    {"name": "G9 an env pin is dropped (the golden only reproduces on one machine)", "file": GOLD,
     "old": '    "DISCORD_CHART_SELF_HEAL": "0",      # the heal schedules a timer; a capture schedules nothing\n',
     "new": "",
     "tests": [G + "test_the_stubs_are_part_of_the_golden"]},
    {"name": "G10 the differ stops reporting leaf differences (every golden passes)", "file": GOLD,
     "old": "    return [] if a == b else [f\"{path or '<root>'}: {a!r} vs {b!r}\"]\n",
     "new": "    return []\n",
     "tests": [G + "test_the_differ_reports_a_change_by_NAME_and_not_as_a_count"]},
    {"name": "G11 the capture stamps today's date into its own world (§3.10)", "file": GOLD,
     "old": '            "world": {"today": FIXED_TODAY, "session_end_unix": FIXED_SESSION_END_UNIX,\n',
     "new": '            "world": {"today": __import__("datetime").date.today().isoformat(),\n'
            "                      \"session_end_unix\": FIXED_SESSION_END_UNIX,\n",
     "tests": [G + "test_the_capture_carries_no_wall_clock",
               G + "test_a_fresh_capture_matches_the_stored_golden_at_zero_drift"]},
    # ⚠️ G12 is the one mutation whose verdict depends on the calendar: it is RED on every day
    # except FIXED_TODAY itself, because that is the day the unpinned clock would agree with the
    # pinned one. Stated rather than hidden — a rail with a quiet exception is worse than none.
    {"name": "G12 the pre-V2 control tree's wall clock is left unpinned", "file": GOLD,
     "old": "    di.pan_to = lambda current_to, tf, zoom, direction, today=None: real_pan_to(\n"
            "        current_to, tf, zoom, direction, today or FIXED_TODAY)\n",
     "new": "    di.pan_to = real_pan_to\n",
     "tests": [G + "test_a_fresh_capture_matches_the_stored_golden_at_zero_drift"]},
]

#: ⛔ THE HARNESS MUST BE ABLE TO REPORT A GREEN, OR ITS REDS MEAN NOTHING. The first is a defect the
#: suite catches; the second is a comment change that could not possibly be caught. `--self-check`
#: expects exactly RED then GREEN — anything else means the runner, not the code, is answering.
SELF_CHECK_CASES = [
    {"name": "SC1 a mutation the suite DOES catch (expect RED)", "file": BADGE, "expect": "RED",
     "old": 'BACKUP_CLAUSE = "served from a slower backup source"\n',
     "new": 'BACKUP_CLAUSE = "degraded delivery"\n',
     "tests": [T + "test_the_backup_source_is_named_in_words_a_member_can_act_on"]},
    {"name": "SC2 a mutation nothing could catch (expect GREEN)", "file": BADGE, "expect": "GREEN",
     "old": "_ID = \" · id \"\n", "new": "_ID = \" · id \"  # a comment, and nothing else\n",
     "tests": [T + "test_a_degraded_delivery_always_carries_the_id_a_member_quotes"]},
]


def read(p):
    return p.read_bytes()


def run(tests):
    cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:randomly", "-x", *tests]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=900)
    out = r.stdout + r.stderr
    # ⛔ A RUN WITHOUT A TOTALS LINE IS NOT A RUN. A runner that died at argument parsing exits
    # non-zero having executed nothing, and "RED" would then mean "the harness is broken".
    m = re.search(r"(\d+) passed|(\d+) failed|(\d+) error", out)
    if not m:
        return "NO TOTALS LINE", out[-400:]
    return ("GREEN" if r.returncode == 0 else "RED"), out.strip().splitlines()[-1][:120]


def apply_and_run(mut):
    """Mutate, run the named tests, restore the exact bytes, verify the restore by sha256."""
    path = ROOT / mut["file"]
    original = read(path)
    sha = hashlib.sha256(original).hexdigest()
    text = original.decode("utf-8")
    eol = "\r\n" if "\r\n" in text else "\n"
    old, new = mut["old"].replace("\n", eol), mut["new"].replace("\n", eol)
    n = text.count(old)
    if n != 1:
        return f"NOT APPLIED ({n} matches)", ""
    try:
        path.write_bytes(text.replace(old, new, 1).encode("utf-8"))
        verdict, tail = run(mut["tests"])
    finally:
        path.write_bytes(original)
        assert hashlib.sha256(read(path)).hexdigest() == sha, f"RESTORE FAILED for {mut['file']}"
    return verdict, tail


def self_check():
    print(f"root: {ROOT}\nself-check: the harness must report RED for a real defect and GREEN for a no-op\n")
    bad = 0
    for case in SELF_CHECK_CASES:
        verdict, tail = apply_and_run(case)
        ok = verdict == case["expect"]
        bad += 0 if ok else 1
        print(f"  {case['name']:<60} {verdict:<16} {'ok' if ok else '*** expected ' + case['expect']}")
    return 0 if not bad else 1


def main():
    if SELF_CHECK:
        return self_check()
    print(f"root: {ROOT}\n")
    control_first = run(SUITES)
    print(f"CONTROL (before)  {control_first[0]}  {control_first[1]}")
    if control_first[0] != "GREEN":
        print("*** the suite is not green before mutating; nothing below would mean anything")
        return 1

    results = []
    for mut in MUTATIONS:
        verdict, tail = apply_and_run(mut)
        results.append((mut["name"], verdict, tail))
        print(f"  {mut['name']:<72} {verdict}")

    control_last = run(SUITES)
    print(f"\nCONTROL (after)   {control_last[0]}  {control_last[1]}")
    red = sum(1 for _, v, _ in results if v == "RED")
    print(f"\n{red}/{len(results)} mutations RED")
    bad = [(n, v) for n, v, _ in results if v != "RED"]
    for n, v in bad:
        print(f"  *** {v}: {n}")
    return 0 if (not bad and control_last[0] == "GREEN") else 1


if __name__ == "__main__":
    sys.exit(main())
