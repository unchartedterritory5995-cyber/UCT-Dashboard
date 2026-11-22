"""Mutation proofs for the evidence engine (the proof record). Each mutation: save the file's bytes, apply
ONE edit, run the NAMED rail from tests/test_evidence_engine.py (or the rails file a mutation names as its sixth
element), expect it red, restore the saved bytes, verify sha256. Never git checkout.

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
EL = W / "tools" / "vendor_harness" / "evidence_ledger.py"
BC = W / "tools" / "vendor_harness" / "batch_capture.py"
DOC = W / "docs" / "pine" / "EVIDENCE-ENGINE-DESIGN.md"
RAILS = "tests/test_evidence_engine.py"
#: The driver's own rails (the recording double): a mutation of `batch_capture.py` names this file as its sixth element.
BATCH_RAILS = "tests/test_vendor_batch_capture.py"

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
MANIFEST_STEM = "test_a_capture_is_held_to_the_stem_its_run_manifest_asked_for_not_to_todays_world"
MANIFEST_STEM_ONLY = "test_a_manifest_stem_is_still_the_stem_an_id_must_open_with_and_only_for_its_own_source"
SECTION = "test_a_sections_chart_beats_the_preambles_and_the_listing_flag_follows_the_chart_that_was_used"
PROSE_CELL = "test_a_probe_named_in_a_prose_cell_is_a_reference_never_a_request"
HEADING = "test_a_finished_capture_heading_is_recognised_numbered_or_in_any_case"
LOCAL_EVIDENCE = "test_there_is_no_local_evidence_mode_and_the_design_doc_says_so"
# ── the capture phase (2026-11-19) ──
PHASE_ID = "test_a_capture_id_parses_with_and_without_a_phase_and_an_unknown_phase_is_refused"
PHASE_CELL = "test_a_phase_cell_outside_the_vocabulary_refuses_the_queue_by_name"
PHASE_TARGETS = "test_phased_rows_of_one_probe_and_chart_are_distinct_targets_and_unphased_ones_merge_as_before"
PHASE_CHECK = "test_queue_check_refuses_phased_rows_that_would_collide_and_passes_distinct_phases"
PHASE_STATUS = "test_fixture_status_matches_a_capture_by_its_phase"
PHASE_MANIFEST = "test_the_manifest_carries_each_phase_as_its_own_script"
BATCH_ID = "test_the_capture_id_carries_the_phase_and_an_unphased_id_is_unchanged"
BATCH_VOCAB = "test_a_capture_phase_outside_the_vocabulary_is_refused_before_any_page_step"
BATCH_CLASH = "test_two_scripts_naming_one_capture_id_refuse_the_batch_before_any_page_step"
# ── the x-table marker (2026-11-19) ──
XT_RAIL = "test_a_row_asking_for_the_x_table_is_not_answered_by_a_capture_without_one"
XT_BAD = "test_an_x_table_cell_outside_yes_no_refuses_the_queue_by_name"
# ── reference scripts (2026-11-19) ──
REF_TARGET_RAIL = "test_a_reference_script_with_its_cached_text_is_a_target_and_a_held_one_is_licence_hold"
REF_UNCACHED_RAIL = "test_a_reference_script_without_its_cached_text_is_needs_probe_by_name_and_takes_no_section_probe"
REF_CI_RAIL = "test_the_committed_reference_rows_derive_and_queue_check_passes_on_a_machine_without_the_cache"

# ── the session dimension (2026-11-21): a row's intraday HOURS are a key; a capture answers by what it RECORDED ──
SESS_WORDS = "test_a_rows_session_is_read_from_its_closed_vocabulary_and_timing_words_are_not_hours"
SESS_TARGETS = "test_a_session_row_is_its_own_target_and_a_daily_chart_keeps_its_key"
SESS_BOTH = "test_a_cell_naming_both_sessions_refuses_the_queue_by_name"
SESS_PHASE = "test_two_sessions_of_one_phase_are_two_captures_never_a_repeated_phase"
SESS_STATUS = "test_fixture_status_matches_a_capture_by_the_session_it_recorded_never_by_its_id"
SESS_MANIFEST = "test_the_manifest_carries_a_session_target_as_its_own_script_on_its_layout"
SESS_ID = "test_a_session_capture_id_parses_back_to_its_stem_and_phase_and_passes_the_gate_grammar"
SESS_GATE = "test_the_gate_admits_a_session_id_on_its_capture_stem"
SESS_VOCAB = "test_the_session_vocabulary_is_defined_once_and_never_restated"
SESS_E2E = "test_a_regular_and_an_extended_target_run_to_two_promotable_captures_that_answer_them"
# ── the derived set cannot shrink silently (2026-11-21) ──
TABLE_LINE = "test_a_table_line_outside_every_table_refuses_the_queue_by_name"
SHRINK = "test_a_row_that_asked_for_a_capture_at_a_ref_and_derives_nothing_now_is_named"
AGAINST = "test_queue_check_against_a_ref_fails_by_name_when_a_row_stops_deriving"
CI_RAILS = "tests/test_ci_pine_heavy.py"
CI_AGAINST = "test_on_a_pr_the_queue_check_runs_against_the_prs_base_and_a_base_it_cannot_fetch_fails"
WF = W / ".github" / "workflows" / "pine-heavy.yml"

MUTATIONS = [
    # ── the first eight (2026-11-02, tip ec0882c16a) ──
    ("licence gate always permits", EE,
     'return "permitted" if is_permitted(src.get("text") or "") else "held"', 'return "permitted"', LICENCE),
    ("packet sha not checked", EE, "    if not sha.startswith(packet_sha):\n", "    if False:\n", PROMOTE),
    ("rebuilt packet not compared", EE, "    if now != on_disk:\n", "    if False:\n",
     "test_a_run_that_changed_after_the_packet_refuses"),
    # ── 2026-11-08: the ONE live marker (an explicit `live` column, else a session pattern) ──
    ("the live column is ignored", EE, "    if col is not None:\n", "    if False:\n",
     "test_the_committed_live_rows_are_exactly_the_session_rows"),
    ("the weak live words come back", EE, 'r"minutes apart", re.I)',
     'r"minutes apart|\\blive\\b|\\bticks?\\b|\\b1m\\b|\\bvarip\\b", re.I)',
     "test_a_word_that_also_names_history_is_not_a_live_session"),
    ("a negated mention is read as live", EE, "    return bool(LIVE_RX.search(NOT_LIVE_RX.sub(\" \", rtext)))",
     "    return bool(LIVE_RX.search(rtext))", "test_a_word_that_also_names_history_is_not_a_live_session"),
    ("live guard removed", EE, 'elif t["needsLive"] and st in (None, "STALE"):',
     'elif False and st in (None, "STALE"):', "test_a_live_row_is_needs_live_and_never_reaches_a_manifest"),
    ("fixture overwrite admitted (the file in its own directory)", EE,
     'if (pathlib.Path(fixtures_dir) / f"{cid}.json").exists() or cid in world.fixture_ids:',
     "if cid in world.fixture_ids:", PROMOTE),
    ("per-script chart ignored", BC, '        if not any(script.get(k) for k in ("symbol", "tf", "listingDate", "session")):\n',
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
    ("grade ignores a missing lock", EE, '    wrapped = heavy("evidence-grade", cmd)\n    if wrapped is None:\n',
     '    wrapped = heavy("evidence-grade", cmd)\n    if False:\n', LOCK),
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
     PROSE_CELL),
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
    ("the gate holds an id to the raw stem", EE,
     "        want = asked if asked is not None else capture_stem(world, src[1])",
     "        want = asked if asked is not None else pathlib.Path(src[1]).stem", BAD_ID),
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
    ("the ledger files a capture twice", EL,
     '    new = [r for r in rows if row_key(r) not in have]', "    new = list(rows)",
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
    ("an owed probe inherits a source", EE, "if not sources and not owed and not ref_why",
     "if not sources and not ref_why", PROSE),
    ("a version variant reads as the plain file", EE, "            variant = bool(VARIANT_RX.search(rtext))",
     "            variant = False", "test_a_version_variant_takes_its_sibling_file_or_needs_a_probe"),
    ("STALE is never derived", EE, '    if stale:\n        return "STALE"', '    if False:\n        return "STALE"',
     "test_status_is_derived_from_fixtures_captured_and_stale"),
    # ── the five lows (2026-11-03): manifest stem, section chart, prose cells, headings, the doc's promises ──
    ("the gate ignores the run manifest's captureStem", EE, '    asked = (manifest_entry or {}).get("captureStem")\n',
     "    asked = None\n", MANIFEST_STEM),
    ("the packet does not hand the gate the manifest entry", EE,
     "        g = gate_capture(world, f, verifier, fixtures_dir, manifest_entry=man)\n",
     "        g = gate_capture(world, f, verifier, fixtures_dir)\n", MANIFEST_STEM),
    ("a manifest stem is taken for another source's capture", EE,
     'and (manifest_entry or {}).get("sha256") == sha):', "and True):", MANIFEST_STEM_ONLY),
    ("a section's chart is ignored for the preamble's", EE,
     '            elif lead_charts:\n                charts, chart_source = lead_charts, "section"\n',
     '            elif False:\n                charts, chart_source = lead_charts, "section"\n', SECTION),
    ("a section's listing wording flags a row on its own chart", EE,
     '(chart_source == "section" and LISTING_RX.search(lead))', "LISTING_RX.search(lead)", SECTION),
    ("a section's listing wording is ignored", EE,
     '(chart_source == "section" and LISTING_RX.search(lead))', "False", SECTION),
    ("the preamble's listing wording flags a row on a section's chart", EE,
     '(chart_source == "preamble" and LISTING_RX.search(preamble))', "LISTING_RX.search(preamble)", SECTION),
    ("a prose cell can ask for a probe", EE,
     '            request = " | ".join(c for c, pr in zip(cells, prose) if not pr)\n',
     "            request = rtext\n", PROSE_CELL),
    ("no column is read as prose", EE, "bool(PROSE_HEAD_RX.match(header[ci]))", "False", PROSE_CELL),
    ("a bare probe stem in a prose cell is not filed as a reference", EE,
     "        if tok in world.probes and refs_only:\n", "        if False:\n", PROSE_CELL),
    ("a .pine name in a prose cell is not filed as a reference", EE,
     '            if kind == "probe" and p.stem not in fx:\n                fx.append(p.stem)\n            continue\n',
     "            continue\n", PROSE_CELL),
    ("a finished-capture heading must be upper case", EE, r'\b(?!-)", re.I)', r'\b(?!-)")', HEADING),
    ("a finished-capture heading may not be numbered", EE,
     r'FINISHED_HEAD_RX = re.compile(r"^(?:(?:\d+(?:\.\d+)*|[A-Za-z]\d*)[.):]\s+|\d+(?:\.\d+)*\s+)?"',
     'FINISHED_HEAD_RX = re.compile(r"^"', HEADING),
    ("`Built-in ...` reads as a finished-capture heading", EE, r'taken)\b(?!-)", re.I)', r'taken)\b", re.I)', HEADING),
    ("emphasis marks hide a finished-capture heading", EE, 're.sub(r"[*`]+", "", h)', "h", HEADING),
    ("the manifest command takes --local-evidence again", EE,
     '        p.add_argument("--include-stale", action="store_true")\n',
     '        p.add_argument("--include-stale", action="store_true")\n'
     '        p.add_argument("--local-evidence", action="store_true")\n', LOCAL_EVIDENCE),
    ("the design doc promises a local-evidence mode again", DOC, "It has no local-evidence mode.",
     "It has a local-evidence mode.", LOCAL_EVIDENCE),
    ("the design doc offers --local-evidence on manifest again", DOC,
     "[--include-stale] [--only ID]`", "[--include-stale] [--only ID] [--local-evidence]`", LOCAL_EVIDENCE),
    ("the design doc says LICENCE_HOLD is a state again", DOC, "a guard, not a state anything reaches today",
     "capturable in local-evidence mode only", LOCAL_EVIDENCE),
    ("RDDT's listing day carries over to another symbol", BC,
     '            o.listing_date = script.get("listingDate") or KNOWN_LISTING.get(o.symbol.upper())',
     "            pass", DRIVER),
    # ── the capture phase (2026-11-19): one vocabulary, distinct targets, the queue check, the batch-start refusal ──
    ("an id accepts any suffix as a phase", EL,
     'PHASE_SUFFIX_RX = "(?:-(?:" + "|".join(re.escape(p) for p in CAPTURE_PHASES) + "))?"',
     'PHASE_SUFFIX_RX = "(?:-[a-z-]+)?"', PHASE_ID),
    ("the script key keeps the phase", EL, '    return m.group(1) if m else (capture_id or "")',
     '    return (m.group(1) + m.group(2)) if m else (capture_id or "")', PHASE_ID),
    ("a phase cell outside the vocabulary is admitted", EE, "    if v not in el.CAPTURE_PHASES:\n", "    if False:\n",
     PHASE_CELL),
    ("a phased row is not its own target", EE, ' + (f"@{phase}" if phase else "")', "", PHASE_TARGETS),
    ("a target carries no capturePhase", EE, '"capturePhase": t["phase"],', '"capturePhase": None,', PHASE_TARGETS),
    ("the queue never runs the phase check", EE, "    clash = phase_refusals(phase_groups)\n    if clash:\n",
     "    clash = phase_refusals(phase_groups)\n    if False:\n", PHASE_CHECK),
    ("phased and unphased rows of one probe and chart are admitted", EE, "        if not all(phases):\n",
     "        if False:\n", PHASE_CHECK),
    ("a repeated phase is admitted", EE, "        elif len(set(phases)) != len(phases):\n", "        elif False:\n",
     PHASE_CHECK),
    ("a capture of another phase answers the target", EE, 'and f["tf"] == t\n             and f["phase"] == phase and (session',
     'and f["tf"] == t\n             and (session', PHASE_STATUS),
    ("a capture of another phase makes the target stale", EE, ' and f["sha"] != sha and f["phase"] == phase\n',
     ' and f["sha"] != sha\n', PHASE_STATUS),
    ("a ledger verdict of another phase answers the target", EE,
     ' and has_verdict and el.capture_phase(r.get("captureId")) == phase:', " and has_verdict:", PHASE_STATUS),
    ("the manifest slug drops the phase", EE, '+ el.SESSION_SUFFIX.get(session, "") + (f"-{phase}" if phase else ""))',
     '+ el.SESSION_SUFFIX.get(session, ""))', PHASE_MANIFEST),
    ("the manifest drops capturePhase", EE, '            **({"capturePhase": phase} if phase else {}),\n', "",
     PHASE_MANIFEST),
    ("the capture id drops the phase", BC, '    return f"{capture_id}-{phase}" if phase else capture_id',
     "    return capture_id", BATCH_ID, BATCH_RAILS),
    ("a capturePhase outside the vocabulary is admitted", BC,
     "    if phase is not None and phase not in CAPTURE_PHASES:\n", "    if False:\n", BATCH_VOCAB, BATCH_RAILS),
    ("the batch never checks its capture ids at its start", BC,
     '            clash = capture_id_refusal(manifest["scripts"], drv.opts_for)\n', "            clash = None\n",
     BATCH_CLASH, BATCH_RAILS),
    ("two scripts naming one capture id are admitted", BC, "        if cid in seen:\n", "        if False:\n",
     BATCH_CLASH, BATCH_RAILS),
    # ── 2026-11-19: the x-table marker (a row asking where objects sit is answered only by a capture that records it) ──
    ("a capture without the x table answers a row that asks for it", EE,
     '             and (not needs_x_table or f.get("xTable"))]',
     ']', XT_RAIL),
    ("the x-table column is never read", EE,
     '                "needsXTable": row_needs_x_table(header, cells, f"{path.name}:{line_no} ({rid!r})"),',
     '                "needsXTable": False,', XT_RAIL),
    ("an x-table cell outside yes / no is read as no", EE,
     '    raise XTableMarkerError(f"{where}: an', '    return False and (f"{where}: an', XT_BAD),
    # ── 2026-11-19: reference scripts, ONE form `reference:<slug>` (cached text: a target; none: NEEDS_PROBE by name) ──
    ("an uncached reference script is not named as one", EE,
     '            why.append(f"{REF_UNCACHED}: `reference:{slug}`")\n', "            pass\n", REF_UNCACHED_RAIL),
    ("a reference row that resolves to nothing takes the section's probe", EE,
     "            if not sources and not owed and not ref_why and not NO_PROBE_RX",
     "            if not sources and not owed and not NO_PROBE_RX", REF_UNCACHED_RAIL),
    ("a held reference script is queued as if it were ours", EE, '    if kind == "corpus":\n        return "corpus"\n',
     '    if kind in ("corpus", "reference"):\n        return "corpus"\n', REF_TARGET_RAIL),
    ("the published script loses its PUB; prefix", EE, '"id": sid if sid.startswith("PUB;") else f"PUB;{sid}"',
     '"id": sid', REF_TARGET_RAIL),
    ("another spelling of a reference script reads as prose", EE,
     '        why.append(f"a reference script is named `reference:{slug}`, not `reference/{slug}`")\n', "        pass\n",
     REF_TARGET_RAIL),
    ("a reference script's text is taken whether or not the cache holds it", EE,
     "        return p if p.is_file() else None\n", "        return p\n", REF_CI_RAIL),
    # ── 2026-11-21: the session dimension ──
    ("THE DIMENSION DROPPED: a session row is not its own target", EE,
     ' + (f"@{session}" if session else "") + (f"@{phase}" if phase else "")', ' + (f"@{phase}" if phase else "")',
     SESS_TARGETS),
    ("THE DIMENSION DROPPED: no row reads its session", EE,
     '            session = chart_session(beside, f"{path.name}:{line_no} ({rid!r})")\n',
     '            session = None\n', SESS_TARGETS),
    ("a capture of other hours answers a session target", EE,
     ' and f["phase"] == phase and (session is None or f.get("session") == session)\n',
     ' and f["phase"] == phase\n', SESS_STATUS),
    ("the session is read off the capture's id, not its recording", EE,
     '"session": el.capture_session(c), "xTable"',
     '"session": ("regular" if "-rth-" in cid else "extended" if "-ext-" in cid else el.capture_session(c)), "xTable"',
     SESS_STATUS),
    ("an older capture of other hours makes a session target stale", EE,
     '\n             and (session is None or f.get("session") == session)]', "]", SESS_STATUS),
    ("the ledger answers a session target", EE, "if needs_x_table or session is not None else", "if needs_x_table else",
     SESS_STATUS),
    ("a daily chart carries a session", EE, 'sess = r.get("session") if is_intraday(tf) else None',
     'sess = r.get("session")', SESS_TARGETS),
    ("timing words read as hours", EE, '    t = SESSION_TIMING_RX.sub(" ", re.sub(r"[*`]+", "", text or ""))',
     '    t = re.sub(r"[*`]+", "", text or "")', SESS_WORDS),
    ("a remark in a cell that names no chart is read", EE, "beside = [c for c in cells if parse_charts(c)]",
     "beside = list(cells)", SESS_BOTH),
    ("both sessions beside one chart are admitted", EE, "    if len(named) > 1:\n", "    if False:\n", SESS_BOTH),
    ("a section's hours are not read", EE, '            elif chart_source in ("section", "preamble"):\n',
     "            elif False:\n", SESS_TARGETS),
    ("phase groups ignore the session", EE, "phase_groups[(rel(p), sym, norm_tf(tf), sess)]",
     "phase_groups[(rel(p), sym, norm_tf(tf), None)]", SESS_PHASE),
    ("a target carries no captureSession", EE, '            **({"captureSession": t["session"]} if t["session"] else {}),\n',
     "", SESS_TARGETS),
    ("the manifest drops the session and its layout", EE,
     '            **({"session": session, "layout": SESSION_LAYOUT[session]} if session else {}),\n', "", SESS_MANIFEST),
    ("the manifest slug drops the session", EE, '+ el.SESSION_SUFFIX.get(session, "") + (f"-{phase}"', '+ (f"-{phase}"',
     SESS_MANIFEST),
    ("the ledger's id grammar has no session suffix", EL,
     '[0-9]+[dwm])" + SESSION_SUFFIX_RX + r"-', '[0-9]+[dwm])" + r"-', SESS_ID),
    ("the session suffix admits any word", EL,
     'SESSION_SUFFIX_RX = "(?:" + "|".join(re.escape(s) for s in SESSION_SUFFIX.values()) + ")?"',
     'SESSION_SUFFIX_RX = "(?:-[a-z]+)?"', SESS_ID),
    ("the gate's tail grammar has no session suffix", EE,
     '[0-9]+[dwm])" + el.SESSION_SUFFIX_RX\n                     + r"-', '[0-9]+[dwm])"\n                     + r"-',
     SESS_GATE),
    ("the gate's id grammar has no session suffix", EE,
     '[0-9]+[dwm])" + el.SESSION_SUFFIX_RX\n                   + r"-', '[0-9]+[dwm])"\n                   + r"-', SESS_ID),
    ("batch_capture restates the session vocabulary", BC, "ROW_SESSIONS = SESSIONS\n",
     'ROW_SESSIONS = {"extended": "0400-2000", "regular": "0930-1600"}\n', SESS_VOCAB),
    ("the regular row runs on the rig layout", BC,
     'SESSION_LAYOUT = {"extended": RIG_LAYOUT_ID, "regular": RIG_REGULAR_LAYOUT_ID}',
     'SESSION_LAYOUT = {"extended": RIG_LAYOUT_ID, "regular": RIG_LAYOUT_ID}', SESS_MANIFEST),
    # ── 2026-11-21: the derived set cannot shrink silently ──
    ("a table line no table holds is admitted", EE, "    if stray_lines:\n", "    if False:\n", TABLE_LINE),
    ("a fenced line is read as a table line", EE, '        if ln.lstrip().startswith("```"):\n',
     "        if False:\n", TABLE_LINE),
    ("a row that needs a probe now still counts as asking", EE, "        if now & answered:\n", "        if now:\n", SHRINK),
    ("a row whose line is still in the docs counts as deleted", EE, "        elif line and line in every_line:\n",
     "        elif False:\n", SHRINK),
    ("a row is matched by its key only", EE,
     "        now = ({k} if k in head_lines else set()) | by_line.get(line, set())\n",
     "        now = ({k} if k in head_lines else set())\n", SHRINK),
    ("queue --check ignores --against", EE, "            if args.against:\n", "            if False:\n", AGAINST),
    ("an unreadable ref passes", EE,
     'could not be read: {exc})")\n        return 2', 'could not be read: {exc})")\n        return 0', AGAINST),
    ("the PR step drops --against", WF, 'then against="--against $BASE_SHA"', 'then against=""', CI_AGAINST, CI_RAILS),
    ("a PR base the step cannot fetch passes", WF,
     'that queue --check --against compares with"; q=1; fi', 'that queue --check --against compares with"; q=0; fi',
     CI_AGAINST, CI_RAILS),
]


def adapt(text, a, b):
    """A checkout under core.autocrlf=true can hold CRLF on disk while these patterns are written with LF."""
    if "\r\n" in text:
        return a.replace("\n", "\r\n"), b.replace("\n", "\r\n")
    return a, b


def rails_of(m) -> str:
    """The rails file a mutation's rail lives in: its sixth element, else RAILS."""
    return m[5] if len(m) > 5 else RAILS


