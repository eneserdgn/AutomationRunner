import React, { useState } from 'react';
import ProjectSelector from './components/ProjectSelector';
import MainLayout from './components/MainLayout';

export default function App() {
  const [activeProject, setActiveProject] = useState(null);

  if (!activeProject) {
    return <ProjectSelector onProjectOpen={setActiveProject} />;
  }

  return (
    <MainLayout
      project={activeProject}
      onChangeProject={() => setActiveProject(null)}
    />
  );
}
