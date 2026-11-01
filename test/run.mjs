import { execFileSync } from 'node:child_process';
import { makeContext } from './harness.mjs';

const ESBUILD = '/Applications/Alma.app/Contents/Resources/app.asar.unpacked/node_modules/esbuild/bin/esbuild';
execFileSync(ESBUILD, ['main.ts','--bundle','--outfile=test/.build.mjs','--target=node22','--format=esm','--external:electron','--external:zod','--external:node:*','--platform=node'], {stdio:'pipe'});
const mod = await import('./.build.mjs?' + Date.now());

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' :: ' + extra : ''}`); }
};
const count = (s) => (s.match(/\[purge:active\]/g) ?? []).length;

async function boot(settings) {
  const h = makeContext(settings);
  const act = await mod.activate(h.ctx);
  return { h, act };
}

console.log('\n[1] disabled by default -> no injection');
{
  const { h } = await boot({});
  const out = await h.fire('chat.message.willSend', { content: 'do the thing', parts: [] });
  ok('content untouched', out.content === undefined, `got ${JSON.stringify(out.content)}`);
  ok('no marker', count('do the thing') === 0);
}

console.log('\n[2] enabled -> injects once');
{
  const { h } = await boot({ 'almaPurge.enabled': true });
  const out = await h.fire('chat.message.willSend', { content: 'do the thing', parts: [] });
  ok('content written', typeof out.content === 'string');
  ok('exactly one marker', count(out.content) === 1, out.content);
  ok('original preserved', out.content.startsWith('do the thing'));
}

console.log('\n[3] IDEMPOTENCY: second fire must not stack (the prompt-enhancer bug)');
{
  const { h } = await boot({ 'almaPurge.enabled': true, 'almaPurge.debug': true });
  // The host re-fires with whatever content is current, so carry the
  // *effective* content forward exactly like the real pipeline does.
  let current = 'do the thing';
  const fires = [];
  for (let i = 0; i < 3; i++) {
    const out = await h.fire('chat.message.willSend', { content: current });
    fires.push(out);
    if (out.content !== undefined) current = out.content;
  }
  const second = fires[1], third = { content: current };
  ok('still exactly one marker after 3 fires', count(third.content) === 1, `count=${count(third.content)}`);
  ok('no growth on 2nd pass', second.content === undefined || second.content === first.content);
  ok('debug logged a skip', h.logs.some(([l, m]) => l === 'debug' && /already present/.test(m)));
}

console.log('\n[4] presets differ');
{
  const texts = {};
  for (const p of ['minimal','standard','strict']) {
    const { h } = await boot({ 'almaPurge.enabled': true, 'almaPurge.preset': p, 'almaPurge.boost': false });
    const out = await h.fire('chat.message.willSend', { content: 'x' });
    texts[p] = out.content;
  }
  ok('minimal != standard', texts.minimal !== texts.standard);
  ok('standard != strict', texts.standard !== texts.strict);
  ok('strict has anti-claim clause', /Never claim a step succeeded/.test(texts.strict));
  ok('all carry marker', Object.values(texts).every(t => count(t) === 1));
}

console.log('\n[5] boost toggle');
{
  const on = await boot({ 'almaPurge.enabled': true, 'almaPurge.boost': true });
  const o1 = await on.h.fire('chat.message.willSend', { content: 'x' });
  const off = await boot({ 'almaPurge.enabled': true, 'almaPurge.boost': false });
  const o2 = await off.h.fire('chat.message.willSend', { content: 'x' });
  ok('boost adds a trailing line', /keep executing\./.test(o1.content));
  ok('no boost when off', !/keep executing\./.test(o2.content));
  ok('boost line is last', o1.content.trimEnd().endsWith('keep executing.'));
}

console.log('\n[6] custom instructions');
{
  const { h } = await boot({ 'almaPurge.enabled': true, 'almaPurge.customInstructions': '  MY-CUSTOM-RULE  ' });
  const out = await h.fire('chat.message.willSend', { content: 'x' });
  ok('custom text present', out.content.includes('MY-CUSTOM-RULE'));
  ok('custom text trimmed', !out.content.includes('  MY-CUSTOM-RULE  '));
}

console.log('\n[7] empty / missing content is a no-op');
{
  const { h } = await boot({ 'almaPurge.enabled': true });
  const a = await h.fire('chat.message.willSend', { content: '' });
  const b = await h.fire('chat.message.willSend', {});
  ok('empty -> untouched', a.content === undefined);
  ok('missing -> untouched', b.content === undefined);
}

console.log('\n[8] commands');
{
  const { h } = await boot({ 'almaPurge.enabled': false });
  await h.run('toggle');
  ok('toggle flipped setting on', h.store['almaPurge.enabled'] === true);
  ok('toggle notified', h.notices.some(([m]) => /enabled/.test(m)));
  await h.run('toggle');
  ok('toggle flipped back off', h.store['almaPurge.enabled'] === false);
  await h.run('status');
  ok('status notified', h.notices.some(([m]) => /preset=/.test(m)));
}

console.log('\n[10] MULTI-PART: directive must appear once, not once per text part');
{
  // Regression for the bug found in the live host: setting only `content`
  // makes the host stamp it onto every text part. A message with a timestamp
  // part + body part duplicated the whole directive twice.
  const { h } = await boot({ 'almaPurge.enabled': true, 'almaPurge.boost': false });
  const out = await h.fire('chat.message.willSend', {
    content: 'TS\\nreal question',
    parts: [
      { type: 'text', text: 'TS' },
      { type: 'text', text: 'real question' },
    ],
  });
  ok('returns parts', Array.isArray(out.parts));
  const textParts = (out.parts ?? []).filter((p) => p?.type === 'text');
  ok('consolidated to a single text part', textParts.length === 1, `got ${textParts.length}`);
  ok('exactly one marker', count(textParts[0]?.text ?? '') === 1, textParts[0]?.text);
  ok('body preserved', (textParts[0]?.text ?? '').includes('real question'));
}

console.log('\n[11] non-text parts are preserved');
{
  const { h } = await boot({ 'almaPurge.enabled': true });
  const out = await h.fire('chat.message.willSend', {
    content: 'q',
    parts: [
      { type: 'text', text: 'q' },
      { type: 'image', data: 'abc' },
    ],
  });
  const types = (out.parts ?? []).map((p) => p?.type).sort();
  ok('image part survives', types.includes('image'), JSON.stringify(types));
  ok('one text part', types.filter((t) => t === 'text').length === 1);
  ok('one marker', count(JSON.stringify(out.parts)) === 1);
}

console.log('\n[9] dispose removes hooks');
{
  const { h, act } = await boot({ 'almaPurge.enabled': true });
  act.dispose();
  const out = await h.fire('chat.message.willSend', { content: 'x' });
  ok('no injection after dispose', out.content === undefined);
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
