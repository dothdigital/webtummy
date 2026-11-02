type RelationshipProject = {
  intakeAnswers?: Array<{ questionKey: string; answerValue: unknown }>;
  notes?: string | null;
};

/** Keep the explicit relationship alongside legacy intake evidence. Product
 * names, domains and the presence of an affiliate programme prove no ownership. */
export function productRelationshipContext(project: RelationshipProject) {
  const answers = project.intakeAnswers ?? [];
  const explicit = answers.find(answer => answer.questionKey === "product_relationship")?.answerValue;
  return {
    relationship: typeof explicit === "string" && explicit.trim() ? explicit.trim() : "Unspecified — do not assume ownership",
    intakeEvidence: answers.filter(answer => ["products_services", "business_description", "primary_goal"].includes(answer.questionKey))
      .map(answer => ({ field: answer.questionKey, value: answer.answerValue })),
    projectNotes: project.notes ?? null,
  };
}
