# WS6 audit corpus (original) - MovingAverage with an AverageType input
input maType = AverageType.WEIGHTED;
input len = 20;
plot MA = MovingAverage(maType, close, len);
plot Hull = MovingAverage(AverageType.HULL, close, len);
