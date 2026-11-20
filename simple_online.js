// Simple Online for Lampa: HDrezka + Filmix. No proxies, no extra balancers.
(function () {
  'use strict';
  if (window.simple_online_loaded) return;
  window.simple_online_loaded = true;

  var network = new Lampa.Reguest();
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

  // ---------- helpers ----------
  function android() { return Lampa.Platform.is('android'); }
  function get(key, def) { return Lampa.Storage.get(key, def); }
  function startsWith(s, p) { return s.lastIndexOf(p, 0) === 0; }
  function rid(n) {
    var c = '0123456789abcdefghijklmnopqrstuvwxyz', s = '';
    while (n--) s += c.charAt(Math.floor(Math.random() * c.length));
    return s;
  }
  function noty(t) { Lampa.Noty.show(t); }
  function snip(x) {
    try { x = typeof x === 'string' ? x : JSON.stringify(x); } catch (e) { x = String(x); }
    return (x || '').replace(/\s+/g, ' ').slice(0, 160);
  }
  function back() { Lampa.Controller.toggle('content'); }

  function proxyUrl() {
    var p = (get('so_proxy', '') + '').trim();
    if (!p) return '';
    if (p.indexOf('://') === -1) p = 'https://' + p;
    return p.replace(/\/+$/, '');
  }

  function request(url, o, ok, fail) {
    var proxy = proxyUrl();
    var h = o.headers || {};
    if (proxy) {
      // браузер не даёт ставить Cookie/User-Agent/Origin сам, это делает прокси
      var q = proxy + '/?url=' + encodeURIComponent(url);
      if (h['Cookie']) q += '&cookie=' + encodeURIComponent(h['Cookie']);
      if (h['User-Agent']) q += '&ua=' + encodeURIComponent(h['User-Agent']);
      var key = (get('so_proxy_key', '') + '').trim();
      if (key) q += '&key=' + encodeURIComponent(key);
      if (o.rh) q += '&rh=1';
      url = q;
      h = {};
    } else if (!android()) {
      h = {};
    }
    network.clear();
    network.timeout(15000);
    var params = {
      dataType: o.dataType || 'text',
      headers: h,
      withCredentials: !android() && !proxy
    };
    if (o.rh) {
      if (proxy) params.dataType = 'json';
      else { delete params.dataType; params.returnHeaders = true; }
    }
    network['native'](url, ok, function (a, c) {
      fail(network.errorDecode(a, c));
    }, o.post || false, params);
  }

  // items: [{title, subtitle}], cb(index)
  function choose(title, items, cb, onBack) {
    Lampa.Select.show({
      title: title,
      items: items.map(function (it, i) {
        return { title: it.title, subtitle: it.subtitle, idx: i };
      }),
      onSelect: function (a) { cb(a.idx); },
      onBack: onBack || back
    });
  }

  function parsePlaylist(str) {
    var out = [], re = /\[([^\]]+)\]([^\[]+)/g, m;
    while ((m = re.exec(str || ''))) {
      var links = m[2].replace(/,\s*$/, '').split(' or ').map(function (s) { return s.trim(); }).filter(Boolean);
      if (links.length) out.push({ label: m[1], links: links });
    }
    return out;
  }

  function play(title, res) {
    var first = { url: res.url, quality: res.quality || false, subtitles: res.subtitles || false, title: title };
    Lampa.Player.play(first);
    Lampa.Player.playlist([first]);
  }

  // ---------- HDrezka ----------
  var Rezka = (function () {
    var sess = rid(26);

    function host() {
      var u = (get('so_rezka_mirror', '') + '').trim();
      if (!u) return 'https://kvk.zone';
      if (u.indexOf('://') === -1) u = 'https://' + u;
      return u.replace(/\/$/, '');
    }
    function cookie() {
      var c = (get('so_rezka_cookie', '') + '').trim();
      if (c.indexOf('PHPSESSID=') === -1) c = 'PHPSESSID=' + sess + (c ? '; ' + c : '');
      return c;
    }
    function headers() {
      var h = host();
      return { 'Origin': h, 'Referer': h + '/', 'User-Agent': UA, 'Cookie': cookie() };
    }
    function checkError(str) {
      if (/id="check-form"|id="loginForm"/.test(str)) return 'HDrezka: нужен вход в аккаунт (логин и пароль в настройках, затем «Войти»)';
      if (/anubis/i.test(str)) return 'HDrezka: ' + host() + ' закрыт проверкой Anubis (защита от ботов), нужно другое зеркало';
      if (/<span>MIRROR<\/span>/.test(str)) return 'HDrezka: ' + host() + ' вернул страницу-заглушку, нужно другое зеркало';
      return '';
    }

    function search(title, year, ok, fail) {
      request(host() + '/engine/ajax/search.php', { post: 'q=' + encodeURIComponent(title), headers: headers() }, function (str) {
        str = (str || '').replace(/\n/g, '');
        var err = checkError(str);
        if (err) return fail(err);
        var links = str.match(/<li><a href=.*?<\/li>/g) || [];
        var items = links.map(function (l) {
          var a = $('a', $(l));
          var enty = $('.enty', a);
          var t = enty.text().trim();
          enty.remove();
          $('.rating', a).remove();
          var alt = a.text().trim();
          var m = alt.match(/\((.*,\s*)?\b(\d{4})(\s*-\s*[\d.]*)?\)$/);
          return { title: t || alt, year: m ? parseInt(m[2]) : 0, link: a.attr('href') || '' };
        }).filter(function (i) { return i.link; });
        if (year && items.length > 1) {
          var near = items.filter(function (i) { return i.year && Math.abs(i.year - year) <= 1; });
          if (near.length) items = near;
        }
        ok(items);
      }, fail);
    }

    function page(link, ok, fail) {
      var url = link.indexOf('://') === -1 ? host() + link : link;
      request(url, { headers: headers() }, function (str) {
        str = (str || '').replace(/\n/g, '');
        var err = checkError(str);
        if (err) return fail(err);
        var info = { voices: [], is_series: false, film_id: '', favs: '' };
        var tr = str.match(/<h2>В переводе<\/h2>:<\/td>\s*(<td>.*?<\/td>)/);
        var defName = (tr && $(tr[1]).text().trim()) || 'Оригинал';
        var series = str.match(/\.initCDNSeriesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,/);
        var movie = str.match(/\.initCDNMoviesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/);
        var defVoice;
        if (series) {
          info.is_series = true;
          info.film_id = series[1];
          defVoice = { name: defName, id: series[2] };
        } else if (movie) {
          info.film_id = movie[1];
          defVoice = { name: defName, id: movie[2], camrip: movie[3], ads: movie[4], director: movie[5] };
        }
        var list = str.match(/(<ul id="translators-list".*?<\/ul>)/);
        if (list) {
          $('.b-translator__item', $(list[1])).each(function () {
            var name = ($(this).attr('title') || $(this).text() || '').trim();
            $('img', this).each(function () {
              var lang = ($(this).attr('title') || $(this).attr('alt') || '').trim();
              if (lang && name.indexOf(lang) === -1) name += ' (' + lang + ')';
            });
            info.voices.push({
              name: name, id: $(this).attr('data-translator_id'),
              camrip: $(this).attr('data-camrip'), ads: $(this).attr('data-ads'), director: $(this).attr('data-director')
            });
          });
        }
        if (!info.voices.length && defVoice) info.voices.push(defVoice);
        var favs = str.match(/<input type="hidden" id="ctrl_favs" value="([^"]*)"/);
        if (favs) info.favs = favs[1];
        if (!info.film_id) return fail('HDrezka: данные плеера не найдены');
        ok(info);
      }, fail);
    }

    function episodes(info, voice, ok, fail) {
      var post = 'id=' + encodeURIComponent(info.film_id) + '&translator_id=' + encodeURIComponent(voice.id) +
        '&favs=' + encodeURIComponent(info.favs) + '&action=get_episodes';
      request(host() + '/ajax/get_cdn_series/?t=' + Date.now(), { post: post, headers: headers(), dataType: 'json' }, function (json) {
        var seasons = [], eps = [];
        if (json && json.seasons) {
          $('.b-simple_season__item', $('<ul>' + json.seasons + '</ul>')).each(function () {
            seasons.push({ id: $(this).attr('data-tab_id'), name: $(this).text() });
          });
        }
        if (json && json.episodes) {
          $('.b-simple_episode__item', $('<div>' + json.episodes + '</div>')).each(function () {
            eps.push({ season: $(this).attr('data-season_id'), episode: $(this).attr('data-episode_id'), name: $(this).text() });
          });
        }
        ok(seasons, eps);
      }, fail);
    }

    function decode(data) {
      if (!startsWith(data, '#')) return data;
      var enc = function (s) {
        return btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, function (m, p) { return String.fromCharCode('0x' + p); }));
      };
      var dec = function (s) {
        return decodeURIComponent(atob(s).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
      };
      var trash = ['$$!!@$$@^!@#$$@', '@@@@@!##!^^^', '####^!!##!@@', '^^^!@##!!##', '$$#!!@#!@##'];
      var x = data.substring(2);
      trash.forEach(function (t) { x = x.replace('//_//' + enc(t), ''); });
      try { return dec(x); } catch (e) { return ''; }
    }

    function stream(info, p, ok, fail) {
      var post = 'id=' + encodeURIComponent(info.film_id);
      if (info.is_series) {
        post += '&translator_id=' + encodeURIComponent(p.voice.id) + '&season=' + encodeURIComponent(p.season) +
          '&episode=' + encodeURIComponent(p.episode) + '&favs=' + encodeURIComponent(info.favs) + '&action=get_stream';
      } else {
        post += '&translator_id=' + encodeURIComponent(p.voice.id) + '&is_camrip=' + encodeURIComponent(p.voice.camrip) +
          '&is_ads=' + encodeURIComponent(p.voice.ads) + '&is_director=' + encodeURIComponent(p.voice.director) +
          '&favs=' + encodeURIComponent(info.favs) + '&action=get_movie';
      }
      request(host() + '/ajax/get_cdn_series/?t=' + Date.now(), { post: post, headers: headers(), dataType: 'json' }, function (json) {
        if (!json || !json.url) return fail('HDrezka: поток не найден');
        var items = parsePlaylist(decode(json.url)).map(function (it) {
          var q = it.label.match(/(\d\d\d+)/), k = it.label.match(/(\d+)K/);
          var links = it.links.filter(function (u) { return /\.m3u8$/i.test(u); });
          if (!links.length) links = it.links;
          return {
            label: it.label,
            q: q ? parseInt(q[1]) : (k ? parseInt(k[1]) * 1000 : 0),
            file: (links[0] || '').replace('http://', 'https://')
          };
        }).filter(function (i) { return i.file; });
        items.sort(function (a, b) { return b.q - a.q; });
        if (!items.length) return fail('HDrezka: поток не найден');
        var qualities = {};
        items.forEach(function (i) { qualities[i.label] = i.file; });
        var subs = parsePlaylist(json.subtitle || '').map(function (s) {
          return { label: s.label, url: s.links[0].replace('http://', 'https://') };
        });
        ok({ url: items[0].file, quality: qualities, subtitles: subs.length ? subs : false });
      }, function () { fail('HDrezka: не удалось получить поток'); });
    }

    // Вход по логину и паролю: сохраняет cookie сессии
    function login(ok, fail) {
      var name = (get('so_rezka_name', '') + '').trim();
      var pass = get('so_rezka_password', '') + '';
      if (!name || !pass) return fail('HDrezka: введите логин и пароль в настройках');
      var post = 'login_name=' + encodeURIComponent(name) + '&login_password=' + encodeURIComponent(pass) + '&login_not_save=0';
      var h = host();
      request(h + '/ajax/login/', {
        post: post, rh: true,
        headers: { 'Origin': h, 'Referer': h + '/', 'User-Agent': UA }
      }, function (json) {
        if (!json || !json.headers) {
          return fail('HDrezka: не удалось получить cookie (нужен Lampa для Android с поддержкой заголовков или прокси из worker.js)');
        }
        var body = json.body;
        if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
        body = body || {};
        if (!body.success) {
          var already = body.message && body.message.indexOf('Уже авторизован') === 0;
          return fail('HDrezka: ' + (already ? 'сайт считает вас уже вошедшим, нажмите «Сбросить вход» и повторите' : (body.message || 'вход не выполнен')));
        }
        var sc = json.headers['set-cookie'] || json.headers['Set-Cookie'] || [];
        if (typeof sc === 'string') sc = [sc];
        var values = {};
        sc.forEach(function (param) {
          var parts = param.split(';')[0].split('=');
          var k = parts.shift();
          if (!k) return;
          var v = parts.join('=');
          if (v === 'deleted') delete values[k]; else values[k] = v;
        });
        var cookie = Object.keys(values).map(function (k) { return k + '=' + values[k]; }).join('; ');
        if (!cookie) return fail('HDrezka: сайт не прислал cookie');
        Lampa.Storage.set('so_rezka_cookie', cookie);
        ok();
      }, function (e) { fail('HDrezka: ' + e); });
    }

    function run(movie, title, year, is_series) {
      noty('HDrezka: поиск...');
      search(title, year, function (items) {
        if (!items.length) return noty('HDrezka: ничего не найдено');
        var open = function (it) {
          page(it.link, function (info) {
            choose('Озвучка', info.voices.map(function (v) { return { title: v.name }; }), function (vi) {
              var voice = info.voices[vi];
              if (!info.is_series) {
                stream(info, { voice: voice }, function (r) { play(title + ' / ' + voice.name, r); }, noty);
                return;
              }
              episodes(info, voice, function (seasons, eps) {
                if (!eps.length) return noty('HDrezka: серии не найдены');
                if (!seasons.length) seasons = [{ id: eps[0].season, name: 'Сезон ' + eps[0].season }];
                choose('Сезон', seasons.map(function (s) { return { title: s.name }; }), function (si) {
                  var list = eps.filter(function (e) { return e.season == seasons[si].id; });
                  choose(seasons[si].name, list.map(function (e) { return { title: e.name }; }), function (ei) {
                    var e = list[ei];
                    stream(info, { voice: voice, season: e.season, episode: e.episode }, function (r) {
                      play(title + ' / S' + e.season + 'E' + e.episode, r);
                    }, noty);
                  });
                });
              }, noty);
            });
          }, noty);
        };
        if (items.length === 1) open(items[0]);
        else choose('HDrezka', items.map(function (i) { return { title: i.title, subtitle: i.year || '' }; }), function (i) { open(items[i]); });
      }, noty);
    }

    return { run: run, login: login };
  })();

  // ---------- Filmix (по плагину fx.js; API приложения Filmix) ----------
  var Filmix = (function () {
    var HOSTS = ['http://filmixapp.vip/api/v2/', 'http://filmixapp.cyou/api/v2/'];
    var API = HOSTS[0];

    function devId() {
      var id = get('so_filmix_dev_id', '');
      if (!id) { id = rid(16); Lampa.Storage.set('so_filmix_dev_id', id); }
      return id;
    }
    function token() { return (get('so_filmix_token', '') + '').trim(); }
    function tokOf(t) {
      return '?app_lang=ru_RU&user_dev_apk=2.2.13&user_dev_id=' + devId() +
        '&user_dev_name=Xiaomi+24069PC21G&user_dev_os=12&user_dev_token=' + encodeURIComponent(t || '') +
        '&user_dev_vendor=Xiaomi';
    }
    function headers() { return { 'User-Agent': 'okhttp/3.10.0' }; }
    function norm(s) { return (s || '').toLowerCase().replace(/[^a-zа-я0-9]/g, ''); }

    // запрос к API; при сетевой ошибке пробует запасной адрес
    function fx(path, t, extra, ok, fail) {
      var hosts = [API].concat(HOSTS.filter(function (h) { return h !== API; }));
      (function go(i) {
        request(hosts[i] + path + tokOf(t) + (extra || ''), { headers: headers(), dataType: 'json' }, function (j) {
          API = hosts[i];
          ok(j);
        }, function (e) {
          if (i + 1 < hosts.length) go(i + 1); else fail(e);
        });
      })(0);
    }

    // максимальное качество по подписке аккаунта: бесплатно 720, PRO 1080, PRO+ 2160
    var accInfo = '';
    function maxQuality(cb) {
      var t = token();
      if (!t) { accInfo = 'нет авторизации, до 720p'; return cb(720); }
      fx('user_profile', t, '', function (j) {
        var u = j && j.user_data;
        var m = u ? (u.is_pro_plus ? 2160 : (u.is_pro ? 1080 : 720)) : 720;
        accInfo = u ? ((u.is_pro_plus ? 'PRO+' : (u.is_pro ? 'PRO' : 'бесплатный')) + ', до ' + m + 'p') : 'профиль не получен, до 720p';
        cb(m);
      }, function () { accInfo = 'профиль не получен, до 720p'; cb(720); });
    }

    // выбор качества + копирование ссылки (для проверки, если видео не играет)
    function playQ(label, r) {
      var keys = Object.keys(r.quality);
      var items = keys.map(function (k) { return { title: k }; });
      items.push({ title: 'Скопировать ссылку (' + keys[0] + ')' });
      choose('Качество (' + accInfo + ')', items, function (i) {
        if (i === keys.length) {
          Lampa.Utils.copyTextToClipboard(r.url, function () {
            noty('Ссылка скопирована: ' + snip(r.url));
          }, function () {
            noty('Не удалось скопировать: ' + snip(r.url));
          });
          return;
        }
        play(label, { url: r.quality[keys[i]], quality: r.quality, subtitles: false });
      });
    }

    function qmap(link, qualities, max) {
      if (!link) return null;
      var q = qualities && qualities.length ? qualities : null;
      if (!q) {
        var m = link.match(/\[([\d,\s]*)\]/);
        q = m ? m[1].split(',') : [];
      }
      q = q.map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x > 0 && x <= max; })
        .sort(function (a, b) { return b - a; });
      if (!q.length) return null;
      var map = {};
      q.forEach(function (x) {
        map[x + 'p'] = link.indexOf('%s') !== -1 ? link.replace('%s', x) : link.replace(/\[[\d,\s]*\]/, x);
      });
      return { url: map[q[0] + 'p'], quality: map, subtitles: false };
    }

    function chooseAuto(title, items, cb) {
      if (items.length === 1) cb(0); else choose(title, items, cb);
    }

    function episodeMap(v) {
      if (Array.isArray(v)) {
        var m = {};
        v.forEach(function (e, i) { m[String(i + 1)] = e; });
        return m;
      }
      return v || {};
    }

    function isBlocked(name) {
      return typeof name === 'string' && name.toLowerCase().indexOf('заблокировано ') === 0;
    }

    function openPost(it, title, max) {
      fx('post/' + it.id, token(), '', function (post) {
        var pl = (post && post.player_links) || {};
        var pls = pl.playlist;
        var noq = 'Filmix: нет доступных качеств для вашего аккаунта';

        if (pls && !Array.isArray(pls) && Object.keys(pls).length) {
          // сезон -> озвучка -> серия
          var seasons = Object.keys(pls).sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });
          chooseAuto('Сезон', seasons.map(function (k) {
            return { title: 'Сезон ' + (k === '-1' ? '1' : k) };
          }), function (si) {
            var voices = Object.keys(pls[seasons[si]]);
            chooseAuto('Озвучка', voices.map(function (v) { return { title: v }; }), function (vi) {
              var eps = episodeMap(pls[seasons[si]][voices[vi]]);
              var ek = Object.keys(eps).filter(function (k) { return eps[k] && eps[k].link; })
                .sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0); });
              if (!ek.length) return noty('Filmix: серии не найдены');
              choose('Серия', ek.map(function (k) { return { title: 'Серия ' + k }; }), function (ei) {
                var e = eps[ek[ei]];
                var r = qmap(e.link, e.qualities, max);
                if (!r) return noty(noq);
                var sm = e.link.match(/s(\d+)e(\d+?)_/i);
                var label = sm ? 'S' + parseInt(sm[1], 10) + 'E' + parseInt(sm[2], 10) : 'серия ' + ek[ei];
                playQ(title + ' / ' + label, r);
              });
            });
          });
        } else if (pl.movie && pl.movie.length) {
          var movies = pl.movie.filter(function (m) { return !isBlocked(m.translation); });
          if (!movies.length) return noty('Filmix: заблокировано правообладателем для приложения (через API недоступно)');
          chooseAuto('Озвучка', movies.map(function (m) { return { title: m.translation || 'Оригинал' }; }), function (i) {
            var m = movies[i];
            var r = qmap(m.link, null, max);
            if (!r) return noty(noq);
            playQ(title + ' / ' + (m.translation || ''), r);
          });
        } else if (post && post.id) {
          noty('Filmix: контент найден, но ссылки недоступны (проверьте авторизацию)');
        } else {
          noty('Filmix: не удалось получить данные фильма');
        }
      }, noty);
    }

    function run(movie, title, year, is_series) {
      var orig = movie.original_title || movie.original_name || '';
      var queries = [orig, title].filter(function (q, i, a) { return q && a.indexOf(q) === i; });
      var tries = [];
      queries.forEach(function (q) { HOSTS.forEach(function (h) { tries.push({ q: q, host: h }); }); });
      noty('Filmix: поиск...');

      var found = function (items) {
        items.forEach(function (e) {
          e.year = parseInt(e.year || (e.alt_name || '').split('-').pop(), 10) || 0;
        });
        if (year) {
          var near = items.filter(function (i) { return i.year > year - 2 && i.year < year + 2; });
          if (near.length) items = near;
        }
        var exact = orig ? items.filter(function (i) { return norm(i.original_title) === norm(orig); }) : [];
        var pick = function (it) { maxQuality(function (max) { openPost(it, title, max); }); };
        if (exact.length === 1) return pick(exact[0]);
        if (items.length === 1) return pick(items[0]);
        choose('Filmix', items.map(function (i) {
          return { title: i.title || i.original_title || i.alt_name, subtitle: (i.year || '') + (i.original_title ? ' / ' + i.original_title : '') };
        }), function (i) { pick(items[i]); });
      };

      var last = '';
      var attempt = function (i) {
        var t = tries[i];
        var next = function (info) {
          last = info;
          if (i + 1 < tries.length) return attempt(i + 1);
          noty('Filmix: не найдено (' + queries.join(' / ') + '). ' + last);
        };
        request(t.host + 'search' + tokOf(token()) + '&story=' + encodeURIComponent(t.q), { headers: headers(), dataType: 'json' }, function (json) {
          if (!Array.isArray(json)) return next(snip(json));
          var items = json.filter(function (e) { return e && e.id; });
          if (!items.length) return next(snip(json));
          API = t.host;
          found(items);
        }, function (err) { next(snip(err)); });
      };
      attempt(0);
    }

    // Авторизация устройства по коду (как у приставок)
    function auth() {
      fx('token_request', '', '', function (r) {
        if (!r || r.status !== 'ok' || !r.code || !r.user_code) {
          return noty('Filmix: не удалось получить код: ' + snip(r));
        }
        var tkn = r.code, stopped = false, tries = 0, timer;
        var html = $('<div>' +
          '<div class="about">Откройте на телефоне или компьютере filmix.my/consoles, войдите в аккаунт и введите код:</div>' +
          '<div style="font-size:3em;text-align:center;margin:.5em 0;letter-spacing:.2em"></div>' +
          '<div class="about">Ожидание подтверждения...</div></div>');
        html.find('div').eq(1).text(r.user_code);
        function close() {
          stopped = true;
          clearInterval(timer);
          Lampa.Modal.close();
          Lampa.Controller.toggle('settings_component');
        }
        Lampa.Modal.open({ title: 'Авторизация Filmix', html: html, size: 'small', onBack: close });
        timer = setInterval(function () {
          if (stopped) return;
          if (++tries > 100) { close(); return noty('Filmix: время ожидания истекло'); }
          fx('user_profile', tkn, '', function (p) {
            if (stopped) return;
            if (p && p.user_data) {
              Lampa.Storage.set('so_filmix_token', tkn);
              close();
              noty('Filmix: устройство авторизовано' + (p.user_data.is_pro_plus ? ' (PRO+)' : (p.user_data.is_pro ? ' (PRO)' : '')));
            }
          }, function () {});
        }, 3000);
      }, noty);
    }

    return { run: run, auth: auth };
  })();

  // ---------- UI ----------
  function start(movie) {
    var title = movie.title || movie.name || '';
    var date = movie.release_date || movie.first_air_date || '';
    var year = parseInt((date + '').slice(0, 4)) || 0;
    var is_series = !!movie.name;
    choose('Онлайн', [{ title: 'HDrezka' }, { title: 'Filmix' }], function (i) {
      (i === 0 ? Rezka : Filmix).run(movie, title, year, is_series);
    });
  }

  function addButton(e) {
    var render = e.object.activity.render();
    if (render.find('.view--simple_online').length) return;
    var btn = $('<div class="full-start__button selector view--simple_online"><span>Онлайн</span></div>');
    btn.on('hover:enter', function () { start(e.data.movie); });
    var torrent = render.find('.view--torrent');
    if (torrent.length) torrent.after(btn);
    else render.find('.full-start-new__buttons, .full-start__buttons').first().append(btn);
  }

  function initSettings() {
    Lampa.SettingsApi.addComponent({
      component: 'simple_online',
      name: 'Онлайн (HDrezka + Filmix)',
      icon: '<svg><use xlink:href="#sprite-settings"></use></svg>'
    });
    [
      ['so_proxy', 'Адрес вашего прокси (Cloudflare Worker)'],
      ['so_proxy_key', 'Ключ прокси (если задан)'],
      ['so_rezka_mirror', 'HDrezka: зеркало (адрес сайта)'],
      ['so_rezka_name', 'HDrezka: логин'],
      ['so_rezka_password', 'HDrezka: пароль'],
      ['so_rezka_cookie', 'HDrezka: cookie (заполняется после входа)']
    ].forEach(function (p) {
      Lampa.SettingsApi.addParam({
        component: 'simple_online',
        param: { name: p[0], type: 'input', values: '', 'default': '' },
        field: { name: p[1] }
      });
    });
    Lampa.SettingsApi.addParam({
      component: 'simple_online',
      param: { name: 'so_rezka_login', type: 'button' },
      field: { name: 'HDrezka: войти (по логину и паролю)' },
      onChange: function () {
        noty('HDrezka: вход...');
        Rezka.login(function () { noty('HDrezka: вход выполнен'); }, noty);
      }
    });
    Lampa.SettingsApi.addParam({
      component: 'simple_online',
      param: { name: 'so_rezka_logout', type: 'button' },
      field: { name: 'HDrezka: сбросить вход' },
      onChange: function () { Lampa.Storage.set('so_rezka_cookie', ''); noty('HDrezka: вход сброшен'); }
    });
    Lampa.SettingsApi.addParam({
      component: 'simple_online',
      param: { name: 'so_filmix_auth', type: 'button' },
      field: { name: 'Filmix: авторизовать устройство по коду' },
      onChange: function () { Filmix.auth(); }
    });
    Lampa.SettingsApi.addParam({
      component: 'simple_online',
      param: { name: 'so_filmix_logout', type: 'button' },
      field: { name: 'Filmix: сбросить авторизацию' },
      onChange: function () { Lampa.Storage.set('so_filmix_token', ''); noty('Filmix: авторизация сброшена'); }
    });
  }

  function init() {
    initSettings();
    Lampa.Listener.follow('full', function (e) {
      if (e.type === 'complite') addButton(e);
    });
  }

  if (window.appready) init();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
