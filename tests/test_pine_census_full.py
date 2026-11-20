"""The full-population census (tools/pine_coverage/census_full.py, docs/pine/COVERAGE-MAP-FULL-2026-11-20.md).

The coverage map measures 679 scripts; the full census measures every open-source script the survey's query
vocabulary returns (~5,000), on GitHub runners, ALONGSIDE the 679 line (never replacing it). What is held here:

- the committed population file carries IDENTIFIERS ONLY (the repo is public; most of these scripts are
  licence-held): no title, author or text, a 64-hex sha256 per row, one key per script;
- the full map measured that population and says which of its scripts have no row;
- the full roadmap is what `parity_roadmap.build` derives from the full map and its own facts (one rule for both
  views), and the 679 map and roadmap are still the sample's;
- the shard split covers every row exactly once, and the envelope the rows travel in cannot be read without the
  operator's private key;
- the workflow uploads only the sealed envelope.
"""
from __future__ import annotations

import json
import pathlib
import re
import shutil
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))

from tools.pine_coverage import census_full as cf  # noqa: E402
from tools.pine_coverage import parity_roadmap as pr  # noqa: E402

PINE = ROOT / "docs" / "pine"
POPULATION = PINE / "census-full" / "population.json"
FULL_MAP = PINE / "coverage-map-full.json"
FULL_ROADMAP = PINE / "parity-roadmap-full.json"
WORKFLOW = ROOT / ".github" / "workflows" / "pine-census-full.yml"

ROW_KEYS = {"key", "population", "scriptIdPart", "rev", "sha256", "agreeCount", "kind", "pineVersion", "inSample679",
            "textChangedSince679"}
EXAMPLE_KEYS = {"key", "sha256", "item", "collection"}


