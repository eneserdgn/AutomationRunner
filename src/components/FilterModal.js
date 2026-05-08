import React, { useState } from 'react';
import ScenarioTree from './ScenarioTree';
import './FilterModal.css';

export default function FilterModal({ scenarios, activeIds, onApply, onClose }) {
  const [selection, setSelection] = useState(() =>
    activeIds ? new Set(activeIds) : new Set(scenarios.map(s => s.id))
  );

  function toggle(ids, select) {
    setSelection(prev => {
      const next = new Set(prev);
      ids.forEach(id => (select ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  function selectAll()  { toggle(scenarios.map(s => s.id), true); }
  function clearAll()   { toggle(scenarios.map(s => s.id), false); }

  function selectByStatus(status) {
    toggle(scenarios.filter(s => (s.status || 'not-run') === status).map(s => s.id), true);
  }

  function handleApply() {
    const allSelected = scenarios.every(s => selection.has(s.id));
    onApply(allSelected ? null : new Set(selection));
  }

  return (
    <div className="fm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="fm-modal">

        <div className="fm-header">
          <h2 className="fm-title">Senaryo Filtresi</h2>
          <button className="fm-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="fm-toolbar">
          <div className="fm-toolbar-left">
            <button className="fm-tool-btn" onClick={selectAll}>Tümünü Seç</button>
            <button className="fm-tool-btn" onClick={clearAll}>Temizle</button>
          </div>
          <div className="fm-toolbar-right">
            <button className="fm-status-btn fm-status-pass" onClick={() => selectByStatus('pass')}>
              <span className="fm-sdot fm-sdot-pass" /> Pass
            </button>
            <button className="fm-status-btn fm-status-fail" onClick={() => selectByStatus('fail')}>
              <span className="fm-sdot fm-sdot-fail" /> Fail
            </button>
            <button className="fm-status-btn fm-status-notrun" onClick={() => selectByStatus('not-run')}>
              <span className="fm-sdot fm-sdot-notrun" /> Not Run
            </button>
          </div>
        </div>

        <div className="fm-body">
          <ScenarioTree scenarios={scenarios} selection={selection} onToggle={toggle} />
        </div>

        <div className="fm-footer">
          <span className="fm-count">
            {selection.size} / {scenarios.length} senaryo seçili
          </span>
          <div className="fm-footer-actions">
            <button className="fm-btn-cancel" onClick={onClose}>İptal</button>
            <button className="fm-btn-apply" onClick={handleApply}>Uygula</button>
          </div>
        </div>

      </div>
    </div>
  );
}
