// This Pine Script® code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/
// © KioseffTrading

//@version=6
indicator("Stop Loss Clustering (Breakouts) [Kioseff Trading]", overlay = false, calc_bars_count = 10000, dynamic_requests = true, max_boxes_count = 500, max_labels_count = 500, max_lines_count = 500, max_polylines_count = 100)
import TradingView/ta/12


enum granularitySetting

    lower  = "Lower"
    higher = "Higher (Heavy)"

model             = input.string(defval = "Absorbtion Extremes", title = "Model", options = ["Absorbtion Extremes", "Volatility-At-Entry"])

showxRay          = input.bool(defval = true, title = "X-ray", group = "Absorbtion Extremes")
intensity         = input.bool(defval = false, title = "Set Color Intensity by Stop Cluster Size", group = "Absorbtion Extremes")
xRayTop           = input.int(defval = 2, minval = 1, title = "Stop Cluster Buys", group = "Absorbtion Extremes" , inline = "Stop Cluster Buys")
xRayBot           = input.int(defval = 2, minval = 1, title = "Stop Cluster Sells", group = "Absorbtion Extremes", inline = "Stop Cluster Sells")
oldStopsLimitUp   = input.int(defval = 2, minval = 0, title = "Old Stop Cluster Sells", group = "Absorbtion Extremes", inline = "Stop Cluster Sells")
oldStopsLimitDn   = input.int(defval = 2, minval = 0, title = "Old Stop Clusters Buys", group = "Absorbtion Extremes", inline = "Stop Cluster Buys")
ltfGran           = input.timeframe(defval = "1", title = "Lower Timeframe Vol. Data", group = "Absorbtion Extremes")
clusterCol        = input.color(defval = #55ffda, title = "Cluster Color", group = "Absorbtion Extremes", inline = "Col")
clusterCol2       = input.color(defval = #ff65fb, title = "Old Cluster Color", group = "Absorbtion Extremes", inline = "Col")

granularity       = input.enum(defval = granularitySetting.lower, title = "Level Granularity", options = [granularitySetting.lower, granularitySetting.higher], group = "Time-Scaled Volatility")
timeScaledVolaIn  = input.timeframe(defval = "1", title = "Time-Scaled Volatility TF", group = "Time-Scaled Volatility")
strongClusterColT = input.color(defval = #ff65fb, title = "Strong Cluster Color", group = "Time-Scaled Volatility")
weakClusterColT   = input.color(defval = #6929F2, title = "Weak Cluster Color", group = "Time-Scaled Volatility")
showHist          = input.bool (defval = false, title = "Show Historical Triggers", group = "Time-Scaled Volatility")
showSize          = input.bool (defval = false, title = "Show Active Cluster Size", group = "Time-Scaled Volatility")
forceTypicalMove  = input.bool (defval = false, title = "Force Find Typical Move (Less Similar)", group = "Optionals")
showRatioMeter    = input.bool (defval = true, title = "Show Cluster Ratio Meter", group = "Optionals")

type swingData 

    float V
    float P 
    int   T
    float P2
    int   vioT
    float intraBarMove

type volTime 

    float V
    int   T

type stopClusterDraw

    array<box>  stopClusterZone
    array<line> lineOut
    label       information
    float       V

type barData 

    float H 
    float L 
    int   T

type timeScaledVola 

    map<int, volTime> dataMap
    array<barData>    barStats
    map<int, volTime> removedDataMap
    array<int>        keysArr 
    array<int>        keysArrRemove
 
type timeScaledVolaDrawings 

    array<box>   gridBox 
    array<line>  hotLines 
    array<line>  gridLines

type timeScaledVolaLastBarData

    array<float> finVol 
    array<float> topClusters
    array<int>   startTime 
    array<int>   endTime   
    array<float> levels

type offChartData 

    array<float> buyStopsArr
    array<float> sellStopsArr
    float buyStops 
    float sellStops
    float sellStopPrice
    float buyStopPrice 
    float sellStopVol 
    float buyStopVol
    float sumSellsActive
    float sumSellsRemoved
    float sumBuysActive
    float sumBuysRemoved
    array<float> similarBuysArr 
    array<float> similarSellsArr

type lowerGranularity

    array<float> levels 
    array<volTime> dataArr
    array<volTime> removedDataArr

type similarities 

    array<float> sortedSize
    array<float> sortedMoves 
    array<float> absDist 

var timeArrBin = array.new<int>(), timeArrBin.push(time), var barMs = timeframe.in_seconds(timeframe.period) * 1000 

method updatePivot(array<chart.point> id, bool isContinuation, float pricePoint) => 

    getRec = id.first(), getP = id.last()

    switch isContinuation

        true => id.set(1, chart.point.from_time(getRec.time, getP.price))  , id.set(0, chart.point.from_time(time, pricePoint))
        =>      id.set(1, chart.point.from_time(getRec.time, getRec.price)), id.set(0, chart.point.from_time(time, pricePoint))

    id.first()

IQZZ(float atrMult) =>
    
    atr          = ta.atr(14) * atrMult
    var points   = array.from(chart.point.from_time(time, close), chart.point.from_time(time, close))
    pointPrev    = points.last(), pointP2      = pointPrev[1]
    
    var pointArr = array.new<float>()
    var timeArr  = array.new<int>  ()
    var dir      = 0

    getRec = points.first()

    if dir == 1

        price = math.max(getRec.price, high)

        if price == high 
            getRec := points.updatePivot(true, high)
            
        if low <= getRec.price - atr  and high != getRec.price

            dir   := -1 
            points.updatePivot(false, low)

    else if dir == -1

        price = math.min(low, getRec.price)

        if price == low 
            getRec := points.updatePivot(true, low)

        if high >= getRec.price + atr and low != getRec.price

            dir   := 1
            points.updatePivot(false, high)

    if dir == 0 

        if high >= getRec.price + atr 

            dir   := 1
            points.updatePivot(false, high)

        else if low <= getRec.price - atr

            dir   := -1 
            points.updatePivot(false, low)

    if not na(pointP2)
        if pointP2.price != pointPrev.price
        
            pointArr.push(pointPrev.price)
            timeArr .push(pointPrev.time)
    
    [dir, pointArr, timeArr]
    
[marketState, pointArr, timeArr] = IQZZ(2)

method qCurve(array<polyline> stopConnect, float startLevel, int minTime, string direction, bool isLive = false) =>

    x1 = minTime, y1 = startLevel  

    getIndex       = timeArrBin.binary_search_rightmost(x1)
    getPindex      = timeArr   .binary_search_rightmost(x1) 

    cond = getPindex + 1 > pointArr.size() - 1

    [y2, getEndTime] = switch cond

        false => [pointArr.get(getPindex + 1), timeArr .get(getPindex + 1)]
        =>       [low, time]
       
    xCount = math.round(math.round((getEndTime - x1) / barMs))

    if xCount != 0

        points = array.new<chart.point>()

        a = (y2 - y1) / math.pow(xCount, 2) 

        end = switch isLive 

            true => timeArrBin.size() - 1 
            =>      timeArrBin.binary_search_rightmost(getEndTime)

        for z = getIndex to end
            
            curvedP  =   math.pow((z - getIndex) / xCount, 2.5)

            y = y1 + a * math.pow(curvedP * xCount, 2)  
            
            y := switch direction 

                "Down" => math.max(y, y2)
                "Up"   => math.min(y, y2)

            points.push(chart.point.from_time(timeArrBin.get(z), y))

        curveCol = switch direction 

            "Down" => #ff65fb
            "Up"   => #55ffda

        stopConnect.push(polyline.new(points, xloc = xloc.bar_time, line_color = curveCol, 
                                             line_style    = line.style_dashed, 
                                             force_overlay = true
                                             ))
    
        if stopConnect.size() > 50 
            stopConnect.shift().delete()

        points.last()

method gradBox(array<stopClusterDraw> id, array<swingData> swingPoints, map<string, float> gradCoords, float top, float bot, string direction, int n200, array<stopClusterDraw> id2, array<swingData> swingPoints2) => 

    similar         = similarities.new(
                             array.new<float>(), 
                             array.new<float>(), 
                             array.new<float>()
                             )

    var stopConnect = array.new<polyline>()
    n500            = time("", -250), connectSize = stopConnect.size() - 1

    if connectSize > 0 
        for i = 0 to connectSize

            stopConnect.shift().delete()

    gran    = 400 / (xRayBot + xRayTop + oldStopsLimitDn + oldStopsLimitUp)

    relevantPoint = float(na), relevantCluster = float(na)
    sumActive     = 0.       , sumRemoved      = 0. 
    
    spSize2       = swingPoints2.size()

    if spSize2 > 0

        for x = spSize2 - 1 to 0

            data       = swingPoints2.get(x)
            sumActive += data.V

            dist   = math.abs(data.P - data.P2) / gran
            mid    = math.avg(data.P , data.P2)
            logVal = math.log(math.abs(data.V))   

            getIndex = similar.sortedSize.binary_search_rightmost(logVal)

            similar.sortedSize .insert(getIndex, logVal)
            similar.sortedMoves.insert(getIndex, data.intraBarMove)

            [condCheck, tip, y] = switch direction

                "Up" => [x <= oldStopsLimitUp - 1, "Filled Market Buys Attached To This Low (Estimate)"   , mid - gran * dist]
                =>      [x <= oldStopsLimitDn - 1, "Filled Market Sells Attached To This High (Estimate)" , mid + gran * dist]
                
            if condCheck
                
                gradCoords.put("Max", math.max(nz(gradCoords.get("Max")), math.abs(data.V)))
                gradCoords.put("Min", math.min(nz(gradCoords.get("Min")), math.abs(data.V)))

                id2.push(
                    stopClusterDraw.new(

                        array.new<box> (),
                        array.from(
                            
                             line.new(data.T, mid, data.vioT, mid, xloc = xloc.bar_time, color = clusterCol2, 
                                                          width         = 2, 
                                                          force_overlay = true
                                                          ), 
                             line.new(data.T, mid, data.vioT, mid, xloc = xloc.bar_time, color = color.new(clusterCol2, 94), 
                                                          width         = 4, 
                                                          force_overlay  = true
                                                          ),
                             line.new(data.T, mid, data.vioT, mid, xloc = xloc.bar_time, color = color.new(clusterCol2, 96), 
                                                          width         = 10,
                                                          force_overlay = true
                                                          ),
                             line.new(data.T, mid, data.vioT, mid, xloc = xloc.bar_time, color = color.new(clusterCol2, 98), 
                                                          width         = 20,
                                                          force_overlay = true
                                                          ),
                             line.new(data.T, mid, data.vioT, mid, xloc = xloc.bar_time, color = color.new(clusterCol2, 98), 
                                                          width         = 25,
                                                          force_overlay = true
                                                          )),

                        label.new(data.T, y, text = str.tostring(data.V, format.volume), xloc = xloc.bar_time, 
                                                         style         = label.style_text_outline, 
                                                         size          = size.small, 
                                                         color         = color.new(clusterCol2, 90), 
                                                         textcolor     = clusterCol2, 
                                                         tooltip       = tip, 
                                                         force_overlay = true
                                                         ),
                        data.V

                    )
                )    

                getRecDrawing = id2.last()

                for i = 0 to gran
                
                    col = switch

                        i <= gran / 2 => color.from_gradient(i, 0, gran / 2   , color.new(clusterCol2, 98), color.new(clusterCol2, 85))
                        i  > gran / 2 => color.from_gradient(i, gran / 2, gran, color.new(clusterCol2, 85), color.new(clusterCol2, 98))

                    [y1, y2] = switch direction 

                        "Down"   => [data.P + i * dist, data.P + ((i + 1) * dist)]
                        "Up"     => [data.P - i * dist, data.P - ((i + 1) * dist)]

                    gradCoords.put("Min Range", math.min(y1, y2,  nz(gradCoords.get("Min Range"), 1e8)))
                    gradCoords.put("Max Range", math.max(y1, y2,  nz(gradCoords.get("Max Range"), -1)))

                    getRecDrawing.stopClusterZone.push(
                    
                                     box.new(data.T, y1 , data.vioT, y2, border_color = color(na), border_width = 1, 
                                                                 xloc          = xloc.bar_time, 
                                                                 bgcolor       = col, 
                                                                 force_overlay = true
                                                                 )

                                 )

    spSize  = swingPoints.size()

    if spSize > 0

        for x = spSize - 1 to 0

            data        = swingPoints.get(x), sumRemoved += data.V

            dist        = math.abs(data.P - data.P2) / gran
            mid         = math.avg(data.P , data.P2)

            getEnd      = stopConnect.qCurve(data.P, data.T, direction)

            [condCheck, tip] = switch direction

                "Up" => [x <= xRayTop - 1, "Filled Market Buys Attached To This Low (Estimate)"   ]
                =>      [x <= xRayBot - 1, "Filled Market Sells Attached To This High (Estimate)" ]
                
            if condCheck
                
                relevantPoint   := mid
                relevantCluster := data.V
                    
                gradCoords.put("Max", math.max(nz(gradCoords.get("Max")), math.abs(data.V)))
                gradCoords.put("Min", math.min(nz(gradCoords.get("Min")), math.abs(data.V)))

                id.push(

                    stopClusterDraw.new(

                        array.new<box> (),

                        array.from(

                             line.new(data.T, mid, n200, mid, xloc = xloc.bar_time, color = clusterCol, 
                                                             width = 2,
                                                             force_overlay = true
                                                             ), 
                             line.new(data.T, mid, n200, mid, xloc = xloc.bar_time, color = color.new(clusterCol, 94), 
                                                             width = 4,
                                                             force_overlay = true
                                                             ),
                             line.new(data.T, mid, n200, mid, xloc = xloc.bar_time, color = color.new(clusterCol, 96), 
                                                             width = 10,
                                                             force_overlay = true
                                                             ),
                             line.new(data.T, mid, n200, mid, xloc = xloc.bar_time, color = color.new(clusterCol, 98), 
                                                             width = 20,
                                                             force_overlay = true
                                                             ),
                             line.new(data.T, mid, n200, mid, xloc = xloc.bar_time, color = color.new(clusterCol, 98), 
                                                             width = 25,
                                                             force_overlay = true
                                                             )),
                        
                        label.new(n500, mid, text = str.tostring(data.V, format.volume), xloc = xloc.bar_time, 
                                                             style         = label.style_text_outline, 
                                                             size          = size.small, 
                                                             color         = color.new(clusterCol, 90), 
                                                             textcolor     = clusterCol, 
                                                             tooltip       = tip, 
                                                             force_overlay = true),
                        data.V

                    )
                )    

                getRecDrawing = id.last()

                for i = 0 to gran
                
                    col = switch

                        i <= gran / 2 => color.from_gradient(i, 0, gran / 2   , color.new(clusterCol, 98), color.new(clusterCol, 85))
                        i  > gran / 2 => color.from_gradient(i, gran / 2, gran, color.new(clusterCol, 85), color.new(clusterCol, 98))

                    [y1, y2] = switch direction 

                        "Down"   => [data.P + i * dist, data.P + ((i + 1) * dist)]
                        "Up"     => [data.P - i * dist, data.P - ((i + 1) * dist)]

                    gradCoords.put("Min Range", math.min(y1, y2,  nz(gradCoords.get("Min Range"), 1e8)))
                    gradCoords.put("Max Range", math.max(y1, y2,  nz(gradCoords.get("Max Range"), -1)))

                    getRecDrawing.stopClusterZone.push(
                    
                                     box.new(data.T, y1 , n200, y2, border_color = color(na), 
                                                     border_width  = 1, 
                                                     xloc          = xloc.bar_time, 
                                                     bgcolor       = col, 
                                                     force_overlay = true
                                                     )

                                 )

                [data.V, relevantPoint, relevantCluster, sumActive, sumRemoved, similar]


method xRay(map<string, float> gradCoords, int n200) => 

    if showxRay

        top = gradCoords.get("Max Range")
        bot = gradCoords.get("Min Range")
    
        var gradXRAY = array.new<box>(50)
    
        for data in gradXRAY
            data.delete()
    
        dist = math.abs(top - bot) / 50
    
        for i = 0 to 49
        
            grad = switch  
            
                i <= 24 => color.from_gradient(i, 0 , 24, color.new(#6929F2, 85), color.new(#FF22CC, 85))
                =>         color.from_gradient(i, 25, 49, color.new(#FF22CC, 85), color.new(#6929F2, 85))
    
            gradXRAY.push(box.new(0, bot + (dist * i), n200, bot + (dist * (i + 1)), border_color = na, 
                                             bgcolor       = grad,
                                             xloc          = xloc.bar_time,
                                             extend        = extend.none, 
                                             force_overlay = true
                                             ))


method checkVioandAddRec(array<swingData> id, array<float> pivotFills, string direction, array<swingData> id2) => 

    getSize = id.size()

    sellStopsHit = 0., buyStopsHit = 0.

    if getSize > 0 

        if direction == "Down"
            for i = getSize - 1 to 0
                if high >= id.get(i).P2

                    id2.unshift(id.remove(i))
                    
                    if id2.size() > 0

                        getRec = id2.first(), getRec.vioT := time, sellStopsHit += getRec.V

                        getRec.intraBarMove := math.abs(high / math.min(getRec.P, getRec.P2) - 1),


        else 

            for i = getSize - 1 to 0

                if low <= id.get(i).P2

                    id2.unshift(id.remove(i))

                    if id2.size() > 0

                        getRec = id2.first(), getRec.vioT := time, buyStopsHit += getRec.V 

                        getRec.intraBarMove := math.abs(low / math.max(getRec.P, getRec.P2) - 1)

        if id.size() > 0 and pivotFills.size() > 0

            recentSwing    = id.first()
            recentSwing.V += pivotFills.first()

    [buyStopsHit, sellStopsHit]

getClusterPoints(string side) => 

    var clusterData  = array.new<swingData>(), var clusterOld   = array.new<swingData>()
    var pivotFills   = array.new<float>    (), var sellSide     = "Sell Side", 
                                     var buySide  = "Buy Side"

    ltfVol           = request.security_lower_tf(syminfo.tickerid, ltfGran, volume * math.sign(close - close[1]))
    atr              =                            nz(ta.atr(14), high - low)

    [genClassifier, targetSign] = switch side

        sellSide => ["Down", -1]
        buySide  => ["Up",    1]

    if ltfVol.size() > 0 

        barFills = 0.

        for data in ltfVol 
            if math.sign(data) == targetSign

                barFills += data

        pivotFills.unshift(barFills)

    getPointSize                = pointArr.size(), getChange = ta.change(getPointSize) != 0

    [buyStopsHit, sellStopsHit] = clusterData.checkVioandAddRec(pivotFills, genClassifier, clusterOld)

    if getChange 

        if getPointSize > 1

            conditionCheck = switch side 

                sellSide =>  pointArr.last() > pointArr.get(-2)
                buySide  =>  pointArr.last() < pointArr.get(-2)

            if pivotFills.size() > 0 and conditionCheck

                barsDiff = switch syminfo.type 

                    "crypto" => math.round((time - timeArr.last()) / barMs)
                    =>          bar_index - timeArrBin.binary_search_rightmost(timeArr.last())

                if barsDiff <= pivotFills.size()

                    getPpoint  = pointArr.get(-2)
                    getPTpoint = timeArr .get(-2)
    
                    volNow = pivotFills.slice(0, barsDiff).sum()
    
                    getLvl = switch side

                        sellSide => high[barsDiff] + syminfo.mintick 
                        buySide  => low [barsDiff] - syminfo.mintick

                    getLvl2 = switch side

                        sellSide => getLvl + atr / 4 
                        buySide  => getLvl - atr / 4 

                    if clusterData.size() > 0
                    
                        getRecent    = clusterData.first()
                        getRecent.V -= volNow
    
                    clusterData.unshift(swingData.new(volNow, getLvl, time[barsDiff], getLvl2))
                    pivotFills .clear()

    [clusterData, clusterOld, buyStopsHit, sellStopsHit]


method reMove(array<stopClusterDraw> clusters) => 

    clustersSize = clusters.size()

    if clustersSize > 0
        for i = clustersSize - 1 to 0

            getIndex    = clusters.get(i)
            getDrawSize = getIndex.stopClusterZone.size()

            getIndex.information.delete()
            
            if getDrawSize > 0 
                for x = 0 to getDrawSize - 1

                    getIndex.stopClusterZone.shift().delete()

            for data in getIndex.lineOut
                data.delete()

            clusters.remove(i)

method lastBarDrawSwingMethod(array<swingData> id, array<swingData> id2, array<swingData> id3, array<swingData> id4) => 
    
    if barstate.islast

        var clusters    = array.new<stopClusterDraw>()
        var clustersOld = array.new<stopClusterDraw>()
        gradCoords      = map.new  <string, float>  ()
        n200            =       time("", -200)

        clusters   .reMove(), clustersOld.reMove()

        top = gradCoords.get("Max Range")
        bot = gradCoords.get("Min Range")

        [volDD, sellStopPrice, sellStopVol, sumSellsActive, sumSellsRemoved, sellsSimilar]  = 
                                 clusters.gradBox(id , gradCoords, top, bot, "Down", n200, clustersOld, id3)

        [volDU, buyStopPrice , buyStopVol, sumBuysActive, sumBuysRemoved, buysSimilar]      = 
                                 clusters.gradBox(id2, gradCoords, top, bot, "Up"  , n200, clustersOld, id4)
        
        gradCoords.xRay(n200)

        [volN, pulseCol] = switch marketState 

            1  => [str.tostring(volDU, format.volume), clusterCol]
            -1 => [str.tostring(volDD, format.volume), clusterCol2]

        var pulse = label.new(bar_index + 10, ohlc4, text = volN, color = color.new(pulseCol, 90), 
                                                     textcolor     = pulseCol, 
                                                     size          = 10, 
                                                     style         = label.style_text_outline, 
                                                     force_overlay = true
                                                     )

        pulse.set_text       (volN)  , pulse.set_xy     (bar_index + 10, ohlc4)
        pulse.set_textcolor(pulseCol), pulse.set_color(color.new(pulseCol, 90))

        if intensity 

            if clusters.size() > 0 
        
                getHighestVol = gradCoords.get("Max")
                getLowestVol  = gradCoords.get("Min")

                for data in clusters 

                    grad = color.from_gradient(math.abs(data.V), getLowestVol, getHighestVol, color.new(clusterCol, 90), clusterCol)

                    data.lineOut.first().set_color(grad)
                    data.information.set_textcolor(grad)
    
        [sellStopPrice, buyStopPrice, sellStopVol, buyStopVol, sumSellsActive, sumSellsRemoved, sumBuysActive, sumBuysRemoved, sellsSimilar, buysSimilar]

method findStart(array<int> startTimeArr, int endIndex, float bot, float dist, timeScaledVola timeScalingVola, int endTime, float botN, float topN, int i) => 

    getIndex = timeArrBin.binary_search_rightmost(endTime)

    for x = getIndex - 1 to 0

        data = timeScalingVola.barStats.get(x)

        if math.max(data.L, botN) <= math.min(data.H, topN)

            startTimeArr.set(i, data.T)
            break

sq(tfInMin) => 

    var t0 = timeframe.in_seconds(timeScaledVolaIn) / 60

    math.sqrt(tfInMin / t0)


method deleteOrder(array<int> id) =>

    dir = -1

    if id.size() > 1000

        p1 = math.abs(math.floor(id.max() * syminfo.mintick) - close)

        p2 = math.abs(close - math.floor(id.min() * syminfo.mintick)) 

        if p1 <= p2
            dir := 0

    dir

method deleteOrderLower(array<float> id) =>

    dir = -1

    if id.size() > 1000

        bottom = id.first()
        top    = id.last ()

        if math.abs(top - close) <= math.abs(close - bottom) 

            dir := 0

    dir


method removeFurthest(map<int, volTime> dataMap, array<int> keysArr, int dir, bool sort) => 

    if keysArr.size() > 25000

        if sort 
            keysArr.sort(order.ascending)

        while keysArr.size() > 20000 

            getKey = keysArr.get(dir)

            dataMap .remove(getKey)
            keysArr .remove(dir)

method removeFurthestLower(array<float> levels, array<volTime> levelData, array<volTime> levelDataRemoved, int dir) => 

    while levels.size() > 2500
    
        levels          .remove(dir)
        levelData       .remove(dir)
        levelDataRemoved.remove(dir)

method findStartNow(lowerGranularity lowerGran, timeScaledVola timeScalingVola, int addedIndexes, float frozenLowerGranProxy, bool isUnshift) => 

    if not na(addedIndexes)

        barStatsSize = timeScalingVola.barStats.size() - 1
        sizeArr      = lowerGran.dataArr.size()

        [start, end] = switch isUnshift

            true => [0, addedIndexes]
            =>      [sizeArr - (1 + addedIndexes), sizeArr - 1]

        endNested = math.max(0, barStatsSize - 1000)

        for i = start to end

            getStruct = lowerGran.dataArr.get(i)
            getLevel  = lowerGran.levels.get(i)

            getStruct.T := time 

            for x = barStatsSize to endNested

                getData = timeScalingVola.barStats.get(x)

                if math.max(getData.L, getLevel) <= math.min(getData.H, getLevel + frozenLowerGranProxy)
                    
                    getStruct.T := getData.T
                    break

                getStruct.T := getData.T

method findStartEnd(timeScaledVolaLastBarData lastBarDataRemoved, timeScaledVola timeScalingVola, float frozenLowerGranProxy, int i, timeScaledVolaLastBarData lastBarData) => 
    
    getStruct    = lastBarDataRemoved.endTime.get(i)
    getLevel     = lastBarDataRemoved.levels .get(i)

    start        = timeArrBin.binary_search_leftmost(getStruct)

    endLoop      = math.max(0, start - 1000), endTime = int(na)

    for x = start - 1 to endLoop
        
        getData = timeScalingVola.barStats.get(x)
        overlap = math.max(getData.L, getLevel) <= math.min(getData.H, getLevel + frozenLowerGranProxy)

        if overlap or x == endLoop
            
            endTime := getData.T    
            break

    endTime 


method lowerGranLastBar(array<volTime> dataArr, lowerGranularity lowerGran, timeScaledVolaLastBarData lastBarData, int index, int endIndex, string direction, int zoneCount = na,float frozenLowerGranProxy, timeScaledVola timeScalingVola) => 
    
    if not na(zoneCount) and zoneCount < 450 or na(zoneCount) 

        getStruct = dataArr          .get(index)
        getLevel  = lowerGran.levels .get(index)

        switch direction 

            "Up" =>  lastBarData.finVol.push   (getStruct.V), lastBarData.startTime.push(getStruct.T), 
                     lastBarData.levels.push   (getLevel)

            =>       lastBarData.finVol.unshift(getStruct.V), lastBarData.startTime.unshift(getStruct.T), 
                     lastBarData.levels.unshift(getLevel)

        if getStruct.V > nz(lastBarData.topClusters.min())
        
            lastBarData.topClusters.insert(lastBarData.topClusters.binary_search_rightmost(getStruct.V), getStruct.V)

            lastBarData.topClusters.shift()

method findTypical(similarities id, offChartData offChart, string direction, array<float> id2) =>

    if barstate.islast and not na(id)
            
        logVal = switch direction 

            "Buys" => math.log(math.abs(offChart.buyStopVol))
            =>        math.log(math.abs(offChart.sellStopVol))

        if not forceTypicalMove
            if not na(id.sortedSize)
            
                sortedSize = id.sortedSize.size()

                if sortedSize > 1
                    for i = 1 to sortedSize - 1

                        id.absDist.push(id.sortedSize.get(i) - id.sortedSize.get(i - 1))

            medAmt   = id.absDist   .percentile_nearest_rank(75)
            getStart = id.sortedSize.binary_search_rightmost(logVal - medAmt)

            if getStart < id.sortedSize.size() - 1

                for x = getStart to id.sortedSize.binary_search_leftmost(logVal + medAmt)

                    getVal = id.sortedSize.get(x)

                    if getVal >= logVal - medAmt and getVal <= logVal + medAmt

                        id2.push(id.sortedMoves.get(x))

        else 

            lowerInd = id.sortedSize.binary_search_leftmost(logVal)

            absUp = math.abs(logVal - id.sortedSize.get(lowerInd + 1)), 
            absDn = math.abs(logVal - id.sortedSize.get(lowerInd))

            switch 

                absUp <  absDn => id2.push(id.sortedMoves.get(lowerInd + 1))
                absUp == absDn => id2.push(id.sortedMoves.get(lowerInd + 1)), id2.push(id.sortedMoves.get(lowerInd))
                =>                id2.push(id.sortedMoves.get(lowerInd))

req() => 

    [ta.atr(14), volume * math.sign(close - close[1]) * -1, hlc3, low, high]

timeScaled() => 

    [volaTradersUseForStops, signVol, ltfhlc, ltfL, ltfH] = request.security_lower_tf(syminfo.tickerid, "1", req())
    lowerGranProxy                                        = ta.sma(ta.atr(14), 50)

    var array<float> factors = array.new<float>(), var hover = "-", 

    var lowerGran = lowerGranularity.new(
                             array.new<float>  (), 
                             array.new<volTime>(), 
                             array.new<volTime>()
                             )

    sumBuysActive = 0., sumSellsActive = 0., var sumBuysRemoved = 0., var sumSellsRemoved = 0.
    closestBuyP = float(na), closestSellP = float(na), closestBuyV = float(na), closestSellV = float(na)

    if barstate.isfirst
            
        hover := str.repeat(hover, 250)

        for h in array.from(sq(1), sq(5), sq(15), sq(30), sq(60), sq(240))
            for m in array.from             (1, 1.5, 2)

                factors.push(h * m)
    
    var timeScalingVola = timeScaledVola.new(
             map.new<int, volTime>(),
             array.new<barData>   (), 
             map.new<int, volTime>(), 
             array.new<int>       (),
             array.new<int>       ()

     )

    timeScalingVola.barStats.push(barData.new(high, low, time))

    if signVol.size() > 0 
        
        var masterTime  = time, buyStopsHit = 0., sellStopsHit = 0., var frozenLowerGranProxy = 0.
    
        var total = 6 * 3

        if granularity == granularitySetting.higher

            dir        = timeScalingVola.keysArr      .deleteOrder()
            dirRemoved = timeScalingVola.keysArrRemove.deleteOrder()
        
            for [i, data] in signVol

                direction = math.sign(data) 
                v0        = volaTradersUseForStops.get(i)
                domPoint  = ltfhlc.get(i)
                ltfLow    = ltfL  .get(i)
                ltfHigh   = ltfH  .get(i)

                for f in factors

                    fin   = v0 * f

                    level = domPoint + fin * direction 

                    ind = math.floor(level / syminfo.mintick)

                    if not timeScalingVola.dataMap.contains(ind)

                        exists = timeScalingVola.keysArr.binary_search_rightmost(ind)
                        timeScalingVola.keysArr         .insert(exists, ind)

                    getStruct = timeScalingVola.dataMap.get(ind)

                    if na(getStruct)
                        
                        timeScalingVola.dataMap.put(ind, volTime.new(data / total, time))

                    else

                        getStruct.V += data / total
                        getStruct.T := time

                getLow  = timeScalingVola.keysArr.binary_search_rightmost(math.floor(ltfLow  / syminfo.mintick))
                getHigh = timeScalingVola.keysArr.binary_search_leftmost (math.floor(ltfHigh / syminfo.mintick)) + 1
                
                if getHigh > getLow 
                
                    for z = getHigh - 1 to getLow

                        valData = timeScalingVola.keysArr.get(z)
                        stopVal = timeScalingVola.dataMap.remove(valData)

                        if time > stopVal.T 

                            if not timeScalingVola.removedDataMap.contains(valData)

                                timeScalingVola.keysArrRemove.push(valData)

                            timeScalingVola.removedDataMap.put(valData, volTime.new(stopVal.V, stopVal.T))

                        switch math.sign(stopVal.V)

                            -1 => buyStopsHit  += stopVal.V, sumBuysRemoved  += stopVal.V
                            1  => sellStopsHit += stopVal.V, sumSellsRemoved += stopVal.V

                        timeScalingVola.keysArr.remove(z)
                    
            timeScalingVola.dataMap       .removeFurthest(timeScalingVola.keysArr, dir, false)
            timeScalingVola.removedDataMap.removeFurthest(timeScalingVola.keysArrRemove, dirRemoved, true)

            if timeframe.change("1D") and timeScalingVola.keysArr.size() > 0 
                
                isGap = open > high[1] or open < low[1]

                if isGap
                    
                    [lowPrice, highPrice] = switch 

                        open > high[1] => [high[1], open]
                        =>                [open, low[1]]

                    getLow  = timeScalingVola.keysArr.binary_search_rightmost(math.floor(lowPrice  / syminfo.mintick))
                    getHigh = timeScalingVola.keysArr.binary_search_leftmost (math.floor(highPrice / syminfo.mintick)) + 1
                
                    if getHigh > getLow 
                    
                        for z = getHigh - 1 to getLow

                            valData = timeScalingVola.keysArr.get(z)
                            stopVal = timeScalingVola.dataMap.remove(valData)

                            if time > stopVal.T 

                                if not timeScalingVola.removedDataMap.contains(valData)

                                    timeScalingVola.keysArrRemove.push(valData)

                                timeScalingVola.removedDataMap.put(valData, volTime.new(stopVal.V, stopVal.T))

                            switch math.sign(stopVal.V)

                                -1 => buyStopsHit  += stopVal.V, sumBuysRemoved  += stopVal.V
                                1  => sellStopsHit += stopVal.V, sumSellsRemoved += stopVal.V

                            timeScalingVola.keysArr.remove(z)
                        

        else if not na(lowerGranProxy)

            addedLower = int(na), addedHigher = int(na)

            if lowerGran.levels.size() == 0 

                frozenLowerGranProxy         := lowerGranProxy / 4
                lowerGran.levels             := array.from(open - frozenLowerGranProxy, open, open + frozenLowerGranProxy)
                lowerGran.removedDataArr     := array.from(volTime.new(0, 0), volTime.new(0, 0), volTime.new(0, 0))
                lowerGran.dataArr            := array.from(volTime.new(0, 0), volTime.new(0, 0), volTime.new(0, 0))

            dir                              = lowerGran.levels.deleteOrderLower()
            barStatsSize                     = timeScalingVola.barStats.size() - 1

            for [i, data] in signVol

                direction = math.sign(data) 
                v0        = volaTradersUseForStops.get(i)
                domPoint  = ltfhlc.get(i)
                ltfLow    = ltfL  .get(i)
                ltfHigh   = ltfH  .get(i)

                for f in factors

                    fin   = v0 * f

                    level = domPoint + fin * direction 

                    getHighestLevel = lowerGran.levels.last()
                    getLowestLevel  = lowerGran.levels.first()

                    while math.max(ltfHigh, level) >= getHighestLevel

                        getHighestLevel += frozenLowerGranProxy

                        lowerGran.levels         .push(getHighestLevel)
                        lowerGran.dataArr        .push(volTime.new(0, 0))
                        lowerGran.removedDataArr .push(volTime.new(0, 0))
                        addedHigher :=            nz(addedHigher, -1) + 1


                    while math.min(ltfLow, level) <= getLowestLevel 

                        getLowestLevel -= frozenLowerGranProxy

                        lowerGran.levels         .unshift(getLowestLevel)
                        lowerGran.dataArr        .unshift(volTime.new(0, 0))
                        lowerGran.removedDataArr .unshift(volTime.new(0, 0))
                        addedLower :=             nz(addedLower, -1) + 1

                    exists    = lowerGran.levels .binary_search_leftmost(level)
                    getStruct = lowerGran.dataArr.get(exists)
                    getLevel  = lowerGran.levels .get(exists)

                    getStruct.V += data / total

                getLow  = lowerGran.levels.binary_search_rightmost(ltfLow)
                getHigh = lowerGran.levels.binary_search_leftmost (ltfHigh) + 1

                if getHigh > getLow 
                
                    for z = getHigh - 1 to getLow

                        valData      = lowerGran.levels .get(z)
                        stopVal      = lowerGran.dataArr.get(z)
                        getLevelData = lowerGran.removedDataArr.get(z)

                        getLevelData.V := stopVal.V
                        getLevelData.T := stopVal.T
  
                        switch math.sign(stopVal.V)

                            -1 => buyStopsHit  += stopVal.V, sumBuysRemoved  += stopVal.V
                            1  => sellStopsHit += stopVal.V, sumSellsRemoved += stopVal.V 

                        stopVal.T      := time 
                        stopVal.V      := 0

            lowerGran.levels.removeFurthestLower(lowerGran.dataArr, lowerGran.removedDataArr, dir)            
            lowerGran       .findStartNow       (timeScalingVola, addedLower , frozenLowerGranProxy, true)
            lowerGran       .findStartNow       (timeScalingVola, addedHigher, frozenLowerGranProxy, false)

            if timeframe.change("1D") and lowerGran.levels.size() > 0 
                
                isGap = open > high[1] or open < low[1]

                if isGap

                    [lowPrice, highPrice] = switch 

                        open > high[1] => [high[1], open]
                        =>                [open, low[1]]

                    getLow  = lowerGran.levels.binary_search_rightmost(lowPrice)
                    getHigh = lowerGran.levels.binary_search_leftmost (highPrice) + 1

                    if getHigh > getLow 
                    
                        for z = getHigh - 1 to getLow

                            valData      = lowerGran.levels .get(z)
                            stopVal      = lowerGran.dataArr.get(z)
                            getLevelData = lowerGran.removedDataArr.get(z)

                            getLevelData.V := stopVal.V
                            getLevelData.T := stopVal.T
    
                            switch math.sign(stopVal.V)

                                -1 => buyStopsHit  += stopVal.V, sumBuysRemoved  += stopVal.V
                                1  => sellStopsHit += stopVal.V, sumSellsRemoved += stopVal.V 

                            stopVal.T      := time 
                            stopVal.V      := 0


        if barstate.islast

            keys  = timeScalingVola.dataMap       .keys()
            keysR = timeScalingVola.removedDataMap.keys()

            keys.sort(order.ascending), keysR.sort(order.ascending)

            [top, topR, bot, botR, endIndex, endIndexR, startTimeSize] = switch granularity

                granularitySetting.higher => [keys .get(-1) * syminfo.mintick, keysR.get(-1) * syminfo.mintick, 
                                              keys .get(0)  * syminfo.mintick, keysR.get(0)  * syminfo.mintick, 
                                                                 495, 450, 451]

                granularitySetting.lower  => [lowerGran.levels.last (), lowerGran.levels.last(), lowerGran.levels.first(), 
                                              lowerGran.levels.first(), lowerGran.levels.size(), lowerGran.levels.size (), 0]
             

            var timeScaledDrawings        = timeScaledVolaDrawings.new(
                                                         array.new<box>(endIndex + 1), 
                                                         array.new<line>(10)
                                                         )

            var timeScaledDrawingsRemoved = timeScaledVolaDrawings.new(
                                                         hotLines  = array.new<line>(10), 
                                                         gridLines = array.new<line>(endIndexR + 1)
                                                         )
            var hoverLabels               = array.new<label>(496)

            for boxes in timeScaledDrawings.gridBox
                boxes.delete()

            for lines in timeScaledDrawingsRemoved.gridLines
                lines.delete()

            for lines in timeScaledDrawings.hotLines 
                lines.delete()

            for lines in timeScaledDrawingsRemoved.hotLines
                lines.delete()

            for labels in hoverLabels
                labels.delete()

            timeScaledDrawings.gridBox          := array.new<box> (endIndex  + 1)
            timeScaledDrawingsRemoved.gridLines := array.new<line>(endIndexR + 1)

            dist = (top - bot) / endIndex, distR = (topR - botR) / endIndexR

            lastBarData        = timeScaledVolaLastBarData.new(
                                                         array.new<float>(), 
                                                         array.new<float>(5, 0), 
                                                         array.new<int>(), 
                                                         levels = array.new<float>()
                                                         )

            lastBarDataRemoved = timeScaledVolaLastBarData.new(
                                                         array.new<float>(), 
                                                         array.new<float>(5, 0), 
                                                         array.new<int>(startTimeSize), 
                                                         array.new<int>(), 
                                                         levels = array.new<float>()
                                                         )

            closestLevelIndex = int(na)

            if granularity == granularitySetting.lower

                closestLevelIndex := lowerGran.levels.binary_search_leftmost(close)

            zoneCount = 0, indexUp = closestLevelIndex, indexDn = closestLevelIndex 

            if granularity == granularitySetting.higher

                for i = 0 to endIndex

                    botN = bot + dist * i
                    topN = bot + dist * (i + 1)
                        
                    effAdd = 0., startTime = int(na)

                    if granularity == granularitySetting.higher

                        idxB  = math.floor(botN / syminfo.mintick)
                        idxT  = math.floor(topN / syminfo.mintick)

                        slice = keys.slice(keys.binary_search_leftmost(idxB), keys.binary_search_rightmost(idxT))

                        for data in slice

                            getStruct = timeScalingVola.dataMap.get(data)
                            effAdd   += math.abs(getStruct.V)

                            startTime := switch na(startTime)

                                true => getStruct.T
                                =>      math.min(startTime, getStruct.T)

                        lastBarData.finVol   .push(effAdd)
                        lastBarData.startTime.push(startTime)

                        if effAdd > nz(lastBarData.topClusters.min())

                            ins       = lastBarData.topClusters.binary_search_rightmost(effAdd)

                            lastBarData.topClusters.insert(ins, effAdd)
                            lastBarData.topClusters.shift()

            else 

                for i = 0 to endIndex

                    if zoneCount >= 495 
                        break 

                    if indexUp == indexDn

                        lowerGran.dataArr.lowerGranLastBar(lowerGran, lastBarData, indexUp, endIndex, "Up", 
                                                                     int(na), 
                                                                     frozenLowerGranProxy, 
                                                                     timeScalingVola
                                                                     )
                        indexUp  += 1, zoneCount += 1, indexDn -= 1

                    else 
                        
                        if indexUp < endIndex

                            lowerGran.dataArr.lowerGranLastBar(lowerGran, lastBarData, indexUp, endIndex, "Up", 
                                                                     int(na), 
                                                                     frozenLowerGranProxy, 
                                                                     timeScalingVola
                                                                     )
                            indexUp += 1, zoneCount += 1

                        if indexDn > -1 

                            lowerGran.dataArr.lowerGranLastBar(lowerGran, lastBarData, indexDn, endIndex, "Down", 
                                                                     int(na), 
                                                                     frozenLowerGranProxy, 
                                                                     timeScalingVola
                                                                     )
                            indexDn -= 1, zoneCount += 1 

                if showHist

                    finVolSortRemoved = array.new<float>()

                    for data in lowerGran.removedDataArr 
                        finVolSortRemoved.push(math.abs(data.V))

                    finVolSortRemoved.sort(order.descending)

                    nestedEnd             = finVolSortRemoved.size() - 1
                    includesArr           = array.new<float>()

                    for i = 0 to nestedEnd

                        data = finVolSortRemoved.get(i)

                        for x = 0 to nestedEnd 
                            
                            getCompData = lowerGran.removedDataArr.get(x)
                            getLevel    = lowerGran.levels        .get(x)

                            if data == math.abs(getCompData.V) and not includesArr.includes(getLevel)

                                lastBarDataRemoved.finVol   .push(getCompData.V)
                                lastBarDataRemoved.levels   .push(math.avg(getLevel, getLevel + frozenLowerGranProxy))
                                lastBarDataRemoved.endTime  .push(getCompData.T) 
                                includesArr                 .push(getLevel)
                                break 

                        if i == 449 
                            break 

                    lastBarDataRemoved.topClusters := finVolSortRemoved.slice(0, math.min(5, nestedEnd))

                    for i = 0 to lastBarDataRemoved.levels.size() - 1

                        lastBarDataRemoved.startTime.push(
                                 lastBarDataRemoved .findStartEnd(timeScalingVola, frozenLowerGranProxy, i, lastBarDataRemoved
                                     ))
            
            if granularity == granularitySetting.higher

                for i = 0 to endIndexR

                    botN =  botR + distR * i
                    topN =  botR + distR * (i + 1)

                    idxB = math.floor(botN / syminfo.mintick)
                    idxT = math.floor(topN / syminfo.mintick)

                    slice = keysR.slice(keysR.binary_search_leftmost(idxB), keysR.binary_search_rightmost(idxT))

                    effAdd = 0., endTime = int(na)

                    for data in slice

                        getStruct = timeScalingVola.removedDataMap.get(data)
                        effAdd   += math.abs(getStruct.V)

                        endTime := switch na(endTime)

                            true => getStruct.T
                            =>      math.max(endTime, getStruct.T)

                    lastBarDataRemoved.startTime.findStart(endIndexR, botR, distR, timeScalingVola, endTime, botN, topN, i)

                    lastBarDataRemoved.finVol     .push(effAdd)
                    lastBarDataRemoved.endTime    .push(endTime)

                    if effAdd > nz(lastBarDataRemoved.topClusters.min())

                        ins       = lastBarDataRemoved.topClusters.binary_search_rightmost(effAdd)
                        
                        lastBarDataRemoved.topClusters.insert(ins, effAdd)
                        lastBarDataRemoved.topClusters.shift()

            maxVol   = lastBarData.finVol       .max(), minVol  = lastBarData.finVol       .min(),
            maxVolR  = lastBarDataRemoved.finVol.max(), minVolR = lastBarDataRemoved.finVol.min(),
                               histSize      = timeScalingVola.barStats.size()

            changePoint   = lastBarData       .finVol.percentile_nearest_rank(95)
            changePointR  = lastBarDataRemoved.finVol.percentile_nearest_rank(95) 

            hotThres      = lastBarData       .topClusters.min(), hotCount  = 0
            hotThresR     = lastBarDataRemoved.topClusters.min(), hotCountR = 0,
                                      nTime = time("", -1)

            end = switch granularity

                granularitySetting.higher => endIndex 
                =>                           lastBarData.levels.size() - 1

            removedSize = lastBarDataRemoved.endTime.size()

            for i = 0 to end
                
                botN = switch granularity

                    granularitySetting.higher => bot + dist * i
                    =>                           lastBarData.levels.get(i)

                topN = switch granularity 

                    granularitySetting.higher => bot + dist * (i + 1)
                    =>                           botN + frozenLowerGranProxy

                avg      = math.avg(botN, topN)
                getVol   = lastBarData.finVol    .get(i)
                getStart = lastBarData.startTime .get(i)

                switch avg < close  

                    true => sumBuysActive  += math.abs(getVol)
                    =>      sumSellsActive += math.abs(getVol)

                [grad, staticCol] = switch getVol >= changePoint

                    false => [color.from_gradient(getVol, minVol, maxVol, color.new(chart.bg_color, 98), color.new(weakClusterColT, 90)), weakClusterColT]
                    =>       [color.from_gradient(getVol, changePoint, maxVol, color.new(strongClusterColT, 95), color.new(strongClusterColT, 90)), strongClusterColT]

                timeScaledDrawings.gridBox.set(i, box.new(getStart, topN, nTime, botN, extend = extend.right, 
                                                                 border_color  = grad, 
                                                                 bgcolor       = grad, 
                                                                 xloc          = xloc.bar_time, 
                                                                 force_overlay = true
                                                                 ))

                if showSize 

                    hoverLabels.set(i, (label.new(bar_index + 50, avg, color = #00000000, 
                                                                 text          = str.tostring(getVol, format.volume), 
                                                                 size          = size.small, 
                                                                 style         = label.style_label_left, 
                                                                 textcolor     = staticCol, 
                                                                 force_overlay = true, 
                                                                 tooltip       = str.tostring(getVol, format.volume)
                                                                 )))

                if math.abs(getVol) >= hotThres and hotCount < 10

                    timeScaledDrawings.hotLines.set(hotCount    , line.new(getStart, avg, nTime, avg, xloc = xloc.bar_time, 
                                                                         color         = strongClusterColT, 
                                                                         extend        = extend.right, 
                                                                         force_overlay = true
                                                                         ))

                    timeScaledDrawings.hotLines.set(hotCount + 1, line.new(getStart, avg, nTime, avg, xloc = xloc.bar_time, 
                                                                         color         = color.new(strongClusterColT, 90), 
                                                                         width         = 5, 
                                                                         extend        = extend.right, 
                                                                         force_overlay = true
                                                                         ))
                    hotCount += 2

                    switch avg < close  

                        true => closestBuyP  := math.max(avg, nz(closestBuyP))
                        =>      closestSellP := math.min(avg, nz(closestSellP, 10e10))

                    if avg == closestBuyP

                        closestBuyV  := math.abs(getVol)

                    if avg == closestSellP 

                        closestSellV := math.abs(getVol) 

                if granularity == granularitySetting.lower and showHist

                    if i < removedSize

                        getOldVol   = lastBarDataRemoved.finVol   .get(i), getOldStart = lastBarDataRemoved.startTime.get(i)
                        getEnd      = lastBarDataRemoved.endTime  .get(i), avgR        = lastBarDataRemoved.levels   .get(i)

                        oldGrad = color.new(color.from_gradient(1, 0, 2, weakClusterColT, strongClusterColT), 50)

                        timeScaledDrawingsRemoved.gridLines.set(i, line.new(getOldStart, avgR, getEnd, avgR, extend = extend.none,      
                                                                     color         = oldGrad, 
                                                                     xloc          = xloc.bar_time, 
                                                                     force_overlay = true, 
                                                                     width         = 1
                                                                     ))

                        if math.abs(getOldVol) >= hotThresR and hotCountR < 10

                            timeScaledDrawingsRemoved.hotLines.set(hotCountR    , line.new(getOldStart, avgR, getEnd, avgR, 
                                                                     xloc          = xloc.bar_time, 
                                                                     color         = strongClusterColT, 
                                                                     extend        = extend.none, 
                                                                     force_overlay = true, 
                                                                     width         = 1
                                                                     ))

                            timeScaledDrawingsRemoved.hotLines.set(hotCountR + 1, line.new(getOldStart, avgR, getEnd, avgR, 
                                                                     xloc          = xloc.bar_time, 
                                                                     color         = color.new(strongClusterColT, 90), 
                                                                     width         = 5, 
                                                                     extend        = extend.none, 
                                                                     force_overlay = true
                                                                     ))
                            hotCountR += 2


            if granularity == granularitySetting.higher

                for i = 0 to endIndexR

                    botN =  botR + distR * i
                    topN =  botR + distR * (i + 1)

                    getVol   = lastBarDataRemoved.finVol       .get(i)
                    getStart = nz(lastBarDataRemoved.startTime .get(i), masterTime)
                    getEnd   = lastBarDataRemoved.endTime      .get(i)

                    avg      = math.avg(topN, botN)

                    grad = switch getVol >= changePointR

                        false => color.from_gradient(getVol, minVolR, maxVolR, color.new(chart.bg_color, 98), color.new(weakClusterColT, 90))
                        =>       color.from_gradient(getVol, changePointR, maxVolR, color.new(strongClusterColT, 95), color.new(strongClusterColT, 90))

                    timeScaledDrawingsRemoved.gridLines.set(i, line.new(nz(getStart, masterTime), avg, getEnd, avg, 
                                                             color         = grad, 
                                                             xloc          = xloc.bar_time, 
                                                             force_overlay = true
                                                             ))

                    if getVol >= hotThresR

                        timeScaledDrawingsRemoved.hotLines   .set(hotCountR, line.new (getStart, avg, getEnd, avg, xloc = xloc.bar_time, 
                                                             color         = strongClusterColT, 
                                                             force_overlay = true
                                                             ))

                        timeScaledDrawingsRemoved.hotLines   .set(hotCountR + 1, line.new (getStart, avg, getEnd, avg, xloc = xloc.bar_time, 
                                                             color         = color.new(strongClusterColT, 90), 
                                                             width         = 5, 
                                                             force_overlay = true
                                                             ))

                        hotCountR += 2

        [buyStopsHit, sellStopsHit, sumBuysActive, sumSellsActive, sumBuysRemoved, sumSellsRemoved, closestBuyP, closestSellP, closestBuyV, closestSellV]

var offChart = offChartData.new(
                         array.new<float>(), 
                         array.new<float>(), 
                         0, 
                         0, 
                         similarBuysArr = array.new<float> (), 
                         similarSellsArr = array.new<float>()
                         )

if model == "Absorbtion Extremes"

    [clusterHighs, clusterHighsOld, proxy, sellStopsHit] = getClusterPoints("Sell Side")
    [clusterLows , clusterLowsOld, buyStopsHit, proxy1]  = getClusterPoints("Buy Side")

    [sellStopPrice, buyStopPrice, sellStopVol, buyStopVol, sumSellsActive, sumSellsRemoved, sumBuysActive, sumBuysRemoved, sellsSimilar, buysSimilar] 
                             = clusterHighs.lastBarDrawSwingMethod(clusterLows, clusterHighsOld, clusterLowsOld) 

    offChart.buyStops            := buyStopsHit * -1, offChart.sellStops           := sellStopsHit * -1, offChart.sellStopPrice       := sellStopPrice
    offChart.buyStopPrice        := buyStopPrice,     offChart.sellStopVol         := sellStopVol,       offChart.buyStopVol          := buyStopVol
    offChart.sumSellsActive      := sumSellsActive,   offChart.sumSellsRemoved     := sumSellsRemoved,   offChart.sumBuysActive       := sumBuysActive
    offChart.sumBuysRemoved      := sumBuysRemoved

    if buyStopsHit != 0 
        offChart.buyStopsArr.push(offChart.buyStops)

    if sellStopsHit != 0 
        offChart.sellStopsArr.push(offChart.sellStops)

    buysSimilar .findTypical(offChart, "Buys" , offChart.similarBuysArr )
    sellsSimilar.findTypical(offChart, "Sells", offChart.similarSellsArr)

if model == "Volatility-At-Entry"

    [buyStopsHit, sellStopsHit, sumBuysActive, sumSellsActive, sumBuysRemoved, sumSellsRemoved, buyStopPrice, sellStopPrice, buyStopVol, sellStopVol] 
                                                             = timeScaled()
 
    offChart.buyStops        := buyStopsHit 
    offChart.sellStops       := sellStopsHit 
    offChart.sumBuysActive   := sumBuysActive
    offChart.sumSellsActive  := sumSellsActive 
    offChart.sumBuysRemoved  := sumBuysRemoved
    offChart.sumSellsRemoved := sumSellsRemoved 
    offChart.sellStopPrice   := sellStopPrice
    offChart.buyStopPrice    := buyStopPrice
    offChart.sellStopVol     := sellStopVol
    offChart.buyStopVol      := buyStopVol

    if buyStopsHit != 0 
        offChart.buyStopsArr.push(offChart.buyStops)

    if sellStopsHit != 0 
        offChart.sellStopsArr.push(offChart.sellStops)


sellStopMed  = ta.sma(offChart.sellStopsArr.percentile_nearest_rank(75), 50), sellStopsAvg = ta.sma(offChart.sellStops, 50)
buyStopMed   = ta.sma(offChart.buyStopsArr .percentile_nearest_rank(25), 50), buyStopsAvg  = ta.sma(offChart.buyStops, 50),                                

var volaAtEntryModel = model == "Volatility-At-Entry", var gCol = #55ffda, var pCol = #ff65fb

[buyThres, sellThres] = switch volaAtEntryModel

    true => [buyStopsAvg, sellStopsAvg]
    =>      [buyStopMed , sellStopMed]

[transpBuy, radiateB] = switch offChart.buyStops <= buyThres

    true => [0 , true ]
    =>      [50, false]

[transpSell, radiateS] = switch offChart.sellStops >= sellThres

    true => [0 , true ] 
    =>      [50, false]

var active = false, 

if not active and (offChart.sellStops != 0 or offChart.buyStops != 0)
    active := true
    
zero = plot(active ? 0 : na, linewidth = 1, color = bar_index % 3 == 0 ? chart.fg_color : na, display = display.pane)

buyStopsMedPlot  = plot(buyStopMed , color = #00000000 , display = display.none)
sellStopsMedPlot = plot(sellStopMed, color =  #00000000, display = display.none)
buyAvgPlot       = plot(volaAtEntryModel ? buyStopsAvg  : na, color = gCol)
sellAvgPlot      = plot(volaAtEntryModel ? sellStopsAvg : na, color = pCol)

fill(zero, buyStopsMedPlot, 
                     top_value    = 0, 
                     bottom_value = buyStopMed, 
                     top_color    = #00000000, 
                     bottom_color = color.new(#55ffda, volaAtEntryModel ? 100 : 95), 
                     display      = display.none
                     )

fill(zero, sellStopsMedPlot, 
                     top_value    = sellStopMed, 
                     bottom_value = 0, 
                     top_color    = color.new(pCol, volaAtEntryModel ? 100 : 95), 
                     bottom_color = #00000000, 
                     display      = display.none)

fill(zero, buyAvgPlot, 
                     top_value    = 0, 
                     bottom_value = buyStopsAvg, 
                     top_color    = #00000000, 
                     bottom_color = color.new(#55ffda, volaAtEntryModel ? 95 : 100), 
                     display      = display.none)

fill(zero, sellAvgPlot, 
                     top_value    = sellStopsAvg, 
                     bottom_value = 0, 
                     top_color    = color.new(pCol, volaAtEntryModel ? 95 : 100), 
                     bottom_color = #00000000, 
                     display      = display.none)

plot(offChart.buyStops  != 0 ? offChart.buyStops  : na, color = color.new(gCol, transpBuy ), style = plot.style_circles)
plot(offChart.sellStops != 0 ? offChart.sellStops : na, color = color.new(pCol, transpSell), style = plot.style_circles)

plot(radiateB                ? offChart.buyStops  : na, color = color.new(gCol, 85), linewidth = 3,  style = plot.style_circles, display = display.pane)
plot(radiateS                ? offChart.sellStops : na, color = color.new(pCol, 85), linewidth = 3,  style = plot.style_circles, display = display.pane)
plot(radiateB                ? offChart.buyStops  : na, color = color.new(gCol, 90), linewidth = 5,  style = plot.style_circles, display = display.pane)
plot(radiateS                ? offChart.sellStops : na, color = color.new(pCol, 90), linewidth = 5,  style = plot.style_circles, display = display.pane)
plot(radiateB                ? offChart.buyStops  : na, color = color.new(gCol, 95), linewidth = 7,  style = plot.style_circles, display = display.pane)
plot(radiateS                ? offChart.sellStops : na, color = color.new(pCol, 95), linewidth = 7,  style = plot.style_circles, display = display.pane)
plot(radiateB                ? offChart.buyStops  : na, color = color.new(gCol, 98), linewidth = 10, style = plot.style_circles, display = display.pane)
plot(radiateS                ? offChart.sellStops : na, color = color.new(pCol, 98), linewidth = 10, style = plot.style_circles, display = display.pane)

plot(volaAtEntryModel ? buyStopsAvg  : na, color = color.new(gCol, 94), linewidth = 4,  display = display.pane)
plot(volaAtEntryModel ? buyStopsAvg  : na, color = color.new(gCol, 96), linewidth = 6,  display = display.pane)
plot(volaAtEntryModel ? buyStopsAvg  : na, color = color.new(gCol, 97), linewidth = 10, display = display.pane)
plot(volaAtEntryModel ? sellStopsAvg : na, color = color.new(pCol, 94), linewidth = 4,  display = display.pane)
plot(volaAtEntryModel ? sellStopsAvg : na, color = color.new(pCol, 96), linewidth = 6,  display = display.pane)
plot(volaAtEntryModel ? sellStopsAvg : na, color = color.new(pCol, 97), linewidth = 10, display = display.pane)



if barstate.islast 

    var expCol = #181b27
    var tab    = table.new(position.top_right, 99, 99, 
                                    bgcolor       = #20222C, 
                                    border_color  = #363843, 
                                    frame_color   = #363843, 
                                    border_width  = 1, 
                                    frame_width   = 1, 
                                    force_overlay = true
                                    )

    medBuys  = offChart.similarBuysArr .median()
    medSells = offChart.similarSellsArr.median()

    [headBuy, headSell] = switch model 

        "Volatility-At-Entry" => ["% Of All Buy-Stop Clusters", "% Of All Sell-Stop Clusters"]
        =>                       ["Typical Move", "Typical Move"]

    typBuys = switch na(medBuys)

        true => "None Similar"
        =>      str.tostring(medBuys * 100, format.percent)

    typSells = switch na(medSells)

        true => "None Similar"
        =>      str.tostring(medSells * 100, format.percent)

    if model == "Volatility-At-Entry"

        typBuys   := str.tostring(offChart.buyStopVol  / offChart.sumBuysActive  * 100, format.percent)
        typSells  := str.tostring(offChart.sellStopVol / offChart.sumSellsActive * 100, format.percent)

    tab.cell(0, 0, text = "Stop-Loss Clustering",     text_color = color.white)
    tab.cell(0, 1, text = "Nearest Buy-Stop Cluster", text_color = #96ffe8, text_size = 12, bgcolor   = expCol)
    tab.cell(0, 2, text = "Price",                    text_color = color.rgb(81, 207, 180), text_size = size.small)
    tab.cell(1, 2, text = "Cluster",                  text_color = color.rgb(81, 207, 180), text_size = size.small)
    tab.cell(2, 2, text = headBuy,                    text_color = color.rgb(81, 207, 180), text_size = size.small)

    tab.cell(0, 3, text = str.tostring(offChart.buyStopPrice, format.mintick), text_color = color.white, text_size = size.small, bgcolor = expCol)
    tab.cell(1, 3, text = str.tostring(offChart.buyStopVol  , format.volume ), text_color = color.white, text_size = size.small, bgcolor = expCol)
    
    tab.cell(2, 3, text = typBuys, bgcolor = expCol  , text_color = color.white             , text_size = size.small)
    tab.cell(3, 1, text = "Nearest Sell-Stop Cluster", text_color = color.rgb(255, 165, 252), text_size = 12, bgcolor = expCol)
    
    tab.cell(3, 2, text = "Price"  , text_color = pCol, text_size = size.small)
    tab.cell(4, 2, text = "Cluster", text_color = pCol, text_size = size.small)
    tab.cell(5, 2, text = headSell , text_color = pCol, text_size = size.small)

    tab.cell(3, 3, text = str.tostring(offChart.sellStopPrice, format.mintick)  , text_size = size.small , text_color = color.white, bgcolor = expCol)
    tab.cell(4, 3, text = str.tostring(offChart.sellStopVol  , format.volume)   , text_size = size.small , text_color = color.white, bgcolor = expCol)
    tab.cell(5, 3, text = typSells, bgcolor = expCol, text_color = color.white, text_size = size.small)

    tab.merge_cells(0, 1, 2, 1), tab.merge_cells(0, 0, 5, 0), 
                     tab.merge_cells(3, 1, 5, 1)

    if showRatioMeter

        var ratioMeter = table.new(position.bottom_center, 99, 99, 
                                         bgcolor       = expCol, 
                                         force_overlay = true, 
                                         frame_color   = na, 
                                         frame_width   = 1
                                         )

        absBuys = math.abs(offChart.sumBuysActive), absSells = math.abs(offChart.sumSellsActive)

        maxStops  = math.max(absBuys, absSells)
        minStops  = math.min(absBuys, absSells)
        dom       = nz((maxStops - minStops) / minStops) * 10

        domBlocks      = math.min(10, math.round(dom)) * (math.sign(absSells - absBuys))
        sellNormalized = 10 + domBlocks

        sumRemoved            = math.abs(offChart.sumBuysRemoved) + math.abs(offChart.sumSellsRemoved) 
        ratioBuyStopsRemoved  = math.abs(offChart.sumBuysRemoved) / sumRemoved

        ratioSellStopsRemoved = 1 -  ratioBuyStopsRemoved
        sellNormalizedRemoved = 20 * ratioSellStopsRemoved 
        buyNormalizedRemoved  = 20 * ratioBuyStopsRemoved 

        for i = 0 to 21

            if i <= 19

                col = switch i <= sellNormalized

                    true => color.from_gradient(i, 0, sellNormalized , #ffb0fc, pCol)
                    =>      color.from_gradient(i, sellNormalized + 1, 19, gCol, color.rgb(176, 255, 238))

                colR = switch i <= sellNormalizedRemoved

                    true => color.from_gradient(i, 0, sellNormalizedRemoved , #ffb0fc, pCol)
                    =>      color.from_gradient(i, sellNormalizedRemoved + 1, 19, gCol, color.rgb(176, 255, 238))

                ratioMeter.cell(i + 1, 1, bgcolor = expCol, text = "█", text_color = col, height = 3)
                ratioMeter.cell(i + 1, 4, bgcolor = expCol, text = "▢", text_color = colR, height = 3)

            ratioMeter.cell(i, 0, height = 3)
            ratioMeter.cell(i, 3, height = 3)

        ratioMeter.cell(0 , 0, text = "Active Buy-Stop Clusters"   , text_color = color.white, text_size = size.small)
        ratioMeter.cell(21, 0, text = "Active Sell-Stop Clusters"  , text_color = color.white, text_size = size.small)
        ratioMeter.cell(0 , 3, text = "Violated Buy-Stop Clusters" , text_color = color.white, text_size = size.small)
        ratioMeter.cell(21, 3, text = "Violated Sell-Stop Clusters", text_color = color.white, text_size = size.small)

        ratioMeter.cell(0, 1,     text       = str.tostring(math.abs(offChart.sumSellsActive), format.volume),
                                  text_color = color.white, 
                                  bgcolor    = color.new(#7a0074, 80), 
                                  text_size  = size.small)
        
        ratioMeter.cell(21, 1, text = str.tostring(offChart.sumBuysActive, format.volume), 
                                 text_color = color.white, 
                                 bgcolor    = color.new(#007a5f, 80), 
                                 text_size  = size.small)

        ratioMeter.cell(0, 4,  text = str.tostring(math.abs(offChart.sumSellsRemoved), format.volume), 
                                 text_color = color.white, 
                                 bgcolor    = color.new(#7a0074, 80), 
                                 text_size  = size.small
                                 )

        ratioMeter.cell(21, 4, text = str.tostring(offChart.sumBuysRemoved, format.volume), 
                                 text_color = color.white, 
                                 bgcolor    = color.new(#007a5f, 80), 
                                 text_size  = size.small)

alertcondition(radiateB, title = "Large Buy-Stop Cluster Triggered"  , message = "Large Buy-Stop Cluster Triggered")
alertcondition(radiateS, title = "Large Sell-Stop Cluster Triggered" , message = "Large Sell-Stop Cluster Triggered")

if radiateB 
    alert("Large Buy-Stop Cluster Triggered" , freq = alert.freq_once_per_bar)
if radiateS
    alert("Large Sell-Stop Cluster Triggered", freq = alert.freq_once_per_bar)
