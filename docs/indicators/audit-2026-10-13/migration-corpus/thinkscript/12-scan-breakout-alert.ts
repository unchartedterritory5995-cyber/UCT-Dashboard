# WS6 audit corpus (original) - one-line scan with an alert
plot scan = close > Average(close, 50) and volume > 1.5 * Average(volume, 50) and close > Highest(high[1], 20);
Alert(scan, "Volume breakout", Alert.BAR, Sound.Ding);
