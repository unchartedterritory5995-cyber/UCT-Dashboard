"""Rails for tools/notebook_switch_rehearsal.py (wave 10, lane 10C, ruling R-11).

The tool's sandbox run is evidence (docs/notebook/rehearsal-2026-09-26.md); these rails pin the
PURE parts that decide what that evidence means and what the controller is told to type:

  * the capability table is DERIVED from auth.NOTEBOOK_FLAGS, every payload switch is a row, and a
    rehearsed ROUTE gate's polarity is the gate's own (read with the variable unset and set);
  * every Notebook gate the repo's gate index finds is rehearsed or carries a written reason;
  * every door the tool knocks on is a route the app really registers (with a non-vacuity control);
  * the judge fails on ANY disagreement and never passes an unmeasured surface;
  * the boot plan isolates each switch (a single-switch-off boot differs in exactly that key);
  * the production commands come from the RECORD, delete before the one --set, and are TEXT:
    the tool has no way to run `railway` at all;
  * `--verify` refuses any account but the smoke account for production, before any network.
"""
from __future__ import annotations

import ast
import datetime as dt
import importlib.util
import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "notebook_switch_rehearsal.py"


def _tool():
    spec = importlib.util.spec_from_file_location("switch_rehearsal", TOOL)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod        # a @dataclass resolves its module through sys.modules
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def t():
    return _tool()


@pytest.fixture(scope="module")
def table(t):
    return t.rehearsal_table(t.capability_table()[0])


def _truthful(t, values, table):
    """The observation a correct app would produce for `values`."""
    obs = {"payload": {}, "rendered": {}, "doors": {}}
    for s in t.SWITCHES:
        on = t.parse_value(values.get(s.env), table[s.env])
        if s.payload:
            obs["payload"][t.payload_key(s.env)] = on
        obs["rendered"][s.rendered] = on
        if s.door:
            obs["doors"][s.env] = s.door_on if on else t.DOOR_OFF
    for env, raw in values.items():
        if env not in {s.env for s in t.SWITCHES}:
            obs["payload"][t.payload_key(env)] = t.parse_value(raw, table.get(env, False))
    return obs


# ── derivation ──────────────────────────────────────────────────────────────────────────────

def test_the_table_is_the_apps_own_table(t):
    from api.routers import auth
    payload_table, modes = t.capability_table()
    assert payload_table == {k: bool(v) for k, v in auth.NOTEBOOK_FLAGS.items()}
    assert modes == list(auth.NOTEBOOK_MODE_FLAGS)
    for env in payload_table:
        assert t.payload_key(env) == auth._notebook_flag_key(env)


def test_every_rehearsed_switch_is_a_real_gate(t, table):
    payload_table, _ = t.capability_table()
    names = [s.env for s in t.SWITCHES]
    assert len(names) == len(set(names)) == 6
    assert all(s.env in payload_table for s in t.SWITCHES if s.payload)
    route = [s.env for s in t.SWITCHES if not s.payload]
    assert route and set(route) <= set(t.notebook_gates_in_index())
    assert len({s.rendered for s in t.SWITCHES}) == len(t.SWITCHES)
    # the one kill switch is rehearsed, and its ON value is UNSET (production's own state)
    assert t.switch_value("NOTEBOOK_OFFLINE_DEFAULT_ON", table, True) is None
    assert t.switch_value("J2_SHARE_LINKS_ENABLED", table, True) == "1"


def test_a_route_gates_polarity_is_the_gates_own(t, table, monkeypatch):
    from api.services.journal_two import note_personal_api as papi
    monkeypatch.delenv("NOTEBOOK_PERSONAL_API_ENABLED", raising=False)
    assert table["NOTEBOOK_PERSONAL_API_ENABLED"] is papi.personal_api_enabled() is False
    monkeypatch.setenv("NOTEBOOK_PERSONAL_API_ENABLED", "1")
    assert papi.personal_api_enabled() is True
    assert t.switch_value("NOTEBOOK_PERSONAL_API_ENABLED", table, True) == "1"


def test_every_notebook_gate_is_rehearsed_or_carries_a_reason(t, table):
    """A gate added tomorrow reds here until someone writes a probe or a reason."""
    _, modes = t.capability_table()
    found = t.notebook_gates_in_index()
    # non-vacuity: the index sees gates from both kinds of read site
    assert "NOTEBOOK_SEMANTIC_SEARCH_ENABLED" in found and "J2_SHARE_LINKS_ENABLED" in found
    skipped = t.not_rehearsed(table, modes)
    assert not [k for k, why in skipped.items() if why == "no rendered probe written"], skipped
    rehearsed = {s.env for s in t.SWITCHES}
    assert set(found) <= rehearsed | set(skipped)


