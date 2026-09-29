"""Boot the app for joystick-hub device testing, against a SANDBOX data root.

⛔ WHY THIS IS A PYTHON LAUNCHER AND NOT A LIST OF ENV VARS IN A .ps1 FILE.

Because the list was wrong, and "wrong" here means it wrote to production.

`scripts/hub-sandbox.ps1` set `DATA_DIR` and believed that sandboxed the app.
It does not. `DATA_DIR` is ONE of **72** environment variables that name a path
inside the shared data root, and the other 71 resolve independently of it. The
first sandbox boot (2026-09-08 22:04) therefore wrote into the owner's live
files while reporting a clean startup:

    C:\\data\\auth.db          22:04:46   (1.01 GB, ~20,640 real members)
    C:\\data\\desk.db          22:04:23
    C:\\data\\flow.db-shm      22:04:16
    C:\\data\\buzz.db-shm      22:04:16

`api/services/auth_db.py:10` is the shape of the whole class::

    _DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")

No `DATA_DIR` anywhere in it, and `/data` is a real directory on this box, so
the default resolves to `C:\\data\\auth.db`. Nothing failed. Nothing warned.

⭐ SO THE PIN LIST IS DERIVED, NEVER TYPED. `conftest.shared_data_root_census()`
already walks `api/**` with an AST and returns every `(env var -> /data literal)`
pairing; it is the same census the pytest suite has relied on since `e86ad6d5`,
with its own rails in `tests/test_shared_data_root_guard.py`. Importing it here
means the sandbox and the test suite cannot drift, and a new `/data` literal
added tomorrow is pinned the day it lands. A hand-maintained copy would be a
second authority over one value — which is the defect this file exists to fix.

⭐ AND THE REDIRECT IS NOT TRUSTED ON ITS OWN. Importing `conftest` also ARMS
THE TRIPWIRE: `sqlite3.connect`, `open`, `io.open`, `os.makedirs/mkdir/remove/
unlink/rename/replace` all raise `SharedDataRootWrite` on a path inside
`C:\\data`, and RECORD it. The record is the half that matters — this app spawns
daemon threads on every startup path, and a daemon thread's exception goes to
`threading.excepthook` and vanishes, leaving a server that looks healthy. The
reporter thread below turns those records into visible operator output.

A redirect alone would also miss the sites a pin can never reach: default
ARGUMENTS (`def __init__(self, db_path="/data/flow.db")`) read no env var, so
there is nothing for a pin to move. Only the tripwire covers those.

Usage:
    python scripts/hub_sandbox_boot.py
    python scripts/hub_sandbox_boot.py --data-dir C:\\data-hubtest --port 8077
"""

import argparse
import os
import shutil
import sys
import threading
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


