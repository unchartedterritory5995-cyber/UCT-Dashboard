import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const P = {bg:"#06090f",cd:"#0d1321",al:"#111a2e",bd:"#1a2540",bl:"#243352",bu:"#00e676",be:"#ff1744",ac:"#ffab00",tx:"#c8d6e5",dm:"#7b8fa3",mt:"#4a5c73",wh:"#f0f4f8",ye:"#ffd600",ma:"#e040fb",sw:"#00b0ff",bk:"#b388ff",uc:"#78909c"};

const DAYS=[{d:"Mon 3/2",b:231839022,r:134537060},{d:"Tue 3/3",b:280454328,r:160605221},{d:"Wed 3/4",b:121386908,r:116786674},{d:"Thu 3/5",b:152069699,r:180192520},{d:"Fri 3/6",b:222990845,r:200247805}];

const CONV=[
  {sym:"TSLA",strike:"$410C",exp:"3/20",hits:15,prem:30873528,side:"AA",dir:"BULL"},
  {sym:"AMZN",strike:"$200P",exp:"3/13",hits:15,prem:10357214,side:"AA",dir:"BEAR"},
  {sym:"TSLA",strike:"$400C",exp:"3/13",hits:24,prem:8874356,side:"ASK",dir:"BULL"},
  {sym:"AMZN",strike:"$210P",exp:"3/13",hits:13,prem:5585076,side:"AA",dir:"BEAR"},
  {sym:"MU",strike:"$430C",exp:"3/20",hits:20,prem:20846235,side:"ASK",dir:"BULL"},
  {sym:"AMZN",strike:"$205P",exp:"3/13",hits:10,prem:7506806,side:"AA",dir:"BEAR"},
];

const SB_SYM=[{s:"TSLA",l:"TSLA \u00b7 3/13 $410C",b:52325569,r:18055398,n:34270171},{s:"MU",l:"MU \u00b7 3/20 $430C",b:43629998,r:23110104,n:20519894},{s:"UAL",l:"UAL \u00b7 3/13 $111C",b:5021464,r:241875,n:4779589},{s:"META",l:"META \u00b7 3/13 $650C",b:6283080,r:2120266,n:4162814},{s:"BE",l:"BE \u00b7 3/13 $148C",b:4945720,r:795393,n:4150327},{s:"ORCL",l:"ORCL \u00b7 3/13 $150C",b:4790318,r:2067426,n:2722892},{s:"NVDA",l:"NVDA \u00b7 3/13 $182.5C",b:26618289,r:24100054,n:2518235},{s:"AAPL",l:"AAPL \u00b7 3/13 $255C",b:4644652,r:2288867,n:2355785}];
const SR_SYM=[{s:"AMZN",l:"AMZN \u00b7 3/13 $200P",b:2330334,r:26591008,n:-24260674},{s:"AVGO",l:"AVGO \u00b7 3/13 $297.5P",b:10171081,r:19395497,n:-9224416},{s:"TSM",l:"TSM \u00b7 3/13 $327.5P",b:1310094,r:8599245,n:-7289151},{s:"NOW",l:"NOW \u00b7 3/20 $152P",b:0,r:3635000,n:-3635000},{s:"PLTR",l:"PLTR \u00b7 3/13 $155P",b:1899572,r:5167703,n:-3268131},{s:"INTU",l:"INTU \u00b7 3/20 $470P",b:0,r:3091100,n:-3091100},{s:"AMD",l:"AMD \u00b7 3/13 $187.5P",b:1488254,r:3685188,n:-2196934},{s:"PANW",l:"PANW \u00b7 3/13 $162.5P",b:0,r:1721535,n:-1721535}];

const LB_SYM=[{s:"MSFT",l:"MSFT \u00b7 1/15/27 $625C",b:129403204,r:11584123,n:117819081},{s:"TSLA",l:"TSLA \u00b7 3/20 $410C",b:74549330,r:11507393,n:63041937},{s:"GOOG",l:"GOOG \u00b7 1/21/28 $350C",b:28636201,r:9866950,n:18769251},{s:"CRCL",l:"CRCL \u00b7 1/15/27 $110C",b:20685387,r:5201850,n:15483537},{s:"AAOI",l:"AAOI \u00b7 6/18 $100C",b:14176154,r:365154,n:13811000},{s:"POWL",l:"POWL \u00b7 12/18 $520C",b:10306695,r:0,n:10306695},{s:"CRM",l:"CRM \u00b7 1/15/27 $260C",b:9762250,r:0,n:9762250},{s:"NVDA",l:"NVDA \u00b7 4/2 $200C",b:51895604,r:43715535,n:8180069}];
const LR_SYM=[{s:"LITE",l:"LITE \u00b7 6/18 $800P",b:1520914,r:18465978,n:-16945064},{s:"COHR",l:"COHR \u00b7 6/18 $300P",b:1364154,r:13588443,n:-12224289},{s:"VRT",l:"VRT \u00b7 5/15 $270P",b:307200,r:10585957,n:-10278757},{s:"GEV",l:"GEV \u00b7 6/18 $810P",b:1902907,r:11971800,n:-10068893},{s:"GOOGL",l:"GOOGL \u00b7 4/2 $265P",b:636750,r:9618836,n:-8982086},{s:"TSM",l:"TSM \u00b7 5/15 $350P",b:14355537,r:22445827,n:-8090290},{s:"CRWV",l:"CRWV \u00b7 12/18 $70P",b:10462356,r:17981298,n:-7518942},{s:"MET",l:"MET \u00b7 1/15/27 $77.5P",b:0,r:7516000,n:-7516000}];

const LEAPS_B=[{s:"MSFT",l:"MSFT \u00b7 1/15/27 $625C",b:122481359,r:2613034,n:119868325},{s:"TSLA",l:"TSLA \u00b7 12/15/28 $600C",b:25028625,r:2652570,n:22376055},{s:"CRCL",l:"CRCL \u00b7 1/15/27 $100C",b:13007598,r:238929,n:12768669},{s:"POWL",l:"POWL \u00b7 12/18 $520C",b:10306695,r:0,n:10306695},{s:"CRM",l:"CRM \u00b7 1/15/27 $260C",b:9762250,r:0,n:9762250},{s:"CF",l:"CF \u00b7 1/15/27 $130C",b:7193932,r:0,n:7193932},{s:"CAPR",l:"CAPR \u00b7 1/21/28 $7C",b:6150000,r:0,n:6150000},{s:"PFE",l:"PFE \u00b7 9/18 $28C",b:6037850,r:0,n:6037850}];
const LEAPS_R=[{s:"NVDA",l:"NVDA \u00b7 12/15/28 $175P",b:3355220,r:33323872,n:-29968652},{s:"LITE",l:"LITE \u00b7 1/15/27 $700P",b:0,r:8567828,n:-8567828},{s:"CRWV",l:"CRWV \u00b7 12/18 $70P",b:5013885,r:12702750,n:-7688865},{s:"MET",l:"MET \u00b7 1/15/27 $77.5P",b:0,r:7140000,n:-7140000},{s:"WYNN",l:"WYNN \u00b7 1/15/27 $100P",b:0,r:6396000,n:-6396000},{s:"IREN",l:"IREN \u00b7 12/18 $35P",b:0,r:6000000,n:-6000000},{s:"GGAL",l:"GGAL \u00b7 10/16 $65P",b:0,r:5574125,n:-5574125},{s:"NFLX",l:"NFLX \u00b7 1/15/27 $98P",b:5732450,r:11104000,n:-5371550}];

const SBL=[{S:"MU",Ty:"SWP",CP:"P",K:415,V:5000,P:10523610,E:"3/13",Si:"BB",Co:"YELLOW",DTE:10,Dt:"3/2"},{S:"TSLA",Ty:"SWP",CP:"C",K:410,V:21331,P:10452190,E:"3/13",Si:"A",Co:"YELLOW",DTE:6,Dt:"3/6"},{S:"TSLA",Ty:"SWP",CP:"C",K:410,V:13520,P:7098007,E:"3/13",Si:"B",Co:"YELLOW",DTE:6,Dt:"3/6"},{S:"MU",Ty:"SWP",CP:"C",K:430,V:4175,P:4696875,E:"3/20",Si:"B",Co:"MAGENTA",DTE:13,Dt:"3/6"},{S:"TSLA",Ty:"SWP",CP:"C",K:410,V:8400,P:3948040,E:"3/13",Si:"B",Co:"YELLOW",DTE:6,Dt:"3/6"},{S:"AVGO",Ty:"SWP",CP:"C",K:340,V:3588,P:2870400,E:"3/13",Si:"A",Co:"YELLOW",DTE:6,Dt:"3/6"},{S:"MU",Ty:"SWP",CP:"C",K:430,V:2269,P:2552630,E:"3/20",Si:"B",Co:"MAGENTA",DTE:13,Dt:"3/6"},{S:"MU",Ty:"SWP",CP:"C",K:430,V:2162,P:2486300,E:"3/20",Si:"A",Co:"MAGENTA",DTE:13,Dt:"3/6"}];
const SBR=[{S:"MU",Ty:"BLK",CP:"P",K:385,V:3616,P:10124800,E:"3/20",Si:"B",Co:"YELLOW",DTE:14,Dt:"3/5"},{S:"AVGO",Ty:"BLK",CP:"P",K:297.5,V:15136,P:4389440,E:"3/13",Si:"B",Co:"YELLOW",DTE:7,Dt:"3/5"},{S:"TSLA",Ty:"SWP",CP:"P",K:400,V:2750,P:2956164,E:"3/13",Si:"A",Co:"YELLOW",DTE:10,Dt:"3/2"},{S:"AMZN",Ty:"SWP",CP:"P",K:205,V:9091,P:2722724,E:"3/13",Si:"AA",Co:"YELLOW",DTE:6,Dt:"3/6"},{S:"NVDA",Ty:"SWP",CP:"P",K:177.5,V:7720,P:2701977,E:"3/13",Si:"A",Co:"YELLOW",DTE:6,Dt:"3/6"},{S:"AMZN",Ty:"SWP",CP:"P",K:200,V:12010,P:2390182,E:"3/13",Si:"AA",Co:"YELLOW",DTE:6,Dt:"3/6"},{S:"AMZN",Ty:"SWP",CP:"P",K:200,V:9935,P:1979972,E:"3/13",Si:"AA",Co:"MAGENTA",DTE:6,Dt:"3/6"},{S:"NVDA",Ty:"SWP",CP:"P",K:175,V:4771,P:1884554,E:"3/13",Si:"A",Co:"MAGENTA",DTE:6,Dt:"3/6"}];

const LBL=[{S:"MSFT",Ty:"BLK",CP:"C",K:625,V:100000,P:50500000,E:"1/15/27",Si:"A",Co:"YELLOW",DTE:318,Dt:"3/3"},{S:"MSFT",Ty:"BLK",CP:"C",K:575,V:50000,P:44000000,E:"1/15/27",Si:"A",Co:"YELLOW",DTE:318,Dt:"3/3"},{S:"MSFT",Ty:"BLK",CP:"C",K:675,V:50000,P:15000000,E:"1/15/27",Si:"B",Co:"YELLOW",DTE:318,Dt:"3/3"},{S:"MSFT",Ty:"BLK",CP:"C",K:675,V:50000,P:12250000,E:"12/18",Si:"B",Co:"YELLOW",DTE:290,Dt:"3/3"},{S:"NVDA",Ty:"BLK",CP:"C",K:150,V:3000,P:12000000,E:"6/18",Si:"A",Co:"MAGENTA",DTE:107,Dt:"3/2"},{S:"GOOG",Ty:"BLK",CP:"C",K:350,V:2050,P:10803356,E:"1/21/28",Si:"A",Co:"YELLOW",DTE:690,Dt:"3/2"},{S:"NVDA",Ty:"SWP",CP:"C",K:200,V:30545,P:9163679,E:"4/2",Si:"AA",Co:"YELLOW",DTE:30,Dt:"3/2"},{S:"AMD",Ty:"BLK",CP:"C",K:240,V:3500,P:7647500,E:"11/20",Si:"B",Co:"YELLOW",DTE:262,Dt:"3/3"}];
const LBR_T=[{S:"TSM",Ty:"BLK",CP:"P",K:350,V:4000,P:11080000,E:"5/15",Si:"B",Co:"YELLOW",DTE:72,Dt:"3/3"},{S:"VRT",Ty:"BLK",CP:"P",K:270,V:2045,P:9075856,E:"5/15",Si:"B",Co:"YELLOW",DTE:72,Dt:"3/3"},{S:"MET",Ty:"BLK",CP:"P",K:77.5,V:6000,P:7140000,E:"1/15/27",Si:"B",Co:"YELLOW",DTE:318,Dt:"3/3"},{S:"NVDA",Ty:"BLK",CP:"P",K:200,V:2950,P:6434030,E:"4/10",Si:"B",Co:"YELLOW",DTE:35,Dt:"3/5"},{S:"WYNN",Ty:"BLK",CP:"P",K:100,V:5200,P:6396000,E:"1/15/27",Si:"B",Co:"YELLOW",DTE:315,Dt:"3/6"},{S:"NFLX",Ty:"BLK",CP:"P",K:98,V:5000,P:6150000,E:"1/15/27",Si:"B",Co:"YELLOW",DTE:316,Dt:"3/5"},{S:"IREN",Ty:"BLK",CP:"P",K:35,V:6000,P:6000000,E:"12/18",Si:"B",Co:"YELLOW",DTE:291,Dt:"3/2"},{S:"GGAL",Ty:"BLK",CP:"P",K:65,V:2375,P:5574125,E:"10/16",Si:"B",Co:"YELLOW",DTE:225,Dt:"3/4"}];

const LEAPS_BL_T=[{S:"MSFT",Ty:"BLK",CP:"C",K:625,V:100000,P:50500000,E:"1/15/27",Si:"A",Co:"YELLOW",DTE:318,Dt:"3/3"},{S:"MSFT",Ty:"BLK",CP:"C",K:575,V:50000,P:44000000,E:"1/15/27",Si:"A",Co:"YELLOW",DTE:318,Dt:"3/3"},{S:"MSFT",Ty:"BLK",CP:"C",K:675,V:50000,P:15000000,E:"1/15/27",Si:"B",Co:"YELLOW",DTE:318,Dt:"3/3"},{S:"MSFT",Ty:"BLK",CP:"C",K:675,V:50000,P:12250000,E:"12/18",Si:"B",Co:"YELLOW",DTE:290,Dt:"3/3"},{S:"GOOG",Ty:"BLK",CP:"C",K:350,V:2050,P:10803356,E:"1/21/28",Si:"A",Co:"YELLOW",DTE:690,Dt:"3/2"},{S:"AMD",Ty:"BLK",CP:"C",K:240,V:3500,P:7647500,E:"11/20",Si:"B",Co:"YELLOW",DTE:262,Dt:"3/3"},{S:"CAPR",Ty:"BLK",CP:"C",K:7,V:3000,P:6150000,E:"1/21/28",Si:"B",Co:"YELLOW",DTE:686,Dt:"3/6"},{S:"CRM",Ty:"BLK",CP:"C",K:260,V:4500,P:5652000,E:"1/15/27",Si:"B",Co:"YELLOW",DTE:317,Dt:"3/4"}];
const LEAPS_BR_T=[{S:"MET",Ty:"BLK",CP:"P",K:77.5,V:6000,P:7140000,E:"1/15/27",Si:"B",Co:"YELLOW",DTE:318,Dt:"3/3"},{S:"WYNN",Ty:"BLK",CP:"P",K:100,V:5200,P:6396000,E:"1/15/27",Si:"B",Co:"YELLOW",DTE:315,Dt:"3/6"},{S:"NFLX",Ty:"BLK",CP:"P",K:98,V:5000,P:6150000,E:"1/15/27",Si:"B",Co:"YELLOW",DTE:316,Dt:"3/5"},{S:"IREN",Ty:"BLK",CP:"P",K:35,V:6000,P:6000000,E:"12/18",Si:"B",Co:"YELLOW",DTE:291,Dt:"3/2"},{S:"GGAL",Ty:"BLK",CP:"P",K:65,V:2375,P:5574125,E:"10/16",Si:"B",Co:"YELLOW",DTE:225,Dt:"3/4"},{S:"ORCL",Ty:"BLK",CP:"P",K:165,V:1200,P:4596000,E:"3/19/27",Si:"B",Co:"YELLOW",DTE:377,Dt:"3/6"},{S:"NFLX",Ty:"BLK",CP:"P",K:100,V:3000,P:4470000,E:"3/19/27",Si:"A",Co:"YELLOW",DTE:381,Dt:"3/2"},{S:"GOOG",Ty:"BLK",CP:"P",K:300,V:1500,P:4314000,E:"9/18",Si:"B",Co:"YELLOW",DTE:196,Dt:"3/5"}];

