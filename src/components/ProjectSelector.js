import React, { useEffect, useState, useRef } from 'react';
import './ProjectSelector.css';

const PRESET_PROJECTS = [
  { name: 'Nexum',          url: 'https://git.testinium.io/_pegasus/Nexum' },
  { name: 'ReleaseAndroid', url: 'https://git.testinium.io/_pegasus/ReleaseAndroid' },
  { name: 'ReleaseIOS',     url: 'https://git.testinium.io/_pegasus/ReleaseIOS' },
  { name: 'ReleaseWeb',     url: 'https://git.testinium.io/_pegasus/release-web-bdd' },
  { name: 'Acente',         url: 'https://git.testinium.io/_pegasus/acente-prep' },
  { name: 'PINMobile',      url: 'https://git.testinium.io/_pegasus/PIN-MOBILE-BDD' },
  { name: 'PINWeb',         url: 'https://git.testinium.io/_pegasus/PIN-WEB-BDD' },
];

function shortUrl(url) {
  return url.replace('https://', '').replace('git.testinium.io/_pegasus/', '');
}

function shortPath(p) {
  if (!p) return '';
  const home = window.__home || '';
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  const parts = p.split(/[/\\]/);
  return parts.slice(-2).join('/');
}

// ── Install links ────────────────────────────────────────────────────────────
const INSTALL_LINKS = {
  git:         'https://git-scm.com/downloads',
  java:        'https://adoptium.net/',
  maven:       'https://maven.apache.org/download.cgi',
  appium:      'https://appium.io/docs/en/latest/quickstart/install/',
  androidHome: 'https://developer.android.com/studio',
};

// ── Env Panel ────────────────────────────────────────────────────────────────
function EnvRow({ label, ok, warn, value, installKey }) {
  const icon  = ok ? '✓' : warn ? '⚠' : '✗';
  const cls   = ok ? 'ps-env-ok' : warn ? 'ps-env-warn' : 'ps-env-err';
  const displayValue = ok ? value : (value || (!warn ? 'Yüklü değil' : 'Bulunamadı'));
  return (
    <div className="ps-env-row">
      <span className={`ps-env-icon ${cls}`}>{icon}</span>
      <span className="ps-env-label">{label}</span>
      {displayValue && <span className={`ps-env-value ${!ok ? cls : ''}`}>{displayValue}</span>}
      {!ok && installKey && (
        <button
          className="ps-env-link"
          onClick={() => window.electronAPI?.openInBrowser(INSTALL_LINKS[installKey])}
        >
          Nasıl yüklenir →
        </button>
      )}
    </div>
  );
}

function EnvPanel({ env, onRefresh }) {
  if (!env) return (
    <div className="ps-env-box">
      <span className="ps-env-checking">Kontrol ediliyor…</span>
    </div>
  );

  const anyBad = !env.git?.installed || !env.java?.installed || !env.maven?.installed ||
                 !env.javaHome?.set || !env.androidHome?.set;

  return (
    <div className="ps-env-box">
      <EnvRow
        label="Git"
        ok={env.git?.installed}
        value={env.git?.installed ? `v${env.git.version}` : null}
        installKey="git"
      />
      <EnvRow
        label="Java"
        ok={env.java?.installed}
        value={env.java?.installed ? `v${env.java.version}` : null}
        installKey="java"
      />
      <EnvRow
        label="JAVA_HOME"
        ok={env.javaHome?.set}
        warn={false}
        value={env.javaHome?.set ? shortPath(env.javaHome.path) : null}
        installKey="java"
      />
      <EnvRow
        label="Maven"
        ok={env.maven?.installed}
        value={env.maven?.installed ? `v${env.maven.version}` : null}
        installKey="maven"
      />
      <EnvRow
        label="Appium"
        ok={env.appium?.installed}
        warn={!env.appium?.installed}
        value={env.appium?.installed ? `v${env.appium.version}` : null}
        installKey="appium"
      />
      <EnvRow
        label="ANDROID_HOME"
        ok={env.androidHome?.set && env.androidHome?.adbExists}
        warn={env.androidHome?.set && !env.androidHome?.adbExists}
        value={env.androidHome?.set ? shortPath(env.androidHome.path) : null}
        installKey="androidHome"
      />
      {anyBad && (
        <p className="ps-env-warning">
          ⚠ Eksik araçlar olmadan projeler tam çalışmayabilir.
        </p>
      )}
      <button className="ps-env-refresh" onClick={onRefresh}>↻ Yenile</button>
    </div>
  );
}

