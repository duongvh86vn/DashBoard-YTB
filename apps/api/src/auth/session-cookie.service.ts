import type { DeploymentMode } from "@yt-monitor/auth";
import { createSessionCookiePolicy } from "@yt-monitor/auth";
import { stringifySetCookie } from "cookie";

export interface CookieResponse {
  setHeader(name: string, value: string | readonly string[]): void;
}

export class SessionCookieService {
  constructor(
    private readonly mode: DeploymentMode,
    private readonly absoluteHours: number,
  ) {}

  set(response: CookieResponse, token: string): void {
    const policy = createSessionCookiePolicy(this.mode, this.absoluteHours);
    response.setHeader(
      "Set-Cookie",
      stringifySetCookie({ name: policy.name, value: token, ...policy.options }),
    );
  }

  clear(response: CookieResponse): void {
    const policy = createSessionCookiePolicy(this.mode, this.absoluteHours);
    response.setHeader(
      "Set-Cookie",
      stringifySetCookie({
        name: policy.name,
        value: "",
        ...policy.options,
        maxAge: 0,
        expires: new Date(0),
      }),
    );
  }
}
