"""Four assistant-shaped Pine scripts (tables, labels, boxes, lines), the kind the script turn writes."""

TABLE = '''//@version=5
indicator("Trend dashboard", overlay=true)
len1 = input.int(20, "Fast")
len2 = input.int(50, "Slow")
f = ta.ema(close, len1)
s = ta.ema(close, len2)
r = ta.rsi(close, 14)
a = ta.atr(14)
plot(f, "Fast", color.teal)
plot(s, "Slow", color.orange)
var table t = table.new(position.top_right, 2, 5, bgcolor=color.new(color.black, 20))
if barstate.islast
    table.cell(t, 0, 0, "Trend", text_color=color.white)
    table.cell(t, 1, 0, f > s ? "Up" : "Down", text_color=f > s ? color.green : color.red)
    table.cell(t, 0, 1, "RSI", text_color=color.white)
    table.cell(t, 1, 1, str.tostring(r, "#.0"), text_color=color.white)
    table.cell(t, 0, 2, "ATR", text_color=color.white)
    table.cell(t, 1, 2, str.tostring(a, "#.00"), text_color=color.white)
    table.cell(t, 0, 3, "Fast", text_color=color.white)
    table.cell(t, 1, 3, str.tostring(f, "#.00"), text_color=color.white)
    table.cell(t, 0, 4, "Slow", text_color=color.white)
    table.cell(t, 1, 4, str.tostring(s, "#.00"), text_color=color.white)
'''

PIVOTS = '''//@version=5
indicator("Pivot labels", overlay=true, max_labels_count=200)
left = input.int(5, "Left")
right = input.int(5, "Right")
ph = ta.pivothigh(high, left, right)
pl = ta.pivotlow(low, left, right)
if not na(ph)
    label.new(bar_index - right, ph, str.tostring(ph, "#.00"), style=label.style_label_down, color=color.red, textcolor=color.white)
if not na(pl)
    label.new(bar_index - right, pl, str.tostring(pl, "#.00"), style=label.style_label_up, color=color.green, textcolor=color.white)
plot(ta.sma(close, 20), "SMA 20", color.blue)
'''

ZONES = '''//@version=5
indicator("Supply and demand zones", overlay=true, max_boxes_count=50)
lookback = input.int(10, "Lookback")
hh = ta.highest(high, lookback)
ll = ta.lowest(low, lookback)
var box up = na
var box dn = na
if ta.crossover(close, hh[1])
    up := box.new(bar_index - lookback, hh[1], bar_index, ll[1], border_color=color.green, bgcolor=color.new(color.green, 85))
if ta.crossunder(close, ll[1])
    dn := box.new(bar_index - lookback, hh[1], bar_index, ll[1], border_color=color.red, bgcolor=color.new(color.red, 85))
if not na(up)
    box.set_right(up, bar_index)
if not na(dn)
    box.set_right(dn, bar_index)
plot(close, "Close", color.gray)
'''

LEVELS = '''//@version=5
indicator("Prior day levels", overlay=true, max_lines_count=20)
pdh = request.security(syminfo.tickerid, "D", high[1], lookahead=barmerge.lookahead_on)
pdl = request.security(syminfo.tickerid, "D", low[1], lookahead=barmerge.lookahead_on)
var line h = na
var line l = na
if barstate.islast
    line.delete(h)
    line.delete(l)
    h := line.new(bar_index - 50, pdh, bar_index, pdh, color=color.red, width=2)
    l := line.new(bar_index - 50, pdl, bar_index, pdl, color=color.green, width=2)
    label.new(bar_index, pdh, "PDH", style=label.style_label_left)
    label.new(bar_index, pdl, "PDL", style=label.style_label_left)
plot(close)
'''

SCRIPTS = [("table", TABLE), ("pivots", PIVOTS), ("zones", ZONES), ("levels", LEVELS)]


def variant(src: str, n: int) -> str:
    """A repair round's source: a different hash, the same shape."""
    return src + f"\n// repair {n}\n"
