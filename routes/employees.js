'use strict';

/**
 * 员工接口（PRD 8.2）
 *   GET    /api/employees        列表 + 检索 + 分页
 *   GET    /api/employees/:id    单条详情
 *   POST   /api/addEmployee      新增（工号由 db 层在事务内生成）
 *   PUT    /api/employees/:id    编辑（离职记录 400 拒绝）
 *   DELETE /api/delete/:id       删除
 */
const { db, now, insertEmployee } = require('../db');

const DEPARTMENTS = ['技术部', '产品部', '设计部', '市场部', '销售部', '人力资源部', '财务部', '行政部'];
const GENDERS = ['男', '女', '保密'];
const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 业务异常：携带 HTTP 状态码，由 server 统一转成响应体 */
class BizError extends Error {
  constructor(httpStatus, message) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

/* ------------------------------------------------------------------ 校验 */

/** 后端校验（不信任前端），返回清洗后的字段对象 */
function validate(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => body[k] !== undefined && body[k] !== null;

  // 姓名
  if (!partial || has('name')) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new BizError(400, '请输入姓名');
    if (name.length > 30) throw new BizError(400, '姓名不能超过 30 个字符');
    out.name = name;
  }

  // 性别
  if (!partial || has('gender')) {
    const gender = has('gender') ? String(body.gender).trim() : '保密';
    if (!GENDERS.includes(gender)) throw new BizError(400, '性别取值不合法');
    out.gender = gender;
  }

  // 手机号
  if (!partial || has('phone')) {
    const phone = String(body.phone ?? '').trim();
    if (!phone) throw new BizError(400, '请输入手机号');
    if (!PHONE_RE.test(phone)) throw new BizError(400, '请输入正确的手机号');
    out.phone = phone;
  }

  // 邮箱（可空）
  if (!partial || has('email')) {
    const email = String(body.email ?? '').trim();
    if (email && !EMAIL_RE.test(email)) throw new BizError(400, '请输入正确的邮箱');
    out.email = email || null;
  }

  // 部门
  if (!partial || has('department')) {
    const department = String(body.department ?? '').trim();
    if (!department) throw new BizError(400, '请选择部门');
    if (!DEPARTMENTS.includes(department)) throw new BizError(400, '部门取值不合法');
    out.department = department;
  }

  // 职位
  if (!partial || has('position')) {
    const position = String(body.position ?? '').trim();
    if (!position) throw new BizError(400, '请输入职位');
    if (position.length > 30) throw new BizError(400, '职位不能超过 30 个字符');
    out.position = position;
  }

  // 入职日期（允许未来日期，合法场景：预约入职）
  if (!partial || has('hire_date')) {
    const hireDate = String(body.hire_date ?? '').trim();
    if (!hireDate) throw new BizError(400, '请选择入职日期');
    if (!DATE_RE.test(hireDate) || Number.isNaN(Date.parse(hireDate))) {
      throw new BizError(400, '入职日期格式应为 YYYY-MM-DD');
    }
    out.hire_date = hireDate;
  }

  // 状态
  if (has('status')) {
    const status = Number(body.status);
    if (status !== 0 && status !== 1) throw new BizError(400, '状态取值不合法');
    out.status = status;
  } else if (!partial) {
    out.status = 1;
  }

  // 备注
  if (!partial || has('note')) {
    const note = String(body.note ?? '').trim();
    if (note.length > 200) throw new BizError(400, '备注不能超过 200 个字符');
    out.note = note || null;
  }

  return out;
}

/** 手机号查重（应用层提示；数据库 UNIQUE 索引兜底） */
function assertPhoneFree(phone, excludeId = null) {
  const row = db.prepare('SELECT id FROM employees WHERE phone = ?').get(phone);
  if (row && Number(row.id) !== Number(excludeId)) throw new BizError(409, '该手机号已存在');
}

function getById(id) {
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
}

