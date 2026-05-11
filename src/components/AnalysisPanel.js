import React, { useEffect, useState, useMemo, useCallback } from 'react';
import './AnalysisPanel.css';

function fmtMs(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
  return s ? `${m}dk ${s}s` : `${m}dk`;
}

function formatTabDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return '—'; }
}

function FailBar({ rate }) {
  return (
    <div className="ap-bar-track">
      <div className="ap-bar-fill" style={{ width: `${Math.round(rate * 100)}%` }} />
    </div>
  );
}

function Lightbox({ src, onClose }) {
  return (
    <div className="ap-lightbox-overlay" onClick={onClose}>
      <div className="ap-lightbox-modal" onClick={e => e.stopPropagation()}>
        <button className="ap-lightbox-close" onClick={onClose}>✕</button>
        <img src={src} alt="screenshot" className="ap-lightbox-img" />
      </div>
    </div>
  );
}

function FailureCard({ failure }) {
  const [shotsOpen, setShotsOpen] = useState(false);
  const [lightbox,  setLightbox]  = useState(null);
  const shots = failure.screenshots || [];

  return (
    <div className="ap-failure-card">
      <div className="ap-failure-header">
        <span className="ap-failure-scenario">{failure.scenarioName}</span>
        <span className="ap-failure-date">{formatTabDate(failure.runDate)}</span>
      </div>
      <div className="ap-failure-file">{failure.scenarioFile}:{failure.lineNumber}</div>

      {failure.errorMessage && (
        <pre className="ap-failure-error">{failure.errorMessage}</pre>
      )}

      {shots.length > 0 && (
        <>
          <button
            className={`ap-failure-shots-btn ${shotsOpen ? 'open' : ''}`}
            onClick={() => setShotsOpen(v => !v)}
          >
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
              <rect x="1" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6"/>
              <circle cx="10" cy="10.5" r="3" stroke="currentColor" strokeWidth="1.6"/>
              <path d="M7 4l1.5-2h3L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
            </svg>
            {shots.length} ekran görüntüsü
          </button>
          {shotsOpen && (
            <div className="ap-failure-shots">
              {shots.map((s, i) => (
                <img
                  key={i}
                  src={`data:${s.mimeType};base64,${s.data}`}
                  alt={`ss-${i}`}
                  className="ap-shot-thumb"
                  onClick={() => setLightbox(`data:${s.mimeType};base64,${s.data}`)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function StepDetail({ step, onRun }) {
  const failRate = step.totalRuns > 0 ? step.failCount / step.totalRuns : 0;

  const uniqueScenarios = useMemo(() => [...new Map(
    step.failures.map(f => [`${f.scenarioFile}:${f.lineNumber}`, { filePath: f.scenarioFile, lineNumber: f.lineNumber }])
  ).values()], [step.failures]);

  return (
    <div className="ap-detail">
      <div className="ap-detail-steptext">{step.text}</div>
      <div className="ap-detail-meta">
        <span className="ap-detail-fail">{step.failCount} başarısızlık</span>
        <span className="ap-detail-sep">·</span>
        <span className="ap-detail-total">{step.totalRuns} koşum</span>
        <span className="ap-detail-sep">·</span>
        <span className="ap-detail-rate">%{Math.round(failRate * 100)} hata oranı</span>
        {onRun && (
          <>
            <span className="ap-detail-sep">·</span>
            <button
              className="ap-detail-run-btn"
              onClick={() => onRun(uniqueScenarios)}
              title="Bu adımda başarısız olan senaryoları koş"
            >
              ▶ {uniqueScenarios.length} case'i koş
            </button>
          </>
        )}
      </div>
      <div className="ap-detail-bar-wrap">
        <div className="ap-detail-bar-fill" style={{ width: `${Math.round(failRate * 100)}%` }} />
      </div>

      <h3 className="ap-detail-failures-title">Başarısızlıklar ({step.failures.length})</h3>
      <div className="ap-detail-failures">
        {step.failures.map((f, i) => (
          <FailureCard key={i} failure={f} />
        ))}
      </div>
    </div>
  );
}

function durLevel(avgDur, globalAvg) {
  if (!globalAvg || !avgDur) return '';
  const r = avgDur / globalAvg;
  if (r > 2.0) return 'hot';
  if (r > 1.2) return 'warm';
  if (r < 1.0) return 'cool';
  return '';
}

/* ── Duration tab ── */
const DUR_COLS = [
  { key: 'text',      label: 'Adım',     align: 'left'  },
  { key: 'totalRuns', label: 'Kullanım', align: 'right' },
  { key: 'passCount', label: 'Pass',     align: 'right' },
  { key: 'failCount', label: 'Fail',     align: 'right' },
  { key: 'failRate',  label: 'Hata %',   align: 'right' },
  { key: 'minDur',    label: 'Min',      align: 'right' },
  { key: 'avgDur',    label: 'Ortalama', align: 'right' },
  { key: 'maxDur',    label: 'Maks.',    align: 'right' },
];

function DurationTab({ stepDurations }) {
  const [search,  setSearch]  = useState('');
  const [sortKey, setSortKey] = useState('avgDur');
  const [sortDir, setSortDir] = useState('desc');

  const totals = useMemo(() => {
    if (!stepDurations.length) return null;
    const totalUse  = stepDurations.reduce((s, r) => s + r.totalRuns, 0);
    const totalPass = stepDurations.reduce((s, r) => s + r.passCount, 0);
    const totalFail = stepDurations.reduce((s, r) => s + r.failCount, 0);
    const avgDur    = Math.round(stepDurations.reduce((s, r) => s + r.avgDur, 0) / stepDurations.length);
    const failRate  = totalUse > 0 ? Math.round((totalFail / totalUse) * 100) : 0;
    return { stepCount: stepDurations.length, totalUse, totalPass, totalFail, avgDur, failRate };
  }, [stepDurations]);

  const handleSort = useCallback((key) => {
    setSortDir(d => sortKey === key ? (d === 'desc' ? 'asc' : 'desc') : 'desc');
    setSortKey(key);
  }, [sortKey]);

  const rows = useMemo(() => {
    let list = stepDurations.map(s => ({ ...s, failRate: s.totalRuns > 0 ? s.failCount / s.totalRuns : 0 }));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.text.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      const va = sortKey === 'text' ? a.text : (a[sortKey] ?? 0);
      const vb = sortKey === 'text' ? b.text : (b[sortKey] ?? 0);
      if (sortKey === 'text') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return list;
  }, [stepDurations, search, sortKey, sortDir]);

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="ap-th-sort ap-th-sort-idle">↕</span>;
    return <span className="ap-th-sort">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  return (
    <div className="ap-dur-tab">
      {totals && (
        <div className="ap-dur-summary">
          <div className="ap-dur-sum-item">
            <span className="ap-dur-sum-val">{totals.stepCount}</span>
            <span className="ap-dur-sum-lbl">benzersiz adım</span>
          </div>
          <div className="ap-dur-sum-sep" />
          <div className="ap-dur-sum-item">
            <span className="ap-dur-sum-val">{totals.totalUse}</span>
            <span className="ap-dur-sum-lbl">toplam kullanım</span>
          </div>
          <div className="ap-dur-sum-sep" />
          <div className="ap-dur-sum-item">
            <span className="ap-dur-sum-val ap-val-pass">{totals.totalPass}</span>
            <span className="ap-dur-sum-lbl">pass</span>
          </div>
          <div className="ap-dur-sum-item">
            <span className="ap-dur-sum-val ap-val-fail">{totals.totalFail}</span>
            <span className="ap-dur-sum-lbl">fail</span>
          </div>
          <div className="ap-dur-sum-sep" />
          <div className="ap-dur-sum-item">
            <span className={`ap-dur-sum-val ${totals.failRate === 0 ? 'ap-val-pass' : totals.failRate < 20 ? 'ap-val-warn' : 'ap-val-fail'}`}>
              %{totals.failRate}
            </span>
            <span className="ap-dur-sum-lbl">hata oranı</span>
          </div>
          <div className="ap-dur-sum-sep" />
          <div className="ap-dur-sum-item">
            <span className="ap-dur-sum-val ap-val-warn">{fmtMs(totals.avgDur)}</span>
            <span className="ap-dur-sum-lbl">ort. adım süresi</span>
          </div>
        </div>
      )}

      <div className="ap-search-wrap" style={{ margin: '10px 12px 6px' }}>
        <span className="ap-search-icon">🔍</span>
        <input
          className="ap-search"
          placeholder="Adım ara…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <button className="ap-search-clear" onClick={() => setSearch('')}>✕</button>}
      </div>

      <div className="ap-dur-table-wrap">
        <table className="ap-dur-table">
          <thead>
            <tr>
              {DUR_COLS.map(c => (
                <th
                  key={c.key}
                  className={`ap-th ap-th-${c.align} ${sortKey === c.key ? 'ap-th-active' : ''}`}
                  onClick={() => handleSort(c.key)}
                >
                  {c.label} <SortIcon col={c.key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={DUR_COLS.length} className="ap-dur-empty">Sonuç bulunamadı</td></tr>
            )}
            {rows.map((r, i) => {
              const level = durLevel(r.avgDur, totals?.avgDur);
              return (
              <tr key={i} className={`ap-dur-row ${level ? `ap-dur-row-${level}` : ''}`}>
                <td className="ap-td ap-td-text" title={r.text}>{r.text}</td>
                <td className="ap-td ap-td-num">{r.totalRuns}</td>
                <td className="ap-td ap-td-pass">{r.passCount}</td>
                <td className="ap-td ap-td-fail">{r.failCount > 0 ? r.failCount : <span className="ap-td-zero">0</span>}</td>
                <td className="ap-td ap-td-num">
                  {r.failCount > 0
                    ? <span className="ap-td-fail">%{Math.round(r.failRate * 100)}</span>
                    : <span className="ap-td-zero">—</span>}
                </td>
                <td className="ap-td ap-td-num">{fmtMs(r.minDur)}</td>
                <td className={`ap-td ap-td-num ap-td-avg ${level ? `ap-dur-val-${level}` : ''}`}>
                  {level && <span className="ap-dur-dot" />}
                  {fmtMs(r.avgDur)}
                </td>
                <td className="ap-td ap-td-num">{fmtMs(r.maxDur)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AnalysisPanel({ projectPath, refreshKey, onRunFailures }) {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [subTab,      setSubTab]      = useState('failures'); // 'failures' | 'durations'
  const [exporting,   setExporting]   = useState(false);

  async function handleExport() {
    if (!data || exporting) return;
    setExporting(true);
    try {
      await window.electronAPI?.exportHtmlReport(data, projectPath);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    if (!window.electronAPI?.loadAnalysis) { setLoading(false); return; }
    setLoading(true);
    window.electronAPI.loadAnalysis(projectPath)
      .then(d => { setData(d); setSelectedIdx(0); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [projectPath, refreshKey]);

  const filteredSteps = useMemo(() => {
    if (!data?.steps) return [];
    if (!search.trim()) return data.steps;
    const q = search.toLowerCase();
    return data.steps.filter(s => s.text.toLowerCase().includes(q));
  }, [data, search]);

  if (loading) {
    return (
      <div className="ap-root ap-center">
        <span className="ap-empty-icon">⏳</span>
        <p>Raporlar analiz ediliyor…</p>
      </div>
    );
  }

  if (!data || data.summary.totalRuns === 0) {
    return (
      <div className="ap-root ap-center">
        <span className="ap-empty-icon">📊</span>
        <p>Henüz koşum raporu yok</p>
      </div>
    );
  }

  const { summary } = data;
  const passRate = summary.totalRuns > 0 ? Math.round((summary.passCount / summary.totalRuns) * 100) : 0;
  const selectedStep = filteredSteps[selectedIdx] || null;

  return (
    <div className="ap-root">

      {/* Summary bar */}
      <div className="ap-summary-bar">
        <div className="ap-summary-item">
          <span className="ap-summary-val">{summary.totalRuns}</span>
          <span className="ap-summary-lbl">toplam koşum</span>
        </div>
        <div className="ap-summary-sep" />
        <div className="ap-summary-item">
          <span className="ap-summary-val ap-val-pass">{summary.passCount}</span>
          <span className="ap-summary-lbl">pass</span>
        </div>
        <div className="ap-summary-item">
          <span className="ap-summary-val ap-val-fail">{summary.failCount}</span>
          <span className="ap-summary-lbl">fail</span>
        </div>
        <div className="ap-summary-sep" />
        <div className="ap-summary-item">
          <span className={`ap-summary-val ${passRate >= 80 ? 'ap-val-pass' : passRate >= 50 ? 'ap-val-warn' : 'ap-val-fail'}`}>
            %{passRate}
          </span>
          <span className="ap-summary-lbl">başarı oranı</span>
        </div>
        <div className="ap-summary-sep" />
        <div className="ap-summary-item">
          <span className="ap-summary-val ap-val-fail">{data.steps.length}</span>
          <span className="ap-summary-lbl">başarısız adım</span>
        </div>
        <div className="ap-summary-item">
          <span className="ap-summary-val ap-val-fail">{data.scenarios.length}</span>
          <span className="ap-summary-lbl">başarısız senaryo</span>
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className="ap-subtabs">
        <button
          className={`ap-subtab ${subTab === 'failures' ? 'ap-subtab-active' : ''}`}
          onClick={() => setSubTab('failures')}
        >Hata Analizi</button>
        <button
          className={`ap-subtab ${subTab === 'durations' ? 'ap-subtab-active' : ''}`}
          onClick={() => setSubTab('durations')}
        >Süre Analizi</button>
        <button
          className="ap-export-btn"
          onClick={handleExport}
          disabled={exporting}
          title="HTML rapor olarak dışa aktar"
        >
          {exporting ? '…' : '↓ HTML Rapor'}
        </button>
      </div>

      {subTab === 'durations' ? (
        <DurationTab stepDurations={data.stepDurations || []} />
      ) : (
      <div className="ap-body">

        {/* Left: step list */}
        <div className="ap-list-panel">
          <div className="ap-list-header">
            <span className="ap-list-title">Başarısız Adımlar</span>
            <span className="ap-list-count">{filteredSteps.length}</span>
          </div>
          <div className="ap-search-wrap">
            <span className="ap-search-icon">🔍</span>
            <input
              className="ap-search"
              placeholder="Adım ara…"
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedIdx(0); }}
            />
            {search && (
              <button className="ap-search-clear" onClick={() => setSearch('')}>✕</button>
            )}
          </div>
          <div className="ap-list">
            {filteredSteps.length === 0 && (
              <div className="ap-list-empty">Sonuç bulunamadı</div>
            )}
            {filteredSteps.map((step, i) => {
              const rate = step.totalRuns > 0 ? step.failCount / step.totalRuns : 0;
              return (
                <button
                  key={i}
                  className={`ap-step-item ${i === selectedIdx ? 'ap-step-item-active' : ''}`}
                  onClick={() => setSelectedIdx(i)}
                >
                  <div className="ap-step-item-top">
                    <span className="ap-step-item-text">{step.text}</span>
                    <span className="ap-step-item-counts">
                      <span className="ap-step-fail-cnt">{step.failCount}</span>
                      <span className="ap-step-total-cnt">/{step.totalRuns}</span>
                    </span>
                  </div>
                  <div className="ap-step-item-bottom">
                    <FailBar rate={rate} />
                    <span className="ap-step-rate">%{Math.round(rate * 100)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: step detail */}
        <div className="ap-detail-panel">
          {selectedStep
            ? <StepDetail step={selectedStep} onRun={onRunFailures} />
            : <div className="ap-center"><span className="ap-empty-icon">👈</span><p>Soldan bir adım seçin</p></div>
          }
        </div>

      </div>
      )}
    </div>
  );
}
