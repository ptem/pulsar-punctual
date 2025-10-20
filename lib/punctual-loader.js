/**
 * @file punctual-loader.js
 * Tiny ES module shim to load Punctual under Pulsar's CSP.
 * Imports from node_modules and exposes it on window for main.js.
 */

import { Punctual } from '../node_modules/punctual/punctual.js';

/**
 * Puts Punctual module on the window object.
 * This lets main.js access Punctual after the module loads via a script tag.
 * @global
 * @type {{Punctual: typeof Punctual}}
 */
window.__PunctualModule = { Punctual };
