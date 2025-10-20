"use babel"

/**
 * @file tempo-sync.js
 * Keeps Punctual in time with Tidal/SuperCollider.
 * Converts OSC timetags, tracks cps/phase, fixes drift.
 */

/**
 * Maintains tempo/phase sync for Punctual.
 * Parses /dirt/play timing; updates cps/phase only when needed; supports drift correction.
 */
export default class TempoSync {
  /**
   * Creates a new TempoSync instance.
   * Initializes internal state for tracking tempo and phase.
   */
  constructor() {
    /**
     * The last CPS (cycles per second) value that was successfully applied to Punctual
     * @type {number|null}
     * @private
     */
    this._lastCpsApplied = null
    
    /**
     * Internal tempo model tracking frequency, time, and cycle count
     * @type {Object|null}
     * @property {number} freq - Frequency in cycles per second
     * @property {number} timeSec - POSIX timestamp in seconds
     * @property {number} count - Cycle count at the given time
     * @private
     */
    this._tempoModel = null
  }

  /**
   * Converts various OSC NTP timetag formats to POSIX seconds (Unix timestamp).
   * Handles multiple timetag representations from the 'osc' library, including
   * raw byte arrays and structured objects. NTP timestamps are epoch 1900-01-01,
   * while POSIX timestamps are epoch 1970-01-01.
   * @param {*} tt - The timetag to convert (can be number, string, or object with various shapes)
   * @returns {number|null} POSIX timestamp in seconds (fractional), or null if conversion fails
   */
  timeTagToPosixSeconds(tt) {
    try {
      if (!tt) return null
      if (typeof tt === 'number' && isFinite(tt)) return tt
      if (typeof tt === 'string') {
        const n = Number(tt)
        if (isFinite(n)) return n
      }
      if (typeof tt === 'object') {
        // 'osc' shape: { raw: [sec, frac] }
        if (Array.isArray(tt.raw) && tt.raw.length >= 2) {
          const sec = tt.raw[0] >>> 0
          const frac = tt.raw[1] >>> 0
          const ntp = sec + frac / 4294967296 // 2^32
          const posix = ntp - 2208988800 // NTP(1900) -> POSIX(1970)
          return posix
        }
        // or { seconds, fractions }
        if (typeof tt.seconds === 'number' && typeof tt.fractions === 'number') {
          const ntp = (tt.seconds >>> 0) + (tt.fractions >>> 0) / 4294967296
          return ntp - 2208988800
        }
      }
    } catch (_) {}
    return null
  }

  /**
   * Gets the current time as a high-resolution POSIX timestamp in seconds.
   * Uses the Performance API when available for sub-millisecond precision,
   * otherwise falls back to Date.now().
   * @returns {number} Current POSIX timestamp in seconds (fractional)
   */
  nowPosixSeconds() {
    const p = (typeof performance !== 'undefined') ? performance : null
    if (p && typeof p.now === 'function' && typeof p.timeOrigin === 'number') {
      return (p.timeOrigin + p.now()) / 1000
    }
    return Date.now() / 1000
  }

  /**
   * Builds candidate ForeignTempo objects for purescript-tempi.
   * Creates multiple representation formats: a precise rational form using BigInt for
   * high-precision frequency and cycle counting, and a simpler fallback format.
   * The method tries the precise format first for better accuracy.
   * @param {number} cps - Cycles per second (tempo frequency)
   * @param {number} [cycle] - Current cycle count (phase position)
   * @param {number} timeSec - POSIX timestamp in seconds when this tempo applies
   * @returns {Array<Object>} Array of candidate tempo objects to try applying
   */
  buildForeignTempoCandidates(cps, cycle, timeSec) {
    const candidates = []
    const hasCycle = (typeof cycle === 'number' && isFinite(cycle))
    try {
      if (typeof BigInt !== 'undefined') {
        const freqScale = 1000n // thousandths precision
        const freqNum = BigInt(Math.round(cps * Number(freqScale)))
        const freqDen = freqScale
        if (hasCycle) {
          const countScale = 1000000n // micro-cycles
          const countNum = BigInt(Math.round(cycle * Number(countScale)))
          candidates.push({
            freqNumerator: freqNum,
            freqDenominator: freqDen,
            time: timeSec,
            countNumerator: countNum,
            countDenominator: countScale
          })
        } else {
          candidates.push({
            freqNumerator: freqNum,
            freqDenominator: freqDen,
            time: timeSec,
            countNumerator: 0n,
            countDenominator: 1n
          })
        }
      }
    } catch (_) {
      // ignore precise form errors; will try simpler shape next
    }
    // Simple shape supported by some builds (no phase info)
    candidates.push({ freq: cps })
    return candidates
  }

