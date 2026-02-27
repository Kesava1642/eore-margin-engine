import prisma from "../db.server";

export async function logDecision({
  storeId,
  type,
  payloadJson,
  recommendationJson,
  plannedAction,
  expectedImpact,
  reviewDate,
  createdBy,
}) {
  return prisma.decision.create({
    data: {
      storeId,
      type,
      payloadJson,
      recommendationJson,
      plannedAction,
      expectedImpact,
      reviewDate,
      createdBy,
    },
  });
}

export async function listDecisions(storeId, { limit = 100 } = {}) {
  return prisma.decision.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actions: true,
    },
  });
}

export async function addDecisionAction({
  decisionId,
  actionType,
  notes,
  status,
  reviewDate,
  outcomeNotes,
}) {
  return prisma.decisionAction.create({
    data: {
      decisionId,
      actionType,
      notes,
      status,
      reviewDate,
      outcomeNotes,
    },
  });
}

export async function updateDecisionStatus(decisionId, { status, applied }) {
  return prisma.decision.update({
    where: { id: decisionId },
    data: {
      status,
      applied,
    },
  });
}

