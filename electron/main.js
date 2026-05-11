const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

const activeProcesses = new Map(); // terminalId -> child process

const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_START_URL;
const STORE_PATH       = path.join(os.homedir(), '.pegasus-automation-runner', 'projects.json');
const PRESETS_PATH     = path.join(os.homedir(), '.pegasus-automation-runner', 'presets.json');
const FILTERS_PATH     = path.join(os.homedir(), '.pegasus-automation-runner', 'filters.json');
const RUN_CONFIGS_PATH = path.join(os.homedir(), '.pegasus-automation-runner', 'run-configs.json');

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify([]));
}

function loadProjects() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function loadPresets() {
  ensureStore();
  try {
    if (!fs.existsSync(PRESETS_PATH)) return {};
    return JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf-8'));
  } catch { return {}; }
}

function savePreset(name, localPath) {
  const p = loadPresets();
  p[name] = localPath;
  fs.writeFileSync(PRESETS_PATH, JSON.stringify(p, null, 2));
}

function saveProject(projectPath) {
  const projects = loadProjects();
  const existing = projects.findIndex(p => p.path === projectPath);
  const entry = { path: projectPath, name: path.basename(projectPath), lastOpened: Date.now() };
  if (existing >= 0) {
    projects[existing] = entry;
  } else {
    projects.unshift(entry);
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(projects.slice(0, 10)));
}

function findFeatureFiles(dir) {
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(findFeatureFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.feature') || entry.name.endsWith('.spec'))) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

function parseTableRow(line) {
  return line.split('|').slice(1, -1).map(c => c.trim());
}

function parseSpecFile(filePath, projectRoot) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines   = content.split('\n');
  const scenarios    = [];
  const contextSteps = []; // steps before first scenario (run for every scenario)
  let currentScenario = null;
  let specName = '';

  for (let i = 0; i < lines.length; i++) {
    const line     = lines[i].trim();
    const nextLine = (lines[i + 1] || '').trim();

    // Skip comment lines
    if (line.startsWith('//')) continue;

    // Underline-style spec title:  "Title\n======"
    if (line && /^=+$/.test(nextLine)) {
      specName = line;
      i++; // skip underline
      continue;
    }

    // Underline-style scenario:  "Scenario Name\n------"
    if (line && /^-+$/.test(nextLine)) {
      if (currentScenario) scenarios.push(currentScenario);
      currentScenario = {
        id:          `${filePath}::${i}`,
        featureName: specName,
        type:        'Scenario',
        name:        line,
        steps:       [],
        examples:    [],
        filePath:    path.relative(projectRoot, filePath),
        lineNumber:  i + 1,
        status:      'not-run',
        duration:    0,
        framework:   'gauge',
      };
      i++; // skip underline
      continue;
    }

    // Markdown-style spec title:  "# Title"
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      specName = line.replace(/^#\s*/, '').trim();
      continue;
    }

    // Markdown-style scenario:  "## Scenario Name"
    if (line.startsWith('## ')) {
      if (currentScenario) scenarios.push(currentScenario);
      currentScenario = {
        id:          `${filePath}::${i}`,
        featureName: specName,
        type:        'Scenario',
        name:        line.replace(/^##\s*/, '').trim(),
        steps:       [],
        examples:    [],
        filePath:    path.relative(projectRoot, filePath),
        lineNumber:  i + 1,
        status:      'not-run',
        duration:    0,
        framework:   'gauge',
      };
      continue;
    }

    // Tags line — skip
    if (line.startsWith('Tags:')) continue;

    // Step
    if (line.startsWith('* ')) {
      const step = { text: line, rows: [] };
      if (currentScenario) currentScenario.steps.push(step);
      else contextSteps.push(step);
      continue;
    }

    // Table row belonging to last step
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      // Skip markdown separator rows: |---|---|
      if (cells.every(c => /^-+$/.test(c))) continue;
      const row = cells;
      if (currentScenario && currentScenario.steps.length > 0) {
        currentScenario.steps[currentScenario.steps.length - 1].rows.push(row);
      } else if (!currentScenario && contextSteps.length > 0) {
        contextSteps[contextSteps.length - 1].rows.push(row);
      }
    }
  }

  if (currentScenario) scenarios.push(currentScenario);

  // Prepend context steps to every scenario
  if (contextSteps.length > 0) {
    scenarios.forEach(s => { s.steps = [...contextSteps, ...s.steps]; });
  }

  return scenarios;
}

function parseFeatureFile(filePath, projectRoot) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const scenarios = [];
  let currentScenario = null;
  let featureName = '';
  let inExamples = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('Feature:')) {
      featureName = line.replace('Feature:', '').trim();
    } else if (line.startsWith('Scenario:') || line.startsWith('Scenario Outline:')) {
      if (currentScenario) scenarios.push(currentScenario);
      const isOutline = line.startsWith('Scenario Outline:');
      inExamples = false;
      currentScenario = {
        id: `${filePath}::${i}`,
        featureName,
        type: isOutline ? 'Scenario Outline' : 'Scenario',
        name: line.replace(/^Scenario Outline:|^Scenario:/, '').trim(),
        steps: [],
        examples: [],
        filePath: path.relative(projectRoot, filePath),
        lineNumber: i + 1,
        status: 'not-run',
        duration: 0,
      };
    } else if (currentScenario) {
      if (
        line.startsWith('Given ') || line.startsWith('When ') ||
        line.startsWith('Then ') || line.startsWith('And ') ||
        line.startsWith('But ') || line.startsWith('* ')
      ) {
        inExamples = false;
        currentScenario.steps.push({ text: line, rows: [] });
      } else if (line.startsWith('Examples:')) {
        inExamples = true;
      } else if (line.startsWith('|')) {
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        if (cells.every(c => /^-+$/.test(c))) { /* separator row, skip */ }
        else if (inExamples) {
          currentScenario.examples.push(line);
        } else if (currentScenario.steps.length > 0) {
          currentScenario.steps[currentScenario.steps.length - 1].rows.push(cells);
        }
      }
    }
  }
  if (currentScenario) scenarios.push(currentScenario);
  return scenarios;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../build/index.html')}`;

  win.loadURL(startUrl);
}

