# WS6 audit corpus (original) - references other built-in studies
def rsiVal = RSI(14);
def macdDiff = MACD(12, 26, 9).Diff;
plot Signal = rsiVal > 50 and macdDiff > 0;
