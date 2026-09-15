// game/scoring.js
// Přesná implementace zadaného bodovacího systému.

const SCORING = {
  KILL: 3.0,
  ASSIST: 2.0,
  DEATH: -1.5,
  CS_PER_UNIT: 0.02,
  VISION_PER_POINT: 0.1,
  TEAM_WIN: 2.0,
  FIRST_BLOOD: 2.0,
  QUADRA_KILL: 3.0,
  PENTA_KILL: 5.0,
};

/**
 * Spočítá fantasy body jednoho hráče na základě jeho zápasové statistiky.
 * @param {Object} stat - statistika hráče ze simulace zápasu
 * @param {number} stat.kills
 * @param {number} stat.deaths
 * @param {number} stat.assists
 * @param {number} stat.cs
 * @param {number} stat.visionScore
 * @param {boolean} stat.teamWon
 * @param {boolean} stat.firstBlood
 * @param {number} stat.quadraKills
 * @param {number} stat.pentaKills
 * @returns {number} fantasy body zaokrouhlené na 2 desetinná místa
 */
function calculateFantasyPoints(stat) {
  let points = 0;

  points += stat.kills * SCORING.KILL;
  points += stat.assists * SCORING.ASSIST;
  points += stat.deaths * SCORING.DEATH;
  points += stat.cs * SCORING.CS_PER_UNIT;
  points += stat.visionScore * SCORING.VISION_PER_POINT;

  if (stat.teamWon) points += SCORING.TEAM_WIN;
  if (stat.firstBlood) points += SCORING.FIRST_BLOOD;
  if (stat.quadraKills > 0) points += stat.quadraKills * SCORING.QUADRA_KILL;
  if (stat.pentaKills > 0) points += stat.pentaKills * SCORING.PENTA_KILL;

  return Math.round(points * 100) / 100;
}

module.exports = { SCORING, calculateFantasyPoints };
