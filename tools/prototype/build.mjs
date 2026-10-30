import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = new URL('../../apps/web/public/', import.meta.url);
const target = new URL('../../apps/web/dist/', import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });
console.log(`Built local web assets: ${fileURLToPath(target)}`);
