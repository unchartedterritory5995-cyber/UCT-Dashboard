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
  * counts a row its doc DISPOSES of as not a capture question (a `| not a capture | disposition | reason |`
    table, see DISPOSITIONS) as needing a probe: such a row is listed, counted and reasoned in
    `rowsNotCaptureQuestions`, never dropped;
  * guesses a chart: a target no row names a readable chart for is NEEDS_CHART, never batched;
  * batches a row that needs a live session (NEEDS_LIVE);
  * re-queues a capture already committed anywhere under tests/fixtures/vendor/;
  * commits, or overwrites an existing fixture (evidence is appended, never replaced);
  * lets a capture into git whose source licence is not clear (such a capture is LEDGER_ONLY at
    promote: its verdict is filed in the ledger with the source sha, the capture stays out of git);
  * grades without the machine-wide heavy lock (no lock tool found: grade REFUSES);
  * promotes anything without `--packet-sha` naming the packet as it is NOW.

⭐ ONE AUTHORITY PER VALUE: capture validity is `verify_capture.mjs` (called through
`batch_capture.NodeVerifier`), licence is `corpus_licence.is_permitted`, the door
flag state is `batch_manifest.ledger_flag_state`, guard capabilities are
`coverage_map.GUARD_BUCKET`, the pacing floor is `batch_capture.throttle_refusal`,
a source's capture stem is `capture_stem` (below). None of them is re-implemented.
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
#: Every committed capture, in ANY directory below this: the index the queue reads. ⛔ Not `harness/`
#: alone: 17 captures (the 2026-09-27 vocabulary wave) sit beside it, and a queue blind to them
#: re-queued work already done.
FIXTURE_ROOT = REPO / "tests" / "fixtures" / "vendor"
FIXTURES = FIXTURE_ROOT / "harness"          # where `promote` files a new capture
COVERAGE = DOCS / "coverage-map.json"
QUEUE_OUT = DOCS / "vendor-harness" / "capture-queue.json"
LEDGER = DOCS / "vendor-harness" / "evidence-ledger.jsonl"
DOOR_FLAG = "VITE_PINE_OBJECTS_ONLY_PANE_ENABLED"
#: The desktop's heavy-job lock tool; `$HEAVY_LOCK` (set by the laptop's env) wins. See `heavy_lock_tool`.
DESKTOP_HEAVY_LOCK = r"C:\Users\Patrick\uct-clips\tools\heavy_lock.py"
DEFAULT_CHART = ("NYSE:RDDT", "1D")
HOUSE_SYMBOLS = {"RDDT": "NYSE:RDDT", "SPY": "AMEX:SPY", "QQQ": "NASDAQ:QQQ", "AAPL": "NASDAQ:AAPL",
                 "BTCUSD": "BITSTAMP:BTCUSD"}
EXCHANGES = ("NYSE", "AMEX", "NASDAQ", "BITSTAMP", "BINANCE", "COINBASE", "CME", "TVC", "OANDA", "INDEX", "SP",
             "FX")
TF_ALLOWED = {"1", "3", "5", "15", "30", "45", "60", "120", "180", "240"}
DEFAULT_LIMIT = 40

#: Header cells that mark a table as a LEDGER of what is already settled, not a
#: queue of questions. Such tables are counted per doc as `contextTables`, never dropped silently.
LEDGER_HEADERS = {"settled", "served", "was", "now", "witness"}
LEDGER_FIRST_HEADERS = {"refused as"}
#: A heading that files the tables below it as a RECORD of captures already taken.
FINISHED_HEAD_RX = re.compile(r"^(?:(?:\d+(?:\.\d+)*|[A-Za-z]\d*)[.):]\s+|\d+(?:\.\d+)*\s+)?"
                              r"(?:captured|readings?|built|taken)\b(?!-)", re.I)
#: A column whose header marks it PROSE (a question, a "what it settles", what ships today): a probe or capture
#: named in it is a reference to something else, never a request. ⛔ Every other column (probe, script, capture, chart,
#: an unheaded one, the first) can still ask. Matched on the cleaned, lowercased header.
PROSE_HEAD_RX = re.compile(r"^(?:what\b|question|settles|why\b|notes?\b|shipped|gap\b|errs\b|where\b|alternative|"
                           r"candidates|withheld|served|rule\b|reading|evidence|ruling|grade when|witnessed)")
#: A capture id written out in a doc: `<stem>-...-<yyyy-mm-dd>`, optionally `.json`.
ID_TOKEN_RX = re.compile(r"`([a-z0-9][a-z0-9.-]*-\d{4}-\d{2}-\d{2})(?:\.json)?`")
#: Anything shaped `EXCH:SYM`, known exchange or not (an unknown one is a chart this parser cannot read).
CHART_TOKEN_RX = re.compile(r"\b([A-Z][A-Z0-9_]{1,15}):([A-Z0-9][A-Z0-9.!]{0,14})")
#: What `capture_stem` yields, and what follows it in an id the driver writes (`batch_capture.Driver.capture`).
STEM_RX = re.compile(r"[a-z0-9][a-z0-9.-]*")
TAIL_RX = re.compile(r"[a-z0-9.!]+(?:-[a-z0-9.!]+)*-(?:\d+|1?[dwm]|[0-9]+[dwm])-\d{4}-\d{2}-\d{2}")
#: Strongest first: where a target's chart was read. Only `default` (nothing named) is NEEDS_CHART.
CHART_RANK = {"row": 0, "section": 1, "preamble": 2, "census": 3, "default": 4}

#: THE ONE ROW DISPOSITION. A doc says a row of its own is NOT a capture question with a table headed
#: `| not a capture | disposition | reason |`: the first cell names the row exactly as the row's own first cell
#: reads (backticks and bold are ignored), the second is one of DISPOSITIONS, the third says why, in the doc's
#: own words. Such a row leaves `rowsNeedingProbe` and is never a target; it is listed, with its reason, in
#: `rowsNotCaptureQuestions` and counted, so nothing leaves the queue silently. A disposition with no reason,
#: outside DISPOSITIONS, given twice, or naming no row of its doc REFUSES the whole queue (`DispositionError`).
DISPOSITION_HEAD = "not a capture"
DISPOSITIONS = {
    "ruling": "blocked by an owner ruling, not by a missing capture",
    "engine-gap": "engine work: what it needs is a build, not a TradingView reading",
    "closed": "the item is closed; nothing is asked",
    "by-design": "the engine's behaviour here is a decision, not an open question",
    "builtin": "a TradingView built-in no probe file can stand in for",
    "withheld-ledger": "a record of what the engine withholds; the capture that settles it, if any, is its own row",
    "superseded": "a later row asks the same question with its own probe (the reason names it); that row is the capture",
}

