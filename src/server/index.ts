import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { ClientEventSchema, ServerEvent } from "../shared/types.js";
import { RoomManager } from "./roomManager.js";
import { AuthManager } from "./authManager.js";
import { sanitizeMatchStateForPlayer } from "./gameEngine.js";

const PORT = Number(process.env.PORT ?? 8080);
const roomManager = new RoomManager();
const authManager = new AuthManager();
const sessions = new Map<WebSocket, { playerId: string; name: string; roomId?: string; reconnectToken?: string }>();
const adminWsSet = new Set<WebSocket>();

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("onmyoji-tcg server");
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

      // ── 无需 session 的消息 ──

      // 注册
      if (parsed.type === "register") {
        const result = authManager.register(parsed.payload.name, parsed.payload.password);
        if (result) {
          send(ws, { type: "register_success", payload: result });
        } else {
          send(ws, { type: "auth_error", payload: { message: "账号已存在" } });
        }
        return;
      }

      // 登录
      if (parsed.type === "login") {
        const result = authManager.login(parsed.payload.name, parsed.payload.password);
        if (result) {
          sessions.set(ws, { playerId: result.playerId, name: result.name });
          send(ws, { type: "login_success", payload: result });
        } else {
          send(ws, { type: "auth_error", payload: { message: "用户名或密码错误" } });
        }
        return;
      }

      // 断线重连：需同时验证 reconnectToken 与 playerId 匹配
      if (parsed.type === "reconnect") {
        const { roomId, reconnectToken, playerId: requestPlayerId } = parsed.payload;
        console.log(`[服务器] 重连请求: roomId=${roomId}, requestPlayerId=${requestPlayerId}`);
        const state = roomManager.reconnect(roomId, reconnectToken, requestPlayerId, ws);
        if (state) {
          const foundPlayerId = roomManager.getPlayerIdByToken(roomId, reconnectToken) ?? "";
          // 双重校验：token 查到的 playerId 必须与请求中的 playerId 一致
          if (foundPlayerId && foundPlayerId === requestPlayerId) {
            const playerName = state.players[foundPlayerId]?.name ?? "";
            sessions.set(ws, { playerId: foundPlayerId, name: playerName, roomId, reconnectToken });
            const sanitizedState = sanitizeMatchStateForPlayer(state, foundPlayerId);
            console.log(`[服务器] 重连成功: playerId=${foundPlayerId}, name=${playerName}, roomId=${roomId}`);
            console.log(`[服务器] matchState.players keys: ${JSON.stringify(Object.keys(state.players))}`);
            send(ws, { type: "reconnect_success", payload: { playerId: foundPlayerId, matchState: sanitizedState } });
          } else {
            console.log(`[服务器] 重连失败: playerId不匹配 foundPlayerId=${foundPlayerId} requestPlayerId=${requestPlayerId}`);
            send(ws, { type: "reconnect_failed", payload: { message: "重连失败：玩家ID与令牌不匹配" } });
          }
        } else {
          console.log(`[服务器] 重连失败: 房间或令牌无效 roomId=${roomId}`);
          send(ws, { type: "reconnect_failed", payload: { message: "重连失败，房间或令牌无效" } });
        }
        return;
      }

      // 管理员认证
      if (parsed.type === "admin_auth") {
        if (authManager.adminAuth(parsed.payload.password)) {
          authManager.addAdminWs(ws);
          send(ws, { type: "admin_auth_success", payload: {} });
        } else {
          send(ws, { type: "auth_error", payload: { message: "管理员密码错误" } });
        }
        return;
      }

      // 管理员列出账号
      if (parsed.type === "admin_list_accounts") {
        if (!authManager.isAdminWs(ws)) {
          send(ws, { type: "auth_error", payload: { message: "未授权" } });
          return;
        }
        const accounts = authManager.listAccounts();
        send(ws, { type: "admin_accounts_list", payload: { accounts } });
        return;
      }

      // 管理员删除账号
      if (parsed.type === "admin_delete_account") {
        if (!authManager.isAdminWs(ws)) {
          send(ws, { type: "auth_error", payload: { message: "未授权" } });
          return;
        }
        const result = authManager.deleteAccount(parsed.payload.name);
        send(ws, { type: "admin_action_result", payload: { success: result, message: result ? "删除成功" : "删除失败" } });
        return;
      }

      // 管理员重置密码
      if (parsed.type === "admin_reset_password") {
        if (!authManager.isAdminWs(ws)) {
          send(ws, { type: "auth_error", payload: { message: "未授权" } });
          return;
        }
        const result = authManager.resetPassword(parsed.payload.name, parsed.payload.newPassword);
        send(ws, { type: "admin_action_result", payload: { success: result, message: result ? "密码重置成功" : "密码重置失败" } });
        return;
      }

      // ── 需要 session 的消息（已登录） ──
      const session = sessions.get(ws);
      if (!session) {
        throw new Error("not logged in");
      }

      // 创建房间
      if (parsed.type === "create_room") {
        const result = roomManager.createRoom(ws, session.playerId, session.name);
        sessions.set(ws, { ...session, roomId: result.roomId, reconnectToken: result.reconnectToken });
        send(ws, { type: "room_created", payload: result });
        return;
      }

      // 加入房间
      if (parsed.type === "join_room") {
        const result = roomManager.joinRoom(parsed.payload.roomId, ws, session.playerId, session.name);
        sessions.set(ws, { ...session, roomId: result.roomId, reconnectToken: result.reconnectToken });
        roomManager.broadcastRoom(result.roomId, { type: "room_joined", payload: result });
        return;
      }

      // ── 需要在房间里的消息 ──
      if (!session.roomId) {
        throw new Error("not in room");
      }

      // 玩家导入/更新牌库
      if (parsed.type === "update_deck") {
        if (parsed.payload.deck && parsed.payload.deck.length > 0) {
          roomManager.updatePlayerDeck(session.roomId, session.playerId, parsed.payload.deck);
          const shikigami = parsed.payload.deck.filter((c: any) => c.type === "式神").slice(0, 3);
          console.log(`[服务器] 玩家 ${session.playerId} 更新牌库: ${parsed.payload.deck.length} 张`);
          shikigami.forEach((c: any) => console.log(`[服务器] 式神: ${c.name} attack=${c.attack} health=${c.health}`));
        }
        return;
      }

      if (parsed.type === "start_match") {
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
          payload: { playerId: "system", playerName: "", message: `${session.name} 查看了牌库顶 ${count} 张` }
        });
        return;
      }

      if (parsed.type === "deck_search_return") {
        const state = roomManager.deckSearchReturn(parsed.payload.roomId, session.playerId);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "deck_search_reorder") {
        const state = roomManager.deckSearchReorder(parsed.payload.roomId, session.playerId, parsed.payload.orderedIds);
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
        roomManager.broadcastRoom(parsed.payload.roomId, {
          type: "chat",
          payload: {
            playerId: session.playerId,
            playerName: session.name,
            message: parsed.payload.message
          }
        });
        return;
      }

      if (parsed.type === "adjust_player_hp") {
        const targetId = parsed.payload.targetPlayerId ?? session.playerId;
        const state = roomManager.adjustPlayerHp(parsed.payload.roomId, targetId, parsed.payload.delta);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "adjust_ghost_fire") {
        const state = roomManager.adjustGhostFire(parsed.payload.roomId, session.playerId, parsed.payload.delta);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "adjust_fortune_fire") {
        const state = roomManager.adjustFortuneFire(parsed.payload.roomId, session.playerId, parsed.payload.delta);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "adjust_player_poison") {
        const targetId = parsed.payload.targetPlayerId ?? session.playerId;
        const state = roomManager.adjustPlayerPoison(parsed.payload.roomId, targetId, parsed.payload.delta);
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

      if (parsed.type === "adjust_player_damage") {
        const targetId = parsed.payload.targetPlayerId ?? session.playerId;
        const state = roomManager.adjustPlayerDamage(parsed.payload.roomId, targetId, parsed.payload.delta);
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

      if (parsed.type === "remove_token_card") {
        const state = roomManager.removeTokenCard(
          parsed.payload.roomId,
          session.playerId,
          parsed.payload.cardId
        );
        roomManager.broadcastRoom(parsed.payload.roomId, { type: "match_state", payload: state });
        return;
      }

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

      // 主动离开房间
      if (parsed.type === "leave_room") {
        const leftId = roomManager.leaveRoom(session.roomId, session.playerId);
        if (leftId) {
          roomManager.broadcastRoom(session.roomId, { type: "left_room", payload: { playerId: leftId } });
        }
        sessions.delete(ws);
        return;
      }

      // 重开对局
      if (parsed.type === "rematch") {
        const state = roomManager.rematch(session.roomId, session.playerId);
        if (state) {
          roomManager.broadcastRoom(session.roomId, { type: "rematch_started", payload: state });
        }
        return;
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      send(ws, { type: "error", payload: { message } });
    }
  });

  ws.on("close", () => {
    const session = sessions.get(ws);
    if (session) {
      roomManager.markDisconnected(ws);
      if (session.roomId) {
        console.log(`[服务器] 玩家 ${session.playerId} 断线，房间 ${session.roomId}`);
      }
      sessions.delete(ws);
    }
    authManager.removeAdminWs(ws);
  });
});

server.listen(PORT, () => {
  console.log(`card-battle server on port ${PORT}`);
  roomManager.ensureCleanupTimer();
});
