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


def test_primitives_used_finds_plot_fill_and_baseline():
    src = "//@version=6\nindicator('X')\na = plot(close)\nb = plot(open)\nfill(a, b)\n"
    used = primitives_used(src, ["line", "band", "histogram"])
    assert "band" in used
    assert "line" in used
    assert "histogram" not in used

    # ⭐ baseline regex verification (this is the entry the brief flagged as
    # "refined at implementation time" — see task-2-report.md for the fixture
    # investigation this is based on). The real Pine construct for a
    # baseline-style plot is `style=plot.style_baseline` — confirmed against
    # `PINE_PLOT_STYLES` / `RESTYLEABLE_DEF_STYLES` in the chart engine source,
    # not merely assumed.
    baseline_src = "//@version=6\nindicator('X')\nplot(close, style=plot.style_baseline)\n"
    assert "baseline" in primitives_used(baseline_src, ["baseline"])

    # ⛔ Regression guard: the brief's own placeholder pattern for "baseline"
    # included `\bhline\s*\(\s*0` as a fallback. That is a REAL, common and
    # UNRELATED idiom in this fixture corpus — an oscillator zero-line, e.g.
    # tools/c0_oos_fixtures/high_engagement__24-coppock-curve-multi-filter-markittick.pine:383
    # (`hline(0, "Zero Line", color = c_zeroLine, linestyle = hline.style_dashed)`)
    # and tools/c0_oos_fixtures/mid_engagement__09-relative-volume-breakout-context.pine:181
    # — neither script uses a baseline-STYLE plot. A bare `hline(0)` must never
    # read as "baseline" usage, or the matrix over-reports this primitive on
    # every fixture that merely draws a zero reference line.
    zero_line_src = "//@version=6\nindicator('X')\nplot(close)\nhline(0, \"Zero Line\")\n"
    assert "baseline" not in primitives_used(zero_line_src, ["baseline"])


def test_primitives_used_finds_plotcandle_as_its_own_distinct_primitive():
    # ⛔ Ruling (controller, 2026-09-19): the brief's own `_PRIMITIVE_PATTERNS`
    # dict omitted "plotcandle" entirely, distinct from "candles" — the
    # canonical 22-name vocabulary (Task 1's manifest) lists both as SEPARATE
    # entries, sourced from two different engine constants (presentation.js's
    # internal render-style PLOT_STYLES vs. ast/pine.js's MULTI_OUTPUT_CALLS
    # literal Pine call name). Without a "plotcandle" key, `primitives_used`
    # silently skipped it for every script, always reporting 0% coverage
    # regardless of real usage. Confirmed against real fixture usage, e.g.
    # tools/c0_oos_fixtures/mid_engagement__13-spma-trend.pine:199
    # (`plotcandle(open, high, low, close, "Candles", ...)`).
    src = "//@version=6\nindicator('X')\nplotcandle(open, high, low, close)\n"
    used = primitives_used(src, ["plotcandle", "candles", "line"])
    assert "plotcandle" in used
    assert "line" not in used


def test_primitives_used_is_not_fooled_by_a_comment():
    # Regression class this repo has hit repeatedly: a literal-hunting scan must
    # strip comments first, or a mention IN A COMMENT reads as usage.
    src = "//@version=6\nindicator('X')\n// this script does not use plotarrow\nplot(close)\n"
    used = primitives_used(src, ["plotarrow", "line"])
    assert "plotarrow" not in used
    assert "line" in used
