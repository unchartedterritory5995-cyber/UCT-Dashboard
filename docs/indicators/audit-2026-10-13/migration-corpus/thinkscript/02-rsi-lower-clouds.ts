# WS6 audit corpus (original) - Wilder RSI from first principles, lower pane, clouds
declare lower;
input length = 14;
input hiLevel = 70;
input loLevel = 30;
def chg = close - close[1];
def upAvg = WildersAverage(Max(chg, 0), length);
def dnAvg = WildersAverage(Max(-chg, 0), length);
plot RSIValue = if dnAvg == 0 then 100 else 100 - 100 / (1 + upAvg / dnAvg);
plot Upper = hiLevel;
plot LowerLvl = loLevel;
RSIValue.SetDefaultColor(Color.YELLOW);
Upper.SetStyle(Curve.SHORT_DASH);
LowerLvl.SetStyle(Curve.SHORT_DASH);
AddCloud(RSIValue, Upper, Color.RED, Color.CURRENT);
AddCloud(LowerLvl, RSIValue, Color.GREEN, Color.CURRENT);
