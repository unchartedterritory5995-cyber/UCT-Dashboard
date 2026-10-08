"""Lane 13G-1 mutation proofs. Each mutation: capture bytes, apply ONE replace (asserted unique),
run the named rail, record the raw output, restore the captured bytes, and prove the restore
against git (`git diff --quiet` on the path) -- never against the capture alone."""
import glob
import hashlib
import json
import os
import subprocess
import sys
import time

REPO = r"C:\Users\Patrick\uct-worktrees\notebook-w13g1"
OUT = os.path.join(REPO, "docs", "notebook", "evidence", "wave13-13g1", "mutations")
os.makedirs(OUT, exist_ok=True)
PY = sys.executable

PYTEST = [PY, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-W", "ignore"]
VITEST = ["cmd", "/c", "npx", "vitest", "run", "--maxWorkers=1"]

MUTATIONS = [
    {
        "id": "M1-alphavantage-import",
        "rail": "the import graph never reaches AlphaVantage",
        "path": "api/services/journal_two/transcript_capture.py",
        "old": "def _cache():\n    from api.services import fmp_transcripts\n",
        "new": "def _cache():\n    from api.services import av_transcripts  # noqa: F401  MUTATION\n    from api.services import fmp_transcripts\n",
        "cmd": PYTEST + ["tests/test_notebook_transcript_capture.py::test_the_import_graph_never_reaches_alphavantage"],
    },
    {
        "id": "M2-forward-return-off-by-one",
        "rail": "forward returns pinned on fixture bars",
        "path": "api/services/journal_two/passed_setups.py",
        "old": "            out[key] = _pct(forward[h - 1][\"c\"], base_close)\n",
        "new": "            out[key] = _pct(forward[min(h, len(forward) - 1)][\"c\"], base_close)  # MUTATION\n",
        "cmd": PYTEST + ["tests/test_notebook_passed_setups.py::test_forward_returns_are_pinned_on_fixture_bars"],
    },
    {
        "id": "M3-missing-bars-become-zero",
        "rail": "missing bars are labelled, never a number",
        "path": "api/services/journal_two/passed_setups.py",
        "old": "            out[key] = None\n            out[\"gaps\"][str(h)] = _gap(h, len(forward), calendar_sessions)\n",
        "new": "            out[key] = 0.0  # MUTATION: a gap becomes a number\n            out[\"gaps\"][str(h)] = _gap(h, len(forward), calendar_sessions)\n",
        "cmd": PYTEST + ["tests/test_notebook_passed_setups.py::test_a_gap_in_the_store_is_missing_and_a_session_not_yet_had_is_pending"],
    },
    {
        "id": "M4-purge-drops-the-table",
        "rail": "account purge takes j2_passed_setups",
        "path": "api/services/journal_two/account_purge.py",
        "old": "    \"j2_passed_setups\",\n",
        "new": "    # MUTATION: j2_passed_setups dropped from the purge\n",
        "cmd": PYTEST + ["tests/test_notebook_passed_setups.py::test_the_account_purge_takes_the_members_rows"],
    },
    {
        "id": "M5-gate-open-while-off",
        "rail": "404 while the gate is off",
        "path": "api/routers/notebook_research_capture.py",
        "old": "        if not enabled():\n            raise public.not_found()\n",
        "new": "        if False and not enabled():  # MUTATION: the gate never refuses\n            raise public.not_found()\n",
        "cmd": PYTEST + ["tests/test_notebook_transcript_capture.py", "-k", "404_while_the_gate_is_off",
                         "tests/test_notebook_passed_setups.py"],
    },
    {
        "id": "M6-citation-drops-the-date",
        "rail": "the excerpt cites source, date and position",
        "path": "api/services/journal_two/transcript_capture.py",
        "old": "    return f\"{sym} earnings call FY{year} Q{q} · {when} · {SOURCE_LABEL}\"\n",
        "new": "    return f\"{sym} earnings call FY{year} Q{q} · {SOURCE_LABEL}\"  # MUTATION: date dropped\n",
        "cmd": PYTEST + ["tests/test_notebook_transcript_capture.py::test_the_saved_excerpt_cites_source_date_and_position"],
    },
    {
        "id": "M7-quote-not-verified",
        "rail": "a passage not on the turn is refused and nothing is written",
        "path": "api/services/journal_two/transcript_capture.py",
        "old": "    if locate(raw, held_text) is None:\n        raise TranscriptCaptureError(\n",
        "new": "    if False and locate(raw, held_text) is None:  # MUTATION: the quote is not checked\n        raise TranscriptCaptureError(\n",
        "cmd": PYTEST + ["tests/test_notebook_transcript_capture.py::test_a_passage_that_is_not_on_the_turn_is_refused_and_nothing_is_written"],
    },
    {
        "id": "M8-client-gap-rendered-as-zero",
        "rail": "a missing horizon is worded by the server's label, never 0.0%",
        "path": "app/src/pages/journal-2-0/lib/researchCapture.js",
        "old": "  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null\n",
        "new": "  if (typeof pct !== 'number' || !Number.isFinite(pct)) return '0.0%' // MUTATION\n",
        "cmd": VITEST + ["src/pages/journal-2-0/components/notebook/PassedSetups.test.jsx"],
        "cwd": "app",
    },
]

ONLY = sys.argv[1:]  # run a subset by id


def drop_pyc(path):
    if not path.endswith(".py"):
        return
    d = os.path.join(REPO, os.path.dirname(path), "__pycache__")
    stem = os.path.splitext(os.path.basename(path))[0]
    for f in glob.glob(os.path.join(d, stem + ".*.pyc")):
        os.remove(f)


def run(cmd, cwd):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", env=env, timeout=900)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


summary = []
for m in MUTATIONS:
    if ONLY and m["id"] not in ONLY:
        continue
    full = os.path.join(REPO, m["path"])
    orig = open(full, "rb").read()
    text = orig.decode("utf-8")
    nl = "\r\n" if "\r\n" in text else "\n"
    old, new = m["old"].replace("\n", nl), m["new"].replace("\n", nl)
    assert text.count(old) == 1, (m["id"], text.count(old))
    cwd = os.path.join(REPO, m.get("cwd", ""))
    # CONTROL: the rail is green on the unmutated tree first.
    c_code, c_out = run(m["cmd"], cwd)
    try:
        open(full, "wb").write(text.replace(old, new).encode("utf-8"))
        drop_pyc(m["path"])
        code, out = run(m["cmd"], cwd)
    finally:
        open(full, "wb").write(orig)
        drop_pyc(m["path"])
    restored = subprocess.run(["git", "-C", REPO, "diff", "--quiet", "--", m["path"]]).returncode == 0
    same = hashlib.sha256(open(full, "rb").read()).hexdigest() == hashlib.sha256(orig).hexdigest()
    rec = {"id": m["id"], "rail": m["rail"], "path": m["path"], "control_exit": c_code,
           "mutant_exit": code, "killed": c_code == 0 and code != 0,
           "restored_matches_git": restored, "restored_matches_capture": same,
           "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    summary.append(rec)
    with open(os.path.join(OUT, f"{m['id']}.log"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(rec, indent=2) + "\n\n--- CONTROL (unmutated) ---\n" + c_out[-6000:]
                 + "\n\n--- MUTANT ---\n" + out[-8000:])
    print(json.dumps(rec), flush=True)

with open(os.path.join(OUT, "summary.json"), "a", encoding="utf-8", newline="\n") as fh:
    for r in summary:
        fh.write(json.dumps(r) + "\n")
