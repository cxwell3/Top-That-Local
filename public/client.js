// Wrap the main logic in DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded and parsed'); // New log

  const socket = io({
    reconnectionDelayMax: 10000,
    reconnection: true,
    reconnectionDelay: 1000,
  });

  console.log('Top That! client.js version 20250424_lobby_modal loaded');

  /* ---------- DOM Refs ---------- */
  const $ = id => document.getElementById(id);

  // Lobby elements
  const lobbyContainer = $('lobby-container');
  const lobbyFormCard = $('lobby-form-card');
  const lobbyFormContent = $('lobby-form-content');
  const waitingStateDiv = $('waiting-state');
  const nameIn = $('name');
  const nameError = $('name-error');
  const joinBtn = $('join');
  const joinComputerBtn = $('join-computer');
  const tutorialBtn = $('tutorial-btn');
  const computerCountInput = $('computer-count');
  const copyLinkBtn = $('copy-link-button');
  const shareLinkMessage = $('share-link-message');

  // Modal elements
  const modalOverlay = $('modal-overlay');
  const rulesModal = $('rules-modal');
  const rulesButton = $('rules-button');
  const rulesModalCloseButton = rulesModal ? rulesModal.querySelector('.modal-close-button') : null;

  // Game elements
  const notice = $('notice-banner');
  const table = $('table');
  const other = $('other-players');
  const myArea = $('my-area');

  // Add a dev/test restart button
  function addRestartButton() {
    if (document.getElementById('dev-restart-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'dev-restart-btn';
    btn.textContent = 'Restart Game (Dev)';
    btn.className = 'btn btn-tertiary';
    btn.style.position = 'fixed';
    btn.style.bottom = '24px';
    btn.style.right = '24px';
    btn.style.zIndex = 2000;
    btn.onclick = () => {
      socket.emit('adminReset');
      // Skip reconnect logic: just reload page
      window.location.reload();
    };
    document.body.appendChild(btn);
  }

  addRestartButton();

  // Global state
  let myId = null;
  let currentRoom = null;
  let activeModal = null; // Keep track of the currently open modal

  /* ---------- UI State Functions ---------- */

  function showOverlay() {
    console.log('[Debug] showOverlay called'); // Re-added log
    if (modalOverlay) modalOverlay.classList.remove('hidden');
    else console.error('[Debug Error] modalOverlay is null in showOverlay'); // Added check
  }
  function hideOverlay() {
    console.log('[Debug] hideOverlay called'); // Re-added log
    if (modalOverlay && !activeModal) {
      modalOverlay.classList.add('hidden');
    } else if (!modalOverlay) {
       console.error('[Debug Error] modalOverlay is null in hideOverlay'); // Added check
    }
  }

  function showLobbyForm() {
    console.log('[Debug] showLobbyForm called'); // Re-added log

    // Log initial state & check elements
    console.log('[Debug] Before changes:');
    if (modalOverlay) console.log(`  - modalOverlay classes: ${modalOverlay.className}`);
    else console.error('[Debug Error] modalOverlay is null in showLobbyForm (start)');
    if (lobbyContainer) console.log(`  - lobbyContainer classes: ${lobbyContainer.className}`);
    else console.error('[Debug Error] lobbyContainer is null in showLobbyForm (start)');
    const lobbyCardInitial = $('lobby-form-card');
    if (lobbyCardInitial) console.log(`  - lobby-form-card opacity: ${lobbyCardInitial.style.opacity}`);
    else console.error('[Debug Error] lobby-form-card is null in showLobbyForm (start)');


    if (modalOverlay) modalOverlay.classList.add('hidden'); // Force hide overlay
    if (lobbyContainer) lobbyContainer.classList.remove('hidden');
    if (lobbyFormContent) lobbyFormContent.classList.remove('hidden');
    if (waitingStateDiv) waitingStateDiv.classList.add('hidden');
    if (table) table.classList.add('hidden');
    if (nameIn) {
      nameIn.value = 'Player 1';
      nameIn.placeholder = 'Player 1';
      nameIn.readOnly = true;
      nameIn.disabled = false;
    }
    if (joinBtn) joinBtn.disabled = false;
    if (joinComputerBtn) joinComputerBtn.disabled = false;
    if (computerCountInput) computerCountInput.disabled = false;
    clearNameError(); // Check inside this function if errors persist

    const lobbyCard = $('lobby-form-card');
    if (lobbyCard) {
        lobbyCard.style.opacity = '1'; // Set opacity directly
    } else {
        console.error('[Debug Error] lobby-form-card is null in showLobbyForm (setting opacity)');
    }

    // Log final state
    console.log('[Debug] After changes:');
    if (modalOverlay) console.log(`  - modalOverlay classes: ${modalOverlay.className}`);
    if (lobbyContainer) console.log(`  - lobbyContainer classes: ${lobbyContainer.className}`);
    if (lobbyCard) console.log(`  - lobby-form-card opacity: ${lobbyCard.style.opacity}`);

  }

  function showWaitingState(roomId, playersLength, maxPlayers, playersList) {
    console.log('[Debug] showWaitingState called'); // Added log
    if (lobbyContainer) lobbyContainer.classList.remove('hidden');
    if (lobbyFormContent) lobbyFormContent.classList.add('hidden');
    if (waitingStateDiv) waitingStateDiv.classList.remove('hidden');
    if (table) table.classList.add('hidden');

    const waitingHeading = $('waiting-heading');
    if (waitingHeading) {
      waitingHeading.textContent = `Room: ${roomId} (${playersLength}/${maxPlayers})`;
    }
    if (shareLinkMessage) {
      shareLinkMessage.textContent = `Share the link to invite others!`;
    }
    const url = new URL(window.location);
    url.searchParams.set('room', roomId);
    window.history.pushState({}, '', url);
    hideOverlay(); // Ensure overlay is hidden
  }

  function showGameTable() {
    console.log('[Debug] showGameTable called'); // Added log
    if (lobbyContainer) lobbyContainer.classList.add('hidden');
    if (table) table.classList.remove('hidden');
    if (notice) notice.classList.add('hidden');
    hideOverlay(); // Hide overlay when game starts
    closeModal(); // Ensure any open modals are closed
  }

  /* ---------- Modal Handling ---------- */

  function openModal(modalElement) {
    console.log('[Debug] openModal called for:', modalElement ? modalElement.id : 'null'); // Re-added log
    if (!modalElement) return;
    closeModal();
    showOverlay(); // Show overlay ONLY for actual modals (like rules)
    modalElement.classList.remove('hidden');
    activeModal = modalElement;
    trapFocus(modalElement);
  }

  function closeModal() {
    console.log('[Debug] closeModal called for:', activeModal ? activeModal.id : 'null'); // Re-added log
    if (!activeModal) return;
    activeModal.classList.add('hidden');
    activeModal.removeEventListener('keydown', handleFocusTrap);
    activeModal = null;
    hideOverlay(); // Hide overlay if no other modal needs it
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
  }

  // Basic Focus Trap
  let focusableElements = null;
  let firstFocusableElement = null;
  let lastFocusableElement = null;

  function trapFocus(modalElement) {
    focusableElements = modalElement.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusableElements.length) return;
    firstFocusableElement = focusableElements[0];
    lastFocusableElement = focusableElements[focusableElements.length - 1];

    // Focus the first element initially
    setTimeout(() => {
      firstFocusableElement.focus();
    }, 0);

    modalElement.addEventListener('keydown', handleFocusTrap);
  }

  function handleFocusTrap(e) {
    if (e.key !== 'Tab' || !activeModal) return;

    const currentFocusableElements = activeModal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!currentFocusableElements.length) return;
    const currentFirstFocusable = currentFocusableElements[0];
    const currentLastFocusable = currentFocusableElements[currentFocusableElements.length - 1];

    if (e.shiftKey) { // Shift + Tab
      if (document.activeElement === currentFirstFocusable) {
        currentLastFocusable.focus();
        e.preventDefault();
      }
    } else { // Tab
      if (document.activeElement === currentLastFocusable) {
        currentFirstFocusable.focus();
        e.preventDefault();
      }
    }
  }

  // Event listeners for rules modal
  if (rulesButton) {
    rulesButton.addEventListener('click', () => openModal(rulesModal));
  }
  if (rulesModalCloseButton) {
    rulesModalCloseButton.addEventListener('click', closeModal);
  }

  // Close modal if overlay is clicked
  if (modalOverlay) {
    modalOverlay.addEventListener('click', closeModal);
  }

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeModal) {
      closeModal();
    }
  });

  /* ---------- Validation ---------- */
  function validateName() {
    if (nameIn && nameIn.readOnly && nameIn.value === 'Player 1') {
      clearNameError();
      return 'Player 1';
    }
    const n = nameIn.value.trim();
    if (!n) {
      if(nameIn) nameIn.classList.add('input-error');
      if(nameError) nameError.classList.remove('hidden');
      return false;
    }
    clearNameError();
    return n;
  }

  function clearNameError() {
    if (nameIn) nameIn.classList.remove('input-error');
    if (nameError) nameError.classList.add('hidden');
  }

  if (nameIn) {
    nameIn.value = 'Player 1'; // Always pre-fill as Player 1
    nameIn.placeholder = 'Player 1';
    nameIn.disabled = false; // Allow editing so the value is submitted
    nameIn.readOnly = true; // Prevent user from changing, but value is included in form
  }

  /* ---------- Socket Event Handlers ---------- */
  socket.on('connect', () => {
    console.log('✅ Socket connected');
    console.log('[Debug Connect] Checking sessionStorage...');
    const storedId = sessionStorage.getItem('myId');
    const storedRoom = sessionStorage.getItem('currentRoom');
    console.log(`[Debug Connect] storedId: ${storedId}, storedRoom: ${storedRoom}`);

    if (storedId && storedRoom) {
      console.log(`[Debug Connect] Attempting rejoin for room ${storedRoom} as ${storedId}`);
      socket.emit('rejoin', storedId, storedRoom);
    } else {
      console.log('[Debug Connect] No session found, preparing to show lobby.');
      myId = null;
      currentRoom = null;
      sessionStorage.removeItem('myId');
      sessionStorage.removeItem('currentRoom');
      console.log('[Debug Connect] Calling showLobbyForm()...');
      showLobbyForm(); // This should now run after DOM is ready
      console.log('[Debug Connect] ...showLobbyForm() called.');
    }
  });

  socket.on('connect_error', (err) => {
    console.error('❌ Socket connection failed:', err.message);
    showError('Connection failed. Please refresh.');
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔌 Socket disconnected: ${reason}`);
    showError('Disconnected. Attempting to reconnect...');
  });

  socket.on('joined', d => {
    myId = d.id;
    sessionStorage.setItem('myId', myId);
    console.log(`✅ Joined/Rejoined as ${myId}`);
  });

  socket.on('gameRoom', roomId => {
    console.log(`🚪 Entered game room: ${roomId}`);
    currentRoom = roomId;
    sessionStorage.setItem('currentRoom', currentRoom);
  });

  socket.on('lobby', data => {
    console.log('🛋️ Lobby update:', data);
    const { players, maxPlayers, roomId } = data;
    currentRoom = roomId;
    sessionStorage.setItem('currentRoom', currentRoom);
    showWaitingState(roomId, players.length, maxPlayers);
  });

  socket.on('state', s => {
    console.log('[Debug] Received state event:', s); // Debug log for state event
    if (s.started) {
      showGameTable();
      renderGameState(s);
    } else {
      // Show lobby waiting state if game not started
      if (s.players && s.players.length && currentRoom) {
        showWaitingState(currentRoom, s.players.length, s.players.length > 0 ? 4 : 0);
      }
    }
  });

  socket.on('notice', msg => {
    if (!notice) return;
    if (!msg) {
      notice.classList.add('hidden');
      return;
    }
    notice.textContent = msg.replace('Take Pile', 'take pile');
    notice.classList.remove('hidden');
    setTimeout(() => {
      if (notice.textContent === msg.replace('Take Pile', 'take pile')) {
        notice.classList.add('hidden');
      }
    }, 4000);
  });

  socket.on('err', msg => {
    console.error(`❌ Server Error: ${msg}`);
    showError(msg); // Display the error message to the user

    // Specific handling for "Game room no longer exists" error during rejoin
    if (msg.includes('Game room no longer exists')) {
      console.log('Handling \'Game room no longer exists\' error: Resetting state.');
      myId = null;
      currentRoom = null;
      sessionStorage.removeItem('myId');
      sessionStorage.removeItem('currentRoom');
      // Clear the room parameter from the URL
      const url = new URL(window.location);
      url.searchParams.delete('room');
      window.history.pushState({}, '', url);
      // Show the lobby form
      showLobbyForm();
    }
  });

  socket.on('specialEffect', ({ value, type }) => {
    showCardEvent(value, type);
  });

  socket.on('opponentTookPile', ({ playerId }) => {
    const playerPanel = document.querySelector(`.player[data-player-id="${playerId}"]`);
    if (playerPanel) {
      showTookPileBanner(playerPanel);
    }
  });

  /* ---------- Event Listeners ---------- */
  if (joinBtn) {
    joinBtn.onclick = () => {
      const name = validateName();
      if (name) {
        console.log(`Attempting to join as ${name} (vs Human)`);
        socket.emit('join', name, false);
      }
    };
  }

  if (joinComputerBtn) {
    joinComputerBtn.onclick = () => {
      const name = validateName();
      if (name) {
        const numComputers = parseInt(computerCountInput.value, 10) || 1;
        console.log(`[Debug] Emitting join event: name=${name}, vsComputer=true, numComputers=${numComputers}`);
        socket.emit('join', name, true, numComputers);
      }
    };
  }

  if (tutorialBtn) {
    tutorialBtn.onclick = () => {
      if (lobbyContainer) lobbyContainer.classList.add('hidden');
      if (table) table.classList.remove('hidden');
      injectTutorialGameState();
      startTutorial();
    };
  }

  // Inject a fake game state for tutorial mode
  function injectTutorialGameState() {
    // Simulate a real game start: 3 hand, 3 up, 3 down for player and opponent
    const tutorialState = {
      deckCount: 40,
      playPile: [{ value: 4, suit: 'hearts' }],
      discardCount: 0,
      turn: 'tutorial-player',
      players: [
        {
          id: 'tutorial-player',
          name: 'You',
          isComputer: false,
          disconnected: false,
          hand: [
            { value: 7, suit: 'diamonds' },
            { value: 2, suit: 'spades' },
            { value: 9, suit: 'clubs' }
          ],
          handCount: 3,
          up: [
            { value: 5, suit: 'clubs' },
            { value: 10, suit: 'hearts' },
            { value: 8, suit: 'spades' }
          ],
          down: [
            { back: true },
            { back: true },
            { back: true }
          ],
          downCount: 3
        },
        {
          id: 'tutorial-opponent',
          name: 'CPU',
          isComputer: true,
          disconnected: false,
          hand: [],
          handCount: 3,
          up: [
            { value: 6, suit: 'hearts' },
            { value: 3, suit: 'spades' },
            { value: 'K', suit: 'clubs' }
          ],
          down: [
            { back: true },
            { back: true },
            { back: true }
          ],
          downCount: 3
        }
      ]
    };
    myId = 'tutorial-player';
    renderGameState(tutorialState);
  }

  // --- Tutorial Logic ---
  const tutorialSteps = [
    {
      message: 'Welcome to Top That! Let\'s learn the basics. Click Next to continue.',
      highlight: null,
      restrict: null,
      expect: null
    },
    {
      message: 'This is your hand. Play any card higher than the top card of the discard pile (highlighted).',
      highlight: 'hand',
      restrict: 'hand',
      expect: [0, 2] // allow 7 or 9 (indexes in hand)
    },
    {
      message: 'Try to play a 2. It resets the pile and lets you play anything next!',
      highlight: 'special2',
      restrict: '2',
      expect: [1] // only index 1 (the 2)
    },
    {
      message: 'Try to play a 10. It burns the pile!',
      highlight: 'special10',
      restrict: '10',
      expect: null // up card, will allow in next step
    },
    {
      message: 'Try to play a 5. It copies the previous card\'s value!',
      highlight: 'special5',
      restrict: '5',
      expect: null // up card, will allow in next step
    },
    {
      message: 'Great job! You\'ve learned the basics. Play a full game to master the rest!',
      highlight: null,
      restrict: null,
      expect: null
    }
  ];
  let tutorialStep = 0;
  let tutorialActive = false;

  function startTutorial() {
    tutorialActive = true;
    tutorialStep = 0;
    showTutorialStep();
  }

  function showTutorialStep() {
    showTutorialBanner(tutorialSteps[tutorialStep].message, tutorialStep > 0, tutorialStep < tutorialSteps.length - 1);
    highlightTutorialCards(tutorialSteps[tutorialStep].highlight);
  }

  function showTutorialBanner(msg, showBack, showNext) {
    let banner = document.getElementById('tutorial-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'tutorial-banner';
      banner.className = 'banner';
      banner.style.position = 'fixed';
      banner.style.top = '90px';
      banner.style.left = '50%';
      banner.style.transform = 'translateX(-50%)';
      banner.style.zIndex = 2000;
      banner.style.background = '#ffd36b';
      banner.style.color = '#222';
      banner.style.fontWeight = 'bold';
      banner.style.fontSize = '1.2rem';
      banner.style.padding = '1rem 2rem';
      banner.style.borderRadius = '10px';
      document.body.appendChild(banner);
    }
    banner.innerHTML = '';
    if (showBack) {
      const backBtn = document.createElement('button');
      backBtn.textContent = 'Back';
      backBtn.className = 'btn btn-tertiary';
      backBtn.style.marginRight = '1rem';
      backBtn.onclick = () => {
        tutorialStep = Math.max(0, tutorialStep - 1);
        showTutorialStep();
      };
      banner.appendChild(backBtn);
    }
    const msgSpan = document.createElement('span');
    msgSpan.textContent = msg;
    banner.appendChild(msgSpan);
    if (showNext) {
      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'Next';
      nextBtn.className = 'btn btn-primary';
      nextBtn.style.marginLeft = '1rem';
      nextBtn.onclick = () => {
        tutorialStep = Math.min(tutorialSteps.length - 1, tutorialStep + 1);
        showTutorialStep();
      };
      banner.appendChild(nextBtn);
    }
  }

  function highlightTutorialCards(type) {
    // Remove previous highlights
    document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
    if (!type) return;
    if (type === 'hand') {
      document.querySelectorAll('#my-hand .card-img').forEach(el => el.classList.add('tutorial-highlight'));
    }
    // Special card highlights (2, 5, 10)
    if (type === 'special2') {
      document.querySelectorAll('#my-hand .card-img').forEach(el => {
        if (el.src.includes('/2')) el.classList.add('tutorial-highlight');
      });
    }
    if (type === 'special10') {
      document.querySelectorAll('#my-hand .card-img').forEach(el => {
        if (el.src.includes('/0')) el.classList.add('tutorial-highlight');
      });
    }
    if (type === 'special5') {
      document.querySelectorAll('#my-hand .card-img').forEach(el => {
        if (el.src.includes('/5')) el.classList.add('tutorial-highlight');
      });
    }
  }

  function showTutorialBanner() {
    let banner = document.getElementById('tutorial-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'tutorial-banner';
      banner.className = 'banner';
      banner.style.position = 'fixed';
      banner.style.top = '90px';
      banner.style.left = '50%';
      banner.style.transform = 'translateX(-50%)';
      banner.style.zIndex = 2000;
      banner.style.background = '#ffd36b';
      banner.style.color = '#222';
      banner.style.fontWeight = 'bold';
      banner.style.fontSize = '1.2rem';
      banner.style.padding = '1rem 2rem';
      banner.style.borderRadius = '10px';
      banner.textContent = 'Tutorial Mode: This is where your interactive tutorial will begin!';
      document.body.appendChild(banner);
    } else {
      banner.textContent = 'Tutorial Mode: This is where your interactive tutorial will begin!';
      banner.classList.remove('hidden');
    }
  }

  function snapCard(cardElement) {
    if (!cardElement) return;
    cardElement.classList.remove('snap-anim');
    // Force reflow to restart animation
    void cardElement.offsetWidth;
    cardElement.classList.add('snap-anim');
    setTimeout(() => cardElement.classList.remove('snap-anim'), 300);
  }

  // Patch playSelectedCards to use tutorial logic and snap effect
  const realPlaySelectedCards = playSelectedCards;
  function playSelectedCardsTutorial() {
    if (!tutorialActive) return realPlaySelectedCards();
    const selectedCards = document.querySelectorAll('.card-img.selected');
    if (selectedCards.length === 0) return;
    const indexes = Array.from(selectedCards).map(img => parseInt(img.dataset.idx));
    const step = tutorialSteps[tutorialStep];
    if (step.expect && (!indexes.every(idx => step.expect.includes(idx)) || indexes.length !== step.expect.length)) {
      showError('Please play the highlighted card(s) for this step.');
      return;
    }
    // Snap animation for all selected cards
    selectedCards.forEach(img => snapCard(img));
    // Simulate the play: remove the card from hand and advance
    tutorialStep = Math.min(tutorialSteps.length - 1, tutorialStep + 1);
    showTutorialStep();
    injectTutorialGameState();
  }
  window.playSelectedCards = playSelectedCardsTutorial;

  // Enhance snap effect for main game as well
  const origPlaySelectedCards = playSelectedCards;
  function playSelectedCardsWithSnap() {
    const selectedCards = document.querySelectorAll('.card-img.selected');
    selectedCards.forEach(img => snapCard(img));
    origPlaySelectedCards();
  }
  window.playSelectedCards = playSelectedCardsWithSnap;

  if (copyLinkBtn) {
    copyLinkBtn.onclick = () => {
      const url = window.location.href;
      navigator.clipboard.writeText(url)
        .then(() => {
          const originalText = copyLinkBtn.textContent;
          copyLinkBtn.textContent = 'Copied!';
          copyLinkBtn.disabled = true;
          setTimeout(() => {
            copyLinkBtn.textContent = originalText;
            copyLinkBtn.disabled = false;
          }, 1500);
        })
        .catch(err => {
          console.error('Failed to copy link: ', err);
          if(shareLinkMessage) shareLinkMessage.textContent = 'Could not copy link automatically.'; // Added null check
        });
    };
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      console.log('🛑 Sending adminReset');
      socket.emit('adminReset');
      myId = null;
      currentRoom = null;
      sessionStorage.removeItem('myId');
      sessionStorage.removeItem('currentRoom');
      window.history.pushState({}, '', window.location.pathname);
      showLobbyForm();
    }
  });

  /* ---------- Helper Functions ---------- */
  function showError(msg) {
    if (!notice) return;
    notice.textContent = `Error: ${msg.replace('Take Pile', 'take pile')}`;
    notice.classList.remove('hidden');
    notice.style.backgroundColor = 'var(--error-color)';
    notice.style.color = 'white';

    setTimeout(() => {
      notice.classList.add('hidden');
      notice.style.backgroundColor = '';
      notice.style.color = '';
    }, 5000);
  }

  function code(c) {
    if (!c || typeof c.value === 'undefined' || c.value === null) return '';
    const v = c.value === 10 ? '0' : String(c.value).toUpperCase() === 'A' ? 'ace' : String(c.value).toUpperCase();
    const s = { hearts: 'H', diamonds: 'D', clubs: 'C', spades: 'S' }[c.suit];
    if (!s) return '';
    if (v === 'ace') return `A${s}`;
    return v + s;
  }

  function cardImg(card, sel = false) {
    const container = document.createElement('div');

    const img = new Image();
    img.className = 'card-img';
    img.src = card.back
      ? 'https://deckofcardsapi.com/static/img/back.png'
      : `https://deckofcardsapi.com/static/img/${code(card)}.png`;
    img.alt = card.back ? 'Card back' : `${card.value} of ${card.suit}`;

    if (sel) {
      img.style.cursor = 'pointer';
      // Attach handlers directly on the image so click always registers
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        const isSelected = img.classList.toggle('selected');
        container.classList.toggle('selected-container', isSelected);
      });
      img.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (!img.classList.contains('selected')) {
          img.classList.add('selected');
          container.classList.add('selected-container');
        }
        playSelectedCards();
      });
    } else {
      img.style.cursor = 'default';
    }

    container.appendChild(img);

    return container;
  }

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
    let className = '';

    if (cardValue === 2) {
      text = '♻️ RESET!';
      className = 'reset';
    } else if (cardValue === 5 && type === 'five') {
      text = '🌀 COPY!';
      className = 'copy';
    } else if (cardValue === 10) {
      text = '🔥 BURN!';
      className = 'burn';
    } else if (type === 'four') {
      text = '4️⃣ FOUR!';
      className = 'burn';
    } else {
      banner.className = '';
      banner.textContent = '';
      return;
    }

    banner.textContent = text;
    banner.className = '';
    void banner.offsetWidth;
    banner.className = `event-banner-visible ${className}`;

    clearTimeout(banner._hideTimeout);
    banner._hideTimeout = setTimeout(() => {
      if (banner.classList.contains('event-banner-visible')) {
        banner.classList.remove('event-banner-visible');
        setTimeout(() => { banner.textContent = ''; }, 400);
      }
    }, 3000);
  }

  function showTookPileBanner(panel) {
    const oldBanner = panel.querySelector('.took-pile-banner');
    if (oldBanner) oldBanner.remove();
    const banner = document.createElement('div');
    banner.className = 'took-pile-banner';
    banner.textContent = 'Took the pile!';
    panel.insertBefore(banner, panel.firstChild);
    setTimeout(() => {
      banner.remove();
    }, 1750);
  }

  function playSelectedCards() {
    const selectedCards = document.querySelectorAll('.card-img.selected');
    if (selectedCards.length === 0) return;

    const indexes = Array.from(selectedCards).map(img => parseInt(img.dataset.idx));

    const isHandPlay = indexes.every(idx => idx < 1000);
    const isUpPlay = indexes.every(idx => idx >= 1000 && idx < 2000);
    const isDownPlay = indexes.every(idx => idx >= 2000);

    if (!(isHandPlay || isUpPlay || isDownPlay)) {
      showError("You can only play cards from one area (Hand, Up, or Down) at a time.");
      selectedCards.forEach(img => img.classList.remove('selected'));
      return;
    }

    if (isDownPlay && indexes.length > 1) {
      showError("You can only play one face-down card at a time.");
      selectedCards.forEach(img => img.classList.remove('selected'));
      return;
    }

    console.log(`▶️ Emitting playCards with indexes: ${indexes}`);
    socket.emit('playCards', indexes);
  }

  function renderGameState(s) {
    if (other) other.innerHTML = '';
    if (myArea) myArea.innerHTML = '';

    let myHandCount = 0;
    let myUpCount = 0;
    let myDownCount = 0;
    let isMyTurn = s.turn === myId;

    s.players.forEach(p => {
      if (p.id === myId) {
        if (!myArea) return;
        myArea.classList.toggle('active', isMyTurn);

        // --- Stylized player name header ---
        const myNameHeader = document.createElement('div');
        myNameHeader.className = 'player-name-header player-human';
        myNameHeader.innerHTML = `<span class="player-badge">👤</span> <span class="player-name-text">${p.name}</span>`;
        myArea.appendChild(myNameHeader);

        const handRow = document.createElement('div');
        handRow.id = 'my-hand';
        handRow.className = 'hand';
        myHandCount = p.hand.length;
        p.hand.forEach((c, i) => {
          const canInteract = isMyTurn;
          const el = cardImg(c, canInteract);
          const cardElement = el.querySelector('.card-img');
          if (cardElement) {
            cardElement.dataset.idx = i;
            if (canInteract) {
              el.classList.add('playable-card-container');
            }
          }
          handRow.appendChild(el);
        });
        renderSection(myArea, 'Hand', handRow);

        // --- Buttons ABOVE up/down cards ---
        let btnContainer = document.getElementById('dynamic-btn-container');
        if (!btnContainer) {
          btnContainer = document.createElement('div');
          btnContainer.className = 'button-container';
          btnContainer.id = 'dynamic-btn-container';
          const playBtnDyn = document.createElement('button');
          playBtnDyn.id = 'play';
          playBtnDyn.textContent = 'Play Selected';
          playBtnDyn.onclick = playSelectedCards;
          playBtnDyn.className = 'btn btn-primary';
          const takeBtnDyn = document.createElement('button');
          takeBtnDyn.id = 'take';
          takeBtnDyn.textContent = 'Take Pile';
          takeBtnDyn.onclick = () => socket.emit('takePile');
          takeBtnDyn.className = 'btn btn-secondary';
          btnContainer.appendChild(playBtnDyn);
          btnContainer.appendChild(takeBtnDyn);
        }
        const playBtn = btnContainer.querySelector('#play');
        const takeBtn = btnContainer.querySelector('#take');
        if (playBtn) playBtn.disabled = !isMyTurn;
        if (takeBtn) takeBtn.disabled = !isMyTurn;
        myArea.appendChild(btnContainer);

        // --- Up/Down stacks ---
        const stackRow = document.createElement('div');
        stackRow.id = 'my-stacks';
        stackRow.className = 'stack-row';
        myUpCount = p.up.length;
        myDownCount = p.down ? p.down.length : 0;
        const canPlayStacks = isMyTurn && myHandCount === 0;

        if (myUpCount > 0) {
          p.up.forEach((c, i) => {
            const col = document.createElement('div');
            col.className = 'stack';
            const canPlayThisStack = canPlayStacks;
            const downCard = cardImg({ back: true }, false);
            const downCardImg = downCard.querySelector('.card-img');
            if (downCardImg) downCardImg.classList.add('down-card');

            const upCard = cardImg(c, canPlayThisStack);
            const upCardElement = upCard.querySelector('.card-img');
            if (upCardElement) {
              upCardElement.classList.add('up-card');
              upCardElement.dataset.idx = i + 1000;
              if (canPlayThisStack) col.classList.add('playable-stack');
            }
            col.append(downCard, upCard);
            stackRow.appendChild(col);
          });
        } else if (myDownCount > 0) {
          p.down.forEach((c, i) => {
            const col = document.createElement('div');
            col.className = 'stack';
            const canPlayThisStack = canPlayStacks && myUpCount === 0 && i === 0;
            const downCard = cardImg(c.back ? { back: true } : c, canPlayThisStack);
            const downCardImg = downCard.querySelector('.card-img');
            if (downCardImg) {
              downCardImg.classList.add('down-card');
              downCardImg.dataset.idx = i + 2000;
              if (canPlayThisStack) col.classList.add('playable-stack');
            }
            col.appendChild(downCard);
            stackRow.appendChild(col);
          });
        }
        renderSection(myArea, 'Up / Down', stackRow);

      } else {
        if (!other) return;
        const panel = document.createElement('div');
        panel.className = 'player player-area';
        panel.dataset.playerId = p.id;
        panel.classList.toggle('active', p.id === s.turn);
        if (p.isComputer) panel.classList.add('computer-player');
        if (p.disconnected) panel.classList.add('disconnected');
        // Add tutorial-player class if needed in future

        // --- Stylized player name header ---
        const nameHeader = document.createElement('div');
        nameHeader.className = 'player-name-header ' + (p.isComputer ? 'player-cpu' : 'player-human');
        nameHeader.innerHTML = `<span class="player-badge">${p.isComputer ? '🤖' : '👤'}</span> <span class="player-name-text">${p.name}${p.disconnected ? " <span class='player-role'>(Disconnected)</span>" : ''}</span>`;
        panel.appendChild(nameHeader);

        const hr = document.createElement('div');
        hr.className = 'opp-hand';
        if (p.handCount > 0) {
          for (let i = 0; i < p.handCount; i++) {
            hr.appendChild(cardImg({ back: true }, false));
          }
        }
        renderSection(panel, `Hand (${p.handCount})`, hr);

        const sr = document.createElement('div');
        sr.className = 'stack-row';
        if (p.up && p.up.length > 0) {
          p.up.forEach((c) => {
            const col = document.createElement('div');
            col.className = 'stack';
            const downCard = cardImg({ back: true }, false);
            const downCardImg = downCard.querySelector('.card-img');
            if (downCardImg) downCardImg.classList.add('down-card');
            const upCard = cardImg(c, false);
            const upCardImg = upCard.querySelector('.card-img');
            if (upCardImg) upCardImg.classList.add('up-card');
            col.append(downCard, upCard);
            sr.appendChild(col);
          });
        } else if (p.downCount && p.downCount > 0) {
          for (let i = 0; i < p.downCount; i++) {
            const col = document.createElement('div');
            col.className = 'stack';
            const downCard = cardImg({ back: true }, false);
            const downCardImg = downCard.querySelector('.card-img');
            if (downCardImg) downCardImg.classList.add('down-card');
            col.appendChild(downCard);
            sr.appendChild(col);
          }
        }
        renderSection(panel, `Up (${p.up.length}) / Down (${p.downCount})`, sr);

        other.appendChild(panel);
      }
    });

    const centerDiv = document.getElementById('center');
    if (!centerDiv) return;

    let eventBanner = document.getElementById('event-banner');
    if (eventBanner && eventBanner.parentNode === centerDiv) {
      centerDiv.removeChild(eventBanner);
    }
    centerDiv.innerHTML = '';
    if (eventBanner) {
      centerDiv.insertBefore(eventBanner, centerDiv.firstChild);
    }

    const pilesWrapper = document.createElement('div');
    pilesWrapper.className = 'center-piles-wrapper';

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
  }

}); // End of DOMContentLoaded listener
