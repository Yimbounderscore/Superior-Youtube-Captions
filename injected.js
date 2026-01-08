// Injected into page context - MODIFIES subtitle data before YouTube uses it
(function () {
    'use strict';

    console.log('[BetterYTSubs] Injected script starting...');

    // Group word-by-word events into proper line-by-line events
    function transformSubtitles(data) {
        if (!data || !data.events) return data;

        console.log('[BetterYTSubs] Transforming', data.events.length, 'events');

        const newEvents = [];
        let currentLine = { text: '', startTime: 0, endTime: 0 };

        for (const event of data.events) {
            // Keep non-text events (like window positioning)
            if (!event.segs) {
                newEvents.push(event);
                continue;
            }

            const eventStartTime = event.tStartMs || 0;
            const eventDuration = event.dDurationMs || 2000;

            // Combine segments
            let eventText = '';
            for (const seg of event.segs) {
                if (seg.utf8) eventText += seg.utf8;
            }
            eventText = eventText.trim();
            if (!eventText) continue;

            // Start new line
            if (currentLine.text === '') {
                currentLine.startTime = eventStartTime;
            }

            // Add to current line
            if (currentLine.text) currentLine.text += ' ';
            currentLine.text += eventText;
            currentLine.endTime = eventStartTime + eventDuration;

            // End line on punctuation or length
            const shouldEndLine =
                eventText.match(/[.!?,;:]$/) ||
                currentLine.text.length > 70;

            if (shouldEndLine && currentLine.text.trim()) {
                // Create a proper event for this line
                newEvents.push({
                    tStartMs: currentLine.startTime,
                    dDurationMs: currentLine.endTime - currentLine.startTime,
                    segs: [{ utf8: currentLine.text.trim() }]
                });
                currentLine = { text: '', startTime: 0, endTime: 0 };
            }
        }

        // Don't forget last line
        if (currentLine.text.trim()) {
            newEvents.push({
                tStartMs: currentLine.startTime,
                dDurationMs: currentLine.endTime - currentLine.startTime,
                segs: [{ utf8: currentLine.text.trim() }]
            });
        }

        // Ensure no overlapping - each line ends when next begins
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
        console.log('[BetterYTSubs] Transformed to', newEvents.length, 'line events');
        return data;
    }

    // Override fetch to intercept AND MODIFY subtitle responses
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

        // Check if this is a subtitle request
        if (url && url.includes('timedtext')) {
            console.log('[BetterYTSubs] Intercepting timedtext fetch');

            const response = await originalFetch.apply(this, args);

            try {
                const data = await response.json();
                const transformed = transformSubtitles(data);

                // Return a new response with transformed data
                return new Response(JSON.stringify(transformed), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            } catch (e) {
                console.error('[BetterYTSubs] Error transforming:', e);
                // Fall back to original on error
                return originalFetch.apply(this, args);
            }
        }

        return originalFetch.apply(this, args);
    };

    // Also intercept XMLHttpRequest
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
            console.log('[BetterYTSubs] Intercepting timedtext XHR');

            const xhr = this;
            const originalOnReadyStateChange = xhr.onreadystatechange;

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

    console.log('[BetterYTSubs] Fetch/XHR interceptors installed - modifying subtitle data');
})();
