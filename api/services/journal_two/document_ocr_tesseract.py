"""Wave P1.5 §29/§30 — the Tesseract adapter. Engine-specific code lives HERE.

⛔ THE CONTRACT IS IN `document_ocr`, NOT IN THIS FILE. Page storage, the
FTS-safe write, job state, recovery, readiness and the usability gate are all
engine-independent and must stay that way: this module conforms to
`OcrPageResult`, and nothing about Tesseract's API shape is allowed to leak back
into how a page is stored or searched. The engine is replaceable; the product
contract is not.

⛔ SUBPROCESS, NEVER A SHELL (§30). The argument vector is fixed and contains no
member-influenced string — no filename, no document title, no annotation, no
OCR text. The page image goes in on STDIN and text comes back on STDOUT, so
there is no path for a client to name, and no temp file to leak (§32).

⛔ BOUNDED. A hung engine must not hold a worker thread forever, and a
pathological page must not return unbounded output.

⛔ DARK BY DEFAULT. Nothing here installs itself. `install_if_enabled()` is
called once at startup and does nothing unless the capability flag is on AND
the binary actually answers — so a build without Tesseract, or a deployment
with the flag off, leaves `document_ocr.ocr_available()` false and the product
keeps telling the truth about scanned documents.
"""
from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess

from api.services.journal_two import document_ocr

log = logging.getLogger(__name__)

# ⛔ ONE flag, specific to this capability. It must never be overloaded onto
# WORKER_ENABLED or any other service switch, and it gates EXECUTION only —
# page-truth readiness, `no_text` semantics and the FTS invariants are correct
# with it on or off.
FLAG = "J2_OCR_ENABLED"

ENGINE_NAME = "tesseract"
# A page that has not finished in this long is not slow, it is stuck. The
# benchmark measured 0.34-0.60s per page.
PAGE_TIMEOUT_SECONDS = 60
# A page of dense text is a few thousand characters. Far past that is a
# malfunction, not a filing.
MAX_OUTPUT_CHARS = 200_000


def binary_path() -> str | None:
    """Where the engine is, or None. Honours an explicit override, then PATH,
    then the two conventional install locations."""
    explicit = os.environ.get("TESSERACT_BINARY")
    if explicit and os.path.exists(explicit):
        return explicit
    found = shutil.which("tesseract")
    if found:
        return found
    for candidate in ("/usr/bin/tesseract", "/usr/local/bin/tesseract"):
        if os.path.exists(candidate):
            return candidate
    return None


def engine_version(binary: str | None = None) -> str | None:
    """`tesseract --version`'s first line, or None if it does not answer.

    ⛔ THIS IS THE CAPABILITY PROBE, and it runs the real binary rather than
    checking that a file exists. A present-but-broken executable must read as
    absent, not as available.
    """
    binary = binary or binary_path()
    if not binary:
        return None
    try:
        out = subprocess.run([binary, "--version"], stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, timeout=20)
    except Exception:  # noqa: BLE001
        return None
    if out.returncode != 0:
        return None
    first = out.stdout.decode("utf-8", "replace").splitlines()
    return first[0].strip() if first else None


def make_adapter(binary: str, version: str) -> document_ocr.OcrAdapter:
    def adapter(image) -> document_ocr.OcrPageResult:
        buf = io.BytesIO()
        # Greyscale PNG: lossless, and the engine wants no colour.
        image.convert("L").save(buf, format="PNG")
        proc = subprocess.run(
            # ⛔ A FIXED ARGUMENT VECTOR. `stdin`/`stdout` are Tesseract's own
            # literals for the streams, not paths, and `-l eng` is the only
            # certified language (§30/§16). Nothing here is member-controlled.
            [binary, "stdin", "stdout", "-l", "eng"],
            input=buf.getvalue(), stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=PAGE_TIMEOUT_SECONDS,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"tesseract exited {proc.returncode}")   # ⛔ stderr is NOT
            # logged or raised: it can echo page content, and §33 forbids
            # private document text in logs.
        text = proc.stdout.decode("utf-8", "replace")[:MAX_OUTPUT_CHARS]
        return document_ocr.OcrPageResult(text=text, engine=ENGINE_NAME,
                                          engine_version=version)
    return adapter


def install_if_enabled() -> dict[str, object]:
    """Wire the engine, or truthfully decline to.

    ⭐ THE THREE STATES ARE DISTINGUISHED ON PURPOSE, because "OCR is off" and
    "OCR was meant to be on and the binary is missing" are different operational
    facts and only one of them is a defect.
    """
    enabled = os.environ.get(FLAG, "0").strip() == "1"
    binary = binary_path()
    version = engine_version(binary) if binary else None
    state = {"flag": enabled, "binary": binary, "version": version,
             "active": False}
    if not enabled:
        # Dark. The binary may well be present — that is what the packaging
        # canary is for — but nothing is wired.
        return state
    if not version:
        log.warning("[doc-ocr] %s=1 but no usable tesseract binary was found "
                    "— OCR stays unavailable", FLAG)
        return state
    document_ocr.set_adapter(make_adapter(binary, version))
    state["active"] = True
    return state


def startup_fingerprint() -> str:
    """One grep-able line, for verifying a build without processing anything.

    ⛔ It reports the CAPABILITY, never a member document. This is how the dark
    packaging canary proves Tesseract reached the web image while OCR itself
    stays off.
    """
    binary = binary_path()
    version = engine_version(binary) if binary else None
    # ⛔ THE OPERATING POINT BELONGS ON THE SAME LINE AS THE CAPABILITY. At
    # release the owner set the first member-facing concurrency to ONE, and a
    # setting nobody can read from the deploy log is a setting that drifts.
    return ("[startup] j2-ocr: flag={flag} binary={binary} version={version} "
            "active={active} max_concurrency={conc}").format(
        flag=os.environ.get(FLAG, "0").strip(),
        binary=binary or "absent",
        version=(version or "none").replace(" ", "_"),
        active=document_ocr.ocr_available(),
        conc=document_ocr.OCR_MAX_CONCURRENCY)
