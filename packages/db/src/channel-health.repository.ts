import type { Prisma as PrismaTypes } from "./generated/prisma/client.js";
import type { ChannelHealthCheckRecord } from "./channel-records.js";

type HealthClient = Pick<PrismaTypes.TransactionClient, "channelHealthCheck">;

export interface CreateChannelHealthCheckInput {
  channelId: string;
  checkedAt: Date;
  publicPageStatus: string;
  ytdlpStatus: string;
  rssStatus: string;
  normalizedAvailability:
    | "ACTIVE"
    | "DELETED_OR_TERMINATED"
    | "NOT_FOUND"
    | "TEMPORARILY_UNAVAILABLE"
    | "CHECK_FAILED"
    | "UNKNOWN"
    | "ARCHIVED";
  evidenceCode: string;
  evidenceTextSafe: string | null;
  httpStatus: number | null;
  durationMs: number;
}

export interface ChannelHealthPage {
  items: ChannelHealthCheckRecord[];
  total: number;
}

export class ChannelHealthRepository {
  constructor(private readonly client: HealthClient) {}

  create(input: CreateChannelHealthCheckInput): Promise<ChannelHealthCheckRecord> {
    return this.client.channelHealthCheck.create({ data: input });
  }

  async list(channelId: string, page: number, pageSize: number): Promise<ChannelHealthPage> {
    const where = { channelId };
    const [items, total] = await Promise.all([
      this.client.channelHealthCheck.findMany({
        where,
        orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.client.channelHealthCheck.count({ where }),
    ]);
    return { items, total };
  }
}
