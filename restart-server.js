// Trigger restart: April 24, 2025
// Another restart trigger: 2025-04-24
// Test trigger: 2025-04-24
// Test trigger 2: 2025-04-24
import { exec } from 'child_process';

const PORT = 3000;
const MAX_RETRIES = 10;
const DELAY_AFTER_KILL = 2000; // 2 seconds

console.log('Finding processs using port 3000...');

// Poll until port is free or timeout
function waitForPortFree(interval = 500, timeout = 60000) { // Increased timeout to 60s
  return new Promise(resolve => {
    const startTime = Date.now();
    function check() {
      exec(`lsof -i :${PORT}`, (err, stdout) => {
        console.log(`[waitForPortFree] lsof output (err: ${err ? err.code : 'none'}):\n${stdout}`);
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

function waitForPortReallyFree(interval = 500, timeout = 60000) {
  return new Promise(resolve => {
    const startTime = Date.now();
    function check() {
      exec(`lsof -i :${PORT}`, (err, stdout) => {
        if ((err && err.code === 1) || (stdout && stdout.trim().split('\n').length <= 1)) {
          // Double-check with netstat
          exec(`netstat -tuln | grep :${PORT}`, (netErr, netStdout) => {
            if (!netStdout || netStdout.trim() === '') {
              return resolve();
            }
            if (Date.now() - startTime > timeout) {
              console.warn(`[waitForPortReallyFree] Timeout waiting for port ${PORT} to free after ${(Date.now() - startTime) / 1000}s.`);
              return resolve();
            }
            setTimeout(check, interval);
          });
        } else {
          if (Date.now() - startTime > timeout) {
            console.warn(`[waitForPortReallyFree] Timeout waiting for port ${PORT} to free after ${(Date.now() - startTime) / 1000}s.`);
            return resolve();
          }
          setTimeout(check, interval);
        }
      });
    }
    check();
  });
}

let restartInProgress = false;

// Find process using port 3000
exec(`lsof -i :${PORT}`, async (error, stdout, stderr) => {
  console.log(`[restart-server] Initial lsof output (err: ${error ? error.code : 'none'}):\n${stdout}`);
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
    console.error(`[restart-server] Error finding process: ${error.message}`);
    restartInProgress = false;
    return;
  }
  
  const lines = stdout.trim().split('\n');
  console.log(`[restart-server] lsof lines:`, lines);
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
  console.log(`[restart-server] Parsed PIDs:`, pids);
  if (pids.length === 0) {
    console.log(`No PIDs found for port ${PORT}`);
    setTimeout(() => { startNewServer(); restartInProgress = false; }, 1000);
    return;
  }
  
  console.log(`Found processes with PIDs: ${pids.join(', ')}`);
  
  // Kill the processes
  const killPromises = pids.map(pid => new Promise(resolve => {
    console.log(`Killing process ${pid}...`);
    exec(`kill -9 ${pid}`, (killError, killStdout, killStderr) => {
      if (killError) {
        console.error(`Error killing process ${pid}: ${killError.message}`);
      } else {
        console.log(`Process ${pid} terminated successfully. kill stdout: ${killStdout}, kill stderr: ${killStderr}`);
      }
      resolve();
    });
  }));
  Promise.all(killPromises).then(async () => {
    console.log('All processes killed, waiting for port to really free...');
    setTimeout(async () => {
      await waitForPortReallyFree();
      console.log('Port is really free, starting server...');
      startNewServer();
      restartInProgress = false;
    }, DELAY_AFTER_KILL);
  });
});

function startNewServer(retryCount = 0) {
  if (retryCount >= MAX_RETRIES) {
    console.error(`[startNewServer] Max retries (${MAX_RETRIES}) reached. Giving up.`);
    return;
  }
  console.log(`[startNewServer] Attempt ${retryCount + 1}: Starting new server...`);
  const server = exec('node server.js', (error, stdout, stderr) => {
    if (error) {
      console.error(`[startNewServer] Error: ${error.message}`);
      if (error.message.includes('EADDRINUSE')) {
        console.warn(`[startNewServer] Port 3000 still in use, retrying in 5s...`);
        setTimeout(() => startNewServer(retryCount + 1), 5000);
        return;
      }
      return;
    }
    console.log(`[startNewServer] Server started successfully. stdout: ${stdout}, stderr: ${stderr}`);
  });
  if (server.stdout && server.stderr) {
    server.stdout.on('data', data => console.log(`[server.js stdout]: ${data}`));
    server.stderr.on('data', data => console.error(`[server.js stderr]: ${data}`));
  }
}