app.whenReady().then(() => {
  createWindow();
  if (!isDev) setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('update-available', { version: info.version });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('update-downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    // Sessizce geç — güncelleme sunucusuna erişilemezse uygulamayı engelleme
    console.error('AutoUpdater error:', err?.message);
  });

  // Uygulama açılışından 3sn sonra kontrol et (UI hazır olsun)
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
}

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

// IPC Handlers
ipcMain.handle('get-projects', () => loadProjects());

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  const chosen = result.filePaths[0];
  saveProject(chosen);
  return { path: chosen, name: path.basename(chosen) };
});

ipcMain.handle('get-default-clone-dir', () => {
  const dir = path.join(os.homedir(), 'Documents', 'BDDProjects');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
});

ipcMain.handle('open-in-browser', (_, url) => shell.openExternal(url));

// ── Environment helpers ──────────────────────────────────────────────────────
function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: true });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('close', code => resolve({ code, out, err }));
    child.on('error', reject);
  });
}

// Login-shell aware command runner for environment checks.
// On macOS, Electron GUI apps get a minimal /bin/sh PATH that misses
// Homebrew (/opt/homebrew/bin, /usr/local/bin) and nvm/sdkman shims.
// Running via `zsh -lc` sources /etc/zprofile + ~/.zprofile so all
// user-installed tools are found just like in a terminal session.
function runEnvCommand(cmd, args) {
  const isWin   = process.platform === 'win32';
  const cmdLine = [cmd, ...args].join(' ');
  const child   = isWin
    ? spawn('cmd', ['/c', cmdLine], { shell: false })
    : spawn('zsh', ['-lc', cmdLine], { shell: false });

  return new Promise((resolve, reject) => {
    let out = '', err = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('close', code => resolve({ code, out, err }));
    child.on('error', reject);
  });
}

ipcMain.handle('check-environment', async () => {
  const env = {};

  // Java
  try {
    const { out, err } = await runEnvCommand('java', ['-version']);
    const raw   = out || err;
    const match = raw.match(/version "([^"]+)"/);
    if (match) {
      const parts = match[1].split('.');
      const major = parts[0] === '1' ? parts[1] : parts[0];
      env.java = { installed: true, version: match[1], major: parseInt(major, 10) };
    } else {
      env.java = { installed: true, version: 'bilinmiyor', major: null };
    }
  } catch { env.java = { installed: false }; }

  // JAVA_HOME — check live shell env too (zsh -lc prints it)
  let javaHome = process.env.JAVA_HOME;
  if (!javaHome) {
    try {
      const { out } = await runEnvCommand('echo', ['$JAVA_HOME']);
      const val = out.trim();
      if (val) javaHome = val;
    } catch {}
  }
  env.javaHome = { set: Boolean(javaHome), path: javaHome || null };

  // Maven
  try {
    const { out } = await runEnvCommand('mvn', ['--version']);
    const match = out.match(/Apache Maven ([\d.]+)/);
    env.maven = { installed: true, version: match ? match[1] : 'bilinmiyor' };
  } catch { env.maven = { installed: false }; }

  // Appium
  try {
    const { out, err } = await runEnvCommand('appium', ['--version']);
    env.appium = { installed: true, version: (out || err).trim() };
  } catch { env.appium = { installed: false }; }

  // ANDROID_HOME
  let androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!androidHome) {
    try {
      const { out } = await runEnvCommand('echo', ['$ANDROID_HOME']);
      const val = out.trim();
      if (val) androidHome = val;
    } catch {}
  }
  const adbPath = androidHome ? path.join(androidHome, 'platform-tools', 'adb') : null;
  env.androidHome = {
    set:       Boolean(androidHome),
    path:      androidHome || null,
    adbExists: adbPath ? fs.existsSync(adbPath) : false,
  };

  // Git
  try {
    const { out } = await runEnvCommand('git', ['--version']);
    const match = out.match(/git version ([\d.]+)/);
    env.git = { installed: true, version: match ? match[1] : 'bilinmiyor' };
  } catch { env.git = { installed: false }; }

  return env;
});

