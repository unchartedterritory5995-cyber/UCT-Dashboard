# WS6 audit corpus (original) - first 30 minutes high (intraday session logic)
def isOpen30 = SecondsFromTime(0930) >= 0 and SecondsTillTime(1000) > 0;
def orHigh = if isOpen30 and !isOpen30[1] then high else if isOpen30 then Max(high, orHigh[1]) else orHigh[1];
plot ORH = orHigh;
plot BreakOut = close crosses above orHigh;
