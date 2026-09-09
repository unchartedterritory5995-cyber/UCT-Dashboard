"""Wave P5 lane B — what OCR costs the pod, and what it costs a member watching.

⛔⛔ THE QUESTION IS NOT "HOW FAST IS TESSERACT". P1.5 already measured that
(0.3s/page on the reference corpus). The question activation actually turns on
is different and nobody has asked it: while a document is being read, does the
pod stay a pod? Memory, and the latency of the member-facing reads that share
its single event loop and its one thread pool.

⛔ LOCALHOST ONLY, AND IT REFUSES OTHERWISE. This drives a fail-closed local
sandbox (`tools/local_backend_sandbox.py --ocr`). It uploads synthetic pages and
polls the real routes; it must never be pointed at a member-serving service, so
a non-loopback host is refused rather than warned about.

⛔ SYNTHETIC PAGES ONLY, from `tools/wave_p_fixtures.py`. No member document.

WHAT IT MEASURES, per (pages x concurrency):

    wall seconds, seconds/page   the throughput a member's "still reading…" waits on
    RSS before / peak / after    the number that decides whether this fits beside
                                 everything else on one 8 GB pod
    CPU seconds                  what it takes from every other request
    member read latency          p50/p95/max of a real authenticated search WHILE
                                 the OCR runs — the honest "is the app still usable"
    DATA_DIR bytes delta         what a scanned document costs on the volume
    stray files                  §26's no-temp-surface property, re-measured under
                                 load rather than assumed from the adapter's shape

    python tools/wave_p5_ocr_load.py --port 8077
    python tools/wave_p5_ocr_load.py --port 8077 --pages 1,10 --concurrency 1
"""
from __future__ import annotations

import argparse
import ctypes
import importlib.util
import io
import json
import os
import pathlib
import statistics
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "tools" / "wave_p5_load_out"

_spec = importlib.util.spec_from_file_location("fx", ROOT / "tools" / "wave_p_fixtures.py")
fx = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fx)

EMAIL = "p5load@local.dev"
PASSWORD = "LocalTest2026!"


# ─────────────────────────────────────────────────────────────────────────────
# Process sampling. ⛔ No psutil on this box, and adding a dependency to measure
# a dependency-free feature is its own kind of wrong.
# ─────────────────────────────────────────────────────────────────────────────
class _Mem(ctypes.Structure):
    _fields_ = [("cb", ctypes.c_uint32), ("PageFaultCount", ctypes.c_uint32),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t)]


def _open(pid: int):
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ = 0x1000, 0x0010
    h = ctypes.windll.kernel32.OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, False, pid)
    if not h:
        raise OSError(f"cannot open pid {pid}")
    return h


def rss_bytes(pid: int) -> int:
    """Resident set of the backend, right now."""
    if sys.platform == "win32":
        h = _open(pid)
        try:
            m = _Mem(); m.cb = ctypes.sizeof(_Mem)
            if not ctypes.windll.psapi.GetProcessMemoryInfo(
                    h, ctypes.byref(m), ctypes.sizeof(m)):
                raise OSError("GetProcessMemoryInfo failed")
            return int(m.WorkingSetSize)
        finally:
            ctypes.windll.kernel32.CloseHandle(h)
    for line in pathlib.Path(f"/proc/{pid}/status").read_text().splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) * 1024
    raise OSError("VmRSS not found")


def cpu_seconds(pid: int) -> float:
    """User+kernel CPU the backend has burned since it started."""
    if sys.platform == "win32":
        h = _open(pid)
        try:
            c, e, k, u = (ctypes.c_ulonglong() for _ in range(4))
            if not ctypes.windll.kernel32.GetProcessTimes(
                    h, ctypes.byref(c), ctypes.byref(e),
                    ctypes.byref(k), ctypes.byref(u)):
                raise OSError("GetProcessTimes failed")
            return (k.value + u.value) / 1e7   # 100ns ticks
        finally:
            ctypes.windll.kernel32.CloseHandle(h)
    parts = pathlib.Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()
    return (int(parts[11]) + int(parts[12])) / os.sysconf("SC_CLK_TCK")


