'use strict';
/**
 * 前端静态校验（无需浏览器）
 * 目的：把「依赖边界」这类容易在后续改动中失守的约定固化成可执行断言。
 * 用法：node test/frontend-smoke.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` → ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' → ' + detail : ''}`); }
}

console.log('\n========== 前端静态校验 ==========\n');

const html = read('public/index.html');
const appJs = read('public/js/app.js');
const css = read('public/css/style.css');
const pkg = JSON.parse(read('package.json'));

/* ---------- 依赖边界（核心约束：不引用三方 UI 组件库） ---------- */
console.log('【依赖边界】');

const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
check('页面脚本仅 2 个（jQuery + app.js）', scriptSrcs.length === 2, scriptSrcs.join(', '));
check('jQuery 以本地路径引入（非 CDN）',
  scriptSrcs.some((s) => s.startsWith('/vendor/jquery-')),
  scriptSrcs.join(', '));
check('未引入 Bootstrap 等三方 UI 组件库',
  !scriptSrcs.some((s) => /bootstrap|element|antd|semantic|bulma|tailwind/i.test(s)),
  scriptSrcs.join(', '));

const linkHrefs = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);
check('样式表仅本地引用（无 CDN）',
  linkHrefs.every((h) => !/^https?:\/\//i.test(h)),
  linkHrefs.join(', '));

check('package.json 无 dependencies 声明', !pkg.dependencies, JSON.stringify(pkg.dependencies));
check('package.json 无 devDependencies 声明', !pkg.devDependencies, JSON.stringify(pkg.devDependencies));
check('jQuery 未写入 package.json（只需文件存在即零依赖）',
  !JSON.stringify(pkg).includes('jquery'));

check('jQuery 本地文件确实存在', fs.existsSync(path.join(ROOT, 'public/vendor/jquery-3.7.1.min.js')));
check('引入顺序正确（jQuery 在 app.js 之前）',
  scriptSrcs.findIndex((s) => s.includes('jquery')) < scriptSrcs.findIndex((s) => s.includes('app.js')));

/* ---------- 浮层显隐（曾出过的真实缺陷） ---------- */
console.log('\n【浮层显隐（历史缺陷回归）】');
check('CSS 有 [hidden] 兜底规则，避免被 display:flex 覆盖',
  /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css));
check('app.js 用 .prop(\'hidden\') 控制浮层，而非直接改 style.display',
  /prop\(\s*'hidden'/.test(appJs) && !/style\.display\s*=/.test(appJs));

/* ---------- XSS 防护 ---------- */
console.log('\n【XSS 防护】');
check('app.js 定义了 escapeHtml 并用于表格渲染',
  /function escapeHtml/.test(appJs) && /escapeHtml\(row\.name\)/.test(appJs));
check('表格渲染中所有用户字段都经过 escapeHtml',
  ['row.emp_no', 'row.name', 'row.gender', 'row.department', 'row.position', 'row.phone', 'row.hire_date']
    .every((f) => new RegExp(`escapeHtml\\(${f.replace('.', '\\.')}\\)`).test(appJs)));

/* ---------- 业务约束的前端落点 ---------- */
console.log('\n【业务约束（前端落点）】');
check('离职行编辑按钮渲染为 disabled + title 提示',
  /disabled title="离职员工不可编辑"/.test(appJs));
check('离职行删除按钮仍可用（无 disabled）',
  /data-act="del"[\s\S]{0,160}data-label=/.test(appJs));
check('手机号正则与后端一致（^1[3-9]\\d{9}$）',
  /\^1\[3-9\]\\d\{9\}\$/.test(appJs));
check('搜索框使用 300ms 防抖', /debounce\([\s\S]{0,120}\},\s*300\)/.test(appJs));
check('表格操作用事件委托绑定（DOM 重建后仍生效）',
  /tbody'?\)\.on\('click',\s*'\[data-act\]'/.test(appJs));
check('分页页码也用事件委托绑定',
  /pagerPages'?\)\.on\('click',\s*'\[data-page\]'/.test(appJs));

/* ---------- 表单字段与数据模型对齐 ---------- */
console.log('\n【表单字段对齐】');
const requiredFields = ['name', 'gender', 'phone', 'email', 'department', 'position', 'hire_date', 'status', 'note'];
requiredFields.forEach((f) => {
  check(`表单字段映射含 ${f}`, new RegExp(`${f}:\\s*'fm`).test(appJs));
});
// 新增/编辑各自内联提交载荷，断言两处都不含 emp_no（工号由后端生成）
const payloadBodies = [...appJs.matchAll(/const data = \{([\s\S]*?)\n    \};/g)].map((m) => m[1]);
check('提交时不传 emp_no（由后端生成）',
  payloadBodies.length === 2 && payloadBodies.every((body) => !/emp_no/.test(body)),
  '新增/编辑的提交载荷应只含前端可编辑字段');

/* ---------- 汇总 ---------- */
console.log(`\n========== 结果：通过 ${pass} / 失败 ${fail} ==========`);
if (fail) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exitCode = 1;
} else {
  console.log('前端静态校验全部通过 ✅\n');
}
