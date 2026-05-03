import { nanoid } from "nanoid";
import WebSocket from "ws";
import { BuilderCard, MatchState, PlayerId, PlayerState, RoomId, ServerEvent } from "../shared/types.js";
import {
  adjustGhostFire as engineAdjustGhostFire,
  adjustFortuneFire as engineAdjustFortuneFire,
  adjustPlayerPoison as engineAdjustPlayerPoison,
  adjustPlayerDamage as engineAdjustPlayerDamage,
  adjustPlayerHp as engineAdjustPlayerHp,
  addCustomMarker as engineAddCustomMarker,
  addCustomMarkerToShikigami as engineAddCustomMarkerToShikigami,
  addCustomMarkerToSpell as engineAddCustomMarkerToSpell,
  addCustomMarkerToExtend as engineAddCustomMarkerToExtend,
  placeBarrierToken as enginePlaceBarrierToken,
  removeBarrierToken as engineRemoveBarrierToken,
  attack,
  createMatchState,
  createPlayer,
  deckDraw,
  deckPeek,
  deckSearch,
  deckSearchReorder,
  deckSearchReturn,
  deckShuffle,
  endTurn,
  moveCard,
  attachAwaken as engineAttachAwaken,
  detachAwaken as engineDetachAwaken,
  placeShikigamiToken as enginePlaceShikigamiToken,
  placeTokenToShowcase,
  removeTokenCard,
  playCard,
  preparePlayerForMatch,
  removeShikigamiToken as engineRemoveShikigamiToken,
  sanitizeMatchStateForPlayer,
  submitMulligan,
  toggleShikigamiExhaust,
  toggleShikigamiStealth as engineToggleShikigamiStealth,
  toggleSpellExhaust,
  toggleSpellReveal,
  toggleHandReveal
} from "./gameEngine.js";
import type { ShikigamiTokenKind } from "../shared/types.js";

type RoomPlayerEntry = {
  ws: WebSocket | null;
  state: PlayerState;
  customDeck?: BuilderCard[];
  reconnectToken: string;
  disconnectedAt?: number;
};
type Room = {
  id: RoomId;
  players: Map<PlayerId, RoomPlayerEntry>;
  matchState?: MatchState;
};

export class RoomManager {
  private readonly rooms = new Map<RoomId, Room>();
  /** 定期清理超时断线房间的定时器 */
  private cleanupTimer?: ReturnType<typeof setInterval>;

  createRoom(ws: WebSocket, playerId: PlayerId, name: string): { roomId: RoomId; playerId: PlayerId; reconnectToken: string } {
    const roomId = nanoid(8);
    const reconnectToken = nanoid(12);
    const room: Room = {
      id: roomId,
      players: new Map([[playerId, { ws, state: createPlayer(playerId, name), reconnectToken }]])
    };
    this.rooms.set(roomId, room);
    return { roomId, playerId, reconnectToken };
  }

