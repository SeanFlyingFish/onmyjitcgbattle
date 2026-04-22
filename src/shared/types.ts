import { z } from "zod";

export type PlayerId = string;
export type RoomId = string;

export type CardType = "shikigami" | "awaken" | "spell" | "attach" | "barrier";

export type Card = {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  attack: number;
  health: number;
  /** 可选扩展字段（组卡器导入时携带） */
  keyword?: string;
  ability?: string;
  img?: string;
};

/**
 * 组卡器卡片格式（直接对应 ALL_CARDS 中的条目）
 */
export type BuilderCard = {
  id: string;
  name: string;
  type: string; // "式神" | "觉醒" | "附灵" | "法术" | "结界"
  cost: string | number;
  keyword?: string;
  ability?: string;
  img?: string;
  /** 攻击值（仅式神） */
  attack?: number;
  /** 生命值（仅式神） */
  health?: number;
};

export type SpellZoneCard = {
  card: Card;
  faceUp: boolean;
  exhausted: boolean;
  /** 非觉醒牌：false 时对方仅见牌背；觉醒牌始终视为对对方可见正面 */
  revealedToOpponent: boolean;
  /** 仅脱敏给对手：为 true 时强制显示牌背 */
  concealedForViewer?: boolean;
};

/** 式神位上的指示物类型 */
export type ShikigamiTokenKind =
  | "attack_plus" | "attack_minus"
  | "health_plus" | "health_minus"
  | "damage"
  | "energy" | "barrier" | "stun";

export type ShikigamiZoneCard = {
  card: Card;
  exhausted: boolean;
  /** 攻击 ±1 指示物净值 */
  attackModifier: number;
  /** 生命 ±1 指示物净值（与 card.health 同步加减，便于显示层） */
  healthModifier: number;
  /** 伤害指示物枚数（每枚视为 1 点伤害，与 card.health 扣减同步） */
  damageMarkers: number;
  /** 原始攻击值（离开战场时恢复） */
  baseAttack: number;
  /** 原始生命值（离开战场时恢复） */
  baseHealth: number;
  /** 能量标记 */
  energyMarkers: number;
  /** 屏障标记 */
  barrierMarkers: number;
  /** 眩晕标记 */
  stunMarkers: number;
  /** 潜行状态：true 时对手只能看到牌背 */
  stealth: boolean;
};

/** 延伸区卡牌条目 */
export type ExtendZoneCard = {
  card: Card;
  exhausted: boolean;
};

export type PlayerState = {
  id: PlayerId;
  name: string;
  hp: number;
  deck: Card[];
  deckCount: number;
  maxHandSize: number;
  hand: Card[];
  /** 仅脱敏后的对手快照：调度阶段隐藏对方手牌时用牌背数量展示 */
  concealedHandCount?: number;
  graveyard: Card[];
  removedZone: Card[];
  spellZone: SpellZoneCard[];
  shikigamiZone: Array<ShikigamiZoneCard | null>;
  /** 延伸区：每个式神位（0-5）对应一个数组，存放附加在该式神上的卡牌 */
  extendZone: ExtendZoneCard[][];
  barrier: Card | null;
  barrierExhausted: boolean;
  spellCardsPlayedThisTurn: number;
  /** 搜索：从牌库顶取出暂放于此，可拖出到任意区域 */
  deckSearchBuffer: Card[];
  /** 查看：牌库顶 N 张的只读快照（牌仍在库中） */
  deckPeekBuffer: Card[];
  /** 手牌中已向对手公开的卡牌 ID 集合 */
  revealedHandIds: string[];
};

export type MatchPhase = "mulligan" | "playing";

export type MatchState = {
  roomId: RoomId;
  phase: MatchPhase;
  turn: number;
  currentPlayerId: PlayerId;
  players: Record<PlayerId, PlayerState>;
  winnerId?: PlayerId;
  /** 双方是否已提交调度（不同步公开具体卡牌） */
  mulliganSubmitted?: Record<PlayerId, boolean>;
  /** 服务端解析用，广播前会剥离 */
  mulliganChoices?: Record<PlayerId, string[]>;
  /** 展示区：双方共享的卡牌展示区域 */
  showcaseZone: Card[];
};

