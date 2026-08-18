const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sample = {
    events: [{
        tStartMs: 1000,
        dDurationMs: 1000,
        segs: [{ utf8: 'Hello ' }, { utf8: 'world.' }]
    }]
};

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
assert.deepEqual(manifest.content_scripts[0].js, ['injected.js']);
assert.equal(manifest.content_scripts[0].run_at, 'document_start');
assert.equal(manifest.content_scripts[0].world, 'MAIN');

let fetchedUrl;

class MockXMLHttpRequest {
    open(method, url) {
        this.openedUrl = String(url);
    }

    send() {}

    get responseText() {
        return this.nativeResponseText;
    }

    get response() {
        return this.nativeResponse;
    }
}

const context = {
    console: { log() {}, warn() {}, error() {} },
    fetch: async (input) => {
        fetchedUrl = typeof input === 'string' ? input : input.url;
        return new Response(JSON.stringify(structuredClone(sample)));
    },
    Headers,
    location: { href: 'https://www.youtube.com/watch?v=test' },
    Request,
    Response,
    URL,
    XMLHttpRequest: MockXMLHttpRequest
};
context.window = context;

vm.runInNewContext(fs.readFileSync('injected.js', 'utf8'), context);

(async () => {
    const response = await context.fetch(new Request(
        'https://www.youtube.com/api/timedtext?v=test&fmt=srv3'
    ));
    const data = await response.json();

    assert.equal(new URL(fetchedUrl).searchParams.get('fmt'), 'json3');
    assert.equal(data.events[0].segs[0].utf8, 'Hello world.');

    const xhr = new MockXMLHttpRequest();
    xhr.open('GET', new URL('https://www.youtube.com/api/timedtext?v=test'));
    xhr.responseType = 'json';
    xhr.readyState = 4;
    xhr.nativeResponse = structuredClone(sample);
    xhr.nativeResponseText = JSON.stringify(sample);
    xhr.send();

    assert.equal(new URL(xhr.openedUrl).searchParams.get('fmt'), 'json3');
    assert.equal(xhr.response.events[0].segs[0].utf8, 'Hello world.');
    console.log('Firefox subtitle interception checks passed.');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
