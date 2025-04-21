export class Game {
  constructor(io) {
    this.io = io;
    this.reset();
  }

  addPlayer(sock, name = 'Player') {
    if (this.started) {
      sock.emit('err', 'Game already started');
      return;
    }

    // Add the human player
    this.players.push({ id: sock.id, sock, name, hand: [], up: [], down: [] });
    sock.emit('joined', { id: sock.id });

    this.io.emit('lobby', this.players.map(p => ({ id: p.id, name: p.name })));
    if (this.players.length >= 2) this.startGame();
  }

  addComputerPlayer() {
    if (this.started) {
      return;
    }
    
    this.players.push({ 
      id: 'computer',
      name: 'Computer',
      isComputer: true,
      hand: [],
      up: [],
      down: []
    });

    if (this.players.length >= 2) {
      this.startGame();
    }
  }

  removePlayer(sock) {
    this.players = this.players.filter(p => p.id !== sock.id);
  }

  play(sock, idxs) {
    const p = this.byId(sock.id);
    if (!p || this.turn !== p.id) return;

    // Check if trying to play down cards while up cards remain
    if (idxs.some(i => i === 2000) && p.up.length > 0) {
      sock.emit('err', 'You must play all face-up cards before playing face-down cards');
      return;
    }

    // Check if trying to play up cards while hand cards remain
    if (idxs.some(i => i >= 1000 && i < 2000) && p.hand.length > 0) {
      sock.emit('err', 'You must play all hand cards before playing face-up cards');
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
    p.up = p.up.filter((_, i) => !idxs.includes(i + 1000));
    if (idxs.includes(2000)) p.down.shift();

    this.applySpecial(cards);
    this.refill(p);
    this.advanceTurn();
    this.pushState();

    // After human player's turn, trigger computer's turn if it's next
    if (this.turn === 'computer') {
      this.computerTurn();
    }
  }

  computerTurn() {
    const computer = this.byId('computer');
    if (!computer || this.turn !== 'computer') return;

    setTimeout(() => {
      // Only play from hand if we have hand cards
      if (computer.hand.length > 0) {
        // Separate wilds and regular cards
        const wilds = computer.hand
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => [2, 5, 10].includes(card.value));
        const regulars = computer.hand
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => ![2, 5, 10].includes(card.value));
        // Find playable regulars and wilds
        const playableRegulars = regulars.filter(({ card }) => this.valid([card]));
        const playableWilds = wilds.filter(({ card }) => this.valid([card]));
        let playChoice = null;
        // Prefer regulars, but sometimes (20%) play a wild if both are available
        if (playableRegulars.length > 0 && playableWilds.length > 0 && Math.random() < 0.2) {
          playChoice = playableWilds[Math.floor(Math.random() * playableWilds.length)];
        } else if (playableRegulars.length > 0) {
          // Sometimes (20%) play a higher regular instead of lowest
          if (playableRegulars.length > 1 && Math.random() < 0.2) {
            playChoice = playableRegulars[playableRegulars.length - 1];
          } else {
            playChoice = playableRegulars[0];
          }
        } else if (playableWilds.length > 0) {
          // Prefer 10 if it burns the pile
          const ten = playableWilds.find(({ card }) => card.value === 10);
          if (ten) playChoice = ten;
          else playChoice = playableWilds[0];
        }
        if (playChoice) {
          this.play({ id: 'computer' }, [playChoice.index]);
          return;
        }
      }
      // Only try face-up cards if hand is empty
      if (computer.hand.length === 0 && computer.up.length > 0) {
        const playableUpCards = computer.up
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => this.valid([card]));
        if (playableUpCards.length > 0) {
          // Sometimes (20%) play a higher up card
          let playIdx = 0;
          if (playableUpCards.length > 1 && Math.random() < 0.2) {
            playIdx = playableUpCards.length - 1;
          }
          this.play({ id: 'computer' }, [playableUpCards[playIdx].index + 1000]);
          return;
        }
      }
      // Only try face-down cards if both hand and face-up are empty
      if (computer.hand.length === 0 && computer.up.length === 0 && computer.down.length > 0) {
        this.play({ id: 'computer' }, [2000]);
        return;
      }
      // If no valid moves or not allowed to play certain cards, take the pile
      this.takePile({ id: 'computer' });
    }, 1000);
  }

  takePile(sock) {
    const p = this.byId(sock.id);
    if (!p || this.turn !== p.id) return;
    this.givePile(p, 'You picked up the pile');
    // Emit to all other players that this player took the pile
    if (p.sock && !p.isComputer) {
      this.players.forEach(other => {
        if (other.id !== p.id && other.sock) {
          other.sock.emit('opponentTookPile', { playerId: p.id });
        }
      });
    }
    this.pushState();

    // After human player's turn, trigger computer's turn if it's next
    if (this.turn === 'computer') {
      this.computerTurn();
    }
  }

  startGame() {
    this.started = true;
    this.buildDeck();
    this.deal();
    this.playPile.push(this.draw());
    this.turn = this.players[0].id;
    this.pushState();
  }

  buildDeck() {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const vals = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];
    this.deck = [];
    for (let d = 0; d < Math.ceil(this.players.length / 4); d++) {
      suits.forEach(s => vals.forEach(v => this.deck.push({ value: v, suit: s })));
    }
    this.shuffle(this.deck);
  }

  deal() {
    // Deal 3 cards to each player's hand, up, and down positions
    for (let i = 0; i < 3; i++) {
      this.players.forEach(p => {
        p.down.push(this.draw());
        p.up.push(this.draw());
        p.hand.push(this.draw());
      });
    }
    
    // Sort hands after dealing
    this.players.forEach(p => {
      this.sortHand(p);
      
      // For computer player, ensure cards are properly initialized
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
    return this.players.find(p => p.id === id);
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
    const i = this.players.findIndex(p => p.id === this.turn);
    this.turn = this.players[(i + 1) % this.players.length].id;
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
    const p = this.byId(this.turn);
    // Only show 'No valid moves' to the current human player
    if (p && p.sock && !p.isComputer && !this.hasMove(p)) {
      p.sock.emit('notice', 'No valid moves. You must Take Pile.');
    }

    // For human players, send state through their socket
    this.players.forEach(t => {
      if (t.sock) {
        t.sock.emit('state', {
          deckCount: this.deck.length,
          playPile: this.playPile,
          discardCount: (this.discard || []).length,
          turn: this.turn,
          players: this.players.map(p => ({
            id: p.id,
            name: p.name,
            isComputer: p.isComputer,
            hand: p.id === t.id ? p.hand : p.hand.map(() => ({ back: true })),
            handCount: p.hand.length,
            up: p.up,
            down: p.id === t.id ? p.down : p.down.map(() => ({ back: true })),
            downCount: p.down.length
          }))
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
    this.io.emit('lobby', []); // Emit empty lobby state to reset all clients
  }
}
