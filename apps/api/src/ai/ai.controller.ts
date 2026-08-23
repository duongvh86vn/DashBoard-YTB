import { Body, Controller, Get, Header, Inject, Param, Patch, Post } from "@nestjs/common";

import { Roles } from "../auth/roles.decorator.js";
import { AI_APPLICATION_PORT, type AiApplicationPort } from "./ai-application.port.js";
import {
  parseChannelId,
  parseProvider,
  parseProviderSettingsBody,
  parseReportDate,
  parseReportKind,
} from "./ai.schemas.js";

@Controller("ai")
export class AiController {
  constructor(@Inject(AI_APPLICATION_PORT) private readonly ai: AiApplicationPort) {}

  @Get("status")
  @Header("Cache-Control", "no-store")
  status() {
    return this.ai.status();
  }

  @Patch("settings")
  @Roles("ADMIN")
  @Header("Cache-Control", "no-store")
  updateSettings(@Body() body: unknown) {
    return this.ai.updateSettings(parseProviderSettingsBody(body));
  }

  @Post("channels/:id/classify")
  @Roles("ADMIN")
  @Header("Cache-Control", "no-store")
  classifyChannel(@Param("id") id: string) {
    return this.ai.classifyChannel({ channelId: parseChannelId(id) });
  }

  @Get("reports/:kind/:date")
  @Header("Cache-Control", "no-store")
  report(@Param("kind") kind: string, @Param("date") date: string) {
    return this.ai.getReport({ kind: parseReportKind(kind), reportDate: parseReportDate(date) });
  }

  @Get("providers/:provider/models")
  @Roles("ADMIN")
  @Header("Cache-Control", "no-store")
  discoverModels(@Param("provider") provider: string) {
    return this.ai.discoverModels({ provider: parseProvider(provider) });
  }

  @Post("providers/:provider/test")
  @Roles("ADMIN")
  @Header("Cache-Control", "no-store")
  testProvider(@Param("provider") provider: string) {
    return this.ai.testProvider({ provider: parseProvider(provider) });
  }
}
