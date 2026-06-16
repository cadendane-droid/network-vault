import prisma from '@/lib/prisma';
import { inngest } from '@/inngest/client';

/**
 * Re-runs the extract → embed pipeline for an existing source.
 *
 * Used to recover sources stuck in 'processing' or 'failed' without the user
 * re-adding the person. Because the extract job always *creates* facts/edges
 * (it does not upsert), any partial writes from a previous run are deleted
 * first so a reprocess cannot duplicate data. The cleanup + status reset runs
 * in a transaction; the pipeline is re-triggered by re-sending the original
 * `vault/person.created` event.
 *
 * Idempotent: safe to call on a stuck, failed, or already-complete source.
 */
export async function reprocessSource(params: {
  sourceId: string;
  personId: string;
  userId: string;
}): Promise<void> {
  const { sourceId, personId, userId } = params;

  await prisma.$transaction(async (tx) => {
    // conversation_participants are FK'd to conversations, so clear them first.
    const convs = await tx.conversation.findMany({
      where: { source_id: sourceId },
      select: { id: true },
    });
    const convIds = convs.map((c) => c.id);
    if (convIds.length > 0) {
      await tx.conversationParticipant.deleteMany({
        where: { conversation_id: { in: convIds } },
      });
    }
    await tx.conversation.deleteMany({ where: { source_id: sourceId } });
    await tx.edge.deleteMany({ where: { source_id: sourceId } });
    await tx.fact.deleteMany({ where: { source_id: sourceId } });
    await tx.source.update({
      where: { id: sourceId },
      data: { processing_status: 'processing' },
    });
  });

  await inngest.send({
    name: 'vault/person.created',
    data: { person_id: personId, source_id: sourceId, user_id: userId },
  });
}
