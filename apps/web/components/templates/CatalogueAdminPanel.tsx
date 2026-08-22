import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Box,
  CheckCircle2,
  Copy,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { InspectionType, PhysicalPropertyType, PropertyUse } from '@pcr/domain';
import {
  createAreaComponentAssignment,
  normaliseAreaComponentRuleOrder,
  type CatalogueAreaVersionView,
  type CatalogueAssessmentDefaults,
  type CatalogueComponentVersionView,
  type CatalogueEvidenceDefaults,
  type CatalogueFieldRequirement,
  type CatalogueOperationalTestRequirement,
  type CatalogueCommentaryRequirement,
  type CatalogueUsageImpact,
  type ManagedAreaComponentRule,
} from '@pcr/templates/catalogueAdmin';
import type {
  AreaCategory,
  AreaComponentInclusion,
  ComponentCategory,
} from '@pcr/templates/canonicalCatalogue';
import {
  createCatalogueAreaDraft,
  createCatalogueComponentDraft,
  duplicateCatalogueArea,
  duplicateCatalogueComponent,
  getCatalogueAreas,
  getCatalogueAreaUsage,
  getCatalogueComponents,
  getCatalogueComponentUsage,
  publishCatalogueArea,
  publishCatalogueComponent,
  retireCatalogueArea,
  retireCatalogueComponent,
  updateCatalogueAreaDraft,
  updateCatalogueComponentDraft,
} from '../../services/catalogueStorage';

type CatalogueMode = 'areas' | 'components';

const AREA_CATEGORIES: AreaCategory[] = [
  'external',
  'circulation',
  'living',
  'sleeping',
  'wet_area',
  'kitchen',
  'service',
  'storage',
  'safety',
  'commercial',
  'industrial',
  'common_property',
  'other',
];

const COMPONENT_CATEGORIES: ComponentCategory[] = [
  'building_fabric',
  'door_access',
  'electrical',
  'plumbing',
  'appliance',
  'joinery',
  'flooring',
  'windows_glazing',
  'hvac',
  'safety_security',
  'external_site',
  'storage',
  'observation',
  'other',
];

const PROPERTY_USES: PropertyUse[] = [
  'residential',
  'commercial',
  'industrial',
  'retail',
  'mixed_use',
  'strata_common_property',
  'other',
];

const PHYSICAL_PROPERTY_TYPES: PhysicalPropertyType[] = [
  'house',
  'apartment',
  'unit',
  'townhouse',
  'villa',
  'duplex',
  'studio',
  'ancillary_dwelling',
  'retirement_supported',
  'office',
  'retail_shop',
  'warehouse',
  'industrial_unit',
  'showroom',
  'medical_consulting',
  'hospitality',
  'restaurant_cafe',
  'childcare',
  'mixed_commercial',
  'common_property',
  'other',
];

const INSPECTION_TYPES: InspectionType[] = [
  'entry',
  'routine',
  'exit',
  'comparison',
  'maintenance',
];

const FIELD_REQUIREMENTS: CatalogueFieldRequirement[] = ['required', 'optional', 'hidden'];
const TEST_REQUIREMENTS: CatalogueOperationalTestRequirement[] = [
  'required',
  'recommended',
  'optional',
  'not_applicable',
];
const COMMENTARY_REQUIREMENTS: CatalogueCommentaryRequirement[] = [
  'always',
  'exception_only',
  'optional',
  'hidden',
];
const INCLUSIONS: AreaComponentInclusion[] = ['required', 'default', 'optional', 'conditional'];

function title(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function selectedValues<T extends string>(event: React.ChangeEvent<HTMLSelectElement>): T[] {
  return Array.from(event.target.selectedOptions, (option) => option.value as T);
}

function statusClass(status: string): string {
  if (status === 'published') return 'bg-emerald-100 text-emerald-800';
  if (status === 'draft') return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

function latestPublishedComponents(
  components: CatalogueComponentVersionView[],
): CatalogueComponentVersionView[] {
  const byId = new Map<string, CatalogueComponentVersionView>();
  for (const component of components) {
    if (component.definition.status !== 'published') continue;
    const current = byId.get(component.definition.id);
    if (!current || component.definition.version > current.definition.version) {
      byId.set(component.definition.id, component);
    }
  }
  return [...byId.values()].sort((left, right) => left.definition.name.localeCompare(right.definition.name));
}

function UsageImpactCard({ impact, loading }: { impact: CatalogueUsageImpact | null; loading: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-950">Usage impact</h4>
          <p className="text-[11px] text-gray-500">Direct canonical references found across authoritative records.</p>
        </div>
        {loading && <RefreshCw className="h-4 w-4 animate-spin text-gray-400" />}
      </div>
      {impact ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-lg bg-white p-2"><span className="block font-semibold text-gray-950">{impact.catalogueAreas}</span><span className="text-gray-500">Catalogue Areas</span></div>
          <div className="rounded-lg bg-white p-2"><span className="block font-semibold text-gray-950">{impact.templates}</span><span className="text-gray-500">Templates</span></div>
          <div className="rounded-lg bg-white p-2"><span className="block font-semibold text-gray-950">{impact.properties}</span><span className="text-gray-500">Properties</span></div>
          <div className="rounded-lg bg-white p-2"><span className="block font-semibold text-gray-950">{impact.reports}</span><span className="text-gray-500">Reports</span></div>
          <div className="rounded-lg bg-white p-2"><span className="block font-semibold text-gray-950">{impact.maintenanceItems}</span><span className="text-gray-500">Maintenance</span></div>
          <div className="rounded-lg bg-white p-2"><span className="block font-semibold text-gray-950">{impact.totalRecords}</span><span className="text-gray-500">Total direct refs</span></div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-500">Select a catalogue version to calculate impact.</p>
      )}
      {impact?.hasPublishedDependencies && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Published dependencies exist. Retirement requires explicit acknowledgement and never rewrites those historical versions.</span>
        </div>
      )}
    </div>
  );
}

