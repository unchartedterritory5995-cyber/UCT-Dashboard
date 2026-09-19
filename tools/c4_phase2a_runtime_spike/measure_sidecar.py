"""tools/c4_phase2a_runtime_spike/measure_sidecar.py

Candidate A, measured from the side that has to live with it: the Python
backend. Answers three questions the architecture decision turns on.

  1. What does the sidecar cost to START?  (once per pod, or once per scan?)
  2. What does a round trip cost when the bars are already on the Node side?
     (isolates dispatch from pipe)
  3. What does it cost when Python SHIPS the bars?  (what a real screener pays)

⛔ MEASUREMENT INSTRUMENT. Not the integration.
"""

import json
import math
import struct
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent


class Sidecar:
    def __init__(self):
        t0 = time.perf_counter()
        self.p = subprocess.Popen(
            ["node", str(HERE / "sidecar.mjs")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            cwd=str(HERE),
        )
        self.spawn_ms = (time.perf_counter() - t0) * 1000.0
        # first ping = the real "ready" moment (module load + JIT warm)
        t1 = time.perf_counter()
        self.call({"op": "ping"})
        self.ready_ms = (time.perf_counter() - t1) * 1000.0

    def call(self, obj):
        body = json.dumps(obj).encode()
        self.p.stdin.write(struct.pack("<I", len(body)) + body)
        self.p.stdin.flush()
        head = self._read_exact(4)
        n = struct.unpack("<I", head)[0]
        return json.loads(self._read_exact(n))

    def _read_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.p.stdout.read(n - len(buf))
            if not chunk:
                raise RuntimeError("sidecar closed")
            buf += chunk
        return buf

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=5)
        except Exception:
            self.p.kill()


def synth(n):
    close = []
    p = 100.0
    for i in range(n):
        p += math.sin(i / 7) * 0.4 + math.cos(i / 13) * 0.2
        close.append(p)
    return [[c - 0.1 for c in close], [c + 0.5 for c in close],
            [c - 0.5 for c in close], close]


def main():
    program = json.loads((HERE / "program.json").read_text())
    sc = Sidecar()
    print(f"spawn                       {sc.spawn_ms:8.1f} ms")
    print(f"first ping (module + JIT)   {sc.ready_ms:8.1f} ms")

    r = sc.call({"op": "compile", "program": program})
    print(f"compile (ship program once) {r['instructions']:>5} instructions")

    # round-trip floor
    t = []
    for _ in range(200):
        a = time.perf_counter()
        sc.call({"op": "ping"})
        t.append((time.perf_counter() - a) * 1e6)
    t.sort()
    print(f"round-trip floor (ping)     {t[len(t)//2]:8.1f} us  median  "
          f"(p95 {t[int(len(t)*0.95)]:.1f})")

    # bars already Node-side: dispatch only
    for symbols in (1, 500, 5000):
        a = time.perf_counter()
        r = sc.call({"op": "run", "bars": 300, "symbols": symbols})
        wall = (time.perf_counter() - a) * 1000.0
        print(f"run {symbols:>5} sym x 300 bars   wall {wall:9.1f} ms   "
              f"node-compute {r['computeMs']:9.1f} ms   "
              f"overhead {wall - r['computeMs']:7.1f} ms")

    # Python ships the bars: what a real screener pays per symbol
    series = synth(300)
    t = []
    for _ in range(50):
        a = time.perf_counter()
        sc.call({"op": "run_with_bars", "series": series})
        t.append((time.perf_counter() - a) * 1000.0)
    t.sort()
    per = t[len(t) // 2]
    print(f"run_with_bars 1 sym x 300   {per:8.2f} ms median per symbol "
          f"(JSON bars over the pipe)")
    print(f"  -> 5,000 symbols shipped this way: {per * 5000 / 1000:.1f} s")

    sc.close()


if __name__ == "__main__":
    main()
