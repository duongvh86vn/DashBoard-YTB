import "reflect-metadata";

import { describe, expect, it } from "vitest";

import { ROLES_METADATA_KEY } from "../auth/roles.decorator.js";
import { AiController } from "./ai.controller.js";

describe("AI controller authorization", () => {
  it.each(["status", "updateSettings", "discoverModels", "testProvider"] as const)(
    "keeps %s ADMIN-only",
    (method) => {
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, AiController.prototype[method])).toEqual([
        "ADMIN",
      ]);
    },
  );
});
