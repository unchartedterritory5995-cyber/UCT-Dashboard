"""Mutation proofs for the evidence engine (the proof record). Each mutation: save the file's bytes, apply
ONE edit, run the NAMED rail from tests/test_evidence_engine.py, expect it red, restore the saved bytes,
verify sha256. Never git checkout.

    python -B tools/vendor_harness/evidence_engine_mutations.py           # every mutation, then the CONTROL
    python -B tools/vendor_harness/evidence_engine_mutations.py --dry     # only check each pattern occurs once

Exit 0 only when every mutation is KILLED and the unmutated rail file is green (the last line says so)."""
import hashlib
import os
import pathlib
import subprocess
import sys

W = pathlib.Path(__file__).resolve().parents[2]
EE = W / "tools" / "vendor_harness" / "evidence_engine.py"
BC = W / "tools" / "vendor_harness" / "batch_capture.py"
RAILS = "tests/test_evidence_engine.py"

LICENCE = "test_the_licence_gate_admits_probes_corpus_and_permitted_headers_only"
PROMOTE = "test_promote_needs_the_packet_sha_and_files_every_verdict"
DRIVER = "test_the_driver_sets_each_scripts_own_symbol_and_tf_and_files_provenance"
THROTTLE = "test_the_throttle_floor_refuses_before_any_browser"
SALT = "test_the_account_fingerprint_is_salted_or_not_recorded"
LOCK = "test_grade_runs_only_under_the_heavy_lock_named_by_HEAVY_LOCK"
E2E = "test_a_corpus_target_runs_from_the_manifest_through_the_driver_to_a_promotable_packet"
STEM = "test_the_capture_stem_is_the_house_slug_and_a_shared_slug_takes_the_sha"
BAD_ID = "test_a_capture_id_off_the_house_form_or_off_its_capture_stem_is_refused"
MISNAMED = "test_an_existing_fixture_is_never_overwritten_and_a_misnamed_file_is_refused"
NO_VERDICT = "test_a_capture_with_no_verdict_is_refused_and_promote_files_nothing_for_it"
PROSE = "test_prose_and_owed_and_no_probe_rows_are_needs_probe_never_a_target"

