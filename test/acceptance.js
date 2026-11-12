'use strict';
/**
 * 验收测试：逐条覆盖 PRD 第 4 节「边界与异常场景」与第 9 节「交付验收清单」
 *
 * 用法：
 *   node test/acceptance.js                    # 推荐：自动起服务 + 临时库，跑完销毁，不污染开发数据
 *   node test/acceptance.js http://host:port   # 指定已运行的服务（用该服务的库做约束校验）
 *
 * 设计说明：本脚本需要「空库」前提（要断言首条工号为 EMP0001）。
 * 因此默认自行拉起一个独立服务实例并指向临时数据库，
 * 避免依赖开发者当前库的状态，也避免测试数据写进 data/staff.db。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

/* ---------------- 运行模式：自带隔离环境 / 连接已有服务 ---------------- */

const givenUrl = process.argv[2] || null;
const ROOT = path.join(__dirname, '..');

let BASE = givenUrl;
let DB_FILE = path.join(ROOT, 'data', 'staff.db');
let serverProc = null;
let tmpDir = null;

/** 启动隔离服务：临时库 + 随机端口 */
async function startIsolatedServer() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-accept-'));
  DB_FILE = path.join(tmpDir, 'acceptance.db');
  const port = 3400 + Math.floor(Math.random() * 400);

  serverProc = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), STAFF_DB: DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  serverProc.stderr.on('data', (d) => { stderr += d.toString(); });

  BASE = `http://127.0.0.1:${port}`;

  // 轮询等待服务就绪（最多 10 秒）
  for (let i = 0; i < 100; i++) {
    if (serverProc.exitCode !== null) {
      throw new Error(`隔离服务启动失败（exit=${serverProc.exitCode}）：${stderr.trim()}`);
    }
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* 尚未监听，继续等 */ }
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('隔离服务启动超时（10s）');
}

/** 销毁隔离服务与临时库 */
function stopIsolatedServer() {
  if (serverProc && serverProc.exitCode === null) {
    try { serverProc.kill('SIGKILL'); } catch { /* ignore */ }
  }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const API = () => `${BASE}/api/employees`;

/* ---------------- 断言与请求工具 ---------------- */

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` → ${detail}` : ''));
    console.log(`  ❌ ${name}${detail ? ' → ' + detail : ''}`);
  }
}

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  return { status: res.status, code: payload?.code, message: payload?.message, data: payload?.data };
}

const emp = (over = {}) => ({
  name: '张三', gender: '男', phone: '13800000001', email: 'zhang@a.com',
  department: '技术部', position: '后端工程师', hire_date: '2024-03-01', note: '测试', ...over
});

/* ---------------- 主流程 ---------------- */

