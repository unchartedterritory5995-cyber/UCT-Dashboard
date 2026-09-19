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
    # ⭐ Verified against the real fixture corpus and the chart engine's own
    # `PINE_PLOT_STYLES` map (app/src/components/chart/engine/ast/pine.js) —
    # see task-2-report.md for the full investigation. The brief's placeholder
    # here (`style\s*=\s*plot\.style_area\b.*baseline` plus a bare
    # `\bhline\s*\(\s*0` fallback) does not match real Pine syntax and the
    # hline(0) fallback FALSE-POSITIVES on an ordinary oscillator zero-line —
    # a real, common, and unrelated idiom present in this very corpus
    # (tools/c0_oos_fixtures/high_engagement__24-coppock-curve-multi-filter-markittick.pine:383
    # and tools/c0_oos_fixtures/mid_engagement__09-relative-volume-breakout-context.pine:181,
    # neither of which is a baseline-style plot). The real Pine construct for a
    # baseline-style plot is `style=plot.style_baseline` — brought in line with
    # the sibling entries above (stepline/histogram/area), which all use the
    # same "precise construct, then bare style-constant fallback" shape.
    "baseline": [r"style\s*=\s*plot\.style_baseline", r"style_baseline"],
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
    # ⛔ Ruling (controller, 2026-09-19): the brief's pattern dict omitted
    # "plotcandle" entirely, distinct from "candles" above. Task 1's manifest
    # sources these from TWO different engine constants on purpose — "candles"
    # is presentation.js's internal PLOT_STYLES render-style name, "plotcandle"
    # is ast/pine.js's MULTI_OUTPUT_CALLS literal Pine call name — and the
    # canonical 22-name vocabulary lists both as separate entries. Without this
    # key, `primitives_used()` silently skips "plotcandle" for every script
    # (`_PRIMITIVE_PATTERNS.get("plotcandle")` -> None -> `continue`), always
    # reporting 0% coverage regardless of real usage. Same literal construct as
    # "candles" — both fire on `plotcandle(...)`.
    "plotcandle": [r"\bplotcandle\s*\("],
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
        # ⭐ Not in the brief's Step 3 sample: `relative_to` raises ValueError
        # for a path that isn't inside REPO_ROOT (a tmp_path fixture in tests)
        # AND for a relative Path built fresh rather than resolved from
        # REPO_ROOT (Path("tools/c0_oos_fixtures").glob(...) — how the corpus
        # is walked in the "never vacuous" test). Both are legitimate callers
        # of dedupe_corpus, not just collect_corpus_paths()'s absolute paths,
        # so fall back to the path as given rather than crashing. See
        # task-2-report.md for the failing-test evidence this fix is based on.
        try:
            display_path = str(p.relative_to(REPO_ROOT))
        except ValueError:
            display_path = str(p)
        seen[content_hash] = {
            "path": display_path,
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


def build_matrix(corpus: list[dict], primitive_names: list[str]) -> dict:
    matrix = {name: {"count": 0, "scripts": []} for name in primitive_names}
    for entry in corpus:
        source = entry.get("_source")
        if source is None:
            source = (REPO_ROOT / entry["path"]).read_text(encoding="utf-8", errors="replace")
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
