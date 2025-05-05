export class Game {
  // Standardized delays (in milliseconds)
  static DELAY_INITIAL_PLACEMENT = 1000;    // delay before first card placement
  static DELAY_SPECIAL_DISPLAY = 1500;      // duration to show special banners (reduced from 2000ms)
  static DELAY_AFTER_PLAY = 300;            // pause after any card is placed before next turn
  static DELAY_FIRST_TURN = 1000;           // delay before starting first turn
  static DELAY_CPU_DECISION = 720;          // time for CPU to "think" before playing

  constructor(io) {
    this.io = io;
    this.roomId = null;  // Associate roomId set by server for logging
    this.MAX_PLAYERS = 4; // Max players (can be adjusted)
    this.CPU_MOVE_DELAY = Game.DELAY_CPU_DECISION;  // CPU reaction delay after special banners
    this.reset();
  }

  // Helper methods for consistent card value checks
  isSpecialCard(value) {
    return this.isWildCard(value) || this.isTenCard(value);
  }

  isWildCard(value) {
    return this.isTwoCard(value) || this.isFiveCard(value);
  }

  isTwoCard(value) {
    return value == 2; // Use loose equality for consistent type checking
  }

  isFiveCard(value) {
    return value == 5;
  }

  isTenCard(value) {
    return value == 10;
  }

  checkWinCondition(player) {
    // Player wins if they have no hand, no up cards, and no down cards
    if (!player) return false;
    return player.hand.length === 0 && player.up.length === 0 && player.down.length === 0;
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
    console.log(`[SERVER] play() called by ${p ? p.name : 'unknown'} (${sock.id}) with idxs: ${JSON.stringify(idxs)}. Current turn: ${this.turn}`);
    if (!p || p.disconnected || (this.turn !== p.id)) { // Simplified turn check
        return;
    }

    // Determine if player is playing down cards
    const isPlayingDownCards = idxs.some(i => i >= 2000);
    
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
        console.log(`[DEBUG play] Invalid play attempted by ${p.name} (${sock.id}) with cards: ${JSON.stringify(cards)}. Current turn: ${this.turn}`);
        
        // Handle invalid plays differently based on card type
        if (isPlayingDownCards) {
            // For down cards: take the pile (player can't see them)
            cards.forEach(c => p.hand.push(c));
            this.sortHand(p);
            this.io.to(this.roomId).emit('specialEffect', { value: null, type: 'invalid' });
            this.takePile(sock);
            // Emit log event for invalid play
            this.io.to(this.roomId).emit('log', { player: p.name, action: 'invalid', cards });
        } else {
            // For hand or up cards: show error message but DON'T take pile
            // Return cards to player's hand if they were from hand
            if (!idxs.some(i => i >= 1000)) {
                cards.forEach(c => p.hand.push(c));
                this.sortHand(p);
            }
            // Send error to player
            sock.emit?.('err', 'Invalid play: card must be higher than the top card');
            // Emit log event for invalid attempt
            this.io.to(this.roomId).emit('log', { player: p.name, action: 'invalid-attempt', cards });
        }
        return;
    }
    
    // Rest of the function handles valid plays
    // Emit log event for successful play
    this.io.to(this.roomId).emit('log', { player: p.name, action: 'play', cards });

    // Card removal logging
    const handBefore = [...p.hand];
    const upBefore = [...p.up];
    const downBefore = [...p.down];
    p.hand = p.hand.filter((_, i) => !idxs.includes(i));
    if (idxs.some(i => i >= 1000 && i < 2000)) {
      p.up = p.up.filter((_, i) => !idxs.includes(i + 1000));
    }
    if (idxs.some(i => i >= 2000)) {
      p.down.shift();
    }
    console.log(`[SERVER] After card removal: hand: ${JSON.stringify(handBefore)} -> ${JSON.stringify(p.hand)}, up: ${JSON.stringify(upBefore)} -> ${JSON.stringify(p.up)}, down: ${JSON.stringify(downBefore)} -> ${JSON.stringify(p.down)}`);

    cards.forEach(c => this.playPile.push(c));
    console.log(`[DEBUG play] ${p ? p.name : 'unknown'} played cards: ${JSON.stringify(cards)}. New playPile: ${JSON.stringify(this.playPile)}. Turn: ${this.turn}`);
    const playedValue = cards[0].value;
    const isFourOfAKind = cards.length === 4;

    // Update lastRealCard (using helper methods for consistency)
    if (!this.isSpecialCard(playedValue) && !isFourOfAKind) {
        this.lastRealCard = cards[0];
    }

    const finishTurn = () => {
        // Check for win condition FIRST
        if (this.checkWinCondition(p)) {
          console.log(`[SERVER] Player ${p.name} wins!`);
          this.io.to(this.roomId).emit('gameOver', { winnerId: p.id, winnerName: p.name });
          this.started = false;
          return;
        }
        // Advance turn, refill hand, then push updated state
        this.advanceTurn();
        console.log(`[SERVER] finishTurn: Advancing turn. New turn: ${this.turn}`);
        this.refill(p);
        this.pushState();
        if (this.checkWinCondition(p)) {
          console.log(`[SERVER] Player ${p.name} wins after refill!`);
          this.io.to(this.roomId).emit('gameOver', { winnerId: p.id, winnerName: p.name });
          this.started = false;
          return;
        }
        const nextPlayer = this.byId(this.turn);
        if (nextPlayer && nextPlayer.isComputer) {
          console.log(`[SERVER] finishTurn: Scheduling CPU turn (${nextPlayer.id}) with delay: ${Game.DELAY_CPU_DECISION}ms`);
          setTimeout(() => this.computerTurn(nextPlayer.id), Game.DELAY_CPU_DECISION);
        }
    };

    // For all played cards (special or regular), emit the effect and add animation delay
    // Special cards (2, 5, 10) or four-of-a-kind get their specific animation
    if (this.isTenCard(playedValue) || isFourOfAKind) {
        // Show special effect banner
        this.io.emit('specialEffect', { value: 10, type: isFourOfAKind ? 'four' : 'ten' });
        // Do not mutate the play pile or push state until after the animation delay
        setTimeout(() => {
            // Burn effect: move play pile to discard, draw new card if available
            this.discard = (this.discard || []).concat(this.playPile.splice(0));
            if (this.deck.length > 0) {
                const nextCard = this.draw();
                this.playPile.push(nextCard);
                if (!this.isSpecialCard(nextCard.value)) {
                    this.lastRealCard = nextCard;
                } else {
                    this.lastRealCard = null;
                }
            } else {
                this.lastRealCard = null;
            }
            finishTurn();
        }, Game.DELAY_SPECIAL_DISPLAY);
        return;
    } else if (this.isFiveCard(playedValue)) {
        this.io.emit('specialEffect', { value: 5, type: 'five' });
        setTimeout(() => {
            if (this.lastRealCard) this.playPile.push({ ...this.lastRealCard, copied: true });
            finishTurn();
        }, Game.DELAY_SPECIAL_DISPLAY);
        return;
    } else if (this.isTwoCard(playedValue)) {
        this.io.emit('specialEffect', { value: 2, type: 'two' });
        setTimeout(finishTurn, Game.DELAY_SPECIAL_DISPLAY);
        return;
    }
    // For regular cards (A, K, etc.), show a brief play animation too
    this.io.emit('specialEffect', { value: playedValue, type: 'regular' });
    // Standard delay after regular card play - increase from 300ms to allow animation to be seen
    setTimeout(finishTurn, Game.DELAY_AFTER_PLAY + 1000);
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
          .filter(({ card }) => this.isSpecialCard(card.value));
        const regulars = computer.hand
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => !this.isSpecialCard(card.value));
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
          const ten = playableWilds.find(({ card }) => this.isTenCard(card.value));
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
      // No moves: take the pile then schedule next CPU turn if any
      this.takePile({ id: computerId, skipNotice: true });
      // After auto-pickup, schedule the next CPU turn
      setTimeout(() => this.computerTurn(this.turn), Game.DELAY_CPU_DECISION);
      return;
    }, Game.DELAY_CPU_DECISION);
  }

  takePile(sock) {
    const p = this.findPlayerById(sock.id);
    console.log(`[DEBUG takePile] called by ${sock.id}, turn before givePile: ${this.turn}`);

    // Always emit specialEffect for take pile and wait for animation before updating state
    this.io.emit('specialEffect', { value: null, type: 'take' });
    
    // Wait a moment for the animation to play before actually giving the pile
    setTimeout(() => {
      this.givePile(p, 'You picked up the pile');
      console.log(`[DEBUG takePile] turn after givePile: ${this.turn}`);
      
      // Notify players of the take-pile event
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
      
      // Finally, push the updated game state
      this.pushState();
      // If next player is a computer, schedule their turn with the proper delay
      const nextPlayer = this.byId(this.turn);
      if (nextPlayer && nextPlayer.isComputer) {
        setTimeout(() => this.computerTurn(nextPlayer.id), Game.DELAY_CPU_DECISION);
      }
    }, Game.DELAY_SPECIAL_DISPLAY); // Use the same delay as other special effects
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
    console.log(`Initial empty state pushed. Waiting ${Game.DELAY_INITIAL_PLACEMENT}ms before placing first card.`);

    // --- Wait before placing the first card ---
    setTimeout(() => {
      if (!this.started) return; // Check if game was reset during delay
      console.log(`Placing initial card...`);
      let initialCard = null;
      while (this.deck.length > 0) {
        initialCard = this.draw();
        // If it's a 10, burn then continue drawing
        if (this.isTenCard(initialCard.value)) {
          this.playPile.push(initialCard);
          this.lastRealCard = null;
          this.pushState();
          this.io.emit('specialEffect', { value: 10, type: 'ten' });
          setTimeout(() => {
            this.discard = (this.discard || []).concat(this.playPile.splice(0));
            // draw next non-10 if available
            let nextCard = null;
            while (this.deck.length > 0) {
              nextCard = this.draw();
              if (!this.isTenCard(nextCard.value)) break;
              this.discard = (this.discard || []).concat(nextCard);
              this.io.emit('specialEffect', { value: 10, type: 'ten' });
              nextCard = null;
            }
            if (nextCard) {
              this.playPile.push(nextCard);
              if (!this.isSpecialCard(nextCard.value)) {
                this.lastRealCard = nextCard;
              } else {
                this.lastRealCard = null;
              }
              this.pushState();
            }
            // Schedule first turn after special display
            setTimeout(() => {
              if (!this.started || !this.players.length) return;
              this.turn = this.players[0].id;
              this.pushState();
              const firstPlayer = this.byId(this.turn);
              if (firstPlayer && firstPlayer.isComputer) {
                this.computerTurn(firstPlayer.id);
              }
            }, Game.DELAY_FIRST_TURN);
          }, Game.DELAY_SPECIAL_DISPLAY);
          return;
        }
        break; // non-10, place normally
      }
      if (initialCard) {
        this.playPile.push(initialCard); // Place the card
        if (!this.isSpecialCard(initialCard.value)) {
          this.lastRealCard = initialCard;
        }
        this.pushState();
      } else {
        this.lastRealCard = null;
      }
      // Wait before starting the first turn
      setTimeout(() => {
        if (!this.started || !this.players.length) return;
        this.turn = this.players[0].id;
        this.pushState();
        const firstPlayer = this.byId(this.turn);
        if (firstPlayer && firstPlayer.isComputer) {
          this.computerTurn(firstPlayer.id);
        }
      }, Game.DELAY_FIRST_TURN);
    }, Game.DELAY_INITIAL_PLACEMENT);
  }

  buildDeck() {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const vals = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];
    this.deck = [];
    
    // Add the first standard deck
    suits.forEach(s => vals.forEach(v => this.deck.push({ value: v, suit: s })));
    
    // Add a second deck ONLY if we have 4+ players
    if (this.players.length >= 4) {
      suits.forEach(s => vals.forEach(v => this.deck.push({ value: v, suit: s })));
    }
    
    console.log(`Built deck with ${this.deck.length} cards for ${this.players.length} players (${this.players.length >= 4 ? '2 decks' : '1 deck'})`);
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
    if (this.isFiveCard(t.value) && t.copied && this.lastRealCard) {
      return { ...this.lastRealCard, copied: true };
    }
    return t;
  }

  byId(id) {
    return this.players.find(p => p.id === id && !p.disconnected);
  }

  rank(c) {
    const v = String(c.value).toUpperCase();
    if (this.isTwoCard(c.value)) return 2;
    return { 'J': 11, 'Q': 12, 'K': 13, 'A': 14 }[v] ?? parseInt(v);
  }

  valid(cards) {
    if (cards.length === 4) {
      console.log(`[DEBUG valid] Checking four cards: ${JSON.stringify(cards.map(c => c.value))}. Should return true.`);
      return true;
    }

    if (!cards.length || !cards.every(c => c.value === cards[0].value)) return false;
    if (this.isSpecialCard(cards[0].value)) return true;
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
  }
  
  hasMove(p) {
    if (p.hand.length > 0) {
      if (p.hand.some(c => this.valid([c]))) {
        return true;
      }
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

    // Remove forced 'must take the pile' notice logic
    // Only auto-pickup for CPU when no moves
    if (currentPlayer && !this.hasMove(currentPlayer)) {
      if (currentPlayer.isComputer) {
        setTimeout(() => this.takePile({ id: currentPlayer.id, skipNotice: true }), 97);
        return; // Skip further state push until after pickup
      }
      // For humans, do not emit any notice or block the UI; let them take the pile at any time
    } else if (currentPlayer && currentPlayer.sock) {
      currentPlayer.sock.emit('notice', '');
    }

    console.log(`[SERVER] pushState: turn=${this.turn}, playPile=${JSON.stringify(this.playPile)}, players=${this.players.map(p=>p.id+':'+p.hand.length).join(',')}`);

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

  advanceTurn() {
    if (!this.started || this.players.length < 2) return;
    const currentPlayerIndex = this.players.findIndex(player => player.id === this.turn);
    if (currentPlayerIndex === -1) {
      this.turn = this.players.find(p => !p.disconnected)?.id || null;
      console.log(`[SERVER] advanceTurn: Current player not found, setting turn to ${this.turn}`);
      return;
    }
    let nextPlayerIndex = (currentPlayerIndex + 1) % this.players.length;
    let attempts = 0;
    while (this.players[nextPlayerIndex].disconnected && attempts < this.players.length) {
      nextPlayerIndex = (nextPlayerIndex + 1) % this.players.length;
      attempts++;
    }
    if (attempts >= this.players.length) {
      console.warn("[SERVER] advanceTurn: All players seem disconnected. Setting turn to null.");
      this.turn = null;
    } else {
      this.turn = this.players[nextPlayerIndex].id;
      console.log(`[SERVER] advanceTurn: Turn advanced to ${this.players[nextPlayerIndex].name} (${this.turn})`);
    }
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
