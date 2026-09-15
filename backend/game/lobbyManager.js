// game/lobbyManager.js
// Správa lobby v paměti serveru: vytvoření, join, doplnění boty na
// celkových 10 týmů, přechod do draftu a ligy.

const { customAlphabet } = require('nanoid');
const DraftManager = require('./draftManager');
const { REAL_TEAMS } = require('../data/players');

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// Hra podporuje 1 až 10 reálných hráčů v jedné lobby (1 hráč = čistě
// proti botům). Neobsazená místa do celkových 10 týmů (fantasy manažerů)
// doplní boti.
const TOTAL_TEAMS = 10;
const MIN_HUMAN_PLAYERS = 1;

class Lobby {
  constructor(code, hostSocketId, hostName, hostTeamName) {
    this.code = code;
    this.hostId = hostSocketId;
    this.status = 'LOBBY'; // LOBBY | DRAFT | LEAGUE | PLAYOFFS | FINISHED
    this.players = new Map(); // socketId -> { id, name, teamName, isBot: false }
    this.bots = []; // { id, name, teamName, isBot: true }
    this.draftManager = null;
    this.leagueManager = null;

    this.addPlayer(hostSocketId, hostName, hostTeamName);
  }

  addPlayer(socketId, name, teamName) {
    if (this.players.size >= TOTAL_TEAMS) {
      return { success: false, error: 'Lobby je plné.' };
    }
    if (this.status !== 'LOBBY') {
      return { success: false, error: 'Draft/liga už začaly, nelze se připojit.' };
    }
    const playerName = name || `Hráč ${this.players.size + 1}`;
    const resolvedTeamName = (teamName || '').trim() || `Tým ${playerName}`;
    this.players.set(socketId, {
      id: socketId,
      name: playerName,
      teamName: resolvedTeamName,
      isBot: false,
    });
    return { success: true };
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
  }

  getAllManagerIds() {
    // pořadí reálných hráčů = pořadí připojení (Map zachovává insertion order)
    return [...this.players.keys()];
  }

  // Doplní zbývající sloty do 10 týmů boty a spustí draft.
  startDraft() {
    if (this.status !== 'LOBBY') {
      return { success: false, error: 'Draft už byl spuštěn.' };
    }
    if (this.players.size < MIN_HUMAN_PLAYERS) {
      return {
        success: false,
        error: `Potřeba alespoň ${MIN_HUMAN_PLAYERS} hráči pro spuštění draftu (aktuálně ${this.players.size}).`,
      };
    }
    if (this.players.size > TOTAL_TEAMS) {
      return { success: false, error: `Maximální počet hráčů je ${TOTAL_TEAMS}.` };
    }

    const humanIds = this.getAllManagerIds();
    const botsNeeded = TOTAL_TEAMS - humanIds.length;

    this.bots = [];
    for (let i = 0; i < botsNeeded; i++) {
      this.bots.push({ id: `bot_${i + 1}`, name: `Bot ${i + 1}`, teamName: `Bot ${i + 1}`, isBot: true });
    }

    const allTeamIds = [...humanIds, ...this.bots.map((b) => b.id)];
    const isBot = (teamId) => this.bots.some((b) => b.id === teamId);

    this.draftManager = new DraftManager(humanIds, allTeamIds, isBot);
    this.status = 'DRAFT';

    return { success: true, allTeamIds, bots: this.bots };
  }

  getTeamDisplayName(teamId) {
    if (this.players.has(teamId)) return this.players.get(teamId).teamName;
    const bot = this.bots.find((b) => b.id === teamId);
    return bot ? bot.name : teamId;
  }

  isDraftComplete() {
    return this.draftManager && this.draftManager.phase === 'COMPLETE';
  }
}

class LobbyManager {
  constructor() {
    this.lobbies = new Map(); // code -> Lobby
  }

  createLobby(hostSocketId, hostName, hostTeamName) {
    let code;
    do {
      code = nanoid();
    } while (this.lobbies.has(code));

    const lobby = new Lobby(code, hostSocketId, hostName, hostTeamName);
    this.lobbies.set(code, lobby);
    return lobby;
  }

  getLobby(code) {
    return this.lobbies.get(code);
  }

  joinLobby(code, socketId, name, teamName) {
    const lobby = this.lobbies.get(code);
    if (!lobby) return { success: false, error: 'Lobby s tímto kódem neexistuje.' };
    const result = lobby.addPlayer(socketId, name, teamName);
    return { ...result, lobby };
  }

  removePlayerFromAllLobbies(socketId) {
    for (const lobby of this.lobbies.values()) {
      if (lobby.players.has(socketId)) {
        lobby.removePlayer(socketId);
      }
    }
  }

  deleteLobby(code) {
    this.lobbies.delete(code);
  }
}

module.exports = { LobbyManager, Lobby, TOTAL_TEAMS, MIN_HUMAN_PLAYERS, REAL_TEAMS };