/** SQLite 约束错误兜底 → 409/400 */
function normalizeDbError(err) {
  const msg = String(err && err.message || '');
  if (msg.includes('UNIQUE') && msg.includes('phone')) return new BizError(409, '该手机号已存在');
  if (msg.includes('UNIQUE') && msg.includes('emp_no')) return new BizError(409, '工号生成冲突，请重试');
  if (msg.includes('NOT NULL')) return new BizError(400, '必填项不能为空');
  return err;
}

/* ------------------------------------------------------------------ 处理器 */

function list(query) {
  const keyword = String(query.keyword ?? '').trim();
  const department = String(query.department ?? '').trim();
  const status = query.status === undefined || query.status === '' ? null : Number(query.status);
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 10, 1), 100);
  const page = Math.max(Number(query.page) || 1, 1);

  // 过滤条件下推到 SQL，避免全表捞出后在应用层过滤
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(name LIKE ? OR emp_no LIKE ? OR phone LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  if (department) {
    where.push('department = ?');
    params.push(department);
  }
  if (status === 0 || status === 1) {
    where.push('status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM employees ${whereSql}`).get(...params).c);
  const list = db.prepare(
    `SELECT * FROM employees ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);

  return { list, total, page, pageSize };
}

function detail(id) {
  const row = getById(id);
  if (!row) throw new BizError(404, '记录不存在');
  return row;
}

function create(body) {
  const data = validate(body);
  assertPhoneFree(data.phone);
  const ts = now();
  try {
    const { id, emp_no } = insertEmployee({ ...data, created_at: ts, updated_at: ts });
    return detail(id);
  } catch (err) {
    throw normalizeDbError(err);
  }
}

function update(id, body) {
  const current = getById(id);
  if (!current) throw new BizError(404, '记录不存在');

  // 业务约束：离职后禁止编辑（后端是最终防线，前端按钮置灰只是体验优化）
  if (Number(current.status) === 0) throw new BizError(400, '离职员工不可编辑');

  const data = validate(body, { partial: true });
  if (data.phone) assertPhoneFree(data.phone, id);

  const fields = Object.keys(data);
  if (!fields.length) return current;

  const sets = fields.map((f) => `${f} = ?`);
  sets.push('updated_at = ?');
  const params = [...fields.map((f) => data[f]), now(), id];

  try {
    db.prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  } catch (err) {
    throw normalizeDbError(err);
  }
  return detail(id);
}

function remove(id) {
  const current = getById(id);
  if (!current) throw new BizError(404, '记录不存在');
  db.prepare('DELETE FROM employees WHERE id = ?').run(id);
  return { id: Number(id), emp_no: current.emp_no };
}

/* ------------------------------------------------------------------ 路由分发 */

/**
 * @returns {Promise<boolean>} 是否命中并已处理该请求
 */
async function handle(req, res, url, { readBody, send }) {
  if (url.pathname === '/api/addEmployee') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      send(res, 200, create(body), '新增成功');
      return true;
    }
    send(res, 405, null, '不支持的请求方法');
    return true;
  }

  const del = url.pathname.match(/^\/api\/delete\/(\d+)$/);
  if (del) {
    if (req.method === 'DELETE') {
      send(res, 200, remove(Number(del[1])), '删除成功');
      return true;
    }
    send(res, 405, null, '不支持的请求方法');
    return true;
  }

  const m = url.pathname.match(/^\/api\/employees(?:\/(\d+))?$/);
  if (!m) return false;

  const id = m[1] ? Number(m[1]) : null;

  if (!id) {
    if (req.method === 'GET') {
      send(res, 200, list(Object.fromEntries(url.searchParams)));
      return true;
    }
    send(res, 405, null, '不支持的请求方法');
    return true;
  }

  if (!Number.isInteger(id) || id <= 0) {
    send(res, 404, null, '记录不存在');
    return true;
  }

  if (req.method === 'GET') {
    send(res, 200, detail(id));
    return true;
  }
  if (req.method === 'PUT') {
    const body = await readBody(req);
    const data = update(id, body);
    send(res, 200, data, '保存成功');
    return true;
  }
  send(res, 405, null, '不支持的请求方法');
  return true;
}

module.exports = { handle, BizError, DEPARTMENTS, GENDERS };
