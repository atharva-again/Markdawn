import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = fileURLToPath(new URL('../public/og-image.svg', import.meta.url));
const destination = fileURLToPath(new URL('../dist/og-image.png', import.meta.url));

await sharp(readFileSync(source)).png({ compressionLevel: 9 }).toFile(destination);
