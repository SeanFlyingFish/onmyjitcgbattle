import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, MouseEvent } from "react";
import "./App.css";
import { CARD_DATABASE } from "./cards-database";
import type { BuilderCard } from "./types";

type CardType = "shikigami" | "awaken" | "spell" | "attach" | "barrier";
type Card = { id: string; name: string; type: CardType; cost: number; attack: number; health: number; keyword?: string; ability?: string; img?: string };

type SpellZoneCard = {
  card: Card;
  faceUp: boolean;
  exhausted: boolean;
  revealedToOpponent?: boolean;
  concealedForViewer?: boolean;
};
type ShikigamiTokenKind = "attack_plus" | "attack_minus" | "health_plus" | "health_minus" | "damage" | "energy" | "barrier" | "stun";

type ShikigamiZoneCard = {
  card: Card;
  exhausted: boolean;
  attackModifier: number;
  healthModifier: number;
  damageMarkers: number;
  /** 原始攻击值 */
  baseAttack: number;
  /** 原始生命值 */
  baseHealth: number;
  /** 能量标记 */
  energyMarkers: number;
  /** 屏障标记 */
  barrierMarkers: number;
  /** 眩晕标记 */
  stunMarkers: number;
  /** 潜行状态 */
  stealth: boolean;
};

type PlayerState = {
  id: string;
  name: string;
  hp: number;
  deck: Card[];
  deckCount: number;
  maxHandSize: number;
  hand: Card[];
  concealedHandCount?: number;
  graveyard: Card[];
  removedZone: Card[];
  spellZone: SpellZoneCard[];
  shikigamiZone: Array<ShikigamiZoneCard | null>;
  barrier: Card | null;
  barrierExhausted?: boolean;
  spellCardsPlayedThisTurn: number;
  deckSearchBuffer: Card[];
  deckPeekBuffer: Card[];
  revealedHandIds?: string[];
};

type MatchState = {
  roomId: string;
  phase: "mulligan" | "playing";
  turn: number;
  currentPlayerId: string;
  players: Record<string, PlayerState>;
  winnerId?: string;
  mulliganSubmitted?: Record<string, boolean>;
};

type ServerEvent =
  | { type: "room_created"; payload: { roomId: string; playerId: string } }
  | { type: "room_joined"; payload: { roomId: string; playerId: string; players: PlayerState[] } }
  | { type: "match_started"; payload: MatchState }
  | { type: "match_state"; payload: MatchState }
  | { type: "error"; payload: { message: string } }
  | { type: "chat"; payload: { playerId: string; playerName: string; message: string } };

const CARD_IMAGE_URL = "https://fishcrashers.oss-cn-chengdu.aliyuncs.com/YYSTCG/CARD/A_1.webp";
const CARD_BACK_IMAGE_URL =
  "https://steamusercontent-a.akamaihd.net/ugc/17093582484054773031/E6608BC51B78683BDB6B593B86DEF83528E59434/";

type DragFrom =
  | "hand"
  | "graveyard"
  | "spell"
  | "shikigami"
  | "barrier"
  | "extend"
  | "deck_top"
  | "deck_search"
  | "removed_zone";

type DragTo = "hand" | "graveyard" | "spell" | "shikigami" | "barrier" | "extend" | "deck_top" | "deck_bottom" | "removed_zone" | "showcase";

type BoardDragPayload =
  | { kind: "card"; cardId: string; from: DragFrom; cardType?: string }
  | { kind: "token"; tokenKind: ShikigamiTokenKind };

const TOKEN_STRIP: { kind: ShikigamiTokenKind; label: string; hint: string }[] = [
  { kind: "attack_plus", label: "+攻", hint: "攻击 +1" },
  { kind: "attack_minus", label: "-攻", hint: "攻击 -1" },
  { kind: "health_plus", label: "+命", hint: "生命 +1" },
  { kind: "health_minus", label: "-命", hint: "生命 -1" },
  { kind: "damage", label: "伤", hint: "伤害 1（生命 -1）" }
];

function setDragPayload(e: DragEvent, cardId: string, from: DragFrom, cardType?: string) {
  e.dataTransfer.setData("application/json", JSON.stringify({ cardId, from, cardType }));
  e.dataTransfer.effectAllowed = "move";
}

function setTokenDragPayload(e: DragEvent, tokenKind: ShikigamiTokenKind) {
  e.dataTransfer.setData("application/json", JSON.stringify({ dragType: "token", tokenKind }));
  e.dataTransfer.effectAllowed = "copy";
}

function readBoardDragPayload(e: DragEvent): BoardDragPayload | null {
  const raw = e.dataTransfer.getData("application/json");
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o.dragType === "token" && typeof o.tokenKind === "string") {
      return { kind: "token", tokenKind: o.tokenKind as ShikigamiTokenKind };
    }
    if (typeof o.cardId === "string" && typeof o.from === "string") {
      return { kind: "card", cardId: o.cardId, from: o.from as DragFrom, cardType: typeof o.cardType === "string" ? o.cardType : undefined };
    }
    return null;
  } catch {
    return null;
  }
}

function effectiveAttackValue(slot: ShikigamiZoneCard): number {
  const baseAtk = slot.card.attack ?? 0;
  return Math.max(0, baseAtk + (slot.attackModifier ?? 0));
}

function TokenDiscStack({ count, variant }: { count: number; variant: "atk-pos" | "atk-neg" | "hp-pos" | "hp-neg" | "dmg" }) {
  const n = Math.min(count, 8);
  return (
    <span className={`token-disc-stack token-disc-stack--${variant}`} aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className="token-disc-layer" />
      ))}
      {count > 8 ? <span className="token-disc-more">+{count - 8}</span> : null}
    </span>
  );
}

function ShikigamiCardFace({
  slot,
  interactive,
  allowBoardDrag,
  isHidden,
  onRevealStealth,
  onCardDragStart,
  onHoverEnter,
  onHoverLeave,
}: {
  slot: ShikigamiZoneCard;
  interactive: boolean;
  allowBoardDrag: boolean;
  /** 对手视角：stealth 式神显示牌背 */
  isHidden?: boolean;
  /** 解除潜行按钮回调 */
  onRevealStealth?: () => void;
  onCardDragStart: (e: DragEvent<HTMLImageElement>) => void;
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
}) {
  const atk = effectiveAttackValue(slot);
  const hp = slot.card.health ?? 0;
  const energy = slot.energyMarkers ?? 0;
  const stealthed = slot.stealth;
  const showBack = isHidden && stealthed;

  return (
    <div
      className={`unit-card ${showBack ? "unit-card-back" : "unit-card-face"} ${stealthed ? "unit-card--stealth" : ""}`}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      <div className="unit-art-wrap">
        {/* 潜行标记 - 右上角 */}
        {stealthed && !showBack && (
          <div className="stealth-badge" title="潜行中">👤</div>
        )}
        {/* 能量标记 - 左上角 */}
        {energy > 0 && (
          <div className="energy-badge" title={`能量 ×${energy}`}>
            <span className="energy-icon">⚡</span>
            <span className="energy-count">{energy}</span>
          </div>
        )}
        {/* 眩晕标记 - 左上角能量旁边 */}
        {(slot.stunMarkers ?? 0) > 0 && (
          <div className="stun-badge" title={`眩晕 ×${slot.stunMarkers}`}>
            <span className="stun-icon">💫</span>
          </div>
        )}
        <img
          className="unit-art"
          src={showBack ? CARD_BACK_IMAGE_URL : (slot.card.img || CARD_IMAGE_URL)}
          alt={showBack ? "????" : slot.card.name}
          draggable={interactive && allowBoardDrag}
          onDragStart={onCardDragStart}
        />
        {!showBack && (
          <div className="unit-stat-badge" title="当前攻击 / 当前生命">
            {atk}/{hp}
          </div>
        )}
        {/* 解除潜行按钮 */}
        {stealthed && !showBack && onRevealStealth && (
          <button
            type="button"
            className="stealth-reveal-btn"
            onClick={(e) => { e.stopPropagation(); onRevealStealth(); }}
            title="解除潜行状态"
          >
            解除潜行
          </button>
        )}
      </div>
    </div>
  );
}

