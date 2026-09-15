// game/leagueManager.js
// KAŽDÝ FANTASY MANAŽER HRAJE JAKO VLASTNÍ TÝM. Vydraftovaná pětice
// pro-hráčů (napříč různými reálnými LEC organizacemi) je jeho roster,
// kterým nastupuje do zápasů - ne originální LEC organizace se svým
// původním složením. Liga má dvě fáze:
//
//   1) REGULÉRNÍ SEZÓNA - round-robin rozpis zápasů mezi 10 FANTASY TÝMY
//      (manažery, lidmi i boty). Každý simulovaný zápas je "roster
//      manažera A" vs "roster manažera B"; fantasy body obou týmů jdou
//      rovnou do jejich vlastních standings. Průběžně se sleduje bilance
//      výher/proher - podle toho se určuje nasazení do play-off.
//
//   2) PLAY-OFF - double-elimination pavouk pro 6 nejlepších týmů
//      (stejný formát jako reálná LEC/LCS):
//        - Horní pavouk kolo 1: 1. seed vs 4. seed, 2. seed vs 3. seed
//        - Dolní pavouk kolo 1: 5. seed vs 6. seed (poražený je rovnou
//          vyřazen na 5.-6. místě - nemá "druhý život")
//        - Finále horního pavouka: vítězové z horního kola 1 -> vítěz
//          postupuje rovnou do Grand Finále, poražený spadá do dolního
//          pavouka
//        - Dolní pavouk kolo 2: poražení z horního kola 1 vs vítěz
//          dolního kola 1
//        - Finále dolního pavouka: vítěz dolního kola 2 vs poražený z
//          finále horního pavouka
//        - Grand Finále: šampion horního pavouka vs vítěz dolního pavouka
//      Fantasy body ze všech play-off zápasů se počítají s bonusovým
//      násobičem (viz PLAYOFF_MULTIPLIER), protože jde o zápasy s vyššími
//      sázkami. Každý zápas je jedno simulované utkání (Bo1).

const { simulateMatch } = require('./simulator');

const PLAYOFF_MULTIPLIER = 1.5; // bonus na fantasy body v play-off zápasech
const PLAYOFF_TEAMS = 6; // kolik nejlepších fantasy týmů postupuje do play-off

const STAGE_NAMES = [
  'Kolo 1 (Horní pavouk + Dolní pavouk)',
  'Kolo 2 (Finále horního pavouka + Dolní pavouk)',
  'Finále dolního pavouka',
  'Grand Finále',
];

// Round-robin rozpis (circle method). Pro sudý počet týmů N vrací N-1 kol,
// každé kolo má N/2 zápasů.
function generateRoundRobinSchedule(teams) {
  const list = [...teams];
  if (list.length % 2 !== 0) list.push(null); // bye, kdyby bylo liché

  const n = list.length;
  const rounds = [];
  const fixed = list[0];
  let rotating = list.slice(1);

  for (let r = 0; r < n - 1; r++) {
    const roundTeams = [fixed, ...rotating];
    const matches = [];
    for (let i = 0; i < n / 2; i++) {
      const a = roundTeams[i];
      const b = roundTeams[n - 1 - i];
      if (a !== null && b !== null) matches.push([a, b]);
    }
    rounds.push(matches);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, rotating.length - 1)];
  }
  return rounds;
}

function emptyMatch(id, bracket, label) {
  return {
    id,
    bracket, // 'UB' | 'LB' | 'GF'
    label,
    teamAId: null,
    teamBId: null,
    teamA: null,
    teamB: null,
    seedA: null,
    seedB: null,
    winnerId: null,
    winner: null,
    loserId: null,
    loserName: null,
    result: null,
  };
}

