import React from 'react';
import { ReportData } from '../types';
import { formatChecklistValue, getAggregateRoomStatus, getReportDisplayTitle, getReportFooterLabel, isExitReport } from '../services/reportPresentation';

interface PDFPreviewProps {
  data: ReportData;
}

const PDFPreview: React.FC<PDFPreviewProps> = ({ data }) => {
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const rooms = data.rooms || [];
  const totalPhotos = rooms.reduce((count, room) => count + (room.photos || []).length, 0);
  const allPhotos = rooms.flatMap((room) => (room.photos || []).map((photo, index) => ({
    ...photo,
    roomName: room.name,
    roomIndex: index + 1,
    totalInRoom: (room.photos || []).length,
  })));

  const reportTitle = getReportDisplayTitle(data.reportType);
  const showExitSection = isExitReport(data.reportType);

  return (
    <div className="relative mx-auto max-w-[210mm] bg-white font-sans text-sm leading-tight text-black shadow-none print:w-full print:max-w-none">
      <div className="sticky top-0 z-20 border-y-2 border-amber-500 bg-amber-100 px-4 py-2 text-center text-xs font-extrabold uppercase tracking-[0.2em] text-amber-950 print:static">
        Draft Preview · Not the verified issued report
      </div>

      <div className="page-break relative flex min-h-[297mm] flex-col box-border p-12">
        <div className="mb-12 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-blue-700 text-2xl font-bold text-white shadow-sm">PI</div>
            <div className="flex h-14 flex-col justify-center">
              <h1 className="text-2xl font-bold uppercase leading-none tracking-tight text-blue-800" style={{ fontFamily: 'Arial, sans-serif' }}>
                {data.agentCompany || 'ProInspect'}
              </h1>
            </div>
          </div>
          <div className="text-right text-xs font-medium leading-relaxed">
            <p className="mb-1 text-sm font-bold text-black">{data.agentCompany || 'ProInspect'}</p>
            {data.agentAddress && <p>{data.agentAddress}</p>}
            {data.agentPhone && <p className="mt-2">T: {data.agentPhone}</p>}
            {data.agentEmail && <p>E: {data.agentEmail}</p>}
          </div>
        </div>

        <div className="mb-8 mt-6 text-center">
          <h1 className="mb-4 text-3xl font-bold text-black" style={{ fontFamily: 'Arial, sans-serif' }}>{reportTitle}</h1>
          <h2 className="text-xl font-bold text-black">{data.propertyAddress}</h2>
        </div>

        {data.heroPhoto && (
          <div className="mb-8 flex justify-center">
            <div className="flex h-[100mm] w-full max-w-[180mm] items-center justify-center overflow-hidden border border-gray-300 bg-gray-100 shadow-sm">
              <img src={data.heroPhoto.previewUrl} alt="Property Front" className="h-full w-full object-cover" />
            </div>
          </div>
        )}

        <div className="mb-20 mt-auto space-y-4 text-center">
          <p className="text-sm">Report completed on {formatDate(data.inspectionDate)}</p>
          <p className="text-sm">Prepared by {data.agentName || 'Assigned inspector'}</p>
          <p className="text-xs text-gray-500">Report ID {data.id}{data.currentVersionId ? ` · Current immutable version ${data.currentVersionId}` : ''}</p>
        </div>

        <div className="absolute bottom-12 right-12 text-sm font-bold text-blue-800">{data.agentCompany || 'ProInspect'}</div>
      </div>

      <style>{`
        @media print {
          .running-header {
            position: fixed;
            top: 5mm;
            left: 10mm;
            right: 10mm;
            height: 10mm;
            display: flex;
            justify-content: space-between;
            border-bottom: 1px solid black;
            font-size: 10px;
            font-style: italic;
            align-items: center;
            background: white;
            z-index: 100;
          }
          .content-start { margin-top: 15mm; }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
        }
        .running-header { display: none; }
      `}</style>

      <div className="running-header hidden print:flex">
        <span>{data.propertyAddress}</span>
        <span>{reportTitle}</span>
      </div>

      <div className="content-start p-10">
        <div className="mb-1 border border-black bg-gray-200 py-1 text-center text-sm font-bold">Agent section</div>
        <div className="mb-4 px-4 text-center text-[10px]">
          Each item records structured condition, cleanliness and operational observations. Operational confirmation requires a recorded qualifying test; an image alone is not a test.
        </div>

        {rooms.map((room) => {
          const aggregateStatus = getAggregateRoomStatus(room.items || []);
          const roomPhotosCount = (room.photos || []).length;
          return (
            <div key={room.id} className="mb-4">
              <table className="w-full border-collapse border border-black text-[11px]">
                <thead>
                  <tr className="bg-gray-100 print:bg-gray-100">
                    <th className="w-[30%] border border-black p-1 text-left text-sm font-bold uppercase">{room.name}</th>
                    <th className="w-[5%] border border-black p-1 text-center text-[10px]">Cln</th>
                    <th className="w-[5%] border border-black p-1 text-center text-[10px]">Udg</th>
                    <th className="w-[5%] border border-black p-1 text-center text-[10px]">Wkg</th>
                    <th className="border border-black bg-gray-100 p-1 text-center text-xs font-bold">Agent comments<br /><span className="text-[9px] font-normal italic">Cln = Clean, Udg = Undamaged, Wkg = Working</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-black">
                    <td className="border-r border-black p-2 align-top"><div className="font-medium">Overall</div></td>
                    <td className="border-r border-black p-1 text-center align-top">{formatChecklistValue(aggregateStatus.isClean)}</td>
                    <td className="border-r border-black p-1 text-center align-top">{formatChecklistValue(aggregateStatus.isUndamaged)}</td>
                    <td className="border-r border-black p-1 text-center align-top">{formatChecklistValue(aggregateStatus.isWorking)}</td>
                    <td className="p-2 align-top font-medium text-blue-800">{roomPhotosCount > 0 ? `(${roomPhotosCount} photos attached)` : 'No photos attached.'}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="border-r border-black p-2 align-top">Overall Commentary</td>
                    <td className="border-r border-black p-1 text-center align-top" />
                    <td className="border-r border-black p-1 text-center align-top" />
                    <td className="border-r border-black p-1 text-center align-top" />
                    <td className="p-2 align-top leading-relaxed whitespace-pre-wrap">{room.overallComment || 'No general overview provided.'}</td>
                  </tr>
                  {(room.items || []).map((item) => (
                    <tr key={item.id} className="border-b border-black hover:bg-gray-50">
                      <td className="border-r border-black p-2 align-top font-medium text-black">{item.name}</td>
                      <td className="border-r border-black p-1 text-center align-top font-bold text-green-700">{formatChecklistValue(item.cleanlinessCategory === 'clean')}</td>
                      <td className="border-r border-black p-1 text-center align-top font-bold text-green-700">{formatChecklistValue(['intact', 'minor_wear'].includes(item.conditionCategory))}</td>
                      <td className="border-r border-black p-1 text-center align-top font-bold text-green-700">{formatChecklistValue(['operation_confirmed', 'appears_operational'].includes(item.workingStatus))}</td>
                      <td className="space-y-1 p-2 align-top text-black">
                        <div>{item.comment || 'Refer to overall commentary.'}</div>
                        {item.testRecord?.status === 'tested' && (
                          <div className="border-t border-gray-200 pt-1 text-[10px] text-gray-700">
                            <strong>Operational test:</strong> {item.testRecord.result || 'inconclusive'}{item.testRecord.method ? ` · ${item.testRecord.method}` : ''}
                          </div>
                        )}
                        {showExitSection && (item.comparisonCommentary || item.baselineComponentData) && (
                          <div className="mt-1 border-t border-gray-200 pt-1 text-[10px] text-indigo-900">
                            <strong className="text-black">Exit Comparison:</strong> {item.comparisonCommentary || 'Consistent with Entry baseline; no material change identified.'}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <div className="page-break p-10">
        <div className="mb-4 border border-black bg-gray-200 px-2 py-1 text-sm font-bold">{showExitSection ? 'Exit Condition Report Notes' : `${reportTitle} Notes`}</div>

        {showExitSection && (
          <div className="mb-6">
            <h3 className="mb-4 text-sm font-bold">Approximate dates when work last done on residential premises</h3>
            <div className="space-y-2 text-sm">
              {['Painting of premises (external)', 'Painting of premises (internal)', 'Floorcoverings laid', 'Floorcoverings professionally cleaned'].map((label) => (
                <div key={label} className="flex items-center">
                  <div className="w-1/3">{label}:</div>
                  <div className="flex h-8 w-2/3 items-center justify-center border border-black bg-white"> / / </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-8">
          <div className="mb-1 text-sm font-bold">Additional Comments</div>
          <div className="h-24 w-full border border-black" />
        </div>

        <div className="mb-0 border border-black bg-gray-200 px-2 py-1 text-sm font-bold">Report Preparation / Approval Record</div>
        <div className="border border-t-0 border-black p-4 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><span className="font-bold">Prepared by:</span><div>{data.agentName || 'Recorded in ProInspect'}</div></div>
            <div><span className="font-bold">Inspection date:</span><div>{formatDate(data.inspectionDate)}</div></div>
            <div><span className="font-bold">Report version:</span><div>{data.currentVersionId || 'Draft preview'}</div></div>
          </div>
          <p className="mt-3 text-[10px] text-gray-600">No synthetic signature is rendered. Reviewer approval, recipient acknowledgements and finalisation are separate audited records bound to the immutable report version and its content hash.</p>
        </div>

        <div className="mt-8 text-[10px] leading-tight text-justify">
          <p className="mb-1 font-bold">DISCLAIMER:</p>
          <p>This tenancy inspection report is a visual inspection intended to document observed condition only. It does not replace specialist advice on structural, electrical, plumbing, gas, glazing, smoke alarm, or pool safety compliance matters. Furniture, personal belongings, enclosed cavities, and concealed building elements are outside the scope of this report unless specifically accessed and recorded.</p>
        </div>

        <div className="mt-8 text-right text-sm font-bold">{getReportFooterLabel(data.reportType)}</div>
      </div>

      {allPhotos.length > 0 && (
        <div className="page-break p-10">
          <div className="mb-4 border border-black bg-gray-200 px-2 py-1 text-sm font-bold">Agent Inspection Photos ({totalPhotos} photos)</div>
          <div className="grid grid-cols-3 gap-4">
            {allPhotos.map((photo) => (
              <div key={photo.id} className="avoid-break mb-4">
                <div className="mb-1 text-[10px] font-bold uppercase">{photo.roomName}: Overall (photo {photo.roomIndex} of {photo.totalInRoom})</div>
                <div className="relative aspect-[4/3] w-full border border-gray-300 bg-gray-100">
                  <img src={photo.previewUrl} className="h-full w-full object-cover" alt={`${photo.roomName} inspection`} />
                </div>
                <div className="mt-0.5 text-right text-[9px] text-gray-500">{formatDate(data.inspectionDate)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PDFPreview;
