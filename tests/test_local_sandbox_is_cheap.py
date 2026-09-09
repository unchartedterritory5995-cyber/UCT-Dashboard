"""The verification sandbox must not cost 25 GB to start.

⛔⛔ WHY THIS EXISTS. `tools/local_backend_sandbox.py` is what every browser
verification in this program boots. It already turns off the worker, the
catalyst engine, the twitter poller and the bars prewarmer — and it did NOT
turn off `USE_REMOTE_BARS`, which arrives set from `.env`.

With that on, boot pulls the R2 bars snapshot: a multi-GB tarball streamed into
a `data_sync_*` TEMP directory and then extracted, ~25 GB a run. The product's
own "skip the boot pull, local SQLite already has bars" guard cannot help,
because every sandbox boot starts with a FRESH EMPTY `DATA_DIR` and the probe
therefore always says pull. And a sandbox that is force-killed — the normal way
a verification run ends — never reaches the `finally: rmtree`, so the directory
leaks.

Measured 2026-09-08: **23 leaked `data_sync_*` directories, ~215 GB**, from one
day of Wave N browser verification. The system drive went from 13.5 GB free to
**160 MB** across a handful of sandbox restarts, which is a machine-safety
problem long before it is a testing problem.

⭐ A browser check of the Notebook needs no real bars at all. This pins the
whole heavy-job OFF list so the next expensive default cannot be added silently.
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SANDBOX = ROOT / "tools" / "local_backend_sandbox.py"


@pytest.fixture(scope="module")
def sandbox_module():
    # Imported for its CONSTANTS only — `main()` is never called, so nothing
    # here starts a server or touches a path.
    spec = importlib.util.spec_from_file_location("_uct_sandbox_probe", SANDBOX)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestTheHeavyJobsAreOff:
    def test_remote_bars_are_off(self, sandbox_module):
        # ⛔ THE 25 GB ONE. Anything else on this list wastes CPU; this one
        # fills the owner's system drive.
        assert sandbox_module.OFF["USE_REMOTE_BARS"] == "0"

    @pytest.mark.parametrize("var", [
        "WORKER_ENABLED", "CATALYST_ENGINE_ENABLED", "TWITTERAPI_IO_ENABLED",
        "COMPASS_AUTOMATION_ENABLED", "AWARENESS_ENGINE_ENABLED",
        "BRAIN_PACK_ENABLED", "SCAN_SWEEP_ENABLED", "COT_PREWARM_ENABLED",
        "DESK_DAILY_SESSION_ENABLED", "BROKER_SYNC_ENABLED",
        "NOTE_SYNC_ENABLED", "MASSIVE_WS_ENABLED",
        "FUNDAMENTALS_MONITOR_ENABLED", "RECONCILE_ENABLED",
    ])
    def test_every_scheduled_workstream_stays_off(self, sandbox_module, var):
        assert sandbox_module.OFF[var] == "0"

    def test_the_prewarmers_stay_disabled(self, sandbox_module):
        assert sandbox_module.OFF["BARS_PREWARM_DISABLED"] == "1"
        assert sandbox_module.OFF["TICKER_NAMES_PREWARM_DISABLED"] == "1"


class TestTheOffListWins:
    def test_it_is_applied_BEFORE_the_dotenv_load(self, sandbox_module):
        # ⛔ ORDER IS THE WHOLE POINT. `load_dotenv` does not override an
        # existing variable, so `os.environ.update(OFF)` must run FIRST or
        # `.env`'s `USE_REMOTE_BARS=1` wins and the pull happens anyway.
        src = SANDBOX.read_text(encoding="utf-8")
        body = src[src.index("def main("):]
        assert body.index("os.environ.update(OFF)") < body.index("_load_env()"), (
            "the OFF list is applied after .env — a credential file can switch "
            "the heavy jobs back on")

    def test_the_gate_the_product_actually_reads_is_the_one_we_set(self):
        # ⭐ NON-VACUITY: pin that `USE_REMOTE_BARS` is genuinely the variable
        # `api/main.py` branches on. Turning off a variable nothing reads is
        # the shape of a guard that cannot fire.
        main_src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
        assert 'os.environ.get("USE_REMOTE_BARS") == "1"' in main_src
