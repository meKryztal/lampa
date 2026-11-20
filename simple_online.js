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
      url = q;
      h = {};
    } else if (!android()) {
      h = {};
    }
    network.clear();
    network.timeout(15000);
    network['native'](url, ok, function (a, c) {
      fail(network.errorDecode(a, c));
    }, o.post || false, {
      dataType: o.dataType || 'text',
      headers: h,
      withCredentials: !android() && !proxy
    });
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
      if (/id="check-form"|id="loginForm"/.test(str)) return 'HDrezka: требуется авторизация';
      if (/<span>MIRROR<\/span>|anubis_challenge/.test(str)) return 'HDrezka: сайт вернул защитную проверку, попробуйте другое зеркало или уберите прокси';
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

    return { run: run };
  })();

  // ---------- Filmix (по API приложения; не проверялось, см. примечания) ----------
  var Filmix = (function () {
    var API = 'http://filmixapp.cyou/api/v2/';

    function devId() {
      var id = get('so_filmix_dev_id', '');
      if (!id) { id = rid(16); Lampa.Storage.set('so_filmix_dev_id', id); }
      return id;
    }
    function tokOf(token) {
      return '?user_dev_id=' + devId() + '&user_dev_name=Xiaomi&user_dev_token=' + encodeURIComponent(token || '') +
        '&user_dev_vendor=Xiaomi&user_dev_os=14&user_dev_apk=2.2.0&app_lang=ru-rRU';
    }
    function tok() { return tokOf(get('so_filmix_token', '') + ''); }
    function headers() { return { 'User-Agent': 'okhttp/3.10.0' }; }

    function qmap(link, qualities) {
      var map = {}, best = '';
      var q = (qualities || []).map(Number).filter(function (x) { return x > 0; }).sort(function (a, b) { return b - a; });
      q.forEach(function (x) {
        var u = link.indexOf('%s') !== -1 ? link.replace('%s', x) : link.replace(/\[[\d,]+\]/, x);
        map[x + 'p'] = u;
        if (!best) best = u;
      });
      if (!best) { best = link; map['auto'] = link; }
      return { url: best, quality: map, subtitles: false };
    }

    function run(movie, title, year, is_series) {
      noty('Filmix: поиск...');
      request(API + 'suggest' + tok() + '&search_word=' + encodeURIComponent(title), { headers: headers(), dataType: 'json' }, function (json) {
        if (!Array.isArray(json)) return noty('Filmix: неожиданный ответ: ' + snip(json));
        var items = json.map(function (e) {
          return { id: e.id || e.post_id, title: e.title || e.alt_name || '', year: parseInt(e.year) || 0 };
        }).filter(function (e) { return e.id; });
        if (!items.length) return noty('Filmix: пустой ответ: ' + snip(json));
        if (year && items.length > 1) {
          var near = items.filter(function (i) { return i.year && Math.abs(i.year - year) <= 1; });
          if (near.length) items = near;
        }
        if (!items.length) return noty('Filmix: ничего не найдено');
        var open = function (it) {
          request(API + 'post/' + it.id + tok(), { headers: headers(), dataType: 'json' }, function (post) {
            var pl = (post && post.player_links) || {};
            if (pl.playlist && Object.keys(pl.playlist).length) {
              var voices = Object.keys(pl.playlist);
              choose('Озвучка', voices.map(function (v) { return { title: v }; }), function (vi) {
                var seasons = pl.playlist[voices[vi]];
                var sk = Object.keys(seasons);
                choose('Сезон', sk.map(function (s) { return { title: 'Сезон ' + s }; }), function (si) {
                  var eps = seasons[sk[si]], ek = Object.keys(eps);
                  choose('Сезон ' + sk[si], ek.map(function (e) { return { title: 'Серия ' + e }; }), function (ei) {
                    var e = eps[ek[ei]];
                    play(title + ' / S' + sk[si] + 'E' + ek[ei], qmap(e.link || '', e.qualities));
                  });
                });
              });
            } else if (pl.movie && pl.movie.length) {
              choose('Озвучка', pl.movie.map(function (m) { return { title: m.translation || 'Оригинал' }; }), function (i) {
                var m = pl.movie[i];
                play(title + ' / ' + (m.translation || ''), qmap(m.link || '', m.qualities));
              });
            } else noty('Filmix: потоки не найдены (возможно, нужен токен в настройках)');
          }, noty);
        };
        if (items.length === 1) open(items[0]);
        else choose('Filmix', items.map(function (i) { return { title: i.title, subtitle: i.year || '' }; }), function (i) { open(items[i]); });
      }, noty);
    }

    // Авторизация устройства по коду (как у приставок)
    function auth() {
      request(API + 'token_request' + tokOf(''), { headers: headers(), dataType: 'json' }, function (r) {
        if (!r || r.status !== 'ok' || !r.code || !r.user_code) {
          return noty('Filmix: не удалось получить код: ' + snip(r));
        }
        var token = r.code, stopped = false, tries = 0, timer;
        var html = $('<div>' +
          '<div class="about">Откройте на телефоне или компьютере страницу подключения устройств на сайте Filmix (обычно filmix.ac/consoles), войдите в аккаунт и введите код:</div>' +
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
          if (++tries > 60) { close(); return noty('Filmix: время ожидания истекло'); }
          request(API + 'user_profile' + tokOf(token), { headers: headers(), dataType: 'json' }, function (p) {
            if (stopped) return;
            if (p && p.user_data) {
              Lampa.Storage.set('so_filmix_token', token);
              close();
              noty('Filmix: устройство авторизовано' + (p.user_data.is_pro ? ' (PRO)' : ''));
            }
          }, function () {});
        }, 5000);
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
      ['so_rezka_cookie', 'HDrezka: cookie (необязательно)']
    ].forEach(function (p) {
      Lampa.SettingsApi.addParam({
        component: 'simple_online',
        param: { name: p[0], type: 'input', values: '', 'default': '' },
        field: { name: p[1] }
      });
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
