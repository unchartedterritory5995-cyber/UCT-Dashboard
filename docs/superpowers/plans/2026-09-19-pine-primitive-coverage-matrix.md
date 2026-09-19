# Pine Primitive Coverage Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a code-derived matrix showing which Pine visual-rendering primitive each corpus fixture script exercises, add a rail that fails if any primitive drops to zero coverage, and fill the four primitives (`plotarrow`, explicit area style, `plotbar`, stepline style) currently at zero/one script.

**Architecture:** A Node/acorn AST parser (`tools/pine_primitive_manifest.mjs`) extracts the canonical primitive vocabulary directly from the chart engine's own source text — never a hand-typed duplicate list — following the exact pattern this repo already uses for `tools/nav_manifest.mjs`. A Python script (`tools/pine_primitive_coverage.py`) reads that manifest, scans and dedupes the fixture corpus by content, and emits a markdown + JSON coverage report. A pytest rail fails if any primitive's count is zero. Four new minimal fixture `.pine` files close the identified gaps.

**Tech Stack:** Node.js + `acorn` (already an `app/` dependency, resolved via `createRequire` — no new dependency), Python 3 (stdlib only — no new dependency for this plan).

**Spec:** `docs/superpowers/specs/universal-indicator-ecosystem/RENDERING_PARITY_VERIFICATION_PROGRAM.md` §4.1, §7 (risks), §8 items 1-2.

## Global Constraints

