const socket = io({
  reconnectionDelayMax: 10000,
  reconnection: true,
  reconnectionDelay: 1000,
});

socket.on('connect', () => {
  console.log('✅ Socket connected');
  // Clear game state on reconnect
  myId = null;
  currentRoom = null;
  nameIn.value = '';
  nameIn.disabled = false;
  joinBtn.disabled = false;
  notice.classList.add('hidden');
  lobby.classList.remove('hidden');
  table.classList.add('hidden');
});

socket.on('connect_error', (err) => {
  console.error('❌ Socket connection failed:', err.message);
});

// 🛑 Dev shortcut: Ctrl + R = admin reset (with reload prevention)
document.addEventListener('keydown', e => {
  if (e.key === 'r' && e.ctrlKey) {
    e.preventDefault(); // Prevent browser from reloading
    socket.emit('adminReset');
    console.log('🛑 Sent adminReset');
    // Clear client state
    myId = null;
    currentRoom = null;
    nameIn.value = '';
    notice.classList.add('hidden');
  }
});

let myId = null;
let currentRoom = null;
const $ = id => document.getElementById(id);

/* ---------- refs ---------- */
const nameIn = $('name'), joinBtn = $('join');
const lobby = $('lobby-banner'), notice = $('notice-banner'), table = $('table');
const myName = $('my-name'), myHand = $('my-hand'), myStacks = $('my-stacks');
const playBtn = $('play'), takeBtn = $('take');
const other = $('other-players');
const playPile = $('play-pile'), drawPile = $('draw-pile');
const joinComputerBtn = $('join-computer');

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
  container.style.height = '100%'; // Ensure container takes full height

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
  } else {
    img.style.pointerEvents = 'none';
    img.style.cursor = 'default';
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
  socket.emit('join', n, false);
};

joinComputerBtn.onclick = () => {
  const n = nameIn.value.trim();
  if (!n) return alert('Enter a name');
  socket.emit('join', n, true);
};

/* ---------- lobby ---------- */
socket.on('lobby', list => {
  lobby.textContent = `Waiting for players (${list.length}/2) — share this link!`;
  lobby.classList.remove('hidden');
  table.classList.add('hidden');
  // Re-enable input fields when returning to lobby
  joinBtn.disabled = nameIn.disabled = false;
});

/* ---------- joined ---------- */
socket.on('joined', d => {
  myId = d.id;
  joinBtn.disabled = nameIn.disabled = true;
});

/* ---------- notices ---------- */
socket.on('notice', msg => {
  if (!msg) return notice.classList.add('hidden');
  notice.textContent = msg.replace('Take Pile', 'take pile'); // Fix capitalization
  notice.classList.remove('hidden');
});

/* ---------- error handling ---------- */
socket.on('err', msg => {
  notice.textContent = `Error: ${msg.replace('Take Pile', 'take pile')}`; // Fix capitalization
  notice.classList.remove('hidden');
});

/* ---------- state ---------- */
socket.on('state', s => {
  lobby.classList.add('hidden');
  table.classList.remove('hidden');

  const myTurn = s.turn === myId;
  playBtn.disabled = takeBtn.disabled = !myTurn;

  // Add or remove active class on my-area based on turn
  $('my-area').classList.toggle('active', myTurn);

  // Update play pile with count
  playPile.innerHTML = '';
  const playCount = $('play-count');
  if (s.playPile.length) {
    const topCard = s.playPile.at(-1);
    playPile.appendChild(cardImg(topCard));
    if ([2, 5, 10].includes(topCard.value)) showCardEvent(topCard.value);
    playCount.textContent = s.playPile.length;
  } else {
    playCount.textContent = '';
  }

  // Update draw pile with count
  drawPile.innerHTML = '';
  const drawCount = $('draw-count');
  if (s.deckCount) {
    drawPile.appendChild(cardImg({ back: true }));
    drawCount.textContent = s.deckCount;
  } else {
    drawCount.textContent = '';
  }

  // Remove reference to discardPile since it's no longer used
  const discardPile = $('discard-pile');
  if (discardPile) discardPile.remove();

  other.innerHTML = '';
  myHand.innerHTML = '';
  myStacks.innerHTML = '';

  s.players.forEach(p => {
    if (p.id === myId) {
      myName.textContent = p.name;
      // Hand cards
      p.hand.forEach((c, i) => {
        const el = cardImg(c, myTurn);  // Only enable clicks when it's player's turn
        el.querySelector('.card-img').dataset.idx = i;
        myHand.appendChild(el);
      });
      // Up cards - only enable if hand is empty
      p.up.forEach((c, i) => {
        const col = document.createElement('div');
        col.className = 'stack';
        // Only enable clicks on up cards when it's player's turn AND hand is empty
        col.append(
          cardImg({ back: true }, false), // Down cards never clickable here
          cardImg(c, myTurn && p.hand.length === 0)
        );
        col.querySelector('.card-img:last-child').dataset.idx = i + 1000;
        myStacks.appendChild(col);
      });
      // Down cards - only add if both hand and up are empty
      if (p.down.length > 0) {
        const col = document.createElement('div');
        col.className = 'stack';
        col.append(
          cardImg({ back: true }, myTurn && p.hand.length === 0 && p.up.length === 0),
          cardImg({ back: true }, false)
        );
        col.querySelector('.card-img:first-child').dataset.idx = 2000;
        myStacks.appendChild(col);
      }
      return;
    }

    // Other players
    const panel = document.createElement('div');
    panel.className = 'player';
    if (p.id === s.turn) panel.classList.add('active');
    
    panel.innerHTML = `<h3>${p.name}</h3>`;
    
    // Create up/down cards section first
    const sr = document.createElement('div');
    sr.className = 'stack-row';
    p.up.forEach(c => {
      const col = document.createElement('div');
      col.className = 'stack';
      col.append(cardImg({ back: true }, false), cardImg(c, false));
      sr.appendChild(col);
    });
    panel.appendChild(sr);

    // Create hand section with proper structure
    const handSection = document.createElement('div');
    handSection.style.width = '100%';
    
    const handLabel = document.createElement('div');
    handLabel.className = 'row-label';
    handLabel.textContent = 'Hand:';
    handSection.appendChild(handLabel);

    const hr = document.createElement('div');
    hr.className = 'opp-hand';
    
    for (let i = 0; i < p.handCount; i++) {
      const cardContainer = document.createElement('div');
      cardContainer.appendChild(cardImg({ back: true }, false));
      hr.appendChild(cardContainer);
    }

    handSection.appendChild(hr);
    panel.appendChild(handSection);

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

/* ---------- game room ---------- */
socket.on('gameRoom', roomId => {
  currentRoom = roomId;
  // Update page URL with room ID
  const url = new URL(window.location);
  url.searchParams.set('room', roomId);
  window.history.pushState({}, '', url);
  
  // Update lobby text to show room info
  lobby.textContent = `Game Room: ${roomId} - Waiting for players (1/2) — Share this link!`;
});

// Check for room ID in URL when page loads
window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');
  if (roomId) {
    currentRoom = roomId;
  }
});
