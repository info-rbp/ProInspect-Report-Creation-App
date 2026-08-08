import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const AppShell: React.FC = () => (
  <div className="min-h-screen bg-gray-50 text-gray-950 lg:grid lg:grid-cols-[260px_1fr]">
    <Sidebar />
    <div className="min-w-0">
      <TopBar />
      <main className="p-4 lg:p-6">
        <Outlet />
      </main>
    </div>
  </div>
);

export default AppShell;
