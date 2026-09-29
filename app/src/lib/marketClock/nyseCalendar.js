// app/src/lib/marketClock/nyseCalendar.js
//
// S11 (Session & Market Clock) — the versioned calendar dataset itself.
// product-architecture.md's S11 block: "a versioned calendar (published
// years ahead), shipped as code" (§4.1 evidence C7-02 §4.1/§4.2). NYSE
// publishes its full-year holiday + early-close schedule years in advance,
// so this is public, non-vendor information — no D1 dependency needed
// (product-architecture.md S11 row: "Dependencies: None on applications; D1
// only if the calendar is vendor-sourced" — it is not, here).
//
// ⛔ CORRECTION vs capability-infrastructure-matrix.md's own S11 row: that
// row names "NYSE's 2026 early closes (3 July, 27 November, 24 December)"
// as the dataset's shape. NYSE's actual published 2026 schedule has July 3
// as a FULL holiday closure (July 4 falls on a Saturday; NYSE observes the
// holiday on the preceding Friday as a full close, not a half day) — only
// November 27 (day after Thanksgiving) and December 24 (Christmas Eve) are
// early closes (1:00 PM ET). This is the one factual correction this S11
// slice makes to that document, per the contract-verification instruction
// ("if only minor documentation corrections are required, correct them and
// continue") — the data below reflects NYSE's real published calendar, not
// the matrix row's paraphrase of it.
//
// Coverage started at ONE year (2026) — "small, well-bounded" per the
// matrix's own sizing — and is extended by hand, one year at a time, well
// ahead of the prior year's Dec 31 cliff (Seam 7 architecture adjudication,
// 2026-09-07: `extSession.test.js`/`marketSession.dailypaint.test.js` pin
// the out-of-coverage degrade as intentional -- "no throw, no guess" -- but
// that degrade silently reintroduces Seam 6's exact defect class once a
// year's coverage lapses, so this table must stay at least one year ahead
// of `today`, not just "the current year"). A date outside `COVERED_YEARS`
// still degrades gracefully (see marketClock.js's `calendarCoverage` flag)
// rather than guessing a future year's holiday dates -- this is the safety
// net for a year nobody has added yet, not a substitute for adding it.
//
// `tests/test_nyse_calendar_parity.py` cross-checks every year here against
// `bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD` (the backend's own independently
// hand-maintained table) -- add a year to BOTH together, or the parity test
// fails on the year this table stops matching.
//
// ⭐⭐ 2026-09-28: EXTENDED BACK TO 1993 (closures) AND 2015 (half-days), and
// 2025 added -- it was in `nyse_calendar.py` and missing here, which the parity
// test could not see because it only walked the years THIS file declared (it now
// walks both sides). The evidence for every added date is in
// `api/services/nyse_calendar.py`'s docstring: the vendor's own SPY 1D and 60m
// history and the NYSE rules, two independent sources that agree date for date.
// Half-days are known from `EARLY_CLOSES_FROM` on; before it `earlyCloseOn`
// answers `null` = UNKNOWN, as it does outside `COVERED_YEARS`.
//
// ⛔⛔ AND WHAT TRADINGVIEW APPLIES IS WRITTEN DOWN HERE ONCE, NOT SUBTRACTED:
// `TRADINGVIEW_*` below, the same four facts as the Python module's, parity-
// tested. The chart's C8 clock reads `tradingViewCloseMinute`; everything else
// reads the NYSE truth through `holidayOn` / `earlyCloseOn` as before.

export const COVERED_YEARS = Object.freeze([
  1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 2002,
  2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012,
  2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022,
  2023, 2024, 2025, 2026, 2027,
])

/** The first date the half-day set is complete from (ISO, ET). Before it, a
 *  year's `earlyCloses` is `null` and `earlyCloseOn` answers `null`: unknown. */
export const EARLY_CLOSES_FROM = '2015-01-01'

// ── Full-day NYSE closures and 1:00 PM ET half-days, by year. ISO date strings
// (NYSE's own ET calendar date). GENERATED from the rules and checked against
// the vendor's history -- see the header. Unscheduled closures carry their event.
export const NYSE_HOLIDAYS_1993 = Object.freeze([
  { date: '1993-01-01', name: "New Year's Day" },
  { date: '1993-02-15', name: "Washington's Birthday" },
  { date: '1993-04-09', name: 'Good Friday' },
  { date: '1993-05-31', name: 'Memorial Day' },
  { date: '1993-07-05', name: 'Independence Day (observed)' },
  { date: '1993-09-06', name: 'Labor Day' },
  { date: '1993-11-25', name: 'Thanksgiving Day' },
  { date: '1993-12-24', name: 'Christmas Day (observed)' },
])

