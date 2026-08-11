import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Clock, Hammer, ShieldAlert, Wrench } from 'lucide-react';
import type { WorkRequest } from '../../types/platform';
import { getExternalWorkRequest, submitExternalWorkResponse } from '../../services/platform/maintenanceService';

const ExternalWorkRequestPage: React.FC = () => {
  const { grantToken } = useParams<{ grantToken: string }>();

  const [data, setData] = useState<{ workRequest: WorkRequest; maintenanceItem: any; propertyAddress: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!grantToken) return;
    getExternalWorkRequest(grantToken)
      .then((res) => setData(res))
      .catch((err) => {
        console.error('Failed to load work request', err);
        setError('Invalid or expired token link.');
      })
      .finally(() => setLoading(false));
  }, [grantToken]);

  const handleAction = async (action: 'acknowledge' | 'in_progress' | 'complete' | 'unable_to_complete') => {
    if (!grantToken) return;
    try {
      await submitExternalWorkResponse(grantToken, action, notes);
      setSubmitted(true);
      const updated = await getExternalWorkRequest(grantToken);
      setData(updated);
    } catch (err) {
      alert('Failed to submit response.');
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">Loading work request...</div>;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-6 rounded-2xl border border-gray-200 text-center space-y-3">
          <ShieldAlert className="mx-auto text-red-500" size={32} />
          <h1 className="text-lg font-bold text-gray-900">Access Restricted</h1>
          <p className="text-xs text-gray-500">{error || 'Unable to access work request.'}</p>
        </div>
      </div>
    );
  }

  const { workRequest, maintenanceItem, propertyAddress } = data;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8 flex justify-center">
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6">
        <div className="border-b border-gray-100 pb-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase text-gray-400">ProInspect Contractor Portal</div>
            <h1 className="text-lg font-bold text-gray-900 mt-1">Work Request #{workRequest.id.slice(0, 8)}</h1>
          </div>
          <span className="rounded bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 uppercase">
            Status: {workRequest.status}
          </span>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg bg-gray-50 p-4 text-xs space-y-2">
            <div>
              <span className="text-gray-400">Property Address:</span>
              <div className="font-semibold text-gray-900">{propertyAddress}</div>
            </div>
            {maintenanceItem && (
              <div>
                <span className="text-gray-400">Task Title:</span>
                <div className="font-semibold text-gray-900">{maintenanceItem.title}</div>
              </div>
            )}
          </div>

          <div className="text-xs space-y-1">
            <label className="font-semibold text-gray-700">Instructions:</label>
            <p className="text-gray-600 bg-gray-50 p-3 rounded border border-gray-200">{workRequest.instructions}</p>
          </div>

          {submitted && (
            <div className="rounded-lg bg-emerald-50 p-4 text-xs text-emerald-800 font-medium">
              Response submitted successfully!
            </div>
          )}

          <div className="space-y-3 border-t border-gray-100 pt-4">
            <label className="block text-xs font-semibold text-gray-700">Contractor Notes & Progress Update</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Enter updates, completion details, or access notes..."
              className="w-full rounded-lg border border-gray-300 p-3 text-xs focus:border-gray-900 focus:outline-none"
            />

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={() => handleAction('acknowledge')}
                className="flex-1 rounded-lg border border-gray-300 bg-white py-2 text-xs font-medium text-gray-800 hover:bg-gray-100"
              >
                Acknowledge Request
              </button>
              <button
                onClick={() => handleAction('in_progress')}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                Mark In Progress
              </button>
              <button
                onClick={() => handleAction('complete')}
                className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Mark Completed
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExternalWorkRequestPage;
