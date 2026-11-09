import { useState } from 'react';
import AppShell from './components/AppShell.jsx';
import Dashboard from './pages/Dashboard.jsx';
import MyCv from './pages/MyCv.jsx';
import TailoredCvs from './pages/TailoredCvs.jsx';
import AiSettings from './pages/AiSettings.jsx';
import { AppProvider } from './lib/AppContext.jsx';

const PAGES = {
  dashboard: Dashboard,
  'my-cv': MyCv,
  tailored: TailoredCvs,
  settings: AiSettings,
};

export function App() {
  const [tab, setTab] = useState('dashboard');
  const Page = PAGES[tab] ?? Dashboard;

  return (
    <AppProvider>
      <AppShell activeTab={tab} onTabChange={setTab}>
        <Page />
      </AppShell>
    </AppProvider>
  );
}

export default App;
