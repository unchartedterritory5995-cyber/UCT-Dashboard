# Discord `/chart` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/chart TICKER [tf]` slash command in the Uncharted Territory Discord that replies with a clean candles + volume + SMA 10/20/50 PNG rendered by the Railway `web` API.

**Architecture:** Discord POSTs signed interactions to `POST /api/discord/interactions` on the existing FastAPI app. The handler verifies the Ed25519 signature, answers `{"type":5}` (deferred) in milliseconds, and a `BackgroundTasks` job loads bars through the existing `api.routers.bars.get_bars` function, renders with mplfinance on the Substack brand palette, and PATCHes the reply with the PNG attached. A local one-shot tool registers the command and the endpoint URL with Discord.

**Tech Stack:** FastAPI/Starlette (existing), PyNaCl (new, Ed25519 verify), httpx (existing), mplfinance + matplotlib + pandas (existing), Discord HTTP API v10.

**Spec:** `docs/superpowers/specs/2026-08-25-discord-chart-command-design.md`

## Global Constraints

- Work in the worktree `C:\Users\Patrick\uct-worktrees\discord-chart` on branch `feat/discord-chart-command`. Commit with explicit pathspecs (`git commit -m "..." -- <paths>`), never `git add -A`.
- Tests live in root `tests/` (discovery enforcement) and run with `python -m pytest tests/test_discord_chart.py -q -p no:cacheprovider` from the worktree root.
- Palette constants, verbatim: BASE `#191c17`, GOLD `#c9a84c`, GREEN `#3cb868`, RED `#e74c3c`, CREAM `#f0ead8`, GRID `#2c3128`, MUTED `#8a8f98`, font `DejaVu Sans`.
- `WINDOW = {"D": 120, "W": 104, "60": 100, "30": 130, "15": 130, "5": 156}`; `MA_LEAD = 50`.
- Timeframe labels: `D`=Daily, `W`=Weekly, `60`=60 min, `30`=30 min, `15`=15 min, `5`=5 min. Defined ONCE (`TF_LABEL` in the renderer); everything else derives from it.
- Ticker regex `^[A-Z0-9.^-]{1,12}$` after upper-casing and stripping a leading `$`.
- Attachment filename `TICKER_TF_YYYY-MM-DD_Chart.png` (intraday tf tag is `60m/30m/15m/5m`; ticker stripped to `[A-Z0-9]`).
- Env: `DISCORD_CHART_PUBLIC_KEY` + `DISCORD_CHART_APP_ID` on Railway `web`; `DISCORD_CHART_BOT_TOKEN` + `DISCORD_CHART_GUILD_ID` local `.env` only. Public key unset ⇒ endpoint returns 503.
- Discord response types: 1 PONG, 4 message, 5 deferred; ephemeral flag `64`. Followup: `PATCH https://discord.com/api/v10/webhooks/{app_id}/{token}/messages/@original`.
- `api/main.py` is co-edited by others: touch exactly two lines (one import, one `include_router`).
- The background job never raises; the endpoint never blocks on bars or rendering.

---

## File map

| File | Responsibility |
|---|---|
| `api/services/discord_chart_render.py` (create) | Pure renderer: bars → PNG bytes. Owns `WINDOW`, `MA_LEAD`, `TF_LABEL`, palette, `build_frame`, `render_chart_png`. |
| `api/services/discord_interactions.py` (create) | Pure Discord plumbing: signature verify, command parsing, `build_chart_command`, `attachment_name`, `edit_original`, `run_chart_job`, render slots. |
| `api/routers/discord_interactions.py` (create) | The HTTP endpoint + the one real `fetch_bars` adapter over `api.routers.bars.get_bars`. |
| `tools/discord_chart_commands.py` (create) | Local one-shot: `show`, `register`, `endpoint`, `invite`. |
| `tests/test_discord_chart.py` (create) | All tests for the above. |
| `api/main.py` (modify: after line 99, after line 6052) | Import + mount the router. |
| `requirements.txt` (modify) | Add `PyNaCl==1.6.2`. |

---

### Task 1: Renderer — `build_frame` and `render_chart_png`

**Files:**
- Create: `api/services/discord_chart_render.py`
- Test: `tests/test_discord_chart.py`

**Interfaces:**
- Consumes: nothing from other tasks. Bars are dicts `{"t","o","h","l","c","v"}`; daily/weekly `t` is `"YYYY-MM-DD"`, intraday `t` is unix seconds (int).
- Produces: `WINDOW: dict[str,int]`, `MA_LEAD: int`, `TF_LABEL: dict[str,str]`, `to_datetime(t) -> datetime`, `build_frame(bars: list[dict], tf: str) -> pandas.DataFrame` (columns Open/High/Low/Close/Volume/SMA10/SMA20/SMA50, index = naive datetime, exactly the last `WINDOW[tf]` rows), `render_chart_png(ticker: str, tf: str, bars: list[dict]) -> bytes`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_discord_chart.py`:

```python
"""Discord /chart: renderer, interaction plumbing, endpoint, registration payload."""
from __future__ import annotations

import datetime as dt
import json
import random

import pytest


# ── synthetic bars ────────────────────────────────────────────────────────────

def _walk(n: int, seed: int = 7, start: float = 100.0):
    rng = random.Random(seed)
    px = start
    out = []
    for _ in range(n):
        o = px
        c = max(1.0, o * (1 + rng.uniform(-0.03, 0.03)))
        h = max(o, c) * (1 + rng.uniform(0, 0.01))
        l = min(o, c) * (1 - rng.uniform(0, 0.01))
        out.append((o, h, l, c, rng.randint(100_000, 5_000_000)))
        px = c
    return out


def daily_bars(n: int = 170, seed: int = 7) -> list[dict]:
    day = dt.date(2026, 1, 2)
    bars = []
    for o, h, l, c, v in _walk(n, seed):
        while day.weekday() >= 5:
            day += dt.timedelta(days=1)
        bars.append({"t": day.isoformat(), "o": o, "h": h, "l": l, "c": c, "v": v})
        day += dt.timedelta(days=1)
    return bars


def weekly_bars(n: int = 160, seed: int = 8) -> list[dict]:
    fri = dt.date(2023, 1, 6)  # a Friday
    bars = []
    for o, h, l, c, v in _walk(n, seed):
        bars.append({"t": fri.isoformat(), "o": o, "h": h, "l": l, "c": c, "v": v})
        fri += dt.timedelta(days=7)
    return bars


def intraday_bars(n: int = 200, step_min: int = 15, seed: int = 9) -> list[dict]:
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    t = dt.datetime(2026, 8, 24, 9, 30, tzinfo=et)
    bars = []
    for o, h, l, c, v in _walk(n, seed):
        bars.append({"t": int(t.timestamp()), "o": o, "h": h, "l": l, "c": c, "v": v})
        t += dt.timedelta(minutes=step_min)
        if t.hour >= 16:
            t = (t + dt.timedelta(days=1)).replace(hour=9, minute=30)
    return bars


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


# ── Task 1: renderer ──────────────────────────────────────────────────────────