#: ⛔ THE ONE LIVE MARKER. A row needs a live session (NEEDS_LIVE) when its doc SAYS so, explicitly: a table
#: with a `live` (or `needs market hours`) column is the authority for every row of it, its cell one of
#: LIVE_YES / LIVE_NO (anything else refuses the queue, `LiveMarkerError`). A table without the column falls
#: back to LIVE_RX, which names a SESSION ("market hours", "realtime", "forming", ...), never a word that
#: also names history: 2026-11-08 the old pattern's `live` / `ticks?` / `1m` / `varip` matched probe names
#: (`w9-q-s1e-live-past`, `w9-p3-every-tick-history`, `w9-q-s1d-same-tick`), `format.mintick`'s "tick" and
#: AMEX:SPY **1M** (monthly), and marked four history captures NEEDS_LIVE (W9-P3, Q-S1d, Q-S1e, Q-W3-6).
#: NOT_LIVE_RX strips a NEGATED mention ("no market hours needed") before LIVE_RX looks.
LIVE_HEADS = {"live", "needs market hours"}
LIVE_YES = {"yes", "true", "live"}
LIVE_NO = {"no", "false", "history", "-", ""}
LIVE_RX = re.compile(r"market hours|during regular hours|during RTH\b|\brealtime\b|\breal-time\b|\bforming\b|"
                     r"minutes apart", re.I)
NOT_LIVE_RX = re.compile(r"\bno market hours(?: needed)?|\bmarket hours (?:are )?not needed", re.I)
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


def house_slug(stem) -> str:
    """A file stem's house slug: everything from its first `__` dropped (the corpus hash, as the census slug
    in `memberDoorCensus.measure.test.js` drops it), lowercased, each run outside [a-z0-9.] one `-`."""
    return re.sub(r"[^a-z0-9.]+", "-", str(stem).split("__", 1)[0].lower()).strip("-")


