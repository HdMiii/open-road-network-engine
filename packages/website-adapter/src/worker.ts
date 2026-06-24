import { EngineWorkerSession, type EngineWorkerInMessage, type EngineWorkerOutMessage } from "./index.ts";

export interface EngineWorkerHost {
  postMessage(message: EngineWorkerOutMessage, transfer?: ArrayBuffer[]): void;
}

export interface EngineWorkerGlobalScope extends EngineWorkerHost {
  onmessage: ((event: MessageEvent<EngineWorkerInMessage>) => void) | null;
  addEventListener?: (type: "message", listener: (event: MessageEvent<EngineWorkerInMessage>) => void) => void;
}

export function transferablesForResponse(message: EngineWorkerOutMessage): ArrayBuffer[] {
  if (message.type === "fullmap") return [arrayBufferForTransfer(message.values.buffer)];
  if (message.type === "route") return [arrayBufferForTransfer(message.segmentIndexes.buffer)];
  return [];
}

function arrayBufferForTransfer(buffer: ArrayBufferLike): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) return buffer;
  throw new Error("SharedArrayBuffer-backed worker responses are not transferable.");
}

export function createEngineWorkerMessageHandler(
  session = new EngineWorkerSession(),
  host: EngineWorkerHost
): (event: MessageEvent<EngineWorkerInMessage> | EngineWorkerInMessage) => void {
  return (event) => {
    const message = "data" in event ? event.data : event;
    const response = session.handleWithProgress(message, (progress) => {
      host.postMessage(progress, transferablesForResponse(progress));
    });
    host.postMessage(response, transferablesForResponse(response));
  };
}

export function attachEngineWorker(scope: EngineWorkerGlobalScope): (event: MessageEvent<EngineWorkerInMessage>) => void {
  const handler = createEngineWorkerMessageHandler(new EngineWorkerSession(), scope);
  scope.onmessage = handler;
  return handler;
}

const maybeScope = globalThis as typeof globalThis & { self?: EngineWorkerGlobalScope };
if (
  typeof maybeScope.self !== "undefined" &&
  typeof maybeScope.self.postMessage === "function" &&
  "onmessage" in maybeScope.self
) {
  attachEngineWorker(maybeScope.self);
}
