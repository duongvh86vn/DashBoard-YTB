import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseWebEnv } from "@yt-monitor/config";

async function loadNextStandaloneServer() {
  await import("./.next/standalone/apps/web/server.js");
}

/**
 * Validate runtime configuration before loading the standalone Next server.
 *
 * @param {{
 *   environment?: Record<string, string | undefined>;
 *   loadServer?: () => Promise<unknown>;
 * }} [options]
 */
export async function startStandaloneServer({
  environment = process.env,
  loadServer = loadNextStandaloneServer,
} = {}) {
  parseWebEnv(environment);
  await loadServer();
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  await startStandaloneServer();
}