def _pkey(p) -> str:
    return os.path.normcase(str(pathlib.Path(p).resolve()))


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

    def __init__(self, docs_dir=DOCS, probe_dirs=PROBE_DIRS, corpus=CORPUS, fixtures=FIXTURE_ROOT,
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
        self._by_sha = None
        self._stems = None

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
        """[{id, file, sha, symbol, tf}] for every v1 capture ANYWHERE under the fixture root (recursive:
        a capture beside `harness/` is as committed as one in it)."""
        if self._fixtures is None:
            out = []
            if self.fixtures.exists():
                for f in sorted(self.fixtures.rglob("*.json")):
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
    def fixture_ids(self) -> set:
        """Every committed capture's id and file stem (they agree for a well-named file; both are held)."""
        return {f["id"] for f in self.fixture_index} | {pathlib.PurePath(f["file"]).stem for f in self.fixture_index}

    @property
    def sources_by_sha(self) -> dict:
        """{sha256: (kind, path)} over every probe and corpus file; a probe wins a tie (it is ours)."""
        if self._by_sha is None:
            out = {}
            for kind, files in (("probe", self.probes), ("corpus", self.corpus_files)):
                for p in files.values():
                    out.setdefault(sha256_bytes(p.read_bytes()), (kind, p))
            self._by_sha = out
        return self._by_sha

    @property
    def capture_stems(self) -> dict:
        """{path key: capture stem} for every probe and corpus file (see `capture_stem`)."""
        if self._stems is None:
            groups = collections.defaultdict(list)
            for p in list(self.probes.values()) + list(self.corpus_files.values()):
                groups[house_slug(p.stem)].append(p)
            out = {}
            for base, files in groups.items():
                for p in files:
                    out[_pkey(p)] = f"{base}-{sha256_bytes(p.read_bytes())[:8]}" if len(files) > 1 else base
            self._stems = out
        return self._stems

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


def capture_stem(world: World, path) -> str:
    """⭐ THE capture stem of a source file: the `<script>` of `<script>-<sym>-<tf>-<yyyy-mm-dd>`. ONE authority:
    `build_manifest` hands it to the driver as `captureStem`, `fixture_status` finds a stale capture by it, and
    `gate_capture` holds a capture's id to it, so the three cannot disagree. ⚰️ They did: the manifest handed
    over the raw stem, a corpus capture came back as `gamma__abcdef1234-rddt-1d-...`, failed the gate's own id
    rule, was never promotable, and every batch took it again.
    The house rule (the census slug `batch_manifest.py` selects on): `__<hash>` dropped, lowercased, and
    `-<sha8>` appended when two files of the world share the slug (three `support-and-resistance__*` today)."""
    return world.capture_stems.get(_pkey(path)) or house_slug(pathlib.Path(path).stem)


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


def parse_charts(text: str, prose: bool = False) -> list:
    """[(symbol, tf)] named in `text`, in order, deduplicated. A symbol with no timeframe
    right after it reads as 1D (the house default for every queue doc).
    ⛔ In PROSE (a doc's preamble, a section's lead) only an explicit `EXCH:SYM` is a chart: a bare
    `RDDT` there is a reference to an old capture ("qqe-signals RDDT 1D", "40 SPY bars"), not an ask."""
    out = []
    for m in SYMBOL_RX.finditer(text):
        if prose and not m.group(1):
            continue
        sym = f"{m.group(1)}:{m.group(2)}" if m.group(1) else HOUSE_SYMBOLS[m.group(3)]
        for t in tfs_after(text, m.end()) or ["1D"]:
            if (sym, t) not in out:
                out.append((sym, t))
    return out


def unparsed_charts(text: str) -> list:
    """`EXCH:SYM` tokens whose exchange this parser does not know: charts a row names and nobody can read."""
    return sorted({m.group(0) for m in CHART_TOKEN_RX.finditer(text) if m.group(1) not in EXCHANGES})


def heading_path(lines, start) -> list:
    """The headings a table sits under: the nearest one, then each shallower one enclosing it."""
    out, level = [], 7
    for k in range(start - 1, -1, -1):
        m = re.match(r"^(#{1,6})\s+(.*)", lines[k])
        if m and len(m.group(1)) < level:
            out.append(m.group(2).strip())
            level = len(m.group(1))
    return out


def finished_table(world: World, header, trows, heads):
    """Why a table RECORDS captures already taken rather than asking for one, or None. Such a table is
    context: read as a queue, its rows re-queue finished work on a guessed chart (the 2026-09-27
    CAPTURED table made seven targets that way)."""
    for h in heads:
        if FINISHED_HEAD_RX.match(re.sub(r"^[\s_]+", "", re.sub(r"[*`]+", "", h))):
            return f"under the heading {h[:48]!r}"
    for ci, name in enumerate(header):
        if "capture" not in name:
            continue
        toks = [t for _, cells in trows if ci < len(cells) for t in ID_TOKEN_RX.findall(cells[ci])]
        if toks and all(t in world.fixture_ids for t in toks):
            return f"its {name!r} column lists committed captures"
    return None


def resolve_sources(world: World, text: str, refs_only: bool = False):
    """(sources [(kind, path)], owed [names], fixture_stems [stems]) named in `text`.
    ⛔ `refs_only` is for a PROSE cell (see PROSE_HEAD_RX): every probe it names, as `x.pine` or as a bare stem,
    is a fixture reference and nothing in it is a source or an owed probe.
    ⛔ A token `<probe stem>-<chart>[-<date>]` names a CAPTURE of that probe: it is filed as a fixture
    reference, never read as the row's source (`vw-bool-cast-spy-60` in a prose cell is not a request to
    run vw-bool-cast; the row's section says what to run)."""
    sources, owed, fx = [], [], []
    seen = set()
    for name in PINE_RX.findall(text):
        kind, p = world.resolve_pine(name)
        if refs_only:
            if kind == "probe" and p.stem not in fx:
                fx.append(p.stem)
            continue
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
        if tok in world.probes and refs_only:
            if tok not in fx:
                fx.append(tok)
            continue
        if tok in world.probes:
            p = world.probes[tok]
            if str(p) not in seen:
                seen.add(str(p))
                sources.append(("probe", p))
            continue
        hit = next((s for s in stems if tok.startswith(s + "-")), None)
        if hit and hit not in fx:
            fx.append(hit)       # a REFERENCE to a capture of `hit`, never a source
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


class LiveMarkerError(ValueError):
    """A `live` column cell the queue cannot read as yes or no."""


def row_needs_live(header, cells, rtext: str, where: str) -> bool:
    """THE live classifier: the table's explicit `live` column if it has one, else LIVE_RX on the row's text."""
    col = next((i for i, h in enumerate(header) if h in LIVE_HEADS), None)
    if col is not None:
        v = clean_cell(cells[col]).lower() if col < len(cells) else ""
        if v in LIVE_YES:
            return True
        if v in LIVE_NO:
            return False
        raise LiveMarkerError(f"{where}: a `live` cell must be one of {sorted(LIVE_YES | LIVE_NO)}, not {v!r}")
    return bool(LIVE_RX.search(NOT_LIVE_RX.sub(" ", rtext)))


class DispositionError(ValueError):
    """A `not a capture` disposition the queue cannot honour: no reason, an unknown disposition, or no such row."""


def row_id(cells, line_no) -> str:
    """A row's id, as its key carries it: the first cell, cleaned, whitespace folded, at most 60 characters."""
    rid = clean_cell(cells[0]) if cells else ""
    return re.sub(r"\s+", " ", rid)[:60] or f"L{line_no}"


def read_dispositions(path: pathlib.Path, lines) -> dict:
    """{row id: {disposition, reason, line}} from the doc's `not a capture` tables. Refuses a bad one."""
    out = {}
    for _start, header, trows in iter_tables(lines):
        if not header or header[0] != DISPOSITION_HEAD:
            continue
        for line_no, cells in trows:
            rid = row_id(cells, line_no)
            kind = clean_cell(cells[1]).lower() if len(cells) > 1 else ""
            reason = clean_cell(" | ".join(cells[2:])) if len(cells) > 2 else ""
            where = f"{path.name}:{line_no} ({rid!r})"
            if kind not in DISPOSITIONS:
                raise DispositionError(f"{where}: disposition {kind!r} is not one of {sorted(DISPOSITIONS)}")
            if not reason:
                raise DispositionError(f"{where}: a `not a capture` disposition needs a reason")
            if rid in out:
                raise DispositionError(f"{where}: the row is disposed of twice")
            out[rid] = {"disposition": kind, "reason": re.sub(r"\s+", " ", reason), "line": line_no}
    return out


def parse_doc(world: World, path: pathlib.Path) -> dict:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    dispositions = read_dispositions(path, lines)
    disposed = set()
    m = DOC_RX.match(path.stem)
    date, tag = (m.group(1), m.group(2) or m.group(1)) if m else ("", path.stem)
    first_table = next((i for i, ln in enumerate(lines) if ln.lstrip().startswith("|")), len(lines))
    preamble = "\n".join(lines[:first_table])
    pre_sources = explicit_pines(world, preamble)
    pre_charts = parse_charts(preamble, prose=True)
    rows, context = [], 0
    ids = collections.Counter()
    for start, header, trows in iter_tables(lines):
        # the SECTION a table sits in: from the nearest heading above it to the table
        h = next((k for k in range(start - 1, -1, -1) if lines[k].lstrip().startswith("#")), None)
        lead = "\n".join(lines[h:start]) if h is not None and h >= first_table else ""
        lead_sources = explicit_pines(world, lead) if lead else []
        lead_charts = parse_charts(lead, prose=True) if lead else []
        # ⭐ THE SECTION DECIDES: a section naming its own .pine is asked (two of them is ambiguous, so
        # nothing is inherited); the preamble speaks only for a section that names none.
        inherit_from = lead_sources if lead_sources else pre_sources
        if header and header[0] == DISPOSITION_HEAD:
            continue        # read above: a disposition table asks for nothing
        if (set(header) & LEDGER_HEADERS) or (header and header[0] in LEDGER_FIRST_HEADERS):
            context += 1
            continue
        if finished_table(world, header, trows, heading_path(lines, start)):
            context += 1
            continue
        stated_cols = [i for i, h in enumerate(header) if STATED_HEAD_RX.search(h)]
        for line_no, cells in trows:
            rid = row_id(cells, line_no)
            ids[rid] += 1
            key = f"{path.stem}#{rid}" + (f"~{ids[rid]}" if ids[rid] > 1 else "")
            rtext = " | ".join(cells)
            # ⛔ Only the row's REQUEST cells can ask for a probe; a prose cell ("covered by `x`", "the old `y.pine`
            # read 0") only refers to one.
            prose = [ci < len(header) and bool(PROSE_HEAD_RX.match(header[ci])) for ci in range(len(cells))]
            sources, owed, fx = resolve_sources(world, " | ".join(c for c, pr in zip(cells, prose) if not pr))
            _, _, fx_prose = resolve_sources(world, " | ".join(c for c, pr in zip(cells, prose) if pr), refs_only=True)
            fx = fx + [x for x in fx_prose if x not in fx]
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
            # ⛔ WHERE THE CHART COMES FROM, strongest first. A row that names a chart nobody can read gets
            # NO chart (never its section's), and a row with nothing to read takes the house default and
            # is marked so: its target is NEEDS_CHART, never batched (the queue must not invent charts).
            row_charts, unparsed = parse_charts(rtext), unparsed_charts(rtext)
            if row_charts:
                charts, chart_source = row_charts, "row"
            elif unparsed:
                charts, chart_source = [], "default"
            elif lead_charts:
                charts, chart_source = lead_charts, "section"
            elif pre_charts:
                charts, chart_source = pre_charts, "preamble"
            else:
                charts, chart_source = [], "default"
            defaulted = chart_source == "default"
            if defaulted:
                charts = [DEFAULT_CHART]
            listing = bool(LISTING_RX.search(rtext)
                           or (chart_source == "section" and LISTING_RX.search(lead))
                           or (chart_source == "preamble" and LISTING_RX.search(preamble)))
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
                "charts": [list(c) for c in charts], "chartDefaulted": defaulted, "chartSource": chart_source,
                "unparsedCharts": unparsed,
                "fromListing": listing,
                "needsLive": row_needs_live(header, cells, rtext, f"{path.name}:{line_no} ({rid!r})"),
                "needsProbe": needs_probe,
                "guards": sorted(set(GUARD_RX.findall(rtext))),
                "namedScripts": sorted(set(SLUG_RX.findall(rtext))),
                "statedUnblocks": stated,
                "fixtureRefs": fx,
                "notCapture": dispositions.get(rid),
            })
            if rid in dispositions:
                disposed.add(rid)
    stray = sorted(set(dispositions) - disposed)
    if stray:
        raise DispositionError(f"{path.name}: `not a capture` names no row of this doc: {stray}")
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


