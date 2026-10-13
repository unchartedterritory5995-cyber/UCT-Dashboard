# WS6 audit corpus (original) - study references with every parameter named
def rsiVal = RSI(length = 14, price = close);
def bbLow = BollingerBands(price = close, length = 20, displace = 0, "average type" = AverageType.SIMPLE).LowerBand;
plot Oversold = rsiVal < 30 and close < bbLow;
