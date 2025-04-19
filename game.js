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
    this.players.push({ id: sock.id, sock, name, hand: [], up: [], down: [] });
    sock.emit('joined', { id: sock.id });
    this.io.emit('lobby', this.players.map(p => ({ id: p.id, name: p.name })));
    if (this.players.length >= 2) this.startGame();
  }

  removePlayer(sock) {
    this.players = this.players.filter(p => p.id !== sock.id);
  }

  play(sock, idxs) {
    const p = this.byId(sock.id);
    if (!p || this.turn !== p.id) return;

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
  }

  takePile(sock) {
    const p = this.byId(sock.id);
    if (!p || this.turn !== p.id) return;
    this.givePile(p, 'You picked up the pile');
    this.pushState();
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
    const vals = [3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];
    this.deck = [];
    for (let d = 0; d < Math.ceil(this.players.length / 4); d++) {
      suits.forEach(s => vals.forEach(v => this.deck.push({ value: v, suit: s })));
    }
    this.shuffle(this.deck);
  }

  deal() {
    for (let i = 0; i < 3; i++) {
      this.players.forEach(p => {
        p.down.push(this.draw());
        p.up.push(this.draw());
        p.hand.push(this.draw());
      });
    }
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
      return;
    }

    if (v === 5 && this.lastRealCard) {
      this.playPile.push({ ...this.lastRealCard, copied: true });
    }
  }

  refill(p) {
    while (p.hand.length < 3 && this.deck.length) {
      p.hand.push(this.draw());
    }
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
    p.hand.push(...this.playPile.splice(0));
    if (this.deck.length) this.playPile.push(this.draw());
    if (p.sock) {
      p.sock.emit('notice', msg);
      p.sock.emit('notice', '');
    }
    this.advanceTurn();
  }

  pushState() {
    const deckPosition = { x: 500, y: 300 }; // Example central position of the deck
    const cardSpacing = 50; // Spacing between cards
    const verticalOffset = 150; // Vertical offset for players' cards

    const p = this.byId(this.turn);
    if (!this.hasMove(p)) {
      if (p && p.sock) p.sock.emit('notice', 'No valid moves. You must Take Pile.');
    }

    this.players.forEach((t, index) => {
      // Determine if the player is on the top or bottom of the deck
      const isTop = index % 2 === 0;

      // Calculate base position for the player's cards
      const baseX = deckPosition.x - (cardSpacing * (t.hand.length - 1)) / 2;
      const baseY = isTop
        ? deckPosition.y - verticalOffset
        : deckPosition.y + verticalOffset;

      // Calculate positions for each card in the player's hand
      const cardPositions = t.hand.map((_, i) => ({
        x: baseX + i * cardSpacing,
        y: baseY,
      }));

      t.sock?.emit('state', {
        deckCount: this.deck.length,
        playPile: this.playPile,
        discardCount: (this.discard || []).length,
        turn: this.turn,
        players: this.players.map(p => ({
          id: p.id,
          name: p.name,
          hand: p.id === t.id ? p.hand : [],
          handCount: p.hand.length,
          up: p.up,
          downCount: p.down.length,
          cardPositions: p.id === t.id ? cardPositions : [], // Include positions
        }))
      });
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
