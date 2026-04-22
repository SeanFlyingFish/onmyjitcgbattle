import { nanoid } from "nanoid";
import WebSocket from "ws";
import { adjustPlayerHp as engineAdjustPlayerHp, attack, createMatchState, createPlayer, deckDraw, deckPeek, deckSearch, deckShuffle, endTurn, moveCard, placeShikigamiToken as enginePlaceShikigamiToken, playCard, preparePlayerForMatch, removeShikigamiToken as engineRemoveShikigamiToken, sanitizeMatchStateForPlayer, submitMulligan, toggleShikigamiExhaust, toggleSpellExhaust, toggleSpellReveal, toggleHandReveal } from "./gameEngine.js";
export class RoomManager {
    rooms = new Map();
    createRoom(ws, name) {
        const roomId = nanoid(8);
        const playerId = nanoid(8);
        const room = {
            id: roomId,
            players: new Map([[playerId, { ws, state: createPlayer(playerId, name) }]])
        };
        this.rooms.set(roomId, room);
        return { roomId, playerId };
    }
    joinRoom(roomId, ws, name) {
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
    updatePlayerDeck(roomId, playerId, deck) {
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
    startMatch(roomId) {
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
    submitMulligan(roomId, playerId, cardIds) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return submitMulligan(room.matchState, playerId, cardIds);
    }
    playCard(roomId, playerId, cardId, targetPlayerId, zone) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return playCard(room.matchState, playerId, cardId, targetPlayerId, zone);
    }
    toggleSpellExhaust(roomId, playerId, cardId) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return toggleSpellExhaust(room.matchState, playerId, cardId);
    }
    toggleShikigamiExhaust(roomId, playerId, cardId) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return toggleShikigamiExhaust(room.matchState, playerId, cardId);
    }
    endTurn(roomId, playerId) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return endTurn(room.matchState, playerId);
    }
    attack(roomId, playerId, attackerCardId, targetPlayerId, target, targetCardId) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return attack(room.matchState, playerId, attackerCardId, targetPlayerId, target, targetCardId);
    }
    opponentId(state, playerId) {
        return Object.keys(state.players).find((id) => id !== playerId) ?? null;
    }
    moveCard(roomId, playerId, cardId, from, to, toShikigamiSlot) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return moveCard(room.matchState, playerId, cardId, from, to, toShikigamiSlot, this.opponentId(room.matchState, playerId));
    }
    toggleSpellReveal(roomId, playerId, cardId) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return toggleSpellReveal(room.matchState, playerId, cardId);
    }
    toggleHandReveal(roomId, playerId, cardId, reveal) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return toggleHandReveal(room.matchState, playerId, cardId, reveal);
    }
    deckDraw(roomId, playerId, count) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return deckDraw(room.matchState, playerId, count, this.opponentId(room.matchState, playerId));
    }
    deckShuffle(roomId, playerId) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return deckShuffle(room.matchState, playerId);
    }
    deckSearch(roomId, playerId, count) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return deckSearch(room.matchState, playerId, count);
    }
    deckPeek(roomId, playerId, count) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return deckPeek(room.matchState, playerId, count);
    }
    placeShikigamiToken(roomId, playerId, targetPlayerId, slotIndex, tokenKind) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return enginePlaceShikigamiToken(room.matchState, playerId, targetPlayerId, slotIndex, tokenKind);
    }
    removeShikigamiToken(roomId, playerId, targetPlayerId, slotIndex, tokenKind) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return engineRemoveShikigamiToken(room.matchState, playerId, targetPlayerId, slotIndex, tokenKind);
    }
    adjustPlayerHp(roomId, playerId, delta) {
        const room = this.getRoomOrThrow(roomId);
        if (!room.matchState) {
            throw new Error("match not started");
        }
        return engineAdjustPlayerHp(room.matchState, playerId, delta);
    }
    broadcastRoom(roomId, event) {
        const room = this.getRoomOrThrow(roomId);
        for (const [playerId, entry] of room.players.entries()) {
            if (entry.ws.readyState !== WebSocket.OPEN) {
                continue;
            }
            if (event.type === "match_started" || event.type === "match_state") {
                const payload = sanitizeMatchStateForPlayer(event.payload, playerId);
                entry.ws.send(JSON.stringify({ ...event, payload }));
            }
            else {
                entry.ws.send(JSON.stringify(event));
            }
        }
    }
    /** 处理玩家断线：清理房间状态，通知对手 */
    handleDisconnect(ws) {
        // 找到该 ws 所在的房间和玩家
        let targetRoomId = null;
        let targetPlayerId = null;
        for (const [roomId, room] of this.rooms.entries()) {
            for (const [playerId, entry] of room.players.entries()) {
                if (entry.ws === ws) {
                    targetRoomId = roomId;
                    targetPlayerId = playerId;
                    break;
                }
            }
            if (targetRoomId)
                break;
        }
        if (!targetRoomId || !targetPlayerId)
            return;
        const room = this.rooms.get(targetRoomId);
        // 通知房间内其他玩家有人断线
        const disconnectEvent = {
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
    getRoomOrThrow(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) {
            throw new Error("room not found");
        }
        return room;
    }
}
