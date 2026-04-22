import WebSocket from "ws";

const serverUrl = process.argv[2] ?? "ws://localhost:8080";
const playerName = process.argv[3] ?? `player-${Math.floor(Math.random() * 1000)}`;

const ws = new WebSocket(serverUrl);

ws.on("open", () => {
  console.log(`[${playerName}] connected to ${serverUrl}`);
  ws.send(JSON.stringify({ type: "create_room", payload: { name: playerName } }));
});

ws.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  console.log(`[${playerName}]`, JSON.stringify(message, null, 2));
});

ws.on("close", () => {
  console.log(`[${playerName}] disconnected`);
});