function ShikigamiTokenBelt({
  slot,
  interactive,
  onRemoveToken
}: {
  slot: ShikigamiZoneCard;
  interactive: boolean;
  onRemoveToken?: (kind: ShikigamiTokenKind) => void;
}) {
  const am = slot.attackModifier ?? 0;
  const hm = slot.healthModifier ?? 0;
  const dm = slot.damageMarkers ?? 0;
  const barrier = slot.barrierMarkers ?? 0;
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div className="unit-token-belt">
      {/* 屏障标记 - 圆形图标横向排列 */}
      {barrier > 0 ? (
        <div className="unit-token-row">
          <span className="token-circle token-barrier" title={`屏障 ×${barrier}`}>
            <span className="token-circle-inner">🛡</span>
            {barrier > 1 ? <span className="token-circle-count">{barrier}</span> : null}
          </span>
          <span className="unit-token-caption">屏障</span>
          {interactive ? (
            <button type="button" className="token-micro-remove" onClick={(e) => { stop(e); onRemoveToken?.("barrier"); }} aria-label="移除屏障">-</button>
          ) : null}
        </div>
      ) : null}
      {/* 攻击修正 */}
      {am !== 0 ? (
        <div className="unit-token-row">
          <TokenDiscStack count={Math.abs(am)} variant={am > 0 ? "atk-pos" : "atk-neg"} />
          <span className="unit-token-caption">{am > 0 ? `+攻×${am}` : `-攻×${-am}`}</span>
          {interactive && am > 0 ? (
            <button type="button" className="token-micro-remove" onClick={(e) => { stop(e); onRemoveToken?.("attack_plus"); }} aria-label="移除一枚 +攻">-</button>
          ) : null}
          {interactive && am < 0 ? (
            <button type="button" className="token-micro-remove" onClick={(e) => { stop(e); onRemoveToken?.("attack_minus"); }} aria-label="移除一枚 -攻">-</button>
          ) : null}
        </div>
      ) : null}
      {/* 生命修正 */}
      {hm !== 0 ? (
        <div className="unit-token-row">
          <TokenDiscStack count={Math.abs(hm)} variant={hm > 0 ? "hp-pos" : "hp-neg"} />
          <span className="unit-token-caption">{hm > 0 ? `+命×${hm}` : `-命×${-hm}`}</span>
          {interactive && hm > 0 ? (
            <button type="button" className="token-micro-remove" onClick={(e) => { stop(e); onRemoveToken?.("health_plus"); }} aria-label="移除一枚 +命">-</button>
          ) : null}
          {interactive && hm < 0 ? (
            <button type="button" className="token-micro-remove" onClick={(e) => { stop(e); onRemoveToken?.("health_minus"); }} aria-label="移除一枚 -命">-</button>
          ) : null}
        </div>
      ) : null}
      {/* 伤害标记 */}
      {dm > 0 ? (
        <div className="unit-token-row">
          <TokenDiscStack count={dm} variant="dmg" />
          <span className="unit-token-caption">伤×{dm}</span>
          {interactive ? (
            <button type="button" className="token-micro-remove" onClick={(e) => { stop(e); onRemoveToken?.("damage"); }} aria-label="移除一枚伤害">-</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const [serverUrl, setServerUrl] = useState("ws://localhost:8080");
  const [name, setName] = useState("玩家");
  const [roomIdInput, setRoomIdInput] = useState("");
  /** 组卡器选择的当前牌库（BuilderCard 格式），由组卡器通过 BroadcastChannel 同步 */
  const [builderDeck, setBuilderDeck] = useState<BuilderCard[] | null>(null);

  /** 符咒区卡牌排版计算 */
  const SPELL_CARD_W = 96;
  const SPELL_AREA_WIDTH = 512; // spell-area 宽度 calc(110px * 4 + 24px * 3)
  const SPELL_AREA_PADDING = 10;
  const getSpellCardPosition = (index: number, total: number) => {
    const containerW = SPELL_AREA_WIDTH - SPELL_AREA_PADDING * 2;
    const totalWidth = total * SPELL_CARD_W;
    let left: number;
    if (totalWidth <= containerW) {
      // 居中分布
      const startX = (containerW - totalWidth) / 2;
      left = SPELL_AREA_PADDING + startX + index * SPELL_CARD_W;
    } else {
      // 两端对齐
      left = SPELL_AREA_PADDING + (containerW - SPELL_CARD_W) * index / (total - 1);
    }
    return {
      left,
      top: '50%',
      transform: 'translateY(-50%)',
      zIndex: 10 + index,
    };
  };

  /** 处理牌库更新：更新本地状态并发送到服务器 */
  function handleDeckUpdate(deck: BuilderCard[]) {
    setBuilderDeck(deck);
    // 如果已加入房间，立即发送 update_deck 到服务器
    if (roomId && playerId) {
      send({ type: "update_deck", payload: { deck } });
      console.log('[游戏] 发送 update_deck 到服务器:', deck.length, '张');
    }
  }

  // 监听组卡器发送的牌库选择消息
  useEffect(() => {
    // BroadcastChannel 方式（适用于同协议情况）
    const channel = new BroadcastChannel("yys-tcg-deck-channel");
    channel.onmessage = (e: MessageEvent) => {
      if (e.data?.type === "DECK_SELECTED" && Array.isArray(e.data.deck)) {
        console.log('[游戏] 通过 BroadcastChannel 收到牌库:', e.data.deck.length, '张');
        handleDeckUpdate(e.data.deck);
      }
    };

    // localStorage 轮询方式（作为备用，确保跨协议也能工作）
    const STORAGE_KEY = "yys-tcg-selected-deck";
    const readLocalStorage = () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const deck = JSON.parse(saved);
          if (Array.isArray(deck) && deck.length > 0) {
            console.log('[游戏] 通过 localStorage 读取到牌库:', deck.length, '张');
            handleDeckUpdate(deck);
          }
        }
      } catch (e) {
        console.error('[游戏] 读取 localStorage 失败:', e);
      }
    };

    // 初始读取
    readLocalStorage();

    // 监听 localStorage 变化（跨标签页通知）
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        console.log('[游戏] 检测到 localStorage 变化');
        readLocalStorage();
      }
    });

    return () => channel.close();
  }, []);
  const [roomId, setRoomId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);

  // send 函数使用 useCallback 确保能访问最新的 socket
  const send = useCallback((payload: unknown) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.log('[游戏] 未连接或未就绪，无法发送:', (payload as any).type);
      return false;
    }
    socket.send(JSON.stringify(payload));
    console.log('[游戏] 发送成功:', (payload as any).type);
    return true;
  }, [socket]);

  // 当加入房间后，如果已有牌库（加入房间前导入的），立即发送到服务器
  useEffect(() => {
    if (roomId && playerId && builderDeck && builderDeck.length > 0) {
      send({ type: "update_deck", payload: { deck: builderDeck } });
      console.log('[游戏] 加入房间后自动发送已存储的牌库:', builderDeck.length, '张');
    }
  }, [roomId, playerId, builderDeck, send]);

  // WebSocket 消息处理
  useEffect(() => {
    if (!socket) return;
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerEvent;
      if (msg.type === "room_created") {
        setRoomId(msg.payload.roomId);
        setPlayerId((prev) => prev || msg.payload.playerId);
        appendLog(`🏠 房间已创建：${msg.payload.roomId}`);
      } else if (msg.type === "room_joined") {
        setRoomId(msg.payload.roomId);
        setPlayerId((prev) => prev || msg.payload.playerId);
        appendLog(`🚪 已加入房间：${msg.payload.roomId}`);
      } else if (msg.type === "match_started" || msg.type === "match_state") {
        setMatchState(msg.payload);
        if (msg.type === "match_started") appendLog("🎮 对局开始！");
      } else if (msg.type === "error") {
        appendLog(`❌ 错误：${msg.payload.message}`);
      } else if (msg.type === "chat") {
        if (msg.payload.playerId === "system") {
          appendLog(`📢 ${msg.payload.message}`);
        } else {
          appendLog(`💬 ${msg.payload.playerName}：${msg.payload.message}`);
        }
      } else {
        appendLog(`📨 事件：${(msg as { type: string }).type}`);
      }
    };
    setSocket(socket);
  }, [socket]);

  const [hoveredHandCardId, setHoveredHandCardId] = useState<string | null>(null);
  /** 通用卡牌悬停状态（用于棋盘上所有区域的卡牌） */
  const [hoveredBoardCardId, setHoveredBoardCardId] = useState<string | null>(null);
  const [hoveredBoardCardData, setHoveredBoardCardData] = useState<Card | null>(null);
  const [mulliganSelectedIds, setMulliganSelectedIds] = useState<Set<string>>(new Set());
  const [spellFlipMode, setSpellFlipMode] = useState(false);
  /** 潜行模式：点击后选择式神进入潜行 */
  const [stealthMode, setStealthMode] = useState(false);
  /** 手牌公开状态（记录对对手公开的手牌 id 集合，本地展示用） */
  const [handRevealedIds, setHandRevealedIds] = useState<Set<string>>(new Set());
  const [deckSearchModalOpen, setDeckSearchModalOpen] = useState(false);
  const [deckPeekModalOpen, setDeckPeekModalOpen] = useState(false);
  const [deckModalQuery, setDeckModalQuery] = useState("");
  const [deckSearchTakeCount, setDeckSearchTakeCount] = useState(5);
  const [deckPeekCount, setDeckPeekCount] = useState(5);
  const [hpAdjustInput, setHpAdjustInput] = useState("1");
  // 牌库查看弹窗
  const [deckViewModalOpen, setDeckViewModalOpen] = useState(false);
  const [deckViewInput, setDeckViewInput] = useState("");
  const [deckViewConfirmed, setDeckViewConfirmed] = useState(false);
  /** 查看弹窗中已选择的卡牌 ID（按选择顺序排列） */
  const [deckViewSelectedIds, setDeckViewSelectedIds] = useState<string[]>([]);
  /** 关闭查看弹窗：若已确认查看则将 buffer 牌放回牌库顶（不洗） */
  function closeDeckView() {
    if (deckViewConfirmed) {
      send({ type: "deck_search_return", payload: { roomId } });
    }
    setDeckViewModalOpen(false);
    setDeckViewConfirmed(false);
    setDeckViewSelectedIds([]);
  }
  /** 置入牌库模式：选中后再次点击弹出确认 */
  const [deckPlaceMode, setDeckPlaceMode] = useState(false);
  /** 置入牌库已选卡牌列表（cardId + 来源区域） */
  const [deckPlaceSelected, setDeckPlaceSelected] = useState<Array<{ cardId: string; from: DragFrom }>>([]);
  /** 置入牌库确认弹窗 */
  const [deckPlaceConfirmOpen, setDeckPlaceConfirmOpen] = useState(false);
  // 大厅面板折叠状态（对局开始后默认折叠）
  const [lobbyCollapsed, setLobbyCollapsed] = useState(false);
  const [logsCollapsed, setLogsCollapsed] = useState(false);
  /** 卡组导入弹窗是否打开 */
  const [importModalOpen, setImportModalOpen] = useState(false);
  /** 墓地弹窗（true=己方墓地，false=敌方墓地） */
  const [graveyardModalOpen, setGraveyardModalOpen] = useState(false);
  const [graveyardModalView, setGraveyardModalView] = useState<"self" | "enemy">("self");
  /** 墓地弹窗中选中的卡牌 ID（用于移至展示区） */
  const [graveyardSelectedIds, setGraveyardSelectedIds] = useState<Set<string>>(new Set());
  /** 移除区弹窗（true=己方移除区，false=敌方移除区） */
  const [removedModalOpen, setRemovedModalOpen] = useState(false);
  const [removedModalView, setRemovedModalView] = useState<"self" | "enemy">("self");
  const [importDeckCode, setImportDeckCode] = useState("");

  const self = useMemo(() => {
    if (!matchState || !playerId) return null;
    return matchState.players[playerId] ?? null;
  }, [matchState, playerId]);

  const enemy = useMemo(() => {
    if (!matchState || !playerId) return null;
    const targetId = Object.keys(matchState.players).find((id) => id !== playerId);
    return targetId ? matchState.players[targetId] : null;
  }, [matchState, playerId]);

  const phase = matchState?.phase ?? "playing";
  const isMulligan = phase === "mulligan";
  const isMyTurn = Boolean(matchState && playerId && matchState.currentPlayerId === playerId);
  const iSubmittedMulligan = Boolean(playerId && matchState?.mulliganSubmitted?.[playerId]);

  // 对局开始时自动折叠大厅
  useEffect(() => {
    if (matchState) {
      setLobbyCollapsed(true);
    }
  }, [Boolean(matchState)]);

  useEffect(() => {
    if (phase === "playing") {
      setMulliganSelectedIds(new Set());
    }
  }, [phase]);

  function normalizeShikigamiSlot(entry: ShikigamiZoneCard | null): ShikigamiZoneCard | null {
    if (entry == null) return null;
    return {
      ...entry,
      attackModifier: entry.attackModifier ?? 0,
      healthModifier: entry.healthModifier ?? 0,
      damageMarkers: entry.damageMarkers ?? 0,
      energyMarkers: entry.energyMarkers ?? 0,
      barrierMarkers: entry.barrierMarkers ?? 0,
      stunMarkers: entry.stunMarkers ?? 0
    };
  }

  function withDefaultZones(player: PlayerState | null): PlayerState | null {
    if (!player) return null;
    const rawZone = player.shikigamiZone ?? Array.from({ length: 6 }, () => null);
    return {
      ...player,
      hp: player.hp ?? 30,
      deck: player.deck ?? [],
      maxHandSize: player.maxHandSize ?? 12,
      graveyard: player.graveyard ?? [],
      removedZone: player.removedZone ?? [],
      spellZone: player.spellZone ?? [],
      shikigamiZone: rawZone.map((s) => normalizeShikigamiSlot(s)),
      barrier: player.barrier ?? null,
      spellCardsPlayedThisTurn: player.spellCardsPlayedThisTurn ?? 0,
      deckSearchBuffer: player.deckSearchBuffer ?? [],
      deckPeekBuffer: player.deckPeekBuffer ?? []
    };
  }

  const selfView = withDefaultZones(self);
  const enemyView = withDefaultZones(enemy);

  const gameOver = Boolean(matchState?.winnerId);
  const allowBoardDrag = !isMulligan && phase === "playing" && !gameOver;

  function appendLog(message: string) {
    setLogs((prev) => [message, ...prev].slice(0, 30));
  }

  function connect(onOpen?: (ws: WebSocket) => void) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      appendLog("✅ 已连接");
      if (onOpen) onOpen(socket);
      return;
    }
    const ws = new WebSocket(serverUrl);
    ws.onopen = () => {
      appendLog(`✅ 已连接至 ${serverUrl}`);
      if (onOpen) onOpen(ws);
    };
    ws.onclose = () => appendLog("🔌 连接已断开");
    ws.onerror = () => appendLog("❌ 连接异常");
    // onmessage 由 useEffect 处理
    setSocket(ws);
  }

  function quickCreateRoom() {
    const payload = { type: "create_room", payload: { name } };
    if (socket && socket.readyState === WebSocket.OPEN) {
      send(payload);
      return;
    }
    connect((ws) => ws.send(JSON.stringify(payload)));
  }

  function canPlayToShikigami(_: Card): boolean {
    return Boolean(!gameOver && !isMulligan && selfView);
  }

  function playCardToZone(cardId: string, zone: "shikigami" | "spell") {
    if (!playerId) return;
    send({ type: "play_card", payload: { roomId, cardId, targetPlayerId: playerId, zone } });
  }

  function toggleSpellExhaust(cardId: string) {
    send({ type: "toggle_spell_exhaust", payload: { roomId, cardId } });
  }

  /** 公开/取消公开己方符咒区的卡牌给对手看 */
  function revealSpellCard(cardId: string) {
    send({ type: "toggle_spell_reveal", payload: { roomId, cardId } });
  }

  /** 公开/取消公开己方手牌给对手看（本地状态 + 通知服务端） */
  function revealHandCard(cardId: string) {
    const wasRevealed = handRevealedIds.has(cardId);
    setHandRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
    // 通知服务端，让对手也能看到展示状态
    send({ type: "toggle_hand_reveal", payload: { roomId, cardId, reveal: !wasRevealed } });
  }

  function toggleShikigamiExhaust(cardId: string) {
    send({ type: "toggle_shikigami_exhaust", payload: { roomId, cardId } });
  }

  function toggleShikigamiStealth(cardId: string, stealth: boolean) {
    send({ type: "toggle_shikigami_stealth", payload: { roomId, cardId, stealth } });
  }

  function toggleMulliganPick(cardId: string) {
    setMulliganSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function submitMulligan() {
    send({
      type: "submit_mulligan",
      payload: { roomId, cardIds: Array.from(mulliganSelectedIds) }
    });
  }

  function moveCardPayload(cardId: string, from: DragFrom, to: DragTo, toShikigamiSlot?: number) {
    send({ type: "move_card", payload: { roomId, cardId, from, to, toShikigamiSlot } });
  }

  /** 置入牌库模式：切换选中一张牌 */
  function toggleDeckPlaceCard(cardId: string, from: DragFrom) {
    setDeckPlaceSelected((prev) => {
      const idx = prev.findIndex((e) => e.cardId === cardId);
      if (idx !== -1) return prev.filter((_, i) => i !== idx);
      return [...prev, { cardId, from }];
    });
  }

  /** 置入牌库操作：批量移动卡牌 */
  function executeDeckPlace(action: "top" | "bottom" | "shuffle") {
    const selected = [...deckPlaceSelected];
    setDeckPlaceSelected([]);
    setDeckPlaceMode(false);
    setDeckPlaceConfirmOpen(false);
    if (action === "top") {
      // 倒序发送使第一张选中的在最顶
      [...selected].reverse().forEach(({ cardId, from }) => moveCardPayload(cardId, from, "deck_top"));
    } else if (action === "bottom") {
      selected.forEach(({ cardId, from }) => moveCardPayload(cardId, from, "deck_bottom"));
    } else {
      // 洗入：全部移到牌库底后洗牌
      selected.forEach(({ cardId, from }) => moveCardPayload(cardId, from, "deck_bottom"));
      send({ type: "deck_shuffle", payload: { roomId } });
    }
  }

  function placeTokenOnShikigami(targetPlayerId: string, slotIndex: number, tokenKind: ShikigamiTokenKind) {
    send({ type: "place_shikigami_token", payload: { roomId, targetPlayerId, slotIndex, tokenKind } });
  }

  function removeTokenFromShikigami(targetPlayerId: string, slotIndex: number, tokenKind: ShikigamiTokenKind) {
    send({ type: "remove_shikigami_token", payload: { roomId, targetPlayerId, slotIndex, tokenKind } });
  }

  function adjustSelfHpByDelta(delta: number) {
    send({ type: "adjust_player_hp", payload: { roomId, delta } });
  }

  function onDropToZone(e: DragEvent, to: DragTo, toShikigamiSlot?: number, tokenTargetPlayerId?: string) {
    e.preventDefault();
    if (!allowBoardDrag || !roomId) return;
    const p = readBoardDragPayload(e);
    if (!p) return;

    if (p.kind === "token") {
      if (to !== "shikigami" || toShikigamiSlot === undefined || !tokenTargetPlayerId) return;
      placeTokenOnShikigami(tokenTargetPlayerId, toShikigamiSlot, p.tokenKind);
      return;
    }
    moveCardPayload(p.cardId, p.from, to, toShikigamiSlot);
  }

  /** 根据卡牌 ID 查找卡牌（在手牌、牌库、墓地等区域中） */
  function findCardById(cardId: string): Card | null {
    // 先从手牌找
    const inHand = selfView?.hand.find(c => c.id === cardId);
    if (inHand) return inHand;
    // 从己方墓地找
    const inGraveyard = selfView?.graveyard.find(c => c.id === cardId);
    if (inGraveyard) return inGraveyard;
    // 从展示区找（共享区域）
    const inShowcase = matchState?.showcaseZone.find(c => c.id === cardId);
    if (inShowcase) return inShowcase;
    // 从己方战场找（式神、延伸、符咒等）
    for (const slot of (selfView?.shikigamiZone ?? [])) {
      if (slot?.card?.id === cardId) return slot.card;
    }
    for (const c of (selfView?.extendZone ?? []).flat()) {
      if (c.card?.id === cardId) return c.card;
    }
    if (selfView?.barrier?.id === cardId) return selfView.barrier;
    return null;
  }

  // 敌方式神位：从右到左显示（棋盘上方视角）
  const enemyLane = [...(enemyView?.shikigamiZone ?? []).map((slot, boardIndex) => ({ slot, seatNumber: boardIndex + 1, boardIndex }))].reverse();
  // 己方式神位：从左到右显示
  const selfLane = (selfView?.shikigamiZone ?? []).map((slot, idx) => ({ slot, seatNumber: idx + 1 }));

  const deckListIndexed = useMemo(() => {
    const d = selfView?.deck ?? [];
    return d.map((c, index) => ({ card: c, index }));
  }, [selfView?.deck]);

  const deckModalFiltered = useMemo(() => {
    const q = deckModalQuery.trim().toLowerCase();
    if (!q) return deckListIndexed;
    return deckListIndexed.filter(
      ({ card }) => card.name.toLowerCase().includes(q) || card.id.toLowerCase().includes(q)
    );
  }, [deckListIndexed, deckModalQuery]);

  function closeDeckModals() {
    setDeckSearchModalOpen(false);
    setDeckPeekModalOpen(false);
  }

  const isConnected = socket?.readyState === WebSocket.OPEN;

  return (
    <main className="app">
      {/* ========== 顶部标题栏 ========== */}
      <header className="app-header">
        <div className="app-title-block">
          <h1 className="app-title">⚔ 卡牌对战</h1>
          {matchState && (
            <div className={`turn-badge ${isMyTurn && !isMulligan ? "is-my-turn" : ""}`}>
              {isMulligan
                ? "🔄 调度阶段"
                : isMyTurn
                ? "✅ 我的回合"
                : "⏳ 对手回合"}
              <span className="turn-num">第 {matchState.turn} 回合</span>
            </div>
          )}
        </div>
        <div className="app-header-actions">
          <div className={`conn-dot ${isConnected ? "connected" : "disconnected"}`} title={isConnected ? "已连接" : "未连接"} />
        </div>
      </header>

      {/* ========== 大厅 / 连接面板（可折叠） ========== */}
      <section className={`collapsible-panel ${lobbyCollapsed ? "collapsed" : ""}`}>
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setLobbyCollapsed((v) => !v)}
          aria-expanded={!lobbyCollapsed}
        >
          <span>🏠 大厅 &amp; 连接</span>
          <span className="collapse-arrow">{lobbyCollapsed ? "▸" : "▾"}</span>
        </button>

        {!lobbyCollapsed && (
          <div className="collapsible-body">
            <div className="lobby-grid">
              {/* 连接区 */}
              <div className="lobby-block">
                <h3 className="lobby-block-title">服务器连接</h3>
                <div className="form-row">
                  <label>服务器地址</label>
                  <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="ws://..." />
                </div>
                <div className="form-row">
                  <label>玩家昵称</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="输入昵称" />
                </div>
                <button className="btn-primary" onClick={() => connect()}>
                  {isConnected ? "✅ 已连接" : "连接服务器"}
                </button>
                <button className="btn-import-deck" onClick={() => setImportModalOpen(true)}>
                  📋 {builderDeck ? `已导入 ${builderDeck.length} 张` : "导入卡组"}
                </button>
                {builderDeck && (
                  <button className="btn-clear-deck" onClick={() => setBuilderDeck(null)}>
                    ❌ 清除卡组
                  </button>
                )}
              </div>

              {/* 房间区 */}
              <div className="lobby-block">
                <h3 className="lobby-block-title">房间操作</h3>
                <div className="room-actions">
                  <button className="btn-primary" onClick={quickCreateRoom}>⚡ 一键建房</button>
                  <button onClick={() => send({ type: "create_room", payload: { name } })}>创建房间</button>
                  <div className="join-row">
                    <input
                      placeholder="输入房间 ID"
                      value={roomIdInput}
                      onChange={(e) => setRoomIdInput(e.target.value)}
                    />
                    <button onClick={() => send({ type: "join_room", payload: { roomId: roomIdInput, name } })}>
                      加入
                    </button>
                  </div>
                  <button
                    className="btn-start"
                    disabled={!roomId}
                    onClick={() => {
                      console.log('[游戏] 点击开始对局, builderDeck:', builderDeck?.length ?? 'null');
                      send({
                        type: "start_match",
                        payload: { roomId }
                      });
                    }}
                  >
                    🎮 开始对局 {builderDeck ? `（${builderDeck.length}张）` : "（默认牌组）"}
                  </button>
                </div>
                {roomId && (
                  <div className="room-info">
                    <div className="room-id-row">
                      <span>房间：<strong id="room-id-display">{roomId}</strong></span>
                      <button
                        type="button"
                        className="btn-copy-room-id"
                        onClick={() => {
                          navigator.clipboard.writeText(roomId).then(() => {
                            appendLog(`📋 房间ID已复制：${roomId}`);
                          }).catch(() => {
                            // fallback
                            const el = document.getElementById('room-id-display');
                            if (el) {
                              const range = document.createRange();
                              range.selectNode(el);
                              window.getSelection()?.removeAllRanges();
                              window.getSelection()?.addRange(range);
                              document.execCommand('copy');
                              window.getSelection()?.removeAllRanges();
                              appendLog(`📋 房间ID已复制：${roomId}`);
                            }
                          });
                        }}
                        title="复制房间ID"
                      >
                        📋 复制
                      </button>
                    </div>
                    <span>玩家 ID：<code>{playerId || "—"}</code></span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ========== 对战区 ========== */}
      {!matchState && (
        <div className="no-match-placeholder">
          <div className="no-match-icon">🃏</div>
          <p>连接服务器并创建 / 加入房间后开始对局</p>
        </div>
      )}

      {matchState && (
        <section className="battle-section">
          {/* 调度提示 */}
          {isMulligan && (
            <div className="mulligan-banner">
              <strong>🔄 调度阶段</strong>——点击手牌选择要洗回牌库的牌（可选任意张，补满 5 张后洗入），双方同时提交，不会向对方展示具体内容。
            </div>
          )}

          {/* ============================================================
              战场主体（左侧标记面板 + 右侧棋盘区）
              ============================================================ */}
          <div className="battlefield-wrapper">

            {/* ── 左侧标记面板（竖向） ── */}
            <div className="token-panel" aria-label="指示物池">
              <div className="token-panel-title">指示物</div>
              <div className="token-panel-strip">
                {TOKEN_STRIP.map((t) => (
                  <div
                    key={t.kind}
                    className={`token-chip token-chip--${t.kind}`}
                    draggable={allowBoardDrag}
                    onDragStart={(e) => { if (allowBoardDrag) setTokenDragPayload(e, t.kind); }}
                    title={t.hint}
                  >
                    {t.label}
                  </div>
                ))}
              </div>
            </div>

            {/* ── 右侧棋盘（战场.html的grid布局） ── */}
            <div className="battlefield-right">

              {/* 上方玩家区（敌方） */}
              <div className="player-area">
                {/* 生命区 */}
                <div className="life-area">
                  <div className="life-num">{enemyView?.hp ?? 30}</div>
                  <div className="life-btn">
                    <button type="button" onClick={() => adjustSelfHpByDelta(-1)} title="敌方生命-1">-</button>
                    <button type="button" onClick={() => adjustSelfHpByDelta(1)} title="敌方生命+1">+</button>
                  </div>
                </div>

                {/* 敌方手牌（横排） */}
                <div
                  className="hand-area enemy-hand-area"
                  onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                  onDrop={(e) => onDropToZone(e, "hand")}
                >
                  <div className="enemy-hand-cards">
                    {(isMulligan ? (enemyView?.concealedHandCount ?? enemyView?.hand.length ?? 0) : (enemyView?.hand.length ?? 0)) > 0 ? (
                      (isMulligan
                        ? Array.from({ length: enemyView?.concealedHandCount ?? enemyView?.hand.length ?? 0 })
                        : enemyView?.hand ?? []
                      ).map((card: Card | undefined, i: number) => {
                        // 对手公开的手牌显示正面，其余显示背面
                        const isRevealed = !isMulligan && card && (enemyView?.revealedHandIds ?? []).includes(card.id);
                        const imgSrc = isRevealed && card?.img ? card.img : CARD_BACK_IMAGE_URL;
                        return (
                          <div
                            key={isMulligan ? i : (card as Card).id}
                            className={`card hand-card enemy-card ${isRevealed ? 'hand-card--revealed' : ''}`}
                            style={{ backgroundImage: `url(${imgSrc})` }}
                            onMouseEnter={() => { if (isRevealed && card) { setHoveredBoardCardId(card.id); setHoveredBoardCardData(card); } }}
                            onMouseLeave={() => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); }}
                          />
                        );
                      })
                    ) : (
                      <span className="hand-empty-hint">无手牌</span>
                    )}
                  </div>
                </div>

                {/* 移除区 */}
                <div
                  className="remove-area"
                  onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                  onDrop={(e) => onDropToZone(e, "removed_zone")}
                  onClick={() => { setRemovedModalView("enemy"); setRemovedModalOpen(true); }}
                >
                  <div className="remove-title">移除区</div>
                  {enemyView?.removedZone.length > 0 && (() => {
                    const topCard = enemyView!.removedZone[enemyView!.removedZone.length - 1];
                    return (
                      <div
                        className="card card--mini remove-stacked"
                        style={{ backgroundImage: `url(${topCard.img || CARD_IMAGE_URL})` }}
                      />
                    );
                  })()}
                  <span className="remove-count">{enemyView?.removedZone.length ?? 0}张</span>
                </div>
              </div>

              {/* ── 棋盘 grid ── */}
              <div className="game-board">
                {/* 第一行：牌库 | 符咒(跨4列) | 墓地 */}
                <div className="area ratio-7-9 area--enemy">
                  <span className="area-label">牌库</span>
                  <span className="area-count">{enemyView?.deckCount ?? 0}张</span>
                </div>
                <div className="area spell-area area--enemy" id="enemy-spell-zone">
                  <div
                    className="spell-drop-zone"
                    onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                    onDrop={(e) => onDropToZone(e, "spell")}
                  >
                    {enemyView?.spellZone.map((entry, i, arr) => {
                      const { left, top, transform, zIndex } = getSpellCardPosition(i, arr.length);
                      const rotatedTransform = entry.exhausted ? 'translateY(-50%) rotate(90deg)' : transform;
                      // 觉醒牌始终公开（不管 concealedForViewer 值如何）
                      const isAwaken = entry.card.type === 'awaken';
                      const showFace = isAwaken || entry.revealedToOpponent || entry.concealedForViewer !== true;
                      const imgSrc = showFace ? (entry.card.img || CARD_IMAGE_URL) : CARD_BACK_IMAGE_URL;
                      return (
                        <div
                          key={entry.card.id}
                          className={`card spell-card ${entry.exhausted ? 'is-exhausted' : ''} ${showFace ? 'spell-card--revealed' : ''}`}
                          style={{
                            backgroundImage: `url(${imgSrc})`,
                            left,
                            top,
                            transform: rotatedTransform,
                            zIndex,
                          }}
                          onMouseEnter={() => { if (showFace) { setHoveredBoardCardId(entry.card.id); setHoveredBoardCardData(entry.card); } }}
                          onMouseLeave={() => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="area ratio-7-9 area--enemy">
                  <span className="area-label">墓地</span>
                  <div
                    className="drop-zone graveyard-zone"
                    onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                    onDrop={(e) => onDropToZone(e, "graveyard")}
                    onClick={() => { setGraveyardModalView("enemy"); setGraveyardModalOpen(true); }}
                  >
                    {enemyView?.graveyard.length > 0 && (() => {
                      const topCard = enemyView!.graveyard[enemyView!.graveyard.length - 1];
                      return (
                        <div
                          className="card card--mini graveyard-stacked"
                          style={{ backgroundImage: `url(${topCard.img || CARD_IMAGE_URL})` }}
                        />
                      );
                    })()}
                  </div>
                </div>

                {/* 上方式神组（从右到左：6号→1号） */}
                {enemyLane.map(({ slot, seatNumber, boardIndex }) => (
                  <div className="shikigami-item" key={`enemy-shiki-${seatNumber}`}>
                    <div className="area ratio-7-9 area--enemy">
                      <div
                        className="drop-zone"
                        data-zone="shiki"
                        onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!allowBoardDrag || !roomId || !enemyView) return;
                          const p = readBoardDragPayload(e);
                          if (p?.kind === "token" && slot) {
                            placeTokenOnShikigami(enemyView.id, boardIndex, p.tokenKind);
                          } else if (!slot && p?.kind === "card" && p.cardType !== "spell") {
                            moveCardPayload(p.cardId, p.from, "shikigami", boardIndex);
                          }
                        }}
                      >
                        {slot && (
                          <div className="shikigami-card-in-area">
                            <div
                              className={`shikigami-card-stage ${slot.exhausted ? "is-exhausted" : ""}`}
                            >
                              <ShikigamiCardFace
                                slot={slot}
                                interactive={false}
                                allowBoardDrag={false}
                                isHidden={true}
                                onCardDragStart={() => {}}
                                onHoverEnter={() => { if (!slot.stealth) { setHoveredBoardCardId(slot.card.id); setHoveredBoardCardData(slot.card); } }}
                                onHoverLeave={() => setHoveredBoardCardId(null)}
                              />
                            </div>
                            {!slot.stealth && <ShikigamiTokenBelt slot={slot} interactive={false} />}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="area ratio-7-4 shikigami-extend area--enemy">
                      <div
                        className="drop-zone extend-drop-zone"
                        data-zone="extend"
                        onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); if (allowBoardDrag) onDropToZone(e, "extend", boardIndex); }}
                      >
                        {enemyView?.extendZone[boardIndex]?.map((entry) => (
                          <div
                            key={entry.card.id}
                            className={`card extend-card ${entry.exhausted ? 'is-exhausted' : ''}`}
                            style={{ backgroundImage: `url(${entry.card.img || CARD_IMAGE_URL})` }}
                            onMouseEnter={() => { setHoveredBoardCardId(entry.card.id); setHoveredBoardCardData(entry.card); }}
                            onMouseLeave={() => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                {/* 结界行 */}
                <div className="area ratio-7-9 barrier-left">
                  <span className="area-label">结界</span>
                  <div
                    className="drop-zone"
                    data-zone="barrier"
                    onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                    onDrop={(e) => onDropToZone(e, "barrier")}
                  >
                    {enemyView?.barrier && (
                      <div
                        className={`card card--mini ${enemyView.barrierExhausted ? 'is-exhausted' : ''}`}
                        style={{ backgroundImage: `url(${enemyView.barrier.img || CARD_IMAGE_URL})` }}
                        onMouseEnter={() => { setHoveredBoardCardId(enemyView!.barrier!.id); setHoveredBoardCardData(enemyView!.barrier!); }}
                        onMouseLeave={() => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); }}
                      />
                    )}
                  </div>
                </div>
                {/* 展示区：两个结界之间，供双方玩家展示卡牌 */}
                <div className="area showcase-zone">
                  <span className="area-label">展示</span>
                  <div
                    className="drop-zone showcase-drop-zone"
                    onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                    onDrop={(e) => onDropToZone(e, "showcase")}
                  >
                    {(!matchState?.showcaseZone || matchState.showcaseZone.length === 0) && (
                      <span className="area-count area-count--dim">拖入展示</span>
                    )}
                    {matchState?.showcaseZone?.map((card, i) => (
                      <div
                        key={`${card.id}-${i}`}
                        className={`card card--mini showcase-card ${deckPlaceMode && deckPlaceSelected.some((s) => s.cardId === card.id) ? 'deck-modal-cell--selected' : ''}`}
                        style={{ backgroundImage: `url(${card.img || CARD_IMAGE_URL})` }}
                        draggable={allowBoardDrag && !deckPlaceMode}
                        onClick={() => { if (deckPlaceMode) { toggleDeckPlaceCard(card.id, "showcase"); return; } }}
                        onDragStart={(e) => {
                          setDragPayload(e, card.id, "showcase", card.type);
                          setHoveredBoardCardId(null);
                          setHoveredBoardCardData(null);
                        }}
                        onMouseEnter={() => { setHoveredBoardCardId(card.id); setHoveredBoardCardData(card); }}
                        onMouseLeave={() => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); }}
                      />
                    ))}
                  </div>
                </div>
                <div className="area ratio-7-9 barrier-right">
                  <span className="area-label">结界</span>
                  <div
                    className="drop-zone"
                    data-zone="barrier"
                    onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                    onDrop={(e) => onDropToZone(e, "barrier")}
                  >
                        {selfView?.barrier && (
                          <div
                            className={`card card--mini ${selfView.barrierExhausted ? 'is-exhausted' : ''}`}
                            style={{ backgroundImage: `url(${selfView.barrier.img || CARD_IMAGE_URL})` }}
                            draggable={allowBoardDrag}
                            onDragStart={(e) => setDragPayload(e, selfView!.barrier!.id, "barrier", "barrier")}
                            onClick={() => toggleSpellExhaust(selfView!.barrier!.id)}
                            onMouseEnter={() => { setHoveredBoardCardId(selfView!.barrier!.id); setHoveredBoardCardData(selfView!.barrier!); }}
                            onMouseLeave={() => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); }}
                          />
                        )}
                  </div>
                </div>

                {/* 下方式神组（从左到右：1号→6号） */}
                {selfLane.map(({ slot, seatNumber }, renderIndex) => (
                  <div className="shikigami-item" key={`self-shiki-${seatNumber}`}>
                    <div className="area ratio-7-9 area--self">
                      <div
                        className={`drop-zone ${dragOverSlot === renderIndex ? "drag-over" : ""}`}
                        data-zone="shiki"
                        onDragOver={(event) => {
                          if (!allowBoardDrag) return;
                          event.preventDefault();
                          if (!slot) setDragOverSlot(renderIndex);
                        }}
                        onDragLeave={() => setDragOverSlot((prev) => (prev === renderIndex ? null : prev))}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (!allowBoardDrag || !roomId || !playerId) { setDragOverSlot(null); return; }
                          const p = readBoardDragPayload(event);
                          if (!p) { setDragOverSlot(null); return; }
                          if (p.kind === "token") {
                            if (slot) placeTokenOnShikigami(playerId, renderIndex, p.tokenKind);
                          } else if (!slot && p.cardType !== "spell") {
                            moveCardPayload(p.cardId, p.from, "shikigami", renderIndex);
                          }
                          setDragOverSlot(null);
                        }}
                      >
                        {slot && (
                          <div className="shikigami-card-in-area">
                            <div
                              className={`shikigami-card-stage ${slot.exhausted ? "is-exhausted" : ""} ${deckPlaceMode && deckPlaceSelected.some((s) => s.cardId === slot.card.id) ? "deck-modal-cell--selected" : ""}`}
                              onClick={() => {
                                if (deckPlaceMode) { toggleDeckPlaceCard(slot.card.id, "shikigami"); return; }
                                if (stealthMode) { toggleShikigamiStealth(slot.card.id, true); setStealthMode(false); return; }
                                toggleShikigamiExhaust(slot.card.id);
                              }}
                              role="presentation"
                              onMouseEnter={() => { setHoveredBoardCardId(slot.card.id); setHoveredBoardCardData(slot.card); }}
                              onMouseLeave={() => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); }}
                            >
                              <ShikigamiCardFace
                                slot={slot}
                                interactive={!deckPlaceMode && !stealthMode}
                                allowBoardDrag={allowBoardDrag && !deckPlaceMode && !stealthMode}
                                isHidden={false}
                                onRevealStealth={() => toggleShikigamiStealth(slot.card.id, false)}
                                onCardDragStart={(e) => setDragPayload(e, slot.card.id, "shikigami", slot.card.type)}
                              />
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                              <ShikigamiTokenBelt
                                slot={slot}
                                interactive={allowBoardDrag}
                                onRemoveToken={(kind) => removeTokenFromShikigami(playerId, renderIndex, kind)}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="area ratio-7-4 shikigami-extend area--self">
                      <div
                        className="drop-zone extend-drop-zone"
                        data-zone="extend"
                        onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); if (allowBoardDrag) onDropToZone(e, "extend", renderIndex); }}
                      >
                        {selfView?.extendZone[renderIndex]?.map((entry) => (
                          <div
                            key={entry.card.id}
                            className={`card extend-card ${entry.exhausted ? 'is-exhausted' : ''} ${deckPlaceMode && deckPlaceSelected.some((s) => s.cardId === entry.card.id) ? 'deck-modal-cell--selected' : ''}`}
                            style={{ backgroundImage: `url(${entry.card.img || CARD_IMAGE_URL})` }}
                            draggable={allowBoardDrag && !deckPlaceMode}
                            onDragStart={(ev) => { if (allowBoardDrag && !deckPlaceMode) setDragPayload(ev, entry.card.id, "extend", entry.card.type); }}
                            onClick={() => { if (deckPlaceMode) { toggleDeckPlaceCard(entry.card.id, "extend"); return; } toggleSpellExhaust(entry.card.id); }}
                            onMouseEnter={() => { setHoveredBoardCardId(entry.card.id); setHoveredBoardCardData(entry.card); }}
                            onMouseLeave={() => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                {/* 最后一行：牌库 | 符咒(跨4列) | 墓地 */}
                <div className="area ratio-7-9 area--self">
                  <div
                    className="drop-zone deck-zone"
                    data-zone="deck"
                    style={{ backgroundImage: `url(${CARD_BACK_IMAGE_URL})` }}
                    onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                    onDrop={(e) => onDropToZone(e, "deck_top")}
                  >
                    <span className="deck-count">牌库 {selfView?.deckCount ?? 0}</span>
                  </div>
                </div>
                <div className="area spell-area area--self" id="self-spell-zone">
                  <div
                    className="spell-drop-zone"
                    onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                    onDrop={(e) => onDropToZone(e, "spell")}
                  >
                    {selfView?.spellZone.map((entry, i, arr) => {
                      const { left, top, transform, zIndex } = getSpellCardPosition(i, arr.length);
                      const rotatedTransform = entry.exhausted ? 'translateY(-50%) rotate(90deg)' : transform;
                      const isAwaken = entry.card.type === 'awaken';
                      // 觉醒牌始终公开
                      const isRevealed = isAwaken || entry.revealedToOpponent;
                      // 己方始终看到正面
                      const imgSrc = entry.card.img || CARD_IMAGE_URL;
                      return (
                        <div
                          key={entry.card.id}
                          className={`card spell-card ${entry.exhausted ? 'is-exhausted' : ''} ${isRevealed ? 'spell-card--revealed' : ''} ${deckPlaceMode && deckPlaceSelected.some((s) => s.cardId === entry.card.id) ? 'deck-modal-cell--selected' : ''}`}
                          style={{
                            backgroundImage: `url(${imgSrc})`,
                            left,
                            top,
                            transform: rotatedTransform,
                            zIndex,
                          }}
                          draggable={allowBoardDrag && !deckPlaceMode}
                          onDragStart={(e) => {
                            if (!deckPlaceMode) {
                              setDragPayload(e, entry.card.id, "spell", entry.card.type);
                              if (entry.card.type === "spell") {
                                draggingSpellRef.current = entry.card;
                                draggingSpellFromRef.current = "spell";
                                spellDroppedOnZone.current = false;
                              }
                            }
                          }}
                          onDragEnd={() => {
                            if (draggingSpellRef.current && !spellDroppedOnZone.current) {
                              handleSpellPlay(draggingSpellRef.current);
                            }
                            draggingSpellRef.current = null;
                            spellDroppedOnZone.current = false;
                          }}
                          onMouseEnter={() => { setHoveredBoardCardId(entry.card.id); setHoveredBoardCardData(entry.card); }}
                          onMouseLeave={() => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); }}
                          onClick={() => {
                            if (deckPlaceMode) { toggleDeckPlaceCard(entry.card.id, "spell"); return; }
                            if (spellFlipMode && !isAwaken) {
                              revealSpellCard(entry.card.id);
                            } else {
                              toggleSpellExhaust(entry.card.id);
                            }
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="area ratio-7-9 area--self">
                  <span className="area-label">墓地</span>
                  <div
                    className="drop-zone graveyard-zone"
                    onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                    onDrop={(e) => onDropToZone(e, "graveyard")}
                    onClick={() => { setGraveyardModalView("self"); setGraveyardModalOpen(true); }}
                  >
                    {selfView?.graveyard.length > 0 && (() => {
                      const topCard = selfView!.graveyard[selfView!.graveyard.length - 1];
                      return (
                        <div
                          className="card card--mini graveyard-stacked"
                          style={{ backgroundImage: `url(${topCard.img || CARD_IMAGE_URL})` }}
                        />
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* 下方玩家区（己方） */}
              <div className="player-area player-area--self">
                {/* 生命区 */}
                <div className="life-area">
                  <div className="life-num self-life">{selfView?.hp ?? 30}</div>
                  <div className="life-btn">
                    <button type="button" disabled={!roomId || gameOver || !allowBoardDrag}
                      onClick={() => adjustSelfHpByDelta(-1)} title="己方生命-1">-</button>
                    <button type="button" disabled={!roomId || gameOver || !allowBoardDrag}
                      onClick={() => adjustSelfHpByDelta(1)} title="己方生命+1">+</button>
                  </div>
                </div>

                {/* 己方手牌 - 完全独立新结构 */}
                <div style={{
                  width: "780px",
                  height: "180px",
                  border: "2px dashed rgba(255,255,255,0.2)",
                  borderRadius: "8px",
                  background: "rgba(0,0,0,0.3)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  flexShrink: 0,
                  position: "relative",
                }}
                  onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                  onDrop={(e) => onDropToZone(e, "hand")}
                >
                  {/* 标题栏 */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "4px 12px",
                    borderBottom: "1px solid #152030",
                    height: "32px",
                    flexShrink: 0,
                  }}>
                    <span style={{ color: "#5e88b0", fontSize: "0.75rem" }}>
                      {isMulligan ? "🔄 调度" : `🃏 ${selfView?.hand.length ?? 0}/${selfView?.maxHandSize ?? 12}`}
                    </span>
                    <div style={{ display: "flex", gap: "8px" }}>
                      {matchState && !isMulligan && (
                        <button
                          type="button"
                          className={`btn-view ${deckPlaceMode ? 'btn-reveal--active' : ''}`}
                          disabled={!roomId || gameOver}
                          onClick={() => {
                            if (deckPlaceMode) {
                              // 再次点击：有选中则弹窗，无选中则退出模式
                              if (deckPlaceSelected.length > 0) {
                                setDeckPlaceConfirmOpen(true);
                              } else {
                                setDeckPlaceMode(false);
                              }
                            } else {
                              setDeckPlaceMode(true);
                            }
                          }}
                          title="从各区域选牌置入牌库"
                        >
                          {deckPlaceMode ? `📥 确认(${deckPlaceSelected.length})` : "📥 置入牌库"}
                        </button>
                      )}
                      {matchState && !isMulligan && (
                        <button
                          type="button"
                          className="btn-view"
                          disabled={!roomId || gameOver || (selfView?.deckCount ?? 0) === 0}
                          onClick={() => { setDeckViewModalOpen(true); setDeckViewInput(""); setDeckViewConfirmed(false); }}
                          title="查看牌库顶卡牌"
                        >
                          🔍 查看
                        </button>
                      )}
                      {matchState && !isMulligan && (
                        <button
                          type="button"
                          className="btn-draw"
                          disabled={!roomId || gameOver || (selfView?.deckCount ?? 0) === 0}
                          onClick={() => send({ type: "deck_draw", payload: { roomId, count: 1 } })}
                          title="从牌库抽1张"
                        >
                          🃏 抽牌
                        </button>
                      )}
                      {matchState && !isMulligan && (
                        <button
                          type="button"
                          className={`btn-reveal ${spellFlipMode ? 'btn-reveal--active' : ''}`}
                          disabled={!roomId || gameOver}
                          onClick={() => setSpellFlipMode((prev) => !prev)}
                        >
                          {spellFlipMode ? "👁 退出展示" : "👁 展示"}
                        </button>
                      )}
                      {matchState && !isMulligan && (
                        <button
                          type="button"
                          className={`btn-reveal ${stealthMode ? 'btn-reveal--active' : ''}`}
                          disabled={!roomId || gameOver}
                          onClick={() => setStealthMode((prev) => !prev)}
                        >
                          {stealthMode ? "👤 退出潜行" : "👤 潜行"}
                        </button>
                      )}
                      {matchState && !isMulligan && (
                        <button
                          type="button"
                          className="btn-end-turn"
                          disabled={!isMyTurn || !roomId || gameOver}
                          onClick={() => send({ type: "end_turn", payload: { roomId } })}
                        >
                          {isMyTurn ? "⚔️ 结束回合" : "⏳ 等待对手..."}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* 手牌容器 - 780px 固定宽度 */}
                  <div style={{
                    position: "relative",
                    width: "780px",
                    height: "150px",
                    overflow: "hidden",
                    flex: "none",
                    minWidth: "780px",
                    maxWidth: "780px",
                  }}>
                    {selfView?.hand.map((card, index) => {
                      const handSize = selfView?.hand.length ?? 1;
                      const CARD_WIDTH = 96;
                      const CONTAINER_WIDTH = 780;
                      const totalWidth = handSize * CARD_WIDTH;
                      // 超过容器宽度时两端对齐，否则居中
                      let left: string;
                      if (totalWidth <= CONTAINER_WIDTH) {
                        // 居中分布
                        const startX = (CONTAINER_WIDTH - totalWidth) / 2;
                        left = `${startX + index * CARD_WIDTH + CARD_WIDTH / 2}px`;
                      } else {
                        // 两端对齐
                        left = `${(CONTAINER_WIDTH - CARD_WIDTH) * index / (handSize - 1) + CARD_WIDTH / 2}px`;
                      }
                      const picked = mulliganSelectedIds.has(card.id);
                      const isRevealed = handRevealedIds.has(card.id);
                      return (
                        <button
                          key={card.id}
                          type="button"
                          style={{
                            position: "absolute",
                            left,
                            bottom: 0,
                            transform: "translateX(-50%)",
                            transition: "transform 0.15s ease",
                            width: "96px",
                            height: "132px",
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            cursor: hoveredHandCardId === card.id ? "pointer" : "grab",
                          }}
                          disabled={isMulligan ? iSubmittedMulligan : gameOver}
                          draggable={!isMulligan && allowBoardDrag && !deckPlaceMode}
                          onMouseEnter={() => setHoveredHandCardId(card.id)}
                          onMouseLeave={() => setHoveredHandCardId((prev) => (prev === card.id ? null : prev))}
                          onDragStart={(e) => {
                            if (!isMulligan && allowBoardDrag) {
                              setDragPayload(e, card.id, "hand", card.type);
                            }
                          }}
                          onDragEnd={() => setDragOverSlot(null)}
                          onClick={() => {
                            if (deckPlaceMode) { toggleDeckPlaceCard(card.id, "hand"); return; }
                            if (isMulligan) {
                              if (!iSubmittedMulligan) toggleMulliganPick(card.id);
                              return;
                            }
                            if (spellFlipMode) {
                              revealHandCard(card.id);
                              return;
                            }
                            if (canPlayToShikigami(card)) playCardToZone(card.id, "shikigami");
                          }}
                        >
                          <img
                            src={card.img || CARD_IMAGE_URL}
                            alt={card.name}
                            style={{
                              width: "96px",
                              height: "128px",
                              objectFit: "cover",
                              borderRadius: "6px",
                              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                              opacity: picked ? 0.6 : 1,
                              boxShadow: deckPlaceMode && deckPlaceSelected.some((s) => s.cardId === card.id)
                                ? "0 0 8px 2px rgba(251,191,36,0.6)" : "0 4px 12px rgba(0,0,0,0.5)",
                            }}
                          />
                          {isRevealed && <span style={{
                            position: "absolute",
                            top: "4px",
                            right: "4px",
                            fontSize: "12px",
                          }}>👁</span>}
                        </button>
                      );
                    })}
                    {selfView && selfView.hand.length === 0 && (
                      <span style={{ color: "#94a3b8", fontSize: "0.85rem", position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}>
                        当前无手牌
                      </span>
                    )}
                    {/* 调度操作按钮 */}
                    {isMulligan && (
                      <div style={{
                        position: "absolute",
                        bottom: "8px",
                        right: "12px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}>
                        <button
                          type="button"
                          style={{
                            padding: "6px 14px",
                            fontSize: "0.85rem",
                            background: "#3b82f6",
                            color: "#fff",
                            border: "none",
                            borderRadius: "6px",
                            cursor: "pointer",
                          }}
                          disabled={!roomId || iSubmittedMulligan}
                          onClick={submitMulligan}
                        >
                          {iSubmittedMulligan ? "✅ 已提交" : "确认调度"}
                        </button>
                        {iSubmittedMulligan && <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>⏳ 等待对方…</span>}
                      </div>
                    )}
                  </div>

                  {/* 卡牌悬浮预览 */}
                  {hoveredHandCardId && (() => {
                    const hoveredCard = selfView?.hand.find(c => c.id === hoveredHandCardId);
                    if (!hoveredCard) return null;
                    return (
                      <div className="card-preview">
                        <img className="card-preview-art" src={hoveredCard.img || CARD_IMAGE_URL} alt={hoveredCard.name} />
                        <div className="card-preview-info">
                          <div className="card-preview-name">{hoveredCard.name}</div>
                          <div className="card-preview-stats">
                            <span className="preview-stat">费用 {hoveredCard.cost}</span>
                            {hoveredCard.type === 'shikigami' && (
                              <>
                                <span className="preview-stat">攻击 {hoveredCard.attack}</span>
                                <span className="preview-stat">生命 {hoveredCard.health}</span>
                              </>
                            )}
                          </div>
                          {hoveredCard.ability && (
                            <div className="card-preview-ability">{hoveredCard.ability}</div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* 移除区 */}
                <div
                  className="remove-area"
                  onDragOver={(e) => allowBoardDrag && e.preventDefault()}
                  onDrop={(e) => onDropToZone(e, "removed_zone")}
                  onClick={() => { setRemovedModalView("self"); setRemovedModalOpen(true); }}
                >
                  <div className="remove-title">移除区</div>
                  {selfView?.removedZone.length > 0 && (() => {
                    const topCard = selfView!.removedZone[selfView!.removedZone.length - 1];
                    return (
                      <div
                        className="card card--mini remove-stacked"
                        style={{ backgroundImage: `url(${topCard.img || CARD_IMAGE_URL})` }}
                      />
                    );
                  })()}
                  <span className="remove-count">{selfView?.removedZone.length ?? 0}张</span>
                </div>
              </div>

            </div>{/* /battlefield-right */}
          </div>{/* /battlefield-wrapper */}

        </section>
      )}

      {/* ========== 日志面板（可折叠） ========== */}
      <section className={`collapsible-panel logs-panel ${logsCollapsed ? "collapsed" : ""}`}>
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setLogsCollapsed((v) => !v)}
          aria-expanded={!logsCollapsed}
        >
          <span>📋 事件日志</span>
          <span className="collapse-arrow">{logsCollapsed ? "▸" : "▾"}</span>
        </button>
        {!logsCollapsed && (
          <div className="collapsible-body">
            <ul className="logs">
              {logs.length === 0 && <li className="log-empty">暂无日志</li>}
              {logs.map((line, index) => (
                <li key={`${line}-${index}`}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ========== 通用卡牌悬停预览（棋盘区域） ========== */}
      {hoveredBoardCardData && (
        <div className="card-preview">
          <img className="card-preview-art" src={hoveredBoardCardData.img || CARD_IMAGE_URL} alt={hoveredBoardCardData.name} />
          <div className="card-preview-info">
            <div className="card-preview-name">{hoveredBoardCardData.name}</div>
            <div className="card-preview-stats">
              <span className="preview-stat">费用 {hoveredBoardCardData.cost}</span>
              {hoveredBoardCardData.type === 'shikigami' && (
                <>
                  <span className="preview-stat">攻击 {hoveredBoardCardData.attack}</span>
                  <span className="preview-stat">生命 {hoveredBoardCardData.health}</span>
                </>
              )}
            </div>
            {hoveredBoardCardData.ability && (
              <div className="card-preview-ability">{hoveredBoardCardData.ability}</div>
            )}
          </div>
        </div>
      )}

      {/* ========== 游戏结束遮罩 ========== */}
      {matchState?.winnerId ? (
        <div className="game-over-overlay" role="alertdialog" aria-live="assertive" aria-label="对局结束">
          <div className="game-over-card">
            <h3 className="game-over-title">对局结束</h3>
            <p className="game-over-body">
              胜者：<strong>{matchState.players[matchState.winnerId]?.name ?? matchState.winnerId}</strong>
            </p>
            {matchState.winnerId === playerId ? (
              <p className="game-over-sub game-over-win">🏆 你获得了胜利！</p>
            ) : (
              <p className="game-over-sub game-over-lose">💀 对方获胜。</p>
            )}
          </div>
        </div>
      ) : null}

      {/* ========== 牌库搜索弹窗 ========== */}
      {deckSearchModalOpen ? (
        <div
          className="deck-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeDeckModals(); }}
        >
          <div className="deck-modal" role="dialog" aria-modal="true" aria-labelledby="deck-search-title">
            <h3 id="deck-search-title">🔍 搜索牌库</h3>
            <p className="deck-modal-hint">从牌库顶连续取出指定张数放入搜索区（可再拖入手牌等）。下方为当前牌库顺序，可用关键词筛选。</p>
            <label className="deck-modal-field">
              筛选（名称或编号）
              <input value={deckModalQuery} onChange={(e) => setDeckModalQuery(e.target.value)} placeholder="输入以筛选…" autoComplete="off" />
            </label>
            <label className="deck-modal-field">
              从库顶取出张数
              <input type="number" min={1} max={60} value={deckSearchTakeCount}
                onChange={(e) => setDeckSearchTakeCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
            </label>
            <p className="deck-modal-meta">牌库共 {deckListIndexed.length} 张 · 匹配 {deckModalFiltered.length} 张</p>
            <div className="deck-modal-scroll">
              <div className="deck-modal-grid">
                {deckModalFiltered.map(({ card, index }) => (
                  <div key={`${card.id}-${index}`} className="deck-modal-cell">
                    <span className="deck-modal-idx">{index + 1}</span>
                    <img className="deck-modal-thumb" src={card.img || CARD_IMAGE_URL} alt={card.name} />
                    <span className="deck-modal-name">{card.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="deck-modal-actions">
              <button type="button" onClick={closeDeckModals}>取消</button>
              <button type="button" disabled={!roomId || !allowBoardDrag}
                onClick={() => { send({ type: "deck_search", payload: { roomId, count: deckSearchTakeCount } }); closeDeckModals(); }}>
                确认取出
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========== 牌库查看弹窗 ========== */}
      {deckPeekModalOpen ? (
        <div
          className="deck-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeDeckModals(); }}
        >
          <div className="deck-modal" role="dialog" aria-modal="true" aria-labelledby="deck-peek-title">
            <h3 id="deck-peek-title">👁 查看牌库</h3>
            <p className="deck-modal-hint">查看牌库顶若干张（牌不离开牌库）。</p>
            <label className="deck-modal-field">
              筛选（名称或编号）
              <input value={deckModalQuery} onChange={(e) => setDeckModalQuery(e.target.value)} placeholder="输入以筛选…" autoComplete="off" />
            </label>
            <label className="deck-modal-field">
              查看张数（从库顶向下）
              <input type="number" min={1} max={60} value={deckPeekCount}
                onChange={(e) => setDeckPeekCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
            </label>
            <p className="deck-modal-meta">牌库共 {deckListIndexed.length} 张 · 匹配 {deckModalFiltered.length} 张</p>
            <div className="deck-modal-scroll">
              <div className="deck-modal-grid">
                {deckModalFiltered.map(({ card, index }) => (
                  <div key={`peek-${card.id}-${index}`} className="deck-modal-cell">
                    <span className="deck-modal-idx">{index + 1}</span>
                    <img className="deck-modal-thumb" src={card.img || CARD_IMAGE_URL} alt={card.name} />
                    <span className="deck-modal-name">{card.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="deck-modal-actions">
              <button type="button" onClick={closeDeckModals}>取消</button>
              <button type="button" disabled={!roomId || !allowBoardDrag}
                onClick={() => { send({ type: "deck_peek", payload: { roomId, count: deckPeekCount } }); closeDeckModals(); }}>
                确认查看
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========== 牌库查看弹窗 ========== */}
      {deckViewModalOpen ? (
        <div
          className="deck-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeDeckView();
            }
          }}
        >
          <div className="deck-modal" role="dialog" aria-modal="true" aria-labelledby="deck-view-title">
            <h3 id="deck-view-title">🔍 查看牌库</h3>
            {!deckViewConfirmed ? (
              <>
                <p className="deck-modal-hint">从牌库顶取出若干张查看，可展示、置顶、置底或洗回。</p>
                <label className="deck-modal-field">
                  查看张数（留空则查看全部）
                  <input
                    type="number"
                    min={1}
                    max={selfView?.deckCount ?? 60}
                    value={deckViewInput}
                    onChange={(e) => setDeckViewInput(e.target.value)}
                    placeholder="输入数字或留空"
                    autoComplete="off"
                  />
                </label>
                <p className="deck-modal-meta">牌库共 {selfView?.deckCount ?? 0} 张</p>
                <div className="deck-modal-actions">
                  <button type="button" onClick={() => { setDeckViewModalOpen(false); setDeckViewConfirmed(false); }}>取消</button>
                  <button type="button" disabled={!roomId || !allowBoardDrag || (selfView?.deckCount ?? 0) === 0}
                    onClick={() => {
                      const count = deckViewInput ? Math.min(Number(deckViewInput), selfView?.deckCount ?? 60) : selfView?.deckCount ?? 0;
                      if (count === 0) return;
                      send({ type: "deck_search", payload: { roomId, count } });
                      setDeckViewConfirmed(true);
                      setDeckViewSelectedIds([]);
                    }}>
                    确认查看
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="deck-modal-meta">搜索区共 {selfView?.deckSearchBuffer.length} 张 · 已选 {deckViewSelectedIds.length} 张</p>
                <div className="deck-modal-scroll">
                  <div className="deck-modal-grid">
                    {selfView.deckSearchBuffer.map((card, index) => {
                      const selIdx = deckViewSelectedIds.indexOf(card.id);
                      const isSelected = selIdx !== -1;
                      return (
                        <div
                          key={`view-${card.id}-${index}`}
                          className={`deck-modal-cell ${isSelected ? "deck-modal-cell--selected" : ""}`}
                          onClick={() => {
                            setDeckViewSelectedIds((prev) => {
                              if (isSelected) {
                                return prev.filter((id) => id !== card.id);
                              }
                              return [...prev, card.id];
                            });
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <span className="deck-modal-idx">{isSelected ? selIdx + 1 : index + 1}</span>
                          <img className="deck-modal-thumb" src={card.img || CARD_IMAGE_URL} alt={card.name} />
                          <span className="deck-modal-name">{card.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="deck-modal-actions deck-modal-actions--wrap">
                  <button type="button" disabled={deckViewSelectedIds.length === 0}
                    onClick={() => {
                      deckViewSelectedIds.forEach((cardId) => moveCardPayload(cardId, "deck_search", "showcase"));
                      setDeckViewSelectedIds([]);
                    }}>
                    📋 展示
                  </button>
                  <button type="button" disabled={deckViewSelectedIds.length === 0}
                    onClick={() => {
                      // 按选择顺序置顶：倒序发送使第一张选中的在最顶
                      [...deckViewSelectedIds].reverse().forEach((cardId) => moveCardPayload(cardId, "deck_search", "deck_top"));
                      setDeckViewSelectedIds([]);
                    }}>
                    ⬆️ 置顶
                  </button>
                  <button type="button" disabled={deckViewSelectedIds.length === 0}
                    onClick={() => {
                      // 按选择顺序置底
                      deckViewSelectedIds.forEach((cardId) => moveCardPayload(cardId, "deck_search", "deck_bottom"));
                      setDeckViewSelectedIds([]);
                    }}>
                    ⬇️ 置底
                  </button>
                  <button type="button"
                    onClick={() => {
                      send({ type: "deck_shuffle", payload: { roomId } });
                      setDeckViewModalOpen(false);
                      setDeckViewConfirmed(false);
                      setDeckViewSelectedIds([]);
                    }}>
                    🔀 洗入剩余牌
                  </button>
                  <button type="button"
                    onClick={() => closeDeckView()}>
                    ✖ 关闭
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* ========== 置入牌库确认弹窗 ========== */}
      {deckPlaceConfirmOpen ? (
        <div
          className="deck-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDeckPlaceConfirmOpen(false); }}
        >
          <div className="deck-modal" role="dialog" aria-modal="true" style={{ maxWidth: "320px" }}>
            <h3>📥 置入牌库</h3>
            <p className="deck-modal-hint">已选择 {deckPlaceSelected.length} 张卡牌，请选择置入方式：</p>
            <div className="deck-modal-actions deck-modal-actions--wrap">
              <button type="button"
                onClick={() => executeDeckPlace("top")}>
                ⬆️ 置顶
              </button>
              <button type="button"
                onClick={() => executeDeckPlace("bottom")}>
                ⬇️ 置底
              </button>
              <button type="button"
                onClick={() => executeDeckPlace("shuffle")}>
                🔀 洗入
              </button>
              <button type="button"
                onClick={() => setDeckPlaceConfirmOpen(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========== 卡组导入弹窗 ========== */}
      {importModalOpen && (
        <div className="import-modal-overlay" onClick={() => setImportModalOpen(false)}>
          <div className="import-modal" onClick={e => e.stopPropagation()}>
            <div className="import-modal-header">
              <h3>📋 导入卡组</h3>
              <button className="import-modal-close" onClick={() => setImportModalOpen(false)}>×</button>
            </div>
            <div className="import-modal-body">
              <p>在下方粘贴从组卡器复制的卡组代码：</p>
              <textarea
                className="import-deck-input"
                placeholder="粘贴卡组代码，如：*OT/xxxx..."
                value={importDeckCode}
                onChange={e => setImportDeckCode(e.target.value)}
                rows={4}
              />
              <div className="import-modal-hint">
                💡 提示：在组卡器中点击"生成卡组短码"或"生成卡组长码"按钮，然后复制代码粘贴到这里。
              </div>
            </div>
            <div className="import-modal-footer">
              <button className="btn-cancel" onClick={() => setImportModalOpen(false)}>取消</button>
              <button
                className="btn-import-confirm"
                onClick={() => {
                  if (!importDeckCode.trim()) {
                    alert('请输入卡组代码！');
                    return;
                  }
                  const deck = decodeDeckCode(importDeckCode.trim());
                  if (!deck) {
                    alert('卡组代码无效，请检查后重新复制！');
                    return;
                  }
                  handleDeckUpdate(deck);
                  setImportModalOpen(false);
                  setImportDeckCode('');
                  console.log('[游戏] 导入卡组成功，共', deck.length, '张');
                }}
              >
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 墓地弹窗 */}
      {graveyardModalOpen && (() => {
        const cards = graveyardModalView === "self" ? selfView?.graveyard : enemyView?.graveyard;
        const isSelf = graveyardModalView === "self";
        const selectedCount = graveyardSelectedIds.size;
        return (
          <div className="graveyard-modal-backdrop" onClick={() => { setGraveyardModalOpen(false); setGraveyardSelectedIds(new Set()); }}>
            <div className="graveyard-modal" onClick={e => e.stopPropagation()}>
              <div className="graveyard-modal-header">
                <span>{isSelf ? "己方" : "敌方"}墓地</span>
                <span className="graveyard-modal-count">{cards?.length ?? 0} 张</span>
                {isSelf && selectedCount > 0 && (
                  <button
                    className="graveyard-modal-action-btn"
                    onClick={() => {
                      // 将选中的卡牌移至展示区
                      graveyardSelectedIds.forEach(cardId => {
                        moveCardPayload(cardId, "graveyard", "showcase");
                      });
                      setGraveyardSelectedIds(new Set());
                      setGraveyardModalOpen(false);
                    }}
                  >
                    移至展示区 ({selectedCount})
                  </button>
                )}
                <button className="graveyard-modal-close" onClick={() => { setGraveyardModalOpen(false); setGraveyardSelectedIds(new Set()); }}>×</button>
              </div>
              <div className="graveyard-modal-body">
                {cards && cards.length > 0 ? (
                  <div className="graveyard-modal-grid">
                    {cards.map((c) => {
                      const isSelected = graveyardSelectedIds.has(c.id);
                      return (
                        <div
                          key={c.id}
                          className={`graveyard-modal-card ${isSelected ? 'graveyard-modal-card--selected' : ''}`}
                          onClick={() => {
                            if (!isSelf) return;
                            setGraveyardSelectedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(c.id)) {
                                next.delete(c.id);
                              } else {
                                next.add(c.id);
                              }
                              return next;
                            });
                          }}
                          draggable={isSelf && !graveyardSelectedIds.has(c.id)}
                          onDragStart={(e) => {
                            if (isSelf && !graveyardSelectedIds.has(c.id)) {
                              setDragPayload(e, c.id, "graveyard", c.type);
                            }
                          }}
                        >
                          <img src={c.img || CARD_IMAGE_URL} alt={c.name} />
                          <span className="graveyard-modal-card-name">{c.name}</span>
                          {isSelected && <span className="graveyard-modal-card-check">✓</span>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="graveyard-modal-empty">墓地暂无卡牌</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 移除区弹窗 */}
      {removedModalOpen && (() => {
        const cards = removedModalView === "self" ? selfView?.removedZone : enemyView?.removedZone;
        const isSelf = removedModalView === "self";
        return (
          <div className="graveyard-modal-backdrop" onClick={() => setRemovedModalOpen(false)}>
            <div className="graveyard-modal" onClick={e => e.stopPropagation()}>
              <div className="graveyard-modal-header">
                <span>{isSelf ? "己方" : "敌方"}移除区</span>
                <span className="graveyard-modal-count">{cards?.length ?? 0} 张</span>
                <button className="graveyard-modal-close" onClick={() => setRemovedModalOpen(false)}>×</button>
              </div>
              <div className="graveyard-modal-body">
                {cards && cards.length > 0 ? (
                  <div className="graveyard-modal-grid">
                    {cards.map((c) => (
                      <div
                        key={c.id}
                        className="graveyard-modal-card"
                        draggable={isSelf}
                        onDragStart={(e) => {
                          if (isSelf) {
                            setDragPayload(e, c.id, "removed_zone", c.type);
                          }
                        }}
                      >
                        <img src={c.img || CARD_IMAGE_URL} alt={c.name} />
                        <span className="graveyard-modal-card-name">{c.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="graveyard-modal-empty">移除区暂无卡牌</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </main>
  );
}

/** 解码组卡器生成的卡组代码（支持短码和长码）- 直接照抄 lua卡牌数据.txt */
function decodeDeckCode(code: string): BuilderCard[] | null {
  try {
    const cleanCode = code.trim();

    // 如果是短码（*OT/ 开头），先解码为卡牌 ID 列表
    if (cleanCode.startsWith('*OT/')) {
      const idList = decodeOTCode(cleanCode);
      if (idList) {
        // 解析空格分隔的 ID 列表
        return decodeDeckIdList(idList);
      }
    }

    // 长码：直接解析为 JSON 或空格分隔的 ID 列表
    // 尝试 JSON 格式
    try {
      const json = JSON.parse(cleanCode);
      if (Array.isArray(json)) {
        return json.map(card => ({
          id: card.id || card.name,
          name: card.name,
          type: mapCardType(card.type),
          cost: card.cost || 0,
          keyword: card.keyword || '',
          ability: card.ability || '',
          img: card.img || ''
        }));
      }
    } catch {
      // 不是 JSON
    }

    // 空格分隔的 ID 列表
    return decodeDeckIdList(cleanCode);
  } catch (e) {
    console.error('[游戏] 解码卡组失败:', e);
    return null;
  }
}

/** 从 lua卡牌数据.txt 照抄的解码函数 */
function decodeOTCode(encodedStr: string): string | null {
  // 常量（与 Lua 完全一致）
  const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const PREFIX_DECODE: Record<string, string> = { "1": "AYK", "2": "BPP", "3": "GOT" };
  const SUFFIX_DECODE: Record<string, string> = { "0": "", "1": "SP", "2": "OR", "3": "UR", "4": "PC", "5": "EX", "6": "3D" };
  const CHAR7_DECODE: Record<string, string> = { "0": "", "1": "a", "2": "b", "3": "c" };

  // 获取 base64 字符索引
  function getBase64Index(char: string): number {
    const idx = BASE64_CHARS.indexOf(char);
    return idx >= 0 ? idx : 0;
  }

  // 自定义 Base64 解码（每4个字符 -> 1个数字）
  function customBase64Decode(base64Str: string): string {
    let numStr = "";
    for (let i = 0; i < base64Str.length; i += 4) {
      const chunk = base64Str.substring(i, i + 4);
      if (chunk.length < 4) break;

      const n1 = getBase64Index(chunk[0]);
      const n2 = getBase64Index(chunk[1]);
      const n3 = getBase64Index(chunk[2]);
      const n4 = getBase64Index(chunk[3]);

      // 用乘法替代位运算（TTS兼容，JS也适用）
      const num = n1 * 262144 + n2 * 4096 + n3 * 64 + n4;
      numStr += String(num).padStart(7, '0');
    }
    return numStr;
  }

  // 单卡解码
  function decodeSingleCard(code: string): { cardName: string; count: number } | null {
    if (code.length !== 7) return null;
    const prefix = PREFIX_DECODE[code[0]] || "";
    const num = code.substring(1, 4);
    const char7 = CHAR7_DECODE[code[4]] || "";
    const suffix = SUFFIX_DECODE[code[5]] || "";
    const count = parseInt(code[6]) || 1;

    const cardName = prefix + num + char7 + (suffix !== "" ? "-" + suffix : "");
    return prefix !== "" ? { cardName, count } : null;
  }

  // 核心解码
  try {
    const cleanStr = encodedStr.replace(/\*OT\//g, "");
    const fullCode = customBase64Decode(cleanStr);
    const result: string[] = [];

    for (let i = 0; i < fullCode.length; i += 7) {
      const c = fullCode.substring(i, i + 7);
      const card = decodeSingleCard(c);
      if (card) {
        for (let j = 0; j < card.count; j++) {
          result.push(card.cardName);
        }
      }
    }
    return result.join(" ");
  } catch {
    return null;
  }
}

/** 解析空格分隔的卡牌 ID 列表格式 */
function decodeDeckIdList(input: string): BuilderCard[] | null {
  // 尝试按空格分割（支持长码格式）
  const ids = input.split(/\s+/).filter(id => id.trim());
  if (ids.length > 0 && ids.length <= 60) {
    const cards: BuilderCard[] = [];

    ids.forEach((cardId, index) => {
      // 标准化卡牌 ID（去掉稀有度后缀用于查找）
      let normalizedId = cardId;
      const rarityMatch = cardId.match(/^(.+)-([A-Z0-9]+)$/);
      if (rarityMatch) {
        // 尝试带稀有度的完整 ID
        if (CARD_DATABASE[cardId]) {
          normalizedId = cardId;
        } else {
          // 尝试不带稀有度的 ID
          normalizedId = rarityMatch[1];
        }
      }

      // 从数据库获取卡牌信息
      const dbCard = CARD_DATABASE[normalizedId];
      if (dbCard) {
        cards.push({
          id: `${cardId}_${index + 1}`,
          name: dbCard.name,
          type: dbCard.type,
          cost: dbCard.cost,
          keyword: dbCard.keyword || '',
          ability: dbCard.ability || '',
          img: dbCard.img || '',
          attack: dbCard.attack,
          health: dbCard.health
        });
      } else {
        // 数据库中没有的卡牌，使用默认值
        console.warn('[游戏] 未知卡牌:', cardId);
        cards.push({
          id: `${cardId}_${index + 1}`,
          name: cardId,
          type: guessCardType(cardId),
          cost: 0,
          keyword: '',
          ability: '',
          img: getCardImage(cardId),
          attack: undefined,
          health: undefined
        });
      }
    });

    console.log('[游戏] 解码长码成功:', ids.length, '张卡牌');
    return cards.length > 0 ? cards : null;
  }
  return null;
}

/** 根据卡牌 ID 猜测类型 */
function guessCardType(cardId: string): string {
  if (cardId.includes('-AWK') || cardId.includes('觉醒')) return 'awaken';
  // 简化：根据前缀判断
  if (cardId.startsWith('AYK') || cardId.startsWith('BPP')) return 'shikigami';
  return 'shikigami';
}

/** 根据卡牌 ID 获取图片 URL */
function getCardImage(cardId: string): string {
  // 简化：根据 ID 构造图片 URL
  const prefix = cardId.substring(0, 3).toLowerCase();
  const num = cardId.substring(3, 6);
  return `https://fishcrashers.oss-cn-chengdu.aliyuncs.com/YYSTCG/CARD/${prefix}_${num}.webp`;
}

/** 映射组卡器的卡牌类型到游戏类型 */
function mapCardType(type: string): string {
  const typeMap: Record<string, string> = {
    '式神': 'shikigami',
    '觉醒': 'awaken',
    '附灵': 'attach',
    '法术': 'spell',
    '结界': 'barrier'
  };
  return typeMap[type] || type;
}

export default App;