def fixture_status(world: World, path, sha: str, symbol: str, tf: str):
    t = norm_tf(tf)
    exact = [f for f in world.fixture_index if f["sha"] == sha and f["symbol"] == symbol.upper() and f["tf"] == t]
    if exact:
        return "CAPTURED", [f["file"] for f in exact]
    for r in world.ledger:
        if r.get("sourceSha256") == sha and str(r.get("symbol", "")).upper() == symbol.upper() \
                and norm_tf(r.get("timeframe")) == t and r.get("verdict"):
            return "VERDICT_LOCAL", [r.get("captureId")]
    # a capture of an OLDER version of this file, found by its capture stem (never a sibling probe's
    # `x-v4-...` fixture, never another corpus file's that shares the slug: that one carries its -sha8)
    lead = f"{capture_stem(world, path)}-{slugify(symbol.split(':')[-1])}-"
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

    def target_for(kind, path, symbol, tf, listing, origin, chart_source):
        raw = path.read_bytes()
        sha = sha256_bytes(raw)
        tid = f"{path.stem}@{symbol}@{norm_tf(tf)}"
        t = targets.get(tid)
        if t is None:
            t = targets[tid] = {
                "id": tid, "path": path, "source": rel(path), "sourceKind": kind, "sha256": sha, "bytes": len(raw),
                "stem": path.stem, "symbol": symbol, "tf": rig_tf(tf), "fromListing": False,
                "licence": licence_of(world, kind, path), "rows": [], "origins": [],
                "needsLive": False, "guards": set(), "named": set(), "direct": set(), "stated": [],
                "docWaves": set(), "docDates": set(), "chartSources": set(), "unparsed": set(),
            }
        t["fromListing"] = t["fromListing"] or listing
        t["chartSources"].add(chart_source)
        if origin not in t["origins"]:
            t["origins"].append(origin)
        return t

    rows_out, needs_probe, not_capture = [], [], []
    for d in docs:
        for r in d["rows"]:
            rows_out.append(r)
            if r["notCapture"]:
                not_capture.append(r)       # the doc says why: listed and counted, never a target
                continue
            if r["needsProbe"]:
                needs_probe.append(r)
                continue
            for s in r["sources"]:
                p = REPO / s["path"] if not pathlib.Path(s["path"]).is_absolute() else pathlib.Path(s["path"])
                for sym, tf in r["charts"]:
                    t = target_for(s["kind"], p, sym, tf, r["fromListing"], "queue-doc", r["chartSource"])
                    t["rows"].append(r["key"])
                    t["unparsed"].update(r["unparsedCharts"])
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
            # the house chart, chosen ON PURPOSE for this pool (one MATCH per script): not a guess
            t = target_for("corpus", p, DEFAULT_CHART[0], DEFAULT_CHART[1], True, "census", "census")
            t["direct"].add(k)
            t["docWaves"].add("E-census")
        else:
            cache = world.cache_dir / ("builtin" if pop == "builtin" else "sources") / f"{slug}.pine"
            held.append({"key": k, "population": pop, "title": s.get("title"),
                         "cachedSource": rel(cache), "sourcePresent": cache.exists(),
                         "vendorVerdict": s.get("vendorVerdict")})

    by_sha = collections.defaultdict(set)
    for f in world.fixture_index:
        by_sha[f["sha"]].add(f"{f['symbol']} {f['tf']}")
    out_targets = []
    for t in targets.values():
        st, ev = fixture_status(world, t["path"], t["sha256"], t["symbol"], t["tf"])
        chart_source = min(t["chartSources"], key=CHART_RANK.__getitem__)
        chart_defaulted = chart_source == "default"     # no row, section, preamble or pool named this chart
        # ⛔ THE CHART GUARD: a target whose chart nobody named is NEEDS_CHART whatever is on disk for the
        # guessed chart (a capture there does not answer the row). ⛔ THE ONE LIVE GUARD: a target any row says
        # needs a live session is NEEDS_LIVE unless already answered. The manifest selects by status alone.
        if chart_defaulted:
            st = "NEEDS_CHART"
        elif t["needsLive"] and st in (None, "STALE"):
            st = "NEEDS_LIVE"
        elif st is None:
            st = "QUEUED" if t["licence"] != "held" else "LICENCE_HOLD"
        u = census.unblocks(t["guards"], t["named"], t["direct"])
        out_targets.append({
            "id": t["id"], "status": st, "evidence": ev,
            "source": t["source"], "sourceKind": t["sourceKind"], "sha256": t["sha256"], "bytes": t["bytes"],
            "stem": t["stem"], "captureStem": capture_stem(world, t["path"]),
            "symbol": t["symbol"], "tf": t["tf"], "fromListing": t["fromListing"],
            "chartDefaulted": chart_defaulted, "chartSource": chart_source, "unparsedCharts": sorted(t["unparsed"]),
            "capturedOn": sorted(by_sha.get(t["sha256"], ())),
            "licence": t["licence"], "needsLive": t["needsLive"],
            "priority": u["priority"], "unblocks": u,
            "statedUnblocks": max(t["stated"]) if t["stated"] else None,
            "guards": sorted(t["guards"]), "planWave": plan_wave(t["guards"], t["direct"], bucket),
            "docWaves": sorted(t["docWaves"]), "oldestDoc": min(t["docDates"]) if t["docDates"] else "",
            "rows": t["rows"], "origins": t["origins"],
        })
    out_targets.sort(key=priority_key)
    counts = summarise(out_targets, needs_probe, held)
    counts["rowsNotCaptureQuestions"] = len(not_capture)
    counts["rowsNotCaptureByDisposition"] = dict(sorted(collections.Counter(
        r["notCapture"]["disposition"] for r in not_capture).items()))
    counts["rowsNamingUnreadableCharts"] = sum(1 for r in rows_out if r["unparsedCharts"])
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
            "NEEDS_CHART": "no row, section or preamble names a chart this parser can read for the target, so its "
                           "chart is the house default, a guess: never batched; a person names the chart in the row",
            "chartSource": "where the chart was read: row | section (the heading above the table) | preamble "
                           "(explicit EXCH:SYM only) | census (the E-census pool's house chart, on purpose) | default",
            "capturedOn": "every chart a committed capture of this exact source sha is on (any directory)",
            "rowsNotCaptureQuestions": "rows their own doc disposes of in a `| not a capture | disposition | reason |` "
                                       "table: never a target, never counted in rowsNeedingProbe",
            "dispositions": DISPOSITIONS,
        },
        "counts": counts,
        "targets": out_targets,
        "rowsNeedingProbe": [{k: r[k] for k in ("key", "doc", "line", "docWave", "needsProbe", "needsLive",
                                                "guards", "namedScripts", "text")} for r in needs_probe],
        "rowsNotCaptureQuestions": [{"key": r["key"], "doc": r["doc"], "line": r["line"], "docWave": r["docWave"],
                                     "disposition": r["notCapture"]["disposition"],
                                     "reason": r["notCapture"]["reason"],
                                     "dispositionLine": r["notCapture"]["line"], "text": r["text"]}
                                    for r in not_capture],
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
                   statuses=("QUEUED",), include_stale=False, only=None, world: World | None = None) -> dict:
    from batch_capture import KNOWN_LISTING  # noqa: E402 — the one listing authority
    world = world or World()
    want = set(statuses) | ({"STALE"} if include_stale else set())
    # ⛔ A GUESSED CHART IS NEVER BATCHED, whatever statuses were asked for: no manifest takes a target
    # whose chart nobody named (the queue's NEEDS_CHART, held here a second way for a hand-made selection).
    picked = [t for t in queue["targets"] if t["status"] in want and not t.get("chartDefaulted")
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
            "symbol": t["symbol"], "tf": t["tf"],
            "captureStem": capture_stem(world, p),
            "listingDate": KNOWN_LISTING.get(t["symbol"].upper()) if t["fromListing"] else None,
            "chartDefaulted": bool(t.get("chartDefaulted")), "chartSource": t.get("chartSource"),
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
    hit = world.sources_by_sha.get(src.get("sha256"))
    if hit is not None:
        return hit[0]                 # "probe" | "corpus": the bytes are ours, or committed open source
    try:
        from corpus_licence import is_permitted  # noqa: E402
        return "permitted" if is_permitted(src.get("text") or "") else "held"
    except Exception:  # noqa: BLE001
        return "held"


def gate_capture(world: World, path: pathlib.Path, verifier, fixtures_dir: pathlib.Path, manifest_entry=None) -> dict:
    """Every problem with promoting this capture, plus its licence class. Never raises.
    `manifest_entry`: the run manifest's own script entry for this capture (or None)."""
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
    # ⛔ THE ID RULE: the id must open with the capture stem the driver was ASKED for. That is the run manifest's
    # own `captureStem`, taken when the manifest entry is for this very source (same sha): the stem of a
    # source depends on which other files share its slug TODAY, and a same-slug file added between the capture and
    # the promote must not make a valid capture unpromotable (nor the packet differ from what was read).
    # With no such entry: the stem of the source the world knows by sha; for any other source, the house form.
    sha = (cap.get("source") or {}).get("sha256")
    src = world.sources_by_sha.get(sha)
    asked = (manifest_entry or {}).get("captureStem")
    if not (isinstance(asked, str) and STEM_RX.fullmatch(asked) and (manifest_entry or {}).get("sha256") == sha):
        asked = None
    if not isinstance(cid, str):
        problems.append(f"id {cid!r} is not <script>-<sym>-<tf>-<yyyy-mm-dd>")
    elif asked is not None or src is not None:
        want = asked if asked is not None else capture_stem(world, src[1])
        if not (cid.startswith(want + "-") and TAIL_RX.fullmatch(cid[len(want) + 1:])):
            why = (f"the captureStem the run manifest asked the driver for" if asked is not None
                   else f"the capture stem of its source, {rel(src[1])}")
            problems.append(f"id {cid!r} is not {want}-<sym>-<tf>-<yyyy-mm-dd>: {want} is {why}")
    elif not ID_RX.match(cid):
        problems.append(f"id {cid!r} is not <script>-<sym>-<tf>-<yyyy-mm-dd>")
    # ⛔ NEVER REPLACED: not in the directory it would be filed in, and not anywhere in the fixture tree
    if (pathlib.Path(fixtures_dir) / f"{cid}.json").exists() or cid in world.fixture_ids:
        problems.append(f"{cid} is already a committed capture: evidence is appended, never replaced")
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
        man = by_slug.get((by_capture.get(f.stem) or {}).get("slug")) or {}
        g = gate_capture(world, f, verifier, fixtures_dir, manifest_entry=man)
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
            # was this chart ASKED (by a row, a section, a preamble, the census pool) or a guess? None: the
            # run's manifest does not say (a manifest that predates the field, or none)
            "chartDefaulted": man.get("chartDefaulted"), "chartSource": man.get("chartSource"),
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
          "verdict filed, capture stays out of git. REFUSE = nothing happens; the reason is listed.",
          "`chart asked`: where the chart came from (row / section / preamble / census). `GUESSED` = no row named "
          "it, so the capture answers no row's question; `?` = the run's manifest does not say.", "",
          "| action | capture | chart | chart asked | verdict | first divergence | licence | rows | problems |",
          "|---|---|---|---|---|---|---|---|---|"]
    for i in body["items"]:
        fd = i["firstDivergence"]
        fds = (f"{fd.get('plot')} bar {fd.get('bar', fd.get('index'))} {fd.get('kind')}" if fd else "")
        asked = "?" if i.get("chartDefaulted") is None else "GUESSED" if i["chartDefaulted"] else i.get("chartSource")
        md.append("| {} | `{}` | {} {} | {} | {} | {} | {} | {} | {} |".format(
            i["action"], i["id"], i["symbol"], i["timeframe"], asked, i["verdict"], fds.replace("|", "/"),
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
            "queueTargetId": i["queueTargetId"], "rows": i["rows"], "chartDefaulted": i.get("chartDefaulted"),
            "provenance": i["provenance"],
        })
    n = append_ledger(ledger, ledger_rows)
    log(f"[promote] promoted {len(promoted)} · ledger-only {len(filed)} · refused {len(refused)} · ledger +{n}")
    log("[promote] nothing was committed: review `git status`, then commit with the packet sha in the message")
    return {"promoted": promoted, "ledgerOnly": filed, "refused": refused, "ledgerRows": n, "packetSha256": sha}


