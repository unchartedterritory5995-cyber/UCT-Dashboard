"""🔴 THE WEEKLY IPO MAINTENANCE ACTUALLY HAS A WEEK.

`api/services/ipo_maintenance.py::run_ipo_maintenance` documents itself as
*"Runs on a schedule (weekly)"* and was in **no scheduler, with zero callers**
anywhere in `api/`, `tools/`, `scripts/` or `tests/` — only the module's
`IPO_DATES` constant was ever consumed. Reachability audit §3e.

⛔ A SCHEDULED FUNCTION WITH NO SCHEDULE IS A LIE IN A DOCSTRING, and this repo
has already paid for that exact one: a session-insights pass was defined, never
wired into any scheduler, and its deferred deletes had no collector for weeks.

WHY THE RAIL LOOKS AT `api/main.py` AND NOT AT A LIVE SCHEDULER
---------------------------------------------------------------
`_scheduler.add_job` runs inside the FastAPI lifespan, so the job registry does
not exist until the app starts — and starting it to check is a diagnostic that
can take down what it is diagnosing. So the registration is read off the AST of
the file that owns it. ⛔ AN AST, NEVER A GREP
(`lesson_probe_names_must_be_derived_not_typed`: a grep for a name reports the
comment above it and every piece of prose that mentions it — this repo has
measured a probe that "found 5 call sites, all five of them prose"). A grep
would pass on the comment block that sits above the real registration.
"""
import ast
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import ipo_maintenance as ipo  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parent.parent
MAIN = REPO / "api/main.py"
JOB_ID = "ipo_maintenance_weekly"


def _main_tree():
    return ast.parse(MAIN.read_text(encoding="utf-8"))


def _add_job_calls(tree):
    """Every `…add_job(target, …, id="…")` in the file: (job_id, target_name)."""
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not (isinstance(fn, ast.Attribute) and fn.attr in ("add_job", "_add_compass_job")):
            continue
        job_id = None
        for kw in node.keywords:
            if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                job_id = kw.value.value
        target = None
        if node.args:
            a = node.args[0]
            if isinstance(a, ast.Name):
                target = a.id
            elif isinstance(a, ast.Attribute):
                target = a.attr
        out.append((job_id, target))
    return out


# ── the registration ────────────────────────────────────────────────────────

def test_the_weekly_ipo_maintenance_is_registered_in_the_scheduler():
    jobs = _add_job_calls(_main_tree())
    ids = [j for j, _t in jobs]

    # ⛔ NON-VACUITY FIRST. If the AST walk found nothing, every assertion below
    # would be about an empty list.
    assert len(jobs) > 50, (
        f"the add_job scan found only {len(jobs)} registrations; api/main.py "
        f"declares ~95, so this probe has stopped seeing the scheduler")
    assert "cot_weekly_refresh" in ids, (
        "a job known to exist is missing from the scan — the probe is broken, "
        "not the schedule")

    assert JOB_ID in ids, (
        f"`run_ipo_maintenance` documents itself as running weekly and is "
        f"registered in NO scheduler. Its aged-out-IPO digest is never produced, "
        f"so `themes_taxonomy.json`'s `recent_ipos` theme silently keeps holdings "
        f"past their 12-month window forever. Registered job ids: {sorted(i for i in ids if i)}")


