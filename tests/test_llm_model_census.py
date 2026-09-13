"""🔴 ONE PLACE DECIDES THE MODEL, AND NO CALL SENDS A SAMPLING PARAMETER.

THE DEFECTS THIS FILE EXISTS FOR (both found live, 2026-08-28)
-------------------------------------------------------------
**A hand-typed model ID is a second authority.** 51 call sites across 36 modules
each named their own model, over six different IDs. `call_recap.py` and
`calendar_sector_read.py` read the SAME env var (`CATALYST_OPUS_MODEL`) with
DIFFERENT defaults, so which model ran depended on which file you read. That is
`lesson_a_second_authority_over_one_value`, the defect this repo has paid for
more times than any other. `api/services/llm_models.py` is now the one place
that decides.

**A sampling parameter is a 400 waiting for a deploy.** Claude 5 models reject
`temperature`/`top_p`/`top_k` outright. Sixteen sites were passing one — all
four Model Book sites and the ENTIRE Compass surface among them — so a
one-line model bump would have taken down every coaching path at once. Three
catalyst modules "handled" it by catching the 400 and retrying, i.e. paying a
wasted round-trip on every call, forever.

WHY THE FIXTURES COME FIRST
---------------------------
⛔ A census that cannot DISTINGUISH is not a rail. The live sweep at the bottom
passes trivially if the walker silently matches nothing, and this rail has four
separate ways to be wrong in that direction — it must ignore docstrings (this
repo's files are full of prose naming retired models), ignore price-table keys
(a price map MUST name IDs), ignore OpenAI calls (gpt-4o legitimately accepts
`temperature`, and three live modules pass one), and still see through a
splatted kwargs dict. So every exemption below is pinned by a fixture proving
the census stays SILENT on it, and every violation by one proving it FIRES —
because an over-broad rail gets an ignore-list bolted on and then dies
(`lesson_a_sweep_that_flags_thirteen_when_two_are_defects`).
"""
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.llm_model_census import census_module, run_census  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parent.parent


def _kinds(source: str, relpath: str = "api/services/probe.py") -> list[str]:
    return [f.kind for f in census_module(source, relpath)]


# ── it FIRES on the real defects ─────────────────────────────────────────────

def test_a_hand_typed_model_id_is_reported():
    assert _kinds('MODEL = "claude-sonnet-4-6"') == ["model_literal"]


def test_a_hand_typed_id_inside_an_env_default_is_reported():
    """The commonest live shape: an env var with the ID as its coded default."""
    src = 'import os\nM = os.environ.get("X_MODEL", "claude-opus-4-8")\n'
    assert _kinds(src) == ["model_literal"]


def test_a_sampling_param_on_an_anthropic_call_is_reported():
    src = 'r = client.messages.create(model=M, max_tokens=10, temperature=0.4)\n'
    assert _kinds(src) == ["sampling_param"]


def test_a_sampling_param_on_a_stream_is_reported():
    src = 'r = client.messages.stream(model=M, top_p=0.9)\n'
    assert _kinds(src) == ["sampling_param"]


def test_a_sampling_param_hidden_in_a_splatted_request_dict_is_reported():
    """⛔ Three catalyst modules were written exactly this way, and the direct
    keyword check cannot see through the splat."""
    src = ('kwargs = dict(model=M, max_tokens=10, temperature=0.2)\n'
           'r = client.messages.create(**kwargs)\n')
    assert _kinds(src) == ["sampling_param"]


# ── it stays SILENT on things that only LOOK like the defect ─────────────────

def test_the_registry_itself_may_name_models():
    """It is the authority; naming them is its whole job."""
    src = 'FLAGSHIP = "claude-opus-5"\nWORKHORSE = "claude-sonnet-5"\n'
    assert _kinds(src, "api/services/llm_models.py") == []


def test_a_model_named_in_a_docstring_is_prose_not_configuration():
    """This repo documents the models it USED to run, at length. Flagging that
    text is how a rail earns an ignore-list."""
    src = '"""We ran claude-sonnet-4-6 here until 2026-08-28."""\nX = 1\n'
    assert _kinds(src) == []


def test_a_price_table_keyed_by_model_id_is_not_a_second_authority():
    """⛔ A price map MUST name real IDs — it is keyed BY them. Position is the
    tell: an ID in key position is looked up, an ID in value position is
    chosen."""
    src = ('_PRICES = {"claude-opus-5": (5.0, 25.0),\n'
           '           "claude-sonnet-5": (2.0, 10.0)}\n'
           'p = _PRICES["claude-opus-5"]\n')
    assert _kinds(src) == []


def test_an_openai_call_may_pass_a_temperature():
    """gpt-4o accepts it, and three live voice modules send one. The owner
    attribute left of the method separates the SDKs by construction."""
    src = 'r = client.chat.completions.create(model="gpt-4o", temperature=0.1)\n'
    assert _kinds(src) == []


def test_a_test_file_may_pin_a_literal_model_id():
    src = 'assert calls[0]["model"] == "claude-haiku-4-5"\n'
    assert _kinds(src, "tests/test_something.py") == []


def test_max_tokens_is_not_a_sampling_parameter():
    """A guard against the rail creeping into 'any kwarg I dislike'."""
    src = 'r = client.messages.create(model=M, max_tokens=2000)\n'
    assert _kinds(src) == []


# ── the live sweep ───────────────────────────────────────────────────────────

def test_no_production_module_names_a_model_or_sends_a_sampling_param():
    findings = run_census(str(REPO))
    if findings:
        lines = "\n".join(f"  {f}" for f in sorted(
            findings, key=lambda f: (f.kind, f.path, f.line)))
        raise AssertionError(
            f"{len(findings)} model/sampling violation(s):\n{lines}\n\n"
            "Import the tier from api/services/llm_models.py instead of naming a "
            "model, and drop temperature/top_p/top_k — Claude 5 rejects them "
            "with a 400.")


def test_the_live_sweep_actually_reads_the_tree():
    """⛔ NON-VACUITY. The assertion above passes on an empty result set, which
    is also what a broken walker returns. Prove the sweep reaches real files and
    parses them by finding the registry's own constants where they live."""
    registry = (REPO / "api" / "services" / "llm_models.py").read_text(encoding="utf-8")
    # The census exempts this file BY PATH; under any other path its constants
    # are exactly the violation shape, so a walker that sees nothing here is broken.
    assert _kinds(registry, "api/services/elsewhere.py").count("model_literal") >= 3
