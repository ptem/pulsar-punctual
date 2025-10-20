'use babel'

/**
 * @file pulsar-punctual.js
 * Package entry for Punctual in Atom/Pulsar.
 * Registers commands and manages lifecycle.
 */

import Main from './main.js'
import { CompositeDisposable } from 'atom'
import ConsoleView, { CONSOLE_URI } from './console-view.js'

/**
 * Pulsar Punctual package module.
 * This is where Atom/Pulsar starts when it activates the package.
 * Manages package state, command registration, and hands off work to the Main controller.
 */
export default {
  /** @type {boolean} Whether Punctual is currently active */
  isActive: false,
  /** @type {CompositeDisposable|null} Disposable container for subscriptions */
  subscriptions: null,
  /** @type {Main|null} Main controller instance */
  main: null,

  /**
   * Activates the package.
   * Atom/Pulsar calls this when loading the package. Sets up the Main controller,
   * registers the console opener, and hooks up all the commands.
   * 
   * @param {Object} state - Serialized package state (not used right now)
   */
  activate(state) {
    this.main = new Main()
    // subscriptions bucket
    this.subscriptions = new CompositeDisposable();

    // console opener
    this.subscriptions.add(atom.workspace.addOpener((uri) => {
      if (uri === CONSOLE_URI) {
        return new ConsoleView()
      }
    }))

    // commands
    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'pulsar-punctual:toggle': () => this.toggle(),
      'pulsar-punctual:evalLine': () => this.main.evalLine(),
      'pulsar-punctual:evalBlock': () => this.main.evalBlock(),
      'pulsar-punctual:evalCode': () => this.main.evalCode(),
      'pulsar-punctual:toggleVisibility': () => this.main.toggleVisibility(),
      'pulsar-punctual:showConsole': () => atom.workspace.open(CONSOLE_URI, { searchAllPanes: true, activatePane: true }),
      'pulsar-punctual:increaseMasterVolume': () => this.increaseMasterVolume(),
      'pulsar-punctual:decreaseMasterVolume': () => this.decreaseMasterVolume(),
      'pulsar-punctual:panic': () => this.panic(),
            'pulsar-punctual:copyConsole': () => {
              // Find existing console item or open without focusing
              const items = atom.workspace.getPaneItems()
              let consoleItem = items.find(it => typeof it.getURI === 'function' && it.getURI() === CONSOLE_URI)
              const openIfNeeded = () => atom.workspace.open(CONSOLE_URI, { searchAllPanes: true, activatePane: false, activateItem: false })
              Promise.resolve(consoleItem || openIfNeeded()).then(view => {
                consoleItem = consoleItem || view
                if (consoleItem && typeof consoleItem.copyAll === 'function') {
                  const text = consoleItem.copyAll()
                  if (this.main && text) this.main.log('Console copied to clipboard.', 'text-success')
                }
              })
            }
    }));
  },

  /**
   * Deactivates the package.
   * Atom/Pulsar calls this when the package is deactivated. Cleans up subscriptions
   * and stops the Punctual system.
   */
  deactivate() {
    this.subscriptions.dispose()
    this.main.stop()
  },

  /**
   * Serializes the package state.
   * Returns an empty object right now since there's no state to save.
   * 
   * @returns {Object} Empty serialization object
   */
  serialize() {
    return {
    };
  },

  /**
   * Toggles Punctual on/off.
   * Starts Punctual if it's off, stops it if it's on.
   * 
   * @returns {Promise<void>|undefined} Promise from start/stop, or undefined
   */
  toggle() {
    if(this.isActive) {
      this.isActive = false
      return this.main.stop()
    } else {
      this.isActive = true
      return this.main.start()
    }
  },

  /**
   * Increases the master volume by passing it to the Main controller.
   */
  increaseMasterVolume() {
    if (this.main && typeof this.main.increaseMasterVolume === 'function') {
      this.main.increaseMasterVolume()
    }
  },

  /**
   * Decreases the master volume by passing it to the Main controller.
   */
  decreaseMasterVolume() {
    if (this.main && typeof this.main.decreaseMasterVolume === 'function') {
      this.main.decreaseMasterVolume()
    }
  },

  /**
   * Emergency audio silence - passes it to the Main controller.
   */
  panic() {
    if (this.main && typeof this.main.panic === 'function') {
      this.main.panic()
    }
  }

};
