import { nanoid } from "nanoid";
import {
  BuilderCard,
  Card,
  MatchState,
  PlayerId,
  PlayerState,
  ShikigamiTokenKind,
  ShikigamiZoneCard,
  SpellZoneCard
} from "../shared/types.js";

const STARTING_HP = 30;
const STARTING_HAND_SIZE = 0;
const MULLIGAN_HAND_SIZE = 5;
const TURN_START_DRAW = 2;
const MAX_HAND_SIZE = 12;
const REMOVE_ZONE_LOSE_COUNT = 12;
const DECK_SIZE = 60;
const SHIKIGAMI_SLOTS = 6;

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function createStarterDeck(): Card[] {
  const cards: Card[] = [];
  const types = ["shikigami", "shikigami", "spell", "awaken", "attach", "barrier"] as const;
  for (let i = 0; i < DECK_SIZE; i += 1) {
    const t = types[i % types.length];
    cards.push({
      id: nanoid(10),
      name: `Card-${i + 1}`,
      type: t,
      cost: 1,
      attack: 1,
      health: 1
    });
  }
  return cards;
}

function spellEntryFromCard(card: Card): SpellZoneCard {
  return {
    card,
    faceUp: card.type === "awaken",
    exhausted: false,
    revealedToOpponent: card.type === "awaken"
  };
}

function drawCards(deck: Card[], count: number): Card[] {
  return deck.splice(0, count);
}

/**
 * 将组卡器格式的卡片转换为游戏引擎 Card 格式。
 * 规则映射：
 *   式神 → shikigami（带攻击/生命默认值）
 *   觉醒 → attach
 *   附灵 → attach
 *   法术 → spell
 *   结界 → barrier
 */
export function cardFromBuilder(builderCard: BuilderCard): Card {
  let cost: number;
  const rawCost = String(builderCard.cost ?? "1");
  if (rawCost === "none" || rawCost === "X" || rawCost === "无" || rawCost === "10+") {
    cost = 0;
  } else {
    cost = parseInt(rawCost, 10);
    if (isNaN(cost)) cost = 1;
  }

  let type: Card["type"];
  // 同时支持中文（组卡器原始格式）和英文（cards-database.ts 格式）
  switch (builderCard.type) {
    case "式神":
    case "shikigami":  type = "shikigami"; break;
    case "觉醒":
    case "awaken":     type = "awaken";    break;
    case "附灵":
    case "attach":     type = "attach";    break;
    case "法术":
    case "spell":      type = "spell";     break;
    case "结界":
    case "barrier":    type = "barrier";   break;
    default:
      console.warn(`[cardFromBuilder] 未知卡牌类型: "${builderCard.type}" (${builderCard.name})，默认为 spell`);
      type = "spell";     break;
  }

  // 攻击/生命：从卡牌数据读取（如有），否则使用 Lua 格式的 power/life
  const isShikigami = type === "shikigami";
  const rawAttack = (builderCard as unknown as { attack?: number }).attack ?? (builderCard as unknown as { power?: number }).power;
  const rawHealth = (builderCard as unknown as { health?: number }).health ?? (builderCard as unknown as { life?: number }).life;
  const attack = isShikigami && rawAttack !== undefined ? rawAttack : (isShikigami ? Math.max(1, Math.min(10, cost + Math.floor(Math.random() * 3) - 1)) : 0);
  const health = isShikigami && rawHealth !== undefined ? rawHealth : (isShikigami ? Math.max(1, Math.max(2, cost + Math.floor(Math.random() * 4) - 1)) : 0);

  return {
    id: nanoid(10),
    name: String(builderCard.name ?? "未知卡牌"),
    type,
    cost,
    attack,
    health,
    keyword: String(builderCard.keyword ?? ""),
    ability: String(builderCard.ability ?? ""),
    img: String(builderCard.img ?? "")
  };
}