export const NYSE_HOLIDAYS_1994 = Object.freeze([
  { date: '1994-02-21', name: "Washington's Birthday" },
  { date: '1994-04-01', name: 'Good Friday' },
  { date: '1994-04-27', name: 'Nixon funeral (national day of mourning)' },
  { date: '1994-05-30', name: 'Memorial Day' },
  { date: '1994-07-04', name: 'Independence Day' },
  { date: '1994-09-05', name: 'Labor Day' },
  { date: '1994-11-24', name: 'Thanksgiving Day' },
  { date: '1994-12-26', name: 'Christmas Day (observed)' },
])

export const NYSE_HOLIDAYS_1995 = Object.freeze([
  { date: '1995-01-02', name: "New Year's Day (observed)" },
  { date: '1995-02-20', name: "Washington's Birthday" },
  { date: '1995-04-14', name: 'Good Friday' },
  { date: '1995-05-29', name: 'Memorial Day' },
  { date: '1995-07-04', name: 'Independence Day' },
  { date: '1995-09-04', name: 'Labor Day' },
  { date: '1995-11-23', name: 'Thanksgiving Day' },
  { date: '1995-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_1996 = Object.freeze([
  { date: '1996-01-01', name: "New Year's Day" },
  { date: '1996-02-19', name: "Washington's Birthday" },
  { date: '1996-04-05', name: 'Good Friday' },
  { date: '1996-05-27', name: 'Memorial Day' },
  { date: '1996-07-04', name: 'Independence Day' },
  { date: '1996-09-02', name: 'Labor Day' },
  { date: '1996-11-28', name: 'Thanksgiving Day' },
  { date: '1996-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_1997 = Object.freeze([
  { date: '1997-01-01', name: "New Year's Day" },
  { date: '1997-02-17', name: "Washington's Birthday" },
  { date: '1997-03-28', name: 'Good Friday' },
  { date: '1997-05-26', name: 'Memorial Day' },
  { date: '1997-07-04', name: 'Independence Day' },
  { date: '1997-09-01', name: 'Labor Day' },
  { date: '1997-11-27', name: 'Thanksgiving Day' },
  { date: '1997-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_1998 = Object.freeze([
  { date: '1998-01-01', name: "New Year's Day" },
  { date: '1998-01-19', name: 'Martin Luther King, Jr. Day' },
  { date: '1998-02-16', name: "Washington's Birthday" },
  { date: '1998-04-10', name: 'Good Friday' },
  { date: '1998-05-25', name: 'Memorial Day' },
  { date: '1998-07-03', name: 'Independence Day (observed)' },
  { date: '1998-09-07', name: 'Labor Day' },
  { date: '1998-11-26', name: 'Thanksgiving Day' },
  { date: '1998-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_1999 = Object.freeze([
  { date: '1999-01-01', name: "New Year's Day" },
  { date: '1999-01-18', name: 'Martin Luther King, Jr. Day' },
  { date: '1999-02-15', name: "Washington's Birthday" },
  { date: '1999-04-02', name: 'Good Friday' },
  { date: '1999-05-31', name: 'Memorial Day' },
  { date: '1999-07-05', name: 'Independence Day (observed)' },
  { date: '1999-09-06', name: 'Labor Day' },
  { date: '1999-11-25', name: 'Thanksgiving Day' },
  { date: '1999-12-24', name: 'Christmas Day (observed)' },
])

export const NYSE_HOLIDAYS_2000 = Object.freeze([
  { date: '2000-01-17', name: 'Martin Luther King, Jr. Day' },
  { date: '2000-02-21', name: "Washington's Birthday" },
  { date: '2000-04-21', name: 'Good Friday' },
  { date: '2000-05-29', name: 'Memorial Day' },
  { date: '2000-07-04', name: 'Independence Day' },
  { date: '2000-09-04', name: 'Labor Day' },
  { date: '2000-11-23', name: 'Thanksgiving Day' },
  { date: '2000-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_2001 = Object.freeze([
  { date: '2001-01-01', name: "New Year's Day" },
  { date: '2001-01-15', name: 'Martin Luther King, Jr. Day' },
  { date: '2001-02-19', name: "Washington's Birthday" },
  { date: '2001-04-13', name: 'Good Friday' },
  { date: '2001-05-28', name: 'Memorial Day' },
  { date: '2001-07-04', name: 'Independence Day' },
  { date: '2001-09-03', name: 'Labor Day' },
  { date: '2001-09-11', name: '9/11 attacks' },
  { date: '2001-09-12', name: '9/11 attacks' },
  { date: '2001-09-13', name: '9/11 attacks' },
  { date: '2001-09-14', name: '9/11 attacks' },
  { date: '2001-11-22', name: 'Thanksgiving Day' },
  { date: '2001-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_2002 = Object.freeze([
  { date: '2002-01-01', name: "New Year's Day" },
  { date: '2002-01-21', name: 'Martin Luther King, Jr. Day' },
  { date: '2002-02-18', name: "Washington's Birthday" },
  { date: '2002-03-29', name: 'Good Friday' },
  { date: '2002-05-27', name: 'Memorial Day' },
  { date: '2002-07-04', name: 'Independence Day' },
  { date: '2002-09-02', name: 'Labor Day' },
  { date: '2002-11-28', name: 'Thanksgiving Day' },
  { date: '2002-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_2003 = Object.freeze([
  { date: '2003-01-01', name: "New Year's Day" },
  { date: '2003-01-20', name: 'Martin Luther King, Jr. Day' },
  { date: '2003-02-17', name: "Washington's Birthday" },
  { date: '2003-04-18', name: 'Good Friday' },
  { date: '2003-05-26', name: 'Memorial Day' },
  { date: '2003-07-04', name: 'Independence Day' },
  { date: '2003-09-01', name: 'Labor Day' },
  { date: '2003-11-27', name: 'Thanksgiving Day' },
  { date: '2003-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_2004 = Object.freeze([
  { date: '2004-01-01', name: "New Year's Day" },
  { date: '2004-01-19', name: 'Martin Luther King, Jr. Day' },
  { date: '2004-02-16', name: "Washington's Birthday" },
  { date: '2004-04-09', name: 'Good Friday' },
  { date: '2004-05-31', name: 'Memorial Day' },
  { date: '2004-06-11', name: 'Reagan funeral (national day of mourning)' },
  { date: '2004-07-05', name: 'Independence Day (observed)' },
  { date: '2004-09-06', name: 'Labor Day' },
  { date: '2004-11-25', name: 'Thanksgiving Day' },
  { date: '2004-12-24', name: 'Christmas Day (observed)' },
])

export const NYSE_HOLIDAYS_2005 = Object.freeze([
  { date: '2005-01-17', name: 'Martin Luther King, Jr. Day' },
  { date: '2005-02-21', name: "Washington's Birthday" },
  { date: '2005-03-25', name: 'Good Friday' },
  { date: '2005-05-30', name: 'Memorial Day' },
  { date: '2005-07-04', name: 'Independence Day' },
  { date: '2005-09-05', name: 'Labor Day' },
  { date: '2005-11-24', name: 'Thanksgiving Day' },
  { date: '2005-12-26', name: 'Christmas Day (observed)' },
])

export const NYSE_HOLIDAYS_2006 = Object.freeze([
  { date: '2006-01-02', name: "New Year's Day (observed)" },
  { date: '2006-01-16', name: 'Martin Luther King, Jr. Day' },
  { date: '2006-02-20', name: "Washington's Birthday" },
  { date: '2006-04-14', name: 'Good Friday' },
  { date: '2006-05-29', name: 'Memorial Day' },
  { date: '2006-07-04', name: 'Independence Day' },
  { date: '2006-09-04', name: 'Labor Day' },
  { date: '2006-11-23', name: 'Thanksgiving Day' },
  { date: '2006-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_2007 = Object.freeze([
  { date: '2007-01-01', name: "New Year's Day" },
  { date: '2007-01-02', name: 'Ford funeral (national day of mourning)' },
  { date: '2007-01-15', name: 'Martin Luther King, Jr. Day' },
  { date: '2007-02-19', name: "Washington's Birthday" },
  { date: '2007-04-06', name: 'Good Friday' },
  { date: '2007-05-28', name: 'Memorial Day' },
  { date: '2007-07-04', name: 'Independence Day' },
  { date: '2007-09-03', name: 'Labor Day' },
  { date: '2007-11-22', name: 'Thanksgiving Day' },
  { date: '2007-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_2008 = Object.freeze([
  { date: '2008-01-01', name: "New Year's Day" },
  { date: '2008-01-21', name: 'Martin Luther King, Jr. Day' },
  { date: '2008-02-18', name: "Washington's Birthday" },
  { date: '2008-03-21', name: 'Good Friday' },
  { date: '2008-05-26', name: 'Memorial Day' },
  { date: '2008-07-04', name: 'Independence Day' },
  { date: '2008-09-01', name: 'Labor Day' },
  { date: '2008-11-27', name: 'Thanksgiving Day' },
  { date: '2008-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_2009 = Object.freeze([
  { date: '2009-01-01', name: "New Year's Day" },
  { date: '2009-01-19', name: 'Martin Luther King, Jr. Day' },
  { date: '2009-02-16', name: "Washington's Birthday" },
  { date: '2009-04-10', name: 'Good Friday' },
  { date: '2009-05-25', name: 'Memorial Day' },
  { date: '2009-07-03', name: 'Independence Day (observed)' },
  { date: '2009-09-07', name: 'Labor Day' },
  { date: '2009-11-26', name: 'Thanksgiving Day' },
  { date: '2009-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_2010 = Object.freeze([
  { date: '2010-01-01', name: "New Year's Day" },
  { date: '2010-01-18', name: 'Martin Luther King, Jr. Day' },
  { date: '2010-02-15', name: "Washington's Birthday" },
  { date: '2010-04-02', name: 'Good Friday' },
  { date: '2010-05-31', name: 'Memorial Day' },
  { date: '2010-07-05', name: 'Independence Day (observed)' },
  { date: '2010-09-06', name: 'Labor Day' },
  { date: '2010-11-25', name: 'Thanksgiving Day' },
  { date: '2010-12-24', name: 'Christmas Day (observed)' },
])

export const NYSE_HOLIDAYS_2011 = Object.freeze([
  { date: '2011-01-17', name: 'Martin Luther King, Jr. Day' },
  { date: '2011-02-21', name: "Washington's Birthday" },
  { date: '2011-04-22', name: 'Good Friday' },
  { date: '2011-05-30', name: 'Memorial Day' },
  { date: '2011-07-04', name: 'Independence Day' },
  { date: '2011-09-05', name: 'Labor Day' },
  { date: '2011-11-24', name: 'Thanksgiving Day' },
  { date: '2011-12-26', name: 'Christmas Day (observed)' },
])

export const NYSE_HOLIDAYS_2012 = Object.freeze([
  { date: '2012-01-02', name: "New Year's Day (observed)" },
  { date: '2012-01-16', name: 'Martin Luther King, Jr. Day' },
  { date: '2012-02-20', name: "Washington's Birthday" },
  { date: '2012-04-06', name: 'Good Friday' },
  { date: '2012-05-28', name: 'Memorial Day' },
  { date: '2012-07-04', name: 'Independence Day' },
  { date: '2012-09-03', name: 'Labor Day' },
  { date: '2012-10-29', name: 'Hurricane Sandy' },
  { date: '2012-10-30', name: 'Hurricane Sandy' },
  { date: '2012-11-22', name: 'Thanksgiving Day' },
  { date: '2012-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_2013 = Object.freeze([
  { date: '2013-01-01', name: "New Year's Day" },
  { date: '2013-01-21', name: 'Martin Luther King, Jr. Day' },
  { date: '2013-02-18', name: "Washington's Birthday" },
  { date: '2013-03-29', name: 'Good Friday' },
  { date: '2013-05-27', name: 'Memorial Day' },
  { date: '2013-07-04', name: 'Independence Day' },
  { date: '2013-09-02', name: 'Labor Day' },
  { date: '2013-11-28', name: 'Thanksgiving Day' },
  { date: '2013-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_2014 = Object.freeze([
  { date: '2014-01-01', name: "New Year's Day" },
  { date: '2014-01-20', name: 'Martin Luther King, Jr. Day' },
  { date: '2014-02-17', name: "Washington's Birthday" },
  { date: '2014-04-18', name: 'Good Friday' },
  { date: '2014-05-26', name: 'Memorial Day' },
  { date: '2014-07-04', name: 'Independence Day' },
  { date: '2014-09-01', name: 'Labor Day' },
  { date: '2014-11-27', name: 'Thanksgiving Day' },
  { date: '2014-12-25', name: 'Christmas Day' },
])

export const NYSE_HOLIDAYS_2015 = Object.freeze([
  { date: '2015-01-01', name: "New Year's Day" },
  { date: '2015-01-19', name: 'Martin Luther King, Jr. Day' },
  { date: '2015-02-16', name: "Washington's Birthday" },
  { date: '2015-04-03', name: 'Good Friday' },
  { date: '2015-05-25', name: 'Memorial Day' },
  { date: '2015-07-03', name: 'Independence Day (observed)' },
  { date: '2015-09-07', name: 'Labor Day' },
  { date: '2015-11-26', name: 'Thanksgiving Day' },
  { date: '2015-12-25', name: 'Christmas Day' },
])
export const NYSE_EARLY_CLOSES_2015 = Object.freeze([
  { date: '2015-11-27', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
  { date: '2015-12-24', name: 'Christmas Eve', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2016 = Object.freeze([
  { date: '2016-01-01', name: "New Year's Day" },
  { date: '2016-01-18', name: 'Martin Luther King, Jr. Day' },
  { date: '2016-02-15', name: "Washington's Birthday" },
  { date: '2016-03-25', name: 'Good Friday' },
  { date: '2016-05-30', name: 'Memorial Day' },
  { date: '2016-07-04', name: 'Independence Day' },
  { date: '2016-09-05', name: 'Labor Day' },
  { date: '2016-11-24', name: 'Thanksgiving Day' },
  { date: '2016-12-26', name: 'Christmas Day (observed)' },
])
export const NYSE_EARLY_CLOSES_2016 = Object.freeze([
  { date: '2016-11-25', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2017 = Object.freeze([
  { date: '2017-01-02', name: "New Year's Day (observed)" },
  { date: '2017-01-16', name: 'Martin Luther King, Jr. Day' },
  { date: '2017-02-20', name: "Washington's Birthday" },
  { date: '2017-04-14', name: 'Good Friday' },
  { date: '2017-05-29', name: 'Memorial Day' },
  { date: '2017-07-04', name: 'Independence Day' },
  { date: '2017-09-04', name: 'Labor Day' },
  { date: '2017-11-23', name: 'Thanksgiving Day' },
  { date: '2017-12-25', name: 'Christmas Day' },
])
export const NYSE_EARLY_CLOSES_2017 = Object.freeze([
  { date: '2017-07-03', name: 'Day before Independence Day', closeHour: 13, closeMinute: 0 },
  { date: '2017-11-24', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2018 = Object.freeze([
  { date: '2018-01-01', name: "New Year's Day" },
  { date: '2018-01-15', name: 'Martin Luther King, Jr. Day' },
  { date: '2018-02-19', name: "Washington's Birthday" },
  { date: '2018-03-30', name: 'Good Friday' },
  { date: '2018-05-28', name: 'Memorial Day' },
  { date: '2018-07-04', name: 'Independence Day' },
  { date: '2018-09-03', name: 'Labor Day' },
  { date: '2018-11-22', name: 'Thanksgiving Day' },
  { date: '2018-12-05', name: 'George H.W. Bush funeral (national day of mourning)' },
  { date: '2018-12-25', name: 'Christmas Day' },
])
export const NYSE_EARLY_CLOSES_2018 = Object.freeze([
  { date: '2018-07-03', name: 'Day before Independence Day', closeHour: 13, closeMinute: 0 },
  { date: '2018-11-23', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
  { date: '2018-12-24', name: 'Christmas Eve', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2019 = Object.freeze([
  { date: '2019-01-01', name: "New Year's Day" },
  { date: '2019-01-21', name: 'Martin Luther King, Jr. Day' },
  { date: '2019-02-18', name: "Washington's Birthday" },
  { date: '2019-04-19', name: 'Good Friday' },
  { date: '2019-05-27', name: 'Memorial Day' },
  { date: '2019-07-04', name: 'Independence Day' },
  { date: '2019-09-02', name: 'Labor Day' },
  { date: '2019-11-28', name: 'Thanksgiving Day' },
  { date: '2019-12-25', name: 'Christmas Day' },
])
export const NYSE_EARLY_CLOSES_2019 = Object.freeze([
  { date: '2019-07-03', name: 'Day before Independence Day', closeHour: 13, closeMinute: 0 },
  { date: '2019-11-29', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
  { date: '2019-12-24', name: 'Christmas Eve', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2020 = Object.freeze([
  { date: '2020-01-01', name: "New Year's Day" },
  { date: '2020-01-20', name: 'Martin Luther King, Jr. Day' },
  { date: '2020-02-17', name: "Washington's Birthday" },
  { date: '2020-04-10', name: 'Good Friday' },
  { date: '2020-05-25', name: 'Memorial Day' },
  { date: '2020-07-03', name: 'Independence Day (observed)' },
  { date: '2020-09-07', name: 'Labor Day' },
  { date: '2020-11-26', name: 'Thanksgiving Day' },
  { date: '2020-12-25', name: 'Christmas Day' },
])
export const NYSE_EARLY_CLOSES_2020 = Object.freeze([
  { date: '2020-11-27', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
  { date: '2020-12-24', name: 'Christmas Eve', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2021 = Object.freeze([
  { date: '2021-01-01', name: "New Year's Day" },
  { date: '2021-01-18', name: 'Martin Luther King, Jr. Day' },
  { date: '2021-02-15', name: "Washington's Birthday" },
  { date: '2021-04-02', name: 'Good Friday' },
  { date: '2021-05-31', name: 'Memorial Day' },
  { date: '2021-07-05', name: 'Independence Day (observed)' },
  { date: '2021-09-06', name: 'Labor Day' },
  { date: '2021-11-25', name: 'Thanksgiving Day' },
  { date: '2021-12-24', name: 'Christmas Day (observed)' },
])
export const NYSE_EARLY_CLOSES_2021 = Object.freeze([
  { date: '2021-11-26', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2022 = Object.freeze([
  { date: '2022-01-17', name: 'Martin Luther King, Jr. Day' },
  { date: '2022-02-21', name: "Washington's Birthday" },
  { date: '2022-04-15', name: 'Good Friday' },
  { date: '2022-05-30', name: 'Memorial Day' },
  { date: '2022-06-20', name: 'Juneteenth National Independence Day (observed)' },
  { date: '2022-07-04', name: 'Independence Day' },
  { date: '2022-09-05', name: 'Labor Day' },
  { date: '2022-11-24', name: 'Thanksgiving Day' },
  { date: '2022-12-26', name: 'Christmas Day (observed)' },
])
export const NYSE_EARLY_CLOSES_2022 = Object.freeze([
  { date: '2022-11-25', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2023 = Object.freeze([
  { date: '2023-01-02', name: "New Year's Day (observed)" },
  { date: '2023-01-16', name: 'Martin Luther King, Jr. Day' },
  { date: '2023-02-20', name: "Washington's Birthday" },
  { date: '2023-04-07', name: 'Good Friday' },
  { date: '2023-05-29', name: 'Memorial Day' },
  { date: '2023-06-19', name: 'Juneteenth National Independence Day' },
  { date: '2023-07-04', name: 'Independence Day' },
  { date: '2023-09-04', name: 'Labor Day' },
  { date: '2023-11-23', name: 'Thanksgiving Day' },
  { date: '2023-12-25', name: 'Christmas Day' },
])
export const NYSE_EARLY_CLOSES_2023 = Object.freeze([
  { date: '2023-07-03', name: 'Day before Independence Day', closeHour: 13, closeMinute: 0 },
  { date: '2023-11-24', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2024 = Object.freeze([
  { date: '2024-01-01', name: "New Year's Day" },
  { date: '2024-01-15', name: 'Martin Luther King, Jr. Day' },
  { date: '2024-02-19', name: "Washington's Birthday" },
  { date: '2024-03-29', name: 'Good Friday' },
  { date: '2024-05-27', name: 'Memorial Day' },
  { date: '2024-06-19', name: 'Juneteenth National Independence Day' },
  { date: '2024-07-04', name: 'Independence Day' },
  { date: '2024-09-02', name: 'Labor Day' },
  { date: '2024-11-28', name: 'Thanksgiving Day' },
  { date: '2024-12-25', name: 'Christmas Day' },
])
export const NYSE_EARLY_CLOSES_2024 = Object.freeze([
  { date: '2024-07-03', name: 'Day before Independence Day', closeHour: 13, closeMinute: 0 },
  { date: '2024-11-29', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
  { date: '2024-12-24', name: 'Christmas Eve', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2025 = Object.freeze([
  { date: '2025-01-01', name: "New Year's Day" },
  { date: '2025-01-09', name: 'Carter funeral (national day of mourning)' },
  { date: '2025-01-20', name: 'Martin Luther King, Jr. Day' },
  { date: '2025-02-17', name: "Washington's Birthday" },
  { date: '2025-04-18', name: 'Good Friday' },
  { date: '2025-05-26', name: 'Memorial Day' },
  { date: '2025-06-19', name: 'Juneteenth National Independence Day' },
  { date: '2025-07-04', name: 'Independence Day' },
  { date: '2025-09-01', name: 'Labor Day' },
  { date: '2025-11-27', name: 'Thanksgiving Day' },
  { date: '2025-12-25', name: 'Christmas Day' },
])
export const NYSE_EARLY_CLOSES_2025 = Object.freeze([
  { date: '2025-07-03', name: 'Day before Independence Day', closeHour: 13, closeMinute: 0 },
  { date: '2025-11-28', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
  { date: '2025-12-24', name: 'Christmas Eve', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2026 = Object.freeze([
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-19', name: 'Martin Luther King, Jr. Day' },
  { date: '2026-02-16', name: "Washington's Birthday" },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-05-25', name: 'Memorial Day' },
  { date: '2026-06-19', name: 'Juneteenth National Independence Day' },
  { date: '2026-07-03', name: 'Independence Day (observed)' },
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-11-26', name: 'Thanksgiving Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
])
export const NYSE_EARLY_CLOSES_2026 = Object.freeze([
  { date: '2026-11-27', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
  { date: '2026-12-24', name: 'Christmas Eve', closeHour: 13, closeMinute: 0 },
])

export const NYSE_HOLIDAYS_2027 = Object.freeze([
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-01-18', name: 'Martin Luther King, Jr. Day' },
  { date: '2027-02-15', name: "Washington's Birthday" },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-05-31', name: 'Memorial Day' },
  { date: '2027-06-18', name: 'Juneteenth National Independence Day (observed)' },
  { date: '2027-07-05', name: 'Independence Day (observed)' },
  { date: '2027-09-06', name: 'Labor Day' },
  { date: '2027-11-25', name: 'Thanksgiving Day' },
  { date: '2027-12-24', name: 'Christmas Day (observed)' },
])
export const NYSE_EARLY_CLOSES_2027 = Object.freeze([
  { date: '2027-11-26', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
])

const _BY_YEAR = Object.freeze({
  1993: Object.freeze({ holidays: NYSE_HOLIDAYS_1993, earlyCloses: null }),
  1994: Object.freeze({ holidays: NYSE_HOLIDAYS_1994, earlyCloses: null }),
  1995: Object.freeze({ holidays: NYSE_HOLIDAYS_1995, earlyCloses: null }),
  1996: Object.freeze({ holidays: NYSE_HOLIDAYS_1996, earlyCloses: null }),
  1997: Object.freeze({ holidays: NYSE_HOLIDAYS_1997, earlyCloses: null }),
  1998: Object.freeze({ holidays: NYSE_HOLIDAYS_1998, earlyCloses: null }),
  1999: Object.freeze({ holidays: NYSE_HOLIDAYS_1999, earlyCloses: null }),
  2000: Object.freeze({ holidays: NYSE_HOLIDAYS_2000, earlyCloses: null }),
  2001: Object.freeze({ holidays: NYSE_HOLIDAYS_2001, earlyCloses: null }),
  2002: Object.freeze({ holidays: NYSE_HOLIDAYS_2002, earlyCloses: null }),
  2003: Object.freeze({ holidays: NYSE_HOLIDAYS_2003, earlyCloses: null }),
  2004: Object.freeze({ holidays: NYSE_HOLIDAYS_2004, earlyCloses: null }),
  2005: Object.freeze({ holidays: NYSE_HOLIDAYS_2005, earlyCloses: null }),
  2006: Object.freeze({ holidays: NYSE_HOLIDAYS_2006, earlyCloses: null }),
  2007: Object.freeze({ holidays: NYSE_HOLIDAYS_2007, earlyCloses: null }),
  2008: Object.freeze({ holidays: NYSE_HOLIDAYS_2008, earlyCloses: null }),
  2009: Object.freeze({ holidays: NYSE_HOLIDAYS_2009, earlyCloses: null }),
  2010: Object.freeze({ holidays: NYSE_HOLIDAYS_2010, earlyCloses: null }),
  2011: Object.freeze({ holidays: NYSE_HOLIDAYS_2011, earlyCloses: null }),
  2012: Object.freeze({ holidays: NYSE_HOLIDAYS_2012, earlyCloses: null }),
  2013: Object.freeze({ holidays: NYSE_HOLIDAYS_2013, earlyCloses: null }),
  2014: Object.freeze({ holidays: NYSE_HOLIDAYS_2014, earlyCloses: null }),
  2015: Object.freeze({ holidays: NYSE_HOLIDAYS_2015, earlyCloses: NYSE_EARLY_CLOSES_2015 }),
  2016: Object.freeze({ holidays: NYSE_HOLIDAYS_2016, earlyCloses: NYSE_EARLY_CLOSES_2016 }),
  2017: Object.freeze({ holidays: NYSE_HOLIDAYS_2017, earlyCloses: NYSE_EARLY_CLOSES_2017 }),
  2018: Object.freeze({ holidays: NYSE_HOLIDAYS_2018, earlyCloses: NYSE_EARLY_CLOSES_2018 }),
  2019: Object.freeze({ holidays: NYSE_HOLIDAYS_2019, earlyCloses: NYSE_EARLY_CLOSES_2019 }),
  2020: Object.freeze({ holidays: NYSE_HOLIDAYS_2020, earlyCloses: NYSE_EARLY_CLOSES_2020 }),
  2021: Object.freeze({ holidays: NYSE_HOLIDAYS_2021, earlyCloses: NYSE_EARLY_CLOSES_2021 }),
  2022: Object.freeze({ holidays: NYSE_HOLIDAYS_2022, earlyCloses: NYSE_EARLY_CLOSES_2022 }),
  2023: Object.freeze({ holidays: NYSE_HOLIDAYS_2023, earlyCloses: NYSE_EARLY_CLOSES_2023 }),
  2024: Object.freeze({ holidays: NYSE_HOLIDAYS_2024, earlyCloses: NYSE_EARLY_CLOSES_2024 }),
  2025: Object.freeze({ holidays: NYSE_HOLIDAYS_2025, earlyCloses: NYSE_EARLY_CLOSES_2025 }),
  2026: Object.freeze({ holidays: NYSE_HOLIDAYS_2026, earlyCloses: NYSE_EARLY_CLOSES_2026 }),
  2027: Object.freeze({ holidays: NYSE_HOLIDAYS_2027, earlyCloses: NYSE_EARLY_CLOSES_2027 }),
})

function _yearOf(isoDate) {
  return Number(isoDate.slice(0, 4))
}

/** Whether `year` has real published-calendar coverage in this module. */
export function hasCoverage(year) {
  return Object.prototype.hasOwnProperty.call(_BY_YEAR, year)
}

/** `{name}` if `isoDate` (YYYY-MM-DD, ET calendar date) is a full NYSE
 *  holiday closure, else `null`. Returns `null` (not a guess) for a year
 *  outside coverage — the caller degrades via `calendarCoverage`. */
export function holidayOn(isoDate) {
  const year = _yearOf(isoDate)
  const table = _BY_YEAR[year]
  if (!table) return null
  const hit = table.holidays.find((h) => h.date === isoDate)
  return hit ? { name: hit.name } : null
}

/** `{name, closeHour, closeMinute}` if `isoDate` is an NYSE early-close
 *  trading day, else `null`. */
export function earlyCloseOn(isoDate) {
  const year = _yearOf(isoDate)
  const table = _BY_YEAR[year]
  if (!table) return null
  if (!table.earlyCloses) return null
  const hit = table.earlyCloses.find((e) => e.date === isoDate)
  return hit || null
}

// ── WHAT TRADINGVIEW'S SESSION APPLIES (2026-09-28) ─────────────────────────
// Mirrors `api/services/nyse_calendar.py`'s `TRADINGVIEW_*` block value for
// value (read that one for the measurements); `tests/test_nyse_calendar_parity.py`
// holds the two together. Standing owner rule: the chart draws exactly what
// TradingView draws, so the C8 clock columns read THIS view, not the NYSE truth:
//   * no closure before 2000 is in the vendor's session (a weekly bar reads
//     Monday 09:30 / Friday 16:00 on every week before 2000), nor September 11
//     2001 nor Hurricane Sandy 2012;
//   * no half-day before 2019 is, nor 2020-11-27 / 2020-12-24.
export const TRADINGVIEW_CLOSURES_FROM = '2000-01-01'
export const TRADINGVIEW_EARLY_CLOSES_FROM = '2019-01-01'
export const TRADINGVIEW_UNAPPLIED_CLOSURES = Object.freeze([
  { date: '2001-09-11', name: 'September 11' },
  { date: '2001-09-12', name: 'September 11' },
  { date: '2001-09-13', name: 'September 11' },
  { date: '2001-09-14', name: 'September 11' },
  { date: '2012-10-29', name: 'Hurricane Sandy' },
  { date: '2012-10-30', name: 'Hurricane Sandy' },
])
export const TRADINGVIEW_UNAPPLIED_EARLY_CLOSES = Object.freeze([
  { date: '2020-11-27', name: 'Day after Thanksgiving' },
  { date: '2020-12-24', name: 'Christmas Eve' },
])

const _ymd = (iso) => Number(iso.replace(/-/g, ''))
const _TV_UNAPPLIED_CLOSURES = new Set(TRADINGVIEW_UNAPPLIED_CLOSURES.map((e) => _ymd(e.date)))
const _TV_UNAPPLIED_EARLY = new Set(TRADINGVIEW_UNAPPLIED_EARLY_CLOSES.map((e) => _ymd(e.date)))
const _TV_CLOSURES_FROM = _ymd(TRADINGVIEW_CLOSURES_FROM)
const _TV_EARLY_FROM = _ymd(TRADINGVIEW_EARLY_CLOSES_FROM)
/** ⭐ DERIVED, NEVER TYPED: the vendor's view, as `YYYYMMDD` numbers so a
 *  per-bar lookup is one `Set.has`. */
const _TV_CLOSURES = new Set()
const _TV_EARLY = new Map()
for (const year of COVERED_YEARS) {
  const table = _BY_YEAR[year]
  for (const h of table.holidays) {
    const k = _ymd(h.date)
    if (k >= _TV_CLOSURES_FROM && !_TV_UNAPPLIED_CLOSURES.has(k)) _TV_CLOSURES.add(k)
  }
  for (const e of table.earlyCloses || []) {
    const k = _ymd(e.date)
    if (k >= _TV_EARLY_FROM && !_TV_UNAPPLIED_EARLY.has(k)) _TV_EARLY.set(k, e.closeHour * 60 + e.closeMinute)
  }
}

/** The regular session in New York, minutes after midnight. */
export const SESSION_OPEN_MINUTE = 9 * 60 + 30
export const SESSION_CLOSE_MINUTE = 16 * 60

/** The vendor's regular-session close on `ymd` (a `YYYYMMDD` number), in
 *  minutes after midnight New York -- 780 on a half-day it applies, else 960 --
 *  or `null` when its session holds no trading that day: a Saturday, a Sunday,
 *  or a closure it applies. Mirrors `nyse_calendar.tradingview_close_minute`. */
export function tradingViewCloseMinute(ymd) {
  const y = Math.floor(ymd / 10000)
  const m = Math.floor(ymd / 100) % 100
  const d = ymd % 100
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (dow === 0 || dow === 6 || _TV_CLOSURES.has(ymd)) return null
  return _TV_EARLY.has(ymd) ? _TV_EARLY.get(ymd) : SESSION_CLOSE_MINUTE
}
