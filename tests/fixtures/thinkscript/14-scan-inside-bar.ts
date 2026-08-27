# Inside and Outside Bar
# Mobius
# 8.7.2017

def inside = high < high[1] and low > low[1];
plot signal = inside within 1 bars;