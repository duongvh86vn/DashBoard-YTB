# YouTube Home Monitor

Private dashboard for deterministic monitoring of public YouTube channels.

The project is built phase by phase from
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md). Phases 0–12 provide the
authenticated Vietnamese dashboard, canonical public-channel monitoring, health
and deletion safety, video snapshots/rankings, structured Gemini/NVIDIA AI with
fallback, sync history, collector/runtime settings, channel groups and
server-authoritative VIEWER access scopes. Phase 12 adds a daily full-upload
catalog, one evidence-backed top view-gaining video per channel, effective-dated
manual monetization/RPM history and deterministic estimated revenue.

The channel detail view includes a public-intelligence panel with metric-level
source, precision and coverage. Daily/weekly AI reports are an optional explanation
layer over cited local evidence; they never replace public metrics or invent missing
history. The application does not require vidIQ, browser cookies or Google login.

## Runtime baseline

- Node.js 24 LTS
- pnpm 11.22.0
- Docker Desktop with Linux containers

Use `corepack pnpm` in terminals where a global `pnpm` shim is unavailable.

## Clone the current implementation branch

Clone the supported implementation branch explicitly:

```text
git clone --branch phase/0-foundation --single-branch https://github.com/duongvh86vn/DashBoard-YTB.git
cd DashBoard-YTB
```

Update an existing clone before starting the new version:

```powershell
git switch phase/0-foundation
git pull --ff-only origin phase/0-foundation
.\start.bat
```

## Fastest local startup

The supported clone startup is Docker-only. Host Node.js, pnpm, Corepack,
`Copy-Item`, and a permanently relaxed PowerShell policy are not required.
Docker Desktop must be running Linux containers.

Windows (cách nhanh nhất): nhấp đúp vào `start.bat` ở thư mục gốc dự án.
Script tải image dựng sẵn từ GHCR cho **commit đang checkout** rồi chỉ
chạy `docker compose up` ở những lần sau; nó không tự chạy `git pull`
và không build lại ứng dụng mỗi lần mở.
Tệp giữ cửa sổ khi lỗi và tự in log API đã che bí mật.

PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-fast.ps1
```

CMD or Git Bash:

```text
scripts\start-fast.cmd
```

On the first run the script creates an ignored `.env` with random stable local
secrets, asks for the ADMIN email and hidden password, runs migrations and
starts the prebuilt stack. Restarting reuses the same `.env`, images and
PostgreSQL volume; it does not rotate credentials or ask for the ADMIN password
again. Open `http://127.0.0.1:3000/login`. Use `-NoOpen` when automation should
not open a browser. Run `setup.bat` only for first-time repair/reinitialization;
if published images are temporarily unavailable it safely falls back to one
local build without deleting the database.

After one successful start, Docker Desktop displays the `dashboard-ytb`
Compose application. Its Play button restarts the already-installed containers
directly; it does not update Git or install a newer application version.
See [`docs/PREBUILT_DOCKER.md`](./docs/PREBUILT_DOCKER.md) for update, pinned-tag
and rollback commands.

If an existing `.env` is not the exact LOCAL loopback configuration, the script
stops without overwriting it. If a newly created `.env` does not match an old
volume's PostgreSQL credential, restore the original `.env`; never delete the
volume to work around the error. `docker compose down --remove-orphans` stops
the stack while preserving data. The following is destructive and removes the
database volume only after you have confirmed the project:

```text
docker compose down --volumes --remove-orphans
```

This local setup is loopback-only by default. An optional Caddy hosting profile
is documented in [`docs/HOSTING.md`](./docs/HOSTING.md); it keeps API and
PostgreSQL private. After login, open
`http://127.0.0.1:3000/channels` to add a public channel as ADMIN; the first
snapshot is nullable until a collector succeeds, and no historical values are
fabricated.

ADMIN then creates a group and assigns channels at
`http://127.0.0.1:3000/channel-groups`, and assigns one or more groups to each
VIEWER at `http://127.0.0.1:3000/users`. ADMIN always sees all channels. A VIEWER
sees the union of channels in their active groups; a VIEWER with no group sees
no channels.

Metric labels remain intentionally conservative: `≥ X` is a known subscriber
lower bound, while `0* · chưa xác minh` is only a per-channel display fallback
for a missing public counter (the stored value remains `NULL`). A `PARTIAL`
timeline always shows its covered/total channel count and never invents missing
history.

The dashboard group selector limits every KPI, chart and feed to the selected
server-authorized channel group; the channel selector defaults to all channels
in that group and can narrow the same scope to one channel. A VIEWER can only
select groups/channels in their assigned union. An out-of-scope or mismatched
selection is returned as not found rather than leaking whether it exists.

The daily video feed is not a publication detector. Once per local day, the
Worker enumerates every public upload returned by the metadata-only collector,
stores nullable public counters, and compares two canonical full-catalog scans.
For each selected channel it shows at most the video with the greatest positive
view delta for that day. A newly seen video has no baseline and is never treated
as starting from zero; warm-up, partial and unavailable coverage remain visible.

ADMIN can record one of three channel monetization states: unconfigured,
explicitly not monetized, or monetized with a non-negative manual USD RPM. Each
review creates an effective-dated history row instead of rewriting past RPM.
VIEWER can see the effective state only inside their channel scope and cannot
change it. `Doanh thu ước tính từ RPM thủ công` is calculated deterministically
from signed public daily view delta × the effective manual RPM / 1,000. An
explicitly non-monetized channel is known zero; missing RPM or view evidence
remains `NULL`. A partial observed sum is labelled partial—not total revenue or
a lower bound. It is never presented as actual YouTube Analytics revenue.

AI remains an optional explanation layer over these stored facts. It does not
enumerate uploads, select or alter the winning video, infer RPM, calculate
revenue, fill missing counters or manufacture history. The backend neither logs
in to Google/YouTube nor depends on vidIQ, its extension, cookies or private API.

## Install and verify

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm verify
pwsh -NoProfile -File .\scripts\assert-hosting-security.ps1
```

The integration gate creates an isolated Compose project, random
credentials and an unused loopback Web port. It exercises real PostgreSQL
migrations, seed idempotency, auth/users/channel-group authorization, group
membership changes, scoped channel reads, partial metric contracts, collector
fixtures, full-catalog coverage and daily video attribution, effective-dated RPM
history, deterministic revenue contracts, health-state transitions, worker and
database recovery, the containerized Playwright browser flow, secret-safe
surfaces, and cleanup.

## Runtime topology

Only Web is published, on loopback at `http://127.0.0.1:3000` by default. API,
Worker and PostgreSQL publish no host ports; the database network is internal,
Web does not join it, and Worker has a separate non-published egress network for
public RSS/metadata-only collectors. Every API health route requires an ADMIN
session; there is no anonymous Web `/health` route. Container readiness uses
internal TCP checks. Docker pins the official `yt-dlp 2026.08.19` artifact by
SHA-256 rather than relying on the stale distribution package; the optional public
runtime probe is documented in [testing](./docs/TESTING.md).

See [architecture](./docs/ARCHITECTURE.md), [testing](./docs/TESTING.md),
[hosting](./docs/HOSTING.md), [backup/restore](./docs/BACKUP.md) and the
[implementation plan](./IMPLEMENTATION_PLAN.md) for phase boundaries and
verification details.