# ── Behavioural flags the path census cannot see ─────────────────────────────
#
# The census pins PATHS. These are not paths — they arm SCHEDULERS and OUTBOUND
# CHANNELS, and every one of them is a live door to the outside world: a
# ~750-member Discord channel, YouTube, and member email via Resend.
#
# ⭐ Webhooks are BLANKED, never unset. An unset webhook var and a deliberately
# disabled one are indistinguishable to a reader, and code that treats "missing"
# as "use the default" would then reach the real channel. Blank is a statement.
KILL_LIST = {
    # ⛔ USE_REMOTE_BARS is the ONLY gate on the bars seeder. `bars_seeder.
    # start_background_seeder()` has no flag of its own — `api/main.py:3858`
    # calls it unless this is exactly "1". The first sandbox run logged
    # "[seeder/t2-D] starting — 3160 jobs, 4 workers" because the var this
    # script previously set, `BARS_PREWARM_DISABLED`, MATCHES NOTHING IN THE
    # CODEBASE. It was a name I invented; grep it and you get zero hits.
    "USE_REMOTE_BARS": "1",
    # The prewarmer is a separate thread with a separate gate. Explicit "0"
    # disables it even on a pod that would otherwise default it on.
    "BARS_PREWARM_ENABLED": "0",
    "TICKER_NAMES_PREWARM_DISABLED": "1",

    # Background workers — none of them belong in a device-test boot.
    "WORKER_ENABLED": "0",
    "FLOW_WORKER_ENABLED": "0",
    "BARS_API_ENABLED": "0",
    "MASSIVE_WS_ENABLED": "0",

    # Automations that SEND (Discord / YouTube / email / member alerts).
    "CATALYST_ENGINE_ENABLED": "0",
    "CATALYST_ALERTS_ENABLED": "0",
    "BUZZ_DIGEST_ENABLED": "0",
    "DESK_DAILY_SESSION_ENABLED": "0",
    "DESK_TSDR_ANNOUNCE_ENABLED": "0",
    "DESK_SESSION_AUDIT_ENABLED": "0",
    "COMPASS_AUTOMATION_ENABLED": "0",
    "AWARENESS_ENGINE_ENABLED": "0",
    "CALENDAR_ALERTS_ENABLED": "0",
    "DOWN_ALERT_ENABLED": "0",

    # Scheduled compute that writes shared state.
    "SCAN_SWEEP_ENABLED": "0",
    "BROKER_SYNC_ENABLED": "0",
    "NOTE_SYNC_ENABLED": "0",
    "THEME_ENGINE_ENABLED": "0",
    "RECONCILE_ENABLED": "0",
    "COT_PREWARM_ENABLED": "0",
    "FUNDAMENTALS_MONITOR_ENABLED": "0",
    "TWITTERAPI_IO_ENABLED": "0",
    "COT_NARRATIVE_ENABLED": "0",
    "BRAIN_PACK_ENABLED": "0",

    # Wisdom Loop model jobs (api/services/wisdom/core/flags.py:54/58/62, all
    # default "0"). Pinned explicitly so an operator shell that armed one
    # cannot start a paid extract/vision/audit run from a sandbox boot.
    "WISDOM_EXTRACT_ENABLED": "0",
    "WISDOM_EXTRACT_AUDIT_ENABLED": "0",
    "WISDOM_VISION_ENABLED": "0",

    # Outbound channels — BLANKED, not unset (see the note above).
    "DISCORD_WEBHOOK_URL": "",
    "DISCORD_TSDR_WEBHOOK_URL": "",
    "COT_WEEKLY_DISCORD_WEBHOOK_URL": "",
    "BUZZ_DIGEST_CHANNEL": "",

    # R2 / shared object storage — blank kills the capability, not just one door.
    # Load-bearing beside USE_REMOTE_BARS=1, whose branch would otherwise try to
    # pull a bars snapshot from the worker's bucket.
    "DATA_SYNC_ACCESS_KEY": "",
    "DATA_SYNC_SECRET_KEY": "",
    "DATA_SYNC_BUCKET": "",
    "DATA_SYNC_ENDPOINT": "",
}


