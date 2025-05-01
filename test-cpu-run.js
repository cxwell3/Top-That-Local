import { io } from 'socket.io-client';

// Test server URL can be overridden by CLI arg, CPU_TEST_URL env var, or npm --url
const CLI_URL = process.argv[2];
const NPM_URL = process.env.npm_config_url;
const URL = CLI_URL || process.env.CPU_TEST_URL || NPM_URL || 'http://localhost:3000';
console.log(`[CPU TEST] connecting to server URL: ${URL}`);

const TOTAL_PLAYERS = 4;
const BOT_COUNT = 3; // number of headless clients joining host

async function start() {
  await new Promise(res => setTimeout(res, 500)); // wait for server startup

  const host = io(URL, { extraHeaders: { referer: URL } });
  host.on('connect', () => {
    console.log('[HOST] connected, creating lobby');
    host.emit('join', 'Host', TOTAL_PLAYERS, 0, null); // human host, no auto CPUs
  });
  host.on('connect_error', err => console.error('[HOST CONNECT_ERROR]', err));
  host.on('err', e => console.error('[HOST ERROR]', e));
  host.on('lobby', ({ roomId, players }) => {
    console.log(`[HOST] lobby ${roomId} has ${players.length}/${TOTAL_PLAYERS} players`);
    // spawn bot clients until full
    for (let i = 1; i <= BOT_COUNT; i++) {
      const bot = io(URL, { extraHeaders: { referer: URL } });
      bot.on('connect_error', err => console.error(`[BOT${i} CONNECT_ERROR]`, err));
      bot.on('connect', () => {
        console.log(`[BOT${i}] connecting to lobby`);
        bot.emit('join', `Bot${i}`, TOTAL_PLAYERS, 0, roomId); // human-style join
      });
      bot.on('err', e => console.error(`[BOT${i} ERROR]`, e));
      bot.on('state', s => {
        if (s.started) console.log(`[BOT${i}] game started`);
      });
    }
    // start the game
    setTimeout(() => {
      console.log('[HOST] triggering startGame');
      host.emit('startGame');
    }, 500);
  });

  host.on('state', s => {
    if (s.started) console.log('[HOST] received started state');
  });
}

start();