MUTATIONS = [
    # ── the first eight (2026-11-02, tip ec0882c16a) ──
    ("licence gate always permits", EE,
     'return "permitted" if is_permitted(src.get("text") or "") else "held"', 'return "permitted"', LICENCE),
    ("packet sha not checked", EE, "    if not sha.startswith(packet_sha):\n", "    if False:\n", PROMOTE),
    ("rebuilt packet not compared", EE, "    if now != on_disk:\n", "    if False:\n",
     "test_a_run_that_changed_after_the_packet_refuses"),
    ("live guard removed", EE, 'elif t["needsLive"] and st in (None, "STALE"):',
     'elif False and st in (None, "STALE"):', "test_a_live_row_is_needs_live_and_never_reaches_a_manifest"),
    ("fixture overwrite admitted (the file in its own directory)", EE,
     'if (pathlib.Path(fixtures_dir) / f"{cid}.json").exists() or cid in world.fixture_ids:',
     "if cid in world.fixture_ids:", PROMOTE),
    ("per-script chart ignored", BC, '        if not any(script.get(k) for k in ("symbol", "tf", "listingDate")):\n',
     "        if True:\n", DRIVER),
    ("throttle floor removed", BC, "    if t < MIN_THROTTLE_S:\n", "    if False:\n", THROTTLE),
    ("account name kept in clear", BC,
     '    return hmac.new(salt.encode("utf-8"), name.encode("utf-8"), hashlib.sha256).hexdigest()[:12]',
     "    return name", SALT),
    # ── the review's lows: pacing, provenance salt, the heavy lock ──
    ("a non-finite throttle admitted", BC, "    if not math.isfinite(t):\n", "    if False:\n", THROTTLE),
    ("the run CLI skips the pacing authority", BC, "        why = throttle_refusal(args.throttle_s)\n",
     "        why = None\n", THROTTLE),
    ("the evidence batch skips the pacing authority", EE, "            why = throttle_refusal(args.throttle_s)\n",
     "            why = None\n", THROTTLE),
    ("account fingerprint unsalted", BC,
     '    return hmac.new(salt.encode("utf-8"), name.encode("utf-8"), hashlib.sha256).hexdigest()[:12]',
     '    return hashlib.sha256(name.encode("utf-8")).hexdigest()[:12]', SALT),
    ("an unset salt still fingerprints", BC, "    return s if len(s) >= MIN_SALT_CHARS else None",
     "    return s", SALT),
    ("a short salt is accepted", BC, "    return s if len(s) >= MIN_SALT_CHARS else None",
     "    return s or None", SALT),
    ("grade runs unlocked when no lock tool is found", EE, "    if lock is None:\n        return None\n",
     "    if lock is None:\n        return cmd\n", LOCK),
    ("HEAVY_LOCK is not read from the environment", EE,
     '    p = pathlib.Path(os.environ.get("HEAVY_LOCK") or DESKTOP_HEAVY_LOCK)',
     "    p = pathlib.Path(DESKTOP_HEAVY_LOCK)", LOCK),
    ("the batch skips the lock pre-flight", EE, "            if heavy_lock_tool() is None:\n",
     "            if False:\n", LOCK),
    ("grade ignores a missing lock", EE, "    if wrapped is None:\n", "    if False:\n", LOCK),
    # ── finding 2: the queue never invents a target ──
    ("a guessed chart is QUEUED", EE, '        if chart_defaulted:\n            st = "NEEDS_CHART"',
     '        if False:\n            st = "NEEDS_CHART"', "test_a_row_with_no_chart_is_needs_chart_and_never_reaches_a_manifest"),
    ("the manifest takes a guessed chart", EE, ' and not t.get("chartDefaulted")', "",
     "test_a_row_with_no_chart_is_needs_chart_and_never_reaches_a_manifest"),
    ("an unreadable chart falls back to the preamble's", EE,
     '            elif unparsed:\n                charts, chart_source = [], "default"\n',
     '            elif False:\n                charts, chart_source = [], "default"\n',
     "test_a_row_naming_a_chart_the_parser_cannot_read_is_needs_chart_not_the_preambles"),
    ("a fixture reference is read as a source", EE,
     "            fx.append(hit)       # a REFERENCE to a capture of `hit`, never a source",
     '            fx.append(hit); sources.append(("probe", world.probes[hit]))',
     "test_a_fixture_reference_is_never_a_source_and_the_section_decides"),
    ("an ambiguous section falls back to the preamble", EE,
     "        inherit_from = lead_sources if lead_sources else pre_sources",
     "        inherit_from = lead_sources if len(lead_sources) == 1 else pre_sources",
     "test_a_fixture_reference_is_never_a_source_and_the_section_decides"),
    ("a CAPTURED heading is not recognised", EE, "if FINISHED_HEAD_RX.match(", "if False and FINISHED_HEAD_RX.match(",
     "test_a_finished_capture_table_is_context_not_queue"),
    ("a capture column of committed ids is not recognised", EE,
     "        if toks and all(t in world.fixture_ids for t in toks):", "        if False:",
     "test_a_finished_capture_table_is_context_not_queue"),
    ("a bare symbol in preamble prose is read as a chart", EE, "        if prose and not m.group(1):\n            continue\n",
     "        if False:\n            continue\n", "test_bare_symbols_in_preamble_prose_are_never_a_chart"),
    ("the fixture index is not recursive", EE, 'self.fixtures.rglob("*.json")', 'self.fixtures.glob("*.json")',
     "test_a_capture_beside_the_harness_dir_closes_its_target"),
    ("an id committed in another directory is filed again", EE,
     'if (pathlib.Path(fixtures_dir) / f"{cid}.json").exists() or cid in world.fixture_ids:',
     'if (pathlib.Path(fixtures_dir) / f"{cid}.json").exists():', MISNAMED),
    # ── finding 1: one capture stem for the manifest, the stale lookup and the gate ──
    ("the manifest hands the driver the raw stem", EE, '            "captureStem": capture_stem(world, p),',
     '            "captureStem": t["stem"],', E2E),
    ("the gate holds an id to the raw stem", EE, "        want = capture_stem(world, src[1])",
     "        want = pathlib.Path(src[1]).stem", E2E),
    ("the stale lookup reads the raw stem", EE,
     "    lead = f\"{capture_stem(world, path)}-{slugify(symbol.split(':')[-1])}-\"",
     "    lead = f\"{pathlib.Path(path).stem}-{slugify(symbol.split(':')[-1])}-\"",
     "test_a_stale_corpus_capture_is_found_by_its_capture_stem"),
    ("a shared slug is not disambiguated", EE, "if len(files) > 1 else base", "if False else base", STEM),
    ("the house slug keeps the corpus hash", EE, 'str(stem).split("__", 1)[0].lower()', "str(stem).lower()", STEM),
    ("an id off the house form is admitted", EE, "    elif not ID_RX.match(cid):\n", "    elif False:\n", BAD_ID),
    ("a known source's id is not held to its capture stem", EE,
     '        if not (cid.startswith(want + "-") and TAIL_RX.fullmatch(cid[len(want) + 1:])):',
     "        if False:", BAD_ID),
    # ── the gate, the packet, promote, the ledger ──
    ("a misnamed file is admitted", EE, "    if cid != path.stem:\n", "    if False:\n", MISNAMED),
    ("verify_capture's refusal is ignored", EE, '    if not v.get("ok"):\n', "    if False:\n",
     "test_a_capture_verify_capture_refuses_is_refused"),
    ("a capture with no verdict is admitted", EE, "        if v is None:\n", "        if False:\n", NO_VERDICT),
    ("a REFUSE item is filed", EE, '        if i["action"] == "REFUSE":\n', "        if False:\n", NO_VERDICT),
    ("promotion overwrites a fixture that appeared after the check", EE, "            if dst.exists():\n",
     "            if False:\n", "test_promote_never_overwrites_a_fixture_that_appeared_after_the_check"),
    ("the ledger files a capture twice", EE,
     '    new = [r for r in rows if (r["captureId"], r["receipt"]) not in have]', "    new = list(rows)",
     "test_the_ledger_files_each_capture_once"),
    ("a missing or short packet sha is accepted", EE,
     '    if not packet_sha or not re.fullmatch(r"[0-9a-f]{12,64}", packet_sha):\n', "    if False:\n",
     "test_promote_refuses_a_missing_or_short_packet_sha_and_a_missing_packet"),
    ("a missing packet is not refused", EE, "    if not pj.exists():\n", "    if False:\n",
     "test_promote_refuses_a_missing_or_short_packet_sha_and_a_missing_packet"),
    ("a licence-held capture is promoted", EE,
     '"action": ("REFUSE" if problems else "LEDGER_ONLY" if held else "PROMOTE"),',
     '"action": ("REFUSE" if problems else "PROMOTE"),', LICENCE),
    ("the manifest takes a file newer than its queue", EE,
     "            continue    # the queue is older than the file: re-run `queue`", "            pass",
     "test_a_queue_older_than_its_file_never_reaches_a_manifest"),
    # ── the parser's older guards, proved now ──
    ("a ledger table is queued", EE,
     "        if (set(header) & LEDGER_HEADERS) or (header and header[0] in LEDGER_FIRST_HEADERS):\n",
     "        if False:\n", "test_a_ledger_table_is_counted_as_context_not_queued"),
    ("a no-probe row inherits a source", EE, "and not NO_PROBE_RX.search(rtext) and len(inherit_from) == 1",
     "and len(inherit_from) == 1", PROSE),
    ("an inline probe shape inherits a source", EE,
     r'                    and not re.search(r"\bprobe(?: shape)?:|indicator\(", rtext):',
     "                    and True:", PROSE),
    ("an owed probe inherits a source", EE, "if not sources and not owed and not NO_PROBE_RX",
     "if not sources and not NO_PROBE_RX", PROSE),
    ("a version variant reads as the plain file", EE, "            variant = bool(VARIANT_RX.search(rtext))",
     "            variant = False", "test_a_version_variant_takes_its_sibling_file_or_needs_a_probe"),
    ("STALE is never derived", EE, '    if stale:\n        return "STALE"', '    if False:\n        return "STALE"',
     "test_status_is_derived_from_fixtures_captured_and_stale"),
    ("RDDT's listing day carries over to another symbol", BC,
     '            o.listing_date = script.get("listingDate") or KNOWN_LISTING.get(o.symbol.upper())',
     "            pass", DRIVER),
]


