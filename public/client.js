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
    // Preload special icons
    ['Reset-icon.png','Copy-icon.png','Burn-icon.png','Invalid play-icon.png','Take pile-icon.png'].forEach(name => {
      const img = new Image();
      img.src = name;
    });
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

  // Reference the game table element for showGameTable
  const table = $('table');

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
  let specialEffectsQueue = []; // Queue to track pending specialEffects for banner display
  let processingEffects = false; // Flag to track if we're currently processing effects
  let actionHistory = []; // Track user-initiated actions for replay
  
  // Debugging system for tracking game logic inconsistencies
  const gameDebug = {
    enabled: true,
    lastHumanPlay: null,
    lastCPUPlay: null,
    specialCardPlays: [],
    turnChanges: [],
    stateUpdates: [],
    renderTimes: [],
    effectSequence: [],
    gameEvents: [], // Unified chronological event log
    eventCounter: 0, // For sequence numbering
    startTime: Date.now(),
    maxEntries: 100,
    
    // Format timestamp with millisecond precision
    formatTimestamp: function(timestamp) {
      const d = new Date(timestamp);
      return `${d.toLocaleTimeString()}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    },
    
    // Format time elapsed in ms with + prefix for readability
    formatElapsed: function(elapsed) {
      return (elapsed >= 0 ? '+' : '') + elapsed + 'ms';
    },
    
    // Log any game event with precise timing
    logEvent: function(category, action, details) {
      if (!this.enabled) return;
      
      const timestamp = Date.now();
      const elapsedFromStart = timestamp - this.startTime;
      
      // Find the most recent event for relative timing
      const lastEvent = this.gameEvents.length > 0 ? this.gameEvents[this.gameEvents.length - 1] : null;
      const elapsed = lastEvent ? timestamp - lastEvent.timestamp : 0;
      
      const event = {
        seq: ++this.eventCounter,
        category,
        action,
        details,
        timestamp,
        elapsedFromStart,
        elapsed,
        relativeToLastSameType: this.getTimeSinceLastSameType(category, timestamp)
      };
      
      this.gameEvents.push(event);
      if (this.gameEvents.length > this.maxEntries * 2) {
        this.gameEvents.shift();
      }
      
      // Log formatted output to console
      console.log(`[DEBUG:${event.seq}] [${this.formatTimestamp(timestamp)}] [${this.formatElapsed(elapsed)}] [${category}] ${action}${details ? ': ' + JSON.stringify(details) : ''}`);
      
      // Update the debug panel
      this.updateDebugPanel();
      
      return event;
    },
    
    // Get time elapsed since last event of same category
    getTimeSinceLastSameType: function(category, timestamp) {
      for (let i = this.gameEvents.length - 1; i >= 0; i--) {
        if (this.gameEvents[i].category === category && this.gameEvents[i].timestamp < timestamp) {
          return timestamp - this.gameEvents[i].timestamp;
        }
      }
      return null;
    },
    
    // Track when human player makes a play
    logHumanPlay: function(cards) {
      if (!this.enabled) return;
      
      this.lastHumanPlay = {
        timestamp: Date.now(),
        cards: Array.isArray(cards) ? [...cards] : cards,
      };
      
      this.logEvent('PLAY', 'Human played', {
        cards: Array.isArray(cards) ? 
          cards.map(c => (c.value + (c.suit ? ' ' + c.suit[0] : ''))) : 
          cards
      });
    },
    
    // Track CPU plays and calculate response time
    logCPUPlay: function(playerId, cards) {
      if (!this.enabled) return;
      
      const now = Date.now();
      this.lastCPUPlay = {
        timestamp: now,
        playerId,
        cards: Array.isArray(cards) ? [...cards] : cards,
        responseTime: this.lastHumanPlay ? (now - this.lastHumanPlay.timestamp) : null
      };
      
      // Alert if CPU plays too quickly (might indicate a logic bug)
      let alertText = null;
      if (this.lastHumanPlay && this.lastCPUPlay.responseTime < 300) {
        alertText = `Fast CPU play detected: ${this.lastCPUPlay.responseTime}ms response time`;
        console.warn(`[DEBUG] CPU played suspiciously fast: ${this.lastCPUPlay.responseTime}ms after human play`);
        this.addDebugAlert(alertText);
      }
      
      this.logEvent('PLAY', 'CPU played', {
        playerId,
        cards: Array.isArray(cards) ? 
          cards.map(c => (c.value + (c.suit ? ' ' + c.suit[0] : ''))) : 
          cards,
        responseTime: this.lastCPUPlay.responseTime,
        suspiciouslyFast: alertText !== null
      });
    },
    
    // Track special card effects with precise timing
    logSpecialEffect: function(value, type, currentTurn, nextTurn, phase = "queued") {
      if (!this.enabled) return;
      
      const timestamp = Date.now();
      const effect = {
        timestamp,
        seq: ++this.eventCounter,
        value,
        type,
        currentTurn,
        nextTurn,
        phase
      };
      
      this.specialCardPlays.push(effect);
      if (this.specialCardPlays.length > this.maxEntries) {
        this.specialCardPlays.shift();
      }
      
      // Also add to unified event log
      this.logEvent('EFFECT', `${type} effect ${phase}`, {
        value, 
        type, 
        currentTurn, 
        nextTurn
      });
    },
    
    // Track effect animation phases
    logEffectPhase: function(effectId, phase, details = {}) {
      if (!this.enabled) return;
      
      const timestamp = Date.now();
      const sequenceItem = {
        timestamp,
        effectId,
        phase,
        details
      };
      
      this.effectSequence.push(sequenceItem);
      if (this.effectSequence.length > this.maxEntries * 2) {
        this.effectSequence.shift();
      }
      
      this.logEvent('EFFECT_PHASE', `${effectId} - ${phase}`, details);
    },
    
    // Track turn changes with precise timing
    logTurnChange: function(fromPlayer, toPlayer) {
      if (!this.enabled) return;
      
      const timestamp = Date.now();
      const change = {
        timestamp,
        seq: ++this.eventCounter,
        from: fromPlayer,
        to: toPlayer
      };
      
      this.turnChanges.push(change);
      if (this.turnChanges.length > this.maxEntries) {
        this.turnChanges.shift();
      }
      
      // Calculate time since last turn change for this player
      let lastTurnTime = null;
      for (let i = this.turnChanges.length - 2; i >= 0; i--) {
        if (this.turnChanges[i].to === fromPlayer) {
          lastTurnTime = timestamp - this.turnChanges[i].timestamp;
          break;
        }
      }
      
      this.logEvent('TURN', `${fromPlayer} → ${toPlayer}`, {
        fromPlayer,
        toPlayer,
        turnDuration: lastTurnTime
      });
    },
    
    // Track state updates with timing data
    logStateUpdate: function(state, renderStart) {
      if (!this.enabled) return;
      
      const timestamp = Date.now();
      const stateUpdate = {
        timestamp,
        seq: ++this.eventCounter,
        turn: state.turn,
        playPileLength: state.playPile ? state.playPile.length : 0,
        deckCount: state.deckCount,
        playerHandCounts: state.players.map(p => ({ id: p.id, handCount: p.handCount }))
      };
      
      this.stateUpdates.push(stateUpdate);
      if (this.stateUpdates.length > this.maxEntries) {
        this.stateUpdates.shift();
      }
      
      this.logEvent('STATE', `Updated game state`, {
        turn: state.turn,
        playPileLength: state.playPile ? state.playPile.length : 0,
        lastCard: state.playPile && state.playPile.length > 0 ? 
          state.playPile[state.playPile.length - 1].value : 'none',
        isFirstState: this.stateUpdates.length === 1,
        renderStarted: renderStart ? 'yes' : 'no'
      });
      
      if (renderStart) {
        // Start tracking render time
        this.currentRenderStart = timestamp;
      }
    },
    
    // Track render completion times
    logRenderComplete: function() {
      if (!this.enabled || !this.currentRenderStart) return;
      
      const timestamp = Date.now();
      const renderTime = {
        timestamp,
        seq: ++this.eventCounter,
        renderStart: this.currentRenderStart,
        renderDuration: timestamp - this.currentRenderStart
      };
      
      this.renderTimes.push(renderTime);
      if (this.renderTimes.length > this.maxEntries) {
        this.renderTimes.shift();
      }
      
      this.logEvent('RENDER', `Render completed`, {
        duration: renderTime.renderDuration
      });
      
      this.currentRenderStart = null;
    },
    
    // Create and update visual debug panel
    createDebugPanel: function() {
      if (document.getElementById('game-debug-panel')) return;
      
      const panel = document.createElement('div');
      panel.id = 'game-debug-panel';
      panel.style.cssText = `
        position: fixed;
        bottom: 10px;
        right: 10px;
        width: 450px;
        max-height: 400px;
        background: rgba(0, 0, 0, 0.85);
        color: #33ff33;
        border: 1px solid #33ff33;
        border-radius: 5px;
        padding: 12px;
        font-family: 'Courier New', monospace;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.5px;
        line-height: 1.5;
        z-index: 10000;
        overflow-y: auto;
        transition: opacity 0.3s;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
      `;
      
      const header = document.createElement('div');
      header.style.cssText = `
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid #33ff33;
        font-size: 14px;
      `;
      
      // Create panel controls
      const controlsDiv = document.createElement('div');
      controlsDiv.style.display = 'flex';
      controlsDiv.style.gap = '8px';
      
      const titleSpan = document.createElement('span');
      titleSpan.innerHTML = '<strong>Advanced Debug Panel</strong>';
      
      const toggleBtn = document.createElement('button');
      toggleBtn.textContent = 'Hide';
      toggleBtn.style.cssText = `
        background: #111;
        color: #33ff33;
        border: 1px solid #33ff33;
        border-radius: 3px;
        padding: 2px 8px;
        cursor: pointer;
      `;
      
      const exportBtn = document.createElement('button');
      exportBtn.textContent = 'Export';
      exportBtn.style.cssText = `
        background: #111;
        color: #33ff33;
        border: 1px solid #33ff33;
        border-radius: 3px;
        padding: 2px 8px;
        cursor: pointer;
      `;
      
      toggleBtn.onclick = () => {
        const content = document.getElementById('debug-panel-content');
        if (content.style.display === 'none') {
          content.style.display = 'block';
          toggleBtn.textContent = 'Hide';
          panel.style.opacity = '1';
        } else {
          content.style.display = 'none';
          toggleBtn.textContent = 'Show';
          panel.style.opacity = '0.6';
        }
      };
      
      exportBtn.onclick = () => this.exportDebugData();
      
      controlsDiv.appendChild(toggleBtn);
      controlsDiv.appendChild(exportBtn);
      
      header.appendChild(titleSpan);
      header.appendChild(controlsDiv);
      panel.appendChild(header);
      
      const content = document.createElement('div');
      content.id = 'debug-panel-content';
      content.innerHTML = '<div>Enhanced timing debug active...</div>';
      panel.appendChild(content);
      
      const alerts = document.createElement('div');
      alerts.id = 'debug-alerts';
      alerts.style.cssText = `
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px dashed #ff5555;
        color: #ff5555;
      `;
      content.appendChild(alerts);
      
      document.body.appendChild(panel);
    },
    
    updateDebugPanel: function() {
      this.createDebugPanel();
      const content = document.getElementById('debug-panel-content');
      if (!content) return;
      
      let html = '<div style="margin-bottom: 12px;"><strong>Timing Analysis:</strong></div>';
      
      // Show event timeline (most recent first)
      html += '<div style="margin-bottom: 10px;"><strong>Recent Events (Newest First):</strong></div>';
      html += '<table style="width:100%; font-size:12px; border-collapse:collapse;">';
      html += '<tr style="text-align:left; border-bottom:1px solid #33ff33;">';
      html += '<th>#</th><th>Time</th><th>Δ</th><th>Type</th><th>Detail</th>';
      html += '</tr>';
      
      // Show most recent 10 events
      this.gameEvents.slice(-10).reverse().forEach(event => {
        // Set color based on category
        let rowColor = '';
        if (event.category === 'TURN') rowColor = 'color:#ffd700;'; // Gold
        else if (event.category === 'PLAY') rowColor = 'color:#00ffff;'; // Cyan
        else if (event.category.includes('EFFECT')) rowColor = 'color:#ff00ff;'; // Magenta
        else if (event.category === 'STATE') rowColor = 'color:#7fff00;'; // Chartreuse
        else if (event.category === 'RENDER') rowColor = 'color:#ff7f50;'; // Coral
        
        html += `<tr style="${rowColor}">`;
        html += `<td>${event.seq}</td>`;
        html += `<td>${this.formatTimestamp(event.timestamp)}</td>`;
        html += `<td>${this.formatElapsed(event.elapsed)}</td>`;
        html += `<td>${event.category}</td>`;
        html += `<td>${event.action}</td>`;
        html += `</tr>`;
      });
      html += '</table>';
      
      // Timing specific concerns
      if (this.turnChanges.length > 0) {
        const lastTurnChange = this.turnChanges[this.turnChanges.length - 1];
        html += `<div style="margin-top:12px;"><strong>Last turn change:</strong> ${lastTurnChange.from} → ${lastTurnChange.to} (${this.formatTimestamp(lastTurnChange.timestamp)})</div>`;
      }
      
      if (this.renderTimes.length > 0) {
        const lastRender = this.renderTimes[this.renderTimes.length - 1];
        html += `<div><strong>Last render time:</strong> ${lastRender.renderDuration}ms</div>`;
      }
      
      // Show alerts section
      const alerts = document.getElementById('debug-alerts');
      if (alerts) {
        // Keep existing alerts
        const existingAlerts = alerts.innerHTML;
        content.innerHTML = html;
        alerts.innerHTML = existingAlerts;
        content.appendChild(alerts);
      } else {
        content.innerHTML = html;
      }
    },
    
    addDebugAlert: function(message) {
      const alerts = document.getElementById('debug-alerts');
      if (!alerts) return;
      
      const alert = document.createElement('div');
      alert.textContent = `⚠️ ${message}`;
      alert.style.color = '#ff5555';
      alert.style.marginBottom = '5px';
      alert.style.fontWeight = 'bold';
      
      // Add to unified event log
      this.logEvent('ALERT', message);
      
      // Add alert with animation
      alerts.appendChild(alert);
      
      // Remove after 15 seconds
      setTimeout(() => {
        if (alert.parentNode === alerts) {
          alert.style.opacity = '0';
          alert.style.transition = 'opacity 1s';
          setTimeout(() => {
            if (alert.parentNode === alerts) {
              alerts.removeChild(alert);
            }
          }, 1000);
        }
      }, 15000);
    },
    
    // Export debug data in a copy-pastable format
    exportDebugData: function() {
      // Create CSV for timeline events
      let csv = "Seq,Timestamp,Elapsed,Category,Action,Details\n";
      this.gameEvents.forEach(event => {
        const timestamp = this.formatTimestamp(event.timestamp);
        const elapsed = this.formatElapsed(event.elapsed);
        const details = JSON.stringify(event.details || {}).replace(/"/g, '""'); // Escape quotes for CSV
        csv += `${event.seq},"${timestamp}","${elapsed}","${event.category}","${event.action}","${details}"\n`;
      });
      
      // Create a downloadable file
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      // Create a temporary link and trigger download
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `top-that-debug-${Date.now()}.csv`);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Create a JSON export for clipboard
      const jsonExport = {
        timestamp: Date.now(),
        events: this.gameEvents,
        turnChanges: this.turnChanges,
        specialEffects: this.specialCardPlays,
        renderTimes: this.renderTimes
      };
      
      // Copy JSON to clipboard
      const jsonText = JSON.stringify(jsonExport, null, 2);
      navigator.clipboard.writeText(jsonText).then(() => {
        this.addDebugAlert("Debug data copied to clipboard and CSV file downloaded");
      }).catch(err => {
        this.addDebugAlert("Error copying to clipboard. CSV file downloaded.");
        console.error("Error copying debug data: ", err);
      });
      
      return jsonExport;
    },
    
    // Get diagnostics data as an object
    getDiagnostics: function() {
      return {
        timestamp: Date.now(),
        events: this.gameEvents.slice(-30),
        turnChanges: this.turnChanges.slice(-10),
        specialEffects: this.specialCardPlays.slice(-10),
        renderTimes: this.renderTimes.slice(-10),
        summary: {
          totalEvents: this.gameEvents.length,
          lastEventTime: this.gameEvents.length > 0 ? 
            this.gameEvents[this.gameEvents.length-1].timestamp : null,
          averageRenderTime: this.calculateAverageRenderTime(),
          maxRenderTime: this.calculateMaxRenderTime()
        }
      };
    },
    
    // Calculate average render time
    calculateAverageRenderTime: function() {
      if (this.renderTimes.length === 0) return null;
      const sum = this.renderTimes.reduce((sum, item) => sum + item.renderDuration, 0);
      return Math.round(sum / this.renderTimes.length);
    },
    
    // Calculate maximum render time
    calculateMaxRenderTime: function() {
      if (this.renderTimes.length === 0) return null;
      return Math.max(...this.renderTimes.map(item => item.renderDuration));
    },
    
    // Show diagnostic report (can be triggered from console)
    showDiagnostics: function() {
      const data = this.getDiagnostics();
      
      console.group('Game Diagnostics Report');
      console.log(`Total events: ${data.events.length}`);
      console.log(`Last event: ${data.events.length > 0 ? this.formatTimestamp(data.events[data.events.length-1].timestamp) : 'none'}`);
      console.log(`Average render time: ${data.summary.averageRenderTime}ms`);
      console.log(`Max render time: ${data.summary.maxRenderTime}ms`);
      
      console.log('Recent events (newest first):');
      data.events.slice().reverse().forEach(event => {
        console.log(`[${this.formatTimestamp(event.timestamp)}] [${this.formatElapsed(event.elapsed)}] [${event.category}] ${event.action}`);
      });
      
      console.log('Recent turn changes:');
      data.turnChanges.slice(-5).forEach(change => {
        console.log(`[${this.formatTimestamp(change.timestamp)}] ${change.from} → ${change.to}`);
      });
      
      console.log('Recent special effects:');
      data.specialEffects.slice(-5).forEach(effect => {
        console.log(`[${this.formatTimestamp(effect.timestamp)}] ${effect.type} (value: ${effect.value})`);
      });
      console.groupEnd();
      
      this.createDebugPanel();
      this.updateDebugPanel();
      
      // Print instructions
      console.log('Use gameDebug.exportDebugData() to download timing data or copy to clipboard');
      
      return data;
    },
    
    // Toggle debug panel visibility
    togglePanel: function() {
      const panel = document.getElementById('game-debug-panel');
      if (panel) {
        if (panel.style.display === 'none') {
          panel.style.display = 'block';
        } else {
          panel.style.display = 'none';
        }
      } else {
        this.createDebugPanel();
      }
    },

    // Add tracking for take pile events to gameDebug object
    logTakePileEvent: function(playerId, isForced = false) {
      if (!this.enabled) return;
      
      const timestamp = Date.now();
      const event = {
        timestamp,
        seq: ++this.eventCounter,
        playerId,
        isForced
      };
      
      this.logEvent('PILE_TAKE', isForced ? 'Forced take pile' : 'Voluntary take pile', {
        playerId,
        isForced
      });
    }
  };
  
  // Make debugging accessible from console and add keyboard shortcut
  window.gameDebug = gameDebug;
  
  // Add keyboard shortcut (Ctrl+Shift+D) to toggle debug panel
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      gameDebug.togglePanel();
    }
  });

  // Read room parameter from URL
  const urlParams = new URLSearchParams(window.location.search);
  const initialRoom = urlParams.get('room') || null;

  // If joining an existing room, hide setup inputs
  if (initialRoom) {
    const setup = $('setup-fields');
    if (setup) setup.classList.add('hidden');
    const totalField = $('total-players');
    if (totalField) totalField.disabled = true;
    const cpuField = $('computer-count');
    if (cpuField) cpuField.disabled = true;
    const btn = $('create-join');
    if (btn) btn.textContent = 'Join Game';
  }

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
      nameIn.value = '';
      nameIn.placeholder = 'Enter your name';
      nameIn.readOnly = false;
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

    const startBtn = $('start-game-button');
    if (startBtn) {
      // Show start button once at least 2 players are in the room
      if (playersLength >= 2) {
        startBtn.classList.remove('hidden');
        startBtn.disabled = false;
      } else {
        startBtn.classList.add('hidden');
        startBtn.disabled = true;
      }
    }
  }

  function showGameTable() {
    console.log('[Debug] showGameTable called');
    if (lobbyContainer) lobbyContainer.classList.add('hidden');
    if (table) table.classList.remove('hidden'); // Ensure table is visible
    hideOverlay(); // Hide overlay when game starts
    closeModal(); // Ensure any open modals are closed
    // Reveal rewind/forward controls
    const rewindBtn = $('rewind-btn');
    if (rewindBtn) rewindBtn.classList.remove('hidden');
    const forwardBtn = $('forward-btn');
    if (forwardBtn) forwardBtn.classList.remove('hidden');
    // Reveal game log panel
    const gameLog = $('game-log');
    if (gameLog) gameLog.classList.remove('hidden');
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
  // Listener for back-to-lobby button
  const backToLobbyButton = $('back-to-lobby-button');
  if (backToLobbyButton) {
    backToLobbyButton.addEventListener('click', () => {
      // Reset user/session state
      myId = null;
      currentRoom = null;
      sessionStorage.removeItem('myId');
      sessionStorage.removeItem('currentRoom');
      // Remove room param from URL
      const url = new URL(window.location);
      url.searchParams.delete('room');
      window.history.pushState({}, '', url);
      // Hide game table and any game-over overlay
      const tableEl = document.getElementById('table');
      if (tableEl) tableEl.classList.add('hidden');
      const gameOver = document.getElementById('game-over-container');
      if (gameOver) gameOver.remove();
      // Show the lobby form
      showLobbyForm();
    });
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
    nameIn.value = '';
    nameIn.placeholder = 'Enter your name';
    nameIn.disabled = false;
    nameIn.readOnly = false;
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

  // Auto-reload page when server signals public file change
  socket.on('reload', () => {
    console.log('🔄 Reloading page due to asset change');
    window.location.reload();
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
  // Hide rewind/fwd until game starts
  const rewindBtn = $('rewind-btn');
  const forwardBtn = $('forward-btn');
  let stateHistory = [];
  let stateIndex = -1;

  socket.on('state', s => {
    console.log('[Debug] Received state event:', s);

    // Track turn changes for debugging
    const prevState = stateHistory.length > 0 ? stateHistory[stateHistory.length - 1] : null;
    if (prevState && prevState.turn !== s.turn) {
      gameDebug.logTurnChange(prevState.turn, s.turn);
    }

    if (s.started && !prevStarted) showGameTable();
    prevStarted = s.started;

    if (s.started) {
      // Check if this is the first state update or if we need to delay the CPU's first move
      const isFirstState = stateHistory.length === 0;
      const isFirstMove = isFirstState && s.playPile && s.playPile.length === 1;
      
      // Track history and render state with possible delay
      if (isFirstMove && s.turn && s.turn !== myId && s.players.find(p => p.id === s.turn)?.isComputer) {
        // This is the CPU's first move after human played first card - add a delay
        console.log("[Debug] First CPU move detected - adding artificial delay");
        // Render the state without the CPU's turn first, so player sees their own card
        const initialState = JSON.parse(JSON.stringify(s));
        initialState.turn = myId; // Force turn to stay with human player temporarily
        stateHistory.push(initialState);
        stateIndex = stateHistory.length - 1;
        renderGameState(initialState);
        
        // After a delay, update with the real state (CPU's turn)
        setTimeout(() => {
          stateHistory.pop(); // Remove the temporary state
          stateHistory.push(JSON.parse(JSON.stringify(s))); // Add the real state
          stateIndex = stateHistory.length - 1;
          renderGameState(s);
          
          // Enable rewind/forward buttons
          if (rewindBtn) rewindBtn.disabled = stateIndex <= 0;
          if (forwardBtn) forwardBtn.disabled = stateIndex >= stateHistory.length - 1;
        }, 1500); // 1.5 second delay before showing CPU play
      } else {
        // Normal state update
        stateHistory.push(JSON.parse(JSON.stringify(s)));
        stateIndex = stateHistory.length - 1;
        renderGameState(s);
        // Enable rewind/forward buttons
        if (rewindBtn) rewindBtn.disabled = stateIndex <= 0;
        if (forwardBtn) forwardBtn.disabled = stateIndex >= stateHistory.length - 1;
      }
      
      // Process any queued special effects on the first state
      if (stateHistory.length === 1 && specialEffectsQueue.length > 0) {
        console.log("[Debug] First state detected with queued effects. Processing in 800ms...");
        setTimeout(() => processNextEffect(), 800);
      }
    }
    // Do not override waiting state here; lobby event controls showing the waiting UI
  });

  socket.on('gameOver', ({ winnerId, winnerName }) => {
    console.log(`[Debug] Game Over! Winner: ${winnerName} (${winnerId})`);
    showGameOverMessage(winnerId === myId, winnerName);
  });

  // Handle general notices/errors from the server
  socket.on('err', msg => {
    console.error(`❌ Server Error: ${msg}`);
    
    // Check if this is an invalid play type of error that should show an icon
    const isInvalidPlay = msg.toLowerCase().includes('invalid play') || 
                          msg.toLowerCase().includes('must be higher') || 
                          msg.toLowerCase().includes('cannot play');
    
    // For invalid play errors, use the special card animation sequence
    if (isInvalidPlay) {
      // Disable play buttons during effect
      setPileTransition(true);
      
      // Get the discard pile card to animate on
      const discardImg = document.querySelector('.discard .card-img');
      if (discardImg) {
        // Add pulse animation to the card
        discardImg.classList.add('special-card-pulse');
        
        // After brief delay, show the icon
        setTimeout(() => {
          // Remove pulse effect
          discardImg.classList.remove('special-card-pulse');
          
          // Show the invalid play icon with full animation
          showCardEvent(null, 'invalid');
          
          // Deselect cards immediately for better feedback
          const selectedCards = document.querySelectorAll('.card-img.selected');
          selectedCards.forEach(img => {
            img.classList.remove('selected');
            const container = img.closest('.card-container');
            if (container) container.classList.remove('selected-container');
          });
          
          // Re-enable buttons after animation completes
          setTimeout(() => {
            setPileTransition(false);
          }, 1200);
        }, 800);
      } else {
        // Fallback if no discard pile is found
        showCardEvent(null, 'invalid');
        
        // Always deselect cards on invalid plays
        const selectedCards = document.querySelectorAll('.card-img.selected');
        selectedCards.forEach(img => {
          img.classList.remove('selected');
          const container = img.closest('.card-container');
          if (container) container.classList.remove('selected-container');
        });
        
        setPileTransition(false);
      }
      
      // Track this error in the debug system
      gameDebug.logEvent('ERROR', 'Invalid play', { message: msg });
    } else {
      // For other errors, just show the message
      gameDebug.logEvent('ERROR', 'Server error', { message: msg });
    }
    
    // Show toast notification for all errors
    showError(msg);

    // Handle "Game room no longer exists" error during rejoin
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

  // Process special card effects with a standardized sequence
  socket.on('specialEffect', ({ value, type }) => {
    console.log(`[Debug] Special effect received: value=${value}, type=${type}`);
    
    // Standardize the type name to avoid inconsistencies
    // This ensures we always use the same effect type regardless of how the server sends it
    let standardizedType = type;
    
    // Map specific card values to their effect types
    if (!type && value) {
      if (value == 2) standardizedType = 'two';
      else if (value == 5) standardizedType = 'five';
      else if (value == 10) standardizedType = 'ten';
      else if (value == 4 && Array.isArray(value)) standardizedType = 'four'; // four of a kind
    }
    
    // Log both original and standardized values for debugging
    gameDebug.logSpecialEffect(value, standardizedType, null, null);
    
    // Queue the effect with standardized type
    specialEffectsQueue.push({ value, type: standardizedType });
    
    // If we're not already processing effects and the game has started, process the queue
    if (!processingEffects && stateHistory.length > 0) {
      processNextEffect();
    }
    // Note: If game hasn't started yet, the effect will be processed after the first render
  });

  // Process the next effect in the queue
  function processNextEffect() {
    if (specialEffectsQueue.length === 0) {
      processingEffects = false;
      return;
    }
    
    processingEffects = true;
    const effect = specialEffectsQueue.shift();
    console.log(`[Debug] Processing effect: ${effect.type}`);
    
    // Only block play/take for actual special cards, not for 'take' effect
    if (effect.type === 'invalid') {
      setPileTransition(true);
    }
    
    // Handle immediate-display effects (invalid play, take pile)
    if (effect.type === 'invalid' || effect.type === 'take') {
      showCardEvent(effect.value, effect.type);
      
      // Longer delay for these effects to ensure they're visible
      setTimeout(() => {
        if (effect.type === 'invalid') setPileTransition(false);
        gameDebug.logEffectPhase(effect.type, "completed", { value: effect.value });
        
        // Continue with next effect after a sufficient delay
        // Add a small buffer to ensure animations don't overlap
        setTimeout(processNextEffect, 800);
      }, 1500);
      return;
    }
    
    // Special card effect sequence
    const discardImg = document.querySelector('.discard .card-img');
    if (!discardImg) {
      console.error("[Debug] No discard image found for special effect");
      setPileTransition(false);
      gameDebug.logEffectPhase(effect.type, "failed", { reason: "No discard image found" });
      
      // Try again after a short delay if we're at game start
      if (stateHistory.length <= 1) {
        console.log("[Debug] Retrying effect after delay - likely initial Ten");
        setTimeout(() => {
          specialEffectsQueue.unshift(effect); // Put back at the front of the queue
          processNextEffect();
        }, 1000);
      } else {
        setTimeout(processNextEffect, 500);
      }
      return;
    }
    
    // Flag this card as a special card that's currently being shown
    discardImg.classList.add('current-special-card');
    
    // Step 1: Highlight the special card that was played (already on discard pile)
    // Add a subtle pulse animation to draw attention to the special card
    discardImg.classList.add('special-card-pulse');
    gameDebug.logEffectPhase(effect.type, "pulse-start");
    
    // Step 2: After showing the special card briefly, show the icon
    setTimeout(() => {
      // Hide the pulse effect but keep showing the card
      discardImg.classList.remove('special-card-pulse');
      
      // Show the special effect icon
      showCardEvent(effect.value, effect.type);
      gameDebug.logEffectPhase(effect.type, "icon-shown");
      
      // Log for debugging
      console.log(`[Debug] Special card effect shown: ${effect.type}`);
      
      // Step 3: After showing the icon, apply the card change if needed
      setTimeout(() => {
        // For card 5 (copy), add a small "copied" indicator
        if (effect.type === 'five' || effect.value == 5) {
          const copyIndicator = document.createElement('div');
          copyIndicator.className = 'copy-indicator';
          copyIndicator.textContent = 'Copied';
          copyIndicator.style.position = 'absolute';
          copyIndicator.style.bottom = '5px';
          copyIndicator.style.right = '5px';
          copyIndicator.style.background = 'rgba(0, 0, 0, 0.7)';
          copyIndicator.style.color = 'white';
          copyIndicator.style.padding = '2px 5px';
          copyIndicator.style.borderRadius = '3px';
          copyIndicator.style.fontSize = '10px';
          copyIndicator.style.fontWeight = 'bold';
          copyIndicator.style.zIndex = '150';
          copyIndicator.style.opacity = '0';
          copyIndicator.style.transition = 'opacity 0.5s';
          
          // Add to card parent
          const cardParent = discardImg.parentElement;
          if (cardParent) {
            cardParent.style.position = 'relative';
            cardParent.appendChild(copyIndicator);
            
            // Fade in
            setTimeout(() => {
              copyIndicator.style.opacity = '1';
              gameDebug.logEffectPhase(effect.type, "copy-indicator-shown");
              
              // Remove after a while
              setTimeout(() => {
                copyIndicator.style.opacity = '0';
                setTimeout(() => {
                  if (copyIndicator.parentNode === cardParent) {
                    copyIndicator.remove();
                  }
                }, 500);
              }, 2000);
            }, 100);
          }
        }
        
        // Step 4: Complete the effect sequence
        setTimeout(() => {
          // Remove special card flag
          discardImg.classList.remove('current-special-card');
          
          // Re-enable play buttons
          setPileTransition(false);
          console.log(`[Debug] Special card effect complete: ${effect.type}`);
          gameDebug.logEffectPhase(effect.type, "completed");
          
          // Wait longer between effects to ensure each is fully visible
          // Use a guaranteed minimum delay to prevent animations overlapping
          setTimeout(processNextEffect, 1000);
        }, 2000); // Final wait before allowing play - increased to ensure card remains visible
      }, 2000); // Wait after showing icon before finishing effect - increased to ensure card remains visible
    }, 1000); // Wait before showing icon - increased from 800ms
  }

  socket.on('log', ({ player, action, cards }) => {
    const logContainer = document.getElementById('log-container');
    if (!logContainer) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `${player} ${action} ${cards.map(c => `${c.value} of ${c.suit}`).join(', ')}`;
    entry.addEventListener('click', () => {
      const act = actionHistory[entry.dataset.logIndex || actionHistory.length - 1];
      if (act) {
        if (act.type === 'play') socket.emit('playCards', act.indexes);
        else if (act.type === 'take') socket.emit('takePile');
      }
    });
    entry.dataset.logIndex = actionHistory.length - 1;
    logContainer.appendChild(entry);
  });

  /* ---------- Event Listeners ---------- */
  // Unified Create / Join game
  const playSelected = playSelectedCards;
  function playAndRecord() {
    const selectedCards = document.querySelectorAll('.card-img.selected');
    if (selectedCards.length === 0) return;
    const indexes = Array.from(selectedCards).map(img => parseInt(img.dataset.idx));
    
    // Get card information for debugging
    const currentState = stateHistory[stateIndex];
    if (currentState) {
      const cardInfos = [];
      indexes.forEach(idx => {
        if (idx < 1000) {
          // Hand card
          const card = currentState.players.find(p => p.id === myId)?.hand[idx];
          if (card) cardInfos.push(card);
        } else if (idx < 2000) {
          // Up card
          const upIdx = idx - 1000;
          const card = currentState.players.find(p => p.id === myId)?.up[upIdx];
          if (card) cardInfos.push(card); 
        } else {
          // Down card - can't know value
          cardInfos.push({ value: 'unknown', suit: 'unknown' });
        }
      });
      
      // Log the human play
      gameDebug.logHumanPlay(cardInfos);
    }
    
    actionHistory.push({ type: 'play', indexes });
    socket.emit('playCards', indexes);
  }
  window.playSelectedCards = playAndRecord;

  const createJoinBtn = $('create-join');
  if (createJoinBtn) {
    createJoinBtn.onclick = () => {
      const name = validateName();
      if (!name) return;
      const totalPlayers = parseInt($('total-players').value, 10) || 2;
      const cpuCount = parseInt($('computer-count').value, 10) || 0;
      console.log(`Creating/joining game as ${name} with ${totalPlayers} total, ${cpuCount} CPUs`);
      socket.emit('join', name, totalPlayers, cpuCount, initialRoom);
      createJoinBtn.disabled = true;
    };
  }

  if (tutorialBtn) {
    tutorialBtn.onclick = () => {
      if (lobbyContainer) lobbyContainer.classList.add('hidden');
      injectTutorialGameState();
      startTutorial();
    };
  }

  // Manual start game button
  const startGameBtn = $('start-game-button');
  if (startGameBtn) {
    startGameBtn.addEventListener('click', () => {
      socket.emit('startGame');
      startGameBtn.disabled = true; // prevent double sends
    });
  }

  const takeBtn = $('take');
  if (takeBtn) {
    takeBtn.onclick = () => {
      actionHistory.push({ type: 'take' });
      clearError();
      
      // Just take the pile directly without showing the special effect
      // This is a voluntary take, not a forced take due to no valid moves
      gameDebug.logTakePileEvent(myId, false);
      socket.emit('takePile');
    };
  }

  // Rewind/forward controls
  if (rewindBtn) {
    rewindBtn.addEventListener('click', () => {
      if (stateIndex > 0) {
        stateIndex--;
        renderGameState(stateHistory[stateIndex]);
        forwardBtn.disabled = false;
        rewindBtn.disabled = stateIndex <= 0;
      }
    });
  }
  if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
      if (stateIndex < stateHistory.length - 1) {
        stateIndex++;
        renderGameState(stateHistory[stateIndex]);
        rewindBtn.disabled = false;
        forwardBtn.disabled = stateIndex >= stateHistory.length - 1;
      }
    });
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
      highlight: null,
      restrict: null,
      expect: null // up card, will allow in next step
    },
    {
      message: 'Try to play a 5. It copies the previous card\'s value!',
      highlight: null,
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

  // Overlay special card symbol on top of discard pile card with improved animation
  function showCardEvent(cardValue, type) {
    let discardImg = document.querySelector('.discard .card-img');
    // If the discard pile is empty, retry after a short delay (up to 5 times)
    let retries = 0;
    function tryRunEffect() {
      discardImg = document.querySelector('.discard .card-img');
      if (!discardImg && retries < 5) {
        retries++;
        setTimeout(tryRunEffect, 100);
        return;
      }
      if (!discardImg) return; // Give up if still not found
      function runEffect() {
        // Remove any existing icon
        const prev = discardImg.parentElement.querySelector('.special-icon');
        if (prev) prev.remove();
        
        // Create an image for the special effect
        const icon = document.createElement('img');
        icon.className = 'special-icon';
        
        // Choose image based on effect using loose equality for consistent checks
        let src = '';
        if (type === 'two' || cardValue == 2) src = 'Reset-icon.png';
        else if (type === 'five' || cardValue == 5) src = 'Copy-icon.png';
        else if (type === 'ten' || cardValue == 10 || type === 'four') src = 'Burn-icon.png';
        else if (type === 'invalid') src = 'Invalid play-icon.png';
        else if (type === 'take') src = 'Take pile-icon.png';
        else if (type === 'regular') {
          // No outline or glow, just return
          return;
        }
        
        // Debug check for icon path
        console.log(`[DEBUG] Using icon: ${src}`);
        
        icon.src = src;
        icon.onerror = () => {
          console.error(`[ERROR] Failed to load icon: ${src}`);
          // Fallback for missing image
          icon.style.background = 'rgba(255,255,255,0.7)';
          icon.style.borderRadius = '50%';
          icon.style.display = 'flex';
          icon.style.justifyContent = 'center';
          icon.style.alignItems = 'center';
          
          // Add text as fallback
          const fallbackText = document.createElement('div');
          fallbackText.textContent = type === 'take' ? 'TAKE' : 
                                    type === 'two' ? 'RESET' :
                                    type === 'five' ? 'COPY' :
                                    type === 'ten' ? 'BURN' : 'X';
          fallbackText.style.color = '#000';
          fallbackText.style.fontWeight = 'bold';
          icon.appendChild(fallbackText);
        };
        
        // Position and size with improved styling
        icon.style.position = 'absolute';
        icon.style.top = '50%';
        icon.style.left = '50%';
        icon.style.transform = 'translate(-50%, -50%)';
        icon.style.width = '90px'; // Slightly bigger for better visibility
        icon.style.height = '90px';
        icon.style.zIndex = '100'; // Ensure icon is above the card but below other UI elements
        icon.style.background = 'none';
        icon.style.backgroundColor = 'transparent';
        icon.style.pointerEvents = 'none';
        icon.style.filter = 'drop-shadow(0 0 12px rgba(255, 255, 255, 0.9))'; // Enhanced glow
        
        // Use CSS animation for smoother performance
        icon.style.animation = 'iconPulse 1.5s ease-in-out'; // Longer animation
        
        // Ensure parent is positioned for absolute positioning to work
        discardImg.parentElement.style.position = 'relative';
        discardImg.parentElement.appendChild(icon);
        
        // Highlight discard pile
        const discardPile = discardImg.closest('.discard');
        if (discardPile) {
          discardPile.classList.add('ring-pulse');
          setTimeout(() => discardPile.classList.remove('ring-pulse'), 1000); // Longer pulse effect
        }
        
        // Remove after delay with fade out for smoother transition
        setTimeout(() => {
          icon.style.transition = 'opacity 0.5s ease, transform 0.5s ease'; // Slower fade
          icon.style.opacity = '0';
          icon.style.transform = 'translate(-50%, -50%) scale(0.8)';
          setTimeout(() => icon.remove(), 500); // Wait longer before removing
        }, 1800); // Show for 1.8 seconds, increased from 1 second
      }
      
      if (!discardImg.complete) {
        discardImg.addEventListener('load', runEffect, { once: true });
      } else {
        runEffect();
      }
    }
    tryRunEffect();
  }

  function showIcon(iconSrc) {
    const center = document.getElementById('center');
    if (!center) return;
    const img = document.createElement('img');
    img.src = iconSrc;
    img.className = 'special-icon';
    img.style.width = '100px';
    img.style.height = '100px';
    img.style.position = 'absolute';
    img.style.top = '50%';
    img.style.left = '50%';
    img.style.transform = 'translateX(-50%)';
    img.style.pointerEvents = 'none';
    center.appendChild(img);
    setTimeout(() => img.remove(), 2000);
  }

  function showError(msg) {
    console.log('[Debug] showError:', msg);
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    // Auto-remove after 2s (uniform)
    setTimeout(() => toast.remove(), 2000);
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
    container.classList.add('card-container');
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
      img.classList.add('selectable');
      img.style.cursor = 'pointer';
      img.style.touchAction = 'manipulation'; // Improves touch responsiveness
      
      // Track click/touch timing for better interaction handling
      let lastInteractionTime = 0;
      const DOUBLE_INTERACTION_THRESHOLD = 300; // ms
      
      // Combined function for both click and touch
      const handleInteraction = (e) => {
        const now = Date.now();
        const timeSinceLastInteraction = now - lastInteractionTime;
        
        // Handle double-click/tap
        if (timeSinceLastInteraction < DOUBLE_INTERACTION_THRESHOLD) {
          // Double interaction - select and play the card
          if (!img.classList.contains('selected')) {
            img.classList.add('selected');
            container.classList.add('selected-container');
          }
          
          // Prevent event propagation
          e.stopPropagation();
          e.preventDefault();
          
          // Visual feedback
          snapCard(img);
          
          // Play immediately
          playSelectedCards();
          
          // Reset tracking
          lastInteractionTime = 0;
        } else {
          // Single interaction - toggle selection
          const isSelected = img.classList.toggle('selected');
          container.classList.toggle('selected-container', isSelected);
          lastInteractionTime = now;
        }
      };
      
      // Mouse events
      img.addEventListener('click', handleInteraction);
      
      // Touch events for mobile
      img.addEventListener('touchstart', (e) => {
        // Prevent scrolling when interacting with cards
        if (e.cancelable) e.preventDefault();
      }, { passive: false });
      
      img.addEventListener('touchend', (e) => {
        // Only process if this is a tap (not a scroll or multi-touch)
        if (e.changedTouches && e.changedTouches.length === 1) {
          handleInteraction(e);
        }
      });
    }
    
    container.appendChild(img);
    return container;
  }

  function renderSection(panel, title, content) {
    const section = document.createElement('div');
    section.className = 'game-section';
    const titleDiv = document.createElement('div');
    titleDiv.className = 'section-title';
    titleDiv.textContent = title;
    section.appendChild(titleDiv);
    section.appendChild(content);
    panel.appendChild(section);
    return section;
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
    }, 2000);
  }

  function playSelectedCards() {
    if (pileTransition) return;

    const selectedCards = document.querySelectorAll('.card-img.selected');
    if (selectedCards.length === 0) return;

    const indexes = Array.from(selectedCards).map(img => parseInt(img.dataset.idx));
    console.log('Debug playSelectedCards:', { indexes, isHandPlay: indexes.every(idx => idx < 1000), isUpPlay: indexes.every(idx => idx >= 1000 && idx < 2000), isDownPlay: indexes.every(idx => idx >= 2000) });

    const isHandPlay = indexes.every(idx => idx < 1000);
    const isUpPlay = indexes.every(idx => idx >= 1000 && idx < 2000);
    const isDownPlay = indexes.every(idx => idx >= 2000);

    if (!(isHandPlay || isUpPlay || isDownPlay)) {
      showError("You can only play cards from one area (Hand, Up, or Down) at a time.");
      selectedCards.forEach(img => {
        img.classList.remove('selected');
        const cont = img.closest('.card-container');
        if (cont) cont.classList.remove('selected-container');
      });
      return;
    }
    
    socket.emit('playCards', indexes);
  }
  
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
    deckLabel.textContent = `Deck (${state.deckCount})`;
    deckLabel.className = 'pile-label';
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
      if (p.id === myId && p.hand && p.hand.length > 0) {
        // Render hand cards and tag each img with its index for play detection
        for (let i = 0; i < p.hand.length; i++) {
          const card = p.hand[i];
          const canInteract = s.turn === myId;
          const container = cardImg(card, canInteract);
          const imgEl = container.querySelector('.card-img');
          if (imgEl) imgEl.dataset.idx = i;
          handRow.appendChild(container);
        }
      } else if (p.handCount > 0) {
        // Show placeholder backs for opponents (human or CPU)
        // Limit CPU display to a maximum of 3 cards even if they have more
        const displayCount = Math.min(p.handCount, 3);
        for (let i = 0; i < displayCount; i++) {
          const el = document.createElement('div');
          el.className = 'card-placeholder';
          const cardEl = cardImg({ back: true }, false);
          el.appendChild(cardEl);
          handRow.appendChild(el);
        }
      }
      
      // Show the actual card count in the section label for opponents
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
          gameDebug.logTakePileEvent(myId, false);
          socket.emit('takePile');
        };
        takeBtnDyn.className = 'btn btn-secondary';
        btnContainer.appendChild(playBtnDyn);
        btnContainer.appendChild(takeBtnDyn);
        // Enable/disable based on turn
        playBtnDyn.disabled = !s.turn || s.turn !== myId || pileTransition;
        // Take button is only disabled if it's not your turn
        takeBtnDyn.disabled = !s.turn || s.turn !== myId ? true : false;
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
          const upCard = cardImg(c, p.id === myId && s.turn === myId && p.hand.length === 0 && !pileTransition);
          const upCardImg = upCard.querySelector('.card-img');
          if (upCardImg) {
            upCardImg.classList.add('up-card');
            if (p.id === myId) upCardImg.dataset.idx = i + 1000;
          }
          col.append(downCard, upCard);
          if (p.id === myId && s.turn === myId && p.hand.length === 0 && !pileTransition) {
            col.classList.add('playable-stack'); // mark stack as playable
          }
          stackRow.appendChild(col);
        });
      } else if (p.downCount && p.downCount > 0) {
        for (let i = 0; i < p.downCount; i++) {
          const col = document.createElement('div');
          col.className = 'stack';
          const downCard = cardImg({ back: true }, p.id === myId && s.turn === myId && (!p.up || p.up.length === 0) && i === 0 && !pileTransition);
          const downCardImg = downCard.querySelector('.card-img');
          if (downCardImg) {
            downCardImg.classList.add('down-card');
            if (p.id === myId) downCardImg.dataset.idx = i + 2000;
          }
          col.appendChild(downCard);
          if (p.id === myId && s.turn === myId && (!p.up || p.up.length === 0) && i === 0 && !pileTransition) {
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
    
    // Process any queued special effects after rendering
    setTimeout(() => processSpecialEffectsQueue(), 200);
  }

  // Process any queued special effects
  function processSpecialEffectsQueue() {
    if (specialEffectsQueue.length > 0 && !processingEffects) {
      processNextEffect();
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
      <img src="/generated-icon.png" alt="Top That Crown" style="width:100px;height:100px;margin-bottom:20px;" />
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
