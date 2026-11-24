/*
 * Cầu nối Supabase cho app Kiểm kê Foremost.
 * - Đăng nhập bằng email + mật khẩu (tài khoản do quản trị tạo trong Supabase).
 * - Dữ liệu nằm trong bảng "docs" của Supabase, cập nhật tức thời giữa các máy (Realtime).
 * - Cung cấp cho app các hàm db / user / downloads giống bản cũ, nên giao diện giữ nguyên.
 * Không cần sửa file này. Chỉ cần sửa config.js và supabase.sql.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function doneBoot() { if (window.__apDone) window.__apDone(); }
  function screen(title, html) {
    doneBoot();
    var h = $('storeName'); if (h) h.textContent = title;
    var s = $('sync'); if (s) { s.className = 'sync'; s.textContent = ''; }
    var v = $('view'); if (v) v.innerHTML = html;
  }
  var never = new Promise(function () {});
  var cfg = window.KK_SUPABASE || {};
  if (!window.supabase || !window.supabase.createClient) {
    window.claude = { use: function () { return never; } };
    screen('Chưa tải được thư viện', '<div class="card">Không tải được thư viện Supabase. Kiểm tra kết nối mạng rồi tải lại trang.</div>');
    return;
  }
  if (!cfg.url || /DAN_VAO_DAY/.test(cfg.url + cfg.anonKey)) {
    window.claude = { use: function () { return never; } };
    screen('Chưa cấu hình', '<div class="card"><b>App chưa được nối với Supabase.</b><p class="muted">Mở file <code>config.js</code> và dán địa chỉ dự án cùng khóa anon (xem HUONG-DAN.md).</p></div>');
    return;
  }
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kk-auth' } });

  /* ---------- tiện ích ---------- */
  function colOf(p) { return p.slice(0, p.lastIndexOf('/')); }
  function idOf(p) { return p.slice(p.lastIndexOf('/') + 1); }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function mkErr(e, fallback) {
    var msg = (e && (e.message || e.error_description)) || fallback || 'Lỗi';
    var code = fallback || 'unknown';
    if (e && (e.code === '42501' || /row-level security|permission denied/i.test(msg))) code = 'permission-denied';
    else if (e && (e.code === 'P0002' || /not-found/i.test(msg))) code = 'not-found';
    else if (/fetch|network|Failed to/i.test(msg)) code = 'unavailable';
    else if (e && e.code === '54000') code = 'resource-exhausted';
    var x = new Error(msg); x.code = code; return x;
  }
  function denied() { var x = new Error('Không có quyền'); x.code = 'permission-denied'; return x; }

  /* ---------- bộ nhớ đệm và người nghe ---------- */
  var docL = {};   // path -> [{cb, err, last}]
  var colL = {};   // col  -> [{cb, err, map, ready}]
  function docSnap(path, data) {
    return { id: idOf(path), exists: data != null, ref: doc(path), data: function () { return data == null ? undefined : clone(data); } };
  }
  function querySnap(map, changes) {
    var docs = Object.keys(map).sort().map(function (id) { return map[id]; });
    return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return changes; } };
  }
  // Áp một thay đổi (từ máy chủ hoặc vừa ghi xong) cho mọi người nghe liên quan
  function apply(path, data) {
    var s = data == null ? null : JSON.stringify(data);
    (docL[path] || []).forEach(function (l) {
      if (l.last === s && l.ready) return;
      l.last = s; l.ready = true;
      try { l.cb(docSnap(path, data)); } catch (e) { console.error(e); }
    });
    var id = idOf(path);
    (colL[colOf(path)] || []).forEach(function (l) {
      if (!l.ready) { l.queue.push([path, data]); return; }
      var had = Object.prototype.hasOwnProperty.call(l.map, id), type;
      if (data == null) { if (!had) return; type = 'removed'; var old = l.map[id]; delete l.map[id]; delete l.str[id]; emit(l, [{ type: type, doc: old }]); return; }
      if (had && l.str[id] === s) return;
      type = had ? 'modified' : 'added';
      l.map[id] = docSnap(path, data); l.str[id] = s;
      emit(l, [{ type: type, doc: l.map[id] }]);
    });
  }
  function emit(l, changes) { try { l.cb(querySnap(l.map, changes)); } catch (e) { console.error(e); } }

  function fetchDoc(path) {
    return sb.from('docs').select('data').eq('path', path).maybeSingle().then(function (r) {
      if (r.error) throw mkErr(r.error);
      return r.data ? r.data.data : null;
    });
  }
  function fetchCol(col) {
    var all = [], step = 1000;
    function page(from) {
      return sb.from('docs').select('path,data').eq('col', col).order('path').range(from, from + step - 1).then(function (r) {
        if (r.error) throw mkErr(r.error);
        all = all.concat(r.data || []);
        return (r.data || []).length === step ? page(from + step) : all;
      });
    }
    return page(0);
  }
  function loadDocListener(path, l) {
    return fetchDoc(path).then(function (d) {
      var s = d == null ? null : JSON.stringify(d);
      if (l.ready && l.last === s) return;
      l.last = s; l.ready = true; l.cb(docSnap(path, d));
    }).catch(function (e) { if (l.err) l.err(e); });
  }
  function loadColListener(col, l) {
    return fetchCol(col).then(function (rows) {
      var first = !l.ready, changes = [], seen = {};
      rows.forEach(function (r) {
        var id = idOf(r.path), s = JSON.stringify(r.data); seen[id] = 1;
        if (!Object.prototype.hasOwnProperty.call(l.map, id)) { l.map[id] = docSnap(r.path, r.data); l.str[id] = s; changes.push({ type: 'added', doc: l.map[id] }); }
        else if (l.str[id] !== s) { l.map[id] = docSnap(r.path, r.data); l.str[id] = s; changes.push({ type: 'modified', doc: l.map[id] }); }
      });
      Object.keys(l.map).forEach(function (id) { if (!seen[id]) { changes.push({ type: 'removed', doc: l.map[id] }); delete l.map[id]; delete l.str[id]; } });
      l.ready = true;
      var q = l.queue; l.queue = [];
      if (first || changes.length) emit(l, changes);
      q.forEach(function (x) { apply(x[0], x[1]); });
    }).catch(function (e) { if (l.err) l.err(e); });
  }
  function resyncAll() {
    Object.keys(docL).forEach(function (p) { docL[p].forEach(function (l) { loadDocListener(p, l); }); });
    Object.keys(colL).forEach(function (c) { colL[c].forEach(function (l) { loadColListener(c, l); }); });
  }

  /* ---------- API giống Firestore mà app đang dùng ---------- */
  function doc(path) {
    return {
      id: idOf(path), path: path,
      collection: function (name) { return collection(path + '/' + name); },
      get: function () { return fetchDoc(path).then(function (d) { return docSnap(path, d); }); },
      set: function (data) {
        var row = { path: path, col: colOf(path), data: data, updated_at: new Date().toISOString() };
        return sb.from('docs').upsert(row).select('path').then(function (r) {
          if (r.error) throw mkErr(r.error);
          if (!r.data || !r.data.length) throw denied();
          apply(path, clone(data));
        });
      },
      update: function (patch) {
        return sb.rpc('kk_update', { p_path: path, p_patch: patch }).then(function (r) {
          if (r.error) throw mkErr(r.error);
          return fetchDoc(path).then(function (d) { apply(path, d); });
        });
      },
      delete: function () {
        return sb.from('docs').delete().eq('path', path).then(function (r) {
          if (r.error) throw mkErr(r.error);
          apply(path, null);
        });
      },
      onSnapshot: function (cb, err) {
        var l = { cb: cb, err: err, last: undefined, ready: false };
        (docL[path] = docL[path] || []).push(l);
        loadDocListener(path, l);
        return function () { docL[path] = (docL[path] || []).filter(function (x) { return x !== l; }); };
      }
    };
  }
  function collection(col) {
    return {
      path: col,
      doc: function (id) { return doc(col + '/' + id); },
      get: function () {
        return fetchCol(col).then(function (rows) {
          var m = {}; rows.forEach(function (r) { m[idOf(r.path)] = docSnap(r.path, r.data); });
          return querySnap(m, []);
        });
      },
      onSnapshot: function (cb, err) {
        var l = { cb: cb, err: err, map: {}, str: {}, ready: false, queue: [] };
        (colL[col] = colL[col] || []).push(l);
        loadColListener(col, l);
        return function () { colL[col] = (colL[col] || []).filter(function (x) { return x !== l; }); };
      }
    };
  }
  function batch() {
    var rows = [];
    return {
      set: function (ref, data) { rows.push({ path: ref.path, col: colOf(ref.path), data: data, updated_at: new Date().toISOString() }); return this; },
      commit: function () {
        var chunks = [], i;
        for (i = 0; i < rows.length; i += 300) chunks.push(rows.slice(i, i + 300));
        return chunks.reduce(function (p, ch) {
          return p.then(function () {
            return sb.from('docs').upsert(ch).select('path').then(function (r) {
              if (r.error) throw mkErr(r.error);
              if (!r.data || r.data.length < ch.length) throw denied();
              ch.forEach(function (x) { apply(x.path, clone(x.data)); });
            });
          });
        }, Promise.resolve());
      }
    };
  }
  var db = { doc: doc, collection: collection, batch: batch };

  /* ---------- cập nhật tức thời ---------- */
  var channel = null, subscribedOnce = false;
  function startRealtime() {
    return new Promise(function (resolve) {
      var done = false; function fin() { if (!done) { done = true; resolve(); } }
      setTimeout(fin, 6000);
      channel = sb.channel('kk-docs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, function (p) {
          if (p.eventType === 'DELETE') { var op = p.old && p.old.path; if (op) apply(op, null); return; }
          var n = p.new || {};
          if (!n.path) return;
          if (n.data === undefined || (p.errors && p.errors.length)) { fetchDoc(n.path).then(function (d) { apply(n.path, d); }).catch(function () {}); return; }
          apply(n.path, n.data);
        })
        .subscribe(function (status) {
          if (status === 'SUBSCRIBED') { if (subscribedOnce) resyncAll(); subscribedOnce = true; fin(); }
          var s = $('sync');
          if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && s && /Đã/.test(s.textContent)) { s.className = 'sync busy'; s.textContent = 'Đang nối lại'; }
          if (status === 'SUBSCRIBED' && s && /nối lại/.test(s.textContent)) { s.className = 'sync ok'; s.textContent = 'Đã kết nối'; }
        });
    });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && st.started) resyncAll(); });
  window.addEventListener('online', function () { if (st.started) resyncAll(); });

  /* ---------- đăng nhập ---------- */
  var resolveReady, ready = new Promise(function (r) { resolveReady = r; });
  var st = { user: null, admin: false, started: false, starting: false };

  function showLogin(errMsg, email) {
    screen('Đăng nhập',
      '<form class="card" id="kkForm" style="max-width:420px" autocomplete="on"><h2 style="margin:0 0 6px;font-size:18px">Đăng nhập để kiểm kê</h2>' +
      '<p class="muted small" style="margin:0">Dùng email và mật khẩu quản trị đã cấp cho bạn.</p>' +
      '<label class="f" for="kkEmail">Email</label><input type="text" id="kkEmail" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" value="' + esc(email || '') + '">' +
      '<label class="f" for="kkPw">Mật khẩu</label><input type="password" id="kkPw" autocomplete="current-password">' +
      '<div id="kkErr" class="small" role="alert" style="color:var(--bad);margin-top:8px;min-height:20px">' + esc(errMsg || '') + '</div>' +
      '<button class="btn pri" id="kkLogin" type="submit" style="width:100%;margin-top:6px">Đăng nhập</button>' +
      '<p class="small muted" style="margin:10px 0 0">Quên mật khẩu? Nhờ quản trị đặt lại.</p></form>');
    var f = $('kkForm'), em = $('kkEmail'), pw = $('kkPw');
    (email ? pw : em).focus();
    f.onsubmit = function (e) {
      e.preventDefault();
      var a = em.value.trim().toLowerCase(), b = pw.value;
      if (!a || !b) { $('kkErr').textContent = 'Nhập đủ email và mật khẩu.'; return; }
      $('kkLogin').disabled = true; $('kkErr').textContent = '';
      sb.auth.signInWithPassword({ email: a, password: b }).then(function (r) {
        if (r.error) {
          var m = /invalid login/i.test(r.error.message) ? 'Email hoặc mật khẩu chưa đúng.' : /fetch|network/i.test(r.error.message) ? 'Không có mạng. Kiểm tra kết nối rồi thử lại.' : 'Không đăng nhập được: ' + r.error.message;
          showLogin(m, a);
        } else start(r.data.session);
      });
    };
  }

  function start(session) {
    if (!session || st.started || st.starting) return;
    st.starting = true; st.user = session.user;
    screen('Đang mở…', '<div class="card muted">Đang kết nối dữ liệu…</div>');
    Promise.all([sb.rpc('kk_is_admin'), startRealtime()]).then(function (r) {
      if (r[0].error) throw mkErr(r[0].error);
      st.admin = !!r[0].data; st.started = true;
      var u = st.user, email = (u.email || '').toLowerCase();
      var name = (u.user_metadata && (u.user_metadata.name || u.user_metadata.full_name)) || email;
      doc('users/' + u.id).set({ name: name, email: email, at: new Date().toISOString() }).catch(function () {});
      var h = $('storeName'); if (h) h.textContent = 'Chọn cửa hàng';
      var v = $('view'); if (v) v.innerHTML = '<div class="card muted">Đang tải…</div>';
      resolveReady();
    }).catch(function (e) {
      st.starting = false;
      screen('Lỗi kết nối', '<div class="card">Không kết nối được máy chủ (' + esc(e && e.message || e) + '). Kiểm tra mạng rồi <a href="" onclick="location.reload();return false">tải lại trang</a>.</div>');
    });
  }

  sb.auth.onAuthStateChange(function (ev, session) {
    if (ev === 'SIGNED_OUT') { if (st.started || st.starting) location.reload(); else showLogin(); }
    if (ev === 'SIGNED_IN' && session && st.started && st.user && session.user.id !== st.user.id) location.reload();
  });
  sb.auth.getSession().then(function (r) {
    var s = r.data && r.data.session;
    if (s) start(s); else showLogin();
  });

  /* ---------- các hàm cho app ---------- */
  var userApi = {
    me: function () { var u = st.user; return Promise.resolve(u ? { id: u.id, name: (u.user_metadata && u.user_metadata.name) || u.email, email: u.email } : null); },
    isOwner: function () { return Promise.resolve(st.admin); },
    can: function () { return Promise.resolve(true); },
    profiles: function (ids) {
      return sb.from('docs').select('path,data').in('path', ids.map(function (i) { return 'users/' + i; })).then(function (r) {
        var m = {}; (r.data || []).forEach(function (x) { m[idOf(x.path)] = x.data; }); return m;
      });
    }
  };
  var downloads = {
    save: function (o) {
      return new Promise(function (res) {
        var blob = o.data instanceof Blob ? o.data : new Blob([o.data]);
        var url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = o.filename || 'tai-ve'; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); res(); }, 400);
      });
    }
  };

  window.KK = {
    sb: sb, db: db,
    email: function () { return st.user && st.user.email || ''; },
    ownerNote: 'email quản trị chính ghi trong hàm kk_owner_email() của file supabase.sql',
    signOut: function () { return sb.auth.signOut(); },
    changePassword: function (pw) { return sb.auth.updateUser({ password: pw }).then(function (r) { if (r.error) throw mkErr(r.error); }); }
  };
  window.claude = {
    use: function (name) {
      return ready.then(function () { return name === 'db' ? db : name === 'user' ? userApi : name === 'downloads' ? downloads : null; });
    }
  };
})();
