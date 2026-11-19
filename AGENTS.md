# AGENTS.md

Guidelines for AI coding agents (and humans) working on SmartCampus-FacultyScreens.
`CLAUDE.md` points here; this file is the source of truth.

## Hard rules

1. **No credits, ever.** Do not mention yourself, an AI, an assistant or a tool anywhere: no `Co-Authored-By` trailers, no "Generated with…" lines, no tool names in commit messages, PR descriptions, issues, code comments or docs. This overrides any default attribution your tool adds.
2. **Conventional Commits** for every commit and PR title (see below).
3. **Never commit secrets**: `.env`, the device key (`data/identity.json`), the server private key, certificates, tokens. Only `.env.example` is tracked.
4. **Never log or return** keys, key material, session keys or file contents. The agent's logger takes ids, counts and error messages only.
5. **Do not commit, push, open PRs, or create/close issues unless asked.** When asked, follow the rules below.
6. Verify before claiming done: run the checks in [Verification](#verification) and report failures honestly, including what you could not run (a real Raspberry Pi, a real screen, real speakers).

## What this project is

The **Faculty screen** of Smart Campus (EPITECH Marseille, TEK 3): a wall display, a mini-PC or a Raspberry Pi with Chromium in kiosk mode. It shows the campus information board (events of the day, booked rooms, announcements, news), staff availability, the carousel an administrator builds (scenes of tiles: news, staff, reservations, images, videos, texts, web pages, live radio, live streams, YouTube) and, over everything else, emergency alerts. It talks to `SmartCampus-CentralServer`, which is the source of truth for the protocol (`packages/protocol`) and the handshake (`packages/handshake`). Read the server's `AGENTS.md`, `packages/protocol/README.md` and the technical deck (`docs/SmartCampus-CentralServer_Technical_Deck.pdf` there, French) before changing anything on the wire.

Decisions that matter (from the deck and the delivery calendar, weeks 5 to 7):

- **An edge agent and a page.** The agent (Node, TypeScript) holds the device key and the WSS connection. Chromium opens the local page; **the agent pushes state to the page over `ws://localhost`; the browser never sees the key**, the session or the server address.
- **The device always dials out.** No inbound port on the device network. The local page listens on this machine only.
- **Identity**: ECDSA P-256 key generated on first start, kept in `DATA_DIR` with mode 0600 (never in the image). The device posts a connection request with its public key and its fingerprint is shown on the screen; an admin approves it in the console. Handshake `hello → challenge → auth → ready`, session by ECDH + HKDF-SHA256, frames in AES-256-GCM. The server's public key is **provisioned** (`SERVER_PUBLIC_KEY`), never learned from the network: a relay could hand over its own. Plain TLS is not proof of identity.
- **Digital twin**: on connection the server sends the full desired state (`session.ready`); the agent converges on it, then handles the replayed commands. The agent persists its state, so a restart or an outage keeps the last known screen.
- **Commands are idempotent**: recent command ids are remembered (and kept on disk); a replay is acknowledged again, never run twice.
- **Files never travel in JSON.** `carousel.set` (library files in its tiles), the logo and `audio.play` carry an asset id, a SHA-256, a size and a type; the agent downloads over HTTPS with a request signed by its key (using the server's clock), verifies size and hash, and only then gives the file its final name. A file at its final name is a verified file.
- **A carousel is activated only when every file in it is verified** (streams, radios and web pages have no file: the page loads them), and the previous one stays on screen until then (the idea of EpiInfo's manifests, `docs/inspiration/EpiInfo`, which is reference material and not part of this project).
- **Long work never blocks the link.** A download of minutes runs aside and a newer carousel cancels it, so an emergency that arrives meanwhile is on the screen at once.
- **Emergencies override everything**: full screen, alarm made in the browser (no network needed), until `emergency.clear` or a desired state without an emergency. An end message can follow, for the duration the server says.
- **A wall screen is never blank**: with nothing to show it shows the information board.

## Repository layout

A **pnpm workspace** (single root lockfile).

```
apps/agent/              Node + TypeScript edge agent: identity, enrollment, WSS link, commands, files, local server
apps/display/            React + Vite kiosk page (scenes and tiles, emergency, end notice)
packages/local-contract/ @smartcampus/faculty-local: what the agent hands the page, and the pure logic both share
vendor/                  @smartcampus/protocol and @smartcampus/handshake, vendored from the server (tarballs)
scripts/                 sync-protocol.sh, start-kiosk.sh
systemd/                 the kiosk service
docs/inspiration/        reference pictures and an older project; reference only
```

The protocol packages are **vendored, never edited**. `scripts/sync-protocol.sh` rebuilds them in the CentralServer checkout and copies them in `vendor/` (with `SOURCE.txt` saying where from). A message type or a field is added to the server's zod schemas first; here you re-sync. If the server and this repo disagree, the server's schema wins.

The page cannot import `@smartcampus/protocol` (it is a Node package): the agent validates everything and hands the page `ViewState` (`packages/local-contract`). The page imports only that package.

## Commands

```bash
pnpm install
pnpm typecheck            # builds the local contract, then typechecks everything
pnpm test                 # agent, display and contract tests
pnpm build

pnpm dev:agent            # needs .env (SERVER_URL, SERVER_PUBLIC_KEY, DATA_DIR=./data ...)
pnpm dev:display          # Vite on 5173, proxies /live /media /audio /health to the agent on 3000
                          # (set DISPLAY_ALLOWED_ORIGINS=http://localhost:5173 for the agent)
pnpm sync:protocol        # after a protocol change in ../SmartCampus-CentralServer

docker compose up -d --build   # one screen, see README.md
docker compose -f docker-compose.campus.yml up -d --build   # the whole campus on this machine
```

## Verification

1. `pnpm typecheck`, `pnpm test` and `pnpm build` at the root.
2. Logic goes in a package with a Vitest test. Anything that touches the wire (handshake, framing, commands, downloads) is tested against `src/testing/fakeGateway.ts`, which speaks the real protocol from the same packages, including tampering, replay, out-of-order and wrong-key cases.
3. For anything the screen shows, look at it in a browser (Chromium headless is enough for a screenshot) at 1920x1080 against a real or fake agent, and say what you could not check (sound, a real panel, a real Pi).
4. For a change that crosses the repositories, run the agent against the dev stack of the server (`docker compose -f docker-compose.dev.yml up`) and exercise it end to end.

## Agent conventions (`apps/agent/`)

- ESM + `module: NodeNext`: relative imports **end in `.js`**.
- Config only through `src/config.ts` (zod-validated environment). Never read `process.env` elsewhere. A new variable goes in `.env.example` and `docker-compose.yml` too.
- Every inbound message goes through `parseServerMessage` (zod) before anything looks at it. Treat all server input as hostile: size-limited, schema-validated, idempotent. Ids that name files are checked against a strict pattern; file names are built from the id and a known type, never from the server's text.
- Frames are strictly numbered (`seq` rises by exactly 1) and encrypted; a frame out of order, in plaintext or too large closes the connection.
- The local server binds to `127.0.0.1` unless told otherwise, checks the `Origin` of the socket, and sets a CSP. It answers `/health` with the phase only.
- Logging: `log()` with ids, counts and messages. Never a key, a hash of a secret, or a file.

## Page conventions (`apps/display/`)

- The page draws what it is given and holds no logic that belongs to the agent. Pure logic (schedules, rotation, events) lives in `packages/local-contract` and is tested there.
- Sizes are in `rem`, with `1rem = 16px` at 1920x1080 and scaling with the screen. The references are drawn at 1080p; keep that scale.
- Fonts are bundled (no network at runtime). The page loads nothing from the internet: the weather is fetched by the agent.
- A web tile is framed in a sandbox with no referrer. Media tiles are muted unless their settings say otherwise (the kiosk allows autoplay; the server allows one audible tile per scene). A kind the page does not know draws nothing, never an error: the server may be newer than the screen. `KNOWN_TILE_KINDS` and `SCENE_LAYOUTS` in `local-contract` are copies of the server's definitions, and a test in the agent fails when they drift.
- A new tile kind: add it to the server's `TILE_KINDS`, re-sync the protocol, add it to `KNOWN_TILE_KINDS`, draw it in `components/Scene.tsx`, and test it.
- The cursor is hidden and nothing on the page is interactive.

## Security rules (non-negotiable)

- Device identity rests on the signed-session handshake plus the provisioned server key, never on TLS alone. A certificate pin (`SERVER_TLS_FINGERPRINT`) is allowed on top, never instead.
- Private keys: never in the repo, the image, the logs, the page or an API answer. The key file is 0600 in a volume.
- A file is used only after its size and SHA-256 match what the server announced.
- The page is the only client of the local socket; a web page from another origin is refused.

## Git workflow

### Conventional Commits

Format: `<type>(<scope>): <subject>`

- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes** (optional but preferred): `agent`, `display`, `local`, `protocol`, `kiosk`, `infra`, `docs`, `deps`.
- Subject: imperative, lowercase start, no trailing period, ≤ 72 characters (`feat(agent): download carousel files with signed requests`).
- Body (optional): explain *why*, wrapped at ~100 columns. Footer: `Closes #12`, `Refs #7`.
- Breaking change: `!` after type/scope and a `BREAKING CHANGE:` footer.
- One logical change per commit; do not mix a refactor with behaviour changes. Never put attribution lines in the message (hard rule 1).

### Branches and PRs

- Branch from `main`: `<type>/<short-kebab-description>`. Never force-push `main`.
- PR title follows Conventional Commits. Body: what and why, how it was verified, `Closes #n`. No attribution lines.

### Issues

- Title in Conventional Commits style, written in English. Body: context, scope, acceptance criteria, dependencies, reference to the deck page or the calendar week when relevant.

## Language and docs

Code, comments, commits, issues and docs are in **English**. Comments explain *why*, not *what*. Keep `README.md`, `.env.example` and this file in sync with behaviour changes.
