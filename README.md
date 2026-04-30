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

The live frame path now uses binary WebSocket messages instead of JSON + base64 payloads. Each frame packet contains:

- `HSF1` magic + protocol version
- frame timestamp
- RGB width and height
- depth width, height, and `bytesPerRow`
- RGB JPEG byte length
- depth raw byte length
- stream id
- 3x3 depth intrinsics matrix
- reference dimensions and a depth-filtered flag
- raw JPEG bytes followed by raw little-endian `Float32` depth bytes in meters

The relay still accepts the older JSON frame format as a compatibility fallback. Legacy JSON frames look like:

```json
{
  "type": "frame",
  "streamId": "uuid-string",
  "timestamp": 1714240000.123,
  "color": {
    "encoding": "jpeg-base64",
    "width": 640,
    "height": 480,
    "data": "..."
  },
  "depth": {
    "encoding": "depth-float32-base64",
    "width": 320,
    "height": 240,
    "bytesPerRow": 1280,
    "data": "...",
    "units": "meters"
  }
}
```

The depth payload is raw little-endian `Float32` data in meters. `bytesPerRow` is included because some consumers may need to account for row padding.

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

The browser viewer prefers binary frames and keeps only the latest pending frame to avoid multi-second render backlog under load.

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
- The sender is currently throttled to `4 FPS`, and each published frame contains synchronized RGB and depth together.

## Lens Studio

Open `HoloSpecLens` in Lens Studio and make sure the `HoloSpecDualFrameClient` component points at the relay subscriber URL.

Important notes:

- The Lens Studio client prefers binary frames and falls back to the legacy JSON path if needed.
- Depth is consumed directly from raw `Float32` bytes.
- RGB still uses Lens Studio's base64 texture decode path locally after binary receipt, which keeps the network transport binary while avoiding a custom JPEG decode path in the lens.
- Lens Studio desktop Preview does not support this network streaming path. Test the subscriber in wearable runtime rather than expecting the editor Preview panel to open the WebSocket stream.

## Current Tradeoffs

- RGB frames are JPEG-compressed for practicality.
- Depth frames are sent as raw `Float32` values, which preserves metric depth but increases payload size.
- The transport no longer pays base64 or giant JSON costs on the hot frame path, but RGB still incurs JPEG encode/decode work.
- The relay is intentionally simple and does not persist frames or authenticate clients.
