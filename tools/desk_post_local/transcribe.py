import json, sys, time
from faster_whisper import WhisperModel
t0 = time.time()
m = WhisperModel("small", device="cpu", compute_type="int8")
segs, info = m.transcribe("audio16k.wav", beam_size=5, vad_filter=True)
out = []
for s in segs:
    out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()})
json.dump({"language": info.language, "duration": info.duration, "segments": out}, open("transcript.json", "w", encoding="utf-8"), indent=1)
with open("transcript.txt", "w", encoding="utf-8") as f:
    for s in out:
        m_, sec = divmod(int(s["start"]), 60)
        f.write(f"[{m_:02d}:{sec:02d}] {s['text']}\n")
print(f"done {len(out)} segments in {time.time()-t0:.0f}s, lang={info.language}")
