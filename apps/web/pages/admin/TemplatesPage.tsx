import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Plus,
  CheckCircle2,
  Archive,
  Copy,
  Upload,
  Search,
  Layers,
  Play,
  BookOpen,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Sparkles,
  X,
} from 'lucide-react';
import {
  type InspectionTypeTemplate,
  type CommentaryEntry,
  type StructuredInspectionFact,
  type ImportRow,
  type ImportValidationResult,
  generateCommentary,
  importCommentaryBank,
  validateCommentaryText,
  PCR_STANDARD_AREAS,
  pcrStandardAreas,
  type TemplateArea,
  type TemplateComponent,
} from '@pcr/templates';
import {
  getTemplates,
  saveTemplate,
  publishTemplateVersion,
  duplicateTemplateToNewDraft,
  retireTemplateVersion,
} from '../../services/templateStorage';

type ActiveTab = 'templates' | 'areas' | 'bank' | 'preview';

const TemplatesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('templates');
  const [templates, setTemplates] = useState<InspectionTypeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedVersion, setSelectedVersion] = useState<number>(1);

  // Search & Filters for Templates
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateTypeFilter, setTemplateTypeFilter] = useState('all');
  const [templateStatusFilter, setTemplateStatusFilter] = useState('all');

  // Search & Filters for Commentary Bank
  const [bankSearch, setBankSearch] = useState('');
  const [bankAreaFilter, setBankAreaFilter] = useState('all');
  const [bankComponentFilter] = useState('');
  const [bankConditionFilter, setBankConditionFilter] = useState('all');
  const [bankTypeFilter, setBankTypeFilter] = useState('all');
  const [bankActiveOnly] = useState(false);

  // Modals
  const [showNewDraftModal, setShowNewDraftModal] = useState(false);
  const [showAddEntryModal, setShowAddEntryModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CommentaryEntry | null>(null);

  // New Draft Modal Form
  const [newTemplateId, setNewTemplateId] = useState('');
  const [newTemplateType, setNewTemplateType] = useState('entry');
  const [newPropertyType] = useState('residential');

  // Add/Edit Bank Entry Form
  const [entryArea, setEntryArea] = useState('Entry');
  const [entryComponent, setEntryComponent] = useState('Front Door');
  const [entrySubComponent, setEntrySubComponent] = useState('');
  const [entryCondition, setEntryCondition] = useState('minor_wear');
  const [entryInspectionTypes, setEntryInspectionTypes] = useState<string[]>(['entry']);
  const [entryText, setEntryText] = useState('');
  const [entryError, setEntryError] = useState('');

  // CSV Import State
  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState<ImportValidationResult | null>(null);

  // Expanded Area Accordion in Catalogue
  const [expandedAreaId, setExpandedAreaId] = useState<string | null>('entry');

  // Preview Tool State
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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await getTemplates();
      setTemplates(list);
      if (list.length > 0) {
        setSelectedTemplateId(list[0].id);
        setSelectedVersion(list[0].version);
      }
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const activeTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId && t.version === selectedVersion) || templates[0];
  }, [templates, selectedTemplateId, selectedVersion]);

  // Template Filtering
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      const matchSearch =
        t.id.toLowerCase().includes(templateSearch.toLowerCase()) ||
        t.inspectionType.toLowerCase().includes(templateSearch.toLowerCase());
      const matchType = templateTypeFilter === 'all' || t.inspectionType === templateTypeFilter;
      const matchStatus = templateStatusFilter === 'all' || t.status === templateStatusFilter;
      return matchSearch && matchType && matchStatus;
    });
  }, [templates, templateSearch, templateTypeFilter, templateStatusFilter]);

  // Commentary Bank Filtering
  const filteredBankEntries = useMemo(() => {
    if (!activeTemplate || !activeTemplate.commentaryBank) return [];
    return activeTemplate.commentaryBank.filter((entry) => {
      const matchSearch =
        entry.text.toLowerCase().includes(bankSearch.toLowerCase()) ||
        entry.component.toLowerCase().includes(bankSearch.toLowerCase()) ||
        entry.area.toLowerCase().includes(bankSearch.toLowerCase());
      const matchArea = bankAreaFilter === 'all' || entry.area === bankAreaFilter;
      const matchComponent =
        !bankComponentFilter ||
        entry.component.toLowerCase().includes(bankComponentFilter.toLowerCase());
      const matchCondition = bankConditionFilter === 'all' || entry.condition === bankConditionFilter;
      const matchType =
        bankTypeFilter === 'all' || entry.inspectionTypes.includes(bankTypeFilter as any);
      const matchActive = !bankActiveOnly || entry.active !== false;

      return matchSearch && matchArea && matchComponent && matchCondition && matchType && matchActive;
    });
  }, [
    activeTemplate,
    bankSearch,
    bankAreaFilter,
    bankComponentFilter,
    bankConditionFilter,
    bankTypeFilter,
    bankActiveOnly,
  ]);

  // Handlers
  const handlePublish = async (id: string, version: number) => {
    try {
      await publishTemplateVersion(id, version);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to publish template.');
    }
  };

  const handleDuplicate = async (id: string, version: number) => {
    try {
      const newDraft = await duplicateTemplateToNewDraft(id, version);
      await loadData();
      setSelectedTemplateId(newDraft.id);
      setSelectedVersion(newDraft.version);
    } catch (err: any) {
      alert(err.message || 'Failed to duplicate template.');
    }
  };

  const handleRetire = async (id: string, version: number) => {
    if (!confirm('Are you sure you want to retire this template version?')) return;
    try {
      await retireTemplateVersion(id, version);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to retire template.');
    }
  };

  const handleCreateNewDraft = async () => {
    if (!newTemplateId.trim()) {
      alert('Template ID is required.');
      return;
    }
    const newDraft: InspectionTypeTemplate = {
      id: newTemplateId.trim().toLowerCase().replaceAll(' ', '-'),
      version: 1,
      inspectionType: newTemplateType as any,
      propertyType: newPropertyType,
      status: 'draft',
      areas: structuredClone(pcrStandardAreas),
      commentaryBank: [],
      createdAt: new Date().toISOString(),
    };
    try {
      await saveTemplate(newDraft);
      await loadData();
      setSelectedTemplateId(newDraft.id);
      setSelectedVersion(1);
      setShowNewDraftModal(false);
      setNewTemplateId('');
    } catch (err: any) {
      alert(err.message || 'Failed to create template draft.');
    }
  };

  const handleSaveBankEntry = async () => {
    if (!activeTemplate) return;
    setEntryError('');
    try {
      validateCommentaryText(entryText);
    } catch (err: any) {
      setEntryError(err.message || 'Invalid commentary text.');
      return;
    }

    const updatedBank = [...(activeTemplate.commentaryBank || [])];

    if (editingEntry) {
      const idx = updatedBank.findIndex((e) => e.id === editingEntry.id);
      if (idx >= 0) {
        updatedBank[idx] = {
          ...editingEntry,
          area: entryArea,
          component: entryComponent,
          subComponent: entrySubComponent || undefined,
          condition: entryCondition,
          inspectionTypes: entryInspectionTypes as any,
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
        inspectionTypes: entryInspectionTypes as any,
        text: entryText,
        active: true,
        createdAt: new Date().toISOString(),
      });
    }

    const updatedTemplate = { ...activeTemplate, commentaryBank: updatedBank };
    try {
      await saveTemplate(updatedTemplate);
      await loadData();
      setShowAddEntryModal(false);
      setEditingEntry(null);
      resetEntryForm();
    } catch (err: any) {
      setEntryError(err.message || 'Failed to save bank entry.');
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

  const handleParseCsv = () => {
    if (!csvText.trim()) {
      setImportResult(null);
      return;
    }
    const lines = csvText.trim().split('\n').filter(Boolean);
    const rows: ImportRow[] = lines.map((line) => {
      const parts = line.split(',').map((p) => p.trim().replace(/^"(.*)"$/, '$1'));
      return {
        area: parts[0] || '',
        component: parts[1] || '',
        condition: parts[2] || 'minor_wear',
        inspectionTypes: parts[3] || 'entry',
        text: parts[4] || parts[3] || '',
      };
    });

    const res = importCommentaryBank(rows, activeTemplate?.commentaryBank || []);
    setImportResult(res);
  };

  const handleCommitImport = async () => {
    if (!activeTemplate || !importResult || importResult.validRows === 0) return;
    try {
      const updatedBank = [...(activeTemplate.commentaryBank || []), ...importResult.entries];
      await saveTemplate({ ...activeTemplate, commentaryBank: updatedBank });
      await loadData();
      setShowImportModal(false);
      setCsvText('');
      setImportResult(null);
      alert(`Successfully imported ${importResult.validRows} commentary bank entries!`);
    } catch (err: any) {
      alert(err.message || 'Failed to commit import.');
    }
  };

  // Preview Output
  const previewOutput = useMemo(() => {
    if (!activeTemplate) return null;
    try {
      return generateCommentary(activeTemplate, previewFact);
    } catch (err: any) {
      return { error: err.message || 'Failed to generate commentary' };
    }
  }, [activeTemplate, previewFact]);

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"></div>
        <p className="mt-2 text-sm">Loading PCR Commentary Bank & Templates...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">PCR Commentary Bank & Rule Engine</h1>
          <p className="text-sm text-gray-600">
            Manage versioned inspection templates, canonical areas, components, and deterministic commentary rules.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowNewDraftModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 transition"
          >
            <Plus className="h-4 w-4" /> New Template Draft
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition"
          >
            <Upload className="h-4 w-4" /> Import Commentary CSV
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'templates', label: 'Inspection Templates', icon: FileText },
            { id: 'areas', label: 'Areas & Components Catalogue', icon: Layers },
            { id: 'bank', label: `Commentary Bank (${activeTemplate?.commentaryBank?.length || 0})`, icon: BookOpen },
            { id: 'preview', label: 'Preview & Test Bench', icon: Play },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`flex items-center gap-2 border-b-2 py-3 px-1 text-sm font-medium transition ${
                  isActive
                    ? 'border-emerald-600 text-emerald-700 font-semibold'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-emerald-600' : 'text-gray-400'}`} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* TAB 1: INSPECTION TEMPLATES */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search templates by ID or type..."
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-300 pl-9 pr-4 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={templateTypeFilter}
                onChange={(e) => setTemplateTypeFilter(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">All Inspection Types</option>
                <option value="entry">Entry PCR</option>
                <option value="routine">Routine Inspection</option>
                <option value="exit">Exit PCR</option>
                <option value="comparison">Comparison</option>
                <option value="maintenance">Maintenance</option>
              </select>
              <select
                value={templateStatusFilter}
                onChange={(e) => setTemplateStatusFilter(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="retired">Retired</option>
              </select>
            </div>
          </div>

          {/* Template Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map((template) => {
              const isSelected = template.id === selectedTemplateId && template.version === selectedVersion;
              return (
                <div
                  key={`${template.id}-v${template.version}`}
                  className={`relative flex flex-col justify-between rounded-xl border p-5 transition shadow-sm bg-white ${
                    isSelected ? 'border-emerald-600 ring-2 ring-emerald-500/20' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-gray-500">v{template.version}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                          template.status === 'published'
                            ? 'bg-emerald-100 text-emerald-800'
                            : template.status === 'draft'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {template.status}
                      </span>
                    </div>

                    <h3 className="mt-2 font-semibold text-gray-950 capitalize">{template.id.replaceAll('-', ' ')}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Type: <span className="font-medium text-gray-700 uppercase">{template.inspectionType}</span> | Property: {template.propertyType}
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs border-t border-gray-100 pt-3 text-gray-600">
                      <div>
                        <span className="block font-semibold text-gray-900">{template.areas?.length || 0}</span>
                        <span>Areas</span>
                      </div>
                      <div>
                        <span className="block font-semibold text-gray-900">{template.commentaryBank?.length || 0}</span>
                        <span>Bank Rules</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">
                    <button
                      onClick={() => {
                        setSelectedTemplateId(template.id);
                        setSelectedVersion(template.version);
                      }}
                      className="text-xs font-medium text-emerald-700 hover:underline"
                    >
                      {isSelected ? 'Active Selection' : 'Select Template'}
                    </button>

                    <div className="flex items-center gap-1">
                      {template.status === 'draft' && (
                        <button
                          onClick={() => handlePublish(template.id, template.version)}
                          title="Publish Template Version"
                          className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDuplicate(template.id, template.version)}
                        title="Duplicate as New Draft Version"
                        className="rounded p-1.5 text-gray-600 hover:bg-gray-100"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      {template.status === 'published' && (
                        <button
                          onClick={() => handleRetire(template.id, template.version)}
                          title="Retire Template Version"
                          className="rounded p-1.5 text-rose-600 hover:bg-rose-50"
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: AREAS & COMPONENTS CATALOGUE */}
      {activeTab === 'areas' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-gray-950">Canonical Property Areas ({pcrStandardAreas.length})</h2>
            <p className="text-xs text-gray-500 mt-1">
              Standard PCR area definitions and canonical required inspection components.
            </p>

            <div className="mt-4 space-y-2">
              {pcrStandardAreas.map((area: TemplateArea) => {
                const isExpanded = expandedAreaId === area.id;
                return (
                  <div key={area.id} className="rounded-lg border border-gray-200 bg-gray-50/50">
                    <button
                      onClick={() => setExpandedAreaId(isExpanded ? null : area.id)}
                      className="flex w-full items-center justify-between p-3.5 text-left text-sm font-medium text-gray-900 hover:bg-gray-100/50 transition"
                    >
                      <span className="flex items-center gap-2">
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-emerald-600" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                        {area.name}
                      </span>
                      <span className="text-xs text-gray-500">{area.components.length} components</span>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-200 bg-white p-4">
                        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                          {area.components.map((comp: TemplateComponent) => (
                            <div key={comp.id} className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 p-2.5 text-xs">
                              <span className="font-medium text-gray-800">{comp.name}</span>
                              <div className="flex gap-1">
                                {comp.required && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Required</span>}
                                {comp.photoRequired && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800">Photo</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: COMMENTARY BANK */}
      {activeTab === 'bank' && (
        <div className="space-y-4">
          {/* Active Template Notice */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-900">
            <div>
              <p className="font-semibold">
                Active Bank: <span className="capitalize">{activeTemplate?.id.replaceAll('-', ' ')}</span> (v{activeTemplate?.version})
              </p>
              <p className="text-xs text-emerald-700 mt-0.5">
                Status: <span className="capitalize font-medium">{activeTemplate?.status}</span> | Total Rules: {activeTemplate?.commentaryBank?.length || 0}
              </p>
            </div>
            <button
              onClick={() => {
                resetEntryForm();
                setEditingEntry(null);
                setShowAddEntryModal(true);
              }}
              className="mt-2 sm:mt-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800 transition"
            >
              <Plus className="h-3.5 w-3.5" /> Add Commentary Rule
            </button>
          </div>

          {/* Filter Controls */}
          <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 md:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-gray-700">Area</label>
              <select
                value={bankAreaFilter}
                onChange={(e) => setBankAreaFilter(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-xs focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">All Areas</option>
                {PCR_STANDARD_AREAS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700">Condition</label>
              <select
                value={bankConditionFilter}
                onChange={(e) => setBankConditionFilter(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-xs focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">All Conditions</option>
                <option value="clean_intact">Clean & Intact</option>
                <option value="minor_wear">Minor Wear</option>
                <option value="requires_cleaning">Requires Cleaning</option>
                <option value="repair_required">Repair Required</option>
                <option value="damaged">Damaged</option>
                <option value="unable_to_confirm">Unable to Confirm</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700">Inspection Type</label>
              <select
                value={bankTypeFilter}
                onChange={(e) => setBankTypeFilter(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-xs focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">All Inspection Types</option>
                <option value="entry">Entry PCR</option>
                <option value="routine">Routine</option>
                <option value="exit">Exit PCR</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700">Search Keyword</label>
              <input
                type="text"
                placeholder="Search text or component..."
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-xs focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-700">
                  <tr>
                    <th className="p-3">Area & Component</th>
                    <th className="p-3">Types</th>
                    <th className="p-3">Condition</th>
                    <th className="p-3">Commentary Pattern / Text</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-800">
                  {filteredBankEntries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-gray-500">
                        No commentary bank entries found matching filters.
                      </td>
                    </tr>
                  ) : (
                    filteredBankEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50/80 transition">
                        <td className="p-3">
                          <span className="font-semibold text-gray-900 block">{entry.component}</span>
                          <span className="text-[11px] text-gray-500">{entry.area} {entry.subComponent ? `(${entry.subComponent})` : ''}</span>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {entry.inspectionTypes?.map((t) => (
                              <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-700">
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="inline-block rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 capitalize">
                            {entry.condition.replaceAll('_', ' ')}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-[11px] text-gray-700 max-w-md truncate">
                          {entry.text}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => {
                              setEditingEntry(entry);
                              setEntryArea(entry.area);
                              setEntryComponent(entry.component);
                              setEntrySubComponent(entry.subComponent || '');
                              setEntryCondition(entry.condition as string);
                              setEntryInspectionTypes(entry.inspectionTypes as string[]);
                              setEntryText(entry.text);
                              setShowAddEntryModal(true);
                            }}
                            className="text-emerald-700 hover:text-emerald-900 font-medium mr-2"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PREVIEW & TEST BENCH */}
      {activeTab === 'preview' && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Form */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="font-bold text-gray-950 flex items-center gap-2">
              <Play className="h-4 w-4 text-emerald-600" /> Interactive Rule Engine Test Bench
            </h2>
            <p className="text-xs text-gray-500">
              Test structured inspection facts against the active template ({activeTemplate?.id} v{activeTemplate?.version}) to preview generated commentary.
            </p>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-gray-700">Area</label>
                <select
                  value={previewFact.area}
                  onChange={(e) => setPreviewFact({ ...previewFact, area: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 focus:border-emerald-500 focus:outline-none"
                >
                  {PCR_STANDARD_AREAS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-gray-700">Component</label>
                <input
                  type="text"
                  value={previewFact.component}
                  onChange={(e) => setPreviewFact({ ...previewFact, component: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-gray-700">Material</label>
                <input
                  type="text"
                  value={previewFact.material || ''}
                  onChange={(e) => setPreviewFact({ ...previewFact, material: e.target.value })}
                  placeholder="e.g. timber, glass"
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-gray-700">Colour / Finish</label>
                <input
                  type="text"
                  value={previewFact.colour || ''}
                  onChange={(e) => setPreviewFact({ ...previewFact, colour: e.target.value })}
                  placeholder="e.g. white, silver"
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-gray-700">Type / Style</label>
                <input
                  type="text"
                  value={previewFact.type || ''}
                  onChange={(e) => setPreviewFact({ ...previewFact, type: e.target.value })}
                  placeholder="e.g. hinged door with lever handle"
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-gray-700">Visibility</label>
                <select
                  value={previewFact.visibility}
                  onChange={(e) => setPreviewFact({ ...previewFact, visibility: e.target.value as any })}
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="visible">Visible</option>
                  <option value="partially_visible">Partially Visible</option>
                  <option value="not_visible">Not Visible</option>
                  <option value="not_applicable">Not Applicable</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-gray-700">Condition</label>
                <select
                  value={previewFact.condition}
                  onChange={(e) => setPreviewFact({ ...previewFact, condition: e.target.value as any })}
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="clean_intact">Clean & Intact</option>
                  <option value="minor_wear">Minor Wear</option>
                  <option value="requires_cleaning">Requires Cleaning</option>
                  <option value="repair_required">Repair Required</option>
                  <option value="damaged">Damaged</option>
                  <option value="unable_to_confirm">Unable to Confirm</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-gray-700">Working State</label>
                <select
                  value={previewFact.workingState}
                  onChange={(e) => setPreviewFact({ ...previewFact, workingState: e.target.value as any })}
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="not_relevant">Not Relevant (Static Item)</option>
                  <option value="tested_working">Tested & Working</option>
                  <option value="tested_not_working">Tested & Not Working</option>
                  <option value="not_tested">Not Tested</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block font-medium text-gray-700">Condition Issue Text</label>
                <input
                  type="text"
                  value={previewFact.conditionIssue || ''}
                  onChange={(e) => setPreviewFact({ ...previewFact, conditionIssue: e.target.value })}
                  placeholder="e.g. minor scuff marks near handle"
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="col-span-2">
                <label className="block font-medium text-gray-700">Cleanliness Issue Text</label>
                <input
                  type="text"
                  value={previewFact.cleanlinessIssue || ''}
                  onChange={(e) => setPreviewFact({ ...previewFact, cleanlinessIssue: e.target.value })}
                  placeholder="e.g. soap residue to lower glass and frame"
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Generated Output */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="font-bold text-gray-950 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-600" /> Generated Commentary Output
            </h2>

            {previewOutput && 'error' in previewOutput ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                <div>
                  <p className="font-semibold">Generation Rejected by Rule Engine Safeguards:</p>
                  <p className="mt-0.5">{previewOutput.error}</p>
                </div>
              </div>
            ) : previewOutput ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                  <span className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wide">
                    Final Commentary Output
                  </span>
                  <p className="mt-2 text-sm font-medium text-gray-950 leading-relaxed font-serif">
                    "{previewOutput.commentary}"
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs border-t border-gray-100 pt-3">
                  <div>
                    <span className="text-gray-500">Method:</span>
                    <span className="ml-1 font-semibold uppercase text-emerald-700">
                      {previewOutput.generationMethod}
                    </span>
                  </div>

                  <div>
                    <span className="text-gray-500">Matched Bank Rule:</span>
                    <span className="ml-1 font-mono text-gray-800">
                      {previewOutput.bankEntryId || 'None (Fallback Engine)'}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* CSV IMPORT MODAL */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-gray-950 text-lg">Import Commentary Bank CSV</h3>
              <button onClick={() => setShowImportModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-gray-600">
              Paste CSV rows using format: <code className="bg-gray-100 p-1 rounded">Area, Component, Condition, InspectionTypes, CommentaryText</code>
            </p>

            <textarea
              rows={6}
              placeholder={`Entry, Front Door, minor_wear, entry, Front Door - {{details}}, otherwise intact.
Bathroom, Shower Screen, requires_cleaning, entry, Shower Screen - {{details}}, otherwise intact.`}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full rounded-lg border border-gray-300 p-3 text-xs font-mono focus:border-emerald-500 focus:outline-none"
            />

            <div className="flex justify-between items-center">
              <button
                onClick={handleParseCsv}
                className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800"
              >
                Validate CSV Format
              </button>
            </div>

            {importResult && (
              <div className="rounded-lg border p-4 bg-gray-50 text-xs space-y-2">
                <div className="flex gap-4 font-semibold text-gray-900">
                  <span>Total Rows: {importResult.totalRows}</span>
                  <span className="text-emerald-700">Valid Rows: {importResult.validRows}</span>
                  <span className="text-amber-700">Duplicates: {importResult.duplicateRows}</span>
                </div>

                {importResult.issues.length > 0 && (
                  <div className="max-h-32 overflow-y-auto space-y-1 text-rose-700 border-t pt-2">
                    {importResult.issues.map((iss, i) => (
                      <p key={i}>Row {iss.row}: [{iss.code}] {iss.message}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t pt-4">
              <button
                onClick={() => setShowImportModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                disabled={!importResult || importResult.validRows === 0}
                onClick={handleCommitImport}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Commit Import ({importResult?.validRows || 0} Entries)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD/EDIT ENTRY MODAL */}
      {showAddEntryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-gray-950 text-lg">
                {editingEntry ? 'Edit Commentary Rule' : 'New Commentary Rule'}
              </h3>
              <button onClick={() => setShowAddEntryModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {entryError && (
              <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200">
                {entryError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-gray-700">Area</label>
                <select
                  value={entryArea}
                  onChange={(e) => setEntryArea(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 p-2"
                >
                  {PCR_STANDARD_AREAS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-gray-700">Component</label>
                <input
                  type="text"
                  value={entryComponent}
                  onChange={(e) => setEntryComponent(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 p-2"
                />
              </div>

              <div className="col-span-2">
                <label className="block font-medium text-gray-700">Condition</label>
                <select
                  value={entryCondition}
                  onChange={(e) => setEntryCondition(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 p-2"
                >
                  <option value="clean_intact">Clean & Intact</option>
                  <option value="minor_wear">Minor Wear</option>
                  <option value="requires_cleaning">Requires Cleaning</option>
                  <option value="repair_required">Repair Required</option>
                  <option value="damaged">Damaged</option>
                  <option value="unable_to_confirm">Unable to Confirm</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block font-medium text-gray-700">Commentary Pattern Text</label>
                <input
                  type="text"
                  value={entryText}
                  onChange={(e) => setEntryText(e.target.value)}
                  placeholder="e.g. Front Door - {{details}}, otherwise intact."
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 font-mono"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Supported placeholders: <code className="bg-gray-100 px-1 font-mono">{"{{details}}"}</code>, <code className="bg-gray-100 px-1 font-mono">{"{{component}}"}</code>, <code className="bg-gray-100 px-1 font-mono">{"{{material}}"}</code>
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <button
                onClick={() => setShowAddEntryModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBankEntry}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Save Commentary Rule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW DRAFT TEMPLATE MODAL */}
      {showNewDraftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-gray-950 text-lg">Create New Template Draft</h3>
              <button onClick={() => setShowNewDraftModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-gray-700">Template ID / Name</label>
                <input
                  type="text"
                  placeholder="e.g. wa-entry-pcr-custom"
                  value={newTemplateId}
                  onChange={(e) => setNewTemplateId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 p-2"
                />
              </div>

              <div>
                <label className="block font-medium text-gray-700">Inspection Type</label>
                <select
                  value={newTemplateType}
                  onChange={(e) => setNewTemplateType(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 p-2"
                >
                  <option value="entry">Entry PCR</option>
                  <option value="routine">Routine Inspection</option>
                  <option value="exit">Exit PCR</option>
                  <option value="comparison">Comparison</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <button
                onClick={() => setShowNewDraftModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNewDraft}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Create Template Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TemplatesPage;
