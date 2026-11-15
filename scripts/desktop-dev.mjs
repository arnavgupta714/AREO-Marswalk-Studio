import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

const server = await createServer();
await server.listen();
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, AREO_DEV: '1' }, windowsHide: true });
let closing = false;
async function cleanup(code = 0) {
  if (closing) return;
  closing = true;
  if (!child.killed) child.kill();
  await server.close();
  process.exit(code);
}
child.once('exit', code => void cleanup(code ?? 0));
child.once('error', error => { console.error(error); void cleanup(1); });
process.on('SIGINT', () => void cleanup());
process.on('SIGTERM', () => void cleanup());
