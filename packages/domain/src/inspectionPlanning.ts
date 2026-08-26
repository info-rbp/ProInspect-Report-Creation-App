export interface PlanningWindow { startAt: string; endAt: string; }
export interface RouteTravelEstimate { fromStopId?: string; toStopId: string; distanceMetres: number; durationSeconds: number; }
export interface InspectionRouteStop { id: string; inspectionJobId: string; propertyId: string; address: string; latitude?: number; longitude?: number; durationMinutes: number; window?: PlanningWindow; scheduledStartAt?: string; scheduledEndAt?: string; accessNotes?: string; keyRequired?: boolean; }

export interface InspectionRoutePlan {
  id: string;
  agencyId: string;
  name?: string;
  inspectorId: string;
  serviceDate: string;
  timezone: string;
  status: 'draft' | 'proposed' | 'published' | 'completed' | 'cancelled';
  stops: InspectionRouteStop[];
  travel: RouteTravelEstimate[];
  optimisationProvider?: string;
  optimisationRunId?: string;
  totalDistanceMetres?: number;
  totalTravelSeconds?: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
