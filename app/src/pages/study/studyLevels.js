// A member's level and its tier, from their own XP (study_store.XP_PER_LEVEL: level = 1 + xp // 500). The tiers share the
// medals' names (Bronze to Legend), so a level reads the same way a run's medal does.
export const XP_PER_LEVEL = 500
const TIERS = [[35, 'Legend'], [20, 'Platinum'], [10, 'Gold'], [5, 'Silver'], [1, 'Bronze']]
export const levelOf = (xp) => 1 + Math.floor(Math.max(0, Number(xp) || 0) / XP_PER_LEVEL)
export const tierOf = (level) => (TIERS.find(([min]) => level >= min) || TIERS[TIERS.length - 1])[1]
