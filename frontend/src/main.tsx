import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './state/SessionContext';
import { StatusProvider } from './state/StatusContext';
import { SettingsProvider } from './state/SettingsContext';
import { TransportProvider } from './state/TransportContext';
import { MeshProvider } from './state/MeshContext';
import { AIProvider } from './state/AIContext';
import { ModeProvider } from './state/ModeContext';
import Home from './pages/Home';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Family from './pages/Family';
import Network from './pages/Network';
import Responders from './pages/Responders';
import History from './pages/History';
import Demo from './pages/Demo';
import More from './pages/More';
import Missing from './pages/Missing';
import Settings from './pages/Settings';
import Situations from './pages/Situations';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <StatusProvider>
          <SettingsProvider>
            <TransportProvider>
              <AIProvider>              <MeshProvider>
                <ModeProvider>
                  <App>
                    <Routes>
                      <Route path="/" element={<Home />} />
                      <Route path="/login" element={<Login />} />
                      <Route path="/profile" element={<Profile />} />
                      <Route path="/family" element={<Family />} />
                      <Route path="/network" element={<Network />} />
                      <Route path="/responders" element={<Responders />} />
                      <Route path="/history" element={<History />} />
                      <Route path="/demo" element={<Demo />} />
                      <Route path="/more" element={<More />} />
                      <Route path="/missing" element={<Missing />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/situations" element={<Situations />} />
                    </Routes>
                  </App>
                </ModeProvider>
              </MeshProvider>
              </AIProvider>
            </TransportProvider>
          </SettingsProvider>
        </StatusProvider>
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
