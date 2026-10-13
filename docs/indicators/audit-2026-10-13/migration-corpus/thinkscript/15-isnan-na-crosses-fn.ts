# WS6 audit corpus (original) - IsNaN guard, Double.NaN and Crosses() function form
input len = 20;
def ma = Average(close, len);
plot Valid = if IsNaN(ma) then Double.NaN else ma;
plot CrossUp = Crosses(close, ma, CrossingDirection.ABOVE);
