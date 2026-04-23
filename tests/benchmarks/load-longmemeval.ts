// tests/benchmarks/load-longmemeval.ts
//
// Downloads the LongMemEval dataset from HuggingFace and converts it
// into the shape our benchmark runner expects:
//   { name, corpus: [{slug, title, content}], questions: [{query, gold_slugs}] }
//
// Each LongMemEval question has a haystack of session histories +
// gold answers. We treat each session as a "document" and the
// question's gold session ids as the gold slugs.
//
// Usage:
//   npx tsx tests/benchmarks/load-longmemeval.ts \
//     [--max-questions 100] \
//     --out tests/benchmarks/fixtures/longmemeval.json

import fs from 'node:fs/promises';
import path from 'node:path';

interface CliArgs {
  out: string;
  maxQuestions?: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const out = args[args.indexOf('--out') + 1];
  if (!out) throw new Error('--out <path> is required');
  const maxIdx = args.indexOf('--max-questions');
  const maxQuestions = maxIdx >= 0 ? Number(args[maxIdx + 1]) : undefined;
  return { out, maxQuestions };
}

async function main() {
  const { out, maxQuestions } = parseArgs();
  const url =
    'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s.json';

  console.log(`[longmemeval] downloading from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as Array<{
    question_id: string;
    question: string;
    answer: string;
    haystack_sessions: Array<{
      session_id: string;
      messages: Array<{ role: string; content: string }>;
    }>;
    answer_session_ids: string[];
  }>;

  console.log(`[longmemeval] received ${data.length} questions`);
  const questions = (maxQuestions ? data.slice(0, maxQuestions) : data);

  // Flatten all unique sessions across all questions into the corpus.
  const corpusMap = new Map<string, { slug: string; title: string; content: string }>();
  for (const q of questions) {
    for (const session of q.haystack_sessions) {
      if (corpusMap.has(session.session_id)) continue;
      const content = session.messages
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');
      corpusMap.set(session.session_id, {
        slug: session.session_id.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
        title: `Session ${session.session_id}`,
        content,
      });
    }
  }

  const fixture = {
    name: 'longmemeval',
    corpus: Array.from(corpusMap.values()),
    questions: questions.map((q) => ({
      query: q.question,
      gold_slugs: q.answer_session_ids.map((id) =>
        id.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
      ),
    })),
  };

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(fixture));
  console.log(
    `[longmemeval] wrote ${fixture.questions.length} questions, ` +
      `${fixture.corpus.length} unique sessions to ${out}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
