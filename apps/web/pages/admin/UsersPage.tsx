import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PeopleDirectoryEntry, UserRole } from '../../types/platform';
import { invitePerson, listPeople } from '../../services/platform/peopleService';

const roles: UserRole[] = ['super_admin', 'proinspect_admin', 'operations', 'inspector', 'analyst', 'reviewer'];

const UsersPage: React.FC = () => {
  const [people, setPeople] = useState<PeopleDirectoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('inspector');

  const load = async () => {
    setLoading(true); setError(undefined);
    try { setPeople(await listPeople()); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load users.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => people.filter((person) => {
    const text = `${person.displayName ?? ''} ${person.email} ${person.role}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (status === 'all' || person.membershipStatus === status);
  }), [people, query, status]);

  const stats = useMemo(() => ({
    active: people.filter((p) => p.membershipStatus === 'active').length,
    invited: people.filter((p) => p.membershipStatus === 'invited').length,
    suspended: people.filter((p) => p.membershipStatus === 'suspended').length,
    mfa: people.filter((p) => p.mfaRequired && !p.identity?.emailVerified).length,
  }), [people]);

  const submitInvite = async (event: React.FormEvent) => {
    event.preventDefault(); setError(undefined);
    try {
      await invitePerson({ email, displayName: displayName || undefined, role });
      setInviteOpen(false); setEmail(''); setDisplayName(''); setRole('inspector'); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Invitation failed.'); }
  };

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h1 className="text-2xl font-bold text-gray-950">People & Access</h1><p className="text-sm text-gray-600">Agency membership, access, workforce capability and security.</p></div>
      <button onClick={() => setInviteOpen(true)} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white">Invite user</button>
    </div>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-4">
      {[['Active', stats.active], ['Pending invitations', stats.invited], ['Suspended', stats.suspended], ['Security attention', stats.mfa]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"><div className="text-xs uppercase text-gray-500">{label}</div><div className="mt-1 text-2xl font-bold text-gray-950">{value}</div></div>)}
    </div>
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or role" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="all">All statuses</option><option value="active">Active</option><option value="invited">Invited</option><option value="suspended">Suspended</option><option value="revoked">Revoked</option></select>
    </div>
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="p-3">Person</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">MFA</th><th className="p-3">Work profile</th><th className="p-3"></th></tr></thead><tbody>
        {loading ? <tr><td colSpan={6} className="p-6 text-center text-gray-500">Loading users…</td></tr> : filtered.map((person) => <tr key={person.id} className="border-t border-gray-100"><td className="p-3"><div className="font-medium text-gray-950">{person.displayName || person.email}</div><div className="text-xs text-gray-500">{person.email}</div></td><td className="p-3 capitalize text-gray-700">{person.role.replaceAll('_', ' ')}</td><td className="p-3 capitalize text-gray-700">{person.membershipStatus}</td><td className="p-3">{person.mfaRequired ? 'Required' : 'Optional'}</td><td className="p-3">{person.workforceProfile ? 'Configured' : 'Not configured'}</td><td className="p-3 text-right"><Link className="font-semibold text-gray-900 underline" to={`/app/admin/users/${person.id}`}>Manage</Link></td></tr>)}
        {!loading && filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-500">No users match the current filters.</td></tr>}
      </tbody></table>
    </div>
    {inviteOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><form onSubmit={submitInvite} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl"><div><h2 className="text-lg font-bold">Invite user</h2><p className="text-sm text-gray-500">Creates an Identity Platform identity and an invited agency membership.</p></div><label className="block text-sm font-medium">Name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label><label className="block text-sm font-medium">Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label><label className="block text-sm font-medium">Role<select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">{roles.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setInviteOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button><button className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white">Create invitation</button></div></form></div>}
  </div>;
};
export default UsersPage;
