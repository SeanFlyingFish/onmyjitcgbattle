import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import WebSocket, { WebSocketServer } from "ws";
import { ClientEventSchema, ServerEvent } from "../shared/types.js";
import { RoomManager } from "./roomManager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
// 前端静态文件目录：后端编译后在 dist/server/，前端在 dist/public/
const WEB_DIST = join(__dirname, "../public");
const roomManager = new RoomManager();
const playerSocket = new Map<WebSocket, { playerId: string; roomId: string; playerName: string }>();

// MIME 类型映射
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const server = createServer((req, res) => {
  // 静态文件服务：提供 web/dist 下的文件
  let urlPath = req.url?.split("?")[0] || "/";
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = join(WEB_DIST, urlPath);

  // 安全检查：防止路径穿越
  if (!filePath.startsWith(WEB_DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (existsSync(filePath)) {
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
      return;
    } catch {
      // 读取失败，回退到 index.html
    }
  }

  // SPA 回退：找不到文件时返回 index.html（让前端路由处理）
  const indexPath = join(WEB_DIST, "index.html");
  if (existsSync(indexPath)) {
    try {
      const content = readFileSync(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
      return;
    } catch {
      // 读取失败
    }
  }

  res.writeHead(404);
  res.end("Not Found");
});

const wss = new WebSocketServer({ server });

function send(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    try {
      const parsed = ClientEventSchema.parse(JSON.parse(raw.toString()));

      if (parsed.type === "create_room") {
        const result = roomManager.createRoom(ws, parsed.payload.name);
        playerSocket.set(ws, { roomId: result.roomId, playerId: result.playerId, playerName: parsed.payload.name });
        send(ws, { type: "room_created", payload: result });
        return;
      }

      if (parsed.type === "join_room") {
        const result = roomManager.joinRoom(parsed.payload.roomId, ws, parsed.payload.name);
        playerSocket.set(ws, { roomId: result.roomId, playerId: result.playerId, playerName: parsed.payload.name });
        roomManager.broadcastRoom(result.roomId, { type: "room_joined", payload: result });
        return;
      }

      const session = playerSocket.get(ws);
      if (!session) {
        throw new Error("not in room");
      }

      // 玩家导入/更新牌库（立即存储）
      if (parsed.type === "update_deck") {
        if (parsed.payload.deck && parsed.payload.deck.length > 0) {
          roomManager.updatePlayerDeck(session.roomId, session.playerId, parsed.payload.deck);
          // 检查前几张式神的 attack/health
          const shikigami = parsed.payload.deck.filter((c: any) => c.type === "式神").slice(0, 3);
          console.log(`[服务器] 玩家 ${session.playerId} 更新牌库: ${parsed.payload.deck.length} 张`);
          shikigami.forEach((c: any) => console.log(`[服务器] 式神: ${c.name} attack=${c.attack} health=${c.health}`));
        }
        return;
      }

      if (parsed.type === "start_match") {
        // 使用房间中每位玩家已存储的牌库
        const state = roomManager.startMatch(parsed.payload.roomId);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_started", payload: state });
        return;
      }

      if (parsed.type === "submit_mulligan") {
        const state = roomManager.submitMulligan(parsed.payload.roomId, session.playerId, parsed.payload.cardIds);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "play_card") {
        const state = roomManager.playCard(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.cardId,
          parsed.payload.targetPlayerId,
          parsed.payload.zone
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "toggle_spell_exhaust") {
        const state = roomManager.toggleSpellExhaust(parsed.payload.roomId, session.playerId, parsed.payload.cardId);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "toggle_shikigami_exhaust") {
        const state = roomManager.toggleShikigamiExhaust(parsed.payload.roomId, session.playerId, parsed.payload.cardId);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "toggle_shikigami_stealth") {
        const state = roomManager.toggleShikigamiStealth(parsed.payload.roomId, session.playerId, parsed.payload.cardId, parsed.payload.stealth);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "end_turn") {
        const state = roomManager.endTurn(parsed.payload.roomId, session.playerId);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "attach_awaken") {
        const state = roomManager.attachAwaken(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.awakenCardId,
          parsed.payload.from,
          parsed.payload.targetPlayerId,
          parsed.payload.slotIndex
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "detach_awaken") {
        const state = roomManager.detachAwaken(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.targetPlayerId,
          parsed.payload.slotIndex,
          parsed.payload.awakenCardId
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "attack") {
        const state = roomManager.attack(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.attackerCardId,
          parsed.payload.targetPlayerId,
          parsed.payload.target,
          parsed.payload.targetCardId
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "move_card") {
        const state = roomManager.moveCard(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.cardId,
          parsed.payload.from,
          parsed.payload.to,
          parsed.payload.toShikigamiSlot
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "toggle_spell_reveal") {
        const state = roomManager.toggleSpellReveal(parsed.payload.roomId, session.playerId, parsed.payload.cardId);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }
      if (parsed.type === "toggle_hand_reveal") {
        const state = roomManager.toggleHandReveal(parsed.payload.roomId, session.playerId, parsed.payload.cardId, parsed.payload.reveal);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "deck_draw") {
        const state = roomManager.deckDraw(parsed.payload.roomId, session.playerId, parsed.payload.count ?? 1);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "deck_shuffle") {
        const state = roomManager.deckShuffle(parsed.payload.roomId, session.playerId);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "deck_search") {
        const count = parsed.payload.count;
        const state = roomManager.deckSearch(parsed.payload.roomId, session.playerId, count);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        roomManager.broadcastRoom(parsed.payload.roomId, {
          type: "chat",
          payload: { playerId: "system", playerName: "", message: `${session.playerName} 查看了牌库顶 ${count} 张` }
        });
        return;
      }

      if (parsed.type === "deck_search_return") {
        const state = roomManager.deckSearchReturn(parsed.payload.roomId, session.playerId);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "deck_peek") {
        const state = roomManager.deckPeek(parsed.payload.roomId, session.playerId, parsed.payload.count);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "place_shikigami_token") {
        const state = roomManager.placeShikigamiToken(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.targetPlayerId,
          parsed.payload.slotIndex,
          parsed.payload.tokenKind
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "remove_shikigami_token") {
        const state = roomManager.removeShikigamiToken(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.targetPlayerId,
          parsed.payload.slotIndex,
          parsed.payload.tokenKind
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "chat") {
        // 广播聊天/通知消息给房间内所有玩家
        roomManager.broadcastRoom(parsed.payload.roomId, {
          type: "chat",
          payload: {
            playerId: session.playerId,
            playerName: session.playerName,
            message: parsed.payload.message
          }
        });
        return;
      }

      if (parsed.type === "adjust_player_hp") {
        const targetId = parsed.payload.targetPlayerId ?? session.playerId;
        const state = roomManager.adjustPlayerHp(
          parsed.payload.roomId,
          targetId,
          parsed.payload.delta
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "adjust_ghost_fire") {
        const state = roomManager.adjustGhostFire(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.delta
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "adjust_fortune_fire") {
        const state = roomManager.adjustFortuneFire(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.delta
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "adjust_player_poison") {
        const targetId = parsed.payload.targetPlayerId ?? session.playerId;
        const state = roomManager.adjustPlayerPoison(
          parsed.payload.roomId,
          targetId,
          parsed.payload.delta
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "adjust_player_damage") {
        const targetId = parsed.payload.targetPlayerId ?? session.playerId;
        const state = roomManager.adjustPlayerDamage(
          parsed.payload.roomId,
          targetId,
          parsed.payload.delta
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "place_token_to_showcase") {
        const state = roomManager.placeTokenToShowcase(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.tokenId,
          parsed.payload.tokenName,
          parsed.payload.tokenAttack,
          parsed.payload.tokenHealth,
          parsed.payload.tokenImg
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      // 移除展示区的召唤物卡牌（直接删除）
      if (parsed.type === "remove_token_card") {
        const state = roomManager.removeTokenCard(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.cardId
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      // 结界区添加能量标记
      if (parsed.type === "place_barrier_token") {
        const state = roomManager.placeBarrierToken(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.targetPlayerId,
          parsed.payload.tokenKind
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      // 结界区移除能量标记
      if (parsed.type === "remove_barrier_token") {
        const state = roomManager.removeBarrierToken(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.targetPlayerId,
          parsed.payload.tokenKind
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      // 添加自定义标记到结界区
      if (parsed.type === "add_custom_marker") {
        const state = roomManager.addCustomMarker(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.targetPlayerId,
          parsed.payload.markerName,
          parsed.payload.delta
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      // 添加自定义标记到式神
      if (parsed.type === "add_custom_marker_to_shikigami") {
        const state = roomManager.addCustomMarkerToShikigami(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.targetPlayerId,
          parsed.payload.slotIndex,
          parsed.payload.markerName,
          parsed.payload.delta
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      // 添加自定义标记到符咒区
      if (parsed.type === "add_custom_marker_to_spell") {
        const state = roomManager.addCustomMarkerToSpell(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.targetPlayerId,
          parsed.payload.cardId,
          parsed.payload.markerName,
          parsed.payload.delta
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      // 添加自定义标记到延伸区
      if (parsed.type === "add_custom_marker_to_extend") {
        const state = roomManager.addCustomMarkerToExtend(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.targetPlayerId,
          parsed.payload.cardId,
          parsed.payload.markerName,
          parsed.payload.delta
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      send(ws, { type: "error", payload: { message } });
    }
  });

  ws.on("close", () => {
    const session = playerSocket.get(ws);
    playerSocket.delete(ws);
    roomManager.handleDisconnect(ws);
    if (session) {
      console.log(`[服务器] 玩家 ${session.playerId} 断线，房间 ${session.roomId}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`card-battle server on port ${PORT}`);
  console.log(`serving static files from ${WEB_DIST}`);
});

