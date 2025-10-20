'use babel'

/**
 * @file main.js
 * Central controller for Punctual.
 * Wires up code eval, audio, OSC, and the editor.
 */

import { CONSOLE_URI } from './console-view.js'
import OscService from './sonic/osc-service.js'
import DirtBridge from './sonic/dirt-bridge.js'
import TempoSync from './sonic/tempo-sync.js'
import AudioService from './sonic/audio-service.js'
const loop = require('raf-loop')
const path = require('path')

/**
 * Main class for the Pulsar Punctual package.
 * This is the heart of the system - it coordinates Punctual's visual rendering,
 * audio output, OSC communication, code evaluation, and editor integration.
 */
export default class Main {

  /**
   * Creates a new Main instance.
   * Sets up all the subsystems (audio, tempo sync, console) with their starting values.
   */
  constructor() {
    this.punctual = null
    this.punctualModule = null
    this.canvas = null
    this.console = null
    this.animationLoop = null
    this.oscService = null
    this.dirt = null
    this.tempoSync = new TempoSync()
    this.audio = new AudioService((msg, cls) => this.log(msg, cls))
    
    window.log = this.log.bind(this)
  }

  /**
   * Evaluates Punctual code.
   * Wakes up the audio context if it's sleeping, runs the code in Punctual, and logs what happens.
   * 
   * @private
   * @param {string} code - The Punctual code to evaluate
   * @returns {Promise<void>}
   */
  async _eval(code) {
    if (!this.punctual) {
      this.log('Punctual not initialized', 'text-error')
      return
    }
    
    // resume audio if suspended (autoplay policy)
    if (this.audio) {
      try {
        const resumed = await this.audio.resumeIfSuspended()
        if (resumed) {
          this.log('Audio context resumed (state: ' + this.audio.getState() + ')', 'text-info')
        }
      } catch (e) {
        this.log('Could not resume audio context: ' + e.message, 'text-warning')
      }
    }
    
    // Log audio context state if evaluating audio code
    if (this.audio && code.includes('>> audio')) {
      this.log('Evaluating audio code (context state: ' + this.audio.getState() + ')', 'text-info')
    }
    
    try {
      const now = Date.now() / 1000.0
      const result = await this.punctual.define({zone: 0, text: code, time: now})
      
      this.punctual.preRender({canDraw: true, nowTime: now})
      this.punctual.render({canDraw: true, zone: 0, nowTime: now})
      this.punctual.postRender({canDraw: true, nowTime: now})
      
      if (result && result.info) {
        this.log(result.info, 'text-success')
      } else {
        this.log(code, 'text-muted')
      }
    } catch (e) {
      const errorMessage = e.toString ? e.toString() : e.message || 'Unknown error'
      this.log(errorMessage, 'text-error')
    }
  }

  /**
   * Logs a message to the Punctual console with optional CSS styling.
   * Uses the browser console as a fallback if the Punctual console isn't ready yet.
   * 
   * @param {*} msg - The message to log
   * @param {string} [_class] - Optional CSS class for styling (e.g., 'text-error', 'text-success', 'text-info')
   */
  log(msg, _class) {
    try {
      if (this.console && typeof this.console.addMessage === 'function') {
        this.console.addMessage(msg, _class)
      } else {
        console.log('[Punctual]', msg)
      }
    } catch (e) {
      console.error('Punctual log error:', e, msg)
    }
  }

  /**
   * Makes sure Punctual is running before we try to evaluate code in a .punc file.
   * Auto-starts Punctual if you're working on a Punctual file.
   * 
   * @param {Object} editor - The Atom TextEditor instance
   * @returns {Promise<void>}
   */
  async ensureStartedForEditor(editor) {
    if (this.punctual) return
    try {
      const filePath = editor && typeof editor.getPath === 'function' ? editor.getPath() : null
      const grammar = editor && typeof editor.getGrammar === 'function' ? editor.getGrammar() : null
      const gName = grammar ? (grammar.name || grammar.scopeName || '').toLowerCase() : ''
      const isPunc = (filePath && /\.punc$/i.test(filePath)) || (gName.includes('punctual') || gName.includes('punc'))
      if (!isPunc) return
      const pkg = atom.packages.getActivePackage && atom.packages.getActivePackage('pulsar-punctual')
      const mod = pkg && pkg.mainModule
      if (mod) {
        if (mod.main && typeof mod.main.start === 'function') {
          await mod.main.start()
        } else if (typeof this.start === 'function') {
          await this.start()
        }
      } else if (typeof this.start === 'function') {
        await this.start()
      }
    } catch (e) {
      console.error('Auto-start Punctual failed:', e)
    }
  }

