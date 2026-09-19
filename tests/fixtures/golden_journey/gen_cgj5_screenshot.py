"""Generates the Golden Journey #5 (screenshot/vision door) known-answer fixture.

⭐ WHY SYNTHETIC RATHER THAN A REAL CHART SCREENSHOT. Journey #5 (Phase Zero) used
a live browser screenshot of the product's own chart, saved to a session temp
directory and never committed -- so nothing reusable survived that run. A real
browser screenshot is also a MOVING TARGET: the exact pixels depend on theme,
zoom, and whatever the chart happened to be rendering that day, which is the
opposite of a "known answer" fixture. This script instead DRAWS the two things
the vision model needs to recognize -- a candlestick pane and a lower oscillator
pane -- with parameters recorded in code, so "what is in this image" is a fact
this file states rather than something inferred by looking at it.

Run: `python tests/fixtures/golden_journey/gen_cgj5_screenshot.py` regenerates
`cgj5_screenshot_known_answer.png` deterministically (fixed seed, no network).

KNOWN ANSWER, recorded here so the test that consumes this image never has to
guess it: 60 candles of a synthetic uptrend-then-pullback price series (seed 20260904,
so re-running this script byte-for-byet reproduces the same image) with a 14-period
RSI-shaped oscillator (bounded to [0, 100], NOT the real `rsi()` formula -- it is a
smoothed random walk shaped to LOOK like RSI, since the point of this fixture is
"does the vision door recognize a two-pane chart with an oscillator", not "is this
exact RSI value correct") drawn in a lower pane with 30/70 reference lines, which is
the textbook visual signature of RSI. A vision-door candidate naming this pane
`rsi(close, 14)` (or refusing with a clearly wrong guess) is the thing this fixture
exists to distinguish.
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

OUT_PATH = "tests/fixtures/golden_journey/cgj5_screenshot_known_answer.png"
N_BARS = 60
SEED = 20260904


def _synthetic_ohlc(n: int, seed: int):
    rng = np.random.default_rng(seed)
    # Uptrend for the first 40 bars, pullback for the last 20 -- gives the
    # oscillator pane something to actually swing on, rather than a flat walk.
    drift = np.concatenate([np.full(40, 0.6), np.full(n - 40, -0.5)])
    noise = rng.normal(0, 1.0, n)
    close = 100 + np.cumsum(drift + noise)
    open_ = close - rng.normal(0, 0.4, n)
    high = np.maximum(open_, close) + np.abs(rng.normal(0.5, 0.3, n))
    low = np.minimum(open_, close) - np.abs(rng.normal(0.5, 0.3, n))
    return open_, high, low, close


def _synthetic_oscillator(close: np.ndarray, period: int = 14):
    """RSI-SHAPED, not RSI-CORRECT -- see module docstring."""
    delta = np.diff(close, prepend=close[0])
    gain = np.clip(delta, 0, None)
    loss = np.clip(-delta, 0, None)
    avg_gain = np.convolve(gain, np.ones(period) / period, mode="same")
    avg_loss = np.convolve(loss, np.ones(period) / period, mode="same")
    rs = avg_gain / np.where(avg_loss == 0, 1e-9, avg_loss)
    return 100 - (100 / (1 + rs))


def main() -> None:
    o, h, l, c = _synthetic_ohlc(N_BARS, SEED)
    osc = _synthetic_oscillator(c)

    fig, (ax_price, ax_osc) = plt.subplots(
        2, 1, figsize=(10, 7), dpi=120,
        gridspec_kw={"height_ratios": [3, 1]}, sharex=True)
    fig.patch.set_facecolor("#0d1117")
    for ax in (ax_price, ax_osc):
        ax.set_facecolor("#0d1117")
        ax.tick_params(colors="#8b949e")
        for spine in ax.spines.values():
            spine.set_color("#30363d")

    x = np.arange(N_BARS)
    for i in range(N_BARS):
        color = "#3fb950" if c[i] >= o[i] else "#f85149"
        ax_price.plot([x[i], x[i]], [l[i], h[i]], color=color, linewidth=1)
        ax_price.add_patch(Rectangle(
            (x[i] - 0.3, min(o[i], c[i])), 0.6, max(abs(c[i] - o[i]), 0.05),
            facecolor=color, edgecolor=color))
    ax_price.set_title("SYNTHETIC-60D  (Golden Journey #5 known-answer fixture)",
                        color="#c9d1d9", fontsize=10)

    ax_osc.plot(x, osc, color="#d29922", linewidth=1.5)
    ax_osc.axhline(70, color="#f85149", linestyle="--", linewidth=0.8)
    ax_osc.axhline(30, color="#3fb950", linestyle="--", linewidth=0.8)
    ax_osc.set_ylim(0, 100)
    ax_osc.set_ylabel("14", color="#8b949e", fontsize=8)

    plt.tight_layout()
    fig.savefig(OUT_PATH, facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"wrote {OUT_PATH} ({N_BARS} synthetic bars, seed={SEED})")


if __name__ == "__main__":
    main()