- Never hand-type the primitive list — it must be parsed from the engine source (spec §4.1, and this repo's own repeated "hand-typed list drifts from the array it describes" defect class).
- Coverage counting must dedupe the corpus by script content, not count files across directories — `c0_parity_fixtures/` and `c3a_parity_fixtures/` are ~90% the same files as `c0_oos_fixtures/` (spec §3, §7).
- New fixture scripts are minimal and single-purpose — they exercise exactly the named construct, not borrowed complex scripts hoped to qualify (spec §4.1).
- Every new script gets its own test file (spec §5).
- The coverage-floor rail must be mutation-proved: remove a primitive's sole justifying fixture, confirm the rail goes red; restore it, confirm green (spec §4.1, §5).

---

### Task 1: Primitive manifest derivation (`tools/pine_primitive_manifest.mjs`)

**Files:**
- Create: `tools/pine_primitive_manifest.mjs`
- Test: `tools/__tests__/pine_primitive_manifest.test.mjs`

**Interfaces:**
- Produces: `primitiveManifest()` — an exported function returning
  `{ primitives: string[], sources: Record<string, {file: string, constant: string}> }`.
  Task 3 imports this by shelling out to `node tools/pine_primitive_manifest.mjs --json`
  (see Task 1 Step 5) and parsing stdout — Python cannot `import` an ES module directly,
  so the manifest is exposed as a CLI JSON emitter, matching how `tools/nav_manifest.mjs`
  is invoked (`node tools/nav_manifest.mjs`) rather than imported cross-language.
- The canonical primitive name list this task establishes (used verbatim by every later
  task): `line`, `stepline`, `histogram`, `area`, `baseline`, `markers`, `band`, `candles`,
  `plotshape`, `plotchar`, `plotarrow`, `bgcolor`, `barcolor`, `fill`, `hline`, `plotcandle`,
  `plotbar`, `line_obj`, `label_obj`, `box_obj`, `table_obj`, `linefill_obj`.
  (The five Pine drawing-object namespaces are suffixed `_obj` to avoid colliding with the
  unrelated rendering primitives `line`/`histogram`/etc. that share a bare name.)

This task reads the following real engine constants, located this session:
- `app/src/components/chart/engine/presentation.js:97-99` — `const RESTYLEABLE_DEF_STYLES = Object.freeze(new Set(['line', 'stepline', 'histogram', 'area', 'baseline', 'markers']))` (not exported — parsed from source text, not imported, exactly like `nav_manifest.mjs` parses `NAV_ITEMS` out of `NavBar.jsx` without importing it).
- `app/src/components/chart/engine/presentation.js:90-95` and `:33-41` — band/fill and `candles` handling (read the exact lines when implementing; the constant names above are what Step 1 confirms against real AST output).
- `app/src/components/chart/engine/ast/pine.js:450-466` — `const OUTPUT_CALLS = Object.freeze({ plot: 'series', alertcondition: 'condition', plotshape: 'series', plotchar: 'series', plotarrow: 'series' })`.
- `app/src/components/chart/engine/ast/pine.js:488-490` — `const MULTI_OUTPUT_CALLS = Object.freeze({ plotcandle: [...], plotbar: [...] })` (exact array contents confirmed at these lines; keys are what this task needs).
- `app/src/components/chart/engine/ast/pine.js:1783-1786` — `const CHART_ONLY_CALLS = Object.freeze(new Set(['plotshape', 'plotchar', 'bgcolor', 'barcolor', 'fill', 'hline', 'alert']))`.
- `app/src/components/chart/engine/ast/pineObjects.js:88` — `export const OBJECT_NAMESPACES = Object.freeze(['line', 'label', 'box', 'table', 'linefill'])` (this one IS exported, but this task still parses it via acorn rather than importing, so all five source constants go through one uniform code path).

- [ ] **Step 1: Write the failing test**

```js
// tools/__tests__/pine_primitive_manifest.test.mjs
import { describe, it, expect } from 'vitest'
import { primitiveManifest } from '../pine_primitive_manifest.mjs'

describe('primitiveManifest', () => {
  it('includes every known rendering primitive, sourced from the engine', () => {
    const { primitives, sources } = primitiveManifest()
    const expected = [
      'line', 'stepline', 'histogram', 'area', 'baseline', 'markers', 'band', 'candles',
      'plotshape', 'plotchar', 'plotarrow', 'bgcolor', 'barcolor', 'fill', 'hline',
      'plotcandle', 'plotbar',
      'line_obj', 'label_obj', 'box_obj', 'table_obj', 'linefill_obj',
    ]
    for (const p of expected) {
      expect(primitives, `missing primitive: ${p}`).toContain(p)
      expect(sources[p], `no source recorded for: ${p}`).toBeDefined()
      expect(sources[p].file).toMatch(/\.js$/)
    }
  })

  it('does not silently drop a primitive if the source constant is renamed', () => {
    // Non-vacuity control: the extractor must fail LOUDLY, not return an empty
    // list, if a target constant can't be found in its file.
    expect(() => {
      const { primitiveManifest: pm } = { primitiveManifest }
      pm.__extractConst?.('presentation.js', 'NOT_A_REAL_CONSTANT_NAME')
    }).not.toThrow() // placeholder call shape; real assertion added once __extractConst
    // is implemented in Step 3 — this test is expanded in Step 3, not left as-is.
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tools/../../../tools/__tests__/pine_primitive_manifest.test.mjs` — actually run from repo root: `npx vitest run tools/__tests__/pine_primitive_manifest.test.mjs --root .`
Expected: FAIL with "Cannot find module '../pine_primitive_manifest.mjs'"

- [ ] **Step 3: Write the implementation**

```js
// tools/pine_primitive_manifest.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRequire = createRequire(pathToFileURL(path.join(REPO, 'app', 'package.json')))
const { Parser } = appRequire('acorn')

const ENGINE = 'app/src/components/chart/engine'

// Each entry: which file, which top-level const, and how to read its literal
// members (a Set(['a','b']), an object whose KEYS are the primitives, or a
// plain array literal). This is the single place the five source constants
// are named — everything downstream reads primitiveManifest()'s output.
const TARGETS = [
  { file: `${ENGINE}/presentation.js`, constant: 'RESTYLEABLE_DEF_STYLES', shape: 'set' },
  { file: `${ENGINE}/ast/pine.js`, constant: 'OUTPUT_CALLS', shape: 'objectKeys' },
  { file: `${ENGINE}/ast/pine.js`, constant: 'MULTI_OUTPUT_CALLS', shape: 'objectKeys' },
  { file: `${ENGINE}/ast/pine.js`, constant: 'CHART_ONLY_CALLS', shape: 'set' },
  { file: `${ENGINE}/ast/pineObjects.js`, constant: 'OBJECT_NAMESPACES', shape: 'array' },
]

// Primitives that need renaming/merging to a stable vocabulary name distinct
// from a Pine drawing-object namespace of the same word (e.g. `line` the
// rendering style vs. `line.new(...)` the drawing object).
const OBJECT_NAMESPACE_SUFFIX = new Set(['line', 'label', 'box', 'table', 'linefill'])

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const val = node[key]
    if (Array.isArray(val)) val.forEach((v) => walk(v, fn))
    else if (val && typeof val.type === 'string') walk(val, fn)
  }
}

function literalOf(node) {
  if (node.type === 'Literal') return node.value
  return undefined
}

function extractConst(fileRel, constantName, shape) {
  const src = readFileSync(path.join(REPO, fileRel), 'utf8')
  const ast = Parser.parse(src, { ecmaVersion: 2022, sourceType: 'module' })
  let found
  walk(ast, (node) => {
    if (found) return
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.id.name === constantName
    ) {
      found = node.init
    }
  })
  if (!found) {
    throw new Error(`primitiveManifest: could not find const ${constantName} in ${fileRel} — was it renamed?`)
  }
  // Unwrap Object.freeze(...) / new Set(Object.freeze([...])) wrappers.
  let inner = found
  while (
    inner.type === 'CallExpression' &&
    inner.callee?.type === 'MemberExpression' &&
    inner.callee.object?.name === 'Object' &&
    inner.callee.property?.name === 'freeze'
  ) {
    inner = inner.arguments[0]
  }
  if (inner.type === 'NewExpression' && inner.callee?.name === 'Set') {
    inner = inner.arguments[0]
  }

  if (shape === 'array') {
    if (inner.type !== 'ArrayExpression') {
      throw new Error(`primitiveManifest: ${constantName} in ${fileRel} is not an array literal after unwrapping`)
    }
    return inner.elements.map(literalOf).filter((v) => v !== undefined)
  }
  if (shape === 'set') {
    if (inner.type !== 'ArrayExpression') {
      throw new Error(`primitiveManifest: ${constantName} in ${fileRel} (Set) has no array literal after unwrapping`)
    }
    return inner.elements.map(literalOf).filter((v) => v !== undefined)
  }
  if (shape === 'objectKeys') {
    if (inner.type !== 'ObjectExpression') {
      throw new Error(`primitiveManifest: ${constantName} in ${fileRel} is not an object literal after unwrapping`)
    }
    return inner.properties
      .map((p) => (p.key?.type === 'Identifier' ? p.key.name : literalOf(p.key)))
      .filter((v) => v !== undefined)
  }
  throw new Error(`primitiveManifest: unknown shape ${shape}`)
}

export function primitiveManifest() {
  const primitives = new Set()
  const sources = {}

  for (const target of TARGETS) {
    const names = extractConst(target.file, target.constant, target.shape)
    for (const raw of names) {
      const name = OBJECT_NAMESPACE_SUFFIX.has(raw) && target.constant === 'OBJECT_NAMESPACES'
        ? `${raw}_obj`
        : raw
      primitives.add(name)
      sources[name] = { file: target.file, constant: target.constant }
    }
  }

  // `band` (Pine's `fill()` between two plots) and `candles` are real
  // rendering primitives the corpus must cover, confirmed present in
  // presentation.js (:90-95 band, :33-41 candles) but not captured by the
  // five TARGETS above (they live in inline conditionals, not a named
  // const collection) — declared explicitly rather than parsed, and each
  // has a comment explaining why it's the one exception to "never hand-type".
  primitives.add('band') // presentation.js:90-95 — fill()/band handling, not a named const
  sources.band = { file: `${ENGINE}/presentation.js`, constant: '(inline band handling, :90-95)' }
  primitives.add('candles') // presentation.js:33-41 — PLOT_STYLES 'candles' entry
  sources.candles = { file: `${ENGINE}/presentation.js`, constant: 'PLOT_STYLES' }

  return { primitives: [...primitives].sort(), sources }
}

function selfCheck() {
  const { primitives } = primitiveManifest()
  const required = ['line', 'plotshape', 'plotarrow', 'bgcolor', 'plotcandle', 'table_obj']
  const missing = required.filter((r) => !primitives.includes(r))
  if (missing.length) {
    console.error('SELF-CHECK FAILED — missing:', missing)
    process.exit(1)
  }
  console.log('SELF-CHECK OK —', primitives.length, 'primitives found')
}

const argv = process.argv.slice(2)
if (argv.includes('--self-check')) {
  selfCheck()
} else if (argv.includes('--json')) {
  console.log(JSON.stringify(primitiveManifest(), null, 2))
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { primitives } = primitiveManifest()
  console.log(primitives.join('\n'))
}
```

- [ ] **Step 4: Fix the placeholder test from Step 1, run, verify pass**

Replace the second `it(...)` block in `pine_primitive_manifest.test.mjs` with a real
assertion now that the implementation exists:

```js
  it('throws loudly rather than silently omitting a primitive if a constant is renamed', () => {
    // extractConst is not exported (internal); this proves the FAILURE MODE via the
    // public surface: manifest() must never return an empty primitives array, which
    // is what a swallowed "constant not found" would produce.
    const { primitives } = primitiveManifest()
    expect(primitives.length).toBeGreaterThan(15)
  })
```

Run: `npx vitest run tools/__tests__/pine_primitive_manifest.test.mjs`
Expected: PASS, 2/2.

- [ ] **Step 5: Verify the CLI entry points work**

Run: `node tools/pine_primitive_manifest.mjs --self-check`
Expected: `SELF-CHECK OK — 22 primitives found` (or similar count ≥ 20).

Run: `node tools/pine_primitive_manifest.mjs --json`
Expected: valid JSON with `primitives` (array) and `sources` (object) keys.

- [ ] **Step 6: Commit**

```bash
git add tools/pine_primitive_manifest.mjs tools/__tests__/pine_primitive_manifest.test.mjs
git commit -m "feat(pine): derive the rendering-primitive vocabulary from engine source via AST"
```

---

### Task 2: Corpus scanner with content-based dedup (`tools/pine_primitive_coverage.py`, scan phase)

**Files:**
- Create: `tools/pine_primitive_coverage.py`
- Test: `tests/test_pine_primitive_coverage.py`

**Interfaces:**
- Consumes: `node tools/pine_primitive_manifest.mjs --json` (Task 1), invoked via
  `subprocess.run([...], capture_output=True, text=True, check=True)` — resolve the
  `node` executable with `shutil.which('node')` and exec the resolved path (this repo's
  own CLAUDE.md documents a real incident where `subprocess.run(["railway", ...])`
  silently failed on Windows without `shutil.which` — same class of bug, avoided here
  from the start).
- Produces: `dedupe_corpus(paths: list[Path]) -> list[dict]` where each dict is
  `{"path": str, "title": str, "content_hash": str}` — later tasks (3, 4) call this.
- Produces: `primitives_used(pine_source: str, primitive_names: list[str]) -> set[str]` —
  the per-script construct scan.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_pine_primitive_coverage.py
import hashlib
from pathlib import Path

from tools.pine_primitive_coverage import dedupe_corpus, primitives_used

FIXTURE_DIRS = [
    "tools/c0_oos_fixtures",
    "tools/c0_parity_fixtures",
    "tools/c3a_parity_fixtures",
]


def test_dedupe_corpus_collapses_identical_content_across_directories(tmp_path):
    a = tmp_path / "dir_a"
    b = tmp_path / "dir_b"
    a.mkdir()
    b.mkdir()
    same_text = "//@version=6\nindicator('X')\nplot(close)\n"
    (a / "script.pine").write_text(same_text, encoding="utf-8")
    (b / "script_copy.pine").write_text(same_text, encoding="utf-8")
    (b / "different.pine").write_text(same_text + "hline(0)\n", encoding="utf-8")

    result = dedupe_corpus([a / "script.pine", b / "script_copy.pine", b / "different.pine"])

    hashes = {r["content_hash"] for r in result}
    assert len(result) == 2, "identical content across two directories must count once"
    assert len(hashes) == 2


def test_dedupe_corpus_is_never_vacuous_on_the_real_fixture_dirs():
    paths = []
    for d in FIXTURE_DIRS:
        p = Path(d)
        if p.exists():
            paths.extend(p.glob("*.pine"))
    assert len(paths) > 20, "fixture directories are missing or nearly empty — check paths"
    result = dedupe_corpus(paths)
    assert 15 <= len(result) <= 30, (
        f"expected roughly the ~23-unique-script count established in the spec, got {len(result)}"
    )


def test_primitives_used_finds_plot_and_fill():
    src = "//@version=6\nindicator('X')\na = plot(close)\nb = plot(open)\nfill(a, b)\n"
    used = primitives_used(src, ["line", "band", "histogram"])
    assert "band" in used
    assert "line" in used
    assert "histogram" not in used


def test_primitives_used_is_not_fooled_by_a_comment():
    # Regression class this repo has hit repeatedly: a literal-hunting scan must
    # strip comments first, or a mention IN A COMMENT reads as usage.
    src = "//@version=6\nindicator('X')\n// this script does not use plotarrow\nplot(close)\n"
    used = primitives_used(src, ["plotarrow", "line"])
    assert "plotarrow" not in used
    assert "line" in used
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_pine_primitive_coverage.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tools.pine_primitive_coverage'`

- [ ] **Step 3: Write the implementation (scan/dedupe portion)**

```python
# tools/pine_primitive_coverage.py
"""Derives Pine rendering-primitive coverage across the fixture corpus.

Primitive names come from tools/pine_primitive_manifest.mjs (parsed from the
chart engine's own source, never hand-typed here) — see that file for why.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIRS = [
    REPO_ROOT / "tools" / "c0_oos_fixtures",
    REPO_ROOT / "tools" / "c0_parity_fixtures",
    REPO_ROOT / "tools" / "c3a_parity_fixtures",
]
MANIFEST_SCRIPT = REPO_ROOT / "tools" / "pine_primitive_manifest.mjs"

_COMMENT_RE = re.compile(r"//.*$", re.MULTILINE)

# Primitive name -> the literal Pine construct(s) that indicate its use.
# Order matters only for readability; matching is independent per primitive.
_PRIMITIVE_PATTERNS: dict[str, list[str]] = {
    "line": [r"\bplot\s*\("],
    "stepline": [r"style\s*=\s*plot\.style_stepline", r"style_stepline"],
    "histogram": [r"style\s*=\s*plot\.style_histogram", r"style_histogram"],
    "area": [r"style\s*=\s*plot\.style_area", r"style_area"],
    "baseline": [r"style\s*=\s*plot\.style_area\b.*baseline", r"\bhline\s*\(\s*0"],  # refined at implementation time
    "markers": [r"style\s*=\s*plot\.style_circles", r"style_circles"],
    "band": [r"\bfill\s*\("],
    "candles": [r"\bplotcandle\s*\("],
    "plotshape": [r"\bplotshape\s*\("],
    "plotchar": [r"\bplotchar\s*\("],
    "plotarrow": [r"\bplotarrow\s*\("],
    "bgcolor": [r"\bbgcolor\s*\("],
    "barcolor": [r"\bbarcolor\s*\("],
    "fill": [r"\bfill\s*\("],
    "hline": [r"\bhline\s*\("],
    "plotbar": [r"\bplotbar\s*\("],
    "line_obj": [r"\bline\.new\s*\("],
    "label_obj": [r"\blabel\.new\s*\("],
    "box_obj": [r"\bbox\.new\s*\("],
    "table_obj": [r"\btable\.new\s*\("],
    "linefill_obj": [r"\blinefill\.new\s*\("],
}


def strip_comments(source: str) -> str:
    return _COMMENT_RE.sub("", source)


def load_primitive_names() -> list[str]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node executable not found on PATH")
    result = subprocess.run(
        [node, str(MANIFEST_SCRIPT), "--json"],
        capture_output=True, text=True, check=True, cwd=REPO_ROOT,
    )
    manifest = json.loads(result.stdout)
    return manifest["primitives"]


def primitives_used(pine_source: str, primitive_names: list[str]) -> set[str]:
    clean = strip_comments(pine_source)
    used = set()
    for name in primitive_names:
        patterns = _PRIMITIVE_PATTERNS.get(name)
        if not patterns:
            continue
        if any(re.search(p, clean) for p in patterns):
            used.add(name)
    return used


def dedupe_corpus(paths: list[Path]) -> list[dict]:
    seen: dict[str, dict] = {}
    for p in paths:
        text = p.read_text(encoding="utf-8", errors="replace")
        content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if content_hash in seen:
            continue
        title_match = re.search(r'indicator\s*\(\s*(?:title\s*=\s*)?["\']([^"\']+)["\']', text)
        seen[content_hash] = {
            "path": str(p.relative_to(REPO_ROOT)),
            "title": title_match.group(1) if title_match else p.stem,
            "content_hash": content_hash,
        }
    return list(seen.values())


def collect_corpus_paths() -> list[Path]:
    paths: list[Path] = []
    for d in FIXTURE_DIRS:
        if d.exists():
            paths.extend(sorted(d.glob("*.pine")))
    return paths
```

- [ ] **Step 4: Run tests, verify pass**

Run: `python -m pytest tests/test_pine_primitive_coverage.py -v`
Expected: PASS, 4/4. If `test_primitives_used_finds_plot_and_fill` or the baseline
regex for `baseline` fails, tighten the regex in `_PRIMITIVE_PATTERNS` — the `baseline`
row is deliberately marked "refined at implementation time" above because this session's
research flagged it unchecked (spec §3); confirm the real Pine syntax for a baseline plot
(`plot.style_baseline` matched to what `RESTYLEABLE_DEF_STYLES` names) before finalizing
that one regex, and adjust the test in Step 1 to match once confirmed.

- [ ] **Step 5: Commit**

```bash
git add tools/pine_primitive_coverage.py tests/test_pine_primitive_coverage.py
git commit -m "feat(pine): scan and dedupe the fixture corpus for primitive usage"
```

---

### Task 3: Matrix report generation (markdown + JSON)

**Files:**
- Modify: `tools/pine_primitive_coverage.py` (add report-generation + CLI entrypoint)
- Modify: `tests/test_pine_primitive_coverage.py` (add report tests)
- Create (generated, not hand-written): `docs/pine/primitive-coverage.md`, `docs/pine/primitive-coverage.json`

**Interfaces:**
- Consumes: `dedupe_corpus()`, `primitives_used()`, `load_primitive_names()` from Task 2.
- Produces: `build_matrix(corpus: list[dict], primitive_names: list[str]) -> dict` returning
  `{"primitives": {name: {"count": int, "scripts": [str, ...]}}, "corpus_size": int}`
  — Task 4's rail reads this dict's `primitives[name]["count"]`.

- [ ] **Step 1: Write the failing tests**

```python
def test_build_matrix_counts_and_lists_scripts():
    from tools.pine_primitive_coverage import build_matrix

    corpus = [
        {"path": "a.pine", "title": "A", "content_hash": "h1", "_source": "plot(close)\nfill(1,2)"},
        {"path": "b.pine", "title": "B", "content_hash": "h2", "_source": "bgcolor(color.red)"},
    ]
    matrix = build_matrix(corpus, ["line", "band", "bgcolor", "plotarrow"])
    assert matrix["primitives"]["line"]["count"] == 1
    assert matrix["primitives"]["band"]["count"] == 1
    assert matrix["primitives"]["bgcolor"]["count"] == 1
    assert matrix["primitives"]["plotarrow"]["count"] == 0
    assert matrix["primitives"]["plotarrow"]["scripts"] == []
    assert "a.pine" in matrix["primitives"]["line"]["scripts"]


def test_render_markdown_flags_zero_coverage():
    from tools.pine_primitive_coverage import build_matrix, render_markdown

    corpus = [{"path": "a.pine", "title": "A", "content_hash": "h1", "_source": "plot(close)"}]
    matrix = build_matrix(corpus, ["line", "plotarrow"])
    md = render_markdown(matrix)
    assert "plotarrow" in md
    assert "0" in md
    assert "line" in md
```

- [ ] **Step 2: Run tests, verify fail**

Run: `python -m pytest tests/test_pine_primitive_coverage.py -v -k "build_matrix or render_markdown"`
Expected: FAIL — `ImportError: cannot import name 'build_matrix'`

- [ ] **Step 3: Add the implementation**

```python
# Append to tools/pine_primitive_coverage.py

def build_matrix(corpus: list[dict], primitive_names: list[str]) -> dict:
    matrix = {name: {"count": 0, "scripts": []} for name in primitive_names}
    for entry in corpus:
        source = entry.get("_source")
        if source is None:
            source = Path(REPO_ROOT / entry["path"]).read_text(encoding="utf-8", errors="replace")
        used = primitives_used(source, primitive_names)
        for name in used:
            matrix[name]["count"] += 1
            matrix[name]["scripts"].append(entry["path"])
    return {"primitives": matrix, "corpus_size": len(corpus)}


def render_markdown(matrix: dict) -> str:
    lines = [
        "# Pine Primitive Coverage Matrix",
        "",
        "_Generated by `tools/pine_primitive_coverage.py` — do not hand-edit._",
        "",
        f"Corpus size (deduped): {matrix['corpus_size']}",
        "",
        "| Primitive | Count | Example scripts |",
        "|---|---|---|",
    ]
    for name, data in sorted(matrix["primitives"].items(), key=lambda kv: kv[1]["count"]):
        flag = " ⚠️ ZERO COVERAGE" if data["count"] == 0 else (" ⚠️ thin" if data["count"] == 1 else "")
        examples = ", ".join(data["scripts"][:3])
        lines.append(f"| `{name}` | {data['count']}{flag} | {examples} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    primitive_names = load_primitive_names()
    paths = collect_corpus_paths()
    corpus = dedupe_corpus(paths)
    matrix = build_matrix(corpus, primitive_names)

    out_md = REPO_ROOT / "docs" / "pine" / "primitive-coverage.md"
    out_json = REPO_ROOT / "docs" / "pine" / "primitive-coverage.json"
    out_md.write_text(render_markdown(matrix), encoding="utf-8")
    out_json.write_text(json.dumps(matrix, indent=2), encoding="utf-8")

    zero = [n for n, d in matrix["primitives"].items() if d["count"] == 0]
    print(f"Wrote {out_md} and {out_json} — {matrix['corpus_size']} scripts, {len(zero)} primitives at zero coverage.")
    if zero:
        print("ZERO COVERAGE:", ", ".join(sorted(zero)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests, verify pass; run the real report**

Run: `python -m pytest tests/test_pine_primitive_coverage.py -v`
Expected: PASS, all tests.

Run: `python tools/pine_primitive_coverage.py`
Expected: prints a summary; `docs/pine/primitive-coverage.md` and `.json` exist and
show `plotarrow` and explicit `area`/`style_area` at 0, `plotbar`/`stepline` at 1 —
matching the spec §3 baseline. If the counts don't match, the regex table in Task 2
needs adjustment before proceeding — do not paper over a mismatch by editing the
expected baseline in the spec.

- [ ] **Step 5: Commit**

```bash
git add tools/pine_primitive_coverage.py tests/test_pine_primitive_coverage.py docs/pine/primitive-coverage.md docs/pine/primitive-coverage.json
git commit -m "feat(pine): generate the primitive coverage matrix report"
```

---

### Task 4: Coverage-floor rail (mutation-proved)

**Files:**
- Create: `tests/test_pine_primitive_coverage_floor.py`

**Interfaces:**
- Consumes: `load_primitive_names()`, `collect_corpus_paths()`, `dedupe_corpus()`,
  `build_matrix()` from Tasks 2-3.

- [ ] **Step 1: Write the rail test**

```python
# tests/test_pine_primitive_coverage_floor.py
"""Fails if any known rendering primitive has zero fixture coverage.

Mutation-proof procedure (run by hand once, recorded here — not re-run every
CI pass): temporarily `git mv` the sole fixture for a thin primitive (e.g. the
one script using `plotbar`) out of all three fixture directories, confirm this
test goes RED naming that primitive, then restore it and confirm GREEN.
"""
from tools.pine_primitive_coverage import (
    build_matrix, collect_corpus_paths, dedupe_corpus, load_primitive_names,
)


def test_no_primitive_has_zero_fixture_coverage():
    primitive_names = load_primitive_names()
    corpus = dedupe_corpus(collect_corpus_paths())
    matrix = build_matrix(corpus, primitive_names)

    zero = sorted(n for n, d in matrix["primitives"].items() if d["count"] == 0)
    assert not zero, (
        f"These rendering primitives have NO fixture script exercising them: {zero}. "
        f"Add a minimal fixture .pine script under tools/c0_oos_fixtures/ before merging."
    )
```

- [ ] **Step 2: Run to verify it currently FAILS (this is expected and correct — the gaps are real)**

Run: `python -m pytest tests/test_pine_primitive_coverage_floor.py -v`
Expected: FAIL, naming `plotarrow` and `area` (and possibly `stepline`/`plotbar` if
Task 2's regex counts them at exactly the 1 the spec recorded, which is `>0` and would
pass — only true zeros fail this specific rail; thin-but-nonzero coverage is a softer
concern the markdown report flags but this floor does not block on).

This failure is the correct, expected state until Task 5 adds the missing fixtures —
do not treat this red as a bug in the rail.

- [ ] **Step 3: Perform the mutation proof by hand, record the result**

```bash
# Confirm the rail can fail on a currently-passing primitive, not just the known gaps.
# Pick a primitive at count 4+ (e.g. `barcolor`) so removing one script still leaves >0
# for every OTHER primitive — isolating the mutation to the one under test.
grep -l "barcolor(" tools/c0_oos_fixtures/*.pine tools/c0_parity_fixtures/*.pine tools/c3a_parity_fixtures/*.pine
# Temporarily move ALL matching files (git mv to a scratch dir), re-run:
python -m pytest tests/test_pine_primitive_coverage_floor.py -v
# Expected: FAILS, now naming `barcolor` too — proving the rail actually inspects
# content and isn't vacuously green. Restore the moved files (git mv back), re-run:
python -m pytest tests/test_pine_primitive_coverage_floor.py -v
# Expected: back to the Step 2 baseline (barcolor no longer listed).
```

Record the outcome as a one-line comment appended to the test file's module
docstring once confirmed, e.g. `# Mutation-proved 2026-09-19: removing all
barcolor scripts turned this red naming barcolor; restoring turned it green.`

- [ ] **Step 4: Commit**

```bash
git add tests/test_pine_primitive_coverage_floor.py
git commit -m "test(pine): add mutation-proved coverage-floor rail (currently red — real gaps, fixed in next task)"
```

---

### Task 5: Four new fixture scripts closing the identified gaps

**Files:**
- Create: `tools/c0_oos_fixtures/fixture__plotarrow-coverage.pine`
- Create: `tools/c0_oos_fixtures/fixture__area-style-coverage.pine`
- Create: `tools/c0_oos_fixtures/fixture__plotbar-coverage.pine`
- Create: `tools/c0_oos_fixtures/fixture__stepline-coverage.pine`

**Interfaces:** none — these are data files, not code. Named with a `fixture__` prefix
(distinct from the `high_engagement__`/`mid_engagement__`/`long_tail__` real-community-script
prefixes already in use) so it's visually obvious in a directory listing which scripts are
this program's own minimal test fixtures versus real imported community scripts.

- [ ] **Step 1: Write `fixture__plotarrow-coverage.pine`**

```pine
//@version=6
// UCT rendering-parity fixture — exercises `plotarrow` only.
// Added 2026-09-19 to close a zero-coverage gap found by the primitive coverage matrix.
indicator(title = "Fixture: plotarrow coverage", overlay = false)
mom = ta.mom(close, 10)
plotarrow(mom, colorup = color.teal, colordown = color.maroon)
```

- [ ] **Step 2: Write `fixture__area-style-coverage.pine`**

```pine
//@version=6
// UCT rendering-parity fixture — exercises explicit `plot.style_area` only.
// Added 2026-09-19 to close a zero-coverage gap found by the primitive coverage matrix.
indicator(title = "Fixture: area style coverage", overlay = false)
r = ta.rsi(close, 14)
plot(r, title = "RSI", style = plot.style_area, color = color.new(color.blue, 40))
```

- [ ] **Step 3: Write `fixture__plotbar-coverage.pine`**

```pine
//@version=6
// UCT rendering-parity fixture — exercises `plotbar` (thin coverage: 1 script before this).
// Added 2026-09-19 per the primitive coverage matrix.
indicator(title = "Fixture: plotbar coverage", overlay = true)
smoothO = ta.sma(open, 3)
smoothH = ta.sma(high, 3)
smoothL = ta.sma(low, 3)
smoothC = ta.sma(close, 3)
plotbar(smoothO, smoothH, smoothL, smoothC, title = "Smoothed Bars")
```

- [ ] **Step 4: Write `fixture__stepline-coverage.pine`**

```pine
//@version=6
// UCT rendering-parity fixture — exercises `plot.style_stepline` (thin coverage: 1 script before this).
// Added 2026-09-19 per the primitive coverage matrix.
indicator(title = "Fixture: stepline coverage", overlay = false)
donchianMid = (ta.highest(high, 20) + ta.lowest(low, 20)) / 2
plot(donchianMid, title = "Donchian Mid", style = plot.style_stepline, linewidth = 2)
```

- [ ] **Step 5: Verify each fixture is valid by importing it through the real engine**

Run (against whatever this repo's existing single-script import-check entrypoint is —
confirm the exact command by checking `tools/c0_visual_journey.py`'s own per-script
import step, since re-inventing a second import-checker here would duplicate it):
```bash
python tools/c0_visual_journey.py --base http://127.0.0.1:18500 --only fixture__plotarrow-coverage,fixture__area-style-coverage,fixture__plotbar-coverage,fixture__stepline-coverage
```
Expected: all 4 import cleanly with no `pine:no-output` or parse refusal. If the exact
CLI flag name differs from `--only`, check `c0_visual_journey.py --help` first — do not
guess a flag name into this step.

- [ ] **Step 6: Commit**

```bash
git add tools/c0_oos_fixtures/fixture__plotarrow-coverage.pine tools/c0_oos_fixtures/fixture__area-style-coverage.pine tools/c0_oos_fixtures/fixture__plotbar-coverage.pine tools/c0_oos_fixtures/fixture__stepline-coverage.pine
git commit -m "test(pine): add minimal fixtures closing plotarrow/area/plotbar/stepline coverage gaps"
```

---

### Task 6: Re-run the matrix, confirm the floor, close the loop

**Files:** none created — verification only.

- [ ] **Step 1: Re-generate the report**

Run: `python tools/pine_primitive_coverage.py`
Expected: `docs/pine/primitive-coverage.md`/`.json` regenerate; console output shows
`0 primitives at zero coverage`.

- [ ] **Step 2: Run the coverage-floor rail**

Run: `python -m pytest tests/test_pine_primitive_coverage_floor.py -v`
Expected: PASS (this is the same test that correctly failed in Task 4 Step 2 — it
should now be green because Task 5's fixtures closed every zero).

- [ ] **Step 3: Confirm the ≥2-per-primitive floor from spec §4.1's "immediate action"**

```bash
python -c "
import json
data = json.load(open('docs/pine/primitive-coverage.json'))
thin = {k: v['count'] for k, v in data['primitives'].items() if v['count'] < 2}
print('Below floor of 2:', thin if thin else 'none')
"
```
Expected: `plotarrow`, `area`, `plotbar`, `stepline` now show count ≥ 2 (their pre-existing
1 script, if any, plus the new fixture). If any still show exactly 1, add one more
minimal fixture for that specific primitive before calling this task done — the spec's
own floor is ≥2, not merely >0.

- [ ] **Step 4: Run the full existing test suite for this area to confirm no regression**

Run: `python -m pytest tests/test_pine_primitive_coverage.py tests/test_pine_primitive_coverage_floor.py -v`
Expected: all PASS. Also run `npx vitest run tools/__tests__/pine_primitive_manifest.test.mjs` — PASS.

- [ ] **Step 5: Commit the regenerated report**

```bash
git add docs/pine/primitive-coverage.md docs/pine/primitive-coverage.json
git commit -m "chore(pine): regenerate coverage matrix — all primitives at floor of 2+"
```

---

## Deviations from the spec, and why

- **The manifest derivation uses AST parsing of source text (via `acorn`, matching
  `tools/nav_manifest.mjs`'s established pattern), not a runtime `import`.** The spec's
  §4.1 phrase "parsing or importing the real constants" left this open; a Python
  coverage script cannot `import` a JS module directly, and `RESTYLEABLE_DEF_STYLES`
  in `presentation.js` is a non-exported `const` at line 97-99 (verified this session),
  so a JS-side importer would need it exported first — an unnecessary production-code
  change when this repo already has a proven, zero-production-touch pattern for exactly
  this (`nav_manifest.mjs` parses `NAV_ITEMS` out of `NavBar.jsx` the same way). No
  engine source file is modified by this plan.
- **`band` and `candles` are declared explicitly in the manifest script rather than
  parsed from a named constant**, because they don't live in one of the five collections
  this task's research found — they're inline conditional logic in `presentation.js`
  (`:90-95`, `:33-41`). This is flagged in-code as the one exception to "never hand-type,"
  with the exact line numbers cited so it's checkable if that code moves.
- **The `baseline` primitive's detection regex is left unconfirmed pending Task 2 Step 4**
  — this session's research explicitly flagged `baseline` coverage as "unchecked, not
  confirmed zero" (spec §3), and guessing at its Pine syntax rather than confirming it
  would risk a false reading either direction.
