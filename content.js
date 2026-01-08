// just inject the script that does the real work
(function () {
    'use strict';

    // log so we know we're alive
    console.log('[BetterYTSubs] CONTENT SCRIPT LOADED');

    // create a script tag pointing to our interceptor file
    function injectScript() {
        const script = document.createElement('script');
        // use whatever browser api is available (chrome/firefox)
        const runtimeAPI = typeof browser !== 'undefined' ? browser : chrome;
        script.src = runtimeAPI.runtime.getURL('injected.js');

        // clean up after ourselves once it loads
        script.onload = function () {
            console.log('[BetterYTSubs] INJECTOR LOADED');
            this.remove();
        };

        // shove it into the document head
        (document.head || document.documentElement).appendChild(script);
    }

    // do it now
    injectScript();
})();
