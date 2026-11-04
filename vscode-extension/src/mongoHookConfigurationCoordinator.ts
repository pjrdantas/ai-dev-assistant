import { MongoConnectionConfiguration } from './mongoConnectionManager.js';

export interface MongoHookConfigurationCoordinatorDependencies {
  readonly readConfiguration: () => MongoConnectionConfiguration;
  readonly getActiveConfiguration: () => MongoConnectionConfiguration;
  readonly isInstalled: () => Promise<boolean>;
  readonly readInstalledConfiguration: () => Promise<MongoConnectionConfiguration>;
  readonly updateConnection: (configuration: MongoConnectionConfiguration) => Promise<void>;
  readonly syncInstalledHook: (configuration: MongoConnectionConfiguration) => Promise<void>;
  readonly disableInstalledHook: () => Promise<boolean>;
}

/** Serializes settings and lifecycle operations and never intentionally leaves a live hook on a different database. */
export class MongoHookConfigurationCoordinator {
  private pending: Promise<void> = Promise.resolve();

  public constructor(private readonly dependencies: MongoHookConfigurationCoordinatorDependencies) {}

  public reconcile(): Promise<void> { return this.enqueue(() => this.reconcileNow()); }

  public enable(): Promise<void> {
    return this.enqueue(async () => {
      const configuration = this.dependencies.readConfiguration();
      const wasInstalled = await this.dependencies.isInstalled();
      let previousHook: MongoConnectionConfiguration | undefined;
      try { previousHook = wasInstalled ? await this.dependencies.readInstalledConfiguration() : undefined; }
      catch (error) { await this.dependencies.disableInstalledHook(); throw error; }
      try {
        await this.dependencies.syncInstalledHook(configuration);
        await this.dependencies.updateConnection(configuration);
      } catch (error) {
        await this.rollback(previousHook, wasInstalled, error);
        throw error;
      }
    });
  }

  public disable(): Promise<boolean> {
    return this.enqueue(() => this.dependencies.disableInstalledHook());
  }

  private async reconcileNow(): Promise<void> {
    const configuration = this.dependencies.readConfiguration();
    if (!await this.dependencies.isInstalled()) {
      await this.dependencies.updateConnection(configuration);
      return;
    }
    let previousHook: MongoConnectionConfiguration;
    try { previousHook = await this.dependencies.readInstalledConfiguration(); }
    catch (error) { await this.dependencies.disableInstalledHook(); throw error; }
    const previousConnection = this.dependencies.getActiveConfiguration();
    try {
      await this.dependencies.syncInstalledHook(configuration);
      await this.dependencies.updateConnection(configuration);
    } catch (error) {
      await this.rollback(previousHook, true, error, previousConnection);
      throw error;
    }
  }

  private async rollback(previousHook: MongoConnectionConfiguration | undefined, wasInstalled: boolean, originalError: unknown, previousConnection = this.dependencies.getActiveConfiguration()): Promise<void> {
    try {
      if (wasInstalled && previousHook !== undefined) await this.dependencies.syncInstalledHook(previousHook);
      else await this.dependencies.disableInstalledHook();
      await this.dependencies.updateConnection(previousConnection);
    } catch (rollbackError) {
      await this.dependencies.disableInstalledHook().catch(() => undefined);
      throw new Error(`A configuração MongoDB falhou e o rollback também falhou: ${errorMessage(originalError)}; rollback: ${errorMessage(rollbackError)}`);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.pending.then(operation);
    this.pending = current.then(() => undefined, () => undefined);
    return current;
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'erro desconhecido'; }
