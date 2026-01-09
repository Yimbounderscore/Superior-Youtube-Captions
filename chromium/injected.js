// IIFE for window object monkey-patching
(function () {
    'use strict';

    console.log('[BetterYTSubs] injected script starting...');

    // Aggregates word-by-word segments into sentence-level events
    function transformSubtitles(data) {
        if (!data || !data.events) return data;

        console.log('[BetterYTSubs] processing', data.events.length, 'events');

        const newEvents = [];
        let currentLine = { text: '', startTime: 0, endTime: 0 };

        for (const event of data.events) {

            if (!event.segs) {
                newEvents.push(event);
                continue;
            }

            const eventStartTime = event.tStartMs || 0;
            const eventDuration = event.dDurationMs || 2000;

            // Process each segment individually
            for (const seg of event.segs) {
                let word = seg.utf8;
                if (!word) continue;

                // Normalize: replace newlines with spaces
                word = word.replace(/\n/g, ' ');

                // Calculate segment timing
                const segOffset = seg.tOffsetMs || 0;
                const segStart = eventStartTime + segOffset;

                // Initialize line start time
                if (currentLine.text === '') {
                    currentLine.startTime = segStart;
                }

                currentLine.text += word;
                currentLine.endTime = segStart + eventDuration;

                // Flush line if it ends with sentence punctuation
                if (currentLine.text.trim().match(/[.!?]$/)) {
                    newEvents.push({
                        tStartMs: currentLine.startTime,
                        dDurationMs: currentLine.endTime - currentLine.startTime,
                        segs: [{ utf8: currentLine.text.trim() }]
                    });
                    currentLine = { text: '', startTime: 0, endTime: 0 };
                }
            }
        }

        // Flush remaining text
        if (currentLine.text.trim()) {
            newEvents.push({
                tStartMs: currentLine.startTime,
                dDurationMs: currentLine.endTime - currentLine.startTime,
                segs: [{ utf8: currentLine.text.trim() }]
            });
        }

        // Prevent event overlap
        for (let i = 0; i < newEvents.length - 1; i++) {
            if (newEvents[i].segs && newEvents[i + 1].segs) {
                const thisEnd = newEvents[i].tStartMs + newEvents[i].dDurationMs;
                const nextStart = newEvents[i + 1].tStartMs;
                if (thisEnd > nextStart) {
                    newEvents[i].dDurationMs = nextStart - newEvents[i].tStartMs;
                }
            }
        }

        data.events = newEvents;
        console.log('[BetterYTSubs] done. created', newEvents.length, 'lines');
        return data;
    }

    // Intercept fetch API
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

        if (url && url.includes('timedtext')) {
            console.log('[BetterYTSubs] intercepted fetch:', url.substring(0, 100));

            try {
                const response = await originalFetch.apply(this, args);
                const clonedResponse = response.clone();

                try {
                    const data = await clonedResponse.json();
                    const transformed = transformSubtitles(data);

                    return new Response(JSON.stringify(transformed), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                } catch (parseError) {
                    console.warn('[BetterYTSubs] JSON parse failed:', parseError);
                    return response;
                }
            } catch (fetchError) {
                console.error('[BetterYTSubs] fetch failed:', fetchError);
                throw fetchError;
            }
        }

        return originalFetch.apply(this, args);
    };

    // Intercept XHR (fallback for some YT requests)
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const xhrUrls = new WeakMap();

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        xhrUrls.set(this, url);
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        const url = xhrUrls.get(this);

        if (url && url.includes('timedtext')) {
            console.log('[BetterYTSubs] intercepted xhr:', url.substring(0, 100));

            const xhr = this;

            // Override responseText getter for transformation
            Object.defineProperty(xhr, 'responseText', {
                get: function () {
                    const original = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText').get.call(this);

                    if (this.readyState === 4 && original) {
                        try {
                            const data = JSON.parse(original);
                            const transformed = transformSubtitles(data);
                            return JSON.stringify(transformed);
                        } catch (e) {
                            return original;
                        }
                    }
                    return original;
                }
            });
        }

        return originalXHRSend.apply(this, args);
    };

    console.log('[BetterYTSubs] traps set. ready to intercept.');
})();
