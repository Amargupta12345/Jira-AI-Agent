## Instructions
1. Read and understand the ticket requirements thoroughly from the title, description, and comments above.
2. Explore the codebase to understand the relevant files, architecture, and patterns.
3. Implement the required changes following existing code conventions strictly.
4. Ensure the code has proper error handling — this is a high-throughput production system.
5. Keep your changes focused — only modify what the ticket requires. Do NOT refactor unrelated code.
6. Run tests and iterate until they pass (see Testing & Validation below).

## Running Shell Commands — MANDATORY file redirection
**Any command that may produce more than a few lines of output MUST be redirected to a log file.** Large stdout floods your context window and will cause you to lose track of your work. Never use `tee` — it still sends everything to stdout.

```bash
# CORRECT — output goes to file only
pnpm install > /tmp/pnpm-install.log 2>&1 && echo "OK" || echo "FAIL: $(tail -5 /tmp/pnpm-install.log)"
./run.test.sh > /tmp/test-output.log 2>&1; echo "Exit: $?"
pnpm run build > /tmp/build.log 2>&1; echo "Exit: $?"

# WRONG — do NOT do any of these:
pnpm install                             # large output floods context
./run.test.sh                            # test output floods context
./run.test.sh 2>&1 | tee test.log       # tee still sends to stdout
./run.test.sh | tail -50                 # pipe still buffers full output
```

After any redirected command, read results with `tail`:
```bash
tail -80 /tmp/test-output.log    # summary is always at the end
```

Short commands (`ls`, `cat` of small files, `echo`, `node --check`) are fine without redirection.

## Testing & Validation
After making your code changes, you MUST validate them by running tests.

### Test procedure — analyze logs, don't re-run blindly
Each test run takes minutes of wall-clock time. Minimize runs by analyzing log files thoroughly before making fixes.

1. **Discover the test command** — check these in order:
   - CLAUDE.md in the repo root (may specify a custom test command or shell script)
   - `run.test.sh` or `test.sh` in the repo root (run via `bash run.test.sh`)
   - `pnpm test` as a fallback
2. **Install dependencies first** if needed (`pnpm install > /tmp/pnpm-install.log 2>&1`).
3. **Run tests once to a file** and check the exit code:
   ```bash
   ./run.test.sh > /tmp/test-output.log 2>&1; echo "Exit: $?"
   ```
4. **Analyze the log file — do NOT re-run yet.**
   - `tail -80 /tmp/test-output.log` — test summary (pass/fail counts) is at the end.
   - `grep -n "FAIL\|Error\|AssertionError" /tmp/test-output.log` — find every failure.
   - `grep -B5 "FAIL" /tmp/test-output.log` — get context around failures.
   - Read specific line ranges with `sed -n '100,150p' /tmp/test-output.log` if you need more context.
   - Identify **all** failures and their root causes from this single log. Do not fix one and re-run to discover the next.
5. **Fix all issues at once** based on your log analysis.
6. **Run tests again to confirm.** Analyze the new log the same way.
7. **If still failing:** repeat the analyze-fix-run cycle. You may run tests up to **5 times** total. If tests still fail after 5 runs, stop — note the remaining failures in your summary and move on.
8. **Follow ticket comments** — if comments mention test isolation (e.g., `fdescribe`/`fit`), use it during debugging, but **always revert `fdescribe`/`fit` back to `describe`/`it` before finishing**.
9. **Pre-existing failures** — if tests clearly unrelated to your changes were already failing, note them in your summary but don't get stuck trying to fix them.
10. Do NOT run lint commands (`pnpm run lint`, `eslint`, etc.) — those are not required.

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