const SBLC=[{S:"TSLA",CP:"C",K:410,E:"3/13",H:10,P:25512060,V:51178},{S:"MU",CP:"C",K:430,E:"3/20",H:20,P:20846235,V:18342},{S:"TSLA",CP:"C",K:400,E:"3/13",H:24,P:8874356,V:9128},{S:"UAL",CP:"C",K:111,E:"3/13",H:5,P:4498214,V:40066},{S:"NVDA",CP:"C",K:180,E:"3/13",H:8,P:4292618,V:8830},{S:"AVGO",CP:"C",K:340,E:"3/13",H:4,P:4087749,V:5060}];
const SBRC=[{S:"MU",CP:"P",K:385,E:"3/20",H:2,P:10512510,V:3753},{S:"AMZN",CP:"P",K:200,E:"3/13",H:15,P:10357214,V:56597},{S:"AVGO",CP:"P",K:297.5,E:"3/13",H:8,P:8493002,V:29368},{S:"AMZN",CP:"P",K:205,E:"3/13",H:10,P:7506806,V:30390},{S:"NVDA",CP:"P",K:175,E:"3/13",H:8,P:6486279,V:19288},{S:"AMZN",CP:"P",K:210,E:"3/13",H:13,P:5585076,V:18273}];

const LBLC=[{S:"TSLA",CP:"C",K:410,E:"3/20",H:15,P:30873528,V:27137},{S:"NVDA",CP:"C",K:200,E:"4/2",H:12,P:19716109,V:65492},{S:"TSLA",CP:"C",K:600,E:"12/15/28",H:7,P:16718499,V:1804},{S:"MU",CP:"C",K:250,E:"10/16",H:2,P:9888520,V:600},{S:"MU",CP:"C",K:380,E:"3/27",H:10,P:8256976,V:2138},{S:"GOOG",CP:"C",K:305,E:"4/10",H:9,P:7968730,V:5592}];
const LBRC=[{S:"NVDA",CP:"P",K:175,E:"12/15/28",H:8,P:9794451,V:2193},{S:"GOOG",CP:"P",K:300,E:"9/18",H:2,P:8619000,V:3000},{S:"COHR",CP:"P",K:300,E:"6/18",H:4,P:6692261,V:1181},{S:"LITE",CP:"P",K:800,E:"6/18",H:2,P:6236610,V:339},{S:"NVDA",CP:"P",K:220,E:"12/15/28",H:4,P:5389355,V:771},{S:"SHOP",CP:"P",K:85,E:"6/17/27",H:2,P:5032000,V:4000}];

const LEAPS_BLC=[{S:"TSLA",CP:"C",K:600,E:"12/15/28",H:7,P:16718499,V:1804},{S:"MU",CP:"C",K:250,E:"10/16",H:2,P:9888520,V:600},{S:"PFE",CP:"C",K:28,E:"9/18",H:4,P:6037850,V:43381},{S:"CRCL",CP:"C",K:100,E:"1/15/27",H:2,P:6032050,V:1946},{S:"CRCL",CP:"C",K:110,E:"6/17/27",H:5,P:5955245,V:1728},{S:"POWL",CP:"C",K:520,E:"12/18",H:2,P:5527100,V:420}];
const LEAPS_BRC=[{S:"NVDA",CP:"P",K:175,E:"12/15/28",H:8,P:9794451,V:2193},{S:"GOOG",CP:"P",K:300,E:"9/18",H:2,P:8619000,V:3000},{S:"NVDA",CP:"P",K:220,E:"12/15/28",H:4,P:5389355,V:771},{S:"SHOP",CP:"P",K:85,E:"6/17/27",H:2,P:5032000,V:4000},{S:"NVDA",CP:"P",K:170,E:"12/15/28",H:4,P:4242690,V:1003},{S:"TSM",CP:"P",K:500,E:"12/18",H:2,P:2967000,V:200}];

/* ── Performance tracking: contract prices from flow ── */
const PERF_INIT=[
  {id:"c1",cat:"Conviction",sym:"TSLA",cp:"C",strike:410,exp:"3/20",entry:11.00,lo:10.50,hi:12.40,spot:400.37,hits:15,dir:"BULL"},
  {id:"c2",cat:"Conviction",sym:"AMZN",cp:"P",strike:200,exp:"3/13",entry:1.99,lo:0.94,hi:2.01,spot:213.50,hits:15,dir:"BEAR"},
  {id:"c3",cat:"Conviction",sym:"TSLA",cp:"C",strike:400,exp:"3/13",entry:9.20,lo:8.31,hi:15.40,spot:398.37,hits:24,dir:"BULL"},
  {id:"c4",cat:"Conviction",sym:"AMZN",cp:"P",strike:210,exp:"3/13",entry:5.50,lo:2.53,hi:5.50,spot:208.78,hits:13,dir:"BEAR"},
  {id:"c5",cat:"Conviction",sym:"MU",cp:"C",strike:430,exp:"3/20",entry:11.25,lo:8.70,hi:12.30,spot:382.42,hits:20,dir:"BULL"},
  {id:"c6",cat:"Conviction",sym:"AMZN",cp:"P",strike:205,exp:"3/13",entry:3.00,lo:1.54,hi:3.00,spot:213.29,hits:10,dir:"BEAR"},
  {id:"sb1",cat:"Short Bull",sym:"TSLA",cp:"C",strike:410,exp:"3/13",entry:4.90,lo:4.70,hi:8.00,spot:398.60,hits:10,dir:"BULL"},
  {id:"sb2",cat:"Short Bull",sym:"UAL",cp:"C",strike:111,exp:"3/13",entry:1.80,lo:0.75,hi:1.80,spot:104.34,hits:5,dir:"BULL"},
  {id:"sb3",cat:"Short Bull",sym:"AVGO",cp:"C",strike:340,exp:"3/13",entry:8.00,lo:8.00,hi:8.40,spot:336.76,hits:4,dir:"BULL"},
  {id:"sr1",cat:"Short Bear",sym:"MU",cp:"P",strike:385,exp:"3/20",entry:28.00,lo:28.00,hi:28.65,spot:384.40,hits:5,dir:"BEAR"},
  {id:"sr2",cat:"Short Bear",sym:"AVGO",cp:"P",strike:297.5,exp:"3/13",entry:2.90,lo:2.76,hi:3.20,spot:327.40,hits:8,dir:"BEAR"},
  {id:"sr3",cat:"Short Bear",sym:"NVDA",cp:"P",strike:175,exp:"3/13",entry:3.95,lo:3.00,hi:4.15,spot:177.96,hits:8,dir:"BEAR"},
  {id:"lb1",cat:"Long Bull",sym:"MSFT",cp:"C",strike:625,exp:"1/15/27",entry:5.05,lo:5.05,hi:5.05,spot:405.88,hits:1,dir:"BULL"},
  {id:"lb2",cat:"Long Bull",sym:"MSFT",cp:"C",strike:575,exp:"1/15/27",entry:8.80,lo:8.80,hi:8.80,spot:405.66,hits:1,dir:"BULL"},
  {id:"lb3",cat:"Long Bull",sym:"NVDA",cp:"C",strike:200,exp:"4/2",entry:3.00,lo:3.00,hi:3.24,spot:181.61,hits:12,dir:"BULL"},
  {id:"lb4",cat:"Long Bull",sym:"GOOG",cp:"C",strike:350,exp:"1/21/28",entry:52.70,lo:52.70,hi:52.70,spot:304.76,hits:1,dir:"BULL"},
  {id:"lb5",cat:"Long Bull",sym:"CRCL",cp:"C",strike:110,exp:"6/17/27",entry:34.50,lo:34.10,hi:34.50,spot:102.29,hits:5,dir:"BULL"},
  {id:"lr1",cat:"Long Bear",sym:"LITE",cp:"P",strike:800,exp:"6/18",entry:184.00,lo:183.90,hi:184.00,spot:768.66,hits:2,dir:"BEAR"},
  {id:"lr2",cat:"Long Bear",sym:"COHR",cp:"P",strike:300,exp:"6/18",entry:56.66,lo:56.50,hi:57.10,spot:295.67,hits:4,dir:"BEAR"},
  {id:"lr3",cat:"Long Bear",sym:"VRT",cp:"P",strike:270,exp:"5/15",entry:44.38,lo:44.38,hi:44.38,spot:241.21,hits:1,dir:"BEAR"},
  {id:"lr4",cat:"Long Bear",sym:"GEV",cp:"P",strike:810,exp:"6/18",entry:71.80,lo:71.80,hi:71.80,spot:843.88,hits:1,dir:"BEAR"},
  {id:"lp1",cat:"LEAPS Bull",sym:"TSLA",cp:"C",strike:600,exp:"12/15/28",entry:92.64,lo:92.60,hi:92.72,spot:398.94,hits:7,dir:"BULL"},
  {id:"lp2",cat:"LEAPS Bull",sym:"CRM",cp:"C",strike:260,exp:"1/15/27",entry:12.56,lo:12.56,hi:12.56,spot:195.95,hits:1,dir:"BULL"},
  {id:"lp3",cat:"LEAPS Bull",sym:"PFE",cp:"C",strike:28,exp:"9/18",entry:1.40,lo:1.30,hi:1.40,spot:26.48,hits:4,dir:"BULL"},
  {id:"lp4",cat:"LEAPS Bull",sym:"POWL",cp:"C",strike:520,exp:"12/18",entry:132.00,lo:131.00,hi:132.00,spot:504.85,hits:2,dir:"BULL"},
  {id:"lbr1",cat:"LEAPS Bear",sym:"NVDA",cp:"P",strike:175,exp:"12/15/28",entry:44.65,lo:44.60,hi:44.75,spot:178.75,hits:8,dir:"BEAR"},
  {id:"lbr2",cat:"LEAPS Bear",sym:"NVDA",cp:"P",strike:220,exp:"12/15/28",entry:69.82,lo:69.82,hi:69.95,spot:181.32,hits:4,dir:"BEAR"},
  {id:"lbr3",cat:"LEAPS Bear",sym:"WYNN",cp:"P",strike:100,exp:"1/15/27",entry:12.30,lo:12.30,hi:12.30,spot:102.15,hits:1,dir:"BEAR"},
  {id:"lbr4",cat:"LEAPS Bear",sym:"NFLX",cp:"P",strike:98,exp:"1/15/27",entry:12.30,lo:12.30,hi:12.30,spot:98.67,hits:1,dir:"BEAR"},
];

const WATCH=[{S:"NVDA",CP:"C",K:150,E:"6/18",V:5000,OI:111227,P:21050000,Si:"A",Ty:"BLK"},{S:"LITE",CP:"P",K:800,E:"1/15/27",V:600,OI:2502,P:18000000,Si:"A",Ty:"BLK"},{S:"AMZN",CP:"C",K:190,E:"5/15",V:4500,OI:18334,P:15840000,Si:"A",Ty:"BLK"},{S:"AMZN",CP:"C",K:190,E:"5/15",V:5000,OI:23138,P:13500000,Si:"B",Ty:"BLK"},{S:"IBM",CP:"P",K:265,E:"3/20",V:5000,OI:6360,P:12675000,Si:"A",Ty:"BLK"},{S:"AMD",CP:"P",K:190,E:"6/18",V:6000,OI:14859,P:12336000,Si:"B",Ty:"BLK"}];

