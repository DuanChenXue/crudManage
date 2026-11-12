'use strict';

/**
 * 员工管理后台 · 服务入口
 * 零三方依赖：node:http + node:sqlite + 原生前端
 * 启动：npm start  →  http://localhost:3000/
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');
const employees = require('./routes/employees');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* 访问日志表（PRD 第 6 节：中间件记录路径/耗时/状态码，按周用 SQL 聚合） */
db.exec(`
  CREATE TABLE IF NOT EXISTS access_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    method     TEXT NOT NULL,
    path       TEXT NOT NULL,
    status     INTEGER NOT NULL,
    duration   INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);
const logStmt = db.prepare(
  'INSERT INTO access_log (method, path, status, duration, created_at) VALUES (?, ?, ?, ?, ?)'
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/** 统一响应体：{ code, message, data }，code!==0 表示业务失败 */
function send(res, httpStatus, data, message) {
  const ok = httpStatus < 400;
  const body = JSON.stringify({
    code: ok ? 0 : httpStatus,
    message: message || (ok ? 'ok' : '请求失败'),
    data: data === undefined ? null : data
  });
  res.writeHead(httpStatus, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new employees.BizError(400, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new employees.BizError(400, '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/* ---------------------------------------------------------- 静态资源 */

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  // 防目录穿越：解析后的绝对路径必须仍在 public 目录内
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    send(res, 404, null, '资源不存在');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      send(res, 404, null, '资源不存在');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': buf.length
    });
    res.end(buf);
  });
}

/* ---------------------------------------------------------- 服务启动 */

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  res.on('finish', () => {
    if (url.pathname.startsWith('/api/')) {
      try {
        logStmt.run(req.method, url.pathname, res.statusCode, Date.now() - started, new Date().toISOString());
      } catch { /* 日志失败不影响主流程 */ }
    }
  });

  try {
    if (url.pathname === '/api/health') {
      send(res, 200, { status: 'up' });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const handled = await employees.handle(req, res, url, { readBody, send });
      if (!handled) send(res, 404, null, '接口不存在');
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(res, url.pathname);
      return;
    }
    send(res, 405, null, '不支持的请求方法');
  } catch (err) {
    if (err instanceof employees.BizError) {
      send(res, err.httpStatus, null, err.message);
    } else {
      console.error('[500]', req.method, url.pathname, err);
      send(res, 500, null, '服务端异常，请稍后重试');
    }
  }
});

server.listen(PORT, () => {
  console.log(`✅ 员工管理后台已启动：http://localhost:${PORT}`);
});
