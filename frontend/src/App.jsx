import React, { useEffect, useState, useCallback, useRef } from 'react';
import socket from './socket';

const ROLES = ['TOP', 'JNG', 'MID', 'ADC', 'SUP'];

// ---------------------------------------------------------------------
// Root komponenta - drží veškerý stav ze socket eventů a rozhoduje,
// jakou obrazovku vykreslit podle lobby.status.
// ---------------------------------------------------------------------
export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [myId, setMyId] = useState(socket.id || null);
  const [lobby, setLobby] = useState(null);
  const [draft, setDraft] = useState(null);
  const [leagueInfo, setLeagueInfo] = useState(null); // { totalRounds }
  const [roundResults, setRoundResults] = useState([]); // historie regulérních kol
  const [standings, setStandings] = useState([]);
  const [regularSeasonComplete, setRegularSeasonComplete] = useState(false);
  const [playoff, setPlayoff] = useState(null);
  const [finished, setFinished] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const errorTimer = useRef(null);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
      setMyId(socket.id);
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onLobbyUpdate(l) {
      setLobby(l);
    }
    function onDraftUpdate(d) {
      setDraft(d);
    }
    function onLeagueReady(info) {
      setLeagueInfo({ totalRounds: info.totalRounds });
      setStandings(info.standings);
      setRoundResults([]);
      setRegularSeasonComplete(false);
      setPlayoff(null);
      setFinished(null);
    }
    function onRoundResult(summary) {
      setRoundResults((prev) => [...prev, summary]);
    }
    function onRegularSeasonComplete() {
      setRegularSeasonComplete(true);
    }
    function onPlayoffReady(info) {
      setPlayoff(info.playoff);
    }
    function onPlayoffUpdate(info) {
      setPlayoff(info.playoff);
    }
    function onStandings(s) {
      setStandings(s);
    }
    function onFinished(info) {
      setFinished(info);
    }
    function onError(msg) {
      setErrorMsg(msg);
      clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setErrorMsg(null), 4000);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('lobby:update', onLobbyUpdate);
    socket.on('draft:update', onDraftUpdate);
    socket.on('league:ready', onLeagueReady);
    socket.on('league:roundResult', onRoundResult);
    socket.on('league:regularSeasonComplete', onRegularSeasonComplete);
    socket.on('league:playoffReady', onPlayoffReady);
    socket.on('league:playoffUpdate', onPlayoffUpdate);
    socket.on('league:standings', onStandings);
    socket.on('league:finished', onFinished);
    socket.on('error:message', onError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('lobby:update', onLobbyUpdate);
      socket.off('draft:update', onDraftUpdate);
      socket.off('league:ready', onLeagueReady);
      socket.off('league:roundResult', onRoundResult);
      socket.off('league:regularSeasonComplete', onRegularSeasonComplete);
      socket.off('league:playoffReady', onPlayoffReady);
      socket.off('league:playoffUpdate', onPlayoffUpdate);
      socket.off('league:standings', onStandings);
      socket.off('league:finished', onFinished);
      socket.off('error:message', onError);
    };
  }, []);

  const isHost = lobby && myId === lobby.hostId;
  const myTeamName = lobby?.players.find((p) => p.id === myId)?.teamName;

  let screen;
  if (!connected) {
    screen = <ConnectingScreen />;
  } else if (!lobby) {
    screen = <Landing />;
  } else if (lobby.status === 'LOBBY') {
    screen = <LobbyRoom lobby={lobby} isHost={isHost} myId={myId} />;
  } else if (lobby.status === 'DRAFT') {
    screen = <DraftRoom lobby={lobby} draft={draft} myId={myId} />;
  } else {
    screen = (
      <LeagueRoom
        lobby={lobby}
        isHost={isHost}
        myId={myId}
        myRoster={draft?.roster?.[myId] || null}
        leagueInfo={leagueInfo}
        roundResults={roundResults}
        standings={standings}
        regularSeasonComplete={regularSeasonComplete}
        playoff={playoff}
        finished={finished}
      />
    );
  }

  return (
    <div className="app-shell">
      <TopBar lobby={lobby} connected={connected} myTeamName={myTeamName} />
      <main className="app-main">{screen}</main>
      {errorMsg && <div className="toast toast--error">{errorMsg}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Horní lišta
// ---------------------------------------------------------------------
function TopBar({ lobby, connected, myTeamName }) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__mark">RIFT</span>
        <span className="topbar__name">Fantasy Manager</span>
      </div>
      <div className="topbar__right">
        {myTeamName && (
          <span className="topbar__team">
            TVŮJ TÝM <strong>{myTeamName}</strong>
          </span>
        )}
        {lobby && (
          <span className="topbar__code">
            KÓD LOBBY <strong>{lobby.code}</strong>
          </span>
        )}
        <span className={`status-dot ${connected ? 'is-online' : 'is-offline'}`} />
      </div>
    </header>
  );
}

