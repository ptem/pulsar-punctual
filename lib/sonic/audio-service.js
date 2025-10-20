"use babel"

/**
 * @file audio-service.js
 * Web Audio context manager for Punctual.
 * Handles worklets (Electron-friendly), master volume, panic.
 */

const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

/**
 * Manages Web Audio context/routing.
 * Loads worklets (Electron-safe), controls master gain, provides panic.
 */
export default class AudioService {
  /**
   * Creates a new AudioService.
   * @param {Function} [log] - Optional logging function that takes (message, cssClass) parameters
   */
  constructor(log = () => {}) {
    this.log = (msg, cls) => { try { log(msg, cls) } catch (_) {} }
    this.audioContext = null
    this.masterGainNode = null
    this.workletFiles = []
    this._workletDir = path.join(__dirname, 'worklets')
    this._originalConsoleError = null
    this._originalCreateObjectURL = null
    this._originalAddModule = null
    this._patched = false
  }

  /**
   * Gets the current AudioContext instance.
   * @returns {AudioContext|null} The AudioContext, or null if it's not set up yet
   */
  getContext() {
    return this.audioContext
  }

  /**
   * Gets the current state of the AudioContext.
   * @returns {string} The state: 'suspended', 'running', 'closed', or 'none' if it's not set up yet
   */
  getState() {
    return this.audioContext ? this.audioContext.state : 'none'
  }

