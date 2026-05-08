import React, { useState, useMemo, useEffect, useRef } from 'react';
import { buildTree, collectAll, getCommonDirPrefix, formatDuration, formatDurationLong } from '../utils/treeUtils';
import './ScenarioTree.css';

function TriCheckbox({ checked, indeterminate, onChange }) {
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input className="st-checkbox" type="checkbox" ref={ref} checked={checked} onChange={onChange} />;
}

function TreeFolderNode({ name, node, selection, onToggle, depth }) {
  const [open, setOpen] = useState(false);
  const all = useMemo(() => collectAll(node), [node]);

  const selectedCount = all.filter(s => selection.has(s.id)).length;
  const allChecked    = selectedCount === all.length;
  const someChecked   = selectedCount > 0 && !allChecked;

  const pass   = all.filter(s => s.status === 'pass').length;
  const fail   = all.filter(s => s.status === 'fail').length;
  const notRun = all.filter(s => s.status === 'not-run').length;
  const totalMs = all.reduce((s, c) => s + (c.duration || 0), 0);
  const dur    = node.type === 'dir' ? formatDurationLong(totalMs) : formatDuration(totalMs);
  const icon   = node.type === 'file' ? '📄' : '📁';

  return (
    <div className="st-folder" style={{ paddingLeft: depth * 16 }}>
      <div className="st-folder-row">
        <TriCheckbox
          checked={allChecked}
          indeterminate={someChecked}
          onChange={() => onToggle(all.map(s => s.id), !allChecked)}
        />
        <button className="st-expand-btn" onClick={() => setOpen(v => !v)}>
          <span className={`st-arrow ${open ? 'st-arrow-open' : ''}`}>›</span>
        </button>
        <span className="st-folder-icon">{icon}</span>
        <span className="st-folder-name" title={name}>{name}</span>
        <div className="st-folder-stats">
          {pass   > 0 && <span className="st-badge st-badge-pass">{pass}</span>}
          {fail   > 0 && <span className="st-badge st-badge-fail">{fail}</span>}
          {notRun > 0 && <span className="st-badge st-badge-notrun">{notRun}</span>}
          <span className="st-badge st-badge-dur">{dur}</span>
        </div>
      </div>
      {open && (
        <div className="st-folder-body">
          {Object.entries(node.children).map(([childName, childNode]) => (
            <TreeFolderNode
              key={childName}
              name={childName}
              node={childNode}
              selection={selection}
              onToggle={onToggle}
              depth={0}
            />
          ))}
          {node.scenarios.map(s => (
            <TreeScenarioRow
              key={s.id}
              scenario={s}
              checked={selection.has(s.id)}
              onToggle={() => onToggle([s.id], !selection.has(s.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeScenarioRow({ scenario, checked, onToggle }) {
  const status = scenario.status || 'not-run';
  const dur    = formatDuration(scenario.duration);
  return (
    <div className={`st-scenario-row ${checked ? 'st-scenario-checked' : ''}`}>
      <input className="st-checkbox" type="checkbox" checked={checked} onChange={onToggle} />
      <span className={`st-dot st-dot-${status}`} />
      <span className="st-scenario-name" title={scenario.name}>{scenario.name}</span>
      <span className="st-badge st-badge-dur">{dur}</span>
    </div>
  );
}

export default function ScenarioTree({ scenarios, selection, onToggle }) {
  const commonPrefix = useMemo(() => getCommonDirPrefix(scenarios), [scenarios]);
  const tree         = useMemo(() => buildTree(scenarios, commonPrefix), [scenarios, commonPrefix]);

  return (
    <div className="st-root">
      {Object.entries(tree.children).map(([name, node]) => (
        <TreeFolderNode
          key={name}
          name={name}
          node={node}
          selection={selection}
          onToggle={onToggle}
          depth={0}
        />
      ))}
      {tree.scenarios.map(s => (
        <TreeScenarioRow
          key={s.id}
          scenario={s}
          checked={selection.has(s.id)}
          onToggle={() => onToggle([s.id], !selection.has(s.id))}
        />
      ))}
    </div>
  );
}
