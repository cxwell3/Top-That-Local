import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { Game } from './game.js';

console.log("File saved!"); // Fixed typo in debug message
console.log("[Test Restart] Server started at: " + new Date().toISOString());
console.log("[Restart Test] File change detected at: 2025-04-24");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer);

  // Store active games
  const games = new Map(); // Maps roomId -> Game instance
  const socketToRoom = new Map(); // Maps socket.id -> roomId

  // Add no-cache headers to prevent browser caching
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  io.on('connection', socket => {
    console.log(`🧩 Socket connected: ${socket.id}`);

    // Helper to emit lobby updates for a specific room
    const updateLobby = (roomId) => {
      if (games.has(roomId)) {
        const game = games.get(roomId);
        const lobbyData = game.players.map(p => ({ id: p.id, name: p.name }));
        // Emit to the specific room
        io.to(roomId).emit('lobby', { 
          players: lobbyData, 
          maxPlayers: game.MAX_PLAYERS, 
          roomId: roomId 
        });
      }
    };

    socket.on('join', (name, withComputer, numComputers) => {
      try {
        const url = new URL(socket.handshake.headers.referer);
        const urlRoomId = url.searchParams.get('room');
        let joinedGame = false;
        let targetRoomId = null;

        // If playing with computer, ALWAYS create a new game
        if (withComputer) {
          console.log(`Player ${name} requested a game with computer. Forcing new room creation.`);
          // Skip joining existing room logic
        } else if (urlRoomId && games.has(urlRoomId)) { // Try joining existing room from URL ONLY if not playing vs computer
          const game = games.get(urlRoomId);
          // Check if game exists, is not started, and not full
          if (!game.started && game.players.length < game.MAX_PLAYERS) {
            if (game.addPlayer(socket, name)) {
              targetRoomId = urlRoomId;
              socket.join(targetRoomId);
              socketToRoom.set(socket.id, targetRoomId);
              socket.emit('gameRoom', targetRoomId); // Confirm room joined
              joinedGame = true;
              console.log(`Player ${name} joined existing room ${targetRoomId}`);
            } else {
              // addPlayer failed (e.g., room became full just now)
              socket.emit('err', 'Failed to join room. It might be full.');
              return;
            }
          } else if (game.started) {
            socket.emit('err', 'Cannot join game: Already started.');
            return;
          } else { // Game not started but full
            socket.emit('err', 'Cannot join game: Room is full.');
            return;
          }
        }

        // If couldn't join existing or no URL room, or if forced new game for computer
        if (!joinedGame) {
          const newRoomId = Math.random().toString(36).substring(2, 8);
          const game = new Game(io); // Pass io instance
          games.set(newRoomId, game);
          targetRoomId = newRoomId;

          socket.join(targetRoomId);
          socketToRoom.set(socket.id, targetRoomId);

          // Add the human player first
          if (game.addPlayer(socket, name)) {
            console.log(`Player ${name} created and joined new room ${targetRoomId}`);
            socket.emit('gameRoom', targetRoomId); // Confirm room created/joined

            if (withComputer) {
              // Use user-specified number of computers
              const requestedComputers = Math.max(1, Math.min(parseInt(numComputers, 10) || 1, game.MAX_PLAYERS - 1));
              console.log(`Filling room ${targetRoomId} with ${requestedComputers} computer players (requested: ${numComputers}) up to ${game.MAX_PLAYERS}`);
              const computersToAdd = Math.min(requestedComputers, game.MAX_PLAYERS - game.players.length);

              for (let i = 0; i < computersToAdd; i++) {
                if (!game.addComputerPlayer()) {
                  console.warn(`Could not add computer player ${i + 1} to room ${targetRoomId}`);
                }
              }
              // Start game ONLY if enough players (human + added computers) are present
              if (game.players.length >= 2) { // Start if at least 2 players total
                 console.log(`Starting game in room ${targetRoomId} with ${game.players.length} players.`);
                 game.startGame(); // Start the game now
              } else {
                 console.warn(`Not enough players (${game.players.length}) to start game in room ${targetRoomId} even after adding computers.`);
                 updateLobby(targetRoomId); // Update lobby if game didn't start
              }
            } else {
              // If not playing with computer, just update lobby
              updateLobby(targetRoomId);
            }
          } else {
            // Handle human player add failure
            games.delete(newRoomId);
            socketToRoom.delete(socket.id);
            socket.leave(targetRoomId);
            socket.emit('err', 'Failed to create or join game.');
            return;
          }
        } else if (!withComputer) { // Added this else if
           // If joined existing game (human only), update lobby
           updateLobby(targetRoomId);
        }

      } catch (err) {
        console.error('❌ Join error:', err.message, err.stack);
        socket.emit('err', err.message);
      }
    });
    socket.on('playCards', idxs => {
      const roomId = socketToRoom.get(socket.id);
      try {
        if (!roomId || !games.has(roomId)) return;
        games.get(roomId).play(socket, idxs);
      } catch (err) {
        console.error('❌ Play error:', err.message, err.stack);
        socket.emit('err', err.message);
      }
    });

    socket.on('takePile', () => {
      const roomId = socketToRoom.get(socket.id);
      try {
        if (!roomId || !games.has(roomId)) return;
        const game = games.get(roomId);
        game.takePile(socket);

        // Computer turn logic is now handled within game.js after state push
      } catch (err) {
        console.error('❌ TakePile error:', err.message, err.stack);
        socket.emit('err', err.message);
      }
    });

    // Add chat message handler
    socket.on('chatMessage', (message) => {
      const roomId = socketToRoom.get(socket.id);
      if (!roomId || !games.has(roomId)) return;
      const game = games.get(roomId);
      const player = game.byId(socket.id);
      if (player && !player.isComputer) { // Only allow human players to chat
        // Broadcast message to the room, including sender
        io.to(roomId).emit('chatMessage', { 
          sender: player.name, 
          message: message 
        });
      }
    });

    socket.on('rejoin', (playerId, roomId) => {
      console.log(`🔄 Player ${playerId} attempting to rejoin room ${roomId}`);
      if (games.has(roomId)) {
        const game = games.get(roomId);
        const player = game.findPlayerById(playerId); // Use the new method

        if (player && player.disconnected) {
          console.log(`✅ Reconnecting player ${player.name} (${playerId}) to room ${roomId}`);
          player.sock = socket; // Re-assign the new socket
          player.disconnected = false;
          socket.join(roomId);
          socketToRoom.set(socket.id, roomId);
          socket.emit('joined', { id: player.id }); // Confirm rejoin
          socket.emit('gameRoom', roomId); // Send room ID back
          game.pushState(); // Send current game state
          updateLobby(roomId); // Update lobby if game hasn't started
        } else if (player && !player.disconnected) {
          console.warn(`⚠️ Player ${playerId} tried to rejoin room ${roomId} but was already connected.`);
          // Maybe force disconnect old socket? For now, just log.
          socket.emit('err', 'Already connected in another session.');
        } else {
          console.warn(`🚫 Player ${playerId} failed to rejoin room ${roomId}: Player not found or game state issue.`);
          socket.emit('err', 'Could not rejoin the game. Please join again.');
        }
      } else {
        console.warn(`🚫 Player ${playerId} failed to rejoin room ${roomId}: Room not found.`);
        socket.emit('err', 'Game room no longer exists. Please join again.');
      }
    });

    socket.on('disconnect', () => {
      const roomId = socketToRoom.get(socket.id);
      const playerId = socket.id; // Use socket.id as the player ID before it's gone
      console.log(`🔌 Socket disconnected: ${playerId} from room ${roomId}`);
      try {
        if (roomId && games.has(roomId)) {
          const game = games.get(roomId);
          // Mark player as disconnected instead of removing
          game.markPlayerDisconnected(playerId);
          socketToRoom.delete(playerId); // Clean up map using the correct ID

          // Check if all players are disconnected
          const activePlayers = game.players.filter(p => !p.disconnected);
          if (activePlayers.length === 0) {
            console.log(`🗑️ All players disconnected from room ${roomId}. Deleting game.`);
            games.delete(roomId);
          } else if (!game.started) {
            // If game not started, update lobby for remaining players
            updateLobby(roomId);
          } else {
            // If game started, push state to show player disconnected
            game.pushState();
          }
        }
      } catch (err) {
        console.error('❌ Disconnect error:', err.message, err.stack);
      }
    });

    socket.on('adminReset', () => {
      const roomId = socketToRoom.get(socket.id);
      if (!roomId || !games.has(roomId)) return;
      console.log(`🛑 Game reset via Ctrl+R in room ${roomId}`);
      const game = games.get(roomId);
      io.to(roomId).emit('notice', 'Game resetting...');

      // Get all socket IDs in the room before disconnecting
      const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
      if (socketsInRoom) {
        socketsInRoom.forEach(socketId => {
          const sock = io.sockets.sockets.get(socketId);
          if (sock) {
            sock.disconnect(true);
          }
          socketToRoom.delete(socketId); // Clean up map for each disconnected socket
        });
      }

      // Reset game state and delete game instance
      game.reset();
      games.delete(roomId);
      console.log(`🗑️ Game room ${roomId} deleted after reset.`);
    });
  }); // End of io.on('connection')

  return httpServer;
}

const server = createServer();
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Top That! server listening on :${PORT}`);
});

// Graceful shutdown for SIGTERM/SIGINT
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed successfully.');
    process.exit(0);
  });
  setTimeout(() => {
    console.log('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed successfully.');
    process.exit(0);
  });
  setTimeout(() => {
    console.log('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
});