# ── merge review m-3: a reason is a claim, so the rail reads it ───────────────────────────────────────
# A citation is `<repo path>` (the file must exist) optionally followed by ` (<names>)`: each name a bare identifier
# (a pytest `def`, or a vitest title written as one) or a quoted vitest title ('...'). Each name must be a test in
# that file. A reason that begins "armed" names a gate the ledger records as armed (and "armed on web" one armed on
# web); one that begins "dark" names a gate the ledger does not record as armed.
import re as _re

_CITE = _re.compile(r"((?:app|tests|tools|docs|api|scripts)/[\w./-]+?\.(?:py|jsx|js|mjs|md|json))(?![\w.])")
_NAME = _re.compile(r"\s*(?:'([^']*)'|([A-Za-z_]\w*))\s*(,|$)")


def _cited_names(text: str, at: int):
    """The ` (<names>)` group right after a path ending at `at`: (names, problem). No group: ([], None)."""
    if not text.startswith(" (", at):
        return [], None
    depth, i, quote = 0, at + 1, False
    while i < len(text):
        ch = text[i]
        if ch == "'":
            quote = not quote
        elif not quote and ch == "(":
            depth += 1
        elif not quote and ch == ")":
            depth -= 1
            if depth == 0:
                break
        i += 1
    inner = text[at + 2:i]
    names, pos = [], 0
    while pos < len(inner):
        m = _NAME.match(inner, pos)
        if not m or m.end() == pos:
            return names, f"not a test name list: ({inner})"
        names.append(m.group(1) if m.group(1) is not None else m.group(2))
        pos = m.end()
    return names, None


def _test_block(path: Path, name: str) -> str | None:
    """The text of the cited test (its def / it(...) line up to the next test), or None when there is no such test."""
    src = path.read_text(encoding="utf-8")
    if path.suffix == ".py":
        m = _re.search(rf"^(\s*)def {_re.escape(name)}\(", src, _re.M)
        nxt = _re.compile(r"^\s*(?:@|def )", _re.M)
    else:
        m = _re.search(r"\b(?:it|test|describe)(?:\.\w+)?\(\s*(['\"`])" + _re.escape(name) + r"\1", src)
        nxt = _re.compile(r"^\s*(?:it|test|describe)(?:\.\w+)?\(", _re.M)
    if m is None:
        return None
    after = nxt.search(src, m.end())
    return src[m.start():after.start() if after else len(src)]


def _has_test(path: Path, name: str) -> bool:
    return _test_block(path, name) is not None


def _is_test_file(rel: str) -> bool:
    return bool(_re.search(r"(^tests/test_\w+\.py$)|(\.test\.(?:jsx|js|mjs)$)", rel))


_GATE_NAME = _re.compile(r"\bNOTEBOOK_[A-Z0-9_]+?_(?:ENABLED|ON)\b|\bnotebook_[a-z0-9_]+?_(?:enabled|on)\b")
_FALSY = r"(?:0|false|no|off)"
_TRUTHY = r"(?:1|true|yes|on)"


def _gates_named(src: str) -> set[str]:
    return {g.upper() for g in _GATE_NAME.findall(src)}


def _fixture_blocks(path: Path, src: str, block: str) -> str:
    """For a pytest block: the bodies of the fixtures it takes (by parameter name) and of the file's autouse
    fixtures, read from the file and from tests/conftest.py. What the test runs under, not only its own lines."""
    sig = _re.match(r"\s*def \w+\(([^)]*)\)", block)
    params = {p.split(":")[0].split("=")[0].strip() for p in (sig.group(1).split(",") if sig else [])} - {""}
    out = []
    for text in (src, (REPO / "tests" / "conftest.py").read_text(encoding="utf-8")):
        for m in _re.finditer(r"^@pytest\.fixture(\([^)]*\))?\s*\ndef (\w+)\(", text, _re.M):
            if m.group(2) in params or "autouse=True" in (m.group(1) or ""):
                after = _re.compile(r"^(?:@|def )", _re.M).search(text, m.end())
                out.append(text[m.start():after.start() if after else len(text)])
    return "\n".join(out)


