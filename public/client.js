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

  // Attempt to rejoin if session data exists
  const storedId = sessionStorage.getItem('myId');
  const storedRoom = sessionStorage.getItem('currentRoom');

  if (storedId && storedRoom) {
    console.log(`Attempting to rejoin room ${storedRoom} as ${storedId}`);
    socket.emit('rejoin', storedId, storedRoom);
  } else {
    // Clear game state if not rejoining
    myId = null;
    currentRoom = null;
    sessionStorage.removeItem('myId');
    sessionStorage.removeItem('currentRoom');
    nameIn.value = '';
    nameIn.disabled = false;
    joinBtn.disabled = false;
    notice.classList.add('hidden');
    lobby.classList.remove('hidden');
    table.classList.add('hidden');
  }
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
    // Clear client state and session storage
    myId = null;
    currentRoom = null;
    sessionStorage.removeItem('myId');
    sessionStorage.removeItem('currentRoom');
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
const other = $('other-players');
const joinComputerBtn = $('join-computer');
const computerCountInput = $('computer-count'); // Get the new input field

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

/**
 * Wraps a row element with a label, then appends to the parent.
 * @param {Element} parent    The container to append into (e.g. your #my-area or each .player panel)
 * @param {string} labelText  The text for the label (e.g. "Hand" or "Up / Down")
 * @param {Element} rowEl     The row element (e.g. .hand or .stack-row)
 */
function renderSection(parent, labelText, rowEl) {
  const section = document.createElement('div');
  section.className = 'player-section';
  const label = document.createElement('div');
  label.className = 'row-label';
  label.textContent = labelText;
  section.append(label, rowEl);
  parent.appendChild(section);
  return section;
}

function showCardEvent(cardValue, type) {
  const banner = document.getElementById('event-banner');
  if (!banner) {
    console.error("#event-banner not found in showCardEvent!");
    return;
  }

  let text = '';
  let className = ''; // Start with no specific class

  if (cardValue === 2) {
    text = 'RESET!';
    className = 'reset';
  } else if (cardValue === 5 && type === 'five') {
    text = 'COPY!';
    className = 'copy';
  } else if (cardValue === 10 || type === 'four') {
    text = 'BURN!';
    className = 'burn';
  } else {
    // If not a special event, ensure banner is hidden
    banner.className = ''; // Clear classes
    banner.textContent = ''; // Clear text
    return;
  }

  // --- Display Logic --- 
  console.log(`[Banner] Showing: ${text} (Value: ${cardValue}, Type: ${type})`); // DEBUG
  banner.textContent = text;
  banner.className = ''; // Clear previous classes first
  // Force reflow before adding class to ensure transition triggers
  void banner.offsetWidth;
  banner.className = `event-banner-visible ${className}`; // Use visibility class + specific type class

  // Automatically hide after a delay
  setTimeout(() => {
    // Check if the banner still has the visible class before removing it
    if (banner.classList.contains('event-banner-visible')) {
        console.log(`[Banner] Hiding: ${text}`); // DEBUG
        banner.classList.remove('event-banner-visible');
        // Optionally clear text after fade out
        // setTimeout(() => { banner.textContent = ''; }, 300); // Match transition duration
    }
  }, 2000); // Hide after 2 seconds
}

function showTookPileBanner(panel) {
  // Remove any existing banner
  const oldBanner = panel.querySelector('.took-pile-banner');
  if (oldBanner) oldBanner.remove();
  // Create and show the banner
  const banner = document.createElement('div');
  banner.className = 'took-pile-banner';
  banner.textContent = 'Took the pile!';
  panel.insertBefore(banner, panel.firstChild);
  setTimeout(() => {
    banner.remove();
  }, 1750);
}

/* ---------- join ---------- */
joinBtn.onclick = () => {
  console.log("[DEBUG] Join Game button clicked."); // ADDED
  const n = nameIn.value.trim();
  if (!n) return alert('Enter a name');
  console.log(`[DEBUG] Emitting 'join' for player: ${n}, vsComputer: false`); // ADDED
  socket.emit('join', n, false);
};