  /**
   * Evaluates the current paragraph/block of code in the active editor.
   * A block is just consecutive non-empty lines around your cursor.
   * Gives you a visual flash and makes sure Punctual is running.
   * 
   * @returns {Promise<void>}
   */
  async evalBlock() {
    let editor
    if (editor = atom.workspace.getActiveTextEditor()) {
      var range = this.getCurrentParagraphIncludingComments(editor);
      this.evalFlash(range)
      var expression = editor.getTextInBufferRange(range);
      await this.ensureStartedForEditor(editor)
      this._eval(expression)
    }
  }

  /**
   * Evaluates all the code in the active editor.
   * Gives you a flash and makes sure Punctual is running.
   * 
   * @returns {Promise<void>}
   */
  async evalCode() {
    let editor
    if (editor = atom.workspace.getActiveTextEditor()) {
      const range = {
        start: { row: 0, column: 0 },
        end: { row: editor.getLastScreenRow() + 1, column: 0 }
      }
      this.evalFlash(range);
      await this.ensureStartedForEditor(editor)
      this._eval(editor.getText());
    }
  }

  /**
   * Figures out the buffer range of the current paragraph/block including comments.
   * 
   * @param {Object} editor - The Atom TextEditor instance
   * @returns {{start: {row: number, column: number}, end: {row: number, column: number}}} Buffer range object
   */
  getCurrentParagraphIncludingComments(editor) {
    var cursor = editor.getLastCursor();
    var endRow = cursor.getBufferRow();
    var startRow = endRow;
    var lineCount = editor.getLineCount();

    while (/\S/.test(editor.lineTextForBufferRow(startRow)) && startRow >= 0) {
        startRow--;
    }
    while (/\S/.test(editor.lineTextForBufferRow(endRow)) && endRow < lineCount) {
        endRow++;
    }
    return {
        start: {
            row: startRow + 1,
            column: 0
        },
        end: {
            row: endRow,
            column: 0
        },
    };
  }

  /**
   * Gives you a visual flash when code is evaluated.
   * Temporarily highlights the evaluated code with the 'punctual-flash' CSS class.
   * 
   * @param {{start: {row: number, column: number}, end: {row: number, column: number}}} range - Buffer range to flash
   */
  evalFlash(range) {
    let editor
    if (editor = atom.workspace.getActiveTextEditor()) {
      var marker = editor.markBufferRange(range, {
          invalidate: 'touch'
      });

      var decoration = editor.decorateMarker(
          marker, {
              type: 'line',
              class: 'punctual-flash'
          });
      
      setTimeout(() => {
        if (marker && typeof marker.destroy === 'function') {
          marker.destroy();
        }
      }, 120);
    }
  }

  /**
   * Evaluates the current line or selection in the active editor.
   * If you have something selected, it evaluates that; otherwise it evaluates the whole line.
   * Gives you a visual flash and makes sure Punctual is running.
   * 
   * @returns {Promise<void>}
   */
  async evalLine () {
    let editor
    if (editor = atom.workspace.getActiveTextEditor()) {
      var range
      let selection = editor.getSelectedText()
      range = editor.getSelectedBufferRange()
      // evaluate selection, if selection is less than 1, evaluate entire line
      if(selection.length < 1){
        let pt = editor.getCursorBufferPosition()
        selection = editor.lineTextForBufferRow(pt.row)
        range ={ start: pt, end: pt }
      }
      await this.ensureStartedForEditor(editor)
      this._eval(selection)
      this.evalFlash(range)
    }
  }

