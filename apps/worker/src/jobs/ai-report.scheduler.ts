import type { Logger } from "pino";

import type { AiReportJobResult } from "./ai-report.job.js";

interface LocalScheduleParts {
  date: string;
  weekday: number;
  hour: number;
  minute: number;
}

export interface AiReportSchedule {
  dailyEnabled: boolean;
  dailyHour: number;
  dailyMinute: number;
  weeklyEnabled: boolean;
  weeklyDay: number;
  weeklyHour: number;
  weeklyMinute: number;
}

export interface AiReportSchedulerDependencies {
  runner: {
    run(
      kind: "DAILY" | "WEEKLY",
      reportDate: Date,
      scheduledCutoffAt: Date,
    ): Promise<AiReportJobResult>;
  };
  logger: Pick<Logger, "warn">;
  timeZone: string;
  schedule: AiReportSchedule;
  pollMs?: number;
  retryMs?: number;
  now?: () => Date;
}

const weekdays: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function localParts(now: Date, timeZone: string): LocalScheduleParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: weekdays[value("weekday")] ?? -1,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function isPast(hour: number, minute: number, targetHour: number, targetMinute: number): boolean {
  return hour > targetHour || (hour === targetHour && minute >= targetMinute);
}

function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function scheduledLocalInstant(date: string, hour: number, minute: number, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const representedAsUtc = (instant: number): number => {
    const values = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
    );
  };
  const hourMs = 60 * 60_000;
  const possibleOffsets = new Set<number>();
  for (const hoursFromTarget of [-48, -24, -12, 0, 12, 24, 48]) {
    const sample = targetAsUtc + hoursFromTarget * hourMs;
    possibleOffsets.add(representedAsUtc(sample) - sample);
  }
  const exactCandidates = (wallTimeAsUtc: number): number[] =>
    [...possibleOffsets]
      .map((offset) => wallTimeAsUtc - offset)
      .filter((candidate) => representedAsUtc(candidate) === wallTimeAsUtc)
      .sort((left, right) => left - right);

  const exact = exactCandidates(targetAsUtc);
  if (exact.length > 0) return new Date(exact[0]!);

  // A wall time inside a DST gap does not exist. Run at the first valid local
  // minute after it, never at an instant that formats to before the configured time.
  for (let minuteOffset = 1; minuteOffset <= 24 * 60; minuteOffset += 1) {
    const nextWallTime = targetAsUtc + minuteOffset * 60_000;
    const candidates = exactCandidates(nextWallTime);
    if (candidates.length > 0) return new Date(candidates[0]!);
  }
  throw new RangeError(`Unable to resolve scheduled local time ${date} ${hour}:${minute}`);
}

export class AiReportScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly completed = new Set<string>();
  private readonly running = new Set<string>();
  private readonly attemptedAt = new Map<string, number>();

  constructor(private readonly dependencies: AiReportSchedulerDependencies) {}

  start(): void {
    if (this.timer) return;
    void this.runDue();
    this.timer = setInterval(() => void this.runDue(), this.dependencies.pollMs ?? 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runDue(): Promise<void> {
    const now = this.currentTime();
    const local = localParts(now, this.dependencies.timeZone);
    const due: Array<{
      kind: "DAILY" | "WEEKLY";
      date: string;
      scheduledCutoffAt: Date;
    }> = [];
    const schedule = this.dependencies.schedule;
    if (
      schedule.dailyEnabled &&
      isPast(local.hour, local.minute, schedule.dailyHour, schedule.dailyMinute)
    ) {
      due.push({
        kind: "DAILY",
        date: local.date,
        scheduledCutoffAt: scheduledLocalInstant(
          local.date,
          schedule.dailyHour,
          schedule.dailyMinute,
          this.dependencies.timeZone,
        ),
      });
    }
    if (schedule.weeklyEnabled) {
      let daysSinceScheduledWeekday = (local.weekday - schedule.weeklyDay + 7) % 7;
      if (
        daysSinceScheduledWeekday === 0 &&
        !isPast(local.hour, local.minute, schedule.weeklyHour, schedule.weeklyMinute)
      ) {
        daysSinceScheduledWeekday = 7;
      }
      const weeklyDate = addCalendarDays(local.date, -daysSinceScheduledWeekday);
      due.push({
        kind: "WEEKLY",
        date: weeklyDate,
        scheduledCutoffAt: scheduledLocalInstant(
          weeklyDate,
          schedule.weeklyHour,
          schedule.weeklyMinute,
          this.dependencies.timeZone,
        ),
      });
    }
    for (const occurrence of due) {
      await this.runOne(occurrence.kind, occurrence.date, occurrence.scheduledCutoffAt, now);
    }
  }

  private async runOne(
    kind: "DAILY" | "WEEKLY",
    date: string,
    scheduledCutoffAt: Date,
    now: Date,
  ): Promise<void> {
    const key = `${kind}:${date}`;
    const retryMs = this.dependencies.retryMs ?? 30 * 60_000;
    const lastAttempt = this.attemptedAt.get(key);
    if (
      this.completed.has(key) ||
      this.running.has(key) ||
      (lastAttempt !== undefined && now.getTime() - lastAttempt < retryMs)
    ) {
      return;
    }
    this.running.add(key);
    this.attemptedAt.set(key, now.getTime());
    try {
      const result = await this.dependencies.runner.run(
        kind,
        new Date(`${date}T00:00:00.000Z`),
        scheduledCutoffAt,
      );
      if (
        result.status === "SUCCESS" ||
        (result.status === "SKIPPED" && result.reason === "CACHE_HIT")
      ) {
        this.completed.add(key);
      }
    } catch (error) {
      this.dependencies.logger.warn(
        {
          code: "AI_REPORT_SCHEDULE_FAILED",
          kind,
          date,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "AI report schedule failed safely",
      );
    } finally {
      this.running.delete(key);
      if (this.completed.size > 100) this.completed.clear();
      if (this.attemptedAt.size > 100) this.attemptedAt.clear();
    }
  }

  private currentTime(): Date {
    return (this.dependencies.now ?? (() => new Date()))();
  }
}
