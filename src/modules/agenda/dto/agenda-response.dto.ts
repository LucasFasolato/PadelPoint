export type AgendaSlotStatus =
  | 'blocked'
  | 'confirmed'
  | 'hold'
  | 'free'
  | 'occupied';

export class AgendaResponseDto {
  date!: string;
  clubId!: string;

  courts!: Array<{
    courtId: string;
    name: string;
    slots: Array<{
      startAt: string;
      endAt: string;
      status: AgendaSlotStatus;

      reservationId?: string;
      customerName?: string;
      customerPhone?: string;

      blockReason?: string;
    }>;
  }>;
}
