import React, { useState, useEffect, useRef } from 'react';
import './ExecutionPanel.css';

function useDuration(startedAt, finishedAt) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (finishedAt) return;
    const t = setInterval(() => setTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, [finishedAt]);

  const end = finishedAt || Date.now();
  const ms  = end - (startedAt || end);

  if (ms < 0) {
    const s = Math.ceil(-ms / 1000);
    return { text: `${s}s`, countdown: true };
  }
  const s = Math.floor(ms / 1000);
  return { text: s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`, countdown: false };
}

function StatusIcon({ status }) {
  if (status === 'running') return <span className="ep-status-spin">◌</span>;
  if (status === 'done')    return <span className="ep-status-ok">✓</span>;
  if (status === 'failed')  return <span className="ep-status-fail">✕</span>;
  if (status === 'stopped') return <span className="ep-status-stop">■</span>;
  return <span className="ep-status-queue">◷</span>;
}

function TerminalTab({ terminal, isActive, onClick, onStop, onClose }) {
  const dur = useDuration(terminal.startedAt, terminal.finishedAt);
  return (
    <div
      className={[
        'ep-tab',
        `ep-tab-${terminal.status}`,
        isActive ? 'ep-tab-active' : '',
      ].join(' ')}
      onClick={onClick}
      title={terminal.label}
    >
      <StatusIcon status={terminal.status} />
      <span className="ep-tab-label">{terminal.label}</span>
      {dur.countdown
        ? <span className="ep-tab-dur ep-tab-dur-countdown">▶ {dur.text}</span>
        : <span className="ep-tab-dur">{dur.text}</span>
      }
      {terminal.status === 'running' && !dur.countdown && (
        <button
          className="ep-tab-stop"
          onClick={e => { e.stopPropagation(); onStop(); }}
          title="Durdur"
        >■</button>
      )}
      <button
        className="ep-tab-close"
        onClick={e => { e.stopPropagation(); onClose(); }}
        title="Kapat"
      >×</button>
    </div>
  );
}

function QueuedTab({ batch, index }) {
  return (
    <div className="ep-tab ep-tab-queued ep-tab-queued-item" title={`${batch.count} senaryo bekliyor`}>
      <span className="ep-status-queue">◷</span>
      <span className="ep-tab-label">Sırada {index + 1}</span>
      <span className="ep-tab-count">{batch.count} case</span>
    </div>
  );
}

function LogArea({ logs }) {
  const containerRef = useRef();
  useEffect(() => {
    if (containerRef.current)
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [logs]);
  return (
    <div className="ep-log" ref={containerRef}>
      {logs.length === 0
        ? <span className="ep-log-waiting">Çıktı bekleniyor…</span>
        : <pre className="ep-log-content">{logs.join('')}</pre>
      }
    </div>
  );
}

export default function ExecutionPanel({ execution, onStopTerminal, onCloseTerminal, onStopAll, onClear }) {
  const [expanded, setExpanded] = useState(true);
  const [activeId, setActiveId] = useState(null);

  const terminals     = execution?.terminals     ?? [];
  const queuedBatches = execution?.queuedBatches ?? [];

  // auto-select: prefer running, else last
  useEffect(() => {
    if (terminals.length === 0) { setActiveId(null); return; }
    const stillExists = terminals.find(t => t.id === activeId);
    if (stillExists) return;
    const running = terminals.find(t => t.status === 'running');
    setActiveId((running ?? terminals[terminals.length - 1]).id);
  }, [terminals]); // eslint-disable-line

  if (!execution) return null;

  const runningCount  = terminals.filter(t => t.status === 'running').length;
  const failedCount   = terminals.filter(t => t.status === 'failed').length;
  const doneCount     = terminals.filter(t => t.status === 'done').length;
  const stoppedCount  = terminals.filter(t => t.status === 'stopped').length;
  const allDone       = runningCount === 0 && queuedBatches.length === 0;
  const activeTerminal = terminals.find(t => t.id === activeId);

  function closeTab(id) {
    onCloseTerminal?.(id);
    if (activeId === id) {
      const others = terminals.filter(t => t.id !== id);
      setActiveId(others.length > 0 ? others[others.length - 1].id : null);
    }
  }

  return (
    <div className={`ep-root ${expanded ? 'ep-expanded' : ''}`}>

      {/* ── Header ── */}
      <div className="ep-header" onClick={() => setExpanded(v => !v)}>
        <div className="ep-header-left">
          {runningCount > 0
            ? <span className="ep-header-icon ep-header-icon-spin">◌</span>
            : <span className="ep-header-icon">▶</span>
          }
          <span className="ep-header-title">Koşumlar</span>

          {runningCount > 0 && (
            <span className="ep-badge ep-badge-running">▶ {runningCount} çalışıyor</span>
          )}
          {queuedBatches.length > 0 && (
            <span className="ep-badge ep-badge-queue">◷ {queuedBatches.length} bekliyor</span>
          )}
          {doneCount > 0 && (
            <span className="ep-badge ep-badge-done">✓ {doneCount} tamamlandı</span>
          )}
          {failedCount > 0 && (
            <span className="ep-badge ep-badge-failed">✕ {failedCount} hatalı</span>
          )}
          {stoppedCount > 0 && (
            <span className="ep-badge ep-badge-stopped">■ {stoppedCount} durduruldu</span>
          )}
        </div>
        <div className="ep-header-right">
          {runningCount > 0 && (
            <button
              className="ep-stop-all-btn"
              onClick={e => { e.stopPropagation(); onStopAll?.(); }}
            >■ Tümünü Durdur</button>
          )}
          {allDone && terminals.length > 0 && (
            <button
              className="ep-clear-btn"
              onClick={e => { e.stopPropagation(); onClear?.(); }}
            >Temizle</button>
          )}
          <span className="ep-toggle">{expanded ? '▼' : '▲'}</span>
        </div>
      </div>

      {/* ── Body ── */}
      {expanded && (
        <div className="ep-body">

          {/* Tab bar */}
          <div className="ep-tabbar">
            {terminals.map(t => (
              <TerminalTab
                key={t.id}
                terminal={t}
                isActive={t.id === activeId}
                onClick={() => setActiveId(t.id)}
                onStop={() => onStopTerminal?.(t.id)}
                onClose={() => closeTab(t.id)}
              />
            ))}
            {queuedBatches.map((b, i) => (
              <QueuedTab key={i} batch={b} index={i} />
            ))}
          </div>

          {/* Log */}
          {activeTerminal
            ? <LogArea logs={activeTerminal.logs} />
            : <div className="ep-log ep-log-placeholder">— terminal yok —</div>
          }
        </div>
      )}
    </div>
  );
}
