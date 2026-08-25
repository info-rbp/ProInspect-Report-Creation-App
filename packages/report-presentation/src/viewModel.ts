export interface PresentationPhotoReference {
  photoId: string;
  caption?: string;
  sequence?: number;
}

export interface PresentationComponentInput {
  id: string;
  component?: string;
  name?: string;
  conditionCategory?: string;
  cleanlinessCategory?: string;
  workingStatus?: string;
  testStatus?: string;
  commentary?: string;
  comment?: string;
  defects?: string[];
  maintenanceRequired?: boolean;
  comparisonStatus?: string;
  comparisonCommentary?: string;
  baselineEvidencePhotoIds?: string[];
  currentEvidencePhotoIds?: string[];
  photoReferences?: PresentationPhotoReference[];
}

export interface PresentationAreaInput {
  id: string;
  name: string;
  overallCommentary?: string;
  overallComment?: string;
  photoReferences?: PresentationPhotoReference[];
  components: PresentationComponentInput[];
}

export interface PresentationReportInput {
  reportId: string;
  reportVersionId?: string;
  reportType: string;
  propertyAddress: string;
  inspectionDate?: string;
  clientName?: string;
  tenantName?: string;
  inspectorName?: string;
  agencyName?: string;
  areas: PresentationAreaInput[];
}

export interface PresentationComponentView {
  id: string;
  label: string;
  condition: string;
  cleanliness: string;
  working: string;
  test: string;
  commentary: string;
  defects: string[];
  exception: boolean;
  maintenanceRequired: boolean;
  comparisonStatus?: string;
  comparisonCommentary?: string;
  photos: PresentationPhotoReference[];
}

export interface PresentationAreaView {
  id: string;
  name: string;
  commentary: string;
  components: PresentationComponentView[];
  exceptions: PresentationComponentView[];
  photos: PresentationPhotoReference[];
}

export interface ReportExecutiveSummary {
  areaCount: number;
  componentCount: number;
  exceptionCount: number;
  maintenanceCount: number;
  conditionExceptionCount: number;
  cleaningExceptionCount: number;
  operationalExceptionCount: number;
  unableToConfirmCount: number;
  photoReferenceCount: number;
}

export interface ReportPresentationViewModel {
  identity: {
    reportId: string;
    reportVersionId?: string;
    reportType: string;
  };
  title: string;
  propertyAddress: string;
  inspectionDate?: string;
  clientName?: string;
  tenantName?: string;
  inspectorName?: string;
  agencyName?: string;
  isRoutine: boolean;
  isExit: boolean;
  summary: ReportExecutiveSummary;
  areas: PresentationAreaView[];
  maintenanceFindings: Array<{ areaId: string; areaName: string; component: PresentationComponentView }>;
  comparisonFindings: Array<{ areaId: string; areaName: string; component: PresentationComponentView }>;
}

function text(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function isConditionException(value: string): boolean {
  return ['repair_required', 'replacement_recommended', 'damaged', 'unable_to_confirm', 'not_visible', 'partially_visible'].includes(value);
}

function isCleaningException(value: string): boolean {
  return ['requires_cleaning', 'stained', 'heavy_soiling', 'unable_to_confirm'].includes(value);
}

function isOperationalException(working: string, test: string): boolean {
  return ['not_working', 'unable_to_confirm'].includes(working) || ['tested_failed', 'unable_to_confirm'].includes(test);
}

function titleFor(reportType: string): string {
  const value = reportType.toLowerCase();
  if (value.includes('routine')) return 'Routine Inspection Report';
  if (value.includes('exit')) return 'Exit Inspection Report';
  if (value.includes('comparison')) return 'Inspection Comparison Report';
  if (value.includes('maintenance') || value.includes('follow')) return 'Maintenance / Follow-Up Report';
  return 'Property Condition Report';
}

function sortPhotos(photos: PresentationPhotoReference[] | undefined): PresentationPhotoReference[] {
  return [...(photos ?? [])].sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) || left.photoId.localeCompare(right.photoId));
}

