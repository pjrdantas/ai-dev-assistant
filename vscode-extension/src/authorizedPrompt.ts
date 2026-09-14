import { AuthorizedAiRequest } from './contracts.js';

export function buildAuthorizedPrompt(request: AuthorizedAiRequest): string {
  const sections = [
    'Você é um assistente de desenvolvimento. Responda somente à solicitação abaixo com uma solução técnica completa e objetiva.',
    `Solicitação:\n${request.prompt}`,
    `Contexto técnico autorizado:\n${JSON.stringify(request.technicalContext)}`,
  ];
  if (request.reusableSolution !== undefined) {
    sections.push(
      `Solução local reutilizável:\n${request.reusableSolution}`,
      'Adapte e complete essa solução; não descarte partes compatíveis sem necessidade.',
    );
  }
  if (request.requiredAdaptations.length > 0) {
    sections.push(
      `Adaptações necessárias:\n${request.requiredAdaptations.map((item) => `- ${item}`).join('\n')}`,
    );
  }
  return sections.join('\n\n');
}
