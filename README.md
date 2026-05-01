# HoloSpec

This repository contains:

- An iOS app that captures synchronized RGB and TrueDepth frames and publishes them over WebSockets.
- A Node.js + Express backend that relays incoming frame payloads to other connected clients.
- A simple browser viewer that subscribes to the relay and renders both the color frame and a normalized depth preview.
- A Lens Studio client that subscribes to the relay and displays RGB plus a false-color depth view.

## Layout

- `ios/HoloSpec`: Xcode project for the iOS publisher app
- `server/index.js`: Express + WebSocket relay server
- `public/index.html`: Browser-based subscriber
- `HoloSpecLens`: Lens Studio subscriber project

## Wire Format

The live frame path uses a compact text WebSocket frame format instead of giant JSON envelopes.

Each frame is sent as three lines:

1. A header line with `|`-separated metadata
2. The RGB JPEG bytes encoded as base64
3. The depth `Float32` bytes encoded as base64

Header layout:

```text
HSF2|timestamp|streamId|colorWidth|colorHeight|depthWidth|depthHeight|bytesPerRow|referenceWidth|referenceHeight|flags|i0,i1,i2,i3,i4,i5,i6,i7,i8
```

Notes:

- `flags` currently uses bit `0` for the depth filtered marker
- `i0..i8` is the 3x3 depth intrinsics matrix flattened row-major
- The depth payload itself is still raw little-endian `Float32` data in meters once base64-decoded
- Small control messages such as `hello` and `hello_ack` still use JSON

## Backend

Install and run:

```bash
npm install
npm start
```

The relay listens on `http://localhost:8080`.

- Viewer: `http://localhost:8080`
- Health: `http://localhost:8080/health`
- WebSocket endpoint: `ws://localhost:8080/ws`

Clients can connect with `?role=publisher` or `?role=subscriber`. The browser viewer already connects as a subscriber.

The browser viewer keeps only the latest pending frame to avoid multi-second render backlog under load.

## Railway

This project is ready to deploy directly on Railway.

- Railway will use `npm start`
- The health check endpoint is `/health`
- Keep the service at `1` replica because publisher/subscriber sockets and latest frames are stored in memory
- For the iOS app, use a `wss://` URL such as `wss://holo-speccc.up.railway.app/ws?role=publisher`

## iOS App

Open `ios/HoloSpec/HoloSpec.xcodeproj` in Xcode, choose a physical iPhone/iPad with a TrueDepth camera, and run the app.

Important notes:

- The TrueDepth camera is only available on supported physical devices. The iOS simulator will compile but cannot provide real depth frames.
- If the backend runs on your Mac, the app must use your Mac's LAN IP in the WebSocket URL. `localhost` from the phone points at the phone itself.
- `Info.plist` currently allows arbitrary network loads so `ws://` can be used during development. Tighten ATS rules before production.
- The sender is currently throttled to `8 FPS`, and each published frame contains synchronized RGB and depth together.

## Lens Studio

Open `HoloSpecLens` in Lens Studio and make sure the `HoloSpecDualFrameClient` component points at the relay subscriber URL.

Important notes:

- The Lens Studio client consumes the same `HSF2` text frame format as the web viewer.
- Depth is reconstructed from base64-decoded raw `Float32` bytes.
- RGB uses Lens Studio's `Base64.decodeTextureAsync(...)` path directly.

## Current Tradeoffs

- RGB frames are JPEG-compressed for practicality.
- Depth frames are sent as raw `Float32` values, which preserves metric depth but increases payload size.
- The transport avoids giant JSON frame parsing, but still pays base64 size overhead and RGB JPEG encode/decode work.
- The relay is intentionally simple and does not persist frames or authenticate clients.