def test_to_datetime_accepts_iso_yyyymmdd_and_unix():
    from api.services.discord_chart_render import to_datetime
    assert to_datetime("2026-08-25") == dt.datetime(2026, 8, 25)
    assert to_datetime(20260825) == dt.datetime(2026, 8, 25)
    # 2026-08-24 09:30 ET == 13:30 UTC
    assert to_datetime(1787578200) == dt.datetime(2026, 8, 24, 9, 30)
    assert to_datetime(1787578200 * 1000) == dt.datetime(2026, 8, 24, 9, 30)  # ms tolerated


def test_build_frame_is_window_wide_with_complete_sma50():
    from api.services.discord_chart_render import WINDOW, MA_LEAD, build_frame
    frame = build_frame(daily_bars(WINDOW["D"] + MA_LEAD), "D")
    assert len(frame) == WINDOW["D"]
    assert not frame["SMA50"].isna().any(), "lead-in bars must make SMA50 complete at the left edge"
    assert list(frame.columns) == ["Open", "High", "Low", "Close", "Volume", "SMA10", "SMA20", "SMA50"]


def test_build_frame_short_input_keeps_all_bars_with_partial_mas():
    from api.services.discord_chart_render import build_frame
    frame = build_frame(daily_bars(30), "D")
    assert len(frame) == 30
    assert frame["SMA10"].notna().sum() == 21
    assert frame["SMA50"].isna().all()


@pytest.mark.parametrize("tf,bars", [
    ("D", daily_bars(170)),
    ("W", weekly_bars(160)),
    ("15", intraday_bars(200, 15)),
    ("5", intraday_bars(220, 5)),
])
def test_render_returns_real_png(tf, bars):
    from api.services.discord_chart_render import render_chart_png
    png = render_chart_png("NVDA", tf, bars)
    assert png[:8] == PNG_MAGIC
    assert len(png) > 10_000


def test_render_five_bars_still_renders_and_two_bars_refuses():
    from api.services.discord_chart_render import render_chart_png
    assert render_chart_png("NVDA", "D", daily_bars(5))[:8] == PNG_MAGIC
    with pytest.raises(ValueError):
        render_chart_png("NVDA", "D", daily_bars(2))
    with pytest.raises(ValueError):
        render_chart_png("NVDA", "7", daily_bars(50))


def test_tf_label_covers_every_window_key():
    from api.services.discord_chart_render import WINDOW, TF_LABEL
    assert set(TF_LABEL) == set(WINDOW) == {"D", "W", "60", "30", "15", "5"}
    assert TF_LABEL["D"] == "Daily" and TF_LABEL["60"] == "60 min"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_discord_chart.py -q -p no:cacheprovider`
Expected: every test FAILS/ERRORS with `ModuleNotFoundError: No module named 'api.services.discord_chart_render'`.

- [ ] **Step 3: Write the renderer**

Create `api/services/discord_chart_render.py`:

```python
"""Discord /chart renderer: candles + volume + SMA 10/20/50 on the brand palette.

Pure. Takes bars exactly as /api/bars serves them ({"t","o","h","l","c","v"};
daily/weekly `t` is "YYYY-MM-DD", intraday `t` is unix seconds) and returns PNG
bytes. No network, no env, no Discord. The palette is the Substack chart
engine's (morning-wire/substack/charts.py) copied as constants because that
repo is not present on Railway.
"""
from __future__ import annotations

import datetime as _dt
import io
import threading
from zoneinfo import ZoneInfo

import matplotlib
matplotlib.use("Agg")  # headless; must precede any pyplot import

BASE = "#191c17"
GOLD = "#c9a84c"
GREEN = "#3cb868"
RED = "#e74c3c"
CREAM = "#f0ead8"
GRID = "#2c3128"
MUTED = "#8a8f98"
_FONT = "DejaVu Sans"

# Visible bars per timeframe. The caller asks the bars authority for
# WINDOW[tf] + MA_LEAD so SMA50 is complete at the left edge; the lead-in is
# never drawn.
WINDOW = {"D": 120, "W": 104, "60": 100, "30": 130, "15": 130, "5": 156}
MA_LEAD = 50

# The one authority for timeframe wording. discord_interactions derives the
# slash-command choices from this; the chart title and the reply line use it.
TF_LABEL = {"D": "Daily", "W": "Weekly", "60": "60 min", "30": "30 min",
            "15": "15 min", "5": "5 min"}

# (period, colour): the Substack leader-chart MA colours, applied to 10/20/50.
_MAS = ((10, GOLD), (20, "#8a8f98"), (50, "#5a6b52"))
_ET = ZoneInfo("America/New_York")
_PLOT_LOCK = threading.Lock()   # matplotlib is not thread-safe; handlers run in a threadpool
_STYLE = None                   # lazy: building the style imports mplfinance


