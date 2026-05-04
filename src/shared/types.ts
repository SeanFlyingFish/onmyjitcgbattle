import { z } from "zod";

export type PlayerId = string;
export type RoomId = string;

export type CardType = "shikigami" | "awaken" | "spell" | "attach" | "barrier" | "token";

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
  /** 别名：觉醒牌 alias 对应其所属式神名称（用于附着校验） */
  alias?: string;
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
  /** 别名：觉醒牌 alias 对应其所属式神名称 */
  alias?: string;
};

export type SpellZoneCard = {
  card: Card;
  faceUp: boolean;
  exhausted: boolean;
  /** 非觉醒牌：false 时对方仅见牌背；觉醒牌始终视为对对方可见正面 */
  revealedToOpponent: boolean;
  /** 仅脱敏给对手：为 true 时强制显示牌背 */
  concealedForViewer?: boolean;
  /** 自定义标记 { name: count } */
  customMarkers?: Record<string, number>;
};

/** 式神位上的指示物类型 */
export type ShikigamiTokenKind =
  | "attack_plus" | "attack_minus"
  | "health_plus" | "health_minus"
  | "damage"
  | "energy" | "barrier" | "stun"
  | "silence" | "poison" | "weaken"
  | "confusion";

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
  /** 沉默标记 */
  silenceMarkers: number;
  /** 毒伤标记 */
  poisonMarkers: number;
  /** 虚弱标记 */
  weakenMarkers: number;
  /** 混乱标记 */
  confusionMarkers: number;
  /** 潜行状态：true 时对手只能看到牌背 */
  stealth: boolean;
  /** 附在该式神下方的觉醒牌（alias 匹配） */
  awakenCards?: Card[];
  /** 自定义标记 { name: count } */
  customMarkers: Record<string, number>;
};

/** 延伸区卡牌条目 */
export type ExtendZoneCard = {
  card: Card;
  exhausted: boolean;
  /** 自定义标记 { name: count } */
  customMarkers?: Record<string, number>;
};

/** 结界区卡牌条目 */
export type BarrierZoneCard = {
  card: Card;
  exhausted: boolean;
  /** 能量标记 */
  energyMarkers: number;
  /** 自定义标记 { name: count } */
  customMarkers: Record<string, number>;
};

/** 自定义标记条目 */
export type CustomMarker = {
  name: string;
  count: number;
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
  barrier: BarrierZoneCard | null;
  barrierExhausted: boolean;
  spellCardsPlayedThisTurn: number;
  /** 搜索：从牌库顶取出暂放于此，可拖出到任意区域 */
  deckSearchBuffer: Card[];
  /** 查看：牌库顶 N 张的只读快照（牌仍在库中） */
  deckPeekBuffer: Card[];
  /** 手牌中已向对手公开的卡牌 ID 集合 */
  revealedHandIds: string[];
  /** 鬼火硬币数量（后手奖励） */
  ghostFireCoins: number;
  /** 鬼火数量（双方初始为0，手动调整） */
  fortuneFireCount: number;
  /** 毒伤标记数量（作用于玩家生命值） */
  poisonMarkers: number;
  /** 累计伤害记录 */
  playerDamage: number;
};

export type MatchPhase = "mulligan" | "playing";