# ── Model-provider keys: BLANKED unless the caller opts in ───────────────────
#
# ⛔ WHY. The operator's environment passes straight into this process, and the
# app's boot warm spends it: `api/main.py` -> `_start_dashboard_warm_background`
# -> calendar enrichment -> `engine._generate_earnings_preview`, plus
# `earnings_enrichment` key-quotes and `stock_brief` profiles. One committed
# sandbox log (docs/notebook/proof/d2-after-04fadfaa5/sandbox-boot.log) carries
# 71 distinct Anthropic request ids from ONE boot, all refused only because the
# key's credit was exhausted. Sandbox boots run many times a day from several
# lanes; a UI probe needs no model at all.
#
# ⭐ BLANK, NEVER POP -- and what blanking does and does NOT beat. Nothing in
# api/ calls load_dotenv, but three hand-rolled .env loaders are reachable from
# the app, and they differ:
#   * api/services/build_intraday_cache.py:24-34 -- IN-REPO, at import,
#     `os.environ.setdefault(k, v)` from `<repo>/.env` and `$UCT_INTEL_PATH/.env`.
#     Imported lazily (deep-cache builder, api/main.py:5000, gated
#     DEEP_CACHE_ENABLED and skipped on a default sandbox boot; and
#     breadth_combined_pass / breadth_wick_recon). setdefault never overrides,
#     so a BLANK key survives it; an UNSET key would be re-supplied.
#   * uct_intelligence fmp_data.py / massive_data.py `_load_env` -- OUT OF REPO
#     (imported via api/routers/intelligence.py:55 `uct_intelligence.api`).
#     `if key not in os.environ` -- a BLANK key survives it too.
#   * morning_wire_engine.load_env -- OUT OF REPO, runs at import
#     (C:\Users\Patrick\morning-wire\morning_wire_engine.py:117,
#     `if val and not os.environ.get(key)`) and reads `.env` relative to the
#     CWD. That test treats "" as missing, so it DOES re-supply a blank key.
#     LATENT, not closed: it is reachable only when `<repo>/../morning-wire`
#     exists (api/services/engine.py:44 puts it on sys.path) and something
#     imports it (engine.py:461, a breadth fallback). For a worktree under
#     uct-worktrees\ that path does not exist; for the main checkout
#     C:\Users\Patrick\uct-dashboard it DOES. No launcher-side env value can
#     stop it; only a product change could. Recorded, not railed.
#
# ⭐ THE LIST IS CLASSIFIED, NOT TYPED FROM MEMORY. `tests/test_hub_sandbox_
# model_keys.py` derives every `*_API_KEY` literal read in `api/**` by AST and
# requires the union of the two tuples below to EQUAL it, so a provider key
# added tomorrow reds that rail until someone decides which tuple it joins.
MODEL_PROVIDER_KEYS = (
    "ANTHROPIC_API_KEY",         # api/services/engine.py:80 (the warm's client)
    "WISDOM_ANTHROPIC_API_KEY",  # api/services/wisdom/extract/batch.py:68 -> :107
    "OPENAI_API_KEY",            # api/services/voice_openai.py:118
    "PERPLEXITY_API_KEY",        # api/services/perplexity_search.py:430
)

# Read in api/**, and NOT a paid model/embedding provider: market-data, news,
# e-mail and earnings-audio vendors. Left untouched — the sandbox's pages need
# their data, and this lane's scope is model spend only.
NON_MODEL_KEYS = (
    "ALPHAVANTAGE_API_KEY", "BULLFLOW_API_KEY", "EARNINGS_AUDIO_API_KEY",
    "FINNHUB_API_KEY", "FINVIZ_API_KEY", "FMP_API_KEY", "FRED_API_KEY",
    "MASSIVE_API_KEY", "POLYGON_API_KEY", "RESEND_API_KEY", "THEFLY_API_KEY",
    "TWITTERAPI_IO_API_KEY", "UW_API_KEY",
)

# Credentials a provider SDK reads from the environment ON ITS OWN, with no
# literal anywhere in api/ -- so the `*_API_KEY` derivation above cannot see
# them. Kept OUT of MODEL_PROVIDER_KEYS so that tuple's "every name has a read
# site in api/" check stays true. Derived from the SDK clients api/ constructs
# (anthropic.Anthropic / AsyncAnthropic, openai.OpenAI) by
# tests/test_hub_sandbox_model_keys.py, which reads the installed SDK source:
#   anthropic/_client.py  ANTHROPIC_AUTH_TOKEN -- a Bearer credential. An
#     api_key of "" plus this token still SENDS a request (reviewer-verified,
#     SDK 0.83.0), and ai_search_personal.py:273-274 / wisdom/evals/
#     grounding.py:155 construct a client without checking the key first.
#
# ⛔ BLANK IS NOT "NO REQUEST" FOR THIS ONE (measured, SDK 0.83.0): the SDK only
# defaults a None token, keeps "" and sends `Authorization: Bearer `, which passes
# its own header check -- so a client built without a key check still sends a
# CREDENTIAL-LESS request (a 401, never billed). Only an UNSET token refuses
# before sending, and an unset token can be re-supplied by a setdefault .env
# loader and then billed. Controller ruling, lane SK fix round 1 (2026-09-29):
# KEEP BLANK -- a billable re-supply is the worse failure.
SDK_IMPLICIT_KEYS = (
    "ANTHROPIC_AUTH_TOKEN",
)

