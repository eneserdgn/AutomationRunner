const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getProjects:    () => ipcRenderer.invoke('get-projects'),
  selectFolder:   () => ipcRenderer.invoke('select-folder'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openInBrowser:   (url) => ipcRenderer.invoke('open-in-browser', url),
  openProject:    (projectPath) => ipcRenderer.invoke('open-project', projectPath),
  loadScenarios:  (projectPath) => ipcRenderer.invoke('load-scenarios', projectPath),

  // Preset projects
  getDefaultCloneDir: () => ipcRenderer.invoke('get-default-clone-dir'),
  getPresets:    () => ipcRenderer.invoke('get-presets'),
  cloneProject:   (opts) => ipcRenderer.invoke('clone-project', opts),
  onCloneOutput:  (cb) => ipcRenderer.on('clone-output', (_, data) => cb(data)),
  offCloneOutput: ()   => ipcRenderer.removeAllListeners('clone-output'),
  countScenarios:    (localPath)   => ipcRenderer.invoke('count-scenarios', localPath),
  checkEnvironment:  ()            => ipcRenderer.invoke('check-environment'),
  checkProjectEnv:   (projectPath) => ipcRenderer.invoke('check-project-env', projectPath),
  checkUpdates:   (localPath) => ipcRenderer.invoke('check-updates', localPath),
  pullProject:    (opts) => ipcRenderer.invoke('pull-project', opts),
  onPullOutput:   (cb) => ipcRenderer.on('pull-output', (_, data) => cb(data)),
  offPullOutput:  ()   => ipcRenderer.removeAllListeners('pull-output'),

  // Filter persistence
  saveFilter: (projectPath, ids) => ipcRenderer.invoke('save-filter', projectPath, ids),
  loadFilter: (projectPath)      => ipcRenderer.invoke('load-filter', projectPath),

  // Report runs
  loadScenarioRuns:    (projectPath, scenario) => ipcRenderer.invoke('load-scenario-runs', { projectPath, scenario }),
  loadAllRunStatuses:  (projectPath)           => ipcRenderer.invoke('load-all-run-statuses', projectPath),

  // Auto-update
  onUpdateAvailable:  (cb) => ipcRenderer.on('update-available',  (_, d) => cb(d)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, d) => cb(d)),
  installUpdate:      ()   => ipcRenderer.invoke('install-update'),

  // Terminal execution
  startTerminal:    (opts) => ipcRenderer.invoke('start-terminal', opts),
  stopTerminal:     (id)   => ipcRenderer.invoke('stop-terminal', id),
  onTerminalOutput: (cb)   => ipcRenderer.on('terminal-output', (_, data) => cb(data)),
  offTerminalOutput:()     => ipcRenderer.removeAllListeners('terminal-output'),
});
