# WS6 audit corpus (original) - MACD histogram coloured by slope
declare lower;
input fastLen = 12;
input slowLen = 26;
input sigLen = 9;
def macdLine = ExpAverage(close, fastLen) - ExpAverage(close, slowLen);
def sigLine = ExpAverage(macdLine, sigLen);
plot Hist = macdLine - sigLine;
plot ZeroLine = 0;
Hist.SetPaintingStrategy(PaintingStrategy.HISTOGRAM);
Hist.SetLineWeight(3);
Hist.AssignValueColor(if Hist > Hist[1] then Color.GREEN else Color.RED);
ZeroLine.SetDefaultColor(Color.GRAY);
