import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BookOpen,
  CheckCircle2,
  Copy,
  FileText,
  Layers,
  Play,
  Plus,
  Search,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  generateCommentary,
  importCommentaryBank,
  pcrStandardAreas,
  PCR_STANDARD_AREAS,
  validateCommentaryText,
  type CommentaryEntry,
  type ImportRow,
  type ImportValidationResult,
  type InspectionTypeTemplate,
  type StructuredInspectionFact,
} from '@pcr/templates';
import CatalogueAdminPanel from '../../components/templates/CatalogueAdminPanel';
import {
  duplicateTemplateToNewDraft,
  getTemplates,
  publishTemplateVersion,
  retireTemplateVersion,
  saveTemplate,
} from '../../services/templateStorage';

type ActiveTab = 'templates' | 'areas' | 'bank' | 'preview';

const TemplatesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('templates');
  const [templates, setTemplates] = useState<InspectionTypeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedVersion, setSelectedVersion] = useState(1);
  const [error, setError] = useState('');

  const [templateSearch, setTemplateSearch] = useState('');
  const [templateTypeFilter, setTemplateTypeFilter] = useState('all');
  const [templateStatusFilter, setTemplateStatusFilter] = useState('all');

  const [bankSearch, setBankSearch] = useState('');
  const [bankAreaFilter, setBankAreaFilter] = useState('all');
  const [bankConditionFilter, setBankConditionFilter] = useState('all');
  const [bankTypeFilter, setBankTypeFilter] = useState('all');

  const [showNewDraftModal, setShowNewDraftModal] = useState(false);
  const [showAddEntryModal, setShowAddEntryModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CommentaryEntry | null>(null);

  const [newTemplateId, setNewTemplateId] = useState('');
  const [newTemplateType, setNewTemplateType] = useState('entry');

  const [entryArea, setEntryArea] = useState('Entry');
  const [entryComponent, setEntryComponent] = useState('Front Door');
  const [entrySubComponent, setEntrySubComponent] = useState('');
  const [entryCondition, setEntryCondition] = useState('minor_wear');
  const [entryInspectionTypes, setEntryInspectionTypes] = useState<string[]>(['entry']);
  const [entryText, setEntryText] = useState('');
  const [entryError, setEntryError] = useState('');

  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState<ImportValidationResult | null>(null);

  const [previewFact, setPreviewFact] = useState<StructuredInspectionFact>({
    area: 'Entry',
    component: 'Front Door',
    material: 'timber',
    colour: 'white',
    type: 'hinged door with silver lever handle',
    quantity: 1,
    visibility: 'visible',
    condition: 'minor_wear',
    conditionIssue: 'minor scuff marks near handle',
    cleanlinessIssue: '',
    workingState: 'not_relevant',
    photoReferences: ['photo-001.jpg'],
    inspectionType: 'entry',
  });

  const loadData = async (preferred?: { id: string; version: number }) => {
    setLoading(true);
    setError('');
    try {
      const list = await getTemplates();
      setTemplates(list);
      const selected = preferred
        ? list.find((item) => item.id === preferred.id && item.version === preferred.version)
        : list.find((item) => item.id === selectedTemplateId && item.version === selectedVersion) || list[0];
      if (selected) {
        setSelectedTemplateId(selected.id);
        setSelectedVersion(selected.version);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load templates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId && template.version === selectedVersion) || templates[0],
    [templates, selectedTemplateId, selectedVersion],
  );

  const filteredTemplates = useMemo(() => templates.filter((template) => {
    const query = templateSearch.trim().toLowerCase();
    const matchesSearch = !query || template.id.toLowerCase().includes(query) || template.inspectionType.toLowerCase().includes(query) || template.propertyType.toLowerCase().includes(query);
    const matchesType = templateTypeFilter === 'all' || template.inspectionType === templateTypeFilter;
    const matchesStatus = templateStatusFilter === 'all' || template.status === templateStatusFilter;
    return matchesSearch && matchesType && matchesStatus;
  }), [templates, templateSearch, templateTypeFilter, templateStatusFilter]);

  const filteredBankEntries = useMemo(() => {
    if (!activeTemplate) return [];
    const query = bankSearch.trim().toLowerCase();
    return activeTemplate.commentaryBank.filter((entry) => {
      const matchesSearch = !query || entry.text.toLowerCase().includes(query) || entry.component.toLowerCase().includes(query) || entry.area.toLowerCase().includes(query);
      const matchesArea = bankAreaFilter === 'all' || entry.area === bankAreaFilter;
      const matchesCondition = bankConditionFilter === 'all' || entry.condition === bankConditionFilter;
      const matchesType = bankTypeFilter === 'all' || entry.inspectionTypes.includes(bankTypeFilter as never);
      return matchesSearch && matchesArea && matchesCondition && matchesType;
    });
  }, [activeTemplate, bankSearch, bankAreaFilter, bankConditionFilter, bankTypeFilter]);

  const previewOutput = useMemo(() => {
    if (!activeTemplate) return null;
    try {
      return generateCommentary(activeTemplate, previewFact);
    } catch (caught) {
      return { error: caught instanceof Error ? caught.message : 'Failed to generate commentary.' };
    }
  }, [activeTemplate, previewFact]);

  const handlePublish = async (id: string, version: number) => {
    try {
      const published = await publishTemplateVersion(id, version);
      await loadData({ id: published.id, version: published.version });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to publish template.');
    }
  };

  const handleDuplicate = async (id: string, version: number) => {
    try {
      const draft = await duplicateTemplateToNewDraft(id, version);
      await loadData({ id: draft.id, version: draft.version });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to duplicate template.');
    }
  };

  const handleRetire = async (id: string, version: number) => {
    if (!window.confirm('Retire this template version? Historical reports remain bound to their existing version.')) return;
    try {
      const retired = await retireTemplateVersion(id, version);
      await loadData({ id: retired.id, version: retired.version });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to retire template.');
    }
  };

  const handleCreateNewDraft = async () => {
    const id = newTemplateId.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
    if (!id) {
      setError('Template ID is required.');
      return;
    }
    const newDraft: InspectionTypeTemplate = {
      id,
      version: 1,
      inspectionType: newTemplateType as InspectionTypeTemplate['inspectionType'],
      propertyType: 'residential',
      status: 'draft',
      areas: structuredClone(pcrStandardAreas),
      commentaryBank: [],
      createdAt: new Date().toISOString(),
    };
    try {
      await saveTemplate(newDraft);
      setShowNewDraftModal(false);
      setNewTemplateId('');
      await loadData({ id, version: 1 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to create template draft.');
    }
  };

  const resetEntryForm = () => {
    setEntryArea('Entry');
    setEntryComponent('Front Door');
    setEntrySubComponent('');
    setEntryCondition('minor_wear');
    setEntryInspectionTypes(['entry']);
    setEntryText('');
    setEntryError('');
  };

  const openNewEntry = () => {
    if (!activeTemplate || activeTemplate.status !== 'draft') {
      setError('Published and retired templates are immutable. Duplicate this version before editing its Commentary Bank.');
      return;
    }
    resetEntryForm();
    setEditingEntry(null);
    setShowAddEntryModal(true);
  };

  const openEditEntry = (entry: CommentaryEntry) => {
    if (!activeTemplate || activeTemplate.status !== 'draft') {
      setError('Published and retired templates are immutable. Duplicate this version before editing its Commentary Bank.');
      return;
    }
    setEditingEntry(entry);
    setEntryArea(entry.area);
    setEntryComponent(entry.component);
    setEntrySubComponent(entry.subComponent || '');
    setEntryCondition(String(entry.condition));
    setEntryInspectionTypes([...entry.inspectionTypes]);
    setEntryText(entry.text);
    setEntryError('');
    setShowAddEntryModal(true);
  };

  const handleSaveBankEntry = async () => {
    if (!activeTemplate || activeTemplate.status !== 'draft') return;
    setEntryError('');
    try {
      validateCommentaryText(entryText);
    } catch (caught) {
      setEntryError(caught instanceof Error ? caught.message : 'Invalid commentary text.');
      return;
    }

    const updatedBank = [...activeTemplate.commentaryBank];
    if (editingEntry) {
      const index = updatedBank.findIndex((entry) => entry.id === editingEntry.id);
      if (index >= 0) {
        updatedBank[index] = {
          ...editingEntry,
          area: entryArea,
          component: entryComponent,
          subComponent: entrySubComponent || undefined,
          condition: entryCondition,
          inspectionTypes: entryInspectionTypes as CommentaryEntry['inspectionTypes'],
          text: entryText,
          updatedAt: new Date().toISOString(),
        };
      }
    } else {
      updatedBank.push({
        id: `commentary-${Date.now().toString(36)}`,
        area: entryArea,
        component: entryComponent,
        subComponent: entrySubComponent || undefined,
        condition: entryCondition,
        inspectionTypes: entryInspectionTypes as CommentaryEntry['inspectionTypes'],
        text: entryText,
        active: true,
        createdAt: new Date().toISOString(),
      });
    }

    try {
      await saveTemplate({ ...activeTemplate, commentaryBank: updatedBank });
      setShowAddEntryModal(false);
      setEditingEntry(null);
      resetEntryForm();
      await loadData({ id: activeTemplate.id, version: activeTemplate.version });
    } catch (caught) {
      setEntryError(caught instanceof Error ? caught.message : 'Failed to save Commentary Bank entry.');
    }
  };

  const handleParseCsv = () => {
    if (!csvText.trim()) {
      setImportResult(null);
      return;
    }
    const rows: ImportRow[] = csvText
      .trim()
      .split(/\r?\n/gu)
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(',').map((part) => part.trim().replace(/^"(.*)"$/u, '$1'));
        return {
          area: parts[0] || '',
          component: parts[1] || '',
          condition: parts[2] || 'minor_wear',
          inspectionTypes: parts[3] || 'entry',
          text: parts.slice(4).join(',').trim(),
        };
      });
    setImportResult(importCommentaryBank(rows, activeTemplate?.commentaryBank || []));
  };

  const handleCommitImport = async () => {
    if (!activeTemplate || activeTemplate.status !== 'draft' || !importResult || importResult.validRows === 0) return;
    try {
      await saveTemplate({
        ...activeTemplate,
        commentaryBank: [...activeTemplate.commentaryBank, ...importResult.entries],
      });
      setShowImportModal(false);
      setCsvText('');
      setImportResult(null);
      await loadData({ id: activeTemplate.id, version: activeTemplate.version });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to import Commentary Bank entries.');
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        <p className="mt-2 text-sm">Loading Templates & Rules...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span>{error}</span>
          <button onClick={() => setError('')}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">Templates & Rules</h1>
          <p className="text-sm text-gray-600">Manage versioned inspection templates, the canonical Areas & Components Catalogue, and deterministic commentary rules.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowNewDraftModal(true)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"><Plus className="h-4 w-4" /> New Template Draft</button>
          <button onClick={() => setShowImportModal(true)} disabled={!activeTemplate || activeTemplate.status !== 'draft'} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40"><Upload className="h-4 w-4" /> Import Commentary CSV</button>
        </div>
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto">
          {[
            { id: 'templates', label: 'Inspection Templates', icon: FileText },
            { id: 'areas', label: 'Areas & Components Catalogue', icon: Layers },
            { id: 'bank', label: `Commentary Bank (${activeTemplate?.commentaryBank?.length || 0})`, icon: BookOpen },
            { id: 'preview', label: 'Preview & Test Bench', icon: Play },
          ].map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as ActiveTab)} className={`flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium ${selected ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}>
                <Icon className="h-4 w-4" /> {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:flex-row">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder="Search templates by ID, type or property type..." className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" /></div>
            <select value={templateTypeFilter} onChange={(event) => setTemplateTypeFilter(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="all">All Inspection Types</option><option value="entry">Entry PCR</option><option value="routine">Routine Inspection</option><option value="exit">Exit PCR</option><option value="comparison">Comparison</option><option value="maintenance">Maintenance</option></select>
            <select value={templateStatusFilter} onChange={(event) => setTemplateStatusFilter(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="all">All Statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="retired">Retired</option></select>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredTemplates.map((template) => {
              const selected = template.id === selectedTemplateId && template.version === selectedVersion;
              return (
                <div key={`${template.id}@${template.version}`} className={`rounded-xl border bg-white p-5 shadow-sm ${selected ? 'border-emerald-600 ring-2 ring-emerald-500/20' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between"><span className="font-mono text-xs text-gray-500">v{template.version}</span><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${template.status === 'published' ? 'bg-emerald-100 text-emerald-800' : template.status === 'draft' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>{template.status}</span></div>
                  <h3 className="mt-2 font-semibold capitalize text-gray-950">{template.id.replaceAll('-', ' ')}</h3>
                  <p className="mt-1 text-xs text-gray-500">{template.inspectionType.toUpperCase()} · {template.propertyType}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-gray-100 pt-3 text-xs text-gray-600"><div><span className="block font-semibold text-gray-900">{template.areas.length}</span>Areas</div><div><span className="block font-semibold text-gray-900">{template.commentaryBank.length}</span>Bank Rules</div></div>
                  <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3"><button onClick={() => { setSelectedTemplateId(template.id); setSelectedVersion(template.version); }} className="text-xs font-semibold text-emerald-700">{selected ? 'Active Selection' : 'Select'}</button><div className="flex gap-1">{template.status === 'draft' && <button onClick={() => void handlePublish(template.id, template.version)} title="Publish" className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50"><CheckCircle2 className="h-4 w-4" /></button>}<button onClick={() => void handleDuplicate(template.id, template.version)} title="Duplicate" className="rounded p-1.5 text-gray-600 hover:bg-gray-100"><Copy className="h-4 w-4" /></button>{template.status === 'published' && <button onClick={() => void handleRetire(template.id, template.version)} title="Retire" className="rounded p-1.5 text-rose-600 hover:bg-rose-50"><Archive className="h-4 w-4" /></button>}</div></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'areas' && <CatalogueAdminPanel />}

      {activeTab === 'bank' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-semibold text-emerald-950">Active Bank: {activeTemplate?.id} v{activeTemplate?.version}</p><p className="text-xs text-emerald-700">{activeTemplate?.status} · {activeTemplate?.commentaryBank.length || 0} rules</p></div>
            <button onClick={openNewEntry} disabled={!activeTemplate || activeTemplate.status !== 'draft'} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add Commentary Rule</button>
          </div>
          <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:grid-cols-4">
            <div className="relative md:col-span-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={bankSearch} onChange={(event) => setBankSearch(event.target.value)} placeholder="Search bank..." className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-xs" /></div>
            <select value={bankAreaFilter} onChange={(event) => setBankAreaFilter(event.target.value)} className="rounded-lg border border-gray-300 p-2 text-xs"><option value="all">All Areas</option>{PCR_STANDARD_AREAS.map((area) => <option key={area} value={area}>{area}</option>)}</select>
            <select value={bankConditionFilter} onChange={(event) => setBankConditionFilter(event.target.value)} className="rounded-lg border border-gray-300 p-2 text-xs"><option value="all">All Conditions</option><option value="clean_intact">Clean & Intact</option><option value="minor_wear">Minor Wear</option><option value="requires_cleaning">Requires Cleaning</option><option value="repair_required">Repair Required</option><option value="damaged">Damaged</option><option value="unable_to_confirm">Unable to Confirm</option></select>
            <select value={bankTypeFilter} onChange={(event) => setBankTypeFilter(event.target.value)} className="rounded-lg border border-gray-300 p-2 text-xs"><option value="all">All Inspection Types</option><option value="entry">Entry</option><option value="routine">Routine</option><option value="exit">Exit</option><option value="comparison">Comparison</option><option value="maintenance">Maintenance</option></select>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="divide-y divide-gray-100">
              {filteredBankEntries.map((entry) => (
                <button key={entry.id} onClick={() => openEditEntry(entry)} className="w-full p-4 text-left hover:bg-gray-50">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-semibold text-gray-900">{entry.area} · {entry.component}</p><p className="mt-1 text-xs text-gray-600">{entry.text}</p></div><div className="flex flex-wrap gap-1">{entry.inspectionTypes.map((type) => <span key={type} className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-600">{type}</span>)}<span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{String(entry.condition).replaceAll('_', ' ')}</span></div></div>
                </button>
              ))}
              {filteredBankEntries.length === 0 && <div className="p-8 text-center text-sm text-gray-500">No Commentary Bank rules match the current filters.</div>}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'preview' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-gray-950">Structured Inspection Fact</h2>
            <p className="mt-1 text-xs text-gray-500">Test deterministic commentary generation against the selected Template Version.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
              <label className="font-medium text-gray-700">Area<input value={previewFact.area} onChange={(event) => setPreviewFact({ ...previewFact, area: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 p-2" /></label>
              <label className="font-medium text-gray-700">Component<input value={previewFact.component} onChange={(event) => setPreviewFact({ ...previewFact, component: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 p-2" /></label>
              <label className="font-medium text-gray-700">Material<input value={previewFact.material || ''} onChange={(event) => setPreviewFact({ ...previewFact, material: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 p-2" /></label>
              <label className="font-medium text-gray-700">Colour / Finish<input value={previewFact.colour || ''} onChange={(event) => setPreviewFact({ ...previewFact, colour: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 p-2" /></label>
              <label className="font-medium text-gray-700">Visibility<select value={previewFact.visibility} onChange={(event) => setPreviewFact({ ...previewFact, visibility: event.target.value as StructuredInspectionFact['visibility'] })} className="mt-1 w-full rounded-lg border border-gray-300 p-2"><option value="visible">Visible</option><option value="partially_visible">Partially Visible</option><option value="not_visible">Not Visible</option><option value="not_applicable">Not Applicable</option></select></label>
              <label className="font-medium text-gray-700">Condition<select value={previewFact.condition} onChange={(event) => setPreviewFact({ ...previewFact, condition: event.target.value as StructuredInspectionFact['condition'] })} className="mt-1 w-full rounded-lg border border-gray-300 p-2"><option value="clean_intact">Clean & Intact</option><option value="minor_wear">Minor Wear</option><option value="requires_cleaning">Requires Cleaning</option><option value="repair_required">Repair Required</option><option value="damaged">Damaged</option><option value="unable_to_confirm">Unable to Confirm</option></select></label>
              <label className="font-medium text-gray-700">Working State<select value={previewFact.workingState} onChange={(event) => setPreviewFact({ ...previewFact, workingState: event.target.value as StructuredInspectionFact['workingState'] })} className="mt-1 w-full rounded-lg border border-gray-300 p-2"><option value="not_relevant">Not Relevant</option><option value="tested_working">Tested & Working</option><option value="tested_not_working">Tested & Not Working</option><option value="not_tested">Not Tested</option></select></label>
              <label className="font-medium text-gray-700">Condition Issue<input value={previewFact.conditionIssue || ''} onChange={(event) => setPreviewFact({ ...previewFact, conditionIssue: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 p-2" /></label>
              <label className="sm:col-span-2 font-medium text-gray-700">Cleanliness Issue<input value={previewFact.cleanlinessIssue || ''} onChange={(event) => setPreviewFact({ ...previewFact, cleanlinessIssue: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 p-2" /></label>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-bold text-gray-950"><Sparkles className="h-4 w-4 text-emerald-600" /> Generated Commentary Output</h2>
            {previewOutput && 'error' in previewOutput ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">Generation rejected by safeguards</p><p>{previewOutput.error}</p></div></div>
            ) : previewOutput ? (
              <div className="mt-4 space-y-4"><div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4"><span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Final Commentary</span><p className="mt-2 text-sm font-medium leading-relaxed text-gray-950">{previewOutput.commentary}</p></div><div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 text-xs"><div><span className="text-gray-500">Method:</span> <span className="font-semibold uppercase text-emerald-700">{previewOutput.generationMethod}</span></div><div><span className="text-gray-500">Bank Rule:</span> <span className="font-mono text-gray-800">{previewOutput.bankEntryId || 'Fallback'}</span></div></div></div>
            ) : null}
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3"><h3 className="text-lg font-bold text-gray-950">Import Commentary Bank CSV</h3><button onClick={() => setShowImportModal(false)}><X className="h-5 w-5 text-gray-400" /></button></div>
            <p className="text-xs text-gray-600">Format: Area, Component, Condition, InspectionTypes, CommentaryText</p>
            <textarea rows={7} value={csvText} onChange={(event) => setCsvText(event.target.value)} className="w-full rounded-lg border border-gray-300 p-3 font-mono text-xs" />
            <button onClick={handleParseCsv} className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white">Validate CSV</button>
            {importResult && <div className="rounded-lg border bg-gray-50 p-4 text-xs"><div className="flex flex-wrap gap-4 font-semibold"><span>Total: {importResult.totalRows}</span><span className="text-emerald-700">Valid: {importResult.validRows}</span><span className="text-amber-700">Duplicates: {importResult.duplicateRows}</span></div>{importResult.issues.length > 0 && <div className="mt-2 max-h-40 space-y-1 overflow-y-auto border-t pt-2 text-rose-700">{importResult.issues.map((issue, index) => <p key={`${issue.row}-${index}`}>Row {issue.row}: [{issue.code}] {issue.message}</p>)}</div>}</div>}
            <div className="flex justify-end gap-2 border-t pt-4"><button onClick={() => setShowImportModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700">Cancel</button><button disabled={!importResult || importResult.validRows === 0} onClick={() => void handleCommitImport()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Commit Import ({importResult?.validRows || 0})</button></div>
          </div>
        </div>
      )}

      {showAddEntryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3"><h3 className="text-lg font-bold text-gray-950">{editingEntry ? 'Edit Commentary Rule' : 'New Commentary Rule'}</h3><button onClick={() => setShowAddEntryModal(false)}><X className="h-5 w-5 text-gray-400" /></button></div>
            {entryError && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{entryError}</div>}
            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <label className="font-medium text-gray-700">Area<select value={entryArea} onChange={(event) => setEntryArea(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2">{PCR_STANDARD_AREAS.map((area) => <option key={area} value={area}>{area}</option>)}</select></label>
              <label className="font-medium text-gray-700">Component<input value={entryComponent} onChange={(event) => setEntryComponent(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2" /></label>
              <label className="font-medium text-gray-700">Sub-component<input value={entrySubComponent} onChange={(event) => setEntrySubComponent(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2" /></label>
              <label className="font-medium text-gray-700">Condition<select value={entryCondition} onChange={(event) => setEntryCondition(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2"><option value="clean_intact">Clean & Intact</option><option value="minor_wear">Minor Wear</option><option value="requires_cleaning">Requires Cleaning</option><option value="repair_required">Repair Required</option><option value="damaged">Damaged</option><option value="unable_to_confirm">Unable to Confirm</option></select></label>
              <div className="sm:col-span-2"><span className="font-medium text-gray-700">Inspection Types</span><div className="mt-2 flex flex-wrap gap-3">{['entry', 'routine', 'exit', 'comparison', 'maintenance'].map((type) => <label key={type} className="flex items-center gap-1.5"><input type="checkbox" checked={entryInspectionTypes.includes(type)} onChange={(event) => setEntryInspectionTypes(event.target.checked ? [...entryInspectionTypes, type] : entryInspectionTypes.filter((value) => value !== type))} /> {type}</label>)}</div></div>
              <label className="sm:col-span-2 font-medium text-gray-700">Commentary Pattern<input value={entryText} onChange={(event) => setEntryText(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 font-mono" /></label>
            </div>
            <div className="flex justify-end gap-2 border-t pt-4"><button onClick={() => setShowAddEntryModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700">Cancel</button><button onClick={() => void handleSaveBankEntry()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white">Save Commentary Rule</button></div>
          </div>
        </div>
      )}

      {showNewDraftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3"><h3 className="text-lg font-bold text-gray-950">Create New Template Draft</h3><button onClick={() => setShowNewDraftModal(false)}><X className="h-5 w-5 text-gray-400" /></button></div>
            <label className="block text-xs font-medium text-gray-700">Template ID / Name<input value={newTemplateId} onChange={(event) => setNewTemplateId(event.target.value)} placeholder="e.g. wa-entry-pcr-custom" className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" /></label>
            <label className="block text-xs font-medium text-gray-700">Inspection Type<select value={newTemplateType} onChange={(event) => setNewTemplateType(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"><option value="entry">Entry PCR</option><option value="routine">Routine Inspection</option><option value="exit">Exit PCR</option><option value="comparison">Comparison</option><option value="maintenance">Maintenance</option></select></label>
            <div className="flex justify-end gap-2 border-t pt-4"><button onClick={() => setShowNewDraftModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700">Cancel</button><button onClick={() => void handleCreateNewDraft()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white">Create Template Draft</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TemplatesPage;
