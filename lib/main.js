'use babel'

import { CONSOLE_URI } from './console-view.js'
const loop = require('raf-loop')
const path = require('path')

export default class Main {

  constructor() {
    this.punctual = null
    this.punctualModule = null
    this.canvas = null
    this.console = null
    this.animationLoop = null
    
    window.log = this.log.bind(this)
  }

  async _eval(code) {
    if (!this.punctual) {
      this.log('Punctual not initialized', 'text-error')
      return
    }
    
    try {
      const now = Date.now() / 1000.0
      const result = await this.punctual.define({zone: 0, text: code, time: now})
      
      // Force immediate render after successful evaluation
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

  getCurrentParagraphIncludingComments(editor) {
    var cursor = editor.getLastCursor();
    var endRow = cursor.getBufferRow();
    var startRow = endRow;
    var lineCount = editor.getLineCount();

    // lines must include non-whitespace characters
    // and not be outside editor bounds
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

      const flashDuration = atom.config.get('pulsar-punctual.flashDuration') || 200
      setTimeout(() => {
          marker.destroy();
      }, flashDuration)
    }
  }

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

  async start() {
    // Preserve currently active editor and cursor before any UI changes
    const prevEditor = atom.workspace.getActiveTextEditor()
    const prevCursorPos = prevEditor ? prevEditor.getCursorBufferPosition() : null

    // Open (but do not focus) the Punctual Console tab
    this.console = await atom.workspace.open(CONSOLE_URI, { searchAllPanes: true, activatePane: false, activateItem: false })
    // Ensure its dock is visible without stealing the editor focus
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

    
      this.punctual = new window.__PunctualModule.Punctual({
        webAudioContext: null
      })


      
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

      try {
        const pkg = atom.packages.getActivePackage && atom.packages.getActivePackage('pulsar-punctual')
        const mod = pkg && pkg.mainModule
        if (mod) mod.isActive = true
      } catch (_) {}

      // Restore focus and cursor to the previously active editor
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

  stop() {
    this.toggleVisibility(false)
    
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

}
