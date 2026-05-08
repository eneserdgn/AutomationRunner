import React, { useState, useMemo } from 'react';
import ScenarioTree from './ScenarioTree';
import './RunConfigModal.css';

function fmt(s) {
  if (!s) return '0s';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}dk ${r}s` : `${m}dk`;
}

function TabBar({ active, onChange }) {
  return (
    <div className="rcm-tabs">
      <button className={`rcm-tab ${active === 0 ? 'rcm-tab-active' : ''}`} onClick={() => onChange(0)}>
        <span className="rcm-tab-num">1</span> Senaryo Seçimi
      </button>
      <span className="rcm-tab-sep">›</span>
      <button className={`rcm-tab ${active === 1 ? 'rcm-tab-active' : ''}`} onClick={() => onChange(1)}>
        <span className="rcm-tab-num">2</span> Koşum Ayarları
      </button>
    </div>
  );
}

function SelectionTab({ allScenarios, selection, onToggle }) {
  function selectByStatus(status) {
    const ids = allScenarios.filter(s => (s.status || 'not-run') === status).map(s => s.id);
    onToggle(ids, true);
  }

  return (
    <div className="rcm-sel-tab">
      <div className="rcm-sel-toolbar">
        <div className="rcm-sel-toolbar-left">
          <button className="rcm-tool-btn" onClick={() => onToggle(allScenarios.map(s => s.id), true)}>Tümünü Seç</button>
          <button className="rcm-tool-btn" onClick={() => onToggle(allScenarios.map(s => s.id), false)}>Temizle</button>
        </div>
        <div className="rcm-sel-toolbar-right">
          <button className="rcm-status-btn rcm-status-pass"   onClick={() => selectByStatus('pass')}>
            <span className="rcm-sdot rcm-sdot-pass" /> Pass
          </button>
          <button className="rcm-status-btn rcm-status-fail"   onClick={() => selectByStatus('fail')}>
            <span className="rcm-sdot rcm-sdot-fail" /> Fail
          </button>
          <button className="rcm-status-btn rcm-status-notrun" onClick={() => selectByStatus('not-run')}>
            <span className="rcm-sdot rcm-sdot-notrun" /> Not Run
          </button>
        </div>
      </div>
      <div className="rcm-sel-tree">
        <ScenarioTree scenarios={allScenarios} selection={selection} onToggle={onToggle} />
      </div>
    </div>
  );
}

function ConfigTab({ count, parallel, setParallel, batchSize, setBatchSize, delay, setDelay }) {
  const safeParallel  = Math.max(1, parallel  || 1);
  const safeBatchSize = Math.max(1, batchSize || 1);
  const safeDelay     = Math.max(0, delay     || 0);

  const batches = useMemo(() => {
    const result = [];
    for (let i = 0; i < count; i += safeBatchSize) {
      result.push({ from: i + 1, to: Math.min(i + safeBatchSize, count), count: Math.min(safeBatchSize, count - i) });
    }
    return result;
  }, [count, safeBatchSize]);

  const initialBatches = batches.slice(0, safeParallel);
  const queuedBatches  = batches.slice(safeParallel);
  const queuedCount    = queuedBatches.reduce((s, b) => s + b.count, 0);
  const previewMax     = 7;
  const shown          = initialBatches.slice(0, previewMax);
  const hiddenCount    = initialBatches.length - shown.length;

  return (
    <div className="rcm-cfg-tab">
      <div className="rcm-count-row">
        <span className="rcm-count-num">{count}</span>
        <span className="rcm-count-lbl">senaryo seçili</span>
      </div>

      <div className="rcm-fields">
        <div className="rcm-field">
          <label className="rcm-label">Paralel Terminal</label>
          <div className="rcm-input-wrap">
            <input className="rcm-input" type="number" min="1" value={parallel}
              onChange={e => setParallel(+e.target.value)} />
            <span className="rcm-input-unit">terminal</span>
          </div>
        </div>
        <div className="rcm-field">
          <label className="rcm-label">Terminal Başına Case</label>
          <div className="rcm-input-wrap">
            <input className="rcm-input" type="number" min="1" value={batchSize}
              onChange={e => setBatchSize(+e.target.value)} />
            <span className="rcm-input-unit">case</span>
          </div>
        </div>
        <div className="rcm-field">
          <label className="rcm-label">Terminal Gecikmesi</label>
          <div className="rcm-input-wrap">
            <input className="rcm-input" type="number" min="0" value={delay}
              onChange={e => setDelay(+e.target.value)} />
            <span className="rcm-input-unit">sn</span>
          </div>
        </div>
      </div>

      <div className="rcm-preview">
        <div className="rcm-preview-title">
          Önizleme
          <span className="rcm-preview-sub">{batches.length} batch · {safeParallel} max paralel</span>
        </div>
        <div className="rcm-timeline">
          {shown.map((b, i) => (
            <div key={i} className="rcm-trow">
              <span className="rcm-trow-id">T{i + 1}</span>
              <span className="rcm-trow-cases">case {b.from}–{b.to}</span>
              <span className="rcm-trow-count">{b.count} case</span>
              <span className="rcm-trow-time">{safeDelay === 0 ? 't: 0s' : `t: ${fmt(i * safeDelay)}`}</span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="rcm-trow rcm-trow-more">
              + {hiddenCount} terminal daha ({fmt(previewMax * safeDelay)} – {fmt((initialBatches.length - 1) * safeDelay)})
            </div>
          )}
          {queuedBatches.length > 0 && (
            <div className="rcm-queue-row">
              <span>⏳</span>
              <span>
                <strong>{queuedCount} case</strong> kuyrukta ({queuedBatches.length} batch)
                — terminaller bitince {safeDelay > 0 ? `${safeDelay}sn gecikmeyle` : 'hemen'} açılır
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RunConfigModal({ allScenarios, initialSelection, initialTab = 0, onStart, onClose }) {
  const [tab, setTab] = useState(initialTab);

  const [selection, setSelection] = useState(
    () => initialSelection ?? new Set(allScenarios.map(s => s.id))
  );
  const [parallel,  setParallel]  = useState(1);
  const [batchSize, setBatchSize] = useState(() => (initialSelection ? initialSelection.size : allScenarios.length) || 1);
  const [delay,     setDelay]     = useState(60);

  function toggle(ids, select) {
    setSelection(prev => {
      const next = new Set(prev);
      ids.forEach(id => (select ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  const selectedScenarios = allScenarios.filter(s => selection.has(s.id));
  const count = selectedScenarios.length;

  const safeParallel  = Math.max(1, parallel  || 1);
  const safeBatchSize = Math.max(1, batchSize || 1);
  const safeDelay     = Math.max(0, delay     || 0);

  function buildBatches() {
    const result = [];
    for (let i = 0; i < count; i += safeBatchSize) {
      const slice = selectedScenarios.slice(i, i + safeBatchSize);
      result.push({ index: result.length, from: i + 1, to: i + slice.length, count: slice.length, scenarios: slice });
    }
    return result;
  }

  function handleStart() {
    const batches = buildBatches();
    onStart({ parallel: safeParallel, batchSize: safeBatchSize, delay: safeDelay, batches });
  }

  return (
    <div className="rcm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rcm-modal">

        <div className="rcm-header">
          <div className="rcm-header-left">
            <span className="rcm-header-icon">▶</span>
            <h2 className="rcm-title">Koşum Yapılandırması</h2>
          </div>
          <button className="rcm-close" onClick={onClose}>✕</button>
        </div>

        <TabBar active={tab} onChange={setTab} />

        <div className="rcm-body">
          {tab === 0 && (
            <SelectionTab allScenarios={allScenarios} selection={selection} onToggle={toggle} />
          )}
          {tab === 1 && (
            <ConfigTab
              count={count}
              parallel={parallel}   setParallel={setParallel}
              batchSize={batchSize} setBatchSize={setBatchSize}
              delay={delay}         setDelay={setDelay}
            />
          )}
        </div>

        <div className="rcm-footer">
          {tab === 0 ? (
            <>
              <span className="rcm-footer-info">
                <b>{count}</b> / {allScenarios.length} senaryo seçili
              </span>
              <div className="rcm-footer-actions">
                <button className="rcm-btn-cancel" onClick={onClose}>İptal</button>
                <button className="rcm-btn-next" onClick={() => setTab(1)} disabled={count === 0}>
                  İleri →
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="rcm-footer-info">
                <b>{count}</b> senaryo · <b>{Math.ceil(count / Math.max(1, batchSize))}</b> batch
              </span>
              <div className="rcm-footer-actions">
                {initialTab === 0 && (
                  <button className="rcm-btn-back" onClick={() => setTab(0)}>← Geri</button>
                )}
                <button className="rcm-btn-cancel" onClick={onClose}>İptal</button>
                <button className="rcm-btn-start" onClick={handleStart} disabled={count === 0}>
                  ▶ Başlat
                </button>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
