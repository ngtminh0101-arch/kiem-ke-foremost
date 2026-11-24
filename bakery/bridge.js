/*
 * Cầu nối Firebase cho app Kiểm kê Bakery.
 * - Đăng nhập bằng Google, hoặc Gmail + mật khẩu (danh sách tài khoản riêng của Bakery: bk_roles/main).
 * - Dữ liệu nằm trên Cloud Firestore, các bộ sưu tập bắt đầu bằng "bk_".
 * - Cung cấp cho app các hàm db / user / assets / downloads.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function doneBoot() { if (window.__apDone) window.__apDone(); }
  function screen(title, html) {
    doneBoot();
    var h = $('kyh'); if (h) h.textContent = title;
    var s = $('sync'); if (s) { s.className = 'sync'; s.textContent = ''; }
    document.body.classList.add('gate');
    var v = $('gate'); if (v) { v.innerHTML = html; v.hidden = false; }
  }
  function unscreen() { document.body.classList.remove('gate'); var v = $('gate'); if (v) { v.innerHTML = ''; v.hidden = true; } }
  var pending = new Promise(function () {});
  var cfg = window.KK_FIREBASE_CONFIG;

  if (!window.firebase || !firebase.initializeApp) {
    window.claude = { use: function () { return pending; } };
    screen('Chưa tải được Firebase', '<div class="pnl">Không tải được thư viện Firebase. Kiểm tra kết nối mạng rồi tải lại trang.</div>');
    return;
  }

  var UA = navigator.userAgent || '';
  var MOBILE = /Android|iPhone|iPad|iPod/i.test(UA);
  var IN_APP = /Zalo|FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\/|MicroMessenger|TikTok|; wv\)/i.test(UA);
  if (/iPhone|iPad|iPod/i.test(UA) && !/Safari\//.test(UA)) IN_APP = true;
  var IOS = /iPhone|iPad|iPod/i.test(UA);
  var HOME = 'https://kiemke-bakery.web.app/';
  var ESCAPE = IOS ? 'x-safari-' + HOME
    : 'intent://kiemke-bakery.web.app/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(HOME) + ';end';
  if (IN_APP) {
    try {
      if (!sessionStorage.getItem('kkbEsc')) { sessionStorage.setItem('kkbEsc', '1'); setTimeout(function () { location.href = ESCAPE; }, 150); }
    } catch (e) {}
  }
  // Trang riêng kiemke-bakery.web.app khác tên miền đăng nhập (authDomain) nên điện thoại cũng dùng cửa sổ bật lên
  // (không bị trình duyệt chặn lưu trữ bên thứ ba như cách chuyển hướng); bị chặn cửa sổ thì mới chuyển hướng.

  firebase.initializeApp(cfg);
  var auth = firebase.auth(), fs = firebase.firestore();
  var EMU = /(^|[?&])emu=1(&|$)/.test(location.search.slice(1)) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (EMU) { auth.useEmulator('http://127.0.0.1:9099'); fs.useEmulator('127.0.0.1', 8080); }
  // Không bật lưu đệm IndexedDB: cùng tên miền với app Foremost nên dùng chung một kho, ảnh (bk_ph) làm kho phình to
  // và khởi động chờ khoá nhiều tab tới ~20 giây. Bỏ đi thì kiểm tra quyền chỉ còn vài trăm mili giây.

  var resolveReady, ready = new Promise(function (r) { resolveReady = r; });
  var st = { user: null, admin: false, started: false };

  function canRead(path) {
    return fs.doc(path).get().then(function () { return true; }, function (e) {
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
    var open = '<a class="btn pri" id="kkOpen" href="' + esc(ESCAPE) + '" style="width:100%;text-decoration:none">Mở bằng ' + (IOS ? 'Safari' : 'Chrome') + ' để đăng nhập Google</a><p class="note" style="margin:6px 0 0">Nếu nút không mở được trình duyệt, dùng cách bên dưới.</p>';
    var pw = '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">' +
      '<p style="margin:0 0 8px"><b>' + (IN_APP ? 'Hoặc đăng nhập ngay trong Zalo' : 'Hoặc đăng nhập bằng mật khẩu') + '</b></p>' +
      '<label class="lbl" for="kkEm">Gmail đã được cấp quyền</label><input id="kkEm" type="email" autocomplete="username" inputmode="email">' +
      '<label class="lbl" for="kkPw">Mật khẩu</label><input id="kkPw" type="password" autocomplete="current-password">' +
      '<button class="btn pri" id="kkPwIn" type="button" style="width:100%;margin-top:10px">Đăng nhập</button>' +
      '<div class="row" style="margin-top:8px"><button class="btn" id="kkPwNew" type="button" style="flex:1">Tạo mật khẩu lần đầu</button><button class="btn" id="kkPwReset" type="button" style="flex:1">Quên mật khẩu</button></div>' +
      '<p class="note" style="margin:8px 0 0">Lần đầu: nhập Gmail, đặt mật khẩu, bấm "Tạo mật khẩu lần đầu", rồi mở Gmail bấm link xác nhận.</p></div>';
    screen('Đăng nhập',
      '<div class="pnl gatebox"><h2 style="margin:0;font-size:18px">Đăng nhập để kiểm kê</h2>' +
      (IN_APP ? '<p class="note" style="margin:0">Google không cho đăng nhập Google ngay trong Zalo, Messenger, Facebook.</p>' + open
              : '<p class="note" style="margin:0">Dùng tài khoản Google (Gmail) đã được quản trị app Bakery cấp quyền.</p>' + google) +
      pw +
      (info ? '<p class="note" role="status" style="color:var(--jade);margin:0">' + esc(info) + '</p>' : '') +
      (err ? '<p class="note bad" role="alert" style="margin:0">' + esc(err) + '</p>' : '') + '</div>');
    var b = $('kkLogin');
    if (b) b.onclick = function () {
      b.disabled = true;
      var p = new firebase.auth.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      auth.signInWithPopup(p).catch(function (e) {
        var code = e && e.code || '';
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/web-storage-unsupported') return auth.signInWithRedirect(p);
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') { b.disabled = false; return; }
        showLogin(code === 'auth/unauthorized-domain' ? 'Tên miền này chưa được thêm vào Firebase (Authentication → Settings → Authorized domains).' : errText(e));
      });
    };
    function val() { return { em: ($('kkEm').value || '').trim().toLowerCase(), pw: $('kkPw').value || '' }; }
    function busy(on) { ['kkPwIn', 'kkPwNew', 'kkPwReset'].forEach(function (id) { var x = $(id); if (x) x.disabled = on; }); }
    $('kkPwIn').onclick = function () { var v = val(); busy(true); auth.signInWithEmailAndPassword(v.em, v.pw).catch(function (e) { showLogin(errText(e)); $('kkEm').value = v.em; }); };
    $('kkPwNew').onclick = function () {
      var v = val(); busy(true);
      auth.createUserWithEmailAndPassword(v.em, v.pw).then(function (c) { return c.user.sendEmailVerification(); }).catch(function (e) { showLogin(errText(e)); $('kkEm').value = v.em; });
    };
    $('kkPwReset').onclick = function () {
      var v = val();
      if (!v.em) { showLogin('Nhập Gmail trước rồi bấm "Quên mật khẩu".'); return; }
      busy(true);
      auth.sendPasswordResetEmail(v.em).then(function () { showLogin('', 'Đã gửi email đặt mật khẩu tới ' + v.em + '. Mở Gmail, bấm link, đặt mật khẩu, rồi quay lại đây đăng nhập.'); $('kkEm').value = v.em; },
        function (e) { showLogin(errText(e)); $('kkEm').value = v.em; });
    };
  }

  function showVerify(u, msg) {
    screen('Xác nhận email',
      '<div class="pnl gatebox"><h2 style="margin:0;font-size:18px">Xác nhận Gmail của bạn</h2>' +
      '<p style="margin:0">Đã gửi email xác nhận tới <b>' + esc(u.email) + '</b>. Mở Gmail, bấm link trong email (xem cả mục Spam), rồi quay lại đây bấm "Tôi đã xác nhận".</p>' +
      '<button class="btn pri" id="kkVf" type="button" style="width:100%">Tôi đã xác nhận</button>' +
      '<div class="row"><button class="btn" id="kkVfAgain" type="button" style="flex:1">Gửi lại email</button><button class="btn" id="kkVfOut" type="button" style="flex:1">Đăng xuất</button></div>' +
      (msg ? '<p class="note" role="status" style="margin:0">' + esc(msg) + '</p>' : '') + '</div>');
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
      '<div class="pnl gatebox"><h2 style="margin:0;font-size:18px">Tài khoản chưa được cấp quyền</h2>' +
      '<p style="margin:0">Bạn đang đăng nhập bằng <b>' + esc(u.email || '(không có email)') + '</b>. Gửi địa chỉ email này cho quản trị để được thêm vào danh sách (mục Tài khoản được phép trong app Kiểm kê Bakery), rồi tải lại trang.</p>' +
      '<div class="row"><button class="btn pri" type="button" onclick="location.reload()">Tải lại</button><button class="btn" type="button" id="kkOut2">Đăng nhập tài khoản khác</button></div></div>');
    $('kkOut2').onclick = function () { auth.signOut(); };
  }

  auth.getRedirectResult().catch(function (e) { if (e && e.code) showLogin(errText(e)); });

  auth.onAuthStateChanged(function (u) {
    if (st.started) { if (!u || !st.user || u.uid !== st.user.uid) location.reload(); return; }
    st.user = u;
    if (!u) { showLogin(); return; }
    if (!u.emailVerified) { showVerify(u); return; }
    screen('Đang kiểm tra quyền…', '<div class="pnl note">Đang kiểm tra quyền của tài khoản…</div>');
    Promise.all([canRead('bk_roles/main'), canRead('bk_cfg/main')]).then(function (r) {
      if (!r[1]) { showDenied(u); return; }
      st.admin = r[0]; st.started = true;
      fs.doc('bk_users/' + u.uid).set({ name: u.displayName || u.email || 'Nhân viên', email: (u.email || '').toLowerCase(), at: new Date().toISOString() }, { merge: true }).catch(function () {});
      unscreen();
      resolveReady();
    }).catch(function (e) {
      screen('Lỗi kết nối', '<div class="pnl gatebox">Không kết nối được máy chủ' + (e && e.code ? ' (' + esc(e.code) + ')' : '') + '. Kiểm tra mạng rồi <a href="" onclick="location.reload();return false">tải lại trang</a>.</div>');
    });
  });

  /* ===== db: giữ đúng cách dùng của bản cũ (doc/collection, onSnapshot, get, set, update gộp sâu) ===== */
  var DEL = firebase.firestore.FieldValue.delete();
  function P(p) { return 'bk_' + p; }
  function plain(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function strip(o) { var r = {}; Object.keys(o).forEach(function (k) { var v = o[k]; if (v === null || v === undefined) return; r[k] = plain(v) ? strip(v) : v; }); return r; }
  // Ghi gộp: số đếm theo kỳ và mã mới ghi đè từng dòng; đơn vị (u) và ảnh (p) ghi đè từng mục con.
  function flatten(body) {
    var out = [];
    function walk(path, v, depth) {
      if (depth > 0 && plain(v) && Object.keys(v).length) { Object.keys(v).forEach(function (k) { walk(path.concat(k), v[k], depth - 1); }); return; }
      out.push([path, v === null || v === undefined ? DEL : (plain(v) ? strip(v) : v)]);
    }
    Object.keys(body).forEach(function (k) { walk([k], body[k], k === 'u' || k === 'p' ? 2 : 1); });
    return out;
  }
  function mapErr(e) { if (e && e.code === 'permission-denied') { var x = new Error('denied'); x.code = 'invalid_argument'; throw x; } throw e; }
  // Danh mục dùng mảng lồng nhau (Firestore không cho), nên lưu cả danh mục dưới dạng chuỗi JSON trong trường "j"
  function isDm(p) { return /^dm\//.test(p); }
  function wrapSnap(s, p) {
    return { exists: s.exists, data: function () { var d = s.data(); if (d && isDm(p) && typeof d.j === 'string') { try { return JSON.parse(d.j); } catch (e) { return { groups: [] }; } } return d; } };
  }
  function docRef(p) {
    var r = fs.doc(P(p));
    return {
      onSnapshot: function (cb, er) { return r.onSnapshot(function (s) { cb(wrapSnap(s, p)); }, er); },
      get: function () { return r.get().then(function (s) { return wrapSnap(s, p); }, mapErr); },
      set: function (b) { return r.set(isDm(p) ? { j: JSON.stringify(b), at: new Date().toISOString() } : strip(b)).catch(mapErr); },
      update: function (b) {
        var f = flatten(b), args = [];
        if (!f.length) return Promise.resolve();
        f.forEach(function (x) { args.push(new firebase.firestore.FieldPath(x[0][0], ...x[0].slice(1)), x[1]); });
        return r.update.apply(r, args).catch(mapErr);
      },
      delete: function () { return r.delete().catch(mapErr); }
    };
  }
  var dbApi = {
    doc: docRef,
    collection: function (c) {
      var r = fs.collection(P(c));
      return {
        onSnapshot: function (cb, er) { return r.onSnapshot(function (s) { cb({ docs: s.docs.map(function (d) { return { id: d.id, data: function () { return d.data(); } }; }) }); }, er); },
        get: function () { return r.get().then(function (s) { return { docs: s.docs.map(function (d) { return { id: d.id, data: function () { return d.data(); } }; }) }; }); }
      };
    }
  };

  /* ===== ảnh: lưu thẳng trong Firestore (bk_ph), không cần Firebase Storage ===== */
  var imgCache = {};
  function hex32() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function toDataUrl(blob) { return new Promise(function (ok, no) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.onerror = function () { no(fr.error); }; fr.readAsDataURL(blob); }); }
  var assetsApi = {
    upload: function (blob) {
      return toDataUrl(blob).then(function (d) {
        if (d.length > 1000000) { var e = new Error('big'); e.code = 'too_large'; throw e; }
        var id = hex32();
        imgCache[id] = Promise.resolve(d);
        return fs.doc('bk_ph/' + id).set({ d: d, by: st.user.uid, t: new Date().toISOString() }).then(function () { return { id: id }; }, function (e) { if (e && e.code === 'permission-denied') e = { code: 'not_granted' }; throw e; });
      });
    },
    delete: function (id) { delete imgCache[id]; return fs.doc('bk_ph/' + id).delete(); }
  };
  window.KKB_IMG = function (id) {
    if (!imgCache[id]) imgCache[id] = fs.doc('bk_ph/' + id).get().then(function (s) { return s.exists ? s.data().d : ''; }, function () { delete imgCache[id]; return ''; });
    return imgCache[id];
  };

  var userApi = {
    me: function () { var u = st.user; return Promise.resolve(u ? { id: u.uid, name: u.displayName || u.email, email: u.email, avatarUrl: u.photoURL || '' } : null); },
    can: function () { return Promise.resolve(true); },
    canEdit: function () { return st.admin; },
    profiles: function (ids) {
      return Promise.all(ids.map(function (id) {
        return fs.doc('bk_users/' + id).get().then(function (s) { return [id, s.exists ? s.data() : null]; }, function () { return [id, null]; });
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

  window.KKB = {
    fs: fs, firebase: firebase,
    isAdmin: function () { return st.admin; },
    email: function () { return st.user && st.user.email || ''; },
    signOut: function () { return auth.signOut(); }
  };
  window.claude = {
    use: function (name) {
      return ready.then(function () { return name === 'db' ? dbApi : name === 'user' ? userApi : name === 'downloads' ? downloads : name === 'assets' ? assetsApi : null; });
    }
  };
})();