def to_datetime(t) -> _dt.datetime:
    """Bar time → naive datetime in ET. Accepts "YYYY-MM-DD", YYYYMMDD, unix s, unix ms."""
    s = str(t).strip()
    if "-" in s and len(s) >= 10:
        return _dt.datetime(int(s[:4]), int(s[5:7]), int(s[8:10]))
    n = int(float(s))
    if len(s) == 8 and 19000101 <= n <= 21001231:
        return _dt.datetime(n // 10000, (n // 100) % 100, n % 100)
    if n > 10_000_000_000:  # milliseconds
        n //= 1000
    return _dt.datetime.fromtimestamp(n, tz=_ET).replace(tzinfo=None)


def build_frame(bars: list[dict], tf: str):
    """OHLCV frame with SMA10/20/50 computed on ALL input bars, then sliced to
    the last WINDOW[tf] rows. Raises ValueError on an unknown tf or < 3 bars."""
    if tf not in WINDOW:
        raise ValueError(f"unsupported tf {tf!r}")
    if not bars or len(bars) < 3:
        raise ValueError("not enough bars")
    import pandas as pd
    df = pd.DataFrame({
        "Date": [to_datetime(b["t"]) for b in bars],
        "Open": [float(b["o"]) for b in bars],
        "High": [float(b["h"]) for b in bars],
        "Low": [float(b["l"]) for b in bars],
        "Close": [float(b["c"]) for b in bars],
        "Volume": [float(b.get("v") or 0) for b in bars],
    }).set_index("Date")
    df = df[~df.index.duplicated(keep="last")].sort_index()
    for n, _ in _MAS:
        df[f"SMA{n}"] = df["Close"].rolling(n).mean()
    return df.tail(WINDOW[tf])


def _style():
    global _STYLE
    if _STYLE is None:
        import mplfinance as mpf
        mc = mpf.make_marketcolors(up=GREEN, down=RED, edge="inherit", wick="inherit",
                                   volume={"up": GREEN, "down": RED}, alpha=0.95)
        _STYLE = mpf.make_mpf_style(
            base_mpf_style="nightclouds", marketcolors=mc,
            facecolor=BASE, figcolor=BASE, edgecolor=GRID,
            gridcolor=GRID, gridstyle="--", gridaxis="both",
            rc={"axes.labelcolor": CREAM, "xtick.color": CREAM, "ytick.color": CREAM,
                "font.family": _FONT, "font.size": 10},
        )
    return _STYLE


def _stamp(as_of: _dt.datetime, tf: str) -> str:
    if tf in ("D", "W"):
        return as_of.strftime("%Y-%m-%d")
    return as_of.strftime("%Y-%m-%d %H:%M ET")


def render_chart_png(ticker: str, tf: str, bars: list[dict]) -> bytes:
    """Candles + volume + SMA 10/20/50, 16:9, ~1210x680 px. Raises ValueError
    for an unknown tf or fewer than 3 bars; any other exception propagates."""
    view = build_frame(bars, tf)
    import mplfinance as mpf
    import matplotlib.pyplot as plt

    last = float(view["Close"].iloc[-1])
    prev = float(view["Close"].iloc[-2])
    chg = f" ({(last / prev - 1) * 100:+.1f}%)" if prev > 0 else ""
    title = f"{ticker} \u00b7 {TF_LABEL[tf]} \u00b7 {last:,.2f}{chg}"
    footer = f"as of {_stamp(view.index[-1].to_pydatetime(), tf)} \u00b7 uctintelligence.com"
    addplots = [mpf.make_addplot(view[f"SMA{n}"], color=c, width=1.0)
                for n, c in _MAS if view[f"SMA{n}"].notna().any()]
    kwargs = dict(type="candle", volume=True, style=_style(), figsize=(11, 6.2),
                  returnfig=True, xrotation=0,
                  datetime_format="%b %d" if tf == "D" else "%b %y" if tf == "W" else "%m-%d %H:%M")
    if addplots:
        kwargs["addplot"] = addplots

    buf = io.BytesIO()
    with _PLOT_LOCK:
        fig, axes = mpf.plot(view, **kwargs)
        try:
            axes[0].set_title(title, color=GOLD, fontsize=13, fontweight="bold",
                              loc="left", pad=12, fontfamily=_FONT)
            fig.text(0.99, 0.01, footer, color=MUTED, fontsize=8.5,
                     ha="right", va="bottom", fontfamily=_FONT)
            fig.savefig(buf, dpi=110, facecolor=BASE, bbox_inches="tight",
                        pad_inches=0.25, format="png")
        finally:
            plt.close(fig)
    return buf.getvalue()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_discord_chart.py -q -p no:cacheprovider`
Expected: `10 passed` (6 test functions, one parametrized ×4).

If `make_marketcolors` rejects the `volume={...}` dict on the installed mplfinance, replace it with `volume="in"` — the candle colours then inherit to volume, which is the same look.

- [ ] **Step 5: Look at one output**

```bash
python - <<'EOF'
import sys; sys.path.insert(0, ".")
from tests.test_discord_chart import daily_bars
from api.services.discord_chart_render import render_chart_png
open(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\13116c87-aa33-4ef6-a154-e4dfc22ab0e1\scratchpad\NVDA_D_sample.png", "wb").write(render_chart_png("NVDA", "D", daily_bars(170)))
EOF
```

Open the PNG (Read tool). Expect: dark base, green/red candles, three MA lines, volume pane, gold left title, small footer. Fix anything that looks wrong before committing (this is the artifact; a green test proves nothing about the picture).

- [ ] **Step 6: Commit**

```bash
git add api/services/discord_chart_render.py tests/test_discord_chart.py
git commit -m "feat(discord-chart): brand-palette candle renderer" -- api/services/discord_chart_render.py tests/test_discord_chart.py
```

---

### Task 2: Interaction plumbing — verify, parse, followup, job

**Files:**
- Create: `api/services/discord_interactions.py`
- Modify: `requirements.txt` (add `PyNaCl==1.6.2` next to the other pinned libs)
- Test: `tests/test_discord_chart.py` (append)

**Interfaces:**
- Consumes: `WINDOW`, `MA_LEAD`, `TF_LABEL`, `to_datetime` from `api.services.discord_chart_render`.
- Produces:
  - `DISCORD_API = "https://discord.com/api/v10"`, `EPHEMERAL = 64`
  - `class CommandError(ValueError)`
  - `@dataclass(frozen=True) class ChartRequest: ticker: str; tf: str`
  - `verify_signature(public_key_hex: str, signature_hex: str, timestamp: str, body: bytes) -> bool`
  - `parse_chart_command(interaction: dict) -> ChartRequest` (raises `CommandError`)
  - `build_chart_command() -> dict`
  - `attachment_name(ticker: str, tf: str, last_t) -> str`
  - `edit_original(app_id: str, token: str, *, content: str, png: bytes | None = None, filename: str | None = None, client=None) -> bool`
  - `RENDER_SLOTS: threading.BoundedSemaphore`
  - `run_chart_job(app_id: str, token: str, req: ChartRequest, *, bars_fn, render_fn, edit_fn) -> str` returning one of `"ok" | "busy" | "no_bars" | "render_failed" | "error"`. `bars_fn(ticker, tf, n) -> list[dict] | None`; `render_fn(ticker, tf, bars) -> bytes`; `edit_fn(app_id, token, *, content, png=None, filename=None) -> bool`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_discord_chart.py`:

```python
# ── Task 2: interaction plumbing ──────────────────────────────────────────────

def _keypair():
    from nacl.signing import SigningKey
    sk = SigningKey.generate()
    return sk, sk.verify_key.encode().hex()


def _sign(sk, ts: str, body: bytes) -> str:
    return sk.sign(ts.encode() + body).signature.hex()


def test_verify_signature_good_bad_and_garbage_never_raise():
    from api.services.discord_interactions import verify_signature
    sk, pk = _keypair()
    body = b'{"type":1}'
    sig = _sign(sk, "1700000000", body)
    assert verify_signature(pk, sig, "1700000000", body) is True
    assert verify_signature(pk, sig, "1700000001", body) is False        # timestamp not what was signed
    assert verify_signature(pk, sig, "1700000000", body + b" ") is False  # body tampered
    _, other_pk = _keypair()
    assert verify_signature(other_pk, sig, "1700000000", body) is False   # wrong key
    assert verify_signature(pk, "zz", "1700000000", body) is False        # garbage hex
    assert verify_signature("", sig, "1700000000", body) is False         # empty key
    assert verify_signature(pk, "", "", body) is False


def _interaction(ticker=None, tf=None, name="chart", itype=2):
    opts = []
    if ticker is not None:
        opts.append({"name": "ticker", "type": 3, "value": ticker})
    if tf is not None:
        opts.append({"name": "tf", "type": 3, "value": tf})
    return {"type": itype, "application_id": "123", "token": "tok",
            "data": {"name": name, "options": opts}}


def test_parse_chart_command_normalizes_and_rejects():
    from api.services.discord_interactions import parse_chart_command, CommandError, ChartRequest
    assert parse_chart_command(_interaction("$nvda")) == ChartRequest("NVDA", "D")
    assert parse_chart_command(_interaction("brk.b", "W")) == ChartRequest("BRK.B", "W")
    assert parse_chart_command(_interaction("^GSPC", "15")).ticker == "^GSPC"
    for tf in ("D", "W", "60", "30", "15", "5"):
        assert parse_chart_command(_interaction("SPY", tf)).tf == tf
    for bad in ("NVDA;rm", "", " ", "A" * 13, "nv da"):
        with pytest.raises(CommandError):
            parse_chart_command(_interaction(bad))
    with pytest.raises(CommandError):
        parse_chart_command(_interaction("SPY", "7"))
    with pytest.raises(CommandError):
        parse_chart_command({"type": 2, "data": {"name": "chart"}})  # no options at all


def test_build_chart_command_derives_choices_from_tf_label():
    from api.services.discord_chart_render import TF_LABEL
    from api.services.discord_interactions import build_chart_command
    cmd = build_chart_command()
    assert cmd["name"] == "chart" and cmd["type"] == 1
    ticker, tf = cmd["options"]
    assert ticker["name"] == "ticker" and ticker["required"] is True and ticker["type"] == 3
    assert tf["name"] == "tf" and tf["required"] is False
    assert [(c["name"], c["value"]) for c in tf["choices"]] == [(v, k) for k, v in TF_LABEL.items()]


def test_attachment_name_follows_house_convention():
    from api.services.discord_interactions import attachment_name
    assert attachment_name("NVDA", "D", "2026-08-25") == "NVDA_D_2026-08-25_Chart.png"
    assert attachment_name("BRK.B", "W", "2026-08-21") == "BRKB_W_2026-08-21_Chart.png"
    assert attachment_name("^GSPC", "15", 1787578200) == "GSPC_15m_2026-08-24_Chart.png"


def test_edit_original_multipart_shape_and_failure_paths():
    import httpx
    from api.services.discord_interactions import edit_original, DISCORD_API
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        return httpx.Response(200, json={"id": "1"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    ok = edit_original("123", "tok", content="NVDA \u00b7 Daily", png=PNG_MAGIC + b"x" * 100,
                       filename="NVDA_D_2026-08-25_Chart.png", client=client)
    assert ok is True
    req = seen[-1]
    assert req.method == "PATCH"
    assert str(req.url) == f"{DISCORD_API}/webhooks/123/tok/messages/@original"
    assert req.headers["content-type"].startswith("multipart/form-data")
    body = req.content
    assert b'name="payload_json"' in body
    assert b'name="files[0]"; filename="NVDA_D_2026-08-25_Chart.png"' in body
    assert b'"attachments": [{"id": 0, "filename": "NVDA_D_2026-08-25_Chart.png"}]' in body
    assert PNG_MAGIC in body

    ok = edit_original("123", "tok", content="No bars for X (Daily).", client=client)
    assert ok is True
    assert json.loads(seen[-1].content) == {"content": "No bars for X (Daily)."}

    def failing(request):
        return httpx.Response(404, json={"message": "Unknown Webhook"})
    assert edit_original("123", "tok", content="x", client=httpx.Client(transport=httpx.MockTransport(failing))) is False

    def boom(request):
        raise httpx.ConnectError("down")
    assert edit_original("123", "tok", content="x", client=httpx.Client(transport=httpx.MockTransport(boom))) is False


class _Edits:
    def __init__(self):
        self.calls = []

    def __call__(self, app_id, token, *, content, png=None, filename=None):
        self.calls.append({"app_id": app_id, "token": token, "content": content, "png": png, "filename": filename})
        return True


def test_run_chart_job_happy_path():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    from api.services.discord_chart_render import WINDOW, MA_LEAD
    asked = []
    bars = daily_bars(170)

    def bars_fn(ticker, tf, n):
        asked.append((ticker, tf, n))
        return bars

    edits = _Edits()
    out = run_chart_job("123", "tok", ChartRequest("NVDA", "D"),
                        bars_fn=bars_fn, render_fn=lambda t, tf, b: PNG_MAGIC + b"png", edit_fn=edits)
    assert out == "ok"
    assert asked == [("NVDA", "D", WINDOW["D"] + MA_LEAD)]
    assert len(edits.calls) == 1
    call = edits.calls[0]
    assert call["content"] == "NVDA \u00b7 Daily"
    assert call["png"] == PNG_MAGIC + b"png"
    assert call["filename"] == f"NVDA_D_{bars[-1]['t']}_Chart.png"


def test_run_chart_job_no_bars_render_failure_and_bars_exception():
    from api.services.discord_interactions import run_chart_job, ChartRequest
    edits = _Edits()
    assert run_chart_job("1", "t", ChartRequest("ZZZZQ", "60"),
                         bars_fn=lambda *a: None, render_fn=lambda *a: b"", edit_fn=edits) == "no_bars"
    assert edits.calls[-1]["content"] == "No bars for ZZZZQ (60 min)." and edits.calls[-1]["png"] is None

    assert run_chart_job("1", "t", ChartRequest("SPY", "D"),
                         bars_fn=lambda *a: [], render_fn=lambda *a: b"", edit_fn=edits) == "no_bars"

    def bars_boom(*a):
        raise RuntimeError("db gone")
    assert run_chart_job("1", "t", ChartRequest("SPY", "D"),
                         bars_fn=bars_boom, render_fn=lambda *a: b"", edit_fn=edits) == "no_bars"

    def render_boom(*a):
        raise RuntimeError("matplotlib exploded")
    assert run_chart_job("1", "t", ChartRequest("SPY", "D"),
                         bars_fn=lambda *a: daily_bars(20), render_fn=render_boom, edit_fn=edits) == "render_failed"
    assert edits.calls[-1]["content"] == "Chart failed, try again."


def test_run_chart_job_busy_when_slots_exhausted_and_releases_after():
    from api.services import discord_interactions as di
    edits = _Edits()
    held = []
    while di.RENDER_SLOTS.acquire(blocking=False):
        held.append(1)
    try:
        assert di.run_chart_job("1", "t", di.ChartRequest("SPY", "D"),
                                bars_fn=lambda *a: daily_bars(20), render_fn=lambda *a: PNG_MAGIC, edit_fn=edits) == "busy"
        assert edits.calls[-1]["content"] == "Busy, try again in a few seconds."
    finally:
        for _ in held:
            di.RENDER_SLOTS.release()
    # slots come back: a normal run succeeds and does not leak a slot
    assert di.run_chart_job("1", "t", di.ChartRequest("SPY", "D"),
                            bars_fn=lambda *a: daily_bars(20), render_fn=lambda *a: PNG_MAGIC, edit_fn=edits) == "ok"
    assert di.RENDER_SLOTS.acquire(blocking=False); di.RENDER_SLOTS.release()


def test_run_chart_job_never_raises_even_if_edit_fn_raises():
    from api.services.discord_interactions import run_chart_job, ChartRequest

    def edit_boom(*a, **k):
        raise RuntimeError("discord down")
    assert run_chart_job("1", "t", ChartRequest("SPY", "D"),
                         bars_fn=lambda *a: daily_bars(20), render_fn=lambda *a: PNG_MAGIC, edit_fn=edit_boom) == "error"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_discord_chart.py -q -p no:cacheprovider -k "signature or parse or build_chart or attachment or edit_original or run_chart_job"`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.services.discord_interactions'`.

- [ ] **Step 3: Add the dependency and write the module**

In `requirements.txt`, add a line `PyNaCl==1.6.2` (alphabetical placement is not enforced; put it directly after the `httpx==0.28.1` line). Locally: `python -m pip install "PyNaCl==1.6.2"`.

Create `api/services/discord_interactions.py`:

```python
"""Discord interaction plumbing for the /chart slash command. Pure helpers.

No FastAPI objects here. The router (api/routers/discord_interactions.py)
verifies + parses with these and schedules `run_chart_job`; the local tool
(tools/discord_chart_commands.py) registers `build_chart_command()`.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from dataclasses import dataclass

from api.services.discord_chart_render import MA_LEAD, TF_LABEL, WINDOW, to_datetime

log = logging.getLogger(__name__)

DISCORD_API = "https://discord.com/api/v10"
EPHEMERAL = 64  # message flag: only the invoking user sees it
_TICKER_RE = re.compile(r"^[A-Z0-9.^-]{1,12}$")

# Two renders at a time protects the API's event loop and memory; a third
# caller is told to retry rather than queue behind a cold Massive fetch.
RENDER_SLOTS = threading.BoundedSemaphore(2)


class CommandError(ValueError):
    """User-facing validation failure; str(exc) is the ephemeral reply."""


@dataclass(frozen=True)
class ChartRequest:
    ticker: str
    tf: str


def verify_signature(public_key_hex: str, signature_hex: str, timestamp: str, body: bytes) -> bool:
    """Ed25519 check over timestamp+body with the app's public key. Never raises."""
    try:
        from nacl.signing import VerifyKey
        VerifyKey(bytes.fromhex(public_key_hex)).verify(
            (timestamp or "").encode() + body, bytes.fromhex(signature_hex))
        return True
    except Exception:
        return False


def parse_chart_command(interaction: dict) -> ChartRequest:
    data = interaction.get("data") or {}
    opts = {o.get("name"): o.get("value") for o in (data.get("options") or []) if isinstance(o, dict)}
    ticker = str(opts.get("ticker") or "").strip().upper().lstrip("$")
    if not _TICKER_RE.match(ticker):
        raise CommandError("Ticker must be 1-12 letters/digits (e.g. NVDA, BRK.B).")
    tf = str(opts.get("tf") or "D")
    if tf not in WINDOW:
        raise CommandError("Timeframe must be one of: " + ", ".join(TF_LABEL.values()) + ".")
    return ChartRequest(ticker=ticker, tf=tf)


def build_chart_command() -> dict:
    """The application-command payload Discord receives at registration."""
    return {
        "name": "chart",
        "type": 1,  # CHAT_INPUT
        "description": "Render a clean chart: candles, volume, 10/20/50 SMA",
        "options": [
            {"name": "ticker", "description": "Ticker symbol, e.g. NVDA", "type": 3, "required": True},
            {"name": "tf", "description": "Timeframe (default Daily)", "type": 3, "required": False,
             "choices": [{"name": label, "value": value} for value, label in TF_LABEL.items()]},
        ],
    }


def attachment_name(ticker: str, tf: str, last_t) -> str:
    """TICKER_TF_YYYY-MM-DD_Chart.png — the house chart naming convention."""
    safe = re.sub(r"[^A-Z0-9]", "", ticker.upper())
    tf_tag = tf if tf in ("D", "W") else f"{tf}m"
    return f"{safe}_{tf_tag}_{to_datetime(last_t).strftime('%Y-%m-%d')}_Chart.png"


def edit_original(app_id: str, token: str, *, content: str, png: bytes | None = None,
                  filename: str | None = None, client=None) -> bool:
    """PATCH the deferred reply. With `png`, multipart (payload_json + files[0]);
    without, JSON. Returns True on 2xx. Never raises."""
    url = f"{DISCORD_API}/webhooks/{app_id}/{token}/messages/@original"
    try:
        import httpx
        own = client is None
        c = client or httpx.Client(timeout=15.0)
        try:
            if png is not None:
                payload = {"content": content, "attachments": [{"id": 0, "filename": filename}]}
                r = c.patch(url, data={"payload_json": json.dumps(payload)},
                            files={"files[0]": (filename, png, "image/png")})
            else:
                r = c.patch(url, json={"content": content})
        finally:
            if own:
                c.close()
        if not r.is_success:
            log.warning("[discord-chart] edit_original HTTP %s: %s", r.status_code, r.text[:200])
        return bool(r.is_success)
    except Exception as e:  # noqa: BLE001 — a background job must never raise
        log.warning("[discord-chart] edit_original failed: %s", e)
        return False


def run_chart_job(app_id: str, token: str, req: ChartRequest, *, bars_fn, render_fn, edit_fn) -> str:
    """Background job: bars → PNG → edit the reply. Returns an outcome tag for
    logs/tests: ok | busy | no_bars | render_failed | error. Never raises."""
    label = TF_LABEL[req.tf]
    if not RENDER_SLOTS.acquire(blocking=False):
        try:
            edit_fn(app_id, token, content="Busy, try again in a few seconds.")
        except Exception as e:  # noqa: BLE001
            log.warning("[discord-chart] busy-edit failed: %s", e)
        return "busy"
    try:
        try:
            bars = bars_fn(req.ticker, req.tf, WINDOW[req.tf] + MA_LEAD)
        except Exception as e:  # noqa: BLE001
            log.warning("[discord-chart] bars failed %s %s: %s", req.ticker, req.tf, e)
            bars = None
        if not bars:
            edit_fn(app_id, token, content=f"No bars for {req.ticker} ({label}).")
            return "no_bars"
        try:
            png = render_fn(req.ticker, req.tf, bars)
        except Exception as e:  # noqa: BLE001
            log.warning("[discord-chart] render failed %s %s: %s", req.ticker, req.tf, e)
            edit_fn(app_id, token, content="Chart failed, try again.")
            return "render_failed"
        edit_fn(app_id, token, content=f"{req.ticker} \u00b7 {label}", png=png,
                filename=attachment_name(req.ticker, req.tf, bars[-1]["t"]))
        return "ok"
    except Exception:  # noqa: BLE001
        log.exception("[discord-chart] job crashed %s %s", req.ticker, req.tf)
        return "error"
    finally:
        RENDER_SLOTS.release()
```

- [ ] **Step 4: Run the whole test file**

Run: `python -m pytest tests/test_discord_chart.py -q -p no:cacheprovider`
Expected: `20 passed`.

- [ ] **Step 5: Commit**

```bash
git add api/services/discord_interactions.py requirements.txt tests/test_discord_chart.py
git commit -m "feat(discord-chart): interaction verify/parse/followup/job plumbing" -- api/services/discord_interactions.py requirements.txt tests/test_discord_chart.py
```

---

### Task 3: Endpoint — `POST /api/discord/interactions` + mount

**Files:**
- Create: `api/routers/discord_interactions.py`
- Modify: `api/main.py` — add an import line directly after line 99 (`from api.routers import charts_layouts as charts_layouts_router`) and an `include_router` line directly after line 6052 (`app.include_router(charts.router)`).
- Test: `tests/test_discord_chart.py` (append)

**Interfaces:**
- Consumes: everything in Task 2's Produces; `render_chart_png` from Task 1; `api.routers.bars.get_bars(ticker, tf=..., bars=..., since="", to="", warm=0)` (existing; returns a Starlette response whose `.body` is JSON with a `bars` list).
- Produces: `router: APIRouter`, `fetch_bars(ticker: str, tf: str, n: int) -> list[dict] | None`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_discord_chart.py`:

```python
# ── Task 3: endpoint ──────────────────────────────────────────────────────────

def _app_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import discord_interactions as rt
    app = FastAPI()
    app.include_router(rt.router)
    return TestClient(app), rt


def _post(client, sk, payload: dict, *, ts="1700000000", sign=True, bad_sig=False):
    body = json.dumps(payload).encode()
    headers = {"content-type": "application/json"}
    if sign:
        headers["X-Signature-Ed25519"] = ("00" * 64) if bad_sig else _sign(sk, ts, body)
        headers["X-Signature-Timestamp"] = ts
    return client.post("/api/discord/interactions", content=body, headers=headers)


def test_endpoint_dark_without_public_key(monkeypatch):
    monkeypatch.delenv("DISCORD_CHART_PUBLIC_KEY", raising=False)
    client, _ = _app_client()
    sk, _pk = _keypair()
    r = _post(client, sk, {"type": 1})
    assert r.status_code == 503


def test_endpoint_rejects_unsigned_and_bad_signature(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, _ = _app_client()
    assert _post(client, sk, {"type": 1}, sign=False).status_code == 401
    assert _post(client, sk, {"type": 1}, bad_sig=True).status_code == 401
    r = _post(client, sk, {"type": 1})
    assert r.status_code == 200 and r.json() == {"type": 1}


def test_endpoint_malformed_body_after_valid_signature_is_400(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, _ = _app_client()
    body = b"{not json"
    r = client.post("/api/discord/interactions", content=body, headers={
        "X-Signature-Ed25519": _sign(sk, "1", body), "X-Signature-Timestamp": "1"})
    assert r.status_code == 400


def test_endpoint_defers_and_schedules_job_for_valid_chart(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    scheduled = []

    def fake_job(app_id, token, req, *, bars_fn, render_fn, edit_fn):
        scheduled.append((app_id, token, req, bars_fn, render_fn, edit_fn))
        return "ok"
    monkeypatch.setattr(rt.di, "run_chart_job", fake_job)

    r = _post(client, sk, _interaction("nvda", "15"))
    assert r.status_code == 200 and r.json() == {"type": 5}
    assert len(scheduled) == 1
    app_id, token, req, bars_fn, render_fn, edit_fn = scheduled[0]
    assert (app_id, token) == ("123", "tok")
    assert req == rt.di.ChartRequest("NVDA", "15")
    assert bars_fn is rt.fetch_bars
    assert render_fn is rt.render_chart_png
    assert edit_fn is rt.di.edit_original


def test_endpoint_bad_ticker_is_immediate_ephemeral_and_schedules_nothing(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: pytest.fail("must not schedule"))
    r = _post(client, sk, _interaction("NVDA;rm"))
    assert r.status_code == 200
    assert r.json()["type"] == 4
    assert r.json()["data"]["flags"] == 64
    assert "Ticker" in r.json()["data"]["content"]


def test_endpoint_unknown_command_is_ephemeral(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    monkeypatch.setattr(rt.di, "run_chart_job", lambda *a, **k: pytest.fail("must not schedule"))
    r = _post(client, sk, _interaction("NVDA", name="recall"))
    assert r.json() == {"type": 4, "data": {"content": "Unknown command.", "flags": 64}}
    r = _post(client, sk, {"type": 3, "data": {"name": "chart"}})
    assert r.json()["type"] == 4


def test_fetch_bars_uses_get_bars_and_only_accepts_200_with_bars(monkeypatch):
    from fastapi.responses import JSONResponse
    from api.routers import discord_interactions as rt
    from api.routers import bars as bars_router
    calls = []

    def fake_get_bars(ticker, tf, bars, since, to, warm):
        calls.append((ticker, tf, bars, since, to, warm))
        if ticker == "NVDA":
            return JSONResponse(content={"ticker": "NVDA", "tf": tf, "bars": [{"t": "2026-08-25", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}]})
        if ticker == "ZZZZQ":
            return JSONResponse(content={"ticker": "ZZZZQ", "tf": tf, "bars": [], "no_data": True})
        return JSONResponse(status_code=503, content={"error": "provider"})
    monkeypatch.setattr(bars_router, "get_bars", fake_get_bars)

    assert rt.fetch_bars("NVDA", "D", 170) == [{"t": "2026-08-25", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}]
    assert calls[-1] == ("NVDA", "D", 170, "", "", 0)
    assert rt.fetch_bars("ZZZZQ", "D", 170) is None
    assert rt.fetch_bars("BOOM", "60", 150) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_discord_chart.py -q -p no:cacheprovider -k endpoint or fetch_bars`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.routers.discord_interactions'`.

- [ ] **Step 3: Write the router**

Create `api/routers/discord_interactions.py`:

```python
"""POST /api/discord/interactions — HTTP endpoint for the /chart slash command.

Discord signs every interaction (Ed25519 over timestamp+body). The handler
verifies, answers within Discord's 3 s budget, and hands the slow part (bars,
render, upload) to a background task. Public key unset ⇒ 503: the endpoint is
dark rather than trusting anything unsigned.
"""
from __future__ import annotations

import json
import logging
import os

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse

from api.services import discord_interactions as di
from api.services.discord_chart_render import render_chart_png

router = APIRouter()
log = logging.getLogger(__name__)


def _public_key() -> str:
    return (os.environ.get("DISCORD_CHART_PUBLIC_KEY") or "").strip()


def fetch_bars(ticker: str, tf: str, n: int) -> list[dict] | None:
    """The one bars adapter: calls the /api/bars router function in-process so
    index/breadth/delisted/yf-only routing and fetch-on-miss all apply. Every
    parameter is passed explicitly because the function's Query(...) defaults
    only resolve over HTTP. Only a 200 with a non-empty `bars` list counts."""
    from api.routers import bars as bars_router
    resp = bars_router.get_bars(ticker, tf, n, "", "", 0)
    if getattr(resp, "status_code", 200) != 200:
        return None
    body = getattr(resp, "body", b"") or b""
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    bars = payload.get("bars") or []
    return bars or None


def _ephemeral(message: str) -> dict:
    return {"type": 4, "data": {"content": message, "flags": di.EPHEMERAL}}


@router.post("/api/discord/interactions")
async def discord_interactions(request: Request, background: BackgroundTasks):
    key = _public_key()
    if not key:
        return JSONResponse(status_code=503, content={"error": "discord interactions not configured"})
    body = await request.body()
    sig = request.headers.get("X-Signature-Ed25519", "")
    ts = request.headers.get("X-Signature-Timestamp", "")
    if not sig or not ts or not di.verify_signature(key, sig, ts, body):
        return JSONResponse(status_code=401, content={"error": "invalid request signature"})
    try:
        interaction = json.loads(body)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "malformed body"})
    if not isinstance(interaction, dict):
        return JSONResponse(status_code=400, content={"error": "malformed body"})

    itype = interaction.get("type")
    if itype == 1:
        return {"type": 1}
    if itype == 2 and (interaction.get("data") or {}).get("name") == "chart":
        try:
            req = di.parse_chart_command(interaction)
        except di.CommandError as e:
            return _ephemeral(str(e))
        app_id = str(interaction.get("application_id") or os.environ.get("DISCORD_CHART_APP_ID") or "")
        token = str(interaction.get("token") or "")
        if not app_id or not token:
            return _ephemeral("Discord did not supply a reply token.")
        background.add_task(di.run_chart_job, app_id, token, req,
                            bars_fn=fetch_bars, render_fn=render_chart_png, edit_fn=di.edit_original)
        return {"type": 5}
    return _ephemeral("Unknown command.")
```

- [ ] **Step 4: Mount it in `api/main.py`**

After line 99 (`from api.routers import charts_layouts as charts_layouts_router`) add:

```python
from api.routers import discord_interactions as discord_interactions_router
```

After line 6052 (`app.include_router(charts.router)`) add:

```python
app.include_router(discord_interactions_router.router)
```

Verify with `git diff --stat api/main.py` → exactly `2 insertions(+)`.

- [ ] **Step 5: Run the whole test file, then a mount check**

Run: `python -m pytest tests/test_discord_chart.py -q -p no:cacheprovider`
Expected: `27 passed`.

Mount check (main.py is heavy; this only parses it):
```bash
python - <<'EOF'
import ast, sys
src = open("api/main.py", encoding="utf-8").read()
tree = ast.parse(src)
imports = [n for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module == "api.routers" and any(a.name == "discord_interactions" for a in n.names)]
mounts = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "include_router" and "discord_interactions_router" in ast.unparse(n)]
print("import", len(imports), "mount", len(mounts)); sys.exit(0 if len(imports) == 1 and len(mounts) == 1 else 1)
EOF
```
Expected: `import 1 mount 1`.

- [ ] **Step 6: Commit**

```bash
git add api/routers/discord_interactions.py api/main.py tests/test_discord_chart.py
git commit -m "feat(discord-chart): /api/discord/interactions endpoint, mounted" -- api/routers/discord_interactions.py api/main.py tests/test_discord_chart.py
```

---

### Task 4: Local registration tool

**Files:**
- Create: `tools/discord_chart_commands.py`
- Test: `tests/test_discord_chart.py` (append)

**Interfaces:**
- Consumes: `DISCORD_API`, `build_chart_command` from `api.services.discord_interactions`.
- Produces: CLI `python tools/discord_chart_commands.py {show|register|endpoint|invite}`; module functions `show(client) -> dict`, `register(client, app_id, guild_id, *, clear=False) -> list`, `set_endpoint(client, url) -> dict`, `invite_url(app_id) -> str`, `make_client(token, transport=None) -> httpx.Client`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_discord_chart.py`:

```python
# ── Task 4: registration tool ─────────────────────────────────────────────────

def test_tool_register_puts_the_chart_command_and_clear_puts_empty():
    import httpx
    import importlib
    tool = importlib.import_module("tools.discord_chart_commands")
    from api.services.discord_interactions import build_chart_command
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        if request.method == "GET":
            return httpx.Response(200, json={"id": "999", "name": "UCT Charts", "verify_key": "ab" * 32})
        return httpx.Response(200, json=json.loads(request.content) if request.content else {})

    client = tool.make_client("bot-token", transport=httpx.MockTransport(handler))
    info = tool.show(client)
    assert info["id"] == "999" and info["verify_key"] == "ab" * 32
    assert seen[-1].headers["authorization"] == "Bot bot-token"
    assert str(seen[-1].url).endswith("/applications/@me")

    tool.register(client, "999", "8822", clear=False)
    assert seen[-1].method == "PUT"
    assert str(seen[-1].url).endswith("/applications/999/guilds/8822/commands")
    assert json.loads(seen[-1].content) == [build_chart_command()]

    tool.register(client, "999", "8822", clear=True)
    assert json.loads(seen[-1].content) == []

    tool.set_endpoint(client, "https://uctintelligence.com/api/discord/interactions")
    assert seen[-1].method == "PATCH" and str(seen[-1].url).endswith("/applications/@me")
    assert json.loads(seen[-1].content) == {"interactions_endpoint_url": "https://uctintelligence.com/api/discord/interactions"}

    assert tool.invite_url("999") == "https://discord.com/oauth2/authorize?client_id=999&scope=applications.commands"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_discord_chart.py -q -p no:cacheprovider -k tool_register`
Expected: FAIL with `ModuleNotFoundError: No module named 'tools.discord_chart_commands'` (if `tools/` has no `__init__.py`, importlib still resolves it as a namespace package from the repo root, which pytest puts on `sys.path` via the root conftest).

- [ ] **Step 3: Write the tool**

Create `tools/discord_chart_commands.py`:

```python
"""One-shot Discord setup for the /chart command. Runs LOCALLY with the app's
bot token; nothing here ever runs on Railway.

  python tools/discord_chart_commands.py show
  python tools/discord_chart_commands.py register --guild <GUILD_ID> [--clear]
  python tools/discord_chart_commands.py endpoint --url https://uctintelligence.com/api/discord/interactions
  python tools/discord_chart_commands.py invite

Env (or --env-file, default .env at the repo root): DISCORD_CHART_BOT_TOKEN
(required), DISCORD_CHART_APP_ID (optional: `show` reports it),
DISCORD_CHART_GUILD_ID (default for --guild).

`endpoint` must run AFTER the API is deployed: Discord validates the URL by
sending a PING and a bad-signature request during the PATCH.
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys

import httpx

_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from api.services.discord_interactions import DISCORD_API, build_chart_command  # noqa: E402


def make_client(token: str, transport=None) -> httpx.Client:
    return httpx.Client(base_url=DISCORD_API, timeout=20.0, transport=transport,
                        headers={"Authorization": f"Bot {token}", "User-Agent": "UCT-Charts (uctintelligence.com, 1.0)"})


def show(client: httpx.Client) -> dict:
    r = client.get("/applications/@me")
    r.raise_for_status()
    return r.json()


def register(client: httpx.Client, app_id: str, guild_id: str, *, clear: bool = False) -> list:
    body = [] if clear else [build_chart_command()]
    r = client.put(f"/applications/{app_id}/guilds/{guild_id}/commands", json=body)
    r.raise_for_status()
    return r.json()


def set_endpoint(client: httpx.Client, url: str) -> dict:
    r = client.patch("/applications/@me", json={"interactions_endpoint_url": url})
    r.raise_for_status()
    return r.json()


def invite_url(app_id: str) -> str:
    return f"https://discord.com/oauth2/authorize?client_id={app_id}&scope=applications.commands"


def _load_env(path: str | None) -> None:
    from dotenv import load_dotenv
    p = pathlib.Path(path) if path else _ROOT / ".env"
    if p.exists():
        load_dotenv(p, override=False)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env-file", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    reg = sub.add_parser("register")
    reg.add_argument("--guild", default=None)
    reg.add_argument("--clear", action="store_true")
    ep = sub.add_parser("endpoint")
    ep.add_argument("--url", required=True)
    sub.add_parser("invite")
    args = ap.parse_args(argv)

    _load_env(args.env_file)
    token = os.environ.get("DISCORD_CHART_BOT_TOKEN", "").strip()
    if not token:
        print("DISCORD_CHART_BOT_TOKEN is not set", file=sys.stderr)
        return 2
    client = make_client(token)
    app_id = os.environ.get("DISCORD_CHART_APP_ID", "").strip() or str(show(client)["id"])

    if args.cmd == "show":
        info = show(client)
        print(f"application_id={info['id']}\nname={info.get('name')}\npublic_key={info.get('verify_key')}")
        print(f"interactions_endpoint_url={info.get('interactions_endpoint_url')}")
    elif args.cmd == "register":
        guild = args.guild or os.environ.get("DISCORD_CHART_GUILD_ID", "").strip()
        if not guild:
            print("--guild or DISCORD_CHART_GUILD_ID required", file=sys.stderr)
            return 2
        out = register(client, app_id, guild, clear=args.clear)
        print(f"registered {len(out)} command(s) in guild {guild}: {[c.get('name') for c in out]}")
    elif args.cmd == "endpoint":
        info = set_endpoint(client, args.url)
        print(f"interactions_endpoint_url={info.get('interactions_endpoint_url')}")
    elif args.cmd == "invite":
        print(invite_url(app_id))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the whole test file**

Run: `python -m pytest tests/test_discord_chart.py -q -p no:cacheprovider`
Expected: `28 passed`.

- [ ] **Step 5: Commit**

```bash
git add tools/discord_chart_commands.py tests/test_discord_chart.py
git commit -m "feat(discord-chart): local command/endpoint registration tool" -- tools/discord_chart_commands.py tests/test_discord_chart.py
```

---

### Task 5: Ship, configure, register, E2E

**Files:** none new. Uses Railway CLI, the tool from Task 4, and Discord.

**Interfaces:**
- Consumes: the deployed endpoint; `tools/discord_chart_commands.py`; the Discord application "UCT Charts" (created by the owner or via the owner's browser: Developer Portal → New Application → name `UCT Charts`; Bot tab → Reset Token; General Information → Application ID + Public Key).
- Produces: a working `/chart` in the UT guild.

- [ ] **Step 1: Pre-ship checks in the worktree**

```bash
git fetch origin master && git rebase origin/master
python -m pytest tests/test_discord_chart.py tests/test_bars_dead_ticker.py -q -p no:cacheprovider
git merge-base --is-ancestor origin/master HEAD && echo FF-OK
```
Expected: rebase clean (or resolve), all tests pass, `FF-OK`.

- [ ] **Step 2: Ship (GitHub-triggered `web` deploy)**

```bash
git push origin feat/discord-chart-command:master
```

Poll the deploy (logs do not stream; re-invoke):
```bash
cd /c/Users/Patrick/uct-dashboard && for i in $(seq 1 30); do railway logs -s web 2>/dev/null | grep -m1 -E "Application startup complete|Uvicorn running" && break; sleep 20; done
```
Then prove the route is the new code, not just "deploy succeeded":
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://uctintelligence.com/api/discord/interactions -H 'content-type: application/json' -d '{"type":1}'
```
Expected: `503` (route live, key not yet set). `404` means the old image is still serving; `200` means signature verification is not gating — stop and investigate.

- [ ] **Step 3: Credentials from the app, then Railway vars**

Put the bot token + guild id in `C:\Users\Patrick\uct-dashboard\.env` (gitignored; never committed):
```
DISCORD_CHART_BOT_TOKEN=<bot token from the portal>
DISCORD_CHART_GUILD_ID=<UT guild id — same value as DISCORD_GUILD_ID in C:\Users\Patrick\uct_intelligence\.env>
```
Then from the worktree:
```bash
python tools/discord_chart_commands.py --env-file /c/Users/Patrick/uct-dashboard/.env show
```
Copy `application_id` and `public_key` from the output into Railway:
```bash
cd /c/Users/Patrick/uct-dashboard && railway variables --service web --set "DISCORD_CHART_PUBLIC_KEY=<public_key>" --set "DISCORD_CHART_APP_ID=<application_id>"
```
Railway redeploys `web` on a variable change; wait for startup again, then:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://uctintelligence.com/api/discord/interactions -H 'content-type: application/json' -d '{"type":1}'
```
Expected: `401` (key set, unsigned rejected).

- [ ] **Step 4: Point Discord at the endpoint, register, invite**

```bash
python tools/discord_chart_commands.py --env-file /c/Users/Patrick/uct-dashboard/.env endpoint --url https://uctintelligence.com/api/discord/interactions
python tools/discord_chart_commands.py --env-file /c/Users/Patrick/uct-dashboard/.env register
python tools/discord_chart_commands.py --env-file /c/Users/Patrick/uct-dashboard/.env invite
```
Expected: `endpoint` prints the URL back (Discord accepted it; a 400 here means the live endpoint failed the PING/bad-signature validation — check Step 3's 401 first). `register` prints `registered 1 command(s) ... ['chart']`. Open the invite URL in the owner's browser, pick the UT server, Authorize.

- [ ] **Step 5: E2E in Discord (open the artifact)**

In a test channel of the UT server run, one at a time:
- `/chart ticker:SPY` → PNG, daily, three MA lines, volume, gold title `SPY · Daily · <price> (<pct>)`.
- `/chart ticker:NVDA tf:15 min` → intraday axis labels `MM-DD HH:MM`, footer `as of ... ET`.
- `/chart ticker:ZZZZQ` → reply edited to `No bars for ZZZZQ (Daily).`
- `/chart ticker:bad!ticker` → ephemeral `Ticker must be 1-12 letters/digits ...`.

Download one PNG and open it. Confirm in Railway logs there is no `[discord-chart]` warning for the happy paths.

- [ ] **Step 6: Confirm `web` never sleeps**

Railway dashboard → project `luminous-recreation` → service `web` → Settings → "Sleep when idle" must be OFF (the `worker` was found sleeping on 2026-08-25). If it is on, turn it off; a cold start misses Discord's 3 s window.

- [ ] **Step 7: Record**

Update memory (`project_discord_chart_command_2026_08_25.md` + one MEMORY.md line) with: app id (not the token), env var names, the rollback (`unset DISCORD_CHART_PUBLIC_KEY` or `register --clear`), and anything the E2E taught.

---

## Self-review

**Spec coverage:** renderer (Task 1), signature/parse/followup/job/slots (Task 2), endpoint incl. 503/401/400/type 1/4/5 and the in-process `get_bars` adapter (Task 3), registration tool with `show/register/endpoint/invite` (Task 4), deploy/vars/endpoint/register/E2E/sleep check/rollback (Task 5). `TF_LABEL` single authority: renderer defines, Task 2 derives choices and labels, Task 4 registers from it. Filename convention: Task 2 `attachment_name` + test. Kill switch: Task 3 503 + Task 5 rollback.

**Placeholder scan:** none; every code step is complete code. Values the owner must supply (token, guild id, app id, public key) are marked `<...>` only in Task 5 shell lines where they are secrets read from the portal.

**Type consistency:** `edit_fn(app_id, token, *, content, png=None, filename=None)` is the same shape in `edit_original`, `_Edits`, and `run_chart_job`; `bars_fn(ticker, tf, n)` matches `fetch_bars`; `render_fn(ticker, tf, bars)` matches `render_chart_png`; `get_bars` is called positionally `(ticker, tf, n, "", "", 0)` in both the adapter and its test fake.