export function createPlayer(
  playerId: PlayerId,
  name: string,
  customDeck?: BuilderCard[]
): PlayerState {
  let deck: Card[];
  if (customDeck && customDeck.length > 0) {
    deck = customDeck.map((c) => cardFromBuilder(c));
    // 调试：检查前几张式神的 attack/health
    const shikigami = deck.filter(c => c.type === "shikigami").slice(0, 3);
    console.log(`[游戏引擎] 创建玩家 ${playerId} 牌库`);
    shikigami.forEach(c => console.log(`[游戏引擎] 式神: ${c.name} attack=${c.attack} health=${c.health}`));
  } else {
    deck = createStarterDeck();
  }
  const hand = drawCards(deck, STARTING_HAND_SIZE);
  return {
    id: playerId,
    name,
    hp: STARTING_HP,
    deck,
    deckCount: deck.length,
    maxHandSize: MAX_HAND_SIZE,
    hand,
    graveyard: [],
    removedZone: [],
    spellZone: [],
    shikigamiZone: Array.from({ length: SHIKIGAMI_SLOTS }, () => null),
    extendZone: Array.from({ length: SHIKIGAMI_SLOTS }, () => []),
    barrier: null,
    barrierExhausted: false,
    spellCardsPlayedThisTurn: 0,
    deckSearchBuffer: [],
    deckPeekBuffer: [],
    revealedHandIds: []
  };
}

/** 对局开始：洗牌并起手 5 张，进入同步调度阶段 */
export function preparePlayerForMatch(player: PlayerState): void {
  shuffleInPlace(player.deck);
  player.hand = drawCards(player.deck, MULLIGAN_HAND_SIZE);
  player.deckCount = player.deck.length;
}

function resetPlayerField(player: PlayerState): void {
  for (const slot of player.shikigamiZone) {
    if (slot) {
      slot.exhausted = false;
    }
  }
  for (const spell of player.spellZone) {
    spell.exhausted = false;
  }
}

function drawCardsWithOverflow(
  state: MatchState,
  player: PlayerState,
  count: number,
  opponentId: PlayerId | null
): void {
  const opponent = opponentId ? state.players[opponentId] : undefined;
  for (let i = 0; i < count; i += 1) {
    const drawnCard = player.deck.shift();
    if (!drawnCard) {
      break;
    }
    if (player.hand.length >= player.maxHandSize) {
      player.removedZone.push({ ...drawnCard }); // 浅拷贝
      if (opponent && player.removedZone.length >= REMOVE_ZONE_LOSE_COUNT) {
        state.winnerId = opponent.id;
      }
    } else {
      player.hand.push(drawnCard);
    }
    player.deckCount = player.deck.length;
  }
}

/** 回合开始：重置己方场上横置并抽牌（先手第一回合亦同） */
export function applyTurnStart(state: MatchState, playerId: PlayerId, opponentId: PlayerId | null): void {
  const player = state.players[playerId];
  if (!player || state.winnerId) {
    return;
  }
  resetPlayerField(player);
  player.spellCardsPlayedThisTurn = 0;
  drawCardsWithOverflow(state, player, TURN_START_DRAW, opponentId);
}

function applyMulligan(player: PlayerState, cardIds: string[]): void {
  const idSet = new Set(cardIds);
  if (idSet.size !== cardIds.length) {
    return;
  }
  const handIds = new Set(player.hand.map((c) => c.id));
  for (const id of cardIds) {
    if (!handIds.has(id)) {
      return;
    }
  }

  const setAside: Card[] = [];
  for (const id of cardIds) {
    const idx = player.hand.findIndex((c) => c.id === id);
    if (idx === -1) {
      return;
    }
    setAside.push(player.hand.splice(idx, 1)[0]!);
  }

  const need = setAside.length;
  for (let i = 0; i < need; i += 1) {
    const drawn = player.deck.shift();
    if (!drawn) {
      break;
    }
    if (player.hand.length >= player.maxHandSize) {
      player.removedZone.push({ ...drawn }); // 浅拷贝
    } else {
      player.hand.push(drawn);
    }
  }

  player.deck.push(...setAside);
  shuffleInPlace(player.deck);
  player.deckCount = player.deck.length;
}

function resolveMulligans(state: MatchState): void {
  const choices = state.mulliganChoices;
  if (!choices) {
    return;
  }
  for (const pid of Object.keys(state.players)) {
    applyMulligan(state.players[pid]!, choices[pid] ?? []);
  }
  state.phase = "playing";
  state.mulliganSubmitted = undefined;
  state.mulliganChoices = undefined;

  const ids = Object.keys(state.players);
  const firstId = state.currentPlayerId;
  const otherId = ids.find((id) => id !== firstId) ?? null;
  applyTurnStart(state, firstId, otherId);
}