def adapt(text, a, b):
    """A checkout under core.autocrlf=true can hold CRLF on disk while these patterns are written with LF."""
    if "\r\n" in text:
        return a.replace("\n", "\r\n"), b.replace("\n", "\r\n")
    return a, b


def main() -> int:
    dry = "--dry" in sys.argv
    bad = []
    for label, path, a, b, rail in MUTATIONS:
        text = path.read_bytes().decode("utf-8")
        a2, _ = adapt(text, a, b)
        if text.count(a2) != 1:
            bad.append(f"BADMATCH {text.count(a2)}x  {label}")
    if bad or dry:
        print("\n".join(bad) or f"patterns: all {len(MUTATIONS)} occur exactly once")
        print(f"VERDICT: {'FAIL' if bad else 'PASS'} (pattern check)")
        return 1 if bad else 0
    out, killed = [], 0
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    for label, path, a, b, rail in MUTATIONS:
        saved = path.read_bytes()
        sha = hashlib.sha256(saved).hexdigest()
        text = saved.decode("utf-8")
        a2, b2 = adapt(text, a, b)
        try:
            path.write_bytes(text.replace(a2, b2).encode("utf-8"))
            # pycache defeats a same-length mutation: never write bytecode
            p = subprocess.run([sys.executable, "-B", "-m", "pytest", RAILS, "-q", "-p", "no:cacheprovider", "-k", rail],
                               cwd=str(W), capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
            last = p.stdout.strip().splitlines()[-1] if p.stdout.strip() else p.stderr.strip()[-200:]
            red = p.returncode != 0 and ("failed" in last or "error" in last)
            killed += red
            out.append(f"{'KILLED  ' if red else 'SURVIVED'}  {label}  -> {rail}  (exit {p.returncode}; {last})")
        finally:
            path.write_bytes(saved)
            assert hashlib.sha256(path.read_bytes()).hexdigest() == sha, f"restore failed for {path}"
        print(out[-1], flush=True)
    # control: unmutated, the same rails are green
    p = subprocess.run([sys.executable, "-B", "-m", "pytest", RAILS, "-q", "-p", "no:cacheprovider"],
                       cwd=str(W), capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    control = p.stdout.strip().splitlines()[-1] if p.stdout.strip() else p.stderr[-400:]
    print("CONTROL:", control)
    ok = killed == len(MUTATIONS) and p.returncode == 0 and "passed" in control and "failed" not in control
    print(f"VERDICT: {'PASS' if ok else 'FAIL'} ({killed}/{len(MUTATIONS)} KILLED; control exit {p.returncode})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
