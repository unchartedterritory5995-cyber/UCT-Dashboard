"""Lane 10E-2's sandbox driver: boot ONE census-pinned sandbox, keep it up until a STOP file
appears, stop it gracefully, and write the integrity verdict FIRST in its record.

Reuses the perf harness's `Sandbox` (the SIGBREAK shim, the launcher's own checkpoints and
`read_integrity`) -- never a second launcher. Run from POWERSHELL so the data dir keeps its
backslash:

    python docs/notebook/proof/e2-d9e887ca0/e2_sandbox.py 'C:\data-w10e2' 8216 <scratch-dir>

The sandbox environment is the production Notebook flag set as `docs/feature_flags.json`
records it armed on `web` (share links, publish, onboarding, personal API, image/docx
documents, writing help, Ask insert, inbound email), with NO model key: writing help and Ask
therefore answer their own failure sentences, which is what this lane reviews them for.
"""
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402

FLAGS = {
    "J2_SHARE_LINKS_ENABLED": "1",
    "NOTEBOOK_PUBLISH_ENABLED": "1",
    "NOTEBOOK_ONBOARDING_ENABLED": "1",
    "NOTEBOOK_PERSONAL_API_ENABLED": "1",
    "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "1",
    "NOTEBOOK_WRITING_HELP_ENABLED": "1",
    "NOTEBOOK_ASK_INSERT_ON": "1",
    "NOTEBOOK_INBOUND_EMAIL_ENABLED": "1",
    "ANTHROPIC_API_KEY": "",
    "OPENAI_API_KEY": "",
}


def main() -> int:
    data_dir, port, scratch = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3])
    scratch.mkdir(parents=True, exist_ok=True)
    stop_file = scratch / "STOP"
    if stop_file.exists():
        stop_file.unlink()
    os.environ.update(FLAGS)
    base = f"http://127.0.0.1:{port}"
    sb = h.Sandbox(data_dir, port, scratch / "launcher.log")
    sb.start()
    healthy = sb.wait_healthy(base, 600)
    post = sb.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S) if healthy else False
    ready = {"base": base, "healthy": healthy, "post_boot_checkpoint": post,
             "integrity_log": sb.integrity_path(), "flags": FLAGS, "started": time.time()}
    (scratch / "sandbox-ready.json").write_text(json.dumps(ready, indent=1), encoding="utf-8")
    deadline = time.time() + float(os.environ.get("E2_SANDBOX_MAX_S", "14400"))
    while healthy and sb.alive() and not stop_file.exists() and time.time() < deadline:
        time.sleep(2)
    how = sb.stop()
    integ = h.read_integrity(sb.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    final = {"integrity": integ.get("status"), "integrity_detail": integ, "stop": how,
             "integrity_log": sb.integrity_path(), "base": base, "healthy": healthy}
    (scratch / "sandbox-final.json").write_text(json.dumps(final, indent=1, default=str), encoding="utf-8")
    print("SANDBOX INTEGRITY:", integ.get("status"), "| stop:", how, flush=True)
    return 0 if integ.get("clean") else 1


if __name__ == "__main__":
    raise SystemExit(main())
