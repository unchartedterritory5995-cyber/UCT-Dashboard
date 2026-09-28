"""TERM-022 (FB-D1-01) -- the retirement queue, DERIVED, with a ratchet that only shrinks.

WHAT THIS IS. Every place under `api/` that reaches a market-data vendor WITHOUT
going through that vendor's adapter, counted per provider and per file. The
spec's words: *"an adapter that retires nothing is a second authority -- the
retirement queue empties behind it is the ticket, not a nicety"* (DOC-2). This
file is how "empties" is measured rather than asserted.

WHY A NEW CENSUS BESIDE `massive_guard_census.py`. That census reads one kind of
evidence -- a vendor hostname in a string -- and exempts whole files. Measured on
2026-09-28 it is BLIND to every module that builds its URL from
`massive._REST_BASE` + `client._api_key` (no hostname literal anywhere):
`bars_fetch.py`, `reference_corp_actions.py`, `scan_ipo.py`, `scan_volume.py`,
`entity_master_d5_renames.py` all read CLEAN to it. And a file-level exemption
lets a quarantined file grow new reaches silently. This census counts per file,
so a count can only go down.

A "REACH" (the `kind` of a hit) is one of:
  url               a string literal (plain or f-string) containing a vendor host.
  credential        a string literal EXACTLY equal to a vendor credential env name.
  sdk               `import <vendor sdk>` / `from <vendor sdk> import ...`.
  helper_def        a def with an ad-hoc vendor-helper name (`_fmp_get*`, TERM-072's shape).
  private           (Massive) a reach into the adapter's private transport from a module
                    that imports `api.services.massive`: `_REST_BASE`, `_api_key`,
                    `_http`, `_typed_get`, `_MassiveRestClient`.
  legacy_transport  (Massive) an untyped, never-raise `._get(url)` call INSIDE
                    `massive.py` -- a read the adapter file owns but does not stamp.
                    Counted so "retired" can never mean "moved into the adapter file".

Prose never counts: comments are not in the AST, and a bare string statement
(a docstring, anywhere) is skipped. Test files are excluded. Partner-owned files
(`PARTNER_OWNED`) are REPORTED but never ratcheted: the adapter must be adoptable
without editing them, and a partner's change must not turn this rail red.

THE RATCHET. `tools/vendor_callsite_baseline.json` holds the counts. The rail
(`tests/test_vendor_callsite_census.py`) requires the census to EQUAL it: growth
or a new file is red by name, and a shrink is red as "slack" until written down.
`--write-baseline` only ever lowers (it refuses to raise any count or add a
file); raising means hand-editing the JSON, which `--ratchet-against <git-ref>`
catches.

Scope: `api/` only (the served code), same as the per-vendor censuses.
"""
from __future__ import annotations

import ast
import fnmatch
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from typing import Iterable

DEFAULT_ROOTS = ("api",)
BASELINE_REL = "tools/vendor_callsite_baseline.json"
_SKIP_DIR_PARTS = frozenset({"__pycache__", "node_modules", ".git", "external"})

# Needles are built by concatenation so this file is not a vendor reach to a grep.
_MASSIVE = "massive" + ".com"


@dataclass(frozen=True)
class Provider:
    name: str
    domains: tuple[str, ...]
    credentials: tuple[str, ...] = ()
    sdk_modules: tuple[str, ...] = ()
    helper_def_patterns: tuple[str, ...] = ()
    adapter_files: tuple[str, ...] = ()


