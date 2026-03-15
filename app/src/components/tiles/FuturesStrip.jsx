// app/src/components/tiles/FuturesStrip.jsx
import { useMemo } from 'react'
import useSWR from 'swr'
import styles from './FuturesStrip.module.css'
import TickerPopup from '../TickerPopup'

// ─── UCT Quote of the Day ─────────────────────────────────────────────────────
const QUOTES = [
  {t:"Markets are never wrong — opinions often are.",a:"Jesse Livermore"},
  {t:"The most important rule of trading is to play great defense, not great offense.",a:"Paul Tudor Jones"},
  {t:"I just wait until there is money lying in the corner, and all I have to do is go over there and pick it up.",a:"Jim Rogers"},
  {t:"Amateurs want to be right. Professionals want to make money.",a:"Alan Greenspan"},
  {t:"Risk comes from not knowing what you're doing.",a:"Warren Buffett"},
  {t:"Be fearful when others are greedy, and greedy when others are fearful.",a:"Warren Buffett"},
  {t:"The four most dangerous words in investing are: this time it's different.",a:"Sir John Templeton"},
  {t:"In this business, if you're good, you're right six times out of ten.",a:"Peter Lynch"},
  {t:"It's not whether you're right or wrong, but how much you make when right and lose when wrong.",a:"George Soros"},
  {t:"Do more of what works and less of what doesn't.",a:"Steve Clark"},
  {t:"The real key to making money in stocks is not to get scared out of them.",a:"Peter Lynch"},
  {t:"All through time, people have basically acted and reacted the same way in the market as a result of greed, fear, ignorance, and hope.",a:"Jesse Livermore"},
  {t:"Profits always take care of themselves but losses never do.",a:"Jesse Livermore"},
  {t:"The elements of good trading are: cutting losses, cutting losses, and cutting losses.",a:"Ed Seykota"},
  {t:"The best trades are the ones in which you have all three things going for you: fundamentals, technicals, and market tone.",a:"Michael Marcus"},
  {t:"The key to trading success is emotional discipline. If intelligence were the key, there would be a lot more people making money trading.",a:"Victor Sperandeo"},
  {t:"To be a good trader you need to be able to trade like a machine, not a human.",a:"Mark Minervini"},
  {t:"Risk management is the most important thing to be well understood.",a:"Mark Minervini"},
  {t:"An unexamined trade is not worth making.",a:"Mark Minervini"},
  {t:"Price action is the only truth. Everything else is interpretation.",a:"Al Brooks"},
  {t:"Never let a winner turn into a loser.",a:"Mark Douglas"},
  {t:"The iron rule of trading: plan the trade, trade the plan.",a:"Mark Douglas"},
  {t:"Cut losses short. Let profits run. Never average down into a losing position.",a:"William O'Neil"},
  {t:"I don't think you can consistently be a winning trader if you're banking on being right more than 50 percent of the time.",a:"William O'Neil"},
  {t:"The market is a pendulum that forever swings between unsustainable optimism and unjustified pessimism.",a:"Benjamin Graham"},
  {t:"Mr. Market is your servant, not your guide.",a:"Benjamin Graham"},
  {t:"In the short run, the market is a voting machine. In the long run, it is a weighing machine.",a:"Benjamin Graham"},
  {t:"The individual investor should act consistently as an investor and not as a speculator.",a:"Benjamin Graham"},
  {t:"The stock market is filled with individuals who know the price of everything, but the value of nothing.",a:"Philip Fisher"},
  {t:"Price is what you pay. Value is what you get.",a:"Warren Buffett"},
  {t:"Wide diversification is only required when investors do not understand what they are doing.",a:"Warren Buffett"},
  {t:"If you aren't thinking about owning a stock for 10 years, don't even think about owning it for 10 minutes.",a:"Warren Buffett"},
  {t:"Rule No. 1: Never lose money. Rule No. 2: Never forget Rule No. 1.",a:"Warren Buffett"},
  {t:"Someone is sitting in the shade today because someone planted a tree a long time ago.",a:"Warren Buffett"},
  {t:"The best investment you can make is in yourself.",a:"Warren Buffett"},
  {t:"The stock market is a device for transferring money from the impatient to the patient.",a:"Warren Buffett"},
  {t:"The difference between successful people and really successful people is that really successful people say no to almost everything.",a:"Warren Buffett"},
  {t:"It's far better to buy a wonderful company at a fair price than a fair company at a wonderful price.",a:"Warren Buffett"},
  {t:"The stock market is designed to transfer money from the active to the patient.",a:"Warren Buffett"},
  {t:"Know what you own, and know why you own it.",a:"Peter Lynch"},
  {t:"Go for a business that any idiot can run — because sooner or later, any idiot probably is going to run it.",a:"Peter Lynch"},
  {t:"Markets can remain irrational longer than you can remain solvent.",a:"John Maynard Keynes"},
  {t:"Buy when there's blood in the streets, even if the blood is your own.",a:"Baron Rothschild"},
  {t:"In investing, what is comfortable is rarely profitable.",a:"Robert Arnott"},
  {t:"The biggest risk of all is not taking one.",a:"Mellody Hobson"},
  {t:"The most contrarian thing of all is not to oppose the crowd but to think for yourself.",a:"Peter Thiel"},
  {t:"Every trader has strengths and weaknesses. Some are good holders of winners, but may hold their losers a little too long.",a:"Steve Cohen"},
  {t:"There is no holy grail in trading. Only discipline.",a:"Linda Bradford Raschke"},
  {t:"Compound interest is the eighth wonder of the world.",a:"Albert Einstein (attributed)"},
  {t:"Bottoms in the investment world don't end with four-year lows; they end with 10- or 15-year lows.",a:"Jim Rogers"},
  {t:"The secret to investing is to figure out the value of something and then pay a lot less.",a:"Joel Greenblatt"},
  {t:"You have power over your mind — not outside events. Realize this, and you will find strength.",a:"Marcus Aurelius"},
  {t:"The impediment to action advances action. What stands in the way becomes the way.",a:"Marcus Aurelius"},
  {t:"Waste no more time arguing about what a good man should be. Be one.",a:"Marcus Aurelius"},
  {t:"If it is not right, do not do it; if it is not true, do not say it.",a:"Marcus Aurelius"},
  {t:"Dwell on the beauty of life. Watch the stars, and see yourself running with them.",a:"Marcus Aurelius"},
  {t:"You have power over your mind, not outside events. Realize this and you will find strength.",a:"Marcus Aurelius"},
  {t:"We suffer more often in imagination than in reality.",a:"Seneca"},
  {t:"Luck is what happens when preparation meets opportunity.",a:"Seneca"},
  {t:"It is not that I'm so smart. But I stay with the questions much longer.",a:"Seneca"},
  {t:"To the person who does not know where he wants to go there is no favorable wind.",a:"Seneca"},
  {t:"It is not the man who has too little, but the man who craves more, that is poor.",a:"Seneca"},
  {t:"Patience is a remedy for every sorrow.",a:"Seneca"},
  {t:"No man is free who is not master of himself.",a:"Epictetus"},
  {t:"Wealth consists not in having great possessions, but in having few wants.",a:"Epictetus"},
  {t:"He is a wise man who does not grieve for the things which he has not, but rejoices for those which he has.",a:"Epictetus"},
  {t:"The unexamined life is not worth living.",a:"Socrates"},
  {t:"The secret of change is to focus all your energy not on fighting the old, but on building the new.",a:"Socrates"},
  {t:"The only true wisdom is in knowing you know nothing.",a:"Socrates"},
  {t:"Excellence is never an accident. It is always the result of high intention, sincere effort, and intelligent execution.",a:"Aristotle"},
  {t:"We are what we repeatedly do. Excellence, then, is not an act, but a habit.",a:"Aristotle"},
  {t:"Knowing yourself is the beginning of all wisdom.",a:"Aristotle"},
  {t:"Patience is bitter, but its fruit is sweet.",a:"Aristotle"},
  {t:"Quality is not an act, it is a habit.",a:"Aristotle"},
  {t:"The journey of a thousand miles begins with a single step.",a:"Lao Tzu"},
  {t:"He who knows others is wise; he who knows himself is enlightened.",a:"Lao Tzu"},
  {t:"Nature does not hurry, yet everything is accomplished.",a:"Lao Tzu"},
  {t:"When I let go of what I am, I become what I might be.",a:"Lao Tzu"},
  {t:"Act without expectation.",a:"Lao Tzu"},
  {t:"A good traveler has no fixed plans, and is not intent on arriving.",a:"Lao Tzu"},
  {t:"The mind is everything. What you think you become.",a:"Buddha"},
  {t:"Three things cannot be long hidden: the sun, the moon, and the truth.",a:"Buddha"},
  {t:"Do not dwell in the past, do not dream of the future, concentrate the mind on the present moment.",a:"Buddha"},
  {t:"Common sense is not so common.",a:"Voltaire"},
  {t:"Judge a man by his questions rather than by his answers.",a:"Voltaire"},
  {t:"I disapprove of what you say, but I will defend to the death your right to say it.",a:"Voltaire"},
  {t:"In the middle of difficulty lies opportunity.",a:"Albert Einstein"},
  {t:"A person who never made a mistake never tried anything new.",a:"Albert Einstein"},
  {t:"Imagination is more important than knowledge.",a:"Albert Einstein"},
  {t:"The measure of intelligence is the ability to change.",a:"Albert Einstein"},
  {t:"Logic will get you from A to B. Imagination will take you everywhere.",a:"Albert Einstein"},
  {t:"We cannot solve our problems with the same thinking we used when we created them.",a:"Albert Einstein"},
  {t:"Try not to become a person of success but rather try to become a person of value.",a:"Albert Einstein"},
  {t:"I have not failed. I've just found 10,000 ways that won't work.",a:"Thomas Edison"},
  {t:"Genius is one percent inspiration and ninety-nine percent perspiration.",a:"Thomas Edison"},
  {t:"Vision without execution is hallucination.",a:"Thomas Edison"},
  {t:"Our greatest weakness lies in giving up. The most certain way to succeed is always to try just one more time.",a:"Thomas Edison"},
  {t:"If we all did the things we are really capable of doing, we would literally astound ourselves.",a:"Thomas Edison"},
  {t:"The present is theirs; the future, for which I really worked, is mine.",a:"Nikola Tesla"},
  {t:"Be alone, that is the secret of invention; be alone, that is when ideas are born.",a:"Nikola Tesla"},
  {t:"If you want to find the secrets of the universe, think in terms of energy, frequency and vibration.",a:"Nikola Tesla"},
  {t:"An investment in knowledge pays the best interest.",a:"Benjamin Franklin"},
  {t:"Simplicity is the ultimate sophistication.",a:"Leonardo da Vinci"},
  {t:"Learning never exhausts the mind.",a:"Leonardo da Vinci"},
  {t:"The only way to do great work is to love what you do.",a:"Steve Jobs"},
  {t:"Stay hungry. Stay foolish.",a:"Steve Jobs"},
  {t:"Innovation distinguishes between a leader and a follower.",a:"Steve Jobs"},
  {t:"Your time is limited, so don't waste it living someone else's life.",a:"Steve Jobs"},
  {t:"Whether you think you can, or you think you can't — you're right.",a:"Henry Ford"},
  {t:"Coming together is a beginning; keeping together is progress; working together is success.",a:"Henry Ford"},
  {t:"Quality means doing it right when no one is looking.",a:"Henry Ford"},
  {t:"The best way to predict the future is to invent it.",a:"Alan Kay"},
  {t:"Build your own dreams, or someone else will hire you to build theirs.",a:"Farrah Gray"},
  {t:"The way to get started is to quit talking and begin doing.",a:"Walt Disney"},
  {t:"If you can dream it, you can do it.",a:"Walt Disney"},
  {t:"I find that the harder I work, the more luck I seem to have.",a:"Thomas Jefferson"},
  {t:"The most valuable of all talents is that of never using two words when one will do.",a:"Thomas Jefferson"},
  {t:"Give me six hours to chop down a tree and I will spend the first four sharpening the axe.",a:"Abraham Lincoln"},
  {t:"Nearly all men can stand adversity, but if you want to test a man's character, give him power.",a:"Abraham Lincoln"},
  {t:"Whatever you are, be a good one.",a:"Abraham Lincoln"},
  {t:"The only thing we have to fear is fear itself.",a:"Franklin D. Roosevelt"},
  {t:"A smooth sea never made a skilled sailor.",a:"Franklin D. Roosevelt"},
  {t:"When you reach the end of your rope, tie a knot in it and hang on.",a:"Franklin D. Roosevelt"},
  {t:"Believe you can and you're halfway there.",a:"Theodore Roosevelt"},
  {t:"Do what you can, with what you have, where you are.",a:"Theodore Roosevelt"},
  {t:"Far better it is to dare mighty things, to win glorious triumphs, even though checkered by failure.",a:"Theodore Roosevelt"},
  {t:"The harder the conflict, the greater the triumph.",a:"George Washington"},
  {t:"Perseverance and spirit have done wonders in all ages.",a:"George Washington"},
  {t:"Not all readers are leaders, but all leaders are readers.",a:"Harry S. Truman"},
  {t:"It is amazing what you can accomplish if you do not care who gets the credit.",a:"Harry S. Truman"},
  {t:"The buck stops here.",a:"Harry S. Truman"},
  {t:"Ask not what your country can do for you — ask what you can do for your country.",a:"John F. Kennedy"},
  {t:"Change will not come if we wait for some other person or some other time.",a:"Barack Obama"},
  {t:"The supreme art of war is to subdue the enemy without fighting.",a:"Sun Tzu"},
  {t:"Opportunities multiply as they are seized.",a:"Sun Tzu"},
  {t:"If you know the enemy and know yourself, you need not fear the result of a hundred battles.",a:"Sun Tzu"},
  {t:"Every battle is won before it is fought.",a:"Sun Tzu"},
  {t:"Speed is the essence of war.",a:"Sun Tzu"},
  {t:"Victory is reserved for those who are willing to pay its price.",a:"Sun Tzu"},
  {t:"Lead me, follow me, or get out of my way.",a:"George S. Patton"},
  {t:"The more you sweat in training, the less you bleed in battle.",a:"Norman Schwarzkopf"},
  {t:"He who dares wins.",a:"SAS Motto"},
  {t:"Victory loves preparation.",a:"Roman Proverb"},
  {t:"Success is not final, failure is not fatal: it is the courage to continue that counts.",a:"Winston Churchill"},
  {t:"Success is walking from failure to failure with no loss of enthusiasm.",a:"Winston Churchill"},
  {t:"If you're going through hell, keep going.",a:"Winston Churchill"},
  {t:"To improve is to change; to be perfect is to change often.",a:"Winston Churchill"},
  {t:"Attitude is a little thing that makes a big difference.",a:"Winston Churchill"},
  {t:"Talent wins games, but teamwork and intelligence win championships.",a:"Michael Jordan"},
  {t:"I can accept failure. Everyone fails at something. But I can't accept not trying.",a:"Michael Jordan"},
  {t:"Some people want it to happen, some wish it would happen, others make it happen.",a:"Michael Jordan"},
  {t:"Limits, like fears, are often just an illusion.",a:"Michael Jordan"},
  {t:"Everything negative — pressure, challenges — is all an opportunity for me to rise.",a:"Kobe Bryant"},
  {t:"The most important thing is to try and inspire people so that they can be great in whatever they want to do.",a:"Kobe Bryant"},
  {t:"Once you know what failure feels like, determination chases success.",a:"Kobe Bryant"},
  {t:"Champions aren't made in gyms. Champions are made from something they have deep inside them — a desire, a dream, a vision.",a:"Muhammad Ali"},
  {t:"He who is not courageous enough to take risks will accomplish nothing in life.",a:"Muhammad Ali"},
  {t:"Float like a butterfly, sting like a bee. The hands can't hit what the eyes can't see.",a:"Muhammad Ali"},
  {t:"Impossible is just a big word thrown around by small men who find it easier to live in the world they've been given than to explore the power they have to change it.",a:"Muhammad Ali"},
  {t:"Don't count the days; make the days count.",a:"Muhammad Ali"},
  {t:"I hated every minute of training, but I said, don't quit. Suffer now and live the rest of your life as a champion.",a:"Muhammad Ali"},
  {t:"It's not whether you get knocked down, it's whether you get up.",a:"Vince Lombardi"},
  {t:"Winning isn't everything, but wanting to win is.",a:"Vince Lombardi"},
  {t:"The price of success is hard work, dedication to the job at hand.",a:"Vince Lombardi"},
  {t:"Perfection is not attainable, but if we chase perfection we can catch excellence.",a:"Vince Lombardi"},
  {t:"Leaders aren't born, they are made.",a:"Vince Lombardi"},
  {t:"Make each day your masterpiece.",a:"John Wooden"},
  {t:"Failure is not fatal, but failure to change might be.",a:"John Wooden"},
  {t:"The most powerful leadership tool you have is your own personal example.",a:"John Wooden"},
  {t:"The harder I practice, the luckier I get.",a:"Gary Player"},
  {t:"A champion is defined not by their wins but by how they can recover when they fall.",a:"Serena Williams"},
  {t:"Pain is temporary. Quitting lasts forever.",a:"Lance Armstrong"},
  {t:"Fall seven times, stand up eight.",a:"Japanese Proverb"},
  {t:"You're never as good as everyone tells you when you win, and you're never as bad as they say when you lose.",a:"Lou Holtz"},
  {t:"The will to win is important, but the will to prepare is vital.",a:"Joe Paterno"},
  {t:"In theory there is no difference between theory and practice. In practice there is.",a:"Yogi Berra"},
  {t:"It ain't over till it's over.",a:"Yogi Berra"},
  {t:"Discipline is the bridge between goals and accomplishment.",a:"Jim Rohn"},
  {t:"If you're not growing, you're dying.",a:"Tony Robbins"},
  {t:"The path to success is to take massive, determined action.",a:"Tony Robbins"},
  {t:"It's not about resources, it's about resourcefulness.",a:"Tony Robbins"},
  {t:"Life is 10% what happens to you and 90% how you react to it.",a:"Charles R. Swindoll"},
  {t:"You don't have to be great to start, but you have to start to be great.",a:"Zig Ziglar"},
  {t:"You were born to win, but to be a winner you must plan to win, prepare to win, and expect to win.",a:"Zig Ziglar"},
  {t:"If you aim at nothing, you will hit it every time.",a:"Zig Ziglar"},
  {t:"I am not a product of my circumstances. I am a product of my decisions.",a:"Stephen Covey"},
  {t:"Begin with the end in mind.",a:"Stephen Covey"},
  {t:"Most people do not listen with the intent to understand; they listen with the intent to reply.",a:"Stephen Covey"},
  {t:"Great minds discuss ideas; average minds discuss events; small minds discuss people.",a:"Eleanor Roosevelt"},
  {t:"The future belongs to those who believe in the beauty of their dreams.",a:"Eleanor Roosevelt"},
  {t:"You must do the thing you think you cannot do.",a:"Eleanor Roosevelt"},
  {t:"Do one thing every day that scares you.",a:"Eleanor Roosevelt"},
  {t:"You become what you believe.",a:"Oprah Winfrey"},
  {t:"The biggest adventure you can take is to live the life of your dreams.",a:"Oprah Winfrey"},
  {t:"Turn your wounds into wisdom.",a:"Oprah Winfrey"},
  {t:"The harder the battle, the sweeter the victory.",a:"Les Brown"},
  {t:"Every setback is a setup for a comeback.",a:"Joel Osteen"},
  {t:"The successful warrior is the average man with laser-like focus.",a:"Bruce Lee"},
  {t:"If you spend too much time thinking about a thing, you'll never get it done.",a:"Bruce Lee"},
  {t:"Do not pray for an easy life, pray for the strength to endure a difficult one.",a:"Bruce Lee"},
  {t:"A goal is not always meant to be reached; it often serves simply as something to aim at.",a:"Bruce Lee"},
  {t:"Absorb what is useful, discard what is not, add what is uniquely your own.",a:"Bruce Lee"},
  {t:"Knowing is not enough, we must apply. Willing is not enough, we must do.",a:"Bruce Lee"},
  {t:"Happiness is not something ready-made. It comes from your own actions.",a:"Dalai Lama"},
  {t:"The two most powerful warriors are patience and time.",a:"Leo Tolstoy"},
  {t:"He who has a why to live can bear almost any how.",a:"Friedrich Nietzsche"},
  {t:"That which does not kill us makes us stronger.",a:"Friedrich Nietzsche"},
  {t:"To live is the rarest thing in the world. Most people just exist.",a:"Oscar Wilde"},
  {t:"Be yourself; everyone else is already taken.",a:"Oscar Wilde"},
  {t:"Not all those who wander are lost.",a:"J.R.R. Tolkien"},
  {t:"It does not do to dwell on dreams and forget to live.",a:"J.K. Rowling"},
  {t:"We must all face the choice between what is right and what is easy.",a:"J.K. Rowling"},
  {t:"Happiness can be found even in the darkest of times, if one only remembers to turn on the light.",a:"J.K. Rowling"},
  {t:"There is no greater agony than bearing an untold story inside you.",a:"Maya Angelou"},
  {t:"Nothing will work unless you do.",a:"Maya Angelou"},
  {t:"Do the best you can until you know better. Then when you know better, do better.",a:"Maya Angelou"},
  {t:"People will forget what you said, people will forget what you did, but people will never forget how you made them feel.",a:"Maya Angelou"},
  {t:"What lies behind you and what lies in front of you, pales in comparison to what lies inside of you.",a:"Ralph Waldo Emerson"},
  {t:"The only person you are destined to become is the person you decide to be.",a:"Ralph Waldo Emerson"},
  {t:"Do not go where the path may lead; go instead where there is no path and leave a trail.",a:"Ralph Waldo Emerson"},
  {t:"Always do what you are afraid to do.",a:"Ralph Waldo Emerson"},
  {t:"The mind, once stretched by a new idea, never returns to its original dimensions.",a:"Ralph Waldo Emerson"},
  {t:"In three words I can sum up everything I've learned about life: it goes on.",a:"Robert Frost"},
  {t:"Keep your face always toward the sunshine — and shadows will fall behind you.",a:"Walt Whitman"},
  {t:"You can't use up creativity. The more you use, the more you have.",a:"Maya Angelou"},
  {t:"You are never too old to set another goal or to dream a new dream.",a:"C.S. Lewis"},
  {t:"Hardships often prepare ordinary people for an extraordinary destiny.",a:"C.S. Lewis"},
  {t:"You can't go back and change the beginning, but you can start where you are and change the ending.",a:"C.S. Lewis"},
  {t:"And, when you want something, all the universe conspires in helping you to achieve it.",a:"Paulo Coelho"},
  {t:"It's the possibility of having a dream come true that makes life interesting.",a:"Paulo Coelho"},
  {t:"One day or day one. You decide.",a:"Unknown"},
  {t:"Be the change you wish to see in the world.",a:"Mahatma Gandhi"},
  {t:"First they ignore you, then they laugh at you, then they fight you, then you win.",a:"Mahatma Gandhi"},
  {t:"Live as if you were to die tomorrow. Learn as if you were to live forever.",a:"Mahatma Gandhi"},
  {t:"Strength does not come from physical capacity. It comes from an indomitable will.",a:"Mahatma Gandhi"},
  {t:"It always seems impossible until it is done.",a:"Nelson Mandela"},
  {t:"The greatest glory in living lies not in never falling, but in rising every time we fall.",a:"Nelson Mandela"},
  {t:"Courage is not the absence of fear, but the triumph over it.",a:"Nelson Mandela"},
  {t:"Education is the most powerful weapon which you can use to change the world.",a:"Nelson Mandela"},
  {t:"After climbing a great hill, one only finds that there are many more hills to climb.",a:"Nelson Mandela"},
  {t:"The best time to plant a tree was 20 years ago. The second best time is now.",a:"Chinese Proverb"},
  {t:"The secret of being boring is to say everything.",a:"Voltaire"},
  {t:"Even if you're on the right track, you'll get run over if you just sit there.",a:"Will Rogers"},
  {t:"Don't let yesterday take up too much of today.",a:"Will Rogers"},
  {t:"If the wind will not serve, take to the oars.",a:"Latin Proverb"},
  {t:"Know thyself.",a:"Ancient Greek Aphorism"},
  {t:"Start where you are. Use what you have. Do what you can.",a:"Arthur Ashe"},
  {t:"Everything you've ever wanted is on the other side of fear.",a:"George Addair"},
  {t:"Don't watch the clock; do what it does. Keep going.",a:"Sam Levenson"},
  {t:"Life begins at the end of your comfort zone.",a:"Neale Donald Walsch"},
  {t:"Success is not how high you have climbed, but how you make a positive difference to the world.",a:"Roy T. Bennett"},
  {t:"The secret of success is to be ready when your opportunity comes.",a:"Benjamin Disraeli"},
  {t:"Your reputation is built with what you do when no one else is watching.",a:"Unknown"},
  {t:"Discipline is doing what needs to be done, even if you don't want to do it.",a:"Unknown"},
  {t:"The only one who can tell you you can't win is you and you don't have to listen.",a:"Jessica Ennis-Hill"},
  {t:"Tough times never last, but tough people do.",a:"Robert H. Schuller"},
  {t:"Focus on the journey, not the destination. Joy is found not in finishing an activity but in doing it.",a:"Greg Anderson"},
  {t:"How you climb a mountain is more important than whether you reach the top.",a:"Yvon Chouinard"},
  {t:"Be so good they can't ignore you.",a:"Steve Martin"},
  {t:"I never lost a game; I just ran out of time.",a:"Bobby Layne"},
  // ── Trader KB Voices (Steps 1-5) ────────────────────────────────────────,
  {t:"I was one of the slowest learners in my class. I did not have a profitable month for my whole first year. And then it clicked.",a:"Lance Breitstein"},
  {t:"A capitulation — when something really panics, really flushes out — you don't need to be figuring out ahead of time. You can identify those qualities and go to where the puck is.",a:"Lance Breitstein"},
  {t:"It's like poker — if you have the fundamentals down, adding size can actually be one of the easiest and fastest parts.",a:"Lance Breitstein"},
  {t:"What's the EASIEST money out there? Not the biggest. Not the best. The most replicable play — that's where you build your chops.",a:"Lance Breitstein"},
  {t:"Technical analysis is simply the way of showing that psychology and price over time. The patterns repeat because human behavior repeats.",a:"Lance Breitstein"},
  {t:"You don't earn a vacation day from taking hits. You do your journal, you do your scans, you do your work — especially when you don't want to.",a:"Kunal Desai"},
  {t:"If you are a one-trick pony in the market, you will lose — and you will lose a lot.",a:"Kunal Desai"},
  {t:"In a bull market you do red-to-green moves on bully stocks. When the market shifts, that red-to-green spot is the exact spot you should short. It's a small adjustment but you have to know that.",a:"Kunal Desai"},
  {t:"VWAP as parabolic long confirmation: in bull markets, stock dips to VWAP, holds, bounces — long entry. In bear markets, it breaks and continues down. The market tells you which one it is.",a:"Kunal Desai"},
  {t:"Most people became so focused on individual stock setups that there's been a lack of education in market structure — what are the general indices doing? What are breadth characteristics?",a:"Kunal Desai"},
  {t:"Trend following is the best pattern for new people. It is not 'is this a long or short?' — it is just: I am following this trend. You have the wind at your back.",a:"Kunal Desai"},
  {t:"Structure and behavioral reasons are equally important to specific parameters and numeric inputs. Don't just look at the numbers — look at HOW the stock is moving.",a:"Marios Stamatoudis"},
  {t:"You're lucky to get a couple 5-star parabolic short candidates a year. Most parabolic-looking stocks are not true parabolics.",a:"Marios Stamatoudis"},
  {t:"Every parabolic short I have analyzed reaches the 9 EMA before any counter-trend rally emerges. Exit at the 9 EMA. Do not be greedy.",a:"Marios Stamatoudis"},
  {t:"Taking a large position right away has burned me in the past. Scale in as the thesis confirms. Full size only after price confirms the reversal.",a:"Marios Stamatoudis"},
  {t:"The primary entry is the dead volume inside day — lowest volume in ten sessions with an inside candle. Stop below the inside day low. That is your tightest stop possible.",a:"Leif Soreide"},
  {t:"A Rocket Base corrects 25 to 50 percent — that is not a failed flag. It is an HTF absorbing distribution and resolving as a 6 to 10 week base with full pole power behind it.",a:"Leif Soreide"},
  {t:"The IPO exception: cut all time rules in half. New issues need less time to form valid setups.",a:"Leif Soreide"},
  {t:"Green signal — full aggression. Yellow signal — smaller size. Red signal — minimal exposure. Your system must tell you how hard to push.",a:"Leif Soreide"},
  {t:"The 9M EP — the first time a stock ever trades 9 million or more shares in a single day — that is institutional discovery. It is extremely bullish and it almost never fails to follow through.",a:"Pradeep Bonde"},
  {t:"Growth EP holds 10 to 20 days for 50 to 300 percent gains. Story EP exits within 1 to 3 days — it fades fast. Do NOT hold a Story EP like a Growth EP.",a:"Pradeep Bonde"},
  {t:"Enter at the contraction-expansion interface — flat price, drying volume, near the breakout level — before the breakout happens. Tighter stop, better risk-reward than buying the confirmed move.",a:"Pradeep Bonde"},
  {t:"The MAGNA filter tells you why an EP has explosive potential: massive EPS acceleration, sales growth, game-changing catalyst, neglect, analyst upgrades, short interest, and small enough to move fast.",a:"Pradeep Bonde"},
  {t:"LEAD stocks: 9 EMA above 21 EMA above 50 EMA. That alignment tells you institutions are steadily accumulating. LEAD expansion tells you the trend is accelerating. That is where you focus.",a:"Martin Luk"},
  {t:"The Opening Range High breakout is the primary entry for Episodic Pivots. The stock announces its intention in the first 30 minutes. Be there.",a:"Martin Luk"},
  {t:"Stack your edges. Technical setup plus market uptrend plus fundamental growth plus sector confirmation plus macro tailwind. Five edges aligned means conviction sizing.",a:"Clement Ang"},
  {t:"A shakeout to setup is more bullish than a clean breakout. When the stock flushes weak hands, breaks the moving average, then reclaims and tightens — that is the highest-quality entry there is.",a:"Clement Ang"},
  {t:"Watch DXY, crypto, and commodities for correlation shifts. These macro signals often front-run equity regime changes by days or weeks.",a:"Clement Ang"},
  {t:"When a VDU leads directly into a Pocket Pivot — supply exhausted, then institutional demand confirmed — that is the highest-probability combination. That is where you size up.",a:"Gil Morales"},
  {t:"A Buyable Gap-Up has one rule: stop at the gap midpoint. If the gap fills completely, the stock has failed. There is no arguing with a filled gap.",a:"Gil Morales"},
  {t:"Give a proper breakout trade 7 weeks before making major sell decisions. Selling a winner in week 3 because it pulled back to the 10-day has ended more profitable trades than any bear market.",a:"Gil Morales"},
  {t:"The stop is not an arbitrary percentage. The stop is the FAILURE POINT — the exact price where the chart says the pattern is wrong. Find that point first, then calculate your position size.",a:"Peter Brandt"},
  {t:"A valid trendline requires 3 touch points minimum. Two points make a line. Three points make a pattern you can trade.",a:"Peter Brandt"},
  {t:"I risk 0.25 to 1 percent per trade. Never more than 1 percent. The math works because I let winners run and I never allow a small loss to become a large one.",a:"Peter Brandt"},
  {t:"Wait for the confirmed breakout close. No anticipation. The pattern either resolves or it does not. Your job is to respond, not to predict.",a:"Peter Brandt"},
  {t:"The wick play: a candlestick wick at a key support or resistance level is not a failed move — it is a precise rejection with a built-in stop. That tight stop enables oversized position size.",a:"Oliver Kell"},
  // ── Extended Classic Trader Library ──────────────────────────────────────,
  {t:"The hard work in trading is the mental work of undoing your assumptions.",a:"Jack Schwager"},
  {t:"Markets are not random. They are driven by fear and greed — the two most powerful emotions humans have.",a:"Jack Schwager"},
  {t:"Win or lose, everybody gets what they want out of the market.",a:"Ed Seykota"},
  {t:"There are old traders and there are bold traders, but there are very few old, bold traders.",a:"Ed Seykota"},
  {t:"The markets are the same now as they were five or ten years ago because they keep changing — just like they always have.",a:"Ed Seykota"},
  {t:"Trend following is responding to what is, not predicting what will be.",a:"Ed Seykota"},
  {t:"The biggest misconception most people have is that they must predict the future to make money in the markets. That's not true.",a:"Michael Marcus"},
  {t:"Every time I thought I had figured out the market, it found a way to humble me. That humility is what keeps you alive.",a:"Michael Marcus"},
  {t:"I just want to be on the right side of every move.",a:"Richard Dennis"},
  {t:"We are the exception, not the rule. Assume that whatever worked for us will not work for you.",a:"Richard Dennis"},
  {t:"If you have an approach that makes money, then money management can make the difference between success and failure.",a:"Monroe Trout"},
  {t:"Good trading is a peculiar balance between the conviction to follow your ideas and the flexibility to recognize when you have made a mistake.",a:"Michael Steinhardt"},
  {t:"I always laugh at people who say I've never met a rich technician. I love that! It's such an arrogant, nonsensical response.",a:"Martin Schwartz"},
  {t:"The most important thing to me is that Russia is out of the picture. When Russia was part of the commodity markets, they were distorted.",a:"Bruce Kovner"},
  {t:"Fundamentals that you read about are typically useless as the market has already discounted the price.",a:"Bruce Kovner"},
  {t:"Position sizing is the most underrated aspect of trading. Most people obsess over entries when the edge lives in how much you trade.",a:"Van Tharp"},
  {t:"Risk management is the most important thing to understand in this business.",a:"Ray Dalio"},
  {t:"I learned to be humble. The market is always right.",a:"George Soros"},
  {t:"Markets are constantly in a state of uncertainty and flux, and money is made by discounting the obvious and betting on the unexpected.",a:"George Soros"},
  {t:"Doing what everybody else is doing at the moment, and therefore what you have an urge to do, feels safe. But the herd is usually wrong at extremes.",a:"George Soros"},
  {t:"The stock market is filled with individuals who know the price of everything, but the value of nothing.",a:"Philip Fisher"},
  {t:"I would rather miss a trade than explain a loss to a client.",a:"Unknown"},
  {t:"When in doubt, don't. When clearly in doubt — definitely don't.",a:"Unknown"},
  {t:"Your job is not to be right. Your job is to make money.",a:"Unknown"},
  {t:"The trend is your friend until it ends.",a:"Martin Zweig"},
  {t:"Don't fight the Fed. Don't fight the tape.",a:"Martin Zweig"},
  {t:"I always define my risk, and I don't have to worry about it.",a:"Tony Saliba"},
  {t:"I would rather be wrong for the right reasons than right for the wrong reasons.",a:"Unknown"},
  {t:"The market can remain irrational longer than you can remain solvent.",a:"John Maynard Keynes"},
  {t:"Never, never, never, under any condition, add to a losing position.",a:"Dennis Gartman"},
  {t:"There is always a reason to sell a winning trade. Very few traders ever find a reason to hold one.",a:"Unknown"},
  {t:"Buy the stock that is acting best. Not the stock you think should be acting best.",a:"Dan Zanger"},
  {t:"Volume precedes price. When volume picks up dramatically, something is happening that the public doesn't know about yet.",a:"Dan Zanger"},
  {t:"Everything I know I learned by being wrong more times than I could count. Every mistake was tuition.",a:"Nicolas Darvas"},
  {t:"Do not anticipate and move without market confirmation — being a little late in your trade is your insurance that you are right or wrong.",a:"Nicolas Darvas"},
  {t:"I box them in. When price leaves the box — that's my entry. The box is my thesis. The break is my trigger.",a:"Nicolas Darvas"},
  {t:"The game of speculation is the most uniformly fascinating game in the world. But it is not a game for the stupid, the mentally lazy, the person of inferior emotional balance, or the get-rich-quick adventurer.",a:"Jesse Livermore"},
  {t:"Stocks are never too high to buy or too low to sell.",a:"Jesse Livermore"},
  {t:"The big money is not in the individual fluctuations but in the major moves — in sizing up an entire market and its trend.",a:"Jesse Livermore"},
  {t:"There is only one side to the stock market — and it is not the bull side or the bear side, but the right side.",a:"Jesse Livermore"},
  {t:"It took me five years to learn to play the game intelligently enough to make big money when I was right.",a:"Jesse Livermore"},
  {t:"After spending many years in Wall Street and after making and losing millions of dollars I want to tell you this: it never was my thinking that made the big money for me. It was always my sitting.",a:"Jesse Livermore"},
  {t:"The elements of good trading are: cutting losses, cutting losses, and cutting losses.",a:"Ed Seykota"},
  {t:"Whatever you think the market is going to do, it is not going to do that.",a:"Unknown"},
  {t:"The market does not know you exist. It does not care how smart you are, how hard you worked, or how much you need this trade to work.",a:"Unknown"},
  {t:"A loss never bothers me after I take it. I forget it overnight. But being wrong and not taking the loss — that is what does the damage.",a:"Jesse Livermore"},
  {t:"Know what you own, and know why you own it.",a:"Peter Lynch"},
  {t:"In this business, if you're good, you're right six times out of ten. You're never going to be right nine times out of ten.",a:"Peter Lynch"},
  {t:"Go for a business that any idiot can run — because sooner or later, any idiot probably is going to run it.",a:"Peter Lynch"},
  {t:"The real key to making money in stocks is not to get scared out of them.",a:"Peter Lynch"},
  {t:"The person that turns over the most rocks wins the game.",a:"Peter Lynch"},
  {t:"Twenty years in this business convinces me that any normal person using the customary three percent of the brain can pick stocks just as well, if not better, than the average Wall Street expert.",a:"Peter Lynch"},
  {t:"I will walk through walls to make a trade that fits my criteria. And I will not touch a trade that doesn't, no matter how exciting it looks.",a:"Mark Minervini"},
  {t:"The essence of the VCP: stock makes a series of corrections that get smaller and smaller. Each contraction dries out the sellers. By the pivot, there are virtually none left.",a:"Mark Minervini"},
  {t:"Superperformance stocks have one thing in common: they all had massive earnings growth before their big move. Every single one.",a:"Mark Minervini"},
  {t:"To achieve superperformance, you must be able to buy the precise pivot point, not chase extended stocks.",a:"Mark Minervini"},
  {t:"My biggest gains have always come after a period of significant personal struggle. The market tests your resolve before it rewards your patience.",a:"Mark Minervini"},
  {t:"The VCP doesn't care what the economy is doing. It doesn't care what the Fed is doing. It is pure price and volume — pure supply and demand.",a:"Mark Minervini"},
  {t:"Stage 2 is the only place to be long. In Stage 1 you wait. In Stage 3 you exit. In Stage 4 you sell short or stand aside. That's the entire system.",a:"Stan Weinstein"},
  {t:"The 30-week moving average is your compass. As long as price is above a rising 30-week MA, you are in Stage 2. Never overthink it.",a:"Stan Weinstein"},
  {t:"Timing is everything. A great stock in the wrong stage will destroy you as efficiently as a bad stock in any stage.",a:"Stan Weinstein"},
  {t:"A stock can be fundamentally perfect and technically terrible. Trade the chart, not the story.",a:"Stan Weinstein"},
  {t:"Institutional investors control the market. Your only job is to figure out what they're doing and ride alongside them.",a:"William O'Neil"},
  {t:"The whole secret to winning in the stock market is to lose the least amount possible when you're not right.",a:"William O'Neil"},
  {t:"What seems too high and risky to the majority generally goes higher and what seems low and cheap generally goes lower.",a:"William O'Neil"},
  {t:"The market is not going to wait for you to feel comfortable. The best stocks don't have obvious, convenient entry points.",a:"William O'Neil"},
  {t:"I make it a rule never to lose more than one percent of my portfolio on any single trade.",a:"Larry Williams"},
  {t:"The smarter I get, the smaller I trade. That's the greatest lesson.",a:"Unknown"},
  {t:"Cut losses short. Let profits run. This sounds so simple. It is the hardest thing you will ever do.",a:"Unknown"},
  {t:"Most people think the goal is to find great trades. The goal is to NOT take bad trades.",a:"Unknown"},
  {t:"You don't need to be involved in every market move. You need to be involved in the ones where the risk-reward is heavily in your favor.",a:"Unknown"},
  {t:"A small account that survives will compound into a large account. A large account blown up starts at zero.",a:"Unknown"},
  {t:"The market rewards patience above almost any other virtue.",a:"Unknown"},
  {t:"Being wrong is acceptable. Staying wrong is intolerable.",a:"Unknown"},
  {t:"Every great trader has one thing in common: they took a devastating loss, adapted, and came back better.",a:"Unknown"},
  {t:"The market will be here tomorrow. Your capital might not be. Protect it first.",a:"Unknown"},
  {t:"The most dangerous words in trading: 'This time it's different.'",a:"Unknown"},
  {t:"Patience is not passive waiting. It is active restraint — the discipline to wait for the perfect moment.",a:"Unknown"},
  {t:"One good trade a week will make you wealthy. Fifty mediocre trades a week will make you broke.",a:"Unknown"},
  {t:"Don't confuse a bull market with being smart. The real test is what happens when it ends.",a:"Unknown"},
  {t:"Size up when you're winning. Size down when you're losing. This is the opposite of human nature.",a:"Unknown"},
  {t:"The best setup in the world doesn't matter if the market is in a downtrend.",a:"Unknown"},
  {t:"Trade what you see, not what you think.",a:"Unknown"},
  {t:"Your trading journal is your most valuable asset. More valuable than any indicator or system.",a:"Unknown"},
  {t:"Amateur hour ends when you stop averaging down into losses.",a:"Unknown"},
  {t:"Confidence comes from process, not from outcomes.",a:"Unknown"},
  {t:"The market punishes greed and rewards discipline. Sometimes immediately. Sometimes much later. But always eventually.",a:"Unknown"},
  {t:"You cannot control outcomes. You can only control process. Control the process.",a:"Unknown"},
  {t:"A setup only works when the market is in the right condition. Learn the conditions first.",a:"Unknown"},
  {t:"The best traders are not the ones who are always in the market. They are the ones who know when NOT to be.",a:"Unknown"},
  {t:"Your entry determines your risk. Your exit determines your reward. Master both.",a:"Unknown"},
  {t:"If the market is not doing what you expect after a reasonable amount of time — exit and reassess.",a:"Unknown"},
  {t:"Big positions on high-conviction setups. Small positions on uncertain ones. Nothing on bad ones.",a:"Unknown"},
  {t:"Every dollar you save by cutting a loss quickly is a dollar you can deploy on the next great setup.",a:"Unknown"},
  {t:"The market doesn't know your average price. It doesn't know your stop loss. It simply does what it does.",a:"Unknown"},
  {t:"Trade in the direction of least resistance. The stock tells you which direction that is.",a:"Unknown"},
]

