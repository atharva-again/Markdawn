import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const distributionRoot = fileURLToPath(new URL('../dist/', import.meta.url));

mkdirSync(distributionRoot, { recursive: true });

const installers = [
  ['scripts/install-cli.sh', 'install.sh'],
  ['scripts/install-cli.ps1', 'install.ps1'],
];

for (const [sourcePath, destinationName] of installers) {
  const source = `${repositoryRoot}/${sourcePath}`;
  const destination = `${distributionRoot}/${destinationName}`;
  copyFileSync(source, destination);
  if (destinationName.endsWith('.sh')) chmodSync(destination, 0o755);
}
