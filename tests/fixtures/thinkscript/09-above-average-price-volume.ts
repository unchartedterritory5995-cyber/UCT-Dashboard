def Period = AggregationPeriod.DAY;

def varhigh = high(period = Period);
def varlow = low(period = Period);
def varvol = volume(period = Period);

def SMAVD50 = SimpleMovingAvg(varvol,50);
def SMAHD20 = SimpleMovingAvg(varhigh,20);
def SMALD20 = SimpleMovingAvg(varlow,20);


def Cond1 = close[1]>SMAHD20;
def Cond2 = close[1]>SMAHD20[1];
def Cond3 = close[1]>SMAHD20[2];
def Cond4 = volume[1]>SMAVD50;

def Buy = Cond1 and Cond2 and Cond3 and Cond4;

plot BuyP = if Buy then yes else Double.NaN;
BuyP.SetPaintingStrategy(PaintingStrategy.BOOLEAN_ARROW_UP);
BuyP.AssignValueColor(Color.Green);