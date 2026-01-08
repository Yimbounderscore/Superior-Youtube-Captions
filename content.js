// Content script - just injects the interceptor
(function () {
    'use strict';

    console.log('[BetterYTSubs] Content script loaded');

    // Inject the fetch interceptor into page context
    function injectScript() {
        const script = document.createElement('script');
        const runtimeAPI = typeof browser !== 'undefined' ? browser : chrome;
        script.src = runtimeAPI.runtime.getURL('injected.js');
        script.onload = function () {
            console.log('[BetterYTSubs] Injector loaded');
            this.remove();
        };
        (document.head || document.documentElement).appendChild(script);
    }

    // Inject immediately
    injectScript();
})();