# Read implicitly by those same SDK clients and deliberately NOT blanked: none
# of them authorises a request. A base URL only redirects (and blanking it to ""
# would hand the SDK an empty URL); OpenAI org/project ids only scope a key that
# is already blanked; the webhook secret verifies inbound webhooks.
SDK_NON_CREDENTIAL_ENV = (
    "ANTHROPIC_BASE_URL",
    "OPENAI_BASE_URL", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID", "OPENAI_WEBHOOK_SECRET",
)

# The wisdom extract path has a THIRD credential source after the two env names:
# the OS keyring (api/services/wisdom/extract/batch.py:74 key_from_keyring,
# consulted at :114 when both env keys are empty -- i.e. exactly when this
# policy has blanked them). keyring honours PYTHON_KEYRING_BACKEND for the whole
# process, and its null backend answers every lookup with None.
KEYRING_NULL_BACKEND = "keyring.backends.null.Keyring"

# The env-var form of `--allow-model-keys`, for callers that start this script
# through a harness (tools/notebook_perf_harness.Sandbox) rather than argv.
ALLOW_MODEL_KEYS_ENV = "HUB_SANDBOX_ALLOW_MODEL_KEYS"


def model_keys_opted_in(flag, environ=None):
    """True only on the explicit flag or `HUB_SANDBOX_ALLOW_MODEL_KEYS=1`."""
    environ = os.environ if environ is None else environ
    return bool(flag) or environ.get(ALLOW_MODEL_KEYS_ENV, "") == "1"


def apply_model_key_policy(environ, allow):
    """Blank every model-provider key in `environ` unless `allow`. Returns the
    one boot line that says which happened (names only, never a value)."""
    if allow:
        return ("  Model keys   : OPT-IN -- passed through unchanged "
                f"({', '.join(MODEL_PROVIDER_KEYS + SDK_IMPLICIT_KEYS)}; keyring "
                "untouched); paid model calls are POSSIBLE")
    for key in MODEL_PROVIDER_KEYS:
        environ[key] = ""
    for key in SDK_IMPLICIT_KEYS:
        environ[key] = ""
    environ["PYTHON_KEYRING_BACKEND"] = KEYRING_NULL_BACKEND
    return ("  Model keys   : BLANKED "
            + ", ".join(MODEL_PROVIDER_KEYS + SDK_IMPLICIT_KEYS)
            + "; keyring -> null backend"
            + f" (opt in: --allow-model-keys or {ALLOW_MODEL_KEYS_ENV}=1)")


def _norm(path):
    return os.path.normcase(os.path.abspath(path))


def _refuse_port_in_use(port):
    """Hard-exit if something is ALREADY listening on this port.

    ⛔ THIS COST A WHOLE DEVICE RUN. On 2026-09-08 a concurrent session on this machine
    started `tools/local_backend_sandbox.py --port 8077` while the hub sandbox was already
    serving on 8077. Windows let the second bind succeed, and from that moment the phones
    in BrowserStack were driving SOMEBODY ELSE'S BACKEND through the tunnel: signup and
    login returned 200 against a store the hub sandbox could not see, and the hub simply
    was not in the build being served, so every gesture step reported "hub-pad not
    present".

    ⭐ THE FAILURE MODE IS THE POINT: nothing errored. The suite kept running, the tunnel
    stayed up, HTTP kept answering 200, and the results looked like a product that had
    stopped mounting. A device result gathered against an unknown server is not a weaker
    result, it is not a result at all — so this refuses to start rather than serve a
    second opinion on a contested port.
    """
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1.5)
        if probe.connect_ex(("127.0.0.1", port)) != 0:
            return
    print("")
    print("  REFUSING TO RUN.")
    print("")
    print(f"  Something is ALREADY listening on port {port}.")
    print("  Two servers on one port means the device suite may reach either one, and a")
    print("  result gathered against an unknown server is not a result.")
    print("")
    print("  Find the owner:   Get-NetTCPConnection -LocalPort %d -State Listen" % port)
    print("  Then use another: python scripts/hub_sandbox_boot.py --port 8099")
    print("")
    sys.exit(1)


