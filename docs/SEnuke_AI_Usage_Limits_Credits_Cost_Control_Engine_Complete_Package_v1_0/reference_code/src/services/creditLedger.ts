export interface CreditBalance {
  availableCredits: number;
  usedCredits: number;
  reservedCredits: number;
  cycleEndsAt: Date;
}

const memoryBalances = new Map<string, CreditBalance>();

function getBalanceRef(workspaceId: string): CreditBalance {
  if (!memoryBalances.has(workspaceId)) {
    memoryBalances.set(workspaceId, { availableCredits: 300, usedCredits: 0, reservedCredits: 0, cycleEndsAt: new Date(Date.now() + 7 * 86400000) });
  }
  return memoryBalances.get(workspaceId)!;
}

export async function getCreditBalance(workspaceId: string): Promise<CreditBalance> {
  return { ...getBalanceRef(workspaceId) };
}

export async function reserveCredits(params: { workspaceId: string; amount: number; usageEventId: string; idempotencyKey: string }): Promise<void> {
  const bal = getBalanceRef(params.workspaceId);
  if (bal.availableCredits < params.amount) throw new Error('Insufficient credits');
  bal.availableCredits -= params.amount;
  bal.reservedCredits += params.amount;
  // TODO: insert immutable credit_transactions row type='reserve'.
}

export async function commitReservedCredits(params: { workspaceId: string; reservedAmount: number; actualAmount: number; usageEventId: string }): Promise<void> {
  const bal = getBalanceRef(params.workspaceId);
  bal.reservedCredits -= params.reservedAmount;
  bal.usedCredits += params.actualAmount;
  const refund = params.reservedAmount - params.actualAmount;
  if (refund > 0) bal.availableCredits += refund;
  // TODO: insert debit + optional release/refund transactions.
}

export async function refundReservedCredits(params: { workspaceId: string; amount: number; usageEventId: string; reason: string }): Promise<void> {
  const bal = getBalanceRef(params.workspaceId);
  bal.reservedCredits -= params.amount;
  bal.availableCredits += params.amount;
  // TODO: insert immutable credit_transactions row type='refund'.
}
