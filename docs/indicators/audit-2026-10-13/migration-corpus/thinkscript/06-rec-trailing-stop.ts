# WS6 audit corpus (original) - ATR ratchet trailing stop using rec + CompoundValue
input atrLen = 14;
input mult = 3.0;
def atrv = WildersAverage(TrueRange(high, close, low), atrLen);
def rawStop = close - mult * atrv;
rec trail = CompoundValue(1, if close > trail[1] then Max(trail[1], rawStop) else rawStop, rawStop);
plot TrailStop = trail;
TrailStop.SetPaintingStrategy(PaintingStrategy.POINTS);
TrailStop.SetDefaultColor(Color.ORANGE);
