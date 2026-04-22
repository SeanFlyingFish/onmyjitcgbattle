import re
import sys
sys.stdout.reconfigure(encoding='utf-8')

# 读取 lua 文件
with open('h:/card-battle-online/lua卡牌数据.txt', 'r', encoding='utf-8') as f:
    lua_content = f.read()

# 读取现有数据库
with open('h:/card-battle-online/web/src/cards-database.ts', 'r', encoding='utf-8') as f:
    db_content = f.read()

# 提取 lua 中的数据
card_data = {}
card_block_pattern = r'\["([A-Z]{3}\d[\d\-SPUROREXPC3D]*)"\]\s*=\s*\{(.*?)\n\}'
for match in re.finditer(card_block_pattern, lua_content, re.DOTALL):
    card_id = match.group(1)
    block = match.group(2)
    
    name_match = re.search(r'name\s*=\s*"([^"]*)"', block)
    desc_match = re.search(r'description\s*=\s*"([^"]*)"', block)
    gm_notes_match = re.search(r'gmNotes\s*=\s*\[\[([\s\S]*?)\]\]', block)
    
    description = desc_match.group(1) if desc_match else ""
    
    power = None
    life = None
    
    if gm_notes_match:
        gm_notes = gm_notes_match.group(1)
        power_match = re.search(r'"power"\s*:\s*"?(\d+)', gm_notes)
        life_match = re.search(r'"life"\s*:\s*"?(\d+)', gm_notes)
        if power_match:
            power = int(power_match.group(1))
        if life_match:
            life = int(life_match.group(1))
    
    card_data[card_id] = {
        'description': description,
        'power': power,
        'life': life
    }

print(f"从 Lua 提取了 {len(card_data)} 张卡牌数据")

# 读取现有数据库并更新
db_lines = db_content.split('\n')
updated_lines = []
i = 0
updates = 0

while i < len(db_lines):
    line = db_lines[i]
    
    # 检查是否是卡牌条目（如 "AYK001": {）
    card_match = re.match(r'(\s+)("[A-Z]{3}\d[\d\-SPUROREXPC3D]+":\s*\{)', line)
    
    if card_match:
        indent = card_match.group(1)
        card_id = re.search(r'"([A-Z]{3}\d[\d\-SPUROREXPC3D]+)"', line).group(1)
        
        updated_lines.append(line)
        i += 1
        
        # 检查下一行是否是 ability
        if i < len(db_lines) and '"ability":' in db_lines[i]:
            ability_line = db_lines[i]
            old_ability = ability_line.strip()
            
            # 获取 Lua 中的 description
            lua_data = card_data.get(card_id, {})
            lua_desc = lua_data.get('description', '')
            lua_power = lua_data.get('power')
            lua_life = lua_data.get('life')
            
            if lua_desc:
                # 更新 ability 为 description
                ability_key = re.search(r'"ability"', ability_line).group(0)
                updated_ability = f'{ability_key}: "{lua_desc}",'
                updated_lines.append(updated_ability)
                updates += 1
            else:
                updated_lines.append(ability_line)
            i += 1
        
        # 添加 power 和 life（如果是式神）
        lua_data = card_data.get(card_id, {})
        lua_power = lua_data.get('power')
        lua_life = lua_data.get('life')
        
        # 在 img 之后添加 power 和 life
        while i < len(db_lines):
            next_line = db_lines[i]
            if '"img":' in next_line:
                updated_lines.append(next_line)
                i += 1
                
                # 添加 power 和 life
                if lua_power is not None:
                    updated_lines.append(f'{indent}  "power": {lua_power},')
                if lua_life is not None:
                    updated_lines.append(f'{indent}  "life": {lua_life},')
                
                # 处理 } 或其他结束符
                while i < len(db_lines):
                    if '},' in db_lines[i] or '}' in db_lines[i]:
                        updated_lines.append(db_lines[i])
                        i += 1
                        break
                    updated_lines.append(db_lines[i])
                    i += 1
                break
            else:
                updated_lines.append(next_line)
                i += 1
    else:
        updated_lines.append(line)
        i += 1

print(f"更新了 {updates} 张卡牌的 ability 为 description")

# 写回文件
with open('h:/card-battle-online/web/src/cards-database.ts', 'w', encoding='utf-8') as f:
    f.write('\n'.join(updated_lines))

print("数据库已更新！")
