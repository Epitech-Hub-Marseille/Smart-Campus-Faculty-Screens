# SmartCampus-FacultyScreens

The **Faculty screen** of Smart Campus: a wall display (a mini-PC or a Raspberry Pi with Chromium in kiosk mode) that shows the
campus information board, the custom content an administrator sends, and emergency alerts. It talks to
[SmartCampus-CentralServer](../SmartCampus-CentralServer), whose protocol it follows to the letter.

| | |
| --- | --- |
| **Information board** | After the reference design (`docs/inspiration/default-info-screen`): events of the day (now, next, later), booked rooms, announcements, and the news. Header with the site name, logo, date, clock and weather. |
| **Staff availability** | Who can be reached, with their note, filtered by service. A status with an end time lapses by itself. |
| **Carousel of scenes** | What the screen rotates through is a list of scenes the console builds. A scene is a layout (full screen, two columns, two rows, main and side, main and two side, four tiles) with a tile per slot, shown for its own time and between its own dates. A tile is the news, the staff, the reservations, an image or video of the media library, a text, a web page, **live radio**, a **live video stream** (HLS, live MP4 or an MJPEG camera) or **YouTube**. A tile of a kind this screen does not know is skipped, so the server can add kinds before every screen is updated. |
| **Emergency** | Takes over the screen, after the reference design (`docs/inspiration/emergency-screens`): hazard stripes, a headline, three actions per kind of emergency, the assembly point and the emergency number, and an alarm made in the browser. An "alert over" notice can follow. |
| **Sounds** | InterCom broadcasts and emergency read-outs, downloaded and verified like any other file. |
| **Offline** | Keeps the last known screen through an outage and a restart, with a badge saying so. Reconnects by itself (1 to 60 s with jitter). |

## How it works

```
 CentralServer ──wss /ws/device──▶  agent (Node, holds the key)  ──ws://localhost/live──▶  kiosk page (Chromium)
   signed https  ◀── file downloads ──  data/ (key 0600, state, verified files)               draws, holds no key
```

- The **agent** holds the device key and the connection. It enrolls, performs the handshake, acknowledges commands once (a replay is
  acknowledged again and not run twice), downloads files with a request signed by its key, verifies their size and SHA-256, keeps
  everything on disk, and serves the page on this machine only.
- The **page** receives a ready-made `ViewState` and draws it. It never sees the key, the session or the server address.
- A new carousel is **activated only when every file in it is verified**; until then the previous one stays on screen. Streams, radios and web pages have no file to fetch: the page loads them itself. A download
  runs aside, so an emergency that arrives during a large video is on the screen at once.
- The shared protocol packages are **vendored** in `vendor/` (see `scripts/sync-protocol.sh`), so the image builds without the server
  checkout and the contract is exactly the server's.

## Run it

You need Docker, and a running CentralServer.

1. In the console (Devices, **Provision a device**) take the server's public key, or `curl $SERVER_URL/api/server-key`, and check
   its fingerprint against the one the console shows.
2. Create the configuration and start the screen:

   ```sh
   cp .env.example .env     # set SERVER_URL and SERVER_PUBLIC_KEY
   docker compose up -d --build
   ```

3. The screen shows **its key fingerprint**. In the console, the connection request appears under Devices with the same
   fingerprint: compare, then approve. The screen switches to the board by itself.
4. On the machine with the display, install the kiosk launcher (it needs the graphical session, so it does not run in the container):

   ```sh
   sudo install -m 0755 scripts/start-kiosk.sh /usr/local/bin/smartcampus-kiosk
   mkdir -p ~/.config/systemd/user
   cp systemd/smartcampus-kiosk.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now smartcampus-kiosk.service
   ```

The page listens on `127.0.0.1:3000` only (`DISPLAY_PORT`). The **same port is used inside and outside the container**: the agent only
lets the page of `http://localhost:<that port>` open its socket. The image is multi-architecture
(`docker buildx build --platform linux/amd64,linux/arm64 .`).

### The whole campus on one machine

`docker-compose.campus.yml` runs the central server stack (server, console, MongoDB, mails) from the `SmartCampus-CentralServer`
checkout next to this repository, plus a Faculty screen built from this one. It includes the server's own dev compose, so a stack
that is already running is adopted, not started twice.

