import React from 'react';
import { ShieldAlert } from 'lucide-react';

const AccessDenied: React.FC = () => (
  <div className="min-h-[55vh] grid place-items-center p-8">
    <div className="max-w-md text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-red-50 text-red-600">
        <ShieldAlert size={24} />
      </div>
      <h1 className="text-2xl font-bold text-gray-950">Access denied</h1>
      <p className="mt-2 text-sm text-gray-600">
        Your current role does not have access to this ProInspect section.
      </p>
    </div>
  </div>
);

export default AccessDenied;
