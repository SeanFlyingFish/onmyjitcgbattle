const { execSync } = require('child_process');
try {
  process.chdir('h:\\onmyojitcg-online\\web');
  console.log('[build] 开始构建前端...');
  execSync('npx vite build --outDir ../dist/web', { stdio: 'inherit', timeout: 120000 });
  console.log('[build] 构建完成！');
} catch (e) {
  console.error('[build] 构建失败:', e.message);
  process.exit(1);
}
