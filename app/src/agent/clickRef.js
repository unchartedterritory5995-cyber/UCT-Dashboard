// A noun phrase that names the member's OWN click or selection by the act itself (#988, pl-grid's find): "the one I clicked",
// "the chart I'm on", "the one I've got selected", "my selected chart". Shared by the negation readers (deixis.js NEG_POINTER,
// spatialCheck.js NEG_CLICK / excludedCharts) so that a negation of any of them EXCLUDES the click, as "not this one" does.
// A regex SOURCE string, no lookbehind (iOS 16 floor; agentNoLookbehindStrings.test.js).
const NOUN = '(?:one|chart|cell|pane|panel|graph)'
const ACT = '(?:clicked|selected|picked|chose|chosen|highlighted|tapped|marked)'
export const CLICK_ACT_NP = '(?:'
  // the one (that) I clicked / I've selected / I have picked / I just clicked on / I've got selected / you selected
  + `the\\s+${NOUN}\\s+(?:that\\s+|which\\s+)?(?:i|you)(?:['’]ve|\\s+have|\\s+had|['’]d)?\\s+(?:just\\s+)?(?:got\\s+)?${ACT}(?:\\s+on)?`
  // the chart I'm on / I am in / I'm looking at / I'm viewing / I'm working on
  + `|the\\s+${NOUN}\\s+(?:that\\s+|which\\s+)?i(?:['’]m|\\s+am)\\s+(?:on|in|at|looking\\s+at|viewing|working\\s+(?:on|in))`
  // my selected / clicked / current / active chart
  + `|my\\s+(?:selected|clicked|current|active|highlighted)\\s+${NOUN}`
  + ')'
// the negation operators that govern such a phrase as their object
export const NEGATION_OP = '(?:not|never|except(?:\\s+for)?|other\\s+than|besides|apart\\s+from|aside\\s+from|excluding|minus|save\\s+for|instead\\s+of|rather\\s+than)'
