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
      sock.emit?.('err', 'Illegal play');
      return;
    }

    cards.forEach(c => this.playPile.push(c));
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
        this.pushState();
        const nextPlayer = this.byId(this.turn);
        if (nextPlayer && nextPlayer.isComputer) {
            setTimeout(() => this.computerTurn(nextPlayer.id), 300);
        }
    };

    const effectDelay = 1000; // Original delay for animation/effect display
    const burnDisplayDelay = 2000; // New delay to show empty pile after burn

    if (String(playedValue) === '10' || isFourOfAKind) {
        this.io.emit('specialEffect', { value: 10, type: isFourOfAKind ? 'four' : 'ten' });

        // Immediately clear the pile and push state to show it empty
        console.log(`[DEBUG play] Burn effect triggered. Clearing pile immediately.`);
        this.discard = (this.discard || []).concat(this.playPile.splice(0));
        this.lastRealCard = null; // Pile is cleared, so no last card
        this.pushState(); // Push state showing the empty pile

        // Wait for the burn display delay
        setTimeout(() => {
            if (!this.started) return; // Check if game reset during delay
            console.log(`[DEBUG play] Burn display delay finished. Drawing next card.`);
            
            // Draw the next card if available
            if (this.deck.length > 0) {
                const nextCard = this.draw();
                this.playPile.push(nextCard);
                 if (![2, 5, 10, '2', '5', '10'].includes(nextCard.value)) {
                    this.lastRealCard = nextCard;
                 } else {
                    // If the new card is special, recursively handle its effect? 
                    // For now, just don't set lastRealCard and let the next player deal with it.
                    this.lastRealCard = null;
                    // TODO: Consider if drawing a 10/5/2 here needs immediate handling
                 }
                 console.log(`[DEBUG play] Placed ${nextCard.value} after burn.`);
            } else {
                 this.lastRealCard = null; // Deck empty
                 console.log(`[DEBUG play] Deck empty after burn.`);
            }
            
            // Finish the turn (refill, advance, push final state)
            finishTurn(); 

        }, burnDisplayDelay);

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
    if (!computer || computer.disconnected || this.turn !== computer.id) return;

    // Increase the delay before the computer starts thinking
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
    }
    this.pushState();

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

    // --- Step 1: Initial Setup (Deal Cards, NO Play Pile Card Yet) ---
    this.started = true;
    this.buildDeck();
    this.deal();
    this.turn = null; // IMPORTANT: No turn assigned yet
    this.playPile = []; // IMPORTANT: Ensure play pile is explicitly empty
    this.lastRealCard = null;

    // --- Step 2: Send Initial State (Empty Pile) ---
    this.pushState(); // Push state with hands dealt, empty pile
    console.log(`Initial state (cards dealt, empty pile) pushed. Waiting 2 seconds.`);

    // --- Step 3: Wait 2 Seconds ---
    setTimeout(() => {
        if (!this.started || !this.players.length) {
            console.log("Game reset or players left during initial delay. Aborting turn start.");
            return;
        }
        console.log(`2-second delay finished. Drawing initial card...`);

        // Draw the first card
        let initialCard = this.draw();

        if (initialCard) {
            this.playPile.push(initialCard);
            console.log(`Initial card ${initialCard.value} drawn and placed. Pushing state.`);
            this.pushState(); // Show the card in the pile
        } else {
            console.error("Deck empty when drawing initial card.");
            this.turn = this.players[0].id;
            this.pushState();
            const firstPlayer = this.byId(this.turn);
            if (firstPlayer && firstPlayer.isComputer) {
                setTimeout(() => { if (this.started && this.turn === firstPlayer.id) this.computerTurn(firstPlayer.id); }, 500);
            }
            return;
        }

        if (String(initialCard.value) === '10') {
            console.log("[DEBUG startGame] Initial card is 10. Emitting effect and delaying burn process.");
            this.io.emit('specialEffect', { value: 10, type: 'ten' });
            setTimeout(() => {
                if (!this.started || !this.players.length) return;
                console.log("[DEBUG startGame] Processing burn for initial 10.");
                this.discard = (this.discard || []).concat(this.playPile.splice(0));
                this.lastRealCard = null;
                // Draw the next non-10 card
                let nextCard = null;
                while (this.deck.length > 0) {
                    nextCard = this.draw();
                    if (String(nextCard.value) === '10') {
                        console.log("[DEBUG startGame] Discarding subsequent 10.");
                        this.discard.push(nextCard);
                        this.io.emit('specialEffect', { value: 10, type: 'ten' });
                        nextCard = null;
                    } else {
                        break;
                    }
                }
                if (nextCard) {
                    this.playPile.push(nextCard);
                    if (![2, 5, '2', '5'].includes(nextCard.value)) {
                        this.lastRealCard = nextCard;
                    }
                    console.log(`Actual starting card ${nextCard.value} placed after initial 10 burn.`);
                } else {
                    console.error("Deck ran out while drawing actual starting card after initial 10.");
                    this.lastRealCard = null;
                }
                this.turn = this.players[0].id;
                console.log(`First turn assigned to: ${this.players[0].name} after initial 10 burn.`);
                this.pushState();
                const firstPlayer = this.byId(this.turn);
                if (firstPlayer && firstPlayer.isComputer) {
                    setTimeout(() => { if (this.started && this.turn === firstPlayer.id) this.computerTurn(firstPlayer.id); }, 500);
                }
            }, 2000); // 2s delay to show the 10 before burn
        } else {
            if (![2, 5, '2', '5'].includes(initialCard.value)) {
                this.lastRealCard = initialCard;
            }
            this.turn = this.players[0].id;
            console.log(`First turn assigned to: ${this.players[0].name}`);
            this.pushState();
            const firstPlayer = this.byId(this.turn);
            if (firstPlayer && firstPlayer.isComputer) {
                setTimeout(() => { if (this.started && this.turn === firstPlayer.id) this.computerTurn(firstPlayer.id); }, 500);
            }
        }
    }, 2000); // Initial 2-second delay before anything happens
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

  byId(id) {
    return this.players.find(p => p.id === id && !p.disconnected);
  }

  rank(c) {
    const v = String(c.value).toUpperCase();
    if (v === '2') return 2;
    return { 'J': 11, 'Q': 12, 'K': 13, 'A': 14 }[v] ?? parseInt(v);
  }

  valid(cards) {
    // --- DEBUG LOGGING for 4-of-a-kind ---
    if (cards.length === 4) {
      console.log(`[DEBUG valid] Checking four cards: ${JSON.stringify(cards.map(c => c.value))}. Should return true.`);
      // Explicitly return true here just in case something weird is happening below
      return true;
    }
    // --- END DEBUG LOGGING ---

    if (!cards.length || !cards.every(c => c.value === cards[0].value)) return false;
    // Allow special cards (2, 5, 10) regardless of rank
    if (new Set([2, 5, 10, '2', '5', '10']).has(cards[0].value)) return true;
    const t = this.top();
    if (!t) return true; // Allow any card on an empty pile
    // Otherwise, the card must be higher rank
    const isValidRank = this.rank(cards[0]) > this.rank(t);
    // --- DEBUG LOGGING for rank comparison ---
    if (!isValidRank) {
        console.log(`[DEBUG valid] Rank check failed: Card ${cards[0].value} (rank ${this.rank(cards[0])}) vs Pile ${t.value} (rank ${this.rank(t)})`);
    }
    // --- END DEBUG LOGGING ---
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

    if (currentPlayer && !this.hasMove(currentPlayer)) {
      const noticeMsg = `${currentPlayer.name} must take the pile.`;
      if (currentPlayer.sock && !currentPlayer.isComputer) {
        console.log(`[DEBUG pushState] Emitting notice to human ${currentPlayer.id}: ${noticeMsg}`);
        currentPlayer.sock.emit('notice', noticeMsg);
      } else if (currentPlayer.isComputer) {
        console.log(`[DEBUG pushState] Computer ${currentPlayer.id} must take pile. Broadcasting notice.`);
        this.players.forEach(p => {
          if (p.id !== currentPlayer.id && p.sock && !p.isComputer) {
            p.sock.emit('notice', noticeMsg);
          }
        });
        console.log(`[DEBUG pushState] Triggering computer ${currentPlayer.id} to take pile immediately.`);
        setTimeout(() => this.takePile({ id: currentPlayer.id }), 50); 
      }
    } else if (currentPlayer && currentPlayer.sock) {
      console.log(`[DEBUG pushState] Clearing notice for ${currentPlayer.id}.`);
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
