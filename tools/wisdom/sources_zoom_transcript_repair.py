"""Rebuild ONE Desk video's stored transcript (W1 §2.2; docs/wisdom/methodology/zoom-356-root-cause.md).

SOURCES (pick one):
  --vtt-dir DIR        Zoom VTT files after the owner-side trash recovery, named
                       <recording_file_id>.vtt (the same names the R2 archive
                       wisdom/sources/zoom_vtt/<sha24(uuid)>/ uses). With several files
                       pass --recording-json (the saved GET /meetings/{uuid}/recordings
                       response): the transcript is PAIRED/STITCHED to the published MP4
                       with desk_session_insights.plan_transcript_for_mp4 — the same code
                       the pipeline runs.
  --whisper            faster-whisper over R2 desk_audio/<youtube_id>.m4a, following
                       tools/desk_transcript_gapfill.py. --slice-seconds N transcribes
                       only a slice (proves the path; a slice is NEVER applied).

OUTPUT: the transcript is built with desk_session_insights._timestamped_block — the
exact formatter the pipeline stores — and a JSON report prints counts, first/last cue
times and coverage BEFORE (the stored transcript) and AFTER vs the video length. No
transcript text is printed; --out writes the block to a file you name.

DRY-RUN BY DEFAULT. --apply POSTs {"transcript": ...} ONLY to
/api/education/videos/{id}/insights-store (PUSH_SECRET bearer, browser User-Agent),
and refuses: a slice, an AFTER coverage below 0.98 (unless --allow-incomplete), or an
AFTER coverage that does not beat BEFORE.

After an --apply, remove the video id from C:/Users/Patrick/uct-recaps/polished.json so
the recap polish re-runs on the new transcript. Never reset zoom_cleaned.

  python tools/wisdom/sources_zoom_transcript_repair.py --video-id 356 --youtube-id rKVAkk3811Q \\
      --length-seconds 6830 --vtt-dir <dir> --recording-json <dir>/recording.json \\
      --before-cues-file <data/wisdom/samples/zoom_video_356.transcript_cues.json>
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

from sources_bootstrap import BROWSER_UA, bootstrap, refuse_shared_root

COVERAGE_THRESHOLD = 0.98


def _coverage(cues, length):
    if not length:
        return None
    if not cues:
        return 0.0
    return round(min(1.0, max(c["t"] for c in cues) / float(length)), 4)


def _summary(cues, length):
    return {"cues": len(cues), "first_t": cues[0]["t"] if cues else None,
            "last_t": max(c["t"] for c in cues) if cues else None, "coverage": _coverage(cues, length)}


def cues_from_vtt_dir(si, vtt_dir: str, recording_json: str | None):
    files = sorted(f for f in os.listdir(vtt_dir) if f.lower().endswith(".vtt"))
    if not files:
        raise SystemExit(f"no .vtt files in {vtt_dir}")
    if recording_json:
        with open(recording_json, encoding="utf-8") as fh:
            rec = json.load(fh)
        by_id = {os.path.splitext(f)[0]: os.path.join(vtt_dir, f) for f in files}
        url_to_path = {}
        for rf in rec.get("recording_files") or []:
            path = by_id.get(str(rf.get("id") or ""))
            if path and rf.get("download_url"):
                url_to_path[rf["download_url"]] = path
        plan = si.plan_transcript_for_mp4(rec)
        missing = [e["file"].get("id") for e in plan["files"] if e["file"]["download_url"] not in url_to_path]
        if missing:
            raise SystemExit(f"planned transcript file(s) not found in {vtt_dir}: {missing}")

        def fetch(url):
            with open(url_to_path[url], encoding="utf-8") as fh:
                return fh.read()

        cues = si.build_paired_cues(plan, fetch)
        meta = {"mode": plan["mode"], "mp4_id": plan["mp4_id"], "mp4_duration_s": plan["mp4_duration_s"],
                "files": [{"id": e["file"].get("id"), "offset_s": e["offset_s"]} for e in plan["files"]]}
        return cues, meta
    if len(files) > 1:
        raise SystemExit("several VTT files need --recording-json to pair them to the published MP4")
    with open(os.path.join(vtt_dir, files[0]), encoding="utf-8") as fh:
        return si.parse_vtt(fh.read()), {"mode": "single_file", "files": [{"id": files[0], "offset_s": 0}]}


def cues_from_whisper(youtube_id: str, slice_start: int, slice_seconds: int | None, model_name: str):
    from api.services import data_sync, desk_background_audio

    timing = {}
    key = desk_background_audio.audio_key(youtube_id)
    if not data_sync.object_exists(key):
        raise SystemExit(f"no R2 audio at {key}")
    url = data_sync.presigned_get(key, expires=3600)
    if not url:
        raise SystemExit("R2 is not configured (DATA_SYNC_*)")
    import requests

    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "audio.m4a")
        t0 = time.perf_counter()
        with requests.get(url, stream=True, timeout=300) as r:
            r.raise_for_status()
            with open(src, "wb") as fh:
                for chunk in r.iter_content(1 << 20):
                    fh.write(chunk)
        timing["download_s"] = round(time.perf_counter() - t0, 2)
        timing["audio_bytes"] = os.path.getsize(src)
        path = src
        if slice_seconds:
            path = os.path.join(td, "slice.wav")
            t0 = time.perf_counter()
            subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-ss", str(slice_start), "-t",
                            str(slice_seconds), "-i", src, "-vn", "-ac", "1", "-ar", "16000", path], check=True)
            timing["slice_s"] = round(time.perf_counter() - t0, 2)
        from faster_whisper import WhisperModel

        t0 = time.perf_counter()
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        timing["model_load_s"] = round(time.perf_counter() - t0, 2)
        t0 = time.perf_counter()
        segments, info = model.transcribe(path, word_timestamps=False, vad_filter=True)
        offset = int(slice_start) if slice_seconds else 0
        cues = [{"t": int(s.start) + offset, "text": s.text.strip()} for s in segments if s.text.strip()]
        timing["transcribe_s"] = round(time.perf_counter() - t0, 2)
        timing["audio_seconds"] = round(float(getattr(info, "duration", 0) or 0), 1)
        if timing["audio_seconds"]:
            timing["realtime_factor"] = round(timing["transcribe_s"] / timing["audio_seconds"], 3)
    return cues, {"mode": "whisper_slice" if slice_seconds else "whisper_full", "model": model_name,
                  "slice_start": slice_start if slice_seconds else None, "slice_seconds": slice_seconds,
                  "timing": timing}


def before_cues(args):
    if args.before_cues_file:
        with open(args.before_cues_file, encoding="utf-8") as fh:
            data = json.load(fh)
        return data.get("cues") if isinstance(data, dict) else data
    if args.fetch_before:
        import requests

        secret = os.environ.get("PUSH_SECRET", "")
        resp = requests.get(f"{args.base.rstrip('/')}/api/education/videos/{args.video_id}/transcript-cues",
                            headers={"Authorization": f"Bearer {secret}", "User-Agent": BROWSER_UA}, timeout=60)
        resp.raise_for_status()
        return resp.json().get("cues") or []
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video-id", type=int, required=True)
    ap.add_argument("--youtube-id")
    ap.add_argument("--length-seconds", type=int, help="the published video's length (YouTube lengthSeconds)")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--vtt-dir")
    src.add_argument("--whisper", action="store_true")
    ap.add_argument("--recording-json")
    ap.add_argument("--slice-start", type=int, default=0)
    ap.add_argument("--slice-seconds", type=int)
    ap.add_argument("--model", default="base.en")
    bef = ap.add_mutually_exclusive_group()
    bef.add_argument("--before-cues-file")
    bef.add_argument("--fetch-before", action="store_true")
    ap.add_argument("--out", help="write the built transcript block here (never under the shared data root)")
    ap.add_argument("--base", default="https://uctintelligence.com")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--allow-incomplete", action="store_true")
    args = ap.parse_args(argv)

    bootstrap()
    from api.services import desk_session_insights as si

    if args.whisper:
        if not args.youtube_id:
            raise SystemExit("--whisper needs --youtube-id")
        cues, meta = cues_from_whisper(args.youtube_id, args.slice_start, args.slice_seconds, args.model)
    else:
        cues, meta = cues_from_vtt_dir(si, args.vtt_dir, args.recording_json)

    block = si._timestamped_block(cues)
    stored_form = si._parse_timestamped_block(block)  # exactly what the store would give back
    length = args.length_seconds or meta.get("mp4_duration_s")
    before = before_cues(args)
    report = {"video_id": args.video_id, "source": meta, "length_seconds": length,
              "before": _summary(before, length) if before is not None else None,
              "after": _summary(stored_form, length), "block_chars": len(block), "applied": False}
    if args.out:
        with open(refuse_shared_root(args.out), "w", encoding="utf-8") as fh:
            fh.write(block)
        report["out"] = args.out

    if args.apply:
        after_cov = report["after"]["coverage"]
        before_cov = (report["before"] or {}).get("coverage")
        refusal = None
        if args.slice_seconds:
            refusal = "a slice is never applied"
        elif after_cov is None:
            refusal = "coverage is not measurable: pass --length-seconds"
        elif after_cov < COVERAGE_THRESHOLD and not args.allow_incomplete:
            refusal = f"after coverage {after_cov} < {COVERAGE_THRESHOLD}"
        elif before_cov is not None and after_cov <= before_cov:
            refusal = f"after coverage {after_cov} does not beat before {before_cov}"
        elif not os.environ.get("PUSH_SECRET"):
            refusal = "PUSH_SECRET is not set"
        if refusal:
            report["refused"] = refusal
            print(json.dumps(report, indent=1))
            return 1
        import requests

        resp = requests.post(f"{args.base.rstrip('/')}/api/education/videos/{args.video_id}/insights-store",
                             json={"transcript": block},
                             headers={"Authorization": f"Bearer {os.environ['PUSH_SECRET']}",
                                      "User-Agent": BROWSER_UA}, timeout=120)
        report.update({"applied": resp.status_code < 300, "status": resp.status_code})
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
