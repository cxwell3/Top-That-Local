export class Game {
  constructor(io) {
    this.io = io;
    this.MAX_PLAYERS = 4; // Max players (can be adjusted)
    this.reset();
  }

  addPlayer(sock, name = 'Player') {
    if (this.started) {
      sock.emit('err', 'Game already started');
      return false;
    }
    if (this.players.length >= this.MAX_PLAYERS) {
      sock.emit('err', 'Game room is full');
      return false;
    }

    this.players.push({ id: sock.id, sock, name, hand: [], up: [], down: [], disconnected: false }); // Initialize disconnected
    sock.emit('joined', { id: sock.id });

    // Remove startGame call from here
    // this.io.emit('lobby', this.players.map(p => ({ id: p.id, name: p.name }))); // Lobby update handled by server
    // if (this.players.length >= 2) this.startGame();
    return true;
  }

  addComputerPlayer() {
    if (this.started) {
      console.warn('Attempted to add computer player after game started.');
      return false;
    }
    if (this.players.length >= this.MAX_PLAYERS) {
      console.warn('Attempted to add computer player to a full game.');
      return false;
    }

    const computerCount = this.players.filter(p => p.isComputer).length;
    const computerId = `computer_${computerCount + 1}`;
    const computerName = `CPU ${computerCount + 1}`;

    console.log(`Adding computer player: ${computerName} (${computerId})`);
    this.players.push({
      id: computerId,
      name: computerName,
      isComputer: true,
      hand: [],
      up: [],
      down: [],
      disconnected: false // Initialize disconnected
    });

    // Remove startGame call from here
    // if (this.players.length >= 2) {
    //   this.startGame();
    // }
    return true;
  }

  markPlayerDisconnected(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      console.log(`Marking player ${player.name} (${player.id}) as disconnected.`);
      player.disconnected = true;
      player.sock = null; // Remove socket reference
    }
  }

  findPlayerById(playerId) {
    return this.players.find(p => p.id === playerId);
  }

  play(sock, idxs) {
    const p = this.findPlayerById(sock.id); // Use findPlayerById
    if (!p || p.disconnected || (this.turn !== p.id && p.id !== 'computer')) return;

    // Prevent playing up and down cards together
    const isUpPlay = idxs.some(i => i >= 1000 && i < 2000);
    const isDownPlay = idxs.some(i => i >= 2000);
    if (isUpPlay && isDownPlay) {
      sock.emit('err', 'You cannot play up and down cards together');
      return;
    }

    // Enforce: all up cards must be played before down cards
    if (isDownPlay && p.up.length > 0) {
      sock.emit('err', 'You must play all face-up cards before playing face-down cards');
      return;
    }

    // Enforce: all hand cards must be played before up cards
    if (isUpPlay && p.hand.length > 0) {
      sock.emit('err', 'You must play all hand cards before playing face-up cards');
      return;
    }

    // If player has picked up the pile while in up/down phase, they must play all hand cards before returning to up/down
    // (This is already enforced by the above, but let's make it explicit)
    if ((isUpPlay || isDownPlay) && p.hand.length > 0) {
      sock.emit('err', 'You must play all hand cards before playing up or down cards');
      return;
    }

    const cards = idxs.map(i => {
      if (i === 2000) return p.down[0];
      if (i >= 1000) return p.up[i - 1000];
      return p.hand[i];
    });

    if (!this.valid(cards)) {
      sock.emit('err', 'Illegal play');
      return;
    }

    cards.forEach(c => this.playPile.push(c));

    if (![2, 5, 10].includes(cards[0].value) && cards.length < 4) {
      this.lastRealCard = cards[0];
    }

    p.hand = p.hand.filter((_, i) => !idxs.includes(i));
    // Only filter up cards if an up card index was played
    if (idxs.some(i => i >= 1000 && i < 2000)) {
      p.up = p.up.filter((_, i) => !idxs.includes(i + 1000));
    }
    // Only shift down card if a down card index was played
    if (idxs.some(i => i >= 2000)) {
      p.down.shift();
    }

    // Push state immediately to show card on pile
    this.pushState();

    const isSpecialPlay = [2, 5, 10].includes(cards[0].value) || cards.length === 4;
    const delayDuration = 800; // ms delay for computer special plays

    // Define the rest of the play logic as a function
    const finishPlay = () => {
      this.applySpecial(cards); // Apply effects (like burning pile)
      this.refill(p);           // Refill hand
      this.advanceTurn();       // Advance turn
      this.pushState();         // Push final state *after* effects

      // Trigger next computer turn if needed (moved inside finishPlay)
      const nextPlayer = this.byId(this.turn);
      if (nextPlayer && nextPlayer.isComputer) {
        // Add a small delay before the next computer starts thinking
        setTimeout(() => this.computerTurn(nextPlayer.id), 300);
      }
    };

    // Check if it's a computer playing a special card
    if (p.isComputer && isSpecialPlay) {
      // If computer played a special card, delay the rest of the logic
      setTimeout(finishPlay, delayDuration);
    } else {
      // Otherwise (human play or non-special computer play), finish immediately
      finishPlay();
    }
  }

  computerTurn(computerId = 'computer') {
    const computer = this.findPlayerById(computerId); // Use findPlayerById
    if (!computer || computer.disconnected || this.turn !== computer.id) return;

    setTimeout(() => {
      if (computer.hand.length > 0) {
        const wilds = computer.hand
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => [2, 5, 10].includes(card.value));
        const regulars = computer.hand
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => ![2, 5, 10].includes(card.value));
        const playableRegulars = regulars.filter(({ card }) => this.valid([card]));
        const playableWilds = wilds.filter(({ card }) => this.valid([card]));
        let playChoice = null;
        if (playableRegulars.length > 0 && playableWilds.length > 0 && Math.random() < 0.2) {
          playChoice = playableWilds[Math.floor(Math.random() * playableWilds.length)];
        } else if (playableRegulars.length > 0) {
          if (playableRegulars.length > 1 && Math.random() < 0.2) {
            playChoice = playableRegulars[playableRegulars.length - 1];
          } else {
            playChoice = playableRegulars[0];
          }
        } else if (playableWilds.length > 0) {
          const ten = playableWilds.find(({ card }) => card.value === 10);
          if (ten) playChoice = ten;
          else playChoice = playableWilds[0];
        }
        if (playChoice) {
          this.play({ id: computerId }, [playChoice.index]);
          return;
        }
      }
      if (computer.hand.length === 0 && computer.up.length > 0) {
        const playableUpCards = computer.up
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => this.valid([card]));
        if (playableUpCards.length > 0) {
          let playIdx = 0;
          if (playableUpCards.length > 1 && Math.random() < 0.2) {
            playIdx = playableUpCards.length - 1;
          }
          this.play({ id: computerId }, [playableUpCards[playIdx].index + 1000]);
          return;
        }
      }
      if (computer.hand.length === 0 && computer.up.length === 0 && computer.down.length > 0) {
        this.play({ id: computerId }, [2000]);
        return;
      }
      this.takePile({ id: computerId });
    }, 1000);
  }

  takePile(sock) {
    const p = this.findPlayerById(sock.id); // Use findPlayerById
    if (!p || p.disconnected || this.turn !== p.id) return;
    this.givePile(p, 'You picked up the pile');
    if (p.sock && !p.isComputer) {
      this.players.forEach(other => {
        if (other.id !== p.id && other.sock) {
          other.sock.emit('opponentTookPile', { playerId: p.id });
        }
      });
    }
    this.pushState();

    const nextPlayer = this.byId(this.turn);
    // Only trigger next computer turn if the turn actually advanced to a *different* computer player
    if (nextPlayer && nextPlayer.isComputer && nextPlayer.id !== p.id) {
      this.computerTurn(nextPlayer.id);
    }
  }

  startGame() {
    if (this.started) {
      console.warn("startGame called but game already started.");
      return;
    }
    if (this.players.length < 2) {
        console.warn(`startGame called but only ${this.players.length} players present.`);
        return; // Don't start with fewer than 2 players
    }
    console.log(`Starting game with players: ${this.players.map(p => p.name).join(', ')}`);
    this.started = true;
    this.buildDeck();
    this.deal();

    // Draw initial card, handling special cards (10)
    let initialCard = null;
    while (this.deck.length > 0) {
        initialCard = this.draw();
        if (initialCard.value === 10 || initialCard.value === '10') {
            // If it's a 10, discard it and try again
            this.discard = (this.discard || []).concat(initialCard);
            this.io.emit('specialEffect', { value: 10, type: 'ten' }); // Notify clients of the burn
            initialCard = null; // Reset initialCard to continue loop
        } else {
            // It's not a 10, break the loop
            break;
        }
    }

    if (initialCard) {
        this.playPile.push(initialCard);
        // Set lastRealCard if the initial card isn't special
        if (![2, 5, 10, '2', '5', '10'].includes(initialCard.value)) {
            this.lastRealCard = initialCard;
        }
    } else {
        console.error("Deck ran out while trying to draw a non-10 starting card.");
        // Handle this edge case - maybe reset or end game? For now, playPile remains empty.
    }

    this.turn = this.players[0].id; // Start with the first player
    this.pushState(); // Send initial state
    console.log(`Game started. First turn: ${this.players[0].name}`);

    // Check if the first player is a computer and trigger its turn
    const firstPlayer = this.byId(this.turn);
    if (firstPlayer && firstPlayer.isComputer) {
        console.log("First player is computer, initiating turn.");
        this.computerTurn(firstPlayer.id);
    }
  }

  buildDeck() {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const vals = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];
    this.deck = [];
    const numDecks = this.players.length <= 2 ? 1 : 2;
    for (let d = 0; d < numDecks; d++) {
      suits.forEach(s => vals.forEach(v => this.deck.push({ value: v, suit: s })));
    }
    this.shuffle(this.deck);
  }

  deal() {
    // Deal all down cards first
    for (let i = 0; i < 3; i++) {
      this.players.forEach(p => {
        p.down.push(this.draw());
      });
    }
    // Then all up cards
    for (let i = 0; i < 3; i++) {
      this.players.forEach(p => {
        p.up.push(this.draw());
      });
    }
    // Then all hand cards
    for (let i = 0; i < 3; i++) {
      this.players.forEach(p => {
        p.hand.push(this.draw());
      });
    }
    this.players.forEach(p => {
      this.sortHand(p);
      if (p.isComputer) {
        console.log('🤖 Computer player cards:', {
          hand: p.hand.length,
          up: p.up.length,
          down: p.down.length
        });
      }
    });
  }

  draw() {
    return this.deck.pop();
  }

  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  top() {
    return this.playPile.at(-1);
  }

  byId(id) {
    return this.players.find(p => p.id === id && !p.disconnected);
  }

  rank(c) {
    const v = String(c.value).toUpperCase();
    if (v === '2') return 2;
    return { 'J': 11, 'Q': 12, 'K': 13, 'A': 14 }[v] ?? parseInt(v);
  }

  valid(cards) {
    if (!cards.length || !cards.every(c => c.value === cards[0].value)) return false;
    if (new Set([2, 5, 10, '2', '5', '10']).has(cards[0].value)) return true;
    const t = this.top();
    if (!t) return true;
    return this.rank(cards[0]) > this.rank(t);
  }

  applySpecial(cards) {
    const v = cards[0].value;
    if (v === 10 || cards.length === 4) {
      this.discard = (this.discard || []).concat(this.playPile.splice(0));
      if (this.deck.length) this.playPile.push(this.draw());
      this.io.emit('specialEffect', { value: 10, type: cards.length === 4 ? 'four' : 'ten' });
      return;
    }
    if (v === 2) {
      this.io.emit('specialEffect', { value: 2, type: 'two' });
    }
    if (v === 5 && this.lastRealCard) {
      this.playPile.push({ ...this.lastRealCard, copied: true });
      this.io.emit('specialEffect', { value: 5, type: 'five' });
    }
  }

  refill(p) {
    while (p.hand.length < 3 && this.deck.length) {
      p.hand.push(this.draw());
    }
    this.sortHand(p);
  }

  sortHand(p) {
    p.hand.sort((a, b) => this.rank(a) - this.rank(b));
    console.log('🔢 Sorted hand for', p.name, ':', p.hand.map(c => c.value));
  }

  advanceTurn() {
    const currentIndex = this.players.findIndex(p => p.id === this.turn);
    if (currentIndex !== -1) {
      this.turn = this.players[(currentIndex + 1) % this.players.length].id;
    } else if (this.players.length > 0) {
      this.turn = this.players[0].id;
    }
  }

  hasMove(p) {
    if (p.hand.length) return p.hand.some(c => this.valid([c]));
    if (this.deck.length === 0) return p.up.some(c => this.valid([c]));
    if (this.deck.length === 0 && p.up.length === 0 && p.down.length)
      return true;
    return false;
  }

  givePile(p, msg) {
    const pile = this.playPile.splice(0).map(c => {
      const copy = { ...c };
      delete copy.copied;
      return copy;
    });
    p.hand.push(...pile);
    this.sortHand(p);
    if (this.deck.length) this.playPile.push(this.draw());
    if (p.sock) {
      p.sock.emit('notice', msg);
      p.sock.emit('notice', '');
    }
    this.advanceTurn();
  }

  pushState() {
    const currentPlayer = this.byId(this.turn); // Find active player whose turn it is
    if (currentPlayer && !this.hasMove(currentPlayer)) {
      const noticeMsg = `${currentPlayer.name} must take the pile.`;
      if (currentPlayer.sock && !currentPlayer.isComputer) {
        // Only send the specific notice to the human player if it's their turn and they have no moves
        currentPlayer.sock.emit('notice', noticeMsg);
      } else {
        // For computer turns or general state updates, maybe log it or handle differently?
        // For now, we won't emit this specific notice to everyone, only the affected player.
        console.log(`Game Notice (server): ${noticeMsg}`);
      }
    } else if (currentPlayer && currentPlayer.sock) {
      // Clear notice for the current player if they DO have moves
      currentPlayer.sock.emit('notice', '');
    }

    this.players.forEach(targetPlayer => {
      // Only send state to active players
      if (targetPlayer.sock && !targetPlayer.disconnected) {
        targetPlayer.sock.emit('state', {
          deckCount: this.deck.length,
          playPile: this.playPile,
          discardCount: (this.discard || []).length,
          turn: this.turn,
          players: this.players.map(p => ({
            id: p.id,
            name: p.name,
            isComputer: p.isComputer,
            disconnected: p.disconnected, // Include disconnected status
            hand: p.id === targetPlayer.id ? p.hand : [],
            handCount: p.hand.length,
            up: p.up,
            down: p.id === targetPlayer.id ? p.down : p.down.map(() => ({ back: true })),
            downCount: p.down.length
          })),
          started: this.started // <--- Add started flag
        });
      }
    });
  }

  reset() {
    this.players = [];
    this.deck = [];
    this.playPile = [];
    this.discard = [];
    this.turn = null;
    this.started = false;
    this.lastRealCard = null;
  }
}
