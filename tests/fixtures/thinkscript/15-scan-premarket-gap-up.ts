# Pre Market Gap Up Scan
# tomsk
# 1.16.2020

# Run Scan at premarket on one minute aggregation.

def lastPrice = if getTime() crosses RegularTradingEnd(getYYYYMMDD()) then close else lastPrice[1];
plot scan = getTime() < RegularTradingStart(getYYYYMMDD()) and close > lastPrice * 1.8;
# Pre Market Gap Up Scan