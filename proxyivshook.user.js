// ==UserScript==
// @name         Twitch HLS Proxy
// @namespace    twitch-proxy-ivs
// @version      1.7.5
// @author       razeNFR
// @description  Twitch HLS via plusieurs proxys - Dashboard statistiques (nouvel onglet, design amélioré) + fallback automatique + résultats persistants + proxys personnalisés
// @match        https://www.twitch.tv/*
// @run-at       document-start
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js
// @updateURL    https://raw.githubusercontent.com/razeNFR/proxyivshook/main/proxyivshook.user.js
// @downloadURL  https://raw.githubusercontent.com/razeNFR/proxyivshook/main/proxyivshook.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // CONFIGURATION
    // ============================================================

    var STORAGE_KEY = 'twitchProxyManagerV1';
    var STATS_KEY = 'twitchProxyStatsV1';
    var UPDATE_CHECK_KEY = 'twitchProxyUpdateCheckV1';

    // Identifiant unique de CET onglet. Le BroadcastChannel est
    // partagé par tous les onglets twitch.tv : sans ça, les octets
    // mesurés par le Worker d'un onglet seraient aussi comptés par
    // les autres onglets ouverts sur la même chaîne.
    var TAB_ID =
        Date.now().toString(36) +
        '-' +
        Math.random().toString(36).substring(2, 9);

    // Doit être tenu à jour avec le @version de l'en-tête du script.
    var CURRENT_VERSION = '1.7.5';

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


    // ------------------------------------------------------------
    // Habillage visuel des proxys (icône + couleur) dans le menu
    // ------------------------------------------------------------

    var PROXY_REGION_META = {
        eu: { icon: '🇪🇺', accent: '#4fc3f7', label: 'Europe' },
        na: { icon: '🇺🇸', accent: '#ff9d4d', label: 'Amérique du Nord' },
        as: { icon: '🌏', accent: '#00d084', label: 'Asie' },
        sa: { icon: '🌎', accent: '#ff8fd6', label: 'Amérique du Sud' }
    };

    // La région d'un relais ne se devine plus : elle est déclarée.
    //
    // L'ancienne version la déduisait du suffixe de l'id, et se
    // trompait sur deux relais : lb-sa est à New York et sert du CDN
    // nord-américain, as.luminous.dev est au Kazakhstan mais sert du
    // CDN européen. Un nom d'hôte ne prouve rien.
    //
    // Deux champs parce qu'il y a deux faits, et qu'ils ne sont pas
    // toujours d'accord :
    //
    //   cdn  — le CDN Twitch attaqué, donc d'où le flux sort vraiment.
    //          C'est lui qui donne le drapeau, la couleur et le groupe.
    //   host — le pays où le relais est hébergé, donc à qui TA connexion
    //          parle, et ce qui explique une latence inattendue. null
    //          quand le fournisseur répartit sur plusieurs pays.
    var PROXY_META = {
        'luminous-eu':  { cdn: 'eu', host: '🇷🇺 Russie' },
        'luminous-eu2': { cdn: 'eu', host: '🇺🇦 Ukraine' },
        'luminous-eu3': { cdn: 'eu', host: '🇧🇬 Bulgarie' },
        'luminous-as':  { cdn: 'eu', host: '🇰🇿 Kazakhstan' },
        'perfprod-eu':  { cdn: 'eu', host: null },
        'perfprod-eu2': { cdn: 'eu', host: null },
        'perfprod-eu3': { cdn: 'eu', host: '🇷🇺 Russie' },
        'perfprod-eu4': { cdn: 'eu', host: null },
        'perfprod-eu5': { cdn: 'eu', host: null },
        'perfprod-na':  { cdn: 'na', host: '🇺🇸 Phoenix (Arizona)' },
        'perfprod-as':  { cdn: 'as', host: null },
        'perfprod-sa':  { cdn: 'na', host: '🇺🇸 New York' }
    };


    // Un relais absent de la table (Nadeko, ou un proxy perso) n'a
    // pas de région : il garde son 📡 générique plutôt qu'un drapeau
    // inventé.
    function getProxyRegion(proxy) {

        var meta = PROXY_META[proxy.id];

        return meta ? meta.cdn : null;

    }


    // Infobulle posée sur la pastille de région, dans le menu comme
    // dans le tableau du dashboard : un drapeau seul ne peut pas dire
    // les deux faits à la fois.
    function getProxyTipAttrs(proxy) {

        var meta = PROXY_META[proxy.id];

        if (!meta) {
            return '';
        }

        var region = PROXY_REGION_META[meta.cdn];

        return (
            ' data-tp9-tip="' +
            escapeHTML(
                meta.host
                    ? 'Hébergé en ' + meta.host
                    : 'Hébergement réparti sur plusieurs pays'
            ) +
            '" data-tp9-tip-sub="' +
            escapeHTML(
                'Flux servi par le CDN Twitch ' +
                (region ? region.label : '?') +
                " — c'est lui qui donne la région."
            ) +
            '"'
        );

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


    // Le liseré gauche d'une ligne de proxy porte désormais son
    // ÉTAT, et non plus sa région : celle-ci était déjà dite trois
    // fois (le groupe, le drapeau, la couleur de l'avatar), tandis
    // que l'état n'était lisible qu'en lisant le texte de chaque
    // pastille, ligne par ligne.
    //
    // Quatre couleurs, pas une de plus : pas de nuance selon la
    // latence, car l'ambre sert déjà à la quarantaine et deux sens
    // pour une même couleur rendraient la lecture ambiguë.
    function getProxyHealthColor(proxy) {

        if (proxy.quarantine) {
            return '#ffcf7a';
        }

        // Décoché : il ne court pas, il n'a donc aucun état à
        // signaler — même gris que « jamais testé ».
        if (!proxy.enabled || !proxy.lastTest) {
            return '#6b6b73';
        }

        return proxy.lastTest.ok ? '#00d084' : '#ff6b6b';

    }


    // Construit un objet config valide (proxys fusionnés avec les
    // défauts, champs validés) à partir d'un objet arbitraire —
    // utilisé à la fois pour charger depuis localStorage et pour
    // l'import d'un fichier JSON exporté.
    // ------------------------------------------------------------
    // RETOUR ARRIÈRE (DVR)
    // ------------------------------------------------------------
    //
    // Les crans du curseur de profondeur. Une plage libre de 30 s
    // à 30 min n'aurait aucun intérêt : personne ne règle un
    // buffer à 7 min 20. Des crans donnent en prime une étiquette
    // lisible et une estimation mémoire stable.
    var DVR_BUFFER_STEPS = [
        30, 60, 120, 180, 300, 600, 900, 1200, 1800
    ];

    var DEFAULT_DVR_BUFFER_SECONDS = 180;

    // Débit de repli quand rien n'a encore été mesuré : le
    // 1080p60 de Twitch tourne autour de 6,2 Mbps (relevé sur un
    // master playlist réel), soit ~775 Ko/s.
    var DVR_FALLBACK_BYTES_PER_SECOND = 775000;


    // Sert autant aux crans du curseur (qui tombent juste) qu'a la
    // profondeur REELLEMENT en memoire, qui elle ne tombe jamais
    // juste : 256 s donnait « 4.266666666666667 min ».
    function dvrBufferLabel(seconds) {

        var total = Math.round(seconds || 0);

        if (total < 60) {
            return total + ' s';
        }

        var minutes = Math.floor(total / 60);
        var rest = total % 60;

        if (!rest) {
            return minutes + ' min';
        }

        return minutes + ' min ' + rest + ' s';

    }


    // Une URL de relais valide : http(s), et {channel} dedans. Le
    // formulaire d'ajout le vérifiait, l'import non — n'importe quel
    // javascript:... ou data:... passait.
    function isProxyURLValid(url) {

        if (
            typeof url !== 'string' ||
            url.indexOf('{channel}') === -1
        ) {
            return false;
        }

        try {

            // {channel} est remplacé le temps du contrôle seulement :
            // le proxy enregistré le conserve.
            var parsed = new URL(
                url.replace('{channel}', 'testchannel')
            );

            return (
                parsed.protocol === 'http:' ||
                parsed.protocol === 'https:'
            );

        } catch (e) {

            return false;

        }

    }

    function buildConfigFromParsed(parsed) {

        var config = {
            proxies: DEFAULT_PROXIES.map(
                createDefaultProxy
            ),
            fallback: true,
            timeout: DEFAULT_TIMEOUT,
            cacheDelay: DEFAULT_CACHE_DELAY,
            keepQualityInBackground: true,
            autoBackupStats: true,
            dvrChannels: {},
            dvrBufferSeconds: DEFAULT_DVR_BUFFER_SECONDS,
            dvrAutoOpen: 'never'
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
                                null,

                            quarantine:
                                savedProxy.quarantine ||
                                null,

                            quarantineProtectedUntil:
                                savedProxy.quarantineProtectedUntil ||
                                0

                        });

                        return;

                    }


                    // ------------------------------------------------
                    // Proxy personnalisé
                    // ------------------------------------------------

                    if (
                        savedProxy.name &&
                        isProxyURLValid(savedProxy.url)
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
                                null,

                            quarantine:
                                savedProxy.quarantine ||
                                null,

                            quarantineProtectedUntil:
                                savedProxy.quarantineProtectedUntil ||
                                0

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

        if (
            typeof parsed.autoBackupStats ===
            'boolean'
        ) {

            config.autoBackupStats =
                parsed.autoBackupStats;

        }

        // Une chaine absente de la table n'enregistre rien : le
        // buffer coute de la memoire, il ne s'arme que la ou on
        // l'a demande.
        if (
            parsed.dvrChannels &&
            typeof parsed.dvrChannels === 'object'
        ) {

            Object.keys(
                parsed.dvrChannels
            ).forEach(
                function (channel) {

                    if (parsed.dvrChannels[channel]) {

                        config.dvrChannels[channel] = true;

                    }

                }
            );

        }

        // Trois etats seulement : jamais, quand un VOD existe,
        // toujours. Tout le reste retombe sur « jamais », qui est
        // l'ancien comportement.
        if (
            parsed.dvrAutoOpen === 'vod' ||
            parsed.dvrAutoOpen === 'always'
        ) {

            config.dvrAutoOpen = parsed.dvrAutoOpen;

        }

        // La profondeur n'est pas libre : elle doit tomber sur un
        // cran connu, sinon le curseur des reglages n'aurait aucune
        // position a afficher.
        if (
            typeof parsed.dvrBufferSeconds ===
            'number' &&
            DVR_BUFFER_STEPS.indexOf(
                parsed.dvrBufferSeconds
            ) >= 0
        ) {

            config.dvrBufferSeconds =
                parsed.dvrBufferSeconds;

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
                    pageConfig.keepQualityInBackground,

                autoBackupStats:
                    pageConfig.autoBackupStats,

                dvrChannels:
                    pageConfig.dvrChannels,

                dvrBufferSeconds:
                    pageConfig.dvrBufferSeconds,

                dvrAutoOpen:
                    pageConfig.dvrAutoOpen

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

            // Même convention de nommage que les sauvegardes de
            // statistiques (voir backupStampFor).
            link.download =
                'Twitch_HLS_Proxy-Config-' +
                backupStampFor(new Date()) +
                '.json';

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
            dailyWatchTime: {},
            hourlyWatchTime: {},

            // Mêmes clés que ci-dessus, mais en octets : permet au
            // graphique d'afficher la bande passante dans le temps
            // et pas seulement un total à vie.
            dailyBandwidth: {},
            hourlyBandwidth: {},

            // Blocs de visionnage continus — voir
            // recordSessionProgress().
            sessions: [],

            // Cumul par (jour de semaine, heure) : 168 cases au
            // total, jamais purgées — c'est la base de l'onglet
            // "Habitudes". Clé "jour-heure", ex "2-21" = mardi 21h.
            watchHeatmap: {},

            // Chaque bascule en lecture directe Twitch (= le moment
            // où les pubs reviennent). C'est la raison d'être du
            // script : ça ne peut pas rester une simple ligne noyée
            // dans 300 logs.
            directPlaybacks: [],

            // Latences RÉELLES relevées pendant la lecture, par
            // proxy : { id: [{ t, ms }] }. Distinct de proxyHistory,
            // qui ne contient que les tests provoqués.
            proxyLiveLatency: {},

            // 'network' | 'decoder' | 'estimate' : d'où viennent
            // les octets comptabilisés. Stocké dans les stats (et
            // pas en variable locale) pour que l'onglet dashboard,
            // qui n'a aucune vidéo en cours, puisse quand même
            // afficher la provenance de la mesure.
            bandwidthSource: null,

            // Incrémenté à chaque remise à zéro et à chaque import :
            // voir mergeStatsWithStored. Il permet aux autres onglets
            // de JETER leurs incréments en attente au lieu de
            // ressusciter des chiffres qu'on vient d'effacer.
            epoch: 0,

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
                    stats.dailyWatchTime = parsed.dailyWatchTime || {};
                    stats.hourlyWatchTime = parsed.hourlyWatchTime || {};
                    stats.dailyBandwidth = parsed.dailyBandwidth || {};
                    stats.hourlyBandwidth = parsed.hourlyBandwidth || {};
                    stats.sessions =
                        Array.isArray(parsed.sessions) ? parsed.sessions : [];
                    stats.watchHeatmap = parsed.watchHeatmap || {};
                    stats.directPlaybacks =
                        Array.isArray(parsed.directPlaybacks)
                            ? parsed.directPlaybacks
                            : [];
                    stats.proxyLiveLatency = parsed.proxyLiveLatency || {};
                    stats.bandwidthSource = parsed.bandwidthSource || null;
                    stats.epoch = parsed.epoch || 0;

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

    // ------------------------------------------------------------
    // ÉCRITURE PARTAGÉE ENTRE ONGLETS
    // ------------------------------------------------------------
    //
    // Chaque onglet accumule ses incréments en mémoire et ne les
    // écrit que 2 s plus tard (scheduleStatsSave). L'écouteur
    // 'storage' remplaçait purement et simplement pageStats par la
    // version d'un autre onglet : tout ce qui n'était pas encore
    // écrit disparaissait, et la sauvegarde suivante réécrivait la
    // version du voisin par-dessus. À deux onglets qui lisent
    // chacun un live, avec un tick de 5 s et un flush à 2 s, c'est
    // une bonne part du temps de visionnage qui n'arrivait jamais
    // dans le total.
    //
    // On garde donc une PHOTO de ce que CET onglet a écrit en
    // dernier (statsBaseline). C'est la chaîne déjà sérialisée par
    // saveStatsNow : elle ne coûte rien de plus. Fusionner devient
    // alors une opération à trois :
    //
    //     résultat = ce qu'il y a dans le stockage
    //              + ( pageStats - statsBaseline )
    //
    // c'est-à-dire « la version des autres, plus ce que j'ai fait
    // depuis ma dernière écriture ». Aucun site d'incrément n'a
    // besoin d'être touché : le delta se calcule sur l'objet.

    var statsBaseline = null;

    // Les tableaux ne se concatènent JAMAIS : on les fusionne par
    // identité, exactement comme mergeStatsFrom le fait pour un
    // import. Les plafonds sont lus au moment de la fusion (par une
    // fonction, donc) : plusieurs sont déclarés plus bas dans le
    // fichier.
    var STATS_ARRAY_RULES = {

        logs: {
            key: function (e) { return e.t + '|' + e.msg; },
            time: function (e) { return e.t; },
            order: 'desc',
            max: function () { return STATS_MAX_LOGS; }
        },

        messages: {
            key: function (e) { return e.t + '|' + e.text; },
            time: function (e) { return e.t; },
            order: 'asc',
            max: function () { return CHAT_HISTORY_MAX_PER_STREAMER; }
        },

        sessions: {
            key: function (e) { return String(e.start); },
            time: function (e) { return e.start; },
            order: 'asc',
            max: function () { return SESSIONS_MAX; },

            // Une session est PROLONGÉE en place (last.end, last.ms) :
            // deux onglets qui regardent en même temps touchent donc
            // la même entrée. On garde la plus longue plutôt que
            // d'additionner deux durées qui se recouvrent.
            pick: function (a, b) {
                return (b.end || 0) > (a.end || 0) ? b : a;
            }
        },

        directPlaybacks: {
            key: function (e) { return e.t + '|' + e.channel; },
            time: function (e) { return e.t; },
            order: 'asc',
            max: function () { return DIRECT_PLAYBACKS_MAX; }
        },

        proxyHistory: {
            key: function (e) { return String(e.t); },
            time: function (e) { return e.t; },
            order: 'asc'
        },

        proxyLiveLatency: {
            key: function (e) { return String(e.t); },
            time: function (e) { return e.t; },
            order: 'asc'
        }

    };

    // Ces nombres-là sont des INSTANTS, pas des compteurs : leur
    // appliquer un delta n'aurait aucun sens.
    var STATS_INSTANT_FIELDS = {
        firstSeen: 'min',
        lastSeen: 'max'
    };

    function isPlainStatsObject(value) {

        return !!value &&
            typeof value === 'object' &&
            !Array.isArray(value);

    }

    function mergeStatsArray(theirs, mine, base, rule) {

        // Tableau sans règle connue : on ne sait pas dédupliquer,
        // le stockage fait foi.
        if (!rule) {
            return theirs;
        }

        var kept = {};
        var order = [];

        function put(entry) {

            if (!entry || typeof entry !== 'object') {
                return;
            }

            var k = rule.key(entry);

            if (Object.prototype.hasOwnProperty.call(kept, k)) {

                if (rule.pick) {
                    kept[k] = rule.pick(kept[k], entry);
                }

                return;

            }

            kept[k] = entry;
            order.push(k);

        }

        theirs.forEach(put);

        var inBase = {};

        (base || []).forEach(function (entry) {

            if (entry && typeof entry === 'object') {
                inBase[rule.key(entry)] = true;
            }

        });

        mine.forEach(function (entry) {

            if (!entry || typeof entry !== 'object') {
                return;
            }

            var k = rule.key(entry);

            // Déjà dans la photo mais absente du stockage : un autre
            // onglet l'a fait expirer (plafond, purge 7 jours). On ne
            // la ressuscite pas.
            if (
                Object.prototype.hasOwnProperty.call(inBase, k) &&
                !Object.prototype.hasOwnProperty.call(kept, k)
            ) {
                return;
            }

            put(entry);

        });

        var merged = order.map(function (k) {
            return kept[k];
        });

        if (rule.time) {

            merged.sort(function (a, b) {

                var d = (rule.time(a) || 0) - (rule.time(b) || 0);

                return rule.order === 'desc' ? -d : d;

            });

        }

        var cap = rule.max ? rule.max() : 0;

        if (cap && merged.length > cap) {

            merged = rule.order === 'desc'
                ? merged.slice(0, cap)
                : merged.slice(merged.length - cap);

        }

        return merged;

    }

    function mergeStatsValue(theirs, mine, base, fieldName, rule) {

        if (Array.isArray(mine)) {

            return mergeStatsArray(
                Array.isArray(theirs) ? theirs : [],
                mine,
                Array.isArray(base) ? base : [],
                rule
            );

        }

        if (isPlainStatsObject(mine)) {

            var out = {};

            var theirObj = isPlainStatsObject(theirs) ? theirs : {};
            var baseObj = isPlainStatsObject(base) ? base : {};

            Object.keys(theirObj).forEach(function (key) {

                // Clé présente dans la photo ET dans le stockage, mais
                // plus chez nous : c'est une suppression faite ICI
                // (fiche streamer effacée, nettoyage des fantômes). On
                // la respecte au lieu de la faire réapparaître.
                if (
                    Object.prototype.hasOwnProperty.call(baseObj, key) &&
                    !Object.prototype.hasOwnProperty.call(mine, key)
                ) {
                    return;
                }

                out[key] = mergeStatsValue(
                    theirObj[key],
                    Object.prototype.hasOwnProperty.call(mine, key)
                        ? mine[key]
                        : theirObj[key],
                    baseObj[key],
                    key,
                    STATS_ARRAY_RULES[key] || rule
                );

            });

            Object.keys(mine).forEach(function (key) {

                if (Object.prototype.hasOwnProperty.call(out, key)) {
                    return;
                }

                out[key] = mergeStatsValue(
                    undefined,
                    mine[key],
                    baseObj[key],
                    key,
                    STATS_ARRAY_RULES[key] || rule
                );

            });

            return out;

        }

        if (typeof mine === 'number') {

            var theirNum = typeof theirs === 'number' ? theirs : 0;
            var baseNum = typeof base === 'number' ? base : 0;

            if (STATS_INSTANT_FIELDS[fieldName] === 'min') {
                return Math.min(theirNum || mine, mine);
            }

            if (STATS_INSTANT_FIELDS[fieldName] === 'max') {
                return Math.max(theirNum, mine);
            }

            var delta = mine - baseNum;

            if (!delta) {
                return theirNum;
            }

            // Le delta peut être négatif : supprimer une fiche
            // streamer retranche son temps des totaux.
            return Math.max(0, theirNum + delta);

        }

        // Chaînes, booléens, null : celui qui a changé depuis la
        // photo l'emporte, sinon c'est le stockage qui fait foi.
        if (typeof mine !== 'undefined' && mine !== base) {
            return mine;
        }

        return typeof theirs === 'undefined' ? mine : theirs;

    }

    function mergeStatsWithStored(stored) {

        var base = null;

        try {
            base = statsBaseline ? JSON.parse(statsBaseline) : null;
        } catch (e) {
            base = null;
        }

        // Remise à zéro ou import fait ailleurs : notre delta porte
        // sur des chiffres qui n'existent plus, on le jette.
        if (!base || (stored.epoch || 0) !== (base.epoch || 0)) {
            return stored;
        }

        return mergeStatsValue(stored, pageStats, base, null, null);

    }

    // Absorbe la version d'un autre onglet SANS perdre nos propres
    // incréments en attente.
    function adoptStoredStats(stored) {

        pageStats = mergeStatsWithStored(stored);

        // La photo redevient « ce qu'il y a dans le stockage » :
        // sans ça, la prochaine sauvegarde ré-appliquerait par-dessus
        // les incréments de l'AUTRE onglet, qu'on vient d'absorber.
        try {
            statsBaseline = JSON.stringify(stored);
        } catch (e) {
            statsBaseline = null;
        }

    }

    var pageStats = loadStats();

    try {
        statsBaseline = JSON.stringify(pageStats);
    } catch (e) {
        statsBaseline = null;
    }

    logEvent('info', 'Script démarré');

    var statsSaveTimer = null;

    // Le localStorage plafonne autour de 5 Mo par origine. Une fois
    // ce plafond atteint, l'écriture lève une exception et les stats
    // cessent SILENCIEUSEMENT d'être sauvegardées : on le rend
    // visible (journal + onglet Sauvegarde) plutôt que de laisser
    // l'historique s'arrêter sans prévenir.
    var STATS_SIZE_WARN_BYTES = 3.5 * 1024 * 1024;

    var statsStorageState = { bytes: 0, full: false, warned: false };

    // `authoritative` : la version en mémoire REMPLACE le stockage
    // au lieu de s'y fondre (remise à zéro, import d'une
    // sauvegarde). Elle s'accompagne d'un epoch incrémenté, qui dit
    // aux autres onglets de jeter leur delta.
    function saveStatsNow(options) {

        // Les onglets écrivent chacun leur tour : sans ça, deux
        // relire-fusionner-réécrire simultanés se marcheraient
        // dessus exactement comme avant.
        if (navigator.locks && navigator.locks.request) {

            try {

                var pending = navigator.locks.request(
                    'tp9-stats',
                    function () {

                        saveStatsUnlocked(options);

                    }
                );

                if (pending && pending.catch) {

                    pending.catch(function () {

                        // Le verrou n'a pas pu être pris : on écrit
                        // quand même, plutôt que de perdre la
                        // sauvegarde. Rejouer est sans effet (le
                        // delta retombe à zéro une fois la photo
                        // mise à jour).
                        saveStatsUnlocked(options);

                    });

                }

                return;

            } catch (e) {}

        }

        saveStatsUnlocked(options);

    }

    function saveStatsUnlocked(options) {

        try {

            if (!(options && options.authoritative)) {

                var raw = localStorage.getItem(STATS_KEY);

                // Cas courant (personne d'autre n'a écrit depuis notre
                // dernière sauvegarde) : rien à fusionner, et surtout
                // pas de JSON.parse/stringify supplémentaire sur un
                // objet qui peut peser plusieurs Mo.
                if (raw !== statsBaseline) {

                    adoptStoredStats(loadStats());

                }

            }

            var payload = JSON.stringify(pageStats);

            statsStorageState.bytes = payload.length;

            localStorage.setItem(STATS_KEY, payload);

            // Uniquement après une écriture RÉUSSIE : sur stockage
            // saturé, la photo doit rester celle de la dernière
            // version réellement écrite, sinon le delta suivant
            // serait faux.
            statsBaseline = payload;

            if (statsStorageState.full) {

                statsStorageState.full = false;

                logEvent(
                    'success',
                    'Sauvegarde des statistiques de nouveau possible'
                );

            }

            // Averti une seule fois par session : c'est un rappel,
            // pas une alarme à répéter toutes les deux secondes.
            if (
                statsStorageState.bytes > STATS_SIZE_WARN_BYTES &&
                !statsStorageState.warned
            ) {

                statsStorageState.warned = true;

                logEvent(
                    'warn',
                    'Les statistiques occupent ' +
                    formatBytes(statsStorageState.bytes) +
                    ' de stockage local : pense à les sauvegarder sur disque'
                );

            }

        } catch (e) {

            // logEvent() replanifie une sauvegarde : sans ce garde,
            // un stockage plein tournerait en boucle d'échecs.
            if (!statsStorageState.full) {

                statsStorageState.full = true;

                logEvent(
                    'error',
                    'Stockage local saturé : les statistiques ne sont plus sauvegardées'
                );

            }

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

        adoptStoredStats(loadStats());

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

        // `r` (round) n'est posé qu'APRÈS coup, quand on sait si la
        // salve de tests était concluante — voir applyQuarantineRules.
        var entry = {
            t: Date.now(),
            ok: !!ok,
            latency: typeof latency === 'number' ? latency : null
        };

        history.push(entry);

        var cutoff = Date.now() - STATS_HISTORY_MS;

        while (history.length && history[0].t < cutoff) {
            history.shift();
        }

        pageStats.totals.testsCount++;

        scheduleStatsSave();

        return entry;

    }


    // ============================================================
    // QUARANTAINE DES RELAIS MORTS
    // ============================================================
    //
    // Un relais qui ne répond plus JAMAIS est retiré de la course en
    // direct pour ne pas la ralentir, mais il n'est jamais supprimé
    // ni décoché : `quarantine` est un champ à part, la case à cocher
    // de l'utilisateur reste la sienne.
    //
    // Règle centrale, et c'est tout l'intérêt : un échec ne compte
    // contre un relais QUE si un autre relais a réussi dans la même
    // salve de tests. Sinon, une chaîne hors ligne ou une coupure
    // réseau ferait échouer tout le monde et mettrait toute la liste
    // en quarantaine d'un coup.

    var QUARANTINE_MIN_TESTS = 15;
    var QUARANTINE_PROBE_INTERVAL_MS = 60 * 60 * 1000; // 1 heure
    var QUARANTINE_PROTECT_MS = 24 * 60 * 60 * 1000;   // 24 heures

    function isQuarantined(proxy) {

        return !!proxy.quarantine;

    }

    // Relais réellement utilisables pour la lecture (ceux que le
    // Worker met en concurrence).
    function getRaceableProxies() {

        return pageConfig.proxies.filter(function (proxy) {
            return proxy.enabled && !isQuarantined(proxy);
        });

    }

    function releaseFromQuarantine(proxy, manual) {

        if (!proxy.quarantine) {
            return;
        }

        proxy.quarantine = null;

        if (manual) {

            // L'utilisateur l'a rouvert lui-même : on ne le remet pas
            // en quarantaine dans la foulée, même s'il rate encore
            // quelques salves.
            proxy.quarantineProtectedUntil =
                Date.now() + QUARANTINE_PROTECT_MS;

        }

        logEvent(
            'success',
            'Proxy ' + proxy.name +
            (manual
                ? ' sorti de quarantaine manuellement'
                : ' de nouveau fonctionnel, sorti de quarantaine')
        );

    }

    function quarantineProxy(proxy, testCount) {

        proxy.quarantine = {
            since: Date.now(),
            lastProbe: Date.now(),
            tests: testCount
        };

        logEvent(
            'warn',
            'Proxy ' + proxy.name + ' mis en quarantaine (' +
            testCount + ' échecs consécutifs sur 7 jours)'
        );

    }

    // Un relais en quarantaine reste testé, mais au compte-gouttes.
    function isQuarantineProbeDue(proxy) {

        if (!proxy.quarantine) {
            return false;
        }

        var lastProbe = proxy.quarantine.lastProbe || 0;

        return (Date.now() - lastProbe) >= QUARANTINE_PROBE_INTERVAL_MS;

    }

    // roundResults : [{ proxy, ok, entry }] pour UNE salve de tests.
    function applyQuarantineRules(roundResults) {

        if (!roundResults.length) {
            return;
        }

        var anySuccess = roundResults.some(function (result) {
            return result.ok;
        });

        // Salve non concluante (chaîne hors ligne, coupure réseau,
        // ...) : elle ne prouve rien sur l'état des relais, on ne
        // juge personne.
        if (!anySuccess) {
            return;
        }

        roundResults.forEach(function (result) {

            if (result.entry) {
                result.entry.r = 1;
            }

        });

        roundResults.forEach(function (result) {

            if (result.ok) {

                releaseFromQuarantine(result.proxy, false);

                return;

            }

            evaluateQuarantine(result.proxy);

        });

        scheduleStatsSave();

    }

    function evaluateQuarantine(proxy) {

        if (isQuarantined(proxy)) {
            return;
        }

        if (
            proxy.quarantineProtectedUntil &&
            Date.now() < proxy.quarantineProtectedUntil
        ) {
            return;
        }

        var cutoff = Date.now() - STATS_HISTORY_MS;

        var judged = (pageStats.proxyHistory[proxy.id] || []).filter(
            function (entry) {
                return entry.t >= cutoff && entry.r === 1;
            }
        );

        if (judged.length < QUARANTINE_MIN_TESTS) {
            return;
        }

        var hasSuccess = judged.some(function (entry) {
            return entry.ok;
        });

        if (hasSuccess) {
            return;
        }

        // Jamais le dernier relais debout : mieux vaut un relais
        // douteux que plus aucun relais du tout.
        if (getRaceableProxies().length <= 1) {
            return;
        }

        quarantineProxy(proxy, judged.length);

    }

    // Un relais rapide mais qui ne répond qu'une fois sur trois ne
    // vaut pas mieux qu'un relais un peu plus lent mais toujours là.
    // Le score combine donc les deux : à 100 % de réussite et
    // 300 ms il vaut 100, et il tombe de moitié vers 1,5 s.
    function computeProxyScore(successRate, avgLatency) {

        if (successRate === null || avgLatency === null) {
            return null;
        }

        var latencyFactor =
            1 / (1 + Math.max(0, avgLatency - 300) / 1200);

        return Math.round(successRate * latencyFactor);

    }

    // Classement des meilleurs relais sur les 7 derniers jours,
    // trié par score (voir computeProxyScore) et non par latence
    // brute.
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

                // Latence subie pendant la vraie lecture, remontée
                // par le Worker quand ce proxy gagne la course. Elle
                // ne dit pas la même chose que la latence de test :
                // l'une est provoquée sur une chaîne à un instant T,
                // l'autre est ce que le flux a réellement coûté.
                liveLatency: getLiveLatencyAverage(proxy.id),

                // Les 20 derniers tests réussis, dans l'ordre, pour
                // la micro-courbe du tableau : une moyenne sur 7
                // jours noie une dégradation progressive.
                latencySeries: recentOk
                    .slice(-20)
                    .map(function (entry) {
                        return entry.latency;
                    }),

                testCount: recentAll.length,
                successRate: successRate,
                usage: pageStats.proxyUsage[proxy.id] || 0,
                bandwidth: pageStats.bandwidthByProxy[proxy.id] || 0,
                quarantined: !!proxy.quarantine,

                // Même code couleur et même pictogramme que dans le
                // menu : d'une surface à l'autre, un relais EU reste
                // bleu et gardé son drapeau.
                accent: getProxyAccent(proxy),
                icon: getProxyIcon(proxy),

                // Pays d'hébergement + CDN Twitch, en infobulle sur
                // la pastille (voir getProxyTipAttrs).
                tip: getProxyTipAttrs(proxy),

                score: computeProxyScore(successRate, avgLatency)
            };

        }).sort(function (a, b) {

            // Les relais jamais testés restent en fin de liste.
            if (a.score === null && b.score === null) return 0;
            if (a.score === null) return 1;
            if (b.score === null) return -1;

            return b.score - a.score;

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
    // BASCULES EN LECTURE DIRECTE
    // ------------------------------------------------------------
    //
    // Le toast, lui, est volontairement limité à un par quart d'heure
    // et par chaîne (DIRECT_TOAST_COOLDOWN_MS) : c'est une alerte, la
    // répéter serait pénible. Le COMPTAGE, lui, ne suit pas ce
    // cooldown — il compterait faux. Il a sa propre fenêtre, bien
    // plus courte : un seul échec provoque souvent plusieurs fetchs
    // du manifest d'affilée (changement de qualité, reprise après
    // coupure), et ce sont ces rafales qu'on regroupe, pas deux
    // vraies bascules successives.

    var DIRECT_PLAYBACK_DEDUPE_MS = 60 * 1000;
    var DIRECT_PLAYBACKS_MAX = 500;

    function recordDirectPlayback(channel, tried) {

        var now = Date.now();

        var list = pageStats.directPlaybacks;

        var last = list[list.length - 1];

        // Même chaîne, il y a moins d'une minute : c'est la même
        // bascule qui se répète, pas une nouvelle.
        if (
            last &&
            last.channel === channel &&
            (now - last.t) < DIRECT_PLAYBACK_DEDUPE_MS
        ) {

            last.t = now;

            last.repeats = (last.repeats || 0) + 1;

            scheduleStatsSave();

            return;

        }

        list.push({
            t: now,
            channel: channel,
            tried: typeof tried === 'number' ? tried : null
        });

        if (list.length > DIRECT_PLAYBACKS_MAX) {
            list.shift();
        }

        scheduleStatsSave();

    }

    function getDirectPlaybacks7d() {

        var cutoff = Date.now() - STATS_HISTORY_MS;

        return pageStats.directPlaybacks.filter(function (entry) {
            return entry && entry.t >= cutoff;
        });

    }

    // ------------------------------------------------------------
    // LATENCE RÉELLE DU FLUX (mesurée pendant la lecture)
    // ------------------------------------------------------------

    function recordLiveLatency(proxyId, latency) {

        if (!proxyId || typeof latency !== 'number' || latency < 0) {
            return;
        }

        if (!pageStats.proxyLiveLatency[proxyId]) {
            pageStats.proxyLiveLatency[proxyId] = [];
        }

        var samples = pageStats.proxyLiveLatency[proxyId];

        samples.push({ t: Date.now(), ms: Math.round(latency) });

        // Même fenêtre que proxyHistory : les deux latences
        // affichées côte à côte doivent couvrir la même période,
        // sinon les comparer n'a aucun sens.
        var cutoff = Date.now() - STATS_HISTORY_MS;

        while (samples.length && samples[0].t < cutoff) {
            samples.shift();
        }

        scheduleStatsSave();

    }

    function getLiveLatencyAverage(proxyId) {

        var cutoff = Date.now() - STATS_HISTORY_MS;

        var samples = (pageStats.proxyLiveLatency[proxyId] || []).filter(
            function (entry) {
                return entry.t >= cutoff;
            }
        );

        if (!samples.length) {
            return null;
        }

        var sum = samples.reduce(function (acc, entry) {
            return acc + entry.ms;
        }, 0);

        return Math.round(sum / samples.length);

    }

    // ------------------------------------------------------------
    // DÉBIT INSTANTANÉ
    // ------------------------------------------------------------
    //
    // Le Worker remonte les octets par paquets de 5 s : le débit est
    // donc quasi gratuit à en déduire. Lissé sur les trois derniers
    // paquets, sinon la valeur sautille d'un affichage à l'autre (un
    // segment vidéo n'arrive pas à intervalle régulier).

    var THROUGHPUT_MAX_AGE_MS = 20000;

    // Poids du dernier échantillon dans la moyenne glissante : un
    // segment vidéo n'arrive pas à intervalle régulier, une valeur
    // brute sautillerait d'un affichage à l'autre.
    var THROUGHPUT_SMOOTHING = 0.5;

    // Un débit PAR ONGLET émetteur, pas un seul global. L'onglet
    // dashboard n'a aucune vidéo à lui : son unique source, ce sont
    // les messages des autres onglets. Il additionne donc ce que
    // chacun télécharge, tandis que la carte de lecture du menu ne
    // montre que le débit de SON onglet.
    var throughputByTab = {};

    function recordThroughputSample(tabId, bytes) {

        if (!tabId) {
            return;
        }

        var now = Date.now();

        var previous = throughputByTab[tabId];

        var elapsedMs = previous ? (now - previous.at) : 0;

        // Premier paquet de cet onglet, ou reprise après une longue
        // pause : aucune durée de référence, on note juste l'instant.
        if (elapsedMs <= 0 || elapsedMs > THROUGHPUT_MAX_AGE_MS) {

            throughputByTab[tabId] = { at: now, bps: null };

            return;

        }

        var instant = bytes / (elapsedMs / 1000);

        throughputByTab[tabId] = {
            at: now,
            bps:
                previous.bps === null
                    ? instant
                    : previous.bps +
                        (instant - previous.bps) * THROUGHPUT_SMOOTHING
        };

    }

    function throughputForTab(tabId) {

        var sample = throughputByTab[tabId];

        if (
            !sample ||
            sample.bps === null ||
            (Date.now() - sample.at) > THROUGHPUT_MAX_AGE_MS
        ) {
            return null;
        }

        return sample.bps;

    }

    // Débit de CET onglet : carte de lecture du menu.
    function getLiveThroughputBps() {

        return throughputForTab(TAB_ID);

    }

    // Débit de tous les onglets qui lisent : carte du dashboard.
    // Les onglets fermés cessent d'émettre, leur entrée périme
    // toute seule — on la retire au passage.
    function getTotalLiveThroughputBps() {

        var total = null;

        Object.keys(throughputByTab).forEach(function (tabId) {

            var bps = throughputForTab(tabId);

            if (bps === null) {

                if (
                    (Date.now() - throughputByTab[tabId].at) >
                    THROUGHPUT_MAX_AGE_MS
                ) {
                    delete throughputByTab[tabId];
                }

                return;

            }

            total = (total || 0) + bps;

        });

        return total;

    }

    function formatThroughput(bytesPerSecond) {

        if (!bytesPerSecond || bytesPerSecond <= 0) {
            return null;
        }

        var mbps = bytesPerSecond / (1024 * 1024);

        if (mbps < 0.1) {
            return Math.round(bytesPerSecond / 1024) + ' Ko/s';
        }

        return mbps.toFixed(1) + ' Mo/s';

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

    // ------------------------------------------------------------
    // HISTORIQUE JOURNALIER DU TEMPS DE VISIONNAGE (graphique)
    // ------------------------------------------------------------

    function pad2(n) {
        return n < 10 ? '0' + n : String(n);
    }

    function dateKeyFor(date) {
        return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    }

    // Clé par HEURE (contrairement à dateKeyFor qui regroupe par
    // jour) : sert uniquement au filtre "24h" du graphique, qui a
    // besoin d'un point par heure plutôt qu'un seul total par jour.
    function hourKeyFor(date) {
        return dateKeyFor(date) + '-' + pad2(date.getHours());
    }

    var DAILY_WATCH_HISTORY_DAYS = 370;

    // Fenêtre glissante de 24h + marge : 48h suffisent, pas besoin
    // de garder plus de granularité horaire que ça.
    var HOURLY_WATCH_HISTORY_HOURS = 48;

    // Les clés "YYYY-MM-DD-HH" se comparent aussi lexicographiquement
    // comme des dates (même principe que pruneDailyMap).
    function pruneHourlyMap(map) {

        var cutoff = new Date();

        cutoff.setHours(cutoff.getHours() - HOURLY_WATCH_HISTORY_HOURS);

        var cutoffKey = hourKeyFor(cutoff);

        Object.keys(map).forEach(function (key) {

            if (key < cutoffKey) {
                delete map[key];
            }

        });

    }

    // Les clés "YYYY-MM-DD" se comparent lexicographiquement comme
    // des dates, pas besoin de les reparser pour trouver les vieilles
    // entrées à purger.
    function pruneDailyMap(map) {

        var cutoff = new Date();

        cutoff.setDate(cutoff.getDate() - DAILY_WATCH_HISTORY_DAYS);

        var cutoffKey = dateKeyFor(cutoff);

        Object.keys(map).forEach(function (key) {

            if (key < cutoffKey) {
                delete map[key];
            }

        });

    }

    // ------------------------------------------------------------
    // BANDE PASSANTE : 3 sources, de la plus fiable à la moins
    // ------------------------------------------------------------
    //
    // 1. 'network'  : taille réelle de chaque segment vidéo, mesurée
    //                 dans le Worker HLS déjà patché (voir makePatch)
    //                 et remontée ici par BroadcastChannel. Exact,
    //                 et fonctionne sur tous les navigateurs.
    //
    // 2. 'decoder'  : compteurs d'octets décodés du lecteur
    //                 (webkitVideoDecodedByteCount) — exact aussi,
    //                 mais propriété non standard : Chrome/Edge
    //                 uniquement, absente de Firefox.
    //
    // 3. 'estimate' : l'ancienne méthode (table bitrate ↔ résolution),
    //                 gardée en dernier recours si aucune des deux
    //                 autres n'est disponible.

    // Date du dernier paquet d'octets reçu du Worker. Au-delà de ce
    // délai sans rien recevoir alors que la vidéo tourne, on
    // considère que le comptage réseau n'aboutit pas (Twitch peut
    // très bien charger ses segments ailleurs que dans le Worker
    // qu'on patche) et on bascule sur les sources de repli.
    var lastNetworkBytesAt = 0;
    var NETWORK_BYTES_MAX_AGE_MS = 20000;

    function isNetworkBandwidthLive() {

        return (Date.now() - lastNetworkBytesAt) < NETWORK_BYTES_MAX_AGE_MS;

    }

    // Point d'entrée unique des trois sources : c'est le seul
    // endroit qui écrit les octets dans les stats.
    //
    // `options.viaProxy === false` : octets qui ne sont pas passés
    // par la course des relais (le VOD que le Player Custom lit
    // lui-même). Ils comptent dans les totaux, mais pas au crédit
    // du proxy actif, qui n'y est pour rien.
    function recordBandwidthBytes(channel, bytes, source, options) {

        if (!channel || !bytes || bytes <= 0) {
            return;
        }

        bytes = Math.round(bytes);

        var streamer = getStreamerStats(channel);

        streamer.bandwidthBytes += bytes;
        streamer.lastSeen = Date.now();

        pageStats.totals.bandwidthBytesGlobal += bytes;

        if (source) {
            pageStats.bandwidthSource = source;
        }

        if (
            !(options && options.viaProxy === false) &&
            activeProxyInfo &&
            !activeProxyInfo.direct &&
            activeProxyInfo.channel === channel &&
            activeProxyInfo.proxyId
        ) {

            pageStats.bandwidthByProxy[activeProxyInfo.proxyId] =
                (pageStats.bandwidthByProxy[activeProxyInfo.proxyId] || 0) + bytes;

        }

        // Historique daté, pour le graphique : mêmes clés que le
        // temps de visionnage (un total par jour, un par heure).
        var bwNow = new Date();

        var bwDayKey = dateKeyFor(bwNow);

        pageStats.dailyBandwidth[bwDayKey] =
            (pageStats.dailyBandwidth[bwDayKey] || 0) + bytes;

        pruneDailyMap(pageStats.dailyBandwidth);

        var bwHourKey = hourKeyFor(bwNow);

        pageStats.hourlyBandwidth[bwHourKey] =
            (pageStats.hourlyBandwidth[bwHourKey] || 0) + bytes;

        pruneHourlyMap(pageStats.hourlyBandwidth);

        scheduleStatsSave();

    }

    // Compteurs d'octets décodés (Chrome/Edge). On ne garde que le
    // delta entre deux ticks ; un compteur qui repart en arrière
    // signifie qu'on a changé de flux, on repart alors de zéro.
    var decoderByteSample = { video: null, total: 0 };

    function readDecoderBytesDelta(video) {

        if (typeof video.webkitVideoDecodedByteCount !== 'number') {
            return null;
        }

        var total =
            (video.webkitVideoDecodedByteCount || 0) +
            (video.webkitAudioDecodedByteCount || 0);

        if (
            decoderByteSample.video !== video ||
            total < decoderByteSample.total
        ) {

            decoderByteSample = { video: video, total: total };

            return 0;

        }

        var delta = total - decoderByteSample.total;

        decoderByteSample.total = total;

        return delta;

    }

    // ------------------------------------------------------------
    // TEMPS DE VISIONNAGE : progression réelle de la lecture
    // ------------------------------------------------------------
    //
    // On mesure le delta de video.currentTime plutôt que d'ajouter
    // bêtement la durée du tick : c'est le temps RÉELLEMENT lu, donc
    // insensible au ralentissement des timers par le navigateur, et
    // le buffering/les coupures ne sont plus comptés comme du
    // visionnage. Les sauts (retour arrière dans le DVR, saut au
    // direct) sont ignorés ou plafonnés.

    function emptyTimeSample() {

        return {
            channel: null,
            video: null,
            currentTime: null,
            at: 0
        };

    }

    // Ce qu'on REGARDE. Le Player Custom ouvert dans le passé,
    // c'est sa vidéo à lui qui est à l'écran — pas celle de
    // Twitch, qui continue en muet derrière pour remplir la
    // mémoire.
    var watchTimeSample = emptyTimeSample();

    // Le même relevé, tenu à part, sur la vidéo de TWITCH : c'est
    // elle qui télécharge. Sans ce second repère, la bande
    // passante estimée se calait sur le temps de visionnage, et
    // une pause dans le passé cessait de compter des octets qui
    // arrivaient pourtant.
    var bandwidthTimeSample = emptyTimeSample();

    // Marge tolérée au-dessus du temps réellement écoulé entre deux
    // ticks, pour absorber les petites imprécisions de mesure.
    var WATCH_DELTA_MAX_RATIO = 1.5;

    // Le cœur des deux relevés : combien de temps de flux a défilé
    // entre les deux photos, plafonné par l'horloge réelle.
    function sampleAdvance(previous, sample) {

        // Autre élément <video> que la fois précédente (Player
        // Custom qui passe du direct au passé, lecteur Twitch
        // remplacé par une pub) : deux horloges sans rapport,
        // leur écart ne mesure rien.
        if (
            previous.channel !== sample.channel ||
            previous.video !== sample.video ||
            typeof previous.currentTime !== 'number' ||
            typeof sample.currentTime !== 'number'
        ) {
            return 0;
        }

        var deltaMs =
            (sample.currentTime - previous.currentTime) * 1000;

        // Retour arrière (seek) : rien à compter pour ce tick.
        if (deltaMs <= 0) {
            return 0;
        }

        // Saut en avant : on ne peut pas avoir lu plus que le temps
        // écoulé depuis le tick précédent. Ce plafond se cale sur
        // l'horloge RÉELLE et non sur BANDWIDTH_TICK_MS : le
        // navigateur étire les minuteurs des onglets en
        // arrière-plan, et un plafond figé à 7,5 s y sous-comptait
        // le visionnage alors que la lecture, elle, avait bien
        // avancé pendant tout l'intervalle.
        var elapsedMs = previous.at
            ? (sample.at - previous.at)
            : BANDWIDTH_TICK_MS;

        return Math.min(
            deltaMs,
            Math.max(elapsedMs, BANDWIDTH_TICK_MS) * WATCH_DELTA_MAX_RATIO
        );

    }

    function readWatchedMs(video, channel) {

        var previous = watchTimeSample;

        watchTimeSample = {
            channel: channel,
            video: video,
            currentTime: video.currentTime,
            at: Date.now()
        };

        return sampleAdvance(previous, watchTimeSample);

    }

    // Ce que la vidéo de Twitch a téléchargé, elle, depuis le tick
    // précédent : la source « estimate » s'en sert pour convertir
    // du temps de flux en octets.
    function readDownloadedMs(video, channel) {

        var previous = bandwidthTimeSample;

        bandwidthTimeSample = {
            channel: channel,
            video: video,
            currentTime: video.currentTime,
            at: Date.now()
        };

        return sampleAdvance(previous, bandwidthTimeSample);

    }

    // ------------------------------------------------------------
    // SESSIONS DE VISIONNAGE
    // ------------------------------------------------------------
    //
    // Une session = un bloc de visionnage continu. Deux ticks
    // séparés de moins de SESSION_GAP_MS appartiennent à la même
    // session ; au-delà (pause, changement d'activité, nuit), une
    // nouvelle commence. Peu importe le streamer : enchaîner deux
    // chaînes sans s'arrêter reste une seule session.

    var SESSION_GAP_MS = 10 * 60 * 1000;
    var SESSIONS_MAX = 500;

    function recordSessionProgress(watchedMs) {

        var now = Date.now();

        var sessions = pageStats.sessions;

        var last = sessions[sessions.length - 1];

        if (last && (now - last.end) <= SESSION_GAP_MS) {

            last.end = now;
            last.ms += watchedMs;

            return;

        }

        sessions.push({
            start: now - watchedMs,
            end: now,
            ms: watchedMs
        });

        if (sessions.length > SESSIONS_MAX) {
            sessions.shift();
        }

    }

    // ------------------------------------------------------------
    // CE QUI COMPTE VRAIMENT COMME DU VISIONNAGE
    // ------------------------------------------------------------
    //
    // Une page Twitch peut lire une vidéo sans que tu regardes quoi
    // que ce soit : aperçu automatique du stream en vedette sur
    // l'accueil, carte survolée dans Parcourir, bande-annonce d'une
    // chaîne hors ligne... Tout ça passe par le même <video> et par
    // le même Worker HLS patché. Sans filtre, ces flux gonflent le
    // temps de visionnage ET la bande passante, et créent même des
    // fiches streamer pour des chaînes jamais regardées.
    //
    // On ne crédite donc que deux surfaces :
    //
    //   - le lecteur principal, sur la page d'une chaîne (plein
    //     écran, theatre mode ou fenêtré, peu importe) ;
    //   - le mini-player flottant, qui est bien une lecture que TU
    //     as lancée et qui continue pendant que tu navigues ailleurs
    //     sur le site.
    //
    // Rien ici ne dépend du focus ni de la visibilité de l'onglet :
    // un onglet en arrière-plan continue de compter normalement.

    // Chaîne réellement jouée par le lecteur de CET onglet, remontée
    // par le Worker HLS. C'est la seule source qui connaisse la
    // chaîne du mini-player, puisqu'elle n'est plus dans l'URL une
    // fois qu'on a navigué ailleurs.
    var playerChannel = null;
    var playerChannelAt = 0;

    var PLAYER_CHANNEL_MAX_AGE_MS = 60000;

    function getLivePlayerChannel() {

        if (
            !playerChannel ||
            (Date.now() - playerChannelAt) > PLAYER_CHANNEL_MAX_AGE_MS
        ) {
            return null;
        }

        return playerChannel;

    }

    // Repli quand le Worker n'a rien remonté (segments chargés hors
    // du Worker patché) : le conteneur flottant contient un lien
    // vers la chaîne qu'il est en train de lire.
    function getFloatingPlayerChannel(video) {

        var container = getFloatingPlayerContainer(video);

        if (!container) {
            return null;
        }

        var links = container.querySelectorAll('a[href^="/"]');

        for (var i = 0; i < links.length; i++) {

            var parts = links[i]
                .getAttribute('href')
                .split('/')
                .filter(Boolean);

            if (
                parts.length === 1 &&
                NON_CHANNEL_PATHS.indexOf(parts[0].toLowerCase()) === -1
            ) {

                return parts[0].toLowerCase();

            }

        }

        return null;

    }

    // Un live n'a pas de durée connue (MSE laisse `duration` à
    // Infinity) ; une bande-annonce ou un rediff de chaîne hors
    // ligne est une VOD, donc de durée finie. Les deux signaux se
    // couvrent l'un l'autre volontairement : on n'écarte une vidéo
    // que si AUCUN des deux ne dit « live », pour ne jamais risquer
    // d'arrêter de compter un vrai stream si Twitch changeait la
    // façon dont il renseigne `duration`.
    function isLivePlayback(video) {

        if (!isFinite(video.duration)) {
            return true;
        }

        return isNetworkBandwidthLive();

    }

    // Un lecteur flottant ouvert a la priorité : sur l'accueil par
    // exemple, l'aperçu en vedette apparaît avant lui dans le DOM et
    // serait sinon choisi à sa place.
    // La <video> du lecteur perso ne compte JAMAIS comme une
    // lecture Twitch. En mode direct elle est en display:none
    // (rect 0 x 0) sous un habillage en position:fixed : elle
    // cochait donc les deux critères de isMiniPlayerVideo et
    // était prise pour le mini-player de Twitch. Comme elle est
    // vide et en pause, getActivePlayback() renvoyait null et plus
    // RIEN n'était comptabilisé tant que le lecteur perso restait
    // ouvert — ni le temps de visionnage, ni la bande passante
    // (créditée seulement si le channel remonté par le Worker
    // correspond à getWatchedChannel()).
    //
    // Ça réglait aussi dvrSyncVolumeFromPlayer : quand le lecteur
    // Twitch est remplacé (changement de qualité, pub), il rappelle
    // dvrFindLivePlayer() alors que l'habillage existe déjà, et
    // dvrLiveVideo devenait notre propre <video> vide — le volume
    // et la pause du direct ne pilotaient plus rien.
    function isOwnPlayerVideo(video) {

        try {

            return !!(video.closest && video.closest('.tp9dvr'));

        } catch (e) {

            return false;

        }

    }

    function findPlaybackVideo() {

        var videos = document.querySelectorAll('video');

        var fallback = null;

        for (var i = 0; i < videos.length; i++) {

            if (isOwnPlayerVideo(videos[i])) {
                continue;
            }

            if (isMiniPlayerVideo(videos[i])) {
                return videos[i];
            }

            if (!fallback) {
                fallback = videos[i];
            }

        }

        return fallback;

    }

    // Renvoie { video, channel } si cet onglet lit bien un live à
    // comptabiliser, sinon null.
    function getActivePlayback() {

        var video = findPlaybackVideo();

        if (
            !video ||
            video.paused ||
            video.ended ||
            video.readyState < 2
        ) {
            return null;
        }

        if (!isLivePlayback(video)) {
            return null;
        }

        var urlChannel = getTestChannel();

        // Page d'une chaîne : c'est elle qu'on crédite. Twitch
        // referme le mini-player en arrivant sur une chaîne, il n'y
        // a donc pas d'ambiguïté possible ici.
        if (urlChannel) {

            return { video: video, channel: urlChannel };

        }

        // Ailleurs (accueil, Parcourir, ...) : seul le lecteur
        // flottant compte, tout le reste est un aperçu automatique.
        if (!isMiniPlayerVideo(video)) {
            return null;
        }

        var floatingChannel =
            getLivePlayerChannel() ||
            getFloatingPlayerChannel(video);

        return floatingChannel
            ? { video: video, channel: floatingChannel }
            : null;

    }

    function getWatchedChannel() {

        var playback = getActivePlayback();

        return playback ? playback.channel : null;

    }


    // La vidéo qu'on REGARDE, qui n'est pas toujours celle qui
    // joue le direct. Player Custom ouvert dans le passé (mémoire
    // ou VOD) : c'est la sienne qui est à l'écran, et celle de
    // Twitch continue en muet derrière pour remplir la mémoire. Le
    // temps de visionnage se lisait sur celle de Twitch : une
    // pause faite dans le passé continuait donc de compter comme
    // du visionnage.
    //
    // getActivePlayback, lui, reste calé sur le lecteur Twitch :
    // c'est lui qui télécharge, et la bande passante doit suivre
    // les octets réellement reçus, pause dans le passé comprise.
    function getShownVideo(liveVideo) {

        if (dvrOverlay && dvrVideo && !dvrIsLive()) {
            return dvrVideo;
        }

        return liveVideo;

    }


    function trackBandwidthAndWatchTime() {

        var playback = getActivePlayback();

        if (!playback) {

            // Lecture interrompue, ou vidéo qui ne doit pas compter
            // (aperçu automatique, bande-annonce) : on oublie les
            // repères, sinon la reprise compterait tout le temps
            // écoulé entre les deux.
            watchTimeSample = emptyTimeSample();
            bandwidthTimeSample = emptyTimeSample();

            return;

        }

        var channel = playback.channel;
        var video = playback.video;

        // Le temps de visionnage se lit sur la vidéo À L'ÉCRAN, les
        // octets sur celle de Twitch : voir getShownVideo.
        var shownVideo = getShownVideo(video);

        var watchedMs = 0;

        if (
            shownVideo === video ||
            (
                !shownVideo.paused &&
                !shownVideo.ended &&
                shownVideo.readyState >= 2
            )
        ) {

            watchedMs = readWatchedMs(shownVideo, channel);

        } else {

            // Passé mis en pause, ou source encore en chargement :
            // rien à compter, et un repère périmé ferait compter un
            // saut à la reprise.
            watchTimeSample = emptyTimeSample();

        }

        // ---- bande passante ----

        if (isNetworkBandwidthLive()) {

            // Déjà comptabilisée à la réception (source 'network').

        } else {

            var decoderDelta = readDecoderBytesDelta(video);

            if (decoderDelta !== null) {

                recordBandwidthBytes(channel, decoderDelta, 'decoder');

            } else {

                // Sur la vidéo de TWITCH, et non sur le temps de
                // visionnage : elle télécharge même quand le passé
                // est en pause, et ces octets-là sont bien reçus.
                var downloadedMs = readDownloadedMs(video, channel);

                if (downloadedMs > 0) {

                    var kbps =
                        estimateKbpsForHeight(video.videoHeight || 0);

                    recordBandwidthBytes(
                        channel,
                        (kbps * 1000 / 8) * (downloadedMs / 1000),
                        'estimate'
                    );

                }

            }

        }

        // ---- temps de visionnage ----

        if (watchedMs <= 0) {
            return;
        }

        var streamer = getStreamerStats(channel);

        streamer.watchTimeMs += watchedMs;
        streamer.lastSeen = Date.now();

        pageStats.totals.watchTimeMsGlobal += watchedMs;

        recordSessionProgress(watchedMs);

        var now2 = new Date();

        var dayKey = dateKeyFor(now2);

        pageStats.dailyWatchTime[dayKey] =
            (pageStats.dailyWatchTime[dayKey] || 0) + watchedMs;

        pruneDailyMap(pageStats.dailyWatchTime);

        var hourKey = hourKeyFor(now2);

        pageStats.hourlyWatchTime[hourKey] =
            (pageStats.hourlyWatchTime[hourKey] || 0) + watchedMs;

        pruneHourlyMap(pageStats.hourlyWatchTime);

        var heatKey = now2.getDay() + '-' + now2.getHours();

        pageStats.watchHeatmap[heatKey] =
            (pageStats.watchHeatmap[heatKey] || 0) + watchedMs;

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


    // ------------------------------------------------------------
    // CE QUI BOUGE MAINTENANT S'AFFICHE AU DÉTAIL PRÈS
    // ------------------------------------------------------------
    //
    // Un total arrondi à la minute et aux dizaines de Mo convient
    // très bien à un historique : on le lit d'un coup d'œil et on
    // n'a que faire de la troisième décimale de six mois de
    // visionnage. Mais sur une chaîne EN COURS, c'est justement le
    // dernier chiffre qu'on regarde — celui qui prouve que la mesure
    // tourne. « 2h24 » fige pendant une minute entière, « 9,37 Go »
    // pendant plusieurs minutes.
    //
    // D'où deux formats de plus, réservés aux lignes en cours.

    function formatDurationPrecise(ms) {

        var totalSeconds = Math.max(0, Math.floor(ms / 1000));

        var hours = Math.floor(totalSeconds / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;

        if (hours > 0) {

            return hours + 'h ' +
                (minutes < 10 ? '0' : '') + minutes + 'm ' +
                (seconds < 10 ? '0' : '') + seconds + 's';

        }

        if (minutes > 0) {

            return minutes + 'm ' +
                (seconds < 10 ? '0' : '') + seconds + 's';

        }

        return seconds + 's';

    }

    function formatBytesPrecise(bytes) {

        if (!bytes) {
            return '0 Ko';
        }

        var mb = bytes / (1024 * 1024);

        // Même bascule à 1000 que formatBytes, une décimale de plus
        // à chaque palier : c'est elle qui bouge à vue d'œil.
        if (mb >= 1000) {
            return (mb / 1000).toFixed(3) + ' Go';
        }

        if (mb >= 1) {
            return mb.toFixed(2) + ' Mo';
        }

        return Math.round(bytes / 1024) + ' Ko';

    }


    // Une chaîne « en cours » est une chaîne dont les stats ont bougé
    // à l'instant. lastSeen est réécrit à chaque tick de visionnage
    // (5 s) et à chaque message tchat, et il passe par le
    // localStorage : l'onglet dashboard, qui ne lit aucune vidéo,
    // voit donc aussi bien qu'un autre ce que l'onglet d'à côté est
    // en train de regarder.
    //
    // La fenêtre couvre le pire cas : un tick de 5 s, plus les 2 s
    // de regroupement des écritures, plus un peu de marge quand le
    // navigateur étire les minuteurs d'un onglet en arrière-plan.
    var STREAMER_LIVE_WINDOW_MS = 15000;

    function isStreamerLive(channel) {

        var s = pageStats.streamers[channel];

        return !!s &&
            (Date.now() - (s.lastSeen || 0)) < STREAMER_LIVE_WINDOW_MS;

    }


    // ============================================================
    // SAUVEGARDE DES STATISTIQUES SUR LE DISQUE
    // ============================================================
    //
    // Les stats ne vivent que dans le localStorage de twitch.tv : un
    // "supprimer les données du site" et des mois d'historique
    // disparaissent. Un userscript ne peut PAS écrire sur le disque
    // en douce, donc deux modes :
    //
    // - File System Access API (Chrome/Edge) : l'utilisateur désigne
    //   un fichier UNE fois, on garde son "handle" dans IndexedDB
    //   (il n'est pas sérialisable en JSON, d'où IndexedDB et pas
    //   localStorage) et on réécrit dedans tout seul ensuite.
    //
    // - Partout ailleurs (Firefox...) : rappel dans le menu + export
    //   en un clic, qui passe par un téléchargement classique.

    var BACKUP_STATE_KEY = 'twitchProxyBackupStateV1';
    var BACKUP_DB_NAME = 'twitchProxyBackupV1';
    var BACKUP_STORE_NAME = 'handles';
    var BACKUP_HANDLE_KEY = 'statsFile';

    var AUTO_BACKUP_MIN_INTERVAL_MS = 15 * 60 * 1000;
    var AUTO_BACKUP_CHECK_MS = 5 * 60 * 1000;
    var BACKUP_REMINDER_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

    // Passe à true quand une écriture silencieuse échoue faute
    // d'autorisation (le navigateur exige alors un clic).
    var backupNeedsPermission = false;

    // Copie en mémoire du handle stocké en IndexedDB (voir plus bas
    // pourquoi l'accès doit pouvoir être synchrone).
    var backupHandleCached = null;

    function supportsFileBackup() {

        return typeof window.showSaveFilePicker === 'function';

    }

    function loadBackupState() {

        try {

            var saved = localStorage.getItem(BACKUP_STATE_KEY);

            if (saved) {
                return JSON.parse(saved) || {};
            }

        } catch (e) {}

        return {};

    }

    var backupState = loadBackupState();

    function saveBackupState() {

        try {

            localStorage.setItem(
                BACKUP_STATE_KEY,
                JSON.stringify(backupState)
            );

        } catch (e) {}

    }

    // ------------------------------------------------------------
    // IndexedDB : conservation du handle de fichier
    // ------------------------------------------------------------

    function openBackupDB() {

        return new Promise(function (resolve, reject) {

            if (!window.indexedDB) {

                reject(new Error('IndexedDB indisponible'));

                return;

            }

            var request = indexedDB.open(BACKUP_DB_NAME, 1);

            request.onupgradeneeded = function () {

                var db = request.result;

                if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) {
                    db.createObjectStore(BACKUP_STORE_NAME);
                }

            };

            request.onsuccess = function () {
                resolve(request.result);
            };

            request.onerror = function () {
                reject(request.error);
            };

        });

    }

    function withBackupStore(mode, action) {

        return openBackupDB().then(function (db) {

            return new Promise(function (resolve, reject) {

                var tx = db.transaction(BACKUP_STORE_NAME, mode);

                var request = action(tx.objectStore(BACKUP_STORE_NAME));

                request.onsuccess = function () {
                    resolve(request.result);
                };

                request.onerror = function () {
                    reject(request.error);
                };

            });

        });

    }

    function saveBackupHandle(handle) {

        backupHandleCached = handle;

        return withBackupStore('readwrite', function (store) {
            return store.put(handle, BACKUP_HANDLE_KEY);
        });

    }

    function loadBackupHandle() {

        return withBackupStore('readonly', function (store) {
            return store.get(BACKUP_HANDLE_KEY);
        }).then(function (handle) {

            backupHandleCached = handle || null;

            return backupHandleCached;

        }).catch(function () {
            return null;
        });

    }

    function clearBackupHandle() {

        backupHandleCached = null;

        return withBackupStore('readwrite', function (store) {
            return store.delete(BACKUP_HANDLE_KEY);
        }).catch(function () {});

    }

    // Charge le handle au démarrage pour que les clics suivants
    // puissent décider sans attendre.
    function primeBackupHandle() {

        if (!supportsFileBackup()) {
            return;
        }

        loadBackupHandle().then(function () {

            updateBackupUI();

        });

    }

    // ------------------------------------------------------------
    // Contenu sauvegardé
    // ------------------------------------------------------------

    function buildStatsBackupPayload() {

        return {
            app: 'twitch-hls-proxy',
            kind: 'stats',
            version: CURRENT_VERSION,
            exportedAt: Date.now(),
            stats: pageStats
        };

    }

    function markBackupDone(mode, fileName) {

        backupState.lastBackupAt = Date.now();
        backupState.lastBackupMode = mode;

        if (fileName) {
            backupState.fileName = fileName;
        }

        backupNeedsPermission = false;

        saveBackupState();

        updateBackupUI();

    }

    // Horodatage lisible pour un nom de fichier : jour-mois-année
    // (et pas le format ISO de dateKeyFor, qui sert au tri interne
    // des clés de statistiques).
    function backupStampFor(date) {

        return (
            pad2(date.getDate()) + '-' +
            pad2(date.getMonth() + 1) + '-' +
            date.getFullYear() + '_' +
            pad2(date.getHours()) + 'h' +
            pad2(date.getMinutes())
        );

    }

    // Téléchargement classique : fonctionne sur tous les navigateurs,
    // sans aucune permission, mais chaque sauvegarde crée un fichier
    // de plus dans le dossier Téléchargements.
    function downloadStatsBackup() {

        try {

            var blob = new Blob(
                [JSON.stringify(buildStatsBackupPayload(), null, 2)],
                { type: 'application/json' }
            );

            var url = URL.createObjectURL(blob);

            var link = document.createElement('a');

            var now = new Date();

            link.href = url;

            var fileName =
                'Twitch_HLS_Proxy-' +
                backupStampFor(now) +
                '.json';

            link.download = fileName;

            document.body.appendChild(link);

            link.click();

            document.body.removeChild(link);

            setTimeout(function () {
                URL.revokeObjectURL(url);
            }, 1000);

            markBackupDone('download', fileName);

            // Le téléchargement est silencieux : sans retour, on a
            // l'impression qu'il ne s'est rien passé (ou pire, on ne
            // sait pas où le fichier est parti).
            showToast({

                icon: '📥',

                title: 'Sauvegarde téléchargée',

                text:
                    fileName + ' — dans ton dossier Téléchargements. ' +
                    'Pour choisir où l\'enregistrer, active « Toujours demander où ' +
                    'enregistrer les fichiers » dans les paramètres de ton navigateur.',

                ok: true,

                duration: 9000

            });

            return true;

        } catch (e) {

            console.warn('[TwitchProxy] Export des stats impossible:', e);

            return false;

        }

    }

    async function ensureBackupPermission(handle, allowPrompt) {

        if (typeof handle.queryPermission !== 'function') {
            return true;
        }

        var status = await handle.queryPermission({ mode: 'readwrite' });

        if (status === 'granted') {
            return true;
        }

        if (!allowPrompt || typeof handle.requestPermission !== 'function') {

            backupNeedsPermission = true;

            updateBackupUI();

            return false;

        }

        status = await handle.requestPermission({ mode: 'readwrite' });

        return status === 'granted';

    }

    // silent = true : appelé par le minuteur, sans clic de
    // l'utilisateur — on n'ose alors aucune boîte de dialogue.
    async function writeStatsBackup(silent) {

        var handle = backupHandleCached || await loadBackupHandle();

        if (!handle) {
            return false;
        }

        try {

            var allowed = await ensureBackupPermission(handle, !silent);

            if (!allowed) {
                return false;
            }

            var writable = await handle.createWritable();

            await writable.write(
                JSON.stringify(buildStatsBackupPayload(), null, 2)
            );

            await writable.close();

            markBackupDone('file', handle.name);

            return true;

        } catch (e) {

            console.warn('[TwitchProxy] Sauvegarde des stats impossible:', e);

            if (!silent) {

                alert(
                    'Impossible d\'écrire dans le fichier de sauvegarde.\n\n' +
                    'Il a peut-être été déplacé ou supprimé : choisis-en un nouveau.'
                );

                await clearBackupHandle();

                updateBackupUI();

            }

            return false;

        }

    }

    // Doit être appelé depuis un vrai clic : le sélecteur de fichier
    // exige une interaction utilisateur.
    async function chooseStatsBackupFile() {

        if (!supportsFileBackup()) {

            downloadStatsBackup();

            return;

        }

        try {

            var handle = await window.showSaveFilePicker({

                suggestedName:
                    'Twitch_HLS_Proxy-' +
                    backupStampFor(new Date()) +
                    '.json',

                types: [{
                    description: 'Sauvegarde Twitch Proxy',
                    accept: { 'application/json': ['.json'] }
                }]

            });

            await saveBackupHandle(handle);

            await writeStatsBackup(false);

            logEvent('success', 'Fichier de sauvegarde des stats configuré');

        } catch (e) {

            // AbortError = l'utilisateur a simplement annulé.
            if (!e || e.name !== 'AbortError') {

                console.warn('[TwitchProxy] Choix du fichier impossible:', e);

            }

        }

    }

    // ------------------------------------------------------------
    // Restauration
    // ------------------------------------------------------------

    function maxNum(a, b) {

        return Math.max(a || 0, b || 0);

    }

    function mergeNumericMap(target, incoming) {

        Object.keys(incoming || {}).forEach(function (key) {

            target[key] = maxNum(target[key], incoming[key]);

        });

    }

    // Fusion "valeur la plus complète" : pour chaque compteur on
    // garde le plus grand des deux, jamais la somme. C'est le seul
    // comportement qui ne gonfle JAMAIS les stats si on restaure une
    // sauvegarde qui recouvre en partie ce qui est déjà là — le cas
    // normal quand on répare une perte de données.
    function mergeStatsFrom(incoming) {

        if (!incoming || typeof incoming !== 'object') {
            return false;
        }

        mergeNumericMap(pageStats.proxyUsage, incoming.proxyUsage);
        mergeNumericMap(pageStats.bandwidthByProxy, incoming.bandwidthByProxy);
        mergeNumericMap(pageStats.dailyWatchTime, incoming.dailyWatchTime);
        mergeNumericMap(pageStats.hourlyWatchTime, incoming.hourlyWatchTime);
        mergeNumericMap(pageStats.dailyBandwidth, incoming.dailyBandwidth);
        mergeNumericMap(pageStats.hourlyBandwidth, incoming.hourlyBandwidth);
        mergeNumericMap(pageStats.watchHeatmap, incoming.watchHeatmap);

        Object.keys(incoming.totals || {}).forEach(function (key) {

            pageStats.totals[key] = maxNum(
                pageStats.totals[key],
                incoming.totals[key]
            );

        });

        // Historique des tests : union dédupliquée sur l'horodatage.
        Object.keys(incoming.proxyHistory || {}).forEach(function (id) {

            var current = pageStats.proxyHistory[id] || [];

            var seen = {};

            current.forEach(function (entry) {
                seen[entry.t] = true;
            });

            (incoming.proxyHistory[id] || []).forEach(function (entry) {

                if (!seen[entry.t]) {

                    seen[entry.t] = true;

                    current.push(entry);

                }

            });

            current.sort(function (a, b) {
                return a.t - b.t;
            });

            var cutoff = Date.now() - STATS_HISTORY_MS;

            pageStats.proxyHistory[id] = current.filter(function (entry) {
                return entry.t >= cutoff;
            });

        });

        Object.keys(incoming.streamers || {}).forEach(function (channel) {

            var source = incoming.streamers[channel];

            if (!source) {
                return;
            }

            var target = getStreamerStats(channel);

            target.watchTimeMs = maxNum(target.watchTimeMs, source.watchTimeMs);
            target.chatMessages = maxNum(target.chatMessages, source.chatMessages);
            target.bandwidthBytes = maxNum(target.bandwidthBytes, source.bandwidthBytes);

            mergeNumericMap(target.proxyUsage, source.proxyUsage);

            target.firstSeen = Math.min(
                target.firstSeen || source.firstSeen || Date.now(),
                source.firstSeen || target.firstSeen || Date.now()
            );

            target.lastSeen = maxNum(target.lastSeen, source.lastSeen);

            // Messages : union sur (horodatage + texte), le même
            // message envoyé deux fois à deux moments différents
            // reste donc bien compté deux fois.
            var messages = Array.isArray(target.messages) ? target.messages : [];

            var seenMessages = {};

            messages.forEach(function (message) {
                seenMessages[message.t + '|' + message.text] = true;
            });

            (source.messages || []).forEach(function (message) {

                var key = message.t + '|' + message.text;

                if (!seenMessages[key]) {

                    seenMessages[key] = true;

                    messages.push(message);

                }

            });

            messages.sort(function (a, b) {
                return a.t - b.t;
            });

            if (messages.length > CHAT_HISTORY_MAX_PER_STREAMER) {

                messages = messages.slice(
                    messages.length - CHAT_HISTORY_MAX_PER_STREAMER
                );

            }

            target.messages = messages;

        });

        // Logs : union, les plus récents d'abord.
        var logSeen = {};

        pageStats.logs.forEach(function (entry) {
            logSeen[entry.t + '|' + entry.msg] = true;
        });

        (incoming.logs || []).forEach(function (entry) {

            var key = entry.t + '|' + entry.msg;

            if (!logSeen[key]) {

                logSeen[key] = true;

                pageStats.logs.push(entry);

            }

        });

        pageStats.logs.sort(function (a, b) {
            return b.t - a.t;
        });

        if (pageStats.logs.length > STATS_MAX_LOGS) {
            pageStats.logs.length = STATS_MAX_LOGS;
        }

        // Sessions : union dédupliquée sur l'horodatage de début.
        var sessionSeen = {};

        pageStats.sessions.forEach(function (session) {
            sessionSeen[session.start] = true;
        });

        (incoming.sessions || []).forEach(function (session) {

            if (session && !sessionSeen[session.start]) {

                sessionSeen[session.start] = true;

                pageStats.sessions.push(session);

            }

        });

        pageStats.sessions.sort(function (a, b) {
            return a.start - b.start;
        });

        if (pageStats.sessions.length > SESSIONS_MAX) {

            pageStats.sessions = pageStats.sessions.slice(
                pageStats.sessions.length - SESSIONS_MAX
            );

        }

        // Bascules en direct : union dédupliquée sur (horodatage +
        // chaîne). Surtout pas une concaténation — restaurer une
        // sauvegarde qui recouvre en partie l'existant doublerait le
        // compteur, alors que tout le reste de cette fonction est
        // construit pour ne jamais gonfler les stats.
        var directSeen = {};

        pageStats.directPlaybacks.forEach(function (entry) {
            directSeen[entry.t + '|' + entry.channel] = true;
        });

        (incoming.directPlaybacks || []).forEach(function (entry) {

            if (!entry) {
                return;
            }

            var key = entry.t + '|' + entry.channel;

            if (!directSeen[key]) {

                directSeen[key] = true;

                pageStats.directPlaybacks.push(entry);

            }

        });

        pageStats.directPlaybacks.sort(function (a, b) {
            return a.t - b.t;
        });

        if (pageStats.directPlaybacks.length > DIRECT_PLAYBACKS_MAX) {

            pageStats.directPlaybacks = pageStats.directPlaybacks.slice(
                pageStats.directPlaybacks.length - DIRECT_PLAYBACKS_MAX
            );

        }

        // Latences réelles : même principe, union sur l'horodatage.
        Object.keys(incoming.proxyLiveLatency || {}).forEach(function (id) {

            var current = pageStats.proxyLiveLatency[id] || [];

            var seen = {};

            current.forEach(function (entry) {
                seen[entry.t] = true;
            });

            (incoming.proxyLiveLatency[id] || []).forEach(function (entry) {

                if (entry && !seen[entry.t]) {

                    seen[entry.t] = true;

                    current.push(entry);

                }

            });

            current.sort(function (a, b) {
                return a.t - b.t;
            });

            var liveCutoff = Date.now() - STATS_HISTORY_MS;

            pageStats.proxyLiveLatency[id] = current.filter(function (entry) {
                return entry.t >= liveCutoff;
            });

        });

        if (!pageStats.bandwidthSource && incoming.bandwidthSource) {
            pageStats.bandwidthSource = incoming.bandwidthSource;
        }

        return true;

    }

    function importStatsBackupFromFile(file) {

        var reader = new FileReader();

        reader.onload = function () {

            try {

                var parsed = JSON.parse(reader.result);

                var incoming =
                    parsed && parsed.stats
                        ? parsed.stats
                        : parsed;

                if (
                    !incoming ||
                    typeof incoming !== 'object' ||
                    !incoming.totals
                ) {

                    alert('Ce fichier ne ressemble pas à une sauvegarde de statistiques.');

                    return;

                }

                mergeStatsFrom(incoming);

                // Une restauration remplace : le nouvel epoch dit aux
                // autres onglets de jeter leur delta, qui porterait
                // sinon sur des chiffres d'avant l'import.
                pageStats.epoch = (pageStats.epoch || 0) + 1;

                saveStatsNow({ authoritative: true });

                logEvent('success', 'Statistiques restaurées depuis une sauvegarde');

                renderStatsDashboard();

                alert('Statistiques restaurées.');

            } catch (e) {

                console.warn('[TwitchProxy] Restauration impossible:', e);

                alert('Fichier illisible : impossible de restaurer cette sauvegarde.');

            }

        };

        reader.onerror = function () {

            alert('Erreur de lecture du fichier.');

        };

        reader.readAsText(file);

    }

    // ------------------------------------------------------------
    // Automatisation + rappel
    // ------------------------------------------------------------

    function backupIsOverdue() {

        if (!pageConfig.autoBackupStats) {
            return false;
        }

        if (backupNeedsPermission) {
            return true;
        }

        if (!backupState.lastBackupAt) {
            return true;
        }

        return (Date.now() - backupState.lastBackupAt) > BACKUP_REMINDER_AFTER_MS;

    }

    function startAutoBackup() {

        primeBackupHandle();

        if (!supportsFileBackup()) {
            return;
        }

        setInterval(function () {

            if (!pageConfig.autoBackupStats) {
                return;
            }

            // lastBackupAt est dans le localStorage, donc partagé :
            // si un autre onglet vient de sauvegarder, celui-ci ne
            // réécrit pas le fichier pour rien.
            backupState = loadBackupState();

            if (
                backupState.lastBackupAt &&
                (Date.now() - backupState.lastBackupAt) < AUTO_BACKUP_MIN_INTERVAL_MS
            ) {
                return;
            }

            writeStatsBackup(true);

        }, AUTO_BACKUP_CHECK_MS);

    }

    function formatBackupDate(timestamp) {

        if (!timestamp) {
            return 'jamais';
        }

        try {

            return new Date(timestamp).toLocaleString(
                [],
                {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }
            );

        } catch (e) {

            return '—';

        }

    }

    // Bannière de rappel dans le menu + rafraîchissement de l'onglet
    // Sauvegarde s'il est ouvert.
    function updateBackupUI() {

        if (dashboard) {

            var banner = dashboard.querySelector('.tp9-backup-banner');

            if (banner) {

                var overdue = backupIsOverdue();

                banner.style.display = overdue ? 'flex' : 'none';

                if (overdue) {

                    banner.querySelector('.tp9-backup-text-sub').textContent =
                        backupNeedsPermission
                            ? 'Le navigateur demande de réautoriser l\'accès au fichier.'
                            : 'Dernière sauvegarde : ' +
                                formatBackupDate(backupState.lastBackupAt);

                }

            }

        }

        if (
            statsDashboard &&
            statsDashboardVisible &&
            statsActiveTab === 'sauvegarde'
        ) {

            renderStatsBackup(statsDashboard.querySelector('.tp9s-content'));

        }

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
                        // Le test sur la chaîne ne suffit pas : à deux
                        // onglets sur la MÊME chaîne, chacun prenait la
                        // course de l'autre pour la sienne (carte "Lecture
                        // actuelle" affichant le relais et la latence du
                        // voisin, toast "Lecture directe" dans un onglet qui
                        // passait pourtant par un relais). On le garde quand
                        // même : il écarte les aperçus automatiques.
                        if (event.data.tabId !== TAB_ID) {
                            return;
                        }

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

                            recordLiveLatency(
                                activeProxyInfo.proxyId,
                                activeProxyInfo.latency
                            );

                            logEvent(
                                'success',
                                'Proxy actif : ' +
                                activeProxyInfo.proxyName +
                                ' (' + activeProxyInfo.channel + ')'
                            );

                            notifyProxyRecovered(
                                activeProxyInfo.proxyName
                            );

                        } else if (
                            activeProxyInfo.direct
                        ) {

                            recordDirectPlayback(
                                activeProxyInfo.channel,
                                activeProxyInfo.tried
                            );

                            logEvent(
                                'warn',
                                'Aucun proxy disponible, lecture directe Twitch (' +
                                activeProxyInfo.channel + ')'
                            );

                            showDirectPlaybackToast(
                                activeProxyInfo.channel
                            );

                        }

                        renderDashboard();

                    }

                    // Octets réellement téléchargés, mesurés dans
                    // le Worker HLS. Filtré sur TAB_ID : les autres
                    // onglets twitch.tv reçoivent le même message et
                    // ne doivent surtout pas le compter aussi.
                    // Le DÉBIT, lui, se nourrit des messages de TOUS
                    // les onglets (pas de filtre TAB_ID) : c'est la
                    // seule façon pour l'onglet dashboard, qui ne lit
                    // aucune vidéo, de connaître la bande passante en
                    // cours. Les OCTETS, eux, restent filtrés plus
                    // bas — les compter deux fois fausserait tout.
                    if (
                        event.data &&
                        event.data.type === 'bandwidth'
                    ) {

                        recordThroughputSample(
                            event.data.tabId,
                            event.data.bytes
                        );

                        refreshLiveThroughput();

                    }

                    if (
                        event.data &&
                        event.data.type === 'bandwidth' &&
                        event.data.tabId === TAB_ID
                    ) {

                        lastNetworkBytesAt = Date.now();

                        // Le débit s'affiche dans la carte de lecture
                        // du menu : sans ce rafraîchissement, il
                        // resterait figé sur la valeur du dernier
                        // rendu (le menu ne se redessine qu'aux
                        // changements de proxy).
                        if (dashboardVisible) {
                            updateActiveProxyDisplay();
                        }

                        // Sert à retrouver la chaîne lue par le
                        // mini-player, qui n'est plus dans l'URL.
                        playerChannel = event.data.channel;
                        playerChannelAt = Date.now();

                        // Le Worker mesure les octets de TOUT ce que
                        // la page lit, aperçu automatique de
                        // l'accueil compris : on ne crédite que si
                        // c'est bien la lecture en cours (voir
                        // getActivePlayback).
                        if (
                            event.data.channel === getWatchedChannel()
                        ) {

                            recordBandwidthBytes(
                                event.data.channel,
                                event.data.bytes,
                                'network'
                            );

                        }

                    }

                    // Segments gardes par le Worker pour le
                    // retour arriere. Filtre sur TAB_ID : les
                    // autres onglets recoivent le message et ne
                    // doivent surtout pas melanger leurs
                    // segments aux notres.
                    if (
                        event.data &&
                        event.data.type === 'dvrSegment' &&
                        event.data.tabId === TAB_ID
                    ) {

                        recordDvrSegment(event.data);

                    }

                    // Expiration décidée par le Worker. Elle ne
                    // vient plus seulement de la capture : fermer
                    // le lecteur ou changer la profondeur en
                    // déclenche une aussi, et les ignorer laissait
                    // la page avec des URL de Blob révoquées.
                    if (
                        event.data &&
                        event.data.type === 'dvrDrop' &&
                        event.data.tabId === TAB_ID
                    ) {

                        dropDvrSegments(event.data);

                    }

                    if (
                        event.data &&
                        event.data.type === 'dvrUnsupported' &&
                        event.data.tabId === TAB_ID
                    ) {

                        dvrUnsupportedChannel =
                            event.data.channel;

                        dvrResetSegments();

                    }

                    // Sans le filtre, chaque onglet twitch.tv ouvert
                    // enregistrait et réécrivait le même événement.
                    if (
                        event.data &&
                        event.data.type === 'log' &&
                        event.data.tabId === TAB_ID
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
                        <div class="tp9-title">Twitch HLS Proxy<span class="tp9-version">v${CURRENT_VERSION}</span></div>
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

            <div class="tp9-test-progress">
                <div class="tp9-test-progress-fill"></div>
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

<div class="tp9-backup-banner" style="display:none;">
    <div class="tp9-update-icon">💾</div>
    <div class="tp9-update-text">
        <div class="tp9-update-title">Sauvegarde tes statistiques</div>
        <div class="tp9-update-version tp9-backup-text-sub"></div>
        <div class="tp9-update-hint">Un nettoyage du navigateur les effacerait</div>
    </div>
    <button class="tp9-update-btn tp9-backup-btn-action" type="button">Sauvegarder</button>
</div>

<div class="tp9-hero tp9-hero-idle">
    <span class="tp9-hero-dot"></span>
    <div class="tp9-hero-text">
        <div class="tp9-hero-label">LECTURE ACTUELLE</div>
        <div class="tp9-hero-value">En attente du flux…</div>
    </div>
    <span class="tp9-hero-meta"></span>
</div>

<button class="tp9-open-stats" type="button">
    <span class="tp9-btn-icon">📊</span> Ouvrir le dashboard complet
</button>

<div class="tp9-block">

<div class="tp9-section-title tp9-proxy-title-row">
    <span>📡 PROXYS</span>
    <span class="tp9-proxy-count"></span>
</div>

<div class="tp9-proxy-warning" style="display:none;"></div>

<input
    type="text"
    class="tp9-proxy-search"
    placeholder="Rechercher un proxy…"
    autocomplete="off"
>

<div class="tp9-proxy-list"></div>

<button
    class="tp9-add-proxy"
    type="button"
>
    ＋ Ajouter un proxy
</button>

<div class="tp9-add-container"></div>

</div>

<div class="tp9-block">

<div class="tp9-section-title">⚙️ RÉGLAGES</div>

<div class="tp9-settings-list">

    <label class="tp9-toggle-row"
        data-tp9-tip="Repli sur Twitch"
        data-tp9-tip-sub="Si aucun proxy ne répond, le flux repasse par Twitch — et les pubs avec. Désactivé, la lecture échoue plutôt que de les laisser revenir.">
        <span class="tp9-toggle-label">
            <span class="tp9-toggle-icon">🔁</span>
            Fallback automatique
        </span>
        <span class="tp9-switch">
            <input type="checkbox" class="tp9-fallback">
            <span class="tp9-switch-track"></span>
        </span>
    </label>

    <label class="tp9-toggle-row"
        data-tp9-tip="Qualité en arrière-plan"
        data-tp9-tip-sub="Fait croire à Twitch que l'onglet est toujours au premier plan, pour qu'il cesse de baisser la qualité quand tu passes ailleurs.">
        <span class="tp9-toggle-label">
            <span class="tp9-toggle-icon">🎬</span>
            Qualité en arrière-plan
        </span>
        <span class="tp9-switch">
            <input type="checkbox" class="tp9-keep-quality">
            <span class="tp9-switch-track"></span>
        </span>
    </label>

    <label class="tp9-toggle-row tp9-auto-backup-row">
        <span class="tp9-toggle-label">
            <span class="tp9-toggle-icon">💾</span>
            <span class="tp9-auto-backup-label">Sauvegarde auto des stats</span>
        </span>
        <span class="tp9-switch">
            <input type="checkbox" class="tp9-auto-backup">
            <span class="tp9-switch-track"></span>
        </span>
    </label>

    <label class="tp9-select-field tp9-dvr-auto-field"
        data-tp9-tip="Lecteur perso par défaut"
        data-tp9-tip-sub="Ouvre la barre de retour arrière toute seule en arrivant sur une chaîne. « Si un VOD existe » ne l'ouvre que là où il y a vraiment du passé à rejouer : ailleurs, le lecteur Twitch reste seul.">
        <span class="tp9-select-label">Lecteur perso par défaut</span>
        <select class="tp9-dvr-auto">
            <option value="never">Jamais</option>
            <option value="vod">Si un VOD existe</option>
            <option value="always">Toujours</option>
        </select>
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

</div>

<div class="tp9-block">

<div class="tp9-section-title">🛠️ ACTIONS</div>

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

<input
    type="file"
    class="tp9-import-file"
    accept="application/json"
    style="display:none;"
>

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

        attachTooltips(dashboard);

        attachSpotlight(dashboard);


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
            .querySelector('.tp9-auto-backup')
            .addEventListener(
                'change',
                function (event) {

                    pageConfig.autoBackupStats =
                        event.target.checked;

                    saveConfig(pageConfig);

                    updateBackupUI();

                }
            );


        // La bannière est un rappel : le clic doit donc RÉGLER le
        // problème tout de suite. Comme on est dans un vrai clic
        // utilisateur, on a le droit d'ouvrir le sélecteur de
        // fichier ou de réclamer l'autorisation manquante.
        dashboard
            .querySelector('.tp9-backup-btn-action')
            .addEventListener(
                'click',
                function () {

                    if (!supportsFileBackup()) {

                        downloadStatsBackup();

                        return;

                    }

                    // Décision synchrone : voir primeBackupHandle().
                    if (backupHandleCached) {

                        writeStatsBackup(false);

                    } else {

                        chooseStatsBackupFile();

                    }

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

        // L'interrupteur « Retour arrière » vivait ici ET dans les
        // réglages du Player Custom, sur la même chaîne, avec le
        // même effet. Il est resté là où on s'en sert, dans la
        // barre du lecteur (bouton ⚙) — et la profondeur gardée en
        // mémoire l'y a rejoint, pour la même raison : deux
        // curseurs pour un seul réglage, c'est un de trop. Ne
        // reste donc ici que l'ouverture automatique du lecteur.
        dashboard
            .querySelector('.tp9-dvr-auto')
            .addEventListener(
                'change',
                function (event) {

                    pageConfig.dvrAutoOpen =
                        event.target.value;

                    saveConfig(pageConfig);

                    broadcastConfig();

                    // Le réglage vient de changer : on rend sa chance
                    // à l'ouverture automatique sans attendre un
                    // changement de chaîne.
                    dvrAutoOpenedFor = null;

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
                            true,

                        autoBackupStats:
                            true,

                        dvrChannels:
                            {},

                        dvrBufferSeconds:
                            DEFAULT_DVR_BUFFER_SECONDS,

                        dvrAutoOpen:
                            'never'

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
            .querySelector('.tp9-proxy-search')
            .addEventListener(
                'input',
                function (event) {

                    proxySearchQuery = event.target.value;

                    // Seule la liste est reconstruite : le champ, lui,
                    // vit dans le squelette du menu et garde donc son
                    // focus et son curseur.
                    renderProxyList();

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


        // Un proxy coche mais en quarantaine ne participe plus a la
        // course (voir getRaceableProxies) : le compter parmi les
        // « actifs » laissait croire qu'il tenait encore le flux.
        var raceableCount = getRaceableProxies().length;

        var quarantinedCount =
            pageConfig.proxies.filter(
                function (p) {
                    return p.enabled && isQuarantined(p);
                }
            ).length;

        var countBadge =
            dashboard.querySelector('.tp9-proxy-count');

        countBadge.textContent =
            quarantinedCount
                ? raceableCount + ' en course · ' + quarantinedCount + ' 💤'
                : raceableCount +
                    ' / ' +
                    pageConfig.proxies.length +
                    ' en course';

        countBadge.setAttribute(
            'data-tp9-tip',
            raceableCount + ' proxy(s) en course'
        );

        countBadge.setAttribute(
            'data-tp9-tip-sub',
            'Sur ' + pageConfig.proxies.length + ' configurés' +
            (quarantinedCount
                ? ', dont ' + quarantinedCount +
                    ' coché(s) mais en quarantaine, donc écarté(s) de la course.'
                : '.')
        );

        renderProxyWarning(raceableCount);


        var searchField =
            dashboard.querySelector('.tp9-proxy-search');

        // En dessous d'une dizaine de proxys, un champ de recherche
        // est du décor : les groupes suffisent largement à s'y
        // retrouver.
        searchField.style.display =
            pageConfig.proxies.length >= PROXY_SEARCH_MIN ? 'block' : 'none';

        renderProxyList();

        renderDashboardSettings();

    }


    // Plus aucun proxy en course : le flux repartira chez Twitch
    // (donc avec les pubs), ou echouera si le repli est coupe. Le
    // menu ne le disait nulle part — seule une alerte au clic sur
    // « Tester » le signalait, donc trop tard et au mauvais endroit.
    function renderProxyWarning(raceableCount) {

        var warning =
            dashboard.querySelector('.tp9-proxy-warning');

        if (!warning) {
            return;
        }

        if (raceableCount > 0) {

            warning.style.display = 'none';

            return;

        }

        var enabledCount =
            pageConfig.proxies.filter(
                function (p) {
                    return p.enabled;
                }
            ).length;

        // Tout decoche et tout en quarantaine donnent le meme
        // resultat, mais pas la meme chose a faire : on nomme la
        // cause reelle plutot qu'un message unique et vague.
        var cause = enabledCount
            ? 'Tous les proxys activés sont en quarantaine'
            : 'Aucun proxy activé';

        var consequence = pageConfig.fallback
            ? 'la lecture repassera par Twitch, pubs comprises.'
            : 'le repli étant désactivé, la lecture échouera.';

        warning.innerHTML =
            '<span class="tp9-proxy-warning-icon">⚠️</span>' +
            '<span>' +
                escapeHTML(cause + ' : ' + consequence) +
            '</span>';

        warning.style.display = 'flex';

    }


    // ------------------------------------------------------------
    // GROUPES DE PROXYS
    // ------------------------------------------------------------
    //
    // Treize proxys en une seule liste plate, c'était illisible. Ils
    // sont maintenant regroupés par région — l'information existait
    // déjà (getProxyRegion, qui se fie à l'id et pas au nom).
    //
    // Conséquence assumée : le tri automatique par ping ne classe
    // plus la liste entière, il classe l'intérieur de chaque groupe.
    // On perd « le plus rapide est tout en haut », on gagne de
    // pouvoir replier une région entière.

    var PROXY_GROUPS_KEY = 'twitchProxyGroupsV1';

    var PROXY_SEARCH_MIN = 10;

    var PROXY_GROUPS = [
        { id: 'eu', label: 'Europe', icon: '🇪🇺', accent: '#4fc3f7' },
        { id: 'na', label: 'Amérique du Nord', icon: '🇺🇸', accent: '#ff9d4d' },
        { id: 'as', label: 'Asie', icon: '🌏', accent: '#00d084' },
        // Plus aucun relais n'y tombe : lb-sa est à New York et sert
        // du CDN NA. Le groupe reste déclaré pour le jour où un vrai
        // relais sud-américain apparaîtrait — renderProxyList saute
        // de toute façon les groupes vides.
        { id: 'sa', label: 'Amérique du Sud', icon: '🌎', accent: '#ff8fd6' },
        { id: 'custom', label: 'Perso', icon: '⚙️', accent: '#bf94ff' },
        { id: 'other', label: 'Autres', icon: '📡', accent: '#9147ff' },
        { id: 'quarantine', label: 'En quarantaine', icon: '💤', accent: '#ffcf7a' }
    ];

    function loadCollapsedGroups() {

        try {

            var saved = localStorage.getItem(PROXY_GROUPS_KEY);

            if (saved) {
                return JSON.parse(saved) || {};
            }

        } catch (e) {}

        // La quarantaine est repliée d'office : ce sont justement
        // les proxys dont il n'y a rien à attendre.
        return { quarantine: true };

    }

    var collapsedGroups = loadCollapsedGroups();

    var proxySearchQuery = '';

    function saveCollapsedGroups() {

        try {

            localStorage.setItem(
                PROXY_GROUPS_KEY,
                JSON.stringify(collapsedGroups)
            );

        } catch (e) {}

    }

    // La quarantaine passe avant tout le reste : un proxy écarté de
    // la course n'a plus rien à faire au milieu de sa région.
    function getProxyGroupId(proxy) {

        if (proxy.quarantine) {
            return 'quarantine';
        }

        if (proxy.custom) {
            return 'custom';
        }

        return getProxyRegion(proxy) || 'other';

    }

    function renderProxyList() {

        var list = dashboard.querySelector('.tp9-proxy-list');

        list.innerHTML = '';

        var query = proxySearchQuery.trim().toLowerCase();

        var buckets = {};

        pageConfig.proxies.forEach(function (proxy) {

            if (
                query &&
                proxy.name.toLowerCase().indexOf(query) === -1
            ) {
                return;
            }

            var groupId = getProxyGroupId(proxy);

            buckets[groupId] = buckets[groupId] || [];

            buckets[groupId].push(proxy);

        });

        var shown = 0;

        PROXY_GROUPS.forEach(function (group) {

            var proxies = buckets[group.id];

            if (!proxies || !proxies.length) {
                return;
            }

            shown += proxies.length;

            // Une recherche en cours déplie tout : cacher un
            // résultat derrière un groupe replié n'aurait aucun sens.
            var collapsed = !query && !!collapsedGroups[group.id];

            var groupEl = document.createElement('div');

            groupEl.className =
                'tp9-group' + (collapsed ? ' tp9-group-collapsed' : '');

            groupEl.style.setProperty('--accent', group.accent);

            var groupEnabled = proxies.filter(function (proxy) {
                return proxy.enabled;
            }).length;

            groupEl.innerHTML =
                '<div class="tp9-group-head">' +
                    '<span class="tp9-group-caret">▾</span>' +
                    '<span class="tp9-group-icon">' + group.icon + '</span>' +
                    '<span class="tp9-group-name">' +
                        escapeHTML(group.label) +
                    '</span>' +
                    '<button type="button" class="tp9-group-count"' +
                        ' data-tp9-tip="Tout activer ou tout désactiver"' +
                        ' data-tp9-tip-sub="Agit sur les ' + proxies.length +
                        ' proxys de ce groupe.">' +
                        groupEnabled + '/' + proxies.length +
                    '</button>' +
                '</div>' +
                '<div class="tp9-group-body"></div>';

            var body = groupEl.querySelector('.tp9-group-body');

            proxies.forEach(function (proxy) {
                body.appendChild(buildProxyRow(proxy));
            });

            groupEl
                .querySelector('.tp9-group-head')
                .addEventListener('click', function (event) {

                    // Même piège que partout dans ce menu : la ligne
                    // est reconstruite juste après, donc si le clic
                    // continuait à remonter, le listener global
                    // « clic en dehors » ne retrouverait plus son
                    // ancêtre #tp9-dashboard et fermerait tout.
                    event.stopPropagation();

                    collapsedGroups[group.id] = !collapsedGroups[group.id];

                    saveCollapsedGroups();

                    renderProxyList();

                });

            groupEl
                .querySelector('.tp9-group-count')
                .addEventListener('click', function (event) {

                    // Coupe aussi la remontée vers l'en-tête, sinon
                    // le groupe se replierait dans la foulée.
                    event.stopPropagation();

                    var turnOn = groupEnabled < proxies.length;

                    proxies.forEach(function (proxy) {
                        proxy.enabled = turnOn;
                    });

                    saveConfig(pageConfig);

                    broadcastConfig();

                    renderDashboard();

                });

            list.appendChild(groupEl);

        });

        if (!shown) {

            list.innerHTML =
                '<div class="tp9-empty">Aucun proxy ne correspond.</div>';

        }

    }


    // Construit la ligne d'UN proxy. Sortie de renderDashboard pour
    // que renderProxyList puisse la réutiliser groupe par groupe.
    function buildProxyRow(proxy) {

                var row =
                    document.createElement(
                        'div'
                    );


                row.className =
                    'tp9-proxy' +
                    (proxy.enabled ? '' : ' tp9-proxy-disabled') +
                    (proxy.quarantine ? ' tp9-proxy-quarantined' : '');


                row.style.setProperty(
                    '--accent',
                    getProxyAccent(proxy)
                );


                // Variable distincte de --accent, qui reste la
                // couleur de région : l'avatar et la case à cocher
                // doivent continuer à la porter.
                row.style.setProperty(
                    '--health',
                    getProxyHealthColor(proxy)
                );


                var lastTest =
                    proxy.lastTest;


                var statusText =
                    '⚪ non testé';


                var statusClass =
                    'tp9-status-never';


                if (proxy.quarantine) {

                    statusText =
                        '💤 en quarantaine';

                    statusClass =
                        'tp9-status-quarantine';

                } else if (lastTest) {

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


                var releaseButton =
                    proxy.quarantine
                        ? '<button class="tp9-unquarantine" type="button"' +
                            ' data-tp9-tip="Sortir de la quarantaine"' +
                            ' data-tp9-tip-sub="Le proxy est protégé 24 h avant de pouvoir y' +
                            ' retourner."' +
                            ' aria-label="Sortir de la quarantaine">🔓</button>'
                        : '';


                var deleteButton =
                    proxy.custom
                        ? `
                            <button
                                class="tp9-delete"
                                type="button"
                                data-tp9-tip="Supprimer ce proxy"
                                aria-label="Supprimer"
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 7h16"/>
                                    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
                                    <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>
                                    <path d="M10 11v6"/>
                                    <path d="M14 11v6"/>
                                </svg>
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

                        <div
                            class="tp9-proxy-avatar"
                            ${getProxyTipAttrs(proxy)}
                        >
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
                        (proxy.custom || proxy.quarantine)
                            ? '<div class="tp9-move">' + releaseButton + deleteButton + '</div>'
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


                if (proxy.quarantine) {

                    row
                        .querySelector(
                            '.tp9-unquarantine'
                        )
                        .addEventListener(
                            'click',
                            function (event) {

                                // Même piège que le toggle : la ligne
                                // est reconstruite juste après, donc
                                // on coupe la remontée avant, sinon le
                                // listener global "clic en dehors"
                                // referme tout le menu.
                                event.stopPropagation();

                                releaseFromQuarantine(proxy, true);

                                saveConfig(pageConfig);

                                broadcastConfig();

                                renderDashboard();

                            }
                        );

                }


                if (proxy.custom) {

                    row
                        .querySelector(
                            '.tp9-delete'
                        )
                        .addEventListener(
                            'click',
                            function (event) {

                                // Même piège que le toggle d'activation
                                // ci-dessus : la ligne est détruite par
                                // renderDashboard() dans
                                // deleteCustomProxy(), donc il faut
                                // empêcher la remontée AVANT, sinon le
                                // listener global "clic en dehors du
                                // menu" ne retrouve plus son ancêtre
                                // #tp9-dashboard et ferme tout le menu.
                                event.stopPropagation();

                                deleteCustomProxy(
                                    proxy.id
                                );

                            }
                        );

                }


                return row;

    }


    // Tout ce qui, dans le menu, n'est pas la liste des proxys :
    // interrupteurs, listes déroulantes, bannière de sauvegarde.
    function renderDashboardSettings() {

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
                '.tp9-auto-backup'
            )
            .checked =
            !!pageConfig.autoBackupStats;


        // Sans File System Access (Firefox), un script ne PEUT PAS
        // réécrire un fichier tout seul : ici `autoBackupStats` ne
        // pilote donc que la bannière de rappel. On renomme la
        // ligne pour dire ce qu'elle fait vraiment — la masquer
        // supprimerait le seul moyen de faire taire ce rappel.
        var autoBackupRow =
            dashboard.querySelector('.tp9-auto-backup-row');

        if (autoBackupRow) {

            var canWriteFile = supportsFileBackup();

            autoBackupRow.querySelector('.tp9-auto-backup-label').textContent =
                canWriteFile
                    ? 'Sauvegarde auto des stats'
                    : 'Rappel de sauvegarde';

            autoBackupRow.setAttribute(
                'data-tp9-tip',
                canWriteFile
                    ? 'Sauvegarde automatique'
                    : 'Rappel de sauvegarde'
            );

            autoBackupRow.setAttribute(
                'data-tp9-tip-sub',
                canWriteFile
                    ? 'Réécrit ton fichier de sauvegarde toutes les 15 minutes.'
                    : 'Ton navigateur interdit à un script d\'écrire dans un fichier : ' +
                        'le script te rappelle de sauvegarder au lieu de le faire seul.'
            );

        }


        updateBackupUI();


        var dvrAuto =
            dashboard.querySelector('.tp9-dvr-auto');

        if (dvrAuto) {

            dvrAuto.value =
                pageConfig.dvrAutoOpen || 'never';

        }

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


    // Affiche le proxy réellement utilisé par le Worker pour la
    // lecture en cours (remonté via BroadcastChannel), à ne pas
    // confondre avec les résultats de l'auto-test ci-dessus.
    function updateActiveProxyDisplay() {

        if (!dashboard) {
            return;
        }

        var hero =
            dashboard.querySelector(
                '.tp9-hero'
            );

        if (!hero) {
            return;
        }

        var valueEl = hero.querySelector('.tp9-hero-value');
        var metaEl = hero.querySelector('.tp9-hero-meta');

        var channel = getTestChannel();

        hero.classList.remove(
            'tp9-hero-live',
            'tp9-hero-direct',
            'tp9-hero-idle'
        );

        // Rien remonté par le Worker pour CETTE chaîne : la lecture
        // n'a pas encore démarré. On le dit plutôt que de masquer la
        // carte — un haut de menu qui apparaît et disparaît ferait
        // sauter tout le reste sous le curseur.
        if (
            !activeProxyInfo ||
            !channel ||
            activeProxyInfo.channel !== channel
        ) {

            hero.classList.add('tp9-hero-idle');

            valueEl.textContent = 'En attente du flux…';

            metaEl.textContent = '';

            return;

        }

        if (activeProxyInfo.direct) {

            hero.classList.add('tp9-hero-direct');

            valueEl.textContent = 'Twitch en direct';

            metaEl.textContent = 'aucun proxy';

            return;

        }

        hero.classList.add('tp9-hero-live');

        valueEl.textContent = activeProxyInfo.proxyName;

        var proxy =
            pageConfig.proxies.find(
                function (p) {
                    return p.id === activeProxyInfo.proxyId;
                }
            );

        // Latence de la course RÉELLEMENT gagnée par ce proxy si le
        // Worker l'a remontée : c'est ce que la lecture a vraiment
        // coûté. À défaut seulement, celle du dernier test provoqué.
        var latencyText = null;

        if (typeof activeProxyInfo.latency === 'number') {

            latencyText = activeProxyInfo.latency + ' ms';

        } else if (proxy && proxy.lastTest && proxy.lastTest.ok) {

            latencyText = proxy.lastTest.latency + ' ms';

        }

        // Le débit, lui, ne vient pas du proxy mais des octets que le
        // Worker remonte toutes les 5 s. La carte "Bande passante
        // totale" du dashboard précise elle-même qu'elle n'est pas le
        // débit actuel : le voici, au seul endroit où il a du sens.
        var throughputText = formatThroughput(getLiveThroughputBps());

        metaEl.textContent =
            [latencyText, throughputText]
                .filter(Boolean)
                .join(' · ');

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

        <div class="tp9-add-form">

            <div class="tp9-add-form-header">
                <span class="tp9-add-form-icon">⚙️</span>
                <span class="tp9-add-form-title">Ajouter un proxy</span>
            </div>

            <div class="tp9-add-field">

                <label for="tp9-new-name">
                    Nom
                </label>

                <input
                    id="tp9-new-name"
                    type="text"
                    class="tp9-new-name"
                    placeholder="Mon proxy"
                    autocomplete="off"
                >

            </div>

            <div class="tp9-add-field">

                <label for="tp9-new-url">
                    URL
                </label>

                <input
                    id="tp9-new-url"
                    type="text"
                    class="tp9-new-url"
                    placeholder="https://exemple.com/live/{channel}"
                    autocomplete="off"
                >

                <div class="tp9-help">
                    L'URL doit contenir
                    <code>{channel}</code>
                </div>

            </div>

            <div class="tp9-form-error"></div>

            <div class="tp9-add-form-actions">

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
                    ＋ Ajouter
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
            function (event) {

                // Le clic vide le conteneur (le bouton lui-même est
                // détaché du DOM) : s'il continuait à remonter, le
                // listener global "clic en dehors du menu" ne
                // retrouverait plus son ancêtre #tp9-dashboard via
                // closest() et fermerait tout le menu à tort.
                event.stopPropagation();

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
            function (event) {

                event.stopPropagation();

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

                // Même contrôle qu'à l'import : voir isProxyURLValid.
                if (!isProxyURLValid(url)) {

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


    // Le pictogramme 🗑 s'affiche en carré vide sur le système de
    // l'utilisateur, comme 🗓 avant lui : on réutilise l'icône
    // vectorielle déjà employée pour supprimer un proxy
    // personnalisé, identique partout et sans dépendance aux polices
    // emoji.
    function trashIconSVG(size) {

        return (
            '<svg width="' + size + '" height="' + size + '"' +
            ' viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
            ' stroke-width="2.2" stroke-linecap="round"' +
            ' stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M4 7h16"/>' +
                '<path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>' +
                '<path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>' +
                '<path d="M10 11v6"/>' +
                '<path d="M14 11v6"/>' +
            '</svg>'
        );

    }


    // ------------------------------------------------------------
    // INFOBULLES MAISON
    // ------------------------------------------------------------
    //
    // Les attributs `title` du navigateur ont trois défauts ici :
    // ils sont dessinés par le navigateur (donc impossibles à
    // styler), ils n'apparaissent qu'après environ une seconde, et
    // surtout ils disparaissent dès que le dashboard se rafraîchit
    // en silence — renderStatsDashboard(true) remplace tout le
    // contenu, donc l'élément survolé est détruit sous le curseur
    // (et son mouseleave ne part jamais).
    //
    // On les remplace par un attribut `data-tp9-tip` (+ un
    // `data-tp9-tip-sub` facultatif pour une seconde ligne) et une
    // bulle unique qui vit HORS du conteneur reconstruit, ancrée
    // au-dessus de l'élément qu'elle décrit.

    var tooltipElement = null;
    var tooltipTarget = null;

    // Dernière position connue du curseur : sert à retrouver
    // l'élément survolé après un rafraîchissement silencieux.
    var tooltipPointer = { x: -1, y: -1 };

    function ensureTooltip() {

        if (tooltipElement) {
            return tooltipElement;
        }

        // Feuille de style autonome : la bulle sert aussi bien au
        // popup qu'au dashboard, qui n'injectent pas le même CSS.
        if (!document.getElementById('tp9-tip-style')) {

            var style = document.createElement('style');

            style.id = 'tp9-tip-style';

            style.textContent = `

                #tp9-tip {

                    position: fixed;

                    left: 0;
                    top: 0;

                    z-index: 2147483647;

                    max-width: 260px;

                    padding: 6px 10px;

                    border-radius: 8px;

                    background: #17171c;

                    border: 1px solid rgba(255,255,255,.12);

                    box-shadow: 0 6px 18px rgba(0,0,0,.45);

                    color: #efeff1;

                    font-family: "Inter", Arial, sans-serif;

                    font-size: 11.5px;

                    line-height: 1.35;

                    pointer-events: none;

                    opacity: 0;

                    transform: translateY(3px);

                    transition: opacity .1s ease, transform .1s ease;

                }

                #tp9-tip.tp9-tip-visible {

                    opacity: 1;

                    transform: none;

                }

                .tp9-tip-title {

                    font-weight: 700;

                    white-space: nowrap;

                }

                .tp9-tip-sub {

                    margin-top: 2px;

                    color: #a9a9b0;

                    font-size: 11px;

                }

                .tp9-tip-sub:empty {

                    display: none;

                }

            `;

            document.head.appendChild(style);

        }

        tooltipElement = document.createElement('div');

        tooltipElement.id = 'tp9-tip';

        tooltipElement.innerHTML =
            '<div class="tp9-tip-title"></div>' +
            '<div class="tp9-tip-sub"></div>';

        document.body.appendChild(tooltipElement);

        return tooltipElement;

    }

    function positionTooltip(el, tip) {

        var rect = el.getBoundingClientRect();
        var tipRect = tip.getBoundingClientRect();

        var left = rect.left + (rect.width - tipRect.width) / 2;

        var top = rect.top - tipRect.height - 8;

        // Pas la place au-dessus (ligne tout en haut du panneau) :
        // on bascule en dessous plutôt que de sortir de l'écran.
        if (top < 4) {
            top = rect.bottom + 8;
        }

        var maxLeft = window.innerWidth - tipRect.width - 6;

        tip.style.left = Math.max(6, Math.min(left, maxLeft)) + 'px';
        tip.style.top = top + 'px';

    }

    function showTooltipFor(el) {

        var text = el.getAttribute('data-tp9-tip');

        if (!text) {
            return;
        }

        var tip = ensureTooltip();

        // Replacé en dernier dans son hôte : garantit qu'il passe
        // au-dessus du dashboard plein écran, qui peut avoir été
        // créé après lui et partage le même z-index.
        //
        // L'hôte n'est pas toujours <body> : en plein écran, le
        // navigateur ne dessine que le sous-arbre de l'élément
        // concerné, et une bulle restée dans <body> y serait donc
        // invisible — c'est le cas de la barre de retour arrière.
        var tipHost = document.fullscreenElement || document.body;

        if (tipHost.lastChild !== tip) {
            tipHost.appendChild(tip);
        }

        tooltipTarget = el;

        tip.querySelector('.tp9-tip-title').textContent = text;

        tip.querySelector('.tp9-tip-sub').textContent =
            el.getAttribute('data-tp9-tip-sub') || '';

        tip.classList.add('tp9-tip-visible');

        positionTooltip(el, tip);

    }

    // Change le texte d'une infobulle DÉJÀ affichée. Elle n'est
    // construite qu'au survol : écrire l'attribut ne suffit donc pas
    // tant qu'elle est à l'écran. C'est ce qui permet au temps
    // survolé de défiler sous la souris au lieu de n'apparaître
    // qu'au survol suivant.
    function refreshTooltipText(el) {

        if (!tooltipElement || tooltipTarget !== el) {
            return;
        }

        tooltipElement.querySelector('.tp9-tip-title').textContent =
            el.getAttribute('data-tp9-tip') || '';

        tooltipElement.querySelector('.tp9-tip-sub').textContent =
            el.getAttribute('data-tp9-tip-sub') || '';

        // Le titre s'allonge et se raccourcit au fil du survol : la
        // bulle est centrée sur son élément, elle doit se recaler.
        positionTooltip(el, tooltipElement);

    }


    function hideTooltip() {

        tooltipTarget = null;

        if (tooltipElement) {
            tooltipElement.classList.remove('tp9-tip-visible');
        }

    }

    // Après un rafraîchissement silencieux, l'élément survolé a été
    // détruit puis recréé à l'identique : on le retrouve sous le
    // curseur et on ré-ancre la bulle, au lieu de la laisser
    // pointer dans le vide ou disparaître.
    function refreshTooltipAnchor() {

        if (!tooltipTarget || tooltipPointer.x < 0) {
            return;
        }

        var under = document.elementFromPoint(
            tooltipPointer.x,
            tooltipPointer.y
        );

        var el = under ? closestElement(under, '[data-tp9-tip]') : null;

        if (el) {

            showTooltipFor(el);

        } else {

            hideTooltip();

        }

    }

    // Écoute déléguée sur un conteneur PERSISTANT : continue donc
    // de fonctionner sur les éléments recréés à chaque rendu.
    function attachTooltips(root) {

        if (!root || root.__tp9TipsAttached) {
            return;
        }

        root.__tp9TipsAttached = true;

        root.addEventListener('mouseover', function (event) {

            var el = closestElement(event.target, '[data-tp9-tip]');

            if (el && el !== tooltipTarget) {
                showTooltipFor(el);
            }

        });

        root.addEventListener('mouseout', function (event) {

            var el = closestElement(event.target, '[data-tp9-tip]');

            if (el && el === tooltipTarget) {
                hideTooltip();
            }

        });

        root.addEventListener('mousemove', function (event) {

            tooltipPointer.x = event.clientX;
            tooltipPointer.y = event.clientY;

        });

        root.addEventListener('mouseleave', hideTooltip);

        root.addEventListener('click', hideTooltip);

        // La bulle est en position fixe : un défilement du contenu
        // la laisserait accrochée dans le vide.
        root.addEventListener('scroll', hideTooltip, true);

    }


    // ------------------------------------------------------------
    // HALO QUI SUIT LE CURSEUR DANS LES BOUTONS
    // ------------------------------------------------------------
    //
    // Le survol d'un bouton éclairait toute sa surface d'un coup.
    // Ici la lumière se place SOUS le curseur et le suit : on écrit
    // sa position (en pixels, relative au bouton) dans --mx / --my,
    // et le CSS n'a plus qu'à y centrer un dégradé radial.
    //
    // Écoute déléguée sur les conteneurs PERSISTANTS, comme pour les
    // infobulles : le contenu du dashboard est reconstruit en
    // permanence, poser un écouteur sur chaque bouton serait à
    // refaire à chaque rendu.
    //
    // Cette liste doit rester alignée avec les sélecteurs des blocs
    // « HALO QUI SUIT LE CURSEUR » des deux feuilles de style (un
    // bloc pour les boutons, un second pour les surfaces).
    var SPOTLIGHT_SELECTOR = [
        '#tp9-player-button',
        '.tp9-close',
        '.tp9-update-btn',
        '.tp9-open-stats',
        '.tp9-actions button',
        '.tp9-add-proxy',
        '.tp9-unquarantine',
        '.tp9-delete',
        '.tp9-add-form-actions button',
        '.tp9-toast-btn',
        '.tp9-toast-close',
        '.tp9s-nav-item',
        '.tp9s-close-btn',
        '.tp9s-topbar-actions button',
        '.tp9s-panel-link',
        '.tp9s-chart-range-btn',
        '.tp9s-backup-btn',
        '.tp9s-clear-logs',
        '.tp9s-msg-count',
        '.tp9s-streamer-delete',
        '.tp9-chat-modal-close',

        // Surfaces, et non boutons : la ligne d'un relais bascule
        // active/desactive, la ligne d'un reglage est un <label> qui
        // pilote son interrupteur, les cartes de la Vue d'ensemble
        // renvoient vers leur onglet. L'en-tete des tableaux est
        // exclu : c'est une ligne comme les autres pour le CSS, mais
        // rien n'y reagit au survol.
        //
        // .tp9-proxy (la ligne entiere) et non .tp9-proxy-main : la
        // zone cliquable est en retrait des bords a cause du padding
        // de la ligne, le halo s'y arretait donc avant le cadre.
        '.tp9-proxy',
        '.tp9-group-head',
        '.tp9-toggle-row',
        '.tp9s-card',
        '.tp9s-table-row:not(.tp9s-table-head)',
        '.tp9s-lead-row'
    ].join(',');

    // Une seule écriture de style par frame, pour tout le script :
    // un mousemove part à chaque pixel parcouru, et rien ne sert de
    // repositionner le halo plus souvent que le navigateur ne
    // repeint.
    var spotlightPending = null;
    var spotlightFrame = null;

    function applySpotlight() {

        spotlightFrame = null;

        if (!spotlightPending) {
            return;
        }

        var el = spotlightPending.el;

        var rect = el.getBoundingClientRect();

        if (rect.width) {

            el.style.setProperty(
                '--mx',
                (spotlightPending.x - rect.left) + 'px'
            );

            el.style.setProperty(
                '--my',
                (spotlightPending.y - rect.top) + 'px'
            );

        }

        spotlightPending = null;

    }

    function attachSpotlight(root) {

        if (!root || root.__tp9SpotAttached) {
            return;
        }

        root.__tp9SpotAttached = true;

        root.addEventListener('mousemove', function (event) {

            var el = closestElement(event.target, SPOTLIGHT_SELECTOR);

            if (!el) {
                return;
            }

            spotlightPending = {
                el: el,
                x: event.clientX,
                y: event.clientY
            };

            if (!spotlightFrame) {
                spotlightFrame = requestAnimationFrame(applySpotlight);
            }

        });

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


    var DVR_CSS = `

        /* =====================================================
           BOUTON RETOUR ARRIÈRE
        ===================================================== */

        /* Ce bouton se tient dans la barre d'actions de la chaîne,
           entre le bouclier du menu et le cœur : il doit donc avoir
           exactement la façon des boutons de Twitch — pastille
           arrondie, même fond translucide, même hauteur. Le carré
           noir à angles droits de la version précédente jurait au
           milieu d'eux.

           Les valeurs sont celles de #tp9-player-button, recopiées
           volontairement : les deux boutons doivent rester
           indiscernables l'un de l'autre. */

        #tp9-dvr-button {

            z-index: 2147483646;

            width: auto;
            height: 32px;

            min-width: 32px;

            padding: 0 12px;
            margin: 0;

            display: inline-flex;

            align-items: center;
            justify-content: center;

            box-sizing: border-box;

            border: 0;

            border-radius: 9000px;

            background-color: rgba(83, 83, 95, .48);

            color: #efeff1;

            line-height: 1;

            cursor: pointer;

            appearance: none;
            -webkit-appearance: none;

            outline: none;

            transition:
                background-color .12s ease,
                color .12s ease,
                opacity .15s ease,
                transform .12s ease;

        }

        #tp9-dvr-button svg {

            display: block;

        }

        #tp9-dvr-button:hover {

            background-color: rgba(83, 83, 95, .7);

            color: #fff;

            transform: translateY(-1px);

        }

        #tp9-dvr-button:active {

            background-color: rgba(0, 0, 0, .85);

            transform: scale(.97);

        }

        #tp9-dvr-button:focus-visible {

            outline: 2px solid #fff;

            outline-offset: 2px;

        }

        /* Rien à rejouer : il garde sa place mais cesse de réagir,
           comme les commandes sans objet de la barre. */

        #tp9-dvr-button.tp9-dvr-off {

            opacity: .38;

            cursor: default;

        }

        #tp9-dvr-button.tp9-dvr-off:hover,
        #tp9-dvr-button.tp9-dvr-off:active {

            background-color: rgba(83, 83, 95, .48);

            transform: none;

        }

        @media (prefers-reduced-motion: reduce) {

            #tp9-dvr-button:hover,
            #tp9-dvr-button:active {

                transform: none;

            }

        }


        /* =====================================================
           LECTEUR DE RETOUR ARRIÈRE
        ===================================================== */

        .tp9dvr {

            z-index: 2147483645;

            background: #000;

            overflow: hidden;

            display: flex;

            align-items: flex-end;

            font-family: Inter, Roobert, "Helvetica Neue", Arial, sans-serif;

        }

        .tp9dvr-video {

            position: absolute;

            inset: 0;

            width: 100%;

            height: 100%;

            object-fit: contain;

            background: #000;

        }

        .tp9dvr-status {

            position: absolute;

            inset: 0;

            display: none;

            align-items: center;

            justify-content: center;

            padding: 0 24px;

            color: rgba(255,255,255,.82);

            font-size: 13px;

            text-align: center;

            pointer-events: none;

        }


        /* La barre reste visible en permanence : ce mode est
           temporaire, masquer les commandes ferait perdre le
           bouton de retour au direct. */

        .tp9dvr-bar {

            position: relative;

            z-index: 2;

            width: 100%;

            box-sizing: border-box;

            display: flex;

            align-items: center;

            gap: 8px;

            padding: 26px 12px 10px;

            background: linear-gradient(
                to top,
                rgba(0,0,0,.88),
                rgba(0,0,0,0)
            );

        }

        .tp9dvr-btn {

            flex: none;

            width: 28px;

            height: 28px;

            padding: 0;

            display: inline-flex;

            align-items: center;

            justify-content: center;

            border: none;

            border-radius: 5px;

            background: transparent;

            color: #fff;

            font-size: 14px;

            line-height: 1;

            cursor: pointer;

            transition: background .15s ease;

        }

        .tp9dvr-btn:hover {

            background: rgba(255,255,255,.16);

        }

        .tp9dvr-time {

            flex: none;

            min-width: 52px;

            color: #fff;

            font-size: 12px;

            font-variant-numeric: tabular-nums;

            text-align: center;

        }

        .tp9dvr-seek {

            flex: 1 1 auto;

            min-width: 60px;

        }

        .tp9dvr-vol {

            flex: none;

            width: 68px;

        }

        .tp9dvr input[type="range"] {

            -webkit-appearance: none;

            appearance: none;

            height: 4px;

            border-radius: 2px;

            background: rgba(255,255,255,.28);

            cursor: pointer;

        }

        .tp9dvr input[type="range"]::-webkit-slider-thumb {

            -webkit-appearance: none;

            appearance: none;

            width: 12px;

            height: 12px;

            border: none;

            border-radius: 50%;

            background: #9147ff;

        }

        .tp9dvr input[type="range"]::-moz-range-thumb {

            width: 12px;

            height: 12px;

            border: none;

            border-radius: 50%;

            background: #9147ff;

        }

        /* Dire d'où sort l'image évite la question « pourquoi je ne
           peux pas remonter plus loin ». */

        .tp9dvr-source {

            flex: none;

            padding: 2px 7px;

            border-radius: 4px;

            background: rgba(145,71,255,.24);

            color: #d3bdff;

            font-size: 10px;

            font-weight: 700;

            letter-spacing: .04em;

            text-transform: uppercase;

            white-space: nowrap;

        }

        .tp9dvr-live {

            flex: none;

            padding: 6px 11px;

            border: none;

            border-radius: 5px;

            background: rgba(255,255,255,.14);

            color: #fff;

            font-size: 11px;

            font-weight: 700;

            white-space: nowrap;

            cursor: pointer;

            transition: background .15s ease;

        }

        .tp9dvr-live:hover {

            background: #eb0400;

        }


        /* Le seul réglage de retour arrière qui reste ici : la
           profondeur gardée en mémoire se règle maintenant dans
           les réglages du lecteur perso, là où on s'en sert. */

        .tp9-dvr-auto-field {

            margin-top: 10px;

        }


        /* =====================================================
           MODE DIRECT
           -----------------------------------------------------
           La barre est posée sur le lecteur Twitch, qui joue
           toujours : la surface laisse donc passer les clics,
           le stream reste cliquable normalement.

           Seule la barre capte la souris, et elle se cale au
           RAS DU BAS du lecteur — exactement là où Twitch met
           la sienne. Les deux ne peuvent pas cohabiter : la
           décaler vers le haut la faisait flotter au milieu
           de l'image. La nôtre passe donc devant, et son fond
           est assez opaque pour que celle de Twitch ne
           transparaisse pas quand le survol la rappelle
           dessous.
        ===================================================== */

        .tp9dvr-live-mode {

            background: transparent;

            pointer-events: none;

        }

        .tp9dvr-live-mode .tp9dvr-video {

            display: none;

        }

        .tp9dvr-live-mode .tp9dvr-bar {

            pointer-events: auto;

            margin-bottom: 0;

            background: linear-gradient(
                to top,
                rgba(0,0,0,.97) 0%,
                rgba(0,0,0,.93) 55%,
                rgba(0,0,0,0) 100%
            );

        }


        /* Une commande sans objet sur le direct (pause, avance,
           retour au direct alors qu'on y est déjà) : elle reste
           à sa place, elle cesse juste de faire semblant. */

        .tp9dvr-btn:disabled,
        .tp9dvr-live:disabled {

            opacity: .3;

            cursor: default;

        }

        .tp9dvr-btn:disabled:hover,
        .tp9dvr-live:disabled:hover {

            background: transparent;

        }

        .tp9dvr-live:disabled:hover {

            background: rgba(255,255,255,.14);

        }


        /* La pastille de source passe au rouge sur le direct :
           c'est la couleur que Twitch lui donne partout. */

        .tp9dvr-source-live {

            background: rgba(235,4,0,.26);

            color: #ff9b98;

        }


        /* =====================================================
           VOLUME À LA MOLETTE
           -----------------------------------------------------
           Le curseur de volume fait 68 px : à la molette, par
           pas de 1 %, il ne bouge presque pas. C'est le chiffre
           qui dit où on en est.
        ===================================================== */

        .tp9dvr-vol-hint {

            position: absolute;

            left: 50%;

            top: 50%;

            transform: translate(-50%, -50%) scale(.94);

            padding: 9px 16px;

            border-radius: 10px;

            background: rgba(0,0,0,.72);

            color: #fff;

            font-size: 15px;

            font-weight: 700;

            font-variant-numeric: tabular-nums;

            white-space: nowrap;

            pointer-events: none;

            opacity: 0;

            transition: opacity .12s ease, transform .12s ease;

        }

        .tp9dvr-vol-hint.tp9dvr-vol-hint-on {

            opacity: 1;

            transform: translate(-50%, -50%) scale(1);

        }


        @media (prefers-reduced-motion: reduce) {

            .tp9dvr-vol-hint {

                transition: none;

            }

        }


        /* =====================================================
           LA BARRE S'EFFACE QUAND LA SOURIS S'EN VA
           -----------------------------------------------------
           Elle restait affichée en permanence, posée par-dessus
           l'image. Elle suit maintenant la même règle que celle
           de Twitch : visible tant que le curseur est sur le
           lecteur, effacée quelques secondes après qu'il en soit
           sorti.

           « pointer-events: none » une fois effacée, sinon elle
           continuerait d'intercepter les clics destinés aux
           commandes de Twitch en mode direct.
        ===================================================== */

        .tp9dvr-bar {

            transition:
                opacity .18s ease,
                transform .18s ease;

        }

        /* Trois classes plutôt que deux : « .tp9dvr-live-mode
           .tp9dvr-bar » rétablit « pointer-events: auto » et
           l'emporterait sur une règle à une seule classe. */

        .tp9dvr .tp9dvr-bar.tp9dvr-bar-hidden {

            opacity: 0;

            transform: translateY(10px);

            pointer-events: none;

        }


        /* =====================================================
           CURSEUR DE POSITION : UNE VRAIE ZONE DE PRISE
           -----------------------------------------------------
           Le trait fait 4 px de haut : il fallait viser au pixel
           près pour l'attraper. L'élément monte donc à 18 px —
           c'est lui qui reçoit la souris — tandis que le trait
           VISIBLE passe sur la piste (::-*-track) et garde sa
           finesse. Rien ne change à l'œil, tout change à la main.

           Sélecteurs en « input.tp9dvr-seek » et non en
           « .tp9dvr-seek » seul : les règles génériques plus
           haut sont écrites en « .tp9dvr input[type=range] »,
           donc plus spécifiques
           qu'une classe isolée.
        ===================================================== */

        .tp9dvr input.tp9dvr-seek {

            height: 18px;

            border-radius: 0;

            background: transparent;

        }

        .tp9dvr input.tp9dvr-seek::-webkit-slider-runnable-track {

            height: 4px;

            border-radius: 2px;

            background: rgba(255,255,255,.28);

        }

        .tp9dvr input.tp9dvr-seek::-moz-range-track {

            height: 4px;

            border-radius: 2px;

            background: rgba(255,255,255,.28);

        }

        /* Webkit ne recentre pas la pastille quand la piste est
           plus fine que l'élément : -5px = (14 - 4) / 2. */

        .tp9dvr input.tp9dvr-seek::-webkit-slider-thumb {

            width: 14px;

            height: 14px;

            margin-top: -5px;

        }

        .tp9dvr input.tp9dvr-seek::-moz-range-thumb {

            width: 14px;

            height: 14px;

        }


        @media (prefers-reduced-motion: reduce) {

            /* Le fondu reste : c'est de l'opacité, pas du
               mouvement. Seul le glissement part. */

            .tp9dvr-bar {

                transition: opacity .18s ease;

            }

            .tp9dvr .tp9dvr-bar.tp9dvr-bar-hidden {

                transform: none;

            }

        }


        /* =====================================================
           PICTOGRAMMES
           -----------------------------------------------------
           Les emoji étaient dessinés par la police du système :
           ni la même taille, ni la même couleur, ni le même
           alignement que les commandes de Twitch juste en
           dessous. Des tracés vectoriels prennent leur place,
           tous à la couleur du texte.
        ===================================================== */

        .tp9dvr-btn svg,
        .tp9dvr-live svg {

            display: block;

        }

        /* Le rouge de Twitch, et une pastille plutôt qu'un emoji
           🔴 : elle garde sa taille quelle que soit la police. */

        .tp9dvr-live {

            display: inline-flex;

            align-items: center;

            gap: 7px;

        }

        .tp9dvr-live-dot {

            width: 8px;

            height: 8px;

            border-radius: 50%;

            background: #eb0400;

        }

        .tp9dvr-vol-hint {

            display: flex;

            align-items: center;

            gap: 9px;

        }


        /* =====================================================
           BARRE DE POSITION : CE QU'ELLE CONTIENT
           =====================================================

           Elle ne disait que « où je suis », jamais « ce qui est
           rejouable » — d'où les clics dans le vide et le
           sentiment de ne pas savoir où en est la mémoire.

           Les deux sources y sont donc peintes à leur vraie place,
           gauche = le plus ancien, droite = le direct : violet pour
           la mémoire, bleu pour le VOD, gris pour ce que personne
           ne couvre. Sans VOD, l'échelle est celle de la profondeur
           DEMANDÉE (voir dvrTimelineMax) : le violet grandit alors
           vers la gauche au fil du remplissage, et se lit comme une
           barre de progression.

           Elles vivaient DANS la piste, donc SOUS la pastille. Or
           celle-ci fait 14 px et se tient au bord droit (= le
           direct), pile là où la mémoire commence à se remplir :
           les 30 à 40 premières secondes enregistrées
           disparaissaient dessous, au moment précis où l'on
           regarde si ça enregistre.

           Elles sont maintenant peintes AU-DESSUS, dans un calque
           posé par-dessus le curseur (.tp9dvr-seek-paint, en
           pointer-events: none pour que le glissement continue
           d'aller à l'input). La pastille native devient
           transparente — elle garde ses 14 px, donc la même zone de
           prise — et c'est le calque qui dessine le repère de
           lecture : un trait de 4 px, qui ne cache plus rien.

           Les bornes arrivent en pixels depuis dvrPaintTimeline. */

        .tp9dvr-seek-wrap {

            position: relative;

            flex: 1 1 auto;

            min-width: 60px;

            display: flex;

            align-items: center;

        }

        .tp9dvr input.tp9dvr-seek {

            width: 100%;

            margin: 0;

        }

        .tp9dvr input.tp9dvr-seek::-webkit-slider-runnable-track {

            background: rgba(255,255,255,.16);

        }

        .tp9dvr input.tp9dvr-seek::-moz-range-track {

            background: rgba(255,255,255,.16);

        }

        /* Invisible, mais toujours là : c'est elle qui reçoit la
           souris, et la rétrécir rendrait la barre difficile à
           attraper. */

        .tp9dvr input.tp9dvr-seek::-webkit-slider-thumb {

            background: transparent;

        }

        .tp9dvr input.tp9dvr-seek::-moz-range-thumb {

            background: transparent;

        }

        .tp9dvr-seek-paint {

            position: absolute;

            left: 0;
            right: 0;
            top: 50%;

            height: 14px;

            transform: translateY(-50%);

            pointer-events: none;

        }

        .tp9dvr-zone {

            position: absolute;

            top: 50%;

            height: 4px;

            border-radius: 2px;

            transform: translateY(-50%);

        }

        .tp9dvr-zone-buf {

            background: rgba(145,71,255,.95);

        }

        .tp9dvr-zone-vod {

            background: rgba(59,130,246,.8);

        }

        /* Le repère de lecture : un trait fin plutôt qu'une bille,
           pour ne plus recouvrir ce qu'il désigne. */

        .tp9dvr-head {

            position: absolute;

            top: 50%;

            width: 4px;

            height: 14px;

            margin-left: -2px;

            border-radius: 2px;

            background: #fff;

            box-shadow: 0 0 5px rgba(0,0,0,.6);

            transform: translateY(-50%);

        }

        /* Rien à rejouer : la barre s'en va pour de bon.

           La laisser en place mais inerte promettait un passé
           qui n'existe pas : on voyait une piste, on cliquait
           dedans, rien ne bougeait. Elle disparaît donc — mais
           le CADRE, lui, reste : il porte la largeur (flex: 1)
           et l'infobulle, si bien qu'aucune commande de la
           barre ne bouge d'un pixel quand la piste revient.

           À sa place, une seule chose a quelque chose à dire :
           la mémoire en train de se remplir. Sans VOD ni
           mémoire armée, la place est tenue et rien n'est
           écrit — un message permanent là où il n'y a rien à
           attendre ne ferait que du bruit. */

        .tp9dvr-seek-off input.tp9dvr-seek,
        .tp9dvr-seek-off .tp9dvr-seek-paint {

            display: none;

        }

        .tp9dvr-seek-wait {

            position: absolute;

            left: 0;
            right: 0;
            top: 50%;

            transform: translateY(-50%);

            display: none;

            align-items: center;

            gap: 8px;

            pointer-events: none;

        }

        .tp9dvr-seek-waiting .tp9dvr-seek-wait {

            display: flex;

        }

        /* Le même trait de 4 px que la piste qu'il remplace :
           ce qui revient à sa place ne doit pas avoir l'air
           d'autre chose. */

        .tp9dvr-seek-wait-track {

            position: relative;

            flex: 0 0 auto;

            width: 56px;

            height: 4px;

            border-radius: 2px;

            background: rgba(255,255,255,.16);

            overflow: hidden;

        }

        .tp9dvr-seek-wait-fill {

            position: absolute;

            left: 0;
            top: 0;
            bottom: 0;

            width: 0;

            border-radius: 2px;

            background: rgba(145,71,255,.95);

            transition: width .4s linear;

        }

        .tp9dvr-seek-wait-text {

            min-width: 0;

            color: rgba(255,255,255,.5);

            font-size: 10.5px;

            font-variant-numeric: tabular-nums;

            white-space: nowrap;

            overflow: hidden;

            text-overflow: ellipsis;

        }

        @media (prefers-reduced-motion: reduce) {

            .tp9dvr-seek-wait-fill {

                transition: none;

            }

        }


        /* =====================================================
           ÉTAT DU BOUTON SOUS LE LECTEUR
           =====================================================

           Vert quand le lecteur perso est ouvert, gris sinon :
           l'état se lit d'un coup d'œil, sans survoler et sans
           ouvrir le menu. */

        #tp9-dvr-button {

            color: rgba(239,239,241,.62);

        }

        #tp9-dvr-button:hover {

            color: #fff;

        }

        #tp9-dvr-button.tp9-dvr-armed {

            color: #00e07a;

        }

        #tp9-dvr-button.tp9-dvr-armed:hover {

            color: #5dffb4;

        }


        /* =====================================================
           MENU DE QUALITÉ
           =====================================================

           Posé au-dessus de la barre, jamais dedans : elle est
           déjà pleine, et un menu qui pousse les commandes
           déplacerait le bouton sous le curseur au moment du
           clic. */

        .tp9dvr-menu {

            position: absolute;

            right: 12px;

            bottom: 58px;

            z-index: 4;

            min-width: 128px;

            max-height: 244px;

            overflow-y: auto;

            box-sizing: border-box;

            padding: 6px;

            border-radius: 10px;

            border: 1px solid rgba(255,255,255,.12);

            background: rgba(14,14,18,.97);

            box-shadow: 0 12px 32px rgba(0,0,0,.55);

            display: none;

            flex-direction: column;

            gap: 2px;

        }

        /* En mode direct l'habillage est en pointer-events: none
           pour laisser passer les clics vers Twitch : le menu, lui,
           doit les recevoir. */

        .tp9dvr-menu.tp9dvr-menu-on {

            display: flex;

            pointer-events: auto;

        }

        .tp9dvr-menu button {

            appearance: none;
            -webkit-appearance: none;

            border: 0;

            background: transparent;

            color: rgba(255,255,255,.82);

            font: inherit;

            font-size: 12.5px;

            text-align: left;

            padding: 7px 10px;

            border-radius: 7px;

            cursor: pointer;

        }

        .tp9dvr-menu button:hover {

            background: rgba(255,255,255,.1);

            color: #fff;

        }

        .tp9dvr-menu button.tp9dvr-menu-active {

            background: rgba(145,71,255,.3);

            color: #fff;

            font-weight: 700;

        }

        /* Le bouton porte du texte et non un tracé : il lui faut
           de la largeur, et pas la boîte carrée des autres. */

        /* =====================================================
           RÉGLAGES DU RETOUR ARRIÈRE
           -----------------------------------------------------
           Même panneau que le menu de qualité — mêmes coins, même
           fond, même placement au-dessus de son bouton — mais il
           contient des réglages et non une liste de choix, d'où
           des lignes plutôt que des boutons.
        ===================================================== */

        .tp9dvr-settings-menu {

            right: auto;

            min-width: 266px;

            max-width: 310px;

            max-height: 340px;

            padding: 10px 12px 12px;

            gap: 9px;

        }

        .tp9dvr-set-head {

            color: rgba(255,255,255,.5);

            font-size: 10px;

            font-weight: 700;

            letter-spacing: .08em;

            text-transform: uppercase;

        }

        .tp9dvr-set-row {

            display: flex;

            align-items: center;

            justify-content: space-between;

            gap: 10px;

            padding: 7px 9px;

            border-radius: 8px;

            background: rgba(255,255,255,.05);

            cursor: pointer;

            transition: background-color .12s ease;

        }

        .tp9dvr-set-row:hover {

            background: rgba(255,255,255,.1);

        }

        .tp9dvr-set-label {

            min-width: 0;

            color: #efeff1;

            font-size: 12.5px;

            font-weight: 600;

            white-space: nowrap;

            overflow: hidden;

            text-overflow: ellipsis;

        }

        .tp9dvr-set-switch {

            position: relative;

            flex: none;

            width: 34px;

            height: 20px;

        }

        .tp9dvr-set-switch input {

            position: absolute;

            width: 0;

            height: 0;

            opacity: 0;

        }

        .tp9dvr-set-track {

            position: absolute;

            inset: 0;

            border-radius: 999px;

            background: rgba(255,255,255,.18);

            transition: background-color .15s ease;

        }

        .tp9dvr-set-track::before {

            content: '';

            position: absolute;

            top: 2px;

            left: 2px;

            width: 16px;

            height: 16px;

            border-radius: 50%;

            background: #ccc;

            transition:
                transform .15s ease,
                background-color .15s ease;

        }

        .tp9dvr-set-switch input:checked + .tp9dvr-set-track {

            background: linear-gradient(135deg, #a970ff, #772ce8);

        }

        .tp9dvr-set-switch input:checked + .tp9dvr-set-track::before {

            transform: translateX(14px);

            background: #fff;

        }

        .tp9dvr-set-switch input:disabled + .tp9dvr-set-track {

            opacity: .35;

        }

        .tp9dvr-set-block {

            padding: 8px 10px 10px;

            border-radius: 8px;

            background: rgba(255,255,255,.05);

        }

        /* Chaîne non armée : le curseur ne pilote rien pour
           l'instant, il doit le montrer plutôt que de laisser
           croire à un réglage actif. */

        .tp9dvr-set-block.tp9dvr-set-idle {

            opacity: .5;

        }

        .tp9dvr-set-line {

            display: flex;

            align-items: baseline;

            justify-content: space-between;

            gap: 8px;

            margin-bottom: 8px;

        }

        .tp9dvr-set-value {

            flex: none;

            color: #fff;

            font-size: 12px;

            font-weight: 700;

            font-variant-numeric: tabular-nums;

        }

        .tp9dvr input.tp9dvr-set-range {

            width: 100%;

            height: 4px;

            border-radius: 2px;

            background: rgba(255,255,255,.2);

        }

        .tp9dvr-set-hint {

            margin-top: 8px;

            color: rgba(255,255,255,.45);

            font-size: 10.5px;

            line-height: 1.4;

        }

        /* L'état, pas le réglage : ce que la mémoire et le VOD ont
           réellement à rejouer en ce moment. */

        .tp9dvr-set-foot {

            color: rgba(255,255,255,.4);

            font-size: 10.5px;

            line-height: 1.4;

        }

        .tp9dvr-set-foot:empty {

            display: none;

        }

        .tp9dvr-settings-menu select {

            flex: none;

            max-width: 136px;

            padding: 5px 7px;

            border: 1px solid rgba(255,255,255,.14);

            border-radius: 7px;

            background: #17171c;

            color: #efeff1;

            font: inherit;

            font-size: 11.5px;

            cursor: pointer;

            color-scheme: dark;

        }


        /* =====================================================
           ÉTAT DE LA MÉMOIRE, AU-DESSUS DE LA TIMELINE
           -----------------------------------------------------
           Il vivait dans le panneau de réglages : il fallait
           ouvrir un menu pour lire une valeur qui bouge à la
           seconde. Une ligne discrète au-dessus des commandes se
           lit sans rien ouvrir — et ne prend aucune place quand
           elle n'a rien à dire (:empty).

           La barre passe donc en colonne : la ligne d'état en
           haut, la rangée de commandes en dessous.
        ===================================================== */

        .tp9dvr-bar {

            flex-direction: column;

            align-items: stretch;

            gap: 3px;

            /* La ligne d etat prend la place que le degrade
               occupait en haut de la barre. */

            padding-top: 16px;

        }

        .tp9dvr-row {

            display: flex;

            align-items: center;

            gap: 8px;

        }

        .tp9dvr-meta {

            padding: 0 2px;

            color: rgba(255,255,255,.5);

            font-size: 10.5px;

            line-height: 1.3;

            font-variant-numeric: tabular-nums;

            white-space: nowrap;

            overflow: hidden;

            text-overflow: ellipsis;

        }

        .tp9dvr-meta:empty {

            display: none;

        }


        /* =====================================================
           LES COMMANDES DE TWITCH, DERRIÈRE LES NÔTRES
           -----------------------------------------------------
           En mode direct notre habillage laisse passer les clics,
           et la barre de Twitch continuait donc d'apparaître
           dessous : deux rangées de boutons décalées, dont une
           qu'on ne pouvait pas atteindre. On la masque tant que
           le lecteur perso est ouvert.

           « visibility » et non « display » ou « opacity » : elle
           s'hérite, donc un menu que Twitch déplie DANS cette
           zone peut la rétablir pour lui seul — c'est ce qui
           laisse le bouton « Qualité » du direct ouvrir le
           réglage de Twitch. Et un élément invisible reste
           cliquable par script, donc nos boutons clip / cinéma /
           plein écran continuent d'emprunter les siens.
        ===================================================== */

        body.tp9dvr-open [data-a-target="player-controls"],
        body.tp9dvr-open .player-controls {

            visibility: hidden !important;

        }

        body.tp9dvr-open [data-a-target="player-settings-menu"],
        body.tp9dvr-open .tw-balloon,
        body.tp9dvr-open [role="dialog"] {

            visibility: visible !important;

        }


        .tp9dvr-btn.tp9dvr-quality {

            width: auto;

            min-width: 54px;

            padding: 0 9px;

            font-size: 11.5px;

            font-weight: 700;

            letter-spacing: .02em;

            white-space: nowrap;

        }


        /* =====================================================
           VOLUME : LA PARTIE REMPLIE SE VOIT
           -----------------------------------------------------
           La piste était grise d'un bout à l'autre : sur 68 px,
           seule la position de la pastille disait où on en était,
           et il fallait la chercher. Le remplissage le dit d'un
           coup d'œil.

           Peint sur l'input lui-même et non sur la piste : Webkit
           et Firefox ne nomment pas la leur pareil, et tous deux
           laissent voir le fond de l'input à travers. La borne
           arrive en pourcentage depuis dvrPushVolume.
        ===================================================== */

        .tp9dvr input.tp9dvr-vol {

            background:
                linear-gradient(
                    to right,
                    #9147ff 0,
                    #9147ff var(--tp9dvr-vol, 100%),
                    rgba(255,255,255,.28) var(--tp9dvr-vol, 100%),
                    rgba(255,255,255,.28) 100%
                );

        }


        /* Réglage sans objet ici (la mémoire là où un VOD fait
           mieux) : il reste à sa place et cesse de faire semblant,
           comme les commandes sans objet de la barre. */

        .tp9dvr-set-row.tp9dvr-set-row-off {

            opacity: .45;

            cursor: default;

        }

        .tp9dvr-set-row.tp9dvr-set-row-off:hover {

            background: rgba(255,255,255,.05);

        }

    `;


    // ============================================================
    // RETOUR ARRIÈRE (DVR)
    // ============================================================
    //
    // Un seul lecteur, deux sources :
    //
    //   mémoire — les segments que le Worker garde pour CETTE
    //             chaîne, quand elle a été armée dans le menu.
    //             Marche partout, profondeur = ce qui a été
    //             enregistré depuis qu'on l'a armée.
    //
    //   VOD     — l'enregistrement que Twitch fabrique en parallèle
    //             du live, quand le streamer l'a activé. Profondeur
    //             = tout le stream, zéro mémoire, mais une
    //             quinzaine de secondes de retard : il n'a pas
    //             encore la toute fin.
    //
    // La source la plus proche du direct gagne. Le VOD ne remplace
    // donc jamais la mémoire, il prolonge ce qu'elle ne couvre pas.


    var dvrSegments = [];
    var dvrSegmentsChannel = null;
    var dvrSegmentsSpan = 0;

    // Octets réellement retenus par le Worker, qu'il annonce avec
    // chaque segment. Une estimation dit ce que ça VA coûter ; ça,
    // c'est ce que ça coûte.
    var dvrSegmentsBytes = 0;

    // Heure murale du segment le plus récent reçu. La mémoire ne
    // s'arrête plus forcément au direct : mettre le lecteur Twitch
    // en pause gèle aussi ce qu'elle enregistre, et sans cette date
    // on rejouait un décalage de toute la durée de la pause.
    var dvrSegmentsEndWall = 0;

    var dvrOverlay = null;
    var dvrVideo = null;
    var dvrHls = null;
    var dvrButton = null;

    var dvrChannelInUse = null;
    var dvrSourceKind = null;

    // Heure murale correspondant à l'instant 0 de la source en
    // cours. C'est la seule chose à connaître pour convertir une
    // position de lecture en « il y a X secondes », et elle rend les
    // deux sources interchangeables.
    var dvrSourceStartWall = 0;

    var dvrPlaylistUrl = null;
    var dvrLiveVideo = null;
    var dvrTicker = null;
    var dvrScrubbing = false;
    var dvrSwitching = false;

    // Instant du gel quand on met le DIRECT en pause, 0 sinon.
    // C'est lui qui dit où reprendre : la reprise ne repart pas au
    // direct, elle repart de là.
    var dvrLivePauseAt = 0;

    // Pause demandée pour une source encore en cours de chargement :
    // hls.js ne sait pas démarrer figé, il faut attendre le manifest.
    var dvrPendingPause = false;

    // Niveau choisi (jamais 0 : couper le son est une coupure, pas
    // un niveau) et coupure. Voir dvrPushVolume.
    //
    // Retenus sur le disque, parce que le volume de Twitch ne le
    // fait pas pour nous : il n'enregistre que ce qu'on règle dans
    // SES commandes à lui. Régler 5 % dans notre barre, puis
    // recharger ou changer de chaîne, et tout repartait à ce que
    // Twitch avait retenu de son côté.
    var DVR_VOLUME_KEY = 'twitchProxyDvrVolumeV1';

    // `known` dit si un niveau a DÉJÀ été choisi dans notre barre :
    // tant que non, c'est celui du lecteur Twitch qui fait foi à
    // l'ouverture (voir openDvr).
    function loadDvrVolume() {

        try {

            var saved =
                JSON.parse(localStorage.getItem(DVR_VOLUME_KEY));

            if (
                saved &&
                typeof saved.level === 'number' &&
                saved.level > 0 &&
                saved.level <= 1
            ) {

                return {
                    level: saved.level,
                    muted: !!saved.muted,
                    known: true
                };

            }

        } catch (e) {}

        return { level: 0.5, muted: false, known: false };

    }

    var dvrVolumeSaved = loadDvrVolume();

    var dvrVolumeLevel = dvrVolumeSaved.level;
    var dvrVolumeMuted = dvrVolumeSaved.muted;
    var dvrVolumeKnown = dvrVolumeSaved.known;

    // ------------------------------------------------------------
    // LE VOLUME SUIT D'UN STREAM À L'AUTRE
    // ------------------------------------------------------------
    //
    // Notre niveau est retenu sur le disque et imposé aux deux
    // lecteurs. Seulement Twitch garde AUSSI le sien de son côté, et
    // il le réapplique à son lecteur quelques secondes après un
    // changement de chaîne — donc APRÈS nous. Le stream repartait
    // alors au volume de Twitch, et pire : dvrSyncVolumeFromPlayer
    // prenait cette restauration pour un réglage de l'utilisateur et
    // l'adoptait, effaçant le nôtre pour de bon.
    //
    // Deux réponses, qui se complètent :
    //
    //   - on écrit notre niveau dans le réglage de Twitch lui-même,
    //     pour que ce qu'il restaure SOIT déjà le nôtre ;
    //   - et pendant quelques secondes après un changement de chaîne
    //     ou un remplacement de lecteur, on IMPOSE au lieu d'adopter,
    //     le temps que sa restauration ait eu lieu.

    var TWITCH_VOLUME_KEY = 'video-volume';
    var TWITCH_MUTED_KEY = 'video-muted';

    // Les clés de Twitch ne nous appartiennent pas : on ne les
    // réécrit que dans le format qu'on y trouve déjà, et jamais
    // celle qu'on n'a pas vue. Au pire on n'écrit rien, et la
    // fenêtre de garde ci-dessous suffit.
    function dvrMirrorVolumeToTwitch() {

        try {

            var savedLevel = localStorage.getItem(TWITCH_VOLUME_KEY);

            if (
                savedLevel === null ||
                /^[0-9.]+$/.test(savedLevel.trim())
            ) {

                localStorage.setItem(
                    TWITCH_VOLUME_KEY,
                    String(dvrVolumeLevel)
                );

            }

            var savedMuted = localStorage.getItem(TWITCH_MUTED_KEY);

            if (savedMuted === null) {
                return;
            }

            var parsed = null;

            try {
                parsed = JSON.parse(savedMuted);
            } catch (e) {
                return;
            }

            if (typeof parsed === 'boolean') {

                localStorage.setItem(
                    TWITCH_MUTED_KEY,
                    String(dvrVolumeMuted)
                );

                return;

            }

            if (parsed && typeof parsed === 'object') {

                parsed.default = dvrVolumeMuted;

                localStorage.setItem(
                    TWITCH_MUTED_KEY,
                    JSON.stringify(parsed)
                );

            }

        } catch (e) {}

    }

    // Fenêtre pendant laquelle NOTRE niveau l'emporte sur ce que le
    // lecteur Twitch affiche : sa restauration arrive après la
    // nôtre, et il ne faut surtout pas la prendre pour un réglage.
    var DVR_VOLUME_GUARD_MS = 6000;

    var dvrVolumeGuardUntil = 0;

    function dvrArmVolumeGuard() {

        dvrVolumeGuardUntil = Date.now() + DVR_VOLUME_GUARD_MS;

    }

    function dvrVolumeGuarded() {

        return Date.now() < dvrVolumeGuardUntil;

    }

    function dvrVolumeDrifted(video) {

        return (
            Math.abs((video.volume || 0) - dvrVolumeLevel) > 0.005 ||
            !!video.muted !== dvrVolumeMuted
        );

    }

    // Groupé : la molette part à chaque cran, écrire le localStorage
    // à chaque pour cent n'aurait aucun intérêt.
    var dvrVolumeSaveTimer = null;

    function saveDvrVolume() {

        dvrVolumeKnown = true;

        if (dvrVolumeSaveTimer) {
            return;
        }

        dvrVolumeSaveTimer = setTimeout(
            function () {

                dvrVolumeSaveTimer = null;

                try {

                    localStorage.setItem(
                        DVR_VOLUME_KEY,
                        JSON.stringify({
                            level: dvrVolumeLevel,
                            muted: dvrVolumeMuted
                        })
                    );

                } catch (e) {}

                dvrMirrorVolumeToTwitch();

            },
            400
        );

    }

    // Fenêtre pendant laquelle la barre reste affichée quoi qu'en
    // dise celle de Twitch (réglage du volume à la molette).
    var dvrBarForcedUntil = 0;

    // Délai avant que la barre ne s'efface, une fois la souris
    // sortie du lecteur. Twitch prend 3 s sur la sienne ; un peu
    // moins ici, la nôtre est posée PAR-DESSUS l'image.
    var DVR_BAR_HIDE_MS = 2500;

    var dvrBarTimer = null;
    var dvrBarHovered = false;
    var dvrPointerWatcher = null;

    // Renseigne avec la chaîne dont le flux ne peut pas être
    // rejoué depuis la mémoire (fMP4). Stocker la chaîne plutôt
    // qu'un booléen évite d'avoir à penser à le remettre à zéro.
    var dvrUnsupportedChannel = null;

    var dvrVodCache = {};
    var dvrVodInFlight = {};

    // Durée de vie du seul fait qui bouge : « cette chaîne a-t-elle
    // un enregistrement en cours ». L'ACCÈS à cet enregistrement,
    // lui, est mis en cache par VOD et sans péremption.
    var DVR_VOD_TTL_MS = 120000;

    // Le VOD traîne derrière le direct. Mesuré autour de 15 s sur un
    // vrai live ; on prend une marge pour ne jamais demander un
    // segment qui n'existe pas encore.
    var DVR_VOD_LAG_SECONDS = 25;


    function dvrHlsLib() {

        try {

            if (
                typeof Hls !== 'undefined' &&
                Hls
            ) {
                return Hls;
            }

        } catch (e) {}

        return window.Hls || null;

    }


    function dvrSupported() {

        var lib = dvrHlsLib();

        return !!(
            lib &&
            lib.isSupported &&
            lib.isSupported()
        );

    }


    // ------------------------------------------------------------
    // Armement par chaîne
    // ------------------------------------------------------------
    //
    // Le buffer coûte de la mémoire en permanence : il ne s'arme que
    // là où on l'a demandé, jamais sur tout ce qu'on regarde.

    function isDvrChannelArmed(channel) {

        return !!(
            channel &&
            pageConfig.dvrChannels &&
            pageConfig.dvrChannels[channel]
        );

    }


    function setDvrChannelArmed(channel, armed) {

        if (!channel) {
            return;
        }

        if (!pageConfig.dvrChannels) {
            pageConfig.dvrChannels = {};
        }

        if (armed) {

            pageConfig.dvrChannels[channel] = true;

        } else {

            delete pageConfig.dvrChannels[channel];

            // Même si la mémoire porte une autre chaîne : rien ne
            // doit rester en RAM une fois l'option décochée.
            dvrForgetMemory();

        }

        saveConfig(pageConfig);

        broadcastConfig();

        positionDvrButton();

    }


    // Toute la source « mémoire » repose sur des Blob créés DANS
    // le Worker : rien ne garantit a priori qu'une URL de Blob
    // fabriquée là soit lisible depuis la page. On le vérifie une
    // fois, sur le premier segment reçu, au lieu de le découvrir
    // par un échec de lecture qui ne dirait pas d'où il vient.
    //
    //   null      — pas encore su',
    //   'pending' — vérification en cours
    //   true      — lisible
    //   false     — illisible, la mémoire cesse alors de compter
    var dvrBlobProbe = null;

    // Détail de la dernière erreur fatale de hls.js, repris dans
    // le message affiché : « Lecture impossible » tout court
    // ne permet de diagnostiquer quoi que ce soit.
    var dvrLastErrorDetail = null;


    function dvrProbeBlobAccess(url) {

        if (dvrBlobProbe !== null || !url) {
            return;
        }

        dvrBlobProbe = 'pending';

        fetch(url)
            .then(function (response) {

                dvrBlobProbe = !!response.ok;

                if (dvrBlobProbe) {

                    console.log(
                        '[TwitchProxy][DVR] Mémoire du Worker lisible depuis la page'
                    );

                    return;

                }

                dvrReportBlobFailure(response.status);

            })
            .catch(function (error) {

                dvrBlobProbe = false;

                dvrReportBlobFailure(error);

            });

    }


    function dvrReportBlobFailure(reason) {

        console.warn(
            '[TwitchProxy][DVR] Les segments gardés par le Worker ne sont pas lisibles depuis la page :',
            reason
        );

        logEvent(
            'error',
            'Retour arrière : la mémoire du Worker est inaccessible, seul le VOD reste utilisable'
        );

        positionDvrButton();

    }


    function dvrResetSegments() {

        dvrSegments = [];
        dvrSegmentsSpan = 0;
        dvrSegmentsBytes = 0;
        dvrSegmentsEndWall = 0;
        dvrSegmentsChannel = null;

    }


    // Le Worker n'envoie que l'URL d'un Blob, jamais les octets : un
    // ArrayBuffer en BroadcastChannel serait recopié dans tous les
    // onglets twitch.tv ouverts.
    function recordDvrSegment(data) {

        dvrProbeBlobAccess(data.url);

        if (data.channel !== dvrSegmentsChannel) {

            dvrResetSegments();

            dvrSegmentsChannel = data.channel;

        }

        // Deux segments peuvent arriver dans le désordre : on les
        // range par numéro, sinon le playlist reconstruit ferait
        // sauter la lecture.
        var at = dvrSegments.length;

        while (
            at > 0 &&
            dvrSegments[at - 1].seq > data.seq
        ) {
            at--;
        }

        dvrSegments.splice(
            at,
            0,
            {
                url: data.url,
                dur: data.duration,
                seq: data.seq,
                variant: data.variant || ''
            }
        );

        dvrSegmentsSpan += data.duration;

        if (typeof data.bytes === 'number') {
            dvrSegmentsBytes = data.bytes;
        }

        dvrSegmentsEndWall = Date.now();

        // Filet de sécurité : la liste de la page ne vit que des
        // messages « dvrDrop » du Worker pour se vider. Un message
        // perdu et elle grandirait sans fin, en référençant des Blob
        // révoqués depuis longtemps. Trois fois la profondeur
        // demandée ne peut pas arriver normalement.
        var cap =
            (
                pageConfig.dvrBufferSeconds ||
                DEFAULT_DVR_BUFFER_SECONDS
            ) * 3;

        while (
            dvrSegments.length > 1 &&
            dvrSegmentsSpan > cap
        ) {

            var extra = dvrSegments.shift();

            dvrSegmentsSpan -= extra.dur;

        }

        positionDvrButton();

    }


    // Le Worker a révoqué ces Blob de son côté : on suit, sinon on
    // référencerait des URL mortes — et hls.js n'y verrait pas une
    // erreur réseau mais un fragment illisible (fragParsingError).
    function dropDvrSegments(data) {

        if (data.clear) {

            dvrResetSegments();

            positionDvrButton();

            return;

        }

        for (var i = 0; i < (data.count || 0); i++) {

            var gone = dvrSegments.shift();

            if (gone) {
                dvrSegmentsSpan -= gone.dur;
            }

        }

        if (typeof data.bytes === 'number') {
            dvrSegmentsBytes = data.bytes;
        }

        if (dvrSegmentsSpan < 0) {
            dvrSegmentsSpan = 0;
        }

        positionDvrButton();

    }


    // Retenu ici parce que le Worker relit `hold` à CHAQUE message
    // de contrôle : l'oublier dans dvrSendCapture relâcherait la
    // rétention au beau milieu d'une lecture du passé.
    var dvrHoldOn = false;


    // Tant que le lecteur de passé est ouvert, le Worker doit cesser
    // d'expirer ses segments : révoquer un Blob en cours de lecture
    // couperait l'image.
    function dvrSendHold(hold) {

        dvrHoldOn = !!hold;

        if (!configChannel) {
            return;
        }

        try {

            configChannel.postMessage({
                type: 'dvrControl',
                tabId: TAB_ID,
                hold: dvrHoldOn
            });

        } catch (e) {}

    }


    // Coupe la capture sans toucher à l'armement : l'armement est le
    // choix de l'utilisateur, la capture est ce qu'on en fait ici et
    // maintenant. Voir syncDvrMemorySuppression.
    function dvrSendCapture(on) {

        if (!configChannel) {
            return;
        }

        try {

            configChannel.postMessage({
                type: 'dvrControl',
                tabId: TAB_ID,
                hold: dvrHoldOn,
                capture: !!on
            });

        } catch (e) {}

    }


    // ------------------------------------------------------------
    // LÀ OÙ IL Y A UN VOD, LA MÉMOIRE NE SERT À RIEN
    // ------------------------------------------------------------
    //
    // Le VOD remonte à tout le stream et ne coûte pas un octet de
    // RAM ; la mémoire garde quelques minutes et en mange en
    // permanence. Les deux ensemble, c'est payer pour un passé qu'on
    // a déjà — la seule chose que le VOD ne sache pas servir, ce
    // sont ses dernières secondes (DVR_VOD_LAG_SECONDS), et
    // dvrGoToOffset s'y recale tout seul.
    //
    // On coupe donc la capture au lieu de désarmer : le VOD
    // disparaît avec le stream, et l'armement doit alors reprendre
    // tout seul sans que l'utilisateur ait à y repenser.

    function dvrMemoryBlocked(channel) {

        return !!(channel && dvrVodInfoFor(channel));

    }


    var dvrMemorySuppressed = null;

    function syncDvrMemorySuppression() {

        var channel = getTestChannel();

        var blocked = dvrMemoryBlocked(channel);

        if (blocked === dvrMemorySuppressed) {
            return;
        }

        // Le VOD peut être résolu en pleine lecture depuis la
        // mémoire : vider les Blob à cet instant couperait l'image.
        // On repassera au tick suivant, une fois revenu au direct.
        if (blocked && dvrOverlay && dvrSourceKind === 'buffer') {
            return;
        }

        dvrMemorySuppressed = blocked;

        dvrSendCapture(!blocked);

        if (blocked) {

            dvrResetSegments();

        }

        // Les deux surfaces portent le même interrupteur : il doit
        // se griser des deux côtés, et dire pourquoi.
        if (dashboard) {
            renderDashboardSettings();
        }

        if (dvrOverlay) {
            dvrRenderSettingsMenu();
        }

    }


    // Les segments ne vivent PAS dans la page : ce sont des Blob
    // créés dans le Worker, et seul le Worker peut les révoquer.
    // Vider la liste ici ne rendait donc pas un octet de mémoire —
    // il faut le lui dire. Quitter la chaîne, désarmer l'option ou
    // fermer l'onglet passent maintenant tous par ici.
    function dvrSendClear() {

        if (!configChannel) {
            return;
        }

        try {

            configChannel.postMessage({
                type: 'dvrControl',
                tabId: TAB_ID,
                hold: false,
                clear: true
            });

        } catch (e) {}

    }


    function dvrForgetMemory() {

        dvrResetSegments();

        dvrSendClear();

    }


    // ------------------------------------------------------------
    // VOD en cours : existence, accès, et contournement sub-only
    // ------------------------------------------------------------
    //
    // Trois états, tranchés AVANT que le bouton ne s'allume. C'est
    // tout l'intérêt : un bouton qui propose une source injouable ne
    // vaut pas mieux qu'un bouton grisé.
    //
    //   'open'    — usher rend le manifest, lecture normale.
    //
    //   'bypass'  — usher répond 403 (VOD réservé aux abonnés), mais
    //               le CDN qui héberge l'enregistrement sert ses
    //               segments SANS jeton, et avec un en-tête CORS qui
    //               autorise explicitement twitch.tv. On récupère le
    //               chemin de stockage via l'URL des vignettes de la
    //               barre de progression, la seule qui le donne.
    //
    //   'blocked' — ni l'un ni l'autre : on fait comme s'il n'y avait
    //               pas de VOD du tout, et la mémoire prend le relais.
    //
    // L'accès est mis en cache PAR VOD et sans péremption : c'est une
    // propriété de l'enregistrement, pas un état passager. Sans ça un
    // VOD refusé repassait en « disponible » à chaque expiration du
    // cache, et le lecteur repartait sur une source dont on savait
    // déjà qu'elle ne marcherait pas.

    var dvrVodAccess = {};
    var dvrVodAccessPending = {};

    // Renditions tentées pour un accès direct, de la meilleure à la
    // plus modeste. 'chunked' est la source : elle existe toujours,
    // les autres ne sont là que pour les vieux enregistrements.
    var DVR_VOD_RENDITIONS = [
        'chunked',
        '720p60',
        '720p30',
        '480p30'
    ];


    // Ne renvoie un VOD que s'il est RÉELLEMENT lisible : tout le
    // reste du module peut donc se contenter de tester sa présence.
    function dvrVodInfoFor(channel) {

        if (!channel) {
            return null;
        }

        var entry = dvrVodCache[channel];

        var fresh =
            entry &&
            (Date.now() - entry.at) < DVR_VOD_TTL_MS;

        if (
            !fresh &&
            !dvrVodInFlight[channel]
        ) {

            fetchDvrVodInfo(channel);

        }

        if (!entry || !entry.id) {
            return null;
        }

        var access = dvrVodAccess[entry.id];

        if (
            !access ||
            !access.url
        ) {
            return null;
        }

        return {
            id: entry.id,
            startWall: entry.startWall,
            url: access.url,
            state: access.state
        };

    }


    // Vrai tant qu'on ne sait pas encore à quoi s'en tenir : le
    // bouton peut le dire au lieu d'annoncer une absence de VOD qui
    // n'est peut-être que de l'attente.
    function dvrVodPendingFor(channel) {

        if (!channel) {
            return false;
        }

        if (dvrVodInFlight[channel]) {
            return true;
        }

        var entry = dvrVodCache[channel];

        return !!(
            entry &&
            entry.id &&
            dvrVodAccessPending[entry.id]
        );

    }


    function fetchDvrVodInfo(channel) {

        dvrVodInFlight[channel] = true;

        dvrGql(
            'query($login:String!){user(login:$login){stream{id createdAt archiveVideo{id}}}}',
            { login: channel },
            function (json) {

                var stream =
                    json &&
                    json.data &&
                    json.data.user &&
                    json.data.user.stream;

                var archive =
                    stream &&
                    stream.archiveVideo;

                var startWall =
                    stream && stream.createdAt
                        ? Date.parse(stream.createdAt)
                        : NaN;

                dvrVodCache[channel] = {
                    at: Date.now(),
                    id:
                        (archive && archive.id && !isNaN(startWall))
                            ? archive.id
                            : null,
                    startWall: startWall
                };

                delete dvrVodInFlight[channel];

                var id = dvrVodCache[channel].id;

                if (
                    id &&
                    !dvrVodAccess[id] &&
                    !dvrVodAccessPending[id]
                ) {

                    resolveDvrVodAccess(id, channel);

                }

                positionDvrButton();

            },
            function () {

                // Échec réseau : on retient l'absence pour ne pas
                // réinterroger en boucle, la péremption relancera.
                dvrVodCache[channel] = {
                    at: Date.now(),
                    id: null,
                    startWall: NaN
                };

                delete dvrVodInFlight[channel];

            }
        );

    }


    // Décide une fois pour toutes par quel chemin ce VOD se lit.
    function resolveDvrVodAccess(id, channel) {

        dvrVodAccessPending[id] = true;

        dvrGql(
            'query($id:ID!){videoPlaybackAccessToken(id:$id,params:{platform:"web",playerBackend:"mediaplayer",playerType:"site"}){value signature}}',
            { id: id },
            function (json) {

                var token =
                    json &&
                    json.data &&
                    json.data.videoPlaybackAccessToken;

                if (
                    token &&
                    token.value &&
                    token.signature &&
                    dvrTokenIsOpen(token.value)
                ) {

                    dvrVodAccess[id] = {
                        state: 'open',
                        url:
                            'https://usher.ttvnw.net/vod/' +
                            encodeURIComponent(id) +
                            '.m3u8?allow_source=true&allow_audio_only=true&player=twitchweb' +
                            '&nauth=' +
                            encodeURIComponent(token.value) +
                            '&nauthsig=' +
                            encodeURIComponent(token.signature)
                    };

                    delete dvrVodAccessPending[id];

                    positionDvrButton();

                    return;

                }

                // Jeton refusé ou bridé : reste le chemin direct.
                dvrResolveBypass(id, channel);

            },
            function () {

                dvrResolveBypass(id, channel);

            }
        );

    }


    // Le jeton dit lui-même ce à quoi on n'a pas droit :
    // `restricted_bitrates` énumère les qualités refusées, et il les
    // liste TOUTES quand le VOD est réservé aux abonnés.
    function dvrTokenIsOpen(value) {

        try {

            var parsed = JSON.parse(value);

            if (
                parsed &&
                parsed.authorization &&
                parsed.authorization.forbidden
            ) {
                return false;
            }

            var restricted =
                parsed &&
                parsed.chansub &&
                parsed.chansub.restricted_bitrates;

            return !(restricted && restricted.length);

        } catch (e) {

            return false;

        }

    }


    // L'URL des vignettes de la barre de progression est la seule
    // qui expose le chemin de stockage de l'enregistrement — son
    // préfixe contient une empreinte aléatoire, impossible à
    // deviner autrement.
    function dvrResolveBypass(id, channel) {

        dvrGql(
            'query($id:ID!){video(id:$id){seekPreviewsURL}}',
            { id: id },
            function (json) {

                var previews =
                    json &&
                    json.data &&
                    json.data.video &&
                    json.data.video.seekPreviewsURL;

                var cut =
                    previews
                        ? previews.indexOf('/storyboards/')
                        : -1;

                if (cut < 0) {

                    dvrMarkVodBlocked(id);

                    return;

                }

                dvrProbeRenditions(
                    previews.substring(0, cut),
                    0,
                    id
                );

            },
            function () {

                dvrMarkVodBlocked(id);

            }
        );

    }


    function dvrProbeRenditions(base, index, id) {

        if (index >= DVR_VOD_RENDITIONS.length) {

            dvrMarkVodBlocked(id);

            return;

        }

        var url =
            base + '/' + DVR_VOD_RENDITIONS[index] + '/index-dvr.m3u8';

        fetch(url, { method: 'GET' })
            .then(function (response) {

                if (!response.ok) {

                    dvrProbeRenditions(base, index + 1, id);

                    return;

                }

                dvrVodAccess[id] = {
                    state: 'bypass',
                    url: url
                };

                delete dvrVodAccessPending[id];

                positionDvrButton();

            })
            .catch(function () {

                dvrProbeRenditions(base, index + 1, id);

            });

    }


    function dvrMarkVodBlocked(id) {

        if (!id) {
            return;
        }

        dvrVodAccess[id] = { state: 'blocked', url: null };

        delete dvrVodAccessPending[id];

        positionDvrButton();

    }


    // Échec constaté pendant la lecture : on condamne ce VOD pour de
    // bon plutôt que de le represcrire au prochain clic.
    function dvrMarkChannelVodBlocked(channel) {

        var entry = channel ? dvrVodCache[channel] : null;

        if (entry && entry.id) {

            dvrMarkVodBlocked(entry.id);

        }

    }


    function dvrGql(query, variables, done, fail) {

        fetch('https://gql.twitch.tv/gql', {

            method: 'POST',

            headers: {
                'Content-Type': 'text/plain;charset=UTF-8',
                'Client-Id': TWITCH_GQL_CLIENT_ID
            },

            body: JSON.stringify({
                query: query,
                variables: variables
            })

        })
            .then(function (response) {
                return response.json();
            })
            .then(done)
            .catch(function () {

                if (fail) {
                    fail();
                }

            });

    }


    function dvrVodDepthSeconds(info) {

        if (!info) {
            return 0;
        }

        var depth =
            (dvrLiveNow() - info.startWall) / 1000;

        return depth > 0 ? depth : 0;

    }


    // ------------------------------------------------------------
    // Profondeur disponible
    // ------------------------------------------------------------

    // Il faut au moins de quoi reculer d'un cran : sous 30 s, la
    // mémoire ne sert à rien — ⟲30 y retomberait aussitôt au
    // direct. Elle ne se présente donc pas comme une source
    // utilisable tant qu'elle n'a pas ça, et c'est ce seuil qui
    // grise le bouton ⏪ sous le lecteur comme le bouton ⟲30.
    var DVR_MIN_BUFFER_SECONDS = 30;


    // Ce que la mémoire contient vraiment, seuil non appliqué :
    // pour les infobulles, qui doivent pouvoir annoncer « 12 s sur
    // les 30 qu'il faut ».
    function dvrBufferRawDepthFor(channel) {

        if (dvrBlobProbe === false) {
            return 0;
        }

        if (
            !channel ||
            dvrUnsupportedChannel === channel ||
            dvrSegmentsChannel !== channel ||
            dvrSegments.length < 2
        ) {
            return 0;
        }

        return dvrSegmentsSpan;

    }


    function dvrBufferDepthFor(channel) {

        var depth = dvrBufferRawDepthFor(channel);

        return depth >= DVR_MIN_BUFFER_SECONDS ? depth : 0;

    }


    // ------------------------------------------------------------
    // HORLOGE DE RÉFÉRENCE
    // ------------------------------------------------------------
    //
    // « Reculer de 30 s », c'est trente secondes avant CE QUI EST À
    // L'ÉCRAN — pas avant l'heure qu'il est. Les deux sont loin l'un
    // de l'autre : le lecteur Twitch garde en permanence plusieurs
    // secondes déjà téléchargées mais pas encore affichées, et c'est
    // exactement ce contenu-là que la mémoire enregistre.
    //
    // Compter les retards depuis Date.now() demandait donc un moment
    // situé APRÈS l'image affichée : le lecteur atterrissait à la
    // toute fin du playlist, jouait deux secondes, tombait sur
    // #EXT-X-ENDLIST et repartait au direct. C'est très exactement
    // « je recule de 30 s et ça me remet au direct », et « plus le
    // buffer avance, plus il faut reculer loin pour que ça charge ».

    var DVR_LIVE_AHEAD_MAX = 120;


    // Ce que le lecteur Twitch a déjà téléchargé mais pas encore
    // montré.
    function dvrLivePlayerAhead() {

        var video = dvrLiveVideo;

        if (!video) {
            return 0;
        }

        try {

            var ranges = video.buffered;

            if (!ranges || !ranges.length) {
                return 0;
            }

            var ahead =
                ranges.end(ranges.length - 1) -
                video.currentTime;

            if (!isFinite(ahead) || ahead < 0) {
                return 0;
            }

            return ahead > DVR_LIVE_AHEAD_MAX
                ? DVR_LIVE_AHEAD_MAX
                : ahead;

        } catch (e) {

            return 0;

        }

    }


    // L'avance du lecteur Twitch varie sans cesse : il bufferise
    // plus ou moins selon le réseau et l'état de l'onglet. Tant
    // qu'on lit le passé, la laisser entrer dans l'horloge faisait
    // DÉRIVER le retard affiché — une avance qui passe de 10 s à
    // 40 s fait tomber un « -30 s » à zéro, et le lecteur repartait
    // au direct tout seul au bout d'un moment. On la fige donc à
    // l'instant où l'on quitte le direct, et on la relâche en y
    // revenant.
    var dvrFrozenAhead = null;

    // Échelle de la barre de position, figée elle aussi tant
    // qu'on lit le passé. Sans ça, elle bougeait à l'instant
    // précis de la bascule (dvrLiveNow change, donc toutes les
    // fenêtres avec) et la pastille sautait alors qu'on n'avait
    // rien demandé de plus qu'un recul de 30 s.
    var dvrFrozenTimelineMax = null;

    function dvrReferenceAhead() {

        if (dvrFrozenAhead !== null && !dvrIsLive()) {
            return dvrFrozenAhead;
        }

        return dvrLivePlayerAhead();

    }


    // Vrai quand la lecture est arrivée au bout de ce que la source
    // contient. C'est un FAIT, contrairement au retard calculé, qui
    // dépend d'une horloge : les deux sont exigés avant de rendre la
    // main au direct.
    function dvrAtEndOfSource() {

        if (!dvrVideo) {
            return false;
        }

        try {

            var ranges = dvrVideo.buffered;

            if (!ranges || !ranges.length) {
                return false;
            }

            return (
                ranges.end(ranges.length - 1) - dvrVideo.currentTime
            ) < 1;

        } catch (e) {

            return false;

        }

    }


    // Heure murale de l'image affichée par le lecteur Twitch.
    // Origine de TOUS les retards, demandés comme affichés.
    function dvrLiveNow() {

        var reference = dvrSegmentsEndWall;

        // Une mémoire figée (lecteur arrêté) ne dit plus où en est le
        // direct : au-delà d'une demi-minute on repasse sur l'horloge,
        // le gel étant compté à part par dvrLivePauseAt.
        if (
            !reference ||
            Date.now() - reference > 30000
        ) {

            reference = Date.now();

        }

        return reference - dvrReferenceAhead() * 1000;

    }


    // ------------------------------------------------------------
    // Fenêtre couverte par chaque source
    // ------------------------------------------------------------
    //
    // En retard sur l'image affichée : « min » = le plus près du
    // direct que la source sache servir, « max » = le plus loin.
    // Demander hors de cette fenêtre, c'est le gel — le lecteur y
    // cherche un moment que la source n'a pas.

    function dvrSourceWindow(kind, channel) {

        if (!channel) {
            channel = dvrChannelInUse;
        }

        var now = dvrLiveNow();

        if (kind === 'buffer') {

            var depth = dvrBufferDepthFor(channel);

            if (depth <= 0) {
                return null;
            }

            // Le segment le plus récent est normalement PLUS FRAIS
            // que l'image affichée : la mémoire part donc de zéro de
            // retard. Elle ne décroche que si le lecteur Twitch a
            // cessé de télécharger.
            var min = (now - dvrSegmentsEndWall) / 1000;

            if (!(min > 0)) {
                min = 0;
            }

            if (min >= depth) {
                return null;
            }

            return {
                min: min,
                max: min + depth
            };

        }

        var info = dvrVodInfoFor(channel);

        if (!info) {
            return null;
        }

        // Le VOD traîne une quinzaine de secondes derrière le direct :
        // il ne sert pas les tout derniers instants, et c'est ce qui
        // gelait un « -10 s » demandé sur lui.
        var vodMin =
            (
                now -
                (Date.now() - DVR_VOD_LAG_SECONDS * 1000)
            ) / 1000;

        if (!(vodMin > 0)) {
            vodMin = 0;
        }

        var vodMax = (now - info.startWall) / 1000;

        if (vodMax <= vodMin + 2) {
            return null;
        }

        return {
            min: vodMin,
            max: vodMax
        };

    }


    function dvrMaxOffsetFor(channel) {

        var buffer = dvrSourceWindow('buffer', channel);

        var vod = dvrSourceWindow('vod', channel);

        var max = 0;

        if (buffer && buffer.max > max) {
            max = buffer.max;
        }

        if (vod && vod.max > max) {
            max = vod.max;
        }

        return max;

    }


    // Le plus près du direct qu'on sache servir, toutes sources
    // confondues. En deçà il n'y a rien à jouer : c'est le lecteur
    // Twitch qui a l'image, et lui seul.
    function dvrMinOffsetFor(channel) {

        var buffer = dvrSourceWindow('buffer', channel);

        var vod = dvrSourceWindow('vod', channel);

        var min = null;

        if (buffer) {
            min = buffer.min;
        }

        if (vod && (min === null || vod.min < min)) {
            min = vod.min;
        }

        return min === null ? 0 : min;

    }


    // Échelle de la barre de position. Sans VOD, elle se cale sur la
    // profondeur DEMANDÉE et non sur ce qui est déjà en mémoire : la
    // zone colorée grandit alors vers la gauche au fur et à mesure du
    // remplissage, ce qui se lit comme une barre de progression au
    // lieu d'une barre toujours pleine.
    function dvrTimelineMax(channel) {

        if (!channel) {
            channel = dvrChannelInUse;
        }

        // Hors direct, l'échelle ne bouge plus : c'est elle qui
        // donne sa place à chaque repère, et la voir changer
        // sous la pastille se lit comme un saut de lecture.
        if (
            dvrFrozenTimelineMax !== null &&
            channel === dvrChannelInUse &&
            !dvrIsLive()
        ) {
            return dvrFrozenTimelineMax;
        }

        var max = dvrMaxOffsetFor(channel);

        if (
            !dvrVodInfoFor(channel) &&
            isDvrChannelArmed(channel)
        ) {

            var target =
                pageConfig.dvrBufferSeconds ||
                DEFAULT_DVR_BUFFER_SECONDS;

            if (target > max) {
                max = target;
            }

        }

        return max;

    }


    // ------------------------------------------------------------
    // Playlist reconstruit à partir de la mémoire
    // ------------------------------------------------------------

    var dvrMemoryPlaylistUrlCache = null;

    function dvrMemoryPlaylistUrl() {

        if (!dvrMemoryPlaylistUrlCache) {

            // Une URL de façade : elle n'est jamais appelée sur le
            // réseau (dvrMemoryLoader répond à sa place), mais
            // hls.js s'en sert comme base pour résoudre l'adresse
            // des segments — d'où une vraie URL absolue.
            dvrMemoryPlaylistUrlCache =
                location.origin + '/tp9dvr-memoire.m3u8';

        }

        return dvrMemoryPlaylistUrlCache;

    }


    // Chargeur de playlist maison, branché sur hls.js à la place de
    // son chargeur réseau (option « pLoader ») pour la seule source
    // mémoire. hls.js relit un playlist vivant toutes les quelques
    // secondes : à chaque relecture, celui-ci le reconstruit à
    // partir des segments actuellement gardés par le Worker.
    function dvrMemoryLoader() {

        this.stats = {
            aborted: false,
            loaded: 0,
            retry: 0,
            total: 0,
            chunkCount: 0,
            bwEstimate: 0,
            loading: { start: 0, first: 0, end: 0 },
            parsing: { start: 0, end: 0 },
            buffering: { start: 0, first: 0, end: 0 }
        };

        this.context = null;
        this.timer = null;

    }

    dvrMemoryLoader.prototype.destroy = function () {

        this.abort();

    };

    dvrMemoryLoader.prototype.abort = function () {

        this.stats.aborted = true;

        if (this.timer) {

            clearTimeout(this.timer);

            this.timer = null;

        }

    };

    // hls.js interroge ces deux-là au rechargement d'un playlist
    // vivant : sans elles, il lèverait sur un chargeur qui ne les
    // expose pas.
    dvrMemoryLoader.prototype.getCacheAge = function () {

        return null;

    };

    dvrMemoryLoader.prototype.getResponseHeader = function () {

        return null;

    };

    dvrMemoryLoader.prototype.load = function (context, config, callbacks) {

        var self = this;

        var stats = this.stats;

        this.context = context;

        stats.aborted = false;

        stats.loading.start = performance.now();

        // Asynchrone volontairement : hls.js suppose qu'un chargeur
        // lui rend la main avant de répondre.
        this.timer = setTimeout(
            function () {

                self.timer = null;

                if (stats.aborted) {
                    return;
                }

                var text = dvrBuildBufferPlaylist();

                stats.loading.first = performance.now();
                stats.loading.end = stats.loading.first;

                stats.loaded = text.length;
                stats.total = text.length;

                try {

                    callbacks.onSuccess(
                        {
                            url: context.url,
                            data: text
                        },
                        stats,
                        context,
                        null
                    );

                } catch (e) {

                    console.warn(
                        '[TwitchProxy][DVR] Playlist mémoire refusé :',
                        e
                    );

                }

            },
            0
        );

    };


    function dvrBuildBufferPlaylist() {

        var target = 2;

        dvrSegments.forEach(
            function (segment) {

                if (segment.dur > target) {
                    target = segment.dur;
                }

            }
        );

        // Surtout pas un playlist VOD terminé par #EXT-X-ENDLIST :
        // c'était une PHOTO de la mémoire à l'instant du clic. Le
        // lecteur arrivait au bout de cette photo au bout de
        // « retard » secondes de lecture et repartait au direct —
        // d'où « ça se coupe » et « ça me remet au direct alors
        // qu'il restait cinq minutes ».
        //
        // C'est maintenant un playlist VIVANT : pas d'ENDLIST, une
        // vraie séquence média, et un chargeur maison
        // (dvrMemoryLoader) qui le RECONSTRUIT chaque fois que
        // hls.js vient le relire. Les segments capturés pendant la
        // lecture s'y ajoutent donc tout seuls, et la lecture peut
        // courir jusqu'au direct sans jamais buter sur une fin.
        var rows = [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-TARGETDURATION:' + Math.ceil(target),
            '#EXT-X-MEDIA-SEQUENCE:' +
                (dvrSegments.length ? dvrSegments[0].seq : 0)
        ];

        // Un changement de qualité en cours de route change la
        // résolution et parfois le codec : sans discontinuité
        // annoncée, le lecteur se bloque à la jointure.
        var previousVariant = null;

        dvrSegments.forEach(
            function (segment) {

                if (
                    previousVariant !== null &&
                    segment.variant !== previousVariant
                ) {

                    rows.push('#EXT-X-DISCONTINUITY');

                }

                previousVariant = segment.variant;

                rows.push(
                    '#EXTINF:' +
                    segment.dur.toFixed(3) +
                    ','
                );

                rows.push(segment.url);

            }
        );

        return rows.join('\n');

    }


    // ------------------------------------------------------------
    // Conversion position de lecture <-> retard sur le direct
    // ------------------------------------------------------------

    function dvrCurrentOffset() {

        // Direct en pause : rien ne joue, mais le direct, lui,
        // continue d'avancer sans nous. Le retard, c'est le temps
        // passé depuis le gel — et c'est exactement là qu'on
        // repartira.
        if (dvrIsLivePaused()) {
            return (Date.now() - dvrLivePauseAt) / 1000;
        }

        // En mode direct notre lecteur ne joue rien : sa position
        // vaut zéro et la convertir donnerait un retard absurde.
        if (dvrIsLive() || !dvrVideo) {
            return 0;
        }

        var offset =
            (
                dvrLiveNow() -
                (
                    dvrSourceStartWall +
                    dvrVideo.currentTime * 1000
                )
            ) / 1000;

        return offset > 0 ? offset : 0;

    }


    // La source est chargée mais n'a pas encore d'image :
    // sa position de lecture ne veut rien dire tant qu'elle
    // n'en a pas une.
    function dvrSourceNotReady() {

        return (
            !dvrVideo ||
            dvrVideo.readyState < 2 ||
            !isFinite(dvrVideo.currentTime)
        );

    }


    // Ce que la barre et l'horloge MONTRENT, qui n'est pas
    // toujours la position calculée.
    //
    // Pendant la seconde que met une source à se charger,
    // dvrSourceStartWall et currentTime ne sont pas encore
    // ceux de la source demandée : le retard calculé part
    // n'importe où, la pastille file à gauche puis revient se
    // caler. C'est tout le « ça fait bizarre » de la bascule.
    //
    // On montre donc le retard DEMANDÉ — celui vers lequel la
    // lecture est en route — jusqu'à ce que la source ait une
    // image à montrer. L'affichage ne recule jamais : il part
    // directement où il va.
    function dvrDisplayOffset(real) {

        if (
            !dvrIsLive() &&
            dvrAimedOffset !== null &&
            (dvrSwitching || dvrSourceNotReady())
        ) {
            return dvrAimedOffset;
        }

        return real;

    }


    function dvrMediaTimeForOffset(offset) {

        return (
            dvrLiveNow() -
            offset * 1000 -
            dvrSourceStartWall
        ) / 1000;

    }


    // « 45 s », « 3 min », « 2 h 10 » : une portée s'annonce
    // autrement qu'une position de lecture.
    function dvrFormatReach(seconds) {

        var total = Math.round(seconds);

        if (total < 90) {
            return total + ' s';
        }

        if (total < 3600) {
            return Math.round(total / 60) + ' min';
        }

        var hours = Math.floor(total / 3600);
        var minutes = Math.round((total % 3600) / 60);

        return minutes
            ? hours + ' h ' + minutes
            : hours + ' h';

    }


    // Le retard survolé, pas celui qu'on joue : on le veut lisible
    // d'un coup d'œil et pas au dixième de seconde près. Plus fin
    // sous les dix minutes, parce qu'un buffer mémoire fait trois
    // minutes en tout et qu'une précision à la minute n'y dirait
    // plus rien.
    function dvrFormatHover(seconds) {

        var total = Math.max(0, Math.round(seconds));

        if (total < 60) {
            return '-' + total + ' s';
        }

        if (total < 600) {

            return (
                '-' + Math.floor(total / 60) + ' min ' +
                (total % 60) + ' s'
            );

        }

        if (total < 3600) {
            return '-' + Math.round(total / 60) + ' min';
        }

        var hours = Math.floor(total / 3600);
        var minutes = Math.round((total % 3600) / 60);

        return minutes
            ? '-' + hours + ' h ' + minutes + ' min'
            : '-' + hours + ' h';

    }


    function dvrFormatOffset(seconds) {

        var total = Math.max(0, Math.round(seconds));

        var hours = Math.floor(total / 3600);
        var minutes = Math.floor((total % 3600) / 60);
        var rest = total % 60;

        var text =
            minutes +
            ':' +
            (rest < 10 ? '0' : '') +
            rest;

        if (hours > 0) {

            text =
                hours +
                ':' +
                (minutes < 10 ? '0' : '') +
                text;

        }

        return '-' + text;

    }


    // ------------------------------------------------------------
    // Ouverture / fermeture
    // ------------------------------------------------------------

    function openDvr(startOffset) {

        if (dvrOverlay) {
            return;
        }

        var channel =
            getWatchedChannel() ||
            getTestChannel();

        if (!channel) {
            return;
        }

        if (!dvrSupported()) {

            alert(
                'Le retour arrière a besoin de hls.js, que Tampermonkey n\'a pas réussi à charger. Recharge la page, ou vérifie que le script a bien le droit de récupérer ses dépendances.'
            );

            return;

        }

        dvrChannelInUse = channel;

        injectDvrCSS();

        // Le lecteur Twitch doit être repéré AVANT que la barre ne
        // se câble : c'est de lui qu'elle prend le volume. L'ordre
        // inverse faisait démarrer le lecteur perso à 100 %.
        dvrFindLivePlayer();

        // Le niveau retenu la dernière fois l'emporte : il suit le
        // lecteur perso d'une chaîne à l'autre et d'un rechargement
        // au suivant. dvrPushVolume, câblé juste après, l'imposera
        // aux deux lecteurs.
        //
        // Tant qu'on n'a jamais touché à notre curseur, en revanche,
        // il n'y a rien à imposer : c'est le son de Twitch qu'on
        // entendait, il devient le nôtre.
        if (!dvrVolumeKnown) {

            dvrAdoptVolumeFrom(dvrLiveVideo);

        }

        dvrBuildOverlay();

        dvrStartTicker();

        // On n'ouvre plus dans le passé : la barre se pose sur le
        // direct, qui continue de jouer sur le lecteur Twitch avec
        // son son. Rien n'est remplacé tant qu'on n'a pas reculé.
        dvrEnterLiveMode();

        // Sauf quand on vient rattraper une pause faite sur le
        // lecteur de Twitch lui-même : voir watchNativeTwitchPause.
        if (startOffset > DVR_LIVE_EDGE_SECONDS) {

            dvrGoToOffset(startOffset);

        }

    }


    function closeDvr() {

        if (!dvrOverlay) {
            return;
        }

        dvrStopTicker();

        dvrUnwatchPointer();

        dvrCloseMenu();

        // Ces trois-là visent des éléments qu'on est en train de
        // retirer : les laisser courir, c'est garder l'habillage
        // vivant jusqu'à leur échéance.
        if (dvrBarTimer) {

            clearTimeout(dvrBarTimer);

            dvrBarTimer = null;

        }

        if (dvrVolumeHintTimer) {

            clearTimeout(dvrVolumeHintTimer);

            dvrVolumeHintTimer = null;

        }

        if (dvrStatusTimer) {

            clearTimeout(dvrStatusTimer);

            dvrStatusTimer = null;

        }

        dvrDestroyPlayback();

        dvrSendHold(false);

        try {
            dvrOverlay.remove();
        } catch (e) {}

        dvrOverlay = null;
        dvrVideo = null;
        dvrSourceKind = null;
        dvrChannelInUse = null;
        dvrLivePauseAt = 0;
        dvrPendingPause = false;

        document.body.classList.remove('tp9dvr-open');

        dvrRestoreLivePlayer();

    }


    function dvrDestroyPlayback() {

        // Le choix de rendu appartient à la source qu'on quitte.
        dvrManualLevel = -1;

        if (dvrHls) {

            try {
                dvrHls.destroy();
            } catch (e) {}

            dvrHls = null;

        }

        if (dvrPlaylistUrl) {

            try {
                URL.revokeObjectURL(dvrPlaylistUrl);
            } catch (e) {}

            dvrPlaylistUrl = null;

        }

    }


    // Repère le lecteur Twitch et retient son état sonore, sans
    // y toucher : en mode direct c'est lui qu'on écoute.
    function dvrFindLivePlayer() {

        dvrLiveVideo = findPlaybackVideo();

    }


    function dvrRestoreLiveSound() {

        if (!dvrLiveVideo) {
            return;
        }

        try {

            dvrLiveVideo.muted = dvrVolumeMuted;
            dvrLiveVideo.volume = dvrVolumeLevel;

            if (dvrLiveVideo.paused) {

                var resumed = dvrLiveVideo.play();

                if (resumed && resumed.catch) {
                    resumed.catch(function () {});
                }

            }

        } catch (e) {}

    }


    function dvrRestoreLivePlayer() {

        dvrRestoreLiveSound();

        dvrLiveVideo = null;

    }


    // ------------------------------------------------------------
    // Mode direct
    // ------------------------------------------------------------
    //
    // ⏪ ne fait plus reculer : il pose la barre par-dessus le
    // lecteur Twitch, qui continue de jouer le direct avec son
    // son. La surface laisse passer les clics, les contrôles de
    // Twitch restent donc utilisables, et RIEN n'est remplacé
    // tant qu'on n'a pas tiré le curseur en arrière.
    //
    // Conséquence voulue : tant qu'on ne touche à rien, il ne se
    // passe rien — aucun rechargement, et le direct ne prend
    // aucun retard puisque c'est toujours Twitch qui joue.

    var DVR_LIVE_EDGE_SECONDS = 3;

    // Pas des boutons ⏪ / ⏩. À 10 s il fallait cliquer trois fois
    // pour revoir une action ratée ; ici on fouille un passé court,
    // autant avancer par vraies enjambées.
    var DVR_SKIP_SECONDS = 30;

    // Recul maximal retiré du plus ancien instant disponible : voir
    // dvrGoToOffset.
    var DVR_REACH_MARGIN = 6;


    function dvrIsLive() {

        return dvrSourceKind === 'live';

    }


    function dvrEnterLiveMode() {

        if (!dvrOverlay) {
            return;
        }

        dvrDestroyPlayback();

        dvrSourceKind = 'live';

        // Revenir au direct annule le gel : on y est, il n'y a plus
        // rien à rattraper. Et le retard visé n'a plus d'objet.
        dvrLivePauseAt = 0;
        dvrPendingPause = false;
        dvrAimedOffset = null;

        // L'horloge reprend l'avance réelle du lecteur Twitch,
        // et la barre son échelle vivante.
        dvrFrozenAhead = null;
        dvrFrozenTimelineMax = null;

        dvrOverlay.classList.add('tp9dvr-live-mode');

        dvrSetStatus('');

        // Plus rien ne se lit depuis la mémoire : le Worker peut
        // reprendre son expiration normale.
        dvrSendHold(false);

        dvrRestoreLiveSound();

        dvrRefreshControls();

    }


    function dvrLeaveLiveMode() {

        if (!dvrOverlay) {
            return;
        }

        dvrOverlay.classList.remove('tp9dvr-live-mode');

        // Figée AVANT toute autre chose : tout le calage du passé
        // se fait sur cette valeur (voir dvrReferenceAhead).
        dvrFrozenAhead = dvrLivePlayerAhead();

        // Puis l'échelle, calculée SUR cette avance-là : on est
        // encore en direct à cet instant, c'est donc exactement
        // celle que l'utilisateur avait sous les yeux.
        dvrFrozenTimelineMax = dvrTimelineMax(dvrChannelInUse);

        dvrSourceKind = null;

        dvrLivePauseAt = 0;

        // Le lecteur Twitch continue de tourner derrière : c'est
        // lui qui alimente la mémoire, et c est ce qui rend le
        // retour au direct instantané. On le fait juste taire.
        if (dvrLiveVideo) {

            try {

                dvrLiveVideo.muted = true;

                // Il a pu être arrêté par le bouton pause du
                // direct : on le relance, sinon la mémoire cesse de
                // se remplir et le retour au direct devient lent.
                if (dvrLiveVideo.paused) {

                    var restarted = dvrLiveVideo.play();

                    if (restarted && restarted.catch) {
                        restarted.catch(function () {});
                    }

                }

            } catch (e) {}

        }

        dvrSendHold(true);

    }


    // ------------------------------------------------------------
    // PAUSE SUR LE DIRECT
    // ------------------------------------------------------------
    //
    // Le bouton était grisé, au motif que mettre le direct en pause
    // arrêterait ce qui remplit la mémoire. C'est vrai — mais ça ne
    // vaut que pour la mémoire : quand la chaîne a un VOD, il
    // s'enregistre tout seul pendant qu'on ne regarde pas, et rien
    // ne justifie alors de refuser la pause.
    //
    // Deux chemins, donc, et ils ne se valent pas :
    //
    //   VOD     — vraie pause : on arrête le lecteur Twitch, donc
    //             aussi le téléchargement, et la reprise repart du
    //             moment du gel, lue dans l'enregistrement. Aucune
    //             limite de durée.
    //
    //   mémoire — le lecteur Twitch DOIT continuer, c'est lui qui
    //             la remplit : on bascule sur la mémoire et c'est
    //             NOTRE lecteur qu'on fige. La pause tient tant que
    //             le Worker garde les segments.
    //
    // Dans les deux cas la reprise passe par dvrGoToOffset : elle
    // repart où on s'est arrêté, jamais au direct.

    function dvrIsLivePaused() {

        return dvrLivePauseAt > 0;

    }


    function dvrLivePauseKind() {

        if (!dvrChannelInUse) {
            return null;
        }

        if (dvrVodInfoFor(dvrChannelInUse)) {
            return 'vod';
        }

        if (dvrBufferDepthFor(dvrChannelInUse) > 0) {
            return 'buffer';
        }

        // Ni mémoire ni VOD : il n'y a rien à rattraper, mais rien
        // n'interdit de figer l'image pour autant. C'est la pause
        // de Twitch, celle qu'on vient justement de masquer — la
        // refuser reviendrait à retirer une commande.
        return 'plain';

    }


    function dvrPauseLive() {

        var kind = dvrLivePauseKind();

        if (!kind) {
            return;
        }

        if (kind === 'buffer') {

            dvrPendingPause = true;

            // Juste derrière le bord du direct : assez pour que la
            // mémoire ait déjà le passage, pas assez pour que le
            // saut se voie.
            dvrGoToOffset(
                dvrMinOffsetFor(dvrChannelInUse) +
                DVR_LIVE_EDGE_SECONDS + 1
            );

            return;

        }

        if (!dvrLiveVideo) {
            return;
        }

        dvrLivePauseAt = Date.now();

        try {
            dvrLiveVideo.pause();
        } catch (e) {}

        dvrRefreshControls();

    }


    function dvrResumeLive() {

        var offset = (Date.now() - dvrLivePauseAt) / 1000;

        var kind = dvrLivePauseKind();

        dvrLivePauseAt = 0;

        // Rien à rattraper sur cette chaîne : on repart au direct,
        // exactement comme le ferait la reprise de Twitch.
        if (kind === 'plain') {

            dvrEnterLiveMode();

            return;

        }

        // Un gel de deux secondes ne vaut pas qu'on charge une
        // source : dvrGoToOffset renvoie alors au direct tout seul.
        dvrGoToOffset(offset);

    }


    // Le gel demandé depuis le direct ne peut s'appliquer qu'une
    // fois la source prête à rendre une image.
    function dvrApplyPendingPause() {

        if (!dvrPendingPause) {
            return false;
        }

        dvrPendingPause = false;

        try {
            dvrVideo.pause();
        } catch (e) {}

        dvrRefreshControls();

        return true;

    }


    // La vidéo qu'on entend : celle de Twitch en direct, la
    // nôtre dans le passé.
    function dvrActiveVideo() {

        return dvrIsLive() ? dvrLiveVideo : dvrVideo;

    }


    // Le volume suit les DEUX lecteurs : celui qui joue et celui
    // qui attend. Sans ça, passer de l'un à l'autre faisait
    // sauter le son.
    // Il n'y a plus qu'UN état du son, et il est ici. Avant, le
    // bouton de coupure lisait la propriété muted du lecteur, le
    // curseur affichait le dernier niveau appliqué, et personne ne
    // relisait le lecteur Twitch quand l'utilisateur touchait SES
    // commandes à lui : les trois racontaient donc trois choses
    // différentes — pictogramme muet alors que le son sortait,
    // curseur au milieu alors qu'on venait de couper, et un clic
    // qui semblait sans effet une fois sur deux.
    //
    // dvrVolumeLevel ne descend jamais à 0 : couper le son est une
    // coupure, pas un niveau. Rétablir le son après une coupure
    // faite à 0 ne rendait rien d'audible, d'où le bouton qui avait
    // l'air cassé.

    function dvrEffectiveVolume() {

        return dvrVolumeMuted ? 0 : dvrVolumeLevel;

    }


    // Reprend l'état d'un lecteur ; renvoie true s'il disait autre
    // chose que nous.
    function dvrAdoptVolumeFrom(video) {

        if (!video) {
            return false;
        }

        var muted = !!video.muted || video.volume === 0;

        var level = video.volume > 0 ? video.volume : dvrVolumeLevel;

        if (
            muted === dvrVolumeMuted &&
            Math.abs(level - dvrVolumeLevel) < 0.005
        ) {
            return false;
        }

        dvrVolumeMuted = muted;
        dvrVolumeLevel = level;

        // Réglé dans les commandes de Twitch, mais réglé quand même :
        // c'est le dernier choix de l'utilisateur, il se retient au
        // même titre que celui fait dans notre barre.
        saveDvrVolume();

        return true;

    }


    // Écrit l'état sur les deux lecteurs, le curseur et le bouton.
    function dvrPushVolume() {

        try {

            if (dvrVideo) {

                dvrVideo.volume = dvrVolumeLevel;
                dvrVideo.muted = dvrVolumeMuted;

            }

            if (dvrLiveVideo) {

                dvrLiveVideo.volume = dvrVolumeLevel;

                // En lecture du passé, le lecteur Twitch reste muet
                // quoi qu'il arrive : c'est le nôtre qu'on entend.
                dvrLiveVideo.muted =
                    dvrIsLive() ? dvrVolumeMuted : true;

            }

        } catch (e) {}

        var slider = dvrOverlay
            ? dvrOverlay.querySelector('.tp9dvr-vol')
            : null;

        if (slider) {

            // Coupé, le curseur tombe à zéro : c'est ce qu'on
            // entend, et c'est ce que fait le lecteur de Twitch.
            var percent =
                Math.round(dvrEffectiveVolume() * 100);

            slider.value = String(percent);

            // Et la piste se remplit d'autant : la position de la
            // pastille seule se cherchait, sur 68 px de large.
            slider.style.setProperty(
                '--tp9dvr-vol',
                percent + '%'
            );

        }

        dvrRefreshControls();

    }


    function dvrApplyVolume(level, muted) {

        if (typeof level === 'number' && level > 0) {
            dvrVolumeLevel = level > 1 ? 1 : level;
        }

        dvrVolumeMuted = !!muted;

        saveDvrVolume();

        dvrPushVolume();

    }


    // Le son peut changer ailleurs que dans notre barre : touche M
    // de Twitch, son propre curseur, ou un lecteur remplacé en
    // cours de route. On relit donc celui qu'on entend, sinon notre
    // bouton reste sur un état que plus personne ne porte.
    function dvrSyncVolumeFromPlayer() {

        if (dvrLiveVideo && dvrLiveVideo.isConnected === false) {

            // Lecteur remplacé (changement de qualité, publicité) :
            // le nôtre pilotait un élément détaché, d'où un bouton
            // qui coupait un son qu'on continuait d'entendre.
            dvrFindLivePlayer();

            // Twitch va remettre SON volume sur le lecteur neuf :
            // c'est le nôtre qui doit rester.
            dvrArmVolumeGuard();

            dvrPushVolume();

            return;

        }

        // En lecture du passé, c'est nous qui pilotons les deux
        // lecteurs : relire ne ferait que reprendre notre propre
        // coupure du lecteur Twitch.
        if (!dvrIsLive()) {
            return;
        }

        // Fenêtre de garde : ce que le lecteur affiche n'est pas un
        // réglage de l'utilisateur, c'est la restauration de Twitch.
        if (dvrVolumeGuarded()) {

            if (
                dvrVolumeKnown &&
                dvrLiveVideo &&
                dvrVolumeDrifted(dvrLiveVideo)
            ) {
                dvrPushVolume();
            }

            return;

        }

        if (dvrAdoptVolumeFrom(dvrLiveVideo)) {
            dvrPushVolume();
        }

    }


    // Le lecteur perso peut très bien être fermé : c'est le même
    // son, il doit suivre quand même. Sans ça, changer de chaîne
    // barre fermée rendait la main au volume de Twitch, et le
    // niveau réglé dans notre barre ne revenait qu'à sa
    // réouverture.
    var dvrVolumeWatchedVideo = null;

    function dvrKeepTwitchVolume() {

        // Barre ouverte : c'est dvrSyncVolumeFromPlayer qui pilote,
        // quatre fois par seconde.
        if (dvrOverlay) {
            return;
        }

        var video = findPlaybackVideo();

        if (!video) {

            dvrVolumeWatchedVideo = null;

            return;

        }

        if (video !== dvrVolumeWatchedVideo) {

            dvrVolumeWatchedVideo = video;

            dvrArmVolumeGuard();

        }

        // Rien n'a jamais été réglé dans notre barre : c'est le son
        // de Twitch qui fait foi, on se contente de le retenir.
        if (!dvrVolumeKnown) {

            dvrAdoptVolumeFrom(video);

            return;

        }

        if (!dvrVolumeDrifted(video)) {
            return;
        }

        if (dvrVolumeGuarded()) {

            try {

                video.volume = dvrVolumeLevel;
                video.muted = dvrVolumeMuted;

            } catch (e) {}

            return;

        }

        // Hors fenêtre de garde, c'est l'utilisateur qui a touché
        // aux commandes de Twitch : on le suit, et on le retient.
        dvrAdoptVolumeFrom(video);

    }


    var dvrVolumeHintTimer = null;

    // Le curseur de volume est minuscule : à la molette, c'est
    // le chiffre qui dit où on en est.
    // Il vit dans l'habillage, et nulle part ailleurs : la molette
    // ne règle plus le volume barre fermée, il n'y a donc plus
    // aucune indication à poser sur le lecteur de Twitch.
    function dvrHintElement() {

        return dvrOverlay
            ? dvrOverlay.querySelector('.tp9dvr-vol-hint')
            : null;

    }


    function dvrShowHint(html) {

        var hint = dvrHintElement();

        if (!hint) {
            return;
        }

        // Agir sans bouger la souris ne doit pas se faire sur une
        // barre effacée : on la rappelle, et on la retient le temps
        // de l'indication — sur le direct c'est la barre de Twitch
        // qui commande, et elle n'a aucune raison de se montrer pour
        // un coup de molette.
        if (dvrOverlay) {

            dvrBarForcedUntil = Date.now() + 1200;

            dvrShowBar();

        }

        hint.innerHTML = html;

        hint.classList.add('tp9dvr-vol-hint-on');

        if (dvrVolumeHintTimer) {
            clearTimeout(dvrVolumeHintTimer);
        }

        dvrVolumeHintTimer = setTimeout(
            function () {

                dvrVolumeHintTimer = null;

                hint.classList.remove('tp9dvr-vol-hint-on');

            },
            900
        );

    }


    function dvrShowVolumeHint(level, muted) {

        dvrShowHint(
            (muted ? DVR_ICONS.volumeOff : DVR_ICONS.volume) +
            '<span>' +
            (muted ? 'Muet' : Math.round(level * 100) + ' %') +
            '</span>'
        );

    }


    // Le même carton que pour le volume : un clic sur ⟲30 / ⟳30 doit
    // se voir, sinon rien ne dit qu'il a été pris.
    //
    // Les clics rapprochés se CUMULENT : deux coups sur ⟲30
    // annoncent « − 1 min », comme sur les lecteurs qui additionnent
    // les appuis répétés. Un seul carton, un seul total — et non
    // trois fois « − 30 s » sans qu'on sache où on a atterri. Le
    // sens compte : enchaîner ⟲30 puis ⟳30 repart de zéro plutôt
    // que d'afficher « 0 s ».
    var DVR_SKIP_ACCUM_MS = 1100;

    var dvrSkipAccum = 0;
    var dvrSkipAccumAt = 0;

    function dvrShowSkipHint(back) {

        var now = Date.now();

        var step = back ? DVR_SKIP_SECONDS : -DVR_SKIP_SECONDS;

        if (
            (now - dvrSkipAccumAt) > DVR_SKIP_ACCUM_MS ||
            (dvrSkipAccum > 0) !== (step > 0)
        ) {
            dvrSkipAccum = 0;
        }

        dvrSkipAccum += step;
        dvrSkipAccumAt = now;

        dvrShowHint(
            (back ? DVR_ICONS.back : DVR_ICONS.forward) +
            '<span>' +
            (back ? '− ' : '+ ') +
            dvrFormatReach(Math.abs(dvrSkipAccum)) +
            '</span>'
        );

    }


    // ------------------------------------------------------------
    // RETARD VISÉ
    // ------------------------------------------------------------
    //
    // Deux clics rapprochés sur ⟲30 partaient tous les deux de la
    // position ACTUELLE — qui n'a pas encore bougé pendant le
    // chargement — si bien que le second annulait le premier au
    // lieu de s'y ajouter. On retient donc le retard DEMANDÉ le
    // temps que la source s'y rende, et c'est lui qui sert de base
    // au clic suivant comme au calage après lecture du manifeste.
    var DVR_AIM_TTL_MS = 2500;

    var dvrAimedOffset = null;
    var dvrAimedAt = 0;

    function dvrAimOffset(fallback) {

        if (
            dvrAimedOffset !== null &&
            (Date.now() - dvrAimedAt) < DVR_AIM_TTL_MS
        ) {
            return dvrAimedOffset;
        }

        return typeof fallback === 'number'
            ? fallback
            : dvrCurrentOffset();

    }


    // ------------------------------------------------------------
    // MOLETTE = VOLUME, SUR TOUT LE LECTEUR
    // ------------------------------------------------------------
    //
    // Uniquement quand le lecteur perso est OUVERT : ailleurs, la
    // molette appartient à Twitch et à la page, et la détourner
    // surprenait plus qu'elle n'aidait.
    //
    // L'écouteur vit quand même sur le DOCUMENT et non sur
    // l'habillage : en mode direct celui-ci laisse passer les
    // événements (pointer-events: none), il ne verrait donc rien. On
    // compare la position du curseur au cadre du lecteur, comme pour
    // l'effacement de la barre.
    //
    // Twitch règle par pas de 10 % ; ici c'est 1 %, de quoi ajuster.

    var playerWheelWatched = false;

    // findPlayer() remonte les ancêtres de la vidéo en mesurant
    // chacun : c'est une poignée de calculs de mise en page. Or une
    // molette part à chaque cran, plusieurs dizaines de fois par
    // seconde en défilement rapide — d'où le cache court, sur le
    // modèle de dvrTwitchBarCache.
    var dvrPlayerCache = { at: 0, value: null };

    function dvrCachedPlayer() {

        var now = Date.now();

        if (now - dvrPlayerCache.at < 500) {
            return dvrPlayerCache.value;
        }

        dvrPlayerCache.at = now;

        dvrPlayerCache.value = findPlayer();

        return dvrPlayerCache.value;

    }

    function watchPlayerWheel() {

        if (playerWheelWatched) {
            return;
        }

        playerWheelWatched = true;

        document.addEventListener(
            'wheel',
            function (event) {

                // Ctrl + molette, c'est le zoom du navigateur : on
                // ne le détourne pas.
                if (event.ctrlKey) {
                    return;
                }

                // Barre fermée : la molette n'est pas à nous.
                if (!dvrOverlay) {
                    return;
                }

                // Nos propres panneaux se posent PAR-DESSUS le
                // lecteur : le curseur est bien dans son cadre, mais
                // la molette y sert à faire défiler, pas à régler le
                // son. Sans ce garde, scroller dans le menu baissait
                // le volume du stream et ne faisait défiler rien du
                // tout (le preventDefault ci-dessous bloquait aussi
                // le défilement).
                if (
                    event.target.closest &&
                    event.target.closest(
                        '#tp9-dashboard,' +
                        '#tp9-stats,' +
                        '#tp9-toast,' +
                        '#tp9-chat-modal,' +
                        '.tp9dvr-menu'
                    )
                ) {
                    return;
                }

                var player = dvrCachedPlayer();

                if (!player) {
                    return;
                }

                var rect = player.getBoundingClientRect();

                if (
                    event.clientX < rect.left ||
                    event.clientX > rect.right ||
                    event.clientY < rect.top ||
                    event.clientY > rect.bottom
                ) {
                    return;
                }

                if (!dvrActiveVideo()) {
                    return;
                }

                // Sans ça, la page défile sous le lecteur.
                event.preventDefault();

                var step = event.deltaY < 0 ? 0.01 : -0.01;

                // C'est la barre qui tient le niveau : les deux
                // lecteurs doivent rester d'accord, et elle seule
                // sait lequel on entend.
                var current = dvrEffectiveVolume();

                var muted = dvrVolumeMuted;

                // Monter le son alors qu'il est coupé le rétablit au
                // niveau choisi : repartir de 1 % obligerait à trente
                // coups de molette pour se rendre audible.
                var level =
                    (muted && step > 0)
                        ? (dvrVolumeLevel || 0.5)
                        : Math.round((current + step) * 100) / 100;

                if (level < 0) {
                    level = 0;
                }

                if (level > 1) {
                    level = 1;
                }

                dvrApplyVolume(level, level === 0);

                dvrShowVolumeHint(level, level === 0);

            },
            { passive: false }
        );

    }

    // ------------------------------------------------------------
    // Choix et chargement de la source
    // ------------------------------------------------------------

    function dvrPickSource(offset) {

        var buffer = dvrSourceWindow('buffer');

        var vod = dvrSourceWindow('vod');

        // La mémoire d'abord tant qu'elle couvre VRAIMENT le moment
        // demandé : elle est instantanée, et elle seule a les toutes
        // dernières secondes. Les deux secondes retirées de sa borne
        // haute évitent son tout premier segment, celui que
        // l'expiration est sur le point de retirer.
        if (
            buffer &&
            offset >= buffer.min &&
            offset <= buffer.max - 2
        ) {
            return 'buffer';
        }

        if (
            vod &&
            offset >= vod.min &&
            offset <= vod.max
        ) {
            return 'vod';
        }

        // Hors des deux fenêtres : on prend celle qui s'en approche le
        // plus plutôt que de renvoyer le lecteur vers une source qui
        // n'a pas ce qu'on lui demande.
        if (buffer && vod) {
            return offset > buffer.max ? 'vod' : 'buffer';
        }

        if (buffer) {
            return 'buffer';
        }

        return vod ? 'vod' : null;

    }


    function dvrGoToOffset(offset) {

        if (!dvrOverlay) {
            return;
        }

        // Le retard DEMANDÉ, avant tout recadrage : c'est lui qui dit
        // si l'utilisateur veut revenir au direct. Le recadrer d'abord
        // ferait passer pour « je veux le direct » un « -5 s » qu'aucune
        // source ne sait servir.
        if (offset <= DVR_LIVE_EDGE_SECONDS) {

            dvrEnterLiveMode();

            return;

        }

        // Le bouton part sur 30 s par défaut : si la mémoire n'a que
        // 20 s et qu'il n'y a pas de VOD, on lit ces 20 s au lieu de
        // chercher une source capable d'aller plus loin.
        //
        // La marge n'est pas un détail : demander EXACTEMENT le plus
        // ancien instant disponible, c'est viser un segment que le
        // lecteur n'a pas encore chargé — ou que l'expiration est
        // sur le point de retirer. hls.js recalait alors la lecture
        // au bord du direct, d'où « ça gèle et ça me ramène tout à
        // droite » quand on tire la timeline à fond à gauche.
        var reach = dvrMaxOffsetFor(dvrChannelInUse);

        if (reach > DVR_REACH_MARGIN) {
            reach -= DVR_REACH_MARGIN;
        }

        if (reach > 0 && offset > reach) {
            offset = reach;
        }

        // Et le plancher : un VOD seul ne sait pas servir les quinze
        // dernières secondes. Demander moins que ça revenait à
        // chercher un moment que personne n'a — le lecteur se figeait
        // en attendant qu'il existe. On donne le plus proche du direct
        // qui soit réellement jouable.
        var floor = dvrMinOffsetFor(dvrChannelInUse) + 2;

        if (reach > 0 && offset < floor) {

            offset = floor > reach ? reach : floor;

        }

        if (offset < 1) {
            offset = 1;
        }

        if (offset <= DVR_LIVE_EDGE_SECONDS) {

            dvrEnterLiveMode();

            return;

        }

        // Noté AVANT toute tentative de chargement : dvrLoadSource
        // refuse une seconde demande pendant qu'il travaille, et
        // sans ça ce second clic serait perdu pour de bon.
        dvrAimedOffset = offset;
        dvrAimedAt = Date.now();

        if (dvrIsLive()) {

            dvrLeaveLiveMode();

        }

        var kind = dvrPickSource(offset);

        if (!kind) {

            dvrPendingPause = false;

            dvrSetStatus(
                'Rien à rejouer pour le moment.'
            );

            return;

        }

        if (
            kind === dvrSourceKind &&
            dvrHls
        ) {

            dvrSeekWithinSource(offset);

            dvrApplyPendingPause();

            return;

        }

        dvrLoadSource(kind, offset);

    }


    function dvrSeekWithinSource(offset) {

        if (!dvrVideo) {
            return;
        }

        var target = dvrMediaTimeForOffset(offset);

        if (target < 0) {
            target = 0;
        }

        var duration = dvrVideo.duration;

        if (
            duration &&
            isFinite(duration) &&
            target > duration - 0.5
        ) {

            target = duration - 0.5;

        }

        // Sur un playlist vivant, la plage réellement atteignable
        // n'est PAS [0, duration] : elle glisse avec le playlist.
        // Viser en dehors, c'est un lecteur qui se fige puis se
        // recale tout seul au bord du direct.
        try {

            var ranges = dvrVideo.seekable;

            if (ranges && ranges.length) {

                var low = ranges.start(0) + 0.5;
                var high = ranges.end(ranges.length - 1) - 0.5;

                if (target < low) {
                    target = low;
                }

                if (high > low && target > high) {
                    target = high;
                }

            }

        } catch (e) {}

        try {
            dvrVideo.currentTime = target;
        } catch (e) {}

    }


    function dvrLoadSource(kind, offset) {

        if (dvrSwitching) {
            return;
        }

        dvrSwitching = true;

        dvrSetStatus(
            kind === 'vod'
                ? 'Chargement du VOD…'
                : 'Chargement…'
        );

        if (kind === 'vod') {

            // dvrVodInfoFor ne renvoie que du lisible, et son URL est
            // résolue depuis longtemps : le clic ne déclenche plus
            // aucun aller-retour réseau avant la lecture.
            var info =
                dvrVodInfoFor(dvrChannelInUse);

            if (!info) {

                dvrSwitching = false;

                dvrHandleSourceFailure(offset);

                return;

            }

            dvrAttachSource(
                'vod',
                info.url,
                info.startWall,
                offset
            );

            return;

        }

        if (dvrSegments.length < 2) {

            dvrSwitching = false;

            dvrSetStatus(
                'Rien à rejouer pour le moment.'
            );

            return;

        }

        dvrDestroyPlayback();

        console.log(
            '[TwitchProxy][DVR] Lecture depuis la mémoire :',
            dvrSegments.length,
            'segments,',
            Math.round(dvrSegmentsSpan),
            's'
        );

        // Le playlist est une photo de la mémoire à cet instant :
        // son instant 0, c'est la fin de ce qu'elle a reçu moins sa
        // profondeur. Surtout pas « maintenant » : le lecteur Twitch
        // a pu cesser de télécharger entre-temps (une pause), et
        // tout se retrouvait alors décalé de la durée de cet arrêt.
        dvrAttachSource(
            'buffer',
            dvrMemoryPlaylistUrl(),
            (dvrSegmentsEndWall || Date.now()) - dvrSegmentsSpan * 1000,
            offset
        );

    }


    function dvrAttachSource(kind, url, startWall, offset) {

        var lib = dvrHlsLib();

        if (!lib) {

            dvrSwitching = false;

            return;

        }

        if (kind === 'vod') {

            dvrDestroyPlayback();

        }

        dvrSourceKind = kind;
        dvrSourceStartWall = startWall;

        var options = {
            enableWorker: false,
            lowLatencyMode: false,
            backBufferLength: 90
        };

        if (kind === 'buffer') {

            // Le playlist de la mémoire n'existe nulle part : il
            // est fabriqué à la demande, à chaque relecture.
            options.pLoader = dvrMemoryLoader;

        }

        // La position de départ est donnée à hls.js AVANT qu'il ne
        // charge quoi que ce soit, en plus du calage fait une fois
        // le manifeste lu : sur un playlist vivant, il place sinon
        // la lecture au bord du direct de lui-même, et notre calage
        // n'arrivait qu'après.
        var startAt = dvrMediaTimeForOffset(offset);

        if (isFinite(startAt) && startAt > 0) {
            options.startPosition = startAt;
        }

        dvrHls = new lib(options);

        // Le VOD se télécharge ICI, par hls.js, hors du Worker qui
        // compte les octets : regarder le passé depuis le VOD ne
        // coûtait donc rien au compteur. La mémoire, elle, rejoue
        // des segments déjà comptés quand le lecteur Twitch les a
        // reçus : on ne la recompte pas.
        //
        // Aucune source n'est passée : elle décrit la MÉTHODE de
        // mesure du direct, affichée sous le total du dashboard, et
        // un VOD n'a pas à la réécrire.
        if (kind === 'vod') {

            dvrHls.on(
                lib.Events.FRAG_LOADED,
                function (event, data) {

                    var bytes =
                        data &&
                        data.payload &&
                        data.payload.byteLength;

                    if (bytes > 0 && dvrChannelInUse) {

                        recordBandwidthBytes(
                            dvrChannelInUse,
                            bytes,
                            null,
                            { viaProxy: false }
                        );

                    }

                }
            );

        }

        dvrHls.on(
            lib.Events.LEVEL_SWITCHED,
            function () {

                // En Auto, le libellé du bouton doit suivre le
                // rendu réellement joué.
                dvrRefreshControls();

            }
        );

        dvrHls.on(
            lib.Events.MANIFEST_PARSED,
            function () {

                dvrSwitching = false;

                dvrSetStatus('');

                // Le dernier retard demandé, et non celui qui a
                // déclenché ce chargement : un second clic sur ⟲30
                // pendant le chargement était purement perdu (voir
                // dvrAimOffset).
                dvrSeekWithinSource(dvrAimOffset(offset));

                // Gel demandé depuis le direct : la source a été
                // chargée pour s'y arrêter, pas pour la jouer.
                if (dvrApplyPendingPause()) {
                    return;
                }

                var played = dvrVideo.play();

                if (played && played.then) {

                    played.then(
                        dvrRefreshControls,
                        dvrRefreshControls
                    );

                }

                dvrRefreshControls();

            }
        );

        dvrHls.on(
            lib.Events.ERROR,
            function (event, data) {

                if (!data || !data.fatal) {
                    return;
                }

                dvrSwitching = false;

                dvrLastErrorDetail =
                    data.details || data.type || null;

                // Sans ce détail, « Lecture impossible » ne dit ni
                // quelle source a échoué, ni pourquoi.
                console.warn(
                    '[TwitchProxy][DVR] Erreur fatale',
                    {
                        source: dvrSourceKind,
                        type: data.type,
                        details: data.details,
                        reason: data.reason,
                        url: data.url ||
                            (data.context && data.context.url),
                        status: data.response && data.response.code
                    }
                );

                logEvent(
                    'error',
                    'Retour arrière (' +
                    (dvrSourceKind === 'vod' ? 'VOD' : 'mémoire') +
                    ') : ' +
                    (data.details || data.type)
                );

                // Le VOD a échoué alors qu'on le croyait lisible :
                // on le condamne définitivement plutôt que de le
                // reproposer à la prochaine expiration du cache.
                if (dvrSourceKind === 'vod') {

                    dvrMarkChannelVodBlocked(dvrChannelInUse);

                }

                dvrHandleSourceFailure(
                    dvrCurrentOffset() || offset
                );

            }
        );

        dvrHls.loadSource(url);

        dvrHls.attachMedia(dvrVideo);

    }


    function dvrHandleSourceFailure(offset) {

        dvrPendingPause = false;

        dvrDestroyPlayback();

        var previous = dvrSourceKind;

        dvrSourceKind = null;

        var fallback = dvrPickSource(offset);

        if (
            !fallback ||
            fallback === previous
        ) {

            var message =
                (
                    previous === 'vod'
                        ? 'Ce VOD est inaccessible.'
                        : 'Lecture impossible depuis la mémoire.'
                ) +
                (
                    dvrLastErrorDetail
                        ? ' (' + dvrLastErrorDetail + ')'
                        : ''
                );

            // Rester sur un écran noir ne sert à rien : on remet le
            // direct, et le message s'efface tout seul.
            dvrEnterLiveMode();

            dvrSetStatus(message, true);

            return;

        }

        dvrLoadSource(fallback, offset);

    }


    // ------------------------------------------------------------
    // Pictogrammes des commandes
    // ------------------------------------------------------------
    //
    // Même facture que les boutons de Twitch : un tracé plein, à
    // la couleur du texte, dans une boîte de 16 px. Un emoji, lui,
    // dépend de la police du système — taille, couleur et ligne de
    // base varient d'une machine à l'autre, et c'est ce qui
    // faisait tache juste au-dessus de la barre de Twitch.

    function dvrSvg(body) {

        return (
            '<svg width="16" height="16" viewBox="0 0 24 24"' +
            ' aria-hidden="true">' +
            body +
            '</svg>'
        );

    }


    // Une flèche qui tourne avec « 30 » au milieu, comme sur les
    // lecteurs que tout le monde connaît. Les doubles triangles
    // précédents ne disaient pas de combien on recule — et se
    // lisaient comme un retour au début.
    function dvrSkipIcon(forward) {

        return (
            '<svg width="18" height="18" viewBox="0 0 24 24"' +
            ' aria-hidden="true">' +
            '<path fill="currentColor" d="' +
            (
                forward
                    ? 'M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z'
                    : 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z'
            ) +
            '"/>' +
            '<text x="12" y="16.3" text-anchor="middle"' +
            ' font-size="7.6" font-weight="700"' +
            ' font-family="Inter, Arial, sans-serif"' +
            ' fill="currentColor">30</text>' +
            '</svg>'
        );

    }


    var DVR_ICONS = {

        play: dvrSvg(
            '<path fill="currentColor" d="M7 4.5v15l12-7.5z"/>'
        ),

        pause: dvrSvg(
            '<path fill="currentColor" d="M6.5 4.5h4v15h-4zm7 0h4v15h-4z"/>'
        ),

        back: dvrSkipIcon(false),

        forward: dvrSkipIcon(true),

        volume: dvrSvg(
            '<path fill="currentColor" d="M4 9h3.5L12 5v14l-4.5-4H4z"/>' +
            '<path fill="none" stroke="currentColor" stroke-width="1.8"' +
            ' stroke-linecap="round" d="M15.5 9.2a4 4 0 0 1 0 5.6"/>' +
            '<path fill="none" stroke="currentColor" stroke-width="1.8"' +
            ' stroke-linecap="round" d="M18.4 6.8a8 8 0 0 1 0 10.4"/>'
        ),

        volumeOff: dvrSvg(
            '<path fill="currentColor" d="M4 9h3.5L12 5v14l-4.5-4H4z"/>' +
            '<path fill="none" stroke="currentColor" stroke-width="1.9"' +
            ' stroke-linecap="round" d="M15.6 9.6l5 5m0-5l-5 5"/>'
        ),

        fullscreen: dvrSvg(
            '<path fill="currentColor" d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z"/>'
        ),

        close: dvrSvg(
            '<path fill="none" stroke="currentColor" stroke-width="2"' +
            ' stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/>'
        ),

        clip: dvrSvg(
            '<circle cx="6" cy="6.2" r="2.4" fill="none"' +
            ' stroke="currentColor" stroke-width="1.7"/>' +
            '<circle cx="6" cy="17.8" r="2.4" fill="none"' +
            ' stroke="currentColor" stroke-width="1.7"/>' +
            '<path fill="none" stroke="currentColor" stroke-width="1.7"' +
            ' stroke-linecap="round" d="M8.1 7.5 20 17.6M8.1 16.5 20 6.4"/>'
        ),

        pip: dvrSvg(
            '<rect x="2.8" y="5" width="18.4" height="14" rx="2.2"' +
            ' fill="none" stroke="currentColor" stroke-width="1.7"/>' +
            '<rect x="12" y="11.4" width="7.2" height="6"' +
            ' rx="1.2" fill="currentColor"/>'
        ),

        settings: dvrSvg(
            '<path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.48.48 0 0 0 .12-.61l-1.92-3.32a.48.48 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.47.47 0 0 0-.48-.41h-3.84a.47.47 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.47.47 0 0 0-.59.22L2.83 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.48.48 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.08-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>'
        ),

        theatre: dvrSvg(
            '<rect x="2.4" y="6.4" width="19.2" height="11.2" rx="2"' +
            ' fill="none" stroke="currentColor" stroke-width="1.7"/>' +
            '<path fill="currentColor" d="M5.6 9.2h12.8v1.6H5.6z"/>'
        )

    };


    // ------------------------------------------------------------
    // Effacement automatique de la barre
    // ------------------------------------------------------------
    //
    // La souris est suivie sur le DOCUMENT et non sur l'habillage :
    // en mode direct celui-ci est en `pointer-events: none` pour
    // laisser passer les clics vers le lecteur Twitch, il ne
    // recevrait donc aucun survol. On compare la position du
    // curseur au cadre de l'habillage, qui épouse déjà le lecteur.

    function dvrBarElement() {

        return dvrOverlay
            ? dvrOverlay.querySelector('.tp9dvr-bar')
            : null;

    }


    function dvrShowBar() {

        var bar = dvrBarElement();

        if (!bar) {
            return;
        }

        bar.classList.remove('tp9dvr-bar-hidden');

        dvrArmBarHide();

    }


    function dvrArmBarHide() {

        // Sur le direct, c'est la barre de Twitch qui donne le
        // tempo (voir dvrSyncBarWithTwitch) : deux minuteurs
        // concurrents, c'était justement le problème.
        if (dvrMirrorsTwitchBar()) {
            return;
        }

        if (dvrBarTimer) {
            clearTimeout(dvrBarTimer);
        }

        dvrBarTimer = setTimeout(
            function () {

                dvrBarTimer = null;

                // Le curseur est posé sur la barre, ou en train
                // de tirer le curseur de position : la faire
                // disparaître sous la main serait absurde. On
                // réarme et on repose la question plus tard.
                if (dvrBarHovered || dvrScrubbing || dvrMenuOpen) {

                    dvrArmBarHide();

                    return;

                }

                dvrHideBar();

            },
            DVR_BAR_HIDE_MS
        );

    }


    function dvrHideBar() {

        var bar = dvrBarElement();

        // Déjà effacée : l'effacement est déclenché par le
        // mouvement de la souris, donc plusieurs fois par seconde.
        // Sans ce garde, tout ce qui suit serait rejoué à chaque
        // pixel parcouru.
        if (
            !bar ||
            dvrMenuOpen ||
            bar.classList.contains('tp9dvr-bar-hidden')
        ) {
            return;
        }

        bar.classList.add('tp9dvr-bar-hidden');

        // Une infobulle accrochée à un bouton de la barre qui
        // vient de s'effacer resterait seule à l'écran. Mais la
        // bulle est PARTAGÉE par tout le script : la fermer sans
        // regarder à qui elle appartient effaçait aussi celle du
        // bouton du menu et celle du ⏪ — tous deux sous le
        // lecteur, donc hors du cadre, donc survolés au moment
        // précis où l'on efface.
        if (tooltipTarget && bar.contains(tooltipTarget)) {
            hideTooltip();
        }

    }


    // ------------------------------------------------------------
    // SUR LE DIRECT, LA BARRE SUIT CELLE DE TWITCH
    // ------------------------------------------------------------
    //
    // Notre barre est posée SUR le lecteur Twitch, dont les
    // commandes restent utilisables juste dessous : les deux doivent
    // donc apparaître et disparaître ensemble. Avec deux minuteurs
    // indépendants — 2,5 s chez nous, environ 3 s chez eux — la
    // nôtre s'effaçait toujours un peu avant, et on restait devant
    // le lecteur de Twitch tout seul.
    //
    // On ne se fie à aucun nom de classe, ils changent à chaque
    // refonte : on part d'un repère stable (leur bouton lecture) et
    // on remonte ses parents en lisant l'opacité calculée, qui est
    // ce qu'ils animent.

    var DVR_TWITCH_CONTROLS_ANCHORS = [
        '[data-a-target="player-controls"]',
        '[data-a-target="player-play-pause-button"]'
    ];

    // Relu au plus quelques fois par seconde : la question est
    // posée à chaque mouvement de souris, et une remontée de
    // parents en styles calculés n'a pas à tourner soixante fois
    // par seconde.
    var dvrTwitchBarCache = { at: 0, value: null };

    function dvrReadTwitchControlsVisible() {

        var anchor = null;

        for (var i = 0; i < DVR_TWITCH_CONTROLS_ANCHORS.length; i++) {

            anchor = document.querySelector(
                DVR_TWITCH_CONTROLS_ANCHORS[i]
            );

            if (anchor) {
                break;
            }

        }

        if (!anchor) {
            return null;
        }

        try {

            var element = anchor;

            var depth = 0;

            // Notre propre masquage ne compte pas : c'est nous qui
            // posons « visibility: hidden » sur cette barre tant que
            // le lecteur perso est ouvert (voir DVR_CSS). Le lire
            // comme un signal de Twitch reviendrait à conclure « sa
            // barre est cachée » en permanence, donc à effacer la
            // nôtre pour toujours. Twitch, lui, anime l'opacité.
            var ignoreHidden = !!dvrOverlay;

            while (element && depth < 8) {

                var style = window.getComputedStyle(element);

                if (
                    style.display === 'none' ||
                    (!ignoreHidden && style.visibility === 'hidden') ||
                    parseFloat(style.opacity) < 0.05
                ) {
                    return false;
                }

                element = element.parentElement;

                depth++;

            }

        } catch (e) {

            return null;

        }

        return true;

    }


    // true / false, ou null quand on n'a pas su regarder : notre
    // minuteur reprend alors la main, comme avant.
    function dvrTwitchControlsVisible() {

        var now = Date.now();

        if ((now - dvrTwitchBarCache.at) < 120) {
            return dvrTwitchBarCache.value;
        }

        dvrTwitchBarCache = {
            at: now,
            value: dvrReadTwitchControlsVisible()
        };

        return dvrTwitchBarCache.value;

    }


    function dvrMirrorsTwitchBar() {

        return (
            dvrIsLive() &&
            dvrTwitchControlsVisible() !== null
        );

    }


    function dvrSyncBarWithTwitch() {

        if (!dvrOverlay || !dvrIsLive()) {
            return;
        }

        var visible = dvrTwitchControlsVisible();

        if (visible === null) {
            return;
        }

        // La souris est posée sur notre barre, on tire le curseur de
        // position, ou on vient de régler le volume à la molette :
        // elle ne disparaît pas sous la main, même si Twitch efface
        // la sienne.
        if (
            !visible &&
            (
                dvrBarHovered ||
                dvrScrubbing ||
                Date.now() < dvrBarForcedUntil
            )
        ) {
            return;
        }

        // Un seul maître à la fois : notre minuteur n'a plus rien à
        // dire tant que celui de Twitch décide.
        if (dvrBarTimer) {

            clearTimeout(dvrBarTimer);

            dvrBarTimer = null;

        }

        if (!visible) {

            dvrHideBar();

            return;

        }

        var bar = dvrBarElement();

        if (bar) {
            bar.classList.remove('tp9dvr-bar-hidden');
        }

    }


    // Le VOD est résolu en tâche de fond : le bouton pause peut
    // devenir disponible bien après l'ouverture de la barre.
    var dvrLastPauseKind = null;


    function dvrPointerOnPlayer(event) {

        if (!dvrOverlay) {
            return false;
        }

        var rect = dvrOverlay.getBoundingClientRect();

        return (
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom
        );

    }


    function dvrWatchPointer() {

        dvrUnwatchPointer();

        dvrPointerWatcher = function (event) {

            if (dvrPointerOnPlayer(event)) {

                dvrShowBar();

                return;

            }

            // Souris sortie du lecteur : rien à attendre, elle n'y
            // revient pas par accident. Sauf en plein glissement,
            // où l'on peut très bien dépasser le cadre.
            if (dvrScrubbing) {
                return;
            }

            // Sur le direct, c'est Twitch qui décide : sa barre
            // reste parfois affichée un instant après que la souris
            // est sortie, la nôtre doit rester avec elle.
            if (dvrMirrorsTwitchBar()) {
                return;
            }

            if (dvrBarTimer) {

                clearTimeout(dvrBarTimer);

                dvrBarTimer = null;

            }

            dvrHideBar();

        };

        document.addEventListener(
            'mousemove',
            dvrPointerWatcher,
            true
        );

    }


    function dvrUnwatchPointer() {

        if (dvrPointerWatcher) {

            document.removeEventListener(
                'mousemove',
                dvrPointerWatcher,
                true
            );

            dvrPointerWatcher = null;

        }

        if (dvrBarTimer) {

            clearTimeout(dvrBarTimer);

            dvrBarTimer = null;

        }

        dvrBarHovered = false;

    }


    // ------------------------------------------------------------
    // Habillage
    // ------------------------------------------------------------

    function dvrBuildOverlay() {

        dvrOverlay =
            document.createElement('div');

        dvrOverlay.className = 'tp9dvr';

        dvrOverlay.innerHTML =
            '<video class="tp9dvr-video" playsinline></video>' +
            '<div class="tp9dvr-status"></div>' +
            '<div class="tp9dvr-vol-hint"></div>' +
            '<div class="tp9dvr-menu tp9dvr-quality-menu"></div>' +
            '<div class="tp9dvr-menu tp9dvr-settings-menu"></div>' +
            '<div class="tp9dvr-bar">' +
            '<div class="tp9dvr-meta"' +
            ' data-tp9-tip=""' +
            ' data-tp9-tip-sub=""></div>' +
            '<div class="tp9dvr-row">' +
            '<button class="tp9dvr-btn tp9dvr-play" type="button"' +
            ' data-tp9-tip="Pause">' + DVR_ICONS.pause + '</button>' +
            '<button class="tp9dvr-btn tp9dvr-back" type="button"' +
            ' data-tp9-tip="Reculer de 30 s"' +
            ' data-tp9-tip-sub="Repart 30 secondes plus tôt que la position actuelle.">' +
            DVR_ICONS.back + '</button>' +
            '<button class="tp9dvr-btn tp9dvr-fwd" type="button"' +
            ' data-tp9-tip="Avancer de 30 s"' +
            ' data-tp9-tip-sub="Se rapproche du direct de 30 secondes.">' +
            DVR_ICONS.forward + '</button>' +
            '<span class="tp9dvr-time"' +
            ' data-tp9-tip="Retard sur le direct"' +
            ' data-tp9-tip-sub="Ce qui te sépare de ce qui se joue en ce moment.">-0:30</span>' +
            '<span class="tp9dvr-seek-wrap"' +
            ' data-tp9-tip="Position dans le passé"' +
            ' data-tp9-tip-sub="À gauche le plus ancien disponible, à droite le direct.">' +
            '<input type="range" class="tp9dvr-seek" min="0" max="1000" value="1000">' +
            '<span class="tp9dvr-seek-paint">' +
            '<span class="tp9dvr-zone tp9dvr-zone-vod"></span>' +
            '<span class="tp9dvr-zone tp9dvr-zone-buf"></span>' +
            '<span class="tp9dvr-head"></span>' +
            '</span>' +
            '<span class="tp9dvr-seek-wait">' +
            '<span class="tp9dvr-seek-wait-track">' +
            '<span class="tp9dvr-seek-wait-fill"></span>' +
            '</span>' +
            '<span class="tp9dvr-seek-wait-text"></span>' +
            '</span>' +
            '</span>' +
            '<span class="tp9dvr-source"></span>' +
            '<button class="tp9dvr-btn tp9dvr-mute" type="button"' +
            ' data-tp9-tip="Couper le son">' + DVR_ICONS.volume + '</button>' +
            '<input type="range" class="tp9dvr-vol" min="0" max="100" value="100"' +
            ' data-tp9-tip="Volume"' +
            ' data-tp9-tip-sub="La molette sur le lecteur le règle aussi, par pas de 1 %.">' +
            '<button class="tp9dvr-btn tp9dvr-quality" type="button"' +
            ' data-tp9-tip="Qualité">Auto</button>' +
            '<button class="tp9dvr-btn tp9dvr-settings" type="button"' +
            ' data-tp9-tip="Réglages du retour arrière"' +
            ' data-tp9-tip-sub="Armer la mémoire de cette chaîne, régler sa profondeur, et décider si cette barre s\'ouvre toute seule.">' +
            DVR_ICONS.settings + '</button>' +
            '<button class="tp9dvr-btn tp9dvr-clip" type="button"' +
            ' data-tp9-tip="Créer un clip"' +
            ' data-tp9-tip-sub="Passe la main au bouton de Twitch : un clip se découpe dans le direct, pas dans notre mémoire.">' +
            DVR_ICONS.clip + '</button>' +
            '<button class="tp9dvr-btn tp9dvr-pip" type="button"' +
            ' data-tp9-tip="Miniature">' + DVR_ICONS.pip + '</button>' +
            '<button class="tp9dvr-btn tp9dvr-theatre" type="button"' +
            ' data-tp9-tip="Mode cinéma">' + DVR_ICONS.theatre + '</button>' +
            '<button class="tp9dvr-btn tp9dvr-full" type="button"' +
            ' data-tp9-tip="Plein écran">' +
            DVR_ICONS.fullscreen +
            '</button>' +
            '<button class="tp9dvr-live" type="button"' +
            ' data-tp9-tip="Revenir au direct"' +
            ' data-tp9-tip-sub="Sans fermer la barre : tu peux repartir en arrière juste après.">' +
            '<span class="tp9dvr-live-dot"></span>DIRECT</button>' +
            '</div>' +
            '</div>';

        dvrHost().appendChild(dvrOverlay);

        // Masque la barre de Twitch tant que la nôtre est là :
        // voir le bloc « LES COMMANDES DE TWITCH » de DVR_CSS.
        document.body.classList.add('tp9dvr-open');

        // Les infobulles maison plutôt que les title du navigateur :
        // elles s'affichent tout de suite (title attend une seconde)
        // et tiennent deux lignes, de quoi dire ce que fait une
        // commande ET pourquoi elle est parfois sans effet.
        attachTooltips(dvrOverlay);

        dvrVideo =
            dvrOverlay.querySelector('.tp9dvr-video');

        dvrWireControls();

        // Survoler la barre elle-même la maintient : sans ça, une
        // souris immobile sur un bouton verrait la barre
        // s'effacer sous elle au bout de 2,5 s.
        var bar = dvrBarElement();

        bar.addEventListener(
            'mouseenter',
            function () {

                dvrBarHovered = true;

                dvrShowBar();

            }
        );

        bar.addEventListener(
            'mouseleave',
            function () {

                dvrBarHovered = false;

                dvrArmBarHide();

            }
        );

        dvrWatchPointer();

        watchMenuOutsideClick();

        // Visible à l'ouverture : le clic vient d'avoir lieu, la
        // souris est forcément là.
        dvrShowBar();

        positionDvrOverlay();

    }


    // Un clic ailleurs referme le menu de qualité. En capture : en
    // mode direct l'habillage laisse passer les clics, ils
    // n'arriveraient jamais jusqu'à lui.
    //
    // Posé UNE fois pour toutes, jamais à chaque construction de
    // l'habillage : celui-ci se reconstruit à chaque ouverture, et
    // les écouteurs se seraient empilés sur le document, qui lui ne
    // disparaît jamais.
    var menuClickWatched = false;

    function watchMenuOutsideClick() {

        if (menuClickWatched) {
            return;
        }

        menuClickWatched = true;

        document.addEventListener(
            'click',
            function (event) {

                if (!dvrMenuOpen || !dvrOverlay) {
                    return;
                }

                var target = event.target;

                if (
                    target.closest &&
                    (
                        target.closest('.tp9dvr-menu') ||
                        target.closest('.tp9dvr-quality') ||
                        target.closest('.tp9dvr-settings')
                    )
                ) {
                    return;
                }

                dvrCloseMenu();

            },
            true
        );

    }


    // En plein écran, seul le contenu de l'élément plein écran est
    // visible : l'habillage doit y déménager, sinon il disparaît.
    function dvrHost() {

        return (
            document.fullscreenElement ||
            document.body
        );

    }


    var dvrStatusTimer = null;

    // `transient` : message posé par-dessus le direct, qui doit
    // donc disparaître au lieu de masquer le stream.
    function dvrSetStatus(text, transient) {

        if (!dvrOverlay) {
            return;
        }

        var node =
            dvrOverlay.querySelector('.tp9dvr-status');

        if (!node) {
            return;
        }

        if (dvrStatusTimer) {

            clearTimeout(dvrStatusTimer);

            dvrStatusTimer = null;

        }

        node.textContent = text || '';

        node.style.display =
            text ? 'flex' : 'none';

        if (text && transient) {

            dvrStatusTimer = setTimeout(
                function () {

                    dvrStatusTimer = null;

                    dvrSetStatus('');

                },
                6000
            );

        }

    }


    // ------------------------------------------------------------
    // QUALITÉ
    // ------------------------------------------------------------
    //
    // hls.js expose les rendus du flux qu'IL lit — donc ceux de la
    // source en cours, VOD ou mémoire. La mémoire est reconstruite
    // à partir d'un seul rendu (celui que le lecteur Twitch
    // téléchargeait) : elle n'en proposera qu'un, et le bouton se
    // grise de lui-même. C'est honnête, et c'est mieux qu'un menu
    // qui promettrait un choix inexistant.

    var dvrMenuOpen = false;

    // NOTRE choix, et non celui que hls.js veut bien avouer. Son
    // getter « currentLevel » ne renvoie le nouveau rendu qu'une
    // fois le changement réellement appliqué : le libellé affichait
    // donc toujours le rendu PRÉCÉDENT — clic sur 160p, le bouton
    // restait à « 1080p », puis clic sur 1080p et il passait à
    // « 160p ». -1 = Auto.
    var dvrManualLevel = -1;

    function dvrLevelName(level) {

        if (!level) {
            return '';
        }

        if (level.height) {

            var fps =
                level.attrs &&
                parseFloat(level.attrs['FRAME-RATE']);

            return (
                level.height + 'p' +
                (fps && fps > 35 ? '60' : '')
            );

        }

        if (level.name) {
            return level.name;
        }

        return Math.round((level.bitrate || 0) / 1000) + ' kb/s';

    }


    function dvrQualityLevels() {

        if (!dvrHls || !dvrHls.levels) {
            return [];
        }

        return dvrHls.levels;

    }


    function dvrQualityLabel() {

        var levels = dvrQualityLevels();

        if (!levels.length) {
            return '—';
        }

        // Choix manuel : c'est le nôtre qui fait foi, tout de suite.
        if (dvrManualLevel >= 0) {

            return dvrLevelName(levels[dvrManualLevel]) || 'Qualité';

        }

        // En Auto, en revanche, le rendu joué est bien celui que
        // hls.js rapporte — et LEVEL_SWITCHED rafraîchit le libellé
        // quand il change.
        var index =
            dvrHls.currentLevel >= 0
                ? dvrHls.currentLevel
                : dvrHls.loadLevel;

        var name = dvrLevelName(levels[index]);

        return name ? 'Auto · ' + name : 'Auto';

    }


    // Sur le direct, l'image vient du lecteur de Twitch : ni
    // hls.js ni nos niveaux ne savent ce qui est joué, et le
    // bouton se contentait du mot « Qualité ». Sa <video>, elle,
    // le sait — sa hauteur EST le rendu courant. La cadence, que
    // rien n'expose, se déduit du compteur d'images décodées
    // relevé d'un tick à l'autre.
    var dvrTwitchFpsVideo = null;
    var dvrTwitchFpsFrames = -1;
    var dvrTwitchFpsAt = 0;
    var dvrTwitchFps = 0;


    function dvrSampleTwitchFps(video) {

        if (
            !video ||
            typeof video.getVideoPlaybackQuality !== 'function'
        ) {

            dvrTwitchFpsVideo = null;

            dvrTwitchFps = 0;

            return;

        }

        // Lecteur remplacé (pub, changement de qualité) : le
        // compteur repart de zéro, et la cadence d'avant ne dit
        // plus rien de celle d'après.
        if (video !== dvrTwitchFpsVideo) {

            dvrTwitchFpsVideo = video;

            dvrTwitchFpsFrames = -1;

            dvrTwitchFps = 0;

        }

        if (video.paused) {
            return;
        }

        var frames;

        try {

            frames =
                video.getVideoPlaybackQuality()
                    .totalVideoFrames || 0;

        } catch (e) {
            return;
        }

        var now = Date.now();

        // Premier relevé, ou compteur reparti en arrière : on ne
        // fait que poser le repère.
        if (dvrTwitchFpsFrames < 0 || frames < dvrTwitchFpsFrames) {

            dvrTwitchFpsFrames = frames;

            dvrTwitchFpsAt = now;

            return;

        }

        var elapsed = now - dvrTwitchFpsAt;

        // Une seconde de recul au moins : sur les 250 ms du tick,
        // une image de plus ou de moins déplace la mesure de 4.
        if (elapsed < 1000) {
            return;
        }

        dvrTwitchFps =
            (frames - dvrTwitchFpsFrames) * 1000 / elapsed;

        dvrTwitchFpsFrames = frames;

        dvrTwitchFpsAt = now;

    }


    function dvrTwitchQualityLabel() {

        var video = dvrLiveVideo;

        // La barre peut s'ouvrir avant qu'on ait repéré le
        // lecteur de Twitch, et il se fait remplacer en cours de
        // route.
        if (!video || video.isConnected === false) {

            dvrFindLivePlayer();

            video = dvrLiveVideo;

        }

        dvrSampleTwitchFps(video);

        if (!video || !video.videoHeight) {
            return '';
        }

        // Même écriture que dvrLevelName : « 1080p60 », pas
        // « 1080p 59,94 im/s ».
        return (
            video.videoHeight + 'p' +
            (dvrTwitchFps > 35 ? '60' : '')
        );

    }


    // Tant que la hauteur n'est pas connue (lecteur pas encore
    // démarré, pub en cours), le mot seul reste préférable à un
    // bouton vide.
    function dvrLiveQualityLabel() {

        return dvrTwitchQualityLabel() || 'Qualité';

    }


    // Ce que le bouton affiche en ce moment : Twitch change de
    // rendu tout seul en Auto, et dvrRefreshControls ne tourne
    // pas à chaque changement. Le tick relit donc le libellé,
    // mais n'écrit que s'il a bougé — toucher textContent à
    // 4 Hz relancerait une mise en page pour rien.
    var dvrTwitchQualityShown = '';


    function dvrSyncTwitchQualityLabel() {

        if (!dvrOverlay || !dvrIsLive()) {

            dvrTwitchQualityShown = '';

            return;

        }

        var button =
            dvrOverlay.querySelector('.tp9dvr-quality');

        if (!button) {
            return;
        }

        var label = dvrLiveQualityLabel();

        if (label === dvrTwitchQualityShown) {
            return;
        }

        dvrTwitchQualityShown = label;

        button.textContent = label;

    }


    function dvrQualityMenu() {

        return dvrOverlay
            ? dvrOverlay.querySelector('.tp9dvr-quality-menu')
            : null;

    }


    function dvrSettingsMenu() {

        return dvrOverlay
            ? dvrOverlay.querySelector('.tp9dvr-settings-menu')
            : null;

    }


    // La barre ne s'efface pas sous un panneau ouvert : il y en a
    // deux maintenant, et dvrMenuOpen doit dire « l'un OU l'autre ».
    function dvrMenusOpen() {

        var quality = dvrQualityMenu();
        var settings = dvrSettingsMenu();

        return !!(
            (quality && quality.classList.contains('tp9dvr-menu-on')) ||
            (settings && settings.classList.contains('tp9dvr-menu-on'))
        );

    }


    function dvrCloseQualityMenu() {

        var menu = dvrQualityMenu();

        if (menu) {
            menu.classList.remove('tp9dvr-menu-on');
        }

        dvrMenuOpen = dvrMenusOpen();

    }


    function dvrCloseSettingsMenu() {

        var menu = dvrSettingsMenu();

        if (menu) {
            menu.classList.remove('tp9dvr-menu-on');
        }

        dvrMenuOpen = dvrMenusOpen();

    }


    function dvrCloseMenu() {

        dvrCloseQualityMenu();

        dvrCloseSettingsMenu();

    }


    // Le menu de qualité était collé au bord droit du lecteur, très
    // loin du bouton qui l'ouvre. Les panneaux se posent maintenant
    // juste au-dessus de LEUR bouton, centrés sur lui, et recadrés
    // s'ils débordent d'un côté.
    function dvrPlaceMenu(menu, button) {

        var bar = dvrBarElement();

        if (!menu || !button || !bar) {
            return;
        }

        var host = dvrOverlay.getBoundingClientRect();
        var rect = button.getBoundingClientRect();

        if (!host.width || !rect.width) {
            return;
        }

        menu.style.right = 'auto';

        // Juste au-dessus du BOUTON, et non de la barre : celle-ci
        // commence bien plus haut que ses commandes (26 px de
        // dégradé transparent, puis la ligne d'info), et le menu se
        // retrouvait à flotter loin au-dessus de la roue dentée.
        menu.style.bottom =
            Math.max(8, host.bottom - rect.top + 6) + 'px';

        var width = menu.offsetWidth;

        var left =
            rect.left - host.left + (rect.width - width) / 2;

        var max = host.width - width - 8;

        if (left > max) {
            left = max;
        }

        if (left < 8) {
            left = 8;
        }

        menu.style.left = left + 'px';

    }


    function dvrPlaceQualityMenu() {

        dvrPlaceMenu(
            dvrQualityMenu(),
            dvrOverlay
                ? dvrOverlay.querySelector('.tp9dvr-quality')
                : null
        );

    }


    // ------------------------------------------------------------
    // RÉGLAGES DU RETOUR ARRIÈRE, SUR LE LECTEUR
    // ------------------------------------------------------------
    //
    // Armer la mémoire, choisir sa profondeur et l'ouverture
    // automatique se faisaient à l'autre bout de la page, dans le
    // menu du bouclier. Ces trois réglages ne concernent que cette
    // barre : ils vivent donc aussi ici, sous une roue dentée.
    //
    // Chaque ligne garde son infobulle : une option qui coûte de la
    // RAM doit dire ce qu'elle coûte, sinon on la coche sans savoir.
    //
    // Les réglages restent DOUBLÉS dans le menu du bouclier, et ce
    // n'est pas un oubli : sans mémoire ni VOD, le bouton ⏪ est
    // grisé et cette barre ne s'ouvre pas — il faut bien pouvoir
    // armer la chaîne de quelque part.

    function dvrSettingsChannel() {

        return dvrChannelInUse || getTestChannel();

    }


    function dvrRenderSettingsMenu() {

        var menu = dvrSettingsMenu();

        if (!menu) {
            return;
        }

        var channel = dvrSettingsChannel();

        var blocked = dvrMemoryBlocked(channel);

        // Grisé plutôt que retiré : l'option existe toujours, elle
        // n'a simplement rien à faire ici — et son infobulle le dit,
        // sans quoi un interrupteur mort passe pour une panne.
        var armed = isDvrChannelArmed(channel) && !blocked;

        var seconds =
            pageConfig.dvrBufferSeconds ||
            DEFAULT_DVR_BUFFER_SECONDS;

        var index = DVR_BUFFER_STEPS.indexOf(seconds);

        if (index < 0) {

            index = DVR_BUFFER_STEPS.indexOf(
                DEFAULT_DVR_BUFFER_SECONDS
            );

        }

        var auto = pageConfig.dvrAutoOpen || 'never';

        menu.innerHTML =

            '<div class="tp9dvr-set-head">Retour arrière</div>' +

            '<label class="tp9dvr-set-row' +
                (blocked ? ' tp9dvr-set-row-off' : '') + '"' +
                ' data-tp9-tip="' +
                (blocked
                    ? 'Inutile sur cette chaîne'
                    : 'Garder cette chaîne en mémoire') +
                '" data-tp9-tip-sub="' +
                (blocked
                    ? 'Cette chaîne a un VOD exploitable : il remonte à tout le stream, là où la mémoire ne garderait que quelques minutes — en mangeant de la RAM en permanence. La capture est donc coupée tant que le VOD est là, et elle repartira toute seule s\'il disparaît.'
                    : 'Enregistre les dernières minutes de ' +
                        escapeHTML(channel || 'cette chaîne') +
                        ' dans la RAM pour pouvoir les rejouer. Ça coûte de la mémoire en permanence, donc ça ne s\'arme que là où tu le demandes. Le VOD, lui, reste utilisable sans rien armer.') +
                '">' +
                '<span class="tp9dvr-set-label">Mémoire · ' +
                    escapeHTML(channel || '—') +
                '</span>' +
                '<span class="tp9dvr-set-switch">' +
                    '<input type="checkbox" class="tp9dvr-set-armed"' +
                    (armed ? ' checked' : '') +
                    (channel && !blocked ? '' : ' disabled') + '>' +
                    '<span class="tp9dvr-set-track"></span>' +
                '</span>' +
            '</label>' +

            '<div class="tp9dvr-set-block' +
                (armed ? '' : ' tp9dvr-set-idle') + '"' +
                ' data-tp9-tip="Profondeur gardée en mémoire"' +
                ' data-tp9-tip-sub="Combien de passé la mémoire retient. Plus c\'est long, plus ça prend de RAM — l\'estimation dessous est calculée sur ton débit réellement mesuré. Il en faut au moins 30 s pour pouvoir reculer d\'un cran.">' +
                '<div class="tp9dvr-set-line">' +
                    '<span class="tp9dvr-set-label">Profondeur</span>' +
                    '<span class="tp9dvr-set-value">' +
                        escapeHTML(dvrBufferLabel(seconds)) +
                    '</span>' +
                '</div>' +

                // L'avancement de l'enregistrement ne vit plus ici :
                // il fallait ouvrir un menu pour lire une valeur qui
                // bouge à la seconde. Il est passé au-dessus de la
                // timeline (voir dvrUpdateBufferMeta).

                '<input type="range" class="tp9dvr-set-range" min="0" max="' +
                    (DVR_BUFFER_STEPS.length - 1) +
                    '" step="1" value="' + index + '">' +
                '<div class="tp9dvr-set-hint"></div>' +
            '</div>' +

            '<label class="tp9dvr-set-row"' +
                ' data-tp9-tip="Ouvrir cette barre toute seule"' +
                ' data-tp9-tip-sub="En arrivant sur une chaîne. « Si un VOD existe » ne l\'ouvre que là où il y a vraiment du passé à rejouer : ailleurs, le lecteur Twitch reste seul.">' +
                '<span class="tp9dvr-set-label">Ouvrir tout seul</span>' +
                '<select class="tp9dvr-set-auto">' +
                    '<option value="never"' +
                        (auto === 'never' ? ' selected' : '') +
                        '>Jamais</option>' +
                    '<option value="vod"' +
                        (auto === 'vod' ? ' selected' : '') +
                        '>Si un VOD existe</option>' +
                    '<option value="always"' +
                        (auto === 'always' ? ' selected' : '') +
                        '>Toujours</option>' +
                '</select>' +
            '</label>' +

            '<div class="tp9dvr-set-foot"></div>';

        dvrUpdateSettingsHint();

        dvrWireSettingsMenu();

    }


    // « preview » : la valeur que le curseur affiche pendant qu'on le
    // tire, avant enregistrement.
    function dvrUpdateSettingsHint(preview) {

        var menu = dvrSettingsMenu();

        if (!menu) {
            return;
        }

        var seconds =
            preview ||
            pageConfig.dvrBufferSeconds ||
            DEFAULT_DVR_BUFFER_SECONDS;

        var channel = dvrSettingsChannel();

        var blocked = dvrMemoryBlocked(channel);

        var armed = isDvrChannelArmed(channel) && !blocked;

        var held = armed ? dvrBufferRawDepthFor(channel) : 0;

        // ---- ce que la profondeur choisie coûtera ----

        var hint = menu.querySelector('.tp9dvr-set-hint');

        if (hint) {

            hint.textContent =
                'Plafond ≈ ' +
                formatBytes(dvrEstimateBytes(seconds)) +
                ' de RAM · ' +
                (
                    getLiveThroughputBps()
                        ? 'd\'après ton débit mesuré'
                        : 'estimation, aucun débit mesuré pour l\'instant'
                );

        }

        var foot = menu.querySelector('.tp9dvr-set-foot');

        if (!foot) {
            return;
        }

        var parts = [];

        if (held > 0) {

            parts.push(
                held >= DVR_MIN_BUFFER_SECONDS
                    ? 'Mémoire : ' + dvrFormatReach(held) + ' rejouables'
                    : 'Mémoire : ' + Math.round(held) + ' s sur les ' +
                        DVR_MIN_BUFFER_SECONDS + ' s qu\'il faut pour reculer'
            );

        } else if (blocked) {

            parts.push('Mémoire : coupée, le VOD couvre déjà tout');

        } else if (armed) {

            parts.push('Mémoire : rien d\'enregistré pour l\'instant');

        }

        var vod = dvrVodInfoFor(channel);

        if (vod) {

            parts.push(
                'VOD : jusqu\'à ' +
                dvrFormatReach(dvrVodDepthSeconds(vod))
            );

        }

        foot.textContent = parts.join(' · ');

    }


    // Tant que le curseur est tenu, le tick n'a pas à réécrire les
    // chiffres sous la main : c'est l'aperçu du glissement qui
    // commande.
    var dvrSettingsDragging = false;

    var dvrSettingsTickAt = 0;

    // Le panneau reste ouvert pendant que la mémoire se remplit :
    // il doit donc vivre, pas afficher une photo prise à
    // l'ouverture. Deux fois par seconde suffit pour des chiffres
    // qui bougent à la seconde.
    function dvrTickSettingsMenu() {

        var menu = dvrSettingsMenu();

        if (
            !menu ||
            !menu.classList.contains('tp9dvr-menu-on') ||
            dvrSettingsDragging
        ) {
            return;
        }

        var now = Date.now();

        if ((now - dvrSettingsTickAt) < 500) {
            return;
        }

        dvrSettingsTickAt = now;

        // L'armement a pu changer depuis le menu du bouclier : là il
        // faut reconstruire, le bloc de profondeur se grise avec lui.
        var box = menu.querySelector('.tp9dvr-set-armed');

        if (
            box &&
            box.checked !== isDvrChannelArmed(dvrSettingsChannel())
        ) {

            dvrRenderSettingsMenu();

            return;

        }

        dvrUpdateSettingsHint();

    }


    function dvrWireSettingsMenu() {

        var menu = dvrSettingsMenu();

        if (!menu) {
            return;
        }

        var armedBox = menu.querySelector('.tp9dvr-set-armed');

        if (armedBox) {

            armedBox.addEventListener(
                'change',
                function (event) {

                    setDvrChannelArmed(
                        dvrSettingsChannel(),
                        event.target.checked
                    );

                    if (dashboard) {
                        renderDashboardSettings();
                    }

                    // Le panneau se reconstruit : le bloc de
                    // profondeur se grise ou se réveille avec lui.
                    dvrRenderSettingsMenu();

                    dvrPlaceMenu(
                        menu,
                        dvrOverlay.querySelector('.tp9dvr-settings')
                    );

                    positionDvrButton();

                }
            );

        }

        var range = menu.querySelector('.tp9dvr-set-range');

        if (range) {

            // L'estimation suit le curseur pendant qu'on le tire,
            // mais on n'enregistre qu'au relâchement.
            range.addEventListener(
                'input',
                function (event) {

                    dvrSettingsDragging = true;

                    var value =
                        DVR_BUFFER_STEPS[
                            parseInt(event.target.value, 10)
                        ] ||
                        DEFAULT_DVR_BUFFER_SECONDS;

                    var label =
                        menu.querySelector('.tp9dvr-set-value');

                    if (label) {
                        label.textContent = dvrBufferLabel(value);
                    }

                    dvrUpdateSettingsHint(value);

                }
            );

            range.addEventListener(
                'change',
                function (event) {

                    dvrSettingsDragging = false;

                    pageConfig.dvrBufferSeconds =
                        DVR_BUFFER_STEPS[
                            parseInt(event.target.value, 10)
                        ] ||
                        DEFAULT_DVR_BUFFER_SECONDS;

                    saveConfig(pageConfig);

                    broadcastConfig();

                    dvrUpdateSettingsHint();

                    if (dashboard) {
                        renderDashboardSettings();
                    }

                }
            );

        }

        var autoSelect = menu.querySelector('.tp9dvr-set-auto');

        if (autoSelect) {

            autoSelect.addEventListener(
                'change',
                function (event) {

                    pageConfig.dvrAutoOpen = event.target.value;

                    saveConfig(pageConfig);

                    broadcastConfig();

                    // Le réglage vient de changer : on rend sa
                    // chance à l'ouverture automatique.
                    dvrAutoOpenedFor = null;

                    if (dashboard) {
                        renderDashboardSettings();
                    }

                }
            );

        }

    }


    function dvrToggleSettingsMenu() {

        var menu = dvrSettingsMenu();

        if (!menu) {
            return;
        }

        var open = menu.classList.contains('tp9dvr-menu-on');

        dvrCloseMenu();

        if (open) {
            return;
        }

        dvrRenderSettingsMenu();

        menu.classList.add('tp9dvr-menu-on');

        dvrMenuOpen = true;

        dvrPlaceMenu(
            menu,
            dvrOverlay.querySelector('.tp9dvr-settings')
        );

        dvrShowBar();

    }


    function dvrToggleQualityMenu() {

        var menu = dvrQualityMenu();

        if (!menu) {
            return;
        }

        // L'état du menu LUI-MÊME, et non « un panneau est ouvert » :
        // sinon, cliquer la qualité alors que les réglages sont
        // ouverts se contentait de tout refermer.
        var open = menu.classList.contains('tp9dvr-menu-on');

        dvrCloseMenu();

        if (open) {
            return;
        }

        var levels = dvrQualityLevels();

        if (!levels.length) {
            return;
        }

        var rows = [
            '<button type="button" data-level="-1"' +
            (dvrManualLevel < 0
                ? ' class="tp9dvr-menu-active"'
                : '') +
            '>Auto</button>'
        ];

        // Du plus fin au plus grossier, comme chez Twitch.
        var order = levels
            .map(function (level, index) {
                return { level: level, index: index };
            })
            .sort(function (a, b) {
                return (b.level.height || 0) - (a.level.height || 0);
            });

        order.forEach(
            function (entry) {

                rows.push(
                    '<button type="button" data-level="' +
                    entry.index + '"' +
                    (dvrManualLevel === entry.index
                        ? ' class="tp9dvr-menu-active"'
                        : '') +
                    '>' +
                    // Sans résolution, dvrLevelName rend l'attribut NAME
                    // de la playlist : une chaîne qui vient du réseau,
                    // donc jamais concaténée telle quelle dans innerHTML.
                    escapeHTML(dvrLevelName(entry.level)) +
                    '</button>'
                );

            }
        );

        menu.innerHTML = rows.join('');

        menu.classList.add('tp9dvr-menu-on');

        dvrMenuOpen = true;

        // Posé une fois affiché : sa largeur n'est mesurable qu'à
        // partir de là.
        dvrPlaceQualityMenu();

        // La barre ne doit pas s'effacer sous un menu ouvert : voir
        // le garde de dvrHideBar.
        dvrShowBar();

    }


    // ------------------------------------------------------------
    // COMMANDES QUI APPARTIENNENT À TWITCH
    // ------------------------------------------------------------
    //
    // Découper un clip ou passer en mode cinéma n'a pas d'équivalent
    // de notre côté : un clip se taille dans le direct, et le mode
    // cinéma réagence la PAGE. On clique donc le bouton de Twitch
    // depuis le nôtre. Les sélecteurs dépendent de son markup —
    // s'ils ne répondent plus, notre bouton disparaît au lieu de
    // faire semblant.

    var DVR_TWITCH_CONTROLS = {

        clip: [
            '[data-a-target="player-clip-button"]',
            '[data-test-selector="player-clip-button"]',
            'button[aria-label="Clip"]',
            'button[aria-label="Créer un clip"]',
            'button[aria-label*="clip" i]'
        ],

        theatre: [
            '[data-a-target="player-theatre-mode-button"]',
            'button[aria-label="Mode cinéma"]',
            'button[aria-label*="cinéma" i]',
            'button[aria-label*="theatre" i]'
        ],

        pip: [
            '[data-a-target="player-picture-by-picture-button"]',
            '[data-a-target="player-pip-button"]',
            'button[aria-label="Miniature"]',
            'button[aria-label*="miniature" i]',
            'button[aria-label*="picture" i]'
        ],

        // Le plein écran aussi s'emprunte, et c'était le seul à ne
        // pas l'être : findPlayer() renvoie le premier ancêtre de la
        // vidéo assez grand, qui n'est PAS l'élément que Twitch met
        // en plein écran. On se retrouvait sur un plein écran amputé
        // — ni notre barre, ni les commandes de Twitch — dont seul
        // Échap permettait de sortir.
        fullscreen: [
            '[data-a-target="player-fullscreen-button"]',
            'button[aria-label="Plein écran"]',
            'button[aria-label*="plein écran" i]',
            'button[aria-label*="fullscreen" i]'
        ]

    };


    // La roue dentée de Twitch et l'entrée « Qualité » de son menu :
    // sur le direct, c'est son lecteur qui a l'image, donc lui qui a
    // la qualité (voir dvrOpenTwitchQuality).
    var DVR_TWITCH_SETTINGS = [
        '[data-a-target="player-settings-button"]',
        'button[aria-label="Paramètres"]',
        'button[aria-label="Settings"]',
        'button[aria-label*="paramètre" i]'
    ];

    // Comment savoir que le menu de Twitch est DÉJÀ ouvert : son
    // bouton l'annonce (aria-expanded), et à défaut le menu lui-même
    // n'existe dans le DOM que déplié.
    var DVR_TWITCH_SETTINGS_MENU = [
        '[data-a-target="player-settings-menu"]',
        '[data-a-target="player-settings-menu-item-quality"]',
        '[data-a-target="player-settings-submenu-quality-option"]'
    ];

    var DVR_TWITCH_QUALITY_ITEM = [
        '[data-a-target="player-settings-menu-item-quality"]',
        '[data-a-target="player-settings-submenu-quality-option"]'
    ];


    // Le lecteur d'abord, la page ensuite : plusieurs de ces boutons
    // vivent HORS du conteneur que findPlayer renvoie, et s'y
    // limiter était la raison pour laquelle « clip » et
    // « miniature » disparaissaient purement et simplement.
    //
    // Le try/catch couvre les sélecteurs à drapeau « i », qu'un
    // navigateur ancien refuserait en bloc.
    function dvrQueryTwitch(list) {

        var root = findPlayer();

        for (var i = 0; i < list.length; i++) {

            try {

                var found =
                    (root && root.querySelector(list[i])) ||
                    document.querySelector(list[i]);

                if (found) {
                    return found;
                }

            } catch (e) {}

        }

        return null;

    }


    function dvrTwitchControl(name) {

        return dvrQueryTwitch(DVR_TWITCH_CONTROLS[name] || []);

    }


    // Lire l'état du menu de Twitch au moment du CLIC ne marche
    // pas, et c'est ce qui faisait échouer les deux corrections
    // précédentes : Twitch referme son menu dès le mousedown, sur un
    // clic n'importe où en dehors — donc y compris sur notre bouton,
    // qui vit dans un habillage à part. Quand notre gestionnaire de
    // clic tourne, le menu est déjà parti ; on le voyait fermé et on
    // le rouvrait aussitôt.
    //
    // On relève donc son état au pointerdown, qui précède le
    // mousedown, avant que Twitch n'ait eu la main.
    var dvrTwitchQualityWasOpen = false;

    // Notre propre minuteur est l'autre suspect : un second clic
    // arrivé dans les 140 ms rouvrirait « Qualité » par-dessus la
    // fermeture qu'on vient de demander.
    var dvrTwitchQualityTimer = null;


    function dvrTwitchQualityOpen() {

        var gear = dvrQueryTwitch(DVR_TWITCH_SETTINGS);

        return !!(
            (gear && gear.getAttribute('aria-expanded') === 'true') ||
            dvrQueryTwitch(DVR_TWITCH_SETTINGS_MENU)
        );

    }


    function dvrNoteTwitchQualityState() {

        dvrTwitchQualityWasOpen = dvrTwitchQualityOpen();

    }


    function dvrOpenTwitchQuality() {

        var wasOpen = dvrTwitchQualityWasOpen;

        dvrTwitchQualityWasOpen = false;

        if (dvrTwitchQualityTimer) {

            clearTimeout(dvrTwitchQualityTimer);

            dvrTwitchQualityTimer = null;

        }

        var gear = dvrQueryTwitch(DVR_TWITCH_SETTINGS);

        if (!gear) {

            dvrSetStatus(
                'Twitch ne propose pas ses réglages ici.',
                true
            );

            return;

        }

        // Il était ouvert quand on a appuyé : ce clic-ci le FERME.
        // Le plus souvent Twitch s'en est déjà chargé lui-même, et
        // il ne reste alors rien à faire — cliquer la roue dentée le
        // rouvrirait.
        if (wasOpen) {

            if (dvrTwitchQualityOpen()) {

                try {
                    gear.click();
                } catch (e) {}

            }

            return;

        }

        try {
            gear.click();
        } catch (e) {
            return;
        }

        // Le menu de Twitch n'est monté qu'après le clic : on le
        // laisse arriver avant de viser « Qualité ».
        dvrTwitchQualityTimer = setTimeout(
            function () {

                dvrTwitchQualityTimer = null;

                var item = dvrQueryTwitch(DVR_TWITCH_QUALITY_ITEM);

                if (item) {

                    try {
                        item.click();
                    } catch (e) {}

                }

            },
            140
        );

    }


    function dvrClickTwitchControl(name, label) {

        var button = dvrTwitchControl(name);

        if (!button) {

            dvrSetStatus(
                'Twitch ne propose pas « ' + label +
                ' » ici.',
                true
            );

            return;

        }

        try {
            button.click();
        } catch (e) {}

    }


    function dvrWireControls() {

        var playButton =
            dvrOverlay.querySelector('.tp9dvr-play');

        var seek =
            dvrOverlay.querySelector('.tp9dvr-seek');

        var volume =
            dvrOverlay.querySelector('.tp9dvr-vol');

        var mute =
            dvrOverlay.querySelector('.tp9dvr-mute');


        // Le volume du lecteur Twitch a été repris à l'ouverture
        // (voir openDvr) : il ne reste qu'à l'appliquer aux deux
        // lecteurs, au curseur et au bouton.
        dvrPushVolume();


        // La molette est écoutée sur le document, pour tout le
        // lecteur et même barre fermée : voir watchPlayerWheel.


        playButton.addEventListener(
            'click',
            function () {

                // Sur le direct, ce n'est ni le même lecteur qu'on
                // fige ni au même endroit qu'on reprend : voir
                // dvrPauseLive.
                if (dvrIsLive()) {

                    if (dvrIsLivePaused()) {
                        dvrResumeLive();
                    } else {
                        dvrPauseLive();
                    }

                    return;

                }

                if (dvrVideo.paused) {

                    var played = dvrVideo.play();

                    if (played && played.catch) {
                        played.catch(function () {});
                    }

                } else {

                    dvrVideo.pause();

                }

                dvrRefreshControls();

            }
        );


        dvrOverlay
            .querySelector('.tp9dvr-back')
            .addEventListener(
                'click',
                function () {

                    dvrShowSkipHint(true);

                    dvrGoToOffset(
                        dvrAimOffset() + DVR_SKIP_SECONDS
                    );

                }
            );


        dvrOverlay
            .querySelector('.tp9dvr-fwd')
            .addEventListener(
                'click',
                function () {

                    if (dvrIsLive()) {
                        return;
                    }

                    dvrShowSkipHint(false);

                    var next = dvrAimOffset() - DVR_SKIP_SECONDS;

                    if (next < 1) {
                        next = 1;
                    }

                    dvrGoToOffset(next);

                }
            );


        // Revient au direct SANS fermer la barre : on reste prêt à
        // repartir en arrière.
        dvrOverlay
            .querySelector('.tp9dvr-live')
            .addEventListener(
                'click',
                function () {

                    dvrEnterLiveMode();

                }
            );



        // AVANT que Twitch ne referme son propre menu : voir
        // dvrOpenTwitchQuality.
        dvrOverlay
            .querySelector('.tp9dvr-quality')
            .addEventListener(
                'pointerdown',
                dvrNoteTwitchQualityState
            );


        dvrOverlay
            .querySelector('.tp9dvr-quality')
            .addEventListener(
                'click',
                function () {

                    if (dvrIsLive()) {

                        dvrOpenTwitchQuality();

                        return;

                    }

                    dvrToggleQualityMenu();

                }
            );


        dvrOverlay
            .querySelector('.tp9dvr-settings')
            .addEventListener(
                'click',
                function () {

                    dvrToggleSettingsMenu();

                }
            );


        dvrQualityMenu().addEventListener(
            'click',
            function (event) {

                var button =
                    event.target.closest &&
                    event.target.closest('button[data-level]');

                if (!button || !dvrHls) {
                    return;
                }

                dvrManualLevel =
                    parseInt(button.dataset.level, 10);

                dvrHls.currentLevel = dvrManualLevel;

                dvrCloseMenu();

                dvrRefreshControls();

            }
        );


        dvrOverlay
            .querySelector('.tp9dvr-clip')
            .addEventListener(
                'click',
                function () {

                    dvrClickTwitchControl('clip', 'Clip');

                }
            );


        dvrOverlay
            .querySelector('.tp9dvr-theatre')
            .addEventListener(
                'click',
                function () {

                    dvrClickTwitchControl(
                        'theatre',
                        'Mode cinéma'
                    );

                }
            );


        // La miniature, elle, marche sur NOTRE vidéo quand c'est elle
        // qui joue : inutile de passer par Twitch, dont le lecteur
        // est muet à ce moment-là.
        dvrOverlay
            .querySelector('.tp9dvr-pip')
            .addEventListener(
                'click',
                function () {

                    // La vidéo qui joue : celle de Twitch en direct,
                    // la nôtre dans le passé. On ne dépend plus de
                    // son bouton à lui, qu'il n'affiche pas partout.
                    var video = dvrActiveVideo();

                    try {

                        if (document.pictureInPictureElement) {

                            document.exitPictureInPicture();

                        } else if (
                            video &&
                            video.requestPictureInPicture
                        ) {

                            var asked =
                                video.requestPictureInPicture();

                            if (asked && asked.catch) {

                                asked.catch(function () {

                                    dvrClickTwitchControl(
                                        'pip',
                                        'Miniature'
                                    );

                                });

                            }

                        } else {

                            dvrClickTwitchControl('pip', 'Miniature');

                        }

                    } catch (e) {

                        dvrClickTwitchControl('pip', 'Miniature');

                    }

                }
            );


        dvrOverlay
            .querySelector('.tp9dvr-full')
            .addEventListener(
                'click',
                function () {

                    if (document.fullscreenElement) {

                        document.exitFullscreen();

                        return;

                    }

                    // Le bouton de Twitch d'abord : lui seul connaît
                    // l'élément qu'il faut passer en plein écran, et
                    // c'est aussi le seul moyen que SES propres
                    // commandes suivent. dvrHost() nous fait déménager
                    // dans l'élément plein écran, positionDvrOverlay
                    // nous cale dessus.
                    var native = dvrTwitchControl('fullscreen');

                    if (native) {

                        try {
                            native.click();
                        } catch (e) {}

                        return;

                    }

                    // Repli : le conteneur qu'on devine. Jamais notre
                    // habillage — en mode direct c'est Twitch qui a
                    // l'image, un habillage transparent dont la vidéo
                    // est masquée donnerait un écran noir.
                    var target = findPlayer();

                    if (target && target.requestFullscreen) {

                        target.requestFullscreen();

                    }

                }
            );


        mute.addEventListener(
            'click',
            function () {

                dvrApplyVolume(
                    dvrVolumeLevel,
                    !dvrVolumeMuted
                );

                // Le curseur seul ne dit pas ce qui vient de se
                // passer quand il était déjà au bout : le chiffre,
                // si.
                dvrShowVolumeHint(
                    dvrEffectiveVolume(),
                    dvrVolumeMuted
                );

            }
        );


        volume.addEventListener(
            'input',
            function (event) {

                var level =
                    parseInt(event.target.value, 10) / 100;

                dvrApplyVolume(level, level === 0);

            }
        );


        seek.addEventListener(
            'pointerdown',
            function () {

                dvrScrubbing = true;

            }
        );


        // Le repère de lecture est dessiné par le calque, pas par
        // la pastille : sans ça il n'avancerait qu'au tick suivant,
        // soit un quart de seconde derrière la main.
        seek.addEventListener(
            'input',
            function () {

                dvrPaintTimeline(
                    dvrTimelineMax(dvrChannelInUse)
                );

            }
        );


        // Le temps survolé s'écrit dans le titre de l'infobulle de
        // la barre. Posé sur le CADRE et non sur l'input : c'est lui
        // qui porte l'infobulle, et il continue de recevoir la
        // souris quand la barre devient inerte.
        var seekWrap =
            dvrOverlay.querySelector('.tp9dvr-seek-wrap');

        seekWrap.addEventListener(
            'mousemove',
            function (event) {

                // Le temps survolé d'abord : dvrKeepSeekTooltip lit
                // l'attribut que celui-ci vient d'écrire.
                dvrTrackHover(seekWrap, event.clientX);

                dvrKeepSeekTooltip(seekWrap);

            }
        );

        seekWrap.addEventListener(
            'mouseleave',
            function () {

                dvrHoverOffset = null;

                seekWrap.dataset.tp9Tip = dvrTimelineTitle();

            }
        );


        seek.addEventListener(
            'change',
            function (event) {

                dvrScrubbing = false;

                var max =
                    dvrTimelineMax(dvrChannelInUse);

                var ratio =
                    parseInt(event.target.value, 10) / 1000;

                var offset = max * (1 - ratio);

                if (offset < 1) {
                    offset = 1;
                }

                dvrGoToOffset(offset);

            }
        );


        dvrVideo.addEventListener(
            'ended',
            function () {

                // On a rattrapé le direct : il n'y a plus rien à
                // rejouer, le lecteur Twitch reprend la main — sans
                // fermer la barre, on peut vouloir repartir.
                dvrEnterLiveMode();

            }
        );


        dvrVideo.addEventListener(
            'play',
            dvrRefreshControls
        );

        dvrVideo.addEventListener(
            'pause',
            dvrRefreshControls
        );

    }


    // Ce que la mémoire a déjà, ce qu'elle vise, ce qu'elle
    // coûte, et jusqu'où le VOD remonte — en une ligne, au-dessus
    // de la timeline. C'est une valeur qui bouge à la seconde :
    // elle n'a rien à faire derrière un menu à ouvrir.
    function dvrUpdateBufferMeta() {

        if (!dvrOverlay) {
            return;
        }

        var meta = dvrOverlay.querySelector('.tp9dvr-meta');

        if (!meta) {
            return;
        }

        var channel = dvrChannelInUse;

        var parts = [];

        if (isDvrChannelArmed(channel)) {

            var target =
                pageConfig.dvrBufferSeconds ||
                DEFAULT_DVR_BUFFER_SECONDS;

            var held = dvrBufferRawDepthFor(channel);

            if (held > 0) {

                var pct = target > 0
                    ? Math.min(100, (held / target) * 100)
                    : 0;

                parts.push(
                    'Mémoire ' +
                    dvrBufferLabel(Math.round(held)) +
                    ' / ' +
                    dvrBufferLabel(target) +
                    ' · ' +
                    Math.round(pct) + ' %' +
                    (
                        dvrSegmentsBytes > 0
                            ? ' · ' + formatBytes(dvrSegmentsBytes)
                            : ''
                    ) +
                    // Plein, la mémoire ne s'accumule plus : elle
                    // glisse. Ce n'est pas un défaut, c'est le
                    // régime normal, et il vaut d'être nommé.
                    (pct >= 99.5 ? ' · au maximum' : '')
                );

            } else {

                parts.push('Mémoire · en attente des premiers segments…');

            }

        }

        var vod = dvrVodInfoFor(channel);

        if (vod) {

            parts.push(
                'VOD ' + dvrFormatReach(dvrVodDepthSeconds(vod))
            );

        }

        var text = parts.join('   ·   ');

        // Comparé avant d'écrire : ce tick tourne quatre fois par
        // seconde, et réécrire un textContent identique invalide
        // la mise en page pour rien.
        if (meta.textContent !== text) {
            meta.textContent = text;
        }

    }


    function dvrRefreshControls() {

        if (!dvrOverlay || !dvrVideo) {
            return;
        }

        var live = dvrIsLive();

        var livePaused = dvrIsLivePaused();

        // Sur le direct, le bouton ne vaut que si on sait rattraper
        // ce qu'on va manquer pendant le gel (voir dvrPauseLive).
        var pauseKind = live ? dvrLivePauseKind() : null;

        var paused = live ? livePaused : dvrVideo.paused;

        // Pendant un gel, il y a de nouveau quelque chose devant, et
        // un direct à rejoindre.
        var atLiveEdge = live && !livePaused;

        var playButton =
            dvrOverlay.querySelector('.tp9dvr-play');

        if (playButton) {

            playButton.innerHTML =
                paused
                    ? DVR_ICONS.play
                    : DVR_ICONS.pause;

            // Plus jamais grisé sur le direct : notre barre masque
            // celle de Twitch, la refuser reviendrait à supprimer la
            // pause. Sans mémoire ni VOD, elle fige simplement
            // l'image et la reprise repart au direct.
            playButton.disabled = false;

            playButton.dataset.tp9Tip =
                paused ? 'Reprendre' : 'Pause';

            if (live) {

                playButton.dataset.tp9TipSub = paused
                    ? (pauseKind === 'plain'
                        ? "Repart au direct : cette chaîne n'a ni mémoire armée ni VOD pour rattraper."
                        : "Reprend là où tu t'es arrêté, pas au direct.")
                    : (pauseKind === 'vod'
                        ? 'Arrête le direct, téléchargement compris ; la reprise repart de là, lue dans le VOD.'
                        : pauseKind === 'buffer'
                            ? "Fige l'image ; le direct continue derrière pour remplir la mémoire, et la reprise repart de là."
                            : "Fige l'image. Sans mémoire armée ni VOD, la reprise repartira au direct : arme le retour arrière (roue dentée) pour rattraper.");

            } else {

                playButton.dataset.tp9TipSub =
                    'Fige la lecture du passé ; le direct, lui, continue derrière.';

            }

        }

        var back =
            dvrOverlay.querySelector('.tp9dvr-back');

        if (back) {

            // Reculer de 30 s alors que la mémoire n'en a que 12
            // revenait à reculer de 12 s puis à retomber au direct
            // dans la foulée : le bouton le dit au lieu de le faire.
            var reach = dvrMaxOffsetFor(dvrChannelInUse);

            back.disabled = reach < DVR_SKIP_SECONDS;

            if (back.disabled) {

                var held =
                    Math.round(dvrBufferRawDepthFor(dvrChannelInUse));

                back.dataset.tp9TipSub =
                    'Il faut au moins ' + DVR_SKIP_SECONDS +
                    ' s à rejouer. La mémoire en a ' + held +
                    ' s, et cette chaîne n\'a pas de VOD exploitable.';

            } else {

                back.dataset.tp9TipSub =
                    'Repart 30 secondes plus tôt que la position actuelle.';

            }

        }

        var forward =
            dvrOverlay.querySelector('.tp9dvr-fwd');

        if (forward) {

            forward.disabled = atLiveEdge;

            forward.dataset.tp9TipSub = atLiveEdge
                ? "Tu es déjà au direct : il n'y a rien devant."
                : 'Se rapproche du direct de 30 secondes.';

        }

        var liveButton =
            dvrOverlay.querySelector('.tp9dvr-live');

        if (liveButton) {

            liveButton.disabled = atLiveEdge;

            liveButton.dataset.tp9TipSub = atLiveEdge
                ? 'Tu y es déjà.'
                : 'Sans fermer la barre : tu peux repartir en arrière juste après.';

        }

        var mute =
            dvrOverlay.querySelector('.tp9dvr-mute');

        if (mute) {

            // L'état, et non ce qu'en dit le lecteur : c'est leur
            // désaccord qui affichait « muet » alors que le son
            // sortait toujours.
            var silent = dvrVolumeMuted;

            mute.innerHTML = silent
                ? DVR_ICONS.volumeOff
                : DVR_ICONS.volume;

            mute.dataset.tp9Tip =
                silent ? 'Rétablir le son' : 'Couper le son';

        }

        var source =
            dvrOverlay.querySelector('.tp9dvr-source');

        if (source) {

            // Gelé sur le direct, on n'y est plus : la pastille
            // rouge dirait le contraire de l'horloge juste à côté,
            // qui compte le retard qu'on est en train de prendre.
            source.textContent = live
                ? (livePaused ? 'en pause' : 'direct')
                : (dvrSourceKind === 'vod' ? 'VOD' : 'mémoire');

            source.classList.toggle(
                'tp9dvr-source-live',
                atLiveEdge
            );

            source.dataset.tp9Tip = live
                ? (livePaused ? 'Direct en pause' : 'Source : le direct')
                : (dvrSourceKind === 'vod'
                    ? 'Source : le VOD'
                    : 'Source : la mémoire');

            source.dataset.tp9TipSub = live
                ? (livePaused
                    ? "Le direct continue sans toi : la reprise repartira d'ici."
                    : "Le lecteur Twitch joue le direct : rien n'est remplacé tant que tu ne recules pas.")
                : (dvrSourceKind === 'vod'
                    ? 'Lu depuis le VOD que Twitch enregistre en parallèle du live.'
                    : 'Lu depuis les segments gardés en mémoire pour cette chaîne.');

        }

        var quality =
            dvrOverlay.querySelector('.tp9dvr-quality');

        if (quality) {

            var levels = dvrQualityLevels();

            // Sur le direct c'est Twitch qui a l'image, donc Twitch
            // qui a la qualité. Le bouton n'était pour autant pas à
            // griser : il ouvre son réglage à lui, ce qui vaut mieux
            // qu'une commande morte sans explication.
            var twitchQuality = live
                ? !!dvrQueryTwitch(DVR_TWITCH_SETTINGS)
                : false;

            quality.disabled = live
                ? !twitchQuality
                : levels.length < 2;

            quality.textContent = live
                ? dvrLiveQualityLabel()
                : dvrQualityLabel();

            // Le tick compare à CE qu'on vient d'écrire : sans
            // ça il croirait le libellé déjà à jour.
            dvrTwitchQualityShown = live
                ? quality.textContent
                : '';

            quality.dataset.tp9TipSub = live
                ? (twitchQuality
                    ? 'Rendu joué par le lecteur Twitch : ce bouton ouvre SON réglage de qualité.'
                    : 'Twitch n\'expose pas ses réglages ici.')
                : (levels.length < 2
                    ? "Cette source n'a qu'un seul rendu : la mémoire rejoue exactement ce que le lecteur téléchargeait."
                    : 'Change le rendu lu depuis ' +
                        (dvrSourceKind === 'vod' ? 'le VOD' : 'la mémoire') +
                        '.');

            if (quality.disabled) {
                dvrCloseQualityMenu();
            }

        }

        // Les commandes empruntées à Twitch disparaissent si son
        // markup ne les expose plus : mieux vaut un bouton absent
        // qu'un bouton qui ne fait rien.
        ['clip', 'theatre', 'pip'].forEach(
            function (name) {

                var button =
                    dvrOverlay.querySelector('.tp9dvr-' + name);

                if (!button) {
                    return;
                }

                // La miniature ne s'emprunte plus : on la demande
                // directement à la vidéo qui joue — celle de Twitch
                // en direct comme la nôtre dans le passé. Elle ne
                // disparaît donc plus en direct sous prétexte que
                // Twitch n'expose pas son propre bouton.
                var borrowed = name !== 'pip';

                button.style.display =
                    (borrowed && !dvrTwitchControl(name))
                        ? 'none'
                        : '';

            }
        );

    }

    function dvrTick() {

        if (!dvrOverlay || !dvrVideo) {
            return;
        }

        dvrSyncVolumeFromPlayer();

        dvrSyncBarWithTwitch();

        dvrTickSettingsMenu();

        dvrUpdateBufferMeta();

        dvrSyncTwitchQualityLabel();

        var pauseKind = dvrIsLive() ? dvrLivePauseKind() : null;

        if (pauseKind !== dvrLastPauseKind) {

            dvrLastPauseKind = pauseKind;

            dvrRefreshControls();

        }

        var offset = dvrCurrentOffset();

        // La mémoire est un playlist vivant : la lecture peut
        // maintenant courir jusqu'au direct. Arrivé là, le lecteur
        // Twitch a l'image et le son — autant lui rendre la main.
        //
        // DEUX conditions, et non le seul retard calculé : celui-ci
        // dépend d'une horloge qui peut bouger, et il suffisait
        // d'une avance de buffer qui gonfle pour qu'un « -30 s »
        // tranquille reparte au direct sans rien demander.
        if (
            !dvrIsLive() &&
            !dvrSwitching &&
            !dvrVideo.paused &&
            offset <= DVR_LIVE_EDGE_SECONDS &&
            dvrAtEndOfSource()
        ) {

            dvrEnterLiveMode();

            return;

        }

        // Le retard AFFICHÉ, qui n'est pas celui que la lecture
        // occupe pendant une bascule : voir dvrDisplayOffset.
        // Le retour au direct, lui, se décide sur le vrai.
        var shown = dvrDisplayOffset(offset);

        var label =
            dvrOverlay.querySelector('.tp9dvr-time');

        if (label) {

            // Gelé sur le direct, l'horloge compte le retard qu'on
            // prend : c'est exactement de là qu'on repartira.
            label.textContent = (dvrIsLive() && !dvrIsLivePaused())
                ? 'DIRECT'
                : dvrFormatOffset(shown);

        }

        var timelineMax =
            dvrTimelineMax(dvrChannelInUse);

        if (!dvrScrubbing) {

            var seek =
                dvrOverlay.querySelector('.tp9dvr-seek');

            if (seek && timelineMax > 0) {

                var ratio = 1 - (shown / timelineMax);

                if (ratio < 0) {
                    ratio = 0;
                }

                if (ratio > 1) {
                    ratio = 1;
                }

                seek.value =
                    String(Math.round(ratio * 1000));

            }

        }

        // APRÈS la position, et peinte même pendant un glissement :
        // le repère de lecture est dessiné par le calque, il se
        // calerait donc sur la position précédente — un quart de
        // seconde de retard sur la pastille qu'on tient.
        dvrPaintTimeline(timelineMax);

        positionDvrOverlay();

    }


    // ------------------------------------------------------------
    // Ce que la barre de position CONTIENT
    // ------------------------------------------------------------
    //
    // Deux zones peintes sur la piste, à l'échelle demandée : la
    // mémoire et le VOD, chacune à sa vraie place. Voir DVR_CSS pour
    // la façon dont les bornes descendent jusqu'à la piste.
    function dvrPaintTimeline(max) {

        if (!dvrOverlay) {
            return;
        }

        var wrap =
            dvrOverlay.querySelector('.tp9dvr-seek-wrap');

        var seek =
            dvrOverlay.querySelector('.tp9dvr-seek');

        if (!wrap || !seek) {
            return;
        }

        var buffer = dvrSourceWindow('buffer');

        var vod = dvrSourceWindow('vod');

        // Aucune des deux sources n'a quoi que ce soit : mémoire
        // tout juste armée (moins de DVR_MIN_BUFFER_SECONDS
        // enregistrées), ou chaîne sans VOD et sans mémoire. La
        // barre promettait alors un passé qui n'existe pas, et
        // cliquer dedans ne donnait qu'un écran noir.
        var playable = !!(buffer || vod);

        seek.disabled = !playable;

        wrap.classList.toggle('tp9dvr-seek-off', !playable);

        dvrUpdateSeekWait(wrap, playable);

        var width = wrap.clientWidth;

        // Le retard croît vers la GAUCHE : le plus ancien instant
        // disponible est au bord gauche, le direct au bord droit.
        function place(zone, window) {

            if (!zone) {
                return;
            }

            if (!window || !(max > 0) || !width) {

                zone.style.display = 'none';

                return;

            }

            var left = (1 - window.max / max) * width;
            var right = (1 - window.min / max) * width;

            if (left < 0) {
                left = 0;
            }

            if (right > width) {
                right = width;
            }

            zone.style.display = '';

            zone.style.left = left + 'px';

            // Plancher de 2 px : les toutes premières secondes
            // enregistrées ne pèsent pas un pixel, et c'est
            // justement celles qu'on guette.
            zone.style.width =
                Math.max(2, right - left) + 'px';

        }

        place(
            dvrOverlay.querySelector('.tp9dvr-zone-buf'),
            buffer
        );

        place(
            dvrOverlay.querySelector('.tp9dvr-zone-vod'),
            vod
        );

        var head =
            dvrOverlay.querySelector('.tp9dvr-head');

        if (head && width) {

            head.style.left =
                (
                    (parseInt(seek.value, 10) || 0) / 1000 * width
                ) + 'px';

        }

        // L'infobulle dit en toutes lettres ce que les couleurs
        // montrent : « violet » et « bleu » ne veulent rien dire
        // tout seuls. Elle est portée par le cadre et non par
        // l'input, qui ne reçoit plus le survol une fois inerte.
        var parts = [];

        if (buffer) {

            parts.push(
                'Violet : mémoire, ' +
                dvrFormatReach(buffer.max - buffer.min)
            );

        }

        if (vod) {

            parts.push(
                'Bleu : VOD, ' +
                dvrFormatReach(vod.max - vod.min)
            );

        }

        wrap.dataset.tp9Tip = playable
            ? dvrTimelineTitle()
            : 'Rien à rejouer pour l\'instant';

        wrap.dataset.tp9TipSub = parts.length
            ? parts.join(' · ') + '. Tout à droite : le direct.'
            : dvrTimelineIdleTip();

        // Une bulle n'est écrite qu'à l'arrivée de la souris :
        // « la mémoire enregistre 12 s » restait donc affiché
        // une minute plus tard. Elle est réécrite à chaque tick
        // tant qu'elle est à l'écran — refreshTooltipText ne
        // fait rien si la bulle pointe ailleurs.
        refreshTooltipText(wrap);

    }


    // Ce qui prend la place de la piste quand elle s'en va.
    //
    // Une seule chose mérite d'être dite : la mémoire en train
    // de se remplir, parce qu'il y a quelque chose à attendre
    // et qu'on peut dire combien de temps. Partout ailleurs —
    // chaîne sans VOD et sans mémoire, flux que la mémoire ne
    // sait pas rejouer — la place reste tenue mais vide :
    // l'infobulle du cadre dit déjà pourquoi, à qui la demande.
    function dvrUpdateSeekWait(wrap, playable) {

        var wait = wrap.querySelector('.tp9dvr-seek-wait');

        if (!wait) {
            return;
        }

        var channel = dvrChannelInUse;

        var waiting =
            !playable &&
            !!channel &&
            isDvrChannelArmed(channel) &&
            !dvrMemoryBlocked(channel) &&
            dvrUnsupportedChannel !== channel &&
            dvrBlobProbe !== false;

        wrap.classList.toggle('tp9dvr-seek-waiting', waiting);

        if (!waiting) {
            return;
        }

        var held =
            Math.round(dvrBufferRawDepthFor(channel));

        var text =
            'Mémoire en cours… ' + held + ' s / ' +
            DVR_MIN_BUFFER_SECONDS + ' s';

        var label =
            wait.querySelector('.tp9dvr-seek-wait-text');

        // Comparé avant d'écrire : ce tick tourne quatre fois
        // par seconde pour une valeur qui change une fois.
        if (label && label.textContent !== text) {
            label.textContent = text;
        }

        var fill =
            wait.querySelector('.tp9dvr-seek-wait-fill');

        if (fill) {

            fill.style.width =
                Math.min(
                    100,
                    (held / DVR_MIN_BUFFER_SECONDS) * 100
                ) + '%';

        }

    }


    // Le retard que la souris désigne, tant qu'elle est sur la
    // barre : « Position dans le passé » tout court ne disait pas où
    // l'on pointait, et il fallait cliquer pour le savoir.
    var dvrHoverOffset = null;


    // Un clic ferme la bulle partagée, où qu'il ait lieu (voir le
    // dernier écouteur d'attachTooltips), et rien ne la rouvre tant
    // que la souris n'ENTRE pas à nouveau sur un élément — un
    // mouseover ne part qu'au franchissement de la bordure.
    //
    // Sur la timeline, c'est intenable : on y clique précisément
    // sans bouger de place, et le temps survolé disparaissait donc
    // au premier déplacement demandé, pour ne revenir qu'après être
    // sorti du curseur puis revenu dessus.
    //
    // On la rallume au premier mouvement, ce qu'on fait de toute
    // façon en manipulant une barre de position. Réservé à la
    // timeline : sur un bouton, la bulle qui se rouvre juste après
    // le clic n'aurait rien à apprendre à personne.
    function dvrKeepSeekTooltip(wrap) {

        if (tooltipTarget === wrap) {
            return;
        }

        showTooltipFor(wrap);

    }

    function dvrTimelineTitle() {

        return (
            'Position dans le passé' +
            (
                dvrHoverOffset === null
                    ? ''
                    : ' : ' + dvrFormatHover(dvrHoverOffset)
            )
        );

    }


    // Appelée à chaque mouvement de souris sur la barre : elle
    // convertit l'abscisse du curseur en retard, puis réécrit le
    // titre de l'infobulle en cours.
    function dvrTrackHover(wrap, clientX) {

        // Barre inerte : elle n'a aucune position à désigner, et son
        // titre dit déjà pourquoi.
        if (wrap.classList.contains('tp9dvr-seek-off')) {

            dvrHoverOffset = null;

            return;

        }

        var max = dvrTimelineMax(dvrChannelInUse);

        var rect = wrap.getBoundingClientRect();

        if (!(max > 0) || !rect.width) {

            dvrHoverOffset = null;

            return;

        }

        var ratio = (clientX - rect.left) / rect.width;

        if (ratio < 0) {
            ratio = 0;
        }

        if (ratio > 1) {
            ratio = 1;
        }

        // Le bord droit, c'est le direct : le retard croît vers la
        // gauche.
        dvrHoverOffset = max * (1 - ratio);

        wrap.dataset.tp9Tip = dvrTimelineTitle();

        refreshTooltipText(wrap);

    }


    // Pourquoi la barre ne répond pas. « Rien à rejouer » tout court
    // laisserait croire à une panne, alors qu'il n'y a le plus
    // souvent qu'à attendre quelques secondes.
    function dvrTimelineIdleTip() {

        var channel = dvrChannelInUse;

        if (dvrVodPendingFor(channel)) {
            return 'Recherche d\'un enregistrement en cours…';
        }

        if (isDvrChannelArmed(channel) && !dvrMemoryBlocked(channel)) {

            return (
                'La mémoire enregistre : ' +
                Math.round(dvrBufferRawDepthFor(channel)) +
                ' s sur les ' + DVR_MIN_BUFFER_SECONDS +
                ' s qu\'il faut pour pouvoir reculer d\'un cran.'
            );

        }

        return (
            'Aucun VOD exploitable sur cette chaîne, et la mémoire ' +
            'n\'est pas armée : arme-la dans les réglages (roue dentée).'
        );

    }


    function dvrStartTicker() {

        dvrStopTicker();

        dvrTicker = setInterval(dvrTick, 250);

    }


    function dvrStopTicker() {

        if (dvrTicker) {

            clearInterval(dvrTicker);

            dvrTicker = null;

        }

    }


    // ------------------------------------------------------------
    // Position : l'habillage se cale sur le lecteur Twitch
    // ------------------------------------------------------------

    function positionDvrOverlay() {

        if (!dvrOverlay) {
            return;
        }

        if (document.fullscreenElement === dvrOverlay) {

            dvrOverlay.style.position = 'fixed';
            dvrOverlay.style.left = '0';
            dvrOverlay.style.top = '0';
            dvrOverlay.style.width = '100%';
            dvrOverlay.style.height = '100%';

            return;

        }

        var host = dvrHost();

        if (dvrOverlay.parentNode !== host) {

            host.appendChild(dvrOverlay);

        }

        var player = findPlayer();

        if (!player) {

            closeDvr();

            return;

        }

        var rect = player.getBoundingClientRect();

        dvrOverlay.style.position = 'fixed';
        dvrOverlay.style.left = rect.left + 'px';
        dvrOverlay.style.top = rect.top + 'px';
        dvrOverlay.style.width = rect.width + 'px';
        dvrOverlay.style.height = rect.height + 'px';

    }


    // ------------------------------------------------------------
    // Bouton ⏪ à côté du bouton du menu
    // ------------------------------------------------------------

    function createDvrButton() {

        injectDvrCSS();

        dvrButton =
            document.createElement('button');

        dvrButton.id = 'tp9-dvr-button';

        dvrButton.type = 'button';

        // Un écran avec sa barre de lecture et son triangle : ce
        // bouton n'ouvre pas « un retour arrière », il ouvre un
        // LECTEUR complet (qualité, volume, pause sur le direct,
        // retour arrière). La flèche qui tournait ne racontait qu'un
        // dixième de ce qu'il y a derrière. Verte quand le lecteur
        // perso est ouvert, grise sinon — l'état se lit sans
        // survoler.
        dvrButton.innerHTML =
            '<svg width="17" height="17" viewBox="0 0 24 24"' +
            ' fill="none" stroke="currentColor" stroke-width="2"' +
            ' stroke-linecap="round" stroke-linejoin="round"' +
            ' aria-hidden="true">' +
            '<rect x="2.6" y="4.4" width="18.8" height="15.2" rx="2.4"/>' +
            '<path d="M2.6 15.2h18.8"/>' +
            '<path d="M10 8.2l4.2 2.4-4.2 2.4z"' +
            ' fill="currentColor" stroke-width="1.4"/>' +
            '<path d="M5.4 17.4h5.2"/>' +
            '</svg>';

        dvrButton.style.visibility = 'hidden';

        // Il ouvre ET il ferme : c'est maintenant le seul moyen
        // de rendre la main au lecteur Twitch. La croix de la
        // barre faisait doublon avec lui, elle a été retirée.
        dvrButton.addEventListener(
            'click',
            function () {

                if (dvrOverlay) {

                    closeDvr();

                    positionDvrButton();

                    return;

                }

                openDvr();

                positionDvrButton();

            }
        );

        document.body.appendChild(dvrButton);

        attachTooltips(dvrButton);

    }


    function positionDvrButton() {

        if (!dashboardButton) {
            return;
        }

        if (!dvrButton) {

            createDvrButton();

        }

        // Appelé d'ici parce que c'est déjà le point qui suit l'état
        // du VOD, une fois et demie par seconde.
        syncDvrMemorySuppression();

        var channel = getTestChannel();

        // Le bouton du menu connaît déjà toutes les raisons de ne pas
        // s'afficher (aperçu, mini-player, page sans lecteur) : on
        // suit sa décision plutôt que de la refaire.
        if (
            !channel ||
            dashboardButton.style.visibility === 'hidden'
        ) {

            dvrButton.style.visibility = 'hidden';

            return;

        }

        var bufferDepth = dvrBufferDepthFor(channel);

        var vodInfo = dvrVodInfoFor(channel);

        var armed = isDvrChannelArmed(channel);

        // Le lecteur perso s'ouvre TOUJOURS. Il était grisé tant
        // qu'il n'y avait ni VOD ni mémoire, comme s'il ne servait
        // qu'à reculer — alors que c'est une barre de lecture
        // complète : qualité, volume, pause sur le direct, et
        // l'accès à ses propres réglages, où l'on arme justement la
        // mémoire de la chaîne. Deux conséquences absurdes :
        //
        //   - sur une chaîne sans VOD ni mémoire, impossible de
        //     l'ouvrir du tout ;
        //   - l'ayant refermé sur une telle chaîne, impossible de le
        //     ROUVRIR sans recharger la page (ouvert, il restait
        //     cliquable puisque c'est lui qui referme).
        //
        // Ce qu'il y a à rejouer, ou pas, se lit maintenant dans
        // l'infobulle, et la timeline se montre d'elle-même quand
        // elle a quelque chose à montrer.
        dvrButton.disabled = false;

        dvrButton.classList.remove('tp9-dvr-off');

        dvrButton.classList.toggle(
            'tp9-dvr-armed',
            !!dvrOverlay
        );

        dvrButton.dataset.tp9Tip = dvrOverlay
            ? 'Fermer le Player Custom'
            : 'Player Custom';

        if (dvrOverlay) {

            dvrButton.dataset.tp9TipSub =
                'Rend la main à la barre du lecteur Twitch et à son son.';

            dvrButton.style.visibility = 'visible';

            dvrButton.style.position = 'fixed';

            positionDvrButtonAt();

            return;

        }

        var vodReach = vodInfo
            ? dvrFormatReach(dvrVodDepthSeconds(vodInfo))
            : null;

        var vodVia = (vodInfo && vodInfo.state === 'bypass')
            ? ' (VOD abonnés, lu en direct depuis le CDN)'
            : ' (VOD)';

        if (vodInfo && bufferDepth > 0) {

            dvrButton.dataset.tp9TipSub =
                'Jusqu\'à ' + vodReach + vodVia +
                ', et les ' + dvrFormatReach(bufferDepth) +
                ' les plus récentes en mémoire.';

        } else if (vodInfo) {

            dvrButton.dataset.tp9TipSub =
                'Jusqu\'à ' + vodReach + vodVia + '.';

        } else if (bufferDepth > 0) {

            dvrButton.dataset.tp9TipSub =
                dvrFormatReach(bufferDepth) + ' en mémoire pour cette chaîne.';

        } else if (dvrUnsupportedChannel === channel) {

            dvrButton.dataset.tp9TipSub =
                'Ce flux est diffusé dans un format que la mémoire ne sait pas rejouer, et il n\'y a pas de VOD exploitable sur cette chaîne.';

        } else if (dvrVodPendingFor(channel)) {

            dvrButton.dataset.tp9TipSub =
                'Recherche d\'un enregistrement en cours…';

        } else if (armed) {

            var waiting = Math.round(dvrBufferRawDepthFor(channel));

            dvrButton.dataset.tp9TipSub =
                'Aucun VOD exploitable sur cette chaîne. La mémoire enregistre : ' +
                waiting + ' s sur les ' + DVR_MIN_BUFFER_SECONDS +
                ' s qu\'il faut pour pouvoir reculer.';

        } else {

            dvrButton.dataset.tp9TipSub =
                'Aucun VOD exploitable sur cette chaîne, et la mémoire n\'est pas armée : ouvre-le et arme-la dans ses réglages (⚙) pour pouvoir reculer.';

        }

        // Posée devant, toujours : ce bouton n'ouvre pas seulement
        // un retour arrière, et il s'ouvre même quand il n'y a rien
        // à rejouer. La phrase construite au-dessus dit, elle, ce
        // qu'il y a de disponible sur CETTE chaîne.
        dvrButton.dataset.tp9TipSub =
            'Remplace la barre de Twitch : qualité, volume, pause sur le direct et retour arrière. ' +
            dvrButton.dataset.tp9TipSub;

        dvrButton.style.visibility = 'visible';

        dvrButton.style.position = 'fixed';

        positionDvrButtonAt();

    }


    function positionDvrButtonAt() {

        // La POSITION ÉCRITE du bouton du menu, jamais son cadre
        // mesuré : au survol il se soulève de 2 px (`--tp9-lift`),
        // et ce décalage entre dans son getBoundingClientRect().
        // Le bouton, recalculé en boucle, se soulevait donc avec
        // lui — les deux avaient l'air soudés. Le style en ligne,
        // lui, ignore les transformées.
        var rect =
            dashboardButton.getBoundingClientRect();

        var anchorLeft = parseFloat(dashboardButton.style.left);
        var anchorTop = parseFloat(dashboardButton.style.top);

        if (isNaN(anchorLeft)) {
            anchorLeft = rect.left;
        }

        if (isNaN(anchorTop)) {
            anchorTop = rect.top;
        }

        // Même écart que celui du bouton du menu au bouton Suivre
        // (44 px pour un bouton large de 40) : à 40 px, les deux
        // pastilles se touchaient presque.
        dvrButton.style.left =
            (anchorLeft - 44) + 'px';

        dvrButton.style.top =
            anchorTop + 'px';

        positionDvrOverlay();

    }


    // ------------------------------------------------------------
    // PAUSE FAITE SUR LE LECTEUR DE TWITCH LUI-MÊME
    // ------------------------------------------------------------
    //
    // Mettre le vrai lecteur en pause puis le relancer renvoie au
    // direct : Twitch n'a aucune idée de ce qu'on vient de manquer.
    // Le VOD, lui, l'a — il continue de s'enregistrer pendant ce
    // temps-là.
    //
    // On ne détourne pas la reprise pour autant : une pause sert
    // souvent à partir, pas à revenir en arrière. On propose, un
    // clic suffit, et ne rien faire laisse le direct comme avant.
    //
    // Sans VOD il n'y a rien à proposer : la mémoire ne se remplit
    // pas non plus pendant que le lecteur est arrêté.

    var NATIVE_PAUSE_MIN_MS = 15000;
    var NATIVE_PAUSE_MAX_MS = 4 * 60 * 60 * 1000;

    var nativePauseVideo = null;
    var nativePauseWasPlaying = false;
    var nativePauseAt = 0;
    var nativePauseChannel = null;

    function watchNativeTwitchPause() {

        // La barre est ouverte : c'est elle qui pilote la pause,
        // voir dvrPauseLive.
        if (dvrOverlay) {

            nativePauseAt = 0;

            return;

        }

        var channel = getTestChannel();

        var video = channel ? findPlaybackVideo() : null;

        if (!video) {

            nativePauseVideo = null;
            nativePauseAt = 0;

            return;

        }

        // Élément neuf (arrivée sur la chaîne, changement de
        // qualité, publicité) : on repart de ce qu'il fait sans
        // rien en conclure. Sinon la pause d'avant lecture, au
        // chargement de la page, passait pour une pause voulue.
        if (video !== nativePauseVideo) {

            nativePauseVideo = video;
            nativePauseWasPlaying = !video.paused;
            nativePauseAt = 0;
            nativePauseChannel = channel;

            return;

        }

        if (video.paused) {

            if (nativePauseWasPlaying && !nativePauseAt) {

                nativePauseAt = Date.now();
                nativePauseChannel = channel;

            }

            return;

        }

        nativePauseWasPlaying = true;

        if (!nativePauseAt) {
            return;
        }

        var pausedMs = Date.now() - nativePauseAt;

        var pausedChannel = nativePauseChannel;

        nativePauseAt = 0;

        if (
            pausedChannel !== channel ||
            pausedMs < NATIVE_PAUSE_MIN_MS ||
            pausedMs > NATIVE_PAUSE_MAX_MS
        ) {
            return;
        }

        if (!dvrVodInfoFor(channel)) {
            return;
        }

        showToast({

            icon: '⏪',

            title: "Reprendre où tu t'es arrêté ?",

            text:
                'Le lecteur est reparti au direct, mais le VOD a les ' +
                dvrFormatReach(pausedMs / 1000) +
                ' que tu viens de manquer.',

            ok: true,

            duration: 15000,

            actions: [
                {
                    label: '⏪ Rattraper',
                    onClick: function () {

                        hideToast();

                        openDvr(pausedMs / 1000);

                    }
                }
            ]

        });

    }


    // positionPlayerUI() a une demi-douzaine de sorties anticipées :
    // plutôt que d'y saupoudrer un appel à chacune, on l'enrobe une
    // fois. Le bouton ⏪ se cale sur la position que le bouton du
    // menu vient de prendre.
    // ------------------------------------------------------------
    // OUVERTURE AUTOMATIQUE DU LECTEUR PERSO
    // ------------------------------------------------------------
    //
    // Réglage « Lecteur perso par défaut » : jamais, seulement là où
    // un VOD existe, ou partout. Une seule tentative par chaîne —
    // refermer la barre à la main ne doit pas la voir revenir à la
    // seconde suivante.

    var dvrAutoOpenedFor = null;

    function maybeAutoOpenDvr(channel) {

        var mode = pageConfig.dvrAutoOpen || 'never';

        if (mode === 'never' || !channel) {
            return;
        }

        if (dvrAutoOpenedFor === channel) {
            return;
        }

        if (dvrOverlay) {

            dvrAutoOpenedFor = channel;

            return;

        }

        // Le bouton connaît déjà toutes les raisons de ne rien
        // afficher (aperçu, mini-player, page sans lecteur) : on
        // suit sa décision plutôt que de la refaire.
        if (
            !dvrButton ||
            dvrButton.style.visibility !== 'visible'
        ) {
            return;
        }

        // Pas encore de réponse sur le VOD : on laisse la recherche
        // finir plutôt que de conclure « il n'y en a pas » trop tôt.
        if (
            mode === 'vod' &&
            !dvrVodInfoFor(channel)
        ) {
            return;
        }

        if (!dvrSupported()) {
            return;
        }

        openDvr();

        // Marqué seulement si ça a vraiment ouvert : sinon on
        // s'interdirait de réessayer une seconde plus tard.
        if (dvrOverlay) {

            dvrAutoOpenedFor = channel;

            positionDvrButton();

        }

    }


    var dvrBasePositionPlayerUI = positionPlayerUI;

    positionPlayerUI = function () {

        dvrBasePositionPlayerUI();

        positionDvrButton();

        maybeAutoOpenDvr(getTestChannel());

    };


    // La molette règle le son sur tout le lecteur, barre ouverte ou
    // non : l'écouteur est donc posé une fois pour toutes.
    watchPlayerWheel();


    document.addEventListener(
        'fullscreenchange',
        function () {

            positionDvrOverlay();

        }
    );


    // Onglet fermé ou mis en cache arrière : le Worker peut
    // survivre à la page, ses Blob avec. On lui dit de tout rendre.
    window.addEventListener(
        'pagehide',
        function () {

            dvrSendClear();

        }
    );


    // ------------------------------------------------------------
    // Estimation mémoire du curseur de profondeur
    // ------------------------------------------------------------
    //
    // Calculée sur le débit RÉELLEMENT mesuré par le Worker quand il
    // y en a un : une table fixe se tromperait d'un facteur trois
    // entre du 480p et du 1080p60.

    function dvrEstimateBytes(seconds) {

        var bps =
            getLiveThroughputBps() ||
            DVR_FALLBACK_BYTES_PER_SECOND;

        return seconds * bps;

    }


    function injectDvrCSS() {

        if (
            document.getElementById('tp9-dvr-style')
        ) {
            return;
        }

        var style =
            document.createElement('style');

        style.id = 'tp9-dvr-style';

        style.textContent = DVR_CSS;

        document.head.appendChild(style);

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


        dashboardButton.dataset.tp9Tip = 'Twitch Proxy Manager';
        dashboardButton.dataset.tp9TipSub = 'Alt + P pour ouvrir ou fermer';

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

        attachTooltips(dashboardButton);

        attachSpotlight(dashboardButton);


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
    function getFloatingPlayerContainer(video) {

        try {

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

                    return element;

                }

                element =
                    element.parentElement;

            }

        } catch (e) {}

        return null;

    }


    function isMiniPlayerVideo(video) {

        try {

            var rect =
                video.getBoundingClientRect();

            if (rect.width < 500) {

                return !!getFloatingPlayerContainer(video);

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
    // ALERTE "LECTURE DIRECTE" (= pubs de retour)
    // ============================================================
    //
    // Quand tous les proxys échouent, le Worker bascule sur Twitch en
    // direct : c'est le seul moment où les pubs reviennent, donc
    // l'info la plus importante du script — elle ne doit pas rester
    // enterrée dans les logs d'un dashboard fermé.

    var toastElement = null;
    var toastTimer = null;
    var toastShowingDirect = false;

    // Un même stream peut rebasculer en direct plusieurs fois de
    // suite : on ne réalerte pas plus d'une fois par quart d'heure
    // pour la même chaîne.
    var DIRECT_TOAST_COOLDOWN_MS = 15 * 60 * 1000;
    var lastDirectToastAt = {};

    function ensureToast() {

        if (toastElement) {
            return toastElement;
        }

        // Idempotent : l'onglet dashboard n'appelle jamais
        // createDashboard(), donc le CSS du toast n'y serait pas
        // injecté et le toast s'afficherait sans aucun style.
        injectDashboardCSS();

        toastElement = document.createElement('div');
        toastElement.id = 'tp9-toast';

        toastElement.innerHTML =
            '<div class="tp9-toast-icon"></div>' +
            '<div class="tp9-toast-body">' +
                '<div class="tp9-toast-title"></div>' +
                '<div class="tp9-toast-text"></div>' +
                '<div class="tp9-toast-actions"></div>' +
            '</div>' +
            '<button type="button" class="tp9-toast-close" aria-label="Fermer">×</button>';

        toastElement
            .querySelector('.tp9-toast-close')
            .addEventListener('click', hideToast);

        attachSpotlight(toastElement);

        document.body.appendChild(toastElement);

        return toastElement;

    }

    function hideToast() {

        if (toastTimer) {

            clearTimeout(toastTimer);

            toastTimer = null;

        }

        toastShowingDirect = false;

        if (toastElement) {
            toastElement.classList.remove('tp9-toast-visible');
        }

    }

    function showToast(options) {

        var toast = ensureToast();

        toast.classList.toggle('tp9-toast-ok', !!options.ok);

        toast.querySelector('.tp9-toast-icon').textContent = options.icon;
        toast.querySelector('.tp9-toast-title').textContent = options.title;
        toast.querySelector('.tp9-toast-text').textContent = options.text;

        var actions = toast.querySelector('.tp9-toast-actions');

        actions.innerHTML = '';

        (options.actions || []).forEach(function (action) {

            var button = document.createElement('button');

            button.type = 'button';
            button.className = 'tp9-toast-btn';
            button.textContent = action.label;

            button.addEventListener('click', function () {
                action.onClick(button);
            });

            actions.appendChild(button);

        });

        actions.style.display = (options.actions || []).length ? 'flex' : 'none';

        // Relance l'animation d'entrée même si le toast était déjà
        // affiché (ex: direct -> proxy rétabli).
        toast.classList.remove('tp9-toast-visible');
        void toast.offsetWidth;
        toast.classList.add('tp9-toast-visible');

        if (toastTimer) {
            clearTimeout(toastTimer);
        }

        toastTimer = setTimeout(hideToast, options.duration || 9000);

    }

    function showDirectPlaybackToast(channel) {

        if (isDashboardOnlyTab || !document.body) {
            return;
        }

        var now = Date.now();

        if (
            lastDirectToastAt[channel] &&
            (now - lastDirectToastAt[channel]) < DIRECT_TOAST_COOLDOWN_MS
        ) {
            return;
        }

        lastDirectToastAt[channel] = now;

        showToast({

            icon: '⚠️',

            title: 'Lecture directe Twitch',

            text:
                'Aucun proxy n\'a répondu pour ' + channel +
                ' : le flux passe par Twitch, les pubs peuvent revenir.',

            duration: 12000,

            actions: [
                {
                    label: '🧪 Retester les proxys',
                    onClick: function (button) {

                        if (testInProgress) {
                            return;
                        }

                        button.disabled = true;
                        button.textContent = '⏳ Test en cours...';

                        testAllProxies().finally(function () {

                            hideToast();

                        });

                    }
                }
            ]

        });

        toastShowingDirect = true;

    }

    // Un relais reprend la main alors qu'on venait d'alerter : on
    // referme la boucle plutôt que de laisser l'avertissement à
    // l'écran.
    function notifyProxyRecovered(proxyName) {

        if (!toastShowingDirect) {
            return;
        }

        showToast({

            icon: '✅',

            title: 'Proxy rétabli',

            text: 'Le flux repasse par ' + proxyName + '.',

            ok: true,

            duration: 5000

        });

        toastShowingDirect = false;

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

            /* La version se lit d'un coup d'œil, sans ouvrir
               Tampermonkey : c'est la première chose qu'on
               demande à quelqu'un qui signale un bug. */
            .tp9-version {

                display: inline-block;

                margin-left: 6px;

                padding: 1px 5px;

                border-radius: 4px;

                background: rgba(145,71,255,.18);

                color: #bf94ff;

                font-size: 9px;

                font-weight: 700;

                letter-spacing: .4px;

                vertical-align: middle;

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


            .tp9-backup-banner {

                display: flex;

                align-items: center;

                gap: 10px;

                padding: 10px 12px;

                margin-bottom: 10px;

                border-radius: 9px;

                background:
                    linear-gradient(135deg, rgba(145,71,255,.18), rgba(145,71,255,.05));

                border: 1px solid rgba(145,71,255,.35);

            }


            .tp9-backup-banner .tp9-update-version {

                color: #bf94ff;

            }


            .tp9-backup-banner .tp9-update-hint {

                color: #9d8ac2;

            }


            .tp9-backup-banner .tp9-update-btn {

                background: #9147ff;

            }


            .tp9-backup-banner .tp9-update-btn:hover {

                background: #a970ff;

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


            .tp9-status-quarantine {

                color: #ffcf7a;

                background: rgba(255,207,122,.14);

            }


            .tp9-proxy-quarantined::before {

                background: #ffcf7a !important;

            }


            .tp9-unquarantine {

                width: 28px;
                height: 28px;

                margin-right: 6px;

                padding: 0;

                display: flex;

                align-items: center;

                justify-content: center;

                border: 1px solid rgba(255,207,122,.25);

                border-radius: 50%;

                background: rgba(255,207,122,.1);

                font-size: 12px;

                cursor: pointer;

                transition:
                    background-color .15s ease,
                    border-color .15s ease,
                    transform .1s ease;

            }


            .tp9-unquarantine:hover {

                background: rgba(255,207,122,.22);

                border-color: rgba(255,207,122,.45);

            }


            .tp9-unquarantine:active {

                transform: scale(.92);

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

                width: 28px;
                height: 28px;

                padding: 0;

                display: flex;

                align-items: center;

                justify-content: center;

                border: 1px solid rgba(255,255,255,.08);

                border-radius: 50%;

                background: rgba(255,255,255,.05);

                color: #b8899a !important;

                cursor: pointer;

                transition:
                    background-color .15s ease,
                    border-color .15s ease,
                    color .15s ease,
                    transform .1s ease;

            }


            .tp9-delete svg {

                display: block;

            }


            .tp9-delete:hover {

                background: rgba(255,70,70,.16) !important;

                border-color: rgba(255,70,70,.4);

                color: #ff8a8a !important;

            }


            .tp9-delete:active {

                transform: scale(.92);

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

            .tp9-add-container {

                margin-top: 10px;

            }


            .tp9-add-form {

                display: flex;

                flex-direction: column;

                gap: 12px;

                padding: 14px;

                border-radius: 10px;

                background: rgba(145,71,255,.06);

                border: 1px solid rgba(145,71,255,.18);

            }


            .tp9-add-form-header {

                display: flex;

                align-items: center;

                gap: 8px;

            }


            .tp9-add-form-icon {

                flex: 0 0 auto;

                width: 24px;
                height: 24px;

                border-radius: 7px;

                display: flex;

                align-items: center;

                justify-content: center;

                font-size: 12px;

                background: rgba(145,71,255,.18);

            }


            .tp9-add-form-title {

                font-size: 12.5px;

                font-weight: 700;

                color: #efeff1;

            }


            .tp9-add-field {

                display: flex;

                flex-direction: column;

                gap: 5px;

            }


            .tp9-add-field label {

                color: #999;

                font-size: 10.5px;

                font-weight: 700;

                letter-spacing: .3px;

                text-transform: uppercase;

            }


            .tp9-add-field input {

                width: 100%;

                min-height: 36px;

                padding: 8px 10px;

                border:
                    1px solid
                    rgba(255,255,255,.12);

                border-radius: 8px;

                outline: none;

                background: rgba(0,0,0,.35);

                color: white;

                font-family: Arial, sans-serif;

                font-size: 12.5px;

                box-sizing: border-box;

                transition: border-color .12s ease, background-color .12s ease;

            }


            .tp9-add-field input:focus {

                border-color: #9147ff;

                background: rgba(0,0,0,.5);

            }


            .tp9-help {

                color: #888;

                font-size: 10.5px;

            }


            .tp9-help code {

                color: #bf94ff;

                background:
                    rgba(255,255,255,.08);

                padding:
                    1px 4px;

                border-radius: 3px;

            }


            .tp9-form-error {

                min-height: 15px;

                color: #ff8a8a;

                font-size: 11px;

                font-weight: 600;

            }


            .tp9-add-form-actions {

                display: flex;

                gap: 8px;

            }


            .tp9-add-form-actions button {

                flex: 1;

                padding: 9px;

                border-radius: 8px;

                font-size: 12.5px;

                font-weight: 700;

                cursor: pointer;

                transition:
                    background-color .12s ease,
                    border-color .12s ease,
                    filter .12s ease,
                    transform .1s ease;

            }


            .tp9-add-form-actions button:active {

                transform: scale(.97);

            }


            .tp9-cancel-add {

                border: 1px solid rgba(255,255,255,.1);

                background: rgba(255,255,255,.05);

                color: #ccc;

            }


            .tp9-cancel-add:hover {

                background: rgba(255,255,255,.1);

                color: white;

            }


            .tp9-confirm-add {

                border: 0;

                background: linear-gradient(135deg, #9147ff, #772ce8);

                color: white;

                box-shadow: 0 4px 14px rgba(145,71,255,.3);

            }


            .tp9-confirm-add:hover {

                filter: brightness(1.1);

            }


            /* =====================================================
               ALERTE LECTURE DIRECTE
            ===================================================== */

            #tp9-toast {

                display: none;

                position: fixed;

                left: 20px;
                bottom: 20px;

                z-index: 2147483646;

                max-width: 340px;

                padding: 12px 14px;

                align-items: flex-start;

                gap: 10px;

                border-radius: 12px;

                background: rgba(15,15,15,.97);

                border: 1px solid rgba(255,77,79,.4);

                box-shadow: 0 10px 40px rgba(0,0,0,.6);

                color: #fff;

                font-family: Arial, sans-serif;

                font-size: 12.5px;

                backdrop-filter: blur(12px);

                animation: tp9-toast-in .25s ease;

            }


            @keyframes tp9-toast-in {

                from {
                    opacity: 0;
                    transform: translateY(10px);
                }

                to {
                    opacity: 1;
                    transform: none;
                }

            }


            .tp9-toast-visible {

                display: flex !important;

            }


            .tp9-toast-ok {

                border-color: rgba(0,208,132,.4) !important;

            }


            .tp9-toast-icon {

                flex: 0 0 auto;

                font-size: 18px;

                line-height: 1.2;

            }


            .tp9-toast-body {

                flex: 1 1 auto;

                min-width: 0;

            }


            .tp9-toast-title {

                font-size: 12.5px;

                font-weight: 800;

            }


            .tp9-toast-text {

                margin-top: 2px;

                color: #bbb;

                font-size: 11.5px;

                line-height: 1.45;

            }


            .tp9-toast-actions {

                display: flex;

                gap: 6px;

                margin-top: 9px;

            }


            .tp9-toast-btn {

                border: 1px solid rgba(255,255,255,.12);

                border-radius: 7px;

                padding: 5px 9px;

                background: rgba(255,255,255,.06);

                color: #ddd;

                font-size: 11px;

                font-weight: 700;

                cursor: pointer;

            }


            .tp9-toast-btn:hover {

                background: rgba(255,255,255,.12);

            }


            .tp9-toast-btn:disabled {

                opacity: .6;

                cursor: not-allowed;

            }


            .tp9-toast-close {

                flex: 0 0 auto;

                border: 0;

                padding: 0 2px;

                background: transparent;

                color: #888;

                font-size: 16px;

                line-height: 1;

                cursor: pointer;

            }


            .tp9-toast-close:hover {

                color: #fff;

            }


            /* =====================================================
               MICRO-INTERACTIONS
               -----------------------------------------------------
               Un seul jeu de variables pour tous les mouvements :
               il suffit de les neutraliser une fois pour respecter
               "réduire les animations" du système. Rien d'autre que
               transform / opacity / box-shadow, donc composé par le
               GPU et sans recalcul de mise en page — ça compte, le
               dashboard se reconstruit plusieurs fois par minute.
            ===================================================== */

            :root {

                --tp9-lift: translateY(-1px);
                --tp9-press: scale(.97);
                --tp9-press-wide: scale(.99);
                --tp9-pop: scale(1.08);
                --tp9-press-pop: scale(.9);
                --tp9-slide: translateX(2px);

            }


            /* Le bouton flottant : la règle d'origine annulait
               explicitement toute transformation, celle-ci arrive
               après et reprend la main. */

            #tp9-player-button {

                transition:
                    background-color .12s ease,
                    color .12s ease,
                    transform .12s ease;

            }


            #tp9-player-button:hover {

                transform: var(--tp9-lift);

            }


            #tp9-player-button:active {

                transform: var(--tp9-press);

            }


            .tp9-close {

                transition: color .12s ease, transform .12s ease;

            }


            .tp9-close:hover {

                transform: var(--tp9-pop);

            }


            .tp9-close:active {

                transform: var(--tp9-press-pop);

            }


            .tp9-actions button:hover {

                transform: var(--tp9-lift);

                box-shadow: 0 3px 10px rgba(0,0,0,.28);

            }


            /* Écrit APRÈS le :hover : sans ça le survol, qui
               s'applique aussi pendant le clic, gagnerait la
               cascade et l'enfoncement ne se verrait jamais. */

            .tp9-actions button:active {

                transform: var(--tp9-press);

                box-shadow: none;

            }


            .tp9-add-proxy {

                transition:
                    background-color .12s ease,
                    border-color .12s ease,
                    color .12s ease,
                    transform .12s ease;

            }


            .tp9-add-proxy:hover {

                transform: var(--tp9-lift);

            }


            .tp9-add-proxy:active {

                transform: var(--tp9-press);

            }


            .tp9-toggle-row:hover {

                transform: var(--tp9-slide);

            }


            .tp9-open-stats:hover {

                filter: brightness(1.08);

                transform: var(--tp9-lift);

                box-shadow: 0 6px 18px rgba(145,71,255,.45);

            }


            .tp9-open-stats:active {

                transform: var(--tp9-press);

                box-shadow: 0 2px 8px rgba(145,71,255,.3);

            }


            .tp9-confirm-add:hover {

                transform: var(--tp9-lift);

                box-shadow: 0 6px 18px rgba(145,71,255,.4);

            }


            .tp9-cancel-add:hover {

                transform: var(--tp9-lift);

            }


            .tp9-add-form-actions button:active {

                transform: var(--tp9-press);

            }


            .tp9-unquarantine:hover,
            .tp9-delete:hover {

                transform: var(--tp9-pop);

            }


            .tp9-unquarantine:active,
            .tp9-delete:active {

                transform: var(--tp9-press-pop);

            }


            .tp9-update-btn {

                transition:
                    background-color .12s ease,
                    transform .12s ease,
                    box-shadow .12s ease;

            }


            .tp9-update-btn:hover {

                transform: var(--tp9-lift);

            }


            .tp9-update-btn:active {

                transform: var(--tp9-press);

            }


            .tp9-toast-btn {

                transition:
                    background-color .12s ease,
                    transform .12s ease;

            }


            .tp9-toast-btn:hover {

                transform: var(--tp9-lift);

            }


            .tp9-toast-btn:active {

                transform: var(--tp9-press);

            }


            .tp9-toast-close {

                transition: color .12s ease, transform .12s ease;

            }


            .tp9-toast-close:hover {

                transform: var(--tp9-pop);

            }


            .tp9-toast-close:active {

                transform: var(--tp9-press-pop);

            }


            @media (prefers-reduced-motion: reduce) {

                :root {

                    --tp9-lift: none;
                    --tp9-press: none;
                    --tp9-press-wide: none;
                    --tp9-pop: none;
                    --tp9-press-pop: none;
                    --tp9-slide: none;

                }

                /* Mouvements antérieurs aux variables. */

                .tp9-proxy:hover {

                    transform: none;

                }

            }

            /* =====================================================
               REDESIGN — relief, dégradés, carte de lecture
               -----------------------------------------------------
               Écrit APRÈS tout le reste : à spécificité égale la
               dernière règle gagne, donc ce bloc reprend la main
               sans qu'il faille retoucher les règles d'origine.

               Les effets reposent d'abord sur des DÉGRADÉS et des
               halos, pas seulement sur du mouvement : ils restent
               donc visibles quand le système demande de réduire les
               animations (cas fréquent sur Windows, où « Effets
               d'animation » désactivé neutralisait tout l'ancien
               jeu de micro-interactions).
            ===================================================== */

            :root {

                --tp9-lift: translateY(-2px);
                --tp9-press: scale(.96);

            }


            /* ---- ouverture du menu ---- */

            #tp9-dashboard {

                animation: tp9-panel-in .16s ease-out;

            }


            @keyframes tp9-panel-in {

                from {
                    opacity: 0;
                    transform: translateY(-6px) scale(.985);
                }

                to {
                    opacity: 1;
                    transform: none;
                }

            }


            .tp9-header {

                background:
                    linear-gradient(180deg, rgba(145,71,255,.16), transparent);

            }


            /* =====================================================
               CARTE DE LECTURE EN COURS
               -----------------------------------------------------
               Remplace l'ancienne ligne "📡 Lecture actuelle : ...".
               Trois états, lisibles d'un coup d'œil sans lire le
               texte : pastille verte qui pulse (un relais tient le
               flux), ambre (Twitch en direct, donc les pubs
               reviennent), grise (rien encore).
            ===================================================== */

            .tp9-hero {

                display: flex;

                align-items: center;

                gap: 10px;

                margin-bottom: 10px;

                padding: 10px 12px;

                border-radius: 10px;

                background:
                    linear-gradient(135deg,
                        rgba(145,71,255,.22),
                        rgba(145,71,255,.04));

                border: 1px solid rgba(145,71,255,.3);

                box-shadow: inset 0 1px 0 rgba(255,255,255,.06);

            }


            .tp9-hero-dot {

                flex: 0 0 auto;

                width: 9px;
                height: 9px;

                border-radius: 50%;

                background: #6b6b73;

            }


            .tp9-hero-text {

                flex: 1 1 auto;

                min-width: 0;

            }


            .tp9-hero-label {

                font-size: 9px;

                font-weight: 700;

                letter-spacing: .9px;

                color: #9d8ac2;

            }


            .tp9-hero-value {

                margin-top: 2px;

                font-size: 13px;

                font-weight: 700;

                color: #fff;

                white-space: nowrap;

                overflow: hidden;

                text-overflow: ellipsis;

            }


            .tp9-hero-meta {

                flex: 0 0 auto;

                padding: 3px 8px;

                border-radius: 999px;

                background: rgba(145,71,255,.18);

                color: #bf94ff;

                font-size: 10.5px;

                font-weight: 700;

            }


            .tp9-hero-meta:empty {

                display: none;

            }


            .tp9-hero-live {

                background:
                    linear-gradient(135deg,
                        rgba(0,208,132,.2),
                        rgba(0,208,132,.03));

                border-color: rgba(0,208,132,.3);

            }


            .tp9-hero-live .tp9-hero-label {

                color: #7fcdae;

            }


            .tp9-hero-live .tp9-hero-meta {

                background: rgba(0,208,132,.16);

                color: #7ae8b0;

            }


            .tp9-hero-live .tp9-hero-dot {

                background: #00d084;

                animation: tp9-hero-pulse 2.4s ease-out infinite;

            }


            @keyframes tp9-hero-pulse {

                0% { box-shadow: 0 0 0 0 rgba(0,208,132,.55); }
                70% { box-shadow: 0 0 0 8px rgba(0,208,132,0); }
                100% { box-shadow: 0 0 0 0 rgba(0,208,132,0); }

            }


            .tp9-hero-direct {

                background:
                    linear-gradient(135deg,
                        rgba(255,207,122,.2),
                        rgba(255,207,122,.03));

                border-color: rgba(255,207,122,.32);

            }


            .tp9-hero-direct .tp9-hero-label {

                color: #d8b47c;

            }


            .tp9-hero-direct .tp9-hero-dot {

                background: #ffcf7a;

            }


            .tp9-hero-direct .tp9-hero-meta {

                background: rgba(255,207,122,.16);

                color: #ffcf7a;

            }


            .tp9-hero-idle {

                background:
                    linear-gradient(135deg,
                        rgba(255,255,255,.07),
                        rgba(255,255,255,.02));

                border-color: rgba(255,255,255,.08);

            }


            .tp9-hero-idle .tp9-hero-label {

                color: #8a8a93;

            }


            .tp9-hero-idle .tp9-hero-value {

                color: #aaa;

            }


            /* =====================================================
               BOUTON DASHBOARD — remonté juste sous la carte
            ===================================================== */

            .tp9-open-stats {

                display: flex;

                align-items: center;

                justify-content: center;

                gap: 7px;

                margin: 0 0 12px;

                padding: 11px;

                background:
                    linear-gradient(120deg, #a970ff, #772ce8 55%, #5b21b6);

                /* Le dégradé est deux fois plus large que le bouton :
                   au survol on le fait GLISSER au lieu d'éclaircir
                   la couleur, ce qui se voit nettement plus. */

                background-size: 200% 100%;

                background-position: 0 0;

                transition:
                    background-position .35s ease,
                    box-shadow .15s ease,
                    transform .12s ease;

            }


            .tp9-open-stats:hover {

                filter: none;

                background-position: 100% 0;

                transform: var(--tp9-lift);

                box-shadow: 0 8px 22px rgba(145,71,255,.5);

            }


            /* =====================================================
               BOUTONS D'ACTION
            ===================================================== */

            .tp9-actions button {

                background:
                    linear-gradient(135deg,
                        rgba(255,255,255,.1),
                        rgba(255,255,255,.03));

            }


            .tp9-actions button:hover {

                background:
                    linear-gradient(135deg,
                        rgba(255,255,255,.18),
                        rgba(255,255,255,.06));

                border-color: rgba(255,255,255,.18);

                transform: var(--tp9-lift);

                box-shadow: 0 5px 16px rgba(0,0,0,.38);

            }


            .tp9-test {

                background:
                    linear-gradient(135deg,
                        rgba(145,71,255,.34),
                        rgba(145,71,255,.1)) !important;

                border-color: rgba(145,71,255,.45) !important;

            }


            .tp9-test:hover {

                background:
                    linear-gradient(135deg,
                        rgba(145,71,255,.5),
                        rgba(145,71,255,.18)) !important;

                border-color: rgba(145,71,255,.6) !important;

                box-shadow: 0 5px 18px rgba(145,71,255,.35);

            }


            .tp9-reset:hover {

                background:
                    linear-gradient(135deg,
                        rgba(255,70,70,.3),
                        rgba(255,70,70,.07)) !important;

                border-color: rgba(255,70,70,.45) !important;

                box-shadow: 0 5px 18px rgba(255,70,70,.25);

            }


            .tp9-export:hover {

                border-color: rgba(122,210,255,.4);

                color: #7ad2ff;

                box-shadow: 0 5px 18px rgba(31,156,240,.22);

            }


            .tp9-import:hover {

                border-color: rgba(122,232,176,.4);

                color: #7ae8b0;

                box-shadow: 0 5px 18px rgba(0,208,132,.22);

            }


            .tp9-add-proxy:hover {

                background:
                    linear-gradient(135deg,
                        rgba(145,71,255,.16),
                        rgba(145,71,255,.03));

                border-color: rgba(145,71,255,.4);

                color: #d9c2ff;

            }


            /* =====================================================
               LIGNES DE PROXY
            ===================================================== */

            .tp9-proxy::before {

                transition: width .15s ease;

            }


            .tp9-proxy:hover {

                background:
                    linear-gradient(90deg,
                        color-mix(in srgb, var(--accent) 18%, transparent),
                        rgba(255,255,255,.05) 60%);

            }


            .tp9-proxy:hover::before {

                width: 5px;

            }


            .tp9-switch input:checked + .tp9-switch-track {

                background:
                    linear-gradient(135deg, #a970ff, #772ce8);

                box-shadow: 0 0 10px rgba(145,71,255,.45);

            }


            .tp9-toggle-row:hover {

                background:
                    linear-gradient(90deg,
                        rgba(145,71,255,.12),
                        rgba(255,255,255,.03) 70%);

                border-color: rgba(145,71,255,.22);

            }


            /* =====================================================
               ÉTATS ENFONCÉS
               -----------------------------------------------------
               Toujours APRÈS les :hover de ce bloc : le survol reste
               actif pendant le clic et, à spécificité égale, la
               dernière règle écrite gagne — un :active placé avant
               ne se verrait jamais.
            ===================================================== */

            .tp9-actions button:active,
            .tp9-open-stats:active,
            .tp9-add-proxy:active {

                transform: var(--tp9-press);

                box-shadow: none;

            }


            @media (prefers-reduced-motion: reduce) {

                :root {

                    --tp9-lift: none;
                    --tp9-press: none;

                }

                #tp9-dashboard {

                    animation: none;

                }

                /* La pastille reste identifiable sans clignoter. */

                .tp9-hero-live .tp9-hero-dot {

                    animation: none;

                    box-shadow: 0 0 0 3px rgba(0,208,132,.25);

                }

            }

            /* =====================================================
               FINITIONS — défilement et titres
               -----------------------------------------------------
               Le dashboard avait déjà sa barre de défilement fine,
               pas le menu : il gardait celle du système, large et
               grise, au milieu d'un panneau sombre.
            ===================================================== */

            .tp9-content::-webkit-scrollbar {

                width: 8px;

            }


            .tp9-content::-webkit-scrollbar-track {

                background: transparent;

            }


            .tp9-content::-webkit-scrollbar-thumb {

                border-radius: 8px;

                background: rgba(255,255,255,.12);

            }


            .tp9-content::-webkit-scrollbar-thumb:hover {

                background: rgba(145,71,255,.45);

            }


            /* Firefox n'a pas les pseudo-éléments ci-dessus. */

            .tp9-content {

                scrollbar-width: thin;

                scrollbar-color: rgba(255,255,255,.18) transparent;

            }


            /* Petit trait accentué devant « 📡 PROXYS » et
               « ⚙️ RÉGLAGES » : structure la colonne sans ajouter
               une ligne de séparation de plus. */

            .tp9-section-title {

                display: flex;

                align-items: center;

                gap: 7px;

                font-weight: 700;

            }


            .tp9-section-title::before {

                content: '';

                flex: 0 0 auto;

                width: 3px;
                height: 11px;

                border-radius: 2px;

                background:
                    linear-gradient(180deg, #a970ff, #772ce8);

            }


            /* La ligne des proxys porte aussi le compteur, calé à
               droite : son ::before ne doit pas casser ce placement. */

            .tp9-proxy-title-row {

                justify-content: flex-start;

            }


            .tp9-proxy-title-row .tp9-proxy-count {

                margin-left: auto;

            }

            /* =====================================================
               HALO QUI SUIT LE CURSEUR
               -----------------------------------------------------
               attachSpotlight() écrit la position de la souris dans
               --mx / --my ; le ::after n'est qu'un dégradé radial
               centré dessus.

               Ni transform ni animation : l'effet reste donc ENTIER
               quand le système demande de réduire les animations —
               c'est justement là que les anciens survols, qui ne
               reposaient que sur du mouvement, disparaissaient.

               Pas besoin de overflow: hidden : le ::after est calé
               sur inset: 0 avec border-radius: inherit, il épouse
               donc déjà les coins du bouton. C'est important pour le
               bouton flottant, dont la pastille de mise à jour
               dépasse volontairement du cadre et serait rognée.
            ===================================================== */

            .tp9-close,
            .tp9-update-btn,
            .tp9-open-stats,
            .tp9-actions button,
            .tp9-add-proxy,
            .tp9-unquarantine,
            .tp9-delete,
            .tp9-add-form-actions button,
            .tp9-toast-btn,
            .tp9-toast-close {

                position: relative;

            }


            #tp9-player-button::after,
            .tp9-close::after,
            .tp9-update-btn::after,
            .tp9-open-stats::after,
            .tp9-actions button::after,
            .tp9-add-proxy::after,
            .tp9-unquarantine::after,
            .tp9-delete::after,
            .tp9-add-form-actions button::after,
            .tp9-toast-btn::after,
            .tp9-toast-close::after {

                content: '';

                position: absolute;

                inset: 0;

                border-radius: inherit;

                pointer-events: none;

                opacity: 0;

                background:
                    radial-gradient(
                        circle var(--tp9-spot, 110px)
                            at var(--mx, 50%) var(--my, 50%),
                        rgba(255,255,255,.2),
                        rgba(255,255,255,0) 72%);

                transition: opacity .15s ease;

            }


            #tp9-player-button:hover::after,
            .tp9-close:hover::after,
            .tp9-update-btn:hover::after,
            .tp9-open-stats:hover::after,
            .tp9-actions button:hover::after,
            .tp9-add-proxy:hover::after,
            .tp9-unquarantine:hover::after,
            .tp9-delete:hover::after,
            .tp9-add-form-actions button:hover::after,
            .tp9-toast-btn:hover::after,
            .tp9-toast-close:hover::after {

                opacity: 1;

            }


            /* Un halo de 110 px sur un bouton rond de 28 px
               reviendrait à éclaircir toute sa surface : sur les
               petits, on resserre pour qu'il reste un point lumineux
               qui se déplace. */

            .tp9-close,
            .tp9-unquarantine,
            .tp9-delete,
            .tp9-toast-close {

                --tp9-spot: 26px;

            }


            #tp9-player-button {

                --tp9-spot: 34px;

            }


            /* Un bouton désactivé ne réagit plus au survol : son halo
               ne doit pas laisser croire le contraire. */

            .tp9-actions button:disabled::after,
            .tp9-toast-btn:disabled::after {

                opacity: 0 !important;

            }


            /* =====================================================
               HALO QUI SUIT LE CURSEUR — SURFACES
               -----------------------------------------------------
               Même mécanique que le bloc ci-dessus, mais sur des
               éléments qui ne sont pas des boutons et qui se
               cliquent quand même : la ligne d'un relais bascule
               activé / désactivé, la ligne d'un réglage est un
               <label> qui pilote son interrupteur.

               Le halo est posé sur .tp9-proxy, la ligne ENTIÈRE, et
               non sur sa seule zone cliquable .tp9-proxy-main : celle-
               ci est en retrait des bords à cause du padding de la
               ligne, et la lumière s'arrêtait donc visiblement avant
               le cadre. Conséquence assumée : survoler les boutons 🔓
               ou 🗑 au bout de la ligne allume les deux halos, le
               leur par-dessus celui de la ligne. .tp9-proxy est en
               overflow: hidden, le halo est de toute façon recadré
               sur ses coins arrondis.
            ===================================================== */

            .tp9-proxy,
            .tp9-toggle-row {

                position: relative;

                /* Deux bandes larges mais basses : un halo de 110 px
                   y éclairerait toute la hauteur d'un coup et on ne
                   le verrait plus se déplacer. */
                --tp9-spot: 80px;

            }


            .tp9-proxy::after,
            .tp9-toggle-row::after {

                content: '';

                position: absolute;

                inset: 0;

                border-radius: inherit;

                pointer-events: none;

                opacity: 0;

                background:
                    radial-gradient(
                        circle var(--tp9-spot, 110px)
                            at var(--mx, 50%) var(--my, 50%),
                        rgba(255,255,255,.2),
                        rgba(255,255,255,0) 72%);

                transition: opacity .15s ease;

            }


            .tp9-proxy:hover::after,
            .tp9-toggle-row:hover::after {

                opacity: 1;

            }

            /* =====================================================
               BLOCS, GROUPES ET VERRE
               -----------------------------------------------------
               Écrit en dernier, comme les autres blocs de refonte :
               à spécificité égale la dernière règle gagne.
            ===================================================== */

            /* Le menu était à 97 % d'opacité avec un flou de 12 px,
               donc opaque en pratique. Plus transparent + un flou
               plus large, ça devient vraiment du verre ; le dégradé
               interne rattrape la lisibilité sur un stream clair. */

            #tp9-dashboard {

                background:
                    linear-gradient(180deg,
                        rgba(22,22,28,.88),
                        rgba(10,10,13,.82));

                backdrop-filter: blur(20px) saturate(140%);

                -webkit-backdrop-filter: blur(20px) saturate(140%);

                border-color: rgba(255,255,255,.12);

            }


            .tp9-block {

                margin-bottom: 10px;

                padding: 10px 10px 8px;

                border-radius: 11px;

                background: rgba(255,255,255,.028);

                border: 1px solid rgba(255,255,255,.055);

            }


            .tp9-block:last-child {

                margin-bottom: 0;

            }


            /* Le titre porte déjà sa marge basse, inutile d'en
               ajouter une au bloc. */

            .tp9-block .tp9-section-title {

                margin-bottom: 9px;

            }


            /* ---- champ de recherche ---- */

            .tp9-proxy-search {

                width: 100%;

                margin-bottom: 8px;

                padding: 7px 10px;

                box-sizing: border-box;

                border: 1px solid rgba(255,255,255,.1);

                border-radius: 8px;

                outline: none;

                background: rgba(0,0,0,.3);

                color: #efeff1;

                font-family: inherit;

                font-size: 12px;

                transition:
                    border-color .12s ease,
                    background-color .12s ease;

            }


            .tp9-proxy-search:focus {

                border-color: #9147ff;

                background: rgba(0,0,0,.45);

            }


            .tp9-proxy-search::placeholder {

                color: #6f6f7a;

            }


            /* ---- groupes ---- */

            .tp9-group {

                --accent: #9147ff;

                margin-bottom: 8px;

            }


            .tp9-group:last-child {

                margin-bottom: 0;

            }


            .tp9-group-head {

                position: relative;

                display: flex;

                align-items: center;

                gap: 7px;

                padding: 6px 8px;

                margin-bottom: 5px;

                border-radius: 8px;

                background:
                    linear-gradient(90deg,
                        color-mix(in srgb, var(--accent) 16%, transparent),
                        rgba(255,255,255,.02) 70%);

                border: 1px solid
                    color-mix(in srgb, var(--accent) 22%, transparent);

                cursor: pointer;

                user-select: none;

                --tp9-spot: 70px;

                transition: border-color .12s ease;

            }


            .tp9-group-head:hover {

                border-color:
                    color-mix(in srgb, var(--accent) 45%, transparent);

            }


            .tp9-group-caret {

                flex: 0 0 auto;

                width: 10px;

                color: color-mix(in srgb, var(--accent) 80%, #fff);

                font-size: 9px;

                line-height: 1;

                transition: transform .15s ease;

            }


            .tp9-group-collapsed .tp9-group-caret {

                transform: rotate(-90deg);

            }


            .tp9-group-icon {

                flex: 0 0 auto;

                font-size: 12px;

            }


            .tp9-group-name {

                flex: 1 1 auto;

                min-width: 0;

                overflow: hidden;

                text-overflow: ellipsis;

                white-space: nowrap;

                font-size: 11px;

                font-weight: 700;

                letter-spacing: .3px;

                color: #dcdce2;

            }


            .tp9-group-count {

                position: relative;

                flex: 0 0 auto;

                border: 0;

                padding: 2px 7px;

                border-radius: 999px;

                background:
                    color-mix(in srgb, var(--accent) 20%, transparent);

                color: color-mix(in srgb, var(--accent) 75%, #fff);

                font-family: inherit;

                font-size: 10px;

                font-weight: 700;

                cursor: pointer;

                --tp9-spot: 26px;

                transition: background-color .12s ease;

            }


            .tp9-group-count:hover {

                background:
                    color-mix(in srgb, var(--accent) 38%, transparent);

            }


            .tp9-group-collapsed .tp9-group-body {

                display: none;

            }


            .tp9-proxy-warning {

                display: flex;

                align-items: flex-start;

                gap: 8px;

                margin-bottom: 8px;

                padding: 8px 10px;

                border-radius: 8px;

                background:
                    linear-gradient(135deg,
                        rgba(255,207,122,.18),
                        rgba(255,207,122,.04));

                border: 1px solid rgba(255,207,122,.32);

                color: #ffcf7a;

                font-size: 11px;

                line-height: 1.45;

            }


            .tp9-proxy-warning-icon {

                flex: 0 0 auto;

                font-size: 12px;

            }


            .tp9-empty {

                padding: 14px 8px;

                text-align: center;

                color: #6f6f7a;

                font-size: 12px;

            }


            /* Le halo suit déjà le curseur sur les lignes de proxy et
               les réglages : l'en-tête de groupe et son compteur sont
               deux surfaces cliquables de plus. */

            .tp9-group-head::after,
            .tp9-group-count::after {

                content: '';

                position: absolute;

                inset: 0;

                border-radius: inherit;

                pointer-events: none;

                opacity: 0;

                background:
                    radial-gradient(
                        circle var(--tp9-spot, 110px)
                            at var(--mx, 50%) var(--my, 50%),
                        rgba(255,255,255,.2),
                        rgba(255,255,255,0) 72%);

                transition: opacity .15s ease;

            }


            .tp9-group-head:hover::after,
            .tp9-group-count:hover::after {

                opacity: 1;

            }


            @media (prefers-reduced-motion: reduce) {

                .tp9-group-caret {

                    transition: none;

                }

            }

            /* =====================================================
               FINITION — typo, santé, densité
               -----------------------------------------------------
               Écrit tout en fin de feuille, comme les blocs de
               refonte précédents : à spécificité égale la dernière
               règle gagne, donc celui-ci reprend la main sans qu'il
               faille retoucher les règles d'origine.
            ===================================================== */

            /* ---- La même typo que le reste du site ----
               Le menu était en Arial alors que le dashboard, le
               bouton flottant et Twitch lui-même sont en Inter.
               Champs et listes déroulantes ne l'héritent pas seuls,
               d'où les deux sélecteurs explicites. */

            #tp9-dashboard,
            #tp9-toast {

                font-family:
                    "Inter",
                    "Roobert",
                    "Helvetica Neue",
                    Helvetica,
                    Arial,
                    sans-serif;

            }


            .tp9-add-field input,
            .tp9-select-field select {

                font-family: inherit;

            }


            /* Sans chiffres à chasse fixe, une latence qui passe de
               320 à 1180 ms élargit le nombre et fait sauter toute
               la ligne sous le curseur. */

            .tp9-status,
            .tp9-test-time,
            .tp9-proxy-count,
            .tp9-group-count,
            .tp9-hero-meta {

                font-variant-numeric: tabular-nums;

            }


            /* ---- Le liseré dit l'état, pas la région
               (voir getProxyHealthColor) ---- */

            .tp9-proxy::before {

                background: var(--health, var(--accent));

            }


            /* ---- Le bouton dashboard reste bien visible, mais ne
               vole plus la vedette à la carte de lecture : même
               taille, même place, même violet — en contour plutôt
               qu'en aplat. ---- */

            .tp9-open-stats {

                background:
                    linear-gradient(135deg,
                        rgba(145,71,255,.18),
                        rgba(145,71,255,.05));

                background-size: auto;

                background-position: 0 0;

                border: 1px solid rgba(145,71,255,.45);

                color: #d9c2ff;

                box-shadow: none;

                transition:
                    background-color .12s ease,
                    border-color .12s ease,
                    color .12s ease,
                    box-shadow .15s ease,
                    transform .12s ease;

            }


            .tp9-open-stats:hover {

                background:
                    linear-gradient(135deg,
                        rgba(145,71,255,.34),
                        rgba(145,71,255,.12));

                background-position: 0 0;

                border-color: rgba(145,71,255,.7);

                color: #fff;

                filter: none;

                transform: var(--tp9-lift);

                box-shadow: 0 5px 18px rgba(145,71,255,.28);

            }


            .tp9-open-stats:active {

                transform: var(--tp9-press);

                box-shadow: none;

            }


            /* ---- Les blocs, affirmés ----
               Un fond à .028 sur un menu déjà translucide ne se
               voyait pratiquement pas : ils occupaient du padding
               sans rien structurer. */

            .tp9-block {

                margin-bottom: 8px;

                padding: 9px 9px 7px;

                background:
                    linear-gradient(180deg,
                        rgba(255,255,255,.065),
                        rgba(255,255,255,.022));

                border: 1px solid rgba(255,255,255,.09);

                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,.05),
                    0 2px 10px rgba(0,0,0,.22);

            }


            /* ---- Densité ----
               Environ 8 px gagnés par ligne, soit une centaine sur
               treize proxys dans un menu haut de 470 px. */

            .tp9-proxy {

                padding: 6px 9px 6px 11px;

                margin-bottom: 5px;

            }


            .tp9-proxy-main {

                gap: 8px;

            }


            .tp9-proxy-avatar {

                width: 24px;
                height: 24px;

                border-radius: 8px;

                font-size: 12px;

            }


            .tp9-enabled {

                width: 14px;
                height: 14px;

            }


            .tp9-status {

                margin-top: 3px;

                padding: 1px 6px;

                font-size: 10px;

            }


            .tp9-unquarantine,
            .tp9-delete {

                width: 24px;
                height: 24px;

            }


            /* ---- Avancement de la salve de tests ---- */

            .tp9-test-progress {

                height: 2px;

                background: rgba(255,255,255,.06);

                opacity: 0;

                transition: opacity .2s ease;

            }


            .tp9-test-progress-on {

                opacity: 1;

            }


            .tp9-test-progress-fill {

                width: 0%;

                height: 100%;

                border-radius: 0 2px 2px 0;

                background:
                    linear-gradient(90deg, #bf94ff, #9147ff);

                box-shadow: 0 0 8px rgba(145,71,255,.55);

                transition: width .25s ease;

            }


            @media (prefers-reduced-motion: reduce) {

                .tp9-test-progress-fill {

                    transition: none;

                }

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

            /* La version se lit d'un coup d'œil, sans ouvrir
               Tampermonkey : c'est la première chose qu'on
               demande à quelqu'un qui signale un bug. */
            .tp9s-brand-version {

                display: inline-block;

                margin-left: 6px;

                padding: 1px 5px;

                border-radius: 4px;

                background: rgba(145,71,255,.18);

                color: #bf94ff;

                font-size: 9px;

                font-weight: 700;

                letter-spacing: .4px;

                vertical-align: middle;

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


            .tp9s-card-top-right {

                display: flex;

                align-items: center;

                gap: 7px;

            }


            .tp9s-card-live {

                display: inline-flex;

                align-items: center;

                gap: 5px;

                padding: 3px 8px;

                border-radius: 999px;

                background: color-mix(in srgb, var(--accent) 20%, transparent);

                color: var(--accent);

                font-size: 10.5px;

                font-weight: 800;

                white-space: nowrap;

            }


            .tp9s-card-live-dot {

                width: 6px;
                height: 6px;

                border-radius: 50%;

                background: currentColor;

                animation: tp9s-live-pulse 2s ease-out infinite;

            }


            @keyframes tp9s-live-pulse {

                0% { opacity: 1; box-shadow: 0 0 0 0 currentColor; }
                70% { opacity: .55; box-shadow: 0 0 0 5px transparent; }
                100% { opacity: 1; box-shadow: 0 0 0 0 transparent; }

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


            .tp9s-note-ok {

                background: rgba(0,208,132,.08);

                border-color: rgba(0,208,132,.22);

                color: #a6e3c6;

            }


            .tp9s-note-ok strong {

                color: #dcfff0;

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

                grid-template-columns: 34px 1.4fr 1fr 1fr 1fr 1.2fr;

                gap: 8px;

                padding: 10px 8px;

                border-bottom: 1px solid rgba(255,255,255,.05);

                font-size: 12px;

                align-items: center;

            }


            .tp9s-table-row-relais {

                grid-template-columns:
                    30px 1.2fr .5fr 1.15fr .8fr .85fr .6fr .7fr 1fr;

            }


            .tp9s-td-latency {

                display: flex;

                align-items: center;

                gap: 6px;

                font-weight: 700;

            }


            .tp9s-td-live {

                font-weight: 700;

            }


            .tp9s-spark-wrap {

                display: inline-flex;

                align-items: center;

                opacity: .75;

                transition: opacity .15s ease;

            }


            .tp9s-table-row:hover .tp9s-spark-wrap {

                opacity: 1;

            }


            .tp9s-spark {

                display: block;

                overflow: visible;

            }


            .tp9s-td-score {

                font-weight: 800;

                color: #bf94ff;

            }


            .tp9s-table-head .tp9s-td-score {

                font-weight: 700;

                color: #888;

            }


            .tp9s-td-rank {

                text-align: center;

                font-size: 13px;

                font-weight: 700;

                color: #777;

            }


            .tp9s-sortable {

                cursor: pointer;

                user-select: none;

                display: flex;

                align-items: center;

                gap: 4px;

                transition: color .12s ease;

            }


            .tp9s-sortable:hover {

                color: #ddd;

            }


            .tp9s-sort-active {

                color: #bf94ff;

            }


            .tp9s-sort-arrow {

                font-size: 8px;

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


            .tp9s-clear-logs {

                display: inline-flex;

                align-items: center;

                gap: 6px;

            }


            .tp9s-clear-logs:hover {

                background: rgba(255,70,70,.12);

            }


            .tp9s-clear-logs svg,
            .tp9s-topbar-actions button svg {

                display: block;

            }


            .tp9s-table-row-streamers {

                grid-template-columns: 34px 1.4fr 1fr 1fr 1fr 1.2fr 44px;

            }


            /* En cours de lecture. Un fond vert très dilué plutôt
               qu'une couleur de texte : la ligne se repère en
               balayant le tableau, sans rien rendre moins lisible,
               et le liseré de gauche la retrouve même quand le
               tableau défile sous l'en-tête. */

            .tp9s-table-row.tp9s-row-live {

                background:
                    linear-gradient(
                        90deg,
                        rgba(0, 208, 132, .16) 0%,
                        rgba(0, 208, 132, .05) 45%,
                        rgba(0, 208, 132, 0) 100%
                    );

                box-shadow: inset 2px 0 0 #00d084;

            }

            .tp9s-table-row.tp9s-row-live .tp9s-td-strong {

                color: #4dffb8;

            }

            /* Le point vert n'existe que sur ces lignes-là : ailleurs
               il ne dirait rien, et il prendrait quand même sa place
               à côté du nom. */

            .tp9s-live-dot {

                display: none;

                width: 7px;
                height: 7px;

                flex: none;

                border-radius: 50%;

                background: #00d084;

            }

            .tp9s-row-live .tp9s-live-dot {

                display: inline-block;

                animation: tp9s-live-pulse 1.6s ease-in-out infinite;

            }

            @keyframes tp9s-live-pulse {

                0%, 100% {
                    opacity: 1;
                    box-shadow: 0 0 0 0 rgba(0, 208, 132, .55);
                }

                50% {
                    opacity: .55;
                    box-shadow: 0 0 0 4px rgba(0, 208, 132, 0);
                }

            }

            @media (prefers-reduced-motion: reduce) {

                .tp9s-row-live .tp9s-live-dot {
                    animation: none;
                }

            }


            .tp9s-streamer-delete {

                width: 26px;
                height: 26px;

                padding: 0;

                display: flex;

                align-items: center;

                justify-content: center;

                border: 1px solid rgba(255,255,255,.08);

                border-radius: 50%;

                background: rgba(255,255,255,.04);

                color: #8a7580;

                cursor: pointer;

                transition:
                    background-color .15s ease,
                    border-color .15s ease,
                    color .15s ease,
                    transform .1s ease;

            }


            .tp9s-streamer-delete:hover {

                background: rgba(255,70,70,.16);

                border-color: rgba(255,70,70,.4);

                color: #ff8a8a;

            }


            .tp9s-streamer-delete:active {

                transform: scale(.92);

            }


            .tp9s-session-row {

                grid-template-columns: 150px 1fr 76px;

            }


            .tp9s-logs {

                max-height: 60vh;

                overflow-y: auto;

            }


            .tp9s-log-filters {

                display: flex;

                align-items: center;

                flex-wrap: wrap;

                gap: 10px;

                margin-bottom: 12px;

            }


            .tp9s-log-level-btn {

                display: inline-flex;

                align-items: center;

                gap: 6px;

            }


            .tp9s-log-level-count {

                opacity: .7;

                font-size: 10px;

                font-variant-numeric: tabular-nums;

            }


            .tp9s-log-search {

                flex: 1 1 200px;

                min-width: 160px;

                padding: 7px 11px;

                border: 1px solid rgba(255,255,255,.1);

                border-radius: 8px;

                outline: none;

                background: rgba(0,0,0,.3);

                color: #efeff1;

                font-family: inherit;

                font-size: 12px;

                transition:
                    border-color .12s ease,
                    background-color .12s ease;

            }


            .tp9s-log-search:focus {

                border-color: #9147ff;

                background: rgba(0,0,0,.45);

            }


            .tp9s-log-search::placeholder {

                color: #6f6f7a;

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

            .tp9s-backup-status {

                display: flex;

                align-items: flex-start;

                gap: 14px;

                padding-bottom: 14px;

                margin-bottom: 14px;

                border-bottom: 1px solid rgba(255,255,255,.06);

            }


            .tp9s-backup-icon {

                flex: 0 0 auto;

                width: 40px;
                height: 40px;

                border-radius: 11px;

                display: flex;

                align-items: center;

                justify-content: center;

                font-size: 19px;

                background: color-mix(in srgb, var(--accent, #9147ff) 20%, transparent);

            }


            .tp9s-backup-desc {

                margin-top: 5px;

                color: #999;

                font-size: 12px;

                line-height: 1.5;

                max-width: 640px;

            }


            .tp9s-backup-hint {

                margin-top: 9px;

                padding: 8px 11px;

                border-radius: 8px;

                border-left: 2px solid var(--accent, #9147ff);

                background: rgba(255,255,255,.04);

                color: #a9a9a9;

                font-size: 11.5px;

                line-height: 1.45;

                max-width: 620px;

            }


            .tp9s-backup-meta {

                display: flex;

                flex-wrap: wrap;

                gap: 28px;

                margin-bottom: 16px;

            }


            .tp9s-backup-meta-label {

                display: block;

                font-size: 10px;

                font-weight: 700;

                letter-spacing: .5px;

                color: #777;

            }


            .tp9s-backup-meta-value {

                display: block;

                margin-top: 3px;

                font-size: 12.5px;

                font-weight: 600;

                color: #ddd;

            }


            .tp9s-backup-actions {

                display: flex;

                flex-wrap: wrap;

                gap: 8px;

            }


            .tp9s-backup-btn {

                border: 1px solid rgba(255,255,255,.1);

                border-radius: 9px;

                padding: 9px 14px;

                background: rgba(255,255,255,.05);

                color: #ddd;

                font-family: inherit;

                font-size: 12.5px;

                font-weight: 600;

                cursor: pointer;

                transition:
                    background-color .12s ease,
                    border-color .12s ease,
                    transform .1s ease;

            }


            .tp9s-backup-btn:hover {

                background: rgba(255,255,255,.1);

                border-color: rgba(255,255,255,.18);

            }


            .tp9s-backup-btn:active {

                transform: scale(.97);

            }


            .tp9s-backup-primary {

                background: linear-gradient(135deg, #9147ff, #772ce8) !important;

                border-color: transparent !important;

                color: #fff !important;

                box-shadow: 0 4px 14px rgba(145,71,255,.3);

            }


            .tp9s-backup-primary:hover {

                filter: brightness(1.1);

            }


            .tp9s-quarantine-badge {

                font-size: 11px;

                opacity: .85;

                cursor: help;

            }


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


            /* =====================================================
               HABITUDES — heatmap 7 jours x 24 heures
            ===================================================== */

            .tp9s-heat-grid {

                display: grid;

                grid-template-columns: 74px repeat(24, minmax(0, 1fr)) 58px;

                gap: 3px;

                align-items: center;

            }


            .tp9s-heat-day {

                font-size: 11px;

                color: #999;

                white-space: nowrap;

            }


            .tp9s-heat-hour {

                font-size: 9px;

                color: #666;

                text-align: center;

            }


            .tp9s-heat-cell {

                position: relative;

                aspect-ratio: 1 / 1;

                border-radius: 3px;

                background: rgba(255,255,255,.04);

                transition: transform .1s ease, box-shadow .1s ease;

            }


            .tp9s-heat-cell:hover {

                transform: scale(1.4);

                box-shadow: 0 0 0 1px rgba(255,255,255,.45);

                z-index: 1;

            }


            .tp9s-heat-l1 { background: rgba(145,71,255,.3); }
            .tp9s-heat-l2 { background: rgba(145,71,255,.52); }
            .tp9s-heat-l3 { background: rgba(145,71,255,.76); }
            .tp9s-heat-l4 { background: #a970ff; }


            .tp9s-heat-total {

                font-size: 10.5px;

                color: #888;

                text-align: right;

                white-space: nowrap;

            }


            .tp9s-heat-legend {

                display: flex;

                align-items: center;

                justify-content: flex-end;

                gap: 5px;

                margin-top: 12px;

                font-size: 10.5px;

                color: #777;

            }


            .tp9s-heat-legend .tp9s-heat-cell {

                display: inline-block;

                width: 11px;

                height: 11px;

                aspect-ratio: auto;

            }


            .tp9s-heat-legend .tp9s-heat-cell:hover {

                transform: none;

                box-shadow: none;

            }


            .tp9s-bar-row {

                display: grid;

                grid-template-columns: 96px 1fr 76px;

                gap: 12px;

                align-items: center;

                padding: 7px 0;

                font-size: 12px;

                color: #ccc;

            }


            .tp9s-bar-value {

                text-align: right;

                color: #bbb;

                font-weight: 600;

            }


            .tp9s-chart-controls {

                display: flex;

                align-items: center;

                flex-wrap: wrap;

                gap: 14px;

            }


            .tp9s-chart-range {

                display: flex;

                gap: 6px;

            }


            .tp9s-chart-range-btn {

                background: rgba(255,255,255,.05);

                border: 1px solid rgba(255,255,255,.08);

                color: #ccc;

                border-radius: 8px;

                padding: 5px 10px;

                font-size: 11px;

                font-weight: 600;

                cursor: pointer;

                transition: background .15s, color .15s;

            }


            .tp9s-chart-range-btn:hover {

                background: rgba(255,255,255,.1);

            }


            .tp9s-chart-range-active {

                background: var(--tp9-chart-color, #9147ff);

                border-color: var(--tp9-chart-color, #9147ff);

                color: #fff;

                box-shadow:
                    0 2px 10px var(--tp9-chart-glow, rgba(145,71,255,.45));

            }


            .tp9s-chart-canvas {

                position: relative;

                width: 100%;

                height: 160px;

                margin-top: 4px;

            }


            .tp9s-chart-svg {

                width: 100%;

                height: 100%;

                display: block;

                overflow: visible;

                cursor: crosshair;

            }


            .tp9s-chart-area {

                fill: url(#tp9sChartFill);

                stroke: none;

            }


            .tp9s-chart-line {

                fill: none;

                stroke: url(#tp9sChartStroke);

                stroke-width: 2.5px;

                stroke-linecap: round;

                stroke-linejoin: round;

                filter:
                    drop-shadow(0 2px 6px var(--tp9-chart-glow, rgba(145,71,255,.45)));

            }


            .tp9s-chart-axis-label {

                fill: #777;

                font-size: 9.5px;

                font-family: "Inter", Arial, sans-serif;

            }


            .tp9s-chart-axis-label-y {

                fill: #6b6b6b;

            }


            .tp9s-chart-grid-line {

                stroke: rgba(255,255,255,.07);

                stroke-width: 1px;

                stroke-dasharray: 3 5;

            }


            .tp9s-chart-grid-base {

                stroke: rgba(255,255,255,.12);

                stroke-dasharray: none;

            }


            .tp9s-chart-hover {

                opacity: 0;

                transition: opacity .12s ease;

                pointer-events: none;

            }


            .tp9s-chart-hovering .tp9s-chart-hover {

                opacity: 1;

            }


            .tp9s-chart-hover-line {

                stroke: rgba(255,255,255,.28);

                stroke-width: 1;

                stroke-dasharray: 3 3;

            }


            .tp9s-chart-hover-dot {

                fill: #fff;

                stroke: var(--tp9-chart-color, #9147ff);

                stroke-width: 2.5px;

                filter:
                    drop-shadow(0 0 4px var(--tp9-chart-glow-strong, rgba(145,71,255,.8)));

            }


            .tp9s-chart-tooltip {

                position: absolute;

                left: 0;
                top: 0;

                transform: translate(-50%, -130%);

                padding: 5px 9px;

                border-radius: 7px;

                background: #17171c;

                border: 1px solid rgba(255,255,255,.12);

                color: #efeff1;

                font-size: 11px;

                font-weight: 600;

                white-space: nowrap;

                pointer-events: none;

                opacity: 0;

                transition: opacity .12s ease;

                box-shadow: 0 6px 18px rgba(0,0,0,.4);

                z-index: 2;

            }


            .tp9s-chart-tooltip-left {

                transform: translate(-100%, -130%);

            }


            .tp9s-chart-hovering .tp9s-chart-tooltip {

                opacity: 1;

            }


            /* =====================================================
               MICRO-INTERACTIONS
               -----------------------------------------------------
               Un seul jeu de variables pour tous les mouvements :
               il suffit de les neutraliser une fois pour respecter
               "réduire les animations" du système. Rien d'autre que
               transform / opacity / box-shadow, donc composé par le
               GPU et sans recalcul de mise en page — ça compte, le
               dashboard se reconstruit plusieurs fois par minute.
            ===================================================== */

            :root {

                --tp9-lift: translateY(-1px);
                --tp9-press: scale(.97);
                --tp9-press-wide: scale(.99);
                --tp9-pop: scale(1.08);
                --tp9-press-pop: scale(.9);
                --tp9-slide: translateX(2px);

            }


            .tp9s-nav-item:hover {

                transform: var(--tp9-slide);

            }


            /* Toujours APRÈS le :hover : il reste actif pendant le
               clic et gagnerait sinon la cascade. */

            .tp9s-nav-item:active {

                transform: var(--tp9-press-wide);

            }


            .tp9s-close-btn {

                transition:
                    background-color .12s ease,
                    color .12s ease,
                    transform .12s ease;

            }


            .tp9s-close-btn:hover {

                transform: var(--tp9-lift);

            }


            .tp9s-close-btn:active {

                transform: var(--tp9-press-wide);

            }


            .tp9s-topbar-actions button:hover {

                transform: var(--tp9-pop);

            }


            .tp9s-topbar-actions button:active {

                transform: var(--tp9-press-pop);

            }


            .tp9s-panel-link {

                transition:
                    background-color .12s ease,
                    transform .12s ease;

            }


            .tp9s-panel-link:hover {

                transform: var(--tp9-lift);

            }


            .tp9s-panel-link:active {

                transform: var(--tp9-press);

            }


            .tp9s-chart-range-btn {

                transition:
                    background-color .12s ease,
                    border-color .12s ease,
                    color .12s ease,
                    box-shadow .12s ease,
                    transform .12s ease;

            }


            .tp9s-chart-range-btn:hover {

                transform: var(--tp9-lift);

            }


            .tp9s-chart-range-btn:active {

                transform: var(--tp9-press);

            }


            /* .tp9s-chart-range-btn:hover (0,2,0) l emporte sur
               .tp9s-chart-range-active (0,1,0) : sans cette regle,
               survoler le bouton actif lui ferait perdre la couleur
               de la courbe au profit du gris de survol. */

            .tp9s-chart-range-active:hover {

                background: var(--tp9-chart-color, #9147ff);

                filter: brightness(1.12);

            }


            .tp9s-backup-btn:hover {

                transform: var(--tp9-lift);

                box-shadow: 0 3px 10px rgba(0,0,0,.3);

            }


            .tp9s-backup-primary:hover {

                box-shadow: 0 6px 18px rgba(145,71,255,.45);

            }


            .tp9s-backup-btn:active {

                transform: var(--tp9-press);

                box-shadow: none;

            }


            .tp9s-clear-logs {

                transition:
                    background-color .12s ease,
                    transform .12s ease;

            }


            .tp9s-clear-logs:hover {

                transform: var(--tp9-lift);

            }


            .tp9s-clear-logs:active {

                transform: var(--tp9-press);

            }


            .tp9s-msg-count {

                transition:
                    background-color .12s ease,
                    transform .12s ease;

            }


            .tp9s-msg-count:hover {

                transform: var(--tp9-lift);

            }


            .tp9s-msg-count:active {

                transform: var(--tp9-press);

            }


            .tp9s-streamer-delete:hover {

                transform: var(--tp9-pop);

            }


            .tp9s-streamer-delete:active {

                transform: var(--tp9-press-pop);

            }


            .tp9s-table-row {

                transition:
                    background-color .12s ease,
                    transform .12s ease;

            }


            .tp9s-table-row:not(.tp9s-table-head):hover {

                transform: var(--tp9-slide);

            }


            .tp9s-sortable:active {

                transform: var(--tp9-press-wide);

            }


            .tp9s-card-clickable:active {

                transform: var(--tp9-lift);

            }


            .tp9-chat-modal-close {

                transition: color .12s ease, transform .12s ease;

            }


            .tp9-chat-modal-close:hover {

                transform: var(--tp9-pop);

            }


            .tp9-chat-modal-close:active {

                transform: var(--tp9-press-pop);

            }


            @media (prefers-reduced-motion: reduce) {

                :root {

                    --tp9-lift: none;
                    --tp9-press: none;
                    --tp9-press-wide: none;
                    --tp9-pop: none;
                    --tp9-press-pop: none;
                    --tp9-slide: none;

                }

                /* Mouvements antérieurs aux variables. */

                .tp9s-card:hover,
                .tp9s-heat-cell:hover {

                    transform: none;

                }

                /* La pastille de débit reste lisible sans clignoter. */

                .tp9s-card-live-dot {

                    animation: none;

                }

            }

            /* =====================================================
               REDESIGN — profondeur et dégradés
               -----------------------------------------------------
               Même principe que côté menu : bloc écrit en dernier,
               effets portés par la couleur autant que par le
               mouvement.
            ===================================================== */

            :root {

                --tp9-lift: translateY(-2px);
                --tp9-press: scale(.96);

            }


            /* Le gris #0a0a0c était parfaitement plat. Trois halos
               très diffus posés sur un dégradé sombre suffisent à
               donner de la profondeur — et comme cartes et panneaux
               sont translucides, c'est ce fond qu'on aperçoit à
               travers eux.

               Volontairement AUCUN backdrop-filter sur les cartes :
               derrière elles il n'y a qu'un dégradé lisse, un flou
               n'y changerait rien de visible alors qu'il coûte cher
               à repeindre — or le contenu de cet onglet est
               entièrement reconstruit à chaque resynchro entre
               onglets. Le flou est réservé à la barre latérale et à
               la barre du haut, qui elles ne bougent jamais. */

            #tp9-stats {

                background:
                    radial-gradient(1100px 620px at 6% -14%,
                        rgba(145,71,255,.2), transparent 60%),
                    radial-gradient(900px 520px at 104% 2%,
                        rgba(31,156,240,.12), transparent 58%),
                    radial-gradient(760px 520px at 52% 118%,
                        rgba(145,71,255,.1), transparent 60%),
                    linear-gradient(175deg, #101018, #0a0a0c 55%, #08080a);

            }


            .tp9s-main {

                background: transparent;

            }


            .tp9s-sidebar {

                background:
                    linear-gradient(180deg,
                        rgba(16,16,22,.8),
                        rgba(10,10,12,.62));

                backdrop-filter: blur(12px);

                border-right-color: rgba(255,255,255,.06);

            }


            .tp9s-topbar {

                background:
                    linear-gradient(180deg,
                        rgba(145,71,255,.1),
                        rgba(10,10,12,.2));

                backdrop-filter: blur(8px);

            }


            .tp9s-brand-icon {

                box-shadow: 0 4px 14px rgba(145,71,255,.4);

            }


            .tp9s-card {

                background:
                    linear-gradient(160deg,
                        rgba(255,255,255,.065),
                        rgba(255,255,255,.012));

                border-color: rgba(255,255,255,.08);

            }


            .tp9s-card::before {

                background:
                    linear-gradient(90deg,
                        var(--accent),
                        color-mix(in srgb, var(--accent) 8%, transparent));

            }


            .tp9s-card:hover {

                border-color:
                    color-mix(in srgb, var(--accent) 42%, transparent);

                box-shadow:
                    0 12px 28px rgba(0,0,0,.42),
                    0 0 20px -6px color-mix(in srgb, var(--accent) 45%, transparent);

            }


            .tp9s-panel {

                background:
                    linear-gradient(160deg,
                        rgba(255,255,255,.042),
                        rgba(255,255,255,.008));

                border-color: rgba(255,255,255,.07);

                transition: border-color .15s ease;

            }


            .tp9s-panel:hover {

                border-color: rgba(255,255,255,.1);

            }


            .tp9s-nav-item:hover {

                background:
                    linear-gradient(90deg,
                        rgba(255,255,255,.1),
                        rgba(255,255,255,.02));

            }


            .tp9s-nav-active {

                background:
                    linear-gradient(90deg,
                        rgba(145,71,255,.3),
                        rgba(145,71,255,.05)) !important;

                box-shadow: inset 0 0 0 1px rgba(145,71,255,.16);

            }


            .tp9s-topbar-actions button {

                background:
                    linear-gradient(135deg,
                        rgba(255,255,255,.09),
                        rgba(255,255,255,.03));

            }


            .tp9s-topbar-actions button:hover {

                background:
                    linear-gradient(135deg,
                        rgba(255,255,255,.18),
                        rgba(255,255,255,.06));

                transform: var(--tp9-pop);

            }


            /* PAS de translation ici : le conteneur .tp9s-table a
               overflow-x: auto, et une ligne décalée de 2 px dépasse
               sa largeur — ça faisait apparaître une barre de
               défilement horizontale sous le tableau à chaque survol.
               Le dégradé marque déjà la ligne. */

            .tp9s-table-row:not(.tp9s-table-head):hover {

                background:
                    linear-gradient(90deg,
                        rgba(145,71,255,.13),
                        rgba(255,255,255,.02) 55%);

                transform: none;

            }


            .tp9s-lead-row {

                border-radius: 8px;

                transition: background-color .12s ease;

            }


            .tp9s-lead-row:hover {

                background:
                    linear-gradient(90deg,
                        rgba(145,71,255,.12),
                        rgba(255,255,255,.02) 55%);

            }


            .tp9s-backup-primary {

                background:
                    linear-gradient(120deg, #a970ff, #772ce8 55%, #5b21b6) !important;

                background-size: 200% 100% !important;

                background-position: 0 0 !important;

                transition:
                    background-position .35s ease,
                    box-shadow .15s ease,
                    transform .12s ease !important;

            }


            .tp9s-backup-primary:hover {

                filter: none;

                background-position: 100% 0 !important;

                transform: var(--tp9-lift);

                box-shadow: 0 8px 22px rgba(145,71,255,.45);

            }


            .tp9s-backup-btn:hover {

                background:
                    linear-gradient(135deg,
                        rgba(255,255,255,.16),
                        rgba(255,255,255,.05));

            }


            .tp9s-chart-range-btn:hover {

                background:
                    linear-gradient(135deg,
                        rgba(255,255,255,.14),
                        rgba(255,255,255,.04));

            }


            /* Même raison qu'ailleurs : .tp9s-chart-range-btn:hover
               (0,2,0) l'emporterait sur .tp9s-chart-range-active
               (0,1,0), et survoler le bouton actif lui ferait perdre
               la couleur de la mesure en cours. */

            .tp9s-chart-range-active:hover {

                background: var(--tp9-chart-color, #9147ff);

                filter: brightness(1.12);

            }


            /* =====================================================
               ÉTATS ENFONCÉS — voir la note côté menu : toujours
               après les :hover de ce bloc.
            ===================================================== */

            .tp9s-nav-item:active {

                transform: var(--tp9-press-wide);

            }


            .tp9s-topbar-actions button:active {

                transform: var(--tp9-press-pop);

            }


            .tp9s-backup-btn:active,
            .tp9s-backup-primary:active,
            .tp9s-chart-range-btn:active {

                transform: var(--tp9-press);

                box-shadow: none;

            }


            @media (prefers-reduced-motion: reduce) {

                :root {

                    --tp9-lift: none;
                    --tp9-press: none;

                }

            }

            /* =====================================================
               RETOURS D'USAGE — barres par jour, modale tchat
            ===================================================== */

            .tp9s-bar-label {

                display: flex;

                align-items: center;

                gap: 8px;

            }


            /* --bar est posé sur la barre elle-même (voir
               renderStatsHabitudes) : le dégradé part d'une version
               éclaircie de la couleur du jour et y revient, ce qui
               garde du relief sans inventer une seconde teinte. */

            /* =====================================================
               MODALE — HISTORIQUE DES MESSAGES
            ===================================================== */

            .tp9-chat-modal-backdrop {

                background: rgba(0,0,0,.66);

                backdrop-filter: blur(3px);

            }


            .tp9-chat-modal-box {

                width: min(560px, 92vw);

                max-height: 76vh;

                border-radius: 16px;

                border-color: rgba(255,255,255,.12);

                background:
                    radial-gradient(600px 300px at 0% 0%,
                        rgba(145,71,255,.14), transparent 60%),
                    linear-gradient(180deg, #14141a, #0c0c10);

                box-shadow: 0 24px 70px rgba(0,0,0,.65);

                animation: tp9-chat-in .18s ease-out;

            }


            @keyframes tp9-chat-in {

                from {
                    opacity: 0;
                    transform: translateY(8px) scale(.985);
                }

                to {
                    opacity: 1;
                    transform: none;
                }

            }


            .tp9-chat-modal-header {

                padding: 14px 16px;

                border-bottom: 1px solid rgba(255,255,255,.07);

                background: linear-gradient(180deg,
                    rgba(145,71,255,.1), transparent);

            }


            .tp9-chat-modal-who {

                display: flex;

                align-items: center;

                gap: 11px;

                min-width: 0;

            }


            .tp9-chat-modal-avatar {

                flex: 0 0 auto;

                width: 36px;
                height: 36px;

                border-radius: 50%;

                overflow: hidden;

                display: flex;

                align-items: center;

                justify-content: center;

                font-size: 14px;

                font-weight: 800;

                color: #fff;

                background: linear-gradient(135deg, #9147ff, #4c1d95);

            }


            .tp9-chat-modal-avatar img {

                width: 100%;
                height: 100%;

                object-fit: cover;

            }


            .tp9-chat-modal-ident {

                min-width: 0;

            }


            .tp9-chat-modal-title {

                font-size: 14.5px;

                font-weight: 800;

                white-space: nowrap;

                overflow: hidden;

                text-overflow: ellipsis;

            }


            .tp9-chat-modal-sub {

                margin-top: 1px;

                font-size: 11px;

                font-weight: 600;

                color: #9d8ac2;

            }


            .tp9-chat-modal-list {

                flex: 1 1 auto;

                max-height: none;

                padding: 6px 14px 14px;

                scrollbar-width: thin;

                scrollbar-color: rgba(255,255,255,.18) transparent;

            }


            .tp9-chat-modal-list::-webkit-scrollbar {

                width: 8px;

            }


            .tp9-chat-modal-list::-webkit-scrollbar-thumb {

                border-radius: 8px;

                background: rgba(255,255,255,.14);

            }


            /* ---- séparateur de journée ---- */

            .tp9-chat-day {

                display: flex;

                align-items: center;

                gap: 10px;

                margin: 14px 0 9px;

                font-size: 10px;

                font-weight: 700;

                letter-spacing: .6px;

                text-transform: uppercase;

                color: #7e7e8a;

            }


            .tp9-chat-day::before,
            .tp9-chat-day::after {

                content: '';

                flex: 1 1 auto;

                height: 1px;

                background: rgba(255,255,255,.07);

            }


            .tp9-chat-day:first-child {

                margin-top: 4px;

            }


            /* ---- une ligne = heure + bulle ---- */

            .tp9-chat-row {

                display: flex;

                align-items: flex-start;

                gap: 10px;

                padding: 3px 0;

            }


            .tp9-chat-time {

                flex: 0 0 auto;

                width: 36px;

                padding-top: 7px;

                color: #6f6f7a;

                font-size: 10.5px;

                font-variant-numeric: tabular-nums;

                text-align: right;

            }


            .tp9-chat-bubble {

                position: relative;

                max-width: 100%;

                padding: 7px 12px;

                border-radius: 12px 12px 12px 4px;

                background:
                    linear-gradient(135deg,
                        rgba(145,71,255,.24),
                        rgba(145,71,255,.1));

                border: 1px solid rgba(145,71,255,.22);

                color: #eee;

                font-size: 12.5px;

                line-height: 1.45;

                word-break: break-word;

                transition: border-color .12s ease;

            }


            .tp9-chat-row:hover .tp9-chat-bubble {

                border-color: rgba(145,71,255,.45);

            }


            .tp9-chat-row:hover .tp9-chat-time {

                color: #b9b9c4;

            }

            /* =====================================================
               HALO QUI SUIT LE CURSEUR
               -----------------------------------------------------
               Même mécanique que côté menu (voir le commentaire de
               la feuille du popup) : --mx / --my viennent de
               attachSpotlight(), le reste est un simple dégradé.
            ===================================================== */

            .tp9s-nav-item,
            .tp9s-close-btn,
            .tp9s-topbar-actions button,
            .tp9s-panel-link,
            .tp9s-chart-range-btn,
            .tp9s-backup-btn,
            .tp9s-clear-logs,
            .tp9s-msg-count,
            .tp9s-streamer-delete,
            .tp9-chat-modal-close {

                position: relative;

            }


            .tp9s-nav-item::after,
            .tp9s-close-btn::after,
            .tp9s-topbar-actions button::after,
            .tp9s-panel-link::after,
            .tp9s-chart-range-btn::after,
            .tp9s-backup-btn::after,
            .tp9s-clear-logs::after,
            .tp9s-msg-count::after,
            .tp9s-streamer-delete::after,
            .tp9-chat-modal-close::after {

                content: '';

                position: absolute;

                inset: 0;

                border-radius: inherit;

                pointer-events: none;

                opacity: 0;

                background:
                    radial-gradient(
                        circle var(--tp9-spot, 110px)
                            at var(--mx, 50%) var(--my, 50%),
                        rgba(255,255,255,.2),
                        rgba(255,255,255,0) 72%);

                transition: opacity .15s ease;

            }


            .tp9s-nav-item:hover::after,
            .tp9s-close-btn:hover::after,
            .tp9s-topbar-actions button:hover::after,
            .tp9s-panel-link:hover::after,
            .tp9s-chart-range-btn:hover::after,
            .tp9s-backup-btn:hover::after,
            .tp9s-clear-logs:hover::after,
            .tp9s-msg-count:hover::after,
            .tp9s-streamer-delete:hover::after,
            .tp9-chat-modal-close:hover::after {

                opacity: 1;

            }


            /* Petits boutons : halo resserré, sinon il couvre tout. */

            .tp9s-topbar-actions button,
            .tp9s-streamer-delete,
            .tp9-chat-modal-close {

                --tp9-spot: 30px;

            }


            .tp9s-msg-count,
            .tp9s-panel-link,
            .tp9s-chart-range-btn {

                --tp9-spot: 55px;

            }


            /* La nav est large mais peu haute : un halo trop grand y
               ressemblerait à un simple fond clair. */

            .tp9s-nav-item {

                --tp9-spot: 70px;

            }


            /* Sur les boutons déjà colorés (mesure/période actifs,
               bouton de sauvegarde principal), le blanc franc
               délaverait la couleur : on l'adoucit. */

            .tp9s-chart-range-active::after,
            .tp9s-backup-primary::after {

                background:
                    radial-gradient(
                        circle var(--tp9-spot, 110px)
                            at var(--mx, 50%) var(--my, 50%),
                        rgba(255,255,255,.28),
                        rgba(255,255,255,0) 70%);

            }


            /* =====================================================
               HALO QUI SUIT LE CURSEUR — CARTES ET LIGNES
               -----------------------------------------------------
               Les surfaces, pas seulement les boutons : cartes de la
               Vue d'ensemble et des Habitudes, lignes des tableaux
               Relais et Streamers.

               .tp9s-table-head est exclue partout : pour le CSS c'est
               une ligne comme les autres, mais rien n'y réagit au
               survol (même exclusion que sa règle de survol plus
               haut). Ni transform ni animation ici : c'est ce qui
               évite la barre de défilement fantôme sous les tableaux,
               et ce qui fait survivre l'effet à
               prefers-reduced-motion.
            ===================================================== */

            .tp9s-card,
            .tp9s-table-row:not(.tp9s-table-head),
            .tp9s-lead-row {

                position: relative;

            }


            .tp9s-card::after,
            .tp9s-table-row:not(.tp9s-table-head)::after,
            .tp9s-lead-row::after {

                content: '';

                position: absolute;

                inset: 0;

                border-radius: inherit;

                pointer-events: none;

                opacity: 0;

                background:
                    radial-gradient(
                        circle var(--tp9-spot, 110px)
                            at var(--mx, 50%) var(--my, 50%),
                        rgba(255,255,255,.2),
                        rgba(255,255,255,0) 72%);

                transition: opacity .15s ease;

            }


            .tp9s-card:hover::after,
            .tp9s-table-row:not(.tp9s-table-head):hover::after,
            .tp9s-lead-row:hover::after {

                opacity: 1;

            }


            /* Une carte est large ET haute : le halo peut y être plus
               généreux sans tout éclairer. Une ligne de tableau est
               une bande basse, on le resserre. */

            .tp9s-card {

                --tp9-spot: 150px;

            }


            .tp9s-table-row,
            .tp9s-lead-row {

                --tp9-spot: 90px;

            }


            /* =====================================================
               LIGNES À BARRES — sessions et jours de la semaine
               -----------------------------------------------------
               Deux défauts corrigés ici :

               - la colonne de date passait sur deux lignes ("sam.
                 19/09 14:28" ne tenait pas en 150 px), ce qui
                 désalignait toute la ligne ;
               - toutes les valeurs étaient données par une barre à
                 l'échelle du maximum, donc quand les jours se
                 ressemblent (5 h contre 6 h 30) elles paraissaient
                 toutes pleines. Le pourcentage à droite donne le
                 point de repère qui manquait.
            ===================================================== */

            .tp9s-bar-row {

                white-space: nowrap;

            }


            .tp9s-session-row {

                grid-template-columns: 112px 106px 1fr 62px;

            }


            .tp9s-bar-label {

                min-width: 0;

                overflow: hidden;

                text-overflow: ellipsis;

            }


            .tp9s-bar-range {

                color: #8b8b95;

                font-size: 11.5px;

                font-variant-numeric: tabular-nums;

            }


            .tp9s-bar-value {

                font-variant-numeric: tabular-nums;

            }


            /* Un jour sans visionnage : la couleur du jour n'a plus
               rien à signaler, elle ne doit pas attirer l'œil. */

            /* Le jour le plus chargé se repère sans lire les
               chiffres. */

            /* Une carte non cliquable affichait le curseur « texte »
               (la barre en I) dès qu'on passait sur ses libellés :
               elle se lit, elle ne s'édite pas. Le :not() sert deux
               fois — il laisse leur curseur main aux cartes
               cliquables, et il évite que cette règle, écrite après
               les leurs, ne l'écrase (à spécificité égale, la
               dernière gagne). */

            .tp9s-card:not(.tp9s-card-clickable) {

                cursor: default;

            }

            /* =====================================================
               LISIBILITÉ DES TABLEAUX
               -----------------------------------------------------
               Les deux tableaux affichaient jusqu'à huit colonnes
               dans le même blanc et la même graisse : rien n'y
               guidait l'œil, et le score n'était qu'un nombre nu
               sans échelle. Trois outils seulement, pour ne pas
               transformer un tableau en sapin de Noël : une pastille
               colorée pour le score, une unité atténuée derrière
               chaque nombre, et un gris pour les colonnes d'appoint.
            ===================================================== */

            /* Les colonnes de chiffres ne s'alignaient pas d'une
               ligne à l'autre : sans chasse fixe, « 1180 » est plus
               large que « 320 ». */

            .tp9s-table-row,
            .tp9s-lead-row {

                font-variant-numeric: tabular-nums;

            }


            .tp9s-unit {

                margin-left: 2px;

                font-size: .85em;

                font-weight: 600;

                opacity: .5;

            }


            .tp9s-td-dim {

                color: #86868f;

            }


            .tp9s-td-strong {

                color: #fff;

                font-weight: 700;

            }


            /* La pastille répond aux deux questions que posait le
               nombre nu : sur quelle échelle, et dans quel sens. */

            .tp9s-score-badge {

                display: inline-flex;

                align-items: center;

                justify-content: center;

                min-width: 34px;

                padding: 2px 8px;

                border-radius: 999px;

                background:
                    color-mix(in srgb, var(--tone) 18%, transparent);

                box-shadow:
                    inset 0 0 0 1px
                    color-mix(in srgb, var(--tone) 32%, transparent);

                color: var(--tone);

                font-size: 11.5px;

                font-weight: 800;

                cursor: help;

            }


            /* Le proxy principal d'un streamer était du texte comme
               le reste : en étiquette teintée de sa région, on le
               relie d'un coup d'œil au menu et au tableau Proxys. */

            .tp9s-tag {

                display: inline-flex;

                align-items: center;

                gap: 5px;

                max-width: 100%;

                padding: 2px 9px;

                border-radius: 999px;

                background:
                    color-mix(in srgb, var(--tone, #9147ff) 16%, transparent);

                box-shadow:
                    inset 0 0 0 1px
                    color-mix(in srgb, var(--tone, #9147ff) 28%, transparent);

                color:
                    color-mix(in srgb, var(--tone, #9147ff) 65%, #fff);

                font-size: 11px;

                font-weight: 700;

                white-space: nowrap;

                overflow: hidden;

                text-overflow: ellipsis;

            }


            /* Les pastilles de région du tableau Proxys : le dégradé
               d'origine partait vers un violet unique, qui écrasait
               justement la couleur qu'on vient d'y mettre. */

            .tp9s-table-row-relais .tp9s-avatar {

                background:
                    linear-gradient(135deg,
                        color-mix(in srgb, var(--accent) 34%, transparent),
                        color-mix(in srgb, var(--accent) 12%, transparent));

                box-shadow:
                    inset 0 0 0 1px
                    color-mix(in srgb, var(--accent) 40%, transparent);

                font-size: 12px;

            }

            /* =====================================================
               HABITUDES — frise des sessions, semaine en colonnes
               -----------------------------------------------------
               Deux graphiques qui ne disaient rien :

               - les sessions étaient des barres à l'échelle de la
                 plus longue, donc la première ligne était toujours
                 pleine par construction, et des longueurs qui
                 varient sur des lignes chronologiques se lisaient
                 comme un classement inexistant ;
               - la semaine était sept lignes à parcourir une par
                 une, là où sept colonnes se lisent d'un regard.
            ===================================================== */

            /* ---- frise horaire ---- */

            .tp9s-time-head {

                padding-bottom: 2px;

            }


            .tp9s-time-axis {

                display: flex;

                justify-content: space-between;

                font-size: 9.5px;

                font-variant-numeric: tabular-nums;

                color: #6f6f7a;

            }


            /* Un trait tous les quart de journée (0h, 6h, 12h, 18h) :
               assez pour situer « matin » ou « soir » sans quadriller
               la bande de vingt-quatre barreaux. */

            .tp9s-time-track {

                position: relative;

                height: 14px;

                border-radius: 5px;

                background:
                    repeating-linear-gradient(90deg,
                        rgba(255,255,255,.09) 0 1px,
                        transparent 1px 25%),
                    rgba(255,255,255,.045);

                box-shadow: inset 0 0 0 1px rgba(255,255,255,.04);

            }


            .tp9s-time-seg {

                position: absolute;

                top: 2px;
                bottom: 2px;

                min-width: 3px;

                border-radius: 4px;

                background:
                    linear-gradient(90deg,
                        color-mix(in srgb, var(--bar, #9147ff) 58%, #fff),
                        var(--bar, #9147ff));

                box-shadow: 0 0 9px -2px var(--bar, #9147ff);

                transition: filter .12s ease;

            }


            .tp9s-time-seg:hover {

                filter: brightness(1.18);

            }


            /* ---- semaine en colonnes ---- */

            .tp9s-week-chart {

                display: grid;

                grid-template-columns: repeat(7, minmax(0, 1fr));

                gap: 10px;

                align-items: end;

                padding-top: 4px;

            }


            .tp9s-week-col {

                display: flex;

                flex-direction: column;

                align-items: center;

                gap: 7px;

                min-width: 0;

            }


            .tp9s-week-value {

                font-size: 11.5px;

                font-weight: 700;

                font-variant-numeric: tabular-nums;

                white-space: nowrap;

            }


            .tp9s-week-bar-wrap {

                display: flex;

                align-items: flex-end;

                width: 100%;

                height: 132px;

            }


            .tp9s-week-bar {

                width: 100%;

                min-height: 3px;

                border-radius: 6px 6px 3px 3px;

                background:
                    linear-gradient(180deg,
                        color-mix(in srgb, var(--bar, #9147ff) 62%, #fff),
                        var(--bar, #9147ff));

                transition: height .5s ease, filter .12s ease;

            }


            .tp9s-week-col:hover .tp9s-week-bar {

                filter: brightness(1.15);

            }


            .tp9s-week-day {

                font-size: 11px;

                font-weight: 600;

                color: #9a9aa3;

            }


            /* Le jour le plus chargé se repère sans lire les
               chiffres. */

            .tp9s-week-top .tp9s-week-day {

                color: #fff;

                font-weight: 700;

            }


            .tp9s-week-top .tp9s-week-bar {

                box-shadow: 0 0 12px -2px var(--bar, #9147ff);

            }


            /* Un jour sans visionnage : sa couleur n'a plus rien à
               signaler, elle ne doit pas attirer l'œil. */

            .tp9s-week-empty .tp9s-week-value,
            .tp9s-week-empty .tp9s-week-day {

                opacity: .38;

            }


            .tp9s-week-empty .tp9s-week-bar {

                background: rgba(255,255,255,.08);

                box-shadow: none;

            }


            @media (prefers-reduced-motion: reduce) {

                .tp9s-week-bar {

                    transition: none;

                }

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
        { id: 'relais', label: 'Proxys', icon: '📡', group: 'GÉNÉRAL' },
        { id: 'streamers', label: 'Streamers', icon: '🎥', group: 'GÉNÉRAL' },
        { id: 'habitudes', label: 'Habitudes', icon: '🕒', group: 'GÉNÉRAL' },
        { id: 'sauvegarde', label: 'Sauvegarde', icon: '💾', group: 'SYSTÈME' },
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
                        <div class="tp9s-brand-title">DASHBOARD<span class="tp9s-brand-version">v${CURRENT_VERSION}</span></div>
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
                        <button type="button" class="tp9s-refresh" data-tp9-tip="Rafraîchir les stats" data-tp9-tip-sub="Relit les statistiques enregistrées par les autres onglets.">🔄</button>
                        <button type="button" class="tp9s-reset-stats" data-tp9-tip="Réinitialiser les stats" data-tp9-tip-sub="Efface tout : usage des proxys, tchat, bande passante, logs.">${trashIconSVG(15)}</button>
                        <button type="button" class="tp9s-close" data-tp9-tip="Fermer le dashboard">×</button>
                    </div>
                </div>

                <div class="tp9s-content"></div>

            </div>

        `;

        document.body.appendChild(statsDashboard);

        injectStatsCSS();

        attachTooltips(statsDashboard);

        attachSpotlight(statsDashboard);

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

        setInterval(refreshLiveThroughput, 5000);

        // Une seconde : c'est le pas du chiffre le plus fin affiché.
        // La fonction sort d'elle-même dès que l'onglet Streamers
        // n'est pas à l'écran.
        setInterval(refreshLiveStreamerRows, 1000);

        // Délégué : le contenu (cartes, tableaux, ...) est
        // reconstruit à chaque rendu, on écoute donc au niveau du
        // conteneur persistant plutôt que sur chaque élément.
        statsDashboard.addEventListener('click', function (event) {

            // Les boutons de niveau portent AUSSI la classe des
            // boutons de période (même habillage, pas de CSS
            // dupliqué) : il faut donc les reconnaître AVANT, sinon
            // le test suivant les capte et ne fait rien.
            var logLevelBtn = event.target.closest('.tp9s-log-level-btn');

            if (logLevelBtn) {

                var level = logLevelBtn.getAttribute('data-log-level');

                if (level !== statsLogLevel) {

                    statsLogLevel = level;

                    refreshLogList();

                }

                return;

            }

            var chartBtn = event.target.closest(
                '.tp9s-chart-range-btn, .tp9s-chart-metric-btn'
            );

            if (chartBtn) {

                var newMetric = chartBtn.getAttribute('data-metric');
                var newRange = chartBtn.getAttribute('data-range');

                // Un bouton de mesure porte les deux classes mais
                // n'a pas de data-range : on teste donc la mesure
                // en premier.
                if (newMetric) {

                    if (newMetric === statsChartMetric) {
                        return;
                    }

                    statsChartMetric = newMetric;

                } else if (newRange) {

                    if (newRange === statsWatchChartRange) {
                        return;
                    }

                    statsWatchChartRange = newRange;

                } else {

                    return;

                }

                refreshChartPanel(chartBtn.closest('.tp9s-panel'));

                return;

            }

            var sortHeader = event.target.closest('[data-sort-key]');

            if (sortHeader) {

                var sortTable = sortHeader.getAttribute('data-sort-table');
                var sortKeyClicked = sortHeader.getAttribute('data-sort-key');

                toggleSort(sortTable, sortKeyClicked);

                if (sortTable === 'relais') {
                    renderStatsRelais(statsDashboard.querySelector('.tp9s-content'));
                } else if (sortTable === 'streamers') {
                    renderStatsStreamers(statsDashboard.querySelector('.tp9s-content'));
                }

                return;

            }

            var msgBtn = event.target.closest('.tp9s-msg-count');

            if (msgBtn) {

                showChatHistoryModal(msgBtn.getAttribute('data-channel'));

                return;

            }

            var deleteBtn = event.target.closest('.tp9s-streamer-delete');

            if (deleteBtn) {

                deleteStreamerStats(deleteBtn.getAttribute('data-channel'));

                return;

            }

            if (event.target.closest('.tp9s-streamers-clean')) {

                cleanPhantomStreamers();

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

        // Écoute déléguée, comme les clics : le champ est recréé à
        // chaque rendu complet de l'onglet.
        statsDashboard.addEventListener('input', function (event) {

            var search = event.target.closest('.tp9s-log-search');

            if (!search) {
                return;
            }

            statsLogQuery = search.value;

            refreshLogList();

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
    var STATS_TAB_PARAM = 'tp9_tab';

    var isDashboardOnlyTab = false;

    try {

        var dashboardParams = new URLSearchParams(location.search);

        isDashboardOnlyTab =
            dashboardParams.get(STATS_DASHBOARD_PARAM) === '1';

        var requestedTab = dashboardParams.get(STATS_TAB_PARAM);

        var tabExists = STATS_TABS.some(function (tab) {
            return tab.id === requestedTab;
        });

        if (tabExists) {
            statsActiveTab = requestedTab;
        }

    } catch (e) {}

    // Ouvre le dashboard dans un NOUVEL onglet Twitch (même origine
    // donc même localStorage) plutôt qu'en overlay par-dessus le
    // lecteur en cours — évite de masquer le stream.
    function openStatsDashboardInNewTab(initialTab) {

        try {

            // On évite l'accueil Twitch ("/") : il autoplay une
            // preview de stream en vedette (parfois avec le son).
            // Un nom de chaîne inexistant affiche une page "hors
            // ligne" sans aucune vidéo.
            var url =
                location.origin +
                '/tp9proxydashboard?' +
                STATS_DASHBOARD_PARAM +
                '=1' +
                (initialTab
                    ? '&' + STATS_TAB_PARAM + '=' + encodeURIComponent(initialTab)
                    : '');

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

        var previousEpoch = pageStats.epoch || 0;

        pageStats = defaultStats();

        // Le nouvel epoch dit aux autres onglets de jeter ce qu'ils
        // gardaient en mémoire : sinon leur prochaine sauvegarde
        // ferait réapparaître une partie des chiffres effacés.
        pageStats.epoch = previousEpoch + 1;

        saveStatsNow({ authoritative: true });

        logEvent('warn', 'Statistiques réinitialisées');

        renderStatsDashboard();

        var btn = statsDashboard && statsDashboard.querySelector('.tp9s-reset-stats');

        if (btn) {

            // innerHTML et pas textContent : le bouton contient une
            // icône SVG, que textContent effacerait définitivement.
            var original = btn.innerHTML;

            btn.innerHTML = '✅';

            setTimeout(
                function () {

                    btn.innerHTML = original;

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
        overview: { title: 'VUE D’ENSEMBLE', sub: 'Ton activité Twitch et l\'état de tes proxys en un coup d\'œil' },
        relais: { title: 'PROXYS', sub: 'Classement et utilisation de tes proxys' },
        streamers: { title: 'STREAMERS', sub: 'Statistiques par chaîne regardée' },
        habitudes: { title: 'HABITUDES', sub: 'Quand est-ce que tu regardes Twitch ?' },
        sauvegarde: { title: 'SAUVEGARDE', sub: 'Mettre tes statistiques à l\'abri d\'un nettoyage de navigateur' },
        logs: { title: 'LOGS', sub: 'Journal des événements du script' }
    };

    // ------------------------------------------------------------
    // RAFRAÎCHISSEMENT SANS RECONSTRUCTION
    // ------------------------------------------------------------
    //
    // Le dashboard se rafraîchit dès que les données changent — donc
    // toutes les quelques secondes pendant un stream, puisque
    // l'onglet qui lit écrit ses stats en continu. Avant, chaque
    // rafraîchissement faisait `content.innerHTML = ...` : tout
    // l'onglet était détruit puis reconstruit, à chaque fois.
    //
    // Ce que ça coûtait, visiblement :
    //   - une micro-saccade (des centaines de nœuds recréés) ;
    //   - le halo qui saute : --mx / --my sont écrits SUR l'élément
    //     survolé, son remplaçant ne les a pas, la lumière repart
    //     donc au centre et le fondu du ::after rejoue ;
    //   - l'infobulle qui décroche (rattrapée après coup par
    //     refreshTooltipAnchor) ;
    //   - le graphique SVG entièrement redessiné pour rien.
    //
    // Maintenant on rend le nouvel état DANS UN CONTENEUR DÉTACHÉ,
    // puis on reporte sur l'affichage réel uniquement ce qui diffère :
    // les textes et les attributs. Les éléments survolés ne sont
    // jamais détruits — donc plus rien à recoller après coup, et la
    // fréquence de rafraîchissement n'est pas touchée.
    //
    // Si la structure a bougé pour de bon (une ligne apparaît, un
    // onglet change), la comparaison échoue franchement et on
    // retombe sur la reconstruction complète d'avant.

    // Contenu géré hors des fonctions de rendu : le graphique est
    // dessiné par renderWatchTimeChartSVG, qui a besoin d'une
    // largeur réelle. Dans le rendu en coulisse il reste donc vide —
    // le recopier effacerait le vrai. On n'y touche pas du tout,
    // attributs compris : la classe tp9s-chart-hovering y est posée
    // par le survol et serait sinon retirée sous le curseur.
    var DOM_PATCH_OPAQUE = 'tp9s-chart-canvas';

    function patchElementAttributes(live, next) {

        // La position du halo vit dans le style en ligne, écrite par
        // attachSpotlight. Recopier l'attribut style l'effacerait :
        // c'est exactement le saut qu'on cherche à supprimer.
        var mx = live.style && live.style.getPropertyValue('--mx');
        var my = live.style && live.style.getPropertyValue('--my');

        var i;
        var attr;

        for (i = next.attributes.length - 1; i >= 0; i--) {

            attr = next.attributes[i];

            if (live.getAttribute(attr.name) !== attr.value) {
                live.setAttribute(attr.name, attr.value);
            }

        }

        for (i = live.attributes.length - 1; i >= 0; i--) {

            attr = live.attributes[i];

            if (!next.hasAttribute(attr.name)) {
                live.removeAttribute(attr.name);
            }

        }

        if (mx) {
            live.style.setProperty('--mx', mx);
        }

        if (my) {
            live.style.setProperty('--my', my);
        }

    }

    // Renvoie false dès que les deux arbres divergent structurellement.
    // L'affichage peut alors être à moitié mis à jour : sans
    // importance, l'appelant reconstruit tout derrière.
    function patchDOMInPlace(live, next) {

        if (live.childNodes.length !== next.childNodes.length) {
            return false;
        }

        for (var i = 0; i < live.childNodes.length; i++) {

            var a = live.childNodes[i];
            var b = next.childNodes[i];

            if (a.nodeType !== b.nodeType) {
                return false;
            }

            if (a.nodeType === 3) {

                if (a.nodeValue !== b.nodeValue) {
                    a.nodeValue = b.nodeValue;
                }

                continue;

            }

            if (a.nodeType !== 1) {
                continue;
            }

            if (a.tagName !== b.tagName) {
                return false;
            }

            if (
                a.classList &&
                a.classList.contains(DOM_PATCH_OPAQUE)
            ) {
                continue;
            }

            patchElementAttributes(a, b);

            if (!patchDOMInPlace(a, b)) {
                return false;
            }

        }

        return true;

    }

    // Empreinte de ce que la vague AFFICHE réellement : c'est la
    // seule chose qui justifie de la redessiner.
    function currentChartSignature() {

        if (statsActiveTab !== 'overview') {
            return null;
        }

        return (
            statsChartMetric + '|' + statsWatchChartRange + '|' +
            getChartBuckets(statsWatchChartRange, statsChartMetric)
                .map(function (bucket) {
                    return bucket.ms;
                })
                .join(',')
        );

    }

    var lastRenderedHTML = null;
    var lastChartSignature = null;

    function renderStatsTabInto(target) {

        if (statsActiveTab === 'overview') {
            renderStatsOverview(target);
        } else if (statsActiveTab === 'relais') {
            renderStatsRelais(target);
        } else if (statsActiveTab === 'streamers') {
            renderStatsStreamers(target);
        } else if (statsActiveTab === 'habitudes') {
            renderStatsHabitudes(target);
        } else if (statsActiveTab === 'sauvegarde') {
            renderStatsBackup(target);
        } else if (statsActiveTab === 'logs') {
            renderStatsLogs(target);
        }

    }

    function updateStatsContentInPlace(content) {

        var staging = document.createElement('div');

        renderStatsTabInto(staging);

        var html = staging.innerHTML;

        // Rien de visible n'a changé : la plupart des écritures de
        // stats ne déplacent aucun chiffre de l'onglet affiché.
        if (html === lastRenderedHTML) {
            return;
        }

        lastRenderedHTML = html;

        if (!patchDOMInPlace(content, staging)) {

            var scrollTop = content.scrollTop;

            // Reconstruction complète : un champ en cours de saisie
            // (la recherche dans les logs) perdrait le focus et le
            // curseur en plein milieu d'un mot. On les note pour les
            // rendre au champ recréé.
            var focused = document.activeElement;

            var focusKey =
                focused &&
                focused.getAttribute &&
                focused.getAttribute('data-tp9-keep-focus');

            var caret = focusKey ? focused.selectionStart : null;

            renderStatsTabInto(content);

            if (focusKey) {

                var restored = content.querySelector(
                    '[data-tp9-keep-focus="' + focusKey + '"]'
                );

                if (restored) {

                    restored.focus();

                    try {
                        restored.setSelectionRange(caret, caret);
                    } catch (e) {}

                }

            }

            content.scrollTop = scrollTop;

            lastChartSignature = currentChartSignature();

            // Reconstruction complète : l'élément survolé a bien été
            // détruit, il faut raccrocher l'infobulle à son
            // remplaçant.
            refreshTooltipAnchor();

            return;

        }

        var signature = currentChartSignature();

        if (signature !== lastChartSignature) {

            lastChartSignature = signature;

            renderWatchTimeChartSVG(
                content.querySelector('.tp9s-chart-canvas')
            );

        }

    }

    // Le débit ne transite pas par les statistiques : aucune
    // écriture localStorage ne vient donc déclencher la resynchro
    // habituelle. On redessine quand — et seulement quand — le texte
    // affiché changerait, y compris pour le faire DISPARAÎTRE quand
    // la lecture s'arrête (plus aucun message n'arrive alors : d'où
    // le minuteur, qui est le seul à pouvoir constater la péremption).
    // Les lignes en cours se réécrivent À LA CELLULE, une fois par
    // seconde. Un renderStatsDashboard(true) complet referait tout
    // le tableau au même rythme — l'infobulle survolée, la colonne
    // triée et le défilement compris — pour deux nombres qui
    // changent.
    function refreshLiveStreamerRows() {

        if (
            !statsDashboard ||
            !statsDashboardVisible ||
            statsActiveTab !== 'streamers'
        ) {
            return;
        }

        var rows =
            statsDashboard.querySelectorAll('.tp9s-table-row-streamers[data-channel]');

        for (var i = 0; i < rows.length; i++) {

            var row = rows[i];

            var channel = row.getAttribute('data-channel');

            var s = pageStats.streamers[channel];

            if (!s) {
                continue;
            }

            var live = isStreamerLive(channel);

            row.classList.toggle('tp9s-row-live', live);

            var watchCell = row.querySelector('[data-tp9-live-watch]');

            if (watchCell) {

                var watchText = live
                    ? formatDurationPrecise(s.watchTimeMs)
                    : formatDuration(s.watchTimeMs);

                // Comparé avant écriture : réécrire un textContent
                // identique casse une sélection de texte en cours.
                if (watchCell.textContent !== watchText) {
                    watchCell.textContent = watchText;
                }

            }

            var bwCell = row.querySelector('[data-tp9-live-bw]');

            if (bwCell) {

                var bwHTML = withUnit(
                    live
                        ? formatBytesPrecise(s.bandwidthBytes)
                        : formatBytes(s.bandwidthBytes)
                );

                if (bwCell.innerHTML !== bwHTML) {
                    bwCell.innerHTML = bwHTML;
                }

            }

        }

    }

    var lastThroughputText = null;

    function refreshLiveThroughput() {

        if (!statsDashboardVisible || statsActiveTab !== 'overview') {
            return;
        }

        var text = formatThroughput(getTotalLiveThroughputBps());

        if (text === lastThroughputText) {
            return;
        }

        lastThroughputText = text;

        renderStatsDashboard(true);

    }

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

        // Resynchro entre onglets : mise à jour sur place, sans
        // détruire ce qui est sous le curseur. Voir le commentaire
        // de updateStatsContentInPlace.
        if (silent) {

            updateStatsContentInPlace(content);

            return;

        }

        renderStatsTabInto(content);

        // Reconstruction complète : la dernière empreinte connue ne
        // correspond plus à rien de comparable (le graphique vient
        // d'être dessiné pour de vrai, pas en coulisse).
        lastRenderedHTML = null;
        lastChartSignature = currentChartSignature();

        // Petite animation d'entrée à chaque changement d'onglet /
        // rafraîchissement manuel, pour un rendu plus vivant.
        content.classList.remove('tp9s-fade');
        void content.offsetWidth;
        content.classList.add('tp9s-fade');

    }

    // navTab (optionnel) : onglet vers lequel la carte navigue au
    // clic ("relais" / "streamers"). historyChannel (optionnel) :
    // en plus de naviguer, ouvre l'historique tchat de ce channel.
    // badge (optionnel, en dernier) : petit HTML déjà échappé, posé
    // à gauche de l'icône — sert à la pastille de débit en direct.
    function statCard(icon, label, value, sub, accent, navTab, historyChannel, badge) {

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
                    '<div class="tp9s-card-top-right">' +
                        (badge || '') +
                        '<div class="tp9s-card-icon">' + icon + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="tp9s-card-value">' + escapeHTML(String(value)) + '</div>' +
                '<div class="tp9s-card-sub">' + escapeHTML(sub || '') + '</div>' +
            '</div>'
        );

    }

    // ------------------------------------------------------------
    // GRAPHIQUE "TEMPS DE VISIONNAGE PAR JOUR"
    // ------------------------------------------------------------

    var MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
    var MONTH_LABELS_ABBR_DOT = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
    var DAY_LABELS_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

    // Sous une colonne de graphique, « Mercredi » ne tient pas.
    var DAY_LABELS_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

    var STATS_WATCH_RANGES = [
        { id: '24h', label: '24h' },
        { id: '7', label: '7 jours' },
        { id: '30', label: '30 jours' },
        { id: '365', label: '1 an' }
    ];

    var statsWatchChartRange = '24h';

    // 'watch' (temps de visionnage) ou 'bandwidth' (octets) :
    // voir STATS_CHART_METRICS.
    var statsChartMetric = 'watch';

    // range '24h' = fenêtre glissante des dernières 24 heures, un
    // point par heure (voir hourlyWatchTime / hourKeyFor). range
    // '365' regroupe par mois (12 barres), sinon un point par jour
    // (7 ou 30 barres) — sur 1 an, une barre par jour serait
    // illisible et de toute façon on ne conserve pas plus de 370
    // jours d'historique (voir pruneDailyMap).
    function getChartBuckets(range, metricId) {

        var metric =
            STATS_CHART_METRICS[metricId] ||
            STATS_CHART_METRICS.watch;

        var hourlyMap = pageStats[metric.hourly] || {};
        var dailyMap = pageStats[metric.daily] || {};

        var now = new Date();

        if (range === '24h') {

            var hourBuckets = [];

            for (var h = 23; h >= 0; h--) {

                var hourDate = new Date(now.getTime() - h * 60 * 60 * 1000);

                hourBuckets.push({
                    label: pad2(hourDate.getHours()) + 'h',
                    ms: hourlyMap[hourKeyFor(hourDate)] || 0
                });

            }

            return hourBuckets;

        }

        if (range === '365') {

            var monthBuckets = [];

            for (var m = 11; m >= 0; m--) {

                var d = new Date(now.getFullYear(), now.getMonth() - m, 1);

                var monthPrefix = d.getFullYear() + '-' + pad2(d.getMonth() + 1);

                var sum = 0;

                Object.keys(dailyMap).forEach(function (key) {

                    if (key.indexOf(monthPrefix) === 0) {
                        sum += dailyMap[key];
                    }

                });

                monthBuckets.push({
                    label: MONTH_LABELS[d.getMonth()],
                    ms: sum
                });

            }

            return monthBuckets;

        }

        var days = parseInt(range, 10);

        var dayBuckets = [];

        for (var i = days - 1; i >= 0; i--) {

            var day = new Date(now);

            day.setDate(day.getDate() - i);

            var dayLabel;

            if (range === '7') {
                dayLabel = DAY_LABELS_FULL[day.getDay()];
            } else {
                dayLabel = day.getDate() + ' ' + MONTH_LABELS_ABBR_DOT[day.getMonth()];
            }

            dayBuckets.push({
                label: dayLabel,
                ms: dailyMap[dateKeyFor(day)] || 0
            });

        }

        return dayBuckets;

    }

    function buildWatchTimeChartHTML() {

        var metric = getChartMetric();

        var buckets = getChartBuckets(statsWatchChartRange, statsChartMetric);

        var rangeButtons = STATS_WATCH_RANGES.map(function (r) {

            return (
                '<button type="button" class="tp9s-chart-range-btn' +
                    (r.id === statsWatchChartRange ? ' tp9s-chart-range-active' : '') +
                    '" data-range="' + r.id + '">' + escapeHTML(r.label) + '</button>'
            );

        }).join('');

        // Les boutons de mesure portent AUSSI la classe des boutons
        // de période : même habillage, sans dupliquer le CSS.
        var metricButtons = Object.keys(STATS_CHART_METRICS).map(function (id) {

            return (
                '<button type="button" class="tp9s-chart-range-btn tp9s-chart-metric-btn' +
                    (id === statsChartMetric ? ' tp9s-chart-range-active' : '') +
                    '" data-metric="' + id + '">' +
                    escapeHTML(STATS_CHART_METRICS[id].button) +
                '</button>'
            );

        }).join('');

        var total = buckets.reduce(function (acc, b) {
            return acc + b.ms;
        }, 0);

        return (
            '<div class="tp9s-panel">' +
                '<div class="tp9s-panel-title-row">' +
                    '<div>' +
                        '<div class="tp9s-panel-title">' +
                            escapeHTML(metric.title) +
                        '</div>' +
                        '<div class="tp9s-panel-sub">' +
                            escapeHTML(metric.format(total) + ' ' + metric.suffix) +
                        '</div>' +
                    '</div>' +
                    '<div class="tp9s-chart-controls">' +
                        '<div class="tp9s-chart-range">' + metricButtons + '</div>' +
                        '<div class="tp9s-chart-range">' + rangeButtons + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="tp9s-chart-canvas"></div>' +
            '</div>'
        );

    }


    // Redessine le graphique d'un panneau DÉJÀ affiché, sans
    // reconstruire tout l'onglet : sinon le scroll saute et les
    // autres cartes se ré-animent à chaque clic sur une période ou
    // une mesure.
    function refreshChartPanel(panel) {

        if (!panel) {
            return;
        }

        var metric = getChartMetric();

        // Les boutons de mesure sont aussi des .tp9s-chart-range-btn
        // (voir plus haut) : cette première passe les désactive tous,
        // la seconde rallume le bon.
        panel.querySelectorAll('.tp9s-chart-range-btn').forEach(function (btn) {

            btn.classList.toggle(
                'tp9s-chart-range-active',
                btn.getAttribute('data-range') === statsWatchChartRange
            );

        });

        panel.querySelectorAll('.tp9s-chart-metric-btn').forEach(function (btn) {

            btn.classList.toggle(
                'tp9s-chart-range-active',
                btn.getAttribute('data-metric') === statsChartMetric
            );

        });

        var titleEl = panel.querySelector('.tp9s-panel-title');

        if (titleEl) {
            titleEl.textContent = metric.title;
        }

        var subEl = panel.querySelector('.tp9s-panel-sub');

        if (subEl) {

            var total = getChartBuckets(statsWatchChartRange, statsChartMetric)
                .reduce(function (acc, b) {
                    return acc + b.ms;
                }, 0);

            subEl.textContent = metric.format(total) + ' ' + metric.suffix;

        }

        renderWatchTimeChartSVG(panel.querySelector('.tp9s-chart-canvas'));

    }

    // Spline cubique monotone (Hermite + correction Fritsch-Carlson,
    // la méthode utilisée par D3 "curveMonotoneX") plutôt qu'un
    // Catmull-Rom classique : donne l'effet "vague" demandé, MAIS
    // sans le défaut d'un Catmull-Rom simple, qui calcule chaque
    // tangente à partir des points voisins et peut donc faire
    // dépasser la courbe sous/au-dessus des valeurs réelles — par
    // exemple deux points à 0 juste avant une forte remontée se
    // retrouvaient reliés par un creux sous la ligne de base, alors
    // que la valeur ne descend jamais sous 0 entre ces deux points.
    // La version monotone garantit que la courbe reste toujours
    // comprise entre les valeurs des points qu'elle relie.
    function buildSmoothPath(points) {

        var n = points.length;

        if (n < 2) {

            return n === 1
                ? 'M' + points[0].x + ',' + points[0].y
                : '';

        }

        var dx = [];
        var dy = [];
        var slope = [];

        for (var i = 0; i < n - 1; i++) {

            dx[i] = points[i + 1].x - points[i].x;
            dy[i] = points[i + 1].y - points[i].y;
            slope[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0;

        }

        var tangent = new Array(n);

        tangent[0] = slope[0];
        tangent[n - 1] = slope[n - 2];

        for (var i = 1; i < n - 1; i++) {

            var left = slope[i - 1];
            var right = slope[i];

            // Segment plat, ou changement de sens (pic/creux local) :
            // tangente nulle pour éviter tout dépassement autour de
            // ce point.
            if (left === 0 || right === 0 || (left < 0) !== (right < 0)) {
                tangent[i] = 0;
            } else {
                tangent[i] = (left + right) / 2;
            }

        }

        // Correction Fritsch-Carlson : ramène les tangentes dans la
        // zone où le segment reste monotone (ne dépasse pas y[i] ni
        // y[i+1]) sur chaque intervalle.
        for (var i = 0; i < n - 1; i++) {

            if (slope[i] === 0) {

                tangent[i] = 0;
                tangent[i + 1] = 0;

                continue;

            }

            var a = tangent[i] / slope[i];
            var b = tangent[i + 1] / slope[i];
            var h = Math.sqrt(a * a + b * b);

            if (h > 3) {

                var tau = 3 / h;

                tangent[i] = tau * a * slope[i];
                tangent[i + 1] = tau * b * slope[i];

            }

        }

        var d = 'M' + points[0].x + ',' + points[0].y;

        for (var i = 0; i < n - 1; i++) {

            var p0 = points[i];
            var p1 = points[i + 1];

            var cp1x = p0.x + dx[i] / 3;
            var cp1y = p0.y + (tangent[i] * dx[i]) / 3;
            var cp2x = p1.x - dx[i] / 3;
            var cp2y = p1.y - (tangent[i + 1] * dx[i]) / 3;

            d += ' C' + cp1x + ',' + cp1y + ' ' + cp2x + ',' + cp2y + ' ' + p1.x + ',' + p1.y;

        }

        return d;

    }

    var CHART_HEIGHT = 160;
    var CHART_PAD_X = 8;
    var CHART_PAD_TOP = 16;

    // Marge gauche réservée aux graduations de l'axe vertical
    // ("30 min", "2h", ...) : assez large pour le plus long libellé
    // possible à 9.5px sans que le texte ne déborde du panneau.
    var CHART_PAD_LEFT = 42;

    // Paliers "ronds" candidats pour l'axe vertical : on retient le
    // plus petit qui découpe le max de la période en ~4 graduations,
    // pour ne jamais afficher de libellés du genre "47 min" ou
    // "3h17" sur le côté.
    var CHART_AXIS_STEPS_MS = [1, 2, 5, 10, 15, 30]
        .map(function (min) {
            return min * 60 * 1000;
        })
        .concat(
            [1, 2, 3, 6, 12, 24, 48, 120, 240, 480, 1200, 2400, 4800]
                .map(function (hours) {
                    return hours * 60 * 60 * 1000;
                })
        );

    var CHART_AXIS_TARGET_TICKS = 4;

    // Libellé court pour l'axe : formatDuration() renverrait "1h00"
    // là où "1h" suffit, et "0 min" là où un simple "0" est plus
    // lisible au ras de la ligne de base.
    function formatAxisDuration(ms) {

        if (!ms) {
            return '0';
        }

        if (ms < 60 * 60 * 1000) {
            return Math.round(ms / 60000) + ' min';
        }

        var totalMinutes = Math.round(ms / 60000);

        var hours = Math.floor(totalMinutes / 60);
        var minutes = totalMinutes % 60;

        if (!minutes) {
            return hours + 'h';
        }

        return hours + 'h' + (minutes < 10 ? '0' : '') + minutes;

    }

    var MB_BYTES = 1024 * 1024;

    // Mêmes paliers "ronds" que CHART_AXIS_STEPS_MS, mais en
    // octets. La bascule Mo -> Go se fait à 1000 Mo, comme dans
    // formatBytes().
    var CHART_AXIS_STEPS_BYTES = [10, 25, 50, 100, 250, 500]
        .map(function (mb) {
            return mb * MB_BYTES;
        })
        .concat(
            [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000]
                .map(function (gb) {
                    return gb * 1000 * MB_BYTES;
                })
        );

    // formatBytes() donnerait "1024.0 Mo" ou "2.00 Go" : trop long
    // et trop précis pour une graduation d'axe.
    function formatAxisBytes(bytes) {

        if (!bytes) {
            return '0';
        }

        var mb = bytes / MB_BYTES;

        if (mb >= 1000) {

            var gb = mb / 1000;

            return (
                (gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10) +
                ' Go'
            );

        }

        return Math.round(mb) + ' Mo';

    }

    // Le graphique sert deux mesures : le temps de visionnage et la
    // bande passante. Tout le reste — découpage en périodes, axe à
    // paliers ronds, vague lissée, tooltip — est commun ; seules la
    // source des données, la mise en forme et l'échelle changent.
    // Le champ `ms` d'un point porte donc "la valeur" du point, en
    // millisecondes ou en octets selon la mesure choisie.
    var STATS_CHART_METRICS = {

        watch: {
            title: '🕒 Temps de visionnage',
            button: '🕒 Temps',
            daily: 'dailyWatchTime',
            hourly: 'hourlyWatchTime',
            format: formatDuration,
            axisFormat: formatAxisDuration,
            steps: CHART_AXIS_STEPS_MS,
            emptyTop: 60 * 60 * 1000,
            suffix: 'cumulées sur la période',
            color: '#9147ff',
            colorLight: '#bf94ff',
            glow: 'rgba(145,71,255,.45)',
            glowStrong: 'rgba(145,71,255,.8)'
        },

        // Bleu, et surtout PAS rouge : le rouge veut déjà dire
        // "erreur" partout ailleurs dans le dashboard (latence
        // mauvaise, logs, suppression), une simple mesure de
        // volume s'y lirait comme une alerte.
        bandwidth: {
            title: '📶 Bande passante',
            button: '📶 Données',
            daily: 'dailyBandwidth',
            hourly: 'hourlyBandwidth',
            format: formatBytes,
            axisFormat: formatAxisBytes,
            steps: CHART_AXIS_STEPS_BYTES,
            emptyTop: 1000 * MB_BYTES,
            suffix: 'consommés sur la période',
            color: '#1f9cf0',
            colorLight: '#7ad2ff',
            glow: 'rgba(31,156,240,.45)',
            glowStrong: 'rgba(31,156,240,.8)'
        }

    };

    function getChartMetric() {

        return (
            STATS_CHART_METRICS[statsChartMetric] ||
            STATS_CHART_METRICS.watch
        );

    }

    // Renvoie les graduations, de 0 jusqu'au premier palier rond
    // au-dessus du max de la période. L'échelle suit donc la vague :
    // elle est recalculée à chaque changement de filtre
    // (24h / 7j / 30j / 1 an) ET de mesure.
    function buildChartAxisTicks(max, metric) {

        // Aucune donnée sur la période : on affiche quand même une
        // échelle par défaut, sinon la grille se réduirait à une
        // seule ligne et le graphique aurait l'air cassé.
        var target = max > 0 ? max : metric.emptyTop;

        var rough = target / CHART_AXIS_TARGET_TICKS;

        var steps = metric.steps;

        var step = steps[steps.length - 1];

        for (var i = 0; i < steps.length; i++) {

            if (steps[i] >= rough) {

                step = steps[i];

                break;

            }

        }

        var top = Math.ceil(target / step) * step;

        var ticks = [];

        for (var value = 0; value <= top; value += step) {

            ticks.push({
                ms: value,
                label: metric.axisFormat(value)
            });

        }

        return ticks;

    }

    // Redessine le graphique quand la largeur du conteneur change
    // (redimensionnement de fenêtre, ouverture/fermeture de la
    // sidebar, ...) : indispensable maintenant que le viewBox est
    // calé sur cette largeur — sans ça il resterait figé sur la
    // largeur du tout premier rendu. Un seul observer par conteneur
    // (il persiste même quand son contenu est reconstruit par
    // innerHTML à chaque changement de période).
    function attachChartResizeObserver(container) {

        if (
            container.__tp9ChartObserved ||
            typeof ResizeObserver === 'undefined'
        ) {
            return;
        }

        container.__tp9ChartObserved = true;

        var lastWidth = container.clientWidth;

        var observer = new ResizeObserver(function () {

            var width = container.clientWidth;

            if (width && width !== lastWidth) {

                lastWidth = width;

                renderWatchTimeChartSVG(container);

            }

        });

        observer.observe(container);

    }

    // Dessine le graphique en aire lissée directement en SVG (pas de
    // lib externe) et branche le survol souris/tactile pour la
    // tooltip — impossible à faire en pur innerHTML statique, donc
    // appelé juste après avoir inséré le conteneur dans le DOM.
    //
    // Le viewBox est calé sur la largeur RENDUE du conteneur (et non
    // sur une largeur logique fixe étirée via preserveAspectRatio=
    // "none") : sinon le repère x/y n'est plus carré, et tout ce qui
    // dépend de l'espace utilisateur SVG — stroke-width, le rayon du
    // point au survol, le filtre drop-shadow, le texte des axes — se
    // retrouve déformé/flou de façon non uniforme (cercle qui devient
    // une ellipse, texte étiré, halo pixelisé).
    function renderWatchTimeChartSVG(container) {

        if (!container) {
            return;
        }

        // Conteneur hors document : c'est le rendu en coulisse de
        // updateStatsContentInPlace(). Il n'a aucune largeur à
        // mesurer, et la nouvelle tentative programmée plus bas
        // tournerait en boucle sur un nœud que personne ne verra
        // jamais. Le vrai graphique, lui, est redessiné à part.
        if (container.isConnected === false) {
            return;
        }

        var chartWidth = Math.round(container.clientWidth || 0);

        if (!chartWidth) {

            // Conteneur pas encore mis en page (ex: premier rendu
            // avant que le navigateur n'ait calculé les tailles) :
            // on retente une frame plus tard plutôt que de dessiner
            // avec une largeur bidon qui serait de toute façon fausse.
            requestAnimationFrame(function () {
                renderWatchTimeChartSVG(container);
            });

            return;

        }

        attachChartResizeObserver(container);

        var metric = getChartMetric();

        // Le halo de la courbe, le point de survol ET les boutons
        // de mesure/période sont teintés par le CSS : on lui passe
        // la couleur de la mesure en cours.
        //
        // Les variables sont posées sur le PANNEAU et non sur le
        // canvas : les boutons sont des FRÈRES du canvas, et une
        // variable CSS n'hérite que vers le bas — portées par le
        // canvas elles ne les atteindraient jamais. Le canvas étant
        // un descendant du panneau, la courbe les voit toujours.
        var chartScope = container.closest('.tp9s-panel') || container;

        chartScope.style.setProperty('--tp9-chart-color', metric.color);
        chartScope.style.setProperty('--tp9-chart-glow', metric.glow);
        chartScope.style.setProperty('--tp9-chart-glow-strong', metric.glowStrong);

        var buckets = getChartBuckets(statsWatchChartRange, statsChartMetric);

        var showLabels = true;

        var bottomPad = showLabels ? 22 : 10;

        var innerW = chartWidth - CHART_PAD_LEFT - CHART_PAD_X;
        var innerH = CHART_HEIGHT - CHART_PAD_TOP - bottomPad;

        var max = buckets.reduce(function (acc, b) {
            return Math.max(acc, b.ms);
        }, 0);

        if (!buckets.length) {

            container.innerHTML = '<div class="tp9s-empty">Aucune donnée.</div>';

            return;

        }

        // Le sommet de la vague n'est plus calé sur la valeur max
        // brute (qui ne tombe presque jamais sur un palier lisible)
        // mais sur la dernière graduation : c'est ce qui rend les
        // libellés de gauche exploitables à l'oeil.
        var axisTicks = buildChartAxisTicks(max, metric);

        var axisTop = axisTicks[axisTicks.length - 1].ms || 1;

        var points = buckets.map(function (b, i) {

            var x = buckets.length > 1
                ? CHART_PAD_LEFT + (innerW * i) / (buckets.length - 1)
                : CHART_PAD_LEFT + innerW / 2;

            var y = CHART_PAD_TOP + innerH - (b.ms / axisTop) * innerH;

            return { x: x, y: y, ms: b.ms, label: b.label };

        });

        var linePath = buildSmoothPath(points);

        var baseline = CHART_PAD_TOP + innerH;

        var areaPath =
            linePath +
            ' L' + points[points.length - 1].x + ',' + baseline +
            ' L' + points[0].x + ',' + baseline +
            ' Z';

        // Grille horizontale + graduations : dessinées en premier
        // pour rester DERRIÈRE l'aire et la courbe.
        var gridSVG = axisTicks.map(function (t) {

            var y = Math.round(
                (CHART_PAD_TOP + innerH - (t.ms / axisTop) * innerH) * 10
            ) / 10;

            return (
                '<line class="tp9s-chart-grid-line' +
                    (t.ms === 0 ? ' tp9s-chart-grid-base' : '') +
                    '" x1="' + CHART_PAD_LEFT + '" y1="' + y +
                    '" x2="' + (CHART_PAD_LEFT + innerW) + '" y2="' + y +
                    '"></line>' +
                '<text x="' + (CHART_PAD_LEFT - 8) + '" y="' + y +
                    '" class="tp9s-chart-axis-label tp9s-chart-axis-label-y"' +
                    ' text-anchor="end" dominant-baseline="middle">' +
                    escapeHTML(t.label) + '</text>'
            );

        }).join('');

        var labelsSVG = showLabels
            ? points.map(function (p) {
                return (
                    '<text x="' + p.x + '" y="' + (CHART_HEIGHT - 6) +
                    '" class="tp9s-chart-axis-label" text-anchor="middle">' +
                    escapeHTML(p.label) + '</text>'
                );
            }).join('')
            : '';

        container.innerHTML =
            '<svg class="tp9s-chart-svg" viewBox="0 0 ' + chartWidth + ' ' + CHART_HEIGHT + '">' +
                '<defs>' +
                    '<linearGradient id="tp9sChartFill" x1="0" y1="0" x2="0" y2="1">' +
                        '<stop offset="0%" stop-color="' + metric.color + '" stop-opacity="0.5"/>' +
                        '<stop offset="100%" stop-color="' + metric.color + '" stop-opacity="0"/>' +
                    '</linearGradient>' +
                    '<linearGradient id="tp9sChartStroke" x1="0" y1="0" x2="1" y2="0">' +
                        '<stop offset="0%" stop-color="' + metric.colorLight + '"/>' +
                        '<stop offset="100%" stop-color="' + metric.color + '"/>' +
                    '</linearGradient>' +
                '</defs>' +
                gridSVG +
                '<path class="tp9s-chart-area" d="' + areaPath + '"></path>' +
                '<path class="tp9s-chart-line" d="' + linePath + '"></path>' +
                labelsSVG +
                '<g class="tp9s-chart-hover">' +
                    '<line class="tp9s-chart-hover-line" x1="0" y1="' + CHART_PAD_TOP + '" x2="0" y2="' + baseline + '"></line>' +
                    '<circle class="tp9s-chart-hover-dot" r="4"></circle>' +
                '</g>' +
            '</svg>' +
            '<div class="tp9s-chart-tooltip"></div>';

        var svg = container.querySelector('.tp9s-chart-svg');
        var hoverLine = container.querySelector('.tp9s-chart-hover-line');
        var hoverDot = container.querySelector('.tp9s-chart-hover-dot');
        var tooltip = container.querySelector('.tp9s-chart-tooltip');

        // Le viewBox correspond exactement à la taille rendue du SVG
        // (mesurée plus haut) : un simple ratio position-souris /
        // taille-rendue, multiplié par cette même largeur, retombe
        // donc directement sur les coordonnées utilisées pour les
        // points, sans aucune distorsion x/y à compenser.
        function handleMove(clientX, clientY) {

            var rect = svg.getBoundingClientRect();

            if (!rect.width) {
                return;
            }

            var relX = ((clientX - rect.left) / rect.width) * chartWidth;

            var nearestIndex = 0;
            var nearestDist = Infinity;

            points.forEach(function (p, i) {

                var dist = Math.abs(p.x - relX);

                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestIndex = i;
                }

            });

            var point = points[nearestIndex];

            container.classList.add('tp9s-chart-hovering');

            hoverLine.setAttribute('x1', point.x);
            hoverLine.setAttribute('x2', point.x);

            hoverDot.setAttribute('cx', point.x);
            hoverDot.setAttribute('cy', point.y);

            tooltip.textContent = point.label + ' · ' + metric.format(point.ms);

            var tooltipLeftPct = (point.x / chartWidth) * 100;
            var tooltipTopPct = (point.y / CHART_HEIGHT) * 100;

            tooltip.style.left = tooltipLeftPct + '%';
            tooltip.style.top = tooltipTopPct + '%';

            tooltip.classList.toggle('tp9s-chart-tooltip-left', tooltipLeftPct > 60);

        }

        function handleLeave() {

            container.classList.remove('tp9s-chart-hovering');

        }

        svg.addEventListener('mousemove', function (event) {
            handleMove(event.clientX, event.clientY);
        });

        svg.addEventListener('mouseleave', handleLeave);

        svg.addEventListener('touchmove', function (event) {

            if (event.touches && event.touches[0]) {
                handleMove(event.touches[0].clientX, event.touches[0].clientY);
            }

        }, { passive: true });

        svg.addEventListener('touchend', handleLeave);

    }

    function renderStatsOverview(content) {

        var ranking = getProxyRanking24h();

        // Le classement est trié par score : la carte "meilleure
        // latence" doit donc chercher le minimum elle-même plutôt
        // que de prendre le premier de la liste.
        var bestProxy = ranking.reduce(function (best, p) {

            if (p.avgLatency === null) {
                return best;
            }

            return (!best || p.avgLatency < best.avgLatency) ? p : best;

        }, null);

        var mostUsed = getMostUsedProxy();

        var topWatched = getTopStreamerByWatchTime();

        var topChatted = getTopStreamerByChatMessages();

        var activeCount = pageConfig.proxies.filter(function (p) { return p.enabled; }).length;

        // Débit en cours, tous onglets qui lisent confondus. Null
        // dès qu'aucun n'a rien téléchargé depuis 20 s : la pastille
        // disparaît alors au lieu d'afficher une valeur morte.
        var liveThroughputText =
            formatThroughput(getTotalLiveThroughputBps());

        var directPlaybacks = getDirectPlaybacks7d();

        var lastDirect = directPlaybacks[directPlaybacks.length - 1];

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
                bandwidthSourceLabel() + ' • cumulé depuis le début',
                '#1f9cf0',
                null,
                null,
                liveThroughputText
                    ? '<span class="tp9s-card-live">' +
                        '<span class="tp9s-card-live-dot"></span>' +
                        escapeHTML(liveThroughputText) +
                      '</span>'
                    : ''
            ),

            statCard(
                '🕒',
                'TEMPS DE VISIONNAGE',
                formatDuration(pageStats.totals.watchTimeMsGlobal),
                'mesuré · lecture réelle • cumulé sur tous les streamers',
                '#bf94ff',
                'streamers'
            ),

            // La seule carte qui dise si le script a fait son
            // travail : chaque passage en direct est un moment où
            // les pubs ont pu revenir. Vert tant qu'il n'y en a
            // aucun, ambre dès le premier.
            statCard(
                directPlaybacks.length ? '⚠️' : '🛡️',
                'PASSAGES EN DIRECT (7J)',
                directPlaybacks.length,
                directPlaybacks.length
                    ? 'dernier ' + formatSessionDate(lastDirect.t) +
                        (lastDirect.tried
                            ? ' · ' + lastDirect.tried + ' proxys tentés'
                            : '')
                    : 'aucun · les proxys ont toujours tenu',
                directPlaybacks.length ? '#ffcf7a' : '#00d084'
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
                'PROXYS ACTIFS',
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

        var top = ranking.slice(0, 3);

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
                    '<div class="tp9s-lead-usage">' +
                        (p.score !== null ? 'score ' + p.score : '—') +
                    '</div>' +
                '</div>'
            );

        }).join('');

        content.innerHTML = `

            <div class="tp9s-cards">${primaryCards}</div>

            ${buildMeasurementNoteHTML()}

            <div class="tp9s-panel">
                <div class="tp9s-panel-title-row">
                    <div>
                        <div class="tp9s-panel-title">🏆 Meilleurs proxys (7 jours)</div>
                        <div class="tp9s-panel-sub">Score combinant le taux de réussite et la latence moyenne</div>
                    </div>
                    <button type="button" class="tp9s-panel-link" data-nav="relais">Voir tous les proxys →</button>
                </div>
                <div class="tp9s-lead-list">
                    ${
                        leaderboardRows ||
                        '<div class="tp9s-empty">Lance un test pour voir le classement.</div>'
                    }
                </div>
            </div>

            ${buildWatchTimeChartHTML()}

            <div class="tp9s-cards tp9s-cards-secondary">${secondaryCards}</div>

        `;

        renderWatchTimeChartSVG(content.querySelector('.tp9s-chart-canvas'));

    }

    // Libellé de la provenance des octets comptabilisés, pour ne
    // pas faire passer une estimation pour une mesure (ni l'inverse).
    function bandwidthSourceLabel() {

        if (pageStats.bandwidthSource === 'network') {
            return 'mesuré · réseau';
        }

        if (pageStats.bandwidthSource === 'decoder') {
            return 'mesuré · décodeur';
        }

        return 'estimation';

    }

    function buildMeasurementNoteHTML() {

        var measured =
            pageStats.bandwidthSource &&
            pageStats.bandwidthSource !== 'estimate';

        if (measured) {

            return (
                '<div class="tp9s-note tp9s-note-ok">' +
                    '✅ Ce ne sont pas des estimations : la bande passante compte les ' +
                    '<strong>octets réellement téléchargés</strong> (' +
                    escapeHTML(bandwidthSourceLabel()) + ') et le temps de visionnage suit la ' +
                    '<strong>progression réelle de la lecture</strong>. La bande passante ' +
                    'affichée reste un total cumulé, pas le débit instantané.' +
                '</div>'
            );

        }

        return (
            '<div class="tp9s-note">' +
                'ℹ️ Le temps de visionnage est mesuré sur la progression réelle de la ' +
                'lecture, mais la bande passante n\'a pas pu être mesurée sur ce ' +
                'navigateur : elle est <strong>estimée</strong> d\'après la résolution ' +
                'vidéo. C\'est un <strong>total cumulé</strong>, pas le débit en cours.' +
            '</div>'
        );

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

    // ------------------------------------------------------------
    // MICRO-COURBE DE LATENCE (tableau Proxys)
    // ------------------------------------------------------------
    //
    // proxyHistory garde déjà 7 jours de tests et on n'en sortait
    // qu'une moyenne — or une moyenne noie exactement ce qu'on veut
    // voir : un proxy qui se dégrade lentement avant de tomber en
    // quarantaine. L'échelle est LOCALE à chaque proxy (min/max de sa
    // propre série) : la courbe montre une tendance, pas un niveau,
    // le niveau est déjà donné par le nombre juste à côté.
    //
    // La latence monte vers le HAUT : une courbe qui grimpe = un
    // proxy qui ralentit.

    var SPARK_W = 46;
    var SPARK_H = 15;

    function sparklineSVG(values, color) {

        if (!values || values.length < 2) {
            return '';
        }

        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);

        // Série parfaitement plate : sans ce garde, la division
        // donnerait NaN et le tracé disparaîtrait.
        var span = (max - min) || 1;

        var points = values.map(function (value, index) {

            var x = (SPARK_W * index) / (values.length - 1);

            var y =
                (SPARK_H - 1.5) -
                ((value - min) / span) * (SPARK_H - 3);

            return (
                (Math.round(x * 10) / 10) + ',' +
                (Math.round(y * 10) / 10)
            );

        }).join(' ');

        return (
            '<span class="tp9s-spark-wrap"' +
                ' data-tp9-tip="Tendance de la latence"' +
                ' data-tp9-tip-sub="' + values.length +
                ' derniers tests réussis · vers le haut = plus lent">' +
                '<svg class="tp9s-spark" width="' + SPARK_W +
                    '" height="' + SPARK_H +
                    '" viewBox="0 0 ' + SPARK_W + ' ' + SPARK_H +
                    '" aria-hidden="true">' +
                    '<polyline points="' + points +
                        '" fill="none" stroke="' + color +
                        '" stroke-width="1.5" stroke-linecap="round"' +
                        ' stroke-linejoin="round"/>' +
                '</svg>' +
            '</span>'
        );

    }

    function initialLetter(text) {

        return escapeHTML((text || '?').charAt(0).toUpperCase());

    }

    // Sépare le nombre de son unité pour pouvoir atténuer la
    // seconde : à luminosité égale, « 3.2 Go » se lit moins vite
    // que « 3.2 » suivi d'un « Go » plus discret. Réservé aux
    // valeurs du type « 420 ms » / « 3.2 Go » — surtout pas aux
    // durées, où « 1h30 » serait coupé n'importe où.
    function withUnit(text) {

        var parts = String(text).match(/^([\d.,]+)\s*(.*)$/);

        if (!parts || !parts[2]) {
            return escapeHTML(String(text));
        }

        return (
            escapeHTML(parts[1]) +
            '<span class="tp9s-unit">' + escapeHTML(parts[2]) + '</span>'
        );

    }

    // Le score n'était qu'un nombre nu : rien ne disait sur quelle
    // échelle il se lit, ni si un grand chiffre est bon. Une pastille
    // colorée par palier répond aux deux d'un coup d'œil.
    function scoreTone(score) {

        if (score === null) return '#777';
        if (score >= 80) return '#00d084';
        if (score >= 55) return '#ffcf7a';

        return '#ff6b6b';

    }

    function scoreLabel(score) {

        if (score >= 80) return 'excellent';
        if (score >= 55) return 'correct';

        return 'faible';

    }

    // « positif = plus lent en vrai » demandait de retenir une
    // convention de signe pour lire une carte. Une phrase entière
    // coûte le même espace et ne se déchiffre pas.
    function describeLatencyGap(gapMs) {

        if (!gapMs) {
            return 'aussi rapide en lecture qu\'aux tests';
        }

        return (
            Math.abs(gapMs) + ' ms plus ' +
            (gapMs > 0 ? 'lent' : 'rapide') +
            ' en lecture qu\'aux tests'
        );

    }

    // ------------------------------------------------------------
    // TRI DES TABLEAUX "RELAIS" / "STREAMERS" (en-têtes cliquables)
    // ------------------------------------------------------------

    // Direction appliquée par défaut au premier clic sur une colonne
    // (avant ça, elle bascule juste asc<->desc sur re-clic) : pour
    // la latence, "petit = bon" donc croissant ; pour tout le reste
    // (réussite, tests, usage, bande passante, temps regardé,
    // messages), "grand = intéressant" donc décroissant.
    var RELAIS_SORT_DEFAULT_DIR = {
        score: 'desc',
        avgLatency: 'asc',
        liveLatency: 'asc',
        successRate: 'desc',
        testCount: 'desc',
        usage: 'desc',
        bandwidth: 'desc'
    };

    var STREAMERS_SORT_DEFAULT_DIR = {
        watchTimeMs: 'desc',
        chatMessages: 'desc',
        bandwidthBytes: 'desc'
    };

    var statsRelaisSortKey = 'score';
    var statsRelaisSortDir = 'desc';

    var statsStreamersSortKey = 'watchTimeMs';
    var statsStreamersSortDir = 'desc';

    var SORT_RANK_MEDALS = ['🥇', '🥈', '🥉'];

    function sortRankHTML(index) {
        return SORT_RANK_MEDALS[index] || ('#' + (index + 1));
    }

    // En-tête de colonne cliquable, avec petite flèche indiquant le
    // sens quand c'est la colonne triée actuellement.
    function sortableHeaderHTML(label, table, key, activeKey, activeDir, tip, tipSub) {

        var isActive = key === activeKey;

        var arrow = isActive
            ? '<span class="tp9s-sort-arrow">' + (activeDir === 'asc' ? '▲' : '▼') + '</span>'
            : '';

        // Une colonne dont le libellé ne suffit pas (Score, et les
        // deux latences qui ne mesurent pas la même chose) peut
        // s'expliquer là où on se pose la question : sur son titre.
        var tipAttrs = tip
            ? ' data-tp9-tip="' + escapeHTML(tip) + '"' +
                (tipSub ? ' data-tp9-tip-sub="' + escapeHTML(tipSub) + '"' : '')
            : '';

        return (
            '<div class="tp9s-td tp9s-sortable' + (isActive ? ' tp9s-sort-active' : '') + '"' +
                ' data-sort-table="' + table + '" data-sort-key="' + key + '"' +
                tipAttrs + '>' +
                escapeHTML(label) + arrow +
            '</div>'
        );

    }

    // Bascule asc/desc si on re-clique la colonne déjà triée, sinon
    // adopte la direction par défaut de la nouvelle colonne.
    function toggleSort(table, key) {

        if (table === 'relais') {

            if (statsRelaisSortKey === key) {
                statsRelaisSortDir = statsRelaisSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                statsRelaisSortKey = key;
                statsRelaisSortDir = RELAIS_SORT_DEFAULT_DIR[key] || 'desc';
            }

        } else if (table === 'streamers') {

            if (statsStreamersSortKey === key) {
                statsStreamersSortDir = statsStreamersSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                statsStreamersSortKey = key;
                statsStreamersSortDir = STREAMERS_SORT_DEFAULT_DIR[key] || 'desc';
            }

        }

    }

    function renderStatsRelais(content) {

        var ranking = getProxyRanking24h();

        // getProxyRanking24h() renvoie déjà les relais triés par
        // latence croissante (utilisé tel quel par le podium de la
        // Vue d'ensemble) : on re-trie une copie selon la colonne
        // actuellement sélectionnée dans CE tableau, sans affecter
        // ce classement partagé. null (jamais testé) reste toujours
        // en fin de liste, quel que soit le sens du tri.
        var key = statsRelaisSortKey;
        var dir = statsRelaisSortDir;

        var sorted = ranking.slice().sort(function (a, b) {

            var av = a[key];
            var bv = b[key];

            if (av === null && bv === null) return 0;
            if (av === null) return 1;
            if (bv === null) return -1;

            return dir === 'asc' ? av - bv : bv - av;

        });

        // ---- cartes ----

        var cutoff7d = Date.now() - STATS_HISTORY_MS;

        var totalTests = 0;
        var totalOk = 0;

        pageConfig.proxies.forEach(function (proxy) {

            (pageStats.proxyHistory[proxy.id] || []).forEach(function (entry) {

                if (entry.t < cutoff7d) {
                    return;
                }

                totalTests++;

                if (entry.ok) {
                    totalOk++;
                }

            });

        });

        var globalRate = totalTests
            ? Math.round((totalOk / totalTests) * 100)
            : null;

        var quarantined = pageConfig.proxies.filter(function (proxy) {
            return proxy.quarantine;
        }).length;

        // Le mieux classé pour lequel on a LES DEUX latences : c'est
        // le seul cas où la comparaison veut dire quelque chose.
        var gapProxy = ranking.filter(function (item) {
            return item.avgLatency !== null && item.liveLatency !== null;
        })[0] || null;

        var gapMs = gapProxy
            ? (gapProxy.liveLatency - gapProxy.avgLatency)
            : null;

        var leader = ranking[0] && ranking[0].score !== null ? ranking[0] : null;

        var proxyCards = [

            statCard(
                '🥇',
                'PROXY EN TÊTE',
                leader ? leader.name : '—',
                leader
                    ? 'score ' + leader.score + ' · ' + leader.avgLatency + ' ms'
                    : 'aucun test récent',
                '#bf94ff'
            ),

            statCard(
                '🎯',
                'RÉUSSITE GLOBALE (7J)',
                globalRate !== null ? globalRate + ' %' : '—',
                totalTests
                    ? totalOk + ' réussis sur ' + totalTests + ' tests'
                    : 'aucun test sur la période',
                globalRate === null || globalRate >= 80
                    ? '#00d084'
                    : (globalRate >= 50 ? '#ffcf7a' : '#ff6b6b')
            ),

            statCard(
                '💤',
                'EN QUARANTAINE',
                quarantined,
                'sur ' + pageConfig.proxies.length + ' proxys configurés',
                quarantined ? '#ffcf7a' : '#00d084'
            ),

            // Deux mesures du même proxy : si elles s'écartent, c'est
            // que les tests ne racontent pas ce que la lecture subit
            // vraiment.
            statCard(
                '⚖️',
                'ÉCART TEST ↔ RÉEL',
                gapMs === null
                    ? '—'
                    : (gapMs > 0 ? '+' : '') + gapMs + ' ms',
                gapProxy
                    ? gapProxy.name + ' : ' + describeLatencyGap(gapMs)
                    : 'il faut les deux mesures sur un même proxy',
                '#4fc3f7'
            )

        ].join('');

        var rows = sorted.map(function (p, index) {

            var rateCls = successRateClass(p.successRate);

            return (
                '<div class="tp9s-table-row tp9s-table-row-relais">' +
                    '<div class="tp9s-td tp9s-td-rank">' + sortRankHTML(index) + '</div>' +
                    '<div class="tp9s-td tp9s-td-name-flex">' +
                        '<div class="tp9s-avatar" style="--accent:' + p.accent + '"' +
                            p.tip + '>' +
                            p.icon +
                        '</div>' +
                        '<span>' + escapeHTML(p.name) + '</span>' +
                        (
                            p.quarantined
                                ? '<span class="tp9s-quarantine-badge"' +
                                    ' data-tp9-tip="Proxy en quarantaine"' +
                                    ' data-tp9-tip-sub="Aucune réponse depuis des jours : écarté de' +
                                    ' la course, mais re-testé automatiquement toutes les heures.">💤</span>'
                                : ''
                        ) +
                    '</div>' +
                    '<div class="tp9s-td tp9s-td-score">' +
                        (
                            p.score !== null
                                ? '<span class="tp9s-score-badge" style="--tone:' +
                                    scoreTone(p.score) + '"' +
                                    ' data-tp9-tip="Score ' + p.score + ' / 100 · ' +
                                    scoreLabel(p.score) + '"' +
                                    ' data-tp9-tip-sub="' + p.successRate +
                                    ' % de réussite et ' + p.avgLatency +
                                    ' ms de latence moyenne. Le score part du taux de' +
                                    ' réussite et le rabote à mesure que la latence' +
                                    ' dépasse 300 ms.">' +
                                    p.score +
                                  '</span>'
                                : '<span class="tp9s-td-dim">—</span>'
                        ) +
                    '</div>' +
                    '<div class="tp9s-td tp9s-td-latency" style="color:' + latencyColor(p.avgLatency) + ';">' +
                        '<span>' +
                            (p.avgLatency !== null ? withUnit(p.avgLatency + ' ms') : '—') +
                        '</span>' +
                        sparklineSVG(p.latencySeries, latencyColor(p.avgLatency)) +
                    '</div>' +
                    '<div class="tp9s-td tp9s-td-live" style="color:' + latencyColor(p.liveLatency) + ';">' +
                        (p.liveLatency !== null ? withUnit(p.liveLatency + ' ms') : '—') +
                    '</div>' +
                    '<div class="tp9s-td tp9s-td-flex">' +
                        (
                            p.successRate !== null
                                ? '<span class="tp9s-progress ' + rateCls + '">' +
                                    '<span class="tp9s-progress-fill" style="width:' + p.successRate + '%"></span>' +
                                  '</span>' + p.successRate +
                                  '<span class="tp9s-unit">%</span>'
                                : '<span class="tp9s-td-dim">—</span>'
                        ) +
                    '</div>' +

                    // Colonnes d'appoint : atténuées, pour que l'œil
                    // tombe sur le nom et le score plutôt que sur
                    // huit nombres de même valeur visuelle.
                    '<div class="tp9s-td tp9s-td-dim">' + p.testCount + '</div>' +
                    '<div class="tp9s-td tp9s-td-dim">' + p.usage + '</div>' +
                    '<div class="tp9s-td tp9s-td-dim">' +
                        withUnit(formatBytes(p.bandwidth)) +
                    '</div>' +
                '</div>'
            );

        }).join('');

        content.innerHTML = `

            <div class="tp9s-cards">${proxyCards}</div>

            <div class="tp9s-panel">
                <div class="tp9s-panel-title">📡 Classement des proxys</div>
                <div class="tp9s-panel-sub">
                    Score = réussite pondérée par la latence, sur les 7 derniers jours ·
                    « latence test » = mesurée par les tests automatiques, « latence réelle » =
                    subie pendant la lecture · clique un en-tête pour trier
                </div>

                <div class="tp9s-table">
                    <div class="tp9s-table-row tp9s-table-row-relais tp9s-table-head">
                        <div class="tp9s-td"></div>
                        <div class="tp9s-td tp9s-td-name">Proxy</div>
                        ${sortableHeaderHTML('Score', 'relais', 'score', key, dir,
                            'Score sur 100 · plus il est haut, mieux c\'est',
                            'Part du taux de réussite sur 7 jours, puis le rabote à mesure que la latence moyenne dépasse 300 ms. Un relais rapide mais absent une fois sur trois ne vaut pas mieux qu\'un relais un peu plus lent mais toujours là.')}
                        ${sortableHeaderHTML('Latence test', 'relais', 'avgLatency', key, dir,
                            'Latence des tests provoqués',
                            'Moyenne des tests que le script lance lui-même (bouton Tester, re-test automatique) sur les 7 derniers jours.')}
                        ${sortableHeaderHTML('Latence réelle', 'relais', 'liveLatency', key, dir,
                            'Latence subie pendant la lecture',
                            'Temps réellement mis par ce relais pour rendre un manifest valide quand il a gagné la course, pendant que tu regardais.')}
                        ${sortableHeaderHTML('Réussite', 'relais', 'successRate', key, dir)}
                        ${sortableHeaderHTML('Tests 7j', 'relais', 'testCount', key, dir)}
                        ${sortableHeaderHTML('Utilisations', 'relais', 'usage', key, dir)}
                        ${sortableHeaderHTML('Bande passante (total)', 'relais', 'bandwidth', key, dir)}
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

        var key = statsStreamersSortKey;
        var dir = statsStreamersSortDir;

        channels.sort(function (a, b) {

            var av = pageStats.streamers[a][key] || 0;
            var bv = pageStats.streamers[b][key] || 0;

            return dir === 'asc' ? av - bv : bv - av;

        });

        var maxBandwidth = channels.reduce(function (max, channel) {
            return Math.max(max, pageStats.streamers[channel].bandwidthBytes);
        }, 0);

        // ---- cartes ----

        var weekCutoff = Date.now() - STATS_HISTORY_MS;

        var seenThisWeek = channels.filter(function (channel) {
            return (pageStats.streamers[channel].lastSeen || 0) >= weekCutoff;
        }).length;

        // Seuls ceux réellement regardés : une fiche à 0 minute
        // tirerait la moyenne vers le bas sans rien vouloir dire.
        var watchedChannels = channels.filter(function (channel) {
            return pageStats.streamers[channel].watchTimeMs > 0;
        });

        var totalWatchMs = watchedChannels.reduce(function (acc, channel) {
            return acc + pageStats.streamers[channel].watchTimeMs;
        }, 0);

        var top3Ms = watchedChannels
            .map(function (channel) {
                return pageStats.streamers[channel].watchTimeMs;
            })
            .sort(function (a, b) {
                return b - a;
            })
            .slice(0, 3)
            .reduce(function (acc, ms) {
                return acc + ms;
            }, 0);

        var concentration = totalWatchMs
            ? Math.round((top3Ms / totalWatchMs) * 100)
            : null;

        // Messages envoyés par heure réellement regardée : la seule
        // façon de comparer deux périodes de durées différentes.
        var chatPerHour = totalWatchMs
            ? Math.round(
                (pageStats.totals.chatMessagesGlobal /
                    (totalWatchMs / 3600000)) * 10
              ) / 10
            : null;

        var streamerCards = [

            statCard(
                '🎥',
                'STREAMERS SUIVIS',
                channels.length,
                seenThisWeek + ' vu(s) ces 7 derniers jours',
                '#9147ff'
            ),

            statCard(
                '🕒',
                'TEMPS MOYEN PAR STREAMER',
                watchedChannels.length
                    ? formatDuration(Math.round(totalWatchMs / watchedChannels.length))
                    : '—',
                watchedChannels.length
                    ? 'sur ' + watchedChannels.length + ' streamer(s) regardé(s)'
                    : 'aucun visionnage enregistré',
                '#bf94ff'
            ),

            statCard(
                '🎯',
                'CONCENTRATION',
                concentration !== null ? concentration + ' %' : '—',
                concentration !== null
                    ? 'de ton temps sur tes 3 streamers préférés'
                    : 'aucun visionnage enregistré',
                '#ff9d4d'
            ),

            statCard(
                '💬',
                'BAVARDAGE',
                chatPerHour !== null ? chatPerHour : '—',
                chatPerHour !== null
                    ? 'messages envoyés par heure regardée'
                    : 'aucun visionnage enregistré',
                '#ff8fd6'
            )

        ].join('');

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

            var live = isStreamerLive(channel);

            return (
                '<div class="tp9s-table-row tp9s-table-row-streamers' +
                    (live ? ' tp9s-row-live' : '') +
                    '" data-channel="' + escapeHTML(channel) + '">' +
                    '<div class="tp9s-td tp9s-td-rank">' + sortRankHTML(index) + '</div>' +
                    '<div class="tp9s-td tp9s-td-name-flex">' +
                        avatarHTML +
                        '<span>' + escapeHTML(displayName) + '</span>' +
                        // Le point vert bat au rythme du tick de
                        // visionnage : il dit que la mesure tourne,
                        // pas seulement que la chaîne est en ligne.
                        '<span class="tp9s-live-dot"' +
                            ' data-tp9-tip="En cours de lecture"' +
                            ' data-tp9-tip-sub="Le temps regardé et la bande passante de cette ligne sont affichés à la seconde et au Ko près tant que la lecture dure."' +
                            '></span>' +
                    '</div>' +
                    // La colonne qui porte le classement par défaut :
                    // c'est elle qu'on vient lire, elle ne doit pas
                    // avoir le même poids que le reste de la ligne.
                    '<div class="tp9s-td tp9s-td-strong" data-tp9-live-watch>' +
                        escapeHTML(
                            live
                                ? formatDurationPrecise(s.watchTimeMs)
                                : formatDuration(s.watchTimeMs)
                        ) +
                    '</div>' +
                    '<div class="tp9s-td">' +
                        (
                            s.chatMessages > 0
                                ? '<button type="button" class="tp9s-msg-count" data-channel="' +
                                    escapeHTML(channel) + '">' + s.chatMessages + '</button>'
                                : '<span class="tp9s-td-dim">' + s.chatMessages + '</span>'
                        ) +
                    '</div>' +
                    '<div class="tp9s-td tp9s-td-flex tp9s-td-dim">' +
                        '<span class="tp9s-progress">' +
                            '<span class="tp9s-progress-fill" style="width:' + bwPercent + '%;background:' + avatarColor + '"></span>' +
                        '</span>' +
                        '<span data-tp9-live-bw>' +
                            withUnit(
                                live
                                    ? formatBytesPrecise(s.bandwidthBytes)
                                    : formatBytes(s.bandwidthBytes)
                            ) +
                        '</span>' +
                    '</div>' +
                    '<div class="tp9s-td">' +
                        (
                            proxyObj
                                ? '<span class="tp9s-tag" style="--tone:' +
                                    getProxyAccent(proxyObj) + '">' +
                                    getProxyIcon(proxyObj) + ' ' +
                                    escapeHTML(proxyObj.name) +
                                  '</span>'
                                : '<span class="tp9s-td-dim">—</span>'
                        ) +
                    '</div>' +
                    '<div class="tp9s-td">' +
                        '<button type="button" class="tp9s-streamer-delete"' +
                            ' data-channel="' + escapeHTML(channel) + '"' +
                            ' data-tp9-tip="Supprimer cette fiche"' +
                            ' data-tp9-tip-sub="Retire ce streamer et sa part des totaux."' +
                            ' aria-label="Supprimer cette fiche">' +
                            trashIconSVG(13) +
                        '</button>' +
                    '</div>' +
                '</div>'
            );

        }).join('');

        content.innerHTML = `

            <div class="tp9s-cards">${streamerCards}</div>

            <div class="tp9s-panel">
                <div class="tp9s-panel-title-row">
                    <div>
                        <div class="tp9s-panel-title">🎥 Streamers suivis</div>
                        <div class="tp9s-panel-sub">
                            Temps de visionnage, tes messages tchat et bande passante par streamer ·
                            clique un en-tête pour trier, ou sur le nombre de messages pour voir l'historique
                        </div>
                    </div>
                    <button type="button" class="tp9s-panel-link tp9s-streamers-clean">
                        Nettoyer les fiches fantômes
                    </button>
                </div>

                <div class="tp9s-table">
                    <div class="tp9s-table-row tp9s-table-row-streamers tp9s-table-head">
                        <div class="tp9s-td"></div>
                        <div class="tp9s-td tp9s-td-name">Streamer</div>
                        ${sortableHeaderHTML('Temps regardé', 'streamers', 'watchTimeMs', key, dir)}
                        ${sortableHeaderHTML('Tes messages', 'streamers', 'chatMessages', key, dir)}
                        ${sortableHeaderHTML('Bande passante (total)', 'streamers', 'bandwidthBytes', key, dir)}
                        <div class="tp9s-td">Proxy principal</div>
                        <div class="tp9s-td"></div>
                    </div>
                    ${
                        rows ||
                        '<div class="tp9s-empty">Regarde un stream pour commencer à collecter des stats.</div>'
                    }
                </div>
            </div>

        `;

    }

    // Retire une fiche streamer ET sa contribution aux totaux
    // globaux. L'historique journalier et la carte des habitudes ne
    // sont pas décomposables par streamer : ils restent inchangés,
    // et la confirmation le dit clairement.
    function deleteStreamerStats(channel) {

        var streamer = pageStats.streamers[channel];

        if (!streamer) {
            return;
        }

        if (
            !confirm(
                'Supprimer la fiche de ' + getStreamerDisplayName(channel) + ' ?\n\n' +
                'Son temps de visionnage, ses messages et sa bande passante seront ' +
                'retirés des totaux.\n' +
                'Le graphique et la carte des habitudes ne sont pas décomposables ' +
                'par streamer : ils resteront inchangés.'
            )
        ) {
            return;
        }

        subtractStreamerFromTotals(streamer);

        delete pageStats.streamers[channel];

        saveStatsNow();

        logEvent('warn', 'Fiche streamer supprimée : ' + channel);

        renderStatsDashboard();

    }

    function subtractStreamerFromTotals(streamer) {

        pageStats.totals.watchTimeMsGlobal = Math.max(
            0,
            pageStats.totals.watchTimeMsGlobal - (streamer.watchTimeMs || 0)
        );

        pageStats.totals.chatMessagesGlobal = Math.max(
            0,
            pageStats.totals.chatMessagesGlobal - (streamer.chatMessages || 0)
        );

        pageStats.totals.bandwidthBytesGlobal = Math.max(
            0,
            pageStats.totals.bandwidthBytesGlobal - (streamer.bandwidthBytes || 0)
        );

    }

    // Fiches créées par un aperçu automatique (accueil, Parcourir)
    // avant que getActivePlayback() ne filtre ces lectures : de la
    // bande passante, mais aucun visionnage ni message.
    function cleanPhantomStreamers() {

        var phantoms = Object.keys(pageStats.streamers).filter(function (channel) {

            var s = pageStats.streamers[channel];

            return !s.watchTimeMs && !s.chatMessages;

        });

        if (!phantoms.length) {

            alert(
                'Aucune fiche fantôme : tous tes streamers ont du temps de ' +
                'visionnage ou des messages.'
            );

            return;

        }

        var preview = phantoms.slice(0, 15).join(', ') +
            (phantoms.length > 15 ? ', …' : '');

        if (
            !confirm(
                'Supprimer ' + phantoms.length +
                ' fiche(s) sans aucun visionnage ni message ?\n\n' + preview
            )
        ) {
            return;
        }

        phantoms.forEach(function (channel) {

            subtractStreamerFromTotals(pageStats.streamers[channel]);

            delete pageStats.streamers[channel];

        });

        saveStatsNow();

        logEvent(
            'warn',
            phantoms.length + ' fiche(s) streamer fantôme(s) supprimée(s)'
        );

        renderStatsDashboard();

    }

    // ------------------------------------------------------------
    // ONGLET HABITUDES (heatmap 7 x 24)
    // ------------------------------------------------------------

    // Lundi en premier (getDay() renvoie 0 pour dimanche).
    var HEATMAP_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

    // Échelle de la frise horaire des sessions.
    var MINUTES_PER_DAY = 24 * 60;

    // Une couleur par jour : sept barres du même violet ne se
    // distinguaient que par leur longueur, et l'œil devait faire
    // l'aller-retour jusqu'au libellé pour savoir à qui elles
    // appartenaient. Aucun rouge : il veut dire « erreur » partout
    // ailleurs dans le dashboard.
    var WEEKDAY_COLORS = {
        1: '#9147ff',
        2: '#4fc3f7',
        3: '#00d084',
        4: '#ffcf7a',
        5: '#ff9d4d',
        6: '#ff8fd6',
        0: '#2dd4bf'
    };

    function getSessionStats() {

        var counted = (pageStats.sessions || []).filter(function (s) {
            return s && s.ms > 0;
        });

        if (!counted.length) {
            return { count: 0, averageMs: 0, longest: null };
        }

        var totalMs = counted.reduce(function (acc, s) {
            return acc + s.ms;
        }, 0);

        var longest = counted.reduce(function (best, s) {
            return (!best || s.ms > best.ms) ? s : best;
        }, null);

        return {
            count: counted.length,
            averageMs: Math.round(totalMs / counted.length),
            longest: longest,
            recent: counted.slice(-10).reverse()
        };

    }

    // Jours consécutifs avec du visionnage, en remontant depuis
    // aujourd'hui. La journée en cours ne casse pas la série tant
    // qu'elle est vide : on repart alors d'hier. La boucle se termine
    // forcément, dailyWatchTime étant purgé au-delà d'un an.
    function getCurrentWatchStreak() {

        var streak = 0;

        var day = new Date();

        if (!pageStats.dailyWatchTime[dateKeyFor(day)]) {
            day.setDate(day.getDate() - 1);
        }

        while (pageStats.dailyWatchTime[dateKeyFor(day)]) {

            streak++;

            day.setDate(day.getDate() - 1);

        }

        return streak;

    }

    function heatmapLevelClass(ms, max) {

        if (!ms) {
            return '';
        }

        var ratio = ms / max;

        if (ratio > 0.75) return ' tp9s-heat-l4';
        if (ratio > 0.5) return ' tp9s-heat-l3';
        if (ratio > 0.25) return ' tp9s-heat-l2';

        return ' tp9s-heat-l1';

    }

    // Cumul par jour de semaine reconstruit depuis l'historique
    // JOURNALIER (jusqu'à 370 jours conservés) : contrairement à la
    // heatmap, qui ne peut se remplir qu'à partir de maintenant,
    // cette répartition est disponible immédiatement pour qui a déjà
    // de l'historique.
    function getWatchTimeByWeekday() {

        var totals = [0, 0, 0, 0, 0, 0, 0];

        Object.keys(pageStats.dailyWatchTime).forEach(function (key) {

            var parts = key.split('-');

            if (parts.length !== 3) {
                return;
            }

            var date = new Date(
                parseInt(parts[0], 10),
                parseInt(parts[1], 10) - 1,
                parseInt(parts[2], 10)
            );

            if (isNaN(date.getTime())) {
                return;
            }

            totals[date.getDay()] += pageStats.dailyWatchTime[key];

        });

        return totals;

    }

    // Date courte et lisible pour une session ("mar. 18/09 21:30").
    function formatSessionDate(timestamp) {

        try {

            return new Date(timestamp).toLocaleString(
                [],
                {
                    weekday: 'short',
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }
            );

        } catch (e) {

            return '—';

        }

    }

    // "sam. 19/09" — la date SANS l'heure. formatSessionDate, qui
    // colle les deux, faisait passer la colonne sur deux lignes dans
    // le tableau des sessions ; ici l'heure est affichée à part,
    // sous forme de plage début → fin, ce qui dit bien plus que la
    // seule heure de démarrage.
    function formatSessionDay(timestamp) {

        try {

            return new Date(timestamp).toLocaleDateString(
                [],
                { weekday: 'short', day: '2-digit', month: '2-digit' }
            );

        } catch (e) {

            return '—';

        }

    }

    function formatClock(timestamp) {

        var date = new Date(timestamp);

        return pad2(date.getHours()) + ':' + pad2(date.getMinutes());

    }

    function renderStatsHabitudes(content) {

        var sessionStats = getSessionStats();

        var streak = getCurrentWatchStreak();

        var heatmap = pageStats.watchHeatmap || {};

        var max = 0;
        var total = 0;

        var byDay = [0, 0, 0, 0, 0, 0, 0];
        var byHour = [];

        for (var h = 0; h < 24; h++) {
            byHour.push(0);
        }

        Object.keys(heatmap).forEach(function (key) {

            var ms = heatmap[key] || 0;

            var parts = key.split('-');

            var day = parseInt(parts[0], 10);
            var hour = parseInt(parts[1], 10);

            if (isNaN(day) || isNaN(hour)) {
                return;
            }

            total += ms;

            byDay[day] += ms;
            byHour[hour] += ms;

            if (ms > max) {
                max = ms;
            }

        });

        var bestDay = null;
        var bestHour = null;

        byDay.forEach(function (ms, day) {

            if (ms > 0 && (bestDay === null || ms > byDay[bestDay])) {
                bestDay = day;
            }

        });

        byHour.forEach(function (ms, hour) {

            if (ms > 0 && (bestHour === null || ms > byHour[bestHour])) {
                bestHour = hour;
            }

        });

        var cards = [

            statCard(
                '📅',
                'JOUR LE PLUS ACTIF',
                bestDay !== null ? DAY_LABELS_FULL[bestDay] : '—',
                bestDay !== null ? formatDuration(byDay[bestDay]) + ' cumulées' : 'aucune donnée',
                '#bf94ff'
            ),

            statCard(
                '⏰',
                'HEURE DE POINTE',
                bestHour !== null ? pad2(bestHour) + 'h — ' + pad2((bestHour + 1) % 24) + 'h' : '—',
                bestHour !== null ? formatDuration(byHour[bestHour]) + ' cumulées' : 'aucune donnée',
                '#ff9d4d'
            ),

            statCard(
                '📆',
                'TOTAL CARTOGRAPHIÉ',
                formatDuration(total),
                'depuis la mise en place du suivi horaire',
                '#00d084'
            ),

            statCard(
                '🕒',
                'SESSION MOYENNE',
                sessionStats.count ? formatDuration(sessionStats.averageMs) : '—',
                sessionStats.count
                    ? sessionStats.count + ' session(s) enregistrée(s)'
                    : 'aucune session enregistrée',
                '#4fc3f7'
            ),

            statCard(
                '🏆',
                'PLUS LONGUE SESSION',
                sessionStats.longest
                    ? formatDuration(sessionStats.longest.ms)
                    : '—',
                sessionStats.longest
                    ? 'le ' + formatSessionDate(sessionStats.longest.start)
                    : 'aucune donnée',
                '#ff8fd6'
            ),

            statCard(
                '🔥',
                'SÉRIE EN COURS',
                streak ? streak + ' jour(s)' : '—',
                streak
                    ? 'jours consécutifs avec du visionnage'
                    : 'aucune série en cours',
                '#ffcf7a'
            )

        ].join('');

        // ---- grille heatmap ----

        var headerCells = '<div></div>';

        for (var hour = 0; hour < 24; hour++) {

            headerCells +=
                '<div class="tp9s-heat-hour">' +
                    (hour % 3 === 0 ? pad2(hour) + 'h' : '') +
                '</div>';

        }

        headerCells += '<div></div>';

        var safeMax = max || 1;

        var rows = HEATMAP_DAY_ORDER.map(function (day) {

            var cells =
                '<div class="tp9s-heat-day">' +
                    escapeHTML(DAY_LABELS_FULL[day]) +
                '</div>';

            for (var hour = 0; hour < 24; hour++) {

                var ms = heatmap[day + '-' + hour] || 0;

                // Deux lignes plutôt qu'un tiret cadratin : on
                // maîtrise le rendu de la bulle, autant s'en servir.
                var tipTitle =
                    DAY_LABELS_FULL[day] + ' · ' + pad2(hour) + 'h — ' +
                    pad2((hour + 1) % 24) + 'h';

                var tipSub = ms
                    ? formatDuration(ms) + ' de visionnage'
                    : 'aucun visionnage';

                cells +=
                    '<div class="tp9s-heat-cell' + heatmapLevelClass(ms, safeMax) +
                        '" data-tp9-tip="' + escapeHTML(tipTitle) + '"' +
                        ' data-tp9-tip-sub="' + escapeHTML(tipSub) + '"></div>';

            }

            cells +=
                '<div class="tp9s-heat-total">' +
                    (byDay[day] ? escapeHTML(formatDuration(byDay[day])) : '—') +
                '</div>';

            return cells;

        }).join('');

        var legend =
            '<div class="tp9s-heat-legend">' +
                '<span>Moins</span>' +
                '<span class="tp9s-heat-cell"></span>' +
                '<span class="tp9s-heat-cell tp9s-heat-l1"></span>' +
                '<span class="tp9s-heat-cell tp9s-heat-l2"></span>' +
                '<span class="tp9s-heat-cell tp9s-heat-l3"></span>' +
                '<span class="tp9s-heat-cell tp9s-heat-l4"></span>' +
                '<span>Plus</span>' +
            '</div>';

        // ---- répartition par jour de semaine (historique complet) ----

        // La barre ne compare plus chaque session à la plus longue :
        // cette référence était inutilisable (la première ligne ÉTAIT
        // la plus longue, donc toujours pleine), et des barres de
        // longueurs décroissantes sur des lignes chronologiques se
        // lisaient comme un classement qui n'en était pas un.
        //
        // Elle est devenue une frise : la POSITION donne l'heure de
        // début sur la journée, la LONGUEUR la durée. On lit donc
        // d'un coup d'œil « je regarde le soir » — ce qui est très
        // exactement le sujet de cet onglet.
        var sessionRows = (sessionStats.recent || []).map(function (s) {

            var startDate = new Date(s.start);

            var startMin =
                startDate.getHours() * 60 + startDate.getMinutes();

            // L'étendue réelle (début → fin), et non s.ms : c'est
            // elle que la plage horaire affichée à côté annonce. Les
            // deux diffèrent quand la lecture a été mise en pause au
            // milieu du bloc.
            var spanMin = Math.max(1, Math.round((s.end - s.start) / 60000));

            // Une session qui passe minuit donnerait une largeur
            // négative : on la coupe à la fin de la journée.
            var visibleMin = Math.min(spanMin, MINUTES_PER_DAY - startMin);

            var leftPct = (startMin / MINUTES_PER_DAY) * 100;

            // Plancher de largeur : sans lui, une session d'une
            // minute ne dessinerait rien du tout.
            var widthPct = Math.max(
                0.7,
                (visibleMin / MINUTES_PER_DAY) * 100
            );

            // Même code couleur que la répartition par jour de la
            // semaine juste en dessous : d'un panneau à l'autre, un
            // mardi reste bleu. La pastille, elle, a disparu — la
            // date était écrite juste à côté, la couleur travaille
            // mieux dans le segment lui-même.
            var color = WEEKDAY_COLORS[startDate.getDay()];

            return (
                '<div class="tp9s-bar-row tp9s-session-row">' +
                    '<div class="tp9s-bar-label">' +
                        escapeHTML(formatSessionDay(s.start)) +
                    '</div>' +
                    '<div class="tp9s-bar-range">' +
                        escapeHTML(formatClock(s.start)) + ' → ' +
                        escapeHTML(formatClock(s.end)) +
                    '</div>' +
                    '<div class="tp9s-time-track">' +
                        '<div class="tp9s-time-seg"' +
                            ' style="left:' + leftPct +
                            '%;width:' + widthPct +
                            '%;--bar:' + color + '"' +
                            ' data-tp9-tip="' +
                            escapeHTML(
                                formatSessionDay(s.start) + ' · ' +
                                formatClock(s.start) + ' → ' +
                                formatClock(s.end)
                            ) + '"' +
                            ' data-tp9-tip-sub="' +
                            escapeHTML(
                                formatDuration(s.ms) + ' de visionnage'
                            ) + '"></div>' +
                    '</div>' +
                    '<div class="tp9s-bar-value" style="color:' + color + '">' +
                        escapeHTML(formatDuration(s.ms)) +
                    '</div>' +
                '</div>'
            );

        }).join('');

        var weekdayTotals = getWatchTimeByWeekday();

        var weekdayMax = weekdayTotals.reduce(function (acc, ms) {
            return Math.max(acc, ms);
        }, 0);

        var weekdayTotal = weekdayTotals.reduce(function (acc, ms) {
            return acc + ms;
        }, 0);

        // Sept jours dans un ordre naturel : c'est le cas d'école de
        // l'histogramme en colonnes, qui se lit comme UNE SEMAINE
        // d'un seul regard. En lignes, chaque jour occupait une
        // bande de quatre colonnes qu'il fallait parcourir une par
        // une — et l'empilement mangeait toute la hauteur du
        // panneau.
        //
        // Le pourcentage part dans l'infobulle : en vertical, la
        // comparaison des hauteurs le donne déjà à l'œil, l'afficher
        // en plus ne ferait que charger.
        var weekdayRows = HEATMAP_DAY_ORDER.map(function (day) {

            var ms = weekdayTotals[day];

            var percent = weekdayMax ? (ms / weekdayMax) * 100 : 0;

            var share = weekdayTotal
                ? Math.round((ms / weekdayTotal) * 100)
                : 0;

            var color = WEEKDAY_COLORS[day];

            return (
                '<div class="tp9s-week-col' +
                        (ms ? '' : ' tp9s-week-empty') +
                        (ms && ms === weekdayMax ? ' tp9s-week-top' : '') +
                        '"' +
                    ' data-tp9-tip="' + escapeHTML(DAY_LABELS_FULL[day]) + '"' +
                    ' data-tp9-tip-sub="' +
                    escapeHTML(
                        ms
                            ? formatDuration(ms) + ' cumulées · ' + share +
                                ' % de ton temps de visionnage'
                            : 'aucun visionnage enregistré ce jour-là'
                    ) + '">' +
                    '<div class="tp9s-week-value" style="color:' + color + '">' +
                        escapeHTML(formatDuration(ms)) +
                    '</div>' +
                    '<div class="tp9s-week-bar-wrap">' +
                        '<div class="tp9s-week-bar" style="height:' + percent +
                            '%;--bar:' + color + '"></div>' +
                    '</div>' +
                    '<div class="tp9s-week-day">' +
                        escapeHTML(DAY_LABELS_SHORT[day]) +
                    '</div>' +
                '</div>'
            );

        }).join('');

        content.innerHTML = `

            <div class="tp9s-cards">${cards}</div>

            <div class="tp9s-panel">
                <div class="tp9s-panel-title">🔥 Carte de tes sessions</div>
                <div class="tp9s-panel-sub">
                    Chaque case = une heure de la semaine, plus elle est violette plus tu
                    regardes à ce moment-là · survole une case pour le détail
                </div>

                ${
                    total
                        ? '<div class="tp9s-heat-grid">' + headerCells + rows + '</div>' + legend
                        : '<div class="tp9s-empty">' +
                              'Cette carte se construit au fil de tes sessions : reviens dans quelques jours.' +
                          '</div>'
                }
            </div>

            <div class="tp9s-panel">
                <div class="tp9s-panel-title">🕒 Dernières sessions</div>
                <div class="tp9s-panel-sub">
                    Tes 10 derniers blocs de visionnage continu, placés sur la journée :
                    la position de la barre donne l'heure, sa longueur la durée
                </div>

                ${
                    sessionRows
                        ? '<div class="tp9s-bar-row tp9s-session-row tp9s-time-head">' +
                              '<div></div><div></div>' +
                              '<div class="tp9s-time-axis">' +
                                  '<span>0h</span><span>6h</span><span>12h</span>' +
                                  '<span>18h</span><span>24h</span>' +
                              '</div>' +
                              '<div></div>' +
                          '</div>' + sessionRows
                        : '<div class="tp9s-empty">Aucune session enregistrée pour le moment.</div>'
                }
            </div>

            <div class="tp9s-panel">
                <div class="tp9s-panel-title">📅 Répartition par jour de la semaine</div>
                <div class="tp9s-panel-sub">
                    ${escapeHTML(formatDuration(weekdayTotal))} au total sur tout
                    l'historique conservé (jusqu'à un an) · survole une colonne pour
                    le détail et sa part du total
                </div>

                ${
                    weekdayMax
                        ? '<div class="tp9s-week-chart">' + weekdayRows + '</div>'
                        : '<div class="tp9s-empty">Aucun historique de visionnage pour le moment.</div>'
                }
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

                    <div class="tp9-chat-modal-who">
                        <div class="tp9-chat-modal-avatar"></div>
                        <div class="tp9-chat-modal-ident">
                            <div class="tp9-chat-modal-title"></div>
                            <div class="tp9-chat-modal-sub"></div>
                        </div>
                    </div>

                    <button type="button" class="tp9-chat-modal-close">×</button>

                </div>

                <div class="tp9-chat-modal-list"></div>

            </div>

        `;

        document.body.appendChild(chatHistoryModal);

        attachSpotlight(chatHistoryModal);

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

    // Libellé de séparation entre deux journées de messages.
    function formatChatDay(date) {

        var key = dateKeyFor(date);

        var today = new Date();

        if (key === dateKeyFor(today)) {
            return "Aujourd'hui";
        }

        today.setDate(today.getDate() - 1);

        if (key === dateKeyFor(today)) {
            return 'Hier';
        }

        try {

            return date.toLocaleDateString(
                [],
                { weekday: 'long', day: 'numeric', month: 'long' }
            );

        } catch (e) {

            return key;

        }

    }

    function showChatHistoryModal(channel) {

        var modal = ensureChatHistoryModal();

        var streamer = pageStats.streamers[channel];

        var messages = (streamer && streamer.messages) || [];

        var displayName = getStreamerDisplayName(channel);

        var avatarUrl = getStreamerAvatarUrl(channel);

        modal.querySelector('.tp9-chat-modal-avatar').innerHTML =
            avatarUrl
                ? '<img src="' + escapeHTML(avatarUrl) + '" alt="">'
                : initialLetter(displayName);

        modal.querySelector('.tp9-chat-modal-title').textContent = displayName;

        modal.querySelector('.tp9-chat-modal-sub').textContent =
            messages.length + ' message' + (messages.length > 1 ? 's' : '') +
            ' envoyé' + (messages.length > 1 ? 's' : '');

        // Les messages sont regroupés par journée : sans ça, la date
        // était répétée sur chaque ligne alors qu'une conversation
        // tient souvent sur quelques minutes.
        var lastDayKey = null;

        var rows = messages
            .map(function (entry) {

                var date = new Date(entry.t);

                var dayKey = dateKeyFor(date);

                var separator = '';

                if (dayKey !== lastDayKey) {

                    lastDayKey = dayKey;

                    separator =
                        '<div class="tp9-chat-day">' +
                            '<span>' + escapeHTML(formatChatDay(date)) + '</span>' +
                        '</div>';

                }

                return (
                    separator +
                    '<div class="tp9-chat-row">' +
                        '<span class="tp9-chat-time">' +
                            pad2(date.getHours()) + ':' + pad2(date.getMinutes()) +
                        '</span>' +
                        '<span class="tp9-chat-bubble">' +
                            escapeHTML(entry.text) +
                        '</span>' +
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

    // ------------------------------------------------------------
    // ONGLET SAUVEGARDE
    // ------------------------------------------------------------

    function renderStatsBackup(content) {

        var supported = supportsFileBackup();

        // backupHandleCached fait foi dès qu'il est chargé ; l'état
        // persistant sert de repli le temps que IndexedDB réponde.
        var configured =
            !!backupHandleCached ||
            (!!backupState.fileName && backupState.lastBackupMode === 'file');

        var statusIcon;
        var statusTitle;
        var statusText;
        var statusHint = '';
        var accent;

        // Une phrase pour l'état, une ligne d'astuce pour la marche
        // à suivre : un pavé de texte dans une interface, personne
        // ne le lit.
        if (!supported) {

            statusIcon = '📥';
            statusTitle = 'Sauvegarde manuelle';
            accent = '#ffcf7a';
            statusText =
                'Ton navigateur ne laisse pas un script écrire dans un fichier : ' +
                'chaque sauvegarde part dans ton dossier Téléchargements.';
            statusHint =
                'Pour choisir où l\'enregistrer et remplacer l\'ancienne, active ' +
                '« Toujours demander où enregistrer les fichiers » dans ton navigateur.';

        } else if (backupNeedsPermission) {

            statusIcon = '🔐';
            statusTitle = 'Autorisation à renouveler';
            accent = '#ff6b6b';
            statusText =
                'Le navigateur a oublié l\'autorisation d\'écrire dans ton fichier.';
            statusHint =
                'Un clic sur « Sauvegarder maintenant » suffit à la redonner.';

        } else if (configured) {

            statusIcon = '✅';
            statusTitle = 'Sauvegarde automatique active';
            accent = '#00d084';
            statusText =
                'Réécrite dans ' + backupState.fileName + ' toutes les 15 minutes, ' +
                'tant qu\'un onglet Twitch est ouvert.';

        } else {

            statusIcon = '⚠️';
            statusTitle = 'Aucune sauvegarde configurée';
            accent = '#ffcf7a';
            statusText =
                'Tes statistiques n\'existent que dans le stockage local de twitch.tv.';
            statusHint =
                'Choisis un fichier une fois : le script y réécrira tout seul ensuite.';

        }

        content.innerHTML = `

            <div class="tp9s-panel">

                <div class="tp9s-backup-status" style="--accent:${accent}">
                    <div class="tp9s-backup-icon">${statusIcon}</div>
                    <div>
                        <div class="tp9s-panel-title">${escapeHTML(statusTitle)}</div>
                        <div class="tp9s-backup-desc">${escapeHTML(statusText)}</div>
                        ${
                            statusHint
                                ? '<div class="tp9s-backup-hint">💡 ' +
                                    escapeHTML(statusHint) + '</div>'
                                : ''
                        }
                    </div>
                </div>

                <div class="tp9s-backup-meta">
                    <div>
                        <span class="tp9s-backup-meta-label">Dernière sauvegarde</span>
                        <span class="tp9s-backup-meta-value">
                            ${escapeHTML(formatBackupDate(backupState.lastBackupAt))}
                        </span>
                    </div>
                    <div>
                        <span class="tp9s-backup-meta-label">Fichier</span>
                        <span class="tp9s-backup-meta-value">
                            ${escapeHTML(backupState.fileName || '—')}
                        </span>
                    </div>
                </div>

                <div class="tp9s-backup-actions">

                    ${
                        supported
                            ? '<button type="button" class="tp9s-backup-btn tp9s-backup-primary" data-backup="choose">' +
                                (configured ? '💾 Sauvegarder maintenant' : '💾 Choisir le fichier de sauvegarde') +
                              '</button>'
                            : ''
                    }

                    <button type="button" class="tp9s-backup-btn" data-backup="download">
                        📤 Exporter un fichier
                    </button>

                    <button type="button" class="tp9s-backup-btn" data-backup="restore">
                        📥 Restaurer une sauvegarde
                    </button>

                    ${
                        configured
                            ? '<button type="button" class="tp9s-backup-btn" data-backup="forget">' +
                                '🔄 Changer de fichier' +
                              '</button>'
                            : ''
                    }

                </div>

                <input type="file" class="tp9s-backup-file" accept="application/json" style="display:none;">

            </div>

            <div class="tp9s-note">
                ℹ️ La restauration <strong>fusionne</strong> avec tes stats actuelles en
                gardant la valeur la plus complète : rien n'est jamais compté en double.
            </div>

        `;

        var fileInput = content.querySelector('.tp9s-backup-file');

        fileInput.addEventListener('change', function (event) {

            var file = event.target.files && event.target.files[0];

            if (file) {
                importStatsBackupFromFile(file);
            }

            event.target.value = '';

        });

        content.querySelectorAll('[data-backup]').forEach(function (button) {

            button.addEventListener('click', function () {

                var action = button.getAttribute('data-backup');

                if (action === 'choose') {

                    if (configured) {

                        writeStatsBackup(false);

                    } else {

                        chooseStatsBackupFile();

                    }

                } else if (action === 'download') {

                    downloadStatsBackup();

                } else if (action === 'restore') {

                    fileInput.click();

                } else if (action === 'forget') {

                    chooseStatsBackupFile();

                }

            });

        });

    }

    var LOG_LEVEL_META = {
        info: { icon: 'ℹ️', cls: 'tp9s-log-info' },
        success: { icon: '✅', cls: 'tp9s-log-success' },
        warn: { icon: '⚠️', cls: 'tp9s-log-warn' },
        error: { icon: '⛔', cls: 'tp9s-log-error' }
    };

    // 300 entrées sans filtre, c'est un mur : on trie par niveau et
    // par texte. Les deux filtres se combinent, et les compteurs des
    // boutons de niveau tiennent compte de la recherche en cours —
    // sinon ils annonceraient des résultats que le filtre texte
    // écarte.

    var LOG_FILTER_LEVELS = [
        { id: 'all', label: 'Tous' },
        { id: 'info', label: 'ℹ️' },
        { id: 'success', label: '✅' },
        { id: 'warn', label: '⚠️' },
        { id: 'error', label: '⛔' }
    ];

    var statsLogLevel = 'all';
    var statsLogQuery = '';

    function getQueryFilteredLogs() {

        var query = statsLogQuery.trim().toLowerCase();

        if (!query) {
            return pageStats.logs;
        }

        return pageStats.logs.filter(function (entry) {
            return String(entry.msg).toLowerCase().indexOf(query) !== -1;
        });

    }

    function getFilteredLogs() {

        if (statsLogLevel === 'all') {
            return getQueryFilteredLogs();
        }

        return getQueryFilteredLogs().filter(function (entry) {
            return (entry.level || 'info') === statsLogLevel;
        });

    }

    function countLogsForLevel(levelId) {

        var entries = getQueryFilteredLogs();

        if (levelId === 'all') {
            return entries.length;
        }

        return entries.filter(function (entry) {
            return (entry.level || 'info') === levelId;
        }).length;

    }

    function logCountLabel(shown) {

        if (shown === pageStats.logs.length) {
            return pageStats.logs.length + ' événement(s) enregistré(s)';
        }

        return (
            shown + ' événement(s) affiché(s) sur ' +
            pageStats.logs.length
        );

    }

    function buildLogRowsHTML(entries) {

        return entries.map(function (entry) {

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

    }

    // Change juste la liste et les compteurs, sans toucher au champ
    // de recherche : le reconstruire en pleine frappe ferait perdre
    // le curseur à chaque lettre.
    function refreshLogList() {

        if (!statsDashboard) {
            return;
        }

        var content = statsDashboard.querySelector('.tp9s-content');

        var list = content.querySelector('.tp9s-logs');

        if (!list) {
            return;
        }

        var entries = getFilteredLogs();

        list.innerHTML =
            buildLogRowsHTML(entries) ||
            '<div class="tp9s-empty">Aucun événement ne correspond.</div>';

        var countEl = content.querySelector('.tp9s-log-count');

        if (countEl) {
            countEl.textContent = logCountLabel(entries.length);
        }

        content.querySelectorAll('.tp9s-log-level-btn').forEach(
            function (button) {

                var id = button.getAttribute('data-log-level');

                button.classList.toggle(
                    'tp9s-chart-range-active',
                    id === statsLogLevel
                );

                var badge = button.querySelector('.tp9s-log-level-count');

                if (badge) {
                    badge.textContent = countLogsForLevel(id);
                }

            }
        );

        // L'affichage ne correspond plus au dernier rendu comparé :
        // sans ça, la prochaine resynchro le croirait déjà à jour et
        // ne rattraperait rien.
        lastRenderedHTML = null;

    }

    function renderStatsLogs(content) {

        var entries = getFilteredLogs();

        var levelButtons = LOG_FILTER_LEVELS.map(function (level) {

            return (
                '<button type="button"' +
                    ' class="tp9s-chart-range-btn tp9s-log-level-btn' +
                    (level.id === statsLogLevel ? ' tp9s-chart-range-active' : '') +
                    '" data-log-level="' + level.id + '">' +
                    level.label +
                    '<span class="tp9s-log-level-count">' +
                        countLogsForLevel(level.id) +
                    '</span>' +
                '</button>'
            );

        }).join('');

        content.innerHTML = `

            <div class="tp9s-panel">
                <div class="tp9s-panel-title-row">
                    <div>
                        <div class="tp9s-panel-title">📄 Journal des événements</div>
                        <div class="tp9s-panel-sub tp9s-log-count">${escapeHTML(logCountLabel(entries.length))}</div>
                    </div>
                    <button type="button" class="tp9s-clear-logs">${trashIconSVG(13)} Vider les logs</button>
                </div>

                <div class="tp9s-log-filters">
                    <div class="tp9s-chart-range">${levelButtons}</div>
                    <input
                        type="text"
                        class="tp9s-log-search"
                        data-tp9-keep-focus="logs"
                        placeholder="Rechercher dans les messages…"
                        value="${escapeHTML(statsLogQuery)}"
                    >
                </div>

                <div class="tp9s-logs">
                    ${
                        buildLogRowsHTML(entries) ||
                        '<div class="tp9s-empty">' +
                            (pageStats.logs.length
                                ? 'Aucun événement ne correspond.'
                                : 'Aucun événement pour le moment.') +
                        '</div>'
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

        // Même moteur que la resynchro entre onglets : un nouvel
        // événement ne doit pas reconstruire tout le journal sous le
        // curseur.
        updateStatsContentInPlace(
            statsDashboard.querySelector('.tp9s-content')
        );

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
        'store',

        // Ajoutés après coup : toute route absente de cette liste
        // est prise pour un nom de chaîne.
        'team',
        'u',
        'collections',
        'dashboard',
        'following',
        'subs',
        'bits',
        'broadcast',
        'activate',
        'checkout',
        'redeem',

        // Sans elles, un auto-test partait sur la « chaîne » login.
        'login',
        'signup',

        // URL bidon utilisée par openStatsDashboardInNewTab().
        'tp9proxydashboard'
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


    // Teste une liste de relais l'un après l'autre, puis passe la
    // salve complète à la logique de quarantaine (qui a besoin de
    // voir TOUS les résultats d'un coup pour savoir si la salve
    // était concluante).
    // ------------------------------------------------------------
    // AVANCEMENT DE LA SALVE DE TESTS
    // ------------------------------------------------------------
    //
    // Jusqu'ici, le seul retour pendant un test était le « 🟡
    // test... » qui traversait les lignes une à une : impossible de
    // savoir où on en était dans la salve, ni combien il restait.
    // Une barre de 2 px sous l'en-tête le dit sans rien ajouter à
    // l'écran.

    var testProgressTimer = null;

    function getTestProgressBar() {

        return dashboard
            ? dashboard.querySelector('.tp9-test-progress')
            : null;

    }

    function setTestProgress(done, total) {

        var bar = getTestProgressBar();

        if (!bar) {
            return;
        }

        if (testProgressTimer) {

            clearTimeout(testProgressTimer);

            testProgressTimer = null;

        }

        bar.classList.add('tp9-test-progress-on');

        bar.querySelector('.tp9-test-progress-fill').style.width =
            (total ? Math.round((done / total) * 100) : 0) + '%';

    }

    function endTestProgress() {

        var bar = getTestProgressBar();

        if (!bar) {
            return;
        }

        // La barre reste pleine un court instant : disparaître pile
        // au moment où elle atteint 100 % donnerait l'impression
        // qu'elle a été coupée avant la fin.
        testProgressTimer = setTimeout(
            function () {

                testProgressTimer = null;

                bar.classList.remove('tp9-test-progress-on');

                bar.querySelector('.tp9-test-progress-fill').style.width =
                    '0%';

            },
            500
        );

    }


    async function runProxyTestRound(list, channel, updateUI) {

        var roundResults = [];

        if (updateUI) {
            setTestProgress(0, list.length);
        }

        for (var i = 0; i < list.length; i++) {

            var proxy = list[i];

            if (updateUI) {

                updateProxyStatus(
                    proxy.id,
                    '🟡 test...'
                );

            }

            var result = await testProxy(proxy, channel);

            proxy.lastTest = {
                ok: result.ok,
                status: result.ok ? 'OK' : result.status,
                latency: result.latency,
                timestamp: Date.now(),
                channel: channel
            };

            if (proxy.quarantine) {
                proxy.quarantine.lastProbe = Date.now();
            }

            var entry = recordProxyTest(
                proxy.id,
                result.ok,
                result.latency
            );

            roundResults.push({
                proxy: proxy,
                ok: result.ok,
                entry: entry
            });

            if (updateUI) {

                updateProxyStatus(
                    proxy.id,
                    result.ok
                        ? '🟢 OK · ' + result.latency + ' ms'
                        : '🔴 ' + result.status +
                            (result.latency ? ' · ' + result.latency + ' ms' : '')
                );

                setTestProgress(i + 1, list.length);

            }

        }

        if (updateUI) {
            endTestProgress();
        }

        applyQuarantineRules(roundResults);

        saveConfig(pageConfig);

        broadcastConfig();

        return roundResults;

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


        // Test lancé à la main : on teste TOUT ce qui est coché, y
        // compris les relais en quarantaine (c'est justement
        // l'occasion pour eux de s'en sortir).
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

            await runProxyTestRound(enabled, channel, true);

            renderDashboard();

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


        // Un id importé qui contient un guillemet faisait lever une
        // exception au sélecteur.
        var element =
            dashboard.querySelector(
                '[data-status="' +
                (window.CSS && CSS.escape ? CSS.escape(id) : id) +
                '"]'
            );


        if (element) {

            element.textContent =
                text;

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

        lines.push(
            'var __tp_tabId = ' +
            JSON.stringify(TAB_ID) +
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

                                __tp_dvrSyncConfig();

                            }

                            // Le lecteur de retour arrière demande
                            // qu'on suspende l'expiration des
                            // segments tant qu'il est ouvert :
                            // révoquer un blob en cours de lecture
                            // couperait la vidéo.
                            if (
                                event.data &&
                                event.data.type === 'dvrControl' &&
                                event.data.tabId === __tp_tabId
                            ) {

                                __tp_dvrHold =
                                    !!event.data.hold;

                                // Capture coupée : la chaîne a un
                                // VOD, la mémoire ne servirait qu'à
                                // manger de la RAM pour un passé
                                // qu'on a déjà.
                                if (
                                    typeof event.data.capture ===
                                    'boolean'
                                ) {

                                    __tp_dvrCaptureOff =
                                        !event.data.capture;

                                    if (__tp_dvrCaptureOff) {

                                        __tp_dvrClear();

                                        return;

                                    }

                                }

                                // Vidage demandé par la page : on
                                // révoque tout, c'est le seul
                                // endroit d'où ces Blob peuvent
                                // réellement être rendus à la RAM.
                                if (event.data.clear) {

                                    __tp_dvrClear();

                                } else if (!__tp_dvrHold) {

                                    __tp_dvrTrim();

                                }

                            }

                        } catch(e) {}

                    };

                __tp_bc.postMessage({
                    type: 'log',
                    tabId: __tp_tabId,
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


                        // Les relais sont des TIERS : on ne leur
                        // transmet ni les en-têtes, ni les cookies, ni
                        // le referrer de la requête usher de Twitch.
                        // Et on n'écrase plus son éventuel signal
                        // d'annulation : on y ajoute le nôtre.
                        var fetchInit = {
                            credentials: "omit",
                            referrerPolicy: "no-referrer",
                            cache: "no-store",
                            signal: controller.signal
                        };

                        if (init && init.signal) {

                            try {

                                if (AbortSignal.any) {

                                    fetchInit.signal =
                                        AbortSignal.any([
                                            init.signal,
                                            controller.signal
                                        ]);

                                }

                            } catch(e) {}

                        }


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
        // Mesure de la bande passante réelle
        // --------------------------------------------------------
        //
        // Les segments vidéo (.ts / .m4s / ...) passent par ce même
        // fetch que celui qu'on patche pour usher : on relève leur
        // taille réelle au passage, ce qui remplace l'ancienne
        // estimation "bitrate d'après la résolution". On lit
        // d'abord Content-Length (en-tête autorisé en CORS, donc
        // lisible même sur un domaine tiers, et gratuit) ; s'il
        // manque, on mesure sur une COPIE de la réponse pour ne pas
        // consommer le corps attendu par le lecteur.

        lines.push(`

            var __tp_lastChannel = null;
            var __tp_pendingBytes = 0;

            function __tp_isSegmentURL(lowerURL){

                if (lowerURL.indexOf(".m3u8") >= 0) {
                    return false;
                }

                return (
                    // Double antislash VOLONTAIRE : ce code part dans un
                    // template literal, le Worker recevrait sinon un point
                    // libre, qui accepte n'importe quel caractère (toute
                    // URL finissant par "ts", "aac", "mp4"... était comptée
                    // comme un segment vidéo). Même raison que les
                    // \.m3u8 du reste de ce patch.
                    /\\.(ts|m4s|mp4|m4v|m4a|aac|fmp4)([?#]|$)/i.test(lowerURL)
                    ||
                    lowerURL.indexOf("/v1/segment/") >= 0
                );

            }

            function __tp_measureResponse(promise){

                return promise.then(function(response){

                    try {

                        var len =
                            response.headers.get("content-length");

                        if (len) {

                            var parsed = parseInt(len, 10);

                            if (parsed > 0) {

                                __tp_pendingBytes += parsed;

                                return response;

                            }

                        }

                        response
                            .clone()
                            .arrayBuffer()
                            .then(function(buffer){

                                __tp_pendingBytes += buffer.byteLength;

                            })
                            .catch(function(){});

                    } catch(e) {}

                    return response;

                });

            }

            setInterval(
                function(){

                    if (
                        __tp_pendingBytes > 0 &&
                        __tp_lastChannel &&
                        __tp_bc
                    ) {

                        try {

                            __tp_bc.postMessage({
                                type: "bandwidth",
                                tabId: __tp_tabId,
                                channel: __tp_lastChannel,
                                bytes: __tp_pendingBytes
                            });

                        } catch(e) {}

                        __tp_pendingBytes = 0;

                    }

                },
                5000
            );

        `);


        // --------------------------------------------------------
        // Capture des segments pour le retour arrière
        // --------------------------------------------------------
        //
        // Les octets passent déjà par ici pour être comptés : les
        // garder coûte un clone de plus, pas un téléchargement de
        // plus. On stocke des Blob et on ne fait traverser que
        // leur URL — un ArrayBuffer envoyé en BroadcastChannel
        // serait recopié dans TOUS les onglets twitch.tv ouverts,
        // ce qui est hors de question pour de la vidéo.

        lines.push(`

            var __tp_dvrRing = [];
            var __tp_dvrDurations = {};
            var __tp_dvrSpan = 0;
            var __tp_dvrTotal = 0;
            var __tp_dvrBytes = 0;
            var __tp_dvrSeq = 0;

            // Incremente a chaque vidage. Une capture partie AVANT
            // le vidage se resout APRES : sans ce numero de
            // generation, son Blob entrait dans un anneau qu'on
            // venait de purger et n'en sortait plus jamais.
            var __tp_dvrGen = 0;
            var __tp_dvrHold = false;
            var __tp_dvrBlobOk = true;
            var __tp_dvrUnsupported = false;

            // Coupe-circuit posé par la page quand la chaîne a un
            // VOD exploitable : l'armement reste, la capture non.
            var __tp_dvrCaptureOff = false;

            // Le premier playlist qu'on voit contient deja une
            // trentaine de secondes de passe : c'est le dos du
            // direct, que le lecteur telecharge d'un coup pour
            // remplir son propre tampon. Les capturer donnait un
            // buffer deja a 20-30 s a chaque rechargement de page,
            // alors qu'il est cense partir de zero. On note donc
            // ces URL-la une fois pour toutes et on les laisse
            // passer sans les garder.
            var __tp_dvrPrimed = false;
            var __tp_dvrSkip = {};


            function __tp_dvrActive(){

                return (
                    __tp_dvrBlobOk &&
                    !__tp_dvrUnsupported &&
                    !__tp_dvrCaptureOff &&
                    __tp_dvrSpan > 0
                );

            }


            function __tp_dvrChannelOn(channel){

                try {

                    return !!(
                        channel &&
                        __tp_config &&
                        __tp_config.dvrChannels &&
                        __tp_config.dvrChannels[channel]
                    );

                } catch(e) {

                    return false;

                }

            }


            function __tp_dvrSyncConfig(){

                try {

                    var span = 0;

                    if (
                        __tp_config &&
                        __tp_config.dvrBufferSeconds > 0 &&
                        __tp_dvrChannelOn(__tp_lastChannel)
                    ) {

                        span = __tp_config.dvrBufferSeconds;

                    }

                    if (span === __tp_dvrSpan) {
                        return;
                    }

                    __tp_dvrSpan = span;

                    if (!span) {

                        __tp_dvrClear();

                    } else {

                        __tp_dvrTrim();

                    }

                } catch(e) {}

            }


            function __tp_dvrClear(){

                try {

                    for (var i = 0; i < __tp_dvrRing.length; i++) {

                        try {
                            URL.revokeObjectURL(
                                __tp_dvrRing[i].url
                            );
                        } catch(e) {}

                    }

                } catch(e) {}

                __tp_dvrRing = [];
                __tp_dvrDurations = {};
                __tp_dvrTotal = 0;
                __tp_dvrBytes = 0;
                __tp_dvrGen++;
                __tp_dvrPrimed = false;
                __tp_dvrSkip = {};

                if (__tp_bc) {

                    try {

                        __tp_bc.postMessage({
                            type: "dvrDrop",
                            tabId: __tp_tabId,
                            clear: true
                        });

                    } catch(e) {}

                }

            }


            // Renvoie le nombre de segments retirés en tête, que
            // la page applique à sa propre liste pour rester
            // alignée sans qu'on ait à la lui renvoyer entière.
            // Annonce systématiquement ce qu'elle retire : la page
            // tient la même liste, et une seule expiration passée
            // sous silence lui laisse des URL de Blob révoquées.
            function __tp_dvrTrim(){

                // Pendant la lecture du passé on laisse gonfler,
                // mais pas indéfiniment : deux fois la profondeur
                // réglée reste un plafond connu.
                var limit = __tp_dvrHold
                    ? __tp_dvrSpan * 2
                    : __tp_dvrSpan;

                var dropped = 0;

                while (
                    __tp_dvrRing.length > 1 &&
                    __tp_dvrTotal > limit
                ) {

                    var gone = __tp_dvrRing.shift();

                    __tp_dvrTotal -= gone.dur;

                    __tp_dvrBytes -= (gone.size || 0);

                    if (__tp_dvrBytes < 0) {
                        __tp_dvrBytes = 0;
                    }

                    try {
                        URL.revokeObjectURL(gone.url);
                    } catch(e) {}

                    dropped++;

                }

                if (dropped && __tp_bc) {

                    try {

                        __tp_bc.postMessage({
                            type: "dvrDrop",
                            tabId: __tp_tabId,
                            count: dropped,
                            bytes: __tp_dvrBytes
                        });

                    } catch(e) {}

                }

                return dropped;

            }


            // Un segment ne porte pas sa durée : elle est dans le
            // playlist média qui vient de le référencer. On garde
            // la table à taille bornée, sinon elle fuit sur un
            // stream de plusieurs heures.
            function __tp_dvrNotePlaylist(url, text){

                try {

                    // #EXT-X-MAP = flux fMP4 : les segments ne se
                    // suffisent pas a eux-memes, il leur faut un
                    // segment d'initialisation. On refuse plutot
                    // que de reconstruire un flux injouable.
                    if (text.indexOf("#EXT-X-MAP") >= 0) {

                        if (!__tp_dvrUnsupported) {

                            __tp_dvrUnsupported = true;

                            __tp_dvrClear();

                            if (__tp_bc) {

                                try {

                                    __tp_bc.postMessage({
                                        type: "dvrUnsupported",
                                        tabId: __tp_tabId,
                                        channel: __tp_lastChannel
                                    });

                                } catch(e) {}

                            }

                        }

                        return;

                    }

                    var rows = text.split("\\n");
                    var pending = 0;
                    var seen = [];

                    for (var i = 0; i < rows.length; i++) {

                        var row = rows[i].trim();

                        if (!row) {
                            continue;
                        }

                        if (row.indexOf("#EXTINF:") === 0) {

                            pending = parseFloat(
                                row.substring(8)
                            ) || 0;

                            continue;

                        }

                        if (row.charAt(0) === "#") {
                            continue;
                        }

                        if (pending > 0) {

                            var abs = row;

                            try {
                                abs = new URL(row, url).href;
                            } catch(e) {}

                            __tp_dvrDurations[abs] = pending;

                            seen.push(abs);

                        }

                        pending = 0;

                    }

                    // Le dos du direct, une seule fois : tout ce que
                    // les rafraichissements suivants ajouteront est,
                    // lui, bel et bien enregistre depuis qu'on
                    // regarde.
                    //
                    // « seen.length » est capital, et c'est ce qui
                    // manquait : le MASTER playlist (celui rendu par
                    // le proxy, qui ne liste que des variantes)
                    // passe aussi par ici et ne contient AUCUN
                    // EXTINF. Il armait donc « primed » avec une
                    // liste vide, le vrai premier playlist media
                    // n'etait plus skippe du tout, et le buffer
                    // repartait a 20-30 s des le chargement de la
                    // page au lieu de partir de zero.
                    if (!__tp_dvrPrimed && seen.length) {

                        __tp_dvrPrimed = true;

                        for (var b = 0; b < seen.length; b++) {
                            __tp_dvrSkip[seen[b]] = 1;
                        }

                    }

                    var keys = Object.keys(__tp_dvrDurations);

                    if (keys.length > 900) {

                        for (var k = 0; k < keys.length - 600; k++) {
                            delete __tp_dvrDurations[keys[k]];
                        }

                    }

                } catch(e) {}

            }


            function __tp_dvrVariant(url){

                try {

                    var parts =
                        url.split("?")[0].split("/");

                    parts.pop();

                    return parts.pop() || "";

                } catch(e) {

                    return "";

                }

            }


            function __tp_dvrCapture(url, response){

                if (__tp_dvrSkip[url]) {
                    return;
                }

                // Aucun playlist media encore lu : impossible de
                // savoir si ce segment fait partie du dos de direct
                // que le lecteur avale au demarrage. Dans le doute
                // on ne garde rien — le prochain rafraichissement de
                // playlist (2 a 5 s) rouvre la capture.
                if (!__tp_dvrPrimed) {
                    return;
                }

                // Duree inconnue : segment qu'on ne saurait de toute
                // facon pas replacer dans le playlist reconstruit.
                if (!__tp_dvrDurations[url]) {
                    return;
                }

                if (!__tp_dvrActive()) {
                    return;
                }

                // Le numéro est pris MAINTENANT, pas à la
                // résolution du blob : deux segments peuvent se
                // terminer dans le désordre, et un DVR dans le
                // désordre ne vaut rien.
                var seq = ++__tp_dvrSeq;

                var channel = __tp_lastChannel;

                var gen = __tp_dvrGen;

                try {

                    response
                        .clone()
                        .blob()
                        .then(function(blob){

                            // Vidage, changement de chaine ou
                            // desarmement pendant que le segment
                            // arrivait : on le jette. Le garder,
                            // c'etait retenir un Blob que plus
                            // personne n'allait expirer.
                            if (
                                gen !== __tp_dvrGen ||
                                channel !== __tp_lastChannel ||
                                !__tp_dvrActive()
                            ) {
                                return;
                            }

                            var blobUrl = null;

                            try {

                                blobUrl =
                                    URL.createObjectURL(blob);

                            } catch(e) {

                                __tp_dvrBlobOk = false;

                                return;

                            }

                            var dur =
                                __tp_dvrDurations[url] || 2;

                            var item = {
                                url: blobUrl,
                                dur: dur,
                                seq: seq,
                                size: blob.size || 0
                            };

                            var at = __tp_dvrRing.length;

                            while (
                                at > 0 &&
                                __tp_dvrRing[at - 1].seq > seq
                            ) {
                                at--;
                            }

                            __tp_dvrRing.splice(at, 0, item);

                            __tp_dvrTotal += dur;

                            __tp_dvrBytes += item.size;

                            if (__tp_bc) {

                                try {

                                    __tp_bc.postMessage({
                                        type: "dvrSegment",
                                        tabId: __tp_tabId,
                                        channel: channel,
                                        url: blobUrl,
                                        duration: dur,
                                        seq: seq,
                                        bytes: __tp_dvrBytes,
                                        variant: __tp_dvrVariant(url)
                                    });

                                } catch(e) {}

                            }

                            // Après l'annonce du nouveau segment,
                            // jamais avant : la page applique les
                            // deux messages dans l'ordre reçu.
                            __tp_dvrTrim();

                        })
                        .catch(function(){});

                } catch(e) {}

            }


            __tp_dvrSyncConfig();

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

                    var __tp_passthrough =
                        __tp_originalFetch.call(
                            this,
                            input,
                            init
                        );

                    if (__tp_isSegmentURL(lowerURL)) {

                        return __tp_measureResponse(
                            __tp_passthrough
                        ).then(function(response){

                            __tp_dvrCapture(
                                originalURL,
                                response
                            );

                            return response;

                        });

                    }

                    // Le playlist média est la seule source qui
                    // donne la durée de chaque segment ; sans elle
                    // le DVR ne saurait pas reconstruire un m3u8.
                    if (
                        __tp_dvrActive() &&
                        lowerURL.indexOf(".m3u8") >= 0
                    ) {

                        return __tp_passthrough.then(
                            function(response){

                                try {

                                    response
                                        .clone()
                                        .text()
                                        .then(function(text){

                                            __tp_dvrNotePlaylist(
                                                originalURL,
                                                text
                                            );

                                        })
                                        .catch(function(){});

                                } catch(e) {}

                                return response;

                            }
                        );

                    }

                    return __tp_passthrough;

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


                if (
                    __tp_lastChannel &&
                    __tp_lastChannel !== channel
                ) {

                    __tp_dvrClear();

                    __tp_dvrUnsupported = false;

                }

                __tp_lastChannel = channel;

                __tp_dvrSyncConfig();


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
                            return proxy.enabled && !proxy.quarantine;
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
                                                        tabId: __tp_tabId,
                                                        proxyId: proxy.id,
                                                        proxyName: proxy.name,
                                                        channel: channel,
                                                        direct: false,

                                                        // Temps reellement mis par CE proxy pour
                                                        // rendre un manifest valide, pendant la
                                                        // vraie lecture. A ne pas confondre avec
                                                        // la latence des tests : celle-ci est
                                                        // subie, l'autre est provoquee.
                                                        latency: elapsed,

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
                                    tabId: __tp_tabId,
                                    proxyId: null,
                                    proxyName: null,
                                    channel: channel,
                                    direct: true,

                                    // Combien de proxys ont ete mis en
                                    // course avant d'abandonner : sans ca,
                                    // "passage en direct" ne dit pas si
                                    // c'est un proxy isole qui a lache ou
                                    // toute la liste.
                                    tried: enabled.length,

                                    timestamp: Date.now()
                                });

                                __tp_bc.postMessage({
                                    type: "log",
                                    tabId: __tp_tabId,
                                    level: "error",
                                    msg: "Tous les proxys ont échoué pour " + channel
                                });

                            } catch(e) {}

                        }


                        // Repli refusé : on rend une erreur au
                        // lecteur au lieu de laisser Twitch servir
                        // le flux. C'est tout l'intérêt du réglage —
                        // les deux branches appelaient jusqu'ici le
                        // même fetch d'origine, donc le décocher ne
                        // changeait rien et les pubs revenaient
                        // quand même.
                        if (!fallbackEnabled) {

                            console.warn(
                                "[TwitchProxy] Repli désactivé → lecture abandonnée"
                            );

                            return new Response(
                                "",
                                {
                                    status: 502,
                                    statusText:
                                        "TwitchProxy: aucun proxy disponible"
                                }
                            );

                        }


                        console.log(
                            "[TwitchProxy] → Fallback Twitch"
                        );

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

        // Les relais en quarantaine ne participent pas à la salve
        // normale ; ils sont simplement re-sondés une fois par heure
        // pour pouvoir en sortir tout seuls.
        var enabled = pageConfig.proxies.filter(function (p) {

            return (
                p.enabled &&
                (!isQuarantined(p) || isQuarantineProbeDue(p))
            );

        });

        if (!enabled.length) {
            return;
        }

        testInProgress = true;

        try {

            console.log('[TwitchProxy] ===== AUTO-TEST DÉMARRAGE =====');

            await runProxyTestRound(enabled, channel, false);

            autoSortProxies();

            renderDashboard();

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

        if (channel === lastKnownChannel) {
            return;
        }

        lastKnownChannel = channel;

        // Twitch réapplique SON volume au lecteur quelques secondes
        // après la bascule, et le lecteur n'est pas forcément
        // remplacé : le changement de chaîne est alors le seul
        // signal. Voir dvrKeepTwitchVolume.
        dvrArmVolumeGuard();

        // Le passé d'une autre chaîne n'a plus rien à faire à
        // l'écran, et son buffer encore moins en mémoire. Partir
        // vers une page sans lecteur compte tout autant : c'est
        // justement là que la RAM restait prise pour rien.
        closeDvr();

        dvrForgetMemory();

        if (!channel) {

            console.log('[TwitchProxy] Chaîne quittée, mémoire libérée');

            return;

        }

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


    // ------------------------------------------------------------
    // RACCOURCI CLAVIER
    // ------------------------------------------------------------
    //
    // Alt + P ouvre/ferme le menu. Alt volontairement : Twitch
    // réserve les lettres seules à son lecteur (k, m, f, t, espace),
    // et une combinaison avec Alt ne produit jamais de caractère —
    // le raccourci marche donc même avec le curseur dans le tchat,
    // ce qui est justement le cas le plus fréquent.

    function setupMenuShortcut() {

        document.addEventListener(
            'keydown',
            function (event) {

                if (
                    !event.altKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    (event.key || '').toLowerCase() !== 'p'
                ) {
                    return;
                }

                // Pas de bouton visible = pas de menu à ouvrir
                // (accueil, page sans lecteur, mini-player).
                if (
                    !dashboardButton ||
                    dashboardButton.style.visibility === 'hidden'
                ) {
                    return;
                }

                event.preventDefault();

                if (dashboardVisible) {
                    hideDashboard();
                } else {
                    showDashboard();
                }

            },
            true
        );

        // Échap ferme le menu, comme il ferme déjà le dashboard.
        document.addEventListener('keydown', function (event) {

            if (event.key === 'Escape' && dashboardVisible) {
                hideDashboard();
            }

        });

    }

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

            startAutoBackup();

            return;

        }


        lastKnownChannel = getTestChannel();

        createPlayerButton();

        setupMenuShortcut();

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


        // Mesure bande passante / temps de visionnage.
        setInterval(trackBandwidthAndWatchTime, BANDWIDTH_TICK_MS);

        // Pause faite sur le lecteur de Twitch : on ne peut pas
        // écouter l'élément, il est remplacé en cours de route.
        setInterval(watchNativeTwitchPause, 1000);

        // Même raison pour le volume, barre fermée.
        setInterval(dvrKeepTwitchVolume, 1000);

        startAutoBackup();

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
