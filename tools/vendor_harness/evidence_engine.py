"""The evidence engine: a queued probe becomes a graded, filed fixture.

    python tools/vendor_harness/evidence_engine.py queue [--check]        # Q: every capture-queue doc -> one queue
    python tools/vendor_harness/evidence_engine.py manifest --top 20      # M: queue -> a batch manifest (run dir)
    python tools/vendor_harness/evidence_engine.py batch --top 20         # Q+M+C+G+P: the OWNER's command (live rig)
    python tools/vendor_harness/evidence_engine.py grade --run-dir D      # G: the corpus harness, under the heavy lock
    python tools/vendor_harness/evidence_engine.py packet --run-dir D     # V+P: validate + the promotion packet
    python tools/vendor_harness/evidence_engine.py promote --run-dir D --packet-sha <12 hex>   # F: file it

Design: `docs/pine/EVIDENCE-ENGINE-DESIGN.md`. Everything here except `batch` runs
with no TradingView access. `batch` hands the page work to `batch_capture.py run`
(the existing driver), in the rig's OWN profile; no agent runs it.

⛔ WHAT THIS NEVER DOES
  * writes Pine from a prose row (a row with no probe file is NEEDS_PROBE);
  * batches a row that needs a live session (NEEDS_LIVE);
  * commits, or overwrites an existing fixture (evidence is appended, never replaced);
  * lets a capture into git whose source licence is not clear (LICENCE_HOLD: graded
    locally, verdict filed in the ledger with the source sha, capture kept out of git);
  * promotes anything without `--packet-sha` naming the packet as it is NOW.

⭐ ONE AUTHORITY PER VALUE: capture validity is `verify_capture.mjs` (called through
`batch_capture.NodeVerifier`), licence is `corpus_licence.is_permitted`, the door
flag state is `batch_manifest.ledger_flag_state`, guard capabilities are
`coverage_map.GUARD_BUCKET`. None of them is re-implemented here.
"""
from __future__ import annotations

import argparse
import collections
import datetime as _dt
import hashlib
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "tools"))
sys.path.insert(0, str(REPO / "tools" / "pine_coverage"))
sys.path.insert(0, str(REPO / "tools" / "pine_survey"))

QUEUE_SCHEMA = "uct.capture-queue/v1"
LEDGER_SCHEMA = "uct.evidence-ledger/v1"
PACKET_SCHEMA = "uct.promotion-packet/v1"
MANIFEST_SCHEMA = "uct.vendor-batch-manifest/v1"

DOCS = REPO / "docs" / "pine"
PROBE_DIRS = (REPO / "tools" / "visual_conformance" / "probes", REPO / "docs" / "pine" / "probes")
CORPUS = REPO / "corpus"
FIXTURES = REPO / "tests" / "fixtures" / "vendor" / "harness"
COVERAGE = DOCS / "coverage-map.json"
QUEUE_OUT = DOCS / "vendor-harness" / "capture-queue.json"
LEDGER = DOCS / "vendor-harness" / "evidence-ledger.jsonl"
DOOR_FLAG = "VITE_PINE_OBJECTS_ONLY_PANE_ENABLED"
HEAVY_LOCK = pathlib.Path(os.environ.get("UCT_HEAVY_LOCK") or r"C:\Users\Patrick\uct-clips\tools\heavy_lock.py")
DEFAULT_CHART = ("NYSE:RDDT", "1D")
HOUSE_SYMBOLS = {"RDDT": "NYSE:RDDT", "SPY": "AMEX:SPY", "QQQ": "NASDAQ:QQQ", "AAPL": "NASDAQ:AAPL",
                 "BTCUSD": "BITSTAMP:BTCUSD"}
EXCHANGES = ("NYSE", "AMEX", "NASDAQ", "BITSTAMP", "BINANCE", "COINBASE", "CME", "TVC", "OANDA", "INDEX", "SP")
TF_ALLOWED = {"1", "3", "5", "15", "30", "45", "60", "120", "180", "240"}
MIN_THROTTLE_S = 10.0
DEFAULT_LIMIT = 40

#: Header cells that mark a table as a LEDGER of what is already settled, not a
#: queue of questions. Such tables are counted per doc as `contextTables`, never dropped silently.
LEDGER_HEADERS = {"settled", "served", "was", "now", "witness"}
LEDGER_FIRST_HEADERS = {"refused as"}

LIVE_RX = re.compile(r"market hours|during regular hours|\brealtime\b|\breal-time\b|\blive\b|\bforming\b|"
                     r"minutes apart|\bintrabar\b|\bvarip\b|\b1m\b|\bticks?\b", re.I)
VARIANT_RX = re.compile(r"\bline \d+\b[^|]*(?:replac|//@version|→|->)|the same (?:file|probe) with|"
                        r"the same probe,|\bline 1 `//@version", re.I)
VERSION_RX = re.compile(r"//@version=(\d)")
NO_PROBE_RX = re.compile(r"\bno probe\b", re.I)
GUARD_RX = re.compile(r"(?<![\w:-])((?:host:)?(?:pine|runtime|fn|paint|lower-tf):[a-z][a-z0-9-]*[a-z0-9])")
PINE_RX = re.compile(r"([A-Za-z0-9_./-]+\.pine)\b")
TICK_RX = re.compile(r"`([a-z0-9][a-z0-9._-]*[a-z0-9])`")
SLUG_RX = re.compile(r"\b([a-z0-9][a-z0-9-]*__[0-9a-f]{6,12})\b")
SYMBOL_RX = re.compile(r"\b(?:(" + "|".join(EXCHANGES) + r"):([A-Z0-9.!]{1,12})|(" + "|".join(HOUSE_SYMBOLS) + r"))\b")
LISTING_RX = re.compile(r"from (?:the )?listing|full history", re.I)
STATED_HEAD_RX = re.compile(r"unblock|would move|confirms|blocked on", re.I)
STATED_NUM_RX = re.compile(r"\*\*(\d+)\*\*")

#: coverage_map.GUARD_BUCKET capability -> programme wave (PINE-FULL-PARITY-PLAN.md s4).
BUCKET_WAVE = {
    "drawing-objects": "W3",
    "imperative": "W4", "history-offsets": "W4", "user-functions": "W4", "tuples": "W4",
    "na-semantics": "W4", "realtime-bar-state": "W4",
    "collections": "W6", "udt-methods": "W6",
    "request-security": "W7",
    "imports-libraries": "W8",
    "strategy": "W9",
    "builtin-missing": "W1", "call-mapping": "W1", "translator-robustness": "W1",
    "output-contract": "W1", "text-colour-values": "W1",
}
PREFIX_WAVE = {"runtime": "W4", "fn": "W4", "paint": "W3", "lower-tf": "W7"}


