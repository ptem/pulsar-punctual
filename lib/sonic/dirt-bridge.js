"use babel"

/**
 * @file dirt-bridge.js
 * Connects /dirt/play OSC from SuperCollider/Tidal to Punctual.
 * Pulls cps (cycles/sec) so visuals can track audio tempo.
 */

/**
 * Minimal bridge for /dirt/play.
 * Extract cps and stash it so visuals can sync to tempo.
 */
export default class DirtBridge {
  /**
   * Creates a new DirtBridge.
   * @param {Function} [log] - Optional logging function that takes (message, cssClass) as parameters
   */
  constructor(log = () => {}) {
    /**
     * Function we use to log errors and status messages
     * @type {Function}
     */
    this.log = log
    
    /**
     * The most recent cycles-per-second value we got from a /dirt/play event
     * @type {number|null}
     */
    this.lastCps = null
  }

  /**
   * Handles incoming /dirt/play OSC events from SuperCollider/Tidal.
   * Grabs the cycles-per-second (cps) parameter and stores it so we can sync tempo.
   * 
   * @param {Object} evt - The OSC event object with parameters from /dirt/play
   * @param {number} [evt.cps] - Cycles per second (tempo) parameter
   * @param {number} [evt.orbit] - Channel/orbit number
   * @param {*} timeTag - OSC timetag that came with the event
   */
  onDirtPlay(evt, timeTag) {
    try {
      if (evt && typeof evt.cps === 'number' && isFinite(evt.cps) && evt.cps > 0) {
        this.lastCps = evt.cps
      }
    } catch (e) {
      this.log(`DirtBridge onDirtPlay error: ${e && e.message ? e.message : e}`, 'text-error')
    }
  }
}