class LeagueManager {
  /**
   * @param {Object} roster - výstup DraftManager.roster: fantasyTeamId -> {TOP,JNG,MID,ADC,SUP}
   * @param {Function} getTeamDisplayName - (fantasyTeamId) => string, pro hezké UI
   */
  constructor(roster, getTeamDisplayName) {
    this.roster = roster;
    this.getTeamDisplayName = getTeamDisplayName || ((id) => id);

    this.fantasyTeamIds = Object.keys(roster);

    this.schedule = generateRoundRobinSchedule(this.fantasyTeamIds);
    this.currentRoundIndex = 0;

    // Standings: fantasyTeamId -> kumulativní fantasy body (regulérní sezóna + play-off)
    this.standings = {};
    // Bilance výher/proher v regulérní sezóně - použije se pro nasazení do play-off.
    this.record = {};
    for (const id of this.fantasyTeamIds) {
      this.standings[id] = 0;
      this.record[id] = { wins: 0, losses: 0 };
    }

    this.roundResults = []; // historie regulérních kol

    this.playoff = null; // vyplní se startPlayoffs()
  }

  get totalRounds() {
    return this.schedule.length;
  }

  _rosterPlayers(fantasyTeamId) {
    return Object.values(this.roster[fantasyTeamId]);
  }

  // --- Regulérní sezóna ---------------------------------------------

  isRegularSeasonComplete() {
    return this.currentRoundIndex >= this.schedule.length;
  }

  /**
   * Odsimuluje další kolo regulérní sezóny a vrátí výsledky + standings.
   */
  simulateNextRound() {
    if (this.isRegularSeasonComplete()) {
      return { success: false, error: 'Regulérní sezóna už skončila, žádná další kola.' };
    }

    const matches = this.schedule[this.currentRoundIndex];
    const matchResults = matches.map(([teamIdA, teamIdB]) =>
      this._simulateAndCredit(teamIdA, teamIdB, { multiplier: 1, trackRecord: true })
    );

    const roundSummary = {
      round: this.currentRoundIndex + 1,
      totalRounds: this.totalRounds,
      matches: matchResults,
    };

    this.roundResults.push(roundSummary);
    this.currentRoundIndex += 1;

    return { success: true, roundSummary, standings: this.getStandings() };
  }

  /**
   * Odsimuluje všechna zbývající kola regulérní sezóny najednou.
   */
  simulateAllRemaining() {
    const summaries = [];
    while (!this.isRegularSeasonComplete()) {
      const res = this.simulateNextRound();
      if (!res.success) break;
      summaries.push(res.roundSummary);
    }
    return { roundSummaries: summaries, standings: this.getStandings() };
  }

  // --- Play-off (double-elimination, 6 týmů) --------------------------

  /**
   * Sestaví play-off pavouka z 6 nejlepších fantasy týmů regulérní sezóny
   * (nasazení podle výher, remízy dle celkových fantasy bodů). Formát je
   * double-elimination: 1.-4. seed jdou do horního pavouka, 5.-6. seed
   * rovnou do dolního pavouka (viz hlavička souboru pro celý strom).
   */
  startPlayoffs() {
    if (!this.isRegularSeasonComplete()) {
      return { success: false, error: 'Regulérní sezóna ještě neskončila.' };
    }
    if (this.playoff) {
      return { success: false, error: 'Play-off už byl spuštěn.' };
    }
    if (this.fantasyTeamIds.length < PLAYOFF_TEAMS) {
      return { success: false, error: `Na play-off je potřeba alespoň ${PLAYOFF_TEAMS} týmů.` };
    }

    const seeded = [...this.fantasyTeamIds].sort((a, b) => {
      const ra = this.record[a];
      const rb = this.record[b];
      if (rb.wins !== ra.wins) return rb.wins - ra.wins;
      return this.standings[b] - this.standings[a];
    });

    const qualified = seeded.slice(0, PLAYOFF_TEAMS);
    const [s1, s2, s3, s4, s5, s6] = qualified;
    const name = (id) => this.getTeamDisplayName(id);

    const matches = {
      UB1: emptyMatch('UB1', 'UB', 'Horní pavouk – 1. vs 4. nasazený'),
      UB2: emptyMatch('UB2', 'UB', 'Horní pavouk – 2. vs 3. nasazený'),
      LB1: emptyMatch('LB1', 'LB', 'Dolní pavouk – 5. vs 6. nasazený'),
      UBF: emptyMatch('UBF', 'UB', 'Finále horního pavouka'),
      LB2: emptyMatch('LB2', 'LB', 'Dolní pavouk – 2. kolo'),
      LB3: emptyMatch('LB3', 'LB', 'Finále dolního pavouka'),
      GF: emptyMatch('GF', 'GF', 'Grand Finále'),
    };

    matches.UB1.teamAId = s1; matches.UB1.teamA = name(s1); matches.UB1.seedA = 1;
    matches.UB1.teamBId = s4; matches.UB1.teamB = name(s4); matches.UB1.seedB = 4;

    matches.UB2.teamAId = s2; matches.UB2.teamA = name(s2); matches.UB2.seedA = 2;
    matches.UB2.teamBId = s3; matches.UB2.teamB = name(s3); matches.UB2.seedB = 3;

    matches.LB1.teamAId = s5; matches.LB1.teamA = name(s5); matches.LB1.seedA = 5;
    matches.LB1.teamBId = s6; matches.LB1.teamB = name(s6); matches.LB1.seedB = 6;

    this.playoff = {
      format: 'DOUBLE_ELIM_6',
      seeds: qualified.map((id, idx) => ({
        seed: idx + 1,
        teamId: id,
        team: name(id),
        wins: this.record[id].wins,
        points: this.standings[id],
      })),
      matches,
      stages: [['UB1', 'UB2', 'LB1'], ['UBF', 'LB2'], ['LB3'], ['GF']],
      currentStageIndex: 0,
      complete: false,
      championId: null,
      champion: null,
      upperBracketChampionId: null,
      upperBracketChampion: null,
      fifthPlaceId: null,
      fifthPlace: null, // poražený z LB1 - vyřazen bez šance na odvetu (5.-6. místo)
    };

    return { success: true, playoff: this.playoff };
  }