(async () => {
  console.log('\n========== 员工管理后台 · 验收测试 ==========');
  if (givenUrl) {
    console.log('模式：连接已有服务');
    console.log(`目标：${BASE}`);
    console.log('注意：该库将新增/删除测试数据，请勿对生产库执行。\n');
  } else {
    await startIsolatedServer();
    console.log('模式：隔离环境（自动起服务 + 临时库）');
    console.log(`目标：${BASE}`);
    console.log(`临时库：${DB_FILE}\n`);
  }

  const A = API();

  /* ---------- R-2 工号自动生成 ---------- */
  console.log('【R-2 新增 · 工号自动生成】');
  const list0 = await call('GET', `${A}?page=1&pageSize=10`);
  check('空库列表返回 200 且 total=0（空库启动不报错）',
    list0.status === 200 && list0.code === 0 && list0.data.total === 0,
    `status=${list0.status} total=${list0.data?.total}`);

  const c1 = await call('POST', A, emp());
  check('空库首条工号为 EMP0001', c1.data?.emp_no === 'EMP0001', c1.data?.emp_no);
  check('新增默认状态为在职(1)', c1.data?.status === 1, String(c1.data?.status));
  check('id / created_at / updated_at 由后端生成',
    Number.isInteger(c1.data?.id) && !!c1.data?.created_at && !!c1.data?.updated_at);

  for (let i = 2; i <= 9; i++) {
    await call('POST', A, emp({ name: `员工${i}`, phone: `1380000000${i}` }));
  }
  const c10 = await call('POST', A, emp({ name: '第十位', phone: '13800000010' }));
  check('库中最大 EMP0009 时新增 → EMP0010', c10.data?.emp_no === 'EMP0010', c10.data?.emp_no);

  /* ---------- R-2 校验与查重 ---------- */
  console.log('\n【R-2 新增 · 前后端双重校验（绕过前端直调接口）】');
  const dup = await call('POST', A, emp({ name: '李四' }));
  check('手机号重复 → 409「该手机号已存在」',
    dup.status === 409 && dup.message === '该手机号已存在', `status=${dup.status} msg=${dup.message}`);

  const badPhone = await call('POST', A, emp({ phone: '12345' }));
  check('手机号 12345 → 400「请输入正确的手机号」',
    badPhone.status === 400 && badPhone.message === '请输入正确的手机号', badPhone.message);

  const badDept = await call('POST', A, emp({ phone: '13900000001', department: '神秘部' }));
  check('非法部门 → 400', badDept.status === 400, badDept.message);

  const noDept = await call('POST', A, { name: '赵六', phone: '13900000002', position: '测试', hire_date: '2025-01-01' });
  check('缺必填部门 → 400「请选择部门」',
    noDept.status === 400 && noDept.message === '请选择部门', noDept.message);

  const badEmail = await call('POST', A, emp({ phone: '13900000003', email: 'not-an-email' }));
  check('邮箱格式非法 → 400', badEmail.status === 400, badEmail.message);

  const longName = await call('POST', A, emp({ phone: '13900000004', name: '名'.repeat(31) }));
  check('姓名超 30 字符 → 400', longName.status === 400, longName.message);

  const longNote = await call('POST', A, emp({ phone: '13900000005', note: '备'.repeat(201) }));
  check('备注超 200 字符 → 400', longNote.status === 400, longNote.message);

  const future = await call('POST', A, emp({ phone: '13900000006', name: '预约入职', hire_date: '2030-01-01' }));
  check('入职日期为未来 → 允许提交（预约入职）', future.code === 0, future.message);

  /* ---------- R-3 编辑 ---------- */
  console.log('\n【R-3 编辑】');
  const detail = await call('GET', `${A}/${c1.data.id}`);
  check('GET 单条详情用于编辑回填', detail.code === 0 && detail.data.emp_no === 'EMP0001');

  const upd = await call('PUT', `${A}/${c1.data.id}`, { position: '高级后端工程师' });
  check('修改职位保存成功', upd.code === 0 && upd.data.position === '高级后端工程师', upd.data?.position);
  check('保存时写入 updated_at（已变化）',
    upd.data.updated_at !== upd.data.created_at,
    `${upd.data?.created_at} / ${upd.data?.updated_at}`);
  check('emp_no 不可修改（保持 EMP0001）', upd.data.emp_no === 'EMP0001', upd.data?.emp_no);

  const dupEdit = await call('PUT', `${A}/${c1.data.id}`, { phone: '13800000002' });
  check('编辑改成已存在手机号 → 409', dupEdit.status === 409, `status=${dupEdit.status} msg=${dupEdit.message}`);

  const off = await call('PUT', `${A}/${c1.data.id}`, { status: 0 });
  check('状态改为离职并保存（记录不删除）', off.code === 0 && off.data.status === 0 && off.data.emp_no === 'EMP0001');

  const offEdit = await call('PUT', `${A}/${c1.data.id}`, { position: '试图修改' });
  check('离职记录直接调 PUT → 400「离职员工不可编辑」',
    offEdit.status === 400 && offEdit.message === '离职员工不可编辑', `status=${offEdit.status} msg=${offEdit.message}`);

  const after = await call('GET', `${A}/${c1.data.id}`);
  check('离职记录被拒后库中数据不变', after.data.position === '高级后端工程师', after.data.position);

  const notFoundEdit = await call('PUT', `${A}/999999`, { position: 'x' });
  check('编辑不存在记录 → 404「记录不存在」',
    notFoundEdit.status === 404 && notFoundEdit.message === '记录不存在', notFoundEdit.message);

  /* ---------- R-1 检索 / 分页 / 排序 ---------- */
  console.log('\n【R-1 列表 · 检索 · 分页】');
  for (let i = 11; i <= 25; i++) {
    await call('POST', A, emp({
      name: i <= 15 ? `张伟${i}` : `员工${i}`,
      phone: `137000000${String(i).padStart(2, '0')}`,
      department: i % 2 === 0 ? '市场部' : '技术部'
    }));
  }
  const p1 = await call('GET', `${A}?page=1&pageSize=10`);
  const totalBefore = p1.data.total;
  check(`${totalBefore} 条时第 1 页 10 条、total 正确`,
    p1.data.list.length === 10 && totalBefore >= 25,
    `len=${p1.data.list.length} total=${totalBefore}`);
  const maxNo = p1.data.list.map((r) => r.emp_no).sort().pop();
  check('默认按 id 倒序（最新录入在最上）', p1.data.list[0].emp_no === maxNo, p1.data.list[0].emp_no);

  const lastPage = Math.ceil(totalBefore / 10);
  const pLast = await call('GET', `${A}?page=${lastPage}&pageSize=10`);
  const expectLastLen = totalBefore % 10 || 10;
  check('末页数据正确', pLast.data.list.length === expectLastLen,
    `第${lastPage}页 len=${pLast.data.list.length} 期望=${expectLastLen}`);

  const kwName = await call('GET', `${A}?keyword=${encodeURIComponent('张')}&pageSize=100`);
  check('关键词匹配姓名', kwName.data.total === 6, `total=${kwName.data.total}`);
  const kwNo = await call('GET', `${A}?keyword=EMP0012&pageSize=100`);
  check('关键词匹配工号', kwNo.data.total === 1 && kwNo.data.list[0].emp_no === 'EMP0012');
  const kwPhone = await call('GET', `${A}?keyword=13700000012&pageSize=100`);
  check('关键词匹配手机号', kwPhone.data.total === 1, `total=${kwPhone.data.total}`);

  const andQ = await call('GET', `${A}?department=${encodeURIComponent('技术部')}&status=1&pageSize=100`);
  check('部门 AND 状态 同时生效',
    andQ.data.list.every((r) => r.department === '技术部' && r.status === 1) && andQ.data.total > 0,
    `total=${andQ.data.total}`);

  const none = await call('GET', `${A}?keyword=${encodeURIComponent('不存在的人')}&pageSize=100`);
  check('搜索无结果 → total=0、list 为空', none.data.total === 0 && none.data.list.length === 0);

  /* ---------- R-4 删除 ---------- */
  console.log('\n【R-4 删除】');
  const delNotFound = await call('DELETE', `${A}/999999`);
  check('删除不存在记录 → 404', delNotFound.status === 404, delNotFound.message);

  // 删除最大工号后新增，工号必须不复用（序号单调递增，不回退）
  const before = await call('GET', `${A}?page=1&pageSize=1`);
  const target = before.data.list[0];              // 当前最大工号（id 倒序首行）
  const expectNext = 'EMP' + String(Number(target.emp_no.slice(3)) + 1).padStart(4, '0');

  const delMax = await call('DELETE', `${A}/${target.id}`);
  check('删除成功返回被删记录信息', delMax.code === 0 && delMax.data.emp_no === target.emp_no);
  const afterDel = await call('GET', `${A}?page=1&pageSize=10`);
  check('删除后 total 减少', afterDel.data.total === before.data.total - 1,
    `total=${afterDel.data.total}`);

  const reuse = await call('POST', A, emp({ name: '新同学', phone: '13600000001' }));
  check(`已删工号不复用（${target.emp_no} 被删后新增得到 ${expectNext}）`,
    reuse.data.emp_no === expectNext, reuse.data.emp_no);

  const delOffDuty = await call('DELETE', `${A}/${c1.data.id}`);
  check('离职员工同样可删除', delOffDuty.code === 0 && delOffDuty.data.emp_no === 'EMP0001');

  /* ---------- 并发工号 ---------- */
  console.log('\n【并发 · 工号事务】');
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      call('POST', A, emp({ name: `并发${i}`, phone: `135000000${String(i).padStart(2, '0')}`, department: '财务部' }))
    )
  );
  const nos = results.map((r) => r.data?.emp_no);
  check('并发新增 12 条无重号', new Set(nos).size === 12 && nos.every(Boolean), nos.join(','));

  /* ---------- 数据库层约束 ---------- */
  console.log('\n【数据库层 · 唯一约束与访问日志】');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_FILE);
  const idx = db.prepare("PRAGMA index_list('employees')").all();
  const uniqueCols = new Set();
  idx.filter((i) => i.unique).forEach((i) => {
    db.prepare(`PRAGMA index_info('${i.name}')`).all().forEach((c) => uniqueCols.add(c.name));
  });
  check('emp_no / phone 在数据库层有 UNIQUE 索引',
    uniqueCols.has('emp_no') && uniqueCols.has('phone'), [...uniqueCols].join(','));
  const logs = db.prepare('SELECT COUNT(*) c FROM access_log').get().c;
  check('access_log 记录了请求（PRD 第 6 节测量方式）', logs > 0, `rows=${logs}`);
  db.close();

  /* ---------- 汇总 ---------- */
  console.log(`\n========== 结果：通过 ${pass} / 失败 ${fail} ==========`);
  if (fail) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  } else {
    console.log('全部验收用例通过 ✅\n');
  }
})()
  .catch((err) => {
    console.error('\n测试脚本异常：', err.message || err);
    process.exitCode = 1;
  })
  .finally(() => {
    stopIsolatedServer();
  });
