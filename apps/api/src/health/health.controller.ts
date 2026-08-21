import { Controller, Get, Header, HttpException } from "@nestjs/common";
import type { HealthResponse } from "@yt-monitor/shared";

import { HealthService, type HealthResult } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async aggregate(): Promise<HealthResponse> {
    return this.respond(await this.healthService.getAggregateHealth());
  }

  @Get("db")
  @Header("Cache-Control", "no-store")
  async database(): Promise<HealthResponse> {
    return this.respond(await this.healthService.getDatabaseHealth());
  }

  @Get("worker")
  @Header("Cache-Control", "no-store")
  async worker(): Promise<HealthResponse> {
    return this.respond(await this.healthService.getWorkerHealth());
  }

  @Get("collectors")
  @Header("Cache-Control", "no-store")
  collectors(): HealthResponse {
    return this.respond(this.healthService.getCollectorsHealth());
  }

  @Get("ai")
  @Header("Cache-Control", "no-store")
  ai(): HealthResponse {
    return this.respond(this.healthService.getAiHealth());
  }

  private respond(result: HealthResult): HealthResponse {
    if (result.httpStatus === 503) {
      throw new HttpException(result.body, result.httpStatus);
    }

    return result.body;
  }
}
