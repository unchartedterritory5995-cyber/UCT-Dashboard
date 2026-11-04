import json, os
OUT = os.path.join(os.path.dirname(__file__), 'acceptance.json')
EMA = lambda n: {"defId": "movingAverage", "inputs.period": n, "inputs.maType": "ema"}
SMA = lambda n: {"defId": "movingAverage", "inputs.period": n, "inputs.maType": "sma"}
RSI = {"defId": "rsi"}
MACD = {"defId": "macd"}
VWAP = {"defId": "vwap"}
def inst(chart, find, has=None, colour=None):
    e = {"chart": chart, "find": find}
    if has: e["has"] = has
    if colour: e["colour"] = {"key": "inputs.color", "family": colour}
    return {"instance": e}
def W(id, board, say, expect, undo_expect=None, note=""):
    return {"id": id, "board": board, "note": note, "steps": [{"say": say, "expect": expect}, {"say": "undo", "expect": undo_expect or {"restored": True}}]}
# NOTE: new charts are born with the product's default overlays (EMA 9/20, SMA 50/200), so the indicators asked for on a
# NEW chart below are deliberately ones that are NOT defaults (RSI, MACD, EMA 21, SMA 100, VWAP).
inplan = [
 W("P01.chart-then-rsi-on-it", "HALF", "add a chart for AMD and put RSI on it", {"charts": {"count": 2, "symbolSet": ["NVDA", "AMD"]}, **inst(1, RSI)}),
 W("P02.new-chart-weekly", "HALF", "open TSLA on a new chart and switch it to the weekly", {"charts": {"count": 2, "symbols": ["NVDA", "TSLA"], "tfs": ["D", "W"]}}),
 W("P03.two-charts-hourly", "HALF", "add charts for AMD and AVGO, both on the hourly", {"charts": {"count": 3, "symbolSet": ["NVDA", "AMD", "AVGO"]}}),
 W("P04.weekly-and-21ema", "ONE", "put NVDA on the weekly and add the 21 ema to it", {"charts": {"tf": "W"}, **inst(0, EMA(21))}),
 W("P05.same-for-iwm", "HALF", "open a chart for QQQ with the 100 day sma, then do the same for IWM", {"charts": {"count": 3, "symbolSet": ["NVDA", "QQQ", "IWM"]}, "indicatorsEach": {"include": ["movingAverage(100 sma)"], "except": ["c1"]}}),
 W("P06.swap-both-rsi-both", "TWO", "switch the left chart to AMD and the right one to TSLA, and put RSI on both", {"charts": {"symbols": ["AMD", "TSLA"]}, "indicatorsEach": {"include": ["rsi(14)"]}}),
 W("P07.amd-weekly-macd", "TWO", "make the AMD chart weekly and give it a MACD", {"charts": {"tfs": ["D", "W"]}, **inst(1, MACD)}),
 W("P08.grid-21ema-on-all", "HALF", "add a 2x2 of SPY QQQ IWM DIA and put the 21 ema on all of them", {"charts": {"count": 4, "symbols": ["SPY", "QQQ", "IWM", "DIA"], "sameSize": True}, "indicatorsEach": {"include": ["movingAverage(21 ema)"]}}),
 W("P09.hourly-vwap-orange", "ONE", "change NVDA to the hourly, add the vwap, and make the vwap orange", {"charts": {"tf": "60"}, **inst(0, VWAP, colour="orange")}),
 W("P10.new-chart-no-volume", "HALF", "add a chart for AMD on the daily and hide its volume", {"charts": {"count": 2}, "setting": {"chart": 1, "key": "volume.visible", "value": False}}),
 W("P11.rsi-here-same-there", "TWO", "put RSI on the NVDA chart and the same on the AMD chart", {"indicatorsEach": {"include": ["rsi(14)"]}}),
 W("P12.ema-left-copy-right", "TWO", "add the 21 ema to the left chart and copy it to the right one", {"indicatorsEach": {"include": ["movingAverage(21 ema)"]}}),
 W("P13.new-weekly-log", "HALF", "open SMCI in a new chart, weekly, log scale", {"charts": {"count": 2, "symbols": ["NVDA", "SMCI"], "tfs": ["D", "W"]}, "setting": {"chart": 1, "key": "logScale", "value": True}}),
 W("P14.then-then", "ONE", "switch to AMD, then go weekly, then add RSI", {"charts": {"symbols": ["AMD"], "tf": "W"}, **inst(0, RSI)}),
 W("P15.new-line-chart", "HALF", "add a chart for META and make it a line chart", {"charts": {"count": 2, "symbols": ["NVDA", "META"], "types": ["candles", "line"]}}),
 W("P16.same-for-qqq", "ONE", "add the 21 ema to this chart and the same for a new QQQ chart", {"charts": {"count": 2}, "indicatorsEach": {"include": ["movingAverage(21 ema)"]}}),
]
def C(id, board, turns, final, undo_expect, note=""):
    steps = [{"say": t} for t in turns[:-1]] + [{"say": turns[-1], "expect": final}, {"say": "undo", "expect": undo_expect}]
    return {"id": id, "board": board, "note": note, "steps": steps}
