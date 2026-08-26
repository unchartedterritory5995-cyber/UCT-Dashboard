# UpPoints DownPoints Ratio
# tomsk
# 1.17.2020

# Plots the ratio of Up/Down points relative to the prior candle

declare lower;

def upPoints   = fold i = 0 to 8
                 with p
                 do p + GetValue(if close > close[1] then close - close[1] else 0, i);
def downPoints = fold j = 0 to 8
                 with r
                 do r + GetValue(if close < close[1] then close - close[1] else 0, j);
plot ratio = upPoints / AbsValue(downPoints);

AddLabel(1, "Up Points = " + upPoints, Color.Yellow);
AddLabel(1, "Down Points = " + downPoints, Color.Yellow);
# End UpPoints DownPoints Ratio