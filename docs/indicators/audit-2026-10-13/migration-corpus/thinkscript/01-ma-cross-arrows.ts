# WS6 audit corpus (original) - fast EMA / slow SMA crossover with arrows
input fastLength = 9;
input slowLength = 21;
def fast = ExpAverage(close, fastLength);
def slow = Average(close, slowLength);
plot FastMA = fast;
plot SlowMA = slow;
plot BuySignal = fast crosses above slow;
plot SellSignal = fast crosses below slow;
FastMA.SetDefaultColor(Color.CYAN);
SlowMA.SetDefaultColor(Color.MAGENTA);
SlowMA.SetLineWeight(2);
BuySignal.SetPaintingStrategy(PaintingStrategy.BOOLEAN_ARROW_UP);
SellSignal.SetPaintingStrategy(PaintingStrategy.BOOLEAN_ARROW_DOWN);
