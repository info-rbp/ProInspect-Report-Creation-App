import type { MaintenanceItem } from './maintenance.js';
import type {
  EstimateContext,
  MaintenanceIssueType,
  PriceBookEntry,
  PriceBookMatch,
} from './maintenanceCommercial.js';
import { inferMaintenanceIssueType, matchPriceBookEntries } from './maintenanceCommercial.js';

function applies(entry: PriceBookEntry, context: EstimateContext): boolean {
  if (!entry.active) return false;
  const now = Date.now();
  if (entry.effectiveFrom && Date.parse(entry.effectiveFrom) > now) return false;
  if (entry.effectiveTo && Date.parse(entry.effectiveTo) < now) return false;
  if (entry.propertyUses.length && context.propertyUse && !entry.propertyUses.includes(context.propertyUse)) return false;
  if (entry.physicalPropertyTypes.length && context.physicalPropertyType && !entry.physicalPropertyTypes.includes(context.physicalPropertyType)) return false;
  if (entry.regions.length && context.region && !entry.regions.includes(context.region)) return false;
  if (entry.postcodes.length && context.postcode && !entry.postcodes.includes(context.postcode)) return false;
  return true;
}

function canonicalConstraintMatch(values: string[] | undefined, candidate: string | undefined): 'none' | 'match' | 'conflict' {
  if (!values?.length) return 'none';
  if (!candidate) return 'conflict';
  return values.includes(candidate) ? 'match' : 'conflict';
}

export type CanonicalPricingItem = Pick<
  MaintenanceItem,
  | 'title'
  | 'description'
  | 'category'
  | 'priority'
  | 'sourceComponentId'
  | 'sourceCanonicalAreaDefinitionId'
  | 'sourceCanonicalComponentDefinitionId'
> & {
  issueType?: MaintenanceIssueType;
  recommendedAction?: string;
};

/**
 * Canonical bindings are decisive constraints. If a price rule declares an Area/Component identity,
 * a different identity cannot text-score its way into contention. Unbound legacy price rules retain
 * the previous deterministic text/category matcher for backwards compatibility.
 */
export function matchCanonicalPriceBookEntries(
  item: CanonicalPricingItem,
  entries: PriceBookEntry[],
  context: EstimateContext = {},
): PriceBookMatch[] {
  const legacyMatches = new Map(
    matchPriceBookEntries(item, entries, context).map((match) => [match.entry.id, match]),
  );
  const issueType = item.issueType || inferMaintenanceIssueType(item);

  return entries
    .filter((entry) => applies(entry, context))
    .flatMap((entry): PriceBookMatch[] => {
      const areaMatch = canonicalConstraintMatch(entry.canonicalAreaDefinitionIds, item.sourceCanonicalAreaDefinitionId);
      const componentMatch = canonicalConstraintMatch(entry.canonicalComponentDefinitionIds, item.sourceCanonicalComponentDefinitionId);
      if (areaMatch === 'conflict' || componentMatch === 'conflict') return [];

      const legacy = legacyMatches.get(entry.id);
      let score = legacy?.score ?? 0;
      const reasons = [...(legacy?.reasons ?? [])];
      const conflicts = [...(legacy?.conflicts ?? [])];

      if (componentMatch === 'match') {
        score = Math.max(score, 0.7);
        score += 0.2;
        reasons.unshift('Exact canonical Component identity matches the price rule.');
      }
      if (areaMatch === 'match') {
        score = Math.max(score, 0.55);
        score += 0.08;
        reasons.push('Exact canonical Area identity matches the price rule.');
      }
      if (entry.issueType && entry.issueType === issueType) {
        score = Math.max(score, componentMatch === 'match' ? 0.95 : score);
      }

      const hasCanonicalBinding = Boolean(
        entry.canonicalAreaDefinitionIds?.length || entry.canonicalComponentDefinitionIds?.length,
      );
      if (!legacy && !hasCanonicalBinding) return [];
      score = Math.max(0, Math.min(1, score));
      return score >= 0.35 ? [{ entry, score, reasons, conflicts }] : [];
    })
    .sort((left, right) => {
      const leftCanonical = (left.entry.canonicalComponentDefinitionIds?.length ? 2 : 0) + (left.entry.canonicalAreaDefinitionIds?.length ? 1 : 0);
      const rightCanonical = (right.entry.canonicalComponentDefinitionIds?.length ? 2 : 0) + (right.entry.canonicalAreaDefinitionIds?.length ? 1 : 0);
      return rightCanonical - leftCanonical || right.score - left.score || left.entry.code.localeCompare(right.entry.code);
    });
}
