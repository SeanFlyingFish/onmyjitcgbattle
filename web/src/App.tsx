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
type ShikigamiTokenKind = "attack_plus" | "attack_minus" | "health_plus" | "health_minus" | "damage" | "energy" | "barrier" | "stun" | "silence" | "poison" | "weaken" | "confusion";

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
  /** 沉默标记 */
  silenceMarkers: number;
  /** 毒伤标记 */
  poisonMarkers: number;
  /** 虚弱标记 */
  weakenMarkers: number;
  /** 混乱标记 */
  confusionMarkers: number;
  /** 自定义万能标记 { name: count } */
  customMarkers?: Record<string, number>;
  /** 潜行状态 */
  stealth: boolean;
  /** 附着在该式神下方的觉醒牌 */
  awakenCards?: Card[];
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
  ghostFireCoins?: number;
  fortuneFireCount?: number;
};

type MatchState = {
  roomId: string;
  phase: "mulligan" | "playing";
  turn: number;
  currentPlayerId: string;
  players: Record<string, PlayerState>;
  winnerId?: string;
  firstPlayerId: string;
  mulliganSubmitted?: Record<string, boolean>;
};

type ServerEvent =
  | { type: "room_created"; payload: { roomId: string; playerId: string; reconnectToken: string } }
  | { type: "room_joined"; payload: { roomId: string; playerId: string; reconnectToken: string; players: PlayerState[] } }
  | { type: "match_started"; payload: MatchState }
  | { type: "match_state"; payload: MatchState }
  | { type: "reconnect_success"; payload: { playerId: string; matchState?: MatchState } }
  | { type: "reconnect_failed"; payload: { message: string } }
  | { type: "player_disconnected"; payload: { playerId: string } }
  | { type: "player_reconnected"; payload: { playerId: string } }
  | { type: "left_room"; payload: { playerId: string } }
  | { type: "rematch_started"; payload: MatchState }
  | { type: "error"; payload: { message: string } }
  | { type: "chat"; payload: { playerId: string; playerName: string; message: string } }
  | { type: "register_success"; payload: { playerId: string; name: string } }
  | { type: "login_success"; payload: { playerId: string; name: string } }
  | { type: "auth_error"; payload: { message: string } };

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