export type MatchState = {
  roomId: RoomId;
  phase: MatchPhase;
  turn: number;
  currentPlayerId: PlayerId;
  players: Record<PlayerId, PlayerState>;
  winnerId?: PlayerId;
  /** 先手玩家 ID（对局开始时随机确定） */
  firstPlayerId: PlayerId;
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
        health: z.number().optional(),
        alias: z.string().optional()
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
    type: z.literal("attach_awaken"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 觉醒牌 ID（来自手牌或符咒区） */
      awakenCardId: z.string().min(1),
      /** 觉醒牌来源区域 */
      from: z.enum(["hand", "spell"]),
      /** 目标式神所属玩家 ID */
      targetPlayerId: z.string().min(1),
      /** 目标式神位索引 0-5 */
      slotIndex: z.number().int().min(0).max(5)
    })
  }),
  z.object({
    type: z.literal("detach_awaken"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 式神所属玩家 ID */
      targetPlayerId: z.string().min(1),
      /** 式神位索引 0-5 */
      slotIndex: z.number().int().min(0).max(5),
      /** 觉醒牌 ID */
      awakenCardId: z.string().min(1)
    })
  }),
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
    type: z.literal("deck_search_reorder"),
    payload: z.object({ roomId: z.string().min(1), orderedIds: z.array(z.string()) })
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
      tokenKind: z.enum(["attack_plus", "attack_minus", "health_plus", "health_minus", "damage", "energy", "barrier", "stun", "silence", "poison", "weaken", "confusion"])
    })
  }),
  z.object({
    type: z.literal("remove_shikigami_token"),
    payload: z.object({
      roomId: z.string().min(1),
      targetPlayerId: z.string().min(1),
      slotIndex: z.number().int().min(0).max(5),
      tokenKind: z.enum(["attack_plus", "attack_minus", "health_plus", "health_minus", "damage", "energy", "barrier", "stun", "silence", "poison", "weaken", "confusion"])
    })
  }),
  z.object({
    type: z.literal("adjust_player_hp"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 要调整的目标玩家ID，不传则默认为操作者自身 */
      targetPlayerId: z.string().min(1).optional(),
      /** 增加或减少的生命值（可为负） */
      delta: z.number().int()
    })
  }),
  z.object({
    type: z.literal("adjust_ghost_fire"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 增加（正）或减少（负）的鬼火硬币数量 */
      delta: z.number().int()
    })
  }),
  z.object({
    type: z.literal("adjust_fortune_fire"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 增加（正）或减少（负）的鬼火数量 */
      delta: z.number().int()
    })
  }),
  z.object({
    type: z.literal("adjust_player_poison"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 要调整的目标玩家ID，不传则默认为操作者自身 */
      targetPlayerId: z.string().min(1).optional(),
      /** 增加（正）或减少（负）的毒伤标记数量 */
      delta: z.number().int()
    })
  }),
  z.object({
    type: z.literal("adjust_player_damage"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 要调整的目标玩家ID，不传则默认为操作者自身 */
      targetPlayerId: z.string().min(1).optional(),
      /** 增加（正）或减少（负）的伤害记录 */
      delta: z.number().int()
    })
  }),
  z.object({
    type: z.literal("chat"),
    payload: z.object({
      roomId: z.string().min(1),
      message: z.string().min(1)
    })
  }),
  // 召唤物展示：从召唤物库选择一张卡牌置于展示区
  z.object({
    type: z.literal("place_token_to_showcase"),
    payload: z.object({
      roomId: z.string().min(1),
      tokenId: z.string().min(1),
      tokenName: z.string().min(1),
      tokenAttack: z.number(),
      tokenHealth: z.number(),
      tokenImg: z.string()
    })
  }),
  // 移除展示区的召唤物卡牌（直接删除）
  z.object({
    type: z.literal("remove_token_card"),
    payload: z.object({
      roomId: z.string().min(1),
      cardId: z.string().min(1)
    })
  }),
  // 结界区添加能量标记
  z.object({
    type: z.literal("place_barrier_token"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 目标结界所属玩家 ID */
      targetPlayerId: z.string().min(1),
      tokenKind: z.enum(["energy", "barrier", "stun", "silence", "poison", "weaken"])
    })
  }),
  // 结界区移除能量标记
  z.object({
    type: z.literal("remove_barrier_token"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 目标结界所属玩家 ID */
      targetPlayerId: z.string().min(1),
      tokenKind: z.enum(["energy", "barrier", "stun", "silence", "poison", "weaken"])
    })
  }),
  // 添加自定义标记到结界区
  z.object({
    type: z.literal("add_custom_marker"),
    payload: z.object({
      roomId: z.string().min(1),
      /** 目标结界所属玩家 ID */
      targetPlayerId: z.string().min(1),
      markerName: z.string().min(1),
      delta: z.number().int()
    })
  }),
  // 添加自定义标记到式神
  z.object({
    type: z.literal("add_custom_marker_to_shikigami"),
    payload: z.object({
      roomId: z.string().min(1),
      targetPlayerId: z.string().min(1),
      slotIndex: z.number().int().min(0).max(5),
      markerName: z.string().min(1),
      delta: z.number().int()
    })
  }),
  // 添加自定义标记到符咒区卡牌
  z.object({
    type: z.literal("add_custom_marker_to_spell"),
    payload: z.object({
      roomId: z.string().min(1),
      targetPlayerId: z.string().min(1),
      cardId: z.string().min(1),
      markerName: z.string().min(1),
      delta: z.number().int()
    })
  }),
  // 添加自定义标记到延伸区卡牌
  z.object({
    type: z.literal("add_custom_marker_to_extend"),
    payload: z.object({
      roomId: z.string().min(1),
      targetPlayerId: z.string().min(1),
      cardId: z.string().min(1),
      markerName: z.string().min(1),
      delta: z.number().int()
    })
  }),
  // 切换延伸区卡牌顺序（将最底层的卡置于顶层）
  z.object({
    type: z.literal("toggle_extend_card_order"),
    payload: z.object({
      roomId: z.string().min(1),
      targetPlayerId: z.string().min(1),
      slotIndex: z.number().int().min(0).max(5)
    })
  }),
  // 注册/登录
  z.object({ type: z.literal("register"), payload: z.object({ name: z.string().min(1), password: z.string().min(1) }) }),
  z.object({ type: z.literal("login"), payload: z.object({ name: z.string().min(1), password: z.string().min(1) }) }),
  // 管理员
  z.object({ type: z.literal("admin_auth"), payload: z.object({ password: z.string().min(1) }) }),
  z.object({ type: z.literal("admin_list_accounts"), payload: z.object({}) }),
  z.object({ type: z.literal("admin_delete_account"), payload: z.object({ name: z.string().min(1) }) }),
  z.object({ type: z.literal("admin_reset_password"), payload: z.object({ name: z.string().min(1), newPassword: z.string().min(1) }) }),
  // 断线重连（需同时验证 reconnectToken、playerId 和 playerName 匹配）
  z.object({
    type: z.literal("reconnect"),
    payload: z.object({ roomId: z.string().min(1), reconnectToken: z.string().min(1), playerId: z.string().min(1), playerName: z.string().min(1) })
  }),
  // 主动离开房间
  z.object({
    type: z.literal("leave_room"),
    payload: z.object({ roomId: z.string().min(1) })
  }),
  // 观战：房间已满时以观战者身份加入，可看到双方全部信息
  z.object({
    type: z.literal("spectate_room"),
    payload: z.object({
      roomId: z.string().min(1),
      name: z.string().min(1)
    })
  }),
  // 重开对局
  z.object({
    type: z.literal("rematch"),
    payload: z.object({ roomId: z.string().min(1) })
  }),
]);