def _refuse_shared_root(sandbox, shared_roots):
    """Hard-exit if the sandbox IS, or sits inside, the shared data root.

    Checked before anything is set, created or served. A device-test run against
    the real root does not fail loudly — it succeeds against real member data,
    which is worse.
    """
    target = _norm(sandbox)
    for root in shared_roots:
        if target == root or target.startswith(root + os.sep):
            print("")
            print("  REFUSING TO RUN.")
            print("")
            print(f"  --data-dir resolved to {target!r}, which is inside the")
            print(f"  SHARED DATA ROOT ({root}).")
            print("")
            print("  That directory holds the live auth database and every")
            print("  production SQLite file on this machine.")
            print("")
            print("  Pass a sandbox path instead, e.g.:")
            print("      python scripts/hub_sandbox_boot.py --data-dir C:\\data-hubtest")
            print("")
            sys.exit(1)


def _sandbox_for(sandbox_root, literal):
    """`/data/cot.db` -> `<sandbox>/cot.db`; `/data` -> `<sandbox>`.

    Deliberately NOT conftest's `sandbox_for`: that one special-cases
    `/data/auth.db` to a per-SESSION temp store, which is right for a test run
    and wrong here. The device suite signs in as `hubtest@local.dev` and that
    account has to survive a restart, so auth.db lives in the persistent
    sandbox like everything else. `CALENDAR_SEEN_DB_PATH` also defaults to
    `/data/auth.db` and lands on the same file, which is the intended sharing.
    """
    tail = literal.replace("\\", "/").strip("/")
    tail = tail[len("data"):].strip("/")
    if not tail:
        return sandbox_root
    return os.path.join(sandbox_root, *tail.split("/"))


def _start_violation_reporter(conftest):
    """Print shared-root write attempts as they are recorded.

    ⭐ THE RAISE IS NOT THE GUARD; THE RECORD IS. A `SharedDataRootWrite` raised
    on a daemon thread reaches `threading.excepthook` and disappears — the
    server keeps serving and the operator sees a clean console. Four of the five
    leaks the pytest guard ever found were on background threads. This turns the
    silent record into something a human watching a terminal actually sees.
    """
    def _pump():
        seen = 0
        while True:
            time.sleep(2)
            records = conftest.SHARED_ROOT_VIOLATIONS
            while seen < len(records):
                rec = records[seen]
                seen += 1
                print("")
                print("  " + "!" * 68)
                print(f"  SHARED-ROOT WRITE BLOCKED: {rec['op']} -> {rec['path']}")
                print(f"  thread={rec['thread']}")
                for frame in rec["stack"][-6:]:
                    print(f"      {frame}")
                print("  " + "!" * 68)
                print("")

    threading.Thread(target=_pump, daemon=True, name="shared-root-reporter").start()


