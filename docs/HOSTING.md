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

The active owner-approved hostname is `https://ytb.omvkl.com`. Tunnel tokens,
DNS and edge rules remain external state. After each deployment, verify the
HTTPS login/session flow from a mobile network; LAN access remains deliberately
independent of Tunnel availability.

### Supported Windows PUBLIC commands

The owner-approved hostname is configured outside Git in `.env.public` and the
Cloudflare Tunnel. From the repository root, use the Windows launchers:

```text
start-public.bat
update-public.bat
```

`start-public.bat` starts the SHA-pinned prebuilt stack without fetching Git or
forcing container replacement. `update-public.bat` requires a clean
`phase/0-foundation` clone, fetches the remote branch, waits for all immutable
application images, fast-forwards, applies migrations through `db-migrate`,
updates changed application containers while retaining named volumes, and
verifies both the loopback Caddy route and the public HTTPS login/API path.

Both commands are compatible with Windows PowerShell 5.1. They read but never
write `.env.public`; they do not build source images, run `db-seed`, remove
volumes or alter the externally managed Cloudflare Tunnel. `start.bat` remains
strictly LOCAL and must not be used for the public site.

## Owner-approved public deployment — 2026-08-31

The owner selected an Internet-reachable login page protected by the
application's individual user accounts and group authorization. Cloudflare
Access is optional for this topology; Cloudflare Tunnel remains the only route
to the loopback origin, with edge HTTPS, cache bypass and login rate limiting.

Recommended topology:

```text
Browser
  -> Cloudflare HTTPS + edge rate limit
  -> outbound Cloudflare Tunnel
  -> 127.0.0.1:8080 Caddy
  -> internal Web/API
  -> internal PostgreSQL
```

Do not open inbound ports `3000`, `5000`, `5432` or `8080`. The current positive
controls are the internal database network, no API/Worker/PostgreSQL host ports,
exact-origin CSRF checks, PUBLIC-only Secure/HttpOnly session cookies, Argon2
password hashing and non-root application images.

The following operational controls remain important for a public release:

1. Use the supported `start-public.bat` and `update-public.bat` commands.
   `start.bat` intentionally remains a LOCAL workflow.
2. Run a real-domain acceptance test for login/session cookies, CSRF-protected
   writes, logout, reboot/reconnect and Worker health over a mobile network.
3. Automate encrypted off-host database backups with retention and complete a
   restore drill. The current backup scripts are manual and local.
4. Keep edge rate limiting and WAF rules in front of the login endpoint. The
   owner-approved six-character application minimum is not a safe operational
   password choice for an Internet-facing ADMIN account; issued passwords should
   be unique and substantially longer.
5. Use immutable `sha-<commit>` application image tags and document rollback.
   Current published application images support `linux/amd64`; an ARM host needs
   multi-architecture images or supported emulation.
6. Add production observability and edge security policy (access logs without
   secrets, HSTS at the HTTPS edge, and an application-tested CSP) before calling
   the deployment production-ready.

Cloudflare Access/MFA can still be added later as defense in depth, but it is not
part of the owner-selected employee login flow.

Current vendor references used for this assessment:

- [Cloudflare Tunnel routing](https://developers.cloudflare.com/tunnel/routing/)
  documents mapping a public hostname to a loopback HTTP service without opening
  an inbound origin port.
- [Cloudflare published applications](https://developers.cloudflare.com/tunnel/setup/#publish-an-application)
  documents routing a public hostname through the Tunnel; Access is an optional
  additional policy layer.
