const fs = require('fs');
const path = require('path');

function patchFile(filePath, transforms) {
  if (!fs.existsSync(filePath)) return false;
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const { search, replace } of transforms) {
    if (content.includes(search)) {
      content = content.replace(search, replace);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[Engine Patch] Successfully patched: ${filePath}`);
    return true;
  }
  return false;
}

// 1. Search for whatsapp-webjs adapter dist files
function findFiles(dir, matchStr) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        if (!fullPath.includes('.git') && !fullPath.includes('cache')) {
          results = results.concat(findFiles(fullPath, matchStr));
        }
      } else if (file.includes(matchStr)) {
        results.push(fullPath);
      }
    }
  } catch (e) {}
  return results;
}

console.log('[Engine Patch] Searching for engine adapters to optimize timeout and stability...');

const adapterFiles = findFiles('/app', 'whatsapp-webjs.adapter.js');
console.log(`[Engine Patch] Found ${adapterFiles.length} adapter file(s)`);

for (const f of adapterFiles) {
  let content = fs.readFileSync(f, 'utf8');
  // Inject authTimeoutMs, takeoverOnConflict, protocolTimeout into whatsapp-web.js Client config
  if (!content.includes('authTimeoutMs: 120000')) {
    content = content.replace(
      /new\s+whatsapp_web_js_[0-9a-zA-Z_]*\.Client\(\{([\s\S]*?)\}\)/g,
      (match, p1) => {
        return match.replace(p1, `${p1}, authTimeoutMs: 120000, qrMaxRetries: 10, takeoverOnConflict: true, takeoverTimeoutMs: 120000`);
      }
    );
    // Also patch timeout in general Client instantiations
    content = content.replace(/authTimeoutMs:\s*[0-9]+/g, 'authTimeoutMs: 120000');
    fs.writeFileSync(f, content, 'utf8');
    console.log(`[Engine Patch] Applied timeout patch to: ${f}`);
  }
}

// 2. Patch whatsapp-web.js Client.js directly if found in node_modules
const clientFiles = findFiles('/app', 'Client.js').filter(p => p.includes('whatsapp-web.js'));
for (const f of clientFiles) {
  let content = fs.readFileSync(f, 'utf8');
  if (content.includes("waitUntil: 'load'")) {
    content = content.replace("waitUntil: 'load'", "waitUntil: 'domcontentloaded'");
    fs.writeFileSync(f, content, 'utf8');
    console.log(`[Engine Patch] Patched Client.js waitUntil to domcontentloaded: ${f}`);
  }
}

console.log('[Engine Patch] Engine patch completed successfully.');
