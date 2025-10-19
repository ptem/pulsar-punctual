'use babel'

const CONSOLE_URI = 'atom://pulsar-punctual/console'
const MAX_LINES = 2000
const TRIM_TO = 1500

export default class ConsoleView {
  constructor() {
    this.element = document.createElement('div')
    this.element.classList.add('punctual-console')

    this.list = document.createElement('div')
    this.list.classList.add('punctual-console__messages')

    // Terminal-like base layout; refined look lives in LESS
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
  }

  static getURI() { return CONSOLE_URI }
  getURI() { return CONSOLE_URI }
  getTitle() { return 'Punctual' }
  getDefaultLocation() { return 'bottom' }
  getAllowedLocations() { return ['left', 'right', 'bottom'] }

  getElement() { return this.element }

  addMessage(message, className) {
    try {
      const atBottom = (this.list.scrollTop + this.list.clientHeight) >= (this.list.scrollHeight - 4)

      const item = document.createElement('div')
      const text = this._formatMessage(message)
      item.textContent = text
      if (className) item.classList.add(className)
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

  clear() {
    this.list.innerHTML = ''
  }

  serialize() {
    return {
      deserializer: 'pulsar-punctual/ConsoleView',
      uri: CONSOLE_URI
    }
  }

  destroy() {
    this.element.remove()
  }
}

export { CONSOLE_URI }
