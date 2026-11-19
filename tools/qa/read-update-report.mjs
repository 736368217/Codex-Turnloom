import fs from 'node:fs';

const file = process.argv[2];
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const screen of report.screens) {
  const text = String(screen.facts?.text || '');
  const index = text.indexOf('应用更新');
  console.log(`${screen.name}: ${index >= 0 ? text.slice(index) : '(no update panel text)'}`);
}
for (const request of report.requests || []) {
  if (!/dl\.736|app\/update|native:downloadUpdate/.test(request.url)) continue;
  console.log(`  req ${request.status ?? '-'} ${request.url} ${request.qaUpdate || ''} ${request.error || ''}`);
}
