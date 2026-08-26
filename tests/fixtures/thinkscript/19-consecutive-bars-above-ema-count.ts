declare lower;
# COUNT OF THE TOTAL NUMBER OF CONSECUTIVE BARS THAT THE LOW is GREATER THAN SPECIFIED MOVING AVERAGE
# By XeoNoX via Usethinkscript.com
def var = low is greater than MovAvgExponential("length" = 21)."AvgExp";
def barUpCount = CompoundValue(1, if var then barUpCount[1] + 1 else 0, 0);
plot scan  = barUpCount;