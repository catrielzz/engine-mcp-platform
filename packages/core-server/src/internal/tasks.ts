import type {
  QueuedMessage,
  TaskMessageQueue,
  TaskStore
} from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type {
  EventId,
  EventStore,
  StreamId
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type {
  EngineMcpInMemoryEventStoreOptions,
  EngineMcpInMemoryTaskMessageQueueOptions,
  EngineMcpTaskCancellationRegistry
} from "../shared.js";
import {
  DEFAULT_IN_MEMORY_EVENT_STORE_MAX_EVENTS_PER_STREAM,
  DEFAULT_IN_MEMORY_EVENT_STORE_PRUNE_INTERVAL_MS,
  DEFAULT_IN_MEMORY_TASK_MESSAGE_PRUNE_INTERVAL_MS
} from "../shared.js";

export function createInMemoryEventStore(
  options: EngineMcpInMemoryEventStoreOptions = {}
): EventStore {
  const maxEventsPerStream =
    resolvePositiveIntegerOption(options.maxEventsPerStream) ??
    DEFAULT_IN_MEMORY_EVENT_STORE_MAX_EVENTS_PER_STREAM;
  const maxEventAgeMs = resolvePositiveIntegerOption(options.maxEventAgeMs);
  const pruneIntervalMs =
    maxEventAgeMs === undefined
      ? undefined
      : resolvePositiveIntegerOption(
          options.pruneIntervalMs,
          DEFAULT_IN_MEMORY_EVENT_STORE_PRUNE_INTERVAL_MS
        );
  const now = options.now ?? Date.now;
  const streamEvents = new Map<
    StreamId,
    Array<{ eventId: EventId; message: unknown; storedAt: number }>
  >();
  const streamIdByEventId = new Map<EventId, StreamId>();
  let counter = 0;

  function pruneExpiredEvents(streamId?: StreamId): void {
    if (maxEventAgeMs === undefined) {
      return;
    }

    const cutoff = now() - maxEventAgeMs;
    const targetStreamIds = streamId ? [streamId] : [...streamEvents.keys()];

    for (const targetStreamId of targetStreamIds) {
      const events = streamEvents.get(targetStreamId);

      if (!events) {
        continue;
      }

      const freshEvents = events.filter((entry) => entry.storedAt > cutoff);

      if (freshEvents.length === events.length) {
        continue;
      }

      for (const event of events) {
        if (event.storedAt <= cutoff) {
          streamIdByEventId.delete(event.eventId);
        }
      }

      if (freshEvents.length === 0) {
        streamEvents.delete(targetStreamId);
        continue;
      }

      streamEvents.set(targetStreamId, freshEvents);
    }
  }

  function pruneOverflow(streamId: StreamId): void {
    const events = streamEvents.get(streamId);

    if (!events || events.length <= maxEventsPerStream) {
      return;
    }

    const overflowCount = events.length - maxEventsPerStream;
    const evictedEvents = events.slice(0, overflowCount);
    const retainedEvents = events.slice(overflowCount);

    for (const event of evictedEvents) {
      streamIdByEventId.delete(event.eventId);
    }

    if (retainedEvents.length === 0) {
      streamEvents.delete(streamId);
      return;
    }

    streamEvents.set(streamId, retainedEvents);
  }

  const pruneTimer =
    pruneIntervalMs === undefined
      ? undefined
      : setInterval(() => {
          pruneExpiredEvents();
        }, pruneIntervalMs);

  pruneTimer?.unref();

  const eventStore: EventStore & { cleanup(): void } = {
    async storeEvent(streamId, message) {
      pruneExpiredEvents(streamId);
      counter += 1;

      const eventId = `event-${String(counter).padStart(8, "0")}`;
      const existingEvents = streamEvents.get(streamId) ?? [];
      existingEvents.push({
        eventId,
        message,
        storedAt: now()
      });
      streamEvents.set(streamId, existingEvents);
      streamIdByEventId.set(eventId, streamId);
      pruneOverflow(streamId);

      return eventId;
    },
    async getStreamIdForEventId(eventId) {
      const streamId = streamIdByEventId.get(eventId);

      if (!streamId) {
        return undefined;
      }

      pruneExpiredEvents(streamId);

      return streamIdByEventId.get(eventId);
    },
    async replayEventsAfter(lastEventId, { send }) {
      pruneExpiredEvents();
      const streamId = streamIdByEventId.get(lastEventId);

      if (!streamId) {
        throw new Error(`Unknown event id: ${lastEventId}`);
      }

      const events = streamEvents.get(streamId) ?? [];
      const eventIndex = events.findIndex((entry) => entry.eventId === lastEventId);

      if (eventIndex === -1) {
        throw new Error(`Unknown event id: ${lastEventId}`);
      }

      for (const event of events.slice(eventIndex + 1)) {
        await send(event.eventId, event.message as never);
      }

      return streamId;
    },
    cleanup() {
      if (pruneTimer) {
        clearInterval(pruneTimer);
      }

      streamEvents.clear();
      streamIdByEventId.clear();
    }
  };

  return eventStore;
}

export function createInMemoryTaskMessageQueue(
  options: EngineMcpInMemoryTaskMessageQueueOptions = {}
): TaskMessageQueue & { cleanup(): void } {
  const maxMessageAgeMs = resolvePositiveIntegerOption(options.maxMessageAgeMs);
  const pruneIntervalMs =
    maxMessageAgeMs === undefined
      ? undefined
      : resolvePositiveIntegerOption(
          options.pruneIntervalMs,
          DEFAULT_IN_MEMORY_TASK_MESSAGE_PRUNE_INTERVAL_MS
        );
  const now = options.now ?? Date.now;
  const queues = new Map<string, Array<{ message: QueuedMessage; queuedAt: number }>>();

  function getQueueKey(taskId: string, _sessionId?: string): string {
    return taskId;
  }

  function pruneExpiredMessages(taskId?: string, sessionId?: string): void {
    if (maxMessageAgeMs === undefined) {
      return;
    }

    const cutoff = now() - maxMessageAgeMs;
    const targetQueueKeys = taskId ? [getQueueKey(taskId, sessionId)] : [...queues.keys()];

    for (const queueKey of targetQueueKeys) {
      const queue = queues.get(queueKey);

      if (!queue) {
        continue;
      }

      const freshQueue = queue.filter((entry) => entry.queuedAt > cutoff);

      if (freshQueue.length === queue.length) {
        continue;
      }

      if (freshQueue.length === 0) {
        queues.delete(queueKey);
        continue;
      }

      queues.set(queueKey, freshQueue);
    }
  }

  const pruneTimer =
    pruneIntervalMs === undefined
      ? undefined
      : setInterval(() => {
          pruneExpiredMessages();
        }, pruneIntervalMs);

  pruneTimer?.unref();

  return {
    async enqueue(taskId, message, sessionId, maxSize) {
      const queueKey = getQueueKey(taskId, sessionId);
      pruneExpiredMessages(taskId, sessionId);

      const queue = queues.get(queueKey) ?? [];

      if (maxSize !== undefined && queue.length >= maxSize) {
        throw new Error(
          `Task message queue overflow: queue size (${queue.length}) exceeds maximum (${maxSize})`
        );
      }

      queue.push({
        message,
        queuedAt: now()
      });
      queues.set(queueKey, queue);
    },
    async dequeue(taskId, sessionId) {
      const queueKey = getQueueKey(taskId, sessionId);
      pruneExpiredMessages(taskId, sessionId);

      const queue = queues.get(queueKey);

      if (!queue || queue.length === 0) {
        return undefined;
      }

      const nextEntry = queue.shift();

      if (queue.length === 0) {
        queues.delete(queueKey);
      }

      return nextEntry?.message;
    },
    async dequeueAll(taskId, sessionId) {
      const queueKey = getQueueKey(taskId, sessionId);
      pruneExpiredMessages(taskId, sessionId);

      const queue = queues.get(queueKey) ?? [];
      queues.delete(queueKey);
      return queue.map((entry) => entry.message);
    },
    cleanup() {
      if (pruneTimer) {
        clearInterval(pruneTimer);
      }

      queues.clear();
    }
  };
}

export function createTaskCancellationRegistry(): EngineMcpTaskCancellationRegistry {
  const controllers = new Map<string, AbortController>();

  return {
    register(taskId: string): AbortSignal {
      const existingController = controllers.get(taskId);

      if (existingController) {
        return existingController.signal;
      }

      const controller = new AbortController();
      controllers.set(taskId, controller);
      return controller.signal;
    },
    cancel(taskId: string, reason?: unknown): void {
      const controller = controllers.get(taskId);

      if (!controller || controller.signal.aborted) {
        return;
      }

      controller.abort(reason);
    },
    delete(taskId: string): void {
      controllers.delete(taskId);
    },
    clear(reason?: unknown): void {
      for (const [taskId, controller] of controllers.entries()) {
        if (!controller.signal.aborted) {
          controller.abort(reason);
        }

        controllers.delete(taskId);
      }
    }
  };
}

export function createTaskStoreWithCancellationHooks(
  taskStore: TaskStore,
  cancellationRegistry: EngineMcpTaskCancellationRegistry
): TaskStore {
  return {
    createTask(taskParams, requestId, request, sessionId) {
      return taskStore.createTask(taskParams, requestId, request, sessionId);
    },
    getTask(taskId, sessionId) {
      return taskStore.getTask(taskId, sessionId);
    },
    async storeTaskResult(taskId, status, result, sessionId) {
      try {
        await taskStore.storeTaskResult(taskId, status, result, sessionId);
      } finally {
        if (isTaskTerminalStatus(status)) {
          cancellationRegistry.delete(taskId);
        }
      }
    },
    getTaskResult(taskId, sessionId) {
      return taskStore.getTaskResult(taskId, sessionId);
    },
    async updateTaskStatus(taskId, status, statusMessage, sessionId) {
      await taskStore.updateTaskStatus(taskId, status, statusMessage, sessionId);

      if (status === "cancelled") {
        cancellationRegistry.cancel(
          taskId,
          new Error(statusMessage ?? `Task ${taskId} cancelled.`)
        );
      }

      if (isTaskTerminalStatus(status)) {
        cancellationRegistry.delete(taskId);
      }
    },
    listTasks(cursor, sessionId) {
      return taskStore.listTasks(cursor, sessionId);
    }
  };
}

export function resolvePositiveIntegerOption(
  value: number | undefined,
  fallback?: number
): number | undefined {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

export function hasTaskStoreCleanup(
  value: TaskStore
): value is TaskStore & { cleanup(): void } {
  return typeof (value as TaskStore & { cleanup?: unknown }).cleanup === "function";
}

export function hasTaskMessageQueueCleanup(
  value: TaskMessageQueue
): value is TaskMessageQueue & { cleanup(): void } {
  return typeof (value as TaskMessageQueue & { cleanup?: unknown }).cleanup === "function";
}

export function hasEventStoreCleanup(
  value: EventStore
): value is EventStore & { cleanup(): void } {
  return typeof (value as EventStore & { cleanup?: unknown }).cleanup === "function";
}

export function isTaskTerminalStatus(
  status: string
): status is "completed" | "failed" | "cancelled" {
  return status === "completed" || status === "failed" || status === "cancelled";
}
