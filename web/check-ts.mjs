import { execSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const out = execSync('npx tsc --noEmit 2>&1', {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd: __dirname
  });
  console.log(out || 'No TypeScript errors');
} catch(e) {
  console.error(e.stdout || e.message);
}
