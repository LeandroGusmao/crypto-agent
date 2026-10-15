export type PaperFill = {
  orderId: string;
  mint: string;
  side: 'buy' | 'sell';
  tokenUnits: string;
  usdcUnits: string;
  feeUSDCUnits: string;
  observedAt: string;
  source: 'fixture';
};

export type PaperPosition = {
  mint: string;
  tokenUnits: string;
  costBasisUSDCUnits: string;
  status: 'open' | 'closed';
};

export type FixtureIntent = {
  orderId: string;
  mint: string;
  side: 'buy' | 'sell';
  inputUnits: string;
  expectedNetOutputUnits: string;
  decidedAt: string;
};

export type FixtureQuote = {
  source: 'fixture';
  evidenceClass: 'modeled' | 'quote_only' | 'unsupported';
  mint: string;
  side: 'buy' | 'sell';
  inputUnits: string;
  netOutputUnits: string;
  feeUSDCUnits: string;
  observedAt: string;
};

export type ExecutionOutcome = {
  orderId: string;
  status: 'filled' | 'unfilled';
  reason: string | null;
};
