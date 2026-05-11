import React, { useState, useMemo, useRef } from 'react';
import ScenarioTree from './ScenarioTree';
import './PresetsPanel.css';

/* ── Numeric field ── */
function NumField({ label, value, onChange, unit, min = 0 }) {
  return (
    <div className="pp-form-field">
      <label className="pp-form-label">{label}</label>
      <div className="pp-form-input-wrap">
        <input
          className="pp-form-input"
          type="number"
          min={min}
          value={value}
          onChange={e => onChange(+e.target.value)}
        />
        <span className="pp-form-unit">{unit}</span>
      </div>
    </div>
  );
}

/* ── Preset form modal ── */
function PresetFormModal({ form, setForm, allScenarios, onSave, onCancel }) {
  const selection = useMemo(() => form.scenarioIds, [form.scenarioIds]);

  function toggle(ids, select) {
    setForm(f => {
      const next = new Set(f.scenarioIds);
      ids.forEach(id => select ? next.add(id) : next.delete(id));
      return { ...f, scenarioIds: next };
    });
  }

  const selCount = selection.size;
  const allSelected = selCount === allScenarios.length;

  return (
    <div className="pp-modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="pp-modal">

        <div className="pp-modal-header">
          <span className="pp-modal-title">{form._editing ? 'Preset Düzenle' : 'Yeni Preset'}</span>
          <button className="pp-modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="pp-modal-body">
          {/* Name */}
          <input
            className="pp-form-name"
            placeholder="Preset ismi…"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            maxLength={40}
            autoFocus
          />

          {/* Config */}
          <div className="pp-form-fields">
            <NumField label="Paralel Terminal" value={form.parallel}    onChange={v => setForm(f => ({ ...f, parallel:    v }))} unit="terminal" min={1} />
            <NumField label="Terminal Başına"  value={form.batchSize}   onChange={v => setForm(f => ({ ...f, batchSize:   v }))} unit="case"     min={1} />
            <NumField label="Gecikme"          value={form.delay}       onChange={v => setForm(f => ({ ...f, delay:       v }))} unit="sn"       min={0} />
            <NumField label="Fail Retry"       value={form.retryCount}  onChange={v => setForm(f => ({ ...f, retryCount:  Math.min(3, v) }))} unit="kez" min={0} />
          </div>

          {/* Scenario selection */}
          <div className="pp-scenario-section">
            <div className="pp-scenario-header">
              <span className="pp-scenario-title">Senaryo Seçimi</span>
              <span className="pp-scenario-count">{selCount} / {allScenarios.length} seçili</span>
              <div className="pp-scenario-tools">
                <button className="pp-tool-btn" onClick={() => toggle(allScenarios.map(s => s.id), true)}>Tümünü Seç</button>
                <button className="pp-tool-btn" onClick={() => toggle(allScenarios.map(s => s.id), false)}>Temizle</button>
              </div>
            </div>
            <div className="pp-scenario-tree">
              <ScenarioTree scenarios={allScenarios} selection={selection} onToggle={toggle} />
            </div>
          </div>
        </div>

        <div className="pp-modal-footer">
          <span className="pp-modal-footer-info">
            <b>{selCount}</b> senaryo seçili
          </span>
          <div className="pp-modal-footer-actions">
            <button className="pp-form-cancel" onClick={onCancel}>İptal</button>
            <button
              className="pp-form-save"
              onClick={onSave}
              disabled={!form.name.trim() || selCount === 0}
            >
              Kaydet
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ── Preset card ── */
function PresetCard({ preset, allScenarios, onRun, onEdit, onDelete, dragHandleProps }) {
  const scenarioCount = preset.scenarioIds
    ? preset.scenarioIds.length
    : allScenarios.length;

  return (
    <div className="pp-card">
      <div className="pp-card-drag" {...dragHandleProps} title="Sürükle">
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
          <circle cx="3" cy="2.5"  r="1.2"/><circle cx="7" cy="2.5"  r="1.2"/>
          <circle cx="3" cy="7"    r="1.2"/><circle cx="7" cy="7"    r="1.2"/>
          <circle cx="3" cy="11.5" r="1.2"/><circle cx="7" cy="11.5" r="1.2"/>
        </svg>
      </div>
      <div className="pp-card-body">
        <span className="pp-card-name">{preset.name}</span>
        <div className="pp-card-meta">
          <span className="pp-meta-pill">{scenarioCount} senaryo</span>
          <span className="pp-meta-sep">·</span>
          <span className="pp-meta-pill">{preset.parallel} paralel</span>
          <span className="pp-meta-sep">·</span>
          <span className="pp-meta-pill">{preset.batchSize} case/terminal</span>
          <span className="pp-meta-sep">·</span>
          <span className="pp-meta-pill">{preset.delay}sn gecikme</span>
          {(preset.retryCount > 0) && (
            <>
              <span className="pp-meta-sep">·</span>
              <span className="pp-meta-pill pp-meta-retry">↺ {preset.retryCount}x retry</span>
            </>
          )}
        </div>
      </div>
      <div className="pp-card-actions">
        <button className="pp-card-run" onClick={onRun}>▶ Koşum Başlat</button>
        <button className="pp-card-edit" onClick={onEdit}>Düzenle</button>
        <button className="pp-card-delete" onClick={onDelete}>Sil</button>
      </div>
    </div>
  );
}

/* ── Main panel ── */
export default function PresetsPanel({ presets, allScenarios, onPresetsChange, onRun }) {
  const [editing, setEditing]       = useState(null); // null | 'new' | index
  const [form, setForm]             = useState(null);
  const [dragIdx, setDragIdx]       = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const dragCounter = useRef(0); // tracks nested dragenter/dragleave

  function startNew() {
    setForm({
      _editing:    false,
      name:        '',
      parallel:    1,
      batchSize:   1,
      delay:       60,
      retryCount:  0,
      scenarioIds: new Set(allScenarios.map(s => s.id)),
    });
    setEditing('new');
  }

  function startEdit(i) {
    const p = presets[i];
    setForm({
      _editing:    true,
      name:        p.name,
      parallel:    p.parallel,
      batchSize:   p.batchSize,
      delay:       p.delay,
      retryCount:  p.retryCount ?? 0,
      scenarioIds: p.scenarioIds ? new Set(p.scenarioIds) : new Set(allScenarios.map(s => s.id)),
    });
    setEditing(i);
  }

  function handleSave() {
    const name = form.name.trim();
    if (!name || form.scenarioIds.size === 0) return;
    const entry = {
      name,
      parallel:    Math.max(1, form.parallel    || 1),
      batchSize:   Math.max(1, form.batchSize   || 1),
      delay:       Math.max(0, form.delay       || 0),
      retryCount:  Math.min(3, Math.max(0, form.retryCount || 0)),
      scenarioIds: [...form.scenarioIds],
    };
    const updated = editing === 'new'
      ? [...presets, entry]
      : presets.map((p, i) => i === editing ? entry : p);
    onPresetsChange(updated);
    setEditing(null);
    setForm(null);
  }

  function handleCancel() {
    setEditing(null);
    setForm(null);
  }

  function handleDelete(i) {
    if (editing === i) handleCancel();
    onPresetsChange(presets.filter((_, idx) => idx !== i));
  }

  function handleDragStart(e, i) {
    setDragIdx(i);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnter(i) {
    dragCounter.current += 1;
    setDragOverIdx(i);
  }

  function handleDragLeave() {
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setDragOverIdx(null);
  }

  function handleDrop(e, i) {
    e.preventDefault();
    dragCounter.current = 0;
    if (dragIdx !== null && dragIdx !== i) {
      const updated = [...presets];
      const [moved] = updated.splice(dragIdx, 1);
      updated.splice(i, 0, moved);
      onPresetsChange(updated);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  }

  function handleDragEnd() {
    dragCounter.current = 0;
    setDragIdx(null);
    setDragOverIdx(null);
  }

  return (
    <div className="pp-root">
      <div className="pp-header">
        <div className="pp-header-left">
          <span className="pp-header-title">Koşum Presetleri</span>
          {presets.length > 0 && (
            <span className="pp-header-count">{presets.length}</span>
          )}
        </div>
        <button className="pp-new-btn" onClick={startNew}>
          + Yeni Preset
        </button>
      </div>

      <div className="pp-list">
        {presets.length === 0 && (
          <div className="pp-empty">
            <span className="pp-empty-icon">📋</span>
            <p className="pp-empty-text">Henüz preset yok</p>
            <p className="pp-empty-sub">Sık kullandığın senaryo seçimi ve koşum ayarlarını<br/>kaydet, tekrar oluşturmana gerek kalmasın.</p>
            <button className="pp-empty-btn" onClick={startNew}>İlk preseti oluştur</button>
          </div>
        )}

        {presets.map((p, i) => (
          <div
            key={p.name + i}
            className={[
              'pp-card-wrap',
              dragIdx === i      ? 'pp-card-dragging'  : '',
              dragOverIdx === i  ? 'pp-card-dragover'  : '',
            ].join(' ')}
            draggable
            onDragStart={e => handleDragStart(e, i)}
            onDragEnter={() => handleDragEnter(i)}
            onDragLeave={handleDragLeave}
            onDragOver={e => e.preventDefault()}
            onDrop={e => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
          >
            <PresetCard
              preset={p}
              allScenarios={allScenarios}
              onRun={() => onRun(p)}
              onEdit={() => startEdit(i)}
              onDelete={() => handleDelete(i)}
              dragHandleProps={{ className: 'pp-card-drag' }}
            />
          </div>
        ))}
      </div>

      {form && (
        <PresetFormModal
          form={form}
          setForm={setForm}
          allScenarios={allScenarios}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