const TOKEN_STRIP: { kind: ShikigamiTokenKind; label: string; hint: string; emoji: string; color: string }[] = [
  { kind: "attack_plus",  label: "+攻", hint: "攻击 +1",   emoji: "⚔️", color: "#f97316" },
  { kind: "attack_minus", label: "-攻", hint: "攻击 -1",   emoji: "⚔️", color: "#64748b" },
  { kind: "health_plus",  label: "+命", hint: "生命 +1",   emoji: "💚", color: "#22c55e" },
  { kind: "health_minus", label: "-命", hint: "生命 -1",   emoji: "💔", color: "#a855f7" },
  { kind: "damage",       label: "伤",  hint: "伤害 1",    emoji: "🩸", color: "#ef4444" },
  { kind: "energy",       label: "能",  hint: "能量 +1",   emoji: "⚡", color: "#3b82f6" },
  { kind: "barrier",      label: "障",  hint: "屏障 +1",   emoji: "🛡️", color: "#94a3b8" },
  { kind: "stun",         label: "晕",  hint: "眩晕",      emoji: "💫", color: "#a78bfa" },
  { kind: "silence",      label: "默",  hint: "沉默",      emoji: "🚫", color: "#475569" },
  { kind: "poison",       label: "毒",  hint: "毒伤",      emoji: "☠️", color: "#84cc16" },
  { kind: "weaken",       label: "弱",  hint: "虚弱",      emoji: "💤", color: "#f59e0b" },
  { kind: "confusion",    label: "乱",  hint: "混乱",      emoji: "👹", color: "#e879f9" },
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
  // card.attack 已含 awaken 加攻，attackModifier 是 ±攻 标记（后端不合并到 card.attack）
  return Math.max(0, (slot.card.attack ?? 0) + (slot.attackModifier ?? 0));
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
  onTokenBadgeClick,
  onCustomTokenBadgeClick,
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
  /** 点击圆形标记的回调（固定标记传 kind，自定义标记传 customName） */
  onTokenBadgeClick?: (kind: ShikigamiTokenKind) => void;
  onCustomTokenBadgeClick?: (customName: string) => void;
}) {
  const atk = effectiveAttackValue(slot);
  // card.health 已含 awaken 加血 + healthModifier + damageMarkers扣血（后端已合并计算），直接使用
  const hp = Math.max(1, slot.card.health ?? 0);
  const energy = slot.energyMarkers ?? 0;
  const stealthed = slot.stealth;
  const showBack = isHidden && stealthed;

  // 收集所有活跃标记，供圆形徽章展示
  const activeTokens: { kind: ShikigamiTokenKind; count: number; emoji: string; color: string }[] = [];
  TOKEN_STRIP.forEach(t => {
    let count = 0;
    switch (t.kind) {
      case "attack_plus":  count = Math.max(0,  slot.attackModifier ?? 0); break;
      case "attack_minus": count = Math.max(0, -(slot.attackModifier ?? 0)); break;
      case "health_plus":  count = Math.max(0,  slot.healthModifier ?? 0); break;
      case "health_minus": count = Math.max(0, -(slot.healthModifier ?? 0)); break;
      case "damage":       count = slot.damageMarkers ?? 0; break;
      case "energy":       count = energy; break;
      case "barrier":      count = slot.barrierMarkers ?? 0; break;
      case "stun":         count = slot.stunMarkers ?? 0; break;
      case "silence":      count = slot.silenceMarkers ?? 0; break;
      case "poison":       count = slot.poisonMarkers ?? 0; break;
      case "weaken":       count = slot.weakenMarkers ?? 0; break;
      case "confusion":    count = slot.confusionMarkers ?? 0; break;
    }
    if (count > 0) activeTokens.push({ kind: t.kind, count, emoji: t.emoji, color: t.color });
  });

  // 收集自定义标记
  const customTokenEntries: [string, number][] = Object.entries(slot.customMarkers ?? {}).filter(([, c]) => c > 0);

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
        {/* 圆形标记徽章 - 覆盖在卡面上 */}
        {!showBack && (activeTokens.length > 0 || customTokenEntries.length > 0) && (
          <div className="token-overlay">
            {activeTokens.map(({ kind, count, emoji, color }) => (
              <div
                key={kind}
                className={`token-overlay-badge${onTokenBadgeClick ? " token-overlay-badge--clickable" : ""}`}
                style={{ background: `${color}22`, borderColor: color, color }}
                title={`${TOKEN_STRIP.find(t => t.kind === kind)?.hint} ×${count}（点击调整）`}
                onClick={(e) => { e.stopPropagation(); onTokenBadgeClick?.(kind); }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span className="token-overlay-emoji">{emoji}</span>
                {count > 1 && <span className="token-overlay-count">{count}</span>}
              </div>
            ))}
            {customTokenEntries.map(([name, count]) => (
              <div
                key={`custom-${name}`}
                className={`token-overlay-badge${onCustomTokenBadgeClick ? " token-overlay-badge--clickable" : ""}`}
                style={{ background: "rgba(56,189,248,0.13)", borderColor: "#38bdf8", color: "#38bdf8" }}
                title={`${name} ×${count}（点击调整）`}
                onClick={(e) => { e.stopPropagation(); onCustomTokenBadgeClick?.(name); }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span className="token-overlay-emoji">🏷️</span>
                {count > 1 && <span className="token-overlay-count">{count}</span>}
              </div>
            ))}
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
  expandedKind,
  expandedCustomName,
  onAddToken,
  onRemoveToken,
  onAddCustomToken,
  onRemoveCustomToken,
}: {
  slot: ShikigamiZoneCard;
  interactive: boolean;
  /** 当前展开的固定标记类型 */
  expandedKind: ShikigamiTokenKind | null;
  /** 当前展开的自定义标记名称 */
  expandedCustomName: string | null;
  onAddToken?: (kind: ShikigamiTokenKind) => void;
  onRemoveToken?: (kind: ShikigamiTokenKind) => void;
  onAddCustomToken?: (name: string) => void;
  onRemoveCustomToken?: (name: string) => void;
}) {
  const stop = (e: MouseEvent) => e.stopPropagation();

  const am = slot.attackModifier ?? 0;
  const hm = slot.healthModifier ?? 0;
  const dm = slot.damageMarkers ?? 0;
  const barrier = slot.barrierMarkers ?? 0;
  const stun = slot.stunMarkers ?? 0;
  const silence = slot.silenceMarkers ?? 0;
  const poison = slot.poisonMarkers ?? 0;
  const weaken = slot.weakenMarkers ?? 0;
  const energy = slot.energyMarkers ?? 0;
  const confusion = slot.confusionMarkers ?? 0;

  type TokenItem = { count: number; kind: ShikigamiTokenKind; icon: string; color: string; title: string };
  const tokenConfig: TokenItem[] = [
    { count: energy, kind: "energy", icon: "⚡", color: "#60a5fa", title: "能量" },
    { count: barrier, kind: "barrier", icon: "🛡️", color: "#94a3b8", title: "屏障" },
    { count: stun, kind: "stun", icon: "💫", color: "#a78bfa", title: "眩晕" },
    { count: silence, kind: "silence", icon: "🚫", color: "#64748b", title: "沉默" },
    { count: poison, kind: "poison", icon: "☠️", color: "#84cc16", title: "毒伤" },
    { count: weaken, kind: "weaken", icon: "💤", color: "#f59e0b", title: "虚弱" },
    { count: confusion, kind: "confusion", icon: "👹", color: "#e879f9", title: "混乱" },
    { count: am > 0 ? am : 0, kind: "attack_plus", icon: "⚔️", color: "#fb923c", title: "+攻" },
    { count: am < 0 ? -am : 0, kind: "attack_minus", icon: "⚔️", color: "#94a3b8", title: "-攻" },
    { count: hm > 0 ? hm : 0, kind: "health_plus", icon: "💚", color: "#4ade80", title: "+命" },
    { count: hm < 0 ? -hm : 0, kind: "health_minus", icon: "💔", color: "#c084fc", title: "-命" },
    { count: dm, kind: "damage", icon: "🩸", color: "#f87171", title: "伤害" },
  ].filter(t => t.count > 0);

  // 收集自定义标记
  const customEntries = Object.entries(slot.customMarkers ?? {}).filter(([, c]) => c > 0);

  const hasAny = tokenConfig.length > 0 || customEntries.length > 0;
  if (!hasAny) return null;

  // 非交互模式：不显示下方控制区
  if (!interactive) return null;

  // 展开了固定标记：显示 emoji + 标签名 + [-] + 数量 + [+]
  if (expandedKind) {
    const t = tokenConfig.find(t => t.kind === expandedKind);
    if (!t) return null;
    return (
      <div className="unit-token-ctrl-row" onClick={stop} onMouseDown={(e) => e.stopPropagation()}>
        <span className="token-ctrl-label" style={{ color: t.color }}>
          <span className="token-ctrl-emoji">{t.icon}</span>
          <span className="token-ctrl-name">{t.title}</span>
        </span>
        <button type="button" className="token-ctrl-btn token-ctrl-btn--remove" onClick={(e) => { stop(e); onRemoveToken?.(t.kind); }} title={`减少${t.title}`}>−</button>
        <span className="token-ctrl-count" style={{ color: t.color }}>{t.count}</span>
        <button type="button" className="token-ctrl-btn token-ctrl-btn--add" onClick={(e) => { stop(e); onAddToken?.(t.kind); }} title={`增加${t.title}`}>+</button>
      </div>
    );
  }

  // 展开了自定义标记
  if (expandedCustomName) {
    const entry = customEntries.find(([name]) => name === expandedCustomName);
    if (!entry) return null;
    const [name, count] = entry;
    return (
      <div className="unit-token-ctrl-row" onClick={stop} onMouseDown={(e) => e.stopPropagation()}>
        <span className="token-ctrl-label" style={{ color: "#38bdf8" }}>
          <span className="token-ctrl-emoji">🏷️</span>
          <span className="token-ctrl-name">{name}</span>
        </span>
        <button type="button" className="token-ctrl-btn token-ctrl-btn--remove" onClick={(e) => { stop(e); onRemoveCustomToken?.(name); }} title={`减少${name}`}>−</button>
        <span className="token-ctrl-count" style={{ color: "#38bdf8" }}>{count}</span>
        <button type="button" className="token-ctrl-btn token-ctrl-btn--add" onClick={(e) => { stop(e); onAddCustomToken?.(name); }} title={`增加${name}`}>+</button>
      </div>
    );
  }

  return null;
}

function App() {
  // 优先使用构建时注入的环境变量 VITE_WS_URL，否则根据当前页面域名自动生成
  const envWsUrl = typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_WS_URL;
  const defaultUrl = envWsUrl || (() => {
    const wsProtocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
    // 如果是 Vite 开发服务器(5173/5174)，默认使用 8080 端口（游戏服务器端口）
    let wsHost = typeof window !== "undefined" ? window.location.host : "localhost:8080";
    if (typeof window !== "undefined") {
      const port = window.location.port;
      if (port === "5173" || port === "5174") {
        wsHost = window.location.hostname + ":8080";
      }
    }
    return `${wsProtocol}//${wsHost}`;
  })();
  const [serverUrl, setServerUrl] = useState(defaultUrl);
  // 从 localStorage 读取用户名（仅用于预填充表单，不自动登录）
  const savedName = localStorage.getItem("onmyoji_tcg_username") || "";
  const [name, setName] = useState(savedName);
  const [roomIdInput, setRoomIdInput] = useState("");
  // ── 认证状态 ──
  // 默认未登录 - 每次打开页面都显示登录表单
  // 登录成功后设为 true，页面刷新后需要重新登录
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [authError, setAuthError] = useState("");
  // ── 组卡器 ──
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
        // 持久化重连信息到 localStorage（以用户名为 key 区分同电脑多玩家）
        const reconnectKey = `onmyoji_tcg_reconnect_${name}`;
        localStorage.setItem(reconnectKey, JSON.stringify({
          roomId: msg.payload.roomId,
          playerId: msg.payload.playerId,
          reconnectToken: msg.payload.reconnectToken,
          name
        }));
        appendLog(`🏠 房间已创建：${msg.payload.roomId}`);
      } else if (msg.type === "room_joined") {
        setRoomId(msg.payload.roomId);
        setPlayerId((prev) => prev || msg.payload.playerId);
        const reconnectKey = `onmyoji_tcg_reconnect_${name}`;
        localStorage.setItem(reconnectKey, JSON.stringify({
          roomId: msg.payload.roomId,
          playerId: msg.payload.playerId,
          reconnectToken: msg.payload.reconnectToken,
          name
        }));
        appendLog(`🚪 已加入房间：${msg.payload.roomId}`);
      } else if (msg.type === "match_started" || msg.type === "match_state" || msg.type === "rematch_started") {
        setMatchState(msg.payload);
        setGameOverDismissed(false);
        if (msg.type === "match_started") appendLog("🎮 对局开始！");
        if (msg.type === "rematch_started") appendLog("🔄 对局重新开始！");
      } else if (msg.type === "reconnect_success") {
        setPlayerId(msg.payload.playerId);
        // 恢复 roomId（从 matchState 中获取）
        if (msg.payload.matchState) {
          setMatchState(msg.payload.matchState);
          setRoomId(msg.payload.matchState.roomId);
        } else {
          // 如果没有 matchState，尝试从 localStorage 恢复 roomId
          const saved = localStorage.getItem("onmyoji_tcg_reconnect");
          if (saved) {
            try {
              const data = JSON.parse(saved);
              if (data.roomId) setRoomId(data.roomId);
            } catch {}
          }
        }
        appendLog("✅ 重连成功！");
      } else if (msg.type === "reconnect_failed") {
        // 清除当前用户对应的重连信息
        const username = name || localStorage.getItem("onmyoji_tcg_username") || "";
        const reconnectKey = username ? `onmyoji_tcg_reconnect_${username}` : "onmyoji_tcg_reconnect";
        localStorage.removeItem(reconnectKey);
        appendLog(`❌ 重连失败：${msg.payload.message}`);
      } else if (msg.type === "player_disconnected") {
        appendLog("⚠️ 对手已断线");
      } else if (msg.type === "player_reconnected") {
        appendLog("✅ 对手已重连");
      } else if (msg.type === "left_room") {
        appendLog("🚪 玩家离开了房间");
      } else if (msg.type === "error") {
        appendLog(`❌ 错误：${msg.payload.message}`);
      } else if (msg.type === "chat") {
        if (msg.payload.playerId === "system") {
          appendLog(`📢 ${msg.payload.message}`);
        } else {
          appendLog(`💬 ${msg.payload.playerName}：${msg.payload.message}`);
        }
      } else if (msg.type === "login_success") {
        setIsLoggedIn(true);
        setName(msg.payload.name);
        setPlayerId(msg.payload.playerId);
        localStorage.setItem("onmyoji_tcg_username", msg.payload.name);
        setAuthError("");
        appendLog(`🔑 登录成功：${msg.payload.name}`);
        // 执行登录回调（如果有）
        const cb = (socket as any)?._loginCallback;
        if (cb) { cb(socket); delete (socket as any)._loginCallback; }
      } else if (msg.type === "register_success") {
        appendLog(`📝 注册成功：${msg.payload.name}，请登录`);
        setName(msg.payload.name);
        setRegisterPassword("");
      } else if (msg.type === "auth_error") {
        setAuthError(msg.payload.message);
        appendLog(`❌ ${msg.payload.message}`);
        const cb = (socket as any)?._loginCallback;
        if (cb) { delete (socket as any)._loginCallback; }
      } else {
        appendLog(`📨 事件：${(msg as { type: string }).type}`);
      }
    };
    setSocket(socket);
  }, [socket, name]);

  const [hoveredHandCardId, setHoveredHandCardId] = useState<string | null>(null);
  /** 通用卡牌悬停状态（用于棋盘上所有区域的卡牌） */
  const [hoveredBoardCardId, setHoveredBoardCardId] = useState<string | null>(null);
  const [hoveredBoardCardData, setHoveredBoardCardData] = useState<Card | null>(null);