  isPlayoffsStarted() {
    return this.playoff !== null;
  }

  isPlayoffsComplete() {
    return this.playoff !== null && this.playoff.complete;
  }

  // Odsimuluje jeden zápas play-off pavouka a doplní výsledek/vítěze/poraženého.
  _resolvePlayoffMatch(match) {
    const result = this._simulateAndCredit(match.teamAId, match.teamBId, {
      multiplier: PLAYOFF_MULTIPLIER,
      trackRecord: false,
    });
    match.result = result;
    const aWon = result.teamA.won;
    match.winnerId = aWon ? match.teamAId : match.teamBId;
    match.winner = aWon ? match.teamA : match.teamB;
    match.loserId = aWon ? match.teamBId : match.teamAId;
    match.loserName = aWon ? match.teamB : match.teamA;
  }

  /**
   * Odsimuluje všechny zápasy aktuální fáze play-off pavouka a propaguje
   * vítěze/poražené do dalších zápasů (viz strom v hlavičce souboru).
   */
  simulateNextPlayoffRound() {
    if (!this.playoff) {
      return { success: false, error: 'Play-off ještě nebyl spuštěn.' };
    }
    if (this.playoff.complete) {
      return { success: false, error: 'Play-off už skončil.' };
    }

    const stageIndex = this.playoff.currentStageIndex;
    const stageIds = this.playoff.stages[stageIndex];
    const m = this.playoff.matches;

    for (const matchId of stageIds) {
      this._resolvePlayoffMatch(m[matchId]);
    }

    if (stageIndex === 0) {
      // Kolo 1 hotové -> naplň Finále horního pavouka + Dolní pavouk kolo 2
      m.UBF.teamAId = m.UB1.winnerId; m.UBF.teamA = m.UB1.winner;
      m.UBF.teamBId = m.UB2.winnerId; m.UBF.teamB = m.UB2.winner;

      m.LB2.teamAId = m.UB1.loserId; m.LB2.teamA = m.UB1.loserName;
      m.LB2.teamBId = m.LB1.winnerId; m.LB2.teamB = m.LB1.winner;

      this.playoff.fifthPlaceId = m.LB1.loserId;
      this.playoff.fifthPlace = m.LB1.loserName;
    } else if (stageIndex === 1) {
      // Kolo 2 hotové -> naplň Finále dolního pavouka
      m.LB3.teamAId = m.LB2.winnerId; m.LB3.teamA = m.LB2.winner;
      m.LB3.teamBId = m.UBF.loserId; m.LB3.teamB = m.UBF.loserName;

      this.playoff.upperBracketChampionId = m.UBF.winnerId;
      this.playoff.upperBracketChampion = m.UBF.winner;
    } else if (stageIndex === 2) {
      // Finále dolního pavouka hotové -> naplň Grand Finále
      m.GF.teamAId = this.playoff.upperBracketChampionId;
      m.GF.teamA = this.playoff.upperBracketChampion;
      m.GF.teamBId = m.LB3.winnerId;
      m.GF.teamB = m.LB3.winner;
    } else if (stageIndex === 3) {
      // Grand Finále hotové -> korunuj šampiona
      this.playoff.championId = m.GF.winnerId;
      this.playoff.champion = m.GF.winner;
      this.playoff.complete = true;
    }

    this.playoff.currentStageIndex += 1;

    return {
      success: true,
      roundSummary: {
        name: STAGE_NAMES[stageIndex],
        matches: stageIds.map((id) => m[id]),
      },
      standings: this.getStandings(),
      complete: this.playoff.complete,
      champion: this.playoff.champion,
    };
  }

