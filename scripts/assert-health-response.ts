import { HealthStatusSchema, type HealthResponse } from "@yt-monitor/shared";

import { assertHealthResponse } from "./health-response-assertion.js";

const [
  url,
  expectedStatusText,
  expectedServiceText,
  expectedHealthStatusText,
  expectedCheckName,
  expectedCheckCode,
] = process.argv.slice(2);

if (!url || !expectedStatusText || !expectedServiceText || !expectedHealthStatusText) {
  throw new Error(
    "Usage: assert-health-response.ts <url> <expected-http-status> <expected-service> <expected-health-status> [expected-check-name expected-check-code]",
  );
}

if ((expectedCheckName && !expectedCheckCode) || (!expectedCheckName && expectedCheckCode)) {
  throw new Error("Expected check name and code must be provided together");
}

const expectedStatus = Number.parseInt(expectedStatusText, 10);
const expectedService = expectedServiceText as HealthResponse["service"];
const expectedHealthStatus = HealthStatusSchema.parse(expectedHealthStatusText);
const response = await fetch(url, {
  cache: "no-store",
  signal: AbortSignal.timeout(5_000),
});
const body: unknown = await response.json();
const parsed = assertHealthResponse(
  response,
  body,
  expectedStatus,
  expectedService,
  expectedHealthStatus,
  expectedCheckName && expectedCheckCode
    ? { checkName: expectedCheckName, code: expectedCheckCode }
    : undefined,
);

process.stdout.write(`${parsed.service}:${parsed.status}:${response.status}\n`);
