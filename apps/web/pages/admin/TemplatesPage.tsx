import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BookOpen,
  CheckCircle2,
  Copy,
  FileText,
  Layers,
  Play,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { PhysicalPropertyType, PropertyUse } from '@pcr/domain';
import {
  generateCommentary,
  importCommentaryBank,
  validateCommentaryText,
  type CanonicalInspectionTemplateAreaReference,
  type CommentaryEntry,
  type ImportRow,
  type InspectionTypeTemplate,
  type StructuredInspectionFact,
} from '@pcr/templates';
import type {
  CatalogueAreaVersionView,
  CatalogueComponentVersionView,
} from '@pcr/templates/catalogueAdmin';
import CatalogueAdminPanel from '../../components/templates/CatalogueAdminPanel';
import { getCatalogueAreas, getCatalogueComponents } from '../../services/catalogueStorage';
import {
  duplicateTemplateToNewDraft,
  getTemplates,
  publishTemplateVersion,
  retireTemplateVersion,
  saveTemplate,
} from '../../services/templateStorage';

type ActiveTab = 'templates' | 'catalogue' | 'bank' | 'preview';
type Inclusion = CanonicalInspectionTemplateAreaReference['inclusion'];

const PROPERTY_USES: PropertyUse[] = [
  'residential', 'commercial', 'industrial', 'retail', 'mixed_use', 'strata_common_property', 'other',
];

const PHYSICAL_TYPES: PhysicalPropertyType[] = [
  'house', 'apartment', 'unit', 'townhouse', 'villa', 'duplex', 'studio', 'ancillary_dwelling',
  'retirement_supported', 'office', 'retail_shop', 'warehouse', 'industrial_unit', 'showroom',
  'medical_consulting', 'hospitality', 'restaurant_cafe', 'childcare', 'mixed_commercial',
  'common_property', 'other',
];

const INSPECTION_TYPES: InspectionTypeTemplate['inspectionType'][] = [
  'entry', 'routine', 'exit', 'comparison', 'maintenance',
];

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, ' ');
}

function templatePropertyType(uses: PropertyUse[]): string {
  if (uses.length === 1) return uses[0];
  return uses.includes('residential') && uses.length === 1 ? 'residential' : 'mixed';
}

function versionKey(id: string, version: number): string {
  return `${id}@${version}`;
}

const TemplatesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('templates');
  const [templates, setTemplates] = useState<InspectionTypeTemplate[]>([]);
  const [areas, setAreas] = useState<CatalogueAreaVersionView[]>([]);
  const [components, setComponents] = useState<CatalogueComponentVersionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedVersion, setSelectedVersion] = useState(1);
  const [search, setSearch] = useState('');

  const [showNew, setShowNew] = useState(false);
  const [newTemplateId, setNewTemplateId] = useState('');
  const [newTemplateType, setNewTemplateType] = useState<InspectionTypeTemplate['inspectionType']>('entry');

  const [entryAreaKey, setEntryAreaKey] = useState('');
  const [entryComponentKey, setEntryComponentKey] = useState('');
  const [entryCondition, setEntryCondition] = useState('minor_wear');
  const [entryText, setEntryText] = useState('');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [csvText, setCsvText] = useState('');

  const [previewAreaKey, setPreviewAreaKey] = useState('');
  const [previewComponentKey, setPreviewComponentKey] = useState('');
  const [previewCondition, setPreviewCondition] = useState<StructuredInspectionFact['condition']>('minor_wear');

  const loadData = async (preferred?: { id: string; version: number }) => {
    setLoading(true);
    setError('');
    try {
      const [templateList, areaList, componentList] = await Promise.all([
        getTemplates(),
        getCatalogueAreas({ status: 'published' }),
        getCatalogueComponents({ status: 'published' }),
      ]);
      setTemplates(templateList);
      setAreas(areaList.filter((area) => area.definition.status === 'published'));
      setComponents(componentList.filter((component) => component.definition.status === 'published'));
      const selected = preferred
        ? templateList.find((item) => item.id === preferred.id && item.version === preferred.version)
        : templateList.find((item) => item.id === selectedTemplateId && item.version === selectedVersion) || templateList[0];
      if (selected) {
        setSelectedTemplateId(selected.id);
        setSelectedVersion(selected.version);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load Templates & Rules.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId && template.version === selectedVersion) || templates[0],
    [templates, selectedTemplateId, selectedVersion],
  );

  const publishedAreas = useMemo(
    () => [...areas].sort((a, b) => a.definition.name.localeCompare(b.definition.name)),
    [areas],
  );

  const areaByKey = useMemo(
    () => new Map(publishedAreas.map((area) => [versionKey(area.definition.id, area.definition.version), area])),
    [publishedAreas],
  );
  const componentByKey = useMemo(
    () => new Map(components.map((component) => [versionKey(component.definition.id, component.definition.version), component])),
    [components],
  );

  const areaForEntry = entryAreaKey ? areaByKey.get(entryAreaKey) : undefined;
  const entryComponentOptions = useMemo(() => {
    if (!areaForEntry) return [];
    return areaForEntry.componentRules.flatMap((rule) => {
      const component = componentByKey.get(versionKey(rule.componentDefinitionId, rule.componentDefinitionVersion));
      return component ? [{ rule, component }] : [];
    });
  }, [areaForEntry, componentByKey]);

  const previewArea = previewAreaKey ? areaByKey.get(previewAreaKey) : undefined;
  const previewComponentOptions = useMemo(() => {
    if (!previewArea) return [];
    return previewArea.componentRules.flatMap((rule) => {
      const component = componentByKey.get(versionKey(rule.componentDefinitionId, rule.componentDefinitionVersion));
      return component ? [{ rule, component }] : [];
    });
  }, [previewArea, componentByKey]);

  useEffect(() => {
    if (!entryAreaKey && publishedAreas[0]) setEntryAreaKey(versionKey(publishedAreas[0].definition.id, publishedAreas[0].definition.version));
    if (!previewAreaKey && publishedAreas[0]) setPreviewAreaKey(versionKey(publishedAreas[0].definition.id, publishedAreas[0].definition.version));
  }, [publishedAreas, entryAreaKey, previewAreaKey]);

  useEffect(() => {
    if (entryComponentOptions.length && !entryComponentOptions.some(({ component }) => versionKey(component.definition.id, component.definition.version) === entryComponentKey)) {
      const first = entryComponentOptions[0].component.definition;
      setEntryComponentKey(versionKey(first.id, first.version));
    }
  }, [entryComponentOptions, entryComponentKey]);

  useEffect(() => {
    if (previewComponentOptions.length && !previewComponentOptions.some(({ component }) => versionKey(component.definition.id, component.definition.version) === previewComponentKey)) {
      const first = previewComponentOptions[0].component.definition;
      setPreviewComponentKey(versionKey(first.id, first.version));
    }
  }, [previewComponentOptions, previewComponentKey]);

  const filteredTemplates = useMemo(() => {
    const query = normalise(search);
    return templates.filter((template) => !query || normalise(`${template.id} ${template.inspectionType} ${template.propertyType}`).includes(query));
  }, [templates, search]);

  const updateTemplate = async (next: InspectionTypeTemplate, successMessage: string) => {
    setSaving(true);
    setError('');
    try {
      await saveTemplate(next);
      setNotice(successMessage);
      await loadData({ id: next.id, version: next.version });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save Template Version.');
    } finally {
      setSaving(false);
    }
  };

  const createTemplate = async () => {
    const id = newTemplateId.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
    if (!id) return setError('Template ID is required.');
    const draft: InspectionTypeTemplate = {
      id,
      version: 1,
      inspectionType: newTemplateType,
      propertyType: 'residential',
      status: 'draft',
      areas: [],
      structureMode: 'property_layout_catalogue',
      includeUnreferencedPropertyAreas: true,
      canonicalAreaReferences: [],
      propertyUses: ['residential'],
      physicalPropertyTypes: [],
      commentaryBank: [],
      createdAt: new Date().toISOString(),
    };
    setSaving(true);
    try {
      await saveTemplate(draft);
      setShowNew(false);
      setNewTemplateId('');
      setNotice('Canonical Template draft created. No cloned Area or Component arrays were persisted.');
      await loadData({ id, version: 1 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to create Template draft.');
    } finally {
      setSaving(false);
    }
  };

  const toggleApplicability = <T extends string>(values: T[], value: T): T[] =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  const setAreaReference = (area: CatalogueAreaVersionView, inclusion: Inclusion | 'not_referenced') => {
    if (!activeTemplate || activeTemplate.status !== 'draft') return;
    const references = [...(activeTemplate.canonicalAreaReferences || [])];
    const index = references.findIndex((reference) =>
      reference.canonicalAreaDefinitionId === area.definition.id &&
      reference.canonicalAreaDefinitionVersion === area.definition.version,
    );
    if (inclusion === 'not_referenced') {
      if (index >= 0) references.splice(index, 1);
    } else {
      const previous = index >= 0 ? references[index] : undefined;
      const next: CanonicalInspectionTemplateAreaReference = {
        id: previous?.id || `template-area-${area.definition.id}-v${area.definition.version}`,
        canonicalAreaDefinitionId: area.definition.id,
        canonicalAreaDefinitionVersion: area.definition.version,
        inclusion,
        ...(previous?.canonicalAreaComponentRuleReferences?.length
          ? { canonicalAreaComponentRuleReferences: previous.canonicalAreaComponentRuleReferences }
          : {}),
      };
      if (index >= 0) references[index] = next;
      else references.push(next);
    }
    void updateTemplate({ ...activeTemplate, canonicalAreaReferences: references }, 'Template Area policy saved.');
  };

  const toggleRule = (reference: CanonicalInspectionTemplateAreaReference, ruleId: string, version: number) => {
    if (!activeTemplate || activeTemplate.status !== 'draft') return;
    const references = [...(activeTemplate.canonicalAreaReferences || [])];
    const index = references.findIndex((candidate) => candidate.id === reference.id);
    if (index < 0) return;
    const existing = references[index].canonicalAreaComponentRuleReferences || [];
    const matched = existing.some((item) => item.id === ruleId && item.version === version);
    references[index] = {
      ...references[index],
      canonicalAreaComponentRuleReferences: matched
        ? existing.filter((item) => !(item.id === ruleId && item.version === version))
        : [...existing, { id: ruleId, version }],
    };
    void updateTemplate({ ...activeTemplate, canonicalAreaReferences: references }, 'Template Component-rule policy saved.');
  };

  const saveCommentary = async () => {
    if (!activeTemplate || activeTemplate.status !== 'draft') return;
    try { validateCommentaryText(entryText); } catch (caught) {
      return setError(caught instanceof Error ? caught.message : 'Invalid commentary text.');
    }
    const area = areaByKey.get(entryAreaKey);
    const component = componentByKey.get(entryComponentKey);
    if (!area || !component) return setError('Select an exact published canonical Area and Component.');
    const bank = [...activeTemplate.commentaryBank];
    const entry: CommentaryEntry = {
      id: editingEntryId || `commentary-${Date.now().toString(36)}`,
      area: area.definition.name,
      component: component.definition.name,
      canonicalAreaDefinitionId: area.definition.id,
      canonicalAreaDefinitionVersion: area.definition.version,
      canonicalComponentDefinitionId: component.definition.id,
      canonicalComponentDefinitionVersion: component.definition.version,
      condition: entryCondition,
      inspectionTypes: [activeTemplate.inspectionType],
      text: entryText.trim(),
      active: true,
      ...(editingEntryId ? { updatedAt: new Date().toISOString() } : { createdAt: new Date().toISOString() }),
    };
    const index = editingEntryId ? bank.findIndex((candidate) => candidate.id === editingEntryId) : -1;
    if (index >= 0) bank[index] = { ...bank[index], ...entry };
    else bank.push(entry);
    setEditingEntryId(null);
    setEntryText('');
    await updateTemplate({ ...activeTemplate, commentaryBank: bank }, 'Canonical Commentary rule saved.');
  };

  const editCommentary = (entry: CommentaryEntry) => {
    setEditingEntryId(entry.id);
    setEntryText(entry.text);
    setEntryCondition(String(entry.condition));
    if (entry.canonicalAreaDefinitionId && entry.canonicalAreaDefinitionVersion) {
      setEntryAreaKey(versionKey(entry.canonicalAreaDefinitionId, entry.canonicalAreaDefinitionVersion));
    }
    if (entry.canonicalComponentDefinitionId && entry.canonicalComponentDefinitionVersion) {
      setEntryComponentKey(versionKey(entry.canonicalComponentDefinitionId, entry.canonicalComponentDefinitionVersion));
    }
  };

  const importCsv = async () => {
    if (!activeTemplate || activeTemplate.status !== 'draft' || !csvText.trim()) return;
    const rows: ImportRow[] = csvText.trim().split(/\r?\n/gu).filter(Boolean).map((line) => {
      const values = line.split(',').map((value) => value.trim().replace(/^"(.*)"$/u, '$1'));
      return {
        area: values[0] || '', component: values[1] || '', condition: values[2] || 'minor_wear',
        inspectionTypes: values[3] || activeTemplate.inspectionType, text: values.slice(4).join(',').trim(),
      };
    });
    const parsed = importCommentaryBank(rows, activeTemplate.commentaryBank);
    const mapped: CommentaryEntry[] = [];
    const unresolved: string[] = [];
    for (const entry of parsed.entries) {
      const areaMatches = publishedAreas.filter((area) => {
        const labels = [area.definition.name, area.definition.id, area.definition.code, ...(area.definition.aliases || [])];
        return labels.some((label) => normalise(label) === normalise(entry.area));
      });
      const possibleComponents = areaMatches.flatMap((area) => area.componentRules.flatMap((rule) => {
        const component = componentByKey.get(versionKey(rule.componentDefinitionId, rule.componentDefinitionVersion));
        return component ? [{ area, component }] : [];
      }));
      const componentMatches = possibleComponents.filter(({ component }) => {
        const labels = [component.definition.name, component.definition.id, component.definition.code, ...(component.definition.aliases || [])];
        return labels.some((label) => normalise(label) === normalise(entry.component));
      });
      const unique = [...new Map(componentMatches.map((match) => [`${match.area.definition.id}@${match.area.definition.version}|${match.component.definition.id}@${match.component.definition.version}`, match])).values()];
      if (unique.length !== 1) {
        unresolved.push(`${entry.area} / ${entry.component}`);
        continue;
      }
      const match = unique[0];
      mapped.push({
        ...entry,
        area: match.area.definition.name,
        component: match.component.definition.name,
        canonicalAreaDefinitionId: match.area.definition.id,
        canonicalAreaDefinitionVersion: match.area.definition.version,
        canonicalComponentDefinitionId: match.component.definition.id,
        canonicalComponentDefinitionVersion: match.component.definition.version,
      });
    }
    if (unresolved.length) {
      setError(`Import stopped. ${unresolved.length} row(s) could not be mapped unambiguously to the Catalogue: ${unresolved.slice(0, 5).join('; ')}${unresolved.length > 5 ? '…' : ''}`);
      return;
    }
    if (!mapped.length) return setError('No valid Commentary rows were available to import.');
    await updateTemplate({ ...activeTemplate, commentaryBank: [...activeTemplate.commentaryBank, ...mapped] }, `Imported ${mapped.length} canonical Commentary rule(s).`);
    setCsvText('');
  };

  const previewFact = useMemo<StructuredInspectionFact | undefined>(() => {
    if (!activeTemplate || !previewArea) return undefined;
    const component = componentByKey.get(previewComponentKey);
    if (!component) return undefined;
    return {
      area: previewArea.definition.name,
      component: component.definition.name,
      canonicalAreaDefinitionId: previewArea.definition.id,
      canonicalAreaDefinitionVersion: previewArea.definition.version,
      canonicalComponentDefinitionId: component.definition.id,
      canonicalComponentDefinitionVersion: component.definition.version,
      visibility: 'visible',
      condition: previewCondition,
      workingState: 'not_tested',
      photoReferences: [],
      inspectionType: activeTemplate.inspectionType,
    };
  }, [activeTemplate, previewArea, previewComponentKey, previewCondition, componentByKey]);

  const previewOutput = useMemo(() => {
    if (!activeTemplate || !previewFact) return undefined;
    try { return generateCommentary(activeTemplate, previewFact); }
    catch (caught) { return { error: caught instanceof Error ? caught.message : 'Commentary generation failed.' }; }
  }, [activeTemplate, previewFact]);

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Loading canonical Templates & Rules…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-bold text-gray-950">Templates & Rules</h1><p className="text-sm text-gray-600">Compose versioned Inspection Templates from exact Catalogue references. Display labels are not identity, despite humanity's recurring attempts to make them so.</p></div>
        <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"><Plus size={16} /> New Template Draft</button>
      </div>
      {error && <div className="flex justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className="flex justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><span>{notice}</span><button onClick={() => setNotice('')}><X size={16} /></button></div>}

      <nav className="flex gap-5 overflow-x-auto border-b border-gray-200">
        {[
          ['templates', 'Inspection Templates', FileText], ['catalogue', 'Areas & Components Catalogue', Layers],
          ['bank', 'Commentary Bank', BookOpen], ['preview', 'Preview & Test Bench', Play],
        ].map(([id, label, Icon]) => <button key={String(id)} onClick={() => setActiveTab(id as ActiveTab)} className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium ${activeTab === id ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500'}`}><Icon size={16} />{String(label)}</button>)}
      </nav>

      {activeTab === 'templates' && (
        <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
          <aside className="space-y-3">
            <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-gray-300 py-2.5 pl-9 pr-3 text-sm" placeholder="Search templates…" /></div>
            {filteredTemplates.map((template) => <button key={versionKey(template.id, template.version)} onClick={() => { setSelectedTemplateId(template.id); setSelectedVersion(template.version); }} className={`w-full rounded-xl border p-4 text-left ${activeTemplate?.id === template.id && activeTemplate.version === template.version ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-white'}`}><div className="flex justify-between"><span className="font-semibold">{template.id}</span><span className="text-xs uppercase text-gray-500">{template.status}</span></div><div className="mt-1 text-xs text-gray-500">{template.inspectionType} · v{template.version}</div></button>)}
          </aside>

          {activeTemplate && <section className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{activeTemplate.id} <span className="font-mono text-sm text-gray-400">v{activeTemplate.version}</span></h2><p className="text-xs text-gray-500">Structure mode: {activeTemplate.structureMode || 'legacy'} · {activeTemplate.canonicalAreaReferences?.length || 0} exact Area references</p></div><div className="flex gap-2">{activeTemplate.status === 'draft' && <button disabled={saving} onClick={() => void publishTemplateVersion(activeTemplate.id, activeTemplate.version).then((result) => loadData({ id: result.id, version: result.version })).catch((caught) => setError(caught instanceof Error ? caught.message : 'Publish failed.'))} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white"><CheckCircle2 size={14} /> Publish</button>}<button onClick={() => void duplicateTemplateToNewDraft(activeTemplate.id, activeTemplate.version).then((result) => loadData({ id: result.id, version: result.version })).catch((caught) => setError(caught instanceof Error ? caught.message : 'Duplicate failed.'))} className="rounded-lg border px-3 py-2 text-xs"><Copy size={14} /></button>{activeTemplate.status === 'published' && <button onClick={() => void retireTemplateVersion(activeTemplate.id, activeTemplate.version).then((result) => loadData({ id: result.id, version: result.version })).catch((caught) => setError(caught instanceof Error ? caught.message : 'Retire failed.'))} className="rounded-lg border px-3 py-2 text-xs text-rose-600"><Archive size={14} /></button>}</div></div>

            <div><h3 className="text-sm font-bold">Property applicability</h3><div className="mt-2 flex flex-wrap gap-2">{PROPERTY_USES.map((use) => <button key={use} disabled={activeTemplate.status !== 'draft' || saving} onClick={() => { const values = toggleApplicability((activeTemplate.propertyUses || []) as PropertyUse[], use); void updateTemplate({ ...activeTemplate, propertyUses: values, propertyType: templatePropertyType(values) }, 'Property Use applicability saved.'); }} className={`rounded-full border px-3 py-1 text-xs ${(activeTemplate.propertyUses || []).includes(use) ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-gray-300'}`}>{use.replaceAll('_', ' ')}</button>)}</div><div className="mt-3 flex max-h-28 flex-wrap gap-2 overflow-y-auto">{PHYSICAL_TYPES.map((type) => <button key={type} disabled={activeTemplate.status !== 'draft' || saving} onClick={() => void updateTemplate({ ...activeTemplate, physicalPropertyTypes: toggleApplicability((activeTemplate.physicalPropertyTypes || []) as PhysicalPropertyType[], type) }, 'Physical Property Type applicability saved.')} className={`rounded-full border px-2 py-1 text-[10px] ${(activeTemplate.physicalPropertyTypes || []).includes(type) ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-gray-200'}`}>{type.replaceAll('_', ' ')}</button>)}</div></div>

            <label className="flex items-center gap-2 rounded-xl bg-gray-50 p-3 text-sm"><input type="checkbox" disabled={activeTemplate.status !== 'draft' || saving} checked={activeTemplate.includeUnreferencedPropertyAreas !== false} onChange={(event) => void updateTemplate({ ...activeTemplate, structureMode: 'property_layout_catalogue', areas: [], includeUnreferencedPropertyAreas: event.target.checked }, 'Unreferenced Property Area policy saved.')} /> Include Property Areas not explicitly referenced below</label>

            <div><div className="flex items-center justify-between"><h3 className="text-sm font-bold">Canonical Area composition</h3><span className="text-[10px] text-gray-500">Exact published versions only</span></div><div className="mt-3 space-y-3">{publishedAreas.map((area) => { const reference = activeTemplate.canonicalAreaReferences?.find((candidate) => candidate.canonicalAreaDefinitionId === area.definition.id && candidate.canonicalAreaDefinitionVersion === area.definition.version); return <div key={versionKey(area.definition.id, area.definition.version)} className="rounded-xl border border-gray-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-semibold text-sm">{area.definition.name}</div><div className="font-mono text-[10px] text-gray-400">{area.definition.id}@{area.definition.version}</div></div><select disabled={activeTemplate.status !== 'draft' || saving} value={reference?.inclusion || 'not_referenced'} onChange={(event) => setAreaReference(area, event.target.value as Inclusion | 'not_referenced')} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"><option value="not_referenced">Not explicitly referenced</option><option value="required">Required</option><option value="default">Default</option><option value="optional">Optional</option><option value="excluded">Excluded</option></select></div>{reference && area.componentRules.length > 0 && <div className="mt-3"><p className="text-[10px] text-gray-500">Component-rule restriction. Leave all unchecked to use the Property Area's full canonical composition.</p><div className="mt-2 flex flex-wrap gap-1.5">{area.componentRules.map((rule) => { const component = componentByKey.get(versionKey(rule.componentDefinitionId, rule.componentDefinitionVersion)); const checked = reference.canonicalAreaComponentRuleReferences?.some((item) => item.id === rule.id && item.version === rule.version) || false; return <button key={versionKey(rule.id, rule.version)} disabled={activeTemplate.status !== 'draft' || saving} onClick={() => toggleRule(reference, rule.id, rule.version)} className={`rounded border px-2 py-1 text-[10px] ${checked ? 'border-purple-400 bg-purple-50 text-purple-800' : 'border-gray-200'}`}>{component?.definition.name || rule.componentDefinitionId}</button>; })}</div></div>}</div>; })}</div></div>
          </section>}
        </div>
      )}

      {activeTab === 'catalogue' && <CatalogueAdminPanel />}

      {activeTab === 'bank' && activeTemplate && (
        <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5"><h2 className="font-bold">Canonical Commentary Rule</h2><select value={entryAreaKey} onChange={(event) => { setEntryAreaKey(event.target.value); setEntryComponentKey(''); }} className="w-full rounded-lg border p-2 text-xs">{publishedAreas.map((area) => <option key={versionKey(area.definition.id, area.definition.version)} value={versionKey(area.definition.id, area.definition.version)}>{area.definition.name} · {area.definition.id}@{area.definition.version}</option>)}</select><select value={entryComponentKey} onChange={(event) => setEntryComponentKey(event.target.value)} className="w-full rounded-lg border p-2 text-xs">{entryComponentOptions.map(({ component }) => <option key={versionKey(component.definition.id, component.definition.version)} value={versionKey(component.definition.id, component.definition.version)}>{component.definition.name} · {component.definition.id}@{component.definition.version}</option>)}</select><select value={entryCondition} onChange={(event) => setEntryCondition(event.target.value)} className="w-full rounded-lg border p-2 text-xs"><option value="clean_intact">Clean & intact</option><option value="minor_wear">Minor wear</option><option value="requires_cleaning">Requires cleaning</option><option value="repair_required">Repair required</option><option value="damaged">Damaged</option><option value="unable_to_confirm">Unable to confirm</option><option value="any">Any</option></select><textarea rows={5} value={entryText} onChange={(event) => setEntryText(event.target.value)} className="w-full rounded-lg border p-2 text-xs" placeholder="Deterministic commentary text…" /><button disabled={activeTemplate.status !== 'draft' || saving || !entryText.trim()} onClick={() => void saveCommentary()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save size={14} /> {editingEntryId ? 'Update' : 'Add'} Rule</button><div className="border-t pt-3"><label className="text-xs font-semibold">CSV import</label><p className="text-[10px] text-gray-500">Area, Component, Condition, InspectionTypes, Text. Every row must resolve unambiguously to the Catalogue.</p><textarea rows={4} value={csvText} onChange={(event) => setCsvText(event.target.value)} className="mt-2 w-full rounded-lg border p-2 text-[10px]" /><button disabled={activeTemplate.status !== 'draft' || saving || !csvText.trim()} onClick={() => void importCsv()} className="mt-2 inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs"><Upload size={13} /> Validate & Import</button></div></section>
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white"><div className="border-b p-4"><h2 className="font-bold">{activeTemplate.id} Commentary Bank</h2><p className="text-xs text-gray-500">Canonical identity wins over display labels. Legacy label-only rules remain visible for migration.</p></div><div className="divide-y">{activeTemplate.commentaryBank.map((entry) => <div key={entry.id} className="p-4"><div className="flex justify-between gap-3"><button onClick={() => editCommentary(entry)} className="text-left"><div className="text-sm font-semibold">{entry.area} · {entry.component}</div><div className="mt-1 font-mono text-[10px] text-emerald-700">{entry.canonicalAreaDefinitionId && entry.canonicalComponentDefinitionId ? `${entry.canonicalAreaDefinitionId}@${entry.canonicalAreaDefinitionVersion} / ${entry.canonicalComponentDefinitionId}@${entry.canonicalComponentDefinitionVersion}` : 'LEGACY LABEL-ONLY RULE'}</div><p className="mt-2 text-xs text-gray-600">{entry.text}</p></button>{activeTemplate.status === 'draft' && <button onClick={() => void updateTemplate({ ...activeTemplate, commentaryBank: activeTemplate.commentaryBank.filter((candidate) => candidate.id !== entry.id) }, 'Commentary rule removed.')} className="text-rose-500"><Trash2 size={15} /></button>}</div></div>)}{activeTemplate.commentaryBank.length === 0 && <div className="p-8 text-center text-sm text-gray-500">No Commentary rules yet.</div>}</div></section>
        </div>
      )}

      {activeTab === 'preview' && activeTemplate && (
        <div className="grid gap-5 xl:grid-cols-2"><section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Canonical Test Fact</h2><div className="mt-4 space-y-3"><select value={previewAreaKey} onChange={(event) => { setPreviewAreaKey(event.target.value); setPreviewComponentKey(''); }} className="w-full rounded-lg border p-2 text-xs">{publishedAreas.map((area) => <option key={versionKey(area.definition.id, area.definition.version)} value={versionKey(area.definition.id, area.definition.version)}>{area.definition.name} · {area.definition.id}@{area.definition.version}</option>)}</select><select value={previewComponentKey} onChange={(event) => setPreviewComponentKey(event.target.value)} className="w-full rounded-lg border p-2 text-xs">{previewComponentOptions.map(({ component }) => <option key={versionKey(component.definition.id, component.definition.version)} value={versionKey(component.definition.id, component.definition.version)}>{component.definition.name} · {component.definition.id}@{component.definition.version}</option>)}</select><select value={previewCondition} onChange={(event) => setPreviewCondition(event.target.value as StructuredInspectionFact['condition'])} className="w-full rounded-lg border p-2 text-xs"><option value="clean_intact">Clean & intact</option><option value="minor_wear">Minor wear</option><option value="requires_cleaning">Requires cleaning</option><option value="repair_required">Repair required</option><option value="damaged">Damaged</option><option value="unable_to_confirm">Unable to confirm</option></select></div></section><section className="rounded-2xl border bg-slate-950 p-5 text-slate-100"><h2 className="font-bold">Matched Output</h2>{previewFact && <div className="mt-3 font-mono text-[10px] text-emerald-300">{previewFact.canonicalAreaDefinitionId} / {previewFact.canonicalComponentDefinitionId}</div>}<pre className="mt-4 whitespace-pre-wrap text-xs">{previewOutput ? JSON.stringify(previewOutput, null, 2) : 'Select a canonical Area and Component.'}</pre></section></div>
      )}

      {showNew && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"><div className="flex justify-between"><h2 className="font-bold">New Canonical Template Draft</h2><button onClick={() => setShowNew(false)}><X size={18} /></button></div><input value={newTemplateId} onChange={(event) => setNewTemplateId(event.target.value)} className="mt-4 w-full rounded-lg border p-2 text-sm" placeholder="Template ID" /><select value={newTemplateType} onChange={(event) => setNewTemplateType(event.target.value as InspectionTypeTemplate['inspectionType'])} className="mt-3 w-full rounded-lg border p-2 text-sm">{INSPECTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select><button disabled={saving} onClick={() => void createTemplate()} className="mt-4 w-full rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Create Draft</button></div></div>}
    </div>
  );
};

export default TemplatesPage;
