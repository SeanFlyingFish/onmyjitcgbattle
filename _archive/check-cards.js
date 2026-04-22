const fs = require('fs');

// 统计组卡器卡牌数
const html = fs.readFileSync('H:/card-battle-online/阴阳师TCG组卡器(3.2.1.1.1).html', 'utf8');
const idMatches = html.match(/\{ id: "[A-Z]{3}\d/g) || [];
console.log('组卡器卡牌数:', idMatches.length);

// 统计 lua 卡牌数
const lua = fs.readFileSync('H:/card-battle-online/lua卡牌数据.txt', 'utf8');
const luaMatches = lua.match(/\[\"[A-Z]{3}\d/g) || [];
console.log('Lua卡牌数:', luaMatches.length);

// 列出前10张卡牌
const cardIds = html.match(/id: "([A-Z]{3}\d[^\"]+)"/g) || [];
console.log('组卡器前10张:', cardIds.slice(0, 10));