  /**
   * Starts the Punctual system.
   * Sets up the console, canvas, Punctual engine, audio services, animation loop,
   * and OSC communication. Keeps your editor focused the whole time.
   * 
   * @returns {Promise<void>}
   */
  async start() {
    const prevEditor = atom.workspace.getActiveTextEditor()
    const prevCursorPos = prevEditor ? prevEditor.getCursorBufferPosition() : null

    this.console = await atom.workspace.open(CONSOLE_URI, { searchAllPanes: true, activatePane: false, activateItem: false })

    try {
      const docks = [atom.workspace.getLeftDock && atom.workspace.getLeftDock(), atom.workspace.getRightDock && atom.workspace.getRightDock(), atom.workspace.getBottomDock && atom.workspace.getBottomDock()].filter(Boolean)
      for (const dock of docks) {
        const panes = typeof dock.getPanes === 'function' ? dock.getPanes() : []
        let found = false
        for (const p of panes) {
          if (typeof p.getItems === 'function' && p.getItems().includes(this.console)) {
            found = true
            break
          }
        }
        if (found && typeof dock.isVisible === 'function' && typeof dock.show === 'function' && !dock.isVisible()) {
          dock.show()
          break
        }
      }
    } catch (e) {
      console.warn('Could not ensure console dock visibility:', e)
    }

    this.canvas = document.createElement('canvas')
    this.canvas.classList.add('punctual-canvas')
    this.canvas.id = 'canvas'
    Object.assign(this.canvas.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      zIndex: '-1',
      pointerEvents: 'none'
    })
    
    document.body.classList.add('punctual-enabled')
    
    document.body.appendChild(this.canvas)