# ─── W9-T2: the broker pin ledger (design rule 7) ────────────────────────────
RT_DIR = REPO / "app" / "src" / "components" / "chart" / "engine" / "runtime"
PINS_SRC = RT_DIR / "brokerPins.json"
PINS_OUT = RT_DIR / "brokerPins.resolved.json"
PINS_SCHEMA = "uct.broker-pins/v1"
PINS_RESOLVED_SCHEMA = "uct.broker-pins.resolved/v1"


class PinResolveError(Exception):
    """A pin names a fixture with no committed verdict, or the source is malformed."""


def read_ledger_rows(path: pathlib.Path = LEDGER) -> list:
    rows = []
    path = pathlib.Path(path)
    if not path.exists():
        return rows
    for ln in path.read_text(encoding="utf-8").splitlines():
        if not ln.strip():
            continue
        rows.append(json.loads(ln))
    return rows


# ─── W9-T6 r1/r2: the settings read-back is a PRECONDITION on every pin fixture, not a broker rule ───────
# Design 5.1: "every capture reads its settings back". A broker fill's timing rests on six Properties
# settings (TradingView changed several of them in July 2026, design 0.2 finding 5; W9-J1 is the read-back
# of their defaults on Q-S1-core). If a capture ran with any of them other than what its own source asks
# for, every rule it pins is void. So a fixture counts as MATCH only when EVERY committed row of it:
#   - names its source (`sourceSha256`) and that source is committed here (a probe or the committed corpus);
#   - carries a read-back (`provenance.strategySettings.properties`, W9-T3a);
#   - reads back, for each of the six, EXACTLY what its source's `strategy()` declares as a literal, and the
#     R6 default for each it does not declare (a declaration that is not a literal fails closed).
# The expected values are DERIVED from the capture's own source; the Properties names, the `strategy()`
# parameter of each and how its literal is read come from `strategy_capture.mjs::PROPERTY_TABLE`, the
# capture side's one table. Only the R6 defaults are stated here: each is R6 `strategy()`'s "The default is".
SETTINGS_DEFAULTS = {
    "process_orders_on_close": False,        # order execution delay: one tick (W9-P1 moves it)
    "calc_on_order_fills": False,            # (W9-P1b / W9-P2 move it)
    "calc_on_every_tick": False,             # (W9-P3 moves it)
    "backtest_fill_limits_assumption": 0,    # limit order execution: 0 ticks
    "use_bar_magnifier": False,              # bar detalization: off
    "calc_on_every_history_tick": False,     # history-bar ticks: off
}
STRATEGY_CAPTURE_MJS = HERE / "strategy_capture.mjs"
SETTINGS_REFUSED = "MATCH-WITHOUT-SETTINGS-READBACK"


