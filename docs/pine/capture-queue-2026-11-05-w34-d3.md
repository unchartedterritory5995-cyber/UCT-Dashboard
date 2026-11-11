# Capture queue: ta.correlation with na in a source (W3W4-D3)

Why: the committed capture `tests/fixtures/vendor/r11-corr-pct-spy-2026-09-11.json` pins only `ta.correlation(close, close, 20)`.
The shared builder (`callExpansions.js` correlation = sma(x*y) - sma(x)*sma(y) over stdev(x)*stdev(y)) drops na per window, and with na in ONE source returns |r| > 1 (-47.64 measured; also on master for a pure call, N1). The runtime lane refuses `correlation` over runtime state by name until this is pinned. `correlation-matrix` (security() results with gaps) waits on it.

Probe to capture (v5, SPY 1D, one study, plot each as its own series, read per-bar values):
```
//@version=5
indicator("UCTPROBE_CORR_NA")
z  = bar_index % 7 == 3 ? na : close
w  = bar_index % 5 == 1 ? na : volume
k  = 1.0
plot(ta.correlation(z, volume, 5), "z_v")      // na in ONE source
plot(ta.correlation(z, w, 5), "z_w")           // na in BOTH, different bars
plot(ta.correlation(close, k, 5), "const")     // constant series (0/0 case)
plot(ta.correlation(close, volume, 5), "ref")  // no-na control
plot(ta.correlation(close, close, 2), "len2")  // smallest legal length
plot(ta.correlation(close, volume, 1), "len1") // does it compile / what value
```
Settings: SPY, 1D, regular session, full history; also repeat the `z_v` series with length 20.
Fields to record: per-bar value of each plot for the last 60 bars and the first 30 bars, whether each is na or finite, whether any |value| > 1, compile result for len1, bar_index of the first finite value per plot.
Then: fix the one builder to match, drop the refusal, and add the runtime branch with a rail graded against the capture.
