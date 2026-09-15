// game/simulator.js
// Jádro hry: simulateMatch(teamAPlayers, teamBPlayers)
// Vstupem jsou dvě pole po 5 pro-hráčích (objekty z data/players.js).
// Výstupem je kompletní výsledek zápasu včetně per-hráčských statistik
// a jejich fantasy bodů (viz game/scoring.js).
//
// Simulace probíhá ve 3 fázích:
//   Fáze 1: Early Game (Laning Phase)  -> určí Gold Lead (early game výhodu)
//   Fáze 2: Mid/Late Game (Teamfighty) -> určí vítěze zápasu
//   Fáze 3: Individual Stats           -> K/D/A, CS, Vision, objektivy, FB, multikilly

const { calculateFantasyPoints } = require('./scoring');

// ---------------------------------------------------------------------
// Pomocné matematické funkce
// ---------------------------------------------------------------------

// Gaussovské (přibližně normální) rozdělení pomocí Box-Muller transformace.
function gaussianRandom(mean = 0, stdev = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdev + mean;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Odchylka výkonu závisí na Consistency (c): čím nižší c, tím vyšší
// směrodatná odchylka (větší "coinflip" faktor dne).
// c = 100 -> stdev ≈ 0 (žádná odchylka)
// c = 1   -> stdev ≈ ~20 bodů (velký rozptyl)
function getPerformanceStdev(c) {
  const MAX_STDEV = 20;
  return ((100 - c) / 100) * MAX_STDEV;
}

// Efektivní Fighting Power hráče pro tento zápas: základ (m) + náhodná
// odchylka odvozená z Consistency, ořezaná na 1-99.
function getEffectiveFightingPower(m, c) {
  const stdev = getPerformanceStdev(c);
  const roll = gaussianRandom(0, stdev);
  return clamp(Math.round(m + roll), 1, 99);
}

// ---------------------------------------------------------------------
// FÁZE 1: Early Game (Laning Phase)
// ---------------------------------------------------------------------
// Týmové Laning Power = součet LP všech 5 hráčů + jeden náhodný team-roll
// (-15 až +15), reprezentující variabilitu lane matchupů/prvních 15 minut.
// Tým s vyšším skóre získává Gold Lead v 15. minutě.

const LANING_ROLL_RANGE = 15; // -15 až +15

function simulateEarlyGame(teamAPlayers, teamBPlayers) {
  const baseLP_A = teamAPlayers.reduce((sum, p) => sum + p.lp, 0);
  const baseLP_B = teamBPlayers.reduce((sum, p) => sum + p.lp, 0);

  const rollA = randInt(-LANING_ROLL_RANGE, LANING_ROLL_RANGE);
  const rollB = randInt(-LANING_ROLL_RANGE, LANING_ROLL_RANGE);

  const scoreA = baseLP_A + rollA;
  const scoreB = baseLP_B + rollB;

  let goldLeadTeam;
  if (scoreA === scoreB) {
    goldLeadTeam = Math.random() < 0.5 ? 'A' : 'B';
  } else {
    goldLeadTeam = scoreA > scoreB ? 'A' : 'B';
  }

  const goldLeadMargin = Math.abs(scoreA - scoreB);

  return {
    baseLP_A,
    baseLP_B,
    rollA,
    rollB,
    scoreA,
    scoreB,
    goldLeadTeam,
    goldLeadMargin,
  };
}

// Náskok ze early game (goldLeadMargin) se převede na bonus +5 % až +10 %
// k Fighting Power vítěze laning fáze. MARGIN_FOR_MAX_BONUS je náskok, od
// kterého bonus dosáhne svého maxima (10 %); nad tuto hodnotu se dál nezvyšuje.
const MIN_EARLY_BONUS_PCT = 5;
const MAX_EARLY_BONUS_PCT = 10;
const MARGIN_FOR_MAX_BONUS = 30;

function earlyLeadToBonusPct(margin) {
  const ratio = clamp(margin / MARGIN_FOR_MAX_BONUS, 0, 1);
  return MIN_EARLY_BONUS_PCT + ratio * (MAX_EARLY_BONUS_PCT - MIN_EARLY_BONUS_PCT);
}

// ---------------------------------------------------------------------
// FÁZE 2: Mid/Late Game (Teamfighty & Objektivy)
// ---------------------------------------------------------------------
// Týmové Fighting Power = součet efektivní M (s odchylkou dle Consistency)
// všech 5 hráčů. Vítěz Early Game dostane % bonus (viz earlyLeadToBonusPct).
// Tým s vyšší finální Fighting Power vyhrává zápas.

function simulateMidLateGame(teamAPlayers, teamBPlayers, earlyGame) {
  const effA = teamAPlayers.map((p) => ({
    player: p,
    effFP: getEffectiveFightingPower(p.m, p.c),
  }));
  const effB = teamBPlayers.map((p) => ({
    player: p,
    effFP: getEffectiveFightingPower(p.m, p.c),
  }));

  const baseFP_A = effA.reduce((sum, e) => sum + e.effFP, 0);
  const baseFP_B = effB.reduce((sum, e) => sum + e.effFP, 0);

  const bonusPct = earlyLeadToBonusPct(earlyGame.goldLeadMargin);

  const finalFP_A = earlyGame.goldLeadTeam === 'A' ? baseFP_A * (1 + bonusPct / 100) : baseFP_A;
  const finalFP_B = earlyGame.goldLeadTeam === 'B' ? baseFP_B * (1 + bonusPct / 100) : baseFP_B;

  let winner;
  if (finalFP_A === finalFP_B) {
    winner = Math.random() < 0.5 ? 'A' : 'B';
  } else {
    winner = finalFP_A > finalFP_B ? 'A' : 'B';
  }

  // Jak moc jednostranný byl zápas (0 = vyrovnaný, 1 = extrémní stomp) -
  // použije se ve Fázi 3 pro délku zápasu a rozptyl statistik.
  const maxFP = Math.max(finalFP_A, finalFP_B);
  const lopsidedness = maxFP > 0 ? Math.abs(finalFP_A - finalFP_B) / maxFP : 0;

  return {
    effA,
    effB,
    baseFP_A,
    baseFP_B,
    bonusPct,
    finalFP_A,
    finalFP_B,
    winner,
    lopsidedness: clamp(lopsidedness, 0, 1),
  };
}

// ---------------------------------------------------------------------
// FÁZE 3: Individual Stats
// ---------------------------------------------------------------------

// Typické CS/min a Vision/min podle role (zjednodušený, ale rozumný model).
const ROLE_CS_PER_MIN = { TOP: 7.6, JNG: 6.2, MID: 8.4, ADC: 9.0, SUP: 1.1 };
const ROLE_VISION_PER_MIN = { TOP: 0.7, JNG: 1.2, MID: 0.8, ADC: 0.6, SUP: 2.1 };
const ROLE_ASSIST_WEIGHT = { SUP: 1.5, JNG: 1.25, MID: 1.0, ADC: 0.85, TOP: 0.75 };
const ROLE_KILL_WEIGHT = { ADC: 1.3, MID: 1.25, JNG: 1.0, TOP: 0.9, SUP: 0.35 };

// Délka zápasu: jednostranné zápasy (velký lopsidedness) končí rychleji
// (stomp ~ 22-28 min), vyrovnané zápasy trvají déle (~32-42 min).
function simulateMatchDuration(lopsidedness) {
  const stompMin = 22;
  const stompMax = 28;
  const evenMin = 32;
  const evenMax = 42;

  const lo = stompMin + (1 - lopsidedness) * (evenMin - stompMin);
  const hi = stompMax + (1 - lopsidedness) * (evenMax - stompMax);
  return Math.round(lo + Math.random() * (hi - lo));
}

function generateTeamStats(effTeam, teamWon, hadGoldLead, durationMinutes, lopsidedness) {
  // Celkový počet killů týmu - stompy generují víc killů, prohry méně.
  const baseKillsWin = randInt(16, 26);
  const baseKillsLoss = randInt(5, 15);
  const stompKillBonus = Math.round(lopsidedness * 8);

  const totalTeamKills = teamWon
    ? baseKillsWin + (hadGoldLead ? randInt(0, 3) : 0) + stompKillBonus
    : Math.max(2, baseKillsLoss - stompKillBonus);

  const totalWeight = effTeam.reduce(
    (sum, e) => sum + e.effFP * (ROLE_KILL_WEIGHT[e.player.role] || 1),
    0
  );

  let remainingKills = totalTeamKills;
  const stats = effTeam.map((e, idx) => {
    const isLast = idx === effTeam.length - 1;
    const weight = (e.effFP * (ROLE_KILL_WEIGHT[e.player.role] || 1)) / totalWeight;
    const kills = isLast
      ? remainingKills
      : Math.min(remainingKills, Math.round(totalTeamKills * weight));
    remainingKills -= kills;

    // Assisty - LoL je týmová hra; víc pro SUP/JNG.
    const assistFactor = ROLE_ASSIST_WEIGHT[e.player.role] || 1.0;
    const assists = clamp(
      Math.round(randInt(2, 8) * assistFactor + (teamWon ? 2 : 0) + totalTeamKills * 0.15),
      0,
      22
    );

    // Death - nepřímo úměrné efektivní Fighting Power; prohrávající tým
    // a jednostranné prohry umírají výrazně víc.
    const deathBase = clamp(6 - Math.round(e.effFP / 25), 0, 6);
    const lossPenalty = !teamWon ? Math.round(lopsidedness * 4) : 0;
    const deaths = clamp(deathBase + randInt(-1, 2) + lossPenalty, 0, 12);

    // CS a Vision Score se odvíjí od délky zápasu (CS/min, Vision/min dle role)
    // s mírným náhodným rozptylem.
    const csPerMin = ROLE_CS_PER_MIN[e.player.role] || 6;
    const visionPerMin = ROLE_VISION_PER_MIN[e.player.role] || 1;
    const cs = Math.round(csPerMin * durationMinutes * (0.9 + Math.random() * 0.25));
    const visionScore = Math.round(
      visionPerMin * durationMinutes * (0.85 + Math.random() * 0.4)
    );

    // Gold - flavor stat (neovlivňuje fantasy body, ale hodí se pro UI).
    const goldPerMin = 300 + (e.effFP / 99) * 150 + kills * 40 + assists * 15;
    const gold = Math.round(goldPerMin * durationMinutes * (0.9 + Math.random() * 0.2));

    // Multikilly - vzácné, pravděpodobnost roste s efektivní Fighting Power.
    let quadraKills = 0;
    let pentaKills = 0;
    const fpFactor = e.effFP / 99;

    if (teamWon && Math.random() < Math.pow(fpFactor, 5) * 0.03) {
      pentaKills = 1;
    } else if (kills >= 4 && Math.random() < Math.pow(fpFactor, 3) * 0.12) {
      quadraKills = 1;
    }

    return {
      id: e.player.id,
      name: e.player.name,
      role: e.player.role,
      team: e.player.team,
      effFP: e.effFP,
      kills,
      deaths,
      assists,
      cs,
      visionScore,
      gold,
      teamWon,
      firstBlood: false, // doplní assignFirstBlood()
      quadraKills,
      pentaKills,
    };
  });

  return stats;
}

// Objektivy (Baron/Draci/Věže) jsou "flavor" statistiky pro UI a přehled
// zápasu - bodovací systém (viz scoring.js) je nepočítá, proto neovlivňují
// fantasy body. Vítězný tým jich přirozeně bere víc.
function generateObjectives(teamWon, durationMinutes, lopsidedness) {
  const drakes = teamWon
    ? randInt(1, Math.min(4, 1 + Math.floor(durationMinutes / 10)))
    : randInt(0, 1);
  const barons = teamWon ? (durationMinutes > 27 ? randInt(0, 1 + Math.round(lopsidedness)) : 0) : 0;
  const turrets = teamWon
    ? randInt(4, 11)
    : randInt(0, Math.max(1, 4 - Math.round(lopsidedness * 4)));

  return { drakes, barons, turrets };
}

// First Blood: cca 70% šance, že ho získá tým, který vyhrál Early Game
// (Gold Lead), s menší šancí, že ho "ukradne" soupeř. V rámci týmu se
// přiřadí náhodně hráči s alespoň 1 killem (jinak úplně náhodnému hráči).
function assignFirstBlood(statsA, statsB, goldLeadTeam) {
  const favoredTeam = goldLeadTeam === 'A' ? statsA : statsB;
  const underdogTeam = goldLeadTeam === 'A' ? statsB : statsA;

  const fbTeam = Math.random() < 0.7 ? favoredTeam : underdogTeam;

  const candidates = fbTeam.filter((p) => p.kills > 0);
  const pool = candidates.length > 0 ? candidates : fbTeam;
  const chosen = pool[randInt(0, pool.length - 1)];
  chosen.firstBlood = true;
}

// ---------------------------------------------------------------------
// Hlavní simulační funkce - spojuje Fáze 1, 2 a 3
// ---------------------------------------------------------------------

/**
 * Simuluje jeden zápas mezi dvěma pětičlennými týmy pro-hráčů.
 *
 * @param {Array} teamAPlayers - 5 hráčů (TOP, JNG, MID, ADC, SUP)
 * @param {Array} teamBPlayers - 5 hráčů (TOP, JNG, MID, ADC, SUP)
 * @param {Object} [options]
 * @param {string} [options.teamAName]
 * @param {string} [options.teamBName]
 * @returns {Object} výsledek zápasu
 */
function simulateMatch(teamAPlayers, teamBPlayers, options = {}) {
  if (teamAPlayers.length !== 5 || teamBPlayers.length !== 5) {
    throw new Error('Každý tým musí mít přesně 5 hráčů pro simulaci zápasu.');
  }

  const teamAName = options.teamAName || teamAPlayers[0].team || 'Team A';
  const teamBName = options.teamBName || teamBPlayers[0].team || 'Team B';

  // --- Fáze 1: Early Game (Laning Phase) ---
  const earlyGame = simulateEarlyGame(teamAPlayers, teamBPlayers);

  // --- Fáze 2: Mid/Late Game (Teamfighty) ---
  const midLate = simulateMidLateGame(teamAPlayers, teamBPlayers, earlyGame);

  const durationMinutes = simulateMatchDuration(midLate.lopsidedness);

  // --- Fáze 3: Individual Stats ---
  const statsA = generateTeamStats(
    midLate.effA,
    midLate.winner === 'A',
    earlyGame.goldLeadTeam === 'A',
    durationMinutes,
    midLate.lopsidedness
  );
  const statsB = generateTeamStats(
    midLate.effB,
    midLate.winner === 'B',
    earlyGame.goldLeadTeam === 'B',
    durationMinutes,
    midLate.lopsidedness
  );

  assignFirstBlood(statsA, statsB, earlyGame.goldLeadTeam);

  const objectivesA = generateObjectives(midLate.winner === 'A', durationMinutes, midLate.lopsidedness);
  const objectivesB = generateObjectives(midLate.winner === 'B', durationMinutes, midLate.lopsidedness);

  // Fantasy body pro každého hráče (přesně dle zadaného bodovacího systému)
  for (const s of [...statsA, ...statsB]) {
    s.fantasyPoints = calculateFantasyPoints(s);
  }

  return {
    durationMinutes,
    earlyGame: {
      goldLeadTeam: earlyGame.goldLeadTeam === 'A' ? teamAName : teamBName,
      goldLeadMargin: earlyGame.goldLeadMargin,
      laningScoreA: earlyGame.scoreA,
      laningScoreB: earlyGame.scoreB,
    },
    fightingPowerBonusPct: Math.round(midLate.bonusPct * 10) / 10,
    teamA: {
      name: teamAName,
      laningPower: earlyGame.baseLP_A,
      fightingPower: Math.round(midLate.baseFP_A),
      finalFightingPower: Math.round(midLate.finalFP_A),
      won: midLate.winner === 'A',
      objectives: objectivesA,
      players: statsA,
    },
    teamB: {
      name: teamBName,
      laningPower: earlyGame.baseLP_B,
      fightingPower: Math.round(midLate.baseFP_B),
      finalFightingPower: Math.round(midLate.finalFP_B),
      won: midLate.winner === 'B',
      objectives: objectivesB,
      players: statsB,
    },
    winner: midLate.winner === 'A' ? teamAName : teamBName,
  };
}

module.exports = {
  simulateMatch,
  getEffectiveFightingPower,
  getPerformanceStdev,
};
