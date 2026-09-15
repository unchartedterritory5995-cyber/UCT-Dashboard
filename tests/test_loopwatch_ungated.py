"""OI-43 — the loop-stall watcher must start whether or not V2 is enabled.

⚰️ THE DEFECT, MEASURED. `loopwatch` is the probe that measures how long the ONE shared
event loop is blocked — the mechanism behind a missed 3-second Discord acknowledgement
(C-02). It has its own kill switch, open by default, so every read of the code said
"live". It was not: its ONLY call site sat inside `if _render_v2.enabled():`, V2 is dark
on every production pod, and the watcher had therefore NEVER RUN.

⭐ It took OI-42 to find it. Once the reading became readable in the health payload it
said `{"running": false, "samples": 0}` — stable at +0s, +30s and +60s. Before that,
"the watcher is running" was an assumption nobody could test, and I had asserted it.

⛔ THE GATE WAS WRONG IN KIND, not merely misplaced. The 2026-09-15 `/flow` ack miss
happened with V2 OFF, one admin user, no load. The instrument built to explain V1 ack
misses only ran when V2 was on.
"""
from __future__ import annotations

import ast
import pathlib

MAIN = pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py"


def _start_call_is_gated_by_v2() -> bool:
    """True if `_v2_loopwatch.start()` sits inside a test of `_render_v2.enabled()`.

    Read from an AST, never a text search: the surrounding comments discuss the V2 gate
    in words, and a grep would match the explanation of the bug and report the bug
    (the class this repo has paid for six times)."""
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        test_src = ast.dump(node.test)
        if "enabled" not in test_src or "_render_v2" not in test_src:
            continue
        for inner in ast.walk(node):
            if (isinstance(inner, ast.Call)
                    and isinstance(inner.func, ast.Attribute)
                    and inner.func.attr == "start"
                    and getattr(inner.func.value, "id", "") == "_v2_loopwatch"):
                return True
    return False


def _start_call_sites() -> int:
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    return sum(1 for n in ast.walk(tree)
               if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and n.func.attr == "start" and getattr(n.func.value, "id", "") == "_v2_loopwatch")


def test_the_loop_watch_start_is_not_behind_the_V2_flag():
    """⛔ THE LOAD-BEARING ONE. This is the whole of OI-43."""
    assert not _start_call_is_gated_by_v2(), (
        "_v2_loopwatch.start() is inside `if _render_v2.enabled():` again — the watcher "
        "will never run on a V2-dark pod, which is every production pod")


def test_there_is_exactly_one_start_call_site():
    """⛔ NON-VACUITY for the check above: `not gated` is satisfied just as well by a
    file where the call has been deleted entirely. It must still be there, once."""
    assert _start_call_sites() == 1, (
        f"expected exactly one _v2_loopwatch.start() call site, found {_start_call_sites()}")


def test_the_watcher_still_honours_its_OWN_kill_switch(monkeypatch):
    """⛔ UN-GATING FROM V2 MUST NOT UN-GATE IT FROM ITSELF. `loopwatch.enabled()` is a
    kill switch (unset = ON); the point of OI-43 is that V2 is the wrong gate, not that
    there should be no gate."""
    from api.services.discord_render import loopwatch
    monkeypatch.setenv(loopwatch.ENV, "0")
    monkeypatch.setattr(loopwatch, "_WATCH", None, raising=False)
    assert loopwatch.start() is None, "the kill switch stopped working"
    assert loopwatch.snapshot()["running"] is False


def test_the_kill_switch_is_open_by_default(monkeypatch):
    """⛔ NON-VACUITY for the test above — it passes trivially if `enabled()` is always
    False, which would mean the watcher never runs for a different reason."""
    from api.services.discord_render import loopwatch
    monkeypatch.delenv(loopwatch.ENV, raising=False)
    assert loopwatch.enabled() is True


def test_the_start_is_still_on_the_event_loop_it_measures():
    """⛔ It must not drift into the `to_thread` call beside it. A task created off the
    loop attaches to nothing and the probe silently measures a loop that is not the one
    serving members (step 2.4b P2.9)."""
    src = MAIN.read_text(encoding="utf-8")
    i = src.index("_v2_loopwatch.start()")
    window = src[max(0, i - 400):i]
    assert "to_thread(_v2_loopwatch" not in window
    assert "await _v2_loopwatch" not in src, "the start was made awaitable — it is sync by design"