function QuoteOfTheDay() {
  const quote = useMemo(() => {
    // Seed by calendar date — multiply by prime 97 so each day jumps ~97 positions
    // (97 is coprime to 392 so all quotes are reached before any repeat)
    const today = new Date()
    const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate()
    return QUOTES[(seed * 97) % QUOTES.length]
  }, [])

  return (
    <div className={styles.quotePanel}>
      <div className={styles.quoteLabel}>Quote of the Day</div>
      <div className={styles.quoteText}>&#8220;{quote.t}&#8221;</div>
      <div className={styles.quoteAuthor}>— {quote.a}</div>
    </div>
  )
}

const fetcher = url => fetch(url).then(r => r.json())

// Display order: 2 rows of 3
const ORDER = ['QQQ', 'SPY', 'IWM', 'DIA', 'BTC', 'VIX']

// ─── Sparkline ────────────────────────────────────────────────────────────────
const SPARK = {
  pos: [
    '0,32 9,28 18,30 27,24 36,22 45,20 54,18 63,15 72,12 81,14 90,10 100,8',
    '0,30 9,32 18,26 27,28 36,22 45,24 54,18 63,16 72,20 81,14 90,12 100,8',
    '0,34 9,30 18,28 27,32 36,26 45,22 54,20 63,18 72,14 81,16 90,10 100,7',
  ],
  neg: [
    '0,10 9,12 18,9 27,14 36,18 45,20 54,22 63,26 72,24 81,28 90,30 100,32',
    '0,8 9,14 18,12 27,16 36,14 45,20 54,24 63,22 72,26 81,28 90,32 100,34',
    '0,12 9,10 18,14 27,18 36,16 45,22 54,20 63,24 72,28 81,26 90,32 100,33',
  ],
  neu: [
    '0,20 9,18 18,22 27,19 36,21 45,20 54,22 63,19 72,21 81,20 90,19 100,21',
  ],
}
const SYM_IDX = { QQQ: 0, SPY: 1, IWM: 2, DIA: 0, BTC: 1, VIX: 2 }