@pytest.fixture(scope="module")
def population():
    return json.loads(POPULATION.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def full_map():
    return json.loads(FULL_MAP.read_text(encoding="utf-8"))


def identifier_problems(pop):
    """Every reason a population document is not identifiers-only ([] when it is)."""
    bad = []
    if pop.get("schema") != cf.POPULATION_SCHEMA:
        bad.append("schema")
    seen = set()
    for r in pop.get("rows", []):
        extra = set(r) - ROW_KEYS
        if extra:
            bad.append("%s carries %s" % (r.get("key"), sorted(extra)))
        if not re.fullmatch(r"[0-9a-f]{64}", str(r.get("sha256"))):
            bad.append("%s sha256" % r.get("key"))
        if r.get("population") not in cf.POPULATIONS or not str(r.get("key")).startswith(r.get("population", "?") + ":"):
            bad.append("%s population" % r.get("key"))
        if r.get("key") in seen:
            bad.append("%s twice" % r.get("key"))
        seen.add(r.get("key"))
    for e in pop.get("examples", []):
        if set(e) - EXAMPLE_KEYS:
            bad.append("example %s carries %s" % (e.get("key"), sorted(set(e) - EXAMPLE_KEYS)))
    return bad


def test_the_population_file_holds_identifiers_only(population):
    assert identifier_problems(population) == []
    assert population["total"] == len(population["rows"])
    assert sum(c["scripts"] for c in population["counts"].values()) == len(population["rows"])


def test_the_identifier_rail_can_fail(population):
    """Control: a row that carries a title or a source line, or a short hash, is refused by name."""
    r = dict(population["rows"][0])
    for bad_row in ({**r, "title": "x"}, {**r, "source": "//@version=5"}, {**r, "sha256": "abc"}):
        assert identifier_problems({**population, "rows": [bad_row]}) != []


def test_the_full_map_measured_the_population_and_names_what_it_did_not(population, full_map):
    keys = {r["key"] for r in population["rows"]}
    measured = {s["key"] for s in full_map["scripts"]}
    c = full_map["census"]
    assert measured <= keys
    assert sorted(keys - measured) == c["unmeasured"]
    assert c["populationScripts"] == len(keys) and c["measured"] == len(measured)
    raw = POPULATION.read_text(encoding="utf-8").replace("\r\n", "\n")
    import hashlib
    assert c["populationSha256"] == hashlib.sha256(raw.encode("utf-8")).hexdigest(), (
        "the full map was stamped against another population file: re-stamp (census_full.py stamp)")


def test_the_full_roadmap_is_what_the_full_map_gives():
    assert pr.check(str(FULL_MAP), str(FULL_ROADMAP)) == [], (
        "parity-roadmap-full.json is not what coverage-map-full.json gives; rebuild: python tools/pine_coverage/"
        "parity_roadmap.py build --map docs/pine/coverage-map-full.json --facts docs/pine/parity-roadmap-full.json "
        "--out docs/pine/parity-roadmap-full.json")


def test_the_679_line_is_still_the_sample():
    """ALONGSIDE, never replacing: the comparable line keeps measuring the 679-script sample."""
    m = json.loads((PINE / "coverage-map.json").read_text(encoding="utf-8"))
    rd = json.loads((PINE / "parity-roadmap.json").read_text(encoding="utf-8"))
    assert m["headline"]["sample"] == 679 and rd["headline"]["sample"] == 679
    assert "census" not in m


def test_the_full_map_holds_no_source_text(full_map):
    """The map is aggregates and identifiers like the sample's map: no refusal text, no source line."""
    text = FULL_MAP.read_text(encoding="utf-8")
    assert "//@version" not in text and '"refusals"' not in text and '"text":' not in text


def test_the_shards_cover_every_row_once():
    rows = [{"key": "p:%03d" % i} for i in range(103)]
    for of in (1, 3, 4):
        parts = [cf.shard_of(rows, s, of) for s in range(1, of + 1)]
        keys = [r["key"] for p in parts for r in p]
        assert sorted(keys) == sorted(r["key"] for r in rows) and len(keys) == len(set(keys))
        assert max(map(len, parts)) - min(map(len, parts)) <= 1


def _shard_run(tmp_path, monkeypatch, answers):
    """cmd_shard over a 12-row ecosystem population whose pine-facade answers are `answers` (per row index)."""
    import hashlib
    rows = [{"key": "ecosystem:s%02d" % i, "population": "ecosystem", "scriptIdPart": "PUB;%02d" % i, "rev": "1.0",
             "sha256": hashlib.sha256(("src %d" % i).encode()).hexdigest()} for i in range(12)]
    pop = tmp_path / "pop.json"
    pop.write_text(json.dumps({"schema": cf.POPULATION_SCHEMA, "rows": rows, "examples": []}), encoding="utf-8")
    asked, slept = [], []

    def facade(sid, rev="last"):
        i = int(sid.split(";")[1])
        asked.append(i)
        a = answers(i)
        return ({"source": "src %d" % i, "scriptAccess": "open_no_auth", "version": rev, "kind": "study"}, "ok") \
            if a == "ok" else (None, a)
    monkeypatch.setattr(cf, "facade", facade)
    monkeypatch.setattr(cf.time, "sleep", lambda s: slept.append(s))
    cf.main(["shard", "--population", str(pop), "--shard", "1", "--of", "1", "--out", str(tmp_path / "w")])
    rep = json.loads((tmp_path / "w" / "fetch_report.json").read_text(encoding="utf-8"))
    return rep, asked, slept


def test_a_refusal_is_recorded_by_name_backed_off_from_and_never_retried(tmp_path, monkeypatch):
    rep, asked, slept = _shard_run(tmp_path, monkeypatch, lambda i: "http-429" if i in (3, 7) else "ok")
    assert sorted(asked) == list(range(12)) and len(asked) == 12, "every script asked once, a refused one never again"
    assert [u["key"] for u in rep["unfetched"]] == ["ecosystem:s03", "ecosystem:s07"]
    assert rep["ok"] == 10 and rep["refusals"] == 2 and rep["stopped"] is None
    assert sum(1 for s in slept if s >= 60) == 2, "each refusal is followed by a back-off of at least 60 s"


def test_the_shard_stops_asking_after_five_refusals_in_a_row(tmp_path, monkeypatch):
    rep, asked, _slept = _shard_run(tmp_path, monkeypatch, lambda i: "http-403" if i >= 2 else "ok")
    assert asked == [0, 1, 2, 3, 4, 5, 6], "five refusals in a row, then no further request"
    assert rep["stopped"] and rep["ok"] == 2
    assert [u["key"] for u in rep["unfetched"]] == ["ecosystem:s%02d" % i for i in range(2, 12)]


@pytest.mark.skipif(shutil.which("openssl") is None, reason="openssl is not on this machine")
def test_the_envelope_needs_the_private_key(tmp_path):
    priv, pub = tmp_path / "k.pem", tmp_path / "pub.pem"
    subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(priv)],
                   check=True, capture_output=True)
    subprocess.run(["openssl", "pkey", "-in", str(priv), "-pubout", "-out", str(pub)], check=True, capture_output=True)
    w = tmp_path / "w"
    (w / "prod").mkdir(parents=True)
    secret = '{"key":"reference:x","refusals":[{"text":"plot(close)  // a licence-held line"}]}\n'
    (w / "prod" / "census.jsonl").write_text(secret, encoding="utf-8")
    cf.main(["seal", "--pubkey", str(pub), "--root", str(w), "--out", str(tmp_path / "out" / "s1"),
             str(w / "prod" / "census.jsonl")])
    sealed = sorted(p.name for p in (tmp_path / "out").iterdir())
    assert sealed == ["s1.key.enc", "s1.tgz.enc"], "only the envelope is left beside the upload"
    blob = b"".join(p.read_bytes() for p in (tmp_path / "out").iterdir())
    assert b"licence-held" not in blob and b"reference:x" not in blob
    cf.main(["unseal", "--privkey", str(priv), "--sealed", str(tmp_path / "out" / "s1"), "--out", str(tmp_path / "un")])
    assert (tmp_path / "un" / "prod" / "census.jsonl").read_text(encoding="utf-8") == secret
    other = tmp_path / "other.pem"
    subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(other)],
                   check=True, capture_output=True)
    with pytest.raises(subprocess.CalledProcessError):
        cf.main(["unseal", "--privkey", str(other), "--sealed", str(tmp_path / "out" / "s1"), "--out", str(tmp_path / "x")])


def test_the_workflow_uploads_only_the_sealed_envelope():
    text = WORKFLOW.read_text(encoding="utf-8")
    uploads = re.findall(r"uses: actions/upload-artifact@v4\n(?:.*\n){0,3}?\s+path: (.+)", text)
    assert uploads and set(uploads) == {"${{ runner.temp }}/out/"}, uploads
    lines = text.splitlines()
    writers = [i for i, line in enumerate(lines) if "$RUNNER_TEMP/out" in line]
    assert len(writers) == 2, "one sealed envelope per job (census shard, harness)"
    for i in writers:
        assert lines[i].strip().startswith('--out "$RUNNER_TEMP/out/') and "census_full.py seal" in lines[i - 1], (
            "only `census_full.py seal` writes into the uploaded directory (line %d)" % (i + 1))
    assert "on:\n  push:\n    branches: ['census-full/run/**']\n    paths: ['ci/census-full/run.json']" in text
