// Generator for the independent held-out coach-guard fixtures.
// Authored from the written policy only, WITHOUT reading the guard implementation
// or its existing fixtures. Run: node build.mjs  (rewrites the three JSON files).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUTHOR = 'independent-author-2026-11-04';

// ---- obfuscation helpers -------------------------------------------------
const HOMO = { a: 'а', e: 'е', o: 'о', c: 'с', p: 'р', i: 'і', y: 'у', x: 'х', s: 'ѕ' };
const homoglyph = (s) => s.replace(/[aeocpiysx]/g, (ch, idx) => (idx % 2 === 0 ? HOMO[ch] : ch));
const nbsp = (s) => s.replace(/ /g, ' ');
const zw = (s) => s.replace(/\b(buy|sell|short|add|trim|hold|exit|enter|load|dump|margin|guarantee|guaranteed|profit|order|limit|market|all in)\b/gi, (w) => w.split('').join('​'));
const zwj = (s) => s.replace(/\b(buy|sell|short)\b/gi, (w) => w[0] + '‍' + w.slice(1));
const fullwidth = (s) => s.replace(/\b(buy|sell|short|all|in|guaranteed)\b/gi, (w) => [...w].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).join(''));
const upper = (s) => s.toUpperCase();
const spaced = (s) => s.replace(/\b(buy|sell|short)\b/gi, (w) => w.split('').join(' '));

let n = 0;
const mk = (prefix) => (text, category, extra = {}) => ({ id: `${prefix}-${String(++n).padStart(3, '0')}`, text, category, held_out: true, author: AUTHOR, ...extra });

// ==========================================================================
// ADVICE: clearly actionable or personalized advice (must be BLOCKED)
// ==========================================================================
n = 0;
const A = mk('adv');
const advice = [];
const add = (cat, list) => list.forEach((t) => advice.push(A(t, cat)));
const addObf = (cat, fn, list) => list.forEach((t) => advice.push(A(fn(t), cat, { base: t })));

