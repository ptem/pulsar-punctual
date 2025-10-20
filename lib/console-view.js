'use babel'

/**
 * @file console-view.js
 * Terminal-like console for Punctual inside Atom/Pulsar.
 * Shows messages/errors; supports collapse, select, clipboard.
 */

/** URI identifier for the console view in Atom/Pulsar workspace */
const CONSOLE_URI = 'atom://pulsar-punctual/console'
/** Maximum number of lines to keep in the console before we start trimming */
const MAX_LINES = 2000
/** How many lines to keep after trimming when we hit MAX_LINES */
const TRIM_TO = 1500

/**
 * ConsoleView gives Punctual a message console.
 * Shows messages with syntax highlighting, has collapsible output sections,
 * and works with Atom/Pulsar's clipboard and command system.
 */
export default class ConsoleView {
  /**
   * Creates a new ConsoleView.
   * Sets up the DOM elements, styles, and command bindings for the console.
   */
  constructor() {
    this.element = document.createElement('div')
    this.element.classList.add('punctual-console')

    this.list = document.createElement('div')
    this.list.classList.add('punctual-console__messages')
    // focusable; native key bindings for copy/select
    this.list.classList.add('native-key-bindings')
    this.list.tabIndex = 0
    this.list.addEventListener('mousedown', () => {
      try { this.list.focus() } catch (_) {}
    })

    // base layout; detailed styles in LESS
    Object.assign(this.element.style, {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'var(--punctual-console-bg, #111)',
      color: 'var(--punctual-console-fg, #ddd)'
    })
    Object.assign(this.list.style, {
      overflowY: 'auto',
      overflowX: 'hidden',
      padding: '8px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: '12px',
      lineHeight: '1.4',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      flex: '1 1 auto'
    })

    this.element.appendChild(this.list)

    // wire copy/select-all here
    if (typeof atom !== 'undefined' && atom.commands) {
      this._disposable = atom.commands.add(this.element, {
        'core:copy': () => this.copySelection(),
        'core:select-all': () => this.selectAll()
      })
    }
  }

  /**
   * Gets the URI for this view type (static).
   * @returns {string} The console URI
   */
  static getURI() { return CONSOLE_URI }
  
  /**
   * Gets the URI for this view instance.
   * @returns {string} The console URI
   */
  getURI() { return CONSOLE_URI }
  
  /**
   * Gets the title shown in the Atom/Pulsar UI for this pane.
   * @returns {string} The title "Punctual"
   */
  getTitle() { return 'Punctual' }
  
  /**
   * Gets the default location where this pane opens.
   * @returns {string} The default location "bottom"
   */
  getDefaultLocation() { return 'bottom' }
  
  /**
   * Gets the allowed locations for this pane in the workspace.
   * @returns {string[]} Array of allowed locations: left, right, bottom
   */
  getAllowedLocations() { return ['left', 'right', 'bottom'] }

  /**
   * Gets the root DOM element for this view.
   * @returns {HTMLElement} The console container element
   */
  getElement() { return this.element }

  /**
   * Adds a message to the console with optional styling.
   * Auto-scrolls to the bottom if you're already there.
   * Trims old messages when we hit MAX_LINES.
   * 
   * @param {*} message - The message to display (string, Error, object, etc.)
   * @param {string} [className] - Optional CSS class for styling (e.g., 'text-error', 'text-success')
   */
  addMessage(message, className) {
    try {
      const atBottom = (this.list.scrollTop + this.list.clientHeight) >= (this.list.scrollHeight - 4)

      const item = document.createElement('div')
      const text = this._formatMessage(message)
      
      // Check if this is a multi-section output from Punctual (program actions + worklets)
      if (this._isCollapsibleOutput(text)) {
        this._renderCollapsibleOutput(item, text, className)
      } else {
        item.textContent = text
        if (className) item.classList.add(className)
      }
      
      this.list.appendChild(item)

      // Trim buffer to avoid unbounded growth
      if (this.list.childElementCount > MAX_LINES) {
        const toRemove = this.list.childElementCount - TRIM_TO
        for (let i = 0; i < toRemove; i++) {
          const first = this.list.firstElementChild
          if (!first) break
          this.list.removeChild(first)
        }
      }

      if (atBottom) {
        this.list.scrollTop = this.list.scrollHeight
      }
    } catch (e) {
      // Fallback to console if rendering fails
      console.error('[Punctual Console] addMessage error:', e, message)
    }
  }

  /**
   * Checks if the given text should be rendered as collapsible output.
   * Looks for Punctual's program output which has multiple sections.
   * 
   * @private
   * @param {string} text - The text to check
   * @returns {boolean} True if text contains collapsible sections
   */
  _isCollapsibleOutput(text) {
    // Punctual multi-section output
    return text.includes('new program actions:') || 
           text.includes('previous program actions:') || 
           text.includes('audio worklets:')
  }

