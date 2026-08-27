# Money Flow Index with Overbought and Oversold Points for Mobile

input length = 14;
input overbought = 74;
input oversold = 26;

def typicalPrice = (high + low + close) / 3;
def moneyFlow = typicalPrice * volume;

def moneyFlowRatio = if Sum(volume, length) != 0 then Sum(if typicalPrice > typicalPrice[1] then moneyFlow else if typicalPrice < typicalPrice[1] then -moneyFlow else 0, length) / Sum(if typicalPrice > typicalPrice[1] then volume else if typicalPrice < typicalPrice[1] then -volume else 0, length) else 0;

def mfi = 100 - (100 / (1 + moneyFlowRatio));

plot MFI = mfi;
plot Overbought = overbought;
plot Oversold = oversold;

MFI.AssignValueColor(if mfi >= overbought then Color.RED else if mfi <= oversold then Color.GREEN else Color.BLUE);
Overbought.SetDefaultColor(Color.RED);
Oversold.SetDefaultColor(Color.GREEN);

plot UpArrow = if  mfi crosses above overbought then low else double.NaN ;
UpArrow .SetPaintingStrategy(PaintingStrategy.POINTS);
UpArrow .SetLineWeight(5);
UpArrow .SetDefaultColor(color.blue) ;

plot DownArrow = if  mfi crosses below oversold then high else double.NaN ;
DownArrow  .SetPaintingStrategy(PaintingStrategy.POINTS);
DownArrow  .SetLineWeight(5);
DownArrow  .SetDefaultColor(color.magenta) ;

#AddChartBubble(MFI crosses above Overbought, Overbought, "Overbought", Color.WHITE, no);
#AddChartBubble(MFI crosses below Oversold, Oversold, "Oversold", Color.WHITE, yes);