export function submitMulligan(state: MatchState, playerId: PlayerId, cardIds: string[]): MatchState {
  if (state.phase !== "mulligan" || state.winnerId) {
    return state;
  }
  const player = state.players[playerId];
  if (!player) {
    return state;
  }

  const idSet = new Set(cardIds);
  if (idSet.size !== cardIds.length) {
    return state;
  }
  const handIds = new Set(player.hand.map((c) => c.id));
  for (const id of cardIds) {
    if (!handIds.has(id)) {
      return state;
    }
  }

  if (!state.mulliganSubmitted) {
    state.mulliganSubmitted = {};
  }
  if (!state.mulliganChoices) {
    state.mulliganChoices = {};
  }
  state.mulliganChoices[playerId] = cardIds;
  state.mulliganSubmitted[playerId] = true;

  const allIds = Object.keys(state.players);
  if (allIds.length === 2 && allIds.every((id) => state.mulliganSubmitted?.[id])) {
    resolveMulligans(state);
  }
  return state;
}

type MoveFrom = "hand" | "graveyard" | "spell" | "shikigami" | "barrier" | "deck_top" | "deck_search" | "removed_zone" | "extend" | "showcase";
type MoveTo = "hand" | "graveyard" | "spell" | "shikigami" | "barrier" | "deck_top" | "deck_bottom" | "removed_zone" | "extend" | "showcase";

function newShikigamiEntry(card: Card, stealth = false): ShikigamiZoneCard {
  return {
    card,
    exhausted: false,
    attackModifier: 0,
    healthModifier: 0,
    damageMarkers: 0,
    baseAttack: card.attack,
    baseHealth: card.health,
    energyMarkers: 0,
    barrierMarkers: 0,
    stunMarkers: 0,
    stealth
  };
}

function effectiveAttack(slot: ShikigamiZoneCard): number {
  return Math.max(0, slot.card.attack + (slot.attackModifier ?? 0));
}

function findFirstEmptyShikigamiSlot(player: PlayerState): number {
  return player.shikigamiZone.findIndex((s) => s == null);
}

function canPlaceShikigami(player: PlayerState, toShikigamiSlot: number | undefined): boolean {
  if (toShikigamiSlot !== undefined) {
    if (toShikigamiSlot < 0 || toShikigamiSlot >= SHIKIGAMI_SLOTS) {
      return false;
    }
    return player.shikigamiZone[toShikigamiSlot] == null;
  }
  return findFirstEmptyShikigamiSlot(player) >= 0;
}

function removeCardFromSource(
  state: MatchState,
  player: PlayerState,
  from: MoveFrom,
  cardId: string
): {
  card: Card;
  spellEntry?: SpellZoneCard;
  shikigamiFromIndex?: number;
  shikigamiEntry?: ShikigamiZoneCard;
} | null {
  switch (from) {
    case "hand": {
      const i = player.hand.findIndex((c) => c.id === cardId);
      if (i === -1) {
        return null;
      }
      return { card: player.hand.splice(i, 1)[0]! };
    }
    case "graveyard": {
      const i = player.graveyard.findIndex((c) => c.id === cardId);
      if (i === -1) {
        return null;
      }
      return { card: player.graveyard.splice(i, 1)[0]! };
    }
    case "removed_zone": {
      const i = player.removedZone.findIndex((c) => c.id === cardId);
      if (i === -1) {
        return null;
      }
      return { card: player.removedZone.splice(i, 1)[0]! };
    }
    case "spell": {
      const i = player.spellZone.findIndex((e) => e.card.id === cardId);
      if (i === -1) {
        return null;
      }
      const entry = player.spellZone.splice(i, 1)[0]!;
      return { card: entry.card, spellEntry: entry };
    }
    case "shikigami": {
      const i = player.shikigamiZone.findIndex((s) => s?.card.id === cardId);
      if (i === -1) {
        return null;
      }
      const slot = player.shikigamiZone[i];
      if (!slot) {
        return null;
      }
      player.shikigamiZone[i] = null;
      return { card: slot.card, shikigamiFromIndex: i, shikigamiEntry: slot };
    }
    case "barrier": {
      if (!player.barrier || player.barrier.id !== cardId) {
        return null;
      }
      const c = player.barrier;
      player.barrier = null;
      return { card: c };
    }
    case "deck_top": {
      if (player.deck.length === 0 || player.deck[0]!.id !== cardId) {
        return null;
      }
      return { card: player.deck.shift()! };
    }
    case "deck_search": {
      const i = player.deckSearchBuffer.findIndex((c) => c.id === cardId);
      if (i === -1) {
        return null;
      }
      return { card: player.deckSearchBuffer.splice(i, 1)[0]! };
    }
    case "extend": {
      for (let slot = 0; slot < player.extendZone.length; slot++) {
        const i = player.extendZone[slot].findIndex((e) => e.card.id === cardId);
        if (i !== -1) {
          return { card: player.extendZone[slot].splice(i, 1)[0]!.card };
        }
      }
      return null;
    }
    case "showcase": {
      const i = state.showcaseZone.findIndex((c) => c.id === cardId);
      if (i === -1) {
        return null;
      }
      return { card: state.showcaseZone.splice(i, 1)[0]! };
    }
    default:
      return null;
  }
}

