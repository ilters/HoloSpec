const http = require("http");
const path = require("path");
const express = require("express");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 8080);

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    publisherCount: socketsByRole.publisher.size,
    subscriberCount: socketsByRole.subscriber.size,
    activeStreams: [...latestFrames.keys()]
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  maxPayload: 64 * 1024 * 1024
});

const socketsByRole = {
  publisher: new Set(),
  subscriber: new Set()
};

const latestFrames = new Map();
const TEXT_FRAME_MAGIC = "HSF2";

function safeSend(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(payload);
  }
}

function broadcastToSubscribers(payload, exceptSocket = null) {
  for (const socket of socketsByRole.subscriber) {
    if (socket !== exceptSocket) {
      safeSend(socket, payload);
    }
  }
}

function registerSocket(socket, role) {
  socket.role = role === "publisher" ? "publisher" : "subscriber";
  socketsByRole[socket.role].add(socket);
}

function unregisterSocket(socket) {
  if (socket.role && socketsByRole[socket.role]) {
    socketsByRole[socket.role].delete(socket);
  }
}

function parseTextFrameHeader(message) {
  if (typeof message !== "string" || !message.startsWith(TEXT_FRAME_MAGIC)) {
    return null;
  }

  const firstNewline = message.indexOf("\n");
  if (firstNewline === -1) {
    return null;
  }

  const headerParts = message.slice(0, firstNewline).split("|");
  if (headerParts.length < 12 || headerParts[0] !== TEXT_FRAME_MAGIC) {
    return null;
  }

  const streamId = headerParts[2] || "default";
  return { streamId };
}

function handleTextMessage(socket, rawMessage) {
  const messageText = rawMessage.toString();
  const frameHeader = parseTextFrameHeader(messageText);

  if (frameHeader) {
    if (socket.role !== "publisher") {
      safeSend(
        socket,
        JSON.stringify({
          type: "error",
          message: "Only publisher clients can send frame payloads."
        })
      );
      return;
    }

    latestFrames.set(frameHeader.streamId, messageText);
    broadcastToSubscribers(messageText);
    return;
  }

  let message;
  try {
    message = JSON.parse(messageText);
  } catch {
    safeSend(
      socket,
      JSON.stringify({
        type: "error",
        message: "Messages must be valid JSON or HSF2 frame packets."
      })
    );
    return;
  }

  if (message.type === "hello") {
    if (message.role && message.role !== socket.role) {
      unregisterSocket(socket);
      registerSocket(socket, message.role);
    }

    safeSend(
      socket,
      JSON.stringify({
        type: "hello_ack",
        role: socket.role,
        serverTime: Date.now(),
        activeStreams: [...latestFrames.keys()]
      })
    );

    if (socket.role === "subscriber") {
      for (const frame of latestFrames.values()) {
        safeSend(socket, frame);
      }
    }
    return;
  }
  safeSend(
    socket,
    JSON.stringify({
      type: "error",
      message: `Unsupported message type: ${message.type || "unknown"}`
    })
  );
}

wss.on("connection", (socket, request) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  registerSocket(socket, requestUrl.searchParams.get("role") || "subscriber");

  safeSend(
    socket,
    JSON.stringify({
      type: "welcome",
      role: socket.role,
      message: "Send a hello packet to declare client capabilities."
    })
  );

  socket.on("message", (message) => {
    handleTextMessage(socket, message);
  });
  socket.on("close", () => unregisterSocket(socket));
  socket.on("error", () => unregisterSocket(socket));
});

server.listen(PORT, () => {
  console.log(`HoloSpec relay listening on http://0.0.0.0:${PORT}`);
});
