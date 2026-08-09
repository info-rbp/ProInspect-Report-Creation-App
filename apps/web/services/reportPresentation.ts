import { InspectionItem } from '../types';

export const ENTRY_REPORT_TYPE = 'Property Condition Report';
export const ROUTINE_REPORT_TYPE = 'Routine Inspection';
export const EXIT_REPORT_TYPE = 'Exit Inspection';

export const supportsComparison = (reportType: string): boolean => (
  reportType === ROUTINE_REPORT_TYPE || reportType === EXIT_REPORT_TYPE
);

export const isExitReport = (reportType: string): boolean => reportType === EXIT_REPORT_TYPE;

export const getReportDisplayTitle = (reportType: string): string => {
  switch (reportType) {
    case ROUTINE_REPORT_TYPE:
      return 'Routine Inspection Report';
    case EXIT_REPORT_TYPE:
      return 'Exit Condition Report';
    case ENTRY_REPORT_TYPE:
    default:
      return 'Property Condition Report';
  }
};

export const getReportFooterLabel = (reportType: string): string => {
  return isExitReport(reportType) ? 'End of Tenancy Report' : getReportDisplayTitle(reportType);
};

export const getAggregateRoomStatus = (items: InspectionItem[]) => {
  if (!items || items.length === 0) {
    return {
      allClean: false,
      allIntact: false,
      issuesCount: 0,
      maintenanceCount: 0,
      untestedCount: 0,
      isClean: null,
      isUndamaged: null,
      isWorking: null,
    };
  }

  const issuesCount = items.filter(
    (i) =>
      ['repair_required', 'replacement_recommended'].includes(i.conditionCategory) ||
      ['requires_cleaning', 'heavy_soiling'].includes(i.cleanlinessCategory) ||
      i.workingStatus === 'not_working' ||
      i.maintenanceRequired ||
      (i.defects && i.defects.length > 0)
  ).length;

  const maintenanceCount = items.filter((i) => i.maintenanceRequired).length;
  const untestedCount = items.filter(
    (i) => i.workingStatus === 'untested' || i.testStatus === 'untested' || i.conditionCategory === 'unable_to_confirm'
  ).length;

  const allClean = items.every((i) => i.cleanlinessCategory === 'clean');
  const allIntact = items.every((i) => ['intact', 'minor_wear'].includes(i.conditionCategory));

  return {
    allClean,
    allIntact,
    issuesCount,
    maintenanceCount,
    untestedCount,
    isClean: allClean,
    isUndamaged: allIntact,
    isWorking: items.every((i) => i.workingStatus === 'operation_confirmed' || i.workingStatus === 'not_applicable'),
  };
};

export const formatChecklistValue = (value: boolean | null): string => {
  if (value === null) {
    return '';
  }

  return value ? 'Y' : 'N';
};
