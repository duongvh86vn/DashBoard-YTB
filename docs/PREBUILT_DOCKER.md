# Docker prebuilt quick start

`docker-compose.prebuilt.yml` runs published application images instead of
building Node.js and Playwright images on the clone machine. The PostgreSQL
volume and Compose project name remain `dashboard-ytb`, so switching between
the source-build and prebuilt Compose files does not rotate credentials or
delete monitoring data.

## First image download or application update

The supported update path is `start.bat`. It derives the immutable
`sha-<full-git-commit>` image tag from the checked-out revision, downloads that
complete version, and then starts it. This avoids mixing services from two
commits while a moving branch tag is being promoted.

For manual operation, keep the existing `.env` created by the supported local
setup. Pin the checked-out revision before pulling:

```powershell
$revision = (git rev-parse HEAD).Trim().ToLowerInvariant()
$env:DASHBOARD_IMAGE_TAG = "sha-$revision"
docker compose -f docker-compose.prebuilt.yml pull
docker compose -f docker-compose.prebuilt.yml up -d --wait --remove-orphans
```

Only the first download, or an update with changed image layers, transfers the
full runtime. This path never invokes `docker compose build`.

After the first successful start, Docker Desktop shows one Compose application
named `dashboard-ytb`. Its Stop/Play buttons stop and restart the existing
containers without rebuilding them. Use the commands above again when a new
application version has been published, or simply run `start.bat` after a Git
update.

Open <http://127.0.0.1:3000/login> after all services are healthy.

## Stop without deleting data

```powershell
docker compose -f docker-compose.prebuilt.yml down --remove-orphans
```

Do not add `--volumes` unless database deletion is explicitly intended and a
backup is no longer required.

## Pinned version or rollback

The Compose file defaults to the moving `phase-0-foundation` tag for basic
manual use. Prefer a release or immutable commit build without editing the
Compose file:

```powershell
$env:DASHBOARD_IMAGE_TAG = "v1.0.0"
docker compose -f docker-compose.prebuilt.yml pull
docker compose -f docker-compose.prebuilt.yml up -d --wait --remove-orphans
```

Every published commit is also available as `sha-<full-git-commit>`. Remove the
temporary `DASHBOARD_IMAGE_TAG` environment variable to return to the supported
foundation branch.

## Publishing contract

`.github/workflows/publish-containers.yml` builds five Linux/amd64 targets from
`docker/Dockerfile`: API, Web, Worker, migration and seed. Typecheck, lint,
tests and the production build must pass before any image job starts. Each
target is first published under an immutable commit tag. Only after the
complete image set builds successfully, the workflow verifies anonymous access
to all five immutable images before promoting `phase/0-foundation` to
`phase-0-foundation`, `main` to both `main` and `latest`, or a Git release tag to
the matching container tag. Only the image jobs receive package-write access;
the workflow stores no registry password in the repository.
