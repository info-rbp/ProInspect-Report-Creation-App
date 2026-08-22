export interface CanonicalAreaReferenceLike {
  id?: string;
  canonicalAreaDefinitionId?: string;
  canonicalAreaDefinitionVersion?: number;
}

export interface CanonicalComponentReferenceLike {
  id?: string;
  canonicalComponentDefinitionId?: string;
  canonicalComponentDefinitionVersion?: number;
  canonicalAreaComponentRuleId?: string;
  canonicalAreaComponentRuleVersion?: number;
}

export function canonicalDefinitionKey(id: string | undefined, version?: number): string | undefined {
  const value = id?.trim();
  if (!value) return undefined;
  return typeof version === 'number' && Number.isInteger(version) && version > 0
    ? `${value}@${version}`
    : value;
}

/** Stable semantic identity. Versions are provenance, not a new semantic identity. */
export function canonicalAreaIdentity(area: CanonicalAreaReferenceLike): string | undefined {
  const id = area.canonicalAreaDefinitionId?.trim();
  return id ? `area:${id}` : undefined;
}

export function canonicalAreaVersionIdentity(area: CanonicalAreaReferenceLike): string | undefined {
  const key = canonicalDefinitionKey(area.canonicalAreaDefinitionId, area.canonicalAreaDefinitionVersion);
  return key ? `area:${key}` : undefined;
}

export function canonicalComponentIdentity(component: CanonicalComponentReferenceLike): string | undefined {
  const id = component.canonicalComponentDefinitionId?.trim();
  return id ? `component:${id}` : undefined;
}

export function canonicalComponentVersionIdentity(component: CanonicalComponentReferenceLike): string | undefined {
  const key = canonicalDefinitionKey(
    component.canonicalComponentDefinitionId,
    component.canonicalComponentDefinitionVersion,
  );
  return key ? `component:${key}` : undefined;
}

/**
 * Property occurrence identity. Repeated canonical Areas (Bedroom 1/Bedroom 2) must not collapse
 * merely because they share the same Area definition.
 */
export function canonicalComponentOccurrenceIdentity(
  area: CanonicalAreaReferenceLike,
  component: CanonicalComponentReferenceLike,
): string | undefined {
  const componentId = component.canonicalComponentDefinitionId?.trim();
  if (!componentId) return undefined;
  const areaInstanceId = area.id?.trim();
  if (areaInstanceId) return `area-instance:${areaInstanceId}|component:${componentId}`;
  const areaId = area.canonicalAreaDefinitionId?.trim();
  return areaId ? `area:${areaId}|component:${componentId}` : `component:${componentId}`;
}

export function canonicalSemanticComponentIdentity(
  area: CanonicalAreaReferenceLike,
  component: CanonicalComponentReferenceLike,
): string | undefined {
  const areaId = area.canonicalAreaDefinitionId?.trim();
  const componentId = component.canonicalComponentDefinitionId?.trim();
  if (!componentId) return undefined;
  return areaId ? `area:${areaId}|component:${componentId}` : `component:${componentId}`;
}

export function canonicalRuleIdentity(component: CanonicalComponentReferenceLike): string | undefined {
  const key = canonicalDefinitionKey(
    component.canonicalAreaComponentRuleId,
    component.canonicalAreaComponentRuleVersion,
  );
  return key ? `rule:${key}` : undefined;
}

export function sameCanonicalArea(
  left: CanonicalAreaReferenceLike,
  right: CanonicalAreaReferenceLike,
): boolean {
  const leftCanonical = canonicalAreaIdentity(left);
  const rightCanonical = canonicalAreaIdentity(right);
  if (leftCanonical && rightCanonical) return leftCanonical === rightCanonical;
  return Boolean(left.id && right.id && left.id === right.id);
}

export function sameCanonicalComponent(
  leftArea: CanonicalAreaReferenceLike,
  left: CanonicalComponentReferenceLike,
  rightArea: CanonicalAreaReferenceLike,
  right: CanonicalComponentReferenceLike,
): boolean {
  const leftOccurrence = canonicalComponentOccurrenceIdentity(leftArea, left);
  const rightOccurrence = canonicalComponentOccurrenceIdentity(rightArea, right);
  if (leftOccurrence && rightOccurrence && leftOccurrence === rightOccurrence) return true;
  const leftSemantic = canonicalSemanticComponentIdentity(leftArea, left);
  const rightSemantic = canonicalSemanticComponentIdentity(rightArea, right);
  if (leftSemantic && rightSemantic) return leftSemantic === rightSemantic;
  return Boolean(leftArea.id && rightArea.id && left.id && right.id && leftArea.id === rightArea.id && left.id === right.id);
}
