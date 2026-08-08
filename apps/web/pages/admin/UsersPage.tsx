import React from 'react';
import { useAuth } from '../../contexts/AuthContext';

const UsersPage: React.FC = () => {
  const { userProfile } = useAuth();

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">Users</h1>
          <p className="text-sm text-gray-600">Operator profiles and role labels.</p>
        </div>
        <button disabled className="rounded-lg border border-gray-200 bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-400">
          Invite user
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Email</th>
              <th className="p-3">Role</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {userProfile && (
              <tr>
                <td className="p-3 font-medium text-gray-950">{userProfile.displayName || 'Current operator'}</td>
                <td className="p-3 text-gray-600">{userProfile.email}</td>
                <td className="p-3 capitalize text-gray-600">{userProfile.role.replaceAll('_', ' ')}</td>
                <td className="p-3 capitalize text-gray-600">{userProfile.status}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UsersPage;
