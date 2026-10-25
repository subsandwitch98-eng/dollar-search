(function () {
  'use strict';

  // ---- Connection to Supabase (accounts + database) ----
  var cfg = window.DOLLAR_SEARCH_CONFIG || {};
  var keyReady = typeof cfg.supabaseKey === 'string' && cfg.supabaseKey && !/^PASTE/.test(cfg.supabaseKey);
  var client = window.supabase && cfg.supabaseUrl && keyReady
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey)
    : null;
  var SITE_URL = location.origin + location.pathname;

  // ---- Profile pictures: a character built from these options ----
  var CHAR = {
    skin: ['#FCE3D3', '#F5CDB4', '#E5AF8C', '#C98E6A', '#9C6646', '#6E4630'],
    // New styles and colors go on the end of each list so characters people already saved keep their look.
    hairStyle: ['Short', 'Spiky', 'Long', 'Bun', 'Curly', 'Bob', 'Ponytail', 'Pigtails', 'Wavy', 'Afro', 'Buzz', 'Mohawk'],
    bangs: ['None', 'Straight', 'Side', 'Wispy', 'Curtain', 'Blunt', 'Swoop', 'Choppy', 'Baby', 'Wavy', 'Clipped'],
    hairColor: ['#2E2226', '#5B3A29', '#A0643B', '#E3B562', '#E58FA8', '#8E7CC3', '#C2552E', '#EDE3C8', '#6FA8DC'],
    top: ['#F7C8D4', '#D2728F', '#8EC5E8', '#9BD3AE', '#F4D35E', '#4A4E69',
      '#E05A5A', '#F29E4C', '#F28B82', '#B9A6E8', '#BDEBD9', '#4FB3A9', '#2F4A7A', '#8A5A3C', '#2B2B2E', '#F4F1EC', '#5B3A8C'],
    outfit: ['Tee', 'Hoodie', 'Sweater', 'Shirt', 'Jacket', 'Overalls'],
    headwear: ['None', 'Cap', 'Beanie', 'Headphones', 'Crown', 'Bow', 'Beret', 'Bucket hat', 'Top hat', 'Headband', 'Flower crown'],
    glasses: ['None', 'Glasses', 'Shades', 'Square', 'Cat-eye', 'Hearts', 'Stars', 'Aviators', 'Monocle'],
    face: ['Smile', 'Grin', 'Cool', 'Wink', 'Happy', 'Laugh', 'Surprised', 'Tongue', 'Sleepy', 'Starry', 'Smirk'],
    bg: ['#FBE3E6', '#FFF1D6', '#DDF0FA', '#E3F4E6', '#ECE6FA', '#FFFCF7'],
    frame: ['None', 'Hearts', 'Stars', 'Lace', 'Flowers', 'Rainbow', 'Sparkles', 'Bow']
  };
  var CHAR_KEYS = ['skin', 'hairStyle', 'bangs', 'hairColor', 'outfit', 'top', 'headwear', 'glasses', 'face', 'bg', 'frame'];
  var DEFAULT_CHAR = { skin: 1, hairStyle: 0, bangs: 0, hairColor: 1, outfit: 0, top: 0, headwear: 1, glasses: 0, face: 0, bg: 0, frame: 0 };
  function normalizeCharacter(src) {
    var c = {};
    src = src && typeof src === 'object' ? src : {};
    CHAR_KEYS.forEach(function (k) {
      var v = src[k];
      c[k] = typeof v === 'number' && Math.floor(v) === v && v >= 0 && v < CHAR[k].length ? v : DEFAULT_CHAR[k];
    });
    return c;
  }
  // Profile pictures are characters only; anything else saved in the past is ignored.
  function normalizeAvatar(a) {
    if (!a || typeof a !== 'object' || a.mode !== 'character') return null;
    return { mode: 'character', character: normalizeCharacter(a.character) };
  }

  // ---- State, loaded from the database ----
  var state = { hubName: 'Dollar Search', hubIntro: '', profiles: [], likes: [], follows: [], projectLikes: [], comments: [], collabs: [] };
  var collabsReady = true; // false until the collab_requests table exists in Supabase
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
      client.from('follows').select('user_id, profile_id, created_at'),
      client.from('project_likes').select('user_id, project_id'),
      client.from('project_comments').select('id, project_id, user_id, kind, body, created_at').order('created_at'),
      client.from('collab_requests').select('id, project_id, from_user, to_profile, message, status, created_at, responded_at').order('created_at')
    ]).then(function (res) {
      // Research likes, comments and collabs are optional: if their tables aren't set up yet, the rest of the site still loads.
      res.forEach(function (r, i) { if (r.error && i < 5) throw r.error; });
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
      state.projectLikes = res[5].error ? [] : res[5].data.map(function (l) {
        return { userId: l.user_id, projectId: l.project_id };
      });
      commentsReady = !res[6].error;
      state.comments = res[6].error ? [] : res[6].data.map(function (c) {
        return {
          id: c.id, projectId: c.project_id, userId: c.user_id, kind: c.kind === 'tip' ? 'tip' : 'comment',
          body: c.body || '', createdAt: Date.parse(c.created_at) || 0
        };
      });
      collabsReady = !res[7].error;
      state.collabs = res[7].error ? [] : res[7].data.map(function (c) {
        return {
          id: c.id, projectId: c.project_id, fromUser: c.from_user, toProfile: c.to_profile,
          message: c.message || '', status: c.status,
          createdAt: Date.parse(c.created_at) || 0, respondedAt: Date.parse(c.responded_at) || 0
        };
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

  // A gold star after the site owner's portfolio name.
  function addOwnerStar(el, p) {
    if (!p || !cfg.ownerProfileId || p.id !== cfg.ownerProfileId) return;
    var star = document.createElementNS(SVG_NS, 'svg');
    star.setAttribute('viewBox', '0 0 100 100');
    star.setAttribute('class', 'owner-star');
    star.setAttribute('role', 'img');
    star.setAttribute('aria-label', 'Site owner');
    var title = document.createElementNS(SVG_NS, 'title');
    title.textContent = 'Site owner';
    star.appendChild(title);
    var shape = document.createElementNS(SVG_NS, 'polygon');
    shape.setAttribute('points', '50,8 61.8,35.8 91.8,38.4 69,58.2 75.9,87.6 50,72 24.1,87.6 31,58.2 8.2,38.4 38.2,35.8');
    star.appendChild(shape);
    el.appendChild(document.createTextNode(' '));
    el.appendChild(star);
  }
  // A small magic wand after the names of portfolios made during early testing.
  function addTesterWand(el, p) {
    var ids = cfg.earlyTesterProfileIds;
    if (!p || !Array.isArray(ids) || ids.indexOf(p.id) < 0) return;
    var wand = document.createElementNS(SVG_NS, 'svg');
    wand.setAttribute('viewBox', '0 0 24 24');
    wand.setAttribute('class', 'tester-wand');
    wand.setAttribute('role', 'img');
    wand.setAttribute('aria-label', 'Early tester');
    var title = document.createElementNS(SVG_NS, 'title');
    title.textContent = 'Early tester';
    wand.appendChild(title);
    [
      ['line', { x1: 4, y1: 20, x2: 13.5, y2: 10.5, stroke: '#4A3550', 'stroke-width': 2.6, 'stroke-linecap': 'round' }],
      ['line', { x1: 11.8, y1: 12.2, x2: 13.5, y2: 10.5, stroke: '#FFFFFF', 'stroke-width': 2.6, 'stroke-linecap': 'round' }],
      ['polygon', { points: '17,2.4 18.3,5.6 21.7,5.9 19.1,8.1 19.9,11.4 17,9.6 14.1,11.4 14.9,8.1 12.3,5.9 15.7,5.6', fill: '#F6C945', stroke: '#E0A82E', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }],
      ['circle', { cx: 21.6, cy: 13.4, r: 1.1, fill: '#E26D8E' }],
      ['circle', { cx: 10.8, cy: 4.2, r: 0.9, fill: '#E26D8E' }]
    ].forEach(function (part) {
      var n = document.createElementNS(SVG_NS, part[0]);
      for (var k in part[1]) n.setAttribute(k, part[1][k]);
      wand.appendChild(n);
    });
    el.appendChild(document.createTextNode(' '));
    el.appendChild(wand);
  }
  // Badges after a portfolio name: the owner's star, then the early tester wand.
  function addNameBadges(el, p) {
    addOwnerStar(el, p);
    addTesterWand(el, p);
  }

  function findProfile(id) {
    for (var i = 0; i < state.profiles.length; i++) {
      if (state.profiles[i].id === id) return state.profiles[i];
    }
    return null;
  }
  function canEdit(p) { return !!me && p.ownerId === me.id; }
  function myProfile() {
    if (!me) return null;
    return state.profiles.filter(function (p) { return p.ownerId === me.id; })[0] || null;
  }
  function findProject(id) {
    for (var i = 0; i < state.profiles.length; i++) {
      var q = state.profiles[i].projects.filter(function (x) { return x.id === id; })[0];
      if (q) return q;
    }
    return null;
  }

  // ---- Collabs: you invite another portfolio to work on one of your research cards ----
  function acceptedCollabs(projectId) {
    return state.collabs.filter(function (c) { return c.projectId === projectId && c.status === 'accepted'; });
  }
  // Is the signed-in person an accepted collaborator on this research card?
  function isCollaborator(q) {
    return !!me && acceptedCollabs(q.id).some(function (c) {
      var to = findProfile(c.toProfile);
      return to && to.ownerId === me.id;
    });
  }
  // The card's owner and its collaborators can edit it; only the owner can delete it.
  function canEditProject(q) {
    var owner = findProfile(q.profileId);
    return (!!owner && canEdit(owner)) || isCollaborator(q);
  }
  // Research from other portfolios that this portfolio collaborates on.
  function collabProjectsFor(p) {
    var seen = {};
    return state.collabs.filter(function (c) { return c.status === 'accepted' && c.toProfile === p.id; })
      .map(function (c) { return findProject(c.projectId); })
      .filter(function (q) {
        if (!q || seen[q.id]) return false;
        seen[q.id] = true;
        return true;
      });
  }
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
  // Lighter (amount > 0) or darker (amount < 0) version of a #rrggbb color, for hair shading.
  function shade(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(function (ch) {
      var v = Math.round(amount < 0 ? ch * (1 + amount) : ch + (255 - ch) * amount);
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }

  // Frames around the edge of the round picture (radius 60), drawn last so they sit in front of everything.
  // Kinds: 0 None, 1 Hearts, 2 Stars, 3 Lace, 4 Flowers, 5 Rainbow, 6 Sparkles, 7 Bow.
  var HEART = 'M0 0.9 C-0.4 0.6 -1 0.2 -1 -0.3 C-1 -0.75 -0.6 -1 -0.3 -1 C-0.1 -1 0 -0.85 0 -0.7 C0 -0.85 0.1 -1 0.3 -1 C0.6 -1 1 -0.75 1 -0.3 C1 0.2 0.4 0.6 0 0.9 Z';
  function fx(n) { return n.toFixed(1); }
  function starPoints(cx, cy, r) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = Math.PI / 5 * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
      pts.push(fx(cx + Math.cos(a) * rr) + ',' + fx(cy + Math.sin(a) * rr));
    }
    return pts.join(' ');
  }
  function sparklePath(x, y, r) {
    var k = r * 0.28;
    return 'M' + fx(x) + ' ' + fx(y - r) + ' Q' + fx(x + k) + ' ' + fx(y - k) + ' ' + fx(x + r) + ' ' + fx(y) +
      ' Q' + fx(x + k) + ' ' + fx(y + k) + ' ' + fx(x) + ' ' + fx(y + r) +
      ' Q' + fx(x - k) + ' ' + fx(y + k) + ' ' + fx(x - r) + ' ' + fx(y) +
      ' Q' + fx(x - k) + ' ' + fx(y - k) + ' ' + fx(x) + ' ' + fx(y - r) + ' Z';
  }
  // Frames are drawn on their own picture, which styles.css makes 25% wider than the character plus its
  // white circle, so the band from radius FRAME_INNER to the edge (60) sits just outside that circle.
  var FRAME_INNER = 49, FRAME_MID = 54.5, FRAME_WIDTH = 11;
  var frameClipCount = 0;
  function drawFrame(add, kind) {
    if (!kind) return;
    // Calls fn(x, y, degrees, i) for n evenly spaced points on a circle of radius r; 0 degrees is the top.
    function around(n, r, start, fn) {
      for (var i = 0; i < n; i++) {
        var deg = start + 360 / n * i, a = (deg - 90) * Math.PI / 180;
        fn(60 + Math.cos(a) * r, 60 + Math.sin(a) * r, deg, i);
      }
    }
    function ring(r, color, w) { add('circle', { cx: 60, cy: 60, r: r, fill: 'none', stroke: color, 'stroke-width': w }); }
    var M = FRAME_MID;
    if (kind === 1) { // Hearts on a pink ring
      ring(M, '#F7C8D4', FRAME_WIDTH);
      around(12, M, 0, function (x, y, deg, i) {
        add('path', { d: HEART, fill: i % 2 ? '#FFFFFF' : '#E26D8E', transform: 'translate(' + fx(x) + ' ' + fx(y) + ') rotate(' + deg + ') scale(' + (i % 2 ? 3.2 : 4.3) + ')' });
      });
    } else if (kind === 2) { // Stars on a soft yellow ring
      ring(M, '#FBE7A6', FRAME_WIDTH);
      around(12, M, 0, function (x, y, deg, i) {
        add('polygon', { points: starPoints(x, y, i % 2 ? 3.6 : 5.2), fill: '#F6C945', stroke: '#E0A82E', 'stroke-width': 0.8, 'stroke-linejoin': 'round' });
      });
    } else if (kind === 3) { // Lace: a white band with scallops on the outside, outlined in pink
      around(24, 56, 0, function (x, y) { add('circle', { cx: fx(x), cy: fx(y), r: 3.9, fill: '#F2B8C6' }); });
      around(24, 56, 0, function (x, y) { add('circle', { cx: fx(x), cy: fx(y), r: 3.1, fill: '#FFFFFF' }); });
      ring(52.5, '#FFFFFF', 7);
      ring(FRAME_INNER + 0.6, '#F2B8C6', 1.2);
      around(24, 53.5, 0, function (x, y) { add('circle', { cx: fx(x), cy: fx(y), r: 1.3, fill: '#E58FA8' }); });
    } else if (kind === 4) { // Flowers on a vine
      ring(M, '#9BD3AE', 1.6);
      around(8, M, 22.5, function (x, y, deg) {
        add('ellipse', { cx: fx(x), cy: fx(y), rx: 3.4, ry: 1.6, fill: '#6DBB8A', transform: 'rotate(' + deg + ' ' + fx(x) + ' ' + fx(y) + ')' });
      });
      var petals = ['#F7A8C0', '#B9A6E8', '#FFFFFF', '#F4D35E'];
      around(8, M, 0, function (x, y, deg, i) {
        for (var p = 0; p < 5; p++) {
          var a = Math.PI * 2 / 5 * p + deg * Math.PI / 180;
          add('circle', { cx: fx(x + Math.cos(a) * 3), cy: fx(y + Math.sin(a) * 3), r: 2.8, fill: petals[i % 4], stroke: 'rgba(0,0,0,0.12)', 'stroke-width': 0.5 });
        }
        add('circle', { cx: fx(x), cy: fx(y), r: 1.9, fill: i % 4 === 3 ? '#F29E4C' : '#F6C945' });
      });
    } else if (kind === 5) { // Rainbow with two little clouds
      ['#F4A3A8', '#F8C88A', '#F6E08E', '#A8DDB5', '#9CCBEE', '#BBA9E6'].forEach(function (col, i) {
        ring(60 - FRAME_WIDTH / 12 - i * FRAME_WIDTH / 6, col, FRAME_WIDTH / 6 + 0.1);
      });
      [[21.5, 98.5], [98.5, 98.5]].forEach(function (c) {
        add('ellipse', { cx: c[0], cy: c[1] + 2.4, rx: 7, ry: 2.8, fill: '#FFFFFF' });
        [[-4, 0.8, 3.5], [0, -1.6, 4.4], [4, 0.8, 3.5]].forEach(function (b) {
          add('circle', { cx: c[0] + b[0], cy: c[1] + b[1], r: b[2], fill: '#FFFFFF' });
        });
      });
    } else if (kind === 6) { // Sparkles on a soft purple ring
      ring(M, '#E4DAFA', FRAME_WIDTH);
      around(8, M, 0, function (x, y, deg, i) {
        add('path', { d: sparklePath(x, y, i % 2 ? 3.8 : 5.6), fill: i % 2 ? '#F29BB2' : '#F6C945' });
      });
      around(8, M, 22.5, function (x, y) { add('circle', { cx: fx(x), cy: fx(y), r: 1.3, fill: '#FFFFFF' }); });
    } else if (kind === 7) { // Pink polka-dot ribbon with a bow at the bottom
      ring(M, '#F7C8D4', FRAME_WIDTH);
      around(24, M, 7.5, function (x, y) { add('circle', { cx: fx(x), cy: fx(y), r: 1.4, fill: '#FFFFFF' }); });
      var bow = 'translate(60 ' + (60 + M) + ') scale(0.72) translate(-60 -110)';
      [
        ['M58 111 L52 120 L56.5 120 L60 113 Z', '#C25F7E'],
        ['M62 111 L68 120 L63.5 120 L60 113 Z', '#C25F7E'],
        ['M60 110 C52 102 42 104 44 111 C46 117 54 115 60 110 Z', '#E26D8E'],
        ['M60 110 C68 102 78 104 76 111 C74 117 66 115 60 110 Z', '#E26D8E']
      ].forEach(function (b) { add('path', { d: b[0], fill: b[1], transform: bow }); });
      add('circle', { cx: 60, cy: 110, r: 3.4, fill: '#C25F7E', transform: bow });
    }
  }

  // Shoulders, neck and clothing. Kinds: 0 Tee, 1 Hoodie, 2 Sweater, 3 Shirt, 4 Jacket, 5 Overalls.
  // The neck is drawn here too, so collars and hoods can sit in front of or behind it.
  var SHOULDERS = 'M18 120 C18 94 38 86 60 86 C82 86 102 94 102 120 Z';
  function drawClothing(add, kind, color, skin) {
    var dark = shade(color, -0.22);
    var light = shade(color, 0.4);
    var neck = function () { add('rect', { x: 52, y: 72, width: 16, height: 16, rx: 6, fill: skin }); };

    if (kind === 5) { // Overalls: a light shirt underneath, bib and straps in the clothing color
      add('path', { d: SHOULDERS, fill: '#FBF7F2' });
      neck();
      add('path', { d: 'M50 87 Q60 95 70 87', fill: 'none', stroke: 'rgba(0,0,0,0.12)', 'stroke-width': 3, 'stroke-linecap': 'round' });
      add('path', { d: 'M43 99 L77 99 L81 120 L39 120 Z', fill: color });
      add('path', { d: 'M46 100 L40 88', stroke: color, 'stroke-width': 6, 'stroke-linecap': 'round' });
      add('path', { d: 'M74 100 L80 88', stroke: color, 'stroke-width': 6, 'stroke-linecap': 'round' });
      add('rect', { x: 53, y: 105, width: 14, height: 9, rx: 2, fill: 'none', stroke: dark, 'stroke-width': 1.5 });
      add('circle', { cx: 46, cy: 101, r: 2.2, fill: '#F6C945' });
      add('circle', { cx: 74, cy: 101, r: 2.2, fill: '#F6C945' });
      return;
    }

    add('path', { d: SHOULDERS, fill: color });
    if (kind === 1) { // Hoodie: hood bunched behind the neck, drawstrings and a front pocket
      add('path', { d: 'M38 91 Q41 79 60 79 Q79 79 82 91 Q71 86 60 86 Q49 86 38 91 Z', fill: dark });
      neck();
      add('path', { d: 'M48 88 Q60 97 72 88', fill: 'none', stroke: dark, 'stroke-width': 3, 'stroke-linecap': 'round' });
      add('path', { d: 'M55 93 L54 106', stroke: light, 'stroke-width': 2, 'stroke-linecap': 'round' });
      add('path', { d: 'M65 93 L66 106', stroke: light, 'stroke-width': 2, 'stroke-linecap': 'round' });
      add('circle', { cx: 54, cy: 107, r: 1.8, fill: light });
      add('circle', { cx: 66, cy: 107, r: 1.8, fill: light });
      add('path', { d: 'M44 120 L46 111 Q60 107 74 111 L76 120 Z', fill: dark, opacity: 0.55 });
      return;
    }
    neck();
    if (kind === 0) { // Tee
      add('path', { d: 'M50 87 Q60 96 70 87', fill: 'none', stroke: 'rgba(0,0,0,0.12)', 'stroke-width': 3, 'stroke-linecap': 'round' });
    }
    if (kind === 2) { // Sweater: ribbed crew neck and a knit pattern
      add('path', { d: 'M49 87 Q60 97 71 87', fill: 'none', stroke: dark, 'stroke-width': 4.5, 'stroke-linecap': 'round' });
      add('path', { d: 'M28 106 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4', fill: 'none', stroke: dark, 'stroke-width': 1.6, 'stroke-linejoin': 'round', opacity: 0.6 });
      add('path', { d: 'M26 114 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4', fill: 'none', stroke: dark, 'stroke-width': 1.6, 'stroke-linejoin': 'round', opacity: 0.6 });
    }
    if (kind === 3) { // Shirt: white pointed collar and buttons down the front
      add('path', { d: 'M60 95 L60 120', stroke: dark, 'stroke-width': 1.2, opacity: 0.6 });
      add('path', { d: 'M50 85 L60 95 L52 99 Z', fill: '#FFFFFF', stroke: dark, 'stroke-width': 1, 'stroke-linejoin': 'round' });
      add('path', { d: 'M70 85 L60 95 L68 99 Z', fill: '#FFFFFF', stroke: dark, 'stroke-width': 1, 'stroke-linejoin': 'round' });
      [102, 110, 118].forEach(function (y) { add('circle', { cx: 60, cy: y, r: 1.6, fill: dark }); });
    }
    if (kind === 4) { // Jacket: open over a white tee, with lapels
      add('path', { d: 'M50 87 Q60 95 70 87 L66 120 L54 120 Z', fill: '#FFFFFF' });
      add('path', { d: 'M50 87 L54 120', stroke: dark, 'stroke-width': 2.5, 'stroke-linecap': 'round' });
      add('path', { d: 'M70 87 L66 120', stroke: dark, 'stroke-width': 2.5, 'stroke-linecap': 'round' });
      add('path', { d: 'M49 87 L45 96 L52 101 Z', fill: dark });
      add('path', { d: 'M71 87 L75 96 L68 101 Z', fill: dark });
    }
  }

  function renderCharacter(c, label) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    // With a frame, the picture's circle no longer clips (so the frame can sit outside it), so clip the character here.
    var layer = svg;
    if (c.frame) {
      var clipId = 'char-clip-' + (++frameClipCount);
      var clip = document.createElementNS(SVG_NS, 'clipPath');
      clip.setAttribute('id', clipId);
      var clipCircle = document.createElementNS(SVG_NS, 'circle');
      clipCircle.setAttribute('cx', 60);
      clipCircle.setAttribute('cy', 60);
      clipCircle.setAttribute('r', 60);
      clip.appendChild(clipCircle);
      svg.appendChild(clip);
      layer = document.createElementNS(SVG_NS, 'g');
      layer.setAttribute('clip-path', 'url(#' + clipId + ')');
      svg.appendChild(layer);
    }
    function add(tag, attrs) {
      var n = document.createElementNS(SVG_NS, tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      layer.appendChild(n);
    }
    var skin = CHAR.skin[c.skin], top = CHAR.top[c.top];
    var hair = CHAR.hairColor[c.hairColor];
    var hairDark = shade(hair, -0.28);   // hair behind the head and strand lines
    var hairLight = shade(hair, 0.35);   // shine
    var ink = '#3A2A30';
    var style = c.hairStyle;
    function line(d) { return { d: d, fill: 'none', stroke: ink, 'stroke-width': 2.4, 'stroke-linecap': 'round' }; }
    function strands(paths) {
      paths.forEach(function (d) {
        add('path', { d: d, fill: 'none', stroke: hairDark, 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.8 });
      });
    }
    function shine(d) {
      add('path', { d: d, fill: 'none', stroke: hairLight, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.7 });
    }
    function tie(x, y) {
      add('circle', { cx: x, cy: y, r: 3.6, fill: top, stroke: shade(top, -0.3), 'stroke-width': 1 });
    }
    // Full hair cap, a little wider than the head (radius 26 vs 24) so no skin shows above the hairline.
    var CAP = 'M34 57 A26 26 0 0 1 86 57 C80 45 69 40 60 41 C51 40 40 45 34 57 Z';
    var SHAVED = 'M36.5 53 A23.6 23.6 0 0 1 83.5 53 C76 47 68 45 60 45 C52 45 44 47 36.5 53 Z';

    add('rect', { width: 120, height: 120, fill: CHAR.bg[c.bg] });

    // Hair behind the head, in a darker shade for depth
    // Long and Wavy fill all the way across behind the neck; the neck and shoulders are drawn over them.
    if (style === 2) { // Long
      add('path', { d: 'M33 52 C33 25 87 25 87 52 L90 94 Q81 99 73 95 Q60 98 47 95 Q39 99 30 94 Z', fill: hairDark });
    }
    if (style === 5) { // Bob
      add('path', { d: 'M32 54 C32 25 88 25 88 54 L89 76 Q88 83 81 81 L39 81 Q32 83 31 76 Z', fill: hairDark });
    }
    if (style === 6) { // Ponytail, swinging out behind the right side
      add('path', { d: 'M80 40 Q102 42 100 68 Q98 84 88 92 Q93 74 85 58 Z', fill: hairDark });
      add('path', { d: 'M86 46 Q97 52 95 68', fill: 'none', stroke: hair, 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.8 });
    }
    if (style === 7) { // Pigtails
      add('path', { d: 'M37 50 Q17 56 20 82 Q27 74 37 66 Z', fill: hairDark });
      add('path', { d: 'M83 50 Q103 56 100 82 Q93 74 83 66 Z', fill: hairDark });
    }
    if (style === 8) { // Wavy
      add('path', { d: 'M33 52 C33 25 87 25 87 52 Q92 62 87 72 Q93 83 86 95 Q73 99 60 96 Q47 99 34 95 Q27 83 33 72 Q28 62 33 52 Z', fill: hairDark });
    }
    if (style === 9) { // Afro
      add('circle', { cx: 60, cy: 46, r: 33, fill: hairDark });
      [[34, 34, 9], [46, 20, 10], [62, 16, 10], [78, 22, 10], [88, 36, 9], [30, 50, 8], [90, 52, 8]].forEach(function (b) {
        add('circle', { cx: b[0], cy: b[1], r: b[2], fill: hair });
      });
    }

    // Shoulders and clothing, in the chosen clothing color
    drawClothing(add, c.outfit, top, skin);
    add('circle', { cx: 36.5, cy: 59, r: 5, fill: skin });
    add('circle', { cx: 83.5, cy: 59, r: 5, fill: skin });
    add('circle', { cx: 60, cy: 56, r: 24, fill: skin });

    // Hair on top of the head, with strand lines and a shine
    if (style === 0) { // Short, with sideburns
      add('path', { d: CAP, fill: hair });
      add('path', { d: 'M34 57 Q33 63 36 66 L38 58 Z', fill: hair });
      add('path', { d: 'M86 57 Q87 63 84 66 L82 58 Z', fill: hair });
      strands(['M46 37 Q52 41 50 47', 'M60 33 Q64 38 62 44', 'M72 36 Q74 41 71 46']);
      shine('M41 42 Q49 34 58 33');
    }
    if (style === 1) { // Spiky
      add('path', { d: 'M34 57 L34 40 L41 39 L44 26 L53 30 L60 20 L67 31 L76 25 L78 38 L86 42 L86 57 C80 45 70 40 60 41 C50 40 40 45 34 57 Z', fill: hair });
      strands(['M44 28 L47 40', 'M60 22 L60 38', 'M76 27 L72 40']);
      shine('M50 33 L56 28');
    }
    // Side locks for Long, Bob and Wavy start up inside the hair cap (at 33,50 and 46,46 on the left)
    // so they join it with no gap at the temples.
    if (style === 2 || style === 8) { // Long and Wavy: cap plus locks falling past the ears
      add('path', { d: CAP, fill: hair });
      if (style === 2) {
        add('path', { d: 'M33 50 Q29 72 35 88 L42 88 Q39 70 41 60 Q42 52 46 46 Z', fill: hair });
        add('path', { d: 'M87 50 Q91 72 85 88 L78 88 Q81 70 79 60 Q78 52 74 46 Z', fill: hair });
      } else {
        add('path', { d: 'M33 50 Q28 62 34 72 Q30 80 35 90 L42 90 Q38 80 41 72 Q38 64 41 58 Q42 51 46 46 Z', fill: hair });
        add('path', { d: 'M87 50 Q92 62 86 72 Q90 80 85 90 L78 90 Q82 80 79 72 Q82 64 79 58 Q78 51 74 46 Z', fill: hair });
      }
      strands(['M50 35 Q46 42 47 50', 'M70 35 Q74 42 73 50']);
      shine('M42 42 Q50 34 59 33');
    }
    if (style === 3) { // Bun
      add('path', { d: CAP, fill: hair });
      add('circle', { cx: 60, cy: 26, r: 10, fill: hair });
      add('path', { d: 'M51 30 Q60 35 69 30', fill: 'none', stroke: hairDark, 'stroke-width': 2.5, 'stroke-linecap': 'round' });
      strands(['M45 38 Q54 33 60 31', 'M75 38 Q66 33 60 31', 'M55 22 Q60 19 65 22']);
      shine('M42 43 Q49 36 56 35');
    }
    if (style === 4) { // Curly
      add('path', { d: CAP, fill: hairDark });
      [[38, 50, 8], [42, 40, 9], [50, 33, 9], [60, 30, 10], [70, 33, 9], [78, 40, 9], [82, 50, 8]].forEach(function (b) {
        add('circle', { cx: b[0], cy: b[1], r: b[2], fill: hair });
      });
      [[44, 38], [58, 27], [73, 31], [80, 45]].forEach(function (b) {
        add('circle', { cx: b[0], cy: b[1], r: 2.2, fill: hairLight, opacity: 0.7 });
      });
    }
    if (style === 5) { // Bob: chin-length sides
      add('path', { d: CAP, fill: hair });
      add('path', { d: 'M33 50 Q31 70 37 80 L44 80 Q40 68 41 60 Q42 52 46 46 Z', fill: hair });
      add('path', { d: 'M87 50 Q89 70 83 80 L76 80 Q80 68 79 60 Q78 52 74 46 Z', fill: hair });
      strands(['M48 36 Q45 44 46 52', 'M72 36 Q75 44 74 52']);
      shine('M42 42 Q50 34 59 33');
    }
    if (style === 6) { // Ponytail: slicked back with a tie
      add('path', { d: CAP, fill: hair });
      strands(['M42 47 Q58 36 82 42', 'M46 41 Q60 33 80 38']);
      tie(84, 43);
      shine('M44 40 Q52 34 62 33');
    }
    if (style === 7) { // Pigtails: middle part and a tie on each side
      add('path', { d: CAP, fill: hair });
      add('path', { d: 'M60 32 L60 41', fill: 'none', stroke: hairDark, 'stroke-width': 1.8, 'stroke-linecap': 'round' });
      strands(['M58 34 Q48 38 42 47', 'M62 34 Q72 38 78 47']);
      tie(36, 52);
      tie(84, 52);
      shine('M44 41 Q50 36 56 35');
    }
    if (style === 9) { // Afro: full cap over the head, blending into the curls behind
      add('path', { d: CAP, fill: hair });
      [[48, 30], [64, 24], [78, 32], [38, 42]].forEach(function (b) {
        add('circle', { cx: b[0], cy: b[1], r: 2, fill: hairLight, opacity: 0.6 });
      });
    }
    if (style === 10) { // Buzz cut
      add('path', { d: SHAVED, fill: hair });
      [[46, 40], [54, 36], [62, 35], [70, 37], [77, 42], [50, 44], [66, 41]].forEach(function (b) {
        add('circle', { cx: b[0], cy: b[1], r: 0.9, fill: hairDark, opacity: 0.7 });
      });
    }
    if (style === 11) { // Mohawk: shaved sides, a tall crest down the middle
      add('path', { d: SHAVED, fill: hairDark });
      add('path', { d: 'M53 47 L50 22 L56 27 L58 14 L62 26 L67 18 L68 47 Q60 44 53 47 Z', fill: hair });
      strands(['M58 18 L59 40', 'M64 22 L63 40']);
      shine('M54 28 L55 40');
    }

    // Bangs across the forehead, stopping above the eyes (which start at y 55).
    // Each style: [shapes, strand lines]. 1 Straight, 2 Side, 3 Wispy, 4 Curtain, 5 Blunt, 6 Swoop,
    // 7 Choppy, 8 Baby, 9 Wavy, 10 Clipped.
    var BANGS = {
      1: [['M37 52 C36 33 84 33 83 52 Q78 48.5 73 52 Q67 48.5 61 52 Q55 48.5 49 52 Q43 48.5 37 52 Z'],
        ['M50 40 Q49 45 50 50', 'M64 39 Q65 44 64 49']],
      2: [['M37 51 C36 33 84 31 84 49 C76 45 66 46 57 50 C50 53 43 54 37 51 Z'],
        ['M50 40 Q49 45 50 50', 'M64 39 Q65 44 64 49']],
      3: [['M37 50 C36 33 84 33 83 50 L79 46 L76 52 L71 46 L66 52 L61 46 L56 52 L51 46 L46 52 L42 46 Z'],
        ['M50 40 Q49 45 50 50', 'M64 39 Q65 44 64 49']],
      4: [['M37 52 C36 35 52 31 60 35 C56 38 52 42 49 47 C46 51 41 53 37 52 Z',
        'M83 52 C84 35 68 31 60 35 C64 38 68 42 71 47 C74 51 79 53 83 52 Z'],
        ['M56 37 Q50 41 45 48', 'M64 37 Q70 41 75 48']],
      5: [['M36 53 C35 31 85 31 84 53 Q60 51 36 53 Z'],
        ['M48 38 Q47 45 48 51', 'M60 36 L60 51', 'M72 38 Q73 45 72 51']],
      6: [['M83 51 C84 33 36 31 36 49 C44 45 54 46 63 50 C70 53 77 54 83 51 Z'],
        ['M70 40 Q71 45 70 50', 'M56 39 Q55 42 56 45']],
      7: [['M37 50 C36 33 84 33 83 50 L80 47 L78 53 L74 46 L70 51 L65 45 L61 52 L56 46 L52 50 L48 45 L44 52 L41 46 Z'],
        ['M52 38 Q51 43 52 48', 'M68 38 Q69 43 68 48']],
      8: [['M38 46 C37 32 83 32 82 46 Q78 44 74 46 Q69 44 64 46 Q60 44 56 46 Q51 44 46 46 Q42 44 38 46 Z'],
        ['M52 36 L52 43', 'M68 36 L68 43']],
      9: [['M37 51 C36 33 84 33 83 51 C80 48 77 48 74 51 C71 54 68 48 64 50.5 C60 53 57 47 53 50 C49 53 45 48 41 51 C39.5 52 38 52 37 51 Z'],
        ['M50 39 Q48 44 50 49', 'M66 39 Q68 44 66 49']],
      10: [['M37 51 C36 33 84 31 84 47 C78 43 70 41 62 42 C52 43 44 46 37 51 Z'],
        ['M48 44 Q60 39 74 42']]
    };
    var bang = BANGS[c.bangs];
    if (bang) {
      bang[0].forEach(function (d) { add('path', { d: d, fill: hair }); });
      strands(bang[1]);
      if (c.bangs === 10) { // a hair clip, in the clothing color
        add('rect', { x: 42, y: 42, width: 10, height: 3.2, rx: 1.6, fill: top, stroke: shade(top, -0.3), 'stroke-width': 0.8, transform: 'rotate(-22 47 43.6)' });
      }
    }
    // Face
    add('circle', { cx: 47, cy: 66, r: 4, fill: '#F29BB2', opacity: 0.45 });
    add('circle', { cx: 73, cy: 66, r: 4, fill: '#F29BB2', opacity: 0.45 });
    // Faces: 0 Smile, 1 Grin, 2 Cool, 3 Wink, 4 Happy, 5 Laugh, 6 Surprised, 7 Tongue, 8 Sleepy, 9 Starry, 10 Smirk.
    // Eyes sit at (51,58) and (69,58). Tinted lenses (Shades, Hearts, Stars, Aviators) cover them, so the eyes are skipped then.
    var tinted = c.glasses === 2 || c.glasses === 5 || c.glasses === 6 || c.glasses === 7;
    var f = c.face;
    var mouthRed = '#7A2E3E';
    function eyeDots(r) {
      add('circle', { cx: 51, cy: 58, r: r, fill: ink });
      add('circle', { cx: 69, cy: 58, r: r, fill: ink });
    }
    function eyeArcs(d1, d2) {
      add('path', line(d1));
      add('path', line(d2));
    }
    function eyeStar(cx, cy) {
      var pts = [];
      for (var i = 0; i < 10; i++) {
        var rad = i % 2 ? 1.9 : 4.4;
        var ang = Math.PI / 5 * i - Math.PI / 2;
        pts.push((cx + Math.cos(ang) * rad).toFixed(1) + ',' + (cy + Math.sin(ang) * rad).toFixed(1));
      }
      add('polygon', { points: pts.join(' '), fill: '#F6C945', stroke: ink, 'stroke-width': 0.8, 'stroke-linejoin': 'round' });
    }
    if (!tinted) {
      if (f === 3) { // Wink: left eye open, right eye closed
        add('circle', { cx: 51, cy: 58, r: 2.6, fill: ink });
        add('path', line('M65.5 58.5 Q69 55.5 72.5 58.5'));
      } else if (f === 4 || f === 5) { // Happy and Laugh: eyes squeezed into happy arcs
        eyeArcs('M47.5 59 Q51 55 54.5 59', 'M65.5 59 Q69 55 72.5 59');
      } else if (f === 8) { // Sleepy: closed eyes
        eyeArcs('M47.5 58 Q51 61 54.5 58', 'M65.5 58 Q69 61 72.5 58');
      } else if (f === 9) { // Starry: star-shaped eyes
        eyeStar(51, 58);
        eyeStar(69, 58);
      } else {
        eyeDots(f === 6 ? 3.2 : 2.6);
      }
      if (f === 10) { // Smirk: heavy lids for a knowing look
        add('path', { d: 'M47.5 56.2 Q51 55 54.5 56.2', fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linecap': 'round' });
        add('path', { d: 'M65.5 56.2 Q69 55 72.5 56.2', fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linecap': 'round' });
      }
    }
    if (f === 10) { // Smirk: one eyebrow raised, a lopsided half-smile with a dimple
      add('path', { d: 'M47 51.5 L55 50.8', fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linecap': 'round' });
      add('path', { d: 'M65 50.5 Q69 46.8 73 49.2', fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linecap': 'round' });
      add('path', line('M53.5 69 Q60 70.2 66.5 66.2'));
      add('path', { d: 'M66.8 64.4 Q68.6 65.6 67.8 67.6', fill: 'none', stroke: ink, 'stroke-width': 1.4, 'stroke-linecap': 'round' });
    }
    if (f === 6) { // Surprised: raised eyebrows
      add('path', { d: 'M47 50 Q51 47 55 50', fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linecap': 'round' });
      add('path', { d: 'M65 50 Q69 47 73 50', fill: 'none', stroke: ink, 'stroke-width': 1.8, 'stroke-linecap': 'round' });
    }
    if (f === 0 || f === 4) add('path', line('M52 67 Q60 74 68 67'));
    if (f === 1 || f === 9) add('path', { d: 'M51 66 Q60 77 69 66 Z', fill: '#FFFFFF', stroke: ink, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    if (f === 2 || f === 3) add('path', line('M53 69 Q61 71 68 66'));
    if (f === 5) { // Laugh: big open mouth with a tongue
      add('path', { d: 'M50 65 Q60 80 70 65 Z', fill: mouthRed, stroke: ink, 'stroke-width': 2, 'stroke-linejoin': 'round' });
      add('path', { d: 'M54.5 71 Q60 68.5 65.5 71 Q60 76 54.5 71 Z', fill: '#F28CA6' });
    }
    if (f === 6) add('ellipse', { cx: 60, cy: 69, rx: 3.2, ry: 4, fill: mouthRed, stroke: ink, 'stroke-width': 1.8 });
    if (f === 7) { // Tongue: smile with the tongue poking out
      add('path', { d: 'M57 69 Q57 76.5 60.5 76.5 Q64 76.5 64 69 Z', fill: '#F28CA6', stroke: ink, 'stroke-width': 1.5, 'stroke-linejoin': 'round' });
      add('path', line('M52 67 Q60 72.5 68 67'));
    }
    if (f === 8) { // Sleepy: small mouth and a couple of z's
      add('path', line('M57 68.5 Q60 70.5 63 68.5'));
      add('path', { d: 'M80 33 h5 l-5 6 h5', fill: 'none', stroke: ink, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      add('path', { d: 'M88 25 h3.5 l-3.5 4.2 h3.5', fill: 'none', stroke: ink, 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    }
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
    var gold = '#C9A227';
    function bridge(color) { add('path', { d: 'M57.5 57 L62.5 57', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' }); }
    if (c.glasses === 3) { // Square frames
      add('rect', { x: 44.5, y: 52.5, width: 13, height: 11, rx: 2, fill: 'none', stroke: ink, 'stroke-width': 2 });
      add('rect', { x: 62.5, y: 52.5, width: 13, height: 11, rx: 2, fill: 'none', stroke: ink, 'stroke-width': 2 });
      bridge(ink);
    }
    if (c.glasses === 4) { // Cat-eye, with frames in a deep shade of the clothing color
      var cat = shade(top, -0.4);
      add('ellipse', { cx: 51, cy: 58.5, rx: 6.6, ry: 5.2, fill: 'rgba(255,255,255,0.15)', stroke: cat, 'stroke-width': 2 });
      add('ellipse', { cx: 69, cy: 58.5, rx: 6.6, ry: 5.2, fill: 'rgba(255,255,255,0.15)', stroke: cat, 'stroke-width': 2 });
      add('path', { d: 'M45 56 L40.5 51 L47 53.5 Z', fill: cat, stroke: cat, 'stroke-width': 1, 'stroke-linejoin': 'round' });
      add('path', { d: 'M75 56 L79.5 51 L73 53.5 Z', fill: cat, stroke: cat, 'stroke-width': 1, 'stroke-linejoin': 'round' });
      bridge(cat);
    }
    if (c.glasses === 5) { // Heart-shaped pink shades
      [51, 69].forEach(function (cx) {
        add('path', { d: 'M' + cx + ' 64 C' + (cx - 9) + ' 58 ' + (cx - 6) + ' 50.5 ' + cx + ' 54.5 C' + (cx + 6) + ' 50.5 ' + (cx + 9) + ' 58 ' + cx + ' 64 Z', fill: '#E5537E', stroke: ink, 'stroke-width': 1.3, 'stroke-linejoin': 'round' });
      });
      bridge(ink);
    }
    if (c.glasses === 6) { // Star-shaped gold shades
      [51, 69].forEach(function (cx) {
        var pts = [];
        for (var i = 0; i < 10; i++) {
          var rad = i % 2 ? 3.6 : 7.6;
          var ang = Math.PI / 5 * i - Math.PI / 2;
          pts.push((cx + Math.cos(ang) * rad).toFixed(1) + ',' + (58.5 + Math.sin(ang) * rad).toFixed(1));
        }
        add('polygon', { points: pts.join(' '), fill: '#F6C945', stroke: ink, 'stroke-width': 1.2, 'stroke-linejoin': 'round' });
      });
      bridge(ink);
    }
    if (c.glasses === 7) { // Aviators: dark teardrop lenses in thin gold frames
      add('path', { d: 'M43.5 54 Q51 52 57.5 54 Q58 63.5 51 64.5 Q43.5 63.5 43.5 54 Z', fill: '#3F4256', stroke: gold, 'stroke-width': 1.4, 'stroke-linejoin': 'round' });
      add('path', { d: 'M62.5 54 Q69 52 76.5 54 Q76.5 63.5 69 64.5 Q62 63.5 62.5 54 Z', fill: '#3F4256', stroke: gold, 'stroke-width': 1.4, 'stroke-linejoin': 'round' });
      add('path', { d: 'M44 53.2 L76 53.2', stroke: gold, 'stroke-width': 1.2 });
      add('path', { d: 'M46 56 Q48 54.5 51 55', fill: 'none', stroke: 'rgba(255,255,255,0.45)', 'stroke-width': 1.2, 'stroke-linecap': 'round' });
      add('path', { d: 'M65 56 Q67 54.5 70 55', fill: 'none', stroke: 'rgba(255,255,255,0.45)', 'stroke-width': 1.2, 'stroke-linecap': 'round' });
    }
    if (c.glasses === 8) { // Monocle over the right eye, on a gold chain
      add('circle', { cx: 69, cy: 58, r: 6.6, fill: 'rgba(255,255,255,0.2)', stroke: gold, 'stroke-width': 2 });
      add('path', { d: 'M75.3 60 Q81 71 75 83', fill: 'none', stroke: gold, 'stroke-width': 1.2, 'stroke-dasharray': '2 1.5', 'stroke-linecap': 'round' });
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
    var topDark = shade(top, -0.25);
    if (c.headwear === 4) { // Crown, in gold with jewels
      add('path', { d: 'M41 41 L43 22 L52 31 L60 17 L68 31 L77 22 L79 41 Z', fill: '#F6C945', stroke: '#E0A82E', 'stroke-width': 1.2, 'stroke-linejoin': 'round' });
      add('rect', { x: 41, y: 37, width: 38, height: 5, rx: 1.5, fill: '#E0A82E' });
      add('circle', { cx: 60, cy: 32, r: 2.6, fill: top, stroke: topDark, 'stroke-width': 0.8 });
      add('circle', { cx: 49, cy: 34, r: 1.6, fill: '#FFFFFF' });
      add('circle', { cx: 71, cy: 34, r: 1.6, fill: '#FFFFFF' });
    }
    if (c.headwear === 5) { // Bow, perched on the right side of the head
      add('path', { d: 'M74 33 C66 23 57 29 62 37 C65 41 71 38 74 33 Z', fill: top, stroke: topDark, 'stroke-width': 1 });
      add('path', { d: 'M74 33 C82 23 91 29 86 37 C83 41 77 38 74 33 Z', fill: top, stroke: topDark, 'stroke-width': 1 });
      add('circle', { cx: 74, cy: 33, r: 3.6, fill: topDark });
    }
    if (c.headwear === 6) { // Beret, tilted, with a little stalk
      add('path', { d: 'M33 45 Q34 26 62 24 Q89 25 87 40 Q81 47 60 46 Q41 47 33 45 Z', fill: top });
      add('path', { d: 'M38 44 Q60 49 84 41', fill: 'none', stroke: topDark, 'stroke-width': 1.5, 'stroke-linecap': 'round' });
      add('path', { d: 'M61 24 L62 19', stroke: topDark, 'stroke-width': 2.5, 'stroke-linecap': 'round' });
    }
    if (c.headwear === 7) { // Bucket hat
      add('path', { d: 'M40 46 Q40 25 60 25 Q80 25 80 46 Z', fill: top });
      add('path', { d: 'M41 42 Q60 38 79 42', fill: 'none', stroke: topDark, 'stroke-width': 2.5, 'stroke-linecap': 'round' });
      add('path', { d: 'M29 49 Q60 39 91 49 L88 55 Q60 46 32 55 Z', fill: shade(top, -0.12) });
    }
    if (c.headwear === 8) { // Top hat, with a band in the clothing color
      add('rect', { x: 45, y: 9, width: 30, height: 31, rx: 3, fill: '#2E2226' });
      add('rect', { x: 45, y: 32, width: 30, height: 5, fill: top });
      add('rect', { x: 35, y: 38, width: 50, height: 6, rx: 3, fill: '#2E2226' });
    }
    if (c.headwear === 9) { // Headband over the hair
      add('path', { d: 'M35 50 Q37 32 60 31 Q83 32 85 50', fill: 'none', stroke: top, 'stroke-width': 5, 'stroke-linecap': 'round' });
      add('path', { d: 'M40 42 Q46 34 56 32.5', fill: 'none', stroke: shade(top, 0.45), 'stroke-width': 1.5, 'stroke-linecap': 'round' });
    }
    if (c.headwear === 10) { // Flower crown: a vine with leaves and five flowers
      add('path', { d: 'M35 47 Q60 28 85 47', fill: 'none', stroke: '#6E9F5C', 'stroke-width': 2, 'stroke-linecap': 'round' });
      [[43, 39, -30], [66, 34, 20], [79, 41, 40]].forEach(function (l) {
        add('ellipse', { cx: l[0], cy: l[1], rx: 3.4, ry: 1.6, fill: '#7BB37A', transform: 'rotate(' + l[2] + ' ' + l[0] + ' ' + l[1] + ')' });
      });
      [[38, 44, '#F7C8D4'], [48, 37, '#FFFFFF'], [60, 34, top], [72, 37, '#FFFFFF'], [82, 44, '#F7C8D4']].forEach(function (fl) {
        for (var p = 0; p < 5; p++) {
          var a = (Math.PI * 2 / 5) * p - Math.PI / 2;
          add('circle', { cx: fl[0] + Math.cos(a) * 2.6, cy: fl[1] + Math.sin(a) * 2.6, r: 2.4, fill: fl[2], stroke: 'rgba(0,0,0,0.12)', 'stroke-width': 0.5 });
        }
        add('circle', { cx: fl[0], cy: fl[1], r: 1.6, fill: '#F6C945' });
      });
    }
    return svg;
  }
  // The frame is its own picture, laid over the character and sized (in styles.css) to sit just outside its circle.
  function renderFrame(kind) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('class', 'char-frame');
    svg.setAttribute('aria-hidden', 'true');
    drawFrame(function (tag, attrs) {
      var n = document.createElementNS(SVG_NS, tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
    }, kind);
    return svg;
  }
  function pictureNode(avatar, name) {
    if (!avatar) return null;
    var pic = renderCharacter(avatar.character, name + "'s character");
    if (!avatar.character.frame) return pic;
    var wrap = make('span', 'char-pic');
    wrap.appendChild(pic);
    wrap.appendChild(renderFrame(avatar.character.frame));
    return wrap;
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
    if (id !== currentId) { followersOpen = false; collabOpen = false; collabNote = ''; }
    // Close comments opened in Recent research, so the portfolio's own comment boxes are the only ones on the page.
    if (Object.keys(recentCommentsOpen).length) { recentCommentsOpen = {}; renderRecent(); }
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
  var filterFriends = $('filter-friends');
  var homeFilter = 'all'; // 'all', 'following' or 'friends'
  var addingProfile = false;

  // ---- Home: Recent research, a sideways-scrolling strip of the newest research from everyone ----
  var recentSection = $('recent-research');
  var recentStrip = $('recent-strip');
  var recentEmpty = $('recent-empty');
  var RECENT_LIMIT = 20;

  var recentCommentsOpen = {}; // research id -> its comments are open in the strip

  function recentCard(p, q) {
    var li = make('li', 'recent-item');
    var card = make('article', 'recent-card');
    // The top of the card opens the portfolio; the like and comment buttons below work right here.
    var b = make('button', 'recent-open');
    b.type = 'button';
    var fresh = Date.now() - q.createdAt < 24 * 3600000;
    var when = make('span', 'recent-when' + (fresh ? ' fresh' : ''), fresh ? 'New · ' + timeAgo(q.createdAt) : timeAgo(q.createdAt));
    when.title = 'Published ' + exactTime(q.createdAt);
    b.appendChild(when);
    b.appendChild(make('span', 'recent-title', q.title));
    if (q.description) b.appendChild(make('span', 'recent-desc', q.description));
    var by = make('span', 'recent-by');
    var pic = pictureNode(p.avatar, p.name);
    var avatar = make('span', 'avatar recent-avatar', pic ? null : p.name.charAt(0).toUpperCase());
    if (pic) avatar.appendChild(pic);
    avatar.setAttribute('aria-hidden', 'true');
    var name = make('span', 'recent-name');
    paintName(name, p.name);
    by.appendChild(avatar);
    by.appendChild(name);
    b.appendChild(by);
    b.setAttribute('aria-label', 'Open ' + q.title + ', by ' + p.name + ', ' + timeAgo(q.createdAt).toLowerCase());
    // Opens the portfolio and scrolls to this research card.
    b.addEventListener('click', function () {
      showProfile(p.id, true);
      var target = $('project-' + q.id);
      if (!target) return;
      target.scrollIntoView({ block: 'center' });
      target.classList.add('flash');
      setTimeout(function () { target.classList.remove('flash'); }, 1600);
    });
    card.appendChild(b);

    // Like and comment without leaving the home screen.
    var comments = state.comments.filter(function (c) { return c.projectId === q.id; });
    var open = !!recentCommentsOpen[q.id];
    var tools = make('div', 'project-tools recent-tools');
    tools.appendChild(researchLikeButton(q));
    tools.appendChild(researchCommentButton(q, comments.length, open, function () {
      recentCommentsOpen[q.id] = !recentCommentsOpen[q.id];
      renderRecent();
      var box = $('comment-input-' + q.id);
      if (recentCommentsOpen[q.id] && box) box.focus();
    }));
    card.appendChild(tools);
    if (open) {
      var owner = findProfile(q.profileId);
      card.appendChild(commentsPanel(q, comments, !!owner && canEdit(owner)));
    }
    li.appendChild(card);
    return li;
  }
  function renderRecent() {
    var ready = !!client && loaded && !loadError;
    recentSection.hidden = !ready;
    if (!ready) return;
    var all = [];
    state.profiles.forEach(function (p) {
      p.projects.forEach(function (q) { all.push({ p: p, q: q }); });
    });
    all.sort(function (a, b) { return b.q.createdAt - a.q.createdAt; });
    all = all.slice(0, RECENT_LIMIT);
    // Keep the reader's place when the list refreshes.
    var keep = recentStrip.scrollLeft;
    recentStrip.textContent = '';
    all.forEach(function (it) { recentStrip.appendChild(recentCard(it.p, it.q)); });
    recentStrip.scrollLeft = keep;
    recentStrip.hidden = !all.length;
    recentEmpty.hidden = all.length > 0;
    updateRecentArrows();
  }
  function updateRecentArrows() {
    var max = recentStrip.scrollWidth - recentStrip.clientWidth;
    $('recent-prev').disabled = recentStrip.scrollLeft <= 2;
    $('recent-next').disabled = recentStrip.scrollLeft >= max - 2;
    $('recent-prev').parentNode.hidden = max <= 2;
  }
  $('recent-prev').addEventListener('click', function () {
    recentStrip.scrollBy({ left: -recentStrip.clientWidth * 0.8, behavior: 'smooth' });
  });
  $('recent-next').addEventListener('click', function () {
    recentStrip.scrollBy({ left: recentStrip.clientWidth * 0.8, behavior: 'smooth' });
  });
  recentStrip.addEventListener('scroll', updateRecentArrows);
  window.addEventListener('resize', updateRecentArrows);

  // ---- Home: Research idea generator, a slot-machine lever that lands on a topic ----
  var IDEAS = [
    ['Science', 'How does the amount of sleep you get change how well you remember things?'],
    ['Science', 'Why do some people remember their dreams and others don’t?'],
    ['Science', 'Does listening to music while studying help or hurt focus?'],
    ['Science', 'How does caffeine affect reaction time?'],
    ['Technology', 'How do social media algorithms decide what you see?'],
    ['Technology', 'Can AI tell the difference between real and fake photos?'],
    ['Technology', 'How do self-driving cars make decisions in an emergency?'],
    ['Technology', 'How has texting changed the way people write?'],
    ['Health', 'Do standing desks really make people healthier?'],
    ['Health', 'How does screen time before bed affect sleep?'],
    ['Health', 'What happens to your body when you skip breakfast?'],
    ['Health', 'Why do some foods make people feel full longer?'],
    ['Environment', 'How much plastic does one family throw away in a week?'],
    ['Environment', 'Do city trees really make neighborhoods cooler?'],
    ['Environment', 'How does fast fashion affect the environment?'],
    ['Environment', 'Which is better for the planet: paper, plastic or cloth bags?'],
    ['Space', 'Could people ever grow food on Mars?'],
    ['Space', 'Why is it so hard to see stars from big cities?'],
    ['Space', 'How do astronauts’ bodies change after months in space?'],
    ['Society', 'Why do some songs get stuck in your head?'],
    ['Society', 'How do first impressions change the way we treat people?'],
    ['Society', 'Why do people trust online reviews from strangers?'],
    ['Society', 'How does a four-day school week affect students?'],
    ['Money', 'Why do prices so often end in .99?'],
    ['Money', 'Do loyalty cards and rewards apps make people spend more?'],
    ['Money', 'How do small businesses compete with huge online stores?'],
    ['Money', 'What makes a product go viral?'],
    ['Sports', 'Does the home team really have an advantage?'],
    ['Sports', 'How has data changed the way soccer teams pick players?'],
    ['Sports', 'Why do some athletes perform better under pressure?'],
    ['Food', 'Why does food taste different on airplanes?'],
    ['Food', 'How do food colors change what people think tastes good?'],
    ['Food', 'Is homemade bread really cheaper than store-bought?'],
    ['Arts', 'How do movie soundtracks change how a scene feels?'],
    ['Arts', 'Why are some colors seen as calm and others as energetic?'],
    ['Arts', 'How has video game art changed over the last 30 years?'],
    ['Animals', 'Can dogs really understand human emotions?'],
    ['Animals', 'Why do cats knock things off tables?'],
    ['Animals', 'How do bees find their way back to the hive?'],
    ['Animals', 'Do pets help people feel less stressed?'],
    ['Education', 'Do handwritten notes help you learn better than typed ones?'],
    ['Education', 'How does the color of a classroom affect learning?'],
    ['Education', 'Does learning a second language change how you think?'],
    ['Psychology', 'Why do people procrastinate even when they know better?'],
    ['Psychology', 'How does a messy room affect mood and focus?'],
    ['Psychology', 'Why do people feel more tired on rainy days?'],
    ['History', 'How did the printing press change the spread of ideas?'],
    ['History', 'What can old maps tell us about how cities grew?'],
    ['History', 'How did people keep food fresh before refrigerators?'],
    ['History', 'Why did some ancient buildings last thousands of years?']
  ];
  var ideaMachine = $('idea-machine');
  var ideaLever = $('idea-lever');
  var ideaCategory = $('idea-category');
  var ideaText = $('idea-text');
  var ideaUse = $('idea-use');
  var ideaDeck = [];      // shuffled idea numbers still to come, so ideas don't repeat until all are used
  var ideaNow = null;     // the idea the machine landed on
  var ideaSpinning = false;

  function nextIdea() {
    if (!ideaDeck.length) {
      ideaDeck = IDEAS.map(function (_, i) { return i; }).filter(function (i) { return IDEAS[i] !== ideaNow; });
      for (var i = ideaDeck.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = ideaDeck[i]; ideaDeck[i] = ideaDeck[j]; ideaDeck[j] = t;
      }
    }
    return IDEAS[ideaDeck.pop()];
  }
  function showIdea(idea, blurred) {
    ideaCategory.textContent = idea[0];
    ideaText.textContent = idea[1];
    ideaText.classList.toggle('spin', blurred);
  }
  function pullLever() {
    if (ideaSpinning) return;
    ideaSpinning = true;
    ideaUse.hidden = true;
    ideaLever.classList.remove('pulled');
    void ideaLever.offsetWidth; // restart the pull animation
    ideaLever.classList.add('pulled');
    ideaMachine.classList.add('spinning');
    ideaMachine.classList.remove('landed');
    var landOn = nextIdea();
    var steps = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 16;
    var step = 0;
    (function tick() {
      if (step < steps) {
        showIdea(IDEAS[Math.floor(Math.random() * IDEAS.length)], true);
        step++;
        setTimeout(tick, 40 + step * step * 1.1); // slows down like a reel
        return;
      }
      showIdea(landOn, false);
      ideaNow = landOn;
      ideaMachine.classList.remove('spinning');
      ideaMachine.classList.add('landed');
      $('idea-live').textContent = landOn[0] + ' idea: ' + landOn[1];
      ideaUse.hidden = false;
      ideaSpinning = false;
    })();
  }
  ideaLever.addEventListener('click', pullLever);
  // "Start this research" opens a new research card on your portfolio with the idea as its title.
  ideaUse.addEventListener('click', function () {
    if (!ideaNow) return;
    if (!me) { openAuth('signin', 'Sign in to start research on this idea.'); return; }
    var mp = myProfile();
    if (!mp) { showToast('Make your portfolio first, then you can start research on this idea.'); return; }
    var title = ideaNow[1].slice(0, 80);
    showProfile(mp.id, true);
    openProject('new');
    var titleIn = $('project-title-input');
    if (titleIn) {
      titleIn.value = title;
      titleIn.closest('.project').scrollIntoView({ block: 'center' });
      var desc = $('project-desc-input');
      if (desc) desc.focus();
    }
  });

  function renderHome() {
    var list = state.profiles;
    renderRecent();
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

    // "Following" shows up once you follow at least one profile; "Friends" once someone follows you back.
    var followed = list.filter(function (p) { return mine(state.follows, p.id); });
    var friendList = followed.filter(function (p) { return areFriends(me.id, p.ownerId); });
    filterEl.hidden = !followed.length;
    filterFriends.hidden = !friendList.length;
    if (!followed.length || (homeFilter === 'friends' && !friendList.length)) homeFilter = 'all';
    filterAll.setAttribute('aria-pressed', homeFilter === 'all' ? 'true' : 'false');
    filterFollowing.setAttribute('aria-pressed', homeFilter === 'following' ? 'true' : 'false');
    filterFriends.setAttribute('aria-pressed', homeFilter === 'friends' ? 'true' : 'false');
    filterFollowing.textContent = 'Following (' + followed.length + ')';
    filterFriends.textContent = 'Friends (' + friendList.length + ')';
    var shown = homeFilter === 'following' ? followed : homeFilter === 'friends' ? friendList : list;

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
  filterFriends.addEventListener('click', function () { homeFilter = 'friends'; renderHome(); });

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
    addNameBadges(name, p);
    who.appendChild(name);
    var meta = make('p', 'profile-meta');
    meta.appendChild(make('span', null, plural(p.projects.length, 'research project')));
    meta.appendChild(make('span', null, '♥ ' + countFor(state.likes, p.id)));
    meta.appendChild(make('span', null, plural(countFor(state.follows, p.id), 'follower')));
    var friendTab = make('span', 'friends-tab', plural(friendCount(p.ownerId), 'friend'));
    friendTab.title = 'People who follow each other with this portfolio';
    meta.appendChild(friendTab);
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
    addNameBadges(siteName, p);
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

  // ---- Profile: character picture ----
  var picBtn = $('edit-pic');
  var picForm = $('pic-form');
  var portrait = $('portrait');
  var profileArt = $('profile-art');
  var picDraft = null; // { character } while the character builder is open
  var PIC_GROUPS = [
    ['Skin', 'skin', 'swatch'], ['Hair', 'hairStyle', 'chip'], ['Bangs', 'bangs', 'chip'], ['Hair color', 'hairColor', 'swatch'],
    ['Clothing', 'outfit', 'chip'], ['Clothing color', 'top', 'swatch'], ['Headwear', 'headwear', 'chip'], ['Glasses', 'glasses', 'chip'],
    ['Face', 'face', 'chip'], ['Background', 'bg', 'swatch'], ['Frame', 'frame', 'chip']
  ];

  function paintPortrait(avatar, name) {
    portrait.textContent = '';
    var pic = pictureNode(avatar, name);
    if (pic) portrait.appendChild(pic);
    portrait.hidden = !pic;
    profileArt.classList.toggle('has-portrait', !!pic);
  }
  function draftAvatar() {
    return { mode: 'character', character: picDraft.character };
  }
  function closePicEditor() {
    picForm.hidden = true;
    picForm.textContent = '';
    picDraft = null;
  }
  picBtn.addEventListener('click', function () {
    var a = current().avatar;
    picDraft = { character: normalizeCharacter(a ? a.character : DEFAULT_CHAR) };
    editBtn.hidden = true;
    picBtn.hidden = true;
    buildPicForm(null);
    picForm.hidden = false;
  });

  // The character builder: pick each feature and watch the preview (and the portrait on the tracks) update.
  function buildPicForm(focusId) {
    var p = current();
    picForm.textContent = '';
    var top = make('div', 'pic-top');
    var preview = make('div', 'pic-preview');
    function updatePreview() {
      preview.textContent = '';
      preview.appendChild(pictureNode(draftAvatar(), p.name));
      paintPortrait(draftAvatar(), p.name);
    }
    top.appendChild(preview);
    top.appendChild(make('p', 'pic-note', 'Build your character. Everyone who visits the site can see it.'));
    picForm.appendChild(top);

    var statusEl = statusLine('');
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

    var actions = make('div', 'edit-actions');
    var save = make('button', 'btn btn-solid', 'Save character');
    save.type = 'submit';
    var cancel = make('button', 'btn btn-ghost', 'Cancel');
    cancel.type = 'button';
    actions.appendChild(save);
    actions.appendChild(cancel);
    var buttons = [save, cancel];
    if (p.avatar) {
      var removePic = make('button', 'btn btn-ghost', 'Remove character');
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
      updateProfile(p, { avatar: avatar }, statusEl, buttons, function () { p.avatar = avatar; finishPic(); });
    };

    updatePreview();
    var focusEl = (focusId && $(focusId)) || picForm.querySelector('button');
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
    card.id = 'project-' + p.id;
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
    var collabLine = collabNames(p);
    if (collabLine) card.appendChild(collabLine);
    var mineToEdit = canEditProject(p); // owner or accepted collaborator

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
    if (p.sources.length || mineToEdit) {
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

    // Footer: research likes for everyone to see; only other people's research can be liked.
    var tools = make('div', 'project-tools');
    tools.appendChild(researchLikeButton(p));

    // Comments and tips: open a panel under the card.
    var comments = state.comments.filter(function (c) { return c.projectId === p.id; });
    var open = !!commentsOpen[p.id];
    tools.appendChild(researchCommentButton(p, comments.length, open, function () {
      commentsOpen[p.id] = !commentsOpen[p.id];
      renderProjects();
      var box = $('comment-input-' + p.id);
      if (commentsOpen[p.id] && box) box.focus();
    }));

    if (mineToEdit) {
      var edit = make('button', 'mini-btn', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', function () { openProject(p.id); });
      tools.appendChild(edit);
    }
    card.appendChild(tools);
    if (open) card.appendChild(commentsPanel(p, comments, editable));
    return card;
  }

  // The ♥ like button on a research card (on portfolios and in Recent research).
  // Only other people's research can be liked.
  function researchLikeButton(q) {
    var likes = state.projectLikes.filter(function (l) { return l.projectId === q.id; });
    var liked = !!me && likes.some(function (l) { return l.userId === me.id; });
    var like = make('button', 'card-like');
    like.type = 'button';
    like.setAttribute('aria-pressed', liked ? 'true' : 'false');
    like.setAttribute('aria-label', (liked ? 'Unlike ' : 'Like ') + q.title + ', ' + plural(likes.length, 'like'));
    var heart = make('span', 'card-like-heart', '♥');
    heart.setAttribute('aria-hidden', 'true');
    like.appendChild(heart);
    like.appendChild(make('span', null, String(likes.length)));
    if (canEditProject(q)) {
      like.disabled = true;
      like.classList.add('own');
      like.title = "You can't like your own research";
      like.setAttribute('aria-label', plural(likes.length, 'like') + '. You can’t like your own research.');
    } else {
      like.disabled = likingProject === q.id;
      like.addEventListener('click', function () { toggleProjectLike(q); });
    }
    return like;
  }
  // The speech-bubble button that opens a research card's comments and tips.
  function researchCommentButton(q, count, open, onClick) {
    var talk = make('button', 'card-like card-comment');
    talk.type = 'button';
    talk.setAttribute('aria-expanded', open ? 'true' : 'false');
    talk.setAttribute('aria-controls', 'comments-' + q.id);
    talk.setAttribute('aria-label', plural(count, 'comment') + ' on ' + q.title);
    talk.appendChild(bubbleIcon());
    talk.appendChild(make('span', null, String(count)));
    talk.addEventListener('click', onClick);
    return talk;
  }
  // Likes and comments can change from a portfolio or from Recent research: redraw whichever is showing.
  function rerenderResearch() {
    if (!profileView.hidden && current()) renderProjects();
    if (!homeView.hidden) renderRecent();
  }

  // "Collab with …" under a card's title: everyone working on it except the portfolio you're looking at.
  function collabNames(q) {
    var collabs = acceptedCollabs(q.id);
    if (!collabs.length) return null;
    var here = current();
    var people = [findProfile(q.profileId)].concat(collabs.map(function (c) { return findProfile(c.toProfile); }))
      .filter(function (x) { return x && (!here || x.id !== here.id); });
    if (!people.length) return null;
    var line = make('p', 'project-collab');
    line.appendChild(make('span', 'project-collab-tag', 'Collab'));
    line.appendChild(document.createTextNode(' with '));
    people.forEach(function (x, i) {
      if (i) line.appendChild(document.createTextNode(i === people.length - 1 ? ' and ' : ', '));
      var b = make('button', 'link-btn project-collab-name');
      b.type = 'button';
      paintName(b, x.name);
      b.addEventListener('click', function () { showProfile(x.id, true); });
      line.appendChild(b);
    });
    return line;
  }

  // ---- Comments and tips on research ----
  var commentsReady = true;  // false until the comments table exists in Supabase
  var commentsOpen = {};     // research id -> panel open, for this visit
  var commentDrafts = {};    // research id -> unsent text, kept across re-renders
  var commentKinds = {};     // research id -> 'comment' or 'tip'
  var postingComment = null;
  var armedDelete = null;    // comment id waiting for a second click to delete

  function bubbleIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'card-comment-icon');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5Z');
    svg.appendChild(path);
    return svg;
  }

  // A deleted comment gets a tap from a magic wand: the wand swoops in and taps it, a gold star
  // forms where it touched with a little burst of sparkles, and the comment vanishes while the
  // gap it leaves closes. Resolves when the effect is finished.
  function wandTapAway(el) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !el.animate) {
      el.style.transition = 'opacity 0.2s';
      el.style.opacity = '0';
      return new Promise(function (done) { setTimeout(done, 200); });
    }
    var rect = el.getBoundingClientRect();
    // Tap a little right of the comment's middle.
    var x = rect.left + rect.width * 0.62;
    var y = rect.top + rect.height / 2;

    var fx = make('div', 'wand-fx');
    fx.setAttribute('aria-hidden', 'true');
    fx.style.left = x + 'px';
    fx.style.top = y + 'px';
    var wand = make('div', 'wand');
    wand.appendChild(make('span', 'wand-stick'));
    wand.appendChild(make('span', 'wand-tip'));
    var star = make('span', 'wand-star');
    fx.appendChild(star);
    var sparks = [];
    for (var i = 0; i < 6; i++) {
      var sp = make('span', 'wand-spark' + (i % 2 ? ' pink' : ''));
      fx.appendChild(sp);
      sparks.push(sp);
    }
    fx.appendChild(wand);
    document.body.appendChild(fx);

    function pose(px, py, deg) { return 'translate(' + px + 'px, ' + py + 'px) rotate(' + deg + 'deg)'; }
    var wandAnim = wand.animate([
      { transform: pose(80, -80, -40), opacity: 0, offset: 0 },
      { transform: pose(10, -10, -40), opacity: 1, offset: 0.28 },
      { transform: pose(0, 0, -22), opacity: 1, offset: 0.4 },
      { transform: pose(8, -8, -48), opacity: 1, offset: 0.55 },
      { transform: pose(70, -70, -40), opacity: 0, offset: 1 }
    ], { duration: 1150, easing: 'ease-in-out', fill: 'forwards' });

    // The star forms at the moment of the tap, then fades.
    star.animate([
      { transform: 'scale(0) rotate(-120deg)', opacity: 0 },
      { transform: 'scale(1.35) rotate(0deg)', opacity: 1, offset: 0.35 },
      { transform: 'scale(1) rotate(10deg)', opacity: 1, offset: 0.65 },
      { transform: 'scale(0.6) rotate(25deg)', opacity: 0 }
    ], { duration: 950, delay: 430, easing: 'ease-out', fill: 'both' });
    sparks.forEach(function (sp, i) {
      var a = (i / sparks.length) * Math.PI * 2 - Math.PI / 2;
      var r = 30 + (i % 2) * 10;
      sp.animate([
        { transform: 'translate(0, 0) scale(0.4)', opacity: 0 },
        { transform: 'translate(' + Math.cos(a) * r * 0.6 + 'px, ' + Math.sin(a) * r * 0.6 + 'px) scale(1)', opacity: 1, offset: 0.4 },
        { transform: 'translate(' + Math.cos(a) * r + 'px, ' + Math.sin(a) * r + 'px) scale(0.3)', opacity: 0 }
      ], { duration: 650, delay: 450, easing: 'ease-out', fill: 'both' });
    });

    // The comment vanishes as the star appears, then the gap closes.
    el.animate([
      { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' },
      { transform: 'scale(0.85)', opacity: 0, filter: 'blur(4px)' }
    ], { duration: 320, delay: 440, easing: 'ease-in', fill: 'both' }).finished.then(function () {
      el.animate([
        { height: el.offsetHeight + 'px' },
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', borderWidth: '0px', marginTop: '-0.6rem' }
      ], { duration: 280, easing: 'ease-in-out', fill: 'forwards' });
    });

    return wandAnim.finished.then(function () {
      return new Promise(function (done) { setTimeout(done, 300); });
    }).then(function () { fx.remove(); });
  }

  // Commenters are named by their portfolio, if they have one.
  function authorName(userId) {
    for (var i = 0; i < state.profiles.length; i++) {
      if (state.profiles[i].ownerId === userId) return state.profiles[i].name;
    }
    return 'A Dollar Search member';
  }

  function commentsPanel(p, comments, editable) {
    var panel = make('div', 'comments');
    panel.id = 'comments-' + p.id;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Comments on ' + p.title);

    if (!commentsReady) {
      panel.appendChild(make('p', 'comments-empty', 'Comments are not switched on for this site yet.'));
      return panel;
    }
    if (!comments.length) {
      panel.appendChild(make('p', 'comments-empty', editable ? 'No comments on this research yet.' : 'No comments yet. Leave the first one.'));
    } else {
      var list = make('ul', 'comment-list');
      comments.forEach(function (c) {
        var li = make('li', 'comment');
        var head = make('div', 'comment-head');
        head.appendChild(make('span', 'comment-author', authorName(c.userId)));
        if (c.kind === 'tip') head.appendChild(make('span', 'comment-tip', 'Tip'));
        head.appendChild(make('span', 'comment-when', timeAgo(c.createdAt)));
        li.appendChild(head);
        li.appendChild(make('p', 'comment-body', c.body));
        if (me && (c.userId === me.id || editable || isAdmin)) {
          var del = make('button', 'link-btn comment-delete', armedDelete === c.id ? 'Click again to delete' : 'Delete');
          del.type = 'button';
          del.addEventListener('click', function () {
            if (armedDelete !== c.id) { armedDelete = c.id; rerenderResearch(); return; }
            armedDelete = null;
            del.disabled = true;
            // The wand works its magic while the delete is saved; the list updates once both are done.
            Promise.all([
              wandTapAway(li),
              client.from('project_comments').delete().eq('id', c.id)
            ]).then(function (results) {
              var res = results[1];
              if (res.error) {
                // Bring the comment back and say why it couldn't be deleted.
                li.getAnimations().forEach(function (a) { a.cancel(); });
                li.style.opacity = '';
                del.disabled = false;
                del.textContent = dbMessage(res.error);
                return;
              }
              state.comments = state.comments.filter(function (x) { return x.id !== c.id; });
              rerenderResearch();
              refresh();
            });
          });
          li.appendChild(del);
        }
        list.appendChild(li);
      });
      panel.appendChild(list);
    }

    if (!me) {
      var signIn = make('button', 'link-btn', 'Sign in to leave a comment or tip');
      signIn.type = 'button';
      signIn.addEventListener('click', function () { openAuth('signin', 'Sign in to comment on research.'); });
      panel.appendChild(signIn);
      return panel;
    }
    if (editable) {
      panel.appendChild(make('p', 'comments-note', "You can't comment on your own research."));
      return panel;
    }

    var f = make('form', 'comment-form');
    var kind = commentKinds[p.id] || 'comment';
    var kinds = make('div', 'card-tabs');
    kinds.setAttribute('role', 'group');
    kinds.setAttribute('aria-label', 'Type of note');
    [['comment', 'Comment'], ['tip', 'Tip']].forEach(function (k) {
      var b = make('button', 'card-tab', k[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', kind === k[0] ? 'true' : 'false');
      b.addEventListener('click', function () {
        commentKinds[p.id] = k[0];
        Array.prototype.forEach.call(kinds.children, function (x) {
          x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        });
        box.placeholder = k[0] === 'tip' ? 'Share a tip to improve this research…' : 'Write a comment…';
      });
      kinds.appendChild(b);
    });
    var box = make('textarea');
    box.id = 'comment-input-' + p.id;
    box.rows = 3;
    box.maxLength = 500;
    box.placeholder = kind === 'tip' ? 'Share a tip to improve this research…' : 'Write a comment…';
    box.setAttribute('aria-label', 'Your comment or tip');
    box.value = commentDrafts[p.id] || '';
    box.addEventListener('input', function () { commentDrafts[p.id] = box.value; });
    var row = make('div', 'edit-actions');
    var post = make('button', 'btn btn-solid', 'Post');
    post.type = 'submit';
    post.disabled = postingComment === p.id;
    row.appendChild(post);
    var statusEl = statusLine('');
    f.appendChild(kinds);
    f.appendChild(box);
    f.appendChild(row);
    f.appendChild(statusEl);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = box.value.trim();
      if (!text) { statusEl.textContent = 'Write something before posting.'; box.focus(); return; }
      postingComment = p.id;
      post.disabled = true;
      statusEl.textContent = 'Posting…';
      client.from('project_comments').insert({ project_id: p.id, kind: commentKinds[p.id] || 'comment', body: text })
        .then(function (res) {
          postingComment = null;
          post.disabled = false;
          if (res.error) { statusEl.textContent = dbMessage(res.error); return; }
          commentDrafts[p.id] = '';
          box.value = '';
          refresh();
        });
    });
    panel.appendChild(f);
    return panel;
  }

  var likingProject = null; // the research project whose like is being saved
  function toggleProjectLike(q) {
    if (!me) { openAuth('signin', 'Sign in to like research.'); return; }
    if (likingProject || canEditProject(q)) return;
    var mineIndex = -1;
    state.projectLikes.forEach(function (l, i) { if (l.userId === me.id && l.projectId === q.id) mineIndex = i; });
    var before = state.projectLikes.slice();
    // Show the change right away, then save it.
    if (mineIndex >= 0) state.projectLikes.splice(mineIndex, 1);
    else state.projectLikes.push({ userId: me.id, projectId: q.id });
    likingProject = q.id;
    rerenderResearch();
    var request = mineIndex >= 0
      ? client.from('project_likes').delete().eq('user_id', me.id).eq('project_id', q.id)
      : client.from('project_likes').insert({ project_id: q.id });
    request.then(function (res) {
      likingProject = null;
      if (res.error) {
        state.projectLikes = before;
        if (profileView.hidden) {
          showToast(dbMessage(res.error));
        } else {
          reactNote.textContent = dbMessage(res.error);
          reactNote.hidden = false;
        }
      }
      rerenderResearch();
      if (!res.error) refresh();
    });
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
    var owner = isNew ? null : findProfile(p.profileId);
    // Collaborators can edit a card but only its owner can delete it.
    if (!isNew && owner && canEdit(owner)) {
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
    // Research shared with this portfolio through an accepted collab shows after its own research.
    var cards = p.projects.concat(collabProjectsFor(p));
    if (editingId === 'new' ? !editable : editingId !== null && !cards.some(function (q) {
      return q.id === editingId && canEditProject(q);
    })) editingId = null;
    projectsEl.textContent = '';
    cards.forEach(function (q) {
      var owner = findProfile(q.profileId);
      projectsEl.appendChild(editingId === q.id ? projectForm(q) : projectCard(q, !!owner && canEdit(owner)));
    });
    if (editable) projectsEl.appendChild(editingId === 'new' ? projectForm(null) : addProjectCard());
    projectsEl.hidden = !cards.length && !editable;
    emptyEl.hidden = cards.length > 0 || editable;
  }

  // ---- Likes and followers ----
  var likeBtn = $('like-btn');
  var followBtn = $('follow-btn');
  var reactNote = $('react-note');
  var followersPanel = $('followers-panel');
  var writingReaction = false;
  var followersOpen = false; // the list of who follows you, on your own portfolio
  var OWN_NOTE = "You can't like or follow your own portfolio. Click Followers to see who follows you.";

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
    var own = canEdit(p);
    setReactButton(likeBtn, liked, '♥', liked ? 'Liked' : 'Like', String(countFor(state.likes, p.id)));
    // On your own portfolio the follow button becomes "Followers" and opens the list of who follows you.
    if (own) {
      setReactButton(followBtn, followersOpen, '☰', 'Followers', plural(countFor(state.follows, p.id), 'follower'));
      followBtn.setAttribute('aria-expanded', followersOpen ? 'true' : 'false');
      followBtn.setAttribute('aria-controls', 'followers-panel');
    } else {
      followersOpen = false;
      // If they follow you back, you're friends.
      var friends = following && areFriends(me.id, p.ownerId);
      setReactButton(followBtn, following, following ? '✓' : '+', friends ? 'Friends' : following ? 'Following' : 'Follow',
        plural(countFor(state.follows, p.id), 'follower'));
      followBtn.title = friends ? 'You follow each other. Click to unfollow.' : '';
      followBtn.removeAttribute('aria-expanded');
      followBtn.removeAttribute('aria-controls');
    }
    // You see the counts on your own portfolio but can't like or follow it.
    likeBtn.disabled = own || writingReaction;
    followBtn.disabled = !own && writingReaction;
    likeBtn.classList.toggle('own', own);
    if (own) {
      reactNote.textContent = OWN_NOTE;
      reactNote.hidden = false;
    } else if (reactNote.textContent === OWN_NOTE) {
      reactNote.hidden = true;
    }
    renderFollowers(p);
    renderCollabs(p, own);
  }
  // The follow row where `userId` follows any portfolio owned by `ownerId`, or undefined.
  function followOfOwner(userId, ownerId) {
    return state.follows.filter(function (f) {
      var target = findProfile(f.profileId);
      return f.userId === userId && target && target.ownerId === ownerId;
    })[0];
  }
  // Two people are friends when each follows the other's portfolio.
  function areFriends(userA, userB) {
    return userA !== userB && !!followOfOwner(userA, userB) && !!followOfOwner(userB, userA);
  }
  // How many people this person follows each other with.
  function friendCount(ownerId) {
    var seen = {};
    state.follows.forEach(function (f) {
      var target = findProfile(f.profileId);
      if (target && target.ownerId === ownerId && areFriends(ownerId, f.userId)) seen[f.userId] = true;
    });
    return Object.keys(seen).length;
  }
  function followerItem(fp, line) {
    var li = make('li');
    var b = make('button', 'follower');
    b.type = 'button';
    var pic = pictureNode(fp.avatar, fp.name);
    var avatar = make('span', 'avatar follower-avatar', pic ? null : fp.name.charAt(0).toUpperCase());
    if (pic) avatar.appendChild(pic);
    avatar.setAttribute('aria-hidden', 'true');
    var text = make('span', 'follower-text');
    var name = make('span', 'follower-name');
    paintName(name, fp.name);
    text.appendChild(name);
    if (line) text.appendChild(make('span', 'follower-when', line));
    b.appendChild(avatar);
    b.appendChild(text);
    b.addEventListener('click', function () { showProfile(fp.id, true); });
    li.appendChild(b);
    return li;
  }
  // Friends (you follow each other) come first, then other followers, newest first;
  // people without a portfolio are counted at the end.
  function renderFollowers(p) {
    followersPanel.hidden = !followersOpen;
    followersPanel.textContent = '';
    if (!followersOpen) return;
    var rows = state.follows.filter(function (f) { return f.profileId === p.id; })
      .sort(function (a, b) { return b.since - a.since; });
    if (!rows.length) {
      followersPanel.appendChild(make('p', 'followers-head', 'Who follows you'));
      followersPanel.appendChild(make('p', 'followers-empty', "No followers yet. When someone follows your portfolio, they'll show up here."));
      return;
    }
    var friends = make('ul', 'followers-list');
    var followers = make('ul', 'followers-list');
    var noPortfolio = 0;
    rows.forEach(function (f) {
      var fp = state.profiles.filter(function (x) { return x.ownerId === f.userId; })[0];
      if (!fp) { noPortfolio++; return; }
      var back = followOfOwner(p.ownerId, f.userId);
      if (back && f.userId !== p.ownerId) {
        var since = Math.max(f.since, back.since);
        friends.appendChild(followerItem(fp, since ? 'Friends since ' + timeAgo(since).toLowerCase() : 'You follow each other'));
      } else {
        followers.appendChild(followerItem(fp, f.since ? 'Followed you ' + timeAgo(f.since).toLowerCase() : ''));
      }
    });
    if (noPortfolio) {
      followers.appendChild(make('li', 'follower-more',
        (noPortfolio === 1 ? '1 person' : noPortfolio + ' people') + ' without a portfolio yet'));
    }
    if (friends.children.length) {
      followersPanel.appendChild(make('p', 'followers-head', 'Friends · ' + friends.children.length));
      followersPanel.appendChild(make('p', 'followers-sub', 'You follow each other.'));
      followersPanel.appendChild(friends);
    }
    if (followers.children.length) {
      followersPanel.appendChild(make('p', 'followers-head', friends.children.length ? 'Other followers' : 'Who follows you'));
      followersPanel.appendChild(followers);
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
  followBtn.addEventListener('click', function () {
    var p = current();
    if (p && canEdit(p)) {
      followersOpen = !followersOpen;
      if (followersOpen) collabOpen = false;
      renderProfileReactions();
      return;
    }
    toggleReaction('follows');
  });

  // ---- Collab requests ----
  // On someone else's portfolio: invite them to work on one of your research cards (or a new one).
  // On your own: answer requests, see your collabs and the requests you've sent.
  var collabBtn = $('collab-btn');
  var collabPanel = $('collab-panel');
  var collabOpen = false;
  var collabNote = '';       // a status line shown in the panel
  var collabWorking = false;
  var collabDraft = { card: '', title: '', message: '' }; // card: a research id or 'new'
  var armedCollabEnd = null; // collab id waiting for a second click to end it

  function collabTitle(c) {
    var q = findProject(c.projectId);
    return q ? q.title : 'a research card';
  }
  function collabRow(person, lines, buttons) {
    var li = make('li', 'collab-item');
    if (person) {
      var pic = pictureNode(person.avatar, person.name);
      var avatar = make('span', 'avatar follower-avatar', pic ? null : person.name.charAt(0).toUpperCase());
      if (pic) avatar.appendChild(pic);
      avatar.setAttribute('aria-hidden', 'true');
      li.appendChild(avatar);
    }
    var text = make('div', 'collab-text');
    lines.forEach(function (l) { if (l) text.appendChild(l); });
    if (buttons.length) {
      var row = make('div', 'collab-actions');
      buttons.forEach(function (b) { row.appendChild(b); });
      text.appendChild(row);
    }
    li.appendChild(text);
    return li;
  }
  function personLine(person, rest) {
    var line = make('p', 'collab-line');
    var name = make('button', 'link-btn project-collab-name');
    name.type = 'button';
    paintName(name, person ? person.name : 'Someone');
    if (person) name.addEventListener('click', function () { showProfile(person.id, true); });
    line.appendChild(name);
    line.appendChild(document.createTextNode(' ' + rest));
    return line;
  }
  function collabButton(label, cls, onClick) {
    var b = make('button', 'mini-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.disabled = collabWorking;
    b.addEventListener('click', onClick);
    return b;
  }
  // Runs a request, then shows `done` (or the error) in the panel and reloads.
  function collabWrite(request, done) {
    collabWorking = true;
    collabNote = 'Saving…';
    renderProfileReactions();
    return request.then(function (res) {
      collabWorking = false;
      if (res.error) {
        collabNote = res.error.code === '23505' ? "You've already invited them to that research card." : dbMessage(res.error);
        renderProfileReactions();
        return false;
      }
      collabNote = done;
      armedCollabEnd = null;
      refresh();
      return true;
    });
  }
  function respond(c, status) {
    collabWrite(client.from('collab_requests').update({ status: status, responded_at: new Date().toISOString() }).eq('id', c.id),
      status === 'accepted' ? 'Accepted. You can now edit “' + collabTitle(c) + '”, and it shows on your portfolio.' : 'Request declined.');
  }
  function removeCollab(c, done) {
    collabWrite(client.from('collab_requests').delete().eq('id', c.id), done);
  }

  function renderCollabs(p, own) {
    collabBtn.hidden = !client || !collabsReady;
    if (collabBtn.hidden) { collabPanel.hidden = true; return; }
    var incoming = state.collabs.filter(function (c) { return c.toProfile === p.id && c.status === 'pending'; });
    if (own) {
      var active = state.collabs.filter(function (c) {
        var q = findProject(c.projectId);
        return c.status === 'accepted' && (c.toProfile === p.id || (q && q.profileId === p.id));
      });
      setReactButton(collabBtn, collabOpen, '⇄', 'Collabs',
        incoming.length ? plural(incoming.length, 'request') : String(active.length));
    } else {
      setReactButton(collabBtn, collabOpen, '⇄', 'Request collab', '');
    }
    collabBtn.setAttribute('aria-expanded', collabOpen ? 'true' : 'false');
    collabPanel.hidden = !collabOpen;
    collabPanel.textContent = '';
    if (!collabOpen) return;
    if (own) fillCollabInbox(p, incoming, active); else fillCollabRequest(p);
    if (collabNote) collabPanel.appendChild(make('p', 'edit-status collab-note', collabNote));
  }

  function fillCollabInbox(p, incoming, active) {
    var sent = me ? state.collabs.filter(function (c) { return c.fromUser === me.id && c.status !== 'accepted'; }) : [];
    if (!incoming.length && !active.length && !sent.length) {
      collabPanel.appendChild(make('p', 'followers-head', 'Collabs'));
      collabPanel.appendChild(make('p', 'followers-empty',
        "No collabs yet. Open someone else's portfolio and click Request collab to invite them to work on one of your research cards."));
      return;
    }
    if (incoming.length) {
      collabPanel.appendChild(make('p', 'followers-head', 'Requests for you · ' + incoming.length));
      var inList = make('ul', 'followers-list collab-list');
      incoming.forEach(function (c) {
        var from = state.profiles.filter(function (x) { return x.ownerId === c.fromUser; })[0];
        inList.appendChild(collabRow(from, [
          personLine(from, 'wants to collaborate on “' + collabTitle(c) + '”'),
          c.message ? make('p', 'collab-message', '“' + c.message + '”') : null,
          make('p', 'follower-when', timeAgo(c.createdAt))
        ], [
          collabButton('Accept', 'collab-accept', function () { respond(c, 'accepted'); }),
          collabButton('Decline', '', function () { respond(c, 'declined'); })
        ]));
      });
      collabPanel.appendChild(inList);
    }
    if (active.length) {
      collabPanel.appendChild(make('p', 'followers-head', 'Your collabs · ' + active.length));
      var activeList = make('ul', 'followers-list collab-list');
      active.forEach(function (c) {
        var q = findProject(c.projectId);
        // The other person: the card's owner if it was shared with you, otherwise who you shared it with.
        var other = q && q.profileId === p.id ? findProfile(c.toProfile) : findProfile(q ? q.profileId : null);
        var end = collabButton(armedCollabEnd === c.id ? 'Click again to end' : 'End collab', armedCollabEnd === c.id ? 'armed' : '', function () {
          if (armedCollabEnd !== c.id) { armedCollabEnd = c.id; collabNote = 'Ending a collab takes away their access to the card.'; renderProfileReactions(); return; }
          removeCollab(c, 'Collab ended.');
        });
        activeList.appendChild(collabRow(other, [
          personLine(other, 'and you on “' + collabTitle(c) + '”'),
          c.respondedAt ? make('p', 'follower-when', 'Started ' + timeAgo(c.respondedAt).toLowerCase()) : null
        ], [end]));
      });
      collabPanel.appendChild(activeList);
    }
    if (sent.length) {
      collabPanel.appendChild(make('p', 'followers-head', 'Requests you sent'));
      var sentList = make('ul', 'followers-list collab-list');
      sent.forEach(function (c) {
        var to = findProfile(c.toProfile);
        sentList.appendChild(collabRow(to, [
          personLine(to, c.status === 'declined' ? 'declined “' + collabTitle(c) + '”' : 'hasn’t answered about “' + collabTitle(c) + '” yet')
        ], [
          collabButton(c.status === 'declined' ? 'Remove' : 'Cancel request', '', function () {
            removeCollab(c, c.status === 'declined' ? 'Removed.' : 'Request cancelled.');
          })
        ]));
      });
      collabPanel.appendChild(sentList);
    }
  }

  function fillCollabRequest(p) {
    var mp = myProfile();
    collabPanel.appendChild(make('p', 'followers-head', 'Collab with ' + p.name));
    if (!mp) {
      collabPanel.appendChild(make('p', 'followers-empty',
        'Make your own portfolio first. Then you can invite people to work on one of your research cards.'));
      return;
    }
    var withThem = state.collabs.filter(function (c) { return c.toProfile === p.id && c.fromUser === me.id; });
    var taken = {};
    withThem.forEach(function (c) { taken[c.projectId] = true; });
    var choices = mp.projects.filter(function (q) { return !taken[q.id]; });

    var f = make('form', 'collab-form');
    f.appendChild(make('p', 'collab-intro',
      'Invite ' + p.name + ' to work on one of your research cards. If they accept, they can edit it, and it shows on their portfolio too.'));
    var select = make('select');
    choices.forEach(function (q) {
      var o = make('option', null, q.title);
      o.value = q.id;
      select.appendChild(o);
    });
    var fresh = make('option', null, '+ Start a new research card');
    fresh.value = 'new';
    select.appendChild(fresh);
    if (!collabDraft.card || (collabDraft.card !== 'new' && !choices.some(function (q) { return q.id === collabDraft.card; }))) {
      collabDraft.card = choices.length ? choices[0].id : 'new';
    }
    select.value = collabDraft.card;
    field('Research card', select, 'collab-card').forEach(function (n) { f.appendChild(n); });

    var titleIn = textInput(80, collabDraft.title);
    titleIn.placeholder = 'What will you research together?';
    var titleBits = field('Title for the new card', titleIn, 'collab-title');
    titleBits.forEach(function (n) { n.hidden = collabDraft.card !== 'new'; f.appendChild(n); });
    select.addEventListener('change', function () {
      collabDraft.card = select.value;
      titleBits.forEach(function (n) { n.hidden = collabDraft.card !== 'new'; });
    });
    titleIn.addEventListener('input', function () { collabDraft.title = titleIn.value; });

    var msgIn = textArea(300, collabDraft.message);
    msgIn.rows = 3;
    msgIn.placeholder = 'Say hi and what you have in mind';
    msgIn.addEventListener('input', function () { collabDraft.message = msgIn.value; });
    field('Message (optional)', msgIn, 'collab-message').forEach(function (n) { f.appendChild(n); });

    var actions = make('div', 'edit-actions');
    var send = make('button', 'btn btn-solid', 'Send request');
    send.type = 'submit';
    send.disabled = collabWorking;
    var cancel = make('button', 'btn btn-ghost', 'Close');
    cancel.type = 'button';
    cancel.addEventListener('click', function () { collabOpen = false; collabNote = ''; renderProfileReactions(); });
    actions.appendChild(send);
    actions.appendChild(cancel);
    f.appendChild(actions);

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (collabWorking) return;
      var message = collabDraft.message.trim();
      var sendFor = function (projectId) {
        return collabWrite(client.from('collab_requests').insert({ project_id: projectId, to_profile: p.id, message: message }),
          'Request sent. You’ll get a notification when ' + p.name + ' accepts.').then(function (ok) {
          if (ok) collabDraft = { card: '', title: '', message: '' };
        });
      };
      if (collabDraft.card !== 'new') { sendFor(collabDraft.card); return; }
      var title = collabDraft.title.trim();
      if (!title) { collabNote = 'Give the new research card a title.'; renderProfileReactions(); $('collab-title').focus(); return; }
      collabWorking = true;
      collabNote = 'Saving…';
      renderProfileReactions();
      client.from('projects').insert({ profile_id: mp.id, title: title, link: '', description: '', sources: [] })
        .select('id').single().then(function (res) {
          collabWorking = false;
          if (res.error) { collabNote = dbMessage(res.error); renderProfileReactions(); return; }
          sendFor(res.data.id);
        });
    });
    collabPanel.appendChild(f);

    if (withThem.length) {
      collabPanel.appendChild(make('p', 'followers-head', 'Already with ' + p.name));
      var list = make('ul', 'followers-list collab-list');
      withThem.forEach(function (c) {
        var status = c.status === 'accepted' ? 'Collaborating' : c.status === 'declined' ? 'Declined' : 'Waiting for an answer';
        list.appendChild(collabRow(null, [
          make('p', 'collab-line', '“' + collabTitle(c) + '”'),
          make('p', 'follower-when', status)
        ], [
          collabButton(c.status === 'pending' ? 'Cancel request' : c.status === 'declined' ? 'Remove' : 'End collab', '', function () {
            removeCollab(c, c.status === 'pending' ? 'Request cancelled.' : c.status === 'declined' ? 'Removed.' : 'Collab ended.');
          })
        ]));
      });
      collabPanel.appendChild(list);
    }
  }

  collabBtn.addEventListener('click', function () {
    if (!me) { openAuth('signin', 'Sign in to collaborate on research.'); return; }
    collabOpen = !collabOpen;
    collabNote = '';
    armedCollabEnd = null;
    if (collabOpen) followersOpen = false;
    renderProfileReactions();
    if (collabOpen && $('collab-card')) $('collab-card').focus();
  });

  // ---- Notification bell: new research from profiles you follow ----
  var bellBtn = $('bell-btn');
  var bellBadge = $('bell-badge');
  var notifPanel = $('notif-panel');

  // Two kinds of notification: new research from profiles you follow, and comments or tips
  // someone else leaves on your research. Each item: { time, profile, project, who, what, comment }.
  function snippet(text) {
    var t = text.replace(/\s+/g, ' ').trim();
    return t.length > 80 ? t.slice(0, 77) + '…' : t;
  }
  function collectNotifs() {
    if (!me) return [];
    var items = [];
    var projectsById = {};
    state.profiles.forEach(function (p) {
      p.projects.forEach(function (q) { projectsById[q.id] = { profile: p, project: q }; });
      var f = mine(state.follows, p.id);
      if (!f) return;
      p.projects.forEach(function (q) {
        if (q.createdAt > f.since) {
          items.push({ time: q.createdAt, profile: p, project: q, who: p.name, what: 'Added new research: ' + q.title });
        }
      });
    });
    state.comments.forEach(function (c) {
      var target = projectsById[c.projectId];
      if (!target || target.profile.ownerId !== me.id || c.userId === me.id) return;
      var label = c.kind === 'tip' ? 'left a tip on ' : 'commented on ';
      items.push({
        time: c.createdAt, profile: target.profile, project: target.project, comment: true,
        who: authorName(c.userId),
        what: label + target.project.title + ': “' + snippet(c.body) + '”'
      });
    });
    // Collab requests sent to you, and your requests that someone accepted.
    var mp = myProfile();
    state.collabs.forEach(function (c) {
      var q = findProject(c.projectId);
      var to = findProfile(c.toProfile);
      if (!q || !to || !mp) return;
      if (c.status === 'pending' && to.ownerId === me.id) {
        items.push({
          time: c.createdAt, profile: mp, project: q, collab: true, who: authorName(c.fromUser),
          what: 'wants to collaborate on ' + q.title + (c.message ? ': “' + snippet(c.message) + '”' : '')
        });
      } else if (c.status === 'accepted' && c.fromUser === me.id) {
        items.push({ time: c.respondedAt || c.createdAt, profile: mp, project: q, collab: true, who: to.name, what: 'accepted your collab on ' + q.title });
      }
    });
    items.sort(function (a, b) { return b.time - a.time; });
    return items.slice(0, 30);
  }
  // How long ago, always rounded down: 3 days and 20 hours is "3 days ago", not 4.
  function timeAgo(t) {
    var mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
    if (mins < 1) return 'Just now';
    if (mins < 60) return plural(mins, 'minute') + ' ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return plural(hours, 'hour') + ' ago';
    var days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return plural(days, 'day') + ' ago';
    if (days < 30) return plural(Math.floor(days / 7), 'week') + ' ago';
    if (days < 365) return plural(Math.floor(days / 30), 'month') + ' ago';
    return plural(Math.floor(days / 365), 'year') + ' ago';
  }
  // The exact date and time, for hover text.
  function exactTime(t) {
    return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  function renderBell() {
    var show = !!client && !!me && loaded && !loadError;
    bellBtn.hidden = !show;
    if (!show) { closeNotifs(); return; }
    var unread = collectNotifs().filter(function (n) { return n.time > seenAt; }).length;
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
        ? 'Nothing new yet. New research from profiles you follow, and comments or tips on your research, show up here.'
        : 'Comments and tips on your research show up here. Follow a profile to also hear when it adds new research.'));
      return;
    }
    items.forEach(function (n) {
      var b = make('button', 'notif-item' + (n.comment || n.collab ? ' notif-comment' : '') + (n.time > lastSeen ? ' unread' : ''));
      b.type = 'button';
      b.appendChild(make('span', 'notif-who', n.who));
      b.appendChild(make('span', 'notif-what', n.what));
      b.appendChild(make('span', 'notif-when', timeAgo(n.time)));
      b.addEventListener('click', function () {
        closeNotifs();
        // A collab notification opens the Collabs list on your own portfolio.
        if (n.collab) {
          showProfile(n.profile.id, true);
          collabOpen = true;
          followersOpen = false;
          renderProfileReactions();
          collabPanel.scrollIntoView({ block: 'center' });
          return;
        }
        // A comment notification opens that card's comments; research opens the Research section.
        if (n.comment) commentsOpen[n.project.id] = true;
        showProfile(n.profile.id, true);
        var target = n.comment ? $('comments-' + n.project.id) : $('research');
        (target || $('research')).scrollIntoView({ block: 'center' });
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
    var newest = collectNotifs().reduce(function (m, n) { return Math.max(m, n.time); }, 0);
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

  // ---- No emojis: they're taken out of every text box as people type or paste ----
  // Emoji-style characters, skin tones and flags. Plain symbols like ♥ ★ © stay, unless written as emoji.
  var EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu;
  var emojiNote = null;
  var emojiNoteTimer = null;
  function stripEmoji(text) {
    var out = text.replace(EMOJI, '');
    // Leftover joiners and emoji-style markers from emoji sequences.
    return out === text ? text : out.replace(/[‍️⃣]/g, '');
  }
  // A short note that pops up at the bottom of the screen for a moment.
  function showToast(text) {
    if (!emojiNote) {
      emojiNote = make('p', 'emoji-note');
      emojiNote.setAttribute('role', 'status');
      document.body.appendChild(emojiNote);
    }
    emojiNote.textContent = text;
    emojiNote.classList.add('show');
    clearTimeout(emojiNoteTimer);
    emojiNoteTimer = setTimeout(function () { emojiNote.classList.remove('show'); }, 2600);
  }
  // Runs before the text box's own listeners (capture), so drafts never keep an emoji.
  document.addEventListener('input', function (e) {
    var el = e.target;
    var isText = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|url)$/.test(el.type));
    if (!isText) return;
    var clean = stripEmoji(el.value);
    if (clean === el.value) return;
    var caret = el.selectionStart;
    var removed = el.value.length - clean.length;
    el.value = clean;
    if (caret != null) {
      var at = Math.max(0, caret - removed);
      el.setSelectionRange(at, at);
    }
    showToast("Emojis can't be used on Dollar Search.");
  }, true);

  // ---- Putting it together ----
  function busy() {
    var typingComment = Object.keys(commentDrafts).some(function (k) { return commentDrafts[k]; });
    var typingCollab = !collabPanel.hidden && collabPanel.contains(document.activeElement);
    return editingId !== null || !form.hidden || !picForm.hidden || addingProfile || !hubForm.hidden || typingComment || typingCollab;
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
