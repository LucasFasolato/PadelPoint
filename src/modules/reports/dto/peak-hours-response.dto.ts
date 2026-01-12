export class PeakHourBucketDto {
  dow!: number; // 0=Sun .. 6=Sat (Postgres DOW)
  weekday!: string; // "Sun".."Sat"
  time!: string; // "HH:MM"
  count!: number; // reservations count
  revenue!: number; // sum(precio) if enabled, else 0
}

export class PeakHoursReportDto {
  clubId!: string;
  month!: string;
  includeHolds!: boolean;

  top!: PeakHourBucketDto[]; // sorted by count desc, revenue desc

  // Optional: a compact heatmap-like structure for UI
  matrix!: Array<{
    dow: number;
    weekday: string;
    buckets: Array<{
      time: string;
      count: number;
      revenue: number;
    }>;
  }>;
}
