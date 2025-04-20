import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { Game } from './game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const game = new Game(io);

io.on('connection', socket => {
  console.log(`🧩 Socket connected: ${socket.id}`);

  socket.on('join', name => {
    try {
      game.addPlayer(socket, name);
    } catch (err) {
      console.error('❌ Join error:', err.message);
      socket.emit('err', err.message);
    }
  });

  socket.on('playCards', idxs => {
    try {
      game.play(socket, idxs);
    } catch (err) {
      console.error('❌ Play error:', err.message);
      socket.emit('err', err.message);
    }
  });

  socket.on('takePile', () => {
    try {
      game.takePile(socket);
    } catch (err) {
      console.error('❌ TakePile error:', err.message);
      socket.emit('err', err.message);
    }
  });

  socket.on('disconnect', () => {
    try {
      game.removePlayer(socket);
    } catch (err) {
      console.error('❌ Disconnect error:', err.message);
    }
  });

  socket.on('adminReset', () => {
    console.log('🛑 Game reset via Ctrl+R');
    game.reset();
    console.log('✔️ game.reset() called');
  });
});

server.listen(3000, () => {
  console.log('Top That! server listening on :3000');
});
