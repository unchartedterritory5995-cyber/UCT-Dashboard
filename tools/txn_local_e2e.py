"""Trade Exchange News — LOCAL synthetic end-to-end run (Checkpoint D1).

Real processes, real sockets, a real browser; only Trade Exchange and Railway are
absent:
  receiver  services/trade_exchange_news_receiver/txn_serve.py   (the real entrypoint)
  web       tools/txn_e2e_web.py   (the real router + pipeline + reconciler, stub admin)
  journal   a FileJournal directory standing in for R2
  browser   Chromium on app/news-compare-harness.html?live=1 via vite.txn-e2e.config.mjs

    python tools/txn_local_e2e.py --out <dir>

Scenario (each step asserted, results in <out>/e2e.json, screenshots beside it):
  live delivery to 3 widgets in 2 browser pages · web crash + restart (recovery,
  order, `delayed`) · receiver restart · R2 outage + receiver restart + R2 back
  (web's repair pass rewrites the journal) · duplicate delivery · browser reload
  (history replay) · unauthorised-equivalent check is in the pytest suite.

⛔ Synthetic only, and sandboxed: every data path is a fresh temp directory and
the web process refuses any path under C:\\data. The webhook secret is minted
per run, kept in memory, and never printed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import httpx

REPO = pathlib.Path(__file__).resolve().parents[1]
RECEIVER_DIR = REPO / "services" / "trade_exchange_news_receiver"
APP_DIR = REPO / "app"
PY = sys.executable


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        if os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
        else:
            proc.kill()
        proc.wait(10)


def wait_http(url: str, ok=lambda r: r.status_code == 200, timeout: float = 60.0) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if ok(httpx.get(url, timeout=2)):
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.25)
    raise TimeoutError(url)


class Run:
    def __init__(self, out: pathlib.Path) -> None:
        self.out = out
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="txn-e2e-"))
        self.journal = self.tmp / "journal"
        self.events = self.journal / "trade-exchange-news" / "v1" / "events"
        self.token = "txn_" + secrets.token_urlsafe(32)
        self.ingest = secrets.token_urlsafe(32)
        self.web_port, self.rx_port, self.vite_port = free_port(), free_port(), free_port()
        self.steps: list[dict] = []
        self.procs: dict[str, subprocess.Popen] = {}
        base = {k: v for k, v in os.environ.items() if not k.startswith(("TXN_", "RAILWAY_"))}
        common = {"TXN_STORAGE_PERMISSION_CONFIRMED": "1", "TXN_JOURNAL": "file",
                  "TXN_JOURNAL_DIR": str(self.journal), "PYTHONUNBUFFERED": "1"}
        self.web_env = {**base, **common, "TXN_ENABLED": "1", "DATA_DIR": str(self.tmp / "data"),
                        "AUTH_DB_PATH": str(self.tmp / "data" / "auth.db"),
                        "TXN_DB_PATH": str(self.tmp / "web.db"), "TXN_RECONCILE_INTERVAL_S": "2",
                        "TXN_BOOT_READY_WAIT_S": "5",
                        "TXN_INGEST_TOKEN_SHA256": hashlib.sha256(self.ingest.encode()).hexdigest()}
        self.rx_env = {**base, **common, "TXN_RECEIVER_ENABLED": "1", "PORT": str(self.rx_port),
                       "TXN_WEBHOOK_TOKEN_SHA256": hashlib.sha256(self.token.encode()).hexdigest(),
                       "TXN_INGEST_TOKEN": self.ingest, "TXN_RATE_BURST": "1000",
                       "TXN_WEB_INGEST_URL": f"http://127.0.0.1:{self.web_port}/api/trade-exchange-news/internal/ingest"}
        (self.tmp / "data").mkdir()

    # ── processes ────────────────────────────────────────────────────────────
    def start_web(self) -> None:
        self.procs["web"] = subprocess.Popen([PY, str(REPO / "tools" / "txn_e2e_web.py"), str(self.web_port)],
                                             cwd=REPO, env=self.web_env, stdout=self._log("web"), stderr=subprocess.STDOUT)
        wait_http(f"http://127.0.0.1:{self.web_port}/api/admin/trade-exchange-news",
                  ok=lambda r: r.status_code == 200 and r.json().get("ready"))

    def start_receiver(self) -> None:
        self.procs["rx"] = subprocess.Popen([PY, "-u", "txn_serve.py"], cwd=RECEIVER_DIR, env=self.rx_env,
                                            stdout=self._log("receiver"), stderr=subprocess.STDOUT)
        wait_http(f"http://127.0.0.1:{self.rx_port}/health")

    def start_vite(self) -> None:
        npx = "npx.cmd" if os.name == "nt" else "npx"
        self.procs["vite"] = subprocess.Popen(
            [npx, "vite", "--config", "vite.txn-e2e.config.mjs", "--host", "127.0.0.1",
             "--port", str(self.vite_port), "--strictPort"], cwd=APP_DIR,
            env={**os.environ, "TXN_E2E_WEB_PORT": str(self.web_port)},
            stdout=self._log("vite"), stderr=subprocess.STDOUT)
        wait_http(f"http://127.0.0.1:{self.vite_port}/news-compare-harness.html", timeout=120)

    def _log(self, name):
        return open(self.out / f"{name}.log", "ab")

    def stop(self, name: str) -> None:
        kill_tree(self.procs.pop(name))

    # ── actions ──────────────────────────────────────────────────────────────
    def post(self, content: str) -> httpx.Response:
        return httpx.post(f"http://127.0.0.1:{self.rx_port}/hook/{self.token}",
                          json={"source": "TXNews1", "content": content}, timeout=15)

    def status(self) -> dict:
        return httpx.get(f"http://127.0.0.1:{self.web_port}/api/admin/trade-exchange-news", timeout=5).json()

    def step(self, name: str, ok: bool, **detail) -> None:
        self.steps.append({"step": name, "ok": bool(ok), **detail})
        print(f"[{'PASS' if ok else 'FAIL'}] {name} {json.dumps(detail, default=str)[:200]}")

    def cleanup(self) -> None:
        for name in list(self.procs):
            self.stop(name)
        shutil.rmtree(self.tmp, ignore_errors=True)


ROWS_JS = """(pane) => [...document.querySelectorAll(`[data-pane="${pane}"] [data-seq]`)]
  .map(r => ({seq: +r.dataset.seq, text: r.innerText}))"""


def rows(page, pane="tradeExchangeNews"):
    return page.evaluate(ROWS_JS, pane)


def wait_rows(page, n, pane="tradeExchangeNews", timeout=30.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = rows(page, pane)
        if len(r) >= n:
            return r
        time.sleep(0.1)
    return rows(page, pane)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    from playwright.sync_api import sync_playwright

    run = Run(out)
    sent: list[str] = []
    try:
        run.start_web()
        run.start_receiver()
        run.start_vite()
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            base = f"http://127.0.0.1:{run.vite_port}/news-compare-harness.html?live=1&only=news"
            a = browser.new_context(viewport={"width": 760, "height": 640}).new_page()
            b = browser.new_context(viewport={"width": 420, "height": 640}).new_page()
            a.goto(base + "&count=2")
            b.goto(base + "&count=1")
            for p in (a, b):
                p.wait_for_selector('[data-pane="tradeExchangeNews"]', timeout=60000)
                p.wait_for_selector('[data-pane="tradeExchangeNews"] [class*="toneLive"]', timeout=30000)

            # 1. live delivery: 3 widgets, 2 pages, same order
            lat = []
            for i in range(5):
                content = f"SYNTHETIC e2e live {i}"
                t0 = time.time()
                r = run.post(content)
                sent.append(content)
                a.wait_for_function(f"document.body.innerText.includes({json.dumps(content)})", timeout=10000)
                lat.append(round((time.time() - t0) * 1000))
                assert r.status_code == 200
            ra, ra2, rb = wait_rows(a, 5), wait_rows(a, 5, "tradeExchangeNews-1"), wait_rows(b, 5)
            order = [x["seq"] for x in ra]
            run.step("live delivery to 3 widgets in 2 pages, identical order",
                     order == [x["seq"] for x in ra2] == [x["seq"] for x in rb] and order == sorted(order, reverse=True),
                     post_to_browser_ms=lat)
            a.screenshot(path=str(out / "e2e-1-live.png"))

            # 2. web crash + restart: acked through the outage, recovered in order, marked delayed
            run.stop("web")
            codes = []
            for i in range(3):
                content = f"SYNTHETIC e2e during web outage {i}"
                codes.append(run.post(content).status_code)
                sent.append(content)
            # Sample the widget's status every 0.5 s through a 28 s outage (long enough
            # for the 22 s watchdog, and for recovered rows to be flagged `delayed`).
            samples, t0 = [], time.time()
            while time.time() - t0 < 28:
                samples.append((round(time.time() - t0, 1), b.evaluate(
                    "(document.querySelector('[data-pane=\"tradeExchangeNews\"] [class*=\"tone\"]')||{}).className||''")))
                time.sleep(0.5)
            first_warn = next((t for t, c in samples if "toneWarn" in c or "toneOff" in c), None)
            down_warn = first_warn is not None
            run.start_web()
            rb = wait_rows(b, 8, timeout=60)
            texts = [x["text"] for x in rb]
            in_order = [t for t in reversed(texts) if "SYNTHETIC e2e" in t]
            run.step("web crash: receiver kept acknowledging", codes == [200, 200, 200], codes=codes)
            run.step("web restart: browser reconnected and replayed all 8 in order",
                     len(rb) == 8 and all(sent[i] in in_order[i] for i in range(8)),
                     reconnecting_shown=down_warn, seconds_until_not_live=first_warn)
            run.step("recovered headlines marked delayed", sum("delayed" in t for t in texts) == 3)
            b.screenshot(path=str(out / "e2e-2-after-web-restart.png"))

            # 3. receiver restart
            run.stop("rx")
            run.start_receiver()
            r = run.post("SYNTHETIC e2e after receiver restart")
            sent.append("SYNTHETIC e2e after receiver restart")
            ok = r.status_code == 200 and len(wait_rows(b, 9)) == 9
            run.step("receiver restart: new instance serves, nothing lost", ok)

            # 4. R2 outage -> ack via web -> receiver restart (kills its memory retry) -> R2 back -> repair
            offline = run.events.with_name("events.offline")
            run.events.rename(offline)
            r = run.post("SYNTHETIC e2e during R2 outage")
            sent.append("SYNTHETIC e2e during R2 outage")
            eid = r.json().get("id") if r.status_code == 200 else None
            backlog_down = run.status()["reconcile"]["journal_repair"]["backlog"]["count"]
            run.stop("rx")
            run.start_receiver()
            # The file stand-in for R2 only: the restarted receiver re-creates its
            # (empty) journal folder at boot. Fold it back before "R2" returns.
            if run.events.exists():
                for f in run.events.iterdir():
                    f.replace(offline / f.name)
                run.events.rmdir()
            offline.rename(run.events)
            t0, backlog = time.time(), None
            while time.time() - t0 < 60:
                backlog = run.status()["reconcile"]["journal_repair"]
                if backlog["backlog"]["count"] == 0:
                    break
                time.sleep(1)
            repaired = eid and (run.events / f"{eid}.json").exists()
            run.step("R2 outage: acked via web, shown live", r.status_code == 200 and len(wait_rows(b, 10)) == 10,
                     backlog_while_down=backlog_down)
            run.step("R2 back after a receiver restart: web's repair pass rewrote the journal",
                     bool(repaired) and backlog["backlog"]["count"] == 0 and backlog["repaired"] >= 1,
                     repair=backlog, seconds=round(time.time() - t0, 1))

            # 5. duplicate delivery
            run.post("SYNTHETIC e2e duplicate")
            run.post("SYNTHETIC e2e duplicate")
            sent.append("SYNTHETIC e2e duplicate")
            rb = wait_rows(b, 11)
            time.sleep(1)
            dup = [x for x in rows(b) if "SYNTHETIC e2e duplicate" in x["text"]]
            run.step("duplicate delivery: one row, counted ×2", len(dup) == 1 and "×2" in dup[0]["text"])

            # 6. reload = history replay from /recent
            b.reload()
            b.wait_for_selector('[data-pane="tradeExchangeNews"] [class*="toneLive"]', timeout=30000)
            rb = wait_rows(b, 11)
            run.step("browser reload: history replayed, same rows", len(rb) == 11 and
                     [x["seq"] for x in rb] == sorted([x["seq"] for x in rb], reverse=True))
            b.screenshot(path=str(out / "e2e-3-final.png"))

            # 7. durability cross-check: every acknowledged headline is in BOTH stores
            st = run.status()
            files = len(list(run.events.glob("*.json")))
            run.step("every delivery in the journal and web's ledger", files == 12 and st["store"]["deliveries"] == 12,
                     journal_files=files, deliveries=st["store"]["deliveries"], headlines=st["store"]["headlines"])
            browser.close()
    finally:
        run.cleanup()
    (out / "e2e.json").write_text(json.dumps(run.steps, indent=2))
    failed = [s for s in run.steps if not s["ok"]]
    print(f"{len(run.steps) - len(failed)}/{len(run.steps)} steps passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
