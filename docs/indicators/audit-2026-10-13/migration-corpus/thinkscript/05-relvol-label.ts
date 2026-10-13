# WS6 audit corpus (original) - relative volume label (label-only study)
input avgLen = 50;
input hot = 2.0;
def avgVol = Average(volume, avgLen);
def rvol = volume / avgVol;
AddLabel(yes, "RVOL " + AsText(rvol), if rvol >= hot then Color.GREEN else Color.GRAY);