ipcMain.handle('check-project-env', (_, projectPath) => {
  const pomPath = path.join(projectPath, 'pom.xml');
  if (!fs.existsSync(pomPath)) return { hasPom: false };
  try {
    const content = fs.readFileSync(pomPath, 'utf-8');
    const pick = (pattern) => { const m = content.match(pattern); return m ? m[1] : null; };
    const requiredJava =
      pick(/<java\.version>(\d+)<\/java\.version>/) ||
      pick(/<maven\.compiler\.source>(\d+)<\/maven\.compiler\.source>/) ||
      pick(/<maven\.compiler\.release>(\d+)<\/maven\.compiler\.release>/) ||
      pick(/<maven\.compiler\.target>(\d+)<\/maven\.compiler\.target>/);
    return { hasPom: true, requiredJava: requiredJava ? parseInt(requiredJava, 10) : null };
  } catch { return { hasPom: false }; }
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-presets', () => loadPresets());

ipcMain.handle('load-run-configs', () => {
  try {
    if (!fs.existsSync(RUN_CONFIGS_PATH)) return [];
    return JSON.parse(fs.readFileSync(RUN_CONFIGS_PATH, 'utf-8'));
  } catch { return []; }
});

ipcMain.handle('save-run-configs', (_, configs) => {
  try {
    const dir = path.dirname(RUN_CONFIGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RUN_CONFIGS_PATH, JSON.stringify(configs, null, 2));
  } catch {}
});

ipcMain.handle('save-filter', (_, projectPath, ids) => {
  try {
    const all = fs.existsSync(FILTERS_PATH)
      ? JSON.parse(fs.readFileSync(FILTERS_PATH, 'utf-8'))
      : {};
    if (ids === null) {
      delete all[projectPath];
    } else {
      all[projectPath] = ids;
    }
    fs.writeFileSync(FILTERS_PATH, JSON.stringify(all, null, 2));
  } catch {}
});

ipcMain.handle('load-filter', (_, projectPath) => {
  try {
    if (!fs.existsSync(FILTERS_PATH)) return null;
    const all = JSON.parse(fs.readFileSync(FILTERS_PATH, 'utf-8'));
    return all[projectPath] ?? null;
  } catch { return null; }
});

function parseFile(filePath, projectRoot) {
  return filePath.endsWith('.spec')
    ? parseSpecFile(filePath, projectRoot)
    : parseFeatureFile(filePath, projectRoot);
}

ipcMain.handle('count-scenarios', (_, localPath) => {
  if (!fs.existsSync(localPath)) return 0;
  try {
    const files = findFeatureFiles(localPath);
    let total = 0;
    for (const file of files) {
      try { total += parseFile(file, localPath).length; } catch {}
    }
    return total;
  } catch { return 0; }
});

ipcMain.handle('check-updates', (_, localPath) => {
  return new Promise(resolve => {
    if (!fs.existsSync(localPath)) return resolve(0);
    const fetch = spawn('git', ['-C', localPath, 'fetch', 'origin'], { shell: false });
    fetch.on('close', () => {
      const rev = spawn('git', ['-C', localPath, 'rev-list', 'HEAD..@{u}', '--count'], { shell: false });
      let out = '';
      rev.stdout.on('data', d => { out += d.toString(); });
      rev.on('close', () => resolve(parseInt(out.trim(), 10) || 0));
      rev.on('error', () => resolve(0));
    });
    fetch.on('error', () => resolve(0));
  });
});

ipcMain.handle('pull-project', (event, { localPath }) => {
  const child = spawn('git', ['-C', localPath, 'pull'], { shell: false });
  child.stdout.on('data', data => {
    event.sender.send('pull-output', { data: data.toString(), type: 'stdout' });
  });
  child.stderr.on('data', data => {
    event.sender.send('pull-output', { data: data.toString(), type: 'stderr' });
  });
  child.on('close', code => {
    event.sender.send('pull-output', { data: '', type: 'exit', code });
  });
  child.on('error', err => {
    event.sender.send('pull-output', { data: `Hata: ${err.message}\n`, type: 'stderr' });
    event.sender.send('pull-output', { data: '', type: 'exit', code: 1 });
  });
  return { ok: true };
});

ipcMain.handle('clone-project', (event, { name, url, parentDir }) => {
  const repoName   = url.split('/').pop();
  const clonedPath = path.join(parentDir, repoName);

  // Klasör zaten varsa (önceki klonlama) direkt kaydet, tekrar klonlama
  if (fs.existsSync(clonedPath)) {
    savePreset(name, clonedPath);
    saveProject(clonedPath);
    event.sender.send('clone-output', {
      data: `Klasör zaten mevcut: ${clonedPath}\nPreset kaydedildi.\n`,
      type: 'stderr',
    });
    event.sender.send('clone-output', { data: '', type: 'exit', code: 0, clonedPath });
    return { ok: true };
  }

  const child = spawn('git', ['clone', '--progress', url, repoName], {
    cwd: parentDir,
    shell: false,
  });

  child.stdout.on('data', data => {
    event.sender.send('clone-output', { data: data.toString(), type: 'stdout' });
  });
  child.stderr.on('data', data => {
    event.sender.send('clone-output', { data: data.toString(), type: 'stderr' });
  });
  child.on('close', code => {
    if (code === 0) {
      savePreset(name, clonedPath);
      saveProject(clonedPath);
    }
    event.sender.send('clone-output', { data: '', type: 'exit', code, clonedPath });
  });
  child.on('error', err => {
    event.sender.send('clone-output', { data: `Hata: ${err.message}\n`, type: 'stderr' });
    event.sender.send('clone-output', { data: '', type: 'exit', code: 1, clonedPath });
  });

  return { ok: true };
});

ipcMain.handle('open-project', (_, projectPath) => {
  if (!fs.existsSync(projectPath)) return { error: 'Klasör bulunamadı: ' + projectPath };
  saveProject(projectPath);
  return { path: projectPath, name: path.basename(projectPath) };
});

ipcMain.handle('load-scenarios', (_, projectPath) => {
  if (!fs.existsSync(projectPath)) return { error: 'Klasör bulunamadı' };
  const featureFiles = findFeatureFiles(projectPath);
  const allScenarios = [];
  for (const file of featureFiles) {
    try {
      allScenarios.push(...parseFile(file, projectPath));
    } catch {}
  }
  return allScenarios;
});

// ── Report parsing helpers ───────────────────────────────────────────────────

function pathsMatch(a, b) {
  const normalize = s => (s || '').replace(/\\/g, '/').replace(/^file:\/\/\//, '').replace(/^file:\/\//, '').replace(/^file:/, '');
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.endsWith('/' + nb) || nb.endsWith('/' + na);
}

function hooksDuration(hooks) {
  return (hooks || []).reduce((sum, h) => sum + (h.result?.duration || 0), 0);
}

function extractScreenshots(hooks) {
  const shots = [];
  for (const hook of (hooks || [])) {
    for (const emb of (hook.embeddings || [])) {
      if ((emb.mime_type || '').startsWith('image/')) {
        shots.push({ data: emb.data, mimeType: emb.mime_type });
      }
    }
  }
  return shots;
}

function normalizeUri(uri, projectPath) {
  let p = (uri || '').replace(/\\/g, '/').replace(/^file:\/\/\//, '').replace(/^file:\/\//, '').replace(/^file:/, '');
  if (path.isAbsolute(p)) p = path.relative(projectPath, p).replace(/\\/g, '/');
  return p;
}

function parseCucumberReport(features, scenario) {
  if (!Array.isArray(features)) return null;
  for (const feature of features) {
    if (!pathsMatch(feature.uri, scenario.filePath)) continue;
    for (const element of (feature.elements || [])) {
      if (element.type === 'background') continue;
      if (Number(element.line) !== Number(scenario.lineNumber)) continue;

      const steps = (element.steps || []).map(s => {
        const r = s.result || {};
        const stepNs = (r.duration || 0) + hooksDuration(s.before) + hooksDuration(s.after);
        const screenshots = [
          ...extractScreenshots(s.before),
          ...extractScreenshots(s.after),
        ];
        return {
          status:       r.status === 'passed' ? 'pass' : r.status === 'failed' ? 'fail' : 'skipped',
          duration:     Math.round(stepNs / 1_000_000),
          errorMessage: r.error_message || null,
          screenshots,
        };
      });

      const scenarioHooksNs = hooksDuration(element.before) + hooksDuration(element.after);
      const failed   = steps.some(s => s.status === 'fail');
      const totalDur = steps.reduce((a, s) => a + s.duration, 0) + Math.round(scenarioHooksNs / 1_000_000);
      return { status: failed ? 'fail' : 'pass', duration: totalDur, steps };
    }
  }
  return null;
}

function cucumberScenarioStatus(element) {
  const steps = element.steps || [];
  const failed = steps.some(s => s.result?.status === 'failed');
  const totalNs = steps.reduce((sum, s) => {
    return sum + (s.result?.duration || 0) + hooksDuration(s.before) + hooksDuration(s.after);
  }, 0) + hooksDuration(element.before) + hooksDuration(element.after);
  return { status: failed ? 'fail' : 'pass', duration: Math.round(totalNs / 1_000_000) };
}

ipcMain.handle('load-all-run-statuses', (_, projectPath) => {
  const reportsDir = path.join(projectPath, 'pegasus-reports');
  if (!fs.existsSync(reportsDir)) return {};
  const files = fs.readdirSync(reportsDir)
    .filter(f => f.startsWith('run_') && f.endsWith('.json'))
    .sort().reverse() // newest first
    .slice(0, 100);   // cap at 100 most recent — older files are irrelevant for current status

  const latest = {}; // key → latest run (any status)
  const latestPass = {}; // key → latest passing run

  for (const file of files) {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf8'));
      if (!Array.isArray(report)) continue;
      for (const feature of report) {
        const relPath = normalizeUri(feature.uri, projectPath);
        for (const element of (feature.elements || [])) {
          if (element.type === 'background') continue;
          const key = `${relPath}:${element.line}`;
          const result = cucumberScenarioStatus(element);
          if (!latest[key]) latest[key] = result;
          if (!latestPass[key] && result.status === 'pass') latestPass[key] = result;
        }
      }
    } catch {}
  }

  // Prefer latest passing run; fall back to latest run
  const statuses = {};
  for (const key of Object.keys(latest)) {
    statuses[key] = latestPass[key] || latest[key];
  }
  return statuses;
});

function generateHtmlReport(data, projectPath) {
  const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmtMs = ms => {
    if (!ms && ms !== 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms/1000).toFixed(1)}s`;
    const m = Math.floor(ms/60000), s = Math.round((ms%60000)/1000);
    return s ? `${m}dk ${s}s` : `${m}dk`;
  };
  const fmtDate = iso => {
    if (!iso) return '—';
    try {
      const d = new Date(iso), p = n => String(n).padStart(2,'0');
      return `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch { return '—'; }
  };

  const { summary, steps = [], stepDurations = [], scenarios = [] } = data;
  const passRate   = summary.totalRuns > 0 ? Math.round(summary.passCount / summary.totalRuns * 100) : 0;
  const now        = fmtDate(new Date().toISOString());
  const projectName = path.basename(projectPath);

  const stepsHtml = steps.length === 0
    ? '<p class="empty">Başarısız adım yok.</p>'
    : steps.map(step => {
        const failRate = step.totalRuns > 0 ? Math.round(step.failCount / step.totalRuns * 100) : 0;
        const failuresHtml = step.failures.map(f => `
          <div class="fi">
            <div class="fi-name">${esc(f.scenarioName)}</div>
            <div class="fi-file">${esc(f.scenarioFile)}:${f.lineNumber} &nbsp;·&nbsp; ${fmtDate(f.runDate)}</div>
            ${f.errorMessage ? `<pre class="fi-err">${esc(f.errorMessage.slice(0,600))}${f.errorMessage.length>600?'\n…':''}</pre>` : ''}
          </div>`).join('');
        return `<div class="sc">
          <div class="sc-hd">
            <span class="sc-text">${esc(step.text)}</span>
            <span class="sc-badge">${step.failCount} başarısızlık &nbsp;·&nbsp; %${failRate} hata</span>
          </div>${failuresHtml}</div>`;
      }).join('');

  const durHtml = stepDurations.slice(0,200).map(r => {
    const fr = r.totalRuns > 0 ? Math.round(r.failCount/r.totalRuns*100) : 0;
    const txt = r.text.length > 90 ? r.text.slice(0,90)+'…' : r.text;
    return `<tr>
      <td title="${esc(r.text)}">${esc(txt)}</td>
      <td class="n">${r.totalRuns}</td>
      <td class="n p">${r.passCount}</td>
      <td class="n f">${r.failCount||'<span style="color:#adb5bd">0</span>'}</td>
      <td class="n">${fr>0?`<span class="f">%${fr}</span>`:'—'}</td>
      <td class="n">${fmtMs(r.minDur)}</td>
      <td class="n b">${fmtMs(r.avgDur)}</td>
      <td class="n">${fmtMs(r.maxDur)}</td></tr>`;
  }).join('');

  const rateColor = passRate >= 80 ? 'p' : passRate >= 50 ? 'w' : 'f';

  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8">
<title>Test Raporu — ${esc(projectName)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5f7;color:#1a1a2e;font-size:14px;line-height:1.5}
.wrap{max-width:1100px;margin:0 auto;padding:36px 24px}
header{margin-bottom:28px}
h1{font-size:22px;font-weight:800}
.meta{font-size:12px;color:#868e96;margin-top:5px}
.sum{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:32px}
.s{background:#fff;border:1px solid #e9ecef;border-radius:10px;padding:14px 20px;min-width:110px}
.sv{font-size:26px;font-weight:800;line-height:1}
.sl{font-size:11px;color:#868e96;margin-top:3px;text-transform:uppercase;letter-spacing:.4px}
.p{color:#2a9d5c}.f{color:#e30613}.w{color:#f4a261}.m{color:#868e96}
section{margin-bottom:40px}
h2{font-size:15px;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e9ecef;display:flex;align-items:center;gap:8px}
.bdg{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:#f1f3f5;color:#495057}
.sc{background:#fff;border:1px solid #e9ecef;border-radius:8px;margin-bottom:10px;overflow:hidden}
.sc-hd{padding:11px 16px;display:flex;justify-content:space-between;align-items:center;background:#f8f9fa;border-bottom:1px solid #e9ecef;gap:12px}
.sc-text{font-size:13px;font-weight:600;flex:1;min-width:0}
.sc-badge{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:#fce8e8;color:#e30613;white-space:nowrap;flex-shrink:0}
.fi{padding:10px 16px;border-bottom:1px solid #f5f5f5}
.fi:last-child{border-bottom:none}
.fi-name{font-size:12px;font-weight:600;color:#343a40}
.fi-file{font-size:11px;color:#adb5bd;font-family:monospace;margin-top:2px}
.fi-err{font-size:11px;color:#c92a2a;background:#fff5f5;border:1px solid #ffd8d8;padding:8px 10px;border-radius:6px;margin-top:6px;white-space:pre-wrap;font-family:monospace;overflow:auto;max-height:140px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e9ecef;border-radius:10px;overflow:hidden}
th{background:#f8f9fa;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#868e96;padding:10px 14px;text-align:left;border-bottom:1px solid #e9ecef;white-space:nowrap}
th.n{text-align:right}
td{padding:8px 14px;font-size:12px;border-bottom:1px solid #f5f5f5}
td.n{text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:none}tr:hover td{background:#f8f9fa}
.b{font-weight:700}
.empty{color:#adb5bd;font-size:13px;padding:24px;text-align:center}
footer{text-align:center;font-size:11px;color:#adb5bd;margin-top:48px;padding-top:16px;border-top:1px solid #e9ecef}
</style></head>
<body><div class="wrap">
  <header>
    <h1>Test Analiz Raporu</h1>
    <p class="meta">Proje: <strong>${esc(projectName)}</strong> &nbsp;·&nbsp; ${now}</p>
  </header>

  <div class="sum">
    <div class="s"><div class="sv m">${summary.totalRuns}</div><div class="sl">Toplam Koşum</div></div>
    <div class="s"><div class="sv p">${summary.passCount}</div><div class="sl">Pass</div></div>
    <div class="s"><div class="sv f">${summary.failCount}</div><div class="sl">Fail</div></div>
    <div class="s"><div class="sv ${rateColor}">%${passRate}</div><div class="sl">Başarı Oranı</div></div>
    <div class="s"><div class="sv f">${steps.length}</div><div class="sl">Başarısız Adım</div></div>
    <div class="s"><div class="sv f">${scenarios.length}</div><div class="sl">Başarısız Senaryo</div></div>
  </div>

  <section>
    <h2>Başarısız Adımlar <span class="bdg">${steps.length}</span></h2>
    ${stepsHtml}
  </section>

  <section>
    <h2>Süre Analizi <span class="bdg">${stepDurations.length} adım</span></h2>
    ${stepDurations.length === 0 ? '<p class="empty">Süre verisi yok.</p>' : `
    <table><thead><tr>
      <th>Adım</th><th class="n">Kullanım</th><th class="n">Pass</th>
      <th class="n">Fail</th><th class="n">Hata %</th>
      <th class="n">Min</th><th class="n">Ortalama</th><th class="n">Maks.</th>
    </tr></thead><tbody>${durHtml}</tbody></table>`}
  </section>

  <footer>Pegasus Test Runner &nbsp;·&nbsp; ${now}</footer>
</div></body></html>`;
}

ipcMain.handle('export-html-report', async (_, { data, projectPath }) => {
  const defaultName = `test-raporu-${new Date().toISOString().slice(0,10)}.html`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'HTML Raporu Kaydet',
    defaultPath: path.join(os.homedir(), 'Desktop', defaultName),
    filters: [{ name: 'HTML Dosyası', extensions: ['html'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  fs.writeFileSync(filePath, generateHtmlReport(data, projectPath), 'utf8');
  return { ok: true, filePath };
});

ipcMain.handle('load-analysis', (_, projectPath) => {
  const reportsDir = path.join(projectPath, 'pegasus-reports');
  if (!fs.existsSync(reportsDir)) return { steps: [], scenarios: [], summary: { totalRuns: 0, passCount: 0, failCount: 0 } };

  const files = fs.readdirSync(reportsDir)
    .filter(f => f.startsWith('run_') && f.endsWith('.json'))
    .sort().reverse();

  const stepMap     = new Map();
  const scenarioMap = new Map();
  let totalRuns = 0, passCount = 0, failCount = 0;

  for (const file of files) {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf8'));
      if (!Array.isArray(report)) continue;

      const m = file.match(/^run_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
      const runDate = m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}` : null;
      const runId   = file.replace('.json', '');

      for (const feature of report) {
        const relPath = normalizeUri(feature.uri, projectPath);
        for (const element of (feature.elements || [])) {
          if (element.type === 'background') continue;
          totalRuns++;
          const elementFailed = (element.steps || []).some(s => s.result?.status === 'failed');
          if (elementFailed) failCount++; else passCount++;

          // Scenario tracking
          const sKey = `${relPath}:${element.line}`;
          if (!scenarioMap.has(sKey)) {
            scenarioMap.set(sKey, { name: element.name, filePath: relPath, lineNumber: element.line, totalRuns: 0, failCount: 0, lastStatus: null });
          }
          const sd = scenarioMap.get(sKey);
          sd.totalRuns++;
          if (elementFailed) sd.failCount++;
          if (sd.lastStatus === null) sd.lastStatus = elementFailed ? 'fail' : 'pass';

          // Step tracking
          for (const step of (element.steps || [])) {
            const stepText = ((step.keyword || '').trim() + ' ' + (step.name || '')).trim();
            if (!stepText) continue;
            if (!stepMap.has(stepText)) stepMap.set(stepText, { text: stepText, totalRuns: 0, failCount: 0, failures: [], durationsMs: [] });
            const st = stepMap.get(stepText);
            st.totalRuns++;
            const stepNs = (step.result?.duration || 0) + hooksDuration(step.before) + hooksDuration(step.after);
            const stepMs = Math.round(stepNs / 1_000_000);
            if (stepMs > 0) st.durationsMs.push(stepMs);
            if (step.result?.status === 'failed') {
              st.failCount++;
              st.failures.push({
                scenarioName: element.name,
                scenarioFile: relPath,
                lineNumber:   element.line,
                runId,
                runDate,
                errorMessage: step.result?.error_message || null,
                screenshots:  extractScreenshots(step.after),
              });
            }
          }
        }
      }
    } catch {}
  }

  const steps = [...stepMap.values()]
    .filter(s => s.failCount > 0)
    .sort((a, b) => b.failCount - a.failCount || b.totalRuns - a.totalRuns);

  const scenarios = [...scenarioMap.values()]
    .filter(s => s.failCount > 0)
    .sort((a, b) => b.failCount - a.failCount);

  const stepDurations = [...stepMap.values()]
    .filter(s => s.durationsMs.length > 0)
    .map(s => {
      const sorted = [...s.durationsMs].sort((a, b) => a - b);
      const sum    = s.durationsMs.reduce((a, b) => a + b, 0);
      return {
        text:      s.text,
        totalRuns: s.totalRuns,
        passCount: s.totalRuns - s.failCount,
        failCount: s.failCount,
        minDur:    sorted[0],
        maxDur:    sorted[sorted.length - 1],
        avgDur:    Math.round(sum / s.durationsMs.length),
      };
    })
    .sort((a, b) => b.avgDur - a.avgDur);

  return { steps, scenarios, stepDurations, summary: { totalRuns, passCount, failCount } };
});

function parseGaugeReport(report, scenario) {
  const suite = report.suiteResult;
  if (!suite) return null;
  for (const specResult of (suite.specResults || [])) {
    const spec = specResult.protoSpec || {};
    if (!pathsMatch(spec.fileName, scenario.filePath)) continue;
    for (const sr of (specResult.scenarioresults || specResult.scenarioResults || [])) {
      const ps = (sr.protoItem || {}).scenario || {};
      const heading = ps.scenarioHeading || ps.heading || '';
      if (heading !== scenario.name) continue;
      const steps = (ps.scenarioItems || [])
        .filter(item => item.step)
        .map(item => {
          const res = (item.step.stepExecutionResult || {}).executionResult || {};
          return {
            status:       res.failed ? 'fail' : 'pass',
            duration:     Math.round((res.executionTime || 0) / 1_000_000),
            errorMessage: res.errorMessage || null,
          };
        });
      const totalDur = Math.round((sr.executionTime || 0) / 1_000_000);
      return { status: sr.failed ? 'fail' : 'pass', duration: totalDur, steps };
    }
  }
  return null;
}

ipcMain.handle('load-scenario-runs', (_, { projectPath, scenario }) => {
  const reportsDir = path.join(projectPath, 'pegasus-reports');
  if (!fs.existsSync(reportsDir)) return [];
  const files = fs.readdirSync(reportsDir)
    .filter(f => f.startsWith('run_') && f.endsWith('.json'))
    .sort().reverse();
  const runs = [];
  for (const file of files) {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf8'));
      const result = Array.isArray(report)
        ? parseCucumberReport(report, scenario)
        : parseGaugeReport(report, scenario);
      if (!result) continue;
      const m = file.match(/^run_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
      runs.push({
        runId:   file.replace('.json', ''),
        runDate: m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}` : null,
        ...result,
      });
    } catch {}
  }
  return runs;
});

// ── Terminal run helpers ─────────────────────────────────────────────────────

const terminalTempDirs = new Map(); // terminalId → tempDir path

function detectProjectType(projectPath) {
  if (fs.existsSync(path.join(projectPath, 'manifest.json'))) return 'gauge';
  if (fs.existsSync(path.join(projectPath, 'pom.xml')))       return 'maven';
  return 'unknown';
}

function copyProjectFiles(src, dest) {
  const SKIP = new Set([
    'target', '.git', '.gitignore', '.idea', 'node_modules',
    '.DS_Store', 'pegasus-reports', '.gradle', 'build',
  ]);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyProjectFiles(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function deleteDirSafe(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function buildRunCommand(projectType, scenarios, reportFile, tempDir) {
  if (projectType === 'maven') {
    // Group by file, build "file:line,file:line2" strings
    const featureArgs = scenarios
      .map(s => `${s.filePath}:${s.lineNumber}`)
      .join(',');
    const reportJson = reportFile.replace(/\\/g, '/');
    return [
      'mvn', 'test',
      `-Dcucumber.features="${featureArgs}"`,
      `-Dcucumber.plugin="json:${reportJson}"`,
    ].join(' ');
  }

  if (projectType === 'gauge') {
    const specArgs = scenarios
      .map(s => `${s.filePath}:${s.lineNumber}`)
      .join(' ');
    return `gauge run ${specArgs}`;
  }

  return null;
}

function sendLog(event, id, text) {
  event.sender.send('terminal-output', { id, data: text, type: 'stdout' });
}

// ── start-terminal ───────────────────────────────────────────────────────────

ipcMain.handle('start-terminal', async (event, { id, projectPath, scenarios }) => {
  const runId      = `run_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_T${id}`;
  const tempDir    = path.join(os.tmpdir(), `pegasus-${runId}`);
  const reportFile = path.join(projectPath, 'pegasus-reports', `${runId}.json`);

  try {
    const projectType = detectProjectType(projectPath);

    // ── 1. Copy project to temp dir ──
    sendLog(event, id, `[Pegasus] Proje kopyalanıyor → ${tempDir}\n`);
    copyProjectFiles(projectPath, tempDir);
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    terminalTempDirs.set(id, tempDir);
    sendLog(event, id, `[Pegasus] Kopyalama tamamlandı. Proje tipi: ${projectType}\n`);

    // ── 2. Build command ──
    const command = buildRunCommand(projectType, scenarios, reportFile, tempDir);
    if (!command) {
      sendLog(event, id, `[Pegasus] HATA: Proje tipi tanınamadı (pom.xml veya manifest.json bulunamadı)\n`);
      event.sender.send('terminal-output', { id, data: '', type: 'exit', code: 1 });
      deleteDirSafe(tempDir);
      terminalTempDirs.delete(id);
      return { ok: false };
    }

    sendLog(event, id, `[Pegasus] Komut: ${command}\n\n`);

    // ── 3. Spawn ──
    const env = { ...process.env, GAUGE_PROJECT_ROOT: tempDir };
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn('cmd',  ['/c', command], { cwd: tempDir, shell: false, env })
      : spawn('zsh',  ['-lc', command], { cwd: tempDir, shell: false, env });
    activeProcesses.set(id, child);

    child.stdout.on('data', data => {
      event.sender.send('terminal-output', { id, data: data.toString(), type: 'stdout' });
    });
    child.stderr.on('data', data => {
      event.sender.send('terminal-output', { id, data: data.toString(), type: 'stderr' });
    });

    child.on('close', code => {
      activeProcesses.delete(id);

      // Gauge: copy result.json from temp to reportFile
      if (detectProjectType(projectPath) === 'gauge') {
        const gaugeSrc = path.join(tempDir, 'reports', 'json-report', 'result.json');
        if (fs.existsSync(gaugeSrc)) {
          try { fs.copyFileSync(gaugeSrc, reportFile); } catch {}
        }
      }

      deleteDirSafe(tempDir);
      terminalTempDirs.delete(id);

      // Collect failed scenario keys so the frontend can spawn a retry terminal
      let failedScenarios = [];
      if (code !== 0 && fs.existsSync(reportFile)) {
        try {
          const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
          if (Array.isArray(report)) {
            for (const feature of report) {
              const relPath = normalizeUri(feature.uri, projectPath);
              for (const element of (feature.elements || [])) {
                if (element.type === 'background') continue;
                const failed = (element.steps || []).some(s => s.result?.status === 'failed');
                if (failed) failedScenarios.push({ filePath: relPath, lineNumber: element.line });
              }
            }
          }
        } catch {}
      }

      event.sender.send('terminal-output', { id, data: '', type: 'exit', code: code ?? 1, reportFile, failedScenarios });
    });

    child.on('error', err => {
      activeProcesses.delete(id);
      deleteDirSafe(tempDir);
      terminalTempDirs.delete(id);
      event.sender.send('terminal-output', { id, data: `Hata: ${err.message}\n`, type: 'stderr' });
      event.sender.send('terminal-output', { id, data: '', type: 'exit', code: 1 });
    });

    return { ok: true, pid: child.pid };
  } catch (err) {
    deleteDirSafe(tempDir);
    terminalTempDirs.delete(id);
    return { ok: false, error: err.message };
  }
});

// ── stop-terminal ────────────────────────────────────────────────────────────

ipcMain.handle('stop-terminal', (_, id) => {
  const child = activeProcesses.get(id);
  if (child) {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (activeProcesses.has(id)) {
        child.kill('SIGKILL');
        activeProcesses.delete(id);
      }
    }, 3000);
  }
  // Cleanup temp dir
  const tempDir = terminalTempDirs.get(id);
  if (tempDir) {
    setTimeout(() => { deleteDirSafe(tempDir); terminalTempDirs.delete(id); }, 3500);
  }
  return { ok: true };
});
