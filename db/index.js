'use strict';

/**
 * 数据层：SQLite 连接 + 建表（零三方依赖，使用 Node 内置 node:sqlite）
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// 支持通过 STAFF_DB 覆盖数据库文件路径（验收测试用临时库，避免污染开发数据）
const DB_FILE = process.env.STAFF_DB
  ? path.resolve(process.env.STAFF_DB)
  : path.join(DATA_DIR, 'staff.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS employees (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_no      TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    gender      TEXT    NOT NULL DEFAULT '保密',
    phone       TEXT    NOT NULL UNIQUE,
    email       TEXT,
    department  TEXT    NOT NULL,
    position    TEXT    NOT NULL,
    hire_date   TEXT    NOT NULL,
    status      INTEGER NOT NULL DEFAULT 1,
    note        TEXT,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );

  /* 工号序号：独立计数表，保证删除记录后工号不复用（PRD R-2 验收） */
  CREATE TABLE IF NOT EXISTS counters (
    key   TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );

  INSERT OR IGNORE INTO counters (key, value) VALUES ('emp_no', 0);
`);

const now = () => new Date().toISOString();

/** 工号格式化：EMP + 4 位补零；超过 9999 后自然进位为 5 位（PRD Q9 取舍） */
function formatEmpNo(seq) {
  return 'EMP' + String(seq).padStart(4, '0');
}

/**
 * 新增员工：取序号 → 生成工号 → 插入，全部在同一事务内完成，避免并发重号
 * @returns {{id:number, emp_no:string}}
 */
function insertEmployee(data) {
  db.exec('BEGIN IMMEDIATE');
  try {
    // 序号来自独立计数表，删除员工不影响计数 → 已删工号不复用
    db.prepare("UPDATE counters SET value = value + 1 WHERE key = 'emp_no'").run();
    const seq = Number(db.prepare("SELECT value FROM counters WHERE key = 'emp_no'").get().value);
    const empNo = formatEmpNo(seq);

    const row = db.prepare(
      `INSERT INTO employees
         (emp_no, name, gender, phone, email, department, position, hire_date, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      empNo, data.name, data.gender, data.phone, data.email,
      data.department, data.position, data.hire_date, data.status,
      data.note, data.created_at, data.updated_at
    );
    db.exec('COMMIT');
    return { id: Number(row.lastInsertRowid), emp_no: empNo };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* counter 表维护：index.js 负责底层，routes 只调用 */
function bumpCounter(key, delta) {
  db.prepare('UPDATE counters SET value = value + ? WHERE key = ?').run(delta, key);
}
function readCounter(key) {
  const row = db.prepare('SELECT value FROM counters WHERE key = ?').get(key);
  return row ? Number(row.value) : 0;
}

module.exports = { db, now, insertEmployee, bumpCounter, readCounter, formatEmpNo };
