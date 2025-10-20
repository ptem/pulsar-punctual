'use babel'

/**
 * @file osc-service.js
 * UDP OSC listener/dispatcher.
 * Special-cases /dirt/play, with optional debug logs and hooks.
 */

const osc = require('osc')

/**
 * OSC over UDP service.
 * Listens for messages/bundles; routes /dirt/play; preserves timetags; optional debug.
 */
export default class OscService {
  /**
   * Creates a new OscService instance.
   * @param {Object} [options] - Configuration options
   * @param {string} [options.host='127.0.0.1'] - The local IP address to bind to
   * @param {number} [options.port=57121] - The UDP port to listen on
   * @param {boolean} [options.debug=false] - Enable verbose debug logging
   * @param {Function} [logFn=console.log] - Logging function that accepts (message, cssClass) parameters
   * @param {Object} [hooks={}] - Event hooks for downstream processing (e.g., onDirtPlay)
   */
  constructor({ host = '127.0.0.1', port = 57121, debug = false } = {}, logFn = console.log, hooks = {}) {
    this.host = host
    this.port = port
    this.debug = debug
    this.log = (msg, cls) => {
      try { logFn(msg, cls) } catch (_) { /* no-op */ }
    }
    this.hooks = hooks || {}
    this.udpPort = null
    this._count = 0
    this._lastHeaderErrAt = 0
  }

  /**
   * Checks if debug logging is currently enabled.
   * Debug mode can be enabled either through the constructor parameter or Atom's configuration.
   * @returns {boolean} True if debug logging is enabled, false otherwise
   */
  isDebugEnabled() {
    try {
      const cfg = (typeof atom !== 'undefined' && atom.config) ? atom.config.get('pulsar-punctual.sonicLink.debug') : false
      return !!this.debug || !!cfg
    } catch (_) {
      return !!this.debug
    }
  }

