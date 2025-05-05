// wait.js - Helper to kill port 3000 and wait before server restart
import { exec } from 'child_process';

function killPort() {
  return new Promise((resolve, reject) => {
    console.log('[wait] Killing any process on port 3000...');
    exec('npx kill-port 3000', (err, stdout, stderr) => {
      if (err) {
        console.log(`[wait] Error killing port: ${err.message}`);
        // Continue even if there's an error, as the port might not be in use
        resolve();
      } else {
        console.log(`[wait] Port kill result: ${stdout.trim() || 'No output'}`);
        resolve();
      }
    });
  });
}

// Use async/await for better control flow
async function main() {
  try {
    await killPort();
    // Wait 3.5 seconds to ensure port is fully released
    console.log('[wait] Waiting 3.5s for port to be fully released...');
    await new Promise(resolve => setTimeout(resolve, 3500));
    console.log('[wait] Done waiting, starting server...');
    process.exit(0);
  } catch (error) {
    console.error('[wait] Fatal error:', error);
    process.exit(1);
  }
}

main();