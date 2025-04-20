import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { Game } from './game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        // Look for a game that needs players
        let game = null;
        for (const [roomId, g] of games) {
          if (g.players.length < 2 && !g.started) {
            game = g;
            currentGame = roomId;
            break;
          }
        }

        // Create new game if none found
        if (!game) {
          const roomId = Math.random().toString(36).substring(2, 8);
          game = new Game(io);
          games.set(roomId, game);
          currentGame = roomId;
        }

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
