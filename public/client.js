// Wrap the main logic in DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded and parsed'); // New log

  // Preload all card images to eliminate first-render flash
  (function preloadAllCardImages() {
    const suits = ['H','D','C','S'];
    const values = ['2','3','4','5','6','7','8','9','0','J','Q','K','A'];
    suits.forEach(s => values.forEach(v => {
      const img = new Image();
      img.src = `https://deckofcardsapi.com/static/img/${v}${s}.png`;
    }));
    const back = new Image();
    back.src = 'https://deckofcardsapi.com/static/img/back.png';
  })();

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

  // Remove dev restart functionality
  function addRestartButton() {}
  function addRestartButtons() {}

  // After reload, auto-trigger Play vs Computer if requested
  if (sessionStorage.getItem('autoPlayVsComputer') === '1') {
    sessionStorage.removeItem('autoPlayVsComputer');
    setTimeout(() => {
      if (typeof joinComputerBtn?.onclick === 'function') {
        joinComputerBtn.onclick();
      } else {
        // fallback: simulate click
        joinComputerBtn?.click();
      }
    }, 300);
  }

  // Global state
  let myId = null;
  let currentRoom = null;
  let activeModal = null; // Keep track of the currently open modal
  let pileTransition = false; // Track if the pile is in a transition state (e.g., after 5, 10, or four-of-a-kind)
  let pendingSpecialEffect = null; // Track any pending specialEffect for banner display after render

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
    if (nameIn) {
      nameIn.value = 'Player 1';
      nameIn.placeholder = 'Player 1';
      nameIn.readOnly = true;
      nameIn.disabled = false;
    }
    if (joinBtn) joinBtn.disabled = false;
    if (joinComputerBtn) joinComputerBtn.disabled = false;
    // allow user to choose number of computer opponents
    if (computerCountInput) {
      computerCountInput.disabled = false;
    }
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

    prevStarted = false; // Reset game start flag so showGameTable() can trigger again
  }

  function showWaitingState(roomId, playersLength, maxPlayers, playersList) {
    console.log('[Debug] showWaitingState called'); // Added log
    if (lobbyContainer) lobbyContainer.classList.remove('hidden');
    if (lobbyFormContent) lobbyFormContent.classList.add('hidden');
    if (waitingStateDiv) waitingStateDiv.classList.remove('hidden');

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
    console.log('[Debug] showGameTable called');
    if (lobbyContainer) lobbyContainer.classList.add('hidden');
    if (table) table.classList.remove('hidden'); // Ensure table is visible
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

  // Track previous started state to prevent multiple showGameTable() calls
  let prevStarted = false;

  // Previous client-side CPU delay logic removed; rendering immedately on each state
  socket.on('state', s => {
    console.log('[Debug] Received state event:', s);

    if (s.started && !prevStarted) showGameTable();
    prevStarted = s.started;

    if (s.started) {
      renderGameState(s);
    } else {
      if (s.players && s.players.length && currentRoom) {
        showWaitingState(currentRoom, s.players.length, s.players.length > 0 ? 4 : 0);
      }
    }
  });

  socket.on('gameOver', ({ winnerId, winnerName }) => {
    console.log(`[Debug] Game Over! Winner: ${winnerName} (${winnerId})`);
    showGameOverMessage(winnerId === myId, winnerName);
  });

  // Handle general notices/errors from the server
  let noticeTimeout = null; // Variable to hold the timeout ID
  socket.on('notice', (message) => {
    const errorBanner = document.getElementById('error-banner');
    if (!errorBanner) return; // Safety check

    // Clear any pending notice display
    clearTimeout(noticeTimeout);

    if (message) {
      // Delay showing the notice slightly more
      noticeTimeout = setTimeout(() => {
        errorBanner.textContent = message;
        errorBanner.classList.remove('hidden');
      }, 1000); // Increased delay to 1000ms (1 second)
    } else {
      // Hide immediately if the message is empty
      errorBanner.classList.add('hidden');
      errorBanner.textContent = ''; // Clear text when hiding
    }
  });

  socket.on('err', msg => {
    console.error(`❌ Server Error: ${msg}`);
    // Check if banner exists before calling showError
    const bannerExists = document.getElementById('error-banner');
    if (!bannerExists) {
      console.error('[Debug] #error-banner NOT FOUND before calling showError in err handler!');
    } else {
      console.log('[Debug] #error-banner FOUND before calling showError in err handler.');
    }
    showError(msg);

    // Deselect cards if the error is related to an invalid play
    if (msg.toLowerCase().includes('invalid play') || msg.toLowerCase().includes('must be higher') || msg.toLowerCase().includes('cannot play')) {
      console.log('[Debug] Deselecting cards due to server error.');
      const selectedCards = document.querySelectorAll('.card-img.selected');
      selectedCards.forEach(img => {
        img.classList.remove('selected');
        // Also remove the container selection class if applicable
        const container = img.closest('.selected-container');
        if (container) {
          container.classList.remove('selected-container');
        }
      });
    }

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
    // Always run pile-transition immediately on special card
    if (value === 10 || type === 'four' || (value === 'five' || value === 5)) {
      setPileTransition(true);
      setTimeout(() => setPileTransition(false), 2000);
    }
    // Queue banner to show after next renderGameState
    pendingSpecialEffect = { value, type };
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
      restrict: null,
      expect: null // up card, will allow in next step
    },
    {
      message: 'Try to play a 5. It copies the previous card\'s value!',
      highlight: 'special5',
      restrict: null,
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
    if (pileTransition) return;
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

  /* Remove Ctrl+R listener */
  /* document.addEventListener('keydown', e => {
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
  }); */

  /* ---------- Helper Functions ---------- */
  function setPileTransition(active) {
    pileTransition = active;
    const playBtn = document.getElementById('play');
    if (playBtn) playBtn.disabled = active;
  }

  function showError(msg) {
    const errorBanner = document.getElementById('error-banner');
    if (!errorBanner) {
      console.error('#error-banner element not found!');
      return;
    }
    console.log(`[Debug] showError called with message: "${msg}"`); // Add log

    // Clear any existing timeout before showing the new message
    clearTimeout(errorBanner._hideTimeout);

    errorBanner.textContent = msg;
    errorBanner.classList.remove('hidden');

    // Set a new timeout to hide the banner
    errorBanner._hideTimeout = setTimeout(() => {
      errorBanner.classList.add('hidden');
      errorBanner.textContent = '';
    }, 2000); // shorten error banner display from 4000ms to 2000ms
  }

  function clearError() {
    const errorBanner = document.getElementById('error-banner');
    if (errorBanner) errorBanner.classList.add('hidden');
  }

  function code(c) {
    if (!c || typeof c.value === 'undefined' || c.value === null) return '';
    const v = c.value === 10 ? '0' : String(c.value).toUpperCase() === 'A' ? 'ace' : String(c.value).toUpperCase();
    const s = { hearts: 'H', diamonds: 'D', clubs: 'C', spades: 'S' }[c.suit];
    if (!s) return '';
    if (v === 'ace') return `A${s}`;
    return v + s;
  }

  function cardImg(card, sel = false, onCardLoad) {
    const container = document.createElement('div');
    const img = new Image();
    img.className = 'card-img';
    img.style.visibility = 'hidden';  // Hide alt text until image loads
    img.src = card.back
      ? 'https://deckofcardsapi.com/static/img/back.png'
      : `https://deckofcardsapi.com/static/img/${code(card)}.png`;
    img.alt = card.back ? 'Card back' : `${card.value} of ${card.suit}`;
    img.onload = () => {
      img.style.visibility = 'visible';
      if (typeof onCardLoad === 'function') onCardLoad(img);
    };
    if (sel) {
      img.classList.add('selectable');  // mark image as selectable
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
    }, 1000); // shorten banner display from 3000ms to 1000ms
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
    if (pileTransition) return;

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
    clearError();
    socket.emit('playCards', indexes);
  }

  // Function to create center piles (deck and discard)
  function createCenterPiles(state) {
    const center = document.getElementById('center');
    if (!center) return;

    // Clear existing content except for event/error banners
    const eventBanner = document.getElementById('event-banner');
    const errorBanner = document.getElementById('error-banner');
    center.innerHTML = '';
    if (eventBanner) center.appendChild(eventBanner);
    if (errorBanner) center.appendChild(errorBanner);

    // Create center area to hold the piles
    const centerArea = document.createElement('div');
    centerArea.className = 'center-area';

    // Create wrapper for piles
    const pilesWrapper = document.createElement('div');
    pilesWrapper.className = 'center-piles-wrapper';

    // Create deck pile
    const deckContainer = document.createElement('div');
    deckContainer.className = 'center-pile-container';
    const deckLabel = document.createElement('div');
    deckLabel.className = 'pile-label';
    deckLabel.textContent = `Deck (${state.deckCount})`;
    const deckPile = document.createElement('div');
    deckPile.className = 'deck pile';
    if (state.deckCount > 0) {
      const deckCard = cardImg({ back: true }, false);
      deckPile.appendChild(deckCard);
    }
    deckContainer.appendChild(deckLabel);
    deckContainer.appendChild(deckPile);

    // Create discard pile
    const discardContainer = document.createElement('div');
    discardContainer.className = 'center-pile-container';
    const discardLabel = document.createElement('div');
    discardLabel.className = 'pile-label';
    discardLabel.textContent = `Discard (${state.discardCount || 0})`;
    const discardPile = document.createElement('div');
    discardPile.className = 'discard pile';
    if (state.playPile && state.playPile.length > 0) {
      const topCard = state.playPile[state.playPile.length - 1];
      const discardCard = cardImg(topCard, false);
      discardPile.appendChild(discardCard);
    }
    discardContainer.appendChild(discardLabel);
    discardContainer.appendChild(discardPile);

    // Add piles to wrapper
    pilesWrapper.appendChild(deckContainer);
    pilesWrapper.appendChild(discardContainer);

    // Add wrapper to center area
    centerArea.appendChild(pilesWrapper);
    
    // Add center area to center
    center.appendChild(centerArea);
  }

  function renderGameState(s) {
    console.log('[Debug] renderGameState called. State:', s);
    // Card table layout: clear all slots
    const slotTop = document.querySelector('.table-slot-top');
    const slotBottom = document.querySelector('.table-slot-bottom');
    const slotLeft = document.querySelector('.table-slot-left');
    const slotRight = document.querySelector('.table-slot-right');
    const slotCenter = document.querySelector('.table-slot-center');
    if (slotTop) slotTop.innerHTML = '';
    if (slotBottom) slotBottom.innerHTML = '';
    if (slotLeft) slotLeft.innerHTML = '';
    if (slotRight) slotRight.innerHTML = '';

    // Remove any previous active highlights
    document.querySelectorAll('.player-area.active').forEach(el => el.classList.remove('active'));

    // --- Robust seat assignment for 2-4 players ---
    const meIdx = s.players.findIndex(p => p.id === myId);
    const playerCount = s.players.length;
    // Map seat index to slot name
    function seatFor(idx) {
      if (playerCount === 2) return idx === meIdx ? 'bottom' : 'top';
      if (playerCount === 3) {
        if (idx === meIdx) return 'bottom';
        if ((idx - meIdx + playerCount) % playerCount === 1) return 'left';
        return 'right'; // Use right instead of top for 3 players
      }
      if (playerCount === 4) {
        if (idx === meIdx) return 'bottom';
        if ((idx - meIdx + playerCount) % playerCount === 1) return 'left';
        if ((idx - meIdx + playerCount) % playerCount === 2) return 'top';
        return 'right';
      }
      return 'bottom';
    }

    // --- Render all players in correct slots ---
    s.players.forEach((p, idx) => {
      const seat = seatFor(idx);
      let panel = document.createElement('div');
      panel.className = 'player-area' + (p.isComputer ? ' computer-player' : '');
      panel.dataset.playerId = p.id;
      if (seat === 'bottom' && p.id === myId) panel.id = 'my-area';
      if (p.isComputer) panel.classList.add('computer-player');
      if (p.disconnected) panel.classList.add('disconnected');
      if (p.id === s.turn) panel.classList.add('active');
      // All player panels: vertical stacking (banner, hand, up/down)
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      panel.style.alignItems = 'center';
      // Add rotation classes for left/right CPUs
      if (seat === 'left') panel.classList.add('rotate-right');
      if (seat === 'right') panel.classList.add('rotate-left');
      // Name header (banner)
      const nameHeader = document.createElement('div');
      nameHeader.className = 'player-name-header ' + (p.isComputer ? 'player-cpu' : 'player-human');
      nameHeader.innerHTML = `<span class="player-name-text">${p.name}${p.disconnected ? " <span class='player-role'>(Disconnected)</span>" : ''}</span>`;
      panel.appendChild(nameHeader);
      // Hand row
      const handRow = document.createElement('div');
      if (p.id === myId) handRow.id = 'my-hand';
      handRow.className = p.id === myId ? 'hand' : 'opp-hand';
      if (p.hand && p.hand.length > 0) {
        const visualHandCount = p.id === myId ? p.hand.length : Math.min(p.handCount, 3);
        for (let i = 0; i < visualHandCount; i++) {
          const card = p.id === myId ? p.hand[i] : { back: true };
          const canInteract = p.id === myId && s.turn === myId;
          const el = document.createElement('div');
          el.className = 'card-placeholder';
          const cardEl = cardImg(card, canInteract, () => {
            el.innerHTML = '';
            el.appendChild(cardEl);
          });
          if (p.id === myId) {
            const cardElement = cardEl.querySelector('.card-img');
            if (cardElement) {
              cardElement.dataset.idx = i;
              if (canInteract) cardEl.classList.add('playable-card-container');
            }
          }
          el.appendChild(cardEl);
          handRow.appendChild(el);
        }
      } else if (p.isComputer && p.handCount > 0) {
        const visualHandCount = Math.min(p.handCount, 3);
        for (let i = 0; i < visualHandCount; i++) {
          const el = document.createElement('div');
          el.className = 'card-placeholder';
          const cardEl = cardImg({ back: true }, false);
          el.appendChild(cardEl);
          handRow.appendChild(el);
        }
      }
      renderSection(panel, `Hand${p.id === myId ? '' : ' (' + p.handCount + ')'}`, handRow);
      // Buttons for human player (only in bottom slot)
      if (p.id === myId && seat === 'bottom') {
        let btnContainer = document.createElement('div');
        btnContainer.className = 'button-container';
        btnContainer.id = 'dynamic-btn-container';
        const playBtnDyn = document.createElement('button');
        playBtnDyn.id = 'play';
        playBtnDyn.textContent = 'Play';
        playBtnDyn.onclick = playSelectedCards;
        playBtnDyn.className = 'btn btn-primary';
        const takeBtnDyn = document.createElement('button');
        takeBtnDyn.id = 'take';
        takeBtnDyn.textContent = 'Take';
        takeBtnDyn.onclick = () => {
          clearError();
          socket.emit('takePile');
        };
        takeBtnDyn.className = 'btn btn-secondary';
        btnContainer.appendChild(playBtnDyn);
        btnContainer.appendChild(takeBtnDyn);
        // Enable/disable based on turn
        playBtnDyn.disabled = !s.turn || s.turn !== myId;
        takeBtnDyn.disabled = !s.turn || s.turn !== myId;
        btnContainer.style.display = 'flex';
        panel.appendChild(btnContainer);
      }
      // Up/Down stacks
      const stackRow = document.createElement('div');
      stackRow.className = 'stack-row';
      if (p.up && p.up.length > 0) {
        p.up.forEach((c, i) => {
          const col = document.createElement('div');
          col.className = 'stack';
          const downCard = cardImg({ back: true }, false);
          const downCardImg = downCard.querySelector('.card-img');
          if (downCardImg) downCardImg.classList.add('down-card');
          const upCard = cardImg(c, p.id === myId && s.turn === myId && p.hand.length === 0);
          const upCardImg = upCard.querySelector('.card-img');
          if (upCardImg) {
            upCardImg.classList.add('up-card');
            if (p.id === myId) upCardImg.dataset.idx = i + 1000;
          }
          col.append(downCard, upCard);
          if (p.id === myId && s.turn === myId && p.hand.length === 0) {
            col.classList.add('playable-stack'); // mark stack as playable
          }
          stackRow.appendChild(col);
        });
      } else if (p.downCount && p.downCount > 0) {
        for (let i = 0; i < p.downCount; i++) {
          const col = document.createElement('div');
          col.className = 'stack';
          const downCard = cardImg({ back: true }, p.id === myId && s.turn === myId && (!p.up || p.up.length === 0) && i === 0);
          const downCardImg = downCard.querySelector('.card-img');
          if (downCardImg) {
            downCardImg.classList.add('down-card');
            if (p.id === myId) downCardImg.dataset.idx = i + 2000;
          }
          col.appendChild(downCard);
          if (p.id === myId && s.turn === myId && (!p.up || p.up.length === 0) && i === 0) {
            col.classList.add('playable-stack'); // mark stack as playable
          }
          stackRow.appendChild(col);
        }
      }
      renderSection(panel, 'Up / Down', stackRow);
      // Place panel in correct slot
      if (seat === 'bottom' && slotBottom) slotBottom.appendChild(panel);
      else if (seat === 'top' && slotTop) slotTop.appendChild(panel);
      else if (seat === 'left' && slotLeft) slotLeft.appendChild(panel);
      else if (seat === 'right' && slotRight) slotRight.appendChild(panel);
    });

    // Create center piles AFTER players are rendered
    createCenterPiles(s);
    // Show any pending specialEffect banner now that cards are rendered
    if (pendingSpecialEffect) {
      showCardEvent(pendingSpecialEffect.value, pendingSpecialEffect.type);
      pendingSpecialEffect = null;
    }
  }

  function showGameOverMessage(didIWin, winnerName) {
    // Create or find a container for the game over message
    let gameOverContainer = document.createElement('div');
    gameOverContainer.id = 'game-over-container';
    gameOverContainer.style.position = 'fixed';
    gameOverContainer.style.top = '0';
    gameOverContainer.style.left = '0';
    gameOverContainer.style.width = '100%';
    gameOverContainer.style.height = '100%';
    gameOverContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
    gameOverContainer.style.display = 'flex';
    gameOverContainer.style.flexDirection = 'column';
    gameOverContainer.style.justifyContent = 'center';
    gameOverContainer.style.alignItems = 'center';
    gameOverContainer.style.zIndex = '3000'; // Ensure it's on top
    gameOverContainer.style.color = 'white';
    gameOverContainer.style.textAlign = 'center';
    document.body.appendChild(gameOverContainer);

    gameOverContainer.innerHTML = `
      <div style="font-size: 4em; margin-bottom: 20px;">🏆</div>
      <h1 style="font-size: 3em; margin-bottom: 10px;">Game Over!</h1>
      <p style="font-size: 1.5em; margin-bottom: 30px;">
        ${didIWin ? '🎉 You win! 🎉' : `${winnerName} wins!`}
      </p>
      <button id="play-again-btn" class="btn btn-primary" style="font-size: 1.2em; padding: 10px 20px;">Play Again</button>
    `;

    // Add event listener for the play again button
    const playAgainBtn = document.getElementById('play-again-btn');
    if (playAgainBtn) {
      playAgainBtn.onclick = () => {
        // Reload the page to go back to the lobby
        window.location.reload();
      };
    }

    gameOverContainer.classList.remove('hidden');
  }

}); // End of DOMContentLoaded listener
