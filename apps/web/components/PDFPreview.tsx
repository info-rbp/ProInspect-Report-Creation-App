import React, { useMemo } from 'react';
import { defaultPresentationTemplate, type ReportBrandingSnapshot } from '@pcr/report-presentation';
import { buildReportPresentationViewModel } from '@pcr/report-presentation/view-model';
import { buildReportDocumentModel, type ReportDocumentBlock } from '@pcr/report-presentation/document-model';
import type { ReportData } from '../types';

interface PDFPreviewProps {
  data: ReportData;
}

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const PDFPreview: React.FC<PDFPreviewProps> = ({ data }) => {
  const photoUrls = useMemo(() => {
    const entries = data.rooms.flatMap((room) => room.photos.map((photo) => [photo.id, photo.previewUrl] as const));
    if (data.heroPhoto) entries.push([data.heroPhoto.id, data.heroPhoto.previewUrl]);
    return new Map(entries);
  }, [data.heroPhoto, data.rooms]);

  const document = useMemo(() => {
    const view = buildReportPresentationViewModel({
      reportId: data.id,
      ...(data.currentVersionId ? { reportVersionId: data.currentVersionId } : {}),
      reportType: data.reportType,
      propertyAddress: data.propertyAddress,
      inspectionDate: data.inspectionDate,
      clientName: data.clientName,
      tenantName: data.tenantName,
      inspectorName: data.agentName,
      agencyName: data.agentCompany,
      areas: data.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        overallComment: room.overallComment,
        photoReferences: room.photos.map((photo, sequence) => ({ photoId: photo.id, sequence })),
        components: room.items.map((item) => ({
          id: item.id,
          name: item.name,
          conditionCategory: item.conditionCategory,
          cleanlinessCategory: item.cleanlinessCategory,
          workingStatus: item.workingStatus,
          testStatus: item.testStatus,
          comment: item.comment,
          defects: item.defects,
          maintenanceRequired: item.maintenanceRequired,
          comparisonStatus: item.comparisonStatus,
          comparisonCommentary: item.comparisonCommentary,
          photoReferences: item.photoReferences,
        })),
      })),
    });
    const branding: ReportBrandingSnapshot = {
      profileId: 'preview-branding',
      profileVersion: 1,
      agencyName: data.agentCompany || 'ProInspect',
      ...(data.agentAddress ? { address: data.agentAddress } : {}),
      ...(data.agentPhone ? { phone: data.agentPhone } : {}),
      ...(data.agentEmail ? { email: data.agentEmail } : {}),
      primaryColour: '#1D4ED8',
      secondaryColour: '#0F172A',
      accentColour: '#0284C7',
      headingFont: 'Inter',
      bodyFont: 'Inter',
      capturedAt: new Date(0).toISOString(),
    };
    return buildReportDocumentModel({ view, template: defaultPresentationTemplate(new Date(0).toISOString()), branding });
  }, [data]);

  const renderBlock = (block: ReportDocumentBlock, index: number) => {
    if (block.type === 'cover') {
      return (
        <section key={index} className="page-break relative flex min-h-[297mm] flex-col p-12">
          <div className="flex items-start justify-between border-b-4 border-blue-700 pb-5">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-[0.24em] text-blue-700">Property Inspection</div>
              <div className="mt-2 text-2xl font-black text-slate-950">{block.agencyName}</div>
            </div>
            <div className="text-right text-xs text-slate-600">Report {document.reportId}</div>
          </div>
          {data.heroPhoto && (
            <div className="mt-10 h-[105mm] overflow-hidden rounded-xl bg-slate-100">
              <img src={data.heroPhoto.previewUrl} alt="Property" className="h-full w-full object-cover" />
            </div>
          )}
          <div className="mt-auto pb-16">
            <h1 className="text-4xl font-black tracking-tight text-slate-950">{block.title}</h1>
            <h2 className="mt-3 text-2xl font-semibold text-slate-700">{block.propertyAddress}</h2>
            <div className="mt-8 grid grid-cols-2 gap-5 text-sm text-slate-700">
              {block.inspectionDate && <div><b>Inspection date</b><br />{formatDate(block.inspectionDate)}</div>}
              {block.inspectorName && <div><b>Prepared by</b><br />{block.inspectorName}</div>}
              {block.clientName && <div><b>Client</b><br />{block.clientName}</div>}
              {document.reportVersionId && <div><b>Immutable version</b><br />{document.reportVersionId}</div>}
            </div>
          </div>
        </section>
      );
    }
    if (block.type === 'summary') {
      return (
        <section key={index} className="page-break p-10">
          <h2 className="text-2xl font-black text-slate-950">{block.heading}</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {block.metrics.map((metric) => <div key={metric.label} className="rounded-lg border border-slate-200 p-4"><div className="text-2xl font-black">{metric.value}</div><div className="mt-1 text-xs text-slate-600">{metric.label}</div></div>)}
          </div>
        </section>
      );
    }
    if (block.type === 'finding-list') {
      return (
        <section key={index} className="p-10">
          <h2 className="mb-4 text-xl font-black">{block.heading}</h2>
          <div className="space-y-3">
            {block.items.length ? block.items.map((item) => <div key={`${item.areaName}-${item.component.id}`} className="avoid-break rounded-lg border border-slate-200 p-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">{item.areaName}</div><div className="mt-1 font-bold">{item.component.label}</div><div className="mt-2 text-sm">{item.component.commentary}</div></div>) : <p className="text-sm text-slate-500">No exceptions recorded.</p>}
          </div>
        </section>
      );
    }
    if (block.type === 'area') {
      return (
        <section key={index} className="page-break p-10">
          <h2 className="text-2xl font-black">{block.heading}</h2>
          <p className="mt-2 text-sm text-slate-700">{block.commentary}</p>
          <div className="mt-5 overflow-hidden rounded-lg border border-slate-300">
            {block.components.map((component) => <div key={component.id} className="avoid-break border-b border-slate-200 p-4 last:border-b-0"><div className="flex justify-between gap-4"><div className="font-bold">{component.label}</div><div className="text-xs text-slate-500">{component.condition.replaceAll('_', ' ')} · {component.cleanliness.replaceAll('_', ' ')}</div></div><p className="mt-2 text-sm">{component.commentary}</p>{component.photos.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2">{component.photos.slice(0, 3).map((photo) => photoUrls.get(photo.photoId) ? <img key={photo.photoId} src={photoUrls.get(photo.photoId)} alt={photo.caption || component.label} className="aspect-[4/3] w-full rounded object-cover" /> : null)}</div>}</div>)}
          </div>
        </section>
      );
    }
    if (block.type === 'approval') return <section key={index} className="p-10"><h2 className="text-lg font-black">Approval Record</h2><p className="mt-3 text-sm">Prepared by {block.inspectorName || 'Recorded inspector'}{block.reportVersionId ? ` · Immutable version ${block.reportVersionId}` : ''}</p></section>;
    if (block.type === 'text') return <section key={index} className="p-10"><h2 className="text-lg font-black">{block.heading}</h2><p className="mt-3 text-xs leading-relaxed text-slate-600">{block.body}</p></section>;
    if (block.type === 'photo-index') return <section key={index} className="page-break p-10"><h2 className="text-xl font-black">{block.heading}</h2><div className="mt-5 grid grid-cols-2 gap-4">{block.photos.map((photo) => photoUrls.get(photo.photoId) ? <figure key={`${photo.photoId}-${photo.areaName}`} className="avoid-break"><img src={photoUrls.get(photo.photoId)} alt={photo.caption || photo.componentLabel || photo.areaName} className="aspect-[4/3] w-full rounded border border-slate-200 object-cover" /><figcaption className="mt-1 text-[10px] text-slate-600">{photo.areaName}{photo.componentLabel ? ` · ${photo.componentLabel}` : ''}{photo.caption ? ` · ${photo.caption}` : ''}</figcaption></figure> : null)}</div></section>;
    return null;
  };

  return (
    <div className="relative mx-auto max-w-[210mm] bg-white font-sans text-black print:w-full print:max-w-none">
      <div className="sticky top-0 z-20 border-y-2 border-amber-500 bg-amber-100 px-4 py-2 text-center text-xs font-extrabold uppercase tracking-[0.2em] text-amber-950 print:hidden">Draft Preview · Shared presentation model</div>
      {document.blocks.map(renderBlock)}
    </div>
  );
};

export default PDFPreview;
