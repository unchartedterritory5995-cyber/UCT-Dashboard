"""bench-bars (the Railway `capacity-bench` environment ONLY): a synthetic store, then bars-api under the replay sandbox,
restarted with a new BARS_API_WORKERS whenever /tmp/bench/workers changes (so a sweep needs no redeploy).

The sandbox (`sandbox/sitecustomize.py`) holds here as on the dev box: the store is opened read-only + immutable, every
outbound socket that is not loopback is refused (no vendor, no R2), so nothing this service runs can reach a provider or
production. Inbound (the bench-loadgen service over Railway's private network) is untouched.

Never run this in production: it refuses when RAILWAY_ENVIRONMENT_NAME is not `capacity-bench`.
"""
import os
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BENCH = "/tmp/bench"
STORE_DIR = os.path.join(BENCH, "store")
DATA = os.path.join(BENCH, "data")
CTL = os.path.join(BENCH, "workers")


def _sampler():
    """Every 2 s: container memory (cgroup v2 memory.current, anon / file split) and tasks (pids.current, the limit
    Railway enforces) to /tmp/bench/samples.txt, for the per-level and night-job peaks."""
    import threading

    def _read(p):
        try:
            with open(p) as f:
                return f.read().strip()
        except OSError:
            return ""

    def _loop():
        while True:
            st = dict(ln.split() for ln in _read("/sys/fs/cgroup/memory.stat").splitlines() if " " in ln)
            line = "%d mem=%s anon=%s file=%s pids=%s workers=%s" % (
                time.time(), _read("/sys/fs/cgroup/memory.current"), st.get("anon", ""), st.get("file", ""),
                _read("/sys/fs/cgroup/pids.current"), _read(CTL))
            with open(os.path.join(BENCH, "samples.txt"), "a") as f:
                f.write(line + chr(10))
            time.sleep(2)
    threading.Thread(target=_loop, daemon=True, name="bench-sampler").start()


def main():
    env_name = os.environ.get("RAILWAY_ENVIRONMENT_NAME", "")
    if env_name != "capacity-bench":
        sys.exit("bench_server refuses to run outside the capacity-bench environment (got %r)" % env_name)
    os.makedirs(DATA, exist_ok=True)
    _sampler()
    if not os.path.exists(os.path.join(STORE_DIR, "bars.db")):
        # >= 2,000 tickers: bars_api_main's boot treats a store with fewer as "sparse" and removes it
        subprocess.run([sys.executable, os.path.join(HERE, "synth_store.py"), STORE_DIR, "--daily", "2200",
                        "--intraday", "500"], check=True, cwd=REPO)
    open(os.path.join(DATA, "bars.db"), "ab").close()           # the placeholder the sandbox maps to the store
    if not os.path.exists(CTL):
        with open(CTL, "w") as f:
            f.write("1")
    strip = ("MASSIVE", "POLYGON", "R2_", "AWS_", "S3_", "FMP", "FINNHUB", "OPENAI", "ANTHROPIC", "PUSH_SECRET",
             "DATABASE_URL", "DATA_SYNC", "DISCORD", "STRIPE", "SUPABASE", "JWT", "SESSION", "SCHWAB", "SECRET",
             "TOKEN", "API_KEY", "PASSWORD", "RESEND", "TWITTER", "PERPLEXITY", "LOGODEV", "CLOUDFLARE")
    proc, cur = None, None
    while True:
        want = (open(CTL).read().strip() or "1")
        if want != cur or proc is None or proc.poll() is not None:
            if proc is not None and proc.poll() is None:
                proc.send_signal(signal.SIGTERM)
                try:
                    proc.wait(15)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
            for f in os.listdir(DATA):                         # a fresh DATA_DIR per level (locks, views, tokens)
                if f != "bars.db":
                    p = os.path.join(DATA, f)
                    if os.path.isfile(p):
                        os.remove(p)
            env = {k: v for k, v in os.environ.items() if not any(t in k.upper() for t in strip)}
            env.update({"REPLAY_SANDBOX": "1", "REPLAY_STORE": os.path.join(STORE_DIR, "bars.db"),
                        "PYTHONPATH": os.path.join(HERE, "sandbox") + os.pathsep + REPO, "DATA_DIR": DATA,
                        "BARS_API_ENABLED": "1", "BARS_API_WORKERS": want, "BARS_OFFGRID_SWEEP": "0",
                        "BARS_API_LISTEN_HOST": os.environ.get("BARS_API_LISTEN_HOST", "::"),
                        "TMPDIR": os.path.join(BENCH, "tmp")})
            os.makedirs(env["TMPDIR"], exist_ok=True)
            print("[bench] starting bars-api with BARS_API_WORKERS=%s" % want, flush=True)
            proc = subprocess.Popen([sys.executable, "-m", "api.bars_api_main"], cwd=REPO, env=env)
            cur = want
        time.sleep(1)


if __name__ == "__main__":
    main()
