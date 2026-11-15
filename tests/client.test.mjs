import test from 'node:test';import assert from 'node:assert/strict';import {cleanTranscript} from '../client.mjs';
test('ordinary Unicode dictation remains intact',()=>assert.equal(cleanTranscript('  Café and tea, please.  '),'Café and tea, please.'));
test('control characters cannot introduce hidden text controls',()=>assert.equal(cleanTranscript('hello\u0000world\u2028again\u007f'),'hello world again'));
test('short deliberate repeated words are valid speech',()=>assert.equal(cleanTranscript('Yes, yes. I understand.'),'Yes, yes. I understand.'));
test('runaway repeated recognition is rejected before insertion',()=>assert.throws(()=>cleanTranscript('Please subscribe to the channel. '.repeat(10)),/Speech repeated unexpectedly/));
