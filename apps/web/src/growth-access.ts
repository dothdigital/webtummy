export function growthAccess(input: { foundationReady: boolean; intelligenceReady: boolean; strategyApproved: boolean; hasBlueprint: boolean }) {
  const canRun = input.foundationReady && input.intelligenceReady && input.strategyApproved;
  return { canRun, canView: canRun || (input.strategyApproved && input.hasBlueprint) };
}
