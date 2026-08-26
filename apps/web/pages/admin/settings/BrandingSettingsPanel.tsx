import React, { useEffect, useState } from 'react';
import { Save, Upload } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import type { AgencyBrandingProfile, BrandingAsset } from '../../../types/platform';
import { createBrandingProfile, listBrandingAssets, listBrandingProfiles, updateBrandingProfile } from '../../../services/platform/agencySettingsService';
import { uploadBrandingAsset } from '../../../services/platform/brandingAssetUploadService';

const field = 'mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500';

const BrandingSettingsPanel: React.FC = () => {
  const { userProfile } = useAuth();
  const agencyId = userProfile?.agencyId;
  const [profiles, setProfiles] = useState<AgencyBrandingProfile[]>([]);
  const [assets, setAssets] = useState<BrandingAsset[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('ProInspect Default');
  const [primaryColour, setPrimaryColour] = useState('#0f172a');
  const [secondaryColour, setSecondaryColour] = useState('#334155');
  const [accentColour, setAccentColour] = useState('#2563eb');
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('');
  const [welcome, setWelcome] = useState('');
  const [privacyUrl, setPrivacyUrl] = useState('');
  const [logoAssetId, setLogoAssetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    if (!agencyId) return;
    const [nextProfiles, nextAssets] = await Promise.all([listBrandingProfiles(agencyId), listBrandingAssets(agencyId)]);
    setProfiles(nextProfiles);
    setAssets(nextAssets);
    setSelectedId((current) => {
      if (current && nextProfiles.some((profile) => profile.id === current)) return current;
      return nextProfiles.find((profile) => profile.status === 'active')?.id || nextProfiles[0]?.id || '';
    });
  };
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'Branding could not be loaded.')); }, [agencyId]);

  const selected = profiles.find((item) => item.id === selectedId);
  useEffect(() => {
    if (selected) {
      setName(selected.name);
      setPrimaryColour(selected.primaryColour || '#0f172a');
      setSecondaryColour(selected.secondaryColour || '#334155');
      setAccentColour(selected.accentColour || '#2563eb');
      setHeader(selected.reportHeaderText || '');
      setFooter(selected.reportFooterText || '');
      setWelcome(selected.portalWelcomeText || '');
      setPrivacyUrl(selected.privacyNoticeUrl || '');
      setLogoAssetId(selected.logoAssetId || '');
      return;
    }
    // Selecting "New profile" is an explicit create mode, not a misleading copy
    // of whichever existing profile happened to be loaded previously.
    setName('');
    setPrimaryColour('#0f172a');
    setSecondaryColour('#334155');
    setAccentColour('#2563eb');
    setHeader('');
    setFooter('');
    setWelcome('');
    setPrivacyUrl('');
    setLogoAssetId('');
  }, [selectedId, selected]);

  const uploadLogo = async (file: File) => {
    if (!agencyId) return;
    setUploading(true); setError(null); setNotice(null);
    try {
      const asset = await uploadBrandingAsset(agencyId, file, { kind: 'logo', name: `${name || 'Agency'} logo`, altText: `${name || 'Agency'} logo` });
      setAssets((current) => [...current.filter((item) => item.id !== asset.id), asset]);
      setLogoAssetId(asset.id);
      setNotice('Logo uploaded and integrity-verified. Save the branding profile to make it active.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Logo upload failed.');
    } finally { setUploading(false); }
  };

  const save = async () => {
    if (!agencyId) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const common = {
        name,
        primaryColour,
        secondaryColour,
        accentColour,
        reportHeaderText: header,
        reportFooterText: footer,
        portalWelcomeText: welcome,
        privacyNoticeUrl: privacyUrl || undefined,
        logoAssetId: logoAssetId || undefined,
        portalLogoAssetId: logoAssetId || undefined,
      };
      if (selected) {
        await updateBrandingProfile(agencyId, { ...selected, ...common, status: selected.status });
      } else {
        const created = await createBrandingProfile(agencyId, { id: `branding-${Date.now()}`, ...common, status: 'active' });
        setSelectedId(created.id);
      }
      setNotice('Branding profile saved. Final reports snapshot the exact active profile at finalisation.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Branding could not be saved.');
    } finally { setBusy(false); }
  };

  const selectedLogo = assets.find((asset) => asset.id === logoAssetId);
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="space-y-5">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">Branding profile</h2><p className="text-xs text-slate-500">Authoritative agency presentation identity for reports, portals and communications.</p></div><button onClick={() => void save()} disabled={busy || uploading || !name.trim()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save size={14}/>{busy ? 'Saving…' : selected ? 'Save changes' : 'Create profile'}</button></div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold">Profile<select className={field} value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setNotice(null); setError(null); }}><option value="">New profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.status}</option>)}</select><span className="mt-1 block font-normal text-slate-400">{selected ? `Editing ${selected.name}.` : 'Creating a separate profile with new values.'}</span></label>
          <label className="text-xs font-semibold">Profile name<input className={field} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="text-xs font-semibold">Primary colour<input className={field} value={primaryColour} onChange={(event) => setPrimaryColour(event.target.value)} /></label>
          <label className="text-xs font-semibold">Secondary colour<input className={field} value={secondaryColour} onChange={(event) => setSecondaryColour(event.target.value)} /></label>
          <label className="text-xs font-semibold">Accent colour<input className={field} value={accentColour} onChange={(event) => setAccentColour(event.target.value)} /></label>
          <label className="text-xs font-semibold">Privacy notice URL<input className={field} value={privacyUrl} onChange={(event) => setPrivacyUrl(event.target.value)} /></label>
          <label className="text-xs font-semibold">Approved logo asset<select className={field} value={logoAssetId} onChange={(event) => setLogoAssetId(event.target.value)}><option value="">No logo</option>{assets.filter((asset) => asset.kind === 'logo' && asset.status === 'active').map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
          <label className="text-xs font-semibold"><span className="inline-flex items-center gap-1"><Upload size={13}/>Upload logo</span><input className={field} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); event.currentTarget.value = ''; }}/><span className="mt-1 block font-normal text-slate-400">PNG, JPEG, WebP or SVG, maximum 5 MB. The server verifies the exact SHA-256 before registering the asset.</span></label>
          <label className="text-xs font-semibold md:col-span-2">Report header<input className={field} value={header} onChange={(event) => setHeader(event.target.value)} /></label>
          <label className="text-xs font-semibold md:col-span-2">Report footer<textarea className={field} rows={2} value={footer} onChange={(event) => setFooter(event.target.value)} /></label>
          <label className="text-xs font-semibold md:col-span-2">Portal welcome text<textarea className={field} rows={3} value={welcome} onChange={(event) => setWelcome(event.target.value)} /></label>
        </div>
      </section>
    </div>
    <section className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Preview</p>
      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200"><div className="h-2" style={{ backgroundColor: primaryColour }} /><div className="p-5"><div className="text-xs font-semibold text-slate-400">{selectedLogo ? `Logo: ${selectedLogo.name}` : 'No logo selected'}</div><div className="mt-2 text-lg font-black" style={{ color: primaryColour }}>{name || 'New branding profile'}</div><p className="mt-3 text-sm text-slate-600">{welcome || 'Portal and report presentation preview.'}</p><div className="mt-5 rounded-lg px-3 py-2 text-center text-xs font-semibold text-white" style={{ backgroundColor: accentColour }}>Primary action</div><p className="mt-5 border-t pt-3 text-[10px] text-slate-400">{footer || 'Report footer text'}</p></div></div>
    </section>
  </div>;
};

export default BrandingSettingsPanel;
