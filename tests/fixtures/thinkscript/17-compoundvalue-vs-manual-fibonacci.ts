declare lower;

input mode = {default UseCompoundValue, ManualCalculation};

def nan = double.NaN;
def bn = BarNumber();

# UseCompoundValue --------------------------------------------------------------------
def x = CompoundValue(2, x[1] + x[2], 1);
plot FibonacciNumbers1 = if (mode == mode.UseCompoundValue) then x else nan;

AddChartBubble(mode == mode.UseCompoundValue, x, x);

# ManualCalculation --------------------------------------------------------------------
def y;
if (bn == 1 or bn == 2) then {
    y = 1;
} else {
    y = y[1] + y[2];
}
plot FibonacciNumbers2 = if (mode == mode.ManualCalculation) then y else nan;

AddChartBubble(mode == mode.ManualCalculation, y, y);