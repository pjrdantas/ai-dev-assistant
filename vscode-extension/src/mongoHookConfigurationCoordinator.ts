import { MongoConnectionConfiguration } from './mongoConnectionManager.js';
import { MongoHookConfigurationError } from './mongoHookConfiguration.js';

export interface MongoHookConfigurationCoordinatorDependencies {
  readonly readConfiguration: () => MongoConnectionConfiguration;
  readonly getActiveConfiguration: () => MongoConnectionConfiguration;
  readonly isInstalled: () => Promise<boolean>;
  readonly readInstalledConfiguration: () => Promise<MongoConnectionConfiguration>;
  readonly updateConnection: (configuration: MongoConnectionConfiguration) => Promise<void>;
  readonly syncInstalledHook: (configuration: MongoConnectionConfiguration) => Promise<void>;
  readonly disableInstalledHook: () => Promise<boolean>;
  readonly reportIssue?: (message: string) => void;
}

/** Serializes settings and keeps activation reconciliation observational for hooks. */
export class MongoHookConfigurationCoordinator {
  private pending: Promise<void> = Promise.resolve();

  public constructor(private readonly dependencies: MongoHookConfigurationCoordinatorDependencies) {}

  public reconcile(): Promise<void> { return this.enqueue(() => this.reconcileNow()); }

  public enable(): Promise<void> {
    return this.enqueue(async () => {
      const configuration = this.dependencies.readConfiguration();
      const previousConnection = this.dependencies.getActiveConfiguration();
      const wasInstalled = await this.dependencies.isInstalled();
      let previousHook: MongoConnectionConfiguration | undefined;
      try { previousHook = wasInstalled ? await this.dependencies.readInstalledConfiguration() : undefined; }
      catch (error) {
        if (!isMissingHookConfiguration(error)) {
          this.report(`Não foi possível ler o snapshot dos hooks existentes. Nenhum hook foi removido; a captura não foi considerada segura: ${errorMessage(error)}`);
          throw error;
        }
        // This branch is reachable only from the explicitly confirmed enable command.
        // The managed marker is the ownership proof; syncInstalledHook must still be
        // transactional and preserve every existing artifact if repair fails.
        this.report('O snapshot dos hooks gerenciados está ausente. O reparo explícito foi autorizado; os artefatos só serão substituídos pelo instalador gerenciado.');
      }
      let hookSynchronized = false;
      let connectionUpdated = false;
      try {
        if (!wasInstalled) {
          await this.dependencies.syncInstalledHook(configuration);
          hookSynchronized = true;
          await this.dependencies.updateConnection(configuration);
          connectionUpdated = true;
        } else {
          await this.dependencies.updateConnection(configuration);
          connectionUpdated = true;
          await this.dependencies.syncInstalledHook(configuration);
          hookSynchronized = true;
        }
      } catch (error) {
        await this.rollback(previousHook, hookSynchronized, connectionUpdated, error, previousConnection);
        throw error;
      }
    });
  }

  public disable(): Promise<boolean> {
    return this.enqueue(() => this.dependencies.disableInstalledHook());
  }

  private async reconcileNow(): Promise<void> {
    const configuration = this.dependencies.readConfiguration();
    let installed: boolean;
    try {
      installed = await this.dependencies.isInstalled();
    } catch (error) {
      this.report(`Não foi possível identificar o estado dos hooks existentes. Nenhum hook foi alterado e a captura não foi considerada segura: ${errorMessage(error)}`);
      await this.dependencies.updateConnection(configuration);
      return;
    }
    if (!installed) {
      await this.dependencies.updateConnection(configuration);
      return;
    }
    let previousHook: MongoConnectionConfiguration;
    try { previousHook = await this.dependencies.readInstalledConfiguration(); }
    catch (error) {
      this.report(`O marcador dos hooks existe, mas o snapshot está ausente, inválido ou inacessível. Nenhum hook foi removido; a captura não foi considerada segura: ${errorMessage(error)}`);
      await this.dependencies.updateConnection(configuration);
      return;
    }
    if (!sameConfiguration(previousHook, configuration)) {
      this.report(`A configuração dos hooks aponta para um database MongoDB diferente do atual. Nenhum launcher foi sincronizado automaticamente; um hook preexistente pode continuar apontando para o database anterior. Use o comando explícito de habilitação para reparar após confirmação.`);
    }
    await this.dependencies.updateConnection(configuration);
  }

  private async rollback(previousHook: MongoConnectionConfiguration | undefined, hookSynchronized: boolean, connectionUpdated: boolean, originalError: unknown, previousConnection: MongoConnectionConfiguration): Promise<void> {
    try {
      if (hookSynchronized) {
        if (previousHook !== undefined) await this.dependencies.syncInstalledHook(previousHook);
        else await this.dependencies.disableInstalledHook();
      }
      if (connectionUpdated) await this.dependencies.updateConnection(previousConnection);
    } catch (rollbackError) {
      throw new Error(`A configuração MongoDB falhou e o rollback também falhou: ${errorMessage(originalError)}; rollback: ${errorMessage(rollbackError)}`);
    }
  }

  private report(message: string): void { this.dependencies.reportIssue?.(message); }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.pending.then(operation);
    this.pending = current.then(() => undefined, () => undefined);
    return current;
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'erro desconhecido';
  return message.replace(/(mongodb(?:\+srv)?:\/\/)([^\s/@]+):([^\s/@]+)@/gi, '$1<credencial-redigida>@');
}
function isMissingHookConfiguration(error: unknown): boolean {
  return error instanceof MongoHookConfigurationError && error.kind === 'missing';
}
function sameConfiguration(left: MongoConnectionConfiguration, right: MongoConnectionConfiguration): boolean {
  return left.uri === right.uri && left.database === right.database;
}
