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
    const p = this.findPlayerById(sock.id);
    console.log(`[DEBUG play] play() called by ${p ? p.name : 'unknown'} (${sock.id}) with idxs: ${JSON.stringify(idxs)}. Current turn: ${this.turn}`);
    if (!p || p.disconnected || (this.turn !== p.id)) { // Simplified turn check
        return;
    }

    const cards = idxs.map(i => {
      if (i === 2000) return p.down[0];
      if (i >= 1000) return p.up[i - 1000];
      return p.hand[i];
    });
    if (!cards.every(c => c)) {
        sock.emit?.('err', 'Invalid card selection');
        return;
    }

    if (!this.valid(cards)) {
      console.log(`[DEBUG play] Invalid play attempted by ${p ? p.name : 'unknown'} (${sock.id}) with cards: ${JSON.stringify(cards)}. Current turn: ${this.turn}`);
      sock.emit?.('err', 'Illegal play');
      return;
    }

    cards.forEach(c => this.playPile.push(c));
    console.log(`[DEBUG play] ${p ? p.name : 'unknown'} played cards: ${JSON.stringify(cards)}. New playPile: ${JSON.stringify(this.playPile)}. Turn: ${this.turn}`);
    const playedValue = cards[0].value;
    const isFourOfAKind = cards.length === 4;

    if (![2, 5, 10, '2', '5', '10'].includes(playedValue) && !isFourOfAKind) {
        this.lastRealCard = cards[0];
    }

    p.hand = p.hand.filter((_, i) => !idxs.includes(i));
    if (idxs.some(i => i >= 1000 && i < 2000)) {
      p.up = p.up.filter((_, i) => !idxs.includes(i + 1000));
    }
    if (idxs.some(i => i >= 2000)) {
      p.down.shift();
    }

    const finishTurn = () => {
        this.refill(p);
        this.advanceTurn();
        console.log(`[DEBUG finishTurn] Advancing turn. New turn: ${this.turn}`);
        this.pushState();
        const nextPlayer = this.byId(this.turn);
        if (nextPlayer && nextPlayer.isComputer) {
            // Wait 2 seconds after a special effect, otherwise 1.5s
            const delay = (String(playedValue) === '10' || isFourOfAKind || String(playedValue) === '5') ? 2000 : 1500;
            setTimeout(() => this.computerTurn(nextPlayer.id), delay);
        }
    };

    const effectDelay = 2000; // 2 seconds for 10/four-of-a-kind burn

    if (String(playedValue) === '10' || isFourOfAKind) {
        this.io.emit('specialEffect', { value: 10, type: isFourOfAKind ? 'four' : 'ten' });
        this.pushState();
        setTimeout(() => {
            console.log(`[DEBUG play] Applying delayed burn effect.`);
            this.discard = (this.discard || []).concat(this.playPile.splice(0));
            if (this.deck.length > 0) {
                const nextCard = this.draw();
                this.playPile.push(nextCard);
                 if (![2, 5, 10, '2', '5', '10'].includes(nextCard.value)) {
                    this.lastRealCard = nextCard;
                 } else {
                    this.lastRealCard = null;
                 }
            } else {
                 this.lastRealCard = null;
            }
            finishTurn();
        }, effectDelay);

    } else if (String(playedValue) === '5') {
        this.io.emit('specialEffect', { value: 5, type: 'five' });
        this.pushState();
        setTimeout(() => {
            console.log(`[DEBUG play] Applying delayed copy effect.`);
            if (this.lastRealCard) {
                this.playPile.push({ ...this.lastRealCard, copied: true });
            }
            finishTurn();
        }, effectDelay);

    } else if (String(playedValue) === '2') {
        this.io.emit('specialEffect', { value: 2, type: 'two' });
        finishTurn();

    } else {
        finishTurn();
    }
  }

  computerTurn(computerId = 'computer') {
    const computer = this.findPlayerById(computerId);
    console.log(`[DEBUG computerTurn] Called for ${computerId}. Current turn: ${this.turn}`);
    if (!computer || computer.disconnected || this.turn !== computer.id) return;

    setTimeout(() => {
      const t = this.effectiveTop();
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
    }, 1500); // Changed delay to 1500ms (1.5 seconds)
  }

  takePile(sock) {
    const p = this.findPlayerById(sock.id);
    if (!p || p.disconnected || this.turn !== p.id) return;
    this.givePile(p, 'You picked up the pile');
    if (p.sock && !p.isComputer) {
      this.players.forEach(other => {
        if (other.id !== p.id && other.sock) {
          other.sock.emit('opponentTookPile', { playerId: p.id });
        }
      });
    } else if (p.isComputer && !sock.skipNotice) {
      this.players.forEach(other => {
        if (other.sock && !other.isComputer) {
          other.sock.emit('notice', `${p.name} must take the pile.`);
        }
      });
    }
    this.pushState();

    // Prevent immediate re-invocation of computerTurn for the same computer
    const nextPlayer = this.byId(this.turn);
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
        return;
    }
    console.log(`Starting game setup for players: ${this.players.map(p => p.name).join(', ')}`);

    // --- Initial Setup (No Card Yet) ---
    this.started = true;
    this.buildDeck();
    this.deal();
    this.turn = null; // No turn yet
    this.playPile = []; // Ensure play pile is empty initially
    this.lastRealCard = null;
    this.pushState(); // Push state with hands dealt, empty pile
    console.log(`Initial empty state pushed. Waiting 2 seconds before placing first card.`);

    // --- Wait 2 seconds before placing the first card ---
    setTimeout(() => {
      if (!this.started) return; // Check if game was reset during delay
      console.log(`Placing initial card...`);
      let initialCard = null;
      while (this.deck.length > 0) {
        initialCard = this.draw();
        if (String(initialCard.value) === '10') {
          // Place the 10 on the pile, push state, then burn after 2 seconds
          this.playPile.push(initialCard);
          this.lastRealCard = null;
          this.pushState();
          this.io.emit('specialEffect', { value: 10, type: 'ten' });
          setTimeout(() => {
            this.discard = (this.discard || []).concat(this.playPile.splice(0));
            // Draw a new card to start the pile if possible
            let nextCard = null;
            while (this.deck.length > 0) {
              nextCard = this.draw();
              if (String(nextCard.value) !== '10') break;
              this.discard = (this.discard || []).concat(nextCard);
              this.io.emit('specialEffect', { value: 10, type: 'ten' });
              nextCard = null;
            }
            if (nextCard) {
              this.playPile.push(nextCard);
              if (![2, 5, '2', '5'].includes(nextCard.value)) {
                this.lastRealCard = nextCard;
              }
            } else {
              this.lastRealCard = null;
            }
            this.pushState();
            // Wait 2 seconds before starting the first turn
            setTimeout(() => {
              if (!this.started || !this.players.length) return;
              this.turn = this.players[0].id;
              this.pushState();
              const firstPlayer = this.byId(this.turn);
              if (firstPlayer && firstPlayer.isComputer) {
                this.computerTurn(firstPlayer.id);
              }
            }, 2000);
          }, 2000); // Show the 10 for 2 seconds before burning
          return;
        } else {
          break;
        }
      }
      if (initialCard) {
        this.playPile.push(initialCard); // Place the card
        if (![2, 5, '2', '5'].includes(initialCard.value)) {
          this.lastRealCard = initialCard;
        }
        this.pushState();
      } else {
        this.lastRealCard = null;
      }
      // Wait 2 seconds before starting the first turn
      setTimeout(() => {
        if (!this.started || !this.players.length) return;
        this.turn = this.players[0].id;
        this.pushState();
        const firstPlayer = this.byId(this.turn);
        if (firstPlayer && firstPlayer.isComputer) {
          this.computerTurn(firstPlayer.id);
        }
      }, 2000);
    }, 2000); // 2-second delay before placing the first card
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
    for (let i = 0; i < 3; i++) {
      this.players.forEach(p => {
        p.down.push(this.draw());
      });
    }
    for (let i = 0; i < 3; i++) {
      this.players.forEach(p => {
        p.up.push(this.draw());
      });
    }
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

  effectiveTop() {
    const t = this.top();
    if (!t) return null;
    if (t.value === 5 && t.copied && this.lastRealCard) {
      return { ...this.lastRealCard, copied: true };
    }
    return t;
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
    if (cards.length === 4) {
      console.log(`[DEBUG valid] Checking four cards: ${JSON.stringify(cards.map(c => c.value))}. Should return true.`);
      return true;
    }

    if (!cards.length || !cards.every(c => c.value === cards[0].value)) return false;
    if (new Set([2, 5, 10, '2', '5', '10']).has(cards[0].value)) return true;
    const t = this.effectiveTop();
    if (!t) return true;
    const isValidRank = this.rank(cards[0]) > this.rank(t);
    if (!isValidRank) {
        console.log(`[DEBUG valid] Rank check failed: Card ${cards[0].value} (rank ${this.rank(cards[0])}) vs Pile ${t.value} (rank ${this.rank(t)})`);
    }
    return isValidRank;
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
    if (p.hand.length > 0) {
      if (p.hand.some(c => this.valid([c]))) {
        return true;
      }
      return false;
    }

    if (p.up.length > 0) {
      if (p.up.some(c => this.valid([c]))) {
        return true;
      }
    }

    if (p.down.length > 0) {
      return true;
    }

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
    const currentPlayer = this.byId(this.turn);

    // Only show the 'must take pile' notice if it's a human player's turn
    if (currentPlayer && !this.hasMove(currentPlayer)) {
      if (currentPlayer.sock && !currentPlayer.isComputer) {
        const noticeMsg = `${currentPlayer.name} must take the pile.`;
        currentPlayer.sock.emit('notice', noticeMsg);
      } else if (currentPlayer.isComputer) {
        // Do not emit notice here, just trigger the computer to take the pile
        setTimeout(() => this.takePile({ id: currentPlayer.id, skipNotice: true }), 50);
        // Do not emit notice here
        return; // Prevent further state push until after takePile
      }
    } else if (currentPlayer && currentPlayer.sock) {
      currentPlayer.sock.emit('notice', '');
    }

    this.players.forEach(targetPlayer => {
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
            disconnected: p.disconnected,
            hand: p.id === targetPlayer.id ? p.hand : [],
            handCount: p.hand.length,
            up: p.up,
            down: p.id === targetPlayer.id ? p.down : p.down.map(() => ({ back: true })),
            downCount: p.down.length
          })),
          started: this.started
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
