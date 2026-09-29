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


# ─────────────────────────────────────────────────────────────────────────────
#  Fix round 1 -- credentials the SDK reads ON ITS OWN, the keyring, the wisdom
#  job flags. (a)/(b)/(c) labels as above.
# ─────────────────────────────────────────────────────────────────────────────

# The SDK client modules api/ constructs from (anthropic.Anthropic/AsyncAnthropic,
# openai.OpenAI). Read as SOURCE, from the installed package, never re-typed.
SDK_CLIENT_FILES = (("anthropic", "_client.py"), ("openai", "_client.py"))
ENV_GET = re.compile(r"""os\.environ\.get\(\s*["']([A-Z0-9_]+)["']""")
CREDENTIAL_SHAPE = re.compile(r"(TOKEN|API_KEY)$")
# Client classes that read credentials the two files above do not (AWS, GCP,
# Azure, Foundry). None is constructed in api/ today; one appearing reds (c).
OTHER_SDK_CLIENTS = re.compile(
    r"\b(AnthropicBedrock|AsyncAnthropicBedrock|AnthropicVertex|AsyncAnthropicVertex|"
    r"AnthropicFoundry|AsyncAnthropicFoundry|AzureOpenAI|AsyncAzureOpenAI)\b")


def derive_sdk_implicit_env():
    names = {}
    for pkg, rel in SDK_CLIENT_FILES:
        spec = importlib.util.find_spec(pkg)
        assert spec and spec.submodule_search_locations, f"{pkg} SDK not installed"
        path = pathlib.Path(list(spec.submodule_search_locations)[0]) / rel
        for m in ENV_GET.finditer(path.read_text(encoding="utf-8")):
            names.setdefault(m.group(1), f"{pkg}/{rel}")
    return names


def test_c_sdk_implicit_env_is_fully_classified(launcher):
    derived = derive_sdk_implicit_env()
    # Non-vacuity: the scan must see the explicit keys it is reading past.
    assert {"ANTHROPIC_API_KEY", "OPENAI_API_KEY"} <= set(derived), derived
    implicit = set(derived) - set(launcher.MODEL_PROVIDER_KEYS)
    classified = set(launcher.SDK_IMPLICIT_KEYS) | set(launcher.SDK_NON_CREDENTIAL_ENV)
    assert not (set(launcher.SDK_IMPLICIT_KEYS) & set(launcher.SDK_NON_CREDENTIAL_ENV))
    assert implicit == classified, (
        f"unclassified SDK env reads: {sorted(implicit - classified)}; "
        f"classified but not read by the SDK: {sorted(classified - implicit)}")


def test_c_every_credential_shaped_sdk_read_is_blanked(launcher):
    blanked = set(launcher.MODEL_PROVIDER_KEYS) | set(launcher.SDK_IMPLICIT_KEYS)
    missed = sorted(n for n in derive_sdk_implicit_env()
                    if CREDENTIAL_SHAPE.search(n) and n not in blanked)
    assert not missed, f"SDK reads these credentials implicitly and nothing blanks them: {missed}"
    assert "ANTHROPIC_AUTH_TOKEN" in blanked


def test_c_api_constructs_no_sdk_client_with_other_credentials():
    hits = []
    for path in sorted((REPO / "api").rglob("*.py")):
        if _is_test_module(path, REPO / "api"):
            continue
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if OTHER_SDK_CLIENTS.search(line):
                hits.append(f"{path.relative_to(REPO).as_posix()}:{i}")
    assert not hits, (f"api/ constructs an SDK client whose credentials SDK_IMPLICIT_KEYS "
                      f"does not cover: {hits}")
    assert OTHER_SDK_CLIENTS.search("client = anthropic.AnthropicBedrock()")  # control


def test_a_sdk_implicit_keys_and_keyring_are_neutralised(launcher, restore_env, tmp_path):
    for key in launcher.MODEL_PROVIDER_KEYS + launcher.SDK_IMPLICIT_KEYS:
        os.environ[key] = SENTINEL
    os.environ["PYTHON_KEYRING_BACKEND"] = "keyring.backends.Windows.WinVaultKeyring"
    os.environ.pop(launcher.ALLOW_MODEL_KEYS_ENV, None)
    launcher.apply_sandbox_env(str(tmp_path / "sbx"), reclaim_conftest_temp=False,
                               allow_model_keys=False)
    assert {k: os.environ.get(k) for k in launcher.SDK_IMPLICIT_KEYS} == \
        {k: "" for k in launcher.SDK_IMPLICIT_KEYS}
    # keyring core reads PYTHON_KEYRING_BACKEND at first use (keyring/core.py:151 in
    # keyring 25.6.0); the null backend answers every get_password with None.
    assert os.environ.get("PYTHON_KEYRING_BACKEND") == "keyring.backends.null.Keyring"


