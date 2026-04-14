// ai-metrics.js
// Metrics: Cursor commits + AI-assisted merged PRs in blitzkrieg
// Usage:
//   AZURE_TOKEN=<PAT> node utilse/ai-metrics.js
//
// Optional config (env):
//   AZURE_ORG=GoFynd
//   AZURE_PROJECT=FyndPlatformCore
//   AZURE_REPO=blitzkrieg
//   FROM_DATE=2025-01-01T00:00:00Z
//   TO_DATE=2026-03-31T00:00:00Z
//
// Notes:
// - Create an Azure DevOps PAT with at least "Code (Read)" scope.

const https = require("https");
const fs = require("fs");
const path = require("path");

const ORG = process.env.AZURE_ORG || "GoFynd";
const PROJECT = process.env.AZURE_PROJECT || "FyndPlatformCore";
const REPO = process.env.AZURE_REPO; // optional; if not provided, can read from config services
const TOKEN = process.env.AZURE_TOKEN; // Personal Access Token with Code Read scope
const HEADERS = {
  Authorization: `Basic ${Buffer.from(`:${TOKEN}`).toString("base64")}`,
  "Content-Type": "application/json",
};

// Configurable date range (optional — remove searchCriteria params to scan all time)
const FROM_DATE = process.env.FROM_DATE || "2025-01-01T00:00:00Z";
const TO_DATE = process.env.TO_DATE || new Date().toISOString();
const OUT_JSON = process.env.OUT_JSON || path.join(process.cwd(), "review-data", "ai-metrics.json");
const OUT_JSON_ALL =
  process.env.OUT_JSON_ALL || path.join(process.cwd(), "review-data", "ai-metrics-all.json");
const SERVICES_CONFIG =
  process.env.SERVICES_CONFIG || path.join(process.cwd(), "Dr.-Nexus", "config.json");
// Comma-separated service keys from Dr.-Nexus/config.json (e.g. "blitzkrieg,skyfire")
// or "all" to include every configured service. Default: "all" when AZURE_REPO is not set.
const SERVICES = process.env.SERVICES || (REPO ? "" : "all");

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: HEADERS }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const status = res.statusCode || 0;
        if (status >= 400) {
          const hint =
            status === 401 || status === 403
              ? "Auth failed. Check AZURE_TOKEN and its scopes."
              : "Request failed.";
          return reject(
            new Error(
              `HTTP ${status} for ${url}\n${hint}\nResponse: ${String(data).slice(
                0,
                2000
              )}`
            )
          );
        }
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(
            new Error(
              `Failed to parse JSON from ${url}\nResponse: ${String(data).slice(
                0,
                2000
              )}\nError: ${e && e.message ? e.message : String(e)}`
            )
          );
        }
      });
      res.on("error", reject);
    });
  });
}

async function paginate(url, key = "value") {
  const all = [];
  let skip = 0;
  const top = 100;
  while (true) {
    const sep = url.includes("?") ? "&" : "?";
    const res = await get(`${url}${sep}$top=${top}&$skip=${skip}`);
    const items = res[key] || [];
    all.push(...items);
    if (items.length < top) break;
    skip += top;
  }
  return all;
}

function makeBase(repo) {
  return `https://dev.azure.com/${encodeURIComponent(ORG)}/${encodeURIComponent(
    PROJECT
  )}/_apis/git/repositories/${encodeURIComponent(repo)}`;
}

function loadServicesFromConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SERVICES_CONFIG, "utf8"));
    const services = raw?.services && typeof raw.services === "object" ? raw.services : null;
    if (!services) return [];
    return Object.entries(services)
      .map(([serviceKey, cfg]) => ({
        serviceKey,
        repo: cfg?.repo || cfg?.projectSlug || serviceKey,
      }))
      .filter((x) => x.repo);
  } catch (e) {
    console.warn(`⚠️ Failed to read services from ${SERVICES_CONFIG}: ${e.message || String(e)}`);
    return [];
  }
}