function addCardToTarget(
  state: MatchState,
  player: PlayerState,
  to: MoveTo,
  card: Card,
  toShikigamiSlot: number | undefined,
  opponentId: PlayerId | null,
  /** 如果从式神区移出，传递原始攻击/生命值以在离场时恢复 */
  baseValues?: { baseAttack: number; baseHealth: number }
): boolean {
  // 当式神离开战场（到手牌/墓地/牌库）时，恢复原始 attack/health
  if (baseValues && (to === "hand" || to === "graveyard" || to === "deck_top" || to === "deck_bottom")) {
    card.attack = baseValues.baseAttack;
    card.health = baseValues.baseHealth;
  }

  switch (to) {
    case "hand": {
      if (player.hand.length >= player.maxHandSize) {
        player.removedZone.push({ ...card }); // 浅拷贝
        const opponent = opponentId ? state.players[opponentId] : undefined;
        if (opponent && player.removedZone.length >= REMOVE_ZONE_LOSE_COUNT) {
          state.winnerId = opponent.id;
        }
      } else {
        player.hand.push(card);
      }
      return true;
    }
    case "graveyard": {
      player.graveyard.push({ ...card }); // 浅拷贝，防止后续槽位复用时意外污染墓地的卡牌数据
      return true;
    }
    case "spell": {
      player.spellZone.push(spellEntryFromCard(card));
      return true;
    }
    case "shikigami": {
      let slot = toShikigamiSlot;
      if (slot === undefined) {
        slot = findFirstEmptyShikigamiSlot(player);
      }
      if (slot < 0 || slot >= SHIKIGAMI_SLOTS) {
        return false;
      }
      if (player.shikigamiZone[slot] !== null) {
        return false;
      }
      player.shikigamiZone[slot] = newShikigamiEntry(card);
      return true;
    }
    case "barrier": {
      if (player.barrier) {
        player.graveyard.push({ ...player.barrier }); // 浅拷贝
      }
      player.barrier = card;
      return true;
    }
    case "deck_top": {
      player.deck.unshift(card);
      player.deckCount = player.deck.length;
      return true;
    }
    case "deck_bottom": {
      player.deck.push(card);
      player.deckCount = player.deck.length;
      return true;
    }
    case "removed_zone": {
      player.removedZone.push({ ...card }); // 浅拷贝
      const opponent = opponentId ? state.players[opponentId] : undefined;
      if (opponent && player.removedZone.length >= REMOVE_ZONE_LOSE_COUNT) {
        state.winnerId = opponent.id;
      }
      return true;
    }
    case "extend": {
      if (toShikigamiSlot === undefined) {
        return false;
      }
      player.extendZone[toShikigamiSlot].push({ card, exhausted: false });
      return true;
    }
    case "showcase": {
      state.showcaseZone.push({ ...card }); // 浅拷贝，添加到共享展示区
      return true;
    }
    default:
      return false;
  }
}

