export type SummaryTopCourtDto = {
  courtId: string;
  courtName: string;
  value: number; // revenue o occupancyPct, según el bloque
};

export type SummaryPeakDto = {
  dow: number;
  weekday: string;
  time: string; // HH:MM
  count: number;
  revenue?: number;
};

export class SummaryResponseDto {
  clubId!: string;
  month!: string;
  includeHolds!: boolean;

  range!: { from: string; to: string }; // YYYY-MM-DD

  revenue!: {
    totalRevenue: number;
    confirmedCount: number;
    topCourtByRevenue: SummaryTopCourtDto | null;
  };

  occupancy!: {
    availableMinutes: number;
    blockedMinutes: number;
    bookableMinutes: number;
    occupiedMinutes: number;
    occupancyPct: number;
    topCourtByOccupancy: SummaryTopCourtDto | null;
  };

  peak!: {
    top: SummaryPeakDto | null;
  };
}
