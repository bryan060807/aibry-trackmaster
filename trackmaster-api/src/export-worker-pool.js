import os from 'node:os';
import { Worker } from 'node:worker_threads';

export class ExportQueueFullError extends Error {
  constructor(message = 'Audio export queue is full') {
    super(message);
    this.name = 'ExportQueueFullError';
    this.code = 'EXPORT_QUEUE_FULL';
  }
}

export class ExportWorkerPool {
  constructor({ workerUrl, size = defaultWorkerCount(), maxQueue = size * 4 } = {}) {
    if (!workerUrl) throw new Error('workerUrl is required');
    this.workerUrl = workerUrl;
    this.size = clampInteger(size, 1, 16);
    this.maxQueue = clampInteger(maxQueue, 0, 1024);
    this.queue = [];
    this.workers = new Set();
    this.closed = false;

    for (let index = 0; index < this.size; index += 1) {
      this.#spawnWorker();
    }
  }

  run(message, transferList = []) {
    if (this.closed) {
      throw new Error('Audio export worker pool is closed');
    }

    const idleWorker = this.#idleWorker();
    if (!idleWorker && this.queue.length >= this.maxQueue) {
      throw new ExportQueueFullError();
    }

    return new Promise((resolve, reject) => {
      const task = { message, transferList, resolve, reject };
      if (idleWorker) {
        this.#assign(idleWorker, task);
        return;
      }
      this.queue.push(task);
    });
  }

  stats() {
    let busy = 0;
    for (const workerState of this.workers) {
      if (workerState.busy) busy += 1;
    }
    return {
      size: this.size,
      workers: this.workers.size,
      busy,
      idle: this.workers.size - busy,
      queued: this.queue.length,
      maxQueue: this.maxQueue,
      closed: this.closed,
    };
  }

  async close() {
    this.closed = true;
    const queued = this.queue.splice(0);
    for (const task of queued) {
      task.reject(new Error('Audio export worker pool closed before the task started'));
    }

    const terminations = [];
    for (const workerState of this.workers) {
      terminations.push(workerState.worker.terminate().catch(() => {}));
    }
    await Promise.allSettled(terminations);
    this.workers.clear();
  }

  #spawnWorker() {
    if (this.closed) return null;

    const workerState = {
      worker: new Worker(this.workerUrl),
      busy: false,
      currentTask: null,
    };

    workerState.worker.on('message', (message) => {
      const task = workerState.currentTask;
      workerState.currentTask = null;
      workerState.busy = false;
      workerState.worker.unref();
      if (task) task.resolve(message);
      this.#dispatch();
    });

    workerState.worker.on('error', (err) => {
      this.#retireWorker(workerState, err);
    });

    workerState.worker.on('exit', (code) => {
      if (this.workers.has(workerState)) {
        const err = code === 0
          ? new Error('Audio export worker exited unexpectedly')
          : new Error(`Audio export worker exited with code ${code}`);
        this.#retireWorker(workerState, err);
      }
    });

    workerState.worker.unref();
    this.workers.add(workerState);
    return workerState;
  }

  #retireWorker(workerState, err) {
    this.workers.delete(workerState);
    const task = workerState.currentTask;
    workerState.currentTask = null;
    workerState.busy = false;
    if (task) task.reject(err);

    if (!this.closed) {
      this.#spawnWorker();
      this.#dispatch();
    }
  }

  #dispatch() {
    if (this.closed) return;
    while (this.queue.length > 0) {
      const workerState = this.#idleWorker();
      if (!workerState) return;
      this.#assign(workerState, this.queue.shift());
    }
  }

  #assign(workerState, task) {
    workerState.busy = true;
    workerState.currentTask = task;
    workerState.worker.ref();
    try {
      workerState.worker.postMessage(task.message, task.transferList);
    } catch (err) {
      workerState.currentTask = null;
      workerState.busy = false;
      workerState.worker.unref();
      task.reject(err);
      this.#dispatch();
    }
  }

  #idleWorker() {
    for (const workerState of this.workers) {
      if (!workerState.busy) return workerState;
    }
    return null;
  }
}

function defaultWorkerCount() {
  const cpus = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(4, cpus - 1 || 1));
}

function clampInteger(value, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}
