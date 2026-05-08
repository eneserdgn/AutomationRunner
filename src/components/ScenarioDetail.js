import React, { useRef, useEffect, useState, useCallback } from 'react';
import './ScenarioDetail.css';

const KEYWORD_META = {
  Given: { color: '#89b4fa' },
  When:  { color: '#f9e2af' },
  Then:  { color: '#a6e3a1' },
  And:   { color: '#94e2d5' },
  But:   { color: '#f38ba8' },
  '*':   { color: '#cba6f7' },
};

function getKeywordMeta(text) {
  for (const [kw, meta] of Object.entries(KEYWORD_META)) {
    const prefix = kw === '*' ? '* ' : kw + ' ';
    if (text.startsWith(prefix) || text === kw) {
      return { kw, rest: text.slice(kw.length), ...meta };
    }
  }
  return { kw: '', rest: text, color: '#6c7086' };
}

function formatMs(ms) {
  if (ms === null || ms === undefined) return null;
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatTabDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return '—'; }
}

function StepTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  const headers = rows[0];
  const dataRows = rows.slice(1);
  return (
    <div className="sd-step-table-wrap">
      <table className="sd-step-table">
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => <td key={ci}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScreenshotViewer({ src, onClose }) {
  return (
    <div className="sd-screenshot-overlay" onClick={onClose}>
      <div className="sd-screenshot-modal" onClick={e => e.stopPropagation()}>
        <button className="sd-screenshot-close" onClick={onClose}>✕</button>
        <img src={src} alt="screenshot" className="sd-screenshot-full" />
      </div>
    </div>
  );
}

function Step({ step }) {
  const { kw, rest, color } = getKeywordMeta(step.text);
  const status      = step.status || 'not-run';
  const dur         = formatMs(step.duration);
  const screenshots = step.screenshots || [];
  const [shotsOpen, setShotsOpen]   = useState(false);
  const [lightbox,  setLightbox]    = useState(null);

  return (
    <div className="sd-step">
      <div className={`sd-step-line sd-step-line-${status}`}>
        <span className={`sd-step-dot sd-step-dot-${status}`} />
        <span className="sd-step-kw" style={{ color }}>{kw || '·'}</span>
        <span className="sd-step-text">{rest}</span>
        <div className="sd-step-right">
          {dur && <span className={`sd-step-dur sd-step-dur-${status}`}>{dur}</span>}
          {screenshots.length > 0 && (
            <button
              className={`sd-step-shots-btn ${shotsOpen ? 'sd-step-shots-btn-open' : ''}`}
              onClick={() => setShotsOpen(v => !v)}
              title={`${screenshots.length} ekran görüntüsü`}
            >
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                <rect x="1" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6"/>
                <circle cx="10" cy="10.5" r="3" stroke="currentColor" strokeWidth="1.6"/>
                <path d="M7 4l1.5-2h3L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
              </svg>
              <span>{screenshots.length}</span>
            </button>
          )}
        </div>
      </div>

      {status === 'fail' && step.errorMessage && (
        <div className="sd-step-error">
          <pre className="sd-step-error-msg">{step.errorMessage}</pre>
        </div>
      )}

      {shotsOpen && screenshots.length > 0 && (
        <div className="sd-step-screenshots">
          {screenshots.map((s, i) => (
            <img
              key={i}
              src={`data:${s.mimeType};base64,${s.data}`}
              alt={`screenshot ${i + 1}`}
              className="sd-step-shot-thumb"
              onClick={() => setLightbox(`data:${s.mimeType};base64,${s.data}`)}
            />
          ))}
        </div>
      )}

      {lightbox && <ScreenshotViewer src={lightbox} onClose={() => setLightbox(null)} />}

      {step.rows && step.rows.length > 0 && (
        <div className="sd-step-table-container">
          <StepTable rows={step.rows} />
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL = { 'pass': 'Pass', 'fail': 'Fail', 'not-run': 'Not Run' };

function ScenarioSummary({ scenario, activeRun, onRun }) {
  const status    = activeRun?.status || 'not-run';
  const stepCount = scenario.steps.length;
  const passCount = activeRun?.steps.filter(s => s.status === 'pass').length  ?? 0;
  const failCount = activeRun?.steps.filter(s => s.status === 'fail').length  ?? 0;
  const skipCount = activeRun?.steps.filter(s => s.status === 'skipped').length ?? 0;

  return (
    <div className="sd-summary">
      <button className="sd-run-btn" onClick={onRun} title="Bu senaryoyu koş">
        <svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor">
          <path d="M1 1l8 4.5-8 4.5V1z"/>
        </svg>
        Koş
      </button>
      <div className="sd-summary-sep" />
      <div className="sd-summary-status">
        <span className={`sd-summary-dot sd-summary-dot-${status}`} />
        <span className={`sd-summary-label-${status}`}>{STATUS_LABEL[status]}</span>
      </div>
      {activeRun && (
        <>
          <div className="sd-summary-sep" />
          <div className="sd-summary-dur">
            <span>Süre:</span>
            <span className="sd-summary-dur-val">{formatMs(activeRun.duration) ?? '—'}</span>
            <span className="sd-summary-dur-note" title="Maven başlangıç süresi (~15-25sn) dahil değil">cucumber</span>
          </div>
          <div className="sd-summary-sep" />
          <div className="sd-summary-steps">
            <span className="sd-steps-pass">{passCount}</span> pass &nbsp;
            <span className="sd-steps-fail">{failCount}</span> fail
            {skipCount > 0 && <> &nbsp;<span className="sd-steps-skip">{skipCount}</span> skip</>}
            &nbsp;/ <span>{stepCount}</span> adım
          </div>
        </>
      )}
    </div>
  );
}

function RunTabs({ runs, activeIndex, onSelect }) {
  if (!runs || runs.length === 0) return null;
  return (
    <div className="sd-run-tabs-wrap">
      <div className="sd-run-tabs">
        {runs.map((run, i) => (
          <button
            key={run.runId}
            className={[
              'sd-run-tab',
              `sd-run-tab-${run.status}`,
              i === activeIndex ? 'sd-run-tab-active' : '',
            ].join(' ')}
            onClick={() => onSelect(i)}
            title={run.runId}
          >
            <span className={`sd-run-tab-icon sd-run-tab-icon-${run.status}`}>
              {run.status === 'pass' ? '✓' : '✕'}
            </span>
            <span className="sd-run-tab-label">{formatTabDate(run.runDate)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ExamplesTable({ lines }) {
  if (!lines || lines.length === 0) return null;
  const rows = lines
    .filter(l => l.startsWith('|'))
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()));
  if (!rows.length) return null;
  const headers = rows[0];
  const dataRows = rows.slice(1);
  return (
    <div className="sd-section">
      <h3 className="sd-section-title">Examples</h3>
      <div className="sd-table-wrap">
        <table className="sd-step-table">
          <thead>
            <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {dataRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => <td key={ci}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ScenarioDetail({ scenario, loading, runs, onRun }) {
  const scrollRef = useRef(null);
  const [activeRunIndex, setActiveRunIndex] = useState(0);

  // Auto-select: latest passing run, else latest run
  useEffect(() => {
    if (!runs || runs.length === 0) { setActiveRunIndex(0); return; }
    const passIdx = runs.findIndex(r => r.status === 'pass');
    setActiveRunIndex(passIdx >= 0 ? passIdx : 0);
  }, [runs]);

  // Reset scroll on scenario change
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [scenario?.id]);

  if (loading) {
    return (
      <main className="sd-root sd-empty">
        <span className="sd-empty-icon">⏳</span>
        <p>Yükleniyor...</p>
      </main>
    );
  }

  if (!scenario) {
    return (
      <main className="sd-root sd-empty">
        <span className="sd-empty-icon">👈</span>
        <p>Soldan bir senaryo seçin</p>
      </main>
    );
  }

  const activeRun = runs?.[activeRunIndex] || null;

  const stepsWithResults = scenario.steps.map((step, i) => {
    const runStep = activeRun?.steps?.[i];
    return {
      ...step,
      status:       runStep?.status       || 'not-run',
      duration:     runStep?.duration     ?? null,
      errorMessage: runStep?.errorMessage || null,
      screenshots:  runStep?.screenshots  || [],
    };
  });

  return (
    <main className="sd-root">
      <div className="sd-scroll" ref={scrollRef}>

        <div className="sd-feature-label">
          <span className="sd-feature-kw">Feature:</span>
          <span className="sd-feature-name">{scenario.featureName}</span>
        </div>

        <div className="sd-title-wrap">
          <h1 className="sd-title">{scenario.name}</h1>
        </div>

        <div className="sd-path">
          <span className="sd-path-icon">📄</span>
          {scenario.filePath}
          <span className="sd-path-sep">:</span>
          <span className="sd-path-line">{scenario.lineNumber}</span>
        </div>

        <ScenarioSummary scenario={scenario} activeRun={activeRun} onRun={() => onRun?.(scenario)} />

        <RunTabs runs={runs} activeIndex={activeRunIndex} onSelect={setActiveRunIndex} />

        <div className="sd-section">
          <h3 className="sd-section-title">Adımlar</h3>
          <div className="sd-steps">
            {stepsWithResults.length === 0 && (
              <p className="sd-no-steps">Adım bulunamadı</p>
            )}
            {stepsWithResults.map((step, i) => (
              <Step key={i} step={step} />
            ))}
          </div>
        </div>

        {scenario.type === 'Scenario Outline' && scenario.examples.length > 0 && (
          <ExamplesTable lines={scenario.examples} />
        )}

      </div>
    </main>
  );
}
