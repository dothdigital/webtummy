import { AsyncLocalStorage } from "node:async_hooks";

export type CommercialRequestContext = {
  workspaceId: string;
  clientId: string;
  planCode?: string | null;
  userId: string;
  projectId?: string | null;
  websiteId?: string | null;
  featureKey: string;
  actionKey: string;
  requestId: string;
  usageEventId?: string | null;
  manualUsageReservation?: boolean;
  usageSequence?: number;
  providerModel?: string | null;
  inputTokens?: number;
  outputTokens?: number;
};

const storage = new AsyncLocalStorage<CommercialRequestContext>();

export function runCommercialRequestContext<T>(context: CommercialRequestContext, action: () => T) {
  return storage.run(context, action);
}

export function currentCommercialRequestContext() {
  return storage.getStore();
}
