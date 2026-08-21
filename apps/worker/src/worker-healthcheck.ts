import type { WorkerHeartbeatRecord } from "@yt-monitor/db";

export interface HeartbeatReader {
  getRunningHeartbeat(
    workerId: string,
    maxAgeSeconds: number,
  ): Promise<WorkerHeartbeatRecord | null>;
}

export async function evaluateWorkerHealth(
  reader: HeartbeatReader,
  workerId: string,
  maxAgeSeconds: number,
): Promise<boolean> {
  return (await reader.getRunningHeartbeat(workerId, maxAgeSeconds)) !== null;
}
