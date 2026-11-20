"""Which VITEST files read OTHER folders' sources, and does a pull-request job that triggers on what they read run them?

    python tools/ci_app_src_vitest_rails.py --census           # every cross-folder reader, what it reads, who runs it
    python tools/ci_app_src_vitest_rails.py --check            # exit 1 when one runs on no PR covering its reads
    python tools/ci_app_src_vitest_rails.py --print-list       # the readers the `app-src-vitest` job runs
    python tools/ci_app_src_vitest_rails.py --plan --changed changed.txt          # count=/n=/shards= for a PR
    python tools/ci_app_src_vitest_rails.py --write-files f.txt --shard 1/2 --changed changed.txt   # one shard

WHY (2026-11-19). The pytest half (tools/ci_app_src_rails.py, #2033) closed "a rail in tests/ that reads app/src runs on
no PR". The vitest half is the same hole: app/src/components/chart/pane/attachedPineDisclosures.noGuardIds.test.jsx is
a drift rail ("every guard namespace minted under app/src is known") that WALKS all of app/src. #2023 minted `data:*`
in engine/pineDataCatalog.js; that PR's vitest legs (pine heavy: engine/ and builder/) never ran the pane test, and
master went red. A vitest file that reads OTHER folders' sources (fs reads, `import.meta.glob`, `?raw` imports) must
run on the PR that changes what it reads.

WHAT A READ IS (static, over the source text; comments are stripped first, CODE, NEVER PROSE):
  * the path argument of a node fs read (readFileSync, readdirSync, existsSync, statSync, readFile, readdir,
    createReadStream, globSync, ...), evaluated where it can be: `__dirname`, `import.meta.url` /
    `fileURLToPath(...)` / `new URL(rel, import.meta.url)`, `process.cwd()` (vitest runs in app/), `path.resolve`,
    `path.join`, `path.dirname`, template literals and `+`, through `const` / `let` bindings. A part that cannot be
    evaluated keeps the known prefix: `path.join(SRC, rel)` reads under SRC. An argument that evaluates to nothing
    (`readFileSync(f)` in a walker) charges the file's walk roots (what it hands to readdirSync, or its directory
    constants);
  * `import.meta.glob(...)` patterns (vite reads them in the main process) and `?raw` / `?url` imports;
  * the reads of a test helper (a non-test module in app/ with fs reads) the test imports, transitively.
A read is CROSS-FOLDER when it is not under the test file's own directory. A CROSS-FOLDER READER is a vitest file with
at least one. Over-approximate on purpose: a charged read can only add a run, never hide one.
NOT seen (a static scan's limits): a path assembled from data read at run time, a path built through a function the
scan cannot follow, a dynamic `import()` of a computed path. The nightly full suite runs every vitest file.

WHAT "RUN BY A PR JOB" MEANS: a job of a `pull_request` workflow names the file (a path token under src/ in its steps,
matrix or env, a directory that holds it, or a list a known tool prints) AND that workflow's trigger covers every
cross-folder read of the file. ON A PR (select) the home job runs only the readers whose reads, own file, or direct
imports the PR changes; all of them when it changes something in RUN_ALL_ON or the diff is unknown.

Standard library + PyYAML. Reuses the trigger, plan and shard helpers of tools/ci_app_src_rails.py.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import posixpath
import re
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ci_app_src_rails as P  # noqa: E402  (the pytest half: triggers, workflows, shards)

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = "app"
HOME_WORKFLOW = P.HOME_WORKFLOW
HOME_JOB = "app-src-vitest"
HOME_STEP = "The cross-folder vitest rails, this shard (tools/ci_app_src_vitest_rails.py --write-files)"
TEST_RX = re.compile(r"\.(test|spec)\.(c|m)?[jt]sx?$")
SRC_EXT = (".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx")
SKIP_DIRS = {"node_modules", "dist", "dist-server", ".vite", "coverage"}

#: Readers DELIBERATELY not run on a pull request, whole file, each with a reason a reviewer can argue with.
EXEMPT: dict[str, str] = {}

#: Reader FILES red on a clean runner on master when this list was cut. The home job runs them in a step of their own
#: that must FAIL: the day one passes, the job goes red and says to delete its line (a strict xfail, by file).
#: Measured with `python tools/remote_tests.py --vitest <the list>` on master 4e148b30bc, 2026-11-19 (runs 44618883809,
#: 44618956890): drift and ratchet rails that other PRs broke while no PR job ran them, the class this file closes.
#: ⚰️ formulaReference.route and AdoptSheet left the same day: #2077's own run found them PASSING (the strict step).
KNOWN_RED: dict[str, str] = {
    "app/src/pages/command/keyListenerCensus.test.js":
        "TERM-063 ratchet: raw key listeners added outside the shortcut registry, and the baseline (164) is over CEILING 111",
    "app/src/lib/swallowedFetch.census.test.js":
        "TERM-033 shrink-only census: 3 new `.catch(() => null)` sites (use sectionFetcher, which throws)",
    "app/src/components/ui/formControls.census.test.js":
        "new hand-rolled role=switch files (NoteSharePanel.jsx, ...) and unnamed control sites grew 0 -> 12",
    "app/src/pages/terminal/a11y/terminalReachableContrast.test.js":
        "new inline --loss/--gain colours and new text under WCAG AA (NavBar.module.css .brandNameTop, ...)",
    "app/src/pages/terminal/themeColours.rail.test.js":
        "hardcoded colours in terminal-mounted code: NavBar.module.css has 4 literals where the ledger allows 1",
}

#: A PR that changes one of these runs every listed reader: each can change how all of them run.
RUN_ALL_ON = (
    "tools/ci_app_src_vitest_rails.py",
    "tools/ci_app_src_rails.py",
    "tests/test_ci_app_src_vitest_rails.py",
    ".github/workflows/whole-app-engine-rails.yml",
    ".github/actions/pine-heavy-setup/**",
    "tools/ci_offline.sh",
    "app/package.json",
    "app/package-lock.json",
    "app/vite.config.js",
    "app/src/test-setup.js",
)
MAX_SHARDS = 3
SHARD_TARGET_MS = 240_000
UNKNOWN_MS = 2000
#: per-file vitest seconds measured for this list (remote tests lane); a file it does not know costs UNKNOWN_MS
TIMINGS = pathlib.Path("tools") / "app_src_vitest_timings.json"

_READ_CALL = re.compile(r"\b(readFileSync|readdirSync|existsSync|statSync|lstatSync|opendirSync|readFile|readdir|"
                        r"createReadStream|globSync|readJSONSync|readJsonSync)\s*\(")
_GLOB_CALL = re.compile(r"import\.meta\.glob(?:Eager)?\s*\(")
_TEXT_IMPORT = re.compile(r"""(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"\n]+?)\?(?:raw|url)['"]""")
_REL_IMPORT = re.compile(r"""(?:from\s*|import\s*\(\s*|require\(\s*|import\s+)['"](\.{1,2}/[^'"\n?]+)['"]""")
_BIND = re.compile(r"(?:^|[\s;{(])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*")
#: a binding the scan cannot evaluate but whose name says what it is: a repo-root finder (an IIFE walking up to a
#: marker file, a helper's answer). Charged as the repo root, so its joins keep their literal tails.
_ROOTISH = re.compile(r"^_*(root|repo|repo_?root|repo_?dir|root_?dir|project_?root)$", re.I)
#: the shape of a path a read can name: anything else ('runtime:z', a sentence) is a mocked argument, not a read
_PATHISH = re.compile(r"^[\w@.\-/+\[\]]*$")
_FUNC = re.compile(r"(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(([^()]*)\)|([A-Za-z_$][\w$]*))"
                   r"\s*=>|function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^()]*)\))")
_FOR_OF_DESTRUCTURE = re.compile(r"for\s*\(\s*(?:const|let|var)\s*\{([^}]*)\}\s+of\s+(\[[^\]]*\]|[A-Za-z_$][\w$]*)")
_FOR_OF = re.compile(r"for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+(\[[^\]]*\]|[A-Za-z_$][\w$]*)")
_EACH = re.compile(r"\.each\(\s*(\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*\)\s*\(\s*(?:'[^']*'|\"[^\"]*\"|`[^`]*`)\s*,\s*"
                   r"(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)")
_LIT = re.compile(r"""'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`([^`$]*)`""")
_PROBES = {"existsSync", "statSync", "lstatSync"}
_FS_OWNERS = {"fs", "fsp", "promises", "nodeFs", "fse", "fsPromises", "fsSync", "nodefs"}
_FS_IMPORT = re.compile(r"""from\s+['"](?:node:)?fs(?:/promises)?['"]|require\(\s*['"](?:node:)?fs(?:/promises)?['"]""")


def _literals(text: str) -> list[str]:
    return [a or b or c for a, b, c in _LIT.findall(text)]


def _split_args(text: str) -> list[str]:
    out, depth, cur, quote = [], 0, [], None
    for ch in text:
        if quote:
            cur.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "'\"`":
            quote = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            out.append("".join(cur).strip())
            cur = []
            continue
        cur.append(ch)
    if "".join(cur).strip():
        out.append("".join(cur).strip())
    return out


def string_values(code: str) -> dict:
    """{name: [strings it can hold]}: the string literals a local function is called with (per parameter), a `for ...
    of` over a literal array, and an `it.each(array)(name, (x) => ...)`. Scope-blind, which can only add reads."""
    arrays, array_text = {}, {}
    for m in _BIND.finditer(code):
        if code[m.end():m.end() + 1] == "[":
            array_text[m.group(1)] = _bracket(code, m.end())
            arrays[m.group(1)] = _literals(array_text[m.group(1)])
    values: dict = {}

    def add(name, vals):
        if vals:
            values.setdefault(name, [])
            values[name] += [v for v in vals if v not in values[name]][:200]

    for m in _FOR_OF.finditer(code):
        src = m.group(2)
        add(m.group(1), _literals(src) if src.startswith("[") else arrays.get(src, []))
    # `for (const { file, version } of ROWS)` over an array of object literals: each key's string values
    for m in _FOR_OF_DESTRUCTURE.finditer(code):
        text = m.group(2) if m.group(2).startswith("[") else array_text.get(m.group(2), "")
        for key in [k.split(":")[0].strip() for k in m.group(1).split(",")]:
            if re.fullmatch(r"[A-Za-z_$][\w$]*", key):
                add(key, [a or b for a, b in re.findall(
                    r"\b" + re.escape(key) + r"""\s*:\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")""", text)])
    for m in _EACH.finditer(code):
        src = m.group(1)
        add(m.group(2), _literals(src) if src.startswith("[") else arrays.get(src, []))
    for m in _FUNC.finditer(code):
        name = m.group(1) or m.group(4)
        params = [p.split("=")[0].strip() for p in (m.group(2) if m.group(2) is not None else
                                                      (m.group(3) or m.group(5) or "")).split(",")]
        params = [p for p in params if re.fullmatch(r"[A-Za-z_$][\w$]*", p)]
        if not name or not params:
            continue
        for call in re.finditer(r"(?<![\w$.])" + re.escape(name) + r"\s*\(", code):
            if call.start() == m.start() or code[max(0, call.start() - 9):call.start()].rstrip().endswith("function"):
                continue
            args = _split_args(_call_body(code, call.end() - 1))
            for p, a in zip(params, args):
                lit = _literals(a)
                if lit and len(lit) == 1 and a.strip()[0] in "'\"`":
                    add(p, lit)
                elif re.fullmatch(r"[A-Za-z_$][\w$]*", a.strip()):
                    add(p, ["@" + a.strip()])                   # a name: resolved in the caller's bindings
    return values


# ── comments out, strings kept ──────────────────────────────────────────────────────────────────────────────────────

def strip_comments(text: str) -> str:
    """The source with // and /* */ comments blanked (string and template contents are kept; a regex literal that
    holds `//` is a rare false strip of one line's tail, which can only lose a read the walk-root fallback restores)."""
    out, i, n = [], 0, len(text)
    quote = None
    while i < n:
        c = text[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "'\"`":
            quote = c
            out.append(c)
            i += 1
            continue
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            seg = text[i:(n if j < 0 else j + 2)]
            out.append("\n" * seg.count("\n"))
            i = n if j < 0 else j + 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


# ── a tiny evaluator for the path expressions tests write ───────────────────────────────────────────────────────────

class Path_:
    """A repo-relative path value. `partial` = only this prefix is known (something under it is read)."""

    def __init__(self, path: str, partial: bool = False, url: bool = False):
        self.path, self.partial, self.url = path, partial, url


class Rel:
    """A relative string, not yet anchored (anchored to the cwd, app/, when read; joined when combined)."""

    def __init__(self, s: str, partial: bool = False):
        self.s, self.partial = s, partial


def _norm(p: str) -> str | None:
    p = posixpath.normpath(p.replace("\\", "/"))
    if p.startswith("..") or p.startswith("/"):
        return None
    return "" if p == "." else p


def _join(base, *parts):
    """base (Path_ / Rel / None) joined with parts; an unknown part leaves the known prefix, partial."""
    if base is None:
        return None
    cur = base
    for part in parts:
        if part is None:
            return _partial(cur)
        if isinstance(part, Path_):
            return part if not part.url else Path_(part.path, part.partial)
        s = part.s if isinstance(part, Rel) else str(part)
        if s.startswith("/"):
            return None                                             # an absolute path: outside what we can place
        if isinstance(cur, Path_):
            p = _norm(posixpath.join(cur.path, s)) if s else cur.path
            cur = None if p is None else Path_(p, cur.partial or getattr(part, "partial", False))
        else:
            cur = Rel(posixpath.join(cur.s, s) if cur.s else s, cur.partial or getattr(part, "partial", False))
        if cur is None or cur.partial:
            return cur
    return cur


def _partial(v):
    if isinstance(v, Path_):
        return Path_(v.path, True)
    if isinstance(v, Rel):
        return Rel(v.s, True)
    return None


def _anchor(v, cwd: str = APP):
    """A value as a repo-relative Path_ (a Rel anchors at the cwd)."""
    if isinstance(v, Path_):
        return Path_(v.path, v.partial)
    if isinstance(v, Rel):
        p = _norm(posixpath.join(cwd, v.s))
        return None if p is None else Path_(p, v.partial)
    return None


_TOKEN = re.compile(r"""\s*(?:
    (?P<str>'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")
  | (?P<tpl>`(?:\\.|\$\{(?:[^{}]|\{[^{}]*\})*\}|[^`\\])*`)
  | (?P<num>\d+(?:\.\d+)?)
  | (?P<name>[A-Za-z_$][\w$]*)
  | (?P<punct>\.\.\.|[().,\[\]+?:{}/*=!<>&|;-])
)""", re.X)


def tokenize(expr: str) -> list:
    out, i = [], 0
    while i < len(expr):
        m = _TOKEN.match(expr, i)
        if not m or m.end() == i:
            break
        i = m.end()
        kind = m.lastgroup
        out.append((kind, m.group(kind)))
    return out


def _unquote(s: str) -> str:
    body = s[1:-1]
    return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), body)


class Evaluator:
    """Evaluate one expression's tokens in a file's bindings."""

    def __init__(self, file_rel: str, env: dict):
        self.file = file_rel
        self.dir = posixpath.dirname(file_rel)
        self.env = env

    def eval(self, expr: str):
        self.toks, self.i = tokenize(expr), 0
        try:
            v = self._sum()
        except (IndexError, ValueError, RecursionError):
            return None
        return v

    # grammar: sum := postfix ('+' postfix)* ; postfix := primary ( '.' name | '(' args ')' | '[' ... ']' )*
    def _peek(self, k=0):
        j = self.i + k
        return self.toks[j] if j < len(self.toks) else (None, None)

    def _take(self):
        t = self.toks[self.i]
        self.i += 1
        return t

    def _sum(self):
        v = self._postfix()
        while self._peek() == ("punct", "+"):
            self._take()
            r = self._postfix()
            v = self._concat(v, r)
        return v

    def _concat(self, a, b):
        sa = a.path if isinstance(a, Path_) else (a.s if isinstance(a, Rel) else None)
        if sa is None:
            return None
        if b is None:
            return _partial(a)
        sb = b.s if isinstance(b, Rel) else None
        if sb is None:
            return _partial(a)
        if isinstance(a, Path_):
            p = _norm(a.path + sb) if not sb.startswith("/") else _norm(posixpath.join(a.path, sb[1:]))
            return None if p is None else Path_(p, a.partial or b.partial)
        return Rel(a.s + sb, a.partial or b.partial)

    def _args(self):
        args = []
        depth = 0
        start = self.i
        cur = []
        while True:
            kind, val = self._take()
            if kind == "punct" and val in "([{":
                depth += 1
            elif kind == "punct" and val in ")]}":
                if depth == 0:
                    if cur:
                        args.append(cur)
                    break
                depth -= 1
            if kind == "punct" and val == "," and depth == 0:
                args.append(cur)
                cur = []
                continue
            cur.append((kind, val))
        _ = start
        return [self._sub(a) for a in args]

    def _sub(self, toks):
        e = Evaluator(self.file, self.env)
        e.toks, e.i = toks, 0
        try:
            v = e._sum()
        except (IndexError, ValueError, RecursionError):
            return None
        return v if e.i == len(toks) else (_partial(v) if v is not None else None)

    def _primary(self):
        kind, val = self._take()
        if kind == "str":
            return Rel(_unquote(val))
        if kind == "tpl":
            return self._template(val[1:-1])
        if kind == "punct" and val == "(":
            v = self._sum()
            if self._peek() == ("punct", ")"):
                self._take()
            return v
        if kind == "name":
            if val == "new" and self._peek()[1] == "URL":
                self._take()
                args = self._args() if self._peek() == ("punct", "(") and self._take() else []
                return self._url(args)
            if val == "import" and self._peek() == ("punct", "."):
                self._take()
                _, attr = self._take()
                if attr == "meta" and self._peek() == ("punct", "."):
                    self._take()
                    _, what = self._take()
                    if what == "url":
                        return Path_(self.file, url=True)
                    if what in ("dirname",):
                        return Path_(self.dir)
                    if what == "filename":
                        return Path_(self.file)
                return None
            if val == "__dirname":
                return Path_(self.dir)
            if val == "__filename":
                return Path_(self.file)
            if val == "globalThis" and self._peek() == ("punct", ".") and self._peek(1)[1] == "process":
                self._take()
                _, val = self._take()
            if val == "process" and self._peek() == ("punct", ".") and self._peek(1)[1] == "cwd":
                self._take()
                self._take()
                if self._peek() == ("punct", "("):
                    self._take()
                    self._args()
                return Path_(APP)
            if val in self.env:
                return ("name", val)
            if _ROOTISH.match(val):
                return Path_("")                                    # a repo-root finder the scan cannot run
            return ("name", val)
        return None

    def _template(self, body: str):
        parts, i = [], 0
        for m in re.finditer(r"\$\{((?:[^{}]|\{[^{}]*\})*)\}", body):
            parts.append(Rel(body[i:m.start()]))
            parts.append(self._sub(tokenize(m.group(1))))
            i = m.end()
        parts.append(Rel(body[i:]))
        acc = None
        for p in parts:
            if acc is None:
                acc = p if p is not None and not isinstance(p, tuple) else None
                if acc is None:
                    return None
                continue
            acc = self._concat(acc, p if not isinstance(p, tuple) else None)
            if acc is None or acc.partial:
                return acc
        return acc

    def _url(self, args):
        if not args:
            return None
        rel = args[0]
        base = args[1] if len(args) > 1 else None
        if isinstance(rel, Path_) and rel.url:
            return rel
        if isinstance(base, Path_) and base.url and isinstance(rel, Rel):
            p = _norm(posixpath.join(posixpath.dirname(base.path), rel.s))
            return None if p is None else Path_(p, rel.partial, url=True)
        return None

    def _postfix(self):
        v = self._primary()
        while True:
            t = self._peek()
            if t == ("punct", "."):
                self._take()
                _, attr = self._take()
                if self._peek() == ("punct", "("):
                    self._take()
                    args = self._args()
                    v = self._call(v, attr, args)
                else:
                    v = self._attr(v, attr)
            elif t == ("punct", "("):
                self._take()
                args = self._args()
                v = self._call(None, v, args)
            elif t == ("punct", "["):
                self._take()
                depth = 1
                while depth:
                    _, val = self._take()
                    depth += {"[": 1, "]": -1}.get(val, 0)
                v = None
            else:
                break
        if isinstance(v, tuple):
            v = self.env.get(v[1])
        return v

    def _attr(self, v, attr):
        if isinstance(v, tuple):
            if v[1] in ("path", "fs", "fsp", "url", "nodePath", "posix"):
                return ("ns", attr)
            if f"{v[1]}.{attr}" in self.env:                         # `import * as hp` then `hp.EXPECTED_FILE`
                return self.env[f"{v[1]}.{attr}"]
            v = self.env.get(v[1])
        if isinstance(v, Path_) and attr in ("pathname", "href"):
            return Path_(v.path, v.partial)
        return None

    def _call(self, obj, fn, args):
        name = fn[1] if isinstance(fn, tuple) else fn
        if isinstance(obj, tuple) and obj[0] == "ns":
            name = obj[1]
        target = obj if not isinstance(obj, tuple) else self.env.get(obj[1]) if obj[0] == "name" else None
        if name in ("resolve",):
            cur = None
            for a in args:
                a = a if not isinstance(a, tuple) else self.env.get(a[1])
                if isinstance(a, Path_):
                    cur = Path_(a.path, a.partial)
                elif isinstance(a, Rel):
                    cur = _join(cur if cur is not None else Path_(APP), a)
                else:
                    return _partial(cur) if cur is not None else None
                if cur is None or cur.partial:
                    return cur
            return cur
        if name in ("join", "normalize"):
            vals = [a if not isinstance(a, tuple) else self.env.get(a[1]) for a in args]
            if not vals or vals[0] is None:
                return None
            return _join(vals[0], *vals[1:])
        if name == "dirname" and args:
            a = args[0] if not isinstance(args[0], tuple) else self.env.get(args[0][1])
            if isinstance(a, Path_):
                return Path_(posixpath.dirname(a.path), a.partial)
            if isinstance(a, Rel):
                return Rel(posixpath.dirname(a.s), a.partial)
            return None
        if name in ("fileURLToPath", "decodeURIComponent", "String", "toString") and args:
            a = args[0] if not isinstance(args[0], tuple) else self.env.get(args[0][1])
            return Path_(a.path, a.partial) if isinstance(a, Path_) else a
        if name == "replace" and isinstance(target, (Path_, Rel)):
            return target                                           # a drive-letter or separator fix-up
        return None


# ── one file: bindings, reads, imports ──────────────────────────────────────────────────────────────────────────────

def _expr_text(code: str, start: int) -> str:
    """The expression that starts at `start`: to the `;` or the line end at bracket depth 0 (a continued line, one
    that ends on an operator or opens a bracket, keeps going)."""
    depth, i, n = 0, start, len(code)
    quote = None
    while i < n:
        c = code[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "'\"`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif depth == 0 and c in ";,":
            break
        elif depth == 0 and c == "\n":
            rest = code[i + 1:].lstrip()
            prev = code[start:i].rstrip()
            if not (rest.startswith((".", "+", "?", ":")) or prev.endswith(("+", "(", ",", "=", "?", ":"))):
                break
        i += 1
    return code[start:i]


def _call_arg(code: str, open_paren: int) -> str:
    """The first argument text of a call whose `(` is at open_paren."""
    depth, i, n = 0, open_paren + 1, len(code)
    quote = None
    start = i
    while i < n:
        c = code[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "'\"`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif c == "," and depth == 0:
            break
        i += 1
    return code[start:i]


def _bracket(code: str, i: int) -> str:
    """The text from the opening bracket at i to its matching close, inclusive (strings respected)."""
    pairs = {"(": ")", "[": "]", "{": "}"}
    depth, j, quote = 0, i, None
    while j < len(code):
        c = code[j]
        if quote:
            if c == "\\":
                j += 2
                continue
            if c == quote:
                quote = None
        elif c in "'\"`":
            quote = c
        elif c in pairs:
            depth += 1
        elif c in pairs.values():
            depth -= 1
            if depth == 0:
                return code[i:j + 1]
        j += 1
    return code[i:]


def _call_body(code: str, open_paren: int) -> str:
    return _bracket(code, open_paren)[1:-1]


def _glob_prefix(pattern: str) -> str:
    segs = []
    for s in pattern.split("/"):
        if any(c in s for c in "*?[{!"):
            break
        segs.append(s)
    return "/".join(segs)


def bindings(code: str, file_rel: str, imported: dict | None = None) -> dict:
    """name -> path value for every `const/let/var` the evaluator can place (two passes: a later binding can feed an
    earlier one), seeded with the constants this module imports from its relative imports (`imported`)."""
    env: dict = dict(imported or {})
    for _ in range(2):
        for m in _BIND.finditer(code):
            name = m.group(1)
            if name in env:
                continue
            v = Evaluator(file_rel, env).eval(_expr_text(code, m.end()))
            if isinstance(v, tuple):
                v = env.get(v[1])
            if isinstance(v, (Path_, Rel)):
                env[name] = v
    return env


_NAMED_IMPORT = re.compile(r"import\s*\{([^}]*)\}\s*from\s*['\"](\.{1,2}/[^'\"]+)['\"]")
_NS_IMPORT = re.compile(r"import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['\"](\.{1,2}/[^'\"]+)['\"]")


def analyse(code: str, file_rel: str, imported: dict | None = None, helper: bool = False) -> tuple[set, set, list]:
    """(read scopes: repo-relative paths, relative import specs, unresolved read texts) of one module's code."""
    env: dict = dict(imported or {})
    for _ in range(2):                                              # a later binding can feed an earlier one
        for m in _BIND.finditer(code):
            name = m.group(1)
            if name in env:
                continue
            v = Evaluator(file_rel, env).eval(_expr_text(code, m.end()))
            if isinstance(v, tuple):
                v = env.get(v[1])
            if isinstance(v, (Path_, Rel)):
                env[name] = v
    reads, unresolved, walk_roots = set(), [], set()
    values = string_values(code)
    ev = Evaluator(file_rel, env)
    unresolved_reads = False
    imports_fs = bool(_FS_IMPORT.search(code))
    for m in _READ_CALL.finditer(code):
        # node's fs, never a mock's method of the same name (`store.readFile(id)`): `fs.` / `fsp.` / `promises.`
        # before it, or a bare call in a file that imports from fs
        before = code[max(0, m.start() - 24):m.start()]
        owner = re.search(r"([A-Za-z_$][\w$]*)\s*\.\s*$", before)
        if owner and owner.group(1) not in _FS_OWNERS:
            continue
        if not owner and (before.rstrip().endswith(".") or not imports_fs):
            continue
        arg = _call_arg(code, m.end() - 1)
        got = []
        v = _anchor(ev.eval(arg))
        names = [n for n in re.findall(r"[A-Za-z_$][\w$]*", arg) if n in values]
        if names and (v is None or v.partial):
            for val in values[names[0]][:60]:                       # a helper's parameter, a loop variable
                bound = env.get(val[1:]) if val.startswith("@") else Rel(val)
                if bound is None:
                    continue
                w = _anchor(Evaluator(file_rel, {**env, names[0]: bound}).eval(arg))
                if w is not None and not w.partial:
                    got.append(w.path)
        if not got and v is not None and not (v.partial and m.group(1) in _PROBES):
            got = [v.path]                                          # (a probe of an unknown name under a dir: no walk)
        if not got and v is not None and v.partial:
            continue
        if not got:
            unresolved.append(arg.strip()[:80])
            unresolved_reads = unresolved_reads or m.group(1) not in _PROBES
            continue
        reads |= set(got)
        if m.group(1) in ("readdirSync", "readdir", "opendirSync", "globSync"):
            walk_roots |= set(got)
    if unresolved_reads:
        # a read of something the scan cannot name (`readFileSync(f)` in a walker): what the file walks, else the
        # directories it names, else app/src (never the repo root or all of app/: a name is not a walk)
        dirs = {p.path for p in (_anchor(v) for v in env.values() if isinstance(v, Path_) and not v.partial)
                if p is not None
                and not posixpath.splitext(p.path)[1] and p.path not in ("", APP)}
        # (a HELPER's unnamed read is usually its caller's argument: it charges only what it names itself)
        reads |= walk_roots or dirs or (set() if helper else {f"{APP}/src"})
    for m in _GLOB_CALL.finditer(code):
        arg = _call_arg(code, m.end() - 1)
        pats = re.findall(r"""['"`]!?([^'"`]+)['"`]""", arg)
        for p in pats:
            if p.startswith("!"):
                continue
            base = APP if p.startswith("/") else posixpath.dirname(file_rel)
            q = _norm(posixpath.join(base, _glob_prefix(p.lstrip("/"))))
            if q is not None:
                reads.add(q)
    for spec in _TEXT_IMPORT.findall(code):
        if spec.startswith("."):
            q = _norm(posixpath.join(posixpath.dirname(file_rel), spec))
        elif spec.startswith("/"):
            q = _norm(posixpath.join(APP, spec.lstrip("/")))
        else:
            q = None
        if q is not None:
            reads.add(q)
    imports = set(_REL_IMPORT.findall(code))
    return reads, imports, unresolved


def _resolve_import(repo: pathlib.Path, importer_rel: str, spec: str) -> str | None:
    base = _norm(posixpath.join(posixpath.dirname(importer_rel), spec))
    if base is None:
        return None
    for cand in [base] + [base + e for e in SRC_EXT] + [f"{base}/index{e}" for e in SRC_EXT]:
        if (repo / cand).is_file():
            return cand
    return None


class Census:
    """The static read model of the vitest files under app/."""

    def __init__(self, repo: pathlib.Path = ROOT):
        self.repo = repo.resolve()
        self._mod: dict = {}
        self._env: dict = {}

    def _module(self, rel: str):
        if rel not in self._mod:
            try:
                raw = (self.repo / rel).read_text(encoding="utf-8", errors="replace")
            except OSError:
                raw = ""
            # the cheap gate first: a module that names no read door reads nothing (its imports still count)
            has = bool(_READ_CALL.search(raw) or _GLOB_CALL.search(raw) or _TEXT_IMPORT.search(raw))
            code = strip_comments(raw) if has else raw
            if has:
                reads, specs, unresolved = analyse(code, rel, self._imported(rel, code),
                                                   helper=not TEST_RX.search(rel))
            else:
                reads, specs, unresolved = set(), set(_REL_IMPORT.findall(code)), []
            # a mocked argument is not a read ('runtime:z', a sentence), and neither is a path with no directory
            # in the repo: keep a read when it, or its parent, exists
            reads = {r for r in reads if _PATHISH.match(r) and r not in ("", APP)
                     and ((self.repo / r).exists() or (posixpath.dirname(r) not in ("", APP)
                                                       and (self.repo / posixpath.dirname(r)).is_dir()))}
            imports = {r for r in (_resolve_import(self.repo, rel, s) for s in specs) if r}
            self._mod[rel] = (reads, imports, unresolved, has and bool(reads))
        return self._mod[rel]

    def _imported(self, rel: str, code: str, depth: int = 0) -> dict:
        """The path constants this module imports by name from its relative imports (one module's `export const
        HARNESS_DIR = ...` is another's read root), `import * as ns` ones as `ns.NAME`. Two hops at most."""
        out: dict = {}
        if depth > 1:
            return out
        for m in _NAMED_IMPORT.finditer(code):
            target = _resolve_import(self.repo, rel, m.group(2))
            if not target:
                continue
            env = self._exports(target, depth + 1)
            for part in m.group(1).split(","):
                bits = part.strip().split(" as ")
                if bits[0].strip() in env:
                    out[bits[-1].strip()] = env[bits[0].strip()]
        for m in _NS_IMPORT.finditer(code):
            target = _resolve_import(self.repo, rel, m.group(2))
            if target:
                for k, v in self._exports(target, depth + 1).items():
                    out[f"{m.group(1)}.{k}"] = v
        return out

    def _exports(self, rel: str, depth: int) -> dict:
        key = (rel, depth)
        if key not in self._env:
            self._env[key] = {}                                     # a cycle reads as "nothing yet"
            try:
                code = strip_comments((self.repo / rel).read_text(encoding="utf-8", errors="replace"))
            except OSError:
                code = ""
            self._env[key] = bindings(code, rel, self._imported(rel, code, depth)) if code else {}
        return self._env[key]

    def test_files(self) -> list[str]:
        out = []
        base = self.repo / APP
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
            for f in filenames:
                if TEST_RX.search(f):
                    out.append(pathlib.Path(dirpath, f).relative_to(self.repo).as_posix())
        return sorted(out)

    def reads(self, rel: str) -> dict:
        """{read scope: how ("direct" or the helper chain)} for one test file, helpers followed transitively."""
        out: dict = {}
        seen, frontier = {rel}, [(rel, "")]
        while frontier:
            cur, chain = frontier.pop()
            reads, imports, _unres, _has = self._module(cur)
            for r in reads:
                out.setdefault(r, chain or "direct")
            for imp in sorted(imports):
                if imp in seen or TEST_RX.search(imp):
                    continue
                seen.add(imp)
                if self._module(imp)[3]:                            # a helper that reads files itself
                    frontier.append((imp, f"{chain} -> {imp}" if chain else imp))
        return out

    def imports(self, rel: str) -> set:
        return self._module(rel)[1]

    def unresolved(self, rel: str) -> list:
        return self._module(rel)[2]

    def census(self) -> dict:
        """{test file: {cross-folder read: how}} for every vitest file that reads outside its own directory."""
        out = {}
        for t in self.test_files():
            own = posixpath.dirname(t)
            if not self._module(t)[3] and not self._module(t)[1]:
                continue
            cross = {r: h for r, h in self.reads(t).items()
                     if not (r == own or r.startswith(own + "/")) and "node_modules" not in r.split("/")}
            if cross:
                out[t] = cross
        return out


# ── which PR jobs run which vitest files ────────────────────────────────────────────────────────────────────────────

_SRC_TOKEN = re.compile(r"(?<![\w./-])((?:app/)?src/[\w./@\-\[\]]*)")


def _vitest_job_files(job: dict, wf_env: dict, repo: pathlib.Path, all_tests: list[str]) -> set:
    """The vitest files a job runs: every src/ path token in its steps, matrix and env (the workflow's env too, for
    `$VITEST_ROOTS` / `$AGENT_VITEST_PATHS`), a directory token standing for every test file under it, and the list
    tools/ci_whole_app_rails.py prints when a step runs it. Only jobs that run vitest at all are read."""
    text = P._code_lines(P._job_text(job))
    if "vitest run" not in text:
        return set()
    text += "\n" + json.dumps(wf_env)
    if "tools/ci_whole_app_rails.py" in text:
        lst = repo / "tools" / "whole_app_engine_rails.txt"
        if lst.is_file():
            text += "\n" + " ".join(f"src/{l.split('#', 1)[0].strip()[4:]}" if l.strip().startswith("src/") else
                                    l.split("#", 1)[0].strip() for l in lst.read_text(encoding="utf-8").splitlines())
    out = set()
    for tok in _SRC_TOKEN.findall(text):
        tok = tok.rstrip("/.")
        rel = tok if tok.startswith("app/") else f"app/{tok}"
        out |= {t for t in all_tests if t == rel or t.startswith(rel + "/")}
    return out


def pr_jobs(repo: pathlib.Path, all_tests: list[str], home: list | None = None) -> list[dict]:
    out = []
    for wf in sorted((repo / P.WORKFLOWS).glob("*.y*ml")):
        doc = yaml.safe_load(wf.read_text(encoding="utf-8")) or {}
        on = P._on(doc)
        if "pull_request" not in on:
            continue
        pr = on["pull_request"]
        paths = pr.get("paths")
        globs = None if not (paths or pr.get("paths-ignore")) else [str(p) for p in (paths or ["**"])]
        for name, job in (doc.get("jobs") or {}).items():
            files = _vitest_job_files(job, doc.get("env") or {}, repo, all_tests)
            if wf.name == HOME_WORKFLOW and name == HOME_JOB:
                files = set(home or [])
            out.append({"workflow": wf.name, "job": name, "paths": globs, "files": sorted(files)})
    return out


def coverage(census: dict, jobs: list[dict]) -> dict:
    out = {}
    for t, reads in census.items():
        runs = [f"{j['workflow']}/{j['job']}" for j in jobs
                if t in j["files"] and all(P.triggers(j["paths"], r) for r in reads)]
        named = [f"{j['workflow']}/{j['job']}" for j in jobs if t in j["files"]]
        out[t] = {"runs": sorted(runs), "named": sorted(set(named) - set(runs))}
    return out


def print_list(repo: pathlib.Path, census: dict, all_tests: list[str], exempt: dict | None = None,
               known_red: dict | None = None) -> list[str]:
    """The readers no OTHER PR job runs under a trigger covering their reads, minus EXEMPT and KNOWN_RED (which run in
    the known-red step instead)."""
    exempt = EXEMPT if exempt is None else exempt
    known_red = KNOWN_RED if known_red is None else known_red
    cov = coverage(census, [j for j in pr_jobs(repo, all_tests) if not (j["workflow"] == HOME_WORKFLOW
                                                                         and j["job"] == HOME_JOB)])
    return sorted(t for t in census if t not in exempt and t not in known_red and not cov[t]["runs"])


def select(files: list[str], census: dict, changed: list[str], model: Census) -> tuple[list[str], str]:
    """The readers of `files` a PR changing `changed` must run: a changed path under one of its reads, the file itself,
    or a module it imports directly. All when the PR changes something in RUN_ALL_ON, or the diff is unknown."""
    changed = sorted({c.strip().replace("\\", "/") for c in changed if c.strip()})
    if not changed:
        return list(files), f"ALL {len(files)}: the changed files are unknown"
    rxs = [P.glob_rx(g) for g in RUN_ALL_ON]
    hit = next((c for c in changed if any(rx.match(c) for rx in rxs)), None)
    if hit:
        return list(files), f"ALL {len(files)}: the PR changes {hit}"
    cset = set(changed)
    chosen = [t for t in files
              if any(c == r or c.startswith(r + "/") for r in census.get(t, {}) for c in changed)
              or t in cset or cset & model.imports(t)]
    return chosen, f"{len(chosen)} of {len(files)}: the readers whose reads or code the PR changes"


def load_timings(repo: pathlib.Path) -> dict:
    try:
        return {k: int(v) for k, v in json.loads((repo / TIMINGS).read_text(encoding="utf-8"))["files_ms"].items()}
    except (OSError, ValueError, KeyError, AttributeError):
        return {}


def shard_count(files: list[str], timings: dict) -> int:
    if not files:
        return 0
    total = sum(timings.get(f, UNKNOWN_MS) for f in files)
    return max(1, min(MAX_SHARDS, len(files), -(-total // SHARD_TARGET_MS)))


def home_paths(repo: pathlib.Path) -> list[str] | None:
    doc = yaml.safe_load((repo / P.WORKFLOWS / HOME_WORKFLOW).read_text(encoding="utf-8")) or {}
    pr = P._on(doc).get("pull_request") or {}
    return None if not (pr.get("paths") or pr.get("paths-ignore")) else [str(x) for x in (pr.get("paths") or ["**"])]


def missing_paths(repo: pathlib.Path, census: dict, home: list[str]) -> list[str]:
    """The reads of the home list that the home workflow's `paths:` does not trigger on, as the globs to add (a
    directory a rail walks as `dir/**`). Empty = every read of every listed rail triggers the job."""
    globs = home_paths(repo)
    need = set()
    for t in home:
        for r in census[t]:
            if not P.triggers(globs, r):
                need.add(r + "/**" if (repo / r).is_dir() else r)
    out = sorted(need)
    return [x for x in out if not any(q != x and q.endswith("/**") and x.startswith(q[:-2]) for q in out)]


def home_step(repo: pathlib.Path) -> dict | None:
    path = repo / P.WORKFLOWS / HOME_WORKFLOW
    if not path.is_file():
        return None
    doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    for s in ((doc.get("jobs") or {}).get(HOME_JOB) or {}).get("steps") or []:
        if s.get("name") == HOME_STEP:
            return s
    return None


def judge(repo: pathlib.Path, census: dict, all_tests: list[str], exempt: dict | None = None,
          known_red: dict | None = None) -> list[str]:
    exempt = EXEMPT if exempt is None else exempt
    known_red = KNOWN_RED if known_red is None else known_red
    bad = []
    step = home_step(repo)
    home = print_list(repo, census, all_tests, exempt, known_red)
    if step is None:
        bad.append(f"{HOME_WORKFLOW} job `{HOME_JOB}` has no step named {HOME_STEP!r}: nothing runs the list")
    elif "tools/ci_app_src_vitest_rails.py --write-files" not in str(step.get("run") or ""):
        bad.append(f"the step {HOME_STEP!r} does not run tools/ci_app_src_vitest_rails.py's list (--write-files)")
    cov = coverage(census, pr_jobs(repo, all_tests, home=home if step is not None else None))
    for t in sorted(census):
        if t in exempt or t in known_red:
            if cov[t]["runs"] and t in exempt:
                bad.append(f"EXEMPT but run: {t} is exempt and {cov[t]['runs'][0]} runs it: drop the exemption")
            continue
        if not cov[t]["runs"]:
            how = ", ".join(sorted(census[t])[:3])
            extra = f"; named only by {', '.join(cov[t]['named'])}" if cov[t]["named"] else ""
            bad.append(f"NOT RUN ON THE PR: {t} reads {how}{extra}. Run it in a PR job that triggers on what it reads, "
                       "or exempt it in tools/ci_app_src_vitest_rails.py EXEMPT with the reason")
    if step is not None:
        for g in missing_paths(repo, census, home):
            bad.append(f"UNTRIGGERED READ: a listed rail reads {g}, which no `paths:` glob of {HOME_WORKFLOW} covers: "
                       "add it (python tools/ci_app_src_vitest_rails.py --print-paths lists them all)")
    for t, why in sorted({**exempt, **known_red}.items()):
        if t not in census:
            bad.append(f"EXEMPT/KNOWN_RED names {t}, which reads no other folder (renamed, deleted?): drop it")
        if len(why.strip()) < 40:
            bad.append(f"EXEMPT/KNOWN_RED without a reason a reviewer can argue with: {t}: {why!r}")
    return bad


# ── the command line ────────────────────────────────────────────────────────────────────────────────────────────────

def _app_rel(t: str) -> str:
    return t[len("app/"):] if t.startswith("app/") else t


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    ap.add_argument("--census", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--print-list", action="store_true", help="the home list, app-relative, space-separated")
    ap.add_argument("--json", type=pathlib.Path)
    ap.add_argument("--print-paths", action="store_true",
                    help="the globs the home workflow's paths: must add for every listed rail's reads to trigger it")
    ap.add_argument("--changed", type=pathlib.Path, help="the PR's changed files, one per line (empty = ALL)")
    ap.add_argument("--plan", action="store_true", help="print count=, n=, shards= and known_red= for $GITHUB_OUTPUT")
    ap.add_argument("--write-files", type=pathlib.Path, help="write one shard's files here, app-relative, one per line")
    ap.add_argument("--write-known-red", type=pathlib.Path,
                    help="write the KNOWN_RED files the PR selects here, app-relative (each must FAIL)")
    ap.add_argument("--shard", default="1/1")
    ap.add_argument("--repo", type=pathlib.Path, default=ROOT)
    a = ap.parse_args(argv)
    repo = a.repo.resolve()
    model = Census(repo)
    all_tests = model.test_files()
    c = model.census()
    if not c:
        print("::error::the census found no vitest file that reads another folder: the scan is broken")
        return 2
    home = print_list(repo, c, all_tests)
    if a.print_paths:
        for g in missing_paths(repo, c, home):
            print(g)
        return 0
    if a.print_list:
        print(" ".join(_app_rel(t) for t in home))
        return 0 if home else 1
    changed = a.changed.read_text(encoding="utf-8").splitlines() if a.changed is not None else []
    chosen, why = select(home, c, changed, model) if a.changed is not None else (home, f"ALL {len(home)}")
    reds = sorted(KNOWN_RED)
    if a.changed is not None:
        reds = select(reds, c, changed, model)[0]
    if a.plan:
        n = shard_count(chosen, load_timings(repo)) or (1 if reds else 0)   # known reds alone still need one shard
        print(f"count={len(chosen)}")
        print(f"n={n}")
        print(f"shards={json.dumps(list(range(1, n + 1)))}")
        print(f"known_red={len(reds)}")
        print(f"cross-folder vitest rails selected: {why}; known-red selected: {len(reds)}", file=sys.stderr)
        for t in chosen:
            print(f"  {t}", file=sys.stderr)
        return 0
    if a.write_known_red:
        a.write_known_red.write_text("".join(f"{_app_rel(t)}\n" for t in reds), encoding="utf-8")
        print(f"known-red vitest files selected: {len(reds)}")
        return 0
    if a.write_files:
        m = re.fullmatch(r"(\d+)/(\d+)", a.shard)
        if not m or not 1 <= int(m.group(1)) <= int(m.group(2)):
            ap.error(f"--shard {a.shard!r}: want K/N with 1 <= K <= N")
        k, n = int(m.group(1)), int(m.group(2))
        mine = P.partition(chosen, n, load_timings(repo))[k - 1] if chosen else []
        a.write_files.write_text("".join(f"{_app_rel(t)}\n" for t in mine), encoding="utf-8")
        print(f"cross-folder vitest rails, shard {k}/{n}: {len(mine)} of {len(chosen)} selected ({why})")
        if not chosen:
            print("no listed rail selected: only the known-red step has work")
            return 0
        if not mine:
            print(f"::error::shard {k}/{n} is empty (the plan cut more shards than files)")
            return 1
        return 0
    jobs = pr_jobs(repo, all_tests, home=home if home_step(repo) is not None else None)
    cov = coverage(c, jobs)
    if a.json:
        a.json.write_text(json.dumps({t: {"reads": c[t], **cov[t], "unresolved": model.unresolved(t)}
                                      for t in sorted(c)}, indent=1), encoding="utf-8")
    if a.census:
        for t in sorted(c):
            reads = sorted(c[t])
            show = ", ".join(reads[:2]) + (f" (+{len(reads) - 2})" if len(reads) > 2 else "")
            print(f"{t}\t{show}\t{' | '.join(cov[t]['runs']) or 'NONE'}")
    if a.check:
        bad = judge(repo, c, all_tests)
        for b in bad:
            print(f"::error::{b}")
        print(f"cross-folder vitest rails: {len(all_tests)} vitest files, {len(c)} read another folder; {len(home)} on "
              f"the home list, {sum(1 for t in c if cov[t]['runs'])} run on the PR in all; {len(KNOWN_RED)} known red; "
              f"{len(bad)} problem(s)")
        return 1 if bad else 0
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(errors="replace")               # a cp1252 console must not end the run mid-table
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