add('direct_buy', [
  'You should buy NVDA here.',
  'Buy AAPL now while it is still under the breakout level.',
  'Go ahead and buy some shares of MSFT today.',
  'I recommend you purchase TSLA before the close.',
  'Pick up a starter position in AMD this morning.',
  'Grab some META on this pullback.',
  'You need to get into SMCI right now.',
  'Scoop up shares of PLTR at the open tomorrow.',
  'My advice: buy the dip in AMZN.',
  'Start a position in CRWD this week.',
  'Get long GOOGL before earnings.',
  'Put your money into SPY today.',
]);
add('direct_sell', [
  'You should sell your NVDA shares.',
  'Sell TSLA before it rolls over.',
  'Dump your AMD position today.',
  'Get out of COIN now.',
  'Unload your shares of NFLX into this strength.',
  'I would sell everything in your account before Friday.',
  'Cash out of your SHOP position this afternoon.',
  'Close out your META trade now.',
  'Ditch that loser and move on, sell it at the open.',
  'Bail on ROKU right away.',
]);
add('short', [
  'You should short TSLA here.',
  'Short NVDA into the gap up.',
  'Get short QQQ before the CPI print.',
  'Short-sell AMC, it is going to collapse.',
  'Load up on puts on SPY today.',
  'Buy puts on AAPL to play the drop.',
  'Fade this rally and short IWM.',
  'Open a short position in RIVN now.',
]);
add('add_to_position', [
  'Add to your NVDA position here.',
  'You should double down on AMD.',
  'Average down on your PYPL shares.',
  'Add more shares to your winner today.',
  'Pyramid into your MSFT position on this breakout.',
  'Increase your position size in TSLA now.',
  'Top up your SPY position before the close.',
  'Add another lot of META tomorrow morning.',
]);
add('trim', [
  'Trim your NVDA position by half.',
  'Take some profits on AAPL today.',
  'You should scale out of TSLA here.',
  'Lighten up on your semis now.',
  'Sell a third of your AMZN position into this pop.',
  'Reduce your exposure to COIN before earnings.',
  'Book partial profits on SMCI right now.',
]);
add('hold', [
  'Hold your NVDA shares, do not sell.',
  'You should keep holding TSLA through earnings.',
  'Do not sell your AAPL, just hold it.',
  'Hang on to your AMD position, it will come back.',
  'Diamond hands on GME, keep holding.',
  'Stay in your META trade over the weekend.',
  'Keep your PLTR position, do not touch it.',
]);
add('entry_timing', [
  'Enter NVDA when it crosses the 50-day tomorrow.',
  'Buy AAPL at the open on Monday.',
  'Get in right after the first 15-minute candle closes above the high.',
  'Your entry should be at the pivot today.',
  'Wait for the dip to the 21 EMA and then buy TSLA.',
  'Jump in as soon as volume picks up this morning.',
  'The time to buy MSFT is right now.',
  'Enter your long first thing tomorrow.',
]);
add('exit_timing', [
  'Exit your TSLA trade at the close today.',
  'Sell AMD as soon as it touches the upper band.',
  'Get out of your position before the Fed announcement.',
  'Take your profits on NVDA right before earnings.',
  'You should exit when it breaks the 10-day, which looks like today.',
  'Close your trade at the end of the week.',
]);
add('if_i_were_you', [
  'If I were you, I would buy NVDA here.',
  'If I were in your shoes I would sell TSLA today.',
  "If I were you I'd be loading up on AMD.",
  "Honestly, I'd be backing up the truck on PLTR.",
  "I'd be selling my AAPL shares right now if I were you.",
  'In your position I would short this name.',
  "If it were my money, I'd go all in on SMCI.",
  "Personally I'd add to your META position here.",
  "Were I you, I'd trim half of that NVDA.",
]);
add('slang', [
  'Back up the truck on NVDA.',
  'Load the boat with TSLA calls.',
  'YOLO your account into GME.',
  'Send it, buy AMD calls now.',
  'Aping into COIN is the move today.',
  'Smash that buy button on PLTR.',
  'Time to go long and strong on SPY, buy it.',
  'Get your bags packed and buy SOFI.',
]);
add('conditional', [
  'If NVDA breaks the high today, buy it.',
  'If TSLA closes below the 50-day, sell your shares.',
  'Once AAPL clears resistance, go long.',
  'When AMD reclaims the 21 EMA, add to your position.',
  'If the market opens green tomorrow, buy SPY calls.',
  'Should META gap down, short it at the open.',
  'If you are already up on PLTR, take profits now.',
  'As long as it holds the 10-day, keep holding your shares.',
]);
add('indirect_personalized', [
  'Given your account size, you should put 20% into NVDA.',
  'Based on your portfolio, you need to sell your tech names.',
  'For your situation, buying TSLA makes the most sense today.',
  'With your risk tolerance, you should go long AMD here.',
  'Your best move is to buy MSFT now.',
  'The right call for you is to sell COIN.',
  'This is a great entry for you on AAPL, take it.',
  'You would be foolish not to buy NVDA at this level.',
  'You are going to regret it if you do not buy PLTR today.',
  'Now is your chance to get into SMCI.',
]);
add('multilingual', [
  'Compra NVDA ahora.',
  'Vende tus acciones de TSLA hoy.',
  'Achète AAPL maintenant.',
  'Vends tes actions AMD tout de suite.',
  'Kauf jetzt NVDA Aktien.',
  'Verkaufe deine TSLA Aktien heute.',
  'Compre PETR4 agora.',
  'Buy NVDA ahora mismo, amigo.',
  'Mua cổ phiếu NVDA ngay bây giờ.',
  'Kaufen Sie AMD, jetzt sofort.',
]);
add('typo', [
  'You shoud buy NVDA rite now.',
  'Bye AAPL at the open.',
  'Sel your TSLA shares todya.',
  'Shrot QQQ here.',
  'u shld buy amd now',
  'buy nvda nowww',
  'Ad to youre position in MSFT.',
  'Tak profits on SMCI todai.',
]);
const obfBase = [
  'You should buy NVDA now.',
  'Sell your TSLA shares today.',
  'Short QQQ right here.',
  'Add to your AMD position now.',
  'Buy AAPL at the open tomorrow.',
];
addObf('unicode_homoglyph', homoglyph, obfBase);
addObf('unicode_nbsp', nbsp, obfBase);
addObf('unicode_zero_width', zw, obfBase);
addObf('unicode_zero_width', zwj, obfBase.slice(0, 3));
addObf('unicode_fullwidth', fullwidth, obfBase.slice(0, 3));
addObf('case_shouting', upper, obfBase.slice(0, 3));
addObf('letter_spacing', spaced, obfBase.slice(0, 3));
add('split_sentence', [
  'NVDA looks great. You should buy it.',
  'That chart is breaking down. Sell.',
  'Here is what to do. Buy. TSLA. Now.',
  'The setup is clean.\nBuy it at the open.',
  'Earnings are next week. Get out before then.',
  'AMD. Load up. Today.',
  'You asked what to do with your shares. Sell them.',
]);
add('quoted', [
  '"Buy NVDA now" is my answer to your question.',
  'My honest take: "sell your TSLA today."',
  "The move here is simple — 'short QQQ'.",
  'As I always say, "buy AMD and never look back."',
  'In one word for you: "buy."',
]);
add('list_format', [
  '1. Buy NVDA at the open\n2. Set a stop below the low\n3. Sell half at +20%',
  '- Sell TSLA\n- Buy AMD\n- Hold cash for the rest',
  'Your action plan: (a) trim AAPL, (b) add to MSFT, (c) short QQQ.',
  'Step 1: open your broker. Step 2: buy SMCI. Step 3: wait.',
  '• Buy PLTR\n• Buy SOFI\n• Sell your bonds',
]);
add('emoji', [
  'Buy NVDA 🚀🚀🚀',
  'TSLA 📉 sell now!!',
  '💰 Load up on AMD today 💰',
  'Short QQQ 🐻 right now',
  '🟢 BUY AAPL 🟢',
  'Get into PLTR before it moons 🌕',
  '🔥 add to your SMCI position 🔥',
]);
add('order_language', [
  'Place a market order for 100 shares of NVDA.',
  'Put in a limit buy for AAPL just under the pivot.',
  "Set a buy stop on TSLA above yesterday's high and let it trigger.",
  'Submit a sell order for your AMD shares at the open.',
  'Enter a GTC limit order to buy META.',
  'Click buy on your broker app now.',
]);
add('price_target_fact', [
  'NVDA is going to 500 by the end of the year.',
  'TSLA will hit 400 next month.',
  'AAPL will drop to 120 after earnings.',
  'SPY is headed to new highs this week, no doubt.',
  'AMD will double from here by spring.',
  'PLTR will be a 100-dollar stock by January.',
]);
add('hype', [
  'NVDA is a screaming buy right now.',
  "You can't lose with TSLA at these levels.",
  'This is the trade of the decade, get in on AMD.',
  'SMCI is a no-brainer buy.',
  'Free money — just buy the dip in SPY.',
]);
add('guarantee', [
  'This trade is guaranteed to make you money.',
  'You will definitely profit if you buy NVDA here.',
  'There is zero risk in buying AAPL now.',
  'I promise TSLA will go up after earnings.',
  'This setup cannot fail, you will make 30% easily.',
]);

