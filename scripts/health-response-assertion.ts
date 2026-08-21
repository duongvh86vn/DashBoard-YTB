import { HealthResponseSchema, type HealthResponse, type HealthStatus } from "@yt-monitor/shared";

interface ResponseMetadata {
  status: number;
  headers: Headers;
}

interface ExpectedHealthCheck {
  checkName: string;
  code: string;
}

export function assertHealthResponse(
  response: ResponseMetadata,
  body: unknown,
  expectedHttpStatus: number,
  expectedService: HealthResponse["service"],
  expectedHealthStatus: HealthStatus,
  expectedCheck?: ExpectedHealthCheck,
): HealthResponse {
  const parsed = HealthResponseSchema.parse(body);

  if (response.status !== expectedHttpStatus) {
    throw new Error(`Expected HTTP ${expectedHttpStatus}, received ${response.status}`);
  }

  if (parsed.service !== expectedService) {
    throw new Error(`Expected service ${expectedService}, received ${parsed.service}`);
  }

  if (parsed.status !== expectedHealthStatus) {
    throw new Error(`Expected health status ${expectedHealthStatus}, received ${parsed.status}`);
  }

  if (response.headers.get("cache-control") !== "no-store") {
    throw new Error("Health response must set Cache-Control: no-store");
  }

  if (expectedCheck && parsed.checks[expectedCheck.checkName]?.code !== expectedCheck.code) {
    throw new Error(`Expected check ${expectedCheck.checkName} code ${expectedCheck.code}`);
  }

  return parsed;
}
