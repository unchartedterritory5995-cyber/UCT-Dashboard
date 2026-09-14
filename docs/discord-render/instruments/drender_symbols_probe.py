"""Read-only measurement of discord_render/symbols.py (branch code) against PRODUCTION data, run in
the web pod as a separate process. Loads the ticker-search snapshot from /data (read), reads
bars.db / entity_master.db (read). Writes nothing. Cold-process numbers: an upper bound."""
import importlib.util
import json
import sys
import time

spec = importlib.util.spec_from_file_location("drender_symbols", "/tmp/drender_symbols.py")
sym = importlib.util.module_from_spec(spec)
sys.modules["drender_symbols"] = sym      # a @dataclass looks its module up in sys.modules at class creation
spec.loader.exec_module(sym)

from api.services import cap_universe, ticker_search_index as tsi  # noqa: E402

t = time.perf_counter()
loaded = tsi._load_snapshot()
out = {"snapshot_loaded": loaded, "snapshot_load_ms": round((time.perf_counter() - t) * 1000),
       "index_rows": len(tsi._INDEX), "universe": len(cap_universe.symbols()), "etf_list": len(cap_universe.etf_symbols())}

t = time.perf_counter()
sym.resolve("NVDA")                      # first call pays the lazy imports the live web process already holds
out["first_call_ms"] = round((time.perf_counter() - t) * 1000)

rows = []
for s in ["NVDA", "SPY", "GDX", "BRK.B", "BRK-B", "UCTA50", "^GSPC", "BTC-USD", "AEHL", "TCEHY", "FNMA",
          "APPL", "NVDAA", "MSFY", "ZZZZQ", "QQQQQ"]:
    t = time.perf_counter()
    r = sym.resolve(s)
    rows.append({"sym": s, "status": r.status, "by": r.authority, "sugg": list(r.suggestions),
                 "ms": round((time.perf_counter() - t) * 1000, 1)})
out["resolve"] = rows
out["flow_source"] = {s: sym.flow_source(s) for s in
                      ["SPY", "QQQ", "SMH", "IWM", "SPX", "NDX", "GDX", "DRAM", "NVDA", "AAPL", "SPCX", "TSLL"]}
print("PROBE " + json.dumps(out))