function ConnectingScreen() {
  return (
    <div className="panel center-panel">
      <p className="muted">Připojování k serveru...</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// LANDING - vytvoření nebo připojení do lobby
// ---------------------------------------------------------------------
function Landing() {
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState('create'); // 'create' | 'join'
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);

  const handleCreate = useCallback(() => {
    if (!name.trim()) return setLocalError('Zadej svou přezdívku.');
    setBusy(true);
    socket.emit('lobby:create', { playerName: name.trim(), teamName: teamName.trim() }, (res) => {
      setBusy(false);
      if (!res?.success) setLocalError(res?.error || 'Nepodařilo se vytvořit lobby.');
    });
  }, [name, teamName]);

  const handleJoin = useCallback(() => {
    if (!name.trim()) return setLocalError('Zadej svou přezdívku.');
    if (joinCode.trim().length !== 6) return setLocalError('Kód lobby má 6 znaků.');
    setBusy(true);
    socket.emit(
      'lobby:join',
      { code: joinCode.trim().toUpperCase(), playerName: name.trim(), teamName: teamName.trim() },
      (res) => {
        setBusy(false);
        if (!res?.success) setLocalError(res?.error || 'Nepodařilo se připojit.');
      }
    );
  }, [name, teamName, joinCode]);

  return (
    <div className="landing">
      <div className="landing__hero">
        <h1>
          Draftuj roster.
          <br />
          Sleduj ligu naživo.
        </h1>
        <p className="muted">
          1–10 hráčů, snake draft pro-hráčů napříč rolemi TOP / JNG / MID / ADC / SUP a
          simulovaná liga s play-off, která rozhoduje o vítězi fantasy bodů.
        </p>
      </div>

      <div className="panel landing__form">
        <div className="tabs">
          <button className={mode === 'create' ? 'tab is-active' : 'tab'} onClick={() => setMode('create')}>
            Vytvořit lobby
          </button>
          <button className={mode === 'join' ? 'tab is-active' : 'tab'} onClick={() => setMode('join')}>
            Připojit se
          </button>
        </div>

        <label className="field">
          <span>Přezdívka</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Např. Faker_Fan99"
            maxLength={24}
          />
        </label>

        <label className="field">
          <span>Název týmu (nepovinné)</span>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Např. Piráti z Riftu"
            maxLength={30}
          />
          <span className="field-hint">Necháš-li prázdné, dosadí se automaticky.</span>
        </label>

        {mode === 'join' && (
          <label className="field">
            <span>Kód lobby</span>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              className="mono-input"
            />
          </label>
        )}

        {localError && <p className="field-error">{localError}</p>}

        <button
          className="btn btn--primary"
          disabled={busy}
          onClick={mode === 'create' ? handleCreate : handleJoin}
        >
          {mode === 'create' ? 'Vytvořit lobby' : 'Připojit se'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// LOBBY ROOM - čekárna před draftem
// ---------------------------------------------------------------------
function LobbyRoom({ lobby, isHost, myId }) {
  const slotsLeft = lobby.totalTeams - lobby.players.length;

  return (
    <div className="lobby-room">
      <section className="panel">
        <h2>Lobby {lobby.code}</h2>
        <p className="muted">
          Připojení hráči: {lobby.players.length} / {lobby.totalTeams}. Volná místa doplní boti
          podle PR ratingu, jakmile draft začne.
        </p>

        <ul className="roster-list">
          {lobby.players.map((p, i) => (
            <li key={p.id} className="roster-list__item">
              <span className="roster-list__index">{String(i + 1).padStart(2, '0')}</span>
              <span className="roster-list__team">{p.teamName}</span>
              <span className="muted roster-list__owner">({p.name})</span>
              {p.id === lobby.hostId && <span className="pill pill--gold">Host</span>}
              {p.id === myId && <span className="pill pill--teal">Ty</span>}
            </li>
          ))}
          {Array.from({ length: Math.max(slotsLeft, 0) }).map((_, i) => (
            <li key={`empty-${i}`} className="roster-list__item roster-list__item--empty">
              <span className="roster-list__index">{String(lobby.players.length + i + 1).padStart(2, '0')}</span>
              <span className="muted">volné místo (doplní bot)</span>
            </li>
          ))}
        </ul>

        {isHost ? (
          <button
            className="btn btn--primary"
            disabled={!lobby.canStart}
            onClick={() => socket.emit('lobby:start', { code: lobby.code })}
          >
            {lobby.canStart
              ? 'Spustit draft'
              : `Potřeba alespoň ${lobby.minPlayers} hráč(i) (aktuálně ${lobby.players.length})`}
          </button>
        ) : (
          <p className="muted">Čeká se, až host spustí draft...</p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------
// DRAFT ROOM - snake draft mezi reálnými hráči
// ---------------------------------------------------------------------
function DraftRoom({ lobby, draft, myId }) {
  const [filter, setFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');

  if (!draft) {
    return (
      <div className="panel center-panel">
        <p className="muted">Draft se připravuje...</p>
      </div>
    );
  }

  if (draft.phase === 'BOT_DRAFT') {
    return (
      <div className="panel center-panel">
        <p className="muted">Boti dokončují draft...</p>
      </div>
    );
  }

  const isMyTurn = draft.currentDrafter === myId;
  const myOpenRoles = draft.roster[myId] ? ROLES.filter((r) => draft.roster[myId][r] === null) : [];

  const available = (draft.availablePlayers || [])
    .filter((p) => roleFilter === 'ALL' || p.role === roleFilter)
    .filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  function displayNameFor(teamId) {
    if (teamId === myId) return 'Ty';
    const human = lobby.players.find((p) => p.id === teamId);
    if (human) return human.teamName;
    const bot = lobby.bots.find((b) => b.id === teamId);
    return bot ? bot.name : teamId;
  }

  return (
    <div className="draft-room">
      <div className={`draft-turn ${isMyTurn ? 'draft-turn--mine' : ''}`}>
        <span className="draft-turn__role">
          Kolo {draft.currentRound}/{draft.totalRounds}
        </span>
        <span className="draft-turn__text">
          {isMyTurn ? 'Jsi na řadě — vyber libovolného hráče' : `Na řadě: ${draft.currentDrafterName}`}
        </span>
        {isMyTurn && (
          <span className="draft-turn__hint muted">
            Chybí ti: {myOpenRoles.join(', ')}
          </span>
        )}
      </div>

      <div className="draft-grid">
        <section className="panel draft-pool">
          <div className="draft-pool__header">
            <h3>Dostupní hráči</h3>
            <input
              className="search-input"
              placeholder="Hledat jméno..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="role-filter">
            {['ALL', ...ROLES].map((r) => (
              <button
                key={r}
                className={roleFilter === r ? 'role-filter__btn is-active' : 'role-filter__btn'}
                onClick={() => setRoleFilter(r)}
              >
                {r === 'ALL' ? 'Vše' : r}
              </button>
            ))}
          </div>
          <table className="stat-table">
            <thead>
              <tr>
                <th>Hráč</th>
                <th>Role</th>
                <th>Tým</th>
                <th>PR</th>
                <th>LP</th>
                <th>M</th>
                <th>C</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {available
                .slice()
                .sort((a, b) => b.pr - a.pr)
                .map((p) => {
                  const roleAlreadyFilled = isMyTurn && !myOpenRoles.includes(p.role);
                  return (
                    <tr key={p.id} className={roleAlreadyFilled ? 'row--disabled' : ''}>
                      <td>{p.name}</td>
                      <td className="muted">{p.role}</td>
                      <td className="muted">{p.team}</td>
                      <td className="mono">{p.pr}</td>
                      <td className="mono">{p.lp}</td>
                      <td className="mono">{p.m}</td>
                      <td className="mono">{p.c}</td>
                      <td>
                        <button
                          className="btn btn--small"
                          disabled={!isMyTurn || roleAlreadyFilled}
                          title={roleAlreadyFilled ? `Roli ${p.role} už máš obsazenou` : ''}
                          onClick={() => socket.emit('draft:pick', { code: lobby.code, proPlayerId: p.id })}
                        >
                          Vybrat
                        </button>
                      </td>
                    </tr>
                  );
                })}
              {available.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Žádní hráči neodpovídají hledání.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <aside className="panel draft-rosters">
          <h3>Rostery</h3>
          <div className="draft-rosters__list">
            {Object.entries(draft.roster).map(([teamId, roles]) => (
              <div
                key={teamId}
                className={`roster-card ${teamId === myId ? 'roster-card--mine' : ''} ${
                  teamId === draft.currentDrafter ? 'roster-card--active' : ''
                }`}
              >
                <div className="roster-card__title">
                  {displayNameFor(teamId)}
                  {teamId === myId && <span className="pill pill--teal pill--tiny">Ty</span>}
                </div>
                <ul className="roster-card__roles">
                  {ROLES.map((role) => (
                    <li key={role}>
                      <span className="roster-card__role">{role}</span>
                      <span>{roles[role] ? roles[role].name : '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// LEAGUE ROOM - regulérní sezóna, play-off a standings
// ---------------------------------------------------------------------
function LeagueRoom({
  lobby,
  isHost,
  myId,
  myRoster,
  leagueInfo,
  roundResults,
  standings,
  regularSeasonComplete,
  playoff,
  finished,
}) {
  const lastRound = roundResults[roundResults.length - 1];
  const roundsPlayed = roundResults.length;
  const totalRounds = leagueInfo?.totalRounds ?? 0;

  const myPlayerIds = new Set(
    myRoster ? Object.values(myRoster).filter(Boolean).map((p) => p.id) : []
  );

  return (
    <div className="league-room">
      {finished && <ChampionBanner finished={finished} />}

      <section className="panel league-controls">
        <div>
          <h2>
            {finished
              ? 'Liga dokončena'
              : playoff
              ? 'Play-off probíhá'
              : regularSeasonComplete
              ? 'Regulérní sezóna dokončena'
              : 'Regulérní sezóna probíhá'}
          </h2>
          {!playoff && !finished && (
            <p className="muted">
              Odehráno {roundsPlayed} / {totalRounds} kol.
            </p>
          )}
        </div>

        {isHost && !finished && !playoff && !regularSeasonComplete && (
          <div className="league-controls__buttons">
            <button
              className="btn"
              onClick={() => socket.emit('league:simulateRound', { code: lobby.code })}
            >
              Simulovat další kolo
            </button>
            <button
              className="btn btn--primary"
              onClick={() => socket.emit('league:simulateAll', { code: lobby.code })}
            >
              Dohrát sezónu
            </button>
          </div>
        )}

        {isHost && regularSeasonComplete && !playoff && (
          <button
            className="btn btn--primary"
            onClick={() => socket.emit('league:startPlayoffs', { code: lobby.code })}
          >
            Spustit play-off
          </button>
        )}

        {isHost && playoff && !playoff.complete && (
          <div className="league-controls__buttons">
            <button
              className="btn"
              onClick={() => socket.emit('league:simulatePlayoffRound', { code: lobby.code })}
            >
              Simulovat další kolo play-off
            </button>
            <button
              className="btn btn--primary"
              onClick={() => socket.emit('league:simulateAllPlayoffs', { code: lobby.code })}
            >
              Dohrát play-off
            </button>
          </div>
        )}
      </section>

      <div className="league-grid">
        <section className="panel">
          <h3>Průběžné pořadí</h3>
          <StandingsTable standings={standings} highlightId={myId} />
        </section>

        <section className="panel">
          {playoff ? (
            <PlayoffBracket playoff={playoff} myPlayerIds={myPlayerIds} />
          ) : lastRound ? (
            <>
              <h3>
                Kolo {lastRound.round} / {lastRound.totalRounds}
              </h3>
              <div className="match-list">
                {lastRound.matches.map((m, i) => (
                  <MatchCard key={i} match={m} myPlayerIds={myPlayerIds} />
                ))}
              </div>
            </>
          ) : (
            <>
              <h3>Zatím žádné odehrané kolo</h3>
              <p className="muted">Spusť simulaci kola a výsledky se zobrazí tady.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ChampionBanner({ finished }) {
  const isSameTeam = finished.playoffChampion === finished.topScorer?.name;
  return (
    <div className="champion-banner">
      <div className="champion-banner__row">
        <span className="champion-banner__label">Vítěz play-off</span>
        <span className="champion-banner__value champion-banner__value--gold">
          {finished.playoffChampion}
        </span>
      </div>
      {!isSameTeam && (
        <div className="champion-banner__row">
          <span className="champion-banner__label">Nejvíc bodů celkem</span>
          <span className="champion-banner__value">{finished.topScorer?.name}</span>
          <span className="mono champion-banner__points">
            {finished.topScorer?.points.toFixed(2)} b
          </span>
        </div>
      )}
    </div>
  );
}

function BracketMatch({ match }) {
  const pending = !match.teamAId || !match.teamBId;
  return (
    <div className="bracket__match">
      <div className="bracket__match-label">{match.label}</div>
      {pending ? (
        <p className="muted bracket__pending">Čeká na soupeře z předchozího kola.</p>
      ) : (
        <>
          <div className={match.winnerId === match.teamAId ? 'bracket__team bracket__team--won' : 'bracket__team'}>
            {match.seedA && <span className="mono bracket__seed">#{match.seedA}</span>} {match.teamA}
          </div>
          <div className={match.winnerId === match.teamBId ? 'bracket__team bracket__team--won' : 'bracket__team'}>
            {match.seedB && <span className="mono bracket__seed">#{match.seedB}</span>} {match.teamB}
          </div>
        </>
      )}
    </div>
  );
}

function PlayoffBracket({ playoff, myPlayerIds }) {
  const { matches } = playoff;
  const resolvedMatches = Object.values(matches).filter((m) => m.result);

  return (
    <div className="bracket">
      <h3>Play-off pavouk — Top 6</h3>

      <div className="bracket__section">
        <div className="bracket__section-title">Horní pavouk</div>
        <BracketMatch match={matches.UB1} />
        <BracketMatch match={matches.UB2} />
        <BracketMatch match={matches.UBF} />
      </div>

      <div className="bracket__section">
        <div className="bracket__section-title">Dolní pavouk</div>
        <BracketMatch match={matches.LB1} />
        <BracketMatch match={matches.LB2} />
        <BracketMatch match={matches.LB3} />
      </div>

      <div className="bracket__section">
        <div className="bracket__section-title">Grand Finále</div>
        <BracketMatch match={matches.GF} />
      </div>

      {playoff.fifthPlace && (
        <p className="muted bracket__note">
          5.–6. místo: {playoff.fifthPlace} (vyřazen/a hned v 1. kole dolního pavouka)
        </p>
      )}

      {resolvedMatches.length > 0 && (
        <div className="match-list bracket__details">
          {resolvedMatches.map((m) => (
            <MatchCard key={m.id} match={m.result} myPlayerIds={myPlayerIds} />
          ))}
        </div>
      )}
    </div>
  );
}

function StandingsTable({ standings, highlightId }) {
  return (
    <table className="stat-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Tým</th>
          <th>V-P</th>
          <th>Body</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((s, i) => (
          <tr key={s.teamId} className={s.teamId === highlightId ? 'row--mine' : ''}>
            <td className="mono">{i + 1}</td>
            <td>
              {s.name}
              {s.teamId === highlightId && <span className="pill pill--teal pill--tiny">Ty</span>}
            </td>
            <td className="mono muted">
              {s.wins}-{s.losses}
            </td>
            <td className="mono">{s.points.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MatchCard({ match, myPlayerIds }) {
  const allPlayers = [...match.teamA.players, ...match.teamB.players];
  const myPlayersInMatch = myPlayerIds
    ? allPlayers.filter((p) => myPlayerIds.has(p.id))
    : [];
  const involvesMe = myPlayersInMatch.length > 0;

  const [open, setOpen] = useState(involvesMe);
  const isPlayoffMatch = match.pointsMultiplier && match.pointsMultiplier !== 1;

  return (
    <div className={involvesMe ? 'match-card match-card--mine' : 'match-card'}>
      <button className="match-card__header" onClick={() => setOpen((o) => !o)}>
        <span>
          <strong>{match.teamA.name}</strong> vs <strong>{match.teamB.name}</strong>
          {involvesMe && <span className="match-card__mine-note">Tvůj zápas</span>}
        </span>
        <span className="pill">
          {match.winner} vyhrál • {match.durationMinutes} min
          {isPlayoffMatch && ' • ×1.5 body'}
        </span>
      </button>
      {open && (
        <div className="match-card__body">
          <p className="muted">
            Gold Lead: {match.earlyGame.goldLeadTeam} (náskok {match.earlyGame.goldLeadMargin}) → Fighting
            Power bonus +{match.fightingPowerBonusPct}%
          </p>
          {[match.teamA, match.teamB].map((team) => (
            <div key={team.name} className="match-card__team">
              <div className="match-card__team-title">
                {team.name} {team.won && <span className="pill pill--gold">Výhra</span>}
              </div>
              <table className="stat-table stat-table--compact">
                <thead>
                  <tr>
                    <th>Hráč</th>
                    <th>Role</th>
                    <th>K</th>
                    <th>D</th>
                    <th>A</th>
                    <th>CS</th>
                    <th>VS</th>
                    <th>FP</th>
                  </tr>
                </thead>
                <tbody>
                  {team.players.map((p) => (
                    <tr key={p.id} className={myPlayerIds?.has(p.id) ? 'row--mine' : ''}>
                      <td>
                        {p.name}
                        {myPlayerIds?.has(p.id) && <span className="pill pill--teal pill--tiny">Tvůj</span>}
                        {p.firstBlood && <span className="pill pill--tiny">FB</span>}
                        {p.quadraKills > 0 && <span className="pill pill--tiny">QK</span>}
                        {p.pentaKills > 0 && <span className="pill pill--tiny">PK</span>}
                      </td>
                      <td className="muted">{p.role}</td>
                      <td className="mono">{p.kills}</td>
                      <td className="mono">{p.deaths}</td>
                      <td className="mono">{p.assists}</td>
                      <td className="mono">{p.cs}</td>
                      <td className="mono">{p.visionScore}</td>
                      <td className="mono">{(p.creditedFantasyPoints ?? p.fantasyPoints).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
