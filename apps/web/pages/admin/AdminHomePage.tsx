import React from 'react';
import { Link } from 'react-router-dom';

const AdminHomePage: React.FC = () => (
  <div className="space-y-4">
    <div>
      <h1 className="text-2xl font-bold text-gray-950">Admin</h1>
      <p className="text-sm text-gray-600">Manage ProInspect platform records and configuration.</p>
    </div>
    <div className="grid gap-4 md:grid-cols-3">
      {[
        ['Properties', '/app/admin/properties'],
        ['Inspection Jobs', '/app/admin/jobs'],
        ['Reports', '/app/admin/reports'],
      ].map(([label, to]) => (
        <Link key={to} to={to} className="rounded-lg border border-gray-200 bg-white p-5 font-semibold text-gray-900 shadow-sm hover:border-gray-400">
          {label}
        </Link>
      ))}
    </div>
  </div>
);

export default AdminHomePage;
