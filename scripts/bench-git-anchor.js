/**
 * Phase-237 P1 验证 — getCurrentGitCommit() TTL 缓存效果。
 * 直接调 dist 编译产物，绕开 LLM/RPC 噪声。
 *
 * 用法: node scripts/bench-git-anchor.js
 */
const { getCurrentGitCommit, invalidateGitHeadCache } = require('../dist/dev-plan-graph-store.utils');

const gitCwd = process.cwd();

function timeIt(fn) {
  const t0 = process.hrtime.bigint();
  const v = fn();
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, v };
}

console.log('\n=== P1 TTL cache verification ===');
console.log('gitCwd:', gitCwd);
console.log('TTL_MS env:', process.env.AIFASTDB_DEVPLAN_GIT_ANCHOR_TTL_MS || '(default 5000)');
console.log('DISABLED env:', process.env.AIFASTDB_DEVPLAN_GIT_ANCHOR_DISABLED || '(off)');
console.log('');

// 强制清缓存
invalidateGitHeadCache();

// 第一次（冷）
const cold = timeIt(() => getCurrentGitCommit(gitCwd));
console.log(`cold (1st call):     ${cold.ms.toFixed(2).padStart(8)} ms  hash=${cold.v}`);

// 随后连续 10 次（应该全部命中 TTL 缓存）
const warm = [];
for (let i = 0; i < 10; i++) {
  warm.push(timeIt(() => getCurrentGitCommit(gitCwd)).ms);
}
const warmTotal = warm.reduce((a, b) => a + b, 0);
const warmAvg = warmTotal / warm.length;
const warmMax = Math.max(...warm);
console.log(`warm (next 10, total): ${warmTotal.toFixed(2).padStart(8)} ms`);
console.log(`warm (next 10, avg):   ${warmAvg.toFixed(4).padStart(8)} ms`);
console.log(`warm (next 10, max):   ${warmMax.toFixed(4).padStart(8)} ms`);

// 等 6s 让 TTL 过期，再来一次（应该退回冷 spawn）
console.log('\nwait 6s for TTL to expire...');
setTimeout(() => {
  const expired = timeIt(() => getCurrentGitCommit(gitCwd));
  console.log(`after TTL expire:    ${expired.ms.toFixed(2).padStart(8)} ms  hash=${expired.v}`);

  // 验证 DISABLED env
  process.env.AIFASTDB_DEVPLAN_GIT_ANCHOR_DISABLED = '1';
  invalidateGitHeadCache();
  const disabled = timeIt(() => getCurrentGitCommit(gitCwd));
  console.log(`with DISABLED=1:     ${disabled.ms.toFixed(2).padStart(8)} ms  hash=${disabled.v}`);

  console.log('\n=== summary ===');
  console.log(`cold spawn:        ${cold.ms.toFixed(2)} ms`);
  console.log(`warm cache hit:    ${warmAvg.toFixed(4)} ms avg  -> ${((1 - warmAvg / cold.ms) * 100).toFixed(2)}% reduction`);
  console.log(`TTL re-spawn:      ${expired.ms.toFixed(2)} ms (should be similar to cold)`);
  console.log(`DISABLED short-circuit: ${disabled.ms.toFixed(4)} ms (should be <1ms)`);
}, 6000);
