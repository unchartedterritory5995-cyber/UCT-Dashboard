"""Plan A Task 12: the server's embed allow-list IS the client's.

`journal_two/web_embed.py::embed_for` is a port of
`app/src/pages/journal-2-0/lib/webEmbeds.js::embedFor`. Two rails, neither of which restates the
allow-list:

  1. The constants (YouTube hosts, YouTube id pattern, TradingView host and ref patterns, the
     YouTube path kinds, the provider names) are PARSED out of the JS source and compared to the
     Python module's.
  2. The client's own `embedFor` is run in Node over a corpus of links and its answers are the
     expected values for the Python port. The corpus holds only INPUTS; every expected answer
     comes from the client module, so a third copy of the rules cannot exist here.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

from api.services.journal_two import web_embed

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "webEmbeds.js"

CORPUS = [
    # YouTube: every URL shape the client knows, and near misses
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=42",
    "http://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXc",
    "https://youtu.be/dQw4w9WgXcQQ",
    "https://youtu.be/",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1",
    "https://www.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=aaaaaaaaaaa",
    "https://www.youtube.com/watch?v=dQw4w9WgX%2BQ",
    "https://www.youtube.com/watch?v=dQw4w9WgX+Q",
    "https://www.youtube.com/watch/?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch",
    "https://youtube.com/shorts/dQw4w9WgXcQ",
    "https://m.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
    "https://www.youtube.com/live/",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/v/dQw4w9WgXcQ",
    "https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ",
    "HTTPS://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be:443/dQw4w9WgXcQ",
    "https://youtu.be:99999/dQw4w9WgXcQ",
    "https://youtu.be:abc/dQw4w9WgXcQ",
    "https://user@youtu.be/dQw4w9WgXcQ",
    "https://user:pw@youtu.be/dQw4w9WgXcQ",
    "https://@youtu.be/dQw4w9WgXcQ",
    "https:youtu.be/dQw4w9WgXcQ",
    "https:/youtu.be/dQw4w9WgXcQ",
    "https:///youtu.be/dQw4w9WgXcQ",
    "https://youtu.be\\dQw4w9WgXcQ",
    "https:\\\\youtu.be\\dQw4w9WgXcQ",
    "  https://youtu.be/dQw4w9WgXcQ  ",
    "https://youtu.be/dQw4w9WgXcQ\n",
    "https://you tu.be/dQw4w9WgXcQ",
    "ftp://youtu.be/dQw4w9WgXcQ",
    "javascript:alert(1)//youtu.be/dQw4w9WgXcQ",
    "youtu.be/dQw4w9WgXcQ",
    "//youtu.be/dQw4w9WgXcQ",
    "",
    "https://youtu.be./dQw4w9WgXcQ",
    "https://evil.com/?u=https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be.evil.com/dQw4w9WgXcQ",
    # TradingView
    "https://www.tradingview.com/symbols/NASDAQ-AAPL/",
    "https://www.tradingview.com/symbols/nasdaq-aapl",
    "https://tradingview.com/symbols/AAPL/",
    "https://uk.tradingview.com/symbols/NYSE-BRK.B/",
    "https://www.tradingview.com/symbols/BINANCE-BTC-USDT/",
    "https://www.tradingview.com/symbols/-AAPL/",
    "https://www.tradingview.com/symbols/NASDAQ%2DAAPL/",
    "https://www.tradingview.com/symbols/NASDAQ-AA%ZZPL/",
    "https://www.tradingview.com/symbols/NASDAQ-%E9/",
    "https://www.tradingview.com/symbols/NASDAQ-%C3%A9/",
    "https://www.tradingview.com/symbols/",
    "https://www.tradingview.com/chart/?symbol=NASDAQ:AAPL",
    "https://www.tradingview.com/chart/abc123/?symbol=nyse%3Abrk.b",
    "https://www.tradingview.com/chart/",
    "https://www.tradingview.com/ideas/AAPL/",
    "https://in.tradingview.com/chart/?symbol=NSE:RELIANCE",
    "https://abc.tradingview.com/chart/?symbol=AAPL",
    "https://s.tradingview.com/widgetembed/?symbol=AAPL",
    "https://www.tradingview.com/symbols/" + "A" * 31 + "/",
    "https://www.tradingview.com/symbols/" + "E" * 21 + "-AAPL/",
    "https://www.tradingview.com.evil.com/symbols/AAPL/",
    # Not on the allow-list at all
    "https://vimeo.com/76979871",
    "https://player.vimeo.com/video/76979871",
    "https://www.loom.com/share/abc",
    "https://example.com/video.mp4",
]


def _client_answers(urls: list[str]) -> dict:
    node = shutil.which("node")
    assert node, "node is not on PATH -- this rail runs the client's own embedFor"
    js = (f"import({json.dumps(CLIENT.resolve().as_uri())}).then((m) => {{"
          "const urls = JSON.parse(process.argv[1]);"
          "process.stdout.write(JSON.stringify({"
          "providers: Object.keys(m.EMBED_PROVIDERS),"
          "answers: urls.map((u) => m.embedFor(u))}))})")
    r = subprocess.run([node, "--input-type=module", "-e", js, json.dumps(urls)],
                       capture_output=True, timeout=120)
    err = (r.stderr or b"").decode("utf-8", errors="replace")
    assert r.returncode == 0, f"node could not run {CLIENT}: {err[:2000]}"
    return json.loads((r.stdout or b"").decode("utf-8"))


def _js_regex(src: str, name: str) -> str:
    m = re.search(rf"^const {name} = /(.+)/[a-z]*\s*$", src, flags=re.MULTILINE)
    assert m, f"{name} is no longer a one-line regex literal in webEmbeds.js -- update this reader"
    return m.group(1)


def test_embed_for_matches_the_client_allowlist():
    src = CLIENT.read_text(encoding="utf-8")

    hosts = re.search(r"const YOUTUBE_HOSTS = new Set\(\[(.*?)\]\)", src, flags=re.DOTALL)
    assert hosts, "YOUTUBE_HOSTS moved in webEmbeds.js -- update this reader"
    assert set(re.findall(r"'([^']+)'", hosts.group(1))) == set(web_embed.YOUTUBE_HOSTS)
    assert _js_regex(src, "YOUTUBE_ID") == web_embed.YOUTUBE_ID_SRC
    assert _js_regex(src, "TRADINGVIEW_HOST") == web_embed.TRADINGVIEW_HOST_SRC
    assert _js_regex(src, "TRADINGVIEW_REF") == web_embed.TRADINGVIEW_REF_SRC
    kinds = re.search(r"\[([^\]]*)\]\.includes\(parts\[0\]\)", src)
    assert kinds, "the YouTube path kinds moved in webEmbeds.js -- update this reader"
    assert tuple(re.findall(r"'([^']+)'", kinds.group(1))) == web_embed.YOUTUBE_PATH_KINDS

    client = _client_answers(CORPUS)
    assert tuple(client["providers"]) == web_embed.EMBED_PROVIDERS

    mismatches = []
    for url, want in zip(CORPUS, client["answers"]):
        expected = (want["provider"], want["ref"]) if want else None
        got = web_embed.embed_for(url)
        if got != expected:
            mismatches.append((url, expected, got))
    assert not mismatches, mismatches
    # The corpus must exercise both answers and the refusal, or it proves nothing.
    kinds_seen = {a["provider"] if a else None for a in client["answers"]}
    assert kinds_seen == {"youtube", "tradingview", None}
