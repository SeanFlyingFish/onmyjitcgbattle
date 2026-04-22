import { execSync } from 'child_process';
process.chdir('H:/card-battle-online/web');
try {
  const out = execSync('npx tsc --noEmit 2>&1', { encoding: 'utf8', stdio: 'pipe' });
  console.log(out || 'No errors');
} catch(e) {
  console.error(e.stdout || e.message);
}