export const ClientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_room"), payload: z.object({ name: z.string().min(1) }) }),
  z.object({
    type: z.literal("join_room"),
    payload: z.object({ roomId: z.string().min(1), name: z.string().min(1) })
  }),
  z.object({
    type: z.literal("update_deck"),
    payload: z.object({
      /** 玩家选择的牌库 */
      deck: z.array(z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        cost: z.union([z.string(), z.number()]),
        keyword: z.string().optional(),
        ability: z.string().optional(),
        img: z.string().optional(),
        attack: z.number().optional(),
        health: z.number().optional()
      }))
    })
  }),
  z.object({
    type: z.literal("start_match"),
    payload: z.object({ roomId: z.string().min(1) })
  }),
  z.object({
    type: z.literal("submit_mulligan"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 要暂置并洗回牌库的手牌 id；可空数组表示不换牌 */
      cardIds: z.array(z.string().min(1))
    })
  }),
  z.object({
    type: z.literal("play_card"),
    payload: z.object({
      roomId: z.string().min(1),
      cardId: z.string().min(1),
      targetPlayerId: z.string().min(1),
      zone: z.enum(["shikigami", "spell"])
    })
  }),
  z.object({
    type: z.literal("toggle_spell_exhaust"),
    payload: z.object({ roomId: z.string().min(1), cardId: z.string().min(1) })
  }),
  z.object({
    type: z.literal("toggle_shikigami_exhaust"),
    payload: z.object({ roomId: z.string().min(1), cardId: z.string().min(1) })
  }),
  z.object({
    type: z.literal("toggle_shikigami_stealth"),
    payload: z.object({ roomId: z.string().min(1), cardId: z.string().min(1), stealth: z.boolean() })
  }),
  z.object({
    type: z.literal("attack"),
    payload: z.object({
      roomId: z.string().min(1),
      attackerCardId: z.string().min(1),
      targetPlayerId: z.string().min(1),
      target: z.enum(["player", "shikigami"]),
      targetCardId: z.string().optional()
    })
  }),
  z.object({ type: z.literal("end_turn"), payload: z.object({ roomId: z.string().min(1) }) }),
  z.object({
    type: z.literal("move_card"),
    payload: z.object({
      roomId: z.string().min(1),
      cardId: z.string().min(1),
      from: z.enum(["hand", "graveyard", "spell", "shikigami", "barrier", "deck_top", "deck_search", "removed_zone", "extend", "showcase"]),
      to: z.enum(["hand", "graveyard", "spell", "shikigami", "barrier", "deck_top", "deck_bottom", "removed_zone", "extend", "showcase"]),
      /** 放入己方式神区时的座位 0–5，省略则找第一个空位 */
      toShikigamiSlot: z.number().int().min(0).max(5).optional()
    })
  }),
  z.object({
    type: z.literal("toggle_spell_reveal"),
    payload: z.object({ roomId: z.string().min(1), cardId: z.string().min(1) })
  }),
  z.object({
    type: z.literal("toggle_hand_reveal"),
    payload: z.object({ roomId: z.string().min(1), cardId: z.string().min(1), reveal: z.boolean() })
  }),
  z.object({
    type: z.literal("deck_draw"),
    payload: z.object({ roomId: z.string().min(1), count: z.number().int().min(1).max(10).optional() })
  }),
  z.object({ type: z.literal("deck_shuffle"), payload: z.object({ roomId: z.string().min(1) }) }),
  z.object({
    type: z.literal("deck_search"),
    payload: z.object({ roomId: z.string().min(1), count: z.number().int().min(1).max(60) })
  }),
  z.object({
    type: z.literal("deck_search_return"),
    payload: z.object({ roomId: z.string().min(1) })
  }),
  z.object({
    type: z.literal("deck_peek"),
    payload: z.object({ roomId: z.string().min(1), count: z.number().int().min(1).max(60) })
  }),
  z.object({
    type: z.literal("place_shikigami_token"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 式神所属玩家（可为己方或对方） */
      targetPlayerId: z.string().min(1),
      slotIndex: z.number().int().min(0).max(5),
      tokenKind: z.enum(["attack_plus", "attack_minus", "health_plus", "health_minus", "damage", "energy", "barrier", "stun"])
    })
  }),
  z.object({
    type: z.literal("remove_shikigami_token"),
    payload: z.object({
      roomId: z.string().min(1),
      targetPlayerId: z.string().min(1),
      slotIndex: z.number().int().min(0).max(5),
      tokenKind: z.enum(["attack_plus", "attack_minus", "health_plus", "health_minus", "damage", "energy", "barrier", "stun"])
    })
  }),
  z.object({
    type: z.literal("adjust_player_hp"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 增加或减少的生命值（可为负） */
      delta: z.number().int()
    })
  }),
  z.object({
    type: z.literal("chat"),
    payload: z.object({
      roomId: z.string().min(1),
      message: z.string().min(1)
    })
  })
]);

export type ClientEvent = z.infer<typeof ClientEventSchema>;

export type ServerEvent =
  | { type: "room_created"; payload: { roomId: RoomId; playerId: PlayerId } }
  | { type: "room_joined"; payload: { roomId: RoomId; playerId: PlayerId; players: PlayerState[] } }
  | { type: "match_started"; payload: MatchState }
  | { type: "match_state"; payload: MatchState }
  | { type: "error"; payload: { message: string } }
  | { type: "chat"; payload: { playerId: PlayerId; playerName: string; message: string } };
