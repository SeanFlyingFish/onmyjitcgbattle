--[[
  批量卡牌数据模板（Lua 表）
  使用方式：复制下方条目，改 id / 字段；多条之间用逗号分隔，最后放入你的总表 return { ... } 中。

  注意：
  - gmNotes 内是 JSON 字符串，键名必须用双引号，键值之间要有逗号。
  - keyword 等字符串里的引号在 JSON 中需写成 \"
]]

-- 单卡条目示例（可复制多次）：
--[[
["AYK001"] = {
	name = "天邪鬼青",
	description = "鼓舞：你召唤〈天邪鬼〉进场后，抽1张牌。",
	image = "https://fishcrashers.oss-cn-chengdu.aliyuncs.com/YYSTCG/CARD/A_1.webp?v=3.1.1.2",
	gmNotes = [[
		{
			"type": "式神",
			"keyword": "恶鬼/天邪鬼",
			"cost": 1,
			"power": 1,
			"life": 1
		}
	]],
},
]]

-- 汇总表骨架：
return {
	-- ["卡牌编号"] = { ... },
}
