'use babel';

export default class PulsarPunctualView {

  constructor(serializedState) {
    this.element = document.createElement('div');
    this.element.classList.add('pulsar-punctual');

    const message = document.createElement('div');
    message.textContent = 'The PulsarPunctual package is Alive! It\'s ALIVE!';
    message.classList.add('message');
    this.element.appendChild(message);
  }

  serialize() {}

  destroy() {
    this.element.remove();
  }

  getElement() {
    return this.element;
  }

}