def main() -> int:
    dry = "--dry" in sys.argv
    bad = []
    for label, path, a, b, rail, *_ in MUTATIONS:
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
    for m in MUTATIONS:
        label, path, a, b, rail = m[:5]
        saved = path.read_bytes()
        sha = hashlib.sha256(saved).hexdigest()
        text = saved.decode("utf-8")
        a2, b2 = adapt(text, a, b)
        try:
            path.write_bytes(text.replace(a2, b2).encode("utf-8"))
            # pycache defeats a same-length mutation: never write bytecode
            p = subprocess.run([sys.executable, "-B", "-m", "pytest", rails_of(m), "-q", "-p", "no:cacheprovider", "-k", rail],
                               cwd=str(W), capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
            last = p.stdout.strip().splitlines()[-1] if p.stdout.strip() else p.stderr.strip()[-200:]
            red = p.returncode != 0 and ("failed" in last or "error" in last)
            killed += red
            out.append(f"{'KILLED  ' if red else 'SURVIVED'}  {label}  -> {rail}  (exit {p.returncode}; {last})")
        finally:
            path.write_bytes(saved)
            assert hashlib.sha256(path.read_bytes()).hexdigest() == sha, f"restore failed for {path}"
        print(out[-1], flush=True)
    # control: unmutated, the same rails are green (every rails file a mutation named)
    p = subprocess.run([sys.executable, "-B", "-m", "pytest", *sorted({rails_of(m) for m in MUTATIONS}), "-q",
                        "-p", "no:cacheprovider"],
                       cwd=str(W), capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    control = p.stdout.strip().splitlines()[-1] if p.stdout.strip() else p.stderr[-400:]
    print("CONTROL:", control)
    ok = killed == len(MUTATIONS) and p.returncode == 0 and "passed" in control and "failed" not in control
    print(f"VERDICT: {'PASS' if ok else 'FAIL'} ({killed}/{len(MUTATIONS)} KILLED; control exit {p.returncode})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