// Colors per direction — hardcoded for reliable SVG attribute support
const SPARK_COLOR = {
  pos: { dim: 'rgba(0,210,85,0.06)',  bright: 'rgba(0,210,85,0.28)',  fill: 'rgba(0,210,85,1)',  glow: 'rgba(0,210,85,0.22)'  },
  neg: { dim: 'rgba(230,60,60,0.06)', bright: 'rgba(230,60,60,0.28)', fill: 'rgba(230,60,60,1)', glow: 'rgba(230,60,60,0.22)' },
  neu: { dim: 'rgba(160,160,160,0.05)', bright: 'rgba(160,160,160,0.22)', fill: 'rgba(160,160,160,1)', glow: 'rgba(160,160,160,0.16)' },
}

function Sparkline({ sym, css }) {
  const bucket = css === 'pos' ? SPARK.pos : css === 'neg' ? SPARK.neg : SPARK.neu
  const pts    = bucket[(SYM_IDX[sym] ?? 0) % bucket.length]
  const c      = SPARK_COLOR[css] ?? SPARK_COLOR.neu
  const id     = `sp-${sym}`

  // Last datapoint for the marker circle
  const lastPair = pts.trim().split(' ').pop().split(',')
  const [lx, ly] = [parseFloat(lastPair[0]), parseFloat(lastPair[1])]

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      style={{ position: 'absolute', right: 0, top: 0, width: '60%', height: '100%', zIndex: 0 }}
      aria-hidden="true"
    >
      <defs>
        {/* Horizontal stroke gradient: dim left → bright right */}
        <linearGradient id={`${id}-sg`} x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor={c.dim}    />
          <stop offset="100%" stopColor={c.bright}  />
        </linearGradient>
        {/* Vertical fog fill: color top → transparent bottom */}
        <linearGradient id={`${id}-fg`} x1="0" y1="0" x2="0" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor={c.fill} stopOpacity="0.13" />
          <stop offset="100%" stopColor={c.fill} stopOpacity="0"    />
        </linearGradient>
        {/* Glow blur filter — contained within SVG bounds */}
        <filter id={`${id}-glow`} x="-5%" y="-60%" width="110%" height="220%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>

      {/* Fog fill under the line */}
      <polygon
        points={`${pts} 100,40 0,40`}
        fill={`url(#${id}-fg)`}
        stroke="none"
      />

      {/* Glow: blurred duplicate line */}
      <polyline
        points={pts}
        fill="none"
        stroke={c.glow}
        strokeWidth="3.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        filter={`url(#${id}-glow)`}
        opacity="0.55"
      />

      {/* Main gradient stroke */}
      <polyline
        points={pts}
        fill="none"
        stroke={`url(#${id}-sg)`}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Last-point marker */}
      <circle cx={lx} cy={ly} r="1.8" fill={c.bright} opacity="0.55" />
    </svg>
  )
}

