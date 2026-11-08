import { readFile, writeFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile(new URL('../vscode-extension/package-lock.json', import.meta.url), 'utf8'));
const packages = Object.entries(lock.packages ?? {}).filter(([name]) => name !== '');
const missing = packages.filter(([, metadata]) => typeof metadata.license !== 'string' || metadata.license.trim() === '');
if (missing.length > 0) {
  console.error(`Dependências sem licença declarada: ${missing.map(([name]) => name).join(', ')}`);
  process.exitCode = 1;
}
const report = {
  generatedAt: new Date().toISOString(),
  packageCount: packages.length,
  licenses: Object.fromEntries(packages.map(([name, metadata]) => [name, metadata.license])),
};
await writeFile(new URL('../vscode-extension/dependency-licenses.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Licenças verificadas: ${packages.length} pacotes.`);
