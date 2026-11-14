export const PROSPECT_STAGES = [
  "NEW",
  "QUALIFIED",
  "CONVERTED",
  "ARCHIVED",
] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];

export const LEAD_STAGES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "CONVERTED",
  "LOST",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const OPPORTUNITY_STAGES = [
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

const PROSPECT_TRANSITIONS: Record<ProspectStage, readonly ProspectStage[]> = {
  NEW: ["NEW", "QUALIFIED", "ARCHIVED"],
  QUALIFIED: ["QUALIFIED", "CONVERTED", "ARCHIVED"],
  CONVERTED: ["CONVERTED"],
  ARCHIVED: ["ARCHIVED"],
};

const LEAD_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  NEW: ["NEW", "CONTACTED", "QUALIFIED", "LOST"],
  CONTACTED: ["CONTACTED", "QUALIFIED", "LOST"],
  QUALIFIED: ["QUALIFIED", "CONVERTED", "LOST"],
  CONVERTED: ["CONVERTED"],
  LOST: ["LOST"],
};

const OPPORTUNITY_TRANSITIONS: Record<
  OpportunityStage,
  readonly OpportunityStage[]
> = {
  PROPOSAL: ["PROPOSAL", "NEGOTIATION", "WON", "LOST"],
  NEGOTIATION: ["NEGOTIATION", "WON", "LOST"],
  WON: ["WON"],
  LOST: ["LOST"],
};

export function isValidProspectTransition(
  from: ProspectStage,
  to: ProspectStage,
): boolean {
  return PROSPECT_TRANSITIONS[from].includes(to);
}

export function isValidLeadTransition(from: LeadStage, to: LeadStage): boolean {
  return LEAD_TRANSITIONS[from].includes(to);
}

export function isValidOpportunityTransition(
  from: OpportunityStage,
  to: OpportunityStage,
): boolean {
  return OPPORTUNITY_TRANSITIONS[from].includes(to);
}
