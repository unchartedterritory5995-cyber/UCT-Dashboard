# Previous Intradays High, Low, Mean
# Mobius
# V01.12.2017 Desktop and Mobile
# Revised original code that uses SecondsFromTime() and SecondsTillTime(). Code now uses RegularTradingStart() and RegularTradingEnd() to bracket RTH. Works in Mobile Apps

def bar = barNumber();
def h = high;
def l = low;
def c = close;
def firstBar = if getTime() crosses above RegularTradingStart(GetYYYYMMDD()) and
                  !isNaN(close)
               then bar
               else double.nan;
def lastBar = if getTime() crosses above RegularTradingEnd(GetYYYYMMDD()) and
                 !isNaN(close)
              then bar
              else double.nan;
addVerticalLine(bar == HighestAll(firstBar), "first bar", color.cyan, curve.short_dash);
addVerticalLine(bar == HighestAll(lastBar), "last bar", color.cyan, curve.short_dash);
def bar_t1 = if !isNaN(firstBar)
            then bar
            else bar_t1[1];
def bar_t2 = if !isNaN(lastBar)
             then bar
             else bar_t2[1];
def prevFirstBar = if bar_t1 != bar_t1[1]
              then bar_t1[1]
              else prevFirstBar[1];
def prevLastBar = if bar_t2 != bar_t2[1]
                  then bar_t2[1]
                  else prevLastBar[1];
addVerticalLine(bar == HighestAll(prevFirstBar), "prev first bar", color.red, curve.short_dash);
addVerticalLine(bar == HighestAll(prevLastBar), "prev Last bar", color.red, curve.short_dash);
def hh = if bar == HighestAll(prevFirstBar)
         then h
         else if between(bar, highestAll(prevFirstBar), highestAll(LastBar)) and
                 h > hh[1]
              then h
              else hh[1];
def hhBar = if h == hh and between(bar, highestAll(prevFirstBar), highestAll(LastBar))
            then barNumber()
            else double.nan;
def ll = if bar == HighestAll(prevFirstBar)
         then l
         else if between(bar, highestAll(prevFirstBar), highestAll(LastBar)) and
                 l < ll[1]
              then l
              else ll[1];
def llBar = if l == ll and between(bar, highestAll(prevFirstBar), highestAll(LastBar))
            then bar
            else double.nan;
plot PrevDayHigh = if bar >= highestAll(hhBar)
                   then highestAll(if isNaN(c[-1])
                                   then hh
                                   else double.nan)
                   else double.nan;
     PrevDayHigh.SetStyle(Curve.Long_Dash);
     PrevDayHigh.SetLineWeight(3);
     PrevDayHigh.SetDefaultColor(Color.Green);
     PrevDayHigh.HideTitle();
plot PrevDayLow = if bar >= HighestAll(llBar)
                  then highestAll(if isNaN(c[-1])
                                  then ll
                                  else double.nan)
                  else double.nan;
     PrevDayLow.SetStyle(Curve.Long_Dash);
     PrevDayLow.SetLineWeight(3);
     PrevDayLow.SetDefaultColor(Color.Red);
     PrevDayLow.HideTitle();
def hl2bar = Floor((highestAll(hhbar) + highestAll(llBar)) / 2);
def hl2price = Round(((PrevDayHigh + PrevDayLow) / 2) / TickSize(), 0) * TickSize();
plot PrevDayHL2 = if bar >= highestAll(HL2bar)
               then highestAll(if !isNaN(c[-1])
                               then HL2price
                               else double.nan)
               else double.nan;
     PrevDayHL2.SetStyle(Curve.Long_Dash);
     PrevDayHL2.SetLineWeight(3);
     PrevDayHL2.SetDefaultColor(Color.Yellow);
     PrevDayHL2.HideTitle();
# End Code Previous Days High, Low, Mean