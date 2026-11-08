import { MongoClient, MongoClientOptions } from 'mongodb';

export class BenchmarkMongoUriError extends Error {
  public constructor(message: string) {
    super(`AUD-10: ${message}`);
    this.name = 'BenchmarkMongoUriError';
  }
}

export type BenchmarkMongoClientFactory = (uri: string, options: MongoClientOptions) => MongoClient;

/** Validates the benchmark target without resolving or connecting to it. */
export function validateBenchmarkMongoUri(candidate: string | undefined): string {
  const uri = candidate?.trim();
  if (uri === undefined || uri.length === 0 || !uri.startsWith('mongodb://')) {
    throw new BenchmarkMongoUriError('MONGODB_URI deve ser uma URI mongodb:// explícita.');
  }

  const authority = uri.slice('mongodb://'.length).split(/[/?#]/, 1)[0] ?? '';
  const hostList = authority.slice(authority.lastIndexOf('@') + 1).split(',');
  if (hostList.length !== 1 || hostList[0] === undefined || hostList[0].length === 0) {
    throw new BenchmarkMongoUriError('a URI deve apontar para exatamente um host.');
  }

  const parsed = parseHostPort(hostList[0]);
  if (parsed === undefined) {
    throw new BenchmarkMongoUriError('a URI deve conter uma porta explícita válida.');
  }
  if (!isLoopback(parsed.host)) {
    throw new BenchmarkMongoUriError('o host deve ser loopback (127.0.0.0/8 ou ::1).');
  }
  if (parsed.port === 27017) {
    throw new BenchmarkMongoUriError('a porta 27017 é proibida; use uma instância efêmera exclusiva.');
  }

  let parsedUri: URL;
  try {
    parsedUri = new URL(uri);
  } catch {
    throw new BenchmarkMongoUriError('a URI MongoDB é inválida.');
  }
  const options = new Map<string, string>();
  for (const [key, value] of parsedUri.searchParams) options.set(key.toLowerCase(), value.toLowerCase());
  if (options.get('directconnection') !== 'true') {
    throw new BenchmarkMongoUriError('a URI deve exigir directConnection=true para impedir redirecionamentos.');
  }
  for (const option of ['replicaset', 'loadbalanced', 'srvservicename', 'srvmaxhosts', 'proxyhost']) {
    if (options.has(option)) throw new BenchmarkMongoUriError(`a opção ${option} é incompatível com isolamento efêmero.`);
  }
  if (options.get('loadbalanced') === 'true') {
    throw new BenchmarkMongoUriError('loadBalanced=true é incompatível com isolamento efêmero.');
  }
  return uri;
}

export function createBenchmarkMongoClient(uri: string, factory: BenchmarkMongoClientFactory = (value, options) => new MongoClient(value, options)): MongoClient {
  const validatedUri = validateBenchmarkMongoUri(uri);
  return factory(validatedUri, { monitorCommands: true, appName: 'AI Dev Assistant benchmark AUD-10' });
}

function parseHostPort(hostEntry: string): { host: string; port: number } | undefined {
  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(hostEntry);
  const unbracketed = /^([^:]+):(\d+)$/.exec(hostEntry);
  const host = bracketed?.[1] ?? unbracketed?.[1];
  const portText = bracketed?.[2] ?? unbracketed?.[2];
  if (host === undefined || portText === undefined) return undefined;
  const port = Number(portText);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? { host: host.toLowerCase(), port } : undefined;
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || (host.startsWith('127.') && host.split('.').length === 4 && host.split('.').every((part) => /^\d+$/.test(part) && Number(part) <= 255));
}
