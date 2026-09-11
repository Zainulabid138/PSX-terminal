'use strict';

/**
 * start-electron.cjs
 * ------------------
 * Launches Electron with a CLEAN environment.
 *
 * Some machines set ELECTRON_RUN_AS_NODE=1 globally. When that variable is
 * present (even as an empty string, which `cross-env VAR=` does not remove),
 * the Electron binary runs as plain Node and `require('electron')` returns a
 * path string instead of the API — crashing the main process with
 * "Cannot read properties of undefined (reading 'handle')".
 *
 * This launcher runs under Node, fully DELETES that variable, and spawns the
 * real Electron binary with the cleaned environment. Any VITE_DEV_SERVER_URL
 * already in the environment is passed through for development mode.
 */

const { spawn } = require('child_process');

// In a plain-Node context, require('electron') resolves to the binary path.
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // the critical fix — remove, don't blank

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });

child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('Failed to launch Electron:', err);
  process.exit(1);
});
