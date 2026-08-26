def volavg = Average(volume,50);
plot scan = volume > 2 * volavg and volume > 1.03 * volume[2] and close > 1.05 * close[1];