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
    <div className="bg-white text-black text-sm font-sans leading-tight max-w-[210mm] mx-auto shadow-none print:w-full print:max-w-none">
      <div className="p-12 min-h-[297mm] flex flex-col relative page-break box-border">
        <div className="flex justify-between items-start mb-12">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 bg-blue-700 rounded-lg flex items-center justify-center text-white font-bold text-2xl shadow-sm">RB</div>
            <div className="flex flex-col justify-center h-14">
              <h1 className="text-2xl font-bold text-blue-800 tracking-tight uppercase leading-none" style={{ fontFamily: 'Arial, sans-serif' }}>
                {data.agentCompany || 'REMOTE BUSINESS PARTNER'}
              </h1>
            </div>
          </div>
          <div className="text-right text-xs font-medium leading-relaxed">
            <p className="font-bold text-black text-sm mb-1">{data.agentCompany || 'Remote Business Partner'}</p>
            {data.agentAddress && <p>{data.agentAddress}</p>}
            {data.agentPhone && <p className="mt-2">T: {data.agentPhone}</p>}
            {data.agentEmail && <p>E: {data.agentEmail}</p>}
          </div>
        </div>

        <div className="text-center mt-6 mb-8">
          <h1 className="text-3xl font-bold text-black mb-4" style={{ fontFamily: 'Arial, sans-serif' }}>{reportTitle}</h1>
          <h2 className="text-xl font-bold text-black">{data.propertyAddress}</h2>
        </div>

        {data.heroPhoto && (
          <div className="flex justify-center mb-8">
            <div className="w-full max-w-[180mm] h-[100mm] border border-gray-300 bg-gray-100 overflow-hidden shadow-sm flex items-center justify-center">
              <img src={data.heroPhoto.previewUrl} alt="Property Front" className="w-full h-full object-cover" />
            </div>
          </div>
        )}

        <div className="mt-auto text-center space-y-4 mb-20">
          <p className="text-sm">Report completed on {formatDate(data.inspectionDate)}</p>
          <p className="text-sm">Prepared by {data.agentName}</p>
        </div>

        <div className="absolute bottom-12 right-12 font-bold text-sm text-blue-800">{data.agentCompany || 'Remote Business Partner'}</div>
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
          .content-start {
            margin-top: 15mm;
          }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
        }
        .running-header { display: none; }
      `}</style>

      <div className="hidden print:flex running-header">
        <span>{data.propertyAddress}</span>
        <span>{reportTitle}</span>
      </div>

      <div className="p-10 content-start">
        <div className="bg-gray-200 border border-black text-center font-bold py-1 mb-1 text-sm">Agent section</div>
        <div className="text-[10px] mb-4 text-center px-4">
          Each item has been given a column description of clean, undamaged, and working. Tick each column that applies to the item and make any necessary comments.
        </div>

        {rooms.map((room) => {
          const aggregateStatus = getAggregateRoomStatus(room.items || []);
          const roomPhotosCount = (room.photos || []).length;
          return (
            <div key={room.id} className="mb-4">
              <table className="w-full border-collapse border border-black text-[11px]">
                <thead>
                  <tr className="bg-gray-100 print:bg-gray-100">
                    <th className="border border-black p-1 text-left uppercase font-bold text-sm w-[30%]">{room.name}</th>
                    <th className="border border-black p-1 w-[5%] text-center text-[10px]">Cln</th>
                    <th className="border border-black p-1 w-[5%] text-center text-[10px]">Udg</th>
                    <th className="border border-black p-1 w-[5%] text-center text-[10px]">Wkg</th>
                    <th className="border border-black p-1 text-center font-bold text-xs bg-gray-100">Agent comments<br /><span className="text-[9px] font-normal italic">Cln = Clean, Udg = Undamaged, Wkg = Working</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-black">
                    <td className="border-r border-black p-2 align-top"><div className="font-medium">Overall</div></td>
                    <td className="border-r border-black p-1 text-center align-top">{formatChecklistValue(aggregateStatus.isClean)}</td>
                    <td className="border-r border-black p-1 text-center align-top">{formatChecklistValue(aggregateStatus.isUndamaged)}</td>
                    <td className="border-r border-black p-1 text-center align-top">{formatChecklistValue(aggregateStatus.isWorking)}</td>
                    <td className="p-2 align-top text-blue-800 font-medium">{roomPhotosCount > 0 ? `(${roomPhotosCount} photos attached)` : 'No photos attached.'}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="border-r border-black p-2 align-top">Overall Commentary</td>
                    <td className="border-r border-black p-1 text-center align-top"></td>
                    <td className="border-r border-black p-1 text-center align-top"></td>
                    <td className="border-r border-black p-1 text-center align-top"></td>
                    <td className="p-2 align-top whitespace-pre-wrap leading-relaxed">{room.overallComment || 'No general overview provided.'}</td>
                  </tr>
                  {(room.items || []).map((item) => (
                    <tr key={item.id} className="border-b border-black hover:bg-gray-50">
                      <td className="border-r border-black p-2 align-top text-black">{item.name}</td>
                      <td className="border-r border-black p-1 text-center align-top text-green-700 font-bold">{formatChecklistValue(item.cleanlinessCategory === 'clean')}</td>
                      <td className="border-r border-black p-1 text-center align-top text-green-700 font-bold">{formatChecklistValue(['intact', 'minor_wear'].includes(item.conditionCategory))}</td>
                      <td className="border-r border-black p-1 text-center align-top text-green-700 font-bold">{formatChecklistValue(['operation_confirmed', 'appears_operational'].includes(item.workingStatus))}</td>
                      <td className="p-2 align-top text-black">{item.comment || 'Refer to overall commentary.'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <div className="p-10 page-break">
        <div className="bg-gray-200 border border-black px-2 py-1 font-bold mb-4 text-sm">{showExitSection ? 'Exit Condition Report Notes' : `${reportTitle} Notes`}</div>

        {showExitSection && (
          <div className="mb-6">
            <h3 className="font-bold text-sm mb-4">Approximate dates when work last done on residential premises</h3>
            <div className="space-y-2 text-sm">
              {['Painting of premises (external)', 'Painting of premises (internal)', 'Floorcoverings laid', 'Floorcoverings professionally cleaned'].map((label) => (
                <div key={label} className="flex items-center">
                  <div className="w-1/3">{label}:</div>
                  <div className="w-2/3 border border-black h-8 flex items-center justify-center bg-white"> / / </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-8">
          <div className="font-bold text-sm mb-1">Additional Comments</div>
          <div className="border border-black h-24 w-full"></div>
        </div>

        <div className="bg-gray-200 border border-black px-2 py-1 font-bold mb-0 text-sm">Agent Signature</div>
        <div className="border border-black border-t-0 p-4 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span>Print Name:</span>
            <div className="border border-black px-4 py-2 min-w-[200px]">{data.agentName}</div>
          </div>
          <div className="flex items-center gap-2 flex-grow">
            <span>Signature:</span>
            <div className="border border-black h-10 flex-grow font-script text-2xl px-2"><span style={{ fontFamily: 'cursive' }}>{data.agentName.split(' ')[0]}</span></div>
          </div>
          <div className="flex items-center gap-2">
            <span>Date:</span>
            <div className="border border-black px-4 py-2 min-w-[150px]">{formatDate(data.inspectionDate)}</div>
          </div>
        </div>

        <div className="mt-8 text-[10px] text-justify leading-tight">
          <p className="font-bold mb-1">DISCLAIMER:</p>
          <p>
            This tenancy inspection report is a visual inspection intended to document observed condition only. It does not replace specialist advice on structural, electrical, plumbing, gas, glazing, smoke alarm, or pool safety compliance matters. Furniture, personal belongings, enclosed cavities, and concealed building elements are outside the scope of this report unless specifically accessed and recorded.
          </p>
        </div>

        <div className="text-right font-bold text-sm mt-8">{getReportFooterLabel(data.reportType)}</div>
      </div>

      {allPhotos.length > 0 && (
        <div className="p-10 page-break">
          <div className="bg-gray-200 border border-black px-2 py-1 font-bold mb-4 text-sm">Agent Inspection Photos ({totalPhotos} photos)</div>
          <div className="grid grid-cols-3 gap-4">
            {allPhotos.map((photo) => (
              <div key={photo.id} className="mb-4 avoid-break">
                <div className="text-[10px] font-bold mb-1 uppercase">{photo.roomName}: Overall (photo {photo.roomIndex} of {photo.totalInRoom})</div>
                <div className="w-full aspect-[4/3] bg-gray-100 border border-gray-300 relative">
                  <img src={photo.previewUrl} className="w-full h-full object-cover" alt={`${photo.roomName} inspection`} />
                </div>
                <div className="text-[9px] text-right text-gray-500 mt-0.5">{formatDate(data.inspectionDate)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PDFPreview;
