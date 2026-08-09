"""STRUCTURAL RAIL: no LLM client is constructed without an explicit `timeout=`.

This is the gate on `LLM-NO-TIMEOUT` (2026-08-09 performance audit). `anthropic`
and `openai` both default to a **600 s read timeout**, so an unbounded client on
a request path is a ten-minute pin of one of the web pod's 64 shared anyio
workers — the exact mechanism of the 2026-07-01 outage, where an unbounded
blocking call on a universal path made a bare 401 take 24 seconds.

The audit found **11** live ones. One of them — `transcripts.py`, behind
`GET /api/transcripts/{symbol}` — carries no auth dependency at all, only
`@limiter.limit("10/minute")`, so an anonymous caller could open threads and
hold them.

⛔ WHY A RAIL AND NOT A SWEEP. Eleven of these accumulated under a convention.
`engine.py` has set `timeout=60` on the shared client since the 2026-07-01
hardening and nine private clients simply bypassed it. A one-time fix restores
the same unenforced convention that produced the problem, and the twelfth will
land the same way the eleventh did.

⚠️ THE RAIL ENFORCES THAT A VALUE WAS STATED, NEVER WHICH VALUE. A
scheduler-thread pass may legitimately need minutes: the Desk insights chapters
pass runs `DESK_CHAPTERS_LLM_TIMEOUT_SECS` (default 300) via
`client.with_options(timeout=...)` precisely BECAUSE a shared 60 s default broke
it once. Asserting a number here would either re-break that or under-protect the
handlers. Asserting that the author chose one catches the whole class either way
— and `with_options` on an already-bounded client keeps working untouched.

WHY AN AST AND NOT A GREP (`lesson_probe_names_must_be_derived_not_typed`):
every live site is a FUNCTION-LOCAL `import anthropic`, which reads like a normal
import while binding a private copy inside a call frame, and the binding can be
renamed (`from anthropic import Anthropic as Claude` never spells the usual
shape anywhere). Only the syntax tree can say which names construct a client.

The census lives in `tools/llm_timeout_census.py`. Its own correctness is
covered below by POSITIVE CONTROLS — a planted unbounded client must be reported
BY NAME, and the same call with a timeout must clear — because without both,
"0 findings" could just mean the census stopped parsing.
"""
from __future__ import annotations

import textwrap

import pytest

from api.services import llm_timeouts
from tools import llm_timeout_census as cen

BASE = cen.repo_root()


# ── QUARANTINE ───────────────────────────────────────────────────────────────
# `path -> count`, the count being the KNOWN unbounded constructions at listing
# time. A quarantined file is skipped by the "nothing unbounded" assertion but
# MUST NOT GROW, and the count is a CEILING, never an equality — so the rail can
# never punish whoever finally fixes it. Delete the entry once its module is
# clean.
#
# Both entries here are OWNERSHIP quarantines, not technical ones. The fix is one
# keyword argument in each; what is missing is permission, not a plan.
#
#   api/schwab_router.py — partner-owned (`project_partner_collab_branch`: Ravi
#     co-edits OptionsFlow.jsx, schwab_router.py, live_massive_router.py; do not
#     touch without ack). ⚠️ THIS IS THE WORST SITE IN THE CENSUS: an `async def`
#     handler making a BLOCKING `client.messages.create()`, so a hang pins the
#     single shared EVENT LOOP, not merely one of 64 workers. `/market-narrative`
#     is 30-min cached, which bounds the frequency but not the blast radius of
#     one bad call. Needs an ack, then `timeout=llm_timeouts.REQUEST_PATH`.
#
#   api/services/journal_two/coach_chat.py — a Compass fix was in flight on this
#     file on 2026-08-09 and it was explicitly off-limits. It is AGENTIC, so one
#     member request can make several 600s-capable calls in sequence.
QUARANTINE: dict[str, int] = {
    "api/schwab_router.py": 1,
    "api/services/journal_two/coach_chat.py": 2,
}


def _fmt(items) -> str:
    return "\n".join(f"    {c}" for c in items)


# ── the rail ─────────────────────────────────────────────────────────────────

def test_no_llm_client_is_constructed_without_an_explicit_timeout():
    found = cen.census(BASE)
    stray = [c for c in found if c.path not in QUARANTINE]
    assert not stray, (
        "an LLM client is constructed with no `timeout=`, so it inherits the "
        "SDK's 600s read timeout. On a request path that is a ten-minute hold of "
        "one of the pod's 64 anyio workers:\n"
        + _fmt(stray)
        + "\n\n    from api.services import llm_timeouts\n"
        "    anthropic.Anthropic(api_key=k, timeout=llm_timeouts.seconds(\n"
        "        \"MY_SURFACE_LLM_TIMEOUT_SECS\", llm_timeouts.REQUEST_PATH))\n\n"
        "Pick REQUEST_PATH / REQUEST_PATH_LONG / OFFLINE_JOB by where the call "
        "runs. A scheduler pass needing longer overrides PER CALL with "
        "`client.with_options(timeout=...)` — never by unbounding the constructor."
    )


