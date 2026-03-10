// Minimal canonical admin actions that explicitly override match lifecycle state.
export enum MatchAdminOverrideType {
  CONFIRM_RESULT = 'CONFIRM_RESULT',
  REJECT_RESULT = 'REJECT_RESULT',
  VOID_MATCH = 'VOID_MATCH',
}
