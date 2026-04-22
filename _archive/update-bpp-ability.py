#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 lua卡牌数据.txt 提取 BPP 卡牌的 description，
然后将其填入 cards-database.ts 中对应 BPP 卡牌的 ability 字段。
"""

import re

LUA_FILE = r"H:\card-battle-online\lua卡牌数据.txt"
DB_FILE  = r"H:\card-battle-online\web\src\cards-database.ts"

# ─── Step 1: 解析 lua 文件，提取 BPP 卡牌的 description ───────────────────────

def parse_lua_bpp_descriptions(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()

    # 匹配  ["BPPxxx"] = { ... }  块（贪心到下一个顶级块或文件结束）
    # 只抓取 BPP 系列的 ID
    pattern = re.compile(
        r'\["(BPP[^"]+)"\]\s*=\s*\{(.*?)(?=\n\["|\Z)',
        re.DOTALL
    )

    descriptions = {}
    for m in pattern.finditer(text):
        card_id = m.group(1)
        block   = m.group(2)
        # 提取 description 字段（支持多行用 \n 转义的情况）
        desc_m = re.search(r'description\s*=\s*"((?:[^"\\]|\\.)*)"', block, re.DOTALL)
        if desc_m:
            raw = desc_m.group(1)
            # lua 中的 \n 替换成真实换行
            raw = raw.replace("\\n", "\n")
            descriptions[card_id] = raw

    return descriptions

# ─── Step 2: 更新 ts 文件中 BPP 卡牌的 ability 字段 ──────────────────────────

def escape_for_ts(s):
    """把 description 字符串转义成 TypeScript 字符串字面量内容（双引号包裹）"""
    # 转义反斜线和双引号
    s = s.replace("\\", "\\\\")
    s = s.replace('"', '\\"')
    # 换行转为 \n
    s = s.replace("\n", "\\n")
    return s

def update_ts_ability(ts_path, descriptions):
    with open(ts_path, encoding="utf-8") as f:
        text = f.read()

    updated = 0
    not_found_in_ts = []

    for card_id, desc in descriptions.items():
        escaped_desc = escape_for_ts(desc)

        # 定位该 card_id 的块：从 "BPPxxx": { 开始
        # 找到对应 ability 行并替换其值
        # 模式：在 "BPPxxx": { ... "ability": "旧值", ... } 内替换 ability

        # 先找 card_id 的位置
        id_pattern = re.compile(
            r'("' + re.escape(card_id) + r'"\s*:\s*\{[^}]*?"ability"\s*:\s*)"([^"]*)"',
            re.DOTALL
        )
        m = id_pattern.search(text)
        if m:
            old_snippet = m.group(0)
            new_snippet = m.group(1) + '"' + escaped_desc + '"'
            text = text[:m.start()] + new_snippet + text[m.end():]
            updated += 1
        else:
            not_found_in_ts.append(card_id)

    with open(ts_path, encoding="utf-8", newline="") as f:
        original_newline = "\r\n" if "\r\n" in f.read(4096) else "\n"

    # 写回（保持原换行）
    with open(ts_path, "w", encoding="utf-8", newline=original_newline) as f:
        f.write(text)

    return updated, not_found_in_ts

# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("正在解析 lua 文件中的 BPP description…")
    descriptions = parse_lua_bpp_descriptions(LUA_FILE)
    print(f"  共找到 {len(descriptions)} 条 BPP description")

    # 打印前5条预览
    for i, (k, v) in enumerate(list(descriptions.items())[:5]):
        preview = v.replace("\n", "\\n")[:80]
        print(f"  [{k}] {preview}")

    print("\n正在更新 cards-database.ts…")
    updated, not_found = update_ts_ability(DB_FILE, descriptions)
    print(f"  成功更新 {updated} 条")

    if not_found:
        print(f"  以下 ID 在 lua 中有 description 但 ts 文件中未找到对应 ability 字段：")
        for nf in not_found:
            print(f"    - {nf}")
    else:
        print("  所有条目均已更新！")
