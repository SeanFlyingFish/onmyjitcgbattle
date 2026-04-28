import re
import json
import sys
import io

# 重定向 stdout 到 stderr 以确保输出
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# 读取 lua 文件
with open('H:/onmyojitcg-online/lua卡牌数据.txt', 'r', encoding='utf-8') as f:
    content = f.read()

print(f"Lua file read, length: {len(content)}")

# 提取 cardData 部分
card_data_start = content.find('local cardData = {') + 18
card_data_block = content[card_data_start:]

# 解析每个卡牌
cards = {}

# 找到所有卡牌 ID
pattern = r'\["([A-Z]+\d+(?:-[A-Z]+)?)"\]\s*='
card_starts = list(re.finditer(pattern, card_data_block))

for i, match in enumerate(card_starts):
    card_id = match.group(1)
    start_pos = match.end()
    
    # 找到下一个卡牌的位置
    if i + 1 < len(card_starts):
        end_pos = card_starts[i + 1].start()
    else:
        end_pos = len(card_data_block)
    
    card_block = card_data_block[start_pos:end_pos]
    
    # 提取字段
    # name
    name_match = re.search(r'name\s*=\s*"([^"]*)"', card_block)
    name = name_match.group(1) if name_match else ""
    
    # description/ability
    desc_match = re.search(r'description\s*=\s*"([^"]*)"', card_block)
    ability = desc_match.group(1) if desc_match else ""
    
    # image
    img_match = re.search(r'image\s*=\s*"([^"]*)"', card_block)
    img = img_match.group(1) if img_match else ""
    
    # tags
    tags_match = re.search(r'tags\s*=\s*\{([^}]*)\}', card_block)
    keyword = ""
    if tags_match:
        tag_list = re.findall(r'"([^"]*)"', tags_match.group(1))
        keyword = "/".join(tag_list)
    
    # gmNotes JSON
    gm_match = re.search(r'gmNotes\s*=\s*\[\[([\s\S]*?)\]\]', card_block)
    power, health, card_type, cost = 0, 0, "shikigami", 0
    
    if gm_match:
        gm_json = gm_match.group(1)
        
        type_match = re.search(r'"type"\s*:\s*"([^"]*)"', gm_json)
        if type_match:
            type_val = type_match.group(1)
            # 映射 lua type 到游戏 type
            if type_val in ["Youkai", "Shikigami"]:
                card_type = "shikigami"
            elif type_val in ["Awaken", "Awakening"]:
                card_type = "awaken"
            elif type_val in ["Attach", "Attachment"]:
                card_type = "attach"
            elif type_val in ["Spell", "Mage"]:  # Mage 也是法术类型
                card_type = "spell"
            elif type_val in ["Realm", "Barrier"]:
                card_type = "barrier"
            elif type_val == "token":
                card_type = "shikigami"
            else:
                card_type = "shikigami"  # 默认
        
        cost_match = re.search(r'"cost"\s*:\s*"(\d*)"', gm_json)
        if cost_match and cost_match.group(1):
            cost = int(cost_match.group(1))
        
        power_match = re.search(r'"power"\s*:\s*"?(\d+)"?', gm_json)
        if power_match:
            power = int(power_match.group(1))
        
        life_match = re.search(r'"life"\s*:\s*"?(\d+)"?', gm_json)
        if life_match:
            health = int(life_match.group(1))
    
    cards[card_id] = {
        "id": card_id,
        "name": name,
        "alias": name,
        "type": card_type,
        "cost": cost,
        "keyword": keyword,
        "ability": ability,
        "img": img,
        "attack": power,
        "health": health
    }

print(f"共提取 {len(cards)} 张卡牌")
print(f"AYK001: {cards['AYK001']['name']} - attack:{cards['AYK001']['attack']}, health:{cards['AYK001']['health']}, type:{cards['AYK001']['type']}")
print(f"AYK002: {cards['AYK002']['name']} - attack:{cards['AYK002']['attack']}, health:{cards['AYK002']['health']}")
print(f"BPP001: {cards['BPP001']['name']} - attack:{cards['BPP001']['attack']}, health:{cards['BPP001']['health']}")
print(f"BPP186: {cards['BPP186']['name']} - type:{cards['BPP186']['type']}, cost:{cards['BPP186']['cost']}")

# 生成 TypeScript 文件
ts_content = """// 阴阳师TCG卡牌数据库 - AYK第一弹 + BPP第二弹
// 自动生成，共 """ + str(len(cards)) + """ 张卡牌

import type { BuilderCard } from './types';

export type { BuilderCard };

export const CARD_DATABASE: Record<string, BuilderCard> = {
"""

# 按 ID 排序
for card_id in sorted(cards.keys()):
    card = cards[card_id]
    ts_content += f"""  "{card['id']}": {{
    "id": "{card['id']}",
    "name": "{card['name']}",
    "alias": "{card['alias']}",
    "type": "{card['type']}",
    "cost": {card['cost']},
    "keyword": "{card['keyword']}",
    "ability": "{card['ability']}",
    "img": "{card['img']}",
    "attack": {card['attack']},
    "health": {card['health']},
}},
"""

ts_content += """};
export default CARD_DATABASE;
"""

# 写入文件 (UTF-8 without BOM)
with open('H:/onmyojitcg-online/web/src/cards-database.ts', 'w', encoding='utf-8') as f:
    f.write(ts_content)

print("已生成 cards-database.ts")
