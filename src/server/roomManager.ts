import { nanoid } from "nanoid";
import WebSocket from "ws";
import { BuilderCard, MatchState, PlayerId, PlayerState, RoomId, ServerEvent } from "../shared/types.js";
import {
  adjustPlayerHp as engineAdjustPlayerHp,
  attack,
  createMatchState,
  createPlayer,
  deckDraw,
  deckPeek,
  deckSearch,
  deckSearchReturn,
  deckShuffle,
  endTurn,
  moveCard,
  placeShikigamiToken as enginePlaceShikigamiToken,
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

type Room = {
  id: RoomId;
  players: Map<PlayerId, { ws: WebSocket; state: PlayerState; customDeck?: BuilderCard[] }>;
  matchState?: MatchState;
};

export class RoomManager {
  private readonly rooms = new Map<RoomId, Room>();

  createRoom(ws: WebSocket, name: string): { roomId: RoomId; playerId: PlayerId } {
    const roomId = nanoid(8);
    const playerId = nanoid(8);
    const room: Room = {
      id: roomId,
      players: new Map([[playerId, { ws, state: createPlayer(playerId, name) }]])
    };
    this.rooms.set(roomId, room);
    return { roomId, playerId };
  }

  joinRoom(roomId: RoomId, ws: WebSocket, name: string): { roomId: RoomId; playerId: PlayerId; players: PlayerState[] } {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("room not found");
    }
    if (room.players.size >= 2) {
      throw new Error("room is full");
    }
    const playerId = nanoid(8);
    room.players.set(playerId, { ws, state: createPlayer(playerId, name) });
    return {
      roomId,
      playerId,
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

  deckPeek(roomId: RoomId, playerId: PlayerId, count: number): MatchState {
    const room = this.getRoomOrThrow(roomId);
    if (!room.matchState) {
      throw new Error("match not started");
    }
    return deckPeek(room.matchState, playerId, count);
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
      if (entry.ws.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (event.type === "match_started" || event.type === "match_state") {
        const payload = sanitizeMatchStateForPlayer(event.payload, playerId);
        entry.ws.send(JSON.stringify({ ...event, payload }));
      } else {
        entry.ws.send(JSON.stringify(event));
      }
    }
  }

  /** 处理玩家断线：清理房间状态，通知对手 */
  handleDisconnect(ws: WebSocket): void {
    // 找到该 ws 所在的房间和玩家
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

    // 通知房间内其他玩家有人断线
    const disconnectEvent: ServerEvent = {
      type: "error",
      payload: { message: `玩家 ${room.players.get(targetPlayerId)?.state.name ?? "未知"} 已断线` }
    };
    for (const [pid, entry] of room.players.entries()) {
      if (pid !== targetPlayerId && entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.send(JSON.stringify(disconnectEvent));
      }
    }

    // 如果正在对局中，标记对手获胜
    if (room.matchState && !room.matchState.winnerId) {
      const opponentId = Object.keys(room.matchState.players).find((id) => id !== targetPlayerId);
      if (opponentId) {
        room.matchState.winnerId = opponentId;
        this.broadcastRoom(targetRoomId, {
          type: "match_state",
          payload: room.matchState
        });
      }
    }

    // 如果房间只剩一个人或没人了，销毁房间
    room.players.delete(targetPlayerId);
    if (room.players.size === 0) {
      this.rooms.delete(targetRoomId);
    }
  }

  private getRoomOrThrow(roomId: RoomId): Room {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("room not found");
    }
    return room;
  }
}

