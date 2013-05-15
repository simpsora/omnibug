/*
 * Omnibug
 * Persistent event page, running in background (controller)
 *
 * This work is licensed under the Creative Commons Attribution-ShareAlike 3.0 Unported License.
 * To view a copy of this license, visit http://creativecommons.org/licenses/by-sa/3.0/ or send
 * a letter to Creative Commons, 444 Castro Street, Suite 900, Mountain View, California, 94041,
 * USA.
 *
 */
(function() {
    var prefs,
        tabs = {},
        that = this;

    /**
     * Installation callback
     */
    function onInit() {
        console.debug( 'eventPage onInit' );
        initPrefs();
    }
    chrome.runtime.onInstalled.addListener( onInit );


    /**
     * Store preferences (on extension installation)
     */
    function initPrefs() {
        var prefs = {
            // pattern to match in request url
              defaultPattern : OmnibugProvider.getDefaultPattern().source
            , highlightKeys  : [ "pageName", "ch", "events", "products" ]

            // show entries expanded?
            , alwaysExpand : false

            // surround values with quotes?
            , showQuotes : true

            // show full variable names?
            , showFullNames : true

            // colors
            , color_load   : "#dbedff"
            , color_click  : "#f1ffdb"
            , color_prev   : "#ffd5de"
            , color_quotes : "#f00"
            , color_hilite : "#ff0"
            , color_hover  : "#ccc"
        };

        chrome.storage.local.set( { "omnibug" : prefs }, function() {
            if( !! chrome.runtime.lastError ) {
                console.error( "Error setting prefs: ", chrome.runtime.lastError );
            }
        } );

        // force a (re)load of prefs, now that they may have changed
        loadPrefsFromStorage();
    }


    /**
     * Grab prefs data from storage
     */
    function loadPrefsFromStorage() {
        chrome.storage.local.get( "omnibug", function( prefData ) {
            that.prefs = prefData.omnibug;
            that.prefs.defaultRegex = new RegExp( that.prefs.defaultPattern );
        } );
    }
    loadPrefsFromStorage();

    /**
     * Fix broken types in prefs
     * Tried this in options.js, but didn't work
     */
    function updatePrefValues( prefs ) {
        if( "highlightKeys" in prefs ) {
            prefs["highlightKeys"] = prefs["highlightKeys"].split( /,\s?/ );
        }
    }

    /**
     * Receive updates when prefs change and broadcast them out
     */
    chrome.storage.onChanged.addListener( function( changes, namespace ) {
        if( "omnibug" in changes ) {
            var newPrefs = changes["omnibug"].newValue;

            updatePrefValues( newPrefs );
            console.log( "Received updated prefs", newPrefs );

            // update local (eventPage.js) prefs
            that.prefs = newPrefs;
            that.prefs.defaultRegex = new RegExp( that.prefs.defaultPattern );

            // send new prefs to all connected devtools panels
            sendToAllDevTools( { "type" : "prefs", "payload" : that.prefs } );
        }
    } );


    /**
     * Quickly determine if a URL is a candidate for us or now
     */
    function shouldProcess( url ) {
        return url.match( this.prefs.defaultRegex );
    }


    /**
     * Callback for the onResponseStarted listener
     *
     * details object:
     *   frameId: 0
     *   fromCache: false
     *   ip: "69.171.246.16"
     *   method: "GET"
     *   parentFrameId: -1
     *   requestId: "7502"
     *   statusCode: 200
     *   statusLine: "HTTP/1.1 200 OK"
     *   tabId: 2
     *   timeStamp: 1365937790837.5398
     *   type: "xmlhttprequest"
     *   url: "https://0-act.channel.facebook.com/pull?cha...
     */
    var responseStartedCallback = function( details ) {
        // ignore chrome:// requests and non-metrics URLs
        if( details.tabId == -1 || !shouldProcess( details.url ) ) return;

        if( !( details.tabId in tabs ) ) {
            /* disable this error message -- too numerous!
            console.error( "Request for unknown tabId ", details.tabId ); */
            return;
        }

        // look up provider and pass along
        var prov = OmnibugProvider.getProviderForUrl( details.url );
        details.omnibugProvider = prov;

        // store the current tab's loading state into the details object
        details.omnibugLoading = tabs[details.tabId].loading;

        chrome.tabs.get( details.tabId, detailsProcessingCallbackFactory( details ) );
    };


    /**
     * Factory function returning a function which has access to details *and* tab
     */
    var detailsProcessingCallbackFactory = function( details ) {
        return function( tab ) {
            // save the tab's current URL into the details object
            details.tabUrl = tab.url;

            sendToDevToolsForTab( details.tabId, { "type" : "webEvent", "payload" : decodeUrl( details ) } );
        }
    };


    chrome.webRequest.onResponseStarted.addListener(
        responseStartedCallback,
        { urls: ["<all_urls>"] }
        // @TODO: filter these based on static patterns/config ?
    );


    /**
     * Return the tabId associated with a port
     */
    function getTabId( port ) {
        return port.name.substring( port.name.indexOf( "-" ) + 1 );
    }


    /**
     * Accept connections from our devtools panels
     */
    chrome.extension.onConnect.addListener( function( port ) {
        if( port.name.indexOf( "omnibug-" ) !== 0 ) return;
        console.debug( "Registered port ", port.name, "; id ", port.portId_ );

        var tabId = getTabId( port );
        tabs[tabId] = {};
        tabs[tabId].port = port;

        // respond immediately with prefs data
        sendToDevToolsForTab( tabId, { "type" : "prefs", "payload" : this.prefs } );

        // Remove port when destroyed (e.g. when devtools instance is closed)
        port.onDisconnect.addListener( function( port ) {
            console.debug( "Disconnecting port ", port.name );
            delete tabs[getTabId( port )];
        } );

        // logs messages from the port (in the background page's console!)
        port.onMessage.addListener( function( msg ) {
            console.log( "Message from port[" + tabId + "]: ", msg );
        } );

        /**
         * Monitor for page load/complete events in tabs
         */
        chrome.tabs.onUpdated.addListener( function( _tabId, changeInfo, tab ) {
            if( _tabId in tabs ) {
                if( changeInfo.status == "loading" ) {
                    tabs[_tabId].loading = true;
                } else {
                    // give a little breathing room before marking the load as complete
                    window.setTimeout( function() { tabs[_tabId].loading = false; }, 500 );
                }
            } else {
                /* disable this error message -- too numerous!
                console.error( "onUpdated status change for unknown tab ", _tabId ); */
            }
        } );
    } );


    /**
     * Send a message to the devtools panel on a given tab
     * Assumes the port is already connected
     */
    function sendToDevToolsForTab( tabId, object ) {
        console.debug( "sending ", object.type, " message to tabId: ", tabId, ": ", object );
        try {
            tabs[tabId].port.postMessage( object );
        } catch( ex ) {
            console.error( "error calling postMessage: ", ex.message );
        }
    }

    /**
     * Send a message to all connected devtools panels
     */
    function sendToAllDevTools( object ) {
        Object.keys( tabs ).forEach( function( tabId ) {
            sendToDevToolsForTab( tabId, object );
        } );
    }

    /**
     * Receives a data object from the model, decodes it, and passes it on to report()
     */
    function decodeUrl( data ) {
        var val,
            u = new OmniUrl( data.url ),
            obj = {
                state: data    // raw data from the browser event
            };

        var that = this,
            processedKeys = {},
            provider = data.omnibugProvider;

        u.getQueryNames().forEach( function( n ) {
            if( n ) {
                vals = u.getQueryValues( n );
                processEntry( n, vals, provider, processedKeys );
            }
        } );

        // merge processedKeys into obj
        for( var key in processedKeys ) {
            if( processedKeys.hasOwnProperty( key ) ) {
                obj[key] = processedKeys[key];
            } 
        }

        obj = augmentData( obj );
        return obj;
    }


    /**
     * Takes a single name/value pair and delegates handling of it to the provider
     * Otherwise, inserts into the `other' bucket
     */
    function processEntry( name, value, provider, container ) {
        if( provider.handle( name, value, container ) ) {
            // noop (processedKeys modified by provider's handle())
        } else {
            // stick in `other'
            container["other"] = container["other"] || {};
            container["other"][name] = value;
        }
    }


    /**
     * Augments the data object with summary data
     * @param data the data object
     * @return the augmented data object
     */
    function augmentData( data ) {
        data["omnibug"] = {};

        var eventType = ( data.state.omnibugLoading ? "load" : "click" ),
            url = data.state.url,
            urlLength = data.state.url.length;

        // hacky: sometimes load events are being reported as click events.  For Omniture, detect
        // the event type (pe= means a click event), and reset eventType accordingly.
        if( data.state.omnibugProvider.name === "OMNITURE" ) {
            var oldEventType = eventType;
            eventType = ( !!url.match( "[?&]pe=" ) ? "click" : "load" );
        }

        data.omnibug["Event"]       = eventType;
        data.omnibug["Timestamp"]   = data.state.timeStamp;
        data.omnibug["Provider"]    = data.state.omnibugProvider.name;
        data.omnibug["Parent URL"]  = data.state.tabUrl;
        data.omnibug["Full URL"]    = data.state.url
                                          + "<br/>(" + urlLength + " characters"
                                          + ( urlLength > 2083
                                              ? ", <span class='imp'>*** too long for IE6/7! ***</span>"
                                              : "" )
                                          + ")";
        data.omnibug["Request ID"]   = data.state.requestId;
        data.omnibug["Status Line"]  = data.state.statusLine;
        data.omnibug["Request Type"] = data.state.type;

        return data;
    }


    /**
     * OmniUrl: class to parse a URL into component pieces
     */
    var OmniUrl = function( url ) {
        this.url = url;
        this.parseUrl();
    };

    OmniUrl.prototype = (function() {
        var U = {
            hasQueryValue: function( key ) {
                return typeof this.query[key] !== 'undefined';
            },
            getFirstQueryValue: function( key ) {
                return this.query[key] ? this.query[key][0] : '';
            },
            getQueryValues: function( key ) {
                return this.query[key] ? this.query[key] : [];
            },
            getQueryNames: function() {
                var i, a = [];
                for( i in this.query ) {
                    a.push( i );
                }
                return a;
            },
            getLocation: function() {
                return this.location;
            },
            getParamString: function() {
                return this.paramString;
            },
            addQueryValue: function( key ) {
                if( ! this.hasQueryValue( key ) ) {
                    this.query[key] = [];
                }
                for( var i=1; i<arguments.length; ++i ) {
                    this.query[key].push( arguments[i] );
                }
            },
            decode: function( val ) {
                var retVal = val;
                try {
                    retVal = val ? decodeURIComponent( val.replace( /\+/g, "%20" ) ) : val === 0 ? val : '';
                } catch( e ) {
                    try {
                        retVal = unescape( val.replace( /\+/g, "%20" ) );
                    } catch( e ) {
                        // noop
                    }
                    //return val;
                }
                return retVal.replace( "<", "&lt;" ); 
            },

            smartSplit: function( str, sep, limit) {
                str = str.split( sep );
                if( str.length > limit ) {
                    var ret = str.splice( 0, limit );
                    ret.push( str.join( sep ) );
                    return ret;
                }
                return str;
            },

            parseUrl: function() {
                var url = this.url;
                var sep = ( url.indexOf( "?" ) != -1 ? "?" : ";" );
                var pieces = this.smartSplit( url, sep, 1 );
                var p2 = pieces[0].split( ';' );
                this.query = {};
                this.queryString = '';
                this.anchor = '';
                this.location = p2[0];
                this.paramString = ( p2[1] ? p2[1] : '' );
                if( pieces[1] ) {
                    var p3 = pieces[1].split( '#' );
                    this.queryString = p3[0];
                    this.anchor = ( p3[1] ? p3[1] : '' );
                }
                if( this.queryString ) {
                    var kvSep = ( this.queryString.indexOf( "&" ) != -1 ? "&" : ";" );
                    var kvPairs = this.queryString.split( kvSep );
                    for( var i=0; i<kvPairs.length; ++i ) {
                        var kv = kvPairs[i].split( '=' );
                        this.addQueryValue( kv[0] ? this.decode( kv[0] ) : "", kv[1] ? this.decode( kv[1] ) : "" );
                    }
                }
            }
        };
        return U;
    } )();


    // public
    return {};

}() );