def test_b_opt_in_leaves_sdk_implicit_keys_and_keyring_alone(launcher):
    env = {k: SENTINEL for k in launcher.MODEL_PROVIDER_KEYS + launcher.SDK_IMPLICIT_KEYS}
    launcher.apply_model_key_policy(env, allow=True)
    assert all(env[k] == SENTINEL for k in launcher.SDK_IMPLICIT_KEYS)
    assert "PYTHON_KEYRING_BACKEND" not in env


def test_a_wisdom_model_jobs_are_pinned_off(launcher, restore_env, tmp_path):
    names = ("WISDOM_EXTRACT_ENABLED", "WISDOM_EXTRACT_AUDIT_ENABLED", "WISDOM_VISION_ENABLED")
    for n in names:
        os.environ[n] = "1"                       # an operator shell that armed them
    launcher.apply_sandbox_env(str(tmp_path / "sbx"), reclaim_conftest_temp=False)
    assert {n: os.environ.get(n) for n in names} == {n: "0" for n in names}


def _capture_requests(run):
    """Run `run(base_url)` against a local listener; return the credential each
    request carried: a list of (x_api_key, bearer_token) strings, '' when empty."""
    import socket
    import threading
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(8)
    srv.settimeout(0.3)
    seen, stop = [], threading.Event()

    def _accept():
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except OSError:
                continue
            conn.settimeout(2)
            try:
                head = conn.recv(65536).decode("latin-1")
            except OSError:
                head = ""
            hdr = {}
            for line in head.split("\r\n")[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    hdr[k.strip().lower()] = v.strip()
            bearer = hdr.get("authorization", "")
            bearer = bearer[len("Bearer"):].strip() if bearer.lower().startswith("bearer") else bearer
            seen.append((hdr.get("x-api-key", ""), bearer))
            conn.close()

    t = threading.Thread(target=_accept, daemon=True)
    t.start()
    try:
        try:
            run(f"http://127.0.0.1:{srv.getsockname()[1]}")
        except Exception:  # noqa: BLE001 -- the listener closes without answering
            pass
    finally:
        stop.set()
        t.join(2)
        srv.close()
    return seen


def test_a_no_request_leaves_with_a_credential_after_the_policy(launcher, restore_env):
    """Behavioural, on the shape of ai_search_personal.py:273 -- a client built from
    the env's key with no check first.

    MEASURED, SDK 0.83.0: a blank ANTHROPIC_AUTH_TOKEN does NOT stop the request.
    The SDK keeps "" (it only defaults on None) and sends `Authorization: Bearer `,
    which passes its own header check; only an UNSET token raises before sending.
    What blanking guarantees is that nothing it sends can authenticate (a 401,
    never a billed call), and a setdefault .env loader cannot put a token back.
    So the rail asserts on the CREDENTIAL carried, not on whether a socket opened.
    CONTROL: the same call with the operator's token left in place carries it."""
    anthropic = pytest.importorskip("anthropic")

    def call(base):
        c = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
                                base_url=base, max_retries=0, timeout=2)
        return c.messages.create(model="x", max_tokens=1,
                                 messages=[{"role": "user", "content": "hi"}])

    os.environ["ANTHROPIC_API_KEY"] = SENTINEL
    os.environ["ANTHROPIC_AUTH_TOKEN"] = SENTINEL
    launcher.apply_model_key_policy(os.environ, allow=False)
    carried = _capture_requests(call)
    assert all(k == "" and b == "" for k, b in carried), (
        f"a request left the process carrying a credential: {carried}")

    os.environ["ANTHROPIC_AUTH_TOKEN"] = SENTINEL          # control: token back
    control = _capture_requests(call)
    assert (("", SENTINEL) in control), (
        f"CONTROL FAILED: the listener did not see the token it was handed: {control}")
