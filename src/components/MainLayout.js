import React, { useEffect, useState, useMemo, useRef } from 'react';
import Sidebar from './Sidebar';
import ScenarioDetail from './ScenarioDetail';
import FilterModal from './FilterModal';
import RunConfigModal from './RunConfigModal';
import ExecutionPanel from './ExecutionPanel';
import './MainLayout.css';

export default function MainLayout({ project, onChangeProject }) {
  const [scenarios, setScenarios]       = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [selectedId, setSelectedId]     = useState(null);
  const [search, setSearch]             = useState('');
  const [activeIds, setActiveIds]       = useState(null);
  const [filterOpen, setFilterOpen]     = useState(false);
  const [refreshKey, setRefreshKey]     = useState(0);

  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runScenarios, setRunScenarios] = useState([]);
  const [execution, setExecution]       = useState(null);
  const [javaWarn, setJavaWarn]         = useState('');
  const [runs, setRuns]                 = useState([]);
  const [runsKey, setRunsKey]           = useState(0);
  const [allRunStatuses, setAllRunStatuses] = useState({});
  const [updateInfo, setUpdateInfo]     = useState(null); // { version, ready }


  useEffect(() => {
    window.electronAPI?.onUpdateAvailable?.(({ version }) =>
      setUpdateInfo({ version, ready: false }));
    window.electronAPI?.onUpdateDownloaded?.(({ version }) =>
      setUpdateInfo({ version, ready: true }));
  }, []);

  // Keep project.path accessible inside the IPC output handler (via closure over ref)
  const projectPathRef = useRef(project.path);
  useEffect(() => { projectPathRef.current = project.path; }, [project.path]);

  // Register terminal output listener once on mount
  useEffect(() => {
    if (!window.electronAPI?.onTerminalOutput) return;

    window.electronAPI.onTerminalOutput(({ id, data, type, code, reportFile }) => {
      setExecution(prev => {
        if (!prev) return prev;

        if (type === 'exit') setRunsKey(k => k + 1);

        const updatedTerminals = prev.terminals.map(t => {
          if (t.id !== id) return t;
          if (type === 'exit') {
            return { ...t, status: code === 0 ? 'done' : 'failed', finishedAt: Date.now(), reportFile: reportFile || null };
          }
          return { ...t, logs: [...t.logs, data] };
        });

        // Dequeue next batch when a terminal finishes
        if (type === 'exit' && prev.queuedBatches.length > 0) {
          const [next, ...rest] = prev.queuedBatches;
          const newId = prev.nextId;
          const newTerminal = {
            id:         newId,
            label:      `Terminal ${newId}`,
            status:     'running',
            logs:       [],
            scenarios:  next.scenarios,
            from:       next.from,
            to:         next.to,
            count:      next.count,
            startedAt:  Date.now(),
          };

          setTimeout(() => {
            window.electronAPI?.startTerminal({
              id:          newId,
              projectPath: projectPathRef.current,
              scenarios:   next.scenarios,
            });
          }, (prev.config.delay || 0) * 1000);

          return {
            ...prev,
            terminals:      [...updatedTerminals, newTerminal],
            queuedBatches:  rest,
            nextId:         newId + 1,
          };
        }

        return { ...prev, terminals: updatedTerminals };
      });
    });

    return () => window.electronAPI.offTerminalOutput?.();
  }, []);

  useEffect(() => {
    setActiveIds(null);
    setSelectedId(null);
    setJavaWarn('');
  }, [project.path]);

  // Filtre değişince kaydet — seçili ID'lerle birlikte o anki tüm senaryo ID'lerini de sakla
  // Böylece yenile sonrası "kasıtlı dışarıda bırakılan" ile "gerçekten yeni" ayırt edilebilir
  useEffect(() => {
    if (loading) return;
    if (!window.electronAPI?.saveFilter) return;
    window.electronAPI.saveFilter(project.path, {
      selected: activeIds ? [...activeIds] : null,
      known:    scenarios.map(s => s.id),
    });
  }, [activeIds]); // eslint-disable-line

  useEffect(() => {
    if (!window.electronAPI?.checkEnvironment || !window.electronAPI?.checkProjectEnv) return;
    Promise.all([
      window.electronAPI.checkEnvironment(),
      window.electronAPI.checkProjectEnv(project.path),
    ]).then(([env, proj]) => {
      const sysJava  = env?.java?.major;
      const reqJava  = proj?.requiredJava;
      if (sysJava && reqJava && sysJava !== reqJava) {
        setJavaWarn(`Bu proje Java ${reqJava} gerektiriyor, sistemde Java ${sysJava} var. Tam çalışmayabilir.`);
      }
    }).catch(() => {});
  }, [project.path]);

  useEffect(() => {
    setLoading(true);
    setError('');
    if (window.electronAPI) {
      window.electronAPI.loadScenarios(project.path).then(async (result) => {
        if (result.error) {
          setError(result.error);
          setScenarios([]);
          setActiveIds(null);
        } else {
          setScenarios(result);
          if (result.length > 0) setSelectedId(prev => prev || result[0].id);

          // Kayıtlı filtreyi yükle
          const saved = await window.electronAPI.loadFilter(project.path);
          if (saved) {
            // Yeni format: { selected, known } | Eski format: array (geriye dönük uyum)
            const selectedIds = Array.isArray(saved) ? saved : (saved.selected ?? null);
            const knownSet    = Array.isArray(saved) ? null : new Set(saved.known || []);
            const currentIds  = result.map(s => s.id);
            const currentSet  = new Set(currentIds);

            if (selectedIds === null) {
              // Kaydedildiğinde "tümü seçili" idi — yeni gelenler de dahil hepsi göster
              setActiveIds(null);
            } else {
              const kept   = selectedIds.filter(id => currentSet.has(id));  // hâlâ var olanlar
              // Gerçekten yeni: kayıt anında hiç bilinmeyenler (knownSet yoksa eski format → güvenli taraf: ekleme)
              const newIds = knownSet
                ? currentIds.filter(id => !knownSet.has(id))
                : currentIds.filter(id => !new Set(selectedIds).has(id));
              const merged = [...kept, ...newIds];
              setActiveIds(merged.length === result.length ? null : new Set(merged));
            }
          } else {
            setActiveIds(null);
          }
        }
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [project.path, refreshKey]);

  useEffect(() => {
    const scenario = scenarios.find(s => s.id === selectedId);
    if (!scenario || !window.electronAPI?.loadScenarioRuns) { setRuns([]); return; }
    window.electronAPI.loadScenarioRuns(project.path, scenario).then(setRuns).catch(() => setRuns([]));
  }, [selectedId, runsKey, project.path]); // eslint-disable-line

  useEffect(() => {
    if (!window.electronAPI?.loadAllRunStatuses) return;
    window.electronAPI.loadAllRunStatuses(project.path).then(setAllRunStatuses).catch(() => {});
  }, [project.path, runsKey]); // eslint-disable-line

  const enrichedScenarios = useMemo(() => {
    if (!allRunStatuses || Object.keys(allRunStatuses).length === 0) return scenarios;
    return scenarios.map(s => {
      const rs = allRunStatuses[`${s.filePath}:${s.lineNumber}`];
      return rs ? { ...s, status: rs.status, duration: rs.duration } : s;
    });
  }, [scenarios, allRunStatuses]);

  const visible = useMemo(() => {
    let list = activeIds ? enrichedScenarios.filter(s => activeIds.has(s.id)) : enrichedScenarios;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.featureName.toLowerCase().includes(q) ||
        s.steps.some(step => (step.text || step).toLowerCase().includes(q))
      );
    }
    return list;
  }, [enrichedScenarios, activeIds, search]);

  const selected   = enrichedScenarios.find(s => s.id === selectedId) || null;
  const isFiltered = activeIds !== null;

  function openRunModal(scenarioList, tab = 0) {
    setRunScenarios(scenarioList);
    setRunModalOpen(tab);
  }

  function handleRunStart(config) {
    const { batches, parallel, delay } = config;
    const initialBatches = batches.slice(0, parallel);
    const queuedBatches  = batches.slice(parallel);
    const isSingle       = batches.reduce((s, b) => s + b.count, 0) === 1;

    setExecution(prev => {
      const existingTerminals = prev?.terminals ?? [];
      const startId = (prev?.nextId ?? 1);

      const newTerminals = initialBatches.map((batch, i) => ({
        id:        startId + i,
        label:     isSingle && batch.scenarios.length === 1
                     ? batch.scenarios[0].name
                     : `Terminal ${startId + i}`,
        status:    'running',
        logs:      [],
        scenarios: batch.scenarios,
        from:      batch.from,
        to:        batch.to,
        count:     batch.count,
        startedAt: Date.now(),
      }));

      // Spawn initial terminals with staggered delay
      initialBatches.forEach((batch, i) => {
        setTimeout(() => {
          window.electronAPI?.startTerminal({
            id:          startId + i,
            projectPath: project.path,
            scenarios:   batch.scenarios,
          });
        }, i * (delay || 0) * 1000);
      });

      return {
        config,
        terminals:     [...existingTerminals, ...newTerminals],
        queuedBatches,
        nextId:        startId + initialBatches.length,
      };
    });

    setRunModalOpen(false);
  }

  function handleStopTerminal(id) {
    window.electronAPI?.stopTerminal(id);
    setExecution(prev => prev ? {
      ...prev,
      terminals: prev.terminals.map(t =>
        t.id === id ? { ...t, status: 'stopped', finishedAt: Date.now() } : t
      ),
    } : prev);
  }

  function handleCloseTerminal(id) {
    window.electronAPI?.stopTerminal(id);
    setExecution(prev => {
      if (!prev) return prev;
      const terminals = prev.terminals.filter(t => t.id !== id);
      if (terminals.length === 0 && prev.queuedBatches.length === 0) return null;
      return { ...prev, terminals };
    });
  }

  function handleStopAll() {
    if (!execution) return;
    execution.terminals.forEach(t => {
      if (t.status === 'running') window.electronAPI?.stopTerminal(t.id);
    });
    setExecution(prev => prev ? {
      ...prev,
      terminals:      prev.terminals.map(t =>
        t.status === 'running' ? { ...t, status: 'stopped', finishedAt: Date.now() } : t
      ),
      queuedBatches: [],
    } : prev);
  }

  return (
    <div className="layout-root">
      <div className="layout-titlebar">
        <div className="layout-titlebar-left">
          <span className="layout-app-icon"><img src={`${process.env.PUBLIC_URL}/favicon.png`} alt="Pegasus" /></span>
          <span className="layout-project-name">{project.name}</span>
        </div>
        <button className="layout-change-btn" onClick={onChangeProject}>← Proje Değiştir</button>
      </div>

      {javaWarn && (
        <div className="layout-java-warn">
          ⚠ {javaWarn}
          <button className="layout-java-warn-close" onClick={() => setJavaWarn('')}>×</button>
        </div>
      )}

      {updateInfo && (
        <div className={`layout-update-banner ${updateInfo.ready ? 'layout-update-ready' : ''}`}>
          {updateInfo.ready
            ? <>✦ v{updateInfo.version} indirildi — <button className="layout-update-install-btn" onClick={() => window.electronAPI?.installUpdate()}>Şimdi Kur ve Yeniden Başlat</button></>
            : <>↓ v{updateInfo.version} indiriliyor…</>
          }
          <button className="layout-update-close" onClick={() => setUpdateInfo(null)}>×</button>
        </div>
      )}

      <div className="layout-body">
        <Sidebar
          scenarios={visible}
          totalCount={scenarios.length}
          selectedId={selectedId}
          onSelect={setSelectedId}
          search={search}
          onSearch={setSearch}
          loading={loading}
          error={error}
          onOpenFilter={() => setFilterOpen(true)}
          isFiltered={isFiltered}
          onRefresh={() => setRefreshKey(k => k + 1)}
          onRun={() => openRunModal(visible, 0)}
        />
        <ScenarioDetail
          scenario={selected}
          loading={loading}
          runs={runs}
          onRun={() => openRunModal(selected ? [selected] : [], 1)}
        />
      </div>

      <ExecutionPanel
        execution={execution}
        onStopTerminal={handleStopTerminal}
        onCloseTerminal={handleCloseTerminal}
        onStopAll={handleStopAll}
        onClear={() => setExecution(null)}
      />

      {filterOpen && (
        <FilterModal
          scenarios={enrichedScenarios}
          activeIds={activeIds}
          onApply={ids => { setActiveIds(ids); setFilterOpen(false); }}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {runModalOpen !== false && (
        <RunConfigModal
          allScenarios={visible}
          initialSelection={runScenarios.length === visible.length ? null : new Set(runScenarios.map(s => s.id))}
          initialTab={runModalOpen}
          onStart={handleRunStart}
          onClose={() => setRunModalOpen(false)}
        />
      )}
    </div>
  );
}
