import React, { useEffect, useState } from 'react';
import { ImagePlus, Save } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import type { AgencyBrandingProfile, BrandingAsset } from '../../../types/platform';
import { createBrandingAsset, createBrandingProfile, listBrandingAssets, listBrandingProfiles, updateBrandingProfile } from '../../../services/platform/agencySettingsService';

const field = 'mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500';

const BrandingSettingsPanel: React.FC = () => {
  const { userProfile } = useAuth();
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
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!userProfile?.agencyId) return;
    const [nextProfiles, nextAssets] = await Promise.all([listBrandingProfiles(userProfile.agencyId), listBrandingAssets(userProfile.agencyId)]);
    setProfiles(nextProfiles); setAssets(nextAssets);
  };
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Branding could not be loaded.')); }, [userProfile?.agencyId]);

  const selected = profiles.find((item) => item.id === selectedId);
  useEffect(() => {
    if (!selected) return;
    setName(selected.name); setPrimaryColour(selected.primaryColour || '#0f172a'); setSecondaryColour(selected.secondaryColour || '#334155'); setAccentColour(selected.accentColour || '#2563eb');
    setHeader(selected.reportHeaderText || ''); setFooter(selected.reportFooterText || ''); setWelcome(selected.portalWelcomeText || ''); setPrivacyUrl(selected.privacyNoticeUrl || '');
  }, [selectedId]);

  const save = async () => {
    if (!userProfile?.agencyId) return;
    setBusy(true); setError(null);
    try {
      let logoAssetId = selected?.logoAssetId;
      if (logoUrl.trim() && !assets.some((asset) => asset.publicUrl === logoUrl.trim())) {
        const asset = await createBrandingAsset(userProfile.agencyId, { id: `logo-${Date.now()}`, kind: 'logo', name: `${name} logo`, contentType: 'image/png', publicUrl: logoUrl.trim(), altText: `${name} logo`, status: 'active' });
        logoAssetId = asset.id;
      } else if (logoUrl.trim()) {
        logoAssetId = assets.find((asset) => asset.publicUrl === logoUrl.trim())?.id;
      }
      if (selected) {
        await updateBrandingProfile(userProfile.agencyId, { ...selected, name, primaryColour, secondaryColour, accentColour, reportHeaderText: header, reportFooterText: footer, portalWelcomeText: welcome, privacyNoticeUrl: privacyUrl || undefined, logoAssetId, portalLogoAssetId: logoAssetId, status: selected.status });
      } else {
        const created = await createBrandingProfile(userProfile.agencyId, { id: `branding-${Date.now()}`, name, primaryColour, secondaryColour, accentColour, reportHeaderText: header, reportFooterText: footer, portalWelcomeText: welcome, privacyNoticeUrl: privacyUrl || undefined, logoAssetId, portalLogoAssetId: logoAssetId, status: 'active' });
        setSelectedId(created.id);
      }
      setLogoUrl(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Branding could not be saved.'); }
    finally { setBusy(false); }
  };

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="space-y-5">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between"><div><h2 className="font-bold">Branding profile</h2><p className="text-xs text-slate-500">Versioned presentation identity for reports, portals and communications.</p></div><button onClick={() => void save()} disabled={busy || !name.trim()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save size={14}/>{busy ? 'Saving…' : 'Save profile'}</button></div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold">Existing profile<select className={field} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}><option value="">Create new profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.status}</option>)}</select></label>
          <label className="text-xs font-semibold">Profile name<input className={field} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="text-xs font-semibold">Primary colour<input className={field} value={primaryColour} onChange={(e) => setPrimaryColour(e.target.value)} /></label>
          <label className="text-xs font-semibold">Secondary colour<input className={field} value={secondaryColour} onChange={(e) => setSecondaryColour(e.target.value)} /></label>
          <label className="text-xs font-semibold">Accent colour<input className={field} value={accentColour} onChange={(e) => setAccentColour(e.target.value)} /></label>
          <label className="text-xs font-semibold">Privacy notice URL<input className={field} value={privacyUrl} onChange={(e) => setPrivacyUrl(e.target.value)} /></label>
          <label className="text-xs font-semibold md:col-span-2"><span className="inline-flex items-center gap-1"><ImagePlus size={13}/>Logo asset URL</span><input className={field} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." /><span className="mt-1 block font-normal text-slate-400">Registers an approved asset reference. Binary upload remains in object storage rather than in settings records.</span></label>
          <label className="text-xs font-semibold md:col-span-2">Report header<input className={field} value={header} onChange={(e) => setHeader(e.target.value)} /></label>
          <label className="text-xs font-semibold md:col-span-2">Report footer<textarea className={field} rows={2} value={footer} onChange={(e) => setFooter(e.target.value)} /></label>
          <label className="text-xs font-semibold md:col-span-2">Portal welcome text<textarea className={field} rows={3} value={welcome} onChange={(e) => setWelcome(e.target.value)} /></label>
        </div>
      </section>
    </div>
    <section className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Preview</p>
      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200"><div className="h-2" style={{ backgroundColor: primaryColour }} /><div className="p-5"><div className="text-lg font-black" style={{ color: primaryColour }}>{name}</div><p className="mt-3 text-sm text-slate-600">{welcome || 'Portal and report presentation preview.'}</p><div className="mt-5 rounded-lg px-3 py-2 text-center text-xs font-semibold text-white" style={{ backgroundColor: accentColour }}>Primary action</div><p className="mt-5 border-t pt-3 text-[10px] text-slate-400">{footer || 'Report footer text'}</p></div></div>
    </section>
  </div>;
};

export default BrandingSettingsPanel;
