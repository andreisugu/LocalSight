#!/usr/bin/env bash
# Publish the demo clip to the MediaMTX gateway as RTSP, in a loop, in real time.
#
# Run from the repository root, in its own terminal:
#
#   gateway/publish-demo.sh                     # transcode to WebRTC-safe H.264
#   gateway/publish-demo.sh --copy              # remux only (source must be B-frame free)
#   gateway/publish-demo.sh path/to/another.mp4 # any clip
#
# `-re` plays at the file's own frame rate instead of as fast as the disk allows, so the
# browser receives a stream whose motion looks like a camera. `-stream_loop -1` makes it
# endless. TCP is used for RTSP because a UDP publisher loses the first keyframe often
# enough to look like a broken gateway.
#
# Why the default is a transcode and not `-c copy`: WebRTC cannot carry H.264 with B-frames,
# and MediaMTX closes the session with "WebRTC doesn't support H264 streams with B-frames".
# All three shipped demo clips are High profile with B-frames, so remuxing them produces a
# session that never reaches the browser. The transcode below is baseline (no B-frames) with
# a one-second keyframe interval, which is what WebRTC needs. `--copy` stays available for a
# camera or file that already is: it costs no CPU and loses no quality.
set -euo pipefail

MODE="transcode"
CLIP="${MEDIAMTX_CLIP:-frontend/public/media/baggage-area.mp4}"
GATEWAY="${MEDIAMTX_RTSP:-rtsp://127.0.0.1:8554/cam}"

while [ $# -gt 0 ]; do
  case "$1" in
    --copy) MODE="copy" ;;
    --transcode) MODE="transcode" ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) CLIP="$1" ;;
  esac
  shift
done

if [ ! -f "$CLIP" ]; then
  echo "Clip not found: $CLIP" >&2
  echo "Run this from the repository root, or pass a path: gateway/publish-demo.sh my.mp4" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is not installed. It is the only dependency of this script." >&2
  exit 1
fi

if [ "$MODE" = "copy" ]; then
  # The documented remux path. Only use it when the source is already WebRTC-safe H.264
  # (no B-frames), otherwise MediaMTX drops the WebRTC session after the handshake.
  echo "Publishing $CLIP -> $GATEWAY (remux, loop, real time)."
  echo "Note: MediaMTX rejects H.264 with B-frames over WebRTC; use the default mode then."
  exec ffmpeg -hide_banner -loglevel warning \
    -re -stream_loop -1 -i frontend/public/media/baggage-area.mp4 \
    -c copy -f rtsp -rtsp_transport tcp "$GATEWAY"
fi

echo "Publishing $CLIP -> $GATEWAY (H.264 baseline transcode, no B-frames, loop)."
exec ffmpeg -hide_banner -loglevel warning \
  -re -stream_loop -1 -i "$CLIP" \
  -an \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -profile:v baseline -level 3.1 -pix_fmt yuv420p \
  -g 30 -keyint_min 30 -sc_threshold 0 -b:v 2000k -maxrate 2500k -bufsize 4000k \
  -f rtsp -rtsp_transport tcp "$GATEWAY"