/** 悬浮的式神槽位（含觉醒牌信息，用于 tooltip 增强展示） */
const [hoveredShikigamiSlot, setHoveredShikigamiSlot] = useState<ShikigamiZoneCard | null>(null);
/** 标记展开状态：点击圆形标记时展开对应标记的加减面板 */
const [expandedToken, setExpandedToken] = useState<{ slotCardId: string; kind: ShikigamiTokenKind } | { slotCardId: string; customName: string } | null>(null);
/** 万能标记弹窗状态 */
const [customTokenPrompt, setCustomTokenPrompt] = useState<{ playerId: string; slotIndex: number } | null>(null);
const [customTokenNameInput, setCustomTokenNameInput] = useState("");
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
  /**
   * 查看全部牌时的本地 buffer 副本。
   * 当 deckCount === 0（全部牌在 buffer 中）时，置顶/置底只改变此本地顺序，不发送后端消息。
   * 关闭弹窗时通过 deck_search_reorder 同步到后端。
   */
  const [localDeckViewBuffer, setLocalDeckViewBuffer] = useState<Card[]>([]);
  /** 关闭查看弹窗：若已确认查看则将 buffer 牌放回牌库顶（不洗） */
  function closeDeckView() {
    if (deckViewConfirmed) {
      // 如果有本地重排的 buffer，先同步到后端
      if (localDeckViewBuffer.length > 0) {
        send({ type: "deck_search_reorder", payload: { roomId, orderedIds: localDeckViewBuffer.map((c) => c.id) } });
      }
      send({ type: "deck_search_return", payload: { roomId } });
    }
    setDeckViewModalOpen(false);
    setDeckViewConfirmed(false);
    setDeckViewSelectedIds([]);
    setLocalDeckViewBuffer([]);
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
  /** 召唤物弹窗是否打开 */
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  /** 召唤物弹窗中选中的卡牌 ID */
  const [tokenSelectedIds, setTokenSelectedIds] = useState<string[]>([]);
  /** 聊天输入 */
  const [chatInput, setChatInput] = useState("");

  const self = useMemo(() => {
    if (!matchState || !playerId) return null;
    return matchState.players[playerId] ?? null;
  }, [matchState, playerId]);

  const enemyId = useMemo(() => {
    if (!matchState || !playerId) return null;
    return Object.keys(matchState.players).find((id) => id !== playerId) ?? null;
  }, [matchState, playerId]);

  const enemy = useMemo(() => {
    if (!matchState || !enemyId) return null;
    return matchState.players[enemyId];
  }, [matchState, enemyId]);

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

  // 鼠标按下时隐藏悬浮预览并收起标记面板
  useEffect(() => {
    const hide = () => {
      setHoveredHandCardId(null);
      setHoveredBoardCardId(null);
      setHoveredBoardCardData(null);
      setHoveredShikigamiSlot(null);
      setExpandedToken(null);
    };
    window.addEventListener("mousedown", hide);
    return () => window.removeEventListener("mousedown", hide);
  }, []);

  // 游戏开始时提示先手玩家
  useEffect(() => {
    if (!matchState || !playerId) return;
    const myName = matchState.players[playerId]?.name ?? "你";
    const isFirst = matchState.firstPlayerId === playerId;
    const firstPlayerName = matchState.players[matchState.firstPlayerId]?.name ?? "某玩家";
    const msg = isFirst
      ? `🎯 先手！你（${myName}）先出牌！`
      : `🎯 后手！${firstPlayerName} 先出牌，你获得 1 枚鬼火硬币。`;
    setLogs((prev) => [msg, ...prev].slice(0, 30));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(matchState && playerId)]);

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
      stunMarkers: entry.stunMarkers ?? 0,
      silenceMarkers: entry.silenceMarkers ?? 0,
      poisonMarkers: entry.poisonMarkers ?? 0,
      weakenMarkers: entry.weakenMarkers ?? 0,
      confusionMarkers: entry.confusionMarkers ?? 0,
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
      deckPeekBuffer: player.deckPeekBuffer ?? [],
      ghostFireCoins: player.ghostFireCoins ?? 0,
      fortuneFireCount: player.fortuneFireCount ?? 0
    };
  }

  const selfView = withDefaultZones(self);
  const enemyView = withDefaultZones(enemy);

  const gameOver = Boolean(matchState?.winnerId);
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
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
    ws.onclose = () => {
      appendLog("🔌 连接已断开");
      // 连接断开时不重置登录状态（断线重连不依赖登录）
    };
    ws.onerror = () => appendLog("❌ 连接异常");
    // onmessage 由 useEffect 处理
    setSocket(ws);
  }

  /** 发送登录请求 */
  function doLogin(username: string, password: string, callback?: (ws: WebSocket) => void) {
    setAuthError("");
    const payload = { type: "login", payload: { name: username, password } };
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      // 暂存回调
      (socket as any)._loginCallback = callback;
      return;
    }
    connect((ws) => {
      ws.send(JSON.stringify(payload));
      (ws as any)._loginCallback = callback;
    });
  }

  /** 发送注册请求 */
  function doRegister(username: string, password: string) {
    setAuthError("");
    const payload = { type: "register", payload: { name: username, password } };
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return;
    }
    connect((ws) => {
      ws.send(JSON.stringify(payload));
    });
  }

  /** 登出 */
  function doLogout() {
    setIsLoggedIn(false);
    setName("玩家");
    setPlayerId("");
    setRoomId("");
    setMatchState(null);
    localStorage.removeItem("onmyoji_tcg_username");
    localStorage.removeItem("onmyoji_tcg_reconnect");
    setLoginPassword("");
    setRegisterPassword("");
    appendLog("🔓 已登出");
  }

  /** 页面加载时检查 localStorage，尝试自动重连 */
  useEffect(() => {
    try {
      // 使用当前保存的用户名查找对应的重连信息（以用户名为 key 区分同电脑多玩家）
      const username = localStorage.getItem("onmyoji_tcg_username") || "";
      const reconnectKey = username ? `onmyoji_tcg_reconnect_${username}` : "onmyoji_tcg_reconnect";
      const saved = localStorage.getItem(reconnectKey);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.roomId && data.reconnectToken && data.name) {
          // 恢复 roomId（用于UI状态）
          setRoomId(data.roomId);
          setName(data.name);
          setIsLoggedIn(true);
          appendLog("🔄 检测到未结束的对局，正在重连...");
          connect((ws) => {
            ws.send(JSON.stringify({
              type: "reconnect",
              payload: { roomId: data.roomId, reconnectToken: data.reconnectToken, playerId: data.playerId }
            }));
          });
        }
      }
    } catch {
      // localStorage 不可用或数据损坏，忽略
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 主动离开房间 */
  function leaveRoom() {
    send({ type: "leave_room", payload: { roomId } });
    setRoomId("");
    setMatchState(null);
    // 清除当前用户对应的重连信息
    const username = name || localStorage.getItem("onmyoji_tcg_username") || "";
    const reconnectKey = username ? `onmyoji_tcg_reconnect_${username}` : "onmyoji_tcg_reconnect";
    localStorage.removeItem(reconnectKey);
  }

  function quickCreateRoom() {
    const payload = { type: "create_room", payload: { name } };
    if (socket && socket.readyState === WebSocket.OPEN) {
      send(payload);
      return;
    }
    connect((ws) => ws.send(JSON.stringify(payload)));
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

  /** 将觉醒牌从手牌或符咒区附着到目标式神下方 */
  function attachAwakenToShikigami(awakenCardId: string, from: "hand" | "spell", targetPlayerId: string, slotIndex: number) {
    send({ type: "attach_awaken", payload: { roomId, awakenCardId, from, targetPlayerId, slotIndex } });
  }

  /** 从式神下方取下觉醒牌（回手牌） */
  function detachAwakenFromShikigami(targetPlayerId: string, slotIndex: number, awakenCardId: string) {
    send({ type: "detach_awaken", payload: { roomId, targetPlayerId, slotIndex, awakenCardId } });
  }

  /**
   * 获取觉醒牌 alias（即其对应的式神名称）。
   * 优先从卡牌数据库查找；无数据库记录时尝试从名称提取（如"觉醒·座敷童子" → "座敷童子"）。
   */
  function getAwakenAlias(card: Card): string {
    // 从 CARD_DATABASE 查找
    const dbEntry = Object.values(CARD_DATABASE).find(e => e.id === card.id);
    if (dbEntry?.alias) return dbEntry.alias as string;
    // fallback：去掉"觉醒·"前缀
    if (card.name.startsWith("觉醒·")) return card.name.slice(3);
    return card.name;
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

  function adjustPlayerPoisonByDelta(delta: number) {
    send({ type: "adjust_player_poison", payload: { roomId, delta } });
  }

  function adjustPlayerDamageByDelta(delta: number) {
    send({ type: "adjust_player_damage", payload: { roomId, delta } });
  }

  function adjustGhostFireBy(delta: number) {
    if (!roomId) return;
    send({ type: "adjust_ghost_fire", payload: { roomId, delta } });
  }

  function adjustFortuneFireBy(delta: number) {
    if (!roomId) return;
    send({ type: "adjust_fortune_fire", payload: { roomId, delta } });
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
          <h1 className="app-title">⚔ 阴阳师TCG</h1>
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
              {/* 连接 + 认证区 */}
              <div className="lobby-block">
                <h3 className="lobby-block-title">账号 &amp; 连接</h3>

                {/* 服务器地址输入 */}
                <div className="form-row">
                  <label>服务器地址</label>
                  <input
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="ws://localhost:8080"
                    disabled={isConnected}
                  />
                </div>

                {isLoggedIn ? (
                  <>
                    <div className="auth-status">
                      <span className="auth-user-badge">👤 {name}</span>
                      <button className="btn-logout" onClick={doLogout}>登出</button>
                    </div>
                    <button className="btn-primary" onClick={() => connect()}>
                      {isConnected ? "✅ 已连接" : "连接服务器"}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="form-row">
                      <label>用户名</label>
                      <input
                        value={name}
                        onChange={(e) => { setName(e.target.value); setAuthError(""); }}
                        placeholder="输入用户名"
                      />
                    </div>
                    <div className="form-row">
                      <label>密码</label>
                      <input
                        type="password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && doLogin(name, loginPassword)}
                        placeholder="输入密码"
                      />
                    </div>
                    <div className="auth-buttons">
                      <button className="btn-primary" onClick={() => doLogin(name, loginPassword)}>
                        🔑 登录
                      </button>
                      <button className="btn-secondary" onClick={() => doRegister(name, loginPassword)}>
                        📝 注册
                      </button>
                    </div>
                    {authError && <div className="auth-error">{authError}</div>}
                  </>
                )}

                <div style={{ marginTop: "8px" }}>
                  <button className="btn-import-deck" onClick={() => setImportModalOpen(true)}>
                    📋 {builderDeck ? `已导入 ${builderDeck.length} 张` : "导入卡组"}
                  </button>
                  {builderDeck && (
                    <button className="btn-clear-deck" onClick={() => setBuilderDeck(null)} style={{ marginLeft: "4px" }}>
                      ❌ 清除卡组
                    </button>
                  )}
                </div>
              </div>

              {/* 房间区 — 仅登录后显示 */}
              {isLoggedIn && (
                <div className="lobby-block">
                  <h3 className="lobby-block-title">房间操作</h3>
                  <div className="room-actions">
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
                      disabled={!roomId || gameOver}
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
                    {roomId && !gameOver && !matchState && (
                      <button onClick={leaveRoom}>🚪 退出房间</button>
                    )}
                    {gameOver && (
                      <button
                        className="btn-start"
                        onClick={() => send({ type: "rematch", payload: { roomId } })}
                      >
                        🔄 重开对局 {builderDeck ? `（${builderDeck.length}张）` : "（默认牌组）"}
                      </button>
                    )}
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
              )}
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
              战场主体（不再有左侧面板，仅一列）
              ============================================================ */}
          <div className="battlefield-wrapper">

            {/* ── 右侧棋盘（战场.html的grid布局） ── */}
            <div className="battlefield-right">

              {/* 上方玩家区（敌方） */}
              <div className="player-area" style={{ border: '2px solid #ef4444' }}>
                {/* 毒伤/伤害胶囊（生命框外上方，只读） */}
                <div className="life-zone">
                  <div className="player-stats-above">
                    <div className="stat-capsule stat-capsule--poison">
                      <span className="stat-capsule-icon">☠️</span>
                      <span className="stat-capsule-value">{enemyView?.poisonMarkers ?? 0}</span>
                    </div>
                    <div className="stat-capsule stat-capsule--damage">
                      <span className="stat-capsule-icon">🩸</span>
                      <span className="stat-capsule-value">{enemyView?.playerDamage ?? 0}</span>
                    </div>
                  </div>
                  <div className="life-area">
                    <div className="life-num">{enemyView?.hp ?? 30}</div>
                    <div className="life-btn">
                      <button type="button" disabled={!roomId || gameOver || !allowBoardDrag}
                        onClick={() => enemyId && send({ type: "adjust_player_hp", payload: { roomId, targetPlayerId: enemyId, delta: -1 } })}
                        title="敌方生命-1">-</button>
                      <button type="button" disabled={!roomId || gameOver || !allowBoardDrag}
                        onClick={() => enemyId && send({ type: "adjust_player_hp", payload: { roomId, targetPlayerId: enemyId, delta: 1 } })}
                        title="敌方生命+1">+</button>
                    </div>
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
                  {/* 左上角：符咒区卡牌数量 */}
                  <span className="spell-count-badge">{enemyView?.spellZone.length ?? 0}</span>
                  {/* 右上角：鬼火数量（只读） */}
                  <div className="fortune-fire-panel fortune-fire-panel--enemy">
                    <span className="fortune-fire-icon">🔥</span>
                    <span className="fortune-fire-count">{enemyView?.fortuneFireCount ?? 0}</span>
                  </div>
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
                  {/* 鬼火硬币（敌方，只读） */}
                  <div className="ghost-fire-panel ghost-fire-panel--enemy">
                    <span className="ghost-fire-icon" title="鬼火硬币">🪙</span>
                    <span className="ghost-fire-count">{enemyView?.ghostFireCoins ?? 0}</span>
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
                          } else if (p?.kind === "card" && p.cardType === "awaken" && slot) {
                            // 觉醒牌拖到对方有式神的格子 → 附着（对方式神也可附觉醒）
                            const from = (p.from === "hand" || p.from === "spell") ? p.from : null;
                            if (from) attachAwakenToShikigami(p.cardId, from, enemyView.id, boardIndex);
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
                                onHoverEnter={() => { if (!slot.stealth) { setHoveredBoardCardId(slot.card.id); setHoveredBoardCardData(slot.card); setHoveredShikigamiSlot(slot); } }}
                                onHoverLeave={() => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); setHoveredShikigamiSlot(null); }}
                              />
                            </div>
                            {/* 对方觉醒牌徽章（只读展示） */}
                            {!slot.stealth && slot.awakenCards && slot.awakenCards.length > 0 && (
                              <div className="awaken-badge-row awaken-badge-row--enemy">
                                {slot.awakenCards.map((ac) => (
                                  <div key={ac.id} className="awaken-badge" title={ac.name}>
                                    <img src={ac.img || CARD_IMAGE_URL} alt={ac.name} className="awaken-badge-img" />
                                  </div>
                                ))}
                              </div>
                            )}
                            {!slot.stealth && <ShikigamiTokenBelt slot={slot} interactive={false} expandedKind={null} />}
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
                            onDragStart={(e) => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); setDragPayload(e, selfView!.barrier!.id, "barrier", "barrier"); }}
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
                          // 检查是否是万能标记拖入
                          const raw = event.dataTransfer.getData("application/json");
                          if (raw) {
                            try {
                              const o = JSON.parse(raw) as Record<string, unknown>;
                              if (o.dragType === "custom_token") {
                                // 弹出自定义名称输入框
                                setCustomTokenPrompt({ playerId, slotIndex: renderIndex });
                                setCustomTokenNameInput("");
                                setDragOverSlot(null);
                                return;
                              }
                            } catch { /* not custom token */ }
                          }
                          const p = readBoardDragPayload(event);
                          if (!p) { setDragOverSlot(null); return; }
                          if (p.kind === "token") {
                            if (slot) placeTokenOnShikigami(playerId, renderIndex, p.tokenKind);
                          } else if (p.kind === "card" && p.cardType === "awaken" && slot) {
                            // 觉醒牌拖到有式神的格子 → 附着
                            const from = (p.from === "hand" || p.from === "spell") ? p.from : null;
                            if (from) attachAwakenToShikigami(p.cardId, from, playerId, renderIndex);
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
                              onMouseEnter={() => { setHoveredBoardCardId(slot.card.id); setHoveredBoardCardData(slot.card); setHoveredShikigamiSlot(slot); }}
                              onMouseLeave={() => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); setHoveredShikigamiSlot(null); }}
                            >
                              <ShikigamiCardFace
                                slot={slot}
                                interactive={!deckPlaceMode && !stealthMode}
                                allowBoardDrag={allowBoardDrag && !deckPlaceMode && !stealthMode}
                                isHidden={false}
                                onRevealStealth={() => toggleShikigamiStealth(slot.card.id, false)}
                                onCardDragStart={(e) => setDragPayload(e, slot.card.id, "shikigami", slot.card.type)}
                                onTokenBadgeClick={(kind) => {
                                  setExpandedToken(prev =>
                                    prev && prev.slotCardId === slot.card.id && 'kind' in prev && prev.kind === kind
                                      ? null
                                      : { slotCardId: slot.card.id, kind }
                                  );
                                }}
                                onCustomTokenBadgeClick={(customName) => {
                                  setExpandedToken(prev =>
                                    prev && prev.slotCardId === slot.card.id && 'customName' in prev && prev.customName === customName
                                      ? null
                                      : { slotCardId: slot.card.id, customName }
                                  );
                                }}
                              />
                            </div>
                            {/* 觉醒牌徽章列表 */}
                            {slot.awakenCards && slot.awakenCards.length > 0 && (
                              <div className="awaken-badge-row">
                                {slot.awakenCards.map((ac) => (
                                  <div
                                    key={ac.id}
                                    className="awaken-badge"
                                    title={`${ac.name}（点击取下）`}
                                    onClick={(e) => { e.stopPropagation(); if (playerId) detachAwakenFromShikigami(playerId, renderIndex, ac.id); }}
                                  >
                                    <img src={ac.img || CARD_IMAGE_URL} alt={ac.name} className="awaken-badge-img" />
                                  </div>
                                ))}
                              </div>
                            )}
                            <div onClick={(e) => e.stopPropagation()}>
                              <ShikigamiTokenBelt
                                slot={slot}
                                interactive={allowBoardDrag}
                                expandedKind={expandedToken?.slotCardId === slot.card.id && 'kind' in expandedToken ? expandedToken.kind : null}
                                expandedCustomName={expandedToken?.slotCardId === slot.card.id && 'customName' in expandedToken ? expandedToken.customName : null}
                                onAddToken={(kind) => placeTokenOnShikigami(playerId, renderIndex, kind)}
                                onRemoveToken={(kind) => removeTokenFromShikigami(playerId, renderIndex, kind)}
                                onAddCustomToken={(name) => {
                                  if (playerId && roomId) send({ type: "add_custom_marker_to_shikigami", payload: { roomId, targetPlayerId: playerId, slotIndex: renderIndex, markerName: name, delta: 1 } });
                                }}
                                onRemoveCustomToken={(name) => {
                                  if (playerId && roomId) send({ type: "add_custom_marker_to_shikigami", payload: { roomId, targetPlayerId: playerId, slotIndex: renderIndex, markerName: name, delta: -1 } });
                                }}
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
                            onDragStart={(ev) => { setHoveredBoardCardId(null); setHoveredBoardCardData(null); if (allowBoardDrag && !deckPlaceMode) setDragPayload(ev, entry.card.id, "extend", entry.card.type); }}
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
                  {/* 左上角：符咒区卡牌数量 */}
                  <span className="spell-count-badge">{selfView?.spellZone.length ?? 0}</span>
                  {/* 右上角：鬼火数量（可调整） */}
                  <div className="fortune-fire-panel">
                    <span className="fortune-fire-icon">🔥</span>
                    <span className="fortune-fire-count">{selfView?.fortuneFireCount ?? 0}</span>
                    <button
                      type="button"
                      className="fortune-fire-btn fortune-fire-btn--add"
                      onClick={() => adjustFortuneFireBy(1)}
                      title="增加鬼火数量"
                    >+</button>
                    <button
                      type="button"
                      className="fortune-fire-btn fortune-fire-btn--sub"
                      onClick={() => adjustFortuneFireBy(-1)}
                      title="减少鬼火数量"
                    >−</button>
                  </div>
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
                              // 拖拽开始时清除卡牌详情悬浮
                              setHoveredBoardCardId(null);
                              setHoveredBoardCardData(null);
                              if (entry.card.type === "spell") {
                                draggingSpellRef.current = entry.card;
                                draggingSpellFromRef.current = "spell";
                                spellDroppedOnZone.current = false;
                              }
                            }
                          }}
                          onDragEnd={() => {
                            // 拖拽结束后清除卡牌详情悬浮
                            setHoveredBoardCardId(null);
                            setHoveredBoardCardData(null);
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
                  {/* 鬼火硬币 — 符咒区右下角 */}
                  <div className="ghost-fire-panel">
                    <span className="ghost-fire-icon" title="鬼火硬币">🔥</span>
                    <span className="ghost-fire-count">{selfView?.ghostFireCoins ?? 0}</span>
                    <button
                      type="button"
                      className="ghost-fire-btn ghost-fire-btn--add"
                      onClick={() => adjustGhostFireBy(1)}
                      title="获得鬼火硬币"
                    >+</button>
                    <button
                      type="button"
                      className="ghost-fire-btn ghost-fire-btn--sub"
                      onClick={() => adjustGhostFireBy(-1)}
                      title="消耗鬼火硬币"
                    >−</button>
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

              <div className="player-area player-area--self" style={{ border: '2px solid #3b82f6' }}>
                {/* 毒伤/伤害胶囊（生命框外上方） */}
                <div className="life-zone">
                  <div className="player-stats-above">
                    <div className="stat-capsule stat-capsule--poison">
                      <span className="stat-capsule-icon">☠️</span>
                      <span className="stat-capsule-value">{selfView?.poisonMarkers ?? 0}</span>
                      <button type="button" disabled={!roomId || gameOver || !allowBoardDrag}
                        onClick={() => adjustPlayerPoisonByDelta(-1)} className="stat-capsule-btn">-</button>
                      <button type="button" disabled={!roomId || gameOver || !allowBoardDrag}
                        onClick={() => adjustPlayerPoisonByDelta(1)} className="stat-capsule-btn">+</button>
                    </div>
                    <div className="stat-capsule stat-capsule--damage">
                      <span className="stat-capsule-icon">🩸</span>
                      <span className="stat-capsule-value">{selfView?.playerDamage ?? 0}</span>
                      <button type="button" disabled={!roomId || gameOver || !allowBoardDrag}
                        onClick={() => adjustPlayerDamageByDelta(-1)} className="stat-capsule-btn">-</button>
                      <button type="button" disabled={!roomId || gameOver || !allowBoardDrag}
                        onClick={() => adjustPlayerDamageByDelta(1)} className="stat-capsule-btn">+</button>
                    </div>
                  </div>
                  <div className="life-area">
                    <div className="life-num self-life">{selfView?.hp ?? 30}</div>
                    <div className="life-btn">
                      <button type="button" disabled={!roomId || gameOver || !allowBoardDrag}
                        onClick={() => adjustSelfHpByDelta(-1)} title="己方生命-1">-</button>
                      <button type="button" disabled={!roomId || gameOver || !allowBoardDrag}
                        onClick={() => adjustSelfHpByDelta(1)} title="己方生命+1">+</button>
                    </div>
                  </div>
                </div>

                {/* 己方手牌 - 完全独立新结构 */}
                <div style={{
                  width: "780px",
                  height: "180px",
                  border: "2px dashed rgba(59,130,246,0.4)",
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
                    <button
                      type="button"
                      className="btn召唤物"
                      disabled={!roomId || gameOver}
                      onClick={() => { setTokenModalOpen(true); setTokenSelectedIds([]); }}
                      title="从召唤物库选择卡牌"
                      style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                    >
                      🐾 召唤物
                    </button>
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
                          disabled={!roomId || gameOver || (selfView?.deckCount ?? 0) === 0 || deckViewConfirmed}
                          onClick={() => send({ type: "deck_draw", payload: { roomId, count: 1 } })}
                          title={deckViewConfirmed ? "请先关闭牌库查看弹窗" : "从牌库抽1张"}
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
                          onDragEnd={() => { setDragOverSlot(null); setHoveredHandCardId(null); }}
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
                            // 移除了自动打出逻辑，仅支持拖拽出牌
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
                            background: "rgba(59, 130, 246, 0.75)",
                            borderRadius: "4px",
                            padding: "1px 3px",
                            lineHeight: "1.2",
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

              {/* ── 下方标记面板（水平） ── */}
              <div className="token-panel-bottom" aria-label="指示物池">
                {/* 回合标识 — 移至标记面板左侧 */}
                {matchState && (
                  <div className={`turn-badge ${isMyTurn && !isMulligan ? "is-my-turn" : ""}`}>
                    {isMulligan
                      ? "🔄 调度"
                      : isMyTurn
                      ? "✅ 我的回合"
                      : "⏳ 对手回合"}
                    <span className="turn-num">第 {matchState.turn} 回合</span>
                  </div>
                )}
                <button
                  type="button"
                  className="btn-运势"
                  disabled={!roomId || gameOver || isMulligan}
                  onClick={() => {
                    const dice = Math.floor(Math.random() * 6) + 1;
                    send({ type: "chat", payload: { roomId, message: `🎲 运势：【${dice}】点！` } });
                  }}
                  title="掷骰子"
                  style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                >
                  🎲 运势
                </button>
                <span className="token-panel-bottom-title">标记</span>
                {TOKEN_STRIP.map((t) => (
                  <div
                    key={t.kind}
                    className="token-chip-bottom"
                    style={{ borderColor: t.color, color: t.color, background: `${t.color}18` }}
                    draggable={allowBoardDrag}
                    onDragStart={(e) => { if (allowBoardDrag) setTokenDragPayload(e, t.kind); }}
                    title={t.hint}
                  >
                    <span className="token-chip-bottom-emoji">{t.emoji}</span>
                    <span className="token-chip-bottom-label">{t.label}</span>
                  </div>
                ))}
                {/* 万能标记 - 拖到式神上时弹出自定义名称输入框 */}
                <div
                  className="token-chip-bottom"
                  style={{ borderColor: "#38bdf8", color: "#38bdf8", background: "rgba(56,189,248,0.09)" }}
                  draggable={allowBoardDrag}
                  onDragStart={(e) => {
                    if (allowBoardDrag) {
                      e.dataTransfer.setData("application/json", JSON.stringify({ dragType: "custom_token" }));
                      e.dataTransfer.effectAllowed = "copy";
                    }
                  }}
                  title="万能标记（拖到式神上自定义名称）"
                >
                  <span className="token-chip-bottom-emoji">🏷️</span>
                  <span className="token-chip-bottom-label">万能</span>
                </div>
              </div>

            </div>{/* /battlefield-right */}
          </div>{/* /battlefield-wrapper */}

        </section>
      )}

      {/* ========== 聊天面板 ========== */}
      <div className="chat-panel" style={{
        display: "flex",
        gap: "8px",
        padding: "8px 12px",
        background: "rgba(0,0,0,0.3)",
        borderRadius: "8px",
        marginBottom: "8px"
      }}>
        <input
          type="text"
          placeholder="输入聊天内容..."
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && chatInput.trim()) {
              send({ type: "chat", payload: { roomId, message: chatInput.trim() } });
              setChatInput("");
            }
          }}
          style={{
            flex: 1,
            padding: "4px 8px",
            borderRadius: "4px",
            border: "1px solid #334155",
            background: "#1e293b",
            color: "#e2e8f0",
            fontSize: "0.8rem"
          }}
          disabled={!roomId}
        />
        <button
          type="button"
          onClick={() => {
            if (chatInput.trim()) {
              send({ type: "chat", payload: { roomId, message: chatInput.trim() } });
              setChatInput("");
            }
          }}
          disabled={!roomId || !chatInput.trim()}
          style={{
            padding: "4px 12px",
            borderRadius: "4px",
            border: "none",
            background: "#3b82f6",
            color: "white",
            fontSize: "0.8rem",
            cursor: "pointer"
          }}
        >
          发送
        </button>
      </div>

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

      {/* ========== 手牌悬浮预览 ========== */}
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

      {/* ========== 通用卡牌悬停预览（棋盘区域） ========== */}
      {hoveredBoardCardData && (
        <div className="card-preview">
          <img className="card-preview-art" src={hoveredBoardCardData.img || CARD_IMAGE_URL} alt={hoveredBoardCardData.name} />
          <div className="card-preview-info">
            <div className="card-preview-name">{hoveredBoardCardData.name}</div>
            <div className="card-preview-stats">
              <span className="preview-stat">费用 {hoveredBoardCardData.cost}</span>
              {hoveredBoardCardData.type === 'shikigami' && (() => {
                // 如果有觉醒加成，展示基础值 + 觉醒加成
                const slot = hoveredShikigamiSlot;
                const awakenBonusAtk = slot?.awakenCards?.reduce((s, c) => s + (c.attack ?? 0), 0) ?? 0;
                const awakenBonusHp = slot?.awakenCards?.reduce((s, c) => s + (c.health ?? 0), 0) ?? 0;
                return (
                  <>
                    <span className="preview-stat">
                      攻击 {hoveredBoardCardData.attack}
                      {awakenBonusAtk > 0 && <span className="preview-stat-awaken-bonus">(+{awakenBonusAtk})</span>}
                    </span>
                    <span className="preview-stat">
                      生命 {hoveredBoardCardData.health}
                      {awakenBonusHp > 0 && <span className="preview-stat-awaken-bonus">(+{awakenBonusHp})</span>}
                    </span>
                  </>
                );
              })()}
            </div>
            {hoveredBoardCardData.ability && (
              <div className="card-preview-ability">{hoveredBoardCardData.ability}</div>
            )}
            {/* 觉醒牌信息（虚线分隔） */}
            {hoveredShikigamiSlot?.awakenCards && hoveredShikigamiSlot.awakenCards.length > 0 && (
              <div className="card-preview-awaken-section">
                {hoveredShikigamiSlot.awakenCards.map((ac) => (
                  <div key={ac.id} className="card-preview-awaken-item">
                    <div className="card-preview-awaken-name">🌟 {ac.name}</div>
                    {(ac.attack > 0 || ac.health > 0) && (
                      <div className="card-preview-awaken-stats">
                        {ac.attack > 0 && <span className="preview-stat preview-stat--awaken">+{ac.attack}攻</span>}
                        {ac.health > 0 && <span className="preview-stat preview-stat--awaken">+{ac.health}命</span>}
                      </div>
                    )}
                    {ac.ability && (
                      <div className="card-preview-awaken-ability">{ac.ability}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* 标记信息 */}
            {hoveredShikigamiSlot && (() => {
              const s = hoveredShikigamiSlot;
              const markers: { icon: string; color: string; label: string; count: number }[] = [];
              if ((s.energyMarkers ?? 0) > 0) markers.push({ icon: "⚡", color: "#60a5fa", label: "能量", count: s.energyMarkers! });
              if ((s.barrierMarkers ?? 0) > 0) markers.push({ icon: "🛡️", color: "#94a3b8", label: "屏障", count: s.barrierMarkers! });
              if ((s.stunMarkers ?? 0) > 0) markers.push({ icon: "💫", color: "#a78bfa", label: "眩晕", count: s.stunMarkers! });
              if ((s.silenceMarkers ?? 0) > 0) markers.push({ icon: "🚫", color: "#64748b", label: "沉默", count: s.silenceMarkers! });
              if ((s.poisonMarkers ?? 0) > 0) markers.push({ icon: "☠️", color: "#84cc16", label: "毒伤", count: s.poisonMarkers! });
              if ((s.weakenMarkers ?? 0) > 0) markers.push({ icon: "💤", color: "#f59e0b", label: "虚弱", count: s.weakenMarkers! });
              if ((s.confusionMarkers ?? 0) > 0) markers.push({ icon: "👹", color: "#e879f9", label: "混乱", count: s.confusionMarkers! });
              const am = s.attackModifier ?? 0;
              const hm = s.healthModifier ?? 0;
              if (am > 0) markers.push({ icon: "⚔️", color: "#fb923c", label: "+攻", count: am });
              if (am < 0) markers.push({ icon: "⚔️", color: "#94a3b8", label: "-攻", count: -am });
              if (hm > 0) markers.push({ icon: "💚", color: "#4ade80", label: "+命", count: hm });
              if (hm < 0) markers.push({ icon: "💔", color: "#c084fc", label: "-命", count: -hm });
              if ((s.damageMarkers ?? 0) > 0) markers.push({ icon: "🩸", color: "#f87171", label: "伤害", count: s.damageMarkers! });
              // 自定义标记
              const customEntries = Object.entries(s.customMarkers ?? {}).filter(([, c]) => c > 0);
              for (const [name, count] of customEntries) {
                markers.push({ icon: "🏷️", color: "#38bdf8", label: name, count });
              }
              if (markers.length === 0) return null;
              return (
                <div className="card-preview-markers">
                  <div className="card-preview-markers-title">标记</div>
                  <div className="card-preview-markers-list">
                    {markers.map(m => (
                      <span key={m.label} className="card-preview-marker-chip" style={{ color: m.color, borderColor: m.color }}>
                        <span>{m.icon}</span>
                        <span>{m.label}</span>
                        <span style={{ fontWeight: 700 }}>×{m.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ========== 游戏结束遮罩 ========== */}
      {matchState?.winnerId && !gameOverDismissed ? (
        <div className="game-over-overlay" role="alertdialog" aria-live="assertive" aria-label="对局结束" onClick={() => setGameOverDismissed(true)}>
          <div className="game-over-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="game-over-title">对局结束</h3>
            <p className="game-over-body">
              胜者：<strong>{matchState.players[matchState.winnerId]?.name ?? matchState.winnerId}</strong>
            </p>
            {matchState.winnerId === playerId ? (
              <p className="game-over-sub game-over-win">🏆 你获得了胜利！</p>
            ) : (
              <p className="game-over-sub game-over-lose">💀 对方获胜。</p>
            )}
            <p className="game-over-hint">点击任意处关闭</p>
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
                      const total = selfView?.deckCount ?? 0;
                      const count = deckViewInput ? Math.min(Number(deckViewInput), total) : total;
                      if (count === 0) return;
                      send({ type: "deck_search", payload: { roomId, count } });
                      setDeckViewConfirmed(true);
                      setDeckViewSelectedIds([]);
                      // 查看全部牌时，初始化本地 buffer（用于纯前端排序）
                      if (count >= total) {
                        setLocalDeckViewBuffer([...selfView.deck.slice(0, count)]);
                      } else {
                        setLocalDeckViewBuffer([]);
                      }
                    }}>
                    确认查看
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* 使用本地 buffer（查看全部时）或后端 buffer（查看部分时） */}
                {(() => {
                  const displayBuffer = localDeckViewBuffer.length > 0 ? localDeckViewBuffer : (selfView?.deckSearchBuffer ?? []);
                  const isViewAll = localDeckViewBuffer.length > 0;
                  return (<>
                <p className="deck-modal-meta">搜索区共 {displayBuffer.length} 张 · 已选 {deckViewSelectedIds.length} 张</p>
                <div className="deck-modal-scroll">
                  <div className="deck-modal-grid">
                    {displayBuffer.map((card, index) => {
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
                      if (isViewAll) {
                        // 查看全部：从本地 buffer 移除选中的牌，发后端展示
                        const selectedSet = new Set(deckViewSelectedIds);
                        setLocalDeckViewBuffer((prev) => prev.filter((c) => !selectedSet.has(c.id)));
                        deckViewSelectedIds.forEach((cardId) => moveCardPayload(cardId, "deck_search", "showcase"));
                      } else {
                        deckViewSelectedIds.forEach((cardId) => moveCardPayload(cardId, "deck_search", "showcase"));
                      }
                      setDeckViewSelectedIds([]);
                    }}>
                    📋 展示
                  </button>
                  <button type="button" disabled={deckViewSelectedIds.length === 0}
                    onClick={() => {
                      if (isViewAll) {
                        // 查看全部：纯前端排序，将选中的牌按选择顺序移到本地 buffer 顶部
                        const selectedSet = new Set(deckViewSelectedIds);
                        const selected = deckViewSelectedIds.map((id) => localDeckViewBuffer.find((c) => c.id === id)!).filter(Boolean);
                        const rest = localDeckViewBuffer.filter((c) => !selectedSet.has(c.id));
                        setLocalDeckViewBuffer([...selected, ...rest]);
                      } else {
                        // 查看部分：发后端 moveCard
                        [...deckViewSelectedIds].reverse().forEach((cardId) => moveCardPayload(cardId, "deck_search", "deck_top"));
                      }
                      setDeckViewSelectedIds([]);
                    }}>
                    ⬆️ 置顶
                  </button>
                  <button type="button" disabled={deckViewSelectedIds.length === 0}
                    onClick={() => {
                      if (isViewAll) {
                        // 查看全部：纯前端排序，将选中的牌移到本地 buffer 底部
                        const selectedSet = new Set(deckViewSelectedIds);
                        const selected = deckViewSelectedIds.map((id) => localDeckViewBuffer.find((c) => c.id === id)!).filter(Boolean);
                        const rest = localDeckViewBuffer.filter((c) => !selectedSet.has(c.id));
                        setLocalDeckViewBuffer([...rest, ...selected]);
                      } else {
                        // 查看部分：发后端 moveCard
                        deckViewSelectedIds.forEach((cardId) => moveCardPayload(cardId, "deck_search", "deck_bottom"));
                      }
                      setDeckViewSelectedIds([]);
                    }}>
                    ⬇️ 置底
                  </button>
                  <button type="button"
                    onClick={() => {
                      // 洗入剩余牌：同步本地 buffer 顺序到后端，然后洗牌
                      if (deckViewConfirmed) {
                        if (localDeckViewBuffer.length > 0) {
                          send({ type: "deck_search_reorder", payload: { roomId, orderedIds: localDeckViewBuffer.map((c) => c.id) } });
                        }
                        send({ type: "deck_search_return", payload: { roomId } });
                      }
                      send({ type: "deck_shuffle", payload: { roomId } });
                      setDeckViewModalOpen(false);
                      setDeckViewConfirmed(false);
                      setDeckViewSelectedIds([]);
                      setLocalDeckViewBuffer([]);
                    }}>
                    🔀 洗入剩余牌
                  </button>
                  <button type="button"
                    onClick={() => closeDeckView()}>
                    ✖ 关闭
                  </button>
                </div>
                  </>);
                })()}
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
      {importModalOpen ? (
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
      ) : null}

      {/* ========== 万能标记名称输入弹窗 ========== */}
      {customTokenPrompt && (
        <div
          className="deck-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setCustomTokenPrompt(null); }}
        >
          <div className="deck-modal" role="dialog" aria-modal="true" style={{ maxWidth: "360px" }}>
            <h3>🏷️ 添加自定义标记</h3>
            <p style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: "12px" }}>请输入标记名称</p>
            <input
              type="text"
              className="deck-view-input"
              value={customTokenNameInput}
              onChange={(e) => setCustomTokenNameInput(e.target.value)}
              onKeyDown={(e) => {
                const prompt = customTokenPrompt;
                if (e.key === "Enter" && prompt && customTokenNameInput.trim()) {
                  send({ type: "add_custom_marker_to_shikigami", payload: { roomId, targetPlayerId: prompt.playerId, slotIndex: prompt.slotIndex, markerName: customTokenNameInput.trim(), delta: 1 } });
                  setCustomTokenPrompt(null);
                  setCustomTokenNameInput("");
                } else if (e.key === "Escape") {
                  setCustomTokenPrompt(null);
                  setCustomTokenNameInput("");
                }
              }}
              autoFocus
              placeholder="标记名称..."
            />
            <div style={{ display: "flex", gap: "8px", marginTop: "12px", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => { setCustomTokenPrompt(null); setCustomTokenNameInput(""); }}>取消</button>
              <button
                type="button"
                disabled={!customTokenNameInput.trim() || !roomId}
                onClick={() => {
                  const prompt = customTokenPrompt;
                  if (!prompt || !roomId) return;
                  send({ type: "add_custom_marker_to_shikigami", payload: { roomId, targetPlayerId: prompt.playerId, slotIndex: prompt.slotIndex, markerName: customTokenNameInput.trim(), delta: 1 } });
                  setCustomTokenPrompt(null);
                  setCustomTokenNameInput("");
                }}
              >确定</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 召唤物(TOKEN)弹窗 ========== */}
      {tokenModalOpen ? (
        <div
          className="deck-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setTokenModalOpen(false); }}
        >
          <div className="deck-modal" role="dialog" aria-modal="true" style={{ maxWidth: "600px" }}>
            <h3>🐾 召唤物库</h3>
            <p className="deck-modal-hint">选择 1 张召唤物，将其置于展示区</p>
            <div className="deck-modal-scroll">
              <div className="deck-modal-grid">
                {Object.values(CARD_DATABASE)
                  .filter((card) => card.id.startsWith("TOKEN"))
                  .map((card) => {
                    const isSelected = tokenSelectedIds.includes(card.id);
                    return (
                      <div
                        key={card.id}
                        className={`deck-modal-cell ${isSelected ? "deck-modal-cell--selected" : ""}`}
                        onClick={() => {
                          setTokenSelectedIds((prev) =>
                            prev.includes(card.id)
                              ? prev.filter((id) => id !== card.id)
                              : prev.length < 1
                                ? [...prev, card.id]
                                : prev // 只允许选1张
                          );
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <img className="deck-modal-thumb" src={card.img || CARD_IMAGE_URL} alt={card.name} />
                        <span className="deck-modal-name">{card.name}</span>
                        {card.attack !== undefined && (
                          <span style={{ fontSize: "0.7rem", color: "#f97316" }}>⚔{card.attack}</span>
                        )}
                        {card.health !== undefined && (
                          <span style={{ fontSize: "0.7rem", color: "#22c55e" }}>♥{card.health}</span>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
            <div className="deck-modal-actions">
              <button type="button" onClick={() => setTokenModalOpen(false)}>取消</button>
              <button
                type="button"
                disabled={tokenSelectedIds.length === 0 || !roomId || !allowBoardDrag}
                onClick={() => {
                  if (tokenSelectedIds.length > 0) {
                    const tokenCard = CARD_DATABASE[tokenSelectedIds[0]];
                    if (tokenCard) {
                      send({
                        type: "place_token_to_showcase",
                        payload: {
                          roomId,
                          tokenId: tokenCard.id,
                          tokenName: tokenCard.name,
                          tokenAttack: tokenCard.attack ?? 0,
                          tokenHealth: tokenCard.health ?? 2,
                          tokenImg: tokenCard.img ?? ""
                        }
                      });
                      appendLog(`📋 将【${tokenCard.name}】置于展示区`);
                    }
                    setTokenModalOpen(false);
                    setTokenSelectedIds([]);
                  }
                }}
              >
                📋 展示
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
