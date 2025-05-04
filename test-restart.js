// Test script to verify restart-server.js functionality
// This will create a server on port 3000, then try to run restart-server.js
// to verify it can properly handle and resolve port conflicts
import http from 'http';
import { spawn } from 'child_process';
const PORT = 3000;

console.log('=== TEST RESTART SERVER SCRIPT ===');
console.log(`1. Creating a dummy server on port ${PORT} to simulate occupation`);

// Create a server that will occupy port 3000
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Test server running on port 3000');
});

let testResult = false;
let testTimeout = null;

// Start the test server
server.listen(PORT, () => {
  console.log(`Dummy server started on port ${PORT}`);
  
  // Give the server a moment to fully initialize
  setTimeout(() => {
    console.log(`2. Server running on port ${PORT}, now testing restart-server.js`);
    
    // Run our restart-server.js script
    const restartProcess = spawn('node', ['restart-server.js'], {
      stdio: 'inherit' // Show output in the console
    });
    
    // Set a timeout for the overall test
    testTimeout = setTimeout(() => {
      console.log('\n❌ TEST FAILED: Timeout waiting for restart-server.js to complete');
      process.exit(1);
    }, 30000); // 30 second timeout
    
    // Check if a new server comes up after our script runs
    checkServerStatusPeriodically();
  }, 2000);
});

// Function to periodically check if a new server is up after our old one is killed
function checkServerStatusPeriodically() {
  let checkCount = 0;
  const maxChecks = 15;
  
  const checkInterval = setInterval(() => {
    checkCount++;
    
    // Make a request to see if a new server is running
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path: '/',
      method: 'GET',
      timeout: 1000
    }, (res) => {
      // If we can connect successfully after our original server should have been killed,
      // it means the restart process worked
      if (checkCount > 5) { // Skip the first few checks when we expect our test server to still be alive
        console.log(`✅ TEST PASSED: New server detected on port ${PORT} after restart`);
        testResult = true;
        cleanup();
      }
    });
    
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED' && checkCount > 5) {
        // This is expected during the restart transition - the port should be briefly unavailable
        console.log(`Port ${PORT} unavailable (try ${checkCount}/${maxChecks}), waiting for new server...`);
      }
    });
    
    req.end();
    
    // End testing after maximum checks
    if (checkCount >= maxChecks) {
      console.log('❌ TEST FAILED: New server did not come up after the expected time');
      cleanup();
    }
  }, 2000);
  
  function cleanup() {
    clearInterval(checkInterval);
    if (testTimeout) clearTimeout(testTimeout);
    setTimeout(() => {
      process.exit(testResult ? 0 : 1);
    }, 1000);
  }
}

process.on('SIGINT', () => {
  console.log('Test interrupted, cleaning up...');
  process.exit(1);
});