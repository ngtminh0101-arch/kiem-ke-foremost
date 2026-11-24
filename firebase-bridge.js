/*
 * Cầu nối Firebase cho app Kiểm kê Foremost.
 * - Đăng nhập bằng tài khoản Google, hoặc Gmail + mật khẩu (dùng được trong Zalo).
 * - Lưu dữ liệu trên Cloud Firestore, cập nhật tức thời giữa các máy.
 * - Cung cấp cho app các hàm db / user / downloads giống bản cũ.
 * Không cần sửa file này. Chỉ cần sửa config.js và firestore.rules.
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
  var pending = new Promise(function () {});
  var cfg = window.KK_FIREBASE_CONFIG;

  if (!window.firebase || !firebase.initializeApp) {
    window.claude = { use: function () { return pending; } };
    screen('Chưa tải được Firebase', '<div class="card">Không tải được thư viện Firebase. Kiểm tra kết nối mạng rồi tải lại trang.</div>');
    return;
  }
  if (!cfg || /DAN_VAO_DAY/.test(String(cfg.apiKey))) {
    window.claude = { use: function () { return pending; } };
    screen('Chưa cấu hình', '<div class="card"><b>App chưa được nối với Firebase.</b><p class="muted">Mở file <code>public/config.js</code> và dán đoạn cấu hình lấy từ Firebase Console (xem HUONG-DAN.md, bước 3).</p></div>');
    return;
  }

  // Điện thoại: mở link trong Zalo/Messenger/Facebook thì Google chặn đăng nhập
  var UA = navigator.userAgent || '';
  var MOBILE = /Android|iPhone|iPad|iPod/i.test(UA);
  var IN_APP = /Zalo|FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\/|MicroMessenger|TikTok|; wv\)/i.test(UA);
  // iPhone: trình duyệt nhúng trong app (Zalo...) thường không có chữ Safari/ trong UA
  if (/iPhone|iPad|iPod/i.test(UA) && !/Safari\//.test(UA)) IN_APP = true;
  var HOME = 'https://' + cfg.authDomain + '/';
  var IOS = /iPhone|iPad|iPod/i.test(UA);
  // Link để bật thẳng Chrome (Android) hoặc Safari (iPhone) từ trong Zalo
  var ESCAPE = IOS ? 'x-safari-' + HOME
    : 'intent://' + cfg.authDomain + '/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(HOME) + ';end';
  if (IN_APP) {
    // Vừa mở link trong Zalo: tự bật Chrome/Safari (chỉ thử 1 lần mỗi lần mở, để bấm quay lại không bị lặp)
    try {
      if (!sessionStorage.getItem('kkEsc')) {
        sessionStorage.setItem('kkEsc', '1');
        setTimeout(function () { location.href = ESCAPE; }, 150);
      }
    } catch (e) {}
  }
  // Điện thoại đăng nhập ổn định nhất khi trang và trang đăng nhập cùng một tên miền
  if (MOBILE && !IN_APP && location.hostname !== cfg.authDomain && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    location.replace(HOME + location.search + location.hash);
    return;
  }

  firebase.initializeApp(cfg);
  var auth = firebase.auth(), db = firebase.firestore();
  var EMU = /(^|[?&])emu=1(&|$)/.test(location.search.slice(1)) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (EMU) {
    auth.useEmulator('http://127.0.0.1:9099');
    db.useEmulator('127.0.0.1', 8080);
  } else {
    // Lưu tạm trên máy để mạng chập chờn vẫn đếm được; có mạng lại sẽ tự gửi lên
    try { db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}
  }

  var resolveReady, ready = new Promise(function (r) { resolveReady = r; });
  var st = { user: null, admin: false, started: false };

  function canRead(path) {
    return db.doc(path).get().then(function () { return true; }, function (e) {
      if (e && e.code === 'permission-denied') return false;
      throw e;
    });
  }

  function errText(e) {
    var c = e && e.code || '';
    var m = {
      'auth/invalid-email': 'Email không đúng dạng.',
      'auth/missing-password': 'Hãy nhập mật khẩu.',
      'auth/weak-password': 'Mật khẩu cần ít nhất 6 ký tự.',
      'auth/email-already-in-use': 'Email này đã có tài khoản. Bấm "Quên mật khẩu" để đặt mật khẩu mới qua email.',
      'auth/invalid-credential': 'Sai email hoặc mật khẩu. Nếu chưa từng đặt mật khẩu, bấm "Tạo mật khẩu lần đầu".',
      'auth/wrong-password': 'Sai mật khẩu.',
      'auth/user-not-found': 'Email này chưa có mật khẩu. Bấm "Tạo mật khẩu lần đầu".',
      'auth/too-many-requests': 'Thử quá nhiều lần. Chờ vài phút rồi thử lại.',
      'auth/network-request-failed': 'Mất mạng. Kiểm tra kết nối rồi thử lại.',
      'auth/operation-not-allowed': 'Đăng nhập bằng mật khẩu chưa được bật. Báo quản trị.'
    };
    return m[c] || ('Không đăng nhập được' + (c ? ' (' + c + ')' : '') + '. Thử lại.');
  }

  function showLogin(err, info) {
    var google = '<button class="btn pri" id="kkLogin" type="button" style="width:100%">Đăng nhập bằng Google</button>';
    var open = '<a class="btn pri" id="kkOpen" href="' + esc(ESCAPE) + '" style="display:block;text-align:center;width:100%;box-sizing:border-box;text-decoration:none">Mở bằng ' + (IOS ? 'Safari' : 'Chrome') + ' để đăng nhập Google</a><p class="muted small" style="margin:6px 0 0">Nếu nút không mở được trình duyệt, dùng cách bên dưới.</p>';
    var pw = '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line,#ddd)">' +
      '<p style="margin:0 0 8px"><b>' + (IN_APP ? 'Hoặc đăng nhập ngay trong Zalo' : 'Hoặc đăng nhập bằng mật khẩu') + '</b></p>' +
      '<label class="small" for="kkEm">Gmail đã được cấp quyền</label><input id="kkEm" type="email" autocomplete="username" inputmode="email" style="width:100%;margin:4px 0 8px">' +
      '<label class="small" for="kkPw">Mật khẩu</label><input id="kkPw" type="password" autocomplete="current-password" style="width:100%;margin:4px 0 10px">' +
      '<button class="btn pri" id="kkPwIn" type="button" style="width:100%">Đăng nhập</button>' +
      '<div class="row" style="margin-top:8px;gap:8px"><button class="btn" id="kkPwNew" type="button" style="flex:1">Tạo mật khẩu lần đầu</button><button class="btn" id="kkPwReset" type="button" style="flex:1">Quên mật khẩu</button></div>' +
      '<p class="muted small" style="margin:8px 0 0">Lần đầu: nhập Gmail, đặt mật khẩu, bấm "Tạo mật khẩu lần đầu", rồi mở Gmail bấm link xác nhận.</p></div>';
    screen('Đăng nhập',
      '<div class="card" style="max-width:460px"><h2 style="margin:0 0 6px;font-size:18px">Đăng nhập để kiểm kê</h2>' +
      (IN_APP ? '<p class="muted" style="margin:0 0 14px">Google không cho đăng nhập Google ngay trong Zalo, Messenger, Facebook.</p>' + open
              : '<p class="muted" style="margin:0 0 14px">Dùng tài khoản Google (Gmail) đã được quản trị cấp quyền.</p>' + google) +
      pw +
      (info ? '<p class="small" role="status" style="color:var(--good,#1a7f37);margin:10px 0 0">' + esc(info) + '</p>' : '') +
      (err ? '<p class="small" role="alert" style="color:var(--bad);margin:10px 0 0">' + esc(err) + '</p>' : '') +
      '<p class="muted small" style="margin:10px 0 0;font-size:11px">Bản 24/11 e</p></div>');
    var b = $('kkLogin');
    if (b) b.onclick = function () {
      b.disabled = true;
      var p = new firebase.auth.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      if (MOBILE) { auth.signInWithRedirect(p).catch(function (e) { showLogin(errText(e)); }); return; }
      auth.signInWithPopup(p).catch(function (e) {
        var code = e && e.code || '';
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/web-storage-unsupported') return auth.signInWithRedirect(p);
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') { b.disabled = false; return; }
        showLogin(code === 'auth/unauthorized-domain' ? 'Tên miền này chưa được thêm vào Firebase (Authentication → Settings → Authorized domains).' : errText(e));
      });
    };
    function val() { return { em: ($('kkEm').value || '').trim().toLowerCase(), pw: $('kkPw').value || '' }; }
    function busy(on) { ['kkPwIn', 'kkPwNew', 'kkPwReset'].forEach(function (id) { var x = $(id); if (x) x.disabled = on; }); }
    $('kkPwIn').onclick = function () {
      var v = val(); busy(true);
      auth.signInWithEmailAndPassword(v.em, v.pw).catch(function (e) { showLogin(errText(e)); $('kkEm').value = v.em; });
    };
    $('kkPwNew').onclick = function () {
      var v = val(); busy(true);
      auth.createUserWithEmailAndPassword(v.em, v.pw).then(function (c) {
        return c.user.sendEmailVerification();
      }).catch(function (e) { showLogin(errText(e)); $('kkEm').value = v.em; });
    };
    $('kkPwReset').onclick = function () {
      var v = val();
      if (!v.em) { showLogin('Nhập Gmail trước rồi bấm "Quên mật khẩu".'); return; }
      busy(true);
      auth.sendPasswordResetEmail(v.em).then(function () {
        showLogin('', 'Đã gửi email đặt mật khẩu tới ' + v.em + '. Mở Gmail, bấm link, đặt mật khẩu, rồi quay lại đây đăng nhập.');
        $('kkEm').value = v.em;
      }, function (e) { showLogin(errText(e)); $('kkEm').value = v.em; });
    };
  }

  function showVerify(u, msg) {
    screen('Xác nhận email',
      '<div class="card" style="max-width:460px"><h2 style="margin:0 0 6px;font-size:18px">Xác nhận Gmail của bạn</h2>' +
      '<p style="margin:0 0 8px">Mình đã gửi email xác nhận tới <b>' + esc(u.email) + '</b>.</p>' +
      '<p class="muted" style="margin:0 0 14px">Mở app Gmail, bấm link trong email (xem cả mục Spam), rồi quay lại đây bấm "Tôi đã xác nhận".</p>' +
      '<button class="btn pri" id="kkVf" type="button" style="width:100%">Tôi đã xác nhận</button>' +
      '<div class="row" style="margin-top:8px;gap:8px"><button class="btn" id="kkVfAgain" type="button" style="flex:1">Gửi lại email</button><button class="btn" id="kkVfOut" type="button" style="flex:1">Đăng xuất</button></div>' +
      (msg ? '<p class="small" role="status" style="margin:10px 0 0">' + esc(msg) + '</p>' : '') + '</div>');
    $('kkVf').onclick = function () {
      u.reload().then(function () { return u.getIdToken(true); }).then(function () {
        if (auth.currentUser && auth.currentUser.emailVerified) location.reload();
        else showVerify(u, 'Chưa thấy xác nhận. Hãy bấm link trong email rồi thử lại.');
      });
    };
    $('kkVfAgain').onclick = function () { u.sendEmailVerification().then(function () { showVerify(u, 'Đã gửi lại.'); }, function (e) { showVerify(u, errText(e)); }); };
    $('kkVfOut').onclick = function () { auth.signOut(); };
  }

  function showDenied(u) {
    screen('Chưa được cấp quyền',
      '<div class="card" style="max-width:520px"><h2 style="margin:0 0 6px;font-size:18px">Tài khoản chưa được cấp quyền</h2>' +
      '<p style="margin:0 0 8px">Bạn đang đăng nhập bằng <b>' + esc(u.email || '(không có email)') + '</b>.</p>' +
      '<p class="muted" style="margin:0 0 14px">Gửi địa chỉ email này cho quản trị để được thêm vào danh sách nhân viên, rồi tải lại trang.</p>' +
      '<div class="row"><button class="btn pri" type="button" onclick="location.reload()">Tải lại</button><button class="btn" type="button" id="kkOut2">Đăng nhập tài khoản khác</button></div></div>');
    $('kkOut2').onclick = function () { auth.signOut(); };
  }

  auth.getRedirectResult().catch(function (e) { if (e && e.code) showLogin(errText(e)); });

  auth.onAuthStateChanged(function (u) {
    if (st.started) { if (!u || !st.user || u.uid !== st.user.uid) location.reload(); return; }
    st.user = u;
    if (!u) { showLogin(); return; }
    if (!u.emailVerified) { showVerify(u); return; }
    screen('Đang kiểm tra quyền…', '<div class="card muted">Đang kiểm tra quyền của tài khoản…</div>');
    Promise.all([canRead('config/roles'), canRead('gate/main')]).then(function (r) {
      if (!r[0] && !r[1]) { showDenied(u); return; }
      st.admin = r[0]; st.started = true;
      db.doc('users/' + u.uid).set({ name: u.displayName || u.email || 'Nhân viên', email: (u.email || '').toLowerCase(), at: new Date().toISOString() }, { merge: true }).catch(function () {});
      var h = $('storeName'); if (h) h.textContent = 'Chọn cửa hàng';
      var v = $('view'); if (v) v.innerHTML = '<div class="card muted">Đang tải…</div>';
      resolveReady();
    }).catch(function (e) {
      screen('Lỗi kết nối', '<div class="card">Không kết nối được máy chủ' + (e && e.code ? ' (' + esc(e.code) + ')' : '') + '. Kiểm tra mạng rồi <a href="" onclick="location.reload();return false">tải lại trang</a>.</div>');
    });
  });

  var userApi = {
    me: function () { var u = st.user; return Promise.resolve(u ? { id: u.uid, name: u.displayName || u.email, email: u.email } : null); },
    isOwner: function () { return Promise.resolve(st.admin); },
    can: function () { return Promise.resolve(true); },
    profiles: function (ids) {
      return Promise.all(ids.map(function (id) {
        return db.doc('users/' + id).get().then(function (s) { return [id, s.exists ? s.data() : null]; }, function () { return [id, null]; });
      })).then(function (rows) { var m = {}; rows.forEach(function (r) { if (r[1]) m[r[0]] = r[1]; }); return m; });
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
    auth: auth, db: db, firebase: firebase,
    email: function () { return st.user && st.user.email || ''; },
    signOut: function () { return auth.signOut(); }
  };
  window.claude = {
    use: function (name) {
      return ready.then(function () { return name === 'db' ? db : name === 'user' ? userApi : name === 'downloads' ? downloads : null; });
    }
  };
})();
