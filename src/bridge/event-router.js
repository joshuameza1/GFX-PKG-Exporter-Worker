const EventEmitter = require('events');

class EventRouter extends EventEmitter {
  constructor(socketClient, jobStore, processor) {
    super();
    this.socketClient = socketClient;
    this.jobStore = jobStore;
    this.processor = processor;

    this._wireSocketEvents();
    this._wireProcessorEvents();
  }

  _wireSocketEvents() {
    this.socketClient.on('requestFinal', (request) => {
      console.log('[router] Received requestFinal:', request.request_id);
      try {
        const job = this.jobStore.enqueue(request);
        this.emit('job:queued', { id: job.id, request });
        this.processor.nudge();
      } catch (err) {
        console.error('[router] Failed to enqueue job:', err);
      }
    });

    this.socketClient.on('connection', (arg) => {
      console.log('[router] Connection event:', arg);
    });
  }

  _wireProcessorEvents() {
    this.processor.on('job:completed', ({ id, request, filename, fileLink }) => {
      this.socketClient.emit('finalDone', [request, filename, fileLink]);
      this.emit('job:completed', { id, request, fileLink });
    });

    this.processor.on('job:failed', ({ id, request, errorMessage }) => {
      this.socketClient.emit('finalError', [request, errorMessage]);
      this.emit('job:failed', { id, request, errorMessage });
    });
  }
}

module.exports = { EventRouter };
