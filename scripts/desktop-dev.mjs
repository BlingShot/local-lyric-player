import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer();
await server.listen();
const env = { ...process.env, LOCAL_MUSIC_DEV_URL: 'http://127.0.0.1:3000/' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['electron/main.mjs'], { env, stdio: 'inherit', windowsHide: true });
child.on('error', async error => { console.error(error); await server.close(); process.exitCode = 1; });
child.on('exit', async code => { await server.close(); process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(); void server.close(); });
