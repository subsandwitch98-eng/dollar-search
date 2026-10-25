(function () {
  'use strict';

  // ---- Connection to Supabase (accounts + database) ----
  var cfg = window.DOLLAR_SEARCH_CONFIG || {};
  var keyReady = typeof cfg.supabaseKey === 'string' && cfg.supabaseKey && !/^PASTE/.test(cfg.supabaseKey);
  var client = window.supabase && cfg.supabaseUrl && keyReady
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey)
    : null;
  var SITE_URL = location.origin + location.pathname;

  // ---- Profile pictures: an uploaded photo (small JPEG data URL) or a character built from these options ----
  var CHAR = {
    skin: ['#FCE3D3', '#F5CDB4', '#E5AF8C', '#C98E6A', '#9C6646', '#6E4630'],
    hairStyle: ['Short', 'Spiky', 'Long', 'Bun', 'Curly'],
    bangs: ['None', 'Straight', 'Side', 'Wispy'],
    hairColor: ['#2E2226', '#5B3A29', '#A0643B', '#E3B562', '#E58FA8', '#8E7CC3'],
    top: ['#F7C8D4', '#D2728F', '#8EC5E8', '#9BD3AE', '#F4D35E', '#4A4E69'],
    headwear: ['None', 'Cap', 'Beanie', 'Headphones'],
    glasses: ['None', 'Glasses', 'Shades'],
    face: ['Smile', 'Grin', 'Cool'],
    bg: ['#FBE3E6', '#FFF1D6', '#DDF0FA', '#E3F4E6', '#ECE6FA', '#FFFCF7']
  };
  var CHAR_KEYS = ['skin', 'hairStyle', 'bangs', 'hairColor', 'top', 'headwear', 'glasses', 'face', 'bg'];
  var DEFAULT_CHAR = { skin: 1, hairStyle: 0, bangs: 0, hairColor: 1, top: 0, headwear: 1, glasses: 0, face: 0, bg: 0 };
  var PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;

  function normalizeCharacter(src) {
    var c = {};
    src = src && typeof src === 'object' ? src : {};
    CHAR_KEYS.forEach(function (k) {
      var v = src[k];
      c[k] = typeof v === 'number' && Math.floor(v) === v && v >= 0 && v < CHAR[k].length ? v : DEFAULT_CHAR[k];
    });
    return c;
  }
  function normalizeAvatar(a) {
    if (!a || typeof a !== 'object') return null;
    if (a.mode === 'photo') {
      return typeof a.photo === 'string' && a.photo.length < 200000 && PHOTO_RE.test(a.photo)
        ? { mode: 'photo', photo: a.photo } : null;
    }
    if (a.mode === 'character') return { mode: 'character', character: normalizeCharacter(a.character) };
    return null;
  }

  // ---- State, loaded from the database ----
  var state = { hubName: 'Dollar Search', hubIntro: '', profiles: [], likes: [], follows: [] };
  var me = null;          // the signed-in account, or null
  var isAdmin = false;    // can edit the homepage, add several profiles and remove any profile
  var seenAt = 0;         // notifications read up to this time (ms)
  var loaded = false;
  var loadError = '';

  function normalizeSources(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (s) { return s && typeof s.link === 'string' && s.link; }).map(function (s) {
      return { name: typeof s.name === 'string' ? s.name : '', link: s.link };
    });
  }
  function toProject(r) {
    return {
      id: r.id, profileId: r.profile_id, title: r.title || '', link: r.link || '',
      description: r.description || '', sources: normalizeSources(r.sources),
      createdAt: Date.parse(r.created_at) || 0
    };
  }

  function loadAll() {
    return Promise.all([
      client.from('site_settings').select('hub_name, hub_intro').eq('id', 1).maybeSingle(),
      client.from('profiles').select('id, owner_id, name, description, email, avatar, created_at').order('created_at'),
      client.from('projects').select('id, profile_id, title, link, description, sources, created_at').order('created_at'),
      client.from('likes').select('user_id, profile_id'),
      client.from('follows').select('user_id, profile_id, created_at')
    ]).then(function (res) {
      res.forEach(function (r) { if (r.error) throw r.error; });
      if (res[0].data) {
        state.hubName = res[0].data.hub_name || 'Dollar Search';
        state.hubIntro = res[0].data.hub_intro || '';
      }
      var projects = res[2].data.map(toProject);
      state.profiles = res[1].data.map(function (r) {
        return {
          id: r.id, ownerId: r.owner_id, name: r.name || 'Untitled profile',
          description: r.description || '', email: r.email || '', avatar: normalizeAvatar(r.avatar),
          projects: projects.filter(function (q) { return q.profileId === r.id; })
        };
      });
      state.likes = res[3].data.map(function (l) { return { userId: l.user_id, profileId: l.profile_id }; });
      state.follows = res[4].data.map(function (f) {
        return { userId: f.user_id, profileId: f.profile_id, since: Date.parse(f.created_at) || 0 };
      });
      if (!me) { isAdmin = false; seenAt = 0; return; }
      return Promise.all([
        client.from('site_admins').select('user_id').eq('user_id', me.id).maybeSingle(),
        client.from('notif_state').select('seen_at').eq('user_id', me.id).maybeSingle()
      ]).then(function (extra) {
        isAdmin = !!(extra[0].data);
        seenAt = extra[1].data ? (Date.parse(extra[1].data.seen_at) || 0) : 0;
      });
    });
  }

  var refreshing = null;
  function refresh() {
    if (!client) { loaded = true; renderAll(); return Promise.resolve(); }
    if (refreshing) return refreshing;
    refreshing = loadAll().then(function () {
      loadError = '';
      loaded = true;
    }, function (err) {
      console.error(err);
      loadError = 'The site could not load its profiles. Check your connection, then refresh the page.';
      loaded = true;
    }).then(function () {
      refreshing = null;
      renderAll();
    });
    return refreshing;
  }

  function dbMessage(err) {
    var code = err && err.code;
    var msg = (err && err.message) || '';
    if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
      return 'You are not allowed to do that. Make sure you are signed in to the right account.';
    }
    if (code === '23514') return 'Some of the text is too long. Shorten it and save again.';
    if (code === '23505') return 'That is already saved.';
    return 'Saving failed. Check your connection and try again.';
  }

  // ---- Small helpers ----
  function $(id) { return document.getElementById(id); }
  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function setBusy(buttons, on) { buttons.forEach(function (b) { b.disabled = on; }); }
  function statusLine(text) {
    var s = make('p', 'edit-status', text);
    s.setAttribute('aria-live', 'polite');
    return s;
  }
  function hostOf(href) { return new URL(href).hostname.replace(/^www\./, ''); }
  // Returns a safe http(s) address, '' for no link, or null when the text isn't a usable web address.
  function cleanLink(raw) {
    var text = (raw || '').trim();
    if (!text) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = 'https://' + text;
    try {
      var url = new URL(text);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.indexOf('.') > 0) return url.href;
    } catch (e) {}
    return null;
  }
  function validEmail(text) { return !text || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text); }
  function field(labelText, control, id) {
    var label = make('label', 'edit-label', labelText);
    label.htmlFor = id;
    control.id = id;
    return [label, control];
  }
  function textInput(maxLength, value) {
    var i = make('input');
    i.type = 'text';
    i.maxLength = maxLength;
    i.autocomplete = 'off';
    i.value = value || '';
    return i;
  }
  function textArea(maxLength, value) {
    var t = make('textarea');
    t.rows = 4;
    t.maxLength = maxLength;
    t.value = value || '';
    return t;
  }
  // A leading "$" gets the accent color, as in the original logo.
  function paintName(el, name) {
    el.textContent = '';
    if (name.charAt(0) === '$') {
      el.appendChild(make('span', 'dollar', '$'));
      el.appendChild(document.createTextNode(name.slice(1)));
    } else {
      el.textContent = name;
    }
  }

  function findProfile(id) {
    for (var i = 0; i < state.profiles.length; i++) {
      if (state.profiles[i].id === id) return state.profiles[i];
    }
    return null;
  }
  function canEdit(p) { return !!me && p.ownerId === me.id; }
  function canRemove(p) { return canEdit(p) || isAdmin; }
  // Everyone, admins included, gets one portfolio; it can hold any number of research projects.
  function canCreate() {
    return !!me && !state.profiles.some(function (p) { return p.ownerId === me.id; });
  }
  function countFor(list, profileId) {
    return list.filter(function (r) { return r.profileId === profileId; }).length;
  }
  function mine(list, profileId) {
    if (!me) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].userId === me.id && list[i].profileId === profileId) return list[i];
    }
    return null;
  }

  // ---- Drawing profile pictures ----
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function renderCharacter(c, label) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    function add(tag, attrs) {
      var n = document.createElementNS(SVG_NS, tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
    }
    var skin = CHAR.skin[c.skin], hair = CHAR.hairColor[c.hairColor], top = CHAR.top[c.top];
    var ink = '#3A2A30';
    function line(d) { return { d: d, fill: 'none', stroke: ink, 'stroke-width': 2.4, 'stroke-linecap': 'round' }; }

    add('rect', { width: 120, height: 120, fill: CHAR.bg[c.bg] });
    if (c.hairStyle === 2) add('path', { d: 'M34 54 C34 26 86 26 86 54 L89 92 L72 92 L72 64 L48 64 L48 92 L31 92 Z', fill: hair });
    // Shoulders, neck, ears, head
    add('path', { d: 'M18 120 C18 94 38 86 60 86 C82 86 102 94 102 120 Z', fill: top });
    add('rect', { x: 52, y: 72, width: 16, height: 16, rx: 6, fill: skin });
    add('path', { d: 'M50 87 Q60 96 70 87', fill: 'none', stroke: 'rgba(0,0,0,0.12)', 'stroke-width': 3, 'stroke-linecap': 'round' });
    add('circle', { cx: 36.5, cy: 59, r: 5, fill: skin });
    add('circle', { cx: 83.5, cy: 59, r: 5, fill: skin });
    add('circle', { cx: 60, cy: 56, r: 24, fill: skin });
    // Hair: a cap slightly wider than the head so no skin shows above the hairline
    if (c.hairStyle === 0 || c.hairStyle === 2 || c.hairStyle === 3 || c.hairStyle === 4) {
      add('path', { d: 'M34 57 A26 26 0 0 1 86 57 C80 45 69 40 60 41 C51 40 40 45 34 57 Z', fill: hair });
    }
    if (c.hairStyle === 1) {
      add('path', { d: 'M34 57 L34 40 L41 39 L44 26 L53 30 L60 20 L67 31 L76 25 L78 38 L86 42 L86 57 C80 45 70 40 60 41 C50 40 40 45 34 57 Z', fill: hair });
    }
    if (c.hairStyle === 3) add('circle', { cx: 60, cy: 27, r: 9, fill: hair });
    if (c.hairStyle === 4) {
      [[39, 47, 9], [45, 37, 10], [57, 32, 11], [70, 35, 10], [80, 45, 9]].forEach(function (b) {
        add('circle', { cx: b[0], cy: b[1], r: b[2], fill: hair });
      });
    }
    // Bangs across the forehead, stopping above the eyes
    if (c.bangs === 1) add('path', { d: 'M37 52 C36 33 84 33 83 52 Q78 48.5 73 52 Q67 48.5 61 52 Q55 48.5 49 52 Q43 48.5 37 52 Z', fill: hair });
    if (c.bangs === 2) add('path', { d: 'M37 51 C36 33 84 31 84 49 C76 45 66 46 57 50 C50 53 43 54 37 51 Z', fill: hair });
    if (c.bangs === 3) add('path', { d: 'M37 50 C36 33 84 33 83 50 L79 46 L76 52 L71 46 L66 52 L61 46 L56 52 L51 46 L46 52 L42 46 Z', fill: hair });
    // Face
    add('circle', { cx: 47, cy: 66, r: 4, fill: '#F29BB2', opacity: 0.45 });
    add('circle', { cx: 73, cy: 66, r: 4, fill: '#F29BB2', opacity: 0.45 });
    if (c.glasses !== 2) {
      add('circle', { cx: 51, cy: 58, r: 2.6, fill: ink });
      add('circle', { cx: 69, cy: 58, r: 2.6, fill: ink });
    }
    if (c.face === 0) add('path', line('M52 67 Q60 74 68 67'));
    if (c.face === 1) add('path', { d: 'M51 66 Q60 77 69 66 Z', fill: '#FFFFFF', stroke: ink, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    if (c.face === 2) add('path', line('M53 69 Q61 71 68 66'));
    if (c.glasses === 1) {
      add('circle', { cx: 51, cy: 58, r: 6.5, fill: 'none', stroke: ink, 'stroke-width': 2 });
      add('circle', { cx: 69, cy: 58, r: 6.5, fill: 'none', stroke: ink, 'stroke-width': 2 });
      add('path', { d: 'M57.5 58 L62.5 58', stroke: ink, 'stroke-width': 2 });
    }
    if (c.glasses === 2) {
      add('rect', { x: 43, y: 53, width: 15, height: 10, rx: 4, fill: ink });
      add('rect', { x: 62, y: 53, width: 15, height: 10, rx: 4, fill: ink });
      add('path', { d: 'M58 57 L62 57', stroke: ink, 'stroke-width': 2 });
    }
    // Headwear, in the outfit color
    if (c.headwear === 1) {
      add('path', { d: 'M35 52 C35 28 85 28 85 52 Z', fill: top });
      add('path', { d: 'M80 49 L101 52 Q102 56 98 57 L80 54 Z', fill: top });
      add('rect', { x: 35, y: 49, width: 50, height: 5, rx: 2.5, fill: 'rgba(0,0,0,0.14)' });
    }
    if (c.headwear === 2) {
      add('path', { d: 'M34 52 C34 24 86 24 86 52 Z', fill: top });
      add('rect', { x: 33, y: 46, width: 54, height: 9, rx: 4.5, fill: top });
      add('rect', { x: 33, y: 46, width: 54, height: 9, rx: 4.5, fill: 'rgba(255,255,255,0.3)' });
      add('circle', { cx: 60, cy: 24, r: 5.5, fill: '#FFFFFF' });
    }
    if (c.headwear === 3) {
      add('path', { d: 'M33 60 C33 22 87 22 87 60', fill: 'none', stroke: ink, 'stroke-width': 5, 'stroke-linecap': 'round' });
      add('rect', { x: 27, y: 51, width: 11, height: 18, rx: 5, fill: top });
      add('rect', { x: 82, y: 51, width: 11, height: 18, rx: 5, fill: top });
    }
    return svg;
  }
  function pictureNode(avatar, name) {
    if (!avatar) return null;
    if (avatar.mode === 'photo') {
      var img = make('img');
      img.src = avatar.photo;
      img.alt = name + "'s profile picture";
      return img;
    }
    return renderCharacter(avatar.character, name + "'s character");
  }
  // Crops a chosen image to a centered square and shrinks it to a small JPEG.
  function loadPhoto(file, onDone, onError) {
    if (!file || !/^image\//.test(file.type)) { onError('Choose an image file, such as a JPG or PNG.'); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var size = 320;
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var side = Math.min(img.naturalWidth, img.naturalHeight);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      try { onDone(canvas.toDataURL('image/jpeg', 0.85)); } catch (e) { onError('That image could not be used. Try a different photo.'); }
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      onError('That image could not be opened. Try a JPG or PNG photo.');
    };
    img.src = url;
  }

  // ---- Views and addresses: the homepage is "./", a profile is "./?p=<id>" ----
  var homeView = $('home-view');
  var profileView = $('profile-view');
  var navProfiles = $('nav-profiles');
  var navHome = $('nav-home');
  var navResearch = $('nav-research');
  var navContact = $('nav-contact');
  var currentId = new URLSearchParams(location.search).get('p');

  function showHome(push) {
    currentId = null;
    if (push) history.pushState(null, '', location.pathname);
    closePicEditor();
    closeProfileEditor();
    homeView.hidden = false;
    profileView.hidden = true;
    navProfiles.hidden = false;
    navHome.hidden = true;
    navResearch.hidden = true;
    navContact.hidden = true;
    renderHome();
    window.scrollTo(0, 0);
  }
  function showProfile(id, push) {
    if (!findProfile(id)) { showHome(push); return; }
    currentId = id;
    if (push) history.pushState(null, '', location.pathname + '?p=' + encodeURIComponent(id));
    editingId = null;
    addingProfile = false;
    closeHubForm();
    closePicEditor();
    closeProfileEditor();
    homeView.hidden = true;
    profileView.hidden = false;
    navProfiles.hidden = true;
    navHome.hidden = false;
    navResearch.hidden = false;
    renderProfile();
    window.scrollTo(0, 0);
  }
  function route() {
    var id = new URLSearchParams(location.search).get('p');
    if (id && findProfile(id)) showProfile(id, false); else showHome(false);
  }
  window.addEventListener('popstate', route);
  function goHome(e) { if (e) e.preventDefault(); showHome(true); }
  $('brand-name').addEventListener('click', goHome);
  navHome.addEventListener('click', goHome);
  $('back-home').addEventListener('click', goHome);

  // ---- Homepage ----
  var hubNameEl = $('hub-name');
  var hubIntroEl = $('hub-intro');
  var hubCount = $('hub-count');
  var editHubBtn = $('edit-hub');
  var hubForm = $('hub-form');
  var hubNameInput = $('hub-name-input');
  var hubIntroInput = $('hub-intro-input');
  var hubSave = $('hub-save');
  var hubCancel = $('hub-cancel');
  var hubStatus = $('hub-status');
  var profileList = $('profile-list');
  var profilesEmpty = $('profiles-empty');
  var loadNote = $('load-note');
  var filterEl = $('profile-filter');
  var filterAll = $('filter-all');
  var filterFollowing = $('filter-following');
  var homeFilter = 'all';
  var addingProfile = false;

  function renderHome() {
    var list = state.profiles;
    paintName(hubNameEl, state.hubName);
    hubIntroEl.textContent = state.hubIntro;
    hubCount.textContent = plural(list.length, 'profile');
    editHubBtn.hidden = !isAdmin || !hubForm.hidden;

    if (!client) {
      loadNote.textContent = 'This site is not connected to its database yet.';
      loadNote.hidden = false;
    } else {
      loadNote.textContent = loadError || 'Loading profiles…';
      loadNote.hidden = loaded && !loadError;
    }

    // "Following" shows up once you follow at least one profile.
    var followed = list.filter(function (p) { return mine(state.follows, p.id); });
    filterEl.hidden = !followed.length;
    if (!followed.length) homeFilter = 'all';
    filterAll.setAttribute('aria-pressed', homeFilter === 'all' ? 'true' : 'false');
    filterFollowing.setAttribute('aria-pressed', homeFilter === 'following' ? 'true' : 'false');
    filterFollowing.textContent = 'Following (' + followed.length + ')';
    var shown = homeFilter === 'following' ? followed : list;

    profileList.textContent = '';
    if (!loaded || loadError || !client) { profilesEmpty.hidden = true; return; }
    shown.forEach(function (p) { profileList.appendChild(profileCard(p)); });
    var addCard = null;
    if (homeFilter === 'all') {
      if (canCreate()) addCard = addingProfile ? newProfileForm() : addProfileCard('+ Create my profile', false);
      else if (!me) addCard = addProfileCard('+ Create your profile', true);
    }
    if (addCard) profileList.appendChild(addCard);
    profileList.hidden = !shown.length && !addCard;
    profilesEmpty.hidden = shown.length > 0 || !!addCard;
  }
  filterAll.addEventListener('click', function () { homeFilter = 'all'; renderHome(); });
  filterFollowing.addEventListener('click', function () { homeFilter = 'following'; renderHome(); });

  function profileCard(p) {
    var card = make('article', 'profile-card');
    var top = make('div', 'profile-top');
    var picture = pictureNode(p.avatar, p.name);
    var avatar = make('span', 'avatar', picture ? null : p.name.charAt(0).toUpperCase());
    if (picture) avatar.appendChild(picture);
    avatar.setAttribute('aria-hidden', 'true');
    var who = make('div');
    who.style.minWidth = '0';
    var name = make('h3', 'profile-name');
    paintName(name, p.name);
    who.appendChild(name);
    var meta = make('p', 'profile-meta');
    meta.appendChild(make('span', null, plural(p.projects.length, 'research project')));
    meta.appendChild(make('span', null, '♥ ' + countFor(state.likes, p.id)));
    meta.appendChild(make('span', null, plural(countFor(state.follows, p.id), 'follower')));
    if (canEdit(p)) meta.appendChild(make('span', 'you-badge', 'Your profile'));
    who.appendChild(meta);
    top.appendChild(avatar);
    top.appendChild(who);
    card.appendChild(top);
    if (p.description) card.appendChild(make('p', 'profile-desc', p.description));
    var open = make('button', 'btn btn-solid profile-open', 'View profile →');
    open.type = 'button';
    open.setAttribute('aria-label', 'View ' + p.name);
    open.addEventListener('click', function () { showProfile(p.id, true); });
    card.appendChild(open);
    return card;
  }

  function addProfileCard(label, needsSignIn) {
    var b = make('button', 'add-card', label);
    b.type = 'button';
    b.addEventListener('click', function () {
      if (needsSignIn) { openAuth('signup', 'Create a free account to make your own profile.'); return; }
      addingProfile = true;
      renderHome();
      var first = $('new-profile-name');
      if (first) first.focus();
    });
    return b;
  }

  function newProfileForm() {
    var f = make('form', 'project project-form');
    var nameIn = textInput(60, '');
    var descIn = textArea(300, '');
    var emailIn = textInput(120, '');
    emailIn.inputMode = 'email';
    field('Profile name', nameIn, 'new-profile-name')
      .concat(field('Description', descIn, 'new-profile-desc'))
      .concat(field('Contact email (optional)', emailIn, 'new-profile-email'))
      .forEach(function (node) { f.appendChild(node); });
    var actions = make('div', 'edit-actions');
    var save = make('button', 'btn btn-solid', 'Create profile');
    save.type = 'submit';
    var cancel = make('button', 'btn btn-ghost', 'Cancel');
    cancel.type = 'button';
    actions.appendChild(save);
    actions.appendChild(cancel);
    f.appendChild(actions);
    var statusEl = statusLine('Everyone who visits the site can see your profile. Only you can change it.');
    f.appendChild(statusEl);

    cancel.addEventListener('click', function () { addingProfile = false; renderHome(); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = nameIn.value.trim();
      var email = emailIn.value.trim();
      if (!n) { statusEl.textContent = 'Write a profile name before saving.'; nameIn.focus(); return; }
      if (!validEmail(email)) {
        statusEl.textContent = 'That email address does not look right. Check it, or leave it blank.';
        emailIn.focus();
        return;
      }
      setBusy([save, cancel], true);
      statusEl.textContent = 'Saving…';
      client.from('profiles').insert({ name: n, description: descIn.value.trim(), email: email })
        .select('id').single().then(function (res) {
          setBusy([save, cancel], false);
          if (res.error) { statusEl.textContent = dbMessage(res.error); return; }
          addingProfile = false;
          refresh().then(function () { showProfile(res.data.id, true); });
        });
    });
    return f;
  }

  editHubBtn.addEventListener('click', function () {
    hubNameInput.value = state.hubName;
    hubIntroInput.value = state.hubIntro;
    hubStatus.textContent = 'Name up to 60 characters, intro up to 300.';
    hubIntroEl.hidden = true;
    editHubBtn.hidden = true;
    hubForm.hidden = false;
    hubNameInput.focus();
  });
  function closeHubForm() {
    hubForm.hidden = true;
    hubIntroEl.hidden = false;
    editHubBtn.hidden = !isAdmin;
  }
  hubCancel.addEventListener('click', function () { closeHubForm(); editHubBtn.focus(); });
  hubForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var n = hubNameInput.value.trim();
    if (!n) { hubStatus.textContent = 'Write a homepage name before saving.'; hubNameInput.focus(); return; }
    var intro = hubIntroInput.value.trim();
    setBusy([hubSave, hubCancel], true);
    hubStatus.textContent = 'Saving…';
    client.from('site_settings').update({ hub_name: n, hub_intro: intro }).eq('id', 1).then(function (res) {
      setBusy([hubSave, hubCancel], false);
      if (res.error) { hubStatus.textContent = dbMessage(res.error); return; }
      closeHubForm();
      refresh();
    });
  });

  // ---- Profile: name, description, contact, delete ----
  var siteName = $('site-name');
  var lede = $('lede');
  var editBtn = $('edit-desc');
  var removeBtn = $('remove-profile');
  var form = $('edit-form');
  var nameInput = $('name-input');
  var input = $('desc-input');
  var emailInput = $('email-input');
  var saveBtn = $('edit-save');
  var cancelBtn = $('edit-cancel');
  var deleteBtn = $('profile-delete');
  var editStatus = $('edit-status');
  var contactSection = $('contact');
  var ctaContact = $('cta-contact');
  var addr = $('email-addr');
  var deleteArmed = false;
  var removeArmed = false;

  function current() { return findProfile(currentId); }

  function renderProfile() {
    var p = current();
    if (!p) return;
    document.title = p.name + ' · ' + state.hubName;
    paintName(siteName, p.name);
    lede.textContent = p.description;
    var editorOpen = !form.hidden || !picForm.hidden;
    editBtn.hidden = !canEdit(p) || editorOpen;
    picBtn.hidden = !canEdit(p) || editorOpen;
    // An admin can take down someone else's profile but not edit it.
    removeBtn.hidden = !(isAdmin && !canEdit(p));
    paintPortrait(p.avatar, p.name);
    renderProfileReactions();
    addr.textContent = p.email;
    contactSection.hidden = !p.email;
    ctaContact.hidden = !p.email;
    navContact.hidden = !p.email;
    renderProjects();
  }

  function resetDelete() {
    deleteArmed = false;
    deleteBtn.textContent = 'Delete profile';
    deleteBtn.classList.remove('armed');
  }
  function resetRemove() {
    removeArmed = false;
    removeBtn.textContent = 'Remove this profile';
    removeBtn.classList.remove('armed');
  }
  function closeProfileEditor() {
    form.hidden = true;
    lede.hidden = false;
    resetDelete();
    resetRemove();
  }
  editBtn.addEventListener('click', function () {
    var p = current();
    nameInput.value = p.name;
    input.value = p.description;
    emailInput.value = p.email;
    editStatus.textContent = 'Name up to 60 characters, description up to 300.';
    resetDelete();
    lede.hidden = true;
    editBtn.hidden = true;
    picBtn.hidden = true;
    form.hidden = false;
    nameInput.focus();
  });
  cancelBtn.addEventListener('click', function () { closeProfileEditor(); renderProfile(); editBtn.focus(); });

  function deleteProfile(p, statusEl, buttons) {
    setBusy(buttons, true);
    statusEl.textContent = 'Deleting…';
    client.from('profiles').delete().eq('id', p.id).then(function (res) {
      setBusy(buttons, false);
      if (res.error) { statusEl.textContent = dbMessage(res.error); return; }
      closeProfileEditor();
      refresh().then(function () { showHome(true); });
    });
  }
  deleteBtn.addEventListener('click', function () {
    if (!deleteArmed) {
      deleteArmed = true;
      deleteBtn.textContent = 'Click again to delete';
      deleteBtn.classList.add('armed');
      editStatus.textContent = 'This removes the whole profile and its research projects from the site.';
      return;
    }
    deleteProfile(current(), editStatus, [saveBtn, cancelBtn, deleteBtn]);
  });
  removeBtn.addEventListener('click', function () {
    if (!removeArmed) {
      removeArmed = true;
      removeBtn.textContent = 'Click again to remove this profile';
      removeBtn.classList.add('armed');
      return;
    }
    // Progress and errors show on the button itself.
    var buttonStatus = { set textContent(text) { removeBtn.textContent = text; } };
    deleteProfile(current(), buttonStatus, [removeBtn]);
  });

  function updateProfile(p, changes, statusEl, buttons, done) {
    setBusy(buttons, true);
    statusEl.textContent = 'Saving…';
    client.from('profiles').update(changes).eq('id', p.id).then(function (res) {
      setBusy(buttons, false);
      if (res.error) { statusEl.textContent = dbMessage(res.error); return; }
      done();
      refresh();
    });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var p = current();
    var name = nameInput.value.trim();
    var text = input.value.trim();
    var email = emailInput.value.trim();
    if (!name) { editStatus.textContent = 'Write a portfolio name before saving.'; nameInput.focus(); return; }
    if (!text) { editStatus.textContent = 'Write a description before saving.'; input.focus(); return; }
    if (!validEmail(email)) {
      editStatus.textContent = 'That email address does not look right. Check it, or leave it blank.';
      emailInput.focus();
      return;
    }
    if (name === p.name && text === p.description && email === p.email) { closeProfileEditor(); renderProfile(); return; }
    updateProfile(p, { name: name, description: text, email: email }, editStatus, [saveBtn, cancelBtn, deleteBtn], function () {
      p.name = name;
      p.description = text;
      p.email = email;
      closeProfileEditor();
      renderProfile();
    });
  });

  // ---- Profile: picture (photo or character) ----
  var picBtn = $('edit-pic');
  var picForm = $('pic-form');
  var portrait = $('portrait');
  var profileArt = $('profile-art');
  var picDraft = null; // { mode, photo, character } while the picture editor is open
  var PIC_GROUPS = [
    ['Skin', 'skin', 'swatch'], ['Hair', 'hairStyle', 'chip'], ['Bangs', 'bangs', 'chip'], ['Hair color', 'hairColor', 'swatch'],
    ['Outfit', 'top', 'swatch'], ['Headwear', 'headwear', 'chip'], ['Glasses', 'glasses', 'chip'],
    ['Face', 'face', 'chip'], ['Background', 'bg', 'swatch']
  ];

  function paintPortrait(avatar, name) {
    portrait.textContent = '';
    var pic = pictureNode(avatar, name);
    if (pic) portrait.appendChild(pic);
    portrait.hidden = !pic;
    profileArt.classList.toggle('has-portrait', !!pic);
  }
  function draftAvatar() {
    if (picDraft.mode === 'photo') return picDraft.photo ? { mode: 'photo', photo: picDraft.photo } : null;
    return { mode: 'character', character: picDraft.character };
  }
  function closePicEditor() {
    picForm.hidden = true;
    picForm.textContent = '';
    picDraft = null;
  }
  picBtn.addEventListener('click', function () {
    var a = current().avatar;
    picDraft = {
      mode: a ? a.mode : 'character',
      photo: a && a.mode === 'photo' ? a.photo : '',
      character: normalizeCharacter(a && a.mode === 'character' ? a.character : DEFAULT_CHAR)
    };
    editBtn.hidden = true;
    picBtn.hidden = true;
    buildPicForm('pic-mode-' + picDraft.mode);
    picForm.hidden = false;
  });

  function buildPicForm(focusId) {
    var p = current();
    picForm.textContent = '';
    var top = make('div', 'pic-top');
    var preview = make('div', 'pic-preview');
    function updatePreview() {
      preview.textContent = '';
      var pic = pictureNode(draftAvatar(), p.name);
      if (pic) preview.appendChild(pic); else preview.textContent = 'No photo yet';
      paintPortrait(draftAvatar() || p.avatar, p.name);
    }
    var modes = make('div', 'card-tabs');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Picture type');
    [['character', 'Character'], ['photo', 'Photo']].forEach(function (m) {
      var b = make('button', 'card-tab', m[1]);
      b.type = 'button';
      b.id = 'pic-mode-' + m[0];
      b.setAttribute('aria-pressed', picDraft.mode === m[0] ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (picDraft.mode === m[0]) return;
        picDraft.mode = m[0];
        buildPicForm(b.id);
      });
      modes.appendChild(b);
    });
    top.appendChild(preview);
    top.appendChild(modes);
    picForm.appendChild(top);

    var statusEl = statusLine('');
    if (picDraft.mode === 'character') {
      PIC_GROUPS.forEach(function (g) {
        var key = g[1];
        var group = make('div', 'option-group');
        var label = make('span', 'edit-label', g[0]);
        label.id = 'pic-label-' + key;
        var chips = make('div', 'chips');
        chips.setAttribute('role', 'group');
        chips.setAttribute('aria-labelledby', label.id);
        CHAR[key].forEach(function (value, i) {
          var b = make('button', g[2], g[2] === 'chip' ? value : null);
          b.type = 'button';
          if (g[2] === 'swatch') {
            b.style.background = value;
            b.setAttribute('aria-label', g[0] + ' ' + (i + 1));
          }
          b.setAttribute('aria-pressed', picDraft.character[key] === i ? 'true' : 'false');
          b.addEventListener('click', function () {
            picDraft.character[key] = i;
            Array.prototype.forEach.call(chips.children, function (x, j) {
              x.setAttribute('aria-pressed', j === i ? 'true' : 'false');
            });
            updatePreview();
          });
          chips.appendChild(b);
        });
        group.appendChild(label);
        group.appendChild(chips);
        picForm.appendChild(group);
      });
      var shuffle = make('button', 'mini-btn add-source', 'Shuffle');
      shuffle.type = 'button';
      shuffle.id = 'pic-shuffle';
      shuffle.style.justifySelf = 'start';
      shuffle.addEventListener('click', function () {
        CHAR_KEYS.forEach(function (k) { picDraft.character[k] = Math.floor(Math.random() * CHAR[k].length); });
        buildPicForm('pic-shuffle');
      });
      picForm.appendChild(shuffle);
    } else {
      var fileIn = make('input', 'sr-only');
      fileIn.type = 'file';
      fileIn.accept = 'image/*';
      fileIn.id = 'pic-file';
      var pick = make('label', 'btn btn-ghost', picDraft.photo ? 'Choose a different photo' : 'Choose a photo');
      pick.htmlFor = 'pic-file';
      pick.style.justifySelf = 'start';
      fileIn.addEventListener('change', function () {
        var file = fileIn.files && fileIn.files[0];
        fileIn.value = '';
        if (!file) return;
        statusEl.textContent = 'Loading photo…';
        loadPhoto(file, function (data) {
          picDraft.photo = data;
          pick.textContent = 'Choose a different photo';
          statusEl.textContent = 'Photo ready. Click Save picture to use it.';
          updatePreview();
        }, function (message) { statusEl.textContent = message; });
      });
      picForm.appendChild(fileIn);
      picForm.appendChild(pick);
      picForm.appendChild(make('p', 'pic-note', 'The middle of the photo is cropped to a circle. Everyone who visits the site can see it.'));
    }

    var actions = make('div', 'edit-actions');
    var save = make('button', 'btn btn-solid', 'Save picture');
    save.type = 'submit';
    var cancel = make('button', 'btn btn-ghost', 'Cancel');
    cancel.type = 'button';
    actions.appendChild(save);
    actions.appendChild(cancel);
    var buttons = [save, cancel];
    if (p.avatar) {
      var removePic = make('button', 'btn btn-ghost', 'Remove picture');
      removePic.type = 'button';
      removePic.addEventListener('click', function () {
        updateProfile(p, { avatar: null }, statusEl, buttons, function () { p.avatar = null; finishPic(); });
      });
      actions.appendChild(removePic);
      buttons.push(removePic);
    }
    picForm.appendChild(actions);
    picForm.appendChild(statusEl);

    cancel.addEventListener('click', function () { finishPic(); picBtn.focus(); });
    picForm.onsubmit = function (e) {
      e.preventDefault();
      var avatar = draftAvatar();
      if (!avatar) { statusEl.textContent = 'Choose a photo first, or switch to Character.'; return; }
      updateProfile(p, { avatar: avatar }, statusEl, buttons, function () { p.avatar = avatar; finishPic(); });
    };

    updatePreview();
    var focusEl = focusId && $(focusId);
    if (focusEl) focusEl.focus();
  }
  function finishPic() {
    closePicEditor();
    renderProfile();
  }

  // ---- Profile: research project cards ----
  var projectsEl = $('projects');
  var emptyEl = $('projects-empty');
  var editingId = null; // a project id, 'new', or null
  var openTabs = {};    // project id -> selected tab index, for this visit only

  function projectCard(p, editable) {
    var card = make('article', 'project');
    var title = make('h3', 'project-title');
    var href = cleanLink(p.link);
    if (href) {
      var a = make('a', null, p.title);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      var arrow = make('span', 'project-arrow', ' ↗');
      arrow.setAttribute('aria-hidden', 'true');
      a.appendChild(arrow);
      title.appendChild(a);
    } else {
      title.textContent = p.title;
    }
    card.appendChild(title);

    var about = make('div', 'tab-panel');
    about.appendChild(make('p', 'project-desc', p.description));
    if (href) {
      // The linked website's home address, shown under the description.
      var site = make('a', 'project-site', hostOf(href));
      site.href = href;
      site.target = '_blank';
      site.rel = 'noopener noreferrer';
      var siteArrow = make('span', 'project-arrow', '↗');
      siteArrow.setAttribute('aria-hidden', 'true');
      site.appendChild(siteArrow);
      about.appendChild(site);
    }

    // Visitors only get the tabs when there are sources to show; whoever can edit always does.
    if (p.sources.length || editable) {
      var sources = make('div', 'tab-panel');
      if (p.sources.length) {
        var list = make('ul', 'source-list');
        p.sources.forEach(function (s) {
          var sHref = cleanLink(s.link);
          if (!sHref) return;
          var li = make('li');
          var sa = make('a');
          sa.href = sHref;
          sa.target = '_blank';
          sa.rel = 'noopener noreferrer';
          sa.appendChild(make('span', 'source-name', (s.name || hostOf(sHref)) + ' ↗'));
          sa.appendChild(make('span', 'source-host', hostOf(sHref)));
          li.appendChild(sa);
          list.appendChild(li);
        });
        sources.appendChild(list);
      } else {
        sources.appendChild(make('p', 'sources-empty', 'No sources yet. Click Edit to add links to your sources.'));
      }

      var tabs = make('div', 'card-tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', p.title + ' sections');
      var panels = [about, sources];
      var labels = ['About', 'Sources (' + p.sources.length + ')'];
      var tabButtons = panels.map(function (panel, i) {
        var tab = make('button', 'card-tab', labels[i]);
        tab.type = 'button';
        tab.id = 'tab-' + p.id + '-' + i;
        panel.id = 'panel-' + p.id + '-' + i;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', panel.id);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
        tabs.appendChild(tab);
        return tab;
      });
      var select = function (index) {
        tabButtons.forEach(function (tab, i) {
          tab.setAttribute('aria-selected', i === index ? 'true' : 'false');
          tab.tabIndex = i === index ? 0 : -1;
          panels[i].hidden = i !== index;
        });
        openTabs[p.id] = index;
      };
      tabButtons.forEach(function (tab, i) {
        tab.addEventListener('click', function () { select(i); });
        tab.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            var nextIndex = (i + 1) % tabButtons.length;
            select(nextIndex);
            tabButtons[nextIndex].focus();
          }
        });
      });
      card.appendChild(tabs);
      card.appendChild(about);
      card.appendChild(sources);
      select(openTabs[p.id] || 0);
    } else {
      card.appendChild(about);
    }

    if (editable) {
      var tools = make('div', 'project-tools');
      var edit = make('button', 'mini-btn', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', function () { openProject(p.id); });
      tools.appendChild(edit);
      card.appendChild(tools);
    }
    return card;
  }

  function projectForm(p) {
    var isNew = !p;
    var f = make('form', 'project project-form');
    var titleIn = textInput(80, isNew ? '' : p.title);
    var linkIn = textInput(500, isNew ? '' : p.link);
    linkIn.inputMode = 'url';
    linkIn.placeholder = 'https://…';
    var descIn = textArea(400, isNew ? '' : p.description);

    field('Title', titleIn, 'project-title-input')
      .concat(field('Link to your research (optional)', linkIn, 'project-link-input'))
      .concat(field('Description', descIn, 'project-desc-input'))
      .forEach(function (node) { f.appendChild(node); });

    // Sources: any number of name + link rows.
    var sourcesLabel = make('span', 'edit-label', 'Sources');
    sourcesLabel.id = 'project-sources-label';
    var rowsEl = make('div', 'source-rows');
    rowsEl.setAttribute('role', 'group');
    rowsEl.setAttribute('aria-labelledby', 'project-sources-label');
    var rowCount = 0;
    function addSourceRow(s) {
      var n = rowCount++;
      var row = make('div', 'source-row');
      var nameIn = textInput(120, s ? s.name : '');
      nameIn.id = 'source-name-' + n;
      nameIn.placeholder = 'Source name (optional)';
      nameIn.setAttribute('aria-label', 'Source name');
      nameIn.className = 'source-name-input';
      var sLinkIn = textInput(500, s ? s.link : '');
      sLinkIn.id = 'source-link-' + n;
      sLinkIn.inputMode = 'url';
      sLinkIn.placeholder = 'https://…';
      sLinkIn.setAttribute('aria-label', 'Source link');
      sLinkIn.className = 'source-link-input';
      var remove = make('button', 'mini-btn', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', function () { row.remove(); });
      row.appendChild(nameIn);
      row.appendChild(sLinkIn);
      row.appendChild(remove);
      rowsEl.appendChild(row);
      return sLinkIn;
    }
    (isNew ? [] : p.sources).forEach(addSourceRow);
    var addSource = make('button', 'mini-btn add-source', '+ Add a source');
    addSource.type = 'button';
    addSource.addEventListener('click', function () { addSourceRow(null).focus(); });
    f.appendChild(sourcesLabel);
    f.appendChild(rowsEl);
    f.appendChild(addSource);

    var actions = make('div', 'edit-actions');
    var save = make('button', 'btn btn-solid', isNew ? 'Add project' : 'Save');
    save.type = 'submit';
    var cancel = make('button', 'btn btn-ghost', 'Cancel');
    cancel.type = 'button';
    actions.appendChild(save);
    actions.appendChild(cancel);
    var buttons = [save, cancel];
    var del = null;
    if (!isNew) {
      del = make('button', 'btn btn-ghost', 'Delete');
      del.type = 'button';
      actions.appendChild(del);
      buttons.push(del);
    }
    f.appendChild(actions);
    var statusEl = statusLine('');
    f.appendChild(statusEl);

    function finish(res) {
      setBusy(buttons, false);
      if (res.error) { statusEl.textContent = dbMessage(res.error); return; }
      editingId = null;
      refresh();
    }

    cancel.addEventListener('click', function () { editingId = null; renderProjects(); });

    if (del) {
      var armed = false;
      del.addEventListener('click', function () {
        if (!armed) {
          armed = true;
          del.textContent = 'Click again to delete';
          del.classList.add('armed');
          statusEl.textContent = 'This removes the project from the site.';
          return;
        }
        setBusy(buttons, true);
        statusEl.textContent = 'Deleting…';
        client.from('projects').delete().eq('id', p.id).then(finish);
      });
    }

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var t = titleIn.value.trim();
      var d = descIn.value.trim();
      var link = cleanLink(linkIn.value);
      if (!t) { statusEl.textContent = 'Write a title before saving.'; titleIn.focus(); return; }
      if (link === null) {
        statusEl.textContent = 'That link does not look right. Paste the full web address, like https://example.com/my-paper.';
        linkIn.focus();
        return;
      }
      if (!d) { statusEl.textContent = 'Write a description before saving.'; descIn.focus(); return; }
      var sourceList = [];
      var rows = rowsEl.querySelectorAll('.source-row');
      for (var i = 0; i < rows.length; i++) {
        var sName = rows[i].querySelector('.source-name-input').value.trim();
        var sLinkInput = rows[i].querySelector('.source-link-input');
        var sRaw = sLinkInput.value.trim();
        if (!sName && !sRaw) continue;
        var sLink = cleanLink(sRaw);
        if (!sLink) {
          statusEl.textContent = sRaw
            ? 'One of the source links does not look right. Paste the full web address, like https://example.com/article.'
            : 'Add a link for each source, or remove the ones you do not need.';
          sLinkInput.focus();
          return;
        }
        sourceList.push({ name: sName, link: sLink });
      }
      var row = { title: t, link: link, description: d, sources: sourceList };
      setBusy(buttons, true);
      statusEl.textContent = 'Saving…';
      if (isNew) {
        row.profile_id = current().id;
        client.from('projects').insert(row).then(finish);
      } else {
        client.from('projects').update(row).eq('id', p.id).then(finish);
      }
    });
    return f;
  }

  function addProjectCard() {
    var b = make('button', 'add-card', '+ Add a research project');
    b.type = 'button';
    b.addEventListener('click', function () { openProject('new'); });
    return b;
  }
  function openProject(id) {
    editingId = id;
    renderProjects();
    var first = $('project-title-input');
    if (first) first.focus();
  }
  function renderProjects() {
    var p = current();
    var editable = canEdit(p);
    if (!editable) editingId = null;
    projectsEl.textContent = '';
    p.projects.forEach(function (q) {
      projectsEl.appendChild(editingId === q.id ? projectForm(q) : projectCard(q, editable));
    });
    if (editable) projectsEl.appendChild(editingId === 'new' ? projectForm(null) : addProjectCard());
    projectsEl.hidden = !p.projects.length && !editable;
    emptyEl.hidden = p.projects.length > 0 || editable;
  }

  // ---- Likes and followers ----
  var likeBtn = $('like-btn');
  var followBtn = $('follow-btn');
  var reactNote = $('react-note');
  var writingReaction = false;

  function setReactButton(b, on, icon, label, count) {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.querySelector('.react-icon').textContent = icon;
    b.querySelector('.react-label').textContent = label;
    b.querySelector('.react-count').textContent = count;
  }
  function renderProfileReactions() {
    var p = current();
    if (!p) return;
    var liked = !!mine(state.likes, p.id);
    var following = !!mine(state.follows, p.id);
    setReactButton(likeBtn, liked, '♥', liked ? 'Liked' : 'Like', String(countFor(state.likes, p.id)));
    setReactButton(followBtn, following, following ? '✓' : '+', following ? 'Following' : 'Follow',
      plural(countFor(state.follows, p.id), 'follower'));
    // You see the counts on your own portfolio but can't like or follow it.
    var own = canEdit(p);
    likeBtn.disabled = own || writingReaction;
    followBtn.disabled = own || writingReaction;
    likeBtn.classList.toggle('own', own);
    followBtn.classList.toggle('own', own);
    if (own) {
      reactNote.textContent = "You can't like or follow your own portfolio.";
      reactNote.hidden = false;
    } else if (reactNote.textContent === "You can't like or follow your own portfolio.") {
      reactNote.hidden = true;
    }
  }
  function toggleReaction(table) {
    if (!me) { openAuth('signin', 'Sign in to like and follow profiles.'); return; }
    var p = current();
    if (!p || writingReaction || canEdit(p)) return;
    var list = table === 'likes' ? state.likes : state.follows;
    var had = !!mine(list, p.id);
    writingReaction = true;
    reactNote.hidden = true;
    renderProfileReactions();
    var request = had
      ? client.from(table).delete().eq('user_id', me.id).eq('profile_id', p.id)
      : client.from(table).insert({ profile_id: p.id });
    request.then(function (res) {
      writingReaction = false;
      if (res.error) {
        renderProfileReactions();
        reactNote.textContent = dbMessage(res.error);
        reactNote.hidden = false;
        return;
      }
      refresh();
    });
  }
  likeBtn.addEventListener('click', function () { toggleReaction('likes'); });
  followBtn.addEventListener('click', function () { toggleReaction('follows'); });

  // ---- Notification bell: new research from profiles you follow ----
  var bellBtn = $('bell-btn');
  var bellBadge = $('bell-badge');
  var notifPanel = $('notif-panel');

  function collectNotifs() {
    if (!me) return [];
    var items = [];
    state.profiles.forEach(function (p) {
      var f = mine(state.follows, p.id);
      if (!f) return;
      p.projects.forEach(function (q) {
        if (q.createdAt > f.since) items.push({ profile: p, project: q });
      });
    });
    items.sort(function (a, b) { return b.project.createdAt - a.project.createdAt; });
    return items.slice(0, 30);
  }
  function timeAgo(t) {
    var mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 1) return 'Just now';
    if (mins < 60) return plural(mins, 'minute') + ' ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return plural(hours, 'hour') + ' ago';
    return plural(Math.round(hours / 24), 'day') + ' ago';
  }
  function renderBell() {
    var show = !!client && !!me && loaded && !loadError;
    bellBtn.hidden = !show;
    if (!show) { closeNotifs(); return; }
    var unread = collectNotifs().filter(function (n) { return n.project.createdAt > seenAt; }).length;
    bellBadge.textContent = unread > 9 ? '9+' : String(unread);
    bellBadge.hidden = !unread;
    bellBtn.setAttribute('aria-label', unread ? 'Notifications, ' + unread + ' new' : 'Notifications');
  }
  function fillNotifPanel(lastSeen) {
    notifPanel.textContent = '';
    notifPanel.appendChild(make('p', 'notif-head', 'Notifications'));
    var items = collectNotifs();
    if (!items.length) {
      var following = state.follows.some(function (f) { return f.userId === me.id; });
      notifPanel.appendChild(make('p', 'notif-empty', following
        ? 'Nothing new yet. When a profile you follow adds research, it shows up here.'
        : 'Follow a profile to hear when it adds new research.'));
      return;
    }
    items.forEach(function (n) {
      var b = make('button', 'notif-item' + (n.project.createdAt > lastSeen ? ' unread' : ''));
      b.type = 'button';
      b.appendChild(make('span', 'notif-who', n.profile.name));
      b.appendChild(make('span', 'notif-what', 'Added new research: ' + n.project.title));
      b.appendChild(make('span', 'notif-when', timeAgo(n.project.createdAt)));
      b.addEventListener('click', function () {
        closeNotifs();
        showProfile(n.profile.id, true);
        $('research').scrollIntoView();
      });
      notifPanel.appendChild(b);
    });
  }
  function openNotifs() {
    closeAccountMenu();
    fillNotifPanel(seenAt);
    notifPanel.hidden = false;
    bellBtn.setAttribute('aria-expanded', 'true');
    // Opening the bell marks everything in it as seen.
    var newest = collectNotifs().reduce(function (m, n) { return Math.max(m, n.project.createdAt); }, 0);
    if (newest > seenAt) {
      seenAt = newest;
      renderBell();
      client.from('notif_state').upsert({ user_id: me.id, seen_at: new Date(newest).toISOString() })
        .then(function (res) { if (res.error) console.error(res.error); });
    }
  }
  function closeNotifs() {
    if (notifPanel.hidden) return;
    notifPanel.hidden = true;
    bellBtn.setAttribute('aria-expanded', 'false');
  }
  bellBtn.addEventListener('click', function () {
    if (notifPanel.hidden) openNotifs(); else closeNotifs();
  });

  // ---- Account: sign in, sign up, sign out ----
  var signinBtn = $('signin-btn');
  var account = $('account');
  var accountBtn = $('account-btn');
  var accountMenu = $('account-menu');
  var accountEmail = $('account-email');

  function renderHeader() {
    paintName($('brand-name'), state.hubName);
    $('footer-name').textContent = '© 2026 ' + state.hubName;
    if (!currentId) document.title = state.hubName;
    signinBtn.hidden = !client || !!me;
    account.hidden = !me;
    if (me) {
      accountBtn.textContent = (me.email || '?').charAt(0).toUpperCase();
      accountEmail.textContent = 'Signed in as ' + (me.email || 'your account');
    } else {
      closeAccountMenu();
    }
  }
  function closeAccountMenu() {
    accountMenu.hidden = true;
    accountBtn.setAttribute('aria-expanded', 'false');
  }
  accountBtn.addEventListener('click', function () {
    var open = accountMenu.hidden;
    closeNotifs();
    accountMenu.hidden = !open;
    accountBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  $('signout-btn').addEventListener('click', function () {
    closeAccountMenu();
    client.auth.signOut();
  });
  signinBtn.addEventListener('click', function () { openAuth('signin', ''); });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.top-actions')) { closeNotifs(); closeAccountMenu(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!authDialog.hidden) { closeAuth(); return; }
    if (!notifPanel.hidden) { closeNotifs(); bellBtn.focus(); }
    if (!accountMenu.hidden) { closeAccountMenu(); accountBtn.focus(); }
  });

  var authDialog = $('auth-dialog');
  var authForm = $('auth-form');
  var authTitle = $('auth-title');
  var authSub = $('auth-sub');
  var authEmail = $('auth-email');
  var authEmailLabel = $('auth-email-label');
  var authPassword = $('auth-password');
  var authPasswordLabel = $('auth-password-label');
  var authSubmit = $('auth-submit');
  var authCancel = $('auth-cancel');
  var authSwitch = $('auth-switch');
  var authForgot = $('auth-forgot');
  var authStatus = $('auth-status');
  var authMode = 'signin';
  var authOpener = null;

  var AUTH_MODES = {
    signin: { title: 'Sign in', submit: 'Sign in', email: true, password: true, pwAuto: 'current-password',
      switchText: 'New here? Create an account', switchTo: 'signup', forgot: true },
    signup: { title: 'Create an account', submit: 'Create account', email: true, password: true, pwAuto: 'new-password',
      switchText: 'Already have an account? Sign in', switchTo: 'signin', forgot: false },
    reset: { title: 'Reset your password', submit: 'Send reset link', email: true, password: false,
      switchText: 'Back to sign in', switchTo: 'signin', forgot: false },
    newpass: { title: 'Choose a new password', submit: 'Save new password', email: false, password: true, pwAuto: 'new-password',
      switchText: '', switchTo: null, forgot: false }
  };

  function setAuthMode(mode, note) {
    var m = AUTH_MODES[mode];
    authMode = mode;
    authTitle.textContent = m.title;
    authSubmit.textContent = m.submit;
    authSub.textContent = note || (mode === 'signup' ? 'Use at least 8 characters for your password.' : '');
    authSub.hidden = !authSub.textContent;
    authEmail.hidden = authEmailLabel.hidden = !m.email;
    authPassword.hidden = authPasswordLabel.hidden = !m.password;
    authPassword.autocomplete = m.pwAuto || 'current-password';
    authPassword.value = '';
    authSwitch.textContent = m.switchText;
    authSwitch.hidden = !m.switchTo;
    authForgot.hidden = !m.forgot;
    authStatus.textContent = '';
  }
  function openAuth(mode, note) {
    if (!client) return;
    authOpener = document.activeElement;
    setAuthMode(mode, note);
    authDialog.hidden = false;
    (AUTH_MODES[mode].email ? authEmail : authPassword).focus();
  }
  function closeAuth() {
    authDialog.hidden = true;
    if (authOpener && authOpener.focus) authOpener.focus();
  }
  authCancel.addEventListener('click', closeAuth);
  authDialog.addEventListener('click', function (e) { if (e.target === authDialog) closeAuth(); });
  authSwitch.addEventListener('click', function () { setAuthMode(AUTH_MODES[authMode].switchTo, ''); authEmail.focus(); });
  authForgot.addEventListener('click', function () { setAuthMode('reset', 'Enter your email and we will send you a link to choose a new password.'); authEmail.focus(); });

  authForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var m = AUTH_MODES[authMode];
    var email = authEmail.value.trim();
    var password = authPassword.value;
    if (m.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      authStatus.textContent = 'Enter your email address.';
      authEmail.focus();
      return;
    }
    if (m.password && password.length < 8) {
      authStatus.textContent = 'Passwords need at least 8 characters.';
      authPassword.focus();
      return;
    }
    setBusy([authSubmit, authCancel], true);
    authStatus.textContent = 'One moment…';
    var request;
    if (authMode === 'signin') request = client.auth.signInWithPassword({ email: email, password: password });
    else if (authMode === 'signup') request = client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: SITE_URL } });
    else if (authMode === 'reset') request = client.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
    else request = client.auth.updateUser({ password: password });

    request.then(function (res) {
      setBusy([authSubmit, authCancel], false);
      var err = res.error;
      if (err) {
        if (/invalid login credentials/i.test(err.message)) authStatus.textContent = 'That email and password do not match an account.';
        else if (/email not confirmed/i.test(err.message)) authStatus.textContent = 'Confirm your email first: open the link we sent you, then sign in.';
        else if (/already registered/i.test(err.message)) authStatus.textContent = 'That email already has an account. Sign in instead.';
        else if (/rate limit/i.test(err.message)) authStatus.textContent = 'Too many tries. Wait a few minutes, then try again.';
        else authStatus.textContent = err.message || 'Something went wrong. Try again.';
        return;
      }
      if (authMode === 'signup' && !(res.data && res.data.session)) {
        setAuthMode('signin', 'Almost done: we sent a confirmation link to ' + email + '. Open it, then sign in here.');
        authEmail.value = email;
        return;
      }
      if (authMode === 'reset') {
        authStatus.textContent = 'If that email has an account, a reset link is on its way.';
        return;
      }
      closeAuth();
    });
  });

  // ---- Copy email ----
  var copyStatus = $('copy-status');
  $('copy-email').addEventListener('click', function () {
    var text = addr.textContent.trim();
    function selectText() {
      var range = document.createRange();
      range.selectNodeContents(addr);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      copyStatus.textContent = 'Selected. Press Ctrl+C (or Cmd+C) to copy.';
    }
    try {
      navigator.clipboard.writeText(text).then(function () {
        copyStatus.textContent = 'Copied to your clipboard.';
      }, selectText);
    } catch (e) {
      selectText();
    }
  });

  // ---- Putting it together ----
  function busy() {
    return editingId !== null || !form.hidden || !picForm.hidden || addingProfile || !hubForm.hidden;
  }
  var routed = false;
  function renderAll() {
    renderHeader();
    renderBell();
    if (!routed && loaded) { routed = true; route(); return; }
    if (busy()) return;
    if (currentId) {
      if (findProfile(currentId)) renderProfile(); else showHome(true);
    } else {
      renderHome();
    }
  }

  renderHome();
  renderHeader();
  if (!client) {
    refresh();
    return;
  }
  client.auth.onAuthStateChange(function (event, session) {
    me = session ? session.user : null;
    if (event === 'PASSWORD_RECOVERY') openAuth('newpass', '');
    if (event === 'TOKEN_REFRESHED') return;
    // Load outside the callback, as Supabase recommends.
    setTimeout(refresh, 0);
  });
  // Pick up other people's new profiles, likes and research now and then.
  setInterval(function () { if (!busy() && document.visibilityState === 'visible') refresh(); }, 60000);
  window.addEventListener('focus', function () { if (!busy()) refresh(); });
})();