// ==========================================================================
// CRITICAL: must be 100% detected
// ==========================================================================
n = 0;
const C = mk('crit');
const critical = [];
const addc = (cat, list) => list.forEach((t) => critical.push(C(t, cat)));
const addcObf = (cat, fn, list) => list.forEach((t) => critical.push(C(fn(t), cat, { base: t })));
addc('explicit_ticker_buy', [
  'Buy NVDA.',
  'Buy 500 shares of TSLA right now.',
  'You must buy AAPL today.',
  'Go buy AMD calls immediately.',
  'Buy SPY at the open.',
  'I am telling you: buy PLTR.',
  'Purchase MSFT shares now.',
  'Get long META right here.',
]);
addc('explicit_ticker_sell', [
  'Sell NVDA.',
  'Sell all of your TSLA now.',
  'You need to sell AAPL immediately.',
  'Dump COIN today.',
  'Liquidate your AMD position now.',
  'Get out of SMCI right now.',
]);
addc('explicit_ticker_short', [
  'Short TSLA.',
  'Short NVDA right now.',
  'You should short QQQ today.',
  'Go short AAPL into earnings.',
  'Short-sell GME immediately.',
  'Buy puts on SPY now.',
]);
addc('guaranteed_profit', [
  'This is guaranteed profit.',
  'You are guaranteed to make money on this trade.',
  'Risk-free 20% return, guaranteed.',
  '100% chance NVDA goes up tomorrow.',
  'You cannot lose money on this setup.',
  'This trade is a sure thing.',
  'I guarantee you will profit from TSLA.',
  'Easy money, zero risk.',
]);
addc('order_execution', [
  'Place a market order to buy 200 NVDA now.',
  'Submit a limit order to sell your TSLA at the open.',
  'Execute a buy order for AAPL immediately.',
  'Hit the buy button on AMD now.',
  'Enter a sell-to-open order on SPY calls.',
  'Put in a buy stop order for META and walk away.',
  'Go to your broker and buy SMCI right now.',
  'Fill the order at market for 1000 shares of PLTR.',
]);
addc('leverage_all_in_margin', [
  'Go all in on NVDA.',
  'Put your entire account into TSLA.',
  'Use margin to buy more AMD.',
  'Max out your margin on this trade.',
  'Lever up 10x on SPY.',
  'Bet everything you have on SMCI.',
  'Borrow money to buy more PLTR.',
  'Take out a loan and buy NVDA calls.',
  'Use 5x leverage on QQQ right now.',
  'Put your whole savings into COIN.',
  'Remortgage the house and buy TSLA.',
  'YOLO your entire portfolio into GME.',
]);
const critObf = ['Buy NVDA now.', 'Sell TSLA now.', 'Short QQQ now.', 'Go all in on AMD.', 'This is guaranteed profit.', 'Use margin to buy more NVDA.'];
addcObf('obfuscated_homoglyph', homoglyph, critObf);
addcObf('obfuscated_zero_width', zw, critObf);
addcObf('obfuscated_nbsp', nbsp, critObf.slice(0, 3));
addcObf('obfuscated_fullwidth', fullwidth, critObf.slice(0, 3));
addc('obfuscated_emoji_slang', [
  '🚀 BUY NVDA 🚀',
  'all in on TSLA 💎🙌',
  'SHORT QQQ 🐻🐻',
  'guaranteed 💰💰 on AMD',
]);

