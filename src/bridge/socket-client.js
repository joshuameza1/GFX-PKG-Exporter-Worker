const EventEmitter = require('events');
const io = require('socket.io-client');

class SocketClient extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.socket = null;
    this.status = 'disconnected';
    this._pendingListeners = [];
  }

  connect() {
    this.socket = io(this.url, {
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,
    });

    for (const [event, listener] of this._pendingListeners) {
      this.socket.on(event, listener);
    }
    this._pendingListeners = [];

    this.socket.on('connect', () => {
      this._setStatus('connected');
    });

    this.socket.on('disconnect', () => {
      this._setStatus('disconnected');
    });

    this.socket.on('connect_error', () => {
      this._setStatus('disconnected');
    });

    this.socket.on('reconnect_attempt', () => {
      this._setStatus('connecting');
    });
  }

  on(event, listener) {
    if (event === 'status') {
      return super.on(event, listener);
    }
    if (this.socket) {
      this.socket.on(event, listener);
    } else {
      this._pendingListeners.push([event, listener]);
    }
    return this;
  }

  emit(event, data) {
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data);
    }
  }

  getStatus() {
    return this.status;
  }

  _setStatus(status) {
    if (this.status !== status) {
      this.status = status;
      super.emit('status', status);
    }
  }
}

module.exports = { SocketClient };