export type ClientEvent = z.infer<typeof ClientEventSchema>;

export type ServerEvent =
  | { type: "room_created"; payload: { roomId: RoomId; playerId: PlayerId } }
  | { type: "room_joined"; payload: { roomId: RoomId; playerId: PlayerId; players: PlayerState[] } }
  | { type: "match_started"; payload: MatchState }
  | { type: "match_state"; payload: MatchState }
  | { type: "reconnect_success"; payload: { playerId: PlayerId; matchState?: MatchState } }
  | { type: "reconnect_failed"; payload: { message: string } }
  | { type: "player_disconnected"; payload: { playerId: PlayerId } }
  | { type: "player_reconnected"; payload: { playerId: PlayerId } }
  | { type: "left_room"; payload: { playerId: PlayerId } }
  | { type: "rematch_started"; payload: MatchState }
  | { type: "error"; payload: { message: string } }
  | { type: "chat"; payload: { playerId: PlayerId; playerName: string; message: string } }
  | { type: "register_success"; payload: { playerId: PlayerId; name: string } }
  | { type: "login_success"; payload: { playerId: PlayerId; name: string } }
  | { type: "auth_error"; payload: { message: string } }
  | { type: "admin_auth_success"; payload: {} }
  | { type: "admin_accounts_list"; payload: { accounts: { playerId: PlayerId; name: string }[] } }
  | { type: "admin_action_result"; payload: { success: boolean; message: string } };