function restoreCardToSource(
  player: PlayerState,
  from: MoveFrom,
  card: Card,
  spellEntry?: SpellZoneCard,
  shikigamiFromIndex?: number,
  shikigamiEntry?: ShikigamiZoneCard
): void {
  switch (from) {
    case "hand":
      player.hand.push(card);
      break;
    case "graveyard":
      player.graveyard.push({ ...card }); // 浅拷贝，防止标记物数据被带入场外
      break;
    case "removed_zone":
      player.removedZone.push({ ...card }); // 浅拷贝
      break;
    case "spell":
      player.spellZone.push(spellEntry ?? spellEntryFromCard(card));
      break;
    case "shikigami": {
      if (shikigamiFromIndex !== undefined && shikigamiFromIndex >= 0 && shikigamiFromIndex < SHIKIGAMI_SLOTS) {
        player.shikigamiZone[shikigamiFromIndex] = shikigamiEntry ?? newShikigamiEntry(card);
      }
      break;
    }
    case "barrier":
      player.barrier = card;
      break;
    case "deck_top":
      player.deck.unshift(card);
      player.deckCount = player.deck.length;
      break;
    case "deck_search":
      player.deckSearchBuffer.push(card);
      break;
    default:
      break;
  }
}

export function moveCard(
  state: MatchState,
  actorId: PlayerId,
  cardId: string,
  from: MoveFrom,
  to: MoveTo,
  toShikigamiSlot: number | undefined,
  opponentId: PlayerId | null
): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const player = state.players[actorId];
  if (!player) {
    return state;
  }

  if (to === "shikigami" && !canPlaceShikigami(player, toShikigamiSlot)) {
    return state;
  }

  const removed = removeCardFromSource(state, player, from, cardId);
  if (!removed) {
    return state;
  }

  const { card, spellEntry, shikigamiFromIndex, shikigamiEntry } = removed;

  // 如果从式神区移出，传递原始值以便离场时恢复
  const baseValues = shikigamiEntry
    ? { baseAttack: shikigamiEntry.baseAttack, baseHealth: shikigamiEntry.baseHealth }
    : undefined;

  const ok = addCardToTarget(state, player, to, card, toShikigamiSlot, opponentId, baseValues);
  if (!ok) {
    restoreCardToSource(player, from, card, spellEntry, shikigamiFromIndex, shikigamiEntry);
    return state;
  }

  player.deckCount = player.deck.length;
  return state;
}

export function toggleSpellReveal(state: MatchState, actorId: PlayerId, cardId: string): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const player = state.players[actorId];
  if (!player) {
    return state;
  }
  const entry = player.spellZone.find((e) => e.card.id === cardId);
  if (!entry || entry.card.type === "awaken") {
    return state;
  }
  entry.revealedToOpponent = !entry.revealedToOpponent;
  return state;
}

/** 公开/取消公开己方手牌给对手看 */
export function toggleHandReveal(state: MatchState, actorId: PlayerId, cardId: string, reveal: boolean): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const player = state.players[actorId];
  if (!player) {
    return state;
  }
  if (!player.hand.some(c => c.id === cardId)) {
    return state;
  }
  player.revealedHandIds = player.revealedHandIds ?? [];
  if (reveal) {
    if (!player.revealedHandIds.includes(cardId)) {
      player.revealedHandIds.push(cardId);
    }
  } else {
    player.revealedHandIds = player.revealedHandIds.filter(id => id !== cardId);
  }
  return state;
}

export function deckDraw(state: MatchState, actorId: PlayerId, count: number, opponentId: PlayerId | null): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const player = state.players[actorId];
  if (!player) {
    return state;
  }
  drawCardsWithOverflow(state, player, count, opponentId);
  return state;
}

export function deckShuffle(state: MatchState, actorId: PlayerId): MatchState {
  if (state.winnerId || state.phase !== "playing" || state.currentPlayerId !== actorId) {
    return state;
  }
  const p = state.players[actorId];
  if (!p) {
    return state;
  }
  if (p.deckSearchBuffer.length > 0) {
    p.deck = [...p.deckSearchBuffer, ...p.deck];
    p.deckSearchBuffer = [];
  }
  shuffleInPlace(p.deck);
  p.deckPeekBuffer = [];
  p.deckCount = p.deck.length;
  return state;
}

export function deckSearch(state: MatchState, actorId: PlayerId, count: number): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const p = state.players[actorId];
  if (!p) {
    return state;
  }
  if (p.deckSearchBuffer.length > 0) {
    p.deck = [...p.deckSearchBuffer, ...p.deck];
    p.deckSearchBuffer = [];
  }
  const n = Math.min(count, p.deck.length);
  p.deckSearchBuffer = p.deck.splice(0, n);
  p.deckPeekBuffer = [];
  p.deckCount = p.deck.length;
  return state;
}