def _gate_evidence(src: str, block: str, env: str, rel: str, path: Path, mode: bool) -> str | None:
    """W11-R71 / W11-R72: the cited TEST is evidence for THIS gate, with the gate OFF. None when it is, else why not.
      * It names the gate: the env name or payload key, or a constant of the file that holds one
        (`W11 = "NOTEBOOK_..."`, `const W4 = {notebook_widgets_w4_enabled: true}`), in the test's own block or (pytest)
        a fixture it runs under. A single-gate pytest file may name it at file level only (its fixtures set it); a
        file naming two or more gates may not (m-6 a: the W6 reason citing the W1 test in a two-wave file).
      * It shows the gate OFF (m-6 b): a false / "0" latch or set, a delenv, or no set at all (default off). A block
        whose only set of the gate is ON is not off evidence. A MODE's citations are not on/off evidence."""
    key = env.lower()
    py = rel.endswith(".py")
    scope = block + "\n" + _fixture_blocks(path, src, block) if py else block
    aliases, truthy_c, falsy_c = set(), set(), set()
    for m in _re.finditer(r"^\s*(?:export\s+)?(?:const|let)?\s*([A-Za-z_]\w*)\s*=\s*(.*)$", src, _re.M):
        name, val = m.group(1), m.group(2)
        if _re.fullmatch(rf"""\s*["']{env}["']\s*""", val):
            aliases.add(name)
        if _re.search(rf"\b{key}\s*:\s*true\b", val):
            truthy_c.add(name)
        if _re.search(rf"\b{key}\s*:\s*false\b", val):
            falsy_c.add(name)
    used = lambda names: any(_re.search(rf"\b{_re.escape(n)}\b", scope) for n in names)
    named = env in scope or key in scope or used(aliases | truthy_c | falsy_c)
    if not named:
        if py and len(_gates_named(src)) < 2 and (env in src or key in src):
            pass                                     # a single-gate pytest file: its fixtures set the one gate
        else:
            return "never names"
    if mode:
        return None
    ref = "(?:" + "|".join([_re.escape(f'"{env}"'), _re.escape(f"'{env}'"), *map(_re.escape, sorted(aliases))]) + ")"
    falsy = (_re.search(rf"\b{key}\s*:\s*false\b", scope) or used(falsy_c)
             or _re.search(rf"delenv\(\s*{ref}", scope)
             or _re.search(rf"""setenv\(\s*{ref}\s*,\s*["']{_FALSY}["']""", scope, _re.I))
    truthy = (_re.search(rf"\b{key}\s*:\s*true\b", scope) or used(truthy_c)
              or _re.search(rf"""setenv\(\s*{ref}\s*,\s*["']{_TRUTHY}["']""", scope, _re.I))
    if truthy and not falsy:
        return "only ever turns it ON"
    return None


_STATUS = _re.compile(r"^(?:a MODE, )?(armed|dark|live)\b")
_UNTIL = _re.compile(r"\buntil (\d+[A-Z]+-\d+)\b")


def reason_problems(reasons: dict, ledger: dict, repo: Path = REPO) -> list[str]:
    out = []
    armed_lanes_note = [(e.get("note") or "") for e in ledger.values() if (e or {}).get("status") == "armed"]
    for env, why in reasons.items():
        for m in _CITE.finditer(why):
            rel = m.group(1)
            path = repo / rel
            if not path.is_file():
                out.append(f"{env}: cites {rel}, which does not exist")
                continue
            names, problem = _cited_names(why, m.end())
            if problem:
                out.append(f"{env}: {rel} {problem}")
            src = path.read_text(encoding="utf-8")
            for n in names:
                block = _test_block(path, n)
                if block is None:
                    out.append(f"{env}: {rel} has no test named {n!r}")
                elif _is_test_file(rel):
                    why_not = _gate_evidence(src, block, env, rel, path, why.startswith("a MODE"))
                    if why_not == "never names":
                        out.append(f"{env}: {rel} test {n!r} never names {env} or {env.lower()}")
                    elif why_not:
                        out.append(f"{env}: {rel} test {n!r} {why_not}: it is not evidence of the gate OFF")
            if not names and _is_test_file(rel) and env not in src and env.lower() not in src:
                out.append(f"{env}: {rel} never names {env} or {env.lower()}")
        e = ledger.get(env) or {}
        status, where = e.get("status"), e.get("where") or []
        st = _STATUS.match(why)
        if st is None:
            out.append(f"{env}: the reason opens with no status (armed, dark, or a MODE's armed / dark / live)")
        elif st.group(1) == "armed":
            if status != "armed":
                out.append(f"{env}: the reason says armed, the ledger says {status!r}")
            if why[st.end():].startswith(" on web") and "web" not in where:
                out.append(f"{env}: the reason says armed on web, the ledger's where is {where!r}")
        elif st.group(1) == "dark" and status == "armed":
            out.append(f"{env}: the reason says dark, the ledger says armed")
        elif st.group(1) == "live":
            parent = _re.search(r"\bsince ([A-Z][A-Z0-9_]+) armed\b", why)
            if not why.startswith("a MODE, "):
                out.append(f"{env}: only a MODE can be live; a gate is armed or dark")
            elif parent is None or (ledger.get(parent.group(1)) or {}).get("status") != "armed":
                out.append(f"{env}: a live MODE must name the armed gate it rides ('since <GATE> armed')")
        for lane in _UNTIL.findall(why):
            if any(f"lane {lane}" in note for note in armed_lanes_note):
                out.append(f"{env}: 'until {lane}', but the ledger records lane {lane}'s gate as armed")
    return out


