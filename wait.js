// wait.js - Helper to kill port 3000 and wait before server restart
import { exec } from 'child_process';

console.log('[wait] Killing any process on port 3000...');
exec('npx kill-port 3000', (err, stdout, stderr) => {
  if (err) {
    console.log(`[wait] Error killing port: ${err.message}`);
  } else {
    console.log(`[wait] Port kill result: ${stdout.trim() || 'No output'}`);
  }
  
  // Wait 1.5 seconds to ensure port is fully released
  console.log('[wait] Waiting 1.5s for port to be released...');
  setTimeout(() => {
    console.log('[wait] Done waiting, starting server...');
    process.exit(0); // Exit successfully so nodemon continues to the next command
  }, 1500);
});