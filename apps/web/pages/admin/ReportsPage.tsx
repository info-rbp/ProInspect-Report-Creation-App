import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { PropertyRecord, ReportIndex } from '../../types/platform';
import type { ReportData } from '../../types';
import { listProperties } from '../../services/platform/propertyService';
import { listReportIndexes, upsertReportIndexFromReport } from '../../services/platform/reportIndexService';
import { DEFAULT_AGENCY_ID } from '../../services/platform/userProfileService';
import { saveReportToDB } from '../../services/storageService';
import { generateId } from '../../utils';

import { seedReportFromProperty } from '../../services/platform/propertySeedingService';

const reportTypes = ['Property Condition Report', 'Routine Inspection', 'Exit Inspection'];

const ReportsPage: React.FC = () => {
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportIndex[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({
    propertyId: '',
    reportType: 'Property Condition Report',
    inspectionDate: new Date().toISOString().split('T')[0],
    tenantName: '',
    clientName: '',
  });

  const loadData = async () => {
    const [nextReports, nextProperties] = await Promise.all([listReportIndexes(), listProperties()]);
    setReports(nextReports);
    setProperties(nextProperties);
    setForm((prev) => ({ ...prev, propertyId: prev.propertyId || nextProperties[0]?.id || '' }));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const property = properties.find((candidate) => candidate.id === form.propertyId);
    let report: ReportData;

    if (property) {
      report = seedReportFromProperty(property, {
        id: generateId(),
        agencyId: DEFAULT_AGENCY_ID,
        clientName: form.clientName || property.landlordDetails?.name || '',
        tenantName: form.tenantName || property.tenantDetails?.primaryTenantName || '',
        inspectionDate: form.inspectionDate,
        reportType: form.reportType,
        agentName: 'Admin Team',
        agentCompany: 'ProInspect',
      });
    } else {
      report = {
        id: generateId(),
        agencyId: DEFAULT_AGENCY_ID,
        lifecycleStatus: 'draft',
        propertyAddress: '',
        agentName: 'Admin Team',
        agentCompany: 'ProInspect',
        agentAddress: 'Perth, WA',
        agentPhone: '0400 000 000',
        agentEmail: 'inspections@proinspect.com.au',
        clientName: form.clientName,
        inspectionDate: form.inspectionDate,
        tenantName: form.tenantName,
        reportType: form.reportType,
        rooms: [],
      };
    }

    const savedReport = await saveReportToDB(report);
    await upsertReportIndexFromReport(savedReport);
    setIsCreating(false);
    await loadData();
    navigate(`/app/admin/reports/${savedReport.id}/edit`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">Reports</h1>
          <p className="text-sm text-gray-600">Report indexes linked to full inspection report payloads.</p>
        </div>
        <button type="button" onClick={() => setIsCreating(true)} className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">
          <Plus size={16} /> Create report
        </button>
      </div>

      {isCreating && (
        <form onSubmit={handleSubmit} className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:grid-cols-3">
          <select
            value={form.propertyId}
            onChange={(event) => {
              const selectedId = event.target.value;
              const prop = properties.find((p) => p.id === selectedId);
              setForm((prev) => ({
                ...prev,
                propertyId: selectedId,
                clientName: prop?.landlordDetails?.name || prev.clientName,
                tenantName: prop?.tenantDetails?.primaryTenantName || prev.tenantName,
              }));
            }}
            className="rounded-lg border border-gray-300 p-2 text-sm"
          >
            <option value="">No property selected</option>
            {properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}
          </select>
          <select value={form.reportType} onChange={(event) => setForm((prev) => ({ ...prev, reportType: event.target.value }))} className="rounded-lg border border-gray-300 p-2 text-sm">
            {reportTypes.map((reportType) => <option key={reportType} value={reportType}>{reportType}</option>)}
          </select>
          <input type="date" value={form.inspectionDate} onChange={(event) => setForm((prev) => ({ ...prev, inspectionDate: event.target.value }))} className="rounded-lg border border-gray-300 p-2 text-sm" />
          <input placeholder="Tenant names" value={form.tenantName} onChange={(event) => setForm((prev) => ({ ...prev, tenantName: event.target.value }))} className="rounded-lg border border-gray-300 p-2 text-sm" />
          <input placeholder="Client / landlord" value={form.clientName} onChange={(event) => setForm((prev) => ({ ...prev, clientName: event.target.value }))} className="rounded-lg border border-gray-300 p-2 text-sm" />
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Create</button>
            <button type="button" onClick={() => setIsCreating(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">Cancel</button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {reports.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No reports yet. Create a report or save from the report builder.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="p-3">Property</th>
                <th className="p-3">Type</th>
                <th className="p-3">Status</th>
                <th className="p-3">Inspection date</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium text-gray-950"><Link to={`/app/admin/reports/${report.reportId}`}>{report.propertyAddress || 'Untitled property'}</Link></td>
                  <td className="p-3 text-gray-600">{report.reportType}</td>
                  <td className="p-3"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">{report.lifecycleStatus.replaceAll('_', ' ')}</span></td>
                  <td className="p-3 text-gray-600">{report.inspectionDate || '-'}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <Link className="text-blue-600 hover:underline" to={`/app/admin/reports/${report.reportId}/edit`}>Edit</Link>
                      <Link className="text-blue-600 hover:underline" to={`/app/admin/reports/${report.reportId}/preview`}>Preview</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ReportsPage;
