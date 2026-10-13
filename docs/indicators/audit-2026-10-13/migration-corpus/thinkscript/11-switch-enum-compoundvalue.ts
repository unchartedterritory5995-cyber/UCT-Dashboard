# WS6 audit corpus (original) - enum input + switch + a CompoundValue streak counter
input avgType = {default SMA, EMA};
input len = 20;
def ma;
switch (avgType) {
case SMA:
    ma = Average(close, len);
case EMA:
    ma = ExpAverage(close, len);
}
def streak = CompoundValue(1, if close > ma then streak[1] + 1 else 0, 0);
plot DaysAbove = streak;
plot MA = ma;
