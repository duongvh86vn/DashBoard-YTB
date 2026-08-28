# LAN / Caddy / Cloudflare hosting

The default Compose profile is intentionally loopback-only:

- Web binds `127.0.0.1:3000`.
- API, Worker and PostgreSQL publish no host ports.
- The database network remains internal.
- AI and collector credentials stay in `.env` or encrypted database settings;
  they are never placed in the browser bundle.

## Local Caddy smoke

The optional `hosting` profile adds Caddy in front of Web. Caddy routes
`/api/*` to the internal API service and all other paths to Web, so API is not
exposed as a second public listener.

```powershell
corepack pnpm docker:up
docker compose --profile hosting up -d --wait caddy
pwsh -NoProfile -File .\scripts\assert-hosting-security.ps1
pwsh -NoProfile -File .\scripts\assert-hosting-security.ps1 -HostingProfile
```

Open `http://127.0.0.1:8080/login` for the default hosting profile. This HTTP
listener is a **loopback smoke target**, not a supported public or cross-device
LAN deployment. LOCAL authentication permits HTTP only on loopback, while PUBLIC
authentication requires an HTTPS origin and a Secure session cookie. Do not bind
this listener to `0.0.0.0` as a shortcut. Keep Web, API, Worker and PostgreSQL
unreachable from the LAN; use the HTTPS tunnel topology below for other devices.

## Cloudflare Tunnel

Cloudflare credentials and public DNS are external state and are not committed.
Install `cloudflared` on the host (or the owner-approved tunnel runtime),
authenticate it with the owner account, and point the tunnel at
`http://127.0.0.1:8080`. Set `CADDY_SITE_ADDRESS` to the real hostname,
`DEPLOYMENT_MODE=PUBLIC`, `TRUST_PROXY=true`,
`APP_PUBLIC_URL` and `APP_ALLOWED_ORIGINS` to the real HTTPS origin before
starting the public tunnel. Never put the tunnel token in Git, a browser bundle
or a Compose command line.

The public acceptance test remains pending until the owner supplies the domain,
tunnel token and mobile-network test window. LAN access is deliberately
independent of tunnel availability.

## Public-readiness audit — 2026-08-28

**Verdict:** technically feasible for private remote access behind Cloudflare
Tunnel and Cloudflare Access, but not ready for direct Internet exposure.

Recommended topology:

```text
Browser
  -> Cloudflare HTTPS + Access/MFA + edge rate limit
  -> outbound Cloudflare Tunnel
  -> 127.0.0.1:8080 Caddy
  -> internal Web/API
  -> internal PostgreSQL
```

Do not open inbound ports `3000`, `5000`, `5432` or `8080`. The current positive
controls are the internal database network, no API/Worker/PostgreSQL host ports,
exact-origin CSRF checks, PUBLIC-only Secure/HttpOnly session cookies, Argon2
password hashing and non-root application images.

The following gates remain mandatory before a public release:

1. Add and test a supported PUBLIC bootstrap/update command. `start.bat` is a
   LOCAL workflow and intentionally rejects the PUBLIC trusted-proxy contract.
2. Run a real-domain acceptance test for login/session cookies, CSRF-protected
   writes, logout, reboot/reconnect and Worker health over a mobile network.
3. Automate encrypted off-host database backups with retention and complete a
   restore drill. The current backup scripts are manual and local.
4. Put Cloudflare Access/MFA, edge rate limiting and WAF rules in front of the
   login endpoint. The owner-approved six-character application minimum is not a
   safe operational password policy for an Internet-facing ADMIN account.
5. Use immutable `sha-<commit>` application image tags and document rollback.
   Current published application images support `linux/amd64`; an ARM host needs
   multi-architecture images or supported emulation.
6. Add production observability and edge security policy (access logs without
   secrets, HSTS at the HTTPS edge, and an application-tested CSP) before calling
   the deployment production-ready.

Until all six gates pass, Cloudflare Tunnel testing should be treated as a
controlled private preview, not a production public launch.

Current vendor references used for this assessment:

- [Cloudflare Tunnel routing](https://developers.cloudflare.com/tunnel/routing/)
  documents mapping a public hostname to a loopback HTTP service without opening
  an inbound origin port.
- [Cloudflare Access for self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/)
  documents the identity-aware proxy layer recommended in front of this dashboard.
- [Cloudflare Access MFA requirements](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/mfa-requirements/)
  documents the additional factor policy required for the private preview.
