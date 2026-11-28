"""The REAL multi-process bars-api (`BARS_API_WORKERS=N`, uvicorn workers on one socket) under the replay sandbox.
Usage: python launch_workers.py <port> <src_dir> <workers>"""
import os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
port, src, n = int(sys.argv[1]), os.path.abspath(sys.argv[2]), int(sys.argv[3])
data = os.path.join(HERE, "data_%d" % port)
os.makedirs(data, exist_ok=True)
open(os.path.join(data, "bars.db"), "ab").close()
env = {k: v for k, v in os.environ.items() if not any(t in k.upper() for t in (
    "MASSIVE", "POLYGON", "R2_", "AWS_", "S3_", "FMP", "FINNHUB", "OPENAI", "ANTHROPIC", "PUSH_SECRET",
    "DATABASE_URL", "DATA_SYNC"))}
env.update({"REPLAY_SANDBOX": "1", "PYTHONPATH": os.path.join(HERE, "sandbox") + os.pathsep + src,
            "DATA_DIR": data, "BARS_API_ENABLED": "1", "PORT": str(port), "BARS_API_WORKERS": str(n),
            "BARS_API_LEADER_PORT": str(port + 900), "HTTP_PROXY": "http://127.0.0.1:9",
            "HTTPS_PROXY": "http://127.0.0.1:9", "NO_PROXY": "127.0.0.1,localhost", "BARS_OFFGRID_SWEEP": "0",
            "BARS_API_LISTEN_HOST": "127.0.0.1"})   # loopback only: the sandbox is never on the LAN
sys.exit(subprocess.call([sys.executable, "-m", "api.bars_api_main"], cwd=src, env=env))
