import type { PublicUser } from "@yt-monitor/auth";
import type { Request } from "express";

import type { RequestSession } from "./session-authentication.port.js";

export interface AuthenticatedRequest extends Request {
  user: PublicUser;
  session: RequestSession;
}
