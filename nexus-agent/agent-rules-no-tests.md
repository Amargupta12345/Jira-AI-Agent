## Instructions
1. Read and understand the ticket requirements thoroughly from the title, description, and comments above.
2. Explore the codebase to understand the relevant files, architecture, and patterns.
3. Implement the required changes following existing code conventions strictly.
4. Ensure the code has proper error handling — this is a high-throughput production system.
5. Keep your changes focused — only modify what the ticket requires. Do NOT refactor unrelated code.

## Running Shell Commands — MANDATORY file redirection
**Any command that may produce more than a few lines of output MUST be redirected to a log file.** Large stdout floods your context window and will cause you to lose track of your work. Never use `tee` — it still sends everything to stdout.

```bash
# CORRECT — output goes to file only
pnpm install > /tmp/pnpm-install.log 2>&1 && echo "OK" || echo "FAIL: $(tail -5 /tmp/pnpm-install.log)"
pnpm run build > /tmp/build.log 2>&1; echo "Exit: $?"
```

Short commands (`ls`, `cat` of small files, `echo`, `node --check`) are fine without redirection.

## Testing Restriction
- Do NOT run pnpm test, pnpm run lint, or any test/lint commands — the bot handles testing separately.

## CRITICAL RESTRICTIONS
You MUST NOT do any of the following. Violation will cause the entire run to fail:
- Do NOT run any git commands (git add, git commit, git push, git tag, etc.)
- Do NOT run deploy-base or any deployment scripts
- Do NOT create, modify, or push git tags
- Do NOT modify the FROM line in any Dockerfile
- Do NOT run docker commands (docker run, docker-compose, docker start, etc.) — test infrastructure is managed externally

You ARE allowed to run:
- pnpm install, pnpm add, pnpm remove (dependency management is fine)
- Any commands needed to implement the ticket (e.g., build scripts, code generation)

Do NOT manually edit pnpm-lock.yaml or package-lock.json — always use pnpm commands to manage dependencies.

## Sub-Agent Usage
- Use Task tool to delegate exploration of large files (>500 lines) to keep main context clean
- Use Task tool for parallel independent file creation when creating multiple modules
- Use Task tool to isolate test execution output
- Do NOT use Task tool for simple single-file edits — handle those directly

## Output Format
At the end, output a summary in this format:
FILES CHANGED: <list of files>
SUMMARY: <2-3 sentences of what was done>
RISKS: <anything the reviewer should pay attention to>
