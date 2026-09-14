"""Mutation proofs for OI-29 — the chart IMAGE through the delivery layer, and C-04's closure.

Same contract as the harnesses beside it: one mutation at a time, exact single replacement,
EOL-aware, byte-restore verified by sha256, never `git checkout`, and a control run BEFORE as well
as after — a mutation table means nothing if the suite was already red.

⛔⛔ THE FIRST MUTATION IN THE TABLE IS THE ONE THAT MATTERS, AND IT IS THE FIXTURE, NOT THE CODE.
`M0` makes the fake Discord stop refusing an attachment id it was handed no bytes for. If the C-04
closure test still passes with `M0` in, then that test is measuring the fixture's politeness rather
than the fold, and every green below it is worthless. A differential without a failing leg is not a
differential — it is a test that cannot distinguish (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

⛔ TWO FILES, AND THEY ARE BOTH THIS LANE'S. `delivery.py` and `adapters/bindings.py`. The lanes
beside this one own `_call.py`, `artifact_cache.py` and `badge.py`; a harness that edits a file
another session is holding is how a restore lands on top of somebody else's work.

Usage:  python docs/discord-render/instruments/mutation_harness_image_delivery.py [repo-root]
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

# ⛔ FLAGS ARE NOT PATHS. `sys.argv[1]` was taken as the repo root unconditionally, so
# `--dry-check` resolved to a directory of that name and every mutation reported "file missing" —
# an instrument reporting a property of its own argument parsing as a property of the repository.
_ARGS = [a for a in sys.argv[1:] if not a.startswith("-")]
ROOT = Path(_ARGS[0]).resolve() if _ARGS else Path(__file__).resolve().parents[3]

# ⛔ B4/B5 — ONE shared guard, imported, never copy-pasted (a guard repeated is a guard
# unproved). It refuses to run unless this tree is a sacrificed mutation sandbox, then
# refuses to start an 18-minute run on an anchor that no longer matches its source.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness_guard import guard  # noqa: E402

guard(ROOT, __file__)
DEL = "api/services/discord_render/delivery.py"
BIND = "api/services/discord_render/adapters/bindings.py"
CMD = "api/services/discord_render/commands.py"
REND = "api/services/discord_render/adapters/renderer.py"
TESTS = "tests/test_discord_render_image_delivery.py"
T = TESTS + "::"
F = "tests/test_discord_render_forensics.py::"
CW = "tests/test_discord_render_cache_wiring.py::"
CACHE = "api/services/discord_render/artifact_cache.py"
#: Green with every mutation reverted. `delivery.py` and `bindings.py` are both reached by the
#: adapter-boundary suite, so a change that breaks the text path shows up here too.
SUITE = [TESTS,
         "tests/test_discord_render_delivery.py",
         "tests/test_discord_render_adapters.py",
         "tests/test_discord_render_adapter_boundary.py",
         "tests/test_discord_render_v2_core.py",
         "tests/test_discord_render_forensics.py",
         "tests/test_discord_render_vintage_producer.py",
         "tests/test_discord_render_vintage_url.py",
         "tests/test_discord_render_badge.py",
         "tests/test_discord_render_cache_wiring.py",
         "tests/test_discord_render_artifact_cache.py"]

MUTATIONS = [
    # ── M0: the NON-VACUITY CONTROL. Read this file's docstring before deleting it. ──
    {"name": "M0 [non-vacuity] the fake Discord stops refusing a stale attachment id",
     "file": TESTS,
     "old": "    return any(str(d) not in {str(u) for u in uploaded} for d in declared)\n",
     "new": "    return False\n",
     "tests": [T + "test_c04_the_prev2_two_patch_sequence_still_reproduces_the_measured_400"]},

    # ── C-04: the fold is what closes the class ────────────────────────────
    {"name": "M1 the fold is removed — the ids are re-declared exactly as before (C-04 returns)",
     "file": BIND,
     "old": "    if \"keep_attachments\" not in kw:\n        return kw\n",
     "new": "    return kw\n    if \"keep_attachments\" not in kw:\n        return kw\n",
     "tests": [T + "test_c04_the_v2_path_never_declares_an_attachment_id_it_is_not_uploading",
               T + "test_c04_every_edit_in_the_sequence_is_accepted_by_the_discord_that_refused_the_old_one"]},
    {"name": "M2 the fold drops the ids without re-uploading (a text edit deletes the chart)",
     "file": BIND,
     "old": "    if len(images) == 1:\n        out[\"png\"], out[\"filename\"] = images[0]\n"
            "    else:\n        out[\"pngs\"] = list(images)\n",
     "new": "    pass\n",
     "tests": [T + "test_c04_the_v2_path_never_declares_an_attachment_id_it_is_not_uploading"]},
    {"name": "M3 the delivered bytes are never remembered, so there is nothing to fold with",
     "file": BIND,
     "old": "        if sent and images:\n            _remember_images(ctx, images)\n",
     "new": "        pass\n",
     "tests": [T + "test_c04_the_v2_path_never_declares_an_attachment_id_it_is_not_uploading"]},
    {"name": "M4 a fold that cannot happen is silent (C-04 back with no evidence it returned)",
     "file": BIND,
     "old": "        observe.event(\"fold_unavailable\", cid=cid, outcome=\"passthrough\",\n"
            "                      detail=\"no bytes held; ids re-declared as before\")\n",
     "new": "        pass\n",
     "tests": [T + "test_the_fold_is_recorded_when_it_cannot_happen_rather_than_silently_skipped"]},
    {"name": "M5 the fold memo is unbounded (a multi-chart job pins megabytes to a context)",
     "file": BIND,
     "old": "        if total > FOLD_MAX_BYTES:\n",
     "new": "        if False:\n",
     "tests": [T + "test_an_image_too_large_to_fold_is_named_and_not_held"]},

    # ── the attachment ids name parts in the SAME request ──────────────────
    {"name": "M6 the id stops naming the part index (the invariant the class turns on)",
     "file": DEL,
     "old": "        parts.append({\"id\": i, \"filename\": str(filename)})\n",
     "new": "        parts.append({\"id\": i + 1, \"filename\": str(filename)})\n",
     "tests": [T + "test_c04_the_v2_path_never_declares_an_attachment_id_it_is_not_uploading",
               T + "test_the_image_patch_is_multipart_and_does_not_set_its_own_content_type",
               T + "test_the_multi_chart_path_uploads_every_image_and_declares_exactly_those_ids"]},
    {"name": "M7 only the first image of a multi-chart reply is uploaded",
     "file": DEL,
     "old": "    for i, item in enumerate(images or []):\n",
     "new": "    for i, item in enumerate(list(images or [])[:1]):\n",
     "tests": [T + "test_the_multi_chart_path_uploads_every_image_and_declares_exactly_those_ids"]},

    # ── the multipart body itself ──────────────────────────────────────────
    {"name": "M8 a hand-written Content-Type omits the boundary (400 on a correct body)",
     "file": DEL,
     "old": "                resp = getattr(c, method)(url, data={\"payload_json\": json.dumps(payload)},\n"
            "                                          files=files, timeout=timeout_s)\n",
     "new": "                resp = getattr(c, method)(url, data={\"payload_json\": json.dumps(payload)},\n"
            "                                          files=files, timeout=timeout_s,\n"
            "                                          headers={\"Content-Type\": \"multipart/form-data\"})\n",
     "tests": [T + "test_the_image_patch_is_multipart_and_does_not_set_its_own_content_type"]},
    {"name": "M9 the file parts are dropped on a retry (attempt 2 sends ids and no bytes)",
     "file": DEL,
     "old": "        res = _once(method, url, payload, client, files=files,\n",
     "new": "        res = _once(method, url, payload, client, files=(files if attempt == 1 else None),\n",
     "tests": [T + "test_a_server_error_on_the_image_patch_is_retried_within_the_budget"]},

    # ── the policy the text path already had ───────────────────────────────
    {"name": "M10 the image PATCH is sent once, with no retry policy (the pre-V2 shape)",
     "file": DEL,
     "old": "    res = _send(\"patch\", url, payload, client, files=files, cid=cid,\n",
     "new": "    res = _once(\"patch\", url, payload, client, files=files, cid=cid, attempt=1,\n"
            "                timeout_s=IMAGE_TIMEOUT_S) if True else _send(\n"
            "        \"patch\", url, payload, client, files=files, cid=cid,\n",
     "tests": [T + "test_a_server_error_on_the_image_patch_is_retried_within_the_budget",
               T + "test_a_429_on_the_image_patch_honours_discords_own_wait"]},
    {"name": "M11 the image timeout ignores the job's remaining budget",
     "file": DEL,
     "old": "                    timeout_s=min(ceiling_s, max(MIN_USEFUL_S, left)), attempt=attempt, cid=cid)\n",
     "new": "                    timeout_s=ceiling_s, attempt=attempt, cid=cid)\n",
     "tests": ["tests/test_discord_render_delivery.py::"
               "test_the_request_timeout_is_the_smaller_of_the_ceiling_and_what_is_left"]},
    {"name": "M12 a dead token is spoken to a second time through a text fallback",
     "file": DEL,
     "old": "    if res.ok or res.token_dead:\n",
     "new": "    if res.ok:\n",
     "tests": [T + "test_a_dead_token_is_not_followed_by_a_second_attempt_or_a_text_fallback"]},

    # ── the size guard, and C-11 behind it ─────────────────────────────────
    {"name": "M13 the size guard is removed (40005 instead of a named class)",
     "file": DEL,
     "old": "    if total > ATTACHMENT_MAX_BYTES:\n        return {}, [], total\n",
     "new": "    pass\n",
     "tests": [T + "test_an_oversize_image_is_refused_before_the_round_trip_and_the_member_is_still_told"]},
    {"name": "M14 a refused image ends in silence (C-11: 46 failures, no member message)",
     "file": DEL,
     "old": "    alt = edit_text(app_id, token, content=_no_image_text(text), client=client,\n"
            "                    deadline_s=deadline_s, cid=cid, **policy)\n",
     "new": "    return res\n    alt = edit_text(app_id, token, content=_no_image_text(text), client=client,\n"
            "                    deadline_s=deadline_s, cid=cid, **policy)\n",
     "tests": [T + "test_a_refused_image_still_ends_in_a_sentence"]},
    {"name": "M15 the note is trimmed instead of the content on a full-length reply",
     "file": DEL,
     "old": "    return (content[:max(0, keep)].rstrip() + \"\\n\" + note) if keep > 0 else note\n",
     "new": "    return joined[:contract.CONTENT_MAX]\n",
     "tests": [T + "test_the_note_survives_a_full_length_reply_and_the_content_is_what_gets_trimmed"]},

    # ── the contract the pre-V2 call site still depends on ─────────────────
    {"name": "M16 a 2xx with an unreadable body reads as a failed delivery",
     "file": BIND,
     "old": "        return (res.message or True) if res.ok else False\n",
     "new": "        return res.message if res.ok else False\n",
     "tests": [T + "test_a_2xx_with_an_unreadable_body_is_a_success_not_a_failed_delivery"]},
    {"name": "M17 the kill switch is captured at construction (inert for the life of the pod)",
     "file": BIND,
     "old": "        from api.services import discord_interactions as di\n        if not adapters_enabled():\n",
     "new": "        from api.services import discord_interactions as di\n        if False:\n",
     "tests": [T + "test_the_kill_switch_routes_back_to_the_raw_function_and_is_read_per_call"]},
    {"name": "M18 the delivery failure is invisible to the runtime that has to explain it",
     "file": CMD,
     "old": "    res = bindings.last_delivery_failure()\n    if res is not None:\n        return res\n",
     "new": "    pass\n",
     "tests": [T + "test_a_failed_image_delivery_is_readable_by_the_runtime_that_has_to_explain_it"]},
    {"name": "M19 the failure slot is module-level, so one member's failure lands on another's job",
     "file": BIND,
     "old": "_LOCAL = threading.local()\n",
     "new": "class _Shared:\n    pass\n\n\n_LOCAL = _Shared()\n",
     "tests": [T + "test_one_members_delivery_failure_never_lands_on_another_members_job"]},

    # ── the V2 runtime actually uses it ────────────────────────────────────
    {"name": "M20 the runtime is handed the raw edit again (built, tested, green, unreachable)",
     "file": CMD,
     "old": "            _runtime = JobRuntime(store=JobsStore(), handlers=HANDLERS, edit_fn=delivery_edit_fn(),\n",
     "new": "            _runtime = JobRuntime(store=JobsStore(), handlers=HANDLERS, edit_fn=di.edit_original,\n",
     "tests": [T + "test_the_v2_runtime_is_actually_handed_the_delivery_backed_edit"]},

    # ── C-06: the stand-in says so, in the message, and ONLY when it is one ─
    {"name": "C1 the stand-in label is never composed (three unlabelled stand-ins return)",
     "file": BIND,
     "old": "        quality=badge_mod.standin_label(cls) if cls else None)\n",
     "new": "        quality=None)\n",
     "tests": [F + "test_c06_a_delivered_standin_says_so_in_the_message_a_member_reads"]},
    {"name": "C2 every chart is labelled a stand-in (the label becomes furniture)",
     "file": BIND,
     "old": "    if not has_image:\n        return None\n    r = last_result(ctx, \"renderer\")\n"
            "    if r is None or r.ok:\n        return None\n",
     "new": "    if not has_image:\n        return None\n    r = last_result(ctx, \"renderer\")\n"
            "    if False:\n        return None\n",
     "tests": [F + "test_c06_a_house_chart_carries_no_stand_in_label_and_that_is_the_control"]},
    {"name": "C3 a failure with no image is called a simplified chart (naming an artifact "
             "that does not exist)",
     "file": BIND,
     "old": "    if not has_image:\n        return None\n    r = last_result(ctx, \"renderer\")\n",
     "new": "    if False:\n        return None\n    r = last_result(ctx, \"renderer\")\n",
     "tests": [F + "test_c06_a_failure_with_no_image_is_never_called_a_simplified_chart"]},
    {"name": "C4 bindings composes the footer itself again (two authors over one sentence)",
     "file": BIND,
     "old": "    return badge_mod.stamp(content, stamp_suffix(ctx, has_image=has_image))\n",
     "new": "    text = str(content or \"\")\n"
            "    suffix = stamp_suffix(ctx, has_image=has_image)\n"
            "    return f\"{text}\\n{suffix}\" if suffix else text\n",
     "tests": ["tests/test_discord_render_adapters.py::"
               "test_when_it_does_not_fit_the_CONTENT_is_trimmed_and_the_STAMP_is_kept"]},

    # ── C-07: the producer, without which the whole chain is unwired ───────
    {"name": "V1 the vintage producer is removed (built, tested, green and reachable by nobody)",
     "file": REND,
     "old": "    if envelope is None:\n        return dict(options or {})\n",
     "new": "    return dict(options or {})\n    if envelope is None:\n        return dict(options or {})\n",
     "tests": ["tests/test_discord_render_vintage_producer.py::"
               "test_a_stale_envelope_reaches_the_render_call_as_a_vintage_the_url_can_carry"]},
    {"name": "V2 the producer is built but the render call still gets the raw options",
     "file": REND,
     "old": "        NAME, lambda _timeout_s: house_fn(req.ticker, req.tf, req.stats, dict(options)),\n",
     "new": "        NAME, lambda _timeout_s: house_fn(req.ticker, req.tf, req.stats, dict(req.options)),\n",
     "tests": ["tests/test_discord_render_vintage_producer.py"]},
    {"name": "V3 the producer overwrites a caller's own vintage (a second authority)",
     "file": REND,
     "old": "    if \"stale\" not in out:\n        out[\"stale\"] = envelope.stale\n",
     "new": "    out[\"stale\"] = envelope.stale\n",
     "tests": ["tests/test_discord_render_vintage_producer.py::"
               "test_a_callers_own_vintage_is_never_overwritten"]},
    {"name": "V4 an unknown vintage is coerced to fresh (the tri-state collapses)",
     "file": REND,
     "old": "        out[\"stale\"] = envelope.stale\n",
     "new": "        out[\"stale\"] = bool(envelope.stale)\n",
     "tests": ["tests/test_discord_render_vintage_producer.py::"
               "test_an_unknown_vintage_is_carried_as_unknown_and_never_as_fresh"]},
    # ── Gap 1: the cache wired to the hot path, and OI-32 ──────────────────
    {"name": "W1 the flag is ignored, so the cache is consulted with RENDER_CACHE_ENABLED unset",
     "file": BIND,
     "old": "    if not artifact_cache.enabled():\n        return produce()\n",
     "new": "    if False:\n        return produce()\n",
     "tests": [CW + "test_with_the_flag_off_the_render_path_is_byte_for_byte_what_it_was"]},
    {"name": "W2 the vintage leaves the key (the cache serves yesterday under today's badge)",
     "file": BIND,
     "old": "    }, vintage=artifact_cache.vintage_of(envelope))\n",
     "new": "    }, vintage=None)\n",
     "tests": [CW + "test_a_new_vintage_is_a_new_entry_so_a_hit_can_never_serve_yesterdays_chart"]},
    {"name": "W3 the whole options dict goes into the key (a 0 % hit rate nobody notices)",
     "file": BIND,
     "old": "        \"opts\": artifact_cache.normalise_args({k: v for k, v in (options or {}).items()\n"
            "                                               if k in RENDER_KEY_OPTS}),\n",
     "new": "        \"opts\": artifact_cache.normalise_args(dict(options or {})),\n",
     "tests": [CW + "test_an_option_that_does_not_change_the_picture_does_not_split_the_key"]},
    {"name": "W4 the render is never stored, so every lookup misses forever",
     "file": BIND,
     "old": "        store.put(key, artifact_cache.Artifact(data=data, envelope=envelope, provider=\"renderer\"))\n",
     "new": "        pass\n",
     "tests": [CW + "test_with_the_flag_on_a_second_identical_render_is_served_from_the_cache"]},
    {"name": "W5 an option that changes the picture stops changing the key",
     "file": BIND,
     "old": "RENDER_KEY_OPTS = (\"style\", \"darkpool\", \"compare\", \"to\", \"ext\", \"bars\", \"instances\")\n",
     "new": "RENDER_KEY_OPTS = ()\n",
     "tests": [CW + "test_a_render_option_that_changes_the_picture_changes_the_key"]},
    {"name": "W6 [OI-32] the heap tier caches a stand-in (C-06 institutionalised)",
     "file": CACHE,
     "old": "        if artifact.is_standin:\n"
            "            # ⛔ OI-32: refused at the DOOR, before either tier, so neither can be the one that\n",
     "new": "        if False:\n"
            "            # ⛔ OI-32: refused at the DOOR, before either tier, so neither can be the one that\n",
     "tests": [CW + "test_a_stand_in_is_never_stored_by_either_tier"]},
    {"name": "W7 [OI-32] the volume tier caches a stand-in, so it survives a restart",
     "file": CACHE,
     "old": "        if artifact.is_standin:\n"
            "            # ⛔ OI-32, again and on purpose. L2 is reachable directly (the determinism runner does\n",
     "new": "        if False:\n"
            "            # ⛔ OI-32, again and on purpose. L2 is reachable directly (the determinism runner does\n",
     "tests": [CW + "test_the_volume_tier_refuses_a_stand_in_on_its_own"]},
    {"name": "W8 the TTL stops shortening at the close (an RTH chart held into the post-session)",
     "file": CACHE,
     "old": "def ttl_s(state: str) -> float | None:\n",
     "new": "def ttl_s(state: str) -> float | None:\n    return 3600.0\n",
     "tests": [CW + "test_an_entry_cached_in_one_session_does_not_outlive_the_session_change"]},

    {"name": "V5 the producer fires with no envelope (every pre-V2 render URL moves)",
     "file": REND,
     "old": "    if envelope is None:\n        return dict(options or {})\n",
     "new": "    if envelope is None:\n        return {**dict(options or {}), \"stale\": False}\n",
     "tests": ["tests/test_discord_render_vintage_producer.py::"
               "test_no_envelope_leaves_the_options_untouched_which_is_the_prev2_guarantee",
               "tests/test_discord_render_vintage_url.py"]},
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


def dry_check() -> int:
    """Does every mutation still find its anchor, exactly once? One second, no tests run.

    ⛔ RUN THIS BEFORE A TWENTY-FIVE MINUTE SET. A stale anchor is a proof that did not happen,
    and it is reported at the END, under the number people quote. Measured twice in two days: A29
    sat stale for several merges, and then seven more went stale in one session because the
    integrator's own patch moved the lines they anchored on."""
    bad = []
    for mut in MUTATIONS:
        path = ROOT / mut["file"]
        if not path.exists():
            bad.append((mut["name"], "file missing"))
            continue
        text = path.read_bytes().decode("utf-8")
        eol = "\r\n" if "\r\n" in text else "\n"
        n = text.count(mut["old"].replace("\n", eol))
        if n != 1:
            bad.append((mut["name"], f"{n} matches"))
    for name, why in bad:
        print(f"  NOT APPLIED ({why}): {name}")
    print(f"TOTALS mutation_harness_image_delivery --dry-check "
          f"{'PASS' if not bad else 'FAIL'} mutations={len(MUTATIONS)} stale={len(bad)}")
    return 0 if not bad else 1


def main():
    if "--dry-check" in sys.argv:
        return dry_check()
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
            print(f"  {mut['name']:<80} NOT APPLIED ({n} matches)")
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
        print(f"  {mut['name']:<80} {verdict}")

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
