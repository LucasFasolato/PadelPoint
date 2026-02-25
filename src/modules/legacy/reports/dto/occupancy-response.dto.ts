export class OccupancyByCourtDto {
  courtId!: string;
  courtName!: string;

  availableMinutes!: number; // from rules
  blockedMinutes!: number; // overrides
  bookableMinutes!: number; // available - blocked
  occupiedMinutes!: number; // reservations
  occupancyPct!: number; // 0..100
}

export class OccupancyReportDto {
  clubId!: string;
  month!: string;

  totals!: {
    availableMinutes: number;
    blockedMinutes: number;
    bookableMinutes: number;
    occupiedMinutes: number;
    occupancyPct: number;
  };

  byCourt!: OccupancyByCourtDto[];
}
