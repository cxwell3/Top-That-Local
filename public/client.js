const socket = io({
  reconnectionDelayMax: 10000,
  reconnection: true,
  reconnectionDelay: 1000,
});

console.log('Top That! client.js version 20250421 loaded');

// Add a visible version banner to the page for Render debugging
(function() {
  const versionBanner = document.createElement('div');
  versionBanner.textContent = 'Top That! client.js version 20250421';
  versionBanner.style.position = 'fixed';
  versionBanner.style.bottom = '0';
  versionBanner.style.right = '0';
  versionBanner.style.background = '#ff9e0b';
  versionBanner.style.color = '#000';
  versionBanner.style.fontWeight = 'bold';
  versionBanner.style.padding = '4px 12px';
  versionBanner.style.zIndex = '9999';
  versionBanner.style.fontSize = '1rem';
  versionBanner.style.borderTopLeftRadius = '8px';
  versionBanner.style.boxShadow = '0 0 8px #0006';
  document.body.appendChild(versionBanner);
})();

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
  container.style.height = '100%';

  const img = new Image();
  img.className = 'card-img';
  img.src = card.back
    ? 'https://deckofcardsapi.com/static/img/back.png'
    : `https://deckofcardsapi.com/static/img/${code(card)}.png`;

  // Always set up click handlers for selectable cards
  if (sel) {
    img.style.cursor = 'pointer';
    img.onclick = () => img.classList.toggle('selected');
    img.ondblclick = () => {
      img.classList.add('selected');
      playSelectedCards();
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

function showCardEvent(cardValue, type) {
  const banner = document.getElementById('event-banner');
  const center = document.getElementById('center');
  if (banner && center && !center.contains(banner)) {
    center.appendChild(banner);
  }
  if (cardValue === 2) {
    banner.textContent = 'RESET!';
    banner.className = 'event reset';
  } else if (cardValue === 5) {
    banner.textContent = 'COPY!';
    banner.className = 'event copy';
  } else if (cardValue === 10 || type === 'four') {
    banner.textContent = 'BURN!';
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
    // Show event banner for wilds and four of a kind
    if ([2, 5, 10].includes(topCard.value) || (s.playPile.length >= 4 && s.playPile.slice(-4).every(c => c.value === topCard.value))) {
      showCardEvent(topCard.value, s.playPile.length >= 4 ? 'four' : undefined);
    }
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

  other.innerHTML = '';
  myHand.innerHTML = '';
  myStacks.innerHTML = '';

  s.players.forEach(p => {
    if (p.id === myId) {
      myName.textContent = p.name;
      myHand.innerHTML = '';
      myStacks.innerHTML = '';
      const handFragment = document.createDocumentFragment();
      const stackFragment = document.createDocumentFragment();
      p.hand.forEach((c, i) => {
        const el = cardImg(c, myTurn);
        const cardElement = el.querySelector('.card-img');
        cardElement.dataset.idx = i;
        handFragment.appendChild(el);
      });
      // Only render up stacks if up cards remain
      if (p.up.length > 0) {
        p.up.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          const isClickable = myTurn && p.hand.length === 0;
          // Down card (always face down)
          const downCard = cardImg({ back: true }, false);
          downCard.querySelector('.card-img').classList.add('down-card');
          // Up card
          const upCard = cardImg(c, isClickable);
          upCard.querySelector('.card-img').classList.add('up-card');
          const upCardElement = upCard.querySelector('.card-img');
          upCardElement.dataset.idx = i + 1000;
          col.append(downCard, upCard);
          stackFragment.appendChild(col);
        });
      } else if (p.down && p.down.length > 0) {
        // Only render down cards by themselves if no up cards remain
        p.down.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          const downCard = cardImg(c, myTurn && p.hand.length === 0 && p.up.length === 0 && !c.back);
          downCard.querySelector('.card-img').classList.add('down-card');
          col.appendChild(downCard);
          stackFragment.appendChild(col);
        });
      }
      myHand.appendChild(handFragment);
      myStacks.appendChild(stackFragment);
      return;
    } else {
      // Other players panel setup with improved computer handling
      const panel = document.createElement('div');
      panel.className = 'player';
      if (p.id === s.turn) panel.classList.add('active');
      if (p.isComputer) panel.classList.add('computer-player');
      panel.innerHTML = `<h3>${p.name}</h3>`;

      // Hand section
      const handSection = document.createElement('div');
      handSection.className = 'player-section';
      const handLabel = document.createElement('div');
      handLabel.className = 'row-label';
      handLabel.textContent = 'Hand:';
      handSection.appendChild(handLabel);
      const hr = document.createElement('div');
      hr.className = 'opp-hand';
      if (p.handCount > 0) {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'opp-card-container';
        for (let i = 0; i < Math.min(p.handCount, 3); i++) {
          const cardDiv = cardImg({ back: true }, false);
          cardDiv.style.position = 'absolute';
          cardDiv.style.left = `${i * 20}px`;
          cardDiv.style.zIndex = i;
          cardContainer.appendChild(cardDiv);
        }
        const badge = document.createElement('div');
        badge.className = 'card-count-badge';
        if (p.isComputer) badge.classList.add('computer-badge');
        badge.textContent = p.handCount;
        cardContainer.appendChild(badge);
        hr.appendChild(cardContainer);
      }
      handSection.appendChild(hr);
      panel.appendChild(handSection);

      // Up/Down section (centered, stacked like main player)
      const upDownSection = document.createElement('div');
      upDownSection.className = 'player-section';
      const upDownLabel = document.createElement('div');
      upDownLabel.className = 'row-label';
      upDownLabel.textContent = 'Up / Down:';
      upDownSection.appendChild(upDownLabel);
      const sr = document.createElement('div');
      sr.className = 'stack-row';

      if (p.up && p.up.length > 0) {
        // Only render up stacks if up cards remain
        p.up.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          // Down card (always face down)
          const downCard = cardImg({ back: true }, false);
          downCard.querySelector('.card-img').classList.add('down-card');
          // Up card (face up)
          const upCard = cardImg(c, false);
          upCard.querySelector('.card-img').classList.add('up-card');
          col.appendChild(downCard);
          col.appendChild(upCard);
          sr.appendChild(col);
        });
      } else if (p.down && p.down.length > 0) {
        // Only render down cards by themselves if no up cards remain
        p.down.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          const downCard = cardImg({ back: true }, false);
          downCard.querySelector('.card-img').classList.add('down-card');
          col.appendChild(downCard);
          sr.appendChild(col);
        });
      }

      upDownSection.appendChild(sr);
      panel.appendChild(upDownSection);
      other.appendChild(panel);
    }
  });

  // Update the card event handling for better touch support
  if (myTurn) {
    // Add touch event handlers to the document
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
  } else {
    // Remove touch handlers when not player's turn
    document.removeEventListener('touchstart', handleTouchStart);
    document.removeEventListener('touchend', handleTouchEnd);
  }
});

