/* ------------------------------------------------------------------
   Three’s Card Game – Rule Engine (ES‑module)
   ------------------------------------------------------------------ */
export class Game {
  constructor(io) {
    this.io = io;
    this.reset();
  }

  /* ===== join / leave ===== */
  addPlayer(sock, name = 'Player') {
    if (this.started) { sock.emit('err', 'Game already started'); return; }

    this.players.push({
      id:   sock.id,
      sock,
      name,
      hand : [],
      up   : [],
      down : [],
      phase: 1              // 1 = hand, 2 = face‑up, 3 = face‑down
    });

    sock.emit('joined', { id: sock.id });
    this.io.emit('lobby', this.players.map(p => ({ id:p.id, name:p.name })));

    /* auto‑start at 4 players (change if you wish) */
        const MIN_PLAYERS = 2;          // <-- change this number anytime
    if (this.players.length >= MIN_PLAYERS) this.startGame();

  }

  removePlayer(sock) {
    this.players = this.players.filter(p => p.id !== sock.id);
    if (!this.started)
      this.io.emit('lobby', this.players.map(p => ({ id:p.id, name:p.name })));
  }

  /* ===== in‑game actions ===== */
  play(sock, indexes) {
    const pl = this.byId(sock.id);
    if (!pl || this.turn !== pl.id) return;

    const cards = indexes.map(i => pl.hand[i]);
    if (!this.valid(cards)) { sock.emit('err', 'Illegal play'); return; }

    const oldTop = this.top();
    cards.forEach(c => this.playPile.push(c));
    pl.hand = pl.hand.filter((_, i) => !indexes.includes(i));

    this.special(cards, oldTop);
    this.refill(pl);
    this.nextTurn();
    this.pushState();
  }

  takePile(sock) {
    const pl = this.byId(sock.id);
    if (!pl || this.turn !== pl.id) return;

    pl.hand.push(...this.playPile.splice(0));
    if (this.deck.length) this.playPile.push(this.draw());   // new start card
    this.nextTurn();
    this.pushState();
  }

  /* ===== game start ===== */
  startGame() {
    this.started = true;
    this.makeDeck();
    this.deal();
    this.playPile.push(this.draw());          // flip start card
    this.turn = this.players[0].id;
    this.pushState();
  }

  /* ===== helpers ===== */
  makeDeck() {
    const decksNeeded = Math.ceil(this.players.length / 4);
    const suits  = ['hearts','diamonds','clubs','spades'];
    const vals   = [3,4,5,6,7,8,9,10,'J','Q','K','A'];
    const single = [];
    suits.forEach(s => vals.forEach(v => single.push({ value:v, suit:s })));
    this.deck = [];
    for (let d=0; d<decksNeeded; d++) this.deck.push(...single);
    this.shuffle(this.deck);
  }

  deal() {
    for (let i=0;i<3;i++) this.players.forEach(p=>p.down.push(this.draw()));
    for (let i=0;i<3;i++) this.players.forEach(p=>p.up  .push(this.draw()));
    for (let i=0;i<3;i++) this.players.forEach(p=>p.hand.push(this.draw()));
  }

  draw()          { return this.deck.pop(); }
  top()           { return this.playPile.at(-1); }
  byId(id)        { return this.players.find(p=>p.id===id); }
  shuffle(a)      { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} }
  rank(c) {
    return {J:11,Q:12,K:13,A:14}[c.value] ?? c.value;       // numeric 3‑10
  }

  valid(cards){
    if (!cards.length) return false;
    if (!cards.every(c=>c.value===cards[0].value)) return false;
    const v = cards[0].value;
    if ([2,5,10,'2','5','10'].includes(v)) return true;
    const t = this.top();
    return !t || this.rank(cards[0]) > this.rank(t);
  }

  special(cards, oldTop){
    const v = cards[0].value;

    /* burn */
    if (v===10 || cards.length===4){
      this.discard.push(...this.playPile.splice(0));
      if (this.deck.length) this.playPile.push(this.draw());
    }
    /* 5 copies previous rank */
    else if (v===5 && oldTop){
      this.playPile.push({ ...oldTop });
    }
  }

  refill(p){ while(p.hand.length<3 && this.deck.length) p.hand.push(this.draw()); }
  nextTurn(){ const i=this.players.findIndex(p=>p.id===this.turn); this.turn=this.players[(i+1)%this.players.length].id; }

  /* ===== send tailored state ===== */
  pushState(){
    this.players.forEach(tgt=>{
      tgt.sock.emit('state',{
        deckCount   : this.deck.length,
        playPile    : this.playPile,
        discardCount: this.discard.length,
        turn        : this.turn,
        players     : this.players.map(p=>({
          id   : p.id,
          name : p.name,
          hand : p.id===tgt.id ? p.hand : [],
          handCount: p.hand.length,
          up   : p.up,
          downCount: p.down.length,
          phase: p.phase
        }))
      });
    });
  }

  /* ===== reset ===== */
  reset(){
    this.players=[]; this.deck=[]; this.playPile=[]; this.discard=[];
    this.turn=null; this.started=false;
  }
}