  joinRoom(roomId: RoomId, ws: WebSocket, playerId: PlayerId, name: string): { roomId: RoomId; playerId: PlayerId; reconnectToken: string; players: PlayerState[] } {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("room not found");
    }
    if (room.players.size >= 2) {
      throw new Error("room is full");
    }
    // 检查 playerId 是否已在本房间（防止重复加入）
    if (room.players.has(playerId)) {
      throw new Error("already in room");
    }
    const reconnectToken = nanoid(12);
    room.players.set(playerId, { ws, state: createPlayer(playerId, name), reconnectToken });
    return {
      roomId,
      playerId,
      reconnectToken,
      players: [...room.players.values()].map((entry) => entry.state)
    };
  }

  /** 更新玩家的牌库（玩家导入卡组时调用） */
  updatePlayerDeck(roomId: RoomId, playerId: PlayerId, deck: BuilderCard[]): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("room not found");
    }
    const entry = room.players.get(playerId);
    if (!entry) {
      throw new Error("player not found");
    }
    entry.customDeck = deck;
  }

  startMatch(roomId: RoomId): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (room.players.size !== 2) {
      throw new Error("need two players");
    }
    for (const [id, entry] of room.players.entries()) {
      // 优先使用存储的牌库，否则使用默认牌组
      entry.state = createPlayer(id, entry.state.name, entry.customDeck);
      preparePlayerForMatch(entry.state);
    }
    const states = [...room.players.values()].map((entry) => entry.state);
    room.matchState = createMatchState(roomId, states[0], states[1]);
    return room.matchState;
  }

  submitMulligan(roomId: RoomId, playerId: PlayerId, cardIds: string[]): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return submitMulligan(room.matchState, playerId, cardIds);
  }

  playCard(
    roomId: RoomId,
    playerId: PlayerId,
    cardId: string,
    targetPlayerId: PlayerId,
    zone: "shikigami" | "spell"
  ): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return playCard(room.matchState, playerId, cardId, targetPlayerId, zone);
  }

  toggleSpellExhaust(roomId: RoomId, playerId: PlayerId, cardId: string): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return toggleSpellExhaust(room.matchState, playerId, cardId);
  }

  toggleShikigamiExhaust(roomId: RoomId, playerId: PlayerId, cardId: string): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return toggleShikigamiExhaust(room.matchState, playerId, cardId);
  }

  endTurn(roomId: RoomId, playerId: PlayerId): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return endTurn(room.matchState, playerId);
  }

  attack(
    roomId: RoomId,
    playerId: PlayerId,
    attackerCardId: string,
    targetPlayerId: PlayerId,
    target: "player" | "shikigami",
    targetCardId?: string
  ): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return attack(room.matchState, playerId, attackerCardId, targetPlayerId, target, targetCardId);
  }

  private opponentId(state: MatchState, playerId: PlayerId): PlayerId | null {
    return Object.keys(state.players).find((id) => id !== playerId) ?? null;
  }

  moveCard(
    roomId: RoomId,
    playerId: PlayerId,
    cardId: string,
    from:
      | "hand"
      | "graveyard"
      | "spell"
      | "shikigami"
      | "barrier"
      | "deck_top"
      | "deck_search"
      | "removed_zone"
      | "extend"
      | "showcase",
    to: "hand" | "graveyard" | "spell" | "shikigami" | "barrier" | "deck_top" | "deck_bottom" | "removed_zone" | "extend" | "showcase",
    toShikigamiSlot?: number
  ): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return moveCard(room.matchState, playerId, cardId, from, to, toShikigamiSlot, this.opponentId(room.matchState, playerId));
  }

  toggleSpellReveal(roomId: RoomId, playerId: PlayerId, cardId: string): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return toggleSpellReveal(room.matchState, playerId, cardId);
  }

  toggleHandReveal(roomId: RoomId, playerId: PlayerId, cardId: string, reveal: boolean): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return toggleHandReveal(room.matchState, playerId, cardId, reveal);
  }

  attachAwaken(
    roomId: RoomId,
    actorId: PlayerId,
    awakenCardId: string,
    from: "hand" | "spell",
    targetPlayerId: PlayerId,
    slotIndex: number
  ): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return engineAttachAwaken(room.matchState, actorId, awakenCardId, from, targetPlayerId, slotIndex);
  }

  detachAwaken(
    roomId: RoomId,
    actorId: PlayerId,
    targetPlayerId: PlayerId,
    slotIndex: number,
    awakenCardId: string
  ): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return engineDetachAwaken(room.matchState, actorId, targetPlayerId, slotIndex, awakenCardId);
  }

  deckDraw(roomId: RoomId, playerId: PlayerId, count: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return deckDraw(room.matchState, playerId, count, this.opponentId(room.matchState, playerId));
  }

  deckShuffle(roomId: RoomId, playerId: PlayerId): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return deckShuffle(room.matchState, playerId);
  }

  deckSearch(roomId: RoomId, playerId: PlayerId, count: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return deckSearch(room.matchState, playerId, count);
  }

  deckSearchReturn(roomId: RoomId, playerId: PlayerId): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return deckSearchReturn(room.matchState, playerId);
  }

  deckSearchReorder(roomId: RoomId, playerId: PlayerId, orderedIds: string[]): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return deckSearchReorder(room.matchState, playerId, orderedIds);
  }

  deckPeek(roomId: RoomId, playerId: PlayerId, count: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return deckPeek(room.matchState, playerId, count);
  }

  placeTokenToShowcase(
    roomId: RoomId,
    playerId: PlayerId,
    tokenId: string,
    tokenName: string,
    tokenAttack: number,
    tokenHealth: number,
    tokenImg: string
  ): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return placeTokenToShowcase(room.matchState, playerId, tokenId, tokenName, tokenAttack, tokenHealth, tokenImg);
  }

  removeTokenCard(
    roomId: RoomId,
    playerId: PlayerId,
    cardId: string
  ): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return removeTokenCard(room.matchState, playerId, cardId);
  }

  placeShikigamiToken(
    roomId: RoomId,
    playerId: PlayerId,
    targetPlayerId: PlayerId,
    slotIndex: number,
    tokenKind: ShikigamiTokenKind
  ): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return enginePlaceShikigamiToken(room.matchState, playerId, targetPlayerId, slotIndex, tokenKind);
  }

  removeShikigamiToken(
    roomId: RoomId,
    playerId: PlayerId,
    targetPlayerId: PlayerId,
    slotIndex: number,
    tokenKind: ShikigamiTokenKind
  ): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return engineRemoveShikigamiToken(room.matchState, playerId, targetPlayerId, slotIndex, tokenKind);
  }

  adjustPlayerHp(roomId: RoomId, playerId: PlayerId, delta: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return engineAdjustPlayerHp(room.matchState, playerId, delta);
  }

  adjustGhostFire(roomId: RoomId, playerId: PlayerId, delta: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return engineAdjustGhostFire(room.matchState, playerId, delta);
  }

  adjustFortuneFire(roomId: RoomId, playerId: PlayerId, delta: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return engineAdjustFortuneFire(room.matchState, playerId, delta);
  }

  adjustPlayerPoison(roomId: RoomId, playerId: PlayerId, delta: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return engineAdjustPlayerPoison(room.matchState, playerId, delta);
  }

  adjustPlayerDamage(roomId: RoomId, playerId: PlayerId, delta: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return engineAdjustPlayerDamage(room.matchState, playerId, delta);
  }

  placeBarrierToken(roomId: RoomId, playerId: PlayerId, targetPlayerId: PlayerId, tokenKind: "energy" | "barrier" | "stun" | "silence" | "poison" | "weaken"): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return enginePlaceBarrierToken(room.matchState, playerId, targetPlayerId, tokenKind);
  }

  removeBarrierToken(roomId: RoomId, playerId: PlayerId, targetPlayerId: PlayerId, tokenKind: "energy" | "barrier" | "stun" | "silence" | "poison" | "weaken"): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return engineRemoveBarrierToken(room.matchState, playerId, targetPlayerId, tokenKind);
  }

  addCustomMarker(roomId: RoomId, playerId: PlayerId, targetPlayerId: PlayerId, markerName: string, delta: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return engineAddCustomMarker(room.matchState, playerId, targetPlayerId, markerName, delta);
  }

  addCustomMarkerToShikigami(roomId: RoomId, playerId: PlayerId, targetPlayerId: PlayerId, slotIndex: number, markerName: string, delta: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return engineAddCustomMarkerToShikigami(room.matchState, playerId, targetPlayerId, slotIndex, markerName, delta);
  }

  addCustomMarkerToSpell(roomId: RoomId, playerId: PlayerId, targetPlayerId: PlayerId, cardId: string, markerName: string, delta: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return engineAddCustomMarkerToSpell(room.matchState, playerId, targetPlayerId, cardId, markerName, delta);
  }

  addCustomMarkerToExtend(roomId: RoomId, playerId: PlayerId, targetPlayerId: PlayerId, cardId: string, markerName: string, delta: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) throw new Error("match not started");
    return engineAddCustomMarkerToExtend(room.matchState, playerId, targetPlayerId, cardId, markerName, delta);
  }

  toggleShikigamiStealth(roomId: RoomId, playerId: PlayerId, cardId: string, stealth: boolean): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return engineToggleShikigamiStealth(room.matchState, playerId, cardId, stealth);
  }

  broadcastRoom(roomId: RoomId, event: ServerEvent): void {
    const room = this.getRoomOrThrow(roomId);
    for (const [playerId, entry] of room.players.entries()) {
      // 修复：先检查 ws 是否为 null，再检查 readyState
      if (!entry.ws || entry.ws.readyState !== WebSocket.OPEN) {
        console.log(`[broadcastRoom] 跳过玩家 ${playerId}: ws=${entry.ws ? 'not OPEN' : 'null'}`);
        continue;
      }
      try {
        if (event.type === "match_started" || event.type === "match_state") {
          const payload = sanitizeMatchStateForPlayer(event.payload, playerId);
          entry.ws.send(JSON.stringify({ ...event, payload }));
        } else {
          entry.ws.send(JSON.stringify(event));
        }
        console.log(`[broadcastRoom] 已发送 ${event.type} 给玩家 ${playerId}`);
      } catch (error) {
        console.error(`[RoomManager] Failed to send to ${playerId}:`, error);
      }
    }
  }

  /** 处理玩家断线：不直接删除，标记为断线状态，启动超时清理 */
  markDisconnected(ws: WebSocket): void {
    let targetRoomId: RoomId | null = null;
    let targetPlayerId: PlayerId | null = null;
    for (const [roomId, room] of this.rooms.entries()) {
      for (const [playerId, entry] of room.players.entries()) {
        if (entry.ws === ws) {
          targetRoomId = roomId;
          targetPlayerId = playerId;
          break;
        }
      }
      if (targetRoomId) break;
    }
    if (!targetRoomId || !targetPlayerId) return;

    const room = this.rooms.get(targetRoomId)!;
    const entry = room.players.get(targetPlayerId)!;
    entry.ws = null;
    entry.disconnectedAt = Date.now();

    // 广播断线通知（使用 player_disconnected 事件）
    this.broadcastRoom(targetRoomId, {
      type: "player_disconnected",
      payload: { playerId: targetPlayerId }
    });

    // 启动定时清理（如果还没启动）
    this.ensureCleanupTimer();
  }

  /** 确保清理定时器已启动 */
  ensureCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanupTimedOutRooms(), 30_000);
  }

  /** 扫描并清理超时（1分钟）断线的玩家；双方均断线则删除整个房间 */
  cleanupTimedOutRooms(): void {
    const now = Date.now();
    const TIMEOUT = 60_000; // 1 分钟
    for (const [roomId, room] of this.rooms.entries()) {
      let allDisconnected = true;
      for (const [playerId, entry] of room.players.entries()) {
        if (entry.ws === null && entry.disconnectedAt) {
          if (now - entry.disconnectedAt > TIMEOUT) {
            // 超时：删除该玩家，若对局中则判对手获胜
            if (room.matchState && !room.matchState.winnerId) {
              const opponentId = [...room.players.keys()].find((id) => id !== playerId);
              if (opponentId) room.matchState.winnerId = opponentId;
              this.broadcastRoom(roomId, { type: "match_state", payload: room.matchState });
            }
            room.players.delete(playerId);
          } else {
            allDisconnected = false;
          }
        } else if (entry.ws !== null) {
          allDisconnected = false;
        }
      }
      // 双方均超时断线：直接删除整个房间
      if (room.players.size === 0 || allDisconnected) {
        this.rooms.delete(roomId);
      }
    }
  }

  /** 根据 reconnectToken 查找 playerId（供 index.ts 使用）*/
  getPlayerIdByToken(roomId: RoomId, reconnectToken: string): PlayerId | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    for (const [pid, entry] of room.players.entries()) {
      if (entry.reconnectToken === reconnectToken) return pid;
    }
    return null;
  }

  /** 断线重连：通过 reconnectToken 找到玩家，恢复 WebSocket 连接；需校验 playerId 与 token 匹配 */
  reconnect(roomId: RoomId, reconnectToken: string, playerId: string, newWs: WebSocket): MatchState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    for (const [pid, entry] of room.players.entries()) {
      if (entry.reconnectToken === reconnectToken) {
        // 双重校验：token 对应的 playerId 必须与请求中的 playerId 一致
        if (pid !== playerId) return null;
        entry.ws = newWs;
        delete entry.disconnectedAt;
        this.broadcastRoom(roomId, {
          type: "player_reconnected",
          payload: { playerId: pid }
        });
        return room.matchState ?? null;
      }
    }
    return null;
  }

  /** 主动离开房间 */
  leaveRoom(roomId: RoomId, playerId: PlayerId): PlayerId | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.players.delete(playerId);
    const remaining = [...room.players.keys()];
    if (remaining.length === 0) {
      this.rooms.delete(roomId);
    }
    return playerId;
  }

  /** 重开对局：使用双方 customDeck 重新初始化 matchState */
  rematch(roomId: RoomId, playerId: PlayerId): MatchState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    // 收集双方牌库
    const decks: BuilderCard[][] = [];
    for (const [, entry] of room.players.entries()) {
      if (entry.customDeck && entry.customDeck.length > 0) {
        decks.push(entry.customDeck);
      } else {
        // 没有自定义牌库则使用默认
        decks.push([]);
      }
    }
    if (decks.length < 2) return null;
    // 重建双方玩家状态并准备对局
    const playerEntries = [...room.players.entries()];
    for (const [id, entry] of playerEntries) {
      entry.state = createPlayer(id, entry.state.name, entry.customDeck);
      preparePlayerForMatch(entry.state);
    }
    const states = playerEntries.map((entry) => entry[1].state);
    room.matchState = createMatchState(room.id, states[0], states[1]);
    return room.matchState;
  }

  private getRoomOrThrow(roomId: RoomId): Room {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("room not found");
    }
    return room;
  }
}

