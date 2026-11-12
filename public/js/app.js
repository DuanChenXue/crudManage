'use strict';
/* ===== 员工管理后台 · 前端逻辑 =====
 * 依赖：jQuery 3.7.1（本地 public/vendor/ 引入，非 CDN）
 * UI：Modal / Toast / 表单样式均为自绘，不引用 Bootstrap 等三方组件库
 */

$(function () {
  const DEPARTMENTS = ['技术部', '产品部', '设计部', '市场部', '销售部', '人力资源部', '财务部', '行政部'];
  const PHONE_RE = /^1[3-9]\d{9}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PAGE_SIZE = 10;

  /* 字段 → 表单控件 id 映射（校验提示就地定位用） */
  const FIELD_INPUT = {
    name: 'fmName',
    gender: 'fmGender',
    phone: 'fmPhone',
    email: 'fmEmail',
    department: 'fmDepartment',
    position: 'fmPosition',
    hire_date: 'fmHireDate',
    status: 'fmStatus',
    note: 'fmNote'
  };

  const $q = (id) => $('#' + id);
  const state = { keyword: '', department: '', status: '', page: 1 };

  /* ---------------------------------------------------- 基础工具 */

  /** HTML 转义（防 XSS）：展示用户输入前必须转义 */
  function escapeHtml(v) {
    return $('<div>').text(v === null || v === undefined ? '' : String(v)).html();
  }

  /** D-3 全局提示条：右上角，3 秒自动消失 */
  function toast(message, type) {
    const $el = $('<div>')
      .addClass('toast ' + (type || 'ok'))
      .text(message);
    $q('toastBox').append($el);
    setTimeout(function () {
      $el.addClass('out');
      setTimeout(function () { $el.remove(); }, 220);
    }, 3000);
  }

  /** 简单防抖（输入停止 300ms 后触发） */
  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  /* ---------------------------------------------------- R-1 列表与检索 */

  let reqSeq = 0;

  // 获取员工列表
  function loadList() {
    const seq = ++reqSeq;
    $q('loading').prop('hidden', false);
    return $.ajax({
      url: '/api/employees',
      method: 'GET',
      dataType: 'json',
      data: {
        page: state.page,
        pageSize: PAGE_SIZE,
        keyword: state.keyword,
        department: state.department,
        status: state.status
      }
    }).then(
      function (res) {
        if (seq !== reqSeq) return;           // 丢弃过期响应，防快速筛选串页
        if (!res || res.code !== 0) {
          renderTable([]);
          toast((res && res.message) || '请求失败', 'error');
          return;
        }
        renderTable(res.data.list);
        renderPager(res.data);
      },
      function (xhr) {
        if (seq !== reqSeq) return;
        const res = xhr.responseJSON || {};
        renderTable([]);
        toast(res.message || '服务无响应，请确认后台已启动', 'error');
      }
    ).always(function () {
      if (seq === reqSeq) $q('loading').prop('hidden', true);
    });
  }

  function renderTable(list) {
    const rows = list.map(function (row) {
      const onDuty = Number(row.status) === 1;
      const tag = onDuty
        ? '<span class="tag tag-on">在职</span>'
        : '<span class="tag tag-off">离职</span>';
      // 离职员工禁止从界面进入编辑（按钮置灰 + hover 提示）；删除保持可用
      const editBtn = onDuty
        ? '<button type="button" class="btn-link" data-act="edit" data-id="' + row.id + '">编辑</button>'
        : '<button type="button" class="btn-link" disabled title="离职员工不可编辑">编辑</button>';

      return '<tr>'
        + '<td class="mono">' + escapeHtml(row.emp_no) + '</td>'
        + '<td>' + escapeHtml(row.name) + '</td>'
        + '<td>' + escapeHtml(row.gender) + '</td>'
        + '<td>' + escapeHtml(row.department) + '</td>'
        + '<td title="' + escapeHtml(row.position) + '">' + escapeHtml(row.position) + '</td>'
        + '<td class="mono">' + escapeHtml(row.phone) + '</td>'
        + '<td class="mono">' + escapeHtml(row.hire_date) + '</td>'
        + '<td>' + tag + '</td>'
        + '<td class="col-ops">' + editBtn
        + '<button type="button" class="btn-link danger" data-act="del" data-id="' + row.id + '"'
        + ' data-label="' + escapeHtml(row.name) + '（' + escapeHtml(row.emp_no) + '）">删除</button>'
        + '</td></tr>';
    }).join('');

    $q('tbody').html(rows);
    const isEmpty = list.length === 0;
    $q('empty').prop('hidden', !isEmpty);
    $q('pager').prop('hidden', isEmpty);
  }

  function renderPager(data) {
    const total = data.total;
    const page = data.page;
    const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

    $q('totalCount').text(total);
    $q('btnPrev').prop('disabled', page <= 1);
    $q('btnNext').prop('disabled', page >= pages);

    // 页码：首尾固定，中间窗口滑动，超过 7 页显示省略号
    const nums = [];
    if (pages <= 7) {
      for (let i = 1; i <= pages; i++) nums.push(i);
    } else if (page <= 4) {
      nums.push(1, 2, 3, 4, 5, '...', pages);
    } else if (page >= pages - 3) {
      nums.push(1, '...', pages - 4, pages - 3, pages - 2, pages - 1, pages);
    } else {
      nums.push(1, '...', page - 1, page, page + 1, '...', pages);
    }

    const $pages = $q('pagerPages').empty();
    nums.forEach(function (n) {
      if (n === '...') {
        $('<span class="page-ellipsis">…</span>').appendTo($pages);
      } else {
        $('<button type="button" class="page-btn">').addClass(n === page ? 'active' : '')
          .attr('data-page', n).text(n).appendTo($pages);
      }
    });
  }

  /* ---------------------------------------------------- 校验提示 */

  function setError(field, message) {
    $('.err[data-for="' + field + '"]').text(message || '');
    $q(FIELD_INPUT[field]).toggleClass('invalid', !!message);
  }

  function clearErrors() {
    $('.err').text('');
    $('.input').removeClass('invalid');
    $q('formAlert').prop('hidden', true).text('');
  }

  /* ---------------------------------------------------- D-1 表单浮层（新增/编辑复用） */

  // 打开浮层时指定提交动作，提交时不再判断新增/编辑
  let submitAction = addEmployee;

  function openForm(mode, row) {
    clearErrors();
    $q('empForm')[0].reset();
    $q('fmId').val('');
    $q('formTitle').text(mode === 'edit' ? '编辑员工' : '新增员工');
    $q('fmEmpNo').text(mode === 'edit' ? row.emp_no : '保存后自动生成');

    if (mode === 'edit') {
      submitAction = updateEmployee;
      $q('fmId').val(row.id);
      $q('fmName').val(row.name);
      $q('fmGender').val(row.gender);
      $q('fmPhone').val(row.phone);
      $q('fmEmail').val(row.email || '');
      $q('fmDepartment').val(row.department);
      $q('fmPosition').val(row.position);
      $q('fmHireDate').val(row.hire_date);
      $q('fmStatus').val(String(row.status));
      $q('fmNote').val(row.note || '');
    } else {
      submitAction = addEmployee;
      $q('fmHireDate').val(new Date().toISOString().slice(0, 10));
    }

    $q('formMask').prop('hidden', false);
    $q('fmName').trigger('focus');
  }

  function closeForm() {
    $q('formMask').prop('hidden', true);
  }

  /** 前端校验：非法输入就地提示并拦下，不发起请求 */
  function validate(data) {
    clearErrors();
    const errors = {};
    if (!data.name) errors.name = '请输入姓名';
    else if (data.name.length > 30) errors.name = '姓名不能超过 30 个字符';

    if (!data.phone) errors.phone = '请输入手机号';
    else if (!PHONE_RE.test(data.phone)) errors.phone = '请输入正确的手机号';

    if (data.email && !EMAIL_RE.test(data.email)) errors.email = '请输入正确的邮箱';

    if (!data.department) errors.department = '请选择部门';
    if (!data.position) errors.position = '请输入职位';
    else if (data.position.length > 30) errors.position = '职位不能超过 30 个字符';

    if (!data.hire_date) errors.hire_date = '请选择入职日期';
    if (data.note.length > 200) errors.note = '备注不能超过 200 个字符';

    const fields = Object.keys(errors);
    fields.forEach(function (f) { setError(f, errors[f]); });
    return fields.length === 0;
  }

  /** 新增员工：POST /api/addEmployee */
  function addEmployee() {
    const data = {
      name: $.trim($q('fmName').val()),
      gender: $q('fmGender').val(),
      phone: $.trim($q('fmPhone').val()),
      email: $.trim($q('fmEmail').val()),
      department: $q('fmDepartment').val(),
      position: $.trim($q('fmPosition').val()),
      hire_date: $q('fmHireDate').val(),
      status: Number($q('fmStatus').val()),
      note: $.trim($q('fmNote').val())
    };
    if (!validate(data)) return;

    const $btn = $q('formSubmit').prop('disabled', true).text('保存中…');
    $.ajax({
      url: '/api/addEmployee',
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      data: JSON.stringify(data),
      dataType: 'json'
    }).done(function (res) {
      if (res.code !== 0) { toast(res.message, 'error'); return; }
      closeForm();
      state.page = 1;   // 新增后回到第 1 页
      loadList().then(function () { toast('新增成功'); });
    }).fail(function (xhr) {
      const res = xhr.responseJSON || {};
      const message = res.message || '服务无响应，请确认后台已启动';
      // 手机号重复：就地提示，浮层保持打开且已填内容不丢失
      if (res.code === 409) setError('phone', message);
      // 记录已被他人删除：关闭浮层并刷新列表
      if (res.code === 404) { closeForm(); loadList(); }
      $q('formAlert').text(message).prop('hidden', false);
      toast(message, 'error');
    }).always(function () {
      $btn.prop('disabled', false).text('保存');
    });
  }

  /** 编辑员工：PUT /api/employees/:id，原地刷新列表 */
  function updateEmployee() {
    const data = {
      name: $.trim($q('fmName').val()),
      gender: $q('fmGender').val(),
      phone: $.trim($q('fmPhone').val()),
      email: $.trim($q('fmEmail').val()),
      department: $q('fmDepartment').val(),
      position: $.trim($q('fmPosition').val()),
      hire_date: $q('fmHireDate').val(),
      status: Number($q('fmStatus').val()),
      note: $.trim($q('fmNote').val())
    };
    if (!validate(data)) return;

    const $btn = $q('formSubmit').prop('disabled', true).text('保存中…');
    $.ajax({
      url: '/api/employees/' + $q('fmId').val(),
      method: 'PUT',
      contentType: 'application/json; charset=utf-8',
      data: JSON.stringify(data),
      dataType: 'json'
    }).done(function (res) {
      if (res.code !== 0) { toast(res.message, 'error'); return; }
      closeForm();
      loadList().then(function () { toast('保存成功'); });
    }).fail(function (xhr) {
      const res = xhr.responseJSON || {};
      const message = res.message || '服务无响应，请确认后台已启动';
      if (res.code === 409) setError('phone', message);
      if (res.code === 404) { closeForm(); loadList(); }
      $q('formAlert').text(message).prop('hidden', false);
      toast(message, 'error');
    }).always(function () {
      $btn.prop('disabled', false).text('保存');
    });
  }

  /* ---------------------------------------------------- D-2 删除确认浮层 */

  let delId = null;

  function openDelete(id, label) {
    delId = id;
    // 文案含姓名与工号
    $q('delText').html('确认删除员工 <b>' + escapeHtml(label) + '</b>？此操作不可恢复');
    $q('delMask').prop('hidden', false);
  }

  function closeDelete() {
    $q('delMask').prop('hidden', true);
    delId = null;
  }

  function confirmDelete() {
    if (!delId) return;
    const $btn = $q('delConfirm').prop('disabled', true);

    $.ajax({
      url: '/api/delete/' + delId,
      method: 'DELETE',
      dataType: 'json'
    }).done(function (res) {
      if (res.code !== 0) { toast(res.message, 'error'); loadList(); return; }
      closeDelete();
      // 分页自愈：末页被删空且不是第 1 页时回到上一页
      const total = Number($q('totalCount').text()) - 1;
      const lastPage = Math.max(Math.ceil(total / PAGE_SIZE), 1);
      if (state.page > lastPage) state.page = lastPage;
      loadList().then(function () { toast('删除成功'); });
    }).fail(function (xhr) {
      // 删除失败：保留该行，界面与数据库保持一致
      const res = xhr.responseJSON || {};
      toast(res.message || '服务无响应，请确认后台已启动', 'error');
      loadList();
    }).always(function () {
      $btn.prop('disabled', false);
    });
  }

  /* ---------------------------------------------------- 事件绑定 */

  function bindEvents() {
    // 检索：输入停止 300ms 内触发；条件变更后重置到第 1 页
    $q('qKeyword').on('input', debounce(function () {
      state.keyword = $.trim($(this).val());
      state.page = 1;
      loadList();
    }, 300));

    $q('qDepartment').on('change', function () {
      state.department = $(this).val();
      state.page = 1;
      loadList();
    });

    $q('qStatus').on('change', function () {
      state.status = $(this).val();
      state.page = 1;
      loadList();
    });

    $q('btnReset').on('click', function () {
      $q('qKeyword').val('');
      $q('qDepartment').val('');
      $q('qStatus').val('');
      $.extend(state, { keyword: '', department: '', status: '', page: 1 });
      loadList();
    });

    // 分页
    $q('btnPrev').on('click', function () { if (state.page > 1) { state.page--; loadList(); } });
    $q('btnNext').on('click', function () { state.page++; loadList(); });
    $q('pagerPages').on('click', '[data-page]', function () {
      state.page = Number($(this).attr('data-page'));
      loadList();
    });

    // 表格操作（事件委托，jQuery .on(events, selector)）
    $q('tbody').on('click', '[data-act]', function () {
      const $btn = $(this);
      if ($btn.prop('disabled')) return;
      const id = Number($btn.attr('data-id'));

      if ($btn.attr('data-act') === 'del') {
        openDelete(id, $btn.attr('data-label'));
        return;
      }
      $.ajax({
        url: '/api/employees/' + id,
        method: 'GET',
        dataType: 'json'
      }).done(function (res) {
        if (res.code !== 0) { toast(res.message, 'error'); loadList(); return; }
        openForm('edit', res.data);
      }).fail(function (xhr) {
        const res = xhr.responseJSON || {};
        toast(res.message || '服务无响应，请确认后台已启动', 'error');
        loadList();   // 记录已被删除等场景：刷新列表兜底
      });
    });

    // 新增
    $q('btnAdd').on('click', function () { openForm('add'); });

    // 表单浮层
    $q('formSubmit').on('click', function () { submitAction(); });
    $q('formCancel').on('click', closeForm);
    $q('formClose').on('click', closeForm);
    $q('empForm').on('submit', function (e) { e.preventDefault(); submitAction(); });
    $q('formMask').on('click', function (e) { if (e.target === this) closeForm(); });

    // 删除浮层
    $q('delConfirm').on('click', confirmDelete);
    $q('delCancel').on('click', closeDelete);
    $q('delClose').on('click', closeDelete);
    $q('delMask').on('click', function (e) { if (e.target === this) closeDelete(); });

    // ESC 关闭最上层浮层
    $(document).on('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$q('delMask').prop('hidden')) closeDelete();
      else if (!$q('formMask').prop('hidden')) closeForm();
    });
  }

  /* ---------------------------------------------------- 初始化 */

  const deptOptions = DEPARTMENTS.map(function (d) {
    return '<option value="' + d + '">' + d + '</option>';
  }).join('');

  // 筛选栏部门下拉
  $q('qDepartment').append(deptOptions);
  // 表单部门下拉
  $q('fmDepartment').html('<option value="">请选择部门</option>' + deptOptions);

  bindEvents();
  loadList();
});
