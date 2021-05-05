/* global OmnibugSettings, OmnibugProvider, OmnibugPort */

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
    chrome.runtime.onInstalled.addListener((details) => {
        settings.migrate()
            .then(setCachedSettings)
            .then((loaded) => { settings.save(loaded); });
        
        if (details.reason === "install") {
            chrome.tabs.create({
                url: "pages/installed.html"
            });
        }
    });

    /**
     * Load settings when extension is first run a session
     */
    chrome.runtime.onStartup.addListener(() => {
        console.log("chrome.runtime.onStartup");
        settings.load().then(setCachedSettings);
    });

    /**
     * Load settings when storage has changed
     */
    chrome.storage.onChanged.addListener((changes, storageType) => {
        console.log("onChanged", changes);
        if (settings.storage_key in changes) {
            setCachedSettings(changes[settings.storage_key].newValue);
        }
        sendSettingsToTabs(tabs);
    });

    /**
     * Accept incoming connections from our devtools panels
     */
    chrome.runtime.onConnect.addListener(async (details) => {
        console.log("chrome.runtime.onConnect", details);
        if (!cached.pattern) {
            settings.load().then(setCachedSettings);
        }
        let port = new OmnibugPort(details, settings);
        if (!port.belongsToOmnibug) {
            return;
        }
        let tabList = {};
        tabList[port.id] = port;
        sendSettingsToTabs(tabList);
        tabs = port.init(tabs);
    });

    /**
     * Listen for all requests that match our providers
     */
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            // Ignore any requests for windows where devtools isn't open
            if (!isValidTab(details.tabId) || !cached.pattern.test(details.url)) {
                return;
            }

            let data = {
                "request": {
                    "initiator": details.initiator,
                    "method": details.method,
                    "id": details.requestId,
                    "tab": details.tabId,
                    "timestamp": details.timeStamp,
                    "type": details.type,
                    "url": details.url,
                    "postData": ""
                },
                "event": "webRequest"
            };

            // Grab any POST data that is included
            if (details.method === "POST" && details.requestBody) {
                if (details.requestBody.raw && details.requestBody.raw[0]) {
                    data.request.postData = String.fromCharCode.apply(null, new Uint8Array(details.requestBody.raw[0].bytes));
                } else if (typeof details.requestBody.formData === "object") {
                    data.request.postData = details.requestBody.formData;
                }
            }

            let providerDataArray = OmnibugProvider.parseUrl(data.request.url, data.request.postData);
            if (!Array.isArray(providerDataArray)) {
                providerDataArray = [providerDataArray];
            } else {
                data.multipleEntriesPerRequest = true;
            }

            providerDataArray.forEach(providerData => {
                // Parse the URL and join our request info to the parsed data
                let finalData = Object.assign(
                    data,
                    providerData
                );
                console.log("Matched URL, sending data to devtools", finalData);
                tabs[details.tabId].port.postMessage(finalData);
            });

        },
        { urls: ["<all_urls>"] },
        ["requestBody"]
    );

    /**
     * Listen for all navigations that occur on a top-level frame
     */
    chrome.webNavigation.onBeforeNavigate.addListener(
        (details) => {
            if (isValidTab(details.tabId) && details.frameId === 0) {
                // We have a page load within a tab we care about, send a message to the devtools with the info
                console.log("webNavigation.onCommitted called", details);
                tabs[details.tabId].port.postMessage({
                    "request": {
                        "tab": details.tabId,
                        "timestamp": details.timeStamp,
                        "url": details.url
                    },
                    "event": "webNavigation"
                });
            }
        }
    );

    /**
     * Verify we have a tab that we have devtools open for
     *
     * @param tabId
     * @return {boolean}
     */
    function isValidTab(tabId) {
        return (tabId !== -1 && tabId in tabs);
    }

    /**
     * Send new settings values to all tabs
     *
     * @param tabs
     */
    function sendSettingsToTabs(tabs) {
        console.log("Sending settings to tabs", cached.settings);
        Object.values(tabs).forEach((tab) => {
            tab.port.postMessage({
                "event": "settings",
                "data": cached.settings
            });
        });
    }

    /**
     * Set cached settings
     *
     * @param settings
     * @return {{}}
     */
    function setCachedSettings(settings) {
        cached.settings = settings;
        cached.pattern = OmnibugProvider.getPattern(cached.settings.providers);
        return settings;
    }

    /**
     * @TODO (or at least consider) adding these:
     * - chrome.webRequest.onHeadersReceived:      when a request's headers are returned (useful for seeing 3XX requests)
     */
})();