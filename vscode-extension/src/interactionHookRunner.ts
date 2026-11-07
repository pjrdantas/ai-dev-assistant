import { MongoClient } from 'mongodb';
import { readUtf8WithinLimit } from './boundedInput.js';

import { interactionFromUserPrompt, UserPromptSubmitInput } from './interactionCapture.js';
import { TranscriptResponseExtractor } from './transcriptResponseExtractor.js';
import { loadMongoHookConfiguration, MongoHookConfigurationError } from './mongoHookConfiguration.js';

export const MAX_STDIN_BYTES = 1 * 1024 * 1024;

interface StopInput { readonly hook_event_name: 'Stop'; readonly session_id?: string; readonly transcript_path?: string; readonly timestamp?: string; }

async function main(): Promise<void> {
  try {
    const input = JSON.parse(await readStdin()) as UserPromptSubmitInput | StopInput;
    if (input.hook_event_name !== 'UserPromptSubmit' && input.hook_event_name !== 'Stop') return;
    const configuration = await loadMongoHookConfiguration(mongoConfigurationArgument());
    const client = new MongoClient(configuration.uri, { serverSelectionTimeoutMS: 1_500, connectTimeoutMS: 1_500, appName: 'AI Dev Assistant Hook' });
    try {
      await client.connect();
      const interactions = client.db(configuration.database).collection('interactions');
      if (input.hook_event_name === 'UserPromptSubmit') {
        if (typeof input.prompt !== 'string') return;
        const interaction = interactionFromUserPrompt(input);
        await interactions.updateOne({ interactionId: interaction.interactionId }, { $setOnInsert: interaction }, { upsert: true });
        return;
      }
      if (input.session_id === undefined) return;
      const extracted = await new TranscriptResponseExtractor().extractFinalAssistantResponse(input.transcript_path);
      const completedAt = input.timestamp === undefined ? new Date() : new Date(input.timestamp);
      const update = extracted.kind === 'FOUND'
        ? { $set: { status: 'COMPLETED', response: extracted.response, completedAt, promotionStatus: 'PENDING', metadata: { captureSource: 'STOP_TRANSCRIPT' } } }
        : { $set: { status: 'RESPONSE_UNAVAILABLE', completedAt, promotionStatus: 'SKIPPED', promotionReason: extracted.reason, metadata: { captureSource: 'STOP_TRANSCRIPT' } } };
      await interactions.findOneAndUpdate({ sessionId: input.session_id, status: 'PENDING' }, update, { sort: { createdAt: -1 }, returnDocument: 'after' });
    } finally { await client.close(); }
  } catch (error) {
    process.stderr.write(`AI Dev Assistant interaction capture unavailable: ${error instanceof MongoHookConfigurationError ? error.message : 'MongoDB indisponível.'}\n`);
  }
}

function readStdin(): Promise<string> {
  return readUtf8WithinLimit(process.stdin, MAX_STDIN_BYTES);
}

function mongoConfigurationArgument(): string {
  const index = process.argv.indexOf('--mongo-config');
  const argument = index >= 0 ? process.argv[index + 1] : undefined;
  if (argument === undefined || argument.startsWith('--')) {
    throw new MongoHookConfigurationError('O runner exige --mongo-config com um caminho explícito.');
  }
  return argument;
}

void main().finally(() => { process.stdout.write('{"continue":true}\n'); });
