import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import type { ClientApproval } from '../../types/platform';
import { getExternalClientApproval, submitExternalClientApproval } from '../../services/platform/maintenanceService';

const ExternalClientApprovalPage: React.FC = () => {
  const { grantToken } = useParams<{ grantToken: string }>();
  const [approval, setApproval] = useState<ClientApproval | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!grantToken) return;
    getExternalClientApproval(grantToken)
      .then(setApproval)
      .catch((err) => {
        console.error('Failed to load approval request', err);
        setError('Invalid or expired link.');
      })
      .finally(() => setLoading(false));
  }, [grantToken]);

  const handleDecision = async (decision: 'approved' | 'declined' | 'information_requested') => {
    if (!grantToken) return;
    try {
      setApproval(await submitExternalClientApproval(grantToken, decision, notes));
      setSubmitted(true);
    } catch (err) {
      console.error('Failed to submit client decision', err);
      alert('Failed to submit decision.');
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">Loading approval request...</div>;
  }

  if (error || !approval) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-6 rounded-2xl border border-gray-200 text-center space-y-3">
          <ShieldAlert className="mx-auto text-red-500" size={32} />
          <h1 className="text-lg font-bold text-gray-900">Link Invalid or Expired</h1>
          <p className="text-xs text-gray-500">{error || 'Unable to access approval request.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8 flex justify-center">
      <div className="w-full max-w-xl bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6">
        <div className="border-b border-gray-100 pb-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase text-gray-400">ProInspect Property Owner Portal</div>
            <h1 className="text-lg font-bold text-gray-900 mt-1">Maintenance Approval Request</h1>
          </div>
          <span className="rounded bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 uppercase capitalize">
            Status: {approval.status.replaceAll('_', ' ')}
          </span>
        </div>

        <div className="space-y-4 text-xs">
          <div className="rounded-lg bg-gray-50 p-4 space-y-3">
            <div>
              <span className="text-gray-400">Summary:</span>
              <p className="mt-1 font-medium text-gray-800">{approval.summary}</p>
            </div>
            <div>
              <span className="text-gray-400">Recommended Action:</span>
              <p className="mt-1 font-medium text-gray-800">{approval.recommendedAction}</p>
            </div>
            <div>
              <span className="text-gray-400">Priority:</span>
              <span className="ml-2 font-semibold text-gray-900 capitalize">{approval.priority}</span>
            </div>
          </div>

          {submitted && (
            <div className="rounded-lg bg-emerald-50 p-4 text-xs text-emerald-800 font-medium">
              Decision recorded. Thank you.
            </div>
          )}

          <div className="space-y-3 border-t border-gray-100 pt-4">
            <label className="block text-xs font-semibold text-gray-700">Comments</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Enter any comments or request further information..."
              className="w-full rounded-lg border border-gray-300 p-3 text-xs focus:border-gray-900 focus:outline-none"
            />

            <div className="flex flex-wrap gap-2 pt-2">
              <button onClick={() => handleDecision('approved')} className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-xs font-medium text-white hover:bg-emerald-700">Approve Maintenance</button>
              <button onClick={() => handleDecision('information_requested')} className="flex-1 rounded-lg border border-gray-300 bg-white py-2.5 text-xs font-medium text-gray-800 hover:bg-gray-100">Request Info</button>
              <button onClick={() => handleDecision('declined')} className="flex-1 rounded-lg bg-red-600 py-2.5 text-xs font-medium text-white hover:bg-red-700">Decline</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExternalClientApprovalPage;