/** 将 deckSearchBuffer 中的牌放回牌库顶，不洗牌 */
export function deckSearchReturn(state: MatchState, actorId: PlayerId): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const p = state.players[actorId];
  if (!p) {
    return state;
  }
  if (p.deckSearchBuffer.length > 0) {
    p.deck = [...p.deckSearchBuffer, ...p.deck];
    p.deckSearchBuffer = [];
  }
  p.deckPeekBuffer = [];
  p.deckCount = p.deck.length;
  return state;
}

export function deckPeek(state: MatchState, actorId: PlayerId, count: number): MatchState {
  if (state.winnerId || state.phase !== "playing" || state.currentPlayerId !== actorId) {
    return state;
  }
  const p = state.players[actorId];
  if (!p) {
    return state;
  }
  const n = Math.min(count, p.deck.length);
  p.deckPeekBuffer = p.deck.slice(0, n).map((c) => ({ ...c }));
  return state;
}

export function placeShikigamiToken(
  state: MatchState,
  _actorId: PlayerId,
  targetPlayerId: PlayerId,
  slotIndex: number,
  tokenKind: ShikigamiTokenKind
): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const player = state.players[targetPlayerId];
  if (!player || slotIndex < 0 || slotIndex >= SHIKIGAMI_SLOTS) {
    return state;
  }
  const slot = player.shikigamiZone[slotIndex];
  if (!slot) {
    return state;
  }

  slot.attackModifier = slot.attackModifier ?? 0;
  slot.healthModifier = slot.healthModifier ?? 0;
  slot.damageMarkers = slot.damageMarkers ?? 0;
  slot.energyMarkers = slot.energyMarkers ?? 0;
  slot.barrierMarkers = slot.barrierMarkers ?? 0;
  slot.stunMarkers = slot.stunMarkers ?? 0;

  switch (tokenKind) {
    case "attack_plus":
      slot.attackModifier += 1;
      break;
    case "attack_minus":
      slot.attackModifier -= 1;
      break;
    case "health_plus":
      slot.healthModifier += 1;
      slot.card.health += 1;
      break;
    case "health_minus":
      slot.healthModifier -= 1;
      slot.card.health -= 1;
      break;
    case "damage":
      slot.damageMarkers += 1;
      slot.card.health -= 1;
      break;
    case "energy":
      slot.energyMarkers += 1;
      break;
    case "barrier":
      slot.barrierMarkers += 1;
      break;
    case "stun":
      slot.stunMarkers += 1;
      slot.exhausted = true;
      break;
    default:
      return state;
  }

  if (slot.card.health <= 0) {
    // 死亡时恢复原始 attack/health
    slot.card.attack = slot.baseAttack;
    slot.card.health = slot.baseHealth;
    player.graveyard.push({ ...slot.card }); // 浅拷贝，防止槽位复用时墓地带走新卡的标记物数据
    player.shikigamiZone[slotIndex] = null;
  }
  return state;
}

export function removeShikigamiToken(
  state: MatchState,
  _actorId: PlayerId,
  targetPlayerId: PlayerId,
  slotIndex: number,
  tokenKind: ShikigamiTokenKind
): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const player = state.players[targetPlayerId];
  if (!player || slotIndex < 0 || slotIndex >= SHIKIGAMI_SLOTS) {
    return state;
  }
  const slot = player.shikigamiZone[slotIndex];
  if (!slot) {
    return state;
  }

  slot.attackModifier = slot.attackModifier ?? 0;
  slot.healthModifier = slot.healthModifier ?? 0;
  slot.damageMarkers = slot.damageMarkers ?? 0;
  slot.energyMarkers = slot.energyMarkers ?? 0;
  slot.barrierMarkers = slot.barrierMarkers ?? 0;
  slot.stunMarkers = slot.stunMarkers ?? 0;

  switch (tokenKind) {
    case "attack_plus":
      if (slot.attackModifier <= 0) {
        return state;
      }
      slot.attackModifier -= 1;
      break;
    case "attack_minus":
      if (slot.attackModifier >= 0) {
        return state;
      }
      slot.attackModifier += 1;
      break;
    case "health_plus":
      if (slot.healthModifier <= 0) {
        return state;
      }
      slot.healthModifier -= 1;
      slot.card.health -= 1;
      break;
    case "health_minus":
      if (slot.healthModifier >= 0) {
        return state;
      }
      slot.healthModifier += 1;
      slot.card.health += 1;
      break;
    case "damage":
      if (slot.damageMarkers <= 0) {
        return state;
      }
      slot.damageMarkers -= 1;
      slot.card.health += 1;
      break;
    case "energy":
      if (slot.energyMarkers <= 0) {
        return state;
      }
      slot.energyMarkers -= 1;
      break;
    case "barrier":
      if (slot.barrierMarkers <= 0) {
        return state;
      }
      slot.barrierMarkers -= 1;
      break;
    case "stun":
      if (slot.stunMarkers <= 0) {
        return state;
      }
      slot.stunMarkers -= 1;
      // 所有眩晕标记移除后，不再强制横置（如果回合开始已刷新过则保持刷新状态）
      break;
    default:
      return state;
  }
  return state;
}