def test_every_reason_cites_real_tests_and_states_the_ledgers_status(t):
    reasons = t.NOT_REHEARSED
    cited = sum(len(list(_CITE.finditer(w))) for w in reasons.values())
    assert cited >= 20                                                        # non-vacuity: citations were parsed
    assert all(_STATUS.match(w) for w in reasons.values())                    # every reason states a status
    assert reason_problems(reasons, t.ledger_flags()) == []


def test_the_reason_rail_can_fail(t):
    """Controls, one per check: a fake test name, a missing file, a prose group, both flipped statuses, a cited test
    that exists but never names the gate (the original m-2 defect, re-planted), a stale 'until <lane>', a reason with
    no status, a live MODE whose gate is not armed, and a gate called live."""
    ledger = t.ledger_flags()
    w1 = t.NOT_REHEARSED["NOTEBOOK_WIDGETS_W1_ENABLED"]
    assert reason_problems({"NOTEBOOK_WIDGETS_W1_ENABLED": w1}, ledger) == []         # the real one is clean
    sm = "app/src/pages/journal-2-0/components/notebook/SlashMenu.items.test.jsx"
    bad = {
        "NOTEBOOK_WIDGETS_W1_ENABLED": w1.replace("test_gate_off_404", "test_no_such_test_here"),
        "NOTEBOOK_WIDGETS_W2_ENABLED": "armed on web: see tests/test_no_such_file.py (test_x)",
        "NOTEBOOK_WIDGETS_W3_ENABLED": "armed on web: tests/test_notebook_widgets_e2e.py (some prose, it says)",
        "NOTEBOOK_WIDGETS_W11_ENABLED": "armed on web: flipped",
        "NOTEBOOK_WIDGETS_W10_ENABLED": "dark: flipped",
        # the m-2 defect: a real test, in a file that names W4 elsewhere, whose own block never does
        "NOTEBOOK_WIDGETS_W4_ENABLED": f"armed on web: its off evidence is {sm} ('a wave turns on only its own kinds')",
        "NOTEBOOK_TA_FINGERPRINT_ENABLED": "armed on web: the API; no member surface until 13I-2",
        "NOTEBOOK_ASK_INSERT_ON": "payload only: no status word",
        "NOTEBOOK_SEMANTIC_PROVIDER": "a MODE, live since NOTEBOOK_WIDGETS_W11_ENABLED armed",
        "NOTEBOOK_CHART_PLAN_ENABLED": "live: a gate is never live",
    }
    got = reason_problems(bad, ledger)
    expect = {
        "NOTEBOOK_WIDGETS_W1_ENABLED": "test_no_such_test_here",
        "NOTEBOOK_WIDGETS_W2_ENABLED": "test_no_such_file.py, which does not exist",
        "NOTEBOOK_WIDGETS_W3_ENABLED": "not a test name list",
        "NOTEBOOK_WIDGETS_W11_ENABLED": "the reason says armed",
        "NOTEBOOK_WIDGETS_W10_ENABLED": "the reason says dark",
        "NOTEBOOK_WIDGETS_W4_ENABLED": "never names NOTEBOOK_WIDGETS_W4_ENABLED",
        "NOTEBOOK_TA_FINGERPRINT_ENABLED": "'until 13I-2'",
        "NOTEBOOK_ASK_INSERT_ON": "opens with no status",
        "NOTEBOOK_SEMANTIC_PROVIDER": "a live MODE must name the armed gate",
        "NOTEBOOK_CHART_PLAN_ENABLED": "only a MODE can be live",
    }
    for env, words in expect.items():
        assert any(g.startswith(f"{env}:") and words in g for g in got), (env, got)
    # the W4 control is the block check, not the file: the same file DOES name W4 elsewhere
    assert "notebook_widgets_w4_enabled" in (REPO / sm).read_text(encoding="utf-8")
    # W11-R72 (m-6): the reviewer's three wrong-wave citations, each live in a multi-wave file, each red.
    replant = {
        "NOTEBOOK_WIDGETS_W6_ENABLED": "armed on web: tests/test_notebook_widgets_router.py (test_gate_off_404)",
        "NOTEBOOK_WIDGETS_W3_ENABLED":
            "armed on web: tests/test_notebook_widgets_e2e.py (test_wave2_routes_are_dark_without_their_flag)",
        "NOTEBOOK_WIDGETS_W2_ENABLED":
            f"armed on web: {sm} ('bare_slash_groups_in_order: the menu shows the five moment labels in order')",
    }
    got = reason_problems(replant, ledger)
    assert any(g.startswith("NOTEBOOK_WIDGETS_W6_ENABLED:") and "never names" in g for g in got), got
    assert any(g.startswith("NOTEBOOK_WIDGETS_W3_ENABLED:") and "never names" in g for g in got), got
    assert any(g.startswith("NOTEBOOK_WIDGETS_W2_ENABLED:") and "only ever turns it ON" in g for g in got), got
    # the two files name two or more gates, so the pytest file-level allowance does not apply to them
    for rel in ("tests/test_notebook_widgets_router.py", "tests/test_notebook_widgets_e2e.py"):
        assert len(_gates_named((REPO / rel).read_text(encoding="utf-8"))) >= 2, rel