def test_a_quarantined_file_never_grows_a_new_unbounded_client():
    found = cen.census(BASE)
    for path, allowed in QUARANTINE.items():
        here = [c for c in found if c.path == path]
        assert len(here) <= allowed, (
            f"{path} is quarantined at {allowed} known unbounded clients and now "
            f"has {len(here)}:\n" + _fmt(here)
        )


def test_every_quarantined_path_still_has_something_to_quarantine():
    """A stale exemption is a hole nobody can see. When the owner of a
    quarantined file lands its `timeout=`, this fails and tells them to delete
    the entry — so the exemption list can never outlive its reason."""
    found = cen.census(BASE)
    dead = [p for p in QUARANTINE if not any(c.path == p for c in found)]
    assert not dead, (
        "these paths are quarantined but are already clean — delete them from "
        f"QUARANTINE so the rail covers them again: {dead}"
    )


def test_the_census_is_not_vacuous():
    """`0 unbounded` is only good news when the denominator is real. If the
    census stopped resolving SDK bindings it would report nothing forever and
    every assertion above would pass."""
    allc = cen.constructions(BASE)
    assert len(allc) >= 10, (
        f"the census found only {len(allc)} LLM client constructions under api/ "
        "— it has probably stopped resolving bindings"
    )
    bounded = [c for c in allc if c.bounded]
    assert len(bounded) >= 10, (
        "the census reports almost nothing as BOUNDED, so it is likely not "
        "reading `timeout=` at all and the rail passes for the wrong reason"
    )


def test_the_shared_client_that_started_the_convention_is_still_bounded():
    """`engine._get_anthropic_client()` is the one client that was always
    bounded. If it ever loses its timeout the census must say so by name."""
    site = [c for c in cen.constructions(BASE)
            if c.path == "api/services/engine.py"]
    assert site and all(c.bounded for c in site), site


# ── POSITIVE CONTROLS ────────────────────────────────────────────────────────
# Each plants real source in a temp tree and runs the REAL census over it.
# Without these, a census that silently stopped parsing reports 0 findings and
# every assertion above is green and meaningless.

_UNBOUNDED_LOCAL_IMPORT = '''\
def summarize(text):
    import anthropic
    client = anthropic.Anthropic(api_key="k")
    return client.messages.create(model="m", messages=[])
'''

_UNBOUNDED_FROM_IMPORT_RENAMED = '''\
from anthropic import Anthropic as Claude

def ask(q):
    return Claude(api_key="k").messages.create(model="m", messages=[])
'''

_UNBOUNDED_OPENAI = '''\
from openai import AsyncOpenAI

_client = AsyncOpenAI(api_key="k")
'''

_TIMEOUT_NONE = '''\
import anthropic

_client = anthropic.Anthropic(api_key="k", timeout=None)
'''

_TIMEOUT_SPLAT = '''\
import anthropic

def build(opts):
    return anthropic.Anthropic(**opts)
'''

_BOUNDED = '''\
import anthropic

def summarize(text):
    client = anthropic.Anthropic(api_key="k", timeout=60.0)
    return client.messages.create(model="m", messages=[])
'''

_BOUNDED_VIA_HELPER = '''\
import anthropic
from api.services import llm_timeouts

def _client():
    return anthropic.Anthropic(
        api_key="k",
        timeout=llm_timeouts.seconds("X_TIMEOUT_SECS", llm_timeouts.REQUEST_PATH),
    )
'''


def _plant(tmp_path, name, source):
    root = tmp_path / "api"
    root.mkdir(exist_ok=True)
    (root / name).write_text(textwrap.dedent(source), encoding="utf-8")
    return cen.census(str(tmp_path))


def test_the_rail_goes_red_on_a_planted_unbounded_client(tmp_path):
    """THE control. A function-local `import anthropic` is the exact shape of
    every one of the sites this rail was built to close."""
    found = _plant(tmp_path, "planted.py", _UNBOUNDED_LOCAL_IMPORT)
    assert len(found) == 1, found
    c = found[0]
    assert c.path == "api/planted.py"
    assert c.line == 3
    assert c.expr == "anthropic.Anthropic"
    assert c.scope == "summarize"
    assert c.local_import is True
    assert "600s" in c.reason


