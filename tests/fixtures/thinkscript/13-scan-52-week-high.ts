Def High52 = Highest(High,52);
Def Perc = High52 - (High52 * 0.02);
Plot Scan = Close >= Perc;