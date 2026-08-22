import type { Prisma } from "./generated/prisma/client.js";

import type { UserRecord, UserRoleValue } from "./identity-records.js";
import {
  hasPrismaErrorCode,
  IdentityConflictError,
  IdentityNotFoundError,
} from "./identity-errors.js";

type UserClient = Pick<Prisma.TransactionClient, "user">;

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  role: UserRoleValue;
}

export interface ListUsersInput {
  page: number;
  pageSize: number;
}

export interface UserPage {
  items: UserRecord[];
  total: number;
}

async function mapUserMutation<T>(mutation: () => Promise<T>): Promise<T> {
  try {
    return await mutation();
  } catch (error) {
    if (hasPrismaErrorCode(error, "P2002")) {
      throw new IdentityConflictError();
    }
    if (hasPrismaErrorCode(error, "P2025")) {
      throw new IdentityNotFoundError();
    }
    throw error;
  }
}

export class UserRepository {
  constructor(private readonly client: UserClient) {}

  findById(id: string): Promise<UserRecord | null> {
    return this.client.user.findUnique({ where: { id } });
  }

  findByCanonicalEmail(email: string): Promise<UserRecord | null> {
    return this.client.user.findUnique({ where: { email } });
  }

  countAll(): Promise<number> {
    return this.client.user.count();
  }

  countByRole(role: UserRoleValue): Promise<number> {
    return this.client.user.count({ where: { role } });
  }

  create(input: CreateUserInput): Promise<UserRecord> {
    return mapUserMutation(() => this.client.user.create({ data: input }));
  }

  async list(input: ListUsersInput): Promise<UserPage> {
    const [items, total] = await Promise.all([
      this.client.user.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.client.user.count(),
    ]);

    return { items, total };
  }

  updateEmail(id: string, email: string): Promise<UserRecord> {
    return mapUserMutation(() => this.client.user.update({ where: { id }, data: { email } }));
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await mapUserMutation(() =>
      this.client.user.update({ where: { id }, data: { passwordHash }, select: { id: true } }),
    );
  }

  setEnabled(id: string, enabled: boolean, now: Date): Promise<UserRecord> {
    return mapUserMutation(() =>
      this.client.user.update({
        where: { id },
        data: {
          isEnabled: enabled,
          disabledAt: enabled ? null : now,
        },
      }),
    );
  }
}
