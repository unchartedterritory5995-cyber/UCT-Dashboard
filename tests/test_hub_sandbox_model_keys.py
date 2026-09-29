"""Rails: a sandbox boot spends nothing on a model unless the caller opts in.

⛔ WHY THIS FILE EXISTS. `scripts/hub_sandbox_boot.py` passed the operator's
environment straight through, and the app's boot warm spent it: calendar
enrichment -> `engine._generate_earnings_preview`, `earnings_enrichment`
key-quotes, `stock_brief` profiles. One committed sandbox log
(docs/notebook/proof/d2-after-04fadfaa5/sandbox-boot.log) holds 71 distinct
Anthropic request ids from ONE boot, refused only because the key's credit was
exhausted. Sandbox boots run many times a day, from several lanes.

Three rails, each mutation-proved (docs/notebook/proof/w10-sk/mutation-log.txt):

  (a) no opt-in  -> every model-provider key is "" in the env the app sees;
  (b) opt-in     -> the values pass through untouched (flag AND env-var form);
  (c) the classified name list EQUALS the `*_API_KEY` names read in `api/**`,
      derived here by this file's own AST walk — so a provider key added
      tomorrow reds this rail until someone classifies it.

⭐ BLANK, NEVER POP is railed too: `api/services/build_intraday_cache.py`
re-supplies env from `.env` files with `os.environ.setdefault`, which an unset
key loses to and a blank key does not.
"""

import ast
import importlib.util
import os
import pathlib
import re

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
LAUNCHER = REPO / "scripts" / "hub_sandbox_boot.py"

KEY_NAME = re.compile(r"^[A-Z0-9_]*_API_KEY$")
# Words that mark a paid model / embedding provider. A derived name containing
# one of these may never be classified NON-model.
PROVIDER_WORDS = re.compile(
    r"ANTHROPIC|CLAUDE|OPENAI|PERPLEXITY|XAI|GROK|GEMINI|GOOGLE_AI|VERTEX|COHERE|"
    r"VOYAGE|MISTRAL|GROQ|DEEPSEEK|OPENROUTER|TOGETHER|FIREWORKS|REPLICATE|"
    r"HUGGINGFACE|AZURE_OPENAI|BEDROCK|DEEPGRAM|ASSEMBLYAI|ELEVENLABS|JINA|LLM")

SENTINEL = "sk-rail-sentinel-not-a-real-key"


def _load_launcher():
    spec = importlib.util.spec_from_file_location("hub_sandbox_boot_mk", str(LAUNCHER))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def launcher():
    return _load_launcher()


@pytest.fixture
def restore_env():
    saved = dict(os.environ)
    yield
    os.environ.clear()
    os.environ.update(saved)


def _is_test_module(path: pathlib.Path, api: pathlib.Path) -> bool:
    n = path.name
    return (n.startswith("test_") or n.endswith("_test.py") or n == "conftest.py"
            or "tests" in path.relative_to(api).parts)


def derive_api_key_reads(repo: pathlib.Path = REPO):
    """{name: [file:line, ...]} for every `*_API_KEY` string literal in api/**
    production modules. A full-match on the literal excludes docstrings and
    comments, so what remains is a name the code hands to an env read (directly,
    or through a tuple such as wisdom's KEY_VARS)."""
    api = repo / "api"
    found = {}
    for path in sorted(api.rglob("*.py")):
        if _is_test_module(path, api):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Constant) and isinstance(node.value, str)
                    and KEY_NAME.match(node.value)):
                rel = path.relative_to(repo).as_posix()
                found.setdefault(node.value, []).append(f"{rel}:{node.lineno}")
    return found


# ─────────────────────────────────────────────────────────────────────────────
#  (a) no opt-in -> every model key is BLANK in the env the app will see
# ─────────────────────────────────────────────────────────────────────────────

def test_a_no_opt_in_blanks_every_model_key(launcher, restore_env, tmp_path):
    for key in launcher.MODEL_PROVIDER_KEYS:
        os.environ[key] = SENTINEL                     # the operator's shell
    os.environ.pop(launcher.ALLOW_MODEL_KEYS_ENV, None)

    launcher.apply_sandbox_env(str(tmp_path / "sbx"), reclaim_conftest_temp=False,
                               allow_model_keys=launcher.model_keys_opted_in(False))

    got = {k: os.environ.get(k) for k in launcher.MODEL_PROVIDER_KEYS}
    assert got == {k: "" for k in launcher.MODEL_PROVIDER_KEYS}, (
        f"model keys reaching the app without an opt-in: "
        f"{sorted(k for k, v in got.items() if v != '')} "
        "(None = popped, which a .env loader can re-supply)")


def test_a_the_derived_model_keys_are_all_blanked(launcher):
    """Every derived name carrying a provider word is in the blanked set — the
    blanked set is checked against the DERIVATION, not against itself."""
    env = {}
    launcher.apply_model_key_policy(env, allow=False)
    provider_named = {n for n in derive_api_key_reads() if PROVIDER_WORDS.search(n)}
    assert provider_named, "derivation found no provider key at all — the walk is broken"
    not_blank = sorted(n for n in provider_named if env.get(n) != "")
    assert not not_blank, f"provider keys read in api/ but NOT blanked: {not_blank}"


