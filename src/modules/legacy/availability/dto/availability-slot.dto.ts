export class AvailabilitySlotDto {
  fecha!: string;
  courtId!: string;
  courtNombre!: string;
  ruleId!: string;
  horaInicio!: string;
  horaFin!: string;
  ocupado!: boolean;
  estado!: 'ocupado' | 'libre';
  motivoBloqueo!: string | null;
  reservationId!: string | null;
}