def test_the_registered_job_actually_calls_run_ipo_maintenance():
    """A job id proves a registration, not that it does the thing. The target's
    body must reach `run_ipo_maintenance` — asserted by AST over the function
    the registration names, so a stub with the right id fails here."""
    tree = _main_tree()
    # ⛔ ASSERT, DON'T `next()`. A bare generator raises StopIteration when the
    # registration is gone, and "StopIteration" tells the next engineer nothing
    # about what stopped running.
    targets = [t for j, t in _add_job_calls(tree) if j == JOB_ID]
    assert targets, (
        f"no scheduler registration carries the id {JOB_ID!r}, so the weekly "
        f"IPO maintenance has no schedule at all")
    target = targets[0]
    assert target, f"the {JOB_ID} registration names no callable"

    fn = next((n for n in ast.walk(tree)
               if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == target), None)
    assert fn is not None, f"{target} is registered but not defined in api/main.py"

    called = {n.func.attr for n in ast.walk(fn)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "run_ipo_maintenance" in called, (
        f"{target} is scheduled but never calls run_ipo_maintenance — the "
        f"schedule exists and does nothing, which is worse than no schedule "
        f"because the docstring is now true and the behaviour still absent. "
        f"It calls: {sorted(called)}")


# ── the behaviour the schedule is for ───────────────────────────────────────

def test_a_clean_week_sends_nothing():
    """⛔ A weekly ping that always fires is a weekly ping nobody reads."""
    assert ipo.digest_text({"expired": [], "expiring_soon": [], "unknown": []}) == ""


def test_a_week_with_work_names_every_symbol_and_says_what_to_do():
    text = ipo.digest_text({
        "expired": [{"sym": "CRCL", "ipo_date": "2025-06-05", "days_since": 430}],
        "expiring_soon": [{"sym": "BLSH", "ipo_date": "2025-08-13", "days_remaining": 4}],
        "unknown": ["ZZZZ"],
    })
    for token in ("CRCL", "430", "BLSH", "4", "ZZZZ", "recent_ipos", "IPO_DATES"):
        assert token in text, f"the digest never mentions {token}: {text!r}"


def test_the_job_delivers_the_digest_to_a_human(monkeypatch):
    """`lesson_scheduler_job_return_value_goes_nowhere` — a job's return value
    goes nowhere and Railway keeps ~500 log lines, so a log-only weekly job is
    indistinguishable from one that never ran. Count the ARTIFACT."""
    sent = []
    monkeypatch.setattr(ipo, "check_ipo_expirations", lambda: {
        "expired": [{"sym": "CRCL", "ipo_date": "2025-06-05", "days_since": 430}],
        "expiring_soon": [], "unknown": []})
    import api.services.discord_notify as dn
    monkeypatch.setattr(dn, "_send_webhook", lambda embed: sent.append(embed))

    ipo.run_ipo_maintenance()
    assert len(sent) == 1, "the weekly check produced findings and told nobody"
    assert "CRCL" in sent[0]["description"]


def test_a_clean_week_pings_nobody(monkeypatch):
    sent = []
    monkeypatch.setattr(ipo, "check_ipo_expirations", lambda: {
        "expired": [], "expiring_soon": [], "unknown": []})
    import api.services.discord_notify as dn
    monkeypatch.setattr(dn, "_send_webhook", lambda embed: sent.append(embed))

    ipo.run_ipo_maintenance()
    assert sent == []


def test_the_job_never_raises_into_the_scheduler(monkeypatch):
    """A weekly job that throws takes its own next run down with it."""
    monkeypatch.setattr(ipo, "check_ipo_expirations", lambda: {
        "expired": [{"sym": "X", "ipo_date": "2020-01-01", "days_since": 9}],
        "expiring_soon": [], "unknown": []})
    import api.services.discord_notify as dn

    def _boom(_embed):
        raise RuntimeError("discord is down")
    monkeypatch.setattr(dn, "_send_webhook", _boom)
    ipo.run_ipo_maintenance()          # must not raise


def test_it_reads_the_taxonomy_with_an_explicit_encoding():
    """The latent crash that made this job Windows-only-broken: bare `open()`
    uses the LOCALE encoding, and `themes_taxonomy.json` carries non-ASCII, so
    `check_ipo_expirations()` raised UnicodeDecodeError on cp1252 while working
    on Railway. Asserted by AST over every `open(` in the module."""
    tree = ast.parse(pathlib.Path(ipo.__file__).read_text(encoding="utf-8"))
    opens = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "open"]
    assert opens, "no open() call found; this control is vacuous"
    for call in opens:
        assert any(kw.arg == "encoding" for kw in call.keywords), (
            f"open() at line {call.lineno} has no explicit encoding — it will "
            f"decode with whatever the host locale happens to be")


def test_the_real_check_still_runs_end_to_end():
    """One test must exercise the REAL taxonomy read
    (`lesson_injected_dependency_hides_the_fetch`), or every case above is
    measuring a fixture."""
    res = ipo.check_ipo_expirations()
    assert set(res) == {"expired", "expiring_soon", "unknown"}
    assert all(isinstance(v, list) for v in res.values())
