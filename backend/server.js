// server.js
// Vstupní bod backendu. Express slouží jen jako HTTP server (health-check),
// veškerá herní logika běží přes Socket.io eventy.

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const { LobbyManager, MIN_HUMAN_PLAYERS, TOTAL_TEAMS } = require('./game/lobbyManager');
const { LeagueManager } = require('./game/leagueManager');
const { PLAYERS, ROLES } = require('./data/players');

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});

const lobbyManager = new LobbyManager();

// ---------------------------------------------------------------------
// Pomocné funkce pro broadcast stavu
// ---------------------------------------------------------------------

function serializeLobby(lobby) {
  return {
    code: lobby.code,
    status: lobby.status,
    hostId: lobby.hostId,
    players: [...lobby.players.values()],
    bots: lobby.bots,
    totalTeams: TOTAL_TEAMS,
    minPlayers: MIN_HUMAN_PLAYERS,
    canStart: lobby.players.size >= MIN_HUMAN_PLAYERS,
  };
}

function serializeDraftState(lobby) {
  if (!lobby.draftManager) return null;
  const state = lobby.draftManager.getState();
  return {
    ...state,
    currentDrafterName: state.currentDrafter
      ? lobby.getTeamDisplayName(state.currentDrafter)
      : null,
    availablePlayers:
      state.phase === 'HUMAN_DRAFT' ? lobby.draftManager.getAvailablePlayers() : [],
  };
}

function broadcastLobby(code) {
  const lobby = lobbyManager.getLobby(code);
  if (!lobby) return;
  io.to(code).emit('lobby:update', serializeLobby(lobby));
}

function broadcastDraft(code) {
  const lobby = lobbyManager.getLobby(code);
  if (!lobby) return;
  io.to(code).emit('draft:update', serializeDraftState(lobby));

  if (lobby.isDraftComplete()) {
    lobby.status = 'LEAGUE';
    lobby.leagueManager = new LeagueManager(
      lobby.draftManager.roster,
      (teamId) => lobby.getTeamDisplayName(teamId)
    );
    broadcastLobby(code);
    io.to(code).emit('draft:complete', {
      roster: lobby.draftManager.roster,
    });
    io.to(code).emit('league:ready', {
      totalRounds: lobby.leagueManager.totalRounds,
      schedulePreview: lobby.leagueManager.schedule,
      standings: lobby.leagueManager.getStandings(),
    });
  }
}

// ---------------------------------------------------------------------
// Socket.io eventy
// ---------------------------------------------------------------------

