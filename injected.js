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

                // Flush line if it ends with sentence punctuation OR exceeds 15 words
                const trimmedText = currentLine.text.trim();
                const hasPunctuation = trimmedText.match(/[.!?]$/);
                const wordCount = (trimmedText.match(/ /g) || []).length + 1;
                const tooManyWords = wordCount >= 15;

                if (hasPunctuation || tooManyWords) {
                    newEvents.push({
                        tStartMs: currentLine.startTime,
                        dDurationMs: currentLine.endTime - currentLine.startTime,
                        segs: [{ utf8: trimmedText }]
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

    function getJson3Url(input) {
        const url = typeof input === 'string' || input instanceof URL
            ? String(input)
            : input?.url;

        if (!url || !url.includes('/api/timedtext')) return null;

        const json3Url = new URL(url, location.href);
        json3Url.searchParams.set('fmt', 'json3');
        return json3Url.href;
    }

    // Intercept fetch API
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = getJson3Url(args[0]);

        if (url) {
            console.log('[BetterYTSubs] intercepted fetch:', url.substring(0, 100));

            args[0] = args[0] instanceof Request
                ? new Request(url, args[0])
                : url;

            try {
                const response = await originalFetch.apply(this, args);
                const clonedResponse = response.clone();

                try {
                    const data = await clonedResponse.json();
                    const transformed = transformSubtitles(data);
                    const headers = new Headers(response.headers);
                    headers.delete('content-length');
                    headers.delete('content-encoding');

                    return new Response(JSON.stringify(transformed), {
                        status: response.status,
                        statusText: response.statusText,
                        headers
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
    const originalXHRResponse = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response').get;
    const originalXHRResponseText = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText').get;
    const xhrUrls = new WeakMap();

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const json3Url = getJson3Url(url);
        xhrUrls.set(this, json3Url);
        return originalXHROpen.apply(this, [method, json3Url || url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        const url = xhrUrls.get(this);

        if (url) {
            console.log('[BetterYTSubs] intercepted xhr:', url.substring(0, 100));

            const xhr = this;
            let transformedResponse;
            let transformedResponseText;

            function transformText(original) {
                if (xhr.readyState !== 4 || !original) return original;
                if (transformedResponseText !== undefined) return transformedResponseText;

                try {
                    transformedResponseText = JSON.stringify(transformSubtitles(JSON.parse(original)));
                } catch (error) {
                    transformedResponseText = original;
                }
                return transformedResponseText;
            }

            Object.defineProperties(xhr, {
                responseText: {
                    configurable: true,
                    get: function () {
                        return transformText(originalXHRResponseText.call(this));
                    }
                },
                response: {
                    configurable: true,
                    get: function () {
                        const original = originalXHRResponse.call(this);
                        if (this.readyState !== 4 || !original) return original;
                        if (typeof original === 'string') return transformText(original);
                        if (this.responseType !== 'json') return original;
                        if (transformedResponse === undefined) {
                            transformedResponse = transformSubtitles(original);
                        }
                        return transformedResponse;
                    }
                }
            });
        }

        return originalXHRSend.apply(this, args);
    };

    console.log('[BetterYTSubs] traps set. ready to intercept.');
})();