  /**
   * Starts the audio service by creating an AudioContext and setting up audio worklet support.
   * This creates a Web Audio API context with optimized settings, sets up a master
   * gain node for volume control, and applies patches to make audio worklet loading work in Electron.
   * The patches intercept blob URLs and convert them to file:// URLs that Electron can handle.
   * @async
   * @returns {Promise<void>}
   */
  async start() {
    if (this.audioContext) return

    // ensure worklet dir and purge any stale worklet files from previous sessions
    try {
      if (!fs.existsSync(this._workletDir)) {
        fs.mkdirSync(this._workletDir, { recursive: true })
      }
      // Clean leftover worklet-*.js files that may remain after crashes or hard exits
      try {
        const entries = fs.readdirSync(this._workletDir)
        for (const name of entries) {
          if (/^worklet-\d+\.js$/.test(name)) {
            try { fs.unlinkSync(path.join(this._workletDir, name)) } catch (_) {}
          }
        }
      } catch (_) {}
      // reset tracking array at start
      this.workletFiles = []
    } catch (e) {
      this.log('Could not create worklet directory: ' + e.message, 'text-error')
    }

    // Web Audio context
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'playback',
      sampleRate: 48000
    })

    this.log('Audio context created (state: ' + this.audioContext.state + ', sampleRate: ' + this.audioContext.sampleRate + ')', 'text-info')

    this.masterGainNode = this.audioContext.createGain()
    const masterVolume = atom.config.get('pulsar-punctual.masterVolume') || 70
    this.masterGainNode.gain.value = masterVolume / 100.0
    this.masterGainNode.connect(this.audioContext.destination)
    this.log('Master volume: ' + masterVolume + '%', 'text-info')

    if (!this._patched) {
      this._originalConsoleError = console.error

      // capture AudioWorklet blobs via URL.createObjectURL
      this._originalCreateObjectURL = URL.createObjectURL.bind(URL)
      let workletCounter = 0
      URL.createObjectURL = (obj) => {
        if (obj instanceof Blob && obj.type === 'text/javascript') {
          const id = `worklet-${workletCounter++}`
          const filePath = path.join(this._workletDir, `${id}.js`)
          obj.text().then(text => {
            try {
              const polyfill = '// Electron worker context polyfill\nif (typeof self === "undefined") { globalThis.self = globalThis; }\n\n'
              fs.writeFileSync(filePath, polyfill + text, 'utf8')
              this.workletFiles.push(filePath)
            } catch (e) {
              this._originalConsoleError('Failed to write worklet file:', e)
            }
          }).catch(e => {
            this._originalConsoleError('Failed to read blob:', e)
          })
          return `blob:punctual-file://${id}`
        }
        return this._originalCreateObjectURL(obj)
      }

      // load audioWorklet modules from file://
      const originalAddModule = this.audioContext.audioWorklet.addModule.bind(this.audioContext.audioWorklet)
      this._originalAddModule = originalAddModule
      this.audioContext.audioWorklet.addModule = async (url, options) => {
        try {
          if (typeof url === 'string' && url.startsWith('blob:punctual-file://')) {
            const id = url.replace('blob:punctual-file://', '')
            const filePath = path.join(this._workletDir, `${id}.js`)
            await new Promise(resolve => setTimeout(resolve, 100))
            const fileUrl = pathToFileURL(filePath).href
            const result = await this._originalAddModule(fileUrl, options)
            return result
          }
          return this._originalAddModule(url, options)
        } catch (e) {
          this.log('[AudioService] addModule FAILED: ' + e.message, 'text-error')
          throw e
        }
      }

      this._patched = true
    }
  }

  /**
   * Connects a Punctual instance to this audio service's master gain node.
   * Routes Punctual's audio output through the master volume control.
   * @param {Object} punctual - The Punctual instance to connect
   */
  connectPunctual(punctual) {
    if (!punctual || !this.masterGainNode) return
    if (typeof punctual.setAudioOutput === 'function') {
      punctual.setAudioOutput(this.masterGainNode)
      this.log('Audio routed through master volume control', 'text-info')
    }
  }

  /**
   * Resumes the AudioContext if it's suspended.
   * Usually needed after you interact with the page due to browser autoplay policies.
   * @async
   * @returns {Promise<boolean>} True if the context was resumed, false if it wasn't suspended
   */
  async resumeIfSuspended() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
      return true
    }
    return false
  }

  /**
   * Sets the master volume level.
   * The volume gets clamped to 0-100 and saved to Atom's configuration.
   * @param {number} volume - Volume level from 0 (silent) to 100 (full volume)
   */
  setMasterVolume(volume) {
    if (!this.masterGainNode) {
      this.log('Master volume control not initialized', 'text-warning')
      return
    }
    const clampedVolume = Math.max(0, Math.min(100, volume))
    this.masterGainNode.gain.value = clampedVolume / 100.0
    atom.config.set('pulsar-punctual.masterVolume', clampedVolume)
    this.log('Master volume: ' + clampedVolume + '%', 'text-info')
  }

  /**
   * Bumps up the master volume by 5%.
   * The new volume automatically maxes out at 100%.
   */
  increaseMasterVolume() {
    const currentVolume = atom.config.get('pulsar-punctual.masterVolume')
    const volume = (currentVolume !== null && currentVolume !== undefined) ? currentVolume : 70
    this.setMasterVolume(volume + 5)
  }

  /**
   * Decreases the master volume by 5%.
   * The new volume is automatically clamped to a minimum of 0%.
   */
  decreaseMasterVolume() {
    const currentVolume = atom.config.get('pulsar-punctual.masterVolume')
    const volume = (currentVolume !== null && currentVolume !== undefined) ? currentVolume : 70
    this.setMasterVolume(volume - 5)
  }

  /**
   * Gets the current master volume level from configuration.
   * @returns {number} Volume level from 0 to 100, defaults to 70 if not set
   */
  getMasterVolume() {
    return atom.config.get('pulsar-punctual.masterVolume') || 70
  }

  /**
   * Emergency audio stop (panic button) that immediately mutes all audio.
   * This instantly sets the master volume to 0, optionally evaluates a silent Punctual expression,
   * and automatically restores the previous volume level after 3 seconds.
   * @async
   * @param {Function} [evaluateFn] - Optional function to evaluate a Punctual expression for complete silence
   * @returns {Promise<void>}
   */
  async panic(evaluateFn) {
    if (this.masterGainNode) {
      this.masterGainNode.gain.value = 0
    }
    if (typeof evaluateFn === 'function') {
      try { await evaluateFn('0 >> audio;') } catch (_) {}
    }

    // Restore master volume after a few seconds
    setTimeout(() => {
      if (this.masterGainNode) {
        const masterVolume = atom.config.get('pulsar-punctual.masterVolume') || 70
        this.masterGainNode.gain.value = masterVolume / 100.0
        this.log('Master volume restored to ' + masterVolume + '%', 'text-info')
      }
    }, 3000)
  }

  /**
   * Stops the audio service and cleans up all resources.
   * This method restores patched functions, closes the AudioContext, disconnects the master gain node,
   * and deletes temporary worklet files from disk.
   */
  async stop() {
    if (this._patched) {
      try { if (this._originalCreateObjectURL) URL.createObjectURL = this._originalCreateObjectURL } catch (_) {}
      try { if (this.audioContext && this._originalAddModule) this.audioContext.audioWorklet.addModule = this._originalAddModule } catch (_) {}
      try { if (this._originalConsoleError) console.error = this._originalConsoleError } catch (_) {}
      this._patched = false
    }

    // Close audio context (await to ensure worklet processors are torn down)
    if (this.audioContext) {
      try { if (this.audioContext.state !== 'closed') await this.audioContext.close() } catch (_) {}
      this.audioContext = null
    }

    // Disconnect master gain
    if (this.masterGainNode) {
      try { this.masterGainNode.disconnect() } catch (_) {}
      this.masterGainNode = null
    }

    // Clean up temp worklet files from this session
    if (this.workletFiles && this.workletFiles.length > 0) {
      for (const filePath of this.workletFiles) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) } catch (_) {}
      }
      this.workletFiles = []
    }

    // Also remove any stale worklet-*.js files that may have been left behind
    try {
      if (fs.existsSync(this._workletDir)) {
        const entries = fs.readdirSync(this._workletDir)
        for (const name of entries) {
          if (/^worklet-\d+\.js$/.test(name)) {
            try { fs.unlinkSync(path.join(this._workletDir, name)) } catch (_) {}
          }
        }
      }
    } catch (_) {}
  }
}