def test_a_blank_beats_a_setdefault_dotenv_loader(launcher):
    """`build_intraday_cache` loads .env with `setdefault`. After the policy, a
    loader must not be able to put a key back."""
    env = {k: SENTINEL for k in launcher.MODEL_PROVIDER_KEYS}
    launcher.apply_model_key_policy(env, allow=False)
    for k in launcher.MODEL_PROVIDER_KEYS:
        env.setdefault(k, "from-dotenv")
    assert all(env[k] == "" for k in launcher.MODEL_PROVIDER_KEYS), env


def test_a_the_boot_line_names_keys_never_values(launcher):
    env = {k: SENTINEL for k in launcher.MODEL_PROVIDER_KEYS}
    line = launcher.apply_model_key_policy(env, allow=False)
    assert "BLANKED" in line and SENTINEL not in line
    assert all(k in line for k in launcher.MODEL_PROVIDER_KEYS)
    line = launcher.apply_model_key_policy(dict.fromkeys(env, SENTINEL), allow=True)
    assert "OPT-IN" in line and SENTINEL not in line


def test_a_policy_runs_before_the_app_is_imported():
    """Ordering is the guard: an import-time reader would see the raw key."""
    src = LAUNCHER.read_text(encoding="utf-8")
    body = src[src.index("def main("):]
    assert body.index("apply_sandbox_env(") < body.index("from api.main import"), (
        "the app is imported before the model-key policy is applied")
    apply_body = src[src.index("def apply_sandbox_env("):src.index("def _start_post_boot_compare(")]
    assert "apply_model_key_policy(os.environ" in apply_body


# ─────────────────────────────────────────────────────────────────────────────
#  (b) explicit opt-in -> values pass through
# ─────────────────────────────────────────────────────────────────────────────

def test_b_flag_opt_in_passes_values_through(launcher, restore_env, tmp_path):
    for key in launcher.MODEL_PROVIDER_KEYS:
        os.environ[key] = SENTINEL
    os.environ.pop(launcher.ALLOW_MODEL_KEYS_ENV, None)

    launcher.apply_sandbox_env(str(tmp_path / "sbx"), reclaim_conftest_temp=False,
                               allow_model_keys=launcher.model_keys_opted_in(True))

    assert {k: os.environ.get(k) for k in launcher.MODEL_PROVIDER_KEYS} == \
        {k: SENTINEL for k in launcher.MODEL_PROVIDER_KEYS}


def test_b_env_var_opt_in_is_exact(launcher):
    name = launcher.ALLOW_MODEL_KEYS_ENV
    assert launcher.model_keys_opted_in(False, {name: "1"}) is True
    for not_an_opt_in in ({}, {name: ""}, {name: "0"}, {name: "true"}, {name: "yes"}):
        assert launcher.model_keys_opted_in(False, not_an_opt_in) is False, not_an_opt_in


def test_b_env_var_opt_in_reaches_the_env(launcher):
    env = {k: SENTINEL for k in launcher.MODEL_PROVIDER_KEYS}
    env[launcher.ALLOW_MODEL_KEYS_ENV] = "1"
    launcher.apply_model_key_policy(env, launcher.model_keys_opted_in(False, env))
    assert all(env[k] == SENTINEL for k in launcher.MODEL_PROVIDER_KEYS)


# ─────────────────────────────────────────────────────────────────────────────
#  (c) the classified list EQUALS what api/** actually reads
# ─────────────────────────────────────────────────────────────────────────────

def test_c_classification_equals_the_derived_read_set(launcher):
    derived = derive_api_key_reads()
    model, other = set(launcher.MODEL_PROVIDER_KEYS), set(launcher.NON_MODEL_KEYS)
    assert not (model & other), f"classified both ways: {sorted(model & other)}"
    unclassified = sorted(set(derived) - model - other)
    assert not unclassified, (
        f"*_API_KEY read in api/ but not classified in scripts/hub_sandbox_boot.py: "
        f"{ {n: derived[n][:2] for n in unclassified} } -- add it to MODEL_PROVIDER_KEYS "
        "(blanked) or NON_MODEL_KEYS")
    phantom = sorted((model | other) - set(derived))
    assert not phantom, f"classified names with NO read site in api/: {phantom}"


def test_c_no_provider_key_is_classified_non_model(launcher):
    wrong = sorted(n for n in launcher.NON_MODEL_KEYS if PROVIDER_WORDS.search(n))
    assert not wrong, f"provider-named keys classified NON-model (would not be blanked): {wrong}"


def test_c_derivation_can_see_a_new_key(tmp_path):
    """Non-vacuity: the walk must find a literal in a module it has never seen."""
    fake_api = tmp_path / "api" / "services"
    fake_api.mkdir(parents=True)
    (fake_api / "new_provider.py").write_text(
        'import os\nK = os.environ.get("XAI_API_KEY")\n"""XAI_API_KEY in a docstring"""\n',
        encoding="utf-8")
    (fake_api / "test_new_provider.py").write_text('X = "SKIPPED_API_KEY"\n', encoding="utf-8")
    found = derive_api_key_reads(tmp_path)
    assert found == {"XAI_API_KEY": ["api/services/new_provider.py:2"]}, found
