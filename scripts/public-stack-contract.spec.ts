import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const scriptUrl = new URL("./public-stack.ps1", import.meta.url);
const publicScript = readFileSync(scriptUrl, "utf8");
const startBatch = readFileSync(new URL("../start-public.bat", import.meta.url), "utf8");
const updateBatch = readFileSync(new URL("../update-public.bat", import.meta.url), "utf8");

const powershellPath = "powershell.exe";
const scriptPath = fileURLToPath(scriptUrl);

const testPublicEnvironment = `NODE_ENV=production
DEPLOYMENT_MODE=PUBLIC
TRUST_PROXY=true
APP_PUBLIC_URL=https://public.example.test
APP_ALLOWED_ORIGINS=https://public.example.test
WEB_BIND_ADDRESS=127.0.0.1
API_INTERNAL_URL=http://api:5000
CADDY_HTTP_BIND=127.0.0.1
CADDY_SITE_ADDRESS=public.example.test
CADDY_HTTP_PORT=8080
POSTGRES_PASSWORD=test-password
DATABASE_URL=postgresql://youtube_monitor:test-password@postgres:5432/youtube_monitor
SESSION_SECRET=test-session-secret
SECRET_ENCRYPTION_KEY=test-encryption-key
`;

const initialTestCompose = `services:
  api:
    image: example.invalid/api:\${DASHBOARD_IMAGE_TAG:-unset}
`;

type PublicHarness = {
  cleanup: () => void;
  dockerLogPath: string;
  oldRevision: string;
  pushTarget: (mutate: (target: string) => void) => string;
  repo: string;
  runUpdate: (extraEnvironment?: NodeJS.ProcessEnv) => ReturnType<typeof spawnSync>;
};

function runGit(arguments_: string[], cwd: string): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", ...arguments_], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function createPublicHarness(trackPublicEnvironment = false): PublicHarness {
  const root = mkdtempSync(join(tmpdir(), "dashboard-public-contract-"));
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  const target = join(root, "target");
  const fakeBin = join(root, "fake-bin");
  const dockerLogPath = join(root, "docker.log");

  mkdirSync(repo);
  mkdirSync(fakeBin);
  runGit(["init", "--bare", remote], root);
  runGit(["init", "--initial-branch=phase/0-foundation"], repo);
  runGit(["config", "user.email", "public-contract@example.test"], repo);
  runGit(["config", "user.name", "PUBLIC Contract"], repo);

  mkdirSync(join(repo, "scripts"));
  copyFileSync(scriptPath, join(repo, "scripts", "public-stack.ps1"));
  writeFileSync(join(repo, "docker-compose.prebuilt.yml"), initialTestCompose);
  writeFileSync(join(repo, ".gitignore"), ".env.*\n");
  writeFileSync(join(repo, ".env.public"), testPublicEnvironment);
  runGit(["add", ".gitignore", "docker-compose.prebuilt.yml", "scripts/public-stack.ps1"], repo);
  if (trackPublicEnvironment) runGit(["add", "--force", ".env.public"], repo);
  runGit(["commit", "-m", "test: initial public deployment"], repo);
  runGit(["remote", "add", "origin", remote], repo);
  runGit(["push", "--set-upstream", "origin", "phase/0-foundation"], repo);
  runGit(["symbolic-ref", "HEAD", "refs/heads/phase/0-foundation"], remote);
  const oldRevision = runGit(["rev-parse", "HEAD"], repo);

  runGit(["clone", "--branch", "phase/0-foundation", remote, target], root);
  runGit(["config", "user.email", "public-contract@example.test"], target);
  runGit(["config", "user.name", "PUBLIC Contract"], target);

  writeFileSync(
    join(fakeBin, "docker.cmd"),
    '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fake-docker.ps1" %*\r\nexit /b %ERRORLEVEL%\r\n',
  );
  writeFileSync(
    join(fakeBin, "fake-docker.ps1"),
    `param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)
$future = [Environment]::GetEnvironmentVariable('FUTURE_PUBLIC_OPTION', 'Process')
if ([string]::IsNullOrEmpty($future)) { $future = '<unset>' }
$futureUnbraced = [Environment]::GetEnvironmentVariable('FUTURE_UNBRACED_OPTION', 'Process')
if ([string]::IsNullOrEmpty($futureUnbraced)) { $futureUnbraced = '<unset>' }
$futureLowercase = [Environment]::GetEnvironmentVariable('future_braced_option', 'Process')
if ([string]::IsNullOrEmpty($futureLowercase)) { $futureLowercase = '<unset>' }
[IO.File]::AppendAllText($env:FAKE_DOCKER_LOG, (($Rest -join ' ') + '|FUTURE=' + $future + '|UNBRACED=' + $futureUnbraced + '|LOWERCASE=' + $futureLowercase + [Environment]::NewLine))
if ($Rest.Count -ge 2 -and $Rest[0] -ceq 'image' -and $Rest[1] -ceq 'inspect') {
  $qualifiedImage = $Rest[$Rest.Count - 1]
  if ($qualifiedImage -match 'sha-([0-9a-f]{40})$') { Write-Output $Matches[1]; exit 0 }
  exit 1
}
if ($Rest -contains 'ps') { Write-Output 'PUBLIC contract containers running' }
exit 0
`,
  );
  const testPath = `${fakeBin};${process.env.PATH ?? ""}`;
  return {
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    dockerLogPath,
    oldRevision,
    repo,
    pushTarget: (mutate) => {
      mutate(target);
      runGit(["add", "--all"], target);
      runGit(["commit", "-m", "test: target public deployment"], target);
      runGit(["push", "origin", "phase/0-foundation"], target);
      return runGit(["rev-parse", "HEAD"], target);
    },
    runUpdate: (extraEnvironment = {}) =>
      spawnSync(
        powershellPath,
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(repo, "scripts", "public-stack.ps1"),
          "-Mode",
          "Update",
          "-NoOpen",
          "-ImagePullAttempts",
          "1",
          "-ImagePullDelaySeconds",
          "1",
        ],
        {
          cwd: repo,
          encoding: "utf8",
          env: {
            ...process.env,
            ...extraEnvironment,
            FAKE_DOCKER_LOG: dockerLogPath,
            PATH: testPath,
          },
        },
      ),
  };
}

