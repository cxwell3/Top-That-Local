// Trigger restart: May 2, 2025
import { exec, spawn } from 'child_process';

const PORT = 3000;
const MAX_RETRIES = 10;
const DELAY_AFTER_KILL = 3000; // Increased to 3 seconds
const RETRY_INTERVAL = 2000; // Add a consistent retry interval
const PORT_CHECK_TIMEOUT = 60000; // 60 seconds timeout for port checks
const isWin = process.platform === 'win32';
const listCmd = isWin ? `netstat -ano | findstr :${PORT}` : `lsof -i :${PORT}`;
const killCmdTemplate = isWin ? pid => `taskkill /PID ${pid} /F` : pid => `kill -9 ${pid}`;

console.log('Finding processes using port 3000...');

// Global flag to prevent multiple restarts running at once
let restartInProgress = false;

// Poll until port is free or timeout
function waitForPortFree(interval = 1000, timeout = PORT_CHECK_TIMEOUT) {
  return new Promise(resolve => {
    const startTime = Date.now();
    function check() {
      exec(listCmd, (err, stdout) => {
        console.log(`[waitForPortFree] listCmd output (err: ${err ? err.code : 'none'}):\n${stdout}`);
        const lines = stdout.trim().split('\n');
        
        // If error with code 1 or no output lines, port is free
        if ((err && err.code === 1) || !stdout || stdout.trim() === '' || lines.length <= 1) {
          console.log(`[waitForPortFree] Port ${PORT} is free after ${(Date.now() - startTime) / 1000}s`);
          return resolve(true);
        }
        
        // Check if we've timed out
        if (Date.now() - startTime > timeout) {
          console.warn(`[waitForPortFree] Timeout waiting for port ${PORT} to free after ${(Date.now() - startTime) / 1000}s.`);
          return resolve(false);
        }
        
        console.log(`[waitForPortFree] Port ${PORT} still in use, checking again in ${interval}ms...`);
        setTimeout(check, interval);
      });
    }
    check();
  });
}

// Function to try to find and kill any processes using our port
async function killProcessesOnPort() {
  return new Promise((resolve) => {
    exec(listCmd, async (error, stdout, stderr) => {
      console.log(`[killProcessesOnPort] listCmd output (err: ${error ? error.code : 'none'}):\n${stdout}`);

      // Handle case where no processes are found
      if (error && error.code === 1) {
        console.log(`No process found using port ${PORT}`);
        return resolve(true);
      }
      
      if (error) {
        console.error(`[killProcessesOnPort] Error finding process: ${error.message}`);
        return resolve(false);
      }
      
      const lines = stdout.trim().split('\n');
      console.log(`[killProcessesOnPort] listCmd lines:`, lines);
      
      if (!stdout || stdout.trim() === '' || lines.length <= 1) {
        console.log(`No process found using port ${PORT}`);
        return resolve(true);
      }
      
      // Parse the output to find the PID(s)
      const pids = [];
      if (isWin) {
        for (let i = 0; i < lines.length; i++) {
          const cols = lines[i].trim().split(/\s+/);
          if (cols.length > 4) {
            const pid = cols[cols.length - 1];
            if (pid && /^\d+$/.test(pid)) {
              pids.push(pid);
            }
          }
        }
      } else {
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/\s+(\d+)\s+/);
          if (match && match[1]) {
            pids.push(match[1]);
          }
        }
      }
      
      console.log(`[killProcessesOnPort] Parsed PIDs:`, pids);
      
      if (pids.length === 0) {
        console.log(`No PIDs found for port ${PORT}`);
        return resolve(true);
      }
      
      console.log(`Found processes with PIDs: ${pids.join(', ')}`);
      
      // Kill the processes
      const uniquePids = [...new Set(pids)]; // Remove duplicates
      const killPromises = uniquePids.map(pid => new Promise(killResolve => {
        const killCmd = killCmdTemplate(pid);
        console.log(`Killing process ${pid} using: ${killCmd}`);
        exec(killCmd, (killError, killStdout, killStderr) => {
          if (killError) {
            console.error(`Error killing process ${pid}: ${killError.message}`);
          } else {
            console.log(`Process ${pid} terminated successfully. kill stdout: ${killStdout}, kill stderr: ${killStderr}`);
          }
          killResolve();
        });
      }));
      
      await Promise.all(killPromises);
      console.log('All processes killed, waiting for port to free...');
      resolve(true);
    });
  });
}

// Main restart function
async function restartServer() {
  // Prevent multiple concurrent restarts
  if (restartInProgress) {
    console.log('[restartServer] Restart already in progress, skipping duplicate trigger.');
    return;
  }
  
  restartInProgress = true;
  console.log('[restartServer] Starting server restart process...');
  
  try {
    // First attempt to kill processes on the port
    await killProcessesOnPort();
    
    // Wait for kill commands to take effect
    console.log(`[restartServer] Waiting ${DELAY_AFTER_KILL}ms for kill commands to take effect...`);
    await new Promise(resolve => setTimeout(resolve, DELAY_AFTER_KILL));
    
    // Check if port is really free
    const portIsFree = await waitForPortFree(1000, PORT_CHECK_TIMEOUT);
    
    if (portIsFree) {
      console.log('[restartServer] Port is confirmed free, starting new server...');
      await startNewServer();
    } else {
      console.error('[restartServer] Port is still in use after timeout. Force killing and trying one more time...');
      // Try one more aggressive kill attempt
      await killProcessesOnPort();
      await new Promise(resolve => setTimeout(resolve, DELAY_AFTER_KILL * 1.5));
      await startNewServer();
    }
  } catch (err) {
    console.error('[restartServer] Error during restart:', err);
  } finally {
    restartInProgress = false;
    console.log('[restartServer] Restart process completed.');
  }
}

// Improved server start function
async function startNewServer(retryCount = 0) {
  return new Promise(resolve => {
    if (retryCount >= MAX_RETRIES) {
      console.error(`[startNewServer] Max retries (${MAX_RETRIES}) reached. Giving up.`);
      return resolve(false);
    }
    
    console.log(`[startNewServer] Attempt ${retryCount + 1}: Starting new server...`);
    
    // Use spawn with ES module syntax
    const server = spawn('node', ['server.js'], {
      stdio: 'inherit', // This will pipe the output directly to the parent process
      detached: true,   // This allows the child to run independently of the parent
      shell: true       // Run command inside a shell
    });
    
    server.on('error', (error) => {
      console.error(`[startNewServer] Failed to start server: ${error.message}`);
      
      if (error.message.includes('EADDRINUSE')) {
        console.warn(`[startNewServer] Port ${PORT} still in use, retrying in ${RETRY_INTERVAL/1000}s...`);
        setTimeout(() => startNewServer(retryCount + 1).then(resolve), RETRY_INTERVAL);
      } else {
        resolve(false);
      }
    });
    
    server.on('close', (code) => {
      if (code !== 0) {
        console.error(`[startNewServer] Server process exited with code ${code}`);
        setTimeout(() => startNewServer(retryCount + 1).then(resolve), RETRY_INTERVAL);
      } else {
        console.log('[startNewServer] Server started successfully.');
        resolve(true);
      }
    });
    
    // Unref so the parent process can exit independently of the child
    if (server.unref) {
      server.unref();
    }
    
    // If we get here without an immediate error, assume success for now
    setTimeout(() => {
      console.log('[startNewServer] Server appears to be starting up...');
      resolve(true);
    }, 1000);
  });
}

// Start the restart process
restartServer().catch(err => {
  console.error('[Main] Uncaught error during restart:', err);
});