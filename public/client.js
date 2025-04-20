const socket = io();

socket.on('connect', () => {
  console.log('✅ Socket connected');
});

socket.on('connect_error', (err) => {
  console.error('❌ Socket connection failed:', err.message);
});

let myId = null;
const $ = id => document.getElementById(id);

/* ---------- refs ---------- */
const nameIn = $('name'), joinBtn = $('join');
const lobby = $('lobby-banner'), notice = $('notice-banner'), table = $('table');
const myName = $('my-name'), myHand = $('my-hand'), myStacks = $('my-stacks');
const playBtn = $('play'), takeBtn = $('take');
const other = $('other-players');
const playPile = $('play-pile'), drawPile = $('draw-pile'), discardPile = $('discard-pile');

/* ---------- helpers ---------- */
function code(c) {
  if (!c) return '';
  const v = c.value === 10 ? '0' : String(c.value).toUpperCase();
  const s = { hearts: 'H', diamonds: 'D', clubs: 'C', spades: 'S' }[c.suit];
  return v + s;
}

function cardImg(card, sel = false) {
  const container = document.createElement('div');
  container.style.position = 'relative';
  container.style.display = 'inline-block';

  const img = new Image();
  img.className = 'card-img';
  img.src = card.back
    ? 'https://deckofcardsapi.com/static/img/back.png'
    : `https://deckofcardsapi.com/static/img/${code(card)}.png`;

  if (sel) {
    img.onclick = () => img.classList.toggle('selected');
    img.ondblclick = () => {
      img.classList.add('selected');
      const selected = Array.from(myHand.children).filter(c =>
        c.querySelector('.card-img')?.classList.contains('selected')
      );
      if (selected.length) {
        const indexes = selected.map(c => parseInt(c.querySelector('.card-img').dataset.idx));
        socket.emit('playCards', indexes);
      }
    };
  }

  container.appendChild(img);

  if (card.copied) {
    const badge = document.createElement('div');
    badge.className = 'copy-badge';
    badge.textContent = `Copied ${card.value}`;
    container.appendChild(badge);
  }

  return container;
}

function showCardEvent(cardValue) {
  const banner = document.getElementById('event-banner');
  if (!banner) return;

  if (cardValue === 2) {
    banner.textContent = 'RESET!';
    banner.className = 'event reset';
  } else if (cardValue === 5) {
    banner.textContent = 'COPY!';
    banner.className = 'event copy';
  } else if (cardValue === 10) {
    banner.textContent = 'CLEAR!';
    banner.className = 'event burn';
  } else {
    banner.textContent = '';
    banner.className = '';
  }

  banner.style.display = 'block';
  setTimeout(() => banner.style.display = 'none', 2000);
}

notice.onclick = () => notice.classList.add('hidden');

/* ---------- join ---------- */
joinBtn.onclick = () => {
  const n = nameIn.value.trim();
  if (!n) return alert('Enter a name');
  socket.emit('join', n);
};

/* ---------- lobby ---------- */
socket.on('lobby', list => {
  lobby.textContent = `Waiting for players (${list.length}/2) — share this link!`;
  lobby.classList.remove('hidden');
  table.classList.add('hidden');
});

/* ---------- joined ---------- */
socket.on('joined', d => {
  myId = d.id;
  joinBtn.disabled = nameIn.disabled = true;
});

/* ---------- notices ---------- */
socket.on('notice', msg => {
  if (!msg) return notice.classList.add('hidden');
  notice.textContent = `${msg} (click to dismiss)`;
  notice.classList.remove('hidden');
});

/* ---------- state ---------- */
socket.on('state', s => {
  lobby.classList.add('hidden');
  table.classList.remove('hidden');

  const myTurn = s.turn === myId;
  playBtn.disabled = takeBtn.disabled = !myTurn;

  playPile.innerHTML = '';
  if (s.playPile.length) {
    const topCard = s.playPile.at(-1);
    playPile.appendChild(cardImg(topCard));
    if ([2, 5, 10].includes(topCard.value)) showCardEvent(topCard.value);
  }

  drawPile.innerHTML = '';
  if (s.deckCount) drawPile.appendChild(cardImg({ back: true }));

  discardPile.textContent = s.discardCount;

  other.innerHTML = '';
  myHand.innerHTML = '';
  myStacks.innerHTML = '';

  s.players.forEach(p => {
    if (p.id === myId) {
      myName.textContent = p.name + (myTurn ? '  ← your turn' : '');
      p.hand.forEach((c, i) => {
        const el = cardImg(c, true);
        el.querySelector('.card-img').dataset.idx = i;
        myHand.appendChild(el);
      });
      p.up.forEach(c => {
        const col = document.createElement('div');
        col.className = 'stack';
        col.append(cardImg({ back: true }), cardImg(c));
        myStacks.appendChild(col);
      });
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'player';
    panel.innerHTML = `<h3>${p.name}</h3><div class="row-label">Up / Down:</div>`;
    const sr = document.createElement('div');
    sr.className = 'stack-row';
    p.up.forEach(c => {
      const col = document.createElement('div');
      col.className = 'stack';
      col.append(cardImg({ back: true }), cardImg(c));
      sr.appendChild(col);
    });

    const lab = document.createElement('div');
    lab.className = 'row-label';
    lab.textContent = 'Hand:';
    const hr = document.createElement('div');
    hr.className = 'opp-hand';
    for (let i = 0; i < p.handCount; i++) hr.appendChild(cardImg({ back: true }));

    panel.append(sr, lab, hr);
    other.appendChild(panel);
  });
});

/* ---------- play ---------- */
playBtn.onclick = () => {
  const sel = Array.from(myHand.children).filter(c =>
    c.querySelector('.card-img')?.classList.contains('selected')
  );
  if (!sel.length) return;
  const indexes = sel.map(c => parseInt(c.querySelector('.card-img').dataset.idx));
  socket.emit('playCards', indexes);
};

takeBtn.onclick = () => socket.emit('takePile');
