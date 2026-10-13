# WS6 audit corpus (original) - weekly 10-bar average shown on a daily chart
input length = 10;
def wkClose = close(period = AggregationPeriod.WEEK);
plot WeeklyMA = Average(wkClose, length);
plot AboveWeekly = close > WeeklyMA;
WeeklyMA.SetDefaultColor(Color.WHITE);
