'use babel'

import Main from './main.js'
import { CompositeDisposable } from 'atom'
import ConsoleView, { CONSOLE_URI } from './console-view.js'

export default {
  isActive: false,
  subscriptions: null,
  main: null,

  activate(state) {
    this.main = new Main()
    // Events subscribed to in atom's system can be easily cleaned up with a CompositeDisposable
    this.subscriptions = new CompositeDisposable();

    // Register an opener for the Punctual Console tab
    this.subscriptions.add(atom.workspace.addOpener((uri) => {
      if (uri === CONSOLE_URI) {
        return new ConsoleView()
      }
    }))

    // Register commands following atom-hydra pattern
    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'pulsar-punctual:toggle': () => this.toggle(),
      'pulsar-punctual:evalLine': () => this.main.evalLine(),
      'pulsar-punctual:evalBlock': () => this.main.evalBlock(),
      'pulsar-punctual:evalCode': () => this.main.evalCode(),
      'pulsar-punctual:toggleVisibility': () => this.main.toggleVisibility(),
      'pulsar-punctual:showConsole': () => atom.workspace.open(CONSOLE_URI, { searchAllPanes: true, activatePane: true })
    }));
  },

  deactivate() {
    this.subscriptions.dispose()
    this.main.stop()
  },

  serialize() {
    return {
    };
  },

  toggle() {
    if(this.isActive) {
      this.isActive = false
      return this.main.stop()
    } else {
      this.isActive = true
      return this.main.start()
    }
  }

};