def settings_property_table(path: pathlib.Path = STRATEGY_CAPTURE_MJS) -> dict:
    """{key: {name, param, kind}} for the checked keys, parsed from PROPERTY_TABLE."""
    text = pathlib.Path(path).read_text(encoding="utf-8")
    out = {}
    for key in SETTINGS_DEFAULTS:
        m = re.search(r"\{ key: '" + re.escape(key) + r"', name: (['\"])(.*?)\1, param: (null|'(\w+)'), kind: '(\w+)'", text)
        if not m:
            raise PinResolveError(f"strategy_capture.mjs PROPERTY_TABLE names no `{key}` (name, param, kind)")
        out[key] = {"name": m.group(2), "param": m.group(4), "kind": m.group(5)}
    return out


def _strategy_call_args(source: str):
    """{param: raw text} of the source's `strategy(...)` named arguments (comments and strings respected);
    None when there is no `strategy(` call."""
    text = str(source or "")
    i, n, start = 0, len(text), None
    while i < n:                       # find `strategy(` outside comments and strings
        ch = text[i]
        if text.startswith("//", i):
            i = text.find("\n", i)
            i = n if i < 0 else i
            continue
        if ch in "\"'":
            j = i + 1
            while j < n and text[j] != ch and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            i = j + 1
            continue
        m = re.compile(r"(?<![\w.])strategy\s*\(").match(text, i)
        if m and (i == 0 or not (text[i - 1].isalnum() or text[i - 1] in "_.")):
            start = m.end()
            break
        i += 1
    if start is None:
        return None
    args, depth, cur, q, k = {}, 0, "", None, start

    def flush(c):
        mm = re.match(r"^\s*([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*?)\s*$", c)
        if mm:
            args[mm.group(1)] = mm.group(2)
    while k < n:
        ch = text[k]
        if q:
            cur += ch
            if ch == "\\":
                cur += text[k + 1] if k + 1 < n else ""
                k += 1
            elif ch == q:
                q = None
            k += 1
            continue
        if ch in "\"'":
            q = ch
            cur += ch
            k += 1
            continue
        if text.startswith("//", k):
            nl = text.find("\n", k)
            k = n if nl < 0 else nl
            continue
        if ch in "([":
            depth += 1
        elif ch in ")]":
            if depth == 0:
                flush(cur)
                return args
            depth -= 1
        if ch == "," and depth == 0:
            flush(cur)
            cur = ""
            k += 1
            continue
        cur += ch
        k += 1
    return None   # unbalanced: no declaration this can read