  simulateAllRemainingPlayoffRounds() {
    const summaries = [];
    while (this.playoff && !this.playoff.complete) {
      const res = this.simulateNextPlayoffRound();
      if (!res.success) break;
      summaries.push(res.roundSummary);
    }
    return {
      roundSummaries: summaries,
      standings: this.getStandings(),
      complete: this.isPlayoffsComplete(),
      champion: this.playoff ? this.playoff.champion : null,
    };
  }

  // Tým s nejvíc fantasy body celkem (regulérní sezóna + play-off) -
  // nemusí být nutně totožný s vítězem play-off pavouka, protože o
  // postupu v pavouku rozhoduje výsledek zápasu (Fighting Power), ne
  // kdo toho kolo nasbíral víc fantasy bodů.
  getTopScorer() {
    const standings = this.getStandings();
    return standings.length > 0 ? standings[0] : null;
  }

  // --- Sdílené interní pomocníky --------------------------------------

  // Odsimuluje jeden zápas mezi dvěma FANTASY týmy (jejich vydraftovanými
  // rostery), připočte fantasy body (s volitelným násobičem) přímo
  // odpovídajícím manažerům a volitelně aktualizuje bilanci výher/proher
  // pro nasazení do play-off.
  _simulateAndCredit(teamIdA, teamIdB, { multiplier, trackRecord }) {
    const playersA = this._rosterPlayers(teamIdA);
    const playersB = this._rosterPlayers(teamIdB);
    const result = simulateMatch(playersA, playersB, {
      teamAName: this.getTeamDisplayName(teamIdA),
      teamBName: this.getTeamDisplayName(teamIdB),
    });

    const creditTeam = (teamResult, fantasyTeamId) => {
      let sum = 0;
      for (const p of teamResult.players) {
        const credited = Math.round(p.fantasyPoints * multiplier * 100) / 100;
        p.creditedFantasyPoints = credited;
        sum += credited;
      }
      this.standings[fantasyTeamId] = Math.round((this.standings[fantasyTeamId] + sum) * 100) / 100;
    };

    creditTeam(result.teamA, teamIdA);
    creditTeam(result.teamB, teamIdB);

    if (trackRecord) {
      const winnerId = result.teamA.won ? teamIdA : teamIdB;
      const loserId = winnerId === teamIdA ? teamIdB : teamIdA;
      this.record[winnerId].wins += 1;
      this.record[loserId].losses += 1;
    }

    result.pointsMultiplier = multiplier;
    result.teamAId = teamIdA;
    result.teamBId = teamIdB;
    return result;
  }

  getStandings() {
    return Object.entries(this.standings)
      .map(([teamId, points]) => ({
        teamId,
        name: this.getTeamDisplayName(teamId),
        wins: this.record[teamId]?.wins ?? 0,
        losses: this.record[teamId]?.losses ?? 0,
        points,
      }))
      .sort((a, b) => b.points - a.points);
  }
}

module.exports = { LeagueManager, generateRoundRobinSchedule, PLAYOFF_MULTIPLIER, PLAYOFF_TEAMS };