joinComputerBtn.onclick = () => {
  console.log("[DEBUG] Play vs Computer button clicked."); // ADDED
  const n = nameIn.value.trim();
  if (!n) return alert('Enter a name');
  const numComputers = parseInt(computerCountInput.value, 10); // Read the value
  // Basic validation (should also be handled by input attributes)
  if (isNaN(numComputers) || numComputers < 1 || numComputers > 3) {
    alert('Please select between 1 and 3 computer opponents.');
    return;
  }
  console.log(`[DEBUG] Emitting 'join' for player: ${n}, vsComputer: true, count: ${numComputers}`); // ADDED
  socket.emit('join', n, true, numComputers); // Send the count to the server
};

/* ---------- lobby ---------- */
socket.on('lobby', data => { // Expect an object now
  const { players, maxPlayers, roomId } = data;
  const lobbyText = `Room: ${roomId} - Waiting for players (${players.length}/${maxPlayers}) — Share link to invite others!`;
  lobby.textContent = lobbyText;
  lobby.classList.remove('hidden');
  table.classList.add('hidden');
  // Re-enable input fields when returning to lobby
  joinBtn.disabled = nameIn.disabled = false;

  // Add click-to-copy functionality
  lobby.style.cursor = 'pointer'; // Indicate it's clickable
  lobby.onclick = () => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => {
        // Optional: Provide feedback to the user
        const originalText = lobby.textContent;
        lobby.textContent = 'Link Copied!';
        setTimeout(() => { lobby.textContent = originalText; }, 1500);
      })
      .catch(err => {
        console.error('Failed to copy link: ', err);
        // Optional: Alert user if copy failed
        alert('Could not copy link automatically. Please copy it manually.');
      });
  };
});

