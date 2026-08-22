import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PeopleDirectoryEntry, UserRole, WorkforceProfile } from '../../types/platform';
import {
  changePersonRole,
  getDeactivationImpact,
  listPeople,
  reassignPersonWork,
  revokePersonSessions,
  saveWorkforceProfile,
  setMembershipStatus,
} from '../../services/platform/peopleService';
import { listAuditEventsForEntity } from '../../services/platform/auditService';
import type { AuditEvent } from '../../types/platform';

const roleOptions: UserRole[] = ['proinspect_admin', 'operations', 'inspector', 'analyst', 'reviewer'];
const tabs = ['Profile', 'Access', 'Work profile', 'Assignments', 'Security', 'Activity'] as const;

const UserWorkspacePage: React.FC = () => {
  const { userId = '' } = useParams();
  const [person, setPerson] = useState<PeopleDirectoryEntry>();
  const [people, setPeople] = useState<PeopleDirectoryEntry[]>([]);
  const [tab, setTab] = useState<(typeof tabs)[number]>('Profile');
  const [error, setError] = useState<string>();
  const [audits, setAudits] = useState<AuditEvent[]>([]);
  const [impact, setImpact] = useState<any>();
  const [replacementId, setReplacementId] = useState('');

  const load = async () => {
    try {
      const directory = await listPeople();
      setPeople(directory);
      setPerson(directory.find((entry) => entry.id === userId));
      setAudits(await listAuditEventsForEntity('user', userId));
      setImpact(await getDeactivationImpact(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load user.');
    }
  };
  useEffect(() => { void load(); }, [userId]);
  const capabilities = useMemo(() => person?.effectiveCapabilities ?? [], [person]);
  const replacements = useMemo(
    () => people.filter((entry) => entry.id !== userId && entry.membershipStatus === 'active'),
    [people, userId],
  );

  if (!person) return <div className="space-y-4"><Link to="/app/admin/users" className="text-sm underline">Back to users</Link>{error ? <div className="text-red-700">{error}</div> : <div>Loading user…</div>}</div>;

  const reason = () => window.prompt('Reason for this security-sensitive change:')?.trim();
  const doStatus = async (action: 'suspend' | 'reactivate' | 'revoke') => {
    const value = reason(); if (!value) return;
    try { await setMembershipStatus(person.id, action, value); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Action failed.'); }
  };
  const doRole = async (role: UserRole) => {
    const value = reason(); if (!value) return;
    try { await changePersonRole(person.id, role, value); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Role change failed.'); }
  };
  const saveWork = async () => {
    const current = person.workforceProfile;
    const profile: Partial<WorkforceProfile> = current ?? {
      agencyId: person.agencyId,
      userId: person.id,
      active: true,
      disciplines: person.role === 'reviewer' ? ['review'] : person.role === 'analyst' ? ['analysis'] : person.role === 'inspector' ? ['inspection'] : ['operations'],
      inspectionTypes: [],
      propertyUses: [],
      serviceAreas: [],
      commercialQualified: false,
      strataQualified: false,
    };
    try { await saveWorkforceProfile(person.id, profile); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Work profile update failed.'); }
  };
  const doReassign = async () => {
    if (!replacementId) return;
    const value = reason(); if (!value) return;
    try { await reassignPersonWork(person.id, replacementId, value); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Reassignment failed.'); }
  };

  return <div className="space-y-6">
    <div className="flex items-start justify-between gap-4"><div><Link to="/app/admin/users" className="text-sm text-gray-500 underline">People & Access</Link><h1 className="mt-2 text-2xl font-bold text-gray-950">{person.displayName || person.email}</h1><p className="text-sm text-gray-600">{person.email} · {person.role.replaceAll('_',' ')} · {person.membershipStatus}</p></div><div className="flex flex-wrap gap-2">{person.membershipStatus === 'active' && <button onClick={() => void doStatus('suspend')} className="rounded-lg border border-amber-300 px-3 py-2 text-sm">Suspend</button>}{person.membershipStatus !== 'active' && person.membershipStatus !== 'revoked' && <button onClick={() => void doStatus('reactivate')} className="rounded-lg border border-green-300 px-3 py-2 text-sm">Activate / reactivate</button>}<button onClick={() => void doStatus('revoke')} className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700">Revoke</button></div></div>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="flex flex-wrap gap-2 border-b border-gray-200">{tabs.map((value) => <button key={value} onClick={() => setTab(value)} className={`px-3 py-2 text-sm font-medium ${tab === value ? 'border-b-2 border-gray-950 text-gray-950' : 'text-gray-500'}`}>{value}</button>)}</div>

    {tab === 'Profile' && <section className="grid gap-4 rounded-lg border border-gray-200 bg-white p-5 sm:grid-cols-2"><Field label="Name" value={person.displayName || '—'} /><Field label="Email" value={person.email} /><Field label="Identity UID" value={person.id} /><Field label="Last sign-in" value={person.identity?.lastSignInAt || 'No recorded sign-in'} /></section>}
    {tab === 'Access' && <section className="space-y-5 rounded-lg border border-gray-200 bg-white p-5"><div><label className="text-sm font-medium">Role</label><select value={person.role} onChange={(e) => void doRole(e.target.value as UserRole)} className="ml-3 rounded-lg border border-gray-300 px-3 py-2 text-sm">{roleOptions.map((value) => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></div><div><h3 className="font-semibold">Effective capabilities</h3><div className="mt-2 flex flex-wrap gap-2">{capabilities.map((capability) => <span key={capability} className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">{capability}</span>)}</div></div></section>}
    {tab === 'Work profile' && <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-5"><p className="text-sm text-gray-600">Workforce capability is shared with inspection assignment and extends to analysis/review disciplines.</p><Field label="Disciplines" value={person.workforceProfile?.disciplines.join(', ') || 'Not configured'} /><Field label="Service areas" value={person.workforceProfile?.serviceAreas.join(', ') || 'Not configured'} /><Field label="Maximum jobs/day" value={String(person.workforceProfile?.maxJobsPerDay ?? 'Not set')} /><Field label="Unavailable dates" value={person.workforceProfile?.unavailableDates?.join(', ') || 'None recorded'} /><Field label="Working hours" value={person.workforceProfile?.workingHours ? Object.entries(person.workforceProfile.workingHours).map(([day, hours]) => `${day}: ${hours ? `${hours.start}-${hours.end}` : 'off'}`).join(', ') : 'Not configured'} /><button onClick={() => void saveWork()} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white">{person.workforceProfile ? 'Refresh work profile' : 'Create work profile'}</button></section>}
    {tab === 'Assignments' && <section className="space-y-5 rounded-lg border border-gray-200 bg-white p-5"><div className="grid gap-3 sm:grid-cols-4"><Metric label="Inspections today" value={person.workload?.inspectionsToday ?? 0} /><Metric label="Next 7 days" value={person.workload?.inspectionsNext7Days ?? 0} /><Metric label="Active analysis" value={person.workload?.activeAnalyses ?? 0} /><Metric label="Active reviews" value={person.workload?.activeReviews ?? 0} /><Metric label="Overdue" value={person.workload?.overdueAssignments ?? 0} /><Metric label="Capacity left today" value={person.workload?.capacityRemainingToday ?? 0} /><Metric label="Maintenance impact" value={impact?.activeMaintenanceItemIds?.length ?? 0} /><Metric label="Total deactivation impact" value={impact?.totalImpactedAssignments ?? 0} /></div>{impact?.totalImpactedAssignments > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><h3 className="font-semibold text-amber-900">Reassign active work before deactivation</h3><div className="mt-3 flex flex-col gap-2 sm:flex-row"><select value={replacementId} onChange={(e) => setReplacementId(e.target.value)} className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"><option value="">Select replacement user</option>{replacements.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName || entry.email} · {entry.role.replaceAll('_',' ')}</option>)}</select><button disabled={!replacementId} onClick={() => void doReassign()} className="rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Reassign active work</button></div></div>}</section>}
    {tab === 'Security' && <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-5"><Field label="MFA policy" value={person.mfaRequired ? 'Required' : 'Optional'} /><Field label="Email verified" value={person.identity?.emailVerified ? 'Yes' : 'No'} /><Field label="Identity disabled" value={person.identity?.disabled ? 'Yes' : 'No'} /><button onClick={async () => { const value = reason(); if (!value) return; await revokePersonSessions(person.id, value); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold">Revoke all sessions</button></section>}
    {tab === 'Activity' && <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">{audits.length ? audits.map((event) => <div key={event.id} className="border-b border-gray-100 pb-3"><div className="text-sm font-medium">{event.eventType.replaceAll('_',' ')}</div><div className="text-xs text-gray-500">{new Date(event.timestamp).toLocaleString()} · {event.actorRole || 'system'}</div></div>) : <p className="text-sm text-gray-500">No user audit events are available.</p>}</section>}
  </div>;
};
const Field: React.FC<{label:string; value:string}> = ({label,value}) => <div><div className="text-xs uppercase text-gray-500">{label}</div><div className="mt-1 text-sm font-medium text-gray-900">{value}</div></div>;
const Metric: React.FC<{label:string; value:number}> = ({label,value}) => <div className="rounded-lg bg-gray-50 p-4"><div className="text-xs uppercase text-gray-500">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></div>;
export default UserWorkspacePage;
