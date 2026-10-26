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
    hairColor: ['#2E2226', '#5B3A29', '#A0643B', '#E3B562', '#E58FA8', '#8E7CC3', '#C2552E', '#EDE3C8', '#6FA8DC', '#7B4FA0'],
    top: ['#F7C8D4', '#D2728F', '#8EC5E8', '#9BD3AE', '#F4D35E', '#4A4E69',
      '#E05A5A', '#F29E4C', '#F28B82', '#B9A6E8', '#BDEBD9', '#4FB3A9', '#2F4A7A', '#8A5A3C', '#2B2B2E', '#F4F1EC', '#5B3A8C', '#F28C28'],
    outfit: ['Tee', 'Hoodie', 'Sweater', 'Shirt', 'Jacket', 'Overalls', 'Vampire cape', 'Flannel', 'Cozy scarf', 'Heart sweater', 'Raincoat'],
    headwear: ['None', 'Cap', 'Beanie', 'Headphones', 'Crown', 'Bow', 'Beret', 'Bucket hat', 'Top hat', 'Headband', 'Flower crown', 'Witch hat', 'Pumpkin hat', 'Bat headband', 'Devil horns', 'Candy corn crown', 'Leaf crown', 'Earmuffs', 'Santa hat', 'Heart headband', 'Bunny ears', 'Sun hat'],
    glasses: ['None', 'Glasses', 'Shades', 'Square', 'Cat-eye', 'Hearts', 'Stars', 'Aviators', 'Monocle'],
    face: ['Smile', 'Grin', 'Cool', 'Wink', 'Happy', 'Laugh', 'Surprised', 'Tongue', 'Sleepy', 'Starry', 'Smirk', 'Vampire', 'Scarecrow (removed)', 'Witch'],
    bg: ['#FBE3E6', '#FFF1D6', '#DDF0FA', '#E3F4E6', '#ECE6FA', '#FFFCF7', '#3B2E5A', '#F6D9B8', '#2F5D50', '#F7C1CF', '#D6EFC7'],
    frame: ['None', 'Hearts', 'Stars', 'Lace', 'Flowers', 'Rainbow', 'Sparkles', 'Bow', 'Pumpkins', 'Ghosts', 'Candy corn', 'Spiderweb', 'Maple leaves', 'Snowflakes', 'Cupid hearts', 'Butterflies'],
    pet: ['None', 'Cat', 'Dog', 'Bunny', 'Hamster', 'Bird', 'Fish', 'Bat', 'Ghost', 'Pumpkin buddy', 'Hedgehog', 'Snowman', 'Penguin', 'Teddy bear', 'Duckling'],
    // The scene on your portfolio: what your character stands on and what's behind it.
    scene: ['Books', 'Library', 'Night sky', 'Garden'],
    petColor: ['#F2A65A', '#9A9AA6', '#FBF7F2', '#3A2E33', '#C9A27A', '#F7C8D4', '#8EC5E8']
  };
  var CHAR_KEYS = ['skin', 'hairStyle', 'bangs', 'hairColor', 'outfit', 'top', 'headwear', 'glasses', 'face', 'bg', 'frame', 'pet', 'petColor', 'scene'];
  var DEFAULT_CHAR = { skin: 1, hairStyle: 0, bangs: 0, hairColor: 1, outfit: 0, top: 0, headwear: 1, glasses: 0, face: 0, bg: 0, frame: 0, pet: 0, petColor: 0, scene: 0 };
  // Options that were removed. They keep their place in the lists above (so the options after them keep
  // their numbers), but nobody can pick them and characters that had one go back to the default.
  var RETIRED = { face: [12] }; // 12: Scarecrow smile
  function isRetired(key, index) { return !!RETIRED[key] && RETIRED[key].indexOf(index) >= 0; }
  function normalizeCharacter(src) {
    var c = {};
    src = src && typeof src === 'object' ? src : {};
    CHAR_KEYS.forEach(function (k) {
      var v = src[k];
      var ok = typeof v === 'number' && Math.floor(v) === v && v >= 0 && v < CHAR[k].length && !isRetired(k, v);
      c[k] = ok ? v : DEFAULT_CHAR[k];
    });
    return c;
  }
  // Profile pictures are characters only; anything else saved in the past is ignored.
  function normalizeAvatar(a) {
    if (!a || typeof a !== 'object' || a.mode !== 'character') return null;
    // The pet's name is shown under the pet on the portfolio.
    var petName = typeof a.petName === 'string' ? a.petName.trim().slice(0, 20) : '';
    return { mode: 'character', character: normalizeCharacter(a.character), petName: petName };
  }

  // ---- State, loaded from the database ----
  var state = { hubName: 'Dollar Search', hubIntro: '', profiles: [], likes: [], follows: [], projectLikes: [], comments: [], collabs: [], purchases: [], giftStars: 0, claims: [], bookmarks: [],
    reactions: [], messages: [], notes: {}, starsGiven: 0, giftsReceived: [], reports: [],
    polls: {}, votes: [], blocks: [], siteGifts: [] };
  var collabsReady = true; // false until the collab_requests table exists in Supabase
  var shopReady = false;   // true once the signed-in person's Star Shop purchases have loaded
  var claimsReady = false; // true once daily star claims have loaded
  var bookmarksReady = false; // true once saved research has loaded
  var reactionsReady = false; // true once research reactions (Inspiring, Smart, Well-sourced) have loaded
  var messagesReady = false;  // true once messages with friends have loaded
  var notesReady = false;     // true once team notes have loaded
  var reportsReady = false;   // true once reports can be sent (and, for the site owner, read)
  var statusReady = false;    // research can be marked In progress or Finished
  var repliesReady = false;   // comments can have replies
  var pollsReady = false;     // research cards can have a quick poll
  var blocksReady = false;    // you can block people
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
  // Research topics, shared by research tags and the idea generator.
  var TAGS = ['Science', 'Technology', 'Health', 'Environment', 'Space', 'Society', 'Money', 'Sports',
    'Food', 'Arts', 'Animals', 'Education', 'Psychology', 'History'];
  // True once the database has the newer research columns (tags, image, updated date, pinned card).
  var extrasReady = false;
  function toProject(r) {
    var created = Date.parse(r.created_at) || 0;
    return {
      id: r.id, profileId: r.profile_id, title: r.title || '', link: r.link || '',
      description: r.description || '', sources: normalizeSources(r.sources),
      createdAt: created,
      tags: Array.isArray(r.tags) ? r.tags.filter(function (t) { return TAGS.indexOf(t) >= 0; }).slice(0, 3) : [],
      image: typeof r.image === 'string' ? r.image : '',
      updatedAt: Date.parse(r.updated_at) || created,
      status: r.status === 'in-progress' || r.status === 'finished' ? r.status : ''
    };
  }
  // Selects the newer columns too, falling back to the original ones if the database doesn't have them yet.
  function selectNewer(table, newer, basic) {
    return client.from(table).select(basic + ', ' + newer).order('created_at').then(function (res) {
      if (!res.error) return res;
      return client.from(table).select(basic).order('created_at').then(function (old) {
        old.usedFallback = true;
        return old;
      });
    });
  }

  // Tries each list of columns in turn, newest first, until the database has them all. res.tier says which worked.
  function selectTiers(table, tiers) {
    function attempt(i) {
      return client.from(table).select(tiers[i]).order('created_at').then(function (res) {
        if (res.error && i < tiers.length - 1) return attempt(i + 1);
        res.tier = i;
        return res;
      });
    }
    return attempt(0);
  }
  var PROJECT_COLUMNS = 'id, profile_id, title, link, description, sources, created_at';

  // Runs a query, and if the database doesn't have its newer columns yet, the older query instead.
  function orOlder(query, older) {
    return query.then(function (res) {
      if (!res.error) return res;
      return older().then(function (old) {
        old.usedFallback = true;
        return old;
      });
    });
  }

  function loadAll() {
    return Promise.all([
      client.from('site_settings').select('hub_name, hub_intro').eq('id', 1).maybeSingle(),
      selectNewer('profiles', 'pinned_project', 'id, owner_id, name, description, email, avatar, created_at'),
      selectTiers('projects', [PROJECT_COLUMNS + ', tags, image, updated_at, status', PROJECT_COLUMNS + ', tags, image, updated_at', PROJECT_COLUMNS]),
      client.from('likes').select('user_id, profile_id'),
      client.from('follows').select('user_id, profile_id, created_at'),
      client.from('project_likes').select('user_id, project_id, created_at'),
      orOlder(client.from('project_comments').select('id, project_id, user_id, kind, body, created_at, parent_id').order('created_at'),
        function () { return client.from('project_comments').select('id, project_id, user_id, kind, body, created_at').order('created_at'); }),
      client.from('collab_requests').select('id, project_id, from_user, to_profile, message, status, created_at, responded_at').order('created_at'),
      client.from('project_reactions').select('user_id, project_id, kind, created_at'),
      client.from('polls').select('project_id, question, options, created_at'),
      client.from('poll_votes').select('project_id, user_id, choice, created_at')
    ]).then(function (res) {
      // Research likes, comments and collabs are optional: if their tables aren't set up yet, the rest of the site still loads.
      res.forEach(function (r, i) { if (r.error && i < 5) throw r.error; });
      if (res[0].data) {
        state.hubName = res[0].data.hub_name || 'Dollar Search';
        state.hubIntro = res[0].data.hub_intro || '';
      }
      extrasReady = !res[1].usedFallback && res[2].tier <= 1;
      statusReady = res[2].tier === 0;
      var projects = res[2].data.map(toProject);
      state.profiles = res[1].data.map(function (r) {
        return {
          id: r.id, ownerId: r.owner_id, name: r.name || 'Untitled profile',
          description: r.description || '', email: r.email || '', avatar: normalizeAvatar(r.avatar),
          pinnedProject: r.pinned_project || null,
          projects: projects.filter(function (q) { return q.profileId === r.id; })
        };
      });
      state.likes = res[3].data.map(function (l) { return { userId: l.user_id, profileId: l.profile_id }; });
      state.follows = res[4].data.map(function (f) {
        return { userId: f.user_id, profileId: f.profile_id, since: Date.parse(f.created_at) || 0 };
      });
      state.projectLikes = res[5].error ? [] : res[5].data.map(function (l) {
        return { userId: l.user_id, projectId: l.project_id, at: Date.parse(l.created_at) || 0 };
      });
      commentsReady = !res[6].error;
      repliesReady = !res[6].error && !res[6].usedFallback;
      state.comments = res[6].error ? [] : res[6].data.map(function (c) {
        return {
          id: c.id, projectId: c.project_id, userId: c.user_id, kind: c.kind === 'tip' ? 'tip' : 'comment',
          body: c.body || '', createdAt: Date.parse(c.created_at) || 0, parentId: c.parent_id || null
        };
      });
      // Polls on research cards, and everyone's votes.
      pollsReady = !res[9].error && !res[10].error;
      state.polls = {};
      if (pollsReady) {
        res[9].data.forEach(function (p) {
          state.polls[p.project_id] = { question: p.question, options: Array.isArray(p.options) ? p.options : [] };
        });
      }
      state.votes = pollsReady ? res[10].data.map(function (v) {
        return { projectId: v.project_id, userId: v.user_id, choice: v.choice, at: Date.parse(v.created_at) || 0 };
      }) : [];
      collabsReady = !res[7].error;
      state.collabs = res[7].error ? [] : res[7].data.map(function (c) {
        return {
          id: c.id, projectId: c.project_id, fromUser: c.from_user, toProfile: c.to_profile,
          message: c.message || '', status: c.status,
          createdAt: Date.parse(c.created_at) || 0, respondedAt: Date.parse(c.responded_at) || 0
        };
      });
      reactionsReady = !res[8].error;
      state.reactions = res[8].error ? [] : res[8].data.map(function (r) {
        return { userId: r.user_id, projectId: r.project_id, kind: r.kind, at: Date.parse(r.created_at) || 0 };
      });
      if (!me) {
        isAdmin = false; seenAt = 0; shopReady = false; state.purchases = []; state.giftStars = 0; state.claims = []; state.bookmarks = [];
        messagesReady = false; notesReady = false; state.messages = []; state.notes = {};
        giftingReady = false; state.starsGiven = 0; state.giftsReceived = [];
        reportsReady = false; state.reports = [];
        blocksReady = false; state.blocks = []; state.siteGifts = [];
        return;
      }
      return Promise.all([
        client.from('site_admins').select('user_id').eq('user_id', me.id).maybeSingle(),
        client.from('notif_state').select('seen_at').eq('user_id', me.id).maybeSingle(),
        // With gifting set up, you also see items and stars you gave to friends (falls back to just your own).
        orOlder(client.from('shop_purchases').select('item, price, user_id, paid_by, created_at'),
          function () { return client.from('shop_purchases').select('item, price').eq('user_id', me.id); }),
        orOlder(client.from('star_gifts').select('user_id, stars, from_user, reason, created_at'),
          function () { return client.from('star_gifts').select('stars').eq('user_id', me.id); }),
        client.from('star_claims').select('day').eq('user_id', me.id),
        client.from('bookmarks').select('project_id, created_at').eq('user_id', me.id).order('created_at', { ascending: false }),
        client.from('messages').select('id, from_user, to_user, body, created_at, read_at').order('created_at'),
        client.from('collab_notes').select('project_id, body, updated_by, updated_at'),
        client.from('reports').select('id, reporter, kind, target_id, reason, created_at').order('created_at', { ascending: false }),
        client.from('blocks').select('blocked_user').eq('user_id', me.id)
      ]).then(function (extra) {
        isAdmin = !!(extra[0].data);
        seenAt = extra[1].data ? (Date.parse(extra[1].data.seen_at) || 0) : 0;
        // The Star Shop is optional: until its table exists, buying stays off.
        // If reloading purchases fails after they've loaded once, keep the ones we already know about
        // so bought items never disappear from the page.
        if (!extra[2].error) {
          shopReady = true;
          state.purchases = extra[2].data.map(function (r) {
            return { item: r.item, price: r.price, owner: r.user_id || me.id, paidBy: r.paid_by || null, at: Date.parse(r.created_at) || 0 };
          });
        } else if (!state.purchases.length) {
          shopReady = false;
        }
        giftingReady = !extra[2].error && !extra[2].usedFallback && !extra[3].error && !extra[3].usedFallback;
        // Gifted stars (like the early tester gift, or stars from friends), and stars you gave away.
        // Keep the last known totals if a reload fails.
        if (!extra[3].error) {
          var got = extra[3].data.filter(function (g) { return !g.user_id || g.user_id === me.id; });
          state.giftStars = got.reduce(function (sum, g) { return sum + (g.stars || 0); }, 0);
          state.giftsReceived = got.filter(function (g) { return g.from_user; }).map(function (g) {
            return { from: g.from_user, stars: g.stars, at: Date.parse(g.created_at) || 0 };
          });
          state.siteGifts = got.filter(function (g) { return !g.from_user && g.reason; }).map(function (g) {
            return { reason: g.reason, stars: g.stars, at: Date.parse(g.created_at) || 0 };
          });
          state.starsGiven = extra[3].data.filter(function (g) { return g.from_user === me.id && g.user_id !== me.id; })
            .reduce(function (sum, g) { return sum + (g.stars || 0); }, 0);
        }
        // Daily stars claimed (one per day) and saved research. Both stay hidden until their tables exist.
        claimsReady = !extra[4].error;
        if (!extra[4].error) state.claims = extra[4].data.map(function (r) { return r.day; });
        bookmarksReady = !extra[5].error;
        if (!extra[5].error) state.bookmarks = extra[5].data.map(function (r) { return r.project_id; });
        // Messages with friends, and team notes on research you work on.
        messagesReady = !extra[6].error;
        if (!extra[6].error) {
          state.messages = extra[6].data.map(function (m) {
            return { id: m.id, from: m.from_user, to: m.to_user, body: m.body || '', at: Date.parse(m.created_at) || 0, readAt: Date.parse(m.read_at) || 0 };
          });
        }
        // Reports: your own, or every report for the site owner.
        reportsReady = !extra[8].error;
        if (!extra[8].error) {
          state.reports = extra[8].data.map(function (r) {
            return { id: r.id, reporter: r.reporter, kind: r.kind, targetId: r.target_id, reason: r.reason || '', at: Date.parse(r.created_at) || 0 };
          });
        }
        notesReady = !extra[7].error;
        if (!extra[7].error) {
          state.notes = {};
          extra[7].data.forEach(function (n) {
            state.notes[n.project_id] = { body: n.body || '', by: n.updated_by, at: Date.parse(n.updated_at) || 0 };
          });
        }
        // People you've blocked.
        blocksReady = !extra[9].error;
        if (!extra[9].error) state.blocks = extra[9].data.map(function (b) { return b.blocked_user; });
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
    // Messages the database writes for people (like "Please keep it kind") are shown as they are.
    if (code === 'P0001' && msg) return msg;
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
  // Keep it kind: swear words and slurs are blocked everywhere; mean words also in comments, replies and
  // messages (`strict`). The database checks the same lists (is_unkind in supabase/more-features-2.sql).
  var SWEARS = /\b(fuck\w*|shit\w*|bitch\w*|bastard\w*|asshole\w*|dick|dickhead\w*|cunt\w*|slut\w*|whore\w*|nigg\w*|fag|fags|faggot\w*|retard\w*|tranny|kys|kill yourself)\b/i;
  var MEAN_WORDS = /\b(idiot\w*|stupid|dumb|dumbass|loser\w*|moron\w*|ugly|shut up|hate you)\b/i;
  var KIND_NOTE = 'Please keep it kind. Try saying that another way.';
  function unkind(text, strict) {
    return SWEARS.test(text || '') || (!!strict && MEAN_WORDS.test(text || ''));
  }
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
    } else if (kind === 8) { // Star Shop Halloween: a soft orange ring of smiling jack-o'-lanterns
      ring(M, '#F7B267', FRAME_WIDTH);
      around(8, M, 22.5, function (x, y) {
        add('circle', { cx: fx(x), cy: fx(y), r: 1.3, fill: '#8BBF4A' });
      });
      around(8, M, 0, function (x, y) {
        add('rect', { x: fx(x - 0.7), y: fx(y - 6.4), width: 1.4, height: 2.6, rx: 0.5, fill: '#6B8E3A' });
        add('ellipse', { cx: fx(x), cy: fx(y), rx: 4.8, ry: 4.2, fill: '#F28C28', stroke: '#C9661A', 'stroke-width': 0.7 });
        add('path', { d: 'M' + fx(x - 2.4) + ' ' + fx(y - 0.4) + ' l1 -1.6 l1 1.6 Z M' + fx(x + 0.4) + ' ' + fx(y - 0.4) + ' l1 -1.6 l1 1.6 Z', fill: '#5A2E0E' });
        add('path', { d: 'M' + fx(x - 2.2) + ' ' + fx(y + 1.2) + ' Q' + fx(x) + ' ' + fx(y + 3.2) + ' ' + fx(x + 2.2) + ' ' + fx(y + 1.2), fill: 'none', stroke: '#5A2E0E', 'stroke-width': 0.8, 'stroke-linecap': 'round' });
      });
    } else if (kind === 9) { // Star Shop Halloween: a purple night ring with little ghosts and stars
      ring(M, '#4A3560', FRAME_WIDTH);
      around(12, M, 15, function (x, y, deg, i) {
        if (i % 2) add('circle', { cx: fx(x), cy: fx(y), r: 0.9, fill: '#F7B267' });
        else add('polygon', { points: starPoints(x, y, 2.2), fill: '#F6E08E' });
      });
      around(6, M, 0, function (x, y) {
        add('path', { d: 'M' + fx(x - 3.8) + ' ' + fx(y + 4) + ' V' + fx(y - 0.8) + ' A3.8 3.8 0 0 1 ' + fx(x + 3.8) + ' ' + fx(y - 0.8) +
          ' V' + fx(y + 4) + ' L' + fx(x + 2.5) + ' ' + fx(y + 2.8) + ' L' + fx(x + 1.3) + ' ' + fx(y + 4) + ' L' + fx(x) + ' ' + fx(y + 2.8) +
          ' L' + fx(x - 1.3) + ' ' + fx(y + 4) + ' L' + fx(x - 2.5) + ' ' + fx(y + 2.8) + ' Z', fill: '#FFFDF7' });
        add('circle', { cx: fx(x - 1.3), cy: fx(y - 0.6), r: 0.6, fill: '#3A2A30' });
        add('circle', { cx: fx(x + 1.3), cy: fx(y - 0.6), r: 0.6, fill: '#3A2A30' });
        add('ellipse', { cx: fx(x), cy: fx(y + 1), rx: 0.7, ry: 0.9, fill: '#3A2A30' });
      });
    } else if (kind === 10) { // Star Shop Halloween: a cream ring of candy corns pointing outward
      ring(M, '#FFF1D6', FRAME_WIDTH);
      ring(59.3, '#F7B267', 1.2);
      around(10, M, 0, function (x, y, deg) {
        var t = 'translate(' + fx(x) + ' ' + fx(y) + ') rotate(' + deg + ')';
        add('polygon', { points: '-3.6,3.8 3.6,3.8 2.4,1 -2.4,1', fill: '#F6C945', transform: t });
        add('polygon', { points: '-2.4,1 2.4,1 1.2,-1.8 -1.2,-1.8', fill: '#F28C28', transform: t });
        add('polygon', { points: '-1.2,-1.8 1.2,-1.8 0,-4.4', fill: '#FFFDF7', stroke: '#F2D3AE', 'stroke-width': 0.4, transform: t });
      });
    } else if (kind === 11) { // Star Shop Halloween: a dusky spiderweb ring with two little spiders
      ring(M, '#3B2E5A', FRAME_WIDTH);
      [FRAME_INNER + 2, M, 58].forEach(function (r) { ring(r, '#CFC3E8', 0.5); });
      around(16, M, 0, function (x, y, deg) {
        var a = (deg - 90) * Math.PI / 180;
        add('path', { d: 'M' + fx(60 + Math.cos(a) * FRAME_INNER) + ' ' + fx(60 + Math.sin(a) * FRAME_INNER) + ' L' + fx(60 + Math.cos(a) * 60) + ' ' + fx(60 + Math.sin(a) * 60), stroke: '#CFC3E8', 'stroke-width': 0.5 });
      });
      [[40, 7], [220, 9]].forEach(function (sp) {
        var a = (sp[0] - 90) * Math.PI / 180, x = 60 + Math.cos(a) * M, y = 60 + Math.sin(a) * M;
        add('path', { d: 'M' + fx(x - 4) + ' ' + fx(y - 2) + ' L' + fx(x + 4) + ' ' + fx(y + 2) + ' M' + fx(x - 4) + ' ' + fx(y + 2) + ' L' + fx(x + 4) + ' ' + fx(y - 2) + ' M' + fx(x - 4.4) + ' ' + fx(y) + ' L' + fx(x + 4.4) + ' ' + fx(y), stroke: '#1E1A24', 'stroke-width': 0.8, 'stroke-linecap': 'round' });
        add('circle', { cx: fx(x), cy: fx(y), r: 2.6, fill: '#1E1A24' });
        add('circle', { cx: fx(x - 0.9), cy: fx(y - 0.5), r: 0.6, fill: '#FFFDF7' });
        add('circle', { cx: fx(x + 0.9), cy: fx(y - 0.5), r: 0.6, fill: '#FFFDF7' });
      });
    } else if (kind === 12) { // Star Shop Fall: a warm ring of red, orange and gold maple leaves
      ring(M, '#F7D6B0', FRAME_WIDTH);
      around(16, M, 11.25, function (x, y) { add('circle', { cx: fx(x), cy: fx(y), r: 0.9, fill: '#C9661A', opacity: 0.6 }); });
      var leafColors = ['#D9483B', '#F28C28', '#E8B22E', '#B5532A'];
      around(8, M, 0, function (x, y, deg, i) {
        var t = 'translate(' + fx(x) + ' ' + fx(y) + ') rotate(' + (deg + (i % 2 ? 20 : -20)) + ')';
        add('path', { d: MAPLE_LEAF, fill: leafColors[i % 4], transform: t });
        add('path', { d: 'M0 2 L0 6.2', stroke: shade(leafColors[i % 4], -0.3), 'stroke-width': 0.7, 'stroke-linecap': 'round', transform: t });
      });
    } else if (kind === 14 || kind === 15) {
      drawSeasonFrame(add, kind, ring, around);
    } else if (kind === 13) { // Star Shop Winter: an icy blue ring of snowflakes
      ring(M, '#D6EAF8', FRAME_WIDTH);
      ring(59.3, '#FFFFFF', 1.2);
      ring(FRAME_INNER + 0.7, '#FFFFFF', 1.2);
      around(10, M, 18, function (x, y) { add('circle', { cx: fx(x), cy: fx(y), r: 1.1, fill: '#FFFFFF' }); });
      around(10, M, 0, function (x, y, deg, i) {
        var t = 'translate(' + fx(x) + ' ' + fx(y) + ') rotate(' + deg + ') scale(' + (i % 2 ? 0.75 : 1) + ')';
        [0, 60, 120].forEach(function (r) {
          add('path', { d: 'M0 -4.6 L0 4.6 M-1.4 -3.4 L0 -2.3 L1.4 -3.4 M-1.4 3.4 L0 2.3 L1.4 3.4', fill: 'none', stroke: '#8EC5E8', 'stroke-width': 2.2, 'stroke-linecap': 'round', transform: t + ' rotate(' + r + ')' });
        });
        [0, 60, 120].forEach(function (r) {
          add('path', { d: 'M0 -4.6 L0 4.6 M-1.4 -3.4 L0 -2.3 L1.4 -3.4 M-1.4 3.4 L0 2.3 L1.4 3.4', fill: 'none', stroke: '#FFFFFF', 'stroke-width': 1, 'stroke-linecap': 'round', transform: t + ' rotate(' + r + ')' });
        });
      });
    }
  }
  // Star Shop Valentine's and spring frames, drawn on their own so drawFrame stays readable.
  function drawSeasonFrame(add, kind, ring, around) {
    var M = FRAME_MID;
    if (kind === 14) { // Valentine's: a pink ring of red and white hearts, with two little cupid arrows
      ring(M, '#FAD3DE', FRAME_WIDTH);
      around(10, M, 0, function (x, y, deg, i) {
        if (i === 2 || i === 7) return; // room for the arrows
        add('path', { d: HEART, fill: i % 2 ? '#FFFFFF' : '#E05A5A', transform: 'translate(' + fx(x) + ' ' + fx(y) + ') rotate(' + deg + ') scale(' + (i % 2 ? 3.4 : 4.4) + ')' });
      });
      [72, 252].forEach(function (deg) {
        var a = (deg - 90) * Math.PI / 180, x = 60 + Math.cos(a) * M, y = 60 + Math.sin(a) * M;
        var t = 'translate(' + fx(x) + ' ' + fx(y) + ') rotate(' + (deg + 45) + ')';
        add('path', { d: 'M-6 0 L5 0', stroke: '#C9A27A', 'stroke-width': 1.1, 'stroke-linecap': 'round', transform: t });
        add('path', { d: 'M6.5 0 L3.6 -2 L3.6 2 Z', fill: '#E05A5A', transform: t });
        add('path', { d: 'M-6 0 L-7.8 -2 M-6 0 L-7.8 2 M-4.6 0 L-6.4 -2 M-4.6 0 L-6.4 2', stroke: '#F7A8C0', 'stroke-width': 0.9, 'stroke-linecap': 'round', transform: t });
      });
    } else if (kind === 15) { // Spring: a soft green ring with fluttering butterflies
      ring(M, '#DDF2D6', FRAME_WIDTH);
      around(12, M, 15, function (x, y) { add('circle', { cx: fx(x), cy: fx(y), r: 1, fill: '#F7A8C0' }); });
      var wings = [['#F7A8C0', '#FBD3DF'], ['#B9A6E8', '#DCD2F6'], ['#F4D35E', '#FBE9A8'], ['#8EC5E8', '#CDE6F6']];
      around(6, M, 0, function (x, y, deg, i) {
        var t = 'translate(' + fx(x) + ' ' + fx(y) + ') rotate(' + (deg + (i % 2 ? 15 : -15)) + ')';
        var w = wings[i % 4];
        add('ellipse', { cx: -2.6, cy: -1.6, rx: 2.8, ry: 2.2, fill: w[0], transform: t });
        add('ellipse', { cx: 2.6, cy: -1.6, rx: 2.8, ry: 2.2, fill: w[0], transform: t });
        add('ellipse', { cx: -2, cy: 1.8, rx: 2, ry: 1.6, fill: w[1], transform: t });
        add('ellipse', { cx: 2, cy: 1.8, rx: 2, ry: 1.6, fill: w[1], transform: t });
        add('path', { d: 'M0 -3 L0 3.4 M0 -3 L-1.2 -5 M0 -3 L1.2 -5', stroke: '#5A4048', 'stroke-width': 0.8, 'stroke-linecap': 'round', fill: 'none', transform: t });
      });
    }
  }
  // A maple leaf about 11 across, pointing up, centered on (0, 0).
  var MAPLE_LEAF = 'M0 -5.6 L1.3 -2.7 L3.7 -3.8 L2.9 -0.9 L5.4 0 L2.5 1.5 L3.1 3.3 L0.7 2.5 L0 2.4 L-0.7 2.5 L-3.1 3.3 L-2.5 1.5 L-5.4 0 L-2.9 -0.9 L-3.7 -3.8 L-1.3 -2.7 Z';

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
    if (kind === 6) { // Star Shop Halloween: vampire cape with a tall collar lined in the clothing color
      add('path', { d: 'M40 92 L30 70 L48 82 Z', fill: color, stroke: '#1E1824', 'stroke-width': 1.2, 'stroke-linejoin': 'round' });
      add('path', { d: 'M80 92 L90 70 L72 82 Z', fill: color, stroke: '#1E1824', 'stroke-width': 1.2, 'stroke-linejoin': 'round' });
      add('path', { d: SHOULDERS, fill: '#2B2233' });
      neck();
      add('path', { d: 'M51 87 L60 102 L69 87 Q60 92 51 87 Z', fill: '#FFFDF7' });
      add('path', { d: 'M51 87 L45 120 M69 87 L75 120', fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' });
      add('circle', { cx: 60, cy: 95, r: 2.2, fill: '#E05A5A' });
      return;
    }
    if (kind === 7) { // Star Shop Fall: a plaid flannel shirt in the clothing color
      add('path', { d: SHOULDERS, fill: color });
      // Plaid: wide dark stripes, then thin light ones, kept inside the shoulders.
      [[30, 92.6], [45, 87.6], [75, 87.6], [90, 92.6]].forEach(function (v) {
        add('path', { d: 'M' + v[0] + ' ' + v[1] + ' L' + v[0] + ' 120', stroke: dark, 'stroke-width': 4.5, opacity: 0.45 });
        add('path', { d: 'M' + (v[0] + 3.5) + ' ' + (v[1] + 0.5) + ' L' + (v[0] + 3.5) + ' 120', stroke: light, 'stroke-width': 0.9, opacity: 0.7 });
      });
      [[101, 21.8, 98.2], [113, 19.4, 100.6]].forEach(function (h) {
        add('path', { d: 'M' + h[1] + ' ' + h[0] + ' L' + h[2] + ' ' + h[0], stroke: dark, 'stroke-width': 4.5, opacity: 0.45 });
        add('path', { d: 'M' + h[1] + ' ' + (h[0] + 3.5) + ' L' + h[2] + ' ' + (h[0] + 3.5), stroke: light, 'stroke-width': 0.9, opacity: 0.7 });
      });
      neck();
      add('path', { d: 'M60 95 L60 120', stroke: shade(color, -0.4), 'stroke-width': 1.2, opacity: 0.7 });
      add('path', { d: 'M50 85 L60 95 L52 99 Z', fill: shade(color, -0.12), stroke: shade(color, -0.4), 'stroke-width': 1, 'stroke-linejoin': 'round' });
      add('path', { d: 'M70 85 L60 95 L68 99 Z', fill: shade(color, -0.12), stroke: shade(color, -0.4), 'stroke-width': 1, 'stroke-linejoin': 'round' });
      [103, 111].forEach(function (y) { add('circle', { cx: 60, cy: y, r: 1.5, fill: '#FBF7F2' }); });
      return;
    }
    if (kind === 9) { // Star Shop Valentine's: a crew-neck sweater with a big heart on the front
      add('path', { d: SHOULDERS, fill: color });
      neck();
      add('path', { d: 'M49 87 Q60 97 71 87', fill: 'none', stroke: dark, 'stroke-width': 4.5, 'stroke-linecap': 'round' });
      var heartFill = color.toUpperCase() === '#E05A5A' ? '#FFFDF7' : '#E05A5A';
      add('path', { d: HEART, fill: heartFill, stroke: shade(heartFill, -0.2), 'stroke-width': 0.08, transform: 'translate(60 107) scale(8)' });
      add('path', { d: 'M54.5 103.5 Q56 101.8 58 102.2', fill: 'none', stroke: '#FFFFFF', 'stroke-width': 1.2, 'stroke-linecap': 'round', opacity: 0.6 });
      return;
    }
    if (kind === 10) { // Star Shop spring: a sunny yellow raincoat, open over a top in the clothing color
      var coat = '#F4D35E', coatDark = '#D9B33A';
      add('path', { d: 'M37 92 Q40 79 60 79 Q80 79 83 92 Q71 86 60 86 Q49 86 37 92 Z', fill: coatDark });
      add('path', { d: SHOULDERS, fill: coat });
      neck();
      add('path', { d: 'M50 87 Q60 95 70 87 L65 120 L55 120 Z', fill: color });
      add('path', { d: 'M50 87 L55 120 M70 87 L65 120', stroke: coatDark, 'stroke-width': 2, 'stroke-linecap': 'round' });
      add('path', { d: 'M49 86 L44 96 L52 100 Z M71 86 L76 96 L68 100 Z', fill: coatDark });
      [[50.5, 106], [51.5, 114], [69.5, 106], [68.5, 114]].forEach(function (b) {
        add('rect', { x: b[0] - 2.2, y: b[1] - 0.9, width: 4.4, height: 1.8, rx: 0.9, fill: '#8A5A3C' });
      });
      add('path', { d: 'M28 112 L36 112 M84 112 L92 112', stroke: coatDark, 'stroke-width': 1.4, 'stroke-linecap': 'round' });
      return;
    }
    if (kind === 8) { // Star Shop Winter: a tee in the clothing color with a red and white striped knit scarf
      add('path', { d: SHOULDERS, fill: color });
      neck();
      var red = '#E05A5A', cream = '#FFF6EE';
      add('path', { d: 'M62 92 L67 113 L59.5 114.5 L56.5 94 Z', fill: red });
      [[97.5, 98.5], [103, 104], [108.5, 109.5]].forEach(function (s) {
        add('path', { d: 'M57.2 ' + s[0] + ' L63.4 ' + (s[0] - 1.2), stroke: cream, 'stroke-width': 2.2 });
      });
      add('path', { d: 'M59.6 114.5 L59 118 M62 114 L61.8 117.6 M64.4 113.6 L64.8 117 M66.6 113.2 L67.6 116.4', stroke: red, 'stroke-width': 1.2, 'stroke-linecap': 'round' });
      add('path', { d: 'M46 83 Q60 92 74 83 L76 90 Q60 101 44 90 Z', fill: red, stroke: shade(red, -0.2), 'stroke-width': 0.8, 'stroke-linejoin': 'round' });
      add('path', { d: 'M45 86.8 Q60 97 75 86.8', fill: 'none', stroke: cream, 'stroke-width': 2.2 });
      add('path', { d: 'M50 88 L50.8 91.6 M55 90 L55.6 93.8 M60 91 L60 94.8 M65 90 L64.4 93.8 M70 88 L69.2 91.6', stroke: shade(red, -0.2), 'stroke-width': 0.6, opacity: 0.6 });
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
      // Bangs reach a little further out to the sides, so they blend into the hair at the temples.
      var wide = 'translate(60 0) scale(1.14 1) translate(-60 0)';
      var bangAttrs = function (a) {
        a.transform = wide + (a.transform ? ' ' + a.transform : '');
        return a;
      };
      bang[0].forEach(function (d) { add('path', bangAttrs({ d: d, fill: hair })); });
      bang[1].forEach(function (d) {
        add('path', bangAttrs({ d: d, fill: 'none', stroke: hairDark, 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.8 }));
      });
      if (c.bangs === 10) { // a hair clip, in the clothing color
        add('rect', bangAttrs({ x: 42, y: 42, width: 10, height: 3.2, rx: 1.6, fill: top, stroke: shade(top, -0.3), 'stroke-width': 0.8, transform: 'rotate(-22 47 43.6)' }));
      }
    }
    // Face
    add('circle', { cx: 47, cy: 66, r: 4, fill: '#F29BB2', opacity: 0.45 });
    add('circle', { cx: 73, cy: 66, r: 4, fill: '#F29BB2', opacity: 0.45 });
    // Faces: 0 Smile, 1 Grin, 2 Cool, 3 Wink, 4 Happy, 5 Laugh, 6 Surprised, 7 Tongue, 8 Sleepy, 9 Starry, 10 Smirk, 11 Vampire, 12 (removed), 13 Witch.
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
    if (f === 11) { // Star Shop Halloween: Vampire, a wide smile with two big fangs hanging from it
      add('path', { d: 'M52.4 68.8 L57.6 70.3 L55.4 75 Z M67.6 68.8 L62.4 70.3 L64.6 75 Z', fill: '#FFFFFF', stroke: ink, 'stroke-width': 1, 'stroke-linejoin': 'round' });
      add('path', line('M49.5 66.5 Q60 75.5 70.5 66.5'));
    }
    if (f === 13) { // Star Shop Halloween: Witch, mischievous brows, green cheeks, a cackling grin and a beauty mark
      add('circle', { cx: 47, cy: 66, r: 4.2, fill: '#9BD3AE', opacity: 0.8 });
      add('circle', { cx: 73, cy: 66, r: 4.2, fill: '#9BD3AE', opacity: 0.8 });
      add('path', { d: 'M45.5 51.5 L55.5 54.5 M74.5 51.5 L64.5 54.5', fill: 'none', stroke: ink, 'stroke-width': 1.9, 'stroke-linecap': 'round' });
      add('path', { d: 'M50 65.5 Q60 77 70 65.5 Z', fill: mouthRed, stroke: ink, 'stroke-width': 2, 'stroke-linejoin': 'round' });
      add('rect', { x: 57.2, y: 65.6, width: 3.4, height: 2.8, rx: 0.6, fill: '#FFFFFF' });
      add('circle', { cx: 71.5, cy: 71, r: 1, fill: ink });
    }
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
    // Headbands follow the top of the head so they sit right on it: the hair cap (radius 26 around 60,57)
    // for most styles, or the smaller shaved cap (around 60,53) for Buzz and Mohawk.
    var shavedHead = style === 10 || style === 11;
    var crown = shavedHead ? { cx: 60, cy: 53, r: 23.4 } : { cx: 60, cy: 57, r: 25.5 };
    // The arc of the crown (pushed out by `extra`) between the two points at height y.
    function crownArc(y, extra) {
      var r = crown.r + (extra || 0), dy = y - crown.cy, dx = Math.sqrt(r * r - dy * dy);
      return 'M' + fx(crown.cx - dx) + ' ' + y + ' A' + r + ' ' + r + ' 0 ' + (y > crown.cy ? 1 : 0) + ' 1 ' + fx(crown.cx + dx) + ' ' + y;
    }
    // A point on the crown, `deg` degrees from the very top (negative is to the left).
    function crownPoint(deg) {
      var a = deg * Math.PI / 180;
      return { x: crown.cx + Math.sin(a) * crown.r, y: crown.cy - Math.cos(a) * crown.r };
    }
    // Decorations drawn for a band peaking at y 28 move down to the real top of the head.
    var lift = 'translate(0 ' + fx(crown.cy - crown.r - 28) + ')';
    if (c.headwear === 3) {
      add('path', { d: crownArc(60, 1), fill: 'none', stroke: ink, 'stroke-width': 5, 'stroke-linecap': 'round' });
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
      add('path', { d: crownArc(48), fill: 'none', stroke: top, 'stroke-width': 5, 'stroke-linecap': 'round' });
      var s1 = crownPoint(-52), s2 = crownPoint(-16);
      add('path', { d: 'M' + fx(s1.x) + ' ' + fx(s1.y) + ' A' + crown.r + ' ' + crown.r + ' 0 0 1 ' + fx(s2.x) + ' ' + fx(s2.y), fill: 'none', stroke: shade(top, 0.45), 'stroke-width': 1.5, 'stroke-linecap': 'round' });
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
    // Star Shop Halloween headwear: 11 Witch hat, 12 Pumpkin hat, 13 Bat headband.
    if (c.headwear === 11) { // A bent witch hat with an orange band and a gold buckle
      add('ellipse', { cx: 60, cy: 34, rx: 31, ry: 6.5, fill: '#2E2440' });
      add('path', { d: 'M43 33 Q52 18 58 9 Q61 3 69 1 Q64 8 66 16 Q70 26 77 33 Z', fill: '#463461' });
      add('path', { d: 'M44.5 30.5 Q60 26 75.5 30.5 L77 33 Q60 28.5 43 33 Z', fill: '#F28C28' });
      add('rect', { x: 56.2, y: 27.6, width: 7.6, height: 4.6, rx: 1, fill: 'none', stroke: '#F6C945', 'stroke-width': 1.4 });
      add('circle', { cx: 63, cy: 14, r: 1.2, fill: '#B9A6E8' });
      add('circle', { cx: 57, cy: 21, r: 0.9, fill: '#B9A6E8' });
    }
    if (c.headwear === 12) { // A little smiling pumpkin sitting on top of the head (drawn small, then scaled up from its base)
      var pk = 'translate(60 34) scale(1.4) translate(-60 -34)';
      add('ellipse', { cx: 52.5, cy: 27, rx: 6.5, ry: 7, fill: '#E07A1F', transform: pk });
      add('ellipse', { cx: 67.5, cy: 27, rx: 6.5, ry: 7, fill: '#E07A1F', transform: pk });
      add('ellipse', { cx: 60, cy: 26.5, rx: 8.5, ry: 8, fill: '#F28C28', transform: pk });
      add('path', { d: 'M55 20 Q53.5 26.5 55 33 M65 20 Q66.5 26.5 65 33', fill: 'none', stroke: '#C9661A', 'stroke-width': 1, 'stroke-linecap': 'round', transform: pk });
      add('rect', { x: 58.6, y: 15, width: 2.8, height: 5, rx: 1, fill: '#6B8E3A', transform: pk });
      add('ellipse', { cx: 64.5, cy: 17, rx: 3.6, ry: 1.8, fill: '#8BBF4A', transform: pk + ' rotate(-25 64.5 17)' });
      add('path', { d: 'M55.6 25.6 L57.2 22.8 L58.8 25.6 Z M61.2 25.6 L62.8 22.8 L64.4 25.6 Z', fill: '#5A2E0E', transform: pk });
      add('path', { d: 'M55.5 28.4 Q60 31.6 64.5 28.4', fill: 'none', stroke: '#5A2E0E', 'stroke-width': 1.3, 'stroke-linecap': 'round', transform: pk });
    }
    if (c.headwear === 13) { // A headband with two little bat wings
      add('path', { d: crownArc(46), fill: 'none', stroke: '#2E2440', 'stroke-width': 3.4, 'stroke-linecap': 'round' });
      add('path', { d: 'M51 31 Q45 21 35 23 Q38.5 26.5 37.5 30 Q41 28.8 43 32.5 Q46.5 29.8 51 31 Z', fill: '#3A2E4F', transform: lift });
      add('path', { d: 'M69 31 Q75 21 85 23 Q81.5 26.5 82.5 30 Q79 28.8 77 32.5 Q73.5 29.8 69 31 Z', fill: '#3A2E4F', transform: lift });
      add('circle', { cx: 60, cy: 28, r: 2.6, fill: '#3A2E4F', transform: lift });
      add('circle', { cx: 59, cy: 27.6, r: 0.6, fill: '#F6C945', transform: lift });
      add('circle', { cx: 61, cy: 27.6, r: 0.6, fill: '#F6C945', transform: lift });
    }
    // More Halloween headwear: 14 Devil horns, 15 Candy corn crown.
    if (c.headwear === 14) { // Two little curved red horns on a headband, each standing on the band
      add('path', { d: crownArc(46), fill: 'none', stroke: '#B83B3B', 'stroke-width': 3.2, 'stroke-linecap': 'round' });
      var hl = crownPoint(-30), hr = crownPoint(30);
      var leftHorn = 'translate(' + fx(hl.x - 47.5) + ' ' + fx(hl.y - 31.8) + ')';
      var rightHorn = 'translate(' + fx(hr.x - 72.5) + ' ' + fx(hr.y - 31.8) + ')';
      add('path', { d: 'M44 33 Q39 25 43 17 Q46.5 26 51 30.5 Z', fill: '#E05A5A', stroke: '#B83B3B', 'stroke-width': 0.9, 'stroke-linejoin': 'round', transform: leftHorn });
      add('path', { d: 'M76 33 Q81 25 77 17 Q73.5 26 69 30.5 Z', fill: '#E05A5A', stroke: '#B83B3B', 'stroke-width': 0.9, 'stroke-linejoin': 'round', transform: rightHorn });
      add('path', { d: 'M44.5 27 Q43.5 23.5 44 21', fill: 'none', stroke: '#F7A8A8', 'stroke-width': 1, 'stroke-linecap': 'round', transform: leftHorn });
    }
    if (c.headwear === 15) { // A band of five candy corns, each standing on the band
      add('path', { d: crownArc(46), fill: 'none', stroke: '#F28C28', 'stroke-width': 2.6, 'stroke-linecap': 'round' });
      [-38, -17, 0, 17, 38].map(function (deg) {
        var pt = crownPoint(deg);
        return [Number(fx(pt.x)), Number(fx(pt.y)), deg];
      }).forEach(function (cc) {
        var t = 'rotate(' + cc[2] + ' ' + cc[0] + ' ' + cc[1] + ')';
        var x = cc[0], y = cc[1];
        add('polygon', { points: (x - 3.6) + ',' + y + ' ' + (x + 3.6) + ',' + y + ' ' + (x + 2.4) + ',' + (y - 2.8) + ' ' + (x - 2.4) + ',' + (y - 2.8), fill: '#F6C945', transform: t });
        add('polygon', { points: (x - 2.4) + ',' + (y - 2.8) + ' ' + (x + 2.4) + ',' + (y - 2.8) + ' ' + (x + 1.2) + ',' + (y - 5.6) + ' ' + (x - 1.2) + ',' + (y - 5.6), fill: '#F28C28', transform: t });
        add('polygon', { points: (x - 1.2) + ',' + (y - 5.6) + ' ' + (x + 1.2) + ',' + (y - 5.6) + ' ' + x + ',' + (y - 8.2), fill: '#FFFDF7', transform: t });
      });
    }
    // Star Shop Fall and Winter headwear: 16 Leaf crown, 17 Earmuffs, 18 Santa hat.
    if (c.headwear === 16) { // Autumn leaves standing on a thin twig band, with a little acorn at the top
      add('path', { d: crownArc(46), fill: 'none', stroke: '#8A5A3C', 'stroke-width': 2.2, 'stroke-linecap': 'round' });
      var fall = ['#D9483B', '#F28C28', '#E8B22E', '#B5532A', '#E8B22E', '#F28C28', '#D9483B'];
      [-50, -30, -12, 12, 30, 50].forEach(function (deg, i) {
        var pt = crownPoint(deg);
        var t = 'translate(' + fx(pt.x) + ' ' + fx(pt.y - 3.4) + ') rotate(' + (deg * 1.1) + ') scale(1.3)';
        add('path', { d: MAPLE_LEAF, fill: fall[i], stroke: shade(fall[i], -0.25), 'stroke-width': 0.5, transform: t });
        add('path', { d: 'M0 2 L0 4.6', stroke: shade(fall[i], -0.35), 'stroke-width': 0.7, transform: t });
      });
      var acorn = crownPoint(0);
      add('ellipse', { cx: 60, cy: fx(acorn.y - 3), rx: 3.3, ry: 3.9, fill: '#C98E5A' });
      add('path', { d: 'M56.2 ' + fx(acorn.y - 4.6) + ' Q60 ' + fx(acorn.y - 9.4) + ' 63.8 ' + fx(acorn.y - 4.6) + ' Z', fill: '#7A4E2E' });
      add('path', { d: 'M60 ' + fx(acorn.y - 7.6) + ' L60.8 ' + fx(acorn.y - 9.6), stroke: '#7A4E2E', 'stroke-width': 1, 'stroke-linecap': 'round' });
    }
    if (c.headwear === 17) { // Fluffy white earmuffs on a band in the clothing color
      add('path', { d: crownArc(58, 1.2), fill: 'none', stroke: top, 'stroke-width': 3.6, 'stroke-linecap': 'round' });
      add('path', { d: crownArc(58, 1.2), fill: 'none', stroke: 'rgba(0,0,0,0.12)', 'stroke-width': 1, 'stroke-linecap': 'round' });
      [33, 87].forEach(function (x) {
        [[0, -4.2], [3.8, -1.4], [2.4, 3.6], [-2.4, 3.6], [-3.8, -1.4]].forEach(function (o) {
          add('circle', { cx: x + o[0], cy: 60 + o[1], r: 4, fill: '#FFFDF7', stroke: '#E9DDE2', 'stroke-width': 0.7 });
        });
        add('circle', { cx: x, cy: 60, r: 4.6, fill: '#FFFDF7' });
        add('circle', { cx: x - 1.4, cy: 58.4, r: 1.3, fill: '#FFFFFF' });
      });
    }
    if (c.headwear === 18) { // A floppy red Santa hat with a white trim and pom-pom
      add('path', { d: 'M35 45 Q36 22 58 16 Q77 11 91 27 Q94 33 93 37 Q87 31 81 32 Q85 38 85 45 Z', fill: '#E05A5A' });
      add('path', { d: 'M58 18 Q74 14 87 26', fill: 'none', stroke: '#F58A8A', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.8 });
      add('path', { d: 'M34 45.5 Q60 36 86 45.5', fill: 'none', stroke: '#FFFDF7', 'stroke-width': 8, 'stroke-linecap': 'round' });
      [40, 48, 56, 64, 72, 80].forEach(function (x, i) {
        add('circle', { cx: x, cy: i === 0 || i === 5 ? 44 : 41.6, r: 1, fill: '#EDE3E6' });
      });
      add('circle', { cx: 93, cy: 38, r: 5.2, fill: '#FFFDF7', stroke: '#EDE3E6', 'stroke-width': 0.8 });
    }
    // Star Shop Valentine's and spring headwear: 19 Heart headband, 20 Bunny ears, 21 Sun hat.
    if (c.headwear === 19) { // A pink band with two bouncy hearts on springs
      add('path', { d: crownArc(46), fill: 'none', stroke: '#E26D8E', 'stroke-width': 3, 'stroke-linecap': 'round' });
      [-24, 24].forEach(function (deg) {
        var base = crownPoint(deg), lean = deg < 0 ? -4 : 4;
        var tipX = base.x + lean, tipY = base.y - 14;
        add('path', { d: 'M' + fx(base.x) + ' ' + fx(base.y) + ' Q' + fx(base.x + lean * 1.6) + ' ' + fx(base.y - 6) + ' ' + fx(tipX) + ' ' + fx(tipY + 4),
          fill: 'none', stroke: '#3A2A30', 'stroke-width': 1, 'stroke-linecap': 'round' });
        add('path', { d: HEART, fill: '#E05A5A', stroke: '#B83B3B', 'stroke-width': 0.12, transform: 'translate(' + fx(tipX) + ' ' + fx(tipY) + ') scale(5.2)' });
        add('circle', { cx: fx(tipX - 1.8), cy: fx(tipY - 2), r: 0.9, fill: '#FFFFFF', opacity: 0.7 });
      });
    }
    if (c.headwear === 20) { // Fluffy white bunny ears with pink insides, on a white band
      [[-20, -12], [20, 12]].forEach(function (e) {
        var base = crownPoint(e[0]);
        var t = 'rotate(' + e[1] + ' ' + fx(base.x) + ' ' + fx(base.y) + ')';
        add('ellipse', { cx: fx(base.x), cy: fx(base.y - 12), rx: 5.2, ry: 13.5, fill: '#FFFDF7', stroke: '#E9DDE2', 'stroke-width': 0.8, transform: t });
        add('ellipse', { cx: fx(base.x), cy: fx(base.y - 11), rx: 2.6, ry: 10, fill: '#F7A8C0', transform: t });
      });
      add('path', { d: crownArc(46), fill: 'none', stroke: '#FFFDF7', 'stroke-width': 3.2, 'stroke-linecap': 'round' });
      add('path', { d: crownArc(46), fill: 'none', stroke: '#E9DDE2', 'stroke-width': 0.6, 'stroke-linecap': 'round' });
    }
    if (c.headwear === 21) { // A wide straw sun hat with a ribbon in the clothing color and a little flower
      add('ellipse', { cx: 60, cy: 40, rx: 39, ry: 8.5, fill: '#E9C27F' });
      add('ellipse', { cx: 60, cy: 39, rx: 37, ry: 7, fill: '#F2D49B' });
      add('path', { d: 'M41 39 Q42 19 60 19 Q78 19 79 39 Z', fill: '#F2D49B' });
      add('path', { d: 'M46 27 Q60 24 74 27 M44 33 Q60 30 76 33', fill: 'none', stroke: '#E0BB78', 'stroke-width': 0.9, opacity: 0.8 });
      add('path', { d: 'M41.6 34 Q60 30 78.4 34 L78.8 38.6 Q60 35 41.2 38.6 Z', fill: top });
      for (var fp = 0; fp < 5; fp++) {
        var fa = Math.PI * 2 / 5 * fp;
        add('circle', { cx: fx(72 + Math.cos(fa) * 2.4), cy: fx(35 + Math.sin(fa) * 2.4), r: 2.1, fill: '#FFFDF7' });
      }
      add('circle', { cx: 72, cy: 35, r: 1.5, fill: '#F4D35E' });
    }
    return svg;
  }
  // The pet is its own little picture, shown only in the portfolio scene beside the character (not in the character itself).
  function renderPet(c) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-18 -27 36 43');
    svg.setAttribute('class', 'portfolio-pet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Pet ' + CHAR.pet[c.pet].toLowerCase());
    drawPet(function (tag, attrs) {
      var n = document.createElementNS(SVG_NS, tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
    }, c.pet, CHAR.petColor[c.petColor]);
    return svg;
  }

  // Pets, drawn around (0, 0) and about 30 wide, feet on y = 14.
  // Kinds: 1 Cat, 2 Dog, 3 Bunny, 4 Hamster, 5 Bird, 6 Fish (in a bowl).
  function drawPet(add, kind, color) {
    var line = shade(color, -0.4);
    var light = shade(color, 0.5);
    var n = parseInt(color.slice(1), 16);
    var dark = ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) < 90;
    var ink = dark ? '#FFF6F0' : '#3A2A30';
    var pink = '#F29BB2';
    function body(attrs) {
      attrs.fill = attrs.fill || color;
      attrs.stroke = line;
      attrs['stroke-width'] = 1.2;
      add(attrs.d ? 'path' : attrs.rx ? 'ellipse' : 'circle', attrs);
    }
    function eyes(y, gap) {
      add('circle', { cx: -gap, cy: y, r: 1.4, fill: ink });
      add('circle', { cx: gap, cy: y, r: 1.4, fill: ink });
    }
    function cheeks(y) {
      add('circle', { cx: -5.5, cy: y, r: 1.6, fill: pink, opacity: 0.6 });
      add('circle', { cx: 5.5, cy: y, r: 1.6, fill: pink, opacity: 0.6 });
    }
    if (kind === 1) { // Cat
      add('path', { d: 'M9 10 Q19 8 16 -2', fill: 'none', stroke: line, 'stroke-width': 4.6, 'stroke-linecap': 'round' });
      add('path', { d: 'M9 10 Q19 8 16 -2', fill: 'none', stroke: color, 'stroke-width': 2.8, 'stroke-linecap': 'round' });
      body({ cx: 0, cy: 7, rx: 10.5, ry: 8 });
      body({ d: 'M-8.5 -8 L-7 -18 L-1.5 -13 Z' });
      body({ d: 'M8.5 -8 L7 -18 L1.5 -13 Z' });
      body({ cx: 0, cy: -5, r: 9 });
      add('path', { d: 'M-7 -11 L-6.3 -15.5 L-3.6 -13 Z', fill: pink, opacity: 0.8 });
      add('path', { d: 'M7 -11 L6.3 -15.5 L3.6 -13 Z', fill: pink, opacity: 0.8 });
      eyes(-6, 3.6);
      add('path', { d: 'M-1.2 -2.6 L1.2 -2.6 L0 -1.2 Z', fill: pink });
      add('path', { d: 'M-2 -0.6 Q-1 0.4 0 -0.6 Q1 0.4 2 -0.6', fill: 'none', stroke: ink, 'stroke-width': 0.8, 'stroke-linecap': 'round' });
      add('path', { d: 'M-4 -2.5 L-10 -3.5 M-4 -1.2 L-10 -0.6 M4 -2.5 L10 -3.5 M4 -1.2 L10 -0.6', stroke: ink, 'stroke-width': 0.6, opacity: 0.6 });
    } else if (kind === 2) { // Dog
      add('path', { d: 'M9 6 Q17 3 15 -4', fill: 'none', stroke: line, 'stroke-width': 4.4, 'stroke-linecap': 'round' });
      add('path', { d: 'M9 6 Q17 3 15 -4', fill: 'none', stroke: color, 'stroke-width': 2.6, 'stroke-linecap': 'round' });
      body({ cx: 0, cy: 7, rx: 10.5, ry: 8 });
      body({ cx: 0, cy: -5, r: 9 });
      body({ cx: -8.2, cy: -5, rx: 3.2, ry: 6.5, fill: shade(color, -0.22), transform: 'rotate(18 -8.2 -5)' });
      body({ cx: 8.2, cy: -5, rx: 3.2, ry: 6.5, fill: shade(color, -0.22), transform: 'rotate(-18 8.2 -5)' });
      add('ellipse', { cx: 0, cy: -1.8, rx: 4.6, ry: 3.6, fill: light });
      add('ellipse', { cx: 0, cy: -3.4, rx: 1.7, ry: 1.2, fill: dark ? '#FFF6F0' : '#3A2A30' });
      eyes(-7, 3.4);
      add('path', { d: 'M-1.2 0 Q0 3.2 1.2 0 Z', fill: '#E26D8E' });
    } else if (kind === 3) { // Bunny
      body({ cx: -3.6, cy: -17, rx: 2.8, ry: 8, transform: 'rotate(-8 -3.6 -17)' });
      body({ cx: 3.6, cy: -17, rx: 2.8, ry: 8, transform: 'rotate(8 3.6 -17)' });
      add('ellipse', { cx: -3.6, cy: -17, rx: 1.2, ry: 5.5, fill: pink, opacity: 0.75, transform: 'rotate(-8 -3.6 -17)' });
      add('ellipse', { cx: 3.6, cy: -17, rx: 1.2, ry: 5.5, fill: pink, opacity: 0.75, transform: 'rotate(8 3.6 -17)' });
      body({ cx: 10, cy: 10, r: 3.2, fill: light });
      body({ cx: 0, cy: 7, rx: 10, ry: 8 });
      body({ cx: 0, cy: -5, r: 8.5 });
      eyes(-6, 3.4);
      cheeks(-2.5);
      add('path', { d: 'M-1 -3.2 L1 -3.2 L0 -2 Z', fill: pink });
      add('path', { d: 'M0 -2 L0 -0.8 M-1.4 -0.4 Q0 0.6 1.4 -0.4', fill: 'none', stroke: ink, 'stroke-width': 0.7, 'stroke-linecap': 'round' });
    } else if (kind === 4) { // Hamster: one round ball with tiny ears
      body({ cx: -7, cy: -8, r: 3.2 });
      body({ cx: 7, cy: -8, r: 3.2 });
      add('circle', { cx: -7, cy: -8, r: 1.5, fill: pink, opacity: 0.8 });
      add('circle', { cx: 7, cy: -8, r: 1.5, fill: pink, opacity: 0.8 });
      body({ cx: 0, cy: 2, rx: 12, ry: 11.5 });
      add('ellipse', { cx: 0, cy: 7, rx: 7.5, ry: 5.5, fill: light });
      eyes(-1.5, 4.2);
      cheeks(2);
      add('circle', { cx: 0, cy: 1, r: 0.9, fill: pink });
      add('path', { d: 'M-4 13 L-4 14.5 M4 13 L4 14.5', stroke: line, 'stroke-width': 1.6, 'stroke-linecap': 'round' });
    } else if (kind === 5) { // Bird
      add('path', { d: 'M-2 11 L-2 14.5 M3 11 L3 14.5', stroke: '#E0A82E', 'stroke-width': 1.4, 'stroke-linecap': 'round' });
      add('path', { d: 'M8 4 L15 1 L13 7 Z', fill: shade(color, -0.2), stroke: line, 'stroke-width': 1 });
      body({ cx: 0, cy: 2, rx: 10, ry: 9.5 });
      add('path', { d: 'M-1 -8 Q1 -13 4 -10 Q2 -9 1 -7.5', fill: color, stroke: line, 'stroke-width': 1 });
      body({ cx: 3, cy: 4.5, rx: 6, ry: 4.2, fill: shade(color, -0.18), transform: 'rotate(-20 3 4.5)' });
      add('path', { d: 'M-9.5 0 L-14.5 2 L-9.5 3.6 Z', fill: '#F2A541', stroke: '#C77F1E', 'stroke-width': 0.6 });
      add('circle', { cx: -4.5, cy: -1.5, r: 1.4, fill: ink });
      add('circle', { cx: -4, cy: 2.5, r: 1.5, fill: pink, opacity: 0.6 });
    } else if (kind === 7) { // Star Shop Halloween: a little purple bat with tiny fangs
      add('path', { d: 'M-6 -1 Q-12 -9 -17 -4 Q-14 -2 -14.5 2 Q-12 0 -10 4 Q-8.5 1 -5.5 3 Z', fill: '#3A2E4F' });
      add('path', { d: 'M6 -1 Q12 -9 17 -4 Q14 -2 14.5 2 Q12 0 10 4 Q8.5 1 5.5 3 Z', fill: '#3A2E4F' });
      add('path', { d: 'M-5 -5 L-6 -12 L-1.5 -7.5 Z M5 -5 L6 -12 L1.5 -7.5 Z', fill: '#4A3A63' });
      add('circle', { cx: 0, cy: 0, r: 8, fill: '#4A3A63' });
      add('circle', { cx: -3, cy: -1.5, r: 1.8, fill: '#FFF6F0' });
      add('circle', { cx: 3, cy: -1.5, r: 1.8, fill: '#FFF6F0' });
      add('circle', { cx: -2.8, cy: -1.2, r: 0.9, fill: '#3A2A30' });
      add('circle', { cx: 3.2, cy: -1.2, r: 0.9, fill: '#3A2A30' });
      add('path', { d: 'M-1.5 3 L-0.9 4.8 L-0.3 3 Z M0.3 3 L0.9 4.8 L1.5 3 Z', fill: '#FFFDF7' });
      add('circle', { cx: -5, cy: 2, r: 1.3, fill: pink, opacity: 0.6 });
      add('circle', { cx: 5, cy: 2, r: 1.3, fill: pink, opacity: 0.6 });
      add('path', { d: 'M-2.5 8 L-2.5 11 M2.5 8 L2.5 11', stroke: '#3A2E4F', 'stroke-width': 1.4, 'stroke-linecap': 'round' });
    } else if (kind === 8) { // Star Shop Halloween: a friendly ghost with a bow in the pet color
      add('path', { d: 'M-10 13 L-10 -3 A10 10 0 0 1 10 -3 L10 13 L6.7 10.5 L3.3 13 L0 10.5 L-3.3 13 L-6.7 10.5 Z', fill: '#FFFDF7', stroke: '#D9CCE3', 'stroke-width': 1 });
      add('path', { d: 'M3 -11 L9 -14 L9 -8 Z M3 -11 L-3 -14 L-3 -8 Z', fill: color, stroke: line, 'stroke-width': 0.6, transform: 'translate(3 0)' });
      add('circle', { cx: 6, cy: -11, r: 1.4, fill: color, stroke: line, 'stroke-width': 0.6 });
      add('ellipse', { cx: -3.5, cy: -3, rx: 1.4, ry: 1.9, fill: '#3A2A30' });
      add('ellipse', { cx: 3.5, cy: -3, rx: 1.4, ry: 1.9, fill: '#3A2A30' });
      add('ellipse', { cx: 0, cy: 2.2, rx: 1.2, ry: 1.5, fill: '#3A2A30' });
      add('circle', { cx: -6, cy: 0.5, r: 1.5, fill: pink, opacity: 0.55 });
      add('circle', { cx: 6, cy: 0.5, r: 1.5, fill: pink, opacity: 0.55 });
    } else if (kind === 9) { // Star Shop Halloween: a little pumpkin buddy with feet
      add('ellipse', { cx: -4, cy: 13, rx: 2.6, ry: 1.4, fill: '#C9661A' });
      add('ellipse', { cx: 4, cy: 13, rx: 2.6, ry: 1.4, fill: '#C9661A' });
      add('ellipse', { cx: -6, cy: 4, rx: 7, ry: 8.5, fill: '#E07A1F' });
      add('ellipse', { cx: 6, cy: 4, rx: 7, ry: 8.5, fill: '#E07A1F' });
      add('ellipse', { cx: 0, cy: 3.5, rx: 8.5, ry: 9, fill: '#F28C28' });
      add('path', { d: 'M-5 -4 Q-6.5 3.5 -5 11.5 M5 -4 Q6.5 3.5 5 11.5', fill: 'none', stroke: '#C9661A', 'stroke-width': 0.9, 'stroke-linecap': 'round' });
      add('rect', { x: -1.5, y: -9, width: 3, height: 4.5, rx: 1, fill: '#6B8E3A' });
      add('ellipse', { cx: 4, cy: -7.5, rx: 3.4, ry: 1.6, fill: '#8BBF4A', transform: 'rotate(-25 4 -7.5)' });
      add('path', { d: 'M-4.4 1.6 L-2.8 -1.2 L-1.2 1.6 Z M1.2 1.6 L2.8 -1.2 L4.4 1.6 Z', fill: '#5A2E0E' });
      add('path', { d: 'M-4 5 Q0 8.6 4 5', fill: 'none', stroke: '#5A2E0E', 'stroke-width': 1.2, 'stroke-linecap': 'round' });
      add('circle', { cx: -6, cy: 5, r: 1.4, fill: pink, opacity: 0.55 });
      add('circle', { cx: 6, cy: 5, r: 1.4, fill: pink, opacity: 0.55 });
    } else if (kind === 10) { // Star Shop Fall: a round hedgehog with spines in the pet color
      var spines = [];
      for (var sp = 0; sp <= 16; sp++) {
        var sa = Math.PI + Math.PI * sp / 16, sr = sp % 2 ? 11 : 15;
        spines.push(fx(2 + Math.cos(sa) * sr * 1.05) + ',' + fx(6 + Math.sin(sa) * sr));
      }
      add('polygon', { points: spines.join(' ') + ' 17,10 17,13 -12,13', fill: color, stroke: line, 'stroke-width': 1.1, 'stroke-linejoin': 'round' });
      add('path', { d: 'M-4 -2 L-1 2 M4 -4 L5 1 M10 0 L9 4', stroke: line, 'stroke-width': 0.8, 'stroke-linecap': 'round', opacity: 0.6 });
      add('ellipse', { cx: -7, cy: 6.5, rx: 7.5, ry: 6.5, fill: '#F5DEC4', stroke: '#C9A27A', 'stroke-width': 1 });
      add('circle', { cx: -14, cy: 7, r: 1.5, fill: '#3A2A30' });
      add('circle', { cx: -8, cy: 4.4, r: 1.3, fill: '#3A2A30' });
      add('circle', { cx: -7.8, cy: 8.6, r: 1.5, fill: pink, opacity: 0.6 });
      add('ellipse', { cx: -6, cy: 13.6, rx: 2.4, ry: 1.2, fill: '#C9A27A' });
      add('ellipse', { cx: 7, cy: 13.6, rx: 2.4, ry: 1.2, fill: '#C9A27A' });
    } else if (kind === 11) { // Star Shop Winter: a snowman with a scarf in the pet color
      add('path', { d: 'M-8 -2 L-15 -7 M-13 -5.6 L-14.6 -3.4 M8 -2 L15 -7 M13 -5.6 L13.6 -9', stroke: '#8A5A3C', 'stroke-width': 1.2, 'stroke-linecap': 'round' });
      add('circle', { cx: 0, cy: 5.5, r: 9, fill: '#FFFDF7', stroke: '#CFE0EC', 'stroke-width': 1.1 });
      add('circle', { cx: 0, cy: -8.5, r: 6.8, fill: '#FFFDF7', stroke: '#CFE0EC', 'stroke-width': 1.1 });
      add('circle', { cx: 0, cy: 3, r: 1, fill: '#3A2A30' });
      add('circle', { cx: 0, cy: 7.5, r: 1, fill: '#3A2A30' });
      add('path', { d: 'M-5.4 -3.4 Q0 0 5.4 -3.4 L5.6 -1 Q0 2.2 -5.6 -1 Z', fill: color, stroke: line, 'stroke-width': 0.6 });
      add('path', { d: 'M3 -1 L4.6 4 L2 4.4 L1.2 -0.4 Z', fill: color, stroke: line, 'stroke-width': 0.6 });
      add('circle', { cx: -2.4, cy: -10, r: 1, fill: '#3A2A30' });
      add('circle', { cx: 2.4, cy: -10, r: 1, fill: '#3A2A30' });
      add('path', { d: 'M-0.2 -8.4 L5.2 -7.2 L-0.2 -6.6 Z', fill: '#F28C28' });
      add('circle', { cx: -4.2, cy: -7.2, r: 1.2, fill: pink, opacity: 0.6 });
      add('circle', { cx: 4.4, cy: -6, r: 1.2, fill: pink, opacity: 0.6 });
      add('rect', { x: -5, y: -17.6, width: 10, height: 2, rx: 1, fill: '#3A2E33' });
      add('rect', { x: -3.4, y: -23, width: 6.8, height: 6, rx: 1, fill: '#3A2E33' });
      add('rect', { x: -3.4, y: -19.6, width: 6.8, height: 1.4, fill: '#E05A5A' });
    } else if (kind === 12) { // Star Shop Winter: a penguin with a little bow tie in the pet color
      add('ellipse', { cx: -5, cy: 14, rx: 3.4, ry: 1.5, fill: '#F2A541' });
      add('ellipse', { cx: 5, cy: 14, rx: 3.4, ry: 1.5, fill: '#F2A541' });
      add('ellipse', { cx: -10.5, cy: 3, rx: 3, ry: 7, fill: '#2E3440', transform: 'rotate(18 -10.5 3)' });
      add('ellipse', { cx: 10.5, cy: 3, rx: 3, ry: 7, fill: '#2E3440', transform: 'rotate(-18 10.5 3)' });
      add('ellipse', { cx: 0, cy: 1, rx: 10.5, ry: 13, fill: '#2E3440' });
      add('ellipse', { cx: 0, cy: 4.5, rx: 7, ry: 9, fill: '#FFFDF7' });
      add('path', { d: 'M-6.4 -6.5 Q0 -12 6.4 -6.5 Q4 -3.6 0 -4.6 Q-4 -3.6 -6.4 -6.5 Z', fill: '#FFFDF7' });
      add('circle', { cx: -3, cy: -6.6, r: 1.3, fill: '#2E3440' });
      add('circle', { cx: 3, cy: -6.6, r: 1.3, fill: '#2E3440' });
      add('path', { d: 'M-2 -4.4 L2 -4.4 L0 -1.8 Z', fill: '#F2A541' });
      add('circle', { cx: -5, cy: -3.6, r: 1.3, fill: pink, opacity: 0.6 });
      add('circle', { cx: 5, cy: -3.6, r: 1.3, fill: pink, opacity: 0.6 });
      add('path', { d: 'M0 0.6 L-3.4 -1.2 L-3.4 2.4 Z M0 0.6 L3.4 -1.2 L3.4 2.4 Z', fill: color, stroke: line, 'stroke-width': 0.5 });
      add('circle', { cx: 0, cy: 0.6, r: 0.9, fill: color, stroke: line, 'stroke-width': 0.5 });
    } else if (kind === 13) { // Star Shop Valentine's: a teddy bear in the pet color, holding a heart
      body({ cx: -7.5, cy: -12, r: 3.6 });
      body({ cx: 7.5, cy: -12, r: 3.6 });
      add('circle', { cx: -7.5, cy: -12, r: 1.8, fill: light });
      add('circle', { cx: 7.5, cy: -12, r: 1.8, fill: light });
      body({ cx: -6, cy: 12, rx: 3.6, ry: 2.6 });
      body({ cx: 6, cy: 12, rx: 3.6, ry: 2.6 });
      body({ cx: 0, cy: 6, rx: 9.5, ry: 8 });
      add('ellipse', { cx: 0, cy: 7, rx: 5.5, ry: 5, fill: light });
      body({ cx: 0, cy: -5, r: 9 });
      add('ellipse', { cx: 0, cy: -2.4, rx: 4.2, ry: 3.2, fill: light });
      add('ellipse', { cx: 0, cy: -3.6, rx: 1.5, ry: 1.1, fill: '#3A2A30' });
      add('path', { d: 'M-1.4 -1.4 Q0 -0.2 1.4 -1.4', fill: 'none', stroke: '#3A2A30', 'stroke-width': 0.7, 'stroke-linecap': 'round' });
      eyes(-6.6, 3.6);
      cheeks(-3);
      add('path', { d: HEART, fill: '#E05A5A', stroke: '#B83B3B', 'stroke-width': 0.1, transform: 'translate(0 6.5) scale(3.6)' });
      body({ cx: -6.5, cy: 5, rx: 2.6, ry: 3.6, transform: 'rotate(-30 -6.5 5)' });
      body({ cx: 6.5, cy: 5, rx: 2.6, ry: 3.6, transform: 'rotate(30 6.5 5)' });
    } else if (kind === 14) { // Star Shop spring: a fluffy yellow duckling with a bow in the pet color
      add('path', { d: 'M-4 13 L-6.5 14.5 L-1.5 14.5 Z M4 13 L1.5 14.5 L6.5 14.5 Z', fill: '#F2A541' });
      add('ellipse', { cx: 1, cy: 5, rx: 11, ry: 8.5, fill: '#F6D55C', stroke: '#E0B53C', 'stroke-width': 1 });
      add('path', { d: 'M10 2 Q16 0 14 6 Z', fill: '#F6D55C', stroke: '#E0B53C', 'stroke-width': 0.8 });
      add('ellipse', { cx: 3, cy: 5, rx: 5, ry: 3.4, fill: '#F0C540', transform: 'rotate(-15 3 5)' });
      add('circle', { cx: -4, cy: -7, r: 7.5, fill: '#F6D55C', stroke: '#E0B53C', 'stroke-width': 1 });
      add('path', { d: 'M-5 -14 Q-4 -18 -1.5 -15.5 Q-3 -15 -3.4 -13.8', fill: '#F6D55C', stroke: '#E0B53C', 'stroke-width': 0.7 });
      add('path', { d: 'M-11 -5.5 L-16 -4.2 L-11 -2.6 Z', fill: '#F2A541', stroke: '#C77F1E', 'stroke-width': 0.6 });
      add('circle', { cx: -6.5, cy: -8.5, r: 1.3, fill: '#3A2A30' });
      add('circle', { cx: -7.6, cy: -4.4, r: 1.4, fill: pink, opacity: 0.6 });
      add('path', { d: 'M0 -1.5 L-3.4 -3.6 L-3.4 0.6 Z M0 -1.5 L3.4 -3.6 L3.4 0.6 Z', fill: color, stroke: line, 'stroke-width': 0.5 });
      add('circle', { cx: 0, cy: -1.5, r: 0.9, fill: color, stroke: line, 'stroke-width': 0.5 });
    } else if (kind === 6) { // Fish in a round bowl
      add('circle', { cx: 0, cy: 2, r: 12.5, fill: '#DDF0FA', stroke: '#8EC5E8', 'stroke-width': 1.2 });
      add('path', { d: 'M-11 -2 Q0 1 11 -2 L11 2 A12.5 12.5 0 0 1 -11 2 Z', fill: '#BDE3F5', opacity: 0.7 });
      add('rect', { x: -8, y: -11.5, width: 16, height: 3, rx: 1.5, fill: '#EAF6FC', stroke: '#8EC5E8', 'stroke-width': 1 });
      add('path', { d: 'M4 4 L9 0.5 L9 7.5 Z', fill: shade(color, -0.15), stroke: line, 'stroke-width': 0.8 });
      body({ cx: -1, cy: 4, rx: 6, ry: 4.2 });
      add('circle', { cx: -4, cy: 3.2, r: 1, fill: ink });
      add('circle', { cx: 2, cy: -5, r: 1.2, fill: '#FFFFFF', stroke: '#8EC5E8', 'stroke-width': 0.5 });
      add('circle', { cx: 4.5, cy: -7.5, r: 0.8, fill: '#FFFFFF', stroke: '#8EC5E8', 'stroke-width': 0.5 });
      add('path', { d: 'M-8 -4 Q-9 0 -8 4', fill: 'none', stroke: '#FFFFFF', 'stroke-width': 1.4, 'stroke-linecap': 'round', opacity: 0.8 });
    }
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
  var navAchievements = $('nav-achievements');
  var navContact = $('nav-contact');
  var currentId = new URLSearchParams(location.search).get('p');

  function showHome(push) {
    currentId = null;
    if (push) history.pushState(null, '', location.pathname);
    achievementsDialog.hidden = true;
    closePicEditor();
    closeProfileEditor();
    homeView.hidden = false;
    profileView.hidden = true;
    navProfiles.hidden = false;
    navHome.hidden = true;
    navResearch.hidden = true;
    navAchievements.hidden = true;
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
    navAchievements.hidden = false;
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
  var profileSearch = $('profile-search');
  profileSearch.addEventListener('input', function () { renderHome(); });
  // "My portfolio" on the home screen takes you to your own portfolio once you have one.
  var myPortfolioBtn = $('my-portfolio-btn');
  myPortfolioBtn.addEventListener('click', function () {
    var mp = myProfile();
    if (!mp || myPortfolioBtn.disabled) return;
    myPortfolioBtn.disabled = true;
    shootingStar(myPortfolioBtn, function () {
      myPortfolioBtn.disabled = false;
      showProfile(mp.id, true);
    });
  });

  // A gold shooting star flies from a button up and off the top-right of the screen,
  // dropping sparkles behind it, then `done` runs (it runs right away for people who prefer less motion).
  function shootingStar(fromEl, done) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !document.body.animate) { done(); return; }
    var r = fromEl.getBoundingClientRect();
    var x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    var x1 = window.innerWidth + 80, y1 = -80;
    var angle = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
    var DURATION = 900;
    var layer = make('div', 'shoot-layer');
    layer.setAttribute('aria-hidden', 'true');
    var star = make('div', 'shoot-star');
    star.appendChild(make('span', 'shoot-trail'));
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    var shape = document.createElementNS(SVG_NS, 'polygon');
    shape.setAttribute('points', '50,8 61.8,35.8 91.8,38.4 69,58.2 75.9,87.6 50,72 24.1,87.6 31,58.2 8.2,38.4 38.2,35.8');
    svg.appendChild(shape);
    star.appendChild(svg);
    layer.appendChild(star);
    document.body.appendChild(layer);
    function at(x, y, scale) {
      return 'translate(' + x + 'px, ' + y + 'px) rotate(' + angle + 'deg) scale(' + scale + ')';
    }
    // It speeds up as it goes, like it's being flung.
    star.animate([
      { transform: at(x0, y0, 0.3), opacity: 0 },
      { transform: at(x0, y0 - 6, 1.15), opacity: 1, offset: 0.14 },
      { transform: at(x1, y1, 0.9), opacity: 1 }
    ], { duration: DURATION, easing: 'cubic-bezier(0.55, 0, 0.8, 0.4)', fill: 'forwards' });
    // Sparkles left behind along the path.
    for (var i = 1; i <= 12; i++) {
      (function (i) {
        var t = i / 13;
        var eased = Math.pow(t, 1.8);
        setTimeout(function () {
          var s = make('span', 'shoot-spark' + (i % 2 ? '' : ' pink'));
          var x = x0 + (x1 - x0) * eased + (Math.random() * 16 - 8);
          var y = y0 + (y1 - y0) * eased + (Math.random() * 16 - 8);
          layer.appendChild(s);
          s.animate([
            { transform: 'translate(' + x + 'px, ' + y + 'px) scale(0.2) rotate(0deg)', opacity: 1 },
            { transform: 'translate(' + x + 'px, ' + (y + 10) + 'px) scale(1) rotate(45deg)', opacity: 0.9, offset: 0.35 },
            { transform: 'translate(' + x + 'px, ' + (y + 24) + 'px) scale(0.3) rotate(90deg)', opacity: 0 }
          ], { duration: 700, easing: 'ease-out', fill: 'forwards' });
        }, DURATION * 0.1 + DURATION * 0.85 * t);
      })(i);
    }
    setTimeout(done, DURATION - 60);
    setTimeout(function () { layer.remove(); }, DURATION + 800);
  }
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
    var recentTagsRow = tagChips(q);
    if (recentTagsRow) b.appendChild(recentTagsRow);
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
    var recentSave = researchSaveButton(q);
    if (recentSave) tools.appendChild(recentSave);
    card.appendChild(tools);
    if (open) {
      var owner = findProfile(q.profileId);
      card.appendChild(commentsPanel(q, comments, !!owner && canEdit(owner)));
    }
    li.appendChild(card);
    return li;
  }
  // Search also finds research: titles, descriptions, topics and source names.
  function renderResearchResults(query) {
    var box = $('research-results');
    var list = $('research-result-list');
    list.textContent = '';
    if (!query || !loaded) { box.hidden = true; return; }
    var hits = [];
    state.profiles.forEach(function (p) {
      p.projects.forEach(function (q) {
        var text = (q.title + ' ' + q.description + ' ' + q.tags.join(' ') + ' ' +
          q.sources.map(function (s) { return s.name; }).join(' ')).toLowerCase();
        if (text.indexOf(query) >= 0) hits.push({ p: p, q: q });
      });
    });
    box.hidden = false;
    $('research-results-label').textContent = hits.length
      ? 'Research matching “' + profileSearch.value.trim() + '” · ' + hits.length
      : 'No research matches “' + profileSearch.value.trim() + '”.';
    hits.slice(0, 12).forEach(function (it) {
      var li = make('li');
      var b = make('button', 'research-result');
      b.type = 'button';
      b.appendChild(make('span', 'research-result-title', it.q.title));
      var by = make('span', 'research-result-by');
      by.appendChild(document.createTextNode('by '));
      var nm = make('span');
      paintName(nm, it.p.name);
      by.appendChild(nm);
      b.appendChild(by);
      b.addEventListener('click', function () {
        showProfile(it.p.id, true);
        var target = $('project-' + it.q.id);
        if (!target) return;
        target.scrollIntoView({ block: 'center' });
        target.classList.add('flash');
        setTimeout(function () { target.classList.remove('flash'); }, 1600);
      });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  // Topic filter above Recent research: All plus every topic that some research uses.
  var recentTag = '';
  function renderRecentTags(all) {
    var box = $('recent-tags');
    var used = TAGS.filter(function (t) { return all.some(function (it) { return it.q.tags.indexOf(t) >= 0; }); });
    if (recentTag && used.indexOf(recentTag) < 0) recentTag = '';
    box.hidden = !used.length;
    box.textContent = '';
    [''].concat(used).forEach(function (t) {
      var b = make('button', 'chip tag-filter', t || 'All topics');
      b.type = 'button';
      b.setAttribute('aria-pressed', recentTag === t ? 'true' : 'false');
      b.addEventListener('click', function () {
        recentTag = t;
        recentStrip.scrollLeft = 0;
        renderRecent();
      });
      box.appendChild(b);
    });
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
    renderRecentTags(all);
    if (recentTag) all = all.filter(function (it) { return it.q.tags.indexOf(recentTag) >= 0; });
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

  // Opens a portfolio and scrolls to one of its research cards.
  function goToResearch(profileId, projectId) {
    showProfile(profileId, true);
    var target = $('project-' + projectId);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    target.classList.add('flash');
    setTimeout(function () { target.classList.remove('flash'); }, 1600);
  }

  // ---- Home: Top research this week, ranked by likes from the last 7 days ----
  var TOP_LIMIT = 5;
  function renderTop() {
    var section = $('top-research');
    var weekAgo = Date.now() - 7 * 86400000;
    var counts = {};
    state.projectLikes.forEach(function (l) {
      if (l.at >= weekAgo) counts[l.projectId] = (counts[l.projectId] || 0) + 1;
    });
    var ranked = [];
    state.profiles.forEach(function (p) {
      p.projects.forEach(function (q) { if (counts[q.id]) ranked.push({ p: p, q: q, n: counts[q.id] }); });
    });
    ranked.sort(function (a, b) { return b.n - a.n || b.q.createdAt - a.q.createdAt; });
    ranked = ranked.slice(0, TOP_LIMIT);
    section.hidden = !client || !loaded || !!loadError || !ranked.length;
    var list = $('top-list');
    list.textContent = '';
    ranked.forEach(function (it, i) {
      var li = make('li', 'top-item' + (i === 0 ? ' first' : ''));
      var b = make('button', 'top-open');
      b.type = 'button';
      b.appendChild(make('span', 'top-rank', String(i + 1)));
      var text = make('span', 'top-text');
      text.appendChild(make('span', 'top-title', it.q.title));
      var by = make('span', 'top-by');
      by.appendChild(document.createTextNode('by '));
      var nm = make('span');
      paintName(nm, it.p.name);
      by.appendChild(nm);
      text.appendChild(by);
      b.appendChild(text);
      b.appendChild(make('span', 'top-likes', '♥ ' + it.n + ' this week'));
      b.setAttribute('aria-label', 'Number ' + (i + 1) + ': ' + it.q.title + ', by ' + it.p.name + ', ' + plural(it.n, 'like') + ' this week');
      b.addEventListener('click', function () { goToResearch(it.p.id, it.q.id); });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  // ---- Home: the weekly research challenge ----
  // Each week (Monday to Sunday, US Eastern) has a topic from TAGS, in order. The most-liked research posted
  // that week with that topic wins 10 stars, awarded by award_challenge() in supabase/more-features-2.sql.
  var CHALLENGE_START = '2026-10-26'; // the first challenge week
  var CHALLENGE_PRIZE = 10;
  var WEEK = 7 * 86400000;
  function weekKey(t) {
    var d = new Date(dayKey(t) + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return d.toISOString().slice(0, 10);
  }
  function weekTopic(key) {
    var i = Math.round((Date.parse(key + 'T00:00:00Z') - Date.UTC(2026, 0, 5)) / WEEK);
    return TAGS[((i % TAGS.length) + TAGS.length) % TAGS.length];
  }
  function addDays(key, n) {
    var d = new Date(key + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function niceDay(key) {
    return new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  // The research entered in a week's challenge, most liked first.
  function challengeEntries(key) {
    var topic = weekTopic(key);
    var out = [];
    state.profiles.forEach(function (p) {
      p.projects.forEach(function (q) {
        if (q.tags.indexOf(topic) < 0 || weekKey(q.createdAt) !== key) return;
        var likes = state.projectLikes.filter(function (l) { return l.projectId === q.id; }).length;
        out.push({ p: p, q: q, likes: likes });
      });
    });
    return out.sort(function (a, b) { return b.likes - a.likes || a.q.createdAt - b.q.createdAt; });
  }
  // Did this portfolio ever enter a challenge? (for the Challenger badge)
  function enteredChallenges(p) {
    return p.projects.filter(function (q) {
      var key = weekKey(q.createdAt);
      return key >= CHALLENGE_START && q.tags.indexOf(weekTopic(key)) >= 0;
    }).length;
  }
  var challengeTag = ''; // a topic to pick for the next new research card
  function renderChallenge() {
    var band = $('challenge-band');
    band.hidden = !client || !loaded || !!loadError || !extrasReady;
    if (band.hidden) return;
    var now = weekKey(Date.now());
    var started = now >= CHALLENGE_START;
    var key = started ? now : CHALLENGE_START;
    var topic = weekTopic(key);
    $('challenge-topic').textContent = topic;
    var ends = Date.parse(addDays(key, 7) + 'T05:00:00Z');
    $('challenge-left').textContent = started ? timeUntil(ends) : 'Starts ' + niceDay(CHALLENGE_START);
    $('challenge-text').textContent = started
      ? 'Post research about ' + topic.toLowerCase() + ' this week and tag it ' + topic + '. The most-liked one on Sunday night wins ' +
        CHALLENGE_PRIZE + ' stars, and everyone who enters gets the Challenger badge.'
      : 'The first weekly challenge is ' + topic + '. Post research about it next week and tag it ' + topic +
        '. The most-liked one wins ' + CHALLENGE_PRIZE + ' stars, and everyone who enters gets the Challenger badge.';
    var list = $('challenge-entries');
    list.textContent = '';
    var entries = started ? challengeEntries(key) : [];
    entries.slice(0, 3).forEach(function (it, i) {
      var li = make('li', 'challenge-entry' + (i === 0 && it.likes ? ' leading' : ''));
      var b = make('button', 'challenge-open');
      b.type = 'button';
      b.appendChild(make('span', 'challenge-entry-title', it.q.title));
      var by = make('span', 'challenge-entry-by');
      paintName(by, it.p.name);
      b.appendChild(by);
      b.appendChild(make('span', 'challenge-entry-likes', '♥ ' + it.likes));
      b.addEventListener('click', function () { goToResearch(it.p.id, it.q.id); });
      li.appendChild(b);
      list.appendChild(li);
    });
    list.hidden = !entries.length;
    $('challenge-enter').hidden = !started;
    $('challenge-enter').textContent = entries.length
      ? 'Enter the challenge (' + entries.length + (entries.length === 1 ? ' entry' : ' entries') + ' so far)'
      : 'Be the first to enter';
    // Last week's winner.
    var last = addDays(now, -7);
    var lastEntries = last >= CHALLENGE_START ? challengeEntries(last).filter(function (it) { return it.likes > 0; }) : [];
    var lastEl = $('challenge-last');
    lastEl.hidden = !lastEntries.length;
    if (lastEntries.length) {
      lastEl.textContent = 'Last week (' + weekTopic(last) + '): ' + lastEntries[0].p.name + ' won with “' + lastEntries[0].q.title + '”.';
    }
    awardLastWeek(last);
  }
  // Once someone signed in visits after a week ends, the server hands out that week's prize (only once).
  var awardedWeek = '';
  function awardLastWeek(last) {
    if (!me || !pollsReady || last < CHALLENGE_START || awardedWeek === last) return;
    awardedWeek = last;
    client.rpc('award_challenge', { week_start: last }).then(function (res) {
      if (!res.error && res.data && res.data.awarded && res.data.winner === me.id) refresh();
    });
  }
  $('challenge-enter').addEventListener('click', function () {
    if (!me) { openAuth('signin', 'Sign in to enter the weekly challenge.'); return; }
    var mp = myProfile();
    if (!mp) { showToast('Make your portfolio first, then you can enter the challenge.'); return; }
    challengeTag = weekTopic(weekKey(Date.now()));
    showProfile(mp.id, true);
    openProject('new');
    var titleIn = $('project-title-input');
    if (titleIn) titleIn.closest('.project').scrollIntoView({ block: 'center' });
  });

  // ---- Home: Star leaderboard, by likes on research this month ----
  function renderLeaderboard() {
    var monthStart = dayKey(Date.now()).slice(0, 8) + '01';
    var counts = {};
    state.projectLikes.forEach(function (l) {
      if (!l.at || dayKey(l.at) < monthStart) return;
      var q = findProject(l.projectId);
      var owner = q && findProfile(q.profileId);
      if (owner) counts[owner.ownerId] = (counts[owner.ownerId] || 0) + 1;
    });
    var ranked = Object.keys(counts).map(function (id) { return { id: id, n: counts[id] }; })
      .sort(function (a, b) { return b.n - a.n || ownerName(a.id).localeCompare(ownerName(b.id)); }).slice(0, 5);
    var monthName = new Date().toLocaleDateString('en-US', { month: 'long', timeZone: 'America/New_York' });
    $('leader-sub').textContent = 'Most likes on research in ' + monthName + '. Every like is a star.';
    var list = $('leader-list');
    list.textContent = '';
    if (!ranked.length) {
      list.appendChild(make('li', 'leader-empty', 'No likes yet this month. Like research you enjoy to get it started!'));
      return;
    }
    ranked.forEach(function (r, i) {
      var fp = profileFor(r.id);
      var li = make('li', 'leader-item' + (i === 0 ? ' first' : ''));
      var b = make('button', 'leader-open');
      b.type = 'button';
      b.appendChild(make('span', 'leader-rank', String(i + 1)));
      var pic = fp ? pictureNode(fp.avatar, fp.name) : null;
      var avatar = make('span', 'avatar leader-avatar', pic ? null : ownerName(r.id).charAt(0).toUpperCase());
      if (pic) avatar.appendChild(pic);
      avatar.setAttribute('aria-hidden', 'true');
      b.appendChild(avatar);
      var nm = make('span', 'leader-name');
      paintName(nm, ownerName(r.id));
      b.appendChild(nm);
      b.appendChild(make('span', 'leader-stars', '★ ' + r.n));
      b.setAttribute('aria-label', 'Number ' + (i + 1) + ': ' + ownerName(r.id) + ', ' + plural(r.n, 'star') + ' this month');
      if (fp) b.addEventListener('click', function () { showProfile(fp.id, true); });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  function renderHome() {
    var list = state.profiles;
    renderRecent();
    renderTop();
    renderChallenge();
    renderLeaderboard();
    myPortfolioBtn.hidden = !myProfile();
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
    // The search box narrows the list to names or descriptions that contain what you typed.
    var query = profileSearch.value.trim().toLowerCase();
    if (query) {
      shown = shown.filter(function (p) {
        return (p.name + ' ' + p.description).toLowerCase().indexOf(query) >= 0;
      });
    }
    profilesEmpty.textContent = query
      ? 'No profiles match “' + profileSearch.value.trim() + '”.'
      : 'No profiles yet. Be the first to create one.';
    renderResearchResults(query);

    profileList.textContent = '';
    if (!loaded || loadError || !client) { profilesEmpty.hidden = true; return; }
    shown.forEach(function (p) { profileList.appendChild(profileCard(p)); });
    var addCard = null;
    if (homeFilter === 'all' && !query) {
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
      if (unkind(n + ' ' + descIn.value)) { statusEl.textContent = KIND_NOTE; nameIn.focus(); return; }
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
    // Anyone signed in can report someone else's portfolio.
    var reported = alreadyReported('profile', p.id);
    $('report-profile').hidden = !me || !reportsReady || canEdit(p);
    $('report-profile').textContent = reported ? 'Reported' : 'Report';
    $('report-profile').disabled = reported;
    // Block: they can't message you or comment on your research, and you won't see their comments or messages.
    var blockBtn = $('block-btn');
    blockBtn.hidden = !me || !blocksReady || canEdit(p) || p.ownerId === (me && me.id);
    blockBtn.textContent = isBlockedByMe(p.ownerId) ? 'Unblock' : 'Block';
    blockBtn.disabled = blocking;
    renderBadgeStrip(p);
    paintPortrait(p.avatar, p.name);
    renderProfileReactions();
    addr.textContent = p.email;
    contactSection.hidden = !p.email;
    ctaContact.hidden = !p.email;
    navContact.hidden = !p.email;
    renderProjects();
    if (!achievementsDialog.hidden) renderAchievements(p);
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
    if (unkind(name + ' ' + text)) { editStatus.textContent = KIND_NOTE; input.focus(); return; }
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
    ['Face', 'face', 'chip'], ['Background', 'bg', 'swatch'], ['Frame', 'frame', 'chip'], ['Portfolio scene', 'scene', 'chip'],
    ['Pet', 'pet', 'chip', 'pets'], ['Pet color', 'petColor', 'swatch', 'pets']
  ];
  // Pets are achievements: each one unlocks when its owner has done a task on the site.
  // pet number -> [task, how far along this portfolio is, goal]
  var PET_UNLOCKS = {
    1: ['Publish your first research card', function (p) { return p.projects.length; }, 1],
    2: ['Get your first follower', function (p) { return countFor(state.follows, p.id); }, 1],
    3: ['Make a friend: follow someone who follows you', function (p) { return friendCount(p.ownerId); }, 1],
    4: ['Leave 3 comments or tips on other people’s research', function (p) {
      return state.comments.filter(function (c) { return c.userId === p.ownerId; }).length;
    }, 3],
    5: ['Get 5 likes on your research', function (p) {
      var ids = p.projects.map(function (q) { return q.id; });
      return state.projectLikes.filter(function (l) { return ids.indexOf(l.projectId) >= 0; }).length;
    }, 5],
    6: ['Team up with someone on a collab', function (p) {
      return state.collabs.filter(function (c) {
        var q = findProject(c.projectId);
        return c.status === 'accepted' && (c.toProfile === p.id || (q && q.profileId === p.id));
      }).length;
    }, 1]
  };
  function petProgress(p, kind) {
    var u = PET_UNLOCKS[kind];
    if (!u) return null;
    // The site owner's portfolio has every pet unlocked.
    var have = cfg.ownerProfileId && p.id === cfg.ownerProfileId ? u[2] : Math.min(u[1](p), u[2]);
    return { task: u[0], have: have, goal: u[2], unlocked: have >= u[2] };
  }
  function lockIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'lock-icon');
    svg.setAttribute('aria-hidden', 'true');
    var shackle = document.createElementNS(SVG_NS, 'path');
    shackle.setAttribute('d', 'M5 7 V5 a3 3 0 0 1 6 0 V7');
    shackle.setAttribute('fill', 'none');
    shackle.setAttribute('stroke', 'currentColor');
    shackle.setAttribute('stroke-width', '1.8');
    var body = document.createElementNS(SVG_NS, 'rect');
    body.setAttribute('x', '3');
    body.setAttribute('y', '7');
    body.setAttribute('width', '10');
    body.setAttribute('height', '7.5');
    body.setAttribute('rx', '1.6');
    body.setAttribute('fill', 'currentColor');
    svg.appendChild(shackle);
    svg.appendChild(body);
    return svg;
  }
  // The list of pet achievements on the Pets tab: each pet, its task and how far along you are.
  function petGoalsList(p) {
    var box = make('div', 'pet-goals');
    var unlocked = CHAR.pet.filter(function (_, i) { return PET_UNLOCKS[i] && petProgress(p, i).unlocked; }).length;
    box.appendChild(make('p', 'edit-label', 'Pet achievements · ' + unlocked + ' of ' + Object.keys(PET_UNLOCKS).length + ' unlocked'));
    var list = make('ul', 'pet-goal-list');
    CHAR.pet.forEach(function (name, i) {
      if (!PET_UNLOCKS[i]) return; // Star Shop pets have no achievement
      var g = petProgress(p, i);
      var li = make('li', 'pet-goal' + (g.unlocked ? ' done' : ''));
      var icon = make('span', 'pet-goal-icon');
      var mini = renderPet({ pet: i, petColor: picDraft.character.petColor });
      mini.removeAttribute('class');
      mini.setAttribute('aria-hidden', 'true');
      icon.appendChild(mini);
      if (!g.unlocked) icon.appendChild(lockIcon());
      var text = make('span', 'pet-goal-text');
      text.appendChild(make('span', 'pet-goal-name', name + (g.unlocked ? ' · Unlocked' : '')));
      text.appendChild(make('span', 'pet-goal-task', g.task));
      if (!g.unlocked && g.goal > 1) {
        var bar = make('span', 'pet-goal-bar');
        var fill = make('span', 'pet-goal-fill');
        fill.style.width = Math.round(g.have / g.goal * 100) + '%';
        bar.appendChild(fill);
        text.appendChild(bar);
        text.appendChild(make('span', 'pet-goal-count', g.have + ' of ' + g.goal));
      }
      li.appendChild(icon);
      li.appendChild(text);
      list.appendChild(li);
    });
    box.appendChild(list);
    return box;
  }

  // The Achievements section on a portfolio: every pet achievement, done or not, for that portfolio.
  var ACHIEVEMENT_NAMES = { 1: 'First research', 2: 'First follower', 3: 'Best friends', 4: 'Helpful critic', 5: 'Crowd favorite', 6: 'Team player' };
  function renderAchievements(p) {
    var list = $('achievement-list');
    list.textContent = '';
    var done = 0;
    CHAR.pet.forEach(function (petName, i) {
      if (!PET_UNLOCKS[i]) return; // Star Shop pets have no achievement
      var g = petProgress(p, i);
      if (g.unlocked) done++;
      var li = make('li', 'achievement' + (g.unlocked ? ' done' : ''));
      var badge = make('span', 'achievement-badge');
      var pet = renderPet({ pet: i, petColor: p.avatar ? p.avatar.character.petColor : 0 });
      pet.removeAttribute('class');
      pet.setAttribute('aria-hidden', 'true');
      badge.appendChild(pet);
      if (!g.unlocked) badge.appendChild(lockIcon());
      li.appendChild(badge);
      li.appendChild(make('span', 'achievement-status', g.unlocked ? 'Unlocked' : 'Locked'));
      li.appendChild(make('h3', 'achievement-name', ACHIEVEMENT_NAMES[i]));
      li.appendChild(make('p', 'achievement-task', g.task));
      if (!g.unlocked && g.goal > 1) {
        var bar = make('span', 'pet-goal-bar');
        var fill = make('span', 'pet-goal-fill');
        fill.style.width = Math.round(g.have / g.goal * 100) + '%';
        bar.appendChild(fill);
        li.appendChild(bar);
        li.appendChild(make('span', 'pet-goal-count', g.have + ' of ' + g.goal));
      }
      li.appendChild(make('p', 'achievement-reward', (g.unlocked ? 'Unlocked the ' : 'Unlocks the ') + petName.toLowerCase()));
      list.appendChild(li);
    });
    $('achievements-sub').textContent = done + ' of ' + Object.keys(PET_UNLOCKS).length + ' unlocked. Each achievement unlocks a pet to pick in Edit character.';
    renderBadges(p);
  }

  // Badges: extra goals shown under the pet achievements. They don't unlock anything, they're just for fun.
  function badgeGoals(p) {
    var projectIds = p.projects.map(function (q) { return q.id; });
    var likes = countFor(state.likes, p.id) +
      state.projectLikes.filter(function (l) { return projectIds.indexOf(l.projectId) >= 0; }).length;
    var followers = state.follows.filter(function (f) { return f.profileId === p.id; }).length;
    var comments = state.comments.filter(function (c) { return c.userId === p.ownerId; }).length;
    var topics = {};
    p.projects.forEach(function (q) { q.tags.forEach(function (t) { topics[t] = true; }); });
    var goals = [
      { icon: '✎', name: 'Prolific', task: 'Post 5 research projects', have: p.projects.length, goal: 5 },
      { icon: '♥', name: 'Well liked', task: 'Get 10 likes on your portfolio and research', have: likes, goal: 10 },
      { icon: '★', name: 'Popular', task: 'Get 5 followers', have: followers, goal: 5 },
      { icon: '❝', name: 'Chatterbox', task: 'Leave 10 comments or tips on research', have: comments, goal: 10 }
    ];
    if (extrasReady) goals.push({ icon: '◆', name: 'Explorer', task: 'Research 3 different topics', have: Object.keys(topics).length, goal: 3 });
    if (extrasReady) goals.push({ icon: '⚑', name: 'Challenger', task: 'Enter a weekly research challenge', have: enteredChallenges(p), goal: 1 });
    if (me && p.ownerId === me.id && claimsReady) {
      goals.push({ icon: '☀', name: 'Regular', task: 'Claim your daily star 7 days in a row', have: streakDays(), goal: 7 });
    }
    return goals;
  }
  // Earned badges, shown as little gold medals under the portfolio's description. Clicking opens Achievements.
  function renderBadgeStrip(p) {
    var strip = $('badge-strip');
    strip.textContent = '';
    var earned = badgeGoals(p).filter(function (g) { return g.have >= g.goal; });
    var pets = Object.keys(PET_UNLOCKS).filter(function (i) { return petProgress(p, Number(i)).unlocked; }).length;
    strip.hidden = !earned.length && !pets;
    if (strip.hidden) return;
    earned.forEach(function (g) {
      var b = make('button', 'badge-medal', g.icon);
      b.type = 'button';
      b.title = g.name + ': ' + g.task;
      b.setAttribute('aria-label', g.name + ' badge: ' + g.task + '. Open achievements.');
      b.addEventListener('click', openAchievements);
      strip.appendChild(b);
    });
    if (pets) {
      var more = make('button', 'badge-more', plural(pets, 'pet') + ' unlocked');
      more.type = 'button';
      more.addEventListener('click', openAchievements);
      strip.appendChild(more);
    }
  }
  function renderBadges(p) {
    var list = $('badge-list');
    list.textContent = '';
    var goals = badgeGoals(p);
    var done = goals.filter(function (g) { return g.have >= g.goal; }).length;
    $('badges-sub').textContent = done + ' of ' + goals.length + ' earned.';
    goals.forEach(function (g) {
      var earned = g.have >= g.goal;
      var li = make('li', 'badge' + (earned ? ' done' : ''));
      var icon = make('span', 'badge-icon', g.icon);
      icon.setAttribute('aria-hidden', 'true');
      li.appendChild(icon);
      var text = make('span', 'badge-text');
      text.appendChild(make('span', 'badge-name', g.name + (earned ? ' · Earned' : '')));
      text.appendChild(make('span', 'badge-task', g.task));
      if (!earned) {
        var bar = make('span', 'pet-goal-bar');
        var fill = make('span', 'pet-goal-fill');
        fill.style.width = Math.round(Math.min(g.have, g.goal) / g.goal * 100) + '%';
        bar.appendChild(fill);
        text.appendChild(bar);
        text.appendChild(make('span', 'pet-goal-count', Math.min(g.have, g.goal) + ' of ' + g.goal));
      }
      li.appendChild(text);
      list.appendChild(li);
    });
  }

  // The Achievements pop-up opens from the Achievements link at the top of a portfolio.
  var achievementsDialog = $('achievements');
  var achievementsOpener = null;
  function openAchievements() {
    var p = current();
    if (!p) return;
    achievementsOpener = document.activeElement;
    renderAchievements(p);
    $('achievements-title').textContent = p.name + '’s achievements';
    achievementsDialog.hidden = false;
    $('achievements-close').focus();
  }
  function closeAchievements() {
    achievementsDialog.hidden = true;
    if (achievementsOpener && achievementsOpener.focus) achievementsOpener.focus();
  }
  $('achievements-close').addEventListener('click', closeAchievements);
  achievementsDialog.addEventListener('click', function (e) { if (e.target === achievementsDialog) closeAchievements(); });
  navAchievements.addEventListener('click', function (e) {
    e.preventDefault();
    openAchievements();
  });

  // ---- Star Shop: stars come from likes, and buy items for your character ----
  // Prices and seasons must match buy_shop_item() in supabase/more-features.sql, which is what actually checks them.
  // Each season's items are only in the shop for that season (US Eastern dates). Items you bought stay yours.
  var SEASONS = {
    halloween: { name: 'Halloween', starts: 0, ends: Date.parse('2026-11-01T04:00:00Z'), last: 'October 31' },
    fall: { name: 'Fall', starts: Date.parse('2026-11-01T04:00:00Z'), ends: Date.parse('2026-12-01T05:00:00Z'), first: 'November 1', last: 'November 30' },
    winter: { name: 'Winter', starts: Date.parse('2026-12-01T05:00:00Z'), ends: Date.parse('2027-01-01T05:00:00Z'), first: 'December 1', last: 'December 31' },
    valentine: { name: 'Valentine’s', starts: Date.parse('2027-02-01T05:00:00Z'), ends: Date.parse('2027-03-01T05:00:00Z'), first: 'February 1', last: 'February 28' },
    spring: { name: 'Spring', starts: Date.parse('2027-03-01T05:00:00Z'), ends: Date.parse('2027-06-01T04:00:00Z'), first: 'March 1', last: 'May 31' }
  };
  var SEASON_ORDER = ['halloween', 'fall', 'winter', 'valentine', 'spring'];
  // The year a season's last day falls in, for "leave the shop on February 28, 2027".
  function seasonYear(k) { return new Date(SEASONS[k].ends - 86400000).getUTCFullYear(); }
  function nextSeason() { return SEASON_ORDER.filter(function (k) { return Date.now() < SEASONS[k].starts; })[0] || null; }
  var SHOP = [
    { id: 'pumpkin-top', name: 'Pumpkin orange outfit', kind: 'Clothing color', key: 'top', index: 17, price: 1, season: 'halloween' },
    { id: 'witchy-hair', name: 'Witchy purple hair', kind: 'Hair color', key: 'hairColor', index: 9, price: 1, season: 'halloween' },
    { id: 'bat-headband', name: 'Bat headband', kind: 'Headwear', key: 'headwear', index: 13, price: 2, season: 'halloween' },
    { id: 'pumpkin-hat', name: 'Pumpkin hat', kind: 'Headwear', key: 'headwear', index: 12, price: 3, season: 'halloween' },
    { id: 'witch-hat', name: 'Witch hat', kind: 'Headwear', key: 'headwear', index: 11, price: 4, season: 'halloween' },
    { id: 'ghost-frame', name: 'Ghost frame', kind: 'Frame', key: 'frame', index: 9, price: 4, season: 'halloween' },
    { id: 'pumpkin-frame', name: 'Pumpkin patch frame', kind: 'Frame', key: 'frame', index: 8, price: 5, season: 'halloween' },
    { id: 'midnight-bg', name: 'Midnight background', kind: 'Background', key: 'bg', index: 6, price: 1, season: 'halloween' },
    { id: 'devil-horns', name: 'Devil horns', kind: 'Headwear', key: 'headwear', index: 14, price: 2, season: 'halloween' },
    { id: 'vampire-fangs', name: 'Vampire fangs', kind: 'Face', key: 'face', index: 11, price: 2, season: 'halloween' },
    { id: 'witch-face', name: 'Witch face', kind: 'Face', key: 'face', index: 13, price: 3, season: 'halloween' },
    { id: 'candy-crown', name: 'Candy corn crown', kind: 'Headwear', key: 'headwear', index: 15, price: 3, season: 'halloween' },
    { id: 'candy-frame', name: 'Candy corn frame', kind: 'Frame', key: 'frame', index: 10, price: 3, season: 'halloween' },
    { id: 'vampire-cape', name: 'Vampire cape', kind: 'Clothing', key: 'outfit', index: 6, price: 4, season: 'halloween' },
    { id: 'web-frame', name: 'Spiderweb frame', kind: 'Frame', key: 'frame', index: 11, price: 4, season: 'halloween' },
    { id: 'bat-pet', name: 'Bat buddy', kind: 'Pet', key: 'pet', index: 7, price: 5, season: 'halloween' },
    { id: 'ghost-pet', name: 'Ghost pet', kind: 'Pet', key: 'pet', index: 8, price: 5, season: 'halloween' },
    { id: 'pumpkin-pet', name: 'Pumpkin buddy', kind: 'Pet', key: 'pet', index: 9, price: 6, season: 'halloween' },
    // Fall, all through November.
    { id: 'harvest-bg', name: 'Harvest background', kind: 'Background', key: 'bg', index: 7, price: 1, season: 'fall' },
    { id: 'leaf-crown', name: 'Autumn leaf crown', kind: 'Headwear', key: 'headwear', index: 16, price: 2, season: 'fall' },
    { id: 'flannel', name: 'Plaid flannel', kind: 'Clothing', key: 'outfit', index: 7, price: 3, season: 'fall' },
    { id: 'maple-frame', name: 'Maple leaf frame', kind: 'Frame', key: 'frame', index: 12, price: 4, season: 'fall' },
    { id: 'hedgehog-pet', name: 'Hedgehog', kind: 'Pet', key: 'pet', index: 10, price: 5, season: 'fall' },
    // Winter, all through December.
    { id: 'pine-bg', name: 'Snowy pine background', kind: 'Background', key: 'bg', index: 8, price: 1, season: 'winter' },
    { id: 'earmuffs', name: 'Fluffy earmuffs', kind: 'Headwear', key: 'headwear', index: 17, price: 2, season: 'winter' },
    { id: 'cozy-scarf', name: 'Cozy knit scarf', kind: 'Clothing', key: 'outfit', index: 8, price: 3, season: 'winter' },
    { id: 'santa-hat', name: 'Santa hat', kind: 'Headwear', key: 'headwear', index: 18, price: 3, season: 'winter' },
    { id: 'snowflake-frame', name: 'Snowflake frame', kind: 'Frame', key: 'frame', index: 13, price: 4, season: 'winter' },
    { id: 'snowman-pet', name: 'Snowman', kind: 'Pet', key: 'pet', index: 11, price: 5, season: 'winter' },
    { id: 'penguin-pet', name: 'Penguin', kind: 'Pet', key: 'pet', index: 12, price: 6, season: 'winter' },
    // Valentine's, all through February.
    { id: 'rose-bg', name: 'Rose pink background', kind: 'Background', key: 'bg', index: 9, price: 1, season: 'valentine' },
    { id: 'heart-headband', name: 'Heart headband', kind: 'Headwear', key: 'headwear', index: 19, price: 2, season: 'valentine' },
    { id: 'heart-sweater', name: 'Heart sweater', kind: 'Clothing', key: 'outfit', index: 9, price: 3, season: 'valentine' },
    { id: 'cupid-frame', name: 'Cupid hearts frame', kind: 'Frame', key: 'frame', index: 14, price: 4, season: 'valentine' },
    { id: 'teddy-pet', name: 'Teddy bear', kind: 'Pet', key: 'pet', index: 13, price: 5, season: 'valentine' },
    // Spring, March through May.
    { id: 'meadow-bg', name: 'Meadow green background', kind: 'Background', key: 'bg', index: 10, price: 1, season: 'spring' },
    { id: 'bunny-ears', name: 'Bunny ears', kind: 'Headwear', key: 'headwear', index: 20, price: 2, season: 'spring' },
    { id: 'sun-hat', name: 'Sun hat', kind: 'Headwear', key: 'headwear', index: 21, price: 3, season: 'spring' },
    { id: 'raincoat', name: 'Sunny raincoat', kind: 'Clothing', key: 'outfit', index: 10, price: 3, season: 'spring' },
    { id: 'butterfly-frame', name: 'Butterfly frame', kind: 'Frame', key: 'frame', index: 15, price: 4, season: 'spring' },
    { id: 'duckling-pet', name: 'Duckling', kind: 'Pet', key: 'pet', index: 14, price: 5, season: 'spring' }
  ];
  function onSale(item) {
    var s = SEASONS[item.season], now = Date.now();
    return now >= s.starts && now < s.ends;
  }
  function upcoming(item) { return Date.now() < SEASONS[item.season].starts; }
  // The season on sale right now, or null once they've all ended.
  function currentSeason() {
    var now = Date.now();
    return SEASON_ORDER.filter(function (k) { return now >= SEASONS[k].starts && now < SEASONS[k].ends; })[0] || null;
  }
  // "6 days left", "Last day!", "Ends in 5 hours"... or, with `arriving`, "Arrives in 7 days".
  function timeUntil(when, arriving) {
    var ms = when - Date.now();
    var hours = Math.floor(ms / 3600000);
    if (arriving) {
      if (hours < 24) return 'Arrives in ' + plural(Math.max(1, hours), 'hour');
      return 'Arrives in ' + plural(Math.ceil(ms / 86400000), 'day');
    }
    if (hours < 1) return 'Ends in less than an hour!';
    if (hours < 24) return 'Ends in ' + plural(hours, 'hour') + '!';
    var days = Math.ceil(ms / 86400000);
    return days <= 1 ? 'Last day!' : plural(days, 'day') + ' left';
  }
  function shopItemFor(key, index) {
    return SHOP.filter(function (s) { return s.key === key && s.index === index; })[0] || null;
  }
  // The purchases you can see include items you gifted to friends: those count as spent, not owned.
  function ownsItem(item) {
    return state.purchases.some(function (p) { return p.item === item.id && (!p.owner || p.owner === me.id); });
  }
  // Stars earned: one per like on your portfolio and on your research, plus any gifted stars.
  function starsEarned() {
    if (!me) return 0;
    var mine = state.profiles.filter(function (p) { return p.ownerId === me.id; });
    var profileIds = mine.map(function (p) { return p.id; });
    var projectIds = [];
    mine.forEach(function (p) { p.projects.forEach(function (q) { projectIds.push(q.id); }); });
    return state.likes.filter(function (l) { return profileIds.indexOf(l.profileId) >= 0; }).length +
      state.projectLikes.filter(function (l) { return projectIds.indexOf(l.projectId) >= 0; }).length +
      state.giftStars + state.claims.length;
  }

  // ---- Daily star: one free star a day, with a streak for coming back day after day ----
  // Days are US Eastern days, the same as claim_daily_star() in supabase/more-features.sql.
  function dayKey(t) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));
  }
  function claimedToday() { return state.claims.indexOf(dayKey(Date.now())) >= 0; }
  // How many days in a row, ending today (or yesterday, if today isn't claimed yet).
  function streakDays() {
    var have = {};
    state.claims.forEach(function (d) { have[d] = true; });
    var n = 0;
    var t = Date.now();
    if (!have[dayKey(t)]) t -= 86400000;
    while (have[dayKey(t)]) { n++; t -= 86400000; }
    return n;
  }
  var claiming = false;
  function claimDailyStar() {
    if (!claimsReady || claiming || claimedToday()) return;
    claiming = true;
    renderShop();
    client.rpc('claim_daily_star').then(function (res) {
      claiming = false;
      if (res.error) { showToast(dbMessage(res.error)); renderShop(); return; }
      var today = res.data && res.data.day ? res.data.day : dayKey(Date.now());
      if (state.claims.indexOf(today) < 0) state.claims.push(today);
      showToast('+1 star! ' + (streakDays() > 1 ? streakDays() + '-day streak. ' : '') + 'Come back tomorrow for another.');
      renderCart();
      renderShop();
      refresh();
    });
  }
  function renderDailyStar() {
    var box = $('daily-star');
    box.hidden = !claimsReady;
    if (!claimsReady) return;
    box.textContent = '';
    var streak = streakDays();
    var text = make('div', 'daily-text');
    text.appendChild(make('span', 'daily-title', claimedToday() ? 'Daily star claimed' : 'Your daily star is ready!'));
    text.appendChild(make('span', 'daily-sub', streak
      ? plural(streak, 'day') + ' in a row' + (claimedToday() ? '. Come back tomorrow to keep it going.' : '. Claim today to keep it going.')
      : 'Claim a free star every day and build a streak.'));
    box.appendChild(make('span', 'daily-icon', '★'));
    box.appendChild(text);
    var b = make('button', 'btn btn-solid daily-claim', claimedToday() ? 'Claimed ✓' : claiming ? 'Claiming…' : 'Claim +1 ★');
    b.type = 'button';
    b.disabled = claimedToday() || claiming;
    b.addEventListener('click', claimDailyStar);
    box.appendChild(b);
  }
  // Spent: items you bought (for yourself or as gifts) and stars you gave to friends.
  function starBalance() {
    var spent = state.purchases.reduce(function (sum, p) {
      return sum + ((p.paidBy || p.owner || me.id) === me.id ? p.price : 0);
    }, 0);
    return Math.max(0, starsEarned() - spent - state.starsGiven);
  }
  var cartBtn = $('cart-btn');
  var shopDialog = $('shop-dialog');
  var shopOpener = null;
  var buying = null; // the item being bought
  function renderCart() {
    // Everyone signed in gets the cart; until the shop's database setup is run, buying is switched off.
    var show = !!client && !!me && loaded && !loadError;
    cartBtn.hidden = !show;
    if (!show) { shopDialog.hidden = true; return; }
    var stars = starBalance();
    $('cart-stars').textContent = '★' + stars;
    // A little dot on the cart when today's free star is waiting.
    var waiting = claimsReady && !claimedToday();
    cartBtn.classList.toggle('nudge', waiting);
    cartBtn.setAttribute('aria-label', 'Star Shop, ' + plural(stars, 'star') + ' to spend' + (waiting ? '. Your daily star is ready.' : ''));
    if (!shopDialog.hidden) renderShop();
  }
  function renderShop() {
    var stars = starBalance();
    $('shop-balance').textContent = '★ ' + stars;
    $('shop-balance-note').textContent = (stars === 1 ? 'star' : 'stars') + ' to spend';
    var season = currentSeason();
    $('shop-title').textContent = season ? 'Star Shop · ' + SEASONS[season].name : 'Star Shop';
    renderDailyStar();
    renderInventory();
    renderGiftBox();
    var gift = $('shop-gift');
    gift.hidden = !state.giftStars;
    // Gifts from the site (like the early tester gift) and from friends.
    var fromFriends = state.giftsReceived.reduce(function (sum, g) { return sum + g.stars; }, 0);
    function siteStars(prefix) {
      return state.siteGifts.filter(function (g) { return g.reason.indexOf(prefix) === 0; }).reduce(function (sum, g) { return sum + g.stars; }, 0);
    }
    var prizes = siteStars('challenge:'), fromOwner = siteStars('owner-gift:');
    var fromSite = state.giftStars - fromFriends - prizes - fromOwner;
    var parts = [];
    if (fromSite > 0) parts.push(plural(fromSite, 'early tester star'));
    if (prizes > 0) parts.push(prizes + ' from weekly challenges');
    if (fromOwner > 0) parts.push(fromOwner + ' from the site owner');
    if (fromFriends > 0) parts.push(fromFriends + ' from ' + giftSenders());
    if (parts.length > 1) parts = [parts.slice(0, -1).join(', '), parts[parts.length - 1]];
    gift.textContent = 'Includes ' + plural(state.giftStars, 'gifted star') + ': ' + parts.join(' and ') + '. Thank you!';
    $('shop-limited').classList.toggle('ended', !season);
    $('shop-limited-text').textContent = season
      ? 'The ' + SEASONS[season].name + ' items leave the shop on ' + SEASONS[season].last + ', ' + seasonYear(season) + '. ' + timeUntil(SEASONS[season].ends)
      : nextSeason()
        ? 'New ' + SEASONS[nextSeason()].name + ' items arrive on ' + SEASONS[nextSeason()].first + '. Anything you bought is still yours in Edit character.'
        : 'The seasonal items have left the shop. Anything you bought is still yours in Edit character.';
    var mp = myProfile();
    var base = normalizeCharacter(mp && mp.avatar ? mp.avatar.character : DEFAULT_CHAR);
    var friend = shopFor && areFriends(me.id, shopFor) ? shopFor : '';
    // On sale now, plus anything you own from a season that has ended.
    var list = $('shop-list');
    list.textContent = '';
    SHOP.filter(function (item) { return onSale(item) || (!upcoming(item) && ownsItem(item)); }).forEach(function (item) {
      list.appendChild(shopCard(item, base, stars, friend));
    });
    // Coming soon: the next seasons' items, to look at before they arrive.
    var soon = $('shop-upcoming');
    soon.textContent = '';
    // Only the next two seasons, so the shop doesn't get too long.
    SEASON_ORDER.filter(function (k) { return Date.now() < SEASONS[k].starts; }).slice(0, 2).forEach(function (k) {
      var head = make('div', 'shop-soon-head');
      head.appendChild(make('span', 'shop-soon-tag', 'Coming soon'));
      head.appendChild(make('h3', 'shop-soon-title', SEASONS[k].name + ' items · ' + SEASONS[k].first + ' to ' + SEASONS[k].last));
      head.appendChild(make('span', 'shop-soon-when', timeUntil(SEASONS[k].starts, true)));
      soon.appendChild(head);
      var grid = make('ul', 'shop-grid shop-soon-grid');
      SHOP.filter(function (item) { return item.season === k; }).forEach(function (item) {
        grid.appendChild(shopCard(item, base, stars, friend));
      });
      soon.appendChild(grid);
    });
  }
  // One item in the shop, with a preview of your own character wearing it.
  function shopCard(item, base, stars, friend) {
    var owned = ownsItem(item);
    var soon = upcoming(item);
    var li = make('li', 'shop-item' + (owned && !friend ? ' owned' : '') + (soon ? ' soon' : ''));
    var look = normalizeCharacter(base);
    look[item.key] = item.index;
    var pic = make('span', 'avatar shop-avatar' + (item.key === 'pet' ? ' shop-pet' : ''));
    // Pets aren't part of the character picture, so they're previewed on their own.
    pic.appendChild(item.key === 'pet' ? renderPet(look) : pictureNode({ mode: 'character', character: look }, item.name));
    li.appendChild(pic);
    li.appendChild(make('span', 'shop-kind', item.kind));
    li.appendChild(make('h3', 'shop-name', item.name));
    var from = giftedBy(item);
    if (from && !friend) li.appendChild(make('span', 'shop-from', 'Gift from ' + from));
    var b = make('button', 'btn ' + (owned && !friend ? 'btn-ghost' : 'btn-solid') + ' shop-buy');
    b.type = 'button';
    if (soon) {
      b.textContent = '★ ' + item.price + ' · ' + timeUntil(SEASONS[item.season].starts, true).replace('Arrives in', 'In');
      b.disabled = true;
    } else if (friend) {
      b.textContent = '★ ' + item.price + ' · Gift';
      b.disabled = !giftingReady || !onSale(item) || !!buying || stars < item.price;
      b.setAttribute('aria-label', 'Gift the ' + item.name.toLowerCase() + ' to ' + ownerName(friend) + ' for ' + plural(item.price, 'star'));
      if (stars < item.price) b.title = 'You need ' + plural(item.price - stars, 'more star');
      b.addEventListener('click', function () { giftItem(item, friend); });
    } else if (owned) {
      b.textContent = 'Owned · Wear it';
      b.addEventListener('click', function () { wearItem(item); });
    } else {
      b.textContent = '★ ' + item.price + ' · Buy';
      b.disabled = !shopReady || !onSale(item) || !!buying || stars < item.price;
      if (stars < item.price) b.title = 'You need ' + plural(item.price - stars, 'more star');
      b.addEventListener('click', function () { buyItem(item); });
    }
    li.appendChild(b);
    return li;
  }

  // ---- Gifts: buy an item for a friend, or send them some of your stars ----
  var giftingReady = false; // true once the database can record who paid for an item
  var shopFor = '';         // a friend's account id while shopping for them, '' for yourself
  function giftFriendIds() {
    var ids = {};
    state.profiles.forEach(function (p) { if (areFriends(me.id, p.ownerId)) ids[p.ownerId] = true; });
    return Object.keys(ids).sort(function (a, b) { return ownerName(a).localeCompare(ownerName(b)); });
  }
  // Who gave you an item, if it was a gift.
  function giftedBy(item) {
    var row = state.purchases.filter(function (p) { return p.item === item.id && p.owner === me.id && p.paidBy && p.paidBy !== me.id; })[0];
    return row ? ownerName(row.paidBy) || 'a friend' : '';
  }
  function giftSenders() {
    var names = {};
    state.giftsReceived.forEach(function (g) { var n = ownerName(g.from); if (n) names[n] = true; });
    var list = Object.keys(names);
    return list.length ? list.join(', ') : 'friends';
  }
  function renderGiftBox() {
    var box = $('shop-giftbox');
    var friends = giftingReady ? giftFriendIds() : [];
    if (shopFor && friends.indexOf(shopFor) < 0) shopFor = '';
    box.hidden = !friends.length;
    if (!friends.length) return;
    box.textContent = '';
    var row = make('div', 'giftbox-row');
    var label = make('label', 'giftbox-label', 'Shopping for');
    label.htmlFor = 'shop-for';
    row.appendChild(label);
    var select = make('select', 'giftbox-select');
    select.id = 'shop-for';
    var meOpt = make('option', null, 'Me');
    meOpt.value = '';
    select.appendChild(meOpt);
    friends.forEach(function (id) {
      var o = make('option', null, 'A gift for ' + ownerName(id));
      o.value = id;
      select.appendChild(o);
    });
    select.value = shopFor;
    select.addEventListener('change', function () {
      shopFor = select.value;
      $('shop-status').textContent = '';
      renderShop();
      $('shop-for').focus();
    });
    row.appendChild(select);
    box.appendChild(row);
    if (!shopFor) {
      box.appendChild(make('p', 'giftbox-note', 'Pick a friend to buy them an item or send them some of your stars.'));
      return;
    }
    box.appendChild(make('p', 'giftbox-note', 'Click Gift on any item below to send it to ' + ownerName(shopFor) + '. It goes straight into their inventory.'));
    var starsRow = make('form', 'giftbox-row giftbox-stars');
    var amountLabel = make('label', 'giftbox-label', 'Or send stars');
    amountLabel.htmlFor = 'gift-amount';
    starsRow.appendChild(amountLabel);
    var amount = make('input', 'giftbox-amount');
    amount.id = 'gift-amount';
    amount.type = 'number';
    amount.min = '1';
    amount.max = '50';
    amount.value = '1';
    amount.inputMode = 'numeric';
    starsRow.appendChild(amount);
    var send = make('button', 'mini-btn', 'Send ★');
    send.type = 'submit';
    send.disabled = !!buying || starBalance() < 1;
    starsRow.appendChild(send);
    starsRow.addEventListener('submit', function (e) {
      e.preventDefault();
      giftStars(shopFor, Math.floor(Number(amount.value)));
    });
    box.appendChild(starsRow);
  }
  function giftItem(item, friendId) {
    if (!giftingReady || !onSale(item) || buying || starBalance() < item.price) return;
    buying = item.id;
    $('shop-status').textContent = 'Sending the ' + item.name.toLowerCase() + ' to ' + ownerName(friendId) + '…';
    renderShop();
    client.rpc('gift_shop_item', { item_id: item.id, to_user: friendId }).then(function (res) {
      buying = null;
      if (res.error) {
        $('shop-status').textContent = res.error.message || dbMessage(res.error);
      } else {
        state.purchases.push({ item: item.id, price: item.price, owner: friendId, paidBy: me.id });
        $('shop-status').textContent = 'You gifted the ' + item.name.toLowerCase() + ' to ' + ownerName(friendId) + '!';
        renderCart();
        refresh();
      }
      renderShop();
    });
  }
  function giftStars(friendId, amount) {
    if (!giftingReady || buying) return;
    if (!(amount >= 1 && amount <= 50)) { $('shop-status').textContent = 'You can send 1 to 50 stars at a time.'; return; }
    if (amount > starBalance()) { $('shop-status').textContent = 'You don’t have that many stars yet.'; return; }
    buying = 'stars';
    $('shop-status').textContent = 'Sending ' + plural(amount, 'star') + '…';
    renderShop();
    client.rpc('gift_stars', { to_user: friendId, amount: amount }).then(function (res) {
      buying = null;
      if (res.error) {
        $('shop-status').textContent = res.error.message || dbMessage(res.error);
      } else {
        state.starsGiven += amount;
        $('shop-status').textContent = 'You sent ' + plural(amount, 'star') + ' to ' + ownerName(friendId) + '!';
        renderCart();
        refresh();
      }
      renderShop();
    });
  }
  // Your inventory at the top of the shop: everything you've bought, each with a Wear it button.
  function renderInventory() {
    var box = $('shop-inventory');
    var list = $('shop-inventory-list');
    var owned = SHOP.filter(ownsItem);
    box.hidden = !owned.length;
    list.textContent = '';
    owned.forEach(function (item) {
      var li = make('li', 'inventory-item');
      if (item.key === 'hairColor' || item.key === 'top') {
        var dot = make('span', 'inventory-dot');
        dot.style.background = CHAR[item.key][item.index];
        li.appendChild(dot);
      }
      li.appendChild(make('span', 'inventory-name', item.name));
      var wear = make('button', 'mini-btn', 'Wear it');
      wear.type = 'button';
      wear.setAttribute('aria-label', 'Wear the ' + item.name.toLowerCase());
      wear.addEventListener('click', function () { wearItem(item); });
      li.appendChild(wear);
      list.appendChild(li);
    });
  }
  // Opens Edit character on your portfolio with the item already picked, ready to save.
  function wearItem(item) {
    var mp = myProfile();
    if (!mp) { showToast('Make your portfolio first, then you can wear your items.'); return; }
    closeShop();
    if (currentId !== mp.id) showProfile(mp.id, true);
    if (picForm.hidden) picBtn.click();
    picDraft.character[item.key] = item.index;
    var isPet = item.key === 'pet';
    picTab = isPet ? 'pets' : 'character';
    buildPicForm(null);
    var label = $('pic-label-' + item.key);
    if (label) label.parentNode.scrollIntoView({ block: 'center' });
    showToast((isPet ? 'Your ' + item.name.toLowerCase() + ' is here. ' : 'Wearing the ' + item.name.toLowerCase() + '. ') +
      'Click Save character to keep it.');
  }
  function buyItem(item) {
    if (!shopReady || !onSale(item) || buying || starBalance() < item.price) return;
    buying = item.id;
    $('shop-status').textContent = 'Buying ' + item.name + '…';
    renderShop();
    client.rpc('buy_shop_item', { item_id: item.id }).then(function (res) {
      buying = null;
      if (res.error) {
        $('shop-status').textContent = res.error.message || dbMessage(res.error);
        renderShop();
        return;
      }
      if (!ownsItem(item)) state.purchases.push({ item: item.id, price: item.price, owner: me.id, paidBy: me.id });
      $('shop-status').textContent = 'You bought the ' + item.name.toLowerCase() + '! It’s in Your items at the top. Click Wear it to put it on.';
      renderCart();
      renderShop();
      if (!picForm.hidden) buildPicForm(null);
      refresh();
    });
  }
  function openShop() {
    shopOpener = document.activeElement;
    closeNotifs();
    $('shop-status').textContent = shopReady ? '' : 'The Star Shop is opening soon. You can look around, and buying will switch on shortly.';
    renderShop();
    shopDialog.hidden = false;
    $('shop-close').focus();
  }
  function closeShop() {
    shopDialog.hidden = true;
    if (shopOpener && shopOpener.focus) shopOpener.focus();
  }
  cartBtn.addEventListener('click', openShop);
  $('shop-close').addEventListener('click', closeShop);
  shopDialog.addEventListener('click', function (e) { if (e.target === shopDialog) closeShop(); });

  // Taking an item off goes back to what your saved character had there, or to "none" for
  // headwear, frames and pets (other spots use the starting look).
  var NONE_VALUE = { headwear: 0, frame: 0, pet: 0, glasses: 0 };
  function takeOffValue(item) {
    var p = current();
    var saved = p && p.avatar ? normalizeCharacter(p.avatar.character)[item.key] : null;
    if (saved !== null && saved !== item.index) return saved;
    return item.key in NONE_VALUE ? NONE_VALUE[item.key] : DEFAULT_CHAR[item.key];
  }
  // The Inventory tab of the customizer: every Star Shop item you own, with Wear / Take off.
  function inventoryGrid() {
    var owned = SHOP.filter(ownsItem);
    var box = make('div', 'inv-tab');
    if (!owned.length) {
      box.appendChild(make('p', 'followers-empty', 'Nothing here yet. Buy items in the Star Shop with your stars and they’ll show up here.'));
      var go = make('button', 'mini-btn', 'Open the Star Shop');
      go.type = 'button';
      go.addEventListener('click', openShop);
      box.appendChild(go);
      return box;
    }
    var list = make('ul', 'inv-grid');
    owned.forEach(function (item) {
      var wearing = picDraft.character[item.key] === item.index;
      var li = make('li', 'inv-card' + (wearing ? ' wearing' : ''));
      var look = normalizeCharacter(picDraft.character);
      look[item.key] = item.index;
      var pic = make('span', 'avatar inv-pic' + (item.key === 'pet' ? ' shop-pet' : ''));
      pic.appendChild(item.key === 'pet' ? renderPet(look) : pictureNode({ mode: 'character', character: look }, item.name));
      li.appendChild(pic);
      li.appendChild(make('span', 'shop-kind', item.kind));
      li.appendChild(make('span', 'inv-name', item.name));
      var b = make('button', 'mini-btn' + (wearing ? ' inv-on' : ''), wearing ? 'Wearing ✓ · Take off' : 'Wear');
      b.type = 'button';
      b.setAttribute('aria-pressed', wearing ? 'true' : 'false');
      b.setAttribute('aria-label', (wearing ? 'Take off the ' : 'Wear the ') + item.name.toLowerCase());
      b.addEventListener('click', function () {
        picDraft.character[item.key] = wearing ? takeOffValue(item) : item.index;
        buildPicForm('inv-' + item.id);
      });
      b.id = 'inv-' + item.id;
      li.appendChild(b);
      list.appendChild(li);
    });
    box.appendChild(list);
    return box;
  }

  // The customizer has tabs: Character (everything without a 4th entry above), Pets, and Inventory.
  var PIC_TABS = [['character', 'Character'], ['pets', 'Pets'], ['inventory', 'Inventory']];
  var picTab = 'character';
  function groupTab(g) { return g[3] || 'character'; }

  function paintPortrait(avatar, name) {
    portrait.textContent = '';
    var pic = pictureNode(avatar, name);
    if (pic) portrait.appendChild(pic);
    portrait.hidden = !pic;
    profileArt.classList.toggle('has-portrait', !!pic);
    paintScene(avatar ? avatar.character.scene : 0);
    // The pet sits on the clouds beside the character, with its name underneath.
    var oldPet = profileArt.querySelector('.portfolio-pet');
    if (oldPet) oldPet.remove();
    var oldTag = profileArt.querySelector('.pet-name-tag');
    if (oldTag) oldTag.remove();
    if (avatar && avatar.character.pet) {
      var petPic = renderPet(avatar.character);
      var petLabel = (avatar.petName ? avatar.petName + ' the ' : 'Pet ') + CHAR.pet[avatar.character.pet].toLowerCase();
      // Click the pet (or press Enter on it) for a trick.
      petPic.setAttribute('role', 'button');
      petPic.setAttribute('tabindex', '0');
      petPic.setAttribute('aria-label', petLabel + '. Click for a trick!');
      petPic.addEventListener('click', function () { petTrick(petPic); });
      petPic.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); petTrick(petPic); }
      });
      profileArt.appendChild(petPic);
      if (avatar.petName) profileArt.appendChild(make('span', 'pet-name-tag', avatar.petName));
    }
  }
  // Pet tricks: a hop, a spin, a wiggle or a flip, with little hearts floating up.
  var TRICKS = ['hop', 'spin', 'wiggle', 'flip'];
  var lastTrick = '';
  function petTrick(pet) {
    if (pet.classList.contains('tricking')) return;
    var choices = TRICKS.filter(function (t) { return t !== lastTrick; });
    var trick = choices[Math.floor(Math.random() * choices.length)];
    lastTrick = trick;
    pet.classList.add('tricking', 'trick-' + trick);
    var stop = function () { pet.classList.remove('tricking', 'trick-' + trick); };
    pet.addEventListener('animationend', stop, { once: true });
    setTimeout(stop, 1200); // in case animations are off
    var art = pet.parentNode;
    var box = pet.getBoundingClientRect(), artBox = art.getBoundingClientRect();
    for (var i = 0; i < 3; i++) {
      var h = make('span', 'trick-heart', '♥');
      h.setAttribute('aria-hidden', 'true');
      h.style.left = (box.left - artBox.left + box.width * (0.2 + 0.3 * i)) + 'px';
      h.style.top = (box.top - artBox.top + box.height * 0.1) + 'px';
      h.style.animationDelay = (i * 0.12) + 's';
      art.appendChild(h);
      setTimeout(function (el) { el.remove(); }.bind(null, h), 1400);
    }
  }
  function draftAvatar() {
    return { mode: 'character', character: picDraft.character, petName: (picDraft.petName || '').trim().slice(0, 20) };
  }

  // ---- Portfolio scenes: what the character stands on and what's behind it ----
  // 0 Books (the scene in index.html), 1 Library, 2 Night sky, 3 Garden.
  var SCENE_CLASS = ['', 'scene-library', 'scene-night', 'scene-garden'];
  var bookScene = profileArt.querySelector('.book-scene');
  function sceneSvg(viewBox, cls) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', viewBox);
    s.setAttribute('class', cls);
    s.setAttribute('aria-hidden', 'true');
    return s;
  }
  function paintScene(scene) {
    SCENE_CLASS.forEach(function (c) { if (c) profileArt.classList.remove(c); });
    var oldBack = profileArt.querySelector('.scene-backdrop');
    if (oldBack) oldBack.remove();
    var oldGround = bookScene.querySelector('.scene-ground');
    if (oldGround) oldGround.remove();
    if (!SCENE_CLASS[scene]) return;
    profileArt.classList.add(SCENE_CLASS[scene]);
    var back = sceneSvg('0 0 200 200', 'scene-backdrop');
    back.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    var ground = document.createElementNS(SVG_NS, 'g');
    ground.setAttribute('class', 'scene-ground');
    function to(parent) {
      return function (tag, attrs) {
        var n = document.createElementNS(SVG_NS, tag);
        for (var k in attrs) n.setAttribute(k, attrs[k]);
        parent.appendChild(n);
        return n;
      };
    }
    var b = to(back), g = to(ground);
    if (scene === 1) { // Library: shelves of books behind, a comfy reading pouf to sit on
      var spines = ['#D2728F', '#B9A6E8', '#F4D35E', '#8EC5E8', '#9BD3AE', '#F29E4C', '#E58FA8'];
      [[24, 62], [86, 124]].forEach(function (shelf, row) {
        var x = 4, n = row * 3;
        while (x < 196) {
          var w = 7 + (n * 7) % 5, h = 30 + (n * 11) % 9;
          b('rect', { x: x, y: shelf[1] - h, width: w, height: h, rx: 1.2, fill: spines[n % spines.length], opacity: 0.55 });
          b('rect', { x: x + 1.5, y: shelf[1] - h + 5, width: w - 3, height: 1.4, fill: '#FFFFFF', opacity: 0.45 });
          x += w + 1.2 + (n % 4 === 3 ? 6 : 0);
          n++;
        }
        b('rect', { x: 0, y: shelf[1], width: 200, height: 5, fill: '#C9A27A', opacity: 0.8 });
      });
      g('ellipse', { cx: 100, cy: 66, rx: 46, ry: 4, fill: 'rgba(110, 70, 48, 0.18)' });
      g('path', { d: 'M56 42 Q56 64 66 66 L134 66 Q144 64 144 42 Z', fill: '#B9A6E8' });
      g('ellipse', { cx: 100, cy: 42, rx: 44, ry: 9, fill: '#CDBDF2' });
      g('path', { d: 'M70 47 Q100 53 130 47', fill: 'none', stroke: '#9A86CF', 'stroke-width': 1.4, 'stroke-linecap': 'round' });
      [78, 100, 122].forEach(function (x) { g('circle', { cx: x, cy: 57, r: 1.6, fill: '#9A86CF' }); });
    } else if (scene === 2) { // Night sky: a moon and stars, and a crescent moon to sit in
      b('circle', { cx: 162, cy: 36, r: 15, fill: '#F6E08E' });
      b('circle', { cx: 169, cy: 31, r: 13, fill: '#2E2856' });
      [[20, 30, 1.6], [48, 18, 1.1], [80, 40, 1.3], [118, 14, 1.6], [140, 66, 1.1], [30, 80, 1.2], [186, 92, 1.4], [12, 120, 1.1], [104, 26, 0.9], [60, 60, 0.9]].forEach(function (s, i) {
        b('circle', { cx: s[0], cy: s[1], r: s[2], fill: '#FFF6D6', class: 'night-star' + (i % 3 ? '' : ' twinkle') });
      });
      g('path', { d: 'M46 34 Q100 92 154 34 Q100 66 46 34 Z', fill: '#F6E08E', stroke: '#E0B53C', 'stroke-width': 1.2, 'stroke-linejoin': 'round' });
      g('circle', { cx: 80, cy: 52, r: 2.4, fill: '#E8CB66' });
      g('circle', { cx: 116, cy: 55, r: 1.8, fill: '#E8CB66' });
    } else if (scene === 3) { // Garden: a sun, a little fence and flowers, and a grassy hill
      b('circle', { cx: 166, cy: 34, r: 14, fill: '#F6C945', opacity: 0.85 });
      for (var fx2 = 4; fx2 < 200; fx2 += 14) {
        b('path', { d: 'M' + fx2 + ' 150 L' + fx2 + ' 124 L' + (fx2 + 4) + ' 119 L' + (fx2 + 8) + ' 124 L' + (fx2 + 8) + ' 150 Z', fill: '#FFFDF7', opacity: 0.85 });
      }
      b('rect', { x: 0, y: 130, width: 200, height: 4, fill: '#FFFDF7', opacity: 0.85 });
      g('path', { d: 'M28 70 Q100 18 172 70 Z', fill: '#7BB37A' });
      g('path', { d: 'M48 54 Q100 22 152 54', fill: 'none', stroke: '#9BD3AE', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.7 });
      [[44, 60, '#F7A8C0'], [62, 48, '#FFFFFF'], [140, 50, '#F4D35E'], [156, 61, '#B9A6E8'], [12, 60, '#F7A8C0'], [190, 58, '#F4D35E']].forEach(function (f) {
        g('path', { d: 'M' + f[0] + ' ' + f[1] + ' L' + f[0] + ' ' + (f[1] + 7), stroke: '#5E9B5B', 'stroke-width': 1.2 });
        for (var p = 0; p < 5; p++) {
          var a = Math.PI * 2 / 5 * p;
          g('circle', { cx: (f[0] + Math.cos(a) * 2.4).toFixed(1), cy: (f[1] + Math.sin(a) * 2.4).toFixed(1), r: 2, fill: f[2] });
        }
        g('circle', { cx: f[0], cy: f[1], r: 1.3, fill: '#F29E4C' });
      });
    }
    profileArt.insertBefore(back, profileArt.firstChild);
    bookScene.insertBefore(ground, bookScene.querySelector('.scene-spark'));
  }
  function closePicEditor() {
    picForm.hidden = true;
    picForm.textContent = '';
    picDraft = null;
    profileArt.classList.remove('pet-mode');
  }
  picBtn.addEventListener('click', function () {
    var a = current().avatar;
    picDraft = { character: normalizeCharacter(a ? a.character : DEFAULT_CHAR), petName: a ? a.petName : '' };
    editBtn.hidden = true;
    picBtn.hidden = true;
    picTab = 'character';
    buildPicForm(null);
    picForm.hidden = false;
  });

  // The character builder: pick each feature and watch the preview (and the portrait on the tracks) update.
  function buildPicForm(focusId) {
    var p = current();
    picForm.textContent = '';
    var onPets = picTab === 'pets';
    // On the Pets tab the portfolio scene shows just the pet, bigger, in its bed.
    profileArt.classList.toggle('pet-mode', onPets);

    // Tabs: Character, then Pets.
    var tabs = make('div', 'card-tabs pic-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Customize');
    var ownedCount = SHOP.filter(ownsItem).length;
    PIC_TABS.forEach(function (t) {
      var b = make('button', 'card-tab', t[0] === 'inventory' && ownedCount ? t[1] + ' (' + ownedCount + ')' : t[1]);
      b.type = 'button';
      b.id = 'pic-tab-' + t[0];
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', picTab === t[0] ? 'true' : 'false');
      b.tabIndex = picTab === t[0] ? 0 : -1;
      b.addEventListener('click', function () {
        if (picTab === t[0]) return;
        picTab = t[0];
        buildPicForm('pic-tab-' + t[0]);
      });
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var at = PIC_TABS.map(function (x) { return x[0]; }).indexOf(picTab);
        var step = e.key === 'ArrowRight' ? 1 : PIC_TABS.length - 1;
        picTab = PIC_TABS[(at + step) % PIC_TABS.length][0];
        buildPicForm('pic-tab-' + picTab);
      });
      tabs.appendChild(b);
    });
    picForm.appendChild(tabs);

    var top = make('div', 'pic-top');
    var preview = make('div', 'pic-preview' + (onPets ? ' pet-preview' : ''));
    function updatePreview() {
      preview.textContent = '';
      if (onPets) {
        // The Pets tab previews the pet on its own; the portfolio scene shows it beside the character.
        if (picDraft.character.pet) preview.appendChild(renderPet(picDraft.character));
        else preview.appendChild(make('span', 'pet-none', 'No pet'));
      } else {
        preview.appendChild(pictureNode(draftAvatar(), p.name));
      }
      paintPortrait(draftAvatar(), p.name);
    }
    top.appendChild(preview);
    top.appendChild(make('p', 'pic-note', onPets
      ? 'Pick a pet. It sits beside your character on your portfolio.'
      : picTab === 'inventory'
        ? 'Everything you’ve bought from the Star Shop. Wear anything, then save.'
        : 'Build your character. Everyone who visits the site can see it.'));
    picForm.appendChild(top);
    if (picTab === 'inventory') picForm.appendChild(inventoryGrid());

    var statusEl = statusLine('');
    PIC_GROUPS.filter(function (g) { return groupTab(g) === picTab; }).forEach(function (g) {
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
        // Pets stay locked until their task is done (the one you already have stays picked).
        var goal = key === 'pet' ? petProgress(p, i) : null;
        if (goal && !goal.unlocked && picDraft.character.pet !== i) {
          b.disabled = true;
          b.classList.add('locked');
          b.insertBefore(lockIcon(), b.firstChild);
          b.title = 'Locked: ' + goal.task;
          b.setAttribute('aria-label', value + ', locked. ' + goal.task + '.');
        }
        // Star Shop items stay locked until bought (one you're already wearing stays picked).
        if (isRetired(key, i)) return; // removed options aren't offered
        // Seasonal items you didn't buy only show here while they're on sale.
        var shopItem = shopItemFor(key, i);
        if (shopItem && !ownsItem(shopItem) && picDraft.character[key] !== i && !onSale(shopItem)) return;
        if (shopItem && !ownsItem(shopItem) && picDraft.character[key] !== i) {
          b.disabled = true;
          b.classList.add('locked', 'shop-locked');
          if (g[2] === 'chip') {
            b.insertBefore(lockIcon(), b.firstChild);
            b.appendChild(make('span', 'chip-price', '★' + shopItem.price));
          } else {
            b.appendChild(lockIcon());
          }
          b.title = 'Buy in the Star Shop for ' + plural(shopItem.price, 'star');
          b.setAttribute('aria-label', shopItem.name + ', locked. Buy it in the Star Shop for ' + plural(shopItem.price, 'star') + '.');
        } else if (shopItem && ownsItem(shopItem)) {
          // Bought from the Star Shop: marked with a gold star so it's easy to find.
          b.classList.add('shop-owned');
          b.appendChild(make('span', 'owned-mark', '★'));
          b.title = shopItem.name + ' (from the Star Shop)';
          b.setAttribute('aria-label', shopItem.name + ', from the Star Shop');
        }
        b.setAttribute('aria-pressed', picDraft.character[key] === i ? 'true' : 'false');
        b.dataset.option = i; // the option's number (some options can be left out, so it isn't always the button's position)
        b.addEventListener('click', function () {
          picDraft.character[key] = i;
          Array.prototype.forEach.call(chips.children, function (x) {
            x.setAttribute('aria-pressed', Number(x.dataset.option) === i ? 'true' : 'false');
          });
          updatePreview();
        });
        chips.appendChild(b);
      });
      group.appendChild(label);
      group.appendChild(chips);
      picForm.appendChild(group);
    });
    if (onPets) {
      // A name for your pet, shown under it on your portfolio.
      var nameGroup = make('div', 'option-group');
      var nameLabel = make('label', 'edit-label', 'Pet name');
      nameLabel.htmlFor = 'pet-name-input';
      var nameInput = make('input', 'pet-name-input');
      nameInput.id = 'pet-name-input';
      nameInput.type = 'text';
      nameInput.maxLength = 20;
      nameInput.placeholder = 'Give your pet a name';
      nameInput.autocomplete = 'off';
      nameInput.value = picDraft.petName || '';
      nameInput.addEventListener('input', function () {
        picDraft.petName = nameInput.value;
        paintPortrait(draftAvatar(), p.name);
      });
      nameGroup.appendChild(nameLabel);
      nameGroup.appendChild(nameInput);
      picForm.appendChild(nameGroup);
      picForm.appendChild(petGoalsList(p));
    }
    var shuffle = make('button', 'mini-btn add-source', 'Shuffle');
    shuffle.hidden = picTab === 'inventory';
    shuffle.type = 'button';
    shuffle.id = 'pic-shuffle';
    shuffle.style.justifySelf = 'start';
    // Shuffle only what's on this tab, and only pets you've unlocked.
    shuffle.addEventListener('click', function () {
      PIC_GROUPS.filter(function (g) { return groupTab(g) === picTab; }).forEach(function (g) {
        var choices = CHAR[g[1]].map(function (_, i) { return i; });
        if (g[1] === 'pet') choices = choices.filter(function (i) { return !PET_UNLOCKS[i] || petProgress(p, i).unlocked; });
        choices = choices.filter(function (i) { var s = shopItemFor(g[1], i); return !isRetired(g[1], i) && (!s || ownsItem(s)); });
        picDraft.character[g[1]] = choices[Math.floor(Math.random() * choices.length)];
      });
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

  // Small pieces shared by research cards: the cover picture, topic tags, and "1 min read · Updated 2 days ago".
  function projectImage(q) {
    var src = cleanLink(q.image);
    if (!src) return null;
    var img = make('img', 'project-image');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', function () { img.remove(); });
    return img;
  }
  function tagChips(q) {
    if (!q.tags.length) return null;
    var row = make('div', 'tag-row');
    q.tags.forEach(function (t) { row.appendChild(make('span', 'tag-chip', t)); });
    return row;
  }
  function readMinutes(q) {
    var text = q.title + ' ' + q.description + ' ' + q.sources.map(function (s) { return s.name; }).join(' ');
    var words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }
  function projectMeta(q) {
    var edited = q.updatedAt > q.createdAt + 60000;
    var line = make('p', 'project-meta', readMinutes(q) + ' min read · ' +
      (edited ? 'Updated ' : 'Posted ') + timeAgo(edited ? q.updatedAt : q.createdAt).toLowerCase());
    line.title = (edited ? 'Updated ' : 'Posted ') + exactTime(edited ? q.updatedAt : q.createdAt);
    return line;
  }
  // "In progress" or "Finished" on a research card.
  function statusTag(q) {
    if (!q.status) return null;
    return make('span', 'status-tag ' + q.status, q.status === 'finished' ? 'Finished ✓' : 'In progress');
  }
  // The research outline: these headings get their own line when a description uses them.
  var OUTLINE = ['Question', 'What I expected', 'How I found out', 'What I learned'];
  function outlineHeading(line) {
    for (var i = 0; i < OUTLINE.length; i++) {
      if (line.toLowerCase().indexOf(OUTLINE[i].toLowerCase() + ':') === 0) return OUTLINE[i];
    }
    return '';
  }
  function descriptionNode(text) {
    var lines = text.split('\n');
    if (!lines.some(outlineHeading)) return make('p', 'project-desc', text);
    var box = make('div', 'project-desc outline');
    lines.forEach(function (line) {
      var h = outlineHeading(line);
      if (h) {
        box.appendChild(make('span', 'outline-head', h));
        var rest = line.slice(h.length + 1).trim();
        if (rest) box.appendChild(make('p', 'outline-text', rest));
      } else if (line.trim()) {
        box.appendChild(make('p', 'outline-text', line.trim()));
      }
    });
    return box;
  }

  // ---- Citations: a source written out in MLA and APA style ----
  var citeOpen = {}; // "researchId:sourceIndex" -> its citation is showing
  var MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  function citations(s, href) {
    var site = hostOf(href);
    var name = (s.name || site).replace(/\.$/, '');
    var d = new Date();
    var mla = '“' + name + '.” ' + site + ', ' + href + '. Accessed ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + '.';
    var apa = name + '. (n.d.). ' + site + '. ' + href;
    return [['MLA', mla], ['APA', apa]];
  }
  function citationBox(s, href) {
    var box = make('div', 'cite-box');
    citations(s, href).forEach(function (c) {
      var row = make('div', 'cite-row');
      row.appendChild(make('span', 'cite-style', c[0]));
      row.appendChild(make('span', 'cite-text', c[1]));
      var copy = make('button', 'mini-btn', 'Copy');
      copy.type = 'button';
      copy.setAttribute('aria-label', 'Copy the ' + c[0] + ' citation');
      copy.addEventListener('click', function () {
        var done = function () { copy.textContent = 'Copied ✓'; };
        if (navigator.clipboard) navigator.clipboard.writeText(c[1]).then(done, function () { window.prompt('Copy this citation:', c[1]); });
        else window.prompt('Copy this citation:', c[1]);
      });
      row.appendChild(copy);
      box.appendChild(row);
    });
    box.appendChild(make('p', 'cite-note', 'If you know the author or the date it was written, add them in.'));
    return box;
  }

  // ---- Polls: one quick question on a research card, with results as a bar chart ----
  var pollEditing = {};  // research id -> the "add a poll" form is open
  var voting = null;
  function pollBlock(q, mineToEdit) {
    if (!pollsReady) return null;
    var poll = state.polls[q.id];
    if (!poll) {
      if (!mineToEdit) return null;
      if (!pollEditing[q.id]) {
        var add = make('button', 'link-btn poll-add', '+ Add a quick poll');
        add.type = 'button';
        add.title = 'Ask visitors a question and see the answers as a chart';
        add.addEventListener('click', function () { pollEditing[q.id] = true; renderProjects(); var f = $('poll-q-' + q.id); if (f) f.focus(); });
        return add;
      }
      return pollForm(q);
    }
    var box = make('div', 'poll');
    box.appendChild(make('p', 'poll-question', poll.question));
    var votes = state.votes.filter(function (v) { return v.projectId === q.id; });
    var mineVote = me ? votes.filter(function (v) { return v.userId === me.id; })[0] : null;
    var showResults = !!mineVote || mineToEdit || !me;
    poll.options.forEach(function (opt, i) {
      var count = votes.filter(function (v) { return v.choice === i; }).length;
      var pct = votes.length ? Math.round(count / votes.length * 100) : 0;
      if (showResults) {
        var row = make('div', 'poll-result' + (mineVote && mineVote.choice === i ? ' mine' : ''));
        var bar = make('span', 'poll-bar');
        bar.style.width = pct + '%';
        row.appendChild(bar);
        row.appendChild(make('span', 'poll-option', opt + (mineVote && mineVote.choice === i ? ' ✓' : '')));
        row.appendChild(make('span', 'poll-pct', pct + '%'));
        box.appendChild(row);
      } else {
        var b = make('button', 'poll-choice', opt);
        b.type = 'button';
        b.disabled = voting === q.id;
        b.addEventListener('click', function () { vote(q, i); });
        box.appendChild(b);
      }
    });
    var foot = make('div', 'poll-foot');
    foot.appendChild(make('span', 'poll-count', plural(votes.length, 'vote') + (!me ? ' · Sign in to vote' : '')));
    if (mineVote) {
      var change = make('button', 'link-btn', 'Change my vote');
      change.type = 'button';
      change.addEventListener('click', function () { unvote(q); });
      foot.appendChild(change);
    }
    if (mineToEdit) {
      var remove = make('button', 'link-btn', 'Remove poll');
      remove.type = 'button';
      remove.addEventListener('click', function () {
        if (!window.confirm('Remove this poll and all its votes?')) return;
        client.from('polls').delete().eq('project_id', q.id).then(function (res) {
          if (res.error) { showToast(dbMessage(res.error)); return; }
          delete state.polls[q.id];
          renderProjects();
          refresh();
        });
      });
      foot.appendChild(remove);
    }
    box.appendChild(foot);
    return box;
  }
  function pollForm(q) {
    var f = make('form', 'poll-form');
    var qLabel = make('label', 'edit-label', 'Poll question');
    qLabel.htmlFor = 'poll-q-' + q.id;
    var question = make('input');
    question.id = 'poll-q-' + q.id;
    question.type = 'text';
    question.maxLength = 120;
    question.placeholder = 'For example: How much sleep do you usually get?';
    f.appendChild(qLabel);
    f.appendChild(question);
    f.appendChild(make('span', 'edit-label', 'Answers (2 to 6)'));
    var inputs = [];
    for (var i = 0; i < 4; i++) {
      var o = make('input', 'poll-option-input');
      o.type = 'text';
      o.maxLength = 60;
      o.placeholder = ['Less than 7 hours', '7 to 8 hours', 'More than 8 hours', 'Another answer (optional)'][i];
      o.setAttribute('aria-label', 'Answer ' + (i + 1));
      inputs.push(o);
      f.appendChild(o);
    }
    var more = make('button', 'link-btn', '+ Another answer');
    more.type = 'button';
    more.addEventListener('click', function () {
      if (inputs.length >= 6) return;
      var o = make('input', 'poll-option-input');
      o.type = 'text';
      o.maxLength = 60;
      o.setAttribute('aria-label', 'Answer ' + (inputs.length + 1));
      inputs.push(o);
      f.insertBefore(o, more);
      o.focus();
      if (inputs.length >= 6) more.hidden = true;
    });
    f.appendChild(more);
    var actions = make('div', 'edit-actions');
    var save = make('button', 'btn btn-solid', 'Add poll');
    save.type = 'submit';
    var cancel = make('button', 'btn btn-ghost', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', function () { pollEditing[q.id] = false; renderProjects(); });
    actions.appendChild(save);
    actions.appendChild(cancel);
    f.appendChild(actions);
    var statusEl = statusLine('');
    f.appendChild(statusEl);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = question.value.trim();
      var options = inputs.map(function (x) { return x.value.trim(); }).filter(Boolean);
      if (!text) { statusEl.textContent = 'Write a question first.'; question.focus(); return; }
      if (options.length < 2) { statusEl.textContent = 'Add at least 2 answers.'; return; }
      if (unkind(text + ' ' + options.join(' '))) { statusEl.textContent = KIND_NOTE; return; }
      save.disabled = true;
      statusEl.textContent = 'Saving…';
      client.from('polls').insert({ project_id: q.id, question: text, options: options }).then(function (res) {
        save.disabled = false;
        if (res.error) { statusEl.textContent = dbMessage(res.error); return; }
        state.polls[q.id] = { question: text, options: options };
        pollEditing[q.id] = false;
        renderProjects();
        refresh();
      });
    });
    return f;
  }
  function vote(q, choice) {
    if (!me) { openAuth('signin', 'Sign in to vote.'); return; }
    if (voting) return;
    voting = q.id;
    renderProjects();
    client.from('poll_votes').insert({ project_id: q.id, choice: choice }).then(function (res) {
      voting = null;
      if (res.error && res.error.code !== '23505') showToast(dbMessage(res.error));
      else if (!res.error) state.votes.push({ projectId: q.id, userId: me.id, choice: choice, at: Date.now() });
      renderProjects();
    });
  }
  function unvote(q) {
    client.from('poll_votes').delete().eq('project_id', q.id).eq('user_id', me.id).then(function (res) {
      if (res.error) { showToast(dbMessage(res.error)); return; }
      state.votes = state.votes.filter(function (v) { return !(v.projectId === q.id && v.userId === me.id); });
      renderProjects();
    });
  }

  // ---- Print: a clean page with just one research card, for printing or saving as a PDF ----
  function printResearch(q) {
    var owner = findProfile(q.profileId);
    var old = $('print-sheet');
    if (old) old.remove();
    var sheet = make('article', 'print-sheet');
    sheet.id = 'print-sheet';
    sheet.appendChild(make('p', 'print-site', state.hubName));
    sheet.appendChild(make('h1', null, q.title));
    sheet.appendChild(make('p', 'print-by', 'By ' + (owner ? owner.name : 'a Dollar Search member') +
      ' · ' + new Date(q.updatedAt || q.createdAt).toLocaleDateString(undefined, { dateStyle: 'long' }) +
      (q.status ? ' · ' + (q.status === 'finished' ? 'Finished' : 'In progress') : '') +
      (q.tags.length ? ' · ' + q.tags.join(', ') : '')));
    sheet.appendChild(descriptionNode(q.description));
    var href = cleanLink(q.link);
    if (href) sheet.appendChild(make('p', 'print-link', 'Link: ' + href));
    var poll = pollsReady && state.polls[q.id];
    if (poll) {
      var votes = state.votes.filter(function (v) { return v.projectId === q.id; });
      sheet.appendChild(make('h2', null, 'Poll: ' + poll.question));
      var ul = make('ul');
      poll.options.forEach(function (opt, i) {
        var n = votes.filter(function (v) { return v.choice === i; }).length;
        ul.appendChild(make('li', null, opt + ': ' + plural(n, 'vote') + (votes.length ? ' (' + Math.round(n / votes.length * 100) + '%)' : '')));
      });
      sheet.appendChild(ul);
    }
    if (q.sources.length) {
      sheet.appendChild(make('h2', null, 'Sources'));
      var ol = make('ol');
      q.sources.forEach(function (s) {
        var sHref = cleanLink(s.link);
        if (sHref) ol.appendChild(make('li', null, citations(s, sHref)[0][1]));
      });
      sheet.appendChild(ol);
    }
    document.body.appendChild(sheet);
    document.body.classList.add('printing');
    var done = function () {
      document.body.classList.remove('printing');
      sheet.remove();
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  }

  function isPinned(q) {
    var owner = findProfile(q.profileId);
    return !!owner && owner.pinnedProject === q.id;
  }
  // The owner can pin one research card to the top of their portfolio.
  function togglePin(q) {
    var owner = findProfile(q.profileId);
    if (!owner || !canEdit(owner) || !extrasReady) return;
    var next = owner.pinnedProject === q.id ? null : q.id;
    owner.pinnedProject = next;
    renderProjects();
    client.from('profiles').update({ pinned_project: next }).eq('id', owner.id).then(function (res) {
      if (res.error) showToast(dbMessage(res.error));
      refresh();
    });
  }

  function projectCard(p, editable) {
    var card = make('article', 'project' + (isPinned(p) ? ' pinned' : ''));
    card.id = 'project-' + p.id;
    var cover = projectImage(p);
    if (cover) card.appendChild(cover);
    if (isPinned(p)) card.appendChild(make('span', 'pin-tag', 'Pinned'));
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
    var tags = tagChips(p);
    var status = statusTag(p);
    if (status) {
      if (!tags) tags = make('div', 'tag-row');
      tags.insertBefore(status, tags.firstChild);
    }
    if (tags) card.appendChild(tags);
    card.appendChild(projectMeta(p));
    var collabLine = collabNames(p);
    if (collabLine) card.appendChild(collabLine);
    var mineToEdit = canEditProject(p); // owner or accepted collaborator

    var about = make('div', 'tab-panel');
    about.appendChild(descriptionNode(p.description));
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
        p.sources.forEach(function (s, si) {
          var sHref = cleanLink(s.link);
          if (!sHref) return;
          var li = make('li', 'source-item');
          var sa = make('a');
          sa.href = sHref;
          sa.target = '_blank';
          sa.rel = 'noopener noreferrer';
          sa.appendChild(make('span', 'source-name', (s.name || hostOf(sHref)) + ' ↗'));
          sa.appendChild(make('span', 'source-host', hostOf(sHref)));
          li.appendChild(sa);
          // Cite: the source written out in MLA and APA style, ready to copy into schoolwork.
          var citeKey = p.id + ':' + si;
          var cite = make('button', 'link-btn cite-btn', citeOpen[citeKey] ? 'Hide citation' : 'Cite');
          cite.type = 'button';
          cite.setAttribute('aria-expanded', citeOpen[citeKey] ? 'true' : 'false');
          cite.addEventListener('click', function () { citeOpen[citeKey] = !citeOpen[citeKey]; renderProjects(); });
          li.appendChild(cite);
          if (citeOpen[citeKey]) li.appendChild(citationBox(s, sHref));
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
    var poll = pollBlock(p, mineToEdit);
    if (poll) card.appendChild(poll);

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
    var save = researchSaveButton(p);
    if (save) tools.appendChild(save);

    if (mineToEdit) {
      var edit = make('button', 'mini-btn', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', function () { openProject(p.id); });
      tools.appendChild(edit);
    }
    if (editable && extrasReady) {
      var pin = make('button', 'mini-btn pin-btn', isPinned(p) ? 'Unpin' : 'Pin');
      pin.type = 'button';
      pin.title = isPinned(p) ? 'Stop showing this first' : 'Show this research first on your portfolio';
      pin.addEventListener('click', function () { togglePin(p); });
      tools.appendChild(pin);
    }
    // Print (or save as a PDF) just this research card, for handing in.
    var print = make('button', 'mini-btn print-btn', 'Print');
    print.type = 'button';
    print.title = 'Print this research or save it as a PDF';
    print.addEventListener('click', function () { printResearch(p); });
    tools.appendChild(print);
    var team = hasTeamNotes(p);
    if (team) {
      var notesBtn = make('button', 'mini-btn notes-btn', 'Team notes');
      notesBtn.type = 'button';
      notesBtn.setAttribute('aria-expanded', notesOpen[p.id] ? 'true' : 'false');
      notesBtn.title = 'A shared notepad for you and your collaborators';
      notesBtn.addEventListener('click', function () {
        notesOpen[p.id] = !notesOpen[p.id];
        renderProjects();
        var box = $('notes-input-' + p.id);
        if (notesOpen[p.id] && box) box.focus();
      });
      tools.appendChild(notesBtn);
    }
    var reacts = reactionRow(p);
    if (reacts) card.appendChild(reacts);
    card.appendChild(tools);
    if (team && notesOpen[p.id]) card.appendChild(notesPanel(p));
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

  // ---- Reactions: Inspiring, Smart and Well-sourced buttons under a research card ----
  var REACTIONS = [
    { kind: 'inspiring', icon: '✦', label: 'Inspiring' },
    { kind: 'smart', icon: '◉', label: 'Smart' },
    { kind: 'sourced', icon: '✓', label: 'Well-sourced' }
  ];
  var reacting = null; // "projectId:kind" while saving
  function reactionRow(q) {
    if (!reactionsReady) return null;
    var own = canEditProject(q);
    var row = make('div', 'reaction-row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Reactions to ' + q.title);
    REACTIONS.forEach(function (r) {
      var list = state.reactions.filter(function (x) { return x.projectId === q.id && x.kind === r.kind; });
      var on = !!me && list.some(function (x) { return x.userId === me.id; });
      // Your own research shows its counts, but only ones people have given.
      if (own && !list.length) return;
      var b = make('button', 'reaction-btn reaction-' + r.kind);
      b.type = 'button';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      var icon = make('span', 'reaction-icon', r.icon);
      icon.setAttribute('aria-hidden', 'true');
      b.appendChild(icon);
      b.appendChild(make('span', null, r.label));
      if (list.length) b.appendChild(make('span', 'reaction-count', String(list.length)));
      b.setAttribute('aria-label', r.label + ', ' + list.length + (on ? '. You reacted. Click to take it back.' : ''));
      if (own) {
        b.disabled = true;
        b.title = 'Reactions people gave your research';
      } else {
        b.disabled = reacting === q.id + ':' + r.kind;
        b.addEventListener('click', function () { toggleReaction(q, r.kind); });
      }
      row.appendChild(b);
    });
    return row.childNodes.length ? row : null;
  }
  function toggleReaction(q, kind) {
    if (!me) { openAuth('signin', 'Sign in to react to research.'); return; }
    if (reacting) return;
    var on = state.reactions.some(function (x) { return x.projectId === q.id && x.kind === kind && x.userId === me.id; });
    reacting = q.id + ':' + kind;
    rerenderResearch();
    var req = on
      ? client.from('project_reactions').delete().eq('user_id', me.id).eq('project_id', q.id).eq('kind', kind)
      : client.from('project_reactions').insert({ project_id: q.id, kind: kind });
    req.then(function (res) {
      reacting = null;
      if (res.error && res.error.code !== '23505') {
        showToast(dbMessage(res.error));
      } else if (on) {
        state.reactions = state.reactions.filter(function (x) { return !(x.projectId === q.id && x.kind === kind && x.userId === me.id); });
      } else if (!res.error) {
        state.reactions.push({ userId: me.id, projectId: q.id, kind: kind });
      }
      rerenderResearch();
    });
  }

  // ---- Team notes: a shared notepad on research that has collaborators ----
  var notesOpen = {};   // research id -> its notes are open
  var noteDrafts = {};  // research id -> unsaved text
  var savingNote = null;
  function hasTeamNotes(q) {
    return notesReady && !!me && canEditProject(q) && acceptedCollabs(q.id).length > 0;
  }
  function notesPanel(q) {
    var saved = state.notes[q.id] || { body: '', by: null, at: 0 };
    var box = make('div', 'notes-panel');
    box.id = 'notes-' + q.id;
    var head = make('div', 'notes-head');
    head.appendChild(make('span', 'notes-title', 'Team notes'));
    head.appendChild(make('span', 'notes-who', 'Only you and your collaborators can see these'));
    box.appendChild(head);
    var label = make('label', 'sr-only', 'Team notes for ' + q.title);
    label.htmlFor = 'notes-input-' + q.id;
    box.appendChild(label);
    var input = make('textarea', 'notes-input');
    input.id = 'notes-input-' + q.id;
    input.rows = 6;
    input.maxLength = 4000;
    input.placeholder = 'Plans, to-dos, who is doing what…';
    input.value = noteDrafts[q.id] != null ? noteDrafts[q.id] : saved.body;
    input.addEventListener('input', function () { noteDrafts[q.id] = input.value; });
    box.appendChild(input);
    var foot = make('div', 'notes-foot');
    var save = make('button', 'btn btn-solid', savingNote === q.id ? 'Saving…' : 'Save notes');
    save.type = 'button';
    save.disabled = savingNote === q.id;
    save.addEventListener('click', function () { saveNotes(q, input.value); });
    foot.appendChild(save);
    var when = '';
    if (saved.at) {
      var who = saved.by === me.id ? 'you' : ownerName(saved.by);
      when = 'Last saved ' + timeAgo(saved.at).toLowerCase() + (who ? ' by ' + who : '');
    }
    foot.appendChild(make('span', 'notes-when', when || 'Nothing saved yet'));
    box.appendChild(foot);
    return box;
  }
  // The name of someone's first portfolio, for showing who did something.
  function ownerName(userId) {
    var p = state.profiles.filter(function (x) { return x.ownerId === userId; })[0];
    return p ? p.name : '';
  }
  function saveNotes(q, body) {
    if (savingNote) return;
    savingNote = q.id;
    renderProjects();
    var row = { body: body, updated_by: me.id, updated_at: new Date().toISOString() };
    // Update the notes if they exist, otherwise start them.
    client.from('collab_notes').update(row).eq('project_id', q.id).select('project_id').then(function (res) {
      if (res.error || (res.data && res.data.length)) return res;
      return client.from('collab_notes').insert({ project_id: q.id, body: body });
    }).then(function (res) {
      savingNote = null;
      if (res.error) {
        showToast(dbMessage(res.error));
      } else {
        state.notes[q.id] = { body: body, by: me.id, at: Date.now() };
        delete noteDrafts[q.id];
        showToast('Team notes saved.');
      }
      renderProjects();
    });
  }

  // ---- Saved research (bookmarks): a private list of research you want to come back to ----
  function isSaved(q) { return state.bookmarks.indexOf(q.id) >= 0; }
  var savingId = null;
  // The Save button on a research card. Only shows when you're signed in and saving is set up.
  function researchSaveButton(q) {
    if (!me || !bookmarksReady) return null;
    var saved = isSaved(q);
    var b = make('button', 'card-like card-save');
    b.type = 'button';
    b.setAttribute('aria-pressed', saved ? 'true' : 'false');
    b.setAttribute('aria-label', (saved ? 'Remove ' : 'Save ') + q.title + (saved ? ' from your saved research' : ' for later'));
    b.appendChild(bookmarkIcon());
    b.appendChild(make('span', null, saved ? 'Saved' : 'Save'));
    b.disabled = savingId === q.id;
    b.addEventListener('click', function () { toggleBookmark(q); });
    return b;
  }
  function bookmarkIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'card-save-icon');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.2-6.5 4.2v-16a1 1 0 0 1 1-1Z');
    svg.appendChild(path);
    return svg;
  }
  function toggleBookmark(q) {
    if (!me || !bookmarksReady || savingId) return;
    var saved = isSaved(q);
    savingId = q.id;
    // Show the change right away, and undo it if saving fails.
    if (saved) state.bookmarks = state.bookmarks.filter(function (id) { return id !== q.id; });
    else state.bookmarks.unshift(q.id);
    rerenderResearch();
    var req = saved
      ? client.from('bookmarks').delete().eq('user_id', me.id).eq('project_id', q.id)
      : client.from('bookmarks').insert({ project_id: q.id });
    req.then(function (res) {
      savingId = null;
      if (res.error && res.error.code !== '23505') {
        if (saved) state.bookmarks.unshift(q.id);
        else state.bookmarks = state.bookmarks.filter(function (id) { return id !== q.id; });
        showToast(dbMessage(res.error));
      } else {
        showToast(saved ? 'Removed from your saved research.' : 'Saved! Find it in your account menu under Saved research.');
      }
      rerenderResearch();
      renderHeader();
      if (!savedDialog.hidden) renderSaved();
    });
  }
  var savedDialog = $('saved-dialog');
  var savedBtn = $('saved-btn');
  var savedOpener = null;
  function savedItems() {
    var items = [];
    state.bookmarks.forEach(function (id) {
      state.profiles.forEach(function (p) {
        p.projects.forEach(function (q) { if (q.id === id) items.push({ p: p, q: q }); });
      });
    });
    return items;
  }
  function renderSaved() {
    var list = $('saved-list');
    list.textContent = '';
    var items = savedItems();
    $('saved-sub').textContent = items.length
      ? plural(items.length, 'saved research project') + '. Only you can see this list.'
      : 'Nothing saved yet. Click Save on any research card to keep it here for later.';
    items.forEach(function (it) {
      var li = make('li', 'saved-item');
      var open = make('button', 'research-result');
      open.type = 'button';
      open.appendChild(make('span', 'research-result-title', it.q.title));
      var by = make('span', 'research-result-by');
      by.appendChild(document.createTextNode('by '));
      var nm = make('span');
      paintName(nm, it.p.name);
      by.appendChild(nm);
      open.appendChild(by);
      open.addEventListener('click', function () { closeSaved(); goToResearch(it.p.id, it.q.id); });
      li.appendChild(open);
      var remove = make('button', 'mini-btn', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove ' + it.q.title + ' from saved research');
      remove.addEventListener('click', function () { toggleBookmark(it.q); });
      li.appendChild(remove);
      list.appendChild(li);
    });
  }
  function openSaved() {
    savedOpener = accountBtn;
    closeAccountMenu();
    renderSaved();
    savedDialog.hidden = false;
    $('saved-close').focus();
  }
  function closeSaved() {
    savedDialog.hidden = true;
    if (savedOpener && savedOpener.focus) savedOpener.focus();
  }
  savedBtn.addEventListener('click', openSaved);
  $('saved-close').addEventListener('click', closeSaved);
  savedDialog.addEventListener('click', function (e) { if (e.target === savedDialog) closeSaved(); });
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

  var replyOpen = {};   // comment id -> its reply box is open
  var replyDrafts = {}; // comment id -> unsent reply
  function commentsPanel(p, comments, editable) {
    var panel = make('div', 'comments');
    panel.id = 'comments-' + p.id;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Comments on ' + p.title);

    if (!commentsReady) {
      panel.appendChild(make('p', 'comments-empty', 'Comments are not switched on for this site yet.'));
      return panel;
    }
    // Comments from people you've blocked are hidden from you.
    comments = comments.filter(function (c) { return !isBlockedByMe(c.userId); });
    var ids = comments.map(function (c) { return c.id; });
    // Replies sit under the comment they answer; a reply to a missing comment shows as a comment.
    var top = comments.filter(function (c) { return !c.parentId || ids.indexOf(c.parentId) < 0; });
    if (!top.length) {
      panel.appendChild(make('p', 'comments-empty', editable ? 'No comments on this research yet.' : 'No comments yet. Leave the first one.'));
    } else {
      var list = make('ul', 'comment-list');
      top.forEach(function (c) {
        var li = commentItem(p, c, editable, false);
        var replies = comments.filter(function (r) { return r.parentId === c.id; });
        if (replies.length || replyOpen[c.id]) {
          var sub = make('ul', 'reply-list');
          replies.forEach(function (r) { sub.appendChild(commentItem(p, r, editable, true)); });
          if (replyOpen[c.id] && me) sub.appendChild(replyForm(p, c));
          li.appendChild(sub);
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
      panel.appendChild(make('p', 'comments-note', repliesReady
        ? "You can't comment on your own research, but you can reply to comments."
        : "You can't comment on your own research."));
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
      if (unkind(text, true)) { statusEl.textContent = KIND_NOTE; box.focus(); return; }
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
  // One comment (or reply), with Reply, Delete and Report where they apply.
  function commentItem(p, c, editable, isReply) {
    var li = make('li', 'comment' + (isReply ? ' reply' : ''));
    var head = make('div', 'comment-head');
    head.appendChild(make('span', 'comment-author', authorName(c.userId)));
    if (c.kind === 'tip' && !isReply) head.appendChild(make('span', 'comment-tip', 'Tip'));
    head.appendChild(make('span', 'comment-when', timeAgo(c.createdAt)));
    li.appendChild(head);
    li.appendChild(make('p', 'comment-body', c.body));
    var tools = make('div', 'comment-tools');
    // Anyone signed in can reply to a comment (replies to replies go under the same comment).
    if (me && repliesReady && !isReply) {
      var reply = make('button', 'link-btn comment-reply', replyOpen[c.id] ? 'Cancel reply' : 'Reply');
      reply.type = 'button';
      reply.addEventListener('click', function () {
        replyOpen[c.id] = !replyOpen[c.id];
        rerenderResearch();
        var input = $('reply-input-' + c.id);
        if (replyOpen[c.id] && input) input.focus();
      });
      tools.appendChild(reply);
    }
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
          state.comments = state.comments.filter(function (x) { return x.id !== c.id && x.parentId !== c.id; });
          rerenderResearch();
          refresh();
        });
      });
      tools.appendChild(del);
    }
    // Other people's comments can be reported to the site owner.
    if (me && reportsReady && c.userId !== me.id) {
      var rep = make('button', 'link-btn comment-report', alreadyReported('comment', c.id) ? 'Reported' : 'Report');
      rep.type = 'button';
      rep.disabled = alreadyReported('comment', c.id);
      rep.setAttribute('aria-label', 'Report this comment by ' + authorName(c.userId));
      rep.addEventListener('click', function () { openReport('comment', c.id, 'this comment by ' + authorName(c.userId)); });
      tools.appendChild(rep);
    }
    if (tools.childNodes.length) li.appendChild(tools);
    return li;
  }
  function replyForm(p, c) {
    var li = make('li', 'reply-form-item');
    var f = make('form', 'reply-form');
    var box = make('textarea');
    box.id = 'reply-input-' + c.id;
    box.rows = 2;
    box.maxLength = 500;
    box.placeholder = 'Reply to ' + authorName(c.userId) + '…';
    box.setAttribute('aria-label', 'Your reply to ' + authorName(c.userId));
    box.value = replyDrafts[c.id] || '';
    box.addEventListener('input', function () { replyDrafts[c.id] = box.value; });
    var send = make('button', 'mini-btn', 'Reply');
    send.type = 'submit';
    var statusEl = statusLine('');
    f.appendChild(box);
    f.appendChild(send);
    li.appendChild(f);
    li.appendChild(statusEl);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = box.value.trim();
      if (!text) { box.focus(); return; }
      if (unkind(text, true)) { statusEl.textContent = KIND_NOTE; box.focus(); return; }
      send.disabled = true;
      statusEl.textContent = 'Posting…';
      client.from('project_comments').insert({ project_id: p.id, kind: 'comment', body: text, parent_id: c.id }).then(function (res) {
        send.disabled = false;
        if (res.error) { statusEl.textContent = dbMessage(res.error); return; }
        delete replyDrafts[c.id];
        replyOpen[c.id] = false;
        refresh();
      });
    });
    return li;
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
    // Longer descriptions (room for the research outline) once the database allows them.
    var descIn = textArea(statusReady ? 1500 : 400, isNew ? '' : p.description);

    field('Title', titleIn, 'project-title-input')
      .concat(field('Link to your research (optional)', linkIn, 'project-link-input'))
      .concat(field('Description', descIn, 'project-desc-input'))
      .forEach(function (node) { f.appendChild(node); });
    // The research outline fills the description with four short headings to answer.
    var outlineBtn = make('button', 'mini-btn outline-btn', 'Use the research outline');
    outlineBtn.type = 'button';
    outlineBtn.title = 'Adds four headings to help you write your research';
    outlineBtn.addEventListener('click', function () {
      var template = OUTLINE.map(function (h) { return h + ': '; }).join('\n');
      var current = descIn.value.trim();
      if (OUTLINE.every(function (h) { return current.indexOf(h + ':') >= 0; })) { descIn.focus(); return; }
      descIn.value = current ? template + '\n' + current : template;
      descIn.rows = 8;
      descIn.focus();
      descIn.setSelectionRange(OUTLINE[0].length + 2, OUTLINE[0].length + 2);
    });
    f.appendChild(outlineBtn);
    // In progress or Finished.
    var pickedStatus = isNew ? '' : p.status;
    if (statusReady) {
      var statusLabel = make('span', 'edit-label', 'Status');
      statusLabel.id = 'project-status-label';
      var statusChips = make('div', 'chips');
      statusChips.setAttribute('role', 'group');
      statusChips.setAttribute('aria-labelledby', statusLabel.id);
      [['', 'No label'], ['in-progress', 'In progress'], ['finished', 'Finished']].forEach(function (s) {
        var b = make('button', 'chip', s[1]);
        b.type = 'button';
        b.setAttribute('aria-pressed', pickedStatus === s[0] ? 'true' : 'false');
        b.addEventListener('click', function () {
          pickedStatus = s[0];
          Array.prototype.forEach.call(statusChips.children, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        });
        statusChips.appendChild(b);
      });
      f.appendChild(statusLabel);
      f.appendChild(statusChips);
    }

    // Topics (up to 3) and a cover picture, once the database has room for them.
    // Entering the weekly challenge starts a new card with that week's topic picked.
    var pickedTags = isNew ? (challengeTag ? [challengeTag] : []) : p.tags.slice();
    if (isNew) challengeTag = '';
    var imageIn = textInput(500, isNew ? '' : p.image);
    if (extrasReady) {
      var tagLabel = make('span', 'edit-label', 'Topics (pick up to 3)');
      tagLabel.id = 'project-tags-label';
      var tagChipsEl = make('div', 'chips');
      tagChipsEl.setAttribute('role', 'group');
      tagChipsEl.setAttribute('aria-labelledby', tagLabel.id);
      TAGS.forEach(function (t) {
        var b = make('button', 'chip', t);
        b.type = 'button';
        b.setAttribute('aria-pressed', pickedTags.indexOf(t) >= 0 ? 'true' : 'false');
        b.addEventListener('click', function () {
          var at = pickedTags.indexOf(t);
          if (at >= 0) pickedTags.splice(at, 1);
          else if (pickedTags.length < 3) pickedTags.push(t);
          else { statusEl.textContent = 'Pick up to 3 topics. Tap one to take it off.'; return; }
          b.setAttribute('aria-pressed', at >= 0 ? 'false' : 'true');
          statusEl.textContent = '';
        });
        tagChipsEl.appendChild(b);
      });
      f.appendChild(tagLabel);
      f.appendChild(tagChipsEl);
      imageIn.inputMode = 'url';
      imageIn.placeholder = 'https://… (a link to a picture)';
      field('Cover picture link (optional)', imageIn, 'project-image-input').forEach(function (node) { f.appendChild(node); });
    }

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
      if (unkind(t + ' ' + d)) { statusEl.textContent = KIND_NOTE; descIn.focus(); return; }
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
      if (extrasReady) {
        var image = cleanLink(imageIn.value);
        if (image === null) {
          statusEl.textContent = 'That picture link does not look right. Paste the full web address of the picture.';
          imageIn.focus();
          return;
        }
        row.tags = pickedTags;
        row.image = image;
      }
      if (statusReady) row.status = pickedStatus;
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
    // The pinned card goes first.
    cards.sort(function (a, b) { return (isPinned(b) && b.profileId === p.id ? 1 : 0) - (isPinned(a) && a.profileId === p.id ? 1 : 0); });
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
    // Your friends count is private: it shows only on your own profile, to you.
    var ownFriends = $('own-friends');
    ownFriends.hidden = !own;
    if (own) ownFriends.textContent = plural(friendCount(p.ownerId), 'friend');
    // Friends can message each other from the portfolio.
    $('message-btn').hidden = own || !me || !messagesReady || !areFriends(me.id, p.ownerId) || isBlockedByMe(p.ownerId);
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
      if (!target || target.profile.ownerId !== me.id || c.userId === me.id || isBlockedByMe(c.userId)) return;
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
    // Replies to your comments.
    state.comments.forEach(function (c) {
      if (!c.parentId || c.userId === me.id) return;
      var parent = state.comments.filter(function (x) { return x.id === c.parentId; })[0];
      var target = projectsById[c.projectId];
      if (!parent || parent.userId !== me.id || !target) return;
      items.push({
        time: c.createdAt, profile: target.profile, project: target.project, comment: true, who: authorName(c.userId),
        what: 'replied to your comment on ' + target.project.title + ': “' + snippet(c.body) + '”'
      });
    });
    // Likes and reactions on your research.
    var REACT_WORDS = { inspiring: 'Inspiring', smart: 'Smart', sourced: 'Well-sourced' };
    state.projectLikes.forEach(function (l) {
      var target = projectsById[l.projectId];
      if (!l.at || !target || target.profile.ownerId !== me.id || l.userId === me.id) return;
      items.push({ time: l.at, profile: target.profile, project: target.project, who: authorName(l.userId), what: 'liked ' + target.project.title + ' (+1 star)' });
    });
    state.reactions.forEach(function (r) {
      var target = projectsById[r.projectId];
      if (!r.at || !target || target.profile.ownerId !== me.id || r.userId === me.id) return;
      items.push({ time: r.at, profile: target.profile, project: target.project, who: authorName(r.userId), what: 'reacted ' + REACT_WORDS[r.kind] + ' to ' + target.project.title });
    });
    // New messages.
    state.messages.forEach(function (m) {
      if (m.to !== me.id || isBlockedByMe(m.from)) return;
      items.push({ time: m.at, who: authorName(m.from), what: 'sent you a message: “' + snippet(m.body) + '”', open: function () { openMessages(m.from); } });
    });
    // Gifts: stars and items from friends, the weekly challenge prize, and stars from the site owner.
    state.giftsReceived.forEach(function (g) {
      items.push({ time: g.at, who: authorName(g.from), what: 'gifted you ' + plural(g.stars, 'star') + '!', open: openShop });
    });
    state.purchases.forEach(function (pu) {
      if (pu.owner !== me.id || !pu.paidBy || pu.paidBy === me.id || !pu.at) return;
      var item = SHOP.filter(function (s) { return s.id === pu.item; })[0];
      items.push({ time: pu.at, who: authorName(pu.paidBy), what: 'gifted you the ' + (item ? item.name.toLowerCase() : 'a Star Shop item') + '!', open: openShop });
    });
    state.siteGifts.forEach(function (g) {
      if (g.reason.indexOf('challenge:') === 0) {
        items.push({ time: g.at, who: 'Weekly challenge', what: 'You won ' + weekTopic(g.reason.slice(10)) + ' week! +' + plural(g.stars, 'star'), open: openShop });
      } else if (g.reason.indexOf('owner-gift:') === 0) {
        items.push({ time: g.at, who: state.hubName, what: 'The site owner gifted you ' + plural(g.stars, 'star') + '!', open: openShop });
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
        // Messages and gifts open their own pop-ups.
        if (n.open) { n.open(); return; }
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

  // ---- Messages: private chats between friends (people who follow each other) ----
  var msgBtn = $('msg-btn');
  var msgDialog = $('msg-dialog');
  var msgInput = $('msg-input');
  var msgOpener = null;
  var chatWith = null;   // the friend whose chat is open, or null for the list of chats
  var sendingMsg = false;
  // Everyone you can chat with: your friends, plus anyone you already have messages with.
  function chatPeople() {
    var ids = {};
    state.profiles.forEach(function (p) { if (areFriends(me.id, p.ownerId)) ids[p.ownerId] = true; });
    state.messages.forEach(function (m) { ids[m.from === me.id ? m.to : m.from] = true; });
    delete ids[me.id];
    return Object.keys(ids).filter(function (id) { return ownerName(id) && !isBlockedByMe(id); }).map(function (id) {
      var msgs = chatMessages(id);
      var last = msgs[msgs.length - 1];
      return { id: id, last: last || null, unread: msgs.filter(function (m) { return m.to === me.id && !m.readAt; }).length };
    }).sort(function (a, b) { return (b.last ? b.last.at : 0) - (a.last ? a.last.at : 0) || ownerName(a.id).localeCompare(ownerName(b.id)); });
  }
  function chatMessages(userId) {
    return state.messages.filter(function (m) {
      return (m.from === me.id && m.to === userId) || (m.from === userId && m.to === me.id);
    });
  }
  function unreadMessages() {
    return state.messages.filter(function (m) { return m.to === me.id && !m.readAt && !isBlockedByMe(m.from); }).length;
  }
  function renderMsgButton() {
    var show = !!me && messagesReady && loaded && !loadError;
    msgBtn.hidden = !show;
    if (!show) { msgDialog.hidden = true; return; }
    var n = unreadMessages();
    var badge = $('msg-badge');
    badge.hidden = !n;
    badge.textContent = n > 9 ? '9+' : String(n);
    msgBtn.setAttribute('aria-label', 'Messages' + (n ? ', ' + plural(n, 'unread message') : ''));
    if (!msgDialog.hidden) renderMessages();
  }
  function profileFor(userId) {
    return state.profiles.filter(function (x) { return x.ownerId === userId; })[0] || null;
  }
  function renderMessages() {
    var chats = $('msg-chats');
    var wrap = $('msg-thread-wrap');
    $('msg-back').hidden = !chatWith;
    chats.hidden = !!chatWith;
    wrap.hidden = !chatWith;
    if (!chatWith) {
      $('msg-title').textContent = 'Messages';
      var people = chatPeople();
      $('msg-sub').textContent = people.length
        ? 'Chat with your friends: people who follow you back. Only the two of you can see a chat.'
        : 'No chats yet. When someone you follow follows you back, you become friends and can message each other here.';
      chats.textContent = '';
      people.forEach(function (c) {
        var li = make('li');
        var b = make('button', 'msg-chat' + (c.unread ? ' unread' : ''));
        b.type = 'button';
        var fp = profileFor(c.id);
        var pic = fp ? pictureNode(fp.avatar, fp.name) : null;
        var avatar = make('span', 'avatar msg-avatar', pic ? null : ownerName(c.id).charAt(0).toUpperCase());
        if (pic) avatar.appendChild(pic);
        avatar.setAttribute('aria-hidden', 'true');
        b.appendChild(avatar);
        var text = make('span', 'msg-chat-text');
        var nm = make('span', 'msg-chat-name');
        paintName(nm, ownerName(c.id));
        text.appendChild(nm);
        text.appendChild(make('span', 'msg-chat-last', c.last
          ? (c.last.from === me.id ? 'You: ' : '') + c.last.body
          : 'Say hi!'));
        b.appendChild(text);
        if (c.unread) b.appendChild(make('span', 'msg-unread', String(c.unread)));
        else if (c.last) b.appendChild(make('span', 'msg-chat-when', timeAgo(c.last.at)));
        b.addEventListener('click', function () { openChat(c.id); });
        li.appendChild(b);
        chats.appendChild(li);
      });
      return;
    }
    $('msg-title').textContent = ownerName(chatWith);
    var friends = areFriends(me.id, chatWith);
    $('msg-sub').textContent = friends ? 'Only the two of you can see this chat.' : 'You are not friends anymore, so you can read this chat but not send new messages.';
    var thread = $('msg-thread');
    thread.textContent = '';
    var msgs = chatMessages(chatWith);
    if (!msgs.length) thread.appendChild(make('li', 'msg-empty', 'No messages yet. Say hi!'));
    msgs.forEach(function (m) {
      var li = make('li', 'msg-bubble' + (m.from === me.id ? ' mine' : ''));
      li.appendChild(make('span', 'msg-body', m.body));
      var when = make('span', 'msg-when', timeAgo(m.at));
      when.title = exactTime(m.at);
      li.appendChild(when);
      thread.appendChild(li);
    });
    thread.scrollTop = thread.scrollHeight;
    msgInput.disabled = !friends || sendingMsg;
    $('msg-send').disabled = !friends || sendingMsg;
  }
  // Opening a chat marks the friend's messages as read.
  function openChat(userId) {
    chatWith = userId;
    $('msg-status').textContent = '';
    renderMessages();
    msgInput.focus();
    var unread = chatMessages(userId).filter(function (m) { return m.to === me.id && !m.readAt; });
    if (!unread.length) return;
    var now = new Date().toISOString();
    unread.forEach(function (m) { m.readAt = Date.now(); });
    renderMsgButton();
    client.from('messages').update({ read_at: now }).eq('to_user', me.id).eq('from_user', userId).is('read_at', null).then(function () {});
  }
  function openMessages(userId) {
    if (!me || !messagesReady) return;
    msgOpener = document.activeElement;
    closeNotifs();
    closeAccountMenu();
    msgDialog.hidden = false;
    if (userId) openChat(userId);
    else { chatWith = null; renderMessages(); $('msg-close').focus(); }
  }
  function closeMessages() {
    msgDialog.hidden = true;
    chatWith = null;
    if (msgOpener && msgOpener.focus) msgOpener.focus();
  }
  msgBtn.addEventListener('click', function () { openMessages(null); });
  $('msg-close').addEventListener('click', closeMessages);
  $('msg-back').addEventListener('click', function () { chatWith = null; renderMessages(); $('msg-close').focus(); });
  msgDialog.addEventListener('click', function (e) { if (e.target === msgDialog) closeMessages(); });
  // Enter sends; Shift+Enter makes a new line.
  msgInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('msg-form').requestSubmit(); }
  });
  $('msg-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = msgInput.value.trim();
    if (!body || !chatWith || sendingMsg) return;
    if (unkind(body, true)) { $('msg-status').textContent = KIND_NOTE; msgInput.focus(); return; }
    var to = chatWith;
    sendingMsg = true;
    $('msg-status').textContent = '';
    renderMessages();
    client.from('messages').insert({ to_user: to, body: body }).then(function (res) {
      sendingMsg = false;
      if (res.error) {
        $('msg-status').textContent = /row-level security|permission/i.test(res.error.message || '')
          ? 'You can only message friends: people who follow you back.'
          : dbMessage(res.error);
      } else {
        msgInput.value = '';
        state.messages.push({ id: 'new-' + Date.now(), from: me.id, to: to, body: body, at: Date.now(), readAt: 0 });
      }
      renderMessages();
      msgInput.focus();
    });
  });
  $('message-btn').addEventListener('click', function () {
    var p = current();
    if (p) openMessages(p.ownerId);
  });

  // ---- Reports: tell the site owner about a comment, portfolio or research card ----
  var reportDialog = $('report-dialog');
  var reportTarget = null; // { kind, id }
  var reportOpener = null;
  function alreadyReported(kind, id) {
    return !!me && state.reports.some(function (r) { return r.kind === kind && r.targetId === id && r.reporter === me.id; });
  }
  function openReport(kind, id, what) {
    if (!me || !reportsReady) return;
    reportTarget = { kind: kind, id: id };
    reportOpener = document.activeElement;
    $('report-title').textContent = 'Report ' + what;
    $('report-reason').value = '';
    $('report-status').textContent = '';
    $('report-send').disabled = false;
    reportDialog.hidden = false;
    $('report-reason').focus();
  }
  function closeReport() {
    reportDialog.hidden = true;
    reportTarget = null;
    if (reportOpener && reportOpener.focus) reportOpener.focus();
  }
  $('report-cancel').addEventListener('click', closeReport);
  reportDialog.addEventListener('click', function (e) { if (e.target === reportDialog) closeReport(); });
  $('report-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!reportTarget) return;
    var t = reportTarget;
    var reason = $('report-reason').value.trim();
    $('report-send').disabled = true;
    $('report-status').textContent = 'Sending…';
    client.from('reports').insert({ kind: t.kind, target_id: t.id, reason: reason }).then(function (res) {
      if (res.error && res.error.code !== '23505') {
        $('report-send').disabled = false;
        $('report-status').textContent = dbMessage(res.error);
        return;
      }
      state.reports.unshift({ id: 'new-' + Date.now(), reporter: me.id, kind: t.kind, targetId: t.id, reason: reason, at: Date.now() });
      closeReport();
      showToast('Thanks for telling us. The site owner will take a look.');
      if (currentId) renderProfile();
      rerenderResearch();
    });
  });
  $('report-profile').addEventListener('click', function () {
    var p = current();
    if (p) openReport('profile', p.id, p.name);
  });

  // ---- Welcome tour: a few quick pop-ups the first time someone visits ----
  var tourDialog = $('tour-dialog');
  var tourStep = 0;
  var TOUR = [
    { art: '★', title: function () { return 'Welcome to ' + state.hubName + '!'; },
      text: 'A place where friends share their research. Here’s a quick look around. It takes about 20 seconds.' },
    { art: '☺', title: 'Portfolios', target: 'profiles',
      text: 'Everyone has a portfolio with their own character, research cards and sources. Click any profile to look around, and follow the ones you like.' },
    { art: '✎', title: 'Research', target: 'recent-research',
      text: 'Like, react to, comment on and save research. On the home screen, check Recent research, Top research and this week’s challenge.' },
    { art: '♥', title: 'Stars and the Star Shop', target: 'cart-btn',
      text: 'You get a star for every like your research gets, plus a free star every day. Spend them on outfits, frames and pets in the Star Shop (the cart at the top).' },
    { art: '✦', title: 'Make your own', text: '' }
  ];
  function tourSeen() { try { return localStorage.getItem('ds-tour') === 'done'; } catch (e) { return true; } }
  function renderTour() {
    var s = TOUR[tourStep];
    var last = tourStep === TOUR.length - 1;
    $('tour-art').textContent = s.art;
    $('tour-title').textContent = typeof s.title === 'function' ? s.title() : s.title;
    $('tour-text').textContent = last
      ? (myProfile() ? 'You’re all set. Jump to your portfolio to add research, or explore everyone else’s.'
        : me ? 'Make your portfolio from the home screen: click + Create my profile, then add your first research card.'
          : 'Sign in or make an account to create your own portfolio. You can look around without one, too.')
      : s.text;
    var dots = $('tour-dots');
    dots.textContent = '';
    TOUR.forEach(function (_, i) { dots.appendChild(make('span', i === tourStep ? 'on' : null)); });
    $('tour-back').hidden = tourStep === 0;
    $('tour-next').textContent = last ? (myProfile() ? 'Go to my portfolio' : me ? 'Let’s go' : 'Sign in') : 'Next';
    // Point at the part of the page this step is about.
    Array.prototype.forEach.call(document.querySelectorAll('.tour-glow'), function (el) { el.classList.remove('tour-glow'); });
    var target = s.target && $(s.target);
    if (target && !target.hidden) {
      target.classList.add('tour-glow');
      if (target.id !== 'cart-btn') target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
  function openTour() {
    if (currentId) showHome(true);
    tourStep = 0;
    renderTour();
    tourDialog.hidden = false;
    $('tour-next').focus();
  }
  function closeTour() {
    tourDialog.hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll('.tour-glow'), function (el) { el.classList.remove('tour-glow'); });
    try { localStorage.setItem('ds-tour', 'done'); } catch (e) {}
  }
  $('tour-next').addEventListener('click', function () {
    if (tourStep < TOUR.length - 1) { tourStep++; renderTour(); $('tour-next').focus(); return; }
    closeTour();
    window.scrollTo(0, 0);
    var mp = myProfile();
    if (mp) showProfile(mp.id, true);
    else if (!me) openAuth('signin', '');
  });
  $('tour-back').addEventListener('click', function () { if (tourStep > 0) { tourStep--; renderTour(); } });
  $('tour-skip').addEventListener('click', function () { closeTour(); window.scrollTo(0, 0); });
  $('tour-again').addEventListener('click', openTour);
  // Shown once, after the site has loaded for the first time on this device.
  function maybeStartTour() {
    if (tourSeen() || !loaded || loadError || !client || currentId) return;
    try { localStorage.setItem('ds-tour', 'done'); } catch (e) {}
    setTimeout(openTour, 600);
  }

  // ---- Blocking ----
  var blocking = false;
  function isBlockedByMe(userId) { return state.blocks.indexOf(userId) >= 0; }
  $('block-btn').addEventListener('click', function () {
    var p = current();
    if (!p || !me || blocking) return;
    var on = isBlockedByMe(p.ownerId);
    if (!on && !window.confirm('Block ' + p.name + '? They won’t be able to message you or comment on your research, ' +
      'and you won’t see their comments or messages. You can unblock them here any time.')) return;
    blocking = true;
    renderProfile();
    var req = on
      ? client.from('blocks').delete().eq('user_id', me.id).eq('blocked_user', p.ownerId)
      : client.from('blocks').insert({ blocked_user: p.ownerId });
    req.then(function (res) {
      blocking = false;
      if (res.error && res.error.code !== '23505') {
        showToast(dbMessage(res.error));
      } else if (on) {
        state.blocks = state.blocks.filter(function (id) { return id !== p.ownerId; });
        showToast('Unblocked ' + p.name + '.');
      } else {
        state.blocks.push(p.ownerId);
        showToast('Blocked ' + p.name + '.');
      }
      renderProfile();
      renderMsgButton();
    });
  });

  // ---- Share: send a portfolio's link to someone ----
  $('share-btn').addEventListener('click', function () {
    var p = current();
    if (!p) return;
    var url = SITE_URL + '?p=' + encodeURIComponent(p.id);
    var title = p.name + ' on ' + state.hubName;
    if (navigator.share) {
      navigator.share({ title: title, text: 'Check out ' + p.name + '’s research portfolio!', url: url }).catch(function () {});
      return;
    }
    var copied = navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject();
    copied.then(function () {
      showToast('Link copied! Paste it anywhere to share this portfolio.');
    }, function () {
      window.prompt('Copy this link to share the portfolio:', url);
    });
  });

  // ---- Dark mode: a night-purple look, remembered on this device ----
  var themeBtn = $('theme-btn');
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  function paintThemeButton() {
    themeBtn.setAttribute('aria-pressed', isDark() ? 'true' : 'false');
    themeBtn.title = isDark() ? 'Light mode' : 'Dark mode';
    themeBtn.setAttribute('aria-label', 'Dark mode');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark() ? '#1E1A2E' : '#FFF9F0');
  }
  themeBtn.addEventListener('click', function () {
    var dark = !isDark();
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('ds-theme', dark ? 'dark' : 'light'); } catch (e) {}
    paintThemeButton();
  });
  paintThemeButton();

  // ---- Owner tools: reports, sign-ups and gifting stars. Only the site owner (an admin) sees these. ----
  var adminDialog = $('admin-dialog');
  var adminBtn = $('admin-btn');
  var adminTab = 'reports';
  var adminUsers = null;   // sign-ups, loaded when the tab opens
  var adminBusy = false;
  var ADMIN_TABS = [['reports', 'Reports'], ['signups', 'Sign-ups'], ['stars', 'Gift stars']];
  function reportedThing(r) {
    if (r.kind === 'comment') {
      var c = state.comments.filter(function (x) { return x.id === r.targetId; })[0];
      return c ? { label: 'Comment by ' + authorName(c.userId), text: c.body, projectId: c.projectId } : null;
    }
    if (r.kind === 'profile') {
      var p = findProfile(r.targetId);
      return p ? { label: 'Portfolio', text: p.name, profileId: p.id } : null;
    }
    var q = findProject(r.targetId);
    return q ? { label: 'Research', text: q.title, projectId: q.id } : null;
  }
  function renderAdmin() {
    var tabs = $('admin-tabs');
    tabs.textContent = '';
    var open = state.reports.filter(function (r) { return reportedThing(r); });
    ADMIN_TABS.forEach(function (t) {
      var b = make('button', 'card-tab', t[0] === 'reports' && open.length ? t[1] + ' (' + open.length + ')' : t[1]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', adminTab === t[0] ? 'true' : 'false');
      b.addEventListener('click', function () { adminTab = t[0]; $('admin-status').textContent = ''; renderAdmin(); });
      tabs.appendChild(b);
    });
    var body = $('admin-body');
    body.textContent = '';
    if (adminTab === 'reports') adminReports(body, open);
    else if (adminTab === 'signups') adminSignups(body);
    else adminStars(body);
  }
  function adminReports(body, open) {
    if (!reportsReady) { body.appendChild(make('p', 'followers-empty', 'Reports switch on once the database setup has been run.')); return; }
    if (!open.length) { body.appendChild(make('p', 'followers-empty', 'No reports right now. All clear!')); return; }
    var list = make('ul', 'admin-list');
    open.forEach(function (r) {
      var thing = reportedThing(r);
      var li = make('li', 'admin-item');
      li.appendChild(make('span', 'admin-kind', thing.label));
      li.appendChild(make('p', 'admin-text', thing.text));
      li.appendChild(make('p', 'admin-meta', 'Reported by ' + authorName(r.reporter) + ' · ' + timeAgo(r.at).toLowerCase() +
        (r.reason ? ' · “' + r.reason + '”' : '')));
      var actions = make('div', 'admin-actions');
      var look = make('button', 'mini-btn', 'Open');
      look.type = 'button';
      look.addEventListener('click', function () {
        closeAdmin();
        if (thing.profileId) { showProfile(thing.profileId, true); return; }
        var q = findProject(thing.projectId);
        if (q) goToResearch(q.profileId, q.id);
      });
      var del = make('button', 'mini-btn admin-danger', r.kind === 'profile' ? 'Remove portfolio' : 'Delete it');
      del.type = 'button';
      del.disabled = adminBusy;
      del.addEventListener('click', function () {
        if (!window.confirm('Delete this ' + (r.kind === 'comment' ? 'comment' : r.kind === 'profile' ? 'portfolio and all its research' : 'research card') + '? This can’t be undone.')) return;
        var table = r.kind === 'comment' ? 'project_comments' : r.kind === 'profile' ? 'profiles' : 'projects';
        adminAction(client.from(table).delete().eq('id', r.targetId), 'Deleted.', function () { return clearReports(r); });
      });
      var dismiss = make('button', 'mini-btn', 'Dismiss');
      dismiss.type = 'button';
      dismiss.disabled = adminBusy;
      dismiss.addEventListener('click', function () { adminAction(clearReports(r), 'Report dismissed.'); });
      actions.appendChild(look);
      actions.appendChild(del);
      actions.appendChild(dismiss);
      li.appendChild(actions);
      list.appendChild(li);
    });
    body.appendChild(list);
  }
  // Removes every report about the same thing.
  function clearReports(r) {
    return client.from('reports').delete().eq('kind', r.kind).eq('target_id', r.targetId).then(function (res) {
      if (!res.error) state.reports = state.reports.filter(function (x) { return !(x.kind === r.kind && x.targetId === r.targetId); });
      return res;
    });
  }
  function adminAction(request, done, then) {
    adminBusy = true;
    $('admin-status').textContent = 'Working…';
    renderAdmin();
    request.then(function (res) {
      if (!res.error && then) return then();
      return res;
    }).then(function (res) {
      adminBusy = false;
      $('admin-status').textContent = res && res.error ? (res.error.message || dbMessage(res.error)) : done;
      renderAdmin();
      refresh();
    });
  }
  function adminSignups(body) {
    if (adminUsers === null) {
      body.appendChild(make('p', 'followers-empty', 'Loading sign-ups…'));
      client.rpc('admin_users').then(function (res) {
        adminUsers = res.error ? { error: res.error.message || 'Could not load sign-ups.' } : res.data || [];
        if (!adminDialog.hidden && adminTab === 'signups') renderAdmin();
      });
      return;
    }
    if (adminUsers.error) { body.appendChild(make('p', 'followers-empty', 'Sign-ups show up once the database setup has been run.')); return; }
    var weekAgo = Date.now() - 7 * 86400000;
    var newThisWeek = adminUsers.filter(function (u) { return Date.parse(u.created_at) >= weekAgo; }).length;
    body.appendChild(make('p', 'admin-summary', plural(adminUsers.length, 'account') + ' · ' + newThisWeek + ' new this week'));
    var list = make('ul', 'admin-list');
    adminUsers.forEach(function (u) {
      var li = make('li', 'admin-item admin-user');
      var name = ownerName(u.id);
      li.appendChild(make('span', 'admin-user-name', name || 'No portfolio yet'));
      li.appendChild(make('span', 'admin-meta', u.email || ''));
      li.appendChild(make('span', 'admin-meta', 'Joined ' + timeAgo(Date.parse(u.created_at)).toLowerCase() +
        (u.last_sign_in_at ? ' · last seen ' + timeAgo(Date.parse(u.last_sign_in_at)).toLowerCase() : '')));
      list.appendChild(li);
    });
    body.appendChild(list);
  }
  function adminStars(body) {
    var people = {};
    state.profiles.forEach(function (p) { if (!people[p.ownerId]) people[p.ownerId] = p.name; });
    var form = make('form', 'admin-stars');
    var whoLabel = make('label', 'edit-label', 'Who gets the stars');
    whoLabel.htmlFor = 'admin-star-who';
    var who = make('select', 'giftbox-select');
    who.id = 'admin-star-who';
    Object.keys(people).sort(function (a, b) { return people[a].localeCompare(people[b]); }).forEach(function (id) {
      var o = make('option', null, people[id]);
      o.value = id;
      who.appendChild(o);
    });
    var amountLabel = make('label', 'edit-label', 'How many stars (1 to 100)');
    amountLabel.htmlFor = 'admin-star-amount';
    var amount = make('input', 'giftbox-amount');
    amount.id = 'admin-star-amount';
    amount.type = 'number';
    amount.min = '1';
    amount.max = '100';
    amount.value = '10';
    var send = make('button', 'btn btn-solid', 'Gift stars');
    send.type = 'submit';
    send.disabled = adminBusy;
    form.appendChild(whoLabel);
    form.appendChild(who);
    form.appendChild(amountLabel);
    form.appendChild(amount);
    form.appendChild(send);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = Math.floor(Number(amount.value));
      if (!(n >= 1 && n <= 100)) { $('admin-status').textContent = 'Pick 1 to 100 stars.'; return; }
      var to = who.value;
      adminAction(client.from('star_gifts').insert({ user_id: to, reason: 'owner-gift:' + Date.now(), stars: n }),
        'Sent ' + plural(n, 'star') + ' to ' + people[to] + '!');
    });
    body.appendChild(make('p', 'admin-summary', 'Stars you gift show up in their Star Shop right away.'));
    body.appendChild(form);
  }
  function openAdmin() {
    if (!isAdmin) return;
    closeAccountMenu();
    adminUsers = null;
    $('admin-status').textContent = '';
    renderAdmin();
    adminDialog.hidden = false;
    $('admin-close').focus();
  }
  function closeAdmin() {
    adminDialog.hidden = true;
    accountBtn.focus();
  }
  adminBtn.addEventListener('click', openAdmin);
  $('admin-close').addEventListener('click', closeAdmin);
  adminDialog.addEventListener('click', function (e) { if (e.target === adminDialog) closeAdmin(); });

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
      savedBtn.hidden = !bookmarksReady;
      adminBtn.hidden = !isAdmin;
      var openReports = state.reports.filter(function (r) { return isAdmin && reportedThing(r); }).length;
      adminBtn.textContent = 'Owner tools' + (openReports ? ' (' + openReports + ' to review)' : '');
      savedBtn.textContent = 'Saved research' + (state.bookmarks.length ? ' (' + savedItems().length + ')' : '');
    } else {
      closeAccountMenu();
      savedDialog.hidden = true;
      adminDialog.hidden = true;
      reportDialog.hidden = true;
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
    if (!achievementsDialog.hidden) { closeAchievements(); return; }
    if (!savedDialog.hidden) { closeSaved(); return; }
    if (!msgDialog.hidden) { closeMessages(); return; }
    if (!reportDialog.hidden) { closeReport(); return; }
    if (!tourDialog.hidden) { closeTour(); return; }
    if (!adminDialog.hidden) { closeAdmin(); return; }
    if (!shopDialog.hidden) { closeShop(); return; }
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
    var typingComment = Object.keys(commentDrafts).some(function (k) { return commentDrafts[k]; }) ||
      Object.keys(replyDrafts).some(function (k) { return replyDrafts[k]; });
    var typingCollab = !collabPanel.hidden && collabPanel.contains(document.activeElement);
    // Unsaved team notes are kept in noteDrafts, so only pause while someone is typing in them.
    var typingNotes = (!!document.activeElement && document.activeElement.classList.contains('notes-input')) ||
      Object.keys(pollEditing).some(function (k) { return pollEditing[k]; });
    return editingId !== null || !form.hidden || !picForm.hidden || addingProfile || !hubForm.hidden || typingComment || typingCollab || typingNotes;
  }
  var routed = false;
  function renderAll() {
    renderHeader();
    renderBell();
    renderCart();
    renderMsgButton();
    if (!routed && loaded) { routed = true; route(); maybeStartTour(); return; }
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