/* ---------- joined ---------- */
socket.on('joined', d => {
  myId = d.id;
  sessionStorage.setItem('myId', myId); // Store myId
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
  // Always show the game table and hide the lobby when state is received
  table.classList.remove('hidden');
  lobby.classList.add('hidden');

  // --- Clear Areas ---
  const otherPlayersContainer = $('other-players');
  if (otherPlayersContainer) otherPlayersContainer.innerHTML = '';
  const myArea = document.getElementById('my-area');
  if (myArea) myArea.innerHTML = '';

  let myHandCount = 0;
  let myUpCount = 0;
  let myDownCount = 0;
  let isMyTurn = s.turn === myId; // Determine if it's my turn

  // --- Render Player Panels ---
  s.players.forEach(p => {
    if (p.id === myId) {
      // --- MY PLAYER PANEL ---
      if (!myArea) return;
      // Create and append name header
      const myNameElement = document.createElement('h2');
      myNameElement.id = 'my-name';
      myNameElement.textContent = p.name;
      myArea.appendChild(myNameElement);

      // Build hand row
      const handRow = document.createElement('div');
      handRow.id = 'my-hand';
      handRow.className = 'hand';
      myHandCount = p.hand.length;
      p.hand.forEach((c, i) => {
        const el = cardImg(c, isMyTurn); // Pass isMyTurn to cardImg
        const cardElement = el.querySelector('.card-img');
        if (cardElement) cardElement.dataset.idx = i;
        handRow.appendChild(el);
      });

      // Build stack row
      const stackRow = document.createElement('div');
      stackRow.id = 'my-stacks';
      stackRow.className = 'stack-row';
      myUpCount = p.up.length;
      myDownCount = p.down ? p.down.length : 0;
      if (p.up.length > 0) {
        p.up.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          const isClickable = isMyTurn && p.hand.length === 0;
          const downCard = cardImg({ back: true }, false);
          const downCardImg = downCard.querySelector('.card-img');
          if (downCardImg) downCardImg.classList.add('down-card');
          const upCard = cardImg(c, isClickable);
          const upCardElement = upCard.querySelector('.card-img');
          if (upCardElement) {
             upCardElement.classList.add('up-card');
             upCardElement.dataset.idx = i + 1000;
          }
          col.append(downCard, upCard);
          stackRow.appendChild(col);
        });
      } else if (p.down && p.down.length > 0) {
        p.down.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          const isClickable = isMyTurn && p.hand.length === 0 && p.up.length === 0 && !c.back;
          const downCard = cardImg(c, isClickable);
          const downCardImg = downCard.querySelector('.card-img');
          if (downCardImg) {
            downCardImg.classList.add('down-card');
            downCardImg.dataset.idx = i + 2000; // Use a different range for down cards
          }
          col.appendChild(downCard);
          stackRow.appendChild(col);
        });
      }

      // Render sections with labels
      const handSection = renderSection(myArea, 'Hand', handRow);
      const upDownSection = renderSection(myArea, 'Up / Down', stackRow);

      // Add active class if it's my turn
      if (isMyTurn) myArea.classList.add('active');
      else myArea.classList.remove('active');

      // --- Ensure Buttons Exist and are below the cards being played ---
      let btnContainer = document.getElementById('dynamic-btn-container');
      if (!btnContainer) {
        btnContainer = document.createElement('div');
        btnContainer.className = 'button-container';
        btnContainer.id = 'dynamic-btn-container';
        const playBtnDyn = document.createElement('button');
        playBtnDyn.id = 'play';
        playBtnDyn.textContent = 'Play Selected';
        playBtnDyn.onclick = playSelectedCards;
        const takeBtnDyn = document.createElement('button');
        takeBtnDyn.id = 'take';
        takeBtnDyn.textContent = 'Take Pile';
        takeBtnDyn.onclick = () => socket.emit('takePile');
        btnContainer.appendChild(playBtnDyn);
        btnContainer.appendChild(takeBtnDyn);
      }
      // Place buttons below the cards being played
      if (myHandCount > 0) {
        if (handSection && handSection.nextSibling !== btnContainer) {
          myArea.insertBefore(btnContainer, handSection.nextSibling);
        }
      } else {
        if (upDownSection && upDownSection.nextSibling !== btnContainer) {
          myArea.insertBefore(btnContainer, upDownSection.nextSibling);
        }
      }
      // Set Button Disabled State
      const playBtn = document.getElementById('play');
      const takeBtn = document.getElementById('take');
      if (playBtn) playBtn.disabled = !isMyTurn;
      if (takeBtn) takeBtn.disabled = !isMyTurn;

    } else {
      // --- OPPONENT PANEL ---
      const panel = document.createElement('div');
      panel.className = 'player';
      panel.dataset.playerId = p.id;
      if (p.id === s.turn) panel.classList.add('active');
      if (p.isComputer) panel.classList.add('computer-player');

      const nameHeader = document.createElement('h3');
      nameHeader.textContent = p.name;
      panel.appendChild(nameHeader);

      const hr = document.createElement('div');
      hr.className = 'opp-hand';
      if (p.handCount > 0) {
        for (let i = 0; i < p.handCount; i++) {
          const cardDivContainer = cardImg({ back: true }, false);
          cardDivContainer.classList.add('opp-card-container');
          hr.appendChild(cardDivContainer);
        }
      }

      const sr = document.createElement('div');
      sr.className = 'stack-row';
      if (p.up && p.up.length > 0) {
        p.up.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          const downCard = cardImg({ back: true }, false);
          const downCardImg = downCard.querySelector('.card-img');
          if (downCardImg) downCardImg.classList.add('down-card');
          const upCard = cardImg(c, false);
          const upCardImg = upCard.querySelector('.card-img');
          if (upCardImg) upCardImg.classList.add('up-card');
          col.appendChild(downCard);
          col.appendChild(upCard);
          sr.appendChild(col);
        });
      } else if (p.down && p.down.length > 0) {
        p.down.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          const downCard = cardImg({ back: true }, false);
          const downCardImg = downCard.querySelector('.card-img');
          if (downCardImg) downCardImg.classList.add('down-card');
          col.appendChild(downCard);
          sr.appendChild(col);
        });
      }

      renderSection(panel, 'Hand', hr);
      renderSection(panel, 'Up / Down', sr);

      if (otherPlayersContainer) {
          otherPlayersContainer.appendChild(panel);
      } else {
          console.error("Cannot append opponent panel, #other-players container missing!");
      }
    }
  }); // End of player rendering loop

  // Update play pile with count
  const centerDiv = document.getElementById('center');
  centerDiv.innerHTML = '';

  // --- Deck/Discard in a single bordered wrapper, deck on left, discard on right ---
  const pilesWrapper = document.createElement('div');
  pilesWrapper.className = 'center-piles-wrapper';

  // Deck pile (left)
  const drawPileContainer = document.createElement('div');
  drawPileContainer.className = 'center-pile-container';
  const drawLabel = document.createElement('div');
  drawLabel.className = 'pile-label';
  drawLabel.textContent = 'Deck';
  drawPileContainer.appendChild(drawLabel);
  const drawPileDiv = document.createElement('div');
  drawPileDiv.id = 'draw-pile';
  drawPileDiv.className = 'pile small';
  drawPileContainer.appendChild(drawPileDiv);
  const drawCountSpan = document.createElement('span');
  drawCountSpan.id = 'draw-count';
  drawCountSpan.className = 'pile-count';
  drawPileContainer.appendChild(drawCountSpan);
  if (s.deckCount) {
    drawPileDiv.appendChild(cardImg({ back: true }));
    drawCountSpan.textContent = s.deckCount;
    if (isMyTurn) drawPileDiv.classList.add('playable-pile');
  } else {
    drawPileDiv.classList.remove('small');
    drawPileDiv.style.backgroundColor = 'transparent';
    drawPileDiv.style.border = 'none';
    drawPileDiv.style.boxShadow = 'none';
    drawCountSpan.textContent = '0';
  }
  pilesWrapper.appendChild(drawPileContainer);

  // Discard pile (right)
  const playPileContainer = document.createElement('div');
  playPileContainer.className = 'center-pile-container';
  const playLabel = document.createElement('div');
  playLabel.className = 'pile-label';
  playLabel.textContent = 'Discard';
  playPileContainer.appendChild(playLabel);
  const playPileDiv = document.createElement('div');
  playPileDiv.id = 'play-pile';
  playPileDiv.className = 'pile';
  playPileContainer.appendChild(playPileDiv);
  const playCountSpan = document.createElement('span');
  playCountSpan.id = 'play-count';
  playCountSpan.className = 'pile-count';
  playPileContainer.appendChild(playCountSpan);
  if (s.playPile.length) {
    const topCard = s.playPile.at(-1);
    playPileDiv.appendChild(cardImg(topCard));
    playCountSpan.textContent = s.playPile.length;
    if (isMyTurn) playPileDiv.classList.add('playable-pile');
  } else {
    playCountSpan.textContent = '0';
  }
  pilesWrapper.appendChild(playPileContainer);

  centerDiv.appendChild(pilesWrapper);

  let eventBanner = document.getElementById('event-banner');
  if (!eventBanner) {
      eventBanner = document.createElement('div');
      eventBanner.id = 'event-banner';
      if (centerDiv) {
          centerDiv.insertBefore(eventBanner, centerDiv.firstChild);
      } else {
          console.error("#center not found, cannot append event banner");
      }
  }

  const canPlayHand = isMyTurn && myHandCount > 0;
  const canPlayUp = isMyTurn && myHandCount === 0 && myUpCount > 0;
  const canPlayDown = isMyTurn && myHandCount === 0 && myUpCount === 0 && myDownCount > 0;

  const myHandDiv = document.getElementById('my-hand');
  if (myHandDiv) {
    Array.from(myHandDiv.children).forEach(container => {
      const img = container.querySelector('.card-img');
      if (img) {
        if (canPlayHand) {
          container.classList.add('playable-card-container');
          img.style.cursor = 'pointer';
          img.onclick = () => img.classList.toggle('selected');
          img.ondblclick = () => {
            img.classList.add('selected');
            playSelectedCards();
          };
        } else {
          container.classList.remove('playable-card-container');
          img.style.cursor = 'default';
          img.onclick = null;
          img.ondblclick = null;
        }
      }
    });
  }

  const myStacksDiv = document.getElementById('my-stacks');
  if (myStacksDiv) {
    Array.from(myStacksDiv.children).forEach(stack => {
      const upCardImg = stack.querySelector('.up-card');
      const downCardImg = stack.querySelector('.down-card');

      if (canPlayUp && upCardImg) {
        stack.classList.add('playable-stack');
        upCardImg.style.cursor = 'pointer';
        upCardImg.onclick = () => upCardImg.classList.toggle('selected');
         upCardImg.ondblclick = () => {
            upCardImg.classList.add('selected');
            playSelectedCards();
          };
      } else if (canPlayDown && downCardImg && !upCardImg) {
         stack.classList.add('playable-stack');
         downCardImg.style.cursor = 'pointer';
         downCardImg.onclick = () => downCardImg.classList.toggle('selected');
         downCardImg.ondblclick = () => {
            downCardImg.classList.add('selected');
            playSelectedCards();
          };
      } else {
        stack.classList.remove('playable-stack');
        if (upCardImg) {
           upCardImg.style.cursor = 'default';
           upCardImg.onclick = null;
           upCardImg.ondblclick = null;
        }
        if (downCardImg) {
           downCardImg.style.cursor = 'default';
           downCardImg.onclick = null;
           downCardImg.ondblclick = null;
        }
      }
    });
  }

  if (isMyTurn) {
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
  } else {
    document.removeEventListener('touchstart', handleTouchStart);
    document.removeEventListener('touchend', handleTouchEnd);
  }
});

