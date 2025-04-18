import express            from 'express';
import { createServer }   from 'http';
import { Server }         from 'socket.io';
import path               from 'path';
import { fileURLToPath }  from 'url';
import { Game }           from './game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app    = express();
const server = createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- game ----------
const game = new Game(io);

io.on('connection', socket => {
  socket.on('join',      name  => game.addPlayer(socket, name));
  socket.on('playCards', idxs  => game.play(socket, idxs));
  socket.on('takePile',  ()    => game.takePile(socket));
  socket.on('disconnect',()    => game.removePlayer(socket));
});

server.listen(3000, () =>
  console.log('Three’s server listening on :3000')
);
