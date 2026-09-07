// Source-controlled synthetic fixtures and reader scopes from development.json
// and seed-development.mjs, usable by the account-authenticated CLI preparer.
export function buildPortalFixturePlan(seed, personas) {
  if (seed.agency?.$id !== 'dev_agency' || seed.marker !== 'DEV TEST - APPWRITE FOUNDATION') {
    throw new Error('Refusing fixtures outside the synthetic Development agency.');
  }
  const fixtures = [];
  const identities = new Set(seed.identities.map(([id]) => id));
  const add = (tableId, item, readers, agencyScoped = true) => {
    const { $id: rowId, ...data } = item;
    if (!/^dev_[a-z0-9_]+$/u.test(rowId) || rowId.length > 36) throw new Error('Fixture row ID must be a bounded synthetic Development ID.');
    if (agencyScoped) data.agencyId ??= seed.agency.$id;
    if (data.agencyId && data.agencyId !== 'dev_agency') throw new Error('Fixture agency scope differs from dev_agency.');
    if (readers.some((id) => !identities.has(id) || !id.startsWith('dev_'))) throw new Error('Fixture reader is not a synthetic Development identity.');
    fixtures.push({ tableId, rowId, data, permissions: [...new Set(readers)].map((id) => `read("user:${id}")`).sort() });
  };
  const siteReaders = (id) => ['dev_admin', ...seed.siteMemberships.filter((item) => item.managedSiteId === id).map((item) => item.userId)];
  add('agencies', seed.agency, [...identities], false);
  for (const item of seed.sites) add('managed_sites', item, siteReaders(item.$id));
  for (const item of seed.clients) add('clients', item, ['dev_admin', 'dev_client_user']);
  for (const item of seed.properties) add('properties', item, item.managedSiteId ? siteReaders(item.managedSiteId) : ['dev_admin', 'dev_client_user']);
  for (const item of seed.units) add('units', item, ['dev_admin', 'dev_building_manager', 'dev_relief_manager', 'dev_strata_manager', 'dev_council_member', 'dev_resident_owner', 'dev_resident_tenant', 'dev_client_user']);
  for (const item of seed.occupancies) add('occupancies', item, ['dev_admin', 'dev_building_manager', 'dev_relief_manager', 'dev_strata_manager', 'dev_resident_owner', 'dev_resident_tenant']);
  for (const item of seed.contractors) add('contractors', item, ['dev_admin', 'dev_building_manager', 'dev_relief_manager', 'dev_strata_manager', 'dev_contractor']);
  for (const item of seed.propertyClientRelationships) add('property_client_relationships', item, ['dev_admin', 'dev_client_user']);
  for (const item of seed.serviceDefinitions) add('service_definitions', item, [...identities]);
  for (const [userId, role] of personas) {
    add('user_profiles', { $id: userId, userId, displayName: `DEV TEST - ${role}`, email: `${userId}@example.com`, status: 'active' }, [userId], false);
    add('agency_memberships', { $id: `${userId}_agency`, userId, role, status: 'active', mfaRequired: ['proinspect_admin', 'reviewer'].includes(role) }, [userId]);
  }
  for (const item of seed.siteMemberships) add('site_memberships', item, [item.userId]);
  for (const [id, role] of personas) {
    const entitlements = seed.portalEntitlements.filter((item) => item.userId === id && item.sourceRole === role && item.status === 'active');
    if (entitlements.length !== 1) throw new Error(`Expected exactly one active seeded portal entitlement for ${id}.`);
    add('portal_entitlements', entitlements[0], [id]);
  }
  const operationalReaders = {
    service_requests: ['dev_admin', 'dev_building_manager', 'dev_inspector', 'dev_client_user'],
    inspection_jobs: ['dev_admin', 'dev_inspector', 'dev_client_user', 'dev_resident_tenant'],
    maintenance_items: ['dev_admin', 'dev_building_manager', 'dev_strata_manager', 'dev_client_user'],
    maintenance_work_orders: ['dev_admin', 'dev_building_manager', 'dev_contractor'],
    incidents: ['dev_admin', 'dev_building_manager', 'dev_strata_manager'],
    resident_requests: ['dev_admin', 'dev_building_manager', 'dev_strata_manager', 'dev_resident_tenant'],
  };
  for (const { tableId, row } of seed.operationalRecords) {
    if (!Object.hasOwn(operationalReaders, tableId)) throw new Error('Unexpected operational fixture table.');
    add(tableId, row, operationalReaders[tableId]);
  }
  const keys = fixtures.map((item) => `${item.tableId}/${item.rowId}`);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate synthetic fixture row.');
  return fixtures;
}

const comparable = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : value;

export function portalFixtureChange(fixture, existing, now) {
  const { tableId, rowId, data, permissions } = fixture;
  if (existing) {
    if (existing.$id !== rowId || (data.agencyId && existing.agencyId !== data.agencyId)) {
      throw new Error(`Refusing to repurpose fixture ${tableId}/${rowId}: identity or agency mismatch.`);
    }
    // Never move an existing record to a different person, property, client,
    // contractor or site. Missing fields from older seed versions may be filled.
    for (const [key, value] of Object.entries(data)) {
      // Seed 31d13ba used the synthetic user's ID here; faa9b05 introduced
      // its contractor profile. Permit only this exact documented migration.
      const legacyContractor = tableId === 'maintenance_work_orders' && rowId === 'dev_work_order'
        && key === 'contractorId' && existing.contractorId === 'dev_contractor' && value === 'dev_contractor_profile'
        && existing.maintenanceItemId === 'dev_maintenance_item'
        && existing.instructions === 'DEV TEST - Inspect and quote only.';
      if ((key.endsWith('Id') || ['email', 'portalId', 'name', 'companyName', 'streetAddress'].includes(key))
        && existing[key] != null && existing[key] !== '' && existing[key] !== value && !legacyContractor) {
        throw new Error(`Refusing to repurpose fixture ${tableId}/${rowId}: ${key} mismatch.`);
      }
    }
    const sameData = Object.entries(data).every(([key, value]) => comparable(existing[key]) === comparable(value));
    const samePermissions = JSON.stringify([...(existing.$permissions ?? [])].sort()) === JSON.stringify(permissions);
    if (sameData && samePermissions) return null;
  }
  return { data: { ...data, createdAt: existing?.createdAt ?? now, updatedAt: now }, permissions };
}
