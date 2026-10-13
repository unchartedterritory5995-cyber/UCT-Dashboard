# WS6 audit corpus (original) - relative volume label plus a plotted column
declare lower;
input avgLen = 50;
input hot = 2.0;
def avgVol = Average(volume, avgLen);
plot RelVol = volume / avgVol;
RelVol.SetPaintingStrategy(PaintingStrategy.HISTOGRAM);
AddLabel(yes, "RVOL " + AsText(RelVol), if RelVol >= hot then Color.GREEN else Color.GRAY);
