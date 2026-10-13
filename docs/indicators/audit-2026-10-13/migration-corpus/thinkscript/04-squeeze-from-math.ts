# WS6 audit corpus (original) - squeeze written from the published math:
# Bollinger Bands inside Keltner Channels, plus a simple momentum histogram
declare lower;
input length = 20;
input bbMult = 2.0;
input kcMult = 1.5;
def mid = Average(close, length);
def dev = StDev(close, length);
def rangeAvg = Average(TrueRange(high, close, low), length);
def bbUp = mid + bbMult * dev;
def bbDn = mid - bbMult * dev;
def kcUp = mid + kcMult * rangeAvg;
def kcDn = mid - kcMult * rangeAvg;
plot SqueezeOn = bbUp < kcUp and bbDn > kcDn;
def donchMid = (Highest(high, length) + Lowest(low, length)) / 2;
plot Momentum = close - (donchMid + mid) / 2;
Momentum.SetPaintingStrategy(PaintingStrategy.HISTOGRAM);
Momentum.AssignValueColor(if Momentum > 0 then Color.CYAN else Color.MAGENTA);
SqueezeOn.SetPaintingStrategy(PaintingStrategy.POINTS);
SqueezeOn.SetDefaultColor(Color.RED);
