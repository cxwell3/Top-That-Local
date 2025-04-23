import { exec } from 'child_process';

console.log('Finding processes using port 3000...');

// Find process using port 3000
exec('lsof -i :3000', (error, stdout, stderr) => {
  if (error) {
    if (error.code === 1) {
      console.log('No process found using port 3000');
      startNewServer();
      return;
    }
    console.error(`Error finding process: ${error.message}`);
    return;
  }
  
  const lines = stdout.trim().split('\n');
  if (lines.length <= 1) {
    console.log('No process found using port 3000');
    startNewServer();
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
    console.log('No PIDs found for port 3000');
    startNewServer();
    return;
  }
  
  console.log(`Found processes with PIDs: ${pids.join(', ')}`);
  
  // Kill the processes
  pids.forEach(pid => {
    console.log(`Killing process ${pid}...`);
    exec(`kill -9 ${pid}`, (killError, killStdout, killStderr) => {
      if (killError) {
        console.error(`Error killing process ${pid}: ${killError.message}`);
        return;
      }
      console.log(`Process ${pid} terminated successfully`);
    });
  });
  
  // Wait a moment then start new server
  setTimeout(startNewServer, 500);
});

function startNewServer() {
  console.log('Starting new server...');
  const server = exec('node server.js', (error, stdout, stderr) => {
    if (error) {
      console.error(`Error starting server: ${error.message}`);
      return;
    }
  });
  
  // Pipe the server output to the console
  server.stdout.pipe(process.stdout);
  server.stderr.pipe(process.stderr);
  
  console.log('Server started. Press Ctrl+C to exit.');
}