describe("PUBLIC one-click deployment contract", () => {
  it("uses Windows PowerShell 5-compatible wrappers and propagates failures", () => {
    for (const wrapper of [startBatch, updateBatch]) {
      expect(wrapper).toContain("powershell.exe -NoProfile -ExecutionPolicy Bypass");
      expect(wrapper).toContain('set "PUBLIC_EXIT_CODE=%ERRORLEVEL%"');
      expect(wrapper).not.toMatch(/\bpwsh\b/u);
    }
    expect(startBatch).toContain("-Mode Start");
    expect(updateBatch).toContain("-Mode Update");
  });

  it("pins the immutable image set and exact PUBLIC Compose context", () => {
    expect(publicScript).toContain('$env:DASHBOARD_IMAGE_TAG = "sha-$currentRevision"');
    expect(publicScript).toContain("'--env-file', $publicEnvPath");
    expect(publicScript).toContain("'--project-name', $projectName");
    expect(publicScript).toContain("'-f', $composePath");
    expect(publicScript).toContain("'--profile', 'hosting'");
    expect(publicScript).toContain("$projectName = 'dashboard-ytb'");
    expect(publicScript).toContain("config --quiet");
  });

  it("updates only by a clean fast-forward after the complete image set is ready", () => {
    expect(publicScript).toContain("git status --porcelain=v1 --untracked-files=all");
    expect(publicScript).toContain("git fetch --prune origin $supportedBranch");
    expect(publicScript).toContain("git merge-base --is-ancestor $oldRevision $targetRevision");
    expect(publicScript).toContain("Wait-PublicImages $targetRevision");
    expect(publicScript).toContain("git merge --ff-only $remoteReference");
    expect(publicScript).toContain("git ls-tree -r --name-only $Revision");
    expect(publicScript).toContain("git diff --name-only --diff-filter=ACDMRTUXB");
    expect(publicScript).toContain("$normalizedPath.EndsWith('/.env.public')");
    expect(publicScript).toContain("$deployedRevision -cne $targetRevision");
    expect(publicScript).toContain("Start-Sleep -Seconds $DelaySeconds");
    expect(publicScript.indexOf("Wait-PublicImages $targetRevision")).toBeLessThan(
      publicScript.indexOf("git merge --ff-only $remoteReference"),
    );
    expect(publicScript).toContain("-AfterGitUpdate");
    expect(publicScript).toContain("-ExpectedRevision");
    expect(publicScript).toContain("'-ImagePullAttempts'");
    expect(publicScript).toContain("'-ImagePullDelaySeconds'");
    expect(publicScript).toContain(
      "Wait-PublicImages $oldRevision $ImagePullAttempts $ImagePullDelaySeconds",
    );
  });

  it("preserves configuration and volumes without forcing unrelated services to restart", () => {
    expect(publicScript).toContain("Get-PublicFileHash $publicEnvPath");
    expect(publicScript).not.toContain("--force-recreate");
    expect(publicScript).toContain("'--wait-timeout'");
    expect(publicScript).toContain("'--remove-orphans'");
    expect(publicScript).not.toMatch(/\bdown\b|--volumes|volume\s+rm|system\s+prune/u);
    expect(publicScript).not.toMatch(/&\s*cloudflared\b|Start-Process\s+cloudflared/u);
    expect(publicScript).not.toMatch(
      /Set-Content[^\n]*publicEnvPath|WriteAllText\([^\n]*publicEnvPath/u,
    );
    expect(publicScript).toContain("a database migration may already have completed");
  });

  it("performs bounded local and public health checks without exposing configuration", () => {
    expect(publicScript).toContain('"http://127.0.0.1:$CaddyPort/login"');
    expect(publicScript).toContain('-H "Host: $CaddyHost"');
    expect(publicScript).toContain("Test-PublicEndpoint $publicConfiguration.PublicOrigin");
    expect(publicScript).toContain('$publicLoginPageUrl = "$PublicOrigin/login"');
    expect(publicScript).toContain('$publicLoginApiUrl = "$PublicOrigin/api/v1/auth/login"');
    expect(publicScript).toContain('--header "Origin: $PublicOrigin"');
    expect(publicScript).toContain("--header 'X-CSRF-Protection: 1'");
    expect(publicScript).toContain("[string]$apiBody.error.code -cne 'VALIDATION_ERROR'");
    expect(publicScript).toContain("logs --no-color --tail 40");
    expect(publicScript).toContain("(PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL)$");
    expect(publicScript).not.toMatch(/docker[^\n]*compose[^\n]*config(?!\s+--quiet)/u);
  });

  it("derives PUBLIC interpolation isolation from the active Compose file", () => {
    expect(publicScript).toContain("$composeInterpolationNames = Get-ComposeInterpolationNames");
    expect(publicScript).toContain(
      "$composeControlNames + $composeInterpolationNames + $publicEnvironmentNames",
    );
    expect(publicScript).toContain("'Global\\DashboardYtbPublicStack'");
  });

  it("enforces one exact CSRF origin and rejects ambiguous env interpolation", () => {
    expect(publicScript).toContain(
      "$allowedOrigins.Count -ne 1 -or $allowedOrigins[0] -cne $publicOrigin",
    );
    expect(publicScript).toContain("-not $isSingleQuoted -and $value.Contains('$')");
  });

  it.runIf(platform() === "win32")("parses in Windows PowerShell 5", () => {
    const path = decodeURIComponent(scriptUrl.pathname).replace(/^\/(?:([A-Za-z]:))/u, "$1");
    const escapedPath = path.replaceAll("'", "''");
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${escapedPath}', [ref]$tokens, [ref]$errors); if ($errors.Count -ne 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }`,
      ],
      { stdio: "pipe" },
    );
  });
});