# ─── small utilities ─────────────────────────────────────────────────────────
def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def rel(p: pathlib.Path) -> str:
    p = pathlib.Path(p)
    try:
        return p.resolve().relative_to(REPO.resolve()).as_posix()
    except ValueError:
        return str(p)


def dump(obj) -> str:
    return json.dumps(obj, indent=1, ensure_ascii=False, sort_keys=False) + "\n"


def write_atomic(path: pathlib.Path, text: str) -> None:
    """Encode to a temp file in the same directory, then os.replace (never open('w')
    on the target: a failed write must not leave it truncated)."""
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with io.open(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def norm_tf(tf) -> str:
    """The chart's own code: 1D/D -> D, 1W -> W, 1M -> M, minutes as digits."""
    t = str(tf or "").strip().upper()
    return t[1:] if t in ("1D", "1W", "1M") else t


def rig_tf(tf) -> str:
    """What batch_capture sets: D -> 1D, W -> 1W, M -> 1M, minutes unchanged."""
    t = norm_tf(tf)
    return "1" + t if t in ("D", "W", "M") else t


def slugify(s) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def split_cells(line: str) -> list[str]:
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|") and not body.endswith("\\|"):
        body = body[:-1]
    return [c.strip() for c in re.split(r"(?<!\\)\|", body)]


def clean_cell(c: str) -> str:
    return re.sub(r"[`*]", "", c).strip()


# ─── the world the queue is derived from ─────────────────────────────────────
class World:
    """Everything on disk the queue reads. Paths are injectable so tests build a small one."""

    def __init__(self, docs_dir=DOCS, probe_dirs=PROBE_DIRS, corpus=CORPUS, fixtures=FIXTURES,
                 coverage=COVERAGE, ledger=LEDGER, cache_dir=None):
        self.docs_dir = pathlib.Path(docs_dir)
        self.probe_dirs = [pathlib.Path(p) for p in probe_dirs]
        self.corpus = pathlib.Path(corpus)
        self.fixtures = pathlib.Path(fixtures)
        self.coverage_path = pathlib.Path(coverage)
        self.ledger_path = pathlib.Path(ledger)
        self.cache_dir = pathlib.Path(cache_dir or os.environ.get("UCT_PINE_CACHE")
                                      or (REPO / "tools" / "pine_survey" / "cache"))
        self._probes = None
        self._corpus = None
        self._fixtures = None
        self._coverage = None
        self._ledger = None

    # probes: stem -> path
    @property
    def probes(self) -> dict:
        if self._probes is None:
            out = {}
            for d in self.probe_dirs:
                if d.exists():
                    for p in sorted(d.glob("*.pine")):
                        out.setdefault(p.stem, p)
            self._probes = out
        return self._probes

    @property
    def corpus_files(self) -> dict:
        if self._corpus is None:
            d = self.corpus / "committed"
            self._corpus = {p.stem: p for p in sorted(d.glob("*.pine"))} if d.exists() else {}
        return self._corpus

    @property
    def fixture_index(self) -> list:
        """[{id, file, sha, symbol, tf}] for every v1 capture under the fixture dir."""
        if self._fixtures is None:
            out = []
            if self.fixtures.exists():
                for f in sorted(self.fixtures.glob("*.json")):
                    try:
                        c = json.loads(f.read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        continue
                    if not isinstance(c, dict) or c.get("schema") != "uct.vendor-capture/v1":
                        continue
                    sym = c.get("symbol") or {}
                    out.append({"id": c.get("id") or f.stem, "file": rel(f),
                                "sha": (c.get("source") or {}).get("sha256"),
                                "symbol": (sym.get("pro_name") or sym.get("full_name") or sym.get("name") or "").upper(),
                                "tf": norm_tf(c.get("timeframe"))})
            self._fixtures = out
        return self._fixtures

    @property
    def coverage(self) -> dict:
        if self._coverage is None:
            try:
                self._coverage = json.loads(self.coverage_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                self._coverage = {}
        return self._coverage

    @property
    def ledger(self) -> list:
        if self._ledger is None:
            rows = []
            if self.ledger_path.exists():
                for ln in self.ledger_path.read_text(encoding="utf-8").splitlines():
                    ln = ln.strip()
                    if ln:
                        try:
                            rows.append(json.loads(ln))
                        except ValueError:
                            continue
            self._ledger = rows
        return self._ledger

    def resolve_pine(self, name: str):
        """A `.pine` reference -> (kind, path) or (None, None)."""
        name = name.strip().strip("`")
        base = pathlib.PurePosixPath(name.replace("\\", "/")).name
        stem = base[:-5] if base.endswith(".pine") else base
        if "corpus/committed/" in name or (stem in self.corpus_files and stem not in self.probes):
            p = self.corpus_files.get(stem)
            return ("corpus", p) if p else (None, None)
        if stem in self.probes:
            return "probe", self.probes[stem]
        if stem in self.corpus_files:
            return "corpus", self.corpus_files[stem]
        return None, None


# ─── the census: what a target would unblock ─────────────────────────────────
class Census:
    def __init__(self, coverage: dict):
        self.scripts = {s["key"]: s for s in (coverage.get("scripts") or [])}
        rt = ((coverage.get("runtimeOn") or {}).get("walls") or {}).get("byScript") or {}
        self.host_blockers = {}
        self.all_tokens = {}
        for k, s in self.scripts.items():
            host = [w for w in (s.get("walls") or [])] + list(s.get("firstGuards") or [])
            if s.get("stuck"):
                host.append(s["stuck"])
            self.host_blockers[k] = host
            toks = set()
            for w in host + list(rt.get(k) or []):
                toks.update(GUARD_RX.findall(str(w)))
                if re.fullmatch(r"(?:pine|runtime|fn|paint|lower-tf):[a-z0-9-]+|host:pine:[a-z0-9-]+", str(w)):
                    toks.add(str(w))
            self.all_tokens[k] = toks

    def transfers(self, k) -> bool:
        return bool((self.scripts.get(k) or {}).get("clean"))

    def matched(self, k) -> bool:
        return (self.scripts.get(k) or {}).get("vendorVerdict") == "MATCH"

    def unblocks(self, guards: set, named: set, direct: set) -> dict:
        guards = set(guards)
        upper, firm = set(), set()
        if guards:
            for k in self.scripts:
                if self.transfers(k):
                    continue
                if self.all_tokens[k] & guards:
                    upper.add(k)
                    host = self.host_blockers[k]
                    if host and all(set(GUARD_RX.findall(str(w)) + [str(w)]) & guards for w in host):
                        firm.add(k)
        named_nt = {k for k in named if k in self.scripts and not self.transfers(k)}
        direct_ok = {k for k in direct if k in self.scripts and self.transfers(k) and not self.matched(k)}
        score = firm | named_nt | direct_ok
        return {"priority": len(score), "firm": sorted(firm), "named": sorted(named_nt),
                "direct": sorted(direct_ok), "upper": len(upper), "upperSample": sorted(upper)[:12]}


def guard_bucket():
    try:
        from coverage_map import GUARD_BUCKET  # noqa: E402 — the one authority
        return dict(GUARD_BUCKET)
    except Exception:  # noqa: BLE001
        return {}


def plan_wave(guards, direct, bucket) -> str:
    votes = collections.Counter()
    for g in guards:
        g2 = g[5:] if g.startswith("host:") else g
        if g2 in bucket and bucket[g2] in BUCKET_WAVE:
            votes[BUCKET_WAVE[bucket[g2]]] += 1
        else:
            pre = g2.split(":", 1)[0]
            if pre in PREFIX_WAVE:
                votes[PREFIX_WAVE[pre]] += 1
    if not votes:
        return "E"
    best = max(votes.values())
    return sorted(w for w, n in votes.items() if n == best)[0]


# ─── Q: parse the queue docs ─────────────────────────────────────────────────
DOC_RX = re.compile(r"capture-queue-(\d{4}-\d{2}-\d{2})(?:-(.+))?$")


TF_TOKEN_RX = re.compile(r"\s*\*{0,2}(12M|3M|1D|1W|1M|D|W|M|\d{1,3})\*{0,2}(?![\w%.:]|,\d)")
TF_SEP_RX = re.compile(r"\s*(?:,|/|&|\(and|and|\+)\s*")


def tfs_after(text: str, pos: int) -> list:
    """The timeframe LIST that immediately follows a symbol: `1D`, `**15**, **60**, **240**`,
    `**1D** (and **1W**)`. Stops at the first token that is neither a timeframe nor a separator,
    so a number later in the sentence (`bars 0 and 1`) is never read as a timeframe."""
    out = []
    while True:
        m = TF_TOKEN_RX.match(text, pos)
        if not m:
            break
        t = m.group(1).upper()
        if not (t in ("D", "W", "M", "1D", "1W", "1M", "3M", "12M") or t in TF_ALLOWED):
            break
        out.append(rig_tf(t))
        pos = m.end()
        s = TF_SEP_RX.match(text, pos)
        if not s:
            break
        pos = s.end()
    return out


def parse_charts(text: str) -> list:
    """[(symbol, tf)] named in `text`, in order, deduplicated. A symbol with no timeframe
    right after it reads as 1D (the house default for every queue doc)."""
    out = []
    for m in SYMBOL_RX.finditer(text):
        sym = f"{m.group(1)}:{m.group(2)}" if m.group(1) else HOUSE_SYMBOLS[m.group(3)]
        for t in tfs_after(text, m.end()) or ["1D"]:
            if (sym, t) not in out:
                out.append((sym, t))
    return out


def resolve_sources(world: World, text: str):
    """(sources [(kind, path)], owed [names], fixture_stems [stems]) named in `text`."""
    sources, owed, fx = [], [], []
    seen = set()
    for name in PINE_RX.findall(text):
        kind, p = world.resolve_pine(name)
        if p is None:
            base = pathlib.PurePosixPath(name).name
            if base not in owed:
                owed.append(base)
        elif str(p) not in seen:
            seen.add(str(p))
            sources.append((kind, p))
    stems = sorted(world.probes, key=len, reverse=True)
    for tok in TICK_RX.findall(text):
        if tok.endswith(".pine"):
            continue
        if tok in world.probes:
            p = world.probes[tok]
            if str(p) not in seen:
                seen.add(str(p))
                sources.append(("probe", p))
            continue
        hit = next((s for s in stems if tok.startswith(s + "-")), None)
        if hit:
            p = world.probes[hit]
            if hit not in fx:
                fx.append(hit)
            if str(p) not in seen:
                seen.add(str(p))
                sources.append(("probe", p))
    return sources, owed, fx


def explicit_pines(world: World, text: str) -> list:
    """Sources named as `.pine` files (never a bare stem): what a section or preamble may hand down."""
    out = []
    for name in PINE_RX.findall(text):
        kind, p = world.resolve_pine(name)
        if p is not None and all(str(p) != str(q) for _, q in out):
            out.append((kind, p))
    return out


def iter_tables(lines):
    """Yield (start index, header cells, [(line_no, cells)]) for every markdown table."""
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|?\s*$", lines[i + 1]):
            header = [clean_cell(c).lower() for c in split_cells(lines[i])]
            rows = []
            j = i + 2
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                rows.append((j + 1, split_cells(lines[j])))
                j += 1
            yield i, header, rows
            i = j
        else:
            i += 1


def parse_doc(world: World, path: pathlib.Path) -> dict:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    m = DOC_RX.match(path.stem)
    date, tag = (m.group(1), m.group(2) or m.group(1)) if m else ("", path.stem)
    first_table = next((i for i, ln in enumerate(lines) if ln.lstrip().startswith("|")), len(lines))
    preamble = "\n".join(lines[:first_table])
    pre_sources = explicit_pines(world, preamble)
    pre_charts = parse_charts(preamble)
    rows, context = [], 0
    ids = collections.Counter()
    for start, header, trows in iter_tables(lines):
        # the SECTION a table sits in: from the nearest heading above it to the table
        h = next((k for k in range(start - 1, -1, -1) if lines[k].lstrip().startswith("#")), None)
        lead = "\n".join(lines[h:start]) if h is not None and h >= first_table else ""
        lead_sources = explicit_pines(world, lead) if lead else []
        lead_charts = parse_charts(lead) if lead else []
        inherit_from = lead_sources if len(lead_sources) == 1 else pre_sources
        if (set(header) & LEDGER_HEADERS) or (header and header[0] in LEDGER_FIRST_HEADERS):
            context += 1
            continue
        stated_cols = [i for i, h in enumerate(header) if STATED_HEAD_RX.search(h)]
        for line_no, cells in trows:
            rid = clean_cell(cells[0]) if cells else ""
            rid = re.sub(r"\s+", " ", rid)[:60] or f"L{line_no}"
            ids[rid] += 1
            key = f"{path.stem}#{rid}" + (f"~{ids[rid]}" if ids[rid] > 1 else "")
            rtext = " | ".join(cells)
            sources, owed, fx = resolve_sources(world, rtext)
            inherited = False
            variant = bool(VARIANT_RX.search(rtext))
            if not sources and not owed and not NO_PROBE_RX.search(rtext) and len(inherit_from) == 1 \
                    and not re.search(r"\bprobe(?: shape)?:|indicator\(", rtext):
                sources = list(inherit_from)
                inherited = True
            needs_probe = None
            if variant and sources:
                v = VERSION_RX.search(rtext)
                kind, p = sources[0]
                sib = world.probes.get(f"{p.stem}-v{v.group(1)}") if v else None
                if sib is not None:
                    sources = [("probe", sib)]
                else:
                    needs_probe = f"a variant of {p.name} ({'v' + v.group(1) if v else 'edited'}) with no file of its own"
                    sources = []
            if not sources:
                if NO_PROBE_RX.search(rtext):
                    needs_probe = needs_probe or "the row says no probe"
                elif owed:
                    needs_probe = needs_probe or f"probe file owed: {', '.join(owed)}"
                else:
                    needs_probe = needs_probe or "no probe file named (an inline shape or prose)"
            charts = parse_charts(rtext) or lead_charts or pre_charts
            defaulted = False
            if not charts:
                charts = [DEFAULT_CHART]
                defaulted = True
            stated = None
            for ci in stated_cols:
                if ci < len(cells):
                    n = STATED_NUM_RX.search(cells[ci])
                    if n:
                        stated = int(n.group(1))
            rows.append({
                "key": key, "doc": rel(path), "line": line_no, "docDate": date, "docWave": tag,
                "text": re.sub(r"\s+", " ", rtext)[:400],
                "sources": [{"kind": k, "path": rel(p)} for k, p in sources],
                "sourceInherited": inherited,
                "charts": [list(c) for c in charts], "chartDefaulted": defaulted,
                "fromListing": bool(LISTING_RX.search(rtext) or (not parse_charts(rtext) and LISTING_RX.search(preamble))),
                "needsLive": bool(LIVE_RX.search(rtext)),
                "needsProbe": needs_probe,
                "guards": sorted(set(GUARD_RX.findall(rtext))),
                "namedScripts": sorted(set(SLUG_RX.findall(rtext))),
                "statedUnblocks": stated,
                "fixtureRefs": fx,
            })
    return {"doc": rel(path), "date": date, "wave": tag, "rows": rows, "contextTables": context}


def licence_of(world: World, kind: str, path: pathlib.Path) -> str:
    """'probe' | 'corpus' | 'permitted' | 'held' — may the source text enter git?"""
    if kind == "probe":
        return "probe"
    if kind == "corpus":
        return "corpus"
    try:
        from corpus_licence import is_permitted  # noqa: E402 — the one authority
        return "permitted" if is_permitted(path.read_text(encoding="utf-8")) else "held"
    except Exception:  # noqa: BLE001
        return "held"


def fixture_status(world: World, sha: str, stem: str, symbol: str, tf: str):
    t = norm_tf(tf)
    exact = [f for f in world.fixture_index if f["sha"] == sha and f["symbol"] == symbol.upper() and f["tf"] == t]
    if exact:
        return "CAPTURED", [f["file"] for f in exact]
    for r in world.ledger:
        if r.get("sourceSha256") == sha and str(r.get("symbol", "")).upper() == symbol.upper() \
                and norm_tf(r.get("timeframe")) == t and r.get("verdict"):
            return "VERDICT_LOCAL", [r.get("captureId")]
    lead = f"{stem}-{slugify(symbol.split(':')[-1])}-"     # never a sibling probe's (`x-v4-...`) fixture
    stale = [f for f in world.fixture_index if f["id"].startswith(lead) and f["symbol"] == symbol.upper()
             and f["tf"] == t and f["sha"] != sha]
    if stale:
        return "STALE", [f["file"] for f in stale]
    return None, []


def build_queue(world: World | None = None) -> dict:
    world = world or World()
    census = Census(world.coverage)
    bucket = guard_bucket()
    docs = [parse_doc(world, p) for p in sorted(world.docs_dir.glob("capture-queue-*.md"))]
    targets = {}

    def target_for(kind, path, symbol, tf, listing, origin):
        raw = path.read_bytes()
        sha = sha256_bytes(raw)
        tid = f"{path.stem}@{symbol}@{norm_tf(tf)}"
        t = targets.get(tid)
        if t is None:
            t = targets[tid] = {
                "id": tid, "source": rel(path), "sourceKind": kind, "sha256": sha, "bytes": len(raw),
                "stem": path.stem, "symbol": symbol, "tf": rig_tf(tf), "fromListing": False,
                "licence": licence_of(world, kind, path), "rows": [], "origins": [],
                "needsLive": False, "guards": set(), "named": set(), "direct": set(), "stated": [],
                "docWaves": set(), "docDates": set(),
            }
        t["fromListing"] = t["fromListing"] or listing
        if origin not in t["origins"]:
            t["origins"].append(origin)
        return t

    rows_out, needs_probe = [], []
    for d in docs:
        for r in d["rows"]:
            rows_out.append(r)
            if r["needsProbe"]:
                needs_probe.append(r)
                continue
            for s in r["sources"]:
                p = REPO / s["path"] if not pathlib.Path(s["path"]).is_absolute() else pathlib.Path(s["path"])
                for sym, tf in r["charts"]:
                    t = target_for(s["kind"], p, sym, tf, r["fromListing"], "queue-doc")
                    t["rows"].append(r["key"])
                    t["needsLive"] = t["needsLive"] or r["needsLive"]
                    t["guards"].update(r["guards"])
                    t["named"].update(f"committed:{x}" for x in r["namedScripts"])
                    if s["kind"] == "corpus":
                        t["direct"].add(f"committed:{p.stem}")
                    if r["statedUnblocks"] is not None:
                        t["stated"].append(r["statedUnblocks"])
                    t["docWaves"].add(r["docWave"])
                    t["docDates"].add(r["docDate"])

    # the census pool (wave E-census): transfers today, never MATCHed
    held = []
    for k, s in sorted(census.scripts.items()):
        if not census.transfers(k) or census.matched(k):
            continue
        pop, slug = k.split(":", 1)
        if pop == "committed":
            p = world.corpus_files.get(slug)
            if p is None:
                continue
            t = target_for("corpus", p, DEFAULT_CHART[0], DEFAULT_CHART[1], True, "census")
            t["direct"].add(k)
            t["docWaves"].add("E-census")
        else:
            cache = world.cache_dir / ("builtin" if pop == "builtin" else "sources") / f"{slug}.pine"
            held.append({"key": k, "population": pop, "title": s.get("title"),
                         "cachedSource": rel(cache), "sourcePresent": cache.exists(),
                         "vendorVerdict": s.get("vendorVerdict")})

    out_targets = []
    for t in targets.values():
        st, ev = fixture_status(world, t["sha256"], t["stem"], t["symbol"], t["tf"])
        # ⛔ THE ONE LIVE GUARD: a target any row says needs a live session is NEEDS_LIVE unless it is
        # already answered; the manifest selects by status alone, so nothing else has to repeat this.
        if t["needsLive"] and st in (None, "STALE"):
            st = "NEEDS_LIVE"
        elif st is None:
            st = "QUEUED" if t["licence"] != "held" else "LICENCE_HOLD"
        u = census.unblocks(t["guards"], t["named"], t["direct"])
        out_targets.append({
            "id": t["id"], "status": st, "evidence": ev,
            "source": t["source"], "sourceKind": t["sourceKind"], "sha256": t["sha256"], "bytes": t["bytes"],
            "stem": t["stem"], "symbol": t["symbol"], "tf": t["tf"], "fromListing": t["fromListing"],
            "licence": t["licence"], "needsLive": t["needsLive"],
            "priority": u["priority"], "unblocks": u,
            "statedUnblocks": max(t["stated"]) if t["stated"] else None,
            "guards": sorted(t["guards"]), "planWave": plan_wave(t["guards"], t["direct"], bucket),
            "docWaves": sorted(t["docWaves"]), "oldestDoc": min(t["docDates"]) if t["docDates"] else "",
            "rows": t["rows"], "origins": t["origins"],
        })
    out_targets.sort(key=priority_key)
    counts = summarise(out_targets, needs_probe, held)
    return {
        "schema": QUEUE_SCHEMA,
        "generatedBy": "tools/vendor_harness/evidence_engine.py queue",
        "derivedFrom": {"docs": [d["doc"] for d in docs], "coverageMeasuredOn": world.coverage.get("measuredOn"),
                        "coverageMasterSha": world.coverage.get("masterSha"), "fixtures": len(world.fixture_index),
                        "ledgerRows": len(world.ledger)},
        "definitions": {
            "priority": "|firm ∪ named ∪ direct| — firm: non-transferring sample scripts whose every host wall is a guard "
                        "the target's rows name; named: non-transferring scripts the rows name; direct: the target IS a "
                        "transferring, never-MATCHed sample script (its capture verifies it)",
            "upper": "non-transferring sample scripts touching any named guard (a ceiling, not a promise)",
        },
        "counts": counts,
        "targets": out_targets,
        "rowsNeedingProbe": [{k: r[k] for k in ("key", "doc", "line", "docWave", "needsProbe", "needsLive",
                                                "guards", "namedScripts", "text")} for r in needs_probe],
        "licenceHeldCensus": held,
        "docs": [{"doc": d["doc"], "wave": d["wave"], "rows": len(d["rows"]), "contextTables": d["contextTables"]}
                 for d in docs],
    }


def priority_key(t):
    return (-t["priority"], -(t["unblocks"]["upper"]), -(t.get("statedUnblocks") or 0), t.get("oldestDoc") or "9", t["id"])


def band(p: int) -> str:
    return "0" if p == 0 else "1-2" if p <= 2 else "3-9" if p <= 9 else "10+"


def summarise(targets, needs_probe, held) -> dict:
    by_status = collections.Counter(t["status"] for t in targets)
    by_plan = collections.defaultdict(collections.Counter)
    by_band = collections.defaultdict(collections.Counter)
    by_doc = collections.defaultdict(collections.Counter)
    for t in targets:
        by_plan[t["planWave"]][t["status"]] += 1
        by_band[band(t["priority"])][t["status"]] += 1
        for w in t["docWaves"]:
            by_doc[w][t["status"]] += 1
    return {
        "targets": len(targets), "byStatus": dict(sorted(by_status.items())),
        "byPlanWave": {k: dict(sorted(v.items())) for k, v in sorted(by_plan.items())},
        "byPriorityBand": {k: dict(sorted(v.items())) for k, v in sorted(by_band.items())},
        "byDocWave": {k: dict(sorted(v.items())) for k, v in sorted(by_doc.items())},
        "rowsNeedingProbe": len(needs_probe),
        "rowsNeedingProbeLive": sum(1 for r in needs_probe if r["needsLive"]),
        "licenceHeldCensus": len(held),
    }


# ─── M: queue -> manifest ────────────────────────────────────────────────────
def door_flag_state():
    from batch_manifest import ledger_flag_state  # noqa: E402 — the one authority
    v = ledger_flag_state(DOOR_FLAG)
    return ("on" if v else "off") if v is not None else "off", "docs/frontend_feature_flags.json" if v is not None else "default-off"


def build_manifest(queue: dict, top: int | None = None, wave: str | None = None, plan: str | None = None,
                   statuses=("QUEUED",), include_stale=False, only=None) -> dict:
    from batch_capture import KNOWN_LISTING  # noqa: E402 — the one listing authority
    want = set(statuses) | ({"STALE"} if include_stale else set())
    picked = [t for t in queue["targets"] if t["status"] in want
              and (wave is None or wave in t["docWaves"]) and (plan is None or t["planWave"] == plan)
              and (not only or t["id"] in only)]
    picked.sort(key=priority_key)
    if top is not None:
        picked = picked[:top]
    # group by chart inside each priority band so a lower band never jumps a higher one
    order = {b: i for i, b in enumerate(("10+", "3-9", "1-2", "0"))}
    picked.sort(key=lambda t: (order[band(t["priority"])], t["symbol"], t["tf"], priority_key(t)))
    scripts, seen = [], set()
    for t in picked:
        slug = slugify(f"{t['stem']}--{t['symbol'].split(':')[-1]}-{norm_tf(t['tf'])}")
        if slug in seen:
            continue
        seen.add(slug)
        p = REPO / t["source"]
        if not p.exists() or sha256_bytes(p.read_bytes()) != t["sha256"]:
            continue    # the queue is older than the file: re-run `queue`
        scripts.append({
            "slug": slug, "path": t["source"], "sha256": t["sha256"], "bytes": t["bytes"],
            "plots": None, "drawsObjects": None, "largestWindow": None,
            "symbol": t["symbol"], "tf": t["tf"], "captureStem": t["stem"],
            "listingDate": KNOWN_LISTING.get(t["symbol"].upper()) if t["fromListing"] else None,
            "queueTargetId": t["id"], "rows": t["rows"], "priority": t["priority"],
            "planWave": t["planWave"], "localOnly": t["licence"] == "held",
        })
    state, source = door_flag_state()
    return {"schema": MANIFEST_SCHEMA, "generatedBy": "tools/vendor_harness/evidence_engine.py manifest",
            "derivation": {"queue": rel(QUEUE_OUT), "selection": {"top": top, "wave": wave, "planWave": plan,
                                                                     "statuses": sorted(want)},
                           "doorFlag": {"name": DOOR_FLAG, "state": state, "source": source}},
            "counts": {"targets": len(scripts)}, "scripts": scripts}


# ─── V: the fixture gate ─────────────────────────────────────────────────────
ID_RX = re.compile(r"^[a-z0-9][a-z0-9.-]*-[a-z0-9.!]+-(?:\d+|1?[dwm]|[0-9]+[dwm])-\d{4}-\d{2}-\d{2}$")


def licence_of_capture(world: World, capture: dict) -> str:
    src = capture.get("source") or {}
    sha = src.get("sha256")
    for p in world.probes.values():
        if sha256_bytes(p.read_bytes()) == sha:
            return "probe"
    for p in world.corpus_files.values():
        if sha256_bytes(p.read_bytes()) == sha:
            return "corpus"
    try:
        from corpus_licence import is_permitted  # noqa: E402
        return "permitted" if is_permitted(src.get("text") or "") else "held"
    except Exception:  # noqa: BLE001
        return "held"


def gate_capture(world: World, path: pathlib.Path, verifier, fixtures_dir: pathlib.Path) -> dict:
    """Every problem with promoting this capture, plus its licence class. Never raises."""
    path = pathlib.Path(path)
    problems = []
    try:
        cap = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return {"file": str(path), "id": path.stem, "ok": False, "licence": None,
                "problems": [f"does not parse: {exc}"], "capture": None}
    cid = cap.get("id")
    v = verifier.verify_file(path)
    if not v.get("ok"):
        problems.append(f"verify_capture.mjs refused it ({v.get('verdict')}): {v.get('tail')}")
    if cid != path.stem:
        problems.append(f"the file is {path.name} but the capture id is {cid!r}")
    if not isinstance(cid, str) or not ID_RX.match(cid):
        problems.append(f"id {cid!r} is not <script>-<sym>-<tf>-<yyyy-mm-dd>")
    if (pathlib.Path(fixtures_dir) / f"{cid}.json").exists():
        problems.append(f"{cid}.json already exists under the fixtures: evidence is appended, never replaced")
    lic = licence_of_capture(world, cap)
    return {"file": str(path), "id": cid, "ok": not problems, "licence": lic, "problems": problems, "capture": cap}


# ─── P: the packet ───────────────────────────────────────────────────────────
def read_verdicts(run_dir: pathlib.Path) -> dict:
    try:
        d = json.loads((run_dir / "verdicts.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {r.get("id"): r for r in d.get("results") or [] if r.get("id")}


def first_divergence(v: dict):
    for p in (v or {}).get("plots") or []:
        f = ((p.get("stats") or {}).get("steady") or {}).get("first")
        if f:
            return {"plot": p.get("title") or p.get("id"), **f}
    return None


def build_packet(run_dir: pathlib.Path, world: World | None = None, verifier=None,
                 fixtures_dir: pathlib.Path = FIXTURES) -> dict:
    world = world or World()
    if verifier is None:
        from batch_capture import NodeVerifier  # noqa: E402
        verifier = NodeVerifier()
    run_dir = pathlib.Path(run_dir)
    verdicts = read_verdicts(run_dir)
    by_capture = {}
    for p in sorted((run_dir / "results").glob("*.json")) if (run_dir / "results").exists() else []:
        try:
            r = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if r.get("captureId"):
            by_capture[r["captureId"]] = r
    try:
        manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = {"scripts": []}
    by_slug = {s["slug"]: s for s in manifest.get("scripts") or []}
    items = []
    caps = sorted((run_dir / "captures").glob("*.json")) if (run_dir / "captures").exists() else []
    for f in caps:
        g = gate_capture(world, f, verifier, fixtures_dir)
        cap = g.pop("capture") or {}
        res = by_capture.get(g["id"]) or {}
        man = by_slug.get(res.get("slug")) or {}
        v = verdicts.get(g["id"])
        problems = list(g["problems"])
        if v is None:
            problems.append("no verdict for this capture in the run's verdicts.json (run `grade` first)")
        held = g["licence"] == "held"
        items.append({
            "id": g["id"], "file": rel(f), "receipt": (cap.get("receipt") or {}).get("fnv1a"),
            "sourceSha256": (cap.get("source") or {}).get("sha256"),
            "symbol": (cap.get("symbol") or {}).get("pro_name"), "timeframe": cap.get("timeframe"),
            "bars": (cap.get("bars") or {}).get("count"), "startsAtBar0": (cap.get("history") or {}).get("startsAtBar0"),
            "verdict": (v or {}).get("verdict"), "reason": (v or {}).get("reason"),
            "firstDivergence": first_divergence(v),
            "licence": g["licence"], "queueTargetId": man.get("queueTargetId"), "rows": man.get("rows") or [],
            "provenance": res.get("provenance"),
            "problems": problems,
            "action": ("REFUSE" if problems else "LEDGER_ONLY" if held else "PROMOTE"),
        })
    body = {"schema": PACKET_SCHEMA, "runDir": run_dir.name, "items": items,
            "counts": dict(collections.Counter(i["action"] for i in items))}
    return body


def packet_text(body: dict) -> str:
    return json.dumps(body, indent=1, ensure_ascii=False, sort_keys=True) + "\n"


def write_packet(run_dir: pathlib.Path, body: dict) -> str:
    run_dir = pathlib.Path(run_dir)
    text = packet_text(body)
    sha = sha256_bytes(text.encode("utf-8"))
    write_atomic(run_dir / "promotion-packet.json", text)
    md = [f"# Promotion packet  sha256 {sha}", "",
          f"Run `{body['runDir']}`. Written {_dt.datetime.now(_dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}.",
          "Nothing below is in git. Read every line, then promote with the sha's first 12 hex:", "",
          f"    python tools/vendor_harness/evidence_engine.py promote --run-dir {run_dir} --packet-sha {sha[:12]}", "",
          "PROMOTE = copied into tests/fixtures/vendor/harness + ledger row. LEDGER_ONLY = licence-held: "
          "verdict filed, capture stays out of git. REFUSE = nothing happens; the reason is listed.", "",
          "| action | capture | chart | verdict | first divergence | licence | rows | problems |",
          "|---|---|---|---|---|---|---|---|"]
    for i in body["items"]:
        fd = i["firstDivergence"]
        fds = (f"{fd.get('plot')} bar {fd.get('bar', fd.get('index'))} {fd.get('kind')}" if fd else "")
        md.append("| {} | `{}` | {} {} | {} | {} | {} | {} | {} |".format(
            i["action"], i["id"], i["symbol"], i["timeframe"], i["verdict"], fds.replace("|", "/"),
            i["licence"], len(i["rows"]), "; ".join(i["problems"]).replace("|", "/")[:300]))
    md += ["", f"Counts: {json.dumps(body['counts'])}", "", f"sha256 {sha}", ""]
    write_atomic(run_dir / "PROMOTION-PACKET.md", "\n".join(md))
    return sha


# ─── F: promote + file ───────────────────────────────────────────────────────
class PromoteRefused(Exception):
    pass


def append_ledger(path: pathlib.Path, rows) -> int:
    path = pathlib.Path(path)
    have = set()
    if path.exists():
        for ln in path.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(ln)
                have.add((r.get("captureId"), r.get("receipt")))
            except ValueError:
                continue
    new = [r for r in rows if (r["captureId"], r["receipt"]) not in have]
    if not new:
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with io.open(path, "a", encoding="utf-8", newline="\n") as fh:
        for r in new:
            fh.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    return len(new)


def promote(run_dir: pathlib.Path, packet_sha: str, world: World | None = None, verifier=None,
            fixtures_dir: pathlib.Path = FIXTURES, ledger: pathlib.Path = LEDGER, only=None, log=print) -> dict:
    """⛔ THE CHECKPOINT: the packet on disk must hash to `packet_sha`, AND a packet rebuilt
    from the run as it is now must be byte-identical to it. Either fails -> nothing moves."""
    run_dir = pathlib.Path(run_dir)
    if not packet_sha or not re.fullmatch(r"[0-9a-f]{12,64}", packet_sha):
        raise PromoteRefused("--packet-sha must be at least the first 12 hex of the packet's sha256")
    pj = run_dir / "promotion-packet.json"
    if not pj.exists():
        raise PromoteRefused(f"no packet at {pj}: run `packet` and read it first")
    on_disk = pj.read_bytes()
    sha = sha256_bytes(on_disk)
    if not sha.startswith(packet_sha):
        raise PromoteRefused(f"the packet on disk is sha {sha[:12]}, not {packet_sha[:12]}: you read a different packet")
    now = packet_text(build_packet(run_dir, world, verifier, fixtures_dir)).encode("utf-8")
    if now != on_disk:
        raise PromoteRefused("the run changed since the packet was written (a capture, a verdict or a fixture "
                             "moved): run `packet` again and read the new one")
    body = json.loads(on_disk.decode("utf-8"))
    promoted, filed, refused = [], [], []
    ledger_rows = []
    stamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for i in body["items"]:
        if only and i["id"] not in only:
            continue
        if i["action"] == "REFUSE":
            refused.append(i["id"])
            continue
        if i["action"] == "PROMOTE":
            dst = pathlib.Path(fixtures_dir) / f"{i['id']}.json"
            if dst.exists():
                refused.append(i["id"])
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / i["file"] if not pathlib.Path(i["file"]).is_absolute() else i["file"], dst)
            promoted.append(i["id"])
        else:
            filed.append(i["id"])
        ledger_rows.append({
            "schema": LEDGER_SCHEMA, "filedAtUTC": stamp, "packetSha256": sha,
            "captureId": i["id"], "receipt": i["receipt"], "sourceSha256": i["sourceSha256"],
            "symbol": i["symbol"], "timeframe": i["timeframe"], "bars": i["bars"], "startsAtBar0": i["startsAtBar0"],
            "verdict": i["verdict"], "reason": i["reason"], "firstDivergence": i["firstDivergence"],
            "licence": i["licence"], "promoted": i["action"] == "PROMOTE",
            "fixture": (rel(pathlib.Path(fixtures_dir) / f"{i['id']}.json") if i["action"] == "PROMOTE" else None),
            "queueTargetId": i["queueTargetId"], "rows": i["rows"], "provenance": i["provenance"],
        })
    n = append_ledger(ledger, ledger_rows)
    log(f"[promote] promoted {len(promoted)} · ledger-only {len(filed)} · refused {len(refused)} · ledger +{n}")
    log("[promote] nothing was committed: review `git status`, then commit with the packet sha in the message")
    return {"promoted": promoted, "ledgerOnly": filed, "refused": refused, "ledgerRows": n, "packetSha256": sha}


# ─── the CLI ─────────────────────────────────────────────────────────────────
def print_counts(q: dict) -> None:
    c = q["counts"]
    print(f"[queue] {c['targets']} capture targets · {json.dumps(c['byStatus'])}")
    print(f"[queue] by plan wave: {json.dumps(c['byPlanWave'])}")
    print(f"[queue] by priority band: {json.dumps(c['byPriorityBand'])}")
    print(f"[queue] rows needing a probe file: {c['rowsNeedingProbe']} ({c['rowsNeedingProbeLive']} of them live) · "
          f"licence-held census scripts: {c['licenceHeldCensus']}")
    top = [t for t in q["targets"] if t["status"] == "QUEUED"][:10]
    for t in top:
        print(f"[queue]   p={t['priority']:>3} up={t['unblocks']['upper']:>3} {t['planWave']:>3} {t['id']}")


def queue_text(q: dict) -> str:
    return dump(q)


def heavy(label: str, cmd: list) -> list:
    if HEAVY_LOCK.exists():
        return [sys.executable, str(HEAVY_LOCK), "run", "--label", label, "--timeout", "14400", "--", *cmd]
    return cmd


def cmd_grade(run_dir) -> int:
    cmd = [sys.executable, str(HERE / "batch_capture.py"), "grade", "--run-dir", str(run_dir)]
    print(f"[grade] {' '.join(heavy('evidence-grade', cmd))}")
    return subprocess.call(heavy("evidence-grade", cmd), cwd=str(REPO))


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(description="The evidence engine (docs/pine/EVIDENCE-ENGINE-DESIGN.md).")
    sub = ap.add_subparsers(dest="cmd")
    q = sub.add_parser("queue")
    q.add_argument("--check", action="store_true", help="compare with the committed snapshot, write nothing")
    q.add_argument("--out", default=str(QUEUE_OUT))

    def sel(p):
        p.add_argument("--top", type=int, default=DEFAULT_LIMIT)
        p.add_argument("--wave", default=None, help="a queue doc's wave tag, e.g. wsc-history or E-census")
        p.add_argument("--plan-wave", default=None, help="W1..W9 or E")
        p.add_argument("--include-stale", action="store_true")
        p.add_argument("--local-evidence", action="store_true", help="also take LICENCE_HOLD targets (kept out of git)")
        p.add_argument("--only", action="append", default=None, help="a queue target id (repeatable)")

    m = sub.add_parser("manifest")
    sel(m)
    m.add_argument("--out", required=False, default=None)
    b = sub.add_parser("batch", help="the OWNER's command: queue -> manifest -> live capture -> grade -> packet")
    sel(b)
    b.add_argument("--run-dir", default=None)
    b.add_argument("--throttle-s", type=float, default=30.0)
    b.add_argument("--profile", default=None)
    b.add_argument("--channel", default=None)
    b.add_argument("--title-selector", default=None)
    g = sub.add_parser("grade")
    g.add_argument("--run-dir", required=True)
    pk = sub.add_parser("packet")
    pk.add_argument("--run-dir", required=True)
    pr = sub.add_parser("promote")
    pr.add_argument("--run-dir", required=True)
    pr.add_argument("--packet-sha", required=True)
    pr.add_argument("--only", action="append", default=None)
    args = ap.parse_args(argv)

    if args.cmd == "queue":
        qd = build_queue()
        text = queue_text(qd)
        out = pathlib.Path(args.out)
        if args.check:
            old = out.read_text(encoding="utf-8") if out.exists() else ""
            same = json.loads(old or "{}").get("targets") == qd["targets"] if old else False
            print_counts(qd)
            print(f"VERDICT: {'PASS' if same else 'FAIL'} ({rel(out)} {'matches' if same else 'differs from'} the docs)")
            return 0 if same else 1
        write_atomic(out, text)
        print_counts(qd)
        print(f"[queue] wrote {rel(out)}")
        return 0

    if args.cmd in ("manifest", "batch"):
        statuses = ("QUEUED", "LICENCE_HOLD") if args.local_evidence else ("QUEUED",)
        qd = build_queue()
        man = build_manifest(qd, top=args.top, wave=args.wave, plan=args.plan_wave, statuses=statuses,
                             include_stale=args.include_stale, only=args.only)
        if args.cmd == "manifest":
            out = pathlib.Path(args.out) if args.out else None
            if out:
                write_atomic(out, dump(man))
                print(f"[manifest] {len(man['scripts'])} targets -> {out}")
            else:
                print(dump(man))
            return 0
        if args.throttle_s < MIN_THROTTLE_S:
            print(f"[batch] REFUSED: --throttle-s {args.throttle_s} is below {MIN_THROTTLE_S:.0f}s (the owner's own account)")
            return 2
        if not man["scripts"]:
            print("[batch] nothing QUEUED matches the selection")
            return 0
        from batch_capture import DEFAULT_RUN_ROOT  # noqa: E402
        run_dir = pathlib.Path(args.run_dir) if args.run_dir else \
            DEFAULT_RUN_ROOT / ("evidence-" + _dt.datetime.now().strftime("%Y%m%d-%H%M%S"))
        run_dir.mkdir(parents=True, exist_ok=True)
        mpath = run_dir / "evidence-manifest.json"
        if not mpath.exists() or not args.run_dir:
            write_atomic(mpath, dump(man))
        else:
            print(f"[batch] resuming {run_dir} with its own manifest (selection flags ignored)")
        print(f"[batch] run dir: {run_dir} · {len(json.loads(mpath.read_text(encoding='utf-8'))['scripts'])} targets")
        cmd = [sys.executable, str(HERE / "batch_capture.py"), "run", "--manifest", str(mpath), "--run-dir", str(run_dir),
               "--throttle-s", str(args.throttle_s)]
        for flag, val in (("--profile", args.profile), ("--channel", args.channel), ("--title-selector", args.title_selector)):
            if val:
                cmd += [flag, val]
        code = subprocess.call(cmd, cwd=str(REPO))
        print(f"[batch] capture exit {code}")
        if not list((run_dir / "captures").glob("*.json")):
            print("[batch] no captures to grade")
            return code or 2
        gcode = cmd_grade(run_dir)
        sha = write_packet(run_dir, build_packet(run_dir))
        print(f"[batch] grade exit {gcode}. Packet: {run_dir / 'PROMOTION-PACKET.md'}")
        print(f"[batch] after reading it: python tools/vendor_harness/evidence_engine.py promote "
              f"--run-dir \"{run_dir}\" --packet-sha {sha[:12]}")
        return code or gcode

    if args.cmd == "grade":
        return cmd_grade(args.run_dir)

    if args.cmd == "packet":
        rd = pathlib.Path(args.run_dir)
        sha = write_packet(rd, build_packet(rd))
        print(f"[packet] {rd / 'PROMOTION-PACKET.md'}  sha256 {sha}")
        print(f"[packet] promote with --packet-sha {sha[:12]} after reading it")
        return 0

    if args.cmd == "promote":
        try:
            promote(pathlib.Path(args.run_dir), args.packet_sha, only=args.only)
        except PromoteRefused as exc:
            print(f"[promote] REFUSED: {exc}")
            print("VERDICT: REFUSED")
            return 1
        print("VERDICT: PASS")
        return 0

    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
