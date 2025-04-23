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
const myName = $('my-name'), myHand = $('my-hand'), myStacks = $('my-stacks');
const other = $('other-players');
const playPile = $('play-pile'), drawPile = $('draw-pile');
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
}

function showCardEvent(cardValue, type) {
  const banner = document.getElementById('event-banner');
  if (!banner) return; // Exit if banner doesn't exist

  let text = '';
  let className = 'event';

  if (cardValue === 2) {
    text = 'RESET!';
    className += ' reset';
  } else if (cardValue === 5 && type === 'five') {
    text = 'COPY!';
    className += ' copy';
  } else if (cardValue === 10 || type === 'four') {
    text = 'BURN!';
    className += ' burn';
  } else {
    return; // Don't show banner for non-special events
  }

  banner.textContent = text;
  banner.className = className;

  // Add a delay before showing the banner
  const showDelay = 400; // milliseconds
  const duration = 1750; // milliseconds

  setTimeout(() => {
    banner.style.display = 'block'; // Make visible after delay
    // Hide the banner after its duration
    setTimeout(() => {
        banner.style.display = 'none';
    }, duration);
  }, showDelay);
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
  const n = nameIn.value.trim();
  if (!n) return alert('Enter a name');
  socket.emit('join', n, false);
};

joinComputerBtn.onclick = () => {
  const n = nameIn.value.trim();
  if (!n) return alert('Enter a name');
  const numComputers = parseInt(computerCountInput.value, 10); // Read the value
  // Basic validation (should also be handled by input attributes)
  if (isNaN(numComputers) || numComputers < 1 || numComputers > 3) {
    alert('Please select between 1 and 3 computer opponents.');
    return;
  }
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
  const takePileNotice = $('take-pile-notice');
  const generalNotice = $('notice-banner'); // Assuming this is your general notice banner ID

  // Clear both notices first
  if (takePileNotice) takePileNotice.classList.add('hidden');
  if (generalNotice) generalNotice.classList.add('hidden');

  if (!msg) return; // No message, do nothing

  // Check if it's the specific "Take Pile" message
  if (msg.startsWith('No valid moves')) {
    if (takePileNotice) {
      takePileNotice.textContent = msg;
      takePileNotice.classList.remove('hidden');
    }
  } else {
    // Otherwise, use the general notice banner
    if (generalNotice) {
      generalNotice.textContent = msg.replace('Take Pile', 'take pile'); // Keep capitalization fix
      generalNotice.classList.remove('hidden');
    }
  }
});

/* ---------- error handling ---------- */
socket.on('err', msg => {
  const generalNotice = $('notice-banner'); // Use general notice for errors too
  if (generalNotice) {
    generalNotice.textContent = `Error: ${msg.replace('Take Pile', 'take pile')}`; // Fix capitalization
    generalNotice.classList.remove('hidden');
  }
  // Ensure take pile notice is hidden on error
  const takePileNotice = $('take-pile-notice');
  if (takePileNotice) takePileNotice.classList.add('hidden');
});

