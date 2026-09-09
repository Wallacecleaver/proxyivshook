// ==UserScript==
// @name         Twitch HLS Proxy
// @namespace    twitch-proxy-ivs
// @version      1.4.0
// @author       razeNFR
// @description  Twitch HLS via plusieurs proxys - Dashboard statistiques (nouvel onglet, design amélioré) + fallback automatique + résultats persistants + proxys personnalisés
// @match        https://www.twitch.tv/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/razeNFR/proxyivshook/main/proxyivshook.user.js
// @downloadURL  https://raw.githubusercontent.com/razeNFR/proxyivshook/main/proxyivshook.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // CONFIGURATION
    // ============================================================

    var STORAGE_KEY = 'twitchProxyManagerV1';
    var CHANNEL_CACHE_KEY = 'twitchProxyLastChannelV1';
    var STATS_KEY = 'twitchProxyStatsV1';
    var UPDATE_CHECK_KEY = 'twitchProxyUpdateCheckV1';

    // Doit être tenu à jour avec le @version de l'en-tête du script.
    var CURRENT_VERSION = '1.4.0';

    // Même URL que @updateURL : contient toujours la dernière version
    // publiée. On la relit nous-même (plutôt que de compter sur le
    // check auto de Tampermonkey) pour pouvoir afficher un badge/bannière
    // custom dans le menu du script.
    var UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/razeNFR/proxyivshook/main/proxyivshook.user.js';
    var UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 heure

    var DEFAULT_TIMEOUT = 2000;
    var DEFAULT_CACHE_DELAY = 5;

    var DEFAULT_PROXIES = [
        {
            id: 'luminous-eu',
            name: 'Luminous EU',
            url: 'https://eu.luminous.dev/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
        {
            id: 'luminous-eu2',
            name: 'Luminous EU 2',
            url: 'https://eu2.luminous.dev/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
		{
            id: 'luminous-eu3',
            name: 'Luminous EU 3',
            url: 'https://eu3.luminous.dev/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
		{
            id: 'luminous-as',
            name: 'Luminous AS',
            url: 'https://as.luminous.dev/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
        {
            id: 'perfprod-eu5',
            name: 'Perfprod EU 5',
            url: 'https://lb-eu5.cdn-perfprod.com/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
        {
            id: 'Nadeko',
            name: 'Nadeko',
            url: 'https://twitch-al.nadeko.net/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
        {
            id: 'perfprod-eu',
            name: 'Perfprod EU',
            url: 'https://lb-eu.cdn-perfprod.com/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
        {
            id: 'perfprod-eu2',
            name: 'Perfprod EU 2',
            url: 'https://lb-eu2.cdn-perfprod.com/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
        {
            id: 'perfprod-eu3',
            name: 'Perfprod EU 3',
            url: 'https://lb-eu3.cdn-perfprod.com/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
        {
            id: 'perfprod-eu4',
            name: 'Perfprod EU 4',
            url: 'https://lb-eu4.cdn-perfprod.com/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
        {
            id: 'perfprod-na',
            name: 'Perfprod NA',
            url: 'https://lb-na.cdn-perfprod.com/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
        {
            id: 'perfprod-as',
            name: 'Perfprod Asia',
            url: 'https://lb-as.cdn-perfprod.com/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        },
        {
            id: 'perfprod-sa',
            name: 'Perfprod SA',
            url: 'https://lb-sa.cdn-perfprod.com/live/{channel}?allow_source=true&allow_audio_only=true&fast_bread=true',
            enabled: true
        }
    ];

    console.log('[TwitchProxy] ===== SCRIPT START =====');

    var NativeWorker = window.Worker;

    if (!NativeWorker) {
        console.error('[TwitchProxy] ERREUR: Worker introuvable');
        return;
    }

    console.log('[TwitchProxy] Native Worker trouvé');


    // ============================================================
    // CONFIGURATION
    // ============================================================

    function createDefaultProxy(p) {

        return {
            id: p.id,
            name: p.name,
            url: p.url,
            enabled: p.enabled
        };

    }


    function generateCustomProxyId() {

        return (
            'custom-' +
            Date.now().toString(36) +
            '-' +
            Math.random()
                .toString(36)
                .substring(2, 9)
        );

    }


    function isDefaultProxy(id) {

        return DEFAULT_PROXIES.some(function (p) {
            return p.id === id;
        });

    }


    // ------------------------------------------------------------
    // Habillage visuel des proxys (icône + couleur) dans le menu
    // ------------------------------------------------------------

    var PROXY_REGION_META = {
        eu: { icon: '🇪🇺', accent: '#4fc3f7' },
        na: { icon: '🇺🇸', accent: '#ff9d4d' },
        as: { icon: '🌏', accent: '#00d084' },
        sa: { icon: '🌎', accent: '#ff8fd6' }
    };

    // Basé sur l'id (ex: "perfprod-eu5", "luminous-as") plutôt que
    // le nom, pour éviter les faux positifs ("Nadeko" contient "na").
    function getProxyRegion(proxy) {

        var match = (proxy.id || '').toLowerCase().match(/-(eu|na|as|sa)\d*$/);

        return match ? match[1] : null;

    }

    function getProxyIcon(proxy) {

        if (proxy.custom) {
            return '⚙️';
        }

        var region = getProxyRegion(proxy);

        return (region && PROXY_REGION_META[region].icon) || '📡';

    }

    function getProxyAccent(proxy) {

        if (proxy.custom) {
            return '#bf94ff';
        }

        var region = getProxyRegion(proxy);

        return (region && PROXY_REGION_META[region].accent) || '#9147ff';

    }


    // Construit un objet config valide (proxys fusionnés avec les
    // défauts, champs validés) à partir d'un objet arbitraire —
    // utilisé à la fois pour charger depuis localStorage et pour
    // l'import d'un fichier JSON exporté.
    function buildConfigFromParsed(parsed) {

        var config = {
            proxies: DEFAULT_PROXIES.map(
                createDefaultProxy
            ),
            fallback: true,
            timeout: DEFAULT_TIMEOUT,
            cacheDelay: DEFAULT_CACHE_DELAY,
            keepQualityInBackground: true
        };

        if (!parsed || typeof parsed !== 'object') {
            return config;
        }

        if (
            Array.isArray(parsed.proxies)
        ) {

            var ordered = [];

            parsed.proxies.forEach(
                function (savedProxy) {

                    if (
                        !savedProxy ||
                        !savedProxy.id
                    ) {
                        return;
                    }


                    var original =
                        DEFAULT_PROXIES.find(
                            function (p) {
                                return (
                                    p.id ===
                                    savedProxy.id
                                );
                            }
                        );


                    // ------------------------------------------------
                    // Proxy par défaut
                    // ------------------------------------------------

                    if (original) {

                        ordered.push({

                            id: original.id,

                            name: original.name,

                            url: original.url,

                            enabled:
                                !!savedProxy.enabled,

                            lastTest:
                                savedProxy.lastTest ||
                                null

                        });

                        return;

                    }


                    // ------------------------------------------------
                    // Proxy personnalisé
                    // ------------------------------------------------

                    if (
                        savedProxy.name &&
                        savedProxy.url &&
                        savedProxy.url.indexOf(
                            '{channel}'
                        ) >= 0
                    ) {

                        ordered.push({

                            id:
                                savedProxy.id,

                            name:
                                savedProxy.name,

                            url:
                                savedProxy.url,

                            enabled:
                                savedProxy.enabled !== false,

                            custom:
                                true,

                            lastTest:
                                savedProxy.lastTest ||
                                null

                        });

                    }

                }
            );


            // ------------------------------------------------
            // Ajoute les nouveaux proxys par défaut absents
            // ------------------------------------------------

            DEFAULT_PROXIES.forEach(
                function (original) {

                    var exists =
                        ordered.some(
                            function (p) {
                                return (
                                    p.id ===
                                    original.id
                                );
                            }
                        );


                    if (!exists) {

                        ordered.push(
                            createDefaultProxy(
                                original
                            )
                        );

                    }

                }
            );


            config.proxies =
                ordered;

        }


        if (
            typeof parsed.fallback ===
            'boolean'
        ) {

            config.fallback =
                parsed.fallback;

        }


        if (
            typeof parsed.timeout ===
            'number' &&
            parsed.timeout >= 1000 &&
            parsed.timeout <= 30000
        ) {

            config.timeout =
                parsed.timeout;

        }

        if (
            typeof parsed.cacheDelay ===
            'number' &&
            parsed.cacheDelay >= 1 &&
            parsed.cacheDelay <= 180
        ) {

            config.cacheDelay =
                parsed.cacheDelay;

        }

        if (
            typeof parsed.keepQualityInBackground ===
            'boolean'
        ) {

            config.keepQualityInBackground =
                parsed.keepQualityInBackground;

        }

        return config;

    }


    function loadConfig() {

        try {

            var saved =
                localStorage.getItem(
                    STORAGE_KEY
                );

            if (saved) {

                return buildConfigFromParsed(
                    JSON.parse(saved)
                );

            }

        } catch (e) {

            console.warn(
                '[TwitchProxy] Configuration invalide:',
                e
            );

        }

        return buildConfigFromParsed(
            null
        );

    }


    function saveConfig(config) {

        try {

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(config)
            );

        } catch (e) {

            console.warn(
                '[TwitchProxy] Impossible de sauvegarder:',
                e
            );

        }

    }


    // ============================================================
    // VÉRIFICATION DE MISE À JOUR
    // ============================================================

    // Compare deux versions "x.y.z" (nombre de segments variable).
    // Retourne true si `latest` est strictement plus récente que
    // `current`.
    function isNewerVersion(latest, current) {

        var a = String(latest).split('.').map(Number);
        var b = String(current).split('.').map(Number);

        var len = Math.max(a.length, b.length);

        for (var i = 0; i < len; i++) {

            var x = a[i] || 0;
            var y = b[i] || 0;

            if (x > y) return true;
            if (x < y) return false;

        }

        return false;

    }

    function loadUpdateCheck() {

        try {

            var saved = localStorage.getItem(UPDATE_CHECK_KEY);

            if (saved) {
                return JSON.parse(saved) || {};
            }

        } catch (e) {}

        return {};

    }

    function saveUpdateCheck(data) {

        try {

            localStorage.setItem(
                UPDATE_CHECK_KEY,
                JSON.stringify(data)
            );

        } catch (e) {}

    }

    // null tant qu'aucune mise à jour n'est détectée, sinon
    // { version: "x.y.z" }.
    var availableUpdate = null;

    var updateCheckState = loadUpdateCheck();

    if (
        updateCheckState.latestVersion &&
        isNewerVersion(updateCheckState.latestVersion, CURRENT_VERSION)
    ) {

        availableUpdate = { version: updateCheckState.latestVersion };

    }

    function applyUpdateCheckResult(latestVersion) {

        updateCheckState.latestVersion = latestVersion;
        updateCheckState.lastCheck = Date.now();

        saveUpdateCheck(updateCheckState);

        if (isNewerVersion(latestVersion, CURRENT_VERSION)) {
            availableUpdate = { version: latestVersion };
        } else {
            availableUpdate = null;
        }

        updateUpdateUI();

    }

    // Interroge le raw GitHub du script (même URL que @updateURL) et
    // en extrait le numéro de version depuis l'en-tête UserScript,
    // sans dépendre du check auto de Tampermonkey (on veut notre
    // propre badge/bannière dans le menu).
    function checkForScriptUpdate(force) {

        var now = Date.now();

        if (
            !force &&
            updateCheckState.lastCheck &&
            (now - updateCheckState.lastCheck) < UPDATE_CHECK_INTERVAL_MS
        ) {
            return;
        }

        fetch(UPDATE_CHECK_URL, { cache: 'no-store' })
            .then(function (response) {
                return response.text();
            })
            .then(function (text) {

                var match = text.match(/@version\s+([\d.]+)/);

                if (match) {
                    applyUpdateCheckResult(match[1]);
                }

            })
            .catch(function (e) {

                console.warn('[TwitchProxy] Vérification de mise à jour impossible:', e);

            });

    }


    // ============================================================
    // EXPORT / IMPORT DE LA CONFIGURATION
    // ============================================================

    function exportConfig() {

        try {

            // On exporte une config "propre" : ni les résultats de
            // test (lastTest), ni rien de lié au réseau/à la chaîne
            // regardée au moment de l'export — juste la structure
            // des proxys et les réglages, réutilisable tel quel.
            var cleanConfig = {

                proxies:
                    pageConfig.proxies.map(
                        function (proxy) {

                            var clean = {
                                id: proxy.id,
                                name: proxy.name,
                                url: proxy.url,
                                enabled: proxy.enabled
                            };

                            if (proxy.custom) {
                                clean.custom = true;
                            }

                            return clean;

                        }
                    ),

                fallback:
                    pageConfig.fallback,

                timeout:
                    pageConfig.timeout,

                cacheDelay:
                    pageConfig.cacheDelay,

                keepQualityInBackground:
                    pageConfig.keepQualityInBackground

            };

            var json =
                JSON.stringify(
                    cleanConfig,
                    null,
                    2
                );

            var blob =
                new Blob(
                    [json],
                    { type: 'application/json' }
                );

            var url =
                URL.createObjectURL(
                    blob
                );

            var link =
                document.createElement(
                    'a'
                );

            link.href = url;

            link.download =
                'twitch-proxy-config.json';

            document.body.appendChild(
                link
            );

            link.click();

            document.body.removeChild(
                link
            );

            setTimeout(
                function () {

                    URL.revokeObjectURL(
                        url
                    );

                },
                1000
            );

        } catch (e) {

            console.warn(
                '[TwitchProxy] Export impossible:',
                e
            );

            alert(
                "Impossible d'exporter la configuration."
            );

        }

    }


    function importConfigFromFile(file) {

        var reader =
            new FileReader();

        reader.onload =
            function () {

                try {

                    var parsed =
                        JSON.parse(
                            reader.result
                        );

                    pageConfig =
                        buildConfigFromParsed(
                            parsed
                        );

                    saveConfig(
                        pageConfig
                    );

                    broadcastConfig();

                    renderDashboard();

                    alert(
                        'Configuration importée avec succès.'
                    );

                } catch (e) {

                    console.warn(
                        '[TwitchProxy] Import impossible:',
                        e
                    );

                    alert(
                        "Fichier invalide : impossible d'importer cette configuration."
                    );

                }

            };

        reader.onerror =
            function () {

                alert(
                    'Erreur de lecture du fichier.'
                );

            };

        reader.readAsText(
            file
        );

    }


    var pageConfig =
        loadConfig();


    // ============================================================
    // STATISTIQUES & LOGS (DASHBOARD)
    // ============================================================

    var STATS_HISTORY_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
    var STATS_MAX_LOGS = 300;

    // Table de bitrate approximative (kbps) par hauteur de vidéo,
    // utilisée pour ESTIMER la bande passante consommée (les
    // segments vidéo ne repassent pas par le fetch intercepté une
    // fois le manifest résolu par le proxy, donc pas de comptage
    // réseau exact possible ici).
    var BANDWIDTH_TABLE = [
        { minHeight: 1080, kbps: 6000 },
        { minHeight: 900, kbps: 4500 },
        { minHeight: 720, kbps: 3500 },
        { minHeight: 480, kbps: 1500 },
        { minHeight: 360, kbps: 800 },
        { minHeight: 160, kbps: 400 },
        { minHeight: 0, kbps: 200 }
    ];

    function defaultStats() {

        return {
            proxyUsage: {},
            proxyHistory: {},
            bandwidthByProxy: {},
            streamers: {},
            logs: [],
            totals: {
                chatMessagesGlobal: 0,
                bandwidthBytesGlobal: 0,
                watchTimeMsGlobal: 0,
                testsCount: 0
            }
        };

    }

    function loadStats() {

        try {

            var saved = localStorage.getItem(STATS_KEY);

            if (saved) {

                var parsed = JSON.parse(saved);

                var stats = defaultStats();

                if (parsed && typeof parsed === 'object') {

                    stats.proxyUsage = parsed.proxyUsage || {};
                    stats.proxyHistory = parsed.proxyHistory || {};
                    stats.bandwidthByProxy = parsed.bandwidthByProxy || {};
                    stats.streamers = parsed.streamers || {};
                    stats.logs = Array.isArray(parsed.logs) ? parsed.logs : [];

                    stats.totals = Object.assign(
                        defaultStats().totals,
                        parsed.totals || {}
                    );

                }

                return stats;

            }

        } catch (e) {

            console.warn('[TwitchProxy] Stats invalides:', e);

        }

        return defaultStats();

    }

    var pageStats = loadStats();

    logEvent('info', 'Script démarré');

    var statsSaveTimer = null;

    function saveStatsNow() {

        try {

            localStorage.setItem(
                STATS_KEY,
                JSON.stringify(pageStats)
            );

        } catch (e) {

            console.warn('[TwitchProxy] Impossible de sauvegarder les stats:', e);

        }

    }

    // Les mises à jour de stats (bande passante, tchat, ...) sont
    // fréquentes : on regroupe les écritures localStorage pour
    // éviter de sérialiser tout l'objet à chaque événement.
    function scheduleStatsSave() {

        if (statsSaveTimer) {
            return;
        }

        statsSaveTimer = setTimeout(
            function () {

                statsSaveTimer = null;
                saveStatsNow();

            },
            2000
        );

    }

    // Chaque onglet twitch.tv a sa PROPRE copie en mémoire de
    // pageStats, et la sauvegarde régulièrement (bande passante,
    // tchat, ...). Sans ça, un reset fait depuis un onglet est
    // silencieusement écrasé quelques secondes plus tard par un
    // autre onglet qui re-flush son ancien pageStats accumulé. On
    // écoute donc les changements de STATS_KEY faits par les AUTRES
    // onglets (l'event 'storage' ne se déclenche jamais dans
    // l'onglet qui a lui-même écrit) pour resynchroniser partout.
    window.addEventListener('storage', function (event) {

        if (event.key !== STATS_KEY) {
            return;
        }

        pageStats = loadStats();

        if (
            typeof statsDashboardVisible !== 'undefined' &&
            statsDashboardVisible
        ) {

            // silent = true : resynchro en arrière-plan, sans
            // rejouer l'animation d'entrée ni faire sauter le
            // scroll (sinon ça "clignote" à chaque écriture de
            // stats faite par un autre onglet, plusieurs fois par
            // minute).
            renderStatsDashboard(true);

        }

    });

    function getStreamerStats(channel) {

        if (!pageStats.streamers[channel]) {

            pageStats.streamers[channel] = {
                watchTimeMs: 0,
                chatMessages: 0,
                bandwidthBytes: 0,
                proxyUsage: {},
                messages: [],
                firstSeen: Date.now(),
                lastSeen: Date.now()
            };

        }

        ensureChannelMeta(channel, onChannelMetaUpdated);

        return pageStats.streamers[channel];

    }

    // ------------------------------------------------------------
    // NOM D'AFFICHAGE + AVATAR DES STREAMERS
    // ------------------------------------------------------------

    // Le "channel" qu'on manipule partout (extrait de l'URL) est
    // le login Twitch (toujours en minuscules, ex: "zerator"), pas
    // le nom affiché sur Twitch (ex: "ZeratoR"). On récupère les
    // deux via l'API GQL publique de Twitch (le même endpoint et
    // Client-Id que le site utilise lui-même côté navigateur pour
    // ses propres requêtes non authentifiées), avec un cache
    // localStorage pour éviter de la re-interroger à chaque fois.
    var CHANNEL_META_KEY = 'twitchProxyChannelMetaV1';
    var CHANNEL_META_TTL_MS = 24 * 60 * 60 * 1000; // 24h
    var TWITCH_GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

    function loadChannelMetaCache() {

        try {

            var saved = localStorage.getItem(CHANNEL_META_KEY);

            if (saved) {
                return JSON.parse(saved) || {};
            }

        } catch (e) {}

        return {};

    }

    var channelMetaCache = loadChannelMetaCache();
    var channelMetaFetchInFlight = {};

    function saveChannelMetaCache() {

        try {

            localStorage.setItem(
                CHANNEL_META_KEY,
                JSON.stringify(channelMetaCache)
            );

        } catch (e) {}

    }

    function getChannelMeta(channel) {

        return channelMetaCache[channel] || null;

    }

    function getStreamerDisplayName(channel) {

        var meta = getChannelMeta(channel);

        return (meta && meta.displayName) || channel;

    }

    function getStreamerAvatarUrl(channel) {

        var meta = getChannelMeta(channel);

        return meta ? meta.avatarUrl : null;

    }

    // Récupère (si besoin) le vrai nom affiché + l'avatar d'un
    // channel. `onUpdate` est rappelé une fois la donnée reçue,
    // pour rafraîchir silencieusement les vues déjà affichées.
    function ensureChannelMeta(channel, onUpdate) {

        if (!channel) {
            return;
        }

        var cached = channelMetaCache[channel];

        var isFresh =
            cached &&
            (Date.now() - cached.fetchedAt) < CHANNEL_META_TTL_MS;

        if (isFresh || channelMetaFetchInFlight[channel]) {
            return;
        }

        channelMetaFetchInFlight[channel] = true;

        fetch('https://gql.twitch.tv/gql', {

            method: 'POST',

            headers: {
                'Content-Type': 'text/plain;charset=UTF-8',
                'Client-Id': TWITCH_GQL_CLIENT_ID
            },

            body: JSON.stringify({
                query:
                    'query($login:String!){user(login:$login){displayName profileImageURL(width:70)}}',
                variables: { login: channel }
            })

        })
            .then(function (response) {
                return response.json();
            })
            .then(function (json) {

                var user =
                    json &&
                    json.data &&
                    json.data.user;

                channelMetaCache[channel] = {
                    displayName:
                        (user && user.displayName) || channel,
                    avatarUrl:
                        (user && user.profileImageURL) || null,
                    fetchedAt: Date.now()
                };

                saveChannelMetaCache();

                delete channelMetaFetchInFlight[channel];

                if (typeof onUpdate === 'function') {
                    onUpdate();
                }

            })
            .catch(function () {

                delete channelMetaFetchInFlight[channel];

            });

    }

    // Rafraîchit silencieusement le dashboard stats (s'il est
    // ouvert) une fois qu'un nom/avatar de streamer arrive.
    function onChannelMetaUpdated() {

        if (statsDashboard && statsDashboardVisible) {
            renderStatsDashboard(true);
        }

    }

    // ------------------------------------------------------------
    // LOGS
    // ------------------------------------------------------------

    function logEvent(level, message) {

        try {

            pageStats.logs.unshift({
                t: Date.now(),
                level: level,
                msg: String(message)
            });

            if (pageStats.logs.length > STATS_MAX_LOGS) {

                pageStats.logs.length = STATS_MAX_LOGS;

            }

            scheduleStatsSave();

            renderDashboardLogs();

        } catch (e) {}

    }

    // ------------------------------------------------------------
    // UTILISATION DES PROXYS
    // ------------------------------------------------------------

    function recordProxyUsage(proxyId, channel) {

        if (!proxyId) {
            return;
        }

        pageStats.proxyUsage[proxyId] =
            (pageStats.proxyUsage[proxyId] || 0) + 1;

        if (channel) {

            var streamer = getStreamerStats(channel);

            streamer.proxyUsage[proxyId] =
                (streamer.proxyUsage[proxyId] || 0) + 1;

        }

        scheduleStatsSave();

    }

    function recordProxyTest(proxyId, ok, latency) {

        if (!pageStats.proxyHistory[proxyId]) {

            pageStats.proxyHistory[proxyId] = [];

        }

        var history = pageStats.proxyHistory[proxyId];

        history.push({
            t: Date.now(),
            ok: !!ok,
            latency: typeof latency === 'number' ? latency : null
        });

        var cutoff = Date.now() - STATS_HISTORY_MS;

        while (history.length && history[0].t < cutoff) {
            history.shift();
        }

        pageStats.totals.testsCount++;

        scheduleStatsSave();

    }

    // Classement des proxys les plus rapides sur les 7 derniers
    // jours (moyenne des latences des tests réussis).
    function getProxyRanking24h() {

        var cutoff = Date.now() - STATS_HISTORY_MS;

        return pageConfig.proxies.map(function (proxy) {

            var history = pageStats.proxyHistory[proxy.id] || [];

            var recentOk = history.filter(function (entry) {
                return entry.t >= cutoff && entry.ok && typeof entry.latency === 'number';
            });

            var avgLatency = null;

            if (recentOk.length) {

                var sum = recentOk.reduce(function (acc, entry) {
                    return acc + entry.latency;
                }, 0);

                avgLatency = Math.round(sum / recentOk.length);

            }

            var recentAll = history.filter(function (entry) {
                return entry.t >= cutoff;
            });

            var successRate = recentAll.length
                ? Math.round((recentOk.length / recentAll.length) * 100)
                : null;

            return {
                id: proxy.id,
                name: proxy.name,
                avgLatency: avgLatency,
                testCount: recentAll.length,
                successRate: successRate,
                usage: pageStats.proxyUsage[proxy.id] || 0
            };

        }).sort(function (a, b) {

            if (a.avgLatency === null && b.avgLatency === null) return 0;
            if (a.avgLatency === null) return 1;
            if (b.avgLatency === null) return -1;

            return a.avgLatency - b.avgLatency;

        });

    }

    function getMostUsedProxy() {

        var bestId = null;
        var bestCount = 0;

        Object.keys(pageStats.proxyUsage).forEach(function (id) {

            if (pageStats.proxyUsage[id] > bestCount) {
                bestCount = pageStats.proxyUsage[id];
                bestId = id;
            }

        });

        if (!bestId) {
            return null;
        }

        var proxy = pageConfig.proxies.find(function (p) {
            return p.id === bestId;
        });

        return {
            id: bestId,
            name: proxy ? proxy.name : bestId,
            count: bestCount
        };

    }

    // Streamer avec le plus de temps de visionnage cumulé.
    function getTopStreamerByWatchTime() {

        var best = null;

        Object.keys(pageStats.streamers).forEach(function (channel) {

            var watchTimeMs = pageStats.streamers[channel].watchTimeMs;

            if (watchTimeMs > 0 && (!best || watchTimeMs > best.watchTimeMs)) {
                best = { channel: channel, watchTimeMs: watchTimeMs };
            }

        });

        return best;

    }

    // Streamer à qui TU as envoyé le plus de messages de tchat.
    function getTopStreamerByChatMessages() {

        var best = null;

        Object.keys(pageStats.streamers).forEach(function (channel) {

            var chatMessages = pageStats.streamers[channel].chatMessages;

            if (chatMessages > 0 && (!best || chatMessages > best.chatMessages)) {
                best = { channel: channel, chatMessages: chatMessages };
            }

        });

        return best;

    }

    // ------------------------------------------------------------
    // TCHAT — uniquement TES messages envoyés
    // ------------------------------------------------------------

    // On ne compte QUE les messages que TOI tu envoies. Twitch
    // n'envoie plus forcément les messages du tchat web via le
    // WebSocket IRC classique (une ancienne version de ce script
    // le supposait, et ça ne comptait plus rien) : on détecte donc
    // l'envoi directement sur l'UI — appui sur Entrée dans la zone
    // de saisie, ou clic sur le bouton "Envoyer" — ce qui est
    // indépendant du transport réseau utilisé en interne par Twitch.
    var CHAT_INPUT_SELECTOR = '[data-a-target="chat-input"]';
    var CHAT_SEND_BUTTON_SELECTOR = '[data-a-target="chat-send-button"]';

    // event.target peut être un nœud texte à l'intérieur d'une zone
    // contenteditable, qui n'a pas de .closest().
    function closestElement(node, selector) {

        var el = node && node.nodeType === 1 ? node : (node && node.parentElement);

        return el ? el.closest(selector) : null;

    }

    var CHAT_HISTORY_MAX_PER_STREAMER = 300;

    function recordOwnChatMessage(text) {

        var channel = getTestChannel();

        if (!channel) {
            return;
        }

        pageStats.totals.chatMessagesGlobal++;

        var streamer = getStreamerStats(channel);

        streamer.chatMessages++;
        streamer.lastSeen = Date.now();

        if (!Array.isArray(streamer.messages)) {
            streamer.messages = [];
        }

        if (text) {

            streamer.messages.push({
                t: Date.now(),
                text: text
            });

            if (streamer.messages.length > CHAT_HISTORY_MAX_PER_STREAMER) {
                streamer.messages.shift();
            }

        }

        scheduleStatsSave();

    }

    function setupChatSendDetection() {

        document.addEventListener(
            'keydown',
            function (event) {

                if (
                    event.key !== 'Enter' ||
                    event.shiftKey ||
                    event.isComposing
                ) {
                    return;
                }

                var input =
                    closestElement(event.target, CHAT_INPUT_SELECTOR);

                if (!input) {
                    return;
                }

                var text =
                    (input.innerText || input.textContent || '').trim();

                if (!text) {
                    return;
                }

                recordOwnChatMessage(text);

            },
            true
        );

        document.addEventListener(
            'click',
            function (event) {

                var button =
                    closestElement(event.target, CHAT_SEND_BUTTON_SELECTOR);

                if (!button) {
                    return;
                }

                var input =
                    document.querySelector(CHAT_INPUT_SELECTOR);

                var text =
                    input
                        ? (input.innerText || input.textContent || '').trim()
                        : '';

                if (!text) {
                    return;
                }

                recordOwnChatMessage(text);

            },
            true
        );

    }

    setupChatSendDetection();

    // ------------------------------------------------------------
    // BANDE PASSANTE + TEMPS DE VISIONNAGE (estimation)
    // ------------------------------------------------------------

    function estimateKbpsForHeight(height) {

        for (var i = 0; i < BANDWIDTH_TABLE.length; i++) {

            if (height >= BANDWIDTH_TABLE[i].minHeight) {
                return BANDWIDTH_TABLE[i].kbps;
            }

        }

        return BANDWIDTH_TABLE[BANDWIDTH_TABLE.length - 1].kbps;

    }

    var BANDWIDTH_TICK_MS = 5000;

    function trackBandwidthAndWatchTime() {

        var channel = getTestChannel();

        if (!channel) {
            return;
        }

        var video = document.querySelector('video');

        if (!video || video.paused || video.ended || video.readyState < 2) {
            return;
        }

        var kbps = estimateKbpsForHeight(video.videoHeight || 0);

        var bytes = Math.round((kbps * 1000 / 8) * (BANDWIDTH_TICK_MS / 1000));

        var streamer = getStreamerStats(channel);

        streamer.watchTimeMs += BANDWIDTH_TICK_MS;
        streamer.bandwidthBytes += bytes;
        streamer.lastSeen = Date.now();

        pageStats.totals.watchTimeMsGlobal += BANDWIDTH_TICK_MS;
        pageStats.totals.bandwidthBytesGlobal += bytes;

        if (
            activeProxyInfo &&
            !activeProxyInfo.direct &&
            activeProxyInfo.channel === channel &&
            activeProxyInfo.proxyId
        ) {

            pageStats.bandwidthByProxy[activeProxyInfo.proxyId] =
                (pageStats.bandwidthByProxy[activeProxyInfo.proxyId] || 0) + bytes;

        }

        scheduleStatsSave();

    }

    function formatBytes(bytes) {

        if (!bytes) {
            return '0 Mo';
        }

        var mb = bytes / (1024 * 1024);

        // Passe en Go dès 1000 Mo plutôt qu'à 1024, pour éviter
        // d'afficher des valeurs à 3-4 chiffres pleines de zéros.
        if (mb >= 1000) {
            return (mb / 1000).toFixed(2) + ' Go';
        }

        return mb.toFixed(1) + ' Mo';

    }

    function formatDuration(ms) {

        if (!ms) {
            return '0 min';
        }

        var totalMinutes = Math.round(ms / 60000);

        var hours = Math.floor(totalMinutes / 60);
        var minutes = totalMinutes % 60;

        if (hours > 0) {
            return hours + 'h' + (minutes < 10 ? '0' : '') + minutes;
        }

        return minutes + ' min';

    }


    // ============================================================
    // GARDER LA QUALITÉ QUAND L'ONGLET EST EN ARRIÈRE-PLAN
    // ============================================================

    (function setupBackgroundQualitySpoof() {

        try {

            var hiddenDescriptor =
                Object.getOwnPropertyDescriptor(
                    Document.prototype,
                    'hidden'
                );

            var visibilityStateDescriptor =
                Object.getOwnPropertyDescriptor(
                    Document.prototype,
                    'visibilityState'
                );

            if (
                !hiddenDescriptor ||
                !hiddenDescriptor.get ||
                !visibilityStateDescriptor ||
                !visibilityStateDescriptor.get
            ) {
                return;
            }

            Object.defineProperty(document, 'hidden', {
                configurable: true,
                get: function () {

                    if (pageConfig.keepQualityInBackground) {
                        return false;
                    }

                    return hiddenDescriptor.get.call(document);

                }
            });

            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: function () {

                    if (pageConfig.keepQualityInBackground) {
                        return 'visible';
                    }

                    return visibilityStateDescriptor.get.call(document);

                }
            });

            // Enregistré au tout début (document-start) : bloque
            // les listeners "visibilitychange" enregistrés plus
            // tard par Twitch quand l'option est activée.
            document.addEventListener(
                'visibilitychange',
                function (event) {

                    if (pageConfig.keepQualityInBackground) {
                        event.stopImmediatePropagation();
                    }

                },
                true
            );

        } catch (e) {

            console.warn(
                '[TwitchProxy] Spoof visibilité impossible:',
                e
            );

        }

    })();


    // ============================================================
    // BROADCAST CONFIG VERS LES WORKERS
    // ============================================================

    var configChannel = null;

    try {

        configChannel =
            new BroadcastChannel(
                'twitch-proxy-config-v1'
            );

    } catch (e) {

        console.warn(
            '[TwitchProxy] BroadcastChannel indisponible'
        );

    }


    function broadcastConfig() {

        if (!configChannel) {
            return;
        }

        try {

            configChannel.postMessage({
                type: 'config',
                config: pageConfig
            });

        } catch (e) {}

    }


    // Info sur le proxy réellement utilisé pour la lecture en
    // cours, remontée par le Worker via le même BroadcastChannel.
    var activeProxyInfo = null;

    if (configChannel) {

        configChannel.addEventListener(
            'message',
            function (event) {

                try {

                    if (
                        event.data &&
                        event.data.type === 'activeProxy'
                    ) {

                        // BroadcastChannel est partagé par TOUS les
                        // onglets twitch.tv, pas seulement celui qui
                        // a lancé le Worker (aperçus vidéo sur
                        // l'accueil, un autre stream ouvert dans un
                        // autre onglet, l'onglet dashboard, ...).
                        // Sans ce filtre AVANT d'écraser
                        // activeProxyInfo, l'affichage "proxy actif"
                        // de CET onglet disparaissait sporadiquement
                        // en cours de stream dès qu'un autre onglet
                        // twitch.tv déclenchait son propre fetch HLS
                        // (l'ancienne info valide était alors
                        // remplacée par celle d'un channel différent,
                        // qui ne matchait plus et masquait l'affichage
                        // jusqu'au prochain fetch de CET onglet).
                        var isThisTabChannel =
                            event.data.channel &&
                            event.data.channel === getTestChannel();

                        if (!isThisTabChannel) {
                            return;
                        }

                        activeProxyInfo =
                            event.data;

                        if (
                            activeProxyInfo.proxyId &&
                            !activeProxyInfo.direct
                        ) {

                            recordProxyUsage(
                                activeProxyInfo.proxyId,
                                activeProxyInfo.channel
                            );

                            logEvent(
                                'success',
                                'Proxy actif : ' +
                                activeProxyInfo.proxyName +
                                ' (' + activeProxyInfo.channel + ')'
                            );

                        } else if (
                            activeProxyInfo.direct
                        ) {

                            logEvent(
                                'warn',
                                'Aucun proxy disponible, lecture directe Twitch (' +
                                activeProxyInfo.channel + ')'
                            );

                        }

                        renderDashboard();

                    }

                    if (
                        event.data &&
                        event.data.type === 'log'
                    ) {

                        logEvent(
                            event.data.level || 'info',
                            event.data.msg || ''
                        );

                    }

                } catch (e) {}

            }
        );

    }


    // ============================================================
    // DASHBOARD
    // ============================================================

    var dashboard = null;
    var dashboardButton = null;
    var dashboardVisible = false;


    function createDashboard() {

        if (dashboard) {
            return;
        }


        dashboard =
            document.createElement('div');


        dashboard.id =
            'tp9-dashboard';


        dashboard.innerHTML = `

            <div class="tp9-header">

                <div class="tp9-brand">

                    <div class="tp9-brand-icon">
                        ⚡
                    </div>

                    <div class="tp9-brand-text">
                        <div class="tp9-title">Twitch HLS Proxy</div>
                        <div class="tp9-subtitle">PROXY MANAGER</div>
                    </div>

                </div>

                <button
                    class="tp9-close"
                    type="button"
                >
                    ×
                </button>

            </div>


            <div class="tp9-content">

<div class="tp9-update-banner" style="display:none;">
    <div class="tp9-update-icon">⬆️</div>
    <div class="tp9-update-text">
        <div class="tp9-update-title">Nouvelle mise à jour disponible</div>
        <div class="tp9-update-version"></div>
        <div class="tp9-update-hint">Actualise la page une fois installée</div>
    </div>
    <button class="tp9-update-btn" type="button">Mettre à jour</button>
</div>

<div class="tp9-active-proxy"></div>

<div class="tp9-section-title tp9-proxy-title-row">
    <span>📡 PROXYS</span>
    <span class="tp9-proxy-count"></span>
</div>

<div class="tp9-proxy-list"></div>

<button
    class="tp9-add-proxy"
    type="button"
>
    ＋ Ajouter un proxy
</button>

<div class="tp9-add-container"></div>

<div class="tp9-divider"></div>

<div class="tp9-section-title">⚙️ RÉGLAGES</div>

<div class="tp9-settings-list">

    <label class="tp9-toggle-row">
        <span class="tp9-toggle-label">
            <span class="tp9-toggle-icon">🔁</span>
            Fallback automatique
        </span>
        <span class="tp9-switch">
            <input type="checkbox" class="tp9-fallback">
            <span class="tp9-switch-track"></span>
        </span>
    </label>

    <label class="tp9-toggle-row">
        <span class="tp9-toggle-label">
            <span class="tp9-toggle-icon">🎬</span>
            Qualité en arrière-plan
        </span>
        <span class="tp9-switch">
            <input type="checkbox" class="tp9-keep-quality">
            <span class="tp9-switch-track"></span>
        </span>
    </label>

</div>

<div class="tp9-select-grid">

    <label class="tp9-select-field">

        <span class="tp9-select-label">Timeout</span>

        <select class="tp9-timeout-select">
            <option value="2000">2 s</option>
            <option value="3000">3 s</option>
            <option value="4000">4 s</option>
            <option value="5000">5 s</option>
            <option value="8000">8 s</option>
            <option value="10000">10 s</option>
        </select>

    </label>

    <label class="tp9-select-field">

        <span class="tp9-select-label">Re-test auto</span>

        <select class="tp9-cache-select">
            <option value="5">5 min</option>
            <option value="10">10 min</option>
            <option value="20">20 min</option>
            <option value="30">30 min</option>
            <option value="60">1 heure</option>
            <option value="180">3 heures</option>
        </select>

    </label>

</div>

<div class="tp9-divider"></div>

<div class="tp9-actions">

    <button class="tp9-test" type="button">
        <span class="tp9-btn-icon">🧪</span> Tester
    </button>

    <button class="tp9-reset" type="button">
        <span class="tp9-btn-icon">🔄</span> Reset
    </button>

</div>

<div class="tp9-actions tp9-actions-secondary">

    <button class="tp9-export" type="button">
        <span class="tp9-btn-icon">📤</span> Export
    </button>

    <button class="tp9-import" type="button">
        <span class="tp9-btn-icon">📥</span> Import
    </button>

</div>

<button class="tp9-open-stats" type="button">
    📊 Ouvrir le dashboard complet
</button>

<input
    type="file"
    class="tp9-import-file"
    accept="application/json"
    style="display:none;"
>

<div class="tp9-current-card">
    <span class="tp9-current-icon">📶</span>
    <span class="tp9-current">Aucun proxy testé</span>
</div>

            </div>

        `;


        document.body.appendChild(
    dashboard
);


document.addEventListener(
    'click',
    function (event) {

        if (
            !dashboardVisible
        ) {
            return;
        }

        if (
            event.target.closest(
                '#tp9-dashboard'
            ) ||
            event.target.closest(
                '#tp9-player-button'
            )
        ) {
            return;
        }

        hideDashboard();

    }
);


        injectDashboardCSS();


        dashboard
            .querySelector('.tp9-close')
            .addEventListener(
                'click',
                function () {

                    hideDashboard();

                }
            );


        dashboard
            .querySelector('.tp9-fallback')
            .addEventListener(
                'change',
                function (event) {

                    pageConfig.fallback =
                        event.target.checked;

                    saveConfig(pageConfig);

                    broadcastConfig();

                    renderDashboard();

                }
            );


        dashboard
            .querySelector('.tp9-keep-quality')
            .addEventListener(
                'change',
                function (event) {

                    pageConfig.keepQualityInBackground =
                        event.target.checked;

                    saveConfig(pageConfig);

                    renderDashboard();

                }
            );


        dashboard
            .querySelector('.tp9-timeout-select')
            .addEventListener(
                'change',
                function (event) {

                    pageConfig.timeout =
                        parseInt(
                            event.target.value,
                            10
                        );

                    saveConfig(pageConfig);

                    broadcastConfig();

                }
            );

        dashboard
            .querySelector('.tp9-cache-select')
            .addEventListener(
                'change',
                function (event) {

                    pageConfig.cacheDelay =
                        parseInt(
                            event.target.value,
                            10
                        );

                    saveConfig(pageConfig);

                    broadcastConfig();

                }
            );


        dashboard
            .querySelector('.tp9-test')
            .addEventListener(
                'click',
                function () {

                    if (testInProgress) {

                        alert(
                            'Un test est déjà en cours, merci de patienter.'
                        );

                        return;

                    }

                    var btn = this;

                    setButtonBusy(btn, '⏳ Test en cours...');

                    testAllProxies().finally(
                        function () {

                            clearButtonBusy(btn);

                        }
                    );

                }
            );


        dashboard
            .querySelector('.tp9-reset')
            .addEventListener(
                'click',
                function () {

                    if (testInProgress) {

                        alert(
                            'Un test est déjà en cours, merci de patienter.'
                        );

                        return;

                    }

                    if (
                        !confirm(
                            'Réinitialiser les proxys ?\n\n' +
                            'Les proxys personnalisés seront supprimés.'
                        )
                    ) {
                        return;
                    }


                    pageConfig = {

                        proxies:
                            DEFAULT_PROXIES.map(
                                createDefaultProxy
                            ),

                        fallback: true,

                        timeout:
                            DEFAULT_TIMEOUT,

                        cacheDelay:
                            DEFAULT_CACHE_DELAY,

                        keepQualityInBackground:
                            true

                    };


                    saveConfig(
                        pageConfig
                    );

                    broadcastConfig();

                    renderDashboard();

                    // Sans ça, les proxys restent "non testés"
                    // jusqu'au prochain re-test périodique (jusqu'à
                    // 60s d'attente) : on relance un test complet
                    // immédiatement après le reset.
                    var btn = this;

                    setButtonBusy(btn, '⏳ Test en cours...');

                    testAllProxies().finally(
                        function () {

                            clearButtonBusy(btn);

                        }
                    );

                }
            );


        dashboard
            .querySelector('.tp9-export')
            .addEventListener(
                'click',
                function () {

                    exportConfig();

                }
            );


        dashboard
            .querySelector('.tp9-import')
            .addEventListener(
                'click',
                function () {

                    dashboard
                        .querySelector(
                            '.tp9-import-file'
                        )
                        .click();

                }
            );


        dashboard
            .querySelector('.tp9-import-file')
            .addEventListener(
                'change',
                function (event) {

                    var file =
                        event.target.files &&
                        event.target.files[0];

                    if (!file) {
                        return;
                    }

                    if (
                        !confirm(
                            'Importer cette configuration ?\n\n' +
                            'Elle remplacera entièrement la configuration actuelle.'
                        )
                    ) {

                        event.target.value = '';

                        return;

                    }

                    importConfigFromFile(file);

                    event.target.value = '';

                }
            );


        dashboard
            .querySelector('.tp9-add-proxy')
            .addEventListener(
                'click',
                function () {

                    showAddProxyForm();

                }
            );


        dashboard
            .querySelector('.tp9-open-stats')
            .addEventListener(
                'click',
                function () {

                    hideDashboard();
                    openStatsDashboardInNewTab();

                }
            );


        dashboard
            .querySelector('.tp9-update-btn')
            .addEventListener(
                'click',
                function () {

                    // Ouvre le .user.js brut dans un nouvel onglet :
                    // Tampermonkey détecte l'URL et propose
                    // automatiquement l'installation/mise à jour.
                    window.open(UPDATE_CHECK_URL, '_blank');

                    // Le code de CET onglet reste l'ancien tant
                    // qu'il n'est pas rechargé (Tampermonkey ne peut
                    // pas "recharger à chaud" un script déjà en
                    // cours d'exécution) : on laisse le temps de
                    // valider l'install dans l'autre onglet, puis on
                    // propose de rafraîchir pour faire disparaître
                    // le badge/la bannière.
                    setTimeout(
                        function () {

                            if (
                                confirm(
                                    'As-tu terminé la mise à jour dans l\'autre onglet ?\n\n' +
                                    'Actualiser cette page maintenant pour appliquer la nouvelle version ?'
                                )
                            ) {

                                location.reload();

                            }

                        },
                        4000
                    );

                }
            );


        renderDashboard();

        updateUpdateUI();

    }


    // ------------------------------------------------------------
    // BADGE / BANNIÈRE DE MISE À JOUR
    // ------------------------------------------------------------

    function updateUpdateUI() {

        if (dashboardButton) {

            var badge =
                dashboardButton.querySelector(
                    '.tp9-update-badge'
                );

            if (badge) {

                badge.style.display =
                    availableUpdate ? 'block' : 'none';

            }

        }

        if (dashboard) {

            var banner =
                dashboard.querySelector(
                    '.tp9-update-banner'
                );

            if (banner) {

                if (availableUpdate) {

                    banner.style.display = 'flex';

                    banner
                        .querySelector('.tp9-update-version')
                        .textContent =
                        'Version ' + availableUpdate.version;

                } else {

                    banner.style.display = 'none';

                }

            }

        }

    }


    // ============================================================
    // RENDU DASHBOARD
    // ============================================================

    function renderDashboard() {

        if (!dashboard) {
            return;
        }


        var list =
            dashboard.querySelector(
                '.tp9-proxy-list'
            );


        list.innerHTML = '';


        var enabledCount =
            pageConfig.proxies.filter(
                function (p) {
                    return p.enabled;
                }
            ).length;


        dashboard
            .querySelector(
                '.tp9-proxy-count'
            )
            .textContent =
            enabledCount +
            ' / ' +
            pageConfig.proxies.length +
            ' actifs';


        pageConfig.proxies.forEach(
            function (proxy, index) {

                var row =
                    document.createElement(
                        'div'
                    );


                row.className =
                    'tp9-proxy' +
                    (proxy.enabled ? '' : ' tp9-proxy-disabled');


                row.style.setProperty(
                    '--accent',
                    getProxyAccent(proxy)
                );


                var lastTest =
                    proxy.lastTest;


                var statusText =
                    '⚪ non testé';


                var statusClass =
                    'tp9-status-never';


                if (lastTest) {

                    if (
                        lastTest.ok
                    ) {

                        statusText =
                            '🟢 OK · ' +
                            lastTest.latency +
                            ' ms';

                        statusClass =
                            'tp9-status-ok';

                    } else {

                        statusText =
                            '🔴 ' +
                            lastTest.status;

                        if (
                            lastTest.latency
                        ) {

                            statusText +=
                                ' · ' +
                                lastTest.latency +
                                ' ms';

                        }

                        statusClass =
                            'tp9-status-error';

                    }

                }


                var lastTestInfo =
                    '';


                if (
                    lastTest &&
                    lastTest.timestamp
                ) {

                    lastTestInfo =
                        '<span class="tp9-test-time">' +
                        escapeHTML(
                            formatTestDate(
                                lastTest.timestamp
                            )
                        ) +
                        '</span>';

                }


                var customBadge =
                    proxy.custom
                        ? '<span class="tp9-custom">CUSTOM</span>'
                        : '';


                var deleteButton =
                    proxy.custom
                        ? `
                            <button
                                class="tp9-delete"
                                type="button"
                                title="Supprimer"
                            >
                                ×
                            </button>
                        `
                        : '';


                row.innerHTML = `

                    <div class="tp9-proxy-main">

                        <input
                            type="checkbox"
                            class="tp9-enabled"
                            ${proxy.enabled ? 'checked' : ''}
                        >

                        <div class="tp9-proxy-avatar">
                            ${getProxyIcon(proxy)}
                        </div>

                        <div class="tp9-proxy-info">

                            <div class="tp9-proxy-name">

                                ${escapeHTML(proxy.name)}

                                ${customBadge}

                            </div>


                            <div
                                class="tp9-status ${statusClass}"
                                data-status="${escapeHTML(proxy.id)}"
                            >

                                ${escapeHTML(statusText)}

                                ${lastTestInfo}

                            </div>

                        </div>

                    </div>


                    ${
                        proxy.custom
                            ? '<div class="tp9-move">' + deleteButton + '</div>'
                            : ''
                    }

                `;


                function toggleProxyEnabled() {

                    proxy.enabled =
                        !proxy.enabled;

                    saveConfig(
                        pageConfig
                    );

                    broadcastConfig();

                    renderDashboard();

                }


                row
                    .querySelector(
                        '.tp9-enabled'
                    )
                    .addEventListener(
                        'click',
                        function (event) {

                            // Empêche le double-toggle : le clic sur
                            // la checkbox remonte aussi jusqu'au
                            // listener du "tp9-proxy-main" ci-dessous.
                            event.stopPropagation();

                        }
                    );


                row
                    .querySelector(
                        '.tp9-enabled'
                    )
                    .addEventListener(
                        'change',
                        function (event) {

                            proxy.enabled =
                                event.target.checked;

                            saveConfig(
                                pageConfig
                            );

                            broadcastConfig();

                            renderDashboard();

                        }
                    );


                // Toute la ligne (avatar, nom, statut) est cliquable
                // pour cocher/décocher le proxy, pas seulement la
                // petite case à cocher.
                row
                    .querySelector(
                        '.tp9-proxy-main'
                    )
                    .addEventListener(
                        'click',
                        function (event) {

                            // Le clic recrée la ligne via
                            // renderDashboard() (elle est détachée
                            // du DOM), donc s'il continuait à
                            // remonter, le listener global "clic en
                            // dehors du menu" ne retrouverait plus
                            // son ancêtre #tp9-dashboard via
                            // closest() et fermerait le menu à tort.
                            event.stopPropagation();

                            toggleProxyEnabled();

                        }
                    );


                if (proxy.custom) {

                    row
                        .querySelector(
                            '.tp9-delete'
                        )
                        .addEventListener(
                            'click',
                            function () {

                                deleteCustomProxy(
                                    proxy.id
                                );

                            }
                        );

                }


                list.appendChild(
                    row
                );

            }
        );


        dashboard
            .querySelector(
                '.tp9-fallback'
            )
            .checked =
            pageConfig.fallback;


        dashboard
            .querySelector(
                '.tp9-keep-quality'
            )
            .checked =
            !!pageConfig.keepQualityInBackground;


        dashboard
            .querySelector(
                '.tp9-timeout-select'
            )
            .value =
            String(
                pageConfig.timeout
            );

        dashboard
            .querySelector(
                '.tp9-cache-select'
            )
            .value =
            String(
                pageConfig.cacheDelay ||
                DEFAULT_CACHE_DELAY
            );


        updateCurrentTestInfo();

        updateAutoTestStatus();

        updateActiveProxyDisplay();

    }


    // ============================================================
    // DATE DU TEST
    // ============================================================

    function formatTestDate(timestamp) {

        try {

            var date =
                new Date(timestamp);


            return (
                'testé ' +
                date.toLocaleTimeString(
                    [],
                    {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    }
                )
            );

        } catch (e) {

            return '';

        }

    }


    function updateCurrentTestInfo() {

        if (!dashboard) {
            return;
        }


        var current =
            dashboard.querySelector(
                '.tp9-current'
            );


        if (!current) {
            return;
        }


        var tested =
            pageConfig.proxies.filter(
                function (proxy) {
                    return !!proxy.lastTest;
                }
            );


        if (!tested.length) {

            current.textContent =
                'Aucun proxy testé';

            return;

        }


        var successful =
            tested.filter(
                function (proxy) {
                    return proxy.lastTest.ok;
                }
            );


        current.textContent =
            successful.length +
            ' proxy(s) OK · ' +
            tested.length +
            ' testé(s)';

    }

    function updateAutoTestStatus() {

        if (!dashboard) {
            return;
        }

        var current = dashboard.querySelector('.tp9-current');

        if (!current) {
            return;
        }

        var channel = getTestChannel();

        if (!channel) {
            return;
        }

        var tested = pageConfig.proxies.filter(function (p) {
            return p.lastTest && p.lastTest.channel === channel;
        });

        if (!tested.length) {
            current.textContent = 'Auto-test en cours…';
            return;
        }

        var ok = tested.filter(function (p) {
            return p.lastTest.ok;
        });

        var best = ok.length ? ok[0] : null;

        if (best) {
            current.textContent =
                '✅ ' + ok.length + ' OK · meilleur : ' +
                best.name + ' (' + best.lastTest.latency + ' ms)';
        } else {
            current.textContent = '❌ Aucun proxy fonctionnel pour : ' + channel;
        }

    }


    // Affiche le proxy réellement utilisé par le Worker pour la
    // lecture en cours (remonté via BroadcastChannel), à ne pas
    // confondre avec les résultats de l'auto-test ci-dessus.
    function updateActiveProxyDisplay() {

        if (!dashboard) {
            return;
        }

        var el =
            dashboard.querySelector(
                '.tp9-active-proxy'
            );

        if (!el) {
            return;
        }

        var channel =
            getTestChannel();

        if (
            !activeProxyInfo ||
            !channel ||
            activeProxyInfo.channel !== channel
        ) {

            el.textContent = '';

            return;

        }

        if (activeProxyInfo.direct) {

            el.textContent =
                '📡 Lecture actuelle : Twitch (direct, aucun proxy)';

        } else {

            el.textContent =
                '📡 Lecture actuelle : ' +
                activeProxyInfo.proxyName;

        }

    }


    // ============================================================
    // AJOUT PROXY
    // ============================================================

function showAddProxyForm() {

    if (!dashboard) {
        return;
    }

    var container =
        dashboard.querySelector(
            '.tp9-add-container'
        );

    if (!container) {
        return;
    }

    // Évite d'ouvrir plusieurs formulaires
    if (
        container.querySelector(
            '.tp9-add-form'
        )
    ) {
        return;
    }

    container.innerHTML = `

        <div class="tp9-section-title tp9-add-title">
            AJOUTER UN PROXY
        </div>

        <div class="tp9-add-form">

            <label>
                Nom
            </label>

            <input
                type="text"
                class="tp9-new-name"
                placeholder="Mon proxy"
                autocomplete="off"
            >

            <label>
                URL
            </label>

            <input
                type="text"
                class="tp9-new-url"
                placeholder="https://exemple.com/live/{channel}"
                autocomplete="off"
            >

            <div class="tp9-help">
                L'URL doit contenir
                <code>{channel}</code>
            </div>

            <div class="tp9-form-error"></div>

            <div class="tp9-actions">

                <button
                    class="tp9-cancel-add"
                    type="button"
                >
                    Annuler
                </button>

                <button
                    class="tp9-confirm-add"
                    type="button"
                >
                    Ajouter
                </button>

            </div>

        </div>

    `;

    var nameInput =
        container.querySelector(
            '.tp9-new-name'
        );

    var urlInput =
        container.querySelector(
            '.tp9-new-url'
        );

    var error =
        container.querySelector(
            '.tp9-form-error'
        );

    // ------------------------------------------------------------
    // ANNULER
    // ------------------------------------------------------------

    container
        .querySelector(
            '.tp9-cancel-add'
        )
        .addEventListener(
            'click',
            function () {

                container.innerHTML = '';

                renderDashboard();

            }
        );

    // ------------------------------------------------------------
    // AJOUTER
    // ------------------------------------------------------------

    container
        .querySelector(
            '.tp9-confirm-add'
        )
        .addEventListener(
            'click',
            function () {

                var name =
                    nameInput.value.trim();

                var url =
                    urlInput.value.trim();

                // ------------------------------------------------
                // Validation nom
                // ------------------------------------------------

                if (!name) {

                    error.textContent =
                        'Veuillez entrer un nom.';

                    nameInput.focus();

                    return;

                }

                // ------------------------------------------------
                // Validation URL
                // ------------------------------------------------

                if (!url) {

                    error.textContent =
                        'Veuillez entrer une URL.';

                    urlInput.focus();

                    return;

                }

                if (
                    url.indexOf(
                        '{channel}'
                    ) === -1
                ) {

                    error.textContent =
                        "L'URL doit contenir {channel}.";

                    urlInput.focus();

                    return;

                }

                try {

                    /*
                     * On remplace temporairement {channel}
                     * uniquement pour permettre à URL()
                     * de valider correctement l'adresse.
                     *
                     * Le proxy enregistré conserve
                     * évidemment {channel}.
                     */

                    var testURL =
                        url.replace(
                            '{channel}',
                            'testchannel'
                        );

                    var parsed =
                        new URL(testURL);

                    if (
                        parsed.protocol !==
                            'http:' &&
                        parsed.protocol !==
                            'https:'
                    ) {

                        throw new Error();

                    }

                } catch (e) {

                    error.textContent =
                        'URL invalide.';

                    urlInput.focus();

                    return;

                }

                // ------------------------------------------------
                // Empêche les doublons
                // ------------------------------------------------

                var duplicate =
                    pageConfig.proxies.some(
                        function (proxy) {

                            return (
                                proxy.url === url ||
                                (
                                    proxy.name &&
                                    proxy.name
                                        .toLowerCase() ===
                                    name.toLowerCase()
                                )
                            );

                        }
                    );

                if (duplicate) {

                    error.textContent =
                        'Un proxy avec ce nom ou cette URL existe déjà.';

                    return;

                }

                // ------------------------------------------------
                // Création
                // ------------------------------------------------

                var newProxy = {

                    id:
                        generateCustomProxyId(),

                    name:
                        name,

                    url:
                        url,

                    enabled:
                        true,

                    custom:
                        true,

                    lastTest:
                        null

                };

                pageConfig.proxies.push(
                    newProxy
                );

                saveConfig(
                    pageConfig
                );

                broadcastConfig();

                /*
                 * Très important :
                 * on détruit uniquement le formulaire.
                 * Le reste du dashboard n'est jamais supprimé.
                 */

                container.innerHTML = '';

                renderDashboard();

            }
        );

    // ------------------------------------------------------------
    // ENTER = AJOUTER
    // ------------------------------------------------------------

    urlInput.addEventListener(
        'keydown',
        function (event) {

            if (
                event.key ===
                'Enter'
            ) {

                container
                    .querySelector(
                        '.tp9-confirm-add'
                    )
                    .click();

            }

        }
    );

    nameInput.focus();

}


    // ============================================================
    // SUPPRESSION PROXY CUSTOM
    // ============================================================

    function deleteCustomProxy(id) {

        var proxy =
            pageConfig.proxies.find(
                function (p) {
                    return p.id === id;
                }
            );


        if (!proxy) {
            return;
        }


        if (!proxy.custom) {
            return;
        }


        if (
            !confirm(
                'Supprimer le proxy "' +
                proxy.name +
                '" ?'
            )
        ) {
            return;
        }


        pageConfig.proxies =
            pageConfig.proxies.filter(
                function (p) {
                    return p.id !== id;
                }
            );


        saveConfig(
            pageConfig
        );


        broadcastConfig();


        renderDashboard();

    }


    function escapeHTML(text) {

        return String(text)
            .replace(
                /&/g,
                '&amp;'
            )
            .replace(
                /</g,
                '&lt;'
            )
            .replace(
                />/g,
                '&gt;'
            )
            .replace(
                /"/g,
                '&quot;'
            )
            .replace(
                /'/g,
                '&#039;'
            );

    }


    // ============================================================
    // BOUTON PLAYER
    // ============================================================

    function createPlayerButton() {

        if (dashboardButton) {
            return;
        }


        dashboardButton =
            document.createElement(
                'button'
            );


        dashboardButton.id =
            'tp9-player-button';


        dashboardButton.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L3 6v6c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V6L12 2z"/></svg>' +
            '<span class="tp9-update-badge" style="display:none;"></span>';


        dashboardButton.title =
    'Twitch Proxy Manager';

dashboardButton.style.visibility =
    'hidden';


        dashboardButton.addEventListener(
            'click',
            function () {

                if (dashboardVisible) {

                    hideDashboard();

                } else {

                    showDashboard();

                }

            }
        );


        document.body.appendChild(
            dashboardButton
        );


        createDashboard();

        positionPlayerUI();

    }


    function findPlayer() {

        var video =
            document.querySelector(
                'video'
            );


        if (!video) {
            return null;
        }


        var element =
            video;


        while (
            element &&
            element !== document.body
        ) {

            var rect =
                element.getBoundingClientRect();


            if (
                rect.width > 400 &&
                rect.height > 200
            ) {

                return element;

            }


            element =
                element.parentElement;

        }


        return video.parentElement;

    }


    // ============================================================
    // RECHERCHE DU BOUTON FOLLOW / COEUR
    // ============================================================

    function findFollowButton() {

        var selectors = [

            '[data-a-target="follow-button"]',

            '[data-a-target="channel-follow-button"]',

            'button[data-a-target*="follow"]',

            'button[aria-label*="Follow"]',

            'button[aria-label*="follow"]',

            'button[aria-label*="Suivre"]',

            'button[aria-label*="suivre"]'

        ];


        for (
            var i = 0;
            i < selectors.length;
            i++
        ) {

            var element =
                document.querySelector(
                    selectors[i]
                );


            if (
                element &&
                element.offsetParent !== null
            ) {

                return element;

            }

        }


        var buttons =
            document.querySelectorAll(
                'button'
            );


        for (
            var j = 0;
            j < buttons.length;
            j++
        ) {

            var button =
                buttons[j];


            if (
                button.offsetParent === null
            ) {
                continue;
            }


            var text =
                (
                    button.innerText ||
                    button.textContent ||
                    ''
                )
                .trim()
                .toLowerCase();


            var aria =
                (
                    button.getAttribute(
                        'aria-label'
                    ) ||
                    ''
                )
                .toLowerCase();


            if (
                text === 'follow' ||
                text === 'suivre' ||
                aria.indexOf('follow') >= 0 ||
                aria.indexOf('suivre') >= 0
            ) {

                return button;

            }

        }


        return null;

    }


    // Le mini-player Twitch (lecteur flottant qui persiste quand
    // on navigue ailleurs sur le site, ou qu'on scroll sur la page
    // de la chaîne) est toujours affiché en "position: fixed" et
    // dans un format nettement plus petit que le lecteur principal.
    function isMiniPlayerVideo(video) {

        try {

            var rect =
                video.getBoundingClientRect();

            if (rect.width < 500) {

                var element = video;

                while (
                    element &&
                    element !== document.body
                ) {

                    var computed =
                        window.getComputedStyle(
                            element
                        );

                    if (
                        computed &&
                        computed.position === 'fixed'
                    ) {

                        return true;

                    }

                    element =
                        element.parentElement;

                }

            }

        } catch (e) {}

        return false;

    }


    function positionPlayerUI() {

        if (!dashboardButton) {
            return;
        }


        // On ne veut le bouton QUE sur la page de la chaîne en
        // cours de visionnage, jamais accroché à un follow button
        // qui traînerait ailleurs sur le site (accueil, grille de
        // chaînes recommandées, etc.).
        if (!getTestChannel()) {

            dashboardButton.style.visibility =
                'hidden';

            return;

        }


    var followButton =
        findFollowButton();


    if (followButton) {

        var video =
            document.querySelector(
                'video'
            );

        if (
            !video ||
            video.readyState === 0
        ) {

            dashboardButton.style.visibility =
                'hidden';

            return;

        }

        if (isMiniPlayerVideo(video)) {

            dashboardButton.style.visibility =
                'hidden';

            return;

        }

        dashboardButton.style.visibility =
            'visible';

        var followRect =
            followButton.getBoundingClientRect();


        dashboardButton.style.position =
            'fixed';


        dashboardButton.style.left =
            (
                followRect.left -
                44
            ) + 'px';


        dashboardButton.style.top =
            (
                followRect.top +
                (
                    followRect.height -
                    32
                ) / 2
            ) + 'px';


            if (dashboardVisible) {

                dashboard.style.position =
                    'fixed';


                dashboard.style.left =
                    (
                        followRect.left -
                        360
                    ) + 'px';


                dashboard.style.top =
                    (
                        followRect.bottom -
                        460
                    ) + 'px';

            }


            return;

        }


            dashboardButton.style.visibility =
        'hidden';

    var player =
        findPlayer();


    if (!player) {

        dashboardButton.style.position =
            'fixed';


        dashboardButton.style.left =
            '20px';


        dashboardButton.style.bottom =
            '20px';


        return;

    }


        var rect =
            player.getBoundingClientRect();


        dashboardButton.style.position =
            'fixed';


        dashboardButton.style.left =
            rect.left + 'px';


        dashboardButton.style.top =
            (
                rect.bottom +
                8
            ) + 'px';


        if (dashboardVisible) {

            dashboard.style.position =
                'fixed';


            dashboard.style.left =
                rect.left + 'px';


            dashboard.style.top =
                (
                    rect.bottom +
                    55
                ) + 'px';

        }

    }


    function showDashboard() {

        dashboardVisible = true;

        dashboard.style.display =
            'block';

        renderDashboard();

        positionPlayerUI();

    }


    function hideDashboard() {

        dashboardVisible = false;

        dashboard.style.display =
            'none';

    }


    // ============================================================
    // CSS
    // ============================================================

    function injectDashboardCSS() {

        if (
            document.getElementById(
                'tp9-style'
            )
        ) {
            return;
        }


        var style =
            document.createElement(
                'style'
            );


        style.id =
            'tp9-style';


        style.textContent = `

            /* =====================================================
               BOUTON PROXY
            ===================================================== */

            #tp9-player-button {

                z-index: 2147483646;

                width: auto;
                height: 32px;

                min-width: 32px;
                min-height: 32px;

                padding: 0 12px;
                margin: 0;

                display: inline-flex;

                position: fixed;

                align-items: center;
                justify-content: center;

                vertical-align: middle;

                overflow: visible;

                text-decoration: none;
                white-space: nowrap;
                user-select: none;

                font-family:
                    "Inter",
                    "Noto Sans Arabic",
                    "Roobert",
                    "Helvetica Neue",
                    Helvetica,
                    Arial,
                    sans-serif;

                font-weight: 600;

                font-size: 16px;

                line-height: 1;

                border: 0;

                border-radius: 9000px;

                background-color:
                    rgba(83, 83, 95, .48);

                color: #efeff1;

                cursor: pointer;

                box-sizing: border-box;

                appearance: none;
                -webkit-appearance: none;

                outline: none;

                box-shadow: none;

                opacity: 1;

                transition:
                    background-color .12s ease,
                    color .12s ease;

            }


            #tp9-player-button:hover {

                background-color:
                    rgba(83, 83, 95, .7);

                color: #fff;

                transform: none;

                box-shadow: none;

            }


            #tp9-player-button:active {

                background-color:
                    rgba(0, 0, 0, .85);

                transform: none;

            }


            #tp9-player-button:focus-visible {

                outline:
                    2px solid #fff;

                outline-offset: 2px;

                box-shadow: none;

            }


            /* =====================================================
               DASHBOARD
            ===================================================== */

            #tp9-dashboard {

                display: none;

                z-index: 2147483647;

                width: 340px;

                max-height: 470px;

                overflow: hidden;

                color: #fff;

                background:
                    rgba(15,15,15,.97);

                border:
                    1px solid rgba(255,255,255,.15);

                border-radius: 12px;

                box-shadow:
                    0 10px 40px rgba(0,0,0,.65);

                font-family:
                    Arial,
                    sans-serif;

                font-size: 13px;

                backdrop-filter:
                    blur(12px);

            }


            .tp9-header {

                display: flex;

                align-items: center;

                justify-content: space-between;

                padding: 12px 15px;

                background: linear-gradient(180deg, rgba(145,71,255,.1), transparent);

                border-bottom:
                    1px solid rgba(255,255,255,.1);

            }


            .tp9-brand {

                display: flex;

                align-items: center;

                gap: 10px;

            }


            .tp9-brand-icon {

                flex: 0 0 auto;

                width: 32px;
                height: 32px;

                border-radius: 9px;

                display: flex;

                align-items: center;

                justify-content: center;

                font-size: 15px;

                background: linear-gradient(135deg, #9147ff, #772ce8);

                box-shadow: 0 2px 10px rgba(145,71,255,.4);

            }


            .tp9-brand-text {

                display: flex;

                flex-direction: column;

                line-height: 1.2;

            }


            .tp9-title {

                font-size: 14px;

                font-weight: 800;

            }


            .tp9-subtitle {

                font-size: 9px;

                color: #888;

                font-weight: 700;

                letter-spacing: .6px;

            }


            .tp9-close {

                border: 0;

                background: transparent;

                color: #aaa;

                font-size: 22px;

                cursor: pointer;

            }


            .tp9-close:hover {

                color: white;

            }


            .tp9-content {

                padding: 12px;

                max-height: 400px;

                overflow-y: auto;

            }


            /* =====================================================
               MISE À JOUR
            ===================================================== */

            .tp9-update-badge {

                position: absolute;

                top: -2px;
                right: 4px;

                width: 10px;
                height: 10px;

                border-radius: 50%;

                background: #ff4d4f;

                border: 2px solid rgba(15,15,15,.97);

                box-shadow: 0 0 6px rgba(255,77,79,.8);

            }


            .tp9-update-banner {

                display: flex;

                align-items: center;

                gap: 10px;

                padding: 10px 12px;

                margin-bottom: 10px;

                border-radius: 9px;

                background: linear-gradient(135deg, rgba(255,77,79,.18), rgba(255,77,79,.05));

                border: 1px solid rgba(255,77,79,.35);

            }


            .tp9-update-icon {

                flex: 0 0 auto;

                font-size: 18px;

            }


            .tp9-update-text {

                flex: 1 1 auto;

                min-width: 0;

            }


            .tp9-update-title {

                font-size: 12px;

                font-weight: 700;

                color: #fff;

            }


            .tp9-update-version {

                font-size: 11px;

                color: #ff9d9e;

                margin-top: 1px;

            }


            .tp9-update-hint {

                font-size: 10px;

                color: #c98a8b;

                margin-top: 3px;

            }


            .tp9-update-btn {

                flex: 0 0 auto;

                border: 0;

                border-radius: 7px;

                padding: 6px 10px;

                background: #ff4d4f;

                color: #fff;

                font-size: 11px;

                font-weight: 700;

                cursor: pointer;

            }


            .tp9-update-btn:hover {

                background: #ff6b6d;

            }


            .tp9-section-title {

                font-size: 10px;

                color: #888;

                letter-spacing: 1px;

                margin-bottom: 8px;

            }


            .tp9-proxy {

                --accent: #9147ff;

                position: relative;

                display: flex;

                align-items: center;

                justify-content: space-between;

                padding: 8px 10px 8px 12px;

                margin-bottom: 6px;

                border-radius: 9px;

                border: 1px solid rgba(255,255,255,.06);

                background:
                    rgba(255,255,255,.045);

                overflow: hidden;

                transition:
                    background-color .15s ease,
                    border-color .15s ease,
                    transform .15s ease,
                    box-shadow .15s ease;

            }


            .tp9-proxy::before {

                content: '';

                position: absolute;

                top: 0;
                bottom: 0;
                left: 0;

                width: 3px;

                background: var(--accent);

                opacity: .9;

            }


            .tp9-proxy:hover {

                background:
                    rgba(255,255,255,.08);

                border-color:
                    color-mix(in srgb, var(--accent) 45%, transparent);

                transform: translateX(1px);

                box-shadow: 0 4px 14px rgba(0,0,0,.28);

            }


            .tp9-proxy-disabled {

                opacity: .55;

            }


            .tp9-proxy-disabled .tp9-proxy-avatar {

                filter: grayscale(1);

            }


            .tp9-proxy-main {

                cursor: pointer;

                display: flex;

                align-items: center;

                min-width: 0;

                flex: 1;

                gap: 9px;

            }


            .tp9-enabled {

                flex: 0 0 auto;

                width: 15px;
                height: 15px;

                accent-color: var(--accent);

                cursor: pointer;

            }


            .tp9-proxy-avatar {

                flex: 0 0 auto;

                width: 28px;
                height: 28px;

                border-radius: 9px;

                display: flex;

                align-items: center;

                justify-content: center;

                font-size: 13px;

                background:
                    color-mix(in srgb, var(--accent) 22%, transparent);

                box-shadow:
                    inset 0 0 0 1px
                    color-mix(in srgb, var(--accent) 35%, transparent);

                transition: filter .15s ease;

            }


            .tp9-proxy-info {

                min-width: 0;

            }


            .tp9-proxy-name {

                font-weight: 600;

                white-space: nowrap;

                overflow: hidden;

                text-overflow: ellipsis;

            }


            .tp9-custom {

                display: inline-block;

                margin-left: 6px;

                padding: 1px 5px;

                border-radius: 4px;

                background:
                    rgba(145,71,255,.18);

                color: #bf94ff;

                font-size: 8px;

                font-weight: bold;

                vertical-align: 2px;

            }


            .tp9-status {

                display: inline-flex;

                align-items: center;

                margin-top: 4px;

                padding: 2px 7px;

                border-radius: 999px;

                color: #999;

                background: rgba(255,255,255,.05);

                font-size: 10.5px;

                font-weight: 600;

                white-space: nowrap;

            }


            .tp9-status-ok {

                color: #00d084;

                background: rgba(0,208,132,.14);

            }


            .tp9-status-error {

                color: #ff6b6b;

                background: rgba(255,107,107,.14);

            }


            .tp9-status-never {

                color: #999;

                background: rgba(255,255,255,.05);

            }


            .tp9-test-time {

                margin-left: 5px;

                opacity: .6;

                font-size: 9px;

                font-weight: 400;

            }


            .tp9-move {

                display: flex;

                margin-left: 8px;

                flex: 0 0 auto;

            }


            .tp9-proxy-title-row {

                display: flex;

                align-items: center;

                justify-content: space-between;

            }


            .tp9-proxy-count {

                padding: 2px 7px;

                border-radius: 999px;

                background: rgba(145,71,255,.16);

                color: #bf94ff;

                font-size: 10px;

                font-weight: 700;

                letter-spacing: 0;

            }


            .tp9-delete {

                width: 25px;
                height: 23px;

                padding: 0;

                border: 0;

                border-radius: 4px;

                background: rgba(255,255,255,.08);

                color: #ff6b6b !important;

                cursor: pointer;

            }


            .tp9-delete:hover {

                background:
                    rgba(255,70,70,.18) !important;

            }


            .tp9-add-proxy {

                width: 100%;

                margin-top: 4px;

                padding: 8px;

                border: 1px dashed
                    rgba(255,255,255,.16);

                border-radius: 6px;

                background:
                    transparent;

                color: #aaa;

                cursor: pointer;

                font-size: 12px;

            }


            .tp9-add-proxy:hover {

                background:
                    rgba(255,255,255,.06);

                color: white;

                border-color:
                    rgba(255,255,255,.28);

            }


            .tp9-divider {

                height: 1px;

                background:
                    rgba(255,255,255,.1);

                margin:
                    12px 0;

            }


            .tp9-settings-list {

                display: flex;

                flex-direction: column;

                gap: 6px;

                margin-bottom: 12px;

            }


            .tp9-toggle-row {

                display: flex;

                align-items: center;

                justify-content: space-between;

                padding: 9px 10px;

                border-radius: 8px;

                background: rgba(255,255,255,.035);

                border: 1px solid rgba(255,255,255,.05);

                cursor: pointer;

                transition: background-color .12s ease, border-color .12s ease;

            }


            .tp9-toggle-row:hover {

                background: rgba(255,255,255,.07);

                border-color: rgba(255,255,255,.1);

            }


            .tp9-toggle-label {

                display: flex;

                align-items: center;

                gap: 8px;

                font-size: 12.5px;

                font-weight: 600;

                color: #ddd;

            }


            .tp9-toggle-icon {

                font-size: 14px;

            }


            .tp9-switch {

                position: relative;

                flex: 0 0 auto;

                width: 34px;
                height: 20px;

            }


            .tp9-switch input {

                position: absolute;

                width: 0;
                height: 0;

                opacity: 0;

            }


            .tp9-switch-track {

                position: absolute;

                inset: 0;

                border-radius: 999px;

                background: rgba(255,255,255,.14);

                transition: background-color .15s ease;

            }


            .tp9-switch-track::before {

                content: '';

                position: absolute;

                top: 2px;
                left: 2px;

                width: 16px;
                height: 16px;

                border-radius: 50%;

                background: #ccc;

                transition: transform .15s ease, background-color .15s ease;

            }


            .tp9-switch input:checked + .tp9-switch-track {

                background: rgba(145,71,255,.55);

            }


            .tp9-switch input:checked + .tp9-switch-track::before {

                transform: translateX(14px);

                background: #fff;

            }


            .tp9-switch input:focus-visible + .tp9-switch-track {

                outline: 2px solid #9147ff;

                outline-offset: 2px;

            }


            .tp9-select-grid {

                display: grid;

                grid-template-columns: 1fr 1fr;

                gap: 8px;

                margin-bottom: 4px;

            }


            .tp9-select-field {

                display: flex;

                flex-direction: column;

                gap: 4px;

            }


            .tp9-select-label {

                font-size: 10px;

                color: #888;

                font-weight: 700;

                letter-spacing: .3px;

            }


            .tp9-select-field select {

                width: 100%;

                color-scheme: dark;

                background: #1c1c22;

                color: white;

                border: 1px solid rgba(255,255,255,.1);

                border-radius: 7px;

                padding: 7px 8px;

                font-size: 12px;

                cursor: pointer;

                box-sizing: border-box;

            }


            .tp9-select-field select option {

                background: #1c1c22;

                color: white;

            }


            .tp9-select-field select:focus {

                outline: none;

                border-color: #9147ff;

            }


            .tp9-actions {

                display: flex;

                gap: 7px;

            }


            .tp9-actions button {

                flex: 1;

                display: flex;

                align-items: center;

                justify-content: center;

                gap: 6px;

                padding: 9px;

                border: 1px solid rgba(255,255,255,.08);

                border-radius: 8px;

                background:
                    rgba(255,255,255,.05);

                color: #ddd;

                font-size: 12.5px;

                font-weight: 600;

                cursor: pointer;

                transition:
                    background-color .12s ease,
                    border-color .12s ease,
                    transform .1s ease;

            }


            .tp9-actions button:hover {

                background:
                    rgba(255,255,255,.1);

            }


            .tp9-actions button:active {

                transform: scale(.97);

            }


            .tp9-actions button:disabled {

                opacity: .6;

                cursor: not-allowed;

                transform: none;

            }


            @keyframes tp9-spin {

                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }

            }


            .tp9-spin {

                display: inline-block;

                animation: tp9-spin .8s linear infinite;

            }


            .tp9-btn-icon {

                font-size: 13px;

            }


            .tp9-test {

                background: rgba(145,71,255,.18) !important;

                border-color: rgba(145,71,255,.4) !important;

                color: #bf94ff !important;

            }


            .tp9-test:hover {

                background: rgba(145,71,255,.28) !important;

            }


            .tp9-reset {

                color: #ff8a8a !important;

            }


            .tp9-reset:hover {

                background: rgba(255,70,70,.14) !important;

                border-color: rgba(255,70,70,.35) !important;

            }


            .tp9-current-card {

                display: flex;

                align-items: center;

                gap: 9px;

                margin-top: 12px;

                padding: 10px 12px;

                border-radius: 9px;

                background:
                    rgba(255,255,255,.04);

                border: 1px solid rgba(255,255,255,.06);

            }


            .tp9-current-icon {

                flex: 0 0 auto;

                font-size: 15px;

            }


            .tp9-current {

                color: #bbb;

                font-size: 11.5px;

                font-weight: 600;

                line-height: 1.4;

            }


            .tp9-active-proxy {

                margin-bottom: 10px;

                padding: 7px 8px;

                border-radius: 6px;

                background:
                    rgba(145,71,255,.12);

                color: #bf94ff;

                font-size: 11px;

                font-weight: 600;

            }


            .tp9-active-proxy:empty {

                display: none;

            }


            .tp9-actions-secondary {

                margin-top: 7px;

            }


            .tp9-open-stats {

                width: 100%;

                margin-top: 12px;

                padding: 10px;

                border: 0;

                border-radius: 8px;

                background:
                    linear-gradient(135deg, #9147ff, #772ce8);

                color: white;

                font-weight: 700;

                font-size: 12.5px;

                cursor: pointer;

                box-shadow: 0 4px 14px rgba(145,71,255,.3);

                transition: filter .12s ease, transform .1s ease;

            }


            .tp9-open-stats:hover {

                filter: brightness(1.1);

            }


            .tp9-open-stats:active {

                transform: scale(.98);

            }


            /* =====================================================
               FORMULAIRE AJOUT
            ===================================================== */

            .tp9-add-form {

                display: flex;

                flex-direction: column;

                gap: 7px;

            }


            .tp9-add-form label {

                color: #aaa;

                font-size: 11px;

                font-weight: 600;

                margin-top: 3px;

            }


            .tp9-add-form input {

                width: 100%;

                min-height: 34px;

                padding:
                    7px 9px;

                border:
                    1px solid
                    rgba(255,255,255,.12);

                border-radius: 6px;

                outline: none;

                background: #222;

                color: white;

                font-family: Arial, sans-serif;

                font-size: 12px;

                box-sizing: border-box;

            }


            .tp9-add-form input:focus {

                border-color:
                    #9147ff;

            }

			.tp9-add-container {
    margin-top: 10px;
}

.tp9-add-title {
    margin-top: 10px;
    margin-bottom: 8px;
}

            .tp9-help {

                color: #777;

                font-size: 10px;

            }


            .tp9-help code {

                color: #bf94ff;

                background:
                    rgba(255,255,255,.06);

                padding:
                    1px 4px;

                border-radius: 3px;

            }


            .tp9-form-error {

                min-height: 15px;

                color: #ff6b6b;

                font-size: 11px;

            }

        `;


        document.head.appendChild(
            style
        );

    }


    function injectStatsCSS() {

        if (document.getElementById('tp9s-style')) {
            return;
        }

        var style = document.createElement('style');

        style.id = 'tp9s-style';

        style.textContent = `

            #tp9-stats {

                display: none;

                position: fixed;

                inset: 0;

                z-index: 2147483647;

                font-family:
                    "Inter", Arial, sans-serif;

                color: #efeff1;

                background: #0a0a0c;

            }


            .tp9s-sidebar {

                width: 230px;

                flex: 0 0 auto;

                background: #0d0d10;

                border-right: 1px solid rgba(255,255,255,.08);

                padding: 18px 14px;

                display: flex;

                flex-direction: column;

                overflow-y: auto;

            }


            .tp9s-brand {

                display: flex;

                align-items: center;

                gap: 10px;

                margin-bottom: 22px;

                padding: 0 6px;

            }


            .tp9s-brand-icon {

                width: 34px;
                height: 34px;

                border-radius: 9px;

                background:
                    linear-gradient(135deg, #9147ff, #772ce8);

                display: flex;

                align-items: center;

                justify-content: center;

                font-weight: bold;

            }


            .tp9s-brand-title {

                font-size: 13px;

                font-weight: 800;

                letter-spacing: .5px;

            }


            .tp9s-brand-sub {

                font-size: 10px;

                color: #888;

                letter-spacing: .5px;

            }


            .tp9s-nav-group-title {

                font-size: 10px;

                color: #666;

                letter-spacing: 1px;

                margin: 14px 8px 6px;

            }


            .tp9s-nav-group {

                display: flex;

                flex-direction: column;

                gap: 2px;

            }


            .tp9s-nav-item {

                display: flex;

                align-items: center;

                gap: 10px;

                padding: 9px 10px;

                border: 0;

                border-radius: 8px;

                background: transparent;

                color: #ccc;

                font-size: 13px;

                font-weight: 600;

                text-align: left;

                cursor: pointer;

                width: 100%;

            }


            .tp9s-nav-item:hover {

                background: rgba(255,255,255,.06);

                color: white;

            }


            .tp9s-nav-active {

                background: rgba(145,71,255,.16) !important;

                color: #bf94ff !important;

            }


            .tp9s-nav-icon {

                width: 18px;

                text-align: center;

            }


            .tp9s-close-btn {

                margin-top: auto;

                padding: 10px;

                border: 1px solid rgba(255,255,255,.12);

                border-radius: 8px;

                background: transparent;

                color: #aaa;

                cursor: pointer;

                font-size: 12px;

            }


            .tp9s-close-btn:hover {

                background: rgba(255,255,255,.06);

                color: white;

            }


            .tp9s-main {

                flex: 1;

                display: flex;

                flex-direction: column;

                background: #0a0a0c;

                overflow: hidden;

                min-width: 0;

            }


            .tp9s-topbar {

                display: flex;

                align-items: center;

                justify-content: space-between;

                padding: 20px 28px;

                border-bottom: 1px solid rgba(255,255,255,.08);

            }


            .tp9s-page-title {

                font-size: 22px;

                font-weight: 800;

                letter-spacing: .5px;

            }


            .tp9s-page-sub {

                font-size: 12px;

                color: #888;

                margin-top: 3px;

            }


            .tp9s-topbar-actions {

                display: flex;

                align-items: center;

                gap: 10px;

            }


            .tp9s-topbar-actions button {

                display: flex;

                align-items: center;

                justify-content: center;

                border: 1px solid rgba(255,255,255,.09);

                background: rgba(255,255,255,.05);

                color: #ccc;

                width: 36px;

                height: 36px;

                border-radius: 9px;

                cursor: pointer;

                font-size: 15px;

                line-height: 1;

                transition:
                    background-color .15s ease,
                    border-color .15s ease,
                    color .15s ease,
                    transform .1s ease;

            }


            .tp9s-topbar-actions button:hover {

                background: rgba(255,255,255,.11);

                border-color: rgba(255,255,255,.18);

                color: white;

            }


            .tp9s-topbar-actions button:active {

                transform: scale(.92);

            }


            .tp9s-close {

                font-size: 19px;

                font-weight: 600;

            }


            .tp9s-refresh:hover {

                background: rgba(145,71,255,.16);

                border-color: rgba(145,71,255,.4);

                color: #bf94ff;

            }


            .tp9s-refresh.tp9s-spinning {

                animation: tp9s-spin .6s ease-in-out;

                pointer-events: none;

                background: rgba(145,71,255,.16);

                border-color: rgba(145,71,255,.4);

                color: #bf94ff;

            }


            @keyframes tp9s-spin {

                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }

            }


            .tp9s-reset-stats:hover {

                background: rgba(255,70,70,.14);

                border-color: rgba(255,70,70,.4);

                color: #ff8a8a;

            }


            .tp9s-content {

                flex: 1;

                overflow-y: auto;

                padding: 24px 28px;

            }


            .tp9s-cards {

                display: grid;

                grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));

                gap: 14px;

                margin-bottom: 20px;

            }


            .tp9s-cards-secondary {

                margin-top: 16px;

                margin-bottom: 4px;

            }


            .tp9s-card-icon img {

                width: 100%;
                height: 100%;

                border-radius: 7px;

                object-fit: cover;

            }


            .tp9s-card {

                background: rgba(255,255,255,.04);

                border: 1px solid rgba(255,255,255,.06);

                border-radius: 12px;

                padding: 16px;

            }


            .tp9s-card-top {

                display: flex;

                align-items: center;

                justify-content: space-between;

                margin-bottom: 10px;

            }


            .tp9s-card-label {

                font-size: 10px;

                color: #888;

                letter-spacing: .5px;

                font-weight: 700;

            }


            .tp9s-card-icon {

                width: 26px;
                height: 26px;

                border-radius: 7px;

                background: rgba(145,71,255,.14);

                display: flex;

                align-items: center;

                justify-content: center;

                font-size: 13px;

            }


            .tp9s-card-value {

                font-size: 26px;

                font-weight: 800;

            }


            .tp9s-card-sub {

                font-size: 11px;

                color: #777;

                margin-top: 4px;

            }


            .tp9s-note {

                display: flex;

                align-items: flex-start;

                gap: 8px;

                background: rgba(145,71,255,.08);

                border: 1px solid rgba(145,71,255,.2);

                border-radius: 10px;

                padding: 11px 14px;

                margin-bottom: 16px;

                font-size: 11.5px;

                line-height: 1.5;

                color: #cbb8f2;

            }


            .tp9s-note strong {

                color: #efe0ff;

            }


            .tp9s-panel {

                background: rgba(255,255,255,.03);

                border: 1px solid rgba(255,255,255,.06);

                border-radius: 12px;

                padding: 18px;

                margin-bottom: 16px;

            }


            .tp9s-panel-title-row {

                display: flex;

                align-items: center;

                justify-content: space-between;

                margin-bottom: 10px;

            }


            .tp9s-panel-title {

                font-size: 14px;

                font-weight: 700;

            }


            .tp9s-panel-sub {

                font-size: 11px;

                color: #888;

                margin-bottom: 12px;

            }


            .tp9s-rank-row {

                display: grid;

                grid-template-columns: 40px 1fr 90px 90px;

                align-items: center;

                padding: 10px 8px;

                border-bottom: 1px solid rgba(255,255,255,.05);

                font-size: 13px;

            }


            .tp9s-rank-row:last-child {

                border-bottom: 0;

            }


            .tp9s-rank-pos {

                color: #9147ff;

                font-weight: 700;

            }


            .tp9s-rank-latency {

                color: #00d084;

                font-weight: 600;

                text-align: right;

            }


            .tp9s-rank-usage {

                color: #888;

                font-size: 11px;

                text-align: right;

            }


            .tp9s-empty {

                padding: 30px 10px;

                text-align: center;

                color: #666;

                font-size: 13px;

            }


            .tp9s-table {

                width: 100%;

                overflow-x: auto;

            }


            .tp9s-table-row {

                display: grid;

                grid-template-columns: 1.4fr 1fr 1fr 1fr 1.2fr;

                gap: 8px;

                padding: 10px 8px;

                border-bottom: 1px solid rgba(255,255,255,.05);

                font-size: 12px;

                align-items: center;

            }


            .tp9s-table-row-relais {

                grid-template-columns: 1.4fr 1fr 1fr 1fr 1fr 1.2fr;

            }


            .tp9s-table-row:last-child {

                border-bottom: 0;

            }


            .tp9s-table-head {

                color: #888;

                font-size: 10px;

                letter-spacing: .5px;

                font-weight: 700;

            }


            .tp9s-td-name {

                font-weight: 600;

                color: #fff;

            }


            .tp9s-clear-logs {

                border: 1px solid rgba(255,255,255,.12);

                background: transparent;

                color: #ff6b6b;

                border-radius: 6px;

                padding: 7px 10px;

                font-size: 11px;

                cursor: pointer;

            }


            .tp9s-clear-logs:hover {

                background: rgba(255,70,70,.12);

            }


            .tp9s-logs {

                max-height: 60vh;

                overflow-y: auto;

            }


            .tp9s-log-row {

                display: flex;

                align-items: baseline;

                gap: 8px;

                padding: 6px 4px;

                font-size: 12px;

                border-bottom: 1px solid rgba(255,255,255,.04);

            }


            .tp9s-log-time {

                color: #666;

                font-size: 10px;

                flex: 0 0 auto;

            }


            .tp9s-log-msg {

                color: #ccc;

            }


            .tp9s-log-error .tp9s-log-msg {

                color: #ff8a8a;

            }


            .tp9s-log-warn .tp9s-log-msg {

                color: #ffcf7a;

            }


            .tp9s-log-success .tp9s-log-msg {

                color: #7ae8b0;

            }


            /* =====================================================
               REDESIGN — animations, barres, accents, avatars
            ===================================================== */

            .tp9s-content::-webkit-scrollbar,
            .tp9s-logs::-webkit-scrollbar,
            .tp9s-sidebar::-webkit-scrollbar {

                width: 8px;

            }


            .tp9s-content::-webkit-scrollbar-thumb,
            .tp9s-logs::-webkit-scrollbar-thumb,
            .tp9s-sidebar::-webkit-scrollbar-thumb {

                background: rgba(255,255,255,.12);

                border-radius: 8px;

            }


            @keyframes tp9s-fade-in {

                from {
                    opacity: 0;
                    transform: translateY(6px);
                }

                to {
                    opacity: 1;
                    transform: translateY(0);
                }

            }


            .tp9s-fade {

                animation: tp9s-fade-in .28s ease;

            }


            .tp9s-card {

                position: relative;

                overflow: hidden;

                transition:
                    transform .18s ease,
                    box-shadow .18s ease,
                    border-color .18s ease;

                --accent: #9147ff;

            }


            .tp9s-card::before {

                content: '';

                position: absolute;

                top: 0;
                left: 0;
                right: 0;

                height: 3px;

                background: var(--accent);

                opacity: .85;

            }


            .tp9s-card:hover {

                transform: translateY(-3px);

                border-color: rgba(255,255,255,.14);

                box-shadow: 0 10px 24px rgba(0,0,0,.35);

            }


            .tp9s-card-icon {

                background: color-mix(in srgb, var(--accent) 22%, transparent);

                color: var(--accent);

            }


            .tp9s-card-value {

                background:
                    linear-gradient(135deg, #fff, rgba(255,255,255,.7));

                -webkit-background-clip: text;

                background-clip: text;

                -webkit-text-fill-color: transparent;

            }


            /* ---- classement en liste (Vue d'ensemble) ---- */

            .tp9s-lead-row {

                display: grid;

                grid-template-columns: 34px 1fr 90px 100px 70px;

                align-items: center;

                gap: 10px;

                padding: 10px 6px;

            }


            .tp9s-lead-row + .tp9s-lead-row {

                border-top: 1px solid rgba(255,255,255,.05);

            }


            .tp9s-lead-rank {

                display: flex;

                align-items: center;

                justify-content: center;

                width: 24px;
                height: 24px;

                margin: 0 auto;

                border-radius: 50%;

                background: rgba(255,255,255,.06);

                color: #777;

                font-size: 11px;

                font-weight: 700;

            }


            .tp9s-lead-row:nth-child(-n+3) .tp9s-lead-rank {

                background: transparent;

                font-size: 16px;

            }


            .tp9s-lead-name {

                font-size: 12.5px;

                font-weight: 600;

                white-space: nowrap;

                overflow: hidden;

                text-overflow: ellipsis;

            }


            .tp9s-lead-latency {

                font-size: 12.5px;

                font-weight: 700;

                text-align: right;

                white-space: nowrap;

            }


            .tp9s-lead-rate {

                font-size: 11px;

                color: #999;

                text-align: right;

                white-space: nowrap;

            }


            .tp9s-lead-usage {

                font-size: 10.5px;

                color: #888;

                text-align: right;

                white-space: nowrap;

            }


            /* ---- cartes / panneaux cliquables (Vue d'ensemble) ---- */

            .tp9s-card-clickable {

                cursor: pointer;

            }


            .tp9s-card-clickable:hover {

                border-color: color-mix(in srgb, var(--accent) 50%, transparent);

            }


            .tp9s-panel-link {

                flex: 0 0 auto;

                border: 0;

                background: transparent;

                padding: 4px 8px;

                border-radius: 999px;

                font-size: 11px;

                font-weight: 700;

                font-family: inherit;

                color: #bf94ff;

                white-space: nowrap;

                cursor: pointer;

                transition: background-color .12s ease;

            }


            .tp9s-panel-link:hover {

                background: rgba(145,71,255,.16);

            }


            /* ---- mini barre de progression (réussite / bande passante) ---- */

            .tp9s-progress {

                position: relative;

                height: 6px;

                width: 64px;

                border-radius: 4px;

                background: rgba(255,255,255,.08);

                overflow: hidden;

                display: inline-block;

                vertical-align: middle;

                margin-right: 6px;

            }


            .tp9s-progress-fill {

                position: absolute;

                inset: 0;

                width: 0%;

                border-radius: 4px;

                transition: width .5s ease;

            }


            .tp9s-progress-good .tp9s-progress-fill { background: #00d084; }
            .tp9s-progress-mid .tp9s-progress-fill  { background: #ffcf7a; }
            .tp9s-progress-bad .tp9s-progress-fill  { background: #ff6b6b; }


            .tp9s-td-flex {

                display: flex;

                align-items: center;

            }


            /* ---- avatars (bulle avec initiale) ---- */

            .tp9s-td-name-flex {

                display: flex;

                align-items: center;

                gap: 9px;

            }


            .tp9s-avatar {

                flex: 0 0 auto;

                width: 26px;
                height: 26px;

                border-radius: 50%;

                display: flex;

                align-items: center;

                justify-content: center;

                font-size: 11px;

                font-weight: 800;

                color: #fff;

                background: linear-gradient(135deg, var(--accent, #9147ff), #4c1d95);

            }


            .tp9s-avatar-img {

                flex: 0 0 auto;

                width: 26px;
                height: 26px;

                border-radius: 50%;

                object-fit: cover;

            }


            /* ---- lignes de tableau modernisées ---- */

            .tp9s-table-row {

                border-radius: 8px;

                transition: background-color .12s ease;

            }


            .tp9s-table-row:not(.tp9s-table-head):hover {

                background: rgba(255,255,255,.035);

            }


            .tp9s-table-head {

                border-radius: 0;

            }


            /* ---- logs modernisés ---- */

            .tp9s-log-row {

                border-radius: 8px;

                padding: 9px 10px;

                transition: background-color .12s ease;

            }


            .tp9s-log-row:hover {

                background: rgba(255,255,255,.03);

            }


            .tp9s-log-icon {

                flex: 0 0 auto;

                width: 22px;
                height: 22px;

                border-radius: 50%;

                display: flex;

                align-items: center;

                justify-content: center;

                font-size: 11px;

                background: rgba(255,255,255,.06);

            }


            /* ---- nav sidebar : indicateur actif ---- */

            .tp9s-nav-item {

                border-left: 3px solid transparent;

                transition:
                    background-color .12s ease,
                    border-color .12s ease,
                    color .12s ease;

            }


            .tp9s-nav-active {

                border-left-color: #9147ff;

            }


            /* ---- historique des messages (bouton + modale) ---- */

            .tp9s-msg-count {

                border: 0;

                background: rgba(145,71,255,.14);

                color: #bf94ff;

                font: inherit;

                font-weight: 700;

                padding: 3px 9px;

                border-radius: 999px;

                cursor: pointer;

                transition: background-color .12s ease;

            }


            .tp9s-msg-count:hover {

                background: rgba(145,71,255,.26);

            }


            #tp9-chat-modal {

                display: none;

                position: fixed;

                inset: 0;

                z-index: 2147483647;

                align-items: center;

                justify-content: center;

                font-family: "Inter", Arial, sans-serif;

            }


            .tp9-chat-modal-backdrop {

                position: absolute;

                inset: 0;

                background: rgba(0,0,0,.6);

            }


            .tp9-chat-modal-box {

                position: relative;

                width: min(480px, 90vw);

                max-height: 70vh;

                display: flex;

                flex-direction: column;

                background: #0d0d10;

                border: 1px solid rgba(255,255,255,.1);

                border-radius: 14px;

                box-shadow: 0 20px 60px rgba(0,0,0,.6);

                overflow: hidden;

            }


            .tp9-chat-modal-header {

                display: flex;

                align-items: center;

                justify-content: space-between;

                padding: 14px 16px;

                border-bottom: 1px solid rgba(255,255,255,.08);

            }


            .tp9-chat-modal-title {

                font-size: 13px;

                font-weight: 700;

                color: #efeff1;

            }


            .tp9-chat-modal-close {

                border: 0;

                background: transparent;

                color: #aaa;

                font-size: 20px;

                cursor: pointer;

            }


            .tp9-chat-modal-close:hover {

                color: white;

            }


            .tp9-chat-modal-list {

                overflow-y: auto;

                max-height: 264px;

                padding: 8px 10px;

            }


            .tp9-chat-modal-row {

                display: flex;

                gap: 10px;

                padding: 7px 6px;

                border-bottom: 1px solid rgba(255,255,255,.04);

                font-size: 12.5px;

            }


            .tp9-chat-modal-row:last-child {

                border-bottom: 0;

            }


            .tp9-chat-modal-time {

                flex: 0 0 auto;

                color: #777;

                font-size: 10.5px;

                white-space: nowrap;

                padding-top: 1px;

            }


            .tp9-chat-modal-text {

                color: #ddd;

                word-break: break-word;

            }

        `;

        document.head.appendChild(style);

    }


    // ============================================================
    // DASHBOARD STATISTIQUES (PLEIN ÉCRAN)
    // ============================================================

    var statsDashboard = null;
    var statsDashboardVisible = false;
    var statsActiveTab = 'overview';

    var STATS_TABS = [
        { id: 'overview', label: 'Vue d’ensemble', icon: '📊', group: 'GÉNÉRAL' },
        { id: 'relais', label: 'Relais', icon: '📡', group: 'GÉNÉRAL' },
        { id: 'streamers', label: 'Streamers', icon: '🎥', group: 'GÉNÉRAL' },
        { id: 'logs', label: 'Logs', icon: '📄', group: 'SYSTÈME' }
    ];

    function createStatsDashboard() {

        if (statsDashboard) {
            return;
        }

        statsDashboard = document.createElement('div');
        statsDashboard.id = 'tp9-stats';

        var navGroups = {};

        STATS_TABS.forEach(function (tab) {

            navGroups[tab.group] = navGroups[tab.group] || [];
            navGroups[tab.group].push(tab);

        });

        var navHTML = Object.keys(navGroups).map(function (group) {

            var items = navGroups[group].map(function (tab) {

                return (
                    '<button type="button" class="tp9s-nav-item" data-tab="' +
                    tab.id + '"><span class="tp9s-nav-icon">' + tab.icon +
                    '</span>' + escapeHTML(tab.label) + '</button>'
                );

            }).join('');

            return (
                '<div class="tp9s-nav-group-title">' + escapeHTML(group) + '</div>' +
                '<div class="tp9s-nav-group">' + items + '</div>'
            );

        }).join('');

        statsDashboard.innerHTML = `

            <div class="tp9s-sidebar">

                <div class="tp9s-brand">
                    <div class="tp9s-brand-icon">P</div>
                    <div>
                        <div class="tp9s-brand-title">DASHBOARD</div>
                        <div class="tp9s-brand-sub">TWITCH HLS PROXY</div>
                    </div>
                </div>

                <div class="tp9s-nav">
                    ${navHTML}
                </div>

                <button type="button" class="tp9s-close-btn">
                    Fermer le dashboard
                </button>

            </div>

            <div class="tp9s-main">

                <div class="tp9s-topbar">
                    <div>
                        <div class="tp9s-page-title"></div>
                        <div class="tp9s-page-sub"></div>
                    </div>
                    <div class="tp9s-topbar-actions">
                        <button type="button" class="tp9s-refresh" title="Rafraîchir les stats">🔄</button>
                        <button type="button" class="tp9s-reset-stats" title="Réinitialiser les stats">🗑</button>
                        <button type="button" class="tp9s-close" title="Fermer">×</button>
                    </div>
                </div>

                <div class="tp9s-content"></div>

            </div>

        `;

        document.body.appendChild(statsDashboard);

        injectStatsCSS();

        statsDashboard.querySelectorAll('.tp9s-nav-item').forEach(function (btn) {

            btn.addEventListener('click', function () {

                statsActiveTab = btn.getAttribute('data-tab');
                renderStatsDashboard();

            });

        });

        statsDashboard.querySelector('.tp9s-close')
            .addEventListener('click', hideStatsDashboard);

        statsDashboard.querySelector('.tp9s-close-btn')
            .addEventListener('click', hideStatsDashboard);

        statsDashboard.querySelector('.tp9s-refresh')
            .addEventListener('click', refreshStatsDashboard);

        statsDashboard.querySelector('.tp9s-reset-stats')
            .addEventListener('click', resetStatsData);

        // Délégué : le contenu (cartes, tableaux, ...) est
        // reconstruit à chaque rendu, on écoute donc au niveau du
        // conteneur persistant plutôt que sur chaque élément.
        statsDashboard.addEventListener('click', function (event) {

            var msgBtn = event.target.closest('.tp9s-msg-count');

            if (msgBtn) {

                showChatHistoryModal(msgBtn.getAttribute('data-channel'));

                return;

            }

            // Cartes/panneaux cliquables de la Vue d'ensemble :
            // navigue vers l'onglet détaillé correspondant, et
            // ouvre en plus l'historique tchat si demandé (ex:
            // carte "Top streamer chatté").
            var navEl = event.target.closest('[data-nav]');

            if (navEl) {

                var targetTab = navEl.getAttribute('data-nav');
                var historyChannel = navEl.getAttribute('data-history-channel');

                statsActiveTab = targetTab;

                renderStatsDashboard();

                if (historyChannel) {
                    showChatHistoryModal(historyChannel);
                }

            }

        });

        document.addEventListener('keydown', function (event) {

            if (event.key === 'Escape' && statsDashboardVisible) {
                hideStatsDashboard();
            }

        });

        // (La resynchro live entre onglets est gérée par un unique
        // listener 'storage' global, voir plus haut dans le script.)

    }

    var STATS_DASHBOARD_PARAM = 'tp9_dashboard';

    var isDashboardOnlyTab = false;

    try {

        isDashboardOnlyTab =
            new URLSearchParams(location.search).get(STATS_DASHBOARD_PARAM) === '1';

    } catch (e) {}

    // Ouvre le dashboard dans un NOUVEL onglet Twitch (même origine
    // donc même localStorage) plutôt qu'en overlay par-dessus le
    // lecteur en cours — évite de masquer le stream.
    function openStatsDashboardInNewTab() {

        try {

            // On évite l'accueil Twitch ("/") : il autoplay une
            // preview de stream en vedette (parfois avec le son).
            // Un nom de chaîne inexistant affiche une page "hors
            // ligne" sans aucune vidéo.
            var url =
                location.origin +
                '/tp9proxydashboard?' +
                STATS_DASHBOARD_PARAM +
                '=1';

            window.open(url, '_blank', 'noopener');

        } catch (e) {

            console.warn(
                '[TwitchProxy] Impossible d’ouvrir le dashboard dans un nouvel onglet:',
                e
            );

        }

    }

    // Titre + favicon dédiés pour l'onglet dashboard : comme il
    // doit forcément rester sur une URL twitch.tv pour que le
    // script tourne, on ne peut pas changer l'URL affichée, mais on
    // peut au moins rendre l'onglet immédiatement identifiable dans
    // la barre d'onglets plutôt que d'afficher "Twitch".
    var DASHBOARD_FAVICON_SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#9147ff"/>' +
        '<stop offset="1" stop-color="#772ce8"/>' +
        '</linearGradient></defs>' +
        '<rect width="64" height="64" rx="14" fill="url(#g)"/>' +
        '<text x="32" y="45" font-family="Arial, sans-serif" ' +
        'font-size="36" font-weight="800" fill="#fff" ' +
        'text-anchor="middle">P</text>' +
        '</svg>';

    var DASHBOARD_FAVICON_URL =
        'data:image/svg+xml,' + encodeURIComponent(DASHBOARD_FAVICON_SVG);

    var DASHBOARD_TAB_TITLE = 'Dashboard Twitch Proxy';

    function applyDashboardTabIdentity() {

        try {

            document.title = DASHBOARD_TAB_TITLE;

            var favicon = document.querySelector('link[rel~="icon"]');

            if (!favicon) {

                favicon = document.createElement('link');
                favicon.rel = 'icon';
                document.head.appendChild(favicon);

            }

            document.querySelectorAll('link[rel~="icon"]').forEach(
                function (link) {

                    if (link !== favicon) {
                        link.parentNode.removeChild(link);
                    }

                }
            );

            favicon.type = 'image/svg+xml';
            favicon.href = DASHBOARD_FAVICON_URL;

        } catch (e) {}

    }

    var dashboardTabIdentityLocked = false;

    // Twitch (SPA) réécrit régulièrement <title> et le favicon au
    // fil de la navigation interne : on garde la main en ré-
    // appliquant les nôtres à chaque fois que ça change.
    function lockDashboardTabIdentity() {

        if (dashboardTabIdentityLocked) {
            return;
        }

        dashboardTabIdentityLocked = true;

        applyDashboardTabIdentity();

        try {

            var titleEl = document.querySelector('title');

            if (!titleEl) {

                titleEl = document.createElement('title');
                document.head.appendChild(titleEl);

            }

            new MutationObserver(function () {

                if (document.title !== DASHBOARD_TAB_TITLE) {
                    applyDashboardTabIdentity();
                }

            }).observe(titleEl, { childList: true });

            new MutationObserver(function () {

                applyDashboardTabIdentity();

            }).observe(document.head, { childList: true });

        } catch (e) {}

    }

    function refreshStatsDashboard() {

        pageStats = loadStats();

        renderStatsDashboard();

        flashRefreshButton();

    }

    // Retour visuel explicite au clic sur "Rafraîchir" (rotation +
    // icône ✅ un court instant) : sans ça, rien ne montre que
    // l'action a bien eu lieu.
    function flashRefreshButton() {

        if (!statsDashboard) {
            return;
        }

        var btn = statsDashboard.querySelector('.tp9s-refresh');

        if (!btn) {
            return;
        }

        btn.classList.remove('tp9s-spinning');

        // Force un reflow pour pouvoir relancer l'animation même
        // si elle vient déjà de tourner (double-clic rapide).
        void btn.offsetWidth;

        btn.classList.add('tp9s-spinning');

        var original = btn.textContent;

        btn.textContent = '✅';

        setTimeout(
            function () {

                btn.classList.remove('tp9s-spinning');
                btn.textContent = original;

            },
            600
        );

    }

    function resetStatsData() {

        if (
            !confirm(
                'Réinitialiser toutes les statistiques ?\n\n' +
                'Cette action est irréversible (usage des proxys, tchat, bande passante, logs, ...).'
            )
        ) {
            return;
        }

        pageStats = defaultStats();

        saveStatsNow();

        logEvent('warn', 'Statistiques réinitialisées');

        renderStatsDashboard();

        var btn = statsDashboard && statsDashboard.querySelector('.tp9s-reset-stats');

        if (btn) {

            var original = btn.textContent;

            btn.textContent = '✅';

            setTimeout(
                function () {

                    btn.textContent = original;

                },
                800
            );

        }

    }

    function showStatsDashboard() {

        createStatsDashboard();

        statsDashboardVisible = true;

        statsDashboard.style.display = 'flex';

        renderStatsDashboard();

    }

    function hideStatsDashboard() {

        statsDashboardVisible = false;

        if (statsDashboard) {
            statsDashboard.style.display = 'none';
        }

        // Cet onglet n'a été ouvert QUE pour afficher le dashboard
        // (via openStatsDashboardInNewTab) : fermer = fermer l'onglet.
        // window.close() ne fonctionne que sur un onglet ouvert par
        // du script, ce qui est justement le cas ici.
        if (isDashboardOnlyTab) {

            try {

                window.close();

            } catch (e) {}

        }

    }

    var STATS_TAB_META = {
        overview: { title: 'VUE D’ENSEMBLE', sub: 'État général de tes relais de flux' },
        relais: { title: 'RELAIS', sub: 'Classement et utilisation des proxys' },
        streamers: { title: 'STREAMERS', sub: 'Statistiques par chaîne regardée' },
        logs: { title: 'LOGS', sub: 'Journal des événements du script' }
    };

    function renderStatsDashboard(silent) {

        if (!statsDashboard) {
            return;
        }

        statsDashboard.querySelectorAll('.tp9s-nav-item').forEach(function (btn) {

            btn.classList.toggle(
                'tp9s-nav-active',
                btn.getAttribute('data-tab') === statsActiveTab
            );

        });

        var meta = STATS_TAB_META[statsActiveTab];

        statsDashboard.querySelector('.tp9s-page-title').textContent = meta.title;
        statsDashboard.querySelector('.tp9s-page-sub').textContent = meta.sub;

        var content = statsDashboard.querySelector('.tp9s-content');

        // Remplacer innerHTML réinitialise le scroll du conteneur :
        // on le restaure après coup pour un refresh silencieux
        // (sinon la liste "saute" en haut à chaque resynchro).
        var scrollTop = silent ? content.scrollTop : 0;

        if (statsActiveTab === 'overview') {
            renderStatsOverview(content);
        } else if (statsActiveTab === 'relais') {
            renderStatsRelais(content);
        } else if (statsActiveTab === 'streamers') {
            renderStatsStreamers(content);
        } else if (statsActiveTab === 'logs') {
            renderStatsLogs(content);
        }

        if (silent) {

            // Refresh en arrière-plan (resynchro entre onglets) :
            // aucune animation, aucun saut de scroll, pour rester
            // invisible pour l'utilisateur.
            content.scrollTop = scrollTop;

            return;

        }

        // Petite animation d'entrée à chaque changement d'onglet /
        // rafraîchissement manuel, pour un rendu plus vivant.
        content.classList.remove('tp9s-fade');
        void content.offsetWidth;
        content.classList.add('tp9s-fade');

    }

    // navTab (optionnel) : onglet vers lequel la carte navigue au
    // clic ("relais" / "streamers"). historyChannel (optionnel) :
    // en plus de naviguer, ouvre l'historique tchat de ce channel.
    function statCard(icon, label, value, sub, accent, navTab, historyChannel) {

        var navAttrs = navTab
            ? ' data-nav="' + escapeHTML(navTab) + '"' +
              (historyChannel ? ' data-history-channel="' + escapeHTML(historyChannel) + '"' : '')
            : '';

        return (
            '<div class="tp9s-card' + (navTab ? ' tp9s-card-clickable' : '') + '"' +
                navAttrs +
                ' style="--accent:' + (accent || '#9147ff') + '">' +
                '<div class="tp9s-card-top">' +
                    '<div class="tp9s-card-label">' + escapeHTML(label) + '</div>' +
                    '<div class="tp9s-card-icon">' + icon + '</div>' +
                '</div>' +
                '<div class="tp9s-card-value">' + escapeHTML(String(value)) + '</div>' +
                '<div class="tp9s-card-sub">' + escapeHTML(sub || '') + '</div>' +
            '</div>'
        );

    }

    function renderStatsOverview(content) {

        var ranking = getProxyRanking24h();

        var bestProxy = ranking.find(function (p) { return p.avgLatency !== null; });

        var mostUsed = getMostUsedProxy();

        var topWatched = getTopStreamerByWatchTime();

        var topChatted = getTopStreamerByChatMessages();

        var activeCount = pageConfig.proxies.filter(function (p) { return p.enabled; }).length;

        var topWatchedAvatar = topWatched ? getStreamerAvatarUrl(topWatched.channel) : null;
        var topChattedAvatar = topChatted ? getStreamerAvatarUrl(topChatted.channel) : null;

        if (topWatched) {
            ensureChannelMeta(topWatched.channel, onChannelMetaUpdated);
        }

        if (topChatted) {
            ensureChannelMeta(topChatted.channel, onChannelMetaUpdated);
        }

        // Rangée principale : l'essentiel en un coup d'œil.
        var primaryCards = [

            statCard(
                topWatchedAvatar
                    ? '<img src="' + escapeHTML(topWatchedAvatar) + '" alt="">'
                    : '🏆',
                'TOP STREAMER REGARDÉ',
                topWatched ? getStreamerDisplayName(topWatched.channel) : '—',
                topWatched ? formatDuration(topWatched.watchTimeMs) + ' cumulées' : 'aucune donnée',
                '#ff9d4d',
                'streamers'
            ),

            statCard(
                topChattedAvatar
                    ? '<img src="' + escapeHTML(topChattedAvatar) + '" alt="">'
                    : '🔥',
                'TOP STREAMER CHATTÉ',
                topChatted ? getStreamerDisplayName(topChatted.channel) : '—',
                topChatted ? topChatted.chatMessages + ' message(s) envoyés' : 'aucune donnée',
                '#7ae8b0',
                'streamers',
                topChatted ? topChatted.channel : null
            ),

            statCard(
                '📶',
                'BANDE PASSANTE TOTALE',
                formatBytes(pageStats.totals.bandwidthBytesGlobal),
                'estimation • total consommé, pas le débit actuel',
                '#ffcf7a'
            ),

            statCard(
                '⏱',
                'TEMPS DE VISIONNAGE',
                formatDuration(pageStats.totals.watchTimeMsGlobal),
                'estimation • cumulé sur tous les streamers',
                '#bf94ff',
                'streamers'
            )

        ].join('');

        // Rangée secondaire, affichée SOUS le classement des relais
        // pour ne pas surcharger le haut de page.
        var secondaryCards = [

            statCard(
                '🧪',
                'TESTS EFFECTUÉS',
                pageStats.totals.testsCount,
                'depuis le début',
                '#4fc3f7',
                'relais'
            ),

            statCard(
                '💬',
                'TES MESSAGES TCHAT',
                pageStats.totals.chatMessagesGlobal,
                'tous streamers confondus',
                '#ff8fd6',
                'streamers'
            ),

            statCard(
                '🥇',
                'PROXY LE PLUS UTILISÉ',
                mostUsed ? mostUsed.name : '—',
                mostUsed ? mostUsed.count + ' fois' : 'aucune donnée',
                '#9147ff',
                'relais'
            ),

            statCard(
                '📡',
                'RELAIS ACTIFS',
                activeCount,
                'sur ' + pageConfig.proxies.length + ' configurés',
                '#9147ff',
                'relais'
            ),

            statCard(
                '⚡',
                'MEILLEURE LATENCE (7J)',
                bestProxy ? bestProxy.avgLatency + ' ms' : '—',
                bestProxy ? bestProxy.name : 'aucun test récent',
                '#00d084',
                'relais'
            )

        ].join('');

        var top = ranking.slice(0, 8);

        var medals = ['🥇', '🥈', '🥉'];

        var leaderboardRows = top.map(function (p, index) {

            return (
                '<div class="tp9s-lead-row">' +
                    '<div class="tp9s-lead-rank">' + (medals[index] || ('#' + (index + 1))) + '</div>' +
                    '<div class="tp9s-lead-name">' + escapeHTML(p.name) + '</div>' +
                    '<div class="tp9s-lead-latency" style="color:' + latencyColor(p.avgLatency) + '">' +
                        (p.avgLatency !== null ? p.avgLatency + ' ms' : 'non testé') +
                    '</div>' +
                    '<div class="tp9s-lead-rate">' +
                        (p.successRate !== null ? p.successRate + '% réussite' : '—') +
                    '</div>' +
                    '<div class="tp9s-lead-usage">' + p.usage + ' util.</div>' +
                '</div>'
            );

        }).join('');

        content.innerHTML = `

            <div class="tp9s-cards">${primaryCards}</div>

            <div class="tp9s-note">
                ℹ️ Bande passante et temps de visionnage sont des <strong>estimations</strong>
                (basées sur la résolution vidéo, pas une mesure réseau exacte). La bande
                passante affichée est le <strong>total cumulé</strong> consommé depuis le
                début, pas le débit instantané en cours.
            </div>

            <div class="tp9s-panel">
                <div class="tp9s-panel-title-row">
                    <div>
                        <div class="tp9s-panel-title">Relais les plus rapides (7 jours)</div>
                        <div class="tp9s-panel-sub">Classement basé sur la latence moyenne des tests réussis</div>
                    </div>
                    <button type="button" class="tp9s-panel-link" data-nav="relais">Voir tous les relais →</button>
                </div>
                <div class="tp9s-lead-list">
                    ${
                        leaderboardRows ||
                        '<div class="tp9s-empty">Lance un test pour voir le classement.</div>'
                    }
                </div>
            </div>

            <div class="tp9s-cards tp9s-cards-secondary">${secondaryCards}</div>

        `;

    }

    function successRateClass(rate) {

        if (rate === null) return '';
        if (rate >= 80) return 'tp9s-progress-good';
        if (rate >= 50) return 'tp9s-progress-mid';
        return 'tp9s-progress-bad';

    }

    function latencyColor(latencyMs) {

        if (latencyMs === null) return '#888';
        if (latencyMs < 600) return '#00d084';
        if (latencyMs < 1000) return '#ffcf7a';
        return '#ff6b6b';

    }

    function initialLetter(text) {

        return escapeHTML((text || '?').charAt(0).toUpperCase());

    }

    function renderStatsRelais(content) {

        var ranking = getProxyRanking24h();

        var rows = ranking.map(function (p) {

            var rateCls = successRateClass(p.successRate);

            return (
                '<div class="tp9s-table-row tp9s-table-row-relais">' +
                    '<div class="tp9s-td tp9s-td-name-flex">' +
                        '<div class="tp9s-avatar">' + initialLetter(p.name) + '</div>' +
                        '<span>' + escapeHTML(p.name) + '</span>' +
                    '</div>' +
                    '<div class="tp9s-td" style="color:' + latencyColor(p.avgLatency) + ';font-weight:700;">' +
                        (p.avgLatency !== null ? p.avgLatency + ' ms' : '—') +
                    '</div>' +
                    '<div class="tp9s-td tp9s-td-flex">' +
                        (
                            p.successRate !== null
                                ? '<span class="tp9s-progress ' + rateCls + '">' +
                                    '<span class="tp9s-progress-fill" style="width:' + p.successRate + '%"></span>' +
                                  '</span>' + p.successRate + '%'
                                : '—'
                        ) +
                    '</div>' +
                    '<div class="tp9s-td">' + p.testCount + '</div>' +
                    '<div class="tp9s-td">' + p.usage + '</div>' +
                    '<div class="tp9s-td">' +
                        formatBytes(pageStats.bandwidthByProxy[p.id] || 0) +
                    '</div>' +
                '</div>'
            );

        }).join('');

        content.innerHTML = `

            <div class="tp9s-panel">
                <div class="tp9s-panel-title">Classement des relais</div>
                <div class="tp9s-panel-sub">Latence moyenne et fiabilité sur les 7 derniers jours</div>

                <div class="tp9s-table">
                    <div class="tp9s-table-row tp9s-table-row-relais tp9s-table-head">
                        <div class="tp9s-td tp9s-td-name">Proxy</div>
                        <div class="tp9s-td">Latence 7j</div>
                        <div class="tp9s-td">Réussite</div>
                        <div class="tp9s-td">Tests 7j</div>
                        <div class="tp9s-td">Utilisations</div>
                        <div class="tp9s-td">Bande passante (total)</div>
                    </div>
                    ${
                        rows ||
                        '<div class="tp9s-empty">Aucun proxy configuré.</div>'
                    }
                </div>
            </div>

        `;

    }

    function renderStatsStreamers(content) {

        var channels = Object.keys(pageStats.streamers);

        channels.sort(function (a, b) {

            return (
                pageStats.streamers[b].watchTimeMs -
                pageStats.streamers[a].watchTimeMs
            );

        });

        var maxBandwidth = channels.reduce(function (max, channel) {
            return Math.max(max, pageStats.streamers[channel].bandwidthBytes);
        }, 0);

        var AVATAR_COLORS = ['#9147ff', '#00d084', '#4fc3f7', '#ff8fd6', '#ffcf7a', '#ff6b6b'];

        var rows = channels.map(function (channel, index) {

            var s = pageStats.streamers[channel];

            var bestProxyId = null;
            var bestProxyCount = 0;

            Object.keys(s.proxyUsage || {}).forEach(function (id) {

                if (s.proxyUsage[id] > bestProxyCount) {
                    bestProxyCount = s.proxyUsage[id];
                    bestProxyId = id;
                }

            });

            var proxyObj = bestProxyId
                ? pageConfig.proxies.find(function (p) { return p.id === bestProxyId; })
                : null;

            var bwPercent = maxBandwidth
                ? Math.max(6, Math.round((s.bandwidthBytes / maxBandwidth) * 100))
                : 0;

            var avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];

            var displayName = getStreamerDisplayName(channel);

            var avatarUrl = getStreamerAvatarUrl(channel);

            // Manque encore en cache : on la déclenche ici aussi
            // (au cas où le streamer n'a jamais généré d'écriture
            // de stats en direct, ex: import d'anciennes stats).
            ensureChannelMeta(channel, onChannelMetaUpdated);

            var avatarHTML = avatarUrl
                ? '<img class="tp9s-avatar-img" src="' + escapeHTML(avatarUrl) + '" alt="">'
                : (
                    '<div class="tp9s-avatar" style="--accent:' + avatarColor + '">' +
                        initialLetter(displayName) +
                    '</div>'
                );

            return (
                '<div class="tp9s-table-row">' +
                    '<div class="tp9s-td tp9s-td-name-flex">' +
                        avatarHTML +
                        '<span>' + escapeHTML(displayName) + '</span>' +
                    '</div>' +
                    '<div class="tp9s-td">' + formatDuration(s.watchTimeMs) + '</div>' +
                    '<div class="tp9s-td">' +
                        (
                            s.chatMessages > 0
                                ? '<button type="button" class="tp9s-msg-count" data-channel="' +
                                    escapeHTML(channel) + '">' + s.chatMessages + '</button>'
                                : s.chatMessages
                        ) +
                    '</div>' +
                    '<div class="tp9s-td tp9s-td-flex">' +
                        '<span class="tp9s-progress">' +
                            '<span class="tp9s-progress-fill" style="width:' + bwPercent + '%;background:' + avatarColor + '"></span>' +
                        '</span>' +
                        formatBytes(s.bandwidthBytes) +
                    '</div>' +
                    '<div class="tp9s-td">' +
                        (proxyObj ? escapeHTML(proxyObj.name) : '—') +
                    '</div>' +
                '</div>'
            );

        }).join('');

        content.innerHTML = `

            <div class="tp9s-panel">
                <div class="tp9s-panel-title">Streamers suivis</div>
                <div class="tp9s-panel-sub">
                    Temps de visionnage, tes messages tchat et bande passante par streamer ·
                    clique sur le nombre de messages pour voir l'historique
                </div>

                <div class="tp9s-table">
                    <div class="tp9s-table-row tp9s-table-head">
                        <div class="tp9s-td tp9s-td-name">Streamer</div>
                        <div class="tp9s-td">Temps regardé</div>
                        <div class="tp9s-td">Tes messages</div>
                        <div class="tp9s-td">Bande passante (total)</div>
                        <div class="tp9s-td">Proxy principal</div>
                    </div>
                    ${
                        rows ||
                        '<div class="tp9s-empty">Regarde un stream pour commencer à collecter des stats.</div>'
                    }
                </div>
            </div>

        `;

    }

    // ------------------------------------------------------------
    // HISTORIQUE DES MESSAGES ENVOYÉS (modale, par streamer)
    // ------------------------------------------------------------

    var chatHistoryModal = null;

    function ensureChatHistoryModal() {

        if (chatHistoryModal) {
            return chatHistoryModal;
        }

        chatHistoryModal = document.createElement('div');
        chatHistoryModal.id = 'tp9-chat-modal';

        chatHistoryModal.innerHTML = `

            <div class="tp9-chat-modal-backdrop"></div>

            <div class="tp9-chat-modal-box">

                <div class="tp9-chat-modal-header">
                    <div class="tp9-chat-modal-title"></div>
                    <button type="button" class="tp9-chat-modal-close">×</button>
                </div>

                <div class="tp9-chat-modal-list"></div>

            </div>

        `;

        document.body.appendChild(chatHistoryModal);

        chatHistoryModal
            .querySelector('.tp9-chat-modal-backdrop')
            .addEventListener('click', hideChatHistoryModal);

        chatHistoryModal
            .querySelector('.tp9-chat-modal-close')
            .addEventListener('click', hideChatHistoryModal);

        document.addEventListener('keydown', function (event) {

            if (
                event.key === 'Escape' &&
                chatHistoryModal &&
                chatHistoryModal.style.display === 'flex'
            ) {
                hideChatHistoryModal();
            }

        });

        return chatHistoryModal;

    }

    function hideChatHistoryModal() {

        if (chatHistoryModal) {
            chatHistoryModal.style.display = 'none';
        }

    }

    function showChatHistoryModal(channel) {

        var modal = ensureChatHistoryModal();

        var streamer = pageStats.streamers[channel];

        var messages = (streamer && streamer.messages) || [];

        var displayName = getStreamerDisplayName(channel);

        modal.querySelector('.tp9-chat-modal-title').textContent =
            'Messages envoyés à ' + displayName + ' (' + messages.length + ')';

        var rows = messages
            .map(function (entry) {

                var time = new Date(entry.t).toLocaleString(
                    [],
                    {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    }
                );

                return (
                    '<div class="tp9-chat-modal-row">' +
                        '<span class="tp9-chat-modal-time">' + escapeHTML(time) + '</span>' +
                        '<span class="tp9-chat-modal-text">' + escapeHTML(entry.text) + '</span>' +
                    '</div>'
                );

            })
            .join('');

        var listEl = modal.querySelector('.tp9-chat-modal-list');

        listEl.innerHTML =
            rows ||
            '<div class="tp9s-empty">Aucun message capturé pour ce streamer.</div>';

        // Le plus récent est en bas (ordre chronologique croissant) :
        // on scroll direct dessus à l'ouverture.
        listEl.scrollTop = listEl.scrollHeight;

        modal.style.display = 'flex';

    }

    var LOG_LEVEL_META = {
        info: { icon: 'ℹ️', cls: 'tp9s-log-info' },
        success: { icon: '✅', cls: 'tp9s-log-success' },
        warn: { icon: '⚠️', cls: 'tp9s-log-warn' },
        error: { icon: '⛔', cls: 'tp9s-log-error' }
    };

    function renderStatsLogs(content) {

        var rows = pageStats.logs.map(function (entry) {

            var meta = LOG_LEVEL_META[entry.level] || LOG_LEVEL_META.info;

            var time = new Date(entry.t).toLocaleTimeString(
                [],
                { hour: '2-digit', minute: '2-digit', second: '2-digit' }
            );

            return (
                '<div class="tp9s-log-row ' + meta.cls + '">' +
                    '<span class="tp9s-log-icon">' + meta.icon + '</span>' +
                    '<span class="tp9s-log-time">' + time + '</span>' +
                    '<span class="tp9s-log-msg">' + escapeHTML(entry.msg) + '</span>' +
                '</div>'
            );

        }).join('');

        content.innerHTML = `

            <div class="tp9s-panel">
                <div class="tp9s-panel-title-row">
                    <div>
                        <div class="tp9s-panel-title">Journal des événements</div>
                        <div class="tp9s-panel-sub">${pageStats.logs.length} événement(s) enregistré(s)</div>
                    </div>
                    <button type="button" class="tp9s-clear-logs">🗑 Vider les logs</button>
                </div>

                <div class="tp9s-logs">
                    ${
                        rows ||
                        '<div class="tp9s-empty">Aucun événement pour le moment.</div>'
                    }
                </div>
            </div>

        `;

        var clearBtn = content.querySelector('.tp9s-clear-logs');

        if (clearBtn) {

            clearBtn.addEventListener('click', function () {

                pageStats.logs = [];
                scheduleStatsSave();
                renderStatsLogs(content);

            });

        }

    }

    // Appelé par logEvent() pour rafraîchir l'onglet Logs en direct
    // s'il est actuellement affiché.
    function renderDashboardLogs() {

        if (
            !statsDashboard ||
            !statsDashboardVisible ||
            statsActiveTab !== 'logs'
        ) {
            return;
        }

        renderStatsLogs(statsDashboard.querySelector('.tp9s-content'));

    }


    // ============================================================
    // TEST DES PROXYS
    // ============================================================

    // Empêche testAllProxies() et autoTestOnLoad() de tourner
    // en même temps et de se marcher dessus sur pageConfig.proxies
    var testInProgress = false;


    var NON_CHANNEL_PATHS = [
        'directory',
        'search',
        'downloads',
        'videos',
        'moderator',
        'subscriptions',
        'settings',
        'wallet',
        'drops',
        'inventory',
        'friends',
        'p',
        'payments',
        'popout',
        'jobs',
        'turbo',
        'prime',
        'store'
    ];


    function getTestChannel() {

        try {

            var path =
                location.pathname
                    .split('/')
                    .filter(Boolean);


            if (
                path.length &&
                path[0] &&
                NON_CHANNEL_PATHS.indexOf(
                    path[0].toLowerCase()
                ) === -1
            ) {

                return path[0].toLowerCase();

            }

        } catch (e) {}

        return null;

    }


    async function testProxy(
        proxy,
        channel
    ) {

        var url =
            proxy.url.replace(
                '{channel}',
                encodeURIComponent(
                    channel
                )
            );


        var start =
            performance.now();


        try {

            var controller =
                new AbortController();


            var timer =
                setTimeout(
                    function () {

                        controller.abort();

                    },
                    pageConfig.timeout
                );


            var response =
                await fetch(
                    url,
                    {
                        method: 'GET',
                        signal:
                            controller.signal,
                        cache: 'no-store'
                    }
                );


            clearTimeout(timer);


            var elapsed =
                Math.round(
                    performance.now() -
                    start
                );


            if (!response.ok) {

                return {

                    ok: false,

                    status:
                        response.status,

                    latency:
                        elapsed

                };

            }


            var text =
                await response.text();


            var looksLikeHLS =
                text.indexOf(
                    '#EXTM3U'
                ) >= 0
                ||
                text.indexOf(
                    '#EXT-X-'
                ) >= 0;


            return {

                ok:
                    looksLikeHLS,

                status:
                    response.status,

                latency:
                    elapsed

            };


        } catch (error) {

            return {

                ok: false,

                status:
                    error &&
                    error.name ===
                    'AbortError'
                        ? 'TIMEOUT'
                        : 'ERR',

                latency:
                    Math.round(
                        performance.now() -
                        start
                    )

            };

        }

    }


    // ------------------------------------------------------------
    // BOUTONS "OCCUPÉS" (Tester / Reset) — retour visuel + anti
    // double-clic pendant qu'un test tourne en arrière-plan.
    // ------------------------------------------------------------

    function setButtonBusy(button, busyLabel) {

        if (button.dataset.tp9Busy === '1') {
            return;
        }

        button.dataset.tp9Busy = '1';
        button.dataset.tp9OriginalHtml = button.innerHTML;

        button.disabled = true;

        button.innerHTML =
            '<span class="tp9-btn-icon tp9-spin">⏳</span> ' +
            escapeHTML(busyLabel);

    }

    function clearButtonBusy(button) {

        if (button.dataset.tp9Busy !== '1') {
            return;
        }

        delete button.dataset.tp9Busy;

        button.disabled = false;

        button.innerHTML = button.dataset.tp9OriginalHtml;

        delete button.dataset.tp9OriginalHtml;

    }


    async function testAllProxies() {

        if (testInProgress) {

            alert(
                'Un test est déjà en cours, merci de patienter.'
            );

            return;

        }


        var channel =
            getTestChannel();


        if (!channel) {

            alert(
                'Impossible de déterminer la chaîne actuelle.'
            );

            return;

        }


        var enabled =
            pageConfig.proxies.filter(
                function (p) {
                    return p.enabled;
                }
            );


        if (!enabled.length) {

            alert(
                'Aucun proxy activé.'
            );

            return;

        }


        testInProgress = true;

        try {

            console.log(
                '[TwitchProxy] ===== TEST PROXYS ====='
            );


            for (
                var i = 0;
                i < enabled.length;
                i++
            ) {

                var proxy =
                    enabled[i];


                updateProxyStatus(
                    proxy.id,
                    '🟡 test...'
                );


                var result =
                    await testProxy(
                        proxy,
                        channel
                    );


                // ----------------------------------------------------
                // NOUVEAU
                // Sauvegarde du dernier résultat
                // ----------------------------------------------------

                proxy.lastTest = {

                    ok:
                        result.ok,

                    status:
                        result.ok
                            ? 'OK'
                            : result.status,

                    latency:
                        result.latency,

                    timestamp:
                        Date.now(),

                    channel:
                        channel

                };


                recordProxyTest(
                    proxy.id,
                    result.ok,
                    result.latency
                );


                saveConfig(
                    pageConfig
                );


                broadcastConfig();


                if (result.ok) {

                    updateProxyStatus(
                        proxy.id,
                        '🟢 OK · ' +
                        result.latency +
                        ' ms'
                    );

                } else {

                    updateProxyStatus(
                        proxy.id,
                        '🔴 ' +
                        result.status +
                        (
                            result.latency
                                ? ' · ' +
                                  result.latency +
                                  ' ms'
                                : ''
                        )
                    );

                }

            }


            updateCurrentTestInfo();


            console.log(
                '[TwitchProxy] ===== FIN TEST ====='
            );

        } finally {

            testInProgress = false;

        }

    }


    function updateProxyStatus(
        id,
        text
    ) {

        if (!dashboard) {
            return;
        }


        var element =
            dashboard.querySelector(
                '[data-status="' +
                id +
                '"]'
            );


        if (element) {

            element.textContent =
                text;

        }

    }


    // ============================================================
    // CHANNEL CACHE
    // ============================================================

    function saveLastWorkingProxy(
        channel,
        proxyId
    ) {

        try {

            var data = {};

            var existing =
                localStorage.getItem(
                    CHANNEL_CACHE_KEY
                );


            if (existing) {

                data =
                    JSON.parse(existing);

            }


            data[channel] =
                proxyId;


            localStorage.setItem(
                CHANNEL_CACHE_KEY,
                JSON.stringify(data)
            );

        } catch (e) {}

    }


    function getLastWorkingProxy(
        channel
    ) {

        try {

            var existing =
                localStorage.getItem(
                    CHANNEL_CACHE_KEY
                );


            if (!existing) {
                return null;
            }


            var data =
                JSON.parse(existing);


            return (
                data[channel] ||
                null
            );

        } catch (e) {

            return null;

        }

    }


    // ============================================================
    // CODE INJECTÉ DANS LE WORKER
    // ============================================================

    function makePatch() {

        var workerConfig =
            JSON.stringify(pageConfig);


        var lines = [];

        lines.push('(function(){');

        lines.push(
            'console.log("[TwitchProxy] Worker patch actif");'
        );

        lines.push(
            'var __tp_originalFetch = self.fetch;'
        );


        // --------------------------------------------------------
        // Configuration initiale
        // --------------------------------------------------------

        lines.push(
            'var __tp_config = ' +
            workerConfig +
            ';'
        );


        // --------------------------------------------------------
        // Réception des changements depuis le dashboard
        // --------------------------------------------------------

        lines.push(`
            try {

                var __tp_bc =
                    new BroadcastChannel(
                        'twitch-proxy-config-v1'
                    );

                __tp_bc.onmessage =
                    function(event) {

                        try {

                            if (
                                event.data &&
                                event.data.type === 'config'
                            ) {

                                __tp_config =
                                    event.data.config;

                                console.log(
                                    '[TwitchProxy] Configuration mise à jour'
                                );

                            }

                        } catch(e) {}

                    };

                __tp_bc.postMessage({
                    type: 'log',
                    level: 'info',
                    msg: 'Worker HLS patché'
                });

            } catch(e) {}

        `);


        // --------------------------------------------------------
        // Extraction channel
        // --------------------------------------------------------

        lines.push(`
            function __tp_getChannel(url){

                try {

                    var u = new URL(url);

                    var parts =
                        u.pathname
                            .split("/")
                            .filter(Boolean);

                    var i =
                        parts.indexOf("hls");

                    if (
                        i >= 0 &&
                        parts[i + 1]
                    ) {

                        var ch =
                            parts[i + 1];

                        ch =
                            ch.replace(
                                /\\.m3u8$/i,
                                ""
                            );

                        ch =
                            ch.trim()
                                .toLowerCase();

                        if (ch) {
                            return ch;
                        }

                    }

                    var q =
                        u.searchParams.get(
                            "channel"
                        );

                    if (q) {

                        q =
                            q.replace(
                                /\\.m3u8$/i,
                                ""
                            );

                        q =
                            q.trim()
                                .toLowerCase();

                        if (q) {
                            return q;
                        }

                    }

                } catch(e) {

                    console.warn(
                        "[TwitchProxy] Erreur extraction channel:",
                        e
                    );

                }

                return null;
            }
        `);


        // --------------------------------------------------------
        // Construction URL proxy
        // --------------------------------------------------------

        lines.push(`
            function __tp_buildURL(proxy, channel){

                return proxy.url.replace(
                    "{channel}",
                    encodeURIComponent(channel)
                );

            }
        `);


        // --------------------------------------------------------
        // Validation HLS
        // --------------------------------------------------------

        lines.push(`
            function __tp_validateResponse(response){

                if (
                    !response ||
                    !response.ok
                ) {
                    return Promise.resolve(false);
                }

                try {

                    return response
                        .clone()
                        .text()
                        .then(function(text){

                            return (
                                text.indexOf(
                                    "#EXTM3U"
                                ) >= 0
                                ||
                                text.indexOf(
                                    "#EXT-X-"
                                ) >= 0
                            );

                        })
                        .catch(function(){

                            return false;

                        });

                } catch(e) {

                    return Promise.resolve(false);

                }

            }
        `);


        // --------------------------------------------------------
        // Fetch avec timeout
        // --------------------------------------------------------

        lines.push(`
            function __tp_fetchProxy(
                proxyURL,
                init,
                timeout,
                controller
            ){

                return new Promise(
                    function(resolve, reject){

                        var finished = false;

                        var timer =
                            setTimeout(
                                function(){

                                    if (!finished) {

                                        finished = true;

                                        try {
                                            controller.abort();
                                        } catch(e) {}

                                        reject(
                                            new Error(
                                                "Proxy timeout"
                                            )
                                        );

                                    }

                                },
                                timeout
                            );


                        var fetchInit =
                            init
                                ? Object.assign({}, init, { signal: controller.signal })
                                : { signal: controller.signal };


                        __tp_originalFetch.call(
                            self,
                            proxyURL,
                            fetchInit
                        )
                        .then(function(response){

                            if (finished) {
                                return;
                            }

                            finished = true;

                            clearTimeout(timer);

                            resolve(response);

                        })
                        .catch(function(error){

                            if (finished) {
                                return;
                            }

                            finished = true;

                            clearTimeout(timer);

                            reject(error);

                        });

                    }
                );

            }
        `);


        // --------------------------------------------------------
        // Hook fetch
        // --------------------------------------------------------

        lines.push(`
            self.fetch = function(input, init){

                var originalURL = "";

                try {

                    if (
                        typeof input === "string"
                    ) {

                        originalURL = input;

                    } else if (
                        input &&
                        input.url
                    ) {

                        originalURL =
                            input.url;

                    }

                } catch(e) {}


                var lowerURL =
                    originalURL.toLowerCase();


                var isUsher =
                    lowerURL.indexOf(
                        "usher.ttvnw.net"
                    ) >= 0
                    ||
                    lowerURL.indexOf(
                        "usher.twitchapps.com"
                    ) >= 0;


                if (!isUsher) {

                    return __tp_originalFetch.call(
                        this,
                        input,
                        init
                    );

                }


                console.log(
                    "[TwitchProxy] Usher détecté:",
                    originalURL
                );


                var isHls =
                    lowerURL.indexOf(
                        "/hls/"
                    ) >= 0
                    ||
                    /\\.m3u8([?#]|$)/i.test(
                        originalURL
                    );


                if (!isHls) {

                    console.log(
                        "[TwitchProxy] Usher non-HLS → original"
                    );

                    return __tp_originalFetch.call(
                        this,
                        input,
                        init
                    );

                }


                var channel =
                    __tp_getChannel(
                        originalURL
                    );


                if (!channel) {

                    console.warn(
                        "[TwitchProxy] Channel introuvable"
                    );

                    return __tp_originalFetch.call(
                        this,
                        input,
                        init
                    );

                }


                var enabled =
                    (
                        __tp_config &&
                        Array.isArray(
                            __tp_config.proxies
                        )
                    )
                    ?
                    __tp_config.proxies.filter(
                        function(proxy){
                            return proxy.enabled;
                        }
                    )
                    :
                    [];


                if (!enabled.length) {

                    console.warn(
                        "[TwitchProxy] Aucun proxy activé → Twitch"
                    );

                    return __tp_originalFetch.call(
                        this,
                        input,
                        init
                    );

                }


                console.log(
                    "[TwitchProxy] ================================="
                );

                console.log(
                    "[TwitchProxy] Channel :",
                    channel
                );

                console.log(
                    "[TwitchProxy] Proxys actifs :",
                    enabled.map(
                        function(p){
                            return p.name;
                        }
                    )
                );

                console.log(
                    "[TwitchProxy] ================================="
                );


                var timeout =
                    (
                        __tp_config &&
                        __tp_config.timeout
                    )
                    ||
                    4000;


                var fallbackEnabled =
                    !(
                        __tp_config &&
                        __tp_config.fallback === false
                    );


                // Les proxys sont tentés en PARALLÈLE (au lieu
                // d'un par un) : on garde le premier qui répond
                // avec un manifest HLS valide et on annule les
                // autres tentatives encore en vol.
                var controllers =
                    [];


                var winnerFound =
                    false;


                var winnerResponse =
                    null;


                var winnerProxy =
                    null;


                console.log(
                    "[TwitchProxy] Lancement en parallèle sur " +
                    enabled.length +
                    " proxys :",
                    enabled.map(
                        function(proxy){

                            return {
                                name: proxy.name,
                                url: __tp_buildURL(proxy, channel)
                            };

                        }
                    )
                );


                var attempts =
                    enabled.map(
                        function(proxy){

                            var controller =
                                new AbortController();

                            controllers.push(
                                controller
                            );


                            var proxyURL =
                                __tp_buildURL(
                                    proxy,
                                    channel
                                );


                            var start =
                                performance.now();


                            return __tp_fetchProxy(
                                proxyURL,
                                init,
                                timeout,
                                controller
                            )
                            .then(
                                function(response){

                                    return __tp_validateResponse(
                                        response
                                    )
                                    .then(
                                        function(valid){

                                            if (!valid) {

                                                console.warn(
                                                    "[TwitchProxy] 🔴 Proxy HLS invalide:",
                                                    proxy.name
                                                );

                                                return;

                                            }


                                            if (
                                                winnerFound
                                            ) {
                                                return;
                                            }


                                            winnerFound = true;

                                            winnerResponse =
                                                response;

                                            winnerProxy =
                                                proxy;


                                            var elapsed =
                                                Math.round(
                                                    performance.now()
                                                    -
                                                    start
                                                );


                                            console.log(
                                                "[TwitchProxy] 🟢 Proxy OK:",
                                                proxy.name,
                                                response.status,
                                                elapsed + "ms"
                                            );


                                            controllers.forEach(
                                                function(other){

                                                    if (
                                                        other !==
                                                        controller
                                                    ) {

                                                        try {
                                                            other.abort();
                                                        } catch(e) {}

                                                    }

                                                }
                                            );


                                            if (__tp_bc) {

                                                try {

                                                    __tp_bc.postMessage({
                                                        type: "activeProxy",
                                                        proxyId: proxy.id,
                                                        proxyName: proxy.name,
                                                        channel: channel,
                                                        direct: false,
                                                        timestamp: Date.now()
                                                    });

                                                } catch(e) {}

                                            }

                                        }
                                    );

                                }
                            )
                            .catch(
                                function(error){

                                    if (
                                        error &&
                                        error.name === "AbortError"
                                    ) {
                                        return;
                                    }

                                    console.warn(
                                        "[TwitchProxy] 🔴 Proxy erreur:",
                                        proxy.name,
                                        error
                                    );

                                }
                            );

                        }
                    );


                return Promise.all(
                    attempts
                )
                .then(
                    function(){

                        if (
                            winnerResponse
                        ) {

                            return winnerResponse;

                        }


                        console.warn(
                            "[TwitchProxy] Tous les proxys ont échoué"
                        );


                        if (__tp_bc) {

                            try {

                                __tp_bc.postMessage({
                                    type: "activeProxy",
                                    proxyId: null,
                                    proxyName: null,
                                    channel: channel,
                                    direct: true,
                                    timestamp: Date.now()
                                });

                                __tp_bc.postMessage({
                                    type: "log",
                                    level: "error",
                                    msg: "Tous les proxys ont échoué pour " + channel
                                });

                            } catch(e) {}

                        }


                        if (
                            fallbackEnabled
                        ) {

                            console.log(
                                "[TwitchProxy] → Fallback Twitch"
                            );

                            return __tp_originalFetch.call(
                                this,
                                input,
                                init
                            );

                        }


                        return __tp_originalFetch.call(
                            this,
                            input,
                            init
                        );

                    }.bind(this)
                );

            };
        `);


        lines.push('})();');


        return lines.join('\n');

    }


    // ============================================================
    // LECTURE BLOB WORKER
    // ============================================================

    function getBlobCode(blobURL) {

        try {

            var xhr =
                new XMLHttpRequest();


            xhr.open(
                'GET',
                blobURL,
                false
            );


            xhr.send(null);


            if (
                xhr.status >= 200 &&
                xhr.status < 300
            ) {

                return xhr.responseText;

            }

        } catch (e) {

            console.warn(
                '[TwitchProxy] Lecture Blob impossible:',
                e
            );

        }


        return null;

    }


    // ============================================================
    // HOOK WORKER
    // ============================================================

    // URL du dernier Blob Worker patché créé. On la libère
    // seulement quand un NOUVEAU Worker est créé (donc que
    // l'ancien a forcément déjà fini de charger son script),
    // pour éviter d'accumuler des Blob non libérés en mémoire
    // à chaque changement de chaîne/qualité.
    var lastPatchedBlobURL = null;


    window.Worker =
        function (
            scriptURL,
            options
        ) {

            console.log(
                '[TwitchProxy] Worker() appelé:',
                typeof scriptURL === 'string'
                    ? scriptURL.substring(
                        0,
                        120
                    )
                    : scriptURL
            );


            if (
                typeof scriptURL === 'string' &&
                scriptURL.indexOf('blob:') === 0
            ) {

                var originalCode =
                    getBlobCode(
                        scriptURL
                    );


                if (originalCode) {

                    console.log(
                        '[TwitchProxy] Blob Worker lu:',
                        originalCode.length,
                        'caractères'
                    );


                    var patchedCode =
                        makePatch() +
                        '\n' +
                        originalCode;


                    var blob =
                        new Blob(
                            [patchedCode],
                            {
                                type:
                                    'application/javascript'
                            }
                        );


                    var newURL =
                        URL.createObjectURL(
                            blob
                        );


                    if (lastPatchedBlobURL) {

                        URL.revokeObjectURL(
                            lastPatchedBlobURL
                        );

                    }

                    lastPatchedBlobURL =
                        newURL;


                    console.log(
                        '[TwitchProxy] >>> Blob Worker PATCHÉ'
                    );


                    return new NativeWorker(
                        newURL,
                        options
                    );

                }


                console.warn(
                    '[TwitchProxy] Impossible de lire le Blob → Worker original'
                );

            }


            return new NativeWorker(
                scriptURL,
                options
            );

        };


    window.Worker.prototype =
        NativeWorker.prototype;


    // ============================================================
    // INITIALISATION UI
    // ============================================================

    // ============================================================
    // TRI AUTOMATIQUE DES PROXYS PAR PING
    // ============================================================

    function autoSortProxies() {

        var tested = pageConfig.proxies.filter(function (p) {
            return p.lastTest && p.lastTest.ok;
        });

        var failed = pageConfig.proxies.filter(function (p) {
            return !p.lastTest || !p.lastTest.ok;
        });

        tested.sort(function (a, b) {
            return a.lastTest.latency - b.lastTest.latency;
        });

        var reordered = tested.concat(failed);

        // Évite de sauvegarder/broadcast/logger pour rien quand le
        // tri ne change en fait rien à l'ordre (appelé toutes les
        // minutes par le re-test périodique même sans nouveaux
        // résultats) — ça spammait la console et les Workers.
        var unchanged =
            reordered.length === pageConfig.proxies.length &&
            reordered.every(function (p, i) {
                return p.id === pageConfig.proxies[i].id;
            });

        if (unchanged) {
            return;
        }

        pageConfig.proxies = reordered;

        saveConfig(pageConfig);

        broadcastConfig();

        renderDashboard();

        console.log('[TwitchProxy] Proxys re-triés par ping');

    }


    // ============================================================
    // TEST AUTO AU DÉMARRAGE
    // ============================================================

    async function autoTestOnLoad() {

        if (testInProgress) {
            console.log('[TwitchProxy] Auto-test ignoré : un test est déjà en cours');
            return;
        }

        var channel = getTestChannel();

        if (!channel) {
            console.log('[TwitchProxy] Auto-test ignoré : pas de chaîne détectée');
            return;
        }

        var delay =
            (pageConfig.cacheDelay || DEFAULT_CACHE_DELAY) * 60 * 1000;
        var now = Date.now();

        var recentTest = pageConfig.proxies.some(function (p) {
            return (
                p.lastTest &&
                p.lastTest.channel === channel &&
                p.lastTest.timestamp &&
                (now - p.lastTest.timestamp) < delay
            );
        });

        if (recentTest) {
            console.log('[TwitchProxy] Auto-test ignoré : résultats récents');
            autoSortProxies();
            return;
        }

        var enabled = pageConfig.proxies.filter(function (p) {
            return p.enabled;
        });

        if (!enabled.length) {
            return;
        }

        testInProgress = true;

        try {

            console.log('[TwitchProxy] ===== AUTO-TEST DÉMARRAGE =====');

            for (var i = 0; i < enabled.length; i++) {

                var proxy = enabled[i];

                var result = await testProxy(proxy, channel);

                proxy.lastTest = {
                    ok: result.ok,
                    status: result.ok ? 'OK' : result.status,
                    latency: result.latency,
                    timestamp: Date.now(),
                    channel: channel
                };

                recordProxyTest(
                    proxy.id,
                    result.ok,
                    result.latency
                );

            }

            autoSortProxies();

            console.log('[TwitchProxy] ===== AUTO-TEST TERMINÉ =====');

        } finally {

            testInProgress = false;

        }

    }


    // ============================================================
    // DÉTECTION NAVIGATION SPA (changement de stream sans reload)
    // ============================================================

    var lastKnownChannel = null;

    function handlePossibleChannelChange() {

        var channel = getTestChannel();

        if (!channel || channel === lastKnownChannel) {
            return;
        }

        lastKnownChannel = channel;

        console.log('[TwitchProxy] Changement de chaîne détecté :', channel);

        setTimeout(function () {
            autoTestOnLoad();
        }, 3000);

    }

    (function hookHistoryForNavigation() {

        var originalPushState = history.pushState;
        var originalReplaceState = history.replaceState;

        history.pushState = function () {

            var result = originalPushState.apply(this, arguments);

            window.dispatchEvent(new Event('tp9-locationchange'));

            return result;

        };

        history.replaceState = function () {

            var result = originalReplaceState.apply(this, arguments);

            window.dispatchEvent(new Event('tp9-locationchange'));

            return result;

        };

        window.addEventListener('popstate', function () {

            window.dispatchEvent(new Event('tp9-locationchange'));

        });

        window.addEventListener(
            'tp9-locationchange',
            handlePossibleChannelChange
        );

    })();


    function initUI() {

        if (!document.body) {

            setTimeout(
                initUI,
                100
            );

            return;

        }


        // Cet onglet a été ouvert uniquement pour afficher le
        // dashboard (bouton "📊 Dashboard" du popup) : on l'affiche
        // direct, pas besoin du bouton flottant / auto-test proxy.
        if (isDashboardOnlyTab) {

            lockDashboardTabIdentity();

            showStatsDashboard();

            return;

        }


        lastKnownChannel = getTestChannel();

        createPlayerButton();

        // Applique tout de suite le badge si une mise à jour était
        // déjà connue depuis un check précédent (avant même le
        // premier fetch de cette session).
        updateUpdateUI();

        // Lancement du test auto après 3 secondes
        // (laisse le temps à la page de charger)
        setTimeout(function () {
            autoTestOnLoad();
        }, 3000);

        // Vérification de mise à jour : toujours forcée à chaque
        // chargement/refresh de page (l'utilisateur veut être fixé
        // immédiatement, pas attendre le cooldown d'1h), puis on
        // relance le check périodiquement (celui-ci respecte le
        // cooldown) pour couvrir les sessions qui restent ouvertes
        // longtemps sans reload.
        checkForScriptUpdate(true);

        setInterval(
            function () {
                checkForScriptUpdate();
            },
            UPDATE_CHECK_INTERVAL_MS
        );


        // Le chat Twitch déclenche des dizaines de mutations DOM
        // par seconde sur document.body : on throttle l'appel à
        // positionPlayerUI() pour éviter de le relancer en boucle
        // (les mutations de chat n'affectent quasiment jamais la
        // position réelle du bouton, un léger délai ne se voit pas).
        var positionUIThrottleTimer = null;
        var positionUILastRun = 0;
        var POSITION_UI_THROTTLE_MS = 300;

        function throttledPositionPlayerUI() {

            var now = Date.now();
            var elapsed = now - positionUILastRun;

            if (elapsed >= POSITION_UI_THROTTLE_MS) {

                positionUILastRun = now;
                positionPlayerUI();
                return;

            }

            if (positionUIThrottleTimer) {
                return;
            }

            positionUIThrottleTimer = setTimeout(
                function () {

                    positionUIThrottleTimer = null;
                    positionUILastRun = Date.now();
                    positionPlayerUI();

                },
                POSITION_UI_THROTTLE_MS - elapsed
            );

        }


        // Pour scroll/resize, la position DOIT suivre en temps réel
        // (le bouton est en position: fixed et doit rester collé au
        // bouton Follow pendant le scroll) : on cale l'appel sur
        // requestAnimationFrame plutôt que sur un délai fixe, pour
        // rester fluide (~60fps) tout en évitant les appels
        // redondants si plusieurs events arrivent avant la frame.
        var positionUIRafPending = false;

        function rafPositionPlayerUI() {

            if (positionUIRafPending) {
                return;
            }

            positionUIRafPending = true;

            requestAnimationFrame(function () {

                positionUIRafPending = false;
                positionPlayerUI();

            });

        }


        var observer =
            new MutationObserver(
                function () {

                    throttledPositionPlayerUI();

                }
            );


        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );


        window.addEventListener(
            'resize',
            rafPositionPlayerUI
        );


        window.addEventListener(
            'scroll',
            rafPositionPlayerUI,
            true
        );


        setInterval(
            positionPlayerUI,
            1500
        );


        // Re-test périodique en arrière-plan : autoTestOnLoad()
        // gère déjà lui-même le cooldown via "Re-test auto",
        // on l'appelle juste régulièrement pour qu'il puisse
        // se déclencher sans changement de chaîne ni refresh.
        setInterval(
            function () {
                autoTestOnLoad();
            },
            60 * 1000
        );


        // Stats dashboard : bande passante / temps de visionnage
        // (estimation).
        setInterval(trackBandwidthAndWatchTime, BANDWIDTH_TICK_MS);

    }


    if (
        document.readyState ===
        'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            initUI,
            {
                once: true
            }
        );

    } else {

        initUI();

    }


    console.log(
        '[TwitchProxy] ===== HOOK INSTALLE ====='
    );

})();
