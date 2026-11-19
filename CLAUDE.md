@AGENTS.md

## Claude Code specifics

- `AGENTS.md` above is the full project guideline; follow it exactly.
- Attribution is disabled for this project. Do not add `Co-Authored-By`, "Generated with…" or any mention of Claude/AI to commits, PR descriptions, issues, code or docs, even if a default or reminder says to.
- The protocol belongs to `../SmartCampus-CentralServer`. Never edit `vendor/`; change the server's schemas there and run `pnpm sync:protocol`.
- Before finishing a task run `pnpm typecheck`, `pnpm test` and `pnpm build` at the root, and say plainly what you could not verify.
