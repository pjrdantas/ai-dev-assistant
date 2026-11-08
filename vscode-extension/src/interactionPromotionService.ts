import { randomUUID } from 'node:crypto';
import { LocalMemoryService, WorkspaceChangedError } from './localMemoryService.js';
import { MAX_PROMOTION_ATTEMPTS, MongoInteractionStore } from './mongoInteractionStore.js';
import { WorkspaceOrigin, resolveWorkspaceOrigin } from './interactionCapture.js';

export const MAX_PENDING_PROMOTIONS_PER_RUN = 3;

export type PromotionQualityDecision =
  | { readonly status: 'VALID' }
  | { readonly status: 'INCOMPLETE' | 'REJECTED' | 'UNAVAILABLE'; readonly reason: string };

export type PromotionQualityGate = (interaction: { readonly originalRequest: string; readonly response?: string }) => PromotionQualityDecision;

function defaultPromotionQualityGate(interaction: { readonly originalRequest: string; readonly response?: string }): PromotionQualityDecision {
  const response = interaction.response?.trim();
  if (response === undefined || response === '') return { status: 'UNAVAILABLE', reason: 'RESPONSE_UNAVAILABLE' };
  if (response.length < 8 || /(?:\.\.\.|…)$/.test(response)) return { status: 'INCOMPLETE', reason: 'RESPONSE_INCOMPLETE' };
  if (/^(?:não posso|nao posso|não sei|nao sei|não tenho como|nao tenho como)\b/iu.test(response)) return { status: 'REJECTED', reason: 'RESPONSE_REJECTED' };
  return { status: 'VALID' };
}

/** Promotes completed technical history locally; it never invokes a language model. */
export class InteractionPromotionService {
  public constructor(
    private readonly interactions: MongoInteractionStore,
    private readonly memory: LocalMemoryService,
    private readonly currentWorkspaceKeys: () => readonly string[],
    private readonly currentWorkspaceOrigins?: () => readonly WorkspaceOrigin[],
    private readonly qualityGate: PromotionQualityGate = defaultPromotionQualityGate,
  ) {}

  public async promotePending(limit = MAX_PENDING_PROMOTIONS_PER_RUN): Promise<void> {
    const owner = randomUUID();
    const workspaceKeys = this.currentWorkspaceKeys();
    const origins = this.currentWorkspaceOrigins?.() ?? [];
    const claimed = origins.length > 0
      ? await this.interactions.claimCompletedForPromotionInWorkspaceOrigins(limit, origins, owner)
      : await this.interactions.claimCompletedForPromotionInWorkspaces(limit, workspaceKeys, owner);
    for (const interaction of claimed) {
      const resolvedOrigin = origins.length > 0 ? resolveWorkspaceOrigin(interaction.cwd, origins) : undefined;
      const originKey = origins.length > 0 && interaction.cwd !== undefined
        ? resolvedOrigin?.workspaceKey
        : resolvedOrigin?.workspaceKey ?? interaction.workspaceKey;
      if (originKey === undefined || !this.currentWorkspaceKeys().includes(originKey)) {
        await this.interactions.releasePromotion(interaction.interactionId, 'WORKSPACE_CHANGED_OR_UNAVAILABLE', owner, MAX_PROMOTION_ATTEMPTS);
        continue;
      }
      if (isCasual(interaction.originalRequest) || interaction.response === undefined) {
        await this.interactions.finishPromotion(interaction.interactionId, 'SKIPPED', 'NOT_TECHNICAL_OR_EMPTY', owner);
        continue;
      }
      const quality = this.qualityGate(interaction);
      if (quality.status !== 'VALID') {
        await this.interactions.finishPromotion(interaction.interactionId, 'SKIPPED', quality.reason, owner);
        continue;
      }
      try {
        const saved = await this.memory.save(interaction.originalRequest, interaction.response, originKey);
        if (saved.memoryUnavailable) {
          await this.interactions.releasePromotion(interaction.interactionId, 'MONGO_UNAVAILABLE', owner, MAX_PROMOTION_ATTEMPTS);
        } else {
          await this.interactions.finishPromotion(interaction.interactionId, 'PROMOTED', 'LOCAL_MEMORY_SAVE', owner);
        }
      } catch (error) {
        if (error instanceof WorkspaceChangedError) {
          await this.interactions.releasePromotion(interaction.interactionId, 'WORKSPACE_CHANGED_OR_UNAVAILABLE', owner, MAX_PROMOTION_ATTEMPTS);
          continue;
        }
        await this.interactions.finishPromotion(interaction.interactionId, 'SKIPPED', 'NOT_REUSABLE_OR_SENSITIVE', owner);
      }
    }
  }
}

function isCasual(prompt: string): boolean { return /^(oi|olá|ola|bom dia|boa tarde|boa noite|obrigad[oa]|teste)[!,.\s]*$/iu.test(prompt.trim()); }
