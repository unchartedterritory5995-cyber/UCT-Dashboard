"""
fixture_licence.py — the licence sweep over Pine source EMBEDDED in committed fixtures.

`corpus_licence.py` decides whether one script may be committed; the corpus rail sweeps
`corpus/`. This module sweeps the other way a third-party script reaches git: inside a fixture.
⚰️ 2026-11-15: a vendor capture (`tests/fixtures/vendor/harness/supertrend-kivancozbilgic-…`,
committed in `cce0701fe`) carried the full source of a script with NO licence line in its
`source.text`, and 22 `.pine` copies of licence-held OOS members sat in `tools/c0_*_fixtures`
(`e855f62cd`). The corpus rail walks `corpus/` only, so it never saw either.

WHAT IS SWEPT (`scope_files`):
  S1  every committed vendor capture (`schema: uct.vendor-capture/v1`), wherever it sits;
  S2  every committed file under `tests/fixtures/vendor/` (captures and every legacy format:
      any JSON string that is a Pine source, and any `.pine`);
  S3  every committed `.pine` under `tools/` (the probe directory is classified, not skipped).

A source found there is ALLOWED only as one of (`classify`):
  probe      its sha256 is a committed probe file's (`PROBE_DIRS`) — ours;
  probe      it names itself `UCTPROBE_…` — the house marker for a probe written inline;
  corpus     its sha256 is a `corpus/committed/` file's — that sweep already holds it to the rule;
  permitted  `corpus_licence.is_permitted` — an explicit MPL-2.0 / MIT / Apache-2.0 header;
  in-house   its sha256 is in `IN_HOUSE` — written in this repo, listed by name with the commit.
Anything else is an OFFENDER, reported by file, JSON path and the licence found.

⛔ `IN_HOUSE` IS A LIST OF HASHES, NOT DIRECTORIES. A directory allowance is exactly the hole this
closes: a third-party script dropped into an allowed folder would pass. A new in-house fixture gets
a probe file, a `UCTPROBE_` title, or a line here — each a decision somebody makes on purpose.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess

try:  # imported as a package by the rail, as a script by hand
    from tools.pine_survey.corpus_licence import detect, is_permitted
except ImportError:  # pragma: no cover
    from corpus_licence import detect, is_permitted  # type: ignore

CAPTURE_SCHEMA = "uct.vendor-capture/v1"
PROBE_DIRS = ("tools/visual_conformance/probes/", "docs/pine/probes/")
CORPUS_DIR = "corpus/committed/"
VENDOR_DIR = "tests/fixtures/vendor/"
TOOLS_DIR = "tools/"
HOUSE_MARKER = "UCTPROBE_"
_PINE_RX = re.compile(r"//@version\s*=\s*\d")

#: Sources written IN THIS REPO that carry no licence line, by sha256 of the exact text.
#: {sha256: "what it is (commit that added it)"}. Audited 2026-11-15, one by one.
IN_HOUSE = {
    # four probes written inline for the 2026-09-27 default-colour / sparse-row captures (e25e32747)
    "2192f0fdca9377e19287f791b64fe07c334133e1a94b0099383dfb83140631c5": "probe default colour v3 (e25e32747)",
    "f8110ebd8c9e88a53ea050177877da9713553e197b9e4d40756d0180f96c2577": "probe default colour v4 (e25e32747)",
    "4a87dd2f847433d3255946c989ccfc0d8be786dce4038dab402c4e077f519d75": "probe default colour v6 (e25e32747)",
    "e550300a952db94cb9ea98663f49719721048290372521a279fcd63679899386": "probe sparse rows (e25e32747)",
    # the 2026-09-05..08 parity / oracle / runtime / visual probes, titled `uct-*` / `UCT *` (e855f62cd),
    # and the F-wave reference probes (3628e3de6)
    "531f54c11ef7b8ad2ac04ccc2e46177a9fc3e5fcff9f9bf250ad5b1302243a25": "uct-dmi-parity-v1 in observations/adx-14-2026-09-06.json (e855f62cd)",
    "7c913749d2da1ef8fe9e8d0da5aad5c6beb4dfcca32013fae5a34000b494b4f8": "uct-rsi-atr-parity-v1 in observations/atr-14-2026-09-06.json (e855f62cd)",
    "88c3320678048d231c8fbbcdf2420c782d5522982e457ec2e2a47073871f9ef2": "uct-sma-ema-parity-v1 in observations/ema-close20-2026-09-06.json (e855f62cd)",
    "9530b1e05a71f389e12e5525a8b09390bbcd4c7de7a92fe425ec6044aff974ca": "uct-hma-macd-parity-v1 in observations/hma-close20-2026-09-06.json (e855f62cd)",
    "75fc66d8b9ff833bb80e59fb7e89350bf8dc1c5186e72d773c385fd0f6dbba76": "uct-rma-wma-parity-v1 in observations/rma-close14-2026-09-06.json (e855f62cd)",
    "8f1d72fe828e00a6087d37987485ce927fe5f3433829494f70e3c40d1c40e3bb": "uct-stoch-parity-v1 in observations/stoch-k-14-2026-09-06.json (e855f62cd)",
    "23c557db8838077bfb5cf6a7b71588307faa6fdee77ab4389a7f107f1a9cdaa7": "uct-oracle-ambiguity-v3 in observations/ta-bbw-oracle-ambiguity-v3-1-2026-09-05.json (e855f62cd)",
    "fbaf230c84de1163a80f86ae5a791fe177261e34063d10f4ea40f7b08b9cb2b2": "t in observations/ta-falling-close3-2026-09-06.json (e855f62cd)",
    "ca8cae2a52ca334bba5411d198c3f0317657206a00f21898aeae916ca372c00e": "t in observations/ta-kcw-close20-2-2026-09-06.json (e855f62cd)",
    "d8816237c772b41892928e112d76141b1fa8ede003a386c68e7bd5ab61e0222b": "t in observations/ta-pvt-delta5-2026-09-06.json (e855f62cd)",
    "ccae394807c17a9293882983feb5fd0457e283380c546155ecdd7740f732b494": "uct-oracle-cmf-adl-pvt-falling-kcw-v1 in raw_captures/2026-09-06-tv_cmf_adl_pvt_falling_kcw_capture_spy_screenshots/uct-oracle-cmf-adl-pvt-falling-kcw-v1.pine (e855f62cd)",
    "77dc9c0eebf10f7316b85c10a52ddae8bff2594c2007d2822cd71ed37a1f54c7": "UCT F1 fill v6 in reference/F/f1-fill-v6.pine (3628e3de6)",
    "8b30fd11ed819c3236e6986da306ceeb1986e13ebb6402e127a14867040bc69d": "UCT F2 fill v4 in reference/F/f2-fill-v4.pine (3628e3de6)",
    "06399e442405090f53d0ed483338754f67f784b7b50a6140d842e23e309ea0ce": "UCT F3 linewidth v6 in reference/F/f3-linewidth-v6.pine (3628e3de6)",
    "d0a1d384576352254a7a0b975322c49b9332c027c8a878adbae286d95c859b39": "UCT callsite probe in runtime/callsite-state-spy-1d-2026-09-08.json (e855f62cd)",
    "7c3e483a4ab0a08e3a1111b7fda255302d8b54f152b33f27a92018d7d4c630af": "UCT window na probe v4 in runtime/finite-window-na-policy-by-member-spy-1d-2026-09-08.json (e855f62cd)",
    "fe5c83794b0ca401aa677311731f009072a28895b70cbb02fe33d36277b5b51b": "UCT window na probe v5 in runtime/finite-window-na-policy-by-member-spy-1d-2026-09-08.json (e855f62cd)",
    "e6a2c4a27e594a5a13db8f83f42be03375ea597a4ed82f8272b5604ab36f8b69": "UCT runtime history probe in runtime/mutable-history-spy-1d-2026-09-08.json (e855f62cd)",
    "b23addb692bb28f6dbab83da96f2f8a2cad3f444f37d219b2cdc6ff1fb2d279d": "UCT runtime history probe v6 in runtime/mutable-history-spy-1d-2026-09-08.json (e855f62cd)",
    "02cccf5075b02fc59b41aeb7ec49f5d336ac1561290961eef1b2590d91a7765e": "UCT recur probe v3 in runtime/na-in-a-source-window-vs-recurrence-spy-1d-2026-09-08.json (e855f62cd)",
    "72431969de60165196e1f063a3e38dcf22fe0ebafaf6c48b482c4aa8e2f1d099": "UCT recur probe v2 in runtime/recurrent-callsite-identity-and-event-history-spy-1d-2026-09-08.json (e855f62cd)",
    "106b3a2407514a7bd79f58e0360344cfa5828a99222cef67f954cdb502241812": "UCT recur probe v1 in runtime/recurrent-na-and-skipped-callsite-spy-1d-2026-09-08.json (e855f62cd)",
    "60cdf0e558aad133dcdff62e3d97e78a30e066f345296a6b69ba7dad19330a49": "UCT skipcall probe in runtime/skipped-callsite-history-spy-1d-2026-09-08.json (e855f62cd)",
    "21c0b597a9130b8bb0ee28cea92e009a4b28ff6906ee0d20f75a40c882061825": "UCT skipcall deep probe in runtime/skipped-callsite-history-spy-1d-2026-09-08.json (e855f62cd)",
    "ddc22e869284fc53b26c5a961bc4f9f3e650a9b2f517cd6d3f33cdf304580bab": "UCT skipcall deep probe v6 in runtime/skipped-callsite-history-spy-1d-2026-09-08.json (e855f62cd)",
    "d780977da04815659586e3dbb19cb93ceac05804460a0a6b503e60917e4ee824": "UCT marker parity probe in visual/marker-semantics-spy-1d-2026-09-07.json (e855f62cd)",
    "25e685a7dd18fca1f06320dd9f261a40bea522c9cb7b142add4ade04245d46f2": "UCT C3B object probe in visual/object-semantics-spy-1d-2026-09-08.json (e855f62cd)",
}


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def tracked_files(repo: str) -> list[str]:
    """Every committed path, `/`-separated. Falls back to a walk when git is not there."""
    try:
        out = subprocess.run(["git", "-C", repo, "ls-files", "-z"], capture_output=True, check=True)
        return [p for p in out.stdout.decode("utf-8").split("\0") if p]
    except (OSError, subprocess.CalledProcessError):
        files = []
        for d, dirs, fns in os.walk(repo):
            dirs[:] = [x for x in dirs if x not in (".git", "node_modules")]
            files += [os.path.relpath(os.path.join(d, f), repo).replace("\\", "/") for f in fns]
        return files


def _head(path: str, n: int = 512) -> str:
    with open(path, "rb") as fh:
        return fh.read(n).decode("utf-8", "replace")


def scope_files(repo: str, files: list[str]) -> list[str]:
    """S1 + S2 + S3, sorted. Captures outside the vendor tree are found by their schema line."""
    out = set()
    for f in files:
        if f.startswith(VENDOR_DIR) and (f.endswith(".json") or f.endswith(".pine")):
            out.add(f)
        elif f.startswith(TOOLS_DIR) and f.endswith(".pine"):
            out.add(f)
        elif f.endswith(".json") and not f.startswith(CORPUS_DIR):
            p = os.path.join(repo, f)
            try:
                if CAPTURE_SCHEMA in _head(p):
                    out.add(f)
            except OSError:
                continue
    return sorted(out)


def embedded_sources(path: str):
    """[(where, text)] for every Pine source the file carries. A `.pine` is one source; a JSON
    file yields each string value that is a Pine program (a `//@version=N` line and a newline)."""
    if path.endswith(".pine"):
        with open(path, encoding="utf-8", errors="replace") as fh:
            return [("<file>", fh.read())]
    with open(path, encoding="utf-8", errors="replace") as fh:
        raw = fh.read()
    if not _PINE_RX.search(raw):
        return []
    try:
        doc = json.loads(raw)
    except ValueError:
        return []
    found = []

    def walk(o, where):
        if isinstance(o, dict):
            for k, v in o.items():
                walk(v, f"{where}.{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{where}[{i}]")
        elif isinstance(o, str) and "\n" in o and _PINE_RX.search(o):
            found.append((where or "$", o))

    walk(doc, "")
    return found


def known_shas(repo: str, files: list[str]) -> dict:
    """{sha256: 'probe' | 'corpus'} over every committed probe and corpus file (a probe wins)."""
    out = {}
    for kind, prefixes in (("probe", PROBE_DIRS), ("corpus", (CORPUS_DIR,))):
        for f in files:
            if f.endswith(".pine") and f.startswith(prefixes):
                with open(os.path.join(repo, f), "rb") as fh:
                    out.setdefault(hashlib.sha256(fh.read()).hexdigest(), kind)
    return out


def classify(text: str, known: dict, in_house: dict = IN_HOUSE) -> str:
    """'probe' | 'corpus' | 'permitted' | 'in-house' | 'held' for one embedded source."""
    s = sha256_text(text)
    if s in known:
        return known[s]
    if HOUSE_MARKER in text:
        return "probe"
    if is_permitted(text):
        return "permitted"
    if s in in_house:
        return "in-house"
    return "held"


def sweep(repo: str, files: list[str] | None = None, in_house: dict = IN_HOUSE):
    """({classification: count}, [(file, where, licence, sha12)]) over the scope. The offender list
    is empty on a clean tree."""
    files = tracked_files(repo) if files is None else files
    known = known_shas(repo, files)
    counts, offenders = {}, []
    for f in scope_files(repo, files):
        for where, text in embedded_sources(os.path.join(repo, f)):
            c = classify(text, known, in_house)
            counts[c] = counts.get(c, 0) + 1
            if c == "held":
                offenders.append((f, where, detect(text), sha256_text(text)[:12]))
    return counts, sorted(offenders)


# ─── THE THIRD DOOR: a TRANSLATED document derived from a held source (2026-11-15) ──────────────
#
# ⚰️ `tests/fixtures/graph_wire/u_c2d900000005.json` held no Pine text, so the sweep above passed it,
# and it was still a derivative of a CC BY-NC-SA script: the save door's translated document of
# `high_engagement__24-coppock-curve-multi-filter-markittick`, named after it. A definition document
# (`compute` + `meta.name`) whose name is a held script's is flagged here by that name.

DOC_SCOPE = ("tests/", "tools/", "app/src/")
OOS_DIR = "tests/fixtures/pine_oos/"
REFERENCE_DIR = "corpus/reference/"
#: The save door cuts a name to 40 characters; a prefix this long names one script.
MIN_PREFIX = 20


def held_names(repo: str, files: list[str]) -> dict:
    """{name: why} for every script whose source may not be committed: the local-only / unpublished
    `pine_oos` members, and the `corpus/reference/` scripts whose verdict is not `commit` (by stem,
    and by slug when no committed script shares the slug)."""
    out = {}
    committed_slugs = {os.path.basename(f)[:-5].split("__")[0] for f in files
                       if f.startswith(CORPUS_DIR) and f.endswith(".pine")}
    for f in files:
        if not f.endswith(".json"):
            continue
        if f.startswith(OOS_DIR) and "__" in os.path.basename(f):
            try:
                rec = json.load(open(os.path.join(repo, f), encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if rec.get("storage") != "git":
                out[os.path.basename(f)[:-5]] = f"pine_oos {rec.get('storage')} ({rec.get('license')})"
        elif f.startswith(REFERENCE_DIR):
            try:
                rec = json.load(open(os.path.join(repo, f), encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(rec, dict) and rec.get("verdict") not in (None, "commit"):
                stem = os.path.basename(f)[:-5]
                why = f"corpus/reference {rec.get('verdict')} ({rec.get('licence')})"
                out[stem] = why
                slug = stem.split("__")[0]
                if slug not in committed_slugs:
                    out.setdefault(slug, why)
    return out


def _held_name(name: str, held: dict):
    if not isinstance(name, str) or not name:
        return None
    if name in held:
        return name
    if len(name) >= MIN_PREFIX:
        return next((h for h in sorted(held) if h.startswith(name)), None)
    return None


def derived_documents(path: str):
    """[(where, name)] for every definition document in a JSON file: a dict with a `compute` dict
    (carrying source, trees, ast, graph or sources) and a `meta.name`."""
    with open(path, encoding="utf-8", errors="replace") as fh:
        raw = fh.read()
    if '"compute"' not in raw or '"meta"' not in raw:
        return []
    try:
        doc = json.loads(raw)
    except ValueError:
        return []
    found = []

    def walk(o, where):
        if isinstance(o, dict):
            c, m = o.get("compute"), o.get("meta")
            if isinstance(c, dict) and isinstance(m, dict) and \
                    any(k in c for k in ("source", "trees", "ast", "graph", "sources")):
                found.append((where or "$", m.get("name")))
            for k, v in o.items():
                walk(v, f"{where}.{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{where}[{i}]")

    walk(doc, "")
    return found


def derived_sweep(repo: str, files: list[str] | None = None):
    """(documents seen, [(file, where, held script, why)]): committed definition documents named
    after a held script. Empty on a clean tree."""
    files = tracked_files(repo) if files is None else files
    held = held_names(repo, files)
    seen, offenders = 0, []
    for f in files:
        if not (f.endswith(".json") and f.startswith(DOC_SCOPE)) or f.startswith(OOS_DIR):
            continue
        for where, name in derived_documents(os.path.join(repo, f)):
            seen += 1
            h = _held_name(name, held)
            if h:
                offenders.append((f, where, h, held[h]))
    return seen, sorted(offenders)
