input price = close;
input fastLength = 9;
input slowLength = 21;
input averageType = AverageType.SIMPLE;

plot FastMA = MovingAverage(averageType, price, fastLength);
plot SlowMA = MovingAverage(averageType, price, slowLength);
FastMA.SetDefaultColor(GetColor(1));
SlowMA.SetDefaultColor(GetColor(2));

plot ArrowUp = FastMA crosses above SlowMA ;
     ArrowUP.SetPaintingStrategy(PaintingStrategy.Arrow_UP);
     ArrowUP.SetLineWeight(3);
     ArrowUP.SetDefaultColor(Color.Green);

plot ArrowDN = FastMA crosses below SlowMA ;
       ArrowDN.SetPaintingStrategy(PaintingStrategy.Arrow_DOWN);
     ArrowDN.SetLineWeight(3);
     ArrowDN.SetDefaultColor(Color.Red);

Alert(ArrowUp, " ", Alert.Bar, Sound.Chimes);
Alert(ArrowDN, " ", Alert.Bar, Sound.Bell);

AddCloud(FastMA, SlowMA, Color.GREEN, Color.RED);

addOrder(OrderType.BUY_To_OPEN, ArrowUp);
addOrder(OrderType.SELL_TO_CLOSE, ArrowDn);

# End Code