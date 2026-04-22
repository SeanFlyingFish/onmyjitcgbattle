const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const html = await fetch('http://localhost:5174/test-card-layout.html');
  
  // Extract computed sizes using a virtual DOM approach
  // Since we can't run a browser, let's analyze the CSS mathematically
  
  console.log("=== CSS 数学分析 ===\n");
  
  console.log("--- 当前实现 (drop-zone 无 position) ---");
  const areaWidth = 130; // ratio-7-9 width
  const areaPadding = 4; // each side
  const boxShadowBorder = 3; // box-shadow: 0 0 0 3px
  
  // area content box width = 130 - 4*2 = 122
  const contentWidth = areaWidth - areaPadding * 2;
  console.log(`area content width: ${contentWidth}px`);
  
  // area total height from aspect-ratio 7/9
  const areaHeight = Math.round(areaWidth * 9 / 7);
  const contentHeight = areaHeight - areaPadding * 2;
  console.log(`area content height: ${contentHeight}px (from aspect-ratio 7/9, width=${areaWidth})`);
  
  // drop-zone: position:static, width:100%, height:100%
  // In flex column container:
  // - width: 100% = contentWidth = 122px (flex item, align-items:center has no effect with explicit width)
  // - height: 100% = contentHeight = ~163px (if parent has definite height, which it does via aspect-ratio)
  console.log(`drop-zone: ${contentWidth}x${contentHeight}`);
  
  // BUT WAIT: box-shadow: 0 0 0 3px is OUTSIDE the box
  // It doesn't affect layout at all. The box-shadow border is purely visual.
  // area's box is still 130x167
  
  // shikigami-card-in-area: width:100%, position:relative, z-index:25
  const cardContainer = contentWidth;
  console.log(`shikigami-card-in-area: ${cardContainer}px wide`);
  
  // unit-card-face: width:100%, max-width:70px
  const unitFace = Math.min(cardContainer, 70);
  console.log(`unit-card-face: ${unitFace}px wide (min(${cardContainer}, 70))`);
  
  // unit-art: width:70px, height:85px (fixed, not responsive)
  console.log(`unit-art: 70x85px (FIXED)`);
  
  console.log("\n--- 问题分析 ---");
  console.log("1. box-shadow '0 0 0 3px' 模拟的边框在元素外侧，不影响布局");
  console.log("2. drop-zone 无 position，是普通 flex item");
  console.log("3. height:100% 在 flex column 中应该可以工作（父元素有确定高度）");
  console.log("4. unit-art 固定 70x85，不受容器影响");
  console.log("5. 但 spell-card 有 border:2px，实际 74x89");
  
  console.log("\n--- 对比 ---");
  console.log("式神区 (unit-art): 70x85 (无 border)");
  console.log("符咒区 (spell-card): 74x89 (border:2px + content:70x85)");
  console.log("延伸区 (extend-card): 74x89 (border:2px + content:70x85)");
  console.log("结界区 (card--mini): 70x85 (border:none)");
  console.log("移除区 (card--mini): 70x85 (border:none)");
  console.log("墓地 (card--mini): 70x85 (border:none)");
  
  console.log("\n=== 层级分析 ===");
  console.log(".area: position:relative → 创建 stacking context");
  console.log(".drop-zone: position:static → 不参与层叠");
  console.log(".shikigami-card-in-area: position:relative, z-index:25 → 在 .area 的 stacking context 内");
  console.log("box-shadow 在子元素之下绘制 ✓");
  console.log("background 在子元素之下绘制 ✓");
  console.log("结论: 卡牌不应被框遮挡");
  
  console.log("\n=== 真正的问题 ===");
  console.log("1. '.drop-zone' 没有 'position' 属性！");
  console.log("   'top:0; left:0' 被忽略，它只是普通 flex item");
  console.log("   但 width:100% + height:100% 在 flex 中应该能工作");
  console.log("   除非... height:100% 在某些浏览器中退化为 auto");
  
  console.log("\n2. 如果 drop-zone 的 height 退化为 auto:");
  console.log("   drop-zone 高度 = 内容高度 = 85 (img) + token belt");
  console.log("   justify-content:center 会把它垂直居中在 area 中");
  console.log("   这不是遮挡问题，只是位置偏移");
  
  console.log("\n3. 关键发现: .area 有 'overflow: visible'");
  console.log("   如果 drop-zone height:auto 且内容超出 area，不会被裁剪");
  
  console.log("\n4. 符咒区 .spell-card 有 'position:absolute'");
  console.log("   它们相对于 .spell-area (position:relative) 定位");
  console.log("   z-index:2 在 .spell-area 的 stacking context 内");
  console.log("   .spell-area 的 box-shadow 不会遮挡它们 ✓");
}

main().catch(console.error);