    try {
      this.log('Initializing Punctual...', 'text-info')
      
      const { pathToFileURL } = require('url')
      const loaderPath = path.join(__dirname, 'punctual-loader.js')
      const loaderUrl = pathToFileURL(loaderPath).href
      
      await new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.type = 'module'
        script.src = loaderUrl
        script.onload = resolve
        script.onerror = reject
        document.head.appendChild(script)
      })
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      if (!window.__PunctualModule) {
        throw new Error('Punctual module failed to load into window context')
      }
      
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

      await this.audio.start()
    
      const webAudioContext = this.audio && this.audio.getContext ? this.audio.getContext() : null
      this.punctual = new window.__PunctualModule.Punctual({
        webAudioContext
      })

      // Route Punctual's audio through the audio service
      if (this.audio) {
        try { this.audio.connectPunctual(this.punctual) } catch (_) {}
      }
      
      var self = this
      this.animationLoop = loop(function(dt) {
        const now = Date.now() / 1000.0
        if (self.punctual) {
          try {
            self.punctual.preRender({canDraw: true, nowTime: now})
            self.punctual.render({canDraw: true, zone: 0, nowTime: now})
            self.punctual.postRender({canDraw: true, nowTime: now})
          } catch (e) {
            console.error('Render loop error:', e)
            self.animationLoop.stop()
          }
        }
      }).start()

      this.log('Punctual started!', 'text-success')

      // Start UDP OSC service (SuperCollider/Tidal) if enabled
      try {
        const base = 'pulsar-punctual.sonicLink'
        const enabled = atom.config.get(`${base}.enabled`)
        const host = atom.config.get(`${base}.host`) || '127.0.0.1'
        const port = atom.config.get(`${base}.port`) || 57121
        const debug = !!atom.config.get(`${base}.debug`)
        if (enabled !== false) {
          // Initialize Dirt bridge state
          this.dirt = new DirtBridge((msg, cls) => this.log(msg, cls))

          // Start OSC service with a hook for /dirt/play that preserves OSC timetags
          this.oscService = new OscService(
            { host, port, debug },
            (msg, cls) => this.log(msg, cls),
            {
              onDirtPlay: (evt, timeTag) => {
                try { this.dirt && this.dirt.onDirtPlay(evt, timeTag) } catch (_) {}
                
                // Log all parameters when debug is enabled
                const debug = !!atom.config.get('pulsar-punctual.sonicLink.debug')
                if (debug && evt) {
                  const params = Object.keys(evt).filter(k => k !== 's').map(k => k + '=' + evt[k]).join(', ')
                  if (params) {
                    this.log('OSC params: ' + params, 'text-muted')
                  }
                }
                
                const ts = this.tempoSync
                if (ts) ts.onDirtPlay(evt, timeTag, this.punctual, (msg, cls) => this.log(msg, cls))
              }
            }
          )
          this.oscService.start()
        }
      } catch (e) {
        this.log('Could not start OSC service: ' + (e?.message || e), 'text-error')
      }

      try {
        const pkg = atom.packages.getActivePackage && atom.packages.getActivePackage('pulsar-punctual')
        const mod = pkg && pkg.mainModule
        if (mod) mod.isActive = true
      } catch (_) {}

      // Don't focus the console. Please. Pulsar. Please.
      if (prevEditor) {
        const view = atom.views.getView(prevEditor)
        if (view && typeof view.focus === 'function') view.focus()
        if (prevCursorPos) prevEditor.setCursorBufferPosition(prevCursorPos)
      }
      
    } catch (e) {
      console.error('Failed to initialize Punctual:', e)
      this.log('Failed to initialize Punctual: ' + e.message, 'text-error')
    }
  }

  /**
   * Stops the Punctual system and cleans up everything.
   * Shuts down OSC service, animation loop, audio services, removes the canvas,
   * and brings back the UI.
   */
  async stop() {
    this.toggleVisibility(false)
    
    if (this.oscService) {
      try { this.oscService.stop() } catch (_) {}
      this.oscService = null
    }

    this.dirt = null
    
    if (this.animationLoop) {
      this.animationLoop.stop()
      this.animationLoop = null
    }

    
    if (this.punctual) {
      this.punctual = null
    }
    
    if (this.punctualModule) {
      this.punctualModule = null
    }
    
    if (this.audio) {
      try { await this.audio.stop() } catch (_) {}
    }
    
    document.body.classList.remove('punctual-enabled')
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
    
    this.canvas = null
    this.log('Punctual disabled.', 'text-info')

    try {
      const pkg = atom.packages.getActivePackage && atom.packages.getActivePackage('pulsar-punctual')
      const mod = pkg && pkg.mainModule
      if (mod) mod.isActive = false
    } catch (_) {}
  }

  /**
   * Toggles visibility of Atom/Pulsar UI panels (horizontal panels and footer).
   * Creates a distraction-free fullscreen experience when Punctual is running.
   * 
   * @param {boolean} [hide=true] - Whether to hide (true) or show (false) the panels
   */
  toggleVisibility(hide = true) {

    if (atom.packages.isPackageActive('pulsar-punctual')) {
      const panels = atom.workspace.element.getElementsByClassName('horizontal')[0]
      const footer = atom.workspace.element.getElementsByClassName('footer')[0]

      if (panels && footer &&
          panels.style.visibility !== 'hidden' &&
          footer.style.visibility !== 'hidden' &&
          hide) {
        panels.style.visibility = 'hidden'
        footer.style.visibility = 'hidden'
      } else {
        if (panels) panels.style.visibility = ''
        if (footer) footer.style.visibility = ''
      }
    }
  }

  /**
   * Sets the master volume for Punctual's audio output.
   * 
   * @param {number} volume - The volume level (typically 0-100)
   */
  setMasterVolume(volume) {
    if (!this.audio) {
      this.log('Audio service not initialized', 'text-warning')
      return
    }
    this.audio.setMasterVolume(volume)
  }

  /**
   * Bumps up the master volume by 5 units.
   * Uses AudioService if it's available, otherwise updates the config directly.
   */
  increaseMasterVolume() {
    if (this.audio && typeof this.audio.increaseMasterVolume === 'function') {
      this.audio.increaseMasterVolume()
    } else {
      const currentVolume = atom.config.get('pulsar-punctual.masterVolume')
      const volume = (currentVolume !== null && currentVolume !== undefined) ? currentVolume : 70
      this.setMasterVolume(volume + 5)
    }
  }

  /**
   * Drops the master volume by 5 units.
   * Uses AudioService if it's available, otherwise updates the config directly.
   */
  decreaseMasterVolume() {
    if (this.audio && typeof this.audio.decreaseMasterVolume === 'function') {
      this.audio.decreaseMasterVolume()
    } else {
      const currentVolume = atom.config.get('pulsar-punctual.masterVolume')
      const volume = (currentVolume !== null && currentVolume !== undefined) ? currentVolume : 70
      this.setMasterVolume(volume - 5)
    }
  }

  /**
   * Gets the current master volume level.
   * 
   * @returns {number} The current volume level (0-100)
   */
  getMasterVolume() {
    if (this.audio && typeof this.audio.getMasterVolume === 'function') {
      return this.audio.getMasterVolume()
    }
    return atom.config.get('pulsar-punctual.masterVolume') || 70
  }

  /**
   * Emergency audio silence function.
   * Kills all Punctual audio immediately by evaluating '0 >> audio;'.
   * 
   * @returns {Promise<void>}
   */
  async panic() {
    this.log('PANIC: Silencing all audio', 'text-warning')
    if (this.audio && typeof this.audio.panic === 'function') {
      await this.audio.panic(this._eval.bind(this))
    } else {
      try { await this._eval('0 >> audio;') } catch (_) {}
    }
  }

}
