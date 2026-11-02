"""Mutation proofs for the evidence engine. Each mutation: save bytes, edit, run the rail file,
expect the NAMED test red, restore from the saved bytes, verify sha256. Never git checkout."""
import hashlib
import pathlib
import subprocess
import sys

W = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\pine-e")
EE = W / "tools" / "vendor_harness" / "evidence_engine.py"
BC = W / "tools" / "vendor_harness" / "batch_capture.py"

MUTATIONS = [
    ("licence gate always permits", EE,
     'return "permitted" if is_permitted(src.get("text") or "") else "held"', 'return "permitted"',
     "test_the_licence_gate_admits_probes_corpus_and_permitted_headers_only"),
    ("packet sha not checked", EE,
     "    if not sha.startswith(packet_sha):\n", "    if False:\n",
     "test_promote_needs_the_packet_sha_and_files_every_verdict"),
    ("rebuilt packet not compared", EE,
     "    if now != on_disk:\n", "    if False:\n",
     "test_a_run_that_changed_after_the_packet_refuses"),
    ("live guard removed", EE,
     'if t["needsLive"] and st in (None, "STALE"):', 'if False and st in (None, "STALE"):',
     "test_a_live_row_is_needs_live_and_never_reaches_a_manifest"),
    ("fixture overwrite admitted", EE,
     '    if (pathlib.Path(fixtures_dir) / f"{cid}.json").exists():\n', "    if False:\n",
     "test_an_existing_fixture_is_never_overwritten_and_a_bad_id_is_refused"),
    ("per-script chart ignored", BC,
     '        if not any(script.get(k) for k in ("symbol", "tf", "listingDate")):\n',
     "        if True:\n",
     "test_the_driver_sets_each_scripts_own_symbol_and_tf_and_files_provenance"),
    ("throttle floor removed", BC,
     "        if args.throttle_s < MIN_THROTTLE_S:\n", "        if False:\n",
     "test_the_throttle_floor_refuses_before_any_browser"),
    ("account name kept in clear", BC,
     'return hashlib.sha256(name.encode("utf-8")).hexdigest()[:12] if isinstance(name, str) and name else "unread"',
     'return name if isinstance(name, str) and name else "unread"',
     "test_the_driver_sets_each_scripts_own_symbol_and_tf_and_files_provenance"),
]

out = []
for label, path, a, b, rail in MUTATIONS:
    saved = path.read_bytes()
    sha = hashlib.sha256(saved).hexdigest()
    text = saved.decode("utf-8")
    assert text.count(a) == 1, (label, text.count(a))
    try:
        path.write_bytes(text.replace(a, b).encode("utf-8"))
        # pycache defeats same-length mutation: never write bytecode
        p = subprocess.run([sys.executable, "-B", "-m", "pytest", "tests/test_evidence_engine.py", "-q", "-p",
                            "no:cacheprovider", "-k", rail], cwd=str(W), capture_output=True, text=True,
                           env={**__import__("os").environ, "PYTHONDONTWRITEBYTECODE": "1"})
        red = p.returncode != 0 and ("FAILED" in p.stdout or "failed" in p.stdout)
        out.append(f"{'KILLED' if red else 'SURVIVED'}  {label}  -> {rail}  (exit {p.returncode}; {p.stdout.strip().splitlines()[-1] if p.stdout.strip() else ''})")
    finally:
        path.write_bytes(saved)
        assert hashlib.sha256(path.read_bytes()).hexdigest() == sha, f"restore failed for {path}"
print("\n".join(out))
# control: unmutated, the same rails are green
p = subprocess.run([sys.executable, "-B", "-m", "pytest", "tests/test_evidence_engine.py", "-q", "-p", "no:cacheprovider"],
                   cwd=str(W), capture_output=True, text=True)
print("CONTROL:", p.stdout.strip().splitlines()[-1] if p.stdout.strip() else p.stderr[-400:])
