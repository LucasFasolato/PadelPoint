export class RevenueByCourtDto {
  courtId!: string;
  courtName!: string;
  revenue!: number;
  count!: number;
}

export class RevenueReportDto {
  clubId!: string;
  from!: string;
  to!: string;
  totalRevenue!: number;
  confirmedCount!: number;
  byCourt!: RevenueByCourtDto[];
}