  /**
   * Starts the OSC service and begins listening for incoming messages.
   * This method creates a UDP port, sets up event listeners for messages, bundles, errors,
   * and handles special processing for /dirt/play events with hooks. Debug logging can be
   * enabled to see all incoming OSC traffic.
   */
  start() {
    if (this.udpPort) return
    try {
      this.udpPort = new osc.UDPPort({
        localAddress: this.host,
        localPort: this.port,
        metadata: true
      })

      this.udpPort.on('ready', () => {
        this.log(`OSC listening on ${this.host}:${this.port}`, 'text-info')
      })

      this.udpPort.on('message', (msg, timeTag, info) => {
        try {
          this._count++
          const args = (msg && msg.args) || []
          const unwrap = (a) => (a && typeof a === 'object' && 'value' in a) ? a.value : a
          const parts = args.map(unwrap)
          const addr = (msg && msg.address) ? msg.address : '(no address)'
          const nowMs = Date.now()
          const nowIso = new Date(nowMs).toISOString()
          const ttStr = (() => {
            if (!timeTag) return ''
            try { return typeof timeTag === 'string' ? timeTag : JSON.stringify(timeTag) } catch (_) { return String(timeTag) }
          })()
          // route dirt/play to bridge (keep timetag)
          if (addr === '/dirt/play' && this.hooks && typeof this.hooks.onDirtPlay === 'function') {
            try {
              const kvToObj = (xs) => {
                const out = Object.create(null)
                for (let i = 0; i + 1 < xs.length; i += 2) {
                  const k = String(unwrap(xs[i]))
                  const v = unwrap(xs[i + 1])
                  if (k) out[k] = v
                }
                return out
              }
              const evt = kvToObj(args)
              this.hooks.onDirtPlay(evt, timeTag)
            } catch (e) {
              this.log(`Dirt parse error: ${e?.message || e}`, 'text-error')
            }
          }
          if (this.isDebugEnabled()) {
            const line = `[${this._count}] ${addr}${parts.length ? ' ' + JSON.stringify(parts) : ''}  t:${nowIso}${ttStr ? ` ttag:${ttStr}` : ''}`
            this.log(line, 'text-muted')
          } else {
            // skip noisy /dirt/play unless debug
            if (addr !== '/dirt/play') {
              this.log(`recv ${addr} (t ${nowIso.slice(11,23)})`, 'text-info')
            }
          }
        } catch (e) {
          this.log(`OSC message error: ${e?.message || e}`, 'text-error')
        }
      })

      // Also handle OSC bundles to capture timetags and multiple messages
      this.udpPort.on('bundle', (bundle, timeTag, info) => {
        try {
          const btag = timeTag || (bundle && bundle.timeTag)
          const packets = (bundle && bundle.packets) || []
          const nowIso = new Date(Date.now()).toISOString()
          if (this.isDebugEnabled()) {
            const btagStr = (() => { try { return btag ? (typeof btag === 'string' ? btag : JSON.stringify(btag)) : '' } catch (_) { return String(btag) } })()
            this.log(`[bundle] count:${packets.length} t:${nowIso}${btagStr ? ` ttag:${btagStr}` : ''}`, 'text-muted')
          }
          // Iterate through bundle packets and log each message similarly
          for (const pkt of packets) {
            if (!pkt || typeof pkt.address !== 'string') continue
            try {
              this._count++
              const args = pkt.args || []
              const unwrap = (a) => (a && typeof a === 'object' && 'value' in a) ? a.value : a
              const parts = args.map(unwrap)
              const addr = pkt.address

              // Hook dirt/play in bundles with preserved bundle timetag
              if (addr === '/dirt/play' && this.hooks && typeof this.hooks.onDirtPlay === 'function') {
                try {
                  const kvToObj = (xs) => {
                    const out = Object.create(null)
                    for (let i = 0; i + 1 < xs.length; i += 2) {
                      const k = String(unwrap(xs[i]))
                      const v = unwrap(xs[i + 1])
                      if (k) out[k] = v
                    }
                    return out
                  }
                  const evt = kvToObj(args)
                  this.hooks.onDirtPlay(evt, btag)
                } catch (e) {
                  this.log(`Dirt bundle parse error: ${e?.message || e}`, 'text-error')
                }
              }

              if (this.isDebugEnabled()) {
                this.log(`[${this._count}] ${addr}${parts.length ? ' ' + JSON.stringify(parts) : ''}`, 'text-muted')
              } else {
                // skip noisy /dirt/play unless debug
                if (addr !== '/dirt/play') {
                  this.log(`recv ${addr}`, 'text-info')
                }
              }
            } catch (e) {
              this.log(`OSC bundle message error: ${e?.message || e}`, 'text-error')
            }
          }
        } catch (e) {
          this.log(`OSC bundle error: ${e?.message || e}`, 'text-error')
        }
      })

      this.udpPort.on('error', (e) => {
        const msg = (e && e.message) ? e.message : String(e)
        if (/header of an OSC packet|must begin with/i.test(msg)) {
          const now = Date.now()
          if (!this._lastHeaderErrAt || now - this._lastHeaderErrAt > 2000) {
            this._lastHeaderErrAt = now
            const dbg = this.isDebugEnabled()
            const note = dbg ? ' (non-OSC datagram)' : ''
            this.log(`OSC warning: ${msg}${note}. If you are forwarding timing, be sure to use sendBundle(time, [msg]) in SuperCollider and target the correct port.`, dbg ? 'text-muted' : 'text-info')
          }
        } else {
          this.log(`OSC error: ${msg}`, 'text-error')
        }
      })

      this.udpPort.on('close', () => {
        this.log('OSC socket closed', 'text-info')
      })

      this.udpPort.open()
    } catch (e) {
      this.log(`Failed to open OSC: ${e?.message || e}`, 'text-error')
    }
  }

  /**
   * Stops the OSC service and closes the UDP port.
   * This method removes all event listeners and cleanly closes the UDP connection.
   */
  stop() {
    if (!this.udpPort) return
    try {
      this.udpPort.removeAllListeners()
      this.udpPort.close()
    } catch (_) { /* ignore */ }
    this.udpPort = null
  }

  /**
   * Restarts the OSC service with optionally updated configuration.
   * This is useful for applying new settings (host, port, debug mode) without
   * creating a new service instance.
   * @param {Object} [opts={}] - Configuration options to update (same as constructor options)
   */
  restart(opts = {}) {
    Object.assign(this, opts)
    this.stop()
    this.start()
  }
}
