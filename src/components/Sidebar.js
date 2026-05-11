import React, { useMemo, useState } from 'react';
import { getCommonDirPrefix, buildTree, collectAll, formatDuration, formatDurationLong } from '../utils/treeUtils';
import './Sidebar.css';

function FolderNode({ name, node, folderPath, selectedId, onSelect, depth, searchActive, openMap, onToggle }) {
  const allScenarios = useMemo(() => collectAll(node), [node]);
  const pass   = allScenarios.filter(s => s.status === 'pass').length;
  const fail   = allScenarios.filter(s => s.status === 'fail').length;
  const notRun = allScenarios.filter(s => s.status === 'not-run').length;
  const totalMs = allScenarios.reduce((s, c) => s + (c.duration || 0), 0);
  const dur    = node.type === 'dir' ? formatDurationLong(totalMs) : formatDuration(totalMs);
  const icon   = node.type === 'file' ? '📄' : '📁';
  const isOpen = searchActive || !!openMap[folderPath];

  return (
    <div className="sf-folder" style={{ paddingLeft: depth * 10 }}>
      <button className="sf-folder-header" onClick={() => onToggle(folderPath)}>
        <span className={`sf-arrow ${isOpen ? 'sf-arrow-open' : ''}`}>›</span>
        <span className="sf-folder-icon">{icon}</span>
        <span className="sf-folder-name" title={name}>{name}</span>
        <div className="sf-folder-stats">
          {pass   > 0 && <span className="sf-badge sf-badge-pass">{pass}</span>}
          {fail   > 0 && <span className="sf-badge sf-badge-fail">{fail}</span>}
          {notRun > 0 && <span className="sf-badge sf-badge-notrun">{notRun}</span>}
          <span className="sf-badge sf-badge-dur">{dur}</span>
        </div>
      </button>

      {isOpen && (
        <div className="sf-folder-body">
          {Object.entries(node.children).map(([childName, childNode]) => (
            <FolderNode
              key={childName}
              name={childName}
              node={childNode}
              folderPath={`${folderPath}/${childName}`}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={0}
              searchActive={searchActive}
              openMap={openMap}
              onToggle={onToggle}
            />
          ))}
          {node.scenarios.map(scenario => (
            <ScenarioItem
              key={scenario.id}
              scenario={scenario}
              isActive={selectedId === scenario.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScenarioItem({ scenario, isActive, onSelect }) {
  const dur    = formatDuration(scenario.duration);
  const status = scenario.status || 'not-run';
  return (
    <button
      className={`sf-item ${isActive ? 'sf-item-active' : ''}`}
      onClick={() => onSelect(scenario.id)}
    >
      <span className={`sf-dot sf-dot-${status}`} />
      <span className="sf-item-name">{scenario.name}</span>
      <span className="sf-item-dur">{dur}</span>
    </button>
  );
}

export default function Sidebar({ scenarios, totalCount, selectedId, onSelect, search, onSearch, loading, error, onOpenFilter, isFiltered, onRefresh, statusesLoading, onRun }) {
  const commonPrefix = useMemo(() => getCommonDirPrefix(scenarios), [scenarios]);
  const tree         = useMemo(() => buildTree(scenarios, commonPrefix), [scenarios, commonPrefix]);
  const searchActive = search.trim().length > 0;
  const [openMap, setOpenMap] = useState({});

  function toggleFolder(path) {
    setOpenMap(prev => ({ ...prev, [path]: !prev[path] }));
  }

  const pass    = scenarios.filter(s => s.status === 'pass').length;
  const fail    = scenarios.filter(s => s.status === 'fail').length;
  const notRun  = scenarios.filter(s => s.status === 'not-run').length;
  const totalDur = formatDurationLong(scenarios.reduce((s, c) => s + (c.duration || 0), 0));
  const withDur  = scenarios.filter(s => s.duration > 0);
  const avgDur   = withDur.length > 0
    ? formatDuration(Math.round(withDur.reduce((s, c) => s + c.duration, 0) / withDur.length))
    : null;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title-row">
          <h2 className="sidebar-title">Senaryolar</h2>
          <span className="sidebar-count">
            {isFiltered ? `${scenarios.length} / ${totalCount}` : scenarios.length}
          </span>
          {avgDur && (
            <span className="sidebar-avg-dur" title="Ortalama senaryo süresi">⌀ {avgDur}</span>
          )}
          <div className="sidebar-title-actions">
            <button
              className="sidebar-action-btn sidebar-run-btn"
              onClick={onRun}
              title="Koş"
              disabled={scenarios.length === 0}
            >
              <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor">
                <path d="M1 1l9 5-9 5V1z"/>
              </svg>
            </button>
            <button
              className={`sidebar-action-btn ${statusesLoading ? 'sidebar-refreshing' : ''}`}
              onClick={onRefresh}
              title="Yenile"
              disabled={statusesLoading}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className={statusesLoading ? 'sidebar-spin' : ''}>
                <path d="M13.5 2.5A6.5 6.5 0 1 1 8 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <polyline points="11,1 13.5,2.5 12,5" fill="currentColor"/>
              </svg>
            </button>
            <button
              className={`sidebar-action-btn ${isFiltered ? 'sidebar-filter-active' : ''}`}
              onClick={onOpenFilter}
              title="Filtrele"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M1 3h14M3.5 8h9M6 13h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              {isFiltered && <span className="sidebar-filter-dot" />}
            </button>
          </div>
        </div>
        <div className="sidebar-search-wrap">
          <span className="sidebar-search-icon">🔍</span>
          <input
            className="sidebar-search"
            type="text"
            placeholder="Senaryo ara..."
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          {search && (
            <button className="sidebar-search-clear" onClick={() => onSearch('')}>✕</button>
          )}
        </div>
      </div>

      <div className="sidebar-stats-bar">
        <span className="ssb-item ssb-total">
          <span className="ssb-val">{scenarios.length}</span>
          <span className="ssb-lbl">toplam</span>
        </span>
        <span className="ssb-sep" />
        <span className="ssb-item ssb-pass">
          <span className="ssb-val">{pass}</span>
          <span className="ssb-lbl">pass</span>
        </span>
        <span className="ssb-item ssb-fail">
          <span className="ssb-val">{fail}</span>
          <span className="ssb-lbl">fail</span>
        </span>
        <span className="ssb-item ssb-notrun">
          <span className="ssb-val">{notRun}</span>
          <span className="ssb-lbl">not run</span>
        </span>
        <span className="ssb-sep" />
        <span className="ssb-item ssb-dur">
          <span className="ssb-val">{totalDur}</span>
          <span className="ssb-lbl">süre</span>
        </span>
      </div>

      <div className="sidebar-list">
        {loading && scenarios.length === 0 && (
          <div className="sidebar-state">
            <span className="sidebar-state-icon">⏳</span>
            <span>Yükleniyor...</span>
          </div>
        )}
        {error && (
          <div className="sidebar-state sidebar-state-error">
            <span>⚠️ {error}</span>
          </div>
        )}
        {!loading && !error && scenarios.length === 0 && (
          <div className="sidebar-state">
            <span className="sidebar-state-icon">📭</span>
            <span>{search ? 'Sonuç bulunamadı' : 'Feature dosyası bulunamadı'}</span>
          </div>
        )}

        {Object.entries(tree.children).map(([name, node]) => (
          <FolderNode
            key={name}
            name={name}
            node={node}
            folderPath={name}
            selectedId={selectedId}
            onSelect={onSelect}
            depth={0}
            searchActive={searchActive}
            openMap={openMap}
            onToggle={toggleFolder}
          />
        ))}

        {tree.scenarios.map(scenario => (
          <ScenarioItem
            key={scenario.id}
            scenario={scenario}
            isActive={selectedId === scenario.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </aside>
  );
}
