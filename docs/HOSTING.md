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

Open `http://127.0.0.1:8080/login` for the default hosting profile. To make the site
reachable on the LAN, set `CADDY_HTTP_BIND` to the host LAN address (or
`0.0.0.0`) and choose a firewall rule deliberately. Keep Web loopback-bound;
only Caddy should be reachable from the LAN.

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
