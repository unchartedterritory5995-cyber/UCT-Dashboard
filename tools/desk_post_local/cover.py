"""Run the Desk pipeline's own cover director + gpt-image-1 renderer + brand frame
locally for a non-Zoom video. Reuses desk_creative.render_cover verbatim (imported by
path); only the LLM transport is swapped (the pod's shared client is replaced by a
plain anthropic SDK call with the SAME _llm_kwargs call shape). Keys from env."""
import importlib.util, json, os, sys, time, types
HERE = os.path.dirname(os.path.abspath(__file__))
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); sys.modules[name] = m; spec.loader.exec_module(m); return m
# render_cover does `from api.services.desk_thumbnail import has_bespoke_card` -> satisfy it with the real module by path
dt = load("api.services.desk_thumbnail", os.path.join(HERE, "thumb", "desk_thumbnail.py"))
for pkg in ("api", "api.services"):
    sys.modules.setdefault(pkg, types.ModuleType(pkg))
sys.modules["api.services"].desk_thumbnail = dt

# The pod's shared Anthropic client lives in api.services.engine; provide the two names
# desk_creative reaches for, backed by the plain SDK, so the call shape stays _llm_kwargs.
import anthropic as _anthropic
eng = types.ModuleType("api.services.engine")
eng._get_anthropic_client = lambda: _anthropic.Anthropic()
eng._anthropic_text = lambda msg: "".join(getattr(b, "text", "") for b in msg.content)

import json as _json, re as _re
_ENG_NS = {'json': _json, 're': _re}
exec('def _parse_json_block(raw: str) -> dict:\n    """Parse a JSON object from a model reply, tolerating code fences AND stray\n    prose around it — Sonnet 5 occasionally adds a lead-in sentence despite the\n    \'JSON only\' instruction, which made a strict json.loads throw (→ empty\n    preview). Falls back to the outermost {...} span."""\n    raw = (raw or "").strip()\n    if raw.startswith("```"):\n        parts = raw.split("```")\n        if len(parts) >= 2:\n            raw = parts[1]\n            if raw.startswith("json"):\n                raw = raw[4:]\n            raw = raw.strip()\n    try:\n        return json.loads(raw)\n    except Exception as first_err:\n        i, j = raw.find("{"), raw.rfind("}")\n        if i != -1 and j != -1 and j > i:\n            try:\n                return json.loads(raw[i:j + 1])\n            except Exception:\n                pass\n        salvaged = _salvage_json_fields(raw)\n        if salvaged:\n            _logger.warning("earnings JSON salvaged (%s): kept %s",\n                            first_err, sorted(salvaged.keys()))\n            return salvaged\n        raise', _ENG_NS)
eng._parse_json_block = _ENG_NS['_parse_json_block']
sys.modules["api.services.engine"] = eng
sys.modules["api.services"].engine = eng
dc = load("desk_creative", os.path.join(HERE, "thumb", "desk_creative.py"))

import anthropic
client = anthropic.Anthropic()
def llm(system, user):
    kw = dc._llm_kwargs(system, user)
    msg = client.messages.create(**kw)
    return "".join(getattr(b, "text", "") for b in msg.content)

chapters = [c["title"] for c in json.load(open(os.path.join(HERE, "chapters.json")))]
ctx = {
    "date": "2026-09-24",
    "this_sessions_summary": "Patrick walks through his complete evening scan routine: eight scans run in order, "
                             "the QQQ and sector ETFs, a flagged list cut down to a notable watchlist, and the notebook that guides the next morning.",
    "this_sessions_chapters": chapters[:12],
    "this_sessions_key_points": [
        "An evening ritual of scanning hundreds of charts, one list at a time, flagging what stands out.",
        "The flagged list is narrowed to a handful of names that are truly in play for tomorrow.",
        "The routine takes two and a half to three hours; the goal is to simplify it without losing market awareness.",
    ],
}
t0 = time.time()
jpeg = dc.render_cover(section="Scanning & Stock Selection", eyebrow="EVENING SCAN ROUTINE",
                       date_text="September 24, 2026", ctx=ctx, llm=llm,
                       history_path=os.path.join(HERE, "cover_history_local.json"))
if jpeg:
    open(os.path.join(HERE, "thumb_cover.jpg"), "wb").write(jpeg)
    hist = json.load(open(os.path.join(HERE, "cover_history_local.json")))
    print(f"COVER OK {len(jpeg)} bytes in {time.time()-t0:.0f}s | style={hist[-1].get('style')} metaphor={hist[-1].get('metaphor')!r}")
else:
    print("COVER NONE (director/imagegen declined) — fallback is thumb_classic.jpg")