// ── Pull Modal ───────────────────────────────────────────────────────────────
function PullModal({ project, localPath, onDone, onClose }) {
  const [phase, setPhase] = useState('pulling');
  const [logs,  setLogs]  = useState([`$ git pull\n\n`]);
  const logRef = useRef();

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.onPullOutput(({ data, type, code }) => {
      if (type === 'exit') {
        setPhase(code === 0 ? 'done' : 'error');
        if (code === 0) onDone?.(project.name);
      } else if (data) {
        setLogs(prev => [...prev, data]);
      }
    });
    window.electronAPI.pullProject({ localPath });
    return () => window.electronAPI.offPullOutput?.();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="ps-overlay" onClick={e => e.target === e.currentTarget && phase !== 'pulling' && onClose()}>
      <div className="ps-clone-modal">
        <div className="ps-clone-header">
          <div className="ps-clone-header-left">
            <span className="ps-clone-icon">↑</span>
            <div>
              <div className="ps-clone-title">{project.name} güncelleniyor</div>
              <div className="ps-clone-url">{localPath}</div>
            </div>
          </div>
          {phase !== 'pulling' && (
            <button className="ps-clone-close" onClick={onClose}>✕</button>
          )}
        </div>
        <div className="ps-clone-log" ref={logRef}>
          <pre className="ps-clone-log-content">{logs.join('')}</pre>
        </div>
        {phase === 'done' && (
          <div className="ps-clone-footer">
            <span className="ps-clone-success">✓ Güncelleme tamamlandı</span>
            <button className="ps-clone-open-btn" onClick={onClose}>Kapat</button>
          </div>
        )}
        {phase === 'error' && (
          <div className="ps-clone-footer">
            <span className="ps-clone-err">✗ Güncelleme başarısız</span>
            <button className="ps-clone-change-btn" onClick={onClose}>Kapat</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Clone Modal ──────────────────────────────────────────────────────────────
function CloneModal({ project, onSuccess, onCloned, onClose }) {
  const [phase,      setPhase]      = useState('ready'); // ready | cloning | done | error
  const [parentDir,  setParentDir]  = useState('');
  const [logs,       setLogs]       = useState([]);
  const [clonedPath, setClonedPath] = useState('');
  const logRef = useRef();

  // Load default clone dir on mount
  useEffect(() => {
    window.electronAPI?.getDefaultCloneDir().then(dir => setParentDir(dir));
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onCloneOutput) return;
    window.electronAPI.onCloneOutput(({ data, type, code, clonedPath: cp }) => {
      if (type === 'exit') {
        setPhase(code === 0 ? 'done' : 'error');
        if (cp) {
          setClonedPath(cp);
          if (code === 0) onCloned?.(cp, project.name);
        }
      } else if (data) {
        setLogs(prev => [...prev, data]);
      }
    });
    return () => window.electronAPI.offCloneOutput?.();
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  async function handleChangDir() {
    const dir = await window.electronAPI?.selectDirectory();
    if (dir) setParentDir(dir);
  }

  function startClone() {
    setPhase('cloning');
    setLogs([`$ git clone ${project.url}\n\n`]);
    window.electronAPI?.cloneProject({ name: project.name, url: project.url, parentDir });
  }

  const repoName = project.url.split('/').pop();
  const fullTarget = parentDir ? `${parentDir}/${repoName}` : '';

  return (
    <div className="ps-overlay" onClick={e => e.target === e.currentTarget && phase !== 'cloning' && onClose()}>
      <div className="ps-clone-modal">

        {/* Header */}
        <div className="ps-clone-header">
          <div className="ps-clone-header-left">
            <span className="ps-clone-icon">📥</span>
            <div>
              <div className="ps-clone-title">{project.name}</div>
              <div className="ps-clone-url">{project.url}</div>
            </div>
          </div>
          {phase !== 'cloning' && (
            <button className="ps-clone-close" onClick={onClose}>✕</button>
          )}
        </div>

        {/* Ready state: show target path + clone button */}
        {phase === 'ready' && (
          <div className="ps-clone-ready">
            <div className="ps-clone-target-label">Klonlanacak konum</div>
            <div className="ps-clone-target-row">
              <span className="ps-clone-target-path" title={fullTarget}>{fullTarget}</span>
              <button className="ps-clone-change-btn" onClick={handleChangDir}>Değiştir</button>
            </div>
            <button className="ps-clone-start-btn" onClick={startClone} disabled={!parentDir}>
              ↓ Klonla
            </button>
          </div>
        )}

        {/* Log output */}
        {(phase === 'cloning' || phase === 'done' || phase === 'error') && (
          <div className="ps-clone-log" ref={logRef}>
            <pre className="ps-clone-log-content">{logs.join('')}</pre>
          </div>
        )}

        {/* Success */}
        {phase === 'done' && (
          <div className="ps-clone-footer">
            <span className="ps-clone-success">✓ Başarıyla klonlandı</span>
            <button className="ps-clone-open-btn" onClick={() => onSuccess(clonedPath, project.name)}>
              📂 Projeyi Aç
            </button>
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="ps-clone-error-box">
            <div className="ps-clone-error-msg">
              ✗ Klonlama başarısız — SSH erişimi olmayabilir.
            </div>
            <p className="ps-clone-error-hint">
              Projeyi manuel olarak indirip klasör seçebilirsin.
            </p>
            <div className="ps-clone-error-actions">
              <button className="ps-clone-change-btn" onClick={() => { setPhase('ready'); setLogs([]); }}>
                ↩ Tekrar Dene
              </button>
              <button
                className="ps-clone-browser-btn"
                onClick={() => window.electronAPI?.openInBrowser(project.url)}
              >
                🌐 Tarayıcıda Aç
              </button>
              <button
                className="ps-clone-pick-btn"
                onClick={async () => {
                  const dir = await window.electronAPI?.selectFolder();
                  if (dir) onSuccess(dir.path, project.name);
                }}
              >
                📂 Klasör Seç
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Preset Card ──────────────────────────────────────────────────────────────
function PresetCard({ project, localPath, updateCount, scenarioCount, checking, onOpen, onClone, onPull }) {
  const cloned = Boolean(localPath);
  const hasUpdate = updateCount > 0;

  return (
    <div className={`ps-card ${cloned ? 'ps-card-cloned' : ''} ${hasUpdate ? 'ps-card-has-update' : ''}`}>
      <div className="ps-card-top">
        <div className="ps-card-name-row">
          <span className="ps-card-name">{project.name}</span>
          {cloned && !hasUpdate && !checking && (
            <span className="ps-card-cloned-badge">✓ klonlandı</span>
          )}
          {checking && (
            <span className="ps-card-checking-badge">kontrol ediliyor…</span>
          )}
          {hasUpdate && (
            <span className="ps-card-update-badge">↑ {updateCount} commit</span>
          )}
        </div>
        {cloned && scenarioCount > 0 && (
          <span className="ps-card-count">{scenarioCount} case</span>
        )}
        <span className="ps-card-repo">{shortUrl(project.url)}</span>
      </div>
      <div className="ps-card-bottom">
        {cloned ? (
          <>
            <span className="ps-card-path" title={localPath}>
              {shortPath(localPath)}
            </span>
            <div className="ps-card-actions">
              {hasUpdate && (
                <button className="ps-card-btn ps-card-btn-update" onClick={onPull}>
                  ↑ Güncelle
                </button>
              )}
              <button className="ps-card-btn ps-card-btn-reclone" onClick={onClone} title="Yeniden klonla">
                ↓
              </button>
              <button className="ps-card-btn ps-card-btn-open" onClick={onOpen}>
                Aç
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="ps-card-notcloned">Klonlanmamış</span>
            <button className="ps-card-btn ps-card-btn-clone" onClick={onClone}>
              ↓ Klonla
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function ProjectSelector({ onProjectOpen }) {
  const [presets,         setPresets]         = useState({});
  const [recents,         setRecents]         = useState([]);
  const [cloning,         setCloning]         = useState(null);
  const [pulling,         setPulling]         = useState(null);
  const [updateCounts,    setUpdateCounts]    = useState({});
  const [scenarioCounts,  setScenarioCounts]  = useState({});
  const [checking,        setChecking]        = useState({});
  const [error,           setError]           = useState('');
  const [envInfo,         setEnvInfo]         = useState(null);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.getPresets().then(p => { setPresets(p); checkAllUpdates(p); });
    window.electronAPI.getProjects().then(setRecents);
    window.electronAPI.checkEnvironment().then(setEnvInfo);
  }, []);

  function checkAllUpdates(presetsMap) {
    if (!window.electronAPI?.checkUpdates) return;
    const clonedProjects = PRESET_PROJECTS.filter(p => presetsMap[p.name]);
    if (!clonedProjects.length) return;

    const checkingInit = {};
    clonedProjects.forEach(p => { checkingInit[p.name] = true; });
    setChecking(checkingInit);

    clonedProjects.forEach(p => {
      const localPath = presetsMap[p.name];
      window.electronAPI.checkUpdates(localPath).then(count => {
        setUpdateCounts(prev => ({ ...prev, [p.name]: count }));
        setChecking(prev => ({ ...prev, [p.name]: false }));
      });
      window.electronAPI.countScenarios(localPath).then(count => {
        setScenarioCounts(prev => ({ ...prev, [p.name]: count }));
      });
    });
  }

  async function handleOpenPreset(project) {
    const localPath = presets[project.name];
    if (!localPath) return;
    const result = await window.electronAPI?.openProject(localPath);
    if (result?.error) setError(result.error);
    else onProjectOpen(result);
  }

  function handleCloned(localPath, name) {
    const updated = { ...presets, [name]: localPath };
    setPresets(updated);
    setChecking(prev => ({ ...prev, [name]: true }));
    window.electronAPI?.checkUpdates(localPath).then(count => {
      setUpdateCounts(prev => ({ ...prev, [name]: count }));
      setChecking(prev => ({ ...prev, [name]: false }));
    });
    window.electronAPI?.countScenarios(localPath).then(count => {
      setScenarioCounts(prev => ({ ...prev, [name]: count }));
    });
  }

  function handlePullDone(name) {
    setUpdateCounts(prev => ({ ...prev, [name]: 0 }));
  }

  function handleCloneSuccess(localPath, name) {
    setPresets(prev => ({ ...prev, [name]: localPath }));
    setCloning(null);
    onProjectOpen({ path: localPath, name });
  }

  async function handleSelectFolder() {
    const project = await window.electronAPI?.selectFolder();
    if (project) onProjectOpen(project);
  }

  async function handleOpenRecent(p) {
    const result = await window.electronAPI?.openProject(p.path);
    if (result?.error) setError(result.error);
    else onProjectOpen(result);
  }

  return (
    <div className="ps-root">
      {/* ── Left panel: preset projects ── */}
      <div className="ps-left">
        <div className="ps-left-header">
          <span className="ps-app-icon"><img src={`${process.env.PUBLIC_URL}/favicon.png`} alt="Pegasus" /></span>
          <div>
            <div className="ps-app-title">Pegasus Automation Runner</div>
            <div className="ps-app-sub">Proje seçin veya klonlayın · Enes Erdoğan</div>
          </div>
        </div>

        <div className="ps-section-row">
          <div className="ps-section-label">Projeler</div>
          <button
            className="ps-refresh-btn"
            onClick={() => checkAllUpdates(presets)}
            disabled={Object.values(checking).some(Boolean)}
            title="Güncellemeleri kontrol et"
          >
            {Object.values(checking).some(Boolean) ? '↻ Kontrol ediliyor…' : '↻ Güncelleme Kontrol Et'}
          </button>
        </div>
        <div className="ps-grid">
          {PRESET_PROJECTS.map(p => (
            <PresetCard
              key={p.name}
              project={p}
              localPath={presets[p.name]}
              updateCount={updateCounts[p.name] || 0}
              scenarioCount={scenarioCounts[p.name] || 0}
              checking={checking[p.name] || false}
              onOpen={() => handleOpenPreset(p)}
              onClone={() => setCloning(p)}
              onPull={() => setPulling({ project: p, localPath: presets[p.name] })}
            />
          ))}
        </div>
      </div>

      {/* ── Right panel: local + recents ── */}
      <div className="ps-right">
        {/* Ortam */}
        <div className="ps-section-label">Ortam</div>
        <EnvPanel env={envInfo} onRefresh={() => window.electronAPI?.checkEnvironment().then(setEnvInfo)} />

        <div className="ps-section-label" style={{ marginTop: 24 }}>Yerel Proje</div>
        <button className="ps-local-btn" onClick={handleSelectFolder}>
          <span className="ps-local-btn-icon">📂</span>
          <div>
            <div className="ps-local-btn-title">Klasör Seç</div>
            <div className="ps-local-btn-sub">Localdeki .feature klasörünü aç</div>
          </div>
        </button>

        {error && <p className="ps-error">{error}</p>}

        {recents.length > 0 && (
          <>
            <div className="ps-section-label" style={{ marginTop: 24 }}>Son Açılanlar</div>
            <ul className="ps-recents">
              {recents.map(p => (
                <li key={p.path} className="ps-recent-item" onClick={() => handleOpenRecent(p)}>
                  <span className="ps-recent-icon">📁</span>
                  <div className="ps-recent-info">
                    <span className="ps-recent-name">{p.name}</span>
                    <span className="ps-recent-path" title={p.path}>{shortPath(p.path)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ── Clone modal ── */}
      {cloning && (
        <CloneModal
          project={cloning}
          onSuccess={handleCloneSuccess}
          onCloned={handleCloned}
          onClose={() => setCloning(null)}
        />
      )}

      {/* ── Pull modal ── */}
      {pulling && (
        <PullModal
          project={pulling.project}
          localPath={pulling.localPath}
          onDone={handlePullDone}
          onClose={() => setPulling(null)}
        />
      )}
    </div>
  );
}
