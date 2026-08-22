import type { DatabaseClient } from "./client.js";
import { Prisma } from "./generated/prisma/client.js";

import { ChannelRepository } from "./channel.repository.js";
import { ChannelDailyStatRepository } from "./channel-daily-stat.repository.js";
import { SyncRunRepository } from "./sync-run.repository.js";

export interface ChannelRepositories {
  channels: ChannelRepository;
  dailyStats: ChannelDailyStatRepository;
  syncRuns: SyncRunRepository;
}

export class ChannelUnitOfWork {
  constructor(private readonly client: DatabaseClient) {}

  async transaction<T>(work: (repositories: ChannelRepositories) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.client.$transaction(
          (transaction) =>
            work({
              channels: new ChannelRepository(transaction),
              dailyStats: new ChannelDailyStatRepository(transaction),
              syncRuns: new SyncRunRepository(transaction),
            }),
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (
          attempt === 0 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034"
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Unreachable channel transaction retry state");
  }
}
