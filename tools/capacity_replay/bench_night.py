"""bench-bars ONLY: a night-style job beside the resident bars-api processes, to see the memory peak the nightly
snapshot merge / store adoption adds (production's single process peaks at ~26 GB between 07:00 and 09:15Z).

On WRITABLE copies under /tmp/bench/night (the served store stays read-only): a second synthetic store (another seed)
is merged into a copy of the served one with the production merge (`data_sync._merge_ohlcv_from`), then the copy is
rebuilt clustered (`bars_cluster.cluster_copy`, the adoption build). Prints each step's seconds. Refuses outside
capacity-bench.
"""
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
NIGHT = "/tmp/bench/night"


def main():
    if os.environ.get("RAILWAY_ENVIRONMENT_NAME", "") != "capacity-bench":
        sys.exit("bench_night refuses to run outside the capacity-bench environment")
    shutil.rmtree(NIGHT, ignore_errors=True)
    os.makedirs(NIGHT)
    t = time.time()
    subprocess.run([sys.executable, os.path.join(HERE, "synth_store.py"), os.path.join(NIGHT, "snap"), "--daily", "2200",
                    "--intraday", "500", "--seed", "8"], check=True, cwd=REPO)
    print("[night] snapshot built %.0f s" % (time.time() - t), flush=True)
    local = os.path.join(NIGHT, "local.db")
    shutil.copy("/tmp/bench/store/bars.db", local)
    os.environ["DATA_DIR"] = NIGHT
    sys.path.insert(0, REPO)
    from api.services import bars_sqlite, data_sync, bars_cluster
    bars_sqlite._DB_PATH = local
    t = time.time()
    n = data_sync._merge_ohlcv_from(os.path.join(NIGHT, "snap", "bars.db"), local)
    print("[night] merge: %s rows, %.0f s" % (n, time.time() - t), flush=True)
    t = time.time()
    st = bars_cluster.cluster_copy(local, os.path.join(NIGHT, "clustered.db"))
    print("[night] clustered copy: %s, %.0f s" % (st, time.time() - t), flush=True)
    shutil.rmtree(NIGHT, ignore_errors=True)
    print("[night] done", flush=True)


if __name__ == "__main__":
    main()
