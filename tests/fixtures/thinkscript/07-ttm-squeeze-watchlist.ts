# TTM Squeeze Watchlist
# TSL
# 11.13.2019

input price = close;
input length = 20;
input nK = 1.5;
input nBB = 2.0;
input alertLine = 1.0;

def squeezeDots = TTM_Squeeze(price, length, nK, nBB, alertLine).SqueezeAlert;
def alertCount = if squeezeDots[1] == 0 and squeezeDots == 1 then 1 
                 else if squeezeDots == 1 then alertCount[1] + 1 
                 else 0;
plot data = alertCount;
data.SetDefaultColor(Color.BLACK);

def squeezeHistogram = TTM_Squeeze(price, length, nK, nBB, alertLine).Histogram;
AssignBackgroundColor(if squeezeHistogram >= 0 
                      then if squeezeHistogram > squeezeHistogram[1] then Color.CYAN else Color.BLUE
                      else if squeezeHistogram < squeezeHistogram[1] then Color.RED else Color.YELLOW);