def _literal(raw: str, kind: str):
    t = str(raw).strip()
    if kind == "bool":
        return True if t == "true" else False if t == "false" else None
    if kind == "num":
        return float(t) if re.fullmatch(r"[-+]?\d+(\.\d+)?", t) else None
    return None


def expected_settings(source: str, table: dict):
    """The six settings this capture's source asks for: its literal declarations, R6 defaults for the
    rest. None when the source has no `strategy(` call or declares one of them as a non-literal."""
    args = _strategy_call_args(source)
    if args is None:
        return None
    out = {}
    for key, default in SETTINGS_DEFAULTS.items():
        param = table[key]["param"]
        if param and param in args:
            lit = _literal(args[param], table[key]["kind"])
            if lit is None:
                return None
            out[key] = lit
        else:
            out[key] = default
    return out


def _same(value, expected) -> bool:
    if isinstance(expected, bool):
        if isinstance(value, str):
            value = value.strip().lower()
            return value == ("true" if expected else "false") or value == ("1" if expected else "0")
        return value is expected or (not isinstance(value, bool) and value == int(expected))
    if isinstance(value, bool):
        return False
    try:
        return float(value) == float(expected)
    except (TypeError, ValueError):
        return False


def settings_readback_ok(row: dict, source: str, table: dict) -> bool:
    """True only when the row's read-back shows exactly what `source` asks for, for all six."""
    expected = expected_settings(source, table) if source is not None else None
    if expected is None:
        return False
    ss = ((row.get("provenance") or {}).get("strategySettings") or {})
    props = ss.get("properties") if isinstance(ss, dict) else None
    if not isinstance(props, list):
        return False
    by_name = {" ".join(str(p.get("name", "")).split()).lower(): p for p in props if isinstance(p, dict)}
    for key, want in expected.items():
        p = by_name.get(" ".join(table[key]["name"].split()).lower())
        if p is None or "value" not in p or not _same(p["value"], want):
            return False
    return True


def committed_sources_by_sha() -> dict:
    """{sha256: source text} over every committed probe and corpus file. A capture hashes its source TEXT
    (`adapters.mjs`), so an autocrlf checkout is hashed as LF too."""
    out = {}
    for d in (*PROBE_DIRS, CORPUS / "committed"):
        if not d.exists():
            continue
        for p in sorted(d.rglob("*.pine")):
            b = p.read_bytes()
            text = b.decode("utf-8", errors="replace")
            for variant in (b, b.replace(b"\r\n", b"\n")):
                out.setdefault(sha256_bytes(variant), text.replace("\r\n", "\n"))
    return out


def resolve_pins(pins: dict, ledger_rows: list, sources: dict | None = None) -> dict:
    """A rule is kept with its fixtures ONLY when every committed verdict for every one of those
    fixtures is MATCH. A DIVERGE or INCONCLUSIVE verdict (or any non-MATCH) un-pins the rule; a
    fixture with NO committed verdict, an empty fixture list or a malformed source is an ERROR (a
    missing fixture fails, it never silently un-pins). A MATCH row also needs its settings read-back
    to show what its own source asks for (`settings_readback_ok`); without it the row is not MATCH.
    `sources` ({sha256: text}) defaults to the committed probes and corpus."""
    if not isinstance(pins, dict) or pins.get("schema") != PINS_SCHEMA or not isinstance(pins.get("rules"), dict):
        raise PinResolveError(f"brokerPins.json must be {{schema: {PINS_SCHEMA!r}, rules: {{...}}}}")
    pinned_ids = {i for ids in pins["rules"].values() if isinstance(ids, list) for i in ids}
    verdicts = {}
    table = None
    for r in ledger_rows:
        cid = r.get("captureId")
        if cid:
            v = r.get("verdict")
            if v == "MATCH" and cid in pinned_ids:
                table = table or settings_property_table()
                if sources is None:
                    sources = committed_sources_by_sha()
                if not settings_readback_ok(r, sources.get(r.get("sourceSha256")), table):
                    v = SETTINGS_REFUSED   # design 5.1: the precondition failed, so not MATCH
            verdicts.setdefault(cid, []).append(v)
    kept = {}
    for rule in sorted(pins["rules"]):
        ids = pins["rules"][rule]
        if not isinstance(ids, list) or not ids or not all(isinstance(i, str) and i for i in ids):
            raise PinResolveError(f"rule {rule!r}: a non-empty list of fixture ids is required")
        missing = [i for i in ids if i not in verdicts]
        if missing:
            raise PinResolveError(f"rule {rule!r}: no committed verdict for fixture(s) {sorted(missing)}")
        if all(v == "MATCH" for i in ids for v in verdicts[i]):
            kept[rule] = sorted(set(ids))
    return {"schema": PINS_RESOLVED_SCHEMA, "rules": kept}


