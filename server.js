import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { Game } from './game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add a simple computer player implementation
class ComputerPlayer {
  constructor(name) {
    this.name = name;
    this.hand = [];
    this.up = [];
    this.down = [];
  }

  // Simulate the computer's turn
  takeTurn(gameState) {
    const playableCards = this.getPlayableCards(gameState);

    if (playableCards.length > 0) {
      // Play the first playable card
      const cardToPlay = playableCards[0];
      this.playCard(cardToPlay, gameState);
    } else {
      // Take the pile if no playable cards
      this.takePile(gameState);
    }
  }

  getPlayableCards(gameState) {
    // Determine which cards in the hand are playable based on the game rules
    return this.hand.filter(card => this.isCardPlayable(card, gameState));
  }

  isCardPlayable(card, gameState) {
    // Implement the game rules to check if a card is playable
    const topCard = gameState.playPile.at(-1);
    return !topCard || card.value >= topCard.value;
  }

  playCard(card, gameState) {
    // Remove the card from the hand and add it to the play pile
    const cardIndex = this.hand.indexOf(card);
    if (cardIndex > -1) {
      this.hand.splice(cardIndex, 1);
      gameState.playPile.push(card);
    }
  }

  takePile(gameState) {
    // Add all cards from the play pile to the computer's hand
    this.hand.push(...gameState.playPile);
    gameState.playPile = [];
  }
}

// Add a computer player to the game state
const computerPlayer = new ComputerPlayer('Computer');

// Modify the game loop to include the computer player's turn
function gameLoop(gameState) {
  const currentPlayer = gameState.players[gameState.turn];

  if (currentPlayer instanceof ComputerPlayer) {
    currentPlayer.takeTurn(gameState);
    gameState.turn = (gameState.turn + 1) % gameState.players.length;
  }

  // ...existing game loop logic...
}

// Add the computer player to the game state during initialization
function initializeGame() {
  const gameState = {
    players: [/* existing players */, computerPlayer],
    playPile: [],
    turn: 0,
    // ...other game state properties...
  };

  return gameState;
}

function createServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer);
  
  // Store active games
  const games = new Map();

  app.use(express.static(path.join(__dirname, 'public')));

  io.on('connection', socket => {
    console.log(`🧩 Socket connected: ${socket.id}`);
    let currentGame = null;

    socket.on('join', name => {
      try {
        // Create new game for single player + computer
        const roomId = Math.random().toString(36).substring(2, 8);
        const game = new Game(io);
        games.set(roomId, game);
        currentGame = roomId;

        // Join the socket to the game room
        socket.join(currentGame);
        game.addPlayer(socket, name);

        // Send room ID to client
        socket.emit('gameRoom', currentGame);
      } catch (err) {
        console.error('❌ Join error:', err.message);
        socket.emit('err', err.message);
      }
    });

    socket.on('playCards', idxs => {
      try {
        if (!currentGame || !games.has(currentGame)) return;
        games.get(currentGame).play(socket, idxs);
      } catch (err) {
        console.error('❌ Play error:', err.message);
        socket.emit('err', err.message);
      }
    });

    socket.on('takePile', () => {
      try {
        if (!currentGame || !games.has(currentGame)) return;
        games.get(currentGame).takePile(socket);
      } catch (err) {
        console.error('❌ TakePile error:', err.message);
        socket.emit('err', err.message);
      }
    });

    socket.on('disconnect', () => {
      try {
        if (currentGame && games.has(currentGame)) {
          const game = games.get(currentGame);
          game.removePlayer(socket);
          
          // Clean up empty games
          if (game.players.length === 0) {
            games.delete(currentGame);
          }
        }
      } catch (err) {
        console.error('❌ Disconnect error:', err.message);
      }
    });

    socket.on('adminReset', () => {
      if (!currentGame || !games.has(currentGame)) return;
      console.log('🛑 Game reset via Ctrl+R');
      const game = games.get(currentGame);
      io.to(currentGame).emit('notice', 'Game resetting...');
      game.reset();
      io.in(currentGame).disconnectSockets(true);
      games.delete(currentGame);
    });
  });

  return httpServer;
}

function startServer() {
  const server = createServer();
  server.listen(3000, () => {
    console.log('Top That! server listening on :3000');
  });
}

startServer();
