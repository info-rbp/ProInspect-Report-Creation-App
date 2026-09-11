import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Permission, Role } from 'node-appwrite';
import { root, requireThat } from '../runtime.mjs';
import { optional } from '../appwrite-session.mjs';

export async function seedAcceptanceFixtures(api,target,environment){
  const password=process.env[target.acceptance.seedPasswordEnv]; requireThat(password?.length>=8,'Acceptance seed password is required');
  const seed=JSON.parse(await readFile(resolve(root,'infrastructure/appwrite/seeds/development.json'),'utf8')); const dbid=target.appwrite.databaseId; const now=new Date().toISOString();
  const all=seed.identities.map(([id])=>id); const readFor=(ids)=>[...new Set(ids)].map((id)=>Permission.read(Role.user(id))); const siteReaders=(site)=>['dev_admin',...seed.siteMemberships.filter((v)=>v.managedSiteId===site).map((v)=>v.userId)];
  const upsert=async(tableId,item,permissions=[],agencyScoped=true)=>{const data={...item,...(agencyScoped?{agencyId:item.agencyId ?? seed.agency.$id}:{}),createdAt:item.createdAt ?? now,updatedAt:now};const rowId=data.$id;delete data.$id;const live=await optional(()=>api.db.getRow({databaseId:dbid,tableId,rowId}));if(live)await api.db.updateRow({databaseId:dbid,tableId,rowId,data,permissions});else await api.db.createRow({databaseId:dbid,tableId,rowId,data,permissions});};
  const agency={...seed.agency};delete agency.agencyId;await upsert('agencies',agency,readFor(all),false);
  for(const site of seed.sites)await upsert('managed_sites',site,readFor(siteReaders(site.$id))); for(const item of seed.clients ?? [])await upsert('clients',item,readFor(['dev_admin','dev_client_user']));
  for(const item of seed.properties)await upsert('properties',item,readFor(item.managedSiteId?siteReaders(item.managedSiteId):['dev_admin','dev_client_user'])); for(const item of seed.units ?? [])await upsert('units',item,readFor(['dev_admin','dev_building_manager','dev_relief_manager','dev_strata_manager','dev_council_member','dev_resident_owner','dev_resident_tenant','dev_client_user']));
  for(const item of seed.occupancies ?? [])await upsert('occupancies',item,readFor(['dev_admin','dev_building_manager','dev_relief_manager','dev_strata_manager','dev_resident_owner','dev_resident_tenant'])); for(const item of seed.contractors ?? [])await upsert('contractors',item,readFor(['dev_admin','dev_building_manager','dev_relief_manager','dev_strata_manager','dev_contractor']));
  for(const item of seed.propertyClientRelationships ?? [])await upsert('property_client_relationships',item,readFor(['dev_admin','dev_client_user'])); for(const item of seed.serviceDefinitions)await upsert('service_definitions',item,readFor(all));
  for(const [userId,role] of seed.identities){const email=userId+'@example.com';const user=await optional(()=>api.users.get({userId}));if(!user)await api.users.create({userId,email,password,name:'ACCEPTANCE '+environment+' - '+role});else await api.users.updatePassword({userId,password});const own=readFor([userId]);await upsert('user_profiles',{$id:userId,userId,displayName:'ACCEPTANCE '+environment+' - '+role,email,status:'active'},own,false);await upsert('agency_memberships',{$id:userId+'_agency',userId,role,status:'active',mfaRequired:['proinspect_admin','reviewer'].includes(role)},own);}
  for(const item of seed.siteMemberships)await upsert('site_memberships',item,readFor([item.userId])); for(const item of seed.portalEntitlements ?? [])await upsert('portal_entitlements',item,readFor([item.userId]));
  const readers={service_requests:['dev_admin','dev_building_manager','dev_inspector','dev_client_user'],inspection_jobs:['dev_admin','dev_inspector','dev_client_user','dev_resident_tenant'],maintenance_items:['dev_admin','dev_building_manager','dev_strata_manager','dev_client_user'],maintenance_work_orders:['dev_admin','dev_building_manager','dev_contractor'],incidents:['dev_admin','dev_building_manager','dev_strata_manager'],resident_requests:['dev_admin','dev_building_manager','dev_strata_manager','dev_resident_tenant']};
  for(const item of seed.operationalRecords)await upsert(item.tableId,item.row,readFor(readers[item.tableId] ?? ['dev_admin']));

  const shopifyConfiguration={autoConvertReadyRequests:false,syntheticOnly:true,fixtureAgencyId:'dev_agency'};
  await upsert('integration_connections',{
    $id:'shopify',
    provider:'shopify',
    status:'connected',
    externalAccountId:target.shopify.domain,
    credentialReference:'synthetic-launch-replay-only',
    configuration:JSON.stringify(shopifyConfiguration),
  },readFor(['dev_admin']));
  await upsert('shopify_service_mappings',{
    $id:'dev_shopify_routine_mapping',
    status:'active',
    shopDomain:target.shopify.domain,
    shopifyProductId:'gid://shopify/Product/90000000000021',
    shopifyVariantId:'gid://shopify/ProductVariant/90000000000022',
    serviceDefinitionId:'dev_service_routine',
    active:true,
    mappingConfiguration:JSON.stringify({
      provider:'shopify',
      serviceCode:'DEV-ROUTINE',
      label:'DEV TEST - Routine Inspection',
      productId:'gid://shopify/Product/90000000000021',
      variantId:'gid://shopify/ProductVariant/90000000000022',
      sku:'DEV-ROUTINE',
      reportType:'Routine Inspection',
      propertyUse:'residential',
      defaultDurationMinutes:30,
      paymentRequired:true,
      manualApprovalRequired:false,
      defaultPriority:'normal',
      serviceDefinitionId:'dev_service_routine',
    }),
  },readFor(['dev_admin']));

  return {environment,identities:seed.identities.length,siteMemberships:seed.siteMemberships.length,portalEntitlements:(seed.portalEntitlements ?? []).length,shopifyBootstrap:{agencyId:'dev_agency',connectionId:'shopify',mappingId:'dev_shopify_routine_mapping',syntheticOnly:true},syntheticOnly:true};
}