  /**
   * Determines whether Punctual's tempo should be updated based on tempo change or phase drift.
   * Compares the new CPS with the previously applied tempo, and if phase sync is enabled,
   * calculates phase drift by predicting where we should be versus where Tidal says we are.
   * Returns true if the tempo has changed significantly or if phase drift exceeds tolerance.
   * @param {number} cps - New cycles per second value
   * @param {number} [cycle] - Current cycle count from Tidal
   * @param {number} msgTimeSec - POSIX timestamp when this message was sent
   * @param {boolean} phaseSyncEnabled - Whether phase synchronization is enabled
   * @param {number} phaseTolerance - Maximum acceptable phase drift in cycles (e.g., 1/64)
   * @returns {Object} Decision object with shouldUpdate, hasCycle, and phaseDrift properties
   */
  computeUpdateDecision(cps, cycle, msgTimeSec, phaseSyncEnabled, phaseTolerance) {
    const lastModel = this._tempoModel || null
    const lastCps = (lastModel && typeof lastModel.freq === 'number') ? lastModel.freq : this._lastCpsApplied
    const cpsChanged = !(lastCps != null && Math.abs(cps - lastCps) < 1e-9)

    const hasCycle = typeof cycle === 'number' && isFinite(cycle)
    let phaseDrift = 0
    let needPhaseRealign = false
    if (phaseSyncEnabled !== false && hasCycle) {
      if (lastModel && typeof lastModel.freq === 'number' && typeof lastModel.timeSec === 'number' && typeof lastModel.count === 'number') {
        const predicted = lastModel.count + (msgTimeSec - lastModel.timeSec) * lastModel.freq
        phaseDrift = predicted - cycle
        // Wrap to [-0.5, 0.5)
        phaseDrift = ((phaseDrift % 1) + 1) % 1
        if (phaseDrift > 0.5) phaseDrift -= 1
        needPhaseRealign = Math.abs(phaseDrift) > phaseTolerance
      } else {
        // No previous model; perform initial alignment
        needPhaseRealign = true
      }
    }

    return { shouldUpdate: (cpsChanged || needPhaseRealign), hasCycle, phaseDrift }
  }

  /**
   * Attempts to apply one of the candidate tempo formats to Punctual.
   * Tries each candidate in order until one succeeds. The first candidate is typically
   * the most precise format, with simpler fallbacks following.
   * @param {Object} punctual - The Punctual instance to update
   * @param {Array<Object>} candidates - Array of candidate tempo objects to try
   * @returns {Object} Result object with 'applied' (boolean) and 'lastErr' (Error or null)
   */
  tryApplyTempo(punctual, candidates) {
    let lastErr = null
    for (const ft of candidates) {
      try {
        punctual.setTempo(ft)
        return { applied: true, lastErr: null }
      } catch (e) {
        lastErr = e
      }
    }
    return { applied: false, lastErr }
  }

  /**
   * Handles a /dirt/play event from Tidal and updates Punctual's tempo if necessary.
   * This is the main entry point for tempo synchronization. It extracts CPS and cycle
   * information, determines if an update is needed (tempo change or phase drift),
   * applies phase lead compensation if configured, and updates Punctual's tempo.
   * Only updates when the tempo has changed significantly or phase drift exceeds tolerance.
   * @param {Object} evt - The /dirt/play event object containing cps, cycle, and other parameters
   * @param {*} timeTag - OSC timetag from the event
   * @param {Object} punctual - The Punctual instance to synchronize
   * @param {Function} [log] - Optional logging function that accepts (message, cssClass) parameters
   */
  onDirtPlay(evt, timeTag, punctual, log = () => {}) {
    try {
      if (!evt) return
      const cps = evt.cps
      if (!(punctual && typeof cps === 'number' && isFinite(cps) && cps > 0)) return

      const cycle = evt.cycle
      const msgTimeSec = this.timeTagToPosixSeconds(timeTag) || this.nowPosixSeconds()

      // Read configuration
      const baseKey = 'pulsar-punctual.sonicLink'
      const phaseSyncEnabled = (typeof atom !== 'undefined' && atom.config) ? atom.config.get(`${baseKey}.phaseSyncEnabled`) : true
      const phaseTolerance = Number((typeof atom !== 'undefined' && atom.config) ? (atom.config.get(`${baseKey}.phaseTolerance`) || 1/64) : 1/64)

      const { shouldUpdate, hasCycle, phaseDrift } = this.computeUpdateDecision(cps, cycle, msgTimeSec, phaseSyncEnabled, phaseTolerance)
      if (!shouldUpdate) return

      // Single knob: phase lead in cycles (can be fractional, positive or negative)
      const rawLead = Number((typeof atom !== 'undefined' && atom.config)
        ? (atom.config.get(`${baseKey}.phaseLeadCycles`) ?? 0)
        : 0)
      let leadCycles = isFinite(rawLead) ? rawLead : 0
      // Normalize to [-0.5, 0.5) to keep user values sane if they exceed one cycle
      leadCycles = ((leadCycles % 1) + 1) % 1; if (leadCycles > 0.5) leadCycles -= 1

      const effectiveCycle = (hasCycle ? (cycle + leadCycles) : undefined)

      const candidates = this.buildForeignTempoCandidates(cps, effectiveCycle, msgTimeSec)
      const { applied, lastErr } = this.tryApplyTempo(punctual, candidates)

      if (applied) {
        this._lastCpsApplied = cps
        // Record model only if we had cycle info
        if (hasCycle) {
          // Store adjusted cycle so predictions line up with what we sent
          this._tempoModel = { freq: cps, timeSec: msgTimeSec, count: effectiveCycle }
        } else {
          const prevCount = (this._tempoModel && typeof this._tempoModel.count === 'number') ? this._tempoModel.count : 0
          this._tempoModel = { freq: cps, timeSec: msgTimeSec, count: prevCount }
        }
        const leadTxt = (hasCycle && Math.abs(leadCycles) > 0)
          ? ` (lead ${leadCycles >= 0 ? '+' : ''}${leadCycles.toFixed(4)} cyc)` : ''
        const msg = (phaseSyncEnabled !== false && hasCycle && Math.abs(phaseDrift) > phaseTolerance)
          ? `CPS ${cps.toFixed(3)} set; phase realigned (|Δ|=${Math.abs(phaseDrift).toFixed(4)} cycles)${leadTxt}`
          : `CPS set to ${cps.toFixed(3)} from Tidal${leadTxt}`
        log(msg, 'text-info')
      } else {
        log('Failed to set CPS: ' + (lastErr && lastErr.message ? lastErr.message : lastErr), 'text-error')
      }
    } catch (e) {
      log('Failed to set CPS: ' + (e && e.message ? e.message : e), 'text-error')
    }
  }
}
