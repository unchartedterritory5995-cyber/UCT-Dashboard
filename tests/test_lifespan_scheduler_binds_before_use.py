"""⛔ `_scheduler` is a LOCAL of `lifespan`, and locality is retroactive.

THE DEFECT THIS FILE EXISTS FOR
-------------------------------
`lifespan` assigns `_scheduler = None` roughly 1,700 lines into its body.
Python makes a name local to the WHOLE function the moment any line assigns
it, so a `_scheduler.add_job(...)` written textually ABOVE that assignment
does not fall back to a module global — it raises UnboundLocalError on every
boot. Two warm-keeper jobs lived exactly there: the every-minute discord-chart
hot warm (never ran once since it shipped) and the theme-index 15-minute
re-warm. Each boot both raised, the surrounding excepts printed one line into
a flooded log — and the raise inside the dashboard-warm try ABORTED the lines
after it, so the calendar-enrichment warm never started either. Found
2026-08-28 while chasing a different casualty of the same boot (the
index-close post that never fired).

The rail: walk `lifespan`'s own statements — nested defs excluded, because a
closure may legitimately mention `_scheduler` above the assignment as long as
it is only CALLED after — and assert no `_scheduler` read precedes the first
assignment.
"""
import ast
import pathlib

MAIN = pathlib.Path(__file__).resolve().parent.parent / "api" / "main.py"


def _lifespan_fn(tree):
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "lifespan":
            return n
    raise AssertionError("api.main.lifespan exists")


def _walk_skipping_nested_defs(node):
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            continue
        yield child
        yield from _walk_skipping_nested_defs(child)


def test_no_scheduler_read_precedes_its_binding():
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    nodes = list(_walk_skipping_nested_defs(_lifespan_fn(tree)))

    binds = [
        n.lineno for n in nodes
        if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "_scheduler" for t in n.targets)
    ]
    assert binds, "lifespan assigns _scheduler somewhere"
    first_bind = min(binds)

    reads = sorted(
        n.lineno for n in nodes
        if isinstance(n, ast.Name) and n.id == "_scheduler"
        and isinstance(n.ctx, ast.Load)
    )
    # a control: the probe can see reads at all — a walker that matched
    # nothing would pass the assertion below vacuously.
    assert any(ln > first_bind for ln in reads), "the walker sees post-bind reads"

    early = [ln for ln in reads if ln < first_bind]
    assert early == [], (
        f"_scheduler is read at line(s) {early}, before its first assignment "
        f"at line {first_bind} — inside a function scope that read raises "
        "UnboundLocalError at runtime; register the job after the scheduler "
        "exists instead"
    )
