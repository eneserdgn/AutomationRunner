export function getCommonDirPrefix(scenarios) {
  if (!scenarios.length) return '';
  const dirs = scenarios.map(s => {
    const parts = s.filePath.replace(/\\/g, '/').split('/');
    parts.pop();
    return parts;
  });
  const minLen = Math.min(...dirs.map(d => d.length));
  const common = [];
  for (let i = 0; i < minLen; i++) {
    const seg = dirs[0][i];
    if (dirs.every(d => d[i] === seg)) common.push(seg);
    else break;
  }
  return common.join('/');
}

export function stripPrefix(filePath, prefix) {
  const p = filePath.replace(/\\/g, '/');
  if (prefix && p.startsWith(prefix + '/')) return p.slice(prefix.length + 1);
  return p;
}

// MM:SS — senaryo ve feature dosyaları için
export function formatDuration(ms) {
  const totalSecs = Math.floor((ms || 0) / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// HH:MM:SS — klasörler için
export function formatDurationLong(ms) {
  const totalSecs = Math.floor((ms || 0) / 1000);
  const hrs  = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function buildTree(scenarios, commonPrefix) {
  const root = { type: 'dir', children: {}, scenarios: [] };
  for (const s of scenarios) {
    const rel = stripPrefix(s.filePath, commonPrefix);
    const parts = rel.split('/');
    const fileName = parts[parts.length - 1].replace(/\.feature$/i, '');
    const dirParts = parts.slice(0, -1);
    let node = root;
    for (const part of dirParts) {
      if (!node.children[part]) {
        node.children[part] = { type: 'dir', children: {}, scenarios: [] };
      }
      node = node.children[part];
    }
    if (!node.children[fileName]) {
      node.children[fileName] = { type: 'file', children: {}, scenarios: [] };
    }
    node.children[fileName].scenarios.push(s);
  }
  return root;
}

export function collectAll(node) {
  const result = [...node.scenarios];
  for (const child of Object.values(node.children)) {
    result.push(...collectAll(child));
  }
  return result;
}