/** 发往客户端前脱敏：调度阶段隐藏对手手牌；对手牌库/搜索/查看区不可见；符咒区按觉醒与翻转规则 */
export function sanitizeMatchStateForPlayer(state: MatchState, viewerId: PlayerId): MatchState {
  const stripSecrets: MatchState = { ...state, mulliganChoices: undefined };
  const players: Record<PlayerId, PlayerState> = {};

  for (const [pid, p] of Object.entries(state.players)) {
    if (pid === viewerId) {
      players[pid] = { ...p };
      continue;
    }

    let hidden: PlayerState = {
      ...p,
      deck: [],
      deckSearchBuffer: [],
      deckPeekBuffer: []
    };

    if (state.phase === "mulligan") {
      hidden = { ...hidden, hand: [], concealedHandCount: p.hand.length };
    }

    // 对手手牌：仅 revealedHandIds 中的卡牌保留完整数据，其余只保留 id（显示牌背）
    const revealedSet = new Set(p.revealedHandIds ?? []);
    if (state.phase !== "mulligan") {
      hidden = {
        ...hidden,
        hand: p.hand.map(c => revealedSet.has(c.id) ? c : { ...c, name: "", type: c.type, keyword: "", ability: "", img: "" })
      };
    }

    hidden = {
      ...hidden,
      spellZone: p.spellZone.map((e) => {
        if (e.card.type === "awaken" || e.revealedToOpponent) {
          return { ...e };
        }
        return { ...e, concealedForViewer: true };
      }),
      shikigamiZone: p.shikigamiZone.map((slot) => {
        if (!slot) return null;
        if (slot.stealth) {
          return { ...slot, card: { ...slot.card, name: "", keyword: "", ability: "", img: "" } };
        }
        return { ...slot };
      })
    };

    players[pid] = hidden;
  }

  return { ...stripSecrets, players };
}

export function adjustPlayerHp(state: MatchState, actorId: PlayerId, delta: number): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const player = state.players[actorId];
  if (!player || !Number.isFinite(delta) || delta === 0) {
    return state;
  }
  player.hp += delta;
  return state;
}

export function createMatchState(roomId: string, playerA: PlayerState, playerB: PlayerState): MatchState {
  return {
    roomId,
    phase: "mulligan",
    turn: 1,
    currentPlayerId: playerA.id,
    players: {
      [playerA.id]: playerA,
      [playerB.id]: playerB
    },
    mulliganSubmitted: {
      [playerA.id]: false,
      [playerB.id]: false
    },
    showcaseZone: []
  };
}

export function playCard(
  state: MatchState,
  actorId: PlayerId,
  cardId: string,
  targetPlayerId: PlayerId,
  zone: "shikigami" | "spell"
): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }

  const actor = state.players[actorId];
  const target = state.players[targetPlayerId];
  if (!actor || !target) {
    return state;
  }

  const cardIndex = actor.hand.findIndex((card) => card.id === cardId);
  if (cardIndex === -1) {
    return state;
  }

  const card = actor.hand[cardIndex];
  if (zone === "spell") {
    actor.hand.splice(cardIndex, 1);
    actor.spellZone.push(spellEntryFromCard(card));
    return state;
  }

  actor.hand.splice(cardIndex, 1);

  const openShikigamiSlot = actor.shikigamiZone.findIndex((slot) => slot == null);
  if (openShikigamiSlot === -1) {
    actor.graveyard.push({ ...card }); // 浅拷贝
  } else {
    actor.shikigamiZone[openShikigamiSlot] = newShikigamiEntry(card, card.ability?.includes("潜行") ?? false);
  }
  return state;
}

