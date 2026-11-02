import { describe, it, expect } from 'vitest';
import { sha256 } from '../src/rules/hash.js';
import { commitment, idsString } from '../src/rules/verify.js';
import { standardIdentity } from '../src/rules/identity.js';

describe('sha256', () => {
  it('matches the standard vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});
describe('commitment', () => {
  it('serialises ids in index order and hashes colour|ids|salt', () => {
    expect(idsString(standardIdentity('w'), 'w')).toBe('rnbqkbnrpppppppp');
    const salt = '00112233445566778899aabbccddeeff';
    expect(commitment('w', standardIdentity('w'), salt)).toBe(sha256(`w|rnbqkbnrpppppppp|${salt}`));
    expect(commitment('w', standardIdentity('w'), salt)).not.toBe(commitment('w', standardIdentity('w'), 'ff' + salt.slice(2)));
  });
});
