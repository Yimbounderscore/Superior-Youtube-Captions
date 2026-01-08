// this has to be injected to monkey-patch the window object
(function () {
    'use strict';

    console.log('[BetterYTSubs] INJECTED SCRIPT KICKING OFF...');

    // turn word-by-word junk into nice lines
    function transformSubtitles(data) {
        // if empty, bail
        if (!data || !data.events) return data;

        console.log('[BetterYTSubs] FIXING', data.events.length, 'EVENTS');

        const newEvents = [];
        let currentLine = { text: '', startTime: 0, endTime: 0 };

        for (const event of data.events) {
            // ignore stuff that isn't text
            if (!event.segs) {
                newEvents.push(event);
                continue;
            }

            const eventStartTime = event.tStartMs || 0;
            const eventDuration = event.dDurationMs || 2000;

            // mash all the segments together
            let eventText = '';
            for (const seg of event.segs) {
                if (seg.utf8) eventText += seg.utf8;
            }
            eventText = eventText.trim();
            // if it's empty after trimming, skip it
            if (!eventText) continue;

            // first word? start the timer
            if (currentLine.text === '') {
                currentLine.startTime = eventStartTime;
            }

            // add space if we already have words
            if (currentLine.text) currentLine.text += ' ';
            currentLine.text += eventText;
            currentLine.endTime = eventStartTime + eventDuration;

            // figure out when to stop the line
            // stop on punctuation or if it gets too long
            const shouldEndLine =
                eventText.match(/[.!?,;:]$/) ||
                currentLine.text.length > 70;

            if (shouldEndLine && currentLine.text.trim()) {
                // push the clean new event
                newEvents.push({
                    tStartMs: currentLine.startTime,
                    dDurationMs: currentLine.endTime - currentLine.startTime,
                    segs: [{ utf8: currentLine.text.trim() }]
                });
                // reset for the next line
                currentLine = { text: '', startTime: 0, endTime: 0 };
            }
        }

        if (currentLine.text.trim()) {
            newEvents.push({
                tStartMs: currentLine.startTime,
                dDurationMs: currentLine.endTime - currentLine.startTime,
                segs: [{ utf8: currentLine.text.trim() }]
            });
        }

        // make sure lines don't overlap or youtube gets confused
        for (let i = 0; i < newEvents.length - 1; i++) {
            if (newEvents[i].segs && newEvents[i + 1].segs) {
                const thisEnd = newEvents[i].tStartMs + newEvents[i].dDurationMs;
                const nextStart = newEvents[i + 1].tStartMs;
                if (thisEnd > nextStart) {
                    newEvents[i].dDurationMs = nextStart - newEvents[i].tStartMs;
                }
            }
        }

        // swap the events array
        data.events = newEvents;
        console.log('[BetterYTSubs] DONE. MADE', newEvents.length, 'LINES');
        return data;
    }

    // steal the fetch function
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

        // catch subtitle requests
        if (url && url.includes('timedtext')) {
            console.log('[BetterYTSubs] CAUGHT A FETCH REQUEST');

            // let it happen, but grab the result
            const response = await originalFetch.apply(this, args);

            try {
                // parse it
                const data = await response.json();
                // fix it
                const transformed = transformSubtitles(data);

                // send back our fixed version, tricking youtube
                return new Response(JSON.stringify(transformed), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            } catch (e) {
                console.error('[BetterYTSubs] OOPS, TRANSFORMATION FAILED:', e);
                // if we break it, just return the original so we don't crash the player
                return originalFetch.apply(this, args);
            }
        }

        // 
        return originalFetch.apply(this, args);
    };


    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const xhrUrls = new WeakMap();

    // spy on the open call to get the url
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        xhrUrls.set(this, url);
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    // spy on the send call
    XMLHttpRequest.prototype.send = function (...args) {
        const url = xhrUrls.get(this);

        // if it's subtitles...
        if (url && url.includes('timedtext')) {
            console.log('[BetterYTSubs] CAUGHT AN XHR REQUEST');

            const xhr = this;

            // override the response text getter
            Object.defineProperty(xhr, 'responseText', {
                get: function () {
                    // get the real response
                    const original = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText').get.call(this);
                    // only mess with it when it's done loading
                    if (this.readyState === 4 && original) {
                        try {
                            const data = JSON.parse(original);
                            // fix it
                            const transformed = transformSubtitles(data);
                            // stringify it back
                            return JSON.stringify(transformed);
                        } catch (e) {
                            // if parsing fails, just return original
                            return original;
                        }
                    }
                    return original;
                }
            });
        }

        // let the xhr go
        return originalXHRSend.apply(this, args);
    };

    console.log('[BetterYTSubs] TRAPS SET. READY TO INTERCEPT.');
})();