io.on('connection', (socket) => {
  // --- LOBBY ---

  socket.on('lobby:create', ({ playerName, teamName }, callback) => {
    const lobby = lobbyManager.createLobby(socket.id, playerName, teamName);
    socket.join(lobby.code);
    callback?.({ success: true, code: lobby.code, playerId: socket.id });
    broadcastLobby(lobby.code);
  });

  socket.on('lobby:join', ({ code, playerName, teamName }, callback) => {
    const result = lobbyManager.joinLobby(code, socket.id, playerName, teamName);
    if (!result.success) {
      callback?.({ success: false, error: result.error });
      return;
    }
    socket.join(code);
    callback?.({ success: true, code, playerId: socket.id });
    broadcastLobby(code);
  });

  socket.on('lobby:start', ({ code }) => {
    const lobby = lobbyManager.getLobby(code);
    if (!lobby) return socket.emit('error:message', 'Lobby neexistuje.');
    if (socket.id !== lobby.hostId) {
      return socket.emit('error:message', 'Jen host může spustit draft.');
    }

    const result = lobby.startDraft();
    if (!result.success) {
      return socket.emit('error:message', result.error);
    }

    broadcastLobby(code);
    broadcastDraft(code); // pokud fáze 1 nemá reálné hráče (edge case), rovnou přejde na boty
  });

  // --- DRAFT ---

  socket.on('draft:pick', ({ code, proPlayerId }) => {
    const lobby = lobbyManager.getLobby(code);
    if (!lobby || !lobby.draftManager) {
      return socket.emit('error:message', 'Draft ještě nezačal.');
    }

    const result = lobby.draftManager.pick(socket.id, proPlayerId);
    if (!result.success) {
      return socket.emit('error:message', result.error);
    }

    broadcastDraft(code);
  });

  // --- LEAGUE: regulérní sezóna ---

  socket.on('league:simulateRound', ({ code }) => {
    const lobby = lobbyManager.getLobby(code);
    if (!lobby || !lobby.leagueManager) {
      return socket.emit('error:message', 'Liga ještě nebyla spuštěna.');
    }
    if (socket.id !== lobby.hostId) {
      return socket.emit('error:message', 'Jen host může spouštět kola ligy.');
    }

    const result = lobby.leagueManager.simulateNextRound();
    if (!result.success) {
      return socket.emit('error:message', result.error);
    }

    io.to(code).emit('league:roundResult', result.roundSummary);
    io.to(code).emit('league:standings', result.standings);

    if (lobby.leagueManager.isRegularSeasonComplete()) {
      io.to(code).emit('league:regularSeasonComplete', {
        standings: lobby.leagueManager.getStandings(),
      });
    }
  });

  socket.on('league:simulateAll', ({ code }) => {
    const lobby = lobbyManager.getLobby(code);
    if (!lobby || !lobby.leagueManager) {
      return socket.emit('error:message', 'Liga ještě nebyla spuštěna.');
    }
    if (socket.id !== lobby.hostId) {
      return socket.emit('error:message', 'Jen host může spouštět kola ligy.');
    }

    const result = lobby.leagueManager.simulateAllRemaining();
    for (const summary of result.roundSummaries) {
      io.to(code).emit('league:roundResult', summary);
    }
    io.to(code).emit('league:standings', result.standings);

    if (lobby.leagueManager.isRegularSeasonComplete()) {
      io.to(code).emit('league:regularSeasonComplete', {
        standings: lobby.leagueManager.getStandings(),
      });
    }
  });

  // --- LEAGUE: play-off ---

  socket.on('league:startPlayoffs', ({ code }) => {
    const lobby = lobbyManager.getLobby(code);
    if (!lobby || !lobby.leagueManager) {
      return socket.emit('error:message', 'Liga ještě nebyla spuštěna.');
    }
    if (socket.id !== lobby.hostId) {
      return socket.emit('error:message', 'Jen host může spustit play-off.');
    }

    const result = lobby.leagueManager.startPlayoffs();
    if (!result.success) {
      return socket.emit('error:message', result.error);
    }

    lobby.status = 'PLAYOFFS';
    broadcastLobby(code);
    io.to(code).emit('league:playoffReady', { playoff: result.playoff });
  });

  socket.on('league:simulatePlayoffRound', ({ code }) => {
    const lobby = lobbyManager.getLobby(code);
    if (!lobby || !lobby.leagueManager) {
      return socket.emit('error:message', 'Liga ještě nebyla spuštěna.');
    }
    if (socket.id !== lobby.hostId) {
      return socket.emit('error:message', 'Jen host může spouštět kola play-off.');
    }

    const result = lobby.leagueManager.simulateNextPlayoffRound();
    if (!result.success) {
      return socket.emit('error:message', result.error);
    }

    io.to(code).emit('league:playoffRoundResult', result.roundSummary);
    io.to(code).emit('league:playoffUpdate', { playoff: lobby.leagueManager.playoff });
    io.to(code).emit('league:standings', result.standings);

    if (result.complete) {
      lobby.status = 'FINISHED';
      broadcastLobby(code);
      io.to(code).emit('league:finished', {
        finalStandings: lobby.leagueManager.getStandings(),
        playoffChampion: result.champion,
        topScorer: lobby.leagueManager.getTopScorer(),
      });
    }
  });

  socket.on('league:simulateAllPlayoffs', ({ code }) => {
    const lobby = lobbyManager.getLobby(code);
    if (!lobby || !lobby.leagueManager) {
      return socket.emit('error:message', 'Liga ještě nebyla spuštěna.');
    }
    if (socket.id !== lobby.hostId) {
      return socket.emit('error:message', 'Jen host může spouštět kola play-off.');
    }

    const result = lobby.leagueManager.simulateAllRemainingPlayoffRounds();
    for (const summary of result.roundSummaries) {
      io.to(code).emit('league:playoffRoundResult', summary);
    }
    io.to(code).emit('league:playoffUpdate', { playoff: lobby.leagueManager.playoff });
    io.to(code).emit('league:standings', result.standings);

    if (result.complete) {
      lobby.status = 'FINISHED';
      broadcastLobby(code);
      io.to(code).emit('league:finished', {
        finalStandings: lobby.leagueManager.getStandings(),
        playoffChampion: result.champion,
        topScorer: lobby.leagueManager.getTopScorer(),
      });
    }
  });

  // --- MISC ---

  socket.on('disconnect', () => {
    lobbyManager.removePlayerFromAllLobbies(socket.id);
    // Poznámka: pro jednoduchost lobby po odpojení hráče nemažeme ani
    // nepřepočítáváme rozehraný draft - v produkční verzi by zde bylo
    // vhodné hráče nahradit botem, pokud odejde uprostřed draftu.
  });
});

server.listen(PORT, () => {
  console.log(`LoL Fantasy Manager backend běží na http://localhost:${PORT}`);
  console.log(`Pro-hráčů v databázi: ${PLAYERS.length}, role: ${ROLES.join(', ')}`);
});

module.exports = { app, server, io };
