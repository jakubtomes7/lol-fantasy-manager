// data/players.js
// Databáze profesionálních hráčů se načítá z data/players.json.
//
// >>> SEM DOPLNÍTE VLASTNÍ HRÁČE A JEJICH RATINGY <<<
// Stačí přepsat obsah data/players.json - žádný kód se měnit nemusí.
//
// Očekávaný formát JSON souboru - pole objektů:
// [
//   {
//     "id": "p1",              // unikátní string ID
//     "name": "Faker",         // zobrazované jméno hráče
//     "team": "T1",            // název "reálného" týmu - podle něj se
//                               // generuje rozpis ligy (round-robin)
//     "role": "MID",           // TOP | JNG | MID | ADC | SUP
//     "pr": 99,                // Player Ranking 1-99
//     "lp": 90,                // Laning Power 1-99
//     "m": 95,                 // Mechanics 1-99
//     "c": 80                  // Consistency 1-100 (1 = velký coinflip, 100 = stabilní)
//   },
//   ...
// ]
//
// DŮLEŽITÉ POŽADAVKY NA DATA:
// 1) Každý "team" musí mít PŘESNĚ jednoho hráče na každou z 5 rolí
//    (TOP, JNG, MID, ADC, SUP) - simulátor hraje zápasy 5v5.
// 2) Aby šlo naplnit draft pro až 10 fantasy manažerů (lidé + boti),
//    je potřeba mít v poolu alespoň 10 hráčů na každou roli, tzn.
//    alespoň 10 "reálných" týmů.
// 3) Počet týmů by měl být sudý kvůli round-robin rozpisu ligy
//    (lichý počet funguje také - jeden tým má v kole vždy volno).

const fs = require('fs');
const path = require('path');

const ROLES = ['TOP', 'JNG', 'MID', 'ADC', 'SUP'];
const DATA_FILE = path.join(__dirname, 'players.json');

function loadPlayers() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf-8');
  } catch (err) {
    throw new Error(
      `Nepodařilo se načíst ${DATA_FILE}. Ujisti se, že soubor data/players.json existuje.`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`data/players.json obsahuje neplatný JSON: ${err.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('data/players.json musí obsahovat neprázdné pole hráčů.');
  }

  validatePlayers(parsed);
  return parsed;
}

function validatePlayers(players) {
  const seenIds = new Set();
  const roleCountByTeam = {};

  for (const [idx, p] of players.entries()) {
    const prefix = `data/players.json[${idx}] (${p && p.name})`;

    if (!p || typeof p !== 'object') {
      throw new Error(`${prefix}: musí být objekt.`);
    }
    for (const field of ['id', 'name', 'team', 'role']) {
      if (typeof p[field] !== 'string' || p[field].trim() === '') {
        throw new Error(`${prefix}: pole "${field}" musí být neprázdný string.`);
      }
    }
    for (const field of ['pr', 'lp', 'm']) {
      if (typeof p[field] !== 'number' || p[field] < 1 || p[field] > 99) {
        throw new Error(`${prefix}: pole "${field}" musí být číslo 1-99.`);
      }
    }
    if (typeof p.c !== 'number' || p.c < 1 || p.c > 100) {
      throw new Error(`${prefix}: pole "c" (Consistency) musí být číslo 1-100.`);
    }
    if (!ROLES.includes(p.role)) {
      throw new Error(`${prefix}: role "${p.role}" není platná (povoleno: ${ROLES.join(', ')}).`);
    }
    if (seenIds.has(p.id)) {
      throw new Error(`${prefix}: duplicitní id "${p.id}".`);
    }
    seenIds.add(p.id);

    roleCountByTeam[p.team] = roleCountByTeam[p.team] || {};
    roleCountByTeam[p.team][p.role] = (roleCountByTeam[p.team][p.role] || 0) + 1;
  }

  // Každý tým musí mít přesně 1 hráče na roli, aby šlo sestavit 5v5 zápas.
  for (const [team, counts] of Object.entries(roleCountByTeam)) {
    for (const role of ROLES) {
      const count = counts[role] || 0;
      if (count !== 1) {
        throw new Error(
          `Tým "${team}" má ${count}x hráče na roli ${role} - musí mít přesně 1. ` +
            `Zkontroluj data/players.json.`
        );
      }
    }
  }

  const teamCount = Object.keys(roleCountByTeam).length;
  for (const role of ROLES) {
    const playersInRole = players.filter((p) => p.role === role).length;
    if (playersInRole < 10) {
      // eslint-disable-next-line no-console
      console.warn(
        `[UPOZORNĚNÍ] Pool obsahuje jen ${playersInRole} hráčů na roli ${role} ` +
          `(doporučeno alespoň 10, aby šlo naplnit draft pro 10 fantasy manažerů). ` +
          `Lobby s více hráči/boty se nemusí podařit dodraftovat.`
      );
    }
  }
  if (teamCount % 2 !== 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[UPOZORNĚNÍ] Počet reálných týmů (${teamCount}) je lichý - v round-robin ` +
        `rozpisu bude mít v každém kole jeden tým volno.`
    );
  }
}

const PLAYERS = loadPlayers();
const REAL_TEAMS = [...new Set(PLAYERS.map((p) => p.team))];

function getPlayerById(id) {
  return PLAYERS.find((p) => p.id === id);
}

function getPlayersByTeam(team) {
  return PLAYERS.filter((p) => p.team === team);
}

module.exports = {
  ROLES,
  REAL_TEAMS,
  PLAYERS,
  getPlayerById,
  getPlayersByTeam,
};
