# Further isolation scripts (13Q-Q1check)

These are the intermediate diagnostic scripts run between the "retry" fix
(measured failing) and the "direct DOM focus" fix (also measured failing in
the real product flow, see `../results-final.json`), before the decisive
`../natural-vs-injected-diagnosis/` isolation. Kept for the full trail; each
file's own docstring says what it was checking and why. In order run:

1. `01_many_attempts_diag.py` -- up to 40 pure-JS retries of
   `editor.commands.focus('end')` via `page.evaluate()`; landed on attempt 1
   in this one run (flaky -- not reproduced by 05/06 below with the identical
   shape).
2. `02_persistent_session.py` -- ONE context/page reused for 5 reps, no
   `bring_to_front()`, to rule out "fresh context" as the cause. Still 0/5.
3. `03_evaluate_vs_natural.py` -- same reused-context shape, no
   `bring_to_front()`; a manual `page.evaluate()` call of the deferred TipTap
   command also failed here, ruling out "manual evaluate always works".
4. `04_persist_with_bring.py` -- persistent session WITH one `bring_to_front()`
   up front, 5 reps, to check whether only the FIRST note in a session fails.
   All 5 failed -- not a warm-up effect.
5. `05_isolate2.py` / `06_isolate3.py` -- pinned down that the TipTap-deferred
   command itself is unreliable even via `page.evaluate()` regardless of
   context shape, which is what sent the investigation to try a SYNCHRONOUS
   direct DOM call instead (`../direct-dom-focus-diagnosis/`, 3/3) and then to
   the final natural-vs-injected A/B that settled it
   (`../natural-vs-injected-diagnosis/`).

None of these claim a fix on their own -- read `../../wave13-q1check.md` for
the conclusion.