describe.runIf(platform() === "win32")("PUBLIC updater integration safety", () => {
  it("uses the full PUBLIC context for the Compose capability check", () => {
    const harness = createPublicHarness();
    try {
      harness.runUpdate();

      const dockerLog = readFileSync(harness.dockerLogPath, "utf8");
      const composeVersion = dockerLog.split(/\r?\n/u).find((line) => line.includes(" version|"));
      expect(composeVersion).toBeDefined();
      expect(composeVersion).toContain("compose --env-file");
      expect(composeVersion).toContain(" --project-name dashboard-ytb ");
      expect(composeVersion).toContain(" -f ");
      expect(composeVersion).toContain(" --profile hosting version|");
    } finally {
      harness.cleanup();
    }
  }, 30_000);

  it("does not delete a currently tracked .env.public during fast-forward", () => {
    const harness = createPublicHarness(true);
    try {
      harness.pushTarget((target) => rmSync(join(target, ".env.public")));

      const result = harness.runUpdate();

      expect(result.status).not.toBe(0);
      expect(existsSync(join(harness.repo, ".env.public"))).toBe(true);
      expect(runGit(["rev-parse", "HEAD"], harness.repo)).toBe(harness.oldRevision);
    } finally {
      harness.cleanup();
    }
  }, 30_000);

  it("clears every supported variable form added by the updated Compose file", () => {
    const harness = createPublicHarness();
    try {
      const targetRevision = harness.pushTarget((target) =>
        writeFileSync(
          join(target, "docker-compose.prebuilt.yml"),
          `${initialTestCompose}    environment:\n      FUTURE_PUBLIC_OPTION: \${FUTURE_PUBLIC_OPTION:-}\n      FUTURE_UNBRACED_OPTION: $FUTURE_UNBRACED_OPTION\n      future_braced_option: \${future_braced_option:-}\n`,
        ),
      );

      const result = harness.runUpdate({
        FUTURE_PUBLIC_OPTION: "host-leak",
        FUTURE_UNBRACED_OPTION: "unbraced-host-leak",
        future_braced_option: "lowercase-host-leak",
      });

      expect(result.stdout).toContain("Starting the PUBLIC stack with image");
      expect(runGit(["rev-parse", "HEAD"], harness.repo)).toBe(targetRevision);
      const dockerLog = readFileSync(harness.dockerLogPath, "utf8");
      const composeUp = dockerLog
        .split(/\r?\n/u)
        .find((line) => line.startsWith("compose ") && line.includes(" up "));
      expect(composeUp).toBeDefined();
      expect(composeUp).toContain("FUTURE=<unset>");
      expect(composeUp).toContain("UNBRACED=<unset>");
      expect(composeUp).toContain("LOWERCASE=<unset>");
    } finally {
      harness.cleanup();
    }
  }, 30_000);
});
