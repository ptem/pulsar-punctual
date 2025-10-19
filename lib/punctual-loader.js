// External loader script for Punctual ES module from node_modules
// This file exists to satisfy Pulsar's Content Security Policy
// which blocks inline scripts but allows external scripts from 'self'

// Import Punctual from node_modules
// The path is relative to this file: lib/punctual-loader.js
// node_modules is at ../node_modules/punctual/punctual.js
import { Punctual } from '../node_modules/punctual/punctual.js';

// Export to window for access from main.js
window.__PunctualModule = { Punctual };
