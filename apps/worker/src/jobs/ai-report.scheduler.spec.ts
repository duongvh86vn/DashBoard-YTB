import { describe, expect, it, vi } from "vitest";

import { AiReportScheduler, type AiReportSchedule } from "./ai-report.scheduler.js";
import type { AiReportJobResult } from "./ai-report.job.js";

const logger = { warn: vi.fn() };

function scheduler(input: {
  now: () => Date;
  run?: (
    kind: "DAILY" | "WEEKLY",
    reportDate: Date,
    scheduledCutoffAt: Date,
  ) => Promise<AiReportJobResult>;
  retryMs?: number;
  timeZone?: string;
  schedule?: Partial<AiReportSchedule>;
}) {
  const run = vi.fn(
    input.run ??
      (async () =>
        ({
          status: "SUCCESS",
          report: {},
        }) as unknown as AiReportJobResult),
  );
  return {
    run,
    value: new AiReportScheduler({
      runner: { run },
      logger,
      timeZone: input.timeZone ?? "UTC",
      schedule: {
        dailyEnabled: true,
        dailyHour: 8,
        dailyMinute: 0,
        weeklyEnabled: true,
        weeklyDay: 1,
        weeklyHour: 8,
        weeklyMinute: 15,
        ...input.schedule,
      },
      now: input.now,
      ...(input.retryMs === undefined ? {} : { retryMs: input.retryMs }),
    }),
  };
}

describe("AiReportScheduler", () => {
  it("runs the daily report after its local boundary only once after success", async () => {
    let now = new Date("2026-08-25T07:59:00Z");
    const subject = scheduler({ now: () => now });
    await subject.value.runDue();
    expect(subject.run.mock.calls.filter((call) => call[0] === "DAILY")).toHaveLength(0);
    now = new Date("2026-08-25T08:00:00Z");
    await subject.value.runDue();
    await subject.value.runDue();
    expect(subject.run.mock.calls.filter((call) => call[0] === "DAILY")).toHaveLength(1);
    expect(subject.run).toHaveBeenCalledWith(
      "DAILY",
      new Date("2026-08-25T00:00:00Z"),
      new Date("2026-08-25T08:00:00Z"),
    );
  });

  it("runs weekly only on the configured weekday and retries unavailable work later", async () => {
    let now = new Date("2026-08-24T08:15:00Z"); // Monday
    let attempt = 0;
    const subject = scheduler({
      now: () => now,
      retryMs: 60_000,
      run: async () => {
        attempt += 1;
        return attempt === 1
          ? { status: "UNAVAILABLE", code: "AI_UNAVAILABLE" }
          : ({ status: "SUCCESS", report: {} } as unknown as AiReportJobResult);
      },
    });
    await subject.value.runDue();
    expect(subject.run).toHaveBeenCalledTimes(2); // daily and weekly both become due
    await subject.value.runDue();
    expect(subject.run).toHaveBeenCalledTimes(2);
    now = new Date("2026-08-24T08:16:00Z");
    await subject.value.runDue();
    expect(subject.run).toHaveBeenCalledTimes(3);
    expect(subject.run.mock.calls.map((call) => call[0])).toEqual(["DAILY", "WEEKLY", "DAILY"]);
  });

  it("catches up the most recent weekly occurrence after a next-day restart", async () => {
    const subject = scheduler({ now: () => new Date("2026-08-25T09:00:00Z") }); // Tuesday

    await subject.value.runDue();

    expect(subject.run).toHaveBeenCalledWith(
      "WEEKLY",
      new Date("2026-08-24T00:00:00Z"),
      new Date("2026-08-24T08:15:00Z"),
    );
  });

  it("uses the previous weekly occurrence before this week's configured time", async () => {
    const subject = scheduler({ now: () => new Date("2026-08-24T08:14:00Z") }); // Monday

    await subject.value.runDue();

    expect(subject.run).toHaveBeenCalledWith(
      "WEEKLY",
      new Date("2026-08-17T00:00:00Z"),
      new Date("2026-08-17T08:15:00Z"),
    );
  });

  it("resolves the scheduled cutoff in the configured timezone", async () => {
    const subject = scheduler({
      now: () => new Date("2026-08-25T01:00:00Z"),
      timeZone: "Asia/Bangkok",
    });

    await subject.value.runDue();

    expect(subject.run).toHaveBeenCalledWith(
      "DAILY",
      new Date("2026-08-25T00:00:00Z"),
      new Date("2026-08-25T01:00:00Z"),
    );
  });

  it("never resolves a nonexistent DST-gap wall time before the configured boundary", async () => {
    const subject = scheduler({
      now: () => new Date("2026-03-08T08:00:00Z"),
      timeZone: "America/New_York",
      schedule: {
        dailyHour: 2,
        dailyMinute: 30,
        weeklyEnabled: false,
      },
    });

    await subject.value.runDue();

    expect(subject.run).toHaveBeenCalledWith(
      "DAILY",
      new Date("2026-03-08T00:00:00Z"),
      new Date("2026-03-08T07:00:00Z"),
    );
  });

  it("resolves wall times after a DST overlap with the post-transition offset", async () => {
    const subject = scheduler({
      now: () => new Date("2026-11-01T09:00:00Z"),
      timeZone: "America/New_York",
      schedule: {
        dailyHour: 3,
        dailyMinute: 0,
        weeklyEnabled: false,
      },
    });

    await subject.value.runDue();

    expect(subject.run).toHaveBeenCalledWith(
      "DAILY",
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-01T08:00:00Z"),
    );
  });
});
