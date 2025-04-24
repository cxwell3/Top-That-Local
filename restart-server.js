import { exec } from 'child_process';

const PORT = 3000;

console.log('Finding processs using port 3000...');

// Poll until port is free or timeout
function waitForPortFree(interval = 500, timeout = 60000) { // Increased timeout to 60s
  return new Promise(resolve => {
    const startTime = Date.now();
    function check() {
      exec(`lsof -i :${PORT}`, (err, stdout) => {
        if ((err && err.code === 1) || (stdout && stdout.trim().split('\n').length <= 1)) {
          console.log(`[waitForPortFree] Port ${PORT} is free after ${(Date.now() - startTime) / 1000}s`);
          return resolve();
        }
        if (Date.now() - startTime > timeout) {
          console.warn(`[waitForPortFree] Timeout waiting for port ${PORT} to free after ${(Date.now() - startTime) / 1000}s.`);
          return resolve();
        }
        console.log(`[waitForPortFree] Port ${PORT} still in use, checking again in ${interval}ms...`);
        setTimeout(check, interval);
      });
    }
    check();
  });
}

let restartInProgress = false;

// Find process using port 3000
exec(`lsof -i :${PORT}`, async (error, stdout, stderr) => {
  if (restartInProgress) {
    console.log('[restart-server] Restart already in progress, skipping duplicate trigger.');
    return;
  }
  restartInProgress = true;

  if (error) {
    if (error.code === 1) {
      console.log(`No process found using port ${PORT}`);
      await waitForPortFree();
      setTimeout(() => { startNewServer(); restartInProgress = false; }, 500);
      return;
    }
    console.error(`Error finding process: ${error.message}`);
    restartInProgress = false;
    return;
  }
  
  const lines = stdout.trim().split('\n');
  if (lines.length <= 1) {
    console.log(`No process found using port ${PORT}`);
    await waitForPortFree();
    setTimeout(() => { startNewServer(); restartInProgress = false; }, 500);
    return;
  }
  
  // Parse the output to find the PID(s)
  const pids = [];
  for (let i = 1; i < lines.length; i++) {
    const match = lines[i].match(/\s+(\d+)\s+/);
    if (match && match[1]) {
      pids.push(match[1]);
    }
  }
  if (pids.length === 0) {
    console.log(`No PIDs found for port ${PORT}`);
    setTimeout(() => { startNewServer(); restartInProgress = false; }, 1000);
    return;
  }
  
  console.log(`Found processes with PIDs: ${pids.join(', ')}`);
  
  // Kill the processes
  const killPromises = pids.map(pid => new Promise(resolve => {
    console.log(`Killing process ${pid}...`);
    exec(`kill -9 ${pid}`, (killError) => {
      if (killError) {
        console.error(`Error killing process ${pid}: ${killError.message}`);
      } else {
        console.log(`Process ${pid} terminated successfully`);
      }
      resolve();
    });
  }));
  Promise.all(killPromises).then(async () => {
    console.log('All processes killed, waiting for port to free...');
    await waitForPortFree();
    console.log('Port is free, starting server...');
    startNewServer();
    restartInProgress = false;
  });
});

function startNewServer(retryCount = 0) {
  console.log(`[startNewServer] Attempt ${retryCount + 1}: Starting new server...`);
  const server = exec('node server.js', (error, stdout, stderr) => {
    if (error) {
      if (error.message.includes('EADDRINUSE') && retryCount < 5) {
        console.warn(`[startNewServer] Port 3000 still in use, retrying in 5s...`);
        setTimeout(() => startNewServer(retryCount + 1), 5000);
        return;
      }
      console.error(`[startNewServer] Error starting server: ${error.message}`);
      return;
    }
  });
  // Pipe the server output to the console
  server.stdout.pipe(process.stdout);
  server.stderr.pipe(process.stderr);
}