// 从 lua卡牌数据.txt 提取卡牌信息生成 CARD_DATABASE
const fs = require('fs');

const luaFile = 'h:/card-battle-online/lua卡牌数据.txt';
const outputFile = 'h:/card-battle-online/web/src/cards-database.ts';

const content = fs.readFileSync(luaFile, 'utf8');

// 解析 Lua 格式的卡牌数据
const cardPattern = /\["([A-Z]+\d+[A-Z-]*)"\] = \{[\s\S]*?name = "([^"]*)"[\s\S]*?description = "([^"]*)"[\s\S]*?image = "([^"]*)"[\s\S]*?gmNotes = \[\[([\s\S]*?)\]\][\s\S]*?\}/g;

const cards = {};
let match;

while ((match = cardPattern.exec(content)) !== null) {
  const id = match[1];
  const name = match[2];
  const description = match[3];
  const image = match[4];
  const gmNotesContent = match[5];

  // 解析 gmNotes 中的 JSON
  let type = 'shikigami';
  let cost = 0;
  let power = 0;
  let life = 1;
  let keyword = '';

  // 从 description 中提取 keyword（斜杠分隔的标签）
  const keywordMatch = description.match(/〈([^〉]+)〉/g);
  if (keywordMatch) {
    keyword = keywordMatch.map(k => k.replace(/[〈〉]/g, '')).join('/');
  }

  // 解析 gmNotes JSON
  try {
    const jsonMatch = gmNotesContent.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const json = JSON.parse(jsonMatch[0]);
      type = json.type || type;
      cost = parseInt(json.cost) || cost;
      power = parseInt(json.power) || power;
      life = parseInt(json.life) || life;
    }
  } catch (e) {
    // 解析失败，使用默认值
  }

  // 映射类型
  let cardType = 'shikigami';
  if (type.includes('Awakening') || type.includes('觉醒')) {
    cardType = 'awaken';
  } else if (type.includes('Spell') || type.includes('法术')) {
    cardType = 'spell';
  } else if (type.includes('Barrier') || type.includes('结界')) {
    cardType = 'barrier';
  } else if (type.includes('Attach') || type.includes('附灵')) {
    cardType = 'attach';
  }

  cards[id] = {
    id,
    name,
    type: cardType,
    cost,
    keyword,
    ability: description.replace(/[〈〉]/g, ''),
    img: image,
    // 游戏数据
    attack: power,
    health: life
  };
}

// 生成 TypeScript 文件
const tsContent = `// 自动生成的文件 - 从 lua卡牌数据.txt 提取
// 生成时间: ${new Date().toISOString()}

import type { BuilderCard } from './App';

export const CARD_DATABASE: Record<string, BuilderCard & { attack?: number; health?: number }> = ${JSON.stringify(cards, null, 2)};

// 导出卡牌数量统计
export const CARD_STATS = {
  totalCards: Object.keys(cards).length,
  prefixes: {
    AYK: Object.keys(cards).filter(id => id.startsWith('AYK')).length,
    BPP: Object.keys(cards).filter(id => id.startsWith('BPP')).length,
    GOT: Object.keys(cards).filter(id => id.startsWith('GOT')).length,
  }
};

console.log('[cards-database] 已加载', CARD_STATS.totalCards, '张卡牌');
`;

fs.writeFileSync(outputFile, tsContent, 'utf8');
console.log('已生成卡片数据库:', outputFile);
console.log('共提取', Object.keys(cards).length, '张卡牌');