function MultiSelectField<T extends string>({
  label,
  values,
  options,
  disabled,
  onChange,
}: {
  label: string;
  values: T[];
  options: readonly T[];
  disabled: boolean;
  onChange: (value: T[]) => void;
}) {
  return (
    <label className="text-xs font-medium text-gray-700">
      {label}
      <select
        multiple
        disabled={disabled}
        value={values}
        onChange={(event) => onChange(selectedValues<T>(event))}
        className="mt-1 h-28 w-full rounded-lg border border-gray-300 bg-white p-2 text-xs disabled:bg-gray-50"
      >
        {options.map((option) => <option key={option} value={option}>{title(option)}</option>)}
      </select>
    </label>
  );
}

function AssessmentEditor({
  value,
  disabled,
  onChange,
}: {
  value: CatalogueAssessmentDefaults;
  disabled: boolean;
  onChange: (value: CatalogueAssessmentDefaults) => void;
}) {
  const field = (
    key: keyof Pick<CatalogueAssessmentDefaults, 'condition' | 'cleanliness' | 'material' | 'colour' | 'type' | 'quantity' | 'workingStatus'>,
    label: string,
  ) => (
    <label className="text-[11px] text-gray-600">
      {label}
      <select
        disabled={disabled}
        value={value[key] as CatalogueFieldRequirement}
        onChange={(event) => onChange({ ...value, [key]: event.target.value as CatalogueFieldRequirement })}
        className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs disabled:bg-gray-50"
      >
        {FIELD_REQUIREMENTS.map((option) => <option key={option} value={option}>{title(option)}</option>)}
      </select>
    </label>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {field('condition', 'Condition')}
      {field('cleanliness', 'Cleanliness')}
      {field('material', 'Material')}
      {field('colour', 'Colour / Finish')}
      {field('type', 'Type')}
      {field('quantity', 'Quantity')}
      {field('workingStatus', 'Working Status')}
      <label className="text-[11px] text-gray-600">
        Operational Test
        <select
          disabled={disabled}
          value={value.operationalTest}
          onChange={(event) => onChange({ ...value, operationalTest: event.target.value as CatalogueOperationalTestRequirement })}
          className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs disabled:bg-gray-50"
        >
          {TEST_REQUIREMENTS.map((option) => <option key={option} value={option}>{title(option)}</option>)}
        </select>
      </label>
      <label className="text-[11px] text-gray-600">
        Commentary
        <select
          disabled={disabled}
          value={value.commentary}
          onChange={(event) => onChange({ ...value, commentary: event.target.value as CatalogueCommentaryRequirement })}
          className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs disabled:bg-gray-50"
        >
          {COMMENTARY_REQUIREMENTS.map((option) => <option key={option} value={option}>{title(option)}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 self-end rounded border border-gray-200 bg-white px-2 py-2 text-[11px] text-gray-700">
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.maintenanceEvaluation}
          onChange={(event) => onChange({ ...value, maintenanceEvaluation: event.target.checked })}
        />
        Evaluate for maintenance
      </label>
    </div>
  );
}

function EvidenceEditor({
  value,
  disabled,
  onChange,
}: {
  value: CatalogueEvidenceDefaults;
  disabled: boolean;
  onChange: (value: CatalogueEvidenceDefaults) => void;
}) {
  const checkbox = (key: keyof Pick<CatalogueEvidenceDefaults, 'componentPhotoRequired' | 'exceptionPhotoRequired' | 'contextPhotoRequired' | 'comparisonPairRequired' | 'reasonRequiredIfMissing'>, label: string) => (
    <label className="flex items-center gap-2 text-[11px] text-gray-700">
      <input
        type="checkbox"
        disabled={disabled}
        checked={Boolean(value[key])}
        onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
      />
      {label}
    </label>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {checkbox('componentPhotoRequired', 'Component photo required')}
      {checkbox('exceptionPhotoRequired', 'Exception photo required')}
      {checkbox('contextPhotoRequired', 'Context photo required')}
      {checkbox('comparisonPairRequired', 'Comparison pair required')}
      {checkbox('reasonRequiredIfMissing', 'Reason required when missing')}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-gray-600">Min photos
          <input
            type="number"
            min={0}
            disabled={disabled}
            value={value.minimumPhotos}
            onChange={(event) => onChange({ ...value, minimumPhotos: Math.max(0, Number(event.target.value) || 0) })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs disabled:bg-gray-50"
          />
        </label>
        <label className="text-[11px] text-gray-600">Min exception
          <input
            type="number"
            min={0}
            disabled={disabled}
            value={value.minimumExceptionPhotos}
            onChange={(event) => onChange({ ...value, minimumExceptionPhotos: Math.max(0, Number(event.target.value) || 0) })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs disabled:bg-gray-50"
          />
        </label>
      </div>
    </div>
  );
}

const CatalogueAdminPanel: React.FC = () => {
  const [mode, setMode] = useState<CatalogueMode>('areas');
  const [areas, setAreas] = useState<CatalogueAreaVersionView[]>([]);
  const [components, setComponents] = useState<CatalogueComponentVersionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedAreaKey, setSelectedAreaKey] = useState('');
  const [selectedComponentKey, setSelectedComponentKey] = useState('');
  const [areaDraft, setAreaDraft] = useState<CatalogueAreaVersionView | null>(null);
  const [componentDraft, setComponentDraft] = useState<CatalogueComponentVersionView | null>(null);
  const [usage, setUsage] = useState<CatalogueUsageImpact | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [componentToAssign, setComponentToAssign] = useState('');
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<string>('other');

  const load = async (preferred?: { mode: CatalogueMode; id: string; version: number }) => {
    setLoading(true);
    setError('');
    try {
      const [areaList, componentList] = await Promise.all([
        getCatalogueAreas(),
        getCatalogueComponents(),
      ]);
      setAreas(areaList);
      setComponents(componentList);
      const areaKey = preferred?.mode === 'areas'
        ? `${preferred.id}@${preferred.version}`
        : selectedAreaKey || (areaList[0] ? `${areaList[0].definition.id}@${areaList[0].definition.version}` : '');
      const componentKey = preferred?.mode === 'components'
        ? `${preferred.id}@${preferred.version}`
        : selectedComponentKey || (componentList[0] ? `${componentList[0].definition.id}@${componentList[0].definition.version}` : '');
      setSelectedAreaKey(areaKey);
      setSelectedComponentKey(componentKey);
      if (preferred) setMode(preferred.mode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load catalogue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedArea = useMemo(
    () => areas.find((area) => `${area.definition.id}@${area.definition.version}` === selectedAreaKey) ?? null,
    [areas, selectedAreaKey],
  );
  const selectedComponent = useMemo(
    () => components.find((component) => `${component.definition.id}@${component.definition.version}` === selectedComponentKey) ?? null,
    [components, selectedComponentKey],
  );

  useEffect(() => {
    setAreaDraft(selectedArea ? structuredClone(selectedArea) : null);
    setExpandedRule(null);
  }, [selectedAreaKey, selectedArea?.recordVersion]);

  useEffect(() => {
    setComponentDraft(selectedComponent ? structuredClone(selectedComponent) : null);
  }, [selectedComponentKey, selectedComponent?.recordVersion]);

  useEffect(() => {
    const active = mode === 'areas' ? selectedArea : selectedComponent;
    if (!active) {
      setUsage(null);
      return;
    }
    setUsageLoading(true);
    const promise = mode === 'areas'
      ? getCatalogueAreaUsage(active as CatalogueAreaVersionView)
      : getCatalogueComponentUsage(active as CatalogueComponentVersionView);
    void promise
      .then(setUsage)
      .catch(() => setUsage(null))
      .finally(() => setUsageLoading(false));
  }, [mode, selectedAreaKey, selectedComponentKey, selectedArea?.recordVersion, selectedComponent?.recordVersion]);

  const filteredAreas = useMemo(() => areas.filter((area) => {
    const definition = area.definition;
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || [definition.id, definition.code, definition.name, ...definition.aliases].some((value) => value.toLowerCase().includes(q));
    const matchesStatus = statusFilter === 'all' || definition.status === statusFilter;
    const matchesCategory = categoryFilter === 'all' || definition.category === categoryFilter;
    return matchesSearch && matchesStatus && matchesCategory;
  }), [areas, search, statusFilter, categoryFilter]);

  const filteredComponents = useMemo(() => components.filter((component) => {
    const definition = component.definition;
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || [definition.id, definition.code, definition.name, ...definition.aliases].some((value) => value.toLowerCase().includes(q));
    const matchesStatus = statusFilter === 'all' || definition.status === statusFilter;
    const matchesCategory = categoryFilter === 'all' || definition.category === categoryFilter;
    return matchesSearch && matchesStatus && matchesCategory;
  }), [components, search, statusFilter, categoryFilter]);

  const publishedComponents = useMemo(() => latestPublishedComponents(components), [components]);
  const assignableComponents = useMemo(() => {
    const assigned = new Set(areaDraft?.componentRules.map((rule) => rule.componentDefinitionId) ?? []);
    return publishedComponents.filter((component) => !assigned.has(component.definition.id));
  }, [areaDraft, publishedComponents]);

  const areaDirty = Boolean(selectedArea && areaDraft && JSON.stringify({ definition: selectedArea.definition, componentRules: selectedArea.componentRules }) !== JSON.stringify({ definition: areaDraft.definition, componentRules: areaDraft.componentRules }));
  const componentDirty = Boolean(selectedComponent && componentDraft && JSON.stringify(selectedComponent.definition) !== JSON.stringify(componentDraft.definition));

  const saveArea = async (): Promise<CatalogueAreaVersionView | null> => {
    if (!selectedArea || !areaDraft || selectedArea.definition.status !== 'draft') return selectedArea;
    setSaving(true);
    setError('');
    try {
      const updated = await updateCatalogueAreaDraft(selectedArea, areaDraft.definition, normaliseAreaComponentRuleOrder(areaDraft.componentRules));
      await load({ mode: 'areas', id: updated.definition.id, version: updated.definition.version });
      return updated;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save Area draft.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveComponent = async (): Promise<CatalogueComponentVersionView | null> => {
    if (!selectedComponent || !componentDraft || selectedComponent.definition.status !== 'draft') return selectedComponent;
    setSaving(true);
    setError('');
    try {
      const updated = await updateCatalogueComponentDraft(selectedComponent, componentDraft.definition);
      await load({ mode: 'components', id: updated.definition.id, version: updated.definition.version });
      return updated;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save Component draft.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const runAreaAction = async (action: 'duplicate' | 'publish' | 'retire') => {
    if (!selectedArea) return;
    setSaving(true);
    setError('');
    try {
      let target = selectedArea;
      if (action === 'publish' && areaDirty) {
        const saved = await saveArea();
        if (!saved) return;
        target = saved;
      }
      let result: CatalogueAreaVersionView;
      if (action === 'duplicate') result = await duplicateCatalogueArea(target);
      else if (action === 'publish') result = await publishCatalogueArea(target);
      else {
        const impact = await getCatalogueAreaUsage(target);
        const confirmed = window.confirm(
          `Retire ${target.definition.name} v${target.definition.version}?\n\nDirect references: ${impact.totalRecords}\nTemplates: ${impact.templates}\nProperties: ${impact.properties}\nReports: ${impact.reports}\nMaintenance: ${impact.maintenanceItems}\n\nHistorical records will remain unchanged.`,
        );
        if (!confirmed) return;
        result = await retireCatalogueArea(target, impact.totalRecords > 0);
      }
      await load({ mode: 'areas', id: result.definition.id, version: result.definition.version });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Failed to ${action} Area.`);
    } finally {
      setSaving(false);
    }
  };

  const runComponentAction = async (action: 'duplicate' | 'publish' | 'retire') => {
    if (!selectedComponent) return;
    setSaving(true);
    setError('');
    try {
      let target = selectedComponent;
      if (action === 'publish' && componentDirty) {
        const saved = await saveComponent();
        if (!saved) return;
        target = saved;
      }
      let result: CatalogueComponentVersionView;
      if (action === 'duplicate') result = await duplicateCatalogueComponent(target);
      else if (action === 'publish') result = await publishCatalogueComponent(target);
      else {
        const impact = await getCatalogueComponentUsage(target);
        const confirmed = window.confirm(
          `Retire ${target.definition.name} v${target.definition.version}?\n\nCatalogue Areas: ${impact.catalogueAreas}\nTemplates: ${impact.templates}\nProperties: ${impact.properties}\nReports: ${impact.reports}\nMaintenance: ${impact.maintenanceItems}\n\nExisting version-bound references remain historical snapshots.`,
        );
        if (!confirmed) return;
        result = await retireCatalogueComponent(target, impact.totalRecords > 0);
      }
      await load({ mode: 'components', id: result.definition.id, version: result.definition.version });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Failed to ${action} Component.`);
    } finally {
      setSaving(false);
    }
  };

  const createDraft = async () => {
    if (!newId.trim() || !newName.trim()) {
      setError('ID and name are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (mode === 'areas') {
        const created = await createCatalogueAreaDraft({
          id: newId,
          name: newName,
          category: newCategory as AreaCategory,
        });
        await load({ mode: 'areas', id: created.definition.id, version: created.definition.version });
      } else {
        const created = await createCatalogueComponentDraft({
          id: newId,
          name: newName,
          category: newCategory as ComponentCategory,
        });
        await load({ mode: 'components', id: created.definition.id, version: created.definition.version });
      }
      setShowCreate(false);
      setNewId('');
      setNewName('');
      setNewCategory('other');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to create catalogue draft.');
    } finally {
      setSaving(false);
    }
  };

  const updateAreaDefinition = (patch: Partial<CatalogueAreaVersionView['definition']>) => {
    if (!areaDraft) return;
    setAreaDraft({ ...areaDraft, definition: { ...areaDraft.definition, ...patch } });
  };

  const updateComponentDefinition = (patch: Partial<CatalogueComponentVersionView['definition']>) => {
    if (!componentDraft) return;
    setComponentDraft({ ...componentDraft, definition: { ...componentDraft.definition, ...patch } });
  };

  const updateRule = (index: number, patch: Partial<ManagedAreaComponentRule>) => {
    if (!areaDraft) return;
    const rules = [...areaDraft.componentRules];
    rules[index] = { ...rules[index], ...patch };
    setAreaDraft({ ...areaDraft, componentRules: rules });
  };

  const removeRule = (index: number) => {
    if (!areaDraft) return;
    const rules = areaDraft.componentRules.filter((_rule, ruleIndex) => ruleIndex !== index);
    setAreaDraft({ ...areaDraft, componentRules: normaliseAreaComponentRuleOrder(rules) });
  };

  const moveRule = (index: number, direction: -1 | 1) => {
    if (!areaDraft) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= areaDraft.componentRules.length) return;
    const rules = [...areaDraft.componentRules];
    const current = rules[index];
    rules[index] = rules[nextIndex];
    rules[nextIndex] = current;
    setAreaDraft({ ...areaDraft, componentRules: normaliseAreaComponentRuleOrder(rules.map((rule, order) => ({ ...rule, order: order + 1 }))) });
  };

  const assignComponent = () => {
    if (!areaDraft || !componentToAssign) return;
    const component = publishedComponents.find((candidate) => `${candidate.definition.id}@${candidate.definition.version}` === componentToAssign);
    if (!component) return;
    const rule = createAreaComponentAssignment(
      areaDraft.definition,
      component.definition,
      areaDraft.componentRules.length + 1,
    );
    rule.legacyAreaName = areaDraft.definition.name;
    rule.legacyComponentName = component.definition.name;
    setAreaDraft({ ...areaDraft, componentRules: [...areaDraft.componentRules, rule] });
    setComponentToAssign('');
    setExpandedRule(rule.id);
  };

  if (loading) {
    return <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Loading canonical catalogue...</div>;
  }

  const activeCategories = mode === 'areas' ? AREA_CATEGORIES : COMPONENT_CATEGORIES;
  const list = mode === 'areas' ? filteredAreas : filteredComponents;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span>{error}</span>
          <button onClick={() => setError('')}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm xl:flex-row xl:items-center">
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            onClick={() => { setMode('areas'); setCategoryFilter('all'); }}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${mode === 'areas' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-600'}`}
          ><Layers className="h-4 w-4" /> Areas</button>
          <button
            onClick={() => { setMode('components'); setCategoryFilter('all'); }}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${mode === 'components' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-600'}`}
          ><Box className="h-4 w-4" /> Components</button>
        </div>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${mode} by name, ID, code or alias...`}
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="retired">Retired</option>
        </select>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="all">All categories</option>
          {activeCategories.map((category) => <option key={category} value={category}>{title(category)}</option>)}
        </select>
        <button
          onClick={() => { setNewCategory('other'); setShowCreate(true); }}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        ><Plus className="h-4 w-4" /> New {mode === 'areas' ? 'Area' : 'Component'}</button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <div className="max-h-[78vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          <div className="flex items-center justify-between px-2 py-2 text-xs text-gray-500">
            <span>{list.length} matching versions</span>
            <button onClick={() => void load()} className="rounded p-1 hover:bg-gray-100" title="Refresh"><RefreshCw className="h-4 w-4" /></button>
          </div>
          <div className="space-y-1">
            {mode === 'areas'
              ? filteredAreas.map((area) => {
                  const key = `${area.definition.id}@${area.definition.version}`;
                  const selected = key === selectedAreaKey;
                  return (
                    <button key={key} onClick={() => setSelectedAreaKey(key)} className={`w-full rounded-lg border p-3 text-left ${selected ? 'border-emerald-500 bg-emerald-50' : 'border-transparent hover:border-gray-200 hover:bg-gray-50'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-950">{area.definition.name}</p><p className="truncate font-mono text-[10px] text-gray-500">{area.definition.code}</p></div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(area.definition.status)}`}>v{area.definition.version} {area.definition.status}</span>
                      </div>
                      <p className="mt-2 text-[11px] text-gray-500">{title(area.definition.category)} · {area.componentRules.length} components</p>
                    </button>
                  );
                })
              : filteredComponents.map((component) => {
                  const key = `${component.definition.id}@${component.definition.version}`;
                  const selected = key === selectedComponentKey;
                  return (
                    <button key={key} onClick={() => setSelectedComponentKey(key)} className={`w-full rounded-lg border p-3 text-left ${selected ? 'border-emerald-500 bg-emerald-50' : 'border-transparent hover:border-gray-200 hover:bg-gray-50'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-950">{component.definition.name}</p><p className="truncate font-mono text-[10px] text-gray-500">{component.definition.code}</p></div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(component.definition.status)}`}>v{component.definition.version} {component.definition.status}</span>
                      </div>
                      <p className="mt-2 text-[11px] text-gray-500">{title(component.definition.category)}{component.definition.operational ? ' · Operational' : ''}</p>
                    </button>
                  );
                })}
          </div>
        </div>

        {mode === 'areas' && areaDraft ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-gray-950">{areaDraft.definition.name}</h2><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(areaDraft.definition.status)}`}>v{areaDraft.definition.version} {areaDraft.definition.status}</span>{areaDraft.systemDefault && <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">System foundation</span>}</div>
                  <p className="mt-1 font-mono text-xs text-gray-500">{areaDraft.definition.code} · {areaDraft.definition.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {areaDraft.definition.status === 'draft' && <button disabled={saving || !areaDirty} onClick={() => void saveArea()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Save</button>}
                  <button disabled={saving} onClick={() => void runAreaAction('duplicate')} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700"><Copy className="h-3.5 w-3.5" /> Duplicate</button>
                  {areaDraft.definition.status === 'draft' && <button disabled={saving} onClick={() => void runAreaAction('publish')} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"><CheckCircle2 className="h-3.5 w-3.5" /> Publish</button>}
                  {areaDraft.definition.status === 'published' && <button disabled={saving} onClick={() => void runAreaAction('retire')} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700"><Archive className="h-3.5 w-3.5" /> Retire</button>}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-medium text-gray-700">Name<input disabled={areaDraft.definition.status !== 'draft'} value={areaDraft.definition.name} onChange={(event) => updateAreaDefinition({ name: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label>
                <label className="text-xs font-medium text-gray-700">Category<select disabled={areaDraft.definition.status !== 'draft'} value={areaDraft.definition.category} onChange={(event) => updateAreaDefinition({ category: event.target.value as AreaCategory })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50">{AREA_CATEGORIES.map((category) => <option key={category} value={category}>{title(category)}</option>)}</select></label>
                <label className="md:col-span-2 text-xs font-medium text-gray-700">Description<textarea disabled={areaDraft.definition.status !== 'draft'} rows={2} value={areaDraft.definition.description} onChange={(event) => updateAreaDefinition({ description: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label>
                <label className="md:col-span-2 text-xs font-medium text-gray-700">Aliases<input disabled={areaDraft.definition.status !== 'draft'} value={areaDraft.definition.aliases.join(', ')} onChange={(event) => updateAreaDefinition({ aliases: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label>
                <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" disabled={areaDraft.definition.status !== 'draft'} checked={areaDraft.definition.repeatable} onChange={(event) => updateAreaDefinition({ repeatable: event.target.checked })} /> Repeatable Area type</label>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <MultiSelectField label="Property Uses" values={areaDraft.definition.applicability.propertyUses} options={PROPERTY_USES} disabled={areaDraft.definition.status !== 'draft'} onChange={(propertyUses) => updateAreaDefinition({ applicability: { ...areaDraft.definition.applicability, propertyUses } })} />
                <MultiSelectField label="Physical Property Types" values={areaDraft.definition.applicability.physicalPropertyTypes} options={PHYSICAL_PROPERTY_TYPES} disabled={areaDraft.definition.status !== 'draft'} onChange={(physicalPropertyTypes) => updateAreaDefinition({ applicability: { ...areaDraft.definition.applicability, physicalPropertyTypes } })} />
                <MultiSelectField label="Inspection Types" values={areaDraft.definition.applicability.inspectionTypes} options={INSPECTION_TYPES} disabled={areaDraft.definition.status !== 'draft'} onChange={(inspectionTypes) => updateAreaDefinition({ applicability: { ...areaDraft.definition.applicability, inspectionTypes } })} />
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><h3 className="font-semibold text-gray-950">Assigned Components</h3><p className="text-xs text-gray-500">Order, inclusion, assessment defaults and evidence requirements are version-bound to this Area.</p></div>
                {areaDraft.definition.status === 'draft' && (
                  <div className="flex min-w-0 gap-2">
                    <select value={componentToAssign} onChange={(event) => setComponentToAssign(event.target.value)} className="min-w-0 rounded-lg border border-gray-300 px-2 py-2 text-xs"><option value="">Select published Component...</option>{assignableComponents.map((component) => <option key={`${component.definition.id}@${component.definition.version}`} value={`${component.definition.id}@${component.definition.version}`}>{component.definition.name} (v{component.definition.version})</option>)}</select>
                    <button disabled={!componentToAssign} onClick={assignComponent} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Assign</button>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2">
                {areaDraft.componentRules.length === 0 && <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No Components assigned yet.</div>}
                {areaDraft.componentRules.map((rule, index) => {
                  const component = components.find((candidate) => candidate.definition.id === rule.componentDefinitionId && candidate.definition.version === rule.componentDefinitionVersion);
                  const expanded = expandedRule === rule.id;
                  const editable = areaDraft.definition.status === 'draft';
                  return (
                    <div key={`${rule.componentDefinitionId}@${rule.componentDefinitionVersion}`} className="rounded-lg border border-gray-200">
                      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-2"><span className="w-6 text-center font-mono text-xs text-gray-400">{index + 1}</span><button onClick={() => setExpandedRule(expanded ? null : rule.id)} className="min-w-0 text-left"><p className="truncate text-sm font-semibold text-gray-900">{component?.definition.name || rule.legacyComponentName}</p><p className="font-mono text-[10px] text-gray-500">{rule.componentDefinitionId}@{rule.componentDefinitionVersion}</p></button></div>
                        <select disabled={!editable} value={rule.inclusion} onChange={(event) => updateRule(index, { inclusion: event.target.value as AreaComponentInclusion })} className="rounded border border-gray-300 px-2 py-1.5 text-xs disabled:bg-gray-50">{INCLUSIONS.map((option) => <option key={option} value={option}>{title(option)}</option>)}</select>
                        <div className="flex gap-1">
                          <button disabled={!editable || index === 0} onClick={() => moveRule(index, -1)} className="rounded border border-gray-200 p-1.5 disabled:opacity-30" title="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                          <button disabled={!editable || index === areaDraft.componentRules.length - 1} onClick={() => moveRule(index, 1)} className="rounded border border-gray-200 p-1.5 disabled:opacity-30" title="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                          <button disabled={!editable} onClick={() => removeRule(index)} className="rounded border border-rose-100 p-1.5 text-rose-600 disabled:opacity-30" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                      {expanded && (
                        <div className="space-y-4 border-t border-gray-100 bg-gray-50 p-4">
                          <div><p className="mb-2 text-xs font-semibold text-gray-800">Assessment defaults</p><AssessmentEditor value={rule.assessmentDefaults} disabled={!editable} onChange={(assessmentDefaults) => updateRule(index, { assessmentDefaults })} /></div>
                          <div><p className="mb-2 text-xs font-semibold text-gray-800">Evidence defaults</p><EvidenceEditor value={rule.evidenceDefaults} disabled={!editable} onChange={(evidenceDefaults) => updateRule(index, { evidenceDefaults, photoRequired: evidenceDefaults.componentPhotoRequired })} /></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <UsageImpactCard impact={usage} loading={usageLoading} />
          </div>
        ) : mode === 'components' && componentDraft ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-gray-950">{componentDraft.definition.name}</h2><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(componentDraft.definition.status)}`}>v{componentDraft.definition.version} {componentDraft.definition.status}</span>{componentDraft.systemDefault && <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">System foundation</span>}</div><p className="mt-1 font-mono text-xs text-gray-500">{componentDraft.definition.code} · {componentDraft.definition.id}</p></div>
                <div className="flex flex-wrap gap-2">
                  {componentDraft.definition.status === 'draft' && <button disabled={saving || !componentDirty} onClick={() => void saveComponent()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Save</button>}
                  <button disabled={saving} onClick={() => void runComponentAction('duplicate')} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700"><Copy className="h-3.5 w-3.5" /> Duplicate</button>
                  {componentDraft.definition.status === 'draft' && <button disabled={saving} onClick={() => void runComponentAction('publish')} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"><CheckCircle2 className="h-3.5 w-3.5" /> Publish</button>}
                  {componentDraft.definition.status === 'published' && <button disabled={saving} onClick={() => void runComponentAction('retire')} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700"><Archive className="h-3.5 w-3.5" /> Retire</button>}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-medium text-gray-700">Name<input disabled={componentDraft.definition.status !== 'draft'} value={componentDraft.definition.name} onChange={(event) => updateComponentDefinition({ name: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label>
                <label className="text-xs font-medium text-gray-700">Category<select disabled={componentDraft.definition.status !== 'draft'} value={componentDraft.definition.category} onChange={(event) => updateComponentDefinition({ category: event.target.value as ComponentCategory })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50">{COMPONENT_CATEGORIES.map((category) => <option key={category} value={category}>{title(category)}</option>)}</select></label>
                <label className="md:col-span-2 text-xs font-medium text-gray-700">Description<textarea disabled={componentDraft.definition.status !== 'draft'} rows={2} value={componentDraft.definition.description} onChange={(event) => updateComponentDefinition({ description: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label>
                <label className="md:col-span-2 text-xs font-medium text-gray-700">Aliases<input disabled={componentDraft.definition.status !== 'draft'} value={componentDraft.definition.aliases.join(', ')} onChange={(event) => updateComponentDefinition({ aliases: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label>
                <label className="text-xs font-medium text-gray-700">Maintenance Category<input disabled={componentDraft.definition.status !== 'draft'} value={componentDraft.definition.maintenanceCategory || ''} onChange={(event) => updateComponentDefinition({ maintenanceCategory: event.target.value || undefined })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label>
                <label className="text-xs font-medium text-gray-700">Default Trade<input disabled={componentDraft.definition.status !== 'draft'} value={componentDraft.definition.defaultTrade || ''} onChange={(event) => updateComponentDefinition({ defaultTrade: event.target.value || undefined })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50" /></label>
                <div className="md:col-span-2 flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                  <label className="flex items-center gap-2"><input type="checkbox" disabled={componentDraft.definition.status !== 'draft'} checked={componentDraft.definition.operational} onChange={(event) => updateComponentDefinition({ operational: event.target.checked, ...(!event.target.checked ? { testable: false } : {}) })} /> Operational</label>
                  <label className="flex items-center gap-2"><input type="checkbox" disabled={componentDraft.definition.status !== 'draft' || !componentDraft.definition.operational} checked={componentDraft.definition.testable} onChange={(event) => updateComponentDefinition({ testable: event.target.checked })} /> Testable</label>
                  <label className="flex items-center gap-2"><input type="checkbox" disabled={componentDraft.definition.status !== 'draft'} checked={componentDraft.definition.repeatable} onChange={(event) => updateComponentDefinition({ repeatable: event.target.checked })} /> Repeatable</label>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <MultiSelectField label="Property Uses" values={componentDraft.definition.applicability.propertyUses} options={PROPERTY_USES} disabled={componentDraft.definition.status !== 'draft'} onChange={(propertyUses) => updateComponentDefinition({ applicability: { ...componentDraft.definition.applicability, propertyUses } })} />
                <MultiSelectField label="Physical Property Types" values={componentDraft.definition.applicability.physicalPropertyTypes} options={PHYSICAL_PROPERTY_TYPES} disabled={componentDraft.definition.status !== 'draft'} onChange={(physicalPropertyTypes) => updateComponentDefinition({ applicability: { ...componentDraft.definition.applicability, physicalPropertyTypes } })} />
                <MultiSelectField label="Inspection Types" values={componentDraft.definition.applicability.inspectionTypes} options={INSPECTION_TYPES} disabled={componentDraft.definition.status !== 'draft'} onChange={(inspectionTypes) => updateComponentDefinition({ applicability: { ...componentDraft.definition.applicability, inspectionTypes } })} />
              </div>
            </div>
            <UsageImpactCard impact={usage} loading={usageLoading} />
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Select a catalogue version to manage it.</div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3"><div><h3 className="font-bold text-gray-950">New {mode === 'areas' ? 'Area' : 'Component'} Draft</h3><p className="text-xs text-gray-500">The stable ID cannot be reused once created.</p></div><button onClick={() => setShowCreate(false)} className="text-gray-400"><X className="h-5 w-5" /></button></div>
            <label className="block text-xs font-medium text-gray-700">Stable ID<input value={newId} onChange={(event) => setNewId(event.target.value)} placeholder={mode === 'areas' ? 'e.g. pool-area' : 'e.g. pool-pump'} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
            <label className="block text-xs font-medium text-gray-700">Name<input value={newName} onChange={(event) => setNewName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
            <label className="block text-xs font-medium text-gray-700">Category<select value={newCategory} onChange={(event) => setNewCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">{activeCategories.map((category) => <option key={category} value={category}>{title(category)}</option>)}</select></label>
            <div className="flex justify-end gap-2 border-t border-gray-100 pt-4"><button onClick={() => setShowCreate(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700">Cancel</button><button disabled={saving} onClick={() => void createDraft()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Create Draft</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CatalogueAdminPanel;
