import {
  GraphLayoutWorkerController,
  type GraphLayoutWorkerRequest,
  type GraphLayoutWorkerResponse,
  type GraphLayoutTaskScheduler,
} from "../graphLayoutWorkerProtocol";

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<GraphLayoutWorkerRequest>) => void) | null;
  postMessage(message: GraphLayoutWorkerResponse, transfer: Transferable[]): void;
  setTimeout(callback: () => void, delay?: number): number;
  clearTimeout(handle: number): void;
};

const scheduler: GraphLayoutTaskScheduler = {
  schedule: (callback) => worker.setTimeout(callback, 0),
  cancel: (handle) => worker.clearTimeout(handle),
};

const controller = new GraphLayoutWorkerController(scheduler, (response) => {
  const transfer = response.type === "frame" ? [response.frame.positions.buffer] : [];
  worker.postMessage(response, transfer);
});

worker.onmessage = ({ data }) => controller.handle(data);