def test_every_door_is_a_route_the_app_registers(t):
    from api.routers import (notebook_onboarding, notebook_personal_api, notebook_publish,
                             notebook_shares, notebook_writing_help)
    paths = set()
    for mod in (notebook_onboarding, notebook_personal_api, notebook_publish, notebook_shares,
                notebook_writing_help):
        for r in mod.router.routes:
            for m in getattr(r, "methods", set()):
                paths.add((m, r.path))
    # non-vacuity: a sibling route the tool does NOT use is seen, so an empty read cannot pass
    assert ("DELETE", "/api/j2/onboarding/sample-notebook") in paths
    for s in t.SWITCHES:
        if not s.door:
            continue
        method, path, _body = s.door
        assert (method, path.replace("{note}", "{note_id}")) in paths, s.env


def test_parse_value_is_flag_ons_rule(t, monkeypatch):
    from api.services.notebook_flags import flag_on
    for raw in (None, "1", "0", "true", "FALSE", " yes ", "off", "flase", ""):
        for default in (True, False):
            if raw is None:
                monkeypatch.delenv("W10C_PARSE_PROBE", raising=False)
            else:
                monkeypatch.setenv("W10C_PARSE_PROBE", raw)
            assert t.parse_value(raw, default) == flag_on("W10C_PARSE_PROBE", default), (raw, default)


# ── the judge ───────────────────────────────────────────────────────────────────────────────

def test_a_truthful_observation_passes_for_every_boot(t, table):
    plan = t.boot_plan(table, ["NOTEBOOK_ASK_INSERT_ON"])
    assert len(plan) == 3 + len(t.SWITCHES)
    for name, values in plan:
        rows = t.judge(values, _truthful(t, values, table), table)
        assert t.overall([r["verdict"] for r in rows]) == "PASS", (name, rows)


@pytest.mark.parametrize("field", ["payload", "rendered", "doors"])
def test_any_single_disagreement_fails(t, table, field):
    _name, values = t.boot_plan(table, [])[1]            # all-off
    tried = 0
    for s in t.SWITCHES:
        if (field == "doors" and not s.door) or (field == "payload" and not s.payload):
            continue
        obs = _truthful(t, values, table)
        if field == "payload":
            obs["payload"][t.payload_key(s.env)] = True
        elif field == "rendered":
            obs["rendered"][s.rendered] = True
        else:
            obs["doors"][s.env] = s.door_on
        rows = {r["switch"]: r for r in t.judge(values, obs, table)}
        assert rows[s.env]["verdict"] == "FAIL", (field, s.env)
        tried += 1
    assert tried >= 4


def test_an_unmeasured_surface_is_inconclusive_never_a_pass(t, table):
    _name, values = t.boot_plan(table, [])[0]
    obs = _truthful(t, values, table)
    obs["rendered"]["offline_store"] = None
    rows = {r["switch"]: r for r in t.judge(values, obs, table)}
    assert rows["NOTEBOOK_OFFLINE_DEFAULT_ON"]["verdict"] == "INCONCLUSIVE"
    assert t.overall([r["verdict"] for r in rows.values()]) == "INCONCLUSIVE"
    assert t.overall([]) == "INCONCLUSIVE"


