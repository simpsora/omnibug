/*
 * Omnibug
 * Persistent event page, running in background (controller)
 *
 * https://omnibug.io
 */
(() => {
    let settings = new OmnibugSettings(),
        tabs = {},
        cached = {
            settings: {},
            pattern: null
        };

    /**
     * Set/Load/Migrate settings when extension / browser is installed / updated.
     */
    browser.runtime.onInstalled.addListener((details) => {
        // Migrate from local storage to sync storage, if available
        if(details.reason === "update" && details.previousVersion.indexOf("0.") === 0)
        {
            settings.migrate().then((loadedSettings) => {
                cached.settings = loadedSettings;
                cached.pattern = OmnibugProvider.getPattern(loadedSettings.enabledProviders);
            });
        } else {
            settings.load().then((loadedSettings) => {
                cached.settings = loadedSettings;
                cached.pattern = OmnibugProvider.getPattern(loadedSettings.enabledProviders);

                // Make sure we save any settings, in case of fresh installs
                settings.save(settings);
            });
        }
    });

    /**
     * Load settings when extension is first run a session
     */
    browser.runtime.onStartup.addListener(() => {
        settings.load().then((loadedSettings) => {
            cached.settings = loadedSettings;
            cached.pattern = OmnibugProvider.getPattern(cached.settings.enabledProviders);
        });
    });

    /**
     * Load settings when storage has changed
     */
    browser.storage.onChanged.addListener((changes, storageType) => {
        if(OmnibugSettings.storage_key in changes)
        {
            cached.settings = changes[OmnibugSettings.storage_key];
            cached.pattern = OmnibugProvider.getPattern(cached.settings.enabledProviders);
            tabs.forEach((tab) => {
                tab.port.postMessage({
                    "event": "settings",
                    "data":  cached.settings
                });
            })
        }
    });

    /**
     * Accept incoming connections from our devtools panels
     */
    browser.runtime.onConnect.addListener((details) => {
        console.log("browser.runtime.onConnect", details);
        let port = new OmnibugPort(details);
        if(!port.belongsToOmnibug)
        {
            return;
        }
        tabs = port.init(tabs);
    });

    /**
     * Listen for all requests that match our providers
     */
    browser.webRequest.onBeforeRequest.addListener(
        (details) => {
            // Ignore any requests for windows where devtools isn't open
            if(details.tabId === -1 || !(details.tabId in tabs) || !cached.pattern.test(details.url))
            {
                return;
            }

            let data = {
                    "request": {
                        "initiator": details.initiator,
                        "method":    details.method,
                        "id":        details.requestId,
                        "tab":       details.tabId,
                        "timestamp": details.timeStamp,
                        "type":      details.type,
                        "url":       details.url
                    },
                    "event": "webRequest"
                },
                postData = "";

            if(details.method === "POST") {
                postData =  String.fromCharCode.apply( null, new Uint8Array( data.requestBody.raw[0].bytes ) );
            }

            data = Object.assign(
                data,
                OmnibugProvider.parseUrl(details.url, postData)
            );

            console.log("Matched URL, sending data to devtools", data);
            tabs[details.tabId].port.postMessage(data);
        },
        { urls: ["<all_urls>"] },
        ["requestBody"]
    );

    /**
     * @TODO (or at least consider) adding these:
     * - browser.webNavigation.onBeforeNavigate:    when a user navigates to a new page (clear/fade previous requests)
     * - browser.webRequest.onHeadersReceived:      when a request's headers are returned (useful for seeing 3XX requests)
     */
})();