def test_the_rail_goes_red_on_a_renamed_from_import(tmp_path):
    """`from anthropic import Anthropic as Claude` never spells
    "anthropic.Anthropic" anywhere — a grep for the usual shape misses it."""
    found = _plant(tmp_path, "planted.py", _UNBOUNDED_FROM_IMPORT_RENAMED)
    assert [(c.line, c.expr, c.scope) for c in found] == [(4, "Claude", "ask")]


def test_the_rail_goes_red_on_an_unbounded_openai_client(tmp_path):
    found = _plant(tmp_path, "planted.py", _UNBOUNDED_OPENAI)
    assert [(c.line, c.expr) for c in found] == [(3, "AsyncOpenAI")]


def test_timeout_none_is_reported_not_accepted(tmp_path):
    """`timeout=None` is the SDK's spelling of "no timeout" — the defect wearing
    the fix's clothes. Accepting the keyword's mere presence would make the rail
    a one-word bypass switch."""
    found = _plant(tmp_path, "planted.py", _TIMEOUT_NONE)
    assert len(found) == 1 and "None" in found[0].reason, found


def test_a_timeout_hidden_behind_kwargs_is_reported(tmp_path):
    """The census cannot see inside a splat. Silence on an unreadable site is
    how eleven of these accumulated, so ambiguity resolves to unbounded."""
    found = _plant(tmp_path, "planted.py", _TIMEOUT_SPLAT)
    assert len(found) == 1 and "kwargs" in found[0].reason, found


def test_the_census_clears_the_same_call_once_it_is_bounded(tmp_path):
    """The control's control: prove the census discriminates on `timeout=` and
    not merely on the word "anthropic"."""
    assert _plant(tmp_path, "planted.py", _BOUNDED) == []


def test_the_census_clears_the_llm_timeouts_idiom(tmp_path):
    """The shape every fixed site now uses must actually pass — otherwise the
    rail would be telling people to write something it rejects."""
    assert _plant(tmp_path, "planted.py", _BOUNDED_VIA_HELPER) == []


def test_the_census_ignores_a_shadowing_local_name(tmp_path):
    """A parameter named `anthropic` is not an SDK reach. A false positive here
    trains people to add names to an ignore list, which is how a real rail dies."""
    source = '''\
    import anthropic

    def render(anthropic):
        return anthropic.Anthropic
    '''
    assert _plant(tmp_path, "planted.py", source) == []


def test_with_options_is_not_a_construction(tmp_path):
    """`client.with_options(timeout=300)` is how a scheduler pass legitimately
    lengthens its budget on an ALREADY-bounded client. If the census counted it
    as a construction the rail would fight the very idiom it prescribes."""
    source = '''\
    from api.services.engine import _get_anthropic_client

    def chapters(text):
        return _get_anthropic_client().with_options(timeout=300).messages.create(
            model="m", messages=[])
    '''
    assert _plant(tmp_path, "planted.py", source) == []


# ── the policy helper ────────────────────────────────────────────────────────

def test_the_budgets_are_ordered_and_all_far_under_the_sdk_default():
    assert llm_timeouts.REQUEST_PATH < llm_timeouts.REQUEST_PATH_LONG < llm_timeouts.OFFLINE_JOB
    assert llm_timeouts.OFFLINE_JOB < 600.0, (
        "every budget must sit under the SDK's own 600s default, or the "
        "'bounded' client is bounded in name only"
    )


def test_an_env_override_is_honoured(monkeypatch):
    monkeypatch.setenv("UCT_TEST_LLM_TIMEOUT", "12.5")
    assert llm_timeouts.seconds("UCT_TEST_LLM_TIMEOUT", 60.0) == 12.5


@pytest.mark.parametrize("bad", ["", "   ", "none", "abc", "0", "-5"])
def test_a_broken_env_override_falls_back_instead_of_unbounding(monkeypatch, bad):
    """The failure direction matters. If a typo'd override resolved to 0 or None
    the SDK would treat it as no timeout — this module's whole purpose, undone by
    a stray Railway variable."""
    monkeypatch.setenv("UCT_TEST_LLM_TIMEOUT", bad)
    assert llm_timeouts.seconds("UCT_TEST_LLM_TIMEOUT", 60.0) == 60.0


def test_an_unset_env_var_uses_the_coded_default(monkeypatch):
    monkeypatch.delenv("UCT_TEST_LLM_TIMEOUT", raising=False)
    assert llm_timeouts.seconds("UCT_TEST_LLM_TIMEOUT", 42.0) == 42.0
