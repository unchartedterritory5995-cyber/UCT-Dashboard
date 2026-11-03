---
id: expectancy
title: Expectancy
aliases: expectancy, win rate, average win, average loss, profit factor, positive expectancy, average r
observe: none
---
## What it is
Expectancy is the average result per trade over many trades, combining how often trades win with how large the wins are compared with the losses. In R terms it is the win rate multiplied by the average winning R, minus the loss rate multiplied by the average losing R. A positive figure means the approach has produced more than it lost on average across the sample; it says nothing about any single trade.

## What to look for
Count the trades in the sample and check it is large enough to mean something. Look at win rate and the ratio of average win to average loss together, since a low win rate can still carry a positive expectancy with large winners, and a high win rate can be negative with a few large losers. Watch whether the figures drift over time.

## Common mistakes
Judging an approach on a handful of trades. Focusing on win rate alone. Letting one outlier win or loss dominate the average without noticing. Computing expectancy on a mix of different setups and sizes and treating it as one number.

## Uncertainty
Expectancy measured on past trades is an estimate with wide error bars, especially on small samples, and conditions that produced it can change. A positive estimate can be followed by a long losing stretch, and a negative one can be sampling noise. It is a tool for review, not a forecast of the next trade.
