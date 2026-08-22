"""Rails for the four Wave-2 nightly job registrations in `register_screener_jobs`
(api/main.py): finviz universe, earnings dates, insider capture, analyst pass.

The desk-audit idiom (see `tests/test_desk_session_audit.py`): an AST over
`api/main.py` finds every literal `id=` on an `add_job(...)` call -- never a
grep, which would also match the comment above the call and this docstring
(`lesson_probe_names_must_be_derived_not_typed`). A non-vacuity control proves
the probe can see a sibling job it isn't looking for (`screener_snapshot_nightly`)
and is honest about a made-up id it should never see.
"""
import ast


def _add_job_ids():
    src = open("api/main.py", encoding="utf-8").read()
    tree = ast.parse(src)
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            for kw in node.keywords or ():
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    ids.add(kw.value.value)
    return ids


def test_wave2_jobs_are_registered():
    ids = _add_job_ids()
    assert "screener_snapshot_nightly" in ids          # control: probe sees
    assert "definitely_not_a_job" not in ids           # control: probe honest
    for jid in ("screener_finviz_universe", "screener_earnings_dates",
                "screener_insider_capture", "screener_analyst_pass",
                "screener_opt_flow_pull"):
        assert jid in ids, jid
