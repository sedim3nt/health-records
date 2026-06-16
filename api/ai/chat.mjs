// POST { messages, records } -> { reply } conversational health-records assistant.
import { chat, readJsonBody, sendJson, hasKey } from '../_openrouter.mjs';

const DISCLAIMER =
  'I can help you organize and understand your records, but this is organizational help, not medical advice. For anything about your health or treatment, please consult a licensed clinician.';

const SYSTEM = `You are the assistant inside the Health Records Vault app — a local-first vault where people (and pet owners) collect, request, and organize their own health records.

You help the user in three ways:
1. Answer questions about the records currently in their vault (visits, labs, imaging, medications, providers, dates). Only use the records supplied as context; never invent results, values, or specifics that are not present. If something is not in the records, say so plainly.
2. Help them understand, in plain everyday language, what a result or a visit summary appears to mean. Be careful and conservative: describe what a term generally refers to, but do not diagnose, do not interpret specific numbers as good or bad, and do not recommend treatment.
3. Explain how to use the app: creating events on the timeline, opening and following up on record requests (the request loops), and building shareable packets of documents for a new clinic, an emergency, an appeal, or chronic care.

Style: warm, concise, and clear. Use short paragraphs or tight bullet points. Default to a couple of sentences unless the user asks for more.

Boundary: You are NOT a doctor and this is NOT medical advice. When a user asks whether a result is dangerous, what they should do about their health, dosing, or diagnosis, gently decline to advise and suggest they contact their clinician — while still helping with the organizational side. When it is genuinely relevant (especially any health-interpretation question), include this note: "${DISCLAIMER}"`;

function compactRecords(records) {
  const list = Array.isArray(records) ? records : [];
  return list.slice(0, 60).map((r) => ({
    type: r.recordType,
    date: r.documentDate,
    provider: r.providerName,
    title: r.title,
    text: (r.text || r.ocrText || '').slice(0, 500)
  }));
}

function transcript(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-12)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content).slice(0, 2000)}`)
    .join('\n\n');
}

function lastUserMessage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === 'user' && list[i]?.content) {
      return String(list[i].content);
    }
  }
  return '';
}

function fallback(records, messages) {
  const list = Array.isArray(records) ? records : [];
  const question = lastUserMessage(messages).toLowerCase();

  if (/packet|share|export|new clinic|emergency|appeal/.test(question)) {
    return `Offline mode (no AI key set). To share records, open the Packet builder on the right rail, pick a preset (new clinic, emergency, appeal support, or chronic care), preview the manifest, then export the packet files. ${DISCLAIMER}`;
  }

  if (/request|follow|loop|pending/.test(question)) {
    return `Offline mode (no AI key set). Open request loops live in the "Open request loops" panel and on each timeline event — use "Log request" to start one, "Log follow-up" to nudge, and "Mark received" once a record arrives. ${DISCLAIMER}`;
  }

  if (list.length === 0) {
    return `Offline mode (no AI key set). There are no records in this vault yet, so I can't answer questions about specific results. You can import records or create an event from the left rail. ${DISCLAIMER}`;
  }

  const types = [...new Set(list.map((r) => r.recordType).filter(Boolean))];
  return `Offline mode (no AI key set). This vault holds ${list.length} record${list.length === 1 ? '' : 's'}${
    types.length ? ` (${types.slice(0, 6).join(', ')})` : ''
  }. With an AI key configured I can answer questions about them and explain what they mean in plain language. ${DISCLAIMER}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const records = Array.isArray(body.records) ? body.records : [];

  if (messages.length === 0) {
    return sendJson(res, 400, { error: 'Provide a messages array.' });
  }

  if (!hasKey()) {
    return sendJson(res, 200, { reply: fallback(records, messages) });
  }

  try {
    const compact = compactRecords(records);
    const user = `The user's vault currently holds these records (JSON):

${JSON.stringify(compact, null, 2)}

Conversation so far:

${transcript(messages)}

Reply to the user's most recent message.`;

    const reply = await chat({
      system: SYSTEM,
      user,
      temperature: 0.4,
      maxTokens: 700
    });

    return sendJson(res, 200, { reply: reply.trim() });
  } catch {
    return sendJson(res, 200, { reply: fallback(records, messages) });
  }
}
