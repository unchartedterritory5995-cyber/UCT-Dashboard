# WS6 audit corpus (original) - count up-closes in the last N bars with fold
declare lower;
input n = 10;
def upDays = fold i = 0 to n with acc = 0 do acc + (if GetValue(close, i) > GetValue(close, i + 1) then 1 else 0);
plot UpDayCount = upDays;
