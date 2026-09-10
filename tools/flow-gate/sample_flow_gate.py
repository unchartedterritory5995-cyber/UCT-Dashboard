"""Sample the Options Flow roll ledger across an RTH session.

WHY: /api/flow/aggregate-health serves rolls from an in-memory deque(maxlen=80)
SHARED by both classifications, and serves only rolls_steady[-25:] and
rolls_startup[-5:]. A single read shows a narrow trailing window of a 6.5h
session. The union of overlapping captures is the only way to see distribution.

THE BINDING CONSTRAINT IS THE SERVED [-25:], NOT maxlen=80.

THE VERSION IS A MINUTE BUCKET, so data changes can mint AT MOST ONE roll per
minute. 25 steady rolls therefore covers >= 25 MINUTES per capture. At
INTERVAL=60 that is ~25x overlap. Only a cron bump can add an extra roll inside
a minute, and those are rare scheduled events.

THE ROLL RECORDS CARRY NO TIMESTAMP: version/kind/observed_s/handoff_ms/
prepare_ms/bucket_bound_s/pass2_skipped. They cannot be deduped by
(version, recorded_at). One roll is recorded per version per process, so
(generation, version) is unique; the FULL record is in the key anyway so a
changed field can never be silently collapsed.

A SECOND startup_catchup IS A FAIL unless a restart explains it, so restarts are
surfaced explicitly as `restart_detected` rather than reverse-engineered from a
counter at 08:10 ET.
"""
import ctypes
import json
import os
import time
import urllib.request
from datetime import datetime, timezone, timedelta

URL = "https://uctintelligence.com/api/flow/aggregate-health"
INTERVAL = 60
OUTDIR = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(OUTDIR, "captures.jsonl")      # append-only, full JSON
UNION = os.path.join(OUTDIR, "rolls_union.jsonl")  # append-only, deduped
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
STARS = "*" * 54


def keep_awake():
    """ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED.

    The machine sleeping is the single most likely failure of this whole plan.
    """
    try:
        ctypes.windll.kernel32.SetThreadExecutionState(
            0x80000000 | 0x00000001 | 0x00000040)
        return True
    except Exception:
        return False


def et(ts=None):
    return (datetime.fromtimestamp(ts or time.time(), timezone.utc)
            - timedelta(hours=4)).strftime("%m-%d %H:%M:%S")


def load_prior():
    """Rebuild dedup state from the union file so a restart of THIS script loses
    only the gap and never re-emits prior rolls as new."""
    seen, gen = set(), 0
    if os.path.exists(UNION):
        with open(UNION, encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                gen = max(gen, r.get("generation", 0))
                seen.add((r.get("generation"), r.get("version"), r.get("kind"),
                          r.get("observed_s"), r.get("handoff_ms"),
                          r.get("prepare_ms"), r.get("pass2_skipped")))
    return seen, gen


def main():
    awake = keep_awake()
    seen, gen = load_prior()
    last_prepared, n_cap, n_err = None, 0, 0
    print("sampling " + URL)
    print("  every %ds | keep-awake=%s" % (INTERVAL, "ON" if awake else "FAILED"))
    print("  raw   -> " + RAW)
    print("  union -> " + UNION)
    print("  resumed with %d known rolls, generation %d" % (len(seen), gen))
    print("  Ctrl-C to stop. Both files are APPEND-ONLY.\n", flush=True)

    while True:
        t0 = time.time()
        restart = False
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as resp:
                d = json.loads(resp.read().decode("utf-8"))
            n_cap += 1
        except Exception as e:
            # Log status/exception, KEEP GOING, never exit. The deploy alone
            # will produce several 502s while the container starts.
            n_err += 1
            code = getattr(e, "code", "")
            print("[%s] ERROR %s %s: %s | caps=%d errs=%d (continuing)"
                  % (et(), type(e).__name__, code, str(e)[:80], n_cap, n_err),
                  flush=True)
            with open(RAW, "a", encoding="utf-8") as f:
                f.write(json.dumps({"at": t0, "at_et": et(t0), "generation": gen,
                                    "error": repr(e)[:300]}) + "\n")
            time.sleep(max(1, INTERVAL - (time.time() - t0)))
            continue

        prep = d.get("prepare") or {}
        prepared = prep.get("prepared")
        if (last_prepared is not None and prepared is not None
                and prepared < last_prepared):
            gen += 1
            restart = True
            print("\n[%s] %s" % (et(), STARS))
            print("[%s] *** RESTART DETECTED - prepared %s -> %s - generation %d ***"
                  % (et(), last_prepared, prepared, gen))
            print("[%s] *** a startup_catchup after this point is EXPECTED ***" % et())
            print("[%s] %s\n" % (et(), STARS), flush=True)
        last_prepared = prepared

        # The FULL raw response, so a field neither of us parsed is not lost.
        with open(RAW, "a", encoding="utf-8") as f:
            f.write(json.dumps({"at": t0, "at_et": et(t0), "generation": gen,
                                "restart_detected": restart, "health": d}) + "\n")

        new = 0
        with open(UNION, "a", encoding="utf-8") as f:
            for bucket in ("rolls_steady", "rolls_startup"):
                for r in d.get(bucket) or []:
                    key = (gen, r.get("version"), r.get("kind"),
                           r.get("observed_s"), r.get("handoff_ms"),
                           r.get("prepare_ms"), r.get("pass2_skipped"))
                    if key in seen:
                        continue
                    seen.add(key)
                    new += 1
                    rec = {"first_seen_at": t0, "first_seen_et": et(t0),
                           "generation": gen, "restart_detected": restart}
                    rec.update(r)
                    f.write(json.dumps(rec) + "\n")

        st = [k for k in seen if k[2] == "steady_state_roll"]
        cat = [k for k in seen if k[2] == "startup_catchup"]
        obs = sorted(x[3] for x in st if x[3] is not None)
        med = obs[len(obs) // 2] if obs else None
        mx = obs[-1] if obs else None
        # A line EVERY capture, with wall clock, so silence != no-change.
        print("[%s] v=%s warm=%s gen=%d restart=%s | UNION steady=%d catchup=%d "
              "new=%d | observed_s med=%s max=%s | prepared=%s declined=%s "
              "caps=%d errs=%d"
              % (et(t0), d.get("current_version"), d.get("warm"), gen, restart,
                 len(st), len(cat), new, med, mx, prepared, prep.get("declined"),
                 n_cap, n_err), flush=True)
        time.sleep(max(1, INTERVAL - (time.time() - t0)))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped - files retained, dedup resumes on restart.")