// Listen for specialEffect socket event
socket.on('specialEffect', ({ value, type }) => {
  showCardEvent(value, type);
});

// Listen for opponentTookPile socket event
socket.on('opponentTookPile', ({ playerId }) => {
  const playerPanels = document.querySelectorAll('#other-players .player');
  playerPanels.forEach(panel => {
    const nameHeader = panel.querySelector('h3');
    if (panel.dataset.playerId === playerId || (nameHeader && nameHeader.dataset.playerId === playerId)) {
      showTookPileBanner(panel);
    }
  });
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
  const handRow = document.querySelector('#my-hand');
  if (!handRow) return;
  const selected = Array.from(handRow.children)
    .filter(c => c.querySelector('.card-img')?.classList.contains('selected'))
    .map(c => parseInt(c.querySelector('.card-img').dataset.idx));
  if (selected.length > 0) {
    socket.emit('playCards', selected);
  }
}

/* ---------- play ---------- */

/* ---------- game room ---------- */
socket.on('gameRoom', roomId => {
  console.log('[DEBUG] Received gameRoom event with roomId:', roomId);
  currentRoom = roomId;
  sessionStorage.setItem('currentRoom', currentRoom); // Store currentRoom
  const url = new URL(window.location);
  url.searchParams.set('room', roomId);
  window.history.pushState({}, '', url);
  console.log('[DEBUG] Updated URL to:', url.toString());
  const lobbyText = `Game Room: ${roomId} - Waiting for players (1/2) — Share this link!`;
  lobby.textContent = lobbyText;
  lobby.style.cursor = 'pointer';
  lobby.onclick = () => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => {
        const originalText = lobby.textContent;
        lobby.textContent = 'Link Copied!';
        setTimeout(() => { lobby.textContent = originalText; }, 1500);
      })
      .catch(err => {
        console.error('Failed to copy link: ', err);
        alert('Could not copy link automatically. Please copy it manually.');
      });
  };
});

window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');
  if (roomId) {
    currentRoom = roomId;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const banner = document.getElementById('event-banner');
  const center = document.getElementById('center');
  if (banner && center && !center.contains(banner)) {
    center.appendChild(banner);
  }
});