function fmt(n){const a=Math.abs(n);if(a>=1e9)return"$"+(n/1e9).toFixed(2)+"B";if(a>=1e6)return"$"+(n/1e6).toFixed(1)+"M";if(a>=1e3)return"$"+(n/1e3).toFixed(0)+"K";return"$"+n}
function fK(n){return n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?(n/1e3).toFixed(1)+"K":String(n)}
function tc(t){return t==="SWP"?P.sw:P.bk}
function Tag({c,children}){return <span style={{display:"inline-block",padding:"2px 7px",borderRadius:3,fontSize:9,fontWeight:700,letterSpacing:0.4,whiteSpace:"nowrap",color:c,backgroundColor:`${c}15`,border:`1px solid ${c}30`}}>{children}</span>}
function Card({children,title,sub}){return <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:"14px 16px",display:"flex",flexDirection:"column",gap:8,minWidth:0}}>{title&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}><span style={{fontSize:11,fontWeight:700,color:P.dm,textTransform:"uppercase",letterSpacing:1.5}}>{title}</span>{sub&&<span style={{fontSize:10,color:P.mt}}>{sub}</span>}</div>}{children}</div>}
function TT({rows}){return <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}><thead><tr style={{borderBottom:`1px solid ${P.bd}`}}>{["Ticker","Day","Side","Signal","Type","C/P","Strike","Exp","Vol","Premium","DTE"].map(h=><th key={h} style={{padding:"5px 4px",textAlign:"left",color:P.mt,fontSize:9,fontWeight:600}}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i} style={{borderBottom:`1px solid ${P.bd}10`,background:(r.Si==="AA"||r.Si==="BB")?`${P.ac}08`:"transparent"}}><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.S}</td><td style={{padding:"5px 4px",color:P.dm,fontSize:9}}>{r.Dt}</td><td style={{padding:"5px 4px"}}>{r.Si==="BB"?<Tag c={P.be}>BB</Tag>:r.Si==="AA"?<Tag c={P.ac}>AA</Tag>:r.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>A</Tag>}</td><td style={{padding:"5px 4px"}}><Tag c={r.Co==="YELLOW"?P.ye:P.ma}>{r.Co}</Tag></td><td style={{padding:"5px 4px"}}><Tag c={tc(r.Ty)}>{r.Ty}</Tag></td><td style={{padding:"5px 4px"}}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>${r.K}</td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.E}</td><td style={{padding:"5px 4px",color:P.dm}}>{fK(r.V)}</td><td style={{padding:"5px 4px",fontWeight:700,color:P.wh}}>{fmt(r.P)}</td><td style={{padding:"5px 4px",color:P.dm}}>{r.DTE}d</td></tr>)}</tbody></table>}
function CT({rows}){return <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}><thead><tr style={{borderBottom:`1px solid ${P.bd}`}}>{["Ticker","C/P","Strike","Exp","Hits","Vol","Premium"].map(h=><th key={h} style={{padding:"5px 4px",textAlign:"left",color:P.mt,fontSize:9,fontWeight:600}}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i} style={{borderBottom:`1px solid ${P.bd}10`,background:r.H>=5?`${P.ac}08`:"transparent"}}><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.S}</td><td style={{padding:"5px 4px"}}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>${r.K}</td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.E}</td><td style={{padding:"5px 4px"}}><span style={{fontWeight:800,fontSize:13,color:r.H>=10?P.ac:r.H>=5?P.ye:P.dm}}>{r.H}x</span></td><td style={{padding:"5px 4px",color:P.dm}}>{fK(r.V)}</td><td style={{padding:"5px 4px",fontWeight:700,color:P.wh}}>{fmt(r.P)}</td></tr>)}</tbody></table>}
function NC({data,fill,dir}){const neg=dir==="bear";const cd=data.map(d=>({...d,v:neg?-Math.abs(d.n):d.n}));return <div style={{height:220}}><ResponsiveContainer><BarChart data={cd} layout="vertical" margin={{top:0,right:8,left:5,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke={P.bd} horizontal={false}/><XAxis type="number" tick={{fill:P.mt,fontSize:8}} tickFormatter={v=>fmt(Math.abs(v))}/><YAxis dataKey="s" type="category" tick={{fill:P.tx,fontSize:11,fontWeight:700}} width={60} interval={0} tickLine={false} axisLine={false}/><Tooltip content={({active,payload})=>{if(!active||!payload||!payload.length)return null;const d=payload[0].payload;return <div style={{background:"#152038",border:`1px solid ${P.bl}`,borderRadius:6,padding:"8px 12px",fontSize:11}}><div style={{fontWeight:700,marginBottom:3}}>{d.s}</div>{d.l&&<div style={{color:P.ac,fontSize:10,marginBottom:3}}>{d.l.split(" \u00b7 ")[1]}</div>}<div style={{color:P.bu}}>Bull: {fmt(d.b)}</div><div style={{color:P.be}}>Bear: {fmt(d.r)}</div><div style={{color:d.n>0?P.bu:P.be,fontWeight:700}}>Net: {fmt(d.n)}</div></div>}}/><Bar dataKey="v" fill={fill} radius={neg?[4,0,0,4]:[0,4,4,0]} barSize={14}/></BarChart></ResponsiveContainer></div>}

const TICKER_DB=[{"s":"TSLA","b":126874899,"r":29562791,"n":226,"t":[{"Ty":"SWP","CP":"C","K":410.0,"V":21331,"P":10452190,"E":"3/13","Si":"A","Co":"YELLOW","DTE":6,"Dt":"3/6","D":"BULL"},{"Ty":"SWP","CP":"C","K":410.0,"V":13520,"P":7098007,"E":"3/13","Si":"B","Co":"YELLOW","DTE":6,"Dt":"3/6","D":"BULL"},{"Ty":"BLK","CP":"C","K":410.0,"V":6000,"P":6600000,"E":"3/20","Si":"B","Co":"MAGENTA","DTE":17,"Dt":"3/2","D":"BULL"},{"Ty":"BLK","CP":"C","K":410.0,"V":6057,"P":6360108,"E":"3/20","Si":"BB","Co":"MAGENTA","DTE":17,"Dt":"3/2","D":"BULL"}],"c":[{"CP":"C","K":410.0,"E":"3/20","H":15,"P":30873528,"V":27137,"D":"BULL"},{"CP":"C","K":410.0,"E":"3/13","H":10,"P":25512060,"V":51178,"D":"BULL"},{"CP":"C","K":600.0,"E":"12/15/28","H":7,"P":16718499,"V":1804,"D":"BULL"}]},{"s":"MSFT","b":132769570,"r":13757493,"n":42,"t":[{"Ty":"BLK","CP":"C","K":625.0,"V":100000,"P":50500000,"E":"1/15/27","Si":"A","Co":"YELLOW","DTE":318,"Dt":"3/3","D":"BULL"},{"Ty":"BLK","CP":"C","K":575.0,"V":50000,"P":44000000,"E":"1/15/27","Si":"A","Co":"YELLOW","DTE":318,"Dt":"3/3","D":"BULL"},{"Ty":"BLK","CP":"C","K":675.0,"V":50000,"P":15000000,"E":"1/15/27","Si":"B","Co":"YELLOW","DTE":318,"Dt":"3/3","D":"BULL"},{"Ty":"BLK","CP":"C","K":675.0,"V":50000,"P":12250000,"E":"12/18","Si":"B","Co":"YELLOW","DTE":290,"Dt":"3/3","D":"BULL"}],"c":[{"CP":"C","K":410.0,"E":"4/2","H":6,"P":4388765,"V":3959,"D":"BULL"},{"CP":"P","K":405.0,"E":"4/2","H":4,"P":1863050,"V":1720,"D":"BEAR"},{"CP":"C","K":420.0,"E":"4/10","H":2,"P":1357080,"V":1228,"D":"BULL"}]},{"s":"NVDA","b":78513893,"r":67815589,"n":157,"t":[{"Ty":"BLK","CP":"C","K":150.0,"V":3000,"P":12000000,"E":"6/18","Si":"A","Co":"MAGENTA","DTE":107,"Dt":"3/2","D":"BULL"},{"Ty":"SWP","CP":"C","K":200.0,"V":30545,"P":9163679,"E":"4/2","Si":"AA","Co":"YELLOW","DTE":30,"Dt":"3/2","D":"BULL"},{"Ty":"BLK","CP":"P","K":200.0,"V":2950,"P":6434030,"E":"4/10","Si":"B","Co":"YELLOW","DTE":35,"Dt":"3/5","D":"BEAR"},{"Ty":"SWP","CP":"P","K":191.0,"V":1317,"P":4267080,"E":"12/18","Si":"B","Co":"YELLOW","DTE":288,"Dt":"3/5","D":"BEAR"}],"c":[{"CP":"C","K":200.0,"E":"4/2","H":12,"P":19716109,"V":65492,"D":"BULL"},{"CP":"P","K":175.0,"E":"12/15/28","H":8,"P":9794451,"V":2193,"D":"BEAR"},{"CP":"P","K":175.0,"E":"3/13","H":8,"P":6486279,"V":19288,"D":"BEAR"}]},{"s":"MU","b":76338384,"r":53133638,"n":127,"t":[{"Ty":"SWP","CP":"P","K":415.0,"V":5000,"P":10523610,"E":"3/13","Si":"BB","Co":"YELLOW","DTE":10,"Dt":"3/2","D":"BULL"},{"Ty":"BLK","CP":"P","K":385.0,"V":3616,"P":10124800,"E":"3/20","Si":"B","Co":"YELLOW","DTE":14,"Dt":"3/5","D":"BEAR"},{"Ty":"SWP","CP":"P","K":390.0,"V":2411,"P":6065885,"E":"3/20","Si":"BB","Co":"MAGENTA","DTE":15,"Dt":"3/4","D":"BULL"},{"Ty":"SWP","CP":"C","K":250.0,"V":310,"P":5099650,"E":"10/16","Si":"A","Co":"YELLOW","DTE":226,"Dt":"3/3","D":"BULL"}],"c":[{"CP":"C","K":430.0,"E":"3/20","H":20,"P":20846235,"V":18342,"D":"BULL"},{"CP":"P","K":385.0,"E":"3/20","H":2,"P":10512510,"V":3753,"D":"BEAR"},{"CP":"C","K":250.0,"E":"10/16","H":2,"P":9888520,"V":600,"D":"BULL"}]},{"s":"TSM","b":15665631,"r":31045072,"n":56,"t":[{"Ty":"BLK","CP":"P","K":350.0,"V":4000,"P":11080000,"E":"5/15","Si":"B","Co":"YELLOW","DTE":72,"Dt":"3/3","D":"BEAR"},{"Ty":"BLK","CP":"C","K":430.0,"V":1000,"P":2450000,"E":"9/18","Si":"B","Co":"YELLOW","DTE":196,"Dt":"3/5","D":"BULL"},{"Ty":"BLK","CP":"P","K":350.0,"V":389,"P":1647415,"E":"10/16","Si":"A","Co":"YELLOW","DTE":225,"Dt":"3/4","D":"BEAR"},{"Ty":"SWP","CP":"C","K":330.0,"V":435,"P":1635600,"E":"4/17","Si":"B","Co":"MAGENTA","DTE":44,"Dt":"3/3","D":"BULL"}],"c":[{"CP":"C","K":330.0,"E":"4/17","H":6,"P":5036140,"V":1337,"D":"BULL"},{"CP":"P","K":327.5,"E":"3/13","H":7,"P":4566757,"V":15467,"D":"BEAR"},{"CP":"P","K":500.0,"E":"12/18","H":2,"P":2967000,"V":200,"D":"BEAR"}]},{"s":"AVGO","b":14470383,"r":30708909,"n":74,"t":[{"Ty":"BLK","CP":"P","K":297.5,"V":15136,"P":4389440,"E":"3/13","Si":"B","Co":"YELLOW","DTE":7,"Dt":"3/5","D":"BEAR"},{"Ty":"SWP","CP":"C","K":340.0,"V":3588,"P":2870400,"E":"3/13","Si":"A","Co":"YELLOW","DTE":6,"Dt":"3/6","D":"BULL"},{"Ty":"SWP","CP":"P","K":260.0,"V":5901,"P":1963133,"E":"4/17","Si":"A","Co":"YELLOW","DTE":42,"Dt":"3/5","D":"BEAR"},{"Ty":"BLK","CP":"P","K":340.0,"V":500,"P":1960000,"E":"7/17","Si":"A","Co":"MAGENTA","DTE":132,"Dt":"3/6","D":"BEAR"}],"c":[{"CP":"P","K":297.5,"E":"3/13","H":8,"P":8493002,"V":29368,"D":"BEAR"},{"CP":"C","K":340.0,"E":"3/13","H":4,"P":4087749,"V":5060,"D":"BULL"},{"CP":"P","K":340.0,"E":"7/17","H":2,"P":2664309,"V":675,"D":"BEAR"}]},{"s":"GOOG","b":29146601,"r":10070950,"n":33,"t":[{"Ty":"BLK","CP":"C","K":350.0,"V":2050,"P":10803356,"E":"1/21/28","Si":"A","Co":"YELLOW","DTE":690,"Dt":"3/2","D":"BULL"},{"Ty":"BLK","CP":"P","K":300.0,"V":1500,"P":4314000,"E":"9/18","Si":"B","Co":"YELLOW","DTE":196,"Dt":"3/5","D":"BEAR"},{"Ty":"BLK","CP":"P","K":300.0,"V":1500,"P":4305000,"E":"9/18","Si":"A","Co":"YELLOW","DTE":196,"Dt":"3/5","D":"BEAR"},{"Ty":"SWP","CP":"P","K":280.0,"V":2639,"P":1534039,"E":"4/17","Si":"BB","Co":"MAGENTA","DTE":44,"Dt":"3/3","D":"BULL"}],"c":[{"CP":"P","K":300.0,"E":"9/18","H":2,"P":8619000,"V":3000,"D":"BEAR"},{"CP":"C","K":305.0,"E":"4/10","H":9,"P":7968730,"V":5592,"D":"BULL"},{"CP":"C","K":320.0,"E":"5/15","H":6,"P":4978818,"V":4264,"D":"BULL"}]},{"s":"AMZN","b":4564786,"r":32151694,"n":64,"t":[{"Ty":"SWP","CP":"P","K":205.0,"V":9091,"P":2722724,"E":"3/13","Si":"AA","Co":"YELLOW","DTE":6,"Dt":"3/6","D":"BEAR"},{"Ty":"SWP","CP":"P","K":200.0,"V":12010,"P":2390182,"E":"3/13","Si":"AA","Co":"YELLOW","DTE":6,"Dt":"3/6","D":"BEAR"},{"Ty":"SWP","CP":"P","K":200.0,"V":9935,"P":1979972,"E":"3/13","Si":"AA","Co":"MAGENTA","DTE":6,"Dt":"3/6","D":"BEAR"},{"Ty":"BLK","CP":"P","K":220.0,"V":490,"P":1651300,"E":"7/16/27","Si":"B","Co":"YELLOW","DTE":497,"Dt":"3/5","D":"BEAR"}],"c":[{"CP":"P","K":200.0,"E":"3/13","H":15,"P":10357214,"V":56597,"D":"BEAR"},{"CP":"P","K":205.0,"E":"3/13","H":10,"P":7506806,"V":30390,"D":"BEAR"},{"CP":"P","K":210.0,"E":"3/13","H":13,"P":5585076,"V":18273,"D":"BEAR"}]},{"s":"CRWV","b":11493917,"r":19469841,"n":31,"t":[{"Ty":"BLK","CP":"C","K":100.0,"V":1000,"P":3930000,"E":"12/15/28","Si":"B","Co":"YELLOW","DTE":1017,"Dt":"3/4","D":"BULL"},{"Ty":"BLK","CP":"P","K":70.0,"V":1650,"P":3085500,"E":"12/18","Si":"B","Co":"YELLOW","DTE":288,"Dt":"3/5","D":"BEAR"},{"Ty":"BLK","CP":"P","K":80.0,"V":600,"P":2400000,"E":"12/15/28","Si":"A","Co":"YELLOW","DTE":1018,"Dt":"3/3","D":"BEAR"},{"Ty":"BLK","CP":"P","K":37.5,"V":23500,"P":2068008,"E":"5/15","Si":"B","Co":"YELLOW","DTE":73,"Dt":"3/2","D":"BEAR"}],"c":[{"CP":"P","K":72.5,"E":"10/16","H":2,"P":2745000,"V":1500,"D":"BEAR"},{"CP":"P","K":80.0,"E":"3/13","H":2,"P":1099302,"V":1431,"D":"BEAR"},{"CP":"P","K":65.0,"E":"3/20","H":2,"P":959157,"V":4366,"D":"BEAR"}]},{"s":"AMD","b":13011791,"r":14555639,"n":33,"t":[{"Ty":"BLK","CP":"C","K":240.0,"V":3500,"P":7647500,"E":"11/20","Si":"B","Co":"YELLOW","DTE":262,"Dt":"3/3","D":"BULL"},{"Ty":"BLK","CP":"P","K":130.0,"V":1600,"P":2072000,"E":"3/19/27","Si":"A","Co":"YELLOW","DTE":380,"Dt":"3/3","D":"BEAR"},{"Ty":"BLK","CP":"P","K":150.0,"V":9999,"P":1979802,"E":"4/10","Si":"A","Co":"YELLOW","DTE":38,"Dt":"3/2","D":"BEAR"},{"Ty":"SWP","CP":"C","K":330.0,"V":604,"P":1866448,"E":"12/17/27","Si":"B","Co":"YELLOW","DTE":655,"Dt":"3/2","D":"BULL"}],"c":[{"CP":"C","K":195.0,"E":"3/13","H":2,"P":675250,"V":925,"D":"BULL"}]},{"s":"CRCL","b":21687757,"r":5430000,"n":31,"t":[{"Ty":"SWP","CP":"C","K":110.0,"V":949,"P":3274060,"E":"6/17/27","Si":"AA","Co":"YELLOW","DTE":467,"Dt":"3/6","D":"BULL"},{"Ty":"BLK","CP":"C","K":100.0,"V":1000,"P":3140000,"E":"1/15/27","Si":"A","Co":"MAGENTA","DTE":318,"Dt":"3/3","D":"BULL"},{"Ty":"SWP","CP":"C","K":100.0,"V":946,"P":2892050,"E":"1/15/27","Si":"A","Co":"MAGENTA","DTE":318,"Dt":"3/3","D":"BULL"},{"Ty":"BLK","CP":"P","K":100.0,"V":1781,"P":2778360,"E":"6/18","Si":"A","Co":"YELLOW","DTE":105,"Dt":"3/4","D":"BEAR"}],"c":[{"CP":"C","K":100.0,"E":"1/15/27","H":2,"P":6032050,"V":1946,"D":"BULL"},{"CP":"C","K":110.0,"E":"6/17/27","H":5,"P":5955245,"V":1728,"D":"BULL"},{"CP":"P","K":84.0,"E":"3/20","H":2,"P":489763,"V":1554,"D":"BEAR"}]},{"s":"NFLX","b":9233322,"r":15769139,"n":19,"t":[{"Ty":"BLK","CP":"P","K":98.0,"V":5000,"P":6150000,"E":"1/15/27","Si":"B","Co":"YELLOW","DTE":316,"Dt":"3/5","D":"BEAR"},{"Ty":"BLK","CP":"P","K":100.0,"V":3000,"P":4470000,"E":"3/19/27","Si":"A","Co":"YELLOW","DTE":381,"Dt":"3/2","D":"BEAR"},{"Ty":"BLK","CP":"C","K":95.0,"V":2250,"P":4252500,"E":"3/19/27","Si":"B","Co":"YELLOW","DTE":378,"Dt":"3/5","D":"BULL"},{"Ty":"SWP","CP":"C","K":97.0,"V":4170,"P":1605821,"E":"3/13","Si":"B","Co":"YELLOW","DTE":8,"Dt":"3/4","D":"BULL"}],"c":[{"CP":"C","K":125.0,"E":"9/18","H":3,"P":1479950,"V":4380,"D":"BULL"},{"CP":"P","K":98.0,"E":"3/13","H":2,"P":1163249,"V":4910,"D":"BEAR"},{"CP":"P","K":110.0,"E":"5/15","H":2,"P":456000,"V":300,"D":"BEAR"}]},{"s":"LITE","b":4856465,"r":19585978,"n":24,"t":[{"Ty":"SWP","CP":"P","K":800.0,"V":240,"P":4416000,"E":"6/18","Si":"A","Co":"MAGENTA","DTE":107,"Dt":"3/2","D":"BEAR"},{"Ty":"SWP","CP":"P","K":700.0,"V":96,"P":3379200,"E":"12/15/28","Si":"A","Co":"YELLOW","DTE":1016,"Dt":"3/5","D":"BEAR"},{"Ty":"SWP","CP":"P","K":640.0,"V":105,"P":2350950,"E":"1/15/27","Si":"A","Co":"YELLOW","DTE":316,"Dt":"3/5","D":"BEAR"},{"Ty":"SWP","CP":"P","K":630.0,"V":98,"P":2122678,"E":"1/15/27","Si":"A","Co":"YELLOW","DTE":316,"Dt":"3/5","D":"BEAR"}],"c":[{"CP":"P","K":800.0,"E":"6/18","H":2,"P":6236610,"V":339,"D":"BEAR"},{"CP":"P","K":720.0,"E":"3/20","H":3,"P":2661550,"V":483,"D":"BEAR"},{"CP":"P","K":750.0,"E":"3/20","H":2,"P":999990,"V":153,"D":"BEAR"}]},{"s":"AAPL","b":11833217,"r":6614512,"n":27,"t":[{"Ty":"BLK","CP":"C","K":270.0,"V":9970,"P":6979125,"E":"4/17","Si":"A","Co":"YELLOW","DTE":43,"Dt":"3/4","D":"BULL"},{"Ty":"BLK","CP":"P","K":260.0,"V":1500,"P":2791500,"E":"8/21","Si":"B","Co":"YELLOW","DTE":168,"Dt":"3/5","D":"BEAR"},{"Ty":"SWP","CP":"P","K":247.5,"V":2449,"P":857150,"E":"3/20","Si":"A","Co":"MAGENTA","DTE":13,"Dt":"3/6","D":"BEAR"},{"Ty":"SWP","CP":"C","K":267.5,"V":1747,"P":585239,"E":"3/13","Si":"A","Co":"YELLOW","DTE":10,"Dt":"3/2","D":"BULL"}],"c":[{"CP":"C","K":255.0,"E":"3/13","H":4,"P":1110030,"V":1286,"D":"BULL"},{"CP":"C","K":260.0,"E":"3/13","H":3,"P":1089157,"V":2701,"D":"BULL"},{"CP":"C","K":257.5,"E":"3/9","H":3,"P":822566,"V":2787,"D":"BULL"}]},{"s":"SNDK","b":8687983,"r":9634054,"n":37,"t":[{"Ty":"BLK","CP":"P","K":580.0,"V":180,"P":1548000,"E":"5/15","Si":"A","Co":"YELLOW","DTE":73,"Dt":"3/2","D":"BEAR"},{"Ty":"BLK","CP":"P","K":560.0,"V":130,"P":1384500,"E":"6/18","Si":"B","Co":"YELLOW","DTE":106,"Dt":"3/3","D":"BEAR"},{"Ty":"SWP","CP":"C","K":625.0,"V":115,"P":843483,"E":"4/2","Si":"A","Co":"YELLOW","DTE":30,"Dt":"3/2","D":"BULL"},{"Ty":"BLK","CP":"P","K":580.0,"V":135,"P":835650,"E":"4/17","Si":"B","Co":"YELLOW","DTE":45,"Dt":"3/2","D":"BEAR"}],"c":[{"CP":"C","K":610.0,"E":"3/20","H":5,"P":1700200,"V":552,"D":"BULL"},{"CP":"C","K":530.0,"E":"3/13","H":3,"P":1303000,"V":400,"D":"BULL"},{"CP":"C","K":595.0,"E":"3/20","H":2,"P":1024890,"V":283,"D":"BULL"}]},{"s":"META","b":10717761,"r":6743846,"n":42,"t":[{"Ty":"SWP","CP":"C","K":672.5,"V":1500,"P":1395000,"E":"3/13","Si":"A","Co":"YELLOW","DTE":7,"Dt":"3/5","D":"BULL"},{"Ty":"BLK","CP":"C","K":687.5,"V":1875,"P":1106250,"E":"3/13","Si":"A","Co":"YELLOW","DTE":8,"Dt":"3/4","D":"BULL"},{"Ty":"BLK","CP":"P","K":600.0,"V":220,"P":1100000,"E":"10/16","Si":"A","Co":"YELLOW","DTE":223,"Dt":"3/6","D":"BEAR"},{"Ty":"SWP","CP":"P","K":660.0,"V":579,"P":1097205,"E":"4/2","Si":"A","Co":"YELLOW","DTE":28,"Dt":"3/4","D":"BEAR"}],"c":[{"CP":"C","K":725.0,"E":"5/15","H":4,"P":1399670,"V":689,"D":"BULL"},{"CP":"C","K":650.0,"E":"3/13","H":4,"P":1285974,"V":796,"D":"BULL"},{"CP":"P","K":655.0,"E":"3/13","H":4,"P":982059,"V":681,"D":"BEAR"}]},{"s":"IREN","b":5370150,"r":12075031,"n":17,"t":[{"Ty":"BLK","CP":"P","K":35.0,"V":6000,"P":6000000,"E":"12/18","Si":"B","Co":"YELLOW","DTE":291,"Dt":"3/2","D":"BEAR"},{"Ty":"BLK","CP":"P","K":34.0,"V":4800,"P":3072000,"E":"7/17","Si":"B","Co":"YELLOW","DTE":132,"Dt":"3/6","D":"BEAR"},{"Ty":"SWP","CP":"C","K":30.0,"V":2921,"P":2818365,"E":"4/17","Si":"A","Co":"YELLOW","DTE":41,"Dt":"3/6","D":"BULL"},{"Ty":"SWP","CP":"P","K":42.0,"V":3330,"P":715936,"E":"3/13","Si":"B","Co":"YELLOW","DTE":8,"Dt":"3/4","D":"BEAR"}],"c":[{"CP":"P","K":34.0,"E":"7/17","H":2,"P":3712000,"V":5800,"D":"BEAR"},{"CP":"C","K":46.0,"E":"4/17","H":2,"P":488000,"V":1600,"D":"BULL"}]},{"s":"PLTR","b":6171142,"r":10061167,"n":33,"t":[{"Ty":"SWP","CP":"P","K":155.0,"V":2037,"P":1181231,"E":"3/13","Si":"A","Co":"YELLOW","DTE":8,"Dt":"3/4","D":"BEAR"},{"Ty":"BLK","CP":"P","K":100.0,"V":9520,"P":1170960,"E":"4/17","Si":"B","Co":"YELLOW","DTE":44,"Dt":"3/3","D":"BEAR"},{"Ty":"SWP","CP":"C","K":170.0,"V":2329,"P":1117852,"E":"4/2","Si":"A","Co":"YELLOW","DTE":26,"Dt":"3/6","D":"BULL"},{"Ty":"SWP","CP":"P","K":155.0,"V":1990,"P":855423,"E":"3/13","Si":"A","Co":"MAGENTA","DTE":6,"Dt":"3/6","D":"BEAR"}],"c":[{"CP":"P","K":155.0,"E":"3/13","H":4,"P":3539665,"V":8956,"D":"BEAR"},{"CP":"P","K":75.0,"E":"6/17/27","H":2,"P":640000,"V":1000,"D":"BEAR"},{"CP":"C","K":155.0,"E":"3/13","H":3,"P":634987,"V":1500,"D":"BULL"}]},{"s":"GLW","b":7982755,"r":8065136,"n":33,"t":[{"Ty":"BLK","CP":"P","K":130.0,"V":1050,"P":1862700,"E":"9/18","Si":"B","Co":"YELLOW","DTE":197,"Dt":"3/4","D":"BEAR"},{"Ty":"BLK","CP":"P","K":135.0,"V":900,"P":1242000,"E":"5/15","Si":"B","Co":"YELLOW","DTE":70,"Dt":"3/5","D":"BEAR"},{"Ty":"BLK","CP":"P","K":135.0,"V":690,"P":986700,"E":"6/18","Si":"A","Co":"YELLOW","DTE":105,"Dt":"3/4","D":"BEAR"},{"Ty":"BLK","CP":"P","K":135.0,"V":1080,"P":905040,"E":"4/17","Si":"B","Co":"YELLOW","DTE":43,"Dt":"3/4","D":"BEAR"}],"c":[{"CP":"C","K":160.0,"E":"4/17","H":3,"P":2109635,"V":2002,"D":"BULL"},{"CP":"C","K":190.0,"E":"4/17","H":4,"P":1457500,"V":5000,"D":"BULL"}]},{"s":"COHR","b":1591254,"r":13588443,"n":12,"t":[{"Ty":"SWP","CP":"P","K":290.0,"V":786,"P":3379957,"E":"4/17","Si":"B","Co":"YELLOW","DTE":43,"Dt":"3/4","D":"BEAR"},{"Ty":"SWP","CP":"P","K":300.0,"V":500,"P":2832797,"E":"6/18","Si":"B","Co":"YELLOW","DTE":107,"Dt":"3/2","D":"BEAR"},{"Ty":"BLK","CP":"P","K":300.0,"V":274,"P":1548100,"E":"6/18","Si":"B","Co":"YELLOW","DTE":107,"Dt":"3/2","D":"BEAR"},{"Ty":"SWP","CP":"P","K":300.0,"V":226,"P":1277854,"E":"6/18","Si":"B","Co":"YELLOW","DTE":107,"Dt":"3/2","D":"BEAR"}],"c":[{"CP":"P","K":300.0,"E":"6/18","H":4,"P":6692261,"V":1181,"D":"BEAR"},{"CP":"P","K":290.0,"E":"4/17","H":2,"P":4300157,"V":1000,"D":"BEAR"},{"CP":"C","K":410.0,"E":"6/18","H":2,"P":1364154,"V":563,"D":"BULL"}]},{"s":"GEV","b":3075907,"r":11971800,"n":22,"t":[{"Ty":"BLK","CP":"P","K":810.0,"V":409,"P":2936620,"E":"6/18","Si":"B","Co":"YELLOW","DTE":105,"Dt":"3/4","D":"BEAR"},{"Ty":"BLK","CP":"P","K":620.0,"V":1825,"P":1270200,"E":"4/17","Si":"B","Co":"YELLOW","DTE":42,"Dt":"3/5","D":"BEAR"},{"Ty":"BLK","CP":"P","K":800.0,"V":100,"P":1062000,"E":"10/16","Si":"A","Co":"YELLOW","DTE":226,"Dt":"3/3","D":"BEAR"},{"Ty":"BLK","CP":"P","K":645.0,"V":1330,"P":771400,"E":"4/10","Si":"B","Co":"YELLOW","DTE":35,"Dt":"3/5","D":"BEAR"}],"c":[{"CP":"C","K":805.0,"E":"3/20","H":2,"P":1173000,"V":300,"D":"BULL"},{"CP":"P","K":590.0,"E":"7/17","H":2,"P":1145200,"V":409,"D":"BEAR"},{"CP":"C","K":827.5,"E":"3/20","H":2,"P":973000,"V":200,"D":"BULL"}]},{"s":"ORCL","b":7126372,"r":7808847,"n":22,"t":[{"Ty":"BLK","CP":"P","K":165.0,"V":1200,"P":4596000,"E":"3/19/27","Si":"B","Co":"YELLOW","DTE":377,"Dt":"3/6","D":"BEAR"},{"Ty":"SWP","CP":"C","K":150.0,"V":811,"P":1029876,"E":"3/13","Si":"A","Co":"MAGENTA","DTE":7,"Dt":"3/5","D":"BULL"},{"Ty":"SWP","CP":"C","K":138.0,"V":442,"P":978395,"E":"3/20","Si":"A","Co":"YELLOW","DTE":13,"Dt":"3/6","D":"BULL"},{"Ty":"SWP","CP":"C","K":160.0,"V":851,"P":685061,"E":"3/13","Si":"AA","Co":"MAGENTA","DTE":6,"Dt":"3/6","D":"BULL"}],"c":[{"CP":"C","K":175.0,"E":"4/17","H":6,"P":2336054,"V":3857,"D":"BULL"}]},{"s":"AAOI","b":14176154,"r":609573,"n":25,"t":[{"Ty":"BLK","CP":"C","K":100.0,"V":400,"P":1880000,"E":"1/15/27","Si":"A","Co":"YELLOW","DTE":319,"Dt":"3/2","D":"BULL"},{"Ty":"SWP","CP":"C","K":75.0,"V":250,"P":1075000,"E":"6/18","Si":"B","Co":"YELLOW","DTE":107,"Dt":"3/2","D":"BULL"},{"Ty":"SWP","CP":"C","K":75.0,"V":250,"P":1072500,"E":"6/18","Si":"B","Co":"YELLOW","DTE":107,"Dt":"3/2","D":"BULL"},{"Ty":"SWP","CP":"C","K":75.0,"V":248,"P":1071360,"E":"6/18","Si":"B","Co":"YELLOW","DTE":107,"Dt":"3/2","D":"BULL"}],"c":[{"CP":"C","K":75.0,"E":"6/18","H":4,"P":3934960,"V":913,"D":"BULL"},{"CP":"C","K":150.0,"E":"9/18","H":3,"P":1534650,"V":489,"D":"BULL"},{"CP":"C","K":115.0,"E":"6/18","H":2,"P":1529700,"V":800,"D":"BULL"}]},{"s":"COIN","b":8737639,"r":5930317,"n":21,"t":[{"Ty":"BLK","CP":"C","K":185.0,"V":1200,"P":4417200,"E":"8/21","Si":"B","Co":"YELLOW","DTE":171,"Dt":"3/2","D":"BULL"},{"Ty":"BLK","CP":"C","K":180.0,"V":450,"P":2052000,"E":"6/18","Si":"A","Co":"YELLOW","DTE":104,"Dt":"3/5","D":"BULL"},{"Ty":"SWP","CP":"P","K":175.0,"V":573,"P":1681898,"E":"8/21","Si":"B","Co":"YELLOW","DTE":171,"Dt":"3/2","D":"BEAR"},{"Ty":"SWP","CP":"P","K":195.0,"V":838,"P":997339,"E":"4/17","Si":"B","Co":"YELLOW","DTE":42,"Dt":"3/5","D":"BEAR"}],"c":[{"CP":"C","K":225.0,"E":"3/13","H":4,"P":899300,"V":2000,"D":"BULL"},{"CP":"C","K":225.0,"E":"3/20","H":2,"P":539170,"V":1888,"D":"BULL"}]},{"s":"VRT","b":1637884,"r":12554954,"n":13,"t":[{"Ty":"BLK","CP":"P","K":270.0,"V":2045,"P":9075856,"E":"5/15","Si":"B","Co":"YELLOW","DTE":72,"Dt":"3/3","D":"BEAR"},{"Ty":"BLK","CP":"P","K":220.0,"V":2095,"P":1057975,"E":"3/13","Si":"B","Co":"YELLOW","DTE":6,"Dt":"3/6","D":"BEAR"},{"Ty":"BLK","CP":"P","K":175.0,"V":3560,"P":655040,"E":"4/17","Si":"B","Co":"YELLOW","DTE":44,"Dt":"3/3","D":"BEAR"},{"Ty":"BLK","CP":"P","K":225.0,"V":1240,"P":582800,"E":"3/20","Si":"A","Co":"YELLOW","DTE":14,"Dt":"3/5","D":"BEAR"}],"c":[{"CP":"P","K":225.0,"E":"3/20","H":2,"P":881686,"V":1693,"D":"BEAR"}]},{"s":"MSTR","b":7732967,"r":5946181,"n":25,"t":[{"Ty":"BLK","CP":"P","K":190.0,"V":199,"P":1870600,"E":"6/16/28","Si":"A","Co":"YELLOW","DTE":833,"Dt":"3/5","D":"BEAR"},{"Ty":"BLK","CP":"P","K":135.0,"V":200,"P":1082000,"E":"1/21/28","Si":"B","Co":"MAGENTA","DTE":686,"Dt":"3/6","D":"BEAR"},{"Ty":"SWP","CP":"C","K":130.0,"V":778,"P":1081526,"E":"3/20","Si":"B","Co":"MAGENTA","DTE":17,"Dt":"3/2","D":"BULL"},{"Ty":"SWP","CP":"C","K":140.0,"V":920,"P":805075,"E":"4/2","Si":"B","Co":"YELLOW","DTE":26,"Dt":"3/6","D":"BULL"}],"c":[{"CP":"P","K":140.0,"E":"3/27","H":2,"P":983500,"V":941,"D":"BEAR"}]},{"s":"BE","b":9185520,"r":4386858,"n":17,"t":[{"Ty":"BLK","CP":"P","K":120.0,"V":1319,"P":2321440,"E":"6/18","Si":"B","Co":"YELLOW","DTE":104,"Dt":"3/5","D":"BEAR"},{"Ty":"BLK","CP":"C","K":190.0,"V":1000,"P":2225000,"E":"5/15","Si":"B","Co":"YELLOW","DTE":71,"Dt":"3/4","D":"BULL"},{"Ty":"SWP","CP":"C","K":148.0,"V":765,"P":1147472,"E":"3/20","Si":"A","Co":"YELLOW","DTE":13,"Dt":"3/6","D":"BULL"},{"Ty":"BLK","CP":"C","K":135.0,"V":204,"P":1071000,"E":"11/20","Si":"B","Co":"YELLOW","DTE":259,"Dt":"3/6","D":"BULL"}],"c":[{"CP":"C","K":130.0,"E":"3/13","H":2,"P":1711290,"V":818,"D":"BULL"},{"CP":"C","K":140.0,"E":"3/13","H":2,"P":1074458,"V":508,"D":"BULL"},{"CP":"P","K":140.0,"E":"3/13","H":2,"P":531180,"V":756,"D":"BEAR"}]},{"s":"BABA","b":9238772,"r":3434655,"n":27,"t":[{"Ty":"BLK","CP":"C","K":130.0,"V":1750,"P":2644250,"E":"6/18","Si":"B","Co":"YELLOW","DTE":106,"Dt":"3/3","D":"BULL"},{"Ty":"BLK","CP":"P","K":110.0,"V":2516,"P":956080,"E":"6/18","Si":"B","Co":"YELLOW","DTE":103,"Dt":"3/6","D":"BEAR"},{"Ty":"SWP","CP":"P","K":130.0,"V":1174,"P":715993,"E":"3/27","Si":"A","Co":"YELLOW","DTE":20,"Dt":"3/6","D":"BEAR"},{"Ty":"BLK","CP":"C","K":140.0,"V":2000,"P":679700,"E":"4/2","Si":"A","Co":"YELLOW","DTE":27,"Dt":"3/5","D":"BULL"}],"c":[{"CP":"C","K":130.0,"E":"5/15","H":2,"P":1012831,"V":900,"D":"BULL"},{"CP":"C","K":160.0,"E":"1/15/27","H":3,"P":870000,"V":600,"D":"BULL"},{"CP":"C","K":145.0,"E":"8/21","H":2,"P":574372,"V":457,"D":"BULL"}]},{"s":"GOOGL","b":1752930,"r":10652828,"n":20,"t":[{"Ty":"BLK","CP":"P","K":265.0,"V":9963,"P":1793340,"E":"4/2","Si":"A","Co":"YELLOW","DTE":30,"Dt":"3/2","D":"BEAR"},{"Ty":"BLK","CP":"P","K":260.0,"V":1000,"P":1554000,"E":"11/20","Si":"B","Co":"YELLOW","DTE":263,"Dt":"3/2","D":"BEAR"},{"Ty":"BLK","CP":"P","K":215.0,"V":8888,"P":1510960,"E":"5/15","Si":"A","Co":"YELLOW","DTE":72,"Dt":"3/3","D":"BEAR"},{"Ty":"BLK","CP":"P","K":200.0,"V":2400,"P":1416000,"E":"12/18","Si":"B","Co":"YELLOW","DTE":290,"Dt":"3/3","D":"BEAR"}],"c":[{"CP":"P","K":245.0,"E":"1/21/28","H":3,"P":1013080,"V":394,"D":"BEAR"},{"CP":"C","K":300.0,"E":"3/13","H":2,"P":630000,"V":900,"D":"BULL"}]},{"s":"DAL","b":8606813,"r":2782397,"n":21,"t":[{"Ty":"BLK","CP":"C","K":67.5,"V":5000,"P":2100000,"E":"6/18","Si":"A","Co":"YELLOW","DTE":104,"Dt":"3/5","D":"BULL"},{"Ty":"BLK","CP":"C","K":62.0,"V":4999,"P":1449710,"E":"3/27","Si":"B","Co":"YELLOW","DTE":21,"Dt":"3/5","D":"BULL"},{"Ty":"SWP","CP":"C","K":65.0,"V":2001,"P":960468,"E":"6/18","Si":"BB","Co":"YELLOW","DTE":104,"Dt":"3/5","D":"BULL"},{"Ty":"BLK","CP":"P","K":52.5,"V":2500,"P":895000,"E":"6/18","Si":"A","Co":"YELLOW","DTE":104,"Dt":"3/5","D":"BEAR"}],"c":[{"CP":"C","K":65.0,"E":"6/18","H":2,"P":1840028,"V":4000,"D":"BULL"},{"CP":"C","K":65.0,"E":"3/19/27","H":2,"P":1210800,"V":1009,"D":"BULL"},{"CP":"C","K":70.0,"E":"4/17","H":3,"P":680337,"V":4082,"D":"BULL"}]},{"s":"ASML","b":4180210,"r":6949651,"n":15,"t":[{"Ty":"BLK","CP":"P","K":1400.0,"V":150,"P":3946500,"E":"12/18","Si":"B","Co":"YELLOW","DTE":287,"Dt":"3/6","D":"BEAR"},{"Ty":"BLK","CP":"C","K":1240.0,"V":100,"P":2645000,"E":"7/17","Si":"B","Co":"YELLOW","DTE":133,"Dt":"3/5","D":"BULL"},{"Ty":"SWP","CP":"P","K":1080.0,"V":98,"P":977060,"E":"11/20","Si":"B","Co":"YELLOW","DTE":259,"Dt":"3/6","D":"BEAR"},{"Ty":"BLK","CP":"C","K":1440.0,"V":220,"P":572000,"E":"3/13","Si":"B","Co":"YELLOW","DTE":8,"Dt":"3/4","D":"BULL"}],"c":[{"CP":"C","K":1500.0,"E":"4/10","H":2,"P":540960,"V":161,"D":"BULL"},{"CP":"P","K":1210.0,"E":"3/13","H":2,"P":447220,"V":615,"D":"BEAR"}]},{"s":"CRM","b":10565760,"r":252500,"n":6,"t":[{"Ty":"BLK","CP":"C","K":260.0,"V":4500,"P":5652000,"E":"1/15/27","Si":"B","Co":"YELLOW","DTE":317,"Dt":"3/4","D":"BULL"},{"Ty":"BLK","CP":"C","K":210.0,"V":1050,"P":2105250,"E":"9/18","Si":"B","Co":"YELLOW","DTE":199,"Dt":"3/2","D":"BULL"},{"Ty":"BLK","CP":"C","K":210.0,"V":1000,"P":2005000,"E":"9/18","Si":"A","Co":"YELLOW","DTE":199,"Dt":"3/2","D":"BULL"},{"Ty":"SWP","CP":"C","K":197.5,"V":580,"P":590930,"E":"3/20","Si":"A","Co":"YELLOW","DTE":14,"Dt":"3/5","D":"BULL"}],"c":[{"CP":"C","K":210.0,"E":"9/18","H":2,"P":4110250,"V":2050,"D":"BULL"}]},{"s":"POWL","b":10564695,"r":0,"n":5,"t":[{"Ty":"BLK","CP":"C","K":520.0,"V":251,"P":3313200,"E":"12/18","Si":"A","Co":"YELLOW","DTE":288,"Dt":"3/5","D":"BULL"},{"Ty":"BLK","CP":"C","K":440.0,"V":153,"P":2648430,"E":"12/18","Si":"A","Co":"MAGENTA","DTE":288,"Dt":"3/5","D":"BULL"},{"Ty":"BLK","CP":"C","K":520.0,"V":169,"P":2213900,"E":"12/18","Si":"A","Co":"YELLOW","DTE":288,"Dt":"3/5","D":"BULL"},{"Ty":"SWP","CP":"C","K":440.0,"V":122,"P":2131165,"E":"12/18","Si":"B","Co":"YELLOW","DTE":289,"Dt":"3/4","D":"BULL"}],"c":[{"CP":"C","K":520.0,"E":"12/18","H":2,"P":5527100,"V":420,"D":"BULL"},{"CP":"C","K":440.0,"E":"12/18","H":2,"P":4779595,"V":275,"D":"BULL"}]},{"s":"MRVL","b":3864943,"r":6382287,"n":15,"t":[{"Ty":"SWP","CP":"P","K":100.0,"V":1000,"P":1905000,"E":"9/18","Si":"A","Co":"YELLOW","DTE":195,"Dt":"3/6","D":"BEAR"},{"Ty":"BLK","CP":"P","K":95.0,"V":1000,"P":1650000,"E":"9/18","Si":"A","Co":"YELLOW","DTE":195,"Dt":"3/6","D":"BEAR"},{"Ty":"SWP","CP":"P","K":81.0,"V":2396,"P":1245795,"E":"3/20","Si":"A","Co":"YELLOW","DTE":17,"Dt":"3/2","D":"BEAR"},{"Ty":"SWP","CP":"C","K":80.0,"V":2309,"P":842849,"E":"3/13","Si":"B","Co":"YELLOW","DTE":7,"Dt":"3/5","D":"BULL"}],"c":[{"CP":"C","K":80.0,"E":"3/13","H":2,"P":1115472,"V":3180,"D":"BULL"},{"CP":"P","K":90.0,"E":"3/13","H":2,"P":585320,"V":1919,"D":"BEAR"}]},{"s":"UAL","b":7478231,"r":2643820,"n":15,"t":[{"Ty":"BLK","CP":"C","K":111.0,"V":10000,"P":1800000,"E":"3/13","Si":"B","Co":"YELLOW","DTE":9,"Dt":"3/3","D":"BULL"},{"Ty":"BLK","CP":"C","K":100.0,"V":1200,"P":1464000,"E":"5/15","Si":"B","Co":"YELLOW","DTE":72,"Dt":"3/3","D":"BULL"},{"Ty":"BLK","CP":"P","K":80.0,"V":1500,"P":1357500,"E":"9/18","Si":"A","Co":"YELLOW","DTE":195,"Dt":"3/6","D":"BEAR"},{"Ty":"BLK","CP":"C","K":111.0,"V":12772,"P":1021760,"E":"3/13","Si":"B","Co":"YELLOW","DTE":9,"Dt":"3/3","D":"BULL"}],"c":[{"CP":"C","K":111.0,"E":"3/13","H":5,"P":4498214,"V":40066,"D":"BULL"}]},{"s":"CRDO","b":3544385,"r":5863240,"n":15,"t":[{"Ty":"BLK","CP":"C","K":125.0,"V":1898,"P":1423500,"E":"3/27","Si":"B","Co":"YELLOW","DTE":24,"Dt":"3/2","D":"BULL"},{"Ty":"BLK","CP":"P","K":60.0,"V":15000,"P":1420138,"E":"4/17","Si":"B","Co":"YELLOW","DTE":44,"Dt":"3/3","D":"BEAR"},{"Ty":"SWP","CP":"P","K":90.0,"V":522,"P":1140310,"E":"1/15/27","Si":"AA","Co":"YELLOW","DTE":315,"Dt":"3/6","D":"BEAR"},{"Ty":"SWP","CP":"P","K":106.0,"V":1076,"P":710160,"E":"3/27","Si":"A","Co":"YELLOW","DTE":20,"Dt":"3/6","D":"BEAR"}],"c":[{"CP":"C","K":115.0,"E":"4/17","H":2,"P":1150905,"V":829,"D":"BULL"},{"CP":"C","K":105.0,"E":"5/15","H":2,"P":969980,"V":400,"D":"BULL"},{"CP":"P","K":85.0,"E":"6/18","H":2,"P":897390,"V":656,"D":"BEAR"}]},{"s":"NKE","b":7052701,"r":2271514,"n":11,"t":[{"Ty":"BLK","CP":"C","K":77.5,"V":20000,"P":5340000,"E":"1/15/27","Si":"B","Co":"YELLOW","DTE":316,"Dt":"3/5","D":"BULL"},{"Ty":"BLK","CP":"P","K":58.0,"V":9999,"P":1049895,"E":"3/13","Si":"A","Co":"YELLOW","DTE":9,"Dt":"3/3","D":"BEAR"},{"Ty":"SWP","CP":"C","K":57.0,"V":1335,"P":453900,"E":"4/2","Si":"B","Co":"YELLOW","DTE":26,"Dt":"3/6","D":"BULL"},{"Ty":"SWP","CP":"P","K":62.0,"V":1943,"P":442464,"E":"3/13","Si":"A","Co":"YELLOW","DTE":10,"Dt":"3/2","D":"BEAR"}],"c":[{"CP":"C","K":61.0,"E":"3/13","H":3,"P":824809,"V":5371,"D":"BULL"}]},{"s":"CRWD","b":5751895,"r":3401193,"n":22,"t":[{"Ty":"BLK","CP":"C","K":400.0,"V":500,"P":1052500,"E":"4/17","Si":"B","Co":"YELLOW","DTE":45,"Dt":"3/2","D":"BULL"},{"Ty":"BLK","CP":"P","K":310.0,"V":400,"P":688000,"E":"7/17","Si":"A","Co":"YELLOW","DTE":136,"Dt":"3/2","D":"BEAR"},{"Ty":"BLK","CP":"P","K":330.0,"V":561,"P":629526,"E":"5/15","Si":"B","Co":"YELLOW","DTE":71,"Dt":"3/4","D":"BEAR"},{"Ty":"SWP","CP":"C","K":385.0,"V":267,"P":536900,"E":"3/20","Si":"AA","Co":"YELLOW","DTE":17,"Dt":"3/2","D":"BULL"}],"c":[{"CP":"C","K":385.0,"E":"3/20","H":4,"P":1730760,"V":841,"D":"BULL"},{"CP":"C","K":390.0,"E":"4/17","H":2,"P":977045,"V":370,"D":"BULL"},{"CP":"P","K":400.0,"E":"3/13","H":2,"P":620079,"V":494,"D":"BEAR"}]},{"s":"SHOP","b":1882584,"r":7165516,"n":12,"t":[{"Ty":"BLK","CP":"P","K":85.0,"V":2000,"P":2516000,"E":"6/17/27","Si":"B","Co":"YELLOW","DTE":471,"Dt":"3/2","D":"BEAR"},{"Ty":"BLK","CP":"P","K":85.0,"V":2000,"P":2516000,"E":"6/17/27","Si":"B","Co":"YELLOW","DTE":471,"Dt":"3/2","D":"BEAR"},{"Ty":"SWP","CP":"C","K":133.0,"V":1076,"P":780100,"E":"3/20","Si":"A","Co":"YELLOW","DTE":13,"Dt":"3/6","D":"BULL"},{"Ty":"SWP","CP":"P","K":120.0,"V":1050,"P":614250,"E":"4/2","Si":"A","Co":"YELLOW","DTE":28,"Dt":"3/4","D":"BEAR"}],"c":[{"CP":"P","K":85.0,"E":"6/17/27","H":2,"P":5032000,"V":4000,"D":"BEAR"},{"CP":"C","K":260.0,"E":"12/18","H":2,"P":718070,"V":2000,"D":"BULL"}]},{"s":"GS","b":4546702,"r":3995818,"n":20,"t":[{"Ty":"BLK","CP":"C","K":900.0,"V":700,"P":1050018,"E":"3/20","Si":"B","Co":"MAGENTA","DTE":17,"Dt":"3/2","D":"BULL"},{"Ty":"BLK","CP":"C","K":795.0,"V":146,"P":807380,"E":"4/17","Si":"B","Co":"YELLOW","DTE":41,"Dt":"3/6","D":"BULL"},{"Ty":"SWP","CP":"P","K":845.0,"V":318,"P":715936,"E":"3/13","Si":"B","Co":"YELLOW","DTE":10,"Dt":"3/2","D":"BEAR"},{"Ty":"SWP","CP":"C","K":810.0,"V":142,"P":706729,"E":"3/13","Si":"AA","Co":"YELLOW","DTE":9,"Dt":"3/3","D":"BULL"}],"c":[{"CP":"C","K":900.0,"E":"3/20","H":2,"P":1369848,"V":886,"D":"BULL"}]},{"s":"CF","b":7830351,"r":364000,"n":7,"t":[{"Ty":"BLK","CP":"C","K":130.0,"V":3000,"P":3149932,"E":"1/15/27","Si":"A","Co":"YELLOW","DTE":316,"Dt":"3/5","D":"BULL"},{"Ty":"BLK","CP":"C","K":140.0,"V":2000,"P":2324000,"E":"1/15/27","Si":"A","Co":"YELLOW","DTE":315,"Dt":"3/6","D":"BULL"},{"Ty":"BLK","CP":"C","K":120.0,"V":1000,"P":1400000,"E":"9/18","Si":"A","Co":"YELLOW","DTE":195,"Dt":"3/6","D":"BULL"},{"Ty":"BLK","CP":"P","K":105.0,"V":400,"P":364000,"E":"6/18","Si":"A","Co":"YELLOW","DTE":105,"Dt":"3/4","D":"BEAR"}],"c":[{"CP":"C","K":120.0,"E":"9/18","H":2,"P":1720000,"V":1500,"D":"BULL"}]},{"s":"ASTS","b":3590670,"r":4603296,"n":18,"t":[{"Ty":"SWP","CP":"C","K":92.0,"V":1111,"P":898660,"E":"3/20","Si":"A","Co":"YELLOW","DTE":16,"Dt":"3/3","D":"BULL"},{"Ty":"SWP","CP":"P","K":93.0,"V":772,"P":863950,"E":"3/20","Si":"A","Co":"YELLOW","DTE":16,"Dt":"3/3","D":"BEAR"},{"Ty":"SWP","CP":"C","K":93.0,"V":1015,"P":780900,"E":"3/20","Si":"A","Co":"YELLOW","DTE":16,"Dt":"3/3","D":"BULL"},{"Ty":"SWP","CP":"P","K":91.0,"V":603,"P":605445,"E":"3/20","Si":"A","Co":"YELLOW","DTE":16,"Dt":"3/3","D":"BEAR"}],"c":[{"CP":"P","K":90.0,"E":"3/13","H":2,"P":607067,"V":2441,"D":"BEAR"}]},{"s":"MDB","b":5295233,"r":2789175,"n":14,"t":[{"Ty":"BLK","CP":"P","K":250.0,"V":469,"P":1519560,"E":"6/18","Si":"B","Co":"YELLOW","DTE":105,"Dt":"3/4","D":"BEAR"},{"Ty":"SWP","CP":"C","K":370.0,"V":335,"P":1239567,"E":"6/18","Si":"B","Co":"YELLOW","DTE":107,"Dt":"3/2","D":"BULL"},{"Ty":"SWP","CP":"C","K":330.0,"V":403,"P":1158490,"E":"3/20","Si":"AA","Co":"YELLOW","DTE":17,"Dt":"3/2","D":"BULL"},{"Ty":"BLK","CP":"P","K":230.0,"V":170,"P":748000,"E":"1/15/27","Si":"A","Co":"YELLOW","DTE":318,"Dt":"3/3","D":"BEAR"}],"c":[{"CP":"C","K":330.0,"E":"3/20","H":3,"P":2112800,"V":734,"D":"BULL"}]},{"s":"LLY","b":3946467,"r":3936594,"n":15,"t":[{"Ty":"SWP","CP":"C","K":1020.0,"V":276,"P":2577840,"E":"7/17","Si":"A","Co":"YELLOW","DTE":134,"Dt":"3/4","D":"BULL"},{"Ty":"SWP","CP":"P","K":1005.0,"V":148,"P":531320,"E":"3/20","Si":"A","Co":"YELLOW","DTE":15,"Dt":"3/4","D":"BEAR"},{"Ty":"BLK","CP":"P","K":860.0,"V":218,"P":516660,"E":"5/15","Si":"B","Co":"YELLOW","DTE":72,"Dt":"3/3","D":"BEAR"},{"Ty":"BLK","CP":"P","K":1005.0,"V":150,"P":498000,"E":"3/20","Si":"A","Co":"YELLOW","DTE":15,"Dt":"3/4","D":"BEAR"}],"c":[{"CP":"P","K":1005.0,"E":"3/20","H":2,"P":1029320,"V":298,"D":"BEAR"},{"CP":"C","K":1000.0,"E":"4/2","H":2,"P":662480,"V":182,"D":"BULL"}]},{"s":"APP","b":3100701,"r":4657060,"n":14,"t":[{"Ty":"BLK","CP":"P","K":490.0,"V":100,"P":1930000,"E":"1/21/28","Si":"B","Co":"YELLOW","DTE":690,"Dt":"3/2","D":"BEAR"},{"Ty":"BLK","CP":"C","K":550.0,"V":491,"P":1109660,"E":"4/17","Si":"B","Co":"MAGENTA","DTE":43,"Dt":"3/4","D":"BULL"},{"Ty":"SWP","CP":"P","K":450.0,"V":402,"P":777630,"E":"3/20","Si":"AA","Co":"MAGENTA","DTE":15,"Dt":"3/4","D":"BEAR"},{"Ty":"BLK","CP":"P","K":400.0,"V":587,"P":581130,"E":"3/13","Si":"A","Co":"MAGENTA","DTE":10,"Dt":"3/2","D":"BEAR"}],"c":[{"CP":"P","K":450.0,"E":"3/20","H":3,"P":1469530,"V":758,"D":"BEAR"},{"CP":"C","K":690.0,"E":"6/18","H":2,"P":649000,"V":220,"D":"BULL"}]},{"s":"SE","b":1659626,"r":6041887,"n":14,"t":[{"Ty":"BLK","CP":"P","K":80.0,"V":2000,"P":1970000,"E":"8/21","Si":"B","Co":"YELLOW","DTE":170,"Dt":"3/3","D":"BEAR"},{"Ty":"SWP","CP":"P","K":90.0,"V":489,"P":880221,"E":"12/18","Si":"AA","Co":"YELLOW","DTE":290,"Dt":"3/3","D":"BEAR"},{"Ty":"BLK","CP":"P","K":82.5,"V":500,"P":867500,"E":"1/15/27","Si":"B","Co":"YELLOW","DTE":318,"Dt":"3/3","D":"BEAR"},{"Ty":"SWP","CP":"C","K":105.0,"V":515,"P":511996,"E":"4/17","Si":"A","Co":"YELLOW","DTE":45,"Dt":"3/2","D":"BULL"}],"c":[{"CP":"P","K":80.0,"E":"8/21","H":2,"P":2242250,"V":2450,"D":"BEAR"},{"CP":"C","K":105.0,"E":"4/17","H":2,"P":719916,"V":741,"D":"BULL"}]},{"s":"MET","b":0,"r":7516000,"n":2,"t":[{"Ty":"BLK","CP":"P","K":77.5,"V":6000,"P":7140000,"E":"1/15/27","Si":"B","Co":"YELLOW","DTE":318,"Dt":"3/3","D":"BEAR"},{"Ty":"BLK","CP":"P","K":70.0,"V":800,"P":376000,"E":"5/15","Si":"A","Co":"YELLOW","DTE":72,"Dt":"3/3","D":"BEAR"}],"c":[]},{"s":"LRCX","b":1539101,"r":5491370,"n":11,"t":[{"Ty":"BLK","CP":"P","K":180.0,"V":1250,"P":1850000,"E":"6/18","Si":"B","Co":"MAGENTA","DTE":104,"Dt":"3/5","D":"BEAR"},{"Ty":"BLK","CP":"P","K":180.0,"V":600,"P":1152000,"E":"9/18","Si":"A","Co":"YELLOW","DTE":196,"Dt":"3/5","D":"BEAR"},{"Ty":"BLK","CP":"P","K":200.0,"V":300,"P":988500,"E":"12/18","Si":"B","Co":"YELLOW","DTE":289,"Dt":"3/4","D":"BEAR"},{"Ty":"SWP","CP":"P","K":190.0,"V":710,"P":596400,"E":"3/27","Si":"A","Co":"YELLOW","DTE":20,"Dt":"3/6","D":"BEAR"}],"c":[]},{"s":"NOW","b":1778378,"r":4937395,"n":11,"t":[{"Ty":"BLK","CP":"P","K":152.0,"V":500,"P":1695000,"E":"3/20","Si":"A","Co":"YELLOW","DTE":14,"Dt":"3/5","D":"BEAR"},{"Ty":"BLK","CP":"P","K":156.0,"V":280,"P":952000,"E":"3/20","Si":"A","Co":"YELLOW","DTE":13,"Dt":"3/6","D":"BEAR"},{"Ty":"SWP","CP":"P","K":100.0,"V":4267,"P":789395,"E":"3/20","Si":"B","Co":"YELLOW","DTE":17,"Dt":"3/2","D":"BEAR"},{"Ty":"BLK","CP":"P","K":154.0,"V":200,"P":638000,"E":"3/20","Si":"A","Co":"YELLOW","DTE":13,"Dt":"3/6","D":"BEAR"}],"c":[{"CP":"C","K":130.0,"E":"6/18","H":3,"P":803408,"V":1080,"D":"BULL"}]},{"s":"VST","b":817446,"r":5756510,"n":8,"t":[{"Ty":"BLK","CP":"P","K":155.0,"V":2738,"P":3967362,"E":"6/18","Si":"B","Co":"YELLOW","DTE":105,"Dt":"3/4","D":"BEAR"},{"Ty":"BLK","CP":"P","K":155.0,"V":450,"P":1120500,"E":"12/18","Si":"B","Co":"YELLOW","DTE":290,"Dt":"3/3","D":"BEAR"},{"Ty":"SWP","CP":"C","K":185.0,"V":500,"P":405591,"E":"5/15","Si":"A","Co":"YELLOW","DTE":72,"Dt":"3/3","D":"BULL"},{"Ty":"SWP","CP":"P","K":140.0,"V":315,"P":249220,"E":"5/15","Si":"AA","Co":"YELLOW","DTE":69,"Dt":"3/6","D":"BEAR"}],"c":[]}];
const ALL_SYMS=["TSLA", "MSFT", "NVDA", "MU", "TSM", "AVGO", "GOOG", "AMZN", "CRWV", "AMD", "CRCL", "NFLX", "LITE", "AAPL", "SNDK", "META", "IREN", "PLTR", "GLW", "COHR", "GEV", "ORCL", "AAOI", "COIN", "VRT", "MSTR", "BE", "BABA", "GOOGL", "DAL", "ASML", "CRM", "POWL", "MRVL", "UAL", "CRDO", "NKE", "CRWD", "SHOP", "GS", "CF", "ASTS", "MDB", "LLY", "APP", "SE", "MET", "LRCX", "NOW", "VST", "MARA", "WYNN", "PFE", "INTU", "DELL", "CAPR", "NBIS", "PANW", "RKLB", "IBM", "GGAL", "CVNA", "ALB", "AMPX", "CCJ", "ALK", "WDC", "XOM", "TTD", "INTC", "PEP", "WDAY", "OXY", "HOOD", "MOS", "RTX", "AG", "TPL", "AI", "BMNR", "DVN", "HON", "BRK.B", "ANET", "CIEN", "WMT", "JPM", "DAKT", "MS", "SOFI", "C", "CAT", "CP", "MRNA", "KKR", "CLS", "UNP", "TEAM", "STX", "HL", "KMB", "AMAT", "RBLX", "MPC", "CORZ", "HUT", "LMT", "PL", "V", "DIS", "LULU", "FSLR", "COP", "FCX", "CVX", "DKNG", "CVS", "NEM", "AVAV", "DDOG", "AXP", "B", "HPE", "CSCO", "HD", "ORA", "SMR", "QBTS", "SMCI", "EXPE", "GWRE", "DHT", "BSX", "ETN", "EQT", "SLB", "IONS", "DASH", "MRK", "TXN", "GM", "SATS", "APLD", "BAC", "LUV", "BURL", "AXTI", "GRAB", "BX", "COF", "TJX", "RCAT", "CDE", "GH", "CORT", "WFC", "ADBE", "TGT", "VZ", "MELI", "UNH", "SPOT", "MBLY", "NET", "MP", "CLX", "NVO", "ABNB", "UPS", "AA", "GLXY", "XYZ", "CIFR", "NXPI", "SNPS", "REAL", "DAVE", "OKLO", "DOW", "TECK", "AU", "ARES", "WPM", "LNG", "PDD", "VLO", "RH", "CMPX", "RF", "ALAB", "HBM", "FSK", "MMM", "EQX", "SCHW", "KTOS", "COST", "F", "NTR", "TLN", "BA", "VAL", "CROX", "FIG", "CTRA", "MDGL", "RIVN", "DXCM", "QURE", "PM", "TER", "TBPH", "WBD", "XPEV", "NEE", "RCL", "APGE", "ACMR", "FIGR", "HIMS", "ONDS", "CI", "HSY", "HUN", "DHI", "NOC", "VIK", "TTWO", "AER", "DY", "CEG", "VIAV", "GFI", "ANF", "FLG", "APO", "JBHT", "RDDT", "MAR", "FLUT", "MXEA", "IR", "BLK", "RIOT", "FHN", "REGN", "APA", "COMP", "GME", "BUD", "NOK", "AEIS", "VRTX", "FSLY", "CAH", "HAL", "DNN", "HOG", "NDXP", "VSCO", "UPST", "JNJ", "VNOM", "FANG", "PBR", "ADSK", "LEVI", "RKT", "SNOW", "UBER", "STNE", "MTZ", "XP", "PAAS", "NXE", "GLNG", "ARGX", "LAD", "ENPH", "MUX", "STUB", "CMG", "ON", "ARM", "HLT", "PAYC", "Q", "AXON", "TSEM", "GEO", "LI", "ISRG", "DE", "AEHR", "HWM", "SHW", "SHEL", "OKTA", "ONON", "VISN", "ASND", "BILL", "WHR", "INSM", "ZS", "U", "RL", "SOC", "CMPS", "CMI", "BBY", "FRO", "PCT", "LEU", "MDLZ", "BW", "JBLU", "SN", "CPRT", "CME", "CLMT", "QCOM", "AEO", "EBAY", "CRGY", "MITK", "HYMC", "APPN", "ECL", "KOPN", "MTW", "SAIA", "CL", "KGS", "TEL", "TDW", "LYB", "SEZL", "KRYS", "OVV", "USAS", "ACN", "SYY", "CELH", "CTRI", "FLGT", "STLD", "STM", "RRC", "ZIM", "FNV", "WIX", "ROKU", "CCL", "RGLD", "SOBO", "SSRM", "MA", "CHRD", "BBWI", "PATH", "LSCC", "HDB", "AS", "TIC", "WST", "MCD", "MRAM", "PIPR", "CAI", "NU", "AMT", "VET", "CHTR", "A", "TMO", "LHX", "CMCSA", "EXK", "ABBV", "AMKR", "COKE", "DUOL", "UNM", "DG", "SBUX", "TMUS", "USB", "SPT", "OLED", "EXC", "MDLN", "MT", "TPG", "AFRM", "MTDR", "ZETA", "RGTI", "EMR", "PBF", "UEC", "CRS", "WSM", "PG", "UUUU", "FTNT", "HSAI", "PCVX", "KLAR", "ASST", "PYPL", "SIMO", "DINO", "LYFT", "EL", "RYAAY", "RUN", "WULF", "ONTO", "AMPY", "BN", "BIDU", "UTHR", "AKAM", "GTLB", "FJET", "MLTX", "WMB"];

const TABS=["Market Read","Performance","Search","Short Term","Long Term","LEAPS","OI Watchlist"];
export default function OptionsFlow(){
  const[tab,setTab]=useState("Market Read");
  const[perf,setPerf]=useState(PERF_INIT.map(p=>({...p,now:0})));
  const[loading,setLoading]=useState(false);
  const[search,setSearch]=useState("");
  const[selectedTicker,setSelectedTicker]=useState(null);
  const[status,setStatus]=useState("");

  async function fetchPrices(){
    setLoading(true);
    setStatus("Fetching contract prices...");
    // Batch contracts into groups by ticker to minimize API calls
    const tickers = {};
    perf.forEach(p => {
      if(!tickers[p.sym]) tickers[p.sym] = [];
      tickers[p.sym].push(p);
    });
    const batches = [];
    let batch = [];
    Object.entries(tickers).forEach(([sym, contracts]) => {
      batch.push(...contracts);
      if(batch.length >= 6){
        batches.push([...batch]);
        batch = [];
      }
    });
    if(batch.length > 0) batches.push(batch);

    const updated = [...perf];
    for(let i = 0; i < batches.length; i++){
      const b = batches[i];
      setStatus(`Fetching batch ${i+1}/${batches.length} (${b.map(c=>c.sym).join(', ')})...`);
      const contractList = b.map(c =>
        `${c.sym} ${c.cp==="C"?"CALL":"PUT"} $${c.strike} exp ${c.exp}`
      ).join("\n");
      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            tools: [{"type":"web_search_20250305","name":"web_search"}],
            messages: [{
              role: "user",
              content: `Find the latest closing price (last traded price) for these option contracts. Search for each one. Return ONLY a JSON array, no other text, no markdown backticks. Each element: {"sym":"TICKER","cp":"C or P","strike":NUMBER,"price":NUMBER}

${contractList}`
            }]
          })
        });
        const data = await resp.json();
        const text = (data.content || []).filter(c=>c.type==="text").map(c=>c.text).join("");
        try {
          const clean = text.replace(/```json|```/g,"").trim();
          const jsonStart = clean.indexOf("[");
          const jsonEnd = clean.lastIndexOf("]");
          if(jsonStart >= 0 && jsonEnd > jsonStart){
            const prices = JSON.parse(clean.substring(jsonStart, jsonEnd+1));
            prices.forEach(p => {
              const match = updated.find(u =>
                u.sym === p.sym &&
                u.cp === p.cp &&
                u.strike === p.strike &&
                p.price > 0
              );
              if(match) match.now = p.price;
            });
          }
        } catch(e) {
          console.log("Parse error for batch", i, e, text);
        }
      } catch(e) {
        console.log("Fetch error for batch", i, e);
      }
      // Small delay between batches
      if(i < batches.length - 1) await new Promise(r => setTimeout(r, 1500));
    }
    setPerf(updated);
    setLoading(false);
    const filled = updated.filter(u => u.now > 0).length;
    setStatus(`Done. ${filled}/${updated.length} contracts priced.`);
  }
  return <div style={{background:P.bg,color:P.tx,fontFamily:"'SF Mono','Fira Code',monospace",minHeight:"100vh",padding:"16px 20px"}}>
    <div style={{maxWidth:1400,margin:"0 auto"}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
      <div style={{width:6,height:6,borderRadius:"50%",background:P.ac,boxShadow:`0 0 10px ${P.ac}`}}/>
      <h1 style={{fontSize:18,fontWeight:800,margin:0,color:P.wh}}>OPTIONS FLOW — MARKET READ</h1>
      <span style={{marginLeft:"auto",fontSize:10,color:P.mt,background:P.al,padding:"3px 10px",borderRadius:4}}>WEEK OF MAR 2–6 2026 · Expired removed</span>
    </div>
    <p style={{fontSize:10,color:P.mt,margin:"0 0 12px 16px"}}>8,783 live trades · 797 symbols · $5.4B · Confirmed (YELLOW/MAG) · No ML/ · No deep ITM · Expired 3/6 and prior removed</p>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
      <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:20,borderLeft:`4px solid ${P.bu}`}}>
        <div style={{fontSize:11,color:P.bu,fontWeight:700,letterSpacing:2,marginBottom:6,textTransform:"uppercase"}}>Short-Term Outlook</div>
        <div style={{fontSize:36,fontWeight:900,color:P.bu,marginBottom:8}}>BULLISH</div>
        <div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>0-14 DTE: Bull $237M vs Bear $210M. TSLA $410C 3/13 hit <strong style={{color:P.ac}}>10x</strong>. MU $430C 3/20 hit <strong style={{color:P.ac}}>20x</strong>. Bears: AMZN $200P 3/13 hit <strong style={{color:P.ac}}>15x at AA</strong>, AVGO $297.5P 8x.</div>
      </div>
      <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:20,borderLeft:`4px solid ${P.bu}`}}>
        <div style={{fontSize:11,color:P.bu,fontWeight:700,letterSpacing:2,marginBottom:6,textTransform:"uppercase"}}>Long-Term Outlook</div>
        <div style={{fontSize:36,fontWeight:900,color:P.bu,marginBottom:8}}>BULLISH</div>
        <div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>15+ DTE: Bull $772M vs Bear $582M. MSFT $575-$675C Jan 2027 ($122M). TSLA $410C 3/20 hit <strong style={{color:P.ac}}>15x at AA</strong>. Bears: LITE, COHR, VRT, GEV — fiber optics + power hedges.</div>
      </div>
    </div>

    <div style={{fontSize:10,fontWeight:700,color:P.dm,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>Top Conviction Strikes</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
      {CONV.map((t,i)=>{const c=t.dir==="BULL"?P.bu:P.be;return <div key={i} style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:8,padding:"10px 12px",borderTop:`2px solid ${c}`}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><span style={{fontSize:14,fontWeight:900,color:P.wh}}>{t.sym}</span>{t.side==="AA"?<Tag c={P.ac}>AA</Tag>:t.side==="BB"?<Tag c={P.be}>BB</Tag>:<Tag c={P.mt}>ASK</Tag>}</div><div style={{fontSize:13,fontWeight:800,color:c}}>{t.strike} <span style={{fontSize:11,fontWeight:700,color:P.wh}}>{t.exp}</span></div><div style={{fontSize:10,color:P.dm,marginTop:4}}><span style={{color:P.ac,fontWeight:700}}>{t.hits}x</span> · {fmt(t.prem)}</div><div style={{marginTop:4}}><Tag c={c}>{t.dir}</Tag></div></div>})}
    </div>

    <div style={{display:"flex",gap:1,marginBottom:14,background:P.al,borderRadius:6,padding:2,width:"fit-content"}}>
      {TABS.map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"6px 16px",borderRadius:5,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit",background:tab===t?P.cd:"transparent",color:tab===t?P.wh:P.mt}}>{t}</button>)}
    </div>

    {tab==="Market Read"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
      <Card title="Confirmed Daily Flow" sub="Bull vs Bear (live exps only)">
        <div style={{height:200}}><ResponsiveContainer><BarChart data={DAYS} margin={{top:5,right:8,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke={P.bd}/><XAxis dataKey="d" tick={{fill:P.tx,fontSize:10,fontWeight:600}} tickLine={false}/><YAxis tick={{fill:P.mt,fontSize:9}} tickLine={false} axisLine={false} tickFormatter={fmt} width={52}/><Tooltip content={({active,payload,label})=>{if(!active||!payload||!payload.length)return null;return <div style={{background:"#152038",border:`1px solid ${P.bl}`,borderRadius:6,padding:"8px 12px",fontSize:11}}><div style={{color:P.dm,fontWeight:600,marginBottom:4}}>{label}</div>{payload.map((p,i)=><div key={i} style={{color:p.color,display:"flex",gap:8,justifyContent:"space-between"}}><span>{p.name}</span><span style={{fontWeight:700,fontFamily:"monospace"}}>{fmt(Math.abs(p.value))}</span></div>)}</div>}}/><Bar dataKey="b" name="Bullish" fill={P.bu} radius={[3,3,0,0]} barSize={20}/><Bar dataKey="r" name="Bearish" fill={P.be} radius={[3,3,0,0]} barSize={20}/></BarChart></ResponsiveContainer></div>
      </Card>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Card title="Short-Term Bullish" sub="0-14 DTE"><NC data={SB_SYM} fill={P.bu} dir="bull"/></Card>
        <Card title="Short-Term Bearish" sub="0-14 DTE"><NC data={SR_SYM} fill={P.be} dir="bear"/></Card>
        <Card title="Long-Term Bullish" sub="15+ DTE"><NC data={LB_SYM} fill={P.bu} dir="bull"/></Card>
        <Card title="Long-Term Bearish" sub="15+ DTE"><NC data={LR_SYM} fill={P.be} dir="bear"/></Card>
      </div>
    </div>}

    {/* ═══ PERFORMANCE ═══ */}
    {tab==="Performance"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
      <Card>
        <div style={{display:"flex",gap:14,alignItems:"center"}}>
          <div style={{width:3,background:P.ac,borderRadius:2,alignSelf:"stretch",flexShrink:0}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:700,color:P.ac,marginBottom:5}}>Contract Performance Tracker</div>
            <div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>
              Entry is the contract price from the largest trade on each strike. Range shows the low-high across all hits.
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
            <button
              onClick={fetchPrices}
              disabled={loading}
              style={{
                padding:"8px 20px",borderRadius:6,border:"none",cursor:loading?"not-allowed":"pointer",
                fontSize:11,fontWeight:700,fontFamily:"inherit",letterSpacing:0.5,
                background:loading?P.bd:P.ac,color:loading?P.dm:P.bg,
                opacity:loading?0.6:1,
              }}
            >{loading ? "Fetching..." : "Refresh Prices"}</button>
            {status && <span style={{fontSize:9,color:loading?P.ac:P.dm}}>{status}</span>}
          </div>
        </div>
      </Card>
      {["Conviction","Short Bull","Short Bear","Long Bull","Long Bear","LEAPS Bull","LEAPS Bear"].map(cat => {
        const items = perf.filter(p => p.cat === cat);
        if (items.length === 0) return null;
        const catDir = cat.includes("Bull") ? "bull" : cat.includes("Bear") ? "bear" : "mixed";
        const catColor = catDir === "bull" ? P.bu : catDir === "bear" ? P.be : P.ac;
        return (
          <Card key={cat} title={cat} sub={`${items.length} contracts`}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
              <thead>
                <tr style={{borderBottom:`1px solid ${P.bd}`}}>
                  {["Ticker","C/P","Strike","Exp","Hits","Entry","Range","Now","P&L","P&L %","Dir"].map(h =>
                    <th key={h} style={{padding:"5px 5px",textAlign:"left",color:P.mt,fontSize:9,fontWeight:600}}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((r,i) => {
                  const curr = r.now || 0;
                  const pnl = curr > 0 ? curr - r.entry : 0;
                  const pnlPct = curr > 0 && r.entry > 0 ? ((curr - r.entry) / r.entry * 100) : 0;
                  const pnlColor = pnl > 0 ? P.bu : pnl < 0 ? P.be : P.dm;
                  return (
                    <tr key={r.id} style={{borderBottom:`1px solid ${P.bd}10`}}>
                      <td style={{padding:"5px 5px",fontWeight:800,color:P.wh}}>{r.sym}</td>
                      <td style={{padding:"5px 5px"}}><Tag c={r.cp==="C"?P.bu:P.be}>{r.cp}</Tag></td>
                      <td style={{padding:"5px 5px",fontWeight:800,color:P.wh}}>${r.strike}</td>
                      <td style={{padding:"5px 5px",fontWeight:800,color:P.wh}}>{r.exp}</td>
                      <td style={{padding:"5px 5px"}}><span style={{fontWeight:800,color:r.hits>=10?P.ac:r.hits>=5?P.ye:P.dm}}>{r.hits}x</span></td>
                      <td style={{padding:"5px 5px",fontWeight:700,color:P.wh}}>${r.entry.toFixed(2)}</td>
                      <td style={{padding:"5px 5px",fontSize:9,color:P.mt}}>${r.lo && r.lo !== r.hi ? `${r.lo.toFixed(2)}-${r.hi.toFixed(2)}` : "—"}</td>
                      <td style={{padding:"5px 5px"}}>
                        <input
                          type="number"
                          step="0.01"
                          value={curr || ""}
                          placeholder="—"
                          onChange={e => {
                            const v = parseFloat(e.target.value) || 0;
                            setPerf(prev => prev.map(p => p.id === r.id ? {...p, now: v} : p));
                          }}
                          style={{
                            width:70,padding:"3px 6px",borderRadius:4,fontSize:10,fontWeight:700,
                            background:P.al,border:`1px solid ${P.bl}`,color:P.wh,fontFamily:"inherit",
                            outline:"none",
                          }}
                        />
                      </td>
                      <td style={{padding:"5px 5px",fontWeight:700,color:pnlColor}}>
                        {curr > 0 ? `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}` : "—"}
                      </td>
                      <td style={{padding:"5px 5px",fontWeight:700,color:pnlColor}}>
                        {curr > 0 ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%` : "—"}
                      </td>
                      <td style={{padding:"5px 5px"}}><Tag c={r.dir==="BULL"?P.bu:P.be}>{r.dir}</Tag></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(() => {
              const filled = items.filter(r => r.now > 0);
              if (filled.length === 0) return null;
              const avgPnl = filled.reduce((s,r) => s + ((r.now - r.entry) / r.entry * 100), 0) / filled.length;
              const winners = filled.filter(r => r.now > r.entry).length;
              return (
                <div style={{display:"flex",gap:16,fontSize:10,marginTop:4,color:P.dm}}>
                  <span>Win rate: <strong style={{color:winners/filled.length>=0.5?P.bu:P.be}}>{winners}/{filled.length}</strong></span>
                  <span>Avg P&L: <strong style={{color:avgPnl>=0?P.bu:P.be}}>{avgPnl>=0?"+":""}{avgPnl.toFixed(1)}%</strong></span>
                </div>
              );
            })()}
          </Card>
        );
      })}
    </div>}


    {/* ═══ SEARCH ═══ */}
    {tab==="Search"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
      <Card>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <input
            type="text"
            value={search}
            onChange={e=>{
              const v=e.target.value.toUpperCase();
              setSearch(v);
              const found=TICKER_DB.find(t=>t.s===v);
              setSelectedTicker(found||null);
            }}
            placeholder="Enter ticker symbol (e.g. TSLA, NVDA, AMZN)"
            style={{flex:1,padding:"10px 16px",borderRadius:8,fontSize:13,fontWeight:600,
              background:P.al,border:`1px solid ${P.bl}`,color:P.wh,fontFamily:"inherit",
              outline:"none",letterSpacing:1}}
          />
          {search&&!selectedTicker&&<span style={{fontSize:10,color:P.mt}}>
            {ALL_SYMS.filter(s=>s.startsWith(search)).length>0
              ? ALL_SYMS.filter(s=>s.startsWith(search)).slice(0,8).join(", ")
              : "No matches"}
          </span>}
        </div>
        {search&&ALL_SYMS.filter(s=>s.startsWith(search)&&s!==search).length>0&&!selectedTicker&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
            {ALL_SYMS.filter(s=>s.startsWith(search)).slice(0,12).map(s=>(
              <button key={s} onClick={()=>{setSearch(s);setSelectedTicker(TICKER_DB.find(t=>t.s===s)||null);}}
                style={{padding:"3px 10px",borderRadius:4,border:`1px solid ${P.bl}`,background:P.cd,
                  color:TICKER_DB.find(t=>t.s===s)?P.wh:P.mt,fontSize:10,fontWeight:600,cursor:"pointer",
                  fontFamily:"inherit"}}>{s}</button>
            ))}
          </div>
        )}
      </Card>

      {selectedTicker&&(()=>{
        const tk=selectedTicker;
        const net=tk.b-tk.r;
        const dir=net>0?"BULL":"BEAR";
        const dirC=dir==="BULL"?P.bu:P.be;
        return <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:16,borderTop:`3px solid ${dirC}`}}>
              <div style={{fontSize:11,color:P.dm,marginBottom:4}}>Net Direction</div>
              <div style={{fontSize:28,fontWeight:900,color:dirC}}>{dir}</div>
              <div style={{fontSize:10,color:P.dm,marginTop:4}}>{tk.n} confirmed trades</div>
            </div>
            <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:16}}>
              <div style={{fontSize:11,color:P.dm,marginBottom:4}}>Bullish Flow</div>
              <div style={{fontSize:22,fontWeight:800,color:P.bu}}>{fmt(tk.b)}</div>
              <div style={{width:"100%",height:4,background:P.al,borderRadius:2,marginTop:8}}>
                <div style={{width:`${tk.b/(tk.b+tk.r)*100}%`,height:"100%",background:P.bu,borderRadius:2}}/>
              </div>
            </div>
            <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:16}}>
              <div style={{fontSize:11,color:P.dm,marginBottom:4}}>Bearish Flow</div>
              <div style={{fontSize:22,fontWeight:800,color:P.be}}>{fmt(tk.r)}</div>
              <div style={{width:"100%",height:4,background:P.al,borderRadius:2,marginTop:8}}>
                <div style={{width:`${tk.r/(tk.b+tk.r)*100}%`,height:"100%",background:P.be,borderRadius:2}}/>
              </div>
            </div>
          </div>

          <Card title={`${tk.s} — Top Confirmed Trades`} sub={`${tk.n} total`}>
            <TT rows={tk.t}/>
          </Card>

          {tk.c.length>0&&<Card title={`${tk.s} — Consistency (2+ hits)`}>
            <CT rows={tk.c}/>
          </Card>}
        </>;
      })()}

      {search&&!selectedTicker&&ALL_SYMS.includes(search)&&(
        <Card><div style={{textAlign:"center",padding:20,color:P.dm,fontSize:12}}>
          <strong style={{color:P.wh}}>{search}</strong> has confirmed flow but isn't in the top 50. Data available for: {TICKER_DB.map(t=>t.s).join(", ")}
        </div></Card>
      )}
    </div>}

    {tab==="Short Term"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Card title="Bullish Bets" sub="0-14 DTE"><NC data={SB_SYM} fill={P.bu} dir="bull"/></Card>
        <Card title="Bearish Bets" sub="0-14 DTE"><NC data={SR_SYM} fill={P.be} dir="bear"/></Card>
      </div>
      <Card title="Short-Term Bullish Trades" sub="$237M confirmed"><TT rows={SBL}/></Card>
      <Card title="Short-Term Bearish Trades" sub="$210M confirmed"><TT rows={SBR}/></Card>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Card title="Bullish Consistency" sub="2+ hits"><CT rows={SBLC}/></Card>
        <Card title="Bearish Consistency" sub="2+ hits"><CT rows={SBRC}/></Card>
      </div>
    </div>}

    {tab==="Long Term"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Card title="Bullish Bets" sub="15+ DTE"><NC data={LB_SYM} fill={P.bu} dir="bull"/></Card>
        <Card title="Bearish Bets" sub="15+ DTE"><NC data={LR_SYM} fill={P.be} dir="bear"/></Card>
      </div>
      <Card title="Long-Term Bullish Trades" sub="$772M confirmed"><TT rows={LBL}/></Card>
      <Card title="Long-Term Bearish Trades" sub="$582M confirmed"><TT rows={LBR_T}/></Card>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Card title="Bullish Consistency" sub="2+ hits"><CT rows={LBLC}/></Card>
        <Card title="Bearish Consistency" sub="2+ hits"><CT rows={LBRC}/></Card>
      </div>
    </div>}

    {tab==="LEAPS"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:20,borderLeft:`4px solid ${P.bu}`}}>
          <div style={{fontSize:11,color:P.bu,fontWeight:700,letterSpacing:2,marginBottom:6,textTransform:"uppercase"}}>LEAPS Bull Side</div>
          <div style={{fontSize:24,fontWeight:900,color:P.bu,marginBottom:4}}>$344M</div>
          <div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>211 trades. MSFT $120M in Jan 2027 LEAPS. TSLA $600C Dec 2028 hit <strong style={{color:P.ac}}>7x</strong>. CRCL, POWL, CRM, CF, PFE all pure-bull.</div>
        </div>
        <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:20,borderLeft:`4px solid ${P.be}`}}>
          <div style={{fontSize:11,color:P.be,fontWeight:700,letterSpacing:2,marginBottom:6,textTransform:"uppercase"}}>LEAPS Bear Side</div>
          <div style={{fontSize:24,fontWeight:900,color:P.be,marginBottom:4}}>$249M</div>
          <div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>248 trades. NVDA -$30M with $175P Dec 2028 hit <strong style={{color:P.ac}}>8x</strong>. LITE, CRWV, MET, WYNN, IREN — scattered hedging.</div>
        </div>
      </div>
      <Card title="LEAPS by Expiration" sub="180+ DTE">
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
          {[{exp:"1/15/2027",p:785943319,n:807,dte:"315d",names:"MSFT $120M, NVDA $70M, LITE $50M"},{exp:"1/21/2028",p:242011573,n:309,dte:"686d",names:"NVDA $30M, PLTR $19M, GOOG $12M"},{exp:"9/18/2026",p:232759424,n:365,dte:"195d",names:"NVDA $14M, GOOG $11M, MU $9M"},{exp:"12/18/2026",p:203289444,n:245,dte:"287d",names:"TSLA $24M, NVDA $21M, POWL $18M"},{exp:"12/15/2028",p:142823539,n:116,dte:"1015d",names:"NVDA $75M, TSLA $35M, CRWV $12M"},{exp:"12/17/2027",p:75487509,n:78,dte:"651d",names:"TSLA $27M, GOOG $16M, NVDA $9M"}].map((e,i)=><div key={i} style={{background:P.al,borderRadius:8,padding:"10px 12px",border:`1px solid ${P.bd}`}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}><span style={{fontSize:13,fontWeight:800,color:P.wh}}>{e.exp}</span><span style={{fontSize:9,color:P.mt}}>{e.dte}</span></div><div style={{fontSize:14,fontWeight:800,color:P.ac,marginBottom:4}}>{fmt(e.p)}</div><div style={{fontSize:9,color:P.dm}}>{e.n} trades · {e.names}</div></div>)}
        </div>
      </Card>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Card title="Bullish Bets" sub="180+ DTE"><NC data={LEAPS_B} fill={P.bu} dir="bull"/></Card>
        <Card title="Bearish Bets" sub="180+ DTE"><NC data={LEAPS_R} fill={P.be} dir="bear"/></Card>
      </div>
      <Card title="LEAPS Bullish Trades"><TT rows={LEAPS_BL_T}/></Card>
      <Card title="LEAPS Bearish Trades"><TT rows={LEAPS_BR_T}/></Card>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Card title="Bull Consistency" sub="2+ hits"><CT rows={LEAPS_BLC}/></Card>
        <Card title="Bear Consistency" sub="2+ hits"><CT rows={LEAPS_BRC}/></Card>
      </div>
    </div>}

    {tab==="OI Watchlist"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
      <Card><div style={{display:"flex",gap:14}}><div style={{width:3,background:P.uc,borderRadius:2,alignSelf:"stretch",flexShrink:0}}/><div><div style={{fontSize:13,fontWeight:700,color:P.uc,marginBottom:5}}>OI Check Needed</div><div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>$3.8B in WHITE unconfirmed trades this week. Check OI changes to confirm direction.</div></div></div></Card>
      <Card title="OI Watchlist" sub="Top unconfirmed by premium">
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}><thead><tr style={{borderBottom:`1px solid ${P.bd}`}}>{["Ticker","C/P","Strike","Exp","Type","Side","Vol","OI","Premium","Vol/OI"].map(h=><th key={h} style={{padding:"5px 4px",textAlign:"left",color:P.mt,fontSize:9,fontWeight:600}}>{h}</th>)}</tr></thead><tbody>{WATCH.map((r,i)=>{const pct=r.OI>0?Math.round(r.V/r.OI*100):999;return <tr key={i} style={{borderBottom:`1px solid ${P.bd}10`}}><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.S}</td><td style={{padding:"5px 4px"}}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>${r.K}</td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.E}</td><td style={{padding:"5px 4px"}}><Tag c={tc(r.Ty)}>{r.Ty}</Tag></td><td style={{padding:"5px 4px"}}>{r.Si==="BB"?<Tag c={P.be}>BB</Tag>:r.Si==="AA"?<Tag c={P.ac}>AA</Tag>:r.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>A</Tag>}</td><td style={{padding:"5px 4px",color:P.dm}}>{fK(r.V)}</td><td style={{padding:"5px 4px",color:P.dm}}>{fK(r.OI)}</td><td style={{padding:"5px 4px",fontWeight:700,color:P.wh}}>{fmt(r.P)}</td><td style={{padding:"5px 4px",fontWeight:600,color:pct>=80?P.ac:pct>=50?P.ye:P.dm}}>{pct}%</td></tr>})}</tbody></table>
      </Card>
    </div>}

    <div style={{marginTop:16,padding:"10px 0",borderTop:`1px solid ${P.bd}`,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:9,color:P.mt}}>Weekly Options Flow · Mar 2–6 2026 · Expired removed</span><span style={{fontSize:9,color:P.mt}}>YELLOW/MAG = confirmed · WHITE = check OI</span></div>
    </div>
  </div>;
}