export function buildReportPresentationViewModel(input: PresentationReportInput): ReportPresentationViewModel {
  const isRoutine = input.reportType.toLowerCase().includes('routine');
  const isExit = input.reportType.toLowerCase().includes('exit');
  let conditionExceptionCount = 0;
  let cleaningExceptionCount = 0;
  let operationalExceptionCount = 0;
  let unableToConfirmCount = 0;
  let maintenanceCount = 0;
  let photoReferenceCount = 0;
  let componentCount = 0;
  const maintenanceFindings: ReportPresentationViewModel['maintenanceFindings'] = [];
  const comparisonFindings: ReportPresentationViewModel['comparisonFindings'] = [];

  const areas: PresentationAreaView[] = input.areas.map((area) => {
    const areaPhotos = sortPhotos(area.photoReferences);
    photoReferenceCount += areaPhotos.length;
    const components = area.components.map((component): PresentationComponentView => {
      componentCount += 1;
      // Missing assessment fields mean the inspector has not assessed the component yet.
      // They are deliberately distinct from an explicit "unable_to_confirm" judgement,
      // which is a completed assessment state and therefore a report exception.
      const condition = text(component.conditionCategory, 'unassessed');
      const cleanliness = text(component.cleanlinessCategory, 'unassessed');
      const working = text(component.workingStatus, 'unassessed');
      const test = text(component.testStatus, 'unassessed');
      const conditionException = isConditionException(condition);
      const cleaningException = isCleaningException(cleanliness);
      const operationalException = isOperationalException(working, test);
      if (conditionException) conditionExceptionCount += 1;
      if (cleaningException) cleaningExceptionCount += 1;
      if (operationalException) operationalExceptionCount += 1;
      if ([condition, cleanliness, working, test].includes('unable_to_confirm')) unableToConfirmCount += 1;
      if (component.maintenanceRequired) maintenanceCount += 1;
      const photos = sortPhotos(component.photoReferences);
      photoReferenceCount += photos.length;
      const view: PresentationComponentView = {
        id: component.id,
        label: text(component.component ?? component.name, component.id),
        condition,
        cleanliness,
        working,
        test,
        commentary: text(component.commentary ?? component.comment, 'No component commentary recorded.'),
        defects: [...(component.defects ?? [])],
        exception: conditionException || cleaningException || operationalException || Boolean(component.maintenanceRequired) || Boolean(component.defects?.length),
        maintenanceRequired: Boolean(component.maintenanceRequired),
        ...(component.comparisonStatus ? { comparisonStatus: component.comparisonStatus } : {}),
        ...(component.comparisonCommentary ? { comparisonCommentary: component.comparisonCommentary } : {}),
        photos,
      };
      if (view.maintenanceRequired) maintenanceFindings.push({ areaId: area.id, areaName: area.name, component: view });
      if (view.comparisonStatus && view.comparisonStatus !== 'not_compared' && view.comparisonStatus !== 'unchanged' && view.comparisonStatus !== 'no_material_change') {
        comparisonFindings.push({ areaId: area.id, areaName: area.name, component: view });
      }
      return view;
    });
    return {
      id: area.id,
      name: area.name,
      commentary: text(area.overallCommentary ?? area.overallComment, 'No area overview commentary recorded.'),
      components,
      exceptions: components.filter((component) => component.exception),
      photos: areaPhotos,
    };
  });

  const exceptionCount = areas.reduce((count, area) => count + area.exceptions.length, 0);
  return {
    identity: {
      reportId: input.reportId,
      ...(input.reportVersionId ? { reportVersionId: input.reportVersionId } : {}),
      reportType: input.reportType,
    },
    title: titleFor(input.reportType),
    propertyAddress: input.propertyAddress,
    ...(input.inspectionDate ? { inspectionDate: input.inspectionDate } : {}),
    ...(input.clientName ? { clientName: input.clientName } : {}),
    ...(input.tenantName ? { tenantName: input.tenantName } : {}),
    ...(input.inspectorName ? { inspectorName: input.inspectorName } : {}),
    ...(input.agencyName ? { agencyName: input.agencyName } : {}),
    isRoutine,
    isExit,
    summary: {
      areaCount: areas.length,
      componentCount,
      exceptionCount,
      maintenanceCount,
      conditionExceptionCount,
      cleaningExceptionCount,
      operationalExceptionCount,
      unableToConfirmCount,
      photoReferenceCount,
    },
    areas,
    maintenanceFindings,
    comparisonFindings,
  };
}