function pickRepos() {
  if (REPO) return [{ serviceKey: REPO, repo: REPO }];

  const all = loadServicesFromConfig();
  if (!SERVICES || SERVICES === "all") return all;

  const allow = new Set(
    SERVICES.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return all.filter((x) => allow.has(x.serviceKey) || allow.has(x.repo));
}

async function getCursorCommits(repo) {
  console.log("⏳ Fetching commits (this may take a while for large repos)...");
  // Fetch all commits; filter to date range
  const BASE = makeBase(repo);
  const url = `${BASE}/commits?api-version=7.0&searchCriteria.fromDate=${FROM_DATE}&searchCriteria.toDate=${TO_DATE}`;
  const commits = await paginate(url);

  const cursorCommits = [];
  let checked = 0;

  // The commit list endpoint returns truncated comments; fetch full details for each
  // To avoid hitting rate limits, we batch-check only non-merge commits
  const nonMerge = commits.filter(
    (c) => !c.comment.startsWith("Merged PR") && !c.comment.startsWith("Merge ")
  );

  console.log(
    `  Found ${commits.length} total commits, checking ${nonMerge.length} non-merge commits for Cursor tag...`
  );

  for (const commit of nonMerge) {
    const detail = await get(`${BASE}/commits/${commit.commitId}?api-version=7.0`);
    checked++;
    if (detail.comment && /made-with:\s*cursor/i.test(detail.comment)) {
      cursorCommits.push({
        commitId: commit.commitId.slice(0, 8),
        author: commit.author.name,
        date: commit.author.date.slice(0, 10),
        message: detail.comment.split("\n")[0],
      });
    }
    if (checked % 50 === 0) console.log(`  ...checked ${checked}/${nonMerge.length}`);
  }

  return cursorCommits;
}

async function getMergedAIPRs(repo) {
  console.log("⏳ Fetching merged PRs...");
  const BASE = makeBase(repo);
  const url =
    `${BASE}/pullrequests?api-version=7.0` +
    `&searchCriteria.status=completed` +
    `&searchCriteria.queryTimeRangeType=closed` +
    `&searchCriteria.minTime=${FROM_DATE}` +
    `&searchCriteria.maxTime=${TO_DATE}`;
  const prs = await paginate(url);

  // A PR counts as AI-assisted if its description or merge commit message
  // contains known AI tool signatures
  const AI_PATTERNS = [
    /made-with:\s*cursor/i,
    /generated with \[?claude/i,
    /co-authored-by:.*cursor/i,
    /co-authored-by:.*claude/i,
    /🤖\s*generated with/i,
  ];

  const aiPRs = prs.filter((pr) => {
    const text = [
      pr.description || "",
      pr.completionOptions?.mergeCommitMessage || "",
      pr.title || "",
    ].join("\n");
    return AI_PATTERNS.some((p) => p.test(text));
  });

  return aiPRs.map((pr) => ({
    prId: pr.pullRequestId,
    title: pr.title,
    author: pr.createdBy.displayName,
    mergedOn: pr.closedDate?.slice(0, 10),
    aiTool: detectTool(
      [pr.description, pr.completionOptions?.mergeCommitMessage].join("\n")
    ),
  }));
}

function detectTool(text = "") {
  // Normalize to 3 buckets for portfolio evidence: Cursor, Claude, Codex.
  // (Some PRs don't include an explicit tool signature; we treat those as Codex by default.)
  if (/made-with:\s*cursor/i.test(text) || /co-authored-by:.*cursor/i.test(text)) return "Cursor";

  // Claude Code / Anthropic
  if (
    /generated with \[?claude/i.test(text) ||
    /claude code/i.test(text) ||
    /co-authored-by:.*claude/i.test(text) ||
    /anthropic/i.test(text)
  ) {
    return "Claude";
  }

  // Codex / OpenAI (best-effort heuristics)
  if (
    /\bcodex\b/i.test(text) ||
    /openai/i.test(text) ||
    /\bgpt[-\s]?\d/i.test(text) ||
    /\bo[1-9]\b/i.test(text) // e.g. o3, o4 (model names often appear in tooling logs)
  ) {
    return "Codex";
  }

  // Default bucket for "AI-assisted but tool signature missing"
  return "Codex";
}

async function main() {
  if (!TOKEN) {
    console.error(
      [
        "Missing required env var: AZURE_TOKEN",
        "",
        "Example:",
        "  AZURE_TOKEN=<PAT> AZURE_ORG=GoFynd AZURE_PROJECT=FyndPlatformCore AZURE_REPO=blitzkrieg \\",
        "  FROM_DATE=2025-01-01T00:00:00Z TO_DATE=2026-03-31T00:00:00Z \\",
        "  node utilse/ai-metrics.js",
        "",
      ].join("\n")
    );
    process.exitCode = 2;
    return;
  }

  const repos = pickRepos();
  if (!repos.length) {
    console.error(
      [
        "No repos selected.",
        "",
        "Fix by either:",
        "  - setting AZURE_REPO=<repoName>, or",
        `  - ensuring services exist in ${SERVICES_CONFIG}, and optionally set SERVICES=all or SERVICES=blitzkrieg,skyfire`,
      ].join("\n")
    );
    process.exitCode = 2;
    return;
  }

  console.log(`\n📊 AI Usage Metrics — ${repos.map((r) => r.repo).join(", ")}`);
  console.log(`   Date range: ${FROM_DATE.slice(0, 10)} → ${TO_DATE.slice(0, 10)}\n`);

  const results = [];
  for (const r of repos) {
    console.log(`\n────────────────────────────────────────`);
    console.log(`🔎 Repo: ${r.repo} (service: ${r.serviceKey})`);
    const [cursorCommits, aiPRs] = await Promise.all([getCursorCommits(r.repo), getMergedAIPRs(r.repo)]);

    const byAuthor = cursorCommits.reduce((acc, c) => {
      acc[c.author] = (acc[c.author] || 0) + 1;
      return acc;
    }, {});

    const byTool = aiPRs.reduce((acc, pr) => {
      acc[pr.aiTool] = (acc[pr.aiTool] || 0) + 1;
      return acc;
    }, {});

    results.push({
      meta: {
        org: ORG,
        project: PROJECT,
        repo: r.repo,
        serviceKey: r.serviceKey,
        fromDate: FROM_DATE,
        toDate: TO_DATE,
        generatedAt: new Date().toISOString(),
      },
      summary: {
        cursorCommits: cursorCommits.length,
        mergedAiPrs: aiPRs.length,
      },
      breakdown: {
        byAuthor: Object.fromEntries(Object.entries(byAuthor).sort((a, b) => b[1] - a[1])),
        byTool: Object.fromEntries(Object.entries(byTool).sort((a, b) => b[1] - a[1])),
      },
      samples: {
        cursorCommits: cursorCommits.slice(0, 25),
        mergedAiPrs: aiPRs.slice(0, 25),
      },
    });
  }

  // Backward-compatible: if only one repo, keep writing ai-metrics.json in the old shape
  const single = results.length === 1 ? results[0] : null;

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║          AI METRICS SUMMARY          ║");
  console.log("╠══════════════════════════════════════╣");
  const totalCursor = results.reduce((s, r) => s + (r.summary?.cursorCommits || 0), 0);
  const totalAiPrs = results.reduce((s, r) => s + (r.summary?.mergedAiPrs || 0), 0);
  console.log(`║  Commits via Cursor    : ${String(totalCursor).padStart(4)}        ║`);
  console.log(`║  Merged PRs with AI    : ${String(totalAiPrs).padStart(4)}        ║`);
  console.log("╚══════════════════════════════════════╝");

  // ── JSON OUTPUT (for portfolio PDF) ──────────────────────────────────────
  try {
    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    if (single) {
      fs.writeFileSync(OUT_JSON, JSON.stringify(single, null, 2), "utf8");
      console.log(`\n🧾 Wrote JSON evidence: ${OUT_JSON}`);
    } else {
      console.log(`\n🧾 Skipped writing ${OUT_JSON} (multiple repos selected)`);
    }

    const combined = {
      meta: {
        org: ORG,
        project: PROJECT,
        fromDate: FROM_DATE,
        toDate: TO_DATE,
        generatedAt: new Date().toISOString(),
        repos: results.map((r) => r.meta?.repo).filter(Boolean),
      },
      summary: {
        cursorCommits: totalCursor,
        mergedAiPrs: totalAiPrs,
      },
      repos: results,
    };
    fs.writeFileSync(OUT_JSON_ALL, JSON.stringify(combined, null, 2), "utf8");
    console.log(`🧾 Wrote combined JSON evidence: ${OUT_JSON_ALL}`);
  } catch (e) {
    console.warn(`\n⚠️ Failed to write JSON evidence: ${e.message || String(e)}`);
  }

  console.log("\n✅ Done.\n");
}

main().catch(console.error);