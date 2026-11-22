// A tiny stack VM for make.fun's ISA v1: runs every /input/<id>/program.bin and writes its output and exit code.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// opcode -> [immediate bytes, pops, pushes]
const OPS: Record<number, number[]> = {
  0: [0, 0, 0], 1: [1, 0, 1], 2: [4, 0, 1], 3: [0, 1, 0], 4: [0, 1, 2], 5: [0, 2, 2], 6: [0, 2, 3], 7: [0, 3, 3],
  0x17: [0, 1, 1], 0x1b: [0, 1, 1], 0x30: [2, 0, 0], 0x31: [2, 1, 0], 0x32: [2, 1, 0], 0x33: [2, 0, 0],
  0x34: [0, 0, 0], 0x40: [0, 1, 1], 0x41: [0, 2, 0], 0x50: [0, 1, 0], 0x51: [0, 1, 0], 0x52: [0, 0, 1], 0x53: [0, 1, 0],
};
for (const b of [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19, 0x1a, 0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22])
  OPS[b] = [0, 2, 1];

function run(p: Uint8Array, inp: Uint8Array): [Uint8Array, number] {
  const n = p.length, D = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, csp = 0, ol = 0, ip = 0, pc = 0, steps = 0;
  const end = (code: number): [Uint8Array, number] => [out.slice(0, ol), code];
  for (;;) {
    if (steps === 1e6) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const o = p[pc], d = OPS[o];
    if (!d) return end(5);
    if (pc + d[0] >= n) return end(9);
    steps++;
    const nx = pc + 1 + d[0];
    if (sp < d[1]) return end(2);
    if (sp - d[1] + d[2] > 256) return end(3);
    pc = nx;
    const b = D[sp - 1], a = D[sp - 2];
    switch (o) {
      case 0: return end(0);
      case 1: D[sp++] = (p[pc - 1] << 24) >> 24; break;
      case 2: D[sp++] = p[pc - 4] | (p[pc - 3] << 8) | (p[pc - 2] << 16) | (p[pc - 1] << 24); break;
      case 3: sp--; break;
      case 4: D[sp++] = b; break;
      case 5: D[sp - 1] = a; D[sp - 2] = b; break;
      case 6: D[sp++] = a; break;
      case 7: { const c = D[sp - 3]; D[sp - 3] = a; D[sp - 2] = b; D[sp - 1] = c; break; }
      case 0x17: D[sp - 1] = -b | 0; break;
      case 0x1b: D[sp - 1] = ~b; break;
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[pc - 2] | (p[pc - 1] << 8)) << 16) >> 16;
        let take = true;
        if (o !== 0x30) { sp--; take = o === 0x31 ? b === 0 : b !== 0; }
        if (take) pc += rel;
        break;
      }
      case 0x33:
        if (csp === 64) return end(7);
        C[csp++] = pc; pc = p[pc - 2] | (p[pc - 1] << 8); break;
      case 0x34:
        if (csp === 0) return end(8);
        pc = C[--csp]; break;
      case 0x40:
        if (b < 0 || b > 255) return end(6);
        D[sp - 1] = M[b]; break;
      case 0x41:
        if (b < 0 || b > 255) return end(6);
        M[b] = a; sp -= 2; break;
      case 0x50: {
        const s = String(b);
        if (ol + s.length > 65536) return end(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (ol + 1 > 65536) return end(11);
        sp--; out[ol++] = b & 255; break;
      case 0x52: D[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 0x53: return end(b & 255);
      default: {
        let r = 0;
        switch (o) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13: if (b === 0) return end(4); r = b === -1 ? -a | 0 : (a / b) | 0; break;
          case 0x14: if (b === 0) return end(4); r = b === -1 ? 0 : a % b | 0; break;
          case 0x15: if (b === 0) return end(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break;
          case 0x16: if (b === 0) return end(4); r = (a >>> 0) % (b >>> 0) | 0; break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          case 0x22: r = a >>> 0 < b >>> 0 ? 1 : 0; break;
        }
        D[--sp - 1] = r;
      }
    }
  }
}

for (const id of readdirSync(I).sort()) {
  const read = (f: string) => { try { return new Uint8Array(readFileSync(`${I}/${id}/${f}`)); } catch { return new Uint8Array(0); } };
  const [stdout, code] = run(read('program.bin'), read('input.bin'));
  mkdirSync(`${O}/${id}`, { recursive: true });
  writeFileSync(`${O}/${id}/stdout.bin`, stdout);
  writeFileSync(`${O}/${id}/exit.txt`, `${code}\n`);
}