// TradingView symbol overrides
const TV_SYMS = { BTC: 'BTCUSD' }
// Symbols with no Finviz equity chart — TradingView only
const TV_ONLY = new Set(['BTC', 'VIX'])
// Symbols that use our /api/chart endpoint instead of Finviz or TradingView
const CUSTOM_CHART = new Set(['VIX'])
const TAB_TO_TF = { '5min': '5', '30min': '30', '1hr': '60', 'Daily': 'D', 'Weekly': 'W' }

function Cell({ sym, price, chg, css }) {
  const tintClass = css === 'pos' ? styles.cellPos : css === 'neg' ? styles.cellNeg : ''
  const customChartFn = CUSTOM_CHART.has(sym)
    ? (tab) => `/api/chart/${sym}?tf=${TAB_TO_TF[tab]}`
    : undefined
  return (
    <TickerPopup
      sym={sym}
      tvSym={TV_SYMS[sym]}
      showFinviz={!TV_ONLY.has(sym)}
      customChartFn={customChartFn}
      as="div"
    >
      <div className={`${styles.cellInner} ${tintClass}`}>
        <Sparkline sym={sym} css={css} />
        <div className={styles.cellContent}>
          <div className={styles.sym}>{sym}</div>
          <div className={styles.price}>{price}</div>
          <div className={`${styles.chg} ${css === 'neg' ? styles.neg : styles.pos}`}>{chg}</div>
        </div>
      </div>
    </TickerPopup>
  )
}

export default function FuturesStrip({ data: propData }) {
  const { data: fetched } = useSWR(
    propData !== undefined ? null : '/api/snapshot',
    fetcher,
    { refreshInterval: 10000 }
  )
  const data = propData !== undefined ? propData : fetched

  if (!data) {
    return <div className={styles.strip}><p className={styles.loading}>Loading prices…</p></div>
  }

  return (
    <div className={styles.strip}>
      <div className={styles.indexSide}>
        <div className={styles.grid}>
          {ORDER.map(sym => {
            // BTC comes from futures bucket, everything else from etfs
            const d = sym === 'BTC' ? data.futures?.BTC : data.etfs?.[sym]
            if (!d) return null
            return <Cell key={sym} sym={sym} price={d.price} chg={d.chg} css={d.css} />
          })}
        </div>
      </div>
      <div className={styles.quoteSide}>
        <QuoteOfTheDay />
      </div>
    </div>
  )
}