// Touch event handling for mobile devices
let touchTimeout;
let touchedCard = null;

function handleTouchStart(e) {
  const card = e.target.closest('.card-img');
  if (!card) return;
  
  touchedCard = card;
  touchTimeout = setTimeout(() => {
    if (touchedCard) {
      touchedCard.classList.toggle('selected');
    }
  }, 500);
}

function handleTouchEnd(e) {
  clearTimeout(touchTimeout);
  const card = e.target.closest('.card-img');
  
  if (card && card === touchedCard && e.timeStamp - e.target._touchStartTime < 500) {
    // Short tap - toggle selection
    card.classList.toggle('selected');
  }
  touchedCard = null;
}

// Add playCards function
function playCards(indexes) {
  if (indexes && indexes.length > 0) {
    socket.emit('playCards', indexes);
  }
}

// Helper function to play selected cards
function playSelectedCards() {
  const selected = Array.from(myHand.children)
    .filter(c => c.querySelector('.card-img')?.classList.contains('selected'))
    .map(c => parseInt(c.querySelector('.card-img').dataset.idx));
  
  if (selected.length > 0) {
    socket.emit('playCards', selected);
  }
}

// Modify play button to use the helper function
playBtn.onclick = playSelectedCards;

/* ---------- play ---------- */
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

// Move the event banner into the #center element for correct positioning
document.addEventListener('DOMContentLoaded', () => {
  const banner = document.getElementById('event-banner');
  const center = document.getElementById('center');
  if (banner && center && !center.contains(banner)) {
    center.appendChild(banner);
  }
});

// Listen for specialEffect socket event
socket.on('specialEffect', ({ value, type }) => {
  showCardEvent(value, type);
});
