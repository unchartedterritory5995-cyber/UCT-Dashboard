"""C-13 — can the render token reach a log line or a response body? Push it through every path.

⚰️ THE INCIDENT. Playwright's error text carries its own call log, and that call log printed the
navigation URL — **render token included — 142 times in 14 days**, and `render failed: …` put the
same text in the 502 body. The token is in `page_url`'s query string, so anything that formats a URL
into text leaks it.

⛔ CLOSING A CLASS NEEDS TWO THINGS, AND THE SECOND IS THE ONE PEOPLE SKIP:
  1. evidence the token does not appear, and
  2. a CONTROL showing this sweep would SEE it if it did.
An "absence" from an instrument that could not have detected a presence is not evidence — it is the
defect this repository names `lesson_a_search_over_sources_counts_the_searcher`.

⛔ AND THE ENCODED FORMS COUNT. A token that survives as `%74%6f%6b%65%6e` or base64 inside an error
body is just as leaked as a plaintext one, so every check runs over the raw text AND its
url-encoded and base64 forms.
"""
from __future__ import annotations

import base64
import pathlib
import sys
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
for p in (str(HERE), str(ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

#: A token shaped like the real one but obviously synthetic, so a hit in any output is unambiguous.
TOKEN = "CANARYTOKEN_c13_do_not_ship_9f3a2b"
SECRET = "CANARYSECRET_c13_5e1d"


def forms(tok: str) -> dict:
    """Plaintext, url-encoded, and base64 — a leak in any of them is a leak."""
    return {
        "plaintext": tok,
        "url-encoded": urllib.parse.quote(tok, safe=""),
        "url-encoded-all": "".join(f"%{ord(c):02x}" for c in tok),
        "base64": base64.b64encode(tok.encode()).decode().rstrip("="),
    }


def _renderer():
    """Import the renderer the way its image does — a FLAT import from its own directory."""
    d = ROOT / "services" / "chart_renderer"
    if str(d) not in sys.path:
        sys.path.insert(0, str(d))
    import app as renderer_app  # noqa: PLC0415
    return renderer_app


def sweep(scrub_fn, url_path_fn, *, token: str = TOKEN, secret: str = SECRET) -> list[dict]:
    """Every text shape the renderer is known to format a URL into. Returns the leaks."""
    page = (f"https://uctintelligence.com/r/chart?sym=NVDA&tf=D&token={token}"
            f"&secret={secret}&sig=abc")
    # ⛔ THESE ARE THE REAL SHAPES, not invented ones. Each is a text a URL has actually reached in
    # this service: Playwright's call log, an httpx/transport message, a 502 body, a timeout line.
    samples = {
        "playwright call log": (
            f"Timeout 30000ms exceeded.\n=========================== logs ===========================\n"
            f'navigating to "{page}", waiting until "load"\n============================================================'),
        "transport error": f"ConnectError: [Errno -2] Name or service not known for {page}",
        "502 body": f"render failed: page.goto: net::ERR_ABORTED at {page}",
        "ready predicate timeout": f"ready predicate timed out for {page}",
        "exception repr": repr(RuntimeError(f"boom while loading {page}")),
        "header echo": f"X-Render-Token: {token}",
        "bare query": f"?sym=NVDA&token={token}",
        # ⚠️ NOT A REACHABLE SHAPE TODAY — no call site in the renderer formats `os.environ` into
        # text (checked, `app.py` has none). Kept as DEFENCE IN DEPTH, because the shape is one
        # config-error line away and deleting a sample because it is inconvenient is how a sweep
        # stops finding things. ⭐ It earned its place immediately: it caught a real gap in
        # `_SECRET_PARAM`, whose word-boundary prefix cannot match `CHART_RENDERER_SECRET=` (the
        # preceding underscore is itself a word character).
        "secret param (env-shaped, defence in depth)": f"CHART_RENDERER_SECRET={secret}",
        # ⛔ OVER-REDACTION CONTROL, inside the sweep so it runs against every scrubber variant.
        "a word merely CONTAINING a keyword": "monkey=bananas",
        # ⛔⛔ THIS IS WHAT MAKES THE QUERY-STRIPPING HALF LOAD-BEARING, and my first attempt to
        # prove that asserted the wrong thing. `_SECRET_PARAM` only knows the names
        # token/secret/key/sig — a credential in a param called anything else survives it entirely.
        # `_URL_QUERY` is what catches this, by removing the whole query regardless of names.
        # ⭐ `build_render_url` is free to add a param tomorrow; the scrubber must not depend on
        # having been told its name.
        "token in a DIFFERENTLY-NAMED param": (
            f"page.goto failed: https://uctintelligence.com/r/chart?sym=NVDA&cap={token}"),
        # ⛔⛔ THE SHAPE THE TOKEN ACTUALLY TRAVELS IN. It is a HEADER, not a query param
        # (`discord_chart_house.py:305-318`), and the chart-edge token is attached to a Playwright
        # route as a header dict (`app.py:334-337`). `scrub` knew only `name=value`, so both of
        # these survived it untouched until this sweep looked.
        "header echo (the token's own transport)": f"X-Render-Token: {token}",
        "playwright request-header dict": (
            f"Error: route.continue_ failed: {{'accept': '*/*', "
            f"'x-chart-edge-token': '{token}', 'user-agent': 'Mozilla/5.0'}}"),
    }
    # ⛔⛔ KEYED BY (SUBJECT, FORM) — AND THE FIRST VERSION WAS NOT, WHICH MADE THIS WHOLE SWEEP A
    # LIE. It merged `{**forms(token), **forms(secret)}`; both dicts carry the SAME keys
    # ("plaintext", "url-encoded", …), so the secret's forms OVERWROTE the token's and the sweep
    # **never looked for the token at all**. It reported "no path leaks the token", found 13 control
    # leaks, and every one of those numbers was about the secret.
    # ⭐ An instrument that searched for the wrong needle and reported an absence — in the file whose
    # entire subject is that an absence is only evidence if the instrument could have seen a
    # presence. Caught by a case that disagreed with a hand-run of the same input.
    needles = {(subject, form): needle
               for subject, tok in (("token", token), ("secret", secret))
               for form, needle in forms(tok).items()}
    leaks = []
    for name, text in samples.items():
        out = scrub_fn(text)
        for (subject, form_name), needle in needles.items():
            if needle and needle in out:
                leaks.append({"path": name, "form": f"{subject}/{form_name}",
                              "output": out[:160]})
    # url_path() is the other redaction: it must yield a PATH and nothing else
    p = url_path_fn(page)
    if token in p or "?" in p:
        leaks.append({"path": "url_path()", "form": "plaintext", "output": p})
    return leaks


def self_check(out=print) -> int:
    from selfcheck import Cases
    cases = Cases("c13_token_sweep")
    try:
        r = _renderer()
    except Exception as e:  # noqa: BLE001
        out(f"  FAIL cannot import the renderer: {type(e).__name__}: {e}")
        out("TOTALS c13_token_sweep --self-check FAIL declared=0 evaluated=0 failed=1")
        return 1

    leaks = sweep(r.scrub, r.url_path)
    for lk in leaks:
        out(f"  LEAK {lk['path']} ({lk['form']}): {lk['output']}")
    cases.add("no path leaks the token or the secret in any form", not leaks)
    # ⛔ OVER-REDACTION IS NOT FREE. A scrubber that blanks everything is trivially leak-free and
    # teaches everyone to distrust its output; `monkey=bananas` must survive.
    cases.add("a word merely CONTAINING a keyword is NOT redacted (no over-matching)",
              "monkey=bananas" in r.scrub("monkey=bananas"))

    # ⛔⛔ THE NON-VACUITY CONTROL. Disable redaction and the SAME sweep must find the token, or the
    # clean result above is an instrument that could not have seen a leak.
    naked = sweep(lambda t: str(t), lambda u: u)
    out(f"  control: redaction disabled -> {len(naked)} leak(s) found")
    cases.add("with redaction DISABLED the sweep finds the token (control)", len(naked) >= 6)
    cases.add("...including the Playwright call log, the exact 2026 incident",
              any(lk["path"] == "playwright call log" for lk in naked))
    cases.add("...and url_path() stops being a path", any(lk["path"] == "url_path()" for lk in naked))

    # ⚰️ THIS CASE WAS `len(half) == 0 or True` — ALWAYS TRUE. I wrote a vacuous assertion into a
    # file whose whole subject is vacuous assertions, and it passed green. The real question is
    # whether BOTH halves of `scrub` are load-bearing: strip only the `token=` pairs and the URL
    # query survives, so a URL carrying its secret in a differently-named param still leaks.
    half = sweep(lambda t: r._SECRET_PARAM.sub(lambda m: m.group(1) + "=[redacted]", str(t)),
                 r.url_path)
    cases.add("with ONLY the param half of scrub, a token in a differently-named param LEAKS "
              "— so the query-stripping half is load-bearing",
              any(lk["path"] == "token in a DIFFERENTLY-NAMED param" for lk in half))

    # ⛔ ENCODED FORMS ARE CHECKED AT ALL — prove the needle set is not silently empty.
    f = forms(TOKEN)
    cases.add("the sweep looks for url-encoded and base64 forms, not just plaintext",
              len(f) == 4 and all(v for v in f.values())
              and f["base64"] != f["plaintext"] and f["url-encoded-all"] != f["plaintext"])
    return 0 if cases.report(out) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(self_check())
