import { LocalMemoryService, WorkspaceChangedError } from './localMemoryService.js';
import { MongoInteractionStore } from './mongoInteractionStore.js';
import { WorkspaceOrigin, resolveWorkspaceOrigin } from './interactionCapture.js';

export const MAX_PENDING_PROMOTIONS_PER_RUN = 3;

/** Promotes completed technical history locally; it never invokes a language model. */
export class InteractionPromotionService {
  public constructor(
    private readonly interactions: MongoInteractionStore,
    private readonly memory: LocalMemoryService,
    private readonly currentWorkspaceKeys: () => readonly string[],
    private readonly currentWorkspaceOrigins?: () => readonly WorkspaceOrigin[],
  ) {}

  public async promotePending(limit = MAX_PENDING_PROMOTIONS_PER_RUN): Promise<void> {
    const workspaceKeys = this.currentWorkspaceKeys();
    const origins = this.currentWorkspaceOrigins?.() ?? [];
    const claimed = origins.length > 0
      ? await this.interactions.claimCompletedForPromotionInWorkspaceOrigins(limit, origins)
      : await this.interactions.claimCompletedForPromotionInWorkspaces(limit, workspaceKeys);
    for (const interaction of claimed) {
      const resolvedOrigin = origins.length > 0 ? resolveWorkspaceOrigin(interaction.cwd, origins) : undefined;
      const originKey = origins.length > 0 && interaction.cwd !== undefined
        ? resolvedOrigin?.workspaceKey
        : resolvedOrigin?.workspaceKey ?? interaction.workspaceKey;
      if (originKey === undefined || !this.currentWorkspaceKeys().includes(originKey)) {
        await this.interactions.releasePromotion(interaction.interactionId, 'WORKSPACE_CHANGED_OR_UNAVAILABLE');
        continue;
      }
      if (isCasual(interaction.originalRequest) || interaction.response === undefined) {
        await this.interactions.finishPromotion(interaction.interactionId, 'SKIPPED', 'NOT_TECHNICAL_OR_EMPTY');
        continue;
      }
      try {
        const saved = await this.memory.save(interaction.originalRequest, interaction.response, originKey);
        await this.interactions.finishPromotion(interaction.interactionId, saved.memoryUnavailable ? 'FAILED' : 'PROMOTED', saved.memoryUnavailable ? 'MONGO_UNAVAILABLE' : 'LOCAL_MEMORY_SAVE');
      } catch (error) {
        if (error instanceof WorkspaceChangedError) {
          await this.interactions.releasePromotion(interaction.interactionId, 'WORKSPACE_CHANGED_OR_UNAVAILABLE');
          continue;
        }
        await this.interactions.finishPromotion(interaction.interactionId, 'SKIPPED', 'NOT_REUSABLE_OR_SENSITIVE');
      }
    }
  }
}

function isCasual(prompt: string): boolean { return /^(oi|olá|ola|bom dia|boa tarde|boa noite|obrigad[oa]|teste)[!,.\s]*$/iu.test(prompt.trim()); }
