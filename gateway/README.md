# Network camera gateway (RTSP → WebRTC/WHEP)

The Live screen can already run the EfficientDet engine on a demo clip and on the
visitor's own webcam. A real apron camera speaks **RTSP**, and no browser can open an RTSP
URL. This folder is the missing hop:

```
camera ──RTSP──▶ MediaMTX ──WebRTC (WHEP)──▶ browser <video> ──▶ engine (canvas + zones)
 (or ffmpeg)      :8554          :8889
```

MediaMTX is the only new process. The browser side is already in the app
(`frontend/src/components/live/whepClient.js`, no dependencies): it POSTs an SDP offer as
`application/sdp`, applies the answer, attaches the incoming `MediaStream` to the same
`<video>` the engine reads frames from, and DELETEs the session when the camera is left.

> **Local spike only.** Plain HTTP, no authentication, `webrtcAllowOrigins: '*'`, and anyone
> who can reach port 8554 can publish to the path. See [Production gaps](#production-gaps).

## 1. Start the gateway

### Rootful Podman (the fleet standard)

Run from the repository root:

```bash
sudo podman run --rm --network host \
  -v "$PWD/gateway/mediamtx.yml:/mediamtx.yml:ro,Z" \
  bluenviron/mediamtx:latest
```

- `--network host` is required for WebRTC: the ICE candidates MediaMTX advertises are the
  host's own addresses, and a bridge network would advertise addresses the browser cannot
  reach. The container then owns ports 8554 (RTSP), 8889 (WebRTC/WHEP), 8888 (HLS) and 8189
  (UDP/ICE) exactly like a native process.
- `:Z` relabels the mount for SELinux hosts (Fedora, this machine). Without it the container
  cannot read the config.
- The image is pulled on first run. Pin a version for a repeatable demo, e.g.
  `bluenviron/mediamtx:v1.21.3` — this spike was verified against v1.21.3.
- `sudo` is needed because the fleet runs **rootful** Podman; Docker is not used.

### Native binary (no container, no sudo)

```bash
mkdir -p /tmp/mediamtx && cd /tmp/mediamtx
curl -sSL -o mtx.tar.gz \
  https://github.com/bluenviron/mediamtx/releases/download/v1.21.3/mediamtx_v1.21.3_linux_amd64.tar.gz
tar xzf mtx.tar.gz
./mediamtx /path/to/repo/gateway/mediamtx.yml
```

Do not commit the binary. It is a 56 MB release artifact; `/tmp` is the right place.

Expected output (both variants):

```
INF [RTSP] started with listeners on :8554 (TCP/RTSP), :8000 (UDP/RTP), :8001 (UDP/RTCP)
INF [HLS] started with listener on :8888 (TCP/HTTP)
INF [WebRTC] started with listeners on :8889 (TCP/HTTP), :8189 (UDP/ICE)
```

A path named `cam` with `source: publisher` accepts a publisher; nothing is streamed until
one connects.

## 2. Publish something to `cam`

The demo publisher loops an existing repository clip through RTSP in real time:

```bash
# from the repository root
gateway/publish-demo.sh
```

By default it **transcodes to H.264 baseline**, because WebRTC cannot carry B-frames and
every shipped clip is High profile with B-frames — MediaMTX closes such a session right after
the handshake (`WebRTC doesn't support H264 streams with B-frames`). The command it runs is:

```bash
ffmpeg -re -stream_loop -1 -i frontend/public/media/baggage-area.mp4 \
  -an -c:v libx264 -preset veryfast -tune zerolatency \
  -profile:v baseline -level 3.1 -pix_fmt yuv420p \
  -g 30 -keyint_min 30 -sc_threshold 0 -b:v 2000k -maxrate 2500k -bufsize 4000k \
  -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/cam
```

If the source is already WebRTC-safe (no B-frames), remux instead of transcoding — no CPU,
no quality loss:

```bash
gateway/publish-demo.sh --copy
# = ffmpeg -re -stream_loop -1 -i frontend/public/media/baggage-area.mp4 \
#     -c copy -f rtsp rtsp://127.0.0.1:8554/cam
```

Any other file works in either mode: `gateway/publish-demo.sh path/to/clip.mp4`.

For a real camera, either let it push to `rtsp://<gateway-host>:8554/cam`, or make MediaMTX
pull it by replacing the path in `gateway/mediamtx.yml`:

```yaml
paths:
  cam:
    source: rtsp://user:pass@10.0.0.21:554/stream1
```

Quick checks without a browser:

```bash
ffprobe -v error -show_entries stream=codec_name,width,height -of default=nw=1 \
  rtsp://127.0.0.1:8554/cam            # the RTSP ingest is alive
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8888/cam/index.m3u8   # HLS is 200
```

## 3. Open the app on that camera

The network camera is not part of the mock fixtures. It appears **only** when a WHEP
endpoint is supplied, either in the address bar or in `localStorage`.

Dev server (`npm run dev`, default port 5173):

```
http://localhost:5173/?whep=http://127.0.0.1:8889/cam/whep
```

Built demo (the Pages-shaped static build served locally):

```
http://127.0.0.1:<port>/LocalSight/?whep=http://127.0.0.1:8889/cam/whep
```

Stored variant, for a page opened without query parameters (survives a reload):

```js
localStorage.setItem('localsight.whepUrl', 'http://127.0.0.1:8889/cam/whep'); // then reload
localStorage.removeItem('localsight.whepUrl');                               // to remove it
```

The query parameter wins over the stored value. An unparseable value is ignored instead of
silently falling back to a stored gateway, so the address bar is never a lie. The
normalizer also completes `http://127.0.0.1:8889/cam` to `…/cam/whep`.

With the parameter present, Live opens on the network camera. It is listed in the camera
menu as `CAM-NET • Cameră de rețea • WHEP` (id `cam-net`), next to the three demo clips and
`CAM-LOCAL`. It has no demo clip and no seeded zone (boxes are drawn, no zone rule fires).
The shared toolbar still shows `MOTOR`, but for a gateway source it only prints a note: that
switch belongs to a stand's aircraft engine, and `cam-net` is not a stand.

What you should see:

1. The stage says `Se conectează la camera de rețea…`, then plays the stream, with
   `LIVE RTSP | WebRTC / WHEP` top-left and `CAMERĂ DE REȚEA • WHEP` top-right.
2. `Pornește motorul în browser` runs the same EfficientDet engine on that stream: the
   raw `<video>` is hidden, the worker's canvas shows real boxes and blur.
3. If the gateway is stopped, the stage shows a named failure and a `Reconectează` button
   instead of a black rectangle.

The stream itself is the repository's demo clip republished as RTSP; **the boxes are not
faked** — they come from the same in-browser detector that runs on the demo clips.

## 4. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Gateway-ul WHEP nu poate fi contactat` | MediaMTX is not running, the port is wrong, or the browser blocked the request | Start the gateway; check `curl -i http://127.0.0.1:8889/cam/whep` is answerable |
| Console: `Mixed Content` | The page is HTTPS (e.g. the real Pages site) and the gateway is plain HTTP | Serve the page over `http://localhost` / `http://127.0.0.1`, or give the gateway TLS |
| Console: `violates the Content Security Policy directive "connect-src"` | The gateway is not on loopback; the app's CSP only allows a local gateway | Keep the gateway on `127.0.0.1`/`localhost`, or widen `connect-src` in `frontend/index.html` deliberately |
| Console: CORS error on the WHEP POST | `webrtcAllowOrigins` does not include the page origin | The shipped config allows `*`; production pins the origin |
| `Gateway-ul WHEP a refuzat cererea` (404) | Wrong path: MediaMTX serves `<path>/whep` | Use `/cam/whep` (the client completes `/cam`) |
| Session connects, `no track` / never plays | Nothing is published to `cam` | Run `gateway/publish-demo.sh` and check its output |
| Session opens, then closes immediately; log says `doesn't support H264 streams with B-frames` | The publisher sends High-profile H.264 with B-frames | Use the default (transcoding) publisher mode, or a camera profile without B-frames |
| `Fluxul a sosit, dar redarea a fost blocată` | Autoplay policy | Press `Reconectează` (a user gesture); the element is muted, so this is rare |
| Video is black but the session is up | Codec the browser refuses (e.g. H.265 in Chromium) | Publish H.264 |
| `Video not supported` on the SDP answer | No H.264 profile the browser accepts | Republish with `-c:v libx264 -profile:v baseline` |

## 5. Production gaps

This folder proves the path; it is not a deployable gateway. Before it touches a real apron:

- **TLS** — WHEP must be `https://` with a certificate the browser trusts (`webrtcEncryption`,
  `webrtcServerCert`), otherwise an HTTPS page cannot reach it at all (mixed content).
- **Authentication** — MediaMTX supports publish/read credentials, JWT and HTTP auth; today
  anyone who reaches 8554 can publish to `cam`. Give the camera its own publish user, the
  page a read token, and keep tokens out of the query string in production (use a header or
  a short-lived session endpoint).
- **CORS** — replace `webrtcAllowOrigins: ['*']` with the exact origin(s) of the app.
- **Content Security Policy** — the app allows `connect-src` to loopback only, which is what
  this spike needs. A gateway on another host requires widening that policy on purpose, and
  only together with TLS.
- **Network segmentation** — the gateway belongs on the camera VLAN with a firewall rule
  from the operator network only; the current config listens on every interface.
- **ICE beyond localhost** — a same-host demo needs no STUN/TURN. A gateway across a network
  needs `webrtcAdditionalHosts`/STUN and, behind NAT, a TURN server.
- **Autoplay** — the app only plays a muted, video-only track on a user gesture or camera
  selection. Any future audio track would be blocked by the autoplay policy by design.
- **Privacy** — the browser receives the raw frame and only the in-browser engine draws
  blurred pixels. A production camera must enforce its own privacy mask and/or blur at the
  edge; nothing here uploads or stores video, and nothing here is a recording system.
- **Capacity** — one MediaMTX process and one WebRTC session per viewer. Concurrent
  operators multiply the egress; size it before promising a wall of cameras.
- **Codec** — WebRTC in Chromium means H.264 (or VP8/VP9/AV1 if the camera can produce
  them). A camera that only emits H.265 needs a transcode hop.
- **Demo publisher** — `publish-demo.sh` is not part of the product. It exists so the
  browser path can be demonstrated without a camera on the desk.

## Files

| File | Role |
| --- | --- |
| `mediamtx.yml` | RTSP ingest on 8554, WebRTC/WHEP on 8889, HLS on 8888, path `cam` |
| `publish-demo.sh` | Loops a local clip into `rtsp://127.0.0.1:8554/cam` |
| `frontend/src/components/live/whepClient.js` | Dependency-free WHEP player (URL rules, SDP exchange, errors) |
