"""The web image ships our Python precompiled (2026-11-12).

Without it every boot compiled the ~1,060 api modules app import touches (4.2 s measured
locally) while members waited out the deploy gap. The step must come AFTER the source is
copied in (compiling before `COPY . /app` compiles nothing that ships) and must target
the api package.
"""
import pathlib
import re

DOCKERFILE = pathlib.Path(__file__).resolve().parents[1] / "Dockerfile.web"


def _runtime_lines():
    text = DOCKERFILE.read_text(encoding="utf-8")
    stage = text.split("AS runtime", 1)[1]
    return [ln.strip() for ln in stage.splitlines() if ln.strip() and not ln.strip().startswith("#")]


def test_runtime_stage_precompiles_the_api_package():
    lines = _runtime_lines()
    hits = [i for i, ln in enumerate(lines) if re.match(r"RUN python -m compileall\b.*\s/app/api\b", ln)]
    assert hits, "Dockerfile.web runtime stage no longer precompiles /app/api"


def test_precompile_runs_after_the_source_is_copied():
    lines = _runtime_lines()
    copy_at = lines.index("COPY . /app")
    compile_at = next(i for i, ln in enumerate(lines) if "compileall" in ln)
    assert compile_at > copy_at, "compileall runs before `COPY . /app`, so it compiles nothing that ships"