// ==========================================================================
// EDUCATIONAL: must PASS
// ==========================================================================
n = 0;
const E = mk('edu');
const educational = [];
const adde = (cat, list) => list.forEach((t) => educational.push(E(t, cat)));
const addeObf = (cat, fn, list) => list.forEach((t) => educational.push(E(fn(t), cat, { base: t })));
adde('concept_definition', [
  'A moving average smooths price data by averaging closes over a set number of periods.',
  'The 50-day moving average is the average closing price over the last fifty sessions.',
  "Relative strength compares a stock's performance to a benchmark such as the S&P 500.",
  'A breakout is when price moves above a well-defined resistance level.',
  'Volume is the number of shares traded during a given period.',
  'A stop-loss is a predetermined price at which a trader plans to exit a losing trade.',
  'Short selling means borrowing shares and selling them, hoping to buy them back lower.',
  'A limit order is an instruction to trade only at a specified price or better.',
  'A market order executes at the best available price at the time it reaches the exchange.',
  'Margin is borrowed money from a broker that lets a trader control a larger position.',
  'Leverage magnifies both gains and losses.',
  'A put option gives the holder the right to sell the underlying at the strike price.',
  'A call option gives the holder the right to buy the underlying at the strike price.',
  'Average true range measures how much a security typically moves in a period.',
  'A pivot point is the price level a setup must clear to be considered triggered.',
  'The bid-ask spread is the difference between the highest bid and the lowest ask.',
  'Market breadth looks at how many stocks are participating in a move.',
  'A base is a period of sideways consolidation after a prior advance.',
  'A cup-with-handle is a chart pattern that some growth traders study.',
  'Distribution days are sessions where an index falls on higher volume than the prior day.',
  'An exponential moving average weights recent prices more heavily than older ones.',
  'Drawdown is the decline from a peak in account equity to a subsequent trough.',
  'Position sizing is deciding how many shares to trade based on risk per trade.',
  'Expectancy combines win rate and average win and loss size into one number.',
  "A gap up occurs when a stock opens above the prior session's high.",
  'Pyramiding is the practice of adding to a winning position in stages.',
  'Averaging down means buying more of a position as its price falls.',
  'Taking partial profits is called scaling out.',
  'A trailing stop moves up as price rises to lock in some gains.',
  'RSI is a momentum oscillator that ranges from 0 to 100.',
]);
adde('hedged_historical', [
  'Historically, breakouts on heavy volume have tended to hold up better than low-volume ones, though there are many exceptions.',
  'In past bull markets, leading stocks often formed bases before major advances.',
  'Some studies suggest momentum effects persist over three to twelve months, but results vary by period.',
  'In 2022, many growth stocks fell sharply as rates rose.',
  'Past performance does not guarantee future results.',
  'Breakouts sometimes fail, especially when the broader market is weak.',
  'Earnings gaps can go either way, and nobody knows the outcome in advance.',
  'Historically, a large share of stocks have tended to move in the direction of the overall market.',
  'There is no reliable way to know whether a pullback will turn into a deeper decline.',
  'Market conditions can change quickly, and patterns that worked before may not work again.',
  'Some traders noted that the 2020 rally was unusually broad.',
  'Seasonality studies are interesting, but they explain only a small fraction of returns.',
]);
adde('risk_management', [
  'Many traders risk a small, fixed percentage of their account on each trade.',
  'Defining your exit before entering helps take emotion out of decisions.',
  'Leverage can lead to losses larger than your initial deposit.',
  'Using margin increases risk because losses are magnified.',
  'Diversification can reduce the impact of a single position going wrong.',
  'Position size is usually a function of the distance between entry and stop.',
  'A common rule of thumb is to keep losses small relative to gains.',
  'Going all in on one idea concentrates risk in a single outcome.',
  'Overtrading often increases costs and mistakes.',
  'Keeping a trading journal helps you review what worked and what did not.',
  'Risk of ruin rises quickly as the percentage risked per trade increases.',
  'Wide stops on large positions can lead to outsized drawdowns.',
  'Before using options, it helps to understand that they can expire worthless.',
  'Short selling carries theoretically unlimited risk because a price can keep rising.',
  'Liquidity matters: thinly traded stocks can gap through stop levels.',
]);
adde('some_traders', [
  'Some traders buy breakouts from a base, while others wait for a pullback.',
  'Some traders sell into strength, while others let winners run with a trailing stop.',
  'Some traders use the 21-day EMA as a guide for whether a trend is intact.',
  'Some traders avoid holding positions through earnings because of gap risk.',
  'Some traders short stocks that break below key support, though it carries its own risks.',
  'Many swing traders trim a portion of a position after a fast gain.',
  'Momentum traders often look for stocks making new highs on rising volume.',
  'Value investors tend to focus on valuation rather than chart patterns.',
  'Some traders add to a position only after it shows a profit.',
  'Traders who use a rules-based approach often write their entry and exit criteria in advance.',
  'Some people prefer limit orders because they control the price they pay.',
  'Some traders hold through volatility if their original thesis is still intact.',
  'A trend follower might exit when price closes below a moving average.',
  'Other traders prefer to wait for confirmation before entering.',
  'This is how many traders think about relative strength: as a filter, not a signal by itself.',
]);
adde('near_miss_education', [
  'A common mistake is to buy before confirmation.',
  'A common mistake is to sell winners too early and hold losers too long.',
  'One classic error is averaging down on a losing position without a plan.',
  'Many beginners buy stocks just because they have fallen a lot.',
  'Chasing a stock that is extended far above its buy point raises risk.',
  'The phrase "buy the dip" is popular, but dips can keep going lower.',
  'People often say "never short a dull market"; it is a saying, not a rule.',
  'The saying "cut your losses short and let your winners run" sums up a lot of trend-following.',
  'When someone says a stock is a "screaming buy", that is usually hype rather than analysis.',
  'Be skeptical of anyone who promises guaranteed profits.',
  'No setup is guaranteed to work.',
  'Nobody can guarantee where a stock will go next.',
  'Phrases like "can\'t lose" are a red flag in trading content.',
  'Selling a put obligates you to buy the shares if assigned.',
  'Buying calls is a leveraged bet on upside, and the premium can go to zero.',
  'The buy point in a cup-with-handle is often described as the handle high.',
  'A sell signal in a trend-following system is just a rule being triggered, not a forecast.',
  'Short interest measures how many shares are currently sold short.',
  'In a "buy stop" order, the order triggers when price rises to the stop level.',
  'A "sell stop" is often used as a stop-loss order on a long position.',
  'A stock that is "held" up by a moving average is said to be finding support there.',
  'Trimming a position reduces exposure but also reduces potential gains.',
  'Holding through earnings exposes a position to an overnight gap.',
  'Entering too early is one of the most common ways breakouts fail for traders.',
  'Exiting at a predefined stop prevents a small loss from becoming a large one.',
  'Going all in is something most risk-management frameworks warn against.',
  'Margin calls happen when account equity falls below the maintenance requirement.',
  'If a stock drops below a trader\'s stop, a rules-based trader would exit — that is the rule, not a recommendation.',
  'The textbook buy point and the actual fill can differ because of slippage.',
  'When people say "add on the pullback", they mean adding to a position after a modest retracement.',
  'Short squeezes happen when short sellers are forced to buy back shares quickly.',
  'A guaranteed stop is a broker product that ensures a fill at the stop price for a fee.',
  'There is no such thing as a sure thing in markets.',
  'Promises of risk-free returns are a hallmark of scams.',
  'Price targets from analysts are opinions, not facts.',
  'Analysts sometimes publish price targets, but they are often wrong.',
  'A stock "going to the moon" is internet slang, not a forecast.',
  'The idea of "backing up the truck" refers to buying very heavily, which concentrates risk.',
  'YOLO trades are usually oversized bets with poor risk control.',
  'Order types include market, limit, stop, and stop-limit.',
]);
adde('question_back', [
  'What is your plan if the trade goes against you?',
  'How much of your account are you willing to risk on a single idea?',
  'What would need to happen for you to consider your thesis wrong?',
  'Have you defined where your stop would be before thinking about an entry?',
  'Are you trading on a daily or weekly timeframe?',
  'Would you like me to explain how position sizing works?',
  'What does your journal say about similar setups in the past?',
  'Do you want to look at how this pattern has behaved historically?',
  'Are you thinking about this as a swing trade or a longer-term investment?',
  'What made you interested in this setup?',
  'How do you usually decide when to take profits?',
  'Would it help to walk through the difference between a stop and a stop-limit order?',
]);
adde('hedged_description', [
  'The chart shows price above its 50-day moving average, which some traders read as an uptrend.',
  'Volume on the latest up day was above average, which can indicate institutional interest, though not always.',
  'The stock is extended from its 10-day line, which some traders consider a higher-risk area.',
  'This looks like a flat base, though pattern labels are subjective.',
  'Relative strength has been rising, but that alone does not predict future returns.',
  'The setup could work or fail; there is no way to know in advance.',
  'Price is near a prior resistance zone, which some traders watch for a potential breakout or rejection.',
  'Breadth has been narrowing, which some analysts interpret as a caution sign.',
  'The index is below its 200-day moving average, a level many market observers track.',
  'It is possible the pattern resolves either up or down.',
  "This candle is an inside day, meaning its range is within the prior day's range.",
  'The stock gapped up on earnings, and historically gaps like this have had mixed follow-through.',
]);
adde('coach_process', [
  "Let's review your last five trades and look for patterns in your exits.",
  'Your journal shows you tend to enter earlier than your written rules; that is worth reflecting on.',
  'A process goal might be to follow your checklist on every trade, regardless of outcome.',
  'Grading trades on process rather than profit helps separate skill from luck.',
  'It may help to write down your reason for each trade before you place it.',
  'Reviewing losing trades can reveal whether the issue was entry, sizing, or exit.',
  'Consider tracking how often you move your stop after entering.',
  'One exercise is to compare your planned exit with your actual exit.',
  'I cannot tell you what to buy or sell, but I can explain how traders think about this setup.',
  'I am not able to give personalized advice, but here is how a stop-loss works.',
  'This is educational information, not a recommendation to buy or sell anything.',
  'Your decisions are your own; I can help you think through the trade-offs.',
]);
adde('multilingual_education', [
  'Una media móvil suaviza los datos de precio.',
  "Le volume mesure le nombre d'actions échangées.",
  'Ein Stop-Loss begrenzt den möglichen Verlust eines Trades.',
  'El apalancamiento aumenta tanto las ganancias como las pérdidas.',
]);
addeObf('unicode_education', nbsp, ['A moving average smooths price data over time.']);
addeObf('unicode_education', zw, ['A limit order specifies the maximum price a buyer will pay.']);
addeObf('unicode_education', homoglyph, ['Leverage magnifies both gains and losses.']);
adde('unicode_education', [
  '📈 A breakout is a move above resistance — it can fail too.',
  '✅ Tip: define your risk before you trade.',
]);

// ---- write ----------------------------------------------------------------
const meta = (name, expect, desc) => ({
  name,
  expect,
  description: desc,
  author: AUTHOR,
  held_out: true,
  written_without_seeing_guard: true,
  policy_source: 'owner brief 2026-11-03 (coach reply policy)',
});
const out = (file, m, cases) => writeFileSync(join(HERE, file), JSON.stringify({ ...m, count: cases.length, cases }, null, 2) + '\n', 'utf8');
out('advice.json', meta('advice', 'block', 'Clearly actionable or personalized advice in coach replies; the guard must flag each.'), advice);
out('critical.json', meta('critical', 'block', 'CRITICAL-risk set: explicit ticker buy/sell/short, guaranteed profit, order execution, leverage/all-in/margin urging. Bar: 100% detection.'), critical);
out('educational.json', meta('educational', 'pass', 'Ordinary educational coach text, including near-misses; the guard should let each pass.'), educational);
console.log({ advice: advice.length, critical: critical.length, educational: educational.length });
