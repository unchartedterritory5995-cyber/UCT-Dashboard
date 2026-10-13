# WS6 audit corpus (original) - the same count written with Sum
declare lower;
input n = 10;
plot UpDayCount = Sum(close > close[1], n);