/* ---------- state ---------- */
socket.on('state', s => {
  lobby.classList.add('hidden');
  table.classList.remove('hidden');

  // Clear other players panel before rendering
  other.innerHTML = '';

  // --- MAIN PLAYER AREA ---
  const myArea = document.getElementById('my-area');
  if (myArea) myArea.innerHTML = '';
  // Add active class if it's my turn
  if (s.turn === myId && myArea) {
    myArea.classList.add('active');
  } else if (myArea) {
    myArea.classList.remove('active'); // Ensure it's removed otherwise
  }

  let shouldShowHandButtons = false;
  let shouldShowStackButtons = false;
  let myHandCount = 0;
  let myUpCount = 0;
  let myDownCount = 0;

  s.players.forEach(p => {
    if (p.id === myId) {
      // Ensure the #my-name element is correctly populated
      const myArea = document.getElementById('my-area'); // Get the container first
      if (myArea) {
        myArea.innerHTML = ''; // Clear the area before adding new content
        const myNameElement = document.createElement('h2'); // Create the name element
        myNameElement.id = 'my-name';
        myNameElement.textContent = p.name; // Set the name
        myArea.appendChild(myNameElement); // Add it to the area
      } else {
        console.error("#my-area element not found!");
      }

      // Build hand row
      const handRow = document.createElement('div');
      handRow.id = 'my-hand';
      handRow.className = 'hand';
      myHandCount = p.hand.length;
      p.hand.forEach((c, i) => {
        const el = cardImg(c, s.turn === myId);
        const cardElement = el.querySelector('.card-img');
        cardElement.dataset.idx = i;
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
          const isClickable = s.turn === myId && p.hand.length === 0;
          const downCard = cardImg({ back: true }, false);
          downCard.querySelector('.card-img').classList.add('down-card');
          const upCard = cardImg(c, isClickable);
          upCard.querySelector('.card-img').classList.add('up-card');
          const upCardElement = upCard.querySelector('.card-img');
          upCardElement.dataset.idx = i + 1000;
          col.append(downCard, upCard);
          stackRow.appendChild(col);
        });
      } else if (p.down && p.down.length > 0) {
        p.down.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          const downCard = cardImg(c, s.turn === myId && p.hand.length === 0 && p.up.length === 0 && !c.back);
          downCard.querySelector('.card-img').classList.add('down-card');
          col.appendChild(downCard);
          stackRow.appendChild(col);
        });
      }

      // Render sections with labels
      if (myArea) {
        renderSection(myArea, 'Hand', handRow); // Use 'Hand' instead of 'Hand:'
        renderSection(myArea, 'Up / Down', stackRow); // Use 'Up / Down' instead of 'Up / Down:'
      }

      return;
    } else {
      // --- OPPONENT PANEL ---
      const panel = document.createElement('div');
      panel.className = 'player';
      panel.dataset.playerId = p.id;
      if (p.id === s.turn) panel.classList.add('active');
      if (p.isComputer) panel.classList.add('computer-player');

      // Create and append name header
      const nameHeader = document.createElement('h3');
      nameHeader.textContent = p.name;
      panel.appendChild(nameHeader);

      // Hand row - Render fanned cards instead of badge
      const hr = document.createElement('div');
      hr.className = 'opp-hand';
      if (p.handCount > 0) {
        for (let i = 0; i < p.handCount; i++) {
          const cardDivContainer = cardImg({ back: true }, false);
          cardDivContainer.classList.add('opp-card-container'); // Add class for styling
          hr.appendChild(cardDivContainer);
        }
      }

      // Stack row
      const sr = document.createElement('div');
      sr.className = 'stack-row';
      if (p.up && p.up.length > 0) {
        p.up.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          const downCard = cardImg({ back: true }, false);
          downCard.querySelector('.card-img').classList.add('down-card');
          const upCard = cardImg(c, false);
          upCard.querySelector('.card-img').classList.add('up-card');
          col.appendChild(downCard);
          col.appendChild(upCard);
          sr.appendChild(col);
        });
      } else if (p.down && p.down.length > 0) {
        p.down.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          const downCard = cardImg({ back: true }, false);
          downCard.querySelector('.card-img').classList.add('down-card');
          col.appendChild(downCard);
          sr.appendChild(col);
        });
      }

      // Render sections with labels
      renderSection(panel, 'Hand', hr); // Use 'Hand' instead of 'Hand:'
      renderSection(panel, 'Up / Down', sr); // Use 'Up / Down' instead of 'Up / Down:'

      other.appendChild(panel);
    }
  });

  // Decide where to show the button container
  if (myHandCount > 0) {
    shouldShowHandButtons = true;
  } else if (myUpCount > 0 || myDownCount > 0) {
    shouldShowStackButtons = true;
  }

  // Create the button container
  const btnContainer = document.createElement('div');
  btnContainer.className = 'button-container';
  btnContainer.id = 'dynamic-btn-container';
  const playBtnDyn = document.createElement('button');
  playBtnDyn.id = 'play';
  playBtnDyn.textContent = 'Play Selected';
  playBtnDyn.disabled = s.turn !== myId;
  playBtnDyn.onclick = playSelectedCards;
  const takeBtnDyn = document.createElement('button');
  takeBtnDyn.id = 'take';
  takeBtnDyn.textContent = 'Take Pile';
  takeBtnDyn.disabled = s.turn !== myId;
  takeBtnDyn.onclick = () => socket.emit('takePile');
  btnContainer.appendChild(playBtnDyn);
  btnContainer.appendChild(takeBtnDyn);

  // Insert the button container in the correct place
  if (shouldShowHandButtons && myArea) {
    const handRow = myArea.querySelector('#my-hand');
    if (handRow && handRow.parentNode) {
      handRow.parentNode.appendChild(btnContainer);
    }
  } else if (shouldShowStackButtons && myArea) {
    const stackRow = myArea.querySelector('#my-stacks');
    if (stackRow && stackRow.parentNode) {
      stackRow.parentNode.appendChild(btnContainer);
    }
  }

  // --- CENTER AREA (DECK, DISCARD, NOTICES) ---
  const centerDiv = document.getElementById('center'); // Get the center container
  if (centerDiv) centerDiv.innerHTML = '';
  else {
    console.error("#center element not found!");
    return; // Stop processing if center div is missing
  }

  // --- Render Draw Pile FIRST ---
  const drawPileContainer = document.createElement('div');
  drawPileContainer.className = 'center-pile-container'; // Use the specific class
  drawPileContainer.id = 'deck-pile-container'; // Assign ID

  const drawLabel = document.createElement('div');
  drawLabel.className = 'pile-label';
  drawLabel.textContent = 'Deck';
  drawPileContainer.appendChild(drawLabel);

  const drawPileDiv = document.createElement('div');
  drawPileDiv.id = 'draw-pile'; // Keep the ID on the inner div
  drawPileDiv.className = 'pile small'; // Add 'small' class for deck styling
  drawPileContainer.appendChild(drawPileDiv);

  const drawCountSpan = document.createElement('span');
  drawCountSpan.id = 'draw-count'; // Keep the ID on the span
  drawCountSpan.className = 'pile-count';
  drawPileContainer.appendChild(drawCountSpan);

  if (s.deckCount) {
    drawPileDiv.appendChild(cardImg({ back: true })); // Add card back image
    drawCountSpan.textContent = s.deckCount; // Set count text
    if (s.turn === myId) {
       drawPileDiv.classList.add('playable-pile');
    }
  } else {
    drawPileDiv.classList.remove('small');
    drawPileDiv.style.backgroundColor = 'transparent';
    drawPileDiv.style.border = 'none';
    drawPileDiv.style.boxShadow = 'none';
    drawCountSpan.textContent = '0';
  }
  centerDiv.appendChild(drawPileContainer); // Append Draw Pile

  // --- Render Discard Pile SECOND ---
  const playPileContainer = document.createElement('div');
  playPileContainer.className = 'center-pile-container'; // Use the specific class
  playPileContainer.id = 'discard-pile-container'; // Assign ID

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
    if ([2, 5, 10].includes(topCard.value) || (s.playPile.length >= 4 && s.playPile.slice(-4).every(c => c.value === topCard.value))) {
      // showCardEvent(topCard.value, s.playPile.length >= 4 ? 'four' : undefined);
      // Triggering the event banner is now handled by the 'specialEffect' socket event listener below
    }
    playCountSpan.textContent = s.playPile.length;
    if (s.turn === myId) {
      playPileDiv.classList.add('playable-pile');
    }
  } else {
    playCountSpan.textContent = '0';
  }
  centerDiv.appendChild(playPileContainer); // Append Discard Pile

  // --- Append Take Pile Notice (will be positioned by CSS) ---
  const takePileNoticeElement = document.createElement('div');
  takePileNoticeElement.id = 'take-pile-notice';
  takePileNoticeElement.className = 'notice hidden'; // Start hidden
  centerDiv.appendChild(takePileNoticeElement);

  // --- Append Event Banner (will be positioned by CSS) ---
  const eventBanner = document.createElement('div');
  eventBanner.id = 'event-banner';
  eventBanner.style.display = 'none'; // Start hidden
  centerDiv.appendChild(eventBanner);

  // Determine playability for hover effects
  const isMyTurn = s.turn === myId;
  const canPlayHand = isMyTurn && myHandCount > 0;
  const canPlayUp = isMyTurn && myHandCount === 0 && myUpCount > 0;
  const canPlayDown = isMyTurn && myHandCount === 0 && myUpCount === 0 && myDownCount > 0;

  // Update my hand cards with playability
  const myHandDiv = document.getElementById('my-hand');
  if (myHandDiv) {
    Array.from(myHandDiv.children).forEach(container => {
      const img = container.querySelector('.card-img');
      if (img) {
        if (canPlayHand) {
          container.classList.add('playable-card-container');
          img.style.cursor = 'pointer';
          // Ensure click handlers are only active when playable
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

  // Update my stack cards with playability
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
            playSelectedCards(); // Use same function, it reads dataset.idx
          };
      } else if (canPlayDown && downCardImg && !upCardImg) { // Only playable if no up card exists
         stack.classList.add('playable-stack'); // Use same class for hover
         downCardImg.style.cursor = 'pointer';
         downCardImg.onclick = () => downCardImg.classList.toggle('selected');
         downCardImg.ondblclick = () => {
            downCardImg.classList.add('selected');
            playSelectedCards(); // Use same function
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

  // Update the card event handling for better touch support
  if (s.turn === myId) {
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
  // Use the new DOM structure: find the hand row by id
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
  // Update page URL with room ID
  const url = new URL(window.location);
  url.searchParams.set('room', roomId);
  window.history.pushState({}, '', url);
  console.log('[DEBUG] Updated URL to:', url.toString());
  // Update lobby text to show room info and make it copyable
  const lobbyText = `Game Room: ${roomId} - Waiting for players (1/2) — Share this link!`; // Update player count later
  lobby.textContent = lobbyText;
  lobby.style.cursor = 'pointer'; // Ensure cursor is pointer here too
  lobby.onclick = () => { // Ensure copy works here too
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

// Listen for opponentTookPile socket event
socket.on('opponentTookPile', ({ playerId }) => {
  // Find the opponent's panel
  const playerPanels = document.querySelectorAll('#other-players .player');
  playerPanels.forEach(panel => {
    const nameHeader = panel.querySelector('h3');
    if (panel.dataset.playerId === playerId || (nameHeader && nameHeader.dataset.playerId === playerId)) {
      showTookPileBanner(panel);
    }
  });
});