```sh
docker compose -f docker-compose.campus.yml up -d --build
# with the local voice engine on an NVIDIA GPU:
docker compose -f docker-compose.campus.yml -f ../SmartCampus-CentralServer/docker-compose.tts.yml up -d --build
```

Console http://localhost:5173 (`admin@smartcampus.local` / `changeme123`, the dev seed), mails http://localhost:8025, API and device
gateway on :3000, the screen's page on http://localhost:3300. The screen reads the server's **public** key from the folder the dev
server writes it to, so nothing needs copying; it appears under Devices as a connection request, and you approve it after comparing the
fingerprint with the one on http://localhost:3300. `DEVICE_NAME` names it. This is for development and demos: a real screen uses
`docker-compose.yml` and a key provisioned on the device.

### Configuration

| Variable | |
| --- | --- |
| `SERVER_URL` | Address of the server. The device channel is derived from it (`http` becomes `ws`, `https` becomes `wss`). Required. |
| `SERVER_PUBLIC_KEY` / `SERVER_PUBLIC_KEY_FILE` | The server's public key (base64 SPKI or PEM), provisioned on the device. Required: the agent never learns it from the network. |
| `SERVER_TLS_FINGERPRINT` | SHA-256 of a self-signed server certificate, to pin it. Without it certificates are verified normally. |
| `DEVICE_NAME` | Name shown to the administrator in the connection request. |
| `DATA_DIR` | Where the key (0600), the state and the verified files live. A volume in Docker. |
| `DISPLAY_PORT`, `DISPLAY_BIND` | The local page. `127.0.0.1` unless you debug remotely. |
| `DISPLAY_ALLOWED_ORIGINS` | Development only: extra origins allowed to open the local socket (the Vite dev server). |
| `REQUEST_TIMEOUT_MS`, `ASSET_TIMEOUT_MS`, `LOG_LEVEL` | Timeouts and verbosity. |

### Settings in the console

- **Faculty screens** page: screens can be put in groups. Settings and the playlist are set on three levels, the default, a group, and one
  screen, and the most specific level wins field by field: a screen's own site name beats its group's, and a field it does not set keeps
  following the group. A playlist replaces the one above as a whole. The settings are the site (name, subtitle, logo, building or zone,
  assembly point, emergency number), the staff service shown, whether the carousel rotates, and the clock, date and weather widgets.
- **Media library** page: upload, rename, move, replace and delete the images and videos tiles use; picked from there for logos and tiles.
- With no scene to show, a screen shows the information board: a wall screen is never left blank.

### What a tile may load

The page loads nothing from the internet by itself. A tile that an administrator adds is the exception, and the agent's content
security policy lets the page load exactly that kind of thing: a web page or YouTube in a frame (sandboxed, no access to the screen's
page), a live stream or radio as media (HLS is played by a bundled player), an MJPEG camera as an image. Scripts, styles and fonts stay
local. Sound plays unless the tile is muted; the kiosk starts Chromium with the autoplay policy that allows it, and the server allows one
tile with sound per scene. A stream that fails is retried every 15 seconds and says so, so a camera that is down does not freeze the carousel.

## Develop

```sh
pnpm install
pnpm typecheck && pnpm test && pnpm build
pnpm dev:agent       # needs .env
pnpm dev:display     # http://localhost:5173, proxied to the agent
pnpm sync:protocol   # after a protocol change in ../SmartCampus-CentralServer
```

Tests: the agent is tested against `src/testing/fakeGateway.ts`, a gateway that speaks the real protocol from the same packages
(handshake, encrypted and numbered frames), including a relay with another key, out-of-order and plaintext frames, replays, revocation,
failed downloads and hash mismatches. The page and the pure logic are tested with Vitest.

## What is not covered yet

- **Real hardware.** Not run on a Raspberry Pi or a mini-PC with a real panel and speakers: the alarm and the sounds were checked to start, not
  judged on a speaker, and the arm64 image was not built here.
- **TLS** for the device-facing server listener is not set up on the server yet; the pin is ready for it.
- **Rooms with no booking** are not on the board ("Free" in the reference): the protocol carries bookings, not the list of rooms.
- **No event concept** beyond room reservations: the "current events" panel lists today's bookings.
- Provisioning by QR code is not read by this screen; the key is set in `.env`.
