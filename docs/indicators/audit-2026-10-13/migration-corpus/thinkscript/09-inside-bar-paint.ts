# WS6 audit corpus (original) - paint inside bars and mark them
def isInside = high < high[1] and low > low[1];
AssignPriceColor(if isInside then Color.YELLOW else Color.CURRENT);
plot InsideBar = isInside;
InsideBar.SetPaintingStrategy(PaintingStrategy.BOOLEAN_POINTS);
InsideBar.SetDefaultColor(Color.YELLOW);