def apply_sandbox_env(sandbox, test_email="hubtest@local.dev",
                      reclaim_conftest_temp=True, allow_model_keys=False):
    """Point every shared-root path at `sandbox`; arm the tripwire. Returns pins.

    ⭐ SEPARATE FROM `main()` SO A RAIL CAN CALL IT. `tests/test_hub_sandbox_
    launcher.py` runs this against a temp directory and asserts every census pin
    landed outside the shared root. A sandbox whose only proof is "the server
    started and looked fine" is exactly what wrote to `C:\\data\\auth.db`.
    """
    # Importing conftest does three things, in this order, all of which we want:
    #   1. derives the census (env pins + the shared roots themselves)
    #   2. redirects every pinned var at a per-session TEMP sandbox
    #   3. ARMS THE TRIPWIRE on every write primitive
    # We keep (1) and (3) and re-point (2) at our persistent sandbox below.
    import conftest

    _refuse_shared_root(sandbox, conftest.SHARED_DATA_ROOTS)
    os.makedirs(sandbox, exist_ok=True)

    # Re-point every derived pin at the PERSISTENT sandbox. conftest aimed them
    # at a throwaway temp dir; a device suite needs the same store across runs.
    pins = {}
    for var, literal in conftest.SHARED_DATA_ENV_PINS.items():
        target = _sandbox_for(sandbox, literal)
        os.environ[var] = target
        pins[var] = target

    # conftest minted two temp directories on import that we have now replaced.
    # Best-effort cleanup so device runs do not add to the 5,209-directory /
    # 13 GB pile-up that once took this machine to zero bytes free.
    #
    # ⛔ OFF UNDER PYTEST. Inside a live pytest session those two directories are
    # not stale leftovers — they are the SESSION'S OWN isolated stores, and every
    # other test in the run is pointed at them. Deleting them here would blow up
    # unrelated suites from a rail that is supposed to be proving safety.
    if reclaim_conftest_temp:
        for stale in (conftest.SANDBOX_DATA_ROOT,
                      os.path.dirname(conftest.ISOLATED_AUTH_DB)):
            shutil.rmtree(stale, ignore_errors=True)

    os.environ["ADMIN_EMAILS"] = test_email
    os.environ["PUSH_SECRET"] = "hub-sandbox-local-only-not-the-real-secret"
    for key, value in KILL_LIST.items():
        os.environ[key] = value

    # Before `api.main` is imported, so no import-time reader or boot thread
    # sees a model key the caller did not opt in to.
    print(apply_model_key_policy(os.environ, allow_model_keys), flush=True)

    return pins