  /**
   * Renders output with collapsible sections using HTML details/summary elements.
   * Creates interactive sections that you can expand/collapse.
   * 
   * @private
   * @param {HTMLElement} container - The container element to render into
   * @param {string} text - The text containing sections to render
   * @param {string} [className] - Optional CSS class for styling
   */
  _renderCollapsibleOutput(container, text, className) {
    if (className) container.classList.add(className)
    
    // split into sections
    const sections = this._parseSections(text)
    
    sections.forEach(section => {
      if (section.isCollapsible) {
        // collapsible details/summary
        const details = document.createElement('details')
        const summary = document.createElement('summary')
        summary.textContent = section.title
        summary.style.cursor = 'pointer'
        summary.style.userSelect = 'none'
        summary.style.marginBottom = '4px'
        
        const content = document.createElement('pre')
        content.textContent = section.content
        content.style.marginLeft = '16px'
        content.style.marginTop = '4px'
        content.style.whiteSpace = 'pre-wrap'
        content.style.wordBreak = 'break-word'
        
        details.appendChild(summary)
        details.appendChild(content)
        container.appendChild(details)
      } else {
        const textNode = document.createElement('div')
        textNode.textContent = section.content
        textNode.style.marginBottom = '4px'
        container.appendChild(textNode)
      }
    })
  }

  /**
   * Parses text into sections for collapsible rendering.
   * Finds section headers (lines ending with ':' that match known patterns)
   * and groups content under each section.
   * 
   * @private
   * @param {string} text - The text to parse
   * @returns {Array<{isCollapsible: boolean, title?: string, content: string}>} Array of section objects
   */
  _parseSections(text) {
    const sections = []
    const lines = text.split('\n')
    
    let currentSection = null
    let currentContent = []
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      
      // Check if this line starts a new section
      if (line.trim().endsWith(':') && 
          (line.includes('new program actions') || 
           line.includes('previous program actions') || 
           line.includes('audio worklets'))) {
        
        // Save previous section if exists
        if (currentSection) {
          sections.push({
            isCollapsible: true,
            title: currentSection,
            content: currentContent.join('\n').trim()
          })
        }
        
        // Start new section
        currentSection = line.trim()
        currentContent = []
      } else if (currentSection) {
        // Add line to current section content
        currentContent.push(line)
      } else {
        // Not in a section, add as plain text
        sections.push({
          isCollapsible: false,
          content: line
        })
      }
    }
    
    // Save last section if exists
    if (currentSection && currentContent.length > 0) {
      sections.push({
        isCollapsible: true,
        title: currentSection,
        content: currentContent.join('\n').trim()
      })
    }
    
    return sections
  }

  /**
   * Copies all console content to the clipboard.
   * 
   * @returns {string} The copied text, or empty string if it didn't work
   */
  copyAll() {
    try {
      const text = Array.from(this.list.children).map(n => n.textContent || '').join('\n')
      if (text && typeof atom !== 'undefined' && atom.clipboard) {
        atom.clipboard.write(text)
        return text
      }
      return ''
    } catch (e) {
      console.error('[Punctual Console] copyAll error:', e)
      return ''
    }
  }

  /**
   * Copies the currently selected text to the clipboard.
   * If nothing's selected, copies everything instead.
   * 
   * @returns {string} The copied text, or empty string if it didn't work
   */
  copySelection() {
    try {
      const sel = window.getSelection ? window.getSelection() : null
      const text = sel && sel.toString ? sel.toString() : ''
      if (text && typeof atom !== 'undefined' && atom.clipboard) {
        atom.clipboard.write(text)
        return text
      }
      // Fallback to copy all if nothing selected
      return this.copyAll()
    } catch (e) {
      console.error('[Punctual Console] copySelection error:', e)
      return ''
    }
  }

  /**
   * Selects all text in the console.
   * Uses the browser Selection API to create and apply a range.
   */
  selectAll() {
    try {
      const range = document.createRange()
      range.selectNodeContents(this.list)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    } catch (e) {
      console.error('[Punctual Console] selectAll error:', e)
    }
  }

  /**
   * Formats various message types into a string for display.
   * Handles Error objects (with stack traces), strings, objects (JSON), and other types.
   * 
   * @private
   * @param {*} message - The message to format
   * @returns {string} The formatted message string
   */
  _formatMessage(message) {
    if (message == null) return ''
    if (message instanceof Error) return message.stack || message.message || String(message)
    const t = typeof message
    if (t === 'string') return message
    if (t === 'object') {
      try { return JSON.stringify(message, null, 2) } catch (_) { /* ignore */ }
    }
    return String(message)
  }

  /**
   * Clears all messages from the console.
   */
  clear() {
    this.list.innerHTML = ''
  }

  /**
   * Serializes this view so Atom/Pulsar can restore it later.
   * 
   * @returns {{deserializer: string, uri: string}} Serialization data
   */
  serialize() {
    return {
      deserializer: 'pulsar-punctual/ConsoleView',
      uri: CONSOLE_URI
    }
  }

  /**
   * Destroys this view and cleans up resources.
   * Gets rid of command bindings and removes the element from the DOM.
   */
  destroy() {
    try { this._disposable && this._disposable.dispose && this._disposable.dispose() } catch (_) {}
    this.element.remove()
  }
}

export { CONSOLE_URI }
