// THE TROPHIES a member can earn (the server grants them in study_store.record_attempt 4b, from the member's own record;
// BADGE_STREAKS and BADGE_LEVELS there). The shelf shows every one: the earned lit, the rest locked with how to earn them.
export const TROPHIES = [
  { id: 'first_set', name: 'First set', how: 'Finish your first daily set', icon: 'star' },
  { id: 'perfect_set', name: 'Perfect set', how: 'Every answer right in a daily set', icon: 'check' },
  { id: 'streak_3', name: '3-day streak', how: 'Study three days in a row', icon: 'flame' },
  { id: 'streak_7', name: '7-day streak', how: 'Study seven days in a row', icon: 'flame' },
  { id: 'streak_30', name: '30-day streak', how: 'Study thirty days in a row', icon: 'flame' },
  { id: 'level_5', name: 'Level 5', how: 'Reach Level 5 (Silver)', icon: 'shield' },
  { id: 'level_10', name: 'Level 10', how: 'Reach Level 10 (Gold)', icon: 'shield' },
  { id: 'level_20', name: 'Level 20', how: 'Reach Level 20 (Platinum)', icon: 'shield' },
]
