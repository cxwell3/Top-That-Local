import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { Game } from './game.js';
import fs from 'fs'; // add at top

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

  app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

  // Admin endpoint to stop all games
  app.post('/admin/stopAllGames', (req, res) => {
    console.log('🛑 Admin requested stopAllGames. Clearing all rooms.');
    games.forEach((game, roomId) => {
      // notify players
      io.to(roomId).emit('notice', 'Server is stopping all games.');
      // reset and delete game
      game.reset();
      games.delete(roomId);
    });
    return res.send('All games stopped');
  });

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

    socket.on('join', (name, totalPlayers, numComputers, roomParam) => {
      try {
        // Normalize inputs
        const requestedTotal = Math.min(Math.max(parseInt(totalPlayers, 10) || 2, 2), 4);
        const cpuCount = Math.min(Math.max(parseInt(numComputers, 10) || 0, 0), requestedTotal - 1);
        const withComputer = cpuCount > 0;
        // Use roomParam to target existing room if provided
        let targetRoomId = roomParam || null;

        // Unified lobby creation/join logic for humans and computers
        // Attempt to join existing room if roomParam provided and valid
        let game = null;
        if (targetRoomId && games.has(targetRoomId)) {
          const existing = games.get(targetRoomId);
          if (!existing.started && existing.players.length < existing.MAX_PLAYERS) {
            game = existing;
          } else {
            targetRoomId = null;
          }
        }
        // Fallback: if no URL room specified and exactly one open room exists, join it
        if (!game) {
          const open = Array.from(games.entries())
            .filter(([, g]) => !g.started && g.players.length < g.MAX_PLAYERS);
          if (open.length === 1) {
            const [id, existing] = open[0];
            game = existing;
            targetRoomId = id;
          }
        }
        // Create new room if no valid existing
        if (!game) {
          const newRoomId = Math.random().toString(36).substring(2, 8);
          game = new Game(io);
          game.roomId = newRoomId;  // Associate roomId with game instance
          // limit players to requested total
          game.MAX_PLAYERS = requestedTotal;
          games.set(newRoomId, game);
          targetRoomId = newRoomId;
        }
        // Join socket to room
        socket.join(targetRoomId);
        socketToRoom.set(socket.id, targetRoomId);
        // Add the human player
        if (!game.addPlayer(socket, name)) {
          socket.emit('err', 'Failed to join game: Room may be full or started.');
          return;
        }
        socket.emit('gameRoom', targetRoomId);
        console.log(`Player ${name} joined room ${targetRoomId}`);
        // Add computer players if requested
        if (withComputer) {
          console.log(`Adding ${cpuCount} computer players to room ${targetRoomId}`);
          for (let i = 0; i < cpuCount; i++) game.addComputerPlayer();
        }
        // Update lobby view
        updateLobby(targetRoomId);
        // Await client 'startGame' action to begin game
        return;
      } catch (err) {
        console.error('❌ Join error:', err.message, err.stack);
        socket.emit('err', err.message);
      }
    });

    // Add listener for manual start request
    socket.on('startGame', () => {
      const roomId = socketToRoom.get(socket.id);
      if (!roomId || !games.has(roomId)) return;
      const game = games.get(roomId);
      if (!game.started && game.players.length >= 2) {
        console.log(`Game start triggered by player in room ${roomId}`);
        game.startGame();
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

  // Watch public assets and broadcast reload to clients
  const publicPath = path.join(__dirname, 'public');
  fs.watch(publicPath, { recursive: true }, (eventType, filename) => {
    console.log(`🔄 Public file changed (${filename}), sending reload to clients.`);
    io.emit('reload');
  });

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