export function attack(
  state: MatchState,
  actorId: PlayerId,
  attackerCardId: string,
  targetPlayerId: PlayerId,
  target: "player" | "shikigami",
  targetCardId?: string
): MatchState {
  if (state.winnerId || state.phase !== "playing" || state.currentPlayerId !== actorId) {
    return state;
  }
  const actor = state.players[actorId];
  const targetPlayer = state.players[targetPlayerId];
  if (!actor || !targetPlayer || actor.id === targetPlayer.id) {
    return state;
  }

  const attackerSlotIndex = actor.shikigamiZone.findIndex((slot) => slot?.card.id === attackerCardId);
  if (attackerSlotIndex < 0) {
    return state;
  }
  const attackerSlot = actor.shikigamiZone[attackerSlotIndex];
  if (!attackerSlot || attackerSlot.exhausted) {
    return state;
  }

  const atkPower = effectiveAttack(attackerSlot);

  if (target === "player") {
    targetPlayer.hp -= atkPower;
    if (targetPlayer.hp <= 0) {
      state.winnerId = actor.id;
    }
    attackerSlot.exhausted = true;
    return state;
  }

  if (!targetCardId) {
    return state;
  }
  const defenderSlotIndex = targetPlayer.shikigamiZone.findIndex((slot) => slot?.card.id === targetCardId);
  if (defenderSlotIndex < 0) {
    return state;
  }
  const defenderSlot = targetPlayer.shikigamiZone[defenderSlotIndex];
  if (!defenderSlot) {
    return state;
  }

  const defPower = effectiveAttack(defenderSlot);

  attackerSlot.card.health -= defPower;
  defenderSlot.card.health -= atkPower;

  if (attackerSlot.card.health <= 0) {
    actor.graveyard.push({ ...attackerSlot.card }); // 浅拷贝
    actor.shikigamiZone[attackerSlotIndex] = null;
  } else {
    attackerSlot.exhausted = true;
  }
  if (defenderSlot.card.health <= 0) {
    targetPlayer.graveyard.push({ ...defenderSlot.card }); // 浅拷贝
    targetPlayer.shikigamiZone[defenderSlotIndex] = null;
  }

  return state;
}

export function toggleSpellExhaust(state: MatchState, actorId: PlayerId, cardId: string): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const actor = state.players[actorId];
  if (!actor) {
    return state;
  }

  const targetSpellCard = actor.spellZone.find((entry) => entry.card.id === cardId);
  if (!targetSpellCard) {
    // 尝试结界区
    if (actor.barrier && actor.barrier.id === cardId) {
      actor.barrierExhausted = !actor.barrierExhausted;
      return state;
    }
    // 尝试延伸区
    for (const slot of actor.extendZone) {
      const entry = slot.find((e) => e.card.id === cardId);
      if (entry) {
        entry.exhausted = !entry.exhausted;
        return state;
      }
    }
    return state;
  }

  targetSpellCard.exhausted = !targetSpellCard.exhausted;
  return state;
}

export function toggleShikigamiExhaust(state: MatchState, actorId: PlayerId, cardId: string): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const actor = state.players[actorId];
  if (!actor) {
    return state;
  }

  const targetShikigami = actor.shikigamiZone.find((entry) => entry?.card.id === cardId);
  if (!targetShikigami) {
    return state;
  }

  targetShikigami.exhausted = !targetShikigami.exhausted;
  return state;
}

export function toggleShikigamiStealth(state: MatchState, actorId: PlayerId, cardId: string, stealth: boolean): MatchState {
  if (state.winnerId || state.phase !== "playing") {
    return state;
  }
  const actor = state.players[actorId];
  if (!actor) {
    return state;
  }

  const targetShikigami = actor.shikigamiZone.find((entry) => entry?.card.id === cardId);
  if (!targetShikigami) {
    return state;
  }

  targetShikigami.stealth = stealth;
  return state;
}

export function endTurn(state: MatchState, actorId: PlayerId): MatchState {
  if (state.winnerId || state.phase !== "playing" || state.currentPlayerId !== actorId) {
    return state;
  }
  const nextPlayerId = Object.keys(state.players).find((id) => id !== actorId);
  if (!nextPlayerId) {
    return state;
  }

  state.currentPlayerId = nextPlayerId;
  state.turn += 1;

  applyTurnStart(state, nextPlayerId, actorId);
  return state;
}
