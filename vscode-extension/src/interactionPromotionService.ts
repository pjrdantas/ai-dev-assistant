import { LocalMemoryService } from './localMemoryService.js';
import { MongoInteractionStore } from './mongoInteractionStore.js';

export const MAX_PENDING_PROMOTIONS_PER_RUN = 3;

/** Promotes completed technical history locally; it never invokes a language model. */
export class InteractionPromotionService {
  public constructor(private readonly interactions: MongoInteractionStore, private readonly memory: LocalMemoryService) {}

  public async promotePending(limit = MAX_PENDING_PROMOTIONS_PER_RUN): Promise<void> {
    for (const interaction of await this.interactions.claimCompletedForPromotion(limit)) {
      if (isCasual(interaction.originalRequest) || interaction.response === undefined) {
        await this.interactions.finishPromotion(interaction.interactionId, 'SKIPPED', 'NOT_TECHNICAL_OR_EMPTY');
        continue;
      }
      try {
        const saved = await this.memory.save(interaction.originalRequest, interaction.response);
        await this.interactions.finishPromotion(interaction.interactionId, saved.memoryUnavailable ? 'FAILED' : 'PROMOTED', saved.memoryUnavailable ? 'MONGO_UNAVAILABLE' : 'LOCAL_MEMORY_SAVE');
      } catch {
        await this.interactions.finishPromotion(interaction.interactionId, 'SKIPPED', 'NOT_REUSABLE_OR_SENSITIVE');
      }
    }
  }
}

function isCasual(prompt: string): boolean { return /^(oi|olá|ola|bom dia|boa tarde|boa noite|obrigad[oa]|teste)[!,.\s]*$/iu.test(prompt.trim()); }
