/* global OmnibugSettings, OmnibugProvider, OmnibugTracker, createElement, clearStyles, clearChildren, showToast, getAppropriateTextColor, Fuse */

/*
 * Omnibug
 * DevTools panel code (view)
 *
 * This work is licensed under the Creative Commons Attribution-ShareAlike 3.0 Unported License.
 * To view a copy of this license, visit http://creativecommons.org/licenses/by-sa/3.0/ or send
 * a letter to Creative Commons, 444 Castro Street, Suite 900, Mountain View, California, 94041,
 * USA.
 *
 */
window.Omnibug = (() => {

    let d = document,
        settings = (new OmnibugSettings).defaults,
        requestPanel = d.getElementById("requests"),
        noRequests = d.getElementById("no-requests"),
        filters = { "providers": {}, "account": "", "accountType": "contains" },
        persist = true,
        storageLoadedSettings = false,
        recordedData = [],
        allProviders = OmnibugProvider.getProviders(),
        tracker = new OmnibugTracker,
        providerSearch;


    // Clear all requests
    d.querySelectorAll("a[href=\"#clear\"]").forEach((element) => {
        element.addEventListener("click", (event) => {
            event.preventDefault();
            clearRequests();
        });
    });


    // Open settings from links in devtools
    d.querySelectorAll("a[href=\"#settings\"]").forEach((element) => {
        element.addEventListener("click", (event) => {
            event.preventDefault();
            window.Omnibug.send_message({
                "type": "openSettings"
            });
        });
    });

    // Open modals
    d.querySelectorAll("button[data-target-modal], a[data-target-modal]").forEach((element) => {
        element.addEventListener("click", (event) => {
            event.preventDefault();

            let target = d.getElementById(element.getAttribute("data-target-modal"));
            if (target) {
                target.classList.add("active");
                tracker.track(["send", "event", "modal", "open", element.getAttribute("data-target-modal").replace(/^#/, "")]);
            }
        });
    });

    // Close modals
    d.querySelectorAll(".modal a[href=\"#close\"]").forEach((element) => {
        element.addEventListener("click", (event) => {
            event.preventDefault();

            let target = element.closest(".modal"),
                modal = target.getAttribute("id");
            if (target) {
                target.classList.remove("active");
                if (modal === "filter-modal") {
                    let hiddenProviders = Object.entries(filters.providers).filter((provider) => {
                        return !provider[1] && settings.providers[provider[0]].enabled;
                    });
                    tracker.track(["send", "event", "filter requests", "account", (filters.account === "") ? "no filter" : filters.accountType]);
                    tracker.track(["send", "event", "filter requests", "hidden providers", hiddenProviders.length]);
                }
                tracker.track(["send", "event", "modal", "close", modal]);
            }
        });
    });

    // Add tracking to top nav
    d.querySelectorAll("header > nav a").forEach((element) => {
        element.addEventListener("click", (event) => {
            tracker.track(["send", "event", "top nav", element.getAttribute("href").replace("#", "")]);
        });
    });

    d.addEventListener("contextmenu", function (e) {
        if (settings.contextMenuBeta) {
            let contextMenu = d.querySelector(".context-menu");
            if (contextMenu) {
                contextMenu.remove();
            }
            let tableRow = e.target.closest("tr[data-parameter-key]");
            if (tableRow) {
                e.preventDefault();
                let parameterKey = tableRow.getAttribute("data-parameter-key"),
                    parameterName = tableRow.querySelector(".parameter-field").innerText,
                    parameterValue = tableRow.querySelector(".parameter-value").innerText,
                    parentTD = (e.target.tagName === "TD") ? e.target : e.target.closest("td");

                let popoverTemplate = d.getElementById("row-context-menu-template"),
                    popover = d.importNode(popoverTemplate.content, true);

                popover.querySelectorAll(`[data-parameter]`).forEach((el) => {
                    el.setAttribute("data-parameter", parameterKey);
                });
                popover.querySelectorAll(".context-menu-parameter-key-pair").forEach((elem) => {
                    elem.innerText = `${parameterName} (${parameterKey})`;
                });
                popover.querySelectorAll(".context-menu-parameter-name").forEach((elem) => {
                    elem.innerText = parameterName;
                });
                popover.querySelector(`[data-context-menu="copy"]`).setAttribute("data-value", parameterValue);
                if (settings.highlightKeys.indexOf(parameterKey) !== -1) {
                    popover.querySelector(".context-menu-highlight-action").innerText = "Un-highlight";
                }
                popover.querySelector(".context-menu").style.top = e.offsetY + "px";
                if ((document.documentElement.clientWidth - 200) < e.clientX) {
                    popover.querySelector(".context-menu").style.left = (e.offsetX - 200) + "px";
                } else {
                    popover.querySelector(".context-menu").style.left = e.offsetX + "px";
                }
                parentTD.appendChild(popover);
            }
        }
    });
    d.addEventListener("click", function (e) {
        if (settings.contextMenuBeta) {
            if (e.target.hasAttribute("data-context-menu") || (e.target.parentNode && e.target.parentNode.hasAttribute && e.target.parentNode.hasAttribute("data-context-menu"))) {
                let item = (e.target.hasAttribute("data-context-menu")) ? e.target : e.target.parentNode,
                    action = item.getAttribute("data-context-menu"),
                    parameterKey = item.getAttribute("data-parameter");

                if (action === "highlight") {
                    let keys = settings.highlightKeys,
                        highlightType = "";
                    if (keys.indexOf(parameterKey) !== -1) {
                        keys = keys.filter((param => param !== parameterKey));
                        highlightType = "un-highlight";
                    } else {
                        keys.push(parameterKey);
                        highlightType = "highlight";
                    }
                    window.Omnibug.send_message({
                        "type": "settings",
                        "key": "highlightKeys",
                        "value": keys
                    });
                    showToast("Preferences updated.", "success", 5);
                    tracker.track(["send", "event", "context menu", highlightType, parameterKey]);
                } else if (action === "watch") {
                    // @TODO: do something with watch here
                } else if (action === "copy") {
                    let copyValue = item.getAttribute("data-value");
                    if (copyValue === "") {
                        showToast("Value is empty, nothing to copy!", "warning", 5);
                    } else {
                        let successCallback = () => {
                                showToast("Value copied to the clipboard.", "success", 5);
                                tracker.track(["send", "event", "context menu", "copy", "success"]);
                            },
                            failureCallback = (reason) => {
                                showToast("Unable to copy to the clipboard.", "error");
                                tracker.track(["send", "event", "context menu", "copy", "error"]);
                                console.error(reason);
                            },
                            fallback = () => {
                                // sourced from https://gist.github.com/lgarron/d1dee380f4ed9d825ca7
                                (new Promise((resolve, reject) => {
                                    let success = false,
                                        listener = (e) => {
                                            e.clipboardData.setData("text/plain", copyValue);
                                            e.preventDefault();
                                            success = true;
                                        };
                                    document.addEventListener("copy", listener);
                                    document.execCommand("copy");
                                    document.removeEventListener("copy", listener);
                                    success ? resolve() : reject();
                                })).then(successCallback, failureCallback);
                            };
                        navigator.permissions.query({
                            name: "clipboard-write"
                        }).then(permissionStatus => {
                            if(permissionStatus.state === "granted") {
                                // Future versions of Firefox and/or Chrome will use this in conjunction with clipboard-write
                                navigator.clipboard.writeText(copyValue).then(successCallback, failureCallback);
                            } else {
                                // Newer Chromium browsers have "clipboard-write" as a permission, but don't allow it in extensions due to Feature Policies
                                fallback();
                            }
                        }).catch((e) => {
                            try {
                                // Firefox doesn't have the clipboard-write permission, but allows navigator.clipboard to work
                                navigator.clipboard.writeText(copyValue).then(successCallback, failureCallback);
                            } catch(ee) {
                                // This shouldn't happen, but used as a fallback
                                console.log("copy is falling back because of ", ee.message);
                                fallback();
                            }
                        });
                    }
                }
            }
            let contextMenu = d.querySelector(".context-menu");
            if (contextMenu) {
                contextMenu.remove();
            }
        }
        if (e.target.tagName === "A" && e.target.hasAttribute("target") && e.target.getAttribute("target") === "_blank") {
            e.preventDefault();
            window.Omnibug.send_message({
                "type": "linkClick",
                "url": e.target.getAttribute("href")
            });
        }
    });
    requestPanel.addEventListener("mousedown", (event) => {
        if (event.target.tagName === "TD" && !event.target.classList.contains("parameter-value")) {
            event.preventDefault();
            let stylesheet = d.getElementById("cellWidthStyles"),
                originalWidth = event.target.getBoundingClientRect().width,
                offset = event.clientX;
            let moveHandler = (event) => {
                let width = originalWidth + (event.clientX - offset);
                stylesheet.sheet.deleteRule(0);
                stylesheet.sheet.insertRule(`.request-details tbody > tr > td:first-of-type { width: ${width > 25 ? width : 25}px; }`);
            };
            d.addEventListener("mousemove", moveHandler, true);
            requestPanel.addEventListener("mouseup", (event) => {
                d.removeEventListener("mousemove", moveHandler, true);
                requestPanel.mouseup = null;
            }, true);
            
        }
    });

    // Toasts
    document.getElementById("toasts").addEventListener("click", (event) => {
        if (event.target.classList.contains("btn-clear")) {
            event.target.parentNode.remove();
        }
    });

    // Add our listener for the account filter
    let filterAccount = d.getElementById("filter-account"),
        filterAccountType = d.getElementById("filter-account-type");
    filterAccount.addEventListener("input", (event) => {
        // event.preventDefault();
        let accountFilter = event.target.value;
        filters.account = accountFilter.replace(/[^0-9a-zA-Z_ .,-]/g, "");
        updateFiltersStyles();
    });
    filterAccountType.addEventListener("change", (event) => {
        // event.preventDefault();
        let accountFilterType = event.target.value;
        filters.accountType = ["contains", "starts", "ends", "exact"].indexOf(accountFilterType) === -1 ? "contains" : accountFilterType;
        updateFiltersStyles();
    });
    filterAccount.addEventListener("keypress", (event) => {
        let key = event.which || event.keyCode;
        if (key === 13) {
            d.getElementById("filter-modal").classList.remove("active");
        }
    });

    // Select all/none
    let filterProviderSelectBulk = d.getElementById("provider-select-all");
    filterProviderSelectBulk.addEventListener("change", (event) => {
        let checked = event.target.checked,
            providers = d.querySelectorAll(`#filter-providers > li:not(.d-none) input[type="checkbox"]`);
        providers.forEach((provider) => {
            provider.checked = checked;
            if (Object.prototype.hasOwnProperty.call(filters.providers, provider.value)) {
                filters.providers[provider.value] = checked;
            }
        });
        tracker.track(["send", "event", "filter requests", ((checked) ? "show" : "hide") + " all"]);
        updateFiltersStyles();
    });

    // Clear filters
    d.getElementById("filter-reset-all").addEventListener("click", (event) => {
        event.preventDefault();
        filters = { "providers": {}, "account": "", "accountType": "contains" };
        Object.keys(allProviders).forEach((key) => {
            filters.providers[key] = true;
        });
        buildProviderFilterPanel();
    });

    // Default filter save
    d.getElementById("filter-save-default").addEventListener("click", (event) => {
        let filterSettings = {},
            disabledProviders = [],
            enabledProviders = [];

        Object.entries(filters.providers).forEach((pair) => {
            if (pair[1]) {
                enabledProviders.push(pair[0]);
            } else {
                disabledProviders.push(pair[0]);
            }
        });

        // Whitelist the selected providers, otherwise new providers would start to show up when they were added to Omnibug
        if (disabledProviders.length) {
            filterSettings.providers = enabledProviders;
        }

        if (filters.account) {
            filterSettings.fields = {
                "account": {
                    "value": filters.account,
                    "type": filters.accountType
                }
            };
        }

        window.Omnibug.send_message({
            "type": "settings",
            "key": "defaultFilters",
            "value": filterSettings
        });
        showToast("Default filter updated.", "success", 5);
    });

    // Add our filter
    providerSearch = new Fuse(Object.values(allProviders), {
        findAllMatches: true,
        threshold: 0.3,
        location: 0,
        distance: 50,
        maxPatternLength: 20,
        minMatchCharLength: 1,
        includeScore: true,
        includeMatches: true,
        keys: [
            {
                name: "name",
                weight: 0.50
            },
            {
                name: "keywords",
                weight: 0.30
            },
            {
                name: "type",
                weight: 0.20
            }
        ]
    });
    d.getElementById("provider-search").addEventListener("input", (event) => {
        let searchTerm = (event.target.value || "").substring(0, 20),
            providers = d.querySelectorAll("#filter-providers > li");

        if (searchTerm) {
            let results = providerSearch.search(searchTerm);
            providers.forEach((provider) => {
                if (results.find((searchProvider) => {
                    return searchProvider.item.key === provider.getAttribute("data-provider");
                }) !== undefined) {
                    provider.classList.remove("d-none");
                }
                else {
                    provider.classList.add("d-none");
                }
            });
            d.getElementById("provider-select-all-title").innerText = "Select All/None Shown Below";
        } else {
            providers.forEach((provider) => {
                provider.classList.remove("d-none");
            });
            d.getElementById("provider-select-all-title").innerText = "Select All/None";
        }
    });

    // Clear requests on navigation
    d.getElementById("persist-enable").addEventListener("click", (event) => {
        event.preventDefault();
        d.body.classList.remove("persist-disabled");
        persist = true;
    });

    // Persist requests on navigation
    d.getElementById("persist-disable").addEventListener("click", (event) => {
        event.preventDefault();
        d.body.classList.add("persist-disabled");
        persist = false;
    });

    // Export to CSV/Tab files
    d.getElementById("export-form").addEventListener("submit", (event) => {
        event.preventDefault();
        let formData = new FormData(event.target),
            filename = (formData.get("filename") || "").replace(/[^0-9a-zA-Z_ .,-]/g, ""),
            defaultFilename = false,
            useFilters = Boolean(formData.get("useFilters")),
            showNavigation = Boolean(formData.get("showNavigation")),
            fileType = formData.get("fileType") || "",
            exportData = recordedData;

        // filter out what is needed
        if (!showNavigation) {
            exportData = exportData.filter((request) => {
                return request.event !== "webNavigation";
            });
        }
        if (useFilters) {
            exportData = exportData.filter((request) => {
                if (request.event === "webNavigation") { return true; }
                let account = getMappedColumnValue("account", request);
                return filters.providers[request.provider.key] === true
                    && ((!filters.account && !account) || (account && account.indexOf(filters.account) !== -1));
            });
        }

        // Check our file type to make sure we're OK
        if (["csv", "tab"].indexOf(fileType) === -1) {
            fileType = "csv";
        }

        // generate a filename if one was not passed or contained too many bad chars
        if (filename === "") {
            let now = new Date(),
                date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((e) => e.toString().length === 1 ? "0" + e : e),
                time = [now.getHours(), now.getMinutes() + 1, now.getSeconds()].map((e) => e.toString().length === 1 ? "0" + e : e);
            filename = `Omnibug_Export_${date.join("-")}_ ${time.join("-")}`;
            defaultFilename = true;
        }

        // Append our file extension
        filename += `.${fileType}`;

        // Start the export process
        let colDelim = (fileType === "csv") ? `","` : `"\t"`,
            exportText = exportData.map((request) => {
                let row = [];
                if (request.event === "webNavigation") {
                    row = [
                        "Navigation",
                        "",
                        "",
                        ""
                    ];
                } else {
                    console.log(request);
                    let account = getMappedColumnValue("account", request),
                        requestType = getMappedColumnValue("requestType", request);

                    row = [
                        requestType,
                        request.provider.name,
                        account,
                        request.request.id
                    ];
                }
                row.push(request.request.url.replace(/"/g, `\\"`));
                if (typeof request.request.postData !== "string") {
                    row.push(JSON.stringify(request.request.postData));
                } else {
                    row.push(request.request.postData);
                }
                row.push((new Date(request.request.timestamp)).toString());
                if (settings.showNotes) {
                    row.push(request.request.note);
                }
                return `"` + row.join(colDelim) + `"`;
            }).join("\n");
        // Add any headers
        exportText = `"` + ["##OMNIBUG_NAME## v##OMNIBUG_VERSION##", "Exported " + (new Date()).toString()].join(colDelim) + `"\n`
            + `"` + ["Event Type", "Provider", "Account", "Request ID", "Request URL", "POST Data", "Timestamp", "Notes"].join(colDelim) + `"\n` + exportText;


        // Generate the file to download
        let blob = new Blob([exportText], { type: `text/${fileType}` }),
            url = window.URL.createObjectURL(blob);

        let link = createElement("a", {
            "attributes": {
                "href": url,
                "download": filename
            }
        });
        d.body.appendChild(link);

        // Force the download
        link.click();
        window.URL.revokeObjectURL(url);

        // Clean up
        link.remove();

        tracker.track(["send", {
            "hitType": "event",
            "eventCategory": "export data",
            "eventAction": fileType,
            "eventLabel": (defaultFilename) ? "default filename" : "custom filename",
            "metric1": exportData.length,
            "dimension5": String(showNavigation),
            "dimension6": String(useFilters)
        }]);

        // Close the modal overlay now that they've exported the file
        let modal = event.target.closest(".modal");
        if (modal) {
            modal.classList.remove("active");
        }
    });


    // Setup our providers in our filters list
    Object.keys(allProviders).forEach((key) => {
        filters.providers[key] = true;
    });

    // Load up the default settings
    loadSettings(settings);

    /**
     * Listener for note changes
     * @param event
     */
    function noteListener(event) {
        let input = event.target,
            requestParent = input.closest("details.request"),
            id = requestParent.getAttribute("data-request-id"),
            timestamp = requestParent.getAttribute("data-timestamp"),
            request = recordedData.find((r) => {
                return r.event === "webRequest" && String(r.request.id) === id && String(r.request.timestamp) === timestamp;
            });
        if (typeof request !== "undefined") {
            // this _should_ always trigger, but just in case...
            request.request.note = input.value;
        }
    }

    function clearRequests() {
        // Clear our current requests
        clearChildren(requestPanel);

        // Show the no requests found notification
        noRequests.classList.remove("d-none");

        recordedData = [];
    }

    /**
     * Add a new provider-based request
     *
     * @param request
     */
    function addRequest(request) {
        noRequests.classList.add("d-none");
        recordedData.push(request);
        requestPanel.appendChild(buildRequest(request));
    }

    /**
     * Add a redirected class for all requests that share the same ID
     *
     * @param requestId
     */
    function updateRedirectedEntries(requestId, multipleEntriesPerRequest) {
        let redirectedEntries = d.querySelectorAll(`.request[data-request-id="${requestId}"]`);
        redirectedEntries.forEach((entry) => {
            if (multipleEntriesPerRequest) {
                entry.classList.add("multipled");
            } else {
                entry.classList.add("redirected");
            }
        });
    }

    /**
     * Get a mapped column value
     *
     * @param column
     * @param request
     * @return {string}
     */
    function getMappedColumnValue(column, request) {
        let value = "";
        if (request.provider && request.provider.columns && request.provider.columns[column]) {
            value = request.data.find((el) => {
                return el.key === request.provider.columns[column];
            });
            if (value) {
                value = value.value;
            }
        }
        return value;
    }

    /**
     * Get value from data
     * 
     * @param field
     * @param request 
     * @return {string}
     */
    function getDataColumnValue(field, request) {
        let value = "";
        if (request.data) {
            value = request.data.find((fld) => {
                return fld.field === field;
            });
            if (value) {
                value = value.value;
            } else {
                value = "";
            }
        }
        return value;
    }

    /**
     * Build HTML for a request
     *
     * @param request
     * @return {HTMLElement}
     */
    function buildRequest(request) {
        let details = createElement("details", {
                "classes": ["request"],
                "attributes": {
                    "data-request-id": request.request.id,
                    "data-provider": request.provider.key,
                    "data-timestamp": request.request.timestamp,
                    "data-account": ""
                }
            }),
            body = createElement("div");

        // Update any redirected entries
        updateRedirectedEntries(request.request.id, request.multipleEntriesPerRequest);

        // Setup parent details element
        if (settings.alwaysExpand) {
            details.setAttribute("open", "open");
        }

        // Add the summary (title)
        let colTitleSpan = createElement("span", {
                "attributes": {
                    "title": request.provider.name
                },
                "text": request.provider.name
            }),
            colTitleRedirectIcon = createElement("i", {
                "classes": ["fas", "fa-sync"]
            }),
            colTitleRedirect = createElement("small", {
                "classes": ["redirect", "redirect-icon"],
                "attributes": {
                    "title": "This entry was redirected."
                },
                "children": [colTitleRedirectIcon]
            }),
            colTitleMultipleIcon = createElement("i", {
                "classes": ["fas", "fa-table"]
            }),
            colTitleMultiple = createElement("small", {
                "classes": ["multiple", "multiple-icon"],
                "attributes": {
                    "title": "This entry was part of a single request."
                },
                "children": [colTitleMultipleIcon]
            }),
            colAccount = createElement("div", {
                "classes": ["column", "col-3", "col-lg-4", "col-md-4", "col-sm-5"]
            }),
            requestTypeValue;


        // Add the provider name & request type (if applicable)
        if (request.provider.columns.requestType) {
            requestTypeValue = request.data.find((el) => {
                return el.key === request.provider.columns.requestType;
            });
        }
        if (!requestTypeValue) {
            requestTypeValue = { "value": "Other" };
        }

        let requestTypeEl = createElement("span", {
            "classes": ["label"],
            "attributes": {
                "data-request-type": requestTypeValue.value,
            },
            "text": requestTypeValue.value
        });

        let colTitleWrapper = createElement("div", {
            "classes": ["column", "col-3", "col-lg-4", "col-md-4", "col-sm-5"],
            "children": [requestTypeEl, colTitleSpan, colTitleRedirect, colTitleMultiple],
            "attributes": {
                "title": `${request.provider.name} ${requestTypeValue.value}`
            }
        });

        // Add the account ID, if it exists
        let accountValue = getMappedColumnValue("account", request);

        if (accountValue) {
            colAccount.innerText = accountValue;
            colAccount.setAttribute("title", accountValue);
            details.setAttribute("data-account", accountValue);
        }

        // Add the event ID and Link Name, if exists
        let includeEventCol = false;
        let colEvent = {};
        if (settings.additionalSummary.length > 0) {
            let colText = "";
            settings.additionalSummary.forEach((fld) => {
                colText = `${colText} - ${getDataColumnValue(fld, request)}`;
            });

            colText = colText.substring(2); // trim the first 3 characters off including the first -
            colEvent = createElement("div", {
                "classes": ["column", "col-3", "col-lg-4", "col-md-4", "col-sm-2"],
                "text": colText,
                "attributes": {
                    "title": "temp"
                }
            });
            includeEventCol = true;
        }

        // Add the timestamp
        let timestamp = new Date(request.request.timestamp).toLocaleString(),
            colTime = createElement("div", {
                "classes": ["column", "col-3", "col-lg-4", "col-md-4", "col-sm-2"],
                "text": timestamp,
                "attributes": {
                    "title": timestamp
                }
            });

        // Wrap everything
        let summaryColumns = createElement("div", {
                "classes": ["columns"],
                "children": [colTitleWrapper, colAccount, (includeEventCol ? colEvent : null), colTime]
            }),
            summaryContainer = createElement("div", {
                "classes": ["container"],
                "children": [summaryColumns]
            }),
            summary = createElement("summary", {
                "children": [summaryContainer]
            });

        // Append our summary
        details.appendChild(summary);

        let redirectHelpLink = createElement("a", {
                "attributes": {
                    "target": "_blank",
                    "href": "https://omnibug.io/help/redirected-requests"
                },
                "text": "Learn more."
            }),
            redirectWarning = createElement("div", {
                "classes": ["redirect", "toast", "toast-warning"],
                "text": "This request was redirected, thus the data may not be the final data sent to the provider. ",
                "children": [redirectHelpLink]
            });
        body.appendChild(redirectWarning);

        // Add the note field & listener
        let noteInput = createElement("input", {
                "classes": ["form-input"],
                "attributes": {
                    "type": "text",
                    "placeholder": "Enter a note about this request…"
                }
            }),
            noteWrapper = createElement("div", {
                "classes": ["form-group", "request-note"],
                "children": [noteInput]
            });
        noteInput.addEventListener("input", noteListener);
        body.appendChild(noteWrapper);

        let requestSummary = [];
        Object.entries(request.request).forEach((info) => {
            requestSummary.push({
                "key": "omnibug-" + info[0],
                "field": info[0],
                "value": info[1]
            });
        });

        console.log(settings.renameParameters);
        let data = request.data.reduce((groups, item) => {
            if (!item.hidden) {
                const val = item.group;
                groups[val] = groups[val] || [];
                const newItem = { ...item, label: settings.renameParameters[item.field] };
                groups[val].push(newItem);
            }
            return groups;
        }, { "summary": requestSummary });

        let groups = request.provider.groups || [];
        groups.unshift({ "key": "summary", "name": "Summary" });
        groups.push({ "key": "other", "name": "Other" });

        groups.forEach((group) => {
            if (data[group.key]) {
                let panel = buildRequestPanel(group.name, data[group.key], !settings.showFullNames);
                body.appendChild(panel);
            }
        });
        details.appendChild(body);

        return details;
    }

    /**
     * Build the HTML for a request panel
     *
     * @param title string
     * @param data  []
     * @param useKey Boolean
     * @return {HTMLElement}
     */
    function buildRequestPanel(title, data = [], useKey = false) {
        let wrapper = createElement("details", {
            "classes": ["request-details"]
        });
        if (title !== "Summary") {
            wrapper.setAttribute("open", "open");
        }

        // Add the summary (title)
        let summary = createElement("summary");
        summary.innerText = title;
        wrapper.appendChild(summary);

        // Setup the table
        let tableBody = createElement("tbody");

        // Loop through each of the data objects to create a new table row
        data.sort((a, b) => {
            let aKey, bKey = "";
            switch (settings.paramSortOrder) {
                case "label":
                    aKey = a.label ? a.label.toLowerCase() : a.field.toLowerCase();
                    bKey = b.label ? b.label.toLowerCase() : b.field.toLowerCase();
                    break;
                default:
                    aKey = a.field.toLowerCase();
                    bKey = b.field.toLowerCase();
                    break;
            }
            return aKey.localeCompare(bKey, "standard", { "numeric": true });
        }).forEach((row) => {
            let nameKey = createElement("span", {
                    "classes": ["parameter-key"],
                    "text": row.key
                }),
                nameField = createElement("span", {
                    "classes": ["parameter-field"],
                    "text": row.label ? `${row.label} (${row.field})` : row.field
                }),
                valueSpan = createElement("span", {
                    "text": (row.key === "omnibug-postData" && typeof row.value === "object" ? JSON.stringify(row.value) : row.value)
                }),
                value = createElement("td", {
                    "classes": ["parameter-value"],
                    "children": [valueSpan]
                }),
                name = createElement("td", {
                    "attributes": {
                        "title": `${row.field} (${row.key})`
                    },
                    "children": [nameKey, nameField]
                }),
                tableRow = createElement("tr", {
                    "attributes": {
                        "data-parameter-key": row.key
                    },
                    "children": [name, value]
                });

            tableBody.appendChild(tableRow);
        });

        // Append the final results
        let table = createElement("table", {
            "classes": ["table", "table-striped", "table-hover"],
            "children": [tableBody]
        });
        wrapper.appendChild(table);

        return wrapper;
    }

    /**
     * Add a navigation event to the panel
     *
     * @param navigation
     */
    function addNavigation(navigation) {
        let request = createElement("div", {
            "classes": ["navigation", "noselect"],
            "text": "Navigated to " + navigation.request.url
        });

        // check if we need to clear any existing requests out first...
        if (!persist) {
            clearRequests();
        }

        // Add it to our data array
        recordedData.push(navigation);

        requestPanel.appendChild(request);
    }

    /**
     * Load in new settings/styles
     *
     * @param newSettings
     * @param fromStorage
     */
    function loadSettings(newSettings = {}, fromStorage = false) {
        let styleSheet = d.getElementById("settingsStyles");
        const defaults = (new OmnibugSettings).defaults;

        settings = Object.assign({}, defaults, newSettings);

        let theme = settings.theme,
            themeType = theme === "auto" ? "auto" : "manual";
        if (themeType === "auto") {
            if (chrome.devtools.panels && chrome.devtools.panels.themeName === "dark") {
                theme = "dark";
            } else {
                theme = "light";
            }
        }

        tracker.updateAllowTracking(settings.allowTracking);

        if (settings.allowTracking) {
            if (!storageLoadedSettings && fromStorage) {
                tracker.init(settings.allowTracking);
            }
            tracker.track(["set", "dimension2", String(settings.showRedirects)], true);
            tracker.track(["set", "dimension3", String(settings.showNavigation)], true);
            tracker.track(["set", "dimension4", String(settings.showNotes)], true);
            tracker.track(["set", "dimension7", `${themeType}: ${theme}`], true);

            if (!storageLoadedSettings && fromStorage) {
                tracker.track(["send", "pageview", "/panel"]);
            }
        }

        // Build any default filters
        if (!storageLoadedSettings && fromStorage && typeof settings.defaultFilters === "object" && settings.defaultFilters !== null) {
            if (Object.entries(settings.defaultFilters).length) {
                filters = filters || {};
                if (settings.defaultFilters.fields) {
                    if (settings.defaultFilters.fields.account) {
                        filters.account = settings.defaultFilters.fields.account.value;
                        filters.accountType = settings.defaultFilters.fields.account.type;
                    }
                }
                if (settings.defaultFilters.providers) {
                    filters.providers = Object.keys(allProviders).reduce((filteredProviders, provider) => {
                        filteredProviders[provider] = settings.defaultFilters.providers.includes(provider);
                        return filteredProviders;
                    }, {});
                }
            }
        }

        // Build the filter list
        buildProviderFilterPanel();

        // Clear out any existing rules
        clearStyles(styleSheet);

        // Highlight colors
        if (settings.highlightKeys.length) {
            let highlightPrefix = "[data-parameter-key=\"",
                highlightKeys = highlightPrefix + settings.highlightKeys.join(`" i], ${highlightPrefix}`) + "\" i]",
                rule = "";

            if (defaults.color_highlight !== settings.color_highlight) {
                const highlightedTextColor = getAppropriateTextColor(settings.color_highlight);

                rule = `${highlightKeys} { background-color: ${settings.color_highlight} !important; color: ${highlightedTextColor}; } `;
                styleSheet.sheet.insertRule(rule, styleSheet.sheet.cssRules.length);
            } else {
                rule = `${highlightKeys} { background-color: #ffff00 !important; color: #000; } `;
                styleSheet.sheet.insertRule(rule, styleSheet.sheet.cssRules.length);

                // Add in dark theme
                highlightPrefix = `.dark ${highlightPrefix}`;
                highlightKeys = highlightPrefix + settings.highlightKeys.join(`"], ${highlightPrefix}`) + "\"]";
                rule = ` ${highlightKeys} { background-color: rgba(47, 132, 218, 0.75) !important; color: #ddd; } `;
                styleSheet.sheet.insertRule(rule, styleSheet.sheet.cssRules.length);
            }
        }

        // Reverse the direction of the entries to show newest first
        if (settings.requestSortOrder === "desc") {
            styleSheet.sheet.insertRule(`#requests {display: flex; flex-direction: column-reverse;}`, styleSheet.sheet.cssRules.length);
        }

        // Wrap text or truncate with ellipsis
        if (!settings.wrapText) {
            styleSheet.sheet.insertRule(`.parameter-value > span {white-space: nowrap; overflow: hidden;  text-overflow: ellipsis; display: block;}`, styleSheet.sheet.cssRules.length);
            styleSheet.sheet.insertRule(`tr:hover .parameter-value > span {white-space: normal; overflow: visible;  height:auto;}`, styleSheet.sheet.cssRules.length);
        }

        // Hide note field if disabled
        if (!settings.showNotes) {
            styleSheet.sheet.insertRule(`.request-note {display: none;}`, styleSheet.sheet.cssRules.length);
        }

        // Background colors
        if (defaults.color_click !== settings.color_click) {
            styleSheet.sheet.insertRule(`[data-request-type] { background-color: ${settings.color_click} !important; }`, styleSheet.sheet.cssRules.length);
        }
        if (defaults.color_load !== settings.color_load) {
            styleSheet.sheet.insertRule(`[data-request-type="Page View"] { background-color: ${settings.color_load} !important; }`, styleSheet.sheet.cssRules.length);
        }
        if (defaults.color_redirect !== settings.color_redirect) {
            styleSheet.sheet.insertRule(`details.request.redirected [data-request-type] { background-color: ${settings.color_redirect} !important; }`, styleSheet.sheet.cssRules.length);
        }
        if (defaults.color_hover !== settings.color_hover) {
            styleSheet.sheet.insertRule(`.request .table-hover tbody tr:hover { background-color: ${settings.color_hover} !important; }`, styleSheet.sheet.cssRules.length);
        }

        // Key vs. name
        if (settings.showFullNames) {
            styleSheet.sheet.insertRule(`.parameter-key { display: none; }`, styleSheet.sheet.cssRules.length);
        } else {
            styleSheet.sheet.insertRule(`.parameter-field { display: none; }`, styleSheet.sheet.cssRules.length);
        }

        // Navigation requests
        if (!settings.showNavigation) {
            styleSheet.sheet.insertRule(`.navigation { display: none; }`, styleSheet.sheet.cssRules.length);
        }

        // Redirected requests
        if (!settings.showRedirects) {
            styleSheet.sheet.insertRule(`details.request.redirected:not([open]) { display: none; }`, styleSheet.sheet.cssRules.length);
        }

        // Quotes
        if (settings.showQuotes) {
            styleSheet.sheet.insertRule(`.parameter-value > span:before, .parameter-value > span:after { content: '"'; color: ${settings.color_quotes}; }`, styleSheet.sheet.cssRules.length);
        }

        // Themes
        if (theme === "dark") {
            document.body.classList.add("dark");
        } else {
            document.body.classList.remove("dark");
        }

        // Show/Hide provider icons
        if (!settings.providerIcons) {
            styleSheet.sheet.insertRule(`.label + span::before {content: "";}`);
        }

        if (fromStorage) {
            storageLoadedSettings = true;
        }
    }

    /**
     * Build the provider filter panel
     */
    function buildProviderFilterPanel() {
        let providerList = d.getElementById("filter-providers");

        // Clear any existing providers
        clearChildren(providerList);

        // Create an entry for _all_ of our providers
        for (let providerKey in allProviders) {
            if (!Object.prototype.hasOwnProperty.call(allProviders, providerKey)) { continue; }

            // Create our DOM elements
            let input = createElement("input", {
                    "attributes": {
                        "type": "checkbox",
                        "id": `filter-provider-${providerKey}`,
                        "value": providerKey
                    },
                }),
                span = createElement("span", {
                    "text": allProviders[providerKey].name
                }),
                label = createElement("label", {
                    "classes": ["noselect"],
                    "attributes": {
                        "for": `filter-provider-${providerKey}`
                    },
                    "children": [input, span]
                }),
                wrapper = createElement("li", {
                    "attributes": {
                        "data-provider": providerKey
                    },
                    "children": [label]
                });

            // Check if the user has the provider enabled or not
            if (settings.providers[providerKey] && !settings.providers[providerKey].enabled) {
                label.setAttribute("title", "This provider is currently disabled and requests for this provider will never be shown. You can re-enable it within the settings");
                let warningIcon = createElement("i", {
                    "classes": ["fas", "fa-exclamation-triangle"]
                });
                span.appendChild(warningIcon);
            } else {
                if (filters.providers[providerKey]) {
                    input.checked = true;
                }
            }

            providerList.appendChild(wrapper);

            // Add our event listener
            input.addEventListener("input", (event) => {
                let checkbox = event.target,
                    providerKey = checkbox.value;
                filters.providers[providerKey] = checkbox.checked;
                tracker.track(["send", "event", "filter requests", ((checkbox.checked) ? "show" : "hide") + "provider", providerKey]);
                updateFiltersStyles();
            });

            filters.providers[providerKey] = input.checked;
        }

        d.getElementById("filter-account").value = filters.account || "";
        d.getElementById("filter-account-type").value = ["contains", "starts", "ends", "exact"].includes(filters.accountType) ? filters.accountType : "contains";

        // Finally, update our stylesheet with the new filters
        updateFiltersStyles(true);
    }

    /**
     * Update the filters stylesheet
     * @param   fromBuilder
     */
    function updateFiltersStyles(fromBuilder = false) {
        let styleSheet = d.getElementById("filterStyles");

        // Clear out any existing styles
        clearStyles(styleSheet);

        console.log("providers", filters.providers);

        // Figure out what providers are hidden
        let hiddenProviders = Object.entries(filters.providers).filter((provider) => {
            return !provider[1] && (settings.providers[provider[0]].enabled);
        }).map((provider) => {
            return `.request[data-provider="${provider[0]}"]`;
        });

        // Add hidden providers, if any
        if (hiddenProviders.length) {
            styleSheet.sheet.insertRule(`${hiddenProviders.join(", ")} { display: none; }`);
        }

        // Add account filter, if applicable
        if (filters.account) {
            let filterMap = { "contains": "*", "starts": "^", "ends": "$", "exact": "" };
            styleSheet.sheet.insertRule(`.request:not([data-account${filterMap[filters.accountType]}="${filters.account}" i]) { display: none; }`);
        }

        // Show the user that filters are (in)active
        if (filters.account || hiddenProviders.length) {
            d.body.classList.add("filters-active");
        } else {
            d.body.classList.remove("filters-active");
        }
    }

    return {
        /**
         * Receive a message from our eventPage file
         *
         * @param message
         */
        receive_message(message) {
            message.event = message.event || "";
            switch (message.event) {
                case "webRequest":
                    addRequest(message);
                    break;
                case "webNavigation":
                    addNavigation(message);
                    break;
                case "settings":
                    loadSettings(message.data, true);
                    break;
                default:
                    this.send_message("Unknown message type", message);
                    break;
            }
        },
        /**
         * Send a message back to the background script
         *
         * @param data
         */
        send_message(...data) {
            // do nothing, let the devtools.js update this method
        }
    };
})();