def pid_on_port(port: int) -> int | None:
    """The listening backend, found rather than assumed."""
    import subprocess
    if sys.platform == "win32":
        out = subprocess.run(["netstat", "-ano", "-p", "TCP"],
                             capture_output=True, text=True).stdout
        for line in out.splitlines():
            f = line.split()
            if len(f) >= 5 and f[3] == "LISTENING" and f[1].endswith(f":{port}"):
                return int(f[4])
        return None
    out = subprocess.run(["ss", "-ltnp", f"sport = :{port}"],
                         capture_output=True, text=True).stdout
    for tok in out.split():
        if tok.startswith("pid="):
            return int(tok.split("=")[1].split(",")[0])
    return None


# ─────────────────────────────────────────────────────────────────────────────
# The client
# ─────────────────────────────────────────────────────────────────────────────
class Client:
    def __init__(self, base: str):
        self.base = base
        self.cookie = ""

    def call(self, path, data=None, *, method=None, files=None, timeout=180):
        url = self.base + path
        headers = {"User-Agent": "uct-p5-load"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        body = None
        if files is not None:
            boundary = "----uctp5load"
            name, filename, content, ctype = files
            buf = io.BytesIO()
            buf.write(f"--{boundary}\r\n".encode())
            buf.write(f'Content-Disposition: form-data; name="{name}"; '
                      f'filename="{filename}"\r\n'.encode())
            buf.write(f"Content-Type: {ctype}\r\n\r\n".encode())
            buf.write(content)
            buf.write(f"\r\n--{boundary}--\r\n".encode())
            body = buf.getvalue()
            headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        elif data is not None:
            body = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=headers,
                                     method=method or ("POST" if body else "GET"))
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                sc = r.headers.get_all("Set-Cookie") or []
                if sc:
                    self.cookie = "; ".join(c.split(";")[0] for c in sc)
                payload = r.read()
                return r.status, json.loads(payload or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, {"error": e.read().decode()[:200]}

    def sign_in(self):
        self.call("/api/auth/signup", {"email": EMAIL, "password": PASSWORD,
                                       "display_name": "P5 load"})
        st, _ = self.call("/api/auth/login", {"email": EMAIL, "password": PASSWORD})
        if st != 200:
            raise SystemExit(f"login failed: {st}")


# ─────────────────────────────────────────────────────────────────────────────
# One round
# ─────────────────────────────────────────────────────────────────────────────
def n_page_scan(pages: int) -> bytes:
    """`pages` copies of the clean fixture page, as one scanned PDF."""
    img, _ = fx.page_clean()
    return fx._images_to_scanned_pdf([img] * pages)


def dir_bytes(p: pathlib.Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def file_set(p: pathlib.Path, *, skip: pathlib.Path | None = None) -> set[str]:
    # ⛔ `skip` exists because the sandbox's own DATA_DIR is created with
    # `mkdtemp`, i.e. INSIDE whatever TEMP it was started with. Without it
    # every page of stored text would read as a stray temp file and the
    # no-temp-surface line would be permanently, uselessly red.
    out = set()
    for f in p.rglob("*"):
        if not f.is_file():
            continue
        if skip is not None:
            try:
                f.relative_to(skip)
                continue
            except ValueError:
                pass
        out.add(str(f.relative_to(p)))
    return out


def run_round(cli: Client, note_id: str, *, pages: int, concurrency: int,
              pid: int, data_dir: pathlib.Path, tmp_dir: pathlib.Path,
              selftest: bool = False) -> dict:
    pdf = n_page_scan(pages)
    before_bytes = dir_bytes(data_dir)
    # ⛔ THE TEMP DIRECTORY ONLY. §26's property is that the adapter streams
    # a page through stdin/stdout and never writes a scratch file; DATA_DIR is
    # where the app is SUPPOSED to put things, and watching it here reported
    # the bars cache writing `index_bars_cache/DJX_D.json` as an OCR leak.
    # What the volume costs is measured separately, in bytes.
    before_files = file_set(tmp_dir, skip=data_dir)
    rss0, cpu0 = rss_bytes(pid), cpu_seconds(pid)

    stop = threading.Event()
    peak = [rss0]
    latencies: list[float] = []

    def sample_rss():
        while not stop.is_set():
            try:
                peak[0] = max(peak[0], rss_bytes(pid))
            except OSError:
                pass
            stop.wait(0.5)

    def sample_member_read():
        # ⛔ A REAL member-facing authenticated read, on the same loop and the
        # same thread pool the OCR job competes for. A synthetic /health ping
        # would answer a question nobody asked.
        probe = Client(cli.base)
        probe.cookie = cli.cookie
        while not stop.is_set():
            t0 = time.perf_counter()
            probe.call("/api/j2/notes/documents/search?q=revenue", timeout=30)
            latencies.append(time.perf_counter() - t0)
            stop.wait(0.25)

    threads = [threading.Thread(target=sample_rss, daemon=True),
               threading.Thread(target=sample_member_read, daemon=True)]
    for t in threads:
        t.start()

    if selftest:
        # THE CONTROL. A "no stray files" line that has never been seen to
        # go red is indistinguishable from a probe looking in the wrong place.
        (tmp_dir / "uct-p5-selftest.tmp").write_bytes(b"probe")

    t_start = time.perf_counter()
    doc_names = []
    for i in range(concurrency):
        name = f"load-{pages}p-{concurrency}c-{i}-{int(time.time())}.pdf"
        st, _ = cli.call(f"/api/j2/notes/{note_id}/attachments",
                         files=("file", name, pdf, "application/pdf"))
        if st != 200:
            stop.set()
            raise SystemExit(f"upload failed ({st}) for {pages}p — "
                             f"{len(pdf)/1e6:.1f} MB")
        doc_names.append(name)

    # Poll until every document this round uploaded reports textComplete.
    deadline = time.perf_counter() + 900
    finished: dict[str, float] = {}
    while len(finished) < len(doc_names):
        if time.perf_counter() > deadline:
            stop.set()
            raise SystemExit(f"timed out: {pages}p x{concurrency}")
        st, docs = cli.call(f"/api/j2/notes/{note_id}/documents")
        for d in (docs.get("documents") or []):
            n = d.get("name")
            if n in doc_names and n not in finished and d.get("textComplete"):
                finished[n] = time.perf_counter() - t_start
        time.sleep(0.5)
    wall = time.perf_counter() - t_start

    stop.set()
    for t in threads:
        t.join(timeout=3)
    time.sleep(1.0)   # let the writer settle before measuring the volume

    after_files = file_set(tmp_dir, skip=data_dir)
    lat = sorted(latencies)

    def q(p):
        return round(lat[min(len(lat) - 1, int(len(lat) * p))] * 1000, 1) if lat else None

    return {
        "pages": pages,
        "concurrency": concurrency,
        "pdf_bytes": len(pdf),
        "wall_seconds": round(wall, 2),
        "seconds_per_page": round(wall / (pages * concurrency), 3),
        "per_document_seconds": {k: round(v, 2) for k, v in finished.items()},
        "rss_mb": {"before": round(rss0 / 1e6, 1),
                   "peak": round(peak[0] / 1e6, 1),
                   "after": round(rss_bytes(pid) / 1e6, 1),
                   "growth": round((rss_bytes(pid) - rss0) / 1e6, 1)},
        "cpu_seconds": round(cpu_seconds(pid) - cpu0, 2),
        "member_read_ms": {"samples": len(lat), "p50": q(0.5),
                           "p95": q(0.95), "max": round(lat[-1] * 1000, 1) if lat else None},
        "data_dir_delta_bytes": dir_bytes(data_dir) - before_bytes,
        # ⛔ §26 — re-measured under load, not inherited from the adapter's shape.
        "new_temp_files": sorted(after_files - before_files)[:12],
    }


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8077)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--pages", default="1,10,50,100")
    ap.add_argument("--concurrency", default="1,2")
    ap.add_argument("--pid", type=int, default=None)
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--temp-dir", default=None,
                    help="a PRIVATE temp directory the sandbox was started with "
                         "(TEMP/TMP). The shared system temp is refused.")
    ap.add_argument("--selftest-temp-file", action="store_true",
                    help="drop one file into the watched temp dir mid-round, to "
                         "prove the no-temp-surface probe can actually fire")
    ap.add_argument("--label", default="local")
    args = ap.parse_args()

    # ⛔ NOT NEGOTIABLE. A load harness that can be aimed at production is a
    # production incident with a command-line flag.
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"REFUSING: {args.host!r} is not loopback. This drives a local "
              "fail-closed sandbox and nothing else.", file=sys.stderr)
        return 2

    base = f"http://{args.host}:{args.port}"
    pid = args.pid or pid_on_port(args.port)
    if not pid:
        print(f"REFUSING: nothing is listening on {args.port}. Start "
              "`python tools/local_backend_sandbox.py --ocr` first — a run that "
              "silently measures nothing reads as a pass.", file=sys.stderr)
        return 2

    cli = Client(base)
    cli.sign_in()
    st, ready = cli.call("/api/j2/notes/documents/search?q=x")
    if st != 200:
        print(f"REFUSING: the member search route answered {st}.", file=sys.stderr)
        return 2

    data_dir = pathlib.Path(args.data_dir) if args.data_dir else None
    if data_dir is None:
        st, diag = cli.call("/api/health")
        data_dir = pathlib.Path(os.environ.get("DATA_DIR", "")) if os.environ.get("DATA_DIR") else None
    if data_dir is None or not data_dir.exists():
        print("REFUSING: pass --data-dir pointing at the sandbox's DATA_DIR. "
              "The volume-cost number is half the point of this run.",
              file=sys.stderr)
        return 2

    # ⚰️ THE FIRST VERSION WATCHED THE SHARED SYSTEM TEMP AND REPORTED A STRAY
    # FILE THAT WAS NOT OURS. That directory already held seventeen GUID-named
    # zero-byte .tmp files from other software before this harness ever ran, so
    # a new one appearing there during a round proves nothing about OCR. A probe
    # that cannot attribute what it finds is not a probe — it is a coin flip
    # that will eventually be read as a defect.
    if not args.temp_dir:
        print("REFUSING: pass --temp-dir pointing at a PRIVATE temp directory "
              "the sandbox was started with (TEMP/TMP). The no-temp-surface "
              "property cannot be measured against a directory every process on "
              "the machine writes to.", file=sys.stderr)
        return 2
    tmp_dir = pathlib.Path(args.temp_dir).resolve()
    if tmp_dir == pathlib.Path(tempfile.gettempdir()).resolve():
        print("REFUSING: --temp-dir is the shared system temp. Nothing found "
              "there could be attributed to this run.", file=sys.stderr)
        return 2
    tmp_dir.mkdir(parents=True, exist_ok=True)
    st, note = cli.call("/api/j2/notes", {
        "title": f"P5 load {args.label}",
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
    note_id = ((note or {}).get("note") or {}).get("id")
    if not note_id:
        print(f"REFUSING: could not create a note ({st}).", file=sys.stderr)
        return 2

    page_list = [int(x) for x in args.pages.split(",") if x.strip()]
    conc_list = [int(x) for x in args.concurrency.split(",") if x.strip()]

    print(f"backend pid {pid} · DATA_DIR {data_dir}")
    print(f"{'pages':>6} {'conc':>5} {'MB':>6} {'wall s':>8} {'s/page':>7} "
          f"{'RSS peak':>9} {'RSS grow':>9} {'CPU s':>7} "
          f"{'read p50':>9} {'read p95':>9} {'read max':>9} {'vol MB':>7}")
    print("-" * 108)

    rounds = []
    for conc in conc_list:
        for pages in page_list:
            r = run_round(cli, note_id, pages=pages, concurrency=conc, pid=pid,
                          data_dir=data_dir, tmp_dir=tmp_dir,
                          selftest=args.selftest_temp_file)
            rounds.append(r)
            m = r["member_read_ms"]
            print(f"{r['pages']:>6} {r['concurrency']:>5} "
                  f"{r['pdf_bytes']/1e6:>6.1f} {r['wall_seconds']:>8.2f} "
                  f"{r['seconds_per_page']:>7.3f} "
                  f"{r['rss_mb']['peak']:>9.1f} {r['rss_mb']['growth']:>9.1f} "
                  f"{r['cpu_seconds']:>7.2f} "
                  f"{str(m['p50']):>9} {str(m['p95']):>9} {str(m['max']):>9} "
                  f"{r['data_dir_delta_bytes']/1e6:>7.1f}")
            if r["new_temp_files"]:
                print(f"       [X] files appeared in the temp directory: "
                      f"{r['new_temp_files']}")

    OUT_DIR.mkdir(exist_ok=True)
    report = {"label": args.label, "pid": pid, "platform": sys.platform,
              "data_dir": str(data_dir), "rounds": rounds}
    (OUT_DIR / f"{args.label}.json").write_text(json.dumps(report, indent=2),
                                                encoding="utf-8")
    strays = [r for r in rounds if r["new_temp_files"]]
    print(f"\nwrote {OUT_DIR / (args.label + '.json')}")
    print("no temp surface: "
          + ("CLEAN across every round" if not strays
             else f"{len(strays)} round(s) left files behind"))
    return 1 if strays else 0


if __name__ == "__main__":
    raise SystemExit(main())
