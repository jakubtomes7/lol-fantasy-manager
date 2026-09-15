// game/draftManager.js
// Řídí Fázi 1 (Snake Draft mezi reálnými hráči) a Fázi 2 (automatický
// bot draft podle atributu PR).
//
// Draft je VOLNÝ - hráč na tahu si může vybrat KTERÉHOKOLIV volného
// pro-hráče z libovolné role. Jediné omezení: roli, kterou už má ve
// svém rosteru obsazenou, si nemůže vybrat znovu. Draft trvá přesně
// 5 kol na hráče (= 5 rolí v rosteru); v každém kole udělá každý reálný
// hráč jeden pick, pořadí se dle snake draftu mezi koly obrací.

const { PLAYERS, ROLES } = require('../data/players');

const ROUNDS_PER_MANAGER = ROLES.length; // 5 - jedno kolo na roli v rosteru

class DraftManager {
  /**
   * @param {Array} managerIds - pole ID manažerů (reální hráči), v pořadí draftu (kolo 1)
   * @param {Array} allTeamIds - pole VŠECH 10 ID týmů (reální hráči + boti), pro fázi 2
   * @param {Function} isBot - (teamId) => boolean
   */
  constructor(managerIds, allTeamIds, isBot) {
    this.humanOrder = [...managerIds];
    this.allTeamIds = [...allTeamIds];
    this.isBot = isBot;

    this.roster = {}; // teamId -> { TOP: player|null, JNG: ..., ... }
    for (const id of this.allTeamIds) {
      this.roster[id] = { TOP: null, JNG: null, MID: null, ADC: null, SUP: null };
    }

    this.draftedPlayerIds = new Set();
    this.roundIndex = 0; // 0..4 - kolikáté kolo (= kolikátý pick dělá každý manažer)
    this.pickIndexInRound = 0; // pozice v rámci aktuálního kola
    this.phase = 'HUMAN_DRAFT'; // 'HUMAN_DRAFT' | 'BOT_DRAFT' | 'COMPLETE'
    this.pickLog = [];

    this._updateCurrentOrder();
  }

  _updateCurrentOrder() {
    // Snake: sudé kolo (0-indexed) = pořadí tak jak přišli,
    // liché kolo = obrácené pořadí.
    const reversed = this.roundIndex % 2 === 1;
    this.currentOrder = reversed ? [...this.humanOrder].reverse() : [...this.humanOrder];
  }

  getCurrentDrafterId() {
    if (this.phase !== 'HUMAN_DRAFT') return null;
    return this.currentOrder[this.pickIndexInRound];
  }

  // Role, které daný tým ještě nemá obsazené - tedy role, ze kterých
  // si ještě smí vybírat.
  getOpenRolesFor(teamId) {
    const roster = this.roster[teamId];
    if (!roster) return [];
    return ROLES.filter((role) => roster[role] === null);
  }

  // Všichni dosud nevydraftovaní pro-hráči, napříč všemi rolemi.
  getAvailablePlayers() {
    return PLAYERS.filter((p) => !this.draftedPlayerIds.has(p.id));
  }

  getAvailablePlayersForRole(role) {
    return PLAYERS.filter((p) => p.role === role && !this.draftedPlayerIds.has(p.id));
  }

  /**
   * Reálný hráč provede pick - libovolný volný pro-hráč, jehož roli
   * ještě nemá obsazenou.
   * @param {string} teamId
   * @param {string} proPlayerId
   * @returns {Object} { success, error?, ... }
   */
  pick(teamId, proPlayerId) {
    if (this.phase !== 'HUMAN_DRAFT') {
      return { success: false, error: 'Draft mezi hráči už skončil.' };
    }
    const expectedDrafter = this.getCurrentDrafterId();
    if (teamId !== expectedDrafter) {
      return { success: false, error: 'Nejsi na řadě.' };
    }

    const player = PLAYERS.find((p) => p.id === proPlayerId);
    if (!player) return { success: false, error: 'Neexistující hráč.' };
    if (this.draftedPlayerIds.has(player.id)) {
      return { success: false, error: 'Tento pro-hráč už byl vydraftován.' };
    }
    if (this.roster[teamId][player.role] !== null) {
      return { success: false, error: `Roli ${player.role} už máš ve svém rosteru obsazenou.` };
    }

    this.roster[teamId][player.role] = player;
    this.draftedPlayerIds.add(player.id);
    this.pickLog.push({ teamId, player, role: player.role, phase: 'HUMAN' });

    this._advance();

    return {
      success: true,
      player,
      role: player.role,
      nextDrafter: this.getCurrentDrafterId(),
      phase: this.phase,
    };
  }

  _advance() {
    this.pickIndexInRound += 1;

    if (this.pickIndexInRound >= this.currentOrder.length) {
      // konec kola -> další kolo
      this.pickIndexInRound = 0;
      this.roundIndex += 1;

      if (this.roundIndex >= ROUNDS_PER_MANAGER) {
        // Fáze 1 hotová (každý reálný hráč má obsazených všech 5 rolí)
        // -> spustit Fázi 2 (boti)
        this.phase = 'BOT_DRAFT';
        this._runBotDraft();
        return;
      }
      this._updateCurrentOrder();
    }
  }

  // Fáze 2: boti doberou zbývající role podle nejvyššího PR mezi
  // volnými hráči dané role. Pořadí, ve kterém boti draftují, je dáno
  // pořadím jejich ID; role se probírají TOP -> SUP.
  _runBotDraft() {
    const teamsNeedingPicks = this.allTeamIds.filter((id) =>
      Object.values(this.roster[id]).some((slot) => slot === null)
    );

    for (const role of ROLES) {
      for (const teamId of teamsNeedingPicks) {
        if (this.roster[teamId][role] !== null) continue;

        const available = this.getAvailablePlayersForRole(role);
        if (available.length === 0) continue; // nemělo by nastat (10 hráčů na roli / max 10 týmů)

        available.sort((a, b) => b.pr - a.pr);
        const best = available[0];

        this.roster[teamId][role] = best;
        this.draftedPlayerIds.add(best.id);
        this.pickLog.push({ teamId, player: best, role, phase: 'BOT' });
      }
    }

    this.phase = 'COMPLETE';
  }

  getState() {
    const currentDrafter = this.getCurrentDrafterId();
    return {
      phase: this.phase,
      currentRound: this.phase === 'HUMAN_DRAFT' ? this.roundIndex + 1 : null,
      totalRounds: ROUNDS_PER_MANAGER,
      currentDrafter,
      openRolesForCurrentDrafter: currentDrafter ? this.getOpenRolesFor(currentDrafter) : [],
      roster: this.roster,
      pickLog: this.pickLog,
    };
  }
}

module.exports = DraftManager;