#: The retirement queue's providers: Massive (the adapter this ticket builds),
#: FMP (TERM-072's D1 adapter, `fmp_client.py`), and the named retirement
#: candidates -- "Bullflow #15, Polygon-direct #17, AlphaVantage #7, Finnhub #6,
#: yfinance #12, ForexFactory #39" (capability-infrastructure-matrix D1).
PROVIDERS: dict[str, Provider] = {p.name: p for p in (
    Provider("massive",
             domains=("api." + _MASSIVE, "files." + _MASSIVE, "socket." + _MASSIVE,
                      "delayed." + _MASSIVE),
             credentials=("MASSIVE" + "_API_KEY", "MASSIVE" + "_KEY",
                          "MASSIVE" + "_ACCESS_KEY", "MASSIVE" + "_SECRET_KEY"),
             adapter_files=("api/services/massive.py", "api/services/massive_adapter.py")),
    Provider("polygon_direct",
             domains=("polygon" + ".io",),
             credentials=("POLYGON" + "_API_KEY",),
             sdk_modules=("polygon",)),
    Provider("fmp",
             domains=("financialmodeling" + "prep.com",),
             credentials=("FMP" + "_API_KEY",),
             helper_def_patterns=("_fmp_get", "_fmp_get_*"),
             adapter_files=("api/services/fmp_client.py",)),
    Provider("finnhub",
             domains=("finnhub" + ".io",),
             credentials=("FINNHUB" + "_API_KEY", "FINNHUB" + "_KEY"),
             adapter_files=("api/services/finnhub_client.py",)),
    Provider("alphavantage",
             domains=("alphavantage" + ".co",),
             credentials=("ALPHAVANTAGE" + "_API_KEY",),
             adapter_files=("api/services/alphavantage_client.py",)),
    Provider("bullflow",
             domains=("bullflow" + ".io",),
             credentials=("BULLFLOW" + "_API_KEY",)),
    Provider("yfinance",
             domains=("query1.finance." + "yahoo.com", "query2.finance." + "yahoo.com",
                      "fc." + "yahoo.com"),
             sdk_modules=("yfinance",),
             adapter_files=("api/services/yf_util.py",)),
    Provider("forexfactory",
             domains=("faireconomy" + ".media", "forexfactory" + ".com")),
)}

#: Massive's adapter module and the private names a bypass reaches for.
MASSIVE_MODULE = "api.services.massive"
MASSIVE_TRANSPORT_FILE = "api/services/massive.py"
MASSIVE_PRIVATE_NAMES = frozenset({"_REST_BASE", "_api_key", "_http", "_typed_get", "_MassiveRestClient"})

#: Partner-owned (GOVERNING_PRINCIPLES.md §5; `project_partner_collab_branch`).
#: Reported, never ratcheted, never edited by this programme without an ack.
PARTNER_OWNED: dict[str, str] = {
    "api/massive_ws_worker.py": "partner-owned (Ravi)",
    "api/massive_processor.py": "partner-owned (Ravi)",
    "api/live_massive_router.py": "partner-owned (Ravi)",
    "api/schwab_router.py": "partner-owned (Ravi)",
}


@dataclass(frozen=True)
class Hit:
    provider: str
    path: str
    line: int
    kind: str
    detail: str

    def __str__(self) -> str:  # pragma: no cover - formatting only
        return f"{self.path}:{self.line} [{self.provider}/{self.kind}] {self.detail}"


# ── the walk ──────────────────────────────────────────────────────────────

def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _is_test_file(path: str) -> bool:
    base = os.path.basename(path)
    return base.startswith("test_") or base.endswith("_test.py")


def _iter_py_files(root: str, base: str) -> Iterable[str]:
    for dirpath, dirnames, filenames in os.walk(os.path.join(base, root)):
        dirnames[:] = sorted(d for d in dirnames if d not in _SKIP_DIR_PARTS)
        for fn in sorted(filenames):
            if fn.endswith(".py"):
                yield os.path.join(dirpath, fn)


def _prose_nodes(tree: ast.AST) -> set[int]:
    """ids of every bare string statement (docstrings anywhere) and its parts."""
    out: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, (ast.Constant, ast.JoinedStr)):
            for sub in ast.walk(node.value):
                out.add(id(sub))
    return out


def _string_literals(tree: ast.AST):
    """(node, text) for every code string -- an f-string once, as the join of its
    literal parts; never its child Constants again; never prose."""
    prose = _prose_nodes(tree)
    fstring_parts: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            fstring_parts.update(id(v) for v in node.values)
    for node in ast.walk(tree):
        if id(node) in prose:
            continue
        if isinstance(node, ast.JoinedStr):
            yield node, "".join(v.value for v in node.values
                                if isinstance(v, ast.Constant) and isinstance(v.value, str))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            if id(node) not in fstring_parts:
                yield node, node.value


