# RS Z-Score MACD-Style with Z-Line & Signal
# Fixed Color Constants for ThinkScript

declare lower;

input benchmark = "SPY";
input zLength = 126;  
input fastLen = 10;
input slowLen = 30;
input signalLen = 9;

# --- Relative Strength Logic ---
def benchClose = close(symbol = benchmark);
def rs = if !IsNaN(benchClose) and benchClose > 0 then close / benchClose else Double.NaN;

# --- RS Z-Score (The "Reality" Line) ---
def mean = Average(rs, zLength);
def sd   = StDev(rs, zLength);
plot RSZ_Line = if sd != 0 then (rs - mean) / sd else 0;

# --- MACD Components ---
def rsZ_fast = Average(RSZ_Line, fastLen);
def rsZ_slow = Average(RSZ_Line, slowLen);
plot RSZ_Hist = rsZ_fast - rsZ_slow;
plot Signal = ExpAverage(RSZ_Hist, signalLen);

# --- Thresholds ---
plot ZeroLine = 0;
plot UpperExtreme = 2.0;
plot LowerExtreme = -2.0;

# --- Styling & Clouds ---
RSZ_Line.SetDefaultColor(Color.WHITE);
RSZ_Line.SetLineWeight(2);

RSZ_Hist.SetPaintingStrategy(PaintingStrategy.HISTOGRAM);
RSZ_Hist.AssignValueColor(
    if RSZ_Hist > Signal and RSZ_Hist > 0 then Color.GREEN
    else if RSZ_Hist < Signal and RSZ_Hist > 0 then Color.DARK_GREEN
    else if RSZ_Hist < Signal and RSZ_Hist < 0 then Color.RED
    else Color.DARK_RED
);

# Fixed Cloud: Using DefineColor or standard Blue
AddCloud(RSZ_Line, ZeroLine, Color.BLUE, Color.DARK_GRAY);

Signal.SetDefaultColor(Color.YELLOW);
Signal.SetStyle(Curve.SHORT_DASH);
ZeroLine.SetDefaultColor(Color.GRAY);
UpperExtreme.SetDefaultColor(Color.RED);
LowerExtreme.SetDefaultColor(Color.CYAN);