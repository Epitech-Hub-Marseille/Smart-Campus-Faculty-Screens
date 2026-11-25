# Contributing to Smart Campus Faculty Screens

Thank you for helping. This is the Faculty screen of Smart Campus: a Node agent that holds the device key and the
connection, and a kiosk page (Chromium) that only draws. [`AGENTS.md`](AGENTS.md) is the full guideline; this page is the short version.

## Before you start

- Open or pick an issue first for anything larger than a typo.
- The agent follows the protocol of the [central server](https://github.com/Epitech-Hub-Marseille/Smart-Campus-Central-Server) to the letter.
  After a protocol change there, run `pnpm sync:protocol` here and say so in the PR.
- The kiosk page holds no key and does no cryptography: that stays in the agent.

## Set up

Needs Node.js and pnpm.

```bash
pnpm install
pnpm dev:agent      # needs .env (SERVER_URL, SERVER_PUBLIC_KEY, DATA_DIR=./data ...)
pnpm dev:display    # Vite on 5173, proxies to the agent on 3000
```

## Check your work

At the repository root:

```bash
pnpm typecheck
pnpm test
pnpm build
```

- Logic goes in a package with a Vitest test. Anything that touches the wire (handshake, framing, commands, downloads) is
  tested against `src/testing/fakeGateway.ts`, including tampering, replay, out-of-order and wrong-key cases.
- For anything the screen shows, look at it in a browser at 1920x1080 and say what you could not check (sound, a real
  panel, a real Raspberry Pi).
- For a change across repositories, run the agent against the server's dev stack and exercise it end to end.

## Conventions

- **Agent**: ESM with `module: NodeNext`, relative imports end in `.js`. Read configuration only through `src/config.ts` (a new
  variable also goes in `.env.example` and `docker-compose.yml`). Every inbound message goes through `parseServerMessage` (zod)
  first. Treat all server input as hostile: size-limited, schema-validated, idempotent. File names are built from a checked id
  and a known type, never from server text. Frames are strictly numbered and encrypted; anything out of order or in plaintext closes the connection.
- **Display**: the scene system is data driven. A tile of a kind the screen does not know is skipped, never an error.
- Never log or return the device key or any key material.

Allowed commit scopes: `agent`, `display`, `local`, `protocol`, `kiosk`, `infra`, `docs`, `deps`.

## Commits and pull requests

- Branch from `main`: `<type>/<short-kebab-description>`, for example `feat/live-announcement`. Never push to `main` directly.
- [Conventional Commits](https://www.conventionalcommits.org/) for every commit and PR title: `<type>(<scope>): <subject>`. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Subject in the imperative, lowercase start, no trailing period, 72 characters at most.
- One logical change per commit. Do not mix a refactor with a behaviour change.
- Explain *why* in the body when it is not obvious. Link issues with `Closes #12` or `Refs #7`.
- A PR says what changed and why, how you verified it, and what you could not verify (sound, real hardware, a browser). Keep it small enough to review.
- `main` is protected: a PR needs one approving review.

## Security

Never commit secrets: `.env` files, private keys, certificates, tokens. Only `.env.example` is tracked. Never log or return passwords, hashes, session tokens or key material. To report a vulnerability, do not open a public issue: use the repository's **Security** tab (private vulnerability reporting) or contact a maintainer privately.

## Licence of your contribution

This project is released under the [PolyForm Noncommercial License 1.0.0](LICENSE). By opening a pull request you agree that your contribution is licensed under the same terms.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