def test_the_plan_isolates_each_switch(t, table):
    plan = dict(t.boot_plan(table, ["NOTEBOOK_ASK_INSERT_ON"]))
    assert list(plan)[:3] == ["production-values", "all-off", "restored"]
    assert all(v == "0" for v in plan["all-off"].values())
    assert plan["restored"] == plan["production-values"]
    for s in t.SWITCHES:
        diff = {k for k, v in plan[f"only-{s.env}-off"].items() if plan["production-values"][k] != v}
        assert diff == {s.env}


# ── the production window: derived from the RECORD, printed as TEXT ─────────────────────────

def test_the_off_set_follows_the_record_over_the_ledger(t, table):
    record = {"J2_SHARE_LINKS_ENABLED": "1", "NOTEBOOK_PUBLISH_ENABLED": "0",
              "NOTEBOOK_ATTACHMENTS_ON": "true", "NOTEBOOK_PERSONAL_API_ENABLED": "1"}
    keys = t.off_set(table, record, armed=["NOTEBOOK_PUBLISH_ENABLED"])
    assert "J2_SHARE_LINKS_ENABLED" in keys
    assert "NOTEBOOK_ATTACHMENTS_ON" in keys          # ON in production though the ledger says dark
    assert "NOTEBOOK_PERSONAL_API_ENABLED" in keys    # a route gate, switched when production has it on
    assert "NOTEBOOK_PUBLISH_ENABLED" not in keys     # OFF in production though the ledger says armed
    assert "NOTEBOOK_OFFLINE_DEFAULT_ON" in keys      # the kill switch always
    # W14-C1: the task-reminder kill switch joined the payload table, so the window's "every
    # kill switch" names it too (verified through its payload key, like every payload key).
    assert t.off_set(table, None, armed=["NOTEBOOK_PUBLISH_ENABLED"]) == [
        "NOTEBOOK_OFFLINE_DEFAULT_ON", "NOTEBOOK_PUBLISH_ENABLED", "NOTEBOOK_TASK_REMINDERS_ENABLED"]


def test_the_restore_deletes_first_then_one_set(t):
    record = {"J2_SHARE_LINKS_ENABLED": "1", "NOTEBOOK_WRITING_HELP_ENABLED": "true"}
    keys = ["NOTEBOOK_OFFLINE_DEFAULT_ON", "J2_SHARE_LINKS_ENABLED", "NOTEBOOK_WRITING_HELP_ENABLED"]
    steps = t.restore_steps(keys, record)
    assert steps == [
        "railway variable delete NOTEBOOK_OFFLINE_DEFAULT_ON --service web",
        'railway variables --service web --set "J2_SHARE_LINKS_ENABLED=1" '
        '--set "NOTEBOOK_WRITING_HELP_ENABLED=true"',
    ]
    # nothing to --set: a delete does not redeploy, so the redeploy is the step that applies it
    assert t.restore_steps(["NOTEBOOK_OFFLINE_DEFAULT_ON"], {})[-1] == "railway redeploy --service web --yes"


def test_the_production_text_is_one_off_command_and_names_the_record(t, table):
    _, modes = t.capability_table()
    text = t.production_text(table, modes, ["J2_SHARE_LINKS_ENABLED"])
    sets = [ln for ln in text.splitlines() if ln.strip().startswith("railway variables --service web --set")]
    assert len(sets) == 1 and '"NOTEBOOK_OFFLINE_DEFAULT_ON=0"' in sets[0]
    assert "--check-record" in text and "--kv" in text and "NOTEBOOK_DOOR_GUARD" in text
    assert "NOTEBOOK_INBOUND_EMAIL_ENABLED:" in text    # a gate the window skips is NAMED, with why
    assert '"NOTEBOOK_TASK_REMINDERS_ENABLED=0"' in sets[0]  # W14-C1: a payload kill switch now
    for s in t.SWITCHES:                                # every door --verify reads is named
        if s.door and s.door[0] == "GET":
            assert s.door[1] in text, s.door[1]