def _imports_massive(tree: ast.AST, rel: str) -> set[str]:
    """Local names bound to the `api.services.massive` module, plus the marker
    "*" when the file imports ANY name from it (so `_api_key` attributes count)."""
    bound: set[str] = set()
    in_services = rel.startswith("api/services/") and rel.count("/") == 2
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name == MASSIVE_MODULE:
                    bound.add(a.asname or "api")
                    bound.add("*")
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if node.level == 0 and mod == MASSIVE_MODULE:
                bound.add("*")
            elif (node.level == 0 and mod == "api.services") or (node.level == 1 and not mod and in_services):
                for a in node.names:
                    if a.name == "massive":
                        bound.add(a.asname or "massive")
                        bound.add("*")
            elif node.level == 1 and mod == "massive" and in_services:
                bound.add("*")
    return bound


def _private_imported_names(tree: ast.AST, rel: str) -> set[str]:
    in_services = rel.startswith("api/services/") and rel.count("/") == 2
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if (node.level == 0 and mod == MASSIVE_MODULE) or (node.level == 1 and mod == "massive" and in_services):
                for a in node.names:
                    if a.name in MASSIVE_PRIVATE_NAMES:
                        out.add(a.asname or a.name)
    return out


def _file_hits(tree: ast.AST, rel: str) -> list[Hit]:
    hits: list[Hit] = []
    adapter_of = {name for name, p in PROVIDERS.items() if rel in p.adapter_files}

    for node, text in _string_literals(tree):
        for name, p in PROVIDERS.items():
            if name in adapter_of:
                continue
            dom = next((d for d in p.domains if d in text), None)
            if dom:
                hits.append(Hit(name, rel, node.lineno, "url", dom))
            elif text in p.credentials:
                hits.append(Hit(name, rel, node.lineno, "credential", text))

    for node in ast.walk(tree):
        mods: list[str] = []
        if isinstance(node, ast.Import):
            mods = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            mods = [node.module]
        for m in mods:
            top = m.split(".")[0]
            for name, p in PROVIDERS.items():
                if top in p.sdk_modules and name not in adapter_of:
                    hits.append(Hit(name, rel, node.lineno, "sdk", m))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for name, p in PROVIDERS.items():
                if name not in adapter_of and any(fnmatch.fnmatchcase(node.name, pat)
                                                  for pat in p.helper_def_patterns):
                    hits.append(Hit(name, rel, node.lineno, "helper_def", node.name))

    if "massive" not in adapter_of:
        bound = _imports_massive(tree, rel)
        if bound:
            # `x._api_key()` (a CALL) is some other vendor's key helper, not
            # Massive's client attribute -- e.g. the twitterapi.io module.
            called = {id(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
            for node in ast.walk(tree):
                if not (isinstance(node, ast.Attribute) and node.attr in MASSIVE_PRIVATE_NAMES):
                    continue
                if node.attr == "_api_key" and id(node) in called:
                    continue
                hits.append(Hit("massive", rel, node.lineno, "private", node.attr))
            names = _private_imported_names(tree, rel)
            for node in ast.walk(tree):
                if isinstance(node, ast.Name) and node.id in names and isinstance(node.ctx, ast.Load):
                    hits.append(Hit("massive", rel, node.lineno, "private", node.id))
    elif rel == MASSIVE_TRANSPORT_FILE:
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "_get"):
                hits.append(Hit("massive", rel, node.lineno, "legacy_transport", "_get"))
    return hits


def census(base: str, roots: Iterable[str] = DEFAULT_ROOTS) -> list[Hit]:
    """Every vendor reach outside its adapter under `roots`, sorted."""
    out: list[Hit] = []
    for root in roots:
        for path in _iter_py_files(root, base):
            if _is_test_file(path):
                continue
            rel = os.path.relpath(path, base).replace("\\", "/")
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    tree = ast.parse(fh.read(), filename=path)
            except (OSError, SyntaxError, ValueError):
                continue
            out.extend(_file_hits(tree, rel))
    out.sort(key=lambda h: (h.provider, h.path, h.line, h.kind, h.detail))
    return out


def _tally(hits: Iterable[Hit], *, partner: bool) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for h in hits:
        if (h.path in PARTNER_OWNED) != partner:
            continue
        files = out.setdefault(h.provider, {})
        files[h.path] = files.get(h.path, 0) + 1
    return {p: dict(sorted(f.items())) for p, f in sorted(out.items())}


def counts(hits: Iterable[Hit]) -> dict[str, dict[str, int]]:
    """{provider: {file: reaches}} -- the ratcheted counts (partner files excluded)."""
    return _tally(hits, partner=False)


def partner_counts(hits: Iterable[Hit]) -> dict[str, dict[str, int]]:
    return _tally(hits, partner=True)


# ── the ratchet ───────────────────────────────────────────────────────────

Delta = tuple[str, str, int, int]  # (provider, file, baseline, now)


def compare(now: dict, baseline: dict) -> tuple[list[Delta], list[Delta], list[Delta]]:
    """(grew, new, slack). `new` is a file absent from the baseline; `slack` is a
    count below its baseline (including a file that dropped to zero)."""
    grew: list[Delta] = []
    new: list[Delta] = []
    slack: list[Delta] = []
    for prov in sorted(set(now) | set(baseline)):
        n_files, b_files = now.get(prov, {}), baseline.get(prov, {})
        for path in sorted(set(n_files) | set(b_files)):
            n, b = n_files.get(path, 0), b_files.get(path, 0)
            if b == 0 and n > 0:
                new.append((prov, path, 0, n))
            elif n > b:
                grew.append((prov, path, b, n))
            elif n < b:
                slack.append((prov, path, b, n))
    return grew, new, slack


def ratchet_regressions(old: dict, new: dict) -> list[Delta]:
    """Every count in `new` that is ABOVE `old` (a hand-raised baseline)."""
    grew, added, _ = compare(new, old)
    return sorted(grew + added)


def load_baseline(base: str, path: str | None = None) -> dict:
    with open(path or os.path.join(base, BASELINE_REL), "r", encoding="utf-8") as fh:
        return json.load(fh)["counts"]


def _dump(counts_: dict) -> str:
    body = {"schema": 1,
            "about": "TERM-022 retirement-queue ratchet -- see tools/vendor_callsite_census.py. "
                     "Lower only: run `python tools/vendor_callsite_census.py --write-baseline`.",
            "counts": {p: dict(sorted(f.items())) for p, f in sorted(counts_.items()) if f}}
    return json.dumps(body, indent=2, sort_keys=False) + "\n"


def write_baseline(now: dict, path: str) -> tuple[bool, str]:
    """Write `now` as the baseline -- ONLY if nothing in it is above the current
    baseline. Returns (written, message). A first write (no file) is allowed."""
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            old = json.load(fh)["counts"]
        up = ratchet_regressions(old, now)
        if up:
            return False, ("refusing to RAISE the ratchet -- route these through the adapter "
                           f"instead (provider, file, baseline, now): {up}")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(_dump(now))
    os.replace(tmp, path)
    return True, f"wrote {path}"


def _git_baseline(base: str, ref: str) -> dict:
    blob = subprocess.run(["git", "show", f"{ref}:{BASELINE_REL}"], cwd=base,
                          capture_output=True, check=True).stdout
    return json.loads(blob.decode("utf-8"))["counts"]


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - operator entry
    import argparse

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--write-baseline", action="store_true", help="lower the ratchet to the census")
    ap.add_argument("--ratchet-against", metavar="REF",
                    help="fail if the checked-in baseline is above the one at git REF")
    args = ap.parse_args(argv)
    base = repo_root()
    hits = census(base)
    now = counts(hits)

    if args.ratchet_against:
        up = ratchet_regressions(_git_baseline(base, args.ratchet_against), load_baseline(base))
        print(f"baseline raised against {args.ratchet_against}: {up or 'none'}")
        return 1 if up else 0
    if args.write_baseline:
        ok, msg = write_baseline(now, os.path.join(base, BASELINE_REL))
        print(msg)
        return 0 if ok else 2

    print("RETIREMENT QUEUE -- vendor reaches outside their adapter, under api/ (partner files excluded)")
    for prov in PROVIDERS:
        files = now.get(prov, {})
        kinds: dict[str, int] = {}
        for h in hits:
            if h.provider == prov and h.path not in PARTNER_OWNED:
                kinds[h.kind] = kinds.get(h.kind, 0) + 1
        print(f"  {prov:<15} {sum(files.values()):>4} reaches in {len(files):>3} files  {kinds}")
    print()
    for prov, files in partner_counts(hits).items():
        print(f"  PARTNER-OWNED {prov}: {files}")
    grew, new, slack = compare(now, load_baseline(base))
    print(f"\nratchet: grew={grew} new={new} slack={slack}")
    return 1 if (grew or new or slack) else 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
