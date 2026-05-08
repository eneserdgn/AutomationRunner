const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

const activeProcesses = new Map(); // terminalId -> child process

const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_START_URL;
const STORE_PATH   = path.join(os.homedir(), '.pegasus-automation-runner', 'projects.json');
const PRESETS_PATH = path.join(os.homedir(), '.pegasus-automation-runner', 'presets.json');
const FILTERS_PATH = path.join(os.homedir(), '.pegasus-automation-runner', 'filters.json');

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
    .sort().reverse();
  const statuses = {};
  for (const file of files) {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf8'));
      if (!Array.isArray(report)) continue;
      for (const feature of report) {
        const relPath = normalizeUri(feature.uri, projectPath);
        for (const element of (feature.elements || [])) {
          if (element.type === 'background') continue;
          const key = `${relPath}:${element.line}`;
          if (statuses[key]) continue; // already have latest
          statuses[key] = cucumberScenarioStatus(element);
        }
      }
    } catch {}
  }
  return statuses;
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

      event.sender.send('terminal-output', { id, data: '', type: 'exit', code: code ?? 1, reportFile });
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
