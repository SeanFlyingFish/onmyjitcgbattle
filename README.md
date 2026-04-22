# Card Battle Online Framework

这是一个联机卡牌对战的基础框架，目标是先跑通：

- 房间创建/加入
- 双人对战开始
- 出牌结算（简化版）
- 回合切换
- 状态广播

## Tech Stack

- TypeScript
- Node.js + ws(WebSocket)
- zod（协议校验）

## Quick Start

```bash
npm install
npm run dev:server
```

另开一个终端启动网页前端：

```bash
cd web
npm install
npm run dev
```

然后在页面里填 `ws://localhost:8080` 连接即可。

可选：继续用命令行测试客户端：

```bash
npm run dev:client
```

## 一键启动（推荐）

### 命令行

```bash
npm run dev:oneclick
```

会同时启动后端和前端，并自动打开浏览器。

### Windows 双击

直接双击项目根目录的 `start-game.bat`。

## 协议事件（当前）

### Client -> Server

- `create_room`
- `join_room`
- `start_match`
- `submit_mulligan`（同步调度：payload 含 `cardIds`，双方均提交后结算）
- `play_card`
- `end_turn`

### Server -> Client

- `room_created`
- `room_joined`
- `match_started`
- `match_state`
- `error`

## 目录结构

```text
src/
  shared/
    types.ts        # 协议、核心类型
  server/
    gameEngine.ts   # 对局规则状态机（简化）
    roomManager.ts  # 房间与玩家管理
    index.ts        # WebSocket 服务入口
  client/
    mockClient.ts   # 命令行测试客户端
```

## 对局规则（当前实现）

- 开局洗牌后双方各抽 5 张，进入**同步调度**：各自选择任意张手牌暂置，补满 5 张后将暂置牌洗回牌库；调度不公开具体卡牌，双方用 `submit_mulligan` 同时确认后结算。
- **回合开始**（轮到己方时）：重置己方场上式神/符咒的横置状态，并抽 2 张牌（先手第一回合在调度结束后执行）。

## 下一步建议

1. 加入卡组配置与抽牌机制（目前只保留 deckCount）
2. 改造 `play_card`：支持召唤随从、法术、目标过滤
3. 加战斗阶段（准备/行动/结束）与超时自动回合
4. 增加鉴权、断线重连、观战与战报回放
5. 拆出 `match-service` 和持久化（Redis/Postgres）