def test_the_tool_cannot_run_railway(t):
    """The production half is the controller's: the tool has no process-spawning call at all."""
    tree = ast.parse(TOOL.read_text(encoding="utf-8"))
    imported = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                for a in n.names} | {n.module.split(".")[0] for n in ast.walk(tree)
                                     if isinstance(n, ast.ImportFrom) and n.module}
    assert "subprocess" not in imported
    calls = {ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
    assert not any(c in ("os.system", "os.popen", "os.execv", "os.spawnv") for c in calls)
    assert "json.loads" in calls  # non-vacuity: the call walk sees the tool's real calls


def test_read_record_takes_key_value_lines_only(t):
    rec = t.read_record("Warning: something\nJ2_SHARE_LINKS_ENABLED=1\n# comment\nURL=https://a=b\n\n")
    assert rec == {"J2_SHARE_LINKS_ENABLED": "1", "URL": "https://a=b"}
    assert t.read_record("") == {}


# ── --verify ────────────────────────────────────────────────────────────────────────────────

def test_verify_verdict(t):
    want = {"J2_SHARE_LINKS_ENABLED": False, "NOTEBOOK_OFFLINE_DEFAULT_ON": False,
            "NOTEBOOK_PERSONAL_API_ENABLED": False}
    payload_envs = {"J2_SHARE_LINKS_ENABLED", "NOTEBOOK_OFFLINE_DEFAULT_ON"}
    me = {"j2_share_links_enabled": False, "notebook_offline_default_on": False}
    doors = {"J2_SHARE_LINKS_ENABLED": 404, "NOTEBOOK_PERSONAL_API_ENABLED": 404}
    now = 1_000_000.0
    set_at = dt.datetime.fromtimestamp(now - 200, dt.timezone.utc).isoformat()

    def v(**kw):
        a = {"me": me, "doors": doors, "uptime": 90, "set_at": set_at}
        a.update(kw)
        return t.verify_verdict("off", want, payload_envs, a["me"], a["doors"], a["uptime"],
                                a["set_at"], now=now)

    verdict, lines = v()
    assert verdict == "PASS" and any(ln.startswith("NEW BOOT") for ln in lines)
    assert any("/api/j2/personal/tokens = 404" in ln for ln in lines)   # a route gate's door is read
    assert v(uptime=900)[0] == "FAIL"                  # the pod predates the --set: no new boot
    assert v(me={**me, "j2_share_links_enabled": True})[0] == "FAIL"
    assert v(doors={**doors, "J2_SHARE_LINKS_ENABLED": 200})[0] == "FAIL"
    assert v(doors={**doors, "NOTEBOOK_PERSONAL_API_ENABLED": 200})[0] == "FAIL"
    assert v(me=None)[0] == "INCONCLUSIVE"
    naive = dt.datetime.fromtimestamp(now - 200, dt.timezone.utc).replace(tzinfo=None).isoformat()
    assert v(set_at=naive)[0] == "PASS"               # a bare stamp is read as UTC


def test_verify_refuses_any_account_but_the_smoke_account_for_production(t, monkeypatch, capsys):
    def boom(*a, **k):
        raise AssertionError("no network before the refusal")
    monkeypatch.setattr(t, "verify_run", boom)
    monkeypatch.setenv("SMOKE_EMAIL", "someone@gmail.com")
    monkeypatch.setenv("SMOKE_PASSWORD", "x")
    assert t.main(["--verify", "https://uctintelligence.com", "--expect", "off"]) == 3
    assert "smoke account only" in capsys.readouterr().out
    monkeypatch.delenv("SMOKE_EMAIL")
    assert t.main(["--verify", "https://uctintelligence.com", "--expect", "off"]) == 3
    monkeypatch.setenv("SMOKE_EMAIL", "smoke@uctintelligence.internal")
    monkeypatch.delenv("SMOKE_PASSWORD")
    assert t.main(["--verify", "https://uctintelligence.com", "--expect", "off"]) == 3


def test_check_record_refuses_an_empty_read(t, tmp_path, capsys):
    p = tmp_path / "rec.txt"
    p.write_text("", encoding="utf-8")
    assert t.main(["--check-record", str(p)]) == 3
    p.write_text("J2_SHARE_LINKS_ENABLED=1\nNOTEBOOK_DOOR_GUARD=unknown-only\n", encoding="utf-8")
    assert t.main(["--check-record", str(p)]) == 0
    out = capsys.readouterr().out
    assert out.count("NOTEBOOK_DOOR_GUARD = unknown-only") == 1
    assert "railway variable delete NOTEBOOK_OFFLINE_DEFAULT_ON --service web" in out
    assert '--set "J2_SHARE_LINKS_ENABLED=1"' in out


# ── the switch values reach the SANDBOX CHILD, never this process's environment ──────────────

def test_a_boot_launcher_sets_the_values_in_the_child_and_runs_the_real_launcher(t, tmp_path):
    values = {"J2_SHARE_LINKS_ENABLED": "0", "NOTEBOOK_OFFLINE_DEFAULT_ON": None}
    src = t.launcher_source(values, real=tmp_path / "real_launcher.py")
    (tmp_path / "real_launcher.py").write_text(
        "import json, os, sys\n"
        "json.dump({'share': os.environ.get('J2_SHARE_LINKS_ENABLED'),"
        " 'offline': os.environ.get('NOTEBOOK_OFFLINE_DEFAULT_ON'), 'argv': sys.argv[1:]},"
        " open(os.environ['W10C_LAUNCHER_PROBE'], 'w'))\n", encoding="utf-8")
    gen = tmp_path / "boot.launcher.py"
    gen.write_text(src, encoding="utf-8")
    probe = tmp_path / "probe.json"
    import json as _json
    import subprocess
    env = {**os.environ, "W10C_LAUNCHER_PROBE": str(probe), "NOTEBOOK_OFFLINE_DEFAULT_ON": "1"}
    subprocess.run([sys.executable, str(gen), "--data-dir", "X", "--port", "1"], env=env, check=True)
    got = _json.loads(probe.read_text(encoding="utf-8"))
    assert got == {"share": "0", "offline": None, "argv": ["--data-dir", "X", "--port", "1"]}


def test_the_tool_writes_no_environment_of_its_own(t):
    """The bridges rail's rule for a tool that imports api, restated at the call site."""
    tree = ast.parse(TOOL.read_text(encoding="utf-8"))
    writes = [n.lineno for n in ast.walk(tree)
              if isinstance(n, ast.Subscript) and isinstance(n.ctx, ast.Store)
              and ast.unparse(n.value) == "os.environ"]
    calls = [n.lineno for n in ast.walk(tree) if isinstance(n, ast.Call)
             and ast.unparse(n.func) in ("os.environ.pop", "os.environ.update", "os.environ.setdefault",
                                         "os.putenv")]
    assert writes == [] and calls == [], (writes, calls)
    assert "SET = " in t.launcher_source({"X": "1"}), "the child's launcher is where the values go"


# ── step 0 records ONLY the window's Notebook keys, OUTSIDE the checkout (fix round 1 item 5) ─

_KV = ("STRIPE_SECRET_KEY=sk_live_PLANTED_SECRET\nPUSH_SECRET=planted-push-secret\n"
       "J2_SHARE_LINKS_ENABLED=1\nNOTEBOOK_PUBLISH_ENABLED=1\nNOTEBOOK_DOOR_GUARD=unknown-only\n"
       "NOTEBOOK_PERSONAL_API_ENABLED=1\nANTHROPIC_API_KEY=sk-ant-PLANTED\n")


def test_step_zero_pipes_the_kv_and_saves_outside_the_checkout(t, table):
    _, modes = t.capability_table()
    text = t.production_text(table, modes, ["J2_SHARE_LINKS_ENABLED"])
    step0 = next(ln for ln in text.splitlines() if "railway variables --service web --kv" in ln)
    assert "--kv |" in step0 and "--check-record -" in step0 and "--save-record" in step0, step0
    assert ">" not in step0.replace("<UTC>", ""), (
        "the --kv output is redirected to a file -- every web secret on disk")
    assert t.RECORD_PATH.startswith("$env:TEMP\\"), t.RECORD_PATH
    assert f'Remove-Item "{t.RECORD_PATH}"' in text, "no deletion step for the record"
    assert text.count(t.RECORD_PATH) >= 3            # saved, verified against, deleted


def test_the_saved_record_holds_only_notebook_keys(t, tmp_path, monkeypatch, capsys):
    import io
    dest = tmp_path / "outside" / "rec.txt"
    monkeypatch.setattr(sys, "stdin", io.StringIO(_KV))
    assert t.main(["--check-record", "-", "--save-record", str(dest)]) == 0
    saved = dest.read_text(encoding="utf-8")
    out = capsys.readouterr().out
    for secret in ("PLANTED", "planted-push-secret", "STRIPE", "PUSH_SECRET", "ANTHROPIC"):
        assert secret not in saved, f"{secret} reached the record"
        assert secret not in out, f"{secret} reached the terminal"
    assert "J2_SHARE_LINKS_ENABLED=1" in saved and "NOTEBOOK_PERSONAL_API_ENABLED=1" in saved
    assert "NOTEBOOK_DOOR_GUARD" not in saved, "a key the window does not touch was recorded"


def test_a_record_path_inside_the_repository_is_refused(t, monkeypatch, capsys):
    import io
    inside = REPO / "tests" / "_w10c_record_must_not_exist.txt"
    monkeypatch.setattr(sys, "stdin", io.StringIO(_KV))
    try:
        assert t.main(["--check-record", "-", "--save-record", str(inside)]) == 3
        assert not inside.exists()
        assert "inside the repository" in capsys.readouterr().out
    finally:
        if inside.exists():
            inside.unlink()