def canonical_pins_text(doc: dict) -> str:
    """Sorted keys at every level, no spaces, one trailing newline: what the JS lock rail's
    `canonicalJson` produces byte for byte."""
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"


def cmd_pins(check: bool = False, src=PINS_SRC, out=PINS_OUT, ledger=LEDGER) -> int:
    text = canonical_pins_text(resolve_pins(json.loads(pathlib.Path(src).read_text(encoding="utf-8")),
                                            read_ledger_rows(ledger)))
    out = pathlib.Path(out)
    if check:
        have = out.read_bytes().decode("utf-8").replace("\r\n", "\n") if out.exists() else ""  # autocrlf checkouts
        print(f"VERDICT: {'PASS' if have == text else 'FAIL'} ({rel(out)} {'is' if have == text else 'is NOT'} the resolution of its sources)")
        return 0 if have == text else 1
    write_atomic(out, text)
    print(f"[pins] wrote {rel(out)}; the coordinator appends a brokerPins.lock.json entry with the bump")
    return 0


# ─── the CLI ─────────────────────────────────────────────────────────────────
def print_counts(q: dict) -> None:
    c = q["counts"]
    print(f"[queue] {c['targets']} capture targets · {json.dumps(c['byStatus'])}")
    print(f"[queue] by plan wave: {json.dumps(c['byPlanWave'])}")
    print(f"[queue] by priority band: {json.dumps(c['byPriorityBand'])}")
    print(f"[queue] rows needing a probe file: {c['rowsNeedingProbe']} ({c['rowsNeedingProbeLive']} of them live) · "
          f"licence-held census scripts: {c['licenceHeldCensus']}")
    print(f"[queue] rows their doc says are not capture questions: {c.get('rowsNotCaptureQuestions', 0)} "
          f"{json.dumps(c.get('rowsNotCaptureByDisposition', {}))}")
    top = [t for t in q["targets"] if t["status"] == "QUEUED"][:10]
    for t in top:
        print(f"[queue]   p={t['priority']:>3} up={t['unblocks']['upper']:>3} {t['planWave']:>3} {t['id']}")


def queue_text(q: dict) -> str:
    return dump(q)


def heavy_lock_tool():
    """The machine-wide heavy-job lock tool, or None: `$HEAVY_LOCK` (the laptop's env sets it), else the
    desktop's path. Read at call time, never at import. ⛔ None means REFUSE: a heavy job never runs unlocked
    (⚰️ it did: a missing desktop path made `grade` run the corpus harness with no lock at all)."""
    p = pathlib.Path(os.environ.get("HEAVY_LOCK") or DESKTOP_HEAVY_LOCK)
    return p if p.is_file() else None


def heavy(label: str, cmd: list):
    """`cmd` wrapped in the heavy lock, or None when no lock tool is found (the caller refuses)."""
    lock = heavy_lock_tool()
    if lock is None:
        return None
    return [sys.executable, str(lock), "run", "--label", label, "--timeout", "14400", "--", *cmd]


def no_lock_reason() -> str:
    return (f"no heavy-lock tool (HEAVY_LOCK={os.environ.get('HEAVY_LOCK') or 'unset'}; desktop default "
            f"{DESKTOP_HEAVY_LOCK} absent). Set HEAVY_LOCK to the lock tool's path")


def cmd_grade(run_dir) -> int:
    cmd = [sys.executable, str(HERE / "batch_capture.py"), "grade", "--run-dir", str(run_dir)]
    wrapped = heavy("evidence-grade", cmd)
    if wrapped is None:
        print(f"[grade] REFUSED: {no_lock_reason()}. Grading runs the corpus harness, a heavy job: never unlocked.")
        return 2
    print(f"[grade] {' '.join(wrapped)}")
    return subprocess.call(wrapped, cwd=str(REPO))


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
    pn = sub.add_parser("pins", help="resolve brokerPins.json against the committed verdicts (W9-T2)")
    pn.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)

    if args.cmd == "pins":
        return cmd_pins(check=args.check)

    if args.cmd == "queue":
        qd = build_queue(World())
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
        if args.cmd == "batch":
            # ⛔ BEFORE ANYTHING IS READ OR LAUNCHED: the owner's pacing, then the lock the grade step needs
            # (a batch that could not grade would spend the owner's session for nothing).
            from batch_capture import throttle_refusal  # noqa: E402 — the one pacing authority
            why = throttle_refusal(args.throttle_s)
            if why:
                print(f"[batch] REFUSED: {why}")
                return 2
            if heavy_lock_tool() is None:
                print(f"[batch] REFUSED before any browser: {no_lock_reason()}; the grade step would refuse.")
                return 2
        statuses = ("QUEUED",)
        world = World()
        qd = build_queue(world)
        man = build_manifest(qd, top=args.top, wave=args.wave, plan=args.plan_wave, statuses=statuses,
                             include_stale=args.include_stale, only=args.only, world=world)
        if args.cmd == "manifest":
            out = pathlib.Path(args.out) if args.out else None
            if out:
                write_atomic(out, dump(man))
                print(f"[manifest] {len(man['scripts'])} targets -> {out}")
            else:
                print(dump(man))
            return 0
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