cross = [
 C("X01.it-period", "ONE", ["add RSI", "make it 7 period"], inst(0, RSI, has={"inputs.period": 7}), inst(0, RSI, has={"inputs.period": 14})),
 C("X02.same-for-the-other", "TWO", ["switch the left chart to weekly", "same for the other one"], {"charts": {"tfs": ["W", "W"]}}, {"charts": {"tfs": ["W", "D"]}}),
 C("X03.other-three", "FOUR", ["make the top left chart weekly", "and the other three too"], {"charts": {"tf": "W"}}, {"charts": {"tfs": ["W", "D", "D", "D"]}}),
 C("X04.put-that-on", "TWO", ["add the 21 ema to NVDA", "put that on AMD as well"], {"indicatorsEach": {"include": ["movingAverage(21 ema)"]}}, {"indicators": {"chart": 1, "exclude": ["movingAverage(21 ema)"]}}),
 C("X05.make-it-green", "ONE", ["add the 9 ema", "make it green"], inst(0, EMA(9), colour="green"), inst(0, EMA(9))),
 C("X06.same-but-weekly", "ONE", ["switch to AMD", "same but weekly"], {"charts": {"symbols": ["AMD"], "tf": "W"}}, {"charts": {"symbols": ["AMD"], "tf": "D"}}),
 C("X07.it-after-create", "HALF", ["open a chart for TSLA", "put RSI on it"], inst(1, RSI), {"indicators": {"chart": 1, "exclude": ["rsi(14)"]}}),
 C("X08.the-other-one-too", "TWO", ["make the left one a line chart", "the other one too"], {"charts": {"types": ["line", "line"]}}, {"charts": {"types": ["line", "candles"]}}),
 C("X09.the-bottom-two", "FOUR", ["put RSI on SPY", "now the bottom two"], {"indicators": {"chart": 2, "include": ["rsi(14)"]}}, {"indicators": {"chart": 2, "exclude": ["rsi(14)"]}}),
 C("X10.actually-that", "ONE", ["add the 50 ema", "actually make that a 65"], inst(0, EMA(65)), inst(0, EMA(50))),
 C("X11.remove-it", "TWO", ["add RSI to AMD", "remove it"], {"indicators": {"chart": 1, "exclude": ["rsi(14)"]}}, inst(1, RSI)),
 C("X12.back-to-daily", "ONE", ["go to the weekly", "back to daily"], {"charts": {"tf": "D"}}, {"charts": {"tf": "W"}}),
 C("X13.that-one-weekly", "TWO", ["switch the right chart to TSLA", "and that one weekly"], {"charts": {"symbols": ["NVDA", "TSLA"], "tfs": ["D", "W"]}}, {"charts": {"tfs": ["D", "D"]}}),
 C("X14.hide-it", "ONE", ["add MACD", "hide it"], inst(0, MACD, has={"hidden": True}), inst(0, MACD, has={"hidden": False})),
 C("X15.same-but-hourly-other-two", "FOUR", ["make SPY and QQQ weekly", "same but hourly for the other two"], {"charts": {"tfs": ["W", "W", "60", "60"]}}, {"charts": {"tfs": ["W", "W", "D", "D"]}}),
 C("X16.and-the-200-too", "ONE", ["add the 100 sma", "and the 200 ema too"], {"indicators": {"chart": 0, "include": ["movingAverage(100 sma)", "movingAverage(200 ema)"]}}, {"indicators": {"chart": 0, "exclude": ["movingAverage(200 ema)"]}}),
 C("X17.make-it-red", "TWO", ["put the 21 ema on the left chart", "make it red"], inst(0, EMA(21), colour="red"), inst(0, EMA(21))),
 C("X18.make-both-weekly", "HALF", ["open AMD and NVDA side by side", "make both weekly"], {"charts": {"count": 2, "tf": "W"}}, {"charts": {"count": 2, "tf": "D"}}),
 C("X19.add-vwap-to-it", "ONE", ["switch to TSLA", "and add the vwap to it"], inst(0, VWAP), {"indicators": {"chart": 0, "count": 0}}),
 C("X20.remove-from-right", "TWO", ["add RSI to both charts", "remove it from the right one"], {"indicators": {"chart": 1, "exclude": ["rsi(14)"]}, **inst(0, RSI)}, inst(1, RSI)),
 C("X21.the-first-one", "FOUR", ["make all four charts weekly", "put the first one back on daily"], {"charts": {"tfs": ["D", "W", "W", "W"]}}, {"charts": {"tf": "W"}}),
]
doc = {
 "about": "NLM-1 ACCEPTANCE (Track B, independent; agent/qa/nlm1-heldout — NOT merged, NOT shown to the NLM-1 implementer until its D1 is frozen). PENDING: runs only with NLM1_ACCEPT=1 (acceptance.test.jsx), never in master CI before NLM-1 lands. `inPlan`: ONE message whose later parts refer to earlier ones (\"… and put RSI on it\", \"the same for IWM\"); `crossTurn`: context across turns (\"it\", \"that one\", \"the other two\", \"same but weekly\"). Every case asserts the FINAL STATE (capreg predicates, testing/run.jsx) and a GROUPED UNDO: one \"undo\" takes back exactly the last request (inPlan: the whole request -> the board as it started; crossTurn: the last turn only). No model plans are scripted: the cases measure NLM-1's own reading of references and context; with no planner answer the panel's sentinel model leaves the state unchanged, so v1 fails them by construction.",
 "version": 1, "inPlan": inplan, "crossTurn": cross}
open(OUT, 'w', encoding='utf8', newline='\n').write(json.dumps(doc, indent=1, ensure_ascii=False) + '\n')
print(len(inplan), len(cross))
