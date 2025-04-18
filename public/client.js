
/* ------------------------------------------------------------------
   Three's Card Game – Browser client
   ------------------------------------------------------------------ */

const socket = io();
let myId = null;

/* ---------- quick DOM helper ---------- */
const $ = id => document.getElementById(id);

/* ---------- element refs ---------- */
const nameIn   = $('name');
const joinBtn  = $('join');
const table    = $('table');

const myName   = $('my-name');
const myHand   = $('my-hand');
const playBtn  = $('play');
const takeBtn  = $('take');

const otherDiv = $('other-players');

const playPile   = $('play-pile');
const drawPile   = $('draw-pile');
const discardPile= $('discard-pile');

/* ---------- utility ---------- */
function code(c) {
  if (!c) return '';
  const v = c.value === 10 ? '0' : String(c.value).toUpperCase();
  const suits = { hearts:'H', diamonds:'D', clubs:'C', spades:'S' };
  return v + suits[c.suit];
}

function cardImg(card, selectable = false) {
  const img = new Image();
  img.className = 'card-img';
  img.src = card ? `/cards/${code(card)}.svg` : '/cards/BACK.svg';
  if (selectable) {
    img.onclick = () => {
      img.classList.toggle('selected');
      playBtn.disabled = !document.querySelector('.card-img.selected');
    };
  }
  return img;
}

/* ---------- event handlers ---------- */
joinBtn.onclick = () => {
  const name = nameIn.value.trim();
  if (name) {
    socket.emit('join', name);
    nameIn.disabled = true;
    joinBtn.disabled = true;
  }
};

playBtn.onclick = () => {
  const selected = [...myHand.children]
    .map((img, i) => img.classList.contains('selected') ? i : -1)
    .filter(i => i !== -1);
  if (selected.length) socket.emit('playCards', selected);
};

takeBtn.onclick = () => socket.emit('takePile');

/* ---------- socket handlers ---------- */
socket.on('joined', data => {
  myId = data.id;
  table.classList.remove('hidden');
});

socket.on('state', state => {
  // Update piles
  drawPile.textContent = state.deckCount;
  playPile.replaceChildren(cardImg(state.playPile.at(-1)));
  discardPile.textContent = state.discardCount;

  // Update my hand
  const me = state.players.find(p => p.id === myId);
  myName.textContent = me.name;
  myHand.replaceChildren(...me.hand.map(c => cardImg(c, true)));

  // Enable/disable buttons
  takeBtn.disabled = state.turn !== myId;
  playBtn.disabled = state.turn !== myId || !document.querySelector('.card-img.selected');

  // Update other players
  const others = state.players.filter(p => p.id !== myId);
  otherDiv.replaceChildren(...others.map(p => {
    const div = document.createElement('div');
    div.className = 'player';
    div.innerHTML = `<h3>${p.name}</h3>
      <div class="up-row">${'⠀'.repeat(p.handCount)}</div>`;
    return div;
  }));
});

socket.on('err', msg => alert(msg));