def _start_post_boot_compare(drs, baseline, log_file, port):
    """Re-hash the shared root once the server is actually serving, then ABORT
    the run if anything moved.

    ⭐ TIMED OFF THE HEALTH CHECK, NOT OFF A FIXED SLEEP, AND THEN HELD OPEN.
    The damaging writes in the incident landed 6-36 s after launch, and the
    darkpool / industry-map / ticker-logos prewarms are scheduled ~60 s and
    ~75 s after boot — so a compare that fires the moment the port opens would
    have declared victory before the risky work ran. This checks at ~15 s and
    again at ~120 s, which is past every scheduled prewarm.
    """
    import urllib.request

    def _serving():
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/health", timeout=3) as r:
                return r.status == 200
        except Exception:  # noqa: BLE001
            return False

    def _run():
        deadline = time.time() + 180
        while time.time() < deadline and not _serving():
            time.sleep(2)
        if not _serving():
            print("  [post-boot] server never became healthy; skipping compare.")
            return
        for label, delay in (("post-boot (+15s)", 15),
                             ("post-prewarm (+120s)", 105)):
            time.sleep(delay)
            diffs = drs.compare(baseline, drs.snapshot())
            drs.append_log(log_file, label, drs.DEFAULT_ROOT,
                           len(baseline), diffs)
            if diffs:
                drs._print_diffs(label, diffs)
                print("  ABORTING THE RUN. The sandbox reached live data.")
                os._exit(2)
            print(f"  [{label}] shared data root CLEAN "
                  f"({len(baseline)} db files byte-identical).")

    threading.Thread(target=_run, daemon=True, name="data-root-compare").start()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", default=r"C:\data-hubtest")
    ap.add_argument("--test-email", default="hubtest@local.dev")
    ap.add_argument("--port", type=int, default=8077)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--allow-model-keys", action="store_true",
                    help="pass ANTHROPIC/OPENAI/PERPLEXITY keys through (PAID model "
                         f"calls possible). Default blanks them. Env form: {ALLOW_MODEL_KEYS_ENV}=1")
    args = ap.parse_args()

    sandbox = os.path.abspath(args.data_dir)
    _refuse_port_in_use(args.port)

    # ⛔ THE SNAPSHOT IS THE FIRST THING THIS RUN REPORTS, BEFORE ANY HEALTH
    # CHECK. "Reports clean" is never evidence of "wrote nowhere" — the boot
    # that corrupted this project's trust printed a clean startup and a healthy
    # /api/health while writing to the live auth.db.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import data_root_snapshot as drs
    import sandbox_identity as sid

    # ⛔ A PORT IS NOT AN IDENTITY (tooling review M-3). This run's nonce is minted before
    # anything is served, written into the integrity log's pre-boot line, and served at
    # sid.IDENTITY_PATH, so a `--base` tool can prove the server it is about to write through
    # IS the sandbox that writes this log (`sandbox_identity.verify`) -- never "whatever
    # answers the port".
    nonce = sid.mint()
    log_file = drs.log_path_for(REPO_ROOT)
    baseline = drs.snapshot()
    drs.append_log(log_file, "pre-boot (baseline)", drs.DEFAULT_ROOT,
                   len(baseline), [], extra=sid.log_extra(sandbox, nonce))
    print("")
    print(f"  [pre-boot] shared data root baseline: {len(baseline)} db files "
          f"hashed (sha256)")
    print(f"  [pre-boot] integrity log: {log_file}")
    print(f"  [pre-boot] sandbox identity: {nonce} (served at {sid.IDENTITY_PATH})")

    pins = apply_sandbox_env(sandbox, args.test_email,
                             allow_model_keys=model_keys_opted_in(args.allow_model_keys))
    import conftest

    # Seed the synthetic wire fixture so Home / Wire / Breadth render something
    # for the device script to act on. Obviously synthetic by construction —
    # it must never be mistaken for a production snapshot.
    fixture = os.path.join(REPO_ROOT, "scripts", "fixtures", "wire_data.sample.json")
    target = os.path.join(sandbox, "wire_data.json")
    if os.path.exists(fixture) and not os.path.exists(target):
        shutil.copy(fixture, target)

    _start_violation_reporter(conftest)

    print("")
    print("  " + "-" * 68)
    print("  HUB SANDBOX")
    print("  " + "-" * 68)
    print(f"  Data dir     : {sandbox}")
    print(f"  Admin        : {args.test_email}")
    print(f"  URL          : http://localhost:{args.port}")
    print(f"  Path pins    : {len(pins)} env vars, DERIVED by AST from api/**")
    print(f"  Kill-list    : {len(KILL_LIST)} scheduler / outbound flags")
    print(f"  Guard mode   : {os.environ.get('UCT_TEST_SHARED_ROOT_GUARD', 'enforce')}")
    print(f"  Shared roots : {', '.join(conftest.SHARED_DATA_ROOTS)} (writes RAISE)")
    print("  " + "-" * 68)
    print("")
    print("  A 'SHARED-ROOT WRITE BLOCKED' banner below means the app tried to")
    print("  reach live data and was stopped. Report it; do not ignore it.")
    print("")

    _start_post_boot_compare(drs, baseline, log_file, args.port)

    import uvicorn
    try:
        # The app itself, wrapped so the identity path answers before any route does; every
        # other request and the lifespan pass through untouched (sandbox_identity.wrap_app).
        from api.main import app as _app
        uvicorn.run(sid.wrap_app(_app, sid.payload(
                        nonce, data_dir=sandbox, integrity_log=log_file, pid=os.getpid(),
                        started_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"))),
                    host=args.host, port=args.port, log_level="info")
    finally:
        # Shutdown checkpoint. A leak that only happens on teardown — a
        # checkpoint, a flush, an atexit handler — would be invisible to the
        # post-boot check alone.
        diffs = drs.compare(baseline, drs.snapshot())
        drs.append_log(log_file, "shutdown", drs.DEFAULT_ROOT,
                       len(baseline), diffs)
        if diffs:
            drs._print_diffs("shutdown", diffs)
            sys.exit(2)
        print(f"  [shutdown] shared data root CLEAN ({len(baseline)} db files "
              f"byte-identical). Log: {log_file}")


if __name__ == "__main__":
    main()
