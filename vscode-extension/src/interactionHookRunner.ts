import { MongoClient } from 'mongodb';

import { interactionFromUserPrompt, UserPromptSubmitInput } from './interactionCapture.js';
import { TranscriptResponseExtractor } from './transcriptResponseExtractor.js';

interface StopInput { readonly hook_event_name: 'Stop'; readonly session_id?: string; readonly transcript_path?: string; readonly timestamp?: string; }

async function main(): Promise<void> {
  try {
    const input = JSON.parse(await readStdin()) as UserPromptSubmitInput | StopInput;
    if (input.hook_event_name !== 'UserPromptSubmit' && input.hook_event_name !== 'Stop') return;
    const client = new MongoClient(process.env.AI_DEV_ASSISTANT_MONGODB_URI ?? 'mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 1_500, connectTimeoutMS: 1_500, appName: 'AI Dev Assistant Hook' });
    try {
      await client.connect();
      const interactions = client.db(process.env.AI_DEV_ASSISTANT_MONGODB_DATABASE ?? 'ai_dev_assistant').collection('interactions');
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
    process.stderr.write(`AI Dev Assistant interaction capture unavailable: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  }
}

function readStdin(): Promise<string> { return new Promise((resolve, reject) => { let data = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => { data += chunk; }); process.stdin.on('end', () => resolve(data)); process.stdin.on('error', reject); }); }

void main().finally(() => { process.stdout.write('{"continue":true}\n'); });
